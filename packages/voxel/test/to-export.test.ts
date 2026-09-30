import {
  attachedPos, DV, EXPORT_FORMATS, itemStack, nbt, parseSpongeTag, parseStructureTag, prepareVolume, readNbtFileSync,
  slotItem, type ExportVolume,
} from '@mcda/export';
import { exportFile, importFile, nodeGzip } from '@mcda/export/node';
import { describe, expect, it } from 'vitest';
import { AIR, blockState, Layer, toExportVolume, VoxelVolume } from '../src/index.js';

const ORIGIN = [-8, 63, 20] as const;
const SIZE = [7, 4, 6] as const;

/** Kleiner Raum in Weltkoordinaten: Boden, Wand mit Tür-Ausschnitt, Truhe, Tisch, Rahmen, Rüstungsständer. */
function buildRoom(dataVersion: number): VoxelVolume {
  const v = VoxelVolume.create(SIZE, ORIGIN);
  const [ox, oy, oz] = ORIGIN;
  const planks = blockState('spruce_planks');
  const bricks = blockState('stone_bricks');
  for (let x = 0; x < SIZE[0]; x++) for (let z = 0; z < SIZE[2]; z++) {
    v.place([ox + x, oy, oz + z], { state: planks, owner: 'shell', layer: Layer.Structure });
    for (let y = 1; y < SIZE[1]; y++) v.place([ox + x, oy + y, oz + z], { state: AIR, owner: 'shell', layer: Layer.Structure });
  }
  // Nordwand (z = 0) aus Steinziegeln, Tür bei x = 3 mit carve
  for (let x = 0; x < SIZE[0]; x++) for (let y = 1; y < SIZE[1]; y++) {
    v.place([ox + x, oy + y, oz], { state: bricks, owner: 'shell', layer: Layer.Structure });
  }
  const door = (half: string) => blockState('oak_door', { facing: 'south', half, hinge: 'left', open: 'false', powered: 'false' });
  v.place([ox + 3, oy + 1, oz], { state: door('lower'), owner: 'tuer#1', layer: Layer.Architecture, permit: 'carve' });
  v.place([ox + 3, oy + 2, oz], { state: door('upper'), owner: 'tuer#1', layer: Layer.Architecture, permit: 'carve' });
  v.place([ox + 3, oy + 3, oz], { state: AIR, owner: 'tuer#1', layer: Layer.Architecture, permit: 'carve' }); // Oberlicht-Luft
  // Möbel
  v.place([ox + 1, oy + 1, oz + 4], {
    state: blockState('chest', { facing: 'north', type: 'single', waterlogged: 'false' }),
    owner: 'truhe#2', layer: Layer.Furniture,
    blockEntity: nbt.compound({
      id: nbt.string('minecraft:chest'),
      Items: nbt.compounds([slotItem(dataVersion, 0, 'bread', 3), slotItem(dataVersion, 5, 'iron_ingot', 2)]),
    }),
  });
  v.place([ox + 5, oy + 1, oz + 3], { state: blockState('oak_fence', { east: 'false', north: 'false', south: 'false', waterlogged: 'false', west: 'false' }), owner: 'tisch#3', layer: Layer.Furniture });
  v.place([ox + 5, oy + 2, oz + 3], { state: blockState('oak_pressure_plate', { powered: 'false' }), owner: 'tisch#3', layer: Layer.Furniture });
  // Rahmen an der Nordwand (hängt in der Luftzelle davor), Rüstungsständer frei
  const frameBlock = [ox + 1, oy + 2, oz + 1] as const;
  v.addEntity({
    pos: attachedPos(frameBlock, 'south'),
    nbt: nbt.compound({
      id: nbt.string('minecraft:item_frame'), Facing: nbt.byte(3), Item: itemStack(dataVersion, 'compass'),
      Rotation: nbt.floats([0, 0]),
    }),
    owner: 'rahmen#4', layer: Layer.Attachment,
  });
  v.addEntity({
    pos: [ox + 5.5, oy + 1, oz + 1.5],
    nbt: nbt.compound({ id: nbt.string('minecraft:armor_stand'), Rotation: nbt.floats([180, 0]) }),
    owner: 'staender#5', layer: Layer.Furniture,
  });
  return v;
}

