/**
 * Vanilla-Parität (Spike M2, plan/spikes/M2_physik_paritaet.md): Nachbarschafts-States, die das Spiel beim
 * Platzieren mit Updates (`/place` non-strict, GDMC) über `updateShape` bzw. einen sofort geplanten Tick neu
 * rechnet. Wir rechnen sie vorher selbst – dann liefern strict und non-strict dieselbe Welt (T3: „jede
 * non-strict-Abweichung ist ein Exportfehler“). Alle Pässe sind deterministisch und von der Reihenfolge der
 * Zellen unabhängig. Grundlage: Vanilla-Code 1.21.11 (Mojang-Mappings), im Spiel geprüft (Gruppe P).
 *
 *  - Blätter `distance` (LeavesBlock#updateDistance): Taxicab-BFS über Blätter ab `#logs`
 *    (seit 26.1 `#prevents_nearby_leaf_decay`), höchstens 7.
 *  - Riesenpilz-Flächen (HugeMushroomBlock#updateShape): Fläche zu gleichartigem Nachbarn = false.
 *  - Notenblock `instrument` (NoteBlock#setInstrument): Kopf darüber, sonst Block darunter (Tabelle unten).
 *  - Trampelpfad/Ackerland → Erde, wenn darüber ein „fester“ Block (isSolid) steht – außer Zauntor.
 *  - `snowy` von Gras/Podsol/Myzel (Schnee darüber), Lagerfeuer `signal_fire` (Heuballen darunter),
 *    Glocke single_wall ↔ double_wall, Ranken-Flächen, Ackerland-`moisture` (Ruhezustand, Zufallstick).
 * `isSolid` ist die Vanilla-Regel `BlockStateBase#isSolid` (T5): mittlere Kante der Kollisions-AABB ≥ 35/48 oder
 * Höhe ≥ 1 oder `forceSolidOn` – gebraucht für Rahmen/Gemälde/Schild/Banner, Kuchen und Trampelpfad.
 */
import { opposite, type HorizontalDir, type Vec3 } from '@mcda/core';
import { blockState, type BlockState } from '@mcda/voxel';
import { DIR6, faceSupport, step, type CellInfo, type WorldView } from './world.js';

const H4: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];
type Props = Record<string, string>;

function setProps(view: WorldView, pos: Vec3, s: BlockState, changes: Props): void {
  if (Object.keys(changes).every((k) => s.properties[k] === changes[k])) return;
  view.volume.replaceState(pos, blockState(s.name, { ...s.properties, ...changes }));
}

// ====================================================================== isSolid

/**
 * `forceSolidOn` im Vanilla-Code (seit 1.20 statt Material: früher „festes“ Material, Form zu klein): Laternen
 * (T5: Rahmen/Banner halten), Schilder, Banner, Druckplatten, Spinnweben, Glocke, Ketten, Amethyst-Knospen,
 * Zauntore (auch offen), Kuchen, Schildkröten-/Schnüffler-Ei, Blitzableiter, Tropfstein, Aquisitor.
 * Im Spiel geprüft: Gruppe P „Orakel isSolid“ (Rahmen seitlich am Block, 1.21.11).
 */
function forceSolidOn(n: string, kind: CellInfo['kind']): boolean {
  return kind === 'lantern' || kind === 'fence_gate' || n.endsWith('_sign') || n.endsWith('_banner') || n.endsWith('_pressure_plate')
    || n === 'cobweb' || n === 'bell' || n === 'chain' || n.endsWith('_chain') || n === 'amethyst_cluster' || n.endsWith('_amethyst_bud')
    || n === 'cake' || n.endsWith('candle_cake') || n === 'turtle_egg' || n === 'sniffer_egg' || n.endsWith('lightning_rod')
    || n === 'pointed_dripstone' || n === 'conduit' || n === 'dried_ghast';
}

/**
 * `forceSolidOff` (früher nicht festes Material, Form wäre „fest“): Leiter, Schneeschicht, Gerüst, Endstab, großes
 * Tropfblatt, Chorus, Azalee (Pflanzen). Im Spiel gemessen (Gruppe P).
 */
const FORCE_SOLID_OFF: ReadonlySet<string> = new Set(['ladder', 'snow', 'scaffolding', 'end_rod', 'big_dripleaf', 'chorus_plant', 'chorus_flower', 'azalea', 'flowering_azalea']);

