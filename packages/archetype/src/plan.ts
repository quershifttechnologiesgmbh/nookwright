/**
 * VERTRAG „Bauplan“ (research/19 §7.3): Ergebnis des Grundriss-Generators, reine Daten. Übernommen wird er über die
 * normalen Projekt-Befehle (Etagen anlegen, Räume malen, Treppen setzen, Stil setzen) – der Bautyp ist nur der
 * Startwert, danach ist es ein normales Projekt (ADR 10).
 */
import type {
  BuildingSetting, DormerStyle, FacadeStyle, RoofDetail, RoofStyle, StairTurn, StairType, Volume, VolumeId, WindowStyle,
} from '@mcda/blueprint';
import type { BuildingSizeClass, FunctionLevel } from '@mcda/catalog';
import type { Cell, CellSet, HorizontalDir } from '@mcda/core';
import type { SilhouetteMode } from './silhouette.js';
import type { UndergroundParams, UndergroundReport } from './underground.js';

/** Parameter des Assistenten (research/19 §7.7); alles optional, der Bautyp liefert die Standards. */
export interface BuildingParams {
  readonly size?: BuildingSizeClass;
  /** Blickrichtung der Front (Straße); Standard Süden. */
  readonly front?: HorizontalDir;
  /** Etagen ab dem Erdgeschoss (in den Grenzen der Größe). */
  readonly floors?: number;
  readonly setting?: BuildingSetting;
  /** Theme des Projekts (nur für den Stil-Hinweis `styleTags`). */
  readonly themeId?: string;
  /** Stil-Vorgaben, die die Definition überschreiben (je Feld ganz). */
  readonly shell?: Partial<PlanShell>;
  /** Linke obere Ecke des Plans im Projekt (Standard 0, 0; die App zentriert im Raster). */
  readonly at?: Cell;
  /** „Grundriss neu würfeln“: anderer Grundriss bei gleichem Projekt-Seed (`BuildingTypeOrigin.rerollCount`). */
  readonly reroll?: number;
  /**
   * Feature-Schalter (feat/underground): Unterbau – Keller-/Dungeon-Ebene unter und um das Haus samt Zusatztüren für
   * Rundgänge im Haus (`underground.ts`). Fehlt oder `false` = bitgleich wie ohne.
   */
  readonly underground?: boolean | UndergroundParams;
  /**
   * Zusatztüren für Rundgänge im Haus (`ShellOptions.loopDoors`, `doors.ts` Schritt 5): Wahrscheinlichkeit je
   * benachbartem, noch nicht verbundenem Raumpaar. Eigener Schalter (nicht am Unterbau); fehlt oder 0 = Türbaum wie bisher.
   */
  readonly loopDoors?: number;
  /**
   * Funktionsgrad (W2-1): `off` (Standard, bitgleich wie ohne) | `some` (1–2 passende Funktionsräume je nach Typ und
   * Größe) | `rich` (mehr und größere). Welche Räume, steht je Bautyp im Katalog (`functions`); die Auswahl kommt aus dem
   * Seed, der Rest des Plans folgt dem Programm wie gewohnt.
   */
  readonly functionLevel?: FunctionLevel;
  /**
   * Silhouette (WS 7 Schritte, Schritt 2): `off` (Standard, bitgleich wie ohne) | `varied` (einteilige Bautypen bekommen
   * einen niedrigeren Anbau mit eigener Dachform und ungeraden Maßen – jede Teilform eine andere Dachhöhe; `silhouette.ts`).
   */
  readonly silhouette?: SilhouetteMode;
}

/** Hüllen-Stil des Plans in den Begriffen der Domäne (= `BuildOptions` des Anwendungsdienstes, ohne Anbauten). */
export interface PlanShell {
  readonly roof: RoofStyle;
  readonly overhang: number;
  readonly windows: WindowStyle;
  readonly roofDetail?: RoofDetail;
  readonly dormers?: DormerStyle;
  readonly facade?: FacadeStyle;
}

/** Außengestaltung (X1) in den Begriffen von `ExteriorStyle`: Dichte und ausgeschaltete Gruppen. */
export interface PlanExterior {
  readonly density: number;
  readonly off: readonly string[];
  /** W3-CA: Fenstermodul des Bautyps (`ExteriorStyle.windowModule`); fehlt = nach Theme. */
  readonly windowModule?: 'townhouse' | 'cottage' | 'timber' | 'stone' | 'nordic' | 'fort';
  /** W4-B: Eingangsmodul des Bautyps (`ExteriorStyle.entranceModule`); fehlt = nach Theme. */
  readonly entranceModule?: 'townhouse' | 'cottage' | 'timber' | 'stone' | 'nordic';
  /** W5-B: Module im Material des Themes (`ExteriorStyle.themeMaterial`); fehlt = das Modul des Bautyps gilt immer. */
  readonly themeMaterial?: boolean;
}

