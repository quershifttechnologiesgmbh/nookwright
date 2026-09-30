/**
 * Eingabe und Ausgabe des Kontexts „Bauwerke/Befestigung“ (research/14).
 *
 * Koordinaten sind Weltkoordinaten; eine Zelle `[x, z]` ist eine Blockspalte (Glossar). Die Ausgabe sind
 * `ShellCell`s mit `kind: 'fort'`, die der Anwendungsdienst über `buildWorld(…, extraCells)` materialisiert.
 */
import type { ShellCell } from '@mcda/blueprint';
import type { Cell, HorizontalDir, Vec3 } from '@mcda/core';

/**
 * Port „Höhenfeld“ (für den Kontext Gelände): Y des OBERSTEN Geländeblocks der Spalte. Bauwerke beginnen
 * eine Ebene darüber (Sockelreihe `groundY + 1`, wie die Bodenplatte des Hauses bei y = 0 über Gelände y = −1).
 */
export interface HeightField {
  groundY(x: number, z: number): number;
}

export type TowerShape = 'round' | 'square';
/**
 * Turmabschluss (research/18 §5): Zinnenkranz, Dach über einem Dachgeschoss, Aussichtsstube (T5: auskragende
 * Holzstube mit Zaun-Brüstung unter einem Dach), Glockenstube (T4: Schallöffnungen, Glocke, Dach darüber),
 * offene Plattform mit Zaun-Geländer und Laternen.
 */
export type TowerTop = 'battlements' | 'roof' | 'lookout' | 'belfry' | 'platform';
/**
 * Dachform (research/18 D8/D9): Kegel (rund), Zelt (eckig), Rhombenhelm (eckig, Manhattan-Pyramide mit Giebeln),
 * Spitzhelm (steil, eckig mit 4 Eckfialen), welsche Haube (Profil Fuß–Bauch–Einschnürung–Spitze).
 */
export type RoofShape = 'cone' | 'tent' | 'helm' | 'spire' | 'bell';
/**
 * Turmspitze auf dem Dachfirst: Stange aus Stämmen, Zaun mit Laterne, Zaun-Stange, keine; additiv (O1, research/16
 * D9) Zaun mit Blitzableiter (`rod`, Theme-Rolle `finial`, gewachstes Kupfer) bzw. mit Endstab (`end_rod`).
 */
export type TowerFinial = 'none' | 'pole' | 'lantern' | 'spike' | 'rod' | 'end_rod';