/** Vergleichbare Normalform (kanonische States, typisiertes NBT, sortiert) aus @mcda/export. */
function normalized(v: ExportVolume) {
  const p = prepareVolume(v);
  return { dataVersion: p.dataVersion, size: p.size, blocks: p.blocks, entities: p.entities };
}

describe('toExportVolume', () => {
  it('lokale Koordinaten, Luft entfällt, Block-Entities und Entities gehen mit, Meta wird übernommen', () => {
    const vox = buildRoom(DV.MC_1_21_11);
    const ev = toExportVolume(vox, { name: 'raum', author: 'test', dataVersion: DV.MC_1_21_11 });
    expect(ev).toMatchObject({ name: 'raum', author: 'test', dataVersion: DV.MC_1_21_11, size: [7, 4, 6] });
    const nonAir = [...vox.cells()].filter((c) => c.state.name !== 'air');
    expect(ev.blocks).toHaveLength(nonAir.length);
    const door = ev.blocks.find((b) => b.name === 'oak_door' && b.properties?.['half'] === 'lower');
    expect(door?.pos).toEqual([3, 1, 0]);
    expect(ev.blocks.find((b) => b.name === 'chest')?.blockEntity).toBe(vox.cell([-7, 64, 24])?.blockEntity);
    expect(ev.blocks.some((b) => b.pos[0] === 3 && b.pos[1] === 3 && b.pos[2] === 0)).toBe(false); // carve-Luft
    expect(ev.entities.map((e) => e.blockPos)).toEqual([[1, 2, 1], [5, 1, 1]]);
    expect(ev.entities[0]!.pos).toEqual([1.5, 2.5, 1.03125]);
    expect(prepareVolume(ev).warnings).toEqual([]);
    expect(toExportVolume(vox, { name: 'x', dataVersion: 1 })).not.toHaveProperty('author');
  });

  for (const dv of [DV.MC_1_21_1, DV.MC_1_21_11, DV.MC_26_3]) {
    it(`Round-Trip durch alle drei Writer (DataVersion ${dv})`, () => {
      const ev = toExportVolume(buildRoom(dv), { name: 'raum', dataVersion: dv });
      for (const fmt of EXPORT_FORMATS) {
        const back = importFile(fmt, exportFile(fmt, ev, { date: 0 }));
        expect(normalized(back), fmt).toEqual(normalized(ev));
      }
    });
  }

  it('Export-Paletten enthalten nur benutzte Zustände (überschriebene fallen weg)', () => {
    const vox = VoxelVolume.create([2, 1, 1]);
    vox.place([0, 0, 0], { state: blockState('dirt'), owner: 'terrain', layer: Layer.Terrain });
    vox.place([0, 0, 0], { state: blockState('stone_bricks'), owner: 'shell', layer: Layer.Structure });
    expect(vox.palette.size).toBe(3); // Luft, Erde, Ziegel
    const ev = toExportVolume(vox, { name: 'p', dataVersion: DV.MC_26_3 });
    expect(ev.blocks.map((b) => b.name)).toEqual(['stone_bricks']);
    expect(parseSpongeTag(readNbtFileSync(exportFile('schem', ev), nodeGzip).root).paletteSize).toBe(2); // Luft + Ziegel
    const nbtRead = parseStructureTag(readNbtFileSync(exportFile('nbt', ev), nodeGzip).root);
    expect(nbtRead.explicitAir).toBe(1);
    expect(nbtRead.volume.blocks.map((b) => b.name)).toEqual(['minecraft:stone_bricks']);
  });
});
