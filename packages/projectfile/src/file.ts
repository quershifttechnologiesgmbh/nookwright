/**
 * Projektdatei der App (`.projekt.json`, Format `basen-projekt`): Event-Historie plus Einstellungen und Umgebung.
 * Published Language zwischen App und Engine-API (C1) – beide lesen und schreiben sie mit diesem Code.
 *
 * Format `ProjectFile` v2: `{ format, version, savedAt, name, roof, overhang, windows, roofDetail, dormers, facade, exterior, density, history }`.
 * v1 (`{ …, roof, history }`, ohne Etagen-/Treppen-Events) lädt weiter; fehlende Einstellungen = Standard.
 * `roofDetail`/`dormers`/`facade`/`exterior` sind additiv (ohne Versionssprung): Fehlen sie, lädt das Projekt mit
 * schlichtem Dach, ohne Gauben, ohne Außenprofil und ohne Außen-Deko – so, wie es gespeichert wurde (nicht mit der
 * Voreinstellung neuer Projekte). Ein ungültiges Feld fällt einzeln auf seinen schlichten Wert zurück.
 * `corridorTypes` (Flur-Rollen eines Bautyps) und die Baukörper-/Bautyp-Events (`VolumeAdded` …, `BuildingTypeApplied`
 * mit eingebetteten Events) sind additiv; ältere Apps lehnen solche Dateien mit „Event unbekannt“ ab statt sie falsch zu laden.
 * `StoryStateChanged` (Q5/P15, Nutzungszustand) ist ebenso additiv: Fehlt es, lädt das Projekt ohne Zustand und ist
 * damit bitgleich zu vorher.
 * `blockRules` (W3-BL, gesperrte Blöcke und feste Ersetzungen, Preset „Nur leicht farmbar“) ist additiv: Es steht nur in
 * der Datei, wenn etwas gesperrt ist; ältere Apps ignorieren das Feld (sie bauen dann ohne Sperren). Gelesen wird
 * tolerant: ungültige Einträge fallen einzeln heraus.
 * `minAisle` (P07, verbindlicher Mittelgang) ist additiv: Es steht nur in der Datei, wenn es eingeschaltet ist;
 * fehlt es, wird ohne die Option eingerichtet und das Ergebnis ist bitgleich zu vorher.
 * `surroundings` (Gelände-Historie, Bauwerke) ist ebenfalls additiv: Dateien ohne Umgebung laden ohne; beschädigte
 * Teile der Umgebung fallen mit Hinweis heraus, das Projekt lädt trotzdem.
 * Der Zustand entsteht beim Laden per Replay (`Project.fromHistory`); Undo-Stapel, Einrichtungs-Hinweise und
 * Qualitätswerte werden nicht gespeichert.
 */
import { DomainError, Project, TARGET_VERSIONS, type ProjectEvent, type ProjectEventType, type ProjectState, type RoofStyle, type RoomId } from '@mcda/blueprint';
import type { Catalog, ThemeCatalog } from '@mcda/catalog';
import { BLOCK_RULE_PRESETS, normalizeBlockRules, type BlockRules } from '@mcda/pipeline';
import {
  DEFAULT_OVERHANG, DEFAULT_ROOF, DEFAULT_WINDOWS, DENSITY_RANGE, OVERHANG_RANGE, PLAIN_DORMERS, PLAIN_EXTERIOR, PLAIN_FACADE, PLAIN_ROOF_DETAIL, ROOF_OPTIONS,
  WINDOW_SPACING_RANGE, dormerProblem, exteriorProblem, facadeProblem, roofDetailProblem, type DormerChoice, type ExteriorChoice,
  type FacadeChoice, type RoofDetailChoice, type SessionSettings, type WindowChoice,
} from './settings.js';
import { readSurroundings, type SurroundingsState } from './surroundings.js';

