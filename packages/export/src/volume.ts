/**
 * Validierung/Normalisierung des Eingabemodells und gemeinsame Helfer für alle Formate
 * (dichter Index, dichtes Paletten-Raster, 48³-Kacheln).
 */
import { canonicalState, isAir, normalizeName, stateToString, type ExportState } from './blockstate.js';
import { BLOCK_ATTACHED_ENTITIES, ENTITY_POSITION_KEYS, type PreparedEntity } from './entities.js';
import type { ExportBlock, ExportEntity, ExportVolume, Vec3 } from './model.js';
import { isNbtTag, nbt, omitKeys, reqTag, setOwn, type NbtCompound, type NbtTag } from './nbt/tag.js';

export interface PreparedBlock {
  readonly pos: Vec3;
  readonly state: ExportState;
  /** Block-Entity inkl. normalisierter `id`, ohne x/y/z */
  readonly blockEntity?: NbtCompound;
}

export interface PreparedVolume {
  readonly name: string;
  readonly author: string;
  readonly dataVersion: number;
  readonly size: Vec3;
  /** Nicht-Luft-Blöcke (inkl. structure_void), sortiert nach Index y → z → x */
  readonly blocks: readonly PreparedBlock[];
  readonly entities: readonly PreparedEntity[];
  readonly warnings: readonly string[];
}

const BLOCK_ENTITY_POSITION_KEYS = ['x', 'y', 'z'] as const;

export class ExportValidationError extends Error {
  override readonly name = 'ExportValidationError';
}

/** Index im dichten Raster: `x + z·W + y·W·L` (Sponge-Reihenfolge; Litematica identisch). */
export function blockIndex(size: Vec3, x: number, y: number, z: number): number {
  return x + z * size[0] + y * size[0] * size[2];
}

export function indexToPos(size: Vec3, i: number): [number, number, number] {
  const layer = size[0] * size[2];
  const y = Math.floor(i / layer);
  const r = i - y * layer;
  const z = Math.floor(r / size[0]);
  return [r - z * size[0], y, z];
}

function isIntVec(v: readonly number[]): boolean {
  return v.length === 3 && v.every((c) => Number.isInteger(c));
}

function inBounds(size: Vec3, p: readonly number[]): boolean {
  return p[0]! >= 0 && p[1]! >= 0 && p[2]! >= 0 && p[0]! < size[0] && p[1]! < size[1] && p[2]! < size[2];
}

function isCompound(x: unknown): x is NbtCompound {
  return isNbtTag(x) && x.type === 'compound';
}

/**
 * Prüft und normalisiert ein `ExportVolume`. Fehler (außerhalb, doppelt, fehlende `id` …) werfen
 * `ExportValidationError` mit allen Meldungen; Unschönes (Positionsfelder im NBT,
 * `floor(pos) ≠ blockPos`) landet in `warnings`.
 */
