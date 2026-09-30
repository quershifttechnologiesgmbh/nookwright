import { describe, expect, it } from 'vitest';
import {
  DV, EXPORT_FORMATS, features, itemStack, nbt, parseLitematicTag, parseSpongeTag, parseStructureTag, prepareVolume,
  reqList, reqTag, type NbtCompound,
} from '../src/index.js';
import { exportFile, importFile } from '../src/node.js';
import { buildTestVolume } from './fixtures/testset.js';
import { normalized, readNbt } from './util.js';

/** Zielversionen 1.21.1 / 1.21.11 / 26.3 plus 1.20.1 (Litematica v6, Legacy-Items). */
const VERSIONS = [DV.MC_1_21_1, DV.MC_1_21_11, DV.MC_26_3, DV.MC_1_20_1] as const;
const DATE = Date.UTC(2026, 8, 23, 12, 0, 0);

describe.each(VERSIONS)('Round-Trip DataVersion %i', (dv) => {
  const v = buildTestVolume(dv);
  for (const fmt of EXPORT_FORMATS) {
    it(`${fmt}: write → read → deepEqual`, () => {
      const back = importFile(fmt, exportFile(fmt, v, { date: DATE }));
      expect(normalized(back, { withMeta: fmt !== 'nbt' })).toEqual(normalized(v, { withMeta: fmt !== 'nbt' }));
    });
  }

  it('.nbt: Typen wie StructureTemplate.save (Listen statt IntArray, Luft explizit)', () => {
    const { root } = readNbt(exportFile('nbt', v));
    expect(reqTag(root, 'DataVersion', 'int').value).toBe(dv);
    expect(reqList(root, 'size', 'int').map((t) => t.value)).toEqual(v.size);
    const blocks = reqList(root, 'blocks', 'compound');
    expect(blocks.length).toBe(v.size[0] * v.size[1] * v.size[2]); // dicht inkl. Luft
    for (const b of blocks) {
      expect(reqList(b, 'pos', 'int')).toHaveLength(3);
      reqTag(b, 'state', 'int');
    }
    for (const e of reqList(root, 'entities', 'compound')) {
      expect(reqList(e, 'pos', 'double')).toHaveLength(3);
      expect(reqList(e, 'blockPos', 'int')).toHaveLength(3);
      reqTag(reqTag(e, 'nbt', 'compound'), 'id', 'string');
    }
    const r = parseStructureTag(root);
    expect(r.explicitAir).toBe(v.size[0] * v.size[1] * v.size[2] - prepareVolume(v).blocks.length);
  });

  it('.schem: Typen laut Spec v3 / WorldEdit', () => {
    const { name, root } = readNbt(exportFile('schem', v, { date: DATE }));
    expect(name).toBe('');
    const s = reqTag(root, 'Schematic', 'compound');
    expect(reqTag(s, 'Version', 'int').value).toBe(3);
    expect(reqTag(s, 'Width', 'short').value).toBe(v.size[0]);
    expect(reqTag(s, 'Offset', 'int_array').value).toEqual(Int32Array.from([0, 0, 0]));
    expect(reqTag(reqTag(s, 'Metadata', 'compound'), 'Date', 'long').value).toBe(BigInt(DATE));
    const blocks = reqTag(s, 'Blocks', 'compound');
    reqTag(blocks, 'Data', 'byte_array');
    for (const be of reqList(blocks, 'BlockEntities', 'compound')) {
      expect(reqTag(be, 'Pos', 'int_array').value).toHaveLength(3);
      const data = reqTag(be, 'Data', 'compound');
      expect(Object.keys(data.value)).not.toContain('id');
      expect(Object.keys(data.value)).not.toContain('x');
    }
    for (const e of reqList(s, 'Entities', 'compound')) {
      expect(reqList(e, 'Pos', 'double')).toHaveLength(3);
      expect(Object.keys(reqTag(e, 'Data', 'compound').value)).not.toContain('id');
    }
    expect(parseSpongeTag(root).paletteSize).toBeGreaterThan(30);
  });

  it('.litematic: Header, Metadaten, Region, Bit-Länge', () => {
    const { root } = readNbt(exportFile('litematic', v, { date: DATE }));
    const r = parseLitematicTag(root);
    expect(r.version).toBe(dv >= DV.MC_1_20_5 ? 7 : 6);
    expect(r.subVersion).toBe(1);
    expect(r.dataVersion).toBe(dv);
    const meta = r.metadata;
    expect(reqTag(meta, 'TotalBlocks', 'int').value).toBe(prepareVolume(v).blocks.length);
    expect(reqTag(meta, 'TotalVolume', 'int').value).toBe(v.size[0] * v.size[1] * v.size[2]);
    expect(reqTag(meta, 'TimeCreated', 'long').value).toBe(BigInt(DATE));
    const reg = reqTag(reqTag(root, 'Regions', 'compound'), v.name, 'compound');
    const longs = reqTag(reg, 'BlockStates', 'long_array').value;
    const region = r.regions[0]!;
    expect(longs.length).toBe(Math.ceil((v.size[0] * v.size[1] * v.size[2] * region.bits) / 64));
    const palette0 = reqList(reg, 'BlockStatePalette', 'compound')[0] as NbtCompound;
    expect(reqTag(palette0, 'Name', 'string').value).toBe('minecraft:air');
    for (const te of reqList(reg, 'TileEntities', 'compound')) {
      reqTag(te, 'id', 'string');
      reqTag(te, 'x', 'int');
    }
    for (const e of reqList(reg, 'Entities', 'compound')) {
      reqTag(e, 'id', 'string');
      expect(reqList(e, 'Pos', 'double')).toHaveLength(3);
    }
  });

  it('Entity-Positionsfelder je Version (block_pos ab 1.21.5, sonst TileX/Y/Z)', () => {
    const { root } = readNbt(exportFile('nbt', v));
    const frames = reqList(root, 'entities', 'compound')
      .map((e) => reqTag(e, 'nbt', 'compound'))
      .filter((n) => reqTag(n, 'id', 'string').value === 'minecraft:item_frame');
    expect(frames.length).toBe(2);
    for (const f of frames) {
      if (dv >= DV.MC_1_21_5) {
        expect(reqTag(f, 'block_pos', 'int_array').value).toHaveLength(3);
        expect(f.value['TileX']).toBeUndefined();
      } else {
        reqTag(f, 'TileX', 'int');
        expect(f.value['block_pos']).toBeUndefined();
      }
    }
  });
});

