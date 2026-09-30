/**
 * Erschließung und Laufwege (research/22 §0.3–0.4, research/23 §0.1–0.2, Synthese 25 Regeln 3/4/7):
 * aus der Hülle einen begehbaren Graph bauen – Räume sind Knoten, Türen verbinden sie – und daraus die Laufzeit
 * vom Eingang zu jeder Station rechnen. Rein und deterministisch, ohne Materialisierung.
 *
 * Begehbarkeit (research/23 §0.2): die schnellste Bodenbewegung im Spiel ist Sprint-Springen in einem 2 hohen,
 * hindernisfreien Gang mit **9,732 Blöcken/s**; Gehen sind 4,317, Sprinten 5,612, Sprint-Springen auf freier Fläche
 * 7,127. Gesperrte Zellen (Treppe, Treppenloch, Geländer) zählen hier **nicht** als begehbar – die Zeit ist damit
 * eine Obergrenze.
 *
 * Geprüft wird außerdem: Erschließungsanteil (research/21 §0.6: 20–35 % sind normal) und kurze Treppenfolgen in
 * begehbaren Räumen (research/21 §0.5: eine Folge von weniger als drei Stufen ist unzulässig).
 *
 * Erreichbar (W12-E, Review R6-5) ist jeder Raum, der von **irgendeiner** Außentür aus über Türen und Treppen
 * erreichbar ist: draußen läuft man über Hof und Wege zwischen den Baukörpern. Eine freistehende Scheune mit eigenem
 * Tor ist damit erreichbar; „ohne Weg“ bleibt nur, was von keiner Außentür aus erreichbar ist (Raum ohne Tür, Etage
 * ohne Treppe). Diese eine Regel nutzen Editor-Hinweise, Exportdialog, `building_generate` und die Spielbarkeit.
 * Der Anwendungsdienst hängt den Bericht weiter an, ohne daraus Welt-Warnungen zu machen (`generateWith`).
 */
import type { Project, RoomShellInfo, Shell } from '@mcda/blueprint';
import type { Cell, HorizontalDir } from '@mcda/core';

/** Belegte Geschwindigkeiten (Blöcke/s, research/23 Tab. 3.2). */
export const SPEED = { walk: 4.317, sprint: 5.612, sprintJump: 7.127, sprintJumpHall: 9.732 } as const;

/** Räume, die im Alltag erreichbar sein müssen (research/23 §0.1). */
const STATION_TYPES: ReadonlySet<string> = new Set([
  'kitchen', 'storage', 'smithy', 'workshop_redstone', 'washroom', 'bathhouse', 'bedroom', 'infirmary', 'alchemy',
]);

export interface RoomTravel {
  readonly roomId: string;
  readonly roomTypeId: string | undefined;
  /** Begehbare Zellen (Innenfläche ohne gesperrte). */
  readonly walkable: number;
  /** Gesperrte Zellen (Treppe, Treppenloch, Geländer). */
  readonly blocked: number;
  /** Wegstrecke in Blöcken vom Eingang entlang der Türen (W12-E: ohne Weg vom Haupteingang ab der nächsten Außentür). */
  readonly distance: number;
  /** Laufzeit in Sekunden (Sprint-Sprung im 2 hohen Gang). */
  readonly seconds: number;
  /** Kein Weg von irgendeiner Außentür (z. B. Raum ohne Tür; W12-E: vorher nur vom Haupteingang). */
  readonly unreachable: boolean;
  /**
   * Additiv (W12-E): nur über eine eigene Außentür erreichbar, nicht über Türen vom Haupteingang (freistehende Scheune,
   * Nachbarhaus). Fehlt sonst.
   */
  readonly sideEntrance?: true;
  /** Dieser Raum ist eine Station des Alltags. */
  readonly station: boolean;
  readonly floorIndex: number;
  /** Flur-Raum (Erschließung). */
  readonly corridor: boolean;
  /** Höhenunterschied zum Eingangsraum in Blöcken (0 = stufenlos erreichbar, research/21 §0.5). */
  readonly levelDiff: number;
}

