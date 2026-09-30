/**
 * W14: Haupt-Thread-Seite des Blöcke-Workers (Instanz „blocks“ von computeWorker.ts). Drei Arten von Anfragen, eine
 * nach der anderen:
 * - `compute` (Vorschau „Blöcke“): es zählt nur der jüngste Stand – solange der Worker rechnet, ersetzt eine neue Anfrage
 *   die wartende (die ältere lehnt mit `BlocksSuperseded` ab);
 * - `exportFile` (Download) und `thumbnail` (Vorschaubilder des Assistenten): der Reihe nach, der Download zuerst.
 * Ohne Worker (Tests, Startfehler) liefert `sharedBlocksClient` `undefined` – dann rechnet die App wie bisher im
 * Haupt-Thread (`useWorld`).
 */
import type { ExportFormat } from '@mcda/export';
import type { ExportFile, GuideKind } from '../exporting.js';
import type { BlocksReply, BlocksRequest } from './blocksJob.js';

export type BlocksResult = Extract<BlocksReply, { voxels: unknown }>;

export interface BlocksClient {
  /** Blöcke für den Projektstand (Projektdatei); lehnt ab bei Fehler des Workers oder wenn eine neuere Anfrage kam. */
  compute(file: string, around: boolean): Promise<BlocksResult>;
  /** Export-Datei des Stands (gleiche Welt wie die Vorschau) – vor wartenden Vorschaubildern. */
  exportFile(file: string, around: boolean, format: ExportFormat): Promise<ExportFile>;
  /** Bauplan (Markdown) bzw. Materialliste (CSV) des Stands – wie `exportFile` vor wartenden Vorschaubildern. */
  guideFile(file: string, around: boolean, kind: GuideKind): Promise<ExportFile>;
  /**
   * Blöcke eines Vorschaubilds (Assistent): eigene Warteschlange, der Reihe nach (nichts wird ersetzt); die Vorschau
   * (`compute`) hat Vorrang. Ohne Umgebung.
   */
  thumbnail(file: string): Promise<BlocksResult>;
  /** Wartende Vorschaubilder verwerfen (lehnen mit `BlocksSuperseded` ab). */
  cancelThumbnails(): void;
  dispose(): void;
}

export class BlocksSuperseded extends Error {
  override readonly name = 'BlocksSuperseded';
}

/** Der Worker selbst ist ausgefallen (nicht: Fehler der Materialisierung) – die App rechnet dann selbst. */
export class BlocksWorkerFailed extends Error {
  override readonly name = 'BlocksWorkerFailed';
}

/** Minimale Worker-Schnittstelle (für Tests ersetzbar). */
export interface BlocksWorkerLike {
  onmessage: ((e: MessageEvent<BlocksReply>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(message: BlocksRequest): void;
  terminate(): void;
}

interface Pending {
  readonly req: BlocksRequest;
  readonly resolve: (r: BlocksReply) => void;
  readonly reject: (e: Error) => void;
}

const spawnWorker = (): BlocksWorkerLike =>
  new Worker(new URL('./computeWorker.ts', import.meta.url), { type: 'module', name: 'blocks' }) as unknown as BlocksWorkerLike;

export function createBlocksClient(spawn?: () => BlocksWorkerLike): BlocksClient | undefined {
  if (spawn === undefined && typeof Worker === 'undefined') return undefined;
  let worker: BlocksWorkerLike;
  try {
    worker = (spawn ?? spawnWorker)();
  } catch {
    return undefined;
  }
  let nextId = 1;
  let broken: Error | undefined;
  let running: Pending | undefined;
  /** jüngste Vorschau-Anfrage (höchstens eine) */
  let waiting: Pending | undefined;
  /** Downloads, dann Vorschaubilder */
  const queue: Pending[] = [];
  const pump = (): void => {
    if (running !== undefined || broken !== undefined) return;
    if (waiting !== undefined) {
      running = waiting;
      waiting = undefined;
    } else running = queue.shift();
    if (running !== undefined) worker.postMessage(running.req);
  };
  const failAll = (e: Error): void => {
    broken = e;
    for (const p of [running, waiting, ...queue.splice(0)]) p?.reject(e);
    running = waiting = undefined;
  };
  worker.onmessage = (e) => {
    const r = running;
    const m = e.data;
    if (r === undefined || m.id !== r.req.id) return;
    running = undefined;
    if ('error' in m) r.reject(new Error(m.error));
    else r.resolve(m);
    pump();
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    failAll(new BlocksWorkerFailed(`Blöcke-Worker: ${e.message}`));
  };
  const ask = <T,>(req: Omit<BlocksRequest, 'id'>, place: (p: Pending) => void, pick: (r: BlocksReply) => T | undefined): Promise<T> => {
    if (broken !== undefined) return Promise.reject(broken);
    return new Promise<T>((resolve, reject) => {
      place({
        req: { ...req, id: nextId++ },
        resolve: (r) => {
          const v = pick(r);
          if (v === undefined) reject(new Error('unerwartete Antwort des Blöcke-Workers'));
          else resolve(v);
        },
        reject,
      });
      pump();
    });
  };
  const blocks = (r: BlocksReply): BlocksResult | undefined => ('voxels' in r ? r : undefined);
  const isDownload = (q: Pending): boolean => q.req.export !== undefined || q.req.guide !== undefined;
  const beforeThumbs = (p: Pending): void => {
    const firstThumb = queue.findIndex((q) => !isDownload(q));
    queue.splice(firstThumb < 0 ? queue.length : firstThumb, 0, p);
  };
  return {
    compute(file, around) {
      return ask({ file, around }, (p) => {
        waiting?.reject(new BlocksSuperseded('ersetzt'));
        waiting = p;
      }, blocks);
    },
    exportFile(file, around, format) {
      return ask({ file, around, export: format }, beforeThumbs, (r) => ('file' in r ? r.file : undefined));
    },
    guideFile(file, around, kind) {
      return ask({ file, around, guide: kind }, beforeThumbs, (r) => ('file' in r ? r.file : undefined));
    },
    thumbnail(file) {
      return ask({ file, around: false }, (p) => queue.push(p), blocks);
    },
    cancelThumbnails() {
      for (let i = queue.length - 1; i >= 0; i--) {
        if (isDownload(queue[i]!)) continue;
        queue.splice(i, 1)[0]!.reject(new BlocksSuperseded('verworfen'));
      }
    },
    dispose() {
      failAll(new BlocksSuperseded('beendet'));
      worker.terminate();
    },
  };
}

let shared: BlocksClient | undefined | null = null;

/** Ein Worker für die ganze Sitzung (`undefined` ohne Worker-Unterstützung). */
export function sharedBlocksClient(): BlocksClient | undefined {
  if (shared === null) shared = createBlocksClient();
  return shared;
}
