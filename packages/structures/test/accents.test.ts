/**
 * W9-G5 „Materialspiel“ (plan/spikes/W9G5_materialspiel.md, Review R5 G5): Materialakzente der Mauertürme über
 * `WallPlan.accents` – Turmdächer in der Rolle `roof_tower`, Kappen auf den Turmzinnen (`crown_cap`), Hurde (`hoarding`)
 * über Torbau und Torhaus-Türmen, Bannerpaar spiegelgleich zur Torachse. Nur Rollen und Zubehör: ohne die Rollen
 * (Rückfall `roof_main`/`parapet`) ist die Geometrie des Mauerkörpers dieselbe; ohne Option bitgleich (compat.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { ShellCell } from '@mcda/blueprint';
import { buildStructures, flatGround, floatingCells, ringAround, type RingSpec, type TowerStyle } from '../src/index.js';
import { cellMap, key } from './support.js';

const ground = flatGround();
const CORE = { minX: 0, minZ: 0, maxX: 26, maxZ: 12 };
const ROUND: TowerStyle = { shape: 'round', top: 'battlements', lit: true, corner: { top: 'roof', roofShape: 'cone', flare: true, finial: 'pole' } };
const SQUARE: TowerStyle = { shape: 'square', top: 'battlements', lit: true, corner: { top: 'roof', roofShape: 'tent', finial: 'pole' } };
const ring = (towerStyle: TowerStyle, accents: boolean, out: 'south' | 'east' = 'south'): RingSpec => ({
  core: CORE, door: out === 'south' ? { cell: [8, 13], out } : { cell: [27, 4], out }, offset: 6, height: 7, towerSpacing: 44, towerStyle,
  merlon: { width: 2, gap: 1 }, gate: { width: 3, height: 5, gatehouse: true, gateBlock: true }, ...(accents ? { accents } : {}),
});
const build = (style: TowerStyle, accents: boolean, out: 'south' | 'east' = 'south') =>
  buildStructures({ walls: ringAround(ring(style, accents, out)).walls }, { ground, seed: 3 });

/** Rollen der Akzente auf die Rückfallrollen abbilden; Kappen und Banner sind Zubehör (fallen weg). */
const plainRoles = (cells: readonly ShellCell[]): ShellCell[] => cells
  .filter((c) => c.role !== 'crown_cap' && c.shape !== 'wall_banner')
  .map((c) => (c.role === 'roof_tower' ? { ...c, role: 'roof_main' } : c.role === 'hoarding' ? { ...c, role: 'parapet' } : c));

describe('Materialakzente der Mauertürme (W9-G5)', () => {
  for (const [name, style] of [['rund', ROUND], ['eckig', SQUARE]] as const) {
    it(`${name}: nur Rollen und Zubehör – ohne sie dieselben Zellen wie ohne Akzente`, () => {
      const plain = build(style, false);
      const acc = build(style, true);
      expect(acc.warnings).toEqual([]);
      expect(plainRoles(acc.cells)).toEqual(plain.cells);
      expect(floatingCells(acc.cells, ground)).toEqual([]);
    });

    it(`${name}: Holzdach an den Ecktürmen, Kappe auf jeder Turmzinne, Hurde über Torbau und Torhaus`, () => {
      const acc = build(style, true);
      const m = cellMap(acc.cells);
      expect(acc.cells.some((c) => c.role === 'roof_main')).toBe(false);
      expect(acc.cells.filter((c) => c.role === 'roof_tower').length).toBeGreaterThan(100);
      // Kappe = untere Stufe genau über einer Zinne (Brüstung bzw. Hurde)
      const caps = acc.cells.filter((c) => c.role === 'crown_cap');
      expect(caps.length).toBeGreaterThan(20);
      for (const c of caps) {
        expect(c.shape).toBe('slab');
        expect(c.orient?.half).toBe('bottom');
        expect(['parapet', 'hoarding']).toContain(m.get(key(c.pos[0], c.pos[1] - 1, c.pos[2]))?.role);
      }
      // Hurde nur am Torbau: um die Torachse, spiegelgleich (gleich viele Zellen links und rechts)
      const gate = acc.walls[0]!.gates[0]!.center;
      const hoard = acc.cells.filter((c) => c.role === 'hoarding');
      expect(hoard.length).toBeGreaterThan(20);
      const along = (c: ShellCell): number => c.pos[0] - gate[0];
      expect(hoard.filter((c) => along(c) < 0).length).toBe(hoard.filter((c) => along(c) > 0).length);
      expect(hoard.every((c) => Math.abs(along(c)) <= 14)).toBe(true);
    });
  }

  for (const out of ['south', 'east'] as const) {
    it(`Tor ${out}: Bannerpaar an den Torhaus-Türmen, gleiche Höhe, an voller Wand, nach außen, spiegelgleich`, () => {
      const acc = build(ROUND, true, out);
      const m = cellMap(acc.cells);
      const banners = acc.cells.filter((c) => c.shape === 'wall_banner');
      expect(banners).toHaveLength(2);
      const [a, b] = banners as [ShellCell, ShellCell];
      expect(a.role).toBe('textile_primary');
      expect(a.pos[1]).toBe(b.pos[1]);
      expect(a.orient?.facing).toBe(out);
      expect(b.orient?.facing).toBe(out);
      const [dx, dz] = out === 'south' ? [0, 1] : [1, 0];
      const gate = acc.walls[0]!.gates[0]!.center;
      // Torachse: x (Tor im Süden) bzw. z (Tor im Osten) – die Banner liegen spiegelbildlich
      const ax = out === 'south' ? 0 : 2;
      const g = out === 'south' ? gate[0] : gate[1];
      expect(a.pos[ax]! - g).toBe(-(b.pos[ax]! - g));
      for (const c of banners) {
        // dahinter volle Turmwand (Banner und Tuch darunter), davor bzw. darunter frei
        for (const y of [c.pos[1], c.pos[1] - 1]) {
          const back = m.get(key(c.pos[0] - dx, y, c.pos[2] - dz));
          expect(back?.shape, `${c.pos} y=${y}`).toBe('block');
          expect(['wall_primary', 'fort_base']).toContain(back?.role);
        }
        expect(m.get(key(c.pos[0], c.pos[1] - 1, c.pos[2]))).toBeUndefined();
      }
    });
  }

  it('Ohne Torbau (kein Torhaus) keine Hurde und keine Banner, Dächer und Kappen bleiben', () => {
    const r: RingSpec = { ...ring(ROUND, true), gate: { width: 3, height: 5 } };
    const acc = buildStructures({ walls: ringAround(r).walls }, { ground, seed: 3 });
    expect(acc.cells.some((c) => c.role === 'hoarding' || c.shape === 'wall_banner')).toBe(false);
    expect(acc.cells.some((c) => c.role === 'roof_tower')).toBe(true);
    expect(acc.cells.some((c) => c.role === 'crown_cap')).toBe(true);
  });

  it('Zwinger (zweiter Ring) bleibt schlicht', () => {
    const r: RingSpec = { ...ring(ROUND, true), outer: { gap: 5, height: 4 } };
    const layout = ringAround(r);
    expect(layout.walls[0]!.accents).toBe(true);
    expect(layout.walls[1]!.accents).toBeUndefined();
  });
});
