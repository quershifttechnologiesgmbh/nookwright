/**
 * Programmverteilung je Etage (research/19 §7.3 Schritt 4): gewichtete Streifenteilung entlang der Längsachse (u).
 * Der Treppenraum („Hub“: Eingangsraum, Flur oder größter Raum) enthält die Kernzone der Treppen; die übrigen Räume
 * teilen die Restfläche nach Anteil, je Raum mindestens so breit, dass die Mindestfläche passt.
 *
 * - Ohne Flur: Hub = durchgehendes Querband um die Kernzone, links und rechts Streifen; tiefe Bänder werden per Seed
 *   in eine hintere und eine vordere Reihe geteilt (nicht bei Hallen).
 * - Mit Flur (Etagentiefe ≥ `minDepth`): Flur = Kernzone + 3 Spuren breiter Gang über die ganze Länge (direkt vor der
 *   Kernzone bzw. an der Rückwand); die Räume liegen als Streifen davor und dahinter und haben alle eine Tür zum Flur.
 *
 * Alles in (u, v) des Hauptrechtecks; Kosten und Umrechnung macht der Aufrufer.
 */
import { CellSet, type Rng } from '@mcda/core';
import { alongU, axisWithin, hitsAxis, snapWidths, type LayoutGrid } from './grid.js';

/** Raumwunsch auf einer Etage. */
export interface Req {
  /** Index des Programm-Eintrags (−1 = Füllraum). */
  readonly entry: number;
  readonly roomTypeId: string;
  /** Ziel-Außenfläche (relativ). */
  weight: number;
  /** Mindest-Innenfläche. */
  readonly minArea: number;
  readonly required: boolean;
  readonly near?: 'entrance' | 'front' | 'back' | 'stairs';
  readonly adjacent?: readonly string[];
  /** Gewichtete Nachbarschaft (positiv zieht an, negativ stößt ab; research/22 §0.1). */
  readonly adjacencyWeights?: Readonly<Record<string, number>>;
  readonly fill: boolean;
  /** W6: Raum braucht ein Fenster (Wohn-/Gästeraum; nicht Lager, Bad, Flur …) – nur mit Raster (`grid`) von Belang. */
  readonly lit?: boolean;
}

export interface FloorLayoutInput {
  /** Länge (u) und Tiefe (v) des Hauptrechtecks. */
  readonly L: number;
  readonly S: number;
  /** Räume im Hauptrechteck samt Hub. */
  readonly reqs: readonly Req[];
  readonly hub?: Req;
  /** Kernzone der Treppen (u, v); liegt ganz im Hub. */
  readonly zone?: CellSet;
  /** Hub ist Flur. */
  readonly corridor: boolean;
  /** Querteilung in zwei Reihen erlaubt (nicht bei Hallen). */
  readonly rows: boolean;
  /** W6: Fassadenraster des Rechtecks; fehlt = Teilung ohne Rasterbezug (bisheriges Verhalten, bitgleich). */
  readonly grid?: LayoutGrid;
  /**
   * W12-B (28.09.2026, plan/spikes/W12B_erdhausfront.md): Hub als mittiges Querband über die ganze Tiefe, links und
   * rechts gleich breite Seiten mit je genau einem Frontraum über die ganze Seitenbreite (dahinter die übrigen Räume
   * als Streifen, beide Seiten mit derselben Reihentiefe) – die Front ist spiegelgleich (Tür mittig, Fenster paarweise).
   * Nur ohne Kernzone und ohne Flur. Fehlt = wie bisher (bitgleich).
   */
  readonly center?: boolean;
  /**
   * W13-C (28.09.2026, plan/spikes/W13C_erdhaus_huegel.md): nur mit `center` – die Front liegt an der Schmalseite
   * (Stirn des Rechtecks bei großem u). Der Hub läuft dann als mittiges Längsband über die ganze Länge (von der Front
   * nach hinten), links und rechts gleich breite Seiten; sonst wie `center` (dieselbe Teilung, quer gelegt). Ohne Raster.
   * Fehlt = wie bisher (bitgleich).
   */
  readonly spine?: boolean;
}

/** Kleinste Raumbreite (Außenmaß, Wände inklusive). */
export const MIN_WIDTH = 4;

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Mindestbreite eines Streifens der Tiefe `depth`, damit die Mindestfläche (innen) passt. */
export const minWidth = (r: Req, depth: number): number => Math.max(MIN_WIDTH, Math.ceil(r.minArea / Math.max(1, depth - 2)) + 2);