export interface PlanFloor {
  readonly index: number;
  /** Lichte Höhe. */
  readonly height: number;
}

export interface PlanRoom {
  readonly volumeId: VolumeId;
  readonly floor: number;
  readonly cells: CellSet;
  readonly roomTypeId: string;
  /** Index des Programm-Eintrags (fester Grundriss: −1). */
  readonly entry: number;
  readonly required: boolean;
}

export interface PlanStairs {
  readonly volumeId: VolumeId;
  /** Untere Etage. */
  readonly floor: number;
  readonly origin: Cell;
  readonly facing: HorizontalDir;
  readonly type: StairType;
  readonly turn?: StairTurn;
}

export interface PlanSiteZone {
  readonly kind: string;
  readonly at: 'front' | 'back' | 'left' | 'right';
  readonly depth: number;
  readonly width?: number;
  readonly gap?: number;
  /** W16-B: vor diesem Ensemble-Teil statt vor dem ganzen Gebäude. */
  readonly part?: string;
  /** W16-B: mittig (Standard) oder bündig mit dem Ende zum Hauptbau. */
  readonly align?: 'center' | 'inner';
}

export interface PlanSite {
  readonly template?: string;
  readonly style?: string;
  readonly lighting?: 'none' | 'paths' | 'spawnproof';
  readonly margin: number;
  readonly zones: readonly PlanSiteZone[];
}

/** W12-C: Hochsilo neben einem Ensemble-Teil (Begriffe von `SiloSpec` der Bauwerke). */
export interface PlanSilo {
  /** Mitte relativ zum Plan (x, z). */
  readonly center: Cell;
  readonly radius: number;
  readonly height: number;
}

export interface PlanWindmill {
  /** Mitte relativ zum Plan (x, z). */
  readonly center: Cell;
  readonly levels: number;
  readonly facing: HorizontalDir;
}

/** Ensemble-Teil (research/19 §7.4): Baukörper, Etagen, Wehrplatte. */
export interface PlanPart {
  readonly id: string;
  readonly volumeId: VolumeId;
  readonly floors: number;
  /** Zinnenkranz bzw. Ausguck (W3-CA) auf dem Flachdach (Bauwerk-Aufsatz im Anwendungsdienst). */
  readonly parapet?: PlanParapetCrown;
  /** W3-CA: Belag auf dem Flachdach. */
  readonly parapetDeck?: boolean;
}

/** Abschluss einer Wehrplatte (Begriffe von `ParapetCrown` der Bauwerke). */
export type PlanParapetCrown = 'crenel' | 'lookout';

/** W3-CA: Abschluss eines Mauerturms je Rolle (Begriffe von `TowerTopStyle` der Bauwerke). */
export interface PlanTowerTop {
  readonly top?: 'battlements' | 'roof' | 'lookout' | 'belfry' | 'platform';
  readonly roofShape?: 'cone' | 'tent' | 'helm' | 'spire' | 'bell';
  readonly roofPitch?: 1 | 2 | 3 | 4;
  readonly finial?: 'none' | 'pole' | 'lantern' | 'spike' | 'rod' | 'end_rod';
  readonly flare?: boolean;
  readonly corbels?: boolean;
  readonly hangingLanterns?: boolean;
}

/** Turmgestalt der Ringmauer (Begriffe von `TowerStyle` der Bauwerke). */
export interface PlanTowerStyle extends Omit<PlanTowerTop, 'hangingLanterns'> {
  readonly shape?: 'round' | 'square';
  readonly size?: number;
  /** W3-CA: Licht je Geschoss. */
  readonly lit?: boolean;
  /** W3-CA (Turmsatz): Abschluss der Ecktürme bzw. der Torhaus-Türme. */
  readonly corner?: PlanTowerTop;
  readonly gate?: PlanTowerTop;
}

/**
 * Ringmauer (BT01) mit aufgelösten Werten. Die Lage (Rechteck um alle Baukörper, Tor auf der Achse der Haustür) setzt
 * der Anwendungsdienst, sobald die Hülle und damit die Haustür feststeht.
 */
