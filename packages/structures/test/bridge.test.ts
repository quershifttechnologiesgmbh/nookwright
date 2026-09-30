/**
 * F-Ensemble: Holzbrücken (`bridge.ts`) – Profil (Enden flach, Treppe ≤ 1:1), Stützen im Takt, Anschluss an den
 * Wehrgang, ganz-oder-gar-nicht, Determinismus; nichts schwebt, Lauf begehbar bis auf den Wehrgang.
 */
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@mcda/core';
import {
  BRIDGE_MAX_FREE_SPAN, bridgeProfile, buildStructures, flatGround, floatingCells, reachableStands, standKey, supportSlots, type WallPlan,
} from '../src/index.js';

const ground = flatGround();
/** Ring wie in wall.test.ts: Wehrgang-Boden bei y = 5 (Füße 6), Innenkante des Nordzugs bei z = −7. */
const RING: WallPlan = { points: [[-8, -8], [30, -8], [30, 19], [-8, 19]], closed: true, towerSpacing: 0, gates: [{ at: [11, 19] }] };

describe('Brückenprofil und Stützen', () => {
  it('beide Enden flach, Stufen mittig, höchstens eine Stufe je Zelle; zu steil = undefined', () => {
    expect(bridgeProfile(6, 5, 0)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(bridgeProfile(6, 5, 2)).toEqual([5, 5, 6, 7, 7, 7]);
    expect(bridgeProfile(6, 5, -2)).toEqual([5, 5, 5, 4, 3, 3]);
    expect(bridgeProfile(4, 5, 2)).toEqual([5, 6, 7, 7]);
    expect(bridgeProfile(4, 5, 3)).toBeUndefined();
    for (let n = 2; n <= 14; n++) {
      for (let r = -(n - 2); r <= n - 2; r++) {
        const f = bridgeProfile(n, 10, r)!;
        expect(f[0]).toBe(10);
        expect(f[n - 1]).toBe(10 + r);
        for (let k = 1; k < n; k++) expect(Math.abs(f[k]! - f[k - 1]!)).toBeLessThanOrEqual(1);
        // die Treppe liegt nie in einer Endzelle: Zelle 0 und n − 1 sind so hoch wie ihr Nachbar oder tiefer
        if (n >= 2) expect(f[0]! >= f[1]! || r > 0).toBe(true);
      }
    }
  });

  it('Stützen: höchstens BRIDGE_MAX_FREE_SPAN freie Zellen zwischen zwei Auflagern (Wand, Stütze, Ende)', () => {
    for (let n = 1; n <= 20; n++) {
      const supports = [-1, ...supportSlots(n), n];
      for (let i = 1; i < supports.length; i++) expect(supports[i]! - supports[i - 1]! - 1, `n=${n}`).toBeLessThanOrEqual(BRIDGE_MAX_FREE_SPAN);
    }
    expect(supportSlots(4)).toEqual([]);
    expect(supportSlots(10)).toHaveLength(2);
  });
});

describe('Brücke zum Wehrgang', () => {
  // Tür-Podest bei z = 3 (Füße 4), Brücke nach Norden bis zum Wehrgang des Nordzugs
  const spec = { id: 'b', start: [10, 4, 3] as Vec3, dir: 'north' as const };

  it('gebaut: Lauf bis zur ersten Wehrgang-Zelle, Stufen zum Wehrgang, Stützen bis auf den Boden, nichts schwebt', () => {
    const res = buildStructures({ walls: [RING], bridges: [spec] });
    const info = res.bridges![0]!;
    expect(info.built, info.reason).toBe(true);
    expect(info.landing).toBeDefined();
    const walkY = info.landing![1];
    expect(info.path[0]).toEqual([10, 4, 3]);
    expect(info.path.at(-1)![1]).toBe(walkY);
    expect(info.path.at(-1)![2]).toBe(info.landing![2] + 1);
    expect(info.supports.length).toBeGreaterThan(0);
    expect(floatingCells(res.cells, ground)).toEqual([]);
    const own = res.cells.filter((c) => c.roomId === 'fort:b');
    expect(new Set(own.map((c) => `${c.role}.${c.shape}`))).toEqual(new Set(['beam.planks', 'beam.stairs', 'beam.fence', 'beam.log', 'light_outdoor.lantern']));
    // Stützen: Stamm von der untersten Reihe über dem Gelände bis unter den Belag
    for (const [x, z] of info.supports) expect(own.some((c) => c.pos[0] === x && c.pos[2] === z && c.pos[1] === 0 && c.shape === 'log')).toBe(true);
    // Laternen paarweise (spiegelsymmetrisch zur Achse x = 10)
    const lamps = own.filter((c) => c.shape === 'lantern').map((c) => c.pos);
    expect(lamps.length % 2).toBe(0);
    for (const [x, y, z] of lamps) expect(lamps.some((q) => q[0] === 20 - x && q[1] === y && q[2] === z)).toBe(true);
    // begehbar: vom Tür-Podest über die Brücke auf den Wehrgang
    const reach = reachableStands(res.cells, ground, [info.path[0]!]);
    expect(reach.has(standKey(info.landing!))).toBe(true);
  });

  it('deterministisch und ohne Brücken bitgleich (kein Feld `bridges`)', () => {
    const a = buildStructures({ walls: [RING], bridges: [spec] });
    const b = buildStructures({ walls: [RING], bridges: [spec] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const plain = buildStructures({ walls: [RING] });
    expect(plain.bridges).toBeUndefined();
    expect(a.cells.filter((c) => c.roomId !== 'fort:b')).toEqual(plain.cells);
  });

  it('ganz oder gar nicht: zu steil, zu lang, belegt oder am Gelände → keine Zelle, Hinweis', () => {
    const cases = [
      { ...spec, start: [10, 1, -5] as Vec3 }, // 2 Zellen bis zum Wehrgang, 5 Stufen
      { ...spec, maxLength: 3 },
      { ...spec, start: [10, 4, 30] as Vec3, dir: 'south' as const }, // außerhalb: kein Wehrgang in Reichweite
    ];
    for (const c of cases) {
      const res = buildStructures({ walls: [RING], bridges: [c] });
      expect(res.bridges![0]!.built).toBe(false);
      expect(res.cells.some((x) => x.roomId === 'fort:b')).toBe(false);
      expect(res.warnings.some((w) => w.startsWith('fort:b:'))).toBe(true);
    }
    // Gelände reicht an den Belag
    const hill = { groundY: (_x: number, z: number): number => (z >= -4 && z <= 0 ? 4 : -1) };
    const res = buildStructures({ walls: [RING], bridges: [spec] }, { ground: hill });
    expect(res.bridges![0]!.built).toBe(false);
  });

  it('Brücke zwischen zwei Türen (feste Länge): flach, eine Stütze in der Mitte', () => {
    const res = buildStructures({ bridges: [{ id: 'g', start: [0, 5, 0], dir: 'east', end: [5, 5, 0] }] });
    const info = res.bridges![0]!;
    expect(info.built).toBe(true);
    expect(info.path.map((p) => p[1])).toEqual([5, 5, 5, 5, 5, 5]);
    expect(info.supports).toHaveLength(2);
    expect(floatingCells(res.cells, ground)).toEqual([]);
  });
});
