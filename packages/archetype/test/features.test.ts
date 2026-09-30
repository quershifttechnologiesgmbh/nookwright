/**
 * W9-G1 (27.09.2026): Baumasse-Akzente – Auskragung auf Konsolen und Quergiebel/Vorbau. Einheit (`applyFeatures`) und
 * Plan-Ebene: Wohnbautypen × 3 Seeds haben Auskragung oder einen Vorsprung, der Plan bleibt geprüft (Hülle ohne
 * Warnung, alles erreichbar), deterministisch, und ohne `features` bleibt der Plan gleich.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUME } from '@mcda/blueprint';
import { parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import { CellSet, Rng } from '@mcda/core';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { planBuilding, type ArchetypeContext, type BuildingPlan, type PlanRoom } from '../src/index.js';
import { applyFeatures } from '../src/features.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const arch: ArchetypeContext = { minArea: (id) => (ctx.catalog.roomTypeIds().includes(id) ? ctx.catalog.roomType(id).minArea : 4) };
const load = (id: string): BuildingTypeDef => {
  const r = parseBuildingTypeDef(readFileSync(join(ROOT, 'buildingtypes', `${id}.json5`), 'utf8'), `${id}.json5`);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};

const room = (floor: number, x0: number, z0: number, x1: number, z1: number, type = 'storage'): PlanRoom => ({
  volumeId: DEFAULT_VOLUME, floor, cells: CellSet.rect(x0, z0, x1, z1), roomTypeId: type, entry: -1, required: true,
});
const main = { x0: 0, z0: 0, x1: 14, z1: 8 };

describe('applyFeatures (Einheit)', () => {
  it('Auskragung: jedes Obergeschoss genau 1 Block über der Etage darunter, gestaffelt höchstens 2', () => {
    const rooms = [room(0, 0, 0, 14, 8), room(1, 0, 0, 14, 8), room(2, 0, 0, 14, 8)];
    const r = applyFeatures({ jetty: { sides: ['front'], each: true } }, rooms, main, DEFAULT_VOLUME, 2, new Rng(1));
    expect(r.jetty).toBe(true);
    expect(r.rooms[0]!.cells.size).toBe(15 * 9);
    expect(r.rooms[1]!.cells.bounds()!.maxZ).toBe(9);
    expect(r.rooms[2]!.cells.bounds()!.maxZ).toBe(10);
    // ohne `each`: alle Obergeschosse bündig auf 1 Block
    const flat = applyFeatures({ jetty: { sides: ['front', 'back'] } }, rooms, main, DEFAULT_VOLUME, 2, new Rng(1));
    expect(flat.rooms[2]!.cells.bounds()).toEqual({ minX: 0, minZ: -1, maxX: 14, maxZ: 9 });
  });

  it('keine Auskragung an einer Seite mit Anbau (dort steht etwas darunter), die andere Seite schon', () => {
    const rooms = [room(0, 0, 0, 14, 8), room(0, 0, 9, 6, 12, 'stable'), room(1, 0, 0, 14, 8)];
    const r = applyFeatures({ jetty: { sides: ['front', 'back'] } }, rooms, main, DEFAULT_VOLUME, 1, new Rng(1));
    const up = r.rooms[2]!.cells;
    for (let x = 0; x <= 14; x++) expect(up.has(x, 9)).toBe(false);
    for (let x = 0; x <= 14; x++) expect(up.has(x, -1)).toBe(true);
  });

  it('Quergiebel liegt vor genau einem Raum, mittig mit der Parität der Front', () => {
    const rooms = [room(0, 0, 0, 4, 8, 'kitchen'), room(0, 5, 0, 14, 8, 'solar')];
    const r = applyFeatures({ cross: { width: [7, 9], depth: 3, align: 'start' } }, rooms, main, DEFAULT_VOLUME, 0, new Rng(3));
    // Ecke links: der Raum dort ist nur 5 breit → Vorsprung 5 breit vor der Küche
    expect(r.cross).toEqual({ x0: 0, z0: 9, x1: 4, z1: 11 });
    expect(r.rooms[0]!.cells.has(4, 11)).toBe(true);
    expect(r.rooms[1]!.cells.has(5, 9)).toBe(false);
    const c = applyFeatures({ cross: { width: [6, 8], depth: 3, align: 'center' } }, [room(0, 0, 0, 14, 8)], main, DEFAULT_VOLUME, 0, new Rng(3));
    expect((c.cross!.x1 - c.cross!.x0 + 1) % 2).toBe(1);
    expect(c.cross!.x0 - main.x0).toBe(main.x1 - c.cross!.x1);
  });

  it('ohne Akzente unverändert, deterministisch', () => {
    const rooms = [room(0, 0, 0, 14, 8), room(1, 0, 0, 14, 8)];
    expect(applyFeatures(undefined, rooms, main, DEFAULT_VOLUME, 1, new Rng(1)).rooms).toEqual(rooms);
    const f = { jetty: { sides: ['front' as const], prob: 0.5 }, cross: { width: [5, 9] as [number, number], depth: [2, 4] as [number, number], align: 'any' as const } };
    expect(applyFeatures(f, rooms, main, DEFAULT_VOLUME, 1, new Rng(9))).toEqual(applyFeatures(f, rooms, main, DEFAULT_VOLUME, 1, new Rng(9)));
  });
});

/** Zellen eines Obergeschosses außerhalb der Etage darunter (je Baukörper). */
function overhang(p: BuildingPlan): number {
  const fp = new Map<string, CellSet>();
  for (const r of p.rooms) fp.set(`${r.volumeId}|${r.floor}`, (fp.get(`${r.volumeId}|${r.floor}`) ?? CellSet.empty()).union(r.cells));
  let n = 0;
  for (const [k, cells] of fp) {
    const [v, f] = k.split('|');
    const below = fp.get(`${v}|${Number(f) - 1}`);
    if (Number(f) >= 1 && below !== undefined) n += cells.difference(below).size;
  }
  return n;
}
/** Ausdehnung der Erdgeschoss-Zellen über das Rechteck des Hauptbaukörpers hinaus (Vorsprung vor der Front). */
const groundShape = (p: BuildingPlan): number => {
  const g = p.rooms.filter((r) => r.floor === 0 && r.volumeId === DEFAULT_VOLUME).reduce((u, r) => u.union(r.cells), CellSet.empty());
  const b = g.bounds()!;
  return (b.maxX - b.minX + 1) * (b.maxZ - b.minZ + 1) - g.size;
};