/** Gestalt eines Turms (für freistehende Türme und als Vorgabe der Mauertürme). */
export interface TowerStyle {
  /** Standard: round. */
  readonly shape?: TowerShape;
  /** Außenmaß (ungerade; rund ≥ 9, eckig ≥ 7, sonst aufgerundet). Standard: rund 9, eckig 7. */
  readonly size?: number;
  /** Abschluss: Zinnenkranz oder Dach (rund → Kegel, eckig → Zelt). Standard: rund → roof, eckig → battlements. */
  readonly top?: TowerTop;
  /** Dachneigung in Blöcken Anstieg je Ring (1 = 45°, 2 = steil). Standard 2 (Spitzhelm 3, Rhombenhelm 1). */
  readonly roofPitch?: 1 | 2 | 3 | 4;
  /** Dachform für roof/lookout/belfry. Standard: rund → cone, eckig → tent (helm nur eckig, sonst Kegel). */
  readonly roofShape?: RoofShape;
  /** Glockenfuß (D3): Überstand als Stufe, Ring über der Wand eine halbe Stufe höher. Standard: nur lookout. */
  readonly flare?: boolean;
  /** Turmspitze auf dem Dach. Standard: aus dem Seed (Stange oder keine). */
  readonly finial?: TowerFinial;
  /** Kragsteinkranz (umgedrehte Treppen) unter den Zinnen, Brüstung 1 Block außerhalb. Standard true. */
  readonly corbels?: boolean;
  /** Geschosshöhe (Boden bis Boden). Standard 4. */
  readonly levelHeight?: number;
  /**
   * Additiv (O1, research/18 T4): Glocke der Glockenstube steht auf dem Boden (`floor`, Standard) oder hängt
   * (`hanging`): Glockenbalken quer zur Tür unter der Wandkrone, eine Kette, Glocke `attachment=ceiling`.
   */
  readonly bell?: 'floor' | 'hanging';
  /**
   * Additiv (O1, research/18 R16 B/T1, research/16 D10): hängende Laternen (Kette + Laterne, Rolle `light_hanging`)
   * unter der Traufe an den Ecken (eckig) bzw. Diagonalen (rund) – für Dach, Aussichts- und Glockenstube. Nur unter
   * tragender Unterseite (nicht am Fuß der welschen Haube) und in freier Luft. Standard false.
   */
  readonly hangingLanterns?: boolean;
  /**
   * Additiv (W3-CA): Licht in jedem Geschoss – eine hängende Laterne unter dem Boden darüber (Rolle `light_hanging`,
   * an einer Stelle des Geschossrings abseits von Wendel und Tür), damit im Turm keine dunkle Zelle bleibt. Standard false.
   */
  readonly lit?: boolean;
  /**
   * Additiv (W3-CA, nur Mauertürme): Abschluss der **Ecktürme** eines Mauerzugs – überschreibt Abschluss, Dachform,
   * Neigung, Glockenfuß, Spitze, Kragsteine und Traufenlaternen; Form und Größe bleiben die des Stils (gleiche Radien).
   * So trägt z. B. ein Ring Kegelhelme an den Ecken und Zinnen an Tor und Zwischentürmen (Turmsatz).
   */
  readonly corner?: TowerTopStyle;
  /** Additiv (W3-CA, nur Mauertürme): Abschluss der **Torhaus-Türme** (wie `corner`). */
  readonly gate?: TowerTopStyle;
}

/** Abschluss eines Turms ohne Grundriss-Maße (Rollen-Überschreibung der Mauertürme, W3-CA). */
export type TowerTopStyle = Pick<TowerStyle, 'top' | 'roofShape' | 'roofPitch' | 'flare' | 'finial' | 'corbels' | 'hangingLanterns'>;

export interface TowerSpec extends TowerStyle {
  readonly id?: string;
  readonly center: Cell;
  /** Geschosse bis zur Plattform bzw. zum Dachgeschoss. Standard 3. */
  readonly levels?: number;
  /** Bevorzugte Richtung der Eingangstür. Standard south. */
  readonly door?: HorizontalDir;
}

/**
 * Turmwindmühle (research/18 T6): Steinturm mit Kappe (Dach), Achse und 4 Flügeln in „+“-Stellung vor der
 * Kappe; je Flügel eine Rute (Stamm) und die Bespannung (Rolle `sail`) auf einer Seite (Windrad-Symmetrie).
 */
export interface WindmillSpec extends TowerStyle {
  readonly id?: string;
  readonly center: Cell;
  /** Geschosse unter der Kappe. Standard 3. */
  readonly levels?: number;
  /** Richtung, in die die Flügel zeigen (Front der Kappe). Standard south. */
  readonly facing?: HorizontalDir;
  /** Flügellänge ab der Nabe (Blöcke). Standard 7; wird gekürzt, wenn die untere Spitze sonst < 2 über dem Gelände liegt. */
  readonly sailLength?: number;
  /** Breite der Bespannung neben der Rute. Standard 2. */
  readonly sailWidth?: number;
  /** Bevorzugte Richtung der Eingangstür. Standard: gegenüber den Flügeln. */
  readonly door?: HorizontalDir;
}

/**
 * Angedockter Turm (C4, research/18 T1/T3): Eckturm (`corner`: Abschluss Standard Aussichtsstube, mindestens ein
 * Geschoss über der Kontaktlinie) oder Treppenturm (`stair`: Standard Dach, Scharten steigen mit der Wendel).
 */
