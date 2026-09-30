/**
 * Prüfen (research/19 §7.3 Schritt 6): Der Plan wird genau so übernommen, wie es der Anwendungsdienst tut
 * (`Project.create` + `applyBuildingType`), und die Hülle abgeleitet. Hart: jede Treppe gesetzt, jeder Raum gemalt,
 * Hülle ohne Warnung, alle Räume über Türen und Treppen erreichbar, begehbare Fläche je Raum zusammenhängend und
 * mindestens so groß wie verlangt. Weich (ADR 11: Hinweis): Silhouette-Werte aus research/19 §9.1.
 */
import {
  DEFAULT_VOLUME, Project, TARGET_VERSIONS, deriveShell, type BuildingTypeDraft, type BuildingTypeOrigin, type FacadeGridLine, type ProjectEvent, type RoomShellInfo, type Shell,
  type ShellOptions,
} from '@mcda/blueprint';
import type { BuildingChecksDef } from '@mcda/catalog';
import type { HorizontalDir } from '@mcda/core';
import { facadeMeasures, type FacadeMeasures } from './facade-measures.js';
import type { BuildingPlan, PlanShell, QualityValue } from './plan.js';

/** Plan → Entwurf für `Project.applyBuildingType` (lokale Baukörper-Schlüssel = Plan-IDs). */
export function planDraft(plan: Pick<BuildingPlan, 'floors' | 'volumes' | 'rooms' | 'stairs'>, origin: BuildingTypeOrigin): BuildingTypeDraft {
  return {
    origin,
    floors: Object.fromEntries(plan.floors.map((f) => [f.index, f.height])),
    volumes: plan.volumes.map(({ id, ...props }) => ({ key: id, ...props })),
    rooms: plan.rooms.map((r) => ({
      floorIndex: r.floor, cells: r.cells, roomTypeId: r.roomTypeId, ...(r.volumeId !== DEFAULT_VOLUME ? { volume: r.volumeId } : {}),
    })),
    stairs: plan.stairs.map((s) => ({ floorIndex: s.floor, origin: s.origin, facing: s.facing, type: s.type, ...(s.turn !== undefined ? { turn: s.turn } : {}) })),
  };
}

/** Hüllen-Optionen des Plans (wie `shellFor` im Anwendungsdienst). */
export function planShellOptions(shell: PlanShell, corridorTypes?: readonly string[]): ShellOptions {
  return {
    roof: shell.roof,
    overhang: shell.overhang,
    windows: shell.windows,
    ...(shell.roofDetail !== undefined ? { roofDetail: shell.roofDetail } : {}),
    ...(shell.dormers !== undefined ? { dormers: shell.dormers } : {}),
    ...(shell.facade !== undefined ? { facade: shell.facade } : {}),
    ...(corridorTypes !== undefined ? { corridorTypes } : {}),
  };
}

const STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Räume, die vom Haupteingang (bzw. von Nebeneingängen) über Türen je Etage und Treppen erreichbar sind. */
export function reachableRooms(shell: Shell): Set<string> {
  const doors = new Map<string, string[]>();
  const groups = new Map<string, string[]>();
  for (const [id, r] of shell.rooms) {
    for (const d of r.doors) {
      const k = `${r.floorIndex}:${d.inside[0] + STEP[d.toward][0]},${d.inside[1] + STEP[d.toward][1]}`;
      doors.set(k, [...(doors.get(k) ?? []), id]);
    }
    for (const s of r.stairs ?? []) groups.set(s.linkId, [...(groups.get(s.linkId) ?? []), id]);
  }
  // Außentür = Türzelle mit nur einem Raum (Haus- oder Nebeneingang)
  const seen = new Set<string>([...doors.values()].filter((g) => g.length === 1).map((g) => g[0]!));
  for (const [k, g] of doors) groups.set(k, g);
  for (let grew = true; grew;) {
    grew = false;
    for (const g of groups.values()) if (g.some((r) => seen.has(r))) for (const r of g) if (!seen.has(r)) (seen.add(r), (grew = true));
  }
  return seen;
}