export function prepareVolume(v: ExportVolume): PreparedVolume {
  const warnings: string[] = [];
  const errors: string[] = [];
  const size: Vec3 = [v.size[0], v.size[1], v.size[2]];
  if (!isIntVec(v.size) || size.some((s) => s < 1)) throw new ExportValidationError(`Ungültige Größe ${JSON.stringify(v.size)}`);
  if (!Number.isInteger(v.dataVersion) || v.dataVersion < 1) throw new ExportValidationError(`Ungültige DataVersion ${v.dataVersion}`);

  const seen = new Map<number, ExportBlock>();
  const blocks: PreparedBlock[] = [];
  for (const b of v.blocks) {
    const where = `Block ${b.name}@${JSON.stringify(b.pos)}`;
    if (!isIntVec(b.pos) || !inBounds(size, b.pos)) { errors.push(`${where}: außerhalb des Volumens`); continue; }
    const idx = blockIndex(size, b.pos[0], b.pos[1], b.pos[2]);
    const prev = seen.get(idx);
    if (prev) { errors.push(`${where}: Position doppelt belegt (${prev.name})`); continue; }
    seen.set(idx, b);
    let state: ExportState;
    try { state = canonicalState(b.name, b.properties); } catch (e) { errors.push(`${where}: ${(e as Error).message}`); continue; }
    if (isAir(state.name)) {
      if (b.blockEntity) errors.push(`${where}: Luft mit Block-Entity`);
      continue; // Luft ist implizit
    }
    const pos: Vec3 = [b.pos[0], b.pos[1], b.pos[2]];
    if (b.blockEntity === undefined) { blocks.push({ pos, state }); continue; }
    if (!isCompound(b.blockEntity)) { errors.push(`${where}: blockEntity ist kein NBT-Compound`); continue; }
    if (b.blockEntity.value['id']?.type !== 'string') { errors.push(`${where}: blockEntity.id (string) fehlt`); continue; }
    let be = withNormalizedId(b.blockEntity);
    const hasPos = BLOCK_ENTITY_POSITION_KEYS.filter((k) => Object.hasOwn(be.value, k));
    if (hasPos.length > 0) {
      warnings.push(`${where}: blockEntity enthält ${hasPos.join('/')} – wird ignoriert`);
      be = omitKeys(be, BLOCK_ENTITY_POSITION_KEYS);
    }
    blocks.push({ pos, state, blockEntity: be });
  }
  blocks.sort((a, b) => blockIndex(size, ...a.pos) - blockIndex(size, ...b.pos));

  const entities: PreparedEntity[] = [];
  for (const [i, e] of v.entities.entries()) {
    const where = `Entity #${i}`;
    if (!isCompound(e.nbt)) { errors.push(`${where}: nbt ist kein NBT-Compound`); continue; }
    if (e.nbt.value['id']?.type !== 'string') { errors.push(`${where}: nbt.id (string) fehlt`); continue; }
    let c = withNormalizedId(e.nbt);
    const idStr = reqTag(c, 'id', 'string').value;
    const present = ENTITY_POSITION_KEYS.filter((k) => Object.hasOwn(c.value, k));
    if (present.length > 0) {
      warnings.push(`${where} (${idStr}): nbt enthält ${present.join('/')} – Exporter setzt diese selbst`);
      c = omitKeys(c, ENTITY_POSITION_KEYS);
    }
    if (e.pos.length !== 3 || e.pos.some((n) => !Number.isFinite(n))) { errors.push(`${where}: ungültige pos`); continue; }
    if (!isIntVec(e.blockPos)) { errors.push(`${where}: blockPos muss ganzzahlig sein`); continue; }
    if (!inBounds(size, e.blockPos)) warnings.push(`${where} (${idStr}): blockPos außerhalb des Volumens`);
    if (!(e.pos[0] >= 0 && e.pos[1] >= 0 && e.pos[2] >= 0 && e.pos[0] < size[0] && e.pos[1] < size[1] && e.pos[2] < size[2])) {
      warnings.push(`${where} (${idStr}): pos außerhalb des Volumens`);
    }
    if (e.pos.some((p, k) => Math.floor(p) !== e.blockPos[k])) {
      warnings.push(BLOCK_ATTACHED_ENTITIES.has(idStr)
        ? `${where} (${idStr}): floor(pos) ≠ blockPos – Structure/Litematica setzen den Anker über floor(pos) (MC-102223-Versatz)`
        : `${where} (${idStr}): floor(pos) ≠ blockPos – .schem/.litematic speichern keine blockPos, Reader leiten floor(pos) ab`);
    }
    entities.push({
      pos: [e.pos[0], e.pos[1], e.pos[2]], blockPos: [e.blockPos[0], e.blockPos[1], e.blockPos[2]], id: idStr, nbt: c,
    });
  }

  if (errors.length > 0) throw new ExportValidationError(`Export ungültig:\n- ${errors.join('\n- ')}`);
  return { name: v.name, author: v.author ?? '', dataVersion: v.dataVersion, size, blocks, entities, warnings };
}

function withNormalizedId(c: NbtCompound): NbtCompound {
  const id = reqTag(c, 'id', 'string').value;
  const norm = normalizeName(id);
  if (norm === id) return c;
  const out: Record<string, NbtTag> = { ...c.value };
  setOwn(out, 'id', nbt.string(norm));
  return { type: 'compound', value: out };
}

/** Dichtes Paletten-Raster (für .schem/.litematic). Index 0 = Luft. */
export interface DenseGrid {
  readonly states: readonly ExportState[];
  readonly indices: Uint32Array;
}

