/**
 * Geometrie-Hilfen des Generators. Kanonisch liegt die Front im Süden (+z, Straße), die Rückseite im Norden; die
 * Front-Parameter drehen den fertigen Plan (`rotation`). Innerhalb eines Rechtecks rechnet der Generator in
 * Achsen (u, v): u entlang der langen Achse, v quer dazu mit v = 0 an der Treppenwand.
 */
import { CellSet, rotateDir, type Cell, type HorizontalDir } from '@mcda/core';

/** Rechteck, beide Ecken inklusive. */
export interface Box {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

export const boxW = (b: Box): number => b.x1 - b.x0 + 1;
export const boxD = (b: Box): number => b.z1 - b.z0 + 1;
export const boxCells = (b: Box): CellSet => CellSet.rect(b.x0, b.z0, b.x1, b.z1);

/** Achsen eines Rechtecks: u lang, v quer (v = 0 an der Wand `wall`). */
export interface Axes {
  readonly box: Box;
  /** Länge entlang u bzw. Tiefe entlang v. */
  readonly L: number;
  readonly S: number;
  /** u verläuft entlang x (sonst z; dann ist u = 0 die Rückseite). */
  readonly alongX: boolean;
  toXZ(u: number, v: number): Cell;
  /** Richtung von +u bzw. −u. */
  dirU(sign: 1 | -1): HorizontalDir;
}

/**
 * Achsen für `box`. Liegt die lange Seite entlang x, ist v = 0 die Rückwand (Norden); sonst ist u = 0 die Rückseite und
 * v = 0 die West- (`side` 'low') bzw. Ostwand ('high').
 */
export function axesOf(box: Box, side: 'low' | 'high' = 'low'): Axes {
  const alongX = boxW(box) >= boxD(box);
  const L = alongX ? boxW(box) : boxD(box);
  const S = alongX ? boxD(box) : boxW(box);
  const toXZ = (u: number, v: number): Cell =>
    alongX ? [box.x0 + u, box.z0 + v] : side === 'low' ? [box.x0 + v, box.z0 + u] : [box.x1 - v, box.z0 + u];
  const dirU = (s: 1 | -1): HorizontalDir => (alongX ? (s > 0 ? 'east' : 'west') : s > 0 ? 'south' : 'north');
  return { box, L, S, alongX, toXZ, dirU };
}

/** Zellen in (u, v) → (x, z). */
export function uvToXZ(axes: Axes, cells: CellSet): CellSet {
  return CellSet.of(cells.toArray().map(([u, v]) => axes.toXZ(u, v)));
}

/** 8er-Nachbarschaft dazu (Kern-Regel der Treppen: Zelle samt Nachbarn im Raum). */
export function dilate(cells: CellSet): CellSet {
  const out: Cell[] = [];
  for (const [x, z] of cells) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.push([x + dx, z + dz]);
  return CellSet.of(out);
}

/** Vierteldrehungen im Uhrzeigersinn, die die kanonische Front (Süden) nach `front` drehen. */
export const quarterTurns = (front: HorizontalDir): number => ({ south: 0, west: 1, north: 2, east: 3 })[front];

/** Drehung um q Vierteldrehungen im Uhrzeigersinn (von oben, Norden oben): (x, z) → (−z, x). */
export function rotateCell(c: Cell, q: number): Cell {
  let [x, z] = c;
  for (let i = 0; i < ((q % 4) + 4) % 4; i++) [x, z] = [-z, x];
  return [x, z];
}

export const rotateFacing = (d: HorizontalDir, q: number): HorizontalDir => rotateDir(d, q) as HorizontalDir;

/** Zusammenhängende Berührung zweier Zellmengen (Zahl der 4er-Nachbarpaare). */
export function contact(a: CellSet, b: CellSet): number {
  let n = 0;
  for (const [x, z] of a) n += (b.has(x + 1, z) ? 1 : 0) + (b.has(x - 1, z) ? 1 : 0) + (b.has(x, z + 1) ? 1 : 0) + (b.has(x, z - 1) ? 1 : 0);
  return n;
}