/** Ganzzahlige Breiten mit Summe `len`, proportional zu `weights` und mindestens `mins`; `undefined`, wenn zu kurz. */
export function allocate(len: number, weights: readonly number[], mins: readonly number[]): number[] | undefined {
  const rest = len - sum(mins);
  if (rest < 0) return undefined;
  const total = sum(weights) > 0 ? sum(weights) : weights.length;
  const want = weights.map((w, i) => Math.max(0, (len * (sum(weights) > 0 ? w : 1)) / total - mins[i]!));
  const ws = sum(want);
  const extra = want.map((w) => (ws > 0 ? (rest * w) / ws : rest / weights.length));
  const base = extra.map(Math.floor);
  let left = rest - sum(base);
  const order = extra.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    base[i]!++;
    left--;
  }
  return mins.map((m, i) => m + base[i]!);
}

const rect = (u0: number, v0: number, u1: number, v1: number): CellSet => CellSet.rect(u0, v0, u1, v1);

/**
 * Streifen entlang u über [a0, a1] × [v0, v1] (optional nur `within`), in der Reihenfolge von `reqs`. W6: mit Raster
 * wandern die Grenzen (±2, Joch 5: ±3) auf die Pfosten – kein Stoß auf einer Achse, jeder Raum mit Licht bekommt ein Feld.
 */
function strips(a0: number, a1: number, v0: number, v1: number, reqs: readonly Req[], within?: CellSet, grid?: LayoutGrid): Map<Req, CellSet> | undefined {
  const depth = v1 - v0 + 1;
  const mins = reqs.map((r) => minWidth(r, depth));
  const raw = allocate(a1 - a0 + 1, reqs.map((r) => r.weight), mins);
  if (raw === undefined) return undefined;
  const widths = grid === undefined ? raw : snapWidths(
    a0, raw, mins, reqs.map((r) => r.lit === true), alongU(grid, v0, v1),
    (s, e) => (s === 0 && axisWithin(grid.low, v0, v1)) || (e === grid.L - 1 && axisWithin(grid.high, v0, v1)), grid.bay >= 5 ? 3 : 2,
  );
  const out = new Map<Req, CellSet>();
  let u = a0;
  for (const [i, r] of reqs.entries()) {
    let cells = rect(u, v0, u + widths[i]! - 1, v1);
    if (within !== undefined) cells = cells.intersection(within);
    if (cells.isEmpty || !cells.isConnected()) return undefined;
    out.set(r, cells);
    u += widths[i]!;
  }
  return out;
}

/** Verteilt Räume auf Bereiche nach Fläche (gierig, schwerste zuerst); leere Bereiche bleiben leer. */
function distribute(reqs: readonly Req[], caps: readonly number[], rng: Rng): Req[][] {
  const groups: Req[][] = caps.map(() => []);
  const load = caps.map(() => 0);
  const total = sum(reqs.map((r) => r.weight));
  const capTotal = sum(caps);
  const order = rng.shuffle(reqs).sort((a, b) => b.weight - a.weight);
  for (const r of order) {
    let best = 0;
    let room = -Infinity;
    caps.forEach((c, g) => {
      const free = (c / capTotal) * total - load[g]!;
      if (c > 0 && free > room) {
        room = free;
        best = g;
      }
    });
    groups[best]!.push(r);
    load[best]! += r.weight;
  }
  return groups.map((g) => rng.shuffle(g));
}

/** Band [a0, a1] über die volle Tiefe: Streifen, bei Bedarf in zwei Reihen (hinten v klein, vorn v groß). */
function band(a0: number, a1: number, S: number, reqs: readonly Req[], rows: boolean, rng: Rng, grid?: LayoutGrid): Map<Req, CellSet> | undefined {
  const len = a1 - a0 + 1;
  if (rows && reqs.length >= 2 && S >= 10 && rng.chance(len < S ? 0.8 : 0.4)) {
    const front = reqs.filter((r) => r.near === 'front' || r.near === 'entrance');
    const back = reqs.filter((r) => r.near === 'back');
    const rest = reqs.filter((r) => !front.includes(r) && !back.includes(r));
    for (const r of rest) (sum(front.map((x) => x.weight)) <= sum(back.map((x) => x.weight)) ? front : back).push(r);
    if (front.length > 0 && back.length > 0) {
      const wb = sum(back.map((r) => r.weight));
      const want = Math.min(S - 5, Math.max(5, Math.round((S * wb) / (wb + sum(front.map((r) => r.weight))))));
      // W6: die Querwand trifft die Stirnseiten – nicht auf eine Achse (±1)
      const ends = grid === undefined ? [] : [...grid.low, ...grid.high];
      const sv = grid === undefined ? want : [want, want - 1, want + 1].filter((x) => x >= 5 && x <= S - 5).find((x) => !hitsAxis(ends, x)) ?? want;
      const b = strips(a0, a1, 0, sv - 1, back, undefined, grid);
      const f = strips(a0, a1, sv, S - 1, front, undefined, grid);
      if (b !== undefined && f !== undefined) return new Map([...b, ...f]);
    }
  }
  return strips(a0, a1, 0, S - 1, reqs, undefined, grid);
}

