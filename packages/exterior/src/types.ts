import type { ShellAnchorKind } from '@mcda/blueprint';
import type { Pose, Vec3 } from '@mcda/core';

/**
 * VERTRAG „Außengestaltung“ (Published Language, X1): Eingang = Hülle mit Ankern + Katalog + Seed + Stil
 * (+ Einrichtung für Schornsteine); Ausgang = Platzierungen von Katalog-Komponenten in Weltkoordinaten.
 * Abgeleitet wie die Hülle – NICHT im Projekt-Aggregat gespeichert; gleicher Eingang → gleiche Platzierungen.
 */

/** Gruppen (research/18 §6, §7, D10, D12, D13; research/16 F1, F2, F4, W6, D6, D9, D10). */
export type ExteriorGroup =
  | 'shutters' //      W1 Fensterläden
  | 'flowerBoxes' //   W2 Blumenkästen
  | 'sills' //         W3 Fensterbank
  | 'hoods' //         W3 Verdachung
  | 'portal' //        E1 Portal (Türrahmen 1 vor der Fassade)
  | 'canopy' //        E2 Vordach (auf Pfosten mit E1, sonst auf Konsolen bzw. Falltür-Blende)
  | 'stoop' //         E3 Vortreppe/Schwelle
  | 'entranceDecor' // E4 Laternen am Zaun-Arm, Kübel, Bank, Aushängeschild
  | 'chimneys' //      D12 Schornstein mit Rauch über Feuerstellen
  | 'eaveLanterns' //  D10 Laternen unter der Traufe; W2-FW: auch die Laternen der Fenstermodule an den Pfosten
  | 'ridgeDecor' //    D13 Firstschmuck
  | 'eaveBraces' //    W4-D Traufkonsolen (W3: vorher Teil von `eaveLanterns`); fehlt im Stil = wie `eaveLanterns`
  | 'fantasyDecor' //  W7-D Fantasy-Akzente (Banner, Ranken, Kristalle, Feuerschalen …; nur mit `ExteriorStyle.fantasy`)
  | 'barnDoors' //     W12-C Scheunentor (Torflügel um die Außentür) und Heuluke im Giebel – nur an Baukörpern mit `exterior.barn`
  | 'detailBlocks'; // W15 Fassaden-Details aus Teilblöcken (Konsolen, Giebelzier, Auslagen …; Stufe `ExteriorStyle.facadeDetail`)

export const EXTERIOR_GROUPS: readonly ExteriorGroup[] = [
  'shutters', 'flowerBoxes', 'sills', 'hoods', 'portal', 'canopy', 'stoop', 'entranceDecor', 'chimneys', 'eaveLanterns', 'ridgeDecor', 'eaveBraces',
  'fantasyDecor', 'barnDoors', 'detailBlocks',
];

/** Beschriftung je Gruppe für die UI (Schalter). */
export const EXTERIOR_GROUP_LABELS: Readonly<Record<ExteriorGroup, string>> = {
  shutters: 'Fensterläden',
  flowerBoxes: 'Blumenkästen',
  sills: 'Fensterbänke',
  hoods: 'Verdachungen',
  portal: 'Portal an der Haustür',
  canopy: 'Vordach',
  stoop: 'Vortreppe',
  entranceDecor: 'Laternen, Kübel, Bank, Schild',
  chimneys: 'Schornsteine',
  eaveLanterns: 'Laternen an Traufe und Fenstern',
  ridgeDecor: 'Firstschmuck',
  eaveBraces: 'Traufkonsolen',
  fantasyDecor: 'Fantasy-Akzente',
  barnDoors: 'Scheunentor und Heuluke',
  detailBlocks: 'Fassaden-Details',
};

/**
 * Stil der Außengestaltung. Jeder Gruppen-Schalter ist standardmäßig an (`false` schaltet ab). Ausnahme (W4-D,
 * bitgleich zu vorher): `eaveBraces` fehlt = folgt `eaveLanterns` – die Traufkonsolen gehörten bis W3 zu dieser Gruppe.
 * `density` 0–2 (1 = Standard): 0 = nur Vortreppe, Portal und Schornsteine; 2 = alle Fassaden, alle Motive,
 * dichter Laternentakt, Firstschmuck auch entlang des Firsts.
 */
