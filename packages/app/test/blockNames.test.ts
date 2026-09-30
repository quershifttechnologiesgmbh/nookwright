/**
 * W4-D: deutsche Blocknamen im Tab „Material“ (eigene Zuordnung, nichts aus den Spiel-Assets). Die Liste unten sind
 * alle Gegenstände der Materialliste aus 12 Bautypen × 12 Themes mit Gelände (Engine building_generate, Seed 5) –
 * jeder davon hat einen deutschen Namen.
 */
import { describe, expect, it } from 'vitest';
import { blockName, germanBlockName } from '../src/ui/blockNames.js';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { worldOf } from '../src/exporting.js';
import { materialView } from '../src/ui/materialRows.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const USED = [
    'acacia_button', 'acacia_door', 'acacia_fence', 'acacia_fence_gate', 'acacia_hanging_sign', 'acacia_leaves',
    'acacia_log', 'acacia_planks', 'acacia_pressure_plate', 'acacia_sign', 'acacia_slab', 'acacia_stairs',
    'acacia_trapdoor', 'acacia_wood', 'allium', 'andesite', 'andesite_stairs', 'anvil', 'azalea_leaves',
    'azure_bluet', 'bamboo_block', 'bamboo_mosaic', 'bamboo_mosaic_slab', 'bamboo_mosaic_stairs', 'barrel', 'basalt',
    'beehive', 'beetroots', 'birch_door', 'birch_fence', 'birch_fence_gate', 'birch_hanging_sign', 'birch_leaves',
    'birch_log', 'birch_planks', 'birch_pressure_plate', 'birch_slab', 'birch_stairs', 'birch_trapdoor', 'birch_wood',
    'blackstone', 'blackstone_wall', 'blast_furnace', 'blue_banner', 'blue_bed', 'blue_carpet', 'blue_orchid',
    'blue_terracotta', 'blue_wool', 'bookshelf', 'brewing_stand', 'brick_slab', 'brick_stairs', 'brick_wall',
    'bricks', 'brown_banner', 'brown_bed', 'brown_carpet', 'brown_wool', 'bush', 'cactus', 'cake', 'calcite',
    'campfire', 'candle', 'carrots', 'carved_pumpkin', 'cauldron', 'chest', 'chipped_anvil', 'chiseled_bookshelf',
    'chiseled_red_sandstone', 'chiseled_stone_bricks', 'clay', 'coal_block', 'coarse_dirt', 'cobbled_deepslate',
    'cobbled_deepslate_slab', 'cobbled_deepslate_stairs', 'cobblestone', 'cobblestone_slab', 'cobblestone_stairs',
    'cobblestone_wall', 'cobweb', 'composter', 'copper_bars', 'copper_chain', 'copper_lantern', 'copper_torch',
    'cornflower', 'cracked_deepslate_bricks', 'cracked_deepslate_tiles', 'cracked_polished_blackstone_bricks',
    'cracked_stone_bricks', 'crafter', 'crafting_table', 'creeper_head', 'cut_sandstone', 'dandelion',
    'dark_oak_button', 'dark_oak_door', 'dark_oak_fence', 'dark_oak_fence_gate', 'dark_oak_hanging_sign',
    'dark_oak_leaves', 'dark_oak_log', 'dark_oak_planks', 'dark_oak_pressure_plate', 'dark_oak_sign', 'dark_oak_slab',
    'dark_oak_stairs', 'dark_oak_trapdoor', 'dark_oak_wood', 'dark_prismarine', 'dead_bush', 'decorated_pot',
    'deepslate', 'deepslate_brick_stairs', 'deepslate_bricks', 'deepslate_tile_slab', 'deepslate_tile_stairs',
    'deepslate_tiles', 'diorite', 'dirt', 'dirt_path', 'ender_chest', 'exposed_copper', 'exposed_cut_copper_stairs',
    'farmland', 'fern', 'flower_pot', 'flowering_azalea_leaves', 'furnace', 'glass', 'glass_pane', 'glowstone',
    'gold_block', 'grass_block', 'gravel', 'gray_banner', 'gray_bed', 'gray_carpet', 'gray_stained_glass_pane',
    'green_banner', 'green_bed', 'green_carpet', 'green_wool', 'grindstone', 'hanging_roots', 'hay_block',
    'honey_block', 'iron_bars', 'iron_chain', 'jack_o_lantern', 'jukebox', 'jungle_button', 'jungle_door',
    'jungle_fence', 'jungle_fence_gate', 'jungle_hanging_sign', 'jungle_leaves', 'jungle_log', 'jungle_planks',
    'jungle_pressure_plate', 'jungle_sign', 'jungle_slab', 'jungle_stairs', 'jungle_trapdoor', 'jungle_wood',
    'ladder', 'lantern', 'leaf_litter', 'lectern', 'light_blue_bed', 'light_blue_carpet',
    'light_blue_stained_glass_pane', 'light_blue_wool', 'light_gray_carpet', 'light_gray_terracotta',
    'lily_of_the_valley', 'lime_candle', 'lime_carpet', 'lime_terracotta', 'loom', 'melon', 'moss_block',
    'moss_carpet', 'mossy_cobblestone', 'mossy_cobblestone_stairs', 'mossy_cobblestone_wall',
    'mossy_stone_brick_stairs', 'mossy_stone_bricks', 'mud', 'mud_bricks', 'mushroom_stem', 'note_block',
    'oak_button', 'oak_door', 'oak_fence', 'oak_fence_gate', 'oak_hanging_sign', 'oak_leaves', 'oak_log',
    'oak_planks', 'oak_pressure_plate', 'oak_sign', 'oak_slab', 'oak_stairs', 'oak_trapdoor', 'oak_wood',
    'orange_banner', 'orange_bed', 'orange_carpet', 'orange_tulip', 'oxeye_daisy', 'oxidized_copper',
    'oxidized_cut_copper_slab', 'oxidized_cut_copper_stairs', 'packed_ice', 'packed_mud', 'pale_hanging_moss',
    'pale_oak_log', 'pale_oak_stairs', 'pale_oak_trapdoor', 'pink_candle', 'pink_petals', 'pink_tulip', 'podzol',
    'polished_andesite', 'polished_andesite_stairs', 'polished_blackstone_brick_slab',
    'polished_blackstone_brick_stairs', 'polished_blackstone_brick_wall', 'polished_blackstone_bricks',
    'polished_deepslate', 'polished_granite', 'polished_tuff', 'polished_tuff_stairs', 'poppy', 'potatoes',
    'prismarine', 'prismarine_brick_stairs', 'prismarine_bricks', 'quartz_block', 'quartz_pillar', 'raw_gold_block',
    'raw_iron_block', 'red_banner', 'red_bed', 'red_carpet', 'red_sand', 'red_sandstone', 'red_sandstone_stairs',
    'red_terracotta', 'red_tulip', 'red_wool', 'rooted_dirt', 'sand', 'sandstone', 'sandstone_stairs', 'short_grass',
    'shroomlight', 'skeleton_skull', 'smithing_table', 'smoker', 'smooth_quartz', 'smooth_quartz_stairs',
    'smooth_sandstone', 'smooth_sandstone_slab', 'smooth_sandstone_stairs', 'smooth_stone', 'snow', 'snow_block',
    'spore_blossom', 'spruce_door', 'spruce_fence', 'spruce_fence_gate', 'spruce_hanging_sign', 'spruce_leaves',
    'spruce_log', 'spruce_planks', 'spruce_pressure_plate', 'spruce_slab', 'spruce_stairs', 'spruce_trapdoor',
    'spruce_wood', 'stone', 'stone_brick_slab', 'stone_brick_stairs', 'stone_brick_wall', 'stone_bricks',
    'stripped_acacia_log', 'stripped_acacia_wood', 'stripped_birch_log', 'stripped_birch_wood',
    'stripped_dark_oak_log', 'stripped_dark_oak_wood', 'stripped_jungle_log', 'stripped_jungle_wood',
    'stripped_oak_log', 'stripped_oak_wood', 'stripped_spruce_log', 'stripped_spruce_wood', 'sugar_cane',
    'terracotta', 'tinted_glass', 'torch', 'torchflower', 'tuff', 'tuff_brick_stairs', 'tuff_bricks',
    'waxed_copper_bars', 'waxed_copper_chain', 'waxed_copper_lantern', 'waxed_copper_trapdoor', 'weathered_copper',
    'weathered_cut_copper_slab', 'weathered_cut_copper_stairs', 'wheat', 'white_banner', 'white_bed', 'white_candle',
    'white_carpet', 'white_terracotta', 'white_tulip', 'white_wool', 'wildflowers', 'yellow_banner', 'yellow_bed',
    'yellow_candle', 'yellow_carpet', 'yellow_terracotta', 'yellow_wool', 'zombie_head',
];

