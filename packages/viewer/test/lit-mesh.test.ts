/**
 * Beleuchtete Geometrie: Culling, Licht/AO je Vertex, flache Blöcke (leuchtend, `ambientocclusion: false`),
 * Spawn-Markierung, halbtransparenter Durchgang, Cache. Mini-Assets selbst geschrieben. Das Beispielhaus mit den
 * lokal extrahierten 1.21.11-Assets und den Lichtregeln aus @mcda/materialize misst packages/app/test/viewerLight.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { MISSING_TEXTURE, type BlockFlags } from '../src/assets/extract.js';
import { cellIndex, computeLightField } from '../src/lighting.js';
import { LIT_FLAG_SPAWN, LIT_OFFSETS, LIT_VERTEX_FLOATS, LitMeshCache, buildLitGeometry, type LitBuffers } from '../src/lit-mesh.js';
import { createDeepslateResources } from '../src/resources.js';
import { toStructure } from '../src/structure.js';
import { TEST_RULES, voxels, type Block } from './light-helpers.js';

const FACES = ['north', 'east', 'south', 'west', 'up', 'down'];
const cube = (tex: string, extra: Record<string, unknown> = {}): unknown => ({
  ...extra,
  textures: { t: tex },
  elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(FACES.map((d) => [d, { texture: '#t', cullface: d }])) }],
});
const small = (tex: string, extra: Record<string, unknown> = {}): unknown => ({
  ...extra,
  textures: { t: tex },
  elements: [{ from: [5, 0, 5], to: [11, 7, 11], faces: Object.fromEntries(FACES.map((d) => [d, { texture: '#t' }])) }],
});

const flags: Record<string, BlockFlags> = { stone: { opaque: true }, glass: { self_culling: true, semi_transparent: true } };
const models: Record<string, unknown> = {
  'block/stone': cube('minecraft:block/stone'),
  'block/glass': cube('minecraft:block/stone'),
  'block/lantern': small('minecraft:block/stone'),
  'block/pot_base': small('minecraft:block/stone', { ambientocclusion: false }),
  'block/flower_pot': { parent: 'block/pot_base' },
};
const res = createDeepslateResources({
  version: 'test',
  atlas: { width: 64, height: 64, data: new Uint8Array(64 * 64 * 4) },
  atlasIndex: { version: 'test', size: 64, textures: { [MISSING_TEXTURE]: [0, 0, 16, 16], 'minecraft:block/stone': [16, 0, 16, 16] } },
  blockstates: {
    stone: { variants: { '': { model: 'block/stone' } } },
    glass: { variants: { '': { model: 'block/glass' } } },
    lantern: { variants: { '': { model: 'block/lantern' } } },
    flower_pot: { variants: { '': { model: 'block/flower_pot' } } },
  },
  models,
  blockFlags: flags,
});

/** Werte eines Vertex (k-ter Vertex im Puffer). */
function vertex(b: LitBuffers, k: number): { pos: [number, number, number]; block: number; sky: number; ao: number; shade: number; flags: number } {
  const o = k * LIT_VERTEX_FLOATS;
  const v = b.vertices;
  return {
    pos: [v[o]!, v[o + 1]!, v[o + 2]!],
    block: v[o + LIT_OFFSETS.light]!, sky: v[o + LIT_OFFSETS.light + 1]!, ao: v[o + LIT_OFFSETS.light + 2]!, shade: v[o + LIT_OFFSETS.light + 3]!,
    flags: v[o + LIT_OFFSETS.flags]!,
  };
}
const vertices = (b: LitBuffers): ReturnType<typeof vertex>[] => Array.from({ length: b.quads * 4 }, (_, k) => vertex(b, k));
/** Vertices der Oberseiten (y = top) */
const tops = (b: LitBuffers, top: number): ReturnType<typeof vertex>[] => vertices(b).filter((v) => v.pos[1] === top && v.shade === 1);

function scene(size: readonly [number, number, number], blocks: readonly Block[]) {
  const src = voxels(size, blocks);
  const field = computeLightField(src, TEST_RULES);
  const { structure } = toStructure(src);
  return { src, field, structure };
}

