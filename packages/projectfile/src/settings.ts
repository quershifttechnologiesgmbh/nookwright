/**
 * Einstellungen eines Projekts außerhalb der Event-Historie (Published Language der Projektdatei `.projekt.json`):
 * Dachform, Überstand, Fenster, Dach-Details, Gauben, Außenprofil, Außen-Deko, Flur-Rollen und Einrichtungsdichte je
 * Raum – als „Choice“ mit allen Feldern gesetzt, dazu die Prüfungen und die Abbildung auf die Optionen des
 * Anwendungsdienstes (`shellOptions`, `exteriorOptions`). Früher in `packages/app/src/usecases.ts`; hier, damit App und
 * Engine-API dieselben Regeln nutzen (C1). Rein.
 */
import { DEFAULT_WINDOW_STYLE, FACADE_QUALITY_RULES, FRAME_ROLES, type DormerStyle, type FacadeStyle, type FrameRole, type RoofDetail, type RoofPitch, type RoofStyle, type RoomId, type WindowStyle } from '@mcda/blueprint';
import { BUILDING_ENTRANCE_MODULES, BUILDING_WINDOW_MODULES } from '@mcda/catalog';
import {
  EXTERIOR_GROUPS, normalizeBlockRules, type AttachedTower, type BaseOptions, type BlockRules, type BuildOptions, type ExteriorGroup, type ExteriorStyle,
} from '@mcda/pipeline';
import { attachedTowersOf, ensembleActive, type SurroundingsState } from './surroundings.js';

/**
 * Dachform neuer Projekte (bis U2a: Walm). Vorschau und Export nutzen dieselbe Hülle (`shellOf(project, shellStyle(session))`).
 * Satteldach, weil erst Giebel die Dach-Details der Voreinstellung zeigen (geschlossener Ortgang, Giebelfenster).
 */
export const DEFAULT_ROOF: RoofStyle = 'gable';
/**
 * Wählbare Dachformen (research/18 §4). Das Pultdach gibt es als eigene Form fürs ganze Projekt; an höheren Wänden
 * (obere Etage) entsteht es bei allen geneigten Formen weiterhin automatisch. Neigung und Details: `RoofDetailChoice`.
 */
export const ROOF_OPTIONS: ReadonlyArray<{ readonly id: RoofStyle; readonly label: string; readonly hint: string }> = [
  { id: 'flat', label: 'Flach', hint: 'Flachdach (Decke = Dach)' },
  { id: 'hip', label: 'Walm', hint: 'Walmdach: alle Seiten geneigt (Treppen und Stufen)' },
  { id: 'gable', label: 'Sattel', hint: 'Satteldach mit Giebelwänden' },
  { id: 'shed', label: 'Pult', hint: 'Pultdach: eine Dachfläche, steigt von der Haustür weg (hohe Rückwand)' },
  { id: 'half_hip', label: 'Krüppelwalm', hint: 'Satteldach mit kleinem Walm an der Giebelspitze (Häuser 7–11 breit)' },
  { id: 'dutch_gable', label: 'Fußwalm', hint: 'Walmdach mit zurückgesetztem Ziergiebel obenauf (breite Häuser)' },
  { id: 'mansard', label: 'Mansarde', hint: 'Mansard-Walmdach: unten steil, oben flach (große Häuser)' },
  { id: 'gambrel', label: 'Scheune', hint: 'Mansard-Satteldach (Gambrel): unten steil, oben flach – Scheune, Stall' },
  { id: 'saltbox', label: 'Saltbox', hint: 'Satteldach mit hoher Vorderseite (Haustür) und langer Rückseite' },
];
/** Dachüberstand in Blöcken (Walm/Sattel). */
export const DEFAULT_OVERHANG = 1;
export const OVERHANG_RANGE = { min: 0, max: 3 } as const;
/** Fenster: an/aus und Mindestzahl Wandzellen zwischen zwei Fenstern. */
export interface WindowChoice {
  readonly enabled: boolean;
  readonly spacing: number;
}
export const DEFAULT_WINDOWS: WindowChoice = { enabled: true, spacing: DEFAULT_WINDOW_STYLE.spacing };
export const WINDOW_SPACING_RANGE = { min: 2, max: 8 } as const;

/** Dachneigung (research/18 D1). */
export const PITCH_OPTIONS: ReadonlyArray<{ readonly id: RoofPitch; readonly label: string; readonly hint: string }> = [
  { id: 'low', label: 'Niedrig', hint: 'Neigung 1:2 – flach geneigt (Anbau, Schuppen, Scheune)' },
  { id: 'normal', label: 'Normal', hint: 'Neigung 1:1 (45°) – das bisherige Dach' },
  { id: 'steep', label: 'Steil', hint: 'Neigung 2:1 – hohes Dach (Fachwerk, Gotik, Nordic)' },
];

/**
 * Dach-Details als App-Einstellung (`RoofDetail` der Domäne, research/18 D1–D7 und W7), alle Felder gesetzt.
 * `halfHipRows`/`mansardBreak`: 0 = automatisch (die Domäne leitet sie aus der Haustiefe ab).
 */
