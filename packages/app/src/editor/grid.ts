/** Reine Hilfen für den 2D-Editor (Raster, Umrisse, Drag-Gesten). */
import type { ShellDoor, ShellWindow } from '@mcda/blueprint';
import type { Cell, CellSet } from '@mcda/core';
import type { Rect } from '../usecases.js';

/** Werkzeuge im Grundriss; „stairs“ setzt Treppen (Klick) bzw. entfernt sie (rechte Maustaste). */
export type Tool = 'paint' | 'erase' | 'select' | 'stairs';

/** Rasterzelle unter einem Punkt (Pixel relativ zur Zeichenfläche, beliebig skaliert). */
export function cellAt(px: number, py: number, widthPx: number, heightPx: number, grid: { width: number; depth: number }): Cell | undefined {
  if (widthPx <= 0 || heightPx <= 0) return undefined;
  const x = Math.floor((px / widthPx) * grid.width);
  const z = Math.floor((py / heightPx) * grid.depth);
  return x < 0 || z < 0 || x >= grid.width || z >= grid.depth ? undefined : [x, z];
}

/** Sichtbarer Ausschnitt des Grundrisses in Zellen (Seitenverhältnis wie das Raster, 4 : 3). */
export interface PlanWindow {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly d: number;
}

/**
 * Ausschnitt des Grundrisses auf das Haus eingepasst (W2-ED U3; vorher füllte das Haus 10–25 % des 40 × 30-Rasters):
 * Hülle aller Räume ALLER Etagen (der Ausschnitt springt beim Etagenwechsel nicht) plus `margin` Zellen Rand zum
 * Anbauen, im Seitenverhältnis des Rasters, mindestens `minWidth` breit, ins Raster geklemmt. Ohne Räume: das ganze
 * Raster. Rein und deterministisch.
 */
export function planWindow(cells: Iterable<Cell>, grid: { width: number; depth: number }, margin = 4, minWidth = 16): PlanWindow {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of cells) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const full: PlanWindow = { x0: 0, z0: 0, w: grid.width, d: grid.depth };
  if (minX === Infinity) return full;
  const g = gcd(grid.width, grid.depth);
  const [aw, ad] = [grid.width / g, grid.depth / g]; // 4 : 3
  const w0 = maxX - minX + 1 + 2 * margin;
  const d0 = maxZ - minZ + 1 + 2 * margin;
  const k = Math.min(g, Math.max(Math.ceil(w0 / aw), Math.ceil(d0 / ad), Math.ceil(minWidth / aw)));
  const w = aw * k;
  const d = ad * k;
  if (w >= grid.width) return full;
  const cx = (minX + maxX + 1) / 2;
  const cz = (minZ + maxZ + 1) / 2;
  const clamp = (v: number, hi: number): number => Math.max(0, Math.min(hi, v));
  return { x0: clamp(Math.round(cx - w / 2), grid.width - w), z0: clamp(Math.round(cz - d / 2), grid.depth - d), w, d };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Kante des umschließenden Rechtecks eines Raums (Anfasser im Grundriss, W2-ED U4). */
export type RoomEdge = 'north' | 'east' | 'south' | 'west';

/**
 * Welche Kante liegt am Punkt (fx, fz) in Zellkoordinaten (Bruchteile erlaubt)? Innerhalb `tol` Zellen von der Kante
 * und auf ihrer Länge. `undefined` = keine. Ecken zählen zur waagrechten Kante (Nord/Süd).
 */
export function edgeAt(cells: CellSet, fx: number, fz: number, tol = 0.45): RoomEdge | undefined {
  const b = cells.bounds();
  if (b === undefined) return undefined;
  const inX = fx >= b.minX - tol && fx <= b.maxX + 1 + tol;
  const inZ = fz >= b.minZ - tol && fz <= b.maxZ + 1 + tol;
  if (inX && Math.abs(fz - b.minZ) <= tol) return 'north';
  if (inX && Math.abs(fz - (b.maxZ + 1)) <= tol) return 'south';
  if (inZ && Math.abs(fx - b.minX) <= tol) return 'west';
  if (inZ && Math.abs(fx - (b.maxX + 1)) <= tol) return 'east';
  return undefined;
}

/**
 * Kante eines Raums auf die Zeile/Spalte `to` ziehen (W2-ED U4): nach außen wächst jede Reihe, die an die Kante
 * stößt, um die Zellen bis `to`; nach innen fallen alle Zellen jenseits von `to` weg. `to` ist die neue äußerste
 * Zelle (Ost: größtes x, West: kleinstes x, Süd: größtes z, Nord: kleinstes z) und wird so begrenzt, dass mindestens
 * eine Reihe bleibt. Rein; Ergebnis für `Project.resizeRoom`.
 */
