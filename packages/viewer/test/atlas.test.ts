import { describe, expect, it } from 'vitest';
import { atlasUv, composeAtlas, packAtlas, type AtlasItem, type AtlasRect } from '../src/assets/atlas.js';
import {
  MISSING_TEXTURE, TEXTURE_ALIASES, atlasIndexUv, buildAtlas, buildJsonBundles, computeBlockFlags, firstFrame, inExtractScope,
  representativeTexture, resolveModel, textureIdOf, textureStats, type TextureStats,
} from '../src/assets/extract.js';
import { createImage, type RgbaImage } from '../src/assets/png.js';

function solid(w: number, h: number, rgba: readonly [number, number, number, number]): RgbaImage {
  const img = createImage(w, h);
  for (let i = 0; i < w * h; i++) img.data.set(rgba, i * 4);
  return img;
}

const overlaps = (a: AtlasRect, b: AtlasRect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('Atlas packen', () => {
  const items: AtlasItem[] = [
    ...Array.from({ length: 300 }, (_, i) => ({ id: `minecraft:block/t${i}`, w: 16, h: 16 })),
    { id: 'minecraft:entity/chest/normal', w: 64, h: 64 },
    { id: 'minecraft:entity/signs/oak', w: 64, h: 32 },
    { id: 'minecraft:block/tall', w: 16, h: 32 },
    { id: 'minecraft:block/wide', w: 48, h: 16 },
  ];

  it('ohne Überlappung, innerhalb der Kante, Kante ist Zweierpotenz', () => {
    const { size, rects } = packAtlas(items);
    expect(Math.log2(size) % 1).toBe(0);
    const list = Object.values(rects);
    expect(list).toHaveLength(items.length);
    for (const r of list) {
      expect(r.x + r.w).toBeLessThanOrEqual(size);
      expect(r.y + r.h).toBeLessThanOrEqual(size);
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlaps(list[i]!, list[j]!)).toBe(false);
    for (const it of items) expect([rects[it.id]!.w, rects[it.id]!.h]).toEqual([it.w, it.h]);
  });

  it('deterministisch, unabhängig von der Eingabereihenfolge', () => {
    expect(packAtlas([...items].reverse())).toEqual(packAtlas(items));
  });

  it('wächst bei Bedarf und meldet Fehler', () => {
    expect(packAtlas([{ id: 'a', w: 16, h: 16 }]).size).toBe(16);
    expect(packAtlas([{ id: 'a', w: 16, h: 16 }, { id: 'b', w: 16, h: 16 }]).size).toBe(32);
    expect(() => packAtlas([{ id: 'a', w: 16, h: 16 }, { id: 'a', w: 16, h: 16 }])).toThrow(/doppelt/);
    expect(() => packAtlas([{ id: 'a', w: 64, h: 64 }], { maxSize: 32 })).toThrow(/passen nicht/);
  });

  it('UV: normiert, v nach unten', () => {
    expect(atlasUv({ x: 16, y: 32, w: 16, h: 16 }, 64)).toEqual([0.25, 0.5, 0.5, 0.75]);
    expect(atlasUv({ x: 0, y: 0, w: 64, h: 32 }, 256)).toEqual([0, 0, 0.25, 0.125]);
  });

  it('setzt Pixel an die gepackte Stelle', () => {
    const images = new Map([['r', solid(16, 16, [255, 0, 0, 255])], ['g', solid(32, 16, [0, 255, 0, 128])]]);
    const layout = packAtlas([...images].map(([id, img]) => ({ id, w: img.width, h: img.height })));
    const atlas = composeAtlas(layout, images);
    const at = (x: number, y: number): number[] => [...atlas.data.subarray((y * atlas.width + x) * 4, (y * atlas.width + x) * 4 + 4)];
    const r = layout.rects['r']!, g = layout.rects['g']!;
    expect(at(r.x + 5, r.y + 5)).toEqual([255, 0, 0, 255]);
    expect(at(g.x + 31, g.y + 15)).toEqual([0, 255, 0, 128]);
  });
});

describe('Atlas aus Texturen (buildAtlas)', () => {
  it('ergänzt Ersatztextur und Aliase, UV passt zu den Pixeln', () => {
    const target = Object.values(TEXTURE_ALIASES)[0]!;
    const alias = Object.keys(TEXTURE_ALIASES)[0]!;
    const textures = new Map([
      ['minecraft:block/stone', solid(16, 16, [120, 120, 120, 255])],
      [target, solid(64, 64, [10, 20, 30, 255])],
    ]);
    const { image, index } = buildAtlas('1.21.11', textures);
    expect(index.version).toBe('1.21.11');
    expect(image.width).toBe(index.size);
    expect(index.textures[MISSING_TEXTURE]).toBeDefined();
    expect(index.textures[alias]).toEqual(index.textures[target]);
    // Aliase ohne vorhandenes Ziel fehlen
    expect(Object.keys(index.textures).filter((k) => k in TEXTURE_ALIASES)).toEqual([alias]);
    const uv = atlasIndexUv(index);
    const [x, y] = index.textures['minecraft:block/stone']!;
    expect(uv['minecraft:block/stone']).toEqual([x / index.size, y / index.size, (x + 16) / index.size, (y + 16) / index.size]);
    expect(image.data[(y * image.width + x) * 4]).toBe(120);
  });
});

describe('Texturen: erstes Animationsbild und Statistik', () => {
  it('schneidet animierte Streifen auf das erste Bild', () => {
    const strip = createImage(16, 64);
    strip.data.fill(7);
    expect(firstFrame(strip)).toBe(strip);
    expect([firstFrame(strip, { animation: {} }).width, firstFrame(strip, { animation: {} }).height]).toEqual([16, 16]);
    expect(firstFrame(strip, { animation: { height: 32 } }).height).toBe(32);
    expect(firstFrame(createImage(16, 16), { animation: { frametime: 2 } }).height).toBe(16);
  });

  it('Durchschnittsfarbe alpha-gewichtet, Ausschnitt/Halbtransparenz erkannt', () => {
    const img = createImage(2, 1);
    img.data.set([200, 0, 0, 255, 0, 0, 200, 0]); // zweiter Pixel voll transparent → zählt nicht zur Farbe
    const s = textureStats(img);
    expect(s.rgb).toBe('#c80000');
    expect(s.opacity).toBe(0.5);
    expect(s.cutout).toBe(true);
    expect(s.translucent).toBe(false);
    const glass = solid(2, 2, [100, 150, 200, 128]);
    expect(textureStats(glass)).toMatchObject({ rgb: '#6496c8', translucent: true, cutout: true });
    expect(textureStats(solid(2, 2, [1, 2, 3, 255]))).toMatchObject({ cutout: false, translucent: false });
  });

  it('Extraktionsumfang und Textur-IDs', () => {
    expect(inExtractScope('blockstates/oak_stairs.json')).toBe(true);
    expect(inExtractScope('models/block/oak_stairs.json')).toBe(true);
    expect(inExtractScope('models/item/oak_stairs.json')).toBe(false);
    expect(inExtractScope('textures/block/lantern.png')).toBe(true);
    expect(inExtractScope('textures/block/lantern.png.mcmeta')).toBe(true);
    expect(inExtractScope('textures/entity/chest/normal_left.png')).toBe(true);
    expect(inExtractScope('textures/entity/banner_base.png')).toBe(true);
    expect(inExtractScope('textures/entity/zombie/husk.png')).toBe(false);
    expect(inExtractScope('textures/gui/title/minecraft.png')).toBe(false);
    expect(textureIdOf('textures/entity/bed/red.png')).toBe('minecraft:entity/bed/red');
    expect(textureIdOf('textures/block/lantern.png.mcmeta')).toBeUndefined();
  });
});

/** Selbst geschriebene Mini-Assets (keine Mojang-Daten). */
function fixture(): { blockstates: Record<string, unknown>; models: Record<string, unknown>; stats: (id: string) => TextureStats | undefined } {
  const files: Array<[string, string]> = [
    ['models/block/cube.json', JSON.stringify({ elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(['north', 'east', 'south', 'west', 'up', 'down'].map((d) => [d, { texture: `#${d}` }])) }] })],
    ['models/block/cube_all.json', JSON.stringify({ parent: 'block/cube', textures: { north: '#all', east: '#all', south: '#all', west: '#all', up: '#all', down: '#all' } })],
    ['models/block/stone.json', JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/stone' } })],
    ['models/block/glass.json', JSON.stringify({ parent: 'block/cube_all', textures: { all: 'block/glass' } })],
    ['models/block/tinted.json', JSON.stringify({ parent: 'block/cube_all', textures: { all: 'block/tinted_glass' } })],
    ['models/block/slab.json', JSON.stringify({ textures: { t: 'block/stone' }, elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: { up: { texture: '#t' } } }] })],
    ['blockstates/stone.json', JSON.stringify({ variants: { '': { model: 'block/stone' } } })],
    ['blockstates/glass.json', JSON.stringify({ variants: { '': { model: 'block/glass' } } })],
    ['blockstates/tinted_glass.json', JSON.stringify({ variants: { '': { model: 'block/tinted' } } })],
    ['blockstates/stone_slab.json', JSON.stringify({ variants: { 'type=bottom': { model: 'block/slab' }, 'type=double': { model: 'block/stone' } } })],
    ['blockstates/stone_wall.json', JSON.stringify({ multipart: [{ apply: { model: 'block/stone' } }] })],
    ['blockstates/red_bed.json', JSON.stringify({ variants: { '': { model: 'block/stone' } } })],
  ];
  const { blockstates, models } = buildJsonBundles(files);
  const stats: Record<string, TextureStats> = {
    'minecraft:block/stone': { rgb: '#7f7f7f', opacity: 1, cutout: false, translucent: false },
    'minecraft:block/glass': { rgb: '#ffffff', opacity: 0.3, cutout: true, translucent: false },
    'minecraft:block/tinted_glass': { rgb: '#303030', opacity: 0.6, cutout: true, translucent: true },
  };
  return { blockstates, models, stats: (id) => stats[id] };
}