export const PROJECT_FILE_FORMAT = 'basen-projekt';
/** v2: Etagen, Treppen, Wandhöhe, Umbenennen als Event; Dachüberstand, Fenster, Dichte je Raum. */
export const PROJECT_FILE_VERSION = 2;
export const PROJECT_FILE_EXT = '.projekt.json';

export interface ProjectFile {
  readonly format: typeof PROJECT_FILE_FORMAT;
  readonly version: typeof PROJECT_FILE_VERSION;
  /** ISO-Zeitpunkt */
  readonly savedAt: string;
  /** Projektname (steht auch im ersten Event; hier für die Anzeige ohne Replay). */
  readonly name: string;
  readonly roof: RoofStyle;
  readonly overhang: number;
  readonly windows: WindowChoice;
  /** Dach-Details (Neigung, Kanten, Ortgang, Glockenfuß, Giebelfenster, Walm-Reihen, Knick); additiv in v2. */
  readonly roofDetail: RoofDetailChoice;
  /** Gauben (Art, Breite, Mindestabstand); additiv in v2, fehlt = keine. */
  readonly dormers: DormerChoice;
  /** Außenprofil (Sockel, Gesims, Eckquader, Wandvorlagen, Konsolen); additiv in v2. */
  readonly facade: FacadeChoice;
  /** Außen-Deko (an/aus, Gruppen, Dichte, Variante); additiv in v2. */
  readonly exterior: ExteriorChoice;
  /** Flur-Rollen des Bautyps (Haustür, Türen); additiv, fehlt = Standard der Hülle. */
  readonly corridorTypes?: readonly string[];
  /** Feature Unterbau: Zusatztüren für Rundgänge (0–1); additiv, fehlt = Türbaum wie bisher. */
  readonly loopDoors?: number;
  /** WS-Fassade: Fassadenrhythmus (Fensterachsen im Takt, Gauben auf leeren Dachflächen); additiv, fehlt = aus. */
  readonly facadeRhythm?: true;
  /** Einrichtungsdichte je Raum (nur Abweichungen vom Standard 1). */
  readonly density: Readonly<Record<RoomId, number>>;
  /** P07: verbindlicher Mittelgang; additiv, fehlt = aus (bitgleich). */
  readonly minAisle?: boolean;
  /** W3-BL: gesperrte Blöcke (sortiert), feste Ersetzungen, Preset; additiv, fehlt = keine Sperren (bitgleich). */
  readonly blockRules?: BlockRules;
  /** Umgebung: Gelände (Event-Historie des Aggregats `Site`), Bauwerke, Rand, Vegetation; additiv, fehlt = keine. */
  readonly surroundings?: SurroundingsState;
  readonly history: readonly ProjectEvent[];
}

/** Alle Event-Typen, die diese Version lesen kann (unbekannte → Fehler statt stillem Verlust). */
const EVENT_TYPES: ReadonlySet<ProjectEventType> = new Set<ProjectEventType>([
  'ProjectCreated', 'RoomPainted', 'RoomCellsLost', 'RoomSplit', 'RoomRemoved', 'RoomTypeAssigned', 'RoomRerolled',
  'RoomFurnished', 'FurnishingSupplemented', 'PlacementAdded', 'PlacementMoved', 'PlacementRemoved', 'PlacementLocked',
  'PlacementUnlocked', 'ThemeChanged', 'TargetVersionChanged',
  // v2: Umbenennen, Etagen, Wandhöhe, Treppen
  'ProjectRenamed', 'FloorAdded', 'FloorRemoved', 'FloorHeightChanged', 'StairsPlaced', 'StairsRemoved',
  // additiv: Baukörper und Bautypen (V0, A0); die beiden Bautyp-Events enthalten Events (rekursiv geprüft)
  'VolumeAdded', 'VolumeChanged', 'VolumeRemoved', 'RoomVolumeAssigned', 'RoomOriginSet', 'BuildingTypeApplied', 'BuildingTypeRerolled',
  // additiv (Q5/P15): Nutzungszustand; ältere Apps lehnen solche Dateien mit „Event unbekannt" ab
  'StoryStateChanged',
  // additiv (feat/theme-moods): Stimmung; ältere Apps lehnen solche Dateien mit „Event unbekannt" ab
  'MoodChanged',
  // additiv (feat/int-decor): Innen-Deko-Stufe (Deko-Pass nach der Einrichtung)
  'InteriorDecorChanged',
  // additiv (W13-G): Paletten-Überschreibungen (Familie je Rollengruppe, Familien-Tausch)
  'PaletteOverridesChanged',
  // additiv (W2-ED U4): Raum vergrößern (behält ID) und fixieren
  'RoomCellsGained', 'RoomFixed',
  // additiv (W2-ED U5): Möbel tauschen / Variante wechseln
  'PlacementSwapped',
  // additiv (F Bereich neu einrichten): Teilbereich eines Raums neu eingerichtet, der Rest bleibt
  'RoomBlockRefurnished',
]);
const NESTING: ReadonlySet<ProjectEventType> = new Set<ProjectEventType>(['BuildingTypeApplied', 'BuildingTypeRerolled']);

