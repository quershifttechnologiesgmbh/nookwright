/**
 * MX-Q (DR2 §4 Nr. 1, DR0 Nr. 9): drei weiche Silhouetten- und Fassadenmaße aus Grundriss und Hülle. Reines Messen,
 * ändert nichts am Bau. Zielwerte gibt es nicht aus der Literatur; die Bereiche kalibriert `plan/spikes/MX_qualitaet.md`.
 *
 * - Articulation-Index (Grundriss und Frontansicht): Fläche der Silhouette / Fläche ihrer konvexen Hülle (Zellen als
 *   Einheitsquadrate). 1 = konvexer Kasten, kleiner = gegliederter Umriss (L-/T-Form, Turm, Anbau).
 * - Symmetrie-Differenz der Fassade: Mittel aus Spiegel-Differenz der Frontansicht (über die ganze Front, also auch
 *   zwischen Baukörpern) und Versatz der Öffnungen zwischen den Geschossen (Jaccard-Abstand der Öffnungsspalten
 *   übereinanderliegender Fensterbänder). 0 = spiegelsymmetrisch und achsgleich.
 * - Shannon-Entropie des Fassadenrasters der Front (Wand, Fenster, Tür) in Bit; 0 = nur Wand, höchstens log2(3).
 */
import type { Shell, ShellCell } from '@mcda/blueprint';
import type { Cell, HorizontalDir } from '@mcda/core';

/** Zellarten der Wandebene (Fassadenraster). */
const WALL_PLANE: ReadonlySet<string> = new Set(['wall', 'pillar', 'door', 'lintel', 'window']);
/** Zellarten der Masse in der Frontansicht (ohne Außenprofil, Treppen, Geländer, Boden). */
const BODY: ReadonlySet<string> = new Set(['wall', 'pillar', 'door', 'lintel', 'window', 'ceiling', 'roof']);

export interface FacadeMeasures {
  /** Grundriss-Fläche / Fläche der konvexen Hülle (0–1). */
  readonly articulationPlan: number;
  /** Frontansicht-Fläche / Fläche der konvexen Hülle (0–1). */
  readonly articulationFront: number;
  /** Mittel aus `mirrorDiff` und `floorDiff` (0–1, 0 = symmetrisch). */
  readonly facadeSymmetry: number;
  /** Anteil der Öffnungszellen der Front ohne Gegenstück im Spiegelbild (0–1). */
  readonly mirrorDiff: number;
  /** Mittlerer Jaccard-Abstand der Öffnungsspalten übereinanderliegender Fensterbänder (0–1). */
  readonly floorDiff: number;
  /** Shannon-Entropie Wand/Fenster/Tür des Frontrasters in Bit (0–log2 3). */
  readonly facadeEntropy: number;
  /** Zellen im Frontraster (Wand, Fenster, Tür). */
  readonly frontCells: number;
}

type Point = readonly [number, number];

/** Fläche der konvexen Hülle der Einheitsquadrate über `cells` (Monotone Chain, Gauß'sche Trapezformel). */
export function hullArea(cells: Iterable<Point>): number {
  const pts = new Map<string, Point>();
  for (const [a, b] of cells) for (const [da, db] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) pts.set(`${a + da},${b + db}`, [a + da, b + db]);
  const p = [...pts.values()].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  if (p.length < 3) return 0;
  const cross = (o: Point, a: Point, b: Point): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point[]): Point[] => {
    const h: Point[] = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  const hull = [...half(p), ...half([...p].reverse())];
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!, b = hull[(i + 1) % hull.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) / 2;
}

/** Fläche / konvexe Hülle; leere Menge = 1 (nichts gegliedert). */
export function articulation(cells: Iterable<Point>): number {
  const set = new Map<string, Point>();
  for (const c of cells) set.set(`${c[0]},${c[1]}`, c);
  const hull = hullArea(set.values());
  return hull === 0 ? 1 : set.size / hull;
}

/** Waagerechte Achse u und Tiefe (größer = weiter vorn) einer Zelle aus Sicht der Front. */
function frame(front: HorizontalDir): { u: (x: number, z: number) => number; depth: (x: number, z: number) => number } {
  switch (front) {
    case 'south': return { u: (x) => x, depth: (_x, z) => z };
    case 'north': return { u: (x) => -x, depth: (_x, z) => -z };
    case 'east': return { u: (_x, z) => -z, depth: (x) => x };
    case 'west': return { u: (_x, z) => z, depth: (x) => -x };
  }
}

type Cls = 'wall' | 'window' | 'door';
const clsOf = (c: ShellCell): Cls => (c.kind === 'window' ? 'window' : c.kind === 'door' ? 'door' : 'wall');

/** Frontraster: je (u, y) die vorderste Zelle der Wandebene ab `minY`. */
export function frontRaster(cells: readonly ShellCell[], front: HorizontalDir, minY: number): Map<string, FrontRasterCell> {
  const f = frame(front);
  const best = new Map<string, FrontRasterCell & { readonly d: number }>();
  for (const c of cells) {
    if (!WALL_PLANE.has(c.kind) || c.pos[1] < minY) continue;
    const u = f.u(c.pos[0], c.pos[2]);
    const d = f.depth(c.pos[0], c.pos[2]);
    const k = `${u},${c.pos[1]}`;
    const old = best.get(k);
    if (old === undefined || d > old.d) best.set(k, { u, y: c.pos[1], d, cls: clsOf(c), cell: c });
  }
  return new Map([...best].map(([k, { d: _d, ...v }]) => [k, v]));
}

