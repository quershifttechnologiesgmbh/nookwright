import type { Vec3 } from '@mcda/core';
import type { NbtCompound } from '@mcda/export';
import { isAir, type BlockState } from './blockstate.js';
import { isLayer, NO_LAYER, overwriteConflict, type Layer, type Permit } from './layer.js';
import { Palette } from './palette.js';

/** Herkunft: ID der Platzierung (`PlacementId`), die einen Block/eine Entity erzeugt hat. */
export type OwnerId = string;

/** Lesesicht auf eine beschriebene Zelle. */
export interface VoxelCell {
  /** Weltposition */
  readonly pos: Vec3;
  readonly state: BlockState;
  readonly owner: OwnerId;
  readonly layer: Layer;
  /** Block-Entity-NBT inkl. `id`, ohne x/y/z (Konvention von `@mcda/export`). */
  readonly blockEntity?: NbtCompound;
}

/** Was `place` in eine Zelle schreibt. */
export interface PlaceRequest {
  readonly state: BlockState;
  readonly owner: OwnerId;
  readonly layer: Layer;
  readonly blockEntity?: NbtCompound;
  /** Freigabe für die kontextabhängigen Fälle der Merge-Regel (siehe `Permit`). */
  readonly permit?: Permit;
}

export interface VoxelEntity {
  /** Weltposition (Kommazahlen) */
  readonly pos: Vec3;
  /** Ankerblock (Welt); für hängende Entities `floor(pos)` */
  readonly blockPos: Vec3;
  /** Entity-NBT inkl. `id`, ohne Pos/UUID/block_pos/TileX..Z (Konvention von `@mcda/export`). */
  readonly nbt: NbtCompound;
  readonly owner: OwnerId;
  readonly layer: Layer;
}

export interface EntityRequest {
  readonly pos: Vec3;
  /** Default: `floor(pos)` */
  readonly blockPos?: Vec3;
  readonly nbt: NbtCompound;
  readonly owner: OwnerId;
  readonly layer: Layer;
}

/** Verstoß gegen die Merge-Regel (plan/01 §6.1): ein Fehler des Aufrufers, kein stiller Konflikt. */
export class MergeViolationError extends Error {
  override readonly name = 'MergeViolationError';

  constructor(
    readonly pos: Vec3,
    readonly existing: VoxelCell,
    readonly incoming: Omit<PlaceRequest, 'blockEntity'>,
    reason: string,
  ) {
    super(`Merge-Verstoß bei ${pos.join(',')}: ${reason} – vorhanden ${existing.state.name} (${existing.owner}, Schicht ${existing.layer}), neu ${incoming.state.name} (${incoming.owner}, Schicht ${incoming.layer})`);
  }
}

const isIntVec = (v: Vec3): boolean => v.every((c) => Number.isInteger(c));

/**
 * Voxel-Volumen (Kontext „Voxel-Welt“): dichter Quader ab `origin` (Weltkoordinaten) der Größe `size`.
 *
 * Pro Zelle: Palettenindex (0 = Luft), Herkunft (`owner`), Schicht (`layer`, 0 = leer) und optional
 * Block-Entity-Daten. Dazu eine Entity-Liste mit Herkunft und Schicht (plan/01 §6.2).
 * Schreiben geht nur über `place` (Merge-Regel), `replaceState` (Autotiling/Physik: Herkunft bleibt)
 * und `clear`.
 */
export class VoxelVolume {
  readonly origin: Vec3;
  readonly size: Vec3;
  private readonly pal = new Palette();
  private readonly stateIds: Uint32Array;
  private readonly layers: Uint8Array;
  /** Owner-Nummer + 1 (0 = keine Herkunft) */
  private readonly ownerRefs: Uint32Array;
  private readonly ownerIds = new Map<OwnerId, number>();
  private readonly ownerNames: OwnerId[] = [];
  private readonly blockEntities = new Map<number, NbtCompound>();
  private readonly entityList: VoxelEntity[] = [];

  private constructor(size: Vec3, origin: Vec3) {
    this.size = [size[0], size[1], size[2]];
    this.origin = [origin[0], origin[1], origin[2]];
    const n = size[0] * size[1] * size[2];
    this.stateIds = new Uint32Array(n);
    this.layers = new Uint8Array(n);
    this.ownerRefs = new Uint32Array(n);
  }