/** Teilt eine Etage des Hauptrechtecks; `undefined`, wenn die Räume nicht hineinpassen. */
export function layoutFloor(inp: FloorLayoutInput, rng: Rng): Map<Req, CellSet> | undefined {
  const { L, S, hub, zone } = inp;
  const others = inp.reqs.filter((r) => r !== hub);
  const grid = inp.grid;
  if (hub === undefined) return others.length === 0 ? new Map() : band(0, L - 1, S, others, inp.rows, rng, grid);
  const zb = zone?.bounds();
  const out = new Map<Req, CellSet>();
  if (inp.center === true && zb === undefined && !inp.corridor) {
    return inp.spine === true ? spineLayout(L, S, hub, others, inp.reqs, rng) : centerLayout(L, S, hub, others, inp.reqs, rng, grid);
  }

  if (inp.corridor) {
    // Flur: 3 Spuren über die ganze Länge – vor der Kernzone, wenn dahinter und davor je 5 Tiefe bleiben, sonst an der
    // Rückwand. Um die Treppe bleibt eine Spur hinter dem Geländer frei (sonst teilen Öffnung und Geländer den Flur).
    const zd = zb === undefined ? 0 : zb.maxZ + 2;
    const s0 = zb !== undefined ? (zd >= 5 && S - zd - 3 >= 5 ? zd : 0) : S >= 13 ? Math.floor((S - 3) / 2) : 0;
    if (S - s0 - 3 < 5 || (s0 > 0 && s0 < 5) || zd > S - 3) return undefined;
    // Treppenblock eine Spalte breiter als die Kernzone: dort führt der Gang um das Geländer herum
    const hall = rect(0, s0, L - 1, s0 + 2).union(zb === undefined ? CellSet.empty() : rect(Math.max(0, zb.minX - 1), 0, Math.min(L - 1, zb.maxX + 1), zd - 1));
    const parts = rect(0, 0, L - 1, S - 1).difference(hall).components().sort((a, b) => a.bounds()!.minZ - b.bounds()!.minZ || a.bounds()!.minX - b.bounds()!.minX);
    if (parts.length === 0 && others.length > 0) return undefined;
    const groups = distribute(others, parts.map((p) => p.size), rng);
    let corridor = hall;
    for (const [i, part] of parts.entries()) {
      const g = groups[i]!;
      if (g.length === 0) {
        corridor = corridor.union(part);
        continue;
      }
      const b = part.bounds()!;
      const res = strips(b.minX, b.maxX, b.minZ, b.maxZ, g, part, grid);
      if (res === undefined) return undefined;
      for (const [r, c] of res) out.set(r, c);
    }
    out.set(hub, corridor);
    return out;
  }

  // Hub als Querband um die Kernzone, Rest links und rechts
  const total = sum(inp.reqs.map((r) => r.weight));
  const need = zb === undefined ? minWidth(hub, S) : zb.maxX - zb.minX + 1;
  let width = Math.min(L, Math.max(need, Math.round((L * hub.weight) / total)));
  const lo = zb === undefined ? 0 : Math.max(0, zb.maxX - width + 1);
  const hi = zb === undefined ? L - width : Math.min(zb.minX, L - width);
  if (lo > hi) return undefined;
  let h0 = zb === undefined ? rng.pick([lo, hi, Math.round((lo + hi) / 2)]) : rng.int(lo, hi);
  if (grid !== undefined) {
    // W6: Lage und Breite des Treppenraums (je ±2) mit den wenigsten Stößen auf Achsen (beide Grenzen), sonst die
    // gewürfelte; die Kernzone bleibt ganz im Treppenraum
    const sides = alongU(grid, 0, S - 1);
    const hits = (a: number, w: number): number => (a > 0 && hitsAxis(sides, a) ? 1 : 0) + (a + w < L && hitsAxis(sides, a + w) ? 1 : 0);
    let best = { a: h0, w: width, c: 10 * hits(h0, width) };
    for (let w = Math.max(need, width - 2); w <= Math.min(L, width + 2); w++) {
      for (let a = h0 - 2; a <= h0 + 2; a++) {
        if (a < 0 || a + w > L || (zb !== undefined && (a > zb.minX || a + w - 1 < zb.maxX))) continue;
        const c = 10 * hits(a, w) + Math.abs(a - h0) + Math.abs(w - width);
        if (c < best.c) best = { a, w, c };
      }
    }
    h0 = best.a;
    width = best.w;
  }
  // zu schmale Reste gehören zum Hub
  if (h0 > 0 && h0 < MIN_WIDTH) {
    width += h0;
    h0 = 0;
  }
  if (L - (h0 + width) > 0 && L - (h0 + width) < MIN_WIDTH) width = L - h0;
  const sides = [[0, h0 - 1], [h0 + width, L - 1]].filter(([a, b]) => b! >= a!) as [number, number][];
  if (sides.length === 0 && others.length > 0) return undefined;
  const groups = distribute(others, sides.map(([a, b]) => b - a + 1), rng);
  let hubCells = rect(h0, 0, h0 + width - 1, S - 1);
  for (const [i, [a, b]] of sides.entries()) {
    const g = groups[i]!;
    if (g.length === 0) {
      hubCells = hubCells.union(rect(a, 0, b, S - 1));
      continue;
    }
    const res = band(a, b, S, g, inp.rows, rng, grid);
    if (res === undefined) return undefined;
    for (const [r, c] of res) out.set(r, c);
  }
  out.set(hub, hubCells);
  return out;
}