export interface CirculationReport {
  readonly rooms: readonly RoomTravel[];
  /** Eingangsraum (Raum mit der Haupttür) oder `undefined` ohne Außentür. */
  readonly entrance: string | undefined;
  readonly corridorCells: number;
  readonly totalCells: number;
  /** Anteil der Erschließung an der Innenfläche (research/21 §0.6). */
  readonly corridorShare: number;
  /** Stationen, die weiter als `slowSeconds` vom Eingang liegen. */
  readonly slow: readonly string[];
  /**
   * Stufenlose Erschließung (research/21 §0.5): wie viele Räume auf Eingangshöhe liegen, wie viele eine andere
   * Höhe haben und welche davon **keinen** Treppenzugang besitzen (dann wäre der Weg ein Sprung).
   */
  readonly stepless: { readonly sameLevel: number; readonly levelChanges: number; readonly upperWithoutStairs: readonly string[] };
  readonly unreachable: readonly string[];
  readonly warnings: readonly string[];
  /** Eingangs-/Windfang-Bericht (additiv, research/21 §2.4). */
  readonly entry: EntryAudit;
  /**
   * Stationsplan (additiv, research/23 §Q2): je Station die Wegzeit vom Eingang und die Wegzeit zum nächsten
   * Lager. Eine Station weit weg von den Truhen kostet bei jedem Crafting Laufzeit.
   */
  readonly stations: StationPlan;
}

/**
 * Eingangs-/Windfang-Bericht (research/21 §2.4, harte Regel R-W1): Ein Windfang funktioniert nur, wenn nie
 * beide Türen gleichzeitig offen sind. Im Blockraster heißt das: **zwei Türen dürfen nicht in derselben
 * Luftzelle stehen**, und die Tiefe in Türrichtung muss **≥ 2** Zellen betragen (sonst stoßen die Türblätter
 * zusammen). Geprüft wird nur, was die Hülle hergibt – gebaut wird noch kein Windfang (dafür fehlt die
 * Komponente, research/21 §13 U1).
 */
export interface EntryAudit {
  /** Eingangsraum (Raum mit der Haupttür). */
  readonly entryRoom: string | undefined;
  /** Zahl der Türen des Eingangsraums (Haupttür eingeschlossen). */
  readonly entryDoors: number;
  /** Türpaare desselben Raums, deren Blätter sich in dieselbe Luftzelle legen würden (Abstand ≤ 1). */
  readonly colliding: readonly { readonly a: Cell; readonly b: Cell; readonly gap: number }[];
  /** Kleinste gemessene Tiefe zwischen zwei Türen desselben Raums (0 = keine zweite Tür). */
  readonly shallowest: number;
  /**
   * Eingangsachse (research/21 §0.1 „Straße → … → Schwelle → Windfang → Flur“): Der Blick läuft von der
   * Haupttür gerade in den Raum hinein. `depth` = freie Zellen in dieser Richtung bis zur Wand, `throughDoor`
   * = auf derselben Achse liegt eine weitere Tür (die Achse führt weiter statt an einer Wand zu enden).
   */
  readonly axis: { readonly direction: HorizontalDir; readonly depth: number; readonly throughDoor: boolean };
  readonly warnings: readonly string[];
}

export interface StationPlan {
  /** Lager-Rollen, die als „nächste Truhe“ zählen. */
  readonly storageTypes: readonly string[];
  /** Wegzeit-Schwelle, ab der eine Station als weit gilt. */
  readonly limitSeconds: number;
  readonly entries: readonly {
    readonly roomId: string;
    readonly roomTypeId?: string;
    /** Sekunden vom Eingang (wie `RoomTravel.seconds`). */
    readonly seconds: number;
    /** Sekunden zum nächsten Lager; fehlt ohne Lagerraum im Projekt. */
    readonly storageSeconds?: number;
  }[];
  readonly warnings: readonly string[];
}

