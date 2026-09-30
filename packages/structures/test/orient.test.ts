import { describe, expect, it } from 'vitest';
import type { ShellCell } from '@mcda/blueprint';
import type { Vec3 } from '@mcda/core';
import { buildStructures, buildTowerStructure, flatGround, floatingCells, type RoofShape, type TowerShape, type TowerTop } from '../src/index.js';
import { cellMap, key, reachShare, section } from './support.js';

/**
 * O1 – senkrechte und hängende Ausrichtung an Bauwerken: Turmspitze Blitzableiter/Endstab (`vertical: 'up'`),
 * hängende Glocke im Glockenstuhl (`attach: 'ceiling'`), hängende Laternen unter der Traufe (`hanging: true`).
 * Die Stützregeln selbst prüft die Materialisierung (pipeline.test.ts); hier Geometrie und Vertrag der Zellen.
 */
const ground = flatGround();
const OUTSIDE: Vec3 = [-14, 0, -14];

const above = (m: Map<string, ShellCell>, [x, y, z]: Vec3, n = 1): ShellCell | undefined => m.get(key(x, y + n, z));

/** Unterseite trägt Laterne/Kette/Glocke (wie `carriesBelow` im Erzeuger, hier unabhängig formuliert). */
const carries = (c: ShellCell | undefined): boolean => c !== undefined && (
  c.shape === 'stairs' || c.shape === 'slab' ? c.orient?.half === 'bottom' : ['block', 'log', 'fence', 'chain'].includes(c.shape));

describe('O1 Turmspitze: Zaun + Blitzableiter bzw. Endstab, Spitze nach oben', () => {
  const roofs: readonly (readonly [TowerShape, RoofShape])[] = [['round', 'cone'], ['round', 'bell'], ['square', 'tent'], ['square', 'helm'], ['square', 'spire']];
  for (const [shape, roofShape] of roofs) {
    for (const finial of ['rod', 'end_rod'] as const) {
      it(`${shape} · ${roofShape} · ${finial}`, () => {
        const res = buildTowerStructure({ center: [0, 0], shape, top: 'roof', roofShape, finial, levels: 2 });
        expect(res.warnings).toEqual([]);
        expect(floatingCells(res.cells, ground)).toEqual([]);
        const tips = res.cells.filter((c) => c.role === 'finial');
        expect(tips).toHaveLength(1);
        const tip = tips[0]!;
        expect(tip).toMatchObject({ shape: finial === 'rod' ? 'lightning_rod' : 'end_rod', orient: { vertical: 'up' }, kind: 'fort' });
        // höchste Zelle, Mitte des Turms, auf Zaun über dem Firstblock
        expect(tip.pos[1]).toBe(Math.max(...res.cells.map((c) => c.pos[1])));
        expect([tip.pos[0], tip.pos[2]]).toEqual([0, 0]);
        const m = cellMap(res.cells);
        expect(above(m, tip.pos, -1)).toMatchObject({ role: 'beam', shape: 'fence' });
        expect(above(m, tip.pos, -2)).toMatchObject({ role: 'roof_main', shape: 'block' });
      });
    }
  }

  it('ohne Wahl bleibt die Seed-Spitze (Stange/keine), nie ein Stab', () => {
    for (const seed of [1, 2, 3, 4]) expect(buildStructures({ towers: [{ center: [0, 0] }] }, { seed }).cells.some((c) => c.role === 'finial')).toBe(false);
  });
});

describe('O1 Glockenstube: Glocke hängt am Glockenbalken (attachment ceiling)', () => {
  for (const shape of ['round', 'square'] as const) {
    for (const door of ['south', 'east'] as const) {
      it(`${shape} · Tür ${door}: Balken quer zur Tür auf der Wandkrone, Kette, Glocke auf halber Öffnungshöhe`, () => {
        const res = buildTowerStructure({ center: [0, 0], shape, top: 'belfry', bell: 'hanging', door, levels: 2 });
        const t = res.towers[0]!;
        const r = (t.size - 1) / 2;
        expect(res.warnings).toEqual([]);
        expect(floatingCells(res.cells, ground)).toEqual([]);
        expect(reachShare(res, ground, [OUTSIDE], t.topStands)).toBe(1);
        expect(t.bell).toEqual([0, t.topY + 2, 0]);
        const m = cellMap(res.cells);
        expect(m.get(key(...t.bell!))).toMatchObject({ role: 'bell', shape: 'bell', orient: { facing: t.door!.facing, attach: 'ceiling' } });
        expect(above(m, t.bell!)).toMatchObject({ role: 'light_hanging', shape: 'chain', orient: { axis: 'y' } });
        // Balken quer zur Tür: Stamm von −(r−1) bis r−1, an beiden Enden die Wandkrone (Sturz der Schallöffnungen)
        const axis = t.door!.facing === 'south' || t.door!.facing === 'north' ? 'x' : 'z';
        const beamAt = (s: number): Vec3 => (axis === 'x' ? [s, t.topY + 4, 0] : [0, t.topY + 4, s]);
        for (let s = 1 - r; s <= r - 1; s++) expect(m.get(key(...beamAt(s))), String(s)).toMatchObject({ role: 'beam', shape: 'log', orient: { axis } });
        for (const s of [-r, r]) expect(m.get(key(...beamAt(s)))?.role, String(s)).toBe('wall_primary');
        // unter der Glocke Luft bis zum Stubenboden
        expect(m.get(key(0, t.topY + 1, 0))).toBeUndefined();
        expect(m.get(key(0, t.topY, 0))?.role).toBe('tower_floor');
      });
    }
  }

  it('Schnitt (eckig 7, Helm): Balken unter der Krone, Kette, Glocke zwischen den Schallöffnungen', () => {
    const res = buildTowerStructure({ center: [0, 0], shape: 'square', size: 7, top: 'belfry', roofShape: 'helm', bell: 'hanging', levels: 2, finial: 'none' });
    const t = res.towers[0]!;
    // topY+5 Helm über der Wand, topY+4 Krone + Balken, topY+3/+2 Schallöffnung mit Kette und Glocke, Zaun, Boden (Luke)
    expect(section(res.cells, 'x', 0, -4, 4, t.topY, t.topY + 5)).toBe([
      '.#.....#.',
      '.#-----#.',
      '....:....',
      '....B....',
      '.f.....f.',
      '.##.####.',
    ].join('\n'));
  });
});

