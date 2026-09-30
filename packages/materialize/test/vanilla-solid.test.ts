/**
 * Spike M2: `isSolid` und das Kollisionsmodell der Stützprüfung (hanging.ts) gegen die exakten Vanilla-
 * Kollisionsformen (PrismarineJS-Rohdaten der Plattform, `packages/platform/raw`, nicht eingecheckt – der Test
 * läuft nur, wenn die Rohdaten per `npm run fetch -w @mcda/platform` vorliegen).
 * Regel `BlockStateBase#isSolid` ohne forceSolidOn/Off: mittlere Kante der AABB ≥ 35/48 oder Höhe ≥ 1.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Layer, VoxelVolume, blockState } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { WorldView, collisionBoxes, isSolid } from '../src/index.js';
import { platformView } from './fixtures.js';

const RAW = fileURLToPath(new URL('../../platform/raw/prismarine/', import.meta.url));

interface PState { name: string; type: 'bool' | 'enum' | 'int'; num_values: number; values?: string[] }
interface PBlock { name: string; minStateId: number; maxStateId: number; states?: PState[] }
interface PShapes { blocks: Record<string, number | number[]>; shapes: Record<string, number[][]> }

function load(dir: string): { blocks: PBlock[]; shapes: PShapes } {
  return {
    blocks: JSON.parse(readFileSync(`${RAW}${dir}/blocks.json`, 'utf8')) as PBlock[],
    shapes: JSON.parse(readFileSync(`${RAW}${dir}/blockCollisionShapes.json`, 'utf8')) as PShapes,
  };
}

/** Alle Zustände eines Blocks (Prismarine-Reihenfolge: letzte Property läuft am schnellsten). */
function* states(b: PBlock): Generator<[number, Record<string, string>]> {
  const props = b.states ?? [];
  const vals = props.map((s) => (s.type === 'bool' ? ['true', 'false'] : s.values ?? []));
  for (let i = 0; i <= b.maxStateId - b.minStateId; i++) {
    let r = i;
    const st: Record<string, string> = {};
    for (let k = props.length - 1; k >= 0; k--) {
      const v = vals[k]!;
      st[props[k]!.name] = v[r % v.length]!;
      r = Math.floor(r / v.length);
    }
    yield [i, st];
  }
}

function exactSolid(boxes: number[][]): boolean {
  if (boxes.length === 0) return false;
  const mn = [9, 9, 9], mx = [-9, -9, -9];
  for (const b of boxes) for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k]!, b[k]!);
    mx[k] = Math.max(mx[k]!, b[k + 3]!);
  }
  const size = (mx[0]! - mn[0]! + mx[1]! - mn[1]! + mx[2]! - mn[2]!) / 3;
  return size >= 0.7291666666666666 || mx[1]! - mn[1]! >= 1;
}

/** Namen mit forceSolidOn/Off (Kollision entscheidet dort nicht) – siehe vanilla.ts. */
const FORCED = (n: string): boolean => n.endsWith('lantern') || n.endsWith('_sign') || n.endsWith('_banner') || n.endsWith('_pressure_plate')
  || n === 'cobweb' || n === 'bell' || n === 'chain' || n.endsWith('_chain') || n === 'amethyst_cluster' || n.endsWith('_amethyst_bud')
  || n.endsWith('_fence_gate') || n === 'cake' || n.endsWith('candle_cake') || n === 'turtle_egg' || n === 'sniffer_egg' || n.endsWith('lightning_rod')
  || n === 'pointed_dripstone' || n === 'conduit' || n === 'dried_ghast' || n === 'ladder' || n === 'snow' || n === 'scaffolding' || n === 'end_rod'
  || n === 'big_dripleaf' || n === 'chorus_plant' || n === 'chorus_flower' || n === 'azalea' || n === 'flowering_azalea';

const CASES = [['1.21.11', '1.21.11'], ['26.3', '26.1']] as const;