/**
 * Blöcke mit Kollision, deren AABB trotzdem zu klein ist (mittlere Kante < 35/48, Höhe < 1): geprüft gegen die
 * Kollisionsformen der Plattform-Rohdaten (Test `vanilla-solid.test.ts`).
 */
function smallShape(s: BlockState): boolean {
  const n = s.name;
  const p = s.properties;
  if (n === 'candle' || n.endsWith('_candle') || n === 'flower_pot' || n.startsWith('potted_')) return true;
  if ((n.endsWith('_head') || n.endsWith('_skull')) && n !== 'piston_head') return true;
  if (['sea_pickle', 'heavy_core', 'cocoa', 'pitcher_crop', 'frogspawn'].includes(n)) return true;
  if (n.endsWith('copper_golem_statue')) return true;
  return false;
}

/** Vanilla `BlockStateBase#isSolid` (T5-Regel) aus Physik-Klasse, Kollisionshöhe und den Listen oben. */
export function isSolid(info: CellInfo): boolean {
  const { state: s, kind, phys } = info;
  const n = s.name;
  if (forceSolidOn(n, kind)) return true;
  if (FORCE_SOLID_OFF.has(n)) return false;
  if (phys.cls === 'air' || phys.cls === 'thin') return false;
  if (kind === 'wall' && s.properties['up'] === 'false' && H4.every((d) => (s.properties[d] ?? 'none') === 'none')) return false;
  if (smallShape(s)) return false;
  if (phys.cls === 'full' || phys.cls === 'tall' || phys.h >= 1) return true;
  // volle Grundfläche angenommen: (1 + h + 1) / 3 ≥ 35/48 ⇔ h ≥ 3/16 (geschlossene Falltür: genau 35/48 → fest)
  return phys.h >= 3 / 16 - 1e-9;
}

/** Verstärker/Komparator: Rahmen (seitlich) und Gemälde halten trotz „nicht fest“ (HangingEntity#survives). */
export function isDiode(s: BlockState): boolean {
  return s.name === 'repeater' || s.name === 'comparator';
}

// ====================================================================== Blätter

/** Blätter im Sinne von LeavesBlock: Property `distance` 1–7 und `persistent`. */
export function isLeaves(view: WorldView, s: BlockState): boolean {
  const props = view.platform.registry.listProperties(s.name);
  return props !== undefined && Object.hasOwn(props, 'persistent') && (props['distance'] ?? []).includes('7');
}

/** Stamm-Tag der Zielversion: bis 1.21.11 `#logs`, seit 26.1 `#prevents_nearby_leaf_decay`. */
function isLeafAnchor(view: WorldView, s: BlockState): boolean {
  return view.hasTag(s, 'prevents_nearby_leaf_decay') || view.hasTag(s, 'logs');
}

/** `distance` aller Blätter: Mehrquellen-BFS (Taxicab, 6 Richtungen) über Blätter ab Stämmen, gedeckelt bei 7. */
export function resolveLeaves(view: WorldView): void {
  const leaves = [...view.volume.cells()].filter((c) => isLeaves(view, c.state));
  if (leaves.length === 0) return;
  const key = (p: Vec3): string => p.join(',');
  const dist = new Map<string, number>();
  const queue: Vec3[] = [];
  for (const c of leaves) {
    let best = 7;
    for (const d of DIR6) if (isLeafAnchor(view, view.state(step(c.pos, d)))) best = 1;
    if (best === 1) {
      dist.set(key(c.pos), 1);
      queue.push(c.pos);
    }
  }
  const isLeafAt = new Set(leaves.map((c) => key(c.pos)));
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]!;
    const d = dist.get(key(p))!;
    if (d >= 7) continue;
    for (const dir of DIR6) {
      const q = step(p, dir);
      const k = key(q);
      if (!isLeafAt.has(k) || dist.has(k)) continue;
      dist.set(k, d + 1);
      queue.push(q);
    }
  }
  for (const c of leaves) setProps(view, c.pos, c.state, { distance: String(dist.get(key(c.pos)) ?? 7) });
}

// ====================================================================== Riesenpilz

const HUGE_MUSHROOM: ReadonlySet<string> = new Set(['brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem']);