export type AnnexKind = 'corner' | 'stair';

/** Durchgang ins Haus: Türzelle in der Hauswand (untere Türhälfte, absolut) und Blickrichtung in den Turm. */
export interface AnnexPassage {
  readonly pos: Vec3;
  readonly facing: HorizontalDir;
}

/**
 * Turm an einer Hauswand (Grundriss = Anbau `ShellAnnex` der Hülle, die das Haus vorbereitet: Türen, Aussparung im
 * Dach). Innen die Wendeltreppe des freistehenden Turms; Geschossböden liegen auf jeder Türhöhe (`passages`), die
 * Wand reicht mindestens bis `contactTop`, alles Auskragende (Überstand, Kragsteine, Stube) liegt über `clearTop`.
 */
export interface AnnexTowerSpec extends TowerStyle {
  readonly id?: string;
  readonly center: Cell;
  /** Standard stair. */
  readonly kind?: AnnexKind;
  /** Richtung vom Turm zum Haus: dort keine Scharten und keine Eingangstür. */
  readonly side: HorizontalDir;
  /** Mindestzahl Geschosse ab der Bodenplatte (Standard 1); Türen und Kontakt heben den Turm bei Bedarf. */
  readonly levels?: number;
  /** Y der Bodenplatte. Standard: Boden der untersten Tür, ohne Türen eine Ebene über dem Gelände. */
  readonly baseY?: number;
  readonly passages?: readonly AnnexPassage[];
  /** Höchste Hauszelle neben dem Grundriss (`ShellAnnexInfo.contactTop`): so hoch reicht die Turmwand mindestens. */
  readonly contactTop?: number;
  /** Höchste Hauszelle unter dem Überstand (Ring r + 2 um die Mitte, ohne Grundriss): Auskragendes beginnt darüber. */
  readonly clearTop?: number;
  /** Oberste Wandreihe vorgegeben (`ShellAnnexInfo.top`, aus `annexWallTop` berechnet) – sonst aus Geschossen und Kontakt. */
  readonly wallTop?: number;
  /** Eingangstür von außen (mit Vortreppe, von der Hauswand weg). Standard false: Zugang über das Haus. */
  readonly entrance?: boolean;
}

export interface GateSpec {
  /** Zelle auf (oder nahe) dem Mauerzug; das Tor sitzt am nächsten Punkt der Linie. */
  readonly at: Cell;
  /** Lichte Breite: 1 → Tür, 2 → Doppeltür, ≥ 3 → Bogen. Standard 3. */
  readonly width?: number;
  /** Lichte Höhe (Bogen). Türen sind immer 2 hoch. Standard 4. */
  readonly height?: number;
  /** Torhaus: zwei flankierende Türme (Stil der Mauertürme). Standard false. */
  readonly gatehouse?: boolean;
  /**
   * Additiv (W3-CA, nur mit `gatehouse` und Bogen): **Torbau** zwischen den Torhaus-Türmen – das Mauerstück über dem
   * Tor wird bis zur Turmplattform hochgezogen (Wehrgang als überdeckter Durchgang mit Laterne und Scharten), oben
   * Zinnen, außen eine Pechnase (Brüstung auf Kragsteinen über dem Bogen), im Bogen ein hochgezogenes Fallgitter.
   * Standard false.
   */
  readonly gateBlock?: boolean;
}