export interface RoofDetailChoice {
  readonly pitch: RoofPitch;
  /** Traufe, Ortgang, First und Grate in der Theme-Rolle `roof_trim` (D2). */
  readonly trim: boolean;
  /** `closed`: Ortgang-Unterseite mit umgedrehten Treppen geschlossen (D2, doppelte Kante). */
  readonly verge: 'plain' | 'closed';
  /** Glockenfuß: unterste Reihe eine Stufe flacher (D3). */
  readonly flare: boolean;
  /** Fenster in Giebel-, Kniestock- und Pultwänden (W7). */
  readonly gableWindows: boolean;
  /** Krüppelwalm/Fußwalm: Walm-Reihen (D6). */
  readonly halfHipRows: number;
  /** Mansarde/Scheune: Knick in Reihen über der Wand (D7). */
  readonly mansardBreak: number;
  /**
   * Additiv (W4-D, `RoofDetail.heightBudget`): automatische Dachhöhe – die gewählte Neigung ist ein Höchstwert, die Hülle
   * senkt sie, bis das Dach ins Höhen-Budget passt (D5/D8; `Shell.roofFit` meldet es). Fehlt/`false` = Neigung genau.
   */
  readonly heightBudget?: boolean | undefined;
  /**
   * Additiv (W4-D, `RoofDetail.split`): breite eingeschossige Satteldächer teilen (Quergiebel bzw. parallele Dächer),
   * statt sie zu hoch werden zu lassen. Fehlt/`true` = Standard der Domäne (teilen); `false` = ein Dach.
   */
  readonly split?: boolean | undefined;
}
export const HALF_HIP_ROWS_RANGE = { min: 1, max: 3 } as const;
export const MANSARD_BREAK_RANGE = { min: 1, max: 4 } as const;
/** Dachformen, die `halfHipRows` bzw. `mansardBreak` nutzen. */
export const usesHalfHipRows = (roof: RoofStyle): boolean => roof === 'half_hip' || roof === 'dutch_gable';
export const usesMansardBreak = (roof: RoofStyle): boolean => roof === 'mansard' || roof === 'gambrel';
/** Dach wie vor dem Dach-Paket: 45°, keine Details. So laden Projektdateien, die noch keine Dach-Details kennen. */
export const PLAIN_ROOF_DETAIL: RoofDetailChoice = {
  pitch: 'normal', trim: false, verge: 'plain', flare: false, gableWindows: false, halfHipRows: 0, mansardBreak: 0,
  // W4-D: ausdrücklich `undefined`, damit der Projektdatei-Leser („nur Felder der Vorgabe“) sie mitliest
  heightBudget: undefined, split: undefined,
};

/** Außenprofil als App-Einstellung (`FacadeStyle` der Domäne, research/18 §3, research/16 Trick #1), alle Felder gesetzt. */
export interface FacadeChoice {
  /** Sockelprofil: Treppen-Anlauf vor der Wand, nicht vor Türen (F2). */
  readonly plinthProfile: boolean;
  /** Gesims an der Etagengrenze (F7). */
  readonly cornice: boolean;
  /** Eckquader an Außenecken (F7). */
  readonly quoins: boolean;
  /** Wandvorlagen (Holzstämme vor der Wand): längster flacher Wandlauf ohne Vorlage; 0 = aus. */
  readonly pilasters: number;
  /** Traufkonsolen unter dem Dachüberstand alle n Blöcke; 0 = aus. */
  readonly brackets: number;
  /**
   * Additiv (F1, research/16 W4): Anbauteile in Außenluft – offene Falltür-Paneele unter den Fenstern und Streben als
   * Treppe vor der Giebelwand in der Holzrolle. Standard `undefined` = Vorgabe des Themes (Fachwerk: an, sonst aus).
   */
  readonly decorate?: boolean | undefined;
  /** Takt der Giebelstreben in Blöcken; 0 = keine (Standard 3). `undefined` = Vorgabe des Themes. */
  readonly gableBraces?: number | undefined;
  /**
   * Additiv (Q2, research/58 §Q2): Fassaden-Pflichtregeln (`FacadeStyle.rules`) – Dachkante mit Überstand,
   * Fensterrahmen mit Rücksprung, Sockel in `foundation`, Vorsprung ab 6 Blöcken, höchstens 3 gleiche Fensterachsen,
   * ein Fokuspunkt je Fassade. Standard neuer Projekte: an; alte Projektdateien ohne das Feld: aus.
   */
  readonly quality?: boolean | undefined;
  /**
   * Additiv (W1-G, Parität App = Engine): Pfeiler-Pflicht der Pflichtregeln (`FacadeRules.pierFrom`). `false` =
   * Pflichtregeln ohne Pfeiler – so kommt ein Bautyp mit Fachwerk-Theme aus `withoutPilastersForTheme` (`@mcda/pipeline`),
   * und so baut ihn die Engine. Fehlt (`undefined`) = mit Pfeilern wie bisher; alte Dateien laden also bitgleich.
   * Wirkt nur mit `quality`.
   */
  readonly piers?: boolean | undefined;
  /**
   * Additiv (W5-B, Parität App = Engine): Rolle der Fensterrahmen der Hülle (`FacadeStyle.frameRole`), z. B.
   * `wall_cornice` aus Burg und Wachturm (Stein-Rahmen über die ganze Breite). Fehlt = Ecken in `window_frame` (bitgleich).
   * Die App zeigt keinen Schalter, trägt den Wert aber mit.
   */
  readonly frameRole?: FrameRole | undefined;
  /**
   * Additiv (W13-E, Parität App = Engine): eigenes Wandkleid der Obergeschosse und Giebel (`FacadeStyle.upperFrame`),
   * aus dem Bautyp (Wohnbauten). Fehlt = bitgleich. Die App zeigt keinen Schalter, trägt den Wert aber mit.
   */
  readonly upperFrame?: boolean | undefined;
  /**
   * Additiv (W16-B, Parität App = Engine): Raumtypen mit Fenster-Pflicht je Etage (`FacadeStyle.lightRooms`), aus dem
   * Bautyp (Bauernhaus: Wohnküche). Fehlt = bitgleich. Die App zeigt keinen Schalter, trägt den Wert aber mit.
   */
  readonly lightRooms?: readonly string[] | undefined;
}
export const GABLE_BRACE_RANGE = { min: 2, max: 6, standard: 3 } as const;
export const PILASTER_RANGE = { min: 3, max: 8, standard: 5 } as const;
export const BRACKET_RANGE = { min: 2, max: 6, standard: 3 } as const;
/**
 * Kein Außenprofil (bisheriges Aussehen; so laden Projektdateien ohne Außenprofil). `decorate`/`gableBraces` stehen
 * ausdrücklich als `undefined` darin, damit der Projektdatei-Leser („nur Felder der Vorgabe“) sie mitliest: fehlen sie
 * in einer alten Datei, bleibt es bei der Theme-Vorgabe.
 */
