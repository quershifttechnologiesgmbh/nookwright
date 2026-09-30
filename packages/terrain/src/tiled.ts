/**
 * Tiled-WFC im Gelände (feat/tiled-wfc, Bericht plan/spikes/F_tiled_wfc.md §3). Nur mit
 * `SiteGenerateOptions.tiled`; ohne bleibt das Gelände bitgleich.
 *
 *  - **Pflaster** für Platz und Hof (`pavingPattern`): echtes 2D-WFC je Zelle. Kacheln Feld `F`, Band längs x `H`,
 *    Band längs z `V`, Kreuzung `X`, Stein-Punkt `D` und Randband `E`. Bänder laufen durch, bis sie auf den Rand oder
 *    ein Hindernis treffen; zwei Bänder liegen nie direkt nebeneinander; Punkte nur im Feld. Das Muster ist an beiden
 *    Achsen der Zone gespiegelt (Bindungen), soweit die Spiegelzelle zur Zone gehört.
 *  - **Beete** im Garten (`gardenPlan`): zwei Lauflängen-Ketten (Reihen quer, Spalten längs, je ein Palindrom) legen
 *    das Wegenetz; die Beet-Rechtecke dazwischen bekommen ihre Pflanze aus einem zweiten WFC auf dem Rechteck-Raster
 *    (Nachbarn über einen Weg verschieden, an beiden Achsen gespiegelt).
 *  - **Feldbänder** (`fieldCrops`): Frucht je 3er-Band als Kette (Nachbarbänder verschieden, gespiegelt).
 *
 * Jedes Muster wird zusätzlich mit `findPinwheels` geprüft (Projektregel: keine Windrad-/Hakenkreuz-Motive); ein
 * Treffer gilt als Widerspruch → neuer Versuch mit Teil-Strom, zuletzt der bisherige Weg (Rückfall, gezählt).
 */
import {
  chainGrid, findPinwheels, grid2d, hashSeed, palindromeTies, runChainModel, socketModel, solveWfc, wfcViolations,
  type SocketTile, type WfcGrid, type WfcTie,
} from '@mcda/core';
import type { PlotGrid } from './grid.js';
import { CROP_ROLES, type TerrainRole } from './roles.js';

/** Feature-Schalter des Geländes (Standard aus). */
export interface TiledTerrain {
  /** Theme für die Kachelgewichte. */
  readonly themeId?: string;
}

/** Ein Eintrag des Berichts je gelöstem Muster (nur mit Schalter). */
export interface TiledEntry {
  readonly zoneId: string;
  readonly app: 'paving' | 'garden' | 'field';
  /** WFC-Muster übernommen (false = Rückfall auf den festen Weg). */
  readonly ok: boolean;
  readonly backtracks: number;
  /** Versuche wegen Windrad-Treffern verworfen. */
  readonly rejected: number;
  /** Harte Verstöße des übernommenen Musters (unabhängig geprüft; muss 0 sein). */
  readonly violations: number;
  /** Kurzform des Musters für die Vielfalt (gleiche Signatur = gleiches Muster). */
  readonly signature: string;
}

// ------------------------------------------------------------------ Gewichte je Theme

export interface PavingWeights {
  /** Band (je Zelle; klein halten – ein Band läuft durch die ganze Zone). */
  readonly band: number;
  readonly dot: number;
  /** Randband um den Platz. */
  readonly border: boolean;
}

export interface GardenWeights {
  /** Pflanzen der Beete und Gewicht. */
  readonly plants: ReadonlyArray<readonly [TerrainRole, number]>;
  /** Breite der Beetreihen (quer). */
  readonly rows: ReadonlyArray<readonly [number, number]>;
  /** Länge der Beete zwischen Querwegen. */
  readonly cols: ReadonlyArray<readonly [number, number]>;
}