describe('beleuchtete Geometrie (Mini-Assets)', () => {
  const floor: Block[] = [];
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) floor.push([x, 0, z, 'stone']);

  it('Culling wie deepslate: 3×3-Boden + Block obendrauf = 34 Flächen', () => {
    const { structure, field } = scene([3, 3, 3], [...floor, [1, 1, 1, 'stone']]);
    const g = buildLitGeometry(structure, res, field);
    expect(g.quads).toBe(8 + 9 + 12 + 5);
    expect(g.opaque.quads).toBe(34);
    expect(g.transparent.quads).toBe(0);
    expect(g.errors).toEqual([]);
    expect(g.opaque.indices).toHaveLength(34 * 6);
  });

  it('Oberseite: Himmelslicht 15, AO 0,8 an der Kante zum Block, 1 in der freien Ecke; Unterseite dunkler geschattet', () => {
    const { structure, field } = scene([3, 3, 3], [...floor, [1, 1, 1, 'stone']]);
    const g = buildLitGeometry(structure, res, field);
    const top = tops(g.opaque, 1);
    const at = (x: number, z: number): ReturnType<typeof vertex>[] => top.filter((v) => v.pos[0] === x && v.pos[2] === z);
    expect(at(0, 0).every((v) => v.ao === 1 && v.sky === 15)).toBe(true);
    // Ecke (1,1): Oberseiten von (0,0,0) (Block (1,1,1) diagonal), (1,0,0) und (0,0,1) (Block als Seite) → je 0,8
    expect(at(1, 1)).toHaveLength(3);
    for (const v of at(1, 1)) expect(v.ao).toBeCloseTo(0.8);
    // Rand der Oberseite (1,0,0) an der Wand des Blocks: beide Vertices bei z = 1 verdeckt
    expect(at(2, 1).map((v) => v.ao).sort()).toEqual(at(2, 1).map(() => Math.fround(0.8)));
    const bottom = vertices(g.opaque).filter((v) => v.pos[1] === 0 && v.shade === 0.5);
    expect(bottom).toHaveLength(9 * 4);
    expect(bottom.every((v) => v.sky === 0)).toBe(true); // Boden darunter
  });

  it('flach ohne AO: leuchtende Blöcke und Modelle mit ambientocclusion: false; Laterne trägt ihr eigenes Licht', () => {
    const { structure, field } = scene([3, 3, 3], [...floor, [1, 1, 1, 'lantern'], [0, 1, 0, 'flower_pot']]);
    const g = buildLitGeometry(structure, res, field, { models });
    const lantern = vertices(g.opaque).filter((v) => v.pos[0] > 1 && v.pos[0] < 2 && v.pos[1] >= 1 && v.pos[2] > 1 && v.pos[2] < 2);
    expect(lantern.length).toBe(24);
    expect(lantern.every((v) => v.block === 15 && v.ao === 1)).toBe(true);
    const pot = vertices(g.opaque).filter((v) => v.pos[0] > 0 && v.pos[0] < 1 && v.pos[1] >= 1 && v.pos[2] > 0 && v.pos[2] < 1);
    expect(pot.length).toBe(24); // Modell ohne cullface: alle sechs Flächen
    expect(pot.every((v) => v.ao === 1 && v.block === 13)).toBe(true); // flach: Wert der eigenen Zelle (2 Schritte zur Laterne)
    // Boden neben der Laterne: weiches Licht, heller als 13 (Mittel aus 14 und 15)
    expect(Math.max(...tops(g.opaque, 1).map((v) => v.block))).toBeGreaterThan(13);
  });

  it('halbtransparente Blöcke im zweiten Puffer, gleiche Glasblöcke verdecken sich (self_culling)', () => {
    const { structure, field } = scene([3, 3, 3], [...floor, [0, 1, 0, 'glass'], [1, 1, 0, 'glass']]);
    const g = buildLitGeometry(structure, res, field);
    expect(g.transparent.quads).toBe(2 * 5 - 2); // Unterseite auf Stein weg, Zwischenfläche weg
    expect(g.opaque.quads).toBe(9 + 9 + 12); // Glas verdeckt den Boden nicht (nicht opaque)
  });

  it('Spawn-Markierung: nur Oberseiten, die in eine Spawn-Zelle zeigen', () => {
    const { structure, field } = scene([3, 3, 3], floor);
    const spawn = new Set([cellIndex(field.input.size, 2, 1, 2)]);
    const g = buildLitGeometry(structure, res, field, { spawnCells: spawn });
    expect(g.spawnQuads).toBe(1);
    const marked = vertices(g.opaque).filter((v) => (v.flags & LIT_FLAG_SPAWN) !== 0);
    expect(marked).toHaveLength(4);
    expect(marked.every((v) => v.pos[1] === 1 && v.pos[0] >= 2 && v.pos[2] >= 2)).toBe(true);
  });

  it('Cache: gleiche Geometrie, Templates je Zustand und Culling-Maske wiederverwendet; flach = ohne Glättung', () => {
    const { structure, field } = scene([3, 3, 3], [...floor, [1, 1, 1, 'stone']]);
    const cache = new LitMeshCache(res);
    const a = buildLitGeometry(structure, res, field, { cache });
    const n = cache.size;
    const b = buildLitGeometry(structure, res, field, { cache });
    expect(cache.size).toBe(n);
    expect(b.opaque.vertices).toEqual(a.opaque.vertices);
    const flat = buildLitGeometry(structure, res, field, { cache, smooth: false });
    expect(vertices(flat.opaque).every((v) => v.ao === 1)).toBe(true);
  });
});
