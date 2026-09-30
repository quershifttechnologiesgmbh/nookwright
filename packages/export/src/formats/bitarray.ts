/**
 * Litematica-Bit-Packing (LitematicaBitArray):
 * - bits = max(2, ceil(log2(paletteSize)))  (Java: max(2, 32 - numberOfLeadingZeros(size - 1)))
 * - Einträge liegen als durchgehender Little-Endian-Bitstrom im long[]; ein Eintrag darf
 *   ÜBER die Grenze zweier Longs reichen (anders als Chunk-Sections seit 1.16!).
 * - Länge des long[] = ceil(anzahl * bits / 64); Longs sind signed (BigInt64Array).
 *
 * Implementierung über 32-Bit-Wörter (schnell, ohne BigInt pro Eintrag). Weil der Bitstrom
 * little-endian ist, ist long[k] = (word[2k+1] << 32) | word[2k].
 */

export function litematicaBits(paletteSize: number): number {
  if (paletteSize < 1) throw new RangeError('Palette leer');
  const needed = paletteSize <= 1 ? 0 : 32 - Math.clz32(paletteSize - 1);
  return Math.max(2, needed);
}

export function packedLongCount(count: number, bits: number): number {
  return Math.ceil((count * bits) / 64);
}

export function packLitematica(values: ArrayLike<number>, bits: number): BigInt64Array {
  if (bits < 1 || bits > 32) throw new RangeError(`bits=${bits} ungültig`);
  const n = values.length;
  const longs = packedLongCount(n, bits);
  const words = new Uint32Array(longs * 2);
  const max = bits === 32 ? 0xffffffff : (1 << bits) - 1;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    if (v < 0 || v > max) throw new RangeError(`Wert ${v} passt nicht in ${bits} Bit`);
    const bitPos = i * bits;
    const w = Math.floor(bitPos / 32);
    const off = bitPos % 32;
    words[w] = (words[w]! | (v << off)) >>> 0;
    if (off + bits > 32) words[w + 1] = (words[w + 1]! | (v >>> (32 - off))) >>> 0;
  }
  const out = new BigInt64Array(longs);
  for (let k = 0; k < longs; k++) {
    out[k] = BigInt.asIntN(64, (BigInt(words[2 * k + 1]!) << 32n) | BigInt(words[2 * k]!));
  }
  return out;
}

export function unpackLitematica(longs: BigInt64Array, count: number, bits: number): Uint32Array {
  const needed = packedLongCount(count, bits);
  if (longs.length < needed) throw new RangeError(`BlockStates zu kurz: ${longs.length} < ${needed} Longs`);
  const words = new Uint32Array(longs.length * 2 + 1);
  for (let k = 0; k < longs.length; k++) {
    const u = BigInt.asUintN(64, longs[k]!);
    words[2 * k] = Number(u & 0xffffffffn);
    words[2 * k + 1] = Number(u >> 32n);
  }
  const out = new Uint32Array(count);
  const mask = bits === 32 ? 0xffffffff : (1 << bits) - 1;
  for (let i = 0; i < count; i++) {
    const bitPos = i * bits;
    const w = Math.floor(bitPos / 32);
    const off = bitPos % 32;
    let v = words[w]! >>> off;
    if (off + bits > 32) v = (v | (words[w + 1]! << (32 - off))) >>> 0;
    out[i] = (v & mask) >>> 0;
  }
  return out;
}
