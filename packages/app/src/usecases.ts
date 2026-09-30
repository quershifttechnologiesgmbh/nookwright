/**
 * Anwendungsschicht: Use Cases der Web-App. Rein und testbar (kein DOM, kein I/O, kein Math.random).
 *
 * Zustand = Sitzung mit dem Projekt-Aggregat (@mcda/blueprint). Die UI ruft nur diese Funktionen auf.
 * Das Aggregat ist intern veränderlich; jede Aktion arbeitet deshalb auf einer Kopie
 * (`Project.fromHistory`) und liefert eine neue Sitzung – bestehende Sitzungen bleiben unverändert
 * (React-tauglich, und ein Fehler mitten in einer Aktion hinterlässt keinen halben Zustand).
 *
 * Eine Nutzeraktion (z. B. „Raum malen“) erzeugt mehrere Domain Events: den Befehl selbst und
 * `RoomFurnished` für jeden betroffenen Raum. Undo nimmt die ganze Aktion zurück (`Project.undo(n)`),
 * Wiederholen (`redo`) stellt die verlassene Sitzung wieder her; ein Projektwechsel (Neu, Vorlage, Laden) ist über
 * `replaceSession` ebenfalls rückgängig zu machen.
 *
 * Neben der Event-Historie hat die Sitzung Einstellungen, die die Domäne nicht kennt (`SessionSettings`):
 * Dachform, Dachüberstand, Fenster (an/aus, Abstand), Dach-Details (Neigung, Kanten …), Außenprofil, Außen-Deko und
 * die Einrichtungsdichte je Raum. Sie werden mit dem Projekt
 * gespeichert, und ihre Änderung ist ein eigener Undo-Schritt (der Eintrag merkt sich die Einstellungen davor).
 *
 * Hülle und Einrichtung: `shellFor` aus @mcda/pipeline; eingerichtet wird hier direkt über `furnishRoom`
 * (@mcda/furnishing, gleiche Eingaben wie `furnishRooms` der Pipeline samt Stil-Kette des Themes), weil die App den
 * Qualitätswert je Raum anzeigt und die Dichte übergibt. Die Außen-Deko (`exteriorOf`, X1) ist wie die Hülle
 * abgeleitet: Plan aus Hülle, Einrichtung (Feuerstellen), Seed und Stil – nicht in der Historie.
 * Der Licht-Pass (`lightRooms`) braucht Plattform-Daten und läuft deshalb als eigener Schritt (lighting.ts):
 * Jede Aktion markiert die Sitzung mit `needsLight`, der Licht-Schritt hängt seine Events an dieselbe Aktion an.
 */
import {
  DomainError, FLOOR_HEIGHT, Project, STORY_STATES, TARGET_VERSIONS, checkLink,
  type Floor, type LinkId, type Placement, type PlacementId, type ProjectState, type RoofStyle, type Room,
  type RoomId, type RoomShellInfo, type Shell, type StairTurn, type StairType, type StoryState, type InteriorDecor, type TargetVersion, type VerticalLink,
} from '@mcda/blueprint';
import { applyPaletteOverrides, availableIn, type Catalog, type ComponentDef, type PaletteCatalog, type ResolvedTheme, type ThemeCatalog } from '@mcda/catalog';
import { CellSet, paletteOverridesKey, type Cell, type HorizontalDir, type MoodVector, type PaletteOverrides } from '@mcda/core';
import { expandComponent, furnishRoom, placeComponent, type ExpandedComponent, type PlacedComponent, type RoomQuality } from '@mcda/furnishing';
import {
  ENSEMBLE_DEFAULT, EXTERIOR_GROUPS, EXTERIOR_GROUP_LABELS, FALLBACK_THEME_ID, applyAutoStairs, applyNewProjectMood, autoStairsText, blockRulesCatalog, blockRulesContext, blockRulesKey, effectiveMood, exteriorFor, fixedFurnitureInStairs,
  furnishingGeometry, harmonyOf, keepOptionsOf, normalizeBlockRules, parapetSpecsFor, resolveEnsemble, roomCellsOf, roomVolumeOf, shellFor, themeFor,
  towerAnnexes, type BaseOptions, type BlockRules, type EnsembleResolution, type ExteriorPlacement, type ExteriorPlan, type PipelineContext,
} from '@mcda/pipeline';
import { ensembleOf, siteOf, structuresInput } from '@mcda/projectfile';
import type { SurroundingsState } from './surroundings.js';
import { fantasyKitLabel, fantasyLevelLabel } from './ui/fantasyChoice.js';
import { detailLevelLabel } from './ui/detailChoice.js';

// Einstellungen der Projektdatei: gemeinsam mit der Engine-API (@mcda/projectfile, C1)
import {
  BRACKET_RANGE, DEFAULT_DORMERS, DEFAULT_EXTERIOR, DEFAULT_FACADE, DEFAULT_OVERHANG, DEFAULT_ROOF, DEFAULT_ROOF_DETAIL, DEFAULT_WINDOWS, DENSITY_RANGE, DORMER_GAP_RANGE, DORMER_OPTIONS, DORMER_WIDTHS, EXTERIOR_DENSITY_RANGE, EXTERIOR_ROOF_GROUPS, GABLE_BRACE_RANGE, HALF_HIP_ROWS_RANGE, MANSARD_BREAK_RANGE, OVERHANG_RANGE, PILASTER_RANGE, PITCH_OPTIONS, PLAIN_DORMERS, PLAIN_EXTERIOR, PLAIN_FACADE, PLAIN_ROOF_DETAIL, ROOF_OPTIONS, WINDOW_SPACING_RANGE, attachedTowersOf, dormerOptions, dormerProblem, exteriorOptions, exteriorProblem, facadeOptions, facadeProblem, roofDetailOptions, roofDetailProblem, settingsOf, shellOptions, shellStyle, toStyle, usesHalfHipRows, usesMansardBreak,
  type WindowChoice, type RoofDetailChoice, type FacadeChoice, type DormerChoice, type ExteriorChoice, type ShellStyle, type SessionSettings, type StyleFields,
} from '@mcda/projectfile';
export {
  BRACKET_RANGE, DEFAULT_DORMERS, DEFAULT_EXTERIOR, DEFAULT_FACADE, DEFAULT_OVERHANG, DEFAULT_ROOF, DEFAULT_ROOF_DETAIL, DEFAULT_WINDOWS, DENSITY_RANGE, DORMER_GAP_RANGE, DORMER_OPTIONS, DORMER_WIDTHS, EXTERIOR_DENSITY_RANGE, EXTERIOR_ROOF_GROUPS, GABLE_BRACE_RANGE, HALF_HIP_ROWS_RANGE, MANSARD_BREAK_RANGE, OVERHANG_RANGE, PILASTER_RANGE, PITCH_OPTIONS, PLAIN_DORMERS, PLAIN_EXTERIOR, PLAIN_FACADE, PLAIN_ROOF_DETAIL, ROOF_OPTIONS, WINDOW_SPACING_RANGE, attachedTowersOf, dormerOptions, dormerProblem, exteriorOptions, exteriorProblem, facadeOptions, facadeProblem, roofDetailOptions, roofDetailProblem, settingsOf, shellOptions, shellStyle, usesHalfHipRows, usesMansardBreak,
  type WindowChoice, type RoofDetailChoice, type FacadeChoice, type DormerChoice, type ExteriorChoice, type ShellStyle, type SessionSettings, type StyleFields,
};

export const GRID = { width: 40, depth: 30 } as const;
/** Standard-Etage (Erdgeschoss). Die Befehle nehmen die Etage als Parameter (Etagen-Leiste). */
export const FLOOR_INDEX = 0;
export const DEFAULT_ROOM_TYPE = 'bedroom';
/**
 * Theme neuer Projekte (die App nimmt das erste Theme des ThemeCatalog, falls es dieses nicht gibt) – derselbe Wert wie
 * der Theme-Rückfall der Engine (`FALLBACK_THEME_ID`, @mcda/pipeline; W7-E/W7-G: App = Engine).
 */
export const DEFAULT_THEME = FALLBACK_THEME_ID;
/** Lichte Höhe (= Wandhöhe) je Etage, wie die Domäne sie zulässt. */
export const WALL_HEIGHT_RANGE = FLOOR_HEIGHT;
/** Höchstlänge des Projektnamens (auch Dateiname beim Export). */
export const MAX_NAME_LENGTH = 80;
/** Wählbare Zielversionen (Wertobjekte aus @mcda/blueprint). */
export const TARGET_VERSION_NAMES: readonly string[] = Object.keys(TARGET_VERSIONS);
/** Maximale Tiefe des Undo-Stapels (ältere Schritte werden vergessen, die Historie bleibt). */
export const UNDO_LIMIT = 200;

export type RoomWarnings = ReadonlyMap<RoomId, readonly string[]>;
export type RoomQualities = ReadonlyMap<RoomId, RoomQuality>;

/** Ergebnis des letzten Licht-Pass (lighting.ts), für die Anzeige. */
export interface LightSummary {
  /** In diesem Durchgang ergänzte Lichtquellen. */
  readonly added: number;
  /** Begehbare Zellen ohne Blocklicht nach dem Pass (dort können Monster spawnen). */
  readonly darkCells: number;
  /** Räume, die trotz Pass dunkle Zellen behalten. */
  readonly warnings: readonly string[];
  /** Stimmungs-Ziel nicht überall erreicht (kein Sicherheitsproblem). */
  readonly notes: readonly string[];
  /** Der Pass ist fehlgeschlagen (z. B. Theme ungültig); die Sitzung bleibt ohne Ergänzungen. */
  readonly error?: string;
}


interface UndoEntry {
  /** Länge der Event-Historie vor der Aktion. */
  readonly historyLength: number;
  readonly warnings: RoomWarnings;
  readonly quality: RoomQualities;
  readonly needsLight: boolean;
  readonly light: LightSummary | undefined;
  /** Einstellungen vor der Aktion (Dach, Fenster, Dichte). */
  readonly settings: SessionSettings;
  /** Umgebung (Gelände, Bauwerke) vor der Aktion – unveränderlicher Wert, siehe surroundings.ts. */
  readonly surroundings?: SurroundingsState | undefined;
}

