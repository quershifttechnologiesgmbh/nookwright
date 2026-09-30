/**
 * W7-B (plan/spikes/W7B_burg.md, Baustandard F1): Leitern im Turm nie auf einer Fensterachse ihrer Wand – sonst bleibt
 * das Feld blind (Leiter-Träger) und das Geschoss hat auf dieser Seite kein Fenster, die Geschosse darüber und darunter
 * aber schon. Ohne Achsen bzw. mit der Mitte auf einem Pfosten unverändert (Mitte der Wand).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { planBuilding, type ArchetypeContext } from '../src/index.js';
import { axesOf } from '../src/frame.js';
import { ladders } from '../src/stairs.js';

const FLOORS = [0, 1, 2, 3].map((index) => ({ index, height: 3 }));
const axes = axesOf({ x0: 0, z0: 0, x1: 8, z1: 8 });

describe('Leitern im Turm und Fensterachsen', () => {
  it('ohne Achsen: Mitte der Wand, abwechselnd an v = 0 und v = S − 1 (bitgleich zu vorher)', () => {
    const core = ladders(axes, FLOORS)!;
    expect(core.links.map((l) => l.origin)).toEqual([[4, 1], [4, 7], [4, 1]]);
  });

  it('Mitte auf einem Pfosten (zwei Felder, Achsen 2 und 6): Leiter bleibt in der Mitte', () => {
    const core = ladders(axes, FLOORS, () => [[2], [6]])!;
    expect(core.links.map((l) => l.origin)).toEqual([[4, 1], [4, 7], [4, 1]]);
  });

  it('Mitte auf der Achse (ein Feld, Wachturm): Leiter rückt zur nächsten Spalte ohne Achse und ohne Nachbarachse', () => {
    const core = ladders(axes, FLOORS, () => [[4]])!;
    expect(core.links.map((l) => l.origin)).toEqual([[2, 1], [2, 7], [2, 1]]);
    // Richtung unverändert: zur tragenden Wand
    expect(core.links.map((l) => l.facing)).toEqual(ladders(axes, FLOORS)!.links.map((l) => l.facing));
  });

  it('je Wand eigene Achsen: nur die Leiter an der Wand mit Achse in der Mitte rückt', () => {
    const core = ladders(axes, FLOORS, (_f, side) => (side === 'back' ? [[4]] : [[2], [6]]))!;
    expect(core.links.map((l) => l.origin)).toEqual([[2, 1], [4, 7], [2, 1]]);
  });
});

describe('Burg: Wechselstiege nicht am Ende mit dem Bergfried', () => {
  const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
  const traces: string[] = [];
  const arch: ArchetypeContext = { minArea: (id) => (ctx.catalog.roomTypeIds().includes(id) ? ctx.catalog.roomType(id).minArea : 4), trace: (m) => traces.push(m) };

  it('kein Versuch scheitert an „Treppe passt nicht“ (vorher bis 3 von 5 Versuchen: die Stiege lag am Ende mit dem Bergfried)', { timeout: HEAVY_TIMEOUT }, () => {
    const def = ctx.buildingTypes.get('castle_compact');
    for (const size of ['S', 'M', 'L'] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        traces.length = 0;
        const plan = planBuilding(def, { size }, seed, arch);
        expect(traces.filter((t) => /Treppe/.test(t)), `${size} ${seed}`).toEqual([]);
        expect(plan.warnings, `${size} ${seed}`).toEqual([]);
      }
    }
  });
});