export interface WallPlan {
  readonly id?: string;
  /** Mauerzug als Polyline über Zellen (Stützpunkte). */
  readonly points: readonly Cell[];
  /** Geschlossener Ring (letzter Punkt → erster). */
  readonly closed?: boolean;
  /**
   * Profil: Wehrmauer (Standard) oder Gartenmauer (research/18 Z2): niedrig, ohne Wehrgang, Zinnen, Türme,
   * Aufgang und Anlauf; Pfeiler im Takt, an Ecken, Enden und Toren (dort höher), Tore als Zauntor oder Öffnung.
   */
  readonly profile?: 'fortress' | 'garden';
  /** Nur Gartenmauer: Pfeilerabstand (Standard 4), Laterne statt Kappe auf den Pfeilern, Heckenfüllung. */
  readonly garden?: { readonly pillarEvery?: number; readonly lanterns?: boolean; readonly hedge?: boolean };
  /** Mauerdicke in Blöcken (Brüstung + Wehrgang). Standard 3 (Gartenmauer 1); ab 2 gibt es einen Wehrgang. */
  readonly thickness?: number;
  /** Massive Reihen vom Sockel bis zum Wehrgang-Boden (inklusive). Standard 6 (Gartenmauer 2). */
  readonly height?: number;
  /** Offener Zug: Feindseite (Brüstung) links oder rechts der Zeichenrichtung. Geschlossen: immer außen. Standard left. */
  readonly outside?: 'left' | 'right';
  /** Zinnen-Rhythmus entlang der Bogenlänge: Zinne `width`, Scharte `gap`. Standard 1/1. */
  readonly merlon?: { readonly width?: number; readonly gap?: number };
  /** Sockel: `rows` Reihen Rolle foundation, `batter` = Treppen-Anlauf außen am Fuß. Standard 2/true. */
  readonly plinth?: { readonly rows?: number; readonly batter?: boolean };
  /** Automatische Türme an Ecken, Enden und in Abständen. Standard auto. */
  readonly towers?: 'auto' | 'none';
  readonly towerStyle?: TowerStyle;
  /** Turm-Plattform über dem Wehrgang-Boden. Standard 5. */
  readonly towerRise?: number;
  /** Knickwinkel (Grad), ab dem eine Ecke einen Turm bekommt. Standard 30. */
  readonly cornerAngle?: number;
  /** Größter Abstand zwischen Türmen entlang der Mauer (0 = keine Zwischentürme). Standard 24. */
  readonly towerSpacing?: number;
  /** Zusätzliche Türme (auf die Linie projiziert). */
  readonly extraTowers?: readonly Cell[];
  readonly gates?: readonly GateSpec[];
  /** Treppenaufgänge zum Wehrgang (innen): auto = einer je Mauer, Zellen = nahe diesen Punkten. Standard auto. */
  readonly stairs?: 'auto' | 'none' | readonly Cell[];
  /**
   * Additiv (W9-G5, Materialspiel): Materialakzente der Mauertürme – Turmdächer in der Rolle `roof_tower` (Holzdach im
   * Theme, Rückfall `roof_main`), Kappen auf den Turmzinnen (`crown_cap`, Stufe, Rückfall `wall_cornice`), am Torbau
   * eine Holzkrone (Hurde, `hoarding`, Rückfall `parapet`) über beiden Torhaus-Türmen und dem Torbau sowie ein
   * Bannerpaar (`textile_primary`) spiegelgleich zur Torachse. Nur Rollen und Zubehör, keine neue Geometrie des
   * Mauerkörpers. Standard false (bitgleich).
   */
  readonly accents?: boolean;
}

/**
 * Additiv (BT01): Wehrplatte auf einem rechteckigen Flachdach – Brüstung auf dem Außenrand, Zinnen im Takt je Seite
 * von beiden Ecken aus (spiegelsymmetrisch). Steht auf dem Dach, belegt keine Bodenspalten.
 */