/** Unbekannter Event-Typ (auch in eingebetteten Events) → Beschreibung, sonst `undefined`. */
function unknownEvent(e: unknown, where: string): string | undefined {
  if (!isObject(e) || typeof e['type'] !== 'string' || !EVENT_TYPES.has(e['type'] as ProjectEventType)) return `${where} (${isObject(e) ? String(e['type']) : typeof e})`;
  if (!NESTING.has(e['type'] as ProjectEventType)) return undefined;
  const inner = e['events'];
  if (!Array.isArray(inner)) return `${where} (${e['type']} ohne Events)`;
  for (const [j, x] of inner.entries()) {
    const bad = unknownEvent(x, `${where}.${j}`);
    if (bad !== undefined) return bad;
  }
  return undefined;
}

/** Inhalt einer Projektdatei: Aggregat, Einstellungen außerhalb der Historie, Umgebung. */
export interface ProjectContent {
  readonly project: Project;
  readonly settings: FileSettings;
  readonly surroundings?: SurroundingsState | undefined;
}

/** Einstellungen, die in der Datei stehen (ohne abgeleitete Türme). */
export type FileSettings = Omit<SessionSettings, 'towers'>;

export function toProjectFile(c: ProjectContent, savedAt: Date = new Date()): ProjectFile {
  const settings = c.settings;
  return {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    savedAt: savedAt.toISOString(),
    name: c.project.state.name,
    roof: settings.roof,
    overhang: settings.overhang,
    windows: settings.windows,
    roofDetail: settings.roofDetail,
    dormers: settings.dormers,
    facade: settings.facade,
    exterior: settings.exterior,
    ...(settings.corridorTypes !== undefined ? { corridorTypes: settings.corridorTypes } : {}),
    ...(settings.loopDoors !== undefined ? { loopDoors: settings.loopDoors } : {}),
    ...(settings.facadeRhythm === true ? { facadeRhythm: true } : {}),
    density: Object.fromEntries(settings.density),
    ...(settings.minAisle === true ? { minAisle: true } : {}),
    ...(normalizeBlockRules(settings.blockRules) !== undefined ? { blockRules: normalizeBlockRules(settings.blockRules)! } : {}),
    ...(c.surroundings !== undefined ? { surroundings: c.surroundings } : {}),
    history: c.project.history,
  };
}

/** Gelesene Datei: Inhalt samt Anzeige-Angaben und Hinweisen, oder der Grund, warum sie nicht lädt. */
export type ReadResult =
  | (ProjectContent & { readonly ok: true; readonly name: string; readonly savedAt: string | undefined; readonly warnings: readonly string[] })
  | { readonly ok: false; readonly error: string };

