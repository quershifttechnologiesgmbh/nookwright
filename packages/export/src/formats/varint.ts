/**
 * VarInt (LEB128, 7 Bit pro Byte, MSB = „weitere Bytes folgen“) wie im Minecraft-Protokoll.
 * Sponge v3 `Blocks.Data` ist eine solche Bytefolge (als NBT Byte-Array) – NICHT ein Byte pro Block!
 * Ab Palettengröße 128 werden Indizes mehrbytig.
 */

export function encodeVarInts(values: ArrayLike<number>): Uint8Array {
  let len = 0;
  for (let i = 0; i < values.length; i++) len += varIntSize(values[i]!);
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < values.length; i++) {
    let v = values[i]! >>> 0; // wie Java: int, unsigned verschoben
    while ((v & ~0x7f) !== 0) {
      out[p++] = (v & 0x7f) | 0x80;
      v >>>= 7;
    }
    out[p++] = v;
  }
  return out;
}

export function varIntSize(value: number): number {
  let v = value >>> 0;
  let n = 1;
  while ((v & ~0x7f) !== 0) { v >>>= 7; n++; }
  return n;
}

export function decodeVarInts(bytes: Uint8Array, expectedCount?: number): Uint32Array {
  const out: number[] = [];
  let p = 0;
  while (p < bytes.length) {
    let value = 0;
    let shift = 0;
    for (;;) {
      if (p >= bytes.length) throw new RangeError('VarInt: abgeschnitten');
      const b = bytes[p++]!;
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) throw new RangeError('VarInt: zu lang');
    }
    out.push(value >>> 0);
  }
  if (expectedCount !== undefined && out.length !== expectedCount) {
    throw new RangeError(`VarInt: ${out.length} Werte, erwartet ${expectedCount}`);
  }
  return Uint32Array.from(out);
}
