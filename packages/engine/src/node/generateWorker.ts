/**
 * Generier-Worker (siehe `generatePool.ts`): eigene Engine über dem Katalog aus `workerData.catalogDir`, ohne Cache
 * (der Cache liegt im Hauptthread, sonst träfe er nur zufällig denselben Worker). Projekt-Sessions kommen serialisiert
 * wie im Projektspeicher (`serializeSession`) und leben nur für diesen Auftrag in einem eigenen Speicher.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { nodeContext } from '@mcda/pipeline/node';
import { createEngine } from '../engine.js';
import { memorySessions } from '../session.js';
import { reviveSession } from '../store.js';
import type { GenerateJob } from './generatePool.js';
import { encodeResult } from './wire.js';

const port = parentPort!;
const engine = createEngine(nodeContext((workerData as { catalogDir: string }).catalogDir), { cacheSize: 0 });

port.on('message', ({ id, job }: { id: number; job: GenerateJob }) => {
  try {
    const sessions = memorySessions();
    if (job.session !== undefined) sessions.put(reviveSession(job.session.id, job.session.data));
    const t = performance.now();
    const r = engine.execute(job.request, { sessions });
    const outcome = encodeResult(r, job.file, performance.now() - t);
    // Datei als Kopie (≈ 20 KB): Die Bytes von gzipSync können im geteilten Buffer-Pool liegen, Transfer würde ihn lösen.
    port.postMessage({ id, outcome });
  } catch (err) {
    port.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
});
port.postMessage({ type: 'ready' });
