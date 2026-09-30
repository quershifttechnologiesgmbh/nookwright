import { describe, expect, it } from 'vitest';
import { nbt } from '@mcda/export';
import { Layer, VoxelVolume, blockState } from '@mcda/voxel';
import { blockId, toStructure, type VoxelSource } from '../src/structure.js';
import { fitOrbit, orbitEye, orbitView, panOrbit, rotateOrbit, transformPoint, zoomOrbit, FOV_Y, MAX_DISTANCE } from '../src/camera.js';

function volume(): VoxelVolume {
  const v = VoxelVolume.create([4, 3, 4], [10, 64, -5]);
  const put = (pos: [number, number, number], name: string, props: Record<string, string> = {}): void =>
    v.place(pos, { state: blockState(name, props), owner: 'test', layer: Layer.Structure });
  put([10, 64, -5], 'stone');
  put([11, 64, -5], 'chest', { facing: 'north', type: 'left', waterlogged: 'false' });
  put([12, 64, -5], 'minecraft:chest', { facing: 'north', type: 'right', waterlogged: 'false' });
  put([13, 64, -5], 'chest', { facing: 'north', type: 'single', waterlogged: 'false' });
  put([10, 66, -2], 'oak_planks');
  put([11, 65, -4], 'air');
  v.addEntity({ pos: [10.5, 65.5, -4.03], blockPos: [10, 65, -4], owner: 'frame', layer: Layer.Attachment, nbt: nbt.compound({ id: nbt.string('minecraft:item_frame'), Facing: nbt.byte(3) }) });
  v.addEntity({ pos: [10.5, 64.5, -5], blockPos: [10, 64, -5], owner: 'frame', layer: Layer.Attachment, nbt: nbt.compound({ id: nbt.string('minecraft:glow_item_frame'), Facing: nbt.byte(1) }) });
  v.addEntity({ pos: [12.5, 65.5, -4], blockPos: [12, 65, -4], owner: 'frame', layer: Layer.Attachment, nbt: nbt.compound({ id: nbt.string('minecraft:item_frame'), Facing: nbt.byte(1), Invisible: nbt.byte(1) }) });
  return v;
}

describe('VoxelVolume → deepslate Structure', () => {
  it('lokale Koordinaten, Luft entfällt, Doppeltruhen und Rahmen als synthetische Blöcke', () => {
    const src: VoxelSource = volume(); // VoxelVolume erfüllt die Lesesicht strukturell
    const { structure, blocks, blockIds } = toStructure(src);
    expect(structure.getSize()).toEqual([4, 3, 4]);
    expect(blocks).toBe(6); // 5 Blöcke + 1 Rahmen (Rahmen in belegter Zelle und unsichtbarer Rahmen entfallen)
    expect(structure.getBlock([0, 0, 0])!.state.getName().toString()).toBe('minecraft:stone');
    expect(structure.getBlock([1, 0, 0])!.state.toString()).toBe('mcda:double_chest_normal[facing=north,type=left,waterlogged=false]');
    expect(structure.getBlock([2, 0, 0])!.state.getProperty('type')).toBe('right');
    expect(structure.getBlock([3, 0, 0])!.state.getName().toString()).toBe('minecraft:chest');
    expect(structure.getBlock([0, 2, 3])!.state.getName().toString()).toBe('minecraft:oak_planks');
    expect(structure.getBlock([1, 1, 1])).toBeNull(); // Luft
    expect(structure.getBlock([0, 1, 1])!.state.toString()).toBe('mcda:item_frame[facing=south]');
    expect(blockIds).toEqual(['mcda:double_chest_normal', 'mcda:item_frame', 'minecraft:chest', 'minecraft:oak_planks', 'minecraft:stone']);
  });

  it('Schnitt: nur Blöcke bis maxY (Welt-y)', () => {
    const { structure, blocks } = toStructure(volume(), { maxY: 64 });
    expect(blocks).toBe(4);
    expect(structure.getBlock([0, 2, 3])).toBeNull();
    expect(toStructure(volume(), { entities: false }).blocks).toBe(5);
  });

  it('Namensraum', () => {
    expect(blockId('oak_stairs')).toBe('minecraft:oak_stairs');
    expect(blockId('create:shaft')).toBe('create:shaft');
  });
});

describe('Orbit-Kamera', () => {
  const o = { target: [5, 2, 7] as const, yaw: 0.7, pitch: 0.4, distance: 12 };
  const close = (a: readonly number[], b: readonly number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));

  it('Ziel liegt vor der Kamera auf der Blickachse, Auge im Ursprung', () => {
    const view = orbitView(o);
    close(transformPoint(view, o.target), [0, 0, -12]);
    close(transformPoint(view, orbitEye(o)), [0, 0, 0]);
    expect(orbitEye(o)[1]).toBeGreaterThan(o.target[1]); // pitch > 0 → von oben
  });

  it('Drehen begrenzt die Neigung, Zoomen den Abstand', () => {
    expect(rotateOrbit(o, 0, 10).pitch).toBeLessThan(Math.PI / 2);
    expect(rotateOrbit(o, 0, -10).pitch).toBeGreaterThan(-Math.PI / 2);
    expect(zoomOrbit(o, 1000).distance).toBe(MAX_DISTANCE);
    expect(zoomOrbit(o, 0.5).distance).toBe(6);
  });

  it('Verschieben bewegt das Ziel quer zur Blickrichtung', () => {
    const p = panOrbit(o, 0.1, -0.05);
    const before = transformPoint(orbitView(p), o.target);
    expect(before[2]).toBeCloseTo(-12, 5); // gleiche Tiefe
    expect(before[0]).toBeGreaterThan(0); // Szene wandert nach rechts
    expect(before[1]).toBeGreaterThan(0); // Maus nach oben → Szene nach oben
  });

  it('Einpassen: alle Ecken des Volumens im Sichtkegel', () => {
    const size = [25, 11, 14] as const;
    const fit = fitOrbit(size, 1.6);
    const view = orbitView(fit);
    const tanY = Math.tan(FOV_Y / 2), tanX = tanY * 1.6;
    for (const x of [0, size[0]]) for (const y of [0, size[1]]) for (const z of [0, size[2]]) {
      const [vx, vy, vz] = transformPoint(view, [x, y, z]);
      expect(vz).toBeLessThan(0);
      expect(Math.abs(vx / vz)).toBeLessThanOrEqual(tanX);
      expect(Math.abs(vy / vz)).toBeLessThanOrEqual(tanY);
    }
    const eye = orbitEye(fit);
    expect(eye[0]).toBeGreaterThan(size[0] / 2); // Blick von Südosten
    expect(eye[2]).toBeGreaterThan(size[2] / 2);
  });
});
