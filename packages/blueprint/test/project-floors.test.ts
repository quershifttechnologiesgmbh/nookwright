import { describe, expect, it } from 'vitest';
import { CellSet, pose } from '@mcda/core';
import { DomainError, Project, TARGET_VERSIONS, checkLink, type ProjectEvent, type ProjectState } from '../src/index.js';

const newProject = (height = 3) =>
  Project.create({ id: 'p', name: 'Turmhaus', seed: 7, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 64, height } });

/** Erdgeschoss-Halle und Obergeschoss-Halle (je 13×11), dazwischen eine Etage. */
function twoFloors(): Project {
  const p = newProject();
  p.paintRoom(0, CellSet.rect(0, 0, 12, 10), 'storage');
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 12, 10), 'bedroom');
  return p;
}

/** Invarianten der Etagen und Treppen, die nach jedem Befehl gelten. */
function assertFloorInvariants(s: ProjectState): void {
  s.floors.forEach((f, i) => {
    if (i === 0) return;
    const lo = s.floors[i - 1]!;
    expect(f.index, 'Etagen lückenlos').toBe(lo.index + 1);
    expect(f.y0, 'Etagenabstand = lichte Höhe + 1').toBe(lo.y0 + lo.height + 1);
  });
  for (const r of s.rooms) expect(s.floors.some((f) => f.index === r.floorIndex), `Raum ${r.id} ohne Etage`).toBe(true);
  for (const l of s.links) expect(typeof checkLink(s, l), `Treppe ${l.id}`).not.toBe('string');
}

describe('Project – Etagen', () => {
  it('neue Etage darüber: Bodenplatte = Decke der Etage darunter', () => {
    const p = newProject();
    const ev = p.addFloor();
    expect(ev).toEqual([{ type: 'FloorAdded', floor: { index: 1, y0: 68, height: 3 } }]);
    p.addFloor({ height: 5 });
    expect(p.state.floors).toEqual([
      { index: 0, y0: 64, height: 3 },
      { index: 1, y0: 68, height: 3 },
      { index: 2, y0: 72, height: 5 },
    ]);
    p.addFloor({ below: true, height: 4 });
    expect(p.floor(-1)).toEqual({ index: -1, y0: 59, height: 4 });
    assertFloorInvariants(p.state);
  });

  it('Höhe je Etage: 2 bis 16', () => {
    const p = newProject();
    expect(() => p.addFloor({ height: 1 })).toThrow(DomainError);
    expect(() => p.addFloor({ height: 17 })).toThrow(/nicht erlaubt/);
    expect(() => p.addFloor({ height: 2.5 })).toThrow(DomainError);
    expect(p.history).toHaveLength(1);
  });

  it('Etage entfernen: nur oben oder unten, nie die letzte; Räume, Platzierungen und Treppen gehen mit', () => {
    const p = twoFloors();
    p.addFloor();
    p.paintRoom(2, CellSet.rect(0, 0, 4, 4), 'storage');
    p.placeStairs(0, [3, 5], 'east');
    p.addPlacement('r2', 'seat/chair', pose([9, 69, 2]));
    expect(() => p.removeFloor(1)).toThrow(/oberste oder unterste/);
    expect(() => p.removeFloor(9)).toThrow(/Unbekannte Etage/);
    const top = p.removeFloor(2);
    expect(top.map((e) => e.type)).toEqual(['RoomRemoved', 'FloorRemoved']);
    const ev = p.removeFloor(1);
    expect(ev.map((e) => e.type)).toEqual(['StairsRemoved', 'RoomRemoved', 'FloorRemoved']);
    expect(p.state.links).toEqual([]);
    expect(p.state.placements).toEqual([]);
    expect(p.state.rooms.map((r) => r.id)).toEqual(['r1']);
    expect(() => p.removeFloor(0)).toThrow(/letzte Etage/);
    assertFloorInvariants(p.state);
  });

  it('Malen auf einer oberen Etage darf über die untere hinausragen (Balkon); Undo/Replay über Etagen', () => {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 6, 6), 'storage');
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 9, 6), 'bedroom'); // 3 Spalten Auskragung
    expect(p.state.rooms.map((r) => [r.id, r.floorIndex])).toEqual([['r1', 0], ['r2', 1]]);
    expect(Project.fromHistory(p.history).state).toEqual(p.state);
    const u = p.undo(2);
    expect(u.state.floors).toHaveLength(1);
    expect(u.state.rooms).toHaveLength(1);
  });
});

