/**
 * Treppenkern (research/19 §7.3 Schritt 3, research/03 „Treppenkerne zuerst“): alle Treppen eines Baukörpers werden
 * VOR der Raumteilung gelegt; je Etage entsteht eine Kernzone, die ganz in EINEM Raum liegen muss (Treppenzellen samt
 * 8er-Nachbarschaft – die Kern-Regel des Aggregats) und die die Raumteilung nicht zerschneidet.
 *
 * - Gerade Treppen als Wechselstiege entlang der Wand v = 0: gerade Läufe abwechselnd in Spur 1 (+u) und Spur 3 (−u),
 *   Spur 2 dazwischen ist Podest bzw. Geländer. Der Austritt der einen Treppe liegt quer neben dem Antritt der
 *   nächsten; so überschneiden sich reservierte Zellen, Deckenöffnungen und Geländer nie. Kernzone: 5 Spuren tief
 *   (eine Treppe: 3) und Steigung + 4 lang.
 * - Leitern (Turm): abwechselnd an gegenüberliegenden Wänden (Mitte), je 1 Zelle + Zugang.
 */
import { stairLayout, type StairType } from '@mcda/blueprint';
import { CellSet, type Cell, type HorizontalDir } from '@mcda/core';
import { dilate, type Axes } from './frame.js';

export interface CoreFloor {
  readonly index: number;
  readonly height: number;
}

export interface CoreLink {
  /** Untere Etage. */
  readonly floor: number;
  readonly origin: Cell;
  readonly facing: HorizontalDir;
  readonly type: StairType;
}

export interface StairCore {
  readonly links: readonly CoreLink[];
  /** Kernzone je Etage in (u, v): muss ganz in einem Raum liegen. */
  readonly zone: ReadonlyMap<number, CellSet>;
}

/** Richtung in (u, v) als Himmelsrichtung, wenn u = x und v = z gelesen wird (Geometrie ist dreh-/spiegelinvariant). */
const uvDir = (du: number, dv: number): HorizontalDir => (du > 0 ? 'east' : du < 0 ? 'west' : dv > 0 ? 'south' : 'north');

interface UVLink {
  readonly floor: number;
  readonly origin: Cell;
  readonly du: number;
  readonly dv: number;
  readonly type: StairType;
  readonly rise: number;
}

/** Kernzonen je Etage: reservierte Zellen samt 8er-Nachbarschaft (unten Stufen und Antritt, oben Öffnung, oberste Stufe
 * und Austritt), dazu der Leiter-Träger selbst (Wand oder Pfosten). */
function zones(links: readonly UVLink[]): Map<number, CellSet> {
  const out = new Map<number, CellSet>();
  const add = (floor: number, cells: CellSet): void => {
    out.set(floor, (out.get(floor) ?? CellSet.empty()).union(cells));
  };
  for (const l of links) {
    const layout = stairLayout({ type: l.type, origin: l.origin, facing: uvDir(l.du, l.dv) }, l.rise);
    add(l.floor, dilate(CellSet.of([...layout.footprint, layout.bottom.inside])).union(CellSet.of(layout.support !== undefined ? [layout.support] : [])));
    add(l.floor + 1, dilate(CellSet.of([...layout.holes, ...layout.top, layout.arrival.inside])));
  }
  return out;
}

/** Verschiebt die Kette entlang u in den Rahmen; `undefined`, wenn sie nicht hineinpasst. */
function fit(links: readonly UVLink[], axes: Axes, at: 'end' | 'center' | 'any', pick: (lo: number, hi: number) => number): StairCore | undefined {
  const raw = zones(links);
  let uMin = Infinity;
  let uMax = -Infinity;
  for (const z of raw.values()) {
    for (const [u, v] of z) {
      if (v < 0 || v >= axes.S) return undefined;
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
    }
  }
  const lo = -uMin;
  const hi = axes.L - 1 - uMax;
  if (lo > hi) return undefined;
  // Ende: längs x beide Enden (Seed), längs z die Rückseite (u = 0), damit die Straßenseite frei bleibt
  const s = at === 'center' ? Math.round((lo + hi) / 2) : at === 'end' ? (axes.alongX ? (pick(0, 1) === 0 ? lo : hi) : lo) : pick(lo, hi);
  const shift = (c: Cell): Cell => [c[0] + s, c[1]];
  const zone = new Map<number, CellSet>();
  for (const [f, z] of raw) zone.set(f, CellSet.of(z.toArray().map(shift)));
  return {
    links: links.map((l) => {
      const o = shift(l.origin);
      const facing = l.du !== 0 ? axes.dirU(l.du > 0 ? 1 : -1) : undefined;
      return { floor: l.floor, origin: o, facing: facing ?? (l.dv > 0 ? 'south' : 'north'), type: l.type };
    }),
    zone,
  };
}

