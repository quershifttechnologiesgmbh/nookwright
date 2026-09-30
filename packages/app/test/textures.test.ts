/// <reference types="node" />
/**
 * Vorschau „Texturen“: Port und Adapter ohne DOM – Quelle wählen, Modus-Zustand, Browser-Entpacker
 * (DecompressionStream) gegen node:zlib, JAR → Assets (selbst gebautes Mini-JAR, keine Mojang-Daten),
 * Cache-Format (Round-Trip), Dev-Loader mit Fake-fetch, Szenenfilter und Schnitt.
 * Mit lokalen Assets (local/mc-assets, nur auf dem Entwicklerrechner) zusätzlich: jedes Blockmodell des Beispielhauses da.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, deflateSync, inflateSync } from 'node:zlib';
import { key3 } from '@mcda/core';
import { bundleFromJar, crc32, createImage, decodePng, encodePng, type AssetBundle } from '@mcda/viewer/assets';
import { blockLightAt, computeLightField, createDeepslateResources } from '@mcda/viewer';
import { Identifier } from 'deepslate';
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { devTextureVersions, loadDevTextures } from '../src/adapters/devTextures.js';
import { streamGzip } from '../src/adapters/gzip.js';
import { streamInflate, streamInflateAvailable } from '../src/adapters/inflate.js';
import { worldOf } from '../src/exporting.js';
import { lightSession } from '../src/lighting.js';
import {
  NO_TEXTURES_HINT, assetsFromBundle, cachedMeta, jarProgress, memoryTextureCache, packTextures, pickSource, registryBlockInfo, textureMode, toViewerResources,
  unpackTextures, versionNote, type TextureAssets,
} from '../src/textures/assets.js';
import { materializeLightRules } from '../src/textures/lightRules.js';
import { belowCeiling, textureScene, textureVolume } from '../src/textures/scene.js';
import * as uc from '../src/usecases.js';
import { cutFromSlider, cutRange, cutVoxels, voxelBlockY, buildPreviewVoxels } from '../src/viewer/voxels.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;
const u8 = (b: Uint8Array): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const json = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));

/** Minimaler ZIP-Schreiber (deflate, nur für Tests). */
function makeZip(files: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const body = u8(deflateRawSync(f.data));
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(14, crc32(f.data), true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(f.data), true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function png(w: number, h: number, rgba: readonly [number, number, number, number]): Uint8Array {
  const img = createImage(w, h);
  for (let i = 0; i < w * h; i++) img.data.set(rgba, i * 4);
  return encodePng(img, (d) => u8(deflateSync(d)));
}

/** Selbst gebautes „Client-JAR“: ein Block mit Modell und Textur (keine Mojang-Daten). */
function miniJar(): Uint8Array {
  const A = 'assets/minecraft/';
  return makeZip([
    { name: 'version.json', data: json({ id: '1.21.11', world_version: 4671 }) },
    { name: `${A}blockstates/stone.json`, data: json({ variants: { '': { model: 'minecraft:block/stone' } } }) },
    { name: `${A}models/block/stone.json`, data: json({ elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: '#all' } } }], textures: { all: 'block/stone' } }) },
    { name: `${A}textures/block/stone.png`, data: png(16, 16, [128, 128, 128, 255]) },
  ]);
}

async function miniBundle(): Promise<AssetBundle> {
  return bundleFromJar(miniJar(), streamInflate);
}