/** Verweise für Hinweise auf unbekannte Raumtypen, Komponenten und Themes. */
export interface FileRefs {
  readonly catalog?: Catalog | undefined;
  readonly themes?: ThemeCatalog | undefined;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * JSON-Text → Sitzung. Prüft Format, Version und Event-Typen und spielt die Historie ab.
 * Mit Katalog/Themes: Hinweise auf unbekannte Raumtypen, Komponenten und Themes (das Projekt lädt trotzdem).
 */
/**
 * Grenzen wie in der Oberfläche (Review 3): Wandhöhe 2–16, Koordinaten im Rasterbereich, begrenzte Raumfläche,
 * eindeutige Raum-IDs. Bewusst grob und schnell – eine Datei soll den Tab nicht einfrieren können.
 */
export const FILE_LIMITS = {
  /** Wie die Oberfläche: lichte Höhe je Etage. */
  minHeight: 2,
  maxHeight: 16,
  /** Zellen je Raum (Oberfläche: 40×30 = 1 200; großzügige Reserve für importierte Grundrisse). */
  maxRoomCells: 4_000,
  /** Zellen im ganzen Projekt. */
  maxTotalCells: 20_000,
  /** Koordinaten (wie das Raster: ±4 096 lässt Exporte handhabbar). */
  maxCoord: 4_096,
  maxFloors: 32,
  /**
   * Ausdehnung aller Räume (x bzw. z, Red-Team-Review): zwei Zellen bei −2000 und +3000 lagen im Koordinaten-
   * bereich, ergaben aber einen 5003 × 6 × 5003-Export (94 MB entpackt für 56 Blöcke). Oberfläche 40 × 30,
   * Bautypen bis gut 35 – 256 lässt viel Reserve.
   */
  maxSpan: 256,
  /**
   * Zellen einer **Wehrplatte im Altformat** (Auftrag BT01/2): Neu gespeicherte Platten sind an ihren Baukörper
   * gebunden und tragen keine Zellen mehr. Eine Datei mit 2 Mio. Zellen wurde vorher ungeprüft geladen; die
   * Platte eines 11 × 11-Bergfrieds hat 121.
   */
  maxParapetCells: 4_000,
} as const;

/** Erste verletzte Grenze als Klartext oder `undefined`. */
/** Ausdehnung aller Raumzellen in x und z (Blöcke); `undefined` ohne Räume. */
function roomSpan(rooms: ProjectState['rooms']): [number, number] | undefined {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rooms) {
    for (const [x, z] of r.cells) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  return minX === Infinity ? undefined : [maxX - minX + 1, maxZ - minZ + 1];
}

function pruefeGrenzen(state: ProjectState): string | undefined {
  const rooms = state.rooms;
  if (state.floors.length === 0) return 'Projektdatei ohne Etage';
  if (state.floors.length > FILE_LIMITS.maxFloors) return `Projektdatei mit ${state.floors.length} Etagen (erlaubt sind ${FILE_LIMITS.maxFloors})`;
  for (const f of state.floors) {
    if (!Number.isInteger(f.height) || f.height < FILE_LIMITS.minHeight || f.height > FILE_LIMITS.maxHeight) {
      return `Wandhöhe ${String(f.height)} ist ungültig (erlaubt ${FILE_LIMITS.minHeight}–${FILE_LIMITS.maxHeight})`;
    }
    if (!Number.isInteger(f.y0) || Math.abs(f.y0) > FILE_LIMITS.maxCoord) return `Etagenhöhe ${String(f.y0)} liegt außerhalb des Rasterbereichs`;
  }
  const ids = new Set<string>();
  let gesamt = 0;
  for (const r of rooms) {
    if (ids.has(r.id)) return `Doppelte Raum-ID „${r.id}“ in der Projektdatei`;
    ids.add(r.id);
    if (r.cells.size > FILE_LIMITS.maxRoomCells) return `Raum „${r.id}“ hat ${r.cells.size} Zellen (erlaubt sind ${FILE_LIMITS.maxRoomCells})`;
    for (const [x, z] of r.cells) {
      if (!Number.isInteger(x) || !Number.isInteger(z)) return `Raum „${r.id}“ enthält ungültige Zellen (${String(x)}, ${String(z)})`;
      if (Math.abs(x) > FILE_LIMITS.maxCoord || Math.abs(z) > FILE_LIMITS.maxCoord) return `Raum „${r.id}“ liegt außerhalb des Rasterbereichs (±${FILE_LIMITS.maxCoord})`;
    }
    gesamt += r.cells.size;
  }
  if (gesamt > FILE_LIMITS.maxTotalCells) return `Projekt hat ${gesamt} Raumzellen (erlaubt sind ${FILE_LIMITS.maxTotalCells})`;
  const span = roomSpan(rooms);
  if (span !== undefined && (span[0] > FILE_LIMITS.maxSpan || span[1] > FILE_LIMITS.maxSpan)) {
    return `Die Räume erstrecken sich über ${span[0]} × ${span[1]} Blöcke (erlaubt sind ${FILE_LIMITS.maxSpan} × ${FILE_LIMITS.maxSpan})`;
  }
  const version = state.targetVersion.name;
  if (!Object.hasOwn(TARGET_VERSIONS, version)) {
    return `Minecraft ${version} wird nicht unterstützt (verfügbar: ${Object.keys(TARGET_VERSIONS).join(', ')})`;
  }
  for (const p of state.placements) {
    const [x, , z] = p.pose.pos;
    if (Math.abs(x) > FILE_LIMITS.maxCoord || Math.abs(z) > FILE_LIMITS.maxCoord) return `Möbel ${p.id} liegt außerhalb des Rasterbereichs`;
  }
  return undefined;
}

/**
 * Grenzen der Umgebung (Auftrag BT01/2): Wehrplatten im Altformat tragen ihre Zellen in der Datei. Geprüft werden
 * Zelldezahl, Ausdehnung und Koordinaten – wie bei Räumen. Neu gespeicherte Platten (nur Baukörper-Bindung) haben
 * keine Zellen und fallen hier durch.
 */
function pruefeUmgebungGrenzen(sur: SurroundingsState): string | undefined {
  for (const item of sur.structures) {
    if (item.kind !== 'parapet' || item.cells === undefined) continue;
    if (item.cells.length > FILE_LIMITS.maxParapetCells) {
      return `Wehrplatte ${item.id} hat ${item.cells.length} Zellen (erlaubt sind ${FILE_LIMITS.maxParapetCells})`;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of item.cells) {
      if (!Number.isInteger(x) || !Number.isInteger(z)) return `Wehrplatte ${item.id} enthält ungültige Zellen (${String(x)}, ${String(z)})`;
      if (Math.abs(x) > FILE_LIMITS.maxCoord || Math.abs(z) > FILE_LIMITS.maxCoord) {
        return `Wehrplatte ${item.id} liegt außerhalb des Rasterbereichs (±${FILE_LIMITS.maxCoord})`;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (item.cells.length > 0 && (maxX - minX + 1 > FILE_LIMITS.maxSpan || maxZ - minZ + 1 > FILE_LIMITS.maxSpan)) {
      return `Wehrplatte ${item.id} erstreckt sich über ${maxX - minX + 1} × ${maxZ - minZ + 1} Blöcke (erlaubt sind ${FILE_LIMITS.maxSpan} × ${FILE_LIMITS.maxSpan})`;
    }
  }
  return undefined;
}

/** JSON-Text → Inhalt (siehe `readProjectFile`). */
export function parseProjectText(text: string, refs: FileRefs = {}): ReadResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Keine gültige Projektdatei (kein JSON)' };
  }
  return readProjectFile(data, refs);
}

/** Ist das eine Projektdatei der App (Format-Kennung)? */
export const isProjectFile = (data: unknown): boolean => isObject(data) && data['format'] === PROJECT_FILE_FORMAT;

/**
 * Datei-Objekt → Inhalt. Prüft Format, Version (1 bis `PROJECT_FILE_VERSION`; v1 ohne Etagen-Events lädt weiter) und
 * Event-Typen, spielt die Historie ab und prüft die Grenzen (`FILE_LIMITS`). Einstellungen und Umgebung werden
 * tolerant gelesen: fehlend oder ungültig → schlichter Wert, beschädigte Umgebung fällt mit Hinweis heraus.
 */
export function readProjectFile(data: unknown, refs: FileRefs = {}): ReadResult {
  if (!isObject(data) || data['format'] !== PROJECT_FILE_FORMAT) return { ok: false, error: 'Keine Projektdatei dieses Werkzeugs' };
  const version = data['version'];
  // Review 3: „99.9“ soll als unbekannte Version gemeldet werden, nicht als Materialisierungsfehler – und auch
  // krumme Werte wie 1.5 oder 0 sind keine gültigen Dateiversionen.
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > PROJECT_FILE_VERSION) {
    return { ok: false, error: `Unbekannte Projektdatei-Version ${String(version)} (diese App liest Version 1 bis ${PROJECT_FILE_VERSION})` };
  }
  const history = data['history'];
  if (!Array.isArray(history) || history.length === 0) return { ok: false, error: 'Projektdatei ohne Historie' };
  for (const [i, e] of history.entries()) {
    const bad = unknownEvent(e, String(i));
    if (bad !== undefined) return { ok: false, error: `Projektdatei beschädigt: Event ${bad} ist unbekannt` };
  }
  let project: Project;
  try {
    project = Project.fromHistory(history as ProjectEvent[]);
    void project.state.rooms.map((r) => r.cells.size); // Zellmengen einmal anfassen: kaputte Daten fallen hier auf
  } catch (e) {
    const msg = e instanceof DomainError ? e.message : e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Projektdatei beschädigt: ${msg}` };
  }
  // Eingaben aus der DATEI prüfen (Review 3): die Oberfläche begrenzt Wandhöhe, Koordinaten und Flächen, eine
  // präparierte Datei umging das – bis hin zu 5003×6×5003-Exporten und minutenlanger Rechnung. Deshalb gelten
  // hier dieselben Grenzen, mit verständlicher Meldung statt Einfrieren.
  const grenzen = pruefeGrenzen(project.state);
  if (grenzen !== undefined) return { ok: false, error: grenzen };
  const roof = ROOF_OPTIONS.some((r) => r.id === data['roof']) ? (data['roof'] as RoofStyle) : DEFAULT_ROOF;
  const savedAt = typeof data['savedAt'] === 'string' ? data['savedAt'] : undefined;
  const settings: FileSettings = {
    roof,
    overhang: readOverhang(data['overhang']),
    windows: readWindows(data['windows']),
    roofDetail: readRoofDetail(data['roofDetail']),
    dormers: readDormers(data['dormers']),
    facade: readFacade(data['facade']),
    exterior: readExterior(data['exterior']),
    ...readCorridorTypes(data['corridorTypes']),
    // Feature Unterbau: Zahl 0–1, sonst weggelassen (Türbaum wie bisher)
    ...(typeof data['loopDoors'] === 'number' && data['loopDoors'] >= 0 && data['loopDoors'] <= 1 ? { loopDoors: data['loopDoors'] } : {}),
    // WS-Fassade: nur ausdrücklich `true` schaltet ein; fehlend/ungültig = aus (bitgleich)
    ...(data['facadeRhythm'] === true ? { facadeRhythm: true } : {}),
    density: readDensity(data['density']),
    // P07: nur ausdrücklich `true` schaltet ein; fehlend/ungültig = aus (bitgleich)
    ...(data['minAisle'] === true ? { minAisle: true } : {}),
    ...readBlockRules(data['blockRules']),
  };
  const around = readSurroundings(data['surroundings']);
  const aroundGrenzen = around.state === undefined ? undefined : pruefeUmgebungGrenzen(around.state);
  if (aroundGrenzen !== undefined) return { ok: false, error: aroundGrenzen };
  return {
    ok: true,
    project,
    settings,
    ...(around.state !== undefined ? { surroundings: around.state } : {}),
    name: project.state.name,
    savedAt,
    warnings: [...referenceWarnings(project, refs), ...around.warnings],
  };
}

/** Einstellungen tolerant lesen: fehlend oder ungültig → Standard (v1-Dateien haben keine). */
function readOverhang(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= OVERHANG_RANGE.min && v <= OVERHANG_RANGE.max ? v : DEFAULT_OVERHANG;
}

function readWindows(v: unknown): WindowChoice {
  if (!isObject(v)) return DEFAULT_WINDOWS;
  const spacing = v['spacing'];
  const okSpacing = typeof spacing === 'number' && Number.isInteger(spacing) && spacing >= WINDOW_SPACING_RANGE.min && spacing <= WINDOW_SPACING_RANGE.max;
  return { enabled: typeof v['enabled'] === 'boolean' ? v['enabled'] : DEFAULT_WINDOWS.enabled, spacing: okSpacing ? spacing : DEFAULT_WINDOWS.spacing };
}

/**
 * Feldweise lesen: fehlendes Objekt (ältere Datei) → schlicht wie bisher; ein ungültiges Feld → dessen schlichter
 * Wert, der Rest bleibt.
 */
function readFields<T extends object>(v: unknown, plain: T, problem: (x: T) => string | undefined): T {
  if (!isObject(v)) return plain;
  let out = plain;
  for (const key of Object.keys(plain) as Array<keyof T>) {
    const next = { ...out, [key]: v[key as string] };
    if (problem(next) === undefined) out = next;
  }
  return out;
}

const readRoofDetail = (v: unknown): RoofDetailChoice => readFields(v, PLAIN_ROOF_DETAIL, roofDetailProblem);
const readFacade = (v: unknown): FacadeChoice => readFields(v, PLAIN_FACADE, facadeProblem);
const readDormers = (v: unknown): DormerChoice => readFields(v, PLAIN_DORMERS, dormerProblem);

/** Außen-Deko: fehlt (ältere Datei) → aus; sonst feldweise, Gruppen einzeln (unbekannte oder fehlende Gruppe → an). */
function readExterior(v: unknown): ExteriorChoice {
  if (!isObject(v)) return PLAIN_EXTERIOR;
  const raw = isObject(v['groups']) ? v['groups'] : {};
  const groups = Object.fromEntries(Object.entries(PLAIN_EXTERIOR.groups).map(([g, on]) => [g, typeof raw[g] === 'boolean' ? raw[g] : on]));
  // W4-D: Dateien vor der Gruppe „Traufkonsolen“ – die Konsolen gehörten zu den Traufenlaternen (bitgleich)
  if (typeof raw['eaveBraces'] !== 'boolean' && typeof raw['eaveLanterns'] === 'boolean') groups['eaveBraces'] = raw['eaveLanterns'];
  const out = readFields({ ...v, groups }, PLAIN_EXTERIOR, exteriorProblem);
  // W3-CA/W4-B: optionales Fenster- und Eingangsmodul (fehlen im schlichten Wert, darum einzeln)
  const withModule = { ...out, windowModule: v['windowModule'] } as ExteriorChoice;
  const win = v['windowModule'] !== undefined && exteriorProblem(withModule) === undefined ? withModule : out;
  const withEntrance = { ...win, entranceModule: v['entranceModule'] } as ExteriorChoice;
  const entr = v['entranceModule'] !== undefined && exteriorProblem(withEntrance) === undefined ? withEntrance : win;
  // W5-B: Module im Material des Themes (tolerant: ungültig = weglassen)
  const withMaterial = { ...entr, themeMaterial: v['themeMaterial'] } as ExteriorChoice;
  const mat = v['themeMaterial'] !== undefined && exteriorProblem(withMaterial) === undefined ? withMaterial : entr;
  // W7-D: Fantasy-Stufe und -Kit (tolerant: ungültig = weglassen, dann nach Theme)
  const withFantasy = { ...mat, fantasy: v['fantasy'] } as ExteriorChoice;
  const fan = v['fantasy'] !== undefined && exteriorProblem(withFantasy) === undefined ? withFantasy : mat;
  const withKit = { ...fan, fantasyKit: v['fantasyKit'] } as ExteriorChoice;
  const kit = v['fantasyKit'] !== undefined && exteriorProblem(withKit) === undefined ? withKit : fan;
  // W15: Stufe und abgeschaltete Muster der Fassaden-Details (tolerant: ungültig = weglassen)
  const withDetail = { ...kit, facadeDetail: v['facadeDetail'] } as ExteriorChoice;
  const det = v['facadeDetail'] !== undefined && exteriorProblem(withDetail) === undefined ? withDetail : kit;
  const withDetailOff = { ...det, facadeDetailOff: v['facadeDetailOff'] } as ExteriorChoice;
  return v['facadeDetailOff'] !== undefined && exteriorProblem(withDetailOff) === undefined ? withDetailOff : det;
}

/** Flur-Rollen: Liste von Raumtyp-IDs, sonst keine (Standard der Hülle). */
function readCorridorTypes(v: unknown): { corridorTypes?: readonly string[] } {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? { corridorTypes: v as string[] } : {};
}

/**
 * Block-Regeln tolerant lesen (W3-BL): nur Zeichenketten-IDs, Ersetzungen nur als Zeichenkette → Zeichenkette, Preset nur
 * bekannte Werte; alles andere fällt einzeln heraus. Leer oder fehlend = keine Sperren.
 */
export function readBlockRules(v: unknown): { blockRules?: BlockRules } {
  if (!isObject(v) || !Array.isArray(v['banned'])) return {};
  const banned = v['banned'].filter((b): b is string => typeof b === 'string' && b.length <= 64);
  const rawReplace = isObject(v['replace']) ? v['replace'] : {};
  const replace = Object.fromEntries(Object.entries(rawReplace).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length <= 64));
  const preset = typeof v['preset'] === 'string' && (BLOCK_RULE_PRESETS as readonly string[]).includes(v['preset']) ? { preset: v['preset'] as BlockRules['preset'] & string } : {};
  const n = normalizeBlockRules({ banned, replace, ...preset });
  return n === undefined ? {} : { blockRules: n };
}

function readDensity(v: unknown): ReadonlyMap<RoomId, number> {
  const out = new Map<RoomId, number>();
  if (!isObject(v)) return out;
  for (const [id, d] of Object.entries(v)) {
    if (typeof d === 'number' && Number.isFinite(d) && d >= DENSITY_RANGE.min && d <= DENSITY_RANGE.max && d !== DENSITY_RANGE.standard) out.set(id, d);
  }
  return out;
}

function referenceWarnings(project: Project, refs: FileRefs): string[] {
  const out: string[] = [];
  const s = project.state;
  if (refs.catalog !== undefined) {
    const types = new Set(refs.catalog.roomTypeIds());
    const unknownTypes = [...new Set(s.rooms.map((r) => r.roomTypeId).filter((t) => !types.has(t)))];
    if (unknownTypes.length > 0) out.push(`Unbekannte Raumtypen: ${unknownTypes.join(', ')}`);
    const unknownComponents = [...new Set(s.placements.map((p) => p.componentId).filter((c) => refs.catalog!.find(c) === undefined))];
    if (unknownComponents.length > 0) out.push(`Unbekannte Komponenten (Blöcke/Export schlagen fehl, bis der Raum neu gewürfelt ist): ${unknownComponents.join(', ')}`);
  }
  if (refs.themes !== undefined && !refs.themes.ids().includes(s.themeId)) out.push(`Unbekanntes Theme „${s.themeId}“ – bitte ein anderes wählen`);
  return out;
}

