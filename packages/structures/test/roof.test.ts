import { describe, expect, it } from 'vitest';
import type { ShellCell } from '@mcda/blueprint';
import { N4 } from '../src/geometry.js';
import { buildTowerStructure, flatGround, floatingCells, footprintOffsets, inFootprint, roofProfile, towerRoof, type RoofShape, type RoofSpec, type TowerShape } from '../src/index.js';
import { dump, section } from './support.js';

/** Dach als Hüllzellen auf einer Wand (Rand des Grundrisses, dy = −3 … −1) über Gelände bei −4. */
function onWall(spec: RoofSpec): ShellCell[] {
  const cells: ShellCell[] = towerRoof(spec).map(({ dx, dy, dz, block }) => ({
    pos: [dx, dy, dz], kind: 'fort', role: block.role, shape: block.shape, ...(block.orient !== undefined ? { orient: block.orient } : {}), exterior: true,
  }));
  for (const [dx, dz] of footprintOffsets(spec.shape, spec.r)) {
    if (!N4.some(([ax, az]) => !inFootprint(spec.shape, spec.r, dx + ax, dz + az))) continue;
    for (const y of [-3, -2, -1]) cells.push({ pos: [dx, y, dz], kind: 'fort', role: 'wall_primary', shape: 'block', exterior: true });
  }
  return cells;
}
const ground = flatGround(-4);
const spec = (shape: TowerShape, r: number, roofShape: RoofShape, pitch = 2, flare = false): RoofSpec => ({ shape, r, roofShape, pitch, flare, finial: 'none' });
const COMBOS: readonly (readonly [TowerShape, RoofShape])[] = [
  ['round', 'cone'], ['round', 'spire'], ['round', 'bell'],
  ['square', 'tent'], ['square', 'helm'], ['square', 'spire'], ['square', 'bell'],
];

describe('Turmdächer: Profile (research/18 D3/D8/D9)', () => {
  it('linear, Glockenfuß und welsche Haube', () => {
    expect(roofProfile('cone', 2, false, 5).T).toEqual([0, 2, 4, 6, 8, 10]);
    // Glockenfuß: Überstand als Stufe, Ring über der Wand auf gleicher Höhe (halbe Stufe), dann Neigung
    const fl = roofProfile('tent', 2, true, 4);
    expect(fl.T).toEqual([0, 0, 2, 4, 6]);
    expect(fl.el).toEqual(['slab', 'stair', 'stair', 'stair', 'stair']);
    // Haube: Fuß (umgedrehte Treppe) · Bauch +2 +1 · Einschnürung (Stufe) +1 · Spitze +2 · First +1
    const bell = roofProfile('bell', 2, false, 5);
    expect(bell.T).toEqual([0, 2, 3, 4, 6, 7]);
    expect(bell.el).toEqual(['foot', 'stair', 'stair', 'slab', 'stair', 'stair']);
    expect(roofProfile('bell', 2, false, 4).T).toEqual([0, 2, 3, 5, 6]);
    // zu klein für die Haube → linear
    expect(roofProfile('bell', 2, false, 3).T).toEqual([0, 2, 4, 6]);
    // Helm kennt keinen Glockenfuß
    expect(roofProfile('helm', 1, true, 8).el[0]).toBe('stair');
  });

  it('Rhombenhelm: Manhattan-Pyramide, Giebel je Seite bis p·(r+1), Ecken auf Traufhöhe', () => {
    for (const pitch of [1, 2]) {
      const r = 3;
      const blocks = towerRoof(spec('square', r, 'helm', pitch));
      const top = new Map<string, number>();
      for (const b of blocks) top.set(`${b.dx},${b.dz}`, Math.max(top.get(`${b.dx},${b.dz}`) ?? -1, b.dy));
      for (const [dx, dz] of footprintOffsets('square', r + 1)) expect(top.get(`${dx},${dz}`)).toBe(pitch * (2 * (r + 1) - Math.abs(dx) - Math.abs(dz)));
      // Giebel über der Wandmitte: geschlossen von der Krone bis unter das Dach
      const gable = blocks.filter((b) => b.dx === r && b.dz === 0).map((b) => b.dy).sort((a, b) => a - b);
      expect(gable).toEqual(Array.from({ length: pitch * (r + 2) + 1 }, (_, i) => i));
    }
  });
});

