/**
 * Browser-Adapter für den Port `GzipCodec` (@mcda/export): native `CompressionStream('gzip')` /
 * `DecompressionStream('gzip')` – keine Abhängigkeit, async. Node ≥ 18 hat dieselben Klassen global,
 * deshalb läuft der Adapter auch unter Vitest (Gegenprobe mit node:zlib in den Tests).
 */
import type { GzipCodec } from '@mcda/export';

/** Kann dieser Browser GZip über Streams? (alle aktuellen Browser; sonst ist der Export gesperrt) */
export function streamGzipAvailable(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/** Schiebt die Bytes durch einen Transform-Stream und sammelt die Ausgabe (Schreiben und Lesen parallel: kein Stau). */
export async function pump(input: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Kopie auf ein eigenes ArrayBuffer: Streams akzeptieren keine Sichten auf SharedArrayBuffer.
  const written = writer.write(new Uint8Array(input)).then(() => writer.close());
  const [out] = await Promise.all([new Response(stream.readable).arrayBuffer(), written]);
  return new Uint8Array(out);
}

export const streamGzip: GzipCodec = {
  gzip: (raw) => pump(raw, new CompressionStream('gzip')),
  gunzip: (compressed) => pump(compressed, new DecompressionStream('gzip')),
};