describe('Quelle und Modus „Texturen“', () => {
  it('Quelle: Cache (eigenes JAR) vor Dev-Assets, passende Version bevorzugt', () => {
    const cache = { origin: 'cache', version: '1.21.11', label: 'client.jar (Minecraft 1.21.11)', savedAt: '' } as const;
    expect(pickSource(cache, ['1.21.11'], '1.21.11')).toEqual({ origin: 'cache', version: '1.21.11', label: cache.label });
    expect(pickSource(undefined, ['1.21.11', '26.3'], '26.3')?.version).toBe('26.3');
    expect(pickSource(undefined, ['1.21.11'], '26.3')).toEqual({ origin: 'dev', version: '1.21.11', label: 'local/mc-assets/1.21.11 (Entwicklung)' });
    expect(pickSource(undefined, [], '1.21.11')).toBeUndefined();
    expect(pickSource(undefined, undefined, '1.21.11')).toBeUndefined();
  });

  it('ohne Assets deaktiviert mit Erklärung; mit Quelle aktiv', () => {
    expect(textureMode({ kind: 'none' })).toEqual({ enabled: false, hint: NO_TEXTURES_HINT });
    expect(textureMode({ kind: 'none' }, false).hint).toContain('DecompressionStream');
    expect(textureMode({ kind: 'probing' }).enabled).toBe(false);
    expect(textureMode({ kind: 'available', source: { origin: 'dev', version: '1.21.11', label: 'x' } }).enabled).toBe(true);
    expect(textureMode({ kind: 'loading', message: 'lädt' })).toEqual({ enabled: true, hint: 'lädt' });
    expect(NO_TEXTURES_HINT).toContain('bleibt auf deinem Gerät');
    expect(versionNote('1.21.11', '1.21.11')).toBeUndefined();
    expect(versionNote('1.21.11', '26.3')).toContain('26.3');
  });

  it('Fortschritt steigt über die Phasen monoton bis 1', () => {
    const steps = [jarProgress('read', 0, 10), jarProgress('read', 10, 10), jarProgress('decode', 5, 10), jarProgress('decode', 10, 10), jarProgress('atlas', 1, 1)];
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.progress).toBeGreaterThanOrEqual(steps[i - 1]!.progress);
    expect(steps.at(-1)!.progress).toBe(1);
  });
});

describe('Browser-Adapter: Entpacken und JAR (DecompressionStream, unter Node gegen node:zlib)', () => {
  it('deflate-raw und deflate wie node:zlib', async () => {
    expect(streamInflateAvailable()).toBe(true);
    const data = new TextEncoder().encode('Blockstate '.repeat(300));
    expect(await streamInflate.inflateRaw(u8(deflateRawSync(data)))).toEqual(data);
    expect(await streamInflate.inflate(u8(deflateSync(data)))).toEqual(data);
  });

  it('Mini-JAR → Assets → ViewerResources: Blockmodell aufgelöst, Atlas mit Ersatztextur', async () => {
    const b = await miniBundle();
    const a = assetsFromBundle(b, 'jar', 'mini.jar (Minecraft 1.21.11)');
    expect(a.version).toBe('1.21.11');
    const res = createDeepslateResources(toViewerResources(a));
    expect(res.hasBlock(Identifier.parse('minecraft:stone'))).toBe(true);
    expect(res.hasBlock(Identifier.parse('minecraft:dirt'))).toBe(false);
    expect(Object.keys(a.atlasIndex.textures)).toEqual(expect.arrayContaining(['minecraft:block/stone', 'mcda:missing']));
  });
});

describe('Cache-Format (IndexedDB-Port, hier im Speicher)', () => {
  it('packen → speichern → Kurzinfo → laden → entpacken: identische Assets', async () => {
    const a = assetsFromBundle(await miniBundle(), 'jar', 'mini.jar (Minecraft 1.21.11)');
    const cache = memoryTextureCache();
    expect(await cache.meta()).toBeUndefined();
    const rec = await packTextures(a, streamGzip, new Date(Date.UTC(2026, 8, 23)));
    expect(rec.atlas.gz.length).toBeLessThan(a.atlas.data.length);
    expect(await cache.save(rec)).toBe(true);
    expect(await cache.meta()).toEqual({ origin: 'cache', version: '1.21.11', label: 'mini.jar (Minecraft 1.21.11)', savedAt: '2026-09-23T00:00:00.000Z' });
    const back = (await unpackTextures(await cache.load(), streamGzip))!;
    const { origin, ...rest } = back;
    expect(origin).toBe('cache');
    const { origin: _o, ...orig } = a;
    expect({ ...rest, atlas: { ...rest.atlas, data: Array.from(rest.atlas.data) } }).toEqual({ ...orig, atlas: { ...orig.atlas, data: Array.from(orig.atlas.data) } });
    expect(await cache.clear()).toBe(true);
    expect(await cache.load()).toBeUndefined();
  });

  it('beschädigte oder fremde Einträge → undefined (dann neu laden), nie eine Ausnahme', async () => {
    const rec = await packTextures(assetsFromBundle(await miniBundle(), 'jar', 'x'), streamGzip);
    expect(cachedMeta({ format: 'anders', v: 1 })).toBeUndefined();
    expect(cachedMeta({ ...rec, v: 99 })).toBeUndefined();
    expect(await unpackTextures(undefined, streamGzip)).toBeUndefined();
    expect(await unpackTextures({ ...rec, atlas: { ...rec.atlas, gz: new Uint8Array([1, 2, 3]) } }, streamGzip)).toBeUndefined();
    expect(await unpackTextures({ ...rec, atlas: { ...rec.atlas, width: 999 } }, streamGzip)).toBeUndefined();
    expect(await unpackTextures({ ...rec, models: '{kaputt' }, streamGzip)).toBeUndefined();
  });
});

