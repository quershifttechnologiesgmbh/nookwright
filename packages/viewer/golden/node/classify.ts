/**
 * Goldene Galerie (P0-A), Node-Adapter: Merkmale je Blockzustand aus den Plattform-Daten des Repos (keine
 * Mojang-Assets): Physik-Klasse, Gelände/Bewuchs (Block-Tags), Licht (dieselben Regeln wie die App-Vorschau
 * „Texturen“, `packages/app/src/textures/lightRules.ts`) und Registry-Eigenschaften für deepslate.
 */
import { WorldView, emission, faceBlocksLight, isTransparentFull, type PlatformView } from '@mcda/materialize';
import { loadFamilies, loadPhysics, loadRegistry } from '@mcda/platform/node';
import { VoxelVolume } from '@mcda/voxel';
import { FACE_BIT, LIGHT_FACES } from '../../src/lighting.js';
import type { Classifier, GoldenState, StateTraits } from '../lib/grid.js';

/** Gelände und Bewuchs über Block-Tags … */
const NATURAL_TAGS = ['dirt', 'sand', 'leaves', 'flowers', 'small_flowers', 'saplings', 'replaceable_by_trees', 'replaceable', 'snow'] as const;
/** … und Namen, die kein Tag trifft. Naturstein (stone, andesite …) fehlt bewusst: Themes bauen Wände daraus. */
const NATURAL_NAMES = new Set([
  'gravel', 'water', 'lava', 'farmland', 'dirt_path', 'clay', 'mud', 'ice', 'packed_ice', 'blue_ice', 'snow_block', 'powder_snow',
  'sugar_cane', 'cactus', 'pumpkin', 'melon', 'sweet_berry_bush', 'lily_pad', 'brown_mushroom', 'red_mushroom', 'moss_carpet',
  'moss_block', 'leaf_litter', 'dead_bush', 'bush', 'firefly_bush', 'wildflowers', 'pink_petals', 'bamboo', 'cocoa', 'vine',
  'glow_lichen', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'suspicious_sand', 'suspicious_gravel', 'short_dry_grass',
  'tall_dry_grass', 'wheat', 'carrots', 'potatoes', 'beetroots', 'pumpkin_stem', 'melon_stem', 'attached_pumpkin_stem',
  'attached_melon_stem', 'big_dripleaf', 'big_dripleaf_stem', 'small_dripleaf', 'hanging_roots', 'spore_blossom', 'azalea',
  'flowering_azalea', 'mangrove_roots', 'muddy_mangrove_roots',
]);

const isGlass = (name: string): boolean => name === 'glass' || name === 'tinted_glass' || name.endsWith('_stained_glass');

/** Zeile der Licht-Tabelle: Emission, undurchsichtig, sperrende Flächen (FACE_BIT), Abschwächung, AO-Verdecker. */
export type LightRow = readonly [emission: number, opaque: 0 | 1, faces: number, attenuation: number, ao: 0 | 1];

export interface BlockInfoRow {
  readonly properties: Readonly<Record<string, readonly string[]>>;
  readonly default: Readonly<Record<string, string>>;
}

export interface NodeClassifier {
  readonly version: string;
  readonly classify: Classifier;
  lightRow(s: GoldenState): LightRow;
  blockInfo(name: string): BlockInfoRow | undefined;
}

export function nodeClassifier(version = '1.21.11'): NodeClassifier {
  const registry = loadRegistry(version);
  const platform: PlatformView = { registry, families: loadFamilies(version), physics: loadPhysics(version) };
  const view = new WorldView(VoxelVolume.create([1, 1, 1]), platform);
  const naturalTag = new Set<string>();
  for (const t of NATURAL_TAGS) for (const b of registry.blockTag(t)) naturalTag.add(b.replace(/^minecraft:/, ''));
  const mineralTag = new Set(registry.blockTag('base_stone_overworld').map((b) => b.replace(/^minecraft:/, '')));
  const memo = new Map<string, StateTraits>();
  const classify: Classifier = (s) => {
    const key = `${s.name}|${JSON.stringify(s.properties)}`;
    let hit = memo.get(key);
    if (hit === undefined) {
      const phys = view.physicsOf({ name: s.name, properties: s.properties });
      hit = { cls: phys.cls, natural: s.name !== 'air' && (naturalTag.has(s.name) || NATURAL_NAMES.has(s.name)), emits: emission({ name: s.name, properties: s.properties }) > 0, mineral: mineralTag.has(s.name) };
      memo.set(key, hit);
    }
    return hit;
  };
  return {
    version,
    classify,
    lightRow(s) {
      const st = { name: s.name, properties: s.properties };
      const phys = view.physicsOf(st);
      const opaque = phys.cls === 'full' && !isTransparentFull(s.name);
      let faces = 0;
      for (const f of LIGHT_FACES) if (faceBlocksLight(view.infoOf(st), f)) faces |= FACE_BIT[f];
      const ao = phys.cls === 'full' && !isGlass(s.name);
      return [Math.max(0, Math.min(15, Math.round(emission(st)))), opaque ? 1 : 0, faces, s.name.endsWith('_leaves') ? 1 : 0, ao ? 1 : 0];
    },
    blockInfo(name) {
      const properties = registry.listProperties(name);
      const def = registry.defaultState(name);
      return properties === undefined || def === undefined ? undefined : { properties, default: def.properties };
    },
  };
}