describe('1.20.x: Grenze 1.20.4 → 1.20.5 (DataVersion 3837)', () => {
  const LAST_LEGACY = DV.MC_1_20_5 - 1;

  it('Litematica-Version 6 unter 1.20.5, ab 1.20.5 Version 7', () => {
    expect(features(DV.MC_1_20_1).litematicVersion).toBe(6);
    expect(features(LAST_LEGACY).litematicVersion).toBe(6);
    expect(features(DV.MC_1_20_5).litematicVersion).toBe(7);
    for (const [dv, version] of [[LAST_LEGACY, 6], [DV.MC_1_20_5, 7]] as const) {
      const r = parseLitematicTag(readNbt(exportFile('litematic', buildTestVolume(dv), { date: DATE })).root);
      expect(r.version).toBe(version);
    }
  });

  it('Items: {Count:byte, tag} bis 1.20.4, {count:int, components} ab 1.20.5', () => {
    const legacy = itemStack(LAST_LEGACY, 'iron_sword', 1, { legacyTag: nbt.compound({ Damage: nbt.int(10) }) });
    expect(Object.keys(legacy.value).sort()).toEqual(['Count', 'id', 'tag']);
    expect(reqTag(legacy, 'Count', 'byte').value).toBe(1);
    const modern = itemStack(DV.MC_1_20_5, 'iron_sword', 1);
    expect(Object.keys(modern.value).sort()).toEqual(['count', 'id']);
    expect(reqTag(modern, 'count', 'int').value).toBe(1);
    expect(() => itemStack(LAST_LEGACY, 'stone', 128)).toThrow(/Byte/);
  });

  it('Round-Trip beider Seiten der Grenze in allen Formaten', () => {
    for (const dv of [LAST_LEGACY, DV.MC_1_20_5]) {
      const v = buildTestVolume(dv);
      for (const fmt of EXPORT_FORMATS) {
        expect(normalized(importFile(fmt, exportFile(fmt, v, { date: DATE }))), `${dv} ${fmt}`).toEqual(normalized(v));
      }
    }
  });
});
