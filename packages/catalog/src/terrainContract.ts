/**
 * Geländevertrag beim Umfärben (W8-C, 27.09.2026): Welche Paletten-Einträge darf eine **Geländerolle** tragen?
 *
 * Themes ordnen über `paletteRoleMap` auch Geländerollen den Paletten-Rollen `floor` und `foliage` zu (Wiese, Weg,
 * Untergrund, Blumen). Der Formvertrag (`SHELL_ROLE_SHAPES`) kennt diese Rollen nicht, deshalb kamen Teppich, Kies
 * und Ranken der Paletten ungefiltert ins Gelände: Teppich und Kies über Luft (Hügel über Räumen, Burggraben),
 * Blumen auf Brettern oder Teppich, Ranken frei im Gras – harte Stütz-/Schwerkraftverstöße.
 *
 * Der Vertrag ist bewusst **physikalisch und minimal**: Ein Eintrag fällt nur heraus, wenn er an dieser Stelle
 * einen harten Verstoß erzeugen kann. Bleibt nichts übrig, behält die Rolle die Blöcke des Themes (wie beim
 * Formvertrag). Paletten, deren Einträge den Vertrag erfüllen, färben das Gelände unverändert.
 *
 * Feste Blöcke der Paletten stehen mit ihrer Klasse in `PALETTE_BLOCK_CLASS` (Minecraft-Namen wie in den Paletten
 * selbst; `@mcda/catalog` darf nicht von `@mcda/platform` abhängen). Ein Test in `packages/materialize` prüft jede
 * Klasse gegen die echte Stütz-/Schwerkraftprüfung, ein Test im Katalog, dass jeder feste Paletten-Block eine hat.
 */
import type { ThemeMixEntry } from './theme.js';

/**
 * Klasse eines Blocks für das Gelände:
 *  - `soil`: Erde-artig (Pflanzen wachsen darauf), trägt sich selbst, fällt nicht;
 *  - `solid`: voller Block, fällt nicht, braucht keine Stütze – trägt Teppich, Laterne, Pilz, nicht aber Blumen;
 *  - `leaves`: Laub (frei stehend, keine Stütze), kein Untergrund;
 *  - `loose`: fällt (Kies) – nur, wo immer Erde darunter liegt;
 *  - `flat`: Decklage (Teppich, Schneeschicht, Leuchtflechte) – braucht einen Block darunter;
 *  - `plant`: Bodenpflanze (Gras, toter Busch) – braucht Erde darunter;
 *  - `attached`: hängt an Flächen (Ranke) – steht nie frei;
 *  - `other`: steht auf jedem vollen Block (Kaktus, Pilz, Fackel, Lagerfeuer, Seetang …), kein Untergrund.
 */
export type GroundClass = 'soil' | 'solid' | 'leaves' | 'loose' | 'flat' | 'plant' | 'attached' | 'other';

