import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@mcda/core';
import { buildTowerStructure, buildWallStructure, flatGround, floatingCells, footprintOffsets, inFootprint, type HeightField, type TowerShape, type TowerTop } from '../src/index.js';
import { cellMap, dump, glyph, key, reachShare, section } from './support.js';

const ground = flatGround();
const OUTSIDE: Vec3 = [-14, 0, -14];

/** Draufsicht einer Ebene (z nach unten) in der Glyphen-Notation. */
function topView(res: { cells: Parameters<typeof cellMap>[0] }, y: number, r: number): string {
  const m = cellMap(res.cells);
  const rows: string[] = [];
  for (let z = -r; z <= r; z++) {
    let s = '';
    for (let x = -r; x <= r; x++) s += glyph(m.get(key(x, y, z)));
    rows.push(s);
  }
  return rows.join('\n');
}

describe('Turmabschlüsse (research/18 T4/T5): Aussichtsstube, Glockenstube, Plattform', () => {
  for (const top of ['lookout', 'belfry', 'platform'] as const satisfies readonly TowerTop[]) {
    for (const shape of ['round', 'square'] as const satisfies readonly TowerShape[]) {
      it(`${shape} · ${top}: steht, Tür, alle Standplätze oben von draußen erreichbar`, () => {
        const res = buildTowerStructure({ center: [0, 0], shape, top, levels: 3 });
        const t = res.towers[0]!;
        expect(res.warnings).toEqual([]);
        expect(floatingCells(res.cells, ground)).toEqual([]);
        expect(t.top).toBe(top);
        expect(t.door).toBeDefined();
        expect(t.topStands.length).toBeGreaterThan(10);
        expect(reachShare(res, ground, [OUTSIDE], t.topStands)).toBe(1);
        expect(dump(res)).toBe(dump(buildTowerStructure({ center: [0, 0], shape, top, levels: 3 })));
      });
    }
  }

  it('Aussichtsstube: Boden kragt 1 aus auf Kopfbändern, Pfosten an Achsen und Ecken, Zaun-Brüstung, 2 Reihen offen', () => {
    const res = buildTowerStructure({ center: [0, 0], shape: 'square', size: 7, top: 'lookout', levels: 2, finial: 'none' });
    const t = res.towers[0]!;
    expect(t.topY).toBe(8);
    // Schnitt z = 0 (topY+12 … topY−2): Zeltdach mit Glockenfuß über Radius r+2, Pfosten, Boden, Kopfbänder v
    expect(section(res.cells, 'x', 0, -6, 6, t.topY - 2, t.topY + 12)).toBe([
      '......#......',
      '......#......',
      '...../#\\.....',
      '.....#.#.....',
      '..../#.#\\....',
      '....#...#....',
      '.../#...#\\...',
      '...#.....#...',
      '._/#.....#\\_.',
      '..|.......|..',
      '..|.......|..',
      '..|.......|..',
      '..###.#####..',
      '..v#.^|..#v..',
      '...g..|..g...',
    ].join('\n'));
    // Draufsicht topY+1: Pfosten | an Ecken und Seitenmitten, dazwischen Zaun f
    expect(topView(res, t.topY + 1, 5)).toBe([
      '...........',
      '.|fff|fff|.',
      '.f.......f.',
      '.f.......f.',
      '.f.......f.',
      '.|.......|.',
      '.f.......f.',
      '.f.......f.',
      '.f.......f.',
      '.|fff|fff|.',
      '...........',
    ].join('\n'));
    // Die Stube ist größer als der Schaft: Standplätze auch auf dem auskragenden Ring (innerhalb der Brüstung)
    expect(t.topStands.some(([x, , z]) => Math.max(Math.abs(x), Math.abs(z)) === 3)).toBe(true);
    expect(t.topStands.every(([x, y, z]) => y === t.topY + 1 && inFootprint('square', 4, x, z))).toBe(true);
  });

  it('Glockenstube: Schallöffnungen mit Zaun-Brüstung, Sturz, Glocke auf vollem Boden, Helm darüber', () => {
    const res = buildTowerStructure({ center: [0, 0], shape: 'square', size: 7, top: 'belfry', roofShape: 'helm', levels: 2, finial: 'none' });
    const t = res.towers[0]!;
    expect(t.bell).toEqual([0, t.topY + 1, 0]);
    const m = cellMap(res.cells);
    const bell = m.get(key(0, t.topY + 1, 0))!;
    expect(`${bell.role}.${bell.shape}`).toBe('bell.bell');
    expect(bell.orient?.facing).toBe(t.door!.facing);
    expect(m.get(key(0, t.topY, 0))?.shape).toBe('block'); // Bodenbefestigung: volle Oberseite darunter
    // Schnitt z = 0: Boden, Brüstung f + Glocke B, 2 Reihen Öffnung, Sturz, Giebel des Helms, Helm
    expect(section(res.cells, 'x', 0, -5, 5, t.topY - 1, t.topY + 14)).toBe([
      '...........',
      '.....#.....',
      '..../#\\....',
      '.../#.#\\...',
      '../#...#\\..',
      './#.....#\\.',
      '.##.....##.',
      '..#.....#..',
      '..#.....#..',
      '..#.....#..',
      '..#.....#..',
      '...........',
      '...........',
      '..f..B..f..',
      '..##.####..',
      '..#.^|..#..',
    ].join('\n'));
    // je Seite 3 Öffnungen: Zaun unten, darüber Luft, Wand als Sturz
    for (const [x, z] of [[3, -1], [3, 0], [3, 1], [-1, 3], [0, -3], [-3, 1]]) {
      expect(m.get(key(x!, t.topY + 1, z!))?.shape, `${x},${z}`).toBe('fence');
      expect(m.get(key(x!, t.topY + 2, z!))).toBeUndefined();
      expect(m.get(key(x!, t.topY + 3, z!))).toBeUndefined();
      expect(m.get(key(x!, t.topY + 4, z!))?.role).toBe('wall_primary');
    }
    expect(m.get(key(3, t.topY + 2, 2))?.role).toBe('wall_primary');
  });

  it('Plattform: Zaun-Geländer auf dem Rand, Laternen auf dem Geländer an den Diagonalen', () => {
    const res = buildTowerStructure({ center: [0, 0], shape: 'round', top: 'platform', levels: 2 });
    const t = res.towers[0]!;
    expect(topView(res, t.topY + 1, 4)).toBe([
      '..fffff..',
      '.f.....f.',
      'f.......f',
      'f.......f',
      'f.......f',
      'f.......f',
      'f.......f',
      '.f.....f.',
      '..fffff..',
    ].join('\n'));
    const m = cellMap(res.cells);
    const lanterns = res.cells.filter((c) => c.shape === 'lantern');
    expect(lanterns.map((c) => [c.pos[0], c.pos[2]]).sort()).toEqual([[-3, -3], [-3, 3], [3, -3], [3, 3]]);
    for (const c of lanterns) expect(m.get(key(c.pos[0], c.pos[1] - 1, c.pos[2]))?.shape).toBe('fence'); // stabile Mitte darunter
    // Plattform aus Wehrgang-Belag über dem ganzen Grundriss, bis auf die Luke (letzte Stufe + 2 Kopffreiheiten)
    const floor = footprintOffsets('round', 4).filter(([x, z]) => m.get(key(x, t.topY, z))?.role === 'walkway');
    expect(floor.length).toBe(footprintOffsets('round', 4).length - 3);
  });

  it('Stuben und Plattformen auf Mauertürmen: Wehrgang und alle Turmspitzen erreichbar, nichts schwebt', () => {
    const ring = { points: [[-8, -8], [30, -8], [30, 19], [-8, 19]] as [number, number][], closed: true, towerSpacing: 0, gates: [{ at: [11, 19] as [number, number] }] };
    for (const top of ['lookout', 'belfry', 'platform'] as const) {
      for (const shape of ['round', 'square'] as const) {
        const res = buildWallStructure({ ...ring, towerStyle: { shape, top, roofShape: shape === 'square' ? 'helm' : 'bell' } });
        expect(res.warnings, `${top} ${shape}`).toEqual([]);
        expect(floatingCells(res.cells, ground)).toEqual([]);
        expect(reachShare(res, ground, [[-20, 0, -20]], res.walls[0]!.walkway)).toBe(1);
        for (const t of res.towers) expect(reachShare(res, ground, [[-20, 0, -20]], t.topStands), `${top} ${shape} ${t.id}`).toBe(1);
      }
    }
  });

  it('am Hang: Sockel bis zum Gelände, Stube erreichbar', () => {
    const slope: HeightField = { groundY: (x, z) => Math.floor((x + z) / 3) };
    for (const top of ['lookout', 'belfry', 'platform'] as const) {
      const res = buildTowerStructure({ center: [0, 0], shape: 'square', top, levels: 2 }, { ground: slope });
      const t = res.towers[0]!;
      expect(floatingCells(res.cells, slope), top).toEqual([]);
      expect(reachShare(res, slope, [[-12, slope.groundY(-12, 0) + 1, 0]], t.topStands), top).toBe(1);
    }
  });
});
