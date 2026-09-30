/**
 * Auftrag 3: Die Meldung für sich überdeckende Räume zweier Baukörper war technisch („Raum r296 (Baukörper v0)
 * überschneidet Raum r15 …“). Sie nennt jetzt Etage und Raumtyp und erklärt den Bergfried-Fall; die Oberfläche
 * ersetzt die IDs durch Anzeigenamen (`translateRoomRefs`).
 */
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { volumeClash } from '../src/volumes.js';
import type { Room } from '../src/model.js';

const room = (id: string, roomTypeId: string, floorIndex: number, cells: CellSet, volumeId?: string): Room => ({
  id, roomTypeId, floorIndex, cells, rerollCount: 0, ...(volumeId !== undefined ? { volumeId } : {}),
});

describe('Baukörper-Überschneidung in Nutzersprache (Auftrag 3)', () => {
  it('nennt Etage, Raumtyp, beide Baukörper und den Bergfried-Hinweis', () => {
    const a = room('r296', 'solar', 1, CellSet.rect(0, 0, 4, 4), 'v1');
    const b = room('r15', 'throne_room', 0, CellSet.rect(3, 3, 8, 8));
    const msg = volumeClash({ rooms: [a, b] })!;
    expect(msg).toContain('Räume verschiedener Baukörper dürfen sich nicht überdecken');
    expect(msg).toContain('Raum r296');
    expect(msg).toContain('Baukörper v1');
    expect(msg).toContain('Etage 1. OG');
    expect(msg).toContain('solar');
    expect(msg).toContain('Raum r15');
    expect(msg).toContain('Etage EG');
    expect(msg).toContain('throne_room');
    expect(msg).toContain('Der Bergfried einer Burg ist ein eigener Baukörper');
    // Keine alten Kurzform-Reste
    expect(msg).not.toContain('Baukörper teilen keine Spalten');
  });

  it('Keller und Obergeschoss werden als UG/OG benannt', () => {
    const a = room('r1', 'storage', -1, CellSet.rect(0, 0, 2, 2), 'v1');
    const b = room('r2', 'kitchen', 2, CellSet.rect(1, 1, 3, 3));
    const msg = volumeClash({ rooms: [a, b] })!;
    expect(msg).toContain('Etage 1. UG');
    expect(msg).toContain('Etage 2. OG');
  });

  it('ohne Überschneidung keine Meldung', () => {
    const a = room('r1', 'solar', 0, CellSet.rect(0, 0, 2, 2), 'v1');
    const b = room('r2', 'kitchen', 0, CellSet.rect(4, 4, 6, 6));
    expect(volumeClash({ rooms: [a, b] })).toBeUndefined();
  });
});