export function toDenseGrid(p: PreparedVolume): DenseGrid {
  const states: ExportState[] = [{ name: 'minecraft:air', properties: {} }];
  const keyToId = new Map<string, number>([['minecraft:air', 0]]);
  const indices = new Uint32Array(p.size[0] * p.size[1] * p.size[2]);
  for (const b of p.blocks) {
    const key = stateToString(b.state);
    let id = keyToId.get(key);
    if (id === undefined) { id = states.length; keyToId.set(key, id); states.push(b.state); }
    indices[blockIndex(p.size, ...b.pos)] = id;
  }
  return { states, indices };
}

// ---------------------------------------------------------------------------
// Kacheln (der Vanilla-Strukturblock speichert max. 48×48×48)
// ---------------------------------------------------------------------------

export interface Tile {
  /** Kachel-Ursprung im Gesamtvolumen */
  readonly origin: Vec3;
  /** Gitterindex der Kachel */
  readonly cell: Vec3;
  readonly volume: ExportVolume;
}

/**
 * Teilt ein Volumen in Kacheln ≤ tileSize³. Blöcke nach Position, Entities nach `blockPos`
 * (Vanilla platziert eine Entity nur, wenn ihre blockPos in der Bounding-Box liegt).
 */
export function tileVolume(v: ExportVolume, tileSize = 48): Tile[] {
  const n = v.size.map((s) => Math.ceil(s / tileSize));
  interface Draft { origin: Vec3; cell: Vec3; size: Vec3; blocks: ExportBlock[]; entities: ExportEntity[] }
  const drafts = new Map<string, Draft>();
  const key = (c: readonly number[]) => c.join(',');
  for (let ty = 0; ty < n[1]!; ty++) for (let tz = 0; tz < n[2]!; tz++) for (let tx = 0; tx < n[0]!; tx++) {
    const origin: Vec3 = [tx * tileSize, ty * tileSize, tz * tileSize];
    const size: Vec3 = [
      Math.min(tileSize, v.size[0] - origin[0]), Math.min(tileSize, v.size[1] - origin[1]), Math.min(tileSize, v.size[2] - origin[2]),
    ];
    drafts.set(key([tx, ty, tz]), { origin, cell: [tx, ty, tz], size, blocks: [], entities: [] });
  }
  const cellOf = (p: Vec3) => p.map((c) => Math.floor(c / tileSize));
  const rel = (p: Vec3, o: Vec3): Vec3 => [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  for (const b of v.blocks) {
    const t = drafts.get(key(cellOf(b.pos)));
    if (!t) throw new ExportValidationError(`Block außerhalb: ${JSON.stringify(b.pos)}`);
    t.blocks.push({ ...b, pos: rel(b.pos, t.origin) });
  }
  for (const e of v.entities) {
    const t = drafts.get(key(cellOf(e.blockPos)));
    if (!t) throw new ExportValidationError(`Entity-blockPos außerhalb: ${JSON.stringify(e.blockPos)}`);
    t.entities.push({ ...e, pos: rel(e.pos, t.origin), blockPos: rel(e.blockPos, t.origin) });
  }
  return [...drafts.values()].map((d) => ({
    origin: d.origin,
    cell: d.cell,
    volume: {
      name: `${v.name}_${d.cell[0]}_${d.cell[1]}_${d.cell[2]}`,
      ...(v.author !== undefined ? { author: v.author } : {}),
      ...(v.disclaimer !== undefined ? { disclaimer: v.disclaimer } : {}),
      dataVersion: v.dataVersion,
      size: d.size,
      blocks: d.blocks,
      entities: d.entities,
    },
  }));
}

/** mcfunction-Zeilen zum Platzieren aller Kacheln relativ zur Ausführungsposition. */
export function placeTilesFunction(tiles: readonly Tile[], namespace: string, strict = true): string {
  return tiles
    .map((t) => `place template ${namespace}:${t.volume.name} ~${t.origin[0]} ~${t.origin[1]} ~${t.origin[2]}${strict ? ' none none 1 0 strict' : ''}`)
    .join('\n') + '\n';
}
