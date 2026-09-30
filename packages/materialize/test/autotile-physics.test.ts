/**
 * Autotiling (Fälle aus Spike T4 übernommen) und Physik-Regeln (Faktencheck 3/4/15, In-Game T3)
 * direkt auf einem kleinen Voxel-Volumen.
 */
import type { Vec3 } from '@mcda/core';
import { Layer, VoxelVolume, blockState } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { WorldView, checkPairs, checkSupport, pairChests, resolveConnections, resolveStairs } from '../src/index.js';
import { platformView } from './fixtures.js';

type B = readonly [Vec3, string, Record<string, string>?];

function world(blocks: readonly B[], version = '26.3'): WorldView {
  const platform = platformView(version);
  const vol = VoxelVolume.create([7, 4, 7], [-3, -1, -3]);
  for (const [pos, name, props] of blocks) {
    const s = platform.registry.resolveState(name, props ?? {});
    vol.place(pos, { state: blockState(s.name, s.properties), owner: 't', layer: Layer.Furniture });
  }
  return new WorldView(vol, platform);
}

const at = (w: WorldView, p: Vec3): Record<string, string> => ({ ...w.state(p).properties });
const conn = (w: WorldView, p: Vec3) => {
  const s = at(w, p);
  return { N: s['north'], E: s['east'], S: s['south'], W: s['west'] };
};
const st = (facing: string, half = 'bottom'): Record<string, string> => ({ facing, half });

describe('Treppen-shape', () => {
  it('Außenecke, Innenecke, outer vor inner, verschiedene half beeinflussen sich nicht', () => {
    const w = world([[[0, 0, 0], 'oak_stairs', st('north')], [[0, 0, -1], 'oak_stairs', st('east')], [[2, 0, 0], 'oak_stairs', st('north')], [[2, 0, 1], 'oak_stairs', st('west')], [[-2, 0, 0], 'oak_stairs', st('north')], [[-2, 0, -1], 'oak_stairs', st('east', 'top')]]);
    resolveStairs(w);
    expect(at(w, [0, 0, 0])['shape']).toBe('outer_right');
    expect(at(w, [2, 0, 0])['shape']).toBe('inner_left');
    expect(at(w, [-2, 0, 0])['shape']).toBe('straight');
  });

  it('Treppenring (Walmdach-Spitze) → 4 × outer', () => {
    const w = world([[[0, 0, 0], 'oak_stairs', st('south')], [[0, 0, 1], 'oak_stairs', st('east')], [[1, 0, 1], 'oak_stairs', st('north')], [[1, 0, 0], 'oak_stairs', st('west')]]);
    resolveStairs(w);
    for (const p of [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]] as const) expect(at(w, p)['shape']).toMatch(/^outer_/);
  });
});

