import type { MaterialSpec } from './schema.js';

/**
 * Block-Wissen für Mechanik-Regeln (Katalog-Prüfungen und Solver, research/17 §7.4, Faktencheck #2/#7/#8).
 * Der Katalog kennt nur abstrakte Materialien (Rolle + Form oder feste Block-ID); geurteilt wird über Namensmuster
 * ohne Namensraum. Konservativ: Was nicht sicher „kein Vollblock“ ist, gilt als Vollblock (leitet Redstone,
 * erstickt).
 */

export const blockName = (id: string): string => id.slice(id.indexOf(':') + 1);

/** Formen ohne volle Kollisionsbox (Rollen-Materialien). */
export const NON_FULL_SHAPES: ReadonlySet<string> = new Set([
  'slab', 'stairs', 'fence', 'fence_gate', 'trapdoor', 'door', 'carpet', 'pane', 'chain', 'bars', 'lantern', 'wall_sign', 'sign',
  'hanging_sign', 'wall_hanging_sign', 'wall_banner', 'banner', 'bed', 'pressure_plate', 'button', 'torch', 'wall_torch', 'ladder',
  'wall', 'candle', 'shelf', 'rod',
]);

/** Feste Block-IDs ohne volle Kollisionsbox (Namensmuster ohne Namensraum). */
export const NON_FULL_BLOCKS: readonly RegExp[] = [
  /^air$/, /^cave_air$/, /chest$/, /_slab$/, /_stairs$/, /carpet$/, /_pane$/, /lantern$/, /candle$/, /candle_cake$/, /^cake$/, /torch$/,
  /banner$/, /_sign$/, /_skull$/, /_head$/, /^potted_/, /^flower_pot$/, /^decorated_pot$/, /trapdoor$/, /_door$/, /_fence$/,
  /_fence_gate$/, /_wall$/, /_bars$/, /chain$/, /^hopper$/, /_button$/, /_pressure_plate$/, /rail$/, /^ladder$/, /anvil$/,
  /^grindstone$/, /^lectern$/, /^bell$/, /campfire$/, /cauldron$/, /^composter$/, /^brewing_stand$/, /^enchanting_table$/,
  /^stonecutter$/, /^scaffolding$/, /_bed$/, /^hanging_roots$/, /^spore_blossom$/, /hanging_moss$/, /_rod$/, /^cobweb$/, /^lever$/,
  /_shelf$/, /^tripwire_hook$/,
];

/** Voller Block (Redstone-Leiter, erstickend): konservativ alles, was nicht sicher kleiner ist. */
export function isFullBlock(mat: MaterialSpec): boolean {
  if (mat.block !== undefined) {
    const name = blockName(mat.block);
    return !NON_FULL_BLOCKS.some((r) => r.test(name));
  }
  return !NON_FULL_SHAPES.has(mat.shape ?? '');
}

/** Dorfbewohner-Arbeitsblöcke → Beruf (Faktencheck #7; Kessel in allen Füllvarianten). */
export const JOB_SITES: Readonly<Record<string, string>> = {
  blast_furnace: 'armorer',
  smoker: 'butcher',
  cartography_table: 'cartographer',
  brewing_stand: 'cleric',
  composter: 'farmer',
  barrel: 'fisherman',
  fletching_table: 'fletcher',
  cauldron: 'leatherworker',
  water_cauldron: 'leatherworker',
  lava_cauldron: 'leatherworker',
  powder_snow_cauldron: 'leatherworker',
  lectern: 'librarian',
  stonecutter: 'mason',
  loom: 'shepherd',
  smithing_table: 'toolsmith',
  grindstone: 'weaponsmith',
};

/** Blockname des Arbeitsblocks (undefined: kein Arbeitsblock). */
export function jobSiteOf(mat: MaterialSpec): string | undefined {
  if (mat.block === undefined) return undefined;
  const name = blockName(mat.block);
  return Object.hasOwn(JOB_SITES, name) ? name : undefined;
}

/** Bett (Kopf- oder Fußteil; Rolle mit Form `bed` oder `*_bed`). */
export const isBed = (mat: MaterialSpec): boolean => (mat.block !== undefined ? /_bed$/.test(blockName(mat.block)) : mat.shape === 'bed');

export const isNoteBlock = (mat: MaterialSpec): boolean => mat.block !== undefined && blockName(mat.block) === 'note_block';

/** Kopf auf dem Boden (nicht an der Wand): klingt auf einem Notenblock als Mob-Geräusch. */
export const isMobHead = (mat: MaterialSpec): boolean => {
  if (mat.block === undefined) return false;
  const name = blockName(mat.block);
  return /_(head|skull)$/.test(name) && !name.includes('_wall_');
};

/**
 * Gefahr auf Laufhöhe (research/11 §2.4, research/17 §3.4): verletzt beim Drauftreten oder Hineinlaufen
 * (Lagerfeuer, Magma, Feuer, Beerenstrauch, Kaktus), bremst/klebt (Honig, Pulverschnee) oder ist Flüssigkeit.
 */
export const HAZARD_BLOCKS: ReadonlySet<string> = new Set([
  'campfire', 'soul_campfire', 'fire', 'soul_fire', 'magma_block', 'honey_block', 'water', 'lava', 'powder_snow', 'sweet_berry_bush',
  'wither_rose', 'cactus',
]);

export const isHazard = (mat: MaterialSpec): boolean => mat.block !== undefined && HAZARD_BLOCKS.has(blockName(mat.block));

/** Wasser-Quellblock (`level` fehlt oder 0). */
export const isWaterSource = (mat: MaterialSpec): boolean =>
  mat.block !== undefined && blockName(mat.block) === 'water' && (mat.state?.['level'] ?? '0') === '0';
