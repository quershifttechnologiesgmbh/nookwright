import { cellKey } from '@mcda/core';
import type { RoomGeometry } from './geometry.js';
import type { PlacedComponent } from './place.js';

/** Zeichen je Tag (erstes Treffer-Tag gewinnt). Nur für Debug-Ausgaben und Tests. */
const GLYPHS: ReadonlyArray<readonly [string, string]> = [
  // Signatur-Möbel und neue Katalog-Tags (K1) – vor den allgemeinen Tags, damit sie gewinnen
  ['hearth', 'H'],
  // FN-Crafting: Verzauberungs-Studie und Handwerker-Ecken (Schmiede, Kartograf/Bogner)
  ['fn_study', 'Z'],
  ['fn_corner', 'W'],
  ['forge', 'E'],
  ['storage_wall', 'Z'],
  ['enchanting_station', 'Z'],
  ['bookshelf_wall', 'R'],
  ['brewing_stand', 'Y'],
  ['brew_kettle', 'k'],
  ['bar_counter', 'U'],
  ['desk', 'd'],
  ['wardrobe', 'w'],
  ['goods', 'g'],
  ['raw_materials', 'g'],
  ['lectern', 'L'],
  ['plant_large', 'p'],
  ['rug', '~'],
  ['moss_rug', '~'],
  ['plant_hanging', ','],
  ['upper_cabinet', '='],
  ['wall_decor', '|'],
  ['bar_stool', 'o'],
  // Katalog-Horizont (K2): Sitzmöbel, Schränke, Waffen, Musik, Religiöses, Uhr, Pflanzen, Deckendeko, Außen, Werkstatt
  ['seat', 'h'],
  ['cabinet', 'w'],
  ['wall_weapons', '|'],
  ['music', 'M'],
  ['religious', '+'],
  ['clock', 'Ø'],
  ['mushrooms', 'p'],
  ['planter', 'p'],
  ['decor_ceiling', ','],
  ['outdoor', 'O'],
  ['workshop_prop', 'g'],
  ['pedestal', 'u'],
  ['training', 'x'],
  // V3 (Raumhöhe): Heuballen-Stapel, Aufsatzregal auf der Kommode
  ['hay_stack', 'g'],
  ['sack_pile', 'g'], // W3-IN: Sackstapel (Wollballen nur im Lager)
  ['dresser_top', 'w'],
  ['bed', 'B'],
  ['chest', 'C'],
  // Q1a: Truhen der Handelsräume (trade_chest) und Stapel-Truhen haben keinen `chest`-Tag
  ['trade_chest', 'C'],
  ['nightstand', 'n'],
  ['table', 'T'],
  ['chair', 'h'],
  ['crafting', 'W'],
  ['furnace', 'O'],
  ['smoker', 'O'],
  ['blast_furnace', 'O'],
  ['counter', 'U'],
  ['anvil', 'A'],
  ['grindstone', 'G'],
  ['smithing_table', 'S'],
  ['sink', 'K'],
  ['barrel', 'b'],
  ['light_ceiling', '*'],
  ['light', 'i'],
  // K3 (research/17, neue Raumtypen; Vorschläge aus plan/spikes/K3b §8). Am Ende, damit bestehende Glyphen bleiben.
  ['villager_stall', 'V'], ['cure_station', 'Z'], ['nether_portal', 'N'], ['portal_shrine', 'N'],
  ['cloth_shelf', 'S'], ['loom', 'L'], ['spinning_wheel', 'G'], ['cutting_table', 'T'], ['saw_bench', 'W'], ['lumber_stack', 'g'],
  ['kiln', 'E'], ['bread_oven', 'E'], ['potters_wheel', 'h'], ['pot_rack', 'g'], ['bread_counter', 'U'], ['brew_vat', 'k'],
  ['wine_rack', 'R'], ['cask_big', 'b'], ['bunk_bed', 'B'], ['fletcher_bench', 'W'], ['treasure_pile', 'g'], ['strongbox', 'C'],
  ['fire_pit', 'H'], ['fur_platform', 'h'], ['armor_bay', '|'],
  ['pilaster', 'I'], ['column', 'I'], ['room_divider', 'I'], ['gallery_bay', '|'], ['fireplace', 'H'], ['throne', 'K'],
  ['telescope', '@'], ['armillary', '@'], ['crystal_orb', '@'], ['star_cluster', ','], ['cobweb', ','],
  ['bath_pool', '≈'], ['washstand', 'K'], ['latrine', 'l'], ['towel_rack', '|'], ['crib', 'B'], ['sickbed', 'B'],
  ['altar', '+'], ['pulpit', '+'], ['keyboard_instrument', 'M'], ['organ', 'M'], ['jukebox', 'M'],
  ['coat_stand', 'f'], ['room_directory', '|'], ['dart_board', '|'], ['trophy_pedestal', 'u'],
  ['chess_floor', '~'], ['floor_map', '~'], ['patchwork_rug', '~'], ['garden_bed', 'p'], ['plant_shelf', 'p'], ['prison_cell', 'X'],
  ['bone_pile', 'g'], ['toys', 'g'], ['junk_pile', 'g'], ['corner_shelf', 'R'], ['display_shelf', 'R'], ['study_desk', 'd'], ['map_desk', 'd'],
  // Q1a (research/52/57): Tags der übernommenen Innen- und Raumtyp-Serien, die noch keine Glyphe hatten
  ['wall_shelf', '='], ['mantle', '='], ['kitchen_utensils', 'g'], ['wall_tools', '|'], ['tool_wall', '|'],
  ['shoe_rack', 'R'], ['entryway', 'f'], ['quilt_rack', '~'], ['bed_accessory', 'n'],
  ['farm_tools', 'g'], ['farm_prop', 'g'], ['dining_table', 'T'], ['table_small', 'T'], ['seating_group', 'h'],
  ['candle_stand', 'i'], ['light_grim', 'i'],
  // W2 (I6): eigene Tags der Q1a-Entwürfe, seit sie nur noch in ihren Zielräumen stehen
  ['straw_pallet', 'B'], ['glass_case_trophy', 'u'], ['moss_corner_planter', 'p'], ['vine_trellis', 'p'], ['window_herb_shelf', 'p'],
  ['board_game_shelf', 'R'], ['fn_nave_bay', '|'], ['fn_plinth', 'u'], ['dye_crate', 'g'], ['linen_closet', 'w'], ['root_cellar_shelf', 'Z'], ['seed_crate', 'g'],
  ['barrel_bar_table', 'T'], ['breakfast_nook_booth', 'T'], ['dressing_table', 'd'], ['tool_wall_corner', '|'], ['candle_altar_corner', 'i'],
  // FN-Dense: Insel-Tische und Nutzraum-Bauteile der Werkstätten/Keller/Dachboden (Tags mit Präfix fn_)
  ['fn_wine_island', 'R'], ['fn_alchemy_island', 'k'], ['fn_brew_island', 'k'], ['fn_carpenter_island', 'W'], ['fn_armory_island', 'S'],
  ['fn_smithy_island', 'A'], ['fn_weaving_island', 'L'], ['fn_pottery_island', 'E'], ['fn_bakery_island', 'E'], ['fn_wash_island', 'K'],
  ['fn_dungeon_rack', 'X'], ['fn_dungeon_stocks', 'X'], ['fn_coal_bin', 'g'], ['fn_eave_stash', 'g'], ['fn_attic_heap', 'g'],
  // FN-Villagers: Villager-Bett (Schlafhalle), Spawner-Käfig (Deko), Händlerbude
  ['fn_villager_bed', 'B'], ['fn_spawner_cage', 'X'], ['fn_trade_booth', 'V'], ['fn_bee_yard', 'b'],
  // FN (dichte Wohnräume): Prunkteppiche, Läufer, lange Wandbehänge, Ecknischen, Festtafel
  ['fn_rug', '~'], ['fn_runner', '~'], ['fn_tapestry', '|'], ['fn_corner', 'p'], ['fn_hall_table', 'T'],
  // FN-Lager (28.09.2026): beschriftete Fass-/Truhenwand, Shulker-Station, Vorratsregale der Lagerhalle
  ['fn_barrel_wall', 'b'], ['fn_chest_wall', 'C'], ['fn_shulker', 'C'], ['fn_cellar_shelf', 'Z'],
  // feat/int-decor: Zusatz-Deko (Bordürenteppich, Pflanzenständer)
  ['deco_rug', '~'], ['deco_plant', 'p'],
];