export type ExteriorStyle = { readonly [G in ExteriorGroup]?: boolean } & {
  readonly density?: number;
  /** Neu würfeln ohne neuen Projekt-Seed: jede Zahl ergibt eine andere, feste Variante (Standard: keine). */
  readonly variation?: number;
  /** Portal-Form (E1); Standard: je Gebäude per Seed. */
  readonly portalKind?: 'timber' | 'arch';
  /**
   * W2-FW: Fenstermodul des Gebäudes (Katalog `exterior/window_module_<id>`). Standard: das Modul, dessen `styleTags`
   * das Theme nennen (`ExteriorOptions.themeId`), sonst `townhouse`.
   */
  readonly windowModule?: WindowModuleId;
  /**
   * W3-EN: Eingangsmodul des Gebäudes (Katalog `exterior/entrance_module_<id>`) für die Haustür – Portal, Vordach,
   * Laternenpaar und Stufe als ein abgestimmtes Kit. Standard: das Modul, dessen `styleTags` das Theme nennen
   * (`ExteriorOptions.themeId`), sonst `townhouse`. Ein ausdrückliches `portalKind` ersetzt nur das Portal des Moduls.
   */
  readonly entranceModule?: EntranceModuleId;
  /**
   * Additiv (W5-B, Review W4-R N4): Module im Material des Themes. `windowModule`/`entranceModule` geben dann nur die
   * Familie vor (Bautyp Burg: „wehrhaft“ = `stone`); ist das gewählte Modul für ein anderes Wandmaterial gebaut als das
   * Modul des Themes (Katalog-Tags `walls_stone`/`walls_wood`, `moduleWalls`), gilt das Modul des Themes – die nordische
   * Holzburg bekommt das nordische Portal statt der Tiefenschiefer-Gewände. Fehlt = das gewählte Modul gilt immer.
   */
  readonly themeMaterial?: boolean;
  /**
   * W7-D (plan/spikes/W7D_fantasy.md): Fantasy-Stufe der Außengestaltung – wiederkehrende Fantasy-Module aus dem Katalog
   * (`exterior/fantasy_*`, `FANTASY_MODULES`) statt Rauschen: `off` = keine, `accent` = nur die Akzent-Module (Tag
   * `fantasy_accent`), `full` = alle Module des Kits. Standard: `full` in Themes, die ein Fantasy-Modul in seinen `styleTags`
   * nennt (elven, dwarven), sonst `off` – andere Themes bleiben bitgleich.
   */
  readonly fantasy?: FantasyLevel;
  /**
   * W7-D: Kit der Fantasy-Module (Variante je Modul). Standard: das Kit gleichen Namens wie das Theme (elven, dwarven),
   * sonst nach dem Wandmaterial des Themes (Holz → `elven`, Stein → `dwarven`).
   */
  readonly fantasyKit?: FantasyKitId;
  /**
   * W15 (plan/spikes/W15_fassaden_detailbloecke.md): Stufe der Fassaden-Details aus Teilblöcken (`FACADE_DETAIL_PATTERNS`,
   * Katalog `exterior/detail_*`): `off` = keine, `subtle` = die dezenten Muster des Themes (Katalog-Tag `detail_subtle`),
   * `rich` = alle Muster des Themes und dichter. Welche Muster zu einem Theme passen, sagen die `styleTags` der
   * Komponenten. Standard `DEFAULT_FACADE_DETAIL`.
   */
  readonly facadeDetail?: FacadeDetailLevel;
  /** W15: einzeln abgeschaltete Muster der Fassaden-Details (Standard: keins). */
  readonly facadeDetailOff?: readonly FacadeDetailPattern[];
  /** Raumtypen, deren Außentür ein Aushängeschild bekommt (E4). Standard `DEFAULT_SIGN_ROOM_TYPES`. */
  readonly signRoomTypes?: readonly string[];
  /** Tags der Feuerstellen, über denen ein Schornstein entsteht (D12). Standard `DEFAULT_CHIMNEY_TAGS`. */
  readonly chimneyTags?: readonly string[];
};

