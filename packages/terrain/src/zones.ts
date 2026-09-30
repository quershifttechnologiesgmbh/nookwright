/**
 * Neue Außenbereiche und Ankerbauten (research/18 A3, A4, G2, V4):
 *  - Brunnen/Brunnenhaus (A4) in der Hof- bzw. Platzmitte, rundherum frei, neben der Türachse.
 *  - Platz/Anger (G2): Pflaster mit Ringmuster, Mitte Brunnen (sonst Baum oder Laterne), Laternen an den Ecken.
 *  - Obstgarten (V4): Obstbäume im Raster, Gras dazwischen.
 *  - Koppel (A3): grobe Erde, Zaun mit Pfosten und Tor, Tränke und Heu.
 * Alle Funktionen arbeiten auf dem Arbeitszustand des Generators (`Gen`) und setzen Sperren (`blocked`), bevor
 * die Wege geführt werden, wo nötig.
 */
import { HORIZONTAL, Rng, hashSeed, type HorizontalDir, type Vec3 } from '@mcda/core';
import { C, type Gen } from './gen.js';
import { DIR_OFFSET } from './grid.js';
import type { TerrainRole } from './roles.js';
import { growFruitTree, growTree } from './vegetation.js';

/** Zellen im Abstand ≤ 1 quer zum Strahl vor jeder Außentür (die Türachse bleibt frei, research/18 S1 Regel 7). */
export function doorAxis(g: Gen): Uint8Array {
  const { grid } = g;
  const band = new Uint8Array(grid.size);
  for (const d of g.building.doors) {
    const [dx, dz] = DIR_OFFSET[d.outward];
    for (let s = 1; s < 512; s++) {
      const x = d.cell[0] + dx * s;
      const z = d.cell[1] + dz * s;
      if (!grid.inside(x, z)) break;
      for (let k = -1; k <= 1; k++) {
        const j = grid.at(x + dz * k, z + dx * k);
        if (j >= 0) band[j] = 1;
      }
    }
  }
  return band;
}

/**
 * Mitte eines 3 × 3-Brunnens in der Zone: der Brunnen und 2 Blöcke rundherum liegen in der Zone (sonst 1),
 * Brunnen + 1 Ring nicht im Band `avoid`; nächst dem Schwerpunkt.
 */
export function wellSite(g: Gen, cells: readonly number[], avoid?: Uint8Array): number | undefined {
  const { grid } = g;
  const set = new Set(cells);
  const cx = cells.reduce((s, i) => s + grid.x(i), 0) / cells.length;
  const cz = cells.reduce((s, i) => s + grid.z(i), 0) / cells.length;
  for (const margin of [2, 1]) {
    let best: number | undefined;
    let bd = Infinity;
    for (const c of cells) {
      let ok = true;
      for (let dx = -1 - margin; dx <= 1 + margin && ok; dx++) {
        for (let dz = -1 - margin; dz <= 1 + margin && ok; dz++) {
          const j = grid.at(grid.x(c) + dx, grid.z(c) + dz);
          if (j < 0 || !set.has(j) || g.blocked[j] === 1) ok = false;
          else if (avoid !== undefined && Math.max(Math.abs(dx), Math.abs(dz)) <= 2 && avoid[j] === 1) ok = false;
        }
      }
      if (!ok) continue;
      const d = (grid.x(c) - cx) ** 2 + (grid.z(c) - cz) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best !== undefined) return best;
  }
  return undefined;
}

/** Sperrt die 3 × 3 Spalten des Brunnens (vor der Wegführung). */
export function reserveWell(g: Gen, c: number): void {
  for (const j of square(g, c, 1)) g.blocked[j] = 1;
}

/**
 * Brunnen (A4): Wasser 2 tief in der Mitte, Einfassung aus `well_stone` (Mauerkranz), beim Brunnenhaus Stammpfosten
 * an den Ecken, Dach aus oberen Stufen und eine Laterne obendrauf; offen: Laterne auf einem Eckpfosten der Mauer.
 */
