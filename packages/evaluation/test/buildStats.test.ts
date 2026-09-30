import { describe, expect, it } from 'vitest';
import { materialFamily, measureBuild, summarizeBuildStats, type StatsBlock, type Vec3i } from '../src/index.js';

class Vol {
  readonly blocks = new Map<string, StatsBlock>();
  constructor(readonly size: Vec3i) {}
  set(x: number, y: number, z: number, name: string, properties?: Record<string, string>): void {
    this.blocks.set(`${x},${y},${z}`, { pos: [x, y, z], name: `minecraft:${name}`, ...(properties !== undefined ? { properties } : {}) });
  }
  get volume() { return { size: this.size, blocks: [...this.blocks.values()] }; }
}

/** Kiste 7×7 aus Steinziegeln (Wände y 1..4) auf Grasboden, flaches Stufendach, 8 Glasscheiben; Baum und Hofzaun daneben. */
function boxHouse(): Vol {
  const v = new Vol([20, 10, 20]);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) v.set(x, 0, z, 'grass_block');
  for (let y = 1; y <= 4; y++) for (let x = 2; x <= 8; x++) for (let z = 2; z <= 8; z++) {
    if (x === 2 || x === 8 || z === 2 || z === 8) v.set(x, y, z, 'stone_bricks');
  }
  for (let x = 2; x <= 8; x++) for (let z = 2; z <= 8; z++) v.set(x, 5, z, 'stone_brick_slab', { type: 'bottom' });
  for (const [x, z] of [[4, 2], [6, 2], [4, 8], [6, 8], [2, 4], [2, 6], [8, 4], [8, 6]] as const) v.set(x, 2, z, 'glass_pane');
  // Baum weit weg
  for (let y = 1; y <= 4; y++) v.set(15, y, 15, 'oak_log');
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) v.set(15 + dx, 4, 15 + dz, 'oak_leaves');
  // Hofzaun: vom Haus (x=9) nach außen
  for (let x = 9; x <= 14; x++) v.set(x, 1, 5, 'oak_fence');
  v.set(10, 1, 12, 'short_grass');
  return v;
}

describe('Referenzstatistik (measureBuild)', () => {
  it('zieht Gelände, Pflanzen, Baum und Hofzaun ab und misst den Bau', () => {
    const s = measureBuild(boxHouse().volume);
    expect(s.groundY).toBe(0);
    expect([s.width, s.depth, s.height]).toEqual([8, 7, 5]); // 7 + ein angehängtes Zaunstück
    expect(s.footprint).toBe(50);
    // 4 Lagen × 24 Wandblöcke − 8 Scheiben = 88 Ziegel, 8 Scheiben, 49 Stufen, 1 Zaunstück (Zaun an Zaun hängt nicht an)
    expect(s.blocks).toBe(88 + 8 + 49 + 1);
    expect(s.distinctBlocks).toBe(4);
    expect(s.materialFamilies).toBe(3); // stone_brick, glass, oak
    expect([s.exteriorDistinctBlocks, s.exteriorFamilies]).toEqual([4, 3]);
    expect(s.nonFullShare).toBeCloseTo((8 + 49 + 1) / s.blocks, 10);
    expect(s.topBlocks[0]![0]).toBe('stone_bricks');
  });

  it('Fensteranteil = Glasflächen / Außenwandflächen; Flachdach erkannt', () => {
    const s = measureBuild(boxHouse().volume);
    // Wände: 4 Seiten × 7 × 4 Lagen = 112 Flächen, Dachrand 28
    expect(s.glassFaces).toBe(8);
    // Zaun verdeckt die Ziegelfläche dahinter; die Fläche darüber gilt als Sims (Bau-Material unter der Außenzelle).
    // Zäune selbst zählen nicht als Wand.
    expect(s.wallFaces).toBe(112 + 28 - 2);
    expect(s.windowShare).toBeCloseTo(8 / s.wallFaces, 10);
    expect(s.roofPitch).toBeNull();
    expect(s.flatShare).toBeGreaterThan(0.95);
  });

  it('Satteldach aus Treppen: 45°, Stufendach 0,5', () => {
    const v = new Vol([7, 8, 7]);
    for (let y = 0; y <= 2; y++) for (let x = 0; x <= 6; x++) for (let z = 0; z <= 6; z++) if (x === 0 || x === 6 || z === 0 || z === 6) v.set(x, y, z, 'spruce_planks');
    for (let k = 0; k <= 3; k++) for (let z = 0; z <= 6; z++) {
      if (k === 3) v.set(3, 6, z, 'spruce_planks');
      else { v.set(k, 3 + k, z, 'spruce_stairs'); v.set(6 - k, 3 + k, z, 'spruce_stairs'); }
    }
    const s = measureBuild(v.volume);
    expect(s.groundY).toBe(-1);
    expect(s.roofPitch).toBe(1);
    expect(s.roofPitchDeg).toBeCloseTo(45, 10);
    expect(s.height).toBe(7);

    const flat = new Vol([9, 6, 3]);
    for (let x = 0; x <= 8; x++) for (let z = 0; z <= 2; z++) {
      flat.set(x, 0, z, 'cobblestone');
      const h = Math.min(x, 8 - x); // 0..4 halbe Stufen je Block
      for (let y = 1; y <= Math.floor(h / 2); y++) flat.set(x, y, z, 'cobblestone');
      if (h % 2 === 1) flat.set(x, Math.floor(h / 2) + 1, z, 'cobblestone_slab', { type: 'bottom' });
    }
    expect(measureBuild(flat.volume).roofPitch).toBe(0.5);
  });

  it('Materialfamilien und Zusammenfassung', () => {
    expect(materialFamily('minecraft:stripped_oak_log')).toBe('oak');
    expect(materialFamily('oak_stairs')).toBe('oak');
    expect(materialFamily('stone_bricks')).toBe(materialFamily('stone_brick_stairs'));
    expect(materialFamily('white_stained_glass_pane')).toBe('white_glass');
    expect(materialFamily('mossy_cobblestone_wall')).toBe('cobblestone');
    expect(materialFamily('cracked_stone_bricks')).toBe('stone_brick');
    expect(materialFamily('polished_andesite')).toBe('andesite');
    const sum = summarizeBuildStats([measureBuild(boxHouse().volume), measureBuild(boxHouse().volume)]);
    expect(sum.find((x) => x.key === 'width')).toEqual({ key: 'width', n: 2, median: 8, p25: 8, p75: 8 });
    expect(sum.find((x) => x.key === 'roofPitch')!.n).toBe(0);
    expect(measureBuild({ size: [3, 3, 3], blocks: [] }).blocks).toBe(0);
  });
});