export interface PlanRing {
  readonly offset: number;
  readonly height: number;
  readonly thickness: number;
  readonly towerSpacing: number;
  readonly towerStyle: PlanTowerStyle;
  readonly merlon: { readonly width: number; readonly gap: number };
  /** `gateBlock` (W3-CA): Torbau zwischen den Torhaus-Türmen; fehlt = keiner. */
  readonly gate: { readonly width: number; readonly height: number; readonly gatehouse: boolean; readonly gateBlock?: boolean };
  /** Zwinger: Abstand außen vor der Ringmauer (Mauerlinie zu Mauerlinie, ohne Turmradius) und Höhe. */
  readonly outer?: { readonly gap: number; readonly height: number };
  readonly moat?: { readonly width: number; readonly gap: number };
  /** Zonenart des Hofs (fehlt = kein Hof). */
  readonly yard?: string;
  /** W9-G5: Materialakzente der Mauertürme und des Torbaus (`WallPlan.accents`); fehlt = keine. */
  readonly accents?: boolean;
}

/** Silhouette-Wert (research/19 §9.1): weich – außerhalb des Bereichs gibt es einen Hinweis, keine Warnung (ADR 11). */
export interface QualityValue {
  readonly id: 'ratio' | 'heightToWidth' | 'roofToEave' | 'width' | 'floors' | 'partOverMain' | 'massCount' | 'focusOverMain'
    // MX-Q (DR2 §4 Nr. 1): Fassaden- und Umrissmaße, nur wenn der Bautyp sie in `checks` verlangt
    | 'articulationPlan' | 'articulationFront' | 'facadeSymmetry' | 'facadeEntropy';
  readonly value: number;
  readonly range: readonly [number, number];
  readonly ok: boolean;
}

export interface BuildingPlan {
  readonly typeId: string;
  /** Projektname (aus dem Bautyp). */
  readonly name: string;
  readonly seed: number;
  /** Aufgelöste Parameter (serialisierbar, für `BuildingTypeOrigin.params`). */
  readonly params: {
    readonly size?: BuildingSizeClass; readonly front: HorizontalDir; readonly floors: number; readonly setting?: BuildingSetting;
    /** Feature-Schalter Unterbau (nur gesetzt, wenn verlangt – bleibt in der Herkunft für „neu würfeln“). */
    readonly underground?: boolean | UndergroundParams;
    /** Funktionsgrad (nur gesetzt, wenn ≠ off – bleibt in der Herkunft für „neu würfeln“). */
    readonly functionLevel?: FunctionLevel;
    /** Silhouette (nur gesetzt, wenn ≠ off – bleibt in der Herkunft für „neu würfeln“). */
    readonly silhouette?: SilhouetteMode;
  };
  /** Unter-Seed, der den Plan ergab (0 = erster Versuch). */
  readonly attempt: number;
  /** Baukörper; der erste ist immer `DEFAULT_VOLUME`. */
  readonly volumes: readonly Volume[];
  /** Gebaute Flügel (Massing `wings`): Baukörper und Etagenzahl (angebaut: im Hauptbaukörper). */
  readonly wings: readonly { readonly id: string; readonly volumeId: VolumeId; readonly floors: number }[];
  /** Etagen (aufsteigend, lückenlos, Keller < 0). */
  readonly floors: readonly PlanFloor[];
  /** Räume in Mal-Reihenfolge (Reihenfolge bestimmt die Raum-IDs r1, r2 … im Projekt). */
  readonly rooms: readonly PlanRoom[];
  readonly stairs: readonly PlanStairs[];
  readonly shell: PlanShell;
  /** Raumtypen mit Flur-Rolle in der Hülle (Eingangs- bzw. Flurraum); fehlt = Standard der Hülle. */
  readonly corridorTypes?: readonly string[];
  readonly exterior?: PlanExterior;
  readonly site?: PlanSite;
  readonly windmill?: PlanWindmill;
  /** W12-C: Hochsilo (Bauernhof L); fehlt ohne `structures.silo`. */
  readonly silo?: PlanSilo;
  /** Ensemble-Teile (BT01: Bergfried …); fehlt ohne `parts`. */
  readonly parts?: readonly PlanPart[];
  /** Ringmauer (BT01); fehlt ohne `structures.ring`. */
  readonly ring?: PlanRing;
  /** W3-CA: Wehrplatte bzw. Ausguck auf dem Flachdach des Hauptbaukörpers; fehlt ohne `parapet`. */
  readonly parapet?: { readonly crown: PlanParapetCrown; readonly deck: boolean };
  readonly quality: readonly QualityValue[];
  /** Harte Probleme, die kein Unter-Seed lösen konnte (leer = Plan geprüft). */
  readonly warnings: readonly string[];
  /** Weiche Hinweise (Silhouette, Stil, weggelassene Wunschräume). */
  readonly hints: readonly string[];
  /** Feature Unterbau: Kennzahlen, wenn er gebaut wurde. */
  readonly underground?: UndergroundReport;
  /** Zusatztüren für Rundgänge im Haus (aus `BuildingParams.loopDoors`; `ShellOptions.loopDoors`). */
  readonly loopDoors?: number;
}
