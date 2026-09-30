/**
 * W13-A (28.09.2026, plan/spikes/W13A_komposition.md): Komposition der Baumasse – Wohnhaus (fester Grundriss mit
 * Nebenbaukörper „Werkstatt“) und Bauernhaus (niedriger Anbau als Ensemble-Teil) bestehen aus mehreren Körpern mit
 * gestaffelten Dächern statt einer Kiste unter einem Dach. Über den Anwendungsdienst (`projectFromBuildingType` +
 * `generateBase`, wie Assistent, Engine und goldene Menge):
 *
 * - ≥ 2 angebaute Baukörper mit Räumen, ≥ 2 verschiedene Firsthöhen, ≥ 2 verschiedene Traufhöhen,
 * - 0 harte Verstöße, 0 dunkle Raumzellen, alle Räume erreichbar, Obergeschosse mit Treppe, keine Plan-Warnungen,
 * - Grundriss nie 4-zählig mit Drehsinn (Windrad-Wächter `findPinwheels` auf den Baukörpern),
 * - deterministisch.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { findPinwheels } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, type BaseWorld, type BuildingTypeResult } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

function build(type: string, size: 'S' | 'M' | 'L', theme: string, seed: number): { res: BuildingTypeResult; world: BaseWorld } {
  const def = ctx.buildingTypes.get(type)!;
  const res = projectFromBuildingType(def, { size, themeId: theme, targetVersion: TARGET_VERSIONS['1.21.11'] }, seed, ctx);
  return { res, world: generateBase(res.project, ctx, { ...res.build, ...res.surroundings }) };
}

interface Composition {
  readonly attached: number;
  readonly ridgeLevels: number;
  readonly eaveLevels: number;
  readonly chiral: number;
}

/** Firsthöhen (Grat der Dach-Höhenkarte ≥ 4 lang), Traufhöhen je angebautem Baukörper, Windrad-Figuren im Grundriss. */
function composition(res: BuildingTypeResult, world: BaseWorld): Composition {
  const rooms = res.project.state.rooms;
  const owner = new Map<string, string>();
  for (const r of rooms) for (const [x, z] of r.cells.toArray()) owner.set(`${x},${z}`, r.volumeId ?? 'v0');
  const main = new Set([...owner].filter(([, v]) => v === 'v0').map(([k]) => k));
  const near = (k: string): boolean => {
    const [x, z] = k.split(',').map(Number) as [number, number];
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => main.has(`${x + dx!},${z + dz!}`) || main.has(`${x + 2 * dx!},${z + 2 * dz!}`));
  };
  const attached = new Set([...owner].filter(([k, v]) => v === 'v0' || near(k)).map(([, v]) => v));
  const top = new Map<string, number>();
  const eave = new Map<string, number>();
  for (const c of world.shell.cells) {
    if (c.kind !== 'roof') continue;
    const k = `${c.pos[0]},${c.pos[2]}`;
    top.set(k, Math.max(top.get(k) ?? -Infinity, c.pos[1]));
    const v = owner.get(k);
    if (v !== undefined && attached.has(v)) eave.set(v, Math.min(eave.get(v) ?? Infinity, c.pos[1]));
  }
  const t = (x: number, z: number): number => top.get(`${x},${z}`) ?? -Infinity;
  // Grat: kein höherer Nachbar, quer dazu fällt das Dach beidseitig ab; Firsthöhe je zusammenhängendem Grat ≥ 4
  const crest = new Map<string, 'x' | 'z'>();
  for (const [k, h] of top) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    if (t(x + 1, z) > h || t(x - 1, z) > h || t(x, z + 1) > h || t(x, z - 1) > h) continue;
    // quer zum Grat fällt das Dach ab; ein 2 breiter First (gerade Spannweite) zählt mit
    const across = (dx: number, dz: number): boolean => {
      const a = t(x - dx, z - dz);
      const b = t(x + dx, z + dz);
      if (a < h && b < h) return true;
      if (a === h) return b < h && t(x - 2 * dx, z - 2 * dz) < h;
      if (b === h) return a < h && t(x + 2 * dx, z + 2 * dz) < h;
      return false;
    };
    if (across(0, 1)) crest.set(k, 'x');
    else if (across(1, 0)) crest.set(k, 'z');
  }
  const levels = new Set<number>();
  const seen = new Set<string>();
  for (const [k, dir] of crest) {
    if (seen.has(k)) continue;
    const stack = [k];
    seen.add(k);
    let lo = Infinity;
    let hi = -Infinity;
    let h = -Infinity;
    while (stack.length > 0) {
      const c = stack.pop()!;
      const [x, z] = c.split(',').map(Number) as [number, number];
      lo = Math.min(lo, dir === 'x' ? x : z);
      hi = Math.max(hi, dir === 'x' ? x : z);
      h = Math.max(h, t(x, z));
      for (const nb of [`${x + 1},${z}`, `${x - 1},${z}`, `${x},${z + 1}`, `${x},${z - 1}`]) if (crest.get(nb) === dir && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
    }
    if (hi - lo + 1 >= 4) levels.add(h);
  }
  // Grundriss der Erdgeschosse, Marke = Baukörper: 4-zählig mit Drehsinn darf er nie sein
  const ids = [...new Set(owner.values())];
  const cells = [...owner.keys()].map((k) => k.split(',').map(Number) as [number, number]);
  const bounds = { minX: Math.min(...cells.map((c) => c[0])), minZ: Math.min(...cells.map((c) => c[1])), maxX: Math.max(...cells.map((c) => c[0])), maxZ: Math.max(...cells.map((c) => c[1])) };
  const label = (x: number, z: number): number | undefined => {
    const v = owner.get(`${x},${z}`);
    return v === undefined ? undefined : ids.indexOf(v);
  };
  return { attached: attached.size, ridgeLevels: levels.size, eaveLevels: new Set(eave.values()).size, chiral: findPinwheels(label, bounds).length };
}

