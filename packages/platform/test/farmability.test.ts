/**
 * W3-BL: Preset „Nur leicht farmbar“ und Ersatz-Kandidaten – jede ID existiert in beiden Zielversionen, die
 * Familien-Suche liefert Blöcke derselben Form; Materiallisten-Gegenstände (Wandformen, zweiteilige Blöcke).
 */
import { describe, expect, it } from 'vitest';
import { BLOCK_SUBSTITUTES, HARD_TO_FARM, HARD_TO_FARM_BLOCKS, blockItem, familyOfBlock, familySubstitutes, hardToFarmReason, stackSize, wallVariants } from '../src/index.js';
import { loadFamilies, loadRegistry } from '../src/node.js';

const VERSIONS = ['1.21.11', '26.3'] as const;

describe('Preset „Nur leicht farmbar“', () => {
  it('jede Gruppe hat einen Grund; keine ID doppelt; jede ID existiert in beiden Zielversionen', () => {
    for (const g of HARD_TO_FARM) expect(g.why.length, g.id).toBeGreaterThan(10);
    expect(new Set(HARD_TO_FARM_BLOCKS).size).toBe(HARD_TO_FARM.flatMap((g) => g.blocks).length);
    for (const v of VERSIONS) {
      const r = loadRegistry(v);
      expect(HARD_TO_FARM_BLOCKS.filter((b) => !r.hasBlock(b)), v).toEqual([]);
    }
    expect(hardToFarmReason('sea_lantern')).toMatch(/Ozeanmonument/);
    expect(hardToFarmReason('stone')).toBeUndefined();
  });

  it('Ersatz-Kandidaten existieren in beiden Versionen, keiner steht selbst im Preset (außer Lichter unter sich)', () => {
    for (const v of VERSIONS) {
      const r = loadRegistry(v);
      for (const [from, list] of Object.entries(BLOCK_SUBSTITUTES)) {
        expect(r.hasBlock(from), `${v} ${from}`).toBe(true);
        expect(list.filter((b) => !r.hasBlock(b)), `${v} ${from}`).toEqual([]);
        // jeder Preset-Block ohne Familie hat mindestens einen erlaubten Kandidaten
        if (HARD_TO_FARM_BLOCKS.includes(from)) expect(list.some((b) => !HARD_TO_FARM_BLOCKS.includes(b)), from).toBe(true);
      }
    }
  });

  it('jeder Preset-Block hat einen Weg zum Ersatz: kuratiert oder nächstes Familienmitglied', () => {
    for (const v of VERSIONS) {
      const fam = loadFamilies(v);
      for (const b of HARD_TO_FARM_BLOCKS) {
        const ok = (BLOCK_SUBSTITUTES[b] ?? []).some((x) => !HARD_TO_FARM_BLOCKS.includes(x)) || familySubstitutes(fam, b).some((x) => !HARD_TO_FARM_BLOCKS.includes(x));
        expect(ok, `${v} ${b}`).toBe(true);
      }
    }
  });

  it('nächstes Familienmitglied: gleiche Form, gleiche Art zuerst, nach Farbe', () => {
    const fam = loadFamilies('1.21.11');
    expect(familyOfBlock(fam, 'prismarine_brick_stairs')).toEqual({ family: 'prismarine_bricks', shape: 'stairs' });
    const subs = familySubstitutes(fam, 'prismarine_brick_stairs');
    expect(subs.length).toBeGreaterThan(3);
    expect(subs.every((b) => b.endsWith('_stairs'))).toBe(true);
    expect(familySubstitutes(fam, 'end_stone_bricks').filter((b) => !HARD_TO_FARM_BLOCKS.includes(b))[0]).toMatch(/sandstone/);
    expect(familySubstitutes(fam, 'sea_lantern')).toEqual([]);
  });
});

describe('Gegenstände der Materialliste', () => {
  it('Wandformen zählen als Gegenstand, obere Hälften und Bettköpfe nicht, Kerzen/Stufen nach Anzahl', () => {
    expect(blockItem('wall_torch')).toEqual({ item: 'torch', count: 1 });
    expect(blockItem('oak_wall_sign')).toEqual({ item: 'oak_sign', count: 1 });
    expect(blockItem('skeleton_wall_skull')).toEqual({ item: 'skeleton_skull', count: 1 });
    expect(blockItem('oak_door', { half: 'upper' })).toBeUndefined();
    expect(blockItem('oak_door', { half: 'lower' })).toEqual({ item: 'oak_door', count: 1 });
    expect(blockItem('red_bed', { part: 'head' })).toBeUndefined();
    expect(blockItem('candle', { candles: '3' })).toEqual({ item: 'candle', count: 3 });
    expect(blockItem('stone_slab', { type: 'double' })).toEqual({ item: 'stone_slab', count: 2 });
    expect(blockItem('potted_fern')).toEqual({ item: 'flower_pot', count: 1 });
    expect(blockItem('air')).toBeUndefined();
    expect(blockItem('water')).toBeUndefined();
    expect(stackSize('oak_sign')).toBe(16);
    expect(stackSize('red_bed')).toBe(1);
    expect(stackSize('stone')).toBe(64);
  });

  it('wallVariants: Sperre eines Gegenstands trifft auch seine Wandform', () => {
    expect(wallVariants('torch')).toEqual(['wall_torch']);
    expect(wallVariants('soul_torch')).toEqual(['soul_wall_torch']);
    expect(wallVariants('oak_hanging_sign')).toEqual(['oak_wall_hanging_sign']);
    expect(wallVariants('zombie_head')).toEqual(['zombie_wall_head']);
    expect(wallVariants('stone')).toEqual([]);
    expect(wallVariants('oak_wall_sign')).toEqual([]);
    for (const v of VERSIONS) {
      const r = loadRegistry(v);
      for (const item of ['torch', 'soul_torch', 'oak_sign', 'oak_hanging_sign', 'white_banner', 'skeleton_skull', 'zombie_head']) {
        for (const w of wallVariants(item)) expect(r.hasBlock(w), `${v} ${w}`).toBe(true);
      }
    }
  });
});