/**
 * W12-B: mittiger Hub (Diele) über die ganze Tiefe, zwei gleich breite Seiten. Je Seite ein Frontraum über die ganze
 * Seitenbreite (Wünsche `near: front/entrance` zuerst, per Seed auf die Seiten verteilt), dahinter die übrigen Räume als
 * Streifen; die Querwand liegt auf beiden Seiten in derselben Tiefe. `undefined`, wenn es nicht passt (der Aufrufer
 * lässt dann Wunschräume weg).
 */
function centerLayout(L: number, S: number, hub: Req, others: readonly Req[], all: readonly Req[], rng: Rng, grid?: LayoutGrid): Map<Req, CellSet> | undefined {
  const total = sum(all.map((r) => r.weight));
  // Breite mit gleicher Parität wie L: beide Seiten gleich breit
  let width = Math.min(L, Math.max(minWidth(hub, S), Math.round((L * hub.weight) / total)));
  if ((L - width) % 2 !== 0) width++;
  while (width > minWidth(hub, S) + 1 && (L - width) / 2 < MIN_WIDTH) width -= 2;
  const side = (L - width) / 2;
  if (side < MIN_WIDTH) return others.length === 0 ? new Map([[hub, rect(0, 0, L - 1, S - 1)]]) : undefined;
  if (others.length === 0) return new Map([[hub, rect(0, 0, L - 1, S - 1)]]);
  const h0 = side;
  const sides: [number, number][] = [[0, side - 1], [h0 + width, L - 1]];
  // Frontraum je Seite: erst die Wünsche vorn (Küche, Stube), dann die schwersten übrigen (kein Hinten-Wunsch zuerst)
  const order = rng.shuffle(others);
  const rank = (r: Req): number => (r.near === 'front' || r.near === 'entrance' ? 0 : r.near === 'back' ? 2 : 1);
  const byFront = [...order].sort((a, b) => rank(a) - rank(b) || b.weight - a.weight);
  const fronts = byFront.slice(0, 2);
  const backs = order.filter((r) => !fronts.includes(r));
  const flip = rng.chance(0.5);
  const frontOf = [fronts[flip ? 1 : 0], fronts[flip ? 0 : 1]];
  const groups = distribute(backs, [side, side], rng);
  // Reihentiefe (hinten) aus dem Flächenverhältnis beider Seiten zusammen, 5 … S − 5
  const wb = sum(backs.map((r) => r.weight));
  const wf = sum(fronts.map((r) => r.weight));
  const want = S >= 10 ? Math.min(S - 5, Math.max(5, Math.round((S * wb) / Math.max(1, wb + wf)))) : 0;
  // Reihentiefe: die gewünschte zuerst, sonst tiefer (schmalere Hinten-Räume passen nebeneinander), sonst flacher
  const depths = want === 0 ? [0] : [want, ...Array.from({ length: S - 5 - want }, (_, k) => want + 1 + k), ...Array.from({ length: want - 5 }, (_, k) => want - 1 - k)];
  for (const sv of depths) {
    const out = splitSides(sides, frontOf, groups, sv, S, grid);
    if (out === undefined) continue;
    out.set(hub, rect(h0, 0, h0 + width - 1, S - 1));
    return out;
  }
  return undefined;
}