export function buildWell(g: Gen, c: number, level: number, kind: 'open' | 'roofed'): Vec3 {
  const { grid, emit } = g;
  const x0 = grid.x(c);
  const z0 = grid.z(c);
  g.water[c] = 2;
  g.surface[c] = 'water';
  g.bed[c] = 'well_stone';
  for (const j of square(g, c, 1)) {
    g.plantCol[j] = 1;
    g.blocked[j] = 1;
    if (j === c) continue;
    g.surface[j] = 'well_stone';
    const corner = grid.x(j) !== x0 && grid.z(j) !== z0;
    const p: Vec3 = [grid.x(j), level + 1, grid.z(j)];
    if (kind === 'roofed' && corner) {
      for (let dy = 1; dy <= 3; dy++) emit([p[0], level + dy, p[2]], 'plant', 'fence_post', 'log', { axis: 'y' });
    } else emit(p, 'plant', 'well_stone', 'wall');
  }
  if (kind === 'roofed') {
    for (const j of square(g, c, 1)) emit([grid.x(j), level + 4, grid.z(j)], 'plant', 'well_roof', 'slab', { half: 'top' });
    const lamp: Vec3 = [x0, level + 5, z0];
    emit(lamp, 'plant', 'light_outdoor', 'lantern');
    return lamp;
  }
  const lamp: Vec3 = [x0 - 1, level + 2, z0 - 1];
  emit(lamp, 'plant', 'light_outdoor', 'lantern');
  return lamp;
}

/** Laternenpfahl (L1 c/d): Stammsockel, Zaun, Laterne obendrauf. */
export function emitLampPost(g: Gen, i: number): Vec3 {
  const x = g.grid.x(i);
  const z = g.grid.z(i);
  const t = g.top[i]!;
  g.emit([x, t + 1, z], 'plant', 'fence_post', 'log', { axis: 'y' });
  g.emit([x, t + 2, z], 'plant', 'fence_outdoor', 'fence');
  g.emit([x, t + 3, z], 'plant', 'light_outdoor', 'lantern');
  g.blocked[i] = 1;
  g.plantCol[i] = 1;
  return [x, t + 3, z];
}

/**
 * Platz (G2) vor der Wegführung: Mitte (Brunnen, sonst Baum bzw. Laterne) und Eckpfähle reservieren. `frontLamps`
 * (W3-GA, `decor.kits`): nur die zwei Ecken, die am weitesten vom Haus liegen (zur Straße), statt aller vier – der
 * Brunnen trägt selbst eine Laterne.
 */
export function planPlaza(g: Gen, cells: readonly number[], frontLamps = false): { well?: number; tree?: number; lamps: number[] } {
  const { grid } = g;
  const set = new Set(cells);
  const lamps: number[] = [];
  const xs = cells.map((i) => grid.x(i));
  const zs = cells.map((i) => grid.z(i));
  const corners = ([[Math.min(...xs), Math.min(...zs)], [Math.max(...xs), Math.min(...zs)], [Math.min(...xs), Math.max(...zs)], [Math.max(...xs), Math.max(...zs)]] as const)
    .map(([x, z]) => grid.at(x, z));
  const chosen = frontLamps ? [...corners].sort((a, b) => (a < 0 ? 1 : b < 0 ? -1 : g.footDist[b]! - g.footDist[a]! || a - b)).slice(0, 2) : corners;
  for (const j of corners) {
    if (!chosen.includes(j)) continue;
    if (j >= 0 && set.has(j) && g.blocked[j] === 0) {
      g.blocked[j] = 1;
      lamps.push(j);
    }
  }
  const well = wellSite(g, cells);
  if (well !== undefined) {
    reserveWell(g, well);
    return { well, lamps };
  }
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const d = Math.max(...zs) - Math.min(...zs) + 1;
  const mid = grid.at(Math.round((Math.min(...xs) + Math.max(...xs)) / 2), Math.round((Math.min(...zs) + Math.max(...zs)) / 2));
  if (mid >= 0 && set.has(mid) && g.blocked[mid] === 0) {
    g.blocked[mid] = 1;
    if (Math.min(w, d) >= 7) return { tree: mid, lamps };
    lamps.push(mid);
  }
  return { lamps };
}

/** Platz anlegen: Pflaster mit Ringen (`plaza_accent` jeder 3. Ring um die Mitte), Brunnen/Baum, Eckpfähle. */
export function layoutPlaza(
  g: Gen, cells: readonly number[], level: number, plan: ReturnType<typeof planPlaza>, wellKind: 'open' | 'roofed', paving?: ReadonlyMap<number, string>,
): void {
  const { grid } = g;
  const xs = cells.map((i) => grid.x(i));
  const zs = cells.map((i) => grid.z(i));
  const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
  const cz = Math.round((Math.min(...zs) + Math.max(...zs)) / 2);
  for (const i of cells) {
    const r = Math.max(Math.abs(grid.x(i) - cx), Math.abs(grid.z(i) - cz));
    g.surface[i] = paving?.get(i) ?? (r > 0 && r % 3 === 0 ? 'plaza_accent' : 'ground_yard');
  }
  if (plan.well !== undefined) buildWell(g, plan.well, level, wellKind);
  if (plan.tree !== undefined) {
    const i = plan.tree;
    const tree = growTree('oak', [grid.x(i), level, grid.z(i)], new Rng(hashSeed(g.seed, 'plaza-tree', i)));
    emitTree(g, tree.blocks, 'oak');
    g.surface[i] = 'ground_dirt';
    g.plantCol[i] = 1;
  }
  for (const j of plan.lamps) emitLampPost(g, j);
}