export interface PlanCheck {
  readonly problems: string[];
  readonly shell?: Shell;
  /** W6 (nur mit Feldbreite `bay`): Räume über der Erde ohne Fenster, die eins brauchen (wie `windowlessRooms`). */
  readonly windowless?: number;
}

/** W6: Hüllen-Optionen des Plans mit der Feldbreite `bay` des Rasters (sofern die Regeln ein Raster verlangen). */
function withBay(plan: BuildingPlan, bay: number | undefined): ShellOptions {
  const facade = plan.shell.facade;
  const shell = bay === undefined || facade?.rules === undefined ? plan.shell : { ...plan.shell, facade: { ...facade, rules: { ...facade.rules, bay } } };
  return planShellOptions(shell, plan.corridorTypes);
}

/** W6: Räume über der Erde ohne Fenster in `shell`, die eins brauchen (nicht Lager, Bad, Flur-Rollen des Plans). */
function countWindowless(plan: BuildingPlan, shell: Shell, typeOf: ReadonlyMap<string, string>): number {
  const skip = new Set([...WINDOW_OPTIONAL, ...(plan.corridorTypes ?? [])]);
  return [...shell.rooms.values()].filter((r) => r.floorIndex >= 0 && !skip.has(typeOf.get(r.roomId) ?? '') && r.windows.length === 0).length;
}

/**
 * W8-E: Pflicht-Einträge (Tags) eines Raumtyps, die in diesem Raum der Probe-Hülle schon leer keinen Platz haben (leer =
 * einrichtbar). Die Pipeline gibt dafür den Einrichtungs-Solver (`requiredWithoutPose`, @mcda/furnishing).
 */
export type ArchetypeFurnishable = (roomTypeId: string, room: RoomShellInfo) => readonly string[];

/**
 * Übernimmt den Plan in ein Probe-Projekt (Seed wie das echte Projekt: Türen und Wände hängen am Seed) und prüft ihn.
 * `minArea(i)`: verlangte Innenfläche des i-ten Plan-Raums. W6: `bay` = Feldbreite des Fassadenrasters der echten Hülle
 * (aus dem Theme); ohne sie prüft die Hülle mit dem Standard-Raster wie bisher. W8-E: `furnishable` (optional) meldet
 * Pflichtobjekte ohne Platz im leeren Raum; ohne die Funktion wie bisher.
 */
