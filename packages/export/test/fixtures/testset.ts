/**
 * Test-Fixture „T1-Testset“: ~40 kritische Blöcke/Entities auf einem Boden (20×5×12).
 * Versionsabhängig gebaut (Item-/Text-/Equipment-Format, chain→iron_chain).
 *
 * Layout (y=0 Boden aus Polished Andesite, Objekte ab y=1; Gruppen mit Luftabstand,
 * damit keine ungewollten Verbindungen entstehen). Koordinaten relativ zur Minimum-Ecke,
 * Norden = -Z, Osten = +X.
 */
import {
  attachedPos, bannerFields, equipmentFields, features, itemStack, nbt, signSide, slotItem, writableBook,
  type AttachFacing, type ExportBlock, type ExportEntity, type ExportVolume, type NbtCompound, type NbtTag,
} from '../../src/index.js';

export const TESTSET_SIZE = [20, 5, 12] as const;

export interface FixtureEntry {
  /** Kurzname für Bericht/In-Game-Checkliste */
  readonly label: string;
  readonly block?: ExportBlock;
  readonly entity?: ExportEntity;
}

type Props = Record<string, string>;

/** Rahmen/Gemälde: Richtung (3D-Index für Rahmen `Facing`, 2D-Index für Gemälde `facing`). */
const DIR3D: Readonly<Record<AttachFacing, number>> = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };
const DIR2D = { south: 0, west: 1, north: 2, east: 3 } as const;