export const DEFAULT_SIGN_ROOM_TYPES: readonly string[] = [
  'tavern', 'smithy', 'bakery', 'brewhouse', 'butchery', 'carpentry', 'pottery', 'trading_hall', 'mead_hall', 'weaving_room', 'alchemy',
];

export const DEFAULT_CHIMNEY_TAGS: readonly string[] = ['hearth', 'forge', 'fireplace', 'hearth_living'];

/**
 * W2-FW (plan/spikes/W2FW_fenster.md): Fenstermodule als Katalogeinheiten `exterior/window_module_<id>` – je Modul
 * die Stücke `lintel` (Sturz), `sill` (Bank), `jamb` (Laden bzw. Wange), `box_*` (Blumenkasten je Pflanze) und
 * `lantern` (Laterne am Zaun-Arm) als Varianten, `module` = das ganze Modul (Vorschau).
 */
export const WINDOW_MODULES = ['townhouse', 'cottage', 'timber', 'stone', 'nordic', 'fort'] as const;
export type WindowModuleId = (typeof WINDOW_MODULES)[number];
export const DEFAULT_WINDOW_MODULE: WindowModuleId = 'townhouse';
export const WINDOW_MODULE_LABELS: Readonly<Record<WindowModuleId, string>> = {
  townhouse: 'Stadthaus (Sturz, Bank, Läden, Laterne)',
  cottage: 'Cottage (Läden, Blumenkasten, Laterne)',
  timber: 'Fachwerk (Kasten im Gefach, ohne Läden)',
  stone: 'Stein (tiefe Laibung aus Wandstein)',
  nordic: 'Nordisch (Stammrahmen, Laterne)',
  fort: 'Wehrbau Holz (Stammwangen, ohne Läden und Kästen, Laterne)',
};

/**
 * W3-EN (plan/spikes/W3EN_eingang.md): Eingangsmodule als Katalogeinheiten `exterior/entrance_module_<id>` – je Modul
 * die Stücke als Varianten: `module` (ganzes Modul, Vorschau), `frame` (Portal: Gewände + Sturz), `canopy*` (Vordach mit
 * Trägern, Rückfall in Katalogreihenfolge), `lanterns*` (Laternenpaar mit Aufhängung, Rückfall in Katalogreihenfolge),
 * `step` (Stufe der Vortreppe), `block` (Podest/Unterbau). Alle Stücke sind spiegelsymmetrisch um die Türachse und werden
 * an der Mittelspalte angesetzt (unterste Schicht = Bodenplattenreihe).
 */
export const ENTRANCE_MODULES = ['townhouse', 'cottage', 'timber', 'stone', 'nordic'] as const;
export type EntranceModuleId = (typeof ENTRANCE_MODULES)[number];
export const DEFAULT_ENTRANCE_MODULE: EntranceModuleId = 'townhouse';
export const ENTRANCE_MODULE_LABELS: Readonly<Record<EntranceModuleId, string>> = {
  townhouse: 'Stadthaus (Steingewände, Treppenbogen, Laternenpaar am Zaun-Arm)',
  cottage: 'Cottage (Vordach auf Zaunpfosten, Laternen unter dem Vordach, Kübel)',
  timber: 'Fachwerk (Ständer mit Kopfbändern, Laternenpaar am Zaun-Arm)',
  stone: 'Stein (Eckstein-Gewände, Bogen, Laternen auf Mauerwangen)',
  nordic: 'Nordisch (Giebelvordach auf Pfosten, Laternen darunter)',
};

