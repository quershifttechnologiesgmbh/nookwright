/**
 * Litematica (`.litematic`). Kein offizielles Spec-Dokument; abgeglichen mit dem Quellcode
 * (sakura-ryoko/litematica, Branches LTS/1.21 und 26.3: LitematicaSchematic, SchematicMetadata,
 * LitematicaBlockStateContainer, LitematicaBitArray) und litemapy.
 *
 *   "" : { MinecraftDataVersion:int, Version:int (7; 6 für < 1.20.5), SubVersion:int (1),
 *     Metadata:{ Name, Author, Description:string, RegionCount:int, TotalVolume:int,
 *                TotalBlocks:int, TimeCreated:long, TimeModified:long, EnclosingSize:{x,y,z:int},
 *                PreviewImageData?:int[] },
 *     Regions:{ <name>:{ Position:{x,y,z:int}, Size:{x,y,z:int} (darf negativ sein),
 *       BlockStatePalette:list<{Name, Properties?}> (Index 0 = Luft),
 *       BlockStates:long[] (bit-gepackt, Einträge über Long-Grenzen, Index y*X*Z + z*X + x),
 *       TileEntities:list<{…BE-NBT, id, x,y,z relativ zur Region}>,
 *       Entities:list<{…Entity-NBT, id, Pos:list<double> relativ zur Region, block_pos/TileX..}>,
 *       PendingBlockTicks:list, PendingFluidTicks:list } } }
 *
 * Litematica lädt nur Version <= eigene SCHEMATIC_VERSION: eine v7-Datei scheitert in
 * Litematica für 1.20.1 (dort max. 6). litemapy verlangt TimeCreated/TimeModified/Description
 * und alle vier Listen pro Region.
 */
import { AIR, stateFromNbt, stateToNbt, type ExportState } from '../blockstate.js';
import { withDisclaimer } from '../disclaimer.js';
import { attachedBlockPos, entityNbtWithPosition, stripEntityPosition } from '../entities.js';
import type { ExportBlock, ExportEntity, ExportVolume, Vec3 } from '../model.js';
import { nbt, omitKeys, reqList, reqTag, type NbtCompound, type NbtTag } from '../nbt/tag.js';
import { features } from '../versions.js';
import { blockIndex, indexToPos, prepareVolume, toDenseGrid, type PreparedVolume } from '../volume.js';
import { litematicaBits, packLitematica, unpackLitematica } from './bitarray.js';

export const LITEMATIC_SUBVERSION = 1;

export interface LitematicRegionInput {
  readonly name: string;
  /** Position der Region im Schematic */
  readonly position: Vec3;
  readonly volume: ExportVolume;
}

export interface LitematicWriteOptions {
  /** `Metadata.Description`; ein Disclaimer (`meta.disclaimer` bzw. `ExportVolume.disclaimer`) wird angehängt. */
  readonly description?: string;
  /** ms seit Epoch; Default: jetzt */
  readonly timeCreated?: number;
  /** ms seit Epoch; Default: `timeCreated` */
  readonly timeModified?: number;
  /** Überschreibt Version (Default: 7 ab 1.20.5, sonst 6) */
  readonly version?: number;
}

function vecTag(v: Vec3): NbtCompound {
  return nbt.compound({ x: nbt.int(v[0]), y: nbt.int(v[1]), z: nbt.int(v[2]) });
}

function buildRegion(p: PreparedVolume, position: Vec3): NbtCompound {
  const grid = toDenseGrid(p); // Index 0 = Luft (wie Litematica)
  const bits = litematicaBits(grid.states.length);
  const tileEntities: NbtCompound[] = [];
  for (const b of p.blocks) {
    if (!b.blockEntity) continue;
    tileEntities.push(nbt.compound({
      ...b.blockEntity.value,
      x: nbt.int(b.pos[0]), y: nbt.int(b.pos[1]), z: nbt.int(b.pos[2]),
    }));
  }
  const entities = p.entities.map((e) => entityNbtWithPosition(e, p.dataVersion));
  return nbt.compound({
    BlockStatePalette: nbt.compounds(grid.states.map(stateToNbt)),
    BlockStates: nbt.longArray(packLitematica(grid.indices, bits)),
    TileEntities: nbt.compounds(tileEntities),
    PendingBlockTicks: nbt.emptyList(),
    PendingFluidTicks: nbt.emptyList(),
    Entities: nbt.compounds(entities),
    Position: vecTag(position),
    Size: vecTag(p.size),
  });
}

