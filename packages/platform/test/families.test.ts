import { describe, expect, it } from 'vitest';
import { deriveFamilies, representative } from '../src/build/families.js';
import { resolveMaterial, type FamilyData } from '../src/index.js';
import { loadFamilies } from '../src/node.js';

const NAMES = [
  // Holz inkl. Sonderfälle
  'oak_planks', 'oak_log', 'stripped_oak_log', 'oak_wood', 'stripped_oak_wood', 'oak_stairs', 'oak_slab', 'oak_leaves', 'oak_sapling',
  'crimson_planks', 'crimson_stem', 'stripped_crimson_stem', 'crimson_hyphae', 'stripped_crimson_hyphae', 'crimson_stairs', 'crimson_fungus', 'nether_wart_block',
  'bamboo_planks', 'bamboo_block', 'stripped_bamboo_block', 'bamboo_stairs', 'bamboo_mosaic', 'bamboo_mosaic_stairs', 'bamboo_mosaic_slab',
  'poplar_planks', 'poplar_log', 'red_poplar_leaves', 'yellow_poplar_leaves',
  // Stein
  'stone', 'stone_stairs', 'stone_slab', 'stone_button', 'stone_pressure_plate',
  'stone_bricks', 'stone_brick_stairs', 'stone_brick_slab', 'stone_brick_wall', 'cracked_stone_bricks', 'chiseled_stone_bricks', 'mossy_stone_bricks',
  'quartz_block', 'quartz_stairs', 'quartz_slab', 'quartz_pillar', 'chiseled_quartz_block',
  'calcite', 'deepslate', 'cobbled_deepslate', 'cobbled_deepslate_stairs', 'cobbled_deepslate_slab', 'cobbled_deepslate_wall',
  'nether_bricks', 'nether_brick_fence', 'petrified_oak_slab',
  // Kupfer
  'copper_block', 'exposed_copper', 'waxed_copper_block', 'waxed_exposed_copper', 'cut_copper', 'exposed_cut_copper_stairs',
  'lightning_rod', 'exposed_lightning_rod', 'waxed_exposed_copper_door',
  // Farben
  'white_wool', 'white_carpet', 'white_bed', 'white_wool_stairs', 'red_wool', 'red_carpet', 'white_concrete', 'white_concrete_powder',
  'white_terracotta', 'white_glazed_terracotta', 'terracotta', 'glass', 'glass_pane', 'white_stained_glass', 'candle', 'white_candle',
  // Rest
  'iron_block', 'iron_door', 'iron_bars', 'heavy_weighted_pressure_plate', 'moss_block', 'moss_carpet', 'lantern', 'soul_lantern',
];