/** Klasse jedes festen Blocks, den eine Palette nennt (Test: vollständig und gegen die Physikprüfung). */
export const PALETTE_BLOCK_CLASS: Readonly<Record<string, GroundClass>> = {
  'minecraft:coarse_dirt': 'soil',
  'minecraft:dirt': 'soil',
  'minecraft:podzol': 'soil',
  // Schlamm: Kollision 14/16 – trägt nach der Stützprüfung weder Laterne noch Laubstreu, deshalb kein Untergrund
  'minecraft:mud': 'other',
  'minecraft:amethyst_cluster': 'other',
  'minecraft:blue_ice': 'solid',
  'minecraft:bookshelf': 'solid',
  'minecraft:brown_mushroom_block': 'solid',
  'minecraft:brown_terracotta': 'solid',
  'minecraft:chiseled_bookshelf': 'solid',
  'minecraft:cyan_terracotta': 'solid',
  'minecraft:diamond_block': 'solid',
  'minecraft:glowstone': 'solid',
  'minecraft:gray_concrete': 'solid',
  'minecraft:hay_block': 'solid',
  'minecraft:light_blue_terracotta': 'solid',
  'minecraft:light_gray_concrete': 'solid',
  'minecraft:magma_block': 'solid',
  'minecraft:mangrove_roots': 'solid',
  'minecraft:mushroom_stem': 'solid',
  'minecraft:orange_terracotta': 'solid',
  'minecraft:packed_ice': 'solid',
  'minecraft:pearlescent_froglight': 'solid',
  'minecraft:pink_terracotta': 'solid',
  'minecraft:pink_wool': 'solid',
  'minecraft:purple_terracotta': 'solid',
  'minecraft:red_mushroom_block': 'solid',
  'minecraft:red_terracotta': 'solid',
  'minecraft:sea_lantern': 'solid',
  'minecraft:shroomlight': 'solid',
  'minecraft:snow_block': 'solid',
  'minecraft:white_concrete': 'solid',
  'minecraft:white_terracotta': 'solid',
  'minecraft:azalea_leaves': 'leaves',
  'minecraft:flowering_azalea_leaves': 'leaves',
  'minecraft:gravel': 'loose',
  'minecraft:glow_lichen': 'flat',
  'minecraft:purple_carpet': 'flat',
  'minecraft:red_carpet': 'flat',
  'minecraft:snow': 'flat',
  'minecraft:white_carpet': 'flat',
  'minecraft:dead_bush': 'plant',
  'minecraft:short_grass': 'plant',
  'minecraft:vine': 'attached',
  'minecraft:brown_mushroom': 'other',
  'minecraft:cactus': 'other',
  'minecraft:campfire': 'other',
  'minecraft:end_rod': 'other',
  'minecraft:kelp': 'other',
  'minecraft:powder_snow': 'other',
  'minecraft:red_mushroom': 'other',
  'minecraft:sea_pickle': 'other',
  'minecraft:soul_lantern': 'other',
  'minecraft:soul_torch': 'other',
  'minecraft:torch': 'other',
};

/** Familien, deren Vollblock Erde-artig ist (`moss_block`, `pale_moss_block`); alle anderen Paletten-Familien: `solid`. */
const SOIL_FAMILIES: ReadonlySet<string> = new Set(['moss', 'pale_moss']);

/** Klasse eines (übersetzten) Paletten-Eintrags. Unbekannte feste Blöcke gelten vorsichtig als `other`. */
export function groundClassOf(e: ThemeMixEntry): GroundClass {
  if (e.block !== undefined) return PALETTE_BLOCK_CLASS[e.block] ?? 'other';
  return e.variant === undefined && e.family !== undefined && SOIL_FAMILIES.has(e.family) ? 'soil' : 'solid';
}

/** Pflanzen-Rollen auf der Wiese bzw. im Beet (Terrain `decor`/`generate`/`mound`). */
export const TERRAIN_PLANT_ROLES = ['flower_wild', 'flower_warm', 'flower_cool', 'grass_tuft', 'ground_cover'] as const;
/** Feldfrüchte (auf `farmland`). */
export const TERRAIN_CROP_ROLES = ['crop_wheat', 'crop_carrot', 'crop_potato', 'crop_beetroot'] as const;

/** Untergrund, auf dem die Pflanzen-Rollen stehen: muss Erde-artig sein, sobald eine davon Erde braucht. */
export const TERRAIN_SOIL_CARRIERS = ['ground_grass', 'ground_moss', 'garden_soil', 'paddock_ground'] as const;
/**
 * Untergrund, der frei hängen kann (unterste Lage über Hügelräumen, Burggraben; Vertrag der Themes in
 * `terrain/test/theme-roles.test.ts`): nur volle, nicht fallende Blöcke.
 */
export const TERRAIN_SUBSOIL = ['ground_dirt', 'ground_stone', 'mound_wall'] as const;
/**
 * Böden der Hülle ohne eigenen Formvertrag (`floor_primary` hat einen): Obergeschoss und Turmboden liegen über Luft,
 * das Erdgeschoss eines Hauses ohne Gelände ebenso – wie der frei hängende Untergrund nur volle, feste Blöcke.
 */
export const FLOOR_CARRIERS = ['floor_stone', 'floor_earth', 'floor_secondary', 'floor_tile_light', 'floor_tile_dark', 'tower_floor'] as const;
/**
 * Gestapelte Vegetation der Form `block` (Busch, Hecke, Obstlaub): Zellen stehen auf- und nebeneinander, oft über
 * Luft – nur Laub oder feste Blöcke (keine Schneeschicht, kein Kies, keine Bodenpflanze, keine Ranke). Das Baumlaub
 * (`leaves_*`) fragt die Form `leaves` ab, die feste Blöcke nie liefern (`ThemeResolver`): dort bleibt alles wie bisher.
 */
