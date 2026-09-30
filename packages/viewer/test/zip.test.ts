import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/assets/crc32.js';
import { ZipArchive, ZipFormatError, extractZipEntry, readZipDirectory } from '../src/assets/zip.js';
import { HAS_JAR, localJar, makeZip, toU8 } from './helpers.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const inflate = (d: Uint8Array): Uint8Array => toU8(inflateRawSync(d));

describe('crc32', () => {
  it('liefert den Standard-Prüfwert', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('ZIP-Leser', () => {
  const big = enc.encode('ab'.repeat(5000));
  const zip = makeZip([
    { name: 'a/stored.txt', data: enc.encode('hallo'), method: 0 },
    { name: 'a/deflated.json', data: big, method: 8 },
    { name: 'b/descriptor.bin', data: Uint8Array.from([1, 2, 3, 250]), method: 8, descriptor: true },
    { name: 'leer/', data: new Uint8Array(0), method: 0 },
  ], 'Kommentar am Ende');

  it('liest das Zentralverzeichnis (Ordner übersprungen, Kommentar erlaubt)', () => {
    const entries = readZipDirectory(zip);
    expect(entries.map((e) => e.name)).toEqual(['a/stored.txt', 'a/deflated.json', 'b/descriptor.bin']);
    expect(entries[1]!.method).toBe(8);
    expect(entries[1]!.size).toBe(big.length);
    expect(entries[1]!.compressedSize).toBeLessThan(big.length);
    expect(entries[2]!.flags & 0x8).toBe(0x8);
  });

  it('entpackt stored, deflate und Einträge mit Data-Descriptor', () => {
    const z = new ZipArchive(zip, inflate);
    expect(dec.decode(z.read('a/stored.txt'))).toBe('hallo');
    expect(z.read('a/deflated.json')).toEqual(big);
    expect([...z.read('b/descriptor.bin')!]).toEqual([1, 2, 3, 250]);
    expect(z.read('fehlt')).toBeUndefined();
    expect(z.has('a/stored.txt')).toBe(true);
  });

  it('erkennt beschädigte Daten (CRC) und Nicht-ZIPs', () => {
    const broken = zip.slice();
    const e = readZipDirectory(broken)[0]!;
    const at = e.localHeaderOffset + 30 + 'a/stored.txt'.length;
    broken[at] = broken[at]! ^ 0xff; // erstes Datenbyte kippen
    expect(() => extractZipEntry(broken, e, inflate)).toThrow(/CRC-32/);
    expect(() => readZipDirectory(enc.encode('kein zip, nur text '.repeat(3)))).toThrow(ZipFormatError);
    expect(() => readZipDirectory(new Uint8Array(4))).toThrow(ZipFormatError);
  });

  it('lehnt ZIP64 ab', () => {
    const z = zip.slice();
    const eocd = z.length - 22 - 'Kommentar am Ende'.length;
    new DataView(z.buffer).setUint16(eocd + 10, 0xffff, true);
    expect(() => readZipDirectory(z)).toThrow(/ZIP64/);
  });
});

describe.skipIf(!HAS_JAR)('ZIP-Leser mit dem lokalen Client-JAR 1.21.11', () => {
  it('findet Blockstates, Modelle und Texturen und entpackt sie', () => {
    const jar = localJar();
    const names = jar.names();
    expect(names.length).toBeGreaterThan(20000);
    expect(names.filter((n) => n.startsWith('assets/minecraft/blockstates/')).length).toBeGreaterThan(1000);
    const bs = JSON.parse(dec.decode(jar.read('assets/minecraft/blockstates/oak_stairs.json'))) as { variants: Record<string, unknown> };
    expect(Object.keys(bs.variants)).toContain('facing=east,half=bottom,shape=outer_left');
    expect(jar.read('assets/minecraft/textures/block/stone.png')!.subarray(1, 4)).toEqual(enc.encode('PNG'));
  });
});
