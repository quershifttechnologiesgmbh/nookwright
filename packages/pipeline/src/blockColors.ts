/**
 * Flächenfarbe je Minecraft-Blockname – Grundlage für „Vorschau: Blöcke“ (App) **und** für die Wertkontrast-Kennzahl
 * P1 (`quality-p1.ts`, research/58 §4). Kleine Heuristik nach Namensbestandteilen (Holzart, Gestein, Farbstoff,
 * Metall, Lichtquelle …), eigene Farbwerte – KEINE Texturen oder Mojang-Assets (research/08 §5). Rein: keine
 * three.js-Abhängigkeit, in Node testbar. Die App re-exportiert dieses Modul unverändert.
 *
 * Reihenfolge der Regeln: unsichtbar → Lichtquelle → Farbstoff → Topf → Einzelblöcke → Metall → Holz → Gestein → Hash.
 */
import { blockFamily, hashColor, type Rgb } from './blockColorsUtil.js';

export type BlockRule = 'invisible' | 'light' | 'dye' | 'special' | 'metal' | 'wood' | 'mineral' | 'fallback';

export interface BlockLook {
  readonly color: Rgb;
  /** Leuchtet der Block (Laterne, Fackel …)? → in 3D unbeleuchtet in voller Farbe. */
  readonly glow: boolean;
  /** Welche Regel gegriffen hat (Tests: kein Katalog-Block darf auf `fallback` fallen). */
  readonly rule: BlockRule;
}

/** Lineare Mischung zweier Farben (t = 0 → a, t = 1 → b). */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const WHITE: Rgb = 0xffffff;

/** Unsichtbare Blöcke werden nicht gezeichnet. */
const INVISIBLE = new Set(['air', 'cave_air', 'void_air', 'structure_void', 'light', 'barrier']);

/** Die 16 Farbstoffe (eigene, gedeckte Werte). */
export const DYE_COLORS: Readonly<Record<string, Rgb>> = {
  white: 0xe6e8e8,
  orange: 0xe8791c,
  magenta: 0xb54bb0,
  light_blue: 0x4fa8d6,
  yellow: 0xf0c330,
  lime: 0x74b62a,
  pink: 0xe58fab,
  gray: 0x474d51,
  light_gray: 0x909089,
  cyan: 0x1f8a90,
  purple: 0x7632a6,
  blue: 0x3a3f9a,
  brown: 0x754a2c,
  green: 0x56702a,
  red: 0xa0302b,
  black: 0x1c1d22,
};
/** Längste zuerst, damit `light_blue_wool` nicht als `blue` erkannt wird. */
const DYES = Object.keys(DYE_COLORS).sort((a, b) => b.length - a.length);
const DYEABLE = /^(wool|carpet|bed|banner|wall_banner|candle|candle_cake|concrete|concrete_powder|terracotta|glazed_terracotta|stained_glass|stained_glass_pane|shulker_box)$/;
const TERRACOTTA: Rgb = 0x985e43;

/** Holzarten: Bretter- und Rindenfarbe. Längste zuerst (dark_oak/pale_oak vor oak). */
const WOOD: Readonly<Record<string, { readonly planks: Rgb; readonly bark: Rgb }>> = {
  oak: { planks: 0xa4834f, bark: 0x6d5534 },
  spruce: { planks: 0x755633, bark: 0x3d2c1a },
  birch: { planks: 0xc4b27c, bark: 0xd9d6ce },
  jungle: { planks: 0xa3754e, bark: 0x574621 },
  acacia: { planks: 0xab5c33, bark: 0x6c635a },
  dark_oak: { planks: 0x45301c, bark: 0x3a2b17 },
  mangrove: { planks: 0x783838, bark: 0x5b4b30 },
  cherry: { planks: 0xe1b4ad, bark: 0x3b2431 },
  pale_oak: { planks: 0xe2d8d2, bark: 0x6f6864 },
  bamboo: { planks: 0xc9ae56, bark: 0x7e8b30 },
  crimson: { planks: 0x6b364c, bark: 0x5d1c20 },
  warped: { planks: 0x2d6a64, bark: 0x3b3b4e },
  poplar: { planks: 0xcbbd90, bark: 0x8f8b7c },
};
const WOODS = Object.keys(WOOD).sort((a, b) => b.length - a.length);
const LEAVES: Rgb = 0x4f7b2d;

