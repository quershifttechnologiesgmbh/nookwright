/**
 * Baukörper und Bautyp-Herkunft im Aggregat (V0, research/19 §7.4, §7.6): Befehle, Invarianten, Replay und Undo.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, pose } from '@mcda/core';
import {
  DEFAULT_VOLUME, DomainError, Project, TARGET_VERSIONS, buildingTypeScope, checkLink, volumeClash, volumeFloors,
  type BuildingTypeDraft, type ProjectEvent, type ProjectState,
} from '../src/index.js';

const newProject = (): Project =>
  Project.create({ id: 'p', name: 'Zeile', seed: 5, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 64, height: 3 } });

const addedVolume = (events: readonly ProjectEvent[]): string => {
  const e = events.find((x) => x.type === 'VolumeAdded');
  if (e?.type !== 'VolumeAdded') throw new Error('kein VolumeAdded');
  return e.volume.id;
};

const painted = (events: readonly ProjectEvent[]): string => {
  const e = events.find((x) => x.type === 'RoomPainted');
  if (e?.type !== 'RoomPainted') throw new Error('kein RoomPainted');
  return e.roomId;
};

/** Replay aus der Historie ergibt denselben Zustand (Undo = Historie kürzen). */
function assertReplay(p: Project): void {
  expect(JSON.stringify(Project.fromHistory(p.history).state)).toBe(JSON.stringify(p.state));
}

/** Invarianten: Baukörper disjunkt, Treppen gültig, Räume in bekannten Baukörpern. */
function assertInvariants(s: ProjectState): void {
  expect(volumeClash(s)).toBeUndefined();
  for (const l of s.links) expect(typeof checkLink(s, l), `Treppe ${l.id}`).not.toBe('string');
  const ids = new Set([DEFAULT_VOLUME, ...(s.volumes ?? []).map((v) => v.id)]);
  for (const r of s.rooms) expect(ids.has(r.volumeId ?? DEFAULT_VOLUME), `Raum ${r.id}`).toBe(true);
  expect(new Set((s.volumes ?? []).map((v) => v.id)).size).toBe((s.volumes ?? []).length);
}

