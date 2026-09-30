/**
 * Walmdach per Chebyshev-Distanztransformation (research/03 §C9, verifiziert in Spike T4 §3,
 * übernommen aus spikes/algorithms/src/roof/hip.ts und roofBlocks.ts).
 *
 *   G = dilate(F, overhang)   Quadrat-Dilatation = gehrungsartiger Überstand
 *   d = chebyshevDT(G ∪ K)    d = 1 am Rand; K = Sperrzone (Grundriss der oberen Etage): weder Saat noch Dach
 *   t = d − 1 − overhang      t = 0 über der Wandlinie, < 0 im Überstand
 *
 * Mit Sperrzone steigt das Dach zur Wand der oberen Etage hin an (Pult-/Anbaudach ohne Sonderfall, §C9
 * „Mehrere Etagen“); `cap` kappt es auf Höhe der oberen Wand (darüber flach, Vollblock).
 *
 * Klassifikation über die exakten 45°-Höhen an den vier Viertelpunkten jeder Zelle (Korrektur aus dem
 * Spike; der 4-Nachbarn-Pseudocode aus §C9 ist falsch): 2 benachbarte Viertel hoch → Fläche (straight),
 * 1 → Grat (outer), 3 → Kehle (inner), 0 → First/Spitze (untere Stufe exakt), 2 diagonal → Sattel (Block).
 * Die Klassifikation arbeitet auf einem allgemeinen Höhenfeld (`RoofField`); das Satteldach (gable.ts)
 * liefert dasselbe Format.
 *
 * Die Treppen-`facing` an Graten/Kehlen (je 2 Möglichkeiten) werden per lokaler Suche so gewählt, dass die
 * Vanilla-Treppenregel dieselbe Form wiederherstellt (update-stabil, Spike T4 §5). Alle Größen liegen im
 * selben Raster (Frame); der Rand des Rasters muss den Überstand plus 1 aufnehmen.
 */
import type { HorizontalDir } from '@mcda/core';
import { CCW, CW, DIRS, OPP, STEP, axisOf } from './grid.js';
import type { StairShape } from './types.js';

export type RoofClass = 'slope' | 'hip' | 'valley' | 'ridge' | 'saddle' | 'flat';

/** Viertel einer Zelle als Bits: NW=1, NE=2, SW=4, SE=8. */
export const Q = { NW: 1, NE: 2, SW: 4, SE: 8 } as const;

export interface StairOption {
  readonly facing: HorizontalDir;
  readonly shape: StairShape;
}

export interface RoofCell {
  /** Ganzzahlige Dachhöhe (1 = Rand der Dachfläche); beim Walmdach die Chebyshev-Distanz. */
  readonly d: number;
  /** Ebene relativ zur Traufe: 0 über der Wandlinie, < 0 im Überstand. */
  readonly t: number;
  readonly cls: RoofClass;
  /** Hohe Viertel (Bits aus Q). */
  readonly high: number;
  /** Alle (facing, shape)-Paare, deren Geometrie exakt dem Viertelmuster entspricht. */
  readonly options: readonly StairOption[];
}

/**
 * Höhenfeld eines Dachs im Raster: Höhe (in Blöcken, 45°) am Zellmittelpunkt und an den vier Viertelpunkten.
 * Konvention wie beim Walmdach: Zelle am Rand der Dachfläche hat hc = 0,5.
 */
export interface RoofField {
  readonly w: number;
  readonly d: number;
  /** Dachzellen (inklusive Überstand, ohne Sperrzone). */
  readonly mask: Uint8Array;
  readonly hc: Float64Array;
  /** Viertelpunkte je Zelle i: 4i + (0 NW, 1 NE, 2 SW, 3 SE). */
  readonly hq: Float64Array;
}

