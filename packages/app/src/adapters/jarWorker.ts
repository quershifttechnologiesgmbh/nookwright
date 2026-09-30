/**
 * Web Worker: Nutzer-JAR → Asset-Bündel (siehe jarTextures.ts). Läuft lokal im Browser; die Datei verlässt
 * das Gerät nicht. Fortschritt höchstens alle 100 ms, der Atlas (RGBA) wird ohne Kopie übertragen.
 */
import { bundleFromJar } from '@mcda/viewer/assets';
import { streamInflate } from './inflate.js';
import type { JarRequest, JarResponse } from './jarTextures.js';

/** Schmale Sicht auf den Worker-Scope (die App-tsconfig hat die DOM-Lib, nicht die WebWorker-Lib). */
interface WorkerScope {
  onmessage: ((e: MessageEvent<JarRequest>) => void) | null;
  postMessage(message: JarResponse, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  void (async () => {
    try {
      const bytes = new Uint8Array(await e.data.file.arrayBuffer());
      let last = 0;
      const bundle = await bundleFromJar(bytes, streamInflate, {
        concurrency: 32,
        onProgress: (phase, done, total) => {
          const now = performance.now();
          if (done !== total && now - last < 100) return;
          last = now;
          scope.postMessage({ type: 'progress', phase, done, total });
        },
      });
      scope.postMessage({ type: 'done', bundle }, [bundle.atlas.data.buffer as ArrayBuffer]);
    } catch (err) {
      scope.postMessage({ type: 'error', name: err instanceof Error ? err.name : 'Error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
};