  static create(size: Vec3, origin: Vec3 = [0, 0, 0]): VoxelVolume {
    if (!isIntVec(size) || size.some((s) => s < 1)) throw new RangeError(`Ungültige Größe ${size.join('×')}`);
    if (!isIntVec(origin)) throw new RangeError(`Ungültiger Ursprung ${origin.join(',')}`);
    return new VoxelVolume(size, origin);
  }

  /** Palette dieses Volumens (Index 0 = Luft); nur lesen. */
  get palette(): Palette {
    return this.pal;
  }

  contains(pos: Vec3): boolean {
    for (let k = 0; k < 3; k++) {
      const c = pos[k]! - this.origin[k]!;
      if (!Number.isInteger(c) || c < 0 || c >= this.size[k]!) return false;
    }
    return true;
  }

  /** Dichter Index `x + z·W + y·W·L` (lokal), wie die Export-Formate. */
  private index(pos: Vec3): number {
    if (!this.contains(pos)) throw new RangeError(`Position ${pos.join(',')} liegt außerhalb des Volumens`);
    const x = pos[0] - this.origin[0], y = pos[1] - this.origin[1], z = pos[2] - this.origin[2];
    return x + z * this.size[0] + y * this.size[0] * this.size[2];
  }

  private posOf(i: number): Vec3 {
    const w = this.size[0], l = this.size[2];
    const y = Math.floor(i / (w * l));
    const r = i - y * w * l;
    const z = Math.floor(r / w);
    return [r - z * w + this.origin[0], y + this.origin[1], z + this.origin[2]];
  }

  private cellAt(i: number): VoxelCell | undefined {
    const layer = this.layers[i]!;
    if (layer === NO_LAYER) return undefined;
    const be = this.blockEntities.get(i);
    return {
      pos: this.posOf(i),
      state: this.pal.get(this.stateIds[i]!),
      owner: this.ownerNames[this.ownerRefs[i]! - 1]!,
      layer: layer as Layer,
      ...(be ? { blockEntity: be } : {}),
    };
  }

  private internOwner(owner: OwnerId): number {
    if (owner.length === 0) throw new Error('Herkunft (owner) darf nicht leer sein');
    let n = this.ownerIds.get(owner);
    if (n === undefined) {
      n = this.ownerNames.length;
      this.ownerIds.set(owner, n);
      this.ownerNames.push(owner);
    }
    return n + 1;
  }

  /** Beschriebene Zelle oder `undefined`, wenn leer (nie beschrieben bzw. gelöscht). */
  cell(pos: Vec3): VoxelCell | undefined {
    return this.cellAt(this.index(pos));
  }

  /**
   * Palettennummern aller Zellen im dichten Index `x + z·W + y·W·L` (0 = Luft) – **nur lesen**; für schnelle
   * Ganzvolumen-Scans (W8-G Windrad-Wächter). Schreiben geht weiter nur über `place`/`replaceState`/`clear`.
   */
  paletteIndices(): Readonly<Uint32Array> {
    return this.stateIds;
  }

  /** Blockzustand; leere Zellen sind Luft. */
  stateAt(pos: Vec3): BlockState {
    return this.pal.get(this.stateIds[this.index(pos)]!);
  }

  isEmpty(pos: Vec3): boolean {
    return this.layers[this.index(pos)] === NO_LAYER;
  }

  /** Grund, warum `place` scheitern würde, oder `undefined`, wenn es erlaubt ist. */
  conflict(pos: Vec3, req: Omit<PlaceRequest, 'state' | 'blockEntity'>): string | undefined {
    const i = this.index(pos);
    const layer = this.layers[i]!;
    return overwriteConflict({
      layer: layer as Layer | typeof NO_LAYER,
      owner: layer === NO_LAYER ? undefined : this.ownerNames[this.ownerRefs[i]! - 1],
      air: isAir(this.pal.get(this.stateIds[i]!)),
    }, req);
  }

  /**
   * Schreibt eine Zelle nach der Merge-Regel (plan/01 §6.1). Wirft `MergeViolationError` bei einem
   * Verstoß. Eine vorhandene Block-Entity wird ersetzt bzw. entfernt.
   */
  place(pos: Vec3, req: PlaceRequest): void {
    if (!isLayer(req.layer)) throw new RangeError(`Ungültige Schicht ${req.layer}`);
    const i = this.index(pos);
    const reason = this.conflict(pos, req);
    if (reason !== undefined) {
      const { blockEntity: _be, ...incoming } = req;
      throw new MergeViolationError([pos[0], pos[1], pos[2]], this.cellAt(i)!, incoming, reason);
    }
    if (req.blockEntity !== undefined && isAir(req.state)) throw new Error(`Luft mit Block-Entity bei ${pos.join(',')}`);
    this.stateIds[i] = this.pal.intern(req.state);
    this.layers[i] = req.layer;
    this.ownerRefs[i] = this.internOwner(req.owner);
    if (req.blockEntity !== undefined) this.blockEntities.set(i, req.blockEntity);
    else this.blockEntities.delete(i);
  }