/**
 * W7-D (plan/spikes/W7D_fantasy.md): Fantasy-Stufen und -Kits. Ein Kit ist die Variante gleichen Namens in jedem
 * Fantasy-Modul (`exterior/fantasy_<modul>`); fehlt sie, gehört das Modul nicht zum Kit.
 */
export const FANTASY_LEVELS = ['off', 'accent', 'full'] as const;
export type FantasyLevel = (typeof FANTASY_LEVELS)[number];
export const FANTASY_LEVEL_LABELS: Readonly<Record<FantasyLevel, string>> = {
  off: 'aus',
  accent: 'Akzent (Hängelaternen am Bogenarm, Giebelhörner an den Traufecken)',
  full: 'voll (dazu Banner je Seite, Giebelzier, Laubranken an den Ecken bzw. Feuerschalen am Eingang)',
};
export const FANTASY_KITS = ['elven', 'dwarven'] as const;
export type FantasyKitId = (typeof FANTASY_KITS)[number];
export const FANTASY_KIT_LABELS: Readonly<Record<FantasyKitId, string>> = {
  elven: 'Elbisch (Birke, Laub, Kristall, helle Banner)',
  dwarven: 'Zwergisch (Stein, Kupfer, Feuerschalen, Runen)',
};

/**
 * W15 (plan/spikes/W15_fassaden_detailbloecke.md): Stufen und Muster der Fassaden-Details. Jedes Muster ist eine
 * Katalog-Komponente `exterior/detail_<muster>` (Schreibweise mit Unterstrich); ihre `styleTags` nennen die Themes, zu
 * denen es passt, der Tag `detail_subtle` nimmt es in die Stufe `subtle` auf.
 */
export const FACADE_DETAIL_LEVELS = ['off', 'subtle', 'rich', 'grand'] as const;
export type FacadeDetailLevel = (typeof FACADE_DETAIL_LEVELS)[number];
/**
 * W15 (28.09.2026): Standard dezent – gewinnt den blinden Vergleich gegen vorher 7 : 2 (21 gleich), gegen die Vorbilder
 * 31 : 0 : 59 statt 29 : 0 : 61 (plan/spikes/W15_fassaden_detailbloecke.md). `off` = Stand vor W15 (bitgleich).
 */
export const DEFAULT_FACADE_DETAIL: FacadeDetailLevel = 'subtle';
export const FACADE_DETAIL_LEVEL_LABELS: Readonly<Record<FacadeDetailLevel, string>> = {
  off: 'aus',
  subtle: 'dezent (Konsolen unter Auskragung, Gesims und Fensterbank, Giebelzapfen, Auslagen am Laden)',
  rich: 'reich (dazu Zahnschnitt unter Auskragung und Traufe, Giebelbanner, Fässer, Regentonnen und Holzstapel)',
  grand: 'prunkvoll (dazu Balkon und Erker, Geschossband, Verdachung, Strebepfeiler, Wandpfeiler, Sockelabsatz, Blindbogen, Regenfallrohr, Wetterfahne, Glockentürmchen, Rankgitter, Taubenschlag)',
};
export const FACADE_DETAIL_PATTERNS = [
  'jettyCorbels', 'sillCorbels', 'eaveDentils', 'gablePendant', 'gableBanner', 'shopShelves', 'entranceGoods', 'rainBarrels', 'woodStack',
  'balcony', 'orielWindow', 'windowHoods', 'stringCourse', 'buttress', 'weathervane', 'bellTurret', 'trellis', 'dovecote',
  'plinthLedge', 'pilasters', 'blindArch', 'downspout',
] as const;
export type FacadeDetailPattern = (typeof FACADE_DETAIL_PATTERNS)[number];
/**
 * EXT (28.09.2026, plan/spikes/EXT_fassade.md): Muster, die nur die Stufe `grand` setzt – die bis dahin nie
 * aufgerufenen Außen-Komponenten (Balkon, Erker, Verdachung, Geschossband, Strebepfeiler, Wetterfahne, Glockentürmchen,
 * Rankgitter, Taubenschlag). `off`, `subtle` und `rich` bleiben damit bitgleich.
 */
