/**
 * Anzeige-Nummern für Räume (Nutzerreview: „R1 → R23 → R27“ wirkt zufällig). Die `roomId` bleibt der stabile
 * Schlüssel in Projektdatei, Undo und Platzierungen – die Oberfläche nummeriert dagegen **fortlaufend je Etage**
 * in der Reihenfolge, in der die Räume im Projekt stehen. Rein und testbar.
 */
import type { Room, RoomId } from '@mcda/blueprint';

/** Anzeige-Nummer (1, 2, 3 …) je Raum der Etage; Räume anderer Etagen fehlen in der Zuordnung. */
export function roomDisplayNumbers(rooms: readonly Room[], floor: number): ReadonlyMap<RoomId, number> {
  const map = new Map<RoomId, number>();
  let n = 0;
  for (const r of rooms) {
    if (r.floorIndex !== floor) continue;
    n++;
    map.set(r.id, n);
  }
  return map;
}

/** Beschriftung „Schlafzimmer · 1“; ohne Nummer nur der Name. */
export function roomLabel(name: string, n: number | undefined): string {
  return n === undefined ? name : `${name} · ${n}`;
}
