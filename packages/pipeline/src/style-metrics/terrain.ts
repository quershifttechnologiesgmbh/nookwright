/**
 * Gelände- und Umgebungs-Kennzahlen: Einbettung des Sockels (LV-15), Bewuchs und Bodenoberfläche (LV-16), Wege (LV-17).
 */
import { isClimber, isNature, isSoftDecor, isWeathered, TRANSITION_GROUND } from './blocks.js';
import { footprintOf } from './massing.js';
import { DIRS, OwnerKind, surfaceY, type Scene, type StyleInput } from './scene.js';
import type { Measure, Measures } from './types.js';

const measure = (value: number | null, weight: number, details?: Record<string, number | string | boolean | null>): Measure =>
  details === undefined ? { value, weight } : { value, weight, details };

/** Natürlicher Untergrund (kein Weg, keine Pflasterung). */
const NATURAL_GROUND: ReadonlySet<string> = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'rooted_dirt', 'moss_block', 'mud', 'sand', 'red_sand', 'snow_block', 'clay', 'stone', 'andesite', 'granite', 'diorite', 'tuff', 'sandstone', 'red_sandstone', 'terracotta', 'gravel']);

/** Oberster belegter Block einer Spalte zwischen `yTop` und `yTop - 3`, ohne weiche Zutaten (Gras-Büschel, Blumen) und ohne Treppen/Platten/Zäune (Vorbau statt Boden). */
function groundTop(scene: Scene, x: number, z: number, yTop: number): string | undefined {
  for (let y = yTop; y >= yTop - 3; y--) {
    const n = scene.vox.name(x, y, z);
    if (n === 'air' || isSoftDecor(n) && n !== 'moss_block' || /_(slab|stairs|wall|fence|trapdoor)$/.test(n)) continue;
    return n;
  }
  return undefined;
}

/**
 * Oberflächenblock je Spalte im Grundstück: alle Spalten innerhalb von `near` Blöcken um die Baukörper-Boxen,
 * ohne die Grundrisse der Bauten (Gelände-Schicht, Wasser ausgenommen).
 */
export function plotSurface(scene: Scene, near: number): Map<string, { y: number; name: string }> {
  const { vox } = scene;
  const footprintCols = new Set<string>();
  for (const b of scene.buildings) for (const k of footprintOf(b)) footprintCols.add(k);
  const surf = new Map<string, { y: number; name: string }>();
  for (let z = vox.oz; z < vox.oz + vox.l; z++) {
    for (let x = vox.ox; x < vox.ox + vox.w; x++) {
      if (footprintCols.has(`${x},${z}`)) continue;
      let ok = scene.buildings.length === 0;
      for (const b of scene.buildings) if (x >= b.minX - near && x <= b.maxX + near && z >= b.minZ - near && z <= b.maxZ + near) { ok = true; break; }
      if (!ok) continue;
      const y = surfaceY(vox, x, z);
      if (y !== undefined) surf.set(`${x},${z}`, { y, name: vox.name(x, y, z) });
    }
  }
  return surf;
}

export const NATURAL_GROUND_BLOCKS = NATURAL_GROUND;

const WALLISH = new Set(['wall', 'pillar', 'door', 'window', 'lintel']);