describe('Turmdächer: jede Form auf jedem Radius (Ø 3 … 11)', () => {
  for (const [shape, roofShape] of COMBOS) {
    for (const flare of [false, true]) {
      it(`${shape} · ${roofShape}${flare ? ' · Glockenfuß' : ''}: nichts schwebt, Treppen zur Mitte, ein First, spaltenweise lückenlos`, () => {
        for (let r = 1; r <= 5; r++) {
          for (const pitch of [1, 2, 3]) {
            const s = spec(shape, r, roofShape, pitch, flare);
            const blocks = towerRoof(s);
            const where = `r=${r} p=${pitch}`;
            expect(floatingCells(onWall(s), ground), where).toEqual([]);
            // keine doppelten Positionen, nichts unter der Traufe
            expect(new Set(blocks.map((b) => `${b.dx},${b.dy},${b.dz}`)).size, where).toBe(blocks.length);
            expect(blocks.every((b) => b.dy >= 0), where).toBe(true);
            // Treppen (auch der umgedrehte Fuß) zeigen mit der hohen Seite nicht von der Mitte weg
            for (const b of blocks.filter((b) => b.block.shape === 'stairs' && b.block.role === 'roof_main')) {
              const f = b.block.orient!.facing!;
              const [fx, fz] = f === 'east' ? [1, 0] : f === 'west' ? [-1, 0] : f === 'south' ? [0, 1] : [0, -1];
              expect(fx * -b.dx + fz * -b.dz, `${where} ${b.dx},${b.dy},${b.dz}`).toBeGreaterThanOrEqual(0);
            }
            // genau ein höchster Dachblock, über der Mitte
            const roof = blocks.filter((b) => b.block.role === 'roof_main');
            const peak = Math.max(...roof.map((b) => b.dy));
            expect(roof.filter((b) => b.dy === peak).map((b) => [b.dx, b.dz]), where).toEqual([[0, 0]]);
            // je Spalte lückenlos (Füllung bis zum Bauteil)
            const cols = new Map<string, number[]>();
            for (const b of roof) cols.set(`${b.dx},${b.dz}`, [...(cols.get(`${b.dx},${b.dz}`) ?? []), b.dy]);
            for (const [k, ys] of cols) expect(Math.max(...ys) - Math.min(...ys) + 1, `${where} ${k}`).toBe(ys.length);
            // 4-fach drehsymmetrisch (Lage und Form)
            const shapes = new Map(blocks.map((b) => [`${b.dx},${b.dy},${b.dz}`, b.block.shape]));
            for (const b of blocks) expect(shapes.get(`${-b.dz},${b.dy},${b.dx}`), `${where} ${b.dx},${b.dz}`).toBe(b.block.shape);
          }
        }
      });
    }
  }

  it('Turmspitzen: Stange, Zaun + Laterne, Zaun-Stange, keine', () => {
    const tip = (finial: RoofSpec['finial']): string[] => {
      const b = towerRoof({ ...spec('round', 4, 'cone'), finial });
      const peak = Math.max(...b.filter((x) => x.block.role === 'roof_main').map((x) => x.dy));
      return b.filter((x) => x.dx === 0 && x.dz === 0 && x.dy > peak).sort((p, q) => p.dy - q.dy).map((x) => `${x.block.role}.${x.block.shape}`);
    };
    expect(tip('pole')).toEqual(['beam.log', 'beam.log']);
    expect(tip('lantern')).toEqual(['beam.fence', 'light_outdoor.lantern']);
    expect(tip('spike')).toEqual(['beam.fence', 'beam.fence']);
    expect(tip('none')).toEqual([]);
  });

  it('Spitzhelm (eckig): 4 Eckfialen aus Mauerblock und Zaun auf den Ecken des Überstands', () => {
    const b = towerRoof(spec('square', 3, 'spire', 3));
    for (const [x, z] of [[4, 4], [-4, 4], [-4, -4], [4, -4]]) {
      expect(b.filter((q) => q.dx === x && q.dz === z).map((q) => `${q.dy}:${q.block.role}.${q.block.shape}`)).toEqual(['0:parapet.block', '1:beam.fence']);
    }
  });
});

