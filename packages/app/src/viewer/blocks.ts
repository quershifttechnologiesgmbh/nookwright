/**
 * „Vorschau: Blöcke“ als reine Daten: materialisiertes VoxelVolume → Quader mit Farbe und Blockname
 * (der Viewer legt darüber die eigenen Pixeltexturen aus pixelTextures.ts).
 * Farbe aus dem Blocknamen (blockColors.ts), grobe Form aus Name + Block-State (Stufe, Treppe, Tür, Scheibe …).
 * Die Schicht (Boden/Wand/Decke/Möbel/Licht) kommt aus der Hülle bzw. dem Licht-Bericht, damit die
 * Ansichten „Dach ab“ und „Wände ab“ wie in der Rollen-Vorschau funktionieren.
 */
import { key3 } from '@mcda/core';
import type { World } from '@mcda/pipeline';
import { isAir, type BlockState } from '@mcda/voxel';
import { blockLook } from '../blockColors.js';
import { FULL, SHELL_LAYER, box, centered, exteriorLayer, voxel, type PreviewVoxel, type UnitBox, type VoxelLayer } from './voxels.js';

const PX = 1 / 16;

/** Dünne Platte an der Blockkante, zu der eine Tür/Falltür (geschlossen bzw. offen) laut `facing` liegt. */
function edgePlate(facing: string | undefined, t = 3 * PX): UnitBox {
  switch (facing) {
    case 'north': return box(0, 0, 1 - t, 1, 1, 1);
    case 'south': return box(0, 0, 0, 1, 1, t);
    case 'east': return box(0, 0, 0, t, 1, 1);
    case 'west': return box(1 - t, 0, 0, 1, 1, 1);
    default: return box(0, 0, 0.5 - t / 2, 1, 1, 0.5 + t / 2);
  }
}

/** Mittelpfosten + Arme in die verbundenen Richtungen (Glasscheibe, Gitter, Zaun). */
function postWithArms(p: Readonly<Record<string, string>>, post: number, arm: number, y0: number, y1: number, armY0: number, armY1: number): UnitBox[] {
  const lo = 0.5 - arm / 2;
  const hi = 0.5 + arm / 2;
  const out: UnitBox[] = [centered(post, y0, y1)];
  if (p['north'] === 'true') out.push(box(lo, armY0, 0, hi, armY1, 0.5));
  if (p['south'] === 'true') out.push(box(lo, armY0, 0.5, hi, armY1, 1));
  if (p['east'] === 'true') out.push(box(0.5, armY0, lo, 1, armY1, hi));
  if (p['west'] === 'true') out.push(box(0, armY0, lo, 0.5, armY1, hi));
  return out;
}

