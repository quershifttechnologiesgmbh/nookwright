import { describe, expect, it } from 'vitest';
import { convertBlocks, buildRegistry } from '../src/build/registry.js';
import { Registry, formatState, normalizeId, parseStateString, resolveTag } from '../src/index.js';
import { loadRegistry } from '../src/node.js';

const fixture = buildRegistry({
  version: 'test',
  dataVersion: 1,
  blocks: {
    stone: [{}, {}],
    oak_stairs: [
      {
        facing: ['north', 'south', 'west', 'east'],
        half: ['top', 'bottom'],
        shape: ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'],
        waterlogged: ['true', 'false'],
      },
      { facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'false' },
    ],
  },
  items: ['minecraft:stone', 'oak_stairs'],
  lootTables: ['blocks/stone'],
  blockTags: {
    stairs: { values: ['#minecraft:wooden_stairs'] },
    wooden_stairs: { values: ['minecraft:oak_stairs'] },
  },
});

describe('IDs und State-Strings', () => {
  it('normalisiert Namespace', () => {
    expect(normalizeId('minecraft:stone')).toBe('stone');
    expect(normalizeId(' stone ')).toBe('stone');
    expect(normalizeId('create:cogwheel')).toBe('create:cogwheel');
  });

  it('parst und formatiert States', () => {
    const s = parseStateString('minecraft:oak_stairs[half=top, facing=east]');
    expect(s).toEqual({ name: 'oak_stairs', properties: { half: 'top', facing: 'east' } });
    expect(formatState(s)).toBe('minecraft:oak_stairs[facing=east,half=top]');
    expect(parseStateString('stone')).toEqual({ name: 'stone', properties: {} });
    expect(() => parseStateString('oak_stairs[facing]')).toThrow();
    expect(() => parseStateString('oak_stairs[facing=east')).toThrow();
    expect(() => parseStateString('oak_stairs[a=1,a=2]')).toThrow();
  });
});

describe('Registry (Fixture)', () => {
  const reg = new Registry(fixture);

  it('isValidState / validateState', () => {
    expect(reg.isValidState('oak_stairs', { facing: 'east' })).toBe(true);
    expect(reg.isValidState('minecraft:oak_stairs', {})).toBe(true);
    expect(reg.isValidState('oak_stairs', { facing: 'up' })).toBe(false);
    expect(reg.isValidState('oak_stairs', { color: 'red' })).toBe(false);
    expect(reg.isValidState('oak_stairs', { facing: 'east' }, { complete: true })).toBe(false);
    expect(reg.isValidState('nope', {})).toBe(false);
    expect(reg.validateState('oak_stairs', { facing: 'up' })[0]).toMatchObject({ kind: 'invalid_value', property: 'facing' });
    expect(reg.validateState('oak_stairs', {}, { complete: true }).filter((i) => i.kind === 'missing_property')).toHaveLength(4);
  });

  it('defaultState / listProperties / resolveState / stateCount', () => {
    expect(reg.defaultState('oak_stairs')?.properties).toEqual({ facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'false' });
    expect(reg.defaultState('nope')).toBeUndefined();
    expect(reg.listProperties('oak_stairs')?.['half']).toEqual(['top', 'bottom']);
    expect(reg.listProperties('stone')).toEqual({});
    expect(reg.resolveState('oak_stairs', { half: 'top' }).properties['half']).toBe('top');
    expect(reg.resolveState('oak_stairs', { half: 'top' }).properties['facing']).toBe('north');
    expect(() => reg.resolveState('oak_stairs', { half: 'middle' })).toThrow();
    expect(reg.parseState('minecraft:oak_stairs[facing=west]').properties['facing']).toBe('west');
    expect(reg.stateCount('oak_stairs')).toBe(80);
    expect(reg.stateCount('stone')).toBe(1);
  });

  it('Items, Loot-Tables, verschachtelte Tags', () => {
    expect(reg.hasItem('minecraft:stone')).toBe(true);
    expect(reg.hasItem('diamond')).toBe(false);
    expect(reg.hasLootTable('minecraft:blocks/stone')).toBe(true);
    expect(reg.blockTag('#minecraft:stairs')).toEqual(['oak_stairs']);
    expect(reg.hasBlockTag('oak_stairs', 'stairs')).toBe(true);
    expect(reg.blockTag('unknown')).toEqual([]);
  });
});

describe('build/registry', () => {
  it('lehnt ungültige Defaults ab', () => {
    expect(() => convertBlocks({ x: [{ a: ['1', '2'] }, { a: '3' }] })).toThrow(/Default/);
  });
  it('erkennt Tag-Zyklen', () => {
    expect(() => resolveTag({ a: ['#b'], b: ['#a'] }, 'a')).toThrow(/Zyklisch/);
    expect(resolveTag({ a: ['x', '#b'], b: ['y', 'x'] }, 'a')).toEqual(['x', 'y']);
  });
});

describe('Registry (generierte Daten)', () => {
  const r1 = loadRegistry('1.21.1');
  const r11 = loadRegistry('1.21.11');
  const r26 = loadRegistry('26.3');

  it('DataVersions stimmen mit Recherche 04 §1 überein', () => {
    expect(r1.dataVersion).toBe(3955);
    expect(r11.dataVersion).toBe(4671);
    expect(r26.dataVersion).toBe(5023);
  });

  it('Banner-/Schild-Rotation: Default 0 → 8 seit 26.x (FC 16)', () => {
    expect(r11.defaultState('white_banner')?.properties['rotation']).toBe('0');
    expect(r26.defaultState('white_banner')?.properties['rotation']).toBe('8');
    expect(r26.defaultState('oak_sign')?.properties['rotation']).toBe('8');
    // Köpfe/Schädel behalten 0
    expect(r26.defaultState('skeleton_skull')?.properties['rotation']).toBe('0');
  });

  it('Versions-Gating einzelner Blöcke', () => {
    expect(r1.hasBlock('oak_shelf')).toBe(false);
    expect(r11.hasBlock('oak_shelf')).toBe(true);
    expect(r1.hasBlock('chain')).toBe(true);
    expect(r11.hasBlock('chain')).toBe(false);
    expect(r11.hasBlock('iron_chain')).toBe(true);
    expect(r26.hasBlock('poplar_planks')).toBe(true);
    expect(r26.hasBlock('white_wool_stairs')).toBe(true);
    expect(r26.hasBlock('straw_bed')).toBe(true);
    expect(r26.hasItem('white_cushion')).toBe(true);
    expect(r26.hasBlock('cushion')).toBe(false); // Kissen ist ein Entity
  });

  it('Shelf-States laut Faktencheck 10', () => {
    expect(Object.keys(r26.listProperties('oak_shelf') ?? {}).sort()).toEqual(['facing', 'powered', 'side_chain', 'waterlogged']);
    expect(r26.isValidState('oak_shelf', { side_chain: 'center' })).toBe(true);
  });

  it('Loot-Tables und Tags', () => {
    expect(r26.hasLootTable('chests/simple_dungeon')).toBe(true);
    expect(r26.blockTag('climbable')).toContain('ladder');
    expect(r26.blockTag('enchantment_power_provider')).toEqual(['bookshelf']);
    expect(r26.hasBlockTag('white_carpet', 'replaceable')).toBe(false); // FC 1: Teppich blockiert
  });
});