/** Lichtquellen (Name-Regel → Farbe). Laternen leuchten warm, Seelen-Varianten blau. */
const LIGHTS: ReadonlyArray<readonly [RegExp, Rgb]> = [
  [/^soul_(lantern|torch|wall_torch|campfire|fire)$/, 0x7fd9e3],
  [/^sea_lantern$/, 0xd3ebe4],
  [/^jack_o_lantern$/, 0xe39a2a],
  [/lantern$/, 0xffd27a],
  [/^redstone_(wall_)?torch$/, 0xe24a2a],
  [/torch$/, 0xffc94d],
  [/^glowstone$/, 0xf6d88c],
  [/^shroomlight$/, 0xf2a24e],
  [/froglight$/, 0xeee4b8],
  [/^end_rod$/, 0xf5efe6],
  [/^campfire$|^fire$/, 0xff9d3c],
  [/^lava$/, 0xe0661c],
  [/^redstone_lamp$/, 0xd9a15f],
  [/^beacon$/, 0x9ee6e0],
];

/** Einzelblöcke: Arbeitsblöcke, Behälter, Natur, Glas (exakte Namen). */
const SPECIAL: Readonly<Record<string, Rgb>> = {
  chest: 0xa4712f,
  trapped_chest: 0xa4712f,
  ender_chest: 0x26393b,
  barrel: 0x8a633a,
  crafting_table: 0x9c6c3f,
  furnace: 0x7a7a7a,
  smoker: 0x6d5c4b,
  blast_furnace: 0x56585f,
  smithing_table: 0x363a47,
  grindstone: 0x8f8f8f,
  stonecutter: 0x8b8b8b,
  loom: 0xbfa47c,
  cartography_table: 0x6a563f,
  fletching_table: 0xcbb982,
  lectern: 0xa97b48,
  bookshelf: 0x7c5b37,
  chiseled_bookshelf: 0x7c5b37,
  composter: 0x7b5a2d,
  brewing_stand: 0x7d6c5a,
  enchanting_table: 0x7e2b2b,
  jukebox: 0x6c4b37,
  note_block: 0x6c4b37,
  beehive: 0xc9a55a,
  cake: 0xf3e9dd,
  candle: 0xefe2c0,
  candle_cake: 0xf3e9dd,
  hay_block: 0xc5a22b,
  honeycomb_block: 0xe5a12a, // W3-BL: Ersatz für den Goldblock (Preset „Nur leicht farmbar“)
  carved_pumpkin: 0xc87a1e, // Vogelscheuche (T2, Gelände)
  scaffolding: 0xc9a764,
  ladder: 0x9c7a48,
  decorated_pot: 0x9a5a3c,
  flower_pot: 0x8c4f35,
  bone_block: 0xe3dfcb,
  redstone_block: 0xab1b09,
  lodestone: 0x8a8c90,
  glass: 0xbcdde9,
  glass_pane: 0xbcdde9,
  tinted_glass: 0x2f2a36,
  water: 0x3f76e4,
  grass_block: 0x6d9b43,
  dirt: 0x87603f,
  coarse_dirt: 0x7a573a,
  rooted_dirt: 0x8f6a4c,
  podzol: 0x5f4424,
  mud: 0x3d3a3e,
  clay: 0xa1a6b4,
  sand: 0xdcd0a0,
  red_sand: 0xb8651f,
  gravel: 0x86807d,
  snow: 0xf3f7f7,
  snow_block: 0xf3f7f7,
  ice: 0x93baf6,
  packed_ice: 0x8db4f2,
  blue_ice: 0x74a8f5,
  moss_block: 0x5b7b2f,
  moss_carpet: 0x5b7b2f,
  amethyst_block: 0x8b64c4,
  obsidian: 0x140f20,
  crying_obsidian: 0x22103a,
  tnt: 0xc23b2a,
  coal_block: 0x121212,
  magma_block: 0x8e3f1a,
  raw_iron_block: 0xa6876b,
  raw_copper_block: 0x9a6a4f,
  raw_gold_block: 0xdda92e,
  azalea: 0x667d30,
  flowering_azalea: 0x70794a,
  azalea_leaves: 0x5a7c2c,
  flowering_azalea_leaves: 0x64803a,
  mushroom_stem: 0xcbc4b9,
  brown_mushroom_block: 0x957053,
  red_mushroom_block: 0xc82e2d,
  // K3b: Würze im Braubottich, Räucherware am Haken
  honey_block: 0xf0a42a,
  dried_kelp_block: 0x3a4028,
  hanging_roots: 0xa27a5c,
  pale_hanging_moss: 0x6f7a69,
  poppy: 0xc2252a,
  red_tulip: 0xd0402f,
  spore_blossom: 0xcf6aa6,
  // Farn/Gras: Biom-Grün (Plains) statt der grauen Graustufen-Textur
  fern: 0x5f8f3a,
  short_grass: 0x6a9a3c,
  // K3d: Hebel (Spülen-Hahn), Beet-Blumen (Theme-Mischungen flower_warm/flower_cool), Busch (grass_tuft)
  lever: 0x6e6252,
  dandelion: 0xf2d83a,
  orange_tulip: 0xe8792c,
  pink_tulip: 0xeaa3c0,
  white_tulip: 0xe8ece6,
  torchflower: 0xe99a3a,
  lily_of_the_valley: 0xf1f1e8,
  azure_bluet: 0xd6e2ea,
  allium: 0xb07ad8,
  cornflower: 0x4a6fd6,
  oxeye_daisy: 0xeae8d8,
  bush: 0x5e8a36,
  // K3a: Zielscheibe, Amethyst-Cluster, Spinnweben, Mob-Köpfe (stehend und an der Wand), Schwarzstein-Ziegel
  melon: 0x7ba428,
  red_mushroom: 0xc0392b,
  brown_mushroom: 0x9c7554,
  crafter: 0x6f5a45,
  target: 0xdcc8b4,
  amethyst_cluster: 0xa47fd6,
  cobweb: 0xdcdcdc,
  skeleton_skull: 0xc9c7bd,
  skeleton_wall_skull: 0xc9c7bd,
  wither_skeleton_skull: 0x2b2b2b,
  wither_skeleton_wall_skull: 0x2b2b2b,
  zombie_head: 0x4a7a55,
  zombie_wall_head: 0x4a7a55,
  creeper_head: 0x4d9a3a,
  creeper_wall_head: 0x4d9a3a,
  dragon_head: 0x1f1b24,
  dragon_wall_head: 0x1f1b24,
  polished_blackstone_bricks: 0x2f2a31,
  polished_blackstone_brick_wall: 0x2f2a31,
};

