/**
 * Adapter Port `LightRules` (@mcda/viewer, beleuchteter Renderer) → @mcda/materialize: dieselbe Emissionstabelle
 * (`emission`) und dieselbe Flächenregel (`faceBlocksLight`) wie Licht-Pass und Spawn-Report. So stimmt das
 * Blocklicht der Vorschau „Texturen“ mit `materialized.light` überein (Tests: textures.test.ts, viewerLight.test.ts).
 *
 * Einziger Adapter dieser Art im Monorepo (die frühere Kopie in packages/viewer/demo ist mit der Demo entfallen).
 * Lichtmodell nach dem In-Game-Befund T5: Glas, Türen, Falltüren und Teppich leiten Licht; nur Stufen, Treppen und
 * Schnee sperren über ihre Form – für Block- und Himmelslicht gleich.
 */
import { WorldView, emission, faceBlocksLight, isTransparentFull, type PlatformView } from '@mcda/materialize';
import type { LightBlockState, LightRules } from '@mcda/viewer';
import { VoxelVolume } from '@mcda/voxel';

const isGlass = (name: string): boolean => name === 'glass' || name === 'tinted_glass' || name.endsWith('_stained_glass');

export function materializeLightRules(platform: PlatformView): LightRules {
  // WorldView nur für Physik je Zustand und Blockart (das Volumen wird nicht gelesen)
  const view = new WorldView(VoxelVolume.create([1, 1, 1]), platform);
  const opaque = (s: LightBlockState): boolean => view.physicsOf(s).cls === 'full' && !isTransparentFull(s.name);
  const blocksFace = (s: LightBlockState, face: Parameters<typeof faceBlocksLight>[1]): boolean => faceBlocksLight(view.infoOf(s), face);  return {
    emission: (s) => emission(s),
    opaque,
    blocksFace, // gilt auch für Himmelslicht (ohne eigenes `skyBlocksFace`)
    attenuation: (s) => (s.name.endsWith('_leaves') ? 1 : 0),
    // Minecraft `getShadeBrightness`: volle Kollisionsform verdeckt (auch Blätter), Glas nicht
    occludesAo: (s) => view.physicsOf(s).cls === 'full' && !isGlass(s.name),
  };
}
