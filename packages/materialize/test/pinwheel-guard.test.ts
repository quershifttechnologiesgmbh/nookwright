/**
 * W8-G Windrad-Wächter der fertigen Welt (`pinwheel-guard.ts`): findet chirale 4-zählige Figuren in Schichten,
 * Draufsicht und Fassaden und behebt sie deterministisch an der Quelle der Zufallsmischung.
 */
import type { Vec3 } from '@mcda/core';
import { Layer, VoxelVolume, blockState } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { WorldView, guardPinwheels, scanPinwheels, visualClass } from '../src/index.js';
import { platformView } from './fixtures.js';

type B = readonly [Vec3, string, Record<string, string>?];
const PINWHEEL4 = [[0, 1, 0, 0], [0, 1, 1, 1], [1, 1, 1, 0], [0, 0, 1, 0]];
const PLUS = [[0, 1, 0], [1, 1, 1], [0, 1, 0]];

function world(size: Vec3, blocks: readonly B[]): WorldView {
  const platform = platformView('1.21.11');
  const vol = VoxelVolume.create(size, [0, 0, 0]);
  for (const [pos, name, props] of blocks) {
    const s = platform.registry.resolveState(name, props ?? {});
    vol.place(pos, { state: blockState(s.name, s.properties), owner: 't', layer: Layer.Architecture });
  }
  return new WorldView(vol, platform);
}

/** Boden aus `ground` (y = 0), darauf eine Bitmap aus `top` (y = 1) oder im Boden selbst (`inGround`). */
function yard(bmp: number[][], ground: string, top: string, at: [number, number], inGround = false): B[] {
  const out: B[] = [];
  const on = (x: number, z: number): boolean => bmp[z - at[1]]?.[x - at[0]] === 1;
  for (let z = 0; z < 10; z++) {
    for (let x = 0; x < 10; x++) {
      out.push([[x, 0, z], inGround && on(x, z) ? top : ground]);
      if (!inGround && on(x, z)) out.push([[x, 1, z], top]);
    }
  }
  return out;
}

const names = (v: WorldView): string => {
  const out: string[] = [];
  for (const c of v.volume.cells()) out.push(`${c.pos.join(',')}=${c.state.name}`);
  return out.join(' ');
};

