import { CellSet } from '@mcda/core';
import type { ProjectEvent } from './events.js';
import { DEFAULT_VOLUME, type Placement, type PlacementId, type ProjectState, type Room, type RoomId, type VolumeId } from './model.js';
import { roomFloors } from './volumes.js';

/** Numerischer Teil einer ID („r12“ → 12) für den deterministischen Zähler. */
function idNum(id: string): number {
  const n = Number(id.slice(1));
  return Number.isFinite(n) ? n : 0;
}

function bump(seq: number, ...ids: string[]): number {
  return Math.max(seq, ...ids.map((id) => idNum(id) + 1));
}

function mapRoom(state: ProjectState, id: RoomId, f: (r: Room) => Room): readonly Room[] {
  return state.rooms.map((r) => (r.id === id ? f(r) : r));
}

function mapPlacement(state: ProjectState, id: PlacementId, f: (p: Placement) => Placement): readonly Placement[] {
  return state.placements.map((p) => (p.id === id ? f(p) : p));
}

/** Alle Nachfahren (Kinder, Enkel …) einer Menge von Platzierungen, inklusive der Wurzeln. */
export function withDescendants(placements: readonly Placement[], roots: ReadonlySet<PlacementId>): Set<PlacementId> {
  const out = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of placements) {
      if (p.parentId !== undefined && out.has(p.parentId) && !out.has(p.id)) {
        out.add(p.id);
        grew = true;
      }
    }
  }
  return out;
}

function removePlacements(placements: readonly Placement[], roots: ReadonlySet<PlacementId>): readonly Placement[] {
  const gone = withDescendants(placements, roots);
  return placements.filter((p) => !gone.has(p.id));
}

const anchorIn = (p: Placement, cells: CellSet): boolean => cells.has(p.pose.pos[0], p.pose.pos[2]);

/** Raum im Baukörper `volumeId` (Standard-Baukörper ohne Feld, damit Projekte ohne Baukörper bitgleich bleiben). */
function inVolume(r: Room, volumeId: VolumeId): Room {
  const { volumeId: _old, ...rest } = r;
  return volumeId === DEFAULT_VOLUME ? rest : { ...rest, volumeId };
}

/**
 * Platzierungen folgen ihrem Raum, wenn sich dessen Boden verschiebt (Etagenhöhe, Baukörper). Ändert sich die lichte
 * Höhe eines Raums, entfallen seine automatischen, ungesperrten Platzierungen (Decke/Kopffreiheit ändern sich) samt
 * Kindern; gesperrte und manuelle bleiben und rutschen mit. `after` = Zustand mit den neuen Etagen bzw. Baukörpern.
 */
function reframe(before: ProjectState, after: ProjectState): ProjectState {
  const was = roomFloors(before);
  const now = roomFloors(after);
  const shift = new Map<RoomId, number>();
  const regrown = new Set<RoomId>();
  for (const [id, f] of now) {
    const o = was.get(id);
    if (o === undefined) continue;
    if (o.y0 !== f.y0) shift.set(id, f.y0 - o.y0);
    if (o.height !== f.height) regrown.add(id);
  }
  if (shift.size === 0 && regrown.size === 0) return after;
  const stale = new Set(after.placements.filter((p) => regrown.has(p.roomId) && p.origin === 'auto' && !p.locked).map((p) => p.id));
  return {
    ...after,
    placements: removePlacements(after.placements, stale).map((p) => {
      const dy = shift.get(p.roomId);
      return dy === undefined ? p : { ...p, pose: { ...p.pose, pos: [p.pose.pos[0], p.pose.pos[1] + dy, p.pose.pos[2]] as const } };
    }),
  };
}

/**
 * Reiner Reducer: wendet ein Event auf den Zustand an.
 * Keine Validierung hier – die macht das Aggregat, BEVOR es Events erzeugt.
 * So bleibt Replay (Undo, Laden) immer möglich.
 */
