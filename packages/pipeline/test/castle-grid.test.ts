/**
 * W7-B „Burg: Fassadenraster und Farbe“ (plan/spikes/W7B_burg.md) über den Anwendungsdienst (Weg der Galerie):
 *  - F1/F2: der Bergfried hat je Seite auf allen Geschossen dieselbe Rasterlinie (`RoofDetail.shaftGrid`), die Leitern
 *    stehen nie auf einer Fensterachse – der Wachturm hat auf jedem Obergeschoss an jeder Seite ein Fenster, und jede
 *    Leiter bleibt (Zugang);
 *  - Farbe: Sockelgeschoss der Mauertürme (`fort_base`) an der Holzburg aus Bruchstein, an der Steinburg wie die Mauer;
 *    mit einer Farbwelt behalten Krone und Wehrgang ihren Kontrast (Paletten färben sie nicht mehr wie die Wand).
 */
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import type { BuildingSizeClass } from '@mcda/catalog';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, shellFor } from '../src/index.js';
import { ctx, loadType } from './buildingtype-fuzz.js';

const V = TARGET_VERSIONS['1.21.11'];
const SEEDS = [2026, 3257322930, 560943719];
const plan = (type: string, themeId: string, size: BuildingSizeClass, seed: number, paletteId?: string) =>
  projectFromBuildingType(loadType(type), { size, themeId, targetVersion: V, ...(paletteId !== undefined ? { paletteId } : {}) }, seed, ctx);
const world = (res: ReturnType<typeof plan>) => generateBase(res.project, ctx, { ...res.build, ...res.surroundings });

describe('W7-B F1: Bergfried mit eigenem Raster', () => {
  for (const themeId of ['medieval', 'nordic']) {
    it(`Burg ${themeId}: jede Seite des Bergfrieds auf allen Geschossen dieselbe Rasterlinie`, { timeout: HEAVY_TIMEOUT }, () => {
      for (const seed of SEEDS) {
        const res = plan('castle_compact', themeId, 'M', seed);
        const keep = res.project.state.volumes!.find((v) => v.name === 'Bergfried')!.id;
        const cells = res.project.state.rooms.filter((r) => r.volumeId === keep).flatMap((r) => r.cells.toArray());
        const xs = cells.map((c) => c[0]);
        const zs = cells.map((c) => c[1]);
        const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
        const shell = shellFor(res.project, res.build);
        const sides = new Map<string, Set<string>>();
        for (const g of shell.facadeGrid ?? []) {
          const ns = g.out === 'north' || g.out === 'south';
          const onKeep = ns ? (g.plane === z0 || g.plane === z1) && g.from === x0 && g.to === x1 : (g.plane === x0 || g.plane === x1) && g.from === z0 && g.to === z1;
          if (!onKeep) continue;
          const k = `${g.out}|${g.plane}`;
          (sides.get(k) ?? sides.set(k, new Set()).get(k)!).add(JSON.stringify({ posts: g.posts, axes: g.bays.map((b) => b.axis) }));
        }
        expect(sides.size, `Seed ${seed}`).toBeGreaterThanOrEqual(3);
        for (const [k, shapes] of sides) expect(shapes.size, `Seed ${seed} ${k}`).toBe(1);
      }
    });
  }
});

describe('W7-B F1: Leitern nicht auf Fensterachsen (Wachturm)', () => {
  for (const size of ['S', 'M', 'L'] as const) {
    it(`Wachturm ${size}: jedes Obergeschoss hat an jeder Seite ein Fenster, alle Leitern bleiben`, { timeout: HEAVY_TIMEOUT }, () => {
      for (const seed of SEEDS.slice(0, 2)) {
        const res = plan('watchtower', 'medieval', size, seed);
        const shell = shellFor(res.project, res.build);
        const floors = [...new Set(res.project.state.rooms.map((r) => r.floorIndex))].sort((a, b) => a - b);
        for (const f of floors.filter((x) => x > 0)) {
          const room = [...shell.rooms.values()].find((r) => r.floorIndex === f)!;
          const sides = new Set(shell.cells.filter((c) => c.kind === 'window' && c.roomId === room.roomId).map((c) => {
            const [x, , z] = c.pos;
            return room.interior.has(x, z + 1) ? 'n' : room.interior.has(x, z - 1) ? 's' : room.interior.has(x + 1, z) ? 'w' : 'e';
          }));
          expect([...sides].sort(), `Seed ${seed} Etage ${f}`).toEqual(['e', 'n', 's', 'w']);
        }
        // Leitern zwischen allen Geschossen (Zugang bleibt) und die Dachluke
        expect(res.project.state.links.filter((l) => l.type === 'ladder').length, `Seed ${seed}`).toBe(floors.length - 1);
        expect(shell.warnings.filter((w) => /Treppe|Leiter/.test(w)), `Seed ${seed}`).toEqual([]);
      }
    });
  }
});