const PAVING_DEFAULT: PavingWeights = { band: 0.08, dot: 0.03, border: true };
const PAVING: Readonly<Record<string, PavingWeights>> = {
  medieval: PAVING_DEFAULT,
  winter: PAVING_DEFAULT,
  harbor: { band: 0.09, dot: 0.02, border: true },
  rustic: { band: 0.04, dot: 0.03, border: false },
  timber: { band: 0.05, dot: 0.03, border: false },
  farmstead: { band: 0.03, dot: 0.04, border: false },
  nordic: { band: 0.06, dot: 0.02, border: true },
  nordic_falu: { band: 0.06, dot: 0.02, border: true },
  gothic: { band: 0.1, dot: 0.02, border: true },
  asian: { band: 0.05, dot: 0.06, border: false },
  steampunk: { band: 0.09, dot: 0.03, border: true },
  dwarven: { band: 0.12, dot: 0.01, border: true },
  elven: { band: 0.07, dot: 0.06, border: true },
  desert: { band: 0.13, dot: 0.04, border: true },
  tropical: { band: 0.06, dot: 0.05, border: false },
  ruin: { band: 0.04, dot: 0.05, border: false },
};

const GARDEN_DEFAULT: GardenWeights = {
  plants: [['flower_warm', 1], ['flower_cool', 1], ['leaves_bush', 0.15], ['flower_wild', 0.4]],
  rows: [[1, 0.25], [2, 1], [3, 0.3]],
  cols: [[2, 0.15], [3, 0.5], [4, 1], [5, 1], [6, 0.7], [7, 0.4], [8, 0.2]],
};
const GARDEN: Readonly<Record<string, GardenWeights>> = {
  medieval: GARDEN_DEFAULT,
  rustic: { ...GARDEN_DEFAULT, plants: [['flower_warm', 1], ['flower_wild', 1], ['flower_cool', 0.6], ['leaves_bush', 0.2]] },
  farmstead: { ...GARDEN_DEFAULT, plants: [['flower_wild', 1], ['flower_warm', 0.8], ['flower_cool', 0.5], ['leaves_bush', 0.2]] },
  elven: { ...GARDEN_DEFAULT, plants: [['flower_cool', 1.2], ['flower_warm', 0.6], ['leaves_bush', 0.6], ['flower_wild', 0.6]], cols: [[2, 0.2], [3, 1], [4, 1], [5, 0.6]] },
  dwarven: { ...GARDEN_DEFAULT, plants: [['leaves_bush', 0.8], ['flower_warm', 1], ['flower_cool', 0.4]], rows: [[2, 1], [3, 0.6]] },
  // FN-Themes: japanischer Garten (Büsche vor Blumen, kurze Beete), Gotik und Steampunk karg
  asian: { ...GARDEN_DEFAULT, plants: [['leaves_bush', 1], ['flower_wild', 0.8], ['flower_cool', 0.4]], cols: [[2, 0.2], [3, 1], [4, 1], [5, 0.5]] },
  gothic: { ...GARDEN_DEFAULT, plants: [['leaves_bush', 0.8], ['flower_cool', 1], ['flower_wild', 0.3]] },
  steampunk: { ...GARDEN_DEFAULT, plants: [['leaves_bush', 0.6], ['flower_warm', 0.8], ['flower_wild', 0.4]] },
  nordic_falu: { ...GARDEN_DEFAULT, plants: [['flower_wild', 1], ['flower_cool', 0.8], ['leaves_bush', 0.4]] },
  desert: { ...GARDEN_DEFAULT, plants: [['flower_warm', 1.2], ['leaves_bush', 0.5], ['flower_wild', 0.4]] },
  tropical: { ...GARDEN_DEFAULT, plants: [['flower_warm', 1], ['flower_cool', 1], ['leaves_bush', 0.8]] },
  ruin: { ...GARDEN_DEFAULT, plants: [['flower_wild', 1.5], ['leaves_bush', 0.6], ['flower_cool', 0.3]] },
};

export const pavingWeights = (themeId?: string): PavingWeights => PAVING[themeId ?? ''] ?? PAVING_DEFAULT;
export const gardenWeights = (themeId?: string): GardenWeights => GARDEN[themeId ?? ''] ?? GARDEN_DEFAULT;

const TRIES = 4;

// ------------------------------------------------------------------ Pflaster

