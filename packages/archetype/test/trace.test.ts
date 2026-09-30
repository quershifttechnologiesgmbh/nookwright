/**
 * Beobachter `ArchetypeContext.traceLayout` (Erklärvideo, 27.09.2026) ist rein lesend: Mit und ohne ihn entsteht
 * derselbe Plan; je Etage kommen 10 Kandidaten mit Kosten je Term, und die gemeldete Wahl ist der billigste Kandidat.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { archetypeContext } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { planBuilding, type BuildingPlan, type LayoutTraceEvent } from '../src/index.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const key = (p: BuildingPlan): string => JSON.stringify({
  attempt: p.attempt, floors: p.floors, stairs: p.stairs, warnings: p.warnings, hints: p.hints,
  rooms: p.rooms.map((r) => [r.volumeId, r.floor, r.roomTypeId, r.cells.toArray()]),
});

describe('traceLayout (Beobachter des Grundriss-Generators)', () => {
  it.each([['tavern', 83], ['farmhouse', 3], ['longhouse', 5]] as const)('%s Seed %i: gleicher Plan, 10 Kandidaten je Suche, Wahl = billigster', (id, seed) => {
    const def = ctx.buildingTypes.get(id);
    const params = { themeId: def.themes?.[0] ?? 'medieval', reroll: 0 };
    const plain = planBuilding(def, params, seed, archetypeContext(ctx.catalog, ctx.themes));
    const events: LayoutTraceEvent[] = [];
    const traced = planBuilding(def, params, seed, { ...archetypeContext(ctx.catalog, ctx.themes), traceLayout: (e) => events.push(e) });
    expect(key(traced)).toBe(key(plain));
    const floors = events.filter((e) => e.type === 'floor');
    expect(floors.length).toBeGreaterThan(0);
    for (const f of floors) {
      const cands = events.filter((e) => e.type === 'candidate' && e.attempt === f.attempt && e.volumeId === f.volumeId && e.floor === f.floor
        && e.wing === f.wing && e.search === f.search);
      expect(cands).toHaveLength(10);
      const costs = cands.flatMap((c) => (c.type === 'candidate' && c.cost !== undefined ? [c.cost] : []));
      expect(f.cost).toBe(Math.min(...costs));
      for (const c of cands) {
        if (c.type !== 'candidate' || c.terms === undefined) continue;
        const sum = Object.values(c.terms).reduce((s, v) => s + v, 0);
        expect(sum).toBeCloseTo(c.cost!, 9);
      }
    }
    expect(events.some((e) => e.type === 'attempt' && e.attempt === traced.attempt)).toBe(true);
  });
});
