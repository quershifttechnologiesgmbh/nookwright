import { fileURLToPath } from 'node:url';
import { Identifier, type Mesh } from 'deepslate';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { generate } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { loadRegistryData } from '@mcda/platform/node';
import { ASSET_ROOT, MISSING_TEXTURE, buildJsonBundles, inExtractScope, textureIdOf, type AtlasIndex } from '../src/assets/extract.js';
import type { ViewerResources } from '../src/port.js';
import { blockMesh, createDeepslateResources, resolveBlockModels, type DeepslateResources } from '../src/resources.js';
import { displayBlock, toStructure } from '../src/structure.js';
import { HAS_JAR, localJar } from './helpers.js';

/** Achsenparalleler Umriss eines Meshes in Blockeinheiten. */
function bounds(mesh: Mesh): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const q of mesh.quads) {
    for (const v of q.vertices()) {
      const p = [v.pos.x, v.pos.y, v.pos.z];
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[k]!); max[k] = Math.max(max[k]!, p[k]!); }
    }
  }
  return { min: min.map((v) => Math.round(v * 16) + 0), max: max.map((v) => Math.round(v * 16) + 0) };
}

/** Merkt sich, welche Texturen abgefragt wurden (der Adapter übergibt sich selbst an deepslate). */
function spyTextures(res: DeepslateResources): Set<string> {
  const seen = new Set<string>();
  const orig = res.getTextureUV.bind(res);
  res.getTextureUV = (id: Identifier) => {
    seen.add(id.toString());
    return orig(id);
  };
  return seen;
}

const fakeAtlas = (size: number): ViewerResources['atlas'] => ({ width: size, height: size, data: new Uint8Array(size * size * 4) });

describe('deepslate-Ressourcen aus dem Port (selbst geschriebene Mini-Assets)', () => {
  const cube = (tex: string): unknown => ({
    parent: 'block/cube',
    textures: { t: tex },
  });
  const res = createDeepslateResources({
    version: 'test',
    atlas: fakeAtlas(64),
    atlasIndex: {
      version: 'test', size: 64,
      textures: { [MISSING_TEXTURE]: [0, 0, 16, 16], 'minecraft:block/stone': [16, 0, 16, 16], 'minecraft:entity/chest/normal_left': [0, 16, 64, 64 - 16] },
    },
    blockstates: {
      stone: { variants: { '': { model: 'block/stone' } } },
      odd: { variants: { '': { model: 'block/odd' } } },
      slab: { variants: { 'type=bottom': { model: 'block/stone' }, 'type=top': { model: 'block/odd', x: 180 } } },
    },
    models: {
      'block/cube': { elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(['north', 'east', 'south', 'west', 'up', 'down'].map((d) => [d, { texture: '#t' }])) }] },
      'block/stone': cube('minecraft:block/stone'),
      'block/odd': cube('minecraft:block/unbekannt'),
    },
    blockFlags: { stone: { opaque: true } },
    blockInfo: (name) => (name === 'slab' ? { properties: { type: ['top', 'bottom'] }, default: { type: 'bottom' } } : undefined),
  });

  it('Modelle mit Eltern, Flags, Defaults', () => {
    expect(res.hasBlock(Identifier.parse('stone'))).toBe(true);
    expect(res.hasBlock(Identifier.parse('fehlt'))).toBe(false);
    expect(blockMesh(res, 'stone').quads).toHaveLength(6);
    expect(res.getBlockFlags(Identifier.parse('stone'))).toEqual({ opaque: true });
    expect(res.getBlockFlags(Identifier.parse('slab'))).toBeNull();
    expect(resolveBlockModels(res, 'slab')).toEqual([{ model: 'block/stone', x: 0, y: 0, uvlock: false }]);
    expect(resolveBlockModels(res, 'slab', { type: 'top' })).toEqual([{ model: 'block/odd', x: 180, y: 0, uvlock: false }]);
    expect(res.getBlockProperties(Identifier.parse('slab'))).toEqual({ type: ['top', 'bottom'] });
    expect(res.getPixelSize!()).toBe(1 / 64);
  });

  it('UV aus dem Atlas-Index, fehlende Texturen → Ersatztextur', () => {
    expect(res.getTextureUV(Identifier.parse('block/stone'))).toEqual([0.25, 0, 0.5, 0.25]);
    expect(res.getTextureUV(Identifier.parse('block/unbekannt'))).toEqual([0, 0, 0.25, 0.25]);
  });

  it('synthetische Doppeltruhe: Hälfte reicht bis zur Fuge, Partner im Uhrzeigersinn', () => {
    const seen = spyTextures(res);
    const left = blockMesh(res, 'mcda:double_chest_normal', { facing: 'north', type: 'left' });
    expect(left.quads).toHaveLength(15);
    expect(seen.has('minecraft:entity/chest/normal_left')).toBe(true);
    expect(bounds(left)).toEqual({ min: [1, 0, 0], max: [16, 14, 15] });
    const right = blockMesh(res, 'mcda:double_chest_normal', { facing: 'north', type: 'right' });
    expect(bounds(right)).toEqual({ min: [0, 0, 0], max: [15, 14, 15] });
    // nach Osten blickend liegt der Partner der linken Hälfte im Süden
    expect(bounds(blockMesh(res, 'mcda:double_chest_normal', { facing: 'east', type: 'left' }))).toEqual({ min: [1, 0, 1], max: [16, 14, 16] });
    expect(displayBlock('chest', { facing: 'east', type: 'left', waterlogged: 'false' })).toEqual({
      id: 'mcda:double_chest_normal', props: { facing: 'east', type: 'left', waterlogged: 'false' },
    });
    expect(displayBlock('minecraft:trapped_chest', { type: 'single' }).id).toBe('minecraft:trapped_chest');
  });
});