export interface CirculationOptions {
  /** Ab dieser Laufzeit gilt eine Station als weit (Standard 20 s). */
  readonly slowSeconds?: number;
  /** Flur-Rollen des Projekts (Standard `['hallway', 'corridor']`). */
  readonly corridorTypes?: readonly string[];
  /** Lager-Rollen für den Stationsplan (Standard `['storage', 'cellar', 'warehouse', 'granary']`). */
  readonly storageTypes?: readonly string[];
  /** Ab dieser Wegzeit zur nächsten Truhe gilt eine Station als weit (Standard 30 s, research/23 §Q2). */
  readonly stationSeconds?: number;
}

interface Link {
  readonly to: string;
  /** Zelle im eigenen Raum an der Tür. */
  readonly own: Cell;
  /** Zelle im Nachbarraum hinter der Schwelle. */
  readonly other: Cell;
  /** Treppe: Zusatzweg für den Höhenunterschied (Türen: 0, der Weg über die Schwelle ist `own` → `other`). */
  readonly cost?: number;
}

const OPPOSITE: Readonly<Record<HorizontalDir, HorizontalDir>> = { north: 'south', south: 'north', east: 'west', west: 'east' };

const manhattan = (a: Cell, b: Cell): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/**
 * Erschließungsbericht einer Hülle. `roomTypeId` liefert den Raumtyp je Raum-ID (aus dem Projekt); fehlt er, zählt
 * kein Raum als Station oder Flur.
 */
// Eingang/Windfang: Türen desselben Raums, die sich in dieselbe Luftzelle legen würden (Regel R-W1).
const axisOfDir = (d: HorizontalDir): 'x' | 'z' => (d === 'east' || d === 'west' ? 'x' : 'z');

/** Zwei Türinnenzellen als Flügel derselben Doppeltür (`partner` zeigt auf die andere). */
const samePair = (a: { readonly inside: Cell; readonly partner?: Cell }, b: { readonly inside: Cell; readonly partner?: Cell }): boolean =>
  (a.partner !== undefined && a.partner[0] === b.inside[0] && a.partner[1] === b.inside[1])
  || (b.partner !== undefined && b.partner[0] === a.inside[0] && b.partner[1] === a.inside[1]);

export function entryAuditOf(shell: Shell, entry?: string): EntryAudit {
  const main = entry ?? [...shell.rooms.values()].find((r) => r.doors.some((d) => d.isMain))?.roomId;
  const room = main === undefined ? undefined : shell.rooms.get(main);
  const doors = room?.doors ?? [];
  const colliding: { a: Cell; b: Cell; gap: number }[] = [];
  let shallowest = 0;
  for (let i = 0; i < doors.length; i++) {
    for (let j = i + 1; j < doors.length; j++) {
      const a = doors[i]!;
      const b = doors[j]!;
      // W8-B (27.09.2026): die zwei Flügel einer Doppeltür (W4-C `doubleDoor`, `partner`) sind EINE Öffnung – ihre Blätter
      // schlagen jedes in die eigene Zelle zur Laibung hin auf und nie ineinander; kein Windfang-Paar (vorher meldeten
      // Taverne und Burg in jeder Größe und jedem Seed „1 Türpaar … schlagen ineinander“)
      if (samePair(a, b)) continue;
      const gap = manhattan(a.inside, b.inside);
      if (gap > 0 && (shallowest === 0 || gap < shallowest)) shallowest = gap;
      // Gleiche Wandachse und höchstens eine Zelle Abstand → die Türblätter belegen dieselbe Zelle
      const sameAxis = axisOfDir(a.toward) === axisOfDir(b.toward);
      if (sameAxis && gap <= 1) colliding.push({ a: a.inside, b: b.inside, gap });
    }
  }
  // Eingangsachse: von der Haupttür gerade in den Raum hinein (Gegenrichtung der Türnormale)
  const mainDoor = doors.find((d) => d.isMain) ?? doors[0];
  const dir = mainDoor === undefined ? undefined : OPPOSITE[mainDoor.toward];
  const STEP: Readonly<Record<HorizontalDir, Cell>> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  let depth = 0;
  let throughDoor = false;
  if (mainDoor !== undefined && dir !== undefined && room !== undefined) {
    const [dx, dz] = STEP[dir];
    let [x, z] = mainDoor.inside;
    const axisCells = new Set<string>();
    for (;;) {
      x += dx;
      z += dz;
      if (!room.interior.has(x, z)) break;
      depth++;
      axisCells.add(`${x},${z}`);
    }
    throughDoor = doors.some((d) => d !== mainDoor && axisCells.has(`${d.inside[0]},${d.inside[1]}`));
  }
  const axis = { direction: dir ?? mainDoor?.toward ?? 'north', depth, throughDoor };
  const warnings: string[] = [];
  if (colliding.length > 0) {
    // Nutzersprache: „Türen schlagen ineinander“ statt „Türblätter in dieselbe Zelle“ – die Zahl bleibt für den Bericht
    const pairs = colliding.length === 1 ? 'Türpaar' : 'Türpaare';
    warnings.push(`${colliding.length} ${pairs} im Eingangsraum: die Türen schlagen ineinander (Windfang fehlt oder ist zu flach – mindestens 2 Zellen tief bauen)`);
  }
  return { entryRoom: main, entryDoors: doors.length, colliding, shallowest, axis, warnings };
}



