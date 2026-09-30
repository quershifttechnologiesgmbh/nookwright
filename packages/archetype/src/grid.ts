/**
 * W6 (27.09.2026, Review W4-R R1, Baustandard F1/F2, Prüfbericht X2 §6.3 „Später“): Trennwände aufs Fassadenraster.
 *
 * Die Hülle legt je Außenseite Joche (`bays`, Feldbreite je Theme) und setzt ein Fenster genau auf die Feldachse; ein Feld
 * mit Innenwand-Stoß auf der Achse bleibt blind (F2, nie verschoben). Der Grundriss kannte das Raster bisher nicht: ein
 * Gästezimmer schmaler als ein Feld bekam leicht keine Achse, eine Trennwand auf der Achse machte das Feld blind.
 *
 * Das Raster hängt nur an den Außenwänden, nicht an den Trennwänden. Der Planer leitet es darum vor der Teilung aus den
 * Baukörpern ab (`massingGrid`: je Baukörper und Etage ein Raum, echte Hülle, dieselbe Feldbreite) und legt dann die
 * Trennwände bevorzugt auf Pfosten (±1, nie auf eine Achse). Ohne diese Ableitung (Tests) gilt das Raster des Rechtecks
 * (`layoutGrid`: `bays`/`bayAxis` aus `@mcda/core` über die ganze Seite).
 *
 * Rechnen in (u, v) des Rechtecks (`Axes`). Wand zwischen zwei Streifen: gemalte Zellen sind Außenmaß, die gemeinsame Wand
 * trägt einer der beiden Räume (der größere, `computeWalls`). Beginnt ein Streifen bei `s`, steht die Wand also auf `s − 1`
 * oder `s`; das Innere eines Streifens [s, e] ist sicher [s + 1, e − 1].
 */
import type { FacadeGridLine } from '@mcda/blueprint';
import { CellSet, bayAxis, bays, type HorizontalDir } from '@mcda/core';
import type { Axes } from './frame.js';

/** Achsen einer Seite (je Feld 1 Spalte, Doppelachse 2) in der Koordinate entlang der Seite. */
export type AxisList = readonly (readonly number[])[];

/**
 * Raster eines Rechtecks der Länge L (u) und Tiefe S (v): Achsen je Seite – `back` (v = 0) und `front` (v = S − 1) in u,
 * `low` (u = 0) und `high` (u = L − 1) in v. Eine Seite ohne Fassade (Brandwand, Anbau) hat keine Achsen.
 */
export interface LayoutGrid {
  /** Feldbreite (Joch). */
  readonly bay: number;
  readonly L: number;
  readonly S: number;
  readonly back: AxisList;
  readonly front: AxisList;
  readonly low: AxisList;
  readonly high: AxisList;
}

/** Achsen einer freien Linie der Länge `len` (Ecken inklusive), wie die Hülle sie ohne Erbe rechnet. */
export function lineAxes(len: number, bay: number): AxisList {
  return bays(len, bay).fields.map(([a, e]) => bayAxis(a, e, 0, len - 1));
}

/** Raster eines frei stehenden Rechtecks (jede Seite eine eigene Linie über die ganze Länge). */
export function layoutGrid(L: number, S: number, bay: number): LayoutGrid {
  const u = lineAxes(L, bay);
  const v = lineAxes(S, bay);
  return { bay, L, S, back: u, front: u, low: v, high: v };
}

const STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/**
 * Raster eines Rechtecks aus den Rasterlinien der Hülle (`Shell.facadeGrid` einer Etage): jede Linie, die auf einer Seite
 * des Rechtecks liegt und nach außen zeigt, gibt ihre Achsen (soweit im Rechteck) an diese Seite.
 */