export const PLAIN_FACADE: FacadeChoice = {
  plinthProfile: false, cornice: false, quoins: false, pilasters: 0, brackets: 0,
  decorate: undefined, gableBraces: undefined, quality: false, piers: undefined, frameRole: undefined, upperFrame: undefined, lightRooms: undefined,
};
/**
 * Voreinstellung neuer Projekte (Begründung mit Screenshots: plan/spikes/U2a_app_dach_fassade.md): 45° mit Kanten,
 * geschlossenem Ortgang und Giebelfenstern; Sockel, Gesims, Eckquader. „Steil“ bleibt eine Wahl (Vorlage
 * Fachwerkhaus): Bei tiefen Häusern (Große Halle, 19 tief) würde das Dach sonst fünfmal so hoch wie die Wand.
 * Q2 (research/58 §Q2): dazu die Fassaden-Pflichtregeln (`quality`).
 */
export const DEFAULT_ROOF_DETAIL: RoofDetailChoice = { ...PLAIN_ROOF_DETAIL, trim: true, verge: 'closed', gableWindows: true };
export const DEFAULT_FACADE: FacadeChoice = { ...PLAIN_FACADE, plinthProfile: true, cornice: true, quoins: true, quality: true };

/** Gauben (`DormerStyle` der Domäne, research/18 D4, plan/spikes/B2_huelle_gauben.md §10), alle Felder gesetzt. */
export interface DormerChoice {
  /** `none` = keine Gauben. */
  readonly kind: 'none' | DormerStyle['kind'];
  /** Frontbreite (Schleppgaube: Scheibenband). */
  readonly width: 1 | 3 | 5;
  /** Mindestabstand zwischen zwei Gaubendächern in Blöcken (weniger Gauben statt enger). */
  readonly minGap: number;
}
export const DORMER_OPTIONS: ReadonlyArray<{ readonly id: DormerChoice['kind']; readonly label: string; readonly name: string; readonly hint: string }> = [
  { id: 'none', label: 'Aus', name: 'aus', hint: 'Keine Gauben' },
  { id: 'gable', label: 'Sattel', name: 'Satteldach-Gaube', hint: 'Satteldach-Gaube: kleiner Giebel mit Fenster' },
  { id: 'shed', label: 'Schlepp', name: 'Schleppgaube', hint: 'Schleppgaube: flaches Dach aus Stufen über einem Fensterband' },
  { id: 'hip', label: 'Walm', name: 'Walmgaube', hint: 'Walmgaube: Satteldach-Gaube mit abgewalmter Spitze' },
  { id: 'blind', label: 'Blind', name: 'Blindgaube', hint: 'Blindgaube: Satteldach-Gaube, hinter der Scheibe ein Vollblock' },
];
export const DORMER_WIDTHS: readonly DormerChoice['width'][] = [1, 3, 5];
export const DORMER_GAP_RANGE = { min: 0, max: 8, standard: 2 } as const;
/** Keine Gauben; Breite und Abstand wie der Standard der Domäne (so laden Projektdateien ohne Gauben). */
export const PLAIN_DORMERS: DormerChoice = { kind: 'none', width: 3, minGap: DORMER_GAP_RANGE.standard };
/**
 * Voreinstellung neuer Projekte: aus. Gauben sind ein Stilmerkmal, keine Grundausstattung – kleine Häuser bekommen bei 45°
 * mit Breite 3 ohnehin keine, große gleich drei je Traufseite, und echte Gauben belichten nur den nicht begehbaren
 * Dachraum. So bleiben neue Projekte und Vorlagen zellgleich zu vorher.
 */
export const DEFAULT_DORMERS: DormerChoice = PLAIN_DORMERS;

/**
 * Außen-Deko als App-Einstellung (`ExteriorStyle` der Domäne, X1): Fensterläden, Blumenkästen, Fensterbänke, Portal,
 * Vordach, Vortreppe, Laternen, Schornsteine, Firstschmuck an den Ankern der Hülle. Alle Felder gesetzt.
 */
export interface ExteriorChoice {
  /** Aus = keine Außen-Komponenten (Welt wie ohne Außen-Deko). */
  readonly enabled: boolean;
  /** Schalter je Gruppe (`EXTERIOR_GROUPS`). */
  readonly groups: Readonly<Record<ExteriorGroup, boolean>>;
  /** 0–2, 1 = Standard: 0 nur Vortreppe, Portal/Vordach und Schornsteine; 2 alle Fassaden, alle Motive. */
  readonly density: number;
  /** Neu würfeln ohne neuen Projekt-Seed: 0 = Grundvariante, jede Zahl eine andere feste Variante. */
  readonly variation: number;
  /**
   * Additiv (W3-CA): Fenstermodul (`ExteriorStyle.windowModule`), z. B. `stone` aus dem Bautyp Burg; fehlt = nach
   * Theme (bitgleich). Die App zeigt keinen Schalter, trägt den Wert aber mit (App = Engine).
   */
  readonly windowModule?: WindowModuleId | undefined;
  /** Additiv (W4-B): Eingangsmodul (`ExteriorStyle.entranceModule`), z. B. `stone` aus Burg und Wachturm; fehlt = nach Theme. */
  readonly entranceModule?: EntranceModuleId | undefined;
  /**
   * Additiv (W5-B): Module im Material des Themes (`ExteriorStyle.themeMaterial`) aus Burg und Wachturm – das Stein-Modul
   * nur an Steinwänden, sonst das Modul des Themes. Fehlt = das gewählte Modul gilt immer (bitgleich).
   */
  readonly themeMaterial?: boolean | undefined;
  /**
   * Additiv (W7-D): Fantasy-Stufe (`ExteriorStyle.fantasy`: off/accent/full); fehlt = nach Theme (elven/dwarven voll,
   * sonst aus – bitgleich). Die App trägt den Wert mit (App = Engine).
   */
  readonly fantasy?: FantasyLevel | undefined;
  /** Additiv (W7-D): Kit der Fantasy-Module (`ExteriorStyle.fantasyKit`: elven/dwarven); fehlt = nach Theme. */
  readonly fantasyKit?: FantasyKitId | undefined;
  /**
   * Additiv (W15): Stufe der Fassaden-Details (`ExteriorStyle.facadeDetail`: off/subtle/rich); fehlt = Standard der Domäne
   * (bitgleich). Die App trägt den Wert mit (App = Engine).
   */
  readonly facadeDetail?: FacadeDetailLevel | undefined;
  /** Additiv (W15): einzeln abgeschaltete Muster (`ExteriorStyle.facadeDetailOff`); fehlt = keins. */
  readonly facadeDetailOff?: readonly FacadeDetailPattern[] | undefined;
}