export function circulation(
  shell: Shell,
  project: Project,
  opts: CirculationOptions = {},
): CirculationReport {
  const slowSeconds = opts.slowSeconds ?? 20;
  const corridorRoles = new Set(opts.corridorTypes ?? ['hallway', 'corridor']);
  const rooms = [...shell.rooms.values()];
  const typeOf = (id: string): string | undefined => project.state.rooms.find((r) => r.id === id)?.roomTypeId;
  const isCorridor = (r: RoomShellInfo): boolean => {
    const t = typeOf(r.roomId);
    return t !== undefined && corridorRoles.has(t);
  };

  // Türen koppeln: beide Räume haben an derselben Stelle eine Tür mit derselben Wandnormale (`toward` zeigt für
  // beide aus dem Raum heraus). Die Schwelle selbst ist Wand und gehört zu keinem der Räume; ihre Dicke schwankt.
  const axisOf = (d: HorizontalDir): 'x' | 'z' => (d === 'east' || d === 'west' ? 'x' : 'z');
  const links = new Map<string, Link[]>();
  /** W12-E: Räume mit Außentür → Innenzelle der ersten Außentür (Hüllen-Reihenfolge, deterministisch). */
  const outside = new Map<string, Cell>();
  for (const r of rooms) {
    for (const door of r.doors) {
      const axis = axisOf(door.toward);
      const i = axis === 'x' ? 0 : 1;
      const cross = 1 - i;
      let best: { room: RoomShellInfo; at: Cell; gap: number } | undefined;
      for (const other of rooms) {
        // Nur Türen derselben Etage: sonst koppelte eine OG-Tür an die EG-Tür darunter (gleiche x/z), und der
        // OG-Nachbar blieb „ohne Weg“ (Review 4)
        if (other.roomId === r.roomId || other.floorIndex !== r.floorIndex) continue;
        for (const d of other.doors) {
          // Beide Wandnormalen zeigen aus dem jeweiligen Raum heraus: bei gemeinsamer Wand in Gegenrichtung
          // (Ost/West), bei dicker Schwelle in dieselbe Richtung (ein Flur an einer dicken Innenwand).
          if (axisOf(d.toward) !== axis) continue;
          if (d.toward !== door.toward && d.toward !== OPPOSITE[door.toward]) continue;
          const gap = Math.abs(d.inside[i]! - door.inside[i]!);
          const offset = Math.abs(d.inside[cross]! - door.inside[cross]!);
          // Zwei Türen in derselben Wand: quer ein bis vier Zellen, entlang höchstens eine Türbreite
          if (gap < 1 || gap > 4 || offset > 2) continue;
          // W12-E (2026-09-28): die Gegentür liegt VOR der Tür (in Türrichtung), nie dahinter – sonst koppelte das
          // Außentor der Scheune (Ost) an die Innentür des Nachbarraums 4 Zellen westlich, und die Scheune galt als
          // ohne Außentür (Bauernhaus L)
          if (Math.sign(d.inside[i]! - door.inside[i]!) !== (door.toward === 'east' || door.toward === 'south' ? 1 : -1)) continue;
          if (best === undefined || gap < best.gap) best = { room: other, at: d.inside, gap };
        }
      }
      if (best === undefined) {
        // W12-E: keine Gegentür im selben Geschoss = Außentür (Haus- oder Nebeneingang eines Baukörpers)
        if (!outside.has(r.roomId)) outside.set(r.roomId, door.inside);
        continue;
      }
      const list = links.get(r.roomId);
      const link: Link = { to: best.room.roomId, own: door.inside, other: best.at };
      if (list === undefined) links.set(r.roomId, [link]);
      else list.push(link);
    }
  }
  // Treppen koppeln die Etagen: gleiche `linkId` mit Antritt (bottom) in einem und Austritt (top) im anderen Raum.
  // Ohne diese Kanten galt jeder Raum über oder unter dem Eingang als „ohne Weg“ – auch mit Treppe (Review 4).
  // Gewicht: Weg vom Antritt zum Austritt waagrecht plus je Block Höhenunterschied zwei Schritte (Stufe hoch + vor).
  for (const r of rooms) {
    for (const a of r.stairs ?? []) {
      for (const other of rooms) {
        if (other.roomId === r.roomId) continue;
        const b = (other.stairs ?? []).find((s) => s.linkId === a.linkId && s.end !== a.end);
        if (b === undefined) continue;
        const climb = 2 * Math.abs(other.baseY - r.baseY);
        const link: Link = { to: other.roomId, own: a.inside, other: b.inside, cost: climb };
        const list = links.get(r.roomId);
        if (list === undefined) links.set(r.roomId, [link]);
        else list.push(link);
      }
    }
  }

  // Kürzester Weg (Dijkstra; Kantengewicht = Weg im Raum + über die Schwelle) – einmal ab dem Eingang und
  // einmal ab allen Lagerräumen (Stationsplan, research/23: Werkstattnähe zu den Truhen).
  const shortestFrom = (sources: readonly string[], starts?: ReadonlyMap<string, Cell>): Map<string, number> => {
    const dist = new Map<string, number>();
    const entryAt = new Map<string, Cell>();
    for (const src of sources) {
      dist.set(src, 0);
      const at = starts?.get(src);
      if (at !== undefined) entryAt.set(src, at);
    }
    const pending = new Set(rooms.map((r) => r.roomId));
    while (pending.size > 0) {
      let best: string | undefined;
      let bestD = Infinity;
      for (const id of pending) {
        const d = dist.get(id);
        if (d !== undefined && d < bestD) [best, bestD] = [id, d];
      }
      if (best === undefined) break;
      pending.delete(best);
      for (const link of links.get(best) ?? []) {
        const entry = entryAt.get(best);
        const from = entry === undefined ? link.own : entry;
        const next = bestD + manhattan(from, link.own) + manhattan(link.own, link.other) + (link.cost ?? 0);
        if (next < (dist.get(link.to) ?? Infinity)) {
          dist.set(link.to, next);
          entryAt.set(link.to, link.other);
        }
      }
    }
    return dist;
  };
  const entrance = rooms.find((r) => r.doors.some((d) => d.isMain))?.roomId;
  const fromMain = entrance === undefined ? new Map<string, number>() : shortestFrom([entrance]);
  // W12-E (R6-5): Erreichbar ist, was von IRGENDEINER Außentür aus erreichbar ist – draußen läuft man über Hof und
  // Wege von Baukörper zu Baukörper (freistehende Scheune mit eigenem Tor, Nachbarhaus der Zeile). Räume ohne Weg
  // vom Haupteingang messen ihren Weg deshalb ab der nächsten eigenen Außentür; ohne jede Außentür bleiben sie
  // „ohne Weg“ (Raum ohne Tür, Etage ohne Treppe). Mit Weg vom Haupteingang bleibt alles wie vorher.
  const side = [...outside.keys()].filter((id) => !fromMain.has(id));
  const fromSide = side.length === 0 ? new Map<string, number>() : shortestFrom(side, outside);
  const distance = new Map<string, number>(fromMain);
  for (const [id, d] of fromSide) if (!distance.has(id)) distance.set(id, d);
  // Stationsplan: Wegzeit von jeder Station zum nächsten Lager (research/23 §Q2 „Wege zum Craften“)
  const storageRoles = new Set(opts.storageTypes ?? ['storage', 'cellar', 'warehouse', 'granary']);
  const storageRooms = rooms.filter((r) => {
    const t = typeOf(r.roomId);
    return t !== undefined && storageRoles.has(t);
  }).map((r) => r.roomId);
  const storageDistance = storageRooms.length === 0 ? undefined : shortestFrom(storageRooms);

  const baseYOfEntrance = entrance === undefined ? 0 : shell.rooms.get(entrance)?.baseY ?? 0;
  const travel: RoomTravel[] = rooms.map((r) => {
    const d = distance.get(r.roomId);
    const blocked = r.blocked?.size ?? 0;
    const roomTypeId = typeOf(r.roomId);
    return {
      roomId: r.roomId,
      roomTypeId,
      walkable: r.interior.size - blocked,
      blocked,
      distance: d ?? 0,
      seconds: d === undefined ? 0 : Math.round((d / SPEED.sprintJumpHall) * 10) / 10,
      unreachable: d === undefined,
      station: roomTypeId !== undefined && STATION_TYPES.has(roomTypeId),
      floorIndex: r.floorIndex,
      corridor: isCorridor(r),
      levelDiff: r.baseY - baseYOfEntrance,
      ...(d !== undefined && !fromMain.has(r.roomId) ? { sideEntrance: true as const } : {}),
    };
  });

  const totalCells = travel.reduce((s, t) => s + t.walkable, 0);
  const corridorCells = travel.reduce((s, t) => s + (t.corridor ? t.walkable : 0), 0);
  const unreachable = travel.filter((t) => t.unreachable && t.walkable > 0).map((t) => t.roomId);
  const slow = travel.filter((t) => t.station && !t.unreachable && t.seconds > slowSeconds).map((t) => t.roomId);
  const share = totalCells === 0 ? 0 : corridorCells / totalCells;

  const entry = entryAuditOf(shell, entrance);
  const warnings: string[] = [];
  // Texte in Nutzersprache; die Raum-IDs bleiben als maschinenlesbare Liste hinter dem Doppelpunkt stehen, damit die
  // App sie durch Anzeigenamen samt Etage ersetzen kann (siehe `@mcda/app` `ui/access.ts`).
  if (unreachable.length > 0) warnings.push(`Ohne Weg vom Eingang: ${unreachable.join(', ')}`);
  if (slow.length > 0) warnings.push(`Weit vom Eingang (> ${slowSeconds} s Laufweg): ${slow.join(', ')}`);
  if (share > 0.35) warnings.push(`${Math.round(share * 100)} % der Innenfläche sind Flure (über 35 %): das Haus ist vor allem Flur`);
  // Stufenlose Erschließung (research/21 §0.5, research/23 §Q1): Alles auf Eingangshöhe muss OHNE Treppe
  // erreichbar sein; jede Etage darüber braucht einen echten Treppenzugang (kein Sprung).
  const sameLevel = travel.filter((t) => t.levelDiff === 0 && t.walkable > 0 && !t.unreachable).length;
  // Nicht JEDER Raum einer Etage braucht eine Treppe – die ETAGE braucht eine. Deshalb je Höhenlage prüfen:
  // erst wenn keine einzige Raum dieser Lage einen Treppenzugang hat, ist sie nur per Sprung erreichbar.
  const perLevel = new Map<number, RoomShellInfo[]>();
  for (const r of rooms) perLevel.set(r.baseY, [...(perLevel.get(r.baseY) ?? []), r]);
  const upperWithoutStairs = [...perLevel.entries()]
    .filter(([y, rs]) => y !== baseYOfEntrance && rs.every((r) => (r.stairs ?? []).length === 0))
    .map(([, rs]) => rs.map((r) => r.roomId).join('+'));
  const stepless = { sameLevel, levelChanges: travel.filter((t) => t.levelDiff !== 0).length, upperWithoutStairs };
  // Stationsplan: jede Station (Werkstatt/Küche/Schmiede …) mit Wegzeit zum nächsten Lager
  const stationSeconds = opts.stationSeconds ?? 30;
  const toSeconds = (d: number | undefined): number => (d === undefined ? 0 : Math.round((d / SPEED.sprintJumpHall) * 10) / 10);
  const stations: StationPlan = {
    storageTypes: [...storageRoles],
    limitSeconds: stationSeconds,
    entries: rooms
      .filter((r) => {
        const t = typeOf(r.roomId);
        return t !== undefined && STATION_TYPES.has(t);
      })
      .flatMap((r): StationPlan['entries'][number][] => {
        const t = typeOf(r.roomId);
        return [{
          roomId: r.roomId,
          ...(t !== undefined ? { roomTypeId: t } : {}),
          seconds: toSeconds(distance.get(r.roomId)),
          ...(storageDistance !== undefined ? { storageSeconds: toSeconds(storageDistance.get(r.roomId)) } : {}),
        }];
      })
      .sort((a, b) => (b.storageSeconds ?? 0) - (a.storageSeconds ?? 0) || a.roomId.localeCompare(b.roomId)),
    warnings: [],
  };
  const weitWeg = stations.entries.filter((e) => e.storageSeconds !== undefined && e.storageSeconds > stationSeconds).map((e) => e.roomId);
  const stationsFinal: StationPlan = weitWeg.length === 0 ? stations : { ...stations, warnings: [`Weit von den Truhen (> ${stationSeconds} s Laufweg): ${weitWeg.join(', ')}`] };

  // Leitern haben keine Stufen und überwinden jede Etagenhöhe; unten sperren sie genau eine Zelle. Räume mit einem
  // Leiter-Zugang zählen deshalb nicht als „zu kurze Treppenfolge“ (Fehlalarm im Bergfried der Burg, Massing `tower`).
  const ladders = new Set(project.state.links.filter((l) => l.type === 'ladder').map((l) => l.id as string));
  // W4-B: die Leiter der Dachluke (`RoofDetail.hatch`, Zugang `hatch:<Baukörper>`) ist ebenso eine Leiter
  const viaLadder = (id: string): boolean => (shell.rooms.get(id)?.stairs ?? []).some((s) => ladders.has(s.linkId) || s.linkId.startsWith('hatch:'));
  const shortStairs = travel
    .filter((t) => t.blocked > 0 && t.blocked <= 2 && !t.corridor && !viaLadder(t.roomId))
    .map((t) => t.roomId);
  if (shortStairs.length > 0) {
    // Nutzersprache: die App hängt den Raumnamen an („Treppe in „Küche · 2 (EG)“ ist zu kurz …“)
    warnings.push(`Treppe zu kurz für eine Etage (1–2 gesperrte Zellen): ${shortStairs.join(', ')}`);
  }
  if (upperWithoutStairs.length > 0) {
    // Je Höhenlage eine Gruppe (Räume mit „+“ verbunden). Die Pipeline kennt keine Etagennamen (EG, 1. OG – das
    // ist Sache der App); die App ersetzt die IDs und stellt den Etagennamen voran.
    warnings.push(`Etage ohne Treppenzugang (nur über einen Sprung erreichbar): ${upperWithoutStairs.join(', ')}`);
  }

  return {
    rooms: travel,
    entrance,
    entry,
    corridorCells,
    totalCells,
    corridorShare: Math.round(share * 1000) / 1000,
    slow,
    unreachable,
    stepless,
    stations: stationsFinal,
    warnings,
  };
}
