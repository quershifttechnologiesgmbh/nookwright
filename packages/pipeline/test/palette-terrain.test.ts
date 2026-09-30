/**
 * W8-C „Farbwelten färben kein Gelände“ (plan/spikes/W8C_farbwelten_gelaende.md): Paletten mit Teppich, Kies oder
 * Ranken im Boden-/Bewuchs-Anteil färbten auch Geländerollen um (Teppich und Kies über Luft, Blumen auf Brettern,
 * Ranken frei im Busch) – harte Stütz- und Schwerkraftverstöße. Jetzt gilt beim Umfärben der Geländevertrag
 * (`terrainRequirement` in `@mcda/catalog`).
 *
 *  1. Auflösung, erschöpfend: jede Palette × jedes Theme – jeder Untergrund trägt sich über Luft, jede Pflanze steht
 *     auf der Wiese bzw. im Beet, jede Feldfrucht auf dem Ackerland (echte Stützprüfung des Materialisierers).
 *  2. Welten: Palette × Theme × Bautyp (kleinste Größe, ein Seed) – 0 harte Verstöße. Standard reihum (jede Palette,
 *     jedes Theme und jeder Bautyp mindestens einmal, dazu die gemessenen Fälle); `MCDA_FUZZ=full` die volle Matrix.
 */
import type { Vec3 } from '@mcda/core';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { BUILDING_SIZES, FLOOR_CARRIERS, PALETTE_BLOCK_CLASS, TERRAIN_STACKED_VEGETATION, TERRAIN_SUBSOIL, type GroundClass } from '@mcda/catalog';
import { ThemeResolver, WorldView, checkSupport, mixSeed } from '@mcda/materialize';
import { Layer, VoxelVolume, blockState } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT, hangTimeout } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType } from '../src/index.js';
import { ctx, loadType } from './buildingtype-fuzz.js';

const FULL = process.env['MCDA_FUZZ'] === 'full';
const VERSION = '1.21.11';
const platform = ctx.platform(VERSION);
const PALETTES = ctx.palettes!.ids();
const THEMES = ctx.themes.ids();
const TYPES = ctx.buildingTypes.ids();

/** Harte Stütz-/Schwerkraftverstöße eines Mini-Aufbaus (Blöcke mit Standardzustand). */
function violations(blocks: ReadonlyArray<readonly [Vec3, string]>): string[] {
  const vol = VoxelVolume.create([3, 4, 3], [-1, -2, -1]);
  for (const [pos, name] of blocks) {
    const s = platform.registry.resolveState(name, {});
    vol.place(pos, { state: blockState(s.name, s.properties), owner: 't', layer: Layer.Furniture });
  }
  return checkSupport(new WorldView(vol, platform)).map((v) => `${v.block}: ${v.message}`);
}

const SEEDS = 24;
/** Oberflächen mit stehender Laterne (Terrain `lighting.ts`, `LAMP_SURFACES`). */
const LAMP_SURFACES = ['ground_grass', 'ground_yard', 'path_edge', 'paddock_ground', 'plaza_accent', 'ground_dirt'];
/** Pflanzen und worauf sie stehen (Terrain `generate`/`decor`/`mound`). */
const PLANTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['flower_wild', ['ground_grass']], ['flower_warm', ['ground_grass', 'garden_soil']], ['flower_cool', ['ground_grass', 'garden_soil']],
  ['grass_tuft', ['ground_grass', 'garden_soil', 'paddock_ground']], ['ground_cover', ['ground_grass']],
  ['crop_wheat', ['farmland']], ['crop_carrot', ['farmland']], ['crop_potato', ['farmland']], ['crop_beetroot', ['farmland']],
];
/** Blöcke einer Rolle über viele Seeds (leer, wenn das Theme die Rolle nicht kennt). */
function sampler(theme: ReturnType<typeof ctx.themes.get>): (role: string, shape?: string) => Set<string> {
  const resolver = new ThemeResolver(theme, platform.families, platform.registry);
  return (role, shape = 'block') => {
    const out = new Set<string>();
    if (theme.roles[role] === undefined) return out;
    for (let s = 1; s <= SEEDS; s++) out.add(resolver.resolve(role, shape, mixSeed(s, role)).block);
    return out;
  };
}