export function buildTestEntries(dataVersion: number): FixtureEntry[] {
  const f = features(dataVersion);
  const dv = dataVersion;
  const out: FixtureEntry[] = [];
  const block = (label: string, pos: [number, number, number], name: string, properties?: Props, blockEntity?: Record<string, NbtTag>) => {
    const b: ExportBlock = {
      pos,
      name: `minecraft:${name}`,
      ...(properties ? { properties } : {}),
      ...(blockEntity ? { blockEntity: nbt.compound(blockEntity) } : {}),
    };
    out.push({ label, block: b });
  };
  const stairs = (label: string, pos: [number, number, number], facing: string, shape: string, half = 'bottom') =>
    block(label, pos, 'oak_stairs', { facing, half, shape, waterlogged: 'false' });
  const fence = (label: string, pos: [number, number, number], conn: Partial<Record<'north' | 'east' | 'south' | 'west', boolean>>) =>
    block(label, pos, 'oak_fence', {
      north: String(!!conn.north), east: String(!!conn.east), south: String(!!conn.south), west: String(!!conn.west), waterlogged: 'false',
    });
  const pane = (label: string, pos: [number, number, number], conn: Partial<Record<'north' | 'east' | 'south' | 'west', boolean>>) =>
    block(label, pos, 'glass_pane', {
      north: String(!!conn.north), east: String(!!conn.east), south: String(!!conn.south), west: String(!!conn.west), waterlogged: 'false',
    });
  const wall = (label: string, pos: [number, number, number], up: boolean, sides: Partial<Record<'north' | 'east' | 'south' | 'west', 'none' | 'low' | 'tall'>>) =>
    block(label, pos, 'cobblestone_wall', {
      up: String(up), north: sides.north ?? 'none', east: sides.east ?? 'none', south: sides.south ?? 'none', west: sides.west ?? 'none', waterlogged: 'false',
    });

  // --- Gruppe A: Dach-Außenecken (outer_left / straight / outer_right) -----------------
  stairs('Treppe outer_left', [1, 1, 1], 'south', 'outer_left');
  stairs('Treppe straight (S)', [2, 1, 1], 'south', 'straight');
  stairs('Treppe outer_right', [3, 1, 1], 'south', 'outer_right');
  stairs('Treppe straight (E)', [1, 1, 2], 'east', 'straight');
  block('Planke (Dachmitte)', [2, 1, 2], 'oak_planks');
  stairs('Treppe straight (W)', [3, 1, 2], 'west', 'straight');
  // --- Gruppe B: Innenecken + obere Treppe ------------------------------------------------
  stairs('Treppe inner_right', [5, 1, 1], 'north', 'inner_right');
  stairs('Treppe straight (E, zu inner_right)', [5, 1, 2], 'east', 'straight');
  stairs('Treppe inner_left', [8, 1, 1], 'north', 'inner_left');
  stairs('Treppe straight (W, zu inner_left)', [8, 1, 2], 'west', 'straight');
  stairs('Treppe half=top', [10, 1, 1], 'north', 'straight', 'top');
  // --- Stufen (Slabs) --------------------------------------------------------------------
  block('Stufe unten', [12, 1, 1], 'oak_slab', { type: 'bottom', waterlogged: 'false' });
  block('Stufe oben', [13, 1, 1], 'oak_slab', { type: 'top', waterlogged: 'false' });
  block('Stufe doppelt', [14, 1, 1], 'oak_slab', { type: 'double', waterlogged: 'false' });

  // --- Zäune (L-Form) ----------------------------------------------------------------------
  fence('Zaun Ende (E)', [1, 1, 4], { east: true });
  fence('Zaun Mitte (E+W)', [2, 1, 4], { east: true, west: true });
  fence('Zaun Ecke (W+S)', [3, 1, 4], { west: true, south: true });
  fence('Zaun Ende (N)', [3, 1, 5], { north: true });
  // --- Glasscheiben ------------------------------------------------------------------------
  pane('Glasscheibe (S)', [5, 1, 4], { south: true });
  pane('Glasscheibe (N)', [5, 1, 5], { north: true });
  // --- Mauer: up/low/tall -----------------------------------------------------------------
  wall('Mauer Ende low, up=true', [7, 1, 4], true, { east: 'low' });
  wall('Mauer gerade low, up=false', [8, 1, 4], false, { east: 'low', west: 'low' });
  wall('Mauer Ende tall, up=true', [9, 1, 4], true, { west: 'tall' });
  block('Stein über Mauer (macht tall)', [9, 2, 4], 'stone');
  // --- Tür, Bett, Doppeltruhe, Fass ---------------------------------------------------------
  const door = { facing: 'east', hinge: 'right', open: 'false', powered: 'false' };
  block('Eichentür unten', [12, 1, 4], 'oak_door', { ...door, half: 'lower' });
  block('Eichentür oben', [12, 2, 4], 'oak_door', { ...door, half: 'upper' });
  // Bett: facing zeigt vom Fuß zum Kopf. Keine Block-Entity (seit 26.2 existiert keine mehr).
  block('Bett Kopf', [14, 1, 3], 'red_bed', { facing: 'north', part: 'head', occupied: 'false' });
  block('Bett Fuß', [14, 1, 4], 'red_bed', { facing: 'north', part: 'foot', occupied: 'false' });
  // Truhenpaar: type=left hat den Partner im Uhrzeigersinn von facing (north → Osten)
  block('Doppeltruhe links (LootTable)', [16, 1, 4], 'chest', { facing: 'north', type: 'left', waterlogged: 'false' }, {
    id: nbt.string('minecraft:chest'),
    LootTable: nbt.string('minecraft:chests/simple_dungeon'),
  });
  block('Doppeltruhe rechts (LootTable+Seed)', [17, 1, 4], 'chest', { facing: 'north', type: 'right', waterlogged: 'false' }, {
    id: nbt.string('minecraft:chest'),
    LootTable: nbt.string('minecraft:chests/simple_dungeon'),
    LootTableSeed: nbt.long(-1234567890123456789n),
  });
  block('Fass mit Items', [19, 1, 4], 'barrel', { facing: 'up', open: 'false' }, {
    id: nbt.string('minecraft:barrel'),
    Items: nbt.compounds([
      slotItem(dv, 0, 'minecraft:bread', 5),
      slotItem(dv, 4, 'minecraft:iron_ingot', 12),
      slotItem(dv, 13, 'minecraft:iron_sword', 1, {
        components: { 'minecraft:damage': nbt.int(10) },
        legacyTag: nbt.compound({ Damage: nbt.int(10) }),
      }),
    ]),
  });

  // --- Licht & Deko ---------------------------------------------------------------------------
  block('Decke für Laterne', [1, 4, 7], 'oak_planks');
  block(f.ironChain ? 'Eisenkette (iron_chain)' : 'Kette (chain)', [1, 3, 7], f.ironChain ? 'iron_chain' : 'chain', { axis: 'y', waterlogged: 'false' });
  block('Laterne hängend', [1, 2, 7], 'lantern', { hanging: 'true', waterlogged: 'false' });
  block('Steinziegel (Fackelhalter)', [3, 1, 7], 'stone_bricks');
  block('Wandfackel (facing=east)', [4, 1, 7], 'wall_torch', { facing: 'east' });
  block('Kerzen ×3 an', [6, 1, 7], 'candle', { candles: '3', lit: 'true', waterlogged: 'false' });
  block('Blumentopf mit Mohn', [8, 1, 7], 'potted_poppy');
  block('Lesepult mit Buch', [10, 1, 7], 'lectern', { facing: 'north', has_book: 'true', powered: 'false' }, {
    id: nbt.string('minecraft:lectern'),
    Book: writableBook(dv, ['Seite 1: Willkommen im Testraum!', 'Seite 2: Grüße aus dem Exporter (äöüß)']),
    Page: nbt.int(0),
  });
  block('Gemeißeltes Bücherregal (Slot 0+3)', [12, 1, 7], 'chiseled_bookshelf', {
    facing: 'south',
    slot_0_occupied: 'true', slot_1_occupied: 'false', slot_2_occupied: 'false',
    slot_3_occupied: 'true', slot_4_occupied: 'false', slot_5_occupied: 'false',
  }, {
    id: nbt.string('minecraft:chiseled_bookshelf'),
    Items: nbt.compounds([slotItem(dv, 0, 'minecraft:book', 1), slotItem(dv, 3, 'minecraft:book', 1)]),
    last_interacted_slot: nbt.int(3),
  });
  block('Schild mit Text (rotation=4)', [14, 1, 7], 'oak_sign', { rotation: '4', waterlogged: 'false' }, {
    id: nbt.string('minecraft:sign'),
    front_text: signSide(dv, ['Dungeon', 'Alchemist', 'Export-Test', 'Größe: 20x5x12']),
    back_text: signSide(dv, ['', 'Rückseite', '', '']),
    is_waxed: nbt.byte(0),
  });
  block('Banner (rotation=12, Muster)', [16, 1, 7], 'white_banner', { rotation: '12' }, {
    id: nbt.string('minecraft:banner'),
    ...bannerFields(dv, [{ color: 'red', pattern: 'minecraft:stripe_center' }, { color: 'black', pattern: 'minecraft:border' }]),
  });
  block('Eichenblätter persistent', [18, 1, 7], 'oak_leaves', { distance: '7', persistent: 'true', waterlogged: 'false' });

  // --- Stützblöcke für Entities -------------------------------------------------------------
  block('Wand für Rahmen (unten)', [2, 1, 10], 'stone_bricks');
  block('Wand für Rahmen (oben)', [2, 2, 10], 'stone_bricks');
  block('Sockel für liegenden Rahmen', [5, 1, 10], 'stone_bricks');
  for (const x of [8, 9]) for (const y of [1, 2]) block(`Wand für Gemälde (${x},${y})`, [x, y, 10], 'stone_bricks');

  // --- Entities -------------------------------------------------------------------------------
  const frameAt = (label: string, blockPos: [number, number, number], facing: AttachFacing, item: NbtCompound) => {
    const pitch = facing === 'up' ? -90 : facing === 'down' ? 90 : 0;
    const yaw = facing in DIR2D ? DIR2D[facing as keyof typeof DIR2D] * 90 : 0;
    out.push({
      label,
      entity: {
        pos: attachedPos(blockPos, facing),
        blockPos,
        nbt: nbt.compound({
          id: nbt.string('minecraft:item_frame'),
          Facing: nbt.byte(DIR3D[facing]),
          Item: item,
          ItemRotation: nbt.byte(0),
          ItemDropChance: nbt.float(1),
          Fixed: nbt.byte(0),
          Invisible: nbt.byte(0),
          Rotation: nbt.floats([yaw, pitch]),
        }),
      },
    });
  };
  frameAt('Rahmen an Wand mit Kompass', [2, 2, 11], 'south', itemStack(dv, 'minecraft:compass', 1));
  frameAt('Rahmen flach auf Oberseite (Diamant)', [5, 2, 10], 'up', itemStack(dv, 'minecraft:diamond', 1));
  const paintingPos: [number, number, number] = [8, 2, 11];
  out.push({
    label: 'Gemälde 2×1 (sunset)',
    entity: {
      pos: attachedPos(paintingPos, 'south'),
      blockPos: paintingPos,
      nbt: nbt.compound({
        id: nbt.string('minecraft:painting'),
        variant: nbt.string('minecraft:sunset'),
        facing: nbt.byte(DIR2D.south),
        Rotation: nbt.floats([0, 0]),
      }),
    },
  });
  out.push({
    label: 'Rüstungsständer mit Eisenhelm',
    entity: {
      pos: [12.5, 1, 10.5],
      blockPos: [12, 1, 10],
      nbt: nbt.compound({
        id: nbt.string('minecraft:armor_stand'),
        Rotation: nbt.floats([180, 0]),
        ShowArms: nbt.byte(1),
        ...equipmentFields(dv, { head: itemStack(dv, 'minecraft:iron_helmet', 1) }),
      }),
    },
  });
  return out;
}

export function buildTestVolume(dataVersion: number): ExportVolume {
  const entries = buildTestEntries(dataVersion);
  const blocks: ExportBlock[] = [];
  for (let x = 0; x < TESTSET_SIZE[0]; x++) {
    for (let z = 0; z < TESTSET_SIZE[2]; z++) blocks.push({ pos: [x, 0, z], name: 'minecraft:polished_andesite' });
  }
  for (const e of entries) if (e.block) blocks.push(e.block);
  return {
    name: 'da_t1_testset',
    author: 'Dungeon Alchemist Spike T1',
    dataVersion,
    size: TESTSET_SIZE,
    blocks,
    entities: entries.flatMap((e) => (e.entity ? [e.entity] : [])),
  };
}