describe('deriveFamilies (Fixture)', () => {
  const fd = deriveFamilies('fixture', NAMES);
  const fam = (id: string) => fd.families[id];

  it('Holz: Standard und Nether-Stamm/Hyphen', () => {
    expect(fam('oak')?.shapes).toMatchObject({ planks: 'oak_planks', log: 'oak_log', wood: 'oak_wood', stripped_wood: 'stripped_oak_wood', block: 'oak_planks' });
    expect(fam('crimson')?.shapes).toMatchObject({
      log: 'crimson_stem', stripped_log: 'stripped_crimson_stem', wood: 'crimson_hyphae', stripped_wood: 'stripped_crimson_hyphae',
      leaves: 'nether_wart_block', sapling: 'crimson_fungus',
    });
  });

  it('Bambus: bamboo_block als Stamm, Mosaik als eigene Familie', () => {
    expect(fam('bamboo')?.shapes['log']).toBe('bamboo_block');
    expect(fam('bamboo')?.shapes['mosaic']).toBe('bamboo_mosaic');
    expect(fam('bamboo')?.shapes['wood']).toBeUndefined();
    expect(fam('bamboo_mosaic')).toMatchObject({ kind: 'wood', shapes: { block: 'bamboo_mosaic', stairs: 'bamboo_mosaic_stairs' } });
  });

  it('Pappel: Laub in mehreren Farben als Alternativen', () => {
    expect(fam('poplar')?.shapes['leaves']).toBe('red_poplar_leaves');
    expect(fam('poplar')?.alternates?.['leaves']).toEqual(['red_poplar_leaves', 'yellow_poplar_leaves']);
  });

  it('Stein: Block-Form über Singular/Plural und _block', () => {
    expect(fam('stone_bricks')).toMatchObject({ kind: 'stone', shapes: { block: 'stone_bricks', stairs: 'stone_brick_stairs', wall: 'stone_brick_wall', cracked: 'cracked_stone_bricks', chiseled: 'chiseled_stone_bricks', mossy: 'mossy_stone_bricks' } });
    expect(fam('quartz')?.shapes).toMatchObject({ block: 'quartz_block', stairs: 'quartz_stairs', pillar: 'quartz_pillar', chiseled: 'chiseled_quartz_block' });
    expect(fam('stone')?.shapes).toMatchObject({ button: 'stone_button', pressure_plate: 'stone_pressure_plate' });
    expect(fam('nether_bricks')?.shapes['fence']).toBe('nether_brick_fence');
    expect(fam('calcite')).toMatchObject({ kind: 'stone', shapes: { block: 'calcite' } });
    expect(fd.ignored['petrified_oak_slab']).toBeDefined();
  });

  it('Kupfer: Stufen × gewachst, unregelmäßige Namen', () => {
    expect(fam('copper')?.shapes).toMatchObject({ block: 'copper_block', cut: 'cut_copper', lightning_rod: 'lightning_rod' });
    expect(fam('exposed_copper')?.shapes).toMatchObject({ block: 'exposed_copper', cut_stairs: 'exposed_cut_copper_stairs', stairs: 'exposed_cut_copper_stairs', lightning_rod: 'exposed_lightning_rod' });
    expect(fam('waxed_copper')?.shapes['block']).toBe('waxed_copper_block');
    expect(fam('waxed_exposed_copper')?.shapes).toMatchObject({ block: 'waxed_exposed_copper', door: 'waxed_exposed_copper_door' });
  });

  it('Farben: Wolle/Beton/Terrakotta/Glas je Farbstoff + Farb-Sicht', () => {
    expect(fam('white_wool')?.shapes).toMatchObject({ block: 'white_wool', stairs: 'white_wool_stairs', carpet: 'white_carpet', bed: 'white_bed' });
    expect(fam('white_concrete')?.shapes).toMatchObject({ block: 'white_concrete', powder: 'white_concrete_powder' });
    expect(fam('white_terracotta')?.shapes['glazed']).toBe('white_glazed_terracotta');
    expect(fam('glass')?.shapes).toMatchObject({ block: 'glass', pane: 'glass_pane' });
    expect(fam('color:white')?.shapes).toMatchObject({ wool: 'white_wool', candle: 'white_candle', stained_glass: 'white_stained_glass' });
    expect(fam('color:undyed')?.shapes).toMatchObject({ candle: 'candle', terracotta: 'terracotta', stained_glass: 'glass' });
  });

  it('Rest: Eisen (inkl. Laterne), Moos', () => {
    expect(fam('iron')).toMatchObject({
      kind: 'other',
      shapes: { block: 'iron_block', door: 'iron_door', bars: 'iron_bars', pressure_plate: 'heavy_weighted_pressure_plate', lantern: 'lantern' },
      alternates: { lantern: ['soul_lantern'] },
    });
    expect(fam('moss')?.shapes).toMatchObject({ block: 'moss_block', carpet: 'moss_carpet' });
  });

  it('Lücken und Fallbacks', () => {
    const g = fd.gaps.find((x) => x.family === 'calcite' && x.shape === 'stairs');
    expect(g).toBeDefined();
    expect(g?.fallback.length).toBeGreaterThan(0);
    // Namens-Token schlägt fehlende Farbe: deepslate → cobbled_deepslate
    const d = fd.gaps.find((x) => x.family === 'deepslate' && x.shape === 'wall');
    expect(d?.fallback[0]?.block).toBe('cobbled_deepslate_wall');
    // Holz ohne „wood“: zuerst gleiche Familie (bamboo_block)
    const b = fd.gaps.find((x) => x.family === 'bamboo' && x.shape === 'wood');
    expect(b?.fallback[0]).toMatchObject({ family: 'bamboo', block: 'bamboo_block' });
    // Wolle ohne Treppe in keiner Familie → shapeAbsentInKind
    const w = fd.gaps.find((x) => x.family === 'red_wool' && x.shape === 'stairs');
    expect(w?.shapeAbsentInKind).toBe(false); // white_wool_stairs existiert im Fixture
    expect(w?.fallback[0]?.block).toBe('white_wool_stairs');
  });

  it('resolveMaterial: direkt, über Lücken-Fallback und über Versions-Fallback', () => {
    expect(resolveMaterial(fd, 'oak', 'stairs')).toEqual({ block: 'oak_stairs', family: 'oak', shape: 'stairs', viaFallback: false });
    expect(resolveMaterial(fd, 'deepslate', 'stairs')).toMatchObject({ block: 'cobbled_deepslate_stairs', viaFallback: true });
    expect(resolveMaterial(fd, 'nope', 'stairs')).toBeUndefined();
    expect(representative({ shapes: { planks: 'a', block: 'b' } })).toBe('a');
    const withVf: FamilyData = { ...fd, versionFallbacks: { pale_oak: ['nope', 'oak'] } };
    expect(resolveMaterial(withVf, 'pale_oak', 'stairs')).toEqual({ block: 'oak_stairs', family: 'oak', shape: 'stairs', viaFallback: true });
  });
});