/** Glyphe einer Komponente aus ihren Tags (erster Treffer in `GLYPHS`), `?` ohne Treffer. */
export function glyphFor(tags: readonly string[]): string {
  return GLYPHS.find(([t]) => tags.includes(t))?.[1] ?? '?';
}

/**
 * Draufsicht eines eingerichteten Raums: '#' Wand, 'D' Tür, 'F' Fenster, '.' freier Boden,
 * Buchstaben = Möbel (Bodenebene hat Vorrang vor Deckenlampen).
 */
export function renderAscii(geom: RoomGeometry, placed: readonly PlacedComponent[], tagsOf: (componentId: string) => readonly string[]): string {
  const b = geom.interior.bounds();
  if (b === undefined) return '';
  const floorGlyph = new Map<string, string>();
  const ceilGlyph = new Map<string, string>();
  for (const p of placed) {
    const tags = tagsOf(p.expanded.defId);
    const g = glyphFor(tags);
    for (const c of p.cells) {
      const k = cellKey(c.pos[0], c.pos[2]);
      // Bodenebene hat Vorrang; Deko obendrauf (y = baseY + 1) nur, wenn darunter nichts steht
      if (c.pos[1] === geom.baseY) floorGlyph.set(k, g);
      else if (c.pos[1] === geom.baseY + 1 && !floorGlyph.has(k)) floorGlyph.set(k, g);
      else if (!ceilGlyph.has(k)) ceilGlyph.set(k, g);
    }
  }
  const doors = new Set(geom.doors.map((d) => {
    const s = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }[d.toward];
    return cellKey(d.inside[0] + s[0]!, d.inside[1] + s[1]!);
  }));
  const windows = new Set(geom.windows.map((w) => {
    const s = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }[w.toward];
    return cellKey(w.inside[0] + s[0]!, w.inside[1] + s[1]!);
  }));
  const rows: string[] = [];
  for (let z = b.minZ - 1; z <= b.maxZ + 1; z++) {
    let row = '';
    for (let x = b.minX - 1; x <= b.maxX + 1; x++) {
      const k = cellKey(x, z);
      if (geom.interior.has(x, z)) row += floorGlyph.get(k) ?? ceilGlyph.get(k) ?? '.';
      else if (doors.has(k)) row += 'D';
      else if (windows.has(k)) row += 'F';
      else row += '#';
    }
    rows.push(row);
  }
  return rows.join('\n');
}