/** Ergebnis für jede Dachform. */
export interface RoofPlan {
  readonly w: number;
  readonly d: number;
  readonly overhang: number;
  /** Dachgrundfläche inklusive Überstand. */
  readonly mask: Uint8Array;
  readonly cells: ReadonlyArray<RoofCell | undefined>;
  /** Gewählte Option je Zelle (Index in `options`). */
  readonly choice: Int8Array;
  /** Treppen, bei denen auch die beste Wahl nicht update-stabil ist (Spike: ≈ 0,02 %). */
  readonly unstable: readonly number[];
}

export interface HipRoof extends RoofPlan {
  readonly dist: Int32Array;
}

export interface RoofExtras {
  /** Sperrzone (Grundriss der oberen Etage): weder Saat noch Dach. */
  readonly keepOut?: Uint8Array;
  /** Höchste Ebene t; Zellen darüber werden flach (Vollblock auf t = cap). */
  readonly cap?: number;
}

/** Exakte Chebyshev-(Schachbrett-)Distanz zum Komplement; zwei Durchläufe, O(n). Außerhalb des Rasters = außen. */
export function chebyshevDT(mask: Uint8Array, w: number, d: number): Int32Array {
  const out = new Int32Array(w * d);
  const INF = 1e9;
  const at = (x: number, z: number): number => (x < 0 || z < 0 || x >= w || z >= d ? 0 : out[z * w + x]!);
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      if (!mask[z * w + x]) continue;
      out[z * w + x] = 1 + Math.min(at(x - 1, z - 1), at(x, z - 1), at(x + 1, z - 1), at(x - 1, z), INF);
    }
  }
  for (let z = d - 1; z >= 0; z--) {
    for (let x = w - 1; x >= 0; x--) {
      if (!mask[z * w + x]) continue;
      const v = out[z * w + x]!;
      out[z * w + x] = Math.min(v, 1 + Math.min(at(x + 1, z + 1), at(x, z + 1), at(x - 1, z + 1), at(x + 1, z)));
    }
  }
  return out;
}

/** Quadrat-Dilatation um r im selben Raster (Zellen außerhalb des Rasters entfallen). */
export function dilateSquare(mask: Uint8Array, w: number, d: number, r: number): Uint8Array {
  const out = new Uint8Array(w * d);
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      if (!mask[z * w + x]) continue;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx >= 0 && nz >= 0 && nx < w && nz < d) out[nz * w + nx] = 1;
        }
      }
    }
  }
  return out;
}

/** Halbzellen-Raster (jede Zelle → 2×2), Größe 2w × 2d. */
export function upsample2(mask: Uint8Array, w: number, d: number): Uint8Array {
  const W = 2 * w;
  const out = new Uint8Array(W * 2 * d);
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      if (!mask[z * w + x]) continue;
      out[2 * z * W + 2 * x] = 1;
      out[2 * z * W + 2 * x + 1] = 1;
      out[(2 * z + 1) * W + 2 * x] = 1;
      out[(2 * z + 1) * W + 2 * x + 1] = 1;
    }
  }
  return out;
}

const quarter = (a: HorizontalDir, b: HorizontalDir): number => {
  const ns = a === 'north' || a === 'south' ? a : b;
  const ew = a === 'east' || a === 'west' ? a : b;
  return ns === 'north' ? (ew === 'west' ? Q.NW : Q.NE) : ew === 'west' ? Q.SW : Q.SE;
};

/** Geometrie einer unteren Treppe: Menge der hohen Viertel (entspricht den Vanilla-Blockmodellen). */
export function stairQuarters(f: HorizontalDir, shape: StairShape): number {
  const back = quarter(f, CW[f]) | quarter(f, CCW[f]);
  const front = OPP[f];
  switch (shape) {
    case 'straight':
      return back;
    case 'outer_left':
      return quarter(f, CCW[f]);
    case 'outer_right':
      return quarter(f, CW[f]);
    case 'inner_left':
      return back | quarter(front, CCW[f]);
    case 'inner_right':
      return back | quarter(front, CW[f]);
  }
}

const SHAPES: readonly StairShape[] = ['straight', 'outer_left', 'outer_right', 'inner_left', 'inner_right'];

