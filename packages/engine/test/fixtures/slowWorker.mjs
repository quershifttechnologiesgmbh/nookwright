// Test-Worker mit dem Protokoll von generatePool.ts: rechnet `workerData.ms` Millisekunden (Busy-Loop, blockiert den
// Thread wie eine echte Generierung) und antwortet dann mit einem festen Ergebnis.
import { parentPort, workerData } from 'node:worker_threads';

parentPort.on('message', ({ id, job }) => {
  const until = Date.now() + workerData.ms;
  while (Date.now() < until) { /* rechnen */ }
  parentPort.postMessage({ id, outcome: { result: { ok: true, op: job.request.op, data: { slept: workerData.ms } }, ms: workerData.ms } });
});
parentPort.postMessage({ type: 'ready' });
