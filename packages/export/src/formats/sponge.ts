/**
 * Sponge Schematic v3 (`.schem`), Spezifikation:
 * https://github.com/SpongePowered/Schematic-Specification/blob/master/versions/schematic-3.md
 * Abgeglichen mit WorldEdit 7.3 (SpongeSchematicV3Writer/Reader, ReaderUtil, WriterUtil).
 *
 *   "" : { Schematic: {
 *     Version:int=3, DataVersion:int,
 *     Metadata:{Name, Author, Date:long(ms), RequiredMods?:list<string>, Disclaimer?:string, …frei erweiterbar},
 *     Width/Height/Length: short (UNSIGNED, max 65535),
 *     Offset:int[3] (IntArray!),
 *     Blocks:{ Palette:{"minecraft:x[a=b]":int}, Data:byte[] (VarInts!, Index x + z*W + y*W*L),
 *              BlockEntities:list<{Pos:int[3], Id:string, Data:compound (ohne id/x/y/z)}> },
 *     Entities?:list<{Pos:list<double>[3], Id:string, Data:compound (ohne id, mit Rotation)}> } }
 *
 * Positionen von BlockEntities/Entities sind relativ zur Ecke [0,0,0] (ohne Offset).
 * WorldEdit: Clipboard-Minimum = Offset + Metadata.WorldEdit.Origin. Ohne WorldEdit-Metadaten
 * und mit Offset [0,0,0] ist der Clipboard-Raum identisch mit unseren relativen Koordinaten
 * (wichtig für TileX/block_pos in Entity-Daten, die WorldEdit beim Einfügen mittransformiert).
 *
 * `Metadata.Disclaimer` (additiv, aus `ExportVolume.disclaimer`): Die Spec v3 nennt Name/Author/Date/RequiredMods nur als
 * Leitlinie und empfiehlt, alle Felder in `Metadata` zu erhalten. WorldEdit liest aus `Metadata` nur `WorldEdit.Origin`
 * (SpongeSchematicV3Reader), Litematica nur Name/Author/Date – ein zusätzliches String-Feld stört beide nicht.
 */
import { AIR, parseStateString, stateToString, type ExportState } from '../blockstate.js';
import { withDisclaimer } from '../disclaimer.js';
import { attachedBlockPos, entityNbtWithPosition, stripEntityPosition } from '../entities.js';
import type { ExportBlock, ExportEntity, ExportVolume, Vec3 } from '../model.js';
import { nbt, omitKeys, reqList, reqTag, type NbtCompound, type NbtTag } from '../nbt/tag.js';
import { blockIndex, indexToPos, prepareVolume, toDenseGrid } from '../volume.js';
import { decodeVarInts, encodeVarInts } from './varint.js';

export interface SpongeWriteOptions {
  readonly offset?: Vec3;
  /** Metadata.Date (ms seit Epoch); Default: jetzt */
  readonly date?: number;
  readonly requiredMods?: readonly string[];
  /** Zusätzliche Metadaten (z. B. Projekt-ID, Theme) */
  readonly extraMetadata?: Readonly<Record<string, NbtTag>>;
}

const MAX_DIM = 65535;

export function buildSpongeTag(v: ExportVolume, opts: SpongeWriteOptions = {}): NbtCompound {
  const p = prepareVolume(v);
  for (const [i, s] of p.size.entries()) {
    if (s > MAX_DIM) throw new RangeError(`Sponge: Achse ${'XYZ'[i]} = ${s} > ${MAX_DIM} (unsigned short)`);
  }
  const grid = toDenseGrid(p);
  const palette: Record<string, NbtTag> = {};
  grid.states.forEach((s, i) => { palette[stateToString(s)] = nbt.int(i); });

  const blockEntities: NbtCompound[] = [];
  for (const b of p.blocks) {
    if (!b.blockEntity) continue;
    blockEntities.push(nbt.compound({
      Pos: nbt.intArray(b.pos),
      Id: nbt.string(reqTag(b.blockEntity, 'id', 'string').value),
      Data: omitKeys(b.blockEntity, ['id']),
    }));
  }

  const entities = p.entities.map((e) => {
    const full = entityNbtWithPosition(e, p.dataVersion);
    const data = omitKeys(full, ['id', 'Pos']);
    return nbt.compound({
      Pos: reqTag(full, 'Pos', 'list'),
      Id: nbt.string(e.id),
      // WorldEdit liest Data.Rotation zwingend (getListTag → Exception, wenn es fehlt)
      Data: data.value['Rotation'] ? data : nbt.compound({ ...data.value, Rotation: nbt.floats([0, 0]) }),
    });
  });

  const metadata = nbt.compound({
    Name: nbt.string(p.name),
    Author: nbt.string(p.author),
    Date: nbt.long(BigInt(Math.trunc(opts.date ?? Date.now()))),
    RequiredMods: opts.requiredMods && opts.requiredMods.length > 0 ? nbt.strings(opts.requiredMods) : undefined,
    // Ohne (oder mit leerem) Disclaimer entfällt das Feld – Bytes wie zuvor
    Disclaimer: v.disclaimer ? nbt.string(withDisclaimer('', v.disclaimer)) : undefined,
    ...(opts.extraMetadata ?? {}),
  });

  const schematic = nbt.compound({
    Version: nbt.int(3),
    DataVersion: nbt.int(p.dataVersion),
    Metadata: metadata,
    Width: nbt.ushort(p.size[0]),
    Height: nbt.ushort(p.size[1]),
    Length: nbt.ushort(p.size[2]),
    Offset: nbt.intArray(opts.offset ?? [0, 0, 0]),
    Blocks: nbt.compound({
      Palette: nbt.compound(palette),
      Data: { type: 'byte_array', value: new Int8Array(encodeVarInts(grid.indices).buffer) },
      BlockEntities: nbt.compounds(blockEntities),
    }),
    // WorldEdit lässt Entities weg, wenn leer; laut Spec optional
    Entities: entities.length > 0 ? nbt.compounds(entities) : undefined,
  });
  return nbt.compound({ Schematic: schematic });
}