export function gridFromLines(axes: Axes, lines: readonly FacadeGridLine[], bay: number): LayoutGrid {
  const [ox, oz] = axes.toXZ(0, 0);
  const [ux, uz] = axes.toXZ(1, 0);
  const [vx, vz] = axes.toXZ(0, 1);
  const du = [ux - ox, uz - oz] as const;
  const dv = [vx - ox, vz - oz] as const;
  const toUV = (x: number, z: number): [number, number] => [(x - ox) * du[0] + (z - oz) * du[1], (x - ox) * dv[0] + (z - oz) * dv[1]];
  const { L, S } = axes;
  const out = { back: [] as number[][], front: [] as number[][], low: [] as number[][], high: [] as number[][] };
  const same = (d: HorizontalDir, x: number, z: number): boolean => STEP[d][0] === x && STEP[d][1] === z;
  for (const line of lines) {
    const ns = line.out === 'north' || line.out === 'south';
    const cell = (a: number): [number, number] => (ns ? toUV(a, line.plane) : toUV(line.plane, a));
    const [u0, v0] = cell(line.from);
    const [u1, v1] = cell(line.to);
    let side: keyof typeof out | undefined;
    let along: (a: number) => number;
    let len: number;
    if (v0 === v1 && (v0 === 0 || v0 === S - 1)) {
      side = v0 === 0 ? (same(line.out, -dv[0], -dv[1]) ? 'back' : undefined) : same(line.out, dv[0], dv[1]) ? 'front' : undefined;
      along = (a) => cell(a)[0];
      len = L;
    } else if (u0 === u1 && (u0 === 0 || u0 === L - 1)) {
      side = u0 === 0 ? (same(line.out, -du[0], -du[1]) ? 'low' : undefined) : same(line.out, du[0], du[1]) ? 'high' : undefined;
      along = (a) => cell(a)[1];
      len = S;
    } else {
      continue;
    }
    if (side === undefined) continue;
    for (const b of line.bays) {
      const a = b.axis.map(along);
      if (a.length > 0 && a.every((c) => c >= 0 && c < len)) out[side].push(a.sort((p, q) => p - q));
    }
  }
  return { bay, L, S, ...out };
}

/** Achsen der langen Seiten, die ein Bereich [v0, v1] berührt. */
export function alongU(g: LayoutGrid, v0: number, v1: number): AxisList {
  return [...(v0 === 0 ? g.back : []), ...(v1 === g.S - 1 ? g.front : [])];
}

/** Liegt eine ganze Achse im sicheren Inneren [s + 1, e − 1]? */
export function axisWithin(axes: AxisList, s: number, e: number): boolean {
  return axes.some((a) => a.length > 0 && a.every((c) => c >= s + 1 && c <= e - 1));
}

/** Trifft eine Wand bei `s − 1` oder `s` (Streifenbeginn `s`) eine Achse? Dann bliebe das Feld blind. */
export function hitsAxis(axes: AxisList, s: number): boolean {
  return axes.some((a) => a.some((c) => c === s - 1 || c === s));
}

/** Zellläufe eines Raums (u, v) auf den vier Wandreihen des Rechtecks, je Seite mit ihren Achsen. */
function sideRuns(cells: CellSet, g: LayoutGrid): Array<{ readonly axes: AxisList; readonly runs: Array<[number, number]> }> {
  const { L, S } = g;
  const runs = (pick: (u: number, v: number) => number | undefined): Array<[number, number]> => {
    const xs = cells.toArray().map(([u, v]) => pick(u, v)).filter((x): x is number => x !== undefined).sort((a, b) => a - b);
    const out: Array<[number, number]> = [];
    for (const x of xs) {
      const last = out[out.length - 1];
      if (last !== undefined && x === last[1] + 1) last[1] = x;
      else if (last === undefined || x > last[1]) out.push([x, x]);
    }
    return out;
  };
  return [
    { axes: g.back, runs: runs((u, v) => (v === 0 ? u : undefined)) },
    { axes: g.front, runs: runs((u, v) => (v === S - 1 ? u : undefined)) },
    { axes: g.low, runs: runs((u, v) => (u === 0 ? v : undefined)) },
    { axes: g.high, runs: runs((u, v) => (u === L - 1 ? v : undefined)) },
  ];
}

