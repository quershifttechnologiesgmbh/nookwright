/**
 * Außenbeleuchtung (research/18 L1, research/16 L3): Laternenpfähle im Takt entlang der Wege und an Kreuzungen
 * ('paths'), im Modus 'spawnproof' zusätzlich gierig nachgesetzt, bis jede spawnfähige Geländezelle Blocklicht ≥ 1
 * hat (Monster spawnen in der Oberwelt nur bei Blocklicht 0, Faktencheck 5).
 *
 * Das Gelände kennt keine Blöcke, nur Rollen. Gemessen wird daher mit einem KONSERVATIVEN Modell derselben
 * Regeln wie im Licht-Pass der Materialisierung (BFS, −1 je Schritt, Laub −1 extra): Gebäudezellen, Wasser,
 * Stämme, Heu, Fässer, Stufen und Bauwerksspalten sperren; als Spawn-Untergrund zählt jede Oberfläche und jede
 * volle Oberseite (außer Ackerland, Wasser, Rinne, Laub). Licht aus dem Haus zählt nicht. Die Pipeline prüft das
 * Ergebnis mit dem echten Licht-BFS (Test).
 *
 * Laternenpfahl (L1 c/d): Stammsockel, Zaun, Laterne obendrauf (Unterkante 2 über dem Boden) neben dem Weg.
 * Licht im Laub (L3): ein Busch bekommt einen Leuchtkern (`light_hidden`), rundum und oben Laub.
 */
import { HORIZONTAL, key3, type Vec3 } from '@mcda/core';
import { DIR_OFFSET } from './grid.js';
import { C, GROUND_PLANT_ROLES, type Gen } from './gen.js';

export interface SiteRoute {
  readonly cells: readonly number[];
  /** 3 = Hauptweg, 2 = Nebenweg, 1 = Pfad. */
  readonly rank: number;
  readonly width: number;
}

export interface LightingReport {
  readonly lamps: number;
  readonly leafLights: number;
  /** Nach dem Nachsetzen im Modell noch dunkle spawnfähige Stellen (Ziel 0). */
  readonly dark: number;
  /** Für Pfähle entfernte Bodenpflanzen. */
  readonly removedPlants: number;
}

const EMISSION: Readonly<Record<string, number>> = { light_outdoor: 15, light_hidden: 15 };
const OPAQUE_PLANTS: ReadonlySet<string> = new Set([
  'log_oak', 'log_birch', 'log_spruce', 'fence_post', 'woodpile', 'barrel_outdoor', 'beehive', 'hay', 'scarecrow_head', 'planter', 'light_hidden', 'well_roof',
]);
const LEAF_ROLES: ReadonlySet<string> = new Set(['leaves_oak', 'leaves_birch', 'leaves_spruce', 'leaves_bush', 'hedge', 'leaves_fruit']);
/** Volle Oberseite, auf der Monster stehen können. */
const FLOOR_PLANTS: ReadonlySet<string> = new Set(['log_oak', 'log_birch', 'log_spruce', 'fence_post', 'woodpile', 'barrel_outdoor', 'beehive', 'hay', 'scarecrow_head', 'well_roof']);
const NO_FLOOR_SURFACES: ReadonlySet<string> = new Set(['farmland', 'water', 'path_gutter', 'building']);
/** Oberflächen, auf denen ein Laternenpfahl stehen darf: Gras, Hofboden, Wegrand, Koppelboden, Platz-Akzent, Erde. */
const LAMP_SURFACES: ReadonlySet<string> = new Set(['ground_grass', 'ground_yard', 'path_edge', 'paddock_ground', 'plaza_accent', 'ground_dirt']);
/**
 * Geländeklassen, in denen ein Laternenpfahl stehen darf: Wiese (frei und als Zone), Hof, Platz, Obstgarten, Koppel –
 * nicht auf Haus, Sockel, Feld, Garten, Teich, Pfad-Zone und Erdhügel.
 */
const LAMP_CLASSES: ReadonlySet<number> = new Set([C.meadow, C.meadowZone, C.yard, C.plaza, C.orchard, C.paddock]);