/**
 * W13-C (28.09.2026, plan/spikes/W13C_erdhaus_huegel.md): Front an der Schmalseite (großes u). Der Hub ist ein mittiges
 * Längsband über die ganze Länge (Breite mit derselben Parität wie S, beide Seiten gleich breit); je Seite hinten die
 * übrigen Räume als Streifen hintereinander (Wünsche `near: back` ganz hinten), vorn genau ein Frontraum über die ganze
 * Seitenbreite (Wünsche vorn zuerst, die Seite per Seed) – Tür mittig, Fenster paarweise.
 */
function spineLayout(L: number, S: number, hub: Req, others: readonly Req[], all: readonly Req[], rng: Rng): Map<Req, CellSet> | undefined {
  const total = sum(all.map((r) => r.weight));
  let width = Math.min(S, Math.max(minWidth(hub, L), Math.round((S * hub.weight) / total)));
  if ((S - width) % 2 !== 0) width++;
  while (width > minWidth(hub, L) + 1 && (S - width) / 2 < MIN_WIDTH) width -= 2;
  const side = (S - width) / 2;
  if (others.length === 0) return new Map([[hub, rect(0, 0, L - 1, S - 1)]]);
  if (side < MIN_WIDTH) return undefined;
  const order = rng.shuffle(others);
  const rank = (r: Req): number => (r.near === 'front' || r.near === 'entrance' ? 0 : r.near === 'back' ? 2 : 1);
  const byFront = [...order].sort((a, b) => rank(a) - rank(b) || b.weight - a.weight);
  const fronts = byFront.slice(0, 2);
  const backs = order.filter((r) => !fronts.includes(r));
  const flip = rng.chance(0.5);
  const frontOf = [fronts[flip ? 1 : 0], fronts[flip ? 0 : 1]];
  const groups = distribute(backs, [side, side], rng);
  const out = new Map<Req, CellSet>([[hub, rect(0, side, L - 1, side + width - 1)]]);
  for (const [i, v0] of [0, side + width].entries()) {
    const f = frontOf[i];
    const list = [...groups[i]!].sort((a, b) => rank(b) - rank(a));
    if (f !== undefined) list.push(f);
    if (list.length === 0) return undefined;
    const res = strips(0, L - 1, v0, v0 + side - 1, list);
    if (res === undefined) return undefined;
    for (const [r, c] of res) out.set(r, c);
  }
  return out;
}

/** W12-B: beide Seiten mit derselben Reihentiefe `sv` (0 = ohne Querteilung); `undefined`, wenn eine Seite nicht passt. */
function splitSides(
  sides: readonly (readonly [number, number])[], frontOf: readonly (Req | undefined)[], groups: readonly Req[][], sv: number, S: number, grid?: LayoutGrid,
): Map<Req, CellSet> | undefined {
  const out = new Map<Req, CellSet>();
  for (const [i, [a, b]] of sides.entries()) {
    const f = frontOf[i];
    const g = groups[i]!;
    if (f === undefined) {
      // nur ein Raum außer der Diele: diese Seite nimmt die Hinten-Räume über die ganze Tiefe
      if (g.length === 0) return undefined;
      const res = strips(a, b, 0, S - 1, g, undefined, grid);
      if (res === undefined) return undefined;
      for (const [r, c] of res) out.set(r, c);
      continue;
    }
    if (g.length === 0 || sv === 0) {
      if (g.length > 0) return undefined;
      out.set(f, rect(a, 0, b, S - 1));
      continue;
    }
    const back = strips(a, b, 0, sv - 1, g, undefined, grid);
    if (back === undefined || (S - sv - 2) * (b - a - 1) < f.minArea) return undefined;
    for (const [r, c] of back) out.set(r, c);
    out.set(f, rect(a, sv, b, S - 1));
  }
  return out;
}
