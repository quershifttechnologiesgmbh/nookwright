/**
 * BT01 Burg: Ringmauer um eine Kernfläche (`ringAround`) und Wehrplatte (`parapets`). Tor in der Achse der Haustür,
 * Grundriss spiegelsymmetrisch zur Torachse und nie quadratisch, Torhaus ohne verdrängte Ecktürme, ein Treppenaufgang
 * mit Platz, Wehrgang begehbar, Zwinger und Graben außen; Zinnenkranz je Seite spiegelsymmetrisch.
 */
import { describe, expect, it } from 'vitest';
import type { Cell, HorizontalDir, Vec3 } from '@mcda/core';
import { buildStructures, flatGround, floatingCells, reachableStands, ringAround, standKey, type RingSpec, type TowerStyle } from '../src/index.js';

const ground = flatGround();
const CORE = { minX: 0, minZ: 0, maxX: 26, maxZ: 12 };
const STYLES: readonly TowerStyle[] = [{ shape: 'round', top: 'roof' }, { shape: 'round', top: 'lookout' }, { shape: 'square', top: 'battlements' }];
const DOORS: readonly { cell: Cell; out: HorizontalDir }[] = [
  { cell: [8, 13], out: 'south' }, { cell: [20, -1], out: 'north' }, { cell: [27, 4], out: 'east' }, { cell: [-1, 9], out: 'west' },
];

const spec = (door: { cell: Cell; out: HorizontalDir }, towerStyle: TowerStyle, extra: Partial<RingSpec> = {}): RingSpec => ({
  core: CORE, door, offset: 5, height: 7, towerSpacing: 14, towerStyle, merlon: { width: 2, gap: 1 }, gate: { width: 3, height: 4, gatehouse: true }, ...extra,
});

describe('Ringmauer um die Burg (ringAround)', () => {
  for (const door of DOORS) {
    for (const style of STYLES) {
      it(`Tor ${door.out}, ${style.shape}/${style.top}: Achse, Symmetrie, kein Quadrat, Türme, Aufgang, Wehrgang begehbar`, () => {
        const lay = ringAround(spec(door, style));
        const { line } = lay;
        const ns = door.out === 'north' || door.out === 'south';
        const a = ns ? door.cell[0] : door.cell[1];
        // spiegelsymmetrisch zur Torachse, nie quadratisch, Kernfläche samt Turmradius innen
        expect(ns ? line.minX + line.maxX : line.minZ + line.maxZ).toBe(2 * a);
        expect(line.maxX - line.minX).not.toBe(line.maxZ - line.minZ);
        expect(line.minX).toBeLessThan(CORE.minX - 5);
        const res = buildStructures({ walls: lay.walls }, { ground, seed: 3 });
        expect(res.warnings).toEqual([]);
        const wall = res.walls[0]!;
        expect(wall.gates).toHaveLength(1);
        expect(ns ? wall.gates[0]!.center[0] : wall.gates[0]!.center[1]).toBe(a);
        // 4 Ecktürme + Torhaus; Zwischentürme gleich verteilt: gegenüberliegende Seiten gleich viele
        expect(wall.towers.length).toBeGreaterThanOrEqual(6);
        const centers = res.towers.map((t) => t.center);
        const mirrored = centers.map(([x, z]): string => (ns ? `${2 * a - x},${z}` : `${x},${2 * a - z}`));
        expect(new Set(mirrored)).toEqual(new Set(centers.map((c) => c.join(','))));
        expect(wall.stairs).toHaveLength(1);
        expect(floatingCells(res.cells, ground)).toEqual([]);
        // vom Aufgang aus: ganzer Wehrgang und jede Turmplattform
        const bottom = wall.stairs[0]!.bottom;
        const seen = reachableStands(res.cells, ground, [[bottom[0], bottom[1] + 1, bottom[2]] as Vec3]);
        expect(wall.walkway.filter((p) => !seen.has(standKey(p)))).toEqual([]);
        // Innenfläche frei von Mauerwerk bis auf die Turm-Grundrisse
        const inner = lay.inner;
        expect(inner.minX).toBeGreaterThan(line.minX);
        expect(inner.maxZ).toBeLessThan(line.maxZ);
      });
    }
  }

  it('Zwinger und Graben: zweiter Ring ohne Türme in derselben Torachse, Graben außen mit Damm vor dem Tor', () => {
    const door = DOORS[0]!;
    const lay = ringAround(spec(door, STYLES[0]!, { outer: { gap: 5, height: 4 }, moat: { width: 3, gap: 2 } }));
    expect(lay.walls).toHaveLength(2);
    const res = buildStructures({ walls: lay.walls }, { ground, seed: 5 });
    expect(res.warnings).toEqual([]);
    const [main, outer] = res.walls;
    expect(outer!.towers).toEqual([]);
    expect(outer!.gates[0]!.center[0]).toBe(main!.gates[0]!.center[0]);
    expect(outer!.stairs).toHaveLength(1);
    // Graben: außerhalb aller Bauwerke, 3 breit, Damm in der Torachse
    const foot = new Set(res.footprint.map((c) => c.join(',')));
    expect(lay.moat.filter((c) => foot.has(c.join(',')))).toEqual([]);
    const o = lay.walls[1]!.points;
    const maxZ = Math.max(...o.map((p) => p[1]));
    const [minX, maxX] = [Math.min(...o.map((p) => p[0])), Math.max(...o.map((p) => p[0]))];
    const south = lay.moat.filter((c) => c[1] > maxZ && c[0] >= minX && c[0] <= maxX);
    expect(new Set(south.map((c) => c[1])).size).toBe(3);
    expect(south.some((c) => Math.abs(c[0] - door.cell[0]) <= 2)).toBe(false);
    expect(lay.outer.maxZ).toBe(Math.max(...lay.moat.map((c) => c[1])));
  });
});

describe('Wehrplatte (Zinnenkranz auf dem Flachdach)', () => {
  it('Brüstung auf dem Rand, Zinnen im Takt 2/1 je Seite spiegelsymmetrisch, innen frei', () => {
    for (const [w, d] of [[9, 9], [11, 11], [9, 12]] as const) {
      const cells: Cell[] = [];
      for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) cells.push([x + 3, z - 2]);
      const res = buildStructures({ parapets: [{ id: 'keep', cells, y: 20 }] }, { ground });
      const low = res.cells.filter((c) => c.pos[1] === 21);
      const top = new Set(res.cells.filter((c) => c.pos[1] === 22).map((c) => `${c.pos[0]},${c.pos[2]}`));
      expect(low).toHaveLength(2 * (w + d) - 4);
      expect(res.cells.every((c) => c.role === 'parapet' && c.roomId === 'fort:keep')).toBe(true);
      expect(res.footprint).toEqual([]);
      const [x0, x1, z0, z1] = [3, 3 + w - 1, -2, -2 + d - 1];
      for (let x = x0; x <= x1; x++) for (const z of [z0, z1]) expect(top.has(`${x},${z}`)).toBe(top.has(`${x0 + x1 - x},${z}`));
      for (let z = z0; z <= z1; z++) for (const x of [x0, x1]) expect(top.has(`${x},${z}`)).toBe(top.has(`${x},${z0 + z1 - z}`));
      // Ecken sind Zinnen, jede dritte Stelle eine Scharte
      expect(top.has(`${x0},${z0}`) && top.has(`${x1},${z1}`)).toBe(true);
      expect(top.has(`${x0 + 2},${z0}`)).toBe(false);
    }
  });
});
