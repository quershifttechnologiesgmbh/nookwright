/**
 * Raster-Geometrie für Bauwerke: Polyline mit Bogenlänge, nächster Punkt, Seiten; Turm-Grundrisse (Quadrat,
 * Kreis im Raster), Richtungen. Rein und deterministisch (nur IEEE-exakte Operationen: + − × ÷ √).
 */
import type { Cell, HorizontalDir } from '@mcda/core';

/** Numerischer Spaltenschlüssel (|x|, |z| < 32768), wie in der Materialisierung. */
export const colKey = (x: number, z: number): number => (x + 0x8000) * 0x10000 + (z + 0x8000);

export const DIR_XZ: Readonly<Record<HorizontalDir, readonly [number, number]>> = {
  north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0],
};

/** Die vier Richtungen in fester Reihenfolge (N, O, S, W). */
export const N4: readonly (readonly [number, number, HorizontalDir])[] = [
  [0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west'],
];

export function dirTo(dx: number, dz: number): HorizontalDir {
  for (const [x, z, d] of N4) if (x === dx && z === dz) return d;
  throw new Error(`keine Achsenrichtung: ${dx},${dz}`);
}

/** Dominante Achse eines Vektors (Gleichstand → x-Achse). */
export function snapDir(vx: number, vz: number): HorizontalDir {
  if (Math.abs(vx) >= Math.abs(vz)) return vx >= 0 ? 'east' : 'west';
  return vz >= 0 ? 'south' : 'north';
}

/** Monotoner Ersatz für atan2 in [0, 4) (Rauten-Winkel) – exakt reproduzierbar, nur für Sortierungen. */
export function pseudoAngle(dx: number, dz: number): number {
  if (dx === 0 && dz === 0) return 0;
  if (dz >= 0) return dx >= 0 ? dz / (dx + dz) : 1 - dx / (-dx + dz);
  return dx < 0 ? 2 - dz / (-dx - dz) : 3 + dx / (dx - dz);
}

const EPS = 1e-9;

export interface Segment {
  readonly ax: number;
  readonly az: number;
  readonly len: number;
  /** Einheitsrichtung. */
  readonly ux: number;
  readonly uz: number;
  /** Bogenlänge am Anfang. */
  readonly s0: number;
}

export interface Nearest {
  readonly seg: number;
  /** Bogenlänge des Fußpunkts. */
  readonly s: number;
  readonly dist: number;
  /** Vorzeichenbehafteter Abstand zur (unbegrenzten) Segmentgeraden, + = links der Zeichenrichtung. */
  readonly left: number;
  /** Lage entlang des Segments (unbegrenzt): < 0 vor dem Anfang, > len hinter dem Ende. */
  readonly t: number;
}

/** Polyline über Zellmitten mit Bogenlänge. Doppelte Punkte werden entfernt. */
export class Polyline {
  readonly points: readonly Cell[];
  readonly segments: readonly Segment[];
  readonly total: number;

  constructor(points: readonly Cell[], readonly closed: boolean) {
    const pts: Cell[] = [];
    for (const p of points) {
      const last = pts[pts.length - 1];
      if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) pts.push([p[0], p[1]]);
    }
    if (closed && pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts.pop();
    this.points = pts;
    const segs: Segment[] = [];
    let s = 0;
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n && pts.length > 1; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push({ ax: a[0], az: a[1], len, ux: (b[0] - a[0]) / len, uz: (b[1] - a[1]) / len, s0: s });
      s += len;
    }
    this.segments = segs;
    this.total = s;
  }

  /** Nächster Punkt auf der Polyline (Gleichstand → kleinerer Segmentindex). */
  nearest(x: number, z: number): Nearest {
    let best: Nearest | undefined;
    this.segments.forEach((g, i) => {
      const t = (x - g.ax) * g.ux + (z - g.az) * g.uz;
      const tc = t < 0 ? 0 : t > g.len ? g.len : t;
      const dist = Math.hypot(x - (g.ax + g.ux * tc), z - (g.az + g.uz * tc));
      if (best === undefined || dist < best.dist - EPS) {
        best = { seg: i, s: g.s0 + tc, dist, left: (x - g.ax) * g.uz - (z - g.az) * g.ux, t };
      }
    });
    if (best === undefined) throw new Error('Polyline ohne Segmente');
    return best;
  }

  /** Punkt (reell) bei Bogenlänge s (geschlossen: zyklisch, offen: begrenzt). */
  pointAt(s: number): { x: number; z: number; seg: number } {
    const w = this.closed ? ((s % this.total) + this.total) % this.total : Math.min(Math.max(s, 0), this.total);
    let i = this.segments.findIndex((g) => w < g.s0 + g.len - EPS);
    if (i < 0) i = this.segments.length - 1;
    const g = this.segments[i]!;
    const t = w - g.s0;
    return { x: g.ax + g.ux * t, z: g.az + g.uz * t, seg: i };
  }

  /** Bogenlängen-Differenz b − a (geschlossen: kürzester Weg um den Ring). */
  delta(a: number, b: number): number {
    const d = b - a;
    if (!this.closed) return d;
    const m = ((d % this.total) + this.total) % this.total;
    return m > this.total / 2 ? m - this.total : m;
  }

  /** Bogenlänge des Stützpunkts i. */
  vertexS(i: number): number {
    return i < this.segments.length ? this.segments[i]!.s0 : this.total;
  }

  /** Knick am Stützpunkt i als Kosinus zwischen ein- und ausgehender Richtung (1 = gerade); Enden: undefined. */
  turnCos(i: number): number | undefined {
    const n = this.points.length;
    if (!this.closed && (i === 0 || i === n - 1)) return undefined;
    const a = this.segments[(i - 1 + this.segments.length) % this.segments.length]!;
    const b = this.segments[i % this.segments.length]!;
    return a.ux * b.ux + a.uz * b.uz;
  }
}

/** Punkt-in-Polygon (gerade/ungerade) für reelle Punkte. */
export function insidePolygon(points: readonly Cell[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]!;
    const [xj, zj] = points[j]!;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- Turm-Grundrisse

/** Liegt der Versatz (dx, dz) im Grundriss mit Radius r? Kreis: dx² + dz² ≤ (r + ½)² (ganzzahlig geprüft). */
export function inFootprint(shape: 'round' | 'square', r: number, dx: number, dz: number): boolean {
  if (shape === 'square') return Math.abs(dx) <= r && Math.abs(dz) <= r;
  return 4 * (dx * dx + dz * dz) <= (2 * r + 1) * (2 * r + 1);
}

/** Alle Versätze im Grundriss, sortiert (z, dann x). */
export function footprintOffsets(shape: 'round' | 'square', r: number): Cell[] {
  const out: Cell[] = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (inFootprint(shape, r, dx, dz)) out.push([dx, dz]);
  return out;
}

/**
 * Dachring eines Versatzes im Dachgrundriss (Radius r + 1, 0 = Überstand, 1 = über der Außenwand):
 * eckig → Chebyshev (Zeltdach = Walmdach auf dem Quadrat, research/03 §C9), rund → euklidisch (Kegel).
 */
export function roofRing(shape: 'round' | 'square', r: number, dx: number, dz: number): number {
  if (shape === 'square') return r + 1 - Math.max(Math.abs(dx), Math.abs(dz));
  return Math.floor(r + 1.5 - Math.sqrt(dx * dx + dz * dz));
}