type FacadeDetailLevel = NonNullable<ExteriorStyle['facadeDetail']>;
type FacadeDetailPattern = NonNullable<ExteriorStyle['facadeDetailOff']>[number];
/** W15: gültige Werte (Typprüfung wie bei Fantasy: jede Stufe bzw. jedes Muster der Domäne steht hier). */
const FACADE_DETAIL_LEVEL_LIST = ['off', 'subtle', 'rich', 'grand'] as const satisfies readonly FacadeDetailLevel[];
const FACADE_DETAIL_PATTERN_LIST = [
  'jettyCorbels', 'sillCorbels', 'eaveDentils', 'gablePendant', 'gableBanner', 'shopShelves', 'entranceGoods', 'rainBarrels', 'woodStack',
  'balcony', 'orielWindow', 'windowHoods', 'stringCourse', 'buttress', 'weathervane', 'bellTurret', 'trellis', 'dovecote',
  'plinthLedge', 'pilasters', 'blindArch', 'downspout',
] as const satisfies readonly FacadeDetailPattern[];
const FACADE_DETAIL_LEVEL_IDS: ReadonlySet<string> = new Set(FACADE_DETAIL_LEVEL_LIST);
const FACADE_DETAIL_PATTERN_IDS: ReadonlySet<string> = new Set(FACADE_DETAIL_PATTERN_LIST);

type FantasyLevel = NonNullable<ExteriorStyle['fantasy']>;
type FantasyKitId = NonNullable<ExteriorStyle['fantasyKit']>;
/** W7-D: gültige Werte (Typprüfung: jede Stufe bzw. jedes Kit der Domäne steht hier, `Exhaustive`). */
const FANTASY_LEVEL_LIST = ['off', 'accent', 'full'] as const satisfies readonly FantasyLevel[];
const FANTASY_KIT_LIST = ['elven', 'dwarven'] as const satisfies readonly FantasyKitId[];
type Exhaustive<T, L extends readonly unknown[]> = [Exclude<T, L[number]>] extends [never] ? true : never;
const _fantasyCovered: Exhaustive<FantasyLevel, typeof FANTASY_LEVEL_LIST> & Exhaustive<FantasyKitId, typeof FANTASY_KIT_LIST> = true;
void _fantasyCovered;
const _detailCovered: Exhaustive<FacadeDetailLevel, typeof FACADE_DETAIL_LEVEL_LIST> & Exhaustive<FacadeDetailPattern, typeof FACADE_DETAIL_PATTERN_LIST> = true;
void _detailCovered;
const FANTASY_LEVEL_IDS: ReadonlySet<string> = new Set(FANTASY_LEVEL_LIST);
const FANTASY_KIT_IDS: ReadonlySet<string> = new Set(FANTASY_KIT_LIST);

type WindowModuleId = NonNullable<ExteriorStyle['windowModule']>;
const WINDOW_MODULE_IDS: ReadonlySet<string> = new Set(BUILDING_WINDOW_MODULES);
type EntranceModuleId = NonNullable<ExteriorStyle['entranceModule']>;
const ENTRANCE_MODULE_IDS: ReadonlySet<string> = new Set(BUILDING_ENTRANCE_MODULES);
export const EXTERIOR_DENSITY_RANGE = { min: 0, max: 2, step: 0.25, standard: 1 } as const;
/** Dachteile der Außen-Deko: hängen an der Einrichtung (Schornsteine) und liegen über dem Gelände. */
export const EXTERIOR_ROOF_GROUPS: ReadonlySet<ExteriorGroup> = new Set<ExteriorGroup>(['chimneys', 'eaveLanterns', 'ridgeDecor', 'eaveBraces']);
const ALL_GROUPS = Object.fromEntries(EXTERIOR_GROUPS.map((g) => [g, true])) as Record<ExteriorGroup, boolean>;
/** Keine Außen-Deko (so laden Projektdateien ohne Außen-Deko). */
export const PLAIN_EXTERIOR: ExteriorChoice = { enabled: false, groups: ALL_GROUPS, density: EXTERIOR_DENSITY_RANGE.standard, variation: 0 };
/** Voreinstellung neuer Projekte (Begründung mit Screenshots: plan/spikes/U3_app_aussen.md): an, alle Gruppen, Dichte 1. */
export const DEFAULT_EXTERIOR: ExteriorChoice = { ...PLAIN_EXTERIOR, enabled: true };
/** Dichte-Regler der Einrichtung (`FurnishOptions.density`): 0–2, 1 = Standard des Raumtyps. */
export const DENSITY_RANGE = { min: 0, max: 2, step: 0.25, standard: 1 } as const;

/**
 * Gestaltung von außen: Hülle und Außen-Deko (App-Einstellungen, nicht Teil der Event-Historie; mit dem Projekt
 * gespeichert). Die Hülle hängt nur an `shellKey` (ohne Außen-Deko), Blöcke und Export an `styleKey`.
 */
