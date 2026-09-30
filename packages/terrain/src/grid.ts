import type { Cell, HorizontalDir } from '@mcda/core';
import type { Plot } from './model.js';

export const N4: readonly (readonly [number, number, HorizontalDir])[] = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];
export const N8: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export const DIR_OFFSET: Readonly<Record<HorizontalDir, readonly [number, number]>> = {
  north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0],
};

const INF = 1 << 29;

/** Rasterindex über das Grundstück (Zeilen = z). Alle Arrays des Generators sind so indiziert. */
export class PlotGrid {
  readonly w: number;
  readonly d: number;
  readonly size: number;
  readonly minX: number;
  readonly minZ: number;

  constructor(readonly plot: Plot) {
    this.minX = plot.minX;
    this.minZ = plot.minZ;
    this.w = plot.maxX - plot.minX + 1;
    this.d = plot.maxZ - plot.minZ + 1;
    this.size = this.w * this.d;
  }

  inside(x: number, z: number): boolean {
    return x >= this.minX && z >= this.minZ && x < this.minX + this.w && z < this.minZ + this.d;
  }

  idx(x: number, z: number): number {
    return (x - this.minX) + (z - this.minZ) * this.w;
  }

  /** Index oder −1 außerhalb. */
  at(x: number, z: number): number {
    return this.inside(x, z) ? this.idx(x, z) : -1;
  }

  x(i: number): number {
    return this.minX + (i % this.w);
  }

  z(i: number): number {
    return this.minZ + Math.floor(i / this.w);
  }

  cell(i: number): Cell {
    return [this.x(i), this.z(i)];
  }

  /** 4er-Nachbarn im Grundstück. */
  n4(i: number): number[] {
    const x = this.x(i);
    const z = this.z(i);
    const out: number[] = [];
    for (const [dx, dz] of N4) {
      const j = this.at(x + dx, z + dz);
      if (j >= 0) out.push(j);
    }
    return out;
  }

  onBorder(i: number): boolean {
    const x = this.x(i) - this.minX;
    const z = this.z(i) - this.minZ;
    return x === 0 || z === 0 || x === this.w - 1 || z === this.d - 1;
  }

  /**
   * Abstand (in Schritten) jeder Zelle zur nächsten Quellzelle: `metric` 4 = Manhattan (4er-Nachbarn),
   * 8 = Chebyshev (8er-Nachbarn). Ohne Quelle: INF. `passable` begrenzt die Ausbreitung (Standard: alles).
   */
  distance(sources: Iterable<number>, metric: 4 | 8 = 4, passable?: (i: number) => boolean): Int32Array {
    const dist = new Int32Array(this.size).fill(INF);
    let queue: number[] = [];
    for (const s of sources) {
      if (dist[s] !== 0) {
        dist[s] = 0;
        queue.push(s);
      }
    }
    const offs = metric === 4 ? N4 : N8;
    for (let d = 1; queue.length > 0; d++) {
      const next: number[] = [];
      for (const i of queue) {
        const x = this.x(i);
        const z = this.z(i);
        for (const [dx, dz] of offs) {
          const j = this.at(x + dx, z + dz);
          if (j < 0 || dist[j]! <= d) continue;
          if (passable !== undefined && !passable(j)) continue;
          dist[j] = d;
          next.push(j);
        }
      }
      queue = next;
    }
    return dist;
  }

  /** 4-zusammenhängende Komponenten einer Indexmenge, jede aufsteigend sortiert; Reihenfolge nach kleinstem Index. */
  components(members: ReadonlySet<number>): number[][] {
    const seen = new Set<number>();
    const out: number[][] = [];
    for (const start of [...members].sort((a, b) => a - b)) {
      if (seen.has(start)) continue;
      const comp: number[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length > 0) {
        const i = stack.pop()!;
        comp.push(i);
        for (const j of this.n4(i)) {
          if (members.has(j) && !seen.has(j)) {
            seen.add(j);
            stack.push(j);
          }
        }
      }
      out.push(comp.sort((a, b) => a - b));
    }
    return out;
  }
}

export const UNREACHED = INF;