describe('Project – Treppen (VerticalLink)', () => {
  it('gerade Treppe: reservierte Zellen auf beiden Etagen, fortlaufende ID', () => {
    const p = twoFloors();
    const ev = p.placeStairs(0, [3, 5], 'east');
    expect(ev).toEqual([{ type: 'StairsPlaced', link: { id: 's3', type: 'straight', floorIndex: 0, origin: [3, 5], facing: 'east' } }]);
    const res = checkLink(p.state, p.link('s3'));
    if (typeof res === 'string') throw new Error(res);
    expect(res.lower.id).toBe('r1');
    expect(res.upper.id).toBe('r2');
    expect(res.lowerCells.toArray().sort()).toEqual([[2, 5], [3, 5], [4, 5], [5, 5], [6, 5]].sort());
    expect(res.upperCells.toArray().sort()).toEqual([[4, 5], [5, 5], [6, 5], [7, 5]].sort());
    // nächste Raum-ID zählt weiter
    expect(p.paintRoom(1, CellSet.rect(13, 0, 16, 4), 'storage').at(-1)).toMatchObject({ roomId: 'r4' });
    assertFloorInvariants(p.state);
  });

  it('l/u/spiral bekommen einen Drehsinn (Standard rechts), Leiter und gerade nicht', () => {
    const p = twoFloors();
    p.placeStairs(0, [2, 2], 'east', 'u');
    p.placeStairs(0, [8, 7], 'north', 'spiral', { turn: 'left' });
    p.placeStairs(0, [9, 2], 'south', 'ladder');
    expect(p.state.links.map((l) => [l.type, l.turn])).toEqual([['u', 'right'], ['spiral', 'left'], ['ladder', undefined]]);
    assertFloorInvariants(p.state);
  });

  it('abgelehnt: an der Wand, außerhalb, ohne Raum oben, ohne Etage darüber, Überschneidung, zu hohe Wendeltreppe', () => {
    const p = twoFloors();
    const n = p.history.length;
    expect(() => p.placeStairs(0, [1, 0], 'east')).toThrow(/an der Wand oder außerhalb/); // Zeile 0 ist Wand
    expect(() => p.placeStairs(0, [9, 5], 'east')).toThrow(DomainError); // läuft aus dem Raum
    expect(() => p.placeStairs(1, [3, 5], 'east')).toThrow(/Etagen 1 und 2/);
    p.eraseCells(1, CellSet.rect(0, 0, 12, 10));
    expect(() => p.placeStairs(0, [3, 5], 'east')).toThrow(/oben .* in keinem Raum/);
    p.paintRoom(1, CellSet.rect(0, 0, 12, 10), 'bedroom');
    p.placeStairs(0, [3, 5], 'east');
    expect(() => p.placeStairs(0, [5, 3], 'south')).toThrow(/überschneidet sich mit Treppe/);
    expect(() => p.placeStairs(0, [9, 2], 'south', 'straight')).not.toThrow();
    const tall = newProject(8);
    tall.paintRoom(0, CellSet.rect(0, 0, 12, 10), 'storage');
    tall.addFloor();
    tall.paintRoom(1, CellSet.rect(0, 0, 12, 10), 'storage');
    expect(() => tall.placeStairs(0, [4, 4], 'north', 'spiral')).toThrow(/höchstens 7 Stufen/);
    expect(p.history.length).toBeGreaterThan(n);
    assertFloorInvariants(p.state);
  });

  it('Leiter: der Träger hinter der Leiter ist reserviert (dort steht ggf. ein Pfosten)', () => {
    const p = twoFloors();
    p.placeStairs(0, [5, 5], 'north', 'ladder'); // Träger (5, 4)
    expect(() => p.placeStairs(0, [3, 4], 'east')).toThrow(/überschneidet sich/);
    expect(() => p.placeStairs(0, [3, 3], 'east')).not.toThrow();
  });

  it('Platzierungen in den reservierten Zellen werden entfernt (samt Kindern), andere bleiben', () => {
    const p = twoFloors();
    p.addPlacement('r1', 'seat/chair', pose([4, 65, 5]));
    p.addPlacement('r1', 'storage/chest', pose([9, 65, 8]));
    p.addPlacement('r2', 'seat/chair', pose([7, 69, 5])); // Austritt oben
    const ev = p.placeStairs(0, [3, 5], 'east');
    expect(ev.map((e) => e.type)).toEqual(['PlacementRemoved', 'PlacementRemoved', 'StairsPlaced']);
    expect(p.state.placements.map((x) => x.componentId)).toEqual(['storage/chest']);
  });

  it('Treppe fällt weg, wenn Radieren/Übermalen ihre Zellen aus dem Raumkern nimmt (Invariante)', () => {
    const p = twoFloors();
    p.placeStairs(0, [3, 5], 'east');
    // Übermalen mit neuem Raum, der die Treppe ganz umfasst: bleibt gültig
    const keep = p.paintRoom(0, CellSet.rect(0, 2, 12, 8), 'storage');
    expect(keep.some((e) => e.type === 'StairsRemoved')).toBe(false);
    // Radieren neben der Treppe macht die Zellen zu Wand
    const ev = p.eraseCells(1, CellSet.of([[6, 4]]));
    expect(ev.at(-1)).toEqual({ type: 'StairsRemoved', linkId: 's3' });
    expect(p.state.links).toEqual([]);
    assertFloorInvariants(p.state);
  });

  it('Treppe entfernen; Undo stellt sie wieder her; unbekannte ID', () => {
    const p = twoFloors();
    p.placeStairs(0, [3, 5], 'east');
    p.removeStairs('s3');
    expect(p.state.links).toEqual([]);
    expect(p.undo().state.links.map((l) => l.id)).toEqual(['s3']);
    expect(() => p.removeStairs('s3')).toThrow(/Unbekannte Treppe/);
  });
});