export const FACADE_DETAIL_GRAND_PATTERNS: readonly FacadeDetailPattern[] = [
  'balcony', 'orielWindow', 'windowHoods', 'stringCourse', 'buttress', 'weathervane', 'bellTurret', 'trellis', 'dovecote',
  'plinthLedge', 'pilasters', 'blindArch', 'downspout',
];
export const FACADE_DETAIL_PATTERN_LABELS: Readonly<Record<FacadeDetailPattern, string>> = {
  jettyCorbels: 'Konsolen unter Auskragung und Gesims (umgedrehte Treppen)',
  sillCorbels: 'Konsolen unter Fensterbank und Blumenkasten',
  eaveDentils: 'Zahnschnitt unter der Traufe (umgedrehte Treppen)',
  gablePendant: 'Hängezapfen unter der Giebelspitze (Zaun, reich mit Laterne)',
  gableBanner: 'Banner im Giebeldreieck',
  shopShelves: 'Auslage aus Regalen neben der Ladentür (ab 1.21.9, sonst Fässer)',
  entranceGoods: 'Fässer bzw. Heuballen neben Nebentüren',
  rainBarrels: 'Regentonnen an den Ecken der Eingangsseite',
  woodStack: 'Holzstapel mittig an einer fensterlosen Seitenwand',
  balcony: 'Balkon mit Geländer vor dem mittleren Obergeschossfenster (nur Stufe prunkvoll)',
  orielWindow: 'Erker auf Konsolen vor dem mittleren Obergeschossfenster (nur Stufe prunkvoll)',
  windowHoods: 'Verdachung über den Fenstern (nur Stufe prunkvoll)',
  stringCourse: 'Geschossband an der Geschossgrenze ohne Gesims (nur Stufe prunkvoll)',
  buttress: 'Strebepfeiler an langen Steinwänden (nur Stufe prunkvoll)',
  weathervane: 'Wetterfahne auf dem First (nur Stufe prunkvoll)',
  bellTurret: 'Glockentürmchen auf dem First des längsten Dachs (nur Stufe prunkvoll)',
  trellis: 'Rankgitter mit Laubsäule an einer fensterlosen Wand (nur Stufe prunkvoll)',
  dovecote: 'Taubenschlag an einer fensterlosen Wand (nur Stufe prunkvoll)',
  plinthLedge: 'Sockelabsatz: untere Stufe vor dem Sockelprofil, dreistufiger Fuß (nur Stufe prunkvoll)',
  pilasters: 'Wandpfeiler mit Kämpferstein an den Rasterpfosten des Erdgeschosses (nur Stufe prunkvoll)',
  blindArch: 'Blindbogenfenster an fensterlosen Wandfeldern des Erdgeschosses (nur Stufe prunkvoll)',
  downspout: 'Regenfallrohr (Kette) von der Traufe zum Boden neben den Hausecken (nur Stufe prunkvoll)',
};

/**
 * W5-B: Wandmaterial, für das ein Fenster- bzw. Eingangsmodul gebaut ist (Katalog-Tag `walls_stone`/`walls_wood` der
 * Komponente) – Stein-Laibung und Stadthaus-Gewände an Stein- und Putzwänden, Stammrahmen und Vordach auf Pfosten an
 * Holzwänden. Das Modul eines Themes (`styleTags`) steht damit für das Wandmaterial des Themes (Test: gleich wie
 * `isWoodRole(theme, 'wall_primary')` für alle Themes des Katalogs).
 */
export type ModuleWalls = 'stone' | 'wood';
export const MODULE_WALL_TAGS: Readonly<Record<ModuleWalls, string>> = { stone: 'walls_stone', wood: 'walls_wood' };
/**
 * W6-B (27.09.2026, Review W4-R Runde 3 „Leichtes“): Katalog-Tags einer **Modulfamilie** (`module_<familie>`). Mit
 * `themeMaterial` sucht die Modulwahl bei falschem Wandmaterial zuerst ein Modul derselben Familie im Material des Themes –
 * `stone` und `fort` bilden die Familie „wehrhaft“ (`module_fort`): der rustikale Wachturm bekommt Stammwangen statt der
 * Cottage-Läden. Ohne Familien-Tag wie bisher das Modul des Themes.
 */
