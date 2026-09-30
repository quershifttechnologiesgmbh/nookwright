/**
 * Wand-Extraktion nach research/03 §C4, Modell „Außenmaß“ (übernommen aus Spike T4, spikes/algorithms/src/walls.ts):
 * gemalte Zellen = Grundfläche inklusive Wand; Wand = Randband der Region in der 8er-Nachbarschaft,
 * gemeinsame Wände trägt der Raum, der die Prioritätsregel verliert. Dadurch ist jede gemeinsame Wand
 * genau 1 Block dick, zwei Böden verschiedener Räume berühren sich nie (auch nicht diagonal), und kein
 * Boden grenzt an außen (Beweis im Spike-Bericht §1).
 */
import { BIT, DIRS, N8, STEP, inFrame, type Frame } from './grid.js';

export const EMPTY = 0;
export const FLOOR = 1;
export const WALL = 2;

/** Wandklassen aus der 4-Bit-Maske der Wandnachbarn. */
export const WC = { NONE: 0, STRAIGHT: 1, CORNER: 2, T: 3, CROSS: 4, END: 5, PILLAR: 6 } as const;
export type WallClassCode = (typeof WC)[keyof typeof WC];

export interface WallRun {
  /** 'x' = Lauf entlang x (die Wand trennt Norden/Süden), 'z' = entlang z. */
  readonly axis: 'x' | 'z';
  /** Zellindizes in aufsteigender Koordinate. */
  readonly cells: readonly number[];
  /** Alle Zellen grenzen an außen (Label 0). */
  readonly exterior: boolean;
}

export interface WallPlan {
  readonly frame: Frame;
  /** Raum-Label je Zelle (0 = außen, 1..n = Raum). */
  readonly labels: Int32Array;
  /** EMPTY | FLOOR | WALL. */
  readonly kind: Uint8Array;
  /** 4-Bit-Maske der Wandnachbarn (nur Wandzellen). */
  readonly mask: Uint8Array;
  readonly cls: Uint8Array;
  readonly exterior: Uint8Array;
  readonly runs: readonly WallRun[];
  /** Index des Wandlaufs je Zelle, sonst −1. */
  readonly runOf: Int32Array;
  /** Position im Wandlauf je Zelle, sonst −1. */
  readonly posInRun: Int32Array;
}

export function classOfMask(m: number): WallClassCode {
  const bits = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
  if (bits === 0) return WC.PILLAR;
  if (bits === 1) return WC.END;
  if (bits === 3) return WC.T;
  if (bits === 4) return WC.CROSS;
  if (m === (BIT.north | BIT.south) || m === (BIT.east | BIT.west)) return WC.STRAIGHT;
  return WC.CORNER;
}

/**
 * @param prio Priorität je Label (Index = Label); höher gewinnt und behält die lichte Breite.
 *             Gleichstand: das kleinere Label gewinnt.
 */