/** Flächen zu einem Nachbarn DERSELBEN Blockart werden false; andere Flächen bleiben, wie exportiert. */
export function resolveHugeMushrooms(view: WorldView): void {
  for (const c of [...view.volume.cells()]) {
    if (!HUGE_MUSHROOM.has(c.state.name)) continue;
    const changes: Props = {};
    for (const d of DIR6) if (view.state(step(c.pos, d)).name === c.state.name) changes[d] = 'false';
    setProps(view, c.pos, c.state, changes);
  }
}

// ====================================================================== Notenblock

const HEAD_INSTRUMENT: Readonly<Record<string, string>> = {
  zombie_head: 'zombie', skeleton_skull: 'skeleton', creeper_head: 'creeper', dragon_head: 'dragon',
  wither_skeleton_skull: 'wither_skeleton', piglin_head: 'piglin', player_head: 'custom_head',
};

const EXPLICIT_INSTRUMENT: Readonly<Record<string, string>> = {
  clay: 'flute', gold_block: 'bell', packed_ice: 'chime', bone_block: 'xylophone', iron_block: 'iron_xylophone',
  soul_sand: 'cow_bell', pumpkin: 'didgeridoo', emerald_block: 'bit', hay_block: 'banjo', glowstone: 'pling',
  heavy_core: 'snare', // im Spiel gemessen (Gruppe P)
};

const WOOD_SPECIES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped', 'poplar'];
/** Früheres Material WOOD/NETHER_WOOD → Bass. */
const BASS_BLOCKS: ReadonlySet<string> = new Set([
  'chest', 'trapped_chest', 'crafting_table', 'bookshelf', 'chiseled_bookshelf', 'note_block', 'jukebox', 'barrel',
  'lectern', 'composter', 'loom', 'cartography_table', 'fletching_table', 'smithing_table', 'beehive', 'bee_nest',
  'campfire', 'soul_campfire', 'daylight_detector', 'brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem',
  'mangrove_roots',
]);
/** Früheres Material STONE → Basstrommel (Namensbausteine, geprüft an der Basis ohne _stairs/_slab/_wall). */
const STONE_WORDS = /(^|_)(stone|cobblestone|granite|diorite|andesite|deepslate|tuff|calcite|blackstone|basalt|obsidian|netherrack|bricks?|sandstone|terracotta|concrete|prismarine|purpur|quartz|dripstone|ore|nylium|bedrock|stonecutter)(_|$)/;
const STONE_BLOCKS: ReadonlySet<string> = new Set([
  'furnace', 'blast_furnace', 'smoker', 'dispenser', 'dropper', 'observer', 'spawner', 'enchanting_table', 'ender_chest',
  'respawn_anchor', 'coal_block', 'magma_block', 'raw_iron_block', 'raw_copper_block', 'raw_gold_block', 'end_stone',
  'crying_obsidian', 'reinforced_deepslate', 'vault', 'trial_spawner', 'end_portal_frame', 'creaking_heart',
]);
/** Stein im Namen, aber anderes Material (Knöpfe = Deko, Schleif-/Leitstein = Schwermetall, Redstone-Teile). */
const NOT_STONE = /(_button$|^grindstone$|^lodestone$|^glowstone$|^redstone_(block|lamp|wire|torch|wall_torch)$|^infested_|_coral$|_coral_fan$|_coral_wall_fan$)/;

function baseName(n: string): string {
  return n.replace(/_(stairs|slab|wall)$/, '');
}

/**
 * Instrument, das ein Block als Unterlage eines Notenblocks liefert (Vanilla `BlockBehaviour.Properties#instrument`,
 * seit 1.20 die frühere Material-Zuordnung). `trumpet*` für Kupfer nur, wenn die Zielversion es kennt (26.x).
 */
