/**
 * Stützprüfung hängender Entities (Rahmen, Leuchtrahmen, Gemälde) nach Vanilla `ItemFrame#survives` bzw.
 * `HangingEntity#survives` (1.21.11, im Spiel geprüft: T5 und Gruppe P). Ein Verstoß heißt: Das Spiel entfernt
 * die Entity spätestens nach 100 Ticks – in JEDER Platzierungsart (auch `/place … strict`).
 *
 *  1. Träger: Rahmen – Block hinter der Fläche `isSolid` (seitlich auch Verstärker/Komparator);
 *     Gemälde – alle Blöcke hinter der Bildfläche `isSolid` oder Diode.
 *  2. Freiraum (`level.noCollision(entity)`): Die Box der Entity (Rahmen 12/16 × 12/16 × 1/16 an der Fläche,
 *     Gemälde volle Breite × Höhe × 1/16) darf keine Block-Kollision schneiden. Wichtigster Fall: Zaun, Mauer oder
 *     Zauntor DARUNTER ragen 1/2 Block in die Zelle – ein Zaunarm zur Wand trifft einen Rahmen direkt darüber, und
 *     ein Rahmen liegend auf einem Zaun hat keinen Platz.
 *  3. Keine Überlappung mit einer anderen hängenden Entity.
 */
import { opposite, rotateDir, type Dir, type HorizontalDir, type Vec3 } from '@mcda/core';
import type { NbtCompound } from '@mcda/export';
import type { VoxelEntity } from '@mcda/voxel';
import type { Violation } from './types.js';
import { isDiode, isSolid } from './vanilla.js';
import { DIR_OFFSET, step, type CellInfo, type WorldView } from './world.js';

/** Achsenparallele Box in Weltkoordinaten (Blöcke). */
export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

const EPS = 1e-7;
const H4: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];
const FRAME_FACING: readonly Dir[] = ['down', 'up', 'north', 'south', 'west', 'east'];
/** Gemälde-NBT `facing` (2D-Datenwert): 0 = Süd, 1 = West, 2 = Nord, 3 = Ost. */
const PAINTING_FACING: readonly HorizontalDir[] = ['south', 'west', 'north', 'east'];

/**
 * Größen (Breite × Höhe) der Vanilla-Gemälde 1.21.11 (`data/minecraft/painting_variant`). Unbekannte Varianten
 * werden als Verstoß gemeldet (Größe unbekannt → Stütze nicht prüfbar).
 */
export const PAINTING_SIZES: Readonly<Record<string, readonly [number, number]>> = {
  kebab: [1, 1], aztec: [1, 1], alban: [1, 1], aztec2: [1, 1], bomb: [1, 1], plant: [1, 1], wasteland: [1, 1], meditative: [1, 1],
  pool: [2, 1], courbet: [2, 1], sea: [2, 1], sunset: [2, 1], creebet: [2, 1],
  wanderer: [1, 2], graham: [1, 2], prairie_ride: [1, 2],
  match: [2, 2], bust: [2, 2], stage: [2, 2], void: [2, 2], skull_and_roses: [2, 2], wither: [2, 2], baroque: [2, 2],
  humble: [2, 2], earth: [2, 2], wind: [2, 2], water: [2, 2], fire: [2, 2],
  fighters: [4, 2], changing: [4, 2], finding: [4, 2], lowmist: [4, 2], passage: [4, 2],
  skeleton: [4, 3], donkey_kong: [4, 3],
  bouquet: [3, 3], cavebird: [3, 3], cotan: [3, 3], endboss: [3, 3], fern: [3, 3], owlemons: [3, 3], sunflowers: [3, 3], tides: [3, 3], dennis: [3, 3],
  backyard: [3, 4], pond: [3, 4],
  pointer: [4, 4], pigscene: [4, 4], burning_skull: [4, 4], orb: [4, 4], unpacked: [4, 4],
};