/** Metalle (exakt oder als Bestandteil); Kupfer nach Oxidationsstufe. */
const METALS: ReadonlyArray<readonly [RegExp, Rgb]> = [
  [/^(iron_)?chain$/, 0x3d424a],
  [/^iron_bars$/, 0x8c9095],
  [/^iron_block$/, 0xd8d8d8],
  [/^iron_(door|trapdoor)$/, 0xc2c2c2],
  [/^heavy_weighted_pressure_plate$/, 0xc8c8c8],
  [/anvil$/, 0x46494e],
  [/^water_cauldron$/, 0x4a6aa8],
  [/cauldron$/, 0x3c3c41],
  [/^hopper$/, 0x3f3f44],
  [/^(gold_block|light_weighted_pressure_plate|bell)$/, 0xe8c547],
  [/^netherite_block$/, 0x433e40],
  [/oxidized_.*copper|copper.*oxidized/, 0x55a283],
  [/weathered_.*copper|copper.*weathered/, 0x6c9b7c],
  [/exposed_.*copper|copper.*exposed/, 0xa87e68],
  [/copper|lightning_rod/, 0xc26d4d],
];

/** Gestein: Namensbestandteil → Farbe. Reihenfolge = Priorität (spezifisch vor allgemein, `stone` zuletzt). */
const MINERALS: ReadonlyArray<readonly [string, Rgb]> = [
  ['mossy_stone_brick', 0x6e7a5f],
  ['mossy_cobblestone', 0x657056],
  ['cracked_stone_brick', 0x767676],
  ['chiseled_stone_brick', 0x7b7b7b],
  ['stone_brick', 0x7d7d7d],
  ['cobbled_deepslate', 0x515156],
  ['deepslate_tile', 0x393a3e],
  ['deepslate_brick', 0x46474a],
  ['deepslate', 0x4c4c51],
  ['blackstone', 0x322d34],
  ['smooth_stone', 0x9f9f9f],
  ['cobblestone', 0x777777],
  ['andesite', 0x898989],
  ['diorite', 0xbebdbe],
  ['granite', 0x97685a],
  ['calcite', 0xe0e0dc],
  ['tuff', 0x6d6e67],
  ['dripstone', 0x86705e],
  ['quartz', 0xece6df],
  ['red_sandstone', 0xb8641f],
  ['sandstone', 0xdacd9d],
  ['packed_mud', 0x8e6b50],
  ['mud_brick', 0x8a6a50],
  ['red_nether_brick', 0x480a0c],
  ['nether_brick', 0x2d161a],
  ['netherrack', 0x6e3533],
  ['end_stone', 0xdcdf9f],
  ['purpur', 0xa87da8],
  ['dark_prismarine', 0x345c4c],
  ['prismarine', 0x62a495],
  ['basalt', 0x515257],
  ['terracotta', TERRACOTTA],
  ['brick', 0x985f4f],
  ['stone', 0x7f7f7f],
];

