/**
 * `@mcda/viewer/assets` – der Asset-Kern ohne deepslate und ohne DOM (auch im Web Worker nutzbar):
 * ZIP-Leser, PNG-Codec, Atlas, Bündel, JAR → Asset-Bündel (async). Der Haupteinstieg `@mcda/viewer`
 * exportiert dasselbe zusätzlich zum Renderer.
 */
export * from './zip.js';
export * from './png.js';
export * from './atlas.js';
export * from './extract.js';
export * from './bundle.js';
export { crc32 } from './crc32.js';