/**
 * Wechselstiege (gerade Läufe) für die Etagen `floors` (aufsteigend, lückenlos) im Rahmen `axes`. Ergebnis in (u, v)
 * mit Richtungen in (x, z) für die Links – `origin` bleibt in (u, v) und wird vom Aufrufer umgerechnet.
 */
export function switchback(axes: Axes, floors: readonly CoreFloor[], at: 'end' | 'center' | 'any', pick: (lo: number, hi: number) => number): StairCore | undefined {
  const links: UVLink[] = [];
  let access = -1; // u des Antritts-Zugangs der nächsten Treppe
  for (let k = 0; k + 1 < floors.length; k++) {
    const rise = floors[k]!.height + 1;
    const du = k % 2 === 0 ? 1 : -1;
    const origin: Cell = [access + du, k % 2 === 0 ? 1 : 3];
    links.push({ floor: floors[k]!.index, origin, du, dv: 0, type: 'straight', rise });
    access = origin[0] + du * rise; // Austritt dieser = Antritt der nächsten (quer daneben)
  }
  return links.length === 0 ? { links: [], zone: new Map() } : fit(links, axes, at, pick);
}

/**
 * Fensterachsen einer Turmwand (W7-B): `back` = Wand v = 0, `front` = Wand v = S − 1, je Etage in u (Achsen des
 * Fassadenrasters, `LayoutGrid.back`/`front`).
 */
export type WallAxes = (floor: number, side: 'back' | 'front') => readonly (readonly number[])[];

/**
 * Leitern im Turm: abwechselnd an der Wand v = 0 und v = S − 1, in der Mitte von u.
 * W7-B (Baustandard F1, plan/spikes/W7B_burg.md): mit `wallAxes` steht die Leiter nie auf einer Fensterachse ihrer Wand –
 * die Hülle ließe das Feld sonst blind (Leiter-Träger), und das Geschoss hätte auf dieser Seite kein Fenster, das darüber
 * und darunter aber schon. Liegt die Mitte auf einer Achse, rückt die Leiter zur nächsten Spalte, die weder Achse noch
 * Nachbar einer Achse ist (sonst die nächste Nicht-Achse); ohne `wallAxes` und bei Mitte auf einem Pfosten bitgleich.
 */
export function ladders(axes: Axes, floors: readonly CoreFloor[], wallAxes?: WallAxes): StairCore | undefined {
  if (axes.S < 6 || axes.L < 3) return undefined;
  const cu = Math.floor((axes.L - 1) / 2);
  const links: UVLink[] = [];
  let moved = false;
  for (let k = 0; k + 1 < floors.length; k++) {
    const north = k % 2 === 0;
    const u = wallAxes === undefined ? cu : offAxis(cu, axes.L, wallAxes(floors[k]!.index, north ? 'back' : 'front'));
    moved ||= u !== cu;
    links.push({ floor: floors[k]!.index, origin: [u, north ? 1 : axes.S - 2], du: 0, dv: north ? -1 : 1, type: 'ladder', rise: floors[k]!.height + 1 });
  }
  if (links.length === 0) return { links: [], zone: new Map() };
  // gerückte Leitern bleiben, wo sie sind (die Mitte der Kette wäre wieder die Achse)
  const core = moved ? fit(links, axes, 'any', (lo, hi) => Math.min(hi, Math.max(lo, 0))) : fit(links, axes, 'center', () => 0);
  if (core === undefined) return undefined;
  // Leiter-Richtung in (x, z): zur tragenden Wand, also −v bzw. +v in Weltrichtung
  const toward = (dv: number): HorizontalDir => {
    const [x0, z0] = axes.toXZ(cu, 1);
    const [x1, z1] = axes.toXZ(cu, 1 + dv);
    return uvDir(x1 - x0, z1 - z0);
  };
  return { links: core.links.map((l, i) => ({ ...l, facing: toward(links[i]!.dv) })), zone: core.zone };
}

/** Spalte nahe `cu` (innen 1 … L − 2) ohne Fensterachse, bevorzugt auch nicht direkt daneben; gleich weit: die kleinere. */
function offAxis(cu: number, L: number, axisList: readonly (readonly number[])[]): number {
  const axis = new Set(axisList.flat());
  if (!axis.has(cu)) return cu;
  const cands: number[] = [];
  for (let d = 1; d < L; d++) for (const u of [cu - d, cu + d]) if (u >= 1 && u <= L - 2) cands.push(u);
  return cands.find((u) => !axis.has(u) && !axis.has(u - 1) && !axis.has(u + 1)) ?? cands.find((u) => !axis.has(u)) ?? cu;
}
