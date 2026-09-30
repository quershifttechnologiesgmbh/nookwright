/**
 * VoxelVolume → deepslate `Structure`. Rein; läuft in Node und im Browser.
 *
 * Die Vorschau liest das Volumen nur über die schmale Lesesicht `VoxelSource` (ein `VoxelVolume` aus
 * @mcda/voxel erfüllt sie strukturell). Näherungen (siehe synthetic.ts): Doppeltruhen → `mcda:double_chest_*`,
 * Rahmen-Entities → `mcda:item_frame`. Block-Entity-NBT wird nicht übergeben (deepslate nutzt es nur für
 * Banner-Muster).
 */
import { Structure } from 'deepslate';
import type { Vec3 } from './port.js';
import { DOUBLE_CHEST_TEXTURES, FACING_BY_ID, SYNTHETIC_NAMESPACE } from './synthetic.js';

/** Minimaler NBT-Zugriff (Form von @mcda/export: `{ type, value }`). */
export interface NbtLike {
  readonly type: string;
  readonly value: unknown;
}

export interface VoxelSource {
  readonly origin: Vec3;
  readonly size: Vec3;
  cells(): Iterable<{
    readonly pos: Vec3;
    readonly state: { readonly name: string; readonly properties: Readonly<Record<string, string>> };
  }>;
  entities?(): ReadonlyArray<{ readonly blockPos: Vec3; readonly nbt: NbtLike }>;
}

export interface StructureOptions {
  /** Schnitt: nur Blöcke mit Welt-y ≤ maxY (Innenansicht ohne Dach). */
  readonly maxY?: number;
  /** Rahmen-Entities als Blöcke zeigen (Standard: true). */
  readonly entities?: boolean;
}

export interface StructureResult {
  readonly structure: Structure;
  /** Anzahl gesetzter Blöcke (ohne Luft) */
  readonly blocks: number;
  /** Alle verwendeten Block-IDs mit Namensraum, sortiert */
  readonly blockIds: readonly string[];
}

const AIR = new Set(['air', 'cave_air', 'void_air', 'minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);

/** `oak_stairs` → `minecraft:oak_stairs`; fremde Namensräume bleiben. */
export function blockId(name: string): string {
  return name.includes(':') ? name : `minecraft:${name}`;
}

/** Block → Anzeige-Block (Doppeltruhen-Hälften auf synthetische Blöcke umbiegen). */
export function displayBlock(name: string, props: Readonly<Record<string, string>>): { id: string; props: Record<string, string> } {
  const plain = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
  const stem = DOUBLE_CHEST_TEXTURES[plain];
  const type = props['type'];
  if (stem !== undefined && (type === 'left' || type === 'right')) {
    const p: Record<string, string> = { facing: props['facing'] ?? 'north', type };
    if (props['waterlogged'] !== undefined) p['waterlogged'] = props['waterlogged'];
    return { id: `${SYNTHETIC_NAMESPACE}:double_chest_${stem}`, props: p };
  }
  return { id: blockId(name), props: { ...props } };
}

function frameOf(nbt: NbtLike): { kind: string; facing: string } | undefined {
  if (nbt.type !== 'compound') return undefined;
  const v = nbt.value as Readonly<Record<string, NbtLike | undefined>>;
  const id = v['id']?.value;
  const kind = id === 'minecraft:item_frame' || id === 'item_frame' ? 'item_frame' : id === 'minecraft:glow_item_frame' || id === 'glow_item_frame' ? 'glow_item_frame' : undefined;
  if (kind === undefined || v['Invisible']?.value === 1) return undefined;
  const facing = FACING_BY_ID[typeof v['Facing']?.value === 'number' ? (v['Facing'].value as number) : 2];
  return facing === undefined ? undefined : { kind, facing };
}

export function toStructure(src: VoxelSource, opts: StructureOptions = {}): StructureResult {
  const [ox, oy, oz] = src.origin;
  const structure = new Structure([src.size[0], src.size[1], src.size[2]]);
  const occupied = new Set<string>();
  const ids = new Set<string>();
  let blocks = 0;
  const maxY = opts.maxY ?? Infinity;
  for (const c of src.cells()) {
    if (AIR.has(c.state.name) || c.pos[1] > maxY) continue;
    const local: [number, number, number] = [c.pos[0] - ox, c.pos[1] - oy, c.pos[2] - oz];
    const { id, props } = displayBlock(c.state.name, c.state.properties);
    structure.addBlock(local, id, props);
    occupied.add(local.join(','));
    ids.add(id);
    blocks++;
  }
  if (opts.entities !== false && src.entities) {
    for (const e of src.entities()) {
      const frame = frameOf(e.nbt);
      if (frame === undefined || e.blockPos[1] > maxY) continue;
      const local: [number, number, number] = [e.blockPos[0] - ox, e.blockPos[1] - oy, e.blockPos[2] - oz];
      const key = local.join(',');
      if (occupied.has(key) || local.some((v, k) => v < 0 || v >= src.size[k]!)) continue;
      const id = `${SYNTHETIC_NAMESPACE}:${frame.kind}`;
      structure.addBlock(local, id, { facing: frame.facing });
      occupied.add(key);
      ids.add(id);
      blocks++;
    }
  }
  return { structure, blocks, blockIds: [...ids].sort() };
}
