import { nbt } from '@mcda/export';
import { describe, expect, it } from 'vitest';
import { AIR, blockState, Layer, Palette, stateKey, VoxelVolume } from '../src/index.js';

const stone = blockState('stone');
const planks = blockState('minecraft:oak_planks');
const chest = blockState('chest', { waterlogged: 'false', type: 'single', facing: 'north' });
const chestBe = nbt.compound({ id: nbt.string('minecraft:chest'), LootTable: nbt.string('minecraft:chests/simple_dungeon') });

describe('BlockState (Wertobjekt)', () => {
  it('ist kanonisch: ohne minecraft:, Properties sortiert, eingefroren', () => {
    const s = blockState(' minecraft:oak_stairs ', { half: 'bottom', facing: 'north' });
    expect(s.name).toBe('oak_stairs');
    expect(Object.keys(s.properties)).toEqual(['facing', 'half']);
    expect(Object.isFrozen(s) && Object.isFrozen(s.properties)).toBe(true);
    expect(stateKey(s)).toBe('oak_stairs[facing=north,half=bottom]');
    expect(blockState('mymod:lamp').name).toBe('mymod:lamp'); // fremder Namespace bleibt
  });

  it('lehnt kaputte Namen ab', () => {
    expect(() => blockState('')).toThrow();
    expect(() => blockState('minecraft:')).toThrow();
    expect(() => blockState('oak_stairs[facing=north]')).toThrow();
  });
});

describe('Palette (State-Interning)', () => {
  it('Luft ist Index 0; gleiche Zustände bekommen dieselbe Nummer', () => {
    const p = new Palette();
    expect(p.get(0)).toEqual(AIR);
    const a = p.intern(stone);
    expect(a).toBe(1);
    expect(p.intern(blockState('stone'))).toBe(a);
    expect(p.intern({ name: 'minecraft:stone', properties: {} })).toBe(a); // nicht-kanonische Schreibweise
    expect(p.intern({ name: 'chest', properties: { facing: 'north', type: 'single', waterlogged: 'false' } })).toBe(p.intern(chest));
    expect(p.intern(blockState('chest', { facing: 'south', type: 'single', waterlogged: 'false' }))).not.toBe(p.intern(chest));
    expect(p.size).toBe(4);
    expect(p.states().map(stateKey)).toEqual([
      'air', 'stone', 'chest[facing=north,type=single,waterlogged=false]', 'chest[facing=south,type=single,waterlogged=false]',
    ]);
  });

  it('idOf findet nur Bekanntes; unbekannte Nummern werfen', () => {
    const p = new Palette();
    expect(p.idOf(stone)).toBeUndefined();
    p.intern(stone);
    expect(p.idOf({ name: 'minecraft:stone', properties: {} })).toBe(1);
    expect(() => p.get(7)).toThrow(RangeError);
  });

  it('das Volumen interniert: 1000 gleiche Blöcke = ein Paletteneintrag', () => {
    const v = VoxelVolume.create([10, 10, 10]);
    for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) for (let z = 0; z < 10; z++) {
      v.place([x, y, z], { state: blockState('stone'), owner: 'terrain', layer: Layer.Terrain });
    }
    expect(v.palette.size).toBe(2); // Luft + Stein
  });
});

describe('VoxelVolume', () => {
  it('Weltkoordinaten ab origin; außerhalb wirft', () => {
    const v = VoxelVolume.create([4, 3, 2], [-10, 64, 5]);
    expect(v.contains([-10, 64, 5])).toBe(true);
    expect(v.contains([-7, 66, 6])).toBe(true);
    expect(v.contains([-6, 64, 5])).toBe(false);
    expect(v.contains([-10, 64, 4.5])).toBe(false);
    expect(() => v.stateAt([0, 0, 0])).toThrow(RangeError);
    expect(() => VoxelVolume.create([0, 1, 1])).toThrow(RangeError);
  });

  it('leere Zellen sind Luft ohne Herkunft; place speichert Zustand, Herkunft, Schicht, Block-Entity', () => {
    const v = VoxelVolume.create([3, 3, 3], [100, 0, 100]);
    expect(v.isEmpty([100, 0, 100])).toBe(true);
    expect(v.cell([100, 0, 100])).toBeUndefined();
    expect(v.stateAt([100, 0, 100])).toEqual(AIR);
    v.place([101, 1, 102], { state: chest, owner: 'p-7', layer: Layer.Furniture, blockEntity: chestBe });
    expect(v.cell([101, 1, 102])).toEqual({ pos: [101, 1, 102], state: chest, owner: 'p-7', layer: Layer.Furniture, blockEntity: chestBe });
    expect(v.isEmpty([101, 1, 102])).toBe(false);
  });

  it('replaceState ändert nur den Zustand (Autotiling), Herkunft/Schicht/Block-Entity bleiben', () => {
    const v = VoxelVolume.create([2, 1, 1]);
    v.place([0, 0, 0], { state: chest, owner: 'truhe', layer: Layer.Furniture, blockEntity: chestBe });
    const left = blockState('chest', { facing: 'north', type: 'left', waterlogged: 'false' });
    v.replaceState([0, 0, 0], left);
    expect(v.cell([0, 0, 0])).toEqual({ pos: [0, 0, 0], state: left, owner: 'truhe', layer: Layer.Furniture, blockEntity: chestBe });
    expect(() => v.replaceState([1, 0, 0], stone)).toThrow(/leerer Zelle/);
    expect(() => v.replaceState([0, 0, 0], AIR)).toThrow(/Block-Entity/);
  });

  it('Block-Entity: nur auf Blöcken; place ohne BE entfernt eine vorhandene', () => {
    const v = VoxelVolume.create([2, 1, 1]);
    expect(() => v.place([0, 0, 0], { state: AIR, owner: 'x', layer: Layer.Furniture, blockEntity: chestBe })).toThrow(/Luft mit Block-Entity/);
    expect(() => v.setBlockEntity([1, 0, 0], chestBe)).toThrow(/braucht einen Block/);
    v.place([0, 0, 0], { state: chest, owner: 'x', layer: Layer.Furniture, blockEntity: chestBe });
    v.place([0, 0, 0], { state: chest, owner: 'x', layer: Layer.Furniture });
    expect(v.cell([0, 0, 0])?.blockEntity).toBeUndefined();
    v.setBlockEntity([0, 0, 0], chestBe);
    expect(v.cell([0, 0, 0])?.blockEntity).toBe(chestBe);
  });

  it('clear leert die Zelle vollständig', () => {
    const v = VoxelVolume.create([1, 1, 1]);
    v.place([0, 0, 0], { state: chest, owner: 'x', layer: Layer.Furniture, blockEntity: chestBe });
    v.clear([0, 0, 0]);
    expect(v.cell([0, 0, 0])).toBeUndefined();
    expect(v.owners()).toEqual([]);
    v.place([0, 0, 0], { state: stone, owner: 'y', layer: Layer.Terrain }); // danach wieder frei
  });

  it('Entities: blockPos = floor(pos) als Default, muss im Volumen liegen', () => {
    const v = VoxelVolume.create([4, 4, 4], [10, 0, 10]);
    const stand = nbt.compound({ id: nbt.string('minecraft:armor_stand') });
    const e = v.addEntity({ pos: [11.5, 1, 12.5], nbt: stand, owner: 'staender', layer: Layer.Furniture });
    expect(e.blockPos).toEqual([11, 1, 12]);
    expect(() => v.addEntity({ pos: [20.5, 1, 12.5], nbt: stand, owner: 'x', layer: Layer.Furniture })).toThrow(RangeError);
    expect(() => v.addEntity({ pos: [11.5, 1, 12.5], nbt: stand, owner: '', layer: Layer.Furniture })).toThrow(/owner/);
  });
});