const PAVE: readonly (SocketTile & { readonly role: TerrainRole })[] = [
  { id: 'F', weight: 1, sockets: ['f', 'f', 'f', 'f'], role: 'ground_yard' },
  { id: 'H', weight: 1, sockets: ['bh', 'bh', 'h', 'h'], role: 'path_stone' },
  { id: 'V', weight: 1, sockets: ['v', 'v', 'bv', 'bv'], role: 'path_stone' },
  { id: 'X', weight: 1, sockets: ['xh', 'xh', 'xv', 'xv'], role: 'plaza_accent' },
  { id: 'D', weight: 1, sockets: ['d', 'd', 'd', 'd'], role: 'plaza_accent' },
  { id: 'E', weight: 0, sockets: ['e', 'e', 'e', 'e'], role: 'path_stone' },
];
/**
 * Verträgliche Randcodes (symmetrisch): Feld an Feld, Bandseite (`h`/`v`) und Punkt nur an Feld; Band läuft in Band
 * oder Kreuzung weiter (`bh`/`xh` bzw. `bv`/`xv`), nie Kreuzung an Kreuzung (keine Flecken); Rand nimmt Feld, Band und
 * Kreuzung auf, aber keine Bandseite (kein Band direkt am Rand entlang).
 */
const PAVE_OK = new Set([
  'f|f', 'f|h', 'f|v', 'f|d', 'f|e', 'bh|bh', 'bh|xh', 'bv|bv', 'bv|xv', 'bh|e', 'bv|e', 'xh|e', 'xv|e', 'e|e',
]);
const PAVE_MODEL = socketModel(PAVE, [1, 0, 3, 2], (a, b) => PAVE_OK.has(`${a}|${b}`) || PAVE_OK.has(`${b}|${a}`));
const IDENTITY = PAVE.map((_, i) => i);
const E = 5;

/** Pflaster einer Zone: Rolle je Zelle oder `undefined` (Rückfall). `entry` bekommt den Bericht. */
export function pavingPattern(
  grid: PlotGrid, cells: readonly number[], zoneId: string, seed: number, themeId: string | undefined, entry: (e: TiledEntry) => void,
): Map<number, TerrainRole> | undefined {
  if (cells.length < 9) return undefined;
  const w = pavingWeights(themeId);
  const box = bounds(grid, cells);
  const set = new Set(cells);
  const lw = box.maxX - box.minX + 1;
  const ld = box.maxZ - box.minZ + 1;
  const local = (i: number): number => (grid.z(i) - box.minZ) * lw + (grid.x(i) - box.minX);
  const g = grid2d(lw, ld, (x, z) => set.has(grid.idx(box.minX + x, box.minZ + z)));
  const ties = mirrorTies(grid, cells, box, local, IDENTITY);
  const fixed = new Map<number, number[]>();
  if (w.border) for (const i of cells) if (grid.n4(i).length < 4 || grid.n4(i).some((j) => !set.has(j))) fixed.set(local(i), [E]);
  const weights = PAVE.map((t) => (t.id === 'F' ? 1 : t.id === 'D' ? w.dot : t.id === 'E' ? 0 : w.band));
  let rejected = 0;
  let backtracks = 0;
  for (let k = 0; k < TRIES; k++) {
    const r = solveWfc(PAVE_MODEL, g, { seed: hashSeed(seed, 'paving', zoneId, k), ties, fixed, weights, maxBacktracks: 48, restarts: 2 });
    backtracks += r.backtracks;
    if (!r.ok) continue;
    const hits = findPinwheels((x, z) => {
      if (x < box.minX || z < box.minZ || x > box.maxX || z > box.maxZ) return undefined;
      const t = r.tiles[(z - box.minZ) * lw + (x - box.minX)]!;
      return t < 0 ? undefined : roleCode(PAVE[t]!.role);
    }, box);
    if (hits.length > 0) {
      rejected++;
      continue;
    }
    const out = new Map<number, TerrainRole>();
    for (const i of cells) out.set(i, PAVE[r.tiles[local(i)]!]!.role);
    entry({
      zoneId, app: 'paving', ok: true, backtracks, rejected, violations: wfcViolations(PAVE_MODEL, g, r.tiles, { ties, fixed }).length,
      signature: cells.map((i) => PAVE[r.tiles[local(i)]!]!.id).join(''),
    });
    return out;
  }
  entry({ zoneId, app: 'paving', ok: false, backtracks, rejected, violations: 0, signature: '' });
  return undefined;
}

