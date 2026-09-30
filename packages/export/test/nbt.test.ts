import { describe, expect, it } from 'vitest';
import {
  decodeMutf8, decodeNbt, encodeMutf8, encodeNbt, isNbtTag, nbt, toNbt, toNbtCompound, toSnbt, toTypedJson,
  type NbtCompound,
} from '../src/index.js';
import { readNbt, writeNbt } from './util.js';

const sample: NbtCompound = nbt.compound({
  b: nbt.byte(-128), bTrue: nbt.byte(true), s: nbt.short(-32768), us: nbt.ushort(65535),
  i: nbt.int(2147483647), l: nbt.long(-(2n ** 63n)), lMax: nbt.long(2n ** 63n - 1n),
  f: nbt.float(0.1), d: nbt.double(Math.PI), str: nbt.string('Größe äöüß – “Zitat” \\ \u0000 Ende'),
  ba: nbt.byteArray([-1, 0, 127, -128]), ia: nbt.intArray([1, -2, 2147483647]),
  la: nbt.longArray([0n, -1n, 2n ** 62n, -(2n ** 63n)]),
  emptyList: nbt.emptyList(),
  listOfLists: nbt.list('list', [nbt.ints([1, 2]), nbt.strings(['a'])]),
  compounds: nbt.compounds([nbt.compound({}), nbt.compound({ x: nbt.int(1) })]),
  nested: nbt.compound({ deeper: nbt.compound({ doubles: nbt.doubles([0.5, -0.25, 1e300]) }) }),
});

describe('NBT-Builder', () => {
  it('prüft Wertebereiche', () => {
    expect(() => nbt.byte(128)).toThrow(RangeError);
    expect(() => nbt.short(40000)).toThrow(RangeError);
    expect(() => nbt.int(2 ** 31)).toThrow(RangeError);
    expect(() => nbt.int(1.5)).toThrow(RangeError);
    expect(() => nbt.long(2n ** 63n)).toThrow(RangeError);
    expect(nbt.ushort(65535).value).toBe(-1);
    expect(nbt.float(0.1).value).toBe(Math.fround(0.1));
  });

  it('erzwingt homogene Listen', () => {
    // @ts-expect-error – falscher Elementtyp wird schon vom Compiler abgelehnt
    expect(() => nbt.list('int', [nbt.string('x')])).toThrow(TypeError);
    expect(() => toNbt([1, 'a'])).toThrow(/heterogene Liste/);
  });

  it('inferiert einfache JS-Werte und übernimmt typisierte Tags', () => {
    const c = toNbtCompound({ a: 1, b: 1.5, c: 'x', d: true, e: 5n, f: [1, 2], g: { h: nbt.byte(3) }, skip: undefined });
    expect(c).toEqual(nbt.compound({
      a: nbt.int(1), b: nbt.double(1.5), c: nbt.string('x'), d: nbt.byte(1), e: nbt.long(5n),
      f: nbt.ints([1, 2]), g: nbt.compound({ h: nbt.byte(3) }),
    }));
    expect(isNbtTag(nbt.int(1))).toBe(true);
    expect(isNbtTag({ type: 'int', value: 1, extra: 1 })).toBe(false);
  });

  it('SNBT-Debugausgabe und Typed JSON', () => {
    expect(toSnbt(nbt.compound({ Slot: nbt.byte(1), 'a b': nbt.floats([1]) }))).toBe('{Slot:1b,"a b":[1f]}');
    expect(toTypedJson(nbt.long(-5n))).toEqual({ type: 'long', value: '-5' });
  });

  it('Keys wie __proto__ bleiben eigene Properties', () => {
    const c = nbt.compound({ ['__proto__']: nbt.int(1) });
    expect(Object.hasOwn(c.value, '__proto__')).toBe(true);
    expect(decodeNbt(encodeNbt(c)).root).toEqual(c);
  });
});

describe('Binäres NBT', () => {
  it('Round-Trip aller Tag-Typen (unkomprimiert und gzip)', () => {
    const bytes = encodeNbt(sample);
    expect(decodeNbt(bytes).root).toEqual(sample);
    expect(readNbt(writeNbt(sample)).root).toEqual(sample);
  });

  it('bekanntes Byte-Layout (Big Endian, leere Liste = TAG_End)', () => {
    const c = nbt.compound({ a: nbt.short(258), l: nbt.emptyList() });
    expect(Array.from(encodeNbt(c, 'r'))).toEqual([
      10, 0, 1, 0x72, //            Root-Compound "r"
      2, 0, 1, 0x61, 1, 2, //       short a = 0x0102
      9, 0, 1, 0x6c, 0, 0, 0, 0, 0, // list l: Typ End, Länge 0
      0, //                          End
    ]);
  });

  it('Modified UTF-8 wie Java (NUL = C0 80, Nicht-BMP als Surrogat-Paar à 3 Byte)', () => {
    expect(Array.from(encodeMutf8('\u0000'))).toEqual([0xc0, 0x80]);
    expect(Array.from(encodeMutf8('ä'))).toEqual([0xc3, 0xa4]);
    expect(Array.from(encodeMutf8('😀'))).toEqual([0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x80]);
    expect(decodeMutf8(encodeMutf8('A😀ä\u0000'))).toBe('A😀ä\u0000');
  });

  it('lehnt kaputte Daten ab', () => {
    const bytes = encodeNbt(sample);
    expect(() => decodeNbt(bytes.subarray(0, bytes.length - 3))).toThrow();
    expect(() => decodeNbt(Uint8Array.from([...bytes, 0]))).toThrow(/überzählige/);
    expect(() => encodeNbt(nbt.compound({ s: nbt.string('x'.repeat(70000)) }))).toThrow(/zu lang/);
  });
});