describe('deutsche Blocknamen', () => {
  it('jeder verwendete Gegenstand hat einen Namen, ohne Unterstrich und ohne Doppel', () => {
    const missing = USED.filter((id) => germanBlockName(id) === undefined);
    expect(missing).toEqual([]);
    for (const id of USED) expect(germanBlockName(id), id).not.toMatch(/_|undefined|^\s|\s$|\s\s/);
    const byName = new Map<string, string[]>();
    for (const id of USED) byName.set(germanBlockName(id)!, [...(byName.get(germanBlockName(id)!) ?? []), id]);
    // quartz_block und smooth_quartz heißen verschieden; Doppel wären Verwechslungen im Tab
    expect([...byName].filter(([, v]) => v.length > 1)).toEqual([]);
  });

  it('Wortbildung: Holzart + Form, Eigenschaft + Material + Form, Farbe + Gegenstand', () => {
    expect(germanBlockName('stone_bricks')).toBe('Steinziegel');
    expect(germanBlockName('minecraft:spruce_stairs')).toBe('Fichtenholztreppe');
    expect(germanBlockName('stripped_spruce_log')).toBe('Entrindeter Fichtenstamm');
    expect(germanBlockName('stripped_oak_wood')).toBe('Entrindetes Eichenholz');
    expect(germanBlockName('mossy_cobblestone')).toBe('Bemooster Bruchstein');
    expect(germanBlockName('mossy_cobblestone_stairs')).toBe('Bemooste Bruchsteintreppe');
    expect(germanBlockName('stone_brick_wall')).toBe('Steinziegelmauer');
    expect(germanBlockName('brick_slab')).toBe('Ziegelstufe');
    expect(germanBlockName('cracked_polished_blackstone_bricks')).toBe('Rissige polierte Schwarzsteinziegel');
    expect(germanBlockName('weathered_cut_copper_stairs')).toBe('Verwitterte geschnittene Kupfertreppe');
    expect(germanBlockName('light_blue_stained_glass_pane')).toBe('Hellblaue Glasscheibe');
    expect(germanBlockName('white_bed')).toBe('Weißes Bett');
    expect(germanBlockName('red_carpet')).toBe('Roter Teppich');
    expect(germanBlockName('pink_tulip')).toBe('Rosa Tulpe');
    expect(germanBlockName('dark_prismarine')).toBe('Dunkler Prismarin');
    expect(germanBlockName('dark_oak_hanging_sign')).toBe('Schwarzeichenholzhängeschild');
    expect(germanBlockName('unknown_block_xyz')).toBeUndefined();
    expect(blockName('unknown_block_xyz')).toBe('unknown block xyz');
  });

  it('Suche im Tab findet auch deutsche Namen', async () => {
    const load = loadBundledCatalog();
    const ctx = await browserContext(load)!.ready('1.21.11');
    const s = sampleSession(load.catalog!);
    const world = worldOf(s.project, ctx, uc.shellStyle(s));
    const v = materialView(world, undefined, 'house', 'treppe', 50);
    expect(v.rows.length).toBeGreaterThan(0);
    expect(v.rows.every((r) => r.item.endsWith('_stairs'))).toBe(true);
    expect(materialView(world, undefined, 'house', 'stairs', 50).rows).toEqual(v.rows);
  });
});