// ------------------------------------------------------------------ Garten

export interface GardenPlan {
  /** Wegzellen (Reihen- und Querwege). */
  readonly paths: ReadonlySet<number>;
  /** Pflanze je Beetzelle. */
  readonly plant: ReadonlyMap<number, TerrainRole>;
  /** Richtung der Beete: true = entlang x. */
  readonly alongX: boolean;
}

/**
 * Beete und Wege einer Gartenzone (Rechteck-Hülle der Zellen). Reihen (quer zur langen Achse): Beete 1–3 breit
 * zwischen 1 breiten Wegen, außen immer Beet; Spalten (längs): Beete 3–8 lang zwischen Querwegen, mindestens ein
 * Querweg (sonst hängen die Reihenwege nicht zusammen). Unter 3 Reihen: kein WFC (Rückfall).
 */
export function gardenPlan(
  grid: PlotGrid, cells: readonly number[], zoneId: string, seed: number, themeId: string | undefined, entry: (e: TiledEntry) => void,
): GardenPlan | undefined {
  if (cells.length === 0) return undefined;
  const box = bounds(grid, cells);
  const alongX = box.maxX - box.minX >= box.maxZ - box.minZ;
  const nu = alongX ? box.maxX - box.minX + 1 : box.maxZ - box.minZ + 1;
  const nv = alongX ? box.maxZ - box.minZ + 1 : box.maxX - box.minX + 1;
  if (nv < 3 || nu < 3) return undefined;
  const gw = gardenWeights(themeId);
  const set = new Set(cells);
  let rejected = 0;
  let backtracks = 0;
  for (let k = 0; k < TRIES; k++) {
    const s = hashSeed(seed, 'garden', zoneId, k);
    const rows = profile(nv, gw.rows, [[1, 1], [2, 0.1]], hashSeed(s, 'rows'), false);
    const cols = profile(nu, gw.cols, [[1, 1], [2, 0.1]], hashSeed(s, 'cols'), true);
    backtracks += (rows?.backtracks ?? 0) + (cols?.backtracks ?? 0);
    if (rows === undefined || cols === undefined) continue;
    // Beet-Rechtecke: Läufe der Beete in beiden Ketten
    const rowRuns = runs(rows.bed);
    const colRuns = runs(cols.bed);
    const colors = rectColors(colRuns.length, rowRuns.length, gw.plants, hashSeed(s, 'plants'));
    backtracks += colors?.backtracks ?? 0;
    if (colors === undefined) continue;
    const paths = new Set<number>();
    const plant = new Map<number, TerrainRole>();
    const code = new Map<number, number>();
    for (const i of cells) {
      const u = alongX ? grid.x(i) - box.minX : grid.z(i) - box.minZ;
      const v = alongX ? grid.z(i) - box.minZ : grid.x(i) - box.minX;
      if (!rows.bed[v]! || !cols.bed[u]!) {
        paths.add(i);
        code.set(i, 0);
        continue;
      }
      const ri = rowRuns.findIndex(([a, b]) => v >= a && v <= b);
      const ci = colRuns.findIndex(([a, b]) => u >= a && u <= b);
      const role = colors.roles[ri * colRuns.length + ci]!;
      plant.set(i, role);
      code.set(i, 1 + gw.plants.findIndex(([r]) => r === role));
    }
    const hits = findPinwheels((x, z) => (grid.inside(x, z) && set.has(grid.idx(x, z)) ? code.get(grid.idx(x, z)) : undefined), box);
    if (hits.length > 0) {
      rejected++;
      continue;
    }
    entry({
      zoneId, app: 'garden', ok: true, backtracks, rejected, violations: rows.violations + cols.violations + colors.violations,
      signature: `${rows.bed.map(Number).join('')}|${cols.bed.map(Number).join('')}|${colors.roles.map((r) => r.slice(0, 8)).join(',')}`,
    });
    return { paths, plant, alongX };
  }
  entry({ zoneId, app: 'garden', ok: false, backtracks, rejected, violations: 0, signature: '' });
  return undefined;
}

