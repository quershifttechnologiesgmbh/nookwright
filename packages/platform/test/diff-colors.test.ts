import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { diffRegistries } from '../src/build/diff.js';
import { buildRegistry } from '../src/build/registry.js';
import { averageColors, colorDistance, colorOfBlock, decodePng, fromHex, toHex } from '../src/build/colors.js';
import { loadRegistryData } from '../src/node.js';

const mk = (version: string, blocks: Parameters<typeof buildRegistry>[0]['blocks'], items: string[] = []) =>
  buildRegistry({ version, dataVersion: 1, blocks, items, lootTables: [], blockTags: {} });

describe('diffRegistries', () => {
  it('neue/entfernte Blöcke, Property- und Default-Änderungen, Umbenennung', () => {
    const a = mk('a', {
      chain: [{ axis: ['x', 'y', 'z'] }, { axis: 'y' }],
      white_banner: [{ rotation: ['0', '8'] }, { rotation: '0' }],
      note_block: [{ instrument: ['harp'] }, { instrument: 'harp' }],
    });
    const b = mk('b', {
      iron_chain: [{ axis: ['x', 'y', 'z'] }, { axis: 'y' }],
      white_banner: [{ rotation: ['0', '8'] }, { rotation: '8' }],
      note_block: [{ instrument: ['harp', 'trumpet'], powered: ['true', 'false'] }, { instrument: 'harp', powered: 'false' }],
    });
    const d = diffRegistries(a, b);
    expect(d.blocks).toEqual({ added: ['iron_chain'], removed: ['chain'] });
    expect(d.probableRenames).toEqual([{ from: 'chain', to: 'iron_chain' }]);
    const banner = d.propertyChanges.find((c) => c.block === 'white_banner');
    expect(banner?.changedDefaults).toEqual({ rotation: { from: '0', to: '8' } });
    const nb = d.propertyChanges.find((c) => c.block === 'note_block');
    expect(nb?.changedValues['instrument']).toEqual({ added: ['trumpet'], removed: [] });
    expect(Object.keys(nb?.addedProps ?? {})).toEqual(['powered']);
  });
});

describe('Versions-Diff (generierte Daten)', () => {
  it('1.21.11 → 26.3: 40 Schilder/Hängeschilder/Banner mit rotation 0 → 8', () => {
    const d = diffRegistries(loadRegistryData('1.21.11'), loadRegistryData('26.3'));
    const rot = d.propertyChanges.filter((c) => c.changedDefaults['rotation']);
    expect(rot.length).toBe(40);
    expect(rot.map((c) => c.block)).toEqual(expect.arrayContaining(['oak_sign', 'oak_hanging_sign', 'white_banner']));
    expect(d.blocks.removed).toEqual([]);
    expect(d.blocks.added).toContain('poplar_planks');
  });
});

/** Minimaler PNG-Encoder für Tests (RGBA, Filter 0) */
function encodePng(w: number, h: number, rgba: number[]): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const x of buf) c = (crcTable[(c ^ x) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw: number[] = [];
  for (let y = 0; y < h; y++) raw.push(0, ...rgba.slice(y * w * 4, (y + 1) * w * 4));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('Farben', () => {
  it('PNG dekodieren und alpha-gewichtet mitteln', () => {
    // 2×1: rot deckend + grün transparent → Mittel = rot
    const png = encodePng(2, 1, [255, 0, 0, 255, 0, 255, 0, 0]);
    const img = decodePng(png);
    expect(img.width).toBe(2);
    const colors = averageColors(img, { 'block/test': [0, 0, 2, 1] });
    expect(colors.get('test')).toEqual([255, 0, 0]);
    expect(colorOfBlock('test_block', colors)).toEqual([255, 0, 0]); // _block-Suffix wird probiert
  });

  it('Hex und Distanz', () => {
    expect(toHex([255, 16, 0])).toBe('#ff1000');
    expect(fromHex('#ff1000')).toEqual([255, 16, 0]);
    expect(colorDistance([0, 0, 0], [0, 0, 0])).toBe(0);
    expect(colorDistance([200, 200, 200], [210, 210, 210])).toBeLessThan(colorDistance([200, 200, 200], [200, 50, 50]));
  });
});