export function resizeByEdge(cells: CellSet, edge: RoomEdge, to: number): { readonly add: Cell[]; readonly remove: Cell[] } {
  const b = cells.bounds();
  if (b === undefined) return { add: [], remove: [] };
  const add: Cell[] = [];
  const remove: Cell[] = [];
  const horizontal = edge === 'east' || edge === 'west';
  const lo = horizontal ? b.minX : b.minZ;
  const hi = horizontal ? b.maxX : b.maxZ;
  const outward = edge === 'east' || edge === 'south';
  const cur = outward ? hi : lo;
  const target = outward ? Math.max(lo, to) : Math.min(hi, to);
  const at = (u: number, v: number): Cell => (horizontal ? [u, v] : [v, u]);
  const has = (u: number, v: number): boolean => cells.has(...at(u, v));
  const [vLo, vHi] = horizontal ? [b.minZ, b.maxZ] : [b.minX, b.maxX];
  if (outward ? target > cur : target < cur) {
    for (let v = vLo; v <= vHi; v++) {
      if (!has(cur, v)) continue;
      for (let u = outward ? cur + 1 : cur - 1; outward ? u <= target : u >= target; u += outward ? 1 : -1) add.push(at(u, v));
    }
  } else if (outward ? target < cur : target > cur) {
    for (const [x, z] of cells) {
      const u = horizontal ? x : z;
      if (outward ? u > target : u < target) remove.push([x, z]);
    }
  }
  return { add, remove };
}

/** Kante einer Zelle an einer Raumgrenze: [x1, z1, x2, z2] in Rasterkoordinaten (Zellecken). */
export type Segment = readonly [number, number, number, number];

/** Umriss einer Zellmenge als Kantensegmente (jede Zellkante zu einer Nicht-Raum-Zelle). */
export function outline(cells: CellSet): Segment[] {
  const out: Segment[] = [];
  for (const [x, z] of cells) {
    if (!cells.has(x, z - 1)) out.push([x, z, x + 1, z]);
    if (!cells.has(x, z + 1)) out.push([x, z + 1, x + 1, z + 1]);
    if (!cells.has(x - 1, z)) out.push([x, z, x, z + 1]);
    if (!cells.has(x + 1, z)) out.push([x + 1, z, x + 1, z + 1]);
  }
  return out;
}

const STEP = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;

/** Zelle der Tür bzw. des Fensters selbst (von der Innenzelle einen Schritt in Richtung `toward`). */
export function openingCell(o: ShellDoor | ShellWindow): Cell {
  const s = STEP[o.toward];
  return [o.inside[0] + s[0], o.inside[1] + s[1]];
}

/**
 * Was eine abgeschlossene Geste bedeutet.
 * Klick ohne Ziehen wählt aus (im Radier-Modus: radiert die Zelle); Ziehen malt bzw. radiert das Rechteck.
 * Die rechte Maustaste radiert in jedem Modus – außer im Treppen-Werkzeug: Dort setzt links die Treppe an der
 * Zelle unter dem Mauszeiger (wo der Geist steht) und rechts entfernt eine Treppe.
 */
export type Gesture =
  | { kind: 'select'; cell: Cell }
  | { kind: 'paint'; rect: Rect }
  | { kind: 'erase'; rect: Rect }
  | { kind: 'placeStairs'; cell: Cell }
  | { kind: 'removeStairs'; cell: Cell }
  | { kind: 'none' };

/**
 * Review 3: „1×1-Raum stillschweigend verworfen“ – ein Klick ohne Ziehen **wählt aus** (siehe
 * `interpretGesture`), ein 1×1-Raum lässt sich also nur über ein Rechteck malen. Statt still nichts zu tun,
 * sagt die App im Mal-Modus jetzt, warum: ein Klick auf eine leere Zelle bekommt diesen Hinweis.
 */
export function clickNote(tool: Tool, cellHasRoom: boolean): string | undefined {
  if (cellHasRoom || tool !== 'paint') return undefined;
  return 'Ein Klick wählt nur aus – für einen Raum ein Rechteck aufziehen (mindestens 1 Zelle breit)';
}

export function interpretGesture(tool: Tool, button: 'left' | 'right', start: Cell, end: Cell): Gesture {
  const rect: Rect = { x1: start[0], z1: start[1], x2: end[0], z2: end[1] };
  const click = start[0] === end[0] && start[1] === end[1];
  if (tool === 'stairs') return button === 'right' ? { kind: 'removeStairs', cell: end } : { kind: 'placeStairs', cell: end };
  if (button === 'right' || tool === 'erase') return { kind: 'erase', rect };
  if (tool === 'select' || click) return { kind: 'select', cell: end };
  return { kind: 'paint', rect };
}
