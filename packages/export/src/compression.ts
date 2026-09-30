/**
 * Port „GZip“: Die Writer liefern rohes (unkomprimiertes) NBT; die Kompression wird injiziert.
 *
 * - Node: `nodeGzip` aus `@mcda/export/node` (node:zlib, synchron, Level 9).
 * - Browser (später): `CompressionStream('gzip')` / `DecompressionStream('gzip')` (async, nativ)
 *   oder synchron `fflate` im Web Worker – jeweils als Objekt, das `GzipCodec` erfüllt.
 *
 * Minecraft, WorldEdit und Litematica lesen Standard-GZip (RFC 1952); Header-Felder (mtime, OS) sind egal.
 */
import { decodeNbt, encodeNbt, type DecodedNbt } from './nbt/binary.js';
import type { NbtCompound } from './nbt/tag.js';

export type MaybePromise<T> = T | Promise<T>;

/** GZip-Adapter; darf synchron oder asynchron arbeiten. */
export interface GzipCodec {
  gzip(raw: Uint8Array): MaybePromise<Uint8Array>;
  gunzip(compressed: Uint8Array): MaybePromise<Uint8Array>;
}

/** Synchroner GZip-Adapter (Node, fflate). Erlaubt die `…Sync`-Varianten. */
export interface GzipCodecSync extends GzipCodec {
  gzip(raw: Uint8Array): Uint8Array;
  gunzip(compressed: Uint8Array): Uint8Array;
}

/** GZip-Magic `1f 8b`. */
export function isGzip(b: Uint8Array): boolean {
  return b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;
}

/** Root-Compound → GZip-NBT-Datei (so erwarten es .nbt, .schem und .litematic). */
export async function writeNbtFile(root: NbtCompound, codec: GzipCodec, rootName = ''): Promise<Uint8Array> {
  return codec.gzip(encodeNbt(root, rootName));
}

/** Liest GZip- oder unkomprimiertes NBT. */
export async function readNbtFile(bytes: Uint8Array, codec: GzipCodec): Promise<DecodedNbt> {
  return decodeNbt(isGzip(bytes) ? await codec.gunzip(bytes) : bytes);
}

/** Synchrone Variante für `GzipCodecSync` (Node, Tests, Build-Skripte). */
export function writeNbtFileSync(root: NbtCompound, codec: GzipCodecSync, rootName = ''): Uint8Array {
  return codec.gzip(encodeNbt(root, rootName));
}

/** Synchrone Variante von `readNbtFile`. */
export function readNbtFileSync(bytes: Uint8Array, codec: GzipCodecSync): DecodedNbt {
  return decodeNbt(isGzip(bytes) ? codec.gunzip(bytes) : bytes);
}