/**
 * Mehrere Regionen (z. B. je Raum/Etage). Alle Volumen müssen dieselbe DataVersion haben.
 * `meta.disclaimer` (additiv) landet in `Metadata.Description`, angehängt an `opts.description` (`withDisclaimer`);
 * Litematica liest das Feld als beliebigen String (`SchematicMetadata.readData`) und übernimmt es beim Neuspeichern.
 */
export function buildLitematicTagMulti(
  regions: readonly LitematicRegionInput[],
  meta: { readonly name: string; readonly author?: string; readonly dataVersion: number; readonly disclaimer?: string },
  opts: LitematicWriteOptions = {},
): NbtCompound {
  if (regions.length === 0) throw new Error('Litematica: mindestens eine Region nötig');
  const regionTags: Record<string, NbtTag> = {};
  let totalBlocks = 0;
  let totalVolume = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const r of regions) {
    if (r.volume.dataVersion !== meta.dataVersion) throw new Error(`Region ${r.name}: abweichende DataVersion`);
    if (Object.hasOwn(regionTags, r.name)) throw new Error(`Region ${r.name} doppelt`);
    const p = prepareVolume(r.volume);
    regionTags[r.name] = buildRegion(p, r.position);
    totalBlocks += p.blocks.length;
    totalVolume += p.size[0] * p.size[1] * p.size[2];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, r.position[k]!);
      max[k] = Math.max(max[k]!, r.position[k]! + p.size[k]! - 1);
    }
  }
  const now = Date.now();
  const f = features(meta.dataVersion);
  return nbt.compound({
    MinecraftDataVersion: nbt.int(meta.dataVersion),
    Version: nbt.int(opts.version ?? f.litematicVersion),
    SubVersion: nbt.int(LITEMATIC_SUBVERSION),
    Metadata: nbt.compound({
      Name: nbt.string(meta.name),
      Author: nbt.string(meta.author ?? ''),
      Description: nbt.string(withDisclaimer(opts.description ?? '', meta.disclaimer)),
      RegionCount: nbt.int(regions.length),
      TotalVolume: nbt.int(totalVolume),
      TotalBlocks: nbt.int(totalBlocks),
      TimeCreated: nbt.long(BigInt(Math.trunc(opts.timeCreated ?? now))),
      TimeModified: nbt.long(BigInt(Math.trunc(opts.timeModified ?? opts.timeCreated ?? now))),
      EnclosingSize: vecTag([max[0]! - min[0]! + 1, max[1]! - min[1]! + 1, max[2]! - min[2]! + 1]),
    }),
    Regions: nbt.compound(regionTags),
  });
}

export function buildLitematicTag(
  v: ExportVolume,
  opts: LitematicWriteOptions & { readonly regionName?: string } = {},
): NbtCompound {
  return buildLitematicTagMulti(
    [{ name: opts.regionName ?? (v.name || 'main'), position: [0, 0, 0], volume: v }],
    {
      name: v.name, ...(v.author !== undefined ? { author: v.author } : {}), dataVersion: v.dataVersion,
      ...(v.disclaimer !== undefined ? { disclaimer: v.disclaimer } : {}),
    },
    opts,
  );
}

function readVec(c: NbtCompound, key: string): Vec3 {
  const t = reqTag(c, key, 'compound');
  return [reqTag(t, 'x', 'int').value, reqTag(t, 'y', 'int').value, reqTag(t, 'z', 'int').value];
}

