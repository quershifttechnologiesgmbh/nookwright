/** MX-Q: `building_generate` mit `measure: true` liefert Fassadenmaße, Detail-Obergrenze und Auflager; ohne fehlt das Feld. */
import { describe, expect, it } from 'vitest';
import { engine } from './fixture.js';

describe('building_generate: measure', () => {
  it('ohne Angabe kein Feld, Blöcke gleich; mit Angabe measures samt lints', () => {
    const q = { op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'S', seed: 5, surroundings: false } };
    const plain = engine.execute(q);
    const measured = engine.execute({ ...q, input: { ...q.input, measure: true } });
    if (!plain.ok || !measured.ok) throw new Error(JSON.stringify([plain, measured]).slice(0, 400));
    expect(plain.data).not.toHaveProperty('measures');
    expect(measured.artifacts?.export?.blocks).toEqual(plain.artifacts?.export?.blocks);
    const m = (measured.data as { measures: Record<string, Record<string, unknown>> }).measures;
    expect(Object.keys(m).sort()).toEqual(['detail', 'facade', 'lints', 'support']);
    expect(m['facade']).toMatchObject({ articulationPlan: expect.any(Number), articulationFront: expect.any(Number), facadeSymmetry: expect.any(Number), facadeEntropy: expect.any(Number) });
    expect(m['detail']).toMatchObject({ freeShare: expect.any(Number), freeMin: expect.any(Number) });
    expect(m['support']).toMatchObject({ floating: 0, limit: 2 });
  });
});