describe('Baukörper – Befehle', () => {
  it('anlegen: ID vom Aggregat, eindeutig; leere Felder entfallen; ungültige Eigenschaften abgelehnt', () => {
    const p = newProject();
    const a = addedVolume(p.addVolume({ name: 'Haus 2', baseOffset: 0, floorHeights: {} }));
    const b = addedVolume(p.addVolume({ roof: 'gable' }));
    expect(a).not.toBe(b);
    expect(a).not.toBe(DEFAULT_VOLUME);
    expect(p.volume(a)).toEqual({ id: a, name: 'Haus 2' });
    expect(p.volume(DEFAULT_VOLUME)).toEqual({ id: DEFAULT_VOLUME });
    expect(() => p.addVolume({ baseOffset: 1.5 })).toThrow(DomainError);
    expect(() => p.addVolume({ floorHeights: { 0: 1 } })).toThrow(/lichte Höhe/i);
    expect(() => p.volume('v99')).toThrow(/Unbekannter Baukörper/);
    assertInvariants(p.state);
  });

  it('Raum beim Malen oder nachträglich zuordnen; Standard-Baukörper ohne Feld', () => {
    const p = newProject();
    const v = addedVolume(p.addVolume());
    const a = painted(p.paintRoom(0, CellSet.rect(0, 0, 6, 8), 'kitchen'));
    const b = painted(p.paintRoom(0, CellSet.rect(7, 0, 13, 8), 'bedroom', { volumeId: v }));
    expect(p.room(a).volumeId).toBeUndefined();
    expect(p.room(b).volumeId).toBe(v);
    expect(() => p.paintRoom(0, CellSet.rect(20, 0, 22, 2), 'storage', { volumeId: 'v77' })).toThrow(/Unbekannter Baukörper/);
    expect(p.assignRoomVolume(a, v)).toEqual([{ type: 'RoomVolumeAssigned', roomId: a, volumeId: v }]);
    expect(p.assignRoomVolume(a, v)).toEqual([]);
    p.assignRoomVolume([a], DEFAULT_VOLUME);
    expect(Object.hasOwn(p.room(a), 'volumeId')).toBe(false);
    assertInvariants(p.state);
    assertReplay(p);
  });

  it('Invariante: Baukörper teilen keine Spalten – auch nicht über Etagen hinweg', () => {
    const p = newProject();
    const v = addedVolume(p.addVolume());
    const a = painted(p.paintRoom(0, CellSet.rect(0, 0, 6, 8), 'kitchen'));
    p.addFloor();
    const b = painted(p.paintRoom(1, CellSet.rect(0, 0, 6, 8), 'bedroom'));
    const before = p.history.length;
    // Obergeschoss eines anderen Baukörpers über dem Erdgeschoss von v0: abgelehnt
    expect(() => p.paintRoom(1, CellSet.rect(5, 0, 10, 8), 'library', { volumeId: v })).toThrow(/Räume verschiedener Baukörper dürfen sich nicht überdecken/);
    // nur das Erdgeschoss umhängen würde den Stapel teilen: abgelehnt; der ganze Stapel geht
    expect(() => p.assignRoomVolume(a, v)).toThrow(DomainError);
    expect(p.history).toHaveLength(before);
    p.assignRoomVolume([a, b], v);
    expect(p.state.rooms.every((r) => r.volumeId === v)).toBe(true);
    // Auf DERSELBEN Etage nimmt ein Raum wie bisher Zellen – ein fremder Baukörper aber nur, wo keine andere Etage
    // desselben Stapels steht
    expect(() => p.paintRoom(0, CellSet.rect(6, 0, 12, 8), 'storage')).toThrow(/Räume verschiedener Baukörper dürfen sich nicht überdecken/);
    const c = painted(p.paintRoom(0, CellSet.rect(6, 0, 12, 8), 'storage', { volumeId: v }));
    expect(p.room(a).cells.has(6, 0)).toBe(false);
    p.paintRoom(0, CellSet.rect(10, 0, 16, 8), 'smithy');
    expect(p.room(c).cells.has(10, 0)).toBe(false);
    assertInvariants(p.state);
  });

  it('ändern: Platzierungen folgen der Basishöhe, abweichende lichte Höhe ersetzt automatische Möbel', () => {
    const p = newProject();
    const v = addedVolume(p.addVolume());
    const a = painted(p.paintRoom(0, CellSet.rect(0, 0, 8, 8), 'kitchen', { volumeId: v }));
    p.addFloor();
    const b = painted(p.paintRoom(1, CellSet.rect(0, 0, 8, 8), 'bedroom', { volumeId: v }));
    p.applyFurnishing(a, [{ key: 'a', componentId: 'table/oak', pose: pose([3, 65, 3]), seed: 1 }]);
    p.addPlacement(a, 'seat/chair', pose([4, 65, 3]));
    p.applyFurnishing(b, [{ key: 'b', componentId: 'bed/red', pose: pose([3, 69, 3]), seed: 2 }]);
    expect(p.changeVolume(v, {})).toEqual([]);
    p.changeVolume(v, { baseOffset: -3 });
    expect(volumeFloors(p.state, v).map((f) => f.y0)).toEqual([61, 65]);
    expect(p.roomFloor(a)).toEqual({ index: 0, y0: 61, height: 3 });
    expect(p.state.placements.map((x) => x.pose.pos[1])).toEqual([62, 62, 66]);
    // Erdgeschoss 5 hoch: das Obergeschoss rutscht nach oben, automatische Möbel im Erdgeschoss entfallen
    p.changeVolume(v, { baseOffset: -3, floorHeights: { 0: 5 } });
    expect(volumeFloors(p.state, v)).toEqual([{ index: 0, y0: 61, height: 5 }, { index: 1, y0: 67, height: 3 }]);
    expect(p.state.placements.map((x) => [x.componentId, x.pose.pos[1]])).toEqual([['seat/chair', 62], ['bed/red', 68]]);
    // Die Projekt-Etage bleibt, der Standard-Baukörper auch
    expect(p.state.floors.map((f) => f.y0)).toEqual([64, 68]);
    assertReplay(p);
    // Undo: Historie kürzen ergibt den Stand davor
    expect(p.undo(1).state.placements.map((x) => x.pose.pos[1])).toEqual([62, 62, 66]);
  });

  it('Treppen: Etagenabstand des Baukörpers; nie zwischen zwei Baukörpern; unpassende entfallen beim Ändern', () => {
    const p = newProject();
    const v = addedVolume(p.addVolume({ floorHeights: { 0: 5 } }));
    p.paintRoom(0, CellSet.rect(0, 0, 12, 10), 'storage', { volumeId: v });
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 12, 10), 'bedroom', { volumeId: v });
    const [placed] = p.placeStairs(0, [3, 5], 'east');
    expect(placed).toMatchObject({ type: 'StairsPlaced' });
    const res = checkLink(p.state, p.state.links[0]!);
    if (typeof res === 'string') throw new Error(res);
    expect(res.layout.blocks.filter((b) => b.part === 'tread')).toHaveLength(6); // Abstand 5 + 1
    // Wendeltreppe schafft höchstens 7 Stufen: lichte Höhe 7 → Abstand 8 → die Treppe entfällt
    p.removeStairs('s' + String(p.state.seq - 1));
    p.placeStairs(0, [4, 5], 'north', 'spiral');
    const ev = p.changeVolume(v, { floorHeights: { 0: 7 } });
    expect(ev.map((e) => e.type)).toEqual(['VolumeChanged', 'StairsRemoved']);
    // Raum oben in einem anderen Baukörper: keine Treppe
    const w = addedVolume(p.addVolume());
    p.paintRoom(0, CellSet.rect(20, 0, 30, 10), 'storage');
    p.paintRoom(1, CellSet.rect(20, 0, 30, 10), 'bedroom');
    p.assignRoomVolume([p.state.rooms[2]!.id, p.state.rooms[3]!.id], w);
    expect(() => p.placeStairs(0, [26, 5], 'west')).not.toThrow();
    // Austritt im Obergeschoss eines anderen Baukörpers (daneben, ohne Erdgeschoss darunter): abgelehnt
    p.paintRoom(1, CellSet.rect(31, 0, 40, 10), 'library');
    expect(() => p.placeStairs(0, [27, 8], 'east')).toThrow(/zwei Baukörper/);
    assertInvariants(p.state);
    assertReplay(p);
  });

  it('löschen: nur leer oder mit Umhängen in den Standard-Baukörper; der Standard bleibt', () => {
    const p = newProject();
    const v = addedVolume(p.addVolume({ baseOffset: 2 }));
    const a = painted(p.paintRoom(0, CellSet.rect(0, 0, 6, 6), 'kitchen', { volumeId: v }));
    p.addPlacement(a, 'seat/chair', pose([3, 67, 3]));
    expect(() => p.removeVolume(v)).toThrow(/enthält noch Räume/);
    expect(() => p.removeVolume(DEFAULT_VOLUME)).toThrow(DomainError);
    const ev = p.removeVolume(v, { reassign: true });
    expect(ev.map((e) => e.type)).toEqual(['RoomVolumeAssigned', 'VolumeRemoved']);
    expect(p.state.volumes).toEqual([]);
    expect(p.room(a).volumeId).toBeUndefined();
    expect(p.state.placements[0]!.pose.pos[1]).toBe(65); // folgt dem Boden des Standard-Baukörpers
    const e = addedVolume(p.addVolume());
    expect(p.removeVolume(e)).toEqual([{ type: 'VolumeRemoved', volumeId: e }]);
    assertReplay(p);
  });

  it('Standard-Baukörper lässt sich ändern (eigenes Dach, Basishöhe)', () => {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 6, 6), 'kitchen');
    p.changeVolume(DEFAULT_VOLUME, { roof: 'gable', baseOffset: 1 });
    expect(p.volume(DEFAULT_VOLUME)).toEqual({ id: DEFAULT_VOLUME, baseOffset: 1, roof: 'gable' });
    expect(p.roomFloor('r1').y0).toBe(65);
    p.changeVolume(DEFAULT_VOLUME, {});
    expect(p.roomFloor('r1').y0).toBe(64);
    assertReplay(p);
  });
});