export function optionsForPattern(high: number): StairOption[] {
  const out: StairOption[] = [];
  for (const facing of DIRS) for (const shape of SHAPES) if (stairQuarters(facing, shape) === high) out.push({ facing, shape });
  return out;
}

const popcount = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
const QUARTER_BITS = [Q.NW, Q.NE, Q.SW, Q.SE] as const;

/**
 * Ordnet jede Dachzelle über die Höhen an den vier Viertelpunkten ein. Zellen über `cap` werden flach
 * (Klasse `flat`, Vollblock auf t = cap).
 */
export function classifyField(field: RoofField, overhang: number, cap = Infinity): Array<RoofCell | undefined> {
  const { w, d, mask, hc, hq } = field;
  const cells: Array<RoofCell | undefined> = new Array<RoofCell | undefined>(w * d).fill(undefined);
  for (let i = 0; i < w * d; i++) {
    if (!mask[i]) continue;
    const c = hc[i]!;
    const dd = Math.round(c + 0.5);
    const t = dd - 1 - overhang;
    if (t > cap) {
      cells[i] = { d: dd, t: cap, cls: 'flat', high: 0, options: [] };
      continue;
    }
    let high = 0;
    for (let q = 0; q < 4; q++) if (hq[4 * i + q]! > c + 1e-9) high |= QUARTER_BITS[q]!;
    const n = popcount(high);
    const cls: RoofClass =
      n === 0 ? 'ridge' : n === 1 ? 'hip' : n === 3 ? 'valley' : n === 4 ? 'flat' : high === (Q.NW | Q.SE) || high === (Q.NE | Q.SW) ? 'saddle' : 'slope';
    cells[i] = { d: dd, t, cls, high, options: n === 4 ? [] : optionsForPattern(high) };
  }
  return cells;
}

/** Höhenfeld des Walmdachs aus Distanztransformationen (Zelle und Halbzellen-Raster). */
export function hipField(footprint: Uint8Array, w: number, d: number, overhang: number, keepOut?: Uint8Array): RoofField & { dist: Int32Array } {
  const g = overhang > 0 ? dilateSquare(footprint, w, d, overhang) : footprint.slice();
  const seedMask = keepOut === undefined ? g : g.map((v, i) => (v | keepOut[i]!) as number);
  const dist = chebyshevDT(seedMask, w, d);
  const dq = chebyshevDT(upsample2(seedMask, w, d), 2 * w, 2 * d);
  const mask = keepOut === undefined ? g : g.map((v, i) => (v && !keepOut[i] ? 1 : 0) as number);
  const hc = new Float64Array(w * d);
  const hq = new Float64Array(4 * w * d);
  const W = 2 * w;
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      hc[i] = dist[i]! - 0.5;
      hq[4 * i] = (dq[2 * z * W + 2 * x]! - 0.5) / 2;
      hq[4 * i + 1] = (dq[2 * z * W + 2 * x + 1]! - 0.5) / 2;
      hq[4 * i + 2] = (dq[(2 * z + 1) * W + 2 * x]! - 0.5) / 2;
      hq[4 * i + 3] = (dq[(2 * z + 1) * W + 2 * x + 1]! - 0.5) / 2;
    }
  }
  return { w, d, mask, hc, hq, dist };
}

/**
 * Klassifizieren und Treppen stabilisieren (gemeinsam für alle Dachformen).
 * @param stairRing optional: Ebenen t, deren Ring aus Treppen besteht (Standard alle). Ringe aus Stufen (flache
 *   Neigung, research/18 D1) behalten Klasse und Viertelmuster, bekommen aber keine Treppen-Optionen.
 */
export function buildRoof(field: RoofField, overhang: number, cap = Infinity, stairRing?: (t: number) => boolean): RoofPlan {
  const classified = classifyField(field, overhang, cap);
  const cells = stairRing === undefined ? classified : classified.map((c) => (c === undefined || c.options.length === 0 || stairRing(c.t) ? c : { ...c, options: [] }));
  const choice = new Int8Array(field.w * field.d);
  const unstable = stabilize(cells, field.w, field.d, choice);
  return { w: field.w, d: field.d, overhang, mask: field.mask, cells, choice, unstable };
}