/** Obstgarten vor der Wegführung: Stämme im Raster (Abstand `spacing`), ≥ 2 vom Rand der Innenfläche. */
export function planOrchard(g: Gen, interior: readonly number[], spacing: number): number[] {
  const { grid } = g;
  const set = new Set(interior);
  const x0 = Math.min(...interior.map((i) => grid.x(i)));
  const z0 = Math.min(...interior.map((i) => grid.z(i)));
  const trunks: number[] = [];
  for (const i of interior) {
    const dx = grid.x(i) - x0 - 2;
    const dz = grid.z(i) - z0 - 2;
    if (dx < 0 || dz < 0 || dx % spacing !== 0 || dz % spacing !== 0) continue;
    if (square(g, i, 2).length < 25 || !square(g, i, 2).every((j) => set.has(j))) continue;
    g.blocked[i] = 1;
    trunks.push(i);
  }
  return trunks;
}

export function layoutOrchard(g: Gen, trunks: readonly number[], level: number): Vec3[] {
  const { grid } = g;
  const out: Vec3[] = [];
  for (const i of trunks) {
    const base: Vec3 = [grid.x(i), level, grid.z(i)];
    emitTree(g, growFruitTree(base, new Rng(hashSeed(g.seed, 'fruit', i))).blocks, 'fruit');
    g.surface[i] = 'ground_dirt';
    g.plantCol[i] = 1;
    out.push(base);
  }
  return out;
}

/** Koppel (A3): Boden, Tränke nahe dem Tor, Heuballen in der hintersten Ecke. */
export function layoutPaddock(g: Gen, interior: readonly number[], entry: number, level: number, zoneId: string): void {
  const { grid, emit } = g;
  for (const i of interior) g.surface[i] = 'paddock_ground';
  if (interior.length < 9) return;
  const rng = new Rng(hashSeed(g.seed, 'paddock', zoneId));
  const set = new Set(interior);
  const edge = interior.filter((i) => grid.n4(i).some((j) => !set.has(j)));
  const dist = (i: number): number => (entry < 0 ? 0 : Math.abs(grid.x(i) - grid.x(entry)) + Math.abs(grid.z(i) - grid.z(entry)));
  const free = (i: number): boolean => i !== entry && g.blocked[i] === 0 && dist(i) >= 2;
  const trough = edge.filter(free).sort((a, b) => dist(a) - dist(b) || a - b)[0];
  if (trough !== undefined) {
    emit([grid.x(trough), level + 1, grid.z(trough)], 'plant', 'trough', 'block');
    g.blocked[trough] = 1;
    g.plantCol[trough] = 1;
  }
  const far = edge.filter(free).sort((a, b) => dist(b) - dist(a) || a - b)[0];
  if (far !== undefined) {
    const hay = [far, ...grid.n4(far).filter((j) => set.has(j) && free(j))].slice(0, rng.int(1, 3));
    for (const j of hay) {
      emit([grid.x(j), level + 1, grid.z(j)], 'plant', 'hay', 'block');
      g.blocked[j] = 1;
      g.plantCol[j] = 1;
    }
  }
}

/** Baum setzen (Stamm senkrecht, Laub der Art). */
export function emitTree(g: Gen, blocks: ReturnType<typeof growTree>['blocks'], species: 'oak' | 'birch' | 'spruce' | 'fruit'): void {
  for (const b of blocks) {
    if (b.part === 'log') g.emit(b.pos, 'plant', (species === 'fruit' ? 'log_oak' : `log_${species}`) as TerrainRole, 'log', { axis: 'y' });
    else if (species === 'fruit') g.emit(b.pos, 'plant', 'leaves_fruit', 'block');
    else g.emit(b.pos, 'plant', `leaves_${species}` as TerrainRole, 'leaves');
  }
}

/** Spalten im Chebyshev-Quadrat mit Radius r (nur im Grundstück). */
export function square(g: Gen, c: number, r: number): number[] {
  const out: number[] = [];
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const j = g.grid.at(g.grid.x(c) + dx, g.grid.z(c) + dz);
      if (j >= 0) out.push(j);
    }
  }
  return out;
}

export const facingOf = (dx: number, dz: number): HorizontalDir => HORIZONTAL.find((d) => DIR_OFFSET[d][0] === Math.sign(dx) && DIR_OFFSET[d][1] === Math.sign(dz)) ?? 'south';
export const isOpenZone = (cls: number): boolean => cls === C.yard || cls === C.plaza || cls === C.orchard;