/** Reichweite: Stellen mit geschätztem Licht ≥ MARGIN gelten beim Planen als versorgt (Rest korrigiert die nächste Runde). */
const MARGIN = 3;
const SEARCH = 8;

interface Stand {
  readonly col: number;
  readonly y: number;
}

/** Konservatives Licht- und Spawnmodell über dem Grundstück. */
class LightModel {
  readonly yLo: number;
  readonly h: number;
  readonly op: Uint8Array; // 0 frei, 1 sperrt, 2 Laub (−1 extra)
  readonly levels: Uint8Array;
  private readonly solid: Uint8Array; // Kollision (Füße/Kopf)

  constructor(private readonly g: Gen) {
    const { grid, top, building } = g;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < grid.size; i++) {
      lo = Math.min(lo, top[i]!);
      hi = Math.max(hi, top[i]!);
    }
    for (const c of g.out.values()) hi = Math.max(hi, c.pos[1]);
    this.yLo = lo;
    this.h = hi + 4 - lo;
    const size = grid.size * this.h;
    this.op = new Uint8Array(size);
    this.solid = new Uint8Array(size);
    this.levels = new Uint8Array(size);
    for (let i = 0; i < grid.size; i++) {
      const t = top[i]!;
      const s = g.struct[i]!;
      for (let y = lo; y < lo + this.h; y++) {
        const under = y <= t;
        const fort = (s === 1 && y > t) || (s === 2 && y >= t + 3);
        if (under || fort) this.mark(i, y, 1, true);
      }
    }
    for (const k of building.occupied) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      const i = grid.at(x, z);
      if (i >= 0) this.mark(i, y, 1, true);
    }
    for (const c of g.out.values()) {
      const i = grid.at(c.pos[0], c.pos[2]);
      if (i < 0) continue;
      const o = LEAF_ROLES.has(c.role) ? 2 : OPAQUE_PLANTS.has(c.role) || c.shape === 'slab' || c.shape === 'stairs' ? 1 : 0;
      this.mark(i, c.pos[1], o, !GROUND_PLANT_ROLES.has(c.role));
    }
    // Q3: Katalog-Objekte sind keine `out`-Zellen, verschatten aber genauso (und leuchten ggf. selbst).
    for (const [k, p] of g.propCells) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      const i = grid.at(x, z);
      if (i >= 0) this.mark(i, y, p.op, true);
    }
    this.flood();
  }

  private at(i: number, y: number): number {
    const k = y - this.yLo;
    return k < 0 || k >= this.h ? -1 : i + k * this.g.grid.size;
  }

  private mark(i: number, y: number, op: number, solid: boolean): void {
    const a = this.at(i, y);
    if (a < 0) return;
    if (op === 1 || (op === 2 && this.op[a] === 0)) this.op[a] = op;
    if (solid) this.solid[a] = 1;
  }

  private flood(): void {
    const { grid } = this.g;
    const queue: number[] = [];
    const source = (x: number, y: number, z: number, e: number): void => {
      const i = grid.at(x, z);
      const a = i < 0 ? -1 : this.at(i, y);
      if (a < 0) return;
      if (e > this.levels[a]!) {
        this.levels[a] = e;
        queue.push(a);
      }
    };
    for (const c of this.g.out.values()) {
      const e = EMISSION[c.role];
      if (e !== undefined) source(c.pos[0], c.pos[1], c.pos[2], e);
    }
    for (const [k, p] of this.g.propCells) {
      if (p.light <= 0) continue;
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      source(x, y, z, p.light);
    }
    const n = grid.size;
    for (let q = 0; q < queue.length; q++) {
      const a = queue[q]!;
      const lvl = this.levels[a]!;
      if (lvl <= 1) continue;
      const i = a % n;
      const k = (a - i) / n;
      const x = grid.x(i);
      const z = grid.z(i);
      const next = (b: number): void => {
        const o = this.op[b]!;
        if (o === 1) return;
        const v = lvl - 1 - (o === 2 ? 1 : 0);
        if (v > this.levels[b]!) {
          this.levels[b] = v;
          queue.push(b);
        }
      };
      if (k > 0) next(a - n);
      if (k < this.h - 1) next(a + n);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const j = grid.at(x + dx, z + dz);
        if (j >= 0) next(j + k * n);
      }
    }
  }

  level(i: number, y: number): number {
    const a = this.at(i, y);
    return a < 0 ? 0 : this.levels[a]!;
  }

  free(i: number, y: number): boolean {
    const a = this.at(i, y);
    return a < 0 ? y >= this.yLo + this.h : this.solid[a] === 0;
  }

  /** Spawnfähige Stellen (Untergrund mit voller Oberseite, Füße und Kopf ohne Kollision) mit Licht 0. */
  dark(): Stand[] {
    const { grid, surface, top, out } = this.g;
    const floors: Stand[] = [];
    for (let i = 0; i < grid.size; i++) {
      if (this.g.cls[i] === C.building || NO_FLOOR_SURFACES.has(surface[i]!) || this.g.water[i]! > 0) continue;
      floors.push({ col: i, y: top[i]! + 1 });
    }
    for (const c of out.values()) {
      if (!FLOOR_PLANTS.has(c.role)) continue;
      const i = grid.at(c.pos[0], c.pos[2]);
      if (i >= 0) floors.push({ col: i, y: c.pos[1] + 1 });
    }
    return floors.filter((s) => this.free(s.col, s.y) && this.free(s.col, s.y + 1) && this.level(s.col, s.y) === 0)
      .sort((a, b) => a.col - b.col || a.y - b.y);
  }
}