export function boxesIntersect(a: Box, b: Box): boolean {
  for (let k = 0; k < 3; k++) if (a.min[k]! >= b.max[k]! - EPS || b.min[k]! >= a.max[k]! - EPS) return false;
  return true;
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box {
  return { min: [x0, y0, z0], max: [x1, y1, z1] };
}

const px = (v: number): number => v / 16;

/**
 * Kollisionsboxen eines Blocks in Zellkoordinaten (0..1, Zaun/Mauer/Tor bis 1,5). Genau für Zaun, Mauer, Zauntor,
 * Glasscheibe/Gitter und Teppich; sonst konservativ: Hüllquader aus Physik-Klasse und Höhe.
 */
export function collisionBoxes(info: CellInfo): Box[] {
  const { state: s, kind, phys } = info;
  const p = s.properties;
  if (phys.cls === 'air' || phys.cls === 'thin') return [];
  const arms = (half: number, h: number, connected: (d: HorizontalDir) => boolean): Box[] => {
    const lo = px(8 - half), hi = px(8 + half);
    const out: Box[] = [];
    if (connected('north')) out.push(box(lo, 0, 0, hi, h, hi));
    if (connected('south')) out.push(box(lo, 0, lo, hi, h, 1));
    if (connected('west')) out.push(box(0, 0, lo, hi, h, hi));
    if (connected('east')) out.push(box(lo, 0, lo, 1, h, hi));
    return out;
  };
  switch (kind) {
    case 'fence': // FenceBlock: makeShapes(2, 2, 24, 0, 24)
      return [box(px(6), 0, px(6), px(10), 1.5, px(10)), ...arms(2, 1.5, (d) => p[d] === 'true')];
    case 'pane': // IronBarsBlock (Kollision): Pfosten 7..9 + Arme
      return [box(px(7), 0, px(7), px(9), 1, px(9)), ...arms(1, 1, (d) => p[d] === 'true')];
    case 'wall': // WallBlock: makeShapes(4, 3, 24, 0, 24, 24)
      return [...(p['up'] === 'true' ? [box(px(4), 0, px(4), px(12), 1.5, px(12))] : []), ...arms(3, 1.5, (d) => (p[d] ?? 'none') !== 'none')];
    case 'fence_gate': {
      if (p['open'] === 'true') return [];
      const f = p['facing'];
      return f === 'north' || f === 'south' ? [box(0, 0, px(6), 1, 1.5, px(10))] : [box(px(6), 0, 0, px(10), 1.5, 1)];
    }
    case 'lantern':
    case 'candle':
      return [box(px(4), 0, px(4), px(12), Math.max(phys.h, px(1)), px(12))];
    default:
      // kleine, mittige Formen (Blumentopf, Kopf): Vanilla 5..11 bzw. 4..12
      if (s.name === 'flower_pot' || s.name.startsWith('potted_') || ((s.name.endsWith('_head') || s.name.endsWith('_skull')) && s.name !== 'piston_head')) {
        return [box(px(4), 0, px(4), px(12), Math.max(phys.h, px(1)), px(12))];
      }
      if (phys.cls === 'flat') return [box(0, 0, 0, 1, Math.max(phys.h, px(1)), 1)];
      return [box(0, 0, 0, 1, Math.min(Math.max(phys.h, px(1)), 1.5), 1)];
  }
}

/** Kollisionsboxen des Blocks bei `pos` in Weltkoordinaten. */
function worldBoxes(view: WorldView, pos: Vec3): Box[] {
  return collisionBoxes(view.info(pos)).map((b) => ({
    min: [pos[0] + b.min[0], pos[1] + b.min[1], pos[2] + b.min[2]],
    max: [pos[0] + b.max[0], pos[1] + b.max[1], pos[2] + b.max[2]],
  }));
}

/** ItemFrame#calculateBoundingBox: 12/16 breit, 1/16 dick, an der Fläche gegenüber `facing`. */
export function frameBox(blockPos: Vec3, facing: Dir): Box {
  const c: Vec3 = [blockPos[0] + 0.5, blockPos[1] + 0.5, blockPos[2] + 0.5];
  const o = DIR_OFFSET[facing];
  const center: Vec3 = [c[0] - o[0] * 0.46875, c[1] - o[1] * 0.46875, c[2] - o[2] * 0.46875];
  const size: Vec3 = [o[0] !== 0 ? 0.0625 : 0.75, o[1] !== 0 ? 0.0625 : 0.75, o[2] !== 0 ? 0.0625 : 0.75];
  return { min: [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2], max: [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2] };
}

/** Von einem Gemälde belegte Zellen (Painting: gerade Größen um +½ Richtung CCW(facing) bzw. nach oben versetzt). */
export function paintingCells(anchor: Vec3, facing: HorizontalDir, w: number, h: number): Vec3[] {
  const ccw = DIR_OFFSET[rotateDir(facing, -1)];
  const out: Vec3[] = [];
  for (let i = -Math.floor((w - 1) / 2); i <= Math.floor(w / 2); i++) {
    for (let j = -Math.floor((h - 1) / 2); j <= Math.floor(h / 2); j++) out.push([anchor[0] + ccw[0] * i, anchor[1] + j, anchor[2] + ccw[2] * i]);
  }
  return out;
}

/** Painting#calculateBoundingBox: volle Bildfläche, 1/16 dick an der Wand. */
export function paintingBox(cells: readonly Vec3[], facing: HorizontalDir): Box {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const c of cells) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k]!, c[k]!);
    max[k] = Math.max(max[k]!, c[k]! + 1);
  }
  const o = DIR_OFFSET[facing];
  // an der Wandseite (gegenüber facing) nur 1/16 tief
  for (let k = 0; k < 3; k += 2) {
    if (o[k] === 1) max[k] = min[k]! + 0.0625;
    if (o[k] === -1) min[k] = max[k]! - 0.0625;
  }
  return { min, max };
}

