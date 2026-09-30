import { describe, expect, it } from 'vitest';
import {
  decodeVarInts, encodeVarInts, litematicaBits, packedLongCount, packLitematica, unpackLitematica,
} from '../src/index.js';
import { rng } from './fixtures/stress.js';
import { packLitematicaReference } from './litematica-reference.js';

describe('VarInt (Sponge Blocks.Data)', () => {
  it('bekannte Vektoren', () => {
    const cases: [number, number[]][] = [
      [0, [0x00]], [1, [0x01]], [127, [0x7f]], [128, [0x80, 0x01]], [255, [0xff, 0x01]],
      [300, [0xac, 0x02]], [16383, [0xff, 0x7f]], [16384, [0x80, 0x80, 0x01]], [2097151, [0xff, 0xff, 0x7f]],
      [2147483647, [0xff, 0xff, 0xff, 0xff, 0x07]],
    ];
    for (const [v, bytes] of cases) {
      expect(Array.from(encodeVarInts([v]))).toEqual(bytes);
      expect(Array.from(decodeVarInts(Uint8Array.from(bytes)))).toEqual([v]);
    }
  });
  it('Round-Trip gemischter Längen', () => {
    const r = rng(7);
    const vals = Array.from({ length: 5000 }, () => Math.floor(r() ** 3 * 70000));
    expect(Array.from(decodeVarInts(encodeVarInts(vals), vals.length))).toEqual(vals);
  });
  it('erkennt Abschneiden und falsche Anzahl', () => {
    expect(() => decodeVarInts(Uint8Array.from([0x80]))).toThrow(/abgeschnitten/);
    expect(() => decodeVarInts(Uint8Array.from([1, 2]), 3)).toThrow(/erwartet 3/);
  });
});

describe('Litematica-Bit-Packing', () => {
  it('bits = max(2, ceil(log2(paletteSize)))', () => {
    const table: [number, number][] = [[1, 2], [2, 2], [3, 2], [4, 2], [5, 3], [8, 3], [9, 4], [16, 4], [17, 5],
      [32, 5], [33, 6], [64, 6], [65, 7], [128, 7], [129, 8], [256, 8], [257, 9], [1024, 10], [1025, 11]];
    for (const [n, bits] of table) {
      expect(litematicaBits(n), `palette ${n}`).toBe(bits);
      expect(Math.max(2, Math.ceil(Math.log2(n)))).toBe(bits);
    }
  });
  it('identisch zum 1:1-Java-Port (setAt) für bits 2..20, inkl. Einträgen über Long-Grenzen', () => {
    const r = rng(42);
    for (let bits = 2; bits <= 20; bits++) {
      for (const n of [1, 31, 32, 33, 63, 64, 65, 100, 1000]) {
        const vals = Array.from({ length: n }, () => Math.floor(r() * 2 ** bits));
        const fast = packLitematica(vals, bits);
        expect(fast.length).toBe(packedLongCount(n, bits));
        expect(fast).toEqual(packLitematicaReference(vals, bits));
        expect(Array.from(unpackLitematica(fast, n, bits))).toEqual(vals);
      }
    }
  });
  it('Handbeispiel: bits=5, Eintrag 12 liegt in Bits 60..64 (über die Long-Grenze), signed Long', () => {
    const vals = Array.from({ length: 13 }, () => 0);
    vals[12] = 0b10111; // untere 4 Bit in long[0] Bits 60..63, oberstes Bit in long[1] Bit 0
    const packed = packLitematica(vals, 5);
    expect(packed.length).toBe(2);
    expect(packed[0]).toBe(BigInt.asIntN(64, 0b0111n << 60n)); // positiv (Bit 63 = 0)
    expect(packed[1]).toBe(1n);
    vals[12] = 0b11111;
    expect(packLitematica(vals, 5)[0]! < 0n).toBe(true); // Bit 63 gesetzt → negativer Long
  });
  it('lehnt zu große Werte / zu kurze Arrays ab', () => {
    expect(() => packLitematica([4], 2)).toThrow(RangeError);
    expect(() => unpackLitematica(new BigInt64Array(1), 100, 5)).toThrow(/zu kurz/);
  });
});