describe('Abfragen nach Herkunft (owner)', () => {
  const build = () => {
    const v = VoxelVolume.create([6, 3, 6], [-3, 0, -3]);
    for (let x = -3; x < 3; x++) for (let z = -3; z < 3; z++) v.place([x, 0, z], { state: planks, owner: 'shell', layer: Layer.Structure });
    v.place([0, 1, 0], { state: chest, owner: 'truhe#1', layer: Layer.Furniture, blockEntity: chestBe });
    v.place([1, 1, 0], { state: planks, owner: 'tisch#2', layer: Layer.Furniture });
    v.place([1, 2, 0], { state: blockState('lantern', { hanging: 'false', waterlogged: 'false' }), owner: 'lampe#3', layer: Layer.Furniture });
    v.addEntity({ pos: [-2.5, 1, -2.5], nbt: nbt.compound({ id: nbt.string('minecraft:armor_stand') }), owner: 'staender#4', layer: Layer.Furniture });
    return v;
  };

  it('owners(): alle Herkünfte mit Zellen oder Entities, sortiert', () => {
    expect(build().owners()).toEqual(['lampe#3', 'shell', 'staender#4', 'tisch#2', 'truhe#1']);
  });

  it('cellsOf / entitiesOf liefern genau die Blöcke und Entities einer Platzierung', () => {
    const v = build();
    expect(v.cellsOf('shell')).toHaveLength(36);
    expect(v.cellsOf('shell').every((c) => c.layer === Layer.Structure && c.pos[1] === 0)).toBe(true);
    expect(v.cellsOf('truhe#1')).toEqual([{ pos: [0, 1, 0], state: chest, owner: 'truhe#1', layer: Layer.Furniture, blockEntity: chestBe }]);
    expect(v.cellsOf('staender#4')).toEqual([]);
    expect(v.entitiesOf('staender#4').map((e) => e.blockPos)).toEqual([[-3, 1, -3]]);
    expect(v.cellsOf('gibt-es-nicht')).toEqual([]);
  });

  it('beim Überschreiben wechselt die Herkunft, ohne Zellen verschwindet der Owner', () => {
    const v = build();
    v.place([0, 2, 0], { state: AIR, owner: 'shell', layer: Layer.Structure }); // Innenraum-Luft der Hülle
    expect(v.cellsOf('shell')).toHaveLength(37);
    v.place([0, 2, 0], { state: blockState('candle', { candles: '1', lit: 'false', waterlogged: 'false' }), owner: 'kerze#5', layer: Layer.Attachment });
    expect(v.cellsOf('shell')).toHaveLength(36);
    expect(v.cellsOf('kerze#5').map((c) => c.pos)).toEqual([[0, 2, 0]]);
    v.clear([0, 2, 0]);
    v.place([1, 1, 0], { state: planks, owner: 'tisch#2', layer: Layer.Decorator }); // eigene Zelle neu
    expect(v.cellsOf('tisch#2')[0]?.layer).toBe(Layer.Decorator);
    v.clear([1, 2, 0]);
    expect(v.owners()).not.toContain('lampe#3');
    const cells = [...v.cells()];
    expect(cells).toHaveLength(36 + 2);
    expect(new Set(cells.map((c) => c.owner))).toEqual(new Set(['shell', 'truhe#1', 'tisch#2']));
  });
});
