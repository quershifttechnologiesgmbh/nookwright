/**
 * Dev-Galerie (nur `vite dev`): Blockmuster mit den Sonderfällen des Blockrenderers zur Sichtprüfung –
 * Treppenformen, Zäune/Scheiben/Mauer mit Verbindungen, Laternen (stehend/hängend), Fackeln, Kerzen, Betten,
 * Türen, Truhen (einzeln, doppelt in zwei Richtungen), Schilder, Banner, Rahmen, Kessel.
 * Übernommen aus der entfallenen Viewer-Demo (packages/viewer/demo/scenes.ts); rein, ohne DOM.
 */
import { nbt } from '@mcda/export';
import { Layer, VoxelVolume, blockState } from '@mcda/voxel';

type P = Record<string, string>;

/** Blockmuster: Reihen mit Sonderfällen auf einem Steinboden (19 × 5 × 15). */
export function showcase(): VoxelVolume {
  const v = VoxelVolume.create([19, 5, 15]);
  const put = (x: number, y: number, z: number, name: string, props: P = {}): void =>
    v.place([x, y, z], { state: blockState(name, props), owner: 'muster', layer: Layer.Structure });
  for (let x = 0; x < 19; x++) for (let z = 0; z < 15; z++) put(x, 0, z, (x + z) % 2 === 0 ? 'polished_andesite' : 'stone_bricks');

  // Reihe 1 (z = 1): Treppenformen
  const shapes = ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'];
  shapes.forEach((shape, i) => put(1 + i * 2, 1, 1, 'oak_stairs', { facing: 'north', half: 'bottom', shape, waterlogged: 'false' }));
  put(11, 1, 1, 'spruce_stairs', { facing: 'east', half: 'top', shape: 'straight', waterlogged: 'false' });
  put(13, 1, 1, 'spruce_slab', { type: 'bottom', waterlogged: 'false' });
  put(15, 1, 1, 'spruce_slab', { type: 'top', waterlogged: 'false' });

  // Reihe 2 (z = 3): Zaun mit Verbindungen, Zauntor, Scheiben
  for (let x = 1; x <= 5; x++) put(x, 1, 3, 'spruce_fence', { east: String(x < 5), west: String(x > 1), north: 'false', south: 'false', waterlogged: 'false' });
  put(6, 1, 3, 'spruce_fence_gate', { facing: 'north', in_wall: 'false', open: 'false', powered: 'false' });
  for (let x = 8; x <= 11; x++) put(x, 1, 3, 'glass_pane', { east: String(x < 11), west: String(x > 8), north: 'false', south: 'false', waterlogged: 'false' });
  put(13, 1, 3, 'cobblestone_wall', { east: 'low', west: 'none', north: 'none', south: 'tall', up: 'true', waterlogged: 'false' });
  put(15, 1, 3, 'oak_leaves', { distance: '1', persistent: 'true', waterlogged: 'false' });
  put(16, 1, 3, 'grass_block', { snowy: 'false' });

  // Reihe 3 (z = 5): Laternen (stehend/hängend), Fackeln, Kerzen, Topf
  put(1, 1, 5, 'lantern', { hanging: 'false', waterlogged: 'false' });
  put(3, 3, 5, 'oak_planks');
  put(3, 2, 5, 'lantern', { hanging: 'true', waterlogged: 'false' });
  put(5, 3, 5, 'oak_planks');
  put(5, 2, 5, 'iron_chain', { axis: 'y', waterlogged: 'false' });
  put(5, 1, 5, 'soul_lantern', { hanging: 'true', waterlogged: 'false' });
  put(7, 1, 5, 'torch');
  put(9, 1, 5, 'oak_planks');
  put(9, 1, 6, 'wall_torch', { facing: 'south' });
  put(11, 1, 5, 'candle', { candles: '3', lit: 'true', waterlogged: 'false' });
  put(13, 1, 5, 'potted_fern');
  put(15, 1, 5, 'bell', { attachment: 'floor', facing: 'north', powered: 'false' });

  // Reihe 4 (z = 8/9): Betten, Türen
  put(1, 1, 8, 'red_bed', { facing: 'south', occupied: 'false', part: 'head' });
  put(1, 1, 7, 'red_bed', { facing: 'south', occupied: 'false', part: 'foot' });
  put(3, 1, 7, 'white_bed', { facing: 'east', occupied: 'false', part: 'foot' });
  put(4, 1, 7, 'white_bed', { facing: 'east', occupied: 'false', part: 'head' });
  put(7, 1, 8, 'spruce_door', { facing: 'south', half: 'lower', hinge: 'left', open: 'false', powered: 'false' });
  put(7, 2, 8, 'spruce_door', { facing: 'south', half: 'upper', hinge: 'left', open: 'false', powered: 'false' });
  put(9, 1, 8, 'oak_door', { facing: 'south', half: 'lower', hinge: 'right', open: 'true', powered: 'false' });
  put(9, 2, 8, 'oak_door', { facing: 'south', half: 'upper', hinge: 'right', open: 'true', powered: 'false' });
  put(11, 1, 8, 'oak_trapdoor', { facing: 'south', half: 'bottom', open: 'false', powered: 'false', waterlogged: 'false' });
  put(13, 1, 8, 'crafting_table');
  put(14, 1, 8, 'furnace', { facing: 'south', lit: 'true' });
  put(15, 1, 8, 'barrel', { facing: 'up', open: 'false' });
  put(16, 1, 8, 'anvil', { facing: 'north' });

  // Reihe 5 (z = 11/12): Truhen (einzeln, doppelt in zwei Richtungen), Schilder, Banner, Rahmen
  put(1, 1, 12, 'chest', { facing: 'south', type: 'single', waterlogged: 'false' });
  put(3, 1, 12, 'chest', { facing: 'south', type: 'right', waterlogged: 'false' });
  put(4, 1, 12, 'chest', { facing: 'south', type: 'left', waterlogged: 'false' });
  put(6, 1, 11, 'trapped_chest', { facing: 'east', type: 'left', waterlogged: 'false' });
  put(6, 1, 12, 'trapped_chest', { facing: 'east', type: 'right', waterlogged: 'false' });
  put(8, 1, 12, 'oak_sign', { rotation: '0', waterlogged: 'false' });
  put(10, 1, 11, 'stone_bricks');
  put(10, 1, 12, 'spruce_wall_sign', { facing: 'south', waterlogged: 'false' });
  put(10, 2, 11, 'stone_bricks');
  put(10, 2, 12, 'blue_wall_banner', { facing: 'south' });
  put(12, 1, 12, 'red_banner', { rotation: '0' });
  put(14, 1, 11, 'stone_bricks');
  put(14, 2, 11, 'stone_bricks');
  v.addEntity({ pos: [14.5, 2.5, 12.03], blockPos: [14, 2, 12], owner: 'muster', layer: Layer.Attachment, nbt: nbt.compound({ id: nbt.string('minecraft:item_frame'), Facing: nbt.byte(3) }) });
  put(16, 1, 12, 'oak_hanging_sign', { attached: 'false', rotation: '0', waterlogged: 'false' });
  put(16, 2, 12, 'oak_planks');
  put(17, 1, 12, 'water_cauldron', { level: '3' });
  return v;
}