function hard(res: BuildingTypeResult, world: BaseWorld): Record<string, number> {
  const circ = world.circulation;
  return {
    errors: world.materialized.violations.filter((v) => v.severity === 'error').length,
    dark: world.materialized.light?.darkCells?.length ?? 0,
    planWarnings: res.plan.warnings.length,
    unreachable: circ?.unreachable.length ?? 0,
    upperWithoutStairs: circ?.stepless.upperWithoutStairs.length ?? 0,
    doorCollide: circ?.entry.colliding.length ?? 0,
  };
}

const ZERO = { errors: 0, dark: 0, planWarnings: 0, unreachable: 0, upperWithoutStairs: 0, doorCollide: 0 };

describe('W13-A Komposition der Baumasse (Wohnhaus, Bauernhaus)', () => {
  const cases: Array<[string, 'S' | 'M' | 'L', string, number]> = [
    ['house', 'S', 'medieval', 2026],
    ['house', 'M', 'nordic', 2026],
    ['house', 'L', 'timber', 7],
    ['house', 'M', 'rustic', 3],
    // W13-A Runde 2: Bauernhaus S ohne Anbau (siehe farmhouse.json5), dafür M in einem zweiten Seed
    ['farmhouse', 'M', 'rustic', 7],
    ['farmhouse', 'M', 'medieval', 2026],
    ['farmhouse', 'L', 'rustic', 5],
  ];
  for (const [type, size, theme, seed] of cases) {
    it(`${type} ${size} ${theme} Seed ${seed}: mehrere Körper, gestaffelte Dächer, 0 harte Verstöße, kein Windrad`, { timeout: HEAVY_TIMEOUT }, () => {
      const { res, world } = build(type, size, theme, seed);
      const c = composition(res, world);
      expect(c.attached, 'angebaute Baukörper').toBeGreaterThanOrEqual(2);
      expect(c.ridgeLevels, 'Firsthöhen').toBeGreaterThanOrEqual(2);
      expect(c.eaveLevels, 'Traufhöhen').toBeGreaterThanOrEqual(2);
      expect(c.chiral, 'Windrad im Grundriss').toBe(0);
      expect(hard(res, world)).toEqual(ZERO);
      // Räume in allen Baukörpern
      for (const v of res.project.state.volumes ?? []) expect(res.project.state.rooms.some((r) => r.volumeId === v.id), v.id).toBe(true);
    });
  }

  it('deterministisch: gleicher Seed, gleiche Baukörper und Räume', { timeout: HEAVY_TIMEOUT }, () => {
    for (const type of ['house', 'farmhouse']) {
      const a = projectFromBuildingType(ctx.buildingTypes.get(type)!, { size: 'M' }, 11, ctx).plan;
      const b = projectFromBuildingType(ctx.buildingTypes.get(type)!, { size: 'M' }, 11, ctx).plan;
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });
});
