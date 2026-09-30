import { CellSet, MOOD_AXES, cellKey, hashSeed, mergeMood, normalizePaletteOverrides, samePaletteOverrides, type Cell, type HorizontalDir, type MoodVector, type PaletteOverrides, type Pose } from '@mcda/core';
import type { ProjectEvent } from './events.js';
import {
  DEFAULT_VOLUME, FLOOR_HEIGHT,
  type BuildingTypeOrigin, type CellList, type Floor, type LinkId, type Placement, type PlacementDraft, type PlacementId, type ProjectState, type Room,
  type RoomId, type StairTurn, type StairType, type TargetVersion, type VerticalLink, type Volume, type VolumeId,
} from './model.js';
import { applyEvent, withDescendants } from './reducer.js';
import type { InteriorDecor } from './interiorDecor.js';
import type { StoryState } from './story.js';
import { checkLink } from './stairs.js';
import { checkVolume, cleanVolume, roomFloor, sameVolume, volumeById, volumeClash, volumeOf, type VolumeProps } from './volumes.js';

/**
 * Umfang eines Bautyp-Neubaus (`applyBuildingType`, `rerollBuildingType`) – für Rückfrage und Statuszeile (W2-ED U1).
 * `replaced`: Bautyp-Räume, die der Neubau ersetzt. `user`: vom Nutzer gemalte oder veränderte Räume (bleiben).
 * `pinned`: Bautyp-Räume, die bleiben, weil sie fixiert sind (W2-ED U4) oder gesperrte bzw. von Hand gesetzte Möbel
 * tragen („Gesperrt überlebt alles außer Löschen“). `lockedPlacements`: gesperrte Möbel, die damit erhalten bleiben.
 */
export interface BuildingTypeScope {
  readonly replaced: readonly RoomId[];
  readonly user: readonly RoomId[];
  readonly pinned: readonly RoomId[];
  readonly lockedPlacements: number;
}

/** Bautyp-Räume, die ein Neubau nicht wegwerfen darf: fixiert oder mit gesperrten bzw. von Hand gesetzten Möbeln. */
function pinnedRooms(state: ProjectState): Set<RoomId> {
  return new Set([...state.placements.filter((p) => p.locked || p.origin === 'manual').map((p) => p.roomId), ...state.rooms.filter((r) => r.fixed === true).map((r) => r.id)]);
}

