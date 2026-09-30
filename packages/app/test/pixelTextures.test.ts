import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { blockLook } from '../src/blockColors.js';
import { worldOf } from '../src/exporting.js';
import { TILE, buildPixelAtlas, classifyTexture, hashString, isCutout, paintTile } from '../src/pixelTextures.js';
import * as uc from '../src/usecases.js';
import { buildBlockVoxels } from '../src/viewer/blocks.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;
const tex = (name: string) => classifyTexture(name, blockLook(name).color);
const alphaOf = (px: Uint8ClampedArray) => Array.from({ length: TILE * TILE }, (_, i) => px[i * 4 + 3]!);

describe('Materialfamilie je Blockname', () => {
  it('Formen teilen die Textur des Vollblocks; Holzarten nutzen ihre Bretterfarbe', () => {
    expect(tex('spruce_stairs')).toEqual(tex('spruce_planks'));
    expect(tex('stone_brick_slab').fam).toBe('stonebricks');
    expect(tex('cobblestone_wall').fam).toBe('cobble');
    expect(tex('dark_oak_planks').color).not.toBe(tex('oak_planks').color);
    expect(tex('oak_log').fam).toBe('log');
    expect(tex('stripped_spruce_log').fam).toBe('stripped');
    expect(tex('spruce_wood').fam).toBe('bark');
  });

  it('Gestein, Erde und Sonderblöcke landen in eigenen Familien', () => {
    const fam = (n: string) => tex(n).fam;
    expect(fam('cobblestone')).toBe('cobble');
    expect(fam('mossy_cobblestone')).toBe('cobble_moss');
    expect(fam('bricks')).toBe('bricks');
    expect(fam('mud_bricks')).toBe('stonebricks');
    expect(fam('deepslate_tiles')).toBe('tiles');
    expect(fam('grass_block')).toBe('grass');
    expect(fam('farmland')).toBe('farmland');
    expect(fam('glass_pane')).toBe('glass');
    expect(fam('oak_leaves')).toBe('leaves');
    expect(fam('bookshelf')).toBe('bookshelf');
    expect(fam('chest')).toBe('chest');
    expect(fam('wheat')).toBe('crop');
    expect(fam('poppy')).toBe('flower');
    // „stone“ im Namen macht grindstone/glowstone nicht zu Stein
    expect(fam('glowstone')).toBe('glow');
  });
});

describe('Kacheln', () => {
  it('sind deterministisch und 16×16 RGBA', () => {
    const info = tex('oak_planks');
    const a = paintTile(info, 'side', hashString('x'));
    expect(a.length).toBe(TILE * TILE * 4);
    expect(paintTile(info, 'side', hashString('x'))).toEqual(a);
    expect(paintTile(info, 'side', hashString('y'))).not.toEqual(a);
  });

  it('Glas, Laub und Pflanzen haben Löcher, Vollblöcke nicht', () => {
    for (const n of ['glass_pane', 'oak_leaves', 'wheat', 'poppy']) {
      expect(isCutout(tex(n).fam), n).toBe(true);
      expect(alphaOf(paintTile(tex(n), 'side', 1)).some((a) => a < 128), n).toBe(true);
    }
    for (const n of ['stone_bricks', 'oak_planks', 'grass_block', 'bookshelf']) {
      expect(isCutout(tex(n).fam), n).toBe(false);
      expect(alphaOf(paintTile(tex(n), 'side', 1)).every((a) => a === 255), n).toBe(true);
    }
  });

  it('Grasblock: oben grün, seitlich Erde mit grünem Rand', () => {
    const info = tex('grass_block');
    const green = (px: Uint8ClampedArray, i: number) => px[i * 4 + 1]! > px[i * 4]!;
    const top = paintTile(info, 'top', 1), side = paintTile(info, 'side', 1);
    expect(green(top, 8 * TILE + 8)).toBe(true);
    expect(green(side, 0)).toBe(true);
    expect(green(side, (TILE - 1) * TILE + 8)).toBe(false);
  });
});

describe('Atlas', () => {
  it('gleiche Kacheln nur einmal, Rechtecke im Atlas, Seiten eines Stamms verschieden von oben', () => {
    const atlas = buildPixelAtlas([['oak_planks', blockLook('oak_planks').color], ['oak_stairs', blockLook('oak_stairs').color], ['oak_log', blockLook('oak_log').color]]);
    expect(atlas.pixels.length).toBe(atlas.size * atlas.size * 4);
    expect(atlas.rect('oak_stairs', blockLook('oak_stairs').color, 'side')).toEqual(atlas.rect('oak_planks', blockLook('oak_planks').color, 'top'));
    const logTop = atlas.rect('oak_log', blockLook('oak_log').color, 'top')!;
    expect(logTop).not.toEqual(atlas.rect('oak_log', blockLook('oak_log').color, 'side'));
    for (const v of logTop) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
    expect(atlas.rect('stone', blockLook('stone').color, 'top')).toBeUndefined();
  });

  it('deckt jeden Block des Beispielhauses ab (alle Themes, alle Zielversionen)', async () => {
    for (const version of uc.TARGET_VERSION_NAMES) {
      const ctx = await pipeline.ready(version);
      for (const themeId of load.themeCatalog!.ids()) {
        const voxels = buildBlockVoxels(worldOf(sampleSession(catalog, { themeId, version }).project, ctx));
        const atlas = buildPixelAtlas(new Map(voxels.map((v) => [v.block!, v.color] as const)).entries());
        for (const v of voxels) expect(atlas.rect(v.block!, v.color, 'side'), v.block).toBeDefined();
        expect(atlas.size).toBeLessThanOrEqual(2048);
      }
    }
  });
});
