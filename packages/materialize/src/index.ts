/**
 * @mcda/materialize – unterstützender Kontext „Materialisierung“ (Domain Design §2.1):
 * Theme → Blöcke, semantische Ausrichtung → States, Autotiling, Physik, Licht → VoxelVolume.
 * Rein, ohne I/O; Plattform-Daten kommen über `PlatformView` (Port `PlatformData`).
 */
export * from './types.js';
export * from './kinds.js';
export * from './theme-resolve.js';
export * from './orient.js';
export * from './world.js';
export * from './autotile.js';
export * from './physics.js';
export * from './redstone.js';
export * from './vanilla.js';
export * from './hanging.js';
export * from './light.js';
export * from './contents.js';
export * from './shell-shapes.js';
export * from './context.js';
export * from './surfaces.js';
export * from './timber.js';
export * from './studs.js';
export * from './weathering.js';
export * from './story.js';
export * from './snow.js';
export * from './narrative-weathering.js';
export * from './surface-texture.js';
export * from './surface-relief.js';
export * from './ruin.js';
export * from './turf.js';
export * from './lining.js';
export { materialize, finalizeState } from './materialize.js';
export * from './attributes.js';
export * from './banned.js';
export * from './pinwheel-guard.js';