describe('W8-C: Klassen der festen Paletten-Blöcke (PALETTE_BLOCK_CLASS) gegen die Stützprüfung', () => {
  it('jeder feste Block einer Palette hat eine Klasse, keine Klasse ohne Palette', () => {
    const used = new Set([...ctx.palettes!].flatMap((p) => Object.values(p.roles).flatMap((r) => [
      ...r.blocks, ...(r.gradientStops ?? []).flatMap((st) => st.blocks),
    ])).flatMap((e) => (e.block !== undefined ? [e.block] : [])));
    expect([...used].filter((b) => PALETTE_BLOCK_CLASS[b] === undefined)).toEqual([]);
    expect(Object.keys(PALETTE_BLOCK_CLASS).filter((b) => !used.has(b))).toEqual([]);
  });

  // Was jede Klasse verspricht, an echten Mini-Aufbauten (Luft darunter, Blume/Laterne darauf, auf Gras bzw. Stein)
  const promise: Record<GroundClass, (b: string) => string[]> = {
    soil: (b) => [...violations([[[0, 0, 0], b]]), ...violations([[[0, -1, 0], 'dirt'], [[0, 0, 0], b], [[0, 1, 0], 'poppy']]),
      ...violations([[[0, -1, 0], 'dirt'], [[0, 0, 0], b], [[0, 1, 0], 'lantern']])],
    solid: (b) => [...violations([[[0, 0, 0], b]]), ...violations([[[0, -1, 0], 'dirt'], [[0, 0, 0], b], [[0, 1, 0], 'lantern']])],
    leaves: (b) => violations([[[0, 0, 0], b]]),
    loose: (b) => (violations([[[0, 0, 0], b]]).length > 0 && violations([[[0, -1, 0], 'dirt'], [[0, 0, 0], b]]).length === 0 ? [] : ['fällt nicht oder hält nicht']),
    flat: (b) => (violations([[[0, 0, 0], b]]).length > 0 && violations([[[0, -1, 0], 'grass_block'], [[0, 0, 0], b]]).length === 0 ? [] : ['Decklage?']),
    // Bodenpflanze: wächst auf Gras (dass sie Erde braucht, ist die vorsichtige Annahme – der tote Busch fällt in der
    // Stützprüfung nicht auf Stein durch, im Spiel braucht er Erde, Sand oder Terrakotta)
    plant: (b) => violations([[[0, -1, 0], 'grass_block'], [[0, 0, 0], b]]),
    attached: (b) => (violations([[[0, -1, 0], 'grass_block'], [[0, 0, 0], b]]).length > 0 ? [] : ['steht frei']),
    other: (b) => violations([[[0, -1, 0], 'stone'], [[0, 0, 0], b]]),
  };
  for (const cls of Object.keys(promise) as GroundClass[]) {
    it(`Klasse ${cls}`, () => {
      const bad = Object.entries(PALETTE_BLOCK_CLASS).filter(([, c]) => c === cls)
        .flatMap(([id, c]) => promise[c](id.replace(/^minecraft:/, '')).map((v) => `${id}: ${v}`));
      expect(bad).toEqual([]);
    });
  }
});