export function instrumentOf(name: string, known?: readonly string[]): string {
  if (Object.hasOwn(EXPLICIT_INSTRUMENT, name)) return EXPLICIT_INSTRUMENT[name]!;
  if (name.endsWith('_wool')) return 'guitar';
  if (/^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$/.test(name) || name.endsWith('_concrete_powder')) return 'snare';
  if (/(^|_)glass(_pane)?$/.test(name) || name === 'glass_pane' || name === 'sea_lantern' || name === 'beacon' || name === 'conduit') return 'hat';
  if (known?.includes('trumpet') === true && /^(waxed_)?((exposed|weathered|oxidized)_)?(copper_block|cut_copper|chiseled_copper|copper)$/.test(name)) {
    const age = /(exposed|weathered|oxidized)/.exec(name)?.[1];
    return age === undefined ? 'trumpet' : `trumpet_${age}`;
  }
  if (BASS_BLOCKS.has(name) || name.endsWith('_banner') || name.endsWith('_shelf')) return 'bass';
  const base = baseName(name.replace(/^stripped_/, ''));
  const species = WOOD_SPECIES.find((sp) => base === sp || base.startsWith(`${sp}_`));
  if (species !== undefined) {
    if (/(_button|_sapling|_leaves|_propagule|_boat)$/.test(name)) return 'harp';
    if (species === 'crimson' || species === 'warped') {
      // Nether-Holz: Stämme, Hyphen, Bretter und Teile daraus; Nylium ist Stein, Pilze/Wurzeln/Warzen nicht
      if (name.endsWith('_nylium')) return 'basedrum';
      return /(fungus|roots|wart_block)$/.test(name) ? 'harp' : 'bass';
    }
    if (species === 'bamboo') return base === 'bamboo' && !name.includes('block') && name !== 'bamboo_planks' ? 'harp' : 'bass';
    return 'bass';
  }
  if (STONE_BLOCKS.has(name)) return 'basedrum';
  if (NOT_STONE.test(name)) return 'harp';
  if (STONE_WORDS.test(base) || name.endsWith('_coral_block')) return 'basedrum';
  return 'harp';
}

/** NoteBlock#setInstrument: Kopf darüber gewinnt, sonst die Unterlage (Kopf darunter → Harfe). */
export function noteBlockInstrument(below: BlockState, above: BlockState, known?: readonly string[]): string {
  if (Object.hasOwn(HEAD_INSTRUMENT, above.name)) return HEAD_INSTRUMENT[above.name]!;
  if (Object.hasOwn(HEAD_INSTRUMENT, below.name)) return 'harp';
  return instrumentOf(below.name, known);
}

export function resolveNoteBlocks(view: WorldView): void {
  const known = view.platform.registry.listProperties('note_block')?.['instrument'];
  for (const c of [...view.volume.cells()]) {
    if (c.state.name !== 'note_block') continue;
    const inst = noteBlockInstrument(view.state(step(c.pos, 'down')), view.state(step(c.pos, 'up')), known);
    if (known !== undefined && !known.includes(inst)) continue;
    setProps(view, c.pos, c.state, { instrument: inst });
  }
}

// ====================================================================== Boden

/** FarmBlock/DirtPathBlock#canSurvive: darüber nicht fest – Zauntor und bewegter Kolben sind erlaubt. */
export function soilSurvivesUnder(above: CellInfo): boolean {
  return !isSolid(above) || above.kind === 'fence_gate' || above.state.name === 'moving_piston';
}

/** Enthält die Zelle Wasser als Fluid (Wasserblock, waterlogged, Seegras/Seetang, Blasensäule)? */
export function hasWaterFluid(s: BlockState): boolean {
  return s.name === 'water' || s.properties['waterlogged'] === 'true' || s.name === 'bubble_column'
    || ['seagrass', 'tall_seagrass', 'kelp', 'kelp_plant'].includes(s.name);
}

/** FarmBlock#isNearWater: Wasser in dx, dz ∈ [−4, 4], dy ∈ [0, 1]. */
export function farmlandHydrated(view: WorldView, pos: Vec3): boolean {
  for (let dy = 0; dy <= 1; dy++) for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
    if (hasWaterFluid(view.state([pos[0] + dx, pos[1] + dy, pos[2] + dz]))) return true;
  }
  return false;
}

const SNOWY_SOIL: ReadonlySet<string> = new Set(['grass_block', 'podzol', 'mycelium']);

/**
 * Trampelpfad/Ackerland unter festem Block → Erde (Vanilla plant sofort einen Tick und ruft `turnToDirt`);
 * `snowy` nach Schnee darüber; Ackerland neben Wasser bekommt `moisture=7` (Ruhezustand nach Zufallsticks).
 */
