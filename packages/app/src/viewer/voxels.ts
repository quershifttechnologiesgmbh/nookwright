/**
 * Szenenaufbau der 3D-Vorschau als reine Daten: Hülle + Möbel → farbige Quader.
 * Keine three.js-Abhängigkeit, damit es in Node testbar ist. Koordinaten wie Minecraft/three:
 * x = Ost, y = oben, z = Süd; Block (x, y, z) belegt den Würfel [x, x+1] × [y, y+1] × [z, z+1].
 */
import type { Shell, ShellCell, ShellKind } from '@mcda/blueprint';
import type { MaterialSpec } from '@mcda/catalog';
import type { ExteriorGroup } from '@mcda/pipeline';
import { blockFamily, isLightMaterial, materialColor, roleColor, type Rgb } from '../colors.js';
import { EXTERIOR_ROOF_GROUPS, type ExteriorView, type PlacedView } from '../usecases.js';

export type VoxelLayer = 'floor' | 'wall' | 'ceiling' | 'furniture' | 'light';
export const LAYERS: readonly VoxelLayer[] = ['floor', 'wall', 'ceiling', 'furniture', 'light'];

/** Ansicht der Vorschau: alles, ohne Decke („Dach ab“) oder nur Boden und Möbel (Wände ausgeblendet). */
export type ViewMode = 'full' | 'noRoof' | 'floorOnly';

export function layerVisible(layer: VoxelLayer, view: ViewMode): boolean {
  if (layer === 'ceiling') return view === 'full';
  if (layer === 'wall') return view !== 'floorOnly';
  return true;
}

export interface PreviewVoxel {
  /** Mittelpunkt in Weltkoordinaten. */
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly color: Rgb;
  readonly layer: VoxelLayer;
  /** Herkunft wie im VoxelVolume: Platzierungs-ID (Möbel) oder `shell:<Raum>` (Hülle) – für die Auswahl per Klick. */
  readonly owner?: string;
  /** Nur „Vorschau: Blöcke“: Minecraft-Blockname → eigene Pixeltextur (pixelTextures.ts) statt Flächenfarbe. */
  readonly block?: string;
}

/** Teilquader innerhalb eines Blocks (0–1 je Achse). */
export interface UnitBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export const FULL: UnitBox = { min: [0, 0, 0], max: [1, 1, 1] };
export const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): UnitBox => ({ min: [x0, y0, z0], max: [x1, y1, z1] });
export const centered = (w: number, y0: number, y1: number): UnitBox => box(0.5 - w / 2, y0, 0.5 - w / 2, 0.5 + w / 2, y1, 0.5 + w / 2);

/** Grobe Form eines Katalog-Materials, damit Tische, Laternen und Betten nicht wie volle Würfel aussehen. */
export function materialBox(mat: MaterialSpec): UnitBox {
  const shape = mat.shape ?? (mat.block !== undefined ? blockFamily(mat.block) : '');
  switch (shape) {
    case 'slab':
      return mat.orient?.upsideDown === true ? box(0, 0.5, 0, 1, 1, 1) : box(0, 0, 0, 1, 0.5, 1);
    case 'fence':
      return centered(0.25, 0, 1);
    case 'pressure_plate':
      return centered(0.875, 0, 0.0625);
    case 'carpet':
      return box(0, 0, 0, 1, 0.0625, 1);
    case 'bed':
      return box(0, 0, 0, 1, 0.5625, 1);
    case 'lantern':
      return mat.orient?.hanging === true ? centered(0.375, 0.0625, 0.625) : centered(0.375, 0, 0.5625);
    case 'chain':
      return centered(0.1875, 0, 1);
    case 'candle':
      return centered(0.25, 0, 0.4);
    case 'wall_torch':
    case 'torch':
      return centered(0.15, 0.2, 0.85);
    case 'cake':
      return centered(0.875, 0, 0.5);
    default:
      return shape.startsWith('potted_') ? centered(0.375, 0, 0.5) : FULL;
  }
}

export const SHELL_LAYER: Readonly<Record<ShellKind, VoxelLayer>> = {
  floor: 'floor',
  wall: 'wall',
  pillar: 'wall',
  door: 'wall',
  lintel: 'wall',
  window: 'wall',
  ceiling: 'ceiling',
  roof: 'ceiling',
  // Zellen anderer Kontexte (Gelände, Bauwerke) auf demselben Weg: Gelände bleibt wie der Boden immer sichtbar,
  // Pflanzen wie Möbel, Befestigungen verschwinden mit den Wänden
  terrain: 'floor',
  plant: 'furniture',
  fort: 'wall',
  // Etagen: Treppen und Geländer bleiben wie Möbel in allen Ansichten sichtbar
  stairs: 'furniture',
  railing: 'furniture',
  // Außenprofil (Sockel, Gesims, Konsolen) gehört optisch zur Wand
  facade: 'wall',
};

/**
 * Schicht der Außen-Deko (X1): Dachteile (Schornstein, Traufenlaterne, Firstschmuck) verschwinden mit dem Dach,
 * alles an der Fassade mit den Wänden – sonst schwebten sie in „Dach ab“ bzw. „Wände ab“.
 */
export function exteriorLayer(group: ExteriorGroup): VoxelLayer {
  return EXTERIOR_ROOF_GROUPS.has(group) ? 'ceiling' : 'wall';
}