interface Hanging {
  readonly entity: VoxelEntity;
  readonly type: 'item_frame' | 'glow_item_frame' | 'painting';
  readonly facing: Dir;
  readonly cells: readonly Vec3[];
  readonly box: Box;
  readonly label: string;
}

function tagValue(nbt: NbtCompound, key: string): unknown {
  const t = (nbt.value as Record<string, { value: unknown } | undefined>)[key];
  return t?.value;
}

function describe(e: VoxelEntity): Hanging | string | undefined {
  const id = String(tagValue(e.nbt, 'id') ?? '').replace(/^minecraft:/, '');
  if (id === 'item_frame' || id === 'glow_item_frame') {
    const f = FRAME_FACING[Number(tagValue(e.nbt, 'Facing'))];
    if (f === undefined) return `${id} bei ${e.blockPos.join(',')} ohne gültiges Facing`;
    return { entity: e, type: id, facing: f, cells: [e.blockPos], box: frameBox(e.blockPos, f), label: id === 'item_frame' ? 'Rahmen' : 'Leuchtrahmen' };
  }
  if (id === 'painting') {
    const f = PAINTING_FACING[Number(tagValue(e.nbt, 'facing'))];
    const variant = String(tagValue(e.nbt, 'variant') ?? '').replace(/^minecraft:/, '');
    const size = Object.hasOwn(PAINTING_SIZES, variant) ? PAINTING_SIZES[variant] : undefined;
    if (f === undefined) return `Gemälde bei ${e.blockPos.join(',')} ohne gültiges facing`;
    if (size === undefined) return `Gemälde '${variant}' bei ${e.blockPos.join(',')}: Größe unbekannt, Stütze nicht prüfbar`;
    const cells = paintingCells(e.blockPos, f, size[0], size[1]);
    return { entity: e, type: 'painting', facing: f, cells, box: paintingBox(cells, f), label: `Gemälde '${variant}'` };
  }
  return undefined;
}

/** Hängende Entities: Träger (isSolid), Freiraum (Kollision) und Überlappung. Violation `entity_support`. */
export function checkHangingEntities(view: WorldView): Violation[] {
  const out: Violation[] = [];
  const hangings: Hanging[] = [];
  const report = (e: VoxelEntity, message: string): void => {
    out.push({ kind: 'entity_support', severity: 'error', pos: e.blockPos, owner: e.owner, message });
  };
  for (const e of view.volume.entities()) {
    const h = describe(e);
    if (h === undefined) continue;
    if (typeof h === 'string') {
      report(e, h);
      continue;
    }
    hangings.push(h);
    const behind = opposite(h.facing);
    const where = `${h.label} bei ${e.blockPos.join(',')} (Blick ${h.facing})`;
    // 1. Träger
    for (const c of h.cells) {
      const q = step(c, behind);
      const n = view.info(q);
      const diodeOk = isDiode(n.state) && (h.type === 'painting' || H4.includes(h.facing as HorizontalDir));
      if (!isSolid(n) && !diodeOk) {
        report(e, `${where}: Träger ${n.state.name} bei ${q.join(',')} ist nicht „fest“ (isSolid) – fällt im Spiel ab`);
        break;
      }
    }
    // 2. Freiraum: eigene Zellen und die Zellen darunter (Zaun/Mauer/Tor ragen 1/2 Block hoch)
    const probe = new Map<string, Vec3>();
    for (const c of h.cells) for (const q of [c, step(c, 'down')]) probe.set(q.join(','), q);
    let hit: string | undefined;
    for (const q of probe.values()) {
      if (worldBoxes(view, q).some((b) => boxesIntersect(b, h.box))) {
        hit = `${view.state(q).name} bei ${q.join(',')}`;
        break;
      }
    }
    if (hit !== undefined) report(e, `${where}: Kollision mit ${hit} – kein Platz, fällt im Spiel ab`);
  }
  // 3. Überlappung
  for (let i = 0; i < hangings.length; i++) {
    for (let j = i + 1; j < hangings.length; j++) {
      const a = hangings[i]!, b = hangings[j]!;
      if (boxesIntersect(a.box, b.box)) {
        report(b.entity, `${b.label} bei ${b.entity.blockPos.join(',')} überlappt ${a.label} bei ${a.entity.blockPos.join(',')} – eine von beiden fällt ab`);
      }
    }
  }
  return out;
}
