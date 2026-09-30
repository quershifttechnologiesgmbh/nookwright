/** Anzeige-Nummern für Räume (Nutzerreview: „R1 → R23 → R27“ wirkt zufällig). */
import { Project, TARGET_VERSIONS, type Room } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { roomDisplayNumbers, roomLabel } from '../src/ui/roomLabels.js';

function project(): Project {
  return Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height: 3 } });
}

describe('Anzeige-Nummern der Räume', () => {
  it('nummeriert fortlaufend je Etage in Projekt-Reihenfolge', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 4, 4), 'kitchen');
    p.paintRoom(0, CellSet.rect(6, 0, 10, 4), 'bedroom');
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 4, 4), 'storage');
    const rooms = p.state.rooms;
    const unten = roomDisplayNumbers(rooms, 0);
    const oben = roomDisplayNumbers(rooms, 1);
    expect([...unten.values()]).toEqual([1, 2]);
    expect([...oben.values()]).toEqual([1]);
    // stabil: die interne ID bleibt der Schlüssel, die Nummer hängt an der Reihenfolge
    expect(unten.get(rooms[0]!.id)).toBe(1);
    expect(unten.get(rooms[1]!.id)).toBe(2);
    expect(unten.size + oben.size).toBe(rooms.length);
    expect(roomDisplayNumbers(rooms, 2).size).toBe(0);
  });

  it('löscht keine Lücken: nach dem Entfernen eines Raums rücken die Nummern nach', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 4, 4), 'kitchen');
    p.paintRoom(0, CellSet.rect(6, 0, 10, 4), 'bedroom');
    const rooms: Room[] = p.state.rooms.slice(1);
    expect([...roomDisplayNumbers(rooms, 0).values()]).toEqual([1]);
  });

  it('Beschriftung: „Schlafzimmer · 1“, ohne Nummer nur der Name', () => {
    expect(roomLabel('Schlafzimmer', 1)).toBe('Schlafzimmer · 1');
    expect(roomLabel('Schlafzimmer', undefined)).toBe('Schlafzimmer');
  });
});