describe('W7-B Farbe: Sockelgeschoss der Mauertürme und Paletten', () => {
  const names = (w: ReturnType<typeof world>, role: string): string[] => {
    const vol = w.materialized.volume;
    return w.surroundings.cells.filter((c) => c.kind === 'fort' && c.role === role && vol.contains(c.pos)).map((c) => vol.stateAt(c.pos).name).filter((n) => n !== 'air');
  };

  it('Holzburg (nordic): Türme bis zum Wehrgang aus Bruchstein, darüber Fichte; Steinburg (medieval) wie die Mauer', { timeout: HEAVY_TIMEOUT }, () => {
    const nordic = world(plan('castle_compact', 'nordic', 'M', 2026));
    const base = names(nordic, 'fort_base');
    expect(base.length).toBeGreaterThan(200);
    expect(base.filter((n) => !/^(mossy_)?cobblestone$/.test(n))).toEqual([]);
    expect(names(nordic, 'wall_primary').filter((n) => /spruce/.test(n)).length).toBeGreaterThan(0);
    const medieval = world(plan('castle_compact', 'medieval', 'M', 2026));
    // Rückfall `wall_primary`: dieselben Steine wie der Mauerkörper, kein Holz
    const mb = new Set(names(medieval, 'fort_base'));
    expect(mb.size).toBeGreaterThan(0);
    for (const n of mb) expect(n, n).toMatch(/stone|cobble|andesite|brick/);
    expect(medieval.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
    expect(nordic.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
  });

  it('Farbwelt: Krone und Wehrgang nicht in der Wandfarbe der Palette', { timeout: HEAVY_TIMEOUT }, () => {
    // Steinpalette auf der Holzburg: vorher Zinnen und Wehrgang aus den Steinziegeln der Mauer, jetzt dunkle Stammkrone und
    // heller Eichenbelag des Themes. (medieval und rustic mit Farbwelt: eigener Test unten.)
    const stone = world(plan('castle_compact', 'nordic', 'M', 2026, 'steinburg_grau'));
    expect(names(stone, 'wall_primary').some((n) => /stone_bricks|cobblestone/.test(n))).toBe(true);
    expect(names(stone, 'parapet').filter((n) => !/^(spruce|dark_oak)_log$/.test(n))).toEqual([]);
    expect(names(stone, 'walkway').filter((n) => !/^oak_/.test(n))).toEqual([]);
    // Holzpalette auf der Holzburg: Krone bleibt die dunkle Stammkrone des Themes, Wehrgang Eiche (vorher Fichtenbretter
    // wie die Mauer)
    const nor = world(plan('castle_compact', 'nordic', 'M', 2026, 'winterhort'));
    expect(names(nor, 'parapet').filter((n) => !/^(spruce|dark_oak)_log$/.test(n))).toEqual([]);
    expect(names(nor, 'walkway').filter((n) => !/^oak_/.test(n))).toEqual([]);
  });
});

describe('W7 (27.09.2026): Farbwelten an Burg medieval und rustic', () => {
  // Vorher MaterializeError: Die Feuerschale fragt `hearth` als Mauer ab, die Akzentfarbe der Palette (Wolle/Beton) hat
  // keine Mauer; Bäume fragen `leaves_oak` als Laub ab, piratenbucht_holz hat als Bewuchs nur einen toten Busch. Jetzt
  // fällt die Auflösung auf die Familien des Themes zurück (`resolvePalettedTheme`, Ersatzfamilien).
  const cases: Array<[string, string]> = [
    ['medieval', 'steinburg_grau'], ['medieval', 'piratenbucht_holz'], ['medieval', 'winterhort'],
    ['rustic', 'piratenbucht_holz'],
  ];
  for (const [themeId, paletteId] of cases) {
    it(`Burg ${themeId} + ${paletteId}: baubar, 0 harte Verstöße`, { timeout: HEAVY_TIMEOUT }, () => {
      const w = world(plan('castle_compact', themeId, 'M', 2026, paletteId));
      expect(w.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
    });
  }
  it('Burg medieval + koenigsschloss_gold: 0 harte Verstöße (W8-C)', { timeout: HEAVY_TIMEOUT }, () => {
    // W8-C (27.09.2026): vorher 2 105 Teppiche ohne Träger – die Farbwelt färbte auch `ground_stone` (unterste Lage
    // über dem Burggraben). Jetzt hält das Umfärben den Geländevertrag (`terrainRequirement`, palette-terrain.test.ts).
    const w = world(plan('castle_compact', 'medieval', 'M', 2026, 'koenigsschloss_gold'));
    expect(w.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
  });
});