  /**
   * Ändert nur den Zustand einer beschriebenen Zelle; Herkunft, Schicht und Block-Entity bleiben
   * (Autotiling, Physik-Fallback, Varianten). Wirft bei leerer Zelle.
   */
  replaceState(pos: Vec3, state: BlockState): void {
    const i = this.index(pos);
    if (this.layers[i] === NO_LAYER) throw new Error(`replaceState auf leerer Zelle ${pos.join(',')}`);
    if (isAir(state) && this.blockEntities.has(i)) throw new Error(`Luft mit Block-Entity bei ${pos.join(',')}`);
    this.stateIds[i] = this.pal.intern(state);
  }

  /** Setzt oder entfernt (`undefined`) die Block-Entity einer beschriebenen Nicht-Luft-Zelle. */
  setBlockEntity(pos: Vec3, blockEntity: NbtCompound | undefined): void {
    const i = this.index(pos);
    if (blockEntity === undefined) { this.blockEntities.delete(i); return; }
    if (this.layers[i] === NO_LAYER || isAir(this.pal.get(this.stateIds[i]!))) {
      throw new Error(`Block-Entity braucht einen Block bei ${pos.join(',')}`);
    }
    this.blockEntities.set(i, blockEntity);
  }

  /** Leert eine Zelle (Luft, keine Herkunft, keine Schicht, keine Block-Entity). */
  clear(pos: Vec3): void {
    const i = this.index(pos);
    this.stateIds[i] = 0;
    this.layers[i] = NO_LAYER;
    this.ownerRefs[i] = 0;
    this.blockEntities.delete(i);
  }

  /** Fügt eine Entity hinzu. `blockPos` muss im Volumen liegen (Export kachelt nach `blockPos`). */
  addEntity(req: EntityRequest): VoxelEntity {
    if (!isLayer(req.layer)) throw new RangeError(`Ungültige Schicht ${req.layer}`);
    if (!req.pos.every(Number.isFinite)) throw new RangeError(`Ungültige Entity-Position ${req.pos.join(',')}`);
    const blockPos: Vec3 = req.blockPos ?? [Math.floor(req.pos[0]), Math.floor(req.pos[1]), Math.floor(req.pos[2])];
    if (!this.contains(blockPos)) throw new RangeError(`Entity-blockPos ${blockPos.join(',')} liegt außerhalb des Volumens`);
    this.internOwner(req.owner);
    const e: VoxelEntity = { pos: req.pos, blockPos, nbt: req.nbt, owner: req.owner, layer: req.layer };
    this.entityList.push(e);
    return e;
  }

  /** Alle beschriebenen Zellen in Indexreihenfolge (y → z → x). */
  *cells(): IterableIterator<VoxelCell> {
    for (let i = 0; i < this.layers.length; i++) {
      const c = this.cellAt(i);
      if (c) yield c;
    }
  }

  entities(): readonly VoxelEntity[] {
    return this.entityList;
  }

  /** Alle Herkünfte mit mindestens einer Zelle oder Entity, sortiert. */
  owners(): OwnerId[] {
    const used = new Set<number>();
    for (let i = 0; i < this.ownerRefs.length; i++) if (this.ownerRefs[i] !== 0) used.add(this.ownerRefs[i]! - 1);
    const out = new Set<OwnerId>([...used].map((n) => this.ownerNames[n]!));
    for (const e of this.entityList) out.add(e.owner);
    return [...out].sort();
  }

  /** Zellen einer Herkunft (Auswahl, Materialliste, Neu-Würfeln). Linearer Scan über das Volumen. */
  cellsOf(owner: OwnerId): VoxelCell[] {
    const n = this.ownerIds.get(owner);
    if (n === undefined) return [];
    const out: VoxelCell[] = [];
    for (let i = 0; i < this.ownerRefs.length; i++) if (this.ownerRefs[i] === n + 1) out.push(this.cellAt(i)!);
    return out;
  }

  entitiesOf(owner: OwnerId): VoxelEntity[] {
    return this.entityList.filter((e) => e.owner === owner);
  }
}
