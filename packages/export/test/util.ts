/** Test-Helfer: Normalform für Round-Trip-Vergleiche und NBT-Dateien über den Node-Codec. */
import { prepareVolume, readNbtFileSync, writeNbtFileSync, type DecodedNbt, type ExportVolume, type NbtCompound } from '../src/index.js';
import { nodeGzip } from '../src/node.js';

/** Vergleichbare Normalform: kanonische States, typisierte NBT, sortierte Blöcke, ohne Warnungen. */
export function normalized(v: ExportVolume, opts: { withMeta?: boolean } = {}) {
  const p = prepareVolume(v);
  return {
    ...(opts.withMeta ? { name: p.name, author: p.author } : {}),
    dataVersion: p.dataVersion,
    size: p.size,
    blocks: p.blocks.map((b) => ({ pos: b.pos, state: b.state, blockEntity: b.blockEntity })),
    entities: p.entities.map((e) => ({ pos: e.pos, blockPos: e.blockPos, nbt: e.nbt })),
  };
}

export const readNbt = (bytes: Uint8Array): DecodedNbt => readNbtFileSync(bytes, nodeGzip);
export const writeNbt = (root: NbtCompound): Uint8Array => writeNbtFileSync(root, nodeGzip);
