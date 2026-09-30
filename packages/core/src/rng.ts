/**
 * Deterministischer Zufall. Die Domäne verwendet NIE Math.random – aller Zufall
 * kommt aus Seeds, damit Neu-Würfeln, Sperren und Tests reproduzierbar sind.
 */

/** 32-Bit-Hash (FNV-1a + Murmur3-Finalizer) über beliebige Teile → uint32-Seed. */
export function hashSeed(...parts: ReadonlyArray<string | number>): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = typeof part === 'number' ? `#${part}` : `$${part}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0xff; // Trenner zwischen Teilen
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mulberry32 – klein, schnell, gut genug für Platzierungsentscheidungen. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Gleichverteilt in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Ganzzahl in [min, max] (beide inklusive). */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`int(${min}, ${max}): max < min`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() auf leerer Liste');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Gewichtete Auswahl; Gewichte ≤ 0 werden nie gewählt. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) throw new RangeError('weighted(): Summe der Gewichte ist 0');
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1]!;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  /** Unabhängiger Teil-Strom, stabil über den Namen (verhindert Kaskaden bei Änderungen). */
  fork(label: string | number): Rng {
    return new Rng(hashSeed(this.state, label));
  }
}
