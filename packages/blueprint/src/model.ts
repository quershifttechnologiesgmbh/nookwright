import type { Cell, CellSet, HorizontalDir, MoodVector, PaletteOverrides, Pose } from '@mcda/core';
import type { RoofDetail, RoofStyle } from './shell/types.js';
import type { InteriorDecor } from './interiorDecor.js';
import type { StoryState } from './story.js';

export type RoomId = string;
export type PlacementId = string;
export type LinkId = string;

/** Zielversion (Wertobjekt). Die Domäne kennt nur Name + DataVersion, keine Mojang-Details. */
export interface TargetVersion {
  readonly name: string;
  readonly dataVersion: number;
}

export const TARGET_VERSIONS = {
  '1.21.11': { name: '1.21.11', dataVersion: 4671 },
  '26.3': { name: '26.3', dataVersion: 5023 },
} as const satisfies Record<string, TargetVersion>;

export type WallMode = 'outer';

export interface Floor {
  readonly index: number;
  /** Y der Bodenplatte. */
  readonly y0: number;
  /** Lichte Höhe (Luftblöcke zwischen Boden und Decke). */
  readonly height: number;
}

/**
 * Lichte Höhe einer Etage, die `addFloor` zulässt: 2 (Tür, Kopffreiheit) bis 16.
 * Etagenabstand: die Bodenplatte einer Etage ist die Decke der Etage darunter,
 * also `y0(f+1) = y0(f) + height(f) + 1` (research/03 §C7).
 */
export const FLOOR_HEIGHT = { min: 2, max: 16 } as const;

/** Treppenarten (research/03 §C8): gerade, L (Viertelwendung mit Podest), U (gegenläufig), Wendel, Leiter. */
export type StairType = 'straight' | 'l' | 'u' | 'spiral' | 'ladder';
/** Drehsinn für l/u/spiral, von oben gesehen: right = im Uhrzeigersinn. */
export type StairTurn = 'left' | 'right';

/**
 * Vertikale Verbindung (Treppe/Leiter) von Etage `floorIndex` zu `floorIndex + 1`.
 * Die Geometrie leitet `stairLayout` ab; das Aggregat reserviert ihre Zellen auf beiden Etagen.
 */
export interface VerticalLink {
  readonly id: LinkId;
  readonly type: StairType;
  /** Untere Etage. */
  readonly floorIndex: number;
  /** Zelle der ersten Stufe (Leiter: Zelle der Leiter). */
  readonly origin: Cell;
  /** Laufrichtung der ersten Stufe (bergauf); Leiter: Richtung zur tragenden Wand. */
  readonly facing: HorizontalDir;
  /** Nur l/u/spiral (Standard right). */
  readonly turn?: StairTurn;
}

export interface Room {
  readonly id: RoomId;
  readonly floorIndex: number;
  readonly cells: CellSet;
  readonly roomTypeId: string;
  readonly rerollCount: number;
  /** Additiv (Baukörper, research/19 §7.4): Baukörper des Raums; ohne Angabe `DEFAULT_VOLUME`. */
  readonly volumeId?: VolumeId;
  /** Additiv (Bautyp, research/19 §7.6): vom Bautyp erzeugt (`type`) oder vom Nutzer gemalt/geändert (`user`, Standard). */
  readonly origin?: 'type' | 'user';
  /** Additiv (W2-ED U4): vom Nutzer fixiert – übersteht Bautyp-Neubau; fehlt = nicht fixiert (bitgleich zu vorher). */
  readonly fixed?: true;
}

// ---------------------------------------------------------------------------------------------
// Additiv (Bautypen, research/19 §7.4–§7.6) – VERTRAG, vom Orchestrator festgelegt
// ---------------------------------------------------------------------------------------------

export type VolumeId = string;
/** Standard-Baukörper: alle Räume ohne `volumeId`. Ein Projekt ohne `volumes` verhält sich exakt wie bisher. */
export const DEFAULT_VOLUME: VolumeId = 'v0';

/** Lage eines Baukörpers im Gelände (research/19 §7.5). `ground` = heutiges Verhalten. */
export type SettingKind = 'ground' | 'buried' | 'cliff' | 'carved' | 'stilts' | 'tree' | 'water' | 'underwater';
export interface BuildingSetting {
  readonly kind: SettingKind;
  /** buried/cliff/carved: einzige sichtbare Seite. */
  readonly front?: HorizontalDir;
  /** stilts/tree: Höhe der untersten Bodenplatte über dem Gelände. */
  readonly height?: number;
  /** buried: Erdlagen über dem Dach. */
  readonly cover?: number;
}

