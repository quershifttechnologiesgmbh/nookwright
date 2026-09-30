/**
 * W14: Haupt-Thread-Seite des Spielbarkeits-Workers (Instanz „playability“ von computeWorker.ts). Der Assistent plant
 * den Vorschlag im Haupt-Thread und lässt die Spielbarkeit (Einrichtung + Erschließung, ~45 % der Rechenzeit einer Runde) parallel im
 * Worker prüfen – dieselbe Funktion, dasselbe Ergebnis (`playabilityJob`). Anfragen laufen einzeln nacheinander;
 * `cancelPending` verwirft Wartende (neue Parameter), die laufende rechnet zu Ende und landet im Zwischenspeicher.
 * Ohne Worker (Tests, alte Browser, Startfehler) liefert `createPlayabilityClient` `undefined` bzw. lehnt ab – dann
 * rechnet der Aufrufer wie bisher selbst.
 */
import type { PlayabilityFinding } from '@mcda/pipeline';
import type { TypeParams } from '../buildingTypes.js';
import type { PlayabilityReply, PlayabilityRequest } from './playabilityJob.js';

export interface PlayabilityClient {
  /** Befunde (leer = spielbar) für Bautyp, Parameter, Seed; lehnt ab, wenn verworfen oder der Worker ausfällt. */
  issues(typeId: string, params: TypeParams, seed: number): Promise<readonly PlayabilityFinding[]>;
  /** Wartende Anfragen verwerfen (sie lehnen mit `PlayabilityCancelled` ab). */
  cancelPending(): void;
  dispose(): void;
}

export class PlayabilityCancelled extends Error {
  override readonly name = 'PlayabilityCancelled';
}

interface Pending {
  readonly req: PlayabilityRequest;
  readonly key: string;
  resolve: (issues: readonly PlayabilityFinding[]) => void;
  reject: (e: Error) => void;
}

const RECENT = 48;

/** Minimale Worker-Schnittstelle (für Tests ersetzbar). */
export interface WorkerLike {
  onmessage: ((e: MessageEvent<PlayabilityReply>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(message: PlayabilityRequest): void;
  terminate(): void;
}

const spawnWorker = (): WorkerLike =>
  new Worker(new URL('./computeWorker.ts', import.meta.url), { type: 'module', name: 'playability' }) as unknown as WorkerLike;

export function createPlayabilityClient(spawn?: () => WorkerLike): PlayabilityClient | undefined {
  if (spawn === undefined && typeof Worker === 'undefined') return undefined;
  let worker: WorkerLike;
  try {
    worker = (spawn ?? spawnWorker)();
  } catch {
    return undefined;
  }
  let nextId = 1;
  let broken: Error | undefined;
  let running: Pending | undefined;
  const queue: Pending[] = [];
  const done: Array<{ readonly key: string; readonly issues: readonly PlayabilityFinding[] }> = [];
  const pump = (): void => {
    if (running !== undefined || broken !== undefined) return;
    running = queue.shift();
    if (running !== undefined) worker.postMessage(running.req);
  };
  const fail = (e: Error): void => {
    broken = e;
    for (const p of [...(running !== undefined ? [running] : []), ...queue.splice(0)]) p.reject(e);
    running = undefined;
  };
  worker.onmessage = (e) => {
    const r = running;
    const m = e.data;
    if (r === undefined || m.id !== r.req.id) return;
    running = undefined;
    if ('issues' in m) {
      done.unshift({ key: r.key, issues: m.issues });
      done.length = Math.min(done.length, RECENT);
      r.resolve(m.issues);
    } else r.reject(new Error(m.error));
    pump();
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    fail(new Error(`Spielbarkeits-Worker: ${e.message}`));
  };
  return {
    issues(typeId, params, seed) {
      const key = `${typeId}|${seed}|${JSON.stringify(params)}`;
      const hit = done.find((d) => d.key === key);
      if (hit !== undefined) return Promise.resolve(hit.issues);
      if (broken !== undefined) return Promise.reject(broken);
      // gleiche Anfrage schon unterwegs oder wartend → mitlaufen
      const same = running?.key === key ? running : queue.find((p) => p.key === key);
      return new Promise((resolve, reject) => {
        if (same !== undefined) {
          const prevResolve = same.resolve, prevReject = same.reject;
          same.resolve = (x) => {
            prevResolve(x);
            resolve(x);
          };
          same.reject = (x) => {
            prevReject(x);
            reject(x);
          };
          return;
        }
        queue.push({ req: { id: nextId++, typeId, params, seed }, key, resolve, reject });
        pump();
      });
    },
    cancelPending() {
      for (const p of queue.splice(0)) p.reject(new PlayabilityCancelled('verworfen'));
    },
    dispose() {
      this.cancelPending();
      worker.terminate();
      fail(new PlayabilityCancelled('beendet'));
    },
  };
}

let shared: PlayabilityClient | undefined | null = null;

/** Ein Worker für die ganze Sitzung, beim ersten Öffnen des Assistenten gestartet (`undefined` ohne Worker). */
export function sharedPlayabilityClient(): PlayabilityClient | undefined {
  if (shared === null) shared = createPlayabilityClient();
  return shared;
}