describe('Zaun / Scheibe / Mauer', () => {
  it('Zaun: Holz ↔ Holz ja, Netherziegel/Scheibe/Mauer nein', () => {
    const w = world([[[0, 0, 0], 'oak_fence'], [[0, 0, -1], 'spruce_fence'], [[1, 0, 0], 'nether_brick_fence'], [[0, 0, 1], 'glass_pane'], [[-1, 0, 0], 'cobblestone_wall']]);
    resolveConnections(w);
    expect(conn(w, [0, 0, 0])).toEqual({ N: 'true', E: 'false', S: 'false', W: 'false' });
  });

  it('Zaun: Glas (volle Fläche) ja, Blätter nein, Tor quer ja, Treppen-Rückseite nur zugewandt', () => {
    const w = world([[[0, 0, 0], 'oak_fence'], [[0, 0, -1], 'glass'], [[1, 0, 0], 'oak_leaves'], [[0, 0, 1], 'oak_fence_gate', { facing: 'east' }], [[-1, 0, 0], 'oak_stairs', st('west')]]);
    resolveConnections(w);
    expect(conn(w, [0, 0, 0])).toEqual({ N: 'true', E: 'false', S: 'true', W: 'false' });
    const w2 = world([[[0, 0, 0], 'oak_fence'], [[-1, 0, 0], 'oak_stairs', st('east')]]);
    resolveConnections(w2);
    expect(conn(w2, [0, 0, 0]).W).toBe('true');
  });

  it('Scheibe: mit Scheibe/Gitter, Mauer, Vollblock – nicht mit Zaun', () => {
    const w = world([[[0, 0, 0], 'glass_pane'], [[0, 0, -1], 'iron_bars'], [[1, 0, 0], 'cobblestone_wall'], [[0, 0, 1], 'oak_fence'], [[-1, 0, 0], 'stone']]);
    resolveConnections(w);
    expect(conn(w, [0, 0, 0])).toEqual({ N: 'true', E: 'true', S: 'false', W: 'true' });
  });

  it('Mauer: frei → Pfosten; gerade → low ohne Pfosten; Block darüber → tall; Fackel darüber hebt Pfosten', () => {
    const lone = world([[[0, 0, 0], 'cobblestone_wall']]);
    resolveConnections(lone);
    expect(at(lone, [0, 0, 0])).toMatchObject({ north: 'none', up: 'true' });
    const line: B[] = [[[0, 0, -1], 'cobblestone_wall'], [[0, 0, 0], 'cobblestone_wall'], [[0, 0, 1], 'cobblestone_wall']];
    const straight = world(line);
    resolveConnections(straight);
    expect(at(straight, [0, 0, 0])).toMatchObject({ north: 'low', south: 'low', east: 'none', up: 'false' });
    expect(at(straight, [0, 0, -1])['up']).toBe('true'); // Ende
    const covered = world([...line, [[0, 1, 0], 'stone']]);
    resolveConnections(covered);
    expect(at(covered, [0, 0, 0])).toMatchObject({ north: 'tall', south: 'tall', up: 'false' });
    const torch = world([...line, [[0, 1, 0], 'torch']]);
    resolveConnections(torch);
    expect(at(torch, [0, 0, 0])).toMatchObject({ north: 'low', up: 'true' });
    const stacked = world([...line, ...line.map(([p, n]) => [[p[0], 1, p[2]], n] as B)]);
    resolveConnections(stacked);
    expect(at(stacked, [0, 0, 0])).toMatchObject({ north: 'tall', up: 'false' });
    expect(at(stacked, [0, 1, 0])).toMatchObject({ north: 'low' });
  });

  it('Zauntor neben Mauern → in_wall', () => {
    const w = world([[[0, 0, 0], 'oak_fence_gate', { facing: 'north' }], [[1, 0, 0], 'cobblestone_wall'], [[-1, 0, 0], 'cobblestone_wall']]);
    resolveConnections(w);
    expect(at(w, [0, 0, 0])['in_wall']).toBe('true');
  });
});

describe('Truhen, Betten, Türen', () => {
  it('Dreierreihe Einzeltruhen → Paar (left bei CW(facing)) + Einzeltruhe', () => {
    const w = world([[[0, 0, 0], 'chest', { facing: 'north' }], [[1, 0, 0], 'chest', { facing: 'north' }], [[2, 0, 0], 'chest', { facing: 'north' }], [[0, 0, 2], 'chest', { facing: 'south' }], [[1, 0, 2], 'trapped_chest', { facing: 'south' }]]);
    pairChests(w);
    expect([0, 1, 2].map((x) => at(w, [x, 0, 0])['type'])).toEqual(['left', 'right', 'single']);
    expect(at(w, [0, 0, 2])['type']).toBe('single'); // andere Blockart koppelt nicht
    expect(checkPairs(w)).toEqual([]);
  });

  it('Truhenhälfte ohne Partner → Warnung und single; Bett-/Tür-Hälfte ohne Partner → Fehler', () => {
    const w = world([
      [[0, 0, 0], 'chest', { facing: 'north', type: 'left' }],
      [[2, 0, 0], 'red_bed', { facing: 'north', part: 'head' }],
      [[-2, 0, 0], 'oak_door', { facing: 'north', half: 'lower' }],
    ]);
    const v = checkPairs(w);
    expect(v.map((x) => [x.kind, x.severity, x.block])).toEqual([
      ['door_half', 'error', 'oak_door'],
      ['chest_pair', 'warning', 'chest'],
      ['bed_half', 'error', 'red_bed'],
    ]);
    expect(at(w, [0, 0, 0])['type']).toBe('single');
  });
});

