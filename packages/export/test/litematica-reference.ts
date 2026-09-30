/**
 * 1:1-Port von LitematicaBitArray.setAt (Java, long-Arithmetik) als Referenz für Tests.
 * Bewusst langsam (BigInt), aber nah am Original.
 */
export function packLitematicaReference(values: ArrayLike<number>, bits: number): BigInt64Array {
  const n = values.length;
  const arr = new BigInt64Array(Math.ceil((n * bits) / 64));
  const maxEntry = (1n << BigInt(bits)) - 1n;
  for (let index = 0; index < n; index++) {
    const value = BigInt(values[index]!);
    const startOffset = BigInt(index) * BigInt(bits);
    const startArrIndex = Number(startOffset >> 6n);
    const endArrIndex = Number(((BigInt(index) + 1n) * BigInt(bits) - 1n) >> 6n);
    const startBitOffset = startOffset & 0x3fn;
    const cur = BigInt.asUintN(64, arr[startArrIndex]!);
    arr[startArrIndex] = BigInt.asIntN(64, (cur & ~(maxEntry << startBitOffset)) | ((value & maxEntry) << startBitOffset));
    if (startArrIndex !== endArrIndex) {
      const endOffset = 64n - startBitOffset;
      const j1 = BigInt(bits) - endOffset;
      const curEnd = BigInt.asUintN(64, arr[endArrIndex]!);
      arr[endArrIndex] = BigInt.asIntN(64, ((curEnd >> j1) << j1) | ((value & maxEntry) >> endOffset));
    }
  }
  return arr;
}