/** Grobe Form eines Blocks (ein oder mehrere Teilquader im Einheitswürfel). */
export function blockBoxes(state: BlockState): UnitBox[] {
  const n = state.name;
  const p = state.properties;
  if (n.endsWith('_slab')) return [p['type'] === 'double' ? FULL : p['type'] === 'top' ? box(0, 0.5, 0, 1, 1, 1) : box(0, 0, 0, 1, 0.5, 1)];
  if (n.endsWith('_stairs')) {
    const top = p['half'] === 'top';
    const [y0, y1] = top ? [0, 0.5] : [0.5, 1];
    const step: Record<string, UnitBox> = {
      north: box(0, y0, 0, 1, y1, 0.5),
      south: box(0, y0, 0.5, 1, y1, 1),
      east: box(0.5, y0, 0, 1, y1, 1),
      west: box(0, y0, 0, 0.5, y1, 1),
    };
    return [top ? box(0, 0.5, 0, 1, 1, 1) : box(0, 0, 0, 1, 0.5, 1), step[p['facing'] ?? 'north'] ?? step['north']!];
  }
  if (n.endsWith('carpet')) return [box(0, 0, 0, 1, PX, 1)];
  if (n.endsWith('_pressure_plate')) return [centered(14 * PX, 0, PX)];
  if (n.endsWith('_trapdoor')) {
    if (p['open'] === 'true') return [edgePlate(p['facing'])];
    return [p['half'] === 'top' ? box(0, 1 - 3 * PX, 0, 1, 1, 1) : box(0, 0, 0, 1, 3 * PX, 1)];
  }
  if (n.endsWith('_door')) return [edgePlate(p['facing'])];
  if (n.endsWith('_fence_gate')) {
    const f = p['facing'];
    return [f === 'east' || f === 'west' ? box(0.4375, 0.3, 0, 0.5625, 1, 1) : box(0, 0.3, 0.4375, 1, 1, 0.5625)];
  }
  if (n.endsWith('_fence')) return postWithArms(p, 0.25, 2 * PX, 0, 1, 6 * PX, 15 * PX);
  if (n.endsWith('_pane') || n === 'iron_bars') return postWithArms(p, 2 * PX, 2 * PX, 0, 1, 0, 1);
  if (n.endsWith('_wall')) return [centered(0.5, 0, 1)];
  if (n.endsWith('_bed')) return [box(0, 0, 0, 1, 9 * PX, 1)];
  if (n.endsWith('lantern') && n !== 'sea_lantern' && n !== 'jack_o_lantern') {
    return [p['hanging'] === 'true' ? centered(6 * PX, PX, 10 * PX) : centered(6 * PX, 0, 9 * PX)];
  }
  if (n.endsWith('torch')) return [centered(0.15, 0.2, 0.85)];
  if (n === 'candle' || n.endsWith('_candle')) return [centered(0.25, 0, 0.4)];
  if (n === 'chain' || n === 'iron_chain') {
    const a = p['axis'];
    return [a === 'x' ? box(0, 0.4, 0.4, 1, 0.6, 0.6) : a === 'z' ? box(0.4, 0.4, 0, 0.6, 0.6, 1) : centered(3 * PX, 0, 1)];
  }
  if (n === 'flower_pot' || n.startsWith('potted_')) return [centered(6 * PX, 0, 0.5)];
  if (n === 'cake' || n.endsWith('candle_cake')) return [centered(14 * PX, 0, 0.5)];
  if (n === 'chest' || n === 'trapped_chest' || n === 'ender_chest') return [centered(14 * PX, 0, 14 * PX)];
  if (n === 'enchanting_table') return [box(0, 0, 0, 1, 0.75, 1)];
  if (n === 'ladder') return [edgePlate(p['facing'], 2 * PX)];
  if (n.endsWith('_button') || n === 'lever' || n.endsWith('_sign') || n.endsWith('_banner')) return [centered(0.35, 0.25, 0.75)];
  return [FULL];
}

/** Schicht je Zelle der Außen-Deko (`exteriorLayer`), damit sie mit Dach bzw. Wänden ausgeblendet wird. */
export function exteriorLayers(world: World): ReadonlyMap<string, VoxelLayer> {
  const out = new Map<string, VoxelLayer>();
  for (const p of world.exterior ?? []) for (const c of p.cells) out.set(key3(c), exteriorLayer(p.group));
  return out;
}

/** Alle Quader der Block-Vorschau aus dem materialisierten Volumen. */
export function buildBlockVoxels(world: World): PreviewVoxel[] {
  const shellKind = new Map(world.shell.cells.map((c) => [key3(c.pos), c.kind] as const));
  const outside = exteriorLayers(world);
  const emitters = new Set(world.materialized.light.emitters.map((e) => key3(e.pos)));
  const out: PreviewVoxel[] = [];
  for (const cell of world.materialized.volume.cells()) {
    if (isAir(cell.state)) continue;
    const l = blockLook(cell.state.name);
    if (l.rule === 'invisible') continue;
    const k = key3(cell.pos);
    const kind = shellKind.get(k);
    const layer: VoxelLayer = outside.get(k) ?? (l.glow || emitters.has(k) ? 'light' : kind !== undefined ? SHELL_LAYER[kind] : 'furniture');
    for (const b of blockBoxes(cell.state)) out.push({ ...voxel(cell.pos, b, l.color, layer, cell.owner), block: cell.state.name });
  }
  return out;
}
