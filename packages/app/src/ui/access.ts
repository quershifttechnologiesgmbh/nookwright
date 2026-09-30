/**
 * Erreichbarkeit (Red-Team-Review 24.09.2026): Etagen ohne Treppe und Räume ohne Tür oder Treppe waren im Spiel
 * unerreichbar, trotzdem meldete die Qualität „sehr gut“ und die Export-Prüfung „Keine Fehler“. Diese Prüfung
 * nennt solche Stellen in Nutzersprache – im Panel „Gebäude“ und im Export-Dialog. Rein und testbar.
 *
 * Grundlage sind die Etagen-Verbindungen (`VerticalLink` verbindet `floorIndex` mit `floorIndex + 1`) und die
 * Türen/Treppenzugänge je Raum aus der Hülle. Eingang ist das EG; hat es keine Räume, die Etage mit Räumen, die dem
 * EG am nächsten liegt (z. B. ein reiner Keller-Bau).
 */
import type { ProjectState, RoomId, RoomShellInfo } from '@mcda/blueprint';

export interface AccessHint {
  /** Etagen- oder Raum-Hinweis. */
  readonly kind: 'floor' | 'room';
  readonly floorIndex: number;
  readonly roomId?: RoomId;
  readonly text: string;
}

/** Etage, über die man das Haus betritt: EG, sonst die Etage mit Räumen, die dem EG am nächsten liegt. */
export function entranceFloor(state: ProjectState): number | undefined {
  const withRooms = [...new Set(state.rooms.map((r) => r.floorIndex))];
  if (withRooms.length === 0) return undefined;
  if (withRooms.includes(0)) return 0;
  return withRooms.sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)[0];
}

