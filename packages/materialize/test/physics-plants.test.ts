/** Pflanzen-Stützregeln (Wunsch Gelände-Agent) und automatische Blätter-Persistenz. */
import type { Vec3 } from '@mcda/core';
import { Layer, VoxelVolume, blockState } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { KindIndex, WorldView, checkSupport, finalizeState } from '../src/index.js';
import { platformView } from './fixtures.js';

type B = readonly [Vec3, string, Record<string, string>?];

function violations(blocks: readonly B[]): string[] {
  const platform = platformView('1.21.11');
  const vol = VoxelVolume.create([3, 3, 3], [-1, -1, -1]);
  for (const [pos, name, props] of blocks) {
    const s = platform.registry.resolveState(name, props ?? {});
    vol.place(pos, { state: blockState(s.name, s.properties), owner: 't', layer: Layer.Furniture });
  }
  return checkSupport(new WorldView(vol, platform)).map((v) => v.block ?? '');
}

describe('Pflanzen-Stütze', () => {
  it('Feldfrucht nur auf Ackerland', () => {
    expect(violations([[[0, -1, 0], 'farmland'], [[0, 0, 0], 'wheat']])).toEqual([]);
    expect(violations([[[0, -1, 0], 'dirt'], [[0, 0, 0], 'wheat']])).toEqual(['wheat']);
  });

  it('Blume auf Gras/Erde, nicht auf Stein', () => {
    expect(violations([[[0, -1, 0], 'grass_block'], [[0, 0, 0], 'poppy']])).toEqual([]);
    expect(violations([[[0, -1, 0], 'stone'], [[0, 0, 0], 'poppy']])).toEqual(['poppy']);
  });

  it('Blätter brauchen keine Stütze', () => {
    expect(violations([[[0, 1, 0], 'oak_leaves'], [[0, 0, 0], 'flowering_azalea_leaves']])).toEqual([]);
  });
});

describe('Blätter werden automatisch persistent', () => {
  it('finalizeState setzt persistent=true, außer explizit anders', () => {
    const reg = platformView('1.21.11').registry;
    const kinds = new KindIndex(reg);
    expect(finalizeState(reg, 'oak_leaves', kinds.of('oak_leaves'), {}, 'test').properties['persistent']).toBe('true');
    expect(finalizeState(reg, 'oak_leaves', kinds.of('oak_leaves'), { persistent: 'false' }, 'test').properties['persistent']).toBe('false');
  });
});