export interface ShellStyle {
  readonly roof: RoofStyle;
  readonly overhang: number;
  readonly windows: WindowChoice;
  readonly roofDetail: RoofDetailChoice;
  readonly dormers: DormerChoice;
  readonly facade: FacadeChoice;
  readonly exterior: ExteriorChoice;
  /** Q4: gewählte Farbpalette (`catalog/palettes`); fehlt = Themefarben (bitgleich). */
  readonly paletteId?: string | undefined;
  /**
   * Angedockte Türme (C4) aus der Umgebung (`StructureItem` `annex`): Sie ändern die Hülle (Türen in der Hauswand,
   * Aussparung im Dach). Abgeleitet aus `Session.surroundings`, nie als Einstellung gespeichert; fehlt = keine.
   */
  readonly towers?: readonly AttachedTower[];
  /**
   * Additiv (F-Ensemble): Umgebung, deren Verbindungsgraph die Hülle ändert (Brückentüren in den Obergeschossen). Nur
   * gesetzt, wenn der Graph wirkt (`ensembleActive`); abgeleitet aus `Session.surroundings`, nie gespeichert. Die App
   * löst ihn in `shellOf` mit dem Anwendungsdienst auf (`resolveEnsemble`), wie `generateBase` in der Engine.
   */
  readonly ensemble?: SurroundingsState;
  /**
   * Raumtypen mit Flur-Rolle in der Hülle (Eingangs- bzw. Flurraum eines Bautyps: Haustür, Türen zu allen Nachbarn);
   * fehlt = Standard der Hülle. Setzt der Bautyp-Assistent (buildingTypes.ts), damit die Türen dem geprüften Plan folgen.
   */
  readonly corridorTypes?: readonly string[] | undefined;
  /**
   * Feature Unterbau (feat/underground): Zusatztüren für Rundgänge (`BuildOptions.loopDoors`, Wahrscheinlichkeit je
   * Raumpaar). Setzt der Bautyp-Assistent aus dem Plan (`BuildingPlan.loopDoors`); fehlt = Türbaum wie bisher.
   */
  readonly loopDoors?: number | undefined;
  /**
   * WS-Fassade (Bauprozess Schritt 4): Fassadenrhythmus – Fensterachsen im Takt auf flachen Wänden und Gauben auf leeren
   * Dachflächen (`BuildOptions.facadeRhythm`). `true` = an; fehlt = aus (bitgleich).
   */
  readonly facadeRhythm?: boolean | undefined;
  /**
   * Additiv (W3-BL): gesperrte Blöcke samt festen Ersetzungen (Tab „Material“, Preset „Nur leicht farmbar“). Wirkt auf
   * Blöcke, Export und die Auswahl der Möbel-Varianten, nicht auf die Hülle; fehlt = keine Sperren (bitgleich).
   */
  readonly blockRules?: BlockRules | undefined;
}

/** Alle Einstellungen der Sitzung außerhalb der Historie. */
export interface SessionSettings extends ShellStyle {
  /** Einrichtungsdichte je Raum; fehlt ein Raum, gilt 1 (Standard des Raumtyps). */
  readonly density: ReadonlyMap<RoomId, number>;
  /**
   * P07: verbindlicher Mittelgang. Fehlt/false = aus und bitgleich zu vorher; `true` hält den Gang eines Raumtyps
   * mindestens auf `aisle.minWidth` (statt ihn bei Platzmangel aufzugeben) und meldet den Konflikt mit Pflichtmöbeln
   * als Warnung. Wird an `FurnishOptions.minAisle` von `@mcda/furnishing` durchgereicht – in der App wie in der
   * Engine-Operation `project_furnish`.
   */
  readonly minAisle?: boolean | undefined;
}

/** Felder, aus denen der Stil entsteht (Sitzung der App, Engine-Session aus einer App-Datei). */
export interface StyleFields {
  readonly roof: RoofStyle;
  readonly overhang?: number | undefined;
  readonly windows?: WindowChoice | undefined;
  readonly roofDetail?: RoofDetailChoice | undefined;
  readonly dormers?: DormerChoice | undefined;
  readonly facade?: FacadeChoice | undefined;
  readonly exterior?: ExteriorChoice | undefined;
  /** Q4: gewählte Farbpalette; fehlt = Themefarben. */
  readonly paletteId?: string | undefined;
  readonly surroundings?: SurroundingsState | undefined;
  readonly corridorTypes?: readonly string[] | undefined;
  /** Feature Unterbau: Zusatztüren für Rundgänge; fehlt = keine. */
  readonly loopDoors?: number | undefined;
  /** WS-Fassade: Fassadenrhythmus an; fehlt = aus. */
  readonly facadeRhythm?: boolean | undefined;
  /** W3-BL: gesperrte Blöcke; fehlt = keine. */
  readonly blockRules?: BlockRules | undefined;
}

const NO_DENSITY: ReadonlyMap<RoomId, number> = new Map();


export function settingsOf(s: StyleFields & { readonly density?: ReadonlyMap<RoomId, number> | undefined; readonly minAisle?: boolean | undefined }): SessionSettings {
  return { ...shellStyle(s), density: s.density ?? NO_DENSITY, ...(s.minAisle === true ? { minAisle: true } : {}) };
}


/** Stil der Sitzung von außen (für `shellOf`, `worldOf`, `exteriorOf`, Licht-Pass); mit den angedockten Türmen. */
export function shellStyle(s: StyleFields): ShellStyle {
  const towers = attachedTowersOf(s.surroundings);
  return {
    roof: s.roof,
    overhang: s.overhang ?? DEFAULT_OVERHANG,
    windows: s.windows ?? DEFAULT_WINDOWS,
    roofDetail: s.roofDetail ?? DEFAULT_ROOF_DETAIL,
    dormers: s.dormers ?? DEFAULT_DORMERS,
    facade: s.facade ?? DEFAULT_FACADE,
    exterior: s.exterior ?? DEFAULT_EXTERIOR,
    ...(s.paletteId !== undefined ? { paletteId: s.paletteId } : {}),
    ...(towers.length > 0 ? { towers } : {}),
    ...(ensembleActive(s.surroundings) ? { ensemble: s.surroundings! } : {}),
    ...(s.corridorTypes !== undefined ? { corridorTypes: s.corridorTypes } : {}),
    ...(s.loopDoors !== undefined ? { loopDoors: s.loopDoors } : {}),
    ...(s.facadeRhythm === true ? { facadeRhythm: true } : {}),
    ...blockRulesField(s.blockRules),
  };
}

/** Block-Regeln in Normalform als optionales Feld (leer = weglassen). */
const blockRulesField = (r: BlockRules | undefined): { blockRules?: BlockRules } => {
  const n = normalizeBlockRules(r);
  return n === undefined ? {} : { blockRules: n };
};

/** Nur eine Dachform: alles andere wie bei neuen Projekten. */
export const toStyle = (style: RoofStyle | ShellStyle): ShellStyle => (typeof style === 'string' ? shellStyle({ roof: style }) : style);