// ------------------------------------------------------------------ Feld

/** Frucht je Band (n Bänder zu 3 Reihen): Nachbarbänder verschieden, Folge gespiegelt. */
export function fieldCrops(n: number, zoneId: string, seed: number, entry: (e: TiledEntry) => void): string[] | undefined {
  if (n <= 0) return [];
  const tiles: SocketTile[] = CROP_ROLES.map((r) => ({ id: r, weight: 1, sockets: [r, r] }));
  const model = socketModel(tiles, [1, 0], (a, b) => a !== b);
  const grid = cutMiddle(chainGrid(n), n);
  const ties = palindromeTies(n, CROP_ROLES.map((_, i) => i));
  for (let k = 0; k < TRIES; k++) {
    const r = solveWfc(model, grid, { seed: hashSeed(seed, 'field', zoneId, k), ties, maxBacktracks: 32, restarts: 2 });
    if (!r.ok) continue;
    const crops = [...r.tiles].map((t) => CROP_ROLES[t]!);
    entry({ zoneId, app: 'field', ok: true, backtracks: r.backtracks, rejected: 0, violations: wfcViolations(model, grid, r.tiles, { ties }).length, signature: crops.join(',') });
    return crops;
  }
  entry({ zoneId, app: 'field', ok: false, backtracks: 0, rejected: 0, violations: 0, signature: '' });
  return undefined;
}

// ------------------------------------------------------------------ Hilfen

interface Box {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

function bounds(grid: PlotGrid, cells: readonly number[]): Box {
  const xs = cells.map((i) => grid.x(i));
  const zs = cells.map((i) => grid.z(i));
  return { minX: Math.min(...xs), minZ: Math.min(...zs), maxX: Math.max(...xs), maxZ: Math.max(...zs) };
}

/** Bindungen an beiden Achsen der Hülle, nur wo die Spiegelzelle zur Zone gehört. */
function mirrorTies(grid: PlotGrid, cells: readonly number[], box: Box, local: (i: number) => number, map: readonly number[]): WfcTie[] {
  const set = new Set(cells);
  const out: WfcTie[] = [];
  for (const i of cells) {
    const x = grid.x(i);
    const z = grid.z(i);
    for (const [mx, mz] of [[box.minX + box.maxX - x, z], [x, box.minZ + box.maxZ - z]] as const) {
      const j = grid.at(mx, mz);
      if (j >= 0 && set.has(j) && local(j) > local(i)) out.push({ a: local(i), b: local(j), map });
    }
  }
  return out;
}

/** Stabile Zahl je Rolle für den Windrad-Wächter. */
const roleCode = (role: string): number => {
  let h = 7;
  for (let i = 0; i < role.length; i++) h = (h * 31 + role.charCodeAt(i)) | 0;
  return h;
};

/**
 * Palindromische Kette aus Beet- und Wegläufen der Länge n; Enden immer Beet. `needPath`: mindestens ein Weg (sonst
 * zweiter Lauf mit Weg in der Mitte).
 */
function profile(
  n: number, bed: ReadonlyArray<readonly [number, number]>, path: ReadonlyArray<readonly [number, number]>, seed: number, needPath: boolean,
): { bed: boolean[]; backtracks: number; violations: number } | undefined {
  const rc = runChainModel([{ id: 'bed', widths: bed }, { id: 'path', widths: path }]);
  const g = chainGrid(n);
  const ties = palindromeTies(n, rc.mirror);
  const base = new Map<number, number[]>([[0, rc.startsOf('bed')], [n - 1, rc.endsOf('bed')]]);
  const attempts: Map<number, number[]>[] = [base];
  if (needPath) {
    const mid = new Map(base);
    const paths = rc.tilesOf('path');
    mid.set(Math.floor((n - 1) / 2), paths);
    mid.set(Math.ceil((n - 1) / 2), paths);
    attempts.push(mid);
  }
  let backtracks = 0;
  for (const fixed of attempts) {
    const r = solveWfc(rc.model, g, { seed, ties, fixed, maxBacktracks: 48, restarts: 3 });
    backtracks += r.backtracks;
    if (!r.ok) continue;
    const bedRow = [...r.tiles].map((t) => rc.kindOf[t] === 'bed');
    if (needPath && bedRow.every(Boolean)) continue;
    return { bed: bedRow, backtracks, violations: wfcViolations(rc.model, g, r.tiles, { ties, fixed }).length };
  }
  return undefined;
}

/** Läufe von `true` als [Anfang, Ende]. */
function runs(flags: readonly boolean[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    const a = i;
    while (i + 1 < flags.length && flags[i + 1]) i++;
    out.push([a, i]);
  }
  return out;
}

/**
 * Pflanze je Beet-Rechteck (Raster nc × nr): Nachbarn verschieden, an beiden Achsen gespiegelt. Kanten zwischen
 * Spiegelpartnern (mittleres Paar bei gerader Zahl) sind gekappt, sonst widersprächen sich Bindung und Regel.
 */
function rectColors(
  nc: number, nr: number, plants: ReadonlyArray<readonly [TerrainRole, number]>, seed: number,
): { roles: TerrainRole[]; backtracks: number; violations: number } | undefined {
  if (nc === 0 || nr === 0) return { roles: [], backtracks: 0, violations: 0 };
  const tiles: SocketTile[] = plants.map(([r, w]) => ({ id: r, weight: w, sockets: [r, r, r, r] }));
  const model = socketModel(tiles, [1, 0, 3, 2], (a, b) => a !== b);
  const base = grid2d(nc, nr);
  const adj = base.adj.slice();
  const cut = (i: number, d: number): void => {
    adj[i * 4 + d] = -1;
  };
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const i = r * nc + c;
      if (nc % 2 === 0 && c === nc / 2 - 1) {
        cut(i, 0);
        cut(i + 1, 1);
      }
      if (nr % 2 === 0 && r === nr / 2 - 1) {
        cut(i, 2);
        cut(i + nc, 3);
      }
    }
  }
  const grid: WfcGrid = { ...base, adj };
  const id = plants.map((_, i) => i);
  const ties: WfcTie[] = [];
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const i = r * nc + c;
      const mc = r * nc + (nc - 1 - c);
      const mr = (nr - 1 - r) * nc + c;
      if (mc > i) ties.push({ a: i, b: mc, map: id });
      if (mr > i) ties.push({ a: i, b: mr, map: id });
    }
  }
  const res = solveWfc(model, grid, { seed, ties, maxBacktracks: 48, restarts: 3 });
  if (!res.ok) return undefined;
  return { roles: [...res.tiles].map((t) => plants[t]![0]), backtracks: res.backtracks, violations: wfcViolations(model, grid, res.tiles, { ties }).length };
}

