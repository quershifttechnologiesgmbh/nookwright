/**
 * Umfang einer Änderung (W2-ED U4, Konzept W2UX §4.1 Regel 5 „Umfang wird gezeigt“): welche Räume neu eingerichtet,
 * neu, entfernt oder unverändert sind und wie viele gesperrte Möbel blieben – für die ehrliche Statuszeile
 * („Küche · 3 neu eingerichtet · 2 gesperrte blieben · 14 Räume unverändert“) und den Auswahl-Chip über der 3D-Ansicht.
 * Rein, vergleicht nur zwei Projektzustände.
 */
import type { Placement, ProjectState, RoomId } from '@mcda/blueprint';

export interface ChangeScope {
  /** Räume, die es vorher und nachher gibt und die neu eingerichtet wurden (die meisten Möbel anders). */
  readonly rebuilt: readonly RoomId[];
  /**
   * Räume, in denen die meisten Möbel blieben: gleiche Zellen (verschoben, gedreht, getauscht, entfernt) oder – W7-G,
   * „Nachbarn behalten Möbel“ – größer/kleiner bzw. mit verschobener Tür, aber die Einrichtung blieb überwiegend stehen.
   */
  readonly edited: readonly RoomId[];
  readonly unchanged: readonly RoomId[];
  readonly added: readonly RoomId[];
  readonly removed: readonly RoomId[];
  /** Gesperrte Möbel, die unverändert geblieben sind – nur in geänderten Räumen gezählt. */
  readonly lockedKept: number;
  /** Möbel insgesamt nachher und davon unverändert (gleicher Raum, Komponente, Variante, Lage, Sperre). */
  readonly placements: number;
  readonly placementsKept: number;
}

/**
 * Inhalt einer Platzierung ohne ID: Neu-Einrichten vergibt neue IDs (`p<n>`), auch wenn dasselbe Möbel an derselben Stelle
 * steht – für den Nutzer ist das unverändert.
 */
const placementKey = (p: Placement): string => JSON.stringify([p.roomId, p.componentId, p.variantId ?? '', p.pose.pos, p.pose.rot, p.pose.mirror]);


/** Vergleicht zwei Zustände Raum für Raum (Zellen, Etage, Typ und Möbel). */
export function changeScope(before: ProjectState, after: ProjectState): ChangeScope {
  const keysBefore = new Set(before.placements.map(placementKey));
  const byRoom = (s: ProjectState): Map<RoomId, string[]> => {
    const m = new Map<RoomId, string[]>();
    for (const p of s.placements) m.set(p.roomId, [...(m.get(p.roomId) ?? []), placementKey(p)]);
    return m;
  };
  const pb = byRoom(before);
  const pa = byRoom(after);
  const shapeKey = (s: ProjectState, id: RoomId): string => {
    const r = s.rooms.find((x) => x.id === id)!;
    const cells = r.cells.toArray().map(([x, z]) => `${x},${z}`).sort().join(';');
    return JSON.stringify([r.floorIndex, r.roomTypeId, r.volumeId ?? '', cells]);
  };
  const roomKey = (s: ProjectState, id: RoomId, pm: Map<RoomId, string[]>): string => JSON.stringify([shapeKey(s, id), (pm.get(id) ?? []).sort()]);
  /** Möbel eines Raums, die es nachher nicht gleich gab (Multimenge), und die, die blieben. */
  const diff = (id: RoomId): { changed: number; kept: number } => {
    const left = [...(pb.get(id) ?? [])];
    let kept = 0;
    let changed = 0;
    for (const k of pa.get(id) ?? []) {
      const i = left.indexOf(k);
      if (i >= 0) {
        left.splice(i, 1);
        kept++;
      } else changed++;
    }
    return { changed: changed + left.length, kept };
  };
  const ids = new Set(before.rooms.map((r) => r.id));
  const rebuilt: RoomId[] = [];
  const edited: RoomId[] = [];
  const unchanged: RoomId[] = [];
  const added: RoomId[] = [];
  for (const r of after.rooms) {
    if (!ids.has(r.id)) added.push(r.id);
    else if (roomKey(before, r.id, pb) === roomKey(after, r.id, pa)) unchanged.push(r.id);
    else {
      const d = diff(r.id);
      // die meisten Möbel geblieben → „geändert“ (verschoben, gedreht, getauscht; W7-G: auch Kante gezogen, Tür verschoben),
      // sonst neu eingerichtet. Andere Zellen ohne ein gebliebenes Möbel zählen als neu eingerichtet.
      if (d.kept >= d.changed && (d.kept > 0 || shapeKey(before, r.id) === shapeKey(after, r.id))) edited.push(r.id);
      else rebuilt.push(r.id);
    }
  }
  const now = new Set(after.rooms.map((r) => r.id));
  const removed = before.rooms.filter((r) => !now.has(r.id)).map((r) => r.id);
  const changed = new Set([...rebuilt, ...edited, ...added]);
  const kept = after.placements.filter((p) => keysBefore.has(placementKey(p)));
  return {
    rebuilt,
    edited,
    unchanged,
    added,
    removed,
    lockedKept: kept.filter((p) => p.locked && changed.has(p.roomId)).length,
    placements: after.placements.length,
    placementsKept: kept.length,
  };
}