describe('Stütze und Schwerkraft', () => {
  const kinds = (w: WorldView) => checkSupport(w).map((v) => [v.kind, v.block]);

  it('Teppich: auf Zaun ok, über Luft nicht; Blumentopf und Kerze schweben erlaubt', () => {
    expect(kinds(world([[[0, 0, 0], 'oak_fence'], [[0, 1, 0], 'red_carpet'], [[2, 1, 0], 'flower_pot'], [[-2, 1, 0], 'candle']]))).toEqual([]);
    expect(kinds(world([[[0, 1, 0], 'red_carpet']]))).toEqual([['support', 'red_carpet']]);
  });

  it('Laterne hängend: unter Scheibe/Kette/Zaun ok, unter Blättern und waagerechter Kette nicht', () => {
    for (const ok of ['glass_pane', 'oak_fence', 'stone', 'oak_slab']) {
      expect(kinds(world([[[0, 2, 0], ok], [[0, 1, 0], 'lantern', { hanging: 'true' }]])), ok).toEqual([]);
    }
    expect(kinds(world([[[0, 2, 0], 'iron_chain', { axis: 'y' }], [[0, 1, 0], 'lantern', { hanging: 'true' }]]))).toEqual([]);
    expect(kinds(world([[[0, 2, 0], 'iron_chain', { axis: 'x' }], [[0, 1, 0], 'lantern', { hanging: 'true' }]]))).toEqual([['support', 'lantern']]);
    expect(kinds(world([[[0, 2, 0], 'oak_leaves'], [[0, 1, 0], 'lantern', { hanging: 'true' }]]))).toEqual([['support', 'lantern']]);
    expect(kinds(world([[[0, 2, 0], 'oak_slab', { type: 'top' }], [[0, 1, 0], 'lantern', { hanging: 'true' }]]))).toEqual([['support', 'lantern']]);
  });

  it('Fackel: Wandfackel an Glas ok (volle Fläche), an Zaun nicht; Bodenfackel auf Zaun ok (Mitte)', () => {
    expect(kinds(world([[[0, 1, -1], 'glass'], [[0, 1, 0], 'wall_torch', { facing: 'south' }]]))).toEqual([]);
    expect(kinds(world([[[0, 1, -1], 'oak_fence'], [[0, 1, 0], 'wall_torch', { facing: 'south' }]]))).toEqual([['support', 'wall_torch']]);
    expect(kinds(world([[[0, 0, 0], 'oak_fence'], [[0, 1, 0], 'torch']]))).toEqual([]);
  });

  it('Druckplatte auf Zaun ok, Tür oben braucht untere Hälfte, Amboss fällt über Luft', () => {
    expect(kinds(world([[[0, 0, 0], 'oak_fence'], [[0, 1, 0], 'oak_pressure_plate']]))).toEqual([]);
    expect(kinds(world([[[0, 1, 0], 'oak_door', { half: 'upper', facing: 'north' }]]))).toEqual([['support', 'oak_door']]);
    expect(kinds(world([[[0, 1, 0], 'anvil']]))).toEqual([['gravity', 'anvil']]);
    expect(kinds(world([[[0, 0, 0], 'stone'], [[0, 1, 0], 'anvil']]))).toEqual([]);
  });
});