export function checkPlan(
  plan: BuildingPlan, minArea: (roomIndex: number) => number, bay?: number, furnishable?: ArchetypeFurnishable,
): PlanCheck {
  const problems: string[] = [];
  const p = Project.create({
    id: 'probe', name: plan.name, seed: plan.seed, themeId: 'probe', targetVersion: TARGET_VERSIONS['1.21.11'],
    floor: { y0: 0, height: plan.floors.find((f) => f.index === 0)?.height ?? 3 },
  });
  let events: readonly ProjectEvent[];
  try {
    const applied = p.applyBuildingType(planDraft(plan, { buildingTypeId: plan.typeId, params: {}, seed: plan.seed, rerollCount: 0 }))[0];
    events = applied?.type === 'BuildingTypeApplied' ? applied.events : [];
  } catch (e) {
    return { problems: [`Plan nicht übernehmbar: ${(e as Error).message}`] };
  }
  const painted = events.filter((e) => e.type === 'RoomPainted').map((e) => (e.type === 'RoomPainted' ? e.roomId : ''));
  const placed = events.filter((e) => e.type === 'StairsPlaced').length;
  if (painted.length !== plan.rooms.length) problems.push(`${plan.rooms.length} Räume geplant, ${painted.length} gemalt (Überschneidung oder zerfallen)`);
  if (placed !== plan.stairs.length) problems.push(`${plan.stairs.length - placed} Treppe(n) passen nicht`);
  const shell = deriveShell(p.state, withBay(plan, bay));
  // Nebeneingang eines eigenen Baukörpers (Scheune, Nachbarhaus der Zeile) ist gewollt
  const own = new Set(painted.filter((_, i) => plan.rooms[i]?.volumeId !== DEFAULT_VOLUME));
  const sideDoor = (w: string): boolean => /eigener Nebeneingang/.test(w) && own.has(/Raum (r\d+)/.exec(w)?.[1] ?? '');
  problems.push(...shell.warnings.filter((w) => !sideDoor(w)).map((w) => `Hülle: ${w}`));
  const reach = reachableRooms(shell);
  if (painted.length === plan.rooms.length) {
    for (const [i, id] of painted.entries()) {
      const room = plan.rooms[i]!;
      const info = shell.rooms.get(id);
      if (info === undefined) {
        problems.push(`${room.roomTypeId} (Etage ${room.floor}): keine Hülle`);
        continue;
      }
      if (!reach.has(id)) problems.push(`${room.roomTypeId} (Etage ${room.floor}) nicht erreichbar`);
      const walk = info.blocked === undefined ? info.interior : info.interior.difference(info.blocked);
      if (!walk.isConnected()) problems.push(`${room.roomTypeId} (Etage ${room.floor}): begehbare Fläche zerfällt`);
      if (walk.size < minArea(i)) problems.push(`${room.roomTypeId} (Etage ${room.floor}): ${walk.size} < ${minArea(i)} Zellen`);
      // W8-E: Pflichtobjekt ohne jede Pose im leeren Raum (Raum nur Durchgang, Treppe nimmt die Wände) – der Solver
      // könnte es nie setzen; ein anderer Versuch des Planers bekommt die Chance
      else if (furnishable !== undefined) {
        const missing = furnishable(room.roomTypeId, info);
        if (missing.length > 0) problems.push(`${room.roomTypeId} (Etage ${room.floor}): kein Platz für Pflichtobjekt ${missing.join(', ')}`);
      }
    }
  }
  if (bay === undefined) return { problems, shell };
  return { problems, shell, windowless: countWindowless(plan, shell, new Map(p.state.rooms.map((r) => [r.id, r.roomTypeId] as const))) };
}

/**
 * W6: Rasterlinien der Außenwände ohne Trennwände (`Shell.facadeGrid`): je Baukörper und Etage ein Raum über die ganze
 * Grundfläche, Hülle mit Flachdach und nur der Raster-Regel (Feldbreite `bay`, Fensterabstand `spacing` wie im Plan). Das
 * Raster hängt nur an den Außenwänden – so kennt der Planer vor der Teilung die Pfosten und Achsen der echten Hülle, auch
 * wo ein Anbau, ein Bergfried oder das Nachbarhaus der Zeile die Linie verkürzt. Leer, wenn die Baukörper nicht passen.
 */
export function massingGrid(
  plan: Pick<BuildingPlan, 'typeId' | 'name' | 'seed' | 'floors' | 'volumes' | 'rooms'>, bay: number, spacing: number | undefined,
): readonly FacadeGridLine[] {
  const p = Project.create({
    id: 'probe', name: plan.name, seed: plan.seed, themeId: 'probe', targetVersion: TARGET_VERSIONS['1.21.11'],
    floor: { y0: 0, height: plan.floors.find((f) => f.index === 0)?.height ?? 3 },
  });
  try {
    p.applyBuildingType(planDraft({ ...plan, stairs: [] }, { buildingTypeId: plan.typeId, params: {}, seed: plan.seed, rerollCount: 0 }));
  } catch {
    return [];
  }
  const shell = deriveShell(p.state, { roof: 'flat', overhang: 0, windows: spacing !== undefined ? { spacing } : {}, facade: { rules: { grid: true, bay } } });
  return shell.facadeGrid ?? [];
}