describe('Familien (generierte Daten)', () => {
  const f26 = loadFamilies('26.3');
  const f1 = loadFamilies('1.21.1');

  it('Holzfamilien je Version', () => {
    const woods = (fd: FamilyData) => Object.values(fd.families).filter((f) => f.kind === 'wood' && f.id !== 'bamboo_mosaic').map((f) => f.id).sort();
    expect(woods(f26)).toEqual(['acacia', 'bamboo', 'birch', 'cherry', 'crimson', 'dark_oak', 'jungle', 'mangrove', 'oak', 'pale_oak', 'poplar', 'spruce', 'warped']);
    expect(woods(f1)).not.toContain('pale_oak');
    expect(f1.versionFallbacks['pale_oak']?.length).toBeGreaterThan(0);
    expect(f1.versionFallbacks['poplar']?.length).toBeGreaterThan(0);
  });

  it('Kalzit hat keine Treppe → Fallback (Recherche 04 §10)', () => {
    expect(f26.families['calcite']?.shapes['stairs']).toBeUndefined();
    const r = resolveMaterial(f26, 'calcite', 'stairs');
    expect(r?.viaFallback).toBe(true);
    expect(r?.block).toMatch(/_stairs$/);
  });

  it('Regal: 1.21.1 fehlt in allen Holzarten, 26.3 inkl. Pappel vorhanden', () => {
    expect(f1.gaps.filter((g) => g.shape === 'shelf').every((g) => g.shapeAbsentInKind)).toBe(true);
    expect(f26.families['poplar']?.shapes['shelf']).toBe('poplar_shelf');
  });

  it('26.3: Woll- und Betontreppen für alle 16 Farben', () => {
    const wool = Object.values(f26.families).filter((f) => f.kind === 'wool');
    expect(wool).toHaveLength(16);
    expect(wool.every((f) => f.shapes['stairs'] && f.shapes['slab'])).toBe(true);
  });

  it('Kupfer 1.21.1: keine Truhe/Laterne, Blitzableiter nur unoxidiert', () => {
    expect(f1.families['copper']?.shapes['chest']).toBeUndefined();
    expect(f1.families['copper']?.shapes['lightning_rod']).toBe('lightning_rod');
    expect(f1.families['oxidized_copper']?.shapes['lightning_rod']).toBeUndefined();
  });
});
