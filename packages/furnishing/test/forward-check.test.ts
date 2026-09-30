/**
 * W8-A (plan/spikes/W8A_forward_check.md): Forward Checking im Einrichtungs-Solver und die Reihenfolge-Experimente
 * (`order`). Die Sackgasse selbst (große Signatur nimmt der Bank die Wand) prüft `solver-v2.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { furnishRoom } from '../src/index.js';
import { DV, assertHardGuarantees, catalog, shellRoom } from './fixtures.js';

const ROOMS = [['bedroom', 8, 8], ['kitchen', 9, 7], ['library', 10, 8], ['tavern', 12, 10]] as const;

describe('W8-A Forward Checking', () => {
  it('ohne Sackgasse bitgleich zum Lauf ohne Forward Checking (gleiche Würfe)', () => {
    for (const [rt, w, d] of ROOMS) {
      for (const seed of [1, 2, 3]) {
        const g = shellRoom(w, d);
        const on = furnishRoom(g, catalog.roomType(rt), catalog, { seed, dataVersion: DV });
        const off = furnishRoom(g, catalog.roomType(rt), catalog, { seed, dataVersion: DV, forwardCheck: false });
        expect(on.placements, `${rt} seed ${seed}`).toEqual(off.placements);
        expect(on.warnings).toEqual(off.warnings);
      }
    }
  });

  it('deterministisch: gleicher Seed → gleiches Ergebnis', () => {
    const g = shellRoom(6, 8);
    for (const seed of [1, 4, 6]) {
      const a = furnishRoom(g, catalog.roomType('tavern'), catalog, { seed, dataVersion: DV });
      const b = furnishRoom(g, catalog.roomType('tavern'), catalog, { seed, dataVersion: DV });
      expect(a.placements).toEqual(b.placements);
      assertHardGuarantees(g, a, `tavern seed ${seed}`);
    }
  });
});

describe('W8-A Reihenfolge-Experimente (Standard aus)', () => {
  for (const order of ['dynamic', 'entropy', 'dynamic-entropy'] as const) {
    it(`${order}: harte Garantien, alle Pflichtobjekte, deterministisch`, () => {
      for (const [rt, w, d] of ROOMS) {
        const g = shellRoom(w, d);
        const a = furnishRoom(g, catalog.roomType(rt), catalog, { seed: 2, dataVersion: DV, order });
        const b = furnishRoom(g, catalog.roomType(rt), catalog, { seed: 2, dataVersion: DV, order });
        expect(a.placements).toEqual(b.placements);
        expect(a.warnings.filter((x) => x.startsWith('Pflichtobjekt')), `${order} ${rt}`).toEqual([]);
        assertHardGuarantees(g, a, `${order} ${rt}`);
      }
    });
  }

  it('static ist der Standard', () => {
    const g = shellRoom(10, 8);
    const a = furnishRoom(g, catalog.roomType('library'), catalog, { seed: 3, dataVersion: DV });
    const b = furnishRoom(g, catalog.roomType('library'), catalog, { seed: 3, dataVersion: DV, order: 'static' });
    expect(a.placements).toEqual(b.placements);
  });
});