export const TERRAIN_STACKED_VEGETATION = ['leaves_bush', 'leaves_fruit', 'hedge'] as const;
/**
 * Oberflächen (Wege, Hof, Platz, Beetkante, Teichgrund, Ackerland): Blöcke, auf denen man steht und Laternen, Türen
 * und Pfosten stehen – keine Decklage (Teppich), keine Ranke. Rieselnde Blöcke dürfen bleiben (darunter liegt immer
 * Erde; die Themes selbst nutzen Kies und Sand dort).
 */
export const TERRAIN_SURFACES = [
  'ground_path', 'ground_yard', 'path_main', 'path_edge', 'path_stone', 'plaza_accent', 'bed_edge', 'pond_bed', 'farmland',
] as const;

const SOIL_CARRIER_SET: ReadonlySet<string> = new Set(TERRAIN_SOIL_CARRIERS);
const HANGING_SET: ReadonlySet<string> = new Set([...TERRAIN_SUBSOIL, ...FLOOR_CARRIERS]);
const STACKED_SET: ReadonlySet<string> = new Set(TERRAIN_STACKED_VEGETATION);
const SURFACE_SET: ReadonlySet<string> = new Set(TERRAIN_SURFACES);

/** Prüft einen Paletten-Eintrag gegen den Geländevertrag einer Rolle. */
export type TerrainRequirement = (e: ThemeMixEntry) => boolean;

/** Was die Pflanzen des umgefärbten Themes vom Untergrund verlangen. */
export interface TerrainNeeds {
  /** Mindestens eine Wiesen-/Beet-Pflanze braucht Erde. */
  readonly soil: boolean;
  /** Mindestens eine Feldfrucht-Rolle ist noch die des Themes (echte Feldfrucht: braucht Ackerland, das keine Palette liefert). */
  readonly farmland: boolean;
  /** Eine umgefärbte Feldfrucht-Rolle enthält eine Bodenpflanze (braucht Erde, Ackerland zählt). */
  readonly cropSoil: boolean;
}

/**
 * Anforderung einer Rolle an ihre Paletten-Einträge. Wiese/Beet/Koppel: Erde, sobald eine Pflanze Erde braucht,
 * sonst Oberfläche. Ackerland: bleibt beim Theme, solange echte Feldfrüchte darauf stehen. Frei hängender Untergrund
 * und Böden: voll und fest. Oberflächen: Blöcke (auch rieselnd). Gestapelte Vegetation: Laub oder fest. Alle übrigen
 * Rollen (Bodenpflanzen, Hülle): nur keine Ranke – eine Ranke in einer Rollenzelle hat keine getragene Fläche.
 */
export function terrainRequirement(role: string, needs: TerrainNeeds): TerrainRequirement {
  if (role === 'farmland') {
    if (needs.farmland) return () => false;
    if (needs.cropSoil) return (e) => groundClassOf(e) === 'soil';
  }
  if (SOIL_CARRIER_SET.has(role)) {
    return needs.soil ? (e) => groundClassOf(e) === 'soil' : (e) => isCarrier(groundClassOf(e), true);
  }
  if (HANGING_SET.has(role)) return (e) => isCarrier(groundClassOf(e), false);
  if (SURFACE_SET.has(role)) return (e) => isCarrier(groundClassOf(e), true);
  if (STACKED_SET.has(role)) return (e) => groundClassOf(e) === 'leaves' || isCarrier(groundClassOf(e), false);
  return notAttached;
}

const notAttached: TerrainRequirement = (e) => groundClassOf(e) !== 'attached';

function isCarrier(c: GroundClass, looseOk: boolean): boolean {
  return c === 'soil' || c === 'solid' || (looseOk && c === 'loose');
}

/** Braucht dieser Pflanzen-Eintrag Erde darunter? (Feste Bodenpflanzen; Familien lösen zu Block/Laub auf.) */
export function plantNeedsSoil(e: ThemeMixEntry): boolean {
  return e.block !== undefined && (PALETTE_BLOCK_CLASS[e.block] ?? 'plant') === 'plant';
}