export function shellBox(c: ShellCell): UnitBox {
  if (c.kind === 'door' || c.kind === 'window') {
    // Türblatt/Scheibe: dünn quer zur Blickrichtung
    const f = c.orient?.facing;
    if (f === 'north' || f === 'south') return box(0, 0, 0.4, 1, 1, 0.6);
    if (f === 'east' || f === 'west') return box(0.4, 0, 0, 0.6, 1, 1);
  }
  // Kleinteile der Bauwerke (O1): Laterne stehend/hängend, Kette, Stab (senkrecht bzw. entlang facing), Glocke
  switch (c.shape) {
    case 'lantern':
      return c.orient?.hanging === true ? centered(0.375, 0.0625, 0.625) : centered(0.375, 0, 0.5625);
    case 'chain':
      return c.orient?.axis === 'x' ? box(0, 0.4, 0.4, 1, 0.6, 0.6) : c.orient?.axis === 'z' ? box(0.4, 0.4, 0, 0.6, 0.6, 1) : centered(0.1875, 0, 1);
    case 'lightning_rod':
    case 'end_rod': {
      const f = c.orient?.facing;
      return f === 'east' || f === 'west' ? box(0, 0.4375, 0.4375, 1, 0.5625, 0.5625)
        : f === 'north' || f === 'south' ? box(0.4375, 0.4375, 0, 0.5625, 0.5625, 1) : centered(0.125, 0, 1);
    }
    case 'bell':
      return c.orient?.attach === 'ceiling' ? centered(0.5, 0.25, 1) : centered(0.5, 0, 0.8125);
    default:
      return FULL;
  }
}

export function voxel(pos: readonly [number, number, number], b: UnitBox, color: Rgb, layer: VoxelLayer, owner?: string): PreviewVoxel {
  return {
    center: [pos[0] + (b.min[0] + b.max[0]) / 2, pos[1] + (b.min[1] + b.max[1]) / 2, pos[2] + (b.min[2] + b.max[2]) / 2],
    size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
    color,
    layer,
    ...(owner !== undefined ? { owner } : {}),
  };
}

/** Alle Quader der Vorschau: Hülle (Boden, Wände, Türen, Decke), die Blockzellen aller Platzierungen und der Außen-Deko. */
export function buildPreviewVoxels(shell: Shell, views: readonly PlacedView[], exterior: readonly ExteriorView[] = []): PreviewVoxel[] {
  const out: PreviewVoxel[] = [];
  // Dachzellen tragen `roof:<Raum>` (W2-ED U3: Klick aufs Dach wählt das Dach, `ROOF_OWNER_PREFIX` in selection.ts)
  for (const c of shell.cells) out.push(voxel(c.pos, shellBox(c), roleColor(c.role), SHELL_LAYER[c.kind], c.roomId === undefined ? undefined : `${c.kind === 'roof' ? 'roof' : 'shell'}:${c.roomId}`));
  for (const v of views) {
    for (const cell of v.placed.cells) {
      const layer: VoxelLayer = isLightMaterial(cell.mat) ? 'light' : 'furniture';
      out.push(voxel(cell.pos, materialBox(cell.mat), materialColor(cell.mat, v.def.category), layer, v.placement.id));
    }
  }
  for (const x of exterior) {
    const layer = exteriorLayer(x.placement.group);
    for (const cell of x.placed.cells) out.push(voxel(cell.pos, materialBox(cell.mat), materialColor(cell.mat, x.def.category), layer, x.placement.id));
  }
  return out;
}

/** Anzahl je Schicht (für Statistik und Tests). */
export function countByLayer(voxels: readonly PreviewVoxel[]): Record<VoxelLayer, number> {
  const n: Record<VoxelLayer, number> = { floor: 0, wall: 0, ceiling: 0, furniture: 0, light: 0 };
  for (const v of voxels) n[v.layer]++;
  return n;
}

// ---------------------------------------------------------------------------------------------- Schnitt

/** Welt-y des Blocks, in dem ein Quader liegt (Unterkante, robust gegen Rundung). */
export function voxelBlockY(v: PreviewVoxel): number {
  return Math.floor(v.center[1] - v.size[1] / 2 + 1e-6);
}

/** Schnitt (Höhe): nur Quader mit Block-y ≤ `maxY` (und ≥ `minY`, Etagen-Ansicht „nur aktive“); `undefined` = offen. */
export function cutVoxels(voxels: readonly PreviewVoxel[], maxY: number | undefined, minY?: number): readonly PreviewVoxel[] {
  if (maxY === undefined && minY === undefined) return voxels;
  return voxels.filter((v) => {
    const y = voxelBlockY(v);
    return (maxY === undefined || y <= maxY) && (minY === undefined || y >= minY);
  });
}

/** Höhenbereich des Schnitt-Reglers: Boden bis oberster Block der Hülle (Dach). */
export function cutRange(shell: Shell): { readonly min: number; readonly max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const c of shell.cells) {
    if (c.pos[1] < min) min = c.pos[1];
    if (c.pos[1] > max) max = c.pos[1];
  }
  return min > max ? { min: 0, max: 0 } : { min, max };
}

/** Reglerwert → Schnitthöhe: ganz oben (über dem Dach) = kein Schnitt. */
export function cutFromSlider(value: number, range: { readonly min: number; readonly max: number }): number | undefined {
  return value > range.max ? undefined : Math.max(range.min, Math.round(value));
}
