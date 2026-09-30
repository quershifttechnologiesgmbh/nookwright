/**
 * Einheitlicher Einstieg für alle drei Formate.
 *
 * Kern (browser-tauglich, synchron): `encodeExport` liefert ROHES NBT (unkomprimiert),
 * `decodeExport` liest rohes NBT. Die Dateiform (GZip) entsteht erst mit einem injizierten
 * `GzipCodec` über `writeExportFile`/`readExportFile` (async) bzw. `…Sync` mit `GzipCodecSync`.
 */
import { isGzip, type GzipCodec, type GzipCodecSync } from './compression.js';
import { buildLitematicTag, parseLitematicTag } from './formats/litematic.js';
import { buildSpongeTag, parseSpongeTag } from './formats/sponge.js';
import { buildStructureTag, parseStructureTag } from './formats/structure.js';
import type { ExportVolume } from './model.js';
import { decodeNbt, encodeNbt } from './nbt/binary.js';
import type { NbtCompound } from './nbt/tag.js';

export type ExportFormat = 'nbt' | 'schem' | 'litematic';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['nbt', 'schem', 'litematic'];

export const FORMAT_EXT: Readonly<Record<ExportFormat, string>> = { nbt: '.nbt', schem: '.schem', litematic: '.litematic' };

export interface ExportOptions {
  /** Zeitstempel (ms seit Epoch) für `.schem` Metadata.Date und `.litematic` TimeCreated/TimeModified. Default: jetzt. */
  readonly date?: number;
  /** Nur `.nbt`: Luft explizit schreiben (Default) oder weglassen (sparse, Welt bleibt dort unverändert). */
  readonly air?: 'explicit' | 'void';
}

/** Volumen → Root-Compound des Formats (für Tests, Debugging oder eigene Serialisierung). */
export function buildExportTag(format: ExportFormat, v: ExportVolume, opts: ExportOptions = {}): NbtCompound {
  switch (format) {
    case 'nbt': return buildStructureTag(v, opts.air !== undefined ? { air: opts.air } : {});
    case 'schem': return buildSpongeTag(v, opts.date !== undefined ? { date: opts.date } : {});
    case 'litematic': return buildLitematicTag(v, opts.date !== undefined ? { timeCreated: opts.date } : {});
  }
}

/** Root-Compound → Volumen (für Litematica: erste Region). */
export function parseExportTag(format: ExportFormat, root: NbtCompound): ExportVolume {
  switch (format) {
    case 'nbt': return parseStructureTag(root).volume;
    case 'schem': return parseSpongeTag(root).volume;
    case 'litematic': {
      const r = parseLitematicTag(root).regions[0];
      if (!r) throw new Error('Litematica-Datei ohne Region');
      return r.volume;
    }
  }
}

/** Volumen → rohes, UNKOMPRIMIERTES NBT (Root-Name ""). */
export function encodeExport(format: ExportFormat, v: ExportVolume, opts: ExportOptions = {}): Uint8Array {
  return encodeNbt(buildExportTag(format, v, opts));
}

/** Rohes (unkomprimiertes) NBT → Volumen. GZip-Daten vorher mit einem `GzipCodec` entpacken. */
export function decodeExport(format: ExportFormat, raw: Uint8Array): ExportVolume {
  if (isGzip(raw)) throw new Error('decodeExport erwartet unkomprimiertes NBT – GZip-Dateien mit readExportFile lesen');
  return parseExportTag(format, decodeNbt(raw).root);
}

/** Volumen → fertige Datei (GZip), Kompression über den injizierten Codec. */
export async function writeExportFile(format: ExportFormat, v: ExportVolume, codec: GzipCodec, opts: ExportOptions = {}): Promise<Uint8Array> {
  return codec.gzip(encodeExport(format, v, opts));
}

/** Datei (GZip oder unkomprimiert) → Volumen. */
export async function readExportFile(format: ExportFormat, bytes: Uint8Array, codec: GzipCodec): Promise<ExportVolume> {
  const raw = isGzip(bytes) ? await codec.gunzip(bytes) : bytes;
  return decodeExport(format, raw);
}

/** Synchrone Variante von `writeExportFile` (Node, Tests, Build-Skripte). */
export function writeExportFileSync(format: ExportFormat, v: ExportVolume, codec: GzipCodecSync, opts: ExportOptions = {}): Uint8Array {
  return codec.gzip(encodeExport(format, v, opts));
}

/** Synchrone Variante von `readExportFile`. */
export function readExportFileSync(format: ExportFormat, bytes: Uint8Array, codec: GzipCodecSync): ExportVolume {
  return decodeExport(format, isGzip(bytes) ? codec.gunzip(bytes) : bytes);
}
