import { describe, expect, it } from 'vitest';
import { key3 } from '@mcda/core';
import { LANDFORMS, generateSite, landformRelief, landformSpec, mossPatch, type Landform, type SiteResult } from '../src/index.js';
import { TEST_STYLE, fullSite, syntheticBuilding } from './fixtures.js';

const building = syntheticBuilding();
const gen = (landform?: Landform, seed = 11): SiteResult =>
  generateSite(fullSite(seed).state, TEST_STYLE, building, undefined, landform === undefined ? {} : { landform });
const digest = (r: SiteResult): string => JSON.stringify([r.cells, Array.from(r.top), r.surface]);

/** Von der Tür-Austrittszelle aus begehbar (Höhenstufe ≤ 1, kein Wasser) bis zum Grundstücksrand? */
function reachesBorder(r: SiteResult): boolean {
  const g = r.grid;
  const seen = new Uint8Array(g.size);
  const queue: number[] = [];
  for (const [x, z] of r.doorExits) {
    const i = g.idx(x, z);
    seen[i] = 1;
    queue.push(i);
  }
  while (queue.length > 0) {
    const i = queue.pop()!;
    if (g.x(i) === 0 || g.z(i) === 0 || g.x(i) === g.w - 1 || g.z(i) === g.d - 1) return true;
    for (const j of g.n4(i)) {
      if (seen[j] === 1 || Math.abs(r.top[i]! - r.top[j]!) > 1 || r.surface[j] === 'building' || r.surface[j]?.startsWith('water') === true) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return false;
}

describe('Geländeform (feat/gelaende)', () => {
  it('ohne Angabe und mit flat bitgleich', () => {
    const base = digest(gen());
    expect(digest(gen('flat'))).toBe(base);
    expect(landformSpec('flat')).toBeUndefined();
    expect(landformSpec(undefined)).toBeUndefined();
    const relief = TEST_STYLE.relief;
    expect(landformRelief(relief, undefined)).toBe(relief);
  });

  for (const form of LANDFORMS.filter((l) => l !== 'flat')) {
    it(`${form}: deterministisch, anders als flat, Tür bleibt am Weg und der Rand erreichbar`, () => {
      const a = gen(form);
      expect(digest(gen(form))).toBe(digest(a));
      expect(digest(a)).not.toBe(digest(gen('flat')));
      expect(a.pathAudit.unconnectedDoors).toEqual([]);
      expect(reachesBorder(a)).toBe(true);
    });

    it(`${form}: mehrere Seeds bleiben begehbar und bauen nicht in das Gebäude`, () => {
      for (const seed of [3, 7, 311, 2026]) {
        const r = gen(form, seed);
        expect(reachesBorder(r), `seed ${seed}`).toBe(true);
        for (const k of building.occupied) expect(r.cells.some((c) => key3(c.pos) === k), k).toBe(false);
      }
    });
  }

  it('dramatic hebt den Hang höher als natural', () => {
    const top = (r: SiteResult): number => Math.max(...Array.from(r.top));
    expect(top(gen('dramatic'))).toBeGreaterThan(top(gen('natural')));
    expect(top(gen('natural'))).toBeGreaterThan(top(gen('flat')));
  });

  it('Moosflecken sind deterministisch und decken etwa den Anteil ab', () => {
    let n = 0;
    for (let x = 0; x < 60; x++) for (let z = 0; z < 60; z++) if (mossPatch(5, x, z, 0.3)) n++;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(3600 * 0.9);
    expect(mossPatch(5, 3, 4, 0.3)).toBe(mossPatch(5, 3, 4, 0.3));
  });
});