export function computeWalls(frame: Frame, labels: Int32Array, prio: ArrayLike<number>): WallPlan {
  const { w, d } = frame;
  const n = w * d;
  const lab = (x: number, z: number): number => (inFrame(frame, x, z) ? labels[z * w + x]! : 0);
  const wins = (m: number, l: number): boolean => prio[m]! > prio[l]! || (prio[m] === prio[l] && m < l);

  const kind = new Uint8Array(n);
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const l = labels[z * w + x]!;
      if (l === 0) continue;
      let wall = false;
      for (const [dx, dz] of N8) {
        const m = lab(x + dx, z + dz);
        if (m === l) continue;
        if (m === 0 || wins(m, l)) {
          wall = true;
          break;
        }
      }
      kind[z * w + x] = wall ? WALL : FLOOR;
    }
  }

  const mask = new Uint8Array(n);
  const cls = new Uint8Array(n);
  const exterior = new Uint8Array(n);
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      if (kind[i] !== WALL) continue;
      let m = 0;
      let ext = 0;
      for (const dir of DIRS) {
        const nx = x + STEP[dir][0];
        const nz = z + STEP[dir][1];
        if (inFrame(frame, nx, nz) && kind[nz * w + nx] === WALL) m |= BIT[dir];
        if (lab(nx, nz) === 0) ext = 1;
      }
      mask[i] = m;
      cls[i] = classOfMask(m);
      exterior[i] = ext;
    }
  }

  // Wandläufe: maximale Folgen von STRAIGHT-Zellen gleicher Achse (zwischen Pfeilern, Ecken, T, Enden).
  const runs: WallRun[] = [];
  const runOf = new Int32Array(n).fill(-1);
  const posInRun = new Int32Array(n).fill(-1);
  const straightAlong = (x: number, z: number, m: number): boolean => inFrame(frame, x, z) && cls[z * w + x] === WC.STRAIGHT && mask[z * w + x] === m;
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const i = z * w + x;
      if (cls[i] !== WC.STRAIGHT || runOf[i]! >= 0) continue;
      const m = mask[i]!;
      const horizontal = m === (BIT.east | BIT.west);
      const [dx, dz] = horizontal ? [1, 0] : [0, 1];
      let sx = x;
      let sz = z;
      while (straightAlong(sx - dx, sz - dz, m)) {
        sx -= dx;
        sz -= dz;
      }
      const cells: number[] = [];
      let ext = true;
      for (let cx = sx, cz = sz; straightAlong(cx, cz, m); cx += dx, cz += dz) {
        const ci = cz * w + cx;
        runOf[ci] = runs.length;
        posInRun[ci] = cells.length;
        cells.push(ci);
        ext &&= exterior[ci] === 1;
      }
      runs.push({ axis: horizontal ? 'x' : 'z', cells, exterior: ext });
    }
  }

  return { frame, labels, kind, mask, cls, exterior, runs, runOf, posInRun };
}

/** Anzahl der 4-Zusammenhangskomponenten der Bodenzellen eines Raums. */
export function floorParts(plan: WallPlan, label: number): number {
  const { frame, labels, kind } = plan;
  const seen = new Uint8Array(labels.length);
  let parts = 0;
  for (let i = 0; i < labels.length; i++) {
    if (seen[i] || labels[i] !== label || kind[i] !== FLOOR) continue;
    parts++;
    seen[i] = 1;
    const stack = [i];
    while (stack.length > 0) {
      const c = stack.pop()!;
      const x = c % frame.w;
      const z = Math.floor(c / frame.w);
      for (const dir of DIRS) {
        const nx = x + STEP[dir][0];
        const nz = z + STEP[dir][1];
        if (!inFrame(frame, nx, nz)) continue;
        const j = nz * frame.w + nx;
        if (!seen[j] && labels[j] === label && kind[j] === FLOOR) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return parts;
}

/** Raumpaare (a < b), die sich nur über Eck berühren (keine gemeinsame Kante → keine Tür möglich). */
export function diagonalOnlyContacts(plan: WallPlan): Array<readonly [number, number]> {
  const { frame, labels } = plan;
  const edge = new Set<string>();
  const diag = new Map<string, readonly [number, number]>();
  for (let z = 0; z < frame.d; z++) {
    for (let x = 0; x < frame.w; x++) {
      const a = labels[z * frame.w + x]!;
      if (a === 0) continue;
      for (const [dx, dz] of N8) {
        if (!inFrame(frame, x + dx, z + dz)) continue;
        const b = labels[(z + dz) * frame.w + x + dx]!;
        if (b === 0 || b === a) continue;
        const pair = a < b ? ([a, b] as const) : ([b, a] as const);
        const k = `${pair[0]}|${pair[1]}`;
        if (dx === 0 || dz === 0) edge.add(k);
        else diag.set(k, pair);
      }
    }
  }
  return [...diag.entries()]
    .filter(([k]) => !edge.has(k))
    .map(([, p]) => p)
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}
