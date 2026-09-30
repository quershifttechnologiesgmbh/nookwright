/**
 * Adapter „Eigenes Minecraft-JAR“: liest die vom Nutzer gewählte Datei LOKAL im Browser und baut daraus das
 * Asset-Bündel (`bundleFromJar` aus @mcda/viewer/assets: ZIP-Leser, PNG-Codec, Atlas). Nichts wird hochgeladen.
 *
 * Bevorzugt in einem Web Worker (jarWorker.ts), damit die Oberfläche beim Dekodieren von ~1300 Texturen
 * flüssig bleibt; ohne Worker im Haupt-Thread. Entpackt wird mit `DecompressionStream('deflate-raw'/'deflate')`.
 */
import type { AssetBundle, BundlePhase } from '@mcda/viewer/assets';
import { streamInflate } from './inflate.js';

export type JarProgressFn = (phase: BundlePhase, done: number, total: number) => void;

/** Nachrichten Haupt-Thread ↔ Worker. */
export interface JarRequest {
  readonly file: Blob;
}
export type JarResponse =
  | { readonly type: 'progress'; readonly phase: BundlePhase; readonly done: number; readonly total: number }
  | { readonly type: 'done'; readonly bundle: AssetBundle }
  | { readonly type: 'error'; readonly name: string; readonly message: string };

class WorkerStartError extends Error {
  override readonly name = 'WorkerStartError';
}

function inWorker(file: Blob, onProgress: JarProgressFn): Promise<AssetBundle> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./jarWorker.ts', import.meta.url), { type: 'module', name: 'jar-assets' });
    } catch (e) {
      reject(new WorkerStartError(e instanceof Error ? e.message : String(e)));
      return;
    }
    let answered = false;
    worker.onmessage = (e: MessageEvent<JarResponse>) => {
      answered = true;
      const m = e.data;
      if (m.type === 'progress') {
        onProgress(m.phase, m.done, m.total);
        return;
      }
      worker.terminate();
      if (m.type === 'done') resolve(m.bundle);
      else reject(Object.assign(new Error(m.message), { name: m.name }));
    };
    worker.onerror = (e: ErrorEvent) => {
      worker.terminate();
      const msg = e.message || 'Worker-Fehler';
      reject(answered ? new Error(msg) : new WorkerStartError(msg));
    };
    worker.postMessage({ file } satisfies JarRequest);
  });
}

/** JAR-Datei → Asset-Bündel. Wirft mit verständlicher Meldung, wenn es kein Client-JAR ist. */
export async function bundleJarFile(file: Blob, onProgress: JarProgressFn = () => undefined): Promise<AssetBundle> {
  if (typeof Worker === 'function') {
    try {
      return await inWorker(file, onProgress);
    } catch (e) {
      if (!(e instanceof WorkerStartError)) throw e;
      console.warn('JAR-Worker nicht verfügbar, lese im Haupt-Thread:', e.message);
    }
  }
  const { bundleFromJar } = await import('@mcda/viewer/assets');
  return bundleFromJar(new Uint8Array(await file.arrayBuffer()), streamInflate, { concurrency: 32, onProgress });
}
