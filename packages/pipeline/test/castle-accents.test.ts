/**
 * W9-G5 „Materialspiel“ (plan/spikes/W9G5_materialspiel.md, Review R5 G5) über den Anwendungsdienst (Weg der Galerie):
 *  - Burg medieval: Holzakzente aus dem Theme (Fichtendach/-kappen/-hurde, rotes Bannerpaar), Wandverlauf mit ≥ 3
 *    Blockarten je Höhenband und dunklerem Fuß, Anteil des häufigsten Wandblocks ≤ 70 %;
 *  - nordische Holzburg: Akzente im Ton der Palisade (dunkle Eiche), kein Fichtendach von medieval;
 *  - Dach medieval in drei Ringtönen: ≥ 2 Varianten, zweite ≥ 15 %, je Dachreihe ein Material (D1);
 *  - harte Regeln: 0 Physik-/Kollisionsverstöße (außer Spawn-Hinweisen), deterministisch.
 */
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType } from '../src/index.js';
import { ctx, loadType } from './buildingtype-fuzz.js';

const V = TARGET_VERSIONS['1.21.11'];
const build = (type: string, themeId: string, seed = 2026) => {
  const res = projectFromBuildingType(loadType(type), { size: 'M', themeId, targetVersion: V }, seed, ctx);
  return generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
};
type World = ReturnType<typeof build>;
const nameAt = (w: World, p: readonly [number, number, number]): string => w.materialized.volume.stateAt(p).name.replace(/^minecraft:/, '');
const family = (n: string): string => n.replace(/_(stairs|slab|wall)$/, '').replace(/_planks$/, '').replace(/(brick|tile)s$/, '$1');
const count = <T>(xs: readonly T[]): Map<T, number> => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>());
const FORT_WALL = new Set(['wall_primary', 'foundation', 'fort_base', 'parapet']);

describe('W9-G5: Materialspiel der Burg', () => {
  it('medieval: Holzakzente, Bannerpaar, Wandverlauf mit dunklerem Fuß, Dominanz ≤ 70 %', { timeout: HEAVY_TIMEOUT }, () => {
    const w = build('castle_compact', 'medieval');
    expect(w.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
    const fort = w.shell.cells.filter((c) => c.kind === 'fort');
    const byRole = (role: string): string[] => fort.filter((c) => c.role === role).map((c) => nameAt(w, c.pos));
    expect(new Set(byRole('hoarding'))).toEqual(new Set(['spruce_planks']));
    expect(new Set(byRole('crown_cap'))).toEqual(new Set(['spruce_slab']));
    const banners = fort.filter((c) => c.shape === 'wall_banner').map((c) => nameAt(w, c.pos));
    expect(banners).toEqual(['red_wall_banner', 'red_wall_banner']);
    // Mauerwerk der Bauwerke und Außenwände des Hauses: drei Höhenbänder je Spalte
    const col = new Map<string, [number, number]>();
    const walls = fort.filter((c) => FORT_WALL.has(c.role));
    for (const c of walls) {
      const k = `${c.pos[0]},${c.pos[2]}`;
      const r = col.get(k);
      col.set(k, r === undefined ? [c.pos[1], c.pos[1]] : [Math.min(r[0], c.pos[1]), Math.max(r[1], c.pos[1])]);
    }
    const bands: string[][] = [[], [], []];
    for (const c of walls) {
      const [a, b] = col.get(`${c.pos[0]},${c.pos[2]}`)!;
      const n = nameAt(w, c.pos);
      if (n === 'air') continue;
      bands[Math.min(2, Math.floor(b > a ? ((c.pos[1] - a) / (b - a + 1)) * 3 : 1))]!.push(family(n));
    }
    for (const [i, band] of bands.entries()) {
      const kinds = [...count(band)].filter(([, v]) => v / band.length >= 0.03);
      expect(kinds.length, `Band ${i}`).toBeGreaterThanOrEqual(3);
    }
    const all = bands.flat();
    expect(Math.max(...count(all).values()) / all.length).toBeLessThanOrEqual(0.7);
    // dunkler, rauer Fuß: Bruch-Tiefenschiefer unten häufiger als oben
    const dark = (band: string[]): number => band.filter((f) => f === 'cobbled_deepslate').length / band.length;
    expect(dark(bands[0]!)).toBeGreaterThan(dark(bands[2]!) + 0.05);
  });

  it('nordic: Akzente im Ton der Palisade (dunkle Eiche), kein Fichtendach', { timeout: HEAVY_TIMEOUT }, () => {
    const w = build('castle_compact', 'nordic', 7);
    expect(w.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
    const fort = w.shell.cells.filter((c) => c.kind === 'fort');
    const roofs = new Set(fort.filter((c) => c.role === 'roof_tower').map((c) => family(nameAt(w, c.pos))));
    expect(roofs.size).toBeGreaterThan(0);
    expect([...roofs].every((f) => f === 'dark_oak')).toBe(true);
    expect(new Set(fort.filter((c) => c.role === 'crown_cap').map((c) => nameAt(w, c.pos)))).toEqual(new Set(['dark_oak_slab']));
  });

  it('medieval (Seed 7, Ecktürme mit Dach): Turmdächer aus Holz, Traufring dunkel', { timeout: HEAVY_TIMEOUT }, () => {
    const w = build('castle_compact', 'medieval', 7);
    const roof = w.shell.cells.filter((c) => c.kind === 'fort' && c.role === 'roof_tower' && c.shape === 'stairs');
    const fams = count(roof.map((c) => family(nameAt(w, c.pos))));
    expect([...fams.keys()].sort()).toEqual(['dark_oak', 'spruce']);
    expect(fams.get('spruce')!).toBeGreaterThan(fams.get('dark_oak')!);
  });
});

describe('W9-G5: Dach in drei Ringtönen (medieval)', () => {
  for (const type of ['house', 'tavern', 'castle_compact'] as const) {
    it(`${type}: ≥ 2 Varianten, zweite ≥ 15 %, je Reihe ein Material`, { timeout: HEAVY_TIMEOUT }, () => {
      const w = build(type, 'medieval');
      const roof = w.shell.cells.filter((c) => c.kind === 'roof' && c.role === 'roof_main').map((c) => ({ y: c.pos[1], f: family(nameAt(w, c.pos)) }));
      const fams = [...count(roof.map((r) => r.f))].sort((a, b) => b[1] - a[1]);
      expect(fams.length).toBeGreaterThanOrEqual(2);
      expect(fams[1]![1] / roof.length).toBeGreaterThanOrEqual(0.15);
      // D1: je Reihe (gleiche Höhe) ein Material – Abweichung von der Mehrheit < 10 %
      const rows = new Map<number, string[]>();
      for (const r of roof) rows.set(r.y, [...(rows.get(r.y) ?? []), r.f]);
      let off = 0;
      for (const fs of rows.values()) off += fs.length - Math.max(...count(fs).values());
      expect(off / roof.length).toBeLessThan(0.1);
    });
  }
});
