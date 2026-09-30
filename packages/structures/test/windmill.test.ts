import { describe, expect, it } from 'vitest';
import type { ShellCell } from '@mcda/blueprint';
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { buildStructures, buildWindmill, flatGround, floatingCells, inFootprint, type HeightField, type StructuresResult } from '../src/index.js';
import { dump, reachShare, section } from './support.js';

const ground = flatGround();
const DIR: Record<HorizontalDir, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Zellen der Flügelebene in Ebenen-Koordinaten (u quer = facing im Uhrzeigersinn, v hoch ab Nabe). */
function plane(res: StructuresResult, facing: HorizontalDir): { u: number; v: number; c: ShellCell }[] {
  const t = res.towers[0]!;
  const [fx, fz] = DIR[facing];
  const [lx, lz] = [-fz, fx];
  const d = (t.size - 1) / 2 + 2;
  return res.cells
    .filter((c) => (c.pos[0] - t.center[0]) * fx + (c.pos[2] - t.center[1]) * fz === d)
    .map((c) => ({ u: (c.pos[0] - t.center[0]) * lx + (c.pos[2] - t.center[1]) * lz, v: c.pos[1] - t.hub![1], c }));
}

describe('Windmühle (research/18 T6)', () => {
  for (const facing of ['south', 'north', 'east', 'west'] as const) {
    it(`Flügel nach ${facing}: „+“-Stellung ohne Diagonalen, symmetrisch ohne Drehsinn, nichts schwebt, Tür gegenüber`, () => {
      const res = buildWindmill({ center: [3, -2], facing });
      const t = res.towers[0]!;
      const r = (t.size - 1) / 2;
      const [fx, fz] = DIR[facing];
      expect(res.warnings).toEqual([]);
      expect(floatingCells(res.cells, ground)).toEqual([]);
      expect(t.hub).toEqual([3 + fx * (r + 2), t.topY + 2, -2 + fz * (r + 2)]);
      expect(t.door?.facing).toBe(({ north: 'south', south: 'north', east: 'west', west: 'east' } as const)[facing]);
      const cells = plane(res, facing);
      const spars = cells.filter((p) => p.c.role === 'beam' && p.c.shape === 'log');
      const sails = cells.filter((p) => p.c.role === 'sail');
      // Ruten: nur auf den Achsen durch die Nabe, je 7 lang, Achse entlang des Flügels (senkrecht y, quer x/z)
      expect(spars.every((p) => p.u === 0 || p.v === 0)).toBe(true);
      expect(spars).toHaveLength(4 * 7 + 1);
      const across = fx !== 0 ? 'z' : 'x';
      for (const p of spars) {
        const axis = p.c.orient?.axis;
        if (p.u === 0 && p.v === 0) expect(axis).toBe(fx !== 0 ? 'x' : 'z'); // Nabe: Achse zur Front
        else expect(axis).toBe(p.u === 0 ? 'y' : across);
      }
      // Bespannung: 4 × 6 × 2 (je 1 beidseits der Rute), jede Zelle neben einer Rute oder einer anderen Bespannung
      expect(sails).toHaveLength(4 * 6 * 2);
      const at = new Set(cells.map((p) => `${p.u},${p.v}`));
      const sailSet = new Set(sails.map((p) => `${p.u},${p.v}`));
      for (const p of sails) expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => at.has(`${p.u + a!},${p.v + b!}`))).toBe(true);
      // um 90° gedreht deckt sich die Bespannung mit sich selbst – UND sie ist an der senkrechten und waagerechten Achse
      // gespiegelt: keine Figur mit Drehsinn (einseitig bespannte „+“-Flügel sähen von vorn hakenkreuzähnlich aus)
      for (const p of sails) {
        expect(sailSet.has(`${-p.v},${p.u}`), `${p.u},${p.v}`).toBe(true);
        expect(sailSet.has(`${-p.u},${p.v}`), `Spiegel u: ${p.u},${p.v}`).toBe(true);
        expect(sailSet.has(`${p.u},${-p.v}`), `Spiegel v: ${p.u},${p.v}`).toBe(true);
      }
      // Flügel außerhalb des Dachs (Radius r + 1) und ≥ 2 Blöcke über dem Gelände
      for (const p of cells) {
        const [x, y, z] = p.c.pos;
        expect(inFootprint('round', r + 1, x - 3, z + 2)).toBe(false);
        expect(y).toBeGreaterThanOrEqual(ground.groundY(x, z) + 3);
      }
      // oben erreichbar, Spalten der Ebene in der Grundfläche
      expect(reachShare(res, ground, [[-20, 0, -20]], t.topStands)).toBe(1);
      const fp = new Set(res.footprint.map(([x, z]) => `${x},${z}`));
      for (const p of cells) expect(fp.has(`${p.c.pos[0]},${p.c.pos[2]}`)).toBe(true);
      expect(dump(res)).toBe(dump(buildWindmill({ center: [3, -2], facing })));
    });
  }

  it('Frontansicht (Flügel nach Norden, L = 4, W = 1) wie im Kopf von windmill.ts', () => {
    const res = buildWindmill({ center: [0, 0], facing: 'north', sailLength: 4, sailWidth: 1, levels: 2 });
    const hub = res.towers[0]!.hub!;
    expect(hub).toEqual([0, 10, -6]);
    expect(section(res.cells, 'x', hub[2], -5, 5, hub[1] - 5, hub[1] + 5)).toBe([
      '...........',
      '....s|s....',
      '....s|s....',
      '....s|s....',
      '.sss.|.sss.',
      '.---------.',
      '.sss.|.sss.',
      '....s|s....',
      '....s|s....',
      '....s|s....',
      '...........',
    ].join('\n'));
    // Seitenansicht: Anker in der Wand (statt Scharte), Achse, Nabe; Kappe mit Stange
    const m = new Map(res.cells.map((c) => [c.pos.join(','), c]));
    expect(m.get('0,10,-4')?.role).toBe('wall_primary');
    expect(m.get('0,10,-5')?.orient?.axis).toBe('z');
    const peak = Math.max(...res.cells.filter((c) => c.role === 'roof_main').map((c) => c.pos[1]));
    expect([1, 2].map((d) => m.get(`0,${peak + d},0`)?.shape)).toEqual(['log', 'log']);
  });

  it('Gelände vor der Mühle: Flügel werden gekürzt (Hinweis), zu hoch → keine Flügel', () => {
    const hill = (h: number): HeightField => ({ groundY: (x, z) => (z > 5 ? h : -1) });
    const cut = buildWindmill({ center: [0, 0], facing: 'south', levels: 3 }, { ground: hill(5) });
    expect(cut.warnings.join()).toMatch(/Flügel auf 6 gekürzt/);
    expect(floatingCells(cut.cells, hill(5))).toEqual([]);
    for (const p of plane(cut, 'south')) expect(p.c.pos[1]).toBeGreaterThanOrEqual(5 + 3);
    const none = buildWindmill({ center: [0, 0], facing: 'south', levels: 3 }, { ground: hill(12) });
    expect(none.warnings.join()).toMatch(/kein Platz für die Flügel/);
    expect(none.cells.some((c) => c.role === 'sail')).toBe(false);
    expect(none.towers[0]!.hub).toBeUndefined();
  });

  it('weicht anderen Bauwerken aus (Flügel kürzer statt Überschneidung)', () => {
    // Nachbarturm rechts neben der Flügelebene (z = 6): Zinnenkranz auf Höhe der Nabe
    const tower = { center: [10, 6] as [number, number], shape: 'square' as const, levels: 3, top: 'battlements' as const };
    const res = buildStructures({ towers: [tower], windmills: [{ center: [0, 0], facing: 'south' }] });
    expect(res.warnings.join()).toMatch(/Flügel auf \d gekürzt/);
    expect(floatingCells(res.cells, ground)).toEqual([]);
    // der Turm bleibt vollständig (keine Zelle überschrieben)
    const alone = buildStructures({ towers: [tower] }).cells.length;
    expect(res.cells.filter((c) => c.roomId === 'fort:t0')).toHaveLength(alone);
  });

  it('Rundung: Ø 3 … 11 rund und eckig werden korrigiert, stehen und haben Flügel', () => {
    for (const shape of ['round', 'square'] as const) {
      for (let size = 3; size <= 11; size++) {
        const res = buildWindmill({ center: [0, 0], shape, size, sailWidth: 3, sailLength: 9 });
        expect(floatingCells(res.cells, ground), `${shape} ${size}`).toEqual([]);
        expect(res.warnings.every((w) => /Turmgröße/.test(w)), res.warnings.join()).toBe(true);
        // W = 3 → je Seite 2, Bespannung ab k = 3: 4 Flügel × 7 Reihen × 4
        expect(res.cells.filter((c) => c.role === 'sail')).toHaveLength(4 * 7 * 4);
      }
    }
  });

  it('Kappe und Spitze sind wählbar (welsche Haube, Laterne)', () => {
    const res = buildWindmill({ center: [0, 0], roofShape: 'bell', finial: 'lantern', facing: 'east' });
    expect(res.warnings).toEqual([]);
    expect(floatingCells(res.cells, ground)).toEqual([]);
    expect(res.cells.some((c) => c.shape === 'lantern')).toBe(true);
    expect(res.cells.some((c) => c.role === 'roof_main' && c.orient?.half === 'top')).toBe(true); // Fuß der Haube
    const hubs: Vec3[] = res.towers.map((t) => t.hub!);
    expect(hubs[0]![0]).toBe(6);
  });
});