describe('O1 hängende Laternen unter der Traufe (Kette + Laterne an den Ecken bzw. Diagonalen)', () => {
  const cases: readonly (readonly [TowerShape, TowerTop, RoofShape | undefined])[] = [
    ['square', 'roof', undefined], ['round', 'roof', undefined], ['square', 'lookout', 'tent'], ['round', 'lookout', undefined],
    ['square', 'belfry', 'helm'], ['round', 'belfry', undefined], ['square', 'roof', 'spire'],
  ];
  for (const [shape, top, roofShape] of cases) {
    it(`${shape} · ${top}${roofShape !== undefined ? ` · ${roofShape}` : ''}: 4 Laternen, gestützt, drehsymmetrisch`, () => {
      const spec = { center: [0, 0] as const, shape, top, levels: 2, ...(roofShape !== undefined ? { roofShape } : {}) };
      const res = buildTowerStructure({ ...spec, center: [0, 0], hangingLanterns: true });
      const t = res.towers[0]!;
      expect(res.warnings).toEqual([]);
      expect(floatingCells(res.cells, ground)).toEqual([]);
      expect(reachShare(res, ground, [OUTSIDE], t.topStands)).toBe(1);
      const m = cellMap(res.cells);
      const lanterns = res.cells.filter((c) => c.shape === 'lantern');
      expect(lanterns).toHaveLength(4);
      for (const l of lanterns) {
        expect(l).toMatchObject({ role: 'light_hanging', orient: { hanging: true } });
        expect(above(m, l.pos)).toMatchObject({ role: 'light_hanging', shape: 'chain', orient: { axis: 'y' } });
        expect(carries(above(m, l.pos, 2)), JSON.stringify(above(m, l.pos, 2))).toBe(true);
        expect(m.get(key(l.pos[0], l.pos[1] - 1, l.pos[2]))).toBeUndefined();
      }
      // drehsymmetrisch um die Turmmitte (90°: (x, z) → (−z, x))
      const set = new Set(lanterns.map((l) => `${l.pos[0]},${l.pos[2]}`));
      for (const l of lanterns) expect(set.has(`${-l.pos[2]},${l.pos[0]}`), l.pos.join(',')).toBe(true);
      // ohne Option: bitgleich die übrigen Zellen
      const plain = buildTowerStructure(spec);
      const extra = new Set(res.cells.filter((c) => c.role === 'light_hanging').map((c) => key(...c.pos)));
      expect(res.cells.filter((c) => !extra.has(key(...c.pos)))).toEqual(plain.cells);
    });
  }

  it('welsche Haube: Fuß ist eine umgedrehte Treppe (Mitte halb frei) → keine Laternen, Hinweis', () => {
    const res = buildTowerStructure({ center: [0, 0], shape: 'round', top: 'lookout', roofShape: 'bell', hangingLanterns: true, levels: 2 });
    expect(res.cells.some((c) => c.role === 'light_hanging')).toBe(false);
    expect(res.warnings).toEqual([expect.stringMatching(/keine hängenden Laternen/)]);
  });

  it('Mauertürme übernehmen Glocke, Laternen und Spitze aus dem Turmstil', () => {
    const res = buildStructures({
      walls: [{
        points: [[-8, -8], [30, -8], [30, 19], [-8, 19]], closed: true, towerSpacing: 0, gates: [{ at: [11, 19] }],
        towerStyle: { shape: 'square', top: 'belfry', roofShape: 'helm', bell: 'hanging', hangingLanterns: true, finial: 'rod' },
      }],
    }, { seed: 3 });
    expect(res.warnings).toEqual([]);
    expect(res.towers).toHaveLength(4);
    const m = cellMap(res.cells);
    for (const t of res.towers) {
      expect(m.get(key(...t.bell!))?.orient?.attach).toBe('ceiling');
      expect(t.bell![1]).toBe(t.topY + 2);
    }
    expect(res.cells.filter((c) => c.role === 'finial')).toHaveLength(4);
    // Laternen nur, wo die Traufecke frei ist (am Mauerturm könnten Wehrgang/Mauer eine Ecke belegen); hier alle frei
    expect(res.cells.filter((c) => c.shape === 'lantern')).toHaveLength(16);
  });
});
