import type { ProjectState, RoomId } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';

/**
 * Hinweise **nach dem Malen eines Raums** (Review 3, kleinere Punkte):
 *
 * * „1×1-Raum wird stillschweigend verworfen“ – der Raum entsteht, bekommt aber **keine Möbel**, weil er unter
 *   `minArea` seines Raumtyps liegt. Vorher sagte die App dazu nichts; jetzt steht es in der Statuszeile.
 * * „Übermalen schluckt einen Raum ohne Hinweis“ – ein neues Rechteck nimmt bestehenden Räumen die Zellen
 *   (Domäne: `takeCells`). Auch das wird jetzt benannt, samt Hinweis auf „Rückgängig“.
 *
 * Reine Funktion auf zwei Projektzuständen – ohne React, damit sie testbar bleibt.
 */
export function paintNotes(before: ProjectState, after: ProjectState, roomId: RoomId | undefined, catalog: Catalog): string[] {
  if (roomId === undefined) return [];
  const room = after.rooms.find((r) => r.id === roomId);
  if (room === undefined) return [];
  const notes: string[] = [];

  const placements = after.placements.filter((p) => p.roomId === roomId).length;
  if (placements === 0) {
    const type = catalog.roomType(room.roomTypeId);
    const cells = room.cells.size;
    notes.push(
      cells < type.minArea
        ? `zu klein für „${type.name}“ (mindestens ${type.minArea} Zellen): keine Möbel eingerichtet`
        : `„${type.name}“ passt hier nicht: keine Möbel eingerichtet`,
    );
  }

  // Übermalte Räume: Zellen, die vorher zu einem ANDEREN Raum derselben Etage gehörten.
  const covered = before.rooms.filter(
    (r) => r.id !== roomId && r.floorIndex === room.floorIndex && r.cells.intersection(room.cells).size > 0,
  );
  if (covered.length > 0) {
    const names = covered.map((r) => `„${roomTypeName(catalog, r.roomTypeId)}“`);
    const list = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} und ${names.length - 3} weitere`;
    notes.push(`übermalt: ${list} – Rückgängig holt den alten Raum zurück`);
  }
  return notes;
}

function roomTypeName(catalog: Catalog, roomTypeId: string): string {
  try {
    return catalog.roomType(roomTypeId).name;
  } catch {
    return roomTypeId;
  }
}