const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;

/**
 * Umfang in einem Satz. `roomName` benennt einen Raum („Küche · 3“). Ohne betroffene Räume: „Räume und Möbel
 * unverändert“ (z. B. Dach, Stil der Hülle).
 */
export function scopeText(sc: ChangeScope, roomName: (id: RoomId) => string): string {
  const parts: string[] = [];
  if (sc.rebuilt.length === 1) parts.push(`${roomName(sc.rebuilt[0]!)} neu eingerichtet`);
  else if (sc.rebuilt.length > 1) parts.push(`${n(sc.rebuilt.length, 'Raum', 'Räume')} neu eingerichtet`);
  if (sc.edited.length === 1) parts.push(`${roomName(sc.edited[0]!)} geändert`);
  else if (sc.edited.length > 1) parts.push(`${n(sc.edited.length, 'Raum', 'Räume')} geändert`);
  if (sc.added.length > 0) parts.push(`${n(sc.added.length, 'Raum', 'Räume')} neu`);
  if (sc.removed.length > 0) parts.push(`${n(sc.removed.length, 'Raum', 'Räume')} entfernt`);
  if (parts.length === 0) return sc.unchanged.length === 0 ? 'keine Räume' : `Räume und Möbel unverändert`;
  if (sc.lockedKept > 0) parts.push(`${n(sc.lockedKept, 'gesperrtes Möbel blieb', 'gesperrte Möbel blieben')}`);
  if (sc.unchanged.length > 0) parts.push(`${n(sc.unchanged.length, 'Raum', 'Räume')} unverändert`);
  return parts.join(' · ');
}

/** Chip über der 3D-Ansicht: was eine Aktion im Panel gerade neu baut (Regel 1 „Umfang = Auswahl“). */
export function selectionChip(level: 'Haus' | 'Etage' | 'Raum' | 'Möbel' | 'Treppe' | 'Dach' | 'Außen-Teil', label: string): string | undefined {
  switch (level) {
    case 'Raum':
      return `Auswahl: ${label} – nur dieser Raum wird neu gebaut`;
    case 'Möbel':
      return `Auswahl: ${label} – nur dieses Möbel ändert sich`;
    case 'Etage':
      return `Auswahl: ${label} – Wandhöhe richtet die Räume dieser Etage neu ein`;
    case 'Treppe':
      return `Auswahl: ${label} – nur diese Treppe und die zwei berührten Räume`;
    case 'Dach':
      return 'Auswahl: Dach – Räume und Möbel bleiben';
    case 'Außen-Teil':
      return `Auswahl: ${label} – nur die Außen-Deko`;
    case 'Haus':
      return undefined;
  }
}
