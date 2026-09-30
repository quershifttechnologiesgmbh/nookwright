/** Lichtdurchlässigkeit laut In-Game-Test (plan/spikes/T5_mechanik.md). */
import type { Vec3 } from '@mcda/core';
import { Layer, VoxelVolume, blockState } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { WorldView, computeLight } from '../src/index.js';
import { platformView } from './fixtures.js';

/** Laterne bei x=0, Prüfblock bei x=1, Messpunkt bei x=2 – 1×1-Gang, kein Weg drumherum. */
function lightBehind(block: string, props: Record<string, string> = {}): number {
  const platform = platformView('1.21.11');
  const vol = VoxelVolume.create([3, 1, 1], [0, 0, 0]);
  const put = (pos: Vec3, name: string, p: Record<string, string> = {}) => {
    const s = platform.registry.resolveState(name, p);
    vol.place(pos, { state: blockState(s.name, s.properties), owner: 't', layer: Layer.Furniture });
  };
  put([0, 0, 0], 'lantern');
  put([1, 0, 0], block, props);
  return computeLight(new WorldView(vol, platform)).levelAt([2, 0, 0]);
}

describe('Licht geht durch Glas, Türen, Falltüren, Teppich – nicht durch Vollblöcke', () => {
  it.each([
    ['glass', {}],
    ['glass_pane', {}],
    ['oak_door', { facing: 'east', half: 'lower' }],
    ['oak_trapdoor', { facing: 'east', open: 'false', half: 'bottom' }],
    ['white_carpet', {}],
  ])('%s lässt Licht durch', (block, props) => {
    expect(lightBehind(block, props)).toBe(13); // 15 an der Quelle, −1 je Schritt
  });

  it('Stein blockt', () => {
    expect(lightBehind('stone')).toBe(0);
  });
});