export interface SpongeReadResult {
  readonly volume: ExportVolume;
  readonly offset: Vec3;
  readonly date?: bigint;
  readonly paletteSize: number;
}

export function parseSpongeTag(root: NbtCompound): SpongeReadResult {
  const s = reqTag(root, 'Schematic', 'compound');
  const version = reqTag(s, 'Version', 'int').value;
  if (version !== 3) throw new Error(`Sponge-Version ${version} nicht unterstützt (nur 3)`);
  const dataVersion = reqTag(s, 'DataVersion', 'int').value;
  const size: Vec3 = [
    reqTag(s, 'Width', 'short').value & 0xffff,
    reqTag(s, 'Height', 'short').value & 0xffff,
    reqTag(s, 'Length', 'short').value & 0xffff,
  ];
  const offTag = s.value['Offset'];
  const offset: Vec3 = offTag?.type === 'int_array' ? [offTag.value[0]!, offTag.value[1]!, offTag.value[2]!] : [0, 0, 0];
  const meta = s.value['Metadata'];
  const metaStr = (k: string): string | undefined => {
    const t = meta?.type === 'compound' ? meta.value[k] : undefined;
    return t?.type === 'string' ? t.value : undefined;
  };
  const name = metaStr('Name') ?? '';
  const author = metaStr('Author');
  const dateTag = meta?.type === 'compound' ? meta.value['Date'] : undefined;
  const date = dateTag?.type === 'long' ? dateTag.value : undefined;

  const blocksTag = reqTag(s, 'Blocks', 'compound');
  const paletteTag = reqTag(blocksTag, 'Palette', 'compound');
  const palette = new Map<number, ExportState>();
  for (const [k, v] of Object.entries(paletteTag.value)) {
    if (v.type !== 'int') throw new TypeError(`Palette-Eintrag ${k} ist kein Int`);
    palette.set(v.value, parseStateString(k));
  }
  const volumeCount = size[0] * size[1] * size[2];
  const data = reqTag(blocksTag, 'Data', 'byte_array').value;
  const indices = decodeVarInts(new Uint8Array(data.buffer, data.byteOffset, data.length), volumeCount);

  const beByIndex = new Map<number, NbtCompound>();
  const beList = blocksTag.value['BlockEntities'] ? reqList(blocksTag, 'BlockEntities', 'compound') : [];
  for (const be of beList) {
    const pos = reqTag(be, 'Pos', 'int_array').value;
    const id = reqTag(be, 'Id', 'string').value;
    const d = be.value['Data'];
    const dataVal = d?.type === 'compound' ? d.value : {};
    beByIndex.set(blockIndex(size, pos[0]!, pos[1]!, pos[2]!), nbt.compound({ id: nbt.string(id), ...dataVal }));
  }

  const blocks: ExportBlock[] = [];
  for (let i = 0; i < volumeCount; i++) {
    const st = palette.get(indices[i]!);
    if (!st) throw new RangeError(`Data-Index ${indices[i]} nicht in Palette`);
    if (st.name === AIR) continue;
    const be = beByIndex.get(i);
    blocks.push({
      pos: indexToPos(size, i),
      name: st.name,
      ...(Object.keys(st.properties).length > 0 ? { properties: { ...st.properties } } : {}),
      ...(be ? { blockEntity: be } : {}),
    });
  }

  const entities: ExportEntity[] = [];
  const entList = s.value['Entities'] ? reqList(s, 'Entities', 'compound') : [];
  for (const e of entList) {
    const posL = reqList(e, 'Pos', 'double');
    const pos: Vec3 = [posL[0]!.value, posL[1]!.value, posL[2]!.value];
    const id = reqTag(e, 'Id', 'string').value;
    const d = e.value['Data'];
    const data: NbtCompound = d?.type === 'compound' ? d : nbt.compound({});
    const blockPos = attachedBlockPos(data) ?? [Math.floor(pos[0]), Math.floor(pos[1]), Math.floor(pos[2])];
    entities.push({ pos, blockPos, nbt: stripEntityPosition(nbt.compound({ id: nbt.string(id), ...data.value })) });
  }
  return {
    volume: { name, ...(author !== undefined ? { author } : {}), dataVersion, size, blocks, entities },
    offset,
    paletteSize: palette.size,
    ...(date !== undefined ? { date } : {}),
  };
}