export interface Session {
  /** Nie direkt Befehle darauf aufrufen – nur über die Use Cases. */
  readonly project: Project;
  readonly past: readonly UndoEntry[];
  /** Hinweise der Einrichtung je Raum (z. B. „Pflichtobjekt passt nicht“). */
  readonly warnings: RoomWarnings;
  /** Qualitätswert der letzten automatischen Einrichtung je Raum (fehlt nach dem Laden bis zum nächsten Einrichten). */
  readonly quality?: RoomQualities | undefined;
  /** Dachform der Hülle (App-Einstellung, nicht Teil der Event-Historie; wird mit dem Projekt gespeichert). */
  readonly roof: RoofStyle;
  /** Dachüberstand (Standard `DEFAULT_OVERHANG`). */
  readonly overhang?: number | undefined;
  /** Fenster (Standard `DEFAULT_WINDOWS`). */
  readonly windows?: WindowChoice | undefined;
  /** Dach-Details (Standard `DEFAULT_ROOF_DETAIL`). */
  readonly roofDetail?: RoofDetailChoice | undefined;
  /** Gauben (Standard `DEFAULT_DORMERS`). */
  readonly dormers?: DormerChoice | undefined;
  /** Außenprofil (Standard `DEFAULT_FACADE`). */
  readonly facade?: FacadeChoice | undefined;
  /** Außen-Deko (Standard `DEFAULT_EXTERIOR`). */
  readonly exterior?: ExteriorChoice | undefined;
  /** Flur-Rollen des Bautyps (fehlt = Standard der Hülle). */
  readonly corridorTypes?: readonly string[] | undefined;
  /** Feature Unterbau: Zusatztüren für Rundgänge (aus dem Bautyp-Plan); fehlt = Türbaum wie bisher. */
  readonly loopDoors?: number | undefined;
  /** WS-Fassade: Fassadenrhythmus (Fensterachsen im Takt, Gauben auf leeren Dachflächen); fehlt/false = aus und bitgleich. */
  readonly facadeRhythm?: boolean | undefined;
  /** Einrichtungsdichte je Raum (Standard 1). */
  readonly density?: ReadonlyMap<RoomId, number> | undefined;
  /**
   * P07: verbindlicher Mittelgang (`FurnishOptions.minAisle` des Solvers). Fehlt/false = aus und bitgleich zu
   * vorher; gehört zu den Einstellungen (wie die Dichte) und wird mit dem Projekt gespeichert.
   */
  readonly minAisle?: boolean | undefined;
  /**
   * W3-BL: gesperrte Blöcke samt festen Ersetzungen (Tab „Material“, Preset „Nur leicht farmbar“). Einstellung wie das
   * Dach (mit dem Projekt gespeichert, Undo-Schritt); wirkt auf Blöcke, Export und die Auswahl der Möbel-Varianten.
   */
  readonly blockRules?: BlockRules | undefined;
  /** Licht-Pass steht aus: Seit der letzten Aktion wurden keine Lichter ergänzt (siehe lighting.ts). */
  readonly needsLight: boolean;
  readonly light?: LightSummary | undefined;
  /** Wiederholen: von Undo verlassene Sitzungen, die zuletzt verlassene zuerst. Jede neue Aktion leert den Stapel. */
  readonly future?: readonly Session[] | undefined;
  /** Sitzung vor einem Projektwechsel (Neu, Vorlage, Laden): Undo am Anfang der Historie kehrt dorthin zurück. */
  readonly previous?: Session | undefined;
  /** Umgebung des Hauses: Gelände und Bauwerke (surroundings.ts); fehlt = keine. Wird mit dem Projekt gespeichert. */
  readonly surroundings?: SurroundingsState | undefined;
  /**
   * W11-A: Meldung der letzten Aktion, wenn sie Treppen automatisch gesetzt hat (bzw. keine Stelle fand) – nur für die
   * Statuszeile, nicht gespeichert; die nächste Aktion verwirft sie.
   */
  readonly autoStairsNote?: string | undefined;
}

export interface Rect {
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
}

const NO_QUALITY: RoomQualities = new Map();

// ---------------------------------------------------------------------------------------------- Einstellungen


/**
 * Felder eines Options-Objekts als Text. Verschachtelte Angaben (`decor` an `facade`, Unterfelder an `roofDetail`)
 * werden stabil serialisiert – `String(v)` schrieb früher `[object Object]`, wodurch der Hüllen-Zwischenspeicher
 * Änderungen an verschachtelten Feldern nicht bemerkte.
 */
const fields = (x: object | undefined): string =>
  x === undefined ? '-' : Object.entries(x).map(([k, v]) => `${k}=${v !== null && typeof v === 'object' ? stableText(v) : String(v)}`).join(',');