/**
 * Setzt Laternenpfähle (und Leuchtbüsche) laut Modus. `routes` in Reihenfolge der Wegführung.
 * Deterministisch, ohne Zufall.
 */
/**
 * Lampen-Takt: eine Zahl gilt für alle Wege, ein Objekt setzt den Takt **je Rang** (research/44 §4.1: der
 * Hauptweg braucht dichtere Lampen als ein Nebenweg oder Pfad – gemessen lagen Nebenwege bei 7–16 Blöcken).
 */
export type LightEvery =
  | number
  | {
      readonly main?: number | undefined;
      readonly side?: number | undefined;
      readonly path?: number | undefined;
    };

/**
 * Takt für einen Rang (3 = Hauptweg, 2 = Nebenweg, 1 = Pfad). `0` heißt: auf diesem Rang **keine** Lampe
 * (research/44 §4.1: Pfade brauchen laut Recherche kein Licht) – der Aufrufer überspringt den Rang dann.
 */
export function lightEveryFor(every: LightEvery, rank: number): number {
  if (typeof every === 'number') return every;
  const name = rank >= 3 ? 'main' : rank === 2 ? 'side' : 'path';
  return every[name] ?? every.main ?? 10;
}

export function lightSite(
  g: Gen, mode: 'paths' | 'spawnproof', routes: readonly SiteRoute[], every: LightEvery, leaves: boolean,
  extra: { readonly entry?: boolean; readonly litSpacing?: boolean; readonly forecourt?: boolean } = {},
): LightingReport {
  const entry = extra.entry === true;
  const { grid, top, out, emit } = g;
  // W3 (27.09.2026, Übergabe W3-EN): Vorplatz jeder Außentür (1–5 vor der Tür, quer ±3) gehört dem Laternenpaar des
  // Eingangs – dort setzen Takt, Kreuzung und Wegmündung keinen Pfahl (das Nachsetzen im Modus „spawnsicher“ schon)
  const fore = new Uint8Array(grid.size);
  if (extra.forecourt === true) {
    for (const d of g.building.doors) {
      const [dx, dz] = DIR_OFFSET[d.outward];
      for (let s2 = 1; s2 <= 5; s2++) {
        for (let k = -3; k <= 3; k++) {
          const j = grid.at(d.cell[0] + dx * s2 - dz * k, d.cell[1] + dz * s2 + dx * k);
          if (j >= 0) fore[j] = 1;
        }
      }
    }
  }
  const lamps: number[] = [];
  let leafLights = 0;
  let removedPlants = 0;

  const removable = (i: number, y: number): boolean => {
    const c = out.get(key3([grid.x(i), y, grid.z(i)]));
    return c === undefined || GROUND_PLANT_ROLES.has(c.role);
  };
  const vacant = (i: number, y: number): boolean => !out.has(key3([grid.x(i), y, grid.z(i)])) && !g.building.occupied.has(key3([grid.x(i), y, grid.z(i)]));
  const lampOk = (i: number): boolean => {
    if (!LAMP_CLASSES.has(g.cls[i]!) || !LAMP_SURFACES.has(g.surface[i]!)) return false;
    if (g.path[i] === 1 || g.route[i] === 1 || g.blocked[i] === 1 || g.ring[i] === 1 || g.struct[i] !== 0 || g.profile[i] === 1 || g.lowered[i] === 1) return false;
    if (g.covered[i] === 1 || g.padDist[i]! <= g.padWidth || g.doorDist[i]! < 3 || g.water[i]! > 0) return false;
    const t = top[i]!;
    return removable(i, t + 1) && vacant(i, t + 2) && vacant(i, t + 3);
  };
  // W3-GA (`litSpacing`): schon leuchtende Spalten (Torlaternen am Straßenzaun, Brunnen, Ringpfosten) zählen beim
  // Abstand mit – kein zweiter Pfahl direkt neben einer Torlaterne
  const lit: number[] = [];
  if (extra.litSpacing === true) {
    for (const c of out.values()) {
      if (c.role !== 'light_outdoor') continue;
      const j = grid.at(c.pos[0], c.pos[2]);
      if (j >= 0) lit.push(j);
    }
  }
  const nearLamp = (i: number, r: number): boolean => [...lamps, ...lit].some((j) => Math.max(Math.abs(grid.x(i) - grid.x(j)), Math.abs(grid.z(i) - grid.z(j))) < r);
  const placeLamp = (i: number): Vec3 => {
    const x = grid.x(i);
    const z = grid.z(i);
    const t = top[i]!;
    const k = key3([x, t + 1, z]);
    if (out.has(k)) {
      out.delete(k);
      removedPlants++;
    }
    emit([x, t + 1, z], 'plant', 'fence_post', 'log', { axis: 'y' });
    emit([x, t + 2, z], 'plant', 'fence_outdoor', 'fence');
    emit([x, t + 3, z], 'plant', 'light_outdoor', 'lantern');
    g.blocked[i] = 1;
    g.plantCol[i] = 1;
    lamps.push(i);
    return [x, t + 3, z];
  };
  /** Erste freie Spalte quer zur Laufrichtung (1–4 neben der Wegzelle). */
  const beside = (cell: number, dx: number, dz: number): number | undefined => {
    for (let m = 1; m <= 4; m++) {
      const j = grid.at(grid.x(cell) + dx * m, grid.z(cell) + dz * m);
      if (j < 0) return undefined;
      if (lampOk(j)) return fore[j] === 1 ? undefined : j;
      if (g.path[j] !== 1 && g.route[j] !== 1) return undefined;
    }
    return undefined;
  };

  // --- W3-GA Wegmündung: Laternenpfahl neben dem Ende des Hauptwegs am Grundstücksrand (vor dem Takt, damit der
  // Takt ihn als Nachbarn kennt)
  if (entry) {
    for (const r of routes) {
      if (r.rank < 3 || r.cells.length < 4) continue;
      const end = r.cells[r.cells.length - 1]!;
      if (!grid.onBorder(end)) continue;
      const prev = r.cells[r.cells.length - 2]!;
      const dx = grid.x(end) - grid.x(prev);
      const dz = grid.z(end) - grid.z(prev);
      // eine Zelle vor dem Rand, damit der Pfahl nicht an der Schnittkante steht
      for (const cell of [prev, r.cells[r.cells.length - 3]!]) {
        const j = beside(cell, -dz, dx) ?? beside(cell, dz, -dx);
        if (j !== undefined && !nearLamp(j, 4)) {
          placeLamp(j);
          break;
        }
      }
    }
  }

  // --- Takt: Kreuzungen (Anfang jeder weiteren Route) und alle `every` Zellen im Wechsel der Seiten
  routes.forEach((r, ri) => {
    if (r.rank < 2 || r.cells.length < 4) return;
    const start = r.cells[0]!;
    if (ri > 0 && !g.exits.includes(start)) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const j = beside(start, dx, dz);
        if (j !== undefined && !nearLamp(j, 4)) {
          placeLamp(j);
          break;
        }
      }
    }
    let side = 1;
    const step = lightEveryFor(every, r.rank);
    // Rang ohne Lampen (z. B. Pfad, research/44 §4.1): nur die Kreuzung oben bleibt, keine Reihe
    for (let k = Math.min(4, r.cells.length - 1); step >= 1 && k < r.cells.length - 1; k++) {
      if ((k - 4) % step !== 0) continue;
      const a = r.cells[k]!;
      const b = r.cells[k + 1]!;
      const dx = grid.x(b) - grid.x(a);
      const dz = grid.z(b) - grid.z(a);
      const j = beside(a, -dz * side, dx * side) ?? beside(a, dz * side, -dx * side);
      side = -side;
      if (j !== undefined && !nearLamp(j, 5)) placeLamp(j);
    }
  });
  if (mode === 'paths') return { lamps: lamps.length, leafLights, dark: 0, removedPlants };

  // --- spawnsicher: gierig nachsetzen (Modell neu messen je Runde)
  const bushOk = (i: number): boolean => {
    const c = out.get(key3([grid.x(i), top[i]! + 1, grid.z(i)]));
    return c?.role === 'leaves_bush' && g.doorDist[i]! >= 2 && g.path[i] === 0 && g.route[i] === 0 && vacantOrBush(i, top[i]! + 2);
  };
  const vacantOrBush = (i: number, y: number): boolean => {
    const c = out.get(key3([grid.x(i), y, grid.z(i)]));
    return (c === undefined || c.role === 'leaves_bush') && !g.building.occupied.has(key3([grid.x(i), y, grid.z(i)]));
  };
  const leafLight = (i: number): void => {
    const x = grid.x(i);
    const z = grid.z(i);
    const t = top[i]!;
    out.delete(key3([x, t + 1, z]));
    emit([x, t + 1, z], 'plant', 'light_hidden', 'block');
    emit([x, t + 2, z], 'plant', 'leaves_bush', 'block');
    for (const d of HORIZONTAL) {
      const [ox, oz] = DIR_OFFSET[d];
      const j = grid.at(x + ox, z + oz);
      if (j < 0 || top[j] !== t || g.path[j] === 1 || g.route[j] === 1 || (g.blocked[j] === 1 && !bushAt(j))) continue;
      if (g.cls[j] !== C.meadow && g.cls[j] !== C.pad) continue;
      if (g.struct[j] !== 0 || g.profile[j] === 1 || g.lowered[j] === 1 || g.doorDist[j]! < 2 || g.ring[j] === 1) continue;
      const k = key3([x + ox, t + 1, z + oz]);
      const c = out.get(k);
      if (c !== undefined && !GROUND_PLANT_ROLES.has(c.role)) continue;
      if (c !== undefined) {
        out.delete(k);
        removedPlants++;
      }
      if (emit([x + ox, t + 1, z + oz], 'plant', 'leaves_bush', 'block')) {
        g.blocked[j] = 1;
        g.plantCol[j] = 1;
      }
    }
    leafLights++;
  };
  const bushAt = (j: number): boolean => out.get(key3([grid.x(j), top[j]! + 1, grid.z(j)]))?.role === 'leaves_bush';

  let dark: Stand[] = [];
  for (let round = 0; round < 10; round++) {
    const model = new LightModel(g);
    dark = model.dark();
    if (dark.length === 0) break;
    const byCol = new Map<number, number[]>();
    dark.forEach((s, k) => byCol.set(s.col, [...(byCol.get(s.col) ?? []), k]));
    const done = new Uint8Array(dark.length);
    // Q3: Laub-Lichter stecken im Busch und leuchten nach außen nur schwach. Werden sie wie eine freie Laterne
    // mit Level 15 geschätzt, hält der Planer Zellen bis 12 Blöcke weit für versorgt und setzt dort keine Laterne
    // (gemessen: 7 spawnfähige Stellen blieben dunkel). LEAF_EST = 9 lässt Laub-Lichter weiter zu (Test
    // „Leuchtbüsche"), begrenzt die Reichweite aber auf 6 statt 12 Blöcke.
    const LEAF_EST = 9;
    const est = (src: Vec3, s: Stand, level = 15): number => level - (Math.abs(src[0] - grid.x(s.col)) + Math.abs(src[1] - s.y) + Math.abs(src[2] - grid.z(s.col)));
    const gain = (src: Vec3, level = 15): number => {
      let sum = 0;
      for (let dx = -13; dx <= 13; dx++) {
        for (let dz = -13 + Math.abs(dx); dz <= 13 - Math.abs(dx); dz++) {
          const j = grid.at(src[0] + dx, src[2] + dz);
          if (j < 0) continue;
          for (const k of byCol.get(j) ?? []) if (done[k] === 0 && est(src, dark[k]!, level) >= MARGIN) sum++;
        }
      }
      return sum;
    };
    const cover = (src: Vec3, level = 15): void => {
      for (let dx = -13; dx <= 13; dx++) {
        for (let dz = -13 + Math.abs(dx); dz <= 13 - Math.abs(dx); dz++) {
          const j = grid.at(src[0] + dx, src[2] + dz);
          if (j < 0) continue;
          for (const k of byCol.get(j) ?? []) if (est(src, dark[k]!, level) >= MARGIN) done[k] = 1;
        }
      }
    };
    let placed = 0;
    for (let k = 0; k < dark.length; k++) {
      if (done[k] === 1) continue;
      const d = dark[k]!;
      const dx0 = grid.x(d.col);
      const dz0 = grid.z(d.col);
      let best: { i: number; leaf: boolean; score: number } | undefined;
      for (let dx = -SEARCH; dx <= SEARCH; dx++) {
        for (let dz = -SEARCH; dz <= SEARCH; dz++) {
          const i = grid.at(dx0 + dx, dz0 + dz);
          if (i < 0) continue;
          const leaf = leaves && bushOk(i);
          if (!leaf && !lampOk(i)) continue;
          const src: Vec3 = [grid.x(i), top[i]! + (leaf ? 1 : 3), grid.z(i)];
          if (est(src, d, leaf ? LEAF_EST : 15) < MARGIN) continue;
          const score = gain(src, leaf ? LEAF_EST : 15) * (leaf ? 1.3 : 1) + (g.path[i] === 0 && hasPathNeighbor(i) ? 0.5 : 0);
          if (best === undefined || score > best.score) best = { i, leaf, score };
        }
      }
      if (best !== undefined) {
        if (best.leaf) leafLight(best.i);
        const src: Vec3 = best.leaf ? [grid.x(best.i), top[best.i]! + 1, grid.z(best.i)] : placeLamp(best.i);
        cover(src, best.leaf ? LEAF_EST : 15);
        placed++;
        continue;
      }
      // Rückfall: Laterne direkt auf die dunkle Stelle (volle Oberseite trägt), nie auf Wege
      if (g.path[d.col] === 0 && g.route[d.col] === 0 && g.doorDist[d.col]! >= 2 && removable(d.col, d.y) && model.free(d.col, d.y + 1)) {
        const pos: Vec3 = [dx0, d.y, dz0];
        const kk = key3(pos);
        if (out.has(kk)) {
          out.delete(kk);
          removedPlants++;
        }
        if (emit(pos, 'plant', 'light_outdoor', 'lantern')) {
          g.plantCol[d.col] = 1;
          cover(pos);
          placed++;
        }
      }
    }
    if (placed === 0) break;
  }
  if (dark.length > 0) dark = new LightModel(g).dark();
  if (dark.length > 0) g.warnings.push(`Beleuchtung: ${dark.length} spawnfähige Stellen bleiben dunkel (kein Platz für Laternen)`);
  return { lamps: lamps.length, leafLights, dark: dark.length, removedPlants };

  function hasPathNeighbor(i: number): boolean {
    return grid.n4(i).some((j) => g.path[j] === 1);
  }
}