/**
 * Kann ein Raum (Zellen in u, v; Außenmaß) ein Fenster bekommen? Je Außenseite des Rechtecks, die er berührt, der
 * Zelllauf auf der Wandreihe: liegt eine Achse im sicheren Inneren dieses Laufs, gibt es ein Fenster (sofern die Hülle
 * die Achse nicht aus anderen Gründen blind lässt: Tür, Dach davor). Nur Näherung für die Auswahl – gezählt wird an der
 * echten Hülle (`finish`).
 */
export function mayHaveWindow(cells: CellSet, g: LayoutGrid): boolean {
  return sideRuns(cells, g).some(({ axes, runs }) => runs.some(([s, e]) => axisWithin(axes, s, e)));
}

/**
 * Achsen, die ein Raum berührt, aber nicht sicher im Inneren hat (Achse am Rand seines Laufs: dort steht womöglich die
 * Trennwand, das Feld bliebe blind). Näherung für die Auswahl unter den Kandidaten einer Etage.
 */
export function edgeAxes(cells: CellSet, g: LayoutGrid): number {
  let n = 0;
  for (const { axes, runs } of sideRuns(cells, g)) {
    for (const [s, e] of runs) n += axes.filter((a) => a.some((c) => c >= s && c <= e) && !a.every((c) => c >= s + 1 && c <= e - 1)).length;
  }
  return n;
}

/** Kosten der Rasterlage (Gewichte): Raum ohne mögliche Achse, Trennwand auf einer Achse, Verschiebung je Zelle. */
const DARK = 100;
const HIT = 10;

/**
 * Streifenbreiten aufs Raster schieben (Viterbi über die Grenzen): jede innere Grenze darf um höchstens `reach` Zellen
 * wandern, keine Breite unter ihr Minimum. Ziel der Reihe nach: jeder Raum, der Licht braucht (`lit`), bekommt eine
 * ganze Achse in sein sicheres Inneres (oder liegt an einer Stirnseite mit Achse, `endLit`); keine Trennwand auf einer
 * Achse; möglichst wenig Verschiebung. Gleichstand: die kleinere Verschiebung, dann die linke Lage. `maxs`: Höchstbreiten
 * (Häuserzeile: Breitenbereich des Bautyps).
 */
export function snapWidths(
  a0: number, widths: readonly number[], mins: readonly number[], lit: readonly boolean[], axes: AxisList, endLit: (s: number, e: number) => boolean, reach: number,
  maxs?: readonly number[],
): number[] {
  const n = widths.length;
  if (n <= 1) return [...widths];
  const base: number[] = [a0];
  for (const w of widths) base.push(base[base.length - 1]! + w);
  const shifts = Array.from({ length: 2 * reach + 1 }, (_, i) => i - reach).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
  const roomCost = (k: number, s: number, e: number): number => (lit[k] === true && !axisWithin(axes, s, e) && !endLit(s, e) ? DARK : 0);
  // dp über die Grenzen 1 … n−1; Zustand = Verschiebung der Grenze
  let prev = new Map<number, { cost: number; path: number[] }>([[0, { cost: 0, path: [] }]]);
  for (let k = 1; k <= n; k++) {
    const next = new Map<number, { cost: number; path: number[] }>();
    for (const d of k === n ? [0] : shifts) {
      const at = base[k]! + d;
      const own = k === n ? 0 : (hitsAxis(axes, at) ? HIT : 0) + Math.abs(d);
      let best: { cost: number; path: number[] } | undefined;
      for (const [pd, p] of prev) {
        const from = base[k - 1]! + pd;
        if (at - from < mins[k - 1]! || (maxs !== undefined && at - from > maxs[k - 1]!)) continue;
        const c = p.cost + roomCost(k - 1, from, at - 1) + own;
        if (best === undefined || c < best.cost) best = { cost: c, path: [...p.path, d] };
      }
      if (best !== undefined) next.set(d, best);
    }
    prev = next;
  }
  const res = prev.get(0);
  if (res === undefined) return [...widths];
  const pos = [a0, ...res.path.slice(0, n - 1).map((d, i) => base[i + 1]! + d), base[n]!];
  return widths.map((_, i) => pos[i + 1]! - pos[i]!);
}