describe('W8-G Windrad-Wächter', () => {
  it('Dornbusch-Windrad der Streuung (farmhouse/desert/19): gefunden, Pflanzen entfernt, danach frei', () => {
    const v = world([10, 3, 10], yard(PINWHEEL4, 'sand', 'dead_bush', [3, 3]));
    expect(scanPinwheels(v).some((f) => f.cls === 'dead_bush')).toBe(true);
    const r = guardPinwheels(v);
    expect(r.found).toBeGreaterThan(0);
    expect(r.fixes.length).toBeGreaterThan(0);
    expect(r.fixes.every((f) => f.from === 'dead_bush' && f.to === 'air')).toBe(true);
    expect(r.unfixed).toEqual([]);
    expect(scanPinwheels(v)).toEqual([]);
    // der Boden bleibt, nur Pflanzen der Figur fehlen
    for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) expect(v.volume.stateAt([x, 0, z]).name).toBe('sand');
  });

  it('deterministisch: gleiche Welt → gleiche Änderungen', () => {
    const a = world([10, 3, 10], yard(PINWHEEL4, 'grass_block', 'poppy', [2, 4]));
    const b = world([10, 3, 10], yard(PINWHEEL4, 'grass_block', 'poppy', [2, 4]));
    expect(guardPinwheels(a)).toEqual(guardPinwheels(b));
    expect(names(a)).toBe(names(b));
  });

  it('Steinmischung (Andesit-Windrad im Bruchstein-Pflaster): Block nimmt den Nachbarstein an, keine Löcher', () => {
    const v = world([10, 2, 10], yard(PINWHEEL4, 'cobblestone', 'andesite', [3, 3], true));
    const r = guardPinwheels(v);
    expect(r.found).toBeGreaterThan(0);
    expect(r.fixes.every((f) => f.from === 'andesite' && f.to === 'cobblestone')).toBe(true);
    expect(scanPinwheels(v)).toEqual([]);
    for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) expect(v.volume.stateAt([x, 0, z]).name).not.toBe('air');
  });

  it('Fassade: Hakenkreuz aus Steinziegeln in einer Bretterwand (senkrechte Ebene) wird erkannt und gebrochen', () => {
    const blocks: B[] = [];
    const sw = [
      [1, 0, 1, 1, 1], [1, 0, 1, 0, 0], [1, 1, 1, 1, 1], [0, 0, 1, 0, 1], [1, 1, 1, 0, 1],
    ];
    for (let y = 0; y < 9; y++) for (let z = 0; z < 9; z++) blocks.push([[1, y, z], sw[y - 2]?.[z - 2] === 1 ? 'stone_bricks' : 'oak_planks']);
    for (let y = 0; y < 9; y++) for (let z = 0; z < 9; z++) blocks.push([[2, y, z], 'oak_planks']);
    const v = world([4, 9, 9], blocks);
    const found = scanPinwheels(v);
    expect(found.some((f) => f.plane === 'x' && f.cls === 'stone_bricks')).toBe(true);
    const r = guardPinwheels(v);
    expect(r.unfixed).toEqual([]);
    expect(r.fixes.every((f) => f.to === 'oak_planks')).toBe(true);
    expect(scanPinwheels(v)).toEqual([]);
  });

  it('Doppelpflanzen: beide Hälften fallen zusammen', () => {
    const blocks = yard(PINWHEEL4, 'grass_block', 'tall_grass', [3, 3]).map(([p, n]): B => (n === 'tall_grass' ? [p, n, { half: 'lower' }] : [p, n]));
    for (const [p, n] of [...blocks]) if (n === 'tall_grass') blocks.push([[p[0], 2, p[2]], 'tall_grass', { half: 'upper' }]);
    const v = world([10, 4, 10], blocks);
    const r = guardPinwheels(v);
    expect(r.fixes.length).toBeGreaterThan(0);
    for (const f of r.fixes) {
      expect(v.volume.stateAt([f.pos[0], 1, f.pos[2]]).name).toBe('air');
      expect(v.volume.stateAt([f.pos[0], 2, f.pos[2]]).name).toBe('air');
    }
    expect(scanPinwheels(v)).toEqual([]);
  });

  it('spiegelsymmetrisch (Plus aus Andesit, Tisch mit Stühlen) bleibt unberührt', () => {
    const plus = world([10, 2, 10], yard([[0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [1, 1, 1, 1, 1], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0]], 'cobblestone', 'andesite', [2, 2], true));
    const before = names(plus);
    expect(guardPinwheels(plus)).toEqual({ found: 0, fixes: [], unfixed: [], rounds: 0 });
    expect(names(plus)).toBe(before);
    const table = world([10, 3, 10], [
      ...yard(PLUS, 'oak_planks', 'oak_planks', [0, 0], true),
      ...[[4, 4], [5, 4], [4, 5], [5, 5]].map(([x, z]): B => [[x!, 1, z!], 'oak_planks']),
      ...[[4, 3], [5, 3], [6, 4], [6, 5], [4, 6], [5, 6], [3, 4], [3, 5]].map(([x, z]): B => [[x!, 1, z!], 'oak_stairs']),
    ]);
    expect(scanPinwheels(table)).toEqual([]);
  });

  it('nicht automatisch behebbar (Treppen-Windrad = Möbel): bleibt stehen und steht im Bericht', () => {
    const v = world([10, 3, 10], yard(PINWHEEL4, 'grass_block', 'oak_stairs', [3, 3]));
    const r = guardPinwheels(v);
    expect(r.found).toBeGreaterThan(0);
    expect(r.unfixed.length).toBeGreaterThan(0);
  });

  it('Sichtklassen: ähnliche Steine, Pflanzen, Holz, Boden', () => {
    expect(['andesite', 'cobblestone', 'mossy_cobblestone', 'gravel', 'stone_brick_stairs', 'tuff'].map(visualClass)).toEqual(Array(6).fill('grey_stone'));
    expect(['dead_bush', 'poppy', 'short_grass', 'tall_grass', 'wheat', 'pink_petals', 'bush', 'flowering_azalea'].map(visualClass)).toEqual(Array(8).fill('plant'));
    expect(['oak_planks', 'spruce_log', 'stripped_birch_wood', 'dark_oak_fence', 'oak_stairs'].map(visualClass)).toEqual(Array(5).fill('wood'));
    expect(['grass_block', 'sand', 'coarse_dirt', 'dirt_path'].map(visualClass)).toEqual(Array(4).fill('ground'));
    expect(visualClass('oak_leaves')).toBe('leaves');
    expect(visualClass('potted_dead_bush')).toBe('pot');
  });

  it('W9-Integration: Boden-Windrad zwischen dichter Streuung (Erdhaus-Hügel) – eine Pflanze im Loch entfällt, Boden bleibt', () => {
    // überall Gras mit Mohn darauf, nur die Windrad-Zellen bleiben frei: die Figur ist der Boden (Gras bzw. Klasse
    // ground), die Zellen selbst sind nicht zu ändern – wie auf dem Hügel zwischen Pflanzen und Laub
    const inv = Array.from({ length: 10 }, (_, z) => Array.from({ length: 10 }, (_, x) => (PINWHEEL4[z - 3]?.[x - 3] === 1 ? 0 : 1)));
    const v = world([10, 3, 10], yard(inv, 'grass_block', 'poppy', [0, 0]));
    expect(scanPinwheels(v).some((f) => f.plane === 'top' && f.cls === 'grass_block')).toBe(true);
    const r = guardPinwheels(v);
    expect(r.unfixed).toEqual([]);
    expect(r.fixes.length).toBeGreaterThan(0);
    expect(r.fixes.every((f) => f.from === 'poppy' && f.to === 'air')).toBe(true);
    expect(scanPinwheels(v)).toEqual([]);
    for (let z = 0; z < 10; z++) for (let x = 0; x < 10; x++) expect(v.volume.stateAt([x, 0, z]).name).toBe('grass_block');
  });
});
