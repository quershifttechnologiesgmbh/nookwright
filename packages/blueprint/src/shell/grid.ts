import { HORIZONTAL, type Cell, type HorizontalDir } from '@mcda/core';

/**
 * Internes Raster der Hüllen-Ableitung: ein achsparalleler Ausschnitt der Welt (Bounding Box der Räume plus Rand).
 * Lokale Koordinaten (x, z) ∈ [0, w) × [0, d); Welt = (x0 + x, z0 + z). Index i = z · w + x.
 * Der Rand ist so breit, dass Wände nie am Rasterrand liegen und der Dachüberstand hineinpasst.
 */
export interface Frame {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly d: number;
}

export const DIRS: readonly HorizontalDir[] = HORIZONTAL;

export const STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

/** Bits der 4er-Maske (N=1, E=2, S=4, W=8). */
export const BIT: Readonly<Record<HorizontalDir, number>> = { north: 1, east: 2, south: 4, west: 8 };

export const CW: Readonly<Record<HorizontalDir, HorizontalDir>> = { north: 'east', east: 'south', south: 'west', west: 'north' };
export const CCW: Readonly<Record<HorizontalDir, HorizontalDir>> = { north: 'west', west: 'south', south: 'east', east: 'north' };
export const OPP: Readonly<Record<HorizontalDir, HorizontalDir>> = { north: 'south', south: 'north', east: 'west', west: 'east' };

export const axisOf = (d: HorizontalDir): 'x' | 'z' => (d === 'east' || d === 'west' ? 'x' : 'z');

export const N8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export function frameAround(cells: Iterable<Cell>, pad: number): Frame {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of cells) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (minX === Infinity) return { x0: 0, z0: 0, w: 0, d: 0 };
  return { x0: minX - pad, z0: minZ - pad, w: maxX - minX + 1 + 2 * pad, d: maxZ - minZ + 1 + 2 * pad };
}

export const inFrame = (f: Frame, x: number, z: number): boolean => x >= 0 && z >= 0 && x < f.w && z < f.d;

/** Weltzelle eines Index. */
export const worldCell = (f: Frame, i: number): Cell => [f.x0 + (i % f.w), f.z0 + Math.floor(i / f.w)];

/** Chebyshev-Abstand zweier Indizes. */
export function chebIdx(f: Frame, a: number, b: number): number {
  return Math.max(Math.abs((a % f.w) - (b % f.w)), Math.abs(Math.floor(a / f.w) - Math.floor(b / f.w)));
}

/**
 * Außenraum, der mit dem Rasterrand zusammenhängt (4er-Nachbarschaft über Label 0).
 * Innenhöfe (Label 0, aber von Räumen umschlossen) gehören nicht dazu.
 */
export function openOutside(f: Frame, labels: Int32Array): Uint8Array {
  const out = new Uint8Array(f.w * f.d);
  const stack: number[] = [];
  const seed = (x: number, z: number) => {
    const i = z * f.w + x;
    if (labels[i] === 0 && out[i] === 0) {
      out[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < f.w; x++) {
    seed(x, 0);
    seed(x, f.d - 1);
  }
  for (let z = 0; z < f.d; z++) {
    seed(0, z);
    seed(f.w - 1, z);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % f.w;
    const z = Math.floor(i / f.w);
    for (const dir of DIRS) {
      const nx = x + STEP[dir][0];
      const nz = z + STEP[dir][1];
      if (inFrame(f, nx, nz)) seed(nx, nz);
    }
  }
  return out;
}
