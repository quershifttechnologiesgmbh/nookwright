/**
 * Ausstattung am Haus und an den Zonen (research/18 A6, V1, V4; research/16 U5, V3, V4, V6):
 *  - Beet mit Kante (research/16 V4): 1 breites Blumenbeet an der Hauswand zwischen den Fenstern, davor eine
 *    bündige Steinkante; Traufstreifen (U5) rund ums Haus.
 *  - Kübel (V1): Kübelbusch an den Außenecken des Hauses.
 *  - Hof-Ausstattung (A6): Holzstapel unter dem Dachüberstand, Fässer neben den Türen (≥ 3 Abstand zum Ausgang),
 *    Bienenstock am Gartenrand (Blumen in Reichweite).
 *  - Spalier (V4): flaches Obst-Laub auf Zaunkern an der Südwand.
 *  - Hausbäume (V4/V6): seitlich oder hinter dem Haus, nie mittig vor der Hauptfassade.
 *  - Streudeko (V3): Blütenteppich und Gras in Flecken an den Wegrändern.
 * Fenster und Türen (`BuildingInfo.openings`) behalten 1 Block Abstand zur Seite – dort sitzen Läden und
 * Blumenkästen der Außengestaltung. Vor Außentüren bleiben 3 Blöcke frei.
 */
import { HORIZONTAL, Rng, hashSeed, key3, valueNoise2, type HorizontalDir, type Vec3 } from '@mcda/core';
import { C, type Gen } from './gen.js';
import { DIR_OFFSET } from './grid.js';
import { emitTree, square } from './zones.js';
import { growTree } from './vegetation.js';

export interface HouseDecorOptions {
  readonly beds?: boolean | undefined;
  readonly eaves?: boolean | undefined;
  readonly planters?: boolean | undefined;
  readonly props?: number | undefined;
  readonly espalier?: boolean | undefined;
  /**
   * Feste Module (W3-GA, `decor.kits`): Beete nur an der Hauptfassade (beidseits der Tür, ohne Würfel), höchstens
   * ein Holzstapel unter der Traufe und keine Fässer an den Türen – Fässer und Kisten stehen in der Hofecke.
   */
  readonly kits?: boolean | undefined;
  /** Blickrichtung der Haustür (Hauptfassade) für die Beete mit `kits`. */
  readonly front?: HorizontalDir | undefined;
}

export interface DecorCount {
  beds: number;
  planters: number;
  woodpiles: number;
  barrels: number;
  espaliers: number;
  beehives: number;
}

/** Spalte ist für Ausstattung frei (kein Weg, Ring, Bauwerk, Profil, nicht direkt vor einer Tür). */
function free(g: Gen, i: number): boolean {
  return g.path[i] === 0 && g.route[i] === 0 && g.blocked[i] === 0 && g.plantCol[i] === 0 && g.ring[i] === 0 && g.struct[i] === 0
    && g.profile[i] === 0 && g.lowered[i] === 0 && g.doorDist[i]! >= 3 && g.water[i] === 0;
}

/** Spalte an einer geraden Hauswand: genau ein 4er-Nachbar gehört zur Grundfläche. */
function atWall(g: Gen, i: number): { wall: number; out: HorizontalDir } | undefined {
  if (g.cls[i] !== C.pad) return undefined;
  const walls = HORIZONTAL.filter((d) => {
    const j = g.grid.at(g.grid.x(i) - DIR_OFFSET[d][0], g.grid.z(i) - DIR_OFFSET[d][1]);
    return j >= 0 && g.cls[j] === C.building;
  });
  if (walls.length !== 1) return undefined;
  const d = walls[0]!;
  return { wall: g.grid.idx(g.grid.x(i) - DIR_OFFSET[d][0], g.grid.z(i) - DIR_OFFSET[d][1]), out: d };
}

/** Tür oder Fenster in der Wandspalte oder seitlich daneben (±radius) zwischen y0+dyLo und y0+dyHi? */
function nearOpening(g: Gen, wall: number, out: HorizontalDir, dyLo: number, dyHi: number, radius = 1): boolean {
  const open = g.building.openings;
  if (open === undefined) return false;
  const [ox, oz] = DIR_OFFSET[out];
  for (let k = -radius; k <= radius; k++) {
    const x = g.grid.x(wall) + oz * k;
    const z = g.grid.z(wall) + ox * k;
    for (let dy = dyLo; dy <= dyHi; dy++) if (open.has(key3([x, g.building.y0 + dy, z]))) return true;
  }
  return false;
}