export interface ParapetSpec {
  readonly id?: string;
  /**
   * Additiv (BT01): Baukörper, an den die Wehrplatte gebunden ist. Ist er gesetzt, sind `cells`/`y` nur eine
   * **Momentaufnahme** – App und Engine leiten die Spalten jedes Mal neu aus der Hülle ab (`parapetSpecsFor`), damit
   * die Zinnen mitwandern, wenn sich Etagen oder Grundriss des Baukörpers ändern.
   */
  readonly volumeId?: string;
  /** Spalten des Flachdachs. */
  readonly cells: readonly Cell[];
  /** Y der obersten Dachzelle; Brüstung bei y + 1, Zinnen bei y + 2. */
  readonly y: number;
  /** Zinne `width`, Scharte `gap`. Standard 2/1. */
  readonly merlon?: { readonly width?: number; readonly gap?: number };
  /**
   * Additiv (W3-CA): Abschluss des Flachdachs – `crenel` (Standard) = Brüstung mit Zinnen; `lookout` = Ausguck:
   * Pfosten an Ecken und Seitenmitten, Zaun-Brüstung dazwischen, darüber 2 Reihen offen und ein Zeltdach über den Rand
   * hinaus (nur quadratische Dächer, sonst Zinnen mit Hinweis).
   */
  readonly crown?: ParapetCrown;
  /**
   * Additiv (W3-CA): Belag (Rolle `walkway`) auf dem Dach innerhalb der Brüstung, bündig mit ihr (Zinnen darüber); beim
   * Ausguck auf dem ganzen Dach. Standard false.
   */
  readonly deck?: boolean;
  /**
   * Additiv (W4-B): Dachluke der Hülle (`RoofDetail.hatch`) – Spalte der Leiter, die bis in die Dachplatte (`y`) reicht,
   * und ihre Blickrichtung. Dort liegt statt Belag bzw. Dach eine Falltür bei `y + 1` mit demselben `facing` (geöffnet
   * direkt über der Leiter kletterbar): mit Belag in der oberen Hälfte (bündig begehbar), ohne in der unteren. Wie
   * `cells`/`y` eine Ableitung aus der Hülle (`parapetSpecsFor`), keine Eingabe.
   */
  readonly hatch?: { readonly cell: Cell; readonly facing: HorizontalDir };
}

/** Abschluss einer Wehrplatte (W3-CA): Zinnenkranz oder Ausguck mit Zeltdach. */
export type ParapetCrown = 'crenel' | 'lookout';

/** Bindung einer Wehrplatte an einen Baukörper (Projektdatei/Engine): ohne Zellen – die kommen aus der Hülle. */
export interface ParapetBinding {
  readonly id?: string;
  readonly volumeId: string;
  readonly merlon?: { readonly width?: number; readonly gap?: number };
  /** Additiv (W3-CA): Abschluss, siehe `ParapetSpec.crown`. */
  readonly crown?: ParapetCrown;
  /** Additiv (W3-CA): Belag, siehe `ParapetSpec.deck`. */
  readonly deck?: boolean;
}

/**
 * Additiv (W12-C, Review R6-4): runder Hochsilo (Hofgebäude neben der Scheune) – Mantel (Rolle `silo`) voll Heu, Reifen
 * und Kranz in `trim_light`, Kuppel aus Dachtreppen mit Blitzableiter. Spiegelsymmetrisch, ohne Tür (geschlossen).
 */
export interface SiloSpec {
  readonly id?: string;
  readonly center: Cell;
  /** Radius der Kreisscheibe (2–4, Standard 3 = Ø 7). */
  readonly radius?: number;
  /** Mantelhöhe in Reihen ab dem Sockel (8–24, Standard 16); darüber die Kuppel (Radius + 2 Reihen). */
  readonly height?: number;
}

export interface StructuresInput {
  readonly walls?: readonly WallPlan[];
  readonly towers?: readonly TowerSpec[];
  readonly windmills?: readonly WindmillSpec[];
  /** Additiv (W12-C): Hochsilos (Bauernhof); werden nach Türmen und Windmühlen gebaut. */
  readonly silos?: readonly SiloSpec[];
  /** Additiv (C4): angedockte Türme (T1/T3); werden zuerst gebaut. */
  readonly annexTowers?: readonly AnnexTowerSpec[];
  /** Additiv (BT01): Zinnenkränze auf Flachdächern (Wehrplatte des Bergfrieds). */
  readonly parapets?: readonly ParapetSpec[];
  /**
   * Additiv (F-Ensemble): Holzbrücken aus einem Obergeschoss – zum Wehrgang einer Mauer oder zur Tür eines anderen
   * Gebäudes. Werden zuletzt gebaut (nach den Mauern) und nur ganz oder gar nicht (Ergebnis `bridges`).
   */
  readonly bridges?: readonly BridgeSpec[];
}

