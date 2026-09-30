/**
 * Asynchrones Asset-Bündel aus einem JAR (Browser-Pfad der App): synthetisches Mini-JAR (selbst erzeugt)
 * und – falls lokal vorhanden – das echte Client-JAR, verglichen mit der Ausgabe von scripts/extract-assets.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { deflateSync, inflate, inflateRaw, inflateRawSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  NotAClientJarError, bundleFromJar, decodePngAsync, parseJarVersion, pngIdat, readZipEntryAsync, type AsyncInflate,
} from '../src/assets/bundle.js';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { MISSING_TEXTURE, buildAtlas, buildJsonBundles, computeBlockFlags, textureStats } from '../src/assets/extract.js';
import { createImage, decodePng, encodePng } from '../src/assets/png.js';
import { ZipFormatError, readZipDirectory, zipEntryData } from '../src/assets/zip.js';
import { HAS_JAR, JAR_PATH, makeRawPng, makeZip, toU8 } from './helpers.js';

const zInflateRaw = promisify(inflateRaw);
const zInflate = promisify(inflate);
const nodeAsync: AsyncInflate = {
  inflateRaw: async (d) => toU8(await zInflateRaw(d)),
  inflate: async (d) => toU8(await zInflate(d)),
};
/** Browser-Weg (DecompressionStream), in Node ≥ 22 ebenfalls verfügbar. */
const streamAsync: AsyncInflate = {
  inflateRaw: async (d) => new Uint8Array(await new Response(new Blob([new Uint8Array(d)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()),
  inflate: async (d) => new Uint8Array(await new Response(new Blob([new Uint8Array(d)]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()),
};

const enc = new TextEncoder();
const json = (v: unknown): Uint8Array => enc.encode(JSON.stringify(v));

function png(w: number, h: number, rgba: readonly [number, number, number, number]): Uint8Array {
  const img = createImage(w, h);
  for (let i = 0; i < w * h; i++) img.data.set(rgba, i * 4);
  return encodePng(img, (d) => toU8(deflateSync(d)));
}

/** Mini-Client-JAR: zwei Blöcke (einer halbtransparent), eine animierte Textur, eine Truhen-Textur, dazu Fremddateien. */
function miniJar(opts: { version?: boolean } = {}): Uint8Array {
  const A = 'assets/minecraft/';
  return makeZip([
    ...(opts.version === false ? [] : [{ name: 'version.json', data: json({ id: '1.21.11', name: '1.21.11', world_version: 4671 }) }]),
    { name: 'net/minecraft/Main.class', data: new Uint8Array([0xca, 0xfe, 0xba, 0xbe]) },
    { name: `${A}blockstates/stone.json`, data: json({ variants: { '': { model: 'minecraft:block/stone' } } }), descriptor: true },
    { name: `${A}blockstates/glass.json`, data: json({ variants: { '': { model: 'minecraft:block/glass' } } }) },
    { name: `${A}models/block/cube_all.json`, data: json({ elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(['north', 'east', 'south', 'west', 'up', 'down'].map((f) => [f, { texture: '#all' }])) }] }) },
    { name: `${A}models/block/stone.json`, data: json({ parent: 'block/cube_all', textures: { all: 'block/stone' } }), method: 0 },
    { name: `${A}models/block/glass.json`, data: json({ parent: 'block/cube_all', textures: { all: 'block/glass' } }) },
    { name: `${A}textures/block/stone.png`, data: png(16, 16, [120, 120, 120, 255]) },
    { name: `${A}textures/block/glass.png`, data: png(16, 16, [200, 220, 255, 100]) },
    // animiert: 16×48 → erstes Bild 16×16; Palette + Interlacing über den unabhängigen PNG-Bauer
    { name: `${A}textures/block/magma.png`, data: makeRawPng({ width: 16, height: 48, colorType: 3, depth: 4, interlace: true, palette: [[255, 80, 0], [60, 10, 0]], pixel: (x, y) => [(x + y) % 2] }) },
    { name: `${A}textures/block/magma.png.mcmeta`, data: json({ animation: { frametime: 8 } }) },
    { name: `${A}textures/entity/chest/normal.png`, data: png(64, 64, [150, 100, 40, 255]) },
    // außerhalb des Umfangs
    { name: `${A}textures/gui/title.png`, data: png(8, 8, [0, 0, 0, 255]) },
    { name: `${A}sounds.json`, data: json({}) },
  ]);
}

describe('Asynchroner JAR-Kern', () => {
  it('readZipEntryAsync = extractZipEntry (stored, deflate, Data-Descriptor), CRC wird geprüft', async () => {
    const jar = miniJar();
    for (const e of readZipDirectory(jar)) {
      const a = await readZipEntryAsync(jar, e, nodeAsync.inflateRaw);
      expect(a.length, e.name).toBe(e.size);
    }
    const e = readZipDirectory(jar).find((x) => x.name.endsWith('stone.png'))!;
    await expect(readZipEntryAsync(jar, { ...e, crc32: e.crc32 ^ 1 }, nodeAsync.inflateRaw)).rejects.toBeInstanceOf(ZipFormatError);
    await expect(readZipEntryAsync(jar, { ...e, method: 12 }, nodeAsync.inflateRaw)).rejects.toThrow('Kompressionsmethode 12');
  });

  it('decodePngAsync = decodePng (auch mit mehreren IDAT-Chunks, Palette, Adam7)', async () => {
    const bytes = makeRawPng({ width: 9, height: 7, colorType: 6, depth: 16, interlace: true, pixel: (x, y) => [x * 7000, y * 9000, 30000, 65535 - x * 1000] });
    const sync = decodePng(bytes, (d) => toU8(inflateSync(d)));
    expect(await decodePngAsync(bytes, nodeAsync.inflate)).toEqual(sync);
    expect(await decodePngAsync(bytes, streamAsync.inflate)).toEqual(sync);
    expect(pngIdat(bytes).length).toBeGreaterThan(0);
    expect(() => pngIdat(new Uint8Array([1, 2, 3]))).toThrow('Signatur');
  });

  it('version.json lesen', () => {
    expect(parseJarVersion('{"id":"1.21.11","name":"1.21.11","world_version":4671}')).toEqual({ id: '1.21.11', name: '1.21.11', dataVersion: 4671 });
    expect(parseJarVersion('{"id":"../x"}')).toBeUndefined();
    expect(parseJarVersion('kein json')).toBeUndefined();
  });

  it('Mini-JAR → Bündel wie der synchrone Weg des Skripts (Atlas, Bündel, Flags), unabhängig vom Entpacker', async () => {
    const jar = miniJar();
    const progress: string[] = [];
    const b = await bundleFromJar(jar, nodeAsync, { onProgress: (p, d, t) => d === t && progress.push(p) });
    expect(b.version).toBe('1.21.11');
    expect(b.dataVersion).toBe(4671);
    expect(b.counts).toEqual({ files: 10, blockstates: 2, models: 3, textures: 4, animated: 1 });
    expect(progress).toEqual(['read', 'decode', 'atlas']);
    expect(Object.keys(b.atlasIndex.textures)).toContain(MISSING_TEXTURE);
    expect(b.atlasIndex.textures['minecraft:block/magma']?.slice(2)).toEqual([16, 16]);
    expect(b.blockFlags).toEqual({ stone: { opaque: true }, glass: { semi_transparent: true, self_culling: true } });

    // Gegenprobe: synchroner Weg wie scripts/extract-assets.ts
    const files = new Map<string, Uint8Array>();
    for (const e of readZipDirectory(jar)) {
      if (!e.name.startsWith('assets/minecraft/')) continue;
      files.set(e.name.slice('assets/minecraft/'.length), await readZipEntryAsync(jar, e, nodeAsync.inflateRaw));
    }
    const dec = new TextDecoder();
    const bundles = buildJsonBundles([...files].filter(([r]) => r.endsWith('.json') && !r.startsWith('sounds')).map(([r, d]) => [r, dec.decode(d)] as const));
    expect(b.blockstates).toEqual(bundles.blockstates);
    expect(b.models).toEqual(bundles.models);
    const tex = new Map([
      ['minecraft:block/stone', decodePng(files.get('textures/block/stone.png')!, (d) => toU8(inflateSync(d)))],
      ['minecraft:block/glass', decodePng(files.get('textures/block/glass.png')!, (d) => toU8(inflateSync(d)))],
      ['minecraft:block/magma', decodePng(files.get('textures/block/magma.png')!, (d) => toU8(inflateSync(d)))],
      ['minecraft:entity/chest/normal', decodePng(files.get('textures/entity/chest/normal.png')!, (d) => toU8(inflateSync(d)))],
    ]);
    const magma = tex.get('minecraft:block/magma')!;
    tex.set('minecraft:block/magma', { width: 16, height: 16, data: magma.data.slice(0, 16 * 16 * 4) });
    const atlas = buildAtlas('1.21.11', tex);
    expect(b.atlasIndex).toEqual(atlas.index);
    expect(b.atlas).toEqual(atlas.image);
    const stats = new Map([...tex].map(([id, img]) => [id, textureStats(img)]));
    expect(b.blockFlags).toEqual(computeBlockFlags(bundles.blockstates, bundles.models, (id) => stats.get(id)));

    // Browser-Entpacker (DecompressionStream) → identisches Bündel
    expect(await bundleFromJar(jar, streamAsync, { concurrency: 3 })).toEqual(b);
  });

  it('kein Client-JAR / keine Version → verständlicher Fehler', async () => {
    const other = makeZip([{ name: 'fabric.mod.json', data: json({ id: 'x' }) }]);
    await expect(bundleFromJar(other, nodeAsync)).rejects.toBeInstanceOf(NotAClientJarError);
    await expect(bundleFromJar(miniJar({ version: false }), nodeAsync)).rejects.toThrow('version.json');
    expect((await bundleFromJar(miniJar({ version: false }), nodeAsync, { fallbackVersion: '1.21.11' })).version).toBe('1.21.11');
    await expect(bundleFromJar(new Uint8Array([1, 2, 3]), nodeAsync)).rejects.toBeInstanceOf(ZipFormatError);
  });
});

const ASSETS = fileURLToPath(new URL('../../../local/mc-assets/1.21.11/', import.meta.url));
const HAS_ASSETS = HAS_JAR && existsSync(`${ASSETS}atlas.json`) && existsSync(`${ASSETS}block-flags.json`);

describe.skipIf(!HAS_ASSETS)('echtes Client-JAR (nur lokal)', () => {
  it('bundleFromJar = Ausgabe von scripts/extract-assets.ts (atlas.json, Blockstates, Modelle, Flags, Atlas-Pixel)', async () => {
    const jar = toU8(readFileSync(JAR_PATH));
    const b = await bundleFromJar(jar, nodeAsync, { concurrency: 32 });
    const read = (f: string): unknown => JSON.parse(readFileSync(`${ASSETS}${f}`, 'utf8'));
    expect(b.version).toBe('1.21.11');
    expect(b.atlasIndex).toEqual(read('atlas.json'));
    expect(b.blockFlags).toEqual(read('block-flags.json'));
    expect(Object.keys(b.blockstates)).toEqual(Object.keys(read('blockstates.json') as object));
    expect(Object.keys(b.models)).toEqual(Object.keys(read('models.json') as object));
    const atlas = decodePng(toU8(readFileSync(`${ASSETS}atlas.png`)), (d) => toU8(inflateSync(d)));
    expect(b.atlas.width).toBe(atlas.width);
    expect(Buffer.compare(Buffer.from(b.atlas.data), Buffer.from(atlas.data))).toBe(0);
    // ZIP-Leser sync/async gleich (Stichprobe)
    const e = readZipDirectory(jar).find((x) => x.name === 'assets/minecraft/blockstates/oak_stairs.json')!;
    expect(await readZipEntryAsync(jar, e, streamAsync.inflateRaw)).toEqual(toU8(inflateRawSync(zipEntryData(jar, e))));
  }, HEAVY_TIMEOUT);
});
