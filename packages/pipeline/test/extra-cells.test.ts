import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ShellCell } from '@mcda/blueprint';
import { Layer } from '@mcda/voxel';
import { buildWorld, furnishRooms, shellFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { sampleHouse } from './helpers.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

describe('Vertrag: Zusatz-Zellen aus anderen Kontexten (terrain/plant/fort)', () => {
  it('werden mit der Hülle materialisiert, auf der richtigen Schicht', () => {
    const project = sampleHouse('1.21.11', 'medieval');
    const shell = shellFor(project);
    furnishRooms(project, shell, ctx.catalog);
    const extra: ShellCell[] = [
      { pos: [-5, 0, -5], kind: 'terrain', role: 'floor_primary', shape: 'block' },
      { pos: [-5, 1, -8], kind: 'fort', role: 'wall_primary', shape: 'block' },
    ];
    const world = buildWorld(project, ctx, shell, extra);
    const v = world.materialized.volume;
    expect(v.cell([-5, 0, -5])?.layer).toBe(Layer.Terrain);
    expect(v.cell([-5, 1, -8])?.layer).toBe(Layer.Structure);
    expect(world.materialized.violations.filter((x) => x.kind !== 'spawn')).toEqual([]);
  });
});