/**
 * Additiv (F-Ensemble, `plan/spikes/F_ensemble_walkways.md`): Brücke (Laufsteg) aus einer Obergeschoss-Tür, gerade
 * entlang `dir`. Querschnitt 3 breit: Lauf 1 breit in der Mitte, beidseits Belag mit Zaun-Geländer. Beide Enden flach
 * (Podest vor der Tür bzw. am Wehrgang), Höhenwechsel als Treppenlauf ≤ 1:1 in der Mitte, 3 Reihen Kopffreiheit.
 * Stützen (Stämme bis auf das Gelände) im Takt ≤ 4 freie Zellen, Laternen auf dem Geländer über den Stützen.
 */
export interface BridgeSpec {
  readonly id?: string;
  /** Standplatz (Füße) der ersten Brückenzelle, unmittelbar vor der Tür (außen an der Wand). */
  readonly start: Vec3;
  /** Richtung von der Tür weg. */
  readonly dir: HorizontalDir;
  /**
   * Gegenüber ist die Tür eines anderen Gebäudes: Standplatz (Füße) der letzten Brückenzelle vor dieser Tür (auf der
   * Linie von `start` entlang `dir`). Fehlt: die Brücke läuft bis zur ersten Wehrgang-Zelle einer Mauer.
   */
  readonly end?: Vec3;
  /** Größte Zahl der Brückenzellen beim Wehrgang-Anschluss. Standard 12. */
  readonly maxLength?: number;
}

/** Ergebnis einer Brücke (nur mit `StructuresInput.bridges`). */
export interface BridgeInfo {
  readonly id: string;
  /** Gebaut? Sonst `reason` (Kollision, kein Wehrgang, zu steil …) und keine Zellen. */
  readonly built: boolean;
  readonly reason?: string;
  /** Standplätze (Füße) der Laufzellen von der Tür weg. */
  readonly path: readonly Vec3[];
  /** Wehrgang-Anschluss: erster Standplatz auf dem Wehrgang und dessen Mauer. */
  readonly landing?: Vec3;
  readonly wall?: string;
  /** Spalten der Stützen (Stämme bis auf das Gelände). */
  readonly supports: readonly Cell[];
}

export interface StructureOptions {
  /** Höhenfeld; Standard: ebenes Gelände mit groundY = −1 (Sockel bei y = 0 wie die Hausplatte). */
  readonly ground?: HeightField;
  /** Seed für kleine Variation (Turmhöhe ±, Turmspitzen). Standard 0. */
  readonly seed?: number;
  /** Präfix der Herkunft (`ShellCell.roomId`), Standard 'fort'. */
  readonly idPrefix?: string;
  /**
   * Feature-Schalter (feat/tiled-wfc, Standard aus): Zinnenkränze aus dem Tiled-WFC statt im festen Takt
   * (`crenel.ts`, Gewichte je Theme). Ohne Angabe bitgleich.
   */
  readonly tiled?: TiledDetail;
}

/** Tiled-WFC-Details (feat/tiled-wfc): Theme für die Kachelgewichte. */
export interface TiledDetail {
  readonly themeId?: string;
}

/** Bericht je Zinnenkranz aus dem Tiled-WFC (nur mit `StructureOptions.tiled`). */
export interface TiledCrenelEntry {
  /** Herkunft (Turm, Wehrplatte, Mauerzug). */
  readonly id: string;
  readonly kind: 'tower' | 'parapet' | 'wall';
  /** false = unlösbar, fester Takt als Rückfall. */
  readonly ok: boolean;
  /** Kachelfolge (Kurzform), leer bei Rückfall. */
  readonly pattern: string;
  /** Unabhängig geprüfte harte Verstöße (Randcodes, Spiegel, Ecken); muss 0 sein. */
  readonly violations: number;
}