/** Kette ohne die Kante zwischen den beiden mittleren Zellen (gerade Länge: Spiegelpartner). */
function cutMiddle(g: WfcGrid, n: number): WfcGrid {
  if (n % 2 === 1 || n < 2) return g;
  const adj = g.adj.slice();
  adj[(n / 2 - 1) * 2] = -1;
  adj[(n / 2) * 2 + 1] = -1;
  return { ...g, adj };
}

/**
 * Kanonische Zelle je Spiegelbahn einer Zone (Spiegel an beiden Achsen der Hülle, nur innerhalb der Zone – wie die
 * Bindungen des WFC): kleinster Index der Bahn. Gleiche Zahl = gleicher Materialort (`ShellCell.pickAt`).
 */
export function mirrorCanon(grid: PlotGrid, cells: readonly number[]): Map<number, number> {
  const set = new Set(cells);
  const box = bounds(grid, cells);
  const parent = new Map(cells.map((i) => [i, i] as const));
  const find = (i: number): number => {
    let r = i;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    parent.set(i, r);
    return r;
  };
  for (const i of cells) {
    for (const [mx, mz] of [[box.minX + box.maxX - grid.x(i), grid.z(i)], [grid.x(i), box.minZ + box.maxZ - grid.z(i)]] as const) {
      const j = grid.at(mx, mz);
      if (j < 0 || !set.has(j)) continue;
      const [a, b] = [find(i), find(j)];
      if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
    }
  }
  return new Map(cells.map((i) => [i, find(i)] as const));
}