describe('Modelle auflösen und Block-Flags', () => {
  it('löst Elterkette und #-Verweise auf', () => {
    const { models } = fixture();
    const m = resolveModel(models, 'minecraft:block/stone')!;
    expect(m.elements).toHaveLength(1);
    expect(m.textures['north']).toBe('minecraft:block/stone');
    expect(m.textures['all']).toBe('minecraft:block/stone');
    expect(resolveModel(models, 'block/fehlt')).toBeUndefined();
  });

  it('opaque nur für volle, deckende Würfel; Halbtransparenz und Selbstverdeckung', () => {
    const { blockstates, models, stats } = fixture();
    const flags = computeBlockFlags(blockstates, models, stats);
    expect(flags['stone']).toEqual({ opaque: true });
    expect(flags['glass']).toEqual({ self_culling: true });
    expect(flags['tinted_glass']).toEqual({ semi_transparent: true, self_culling: true });
    expect(flags['stone_slab']).toBeUndefined(); // eine Variante ist kein voller Würfel
    expect(flags['stone_wall']).toBeUndefined(); // multipart ist nie opaque
  });

  it('stellvertretende Textur je Block (Bett aus der Entity-Textur)', () => {
    const { blockstates, models } = fixture();
    expect(representativeTexture('stone', blockstates['stone'], models)).toBe('minecraft:block/stone');
    expect(representativeTexture('red_bed', blockstates['red_bed'], models)).toBe('minecraft:entity/bed/red');
  });
});