/**
 * Keine Fenster (B2): weder in Wänden noch im Giebel noch in Gauben. Ersetzt die frühere Kodierung über einen
 * Randabstand größer als jede Wand – die Hülle ist zellgleich (Test dormers.test.ts). Nur im Speicher, nie serialisiert.
 */
const NO_WINDOWS: WindowStyle = { enabled: false };

/**
 * Dach-Details → `RoofDetail` der Domäne. Nur, was die Dachform nutzt (Walm-Reihen, Knick); Giebelfenster nur, wenn
 * Fenster an sind („Fenster aus“ heißt: keine Fenster, auch nicht im Giebel). Das schlichte Dach ohne Details bleibt
 * `undefined` (= Hülle wie vor dem Dach-Paket).
 */
export function roofDetailOptions(roof: RoofStyle, d: RoofDetailChoice, windows = true): RoofDetail | undefined {
  const rows = usesHalfHipRows(roof) && d.halfHipRows > 0;
  const knee = usesMansardBreak(roof) && d.mansardBreak > 0;
  const gableWindows = d.gableWindows && windows;
  const budget = d.heightBudget === true;
  // `split: false` allein braucht keine Details: das schlichte Dach wird ohnehin nicht geteilt
  if (d.pitch === 'normal' && !d.trim && d.verge === 'plain' && !d.flare && !gableWindows && !rows && !knee && !budget) return undefined;
  return {
    pitch: d.pitch,
    gableWindows,
    ...(d.trim ? { trim: true } : {}),
    ...(d.verge === 'closed' ? { verge: 'closed' as const } : {}),
    ...(d.flare ? { flare: true } : {}),
    ...(rows ? { halfHipRows: d.halfHipRows } : {}),
    ...(knee ? { mansardBreak: d.mansardBreak } : {}),
    ...(budget ? { heightBudget: true } : {}),
    ...(d.split === false ? { split: false } : {}),
  };
}

/** Pflichtregeln ohne Pfeiler (`piers: false`): wie `withoutPilastersForTheme` sie für Fachwerk-Themes liefert. */
const { pierFrom: _pierFrom, ...RULES_WITHOUT_PIERS } = FACADE_QUALITY_RULES;

/** Außenprofil → `FacadeStyle` der Domäne; alles aus = `undefined` (Hülle ohne Profil). */
export function facadeOptions(f: FacadeChoice): FacadeStyle | undefined {
  const out: FacadeStyle = {
    ...(f.quality === true ? { rules: f.piers === false ? RULES_WITHOUT_PIERS : FACADE_QUALITY_RULES } : {}),
    ...(f.plinthProfile ? { plinthProfile: true } : {}),
    ...(f.cornice ? { cornice: true } : {}),
    ...(f.quoins ? { quoins: true } : {}),
    ...(f.pilasters > 0 ? { pilasters: f.pilasters } : {}),
    ...(f.brackets > 0 ? { brackets: f.brackets } : {}),
    // W5-B: Rahmenrolle der Hülle (Burg: Stein-Rahmen); fehlt = bitgleich
    ...(f.frameRole !== undefined ? { frameRole: f.frameRole } : {}),
    // W13-E: Wandkleid der Obergeschosse; fehlt = bitgleich
    ...(f.upperFrame === true ? { upperFrame: true } : {}),
    // W16-B: Fenster-Pflicht je Raumtyp; fehlt/leer = bitgleich
    ...(f.lightRooms !== undefined && f.lightRooms.length > 0 ? { lightRooms: f.lightRooms } : {}),
    // F1-Deko: nur Abweichungen von der Theme-Vorgabe; die Pipeline mischt sie mit `timberDecor` des Themes
    ...(f.decorate === true ? { decor: { panels: true, gableBraces: f.gableBraces ?? GABLE_BRACE_RANGE.standard } }
      : f.decorate === false ? { decor: { panels: false, gableBraces: 0 } }
      : f.gableBraces !== undefined ? { decor: { gableBraces: f.gableBraces } }
      : {}),
  };
  return Object.keys(out).length === 0 ? undefined : out;
}

/** Gauben → `DormerStyle` der Domäne; aus oder Flachdach (keine geneigte Fläche) = `undefined` (Hülle ohne Gauben). */
export function dormerOptions(roof: RoofStyle, d: DormerChoice): DormerStyle | undefined {
  if (d.kind === 'none' || roof === 'flat') return undefined;
  return { kind: d.kind, width: d.width, minGap: d.minGap };
}

/**
 * Außen-Deko → `ExteriorStyle` der Domäne; aus = `undefined` (weglassen heißt aus – `{}` hieße „alles an“).
 * Nur Abweichungen: ausgeschaltete Gruppen als `false`, `variation` nur, wenn neu gewürfelt.
 */
export function exteriorOptions(e: ExteriorChoice): ExteriorStyle | undefined {
  if (!e.enabled) return undefined;
  return {
    density: e.density,
    ...(e.variation !== 0 ? { variation: e.variation } : {}),
    ...(e.windowModule !== undefined ? { windowModule: e.windowModule } : {}),
    ...(e.entranceModule !== undefined ? { entranceModule: e.entranceModule } : {}),
    ...(e.themeMaterial !== undefined ? { themeMaterial: e.themeMaterial } : {}),
    ...(e.fantasy !== undefined ? { fantasy: e.fantasy } : {}),
    ...(e.fantasyKit !== undefined ? { fantasyKit: e.fantasyKit } : {}),
    ...(e.facadeDetail !== undefined ? { facadeDetail: e.facadeDetail } : {}),
    ...(e.facadeDetailOff !== undefined && e.facadeDetailOff.length > 0 ? { facadeDetailOff: e.facadeDetailOff } : {}),
    ...Object.fromEntries(EXTERIOR_GROUPS.filter((g) => !e.groups[g]).map((g) => [g, false])),
    // W4-D: Traufkonsolen folgen ohne Angabe den Traufenlaternen – an trotz Laternen aus nur ausdrücklich
    ...(e.groups.eaveBraces && !e.groups.eaveLanterns ? { eaveBraces: true } : {}),
  };
}

