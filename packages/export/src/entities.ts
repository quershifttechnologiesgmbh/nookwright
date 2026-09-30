/**
 * Versionsabhängige Positionsfelder von Entities (Serialisierung pro Format und DataVersion)
 * und der Helfer für hängende Entities.
 */
import type { Vec3 } from './model.js';
import { nbt, omitKeys, setOwn, type NbtCompound, type NbtTag } from './nbt/tag.js';
import { features } from './versions.js';

/** Felder, die der Exporter pro Format selbst setzt (und Reader wieder entfernen). */
export const ENTITY_POSITION_KEYS = ['Pos', 'UUID', 'block_pos', 'TileX', 'TileY', 'TileZ'] as const;

/**
 * Entities mit Blockanker (BlockAttachedEntity). Liste aus dem Spielcode; später aus der
 * Registry ableiten. `cushion` (26.3) nutzt laut Faktencheck ebenfalls `block_pos`.
 */
export const BLOCK_ATTACHED_ENTITIES: ReadonlySet<string> = new Set([
  'minecraft:item_frame', 'minecraft:glow_item_frame', 'minecraft:painting', 'minecraft:leash_knot', 'minecraft:cushion',
]);

export type AttachFacing = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';

const FACING_VEC: Readonly<Record<AttachFacing, Vec3>> = {
  down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0],
};

/**
 * Position einer block-verankerten Entity (Rahmen, Gemälde) so, dass `floor(pos) == blockPos`:
 * Blockmitte, 0,46875 Richtung Wand verschoben (wie Vanilla für Größe 1). `facing` ist die
 * Blickrichtung der Entity (weg von der Wand).
 *
 * Bewusst OHNE Größen-Offset für gerade Breiten/Höhen: Structure- und Litematica-Platzierung
 * berechnen den Anker aus `floor(pos)` neu (MC-102223); das Spiel rechnet die echte Mitte selbst nach.
 */
export function attachedPos(blockPos: Vec3, facing: AttachFacing): [number, number, number] {
  const d = FACING_VEC[facing];
  return [
    blockPos[0] + 0.5 - d[0] * 0.46875,
    blockPos[1] + 0.5 - d[1] * 0.46875,
    blockPos[2] + 0.5 - d[2] * 0.46875,
  ];
}

/** Entity nach der Validierung (`prepareVolume`): normalisierte `id`, NBT ohne Positionsfelder. */
export interface PreparedEntity {
  readonly pos: Vec3;
  readonly blockPos: Vec3;
  readonly id: string;
  /** Entity-NBT inkl. `id`, ohne Positions-/UUID-Felder */
  readonly nbt: NbtCompound;
}

/**
 * Setzt die Positionsfelder einer Entity für eine Zielversion; `origin` wird abgezogen
 * (Region-/Kachel-Ursprung).
 * - `Pos` (double[3]) immer
 * - Block-verankerte Entities: `block_pos` (int[3], ab 1.21.5) bzw. `TileX/TileY/TileZ` (davor)
 */
export function entityNbtWithPosition(e: PreparedEntity, dataVersion: number, origin: Vec3 = [0, 0, 0]): NbtCompound {
  const out: Record<string, NbtTag> = { ...e.nbt.value };
  setOwn(out, 'Pos', nbt.doubles([e.pos[0] - origin[0], e.pos[1] - origin[1], e.pos[2] - origin[2]]));
  if (BLOCK_ATTACHED_ENTITIES.has(e.id)) {
    const bp = [e.blockPos[0] - origin[0], e.blockPos[1] - origin[1], e.blockPos[2] - origin[2]] as const;
    if (features(dataVersion).attachedBlockPos) {
      setOwn(out, 'block_pos', nbt.intArray(bp));
    } else {
      setOwn(out, 'TileX', nbt.int(bp[0]));
      setOwn(out, 'TileY', nbt.int(bp[1]));
      setOwn(out, 'TileZ', nbt.int(bp[2]));
    }
  }
  return { type: 'compound', value: out };
}

/** Gegenstück für Reader: Positionsfelder entfernen, Modell-NBT zurückgeben. */
export function stripEntityPosition(c: NbtCompound): NbtCompound {
  return omitKeys(c, ENTITY_POSITION_KEYS);
}

/** `block_pos` (int[3]) oder `TileX/TileY/TileZ` aus Entity-NBT lesen. */
export function attachedBlockPos(c: NbtCompound): [number, number, number] | undefined {
  const bp = c.value['block_pos'];
  if (bp?.type === 'int_array' && bp.value.length === 3) return [bp.value[0]!, bp.value[1]!, bp.value[2]!];
  const x = c.value['TileX'], y = c.value['TileY'], z = c.value['TileZ'];
  if (x?.type === 'int' && y?.type === 'int' && z?.type === 'int') return [x.value, y.value, z.value];
  return undefined;
}