describe('Dev-Loader (Fake-fetch statt Middleware)', () => {
  function fakeServer(files: Record<string, { body: BodyInit; type: string }>): (url: string) => Promise<Response> {
    return async (url) => {
      const f = files[url];
      return f === undefined ? new Response('nicht da', { status: 404, headers: { 'content-type': 'text/plain' } }) : new Response(f.body, { headers: { 'content-type': f.type } });
    };
  }

  it('index.json → Versionen; ohne Middleware (HTML-Fallback, 404, Netzfehler) → undefined', async () => {
    const j = 'application/json';
    expect(await devTextureVersions(fakeServer({ '/mc-assets/index.json': { body: JSON.stringify({ versions: ['1.21.11', 7] }), type: j } }))).toEqual(['1.21.11']);
    expect(await devTextureVersions(fakeServer({ '/mc-assets/index.json': { body: '<!doctype html>', type: 'text/html' } }))).toBeUndefined();
    expect(await devTextureVersions(fakeServer({}))).toBeUndefined();
    expect(await devTextureVersions(() => Promise.reject(new Error('offline')))).toBeUndefined();
  });

  it('lädt atlas.json/blockstates/models/flags/atlas.png und dekodiert den Atlas exakt', async () => {
    const b = await miniBundle();
    const atlasPng = encodePng(b.atlas, (d) => u8(deflateSync(d)));
    const j = 'application/json';
    const base = '/mc-assets/1.21.11/';
    const fetchFn = fakeServer({
      [`${base}atlas.json`]: { body: JSON.stringify(b.atlasIndex), type: j },
      [`${base}blockstates.json`]: { body: JSON.stringify(b.blockstates), type: j },
      [`${base}models.json`]: { body: JSON.stringify(b.models), type: j },
      [`${base}block-flags.json`]: { body: JSON.stringify(b.blockFlags), type: j },
      [`${base}atlas.png`]: { body: new Blob([new Uint8Array(atlasPng)]), type: 'image/png' },
    });
    const a = await loadDevTextures('1.21.11', streamInflate.inflate, fetchFn);
    expect(a.origin).toBe('dev');
    expect(a.atlasIndex).toEqual(b.atlasIndex);
    expect(Array.from(a.atlas.data)).toEqual(Array.from(b.atlas.data));
    await expect(loadDevTextures('26.3', streamInflate.inflate, fetchFn)).rejects.toThrow('404');
  });
});