/** Etagen, die über Treppen/Leitern vom Eingang aus erreichbar sind. */
export function reachableFloors(state: ProjectState): ReadonlySet<number> {
  const start = entranceFloor(state);
  const seen = new Set<number>();
  if (start === undefined) return seen;
  const edges = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    edges.set(a, [...(edges.get(a) ?? []), b]);
  };
  for (const l of state.links) {
    link(l.floorIndex, l.floorIndex + 1);
    link(l.floorIndex + 1, l.floorIndex);
  }
  const queue = [start];
  seen.add(start);
  while (queue.length > 0) {
    const f = queue.shift()!;
    for (const n of edges.get(f) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

/**
 * Hinweise zur Erreichbarkeit. `floorName` und `roomName` liefern die Anzeigenamen („1. OG“, „Weinkeller · 1“).
 * `rooms` sind die Rauminfos der Hülle; fehlt ein Raum dort (Hülle noch nicht berechnet), wird er übersprungen.
 */
export function accessHints(
  state: ProjectState,
  rooms: ReadonlyMap<RoomId, RoomShellInfo>,
  floorName: (index: number) => string,
  roomName: (id: RoomId) => string,
): AccessHint[] {
  const out: AccessHint[] = [];
  const reach = reachableFloors(state);
  const floorsWithRooms = [...new Set(state.rooms.map((r) => r.floorIndex))].sort((a, b) => b - a);
  const cutOff = new Set<number>();
  for (const f of floorsWithRooms) {
    if (reach.has(f)) continue;
    cutOff.add(f);
    // Treppen führen von der unteren Etage nach oben: für ein OG auf der Etage darunter setzen, für einen Keller
    // auf dem Keller selbst (hinauf zur Etage darüber)
    const text = f > 0
      ? `${floorName(f)} ist nicht erreichbar: keine Treppe herauf – mit Werkzeug T auf ${floorName(f - 1)} eine Treppe setzen`
      : `${floorName(f)} ist nicht erreichbar: keine Treppe hinauf nach ${floorName(f + 1)} – mit Werkzeug T auf ${floorName(f)} eine Treppe setzen`;
    out.push({ kind: 'floor', floorIndex: f, text });
  }
  for (const r of state.rooms) {
    if (cutOff.has(r.floorIndex)) continue; // schon als ganze Etage gemeldet
    const info = rooms.get(r.id);
    if (info === undefined) continue;
    if (info.doors.length > 0 || (info.stairs?.length ?? 0) > 0) continue;
    out.push({ kind: 'room', floorIndex: r.floorIndex, roomId: r.id, text: `${roomName(r.id)} (${floorName(r.floorIndex)}) hat weder Tür noch Treppe` });
  }
  return out;
}

/** Präfixe der Laufweg-Warnungen (`@mcda/pipeline` `circulation`), die Räume auflisten. */
const NO_PATH = 'Ohne Weg vom Eingang: ';
const NO_STAIRS = 'Etage ohne Treppenzugang (nur über einen Sprung erreichbar): ';
const SHORT_STAIRS = 'Treppe zu kurz für eine Etage (1–2 gesperrte Zellen): ';
/**
 * W11-B (R6-5): ruhig und mit Handlungsweg statt „Ohne Weg vom Eingang: …“ – eine freistehende Scheune mit eigenem
 * Eingang ist kein Fehler, ein Raum ohne jede Tür schon.
 */
export const NO_PATH_TEXT = (rooms: string): string =>
  `Kein Weg vom Haupteingang zu: ${rooms} – mit eigenem Eingang (z. B. Scheune) ist das in Ordnung; sonst Räume aneinander malen, damit eine Tür entsteht`;

/**
 * Eine Liste für Panel „Gebäude“ und Export: zuerst die eigenen Hinweise (`accessHints`, Nutzersprache, mit der
 * Etage, auf der die Treppe fehlt), dann die Laufweg-Warnungen aus `circulation` – dort
 * - Räume, die schon gemeldet sind (ganze Etage abgeschnitten oder Raum ohne Tür), herausgenommen; bleibt keiner,
 *   entfällt die Warnung (sonst stünde dieselbe Etage zweimal da),
 * - interne Raum-IDs („r3“) durch Anzeigenamen („Küche · 2“) ersetzt, davor die Etage in Nutzersprache („1. OG“),
 * - Quellenangaben für Entwickler („research/21 §0.5“) entfernt.
 * Die Pipeline bleibt bewusst etikettenfrei (sie kennt nur `floorIndex`, keine Namen wie „EG“/„1. OG“); die
 * Übersetzung in Etagennamen passiert hier mit demselben `floorName` wie überall in der App.
 * Die Laufweg-Warnungen folgen dem echten Tür-Graphen und finden damit auch einen Raum, dessen einzige Tür in einen
 * ebenfalls abgeschnittenen Raum führt.
 */
export function mergeAccessWarnings(
  hints: readonly AccessHint[],
  warnings: readonly string[],
  state: ProjectState,
  roomName: (id: RoomId) => string,
  floorName: (index: number) => string,
): string[] {
  const cutFloors = new Set(hints.filter((h) => h.kind === 'floor').map((h) => h.floorIndex));
  const covered = new Set<string>([
    ...state.rooms.filter((r) => cutFloors.has(r.floorIndex)).map((r) => r.id),
    ...hints.flatMap((h) => (h.roomId !== undefined ? [h.roomId] : [])),
  ]);
  const known = new Map(state.rooms.map((r) => [r.id as string, r]));
  const named = (id: string): string => {
    const room = known.get(id);
    return room === undefined ? id : `${roomName(room.id)} (${floorName(room.floorIndex)})`;
  };
  const roomOnly = (id: string): string => {
    const room = known.get(id);
    return room === undefined ? id : roomName(room.id);
  };
  const cleanSource = (text: string): string => text.replace(/,?\s*research\/\d+[^,)]*/g, '').replace(/\s*\(\s*\)/g, '');
  /** ID-Gruppen einer Warnung: durch „, “ getrennt, Räume einer Etage durch „+“; gemeldete Räume fallen heraus. */
  const groups = (payload: string): string[][] =>
    payload
      .split(', ')
      .map((g) => g.split('+').filter((id) => !covered.has(id)))
      .filter((g) => g.length > 0);
  const out = hints.map((h) => h.text);
  for (const w of warnings) {
    if (w.startsWith(NO_PATH)) {
      const rest = groups(w.slice(NO_PATH.length));
      if (rest.length === 0) continue;
      out.push(NO_PATH_TEXT(rest.map((g) => g.map(named).join(' + ')).join(', ')));
      continue;
    }
    if (w.startsWith(NO_STAIRS)) {
      for (const g of groups(w.slice(NO_STAIRS.length))) {
        const floors = new Set(g.map((id) => known.get(id)?.floorIndex));
        const floor = floors.size === 1 ? [...floors][0] : undefined;
        // Etage voranstellen („1. OG ist ohne Treppenzugang …“); nur bei gemischten Etagen je Raum nennen
        out.push(floor === undefined
          ? `${NO_STAIRS}${g.map(named).join(' + ')}`
          : `${floorName(floor)} ist ohne Treppenzugang – nur über einen Sprung erreichbar: ${g.map(roomOnly).join(' + ')}`);
      }
      continue;
    }
    if (w.startsWith(SHORT_STAIRS)) {
      // Eine Meldung je Raum mit dem, was zu tun ist (statt einer ID-Liste)
      for (const id of groups(w.slice(SHORT_STAIRS.length)).flat()) {
        out.push(`Treppe in „${named(id)}“ ist zu kurz für eine Etage – eine Treppe mehr setzen`);
      }
      continue;
    }
    out.push(cleanSource(w).replace(/[A-Za-z0-9_:.-]+/g, (tok) => (known.has(tok) ? named(tok) : tok)));
  }
  return [...new Set(out)];
}