describe.skipIf(!existsSync(`${RAW}1.21.11/blockCollisionShapes.json`))('isSolid gegen exakte Kollisionsformen (Rohdaten)', () => {
  for (const [version, dir] of CASES) {
    it.skipIf(!existsSync(`${RAW}${dir}/blocks.json`))(`${version}: jeder Zustand jedes Blocks`, () => {
      const { blocks, shapes } = load(dir);
      const platform = platformView(version);
      const view = new WorldView(VoxelVolume.create([1, 1, 1], [0, 0, 0]), platform);
      const wrong: string[] = [];
      let n = 0;
      for (const b of blocks) {
        const shp = shapes.blocks[b.name];
        if (shp === undefined || !platform.registry.hasBlock(b.name) || FORCED(b.name)) continue;
        for (const [i, props] of states(b)) {
          if (!platform.registry.isValidState(b.name, props, { complete: true })) continue;
          const want = exactSolid(shapes.shapes[String(Array.isArray(shp) ? shp[i] : shp)] ?? []);
          const got = isSolid(view.infoOf(blockState(b.name, props)));
          n++;
          if (got !== want && wrong.length < 20) wrong.push(`${b.name}${JSON.stringify(props)}: isSolid=${got}, Form=${want}`);
        }
      }
      expect(n).toBeGreaterThan(20000);
      expect(wrong).toEqual([]);
    });
  }

  it('Kollisionsboxen von Zaun, Mauer, Zauntor, Gitter = Vanilla (1/16-Raster, alle Zustände)', () => {
    const { blocks, shapes } = load('1.21.11');
    const platform = platformView('1.21.11');
    const view = new WorldView(VoxelVolume.create([1, 1, 1], [0, 0, 0]), platform);
    const inside = (bs: readonly { min: readonly number[]; max: readonly number[] }[], p: readonly number[]): boolean =>
      bs.some((b) => [0, 1, 2].every((k) => p[k]! > b.min[k]! && p[k]! < b.max[k]!));
    const wrong: string[] = [];
    for (const name of ['oak_fence', 'nether_brick_fence', 'cobblestone_wall', 'oak_fence_gate', 'iron_bars', 'glass_pane']) {
      const b = blocks.find((x) => x.name === name)!;
      const shp = shapes.blocks[name]!;
      for (const [i, props] of states(b)) {
        if (props['waterlogged'] === 'true' || props['in_wall'] === 'true' || props['powered'] === 'true') continue;
        const want = (shapes.shapes[String(Array.isArray(shp) ? shp[i] : shp)] ?? []).map((a) => ({ min: a.slice(0, 3), max: a.slice(3) }));
        const s = platform.registry.resolveState(name, props);
        const got = collisionBoxes(view.infoOf(blockState(s.name, s.properties)));
        for (let x = 0.5; x < 16 && wrong.length < 10; x++) for (let y = 0.5; y < 24; y++) for (let z = 0.5; z < 16; z++) {
          const p = [x / 16, y / 16, z / 16];
          if (inside(want, p) !== inside(got, p)) {
            wrong.push(`${name}${JSON.stringify(props)} bei ${p.map((v) => v * 16)}`);
            y = 99; x = 99; z = 99;
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

it('Kollisionsmodell ohne Rohdaten: Zaun ragt 1/2 Block nach oben, Arm zur verbundenen Seite', () => {
  const platform = platformView('1.21.11');
  const vol = VoxelVolume.create([1, 1, 1], [0, 0, 0]);
  vol.place([0, 0, 0], { state: blockState('oak_fence', { ...platform.registry.resolveState('oak_fence', { north: 'true' }).properties }), owner: 't', layer: Layer.Furniture });
  const boxes = collisionBoxes(new WorldView(vol, platform).info([0, 0, 0]));
  expect(Math.max(...boxes.map((b) => b.max[1]))).toBe(1.5);
  expect(boxes.some((b) => b.min[2] === 0)).toBe(true);
});