/** Rückwärtskompatibel: Klassifikation aus Zell- und Halbzellen-DT (ohne Sperrzone). */
export function classifyRoof(dist: Int32Array, dq: Int32Array, w: number, d: number, overhang: number): Array<RoofCell | undefined> {
  const hc = new Float64Array(w * d);
  const hq = new Float64Array(4 * w * d);
  const mask = new Uint8Array(w * d);
  const W = 2 * w;
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      mask[i] = dist[i]! > 0 ? 1 : 0;
      hc[i] = dist[i]! - 0.5;
      [0, 1, 2, 3].forEach((q) => (hq[4 * i + q] = (dq[(2 * z + (q >> 1)) * W + 2 * x + (q & 1)]! - 0.5) / 2));
    }
  }
  return classifyField({ w, d, mask, hc, hq }, overhang);
}

export function hipRoof(footprint: Uint8Array, w: number, d: number, overhang: number, extras: RoofExtras = {}): HipRoof {
  const field = hipField(footprint, w, d, overhang, extras.keepOut);
  return { ...buildRoof(field, overhang, extras.cap), dist: field.dist };
}

// ---------------------------------------------------------------- Vanilla-Treppenregel (nur Dachtreppen)


/**
 * Treppen-`shape` nach StairBlock#getStairsShape (Faktencheck Punkt 14), angewandt auf das Dach:
 * alle Treppen sind `half=bottom`; Nachbarn auf gleicher Höhe = Dachzellen mit gleichem t.
 */
export function vanillaStairShape(cells: ReadonlyArray<RoofCell | undefined>, choice: Int8Array, w: number, d: number, i: number): StairShape {
  const self = cells[i]!;
  const facingAt = (j: number): HorizontalDir | undefined => {
    const c = cells[j];
    if (c === undefined || c.options.length === 0 || c.t !== self.t) return undefined;
    return c.options[choice[j]!]!.facing;
  };
  const x = i % w;
  const z = Math.floor(i / w);
  const neighborFacing = (dir: HorizontalDir): HorizontalDir | undefined => {
    const nx = x + STEP[dir][0];
    const nz = z + STEP[dir][1];
    return nx < 0 || nz < 0 || nx >= w || nz >= d ? undefined : facingAt(nz * w + nx);
  };
  const f = self.options[choice[i]!]!.facing;
  const canTakeShape = (side: HorizontalDir): boolean => neighborFacing(side) !== f;
  const behind = neighborFacing(f);
  if (behind !== undefined && axisOf(behind) !== axisOf(f) && canTakeShape(OPP[behind])) {
    return behind === CCW[f] ? 'outer_left' : 'outer_right';
  }
  const front = neighborFacing(OPP[f]);
  if (front !== undefined && axisOf(front) !== axisOf(f) && canTakeShape(front)) {
    return front === CCW[f] ? 'inner_left' : 'inner_right';
  }
  return 'straight';
}

/**
 * Lokale Suche über die mehrdeutigen Zellen (Grat/Kehle), bis die Vanilla-Regel überall die Soll-Geometrie
 * ergibt (Spike roofBlocks.ts#buildStableRoof). Phase 1: Einzel-Umschaltungen, Phase 2: erschöpfende Suche
 * im Umkreis 2. Gibt die verbleibenden instabilen Zellen zurück.
 */