function vacant(g: Gen, x: number, y: number, z: number): boolean {
  const k = key3([x, y, z]);
  return !g.out.has(k) && !g.building.occupied.has(k);
}

function take(g: Gen, i: number): void {
  g.blocked[i] = 1;
  g.plantCol[i] = 1;
}

/** Ausstattung am Haus: Kübel, Holzstapel, Fässer, Spalier, Beete, Traufstreifen (in dieser Reihenfolge). */
export function houseDecor(g: Gen, o: HouseDecorOptions): DecorCount {
  const { grid, emit, top } = g;
  const count: DecorCount = { beds: 0, planters: 0, woodpiles: 0, barrels: 0, espaliers: 0, beehives: 0 };
  const rng = new Rng(hashSeed(g.seed, 'decor', 'house'));
  const wallRuns = (ok: (i: number, w: { wall: number; out: HorizontalDir }) => boolean): number[][] => {
    const members = new Set<number>();
    for (let i = 0; i < grid.size; i++) {
      const w = atWall(g, i);
      if (w !== undefined && free(g, i) && ok(i, w)) members.add(i);
    }
    return grid.components(members);
  };

  // V1 Kübel an den Außenecken (Kübel + Busch)
  if (o.planters === true) {
    for (let i = 0; i < grid.size; i++) {
      if (g.cls[i] !== C.pad || g.footDist[i] !== 1 || !free(g, i)) continue;
      if (grid.n4(i).some((j) => g.cls[j] === C.building)) continue;
      const x = grid.x(i);
      const z = grid.z(i);
      const t = top[i]!;
      if (!vacant(g, x, t + 1, z) || !vacant(g, x, t + 2, z)) continue;
      emit([x, t + 1, z], 'plant', 'planter', 'block');
      emit([x, t + 2, z], 'plant', 'leaves_bush', 'block');
      take(g, i);
      count.planters++;
    }
  }

  const props = o.props ?? 0;
  if (props > 0) {
    // A6 Holzstapel unter dem Überstand (liegende Stämme, Achse entlang der Wand), höchstens 2
    const runs = wallRuns((i, w) => g.covered[i] === 1 && !nearOpening(g, w.wall, w.out, 1, 2)).filter((r) => r.length >= 2);
    for (const run of rng.shuffle(runs).slice(0, o.kits === true ? 1 : 2)) {
      if (!rng.chance(props)) continue;
      const w = atWall(g, run[0]!)!;
      const axis = w.out === 'north' || w.out === 'south' ? 'x' : 'z';
      const pile = run.slice(0, Math.min(run.length, 3));
      const upper = pile.length === 3 ? 1 : 0; // zweite Lage in der Mitte bzw. am Anfang
      pile.forEach((i, k) => {
        const x = grid.x(i);
        const z = grid.z(i);
        const t = top[i]!;
        emit([x, t + 1, z], 'plant', 'woodpile', 'log', { axis });
        if (k === upper && vacant(g, x, t + 2, z)) emit([x, t + 2, z], 'plant', 'woodpile', 'log', { axis });
        take(g, i);
      });
      count.woodpiles++;
    }
    // A6 Fässer neben den Außentüren (3 bzw. 4 seitlich des Ausgangs, an der Wand); mit Modulen in der Hofecke
    for (const d of o.kits === true ? [] : g.building.doors) {
      const [ox, oz] = DIR_OFFSET[d.outward];
      for (const s of [1, -1]) {
        if (!rng.chance(props * 0.6)) continue;
        for (const m of [3, 4]) {
          const i = grid.at(d.cell[0] + ox + oz * s * m, d.cell[1] + oz + ox * s * m);
          if (i < 0 || !free(g, i)) break;
          const w = atWall(g, i);
          if (w === undefined || nearOpening(g, w.wall, w.out, 1, 1, 0)) break;
          if (!emit([grid.x(i), top[i]! + 1, grid.z(i)], 'plant', 'barrel_outdoor', 'block', { facing: d.outward })) break;
          take(g, i);
          count.barrels++;
          if (!rng.chance(0.5)) break;
        }
      }
    }
  }

  // V4 Spalier: Zaunkern mit flachem Laub (3 breit) an der Südwand, höchstens 2
  if (o.espalier === true) {
    const runs = wallRuns((i, w) => w.out === 'south' && !nearOpening(g, w.wall, w.out, 1, 3)
      && [1, 2, 3].every((dy) => vacant(g, grid.x(i), top[i]! + dy, grid.z(i))));
    for (const run of runs) {
      if (count.espaliers >= 2) break;
      const sorted = [...run].sort((a, b) => grid.x(a) - grid.x(b));
      for (let k = 0; k + 3 <= sorted.length && count.espaliers < 2; k += 5) {
        const three = sorted.slice(k, k + 3);
        if (three.some((i) => top[i] !== top[three[0]!])) continue;
        three.forEach((i, m) => {
          const x = grid.x(i);
          const z = grid.z(i);
          const t = top[i]!;
          if (m === 1) {
            emit([x, t + 1, z], 'plant', 'fence_outdoor', 'fence');
            emit([x, t + 2, z], 'plant', 'fence_outdoor', 'fence');
          } else emit([x, t + 2, z], 'plant', 'leaves_fruit', 'block');
          emit([x, t + 3, z], 'plant', 'leaves_fruit', 'block');
          take(g, i);
        });
        count.espaliers++;
      }
    }
  }

  // research/16 V4: Beet mit Kante zwischen den Fenstern (Blumen 1 hoch)
  if (o.beds === true) {
    for (const run of wallRuns((_, w) => !nearOpening(g, w.wall, w.out, 1, 2))) {
      if (o.kits === true) {
        // Modul „Beet an der Hauswand“: nur an der Hauptfassade, jedes passende Stück (Tür ±1 bleibt frei)
        if (run.length < 3 || o.front === undefined || atWall(g, run[0]!)?.out !== o.front) continue;
      } else if (run.length < 3 || !rng.chance(0.75)) continue;
      const role = count.beds % 2 === 0 ? 'flower_warm' : 'flower_cool';
      for (const i of run) {
        const w = atWall(g, i)!;
        g.surface[i] = 'garden_soil';
        emit([grid.x(i), top[i]! + 1, grid.z(i)], 'plant', role, 'block');
        g.plantCol[i] = 1;
        const j = grid.at(grid.x(i) + DIR_OFFSET[w.out][0], grid.z(i) + DIR_OFFSET[w.out][1]);
        if (j >= 0 && (g.cls[j] === C.pad || g.cls[j] === C.meadow) && free(g, j) && g.surface[j] === 'ground_grass' && top[j] === top[i]) {
          g.surface[j] = 'bed_edge';
          g.plantCol[j] = 1;
        }
      }
      count.beds++;
    }
  }

  // research/16 U5 Traufstreifen: rund ums Haus grobe Erde/Kies statt Gras (ohne Pflanzen)
  if (o.eaves === true) {
    for (let i = 0; i < grid.size; i++) {
      if (g.cls[i] === C.pad && g.footDist[i] === 1 && g.surface[i] === 'ground_grass' && g.path[i] === 0 && g.plantCol[i] === 0 && g.struct[i] === 0
        && !g.exits.includes(i)) g.surface[i] = 'path_edge';
    }
  }
  return count;
}