/** Zelle des Frontrasters: Lage in der Ansicht, Klasse und die vorderste Hüllenzelle. */
export interface FrontRasterCell {
  readonly u: number;
  readonly y: number;
  readonly cls: 'wall' | 'window' | 'door';
  readonly cell: ShellCell;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Die Maße aus Hülle, Grundriss (Zellen der Räume ab Erdgeschoss) und Frontrichtung. `minY`: unterste Zeile der
 * Wandebene (Standard: kleinstes `baseY` der Räume ab Erdgeschoss, also ohne Kellerwände).
 */
export function facadeMeasures(shell: Pick<Shell, 'cells' | 'rooms'>, footprint: Iterable<Cell>, front: HorizontalDir, minY?: number): FacadeMeasures {
  const upper = [...shell.rooms.values()].filter((r) => r.floorIndex >= 0).map((r) => r.baseY);
  const y0 = minY ?? (upper.length > 0 ? Math.min(...upper) : 0);
  const f = frame(front);
  const articulationPlan = articulation(footprint);
  const body: Point[] = shell.cells.filter((c) => BODY.has(c.kind) && c.pos[1] >= y0).map((c) => [f.u(c.pos[0], c.pos[2]), c.pos[1]]);
  const articulationFront = articulation(body);
  const raster = frontRaster(shell.cells, front, y0);
  const us = [...raster.values()].map((r) => r.u);
  const mid = us.length === 0 ? 0 : Math.min(...us) + Math.max(...us);
  const open = (r: { cls: Cls } | undefined): boolean => r !== undefined && r.cls !== 'wall';
  let pairs = 0, diff = 0;
  for (const r of raster.values()) {
    const m = raster.get(`${mid - r.u},${r.y}`);
    if (!open(r) && !open(m)) continue;
    pairs++;
    if (m?.cls !== r.cls) diff++;
  }
  const mirrorDiff = pairs === 0 ? 0 : diff / pairs;
  // Fensterbänder: zusammenhängende Zeilen mit Öffnungen; je Band die Spalten der Öffnungen
  const rows = new Map<number, Set<number>>();
  for (const r of raster.values()) if (open(r)) (rows.get(r.y) ?? rows.set(r.y, new Set()).get(r.y)!).add(r.u);
  const bands: Set<number>[] = [];
  let last = -Infinity;
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    if (y !== last + 1 || bands.length === 0) bands.push(new Set());
    for (const u of rows.get(y)!) bands[bands.length - 1]!.add(u);
    last = y;
  }
  const jac = (a: Set<number>, b: Set<number>): number => {
    const inter = [...a].filter((u) => b.has(u)).length;
    return 1 - inter / (a.size + b.size - inter);
  };
  const steps = bands.slice(1).map((b, i) => jac(bands[i]!, b));
  const floorDiff = steps.length === 0 ? 0 : steps.reduce((s, v) => s + v, 0) / steps.length;
  const counts = { wall: 0, window: 0, door: 0 };
  for (const r of raster.values()) counts[r.cls]++;
  const n = raster.size;
  const facadeEntropy = n === 0 ? 0 : -Object.values(counts).filter((c) => c > 0).reduce((s, c) => s + (c / n) * Math.log2(c / n), 0);
  return {
    articulationPlan: round(articulationPlan), articulationFront: round(articulationFront),
    facadeSymmetry: round((mirrorDiff + floorDiff) / 2), mirrorDiff: round(mirrorDiff), floorDiff: round(floorDiff),
    facadeEntropy: Math.abs(round(facadeEntropy)), frontCells: n,
  };
}

/**
 * Vorsichtige weiche Bänder (MX-Q, kalibriert an 408 Welten: 12 Bautypen × 17 Themes × Seeds 5, 11, Größe M; Bericht
 * plan/spikes/MX_qualitaet.md). Sie markieren nur Ausreißer jenseits des gemessenen Korpus (Minimum Grundriss 0,685,
 * Front 0,65, Entropie 0,258–0,925); die Symmetrie-Differenz ist Stilfrage (Burg 0,57, Reihenhaus 0) und hat kein Band.
 */
export const FACADE_MEASURE_BANDS: Readonly<Partial<Record<'articulationPlan' | 'articulationFront' | 'facadeEntropy', readonly [number, number]>>> = {
  articulationPlan: [0.6, 1],
  articulationFront: [0.6, 1],
  facadeEntropy: [0.2, 1.2],
};

/** Befunde der Fassadenmaße außerhalb von {@link FACADE_MEASURE_BANDS} (Text, leer = im Band). */
export function facadeMeasureLints(m: FacadeMeasures): string[] {
  return (Object.entries(FACADE_MEASURE_BANDS) as [keyof typeof FACADE_MEASURE_BANDS, readonly [number, number]][])
    .filter(([id, [lo, hi]]) => m[id] < lo || m[id] > hi)
    .map(([id, [lo, hi]]) => `Fassade: ${id} ${m[id]} außerhalb ${lo}–${hi}`);
}