describe('Turmdächer: Querschnitte (ASCII, Notation research/18 §1.2)', () => {
  const cut = (s: RoofSpec, h: number): string => section(onWall(s), 'x', 0, -s.r - 1, s.r + 1, -1, h);

  it('Zelt p = 2 und Rhombenhelm p = 1 (eckig, r = 3), Schnitt durch die Mitte', () => {
    expect(cut(spec('square', 3, 'tent'), 8)).toBe([
      '....#....',
      '....#....',
      '.../#\\...',
      '...#.#...',
      '../#.#\\..',
      '..#...#..',
      './#...#\\.',
      '.#.....#.',
      '/#.....#\\',
      '.#.....#.',
    ].join('\n'));
    // Helm: die Wand wird zum Giebel (Füllung bis unter das Dach), der Überstand darüber zum Ortgang
    expect(cut(spec('square', 3, 'helm', 1), 8)).toBe([
      '....#....',
      '.../#\\...',
      '../#.#\\..',
      './#...#\\.',
      '/#.....#\\',
      '##.....##',
      '.#.....#.',
      '.#.....#.',
      '.#.....#.',
      '.#.....#.',
    ].join('\n'));
  });

  it('Kegel mit Glockenfuß und welsche Haube (rund, r = 4)', () => {
    // Glockenfuß: Überstand als Stufe, Ring über der Wand eine halbe Stufe höher, dann p = 2
    expect(cut(spec('round', 4, 'cone', 2, true), 8)).toBe([
      '.....#.....',
      '.....#.....',
      '..../#\\....',
      '....#.#....',
      '.../#.#\\...',
      '...#...#...',
      '../#...#\\..',
      '..#.....#..',
      '_/#.....#\\_',
      '.#.......#.',
    ].join('\n'));
    // Haube: Fuß v (Auswölbung) · Bauch steil → flacher · Einschnürung _ · Spitze steil · First
    expect(cut(spec('round', 4, 'bell'), 7)).toBe([
      '.....#.....',
      '..../#\\....',
      '....#.#....',
      '..._#.#_...',
      '../#...#\\..',
      './#.....#\\.',
      '.#.......#.',
      'v#.......#v',
      '.#.......#.',
    ].join('\n'));
  });
});

describe('Turmdächer am Turm: Auflösung und Rundung', () => {
  it('Dachform passend zum Grundriss, sonst Hinweis und natürliche Form', () => {
    const helmRound = buildTowerStructure({ center: [0, 0], shape: 'round', roofShape: 'helm' });
    expect(helmRound.warnings.join()).toMatch(/Dachform helm passt nicht zu rundem Turm → cone/);
    expect(dump(helmRound)).toBe(dump(buildTowerStructure({ center: [0, 0], shape: 'round', roofShape: 'cone' })));
    expect(buildTowerStructure({ center: [0, 0], shape: 'square', top: 'roof', roofShape: 'cone' }).warnings.join()).toMatch(/→ tent/);
    expect(buildTowerStructure({ center: [0, 0], shape: 'round', roofShape: 'tent' }).warnings.join()).toMatch(/→ cone/);
    // ohne neue Optionen: bitgleich zur ausdrücklich natürlichen Form (Kegel p = 2, kein Glockenfuß)
    expect(dump(buildTowerStructure({ center: [0, 0], shape: 'round' }, { seed: 3 })))
      .toBe(dump(buildTowerStructure({ center: [0, 0], shape: 'round', roofShape: 'cone', roofPitch: 2, flare: false }, { seed: 3 })));
  });

  it('gerade und zu kleine Durchmesser 3 … 11 werden korrigiert; jede Dachform steht', () => {
    for (let size = 3; size <= 11; size++) {
      for (const [shape, roofShape] of COMBOS) {
        const res = buildTowerStructure({ center: [0, 0], shape, size, top: 'roof', roofShape, finial: 'lantern', levels: 2 });
        const t = res.towers[0]!;
        expect(t.size % 2, `${shape} ${size}`).toBe(1);
        expect(t.size).toBeGreaterThanOrEqual(Math.max(size, shape === 'round' ? 9 : 7));
        expect(floatingCells(res.cells, flatGround()), `${shape} ${roofShape} ${size}`).toEqual([]);
        expect(res.warnings.every((w) => /Turmgröße/.test(w)), res.warnings.join()).toBe(true);
      }
    }
  });
});