/** W5: Räume, die ohne Fenster auskommen (Flur-Rollen kommen aus `plan.corridorTypes`). */
export const WINDOW_OPTIONAL: ReadonlySet<string> = new Set(['storage', 'washroom', 'wine_cellar', 'stable', 'attic', 'hallway', 'corridor', 'gallery']);

/**
 * W5 (27.09.2026, Review N8): Räume über der Erde ohne Fenster in der Hülle des Plans mit Feldbreite `bay` (Fenster nur
 * auf Feldachsen, F2). Für Bautypen mit gerader Front (`evenFront`): gerade Linien haben weniger, breitere Felder, schmale
 * Obergeschoss-Räume bekommen dann leicht keine Achse – der Planer wählt unter seinen Versuchen den mit den wenigsten.
 */
export function windowlessRooms(plan: BuildingPlan, bay: number): number {
  const p = Project.create({
    id: 'probe', name: plan.name, seed: plan.seed, themeId: 'probe', targetVersion: TARGET_VERSIONS['1.21.11'],
    floor: { y0: 0, height: plan.floors.find((f) => f.index === 0)?.height ?? 3 },
  });
  try {
    p.applyBuildingType(planDraft(plan, { buildingTypeId: plan.typeId, params: {}, seed: plan.seed, rerollCount: 0 }));
  } catch {
    return 0;
  }
  const shell = deriveShell(p.state, withBay(plan, bay));
  return countWindowless(plan, shell, new Map(p.state.rooms.map((r) => [r.id, r.roomTypeId] as const)));
}

const FACADE_IDS = ['articulationPlan', 'articulationFront', 'facadeSymmetry', 'facadeEntropy'] as const satisfies readonly QualityValue['id'][];
const pick = (m: FacadeMeasures): Record<(typeof FACADE_IDS)[number], number> =>
  ({ articulationPlan: m.articulationPlan, articulationFront: m.articulationFront, facadeSymmetry: m.facadeSymmetry, facadeEntropy: m.facadeEntropy });

/** MX-Q: Fassaden- und Umrissmaße eines Plans (Grundriss ab Erdgeschoss, Front aus den Parametern) an seiner Hülle. */
export function planFacadeMeasures(plan: Pick<BuildingPlan, 'rooms' | 'params'>, shell: Pick<Shell, 'cells' | 'rooms'> | undefined): FacadeMeasures {
  const footprint = plan.rooms.filter((r) => r.floor >= 0).flatMap((r) => r.cells.toArray());
  return facadeMeasures(shell ?? { cells: [], rooms: new Map() }, footprint, plan.params.front);
}