describe('Wohnbautypen: Akzente im Plan (M, 3 Seeds)', () => {
  const TYPES = ['house', 'twostory', 'timber', 'tavern', 'townhouse', 'farmhouse'];
  it('jede Welt hat Auskragung oder einen Vorsprung (L/T), Plan ohne Befund', () => {
    for (const id of TYPES) {
      const def = load(id);
      for (const seed of [2026, 7, 42]) {
        const p = planBuilding(def, { ...(def.sizes ? { size: 'M' as const } : {}) }, seed, arch);
        expect(p.warnings, `${id}/${seed}`).toEqual([]);
        expect(overhang(p) > 0 || groundShape(p) > 0, `${id}/${seed}`).toBe(true);
        // Auskragung nur mit Konsolen (sonst wäre sie eine Hüllen-Warnung)
        if (overhang(p) > 0) expect(p.shell.facade?.brackets ?? 0).toBeGreaterThanOrEqual(1);
      }
    }
  }, HEAVY_TIMEOUT);

  it('deterministisch; ohne `features` wie vorher (Kiste)', () => {
    const def = load('tavern');
    const a = planBuilding(def, { size: 'M' }, 11, arch);
    expect(planBuilding(def, { size: 'M' }, 11, arch)).toEqual(a);
    const m = def.massing;
    if (m.generator !== 'wings') throw new Error('wings erwartet');
    const { features: _f, ...plain } = m;
    const box = planBuilding({ ...def, massing: plain }, { size: 'M' }, 11, arch);
    expect(overhang(box)).toBe(0);
    expect(overhang(a)).toBeGreaterThan(0);

  }, HEAVY_TIMEOUT);
});
