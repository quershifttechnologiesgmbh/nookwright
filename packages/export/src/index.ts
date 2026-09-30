/**
 * @mcda/export – generischer Kontext „Export“ (aus Spike T1).
 * Alles hier ist browser-tauglich (nur Uint8Array/DataView); GZip kommt über den Port `GzipCodec`
 * (Node-Adapter: `@mcda/export/node`).
 */
export type { ExportBlock, ExportEntity, ExportVolume, Vec3 as ExportVec3 } from './model.js';
export * from './nbt/tag.js';
export { encodeNbt, decodeNbt, encodeMutf8, decodeMutf8, type DecodedNbt } from './nbt/binary.js';
export * from './compression.js';
export {
  AIR, STRUCTURE_VOID, normalizeName, isAir, canonicalProperties, canonicalState, stateToString, parseStateString,
  stateToNbt, stateFromNbt, type ExportState,
} from './blockstate.js';
export * from './versions.js';
export * from './items.js';
export * from './entities.js';
export {
  prepareVolume, ExportValidationError, blockIndex, indexToPos, toDenseGrid, tileVolume, placeTilesFunction,
  type PreparedVolume, type PreparedBlock, type DenseGrid, type Tile,
} from './volume.js';
export {
  buildStructureTag, parseStructureTag, type StructureWriteOptions, type StructureReadResult,
} from './formats/structure.js';
export { buildSpongeTag, parseSpongeTag, type SpongeWriteOptions, type SpongeReadResult } from './formats/sponge.js';
export {
  buildLitematicTag, buildLitematicTagMulti, parseLitematicTag, LITEMATIC_SUBVERSION,
  type LitematicWriteOptions, type LitematicRegionInput, type LitematicRegionRead, type LitematicReadResult,
} from './formats/litematic.js';
export { litematicaBits, packedLongCount, packLitematica, unpackLitematica } from './formats/bitarray.js';
// Hinweistext in Metadaten (`ExportVolume.disclaimer`): Kombination mit einer Beschreibung, NBT-Längengrenze
export { DISCLAIMER_SEPARATOR, NBT_STRING_MAX_BYTES, mutf8Length, withDisclaimer } from './disclaimer.js';
export { encodeVarInts, decodeVarInts, varIntSize } from './formats/varint.js';
export * from './exporter.js';
