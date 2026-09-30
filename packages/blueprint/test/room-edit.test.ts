/**
 * W2-ED U4: Räume nachbearbeiten – vergrößern/verkleinern mit derselben ID (`resizeRoom`), Variante wählen
 * (`setRoomVariant`), fixieren (`fixRoom`). Invarianten, Replay, Undo, Sperren und Bautyp-Neubau.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, pose } from '@mcda/core';
import { DomainError, Project, TARGET_VERSIONS, buildingTypeScope, type ProjectState } from '../src/index.js';

const newProject = () => Project.create({ id: 'p', name: 'Haus', seed: 77, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });

function assertInvariants(s: ProjectState): void {
  const seen = new Set<string>();
  for (const r of s.rooms) {
    expect(r.cells.isEmpty).toBe(false);
    expect(r.cells.isConnected(), `Raum ${r.id} zerfallen`).toBe(true);
    for (const [x, z] of r.cells) {
      const k = `${r.floorIndex}:${x},${z}`;
      expect(seen.has(k), `Zelle ${k} doppelt`).toBe(false);
      seen.add(k);
    }
  }
  for (const p of s.placements) expect(s.rooms.some((r) => r.id === p.roomId)).toBe(true);
}
const replayed = (p: Project) => Project.fromHistory(p.history).state;

describe('resizeRoom', () => {
  it('vergrößern: ID, Sperre und manuelle Möbel bleiben; Nachbar gibt Zellen ab; Undo', () => {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 5, 4), 'kitchen'); // r1
    p.paintRoom(0, CellSet.rect(6, 0, 11, 4), 'storage'); // r2
    const [added] = p.addPlacement('r1', 'chest', pose([1, 1, 1]));
    const pid = added!.type === 'PlacementAdded' ? added!.placement.id : '';
    p.lockPlacement(pid);
    const ev = p.resizeRoom('r1', CellSet.rect(6, 0, 7, 4), CellSet.empty());
    expect(ev.map((e) => e.type)).toEqual(['RoomCellsLost', 'RoomCellsGained']);
    expect(p.room('r1').cells.size).toBe(8 * 5);
    expect(p.room('r2').cells.size).toBe(4 * 5);
    expect(p.placement(pid).locked).toBe(true);
    assertInvariants(p.state);
    expect(replayed(p)).toEqual(p.state);
    expect(p.undo(ev.length).state.rooms.find((r) => r.id === 'r1')!.cells.size).toBe(30);
  });

  it('verkleinern und Nachbar ganz schlucken; zerfallen oder leer wird abgelehnt', () => {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 5, 4), 'kitchen'); // r1
    p.paintRoom(0, CellSet.rect(6, 0, 7, 4), 'storage'); // r2
    const ev = p.resizeRoom('r1', CellSet.rect(6, 0, 7, 4), CellSet.rect(0, 0, 0, 4));
    expect(ev.map((e) => e.type)).toEqual(['RoomRemoved', 'RoomCellsGained', 'RoomCellsLost']);
    expect(p.state.rooms.map((r) => r.id)).toEqual(['r1']);
    expect(p.room('r1').cells.size).toBe(7 * 5);
    expect(() => p.resizeRoom('r1', CellSet.empty(), p.room('r1').cells)).toThrow(DomainError);
    expect(() => p.resizeRoom('r1', CellSet.empty(), CellSet.rect(3, 0, 3, 4))).toThrow(/zusammenhängen/);
    expect(p.resizeRoom('r1', CellSet.empty(), CellSet.empty())).toEqual([]);
    assertInvariants(p.state);
  });

  it('Bautyp-Raum wird durch Größenänderung Nutzer-Raum; Treppen, die nicht mehr passen, entfallen', () => {
    const p = newProject();
    p.applyBuildingType({
      origin: { buildingTypeId: 't', params: {}, seed: 1, rerollCount: 0 },
      floors: { 0: 3, 1: 3 },
      rooms: [
        { floorIndex: 0, cells: CellSet.rect(0, 0, 7, 7), roomTypeId: 'hall' },
        { floorIndex: 1, cells: CellSet.rect(0, 0, 7, 7), roomTypeId: 'bedroom' },
      ],
      stairs: [{ floorIndex: 0, origin: [2, 2], facing: 'south' }],
    });
    const hall = p.state.rooms.find((r) => r.floorIndex === 0)!;
    const withStairs = p.state.links.length;
    const ev = p.resizeRoom(hall.id, CellSet.rect(8, 0, 8, 7), CellSet.empty());
    expect(ev.some((e) => e.type === 'RoomOriginSet')).toBe(true);
    expect(p.room(hall.id).origin).toBe('user');
    expect(p.state.links.length).toBe(withStairs);
    // Stufen wegschneiden → Treppe entfällt
    const ev2 = p.resizeRoom(hall.id, CellSet.empty(), CellSet.rect(0, 0, 8, 5));
    if (withStairs > 0) expect(ev2.some((e) => e.type === 'StairsRemoved')).toBe(true);
    assertInvariants(p.state);
    expect(replayed(p)).toEqual(p.state);
  });
});

describe('setRoomVariant', () => {
  it('springt vor und zurück; gleiche Variante = keine Änderung; negativ abgelehnt', () => {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 5, 4), 'kitchen');
    const seed0 = p.roomSeed('r1');
    p.setRoomVariant('r1', 3);
    expect(p.room('r1').rerollCount).toBe(3);
    const seed3 = p.roomSeed('r1');
    expect(seed3).not.toBe(seed0);
    p.setRoomVariant('r1', 0);
    expect(p.roomSeed('r1')).toBe(seed0);
    expect(p.setRoomVariant('r1', 0)).toEqual([]);
    expect(() => p.setRoomVariant('r1', -1)).toThrow(DomainError);
    expect(() => p.setRoomVariant('r1', 1.5)).toThrow(DomainError);
  });
});

describe('fixRoom', () => {
  it('fixiert/löst; ein fixierter Bautyp-Raum übersteht den Neubau; ohne Fixierung kein neues Feld', () => {
    const p = newProject();
    const draft = (rerollCount: number) => ({
      origin: { buildingTypeId: 't', params: {}, seed: 1, rerollCount },
      rooms: [
        { floorIndex: 0, cells: CellSet.rect(0, 0, 4, 4), roomTypeId: 'kitchen' },
        { floorIndex: 0, cells: CellSet.rect(5, 0, 9, 4), roomTypeId: 'storage' },
      ],
    });
    p.applyBuildingType(draft(0));
    const [a, b] = p.state.rooms;
    expect(Object.keys(a!)).not.toContain('fixed');
    expect(p.fixRoom(a!.id, true)).toHaveLength(1);
    expect(p.fixRoom(a!.id, true)).toEqual([]);
    expect(p.room(a!.id).fixed).toBe(true);
    expect(p.room(a!.id).origin).toBe('type'); // Fixieren ändert die Herkunft nicht
    expect(buildingTypeScope(p.state).pinned).toEqual([a!.id]);
    p.rerollBuildingType(draft(1));
    expect(p.state.rooms.some((r) => r.id === a!.id)).toBe(true);
    expect(p.state.rooms.some((r) => r.id === b!.id)).toBe(false);
    p.fixRoom(a!.id, false);
    expect(Object.keys(p.room(a!.id))).not.toContain('fixed');
    assertInvariants(p.state);
    expect(replayed(p)).toEqual(p.state);
  });
});