export interface DoorInfo {
  /** Untere Türhälfte. */
  readonly pos: Vec3;
  /** Blickrichtung beim Hinausgehen. */
  readonly facing: HorizontalDir;
}

export interface TowerInfo {
  readonly id: string;
  readonly center: Cell;
  readonly shape: TowerShape;
  readonly size: number;
  readonly top: TowerTop;
  /** Y der Bodenplatte. */
  readonly baseY: number;
  /** Y aller Geschossböden (Plattform bzw. Dachgeschoss zuletzt). */
  readonly floors: readonly number[];
  readonly topY: number;
  readonly door?: DoorInfo;
  /** Mauerturm: Y des Wehrgang-Bodens, auf dem der Turm angeschlossen ist. */
  readonly wallLevel?: number;
  readonly wall?: string;
  /** Standplätze (Füße) auf der Plattform bzw. im Dachgeschoss. */
  readonly topStands: readonly Vec3[];
  /** Glockenstube: Position der Glocke (steht auf dem Boden der Stube bzw. hängt 1 darüber an der Kette). */
  readonly bell?: Vec3;
  /** Windmühle: Nabe der Flügel. */
  readonly hub?: Vec3;
  /** Angedockter Turm (C4): Art, Hausseite und je gültigem Durchgang der Standplatz (Füße) innen hinter der Wand. */
  readonly annex?: { readonly kind: AnnexKind; readonly side: HorizontalDir; readonly passages: readonly Vec3[] };
}

/** Tür, Doppeltür, Bogen (Wehrmauer); Zauntor (Gartenmauer, Breite 1–2) oder offene Lücke (Gartenmauer, ≥ 3). */
export type GateKind = 'door' | 'double_door' | 'arch' | 'fence_gate' | 'opening';

export interface GateInfo {
  readonly center: Cell;
  readonly width: number;
  readonly kind: GateKind;
  /** Y der Schwelle; der Durchgang ist frei von baseY + 1 bis baseY + clear. */
  readonly baseY: number;
  readonly clear: number;
  /** Standplätze im Durchgang (Füße). */
  readonly passage: readonly Vec3[];
  /**
   * Zugang beiderseits des Tores (Vorplätze und Vortreppen, Spalten): Anschluss für Wege des Geländes.
   * Mit dem Durchgang zusammen die Spalten, über die ein Weg die Mauer queren darf.
   */
  readonly approach: readonly Cell[];
}

export interface WallInfo {
  readonly id: string;
  /** Standplätze (Füße) auf dem Wehrgang. */
  readonly walkway: readonly Vec3[];
  /** Treppenaufgänge: unterste und oberste Stufe (Position des Treppenblocks). */
  readonly stairs: readonly { readonly bottom: Vec3; readonly top: Vec3 }[];
  readonly towers: readonly string[];
  readonly gates: readonly GateInfo[];
}

export interface StructuresResult {
  readonly cells: readonly ShellCell[];
  readonly towers: readonly TowerInfo[];
  readonly walls: readonly WallInfo[];
  /**
   * Am Boden belegte oder freizuhaltende Spalten (Grundrisse, Tor- und Türvorplätze, Treppenläufe) – für den
   * Kontext Gelände: dort keine Pflanzen/Wege-Deko, Wege an Türen und Toren anschließen.
   */
  readonly footprint: readonly Cell[];
  /** Fachliche Hinweise für die UI (z. B. „Turm an Ecke 2 weicht dem Tor“). */
  readonly warnings: readonly string[];
  /** Additiv (F-Ensemble): je `StructuresInput.bridges` ein Eintrag; fehlt ohne Brücken. */
  readonly bridges?: readonly BridgeInfo[];
  /** feat/tiled-wfc: Bericht je Zinnenkranz (nur mit `StructureOptions.tiled`). */
  readonly tiled?: readonly TiledCrenelEntry[];
}
