/** Bauplan-Ausgabe (DR5 K2): Ebenen, Palette, Materialliste mit Stapeln/Shulker-Kisten, Markdown und CSV. */
import { describe, expect, it } from 'vitest';
import type { ExportBlock, ExportVolume } from '@mcda/export';
import { EXPORT_DISCLAIMER, GUIDE_GRID_MAX, OUTPUT_LICENSE_DRAFT, buildGuide, buildGuideCsv, buildGuideMarkdown, stacksOf } from '@mcda/pipeline';

const vol = (blocks: ExportBlock[], size: [number, number, number] = [3, 3, 2]): ExportVolume =>
  ({ name: 'Testbau', dataVersion: 4671, size, blocks, entities: [] });

// 3 × 2 Grundfläche: Ebene 0 Stein (6), Ebene 1 Tür (unten + oben) und 2 Planken, Ebene 2 Wasser (kein Gegenstand)
const sample = vol([
  ...[0, 1, 2].flatMap((x) => [0, 1].map((z) => ({ pos: [x, 0, z] as const, name: 'minecraft:stone' }))),
  { pos: [0, 1, 0], name: 'minecraft:oak_door', properties: { half: 'lower' } },
  { pos: [0, 2, 0], name: 'minecraft:oak_door', properties: { half: 'upper' } },
  { pos: [1, 1, 0], name: 'oak_planks' },
  { pos: [2, 1, 1], name: 'oak_planks' },
  { pos: [1, 2, 1], name: 'minecraft:water' },
  { pos: [2, 2, 1], name: 'minecraft:air' },
]);

describe('buildGuide', () => {
  it('Stapel, Plätze, Shulker-Kisten', () => {
    expect(stacksOf(0)).toEqual({ fullStacks: 0, remainder: 0, slots: 0, shulkerBoxes: 0 });
    expect(stacksOf(64)).toEqual({ fullStacks: 1, remainder: 0, slots: 1, shulkerBoxes: 1 });
    expect(stacksOf(4212)).toEqual({ fullStacks: 65, remainder: 52, slots: 66, shulkerBoxes: 3 });
    expect(stacksOf(17, 16)).toEqual({ fullStacks: 1, remainder: 1, slots: 2, shulkerBoxes: 1 });
  });

  it('Materialliste und Ebenen wie die Materialliste (obere Türhälfte, Wasser, Luft zählen nicht)', () => {
    const g = buildGuide(sample);
    expect(g.materials.map((m) => [m.item, m.count])).toEqual([['stone', 6], ['oak_planks', 2], ['oak_door', 1]]);
    expect(g.count).toBe(9);
    expect(g.slots).toBe(3);
    expect(g.shulkerBoxes).toBe(1);
    expect(g.layers.map((l) => [l.y, l.count])).toEqual([[0, 6], [1, 3]]);
    expect(g.layers[1]!.items).toEqual([{ item: 'oak_planks', count: 2 }, { item: 'oak_door', count: 1 }]);
    expect(g.legend).toBeUndefined();
  });

  it('unabhängig von der Reihenfolge der Blöcke', () => {
    const reversed = vol([...sample.blocks].reverse());
    expect(buildGuide(reversed, { grids: true })).toEqual(buildGuide(sample, { grids: true }));
  });

  it('Raster: Zeile = z, Spalte = x, Legende nach Menge; zu große Grundfläche wird ausgelassen', () => {
    const g = buildGuide(sample, { grids: true });
    expect(g.legend).toEqual([{ symbol: 'A', item: 'stone' }, { symbol: 'B', item: 'oak_planks' }, { symbol: 'C', item: 'oak_door' }]);
    expect(g.layers[0]!.rows).toEqual(['AAA', 'AAA']);
    expect(g.layers[1]!.rows).toEqual(['CB.', '..B']);
    // Ebene 2 hat nur die obere Türhälfte und Wasser: kein Gegenstand, also keine eigene Ebene
    expect(g.layers).toHaveLength(2);
    const big = buildGuide(vol([{ pos: [0, 0, 0], name: 'stone' }], [GUIDE_GRID_MAX + 1, 1, 1]), { grids: true });
    expect(big.gridsOmitted).toBe(true);
    expect(big.layers[0]!.rows).toBeUndefined();
  });

  it('Markdown: Maße, Tabelle, Ebenen, Raster, Nutzungshinweis und Disclaimer', () => {
    const md = buildGuideMarkdown(buildGuide(sample, { grids: true }));
    expect(md).toContain('# Bauplan: Testbau');
    expect(md).toContain('Maße: 3 × 3 × 2');
    expect(md).toContain('| stone | 6 | 6 | 1 | 1 |');
    expect(md).toContain('### Ebene 2 (y = 1): 3 Gegenstände');
    expect(md).toContain('```\nCB.\n..B\n```');
    expect(md).toContain(OUTPUT_LICENSE_DRAFT);
    expect(md).toContain(EXPORT_DISCLAIMER);
    expect(OUTPUT_LICENSE_DRAFT).toMatch(/Entwurf/);
  });

  it('CSV: Kopfzeile, eine Zeile je Gegenstand, Summe', () => {
    const csv = buildGuideCsv(buildGuide(sample));
    expect(csv.split('\n')).toEqual([
      'block,count,stack_size,full_stacks,remainder,slots,shulker_boxes',
      'stone,6,64,0,6,1,1',
      'oak_planks,2,64,0,2,1,1',
      'oak_door,1,64,0,1,1,1',
      'TOTAL,9,,,,3,1',
      '',
    ]);
  });
});