// ------------------------------------------------------------------------------------------ mit JAR

/** Ressourcen aus dem lokalen JAR, nur im Speicher (Blockstates/Modelle echt, Atlas-Index ohne Pixel). */
function jarResources(): DeepslateResources {
  const jar = localJar();
  const dec = new TextDecoder();
  const files: Array<[string, string]> = [];
  const textures: Record<string, [number, number, number, number]> = { [MISSING_TEXTURE]: [0, 0, 16, 16] };
  let i = 1;
  for (const name of jar.names()) {
    if (!name.startsWith(ASSET_ROOT)) continue;
    const rel = name.slice(ASSET_ROOT.length);
    if (!inExtractScope(rel)) continue;
    if (rel.endsWith('.json')) files.push([rel, dec.decode(jar.read(name))]);
    const tex = textureIdOf(rel);
    if (tex !== undefined) { textures[tex] = [(i % 256) * 16, Math.floor(i / 256) * 16, 16, 16]; i++; }
  }
  textures['minecraft:entity/banner/banner_base'] = textures['minecraft:entity/banner_base']!;
  const { blockstates, models } = buildJsonBundles(files);
  const registry = loadRegistryData('1.21.11');
  const atlasIndex: AtlasIndex = { version: '1.21.11', size: 4096, textures };
  return createDeepslateResources({ version: '1.21.11', atlas: fakeAtlas(1), atlasIndex, blockstates, models, blockInfo: (n) => registry.blocks[n] });
}