describe('Project – Umbenennen (ProjectRenamed)', () => {
  it('Event statt Umschreiben von ProjectCreated; Leerraum gekürzt; leer abgelehnt', () => {
    const p = newProject();
    expect(p.rename('  Burg Eisenstein ')).toEqual([{ type: 'ProjectRenamed', name: 'Burg Eisenstein' }]);
    expect(p.state.name).toBe('Burg Eisenstein');
    expect(p.history[0]).toMatchObject({ type: 'ProjectCreated', name: 'Turmhaus' });
    expect(p.rename('Burg Eisenstein')).toEqual([]);
    expect(() => p.rename('   ')).toThrow(DomainError);
    expect(p.undo().state.name).toBe('Turmhaus');
    expect(Project.fromHistory(p.history).state.name).toBe('Burg Eisenstein');
  });

  it('alte Historien (Name nur im ersten Event, ohne Etagen/Treppen-Events) laden unverändert', () => {
    const old: ProjectEvent[] = [
      { type: 'ProjectCreated', id: 'x', name: 'Altes Haus', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { index: 0, y0: 0, height: 3 } },
      { type: 'RoomPainted', roomId: 'r1', floorIndex: 0, cells: CellSet.rect(0, 0, 4, 4).toArray(), roomTypeId: 'storage' },
    ];
    const p = Project.fromHistory(old);
    expect(p.state.name).toBe('Altes Haus');
    expect(p.state.links).toEqual([]);
    expect(p.state.floors).toEqual([{ index: 0, y0: 0, height: 3 }]);
    p.rename('Neues Haus');
    expect(Project.fromHistory(p.history).state.name).toBe('Neues Haus');
  });
});
