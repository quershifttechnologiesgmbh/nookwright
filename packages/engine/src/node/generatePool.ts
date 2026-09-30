/**
 * Worker-Pool für die rechenintensiven Operationen des HTTP-Servers (node:worker_threads). Die Generierung läuft
 * synchron und dauert 0,2–3 s (große Bauten länger); im Hauptthread würde sie den Server blockieren, auch /healthz.
 *
 * - Größe fest (Standard min(2, CPUs − 1), mindestens 1); jeder Worker hat eine eigene Engine über demselben Katalog.
 * - Zeitlimit je Aufruf (gemessen ab Übergabe an den Worker): Überschreitung → Worker beenden und neu starten,
 *   `GenerateError` 504. Die Warteschlange ist begrenzt: voll → `GenerateError` 503 mit `retryAfterS`.
 * - Bricht der Client ab, solange der Auftrag noch wartet, fällt er aus der Warteschlange.
 *
 * Protokoll (auch für Test-Worker): Worker meldet `{ type: 'ready' }`, bekommt `{ id, job }` und antwortet
 * `{ id, outcome }` bzw. `{ id, error }`.
 */
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { EngineRequest } from '../engine.js';
import type { WireOutcome } from './wire.js';

export interface GenerateJob {
  readonly request: EngineRequest;
  /** Projekt-Session im Format des Projektspeichers (`serializeSession`), nur für `project_generate`. */
  readonly session?: { readonly id: string; readonly data: string };
  /** Schematic-Datei im Worker kodieren (`?file=1`). */
  readonly file: boolean;
}

/** Fehler des Pools mit HTTP-Status (503 Warteschlange voll/Pool geschlossen, 504 Zeitlimit, 500 Worker abgestürzt). */
export class GenerateError extends Error {
  constructor(readonly status: 500 | 503 | 504, message: string, readonly retryAfterS?: number) {
    super(message);
  }
}

/** Client hat die Anfrage abgebrochen, bevor der Auftrag lief (Status 499 nur fürs Zugriffslog; keine Antwort mehr). */
export class ClientAbortError extends Error {
  readonly status = 499;
  constructor() {
    super('Anfrage vom Client abgebrochen');
  }
}

export interface PoolStats {
  readonly size: number;
  readonly busy: number;
  readonly queued: number;
  /** Neustarts nach Zeitlimit oder Absturz seit Start. */
  readonly restarts: number;
}

export interface GeneratePool {
  run(job: GenerateJob, signal?: AbortSignal): Promise<WireOutcome>;
  stats(): PoolStats;
  /** Worker beenden, wartende Aufträge mit 503 ablehnen. */
  close(): Promise<void>;
}

export interface GeneratePoolOptions {
  /** Anzahl Worker (Standard `defaultPoolSize()`). */
  readonly size?: number;
  /** Zeitlimit je Aufruf in ms (Standard `DEFAULT_GENERATE_TIMEOUT_MS`). */
  readonly timeoutMs?: number;
  /** Höchstzahl wartender Aufträge (zusätzlich zu den laufenden; Standard 4 je Worker). */
  readonly queue?: number;
  /** Einstieg des Workers (Standard: Engine-Worker; Tests setzen einen eigenen). */
  readonly workerUrl?: URL;
  /** An den Worker (Standard-Worker: `{ catalogDir }`). */
  readonly workerData?: unknown;
  /** Meldung bei Neustart/Absturz (Betriebslog). */
  readonly onEvent?: (event: { readonly kind: 'timeout' | 'crash'; readonly op: string; readonly ms: number; readonly message?: string }) => void;
}

/**
 * Standard-Zeitlimit: 20 s. Die längste gemessene Generierung liegt bei ≈ 3 s (einzeln), unter Last mit parallelen
 * Workern eher beim Doppelten; 20 s lassen großen Bauten Luft, liegen aber unter den üblichen Proxy-Zeitlimits (60 s),
 * sodass der Client eine klare 504 der Engine sieht statt eines Abbruchs am Proxy.
 */
export const DEFAULT_GENERATE_TIMEOUT_MS = 20_000;

/** min(2, CPUs − 1), mindestens 1: ein Kern bleibt für HTTP, Speicher und Health frei. */
export const defaultPoolSize = (): number => Math.max(1, Math.min(2, availableParallelism() - 1));

/** Einstieg des Engine-Workers (lädt tsx, dann `generateWorker.ts`). */
export const ENGINE_WORKER_URL = new URL('./generateWorker.mjs', import.meta.url);

interface Pending {
  readonly job: GenerateJob;
  readonly resolve: (o: WireOutcome) => void;
  readonly reject: (e: Error) => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
}

interface Slot {
  worker: Worker;
  ready: boolean;
  current?: { readonly id: number; readonly p: Pending; readonly timer: NodeJS.Timeout; readonly t0: number } | undefined;
}