/** Hüllen-Stil → Optionen des Anwendungsdienstes (`shellFor`). */
export function shellOptions(style: RoofStyle | ShellStyle): BuildOptions {
  const s = toStyle(style);
  const roofDetail = roofDetailOptions(s.roof, s.roofDetail, s.windows.enabled);
  const facade = facadeOptions(s.facade);
  const dormers = dormerOptions(s.roof, s.dormers);
  return {
    roof: s.roof,
    overhang: s.overhang,
    windows: s.windows.enabled ? { spacing: s.windows.spacing } : NO_WINDOWS,
    ...(roofDetail !== undefined ? { roofDetail } : {}),
    ...(dormers !== undefined ? { dormers } : {}),
    ...(facade !== undefined ? { facade } : {}),
    ...(s.corridorTypes !== undefined ? { corridorTypes: s.corridorTypes } : {}),
    ...(s.loopDoors !== undefined ? { loopDoors: s.loopDoors } : {}),
    ...(s.facadeRhythm === true ? { facadeRhythm: { windows: true, dormers: true } } : {}),
    ...blockRulesField(s.blockRules),
  };
}

const PITCHES: ReadonlySet<string> = new Set(PITCH_OPTIONS.map((p) => p.id));
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
/** 0 (aus bzw. automatisch) oder im Bereich. */
const offOr = (v: unknown, range: { readonly min: number; readonly max: number }): v is number => v === 0 || isInt(v, range.min, range.max);

/** Gültige Dach-Details? Sonst die Begründung (für Fehler und das tolerante Laden). */
export function roofDetailProblem(d: RoofDetailChoice): string | undefined {
  if (!PITCHES.has(d.pitch)) return `Unbekannte Dachneigung „${String(d.pitch)}“`;
  if (typeof d.trim !== 'boolean' || typeof d.flare !== 'boolean' || typeof d.gableWindows !== 'boolean') return 'Dach-Details: an/aus erwartet';
  if (d.verge !== 'plain' && d.verge !== 'closed') return `Unbekannter Ortgang „${String(d.verge)}“`;
  if (!offOr(d.halfHipRows, HALF_HIP_ROWS_RANGE)) return `Walm-Reihen ${d.halfHipRows} nicht erlaubt (automatisch oder ${HALF_HIP_ROWS_RANGE.min}–${HALF_HIP_ROWS_RANGE.max})`;
  if (!offOr(d.mansardBreak, MANSARD_BREAK_RANGE)) return `Knickhöhe ${d.mansardBreak} nicht erlaubt (automatisch oder ${MANSARD_BREAK_RANGE.min}–${MANSARD_BREAK_RANGE.max})`;
  if (d.heightBudget !== undefined && typeof d.heightBudget !== 'boolean') return 'Automatische Dachhöhe: an/aus erwartet';
  if (d.split !== undefined && typeof d.split !== 'boolean') return 'Dach teilen: an/aus erwartet';
  return undefined;
}

/** Gültiges Außenprofil? Sonst die Begründung. */
export function facadeProblem(f: FacadeChoice): string | undefined {
  if (typeof f.plinthProfile !== 'boolean' || typeof f.cornice !== 'boolean' || typeof f.quoins !== 'boolean') return 'Außenprofil: an/aus erwartet';
  if (f.quality !== undefined && typeof f.quality !== 'boolean') return 'Fassaden-Pflichtregeln: an/aus erwartet';
  if (f.piers !== undefined && typeof f.piers !== 'boolean') return 'Pfeiler-Pflicht: an/aus erwartet';
  if (f.frameRole !== undefined && !(FRAME_ROLES as readonly string[]).includes(f.frameRole)) return `Unbekannte Rahmenrolle „${String(f.frameRole)}“`;
  if (f.upperFrame !== undefined && typeof f.upperFrame !== 'boolean') return 'Wandkleid der Obergeschosse: an/aus erwartet';
  if (f.lightRooms !== undefined && (!Array.isArray(f.lightRooms) || f.lightRooms.some((t) => typeof t !== 'string'))) return 'Fenster-Pflicht: Liste von Raumtypen erwartet';
  if (f.decorate !== undefined && typeof f.decorate !== 'boolean') return 'Fachwerk-Deko: an/aus erwartet';
  if (f.gableBraces !== undefined && !offOr(f.gableBraces, GABLE_BRACE_RANGE)) return `Giebelstreben alle ${f.gableBraces} nicht erlaubt (aus oder ${GABLE_BRACE_RANGE.min}–${GABLE_BRACE_RANGE.max})`;
  if (!offOr(f.pilasters, PILASTER_RANGE)) return `Wandvorlagen alle ${f.pilasters} nicht erlaubt (aus oder ${PILASTER_RANGE.min}–${PILASTER_RANGE.max})`;
  if (!offOr(f.brackets, BRACKET_RANGE)) return `Konsolen alle ${f.brackets} nicht erlaubt (aus oder ${BRACKET_RANGE.min}–${BRACKET_RANGE.max})`;
  return undefined;
}

const DORMER_KINDS: ReadonlySet<string> = new Set(DORMER_OPTIONS.map((o) => o.id));

/** Gültige Gauben? Sonst die Begründung. */
export function dormerProblem(d: DormerChoice): string | undefined {
  if (!DORMER_KINDS.has(d.kind)) return `Unbekannte Gaubenart „${String(d.kind)}“`;
  if (!DORMER_WIDTHS.includes(d.width)) return `Gaubenbreite ${String(d.width)} nicht erlaubt (${DORMER_WIDTHS.join(', ')})`;
  if (!isInt(d.minGap, DORMER_GAP_RANGE.min, DORMER_GAP_RANGE.max)) {
    return `Gaubenabstand ${String(d.minGap)} nicht erlaubt (${DORMER_GAP_RANGE.min}–${DORMER_GAP_RANGE.max})`;
  }
  return undefined;
}