describe('Bautyp – Herkunft, ein Undo-Schritt, Neu-Würfeln', () => {
  const draft = (rerollCount: number, width = 7): BuildingTypeDraft => ({
    origin: { buildingTypeId: 'townhouse_row', params: { houses: 2 }, seed: 99, rerollCount },
    floors: { 0: 4, 1: 3 },
    volumes: [{ key: DEFAULT_VOLUME, roof: 'gable' }, { key: 'house2', roof: 'gable', baseOffset: -1 }],
    rooms: [
      { floorIndex: 0, cells: CellSet.rect(0, 0, width - 1, 10), roomTypeId: 'kitchen' },
      { floorIndex: 1, cells: CellSet.rect(0, 0, width - 1, 10), roomTypeId: 'bedroom' },
      { floorIndex: 0, cells: CellSet.rect(width, 0, width + 6, 10).toArray(), roomTypeId: 'smithy', volume: 'house2' },
      { floorIndex: 1, cells: CellSet.rect(width, 0, width + 6, 10), roomTypeId: 'bedroom', volume: 'house2' },
    ],
    stairs: [{ floorIndex: 0, origin: [3, 2], facing: 'south' }, { floorIndex: 0, origin: [width + 3, 2], facing: 'south' }],
  });

  it('anwenden: EIN Event mit allen Raum-, Etagen-, Baukörper- und Treppen-Events; Undo nimmt alles zurück', () => {
    const p = newProject();
    const ev = p.applyBuildingType(draft(0));
    expect(ev).toHaveLength(1);
    const e = ev[0]!;
    if (e.type !== 'BuildingTypeApplied') throw new Error(e.type);
    expect(e.events.map((x) => x.type)).toEqual([
      'VolumeChanged', 'VolumeAdded', 'FloorHeightChanged', 'FloorAdded', 'RoomPainted', 'RoomPainted', 'RoomPainted', 'RoomPainted', 'StairsPlaced', 'StairsPlaced',
    ]);
    expect(p.state.origin).toEqual({ buildingTypeId: 'townhouse_row', params: { houses: 2 }, seed: 99, rerollCount: 0 });
    expect(p.state.rooms.every((r) => r.origin === 'type')).toBe(true);
    expect(p.state.rooms.map((r) => r.volumeId ?? DEFAULT_VOLUME)).toEqual([DEFAULT_VOLUME, DEFAULT_VOLUME, 'v1', 'v1']);
    expect(p.state.floors).toEqual([{ index: 0, y0: 64, height: 4 }, { index: 1, y0: 69, height: 3 }]);
    expect(p.state.links).toHaveLength(2);
    assertInvariants(p.state);
    assertReplay(p);
    const undone = p.undo(1);
    expect(undone.state.rooms).toEqual([]);
    expect(undone.state.origin).toBeUndefined();
    expect(undone.history).toHaveLength(1);
  });

  it('Nutzer-Änderung an einem Bautyp-Raum setzt `user`; Neu-Würfeln ersetzt nur unveränderte Bautyp-Räume', () => {
    const p = newProject();
    p.applyBuildingType(draft(0));
    const smithy = p.state.rooms.find((r) => r.roomTypeId === 'smithy')!;
    p.assignRoomType(smithy.id, 'storage');
    expect(p.room(smithy.id).origin).toBe('user');
    // Übermalen teilt die Küche: beide Teile gelten als geändert
    const ev = p.eraseCells(0, CellSet.rect(0, 5, 6, 5));
    expect(ev.filter((x) => x.type === 'RoomOriginSet')).toHaveLength(2);
    expect(p.state.rooms.filter((r) => r.floorIndex === 0 && r.volumeId === undefined).every((r) => r.origin === 'user')).toBe(true);
    // Falscher Zähler oder anderer Bautyp: abgelehnt
    expect(() => p.rerollBuildingType(draft(2))).toThrow(/rerollCount 1/);
    expect(() => p.rerollBuildingType({ ...draft(1), origin: { ...draft(1).origin, buildingTypeId: 'tavern' } })).toThrow(DomainError);
    const kept = p.state.rooms.filter((r) => r.origin === 'user').map((r) => r.id);
    const [rr] = p.rerollBuildingType(draft(1, 6));
    expect(rr!.type).toBe('BuildingTypeRerolled');
    expect(p.state.origin?.rerollCount).toBe(1);
    // Nutzer-Räume stehen noch, neue Bautyp-Räume meiden ihre Zellen und die Spalten anderer Baukörper
    for (const id of kept) expect(p.state.rooms.some((r) => r.id === id)).toBe(true);
    assertInvariants(p.state);
    assertReplay(p);
    expect(p.undo(1).state.origin?.rerollCount).toBe(0);
  });

  it('W2-ED U1: Bautyp-Räume mit gesperrten oder von Hand gesetzten Möbeln überleben Neu-Würfeln und Anwenden', () => {
    const p = newProject();
    p.applyBuildingType(draft(0));
    const kitchen = p.state.rooms.find((r) => r.roomTypeId === 'kitchen')!;
    const smithy = p.state.rooms.find((r) => r.roomTypeId === 'smithy')!;
    // gesperrtes Möbel in der Küche, von Hand gesetztes in der Schmiede
    const [added] = p.addPlacement(kitchen.id, 'chest', pose([1, 64, 8]));
    const pid = added!.type === 'PlacementAdded' ? added!.placement.id : '';
    p.lockPlacement(pid);
    p.addPlacement(smithy.id, 'chest', pose([9, 63, 8]));
    expect(p.room(kitchen.id).origin).toBe('type'); // Sperren ändern die Herkunft nicht
    const scope = buildingTypeScope(p.state);
    expect(scope.pinned).toEqual([kitchen.id, smithy.id]);
    expect(scope.replaced).toHaveLength(2);
    expect(scope.user).toEqual([]);
    expect(scope.lockedPlacements).toBe(1);
    p.rerollBuildingType(draft(1, 6));
    expect(p.room(kitchen.id).cells.size).toBe(kitchen.cells.size);
    expect(p.placement(pid).locked).toBe(true);
    expect(p.state.placements.filter((x) => x.origin === 'manual')).toHaveLength(2);
    // Neue Bautyp-Räume meiden die Zellen der gehaltenen Räume
    for (const r of p.state.rooms) if (r.id !== kitchen.id && r.floorIndex === 0) expect(r.cells.intersects(kitchen.cells)).toBe(false);
    assertInvariants(p.state);
    assertReplay(p);
    // Sperre weg → der nächste Neubau ersetzt die Küche wieder
    p.unlockPlacement(pid);
    p.removePlacement(pid);
    p.applyBuildingType(draft(0));
    expect(p.state.rooms.some((r) => r.id === kitchen.id)).toBe(false);
    expect(p.state.rooms.some((r) => r.id === smithy.id)).toBe(true);
  });

  it('ohne Sperren: Neubau-Events wie bisher (alle Bautyp-Räume ersetzt)', () => {
    const p = newProject();
    p.applyBuildingType(draft(0));
    expect(buildingTypeScope(p.state)).toEqual({ replaced: p.state.rooms.map((r) => r.id), user: [], pinned: [], lockedPlacements: 0 });
    const [e] = p.rerollBuildingType(draft(1));
    if (e!.type !== 'BuildingTypeRerolled') throw new Error(e!.type);
    expect(e.events.filter((x) => x.type === 'RoomRemoved')).toHaveLength(4);
  });

  it('Neu-Würfeln entfernt verwaiste Baukörper und legt neue an; ohne Herkunft abgelehnt', () => {
    const p = newProject();
    expect(() => p.rerollBuildingType(draft(1))).toThrow(/keinem Bautyp/);
    p.applyBuildingType(draft(0));
    p.rerollBuildingType(draft(1));
    expect((p.state.volumes ?? []).map((v) => v.id)).toEqual([DEFAULT_VOLUME, `v${p.state.volumes![1]!.id.slice(1)}`]);
    expect((p.state.volumes ?? []).filter((v) => v.id !== DEFAULT_VOLUME)).toHaveLength(1);
    assertInvariants(p.state);
    assertReplay(p);
  });

  it('Projekte ohne Baukörper: keine neuen Felder, Events wie bisher', () => {
    const p = newProject();
    const ev = p.paintRoom(0, CellSet.rect(0, 0, 4, 4), 'kitchen');
    expect(ev).toEqual([{ type: 'RoomPainted', roomId: 'r1', floorIndex: 0, cells: CellSet.rect(0, 0, 4, 4).toArray(), roomTypeId: 'kitchen' }]);
    expect(Object.keys(p.state).sort()).toEqual(['floors', 'id', 'links', 'name', 'placements', 'rooms', 'seed', 'seq', 'targetVersion', 'themeId', 'wallMode'].sort());
    expect(Object.keys(p.room('r1')).sort()).toEqual(['cells', 'floorIndex', 'id', 'rerollCount', 'roomTypeId']);
  });
});