export function generatePool(opts: GeneratePoolOptions = {}): GeneratePool {
  const size = Math.max(1, Math.floor(opts.size ?? defaultPoolSize()));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS;
  const maxQueue = Math.max(0, Math.floor(opts.queue ?? 4 * size));
  const url = opts.workerUrl ?? ENGINE_WORKER_URL;
  const queue: Pending[] = [];
  const slots: Slot[] = [];
  let seq = 0;
  let restarts = 0;
  let closed = false;
  /** Worker, die vor `ready` enden (Einstieg kaputt); ab 3 in Folge kein Neustart mehr. */
  let startFailures = 0;
  let broken: string | undefined;
  /** Gleitender Mittelwert der Laufzeit (für Retry-After). */
  let avgMs = 2_000;

  const opOf = (p: Pending): string => p.job.request.op;

  const spawn = (): Slot => {
    // execArgv leer: Der Einstieg registriert tsx selbst – gleich unter `tsx`, `node --import tsx` und vitest.
    const worker = new Worker(url, { workerData: opts.workerData, execArgv: [] });
    const slot: Slot = { worker, ready: false };
    worker.on('message', (m: { type?: 'ready'; id?: number; outcome?: WireOutcome; error?: string }) => {
      if (m.type === 'ready') {
        slot.ready = true;
        startFailures = 0;
        return pump();
      }
      const cur = slot.current;
      if (cur === undefined || cur.id !== m.id) return;
      clearTimeout(cur.timer);
      slot.current = undefined;
      const ms = performance.now() - cur.t0;
      avgMs = avgMs * 0.8 + ms * 0.2;
      if (m.error !== undefined) cur.p.reject(new Error(m.error));
      else cur.p.resolve(m.outcome!);
      pump();
    });
    const lost = (message: string): void => {
      if (closed || !slots.includes(slot)) return;
      if (!slot.ready && ++startFailures >= 3) {
        broken = message;
        slots.splice(slots.indexOf(slot), 1);
        for (const p of queue.splice(0)) p.reject(new GenerateError(500, `Generier-Worker startet nicht: ${message}`));
        return;
      }
      const cur = slot.current;
      if (cur !== undefined) {
        clearTimeout(cur.timer);
        slot.current = undefined;
        opts.onEvent?.({ kind: 'crash', op: opOf(cur.p), ms: Math.round(performance.now() - cur.t0), message });
        cur.p.reject(new GenerateError(500, `Generier-Worker abgestürzt (${message}) – Anfrage erneut senden`));
      }
      replace(slot);
    };
    worker.on('error', (err: unknown) => lost(err instanceof Error ? err.message : String(err)));
    worker.on('exit', (code) => lost(`Exit-Code ${code}`));
    return slot;
  };

  const replace = (slot: Slot): void => {
    const i = slots.indexOf(slot);
    if (i < 0) return;
    restarts++;
    slots[i] = spawn();
    void slot.worker.terminate();
  };

  const dispatch = (slot: Slot, p: Pending): void => {
    p.signal?.removeEventListener('abort', p.onAbort);
    const id = ++seq;
    const t0 = performance.now();
    const timer = setTimeout(() => {
      if (slot.current?.id !== id) return;
      slot.current = undefined;
      opts.onEvent?.({ kind: 'timeout', op: opOf(p), ms: timeoutMs });
      p.reject(new GenerateError(504,
        `Zeitlimit überschritten: '${opOf(p)}' lief länger als ${timeoutMs} ms und wurde abgebrochen – kleinere Größe/weniger Etagen wählen oder später erneut versuchen`));
      replace(slot);
    }, timeoutMs);
    slot.current = { id, p, timer, t0 };
    slot.worker.postMessage({ id, job: p.job });
  };

  function pump(): void {
    for (const slot of slots) {
      if (queue.length === 0) return;
      if (slot.ready && slot.current === undefined) dispatch(slot, queue.shift()!);
    }
  }

  for (let i = 0; i < size; i++) slots.push(spawn());

  const busy = (): number => slots.filter((s) => s.current !== undefined).length;

  return {
    run(job, signal) {
      if (closed) return Promise.reject(new GenerateError(503, 'Server fährt herunter', 5));
      if (signal?.aborted === true) return Promise.reject(new ClientAbortError());
      if (broken !== undefined && slots.length === 0) return Promise.reject(new GenerateError(500, `Generier-Worker startet nicht: ${broken}`));
      const free = slots.some((s) => s.ready && s.current === undefined);
      if (!free && queue.length >= maxQueue) {
        const retryAfterS = Math.min(60, Math.max(1, Math.ceil((avgMs * (queue.length + 1)) / size / 1000)));
        return Promise.reject(new GenerateError(503, `Generierung ausgelastet (${busy()} laufen, ${queue.length} warten) – in ${retryAfterS} s erneut versuchen`, retryAfterS));
      }
      return new Promise<WireOutcome>((resolve, reject) => {
        const p: Pending = {
          job, resolve, reject, signal,
          onAbort: () => {
            const i = queue.indexOf(p);
            if (i >= 0) {
              queue.splice(i, 1);
              reject(new ClientAbortError());
            }
          },
        };
        signal?.addEventListener('abort', p.onAbort, { once: true });
        queue.push(p);
        pump();
      });
    },
    stats: () => ({ size, busy: busy(), queued: queue.length, restarts }),
    async close() {
      closed = true;
      for (const p of queue.splice(0)) p.reject(new GenerateError(503, 'Server fährt herunter', 5));
      for (const s of slots) {
        if (s.current !== undefined) {
          clearTimeout(s.current.timer);
          s.current.p.reject(new GenerateError(503, 'Server fährt herunter', 5));
          s.current = undefined;
        }
      }
      await Promise.all(slots.map((s) => s.worker.terminate()));
    },
  };
}