export function applyEvent(state: ProjectState | undefined, e: ProjectEvent): ProjectState {
  if (e.type === 'ProjectCreated') {
    return {
      id: e.id,
      name: e.name,
      seed: e.seed,
      themeId: e.themeId,
      targetVersion: e.targetVersion,
      wallMode: 'outer',
      floors: [e.floor],
      rooms: [],
      placements: [],
      links: [],
      seq: 1,
    };
  }
  if (state === undefined) throw new Error(`Event ${e.type} vor ProjectCreated`);

  switch (e.type) {
    case 'RoomPainted': {
      const room: Room = { id: e.roomId, floorIndex: e.floorIndex, cells: CellSet.of(e.cells), roomTypeId: e.roomTypeId, rerollCount: 0 };
      return {
        ...state,
        rooms: [...state.rooms, { ...inVolume(room, e.volumeId ?? DEFAULT_VOLUME), ...(e.origin !== undefined ? { origin: e.origin } : {}) }],
        seq: bump(state.seq, e.roomId),
      };
    }

    case 'RoomCellsLost': {
      const lost = CellSet.of(e.cells);
      const orphaned = new Set(state.placements.filter((p) => p.roomId === e.roomId && anchorIn(p, lost)).map((p) => p.id));
      return {
        ...state,
        rooms: mapRoom(state, e.roomId, (r) => ({ ...r, cells: r.cells.difference(lost) })),
        placements: removePlacements(state.placements, orphaned),
      };
    }

    case 'RoomCellsGained': {
      const gained = CellSet.of(e.cells);
      return { ...state, rooms: mapRoom(state, e.roomId, (r) => ({ ...r, cells: r.cells.union(gained) })) };
    }

    case 'RoomFixed':
      return {
        ...state,
        rooms: mapRoom(state, e.roomId, (r) => {
          const { fixed: _old, ...rest } = r;
          return e.fixed ? { ...rest, fixed: true } : rest;
        }),
      };

    case 'RoomSplit': {
      const source = state.rooms.find((r) => r.id === e.roomId);
      if (source === undefined) return state;
      let remaining = source.cells;
      const newRooms: Room[] = [];
      let placements = state.placements;
      for (const part of e.parts) {
        const cells = CellSet.of(part.cells);
        remaining = remaining.difference(cells);
        newRooms.push({ ...source, id: part.roomId, cells, rerollCount: 0 });
        // Platzierungen wandern mit ihrer Ankerzelle; Kinder folgen ihren Eltern.
        const moved = new Set(placements.filter((p) => p.roomId === e.roomId && anchorIn(p, cells)).map((p) => p.id));
        const all = withDescendants(placements, moved);
        placements = placements.map((p) => (all.has(p.id) ? { ...p, roomId: part.roomId } : p));
      }
      return {
        ...state,
        rooms: [...mapRoom(state, e.roomId, (r) => ({ ...r, cells: remaining })), ...newRooms],
        placements,
        seq: bump(state.seq, ...e.parts.map((p) => p.roomId)),
      };
    }

    case 'RoomRemoved':
      return {
        ...state,
        rooms: state.rooms.filter((r) => r.id !== e.roomId),
        placements: state.placements.filter((p) => p.roomId !== e.roomId),
      };

    case 'RoomTypeAssigned': {
      // Automatische, ungesperrte Platzierungen gehörten zum alten Programm → weg. Gesperrte bleiben.
      const stale = new Set(state.placements.filter((p) => p.roomId === e.roomId && p.origin === 'auto' && !p.locked).map((p) => p.id));
      return {
        ...state,
        rooms: mapRoom(state, e.roomId, (r) => ({ ...r, roomTypeId: e.roomTypeId })),
        placements: removePlacements(state.placements, stale),
      };
    }

    case 'RoomRerolled':
      return { ...state, rooms: mapRoom(state, e.roomId, (r) => ({ ...r, rerollCount: e.rerollCount })) };

    case 'RoomFurnished': {
      const stale = new Set(state.placements.filter((p) => p.roomId === e.roomId && p.origin === 'auto' && !p.locked).map((p) => p.id));
      return {
        ...state,
        placements: [...removePlacements(state.placements, stale), ...e.placements],
        seq: bump(state.seq, ...e.placements.map((p) => p.id)),
      };
    }

    case 'RoomBlockRefurnished':
      return {
        ...state,
        placements: [...removePlacements(state.placements, new Set(e.removed)), ...e.placements],
        seq: bump(state.seq, ...e.placements.map((p) => p.id)),
      };

    case 'FurnishingSupplemented':
      return { ...state, placements: [...state.placements, ...e.placements], seq: bump(state.seq, ...e.placements.map((p) => p.id)) };

    case 'PlacementAdded':
      return { ...state, placements: [...state.placements, e.placement], seq: bump(state.seq, e.placement.id) };

    case 'PlacementMoved':
      return { ...state, placements: mapPlacement(state, e.placementId, (p) => ({ ...p, pose: e.pose })) };

    case 'PlacementRemoved':
      return { ...state, placements: removePlacements(state.placements, new Set([e.placementId])) };

    case 'PlacementSwapped': {
      const p = state.placements.find((x) => x.id === e.placementId);
      if (p === undefined) return state;
      const kids = p.componentId === e.componentId ? new Set<PlacementId>() : withDescendants(state.placements, new Set([p.id]));
      kids.delete(p.id);
      return {
        ...state,
        placements: removePlacements(state.placements, kids).map((x) => {
          if (x.id !== p.id) return x;
          const { variantId: _v, ...rest } = x;
          return { ...rest, componentId: e.componentId, ...(e.variantId !== undefined ? { variantId: e.variantId } : {}), origin: 'manual' as const };
        }),
      };
    }

    case 'PlacementLocked':
      return { ...state, placements: mapPlacement(state, e.placementId, (p) => ({ ...p, locked: true })) };

    case 'PlacementUnlocked':
      return { ...state, placements: mapPlacement(state, e.placementId, (p) => ({ ...p, locked: false })) };

    case 'ThemeChanged':
      return { ...state, themeId: e.themeId };

    case 'PaletteChanged': {
      // Farbwelt abwählen heißt „Feld weg" – so bleiben Zustände ohne Palette feldgleich zu vorher.
      const { paletteId: _alt, ...rest } = state;
      return e.paletteId === undefined ? rest : { ...state, paletteId: e.paletteId };
    }

    case 'StoryStateChanged': {
      // Zustand abwählen heißt „Feld weg" – Zustände ohne Zustand bleiben feldgleich zu vorher (bitgleich).
      const { storyState: _alt, ...rest } = state;
      return e.storyState === undefined ? rest : { ...state, storyState: e.storyState };
    }

    case 'MoodChanged': {
      // Stimmung abschalten heißt „Feld weg" – Zustände ohne Stimmung bleiben feldgleich zu vorher (bitgleich).
      const { mood: _alt, ...rest } = state;
      return e.mood === undefined ? rest : { ...state, mood: e.mood };
    }

    case 'InteriorDecorChanged': {
      // abschalten heißt „Feld weg" – Zustände ohne Innen-Deko bleiben feldgleich zu vorher (bitgleich)
      const { interiorDecor: _alt, ...rest } = state;
      return e.interiorDecor === undefined ? rest : { ...state, interiorDecor: e.interiorDecor };
    }

    case 'PaletteOverridesChanged': {
      // Überschreibungen löschen heißt „Feld weg" – Zustände ohne Überschreibung bleiben feldgleich (bitgleich).
      const { paletteOverrides: _alt, ...rest } = state;
      return e.paletteOverrides === undefined ? rest : { ...state, paletteOverrides: e.paletteOverrides };
    }

    case 'TargetVersionChanged':
      return { ...state, targetVersion: e.targetVersion };

    case 'ProjectRenamed':
      return { ...state, name: e.name };

    case 'FloorAdded':
      return { ...state, floors: [...state.floors.filter((f) => f.index !== e.floor.index), e.floor].sort((a, b) => a.index - b.index) };

    case 'FloorRemoved': {
      // Räume und Treppen der Etage entfernt das Aggregat vorher per Event; hier nur zur Sicherheit (Replay fremder Historien).
      const gone = new Set(state.rooms.filter((r) => r.floorIndex === e.index).map((r) => r.id));
      return {
        ...state,
        floors: state.floors.filter((f) => f.index !== e.index),
        rooms: state.rooms.filter((r) => !gone.has(r.id)),
        placements: state.placements.filter((p) => !gone.has(p.roomId)),
        links: state.links.filter((l) => l.floorIndex !== e.index && l.floorIndex + 1 !== e.index),
      };
    }

    case 'FloorHeightChanged': {
      const changed = state.floors.find((f) => f.index === e.index);
      if (changed === undefined) return state;
      const delta = e.height - changed.height;
      // Ab dem Erdgeschoss wächst die Etage nach oben (Boden bleibt), Keller wachsen nach unten (Decke bleibt).
      // Platzierungen folgen ihrem Raum (`reframe`); Baukörper mit eigener Höhe dieser Etage bleiben unberührt.
      const up = e.index >= 0;
      const moves = (idx: number): boolean => (up ? idx > e.index : idx < e.index);
      const shift = up ? delta : -delta;
      return reframe(state, {
        ...state,
        floors: state.floors.map((f) => {
          if (f.index === e.index) return { ...f, height: e.height, y0: up ? f.y0 : f.y0 - delta };
          return moves(f.index) ? { ...f, y0: f.y0 + shift } : f;
        }),
      });
    }

    case 'StairsPlaced':
      return { ...state, links: [...state.links, e.link], seq: bump(state.seq, e.link.id) };

    case 'StairsRemoved':
      return { ...state, links: state.links.filter((l) => l.id !== e.linkId) };

    case 'VolumeAdded':
      return { ...state, volumes: [...(state.volumes ?? []).filter((v) => v.id !== e.volume.id), e.volume], seq: bump(state.seq, e.volume.id) };

    case 'VolumeChanged': {
      const list = state.volumes ?? [];
      const volumes = list.some((v) => v.id === e.volume.id) ? list.map((v) => (v.id === e.volume.id ? e.volume : v)) : [...list, e.volume];
      return reframe(state, { ...state, volumes });
    }

    case 'VolumeRemoved':
      // Räume hängt das Aggregat vorher um; hier nur zur Sicherheit (Replay fremder Historien).
      return reframe(state, {
        ...state,
        volumes: (state.volumes ?? []).filter((v) => v.id !== e.volumeId),
        rooms: state.rooms.map((r) => (r.volumeId === e.volumeId ? inVolume(r, DEFAULT_VOLUME) : r)),
      });

    case 'RoomVolumeAssigned':
      return reframe(state, { ...state, rooms: mapRoom(state, e.roomId, (r) => inVolume(r, e.volumeId)) });

    case 'RoomOriginSet':
      return { ...state, rooms: mapRoom(state, e.roomId, (r) => ({ ...r, origin: e.origin })) };

    case 'BuildingTypeApplied':
    case 'BuildingTypeRerolled': {
      let s = state;
      for (const x of e.events) s = applyEvent(s, x);
      return { ...s, origin: e.origin };
    }
  }
}