export function measureTerrain(scene: Scene, input: StyleInput): Measures {
  const m: Record<string, Measure> = {};
  const { vox } = scene;

  // --- LV-15a: Übergangsblöcke am Sockelumfang ---
  {
    let n = 0, trans = 0;
    const kinds = new Set<string>();
    for (const b of scene.buildings) {
      const base = new Map<string, number>();
      for (const f of b.faces) {
        const k = `${f.x},${f.z},${f.dir}`;
        const v = base.get(k);
        if (v === undefined || f.y < v) base.set(k, f.y);
      }
      for (const [k, y] of base) {
        const [xs, zs, d] = k.split(',');
        const [dx, dz] = DIRS[d as keyof typeof DIRS];
        for (const step of [1, 2]) {
          const gx = Number(xs) + dx * step, gz = Number(zs) + dz * step;
          const g = groundTop(scene, gx, gz, y);
          if (g === undefined) continue;
          n++; kinds.add(g);
          if (TRANSITION_GROUND.has(g) || isNature(g)) trans++;
        }
      }
    }
    m['LV-15a'] = measure(n === 0 ? null : trans / n, n, { ringKinds: kinds.size });
  }

  // --- LV-15b: Lufttaschen unter dem Sockel ---
  {
    let cols = 0, pockets = 0;
    for (const b of scene.buildings) {
      const low = new Map<string, number>();
      const wallCols = new Set<string>();
      for (const c of b.cells) if (WALLISH.has(c.kind)) wallCols.add(`${c.pos[0]},${c.pos[2]}`);
      for (const c of b.cells) {
        if (c.kind === 'roof' || c.kind === 'ceiling') continue;
        const k = `${c.pos[0]},${c.pos[2]}`;
        if (!wallCols.has(k)) continue;
        const v = low.get(k);
        if (v === undefined || c.pos[1] < v) low.set(k, c.pos[1]);
      }
      for (const [k, y] of low) {
        const [xs, zs] = k.split(',');
        const x = Number(xs), z = Number(zs);
        if (y > b.groundY + 1) continue; // Auskragung im Obergeschoss: kein Sockel
        if (!vox.inside(x, y - 1, z)) continue;
        cols++;
        if (!vox.solid(x, y - 1, z)) pockets++;
      }
    }
    m['LV-15b'] = measure(cols === 0 ? null : pockets / cols, cols);
  }

  const surf = plotSurface(scene, 12);

  // --- LV-15c: Höhenunterschied ---
  {
    const ys = [...surf.values()].map((s) => s.y).sort((a, b) => a - b);
    const range = ys.length === 0 ? null : ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.99))]! - ys[Math.floor(ys.length * 0.01)]!;
    m['LV-15c'] = measure(range, ys.length);
  }

  // --- LV-15d: Naturanteil ---
  {
    let gy = Infinity;
    for (const b of scene.buildings) gy = Math.min(gy, b.groundY);
    if (!Number.isFinite(gy)) gy = vox.oy;
    let nature = 0, building = 0;
    for (const c of vox.solids()) {
      if (c.y < gy - 1) continue;
      if (isNature(c.name)) nature++;
      else if (c.owner !== OwnerKind.Terrain && c.owner !== OwnerKind.Other) building++;
    }
    m['LV-15d'] = measure(nature + building === 0 ? null : nature / (nature + building), nature + building, { nature, building });
  }

  // --- LV-16a: Bewuchs an der Fassade ---
  {
    let n = 0, grown = 0, low = 0, lowN = 0;
    for (const b of scene.buildings) {
      if (b.faces.length === 0) continue;
      const y0 = Math.min(...b.faces.map((f) => f.y));
      for (const f of b.faces) {
        if (f.cell.kind === 'window' || f.cell.kind === 'door') continue;
        n++;
        const g = isClimber(f.k1Name) || isWeathered(f.wallName);
        if (g) grown++;
        if (f.y - y0 <= 2) { lowN++; if (g) low++; }
      }
    }
    m['LV-16a'] = measure(n === 0 ? null : grown / n, n, { base: lowN === 0 ? null : low / lowN });
  }

  // --- LV-16b/c: Bodenoberfläche ---
  {
    const counts = new Map<string, number>();
    for (const s of surf.values()) if (s.name !== 'water') counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
    let total = 0;
    for (const v of counts.values()) total += v;
    m['LV-16b'] = measure(total === 0 ? null : [...counts.values()].filter((c) => c / total >= 0.03).length, total);
    let pairs = 0, diff = 0;
    for (const [k, s] of surf) {
      if (s.name === 'water') continue;
      const [xs, zs] = k.split(',');
      const x = Number(xs), z = Number(zs);
      for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
        const o = surf.get(`${x + dx},${z + dz}`);
        if (o === undefined || o.name === 'water') continue;
        pairs++;
        if (o.name !== s.name) diff++;
      }
    }
    m['LV-16c'] = measure(pairs === 0 ? null : diff / pairs, pairs);
  }

  // --- LV-17: Türen mit Wegverbindung ---
  {
    let doors = 0, front = 0;
    for (const b of scene.buildings) {
      for (const r of b.rooms) {
        for (const d of r.doors) {
          const [dx, dz] = DIRS[d.toward];
          const ox = d.inside[0] + dx * 2, oz = d.inside[1] + dz * 2;
          if (!scene.isExteriorAir(ox, r.baseY, oz)) continue;
          doors++;
          const g = groundTop(scene, ox, oz, r.baseY - 1);
          if (g !== undefined && !NATURAL_GROUND.has(g) && !isNature(g)) front++;
        }
      }
    }
    const un = input.pathAudit?.unconnectedDoors.length;
    m['LV-17'] = measure(un === undefined || doors === 0 ? null : Math.max(0, 1 - un / doors), doors, { unconnected: un ?? null, pavedDoorFront: doors === 0 ? null : front / doors });
  }
  return m;
}
