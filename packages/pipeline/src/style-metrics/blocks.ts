/**
 * Blockklassen der Stil-Kennzahlen (LV-1…LV-23, KM1…KM9): reine Namensfunktionen ohne Katalog und ohne I/O.
 * Zweck: Blocknamen in Familien (Holzart, Steinton), Gruppen (Stein, Holz, Natur …) und Formen (Vollblock,
 * Verwitterung) einteilen, damit die Messungen über Themes hinweg vergleichbar sind.
 */
import { blockLightness } from '../quality-p1.js';
import { DYE_COLORS } from '../blockColors.js';
import { isFullBlock } from '../quality-f.js';

export { blockLightness, isFullBlock };

/** Holzarten; längere Namen zuerst (`dark_oak` vor `oak`, `pale_oak` vor `oak`). */
const WOODS = ['dark_oak', 'pale_oak', 'oak', 'spruce', 'birch', 'jungle', 'acacia', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped'] as const;

const strip = (name: string): string => (name.startsWith('stripped_') ? name.slice('stripped_'.length) : name);

/** Holzart eines Blocks (Planken, Stamm, Treppe, Zaun, Tür …) oder `undefined`. */
export function woodOf(name: string): string | undefined {
  const bare = strip(name);
  for (const w of WOODS) if (bare.startsWith(`${w}_`)) return w;
  return undefined;
}

/** Steintöne (LV-7): Schlüsselwort → Familie. Reihenfolge zählt (spezifisch vor allgemein). */
const STONES: ReadonlyArray<readonly [RegExp, string]> = [
  [/deepslate/, 'deepslate'],
  [/blackstone/, 'blackstone'],
  [/^(mossy_)?cobblestone|^cobbled_/, 'cobblestone'],
  [/andesite/, 'andesite'],
  [/granite/, 'granite'],
  [/diorite/, 'diorite'],
  [/tuff/, 'tuff'],
  [/calcite/, 'calcite'],
  [/red_sandstone/, 'red_sandstone'],
  [/sandstone/, 'sandstone'],
  [/mud_brick|packed_mud/, 'mud_bricks'],
  [/^(nether_)?brick|^red_nether_brick|^bricks?(_|$)/, 'bricks'],
  [/quartz/, 'quartz'],
  [/prismarine/, 'prismarine'],
  [/basalt/, 'basalt'],
  [/end_stone/, 'end_stone'],
  [/purpur/, 'purpur'],
  [/^(mossy_|cracked_|chiseled_|smooth_|polished_)?stone(_brick|_bricks)?(_|$)|^smooth_stone|^stone$/, 'stone'],
  [/terracotta/, 'terracotta'],
  [/concrete/, 'concrete'],
];

/** Steinfamilie (`stone`, `andesite` …) oder `undefined` für Nicht-Stein. */
export function stoneOf(name: string): string | undefined {
  if (woodOf(name) !== undefined) return undefined;
  for (const [re, fam] of STONES) if (re.test(name)) return fam;
  return undefined;
}

/** Einfärbbare Blöcke: Farbstoff-Präfix und Rest. */
const DYES = Object.keys(DYE_COLORS).sort((a, b) => b.length - a.length);
const DYEABLE = /^(wool|carpet|terracotta|glazed_terracotta|concrete|concrete_powder|stained_glass|stained_glass_pane|banner|wall_banner|bed|candle|candle_cake|shulker_box)$/;

/** Farbstoff eines gefärbten Blocks (`red_wool` → `red`), sonst `undefined`. */
export function dyeOf(name: string): string | undefined {
  for (const d of DYES) {
    if (!name.startsWith(`${d}_`)) continue;
    return DYEABLE.test(name.slice(d.length + 1)) ? d : undefined;
  }
  return undefined;
}

/** Natur: Erde, Bewuchs, Laub, Blumen, Nutzpflanzen, Schnee. Kein Kies, kein Sand (die zählen als Boden-Härte). */
const NATURE =
  /^(grass_block|dirt|coarse_dirt|podzol|mycelium|rooted_dirt|moss_block|moss_carpet|mud|farmland|grass|short_grass|tall_grass|fern|large_fern|dead_bush|vine|glow_lichen|sweet_berry_bush|azalea|flowering_azalea|spore_blossom|big_dripleaf|small_dripleaf|hanging_roots|seagrass|tall_seagrass|kelp|lily_pad|sugar_cane|bamboo|cactus|snow|snow_block|powder_snow|poppy|dandelion|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|pink_petals|rose_bush|peony|lilac|sunflower|wheat|carrots|potatoes|beetroots|melon_stem|pumpkin_stem|attached_melon_stem|attached_pumpkin_stem|pumpkin|melon|cave_vines|cave_vines_plant|weeping_vines|twisting_vines|brown_mushroom|red_mushroom|bush|leaf_litter|wildflowers|firefly_bush|cactus_flower)$|_leaves$|_sapling$|^potted_/;

/** Naturblock (Erde, Bewuchs, Laub, Blumen …). */
export function isNature(name: string): boolean {
  return NATURE.test(name);
}

/** Pflanzen und Bewuchs, die AN Wänden hängen oder Wände überwachsen (LV-16). */
const CLIMBER =
  /^(vine|glow_lichen|moss_carpet|moss_block|cave_vines|cave_vines_plant|weeping_vines|twisting_vines|azalea|flowering_azalea|hanging_roots|sweet_berry_bush|bush|leaf_litter)$|_leaves$/;
export function isClimber(name: string): boolean {
  return CLIMBER.test(name);
}

/** Bodenblöcke, die im Gelände als natürliche Übergänge gelten (LV-15). */
export const TRANSITION_GROUND: ReadonlySet<string> = new Set([
  'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'rooted_dirt', 'moss_block', 'mud', 'gravel', 'sand', 'red_sand', 'snow_block',
  'snow', 'clay', 'farmland', 'dirt_path',
]);

/** Verwitterungsblöcke: bemoost oder gerissen (LV-8). */
export function isWeathered(name: string): boolean {
  return /^(mossy_|cracked_|infested_)|moss_block$|^vine$|^glow_lichen$|^moss_carpet$/.test(name);
}

/** Nicht-Materialblöcke: Glas, Türen, Beleuchtung, Schilder, Möbel – zählen nicht zu den Wandmaterialien (LV-6). */
const NON_MATERIAL =
  /(glass|_pane|_door|_trapdoor|lantern|torch|banner|_sign|candle|_bars|ladder|_button|pressure_plate|_head|flower_pot|^chain$|_carpet$|_bed$|^chest$|^barrel$|^bell$|lever|hopper|^cake$|^anvil$|_fence|_fence_gate|^lightning_rod$|^end_rod$|^campfire$|^soul_campfire$|^decorated_pot$|skull|^bookshelf$|^chiseled_bookshelf$|^lectern$|^loom$|^grindstone$)/;

/** Baumaterial (Wandfüllung, Rahmen, Sockel) im Gegensatz zu Glas, Türen, Licht, Möbeln. */
export function isMaterial(name: string): boolean {
  return !NON_MATERIAL.test(name) && name !== 'air';
}

/** Lichtquelle (LV-22): der Block gibt Licht ab. */
const LIGHT =
  /(lantern|torch$|candle$|campfire|glowstone|sea_lantern|shroomlight|froglight|end_rod|jack_o_lantern|redstone_lamp|beacon|^fire$|^soul_fire$)/;
export function isLightSource(name: string): boolean {
  return LIGHT.test(name) && !/cake/.test(name);
}

/** Freie Fackel (kein Träger): Fackeln aller Art. */
export function isTorch(name: string): boolean {
  return /torch$/.test(name);
}

/**
 * Materialfamilie eines Blocks für KM1/KM5/KM6: Holz → Holzart, Stein → Steinton, gefärbte Blöcke → `dye:<farbe>`,
 * sonst der Name ohne Formen- und Verwitterungs-Teile (`mossy_stone_brick_stairs` → `stone`, `oak_log` → `oak`).
 */
export function materialFamily(name: string): string {
  const w = woodOf(name);
  if (w !== undefined) return w;
  const s = stoneOf(name);
  if (s !== undefined) return s;
  const d = dyeOf(name);
  if (d !== undefined) return `dye:${d}`;
  return name
    .replace(/^(mossy_|cracked_|chiseled_|polished_|smooth_|cut_|waxed_|weathered_|exposed_|oxidized_)+/, '')
    .replace(/(_stairs|_slab|_wall|_block|_fence_gate|_fence|_pane)$/, '');
}

/** Familiengruppe: Grobklasse für Kohärenz- und Terrainmessungen. */
export type BlockGroup = 'wood' | 'stone' | 'dye' | 'nature' | 'glass' | 'light' | 'metal' | 'other';
export function groupOf(name: string): BlockGroup {
  if (isNature(name)) return 'nature';
  if (woodOf(name) !== undefined) return 'wood';
  if (stoneOf(name) !== undefined) return 'stone';
  if (dyeOf(name) !== undefined) return 'dye';
  if (/glass|_pane$/.test(name)) return 'glass';
  if (isLightSource(name)) return 'light';
  if (/^(iron|copper|gold|chain|cut_copper|lightning|anvil|bell|cauldron|hopper)/.test(name)) return 'metal';
  return 'other';
}

/** Holz-Vollblock als Balken/Stamm (Stamm, entrindet, Holz). */
export function isLogLike(name: string): boolean {
  return /(_log|_wood|_stem|_hyphae|^bamboo_block)$/.test(name);
}

/** Farbton (0–360°) eines Farbstoffs aus `DYE_COLORS` in OKLab (a/b); Graustufen haben keinen. */
export function dyeHue(dye: string): number | undefined {
  const rgb = DYE_COLORS[dye];
  if (rgb === undefined) return undefined;
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const r = lin(((rgb >> 16) & 0xff) / 255), g = lin(((rgb >> 8) & 0xff) / 255), b = lin((rgb & 0xff) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  if (Math.hypot(a, bb) < 0.03) return undefined;
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}

/**
 * Weiche Fassaden-Zutat: Bewuchs, Beleuchtung, Schilder, Banner, Knöpfe – liegt an der Wand, gibt ihr aber kein Relief
 * (zählt bei LV-1/LV-4 nicht als Vorsprung).
 */
const SOFT_DECOR =
  /(lantern|torch$|_sign$|_banner$|candle$|_button$|^lever$|^ladder$|_head$|_skull$|flower_pot|^chain$|^end_rod$|^tripwire_hook$|^item_frame$|^painting$|_carpet$|^cobweb$|^bell$)/;
export function isSoftDecor(name: string): boolean {
  return isNature(name) || SOFT_DECOR.test(name);
}

/** Grundblock ohne Verwitterung und Form: `mossy_stone_brick_stairs` und `stone_bricks` sind beide `stone_bricks`. */
export function baseBlock(name: string): string {
  const n = name
    .replace(/^(mossy_|cracked_|infested_|waxed_|weathered_|exposed_|oxidized_)+/, '')
    .replace(/_(stairs|slab|wall)$/, '')
    .replace(/^stone_brick$/, 'stone_bricks')
    .replace(/^(.*)_brick$/, '$1_bricks');
  return n;
}