describe('Szene „Texturen“ und Schnitt', () => {
  it('Ansicht filtert Hüllenblöcke wie die übrigen Modi; Komplett = Volumen selbst', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const s = lightSession(sampleSession(catalog), ctx).session;
    const world = worldOf(s.project, ctx, s.roof);
    const count = (src: ReturnType<typeof textureVolume>) => [...src.cells()].filter((c) => c.state.name !== 'air').length;
    expect(textureVolume(world, 'full')).toBe(world.materialized.volume);
    const kinds = new Map(world.shell.cells.map((c) => [key3(c.pos), c.kind] as const));
    const noRoof = [...textureVolume(world, 'noRoof').cells()];
    expect(noRoof.some((c) => kinds.get(key3(c.pos)) === 'roof' || kinds.get(key3(c.pos)) === 'ceiling')).toBe(false);
    const floorOnly = [...textureVolume(world, 'floorOnly').cells()];
    expect(floorOnly.some((c) => ['wall', 'pillar', 'door', 'window', 'lintel'].includes(kinds.get(key3(c.pos)) ?? ''))).toBe(false);
    expect(count(textureVolume(world, 'full'))).toBeGreaterThan(noRoof.length);
    expect(noRoof.length).toBeGreaterThan(floorOnly.length);
    // Möbel und Lichter bleiben in allen Ansichten – außer der Außen-Deko: sie folgt Wänden bzw. Dach
    const outside = new Map((world.exterior ?? []).flatMap((p) => p.cells.map((c) => [key3(c), p.group] as const)));
    expect(outside.size).toBeGreaterThan(0);
    const emitters = world.materialized.light.emitters.map((e) => key3(e.pos));
    const inFloorOnly = new Set(floorOnly.map((c) => key3(c.pos)));
    expect(emitters.every((k) => inFloorOnly.has(k) || kinds.has(k) || outside.has(k))).toBe(true);
    expect([...inFloorOnly].some((k) => outside.has(k))).toBe(false);
    const inNoRoof = new Set(noRoof.map((c) => key3(c.pos)));
    const roofParts = [...outside].filter(([, g]) => uc.EXTERIOR_ROOF_GROUPS.has(g)).map(([k]) => k);
    expect(roofParts.length).toBeGreaterThan(0); // Schornsteine über Küche und Schmiede
    expect(roofParts.some((k) => inNoRoof.has(k))).toBe(false);
    expect([...outside].some(([k, g]) => !uc.EXTERIOR_ROOF_GROUPS.has(g) && inNoRoof.has(k))).toBe(true); // Läden & Co. bleiben
  });

  it('beleuchteter Modus: „Dach ab“ ist ein Schnitt unter der Decke (Dach zählt fürs Licht), „Wände ab“ filtert mit Hinweis', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const s = lightSession(sampleSession(catalog), ctx).session;
    const world = worldOf(s.project, ctx, s.roof);
    const top = belowCeiling(world)!;
    expect(top).toBe(3); // Boden y = 0, lichte Höhe 3, Decke y = 4
    expect(textureScene(world, 'full', undefined)).toEqual({ source: world.materialized.volume, maxY: undefined });
    expect(textureScene(world, 'full', 2).maxY).toBe(2);
    const noRoof = textureScene(world, 'noRoof', undefined);
    expect(noRoof.source).toBe(world.materialized.volume); // ganzes Volumen → Lichtfeld mit Dach
    expect(noRoof.maxY).toBe(top);
    expect(textureScene(world, 'noRoof', 1).maxY).toBe(1);
    expect(textureScene(world, 'noRoof', 9).maxY).toBe(top);
    const walls = textureScene(world, 'floorOnly', undefined);
    expect(walls.source).not.toBe(world.materialized.volume);
    expect(walls.note).toContain('Himmelslicht');
  });

  it('Lichtregeln (Adapter → materialize): Blocklicht der Vorschau = Licht der Materialisierung in jeder Zelle', async () => {
    for (const version of ['1.21.11', '26.3'] as const) {
      const ctx = await pipeline.ready(version);
      for (const theme of ['medieval', 'nordic']) {
        const s = lightSession(uc.setTheme(sampleSession(catalog, { version }), catalog, theme), ctx).session;
        const world = worldOf(s.project, ctx, s.roof);
        const vol = world.materialized.volume;
        const field = computeLightField(vol, materializeLightRules(ctx.platform(version)));
        let diff = 0;
        for (let x = 0; x < vol.size[0]; x++) for (let y = 0; y < vol.size[1]; y++) for (let z = 0; z < vol.size[2]; z++) {
          const p = [vol.origin[0] + x, vol.origin[1] + y, vol.origin[2] + z] as const;
          if (blockLightAt(field, p) !== world.materialized.light.levelAt(p)) diff++;
        }
        expect(diff, `${version}/${theme}`).toBe(0);
        // Spawn-Stellen des Reports haben auch in der Vorschau Blocklicht 0
        for (const d of world.materialized.light.darkCells) expect(blockLightAt(field, d.pos)).toBe(0);
      }
    }
  });

  it('Schnitt: Bereich aus der Hülle, Regler ganz oben = alles, Quader über der Höhe fallen weg', () => {
    const s = sampleSession(catalog);
    const shell = uc.shellOf(s.project, 'hip');
    const range = cutRange(shell);
    expect(range.min).toBe(0);
    expect(range.max).toBeGreaterThan(4); // Walmdach über der Decke (y = 4)
    expect(cutFromSlider(range.max + 1, range)).toBeUndefined();
    expect(cutFromSlider(2, range)).toBe(2);
    expect(cutFromSlider(-5, range)).toBe(range.min);
    const voxels = buildPreviewVoxels(shell, uc.placedViews(s.project.state, catalog));
    expect(cutVoxels(voxels, undefined)).toBe(voxels);
    const cut = cutVoxels(voxels, 2);
    expect(cut.length).toBeLessThan(voxels.length);
    expect(cut.every((v) => voxelBlockY(v) <= 2)).toBe(true);
    expect(cut.some((v) => v.layer === 'furniture')).toBe(true);
    expect(cut.some((v) => v.layer === 'ceiling')).toBe(false);
  });

  it('blockInfo aus der Registry der Zielversion (fehlende Properties für den Renderer)', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const info = registryBlockInfo(ctx.platform('1.21.11').registry);
    expect(info('oak_stairs')?.properties['facing']).toContain('north');
    expect(info('oak_stairs')?.default['half']).toBe('bottom');
    expect(info('gibt_es_nicht')).toBeUndefined();
  });
});