/** Gültige Außen-Deko? Sonst die Begründung. */
export function exteriorProblem(e: ExteriorChoice): string | undefined {
  if (typeof e.enabled !== 'boolean' || typeof e.groups !== 'object' || e.groups === null || EXTERIOR_GROUPS.some((g) => typeof e.groups[g] !== 'boolean')) {
    return 'Außen-Deko: an/aus erwartet';
  }
  const d = e.density;
  if (typeof d !== 'number' || !Number.isFinite(d) || d < EXTERIOR_DENSITY_RANGE.min || d > EXTERIOR_DENSITY_RANGE.max) {
    return `Außen-Dichte ${String(d)} nicht erlaubt (${EXTERIOR_DENSITY_RANGE.min}–${EXTERIOR_DENSITY_RANGE.max})`;
  }
  if (!isInt(e.variation, 0, Number.MAX_SAFE_INTEGER)) return `Außen-Variante ${String(e.variation)} nicht erlaubt (ganze Zahl ab 0)`;
  if (e.windowModule !== undefined && !WINDOW_MODULE_IDS.has(e.windowModule)) return `Unbekanntes Fenstermodul „${String(e.windowModule)}“`;
  if (e.entranceModule !== undefined && !ENTRANCE_MODULE_IDS.has(e.entranceModule)) return `Unbekanntes Eingangsmodul „${String(e.entranceModule)}“`;
  if (e.themeMaterial !== undefined && typeof e.themeMaterial !== 'boolean') return 'Module im Material des Themes: an/aus erwartet';
  if (e.fantasy !== undefined && !FANTASY_LEVEL_IDS.has(e.fantasy)) return `Unbekannte Fantasy-Stufe „${String(e.fantasy)}“`;
  if (e.fantasyKit !== undefined && !FANTASY_KIT_IDS.has(e.fantasyKit)) return `Unbekanntes Fantasy-Kit „${String(e.fantasyKit)}“`;
  if (e.facadeDetail !== undefined && !FACADE_DETAIL_LEVEL_IDS.has(e.facadeDetail)) return `Unbekannte Stufe der Fassaden-Details „${String(e.facadeDetail)}“`;
  if (e.facadeDetailOff !== undefined && (!Array.isArray(e.facadeDetailOff) || e.facadeDetailOff.some((x) => !FACADE_DETAIL_PATTERN_IDS.has(x)))) {
    return 'Fassaden-Details: unbekanntes Muster';
  }
  return undefined;
}

/** `BuildOptions` des Anwendungsdienstes → Stil der Sitzung (Rückübersetzung zu `shellOptions`/`exteriorOptions`). */
export function styleFromBuild(b: BaseOptions): ShellStyle {
  const d = b.roofDetail;
  const f = b.facade;
  const x = b.exterior;
  const exterior: ExteriorChoice = x === undefined ? PLAIN_EXTERIOR : {
    enabled: true,
    groups: {
      ...Object.fromEntries(Object.keys(PLAIN_EXTERIOR.groups).map((g) => [g, (x as Record<string, unknown>)[g] !== false])) as unknown as ExteriorChoice['groups'],
      // W4-D: Traufkonsolen ohne Angabe wie die Traufenlaternen
      eaveBraces: (x.eaveBraces ?? x.eaveLanterns) !== false,
    },
    density: x.density ?? 1,
    variation: x.variation ?? 0,
    ...(x.windowModule !== undefined ? { windowModule: x.windowModule } : {}),
    ...(x.entranceModule !== undefined ? { entranceModule: x.entranceModule } : {}),
    ...(x.themeMaterial !== undefined ? { themeMaterial: x.themeMaterial } : {}),
    ...(x.fantasy !== undefined ? { fantasy: x.fantasy } : {}),
    ...(x.fantasyKit !== undefined ? { fantasyKit: x.fantasyKit } : {}),
    ...(x.facadeDetail !== undefined ? { facadeDetail: x.facadeDetail } : {}),
    ...(x.facadeDetailOff !== undefined ? { facadeDetailOff: x.facadeDetailOff } : {}),
  };
  return {
    roof: b.roof ?? 'gable',
    overhang: b.overhang ?? DEFAULT_OVERHANG,
    windows: { enabled: b.windows?.enabled !== false, spacing: b.windows?.spacing ?? DEFAULT_WINDOWS.spacing },
    roofDetail: d === undefined ? PLAIN_ROOF_DETAIL : {
      // Giebelfenster: Standard der Domäne ist „an“
      pitch: d.pitch ?? 'normal', trim: d.trim ?? false, verge: d.verge ?? 'plain', flare: d.flare ?? false, gableWindows: d.gableWindows ?? true,
      halfHipRows: d.halfHipRows ?? 0, mansardBreak: d.mansardBreak ?? 0,
      ...(d.heightBudget === true ? { heightBudget: true } : {}),
      ...(d.split === false ? { split: false } : {}),
    },
    dormers: b.dormers === undefined ? PLAIN_DORMERS : { kind: b.dormers.kind, width: b.dormers.width ?? 3, minGap: b.dormers.minGap ?? DORMER_GAP_RANGE.standard },
    facade: f === undefined ? PLAIN_FACADE : {
      plinthProfile: f.plinthProfile ?? false, cornice: f.cornice ?? false, quoins: f.quoins ?? false, pilasters: f.pilasters ?? 0, brackets: f.brackets ?? 0,
      quality: f.rules !== undefined,
      // Pflichtregeln ohne Pfeiler (Fachwerk-Theme, `withoutPilastersForTheme`): sonst setzte `facadeOptions` sie wieder
      ...(f.rules !== undefined && f.rules.pierFrom === undefined ? { piers: false } : {}),
      ...(f.frameRole !== undefined ? { frameRole: f.frameRole } : {}),
      ...(f.upperFrame === true ? { upperFrame: true } : {}),
      ...(f.lightRooms !== undefined && f.lightRooms.length > 0 ? { lightRooms: f.lightRooms } : {}),
    },
    exterior,
    ...(b.corridorTypes !== undefined ? { corridorTypes: b.corridorTypes } : {}),
    ...(b.loopDoors !== undefined ? { loopDoors: b.loopDoors } : {}),
    ...(b.facadeRhythm !== undefined && (b.facadeRhythm.windows === true || b.facadeRhythm.dormers === true) ? { facadeRhythm: true } : {}),
    ...blockRulesField(b.blockRules),
  };
}