export function resolveSoil(view: WorldView): void {
  for (const c of [...view.volume.cells()]) {
    const n = c.state.name;
    if (n === 'dirt_path' || n === 'farmland') {
      const above = view.info(step(c.pos, 'up'));
      if (!soilSurvivesUnder(above)) {
        view.volume.replaceState(c.pos, blockState('dirt', {}));
        continue;
      }
      if (n === 'farmland' && farmlandHydrated(view, c.pos)) setProps(view, c.pos, c.state, { moisture: '7' });
    } else if (SNOWY_SOIL.has(n) && c.state.properties['snowy'] !== undefined) {
      setProps(view, c.pos, c.state, { snowy: String(view.hasTag(view.state(step(c.pos, 'up')), 'snow')) });
    }
  }
}

// ====================================================================== Lagerfeuer, Glocke, Ranken

/** CampfireBlock: `signal_fire` = Heuballen direkt darunter. */
export function resolveCampfires(view: WorldView): void {
  for (const c of [...view.volume.cells()]) {
    if (c.state.name !== 'campfire' && c.state.name !== 'soul_campfire') continue;
    setProps(view, c.pos, c.state, { signal_fire: String(view.state(step(c.pos, 'down')).name === 'hay_block') });
  }
}

/** BellBlock#updateShape: Wandglocke mit tragender Fläche gegenüber → double_wall; fehlt eine Seite → single_wall. */
export function resolveBells(view: WorldView): void {
  for (const c of [...view.volume.cells()]) {
    if (c.state.name !== 'bell') continue;
    const p = c.state.properties;
    const f = p['facing'] as HorizontalDir | undefined;
    if (f === undefined) continue;
    const sturdy = (d: HorizontalDir): boolean => faceSupport(view.info(step(c.pos, d)), opposite(d)) === 'full';
    if (p['attachment'] === 'single_wall' && sturdy(opposite(f) as HorizontalDir)) {
      setProps(view, c.pos, c.state, { attachment: 'double_wall' });
    } else if (p['attachment'] === 'double_wall') {
      if (!sturdy(f)) setProps(view, c.pos, c.state, { attachment: 'single_wall', facing: opposite(f) });
      else if (!sturdy(opposite(f) as HorizontalDir)) setProps(view, c.pos, c.state, { attachment: 'single_wall' });
    }
  }
}

/**
 * VineBlock#getUpdatedState: `up` bleibt nur mit voller Unterseite darüber; eine Seitenfläche bleibt nur mit voller
 * Fläche daneben oder einer Ranke darüber mit derselben Fläche. Von oben nach unten, weil Ranken die darüber lesen.
 * Ranken ohne Fläche verschwinden im Spiel – das meldet die Physik (Stützregel).
 */
export function resolveVines(view: WorldView): void {
  const vines = [...view.volume.cells()].filter((c) => c.state.name === 'vine').sort((a, b) => b.pos[1] - a.pos[1]);
  for (const c of vines) {
    const s = view.state(c.pos);
    const changes: Props = {};
    if (s.properties['up'] === 'true' && faceSupport(view.info(step(c.pos, 'up')), 'down') !== 'full') changes['up'] = 'false';
    const above = view.state(step(c.pos, 'up'));
    for (const d of H4) {
      if (s.properties[d] !== 'true') continue;
      const wall = faceSupport(view.info(step(c.pos, d)), opposite(d)) === 'full';
      if (!wall && !(above.name === 'vine' && above.properties[d] === 'true')) changes[d] = 'false';
    }
    setProps(view, c.pos, s, changes);
  }
}

/** Hat eine Ranke (nach `resolveVines`) noch eine Fläche? Sonst ersetzt das Spiel sie durch Luft. */
export function vineHasFaces(s: BlockState): boolean {
  return s.properties['up'] === 'true' || H4.some((d) => s.properties[d] === 'true');
}

// ====================================================================== alle Pässe

/** Alle Vanilla-Update-Regeln dieses Moduls (nach Treppen/Verbindungen/Redstone, vor der Physik). */
export function resolveVanillaUpdates(view: WorldView): void {
  resolveLeaves(view);
  resolveHugeMushrooms(view);
  resolveSoil(view);
  resolveNoteBlocks(view);
  resolveCampfires(view);
  resolveBells(view);
  resolveVines(view);
}