const ASSETS = fileURLToPath(new URL('../../../local/mc-assets/1.21.11/', import.meta.url));
const HAS_ASSETS = !process.env['MCDA_SKIP_JAR'] && existsSync(`${ASSETS}atlas.png`) && existsSync(`${ASSETS}models.json`);

describe.skipIf(!HAS_ASSETS)('mit lokalen Assets (nur Entwicklerrechner, local/ ist git-ignoriert)', () => {
  it('Dev-Loader über das Dateisystem: jedes Blockmodell des Beispielhauses (alle Themes) ist vorhanden', async () => {
    const fetchFn = async (url: string): Promise<Response> => {
      const file = `${ASSETS}${url.slice('/mc-assets/1.21.11/'.length)}`;
      return existsSync(file) ? new Response(new Uint8Array(readFileSync(file)), { headers: { 'content-type': 'application/octet-stream' } }) : new Response('', { status: 404 });
    };
    const a: TextureAssets = await loadDevTextures('1.21.11', streamInflate.inflate, fetchFn);
    const atlas = decodePng(u8(readFileSync(`${ASSETS}atlas.png`)), (d) => u8(inflateSync(d)));
    expect(a.atlas.width).toBe(atlas.width);
    const ctx = await pipeline.ready('1.21.11');
    const res = createDeepslateResources(toViewerResources(a, registryBlockInfo(ctx.platform('1.21.11').registry)));
    for (const theme of ['medieval', 'nordic', 'rustic']) {
      if (!load.themeCatalog!.ids().includes(theme)) continue;
      const s = lightSession(uc.setTheme(sampleSession(catalog), catalog, theme), ctx).session;
      const world = worldOf(s.project, ctx, s.roof);
      const names = new Set([...world.materialized.volume.cells()].map((c) => c.state.name).filter((n) => n !== 'air'));
      const missing = [...names].filter((n) => !res.hasBlock(Identifier.parse(n.includes(':') ? n : `minecraft:${n}`)));
      expect(missing, theme).toEqual([]);
    }
  }, HEAVY_TIMEOUT);
});