/**
 * Baukörper (research/19 §7.4): Teil eines Projekts mit eigenem Dach, eigener Basishöhe und – optional – eigenen
 * lichten Höhen. Räume gehören über `Room.volumeId` dazu. `deriveShell` leitet je Baukörper ab: Grenzen zwischen
 * Baukörpern werden Brandwände (eine gemeinsame Wand), jeder Baukörper bekommt sein eigenes Dach (Häuserzeile,
 * Bergfried neben dem Palas, Vorburg tiefer als die Kernburg).
 */
export interface Volume {
  readonly id: VolumeId;
  readonly name?: string;
  /** Versatz aller Bodenplatten dieses Baukörpers in y (Blöcke, Standard 0; Hang, Motte). */
  readonly baseOffset?: number;
  /** Lichte Höhe je Etagenindex, abweichend von der Projekt-Etage (Standard: `Floor.height`). */
  readonly floorHeights?: Readonly<Record<number, number>>;
  /** Dach dieses Baukörpers (Standard: `ShellOptions.roof` bzw. dessen Details). */
  readonly roof?: RoofStyle;
  readonly roofDetail?: RoofDetail;
  readonly setting?: BuildingSetting;
  /**
   * Additiv (W12-C, Review R6-4): Außengestaltung **dieses** Baukörpers – die Scheune eines Hofs trägt helle Kanten, ein
   * Scheunentor und keine Blumenkästen, das Wohnhaus daneben nicht. Fehlt = wie das ganze Gebäude (bitgleich).
   */
  readonly exterior?: VolumeExterior;
}

/** Außengestaltung je Baukörper (W12-C): Kantenrolle, abgeschaltete Deko-Gruppen, Scheunentor. */
export interface VolumeExterior {
  /**
   * Theme-Rolle der Kanten dieses Baukörpers statt der Theme-weiten: Dachkante (`roof_trim`: Ortgang, Traufe, First) und
   * die Außenecken (Eckständer vom Sockel bis unter das Dach, senkrechter Stamm), z. B. `trim_light` (weißer Rahmen der
   * roten Scheune). Fehlt die Rolle im Theme, gilt ihr Rückfall (`trim_light` → `roof_trim`).
   */
  readonly trim?: string;
  /**
   * Additiv (W16-B, Review R7-2): Theme-Rolle der Dachfläche dieses Baukörpers statt `roof_main` – z. B. `roof_barn`
   * (dunkles Scheunendach unter dem hellen Rahmen, abgesetzt vom Wohnhausdach). Nur Dachzellen in `roof_main` wechseln
   * die Rolle (Form und Ausrichtung bleiben); fehlt die Rolle im Theme, gilt ihr Rückfall (`roof_barn` → `roof_main`).
   */
  readonly roof?: string;
  /** Gruppen der Außen-Deko (`@mcda/exterior` `ExteriorGroup`), die an diesem Baukörper entfallen, z. B. `flowerBoxes`. */
  readonly off?: readonly string[];
  /**
   * Scheunentor: die Außentür des Baukörpers liegt in der Mitte der Giebelwand, die vom übrigen Gebäude weg zeigt; die
   * Außen-Deko setzt Torflügel und Rahmen um die Tür (Schlupftür im Tor) und eine Heuluke mit Heubalken in den Giebel.
   */
  readonly barn?: boolean;
}

/** Herkunft eines Projekts aus einem Bautyp (research/19 §7.6): Startwert, nicht die Wahrheit (ADR 10). */
export interface BuildingTypeOrigin {
  readonly buildingTypeId: string;
  /** Parameter des Assistenten (Größe, Front, Lage …), wie vom Bautyp-Kontext serialisiert. */
  readonly params: Readonly<Record<string, unknown>>;
  readonly seed: number;
  readonly rerollCount: number;
}

export type PlacementOrigin = 'auto' | 'manual';

export interface Placement {
  readonly id: PlacementId;
  readonly roomId: RoomId;
  readonly componentId: string;
  readonly variantId?: string;
  readonly pose: Pose;
  readonly seed: number;
  readonly parentId?: PlacementId;
  readonly socketId?: string;
  readonly locked: boolean;
  readonly origin: PlacementOrigin;
}

