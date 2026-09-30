/**
 * Browser-Adapter für den Port `AsyncInflate` (@mcda/viewer, JAR lesen): native `DecompressionStream`
 * – `deflate-raw` für ZIP-Einträge, `deflate` (zlib) für PNG-Bilddaten. Keine Abhängigkeit; läuft auch im
 * Web Worker und unter Node ≥ 22 (Tests prüfen gegen node:zlib).
 */
import type { AsyncInflate } from '@mcda/viewer/assets';
import { pump } from './gzip.js';

/** Kann dieser Browser rohes Deflate entpacken? (Chrome 103+, Firefox 113+, Safari 16.4+) */
export function streamInflateAvailable(): boolean {
  try {
    return typeof DecompressionStream === 'function' && new DecompressionStream('deflate-raw') !== null;
  } catch {
    return false;
  }
}

export const streamInflate: AsyncInflate = {
  inflateRaw: (data) => pump(data, new DecompressionStream('deflate-raw')),
  inflate: (data) => pump(data, new DecompressionStream('deflate')),
};