/** Was ein Bautyp-Neubau am aktuellen Zustand ersetzen bzw. stehen lassen würde (rein, ohne Events). */
export function buildingTypeScope(state: ProjectState): BuildingTypeScope {
  const pins = pinnedRooms(state);
  const replaced: RoomId[] = [];
  const user: RoomId[] = [];
  const pinned: RoomId[] = [];
  for (const r of state.rooms) {
    if (r.origin !== 'type') user.push(r.id);
    else if (pins.has(r.id)) pinned.push(r.id);
    else replaced.push(r.id);
  }
  const keep = new Set([...user, ...pinned]);
  return { replaced, user, pinned, lockedPlacements: state.placements.filter((p) => p.locked && keep.has(p.roomId)).length };
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface CreateProject {
  readonly id: string;
  readonly name: string;
  readonly seed: number;
  readonly themeId: string;
  readonly targetVersion: TargetVersion;
  /** Standard: Boden bei y = 0, lichte Höhe 3. */
  readonly floor?: { y0: number; height: number };
}

/** Raum eines Bautyp-Plans (research/19 §7.3 `BuildingPlan.rooms`). */
export interface BuildingTypeRoomDraft {
  readonly floorIndex: number;
  readonly cells: CellSet | CellList;
  readonly roomTypeId: string;
  /** Lokaler Schlüssel aus `BuildingTypeDraft.volumes` bzw. `DEFAULT_VOLUME` (Standard). */
  readonly volume?: string;
}

/** Treppe eines Bautyp-Plans (wie `placeStairs`). */
export interface BuildingTypeStairDraft {
  readonly floorIndex: number;
  readonly origin: Cell;
  readonly facing: HorizontalDir;
  readonly type?: StairType;
  readonly turn?: StairTurn;
}

/**
 * Ergebnis des Grundriss-Generators (@mcda/archetype), das das Aggregat in EINEM Schritt übernimmt
 * (`applyBuildingType`, `rerollBuildingType`). Lokale Schlüssel statt IDs – die IDs vergibt das Aggregat.
 */
export interface BuildingTypeDraft {
  readonly origin: BuildingTypeOrigin;
  /** Lichte Höhe je Etagenindex: fehlende Etagen werden lückenlos angelegt, vorhandene angepasst. */
  readonly floors?: Readonly<Record<number, number>>;
  /**
   * Baukörper des Plans. Schlüssel `DEFAULT_VOLUME` setzt die Eigenschaften des Standard-Baukörpers (fehlt er, werden
   * sie zurückgesetzt); jeder andere Schlüssel wird ein neuer Baukörper.
   */
  readonly volumes?: ReadonlyArray<VolumeProps & { readonly key: string }>;
  readonly rooms: readonly BuildingTypeRoomDraft[];
  readonly stairs?: readonly BuildingTypeStairDraft[];
}

/**
 * Aggregat-Wurzel „Projekt“.
 * Befehle prüfen die Invarianten, erzeugen Domain Events und wenden sie an.
 * Der Zustand ist allein aus der Event-Historie ableitbar (Undo = Historie kürzen und neu abspielen).
 */
export class Project {
  private constructor(
    private current: ProjectState,
    private readonly log: ProjectEvent[],
  ) {}

  static create(cmd: CreateProject): Project {
    const e: ProjectEvent = {
      type: 'ProjectCreated',
      id: cmd.id,
      name: cmd.name,
      seed: cmd.seed >>> 0,
      themeId: cmd.themeId,
      targetVersion: cmd.targetVersion,
      floor: { index: 0, y0: cmd.floor?.y0 ?? 0, height: cmd.floor?.height ?? 3 },
    };
    return new Project(applyEvent(undefined, e), [e]);
  }

  static fromHistory(events: readonly ProjectEvent[]): Project {
    if (events.length === 0 || events[0]!.type !== 'ProjectCreated') throw new DomainError('history', 'Historie muss mit ProjectCreated beginnen');
    let s: ProjectState | undefined;
    for (const e of events) s = applyEvent(s, e);
    return new Project(s!, [...events]);
  }

  get state(): ProjectState {
    return this.current;
  }

  get history(): readonly ProjectEvent[] {
    return this.log;
  }

  /** Neues Aggregat ohne die letzten `n` Events (Undo). */
  undo(n = 1): Project {
    if (this.log.length - n < 1) throw new DomainError('undo', 'Nichts mehr rückgängig zu machen');
    return Project.fromHistory(this.log.slice(0, this.log.length - n));
  }

  room(id: RoomId): Room {
    const r = this.current.rooms.find((x) => x.id === id);
    if (r === undefined) throw new DomainError('room.unknown', `Unbekannter Raum ${id}`);
    return r;
  }

  floor(index: number): Floor {
    const f = this.current.floors.find((x) => x.index === index);
    if (f === undefined) throw new DomainError('floor.unknown', `Unbekannte Etage ${index}`);
    return f;
  }

  link(id: LinkId): VerticalLink {
    const l = this.current.links.find((x) => x.id === id);
    if (l === undefined) throw new DomainError('stairs.unknown', `Unbekannte Treppe ${id}`);
    return l;
  }

  /** Baukörper nach ID (der Standard-Baukörper `DEFAULT_VOLUME` existiert immer). */
  volume(id: VolumeId): Volume {
    const v = volumeById(this.current, id);
    if (v === undefined) throw new DomainError('volume.unknown', `Unbekannter Baukörper ${id}`);
    return v;
  }

  /** Effektive Etage eines Raums: Boden und lichte Höhe seines Baukörpers. */
  roomFloor(id: RoomId): Floor {
    const f = roomFloor(this.current, this.room(id));
    if (f === undefined) throw new DomainError('floor.unknown', `Raum ${id} liegt auf keiner Etage`);
    return f;
  }

  placement(id: PlacementId): Placement {
    const p = this.current.placements.find((x) => x.id === id);
    if (p === undefined) throw new DomainError('placement.unknown', `Unbekannte Platzierung ${id}`);
    return p;
  }

  /** Seed eines Raums: ändert sich nur durch Neu-Würfeln. */
  roomSeed(id: RoomId): number {
    const r = this.room(id);
    return hashSeed(this.current.seed, r.id, r.rerollCount);
  }

  // ------------------------------------------------------------------ Befehle

  /**
   * Malt einen Raum. Auf oberen Etagen dürfen Räume über die Etage darunter hinausragen (Balkon/Auskragung);
   * die Hülle meldet das als Warnung. Treppen, deren Zellen danach nicht mehr im Kern eines Raums liegen,
   * werden mit entfernt (`StairsRemoved`).
   * Additiv (Baukörper): `opts.volumeId` ordnet den Raum einem Baukörper zu (Standard `DEFAULT_VOLUME`). Auf derselben
   * Etage nimmt er – wie jeder Raum – anderen Räumen die Zellen; Räume ANDERER Baukörper auf anderen Etagen darf er
   * nicht überdecken (`volume.overlap`). Übermalte Bautyp-Räume werden Nutzer-Räume (`RoomOriginSet`).
   */
  paintRoom(floorIndex: number, cells: CellSet, roomTypeId: string, opts: { volumeId?: VolumeId } = {}): ProjectEvent[] {
    this.requireFloor(floorIndex);
    if (cells.isEmpty) throw new DomainError('room.empty', 'Ein Raum braucht mindestens eine Zelle');
    if (!cells.isConnected()) throw new DomainError('room.disconnected', 'Die Zellen eines Raums müssen zusammenhängen');
    const volumeId = opts.volumeId ?? DEFAULT_VOLUME;
    this.volume(volumeId);
    const events = this.takeCells(floorIndex, cells);
    const roomId = this.nextId('r', events);
    events.push({ type: 'RoomPainted', roomId, floorIndex, cells: cells.toArray(), roomTypeId, ...(volumeId !== DEFAULT_VOLUME ? { volumeId } : {}) });
    if (volumeId !== DEFAULT_VOLUME || this.current.rooms.some((r) => r.volumeId !== undefined)) this.requireNoClash(events, new Set([roomId]));
    return this.commit(this.withLinkRepair(this.withUserOrigin(events)));
  }

  eraseCells(floorIndex: number, cells: CellSet): ProjectEvent[] {
    this.requireFloor(floorIndex);
    return this.commit(this.withLinkRepair(this.withUserOrigin(this.takeCells(floorIndex, cells))));
  }

  /** Projekt umbenennen (Name für Export und Anzeige). Leerraum am Rand wird entfernt; leer ist nicht erlaubt. */
  rename(name: string): ProjectEvent[] {
    const clean = name.trim();
    if (clean.length === 0) throw new DomainError('project.name', 'Der Projektname darf nicht leer sein');
    return clean === this.current.name ? [] : this.commit([{ type: 'ProjectRenamed', name: clean }]);
  }

  /**
   * Neue Etage über der obersten (Standard) oder unter der untersten. Etagenabstand: die Bodenplatte der
   * oberen Etage ist die Decke der unteren (`y0 = y0(unten) + Höhe(unten) + 1`).
   * @param opts.height lichte Höhe (Standard: wie die angrenzende Etage), `FLOOR_HEIGHT.min`–`max`
   */
  addFloor(opts: { height?: number; below?: boolean } = {}): ProjectEvent[] {
    const floors = this.current.floors;
    const edge = opts.below === true ? floors[0]! : floors[floors.length - 1]!;
    const height = opts.height ?? edge.height;
    if (!Number.isInteger(height) || height < FLOOR_HEIGHT.min || height > FLOOR_HEIGHT.max) {
      throw new DomainError('floor.height', `Lichte Höhe ${height} nicht erlaubt (${FLOOR_HEIGHT.min}–${FLOOR_HEIGHT.max})`);
    }
    const floor: Floor =
      opts.below === true
        ? { index: edge.index - 1, y0: edge.y0 - height - 1, height }
        : { index: edge.index + 1, y0: edge.y0 + edge.height + 1, height };
    return this.commit([{ type: 'FloorAdded', floor }]);
  }

  /**
   * Ändert die lichte Höhe (= Wandhöhe) einer Etage. Darüberliegende Etagen samt Platzierungen rutschen mit;
   * automatische, ungesperrte Platzierungen der Etage entfallen und sind danach neu einzurichten.
   */
  setFloorHeight(index: number, height: number): ProjectEvent[] {
    this.requireFloor(index);
    if (!Number.isInteger(height) || height < FLOOR_HEIGHT.min || height > FLOOR_HEIGHT.max) {
      throw new DomainError('floor.height', `Lichte Höhe ${height} nicht erlaubt (${FLOOR_HEIGHT.min}–${FLOOR_HEIGHT.max})`);
    }
    const floor = this.current.floors.find((f) => f.index === index)!;
    return floor.height === height ? [] : this.commit([{ type: 'FloorHeightChanged', index, height }]);
  }

  /** Entfernt die oberste oder unterste Etage samt Räumen, Platzierungen und angeschlossenen Treppen. */
  removeFloor(index: number): ProjectEvent[] {
    this.requireFloor(index);
    const floors = this.current.floors;
    if (floors.length === 1) throw new DomainError('floor.last', 'Die letzte Etage kann nicht entfernt werden');
    if (index !== floors[0]!.index && index !== floors[floors.length - 1]!.index) {
      throw new DomainError('floor.inner', 'Nur die oberste oder unterste Etage kann entfernt werden');
    }
    const events: ProjectEvent[] = [
      ...this.current.links
        .filter((l) => l.floorIndex === index || l.floorIndex + 1 === index)
        .map((l): ProjectEvent => ({ type: 'StairsRemoved', linkId: l.id })),
      ...this.current.rooms.filter((r) => r.floorIndex === index).map((r): ProjectEvent => ({ type: 'RoomRemoved', roomId: r.id })),
      { type: 'FloorRemoved', index },
    ];
    return this.commit(events);
  }

  /**
   * Setzt eine Treppe (oder Leiter) von Etage `floorIndex` zur Etage darüber. Die reservierten Zellen
   * (unten: Stufen + Antritt, oben: Öffnung + oberste Stufe + Austritt) müssen je im Kern EINES Raums liegen
   * und dürfen keine andere Treppe schneiden. Platzierungen mit Ankerzelle darin werden entfernt.
   */
  placeStairs(floorIndex: number, origin: Cell, facing: HorizontalDir, type: StairType = 'straight', opts: { turn?: StairTurn } = {}): ProjectEvent[] {
    this.requireFloor(floorIndex);
    const link: VerticalLink = {
      id: `s${this.current.seq}`,
      type,
      floorIndex,
      origin: [origin[0], origin[1]],
      facing,
      ...(type === 'l' || type === 'u' || type === 'spiral' ? { turn: opts.turn ?? 'right' } : {}),
    };
    const res = checkLink(this.current, link);
    if (typeof res === 'string') throw new DomainError('stairs.invalid', res);
    const hit = (p: Placement): boolean =>
      (p.roomId === res.lower.id && res.lowerCells.has(p.pose.pos[0], p.pose.pos[2])) ||
      (p.roomId === res.upper.id && res.upperCells.has(p.pose.pos[0], p.pose.pos[2]));
    const removed = new Set<PlacementId>();
    const events: ProjectEvent[] = [];
    for (const p of this.current.placements) {
      if (removed.has(p.id) || !hit(p)) continue;
      for (const id of withDescendants(this.current.placements, new Set([p.id]))) removed.add(id);
      events.push({ type: 'PlacementRemoved', placementId: p.id });
    }
    events.push({ type: 'StairsPlaced', link });
    return this.commit(events);
  }

  removeStairs(id: LinkId): ProjectEvent[] {
    this.link(id);
    return this.commit([{ type: 'StairsRemoved', linkId: id }]);
  }

  assignRoomType(roomId: RoomId, roomTypeId: string): ProjectEvent[] {
    const r = this.room(roomId);
    if (r.roomTypeId === roomTypeId) return [];
    return this.commit(this.withUserOrigin([{ type: 'RoomTypeAssigned', roomId, roomTypeId }]));
  }

  rerollRoom(roomId: RoomId): ProjectEvent[] {
    const r = this.room(roomId);
    return this.commit([{ type: 'RoomRerolled', roomId, rerollCount: r.rerollCount + 1 }]);
  }

  /**
   * Variante ◀ ▶ (W2-ED U4): springt zum Wurf `variant` (0 = erster). Deterministisch über `roomSeed` – dieselbe
   * Variante ergibt dieselbe Einrichtung; gesperrte Möbel bleiben. Gleiches Event wie `rerollRoom`.
   */
  setRoomVariant(roomId: RoomId, variant: number): ProjectEvent[] {
    const r = this.room(roomId);
    if (!Number.isInteger(variant) || variant < 0) throw new DomainError('room.variant', `Variante ${variant} nicht erlaubt (ganze Zahl ≥ 0)`);
    return variant === r.rerollCount ? [] : this.commit([{ type: 'RoomRerolled', roomId, rerollCount: variant }]);
  }

  /** Raum fixieren bzw. lösen (W2-ED U4): ein fixierter Raum übersteht Bautyp-Neubau (`buildingTypeScope`). */
  fixRoom(roomId: RoomId, fixed: boolean): ProjectEvent[] {
    const r = this.room(roomId);
    return (r.fixed === true) === fixed ? [] : this.commit([{ type: 'RoomFixed', roomId, fixed }]);
  }

  /**
   * Raum vergrößern bzw. verkleinern (W2-ED U4, Anfasser im Grundriss): `add` kommt hinzu (Nachbarn derselben Etage
   * geben diese Zellen ab wie beim Malen), `remove` geht weg. Der Raum BEHÄLT seine ID, Sperren und Einrichtung – vorher
   * erzeugte Übermalen einen neuen Raum (neue ID, Sperren weg). Er muss zusammenhängend und nicht leer bleiben;
   * Treppen, die danach nicht mehr passen, entfallen. Ein Bautyp-Raum wird dadurch Nutzer-Raum.
   */
  resizeRoom(roomId: RoomId, add: CellSet, remove: CellSet): ProjectEvent[] {
    const room = this.room(roomId);
    const gain = add.difference(room.cells);
    const lose = remove.intersection(room.cells).difference(gain);
    if (gain.isEmpty && lose.isEmpty) return [];
    const next = room.cells.union(gain).difference(lose);
    if (next.isEmpty) throw new DomainError('room.empty', 'Ein Raum braucht mindestens eine Zelle – zum Entfernen „Löschen“');
    if (!next.isConnected()) throw new DomainError('room.disconnected', 'Die Zellen eines Raums müssen zusammenhängen');
    const events: ProjectEvent[] = [];
    if (!gain.isEmpty) {
      // Nachbarn geben die Zellen ab (wie beim Malen); der Raum selbst ist nicht betroffen (gain liegt außerhalb)
      events.push(...this.takeCells(room.floorIndex, gain));
      events.push({ type: 'RoomCellsGained', roomId, cells: gain.toArray() });
    }
    if (!lose.isEmpty) events.push({ type: 'RoomCellsLost', roomId, cells: lose.toArray() });
    if (!gain.isEmpty && (room.volumeId !== undefined || this.current.rooms.some((r) => r.volumeId !== undefined))) this.requireNoClash(events, new Set([roomId]));
    return this.commit(this.withLinkRepair(this.withUserOrigin(events)));
  }

  /** Übernimmt das Ergebnis der Einrichtung. Ersetzt automatische, ungesperrte Platzierungen. */
  applyFurnishing(roomId: RoomId, drafts: readonly PlacementDraft[]): ProjectEvent[] {
    this.room(roomId);
    const keys = new Map<string, PlacementId>();
    let n = this.current.seq;
    for (const d of drafts) {
      if (keys.has(d.key)) throw new DomainError('furnish.key', `Doppelter Schlüssel ${d.key}`);
      keys.set(d.key, `p${n++}`);
    }
    const survivors = new Set(this.current.placements.filter((p) => p.roomId === roomId && (p.locked || p.origin === 'manual')).map((p) => p.id));
    const placements: Placement[] = drafts.map((d) => {
      let parentId: PlacementId | undefined;
      if (d.parentKey !== undefined) {
        parentId = keys.get(d.parentKey) ?? (survivors.has(d.parentKey) ? d.parentKey : undefined);
        if (parentId === undefined) throw new DomainError('furnish.parent', `Eltern ${d.parentKey} von ${d.key} unbekannt`);
      }
      return {
        id: keys.get(d.key)!,
        roomId,
        componentId: d.componentId,
        ...(d.variantId !== undefined ? { variantId: d.variantId } : {}),
        pose: d.pose,
        seed: d.seed,
        ...(parentId !== undefined ? { parentId } : {}),
        ...(d.socketId !== undefined ? { socketId: d.socketId } : {}),
        locked: false,
        origin: 'auto',
      };
    });
    return this.commit([{ type: 'RoomFurnished', roomId, placements }]);
  }

  /**
   * Ergänzt automatische Platzierungen, ohne andere zu ersetzen (Licht-Pass nach der Einrichtung).
   * `parentKey` verweist auf einen Schlüssel dieses Aufrufs oder auf eine bestehende Platzierung des Raums.
   * Die Ergänzungen sind `auto` und ungesperrt: Neu-Würfeln/Einrichten ersetzt sie wie alles Automatische.
   */
  supplementFurnishing(roomId: RoomId, drafts: readonly PlacementDraft[]): ProjectEvent[] {
    const room = this.room(roomId);
    if (drafts.length === 0) return [];
    const keys = new Map<string, PlacementId>();
    let n = this.current.seq;
    for (const d of drafts) {
      if (keys.has(d.key)) throw new DomainError('furnish.key', `Doppelter Schlüssel ${d.key}`);
      keys.set(d.key, `p${n++}`);
    }
    const inRoom = new Set(this.current.placements.filter((p) => p.roomId === roomId).map((p) => p.id));
    const placements: Placement[] = drafts.map((d) => {
      if (!room.cells.has(d.pose.pos[0], d.pose.pos[2])) throw new DomainError('placement.outside', `Die Ankerzelle von ${d.key} liegt nicht im Raum`);
      let parentId: PlacementId | undefined;
      if (d.parentKey !== undefined) {
        parentId = keys.get(d.parentKey) ?? (inRoom.has(d.parentKey) ? d.parentKey : undefined);
        if (parentId === undefined) throw new DomainError('furnish.parent', `Eltern ${d.parentKey} von ${d.key} unbekannt`);
      }
      return {
        id: keys.get(d.key)!,
        roomId,
        componentId: d.componentId,
        ...(d.variantId !== undefined ? { variantId: d.variantId } : {}),
        pose: d.pose,
        seed: d.seed,
        ...(parentId !== undefined ? { parentId } : {}),
        ...(d.socketId !== undefined ? { socketId: d.socketId } : {}),
        locked: false,
        origin: 'auto',
      };
    });
    return this.commit([{ type: 'FurnishingSupplemented', roomId, placements }]);
  }

  /**
   * F „Bereich neu einrichten“ (WFC 3.2 „Modifying in Blocks“): ersetzt nur die Platzierungen `removed` (samt
   * aufgesetzter Teile) durch `drafts`; alles andere im Raum bleibt unverändert (eingefroren). Gesperrte und von Hand
   * gesetzte Möbel sind nie entfernbar („Gesperrt überlebt alles außer Löschen“). `parentKey` verweist auf einen
   * Schlüssel dieses Aufrufs oder auf eine bleibende Platzierung des Raums. Welche Möbel entfallen und wo die neuen
   * stehen, entscheidet der Anwendungsdienst (`refurnishBlock` in @mcda/pipeline) mit Katalog und Solver.
   */
  refurnishBlock(roomId: RoomId, block: CellSet, removed: readonly PlacementId[], drafts: readonly PlacementDraft[]): ProjectEvent[] {
    const room = this.room(roomId);
    if (block.isEmpty) throw new DomainError('block.empty', 'Der Bereich ist leer');
    for (const id of removed) {
      const p = this.placement(id);
      if (p.roomId !== roomId) throw new DomainError('block.room', `${id} gehört nicht zu Raum ${roomId}`);
      if (p.locked || p.origin !== 'auto') throw new DomainError('block.frozen', `${id} ist gesperrt oder von Hand gesetzt und bleibt`);
    }
    const gone = withDescendants(this.current.placements, new Set(removed));
    for (const p of this.current.placements) {
      if (gone.has(p.id) && (p.locked || p.origin !== 'auto')) throw new DomainError('block.frozen', `${p.id} ist gesperrt oder von Hand gesetzt und bleibt`);
    }
    const keys = new Map<string, PlacementId>();
    let n = this.current.seq;
    for (const d of drafts) {
      if (keys.has(d.key)) throw new DomainError('furnish.key', `Doppelter Schlüssel ${d.key}`);
      keys.set(d.key, `p${n++}`);
    }
    const stay = new Set(this.current.placements.filter((p) => p.roomId === roomId && !gone.has(p.id)).map((p) => p.id));
    const placements: Placement[] = drafts.map((d) => {
      if (!room.cells.has(d.pose.pos[0], d.pose.pos[2])) throw new DomainError('placement.outside', `Die Ankerzelle von ${d.key} liegt nicht im Raum`);
      let parentId: PlacementId | undefined;
      if (d.parentKey !== undefined) {
        parentId = keys.get(d.parentKey) ?? (stay.has(d.parentKey) ? d.parentKey : undefined);
        if (parentId === undefined) throw new DomainError('furnish.parent', `Eltern ${d.parentKey} von ${d.key} unbekannt`);
      }
      return {
        id: keys.get(d.key)!,
        roomId,
        componentId: d.componentId,
        ...(d.variantId !== undefined ? { variantId: d.variantId } : {}),
        pose: d.pose,
        seed: d.seed,
        ...(parentId !== undefined ? { parentId } : {}),
        ...(d.socketId !== undefined ? { socketId: d.socketId } : {}),
        locked: false,
        origin: 'auto',
      };
    });
    if (removed.length === 0 && placements.length === 0) return [];
    return this.commit([{ type: 'RoomBlockRefurnished', roomId, block: block.toArray(), removed: [...removed], placements }]);
  }

  addPlacement(roomId: RoomId, componentId: string, pose: Pose, options: { variantId?: string; seed?: number } = {}): ProjectEvent[] {
    const r = this.room(roomId);
    if (!r.cells.has(pose.pos[0], pose.pos[2])) throw new DomainError('placement.outside', 'Die Ankerzelle liegt nicht im Raum');
    const id = `p${this.current.seq}`;
    const placement: Placement = {
      id,
      roomId,
      componentId,
      ...(options.variantId !== undefined ? { variantId: options.variantId } : {}),
      pose,
      seed: options.seed ?? hashSeed(this.current.seed, id),
      locked: false,
      origin: 'manual',
    };
    return this.commit([{ type: 'PlacementAdded', placement }]);
  }

  movePlacement(id: PlacementId, pose: Pose): ProjectEvent[] {
    const p = this.placement(id);
    if (!this.room(p.roomId).cells.has(pose.pos[0], pose.pos[2])) throw new DomainError('placement.outside', 'Die Ankerzelle liegt nicht im Raum');
    return this.commit([{ type: 'PlacementMoved', placementId: id, pose }]);
  }

  /**
   * Möbel tauschen bzw. Variante wechseln (W2-ED U5): gleiche ID und Lage, andere Komponente oder Variante; die
   * Platzierung wird „von Hand gesetzt“ (übersteht Neu-Einrichten). Ob sie passt, prüft der Aufrufer mit dem Katalog
   * (die Domäne kennt keine Komponenten-Geometrie) – wie bei `addPlacement`.
   */
  swapPlacement(id: PlacementId, componentId: string, opts: { variantId?: string } = {}): ProjectEvent[] {
    const p = this.placement(id);
    if (componentId.length === 0) throw new DomainError('placement.component', 'Komponente fehlt');
    if (p.componentId === componentId && p.variantId === opts.variantId) return [];
    return this.commit([{ type: 'PlacementSwapped', placementId: id, componentId, ...(opts.variantId !== undefined ? { variantId: opts.variantId } : {}) }]);
  }

  removePlacement(id: PlacementId): ProjectEvent[] {
    this.placement(id);
    return this.commit([{ type: 'PlacementRemoved', placementId: id }]);
  }

  lockPlacement(id: PlacementId): ProjectEvent[] {
    return this.placement(id).locked ? [] : this.commit([{ type: 'PlacementLocked', placementId: id }]);
  }

  unlockPlacement(id: PlacementId): ProjectEvent[] {
    return this.placement(id).locked ? this.commit([{ type: 'PlacementUnlocked', placementId: id }]) : [];
  }

  setTheme(themeId: string): ProjectEvent[] {
    return themeId === this.current.themeId ? [] : this.commit([{ type: 'ThemeChanged', themeId }]);
  }

  /**
   * Farbpalette des Projekts wählen (Q4, research/54 §3.3); `undefined` wählt sie ab. Prüft nur die Abwesenheit
   * einer Änderung – ob es die Palette im Katalog gibt, prüft der Aufrufer (die Domäne kennt keine Kataloge).
   */
  setPalette(paletteId: string | undefined): ProjectEvent[] {
    if (paletteId === this.current.paletteId) return [];
    return this.commit([paletteId === undefined ? { type: 'PaletteChanged' } : { type: 'PaletteChanged', paletteId }]);
  }

  /**
   * Nutzungszustand des Projekts wählen (Q5/P15, research/55 §2); `undefined` wählt ihn ab und stellt das
   * bitgleiche Verhalten ohne Zustand wieder her. Wie `setPalette` prüft die Domäne nur die Abwesenheit einer
   * Änderung – die Ausprägung selbst ist ein reiner Domänen-Wert (`StoryState`).
   */
  setStoryState(storyState: StoryState | undefined): ProjectEvent[] {
    if (storyState === this.current.storyState) return [];
    return this.commit([storyState === undefined ? { type: 'StoryStateChanged' } : { type: 'StoryStateChanged', storyState }]);
  }

  /**
   * Innen-Deko-Stufe setzen (feat/int-decor) oder mit `undefined` abschalten (bitgleich zu vorher). Wirkt erst beim
   * nächsten Generieren/Einrichten (Deko-Pass in `@mcda/pipeline`); gleicher Wert erzeugt kein Event.
   */
  setInteriorDecor(level: InteriorDecor | undefined): ProjectEvent[] {
    if (level === this.current.interiorDecor) return [];
    return this.commit([level === undefined ? { type: 'InteriorDecorChanged' } : { type: 'InteriorDecorChanged', interiorDecor: level }]);
  }

  /**
   * Stimmung des Projekts setzen (feat/theme-moods); `{}` schaltet sie mit der Theme-Vorgabe ein, `undefined` schaltet
   * sie ab (bitgleich zu vorher). Werte werden auf −1 … 1 begrenzt (`mergeMood`), gleiche Werte erzeugen kein Event.
   */
  setMood(mood: MoodVector | undefined): ProjectEvent[] {
    const next = mood === undefined ? undefined : mergeMood(mood);
    const cur = this.current.mood;
    if (next === undefined ? cur === undefined : cur !== undefined && MOOD_AXES.every((a) => next[a] === cur[a])) return [];
    return this.commit([next === undefined ? { type: 'MoodChanged' } : { type: 'MoodChanged', mood: next }]);
  }

  /**
   * Paletten-Überschreibungen setzen (W13-G): Materialfamilie je Rollengruppe und Familien-Tausch. Gespeichert wird die
   * Normalform (`normalizePaletteOverrides`); leer bzw. `undefined` löscht sie (bitgleich zu vorher). Ob die Familien zur
   * Rolle und Zielversion passen, prüft der Aufrufer (die Domäne kennt keine Kataloge) – die Auflösung überspringt
   * unpassende Einträge ohnehin (Formvertrag).
   */
  setPaletteOverrides(overrides: PaletteOverrides | undefined): ProjectEvent[] {
    const next = normalizePaletteOverrides(overrides);
    if (samePaletteOverrides(next, this.current.paletteOverrides)) return [];
    return this.commit([next === undefined ? { type: 'PaletteOverridesChanged' } : { type: 'PaletteOverridesChanged', paletteOverrides: next }]);
  }

  setTargetVersion(v: TargetVersion): ProjectEvent[] {
    return v.dataVersion === this.current.targetVersion.dataVersion ? [] : this.commit([{ type: 'TargetVersionChanged', targetVersion: v }]);
  }

  // ------------------------------------------------------------------ Baukörper (research/19 §7.4)

  /**
   * Neuer Baukörper mit eigenem Dach, eigener Basishöhe und – optional – eigenen lichten Höhen. Die ID vergibt das
   * Aggregat (`v<n>`, deterministisch wie Räume und Treppen); sie steht in `VolumeAdded.volume.id`.
   */
  addVolume(props: VolumeProps = {}): ProjectEvent[] {
    const msg = checkVolume(props);
    if (msg !== undefined) throw new DomainError('volume.invalid', msg);
    return this.commit([{ type: 'VolumeAdded', volume: cleanVolume(`v${this.current.seq}`, props) }]);
  }

  /**
   * Ersetzt die Eigenschaften eines Baukörpers (auch des Standard-Baukörpers; nicht angegebene Felder entfallen).
   * Platzierungen folgen dem Boden, Treppen, die danach nicht mehr passen, entfallen (`StairsRemoved`).
   */
  changeVolume(id: VolumeId, props: VolumeProps): ProjectEvent[] {
    const current = this.volume(id);
    const msg = checkVolume(props);
    if (msg !== undefined) throw new DomainError('volume.invalid', msg);
    const volume = cleanVolume(id, props);
    return sameVolume(current, volume) ? [] : this.commit(this.withLinkRepair([{ type: 'VolumeChanged', volume }]));
  }

  /**
   * Entfernt einen Baukörper. Nur leer – oder mit `reassign`: seine Räume wandern vorher in den Standard-Baukörper
   * (`RoomVolumeAssigned`). Der Standard-Baukörper selbst bleibt immer.
   */
  removeVolume(id: VolumeId, opts: { reassign?: boolean } = {}): ProjectEvent[] {
    if (id === DEFAULT_VOLUME) throw new DomainError('volume.default', 'Der Standard-Baukörper kann nicht entfernt werden');
    this.volume(id);
    const rooms = this.current.rooms.filter((r) => volumeOf(r) === id);
    if (rooms.length > 0 && opts.reassign !== true) {
      throw new DomainError('volume.notEmpty', `Baukörper ${id} enthält noch Räume (${rooms.map((r) => r.id).join(', ')}) – erst umhängen`);
    }
    const events: ProjectEvent[] = rooms.map((r) => ({ type: 'RoomVolumeAssigned', roomId: r.id, volumeId: DEFAULT_VOLUME }));
    return this.commit(this.withLinkRepair([...this.withUserOrigin(events), { type: 'VolumeRemoved', volumeId: id }]));
  }

  /**
   * Ordnet Räume nachträglich einem Baukörper zu. Invariante: Baukörper teilen keine Spalten (ein Raumstapel wandert
   * deshalb meist gemeinsam). Platzierungen folgen dem neuen Boden; unpassende Treppen entfallen.
   */
  assignRoomVolume(roomIds: RoomId | readonly RoomId[], volumeId: VolumeId): ProjectEvent[] {
    this.volume(volumeId);
    const ids = typeof roomIds === 'string' ? [roomIds] : [...roomIds];
    const events: ProjectEvent[] = ids
      .map((id) => this.room(id))
      .filter((r) => volumeOf(r) !== volumeId)
      .map((r) => ({ type: 'RoomVolumeAssigned', roomId: r.id, volumeId }));
    if (events.length === 0) return [];
    this.requireNoClash(events, new Set(ids));
    return this.commit(this.withLinkRepair(this.withUserOrigin(events)));
  }

  // ------------------------------------------------------------------ Bautyp (research/19 §7.6)

  /**
   * Übernimmt einen Bautyp-Plan in EINEM Schritt (`BuildingTypeApplied`, ein Undo). Der Plan ist ein Startwert:
   *  1. Bautyp-Räume (`origin: 'type'`, seit der Generierung unverändert) samt ihren Treppen entfallen; Nutzer-Räume
   *     bleiben, ebenso Bautyp-Räume mit gesperrten oder von Hand gesetzten Möbeln (`buildingTypeScope`). Leere
   *     Baukörper (außer dem Standard) entfallen.
   *  2. Baukörper des Plans: Standard-Baukörper setzen, weitere anlegen.
   *  3. Etagen: Höhen anpassen, fehlende lückenlos anlegen.
   *  4. Räume malen (`origin: 'type'`) – ohne Zellen der Nutzer-Räume derselben Etage und ohne Spalten anderer
   *     Baukörper; zerfällt ein Raum dadurch, wird jedes Stück ein Raum. Überschneiden sich Plan-Räume, gilt der erste.
   *  5. Treppen setzen (unpassende überspringt das Aggregat), danach alle übrigen Treppen prüfen.
   */
  applyBuildingType(draft: BuildingTypeDraft): ProjectEvent[] {
    return this.commit([{ type: 'BuildingTypeApplied', origin: draft.origin, events: this.buildingTypeEvents(draft) }]);
  }

  /**
   * „Grundriss neu würfeln“: wie `applyBuildingType`, aber nur für den Bautyp, aus dem das Projekt stammt, und mit
   * `rerollCount` + 1 (den neuen Plan erzeugt der Aufrufer mit diesem Zähler). Nutzer-Räume bleiben.
   */
  rerollBuildingType(draft: BuildingTypeDraft): ProjectEvent[] {
    const o = this.current.origin;
    if (o === undefined) throw new DomainError('buildingType.none', 'Das Projekt stammt aus keinem Bautyp');
    if (draft.origin.buildingTypeId !== o.buildingTypeId) {
      throw new DomainError('buildingType.mismatch', `Neu würfeln nur für Bautyp ${o.buildingTypeId} (nicht ${draft.origin.buildingTypeId})`);
    }
    if (draft.origin.rerollCount !== o.rerollCount + 1) {
      throw new DomainError('buildingType.reroll', `Neu würfeln erwartet rerollCount ${o.rerollCount + 1} (nicht ${draft.origin.rerollCount})`);
    }
    return this.commit([{ type: 'BuildingTypeRerolled', origin: draft.origin, events: this.buildingTypeEvents(draft) }]);
  }

  /** Nachfahren einer Platzierung (für UI: „mit Kindern verschieben/löschen“). */
  descendants(id: PlacementId): PlacementId[] {
    return [...withDescendants(this.current.placements, new Set([id]))].filter((x) => x !== id);
  }

  // ------------------------------------------------------------------ intern

  private requireFloor(index: number): void {
    if (!this.current.floors.some((f) => f.index === index)) throw new DomainError('floor.unknown', `Unbekannte Etage ${index}`);
  }

  /** Invariante der Baukörper nach den Events (nur Überschneidungen mit den Räumen `of`). */
  private requireNoClash(events: readonly ProjectEvent[], of: ReadonlySet<RoomId>): void {
    let s = this.current;
    for (const e of events) s = applyEvent(s, e);
    const clash = volumeClash(s, of);
    if (clash !== undefined) throw new DomainError('volume.overlap', clash);
  }

  /**
   * Hängt `RoomOriginSet(user)` für Bautyp-Räume an, die die Events verändern (Zellen verloren, geteilt, Raumtyp oder
   * Baukörper gewechselt) und danach noch bestehen.
   */
  private withUserOrigin(events: ProjectEvent[]): ProjectEvent[] {
    if (!this.current.rooms.some((r) => r.origin === 'type')) return events;
    const touched: RoomId[] = [];
    for (const e of events) {
      if (e.type === 'RoomCellsLost' || e.type === 'RoomCellsGained' || e.type === 'RoomTypeAssigned' || e.type === 'RoomVolumeAssigned') touched.push(e.roomId);
      if (e.type === 'RoomSplit') touched.push(e.roomId, ...e.parts.map((p) => p.roomId));
    }
    let s = this.current;
    for (const e of events) s = applyEvent(s, e);
    for (const id of new Set(touched)) {
      if (s.rooms.find((r) => r.id === id)?.origin === 'type') events.push({ type: 'RoomOriginSet', roomId: id, origin: 'user' });
    }
    return events;
  }

  /** Events eines Bautyp-Plans (siehe `applyBuildingType`), gegen einen laufenden Zustand erzeugt. */
  private buildingTypeEvents(draft: BuildingTypeDraft): ProjectEvent[] {
    const out: ProjectEvent[] = [];
    let s = this.current;
    const emit = (e: ProjectEvent): void => {
      out.push(e);
      s = applyEvent(s, e);
    };
    const keys = new Set<string>([DEFAULT_VOLUME]);
    for (const v of draft.volumes ?? []) {
      if (v.key !== DEFAULT_VOLUME && keys.has(v.key)) throw new DomainError('buildingType.volume', `Doppelter Baukörper-Schlüssel ${v.key}`);
      keys.add(v.key);
      const msg = checkVolume(v);
      if (msg !== undefined) throw new DomainError('volume.invalid', `Baukörper ${v.key}: ${msg}`);
    }
    for (const [k, h] of Object.entries(draft.floors ?? {})) {
      if (!Number.isInteger(Number(k)) || !Number.isInteger(h) || h < FLOOR_HEIGHT.min || h > FLOOR_HEIGHT.max) {
        throw new DomainError('floor.height', `Etage ${k}: lichte Höhe ${h} nicht erlaubt (${FLOOR_HEIGHT.min}–${FLOOR_HEIGHT.max})`);
      }
    }
    for (const r of draft.rooms) {
      if (!keys.has(r.volume ?? DEFAULT_VOLUME)) throw new DomainError('buildingType.volume', `Unbekannter Baukörper-Schlüssel ${r.volume}`);
    }

    // 1. unveränderte Bautyp-Räume samt Treppen entfernen, leere Baukörper entfernen. Bautyp-Räume mit gesperrten oder
    //    von Hand gesetzten Möbeln bleiben stehen (W2-ED U1: vorher nahm `RoomRemoved` die Sperren mit); ohne Sperren
    //    ist der Ablauf unverändert (bitgleich).
    const old = new Set(buildingTypeScope(s).replaced);
    for (const l of s.links) {
      const res = checkLink(s, l);
      if (typeof res !== 'string' && (old.has(res.lower.id) || old.has(res.upper.id))) emit({ type: 'StairsRemoved', linkId: l.id });
    }
    for (const id of old) emit({ type: 'RoomRemoved', roomId: id });
    for (const v of s.volumes ?? []) {
      if (v.id !== DEFAULT_VOLUME && !s.rooms.some((r) => r.volumeId === v.id)) emit({ type: 'VolumeRemoved', volumeId: v.id });
    }

    // 2. Baukörper
    const ids = new Map<string, VolumeId>([[DEFAULT_VOLUME, DEFAULT_VOLUME]]);
    const base = cleanVolume(DEFAULT_VOLUME, (draft.volumes ?? []).find((v) => v.key === DEFAULT_VOLUME) ?? {});
    if (!sameVolume(volumeById(s, DEFAULT_VOLUME)!, base)) emit({ type: 'VolumeChanged', volume: base });
    for (const { key, ...props } of draft.volumes ?? []) {
      if (key === DEFAULT_VOLUME) continue;
      const volume = cleanVolume(`v${s.seq}`, props);
      ids.set(key, volume.id);
      emit({ type: 'VolumeAdded', volume });
    }

    // 3. Etagen: vorhandene anpassen, fehlende lückenlos anlegen
    const wanted = Object.entries(draft.floors ?? {}).map(([k, h]) => [Number(k), h] as const).sort((a, b) => a[0] - b[0]);
    for (const [index, height] of wanted) {
      const f = s.floors.find((x) => x.index === index);
      if (f !== undefined && f.height !== height) emit({ type: 'FloorHeightChanged', index, height });
    }
    const heightOf = (index: number, fallback: number): number => (draft.floors ?? {})[index] ?? fallback;
    const need = [...wanted.map(([i]) => i), ...draft.rooms.map((r) => r.floorIndex), ...(draft.stairs ?? []).flatMap((t) => [t.floorIndex, t.floorIndex + 1])];
    for (const target of need.length > 0 ? [Math.max(...need), Math.min(...need)] : []) {
      for (;;) {
        const top = s.floors[s.floors.length - 1]!;
        const bottom = s.floors[0]!;
        if (target > top.index) {
          const height = heightOf(top.index + 1, top.height);
          emit({ type: 'FloorAdded', floor: { index: top.index + 1, y0: top.y0 + top.height + 1, height } });
        } else if (target < bottom.index) {
          const height = heightOf(bottom.index - 1, bottom.height);
          emit({ type: 'FloorAdded', floor: { index: bottom.index - 1, y0: bottom.y0 - height - 1, height } });
        } else break;
      }
    }

    // 4. Räume (Bautyp-Herkunft); Nutzer-Räume derselben Etage und Spalten anderer Baukörper bleiben frei
    for (const r of draft.rooms) {
      const volumeId = ids.get(r.volume ?? DEFAULT_VOLUME)!;
      const taken = new Set<string>();
      for (const o of s.rooms) {
        if (o.floorIndex !== r.floorIndex && volumeOf(o) === volumeId) continue;
        for (const [x, z] of o.cells) taken.add(cellKey(x, z));
      }
      const cells = (r.cells instanceof CellSet ? [...r.cells] : r.cells).filter(([x, z]) => !taken.has(cellKey(x, z)));
      for (const part of CellSet.of(cells).components()) {
        emit({
          type: 'RoomPainted', roomId: `r${s.seq}`, floorIndex: r.floorIndex, cells: part.toArray(), roomTypeId: r.roomTypeId,
          ...(volumeId !== DEFAULT_VOLUME ? { volumeId } : {}), origin: 'type',
        });
      }
    }

    // 5. Treppen des Plans, dann alle übrigen prüfen
    for (const t of draft.stairs ?? []) {
      const type = t.type ?? 'straight';
      const link: VerticalLink = {
        id: `s${s.seq}`, type, floorIndex: t.floorIndex, origin: [t.origin[0], t.origin[1]], facing: t.facing,
        ...(type === 'l' || type === 'u' || type === 'spiral' ? { turn: t.turn ?? 'right' } : {}),
      };
      if (typeof checkLink(s, link) !== 'string') emit({ type: 'StairsPlaced', link });
    }
    for (const l of s.links) if (typeof checkLink(s, l) === 'string') emit({ type: 'StairsRemoved', linkId: l.id });
    return out;
  }

  /** Entzieht bestehenden Räumen Zellen und hält die Invarianten (zusammenhängend, nicht leer). */
  private takeCells(floorIndex: number, cells: CellSet): ProjectEvent[] {
    const events: ProjectEvent[] = [];
    for (const r of this.current.rooms) {
      if (r.floorIndex !== floorIndex || !r.cells.intersects(cells)) continue;
      const remaining = r.cells.difference(cells);
      if (remaining.isEmpty) {
        events.push({ type: 'RoomRemoved', roomId: r.id });
        continue;
      }
      events.push({ type: 'RoomCellsLost', roomId: r.id, cells: r.cells.intersection(cells).toArray() });
      const comps = remaining.components();
      if (comps.length > 1) {
        // Der größte Teil behält die ID, die übrigen werden eigene Räume mit fortlaufenden IDs.
        let seq = this.seqAfter(events);
        const parts = comps.slice(1).map((c) => ({ roomId: `r${seq++}`, cells: c.toArray() }));
        events.push({ type: 'RoomSplit', roomId: r.id, parts });
      }
    }
    return events;
  }

  /** Hängt `StairsRemoved` für Treppen an, die nach den Events nicht mehr gültig liegen (Invariante der Treppen). */
  private withLinkRepair(events: ProjectEvent[]): ProjectEvent[] {
    if (this.current.links.length === 0 || events.length === 0) return events;
    let s = this.current;
    for (const e of events) s = applyEvent(s, e);
    for (const l of s.links) if (typeof checkLink(s, l) === 'string') events.push({ type: 'StairsRemoved', linkId: l.id });
    return events;
  }

  /** Nächste freie ID unter Berücksichtigung der noch nicht angewendeten Events. */
  private nextId(prefix: 'r' | 'p', pending: readonly ProjectEvent[]): string {
    return `${prefix}${this.seqAfter(pending)}`;
  }

  private seqAfter(pending: readonly ProjectEvent[]): number {
    let s = this.current;
    for (const e of pending) s = applyEvent(s, e);
    return s.seq;
  }

  private commit(events: ProjectEvent[]): ProjectEvent[] {
    for (const e of events) {
      this.current = applyEvent(this.current, e);
      this.log.push(e);
    }
    return events;
  }
}
