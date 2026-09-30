/**
 * W4-B „Bergfried und Zugang“ (plan/spikes/W4B_bergfried.md): Luke der Wehrplatte bzw. des Ausgucks über der Leiter der
 * Hülle (`ParapetSpec.hatch`) und „Bergfried führt“ – Dächer der Mauertürme bleiben samt Spitze unter der höchsten
 * Zinne einer Wehrplatte. Ohne Luke bzw. ohne Wehrplatte bitgleich.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStructures, flatGround, floatingCells, ringAround, type ParapetSpec, type RingSpec, type TowerStyle,
} from '../src/index.js';
import { cellMap, key } from './support.js';

const square = (n: number): ParapetSpec['cells'] => {
  const out: [number, number][] = [];
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) out.push([x, z]);
  return out;
};

describe('Luke über der Leiter der Hülle', () => {
  it('mit Belag: Falltür in der oberen Hälfte bündig im Belag, `facing` der Leiter, sonst wie ohne Luke', () => {
    const plain = buildStructures({ parapets: [{ cells: square(9), y: 20, deck: true }] });
    const res = buildStructures({ parapets: [{ cells: square(9), y: 20, deck: true, hatch: { cell: [1, 4], facing: 'east' } }] });
    expect(res.warnings).toEqual([]);
    const hatch = cellMap(res.cells).get(key(1, 21, 4));
    expect(hatch).toMatchObject({ role: 'beam', shape: 'trapdoor', orient: { facing: 'east', half: 'top' } });
    expect(res.cells.filter((c) => !(c.pos[0] === 1 && c.pos[1] === 21 && c.pos[2] === 4))).toEqual(plain.cells.filter((c) => !(c.pos[0] === 1 && c.pos[1] === 21 && c.pos[2] === 4)));
  });

  it('ohne Belag: Falltür in der unteren Hälfte auf der Dachplatte', () => {
    const res = buildStructures({ parapets: [{ cells: square(9), y: 20, hatch: { cell: [4, 1], facing: 'south' } }] });
    expect(cellMap(res.cells).get(key(4, 21, 1))).toMatchObject({ shape: 'trapdoor', orient: { facing: 'south', half: 'bottom' } });
  });

  it('Luke auf dem Rand (Brüstung) oder außerhalb: keine Falltür, ein Hinweis', () => {
    const res = buildStructures({ parapets: [{ cells: square(9), y: 20, deck: true, hatch: { cell: [0, 4], facing: 'east' } }] });
    expect(res.warnings.join()).toMatch(/Luke 0,4 liegt nicht im Inneren/);
    expect(res.cells.some((c) => c.shape === 'trapdoor')).toBe(false);
  });

  it('Ausguck: Falltür im Belag, Pfosten, Brüstung und Dach unverändert', () => {
    const plain = buildStructures({ parapets: [{ cells: square(9), y: 20, deck: true, crown: 'lookout' }] });
    const res = buildStructures({ parapets: [{ cells: square(9), y: 20, deck: true, crown: 'lookout', hatch: { cell: [1, 1], facing: 'south' } }] });
    expect(res.warnings).toEqual([]);
    expect(cellMap(res.cells).get(key(1, 21, 1))).toMatchObject({ shape: 'trapdoor', orient: { facing: 'south', half: 'top' } });
    expect(res.cells.filter((c) => c.pos[1] > 21)).toEqual(plain.cells.filter((c) => c.pos[1] > 21));
  });
});

describe('Bergfried führt: Mauertürme unter der höchsten Zinne', () => {
  const ground = flatGround();
  const style: TowerStyle = { shape: 'round', top: 'battlements', corner: { top: 'roof', roofShape: 'cone', roofPitch: 2, flare: true, finial: 'pole' } };
  const spec: RingSpec = {
    core: { minX: 0, minZ: 0, maxX: 26, maxZ: 12 }, door: { cell: [8, 13], out: 'south' }, offset: 6, height: 7, towerSpacing: 44, towerStyle: style,
    merlon: { width: 2, gap: 1 }, gate: { width: 3, height: 5, gatehouse: true },
  };
  const walls = ringAround(spec).walls;
  // Wehrplatte abseits des Rings (in der Kernfläche); ihre Zinnen liegen bei y + 2
  const parapet = (y: number): ParapetSpec => ({ cells: square(9).map(([x, z]) => [x + 9, z + 2] as [number, number]), y });
  const towerTop = (res: ReturnType<typeof buildStructures>): number => Math.max(...res.cells.filter((c) => /\.t\d+$/.test(c.roomId ?? '')).map((c) => c.pos[1]));
  const free = buildStructures({ walls }, { ground, seed: 7 });
  const top = towerTop(free);

  it('Krone hoch genug: bitgleich zum Ring ohne Wehrplatte', () => {
    const res = buildStructures({ walls, parapets: [parapet(top + 5)] }, { ground, seed: 7 });
    expect(res.cells.filter((c) => /\.t\d+$/.test(c.roomId ?? ''))).toEqual(free.cells.filter((c) => /\.t\d+$/.test(c.roomId ?? '')));
  });

  it('Spitze reicht an die Krone: die Stange entfällt, der Helm bleibt gleich', () => {
    const res = buildStructures({ walls, parapets: [parapet(top - 2)] }, { ground, seed: 7 });
    expect(towerTop(res)).toBeLessThanOrEqual(top - 1);
    const roofOf = (r: typeof res): string[] => r.cells.filter((c) => c.role === 'roof_main').map((c) => `${key(...c.pos)}|${c.shape}`).sort();
    expect(roofOf(res)).toEqual(roofOf(free));
    expect(res.cells.filter((c) => c.shape === 'log' && c.pos[1] > top - 2)).toEqual([]);
    expect(floatingCells(res.cells.filter((c) => c.roomId !== 'fort:p0'), ground)).toEqual([]); // die Wehrplatte schwebt hier (ohne Turm)
  });

  it('Krone tiefer als der Helm: flacher, ohne Spitze, immer unter der Krone; Ecktürme behalten ein Dach', () => {
    const res = buildStructures({ walls, parapets: [parapet(top - 6)] }, { ground, seed: 7 });
    expect(towerTop(res)).toBeLessThanOrEqual(top - 5);
    expect(res.towers.filter((t) => t.top === 'roof')).toHaveLength(4);
    expect(res.cells.some((c) => c.role === 'roof_main')).toBe(true);
    expect(floatingCells(res.cells.filter((c) => c.roomId !== 'fort:p0'), ground)).toEqual([]); // die Wehrplatte schwebt hier (ohne Turm)
  });

  it('Ausguck-Wehrplatten begrenzen nichts (kein Zinnenkranz)', () => {
    const res = buildStructures({ walls, parapets: [{ ...parapet(top - 6), deck: true, crown: 'lookout' }] }, { ground, seed: 7 });
    expect(towerTop(res)).toBe(top);
  });
});