/** Eingabe von der Einrichtung: lokale Schlüssel statt IDs, das Aggregat vergibt die IDs. */
export interface PlacementDraft {
  readonly key: string;
  readonly componentId: string;
  readonly variantId?: string;
  readonly pose: Pose;
  readonly seed: number;
  readonly parentKey?: string;
  readonly socketId?: string;
}

export interface ProjectState {
  readonly id: string;
  readonly name: string;
  readonly seed: number;
  readonly themeId: string;
  /**
   * Additiv (Q4, research/54 §3.3): gewählte **Farbpalette** neben dem Theme. Das Theme beschreibt die Bauweise,
   * die Palette die Farbwelt (`applyPalette` in `@mcda/catalog`). Fehlt das Feld, bleibt das Theme unverändert –
   * alte Projekte und alle Prüfsummen sind damit bitgleich.
   */
  readonly paletteId?: string;
  /**
   * Additiv (Q5/P15, research/55 §2 „Erzählung durch Zustand“): Nutzungszustand des Baus. Er ändert **keine**
   * Geometrie (Hülle, Räume, Türen, Wege bleiben zellgleich), sondern nur Materialspuren der Hüllzellen –
   * materialbezogen und ortsbezogen, deterministisch aus dem Projekt-Seed (`@mcda/materialize` `story.ts`).
   * Fehlt das Feld, ist jede Ausgabe bitgleich zu vorher (Prüfsummen-Netz).
   */
  readonly storyState?: StoryState;
  /**
   * Additiv (feat/theme-moods, WFC-Bericht §4): Stimmungsvektor des Nutzers (`@mcda/core` `MoodVector`) – zugleich der
   * **Schalter**: ist das Feld gesetzt (auch `{}`), gilt die Stimmung des Themes, achsenweise vom Nutzer
   * überschrieben; sie wirkt nur auf weiche Größen (Einrichtungs-Gewichte, Deko-Budget, Verwitterung/Story).
   * Fehlt das Feld, ist jede Ausgabe bitgleich zu vorher.
   */
  readonly mood?: MoodVector;
  /**
   * Additiv (feat/int-decor, LV Hebel 9/10): Innen-Deko-Stufe – zugleich der **Schalter**. `'some'` = ein bis zwei
   * Vignetten je Raum, Wandschmuck, Pflanzen, Teppich; `'rich'` = dichter (mehr Wandschmuck, Hängendes, Borde mit Inhalt,
   * Lichtakzente). Fehlt das Feld, ist jede Ausgabe bitgleich zu vorher. Der Deko-Pass (`decorRooms` in
   * `@mcda/pipeline`) ergänzt nur `auto`-Platzierungen mit den harten Regeln des Solvers (Wege, Türen, Fenster frei).
   */
  readonly interiorDecor?: InteriorDecor;
  /**
   * Additiv (W13-G): Paletten-Überschreibungen des Nutzers vor dem Generieren – Materialfamilie je Rollengruppe (Wand,
   * Rahmen, Dach, Sockel, Boden, Akzent, Innenholz) und Familien-Tausch („Eiche → Fichte“). Wirkt nach Theme und
   * Farbpalette (`applyPaletteOverrides` in `@mcda/catalog`). Fehlt das Feld, ist jede Ausgabe bitgleich zu vorher.
   */
  readonly paletteOverrides?: PaletteOverrides;
  readonly targetVersion: TargetVersion;
  readonly wallMode: WallMode;
  /** Nach `index` aufsteigend sortiert, Indizes lückenlos. */
  readonly floors: readonly Floor[];
  readonly rooms: readonly Room[];
  readonly placements: readonly Placement[];
  /** Treppen und Leitern zwischen den Etagen. */
  readonly links: readonly VerticalLink[];
  /** Zähler für deterministische IDs (r1, r2 …, p1, p2 …, s1 …). */
  readonly seq: number;
  /** Additiv (Baukörper): weitere Baukörper; ohne Angabe nur `DEFAULT_VOLUME`. */
  readonly volumes?: readonly Volume[];
  /** Additiv (Bautyp): woraus das Projekt erzeugt wurde. */
  readonly origin?: BuildingTypeOrigin;
}

/** Serialisierbare Zellenliste für Events. */
export type CellList = readonly Cell[];