export interface LitematicRegionRead {
  readonly name: string;
  /** Minimum-Ecke der Region im Schematic */
  readonly position: Vec3;
  /** Größe wie gespeichert (kann negativ sein) */
  readonly rawSize: Vec3;
  readonly bits: number;
  readonly paletteSize: number;
  readonly volume: ExportVolume;
}

export interface LitematicReadResult {
  readonly version: number;
  readonly subVersion: number;
  readonly dataVersion: number;
  readonly name: string;
  readonly author: string;
  readonly metadata: NbtCompound;
  readonly regions: readonly LitematicRegionRead[];
}

export function parseLitematicTag(root: NbtCompound): LitematicReadResult {
  const version = reqTag(root, 'Version', 'int').value;
  const st = root.value['SubVersion'];
  const subVersion = st?.type === 'int' ? st.value : 0;
  const dataVersion = reqTag(root, 'MinecraftDataVersion', 'int').value;
  const meta = reqTag(root, 'Metadata', 'compound');
  const name = reqTag(meta, 'Name', 'string').value;
  const author = reqTag(meta, 'Author', 'string').value;
  const regions: LitematicRegionRead[] = [];
  for (const [rname, rtag] of Object.entries(reqTag(root, 'Regions', 'compound').value)) {
    if (rtag.type !== 'compound') throw new TypeError(`Region ${rname} ist kein Compound`);
    const position = readVec(rtag, 'Position');
    const rawSize = readVec(rtag, 'Size');
    const size: Vec3 = [Math.abs(rawSize[0]), Math.abs(rawSize[1]), Math.abs(rawSize[2])];
    // Negative Größe: Region erstreckt sich in negative Richtung → Minimum-Ecke verschiebt sich
    const minCorner: Vec3 = [0, 1, 2].map((k) => (rawSize[k]! < 0 ? position[k]! + rawSize[k]! + 1 : position[k]!)) as [number, number, number];
    const palette: ExportState[] = reqList(rtag, 'BlockStatePalette', 'compound').map(stateFromNbt);
    const bits = litematicaBits(palette.length);
    const count = size[0] * size[1] * size[2];
    const idx = unpackLitematica(reqTag(rtag, 'BlockStates', 'long_array').value, count, bits);

    const beByIndex = new Map<number, NbtCompound>();
    for (const te of reqList(rtag, 'TileEntities', 'compound')) {
      const x = reqTag(te, 'x', 'int').value, y = reqTag(te, 'y', 'int').value, z = reqTag(te, 'z', 'int').value;
      beByIndex.set(blockIndex(size, x, y, z), omitKeys(te, ['x', 'y', 'z']));
    }
    const blocks: ExportBlock[] = [];
    for (let i = 0; i < count; i++) {
      const s = palette[idx[i]!];
      if (!s) throw new RangeError(`BlockStates-Index ${idx[i]} außerhalb der Palette (${palette.length})`);
      if (s.name === AIR) continue;
      const be = beByIndex.get(i);
      blocks.push({
        pos: indexToPos(size, i),
        name: s.name,
        ...(Object.keys(s.properties).length > 0 ? { properties: { ...s.properties } } : {}),
        ...(be ? { blockEntity: be } : {}),
      });
    }
    const entities: ExportEntity[] = reqList(rtag, 'Entities', 'compound').map((e) => {
      const pl = reqList(e, 'Pos', 'double');
      const pos: Vec3 = [pl[0]!.value, pl[1]!.value, pl[2]!.value];
      const blockPos = attachedBlockPos(e) ?? [Math.floor(pos[0]), Math.floor(pos[1]), Math.floor(pos[2])];
      return { pos, blockPos, nbt: stripEntityPosition(e) };
    });
    regions.push({
      name: rname, position: minCorner, rawSize, bits, paletteSize: palette.length,
      volume: { name, author, dataVersion, size, blocks, entities },
    });
  }
  return { version, subVersion, dataVersion, name, author, metadata: meta, regions };
}