describe('W8-C: Farbwelten halten den Geländevertrag (Auflösung, jede Palette × jedes Theme)', () => {
  for (const themeId of THEMES) {
    it(`${themeId}: Untergrund trägt, Pflanzen stehen, keine Ranke frei`, () => {
      // Geprüft wird, was die Palette hinzubringt: Blöcke, die das Theme ohne Palette dort nicht hat (die Themes selbst
      // sichern `terrain/test/theme-roles.test.ts` und die Bautyp-Fuzz-Tests).
      const base = sampler(ctx.themes.get(themeId));
      const problems: string[] = [];
      for (const paletteId of PALETTES) {
        const at = sampler(ctx.themes.resolveWith(themeId, ctx.palettes!.get(paletteId)));
        const added = (role: string, shape = 'block'): Set<string> => {
          const own = base(role, shape);
          return new Set([...at(role, shape)].filter((b) => !own.has(b)));
        };
        const check = (what: string, blocks: ReadonlyArray<readonly [Vec3, string]>): void => {
          for (const v of violations(blocks)) problems.push(`${paletteId} ${what}: ${v}`);
        };
        // Untergrund und Böden über Luft (Hügel über Räumen, Burggraben, Obergeschoss)
        for (const role of [...TERRAIN_SUBSOIL, ...FLOOR_CARRIERS]) for (const b of added(role)) check(`${role}=${b}`, [[[0, 0, 0], b]]);
        // Oberfläche auf Erde trägt die stehende Laterne (Wege-/Hoflicht): kein Teppich als Boden
        for (const role of LAMP_SURFACES) for (const b of added(role)) check(`${role}=${b}`, [[[0, -1, 0], 'dirt'], [[0, 0, 0], b], [[0, 1, 0], 'lantern']]);
        // Pflanzen auf ihrem Untergrund (mindestens einer von beiden kommt aus der Palette)
        for (const [plant, carriers] of PLANTS) {
          for (const carrier of carriers) {
            const newP = added(plant);
            const newC = added(carrier);
            for (const p of at(plant)) {
              for (const c of at(carrier)) {
                if (newP.has(p) || newC.has(c)) check(`${plant}=${p} auf ${carrier}=${c}`, [[[0, -1, 0], 'dirt'], [[0, 0, 0], c], [[0, 1, 0], p]]);
              }
            }
          }
        }
        // Busch, Hecke, Obstlaub stehen frei über Luft (keine Ranke, keine Schneeschicht, kein Kies); Baumlaub: Form leaves
        for (const role of TERRAIN_STACKED_VEGETATION) {
          for (const b of added(role)) check(`${role}=${b}`, [[[0, 0, 0], b]]);
        }
        for (const role of ['leaves_oak', 'leaves_birch', 'leaves_spruce']) for (const b of added(role, 'leaves')) check(`${role}=${b}`, [[[0, 0, 0], b]]);
      }
      expect([...new Set(problems)].slice(0, 20)).toEqual([]);
    });
  }
});

const V = TARGET_VERSIONS[VERSION];
function hard(typeId: string, themeId: string, paletteId: string, seed = 2026): string[] {
  const def = loadType(typeId);
  const size = def.massing.generator === 'fixed' ? undefined : BUILDING_SIZES.find((s) => def.sizes?.[s] !== undefined);
  const res = projectFromBuildingType(def, { ...(size !== undefined ? { size } : {}), themeId, targetVersion: V, paletteId }, seed, ctx);
  const w = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
  return w.materialized.violations.filter((v) => v.kind !== 'spawn').map((v) => `${v.kind} ${v.block} ${(v.pos ?? []).join(',')}`);
}

/** Standard reihum: jede Palette einmal, Theme und Bautyp versetzt (jedes Theme und jeder Bautyp kommt vor). */
function combos(): Array<readonly [string, string, string]> {
  if (FULL) return TYPES.flatMap((t) => THEMES.flatMap((th) => PALETTES.map((p) => [t, th, p] as const)));
  const out: Array<readonly [string, string, string]> = PALETTES.map((p, i) => [TYPES[(i * 5) % TYPES.length]!, THEMES[i % THEMES.length]!, p] as const);
  // Gemessene Fälle vor dem Fix (Integrator, f7dd7313): 2 105 / 1 138 / 555 / 31 Verstöße
  out.push(['castle_compact', 'medieval', 'koenigsschloss_gold'], ['tavern', 'medieval', 'koenigsschloss_gold'], ['hobbit', 'medieval', 'ruine_bemoost'], ['castle_compact', 'nordic', 'koenigsschloss_gold']);
  return out;
}

describe(`W8-C: Farbwelten in Welten – 0 harte Verstöße (${FULL ? 'volle Matrix' : 'reihum'})`, () => {
  it('reihum deckt jede Palette, jedes Theme und jeden Bautyp ab', () => {
    const c = combos();
    expect(new Set(c.map((x) => x[0]))).toEqual(new Set(TYPES));
    expect(new Set(c.map((x) => x[1]))).toEqual(new Set(THEMES));
    expect(new Set(c.map((x) => x[2]))).toEqual(new Set(PALETTES));
  });
  const all = combos();
  const CHUNK = 6;
  for (let i = 0; i < all.length; i += CHUNK) {
    const part = all.slice(i, i + CHUNK);
    it(`${part.map(([t, th, p]) => `${t}/${th}/${p}`).join(', ')}`, { timeout: FULL ? hangTimeout(1_800_000) : HEAVY_TIMEOUT }, () => {
      for (const [t, th, p] of part) expect(hard(t, th, p).slice(0, 5), `${t} ${th} ${p}`).toEqual([]);
    });
  }
});
