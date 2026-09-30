/**
 * @mcda/viewer – generischer Kontext „Vorschau“ (Domain Design §2.1): 3D-Darstellung eines VoxelVolume mit
 * echten Blockmodellen über deepslate (MIT). Browserfähig, ohne I/O. Mojang-Daten kommen ausschließlich
 * über den Port `ViewerResources` von außen (research/08 §5: nie ausliefern, nie einchecken).
 *
 * - Port und Adapter: `ViewerResources` → `createDeepslateResources`
 * - Volumen → Struktur: `toStructure` (inkl. Näherungen für Doppeltruhen und Rahmen)
 * - Renderer (DOM/WebGL): `createBlockRenderer(canvas, resources)`, beleuchtet `createLitRenderer`
 * - Auswahl per Klick (rein): `orbitRay`, `raycastGrid`, Auswahlrahmen `boxLines`
 * - Asset-Kern (rein, auch für ein späteres Nutzer-JAR im Browser): ZIP, PNG, Atlas, Bündel, Flags, Farben
 */
export * from './port.js';
export * from './resources.js';
export * from './structure.js';
export * from './camera.js';
export * from './pick.js';
export * from './synthetic.js';
export * from './renderer.js';
export * from './assets/zip.js';
export * from './assets/png.js';
export * from './assets/atlas.js';
export * from './assets/extract.js';
export * from './assets/bundle.js';
export { crc32 } from './assets/crc32.js';
// Licht (V2): Lichtfeld, Tageszeit/Lightmap, weiches Licht + AO, beleuchtete Geometrie, WebGL2-Renderer
export * from './lighting.js';
export * from './lightmap.js';
export * from './smooth-light.js';
export * from './lit-mesh.js';
export * from './orbit-controls.js';
export * from './lit-renderer.js';
export * from './presentation.js';