/** A6 Bienenstock am Gartenrand (außen, zum Garten gerichtet), je Garten höchstens einer. */
export function beehive(g: Gen, garden: readonly number[], props: number, zoneId: string): boolean {
  const { grid } = g;
  const rng = new Rng(hashSeed(g.seed, 'decor', 'beehive', zoneId));
  if (!rng.chance(props)) return false;
  const set = new Set(garden);
  const cands: Array<{ i: number; facing: HorizontalDir }> = [];
  for (const c of garden) {
    for (const d of HORIZONTAL) {
      const [ox, oz] = DIR_OFFSET[d];
      const i = grid.at(grid.x(c) - ox * 2, grid.z(c) - oz * 2);
      const between = grid.at(grid.x(c) - ox, grid.z(c) - oz);
      if (i < 0 || between < 0 || set.has(i) || set.has(between)) continue;
      if (g.cls[i] !== C.meadow || g.cls[between] !== C.meadow || !free(g, i)) continue;
      cands.push({ i, facing: d });
    }
  }
  const pick = cands.sort((a, b) => a.i - b.i)[Math.floor(rng.next() * cands.length)];
  if (pick === undefined) return false;
  const pos: Vec3 = [grid.x(pick.i), g.top[pick.i]! + 1, grid.z(pick.i)];
  if (!g.emit(pos, 'plant', 'beehive', 'block', { facing: pick.facing })) return false;
  take(g, pick.i);
  return true;
}

