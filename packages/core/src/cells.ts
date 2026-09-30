/** Zelle = Blockspalte (x, z) auf einer Etage. */
export type Cell = readonly [x: number, z: number];

export const cellKey = (x: number, z: number): string => `${x},${z}`;

function parseKey(k: string): Cell {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}

export interface Bounds2 {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

const N4: readonly Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Unveränderliche Zellmenge (Wertobjekt). */
export class CellSet {
  private readonly keys: ReadonlySet<string>;

  private constructor(keys: ReadonlySet<string>) {
    this.keys = keys;
  }

  static empty(): CellSet {
    return new CellSet(new Set());
  }

  static of(cells: Iterable<Cell>): CellSet {
    const s = new Set<string>();
    for (const [x, z] of cells) s.add(cellKey(x, z));
    return new CellSet(s);
  }

  /** Rechteck inklusive beider Ecken, unabhängig von der Reihenfolge. */
  static rect(x1: number, z1: number, x2: number, z2: number): CellSet {
    const s = new Set<string>();
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) s.add(cellKey(x, z));
    }
    return new CellSet(s);
  }

  get size(): number {
    return this.keys.size;
  }

  get isEmpty(): boolean {
    return this.keys.size === 0;
  }

  has(x: number, z: number): boolean {
    return this.keys.has(cellKey(x, z));
  }

  *[Symbol.iterator](): IterableIterator<Cell> {
    for (const k of this.keys) yield parseKey(k);
  }

  toArray(): Cell[] {
    return [...this].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  union(other: CellSet): CellSet {
    return new CellSet(new Set([...this.keys, ...other.keys]));
  }

  difference(other: CellSet): CellSet {
    return new CellSet(new Set([...this.keys].filter((k) => !other.keys.has(k))));
  }

  intersection(other: CellSet): CellSet {
    return new CellSet(new Set([...this.keys].filter((k) => other.keys.has(k))));
  }

  intersects(other: CellSet): boolean {
    const [small, big] = this.size <= other.size ? [this, other] : [other, this];
    for (const k of small.keys) if (big.keys.has(k)) return true;
    return false;
  }

  equals(other: CellSet): boolean {
    return this.size === other.size && [...this.keys].every((k) => other.keys.has(k));
  }

  bounds(): Bounds2 | undefined {
    if (this.isEmpty) return undefined;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of this) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return { minX, minZ, maxX, maxZ };
  }

  /** 4-zusammenhängende Komponenten, größte zuerst (bei Gleichstand stabil nach kleinster Zelle). */
  components(): CellSet[] {
    const seen = new Set<string>();
    const result: CellSet[] = [];
    for (const start of this.toArray()) {
      const sk = cellKey(start[0], start[1]);
      if (seen.has(sk)) continue;
      const comp = new Set<string>([sk]);
      seen.add(sk);
      const queue: Cell[] = [start];
      while (queue.length > 0) {
        const [x, z] = queue.pop()!;
        for (const [dx, dz] of N4) {
          const nk = cellKey(x + dx, z + dz);
          if (this.keys.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            comp.add(nk);
            queue.push([x + dx, z + dz]);
          }
        }
      }
      result.push(new CellSet(comp));
    }
    return result.sort((a, b) => b.size - a.size);
  }

  isConnected(): boolean {
    return this.size <= 1 || this.components().length === 1;
  }
}