export const MODULE_FAMILY_PREFIX = 'module_';

/** Platzierung im Haus (Leseport der Einrichtung): nur für Schornsteine über Feuerstellen. */
export interface InteriorPlacement {
  readonly componentId: string;
  readonly roomId?: string;
  /** Belegte Weltzellen. */
  readonly cells: readonly Vec3[];
}

export interface ExteriorOptions {
  /** Projekt-Seed (Neu würfeln = anderer Seed). */
  readonly seed: number;
  readonly style?: ExteriorStyle;
  /** Einrichtung (Feuerstellen → Schornsteine). Ohne: keine Schornsteine, alles andere gleich. */
  readonly placements?: readonly InteriorPlacement[];
  /** Raum-ID → Raumtyp-ID (Aushängeschild). */
  readonly roomTypes?: Readonly<Record<string, string>>;
  /**
   * Additiv (W12-C, Review R6-4): Außengestaltung je Raum, abgeleitet aus dem Baukörper des Raums (`Volume.exterior`):
   * abgeschaltete Gruppen (`off`, z. B. keine Blumenkästen an der Scheune) und Scheunentor (`barn`: Torflügel um die
   * Außentür statt Portal/Vordach/Laternen, Heuluke und Heubalken im Giebel darüber). Fehlt = alle Räume wie `style`.
   */
  readonly roomExterior?: Readonly<Record<string, RoomExterior>>;
  /** W2-FW: Theme des Projekts – wählt das Fenstermodul (`styleTags` der Module), wenn der Stil keins nennt. */
  readonly themeId?: string;
  /**
   * Gelände: y der obersten festen Zelle je Spalte (Vortreppe E3). Standard: eben eine Lage unter der Bodenplatte
   * (wie `flatGround(y0 − 1)`) – dann ist die Vortreppe eine Stufe; liegt das Gelände bündig, entfällt sie.
   */
  readonly ground?: (x: number, z: number) => number;
  /**
   * Additiv (W15): Zielversion als DataVersion – Fassaden-Details wählen Blöcke erst ab ihrer Version (Regal ab 1.21.9,
   * `minVersion` der Komponente), sonst den Ersatz. Fehlt = der Ersatz. Wirkt nur auf die Fassaden-Details.
   */
  readonly dataVersion?: number;
}

/** W12-C: Außengestaltung eines Raums (aus seinem Baukörper). */
export interface RoomExterior {
  readonly off?: readonly ExteriorGroup[];
  readonly barn?: boolean;
}

export interface ExteriorPlacement {
  /** Stabil und eindeutig (Herkunft `owner` der Zellen in der Materialisierung). */
  readonly id: string;
  readonly componentId: string;
  readonly variantId?: string;
  readonly pose: Pose;
  readonly seed: number;
  readonly group: ExteriorGroup;
  /** Andockstelle: Ankerart der Hülle bzw. `hearth` (Schornstein über einer Feuerstelle). */
  readonly anchor: ShellAnchorKind | 'hearth';
  readonly floorIndex: number;
  /** Belegte Weltzellen (Blockzellen der Komponente). */
  readonly cells: readonly Vec3[];
}

export interface ExteriorPlan {
  readonly placements: readonly ExteriorPlacement[];
  /** Fachliche Hinweise (z. B. „Schornstein über r4: kein freier Austritt“). */
  readonly warnings: readonly string[];
  readonly counts: Readonly<Record<ExteriorGroup, number>>;
}

/** Außen-Montagen des Katalogs (plan/01 §4.1): Komponenten mit diesen Montagen platziert nur der Außen-Solver. */
export const EXTERIOR_MOUNTS: ReadonlySet<string> = new Set(['facade', 'eave', 'roof', 'roof_peak', 'corner_out']);