describe.skipIf(!HAS_JAR)('Blockstate → Modell mit den echten 1.21.11-Assets (lokales JAR)', () => {
  const res = HAS_JAR ? jarResources() : (undefined as unknown as DeepslateResources);

  it('oak_stairs, shape=outer_left', () => {
    expect(resolveBlockModels(res, 'oak_stairs', { facing: 'east', half: 'bottom', shape: 'outer_left', waterlogged: 'false' })).toEqual([
      { model: 'minecraft:block/oak_stairs_outer', x: 0, y: 270, uvlock: true },
    ]);
    expect(resolveBlockModels(res, 'oak_stairs', { facing: 'south', half: 'top', shape: 'outer_left' })![0]!.x).toBe(180);
    const mesh = blockMesh(res, 'oak_stairs', { facing: 'east', half: 'bottom', shape: 'outer_left' });
    expect(mesh.quads.length).toBeGreaterThan(6);
    expect(bounds(mesh)).toEqual({ min: [0, 0, 0], max: [16, 16, 16] });
  });

  it('lantern hanging=true/false', () => {
    const seen = spyTextures(res);
    expect(resolveBlockModels(res, 'lantern', { hanging: 'true' })!.map((v) => v.model)).toEqual(['minecraft:block/lantern_hanging']);
    expect(resolveBlockModels(res, 'lantern', { hanging: 'false' })!.map((v) => v.model)).toEqual(['minecraft:block/lantern']);
    const hanging = blockMesh(res, 'lantern', { hanging: 'true', waterlogged: 'false' });
    const standing = blockMesh(res, 'lantern', { hanging: 'false', waterlogged: 'false' });
    expect(bounds(hanging).max[1]).toBeGreaterThan(bounds(standing).max[1]!); // Kette nach oben
    expect(seen.has('minecraft:block/lantern')).toBe(true);
  });

  it('red_bed part=head: Partikelmodell + Bett aus deepslates Spezialrenderer', () => {
    const seen = spyTextures(res);
    expect(resolveBlockModels(res, 'red_bed', { part: 'head', facing: 'north', occupied: 'false' })).toEqual([
      { model: 'minecraft:block/bed', x: 0, y: 0, uvlock: false },
    ]);
    const head = blockMesh(res, 'red_bed', { part: 'head', facing: 'north' });
    expect(head.quads.length).toBeGreaterThan(0);
    expect(seen.has('minecraft:entity/bed/red')).toBe(true);
    expect(bounds(head).max[1]).toBe(9); // Matratzenhöhe 9/16
  });

  it('spruce_fence mit Verbindungen (multipart)', () => {
    expect(resolveBlockModels(res, 'spruce_fence', { north: 'true', east: 'true', south: 'false', west: 'false', waterlogged: 'false' })).toEqual([
      { model: 'minecraft:block/spruce_fence_post', x: 0, y: 0, uvlock: false },
      { model: 'minecraft:block/spruce_fence_side', x: 0, y: 0, uvlock: true },
      { model: 'minecraft:block/spruce_fence_side', x: 0, y: 90, uvlock: true },
    ]);
    expect(resolveBlockModels(res, 'spruce_fence')!.map((v) => v.model)).toEqual(['minecraft:block/spruce_fence_post']); // Defaults: keine Verbindung
  });

  it('Truhe, Doppeltruhe, Tür, Rahmen', () => {
    const seen = spyTextures(res);
    expect(blockMesh(res, 'chest', { facing: 'east', type: 'single' }).quads.length).toBeGreaterThan(0);
    expect(seen.has('minecraft:entity/chest/normal')).toBe(true);
    expect(blockMesh(res, 'mcda:double_chest_normal', { facing: 'south', type: 'right' }).quads).toHaveLength(15);
    expect(seen.has('minecraft:entity/chest/normal_right')).toBe(true);
    expect(resolveBlockModels(res, 'spruce_door', { facing: 'north', half: 'upper', hinge: 'left', open: 'false' })![0]!.model).toBe('minecraft:block/spruce_door_top_left');
    expect(blockMesh(res, 'mcda:item_frame', { facing: 'up' }).quads.length).toBeGreaterThan(0);
    expect(bounds(blockMesh(res, 'mcda:item_frame', { facing: 'up' })).min[1]).toBe(0); // Rückseite unten
  });

  it('Beispielhaus (alle Themes): jeder Block hat Blockstate und Mesh, keine fehlende Textur', () => {
    const seen = spyTextures(res);
    const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
    for (const theme of ctx.themes.ids()) {
      const p = Project.create({ id: 'sample', name: 'Beispielhaus', seed: 2026, themeId: theme, targetVersion: TARGET_VERSIONS['1.21.11'] });
      p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
      p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
      p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
      p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
      const volume = generate(p, ctx).materialized.volume;
      const { structure, blockIds, blocks } = toStructure(volume);
      expect(blocks).toBeGreaterThan(500);
      expect(blockIds.filter((id) => !res.hasBlock(Identifier.parse(id))), theme).toEqual([]);
      const done = new Set<string>();
      for (const b of structure.getBlocks()) {
        const key = b.state.toString();
        if (done.has(key)) continue;
        done.add(key);
        expect(blockMesh(res, b.state.getName().toString(), b.state.getProperties()).isEmpty(), key).toBe(false);
      }
    }
    const missing = [...seen].filter((t) => res.getTextureUV(Identifier.parse(t)).join() === res.getTextureUV(Identifier.parse(MISSING_TEXTURE)).join());
    expect(missing).toEqual([]);
  });
});