const look = (color: Rgb, rule: BlockRule, glow = false): BlockLook => ({ color, glow, rule });

/** Farbe und Leuchten eines Blocks aus seinem Namen (mit oder ohne Namensraum). */
export function blockLook(blockId: string): BlockLook {
  const name = blockFamily(blockId);
  if (INVISIBLE.has(name)) return look(0, 'invisible');

  for (const [re, c] of LIGHTS) if (re.test(name)) return look(c, 'light', true);

  for (const dye of DYES) {
    if (!name.startsWith(`${dye}_`)) continue;
    const rest = name.slice(dye.length + 1);
    if (!DYEABLE.test(rest)) break;
    const c = DYE_COLORS[dye]!;
    if (rest.startsWith('stained_glass')) return look(mix(c, WHITE, 0.35), 'dye');
    if (rest.endsWith('terracotta')) return look(mix(c, TERRACOTTA, 0.45), 'dye');
    if (rest === 'concrete_powder') return look(mix(c, WHITE, 0.15), 'dye');
    return look(c, 'dye');
  }

  if (name.startsWith('potted_')) return look(SPECIAL['flower_pot']!, 'special');
  const special = SPECIAL[name];
  if (special !== undefined) return look(special, 'special');

  for (const [re, c] of METALS) if (re.test(name)) return look(c, 'metal');

  const stripped = name.startsWith('stripped_');
  const bare = stripped ? name.slice('stripped_'.length) : name;
  for (const sp of WOODS) {
    if (!bare.startsWith(`${sp}_`)) continue;
    const w = WOOD[sp]!;
    const rest = bare.slice(sp.length + 1);
    if (rest === 'leaves') return look(sp === 'cherry' ? 0xe8a8c8 : LEAVES, 'wood');
    if (/^(log|wood|stem|hyphae|roots)$/.test(rest)) return look(stripped ? mix(w.planks, WHITE, 0.08) : w.bark, 'wood');
    return look(w.planks, 'wood');
  }

  for (const [part, c] of MINERALS) if (name.includes(part)) return look(c, 'mineral');

  return look(hashColor(`block:${name}`, 0.2, 0.5), 'fallback');
}
