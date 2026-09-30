import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@mcda/core';
import { buildWallStructure, flatGround, floatingCells, reachableStands, standKey, type HeightField, type WallPlan } from '../src/index.js';
import { cellMap, dump, key, section } from './support.js';

const ground = flatGround();
const LINE: WallPlan = { profile: 'garden', points: [[0, 0], [16, 0]], gates: [{ at: [8, 0], width: 1 }] };
/** Hofmauer (S2) als geschlossener Ring 13 × 13 mit Zauntor im Süden. */
const YARD: WallPlan = { profile: 'garden', points: [[0, 0], [12, 0], [12, 12], [0, 12]], closed: true, gates: [{ at: [6, 12], width: 1 }] };

describe('Gartenmauer (research/18 Z2)', () => {
  it('niedrig: Sockel + Feld, Pfeiler im Takt 4 mit Kappe, Torpfeiler 1 höher, Zauntor; kein Wehrgang, keine Zinnen', () => {
    const res = buildWallStructure(LINE);
    expect(res.warnings).toEqual([]);
    expect(res.towers).toEqual([]);
    expect(floatingCells(res.cells, ground)).toEqual([]);
    const wall = res.walls[0]!;
    expect(wall.walkway).toEqual([]);
    expect(wall.stairs).toEqual([]);
    expect(wall.gates.map((g) => g.kind)).toEqual(['fence_gate']);
    // Ansicht z = 0 (y 4 … 0): _ Kappe, # Pfeiler/Feld/Sockel, t Zauntor
    expect(section(res.cells, 'x', 0, -1, 17, 0, 4)).toBe([
      '........_._........',
      '._..._..#.#.._..._.',
      '.#...#..#.#..#...#.',
      '.########t########.',
      '.#################.',
    ].join('\n'));
    const m = cellMap(res.cells);
    const role = (x: number, y: number): string | undefined => { const c = m.get(key(x, y, 0)); return c && `${c.role}.${c.shape}`; };
    expect([role(1, 0), role(1, 1), role(4, 1), role(4, 2), role(4, 3), role(7, 3), role(7, 4)])
      .toEqual(['foundation.block', 'wall_primary.block', 'wall_quoin.block', 'wall_quoin.block', 'wall_cornice.slab', 'wall_quoin.block', 'wall_cornice.slab']);
    expect(m.get(key(4, 3, 0))?.orient?.half).toBe('bottom');
    const gate = m.get(key(8, 1, 0))!;
    expect(`${gate.role}.${gate.shape}`).toBe('fence_outdoor.fence_gate');
    expect(['north', 'south']).toContain(gate.orient?.facing);
    // Rollen: kein Wehrgang, keine Brüstung; Treppen nur als Vortreppe zur Torschwelle (1 Stufe je Seite)
    const roles = new Set(res.cells.map((c) => `${c.role}.${c.shape}`));
    expect([...roles].sort()).toEqual(['fence_outdoor.fence_gate', 'foundation.block', 'foundation.stairs', 'wall_cornice.slab', 'wall_primary.block', 'wall_quoin.block']);
    expect(res.cells.filter((c) => c.shape === 'stairs').map((c) => c.pos)).toEqual([[8, 0, -1], [8, 0, 1]]);
  });

  it('Laternen auf den Pfeilern, Heckenfüllung, Lücke als Tor (≥ 3), Takt 5', () => {
    const res = buildWallStructure({ ...LINE, gates: [{ at: [8, 0], width: 3 }], garden: { lanterns: true, hedge: true, pillarEvery: 5 } });
    expect(res.warnings).toEqual([]);
    expect(res.walls[0]!.gates[0]!.kind).toBe('opening');
    expect(section(res.cells, 'x', 0, -1, 17, 0, 4)).toBe([
      '.......L...L.......',
      '.L...L.#...#.L...L.',
      '.#...#.#...#.#...#.',
      '.#bbb#b#...#b#bbb#.',
      '.#################.',
    ].join('\n'));
    // jede Laterne steht auf einem Pfeiler (volle Oberseite)
    const m = cellMap(res.cells);
    const lanterns = res.cells.filter((c) => c.shape === 'lantern');
    expect(lanterns).toHaveLength(6);
    for (const c of lanterns) expect(m.get(key(c.pos[0], c.pos[1] - 1, c.pos[2]))?.role).toBe('wall_quoin');
    expect(res.cells.filter((c) => c.role === 'leaves_bush').length).toBeGreaterThan(0);
    expect(floatingCells(res.cells, ground)).toEqual([]);
  });

  it('Hof (S2): geschlossener Ring, Pfeiler an allen Ecken, Hof nur durchs Zauntor erreichbar', () => {
    const res = buildWallStructure(YARD);
    expect(res.warnings).toEqual([]);
    const m = cellMap(res.cells);
    for (const [x, z] of [[0, 0], [12, 0], [12, 12], [0, 12]]) expect(m.get(key(x!, 2, z!))?.role, `${x},${z}`).toBe('wall_quoin');
    const outside: Vec3 = [-5, 0, -5];
    const yard: Vec3 = [6, 0, 6];
    expect(reachableStands(res.cells, ground, [outside]).has(standKey(yard))).toBe(true);
    const closed = buildWallStructure({ ...YARD, gates: [] });
    expect(reachableStands(closed.cells, ground, [outside]).has(standKey(yard))).toBe(false);
    // Doppeltor aus zwei Zauntoren
    const wide = buildWallStructure({ ...YARD, gates: [{ at: [6, 12], width: 2 }] });
    expect(wide.cells.filter((c) => c.shape === 'fence_gate')).toHaveLength(2);
    expect(reachableStands(wide.cells, ground, [outside]).has(standKey(yard))).toBe(true);
  });

  it('folgt dem Gelände in Stufen ≤ 1, nichts schwebt, Laternen stehen auf Pfeilern', () => {
    const slope: HeightField = { groundY: (x) => Math.floor(x / 3) - 1 };
    const res = buildWallStructure({ ...LINE, points: [[0, 0], [30, 0]], gates: [{ at: [14, 0], width: 3 }], garden: { lanterns: true } }, { ground: slope });
    expect(res.warnings).toEqual([]);
    expect(floatingCells(res.cells, slope)).toEqual([]);
    const m = cellMap(res.cells);
    const crown = (x: number): number => {
      let y = slope.groundY(x, 0) + 1;
      while (m.get(key(x, y + 1, 0))?.role === 'wall_primary' || m.get(key(x, y + 1, 0))?.role === 'foundation') y++;
      return y;
    };
    const fields = Array.from({ length: 31 }, (_, x) => x).filter((x) => m.get(key(x, crown(x), 0))?.role === 'wall_primary');
    for (let i = 1; i < fields.length; i++) {
      if (fields[i]! - fields[i - 1]! === 1) expect(Math.abs(crown(fields[i]!) - crown(fields[i - 1]!))).toBeLessThanOrEqual(1);
    }
    for (const c of res.cells.filter((c) => c.shape === 'lantern')) expect(m.get(key(c.pos[0], c.pos[1] - 1, c.pos[2]))?.role).toBe('wall_quoin');
  });

  it('Dicke 1 … 3 und diagonale Züge: Pfeiler über den ganzen Querschnitt, nichts schwebt', () => {
    for (const thickness of [1, 2, 3]) {
      const res = buildWallStructure({ ...LINE, thickness, points: [[0, 0], [16, 0], [26, 9]] });
      expect(floatingCells(res.cells, ground), `T=${thickness}`).toEqual([]);
      const across = res.cells.filter((c) => c.pos[0] === 4 && c.role === 'wall_quoin' && c.pos[1] === 2);
      expect(across, `T=${thickness}`).toHaveLength(thickness);
      expect(res.walls[0]!.walkway).toEqual([]);
    }
  });

  it('deterministisch; Wehrmauer ohne Profil = profile fortress', () => {
    expect(dump(buildWallStructure(YARD))).toBe(dump(buildWallStructure(YARD)));
    const ring: WallPlan = { points: [[-8, -8], [30, -8], [30, 19], [-8, 19]], closed: true, towerSpacing: 0, gates: [{ at: [11, 19] }] };
    expect(dump(buildWallStructure({ ...ring, profile: 'fortress' }))).toBe(dump(buildWallStructure(ring)));
  });
});
