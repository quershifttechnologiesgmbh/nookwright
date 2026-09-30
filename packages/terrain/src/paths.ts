/**
 * Wegführung (Haustür → Außenbereiche): Dijkstra auf dem Grundstücksraster mit Richtungszustand.
 * Kosten: Schritt 1 (auf vorhandenem Weg 0,4 → Wege bündeln sich zu einem Netz), Steigung +1,5 je Block,
 * Richtungswechsel +0,6 (gerade Wege). Deterministisch: Gleichstand nach Zustandsindex.
 */
import type { PlotGrid } from './grid.js';
import { N4 } from './grid.js';

export interface RouteCosts {
  /** false = nicht betretbar (Gebäude, Wasser, Felder, fremde Beete …). Ziele sind immer betretbar. */
  readonly passable: (i: number) => boolean;
  readonly heights: Int32Array;
  readonly onPath: (i: number) => boolean;
}

/** Kleiner Binär-Heap (Kosten, Zustand). */
class Heap {
  private readonly cost: number[] = [];
  private readonly item: number[] = [];

  get size(): number {
    return this.item.length;
  }

  push(c: number, s: number): void {
    this.cost.push(c);
    this.item.push(s);
    let i = this.item.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.cost[0]!, this.item[0]!];
    const lc = this.cost.pop()!;
    const li = this.item.pop()!;
    if (this.item.length > 0) {
      this.cost[0] = lc;
      this.item[0] = li;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.item.length && this.less(l, m)) m = l;
        if (r < this.item.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    return this.cost[a]! < this.cost[b]! || (this.cost[a] === this.cost[b] && this.item[a]! < this.item[b]!);
  }

  private swap(a: number, b: number): void {
    [this.cost[a], this.cost[b]] = [this.cost[b]!, this.cost[a]!];
    [this.item[a], this.item[b]] = [this.item[b]!, this.item[a]!];
  }
}

const TURN = 0.6;
const SLOPE = 1.5;
const REUSE = 0.4;

/**
 * Günstigster Weg von einer der Quellen zu einem der Ziele (Zellindizes, Quelle zuerst).
 * `undefined`, wenn kein Ziel erreichbar ist.
 */
export function route(grid: PlotGrid, sources: readonly number[], targets: ReadonlySet<number>, costs: RouteCosts): number[] | undefined {
  if (sources.length === 0 || targets.size === 0) return undefined;
  const states = grid.size * 4;
  const best = new Float64Array(states).fill(Infinity);
  const prev = new Int32Array(states).fill(-1);
  const heap = new Heap();
  for (const s of [...new Set(sources)].sort((a, b) => a - b)) {
    for (let d = 0; d < 4; d++) {
      best[s * 4 + d] = 0;
      heap.push(0, s * 4 + d);
    }
  }
  while (heap.size > 0) {
    const [c, st] = heap.pop();
    if (c > best[st]!) continue;
    const i = st >> 2;
    const dir = st & 3;
    if (targets.has(i)) {
      const path: number[] = [];
      for (let s = st; s >= 0; s = prev[s]!) {
        const cell = s >> 2;
        if (path[path.length - 1] !== cell) path.push(cell);
      }
      return path.reverse();
    }
    const x = grid.x(i);
    const z = grid.z(i);
    N4.forEach(([dx, dz], nd) => {
      const j = grid.at(x + dx, z + dz);
      if (j < 0) return;
      if (!targets.has(j) && !costs.passable(j)) return;
      const dh = Math.abs(costs.heights[j]! - costs.heights[i]!);
      if (dh > 1) return;
      const step = (costs.onPath(j) ? REUSE : 1) + SLOPE * dh + (nd !== dir && prev[st] !== -1 ? TURN : 0);
      const ns = j * 4 + nd;
      const nc = c + step;
      if (nc < best[ns]!) {
        best[ns] = nc;
        prev[ns] = st;
        heap.push(nc, ns);
      }
    });
  }
  return undefined;
}