/** Silhouette-Werte (research/19 §9.1) aus Plan und Hülle; nur die, die der Bautyp prüft. */
export function silhouette(
  plan: BuildingPlan, shell: Shell | undefined, checks: BuildingChecksDef | undefined, body?: Pick<BuildingPlan, 'rooms'>,
): QualityValue[] {
  if (checks === undefined) return [];
  // W9-G1: Seitenverhältnis und Breite am Baukörper ohne Akzente (`body`: Räume vor Auskragung und Quergiebel) – ein
  // Vorsprung vor der Front ist Gliederung, keine Proportion des Hauses
  const main = (body ?? plan).rooms.filter((r) => r.volumeId === DEFAULT_VOLUME && r.floor >= 0).reduce((b, r) => {
    const rb = r.cells.bounds()!;
    return { minX: Math.min(b.minX, rb.minX), minZ: Math.min(b.minZ, rb.minZ), maxX: Math.max(b.maxX, rb.maxX), maxZ: Math.max(b.maxZ, rb.maxZ) };
  }, { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity });
  const w = main.maxX - main.minX + 1;
  const d = main.maxZ - main.minZ + 1;
  const front = plan.params.front === 'north' || plan.params.front === 'south' ? w : d;
  const upper = plan.floors.filter((f) => f.index >= 0);
  const eave = upper.reduce((y, f) => y + f.height + 1, 0);
  const top = shell === undefined || shell.cells.length === 0 ? eave : Math.max(...shell.cells.map((c) => c.pos[1]));
  // Ensemble: Oberkante des höchsten Teils zu Oberkante des Hauptbaukörpers (je über den eigenen Spalten)
  // (Spalten neben einem Teil zählen nicht zum Hauptbaukörper: dort liegen Gesims und Brandwand des Teils)
  const partIds = new Set((plan.parts ?? []).map((p) => p.volumeId));
  const partCols = new Set(plan.rooms.filter((r) => partIds.has(r.volumeId)).flatMap((r) => r.cells.toArray().flatMap(([x, z]) =>
    [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => `${x + dx},${z + dz}`)))));
  /**
   * Fassaden-Schmuck zählt nicht zur Silhouette (Q2, research/58 §Q2): Fensterrahmen (Q2 Hebel 2) und Wandvorlagen
   * (Q2 Hebel 4) sind Oberflächen-Detail in Außenluft, keine Masse. Ohne den Filter misst die Silhouette der Burg den
   * Rahmen des obersten Turmfensters bzw. den Kopf der Pflicht-Wandvorlage als „Oberkante des Hauptbaukörpers“ und
   * der Bergfried überragt den Palas nur noch rechnerisch um 0–4 % (optisch unverändert). Die strukturtragenden
   * Rollen (`roof_trim`, `wall_cornice`, `ceiling`) bleiben gezählt.
   */
  const SURFACE_ROLES: ReadonlySet<string> = new Set(['window_frame', 'beam']);
  const topOver = (vol: (id: string) => boolean, skip: ReadonlySet<string> = new Set()): number => {
    const cols = new Set(plan.rooms.filter((r) => vol(r.volumeId)).flatMap((r) => r.cells.toArray().map(([x, z]) => `${x},${z}`)).filter((k) => !skip.has(k)));
    return (shell?.cells ?? []).reduce((y, c) => (cols.has(`${c.pos[0]},${c.pos[2]}`) && !SURFACE_ROLES.has(c.role) ? Math.max(y, c.pos[1]) : y), 0);
  };
  const values: Record<QualityValue['id'], number> = {
    ratio: Math.max(w, d) / Math.min(w, d),
    heightToWidth: top / Math.min(w, d),
    roofToEave: Math.max(0, top - eave) / eave,
    width: front,
    floors: upper.length,
    partOverMain: checks.partOverMain === undefined || partIds.size === 0 ? 0 : topOver((v) => partIds.has(v)) / Math.max(1, topOver((v) => v === DEFAULT_VOLUME, partCols)),
    // Silhouette (research/20 §0.9): Zahl der Baukörper und das Überragen des Hauptbaukörpers durch den höchsten Teil
    massCount: new Set([DEFAULT_VOLUME, ...plan.rooms.map((r) => r.volumeId)]).size,
    focusOverMain: checks.focusOverMain === undefined ? 0 : topOver((v) => v !== DEFAULT_VOLUME) / Math.max(1, topOver((v) => v === DEFAULT_VOLUME)),
    articulationPlan: 0, articulationFront: 0, facadeSymmetry: 0, facadeEntropy: 0,
  };
  // MX-Q (DR2 §4 Nr. 1): nur messen, wenn der Bautyp einen der Werte verlangt (ohne Angabe bitgleich und ohne Kosten)
  if (FACADE_IDS.some((id) => checks[id] !== undefined)) Object.assign(values, pick(planFacadeMeasures(plan, shell)));
  return (Object.keys(checks) as QualityValue['id'][]).map((id) => {
    const range = checks[id]!;
    const value = Math.round(values[id] * 100) / 100;
    return { id, value, range, ok: value >= range[0] && value <= range[1] };
  });
}