/**
 * V4/V6 Hausbäume: 1–2 Eichen seitlich (sonst hinter) dem Haus, 4–7 von der Wand, Krone frei von Wegen und Zonen.
 * Mit `bands` (W3-GA, `facadeBands`) nie vor einer Fassade: der Hausbaum steht dann an einer Hausecke oder dahinter.
 */
export function houseTrees(g: Gen, count: number, bands?: Uint8Array): Array<{ base: Vec3 }> {
  const { grid, top } = g;
  const foot = g.building.footprint.bounds();
  const door = g.building.doors[0];
  if (foot === undefined || count <= 0) return [];
  const F = DIR_OFFSET[door?.outward ?? 'south'];
  const U = [-F[1], F[0]] as const;
  const cx = (foot.minX + foot.maxX) / 2;
  const cz = (foot.minZ + foot.maxZ) / 2;
  const halfU = Math.abs(U[0]) * (foot.maxX - foot.minX) / 2 + Math.abs(U[1]) * (foot.maxZ - foot.minZ) / 2;
  const halfV = Math.abs(F[0]) * (foot.maxX - foot.minX) / 2 + Math.abs(F[1]) * (foot.maxZ - foot.minZ) / 2;
  const crownFree = (i: number): boolean => square(g, i, 2).length === 25 && square(g, i, 2).every((j) =>
    (g.cls[j] === C.meadow || g.cls[j] === C.pad) && g.path[j] === 0 && g.route[j] === 0 && g.struct[j] === 0 && g.ring[j] === 0 && g.covered[j] === 0
    && g.blocked[j] === 0); // Q3: keine Krone über einem Katalog-Objekt
  const trees: Array<{ base: Vec3 }> = [];
  for (const side of [1, -1, 0]) {
    if (trees.length >= count) break;
    let best: number | undefined;
    let bs = -Infinity;
    for (let i = 0; i < grid.size; i++) {
      const fd = g.footDist[i]!;
      if (g.cls[i] !== C.meadow || fd < 4 || fd > 7 || !free(g, i) || bands?.[i] === 1 || !crownFree(i)) continue;
      const u = (grid.x(i) - cx) * U[0] + (grid.z(i) - cz) * U[1];
      const v = (grid.x(i) - cx) * F[0] + (grid.z(i) - cz) * F[1];
      if (side !== 0 ? u * side <= halfU || v > halfV : v >= -halfV) continue; // seitlich, sonst dahinter – nie vor der Hauptfassade
      if (trees.some((t) => Math.max(Math.abs(t.base[0] - grid.x(i)), Math.abs(t.base[2] - grid.z(i))) < 6)) continue;
      const score = -Math.abs(fd - 5) - 0.1 * Math.abs(v);
      if (score > bs) {
        bs = score;
        best = i;
      }
    }
    if (best === undefined) continue;
    const base: Vec3 = [grid.x(best), top[best]!, grid.z(best)];
    emitTree(g, growTree('oak', base, new Rng(hashSeed(g.seed, 'house-tree', best))).blocks, 'oak');
    g.surface[best] = 'ground_dirt';
    for (const j of square(g, best, 1)) g.blocked[j] = 1;
    g.plantCol[best] = 1;
    trees.push({ base });
  }
  return trees;
}

/** V3 Streudeko: Blütenteppich/Gras in Flecken auf Gras neben Wegen. Liefert die Zahl gesetzter Pflanzen. */
export function scatter(g: Gen, amount: number): number {
  const { grid, top } = g;
  const rng = new Rng(hashSeed(g.seed, 'decor', 'scatter'));
  const noise = hashSeed(g.seed, 'scatter-patch');
  let n = 0;
  for (let i = 0; i < grid.size; i++) {
    if (g.surface[i] !== 'ground_grass' || !free(g, i) || g.covered[i] === 1) continue;
    if (g.cls[i] !== C.meadow && g.cls[i] !== C.meadowZone && g.cls[i] !== C.pad) continue;
    if (!grid.n4(i).some((j) => g.path[j] === 1)) continue;
    if (valueNoise2(noise, grid.x(i), grid.z(i), 4) > 0.3 + 0.5 * amount || !rng.chance(0.8)) continue;
    const pos: Vec3 = [grid.x(i), top[i]! + 1, grid.z(i)];
    const placed = rng.chance(0.6) ? g.emit(pos, 'plant', 'ground_cover', 'block', { facing: rng.pick(HORIZONTAL) }) : g.emit(pos, 'plant', 'grass_tuft', 'block');
    if (placed) {
      g.plantCol[i] = 1;
      n++;
    }
  }
  return n;
}
