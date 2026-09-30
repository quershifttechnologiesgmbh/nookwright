/**
 * Node-Adapter für den Port `GzipCodec` (node:zlib, synchron, Level 9) plus Komfortfunktionen.
 * Export: `@mcda/export/node`. Einzige Node-Abhängigkeit des Pakets; der Kern bleibt browser-tauglich.
 * Für rohe NBT-Bäume: `writeNbtFileSync(root, nodeGzip)` / `readNbtFileSync(bytes, nodeGzip)` aus dem Kern.
 */
import { gunzipSync, gzipSync } from 'node:zlib';
import type { GzipCodecSync } from './compression.js';
import { readExportFileSync, writeExportFileSync, type ExportFormat, type ExportOptions } from './exporter.js';
import type { ExportVolume } from './model.js';

const view = (b: Buffer): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

export const nodeGzip: GzipCodecSync = {
  gzip: (raw) => view(gzipSync(raw, { level: 9 })),
  gunzip: (compressed) => view(gunzipSync(compressed)),
};

/** Volumen → fertige Datei (GZip). */
export function exportFile(format: ExportFormat, v: ExportVolume, opts: ExportOptions = {}): Uint8Array {
  return writeExportFileSync(format, v, nodeGzip, opts);
}

/** Datei (GZip oder unkomprimiert) → Volumen (für Litematica: erste Region). */
export function importFile(format: ExportFormat, bytes: Uint8Array): ExportVolume {
  return readExportFileSync(format, bytes, nodeGzip);
}