/** JSON mit sortierten Schlüsseln: gleicher Inhalt = gleicher Text (geladene Pläne haben eine andere Feldreihenfolge). */
function stableText(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableText).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableText(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Vergleichsschlüssel der Hülle (ohne Außen-Deko): gleicher Schlüssel = gleiche Hülle. */
export function shellKey(style: RoofStyle | ShellStyle): string {
  const s = toStyle(style);
  const o = shellOptions(s);
  const towers = s.towers === undefined || s.towers.length === 0 ? '' : `|t:${stableText(s.towers)}`;
  const corridors = s.corridorTypes === undefined ? '' : `|c:${s.corridorTypes.join(',')}`;
  const loops = s.loopDoors === undefined ? '' : `|l:${s.loopDoors}`;
  const rhythm = s.facadeRhythm === true ? '|fr' : '';
  // F-Ensemble: Brückentüren hängen an der Umgebung, der Außen-Deko (Kollision) und den Block-Regeln (Gelände-Objekte)
  const ensemble = s.ensemble === undefined ? ''
    : `|e:${objectId(s.ensemble)}|${fields(exteriorOptions(s.exterior) ?? {})}|${blockRulesKey(s.blockRules)}`;
  return `${s.roof}|${s.overhang}|${s.windows.enabled ? s.windows.spacing : 'off'}|${fields(o.roofDetail)}|${fields(o.facade)}|${fields(o.dormers)}${towers}${corridors}${loops}${rhythm}${ensemble}`;
}

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;
/** Kurze ID je Objekt (Umgebungszustand, Kontext) für Zwischenspeicher-Schlüssel. */
function objectId(o: object): number {
  let id = objectIds.get(o);
  if (id === undefined) objectIds.set(o, (id = nextObjectId++));
  return id;
}

// ---------------------------------------------------------------------------------------------- F-Ensemble

/**
 * Kontext für den Verbindungsgraphen (F-Ensemble) in `shellOf`: Katalog, Themes, Geländestile. Die Hülle mit
 * Brückentüren entsteht erst nach Umgebung und Prüfung (`resolveEnsemble`, wie `generateBase` der Engine); `shellOf`
 * hat nur Projekt und Stil, deshalb registriert die App den Kontext einmal (`configureEnsemble`: beim Laden des Katalogs,
 * im Bautyp-Assistenten, im Licht-Pass und in `baseWorldOf`). Ohne Kontext entsteht die Hülle ohne Brücken.
 */
let ensembleContext: PipelineContext | undefined;
export function configureEnsemble(ctx: Pick<PipelineContext, 'catalog' | 'themes'> & Partial<PipelineContext>, terrainStyles?: PipelineContext['terrainStyles']): void {
  const styles = terrainStyles ?? ctx.terrainStyles;
  if (styles === undefined) return;
  const cur = ensembleContext;
  if (cur !== undefined && cur.catalog === ctx.catalog && cur.themes === ctx.themes && cur.terrainStyles === styles && cur.palettes === ctx.palettes) return;
  ensembleContext = { ...(ctx as PipelineContext), terrainStyles: styles };
}

/** Katalog des registrierten Kontexts (Einrichtung nach Änderungen der Umgebung, die die Brückentüren verschieben). */
export function ensembleCatalog(): Catalog | undefined {
  return ensembleContext?.catalog;
}

const roomKeys = new WeakMap<object, string>();
/** Inhaltsschlüssel der Räume (Projekt aus der Historie neu aufgebaut = gleicher Schlüssel, z. B. im Licht-Pass). */
function roomsKey(st: ProjectState): string {
  let k = roomKeys.get(st.rooms);
  if (k === undefined) {
    k = st.rooms.map((r) => `${r.id}:${r.floorIndex}:${r.volumeId ?? ''}:${r.roomTypeId}:${r.cells.toArray().map((c) => `${c[0]},${c[1]}`).join(';')}`).join('|');
    roomKeys.set(st.rooms, k);
  }
  return k;
}

const recentEnsembles: { readonly key: string; readonly result: EnsembleResolution }[] = [];

/**
 * Verbindungsgraph der Sitzung aufgelöst (Hülle mit Brückentüren, Umgebung mit Brücken und Wegen) – `undefined`, wenn er
 * nicht wirkt oder der Kontext fehlt. Zwischengespeichert je Räume/Etagen/Treppen/Baukörper, Stil, Umgebung, Seed,
 * Theme, Palette, Zielversion und Kontext (die Einrichtung ändert das Ergebnis nicht: wie `generateBase` vor ihr).
 */
export function ensembleOfSession(project: Project, style: RoofStyle | ShellStyle): EnsembleResolution | undefined {
  const s = toStyle(style);
  const sur = s.ensemble;
  const env = ensembleContext;
  if (sur === undefined || env === undefined) return undefined;
  const options = ensembleOf(sur) ?? ENSEMBLE_DEFAULT;
  if (options === false || options === undefined) return undefined;
  const st = project.state;
  const key = [
    roomsKey(st), stableText(st.floors), stableText(st.links), stableText(st.volumes ?? null), shellKey(s), styleKey(s), objectId(sur),
    objectId(env.catalog), objectId(env.themes), objectId(env.terrainStyles!), env.palettes === undefined ? 0 : objectId(env.palettes),
    st.seed, st.themeId, st.paletteId ?? '', paletteOverridesKey(st.paletteOverrides), st.targetVersion.dataVersion,
  ].join('|');
  const hit = recentEnsembles.find((e) => e.key === key);
  if (hit !== undefined) return hit.result;
  const { ensemble: _e, towers = [], ...plain } = s;
  const build = shellOptions(plain);
  const exterior = exteriorOptions(s.exterior);
  const ctx = blockRulesContext(env, s.blockRules);
  const theme = themeFor(project, ctx);
  // Wehrplatten aus der Hülle ohne Anbauten (wie der Bautyp-Dienst `planSurroundings`)
  const bare = shellFor(project, build, theme);
  const structures = structuresInput(sur, (item) =>
    item.volumeId === undefined ? undefined : parapetSpecsFor(bare, [{ ...item, volumeId: item.volumeId }], roomVolumeOf(st), roomCellsOf(st))[0]);
  const site = sur.terrain ? siteOf(sur) : undefined;
  const terrainStyle = site === undefined ? undefined : env.terrainStyles!.get(site.styleId);
  if (site !== undefined && terrainStyle === undefined) return undefined;
  const opts: BaseOptions = {
    ...build,
    ...(exterior !== undefined ? { exterior } : {}),
    ...(s.blockRules !== undefined ? { blockRules: s.blockRules } : {}),
    ...(site !== undefined ? { site, terrainStyle: terrainStyle! } : {}),
    ...(structures !== undefined ? { structures } : {}),
    ...(towers.length > 0 ? { attachedTowers: towers } : {}),
    // feat/site-decor: Grundstücks-Deko (fehlt = aus, bitgleich)
    ...(sur.siteDecor !== undefined ? { siteDecor: sur.siteDecor } : {}),
    // WS-Verwitterung: erzählende Verwitterung (fehlt = aus, bitgleich)
    ...(sur.weathering !== undefined ? { weathering: sur.weathering } : {}),
    // TX-B: Oberflächen-Textur (fehlt = aus, bitgleich)
    ...(sur.surfaceTexture !== undefined ? { surfaceTexture: sur.surfaceTexture } : {}),
    // feat/gelaende: Geländeform der Umgebung (wirkt nur mit Gelände), wie `surroundingsInput`
    ...(site !== undefined && sur.landform !== undefined && sur.landform !== 'flat' ? { landform: sur.landform } : {}),
  };
  const result = resolveEnsemble(project, ctx, opts, options);
  recentEnsembles.unshift({ key, result });
  recentEnsembles.length = Math.min(recentEnsembles.length, 6);
  return result;
}

/** Vergleichsschlüssel des ganzen Stils (Cache der Blöcke, React-Abhängigkeiten): Hülle + Außen-Deko. */
export function styleKey(style: RoofStyle | ShellStyle): string {
  const s = toStyle(style);
  const x = exteriorOptions(s.exterior);
  // W3-BL: Block-Regeln ändern Blöcke und Export, nicht die Hülle (nur hier, nicht in `shellKey`)
  const rules = blockRulesKey(s.blockRules);
  return `${shellKey(style)}|${x === undefined ? 'x-' : `x:${fields(x)}`}${rules === '' ? '' : `|b:${rules}`}`;
}

/**
 * Katalog für die Auswahl (Einrichtung, Außen-Deko, Gelände-Objekte, Tauschen): mit Block-Regeln die Sicht ohne
 * Varianten mit gesperrten Blöcken (`blockRulesCatalog`, gemeinsame Regel mit der Engine), sonst der Katalog selbst.
 * Theme-Bindungen (`shellThemeOf`, `styleChain`) hängen am Original – dafür immer `catalog` nehmen.
 */
export function selectionCatalog(catalog: Catalog, style: RoofStyle | ShellStyle): Catalog {
  return blockRulesCatalog(catalog, toStyle(style).blockRules);
}


/**
 * Zahl der Gauben, die die Hülle tatsächlich bekommt (für den Hinweis „keine Gauben“): Je Gaube setzt die Domäne einen
 * Fensteranker (B2), also Fensteranker mit minus ohne Gauben – gezählt mit Fenstern an, weil „Fenster aus“ auch die
 * Gaubenfenster samt Anker weglässt. Beide Hüllen kommen aus dem Zwischenspeicher von `shellOf`.
 */
export function dormerCount(project: Project, style: ShellStyle, catalog?: Catalog): number {
  if (dormerOptions(style.roof, style.dormers) === undefined) return 0;
  const counted: ShellStyle = { ...style, windows: { ...style.windows, enabled: true } };
  const windows = (s: ShellStyle): number => (shellOf(project, s, shellThemeOf(catalog, project.state.themeId)).anchors ?? []).filter((a) => a.kind === 'window').length;
  return Math.max(0, windows(counted) - windows({ ...counted, dormers: PLAIN_DORMERS }));
}


const DETAIL_LABEL: Readonly<Record<keyof RoofDetailChoice, string>> = {
  pitch: 'Dachneigung', trim: 'Dachkante', verge: 'Ortgang', flare: 'Glockenfuß', gableWindows: 'Giebelfenster', halfHipRows: 'Walm-Reihen', mansardBreak: 'Knickhöhe',
  heightBudget: 'Automatische Dachhöhe', split: 'Dach teilen',
};
const FACADE_LABEL: Readonly<Record<keyof FacadeChoice, string>> = {
  plinthProfile: 'Sockelprofil', cornice: 'Gesims', quoins: 'Eckquader', pilasters: 'Wandvorlagen', brackets: 'Balkenkonsolen',
  decorate: 'Fachwerk-Deko', gableBraces: 'Giebelstreben', quality: 'Pflichtregeln', piers: 'Pfeiler-Pflicht', frameRole: 'Fensterrahmen',
  upperFrame: 'Wandkleid Obergeschoss', lightRooms: 'Fenster-Pflicht',
};

/** W4-D: optionale Dach-Schalter mit ihrem Standard (Budget aus, Teilung an) – für die Statuszeile „an/aus“. */
const detailShown = (d: RoofDetailChoice): RoofDetailChoice => ({ ...d, heightBudget: d.heightBudget === true, split: d.split !== false });

function valueText(v: unknown, zero: string): string {
  if (typeof v === 'boolean') return v ? 'an' : 'aus';
  if (v === 0) return zero;
  if (v === 'closed') return 'geschlossen';
  if (v === 'plain') return 'offen';
  return PITCH_OPTIONS.find((p) => p.id === v)?.label ?? String(v);
}

/** Statuszeile nach einer Stil-Änderung, z. B. „Dach: Sattel“, „Dachneigung: Steil“, „Gesims: an“. */
export function styleChangeLabel(before: ShellStyle, patch: Partial<ShellStyle>): string {
  if (patch.roof !== undefined && patch.roof !== before.roof) return `Dach: ${ROOF_OPTIONS.find((r) => r.id === patch.roof)?.label ?? patch.roof}`;
  if (patch.overhang !== undefined && patch.overhang !== before.overhang) return `Dachüberstand ${patch.overhang}`;
  if ('loopDoors' in patch && (patch.loopDoors ?? 0) !== (before.loopDoors ?? 0)) return `Rundgänge: ${(patch.loopDoors ?? 0) > 0 ? 'an' : 'aus'}`;
  if ('facadeRhythm' in patch && (patch.facadeRhythm === true) !== (before.facadeRhythm === true)) return `Fassadenrhythmus: ${patch.facadeRhythm === true ? 'an' : 'aus'}`;
  const changed = <T extends object>(a: T, b: T | undefined, labels: Readonly<Record<keyof T, string>>, zero: string): string[] =>
    b === undefined ? [] : (Object.keys(labels) as Array<keyof T>).filter((k) => a[k] !== b[k]).map((k) => `${labels[k]}: ${valueText(b[k], zero)}`);
  const parts = [
    ...changed(detailShown(before.roofDetail), patch.roofDetail && detailShown(patch.roofDetail), DETAIL_LABEL, 'automatisch'),
    ...(patch.dormers !== undefined ? dormerChanges(before.dormers, patch.dormers) : []),
    ...changed(before.facade, patch.facade, FACADE_LABEL, 'aus'),
    ...(patch.exterior !== undefined ? exteriorChanges(before.exterior, patch.exterior) : []),
  ];
  if (parts.length > 0) return parts.join(', ');
  return patch.windows !== undefined ? 'Fenster geändert' : 'Hülle geändert';
}

/** Name der Gaubenart für Statuszeile und Anzeige, z. B. „Schleppgaube“, „aus“. */
export const dormerName = (kind: DormerChoice['kind']): string => DORMER_OPTIONS.find((o) => o.id === kind)?.name ?? kind;

function dormerChanges(a: DormerChoice, b: DormerChoice): string[] {
  const out: string[] = [];
  if (a.kind !== b.kind) out.push(`Gauben: ${dormerName(b.kind)}`);
  if (a.width !== b.width) out.push(`Gaubenbreite ${b.width}`);
  if (a.minGap !== b.minGap) out.push(`Gaubenabstand ${b.minGap}`);
  return out;
}

function exteriorChanges(a: ExteriorChoice, b: ExteriorChoice): string[] {
  const out: string[] = [];
  if (a.enabled !== b.enabled) out.push(`Außen-Deko: ${b.enabled ? 'an' : 'aus'}`);
  // W7-K: Fantasy-Stufe und -Art (Auswahl im Außen-Panel)
  if (a.fantasy !== b.fantasy) out.push(`Fantasy: ${fantasyLevelLabel(b.fantasy)}`);
  if (a.fantasyKit !== b.fantasyKit) out.push(`Fantasy-Art: ${fantasyKitLabel(b.fantasyKit)}`);
  if (a.facadeDetail !== b.facadeDetail) out.push(`Fassaden-Details: ${detailLevelLabel(b.facadeDetail)}`);
  for (const g of EXTERIOR_GROUPS) if (a.groups[g] !== b.groups[g]) out.push(`${EXTERIOR_GROUP_LABELS[g]}: ${b.groups[g] ? 'an' : 'aus'}`);
  if (a.density !== b.density) out.push(`Außen-Dichte: ${exteriorDensityLabel(b.density)}`);
  if (a.variation !== b.variation) out.push(b.variation === 0 ? 'Außen-Deko: Grundvariante' : `Außen-Deko neu gewürfelt (Variante ${b.variation})`);
  return out;
}

/** Anzeige der Außen-Dichte, z. B. „Standard“, „150 %“, „nur Eingang und Schornsteine“. */
export function exteriorDensityLabel(d: number): string {
  return d === EXTERIOR_DENSITY_RANGE.standard ? 'Standard' : d === 0 ? 'nur Eingang und Schornsteine' : `${Math.round(d * 100)} %`;
}

function sameSettings(a: SessionSettings, b: SessionSettings): boolean {
  if (styleKey(a) !== styleKey(b) || a.density.size !== b.density.size) return false;
  if ((a.minAisle === true) !== (b.minAisle === true)) return false;
  for (const [id, d] of a.density) if (b.density.get(id) !== d) return false;
  return true;
}

/** Dichte-Einträge gelöschter Räume entfernen (Raum weg → Eintrag weg). */
function pruneDensity(density: ReadonlyMap<RoomId, number>, state: ProjectState): ReadonlyMap<RoomId, number> {
  if (density.size === 0) return density;
  const ids = new Set(state.rooms.map((r) => r.id));
  if ([...density.keys()].every((id) => ids.has(id))) return density;
  return new Map([...density].filter(([id]) => ids.has(id)));
}

// ---------------------------------------------------------------------------------------------- Sitzung

export function createSession(seed: number, name = 'Unbenannt', themeId = DEFAULT_THEME, roof: RoofStyle = DEFAULT_ROOF): Session {
  const project = Project.create({ id: 'local', name: cleanName(name) || 'Unbenannt', seed, themeId, targetVersion: TARGET_VERSIONS['1.21.11'] });
  applyNewProjectMood(project); // B4: neue Projekte mit der Stimmung des Themes (wie die Engine)
  return { project, past: [], warnings: new Map(), quality: new Map(), roof, needsLight: false };
}

/** Sitzung aus einer gespeicherten Historie (Laden): kein Undo in die Vergangenheit, der Licht-Pass prüft einmal nach. */
export function sessionFromProject(project: Project, settings: RoofStyle | Partial<SessionSettings> = DEFAULT_ROOF): Session {
  const st: Partial<SessionSettings> = typeof settings === 'string' ? { roof: settings } : settings;
  return {
    project,
    past: [],
    warnings: new Map(),
    quality: new Map(),
    roof: st.roof ?? DEFAULT_ROOF,
    ...(st.overhang !== undefined ? { overhang: st.overhang } : {}),
    ...(st.windows !== undefined ? { windows: st.windows } : {}),
    ...(st.roofDetail !== undefined ? { roofDetail: st.roofDetail } : {}),
    ...(st.dormers !== undefined ? { dormers: st.dormers } : {}),
    ...(st.facade !== undefined ? { facade: st.facade } : {}),
    ...(st.exterior !== undefined ? { exterior: st.exterior } : {}),
    ...(st.corridorTypes !== undefined ? { corridorTypes: st.corridorTypes } : {}),
    ...(st.loopDoors !== undefined ? { loopDoors: st.loopDoors } : {}),
    ...(st.facadeRhythm === true ? { facadeRhythm: true } : {}),
    ...(st.density !== undefined && st.density.size > 0 ? { density: pruneDensity(st.density, project.state) } : {}),
    ...(st.minAisle === true ? { minAisle: true } : {}),
    ...(normalizeBlockRules(st.blockRules) !== undefined ? { blockRules: normalizeBlockRules(st.blockRules) } : {}),
    needsLight: true,
  };
}

export const canUndo = (s: Session): boolean => s.past.length > 0 || s.previous !== undefined;
export const canRedo = (s: Session): boolean => (s.future?.length ?? 0) > 0;

/** Sitzung ohne Wiederholen-Stapel (für Einträge im Stapel selbst und nach neuen Aktionen). */
const withoutRedo = (s: Session): Session => (s.future === undefined ? s : { ...s, future: undefined });

/**
 * Macht die letzte Nutzeraktion rückgängig – samt der Lichter, die der Licht-Pass danach ergänzt hat
 * (sie hängen hinter der Aktion in der Historie, vor dem nächsten Undo-Eintrag) und samt der Einstellungen
 * (Dach, Fenster, Dichte) von davor. Am Anfang der Historie führt Undo zum Projekt vor dem letzten Projektwechsel
 * zurück. Die verlassene Sitzung kommt auf den Wiederholen-Stapel.
 */
export function undo(s: Session): Session {
  const entry = s.past[s.past.length - 1];
  const future = [withoutRedo(s), ...(s.future ?? [])];
  if (entry === undefined) return s.previous === undefined ? s : { ...s.previous, future };
  const n = s.project.history.length - entry.historyLength;
  const { towers: _towers, ensemble: _ensemble, ...settings } = entry.settings; // abgeleitet aus der Umgebung, kein Feld der Sitzung
  return {
    project: n > 0 ? projectBefore(s.project, entry.historyLength) : s.project,
    past: s.past.slice(0, -1),
    warnings: entry.warnings,
    quality: entry.quality,
    ...settings,
    needsLight: entry.needsLight,
    light: entry.light,
    previous: s.previous,
    future,
    surroundings: entry.surroundings,
  };
}

/** Wiederholen: die zuletzt per Undo verlassene Sitzung (mit ihren Lichtern und Hinweisen) wiederherstellen. */
export function redo(s: Session): Session {
  const [next, ...rest] = s.future ?? [];
  return next === undefined ? s : { ...next, future: rest };
}

/**
 * Projektwechsel (Neues Projekt, Vorlage, Laden): `next` ersetzt `current`, Undo am Anfang kehrt zurück.
 * Der Verlauf früherer Wechsel bleibt erhalten (Kette über `previous`).
 */
export function replaceSession(current: Session, next: Session): Session {
  return { ...next, previous: withoutRedo(current), future: undefined };
}

// ---------------------------------------------------------------------------------------------- Treppen automatisch

/** W11-A: Schalter „Treppen automatisch“ für Aktionen, die Räume ändern (Standard in den Use Cases: aus). */
export interface AutoStairsFlag {
  readonly autoStairs?: boolean;
}

/**
 * W11-A: Raum-Aktion mit automatischen Treppen – `command` ändert die Räume, danach verbindet dieselbe Aktion jede
 * Etage, die DIESE Aktion getrennt hat (`planAutoStairs` mit `since`, @mcda/pipeline, gleiche Regel wie die Engine).
 * Ein Undo-Schritt; von Hand gesetzte Treppen bleiben, bewusst entfernte kommen nicht zurück.
 */
function roomAct(s: Session, catalog: Catalog, command: (p: Project) => unknown, flag: AutoStairsFlag): Session {
  if (flag.autoStairs !== true) return act(s, catalog, command);
  let note: string | undefined;
  const next = act(s, catalog, (p) => {
    const before = p.state;
    command(p);
    const plan = applyAutoStairs(p, { catalog, since: before, ...(s.corridorTypes !== undefined ? { corridorTypes: s.corridorTypes } : {}) });
    note = autoStairsText(plan, p.state, catalog) || undefined;
  });
  return next === s || note === undefined ? next : { ...next, autoStairsNote: note };
}

/**
 * W11-A „Treppen jetzt verbinden“ (Schalter „Treppen automatisch“ eingeschaltet): alle Etagen ohne Treppe verbinden,
 * auch Lücken von früher. Ein Undo-Schritt; ohne Lücke unverändert.
 */
export function autoStairs(s: Session, catalog: Catalog): Session {
  let note: string | undefined;
  const next = act(s, catalog, (p) => {
    const plan = applyAutoStairs(p, { catalog, ...(s.corridorTypes !== undefined ? { corridorTypes: s.corridorTypes } : {}) });
    note = autoStairsText(plan, p.state, catalog) || undefined;
  });
  return note === undefined ? next : { ...next, autoStairsNote: note };
}

/** Etagen ohne Treppe zur Nachbar-Etage (je Baukörper), Regel aus @mcda/pipeline. */
export { disconnectedFloors } from '@mcda/pipeline';

/** Schlüssel der Browser-Einstellung „Treppen automatisch“. */
export const AUTO_STAIRS_KEY = 'basen-generator.autoStairs';

/** Browser-Einstellung lesen (Standard an; ohne Speicher oder bei Fehler ebenfalls an). */
export function autoStairsPref(store: { getItem(key: string): string | null } | undefined): boolean {
  try {
    return store?.getItem(AUTO_STAIRS_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Browser-Einstellung schreiben (Fehler still: die Einstellung gilt dann nur bis zum Neuladen). */
export function saveAutoStairsPref(store: { setItem(key: string, value: string): void } | undefined, on: boolean): void {
  try {
    store?.setItem(AUTO_STAIRS_KEY, on ? 'on' : 'off');
  } catch {
    // gesperrter Speicher
  }
}

// ---------------------------------------------------------------------------------------------- Räume

/** Rechteck malen: neuer Raum (übermalt bestehende). Liefert die ID des neuen Raums. W11-A: mit `autoStairs` verbindet
 * dieselbe Aktion eine neu getrennte Etage. */
export function paintRect(s: Session, catalog: Catalog, rect: Rect, roomTypeId: string, floor = FLOOR_INDEX, flag: AutoStairsFlag = {}): { session: Session; roomId: RoomId | undefined } {
  const cells = rectCells(rect);
  if (cells.isEmpty) return { session: s, roomId: undefined };
  let roomId: RoomId | undefined;
  const session = roomAct(s, catalog, (p) => {
    const events = p.paintRoom(floor, cells, roomTypeId);
    for (const e of events) if (e.type === 'RoomPainted') roomId = e.roomId;
  }, flag);
  return { session, roomId };
}

/** Rechteck radieren: Räume verlieren Zellen, zerfallen ggf. in Teile oder verschwinden. */
export function eraseRect(s: Session, catalog: Catalog, rect: Rect, floor = FLOOR_INDEX, flag: AutoStairsFlag = {}): Session {
  const cells = rectCells(rect);
  if (cells.isEmpty) return s;
  return roomAct(s, catalog, (p) => p.eraseCells(floor, cells), flag);
}

export function deleteRoom(s: Session, catalog: Catalog, roomId: RoomId, flag: AutoStairsFlag = {}): Session {
  return roomAct(s, catalog, (p) => {
    const room = p.room(roomId);
    p.eraseCells(room.floorIndex, room.cells);
  }, flag);
}

export function assignRoomType(s: Session, catalog: Catalog, roomId: RoomId, roomTypeId: string): Session {
  return act(s, catalog, (p) => p.assignRoomType(roomId, roomTypeId));
}

/** Neu würfeln: Seed-Zähler erhöhen und neu einrichten; gesperrte Möbel bleiben. */
export function rerollRoom(s: Session, catalog: Catalog, roomId: RoomId): Session {
  return act(s, catalog, (p) => p.rerollRoom(roomId));
}

/** Alle Räume neu würfeln (ein Undo-Schritt); gesperrte Möbel bleiben, fixierte Räume (W2-ED U4) auch. */
export function rerollAll(s: Session, catalog: Catalog): Session {
  return act(s, catalog, (p) => {
    for (const r of p.state.rooms) if (r.fixed !== true) p.rerollRoom(r.id);
  });
}

/** Variante ◀ ▶ eines Raums (W2-ED U4): Wurf `variant` (0 = erster), deterministisch; gesperrte Möbel bleiben. */
export function setRoomVariant(s: Session, catalog: Catalog, roomId: RoomId, variant: number): Session {
  return act(s, catalog, (p) => p.setRoomVariant(roomId, variant));
}

/** Raum fixieren bzw. lösen (W2-ED U4): übersteht Bautyp-Neubau und „Alle neu würfeln“. Ein Undo-Schritt. */
export function fixRoom(s: Session, catalog: Catalog, roomId: RoomId, fixed: boolean): Session {
  return act(s, catalog, (p) => p.fixRoom(roomId, fixed));
}

/**
 * Raum vergrößern/verkleinern (W2-ED U4, Anfasser im Grundriss): der Raum behält ID und Sperren; Nachbarn geben Zellen
 * ab. Zellen außerhalb des Rasters fallen weg. Neu eingerichtet werden nur Räume, deren Geometrie sich ändert.
 */
export function resizeRoom(s: Session, catalog: Catalog, roomId: RoomId, add: readonly Cell[], remove: readonly Cell[], flag: AutoStairsFlag = {}): Session {
  const inGrid = (cells: readonly Cell[]) => CellSet.of(cells.filter(([x, z]) => x >= 0 && z >= 0 && x < GRID.width && z < GRID.depth));
  return roomAct(s, catalog, (p) => p.resizeRoom(roomId, inGrid(add), inGrid(remove)), flag);
}

/**
 * Dichte der Einrichtung eines Raums (0 = nur Pflichtobjekte, 1 = Standard des Raumtyps, 2 = doppeltes Budget).
 * Der Raum wird mit demselben Seed neu eingerichtet; gesperrte Möbel bleiben. Ein Undo-Schritt.
 */
export function setRoomDensity(s: Session, catalog: Catalog, roomId: RoomId, density: number): Session {
  if (!Number.isFinite(density) || density < DENSITY_RANGE.min || density > DENSITY_RANGE.max) {
    throw new DomainError('density', `Dichte ${density} nicht erlaubt (${DENSITY_RANGE.min}–${DENSITY_RANGE.max})`);
  }
  s.project.room(roomId);
  const current = settingsOf(s).density;
  if ((current.get(roomId) ?? DENSITY_RANGE.standard) === density) return s;
  const next = new Map(current);
  if (density === DENSITY_RANGE.standard) next.delete(roomId);
  else next.set(roomId, density);
  return act(s, catalog, () => undefined, { settings: { density: next }, force: [roomId] });
}

/** Dichte eines Raums (Standard 1). */
export function roomDensity(s: Session, roomId: RoomId): number {
  return s.density?.get(roomId) ?? DENSITY_RANGE.standard;
}

/**
 * P07: Mittelgang verbindlich – eine Einrichtungseinstellung wie die Dichte (SessionSettings, mit dem Projekt
 * gespeichert). Der Schalter wirkt auf alle Räume: sie werden mit demselben Seed neu eingerichtet, der Solver hält
 * den Gang eines Raumtyps mindestens auf `aisle.minWidth` und meldet einen Pflichtkonflikt als Warnung
 * („Mittelgang verbindlich …“) statt den Gang still aufzugeben. Ohne Häkchen bleibt die Einrichtung bitgleich zu
 * vorher (keine Option an `furnishRoom`). Ein Undo-Schritt.
 */
/**
 * W3-BL: Block-Regeln setzen (Tab „Material“: Block sperren/freigeben, feste Ersetzung, Preset „Nur leicht farmbar“).
 * Ein Undo-Schritt; alle Räume werden mit ihrem Seed neu eingerichtet (Möbel-Varianten mit gesperrten Blöcken fallen
 * weg – Räume ohne solche bleiben bitgleich), der Licht-Pass prüft neu. Gleiche Regeln → Sitzung unverändert.
 */
export function setBlockRules(s: Session, catalog: Catalog, rules: BlockRules | undefined): Session {
  const next = normalizeBlockRules(rules);
  if (blockRulesKey(next) === blockRulesKey(s.blockRules)) return s;
  return act(s, catalog, () => undefined, { settings: { blockRules: next } });
}

export function setMinAisle(s: Session, catalog: Catalog, minAisle: boolean): Session {
  const on = minAisle === true;
  if ((s.minAisle === true) === on) return s;
  const force = s.project.state.rooms.map((r) => r.id);
  return act(s, catalog, () => undefined, { settings: { minAisle: on ? true : undefined }, force });
}

// ---------------------------------------------------------------------------------------------- Möbel

export function toggleLock(s: Session, catalog: Catalog, placementId: PlacementId): Session {
  return act(s, catalog, (p) => (p.placement(placementId).locked ? p.unlockPlacement(placementId) : p.lockPlacement(placementId)));
}

/** Alle Möbel eines Raums sperren bzw. entsperren (ein Undo-Schritt; schon passende bleiben unverändert). */
export function setRoomLocked(s: Session, catalog: Catalog, roomId: RoomId, locked: boolean): Session {
  return act(s, catalog, (p) => {
    for (const pl of p.state.placements) {
      if (pl.roomId !== roomId) continue;
      if (locked) p.lockPlacement(pl.id);
      else p.unlockPlacement(pl.id);
    }
  });
}

/**
 * Möbel entfernen (samt Kindern, z. B. Kerzen auf dem Tisch). Der Raum wird nicht neu eingerichtet – sonst käme
 * das Möbel sofort zurück; erst Neu würfeln füllt wieder auf. Der Qualitätswert bekommt einen Vermerk.
 */
export function removePlacement(s: Session, catalog: Catalog, placementId: PlacementId): Session {
  const placement = s.project.placement(placementId);
  const next = act(s, catalog, (p) => p.removePlacement(placementId));
  const q = next.quality?.get(placement.roomId);
  if (next === s || q === undefined) return next;
  const name = catalog.find(placement.componentId)?.name ?? placement.componentId;
  const quality = new Map(next.quality);
  quality.set(placement.roomId, { ...q, notes: [...q.notes, `Von Hand entfernt: ${name} (Wert gilt für die letzte automatische Einrichtung)`] });
  return { ...next, quality };
}

// ---------------------------------------------------------------------------------------------- Projekt

/**
 * Theme wählen: wirkt auf Materialisierung (Blockvorschau, Export) und – über die Stil-Kette (`styleChain`) – auf die
 * Einrichtung: Ändert sich die Kette, werden alle Räume mit ihrem Seed neu eingerichtet (Signatur-Tausch, z. B.
 * Nordic: Langfeuer statt Kamin; gesperrte Möbel bleiben). Ein Undo-Schritt.
 */
export function setTheme(s: Session, catalog: Catalog, themeId: string): Session {
  return act(s, catalog, (p) => p.setTheme(themeId));
}

/**
 * Farbpalette wählen (Q4, research/54 §3.3): färbt das Theme um, ohne seine Bauweise zu ändern. Wirkt auf
 * Materialisierung, Vorschau und Export. Ein Undo-Schritt; `undefined` wählt die Farbwelt ab.
 */
export function setPalette(s: Session, catalog: Catalog, paletteId: string | undefined): Session {
  return act(s, catalog, (p) => p.setPalette(paletteId));
}

/**
 * Blockpalette vor dem Generieren anpassen (W13-G): Familie je Rollengruppe und Familien-Tausch. Liegt im Projektzustand
 * (`ProjectState.paletteOverrides`, ein Undo-Schritt, gespeichert); Vorschau, Materialliste und Export folgen über
 * `themeFor`. Dieselbe Prüfung wie der Engine-Befehl `setPaletteOverrides` macht die Auswahl selbst (nur gültige
 * Familien der Zielversion); `undefined` = alles zurück auf Theme bzw. Palette (bitgleich).
 */
export function setPaletteOverrides(s: Session, catalog: Catalog, overrides: PaletteOverrides | undefined): Session {
  return act(s, catalog, (p) => p.setPaletteOverrides(overrides));
}

/**
 * Zustandstexte des Nutzungszustands (Q5/P15) für die Auswahl im Panel „Gebäude“: fünf Zustände aus
 * `STORY_STATES` (@mcda/blueprint) plus „ohne“ (kein Zustand, bitgleich zu vorher). Die Gewichte der Spuren
 * (`age`/`stoneMoss`/…) stehen in `@mcda/materialize` (`story.ts`), nicht hier – die App zeigt nur das Vokabular.
 */
export const STORY_STATE_OPTIONS: ReadonlyArray<{ readonly id: StoryState; readonly label: string; readonly hint: string }> = [
  { id: 'neu', label: 'neu', hint: 'Kaum Spuren: wie frisch gebaut, wenig Moos und Risse, gepflegtes Holz' },
  { id: 'bewohnt', label: 'bewohnt', hint: 'Grundzustand: die Verwitterung des Themes, Arbeitsplätze gepflegt' },
  { id: 'verlassen', label: 'verlassen', hint: 'Still und ungepflegt: mehr Moos an der feuchten Basis, entrindetes Holz, Laufspur an der Tür' },
  { id: 'verfallen', label: 'verfallen', hint: 'Ruine: viele Risse und Flechten, vergraute Farbflächen, verwahrloste Arbeitsräume' },
  { id: 'belagert', label: 'belagert', hint: 'Risse statt Bewuchs: Brand- und Kampfspuren, wenig Pflege' },
];

/** Anzeigename eines Zustands („ohne“ fehlt in `STORY_STATES` und ist der abgewählte Zustand). */
export const storyStateLabel = (storyState: StoryState | undefined): string =>
  storyState === undefined ? 'ohne' : (STORY_STATE_OPTIONS.find((o) => o.id === storyState)?.label ?? storyState);

/**
 * Nutzungszustand des Baus setzen oder abwählen (Q5/P15): derselbe Grundriss, andere material- und ortsbezogene
 * Spuren (`@mcda/materialize` `story.ts`, deterministisch aus dem Projekt-Seed). Der Zustand liegt im
 * Projektzustand (`ProjectState.storyState`) und damit in der Historie: ein Undo-Schritt, im Projekt gespeichert.
 * Die Einrichtung bleibt unverändert (die Spuren tauschen nur Blöcke der Hüllzellen); die Blockvorschau baut die
 * Welt wegen des neuen Zustands neu. `undefined` (=„ohne“) wählt ab und ist bitgleich zum Stand ohne Zustand.
 */
export function setStoryState(s: Session, catalog: Catalog, storyState: StoryState | undefined): Session {
  return act(s, catalog, (p) => p.setStoryState(storyState));
}

/**
 * Stimmung des Baus (feat/theme-moods): `{}` schaltet sie mit der Theme-Vorgabe ein, Achsen überschreiben, `undefined`
 * schaltet ab (bitgleich). Liegt im Projektzustand (`ProjectState.mood`): ein Undo-Schritt, im Projekt gespeichert. Alle
 * Räume werden neu eingerichtet (weiche Gewichte und Deko-Budget ändern sich); die Materialspuren folgen der Achse `wear`.
 */
export function setMood(s: Session, catalog: Catalog, mood: MoodVector | undefined): Session {
  return act(s, catalog, (p) => p.setMood(mood));
}

/** Auswahl der Innen-Deko-Stufe in der App (feat/int-decor; dieselben Stufen wie `interiorDecor` der Engine). */
export const INTERIOR_DECOR_OPTIONS: ReadonlyArray<{ readonly id: InteriorDecor; readonly label: string; readonly hint: string }> = [
  { id: 'some', label: 'etwas', hint: 'Wandschmuck, Pflanzen, Teppich und Kerzen in Wohn-, Schlaf-, Ess-, Arbeits- und Empfangsräumen' },
  { id: 'rich', label: 'reich', hint: 'Deutlich mehr Deko, dazu Hängendes an der Decke – Wege, Türen, Fenster und Licht-Budget bleiben frei' },
];

/** Anzeigename der Innen-Deko-Stufe („aus“ = keine Zusatz-Deko). */
export const interiorDecorLabel = (level: InteriorDecor | undefined): string =>
  level === undefined ? 'aus' : (INTERIOR_DECOR_OPTIONS.find((o) => o.id === level)?.label ?? level);

/**
 * Innen-Deko-Stufe setzen oder abschalten (feat/int-decor): liegt im Projektzustand (`ProjectState.interiorDecor`),
 * ein Undo-Schritt, im Projekt gespeichert. Alle Räume werden neu eingerichtet; der Deko-Pass läuft mit dem Licht-Pass
 * (`lightSession`), `undefined` ist bitgleich zum Stand ohne Stufe.
 */
export function setInteriorDecor(s: Session, catalog: Catalog, level: InteriorDecor | undefined): Session {
  return act(s, catalog, (p) => p.setInteriorDecor(level));
}

/**
 * Statuszeile zum Schalter/Regler „Stimmung“ (W8-H): ehrlich, wenn sich die wirksame Stimmung nicht ändert – z. B.
 * „an“ bei einem Theme ohne eigene Stimmung (Mittelalter), solange kein Regler verschoben ist.
 */
export function moodChangeLabel(catalog: Catalog | undefined, state: ProjectState, mood: MoodVector | undefined): string {
  const key = (m: MoodVector | undefined): string => JSON.stringify(m ?? null);
  const { mood: _old, ...rest } = state;
  const same = key(moodFor(catalog, state)) === key(moodFor(catalog, mood === undefined ? rest : { ...rest, mood }));
  if (mood === undefined) return same ? 'Stimmung aus (hatte bei diesem Theme keine Wirkung)' : 'Stimmung aus';
  if (state.mood === undefined) return same ? 'Stimmung an (keine Wirkung bei diesem Theme ohne Regler)' : 'Stimmung an';
  return same ? 'Stimmung geändert (neutral – keine Wirkung)' : 'Stimmung geändert';
}

/** Wirksame Stimmung eines Projekts in der App (dieselbe Regel wie `moodOf` der Engine). */
export function moodFor(catalog: Catalog | undefined, state: ProjectState): MoodVector | undefined {
  return effectiveMood(state, shellThemeOf(catalog, state.themeId));
}

/**
 * Zielversion wählen (Export-Dialog). Räume mit Komponenten, die es in der neuen Version nicht gibt,
 * werden neu eingerichtet; alle anderen bleiben unverändert.
 */
export function setTargetVersion(s: Session, catalog: Catalog, versionName: string): Session {
  const v = (TARGET_VERSIONS as Readonly<Record<string, TargetVersion>>)[versionName];
  if (v === undefined) throw new DomainError('UNKNOWN_TARGET_VERSION', `Unbekannte Zielversion „${versionName}“ (wählbar: ${TARGET_VERSION_NAMES.join(', ')})`);
  return act(s, catalog, (p) => p.setTargetVersion(v));
}

/** Leerraum zusammenfassen, Steuerzeichen entfernen, auf `MAX_NAME_LENGTH` kürzen. */
export function cleanName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
}

/**
 * Projekt umbenennen (Dateiname beim Export, Name im .litematic) über das Domain Event `ProjectRenamed`.
 * Ein eigener Undo-Schritt; Hülle, Einrichtung und Licht bleiben unberührt.
 */
export function renameProject(s: Session, name: string): Session {
  const clean = cleanName(name);
  if (clean.length === 0) throw new DomainError('project.name', 'Der Projektname darf nicht leer sein');
  if (clean === s.project.state.name) return s;
  const next = Project.fromHistory(s.project.history);
  next.rename(clean);
  return { ...s, project: next, past: [...s.past, entryOf(s)].slice(-UNDO_LIMIT), future: undefined };
}

/**
 * Stil von außen ändern (Dach, Überstand, Fenster, Dach-Details, Gauben, Außenprofil, Außen-Deko). Wirkt auf Hülle, Vorschau
 * und Export. Räume, deren Geometrie sich dadurch ändert (Fenster; Fenster oben, die ein Dach verdecken würde), werden
 * neu eingerichtet. Ein Undo-Schritt; ohne Katalog nur, solange kein Raum neu einzurichten ist. Was weder Hülle noch
 * Außen-Deko ändert (z. B. Walm-Reihen beim Satteldach), ist keine Aktion. Die Außen-Deko allein ändert die Hülle
 * nicht: kein neues Einrichten, kein neuer Licht-Pass.
 */
export function setShellStyle(s: Session, patch: Partial<ShellStyle>, catalog?: Catalog): Session {
  const current = shellStyle(s);
  // angedockte Türme gehören zur Umgebung der Sitzung (surroundings.ts), nicht zum Stil – ein mitgegebener Wert (z. B.
  // der Stil des bisherigen Projekts für eine Vorlage) zählt nicht
  const { towers: _towers, ensemble: _ensemble, ...own } = patch;
  const next: ShellStyle = { ...current, ...own };
  if (!ROOF_OPTIONS.some((r) => r.id === next.roof)) throw new DomainError('roof', `Unbekannte Dachform „${String(next.roof)}“`);
  if (!Number.isInteger(next.overhang) || next.overhang < OVERHANG_RANGE.min || next.overhang > OVERHANG_RANGE.max) {
    throw new DomainError('roof.overhang', `Dachüberstand ${next.overhang} nicht erlaubt (${OVERHANG_RANGE.min}–${OVERHANG_RANGE.max})`);
  }
  const w = next.windows;
  if (typeof w.enabled !== 'boolean' || !Number.isInteger(w.spacing) || w.spacing < WINDOW_SPACING_RANGE.min || w.spacing > WINDOW_SPACING_RANGE.max) {
    throw new DomainError('windows', `Fensterabstand ${w.spacing} nicht erlaubt (${WINDOW_SPACING_RANGE.min}–${WINDOW_SPACING_RANGE.max})`);
  }
  const problem = roofDetailProblem(next.roofDetail) ?? dormerProblem(next.dormers) ?? facadeProblem(next.facade) ?? exteriorProblem(next.exterior);
  if (problem !== undefined) throw new DomainError('shell.style', problem);
  if (styleKey(next) === styleKey(current)) return s;
  return act(s, catalog, () => undefined, { settings: next });
}

/** Dachform wählen (Flach/Walm/Sattel). Siehe `setShellStyle`. */
export function setRoof(s: Session, roof: RoofStyle, catalog?: Catalog): Session {
  return setShellStyle(s, { roof }, catalog);
}

// ---------------------------------------------------------------------------------------------- Etagen

/** Name einer Etage für die UI: EG, 1. OG, 1. UG … */
export function floorLabel(index: number): string {
  return index === 0 ? 'EG' : index > 0 ? `${index}. OG` : `${-index}. UG`;
}

/**
 * Neue Etage über der obersten (Standard) oder unter der untersten (Keller). Lichte Höhe wie die angrenzende
 * Etage, falls nicht angegeben. Liefert die Nummer der neuen Etage (die UI wechselt dorthin).
 */
export function addFloor(s: Session, catalog: Catalog, opts: { below?: boolean; height?: number } = {}): { session: Session; floorIndex: number } {
  let floorIndex = FLOOR_INDEX;
  const session = act(s, catalog, (p) => {
    for (const e of p.addFloor(opts)) if (e.type === 'FloorAdded') floorIndex = e.floor.index;
  });
  return { session, floorIndex };
}

/** Oberste oder unterste Etage entfernen (samt Räumen, Möbeln und angeschlossenen Treppen); nie die letzte. */
export function removeFloor(s: Session, catalog: Catalog, index: number): Session {
  return act(s, catalog, (p) => p.removeFloor(index));
}

/**
 * Wandhöhe (lichte Höhe) einer Etage ändern (`Project.setFloorHeight`). Etagen darüber rutschen samt Möbeln mit
 * (Keller wachsen nach unten); die Räume der Etage und alle Räume, deren Höhe oder Boden sich ändert, werden neu
 * eingerichtet. Treppen, die bei der neuen Höhe nicht mehr passen (Länge hängt an der Höhe, Wendel höchstens
 * 7 Stufen), entfernt dieselbe Aktion (`StairsRemoved`) – siehe `removedStairs` für die Meldung.
 */
export function setFloorHeight(s: Session, catalog: Catalog, index: number, height: number, flag: AutoStairsFlag = {}): Session {
  return roomAct(s, catalog, (p) => {
    if (p.setFloorHeight(index, height).length === 0) return;
    for (const link of [...p.state.links]) if (typeof checkLink(p.state, link) === 'string') p.removeStairs(link.id);
  }, flag);
}

/** Treppen, die zwischen zwei Zuständen verschwunden sind (für Meldungen nach Höhe/Malen/Radieren). */
export function removedStairs(before: ProjectState, after: ProjectState): readonly VerticalLink[] {
  const ids = new Set(after.links.map((l) => l.id));
  return before.links.filter((l) => !ids.has(l.id));
}

/**
 * Ist `next` ein Schritt durch den Verlauf (Rückgängig/Wiederholen) oder ein Projektwechsel (Neu, Bautyp, Laden)
 * statt einer Bearbeitung? Erkannt an den Verweisen, die `undo`, `redo` und `replaceSession` setzen:
 * Rückgängig legt die verlassene Sitzung vorn in `future`, Wiederholen nimmt sie von dort, ein Projektwechsel merkt
 * sich die alte Sitzung in `previous`.
 */
export function historyOrSwitch(prev: Session, next: Session): boolean {
  return next.future?.[0]?.project === prev.project || prev.future?.[0]?.project === next.project || next.previous?.project === prev.project;
}

/**
 * Treppen, die eine **Bearbeitung** ungültig gemacht hat (Malen, Radieren, Wandhöhe) – für die Statuszeile. Bei
 * Rückgängig/Wiederholen und Projektwechsel ist nichts „entfernt, weil es nicht mehr passt“: dort wechselt nur der
 * Stand (Review R1-10: „Rückgängig nach Übernehmen meldet Treppe s21, s22, s23 entfernt“ als roten Fehler).
 */
export function stairsRemovedBy(prev: Session, next: Session): readonly VerticalLink[] {
  return historyOrSwitch(prev, next) ? [] : removedStairs(prev.project.state, next.project.state);
}

export function floorOf(state: ProjectState, index: number): Floor | undefined {
  return state.floors.find((f) => f.index === index);
}

// ---------------------------------------------------------------------------------------------- Treppen

export interface StairSpec {
  /** Untere Etage (die Treppe führt nach oben). */
  readonly floor: number;
  readonly origin: Cell;
  readonly facing: HorizontalDir;
  readonly type: StairType;
  readonly turn?: StairTurn | undefined;
}

export const STAIR_TYPES: ReadonlyArray<{ readonly id: StairType; readonly label: string; readonly hint: string; readonly turns: boolean }> = [
  { id: 'straight', label: 'Gerade', hint: 'Gerade Treppe: Stufen = Wandhöhe + 1 in Laufrichtung', turns: false },
  { id: 'l', label: 'L', hint: 'L-Treppe: Viertelwendung mit Podest', turns: true },
  { id: 'u', label: 'U', hint: 'U-Treppe: gegenläufig mit Podest (2 Zellen breit)', turns: true },
  { id: 'spiral', label: 'Wendel', hint: 'Wendeltreppe 3 × 3 um einen Pfosten (höchstens Wandhöhe 6)', turns: true },
  { id: 'ladder', label: 'Leiter', hint: 'Leiter an einer Wand oder einem Pfosten', turns: false },
];

/**
 * Treppe setzen (von `spec.floor` zur Etage darüber). Die Domäne prüft die Invarianten (Kern eines Raums, keine
 * Überschneidung); zusätzlich lehnt die App Stellen ab, an denen gesperrte oder von Hand gesetzte Möbel stehen
 * (die Domäne würde sie sonst stillschweigend entfernen oder überbauen). Beide Räume werden neu eingerichtet.
 */
export function placeStairs(s: Session, catalog: Catalog, spec: StairSpec): { session: Session; linkId: LinkId | undefined } {
  const blocker = stairsBlockedByFixed(s.project.state, catalog, spec);
  if (blocker !== undefined) throw new DomainError('stairs.fixed', blocker);
  let linkId: LinkId | undefined;
  const session = act(s, catalog, (p) => {
    for (const e of p.placeStairs(spec.floor, spec.origin, spec.facing, spec.type, spec.turn !== undefined ? { turn: spec.turn } : {})) {
      if (e.type === 'StairsPlaced') linkId = e.link.id;
    }
  });
  return { session, linkId };
}

export function removeStairs(s: Session, catalog: Catalog, linkId: LinkId): Session {
  return act(s, catalog, (p) => p.removeStairs(linkId));
}

/** Art, Richtung oder Drehsinn einer Treppe ändern (entfernen + neu setzen, ein Undo-Schritt, neue ID). */
export function changeStairs(s: Session, catalog: Catalog, linkId: LinkId, patch: Partial<Pick<StairSpec, 'type' | 'facing' | 'turn'>>): { session: Session; linkId: LinkId | undefined } {
  const old = s.project.link(linkId);
  const type = patch.type ?? old.type;
  const turns = STAIR_TYPES.find((t) => t.id === type)?.turns ?? false;
  const spec: StairSpec = { floor: old.floorIndex, origin: old.origin, facing: patch.facing ?? old.facing, type, turn: turns ? (patch.turn ?? old.turn ?? 'right') : undefined };
  const others = { ...s.project.state, links: s.project.state.links.filter((l) => l.id !== linkId) };
  const blocker = stairsBlockedByFixed(others, catalog, spec);
  if (blocker !== undefined) throw new DomainError('stairs.fixed', blocker);
  let newId: LinkId | undefined;
  const session = act(s, catalog, (p) => {
    p.removeStairs(linkId);
    for (const e of p.placeStairs(spec.floor, spec.origin, spec.facing, spec.type, spec.turn !== undefined ? { turn: spec.turn } : {})) {
      if (e.type === 'StairsPlaced') newId = e.link.id;
    }
  });
  return { session, linkId: newId };
}

/**
 * Gesperrte/manuelle Möbel in den Zellen, die die Treppe reserviert → Begründung, sonst `undefined`
 * (auch `undefined`, wenn die Domäne die Treppe ohnehin ablehnt – sie begründet dann selbst).
 */
export function stairsBlockedByFixed(state: ProjectState, catalog: Catalog, spec: StairSpec): string | undefined {
  return fixedFurnitureInStairs(state, catalog, specLink(state, spec)); // gemeinsame Regel mit der Engine-API (@mcda/pipeline)
}

/** Treppe als `VerticalLink` für Prüfungen (ID wie beim Setzen). */
export function specLink(state: ProjectState, spec: StairSpec): VerticalLink {
  const turns = STAIR_TYPES.find((t) => t.id === spec.type)?.turns ?? false;
  return {
    id: `s${state.seq}`,
    type: spec.type,
    floorIndex: spec.floor,
    origin: [spec.origin[0], spec.origin[1]],
    facing: spec.facing,
    ...(turns ? { turn: spec.turn ?? 'right' } : {}),
  };
}

// ---------------------------------------------------------------------------------------------- Abfragen

export function roomAt(state: ProjectState, x: number, z: number, floor = FLOOR_INDEX): Room | undefined {
  return state.rooms.find((r) => r.floorIndex === floor && r.cells.has(x, z));
}

/** Rechteck auf das Raster begrenzen; `undefined`, wenn es ganz außerhalb liegt. */
export function clampRect(r: Rect, grid: { width: number; depth: number } = GRID): Rect | undefined {
  const x1 = Math.max(0, Math.min(r.x1, r.x2));
  const x2 = Math.min(grid.width - 1, Math.max(r.x1, r.x2));
  const z1 = Math.max(0, Math.min(r.z1, r.z2));
  const z2 = Math.min(grid.depth - 1, Math.max(r.z1, r.z2));
  return x1 > x2 || z1 > z2 ? undefined : { x1, z1, x2, z2 };
}

export function rectCells(r: Rect): CellSet {
  const c = clampRect(r);
  return c === undefined ? CellSet.empty() : CellSet.rect(c.x1, c.z1, c.x2, c.z2);
}

/** Hülle je Räume → Etagen → Treppen → Stil (Möbel-, Theme- und Versions-Events ändern keins davon). */
const shellCache = new WeakMap<readonly Room[], WeakMap<readonly Floor[], WeakMap<readonly VerticalLink[], Map<string, Shell>>>>();

/**
 * Hülle des Projekts über den Anwendungsdienst (`shellFor` mit dem Stil der Sitzung), zwischengespeichert je
 * Raumliste, Etagen, Treppen und `shellKey` (die Außen-Deko ändert die Hülle nicht). `style` darf auch nur eine
 * Dachform sein (Überstand/Fenster Standard).
 */
export function shellOf(project: Project, style: RoofStyle | ShellStyle = DEFAULT_ROOF, theme?: ResolvedTheme): Shell {
  const { rooms, floors, links } = project.state;
  let byFloors = shellCache.get(rooms);
  if (byFloors === undefined) shellCache.set(rooms, (byFloors = new WeakMap()));
  let byLinks = byFloors.get(floors);
  if (byLinks === undefined) byFloors.set(floors, (byLinks = new WeakMap()));
  let byStyle = byLinks.get(links);
  if (byStyle === undefined) byLinks.set(links, (byStyle = new Map()));
  // Baukörper (eigene Dächer, Höhen) ändern die Hülle auch ohne neue Raumliste
  const volumes = project.state.volumes;
  // W14-Fix: Das Theme gehört in den Schlüssel. Vorher entschied der ERSTE Aufruf je Zustand, ob die Hülle mit oder ohne
  // Theme (Fachwerk-Deko, W13-E Obergeschoss-Kleid) im Zwischenspeicher lag – Aufrufe ohne Theme (`baseWorldOf`,
  // Umgebung) bekamen je nach Reihenfolge eine andere Hülle (Blöcke-Worker ≠ Haupt-Thread). Ohne Theme gilt jetzt das
  // volle Theme des Projekts (Palette, Überschreibungen) wie `themeFor` in `generateBase`, aus dem Katalog des
  // registrierten Kontexts bzw. dem zuletzt geladenen Katalog (`bindThemes`).
  const st = project.state;
  const source = ensembleContext?.catalog ?? boundCatalog;
  const t = theme ?? (source === undefined ? undefined : shellThemeOf(source, st.themeId, st.paletteId, st.paletteOverrides));
  const base = volumes === undefined || volumes.length === 0 ? shellKey(style) : `${shellKey(style)}|v:${stableText(volumes)}`;
  const key = `${base}|t:${t === undefined ? '-' : objectId(t)}`;
  // F-Ensemble: mit Verbindungsgraph die aufgelöste Hülle (Brückentüren), wie `generateBase` der Engine
  const ensemble = ensembleOfSession(project, style);
  if (ensemble !== undefined) return ensemble.shell;
  let shell = byStyle.get(key);
  if (shell === undefined) {
    // Angedockte Türme (C4): an der Hülle OHNE sie messen (aus dem Zwischenspeicher), dann mit ihren Anbauten ableiten
    const { towers = [], ...plain } = toStyle(style);
    // F1-Deko: Theme-Vorgabe (Fachwerk) und Schalter der Sitzung; ohne Theme bleibt sie aus
    const opts = shellOptions(style);
    const norm = toStyle(style);
    const inner = (s: ShellStyle): Shell => shellFor(project, shellOptions(s), t);
    shell = towers.length === 0 ? inner(norm) : shellFor(project, { ...opts, annexes: towerAnnexes(inner(plain), towers) }, t);
    byStyle.set(key, shell);
  }
  return shell;
}

const exteriorCache = new WeakMap<Catalog, WeakMap<ProjectState, Map<string, ExteriorPlan>>>();

/**
 * Außen-Deko des Projekts (X1, `exteriorFor` aus @mcda/pipeline): Plan aus Hülle, Raumtypen, Feuerstellen der
 * Einrichtung (Schornsteine), Seed und Stil der Sitzung; `undefined`, wenn sie aus ist. Zwischengespeichert je
 * Katalog, Projektzustand und `styleKey` – Vorschau, Export und Anzeige nutzen denselben Plan.
 */
export function exteriorOf(project: Project, catalog: Catalog, style: RoofStyle | ShellStyle = DEFAULT_ROOF): ExteriorPlan | undefined {
  const s = toStyle(style);
  const opts = exteriorOptions(s.exterior);
  if (opts === undefined) return undefined;
  let byState = exteriorCache.get(catalog);
  if (byState === undefined) exteriorCache.set(catalog, (byState = new WeakMap()));
  let byStyle = byState.get(project.state);
  if (byStyle === undefined) byState.set(project.state, (byStyle = new Map()));
  const key = styleKey(s);
  let plan = byStyle.get(key);
  if (plan === undefined) {
    // W3-BL: Außen-Deko aus der Sicht der Block-Regeln (wie `generateWith` in der Engine)
    const theme = shellThemeOf(catalog, project.state.themeId);
    // feat/theme-moods: Achse `richness` skaliert die Außen-Deko-Dichte wie in der Engine (ohne Stimmung bitgleich)
    plan = exteriorFor(project, shellOf(project, s, theme), selectionCatalog(catalog, s), opts, effectiveMood(project.state, theme));
    byStyle.set(key, plan);
  }
  return plan;
}

/** Außen-Teile, die das Gelände als belegt kennen muss: alles außer den Dachteilen (`EXTERIOR_ROOF_GROUPS`). */
export function groundExterior(plan: ExteriorPlan | undefined): readonly ExteriorPlacement[] {
  return plan === undefined ? [] : plan.placements.filter((p) => !EXTERIOR_ROOF_GROUPS.has(p.group));
}

/** Eine Außen-Komponente mit Definition und Weltzellen (Rollen-Vorschau). */
export interface ExteriorView {
  readonly placement: ExteriorPlacement;
  readonly def: ComponentDef;
  readonly placed: PlacedComponent;
}

export function exteriorViews(plan: ExteriorPlan | undefined, catalog: Catalog): ExteriorView[] {
  const out: ExteriorView[] = [];
  for (const placement of plan?.placements ?? []) {
    const def = catalog.find(placement.componentId);
    if (def !== undefined) out.push({ placement, def, placed: placeComponent(expanded(catalog, def, placement.variantId), placement.pose) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- Stil-Kette

/** Themes je Katalog (Port „Theme-Kette“ für die Einrichtung); `buildCatalog` meldet sie beim Laden an. */
const themeCatalogs = new WeakMap<Catalog, ThemeCatalog>();
/** Farbpaletten je Katalog (Q4); `buildCatalog` meldet sie beim Laden an. */
const paletteCatalogs = new WeakMap<Catalog, PaletteCatalog>();
/** Zwischenspeicher der Stil-Ketten je ThemeCatalog. */
const chainCache = new WeakMap<ThemeCatalog, Map<string, readonly string[]>>();

/** Zuletzt angemeldeter Katalog: Theme-Quelle für `shellOf` ohne Theme, solange kein Kontext registriert ist. */
let boundCatalog: Catalog | undefined;

export function bindThemes(catalog: Catalog, themes: ThemeCatalog): void {
  themeCatalogs.set(catalog, themes);
  boundCatalog = catalog;
}

/** Farbpaletten am Katalog anmelden (Q4); ohne Katalog bleibt die Palette unberücksichtigt. */
export function bindPalettes(catalog: Catalog, palettes: PaletteCatalog | undefined): void {
  if (palettes !== undefined) paletteCatalogs.set(catalog, palettes);
}

/** Paletten des Katalogs (Auswahlfeld „Palette“); `undefined` ohne angemeldete Paletten. */
export function palettesOf(catalog: Catalog | undefined): PaletteCatalog | undefined {
  return catalog === undefined ? undefined : paletteCatalogs.get(catalog);
}

/**
 * Theme für die Hülle (F1-Deko). Ohne Katalog ist das nicht auflösbar (der Projektzustand trägt nur die ID): dann
 * `undefined` und die Hülle bleibt ohne Deko-Vorgabe. Aufrufer mit Katalog geben das Theme direkt mit (`shellFor`
 * braucht es ohnehin) – so kann kein Zwischenspeicher veraltete Theme-Daten eines früheren Katalogs liefern.
 */
export function shellThemeOf(catalog: Catalog | undefined, themeId: string, paletteId?: string, overrides?: PaletteOverrides): ResolvedTheme | undefined {
  const themes = catalog === undefined ? undefined : themeCatalogs.get(catalog);
  if (themes === undefined || !themes.ids().includes(themeId)) return undefined;
  const palette = paletteCatalogs.get(catalog!)?.find(paletteId);
  // W13-G: gleiche Reihenfolge wie `themeWith` der Pipeline (Theme → Palette → Überschreibungen)
  // WS-Farbe: Farbharmonie zuletzt, gleiche Regel wie `themeWith` (Test engineParity)
  return harmonyOf(applyPaletteOverrides(palette === undefined ? themes.get(themeId) : themes.resolveWith(themeId, palette), overrides), overrides);
}

/**
 * Stil-Kette eines Themes für den Solver (K3c, Y9): Theme-Kette umgedreht wie `styleChainOf` der Pipeline
 * (`nordic` → [nordic, medieval]). `undefined` ohne angemeldete Themes oder bei unbekanntem Theme (dann richtet der
 * Solver ohne Stil ein wie bisher). Gleiches Theme → dasselbe Array.
 */
export function styleChain(catalog: Catalog, themeId: string): readonly string[] | undefined {
  const themes = themeCatalogs.get(catalog);
  if (themes === undefined || !themes.ids().includes(themeId)) return undefined;
  let byId = chainCache.get(themes);
  if (byId === undefined) chainCache.set(themes, (byId = new Map()));
  let chain = byId.get(themeId);
  if (chain === undefined) byId.set(themeId, (chain = [...themes.get(themeId).chain].reverse()));
  return chain;
}

/** IDs der Platzierungen, die der Licht-Pass ergänzt hat und die es noch gibt. */
export function lightPlacementIds(project: Project): Set<PlacementId> {
  const ids = new Set<PlacementId>();
  for (const e of project.history) if (e.type === 'FurnishingSupplemented') for (const p of e.placements) ids.add(p.id);
  const present = new Set(project.state.placements.map((p) => p.id));
  for (const id of ids) if (!present.has(id)) ids.delete(id);
  return ids;
}

/** Eine Platzierung mit ihrer Definition und ihren Weltzellen (für 2D- und 3D-Ansicht). */
export interface PlacedView {
  readonly placement: Placement;
  readonly def: ComponentDef;
  readonly placed: PlacedComponent;
}

const expandCache = new WeakMap<Catalog, Map<string, ExpandedComponent>>();

function expanded(catalog: Catalog, def: ComponentDef, variantId: string | undefined): ExpandedComponent {
  let m = expandCache.get(catalog);
  if (m === undefined) expandCache.set(catalog, (m = new Map()));
  const key = `${def.id}#${variantId ?? ''}`;
  let e = m.get(key);
  if (e === undefined) m.set(key, (e = expandComponent(def, variantId)));
  return e;
}

/** Platzierungen in Weltzellen; unbekannte Komponenten (Katalog geändert) werden übersprungen. */
export function placedViews(state: ProjectState, catalog: Catalog, roomId?: RoomId): PlacedView[] {
  const out: PlacedView[] = [];
  for (const placement of state.placements) {
    if (roomId !== undefined && placement.roomId !== roomId) continue;
    const def = catalog.find(placement.componentId);
    if (def === undefined) continue;
    out.push({ placement, def, placed: placeComponent(expanded(catalog, def, placement.variantId), placement.pose) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- intern

export interface ActOptions {
  /** Neue Einstellungen (ersetzt die genannten Felder). */
  readonly settings?: Partial<SessionSettings>;
  /** Diese Räume auf jeden Fall neu einrichten (z. B. Dichte geändert). */
  readonly force?: readonly RoomId[];
  /** Neue Umgebung (C4: angedockte Türme ändern die Hülle); fehlt = unverändert. */
  readonly surroundings?: SurroundingsState;
}

/**
 * W14: die zuletzt als Undo-Ziel gemerkten Projekt-Aggregate. `Project.undo` spielt die Historie neu ab und liefert ein
 * neues Zustandsobjekt – dann verfehlen alle Zwischenspeicher, die am Zustand hängen (Hülle, Außen-Deko, Blöcke), und
 * Rückgängig rechnete alles neu (~1 s). Aggregate werden nie verändert (jede Aktion arbeitet auf `fromHistory`), ein
 * gemerktes mit **denselben Events** (Identität, ganze Historie verglichen) ist also genau das Ergebnis des Neuabspielens.
 * Wenige Einträge, damit alte Zustände (und ihre zwischengespeicherten Welten) nicht im Speicher bleiben.
 */
const recentProjects: Project[] = [];
const RECENT_PROJECTS = 4;

function rememberProject(p: Project): void {
  const i = recentProjects.indexOf(p);
  if (i >= 0) recentProjects.splice(i, 1);
  recentProjects.unshift(p);
  recentProjects.length = Math.min(recentProjects.length, RECENT_PROJECTS);
}

/** Projekt mit den ersten `length` Events von `current` – gemerkt (gleiche Event-Objekte) oder neu abgespielt. */
function projectBefore(current: Project, length: number): Project {
  const log = current.history;
  const hit = recentProjects.find((p) => {
    const h = p.history;
    if (h.length !== length || length > log.length) return false;
    for (let i = length - 1; i >= 0; i--) if (h[i] !== log[i]) return false;
    return true;
  });
  return hit ?? current.undo(log.length - length);
}

function entryOf(s: Session): UndoEntry {
  rememberProject(s.project);
  return {
    historyLength: s.project.history.length, warnings: s.warnings, quality: s.quality ?? NO_QUALITY, needsLight: s.needsLight, light: s.light, settings: settingsOf(s),
    surroundings: s.surroundings,
  };
}

/**
 * Aktion ohne Projekt-Events und ohne Neu-Einrichten (z. B. Umgebung, surroundings.ts): `patch` ersetzt Felder der
 * Sitzung, ein Undo-Schritt, der Wiederholen-Stapel verfällt. Licht-Pass und Hinweise bleiben, wie sie sind.
 */
export function withUndoStep(s: Session, patch: Pick<Session, 'surroundings'>): Session {
  return { ...s, ...patch, past: [...s.past, entryOf(s)].slice(-UNDO_LIMIT), future: undefined };
}

/**
 * Umgebungs-Aktion, die die Hülle ändert (angedockter Turm, C4): ein Undo-Schritt wie `withUndoStep`, dazu richtet sie
 * die Räume mit geänderter Geometrie (Tür zum Turm) neu ein und fordert den Licht-Pass an. Ändert sich die Hülle
 * nicht, genügt `withUndoStep`.
 */
export function withShellStep(s: Session, catalog: Catalog | undefined, patch: Pick<Session, 'surroundings'>): Session {
  if (patch.surroundings === s.surroundings) return s;
  if (shellKey(shellStyle(s)) === shellKey(shellStyle({ ...s, ...patch }))) return withUndoStep(s, patch);
  return act(s, catalog, () => undefined, { ...(patch.surroundings !== undefined ? { surroundings: patch.surroundings } : {}) });
}

/**
 * Führt eine Nutzeraktion auf einer Kopie aus und richtet danach alle betroffenen Räume ein.
 * Keine Events und keine geänderten Einstellungen → Sitzung unverändert (kein leerer Undo-Schritt).
 * Exportiert für die Bautyp-Use-Cases (buildingTypes.ts: Bautyp übernehmen, neu würfeln – je ein Undo-Schritt).
 */
export function act(s: Session, catalog: Catalog | undefined, command: (p: Project) => unknown, opts: ActOptions = {}): Session {
  const before = s.project;
  const next = Project.fromHistory(before.history);
  command(next);
  const old = settingsOf(s);
  const surroundings = opts.surroundings ?? s.surroundings;
  const merged: SessionSettings = { ...(surroundings === s.surroundings ? old : settingsOf({ ...s, surroundings })), ...opts.settings };
  const settings: SessionSettings = { ...merged, density: pruneDensity(merged.density, next.state) };
  const force = new Set(opts.force ?? []);
  if (next.history.length === before.history.length && force.size === 0 && sameSettings(old, settings) && surroundings === s.surroundings) return s;
  const furnished = furnishDirtyRooms(before, next, catalog, s, old, settings, force);
  const project = next.history.length === before.history.length ? before : next;
  return {
    project,
    past: [...s.past, entryOf(s)].slice(-UNDO_LIMIT),
    warnings: furnished.warnings,
    quality: furnished.quality,
    roof: settings.roof,
    overhang: settings.overhang,
    windows: settings.windows,
    roofDetail: settings.roofDetail,
    dormers: settings.dormers,
    facade: settings.facade,
    exterior: settings.exterior,
    corridorTypes: settings.corridorTypes,
    loopDoors: settings.loopDoors,
    facadeRhythm: settings.facadeRhythm,
    density: settings.density,
    minAisle: settings.minAisle,
    blockRules: settings.blockRules,
    // Licht hängt an Projekt, Hülle und Außen-Deko (C4: Außen-Laternen leuchten durch Fenster und Türen herein und
    // zählen im Pass mit) – nur Dichte-freie Stil-Gleichheit lässt den letzten Pass gelten
    needsLight: s.needsLight || project !== before || styleKey(old) !== styleKey(settings),
    light: s.light,
    previous: s.previous,
    surroundings,
  };
}

/** Stabiler Vergleichsschlüssel einer Raumgeometrie (Innenzellen, Türen, Fenster, Höhen, Treppen). */
export function geometryKey(g: RoomShellInfo): string {
  const cells = g.interior.toArray().map(([x, z]) => `${x},${z}`).join(';');
  const doors = g.doors.map((d) => `${d.inside[0]},${d.inside[1]}>${d.toward}${d.isMain ? '!' : ''}`).join(';');
  const windows = g.windows.map((w) => `${w.inside[0]},${w.inside[1]}>${w.toward}`).join(';');
  const blocked = (g.blocked?.toArray() ?? []).map(([x, z]) => `${x},${z}`).join(';');
  const stairs = (g.stairs ?? []).map((a) => `${a.inside[0]},${a.inside[1]}>${a.toward}@${a.linkId}/${a.end}`).join(';');
  return `${g.baseY}|${g.height}|${cells}|${doors}|${windows}|${blocked}|${stairs}`;
}

/**
 * Richtet jeden Raum neu ein, dessen Programm oder Geometrie sich geändert hat:
 * neu, anderer Raumtyp, neu gewürfelt, andere Innenzellen/Türen/Fenster/Höhe/Treppen (auch durch Nachbarräume,
 * Etagen oder den Hüllen-Stil), ausdrücklich verlangt (Dichte), andere Stil-Kette (Theme gewechselt) oder – nach
 * einem Versionswechsel – Komponenten, die es in der Zielversion nicht gibt.
 * W7-G (U7): Hat sich nur die Geometrie, die Block-Regel oder die Verfügbarkeit geändert, behält der Raum seine Möbel,
 * soweit sie noch passen und erlaubt sind (`keepOptionsOf`, Solver-Option `keep`); alles andere würfelt ihn neu.
 */
function furnishDirtyRooms(
  before: Project,
  project: Project,
  catalog: Catalog | undefined,
  prev: Session,
  styleBefore: ShellStyle,
  settings: SessionSettings,
  force: ReadonlySet<RoomId>,
): { warnings: RoomWarnings; quality: RoomQualities } {
  const theme = shellThemeOf(catalog, project.state.themeId);
  const shellBefore = shellOf(before, styleBefore, theme);
  const shellAfter = shellOf(project, settings, theme);
  const dataVersion = project.state.targetVersion.dataVersion;
  const versionChanged = before.state.targetVersion.dataVersion !== dataVersion;
  const unavailable = (roomId: RoomId): boolean =>
    catalog !== undefined &&
    project.state.placements.some((p) => {
      if (p.roomId !== roomId) return false;
      const def = catalog.find(p.componentId);
      return def !== undefined && !availableIn(def, dataVersion);
    });
  const warnings = new Map<RoomId, readonly string[]>();
  const quality = new Map<RoomId, RoomQuality>();
  const prevQuality = prev.quality ?? NO_QUALITY;
  const styles = catalog === undefined ? undefined : styleChain(catalog, project.state.themeId);
  const stylesChanged = catalog !== undefined && styleChain(catalog, before.state.themeId) !== styles;
  // feat/theme-moods: andere wirksame Stimmung → alle Räume neu (ohne Stimmung vorher und nachher: nie)
  const mood = moodFor(catalog, project.state);
  const moodChanged = JSON.stringify(mood) !== JSON.stringify(moodFor(catalog, before.state));
  // feat/int-decor: andere Deko-Stufe → alle Räume neu (die alte Deko ist dann weg; der Pass setzt die neue mit dem Licht)
  const decorChanged = project.state.interiorDecor !== before.state.interiorDecor;
  // W3-BL: andere Block-Regeln → andere Auswahl-Sicht; alle Räume neu (unberührte bleiben bitgleich, wie in der Engine)
  const rulesChanged = blockRulesKey(styleBefore.blockRules) !== blockRulesKey(settings.blockRules);
  const choice = catalog === undefined ? undefined : blockRulesCatalog(catalog, settings.blockRules);
  for (const room of project.state.rooms) {
    const old = before.state.rooms.find((r) => r.id === room.id);
    const gAfter = shellAfter.rooms.get(room.id);
    const gBefore = shellBefore.rooms.get(room.id);
    // Neu würfeln: neuer Raum, anderer Typ oder Wurf, anderes Theme (Signatur-Tausch), ausdrücklich verlangt (Dichte)
    const fresh =
      stylesChanged ||
      moodChanged ||
      decorChanged ||
      force.has(room.id) ||
      old === undefined ||
      old.roomTypeId !== room.roomTypeId ||
      old.rerollCount !== room.rerollCount ||
      gAfter === undefined ||
      gBefore === undefined;
    // W7-G (U7): Geometrie anders (Kante gezogen, Nachbar gewachsen, Tür/Fenster/Höhe), andere Block-Regeln oder Möbel,
    // die es in der Zielversion nicht gibt → neu einrichten, aber was noch passt (und erlaubt ist), bleibt stehen
    const moved = !fresh && (rulesChanged || (versionChanged && unavailable(room.id)) || geometryKey(gAfter!) !== geometryKey(gBefore!));
    if (!fresh && !moved) {
      const w = prev.warnings.get(room.id);
      if (w !== undefined) warnings.set(room.id, w);
      const q = prevQuality.get(room.id);
      if (q !== undefined) quality.set(room.id, q);
      continue;
    }
    if (catalog === undefined) throw new DomainError('catalog', 'Interner Fehler: Raum muss neu eingerichtet werden, aber der Katalog fehlt');
    const r = furnish(project, shellAfter, room, catalog, settings.density.get(room.id) ?? DENSITY_RANGE.standard, styles, settings.minAisle === true, choice, moved, mood);
    warnings.set(room.id, r.warnings);
    if (r.quality !== undefined) quality.set(room.id, r.quality);
  }
  return { warnings, quality };
}

/**
 * Einrichten eines Raums: `furnishRoom` mit der Geometrie aus `furnishingGeometry` (Treppen, Deckenöffnungen und
 * Geländer bleiben frei), gesperrte/manuelle Möbel als Hindernisse und der Stil-Kette des Themes (Signatur-Tausch,
 * Stil-Hinweis) – wie `furnishRoomsDetailed` im Anwendungsdienst, dazu Dichte und Qualitätswert. Unbekannte
 * Komponenten fester Möbel (Katalog geändert) werden übergangen.
 */
function furnish(
  project: Project, shell: Shell, room: Room, catalog: Catalog, density: number, styles: readonly string[] | undefined,
  minAisle = false, choice: Catalog = catalog, keep = false, mood?: MoodVector,
): { warnings: readonly string[]; quality?: RoomQuality } {
  if (!catalog.roomTypeIds().includes(room.roomTypeId)) return { warnings: [`Unbekannter Raumtyp „${room.roomTypeId}“ – Raum bleibt leer`] };
  const info = shell.rooms.get(room.id);
  if (info === undefined) return { warnings: ['Keine Hülle für diesen Raum (zu schmal?)'] };
  const fixedViews = placedViews(project.state, catalog, room.id).filter((v) => v.placement.locked || v.placement.origin === 'manual');
  const fixed = fixedViews.map((v) => v.placed);
  // W3-BL: ausgewählt wird aus der Sicht der Block-Regeln (`choice`), gesperrte/manuelle Möbel kommen aus dem Original
  const res = furnishRoom(furnishingGeometry(info), catalog.roomType(room.roomTypeId), choice, {
    seed: project.roomSeed(room.id),
    dataVersion: project.state.targetVersion.dataVersion,
    fixed,
    ...(density !== DENSITY_RANGE.standard ? { density } : {}),
    ...(styles !== undefined ? { styles } : {}),
    // P07: nur durchreichen, wenn verlangt – sonst bleibt die Einrichtung bitgleich
    ...(minAisle ? { minAisle: true } : {}),
    // W7-G (U7): bisherige Einrichtung als Vorgabe – dieselbe Regel wie `project_furnish` mit `keep` (@mcda/pipeline)
    // (Schlüssel passend zu `fixed`: Möbel unbekannter Komponenten fehlen dort)
    ...(keep ? { ...keepOptionsOf(project, room.id), fixedKeys: fixedViews.map((v) => v.placement.id) } : {}),
    // feat/theme-moods: wirksame Stimmung wie `moodOption` der Engine (ohne Stimmung nicht gesetzt, bitgleich)
    ...(mood !== undefined ? { mood } : {}),
  });
  project.applyFurnishing(room.id, res.placements);
  return { warnings: res.warnings, quality: res.quality };
}

/** Fehlertext für die UI (Domänenfehler sind fachlich formuliert, alles andere bekommt einen Präfix). */
export function errorMessage(e: unknown): string {
  if (e instanceof DomainError) return e.message;
  return `Interner Fehler: ${e instanceof Error ? e.message : String(e)}`;
}