function stabilize(cells: ReadonlyArray<RoofCell | undefined>, w: number, d: number, choice: Int8Array, maxRounds = 8): number[] {
  const isStair = (i: number): boolean => {
    const c = cells[i];
    return c !== undefined && c.options.length > 0;
  };
  const unstableAt = (i: number): boolean => {
    if (!isStair(i)) return false;
    const c = cells[i]!;
    return stairQuarters(c.options[choice[i]!]!.facing, vanillaStairShape(cells, choice, w, d, i)) !== c.high;
  };
  const localUnstable = (cx: number, cz: number, r: number): number => {
    let n = 0;
    for (let z = cz - r; z <= cz + r; z++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x >= 0 && z >= 0 && x < w && z < d && unstableAt(z * w + x)) n++;
      }
    }
    return n;
  };
  const allUnstable = (): number[] => {
    const out: number[] = [];
    for (let i = 0; i < w * d; i++) if (unstableAt(i)) out.push(i);
    return out;
  };

  let unstable = allUnstable();
  for (let round = 0; round < maxRounds && unstable.length > 0; round++) {
    let improved = false;
    for (const m of unstable) {
      const mx = m % w;
      const mz = Math.floor(m / w);
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = mx + dx;
        const z = mz + dz;
        if (x < 0 || z < 0 || x >= w || z >= d) continue;
        const j = z * w + x;
        const c = cells[j];
        if (c === undefined || c.options.length < 2) continue;
        const cur = choice[j]!;
        for (let k = 0; k < c.options.length; k++) {
          if (k === cur) continue;
          const before = localUnstable(x, z, 2);
          choice[j] = k;
          if (localUnstable(x, z, 2) < before) {
            improved = true;
            break;
          }
          choice[j] = cur;
        }
      }
    }
    unstable = allUnstable();
    if (!improved) break;
  }

  for (const m of [...unstable]) {
    if (!unstableAt(m)) continue;
    const mx = m % w;
    const mz = Math.floor(m / w);
    const amb: number[] = [];
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = mx + dx;
        const z = mz + dz;
        if (x < 0 || z < 0 || x >= w || z >= d) continue;
        const c = cells[z * w + x];
        if (c !== undefined && c.options.length > 1) amb.push(z * w + x);
      }
    }
    if (amb.length === 0 || amb.length > 12) continue;
    let best = amb.map((j) => choice[j]!);
    let bestScore = localUnstable(mx, mz, 4);
    for (let bits = 0; bits < 1 << amb.length; bits++) {
      const trial = amb.map((_, k) => (bits >> k) & 1);
      trial.forEach((v, k) => (choice[amb[k]!] = v));
      const sc = localUnstable(mx, mz, 4);
      if (sc < bestScore) {
        bestScore = sc;
        best = trial;
      }
    }
    best.forEach((v, k) => (choice[amb[k]!] = v));
  }
  return allUnstable();
}

// ---------------------------------------------------------------- Debug-Ausgabe

/** ASCII: Fläche als Treppenrichtung bergauf (^ > v <), Grat 'o', Kehle 'x', First '=', Sattel '?', flach '_', Stufenring '-'. */
export function renderRoof(roof: Pick<HipRoof, 'w' | 'd' | 'cells' | 'choice'>): string {
  const arrow: Record<HorizontalDir, string> = { north: '^', east: '>', south: 'v', west: '<' };
  const rows: string[] = [];
  for (let z = 0; z < roof.d; z++) {
    let r = '';
    for (let x = 0; x < roof.w; x++) {
      const c = roof.cells[z * roof.w + x];
      if (c === undefined) r += '.';
      else if (c.cls === 'ridge') r += '=';
      else if (c.cls === 'flat') r += '_';
      else if (c.cls === 'saddle') r += '?';
      else if (c.cls === 'hip') r += 'o';
      else if (c.cls === 'valley') r += 'x';
      else if (c.options.length === 0) r += '-';
      else r += arrow[c.options[roof.choice[z * roof.w + x]!]!.facing];
    }
    rows.push(r);
  }
  return rows.join('\n');
}

/** ASCII: Höhenkarte (d als Ziffer/Buchstabe). */
export function renderHeights(dist: Int32Array, w: number, d: number): string {
  const rows: string[] = [];
  for (let z = 0; z < d; z++) {
    let r = '';
    for (let x = 0; x < w; x++) {
      const v = dist[z * w + x]!;
      r += v <= 0 ? '.' : v < 10 ? String(v) : String.fromCharCode(55 + v);
    }
    rows.push(r);
  }
  return rows.join('\n');
}
