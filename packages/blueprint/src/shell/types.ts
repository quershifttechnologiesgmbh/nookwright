import type { Cell, CellSet, HorizontalDir, Vec3 } from '@mcda/core';
import type { RoomId, SettingKind, VolumeId } from '../model.js';

/**
 * VERTRAG „Hülle“ (Shell) – Published Language des Bauplan-Kontexts.
 * Erzeugt von `deriveShell` (Bauplan), gelesen von der Materialisierung (Rollen → Blöcke)
 * und – über `RoomShellInfo` – von der Einrichtung (strukturgleich mit furnishing/RoomGeometry).
 *
 * Koordinaten sind Weltkoordinaten. Ausrichtungen in der Hülle sind ABSOLUT und folgen der
 * Minecraft-Bedeutung (die Hülle ist algorithmisch und liegt nah an den Blöcken):
 *  - stairs.facing   = Richtung der hohen Rückseite (man steigt in diese Richtung auf)
 *  - door.facing     = Blickrichtung beim Hinausgehen durch die Tür; half/hinge wie im Spiel
 *  - log.axis        = x | y | z
 *  - slab.half       = bottom | top (Minecraft-Property heißt `type`; die Materialisierung übersetzt)
 *  - vertical        = facing up | down bei 6-Wege-Blöcken (Endstab, Blitzableiter, Fass) – additiv (O1)
 *  - hanging         = Laterne hängt (`hanging=true`) – additiv (O1)
 *  - attach          = Glocke `attachment`, Hebel/Knopf `face` (floor | ceiling | wall | double_wall) – additiv (O1)
 */

export type ShellKind =
  | 'floor' //    Bodenplatte (unter Wänden und Räumen)
  | 'wall' //     gerades Wandfeld
  | 'pillar' //   Ecke, T, Kreuz, Wandende, freistehender Pfeiler
  | 'door' //     Türblock (2 Zellen: lower + upper)
  | 'lintel' //   Sturz über der Tür, falls die Wand höher als 2 ist
  | 'window' //   Fensterzelle in einer Außenwand
  | 'ceiling' //  Decke (bei Flachdach zugleich Dachfläche)
  | 'roof' //     Dachfläche (Treppen, Stufen, First)
  // Additiv (23.09.2026) – Zellen aus anderen Kontexten, die über denselben Weg materialisiert werden:
  | 'terrain' //  Gelände: Boden, Aufschüttung, Wege, Beete (Schicht Terrain) – Kontext Gelände
  | 'plant' //    Vegetation draußen: Büsche, Bäume, Blumen (Schicht Möbel) – Kontext Gelände
  | 'fort' //     Befestigung: Mauern, Türme, Tore, Zinnen (Schicht Struktur) – Kontext Bauwerke
  // Additiv (Etagen): Treppen und Geländer (Schicht Struktur)
  | 'stairs' //   Treppe/Leiter: Stufe beam/stairs (facing, half bottom), Podest + Unterbau beam/planks,
  //              Wendel-Pfosten + Leiter-Träger beam/log (axis y), Leiter ladder/ladder (facing weg von der Wand)
  | 'railing' // Geländer um Deckenöffnungen: beam/fence (Verbindungen setzt das Autotiling)
  // Additiv (Außendesign, research/18 §14): Außenprofil vor der Wand – Sockelprofil, Gesims, Eckquader,
  // Konsolen, Traufkonsolen, Fensterläden. Liegt immer in Außenluft (Schicht Struktur), nie in der Wandebene.
  | 'facade';

/** Treppenform wie die Minecraft-Property `shape` (left/right aus Sicht von `facing`, left = gegen den Uhrzeigersinn). */
export type StairShape = 'straight' | 'inner_left' | 'inner_right' | 'outer_left' | 'outer_right';

export interface ShellOrient {
  readonly facing?: HorizontalDir;
  readonly half?: 'lower' | 'upper' | 'bottom' | 'top';
  readonly axis?: 'x' | 'y' | 'z';
  readonly hinge?: 'left' | 'right';
  /** Nur Deko des Außenprofils (F1): offene Falltür liegt flach an der Wand (research/16 W4). */
  readonly open?: boolean;
  /**
   * Nur Dachtreppen und Eckstücke des Außenprofils (additiv ergänzt): Soll-Form aus der Viertelpunkt-Klassifikation
   * des Walmdachs bzw. `outer_right` an Außenecken von Sockelprofil/Gesims.
   * `facing` allein ist an Graten/Kehlen mehrdeutig (outer vs. inner). Die Materialisierung setzt die
   * Form explizit; das `facing` ist so gewählt, dass die Vanilla-Regel dieselbe Form wiederherstellt.
   */
  readonly stairShape?: StairShape;
  /**
   * Additiv (O1): senkrechte Ausrichtung der Blöcke mit 6-Wege-`facing` – Minecraft `facing=up|down`. Endstab und
   * Blitzableiter: die Spitze zeigt dorthin, der Fuß sitzt auf der Gegenseite. Fass/Spender: Öffnung; Trichter nur
   * `down`. Schließt `facing` aus (ein Block hat genau eine Richtung).
   */
  readonly vertical?: 'up' | 'down';
  /**
   * Additiv (O1): Laterne hängt (Minecraft `hanging=true`, jede Laternenart). Hängend braucht sie darüber eine
   * stabile Mitte (Vollblock, untere Stufe/Treppe, Zaun, Mauer, senkrechte Kette), stehend (`false`/fehlt) darunter.
   */
  readonly hanging?: boolean;
  /**
   * Additiv (O1): Befestigung. Glocke → `attachment` (`wall` = Minecraft `single_wall`), Hebel/Knopf/Schleifstein →
   * `face` (ohne `double_wall`). `facing` bleibt wie im Spiel: die Wandglocke zeigt ZUR tragenden Wand (double_wall:
   * zu einer der beiden), Hebel/Knopf an der Wand zeigen von ihr WEG; an Boden/Decke dreht `facing` nur den Block.
   * Stützen: floor = volle Oberseite darunter; ceiling = Glocke stabile Mitte darüber (auch Kette/Zaun), Hebel/Knopf
   * volle Unterseite darüber; wall = volle Fläche an der Wand (double_wall ohne zweite Wand → single_wall).
   */
  readonly attach?: 'floor' | 'ceiling' | 'wall' | 'double_wall';
}

export interface ShellCell {
  readonly pos: Vec3;
  /**
   * Additiv (research/30 K8): stabile Zell-`id`, vergeben von `deriveShell` nur mit `ShellOptions.stableCellIds`.
   * Sie bleibt beim **Verschieben** des Gebäudes gleich (Reihenfolge innerhalb der Zellgruppe), damit Texturen
   * und Muster stehen bleiben. Ohne den Schalter fehlt das Feld – alles bleibt bitgleich.
   */
  readonly id?: number;
  readonly kind: ShellKind;
  /** Material-Rolle des Themes, z. B. floor_primary, wall_primary, beam, window, door, roof_main, ceiling. */
  readonly role: string;
  /** Form innerhalb der Familie: block | planks | log | stairs | slab | pane | door … */
  readonly shape: string;
  readonly orient?: ShellOrient;
  /** Raum, zu dem die Zelle gehört (für Herkunft/Neuberechnung). Gemeinsame Wände: der „Träger“-Raum. */
  readonly roomId?: RoomId;
  readonly exterior?: boolean;
  /**
   * Additiv (feat/tiled-wfc): Ort (x, z), an dem die Materialwahl in Mischungen ausgewertet wird (Rauschen und weiße
   * Wahl), statt `pos`. Gespiegelte Zellen eines Musters tragen denselben Ort und bekommen so denselben Block – die
   * Spiegelsymmetrie reicht bis in die Blöcke (Projektregel gegen Windräder). Nur Gelände/Pflanzen; fehlt = `pos`.
   */
  readonly pickAt?: Cell;
}

export interface ShellDoor {
  /** Begehbare Innenzelle vor der Tür (im Raum). */
  readonly inside: Cell;
  /** Richtung von der Innenzelle zur Tür. */
  readonly toward: HorizontalDir;
  readonly isMain: boolean;
  /**
   * Additiv (W4-C): Flügel einer **Doppeltür** – Innenzelle vor dem anderen Flügel (direkt daneben, gleiche Richtung).
   * Beide Flügel stehen als eigene Tür in `doors`; fehlt bei einfachen Türen.
   */
  readonly partner?: Cell;
}

export interface ShellWindow {
  readonly inside: Cell;
  readonly toward: HorizontalDir;
}

/** Zugang zu einer Treppe (additiv): freizuhaltende Innenzelle vor dem Antritt bzw. nach dem Austritt. */
export interface ShellStairAccess {
  readonly inside: Cell;
  /** Richtung von der Zugangszelle zur Treppe. */
  readonly toward: HorizontalDir;
  /** ID der Treppe (`VerticalLink.id`); gleiche ID auf zwei Etagen = Verbindung. */
  readonly linkId: string;
  /** bottom = Antritt (untere Etage), top = Austritt (obere Etage). */
  readonly end: 'bottom' | 'top';
}

/** Sicht eines Raums nach der Ableitung. Strukturgleich mit `RoomGeometry` aus @mcda/furnishing. */
export interface RoomShellInfo {
  readonly roomId: RoomId;
  readonly floorIndex: number;
  /** Y der ersten Luftschicht über dem Boden. */
  readonly baseY: number;
  /** Lichte Höhe. */
  readonly height: number;
  /** Begehbare Innenzellen (Raumzellen ohne Wandzellen). */
  readonly interior: CellSet;
  readonly doors: readonly ShellDoor[];
  readonly windows: readonly ShellWindow[];
  /**
   * Additiv (Etagen): Innenzellen, die nicht belegt werden dürfen – Treppe samt Unterbau, Deckenöffnung,
   * oberste Stufe, Geländer, Leiter-Pfosten. `deriveShell` liefert das Feld immer (evtl. leer).
   */
  readonly blocked?: CellSet;
  /**
   * Additiv (Etagen): Treppenzugänge dieses Raums; wie Türen freihalten und erreichbar lassen.
   * Baukörper (V0): Räume gleicher Etage verschiedener Baukörper können verschiedene Böden und lichte Höhen haben –
   * `baseY` und `height` gelten je Raum, `floorIndex` allein bestimmt keine Höhe.
   */
  readonly stairs?: readonly ShellStairAccess[];
}

/**
 * Dachformen (research/18 §4). `gable` = Satteldach (Giebel), `hip` = Walmdach, `shed` = Pultdach (steigt von der
 * Haustür weg), `half_hip` = Krüppelwalm (D6), `dutch_gable` = Fußwalm mit Ziergiebel (D6), `mansard` = Mansard-
 * Walmdach und `gambrel` = Mansard-Satteldach (unten steil, oben flach, D7), `saltbox` = Satteldach mit
 * angehobener Vorderseite (D14). An höheren Wänden (obere Etage) entsteht bei allen geneigten Formen ein Pultdach.
 */
export type RoofStyle = 'flat' | 'hip' | 'gable' | 'shed' | 'half_hip' | 'dutch_gable' | 'mansard' | 'gambrel' | 'saltbox';

/**
 * Fenster-Stil (additiv). Fenster sitzen symmetrisch auf geraden Außenwandläufen ohne Tür.
 * Der Standard ist großzügiger als früher: alle 3 Blöcke war zu dicht für breite Möbel (Katalog-Analyse K1).
 */
export interface WindowStyle {
  /**
   * Additiv (B2): `false` = keine Fenster – weder in Wänden noch im Giebel (W7) noch in Gauben (D4). Ein Randabstand, der
   * auf keiner Wand Platz lässt, gilt ebenso als „aus“ (`windowsOff`). Standard true.
   */
  readonly enabled?: boolean;
  /** Mindestzahl Wandzellen zwischen zwei Fenstern (Standard 4; früher 2). */
  readonly spacing?: number;
  /** Wandzellen zwischen Pfeiler/Ecke und Fenster (Standard 1). */
  readonly margin?: number;
  /** Ab dieser Lauflänge bleibt die Laufmitte fensterfrei (Standard 14; `Infinity` = nie). */
  readonly blankFrom?: number;
  /** Mindestbreite des fensterfreien Mittelstücks (Standard 6). */
  readonly blankWidth?: number;
}

/**
 * Additiv (WS-Fassade, plan/spikes/WS_fassade.md): Fassadenrhythmus. Beide Teile sind einzeln schaltbar; fehlt das Feld
 * oder ist alles aus, bleibt die Hülle zellgleich.
 */
export interface FacadeRhythmStyle {
  /** Fensterachsen im Takt (Mittelachse bzw. Tür als Hauptachse, spiegelsymmetrisch) auf geraden Außenwandläufen. */
  readonly windows?: boolean;
  /** Gauben auf leeren Dachflächen, wenn der Bautyp keine eigenen Gauben festlegt. */
  readonly dormers?: boolean;
}

/** Schalter „Fassadenrhythmus“ der Bautyp-Erzeugung: aus (Standard, bitgleich) oder an (`facadeRhythmStyle`). */
export const FACADE_RHYTHMS = ['off', 'on'] as const;
export type FacadeRhythm = (typeof FACADE_RHYTHMS)[number];

export interface ShellOptions {
  readonly roof: RoofStyle;
  /** Dachüberstand in Blöcken (hip und gable). */
  readonly overhang?: number;
  /**
   * Raumtypen, die als Flur gelten (additiv ergänzt). Flure behalten ihre lichte Breite
   * (Prioritätsbonus bei gemeinsamen Wänden, Spike T4 §1), bekommen Türen zu allen Nachbarn
   * und werden als Eingangsraum bevorzugt. Der Bauplan kennt den Katalog nicht, daher als Option.
   * Standard: `['hallway', 'corridor']`.
   */
  readonly corridorTypes?: readonly string[];
  /**
   * Additiv (feat/underground, Dungeon 4.1 A2): Zusatztüren für Rundgänge – Wahrscheinlichkeit je benachbartem, noch
   * nicht verbundenem Raumpaar (private Räume wie Schlafzimmer und Bad ausgenommen). Fehlt oder 0 = Türgraph wie bisher.
   */
  readonly loopDoors?: number;
  /** Fenster-Stil (additiv); Standard `DEFAULT_WINDOW_STYLE`. */
  readonly windows?: WindowStyle;
  /** Additiv (Außendesign): Dach-Details. */
  readonly roofDetail?: RoofDetail;
  /** Additiv (Außendesign): Gauben (D4, B2). */
  readonly dormers?: DormerStyle;
  /** Additiv (WS-Fassade): Fassadenrhythmus – Fensterachsen im Takt, Gauben auf leeren Dachflächen. Fehlt = bitgleich. */
  readonly facadeRhythm?: FacadeRhythmStyle;
  /** Additiv (Außendesign): Außenprofil. */
  readonly facade?: FacadeStyle;
  /** Additiv (B2): angedockte Bauwerke (Eckturm, Treppenturm) – Sperrzone im Dach, Türen, sonst freigehalten. */
  readonly annexes?: readonly ShellAnnex[];
  /**
   * Additiv (research/30 K8): je Zelle eine **stabile `id`** vergeben (Identität statt Ort). Muster und Rauschen
   * hängen dann an der `id`, nicht an den Koordinaten – ein verschobenes Haus behält seine Textur.
   * **Default `false`**: ohne den Schalter ändert sich nichts (alle Prüfsummen bleiben bitgleich).
   */
  readonly stableCellIds?: boolean;
}

/**
 * Additiv (B2, research/18 T1/T3): Andockstelle für ein Bauwerk aus @mcda/structures am Haus. Die Hülle baut das
 * Bauwerk nicht, sie bereitet das Haus vor:
 *  - Aussparung im Dach: kein Dachblock (Überstand) über dem Grundriss bei Dächern, die unter `top` beginnen; die Form
 *    des Hausdachs bleibt sonst gleich (Traufe bzw. Ortgang laufen gegen die Turmwand).
 *  - An `openings` eine Tür ins Bauwerk; sonst an angrenzenden Außenwänden (bis `top`) weder Tür noch Fenster.
 *  - Davor weder Anker noch Außenprofil (das Außenmodell zählt die Spalten des Grundrisses als belegt).
 *  - Öffnungen auf mehreren Etagen verbinden diese (Treppenturm): ihre Räume gelten wie über eine Treppe erreichbar.
 * Grundriss über Räumen oder ohne Kontakt zum Haus: ganzer Anbau ignoriert; ungültige Öffnung: nur sie – je mit Warnung.
 */
export interface ShellAnnex {
  readonly id: string;
  /** Grundriss des Bauwerks: außerhalb aller Räume, grenzt an eine Außenwand. */
  readonly footprint: CellSet;
  /** Oberste Wandreihe des Bauwerks (absolut). */
  readonly top: number;
  readonly openings?: readonly ShellAnnexOpening[];
}

export interface ShellAnnexOpening {
  readonly floorIndex: number;
  /** Gerade Außenwandzelle der Etage; quer zur Wand grenzt sie innen an einen Raum, außen an den Grundriss. */
  readonly at: Cell;
}

/** Gültiger Anbau in der Hülle (Leseport für den Bauwerks-Schritt). */
export interface ShellAnnexInfo {
  readonly id: string;
  readonly footprint: CellSet;
  readonly top: number;
  /** Türen ins Bauwerk: Wandzelle, Etage, unterste Türreihe, Blickrichtung hinein. */
  readonly doors: readonly { readonly floorIndex: number; readonly at: Cell; readonly y: number; readonly facing: HorizontalDir }[];
  /**
   * Höchste Hüllenzelle in den Nachbarspalten des Grundrisses (Giebel, Dach, Wand). Das Haus ist auch ohne Bauwerk dicht;
   * reicht die Turmwand bis hierhin, schließt sie bündig an, sonst ragt Giebel bzw. Dach über den Turm hinaus.
   */
  readonly contactTop: number;
}

export interface Shell {
  readonly cells: readonly ShellCell[];
  readonly rooms: ReadonlyMap<RoomId, RoomShellInfo>;
  /** Fachliche Hinweise für die UI, z. B. „Raum r3 ist nach Wandabzug schmaler als 1 Block“. */
  readonly warnings: readonly string[];
  /**
   * Additiv (Außendesign): Andockstellen für Außen-Komponenten und den Außenprofil-Pass. `deriveShell`
   * leitet sie NACH Wänden und Dach aus den fertigen Zellen ab (unabhängig vom Dach-Algorithmus).
   */
  readonly anchors?: readonly ShellAnchor[];
  /** Additiv (B2): gültige Anbauten (nur mit `ShellOptions.annexes`); ihre Grundrisse sind für Außen-Teile belegt. */
  readonly annexes?: readonly ShellAnnexInfo[];
  /** Additiv (BT16): Lagen ≠ `ground` je Baukörper – Auftrag an das Gelände; fehlt, wenn alle Baukörper `ground` sind. */
  readonly settings?: readonly ShellSetting[];
  /**
   * Additiv (W2): Fassadenraster je Geschoss und Außenseite (nur mit `FacadeRules.grid`) – Anker für Wandvorlagen,
   * Konsolen, Laternen und Fenstermodule (`@mcda/exterior`); fehlt ohne Raster.
   */
  readonly facadeGrid?: readonly FacadeGridLine[];
  /**
   * Additiv (W2 D5): tatsächliche Neigung je Dach (Baukörper, Etage) – nur mit `RoofDetail.heightBudget: true` oder
   * (W3) bei einem geteilten Dach bzw. (W4) mit Kniestock, sonst fehlt das Feld (Leseport für Bautypen und Hinweise).
   */
  readonly roofFit?: readonly ShellRoofFit[];
  /**
   * Additiv (W13-E, 28.09.2026): Die Obergeschosse tragen ein eigenes Wandkleid (`FacadeStyle.upperFrame`) – Leseport
   * für die Flächen-Regeln des Themes (`when.upperFrame`, `@mcda/materialize`). Fehlt ohne den Schalter (bitgleich).
   */
  readonly upperFrame?: true;
}

/** Additiv (W2 D5): Neigung, die das Dach einer Etage eines Baukörpers nach dem Höhen-Budget bekommt. */
export interface ShellRoofFit {
  readonly volumeId: VolumeId;
  readonly floorIndex: number;
  /** Gewünschte Neigung (Höchstwert). */
  readonly requested: RoofPitch;
  readonly pitch: RoofPitch;
  /** Dachfläche (Zellen der Region) – das größte Dach eines Baukörpers ist sein Hauptdach. */
  readonly area: number;
  /** Additiv (W3): das Dach ist geteilt (Reihe von Quergiebeln bzw. parallele Satteldächer, `RoofDetail.split`). */
  readonly split?: boolean;
  /** Additiv (W4): Kniestock-Reihen über der Decke (`RoofDetail.kneeWall`), fehlt = 0. */
  readonly knee?: number;
}

/**
 * Additiv (BT16, research/19 §7.5): Lage eines Baukörpers als Leseport für andere Kontexte. `buried`: das Gelände hebt
 * sich über dem Grundriss auf die Oberkante der Hülle plus `cover` Erdlagen und fällt zu Seiten und Rückseite ab; vor
 * der Frontebene (vorderste Reihe des Grundrisses in Richtung `front`) bleibt es frei.
 */
export interface ShellSetting {
  readonly volumeId: VolumeId;
  readonly kind: SettingKind;
  /** buried: einzige sichtbare Seite (immer gesetzt). */
  readonly front?: HorizontalDir;
  /** buried: Erdlagen über der Oberkante der Hülle (immer gesetzt). */
  readonly cover?: number;
  /**
   * Additiv (W9-G4, 27.09.2026): buried – Flanken. Neben der Front reicht der Hügel so viele Blöcke vor die Frontebene;
   * die Front liegt dazwischen zurück (Nische mit Stützmauern). Fehlt = 0 (bisheriges Verhalten).
   */
  readonly wing?: number;
  /** Spalten des Baukörpers (Grundrisse aller Etagen). */
  readonly footprint: CellSet;
}

// ---------------------------------------------------------------------------------------------
// Additiv (Außendesign, research/18 §14) – Dach-Details, Fassade, Anker
// ---------------------------------------------------------------------------------------------

/** Dachneigung (research/18 D1): low = 1 hoch auf 2 (Anbauten), normal = 1:1 (45°), steep = 2 hoch auf 1. */
export type RoofPitch = 'low' | 'normal' | 'steep';

export interface RoofDetail {
  /** Standard `normal` (bisheriges Verhalten). */
  readonly pitch?: RoofPitch;
  /** D2: Dachkante (Traufe/Ortgang) mit der Theme-Rolle `roof_trim` statt `roof_main`. */
  readonly trim?: boolean;
  /** D2: Ortgang-Unterseite mit umgedrehten Treppen schließen. */
  readonly verge?: 'plain' | 'closed';
  /** D3: Glockenfuß – unterste Reihe flacher (Stufe statt Treppe). */
  readonly flare?: boolean;
  /** D6: Reihen des Krüppelwalms (Standard 1–2 je nach Tiefe). */
  readonly halfHipRows?: number;
  /** D7: Höhe des Knicks beim Mansard-/Gambreldach (Standard aus der Tiefe). */
  readonly mansardBreak?: number;
  /** W7: Fenster in Giebelwänden (Satteldach). Standard true. */
  readonly gableWindows?: boolean;
  /**
   * Additiv (W2, Baustandard D5–D8): Dachregeln – Standard an (fehlt = an). Dachhöhen-Budget: Firsthöhe über der Traufe
   * ≤ Traufhöhe bei einem Geschoss, sonst ≤ min(1,5 × Traufhöhe, 2 Geschosse) – die Neigung sinkt (steil → normal →
   * niedrig), bis es passt (D5). Dach an höheren Wänden: flache Kappung ≤ 2 Zellen, sonst flachere Neigung bzw.
   * Quergiebel statt Pultdach (D6). Pultdach nur bis 7 Tiefe, darüber Satteldach (D8). `false` = Neigung und Form wie
   * angegeben (Stand vor W2).
   */
  readonly heightBudget?: boolean;
  /**
   * Additiv (W3, Dach-Teilung; plan/spikes/W3RD_dachdetails.md): Standard an (fehlt = an). Das Satteldach eines
   * eingeschossigen Baukörpers (Satteldach, Krüppelwalm, Fußwalm, Saltbox, Gambrel), das in der gewählten Neigung über
   * dem Höhen-Budget liegt (Dachanteil > 50 %), wird ab 15 Außenmaß quer zum First (Spannweite + 2 × Überstand;
   * steil bzw. Gambrel ab 13) geteilt: gedrungen zur Reihe von Quergiebeln, lang zu parallelen Satteldächern. Die Neigung bleibt genau;
   * `Shell.roofFit` meldet die Teilung. `false` = ein Dach wie angegeben.
   * W4: mit Kniestock (`kneeWall`) erst, wenn drei Kniestock-Reihen nicht reichen.
   */
  readonly split?: boolean;
  /**
   * Additiv (W4, Baustandard D5 präzisiert; plan/spikes/W4F_dachproportion.md): Kniestock – Standard an (fehlt = an).
   * Bei eingeschossigen Baukörpern muss die sichtbare Wand (Bodenplatte → Traufunterkante) mindestens so hoch sein wie
   * das Dach (Traufunterkante → First, samt Überstand). Fehlen Reihen, hebt die Hülle das ganze Dach um bis zu 3 Reihen
   * Wand über der Decke (Drempel, Rolle `wall_gable`), reicht das nicht, teilt sie es (`split`, dann höchstens 1 Reihe).
   * Die Neigung bleibt; `Shell.roofFit` meldet `knee`. `false` = Traufe auf Deckenhöhe (Stand vor W4).
   * W5 (27.09.2026, Review W4-R N7): auch Mehrgeschosser – das oberste Dach höchstens 1,5 × so hoch wie die sichtbare
   * Wand (D5); fehlen dafür höchstens 3 Reihen, hebt ein Kniestock das Dach (nicht mit `heightBudget`, dort sinkt die Neigung).
   */
  readonly kneeWall?: boolean;
  /**
   * Additiv (M2, plan/spikes/FN_inspiration_gebaeude.md): Überstand von Traufe und Ortgang getrennt. `legacy` (Standard,
   * fehlt = `legacy`) = jedes Dachrechteck wächst gleichmäßig um `overhang`. `refined` = Traufe (quer zum First) behält
   * `overhang`, der Ortgang (entlang des Firsts) ist schmal: höchstens 1 Block beim Hauptdach, 0 bei Flügeln
   * (Quergiebel schließen bündig mit der Giebelwand) – Satteldach-Familie; Walm- und Mansarddächer bleiben gleich.
   */
  readonly roofOverhang?: 'legacy' | 'refined';
  /**
   * Additiv (W4-B, nur Flachdach; plan/spikes/W4B_bergfried.md): Dachluke – im obersten Raum des Baukörpers steht an einer
   * fensterlosen Wand eine Leiter bis in die Dachplatte (Öffnung dort, Leiter trägt die Wand dahinter). Die Falltür
   * darüber legt die Wehrplatte bzw. der Ausguck (`@mcda/structures`, `ParapetSpec.hatch`). Leiter-Zelle und die Zelle
   * davor bleiben frei (Treppenzugang `hatch:<Baukörper>` für die Einrichtung). Standard aus.
   */
  readonly hatch?: boolean;
  /**
   * Additiv (W4-B, Turmschaft): glatter Schaft ohne Band je Geschoss – die Bodenplatten der Obergeschosse liegen in der
   * Außenwand in der Wandrolle (`wall_primary` statt Holz-Schwelle), an den Etagengrenzen des Baukörpers gibt es keinen
   * Anker `storey_line` (also kein Gesims), und der Rand eines Flachdachs läuft als Steingesims (`wall_cornice`) statt
   * `roof_trim`. Standard aus (Band je Geschoss wie beim Haus).
   */
  readonly plainShaft?: boolean;
  /**
   * Additiv (W7-B, Turmschaft mit eigenem Raster; plan/spikes/W7B_burg.md): nur mit mehreren Baukörpern und der
   * Raster-Regel (`FacadeRules.grid`). Jede Seite des Baukörpers ist eine eigene Rasterlinie von Ecke zu Ecke – auch wo
   * ein Nachbarbaukörper davor steht (einspringende Ecke) oder in derselben Flucht weiterläuft (Fuge). Die Linie des
   * Nachbarn endet an der Fuge (die Fugenspalte ist seine Ecke). So hat der Bergfried auf allen Geschossen dieselben
   * Achsen (Fensterflucht F1), unabhängig vom Palas daneben. Standard aus (eine Linie über beide Baukörper).
   */
  readonly shaftGrid?: boolean;
}

/**
 * D4 (B2, shell/dormers.ts): Gauben auf jeder geneigten Dachfläche, die Platz hat – Front eine Zelle innerhalb der Traufwand
 * über einem Raum, je Fläche symmetrisch und gleichmäßig verteilt (höchstens 1 je 6 Blöcke), Gaubenfirst ≥ 1 unter dem
 * Hauptfirst, ≥ 2 Abstand zu Ortgang, Grat und Kehle. Frontwand: Pfosten (beam/log), Brüstung, Scheibe(n), Rähm
 * (beam/log quer); Fenster entfallen bei „Fenster aus“ bzw. wenn davor nicht Luft ist (Merrell). Flache Neigung
 * (1:2) lässt meist keinen Platz (dann keine Gauben). `blind` = Satteldach-Gaube mit Vollblock hinter der Scheibe;
 * `gable`/`shed`/`hip` haben Dachraum-Luft dahinter.
 */
export interface DormerStyle {
  /** gable = Satteldach-Gaube, shed = Schleppgaube (flach, Stufen, Fensterband), hip = Walmgaube, blind = Blindgaube. */
  readonly kind: 'gable' | 'shed' | 'hip' | 'blind';
  /** Frontbreite (Standard 3; Schleppgaube: Scheibenband, Front = Breite + 2). Andere Werte gelten als 3. */
  readonly width?: 1 | 3 | 5;
  /** Mindestabstand zwischen zwei Gaubendächern in Blöcken (Standard 2). */
  readonly minGap?: number;
}

/**
 * Pflichtregeln der Fassade (Q2, research/58 §Q2 aus research/59 Hebel 1–5, research/53 §1–5, research/55 Hebel 1/5).
 * Fehlt das Feld, ist die Hülle zellgleich zum Stand davor; ist es gesetzt, gelten die Regeln als **Pflicht** und
 * überstimmen die Einzelfelder, die sie betreffen (`minOverhang` schlägt `ShellOptions.overhang`,
 * `foundationBase` schaltet das Sockelprofil ein, `pierFrom` ergänzt `pilasters`).
 */
export interface FacadeRules {
  /**
   * Dachüberstand ≥ n Blöcke (Hebel 1): `overhang: 0` wird angehoben. Bei geneigten Dächern Pflicht, `flat` bleibt
   * ohne Überstand (dort gibt es keine Traufe). Empfehlung/Standard der Bautypen: 1.
   */
  readonly minOverhang?: number;
  /**
   * Dachkante Pflicht (Hebel 5): Traufe, Ortgang und First laufen in der Theme-Rolle `roof_trim` (erzwingt
   * `roofDetail.trim`). Giebelfenster bleiben, wie sie ohne das Feld wären.
   */
  readonly roofEdge?: boolean;
  /**
   * Fensterrahmen Pflicht (Hebel 2): rund um jede Scheibe liegt ein Rahmen in Außenluft vor der Wand – Fensterbank
   * (`window_frame`/Stufe), Verdachung (`window_frame`/Treppe) und senkrechte Wangen (`beam`/Stamm). Die Scheibe
   * liegt dadurch 1 Block hinter der Rahmenvorderkante (Rücksprung).
   */
  readonly windowFrame?: boolean;
  /**
   * Sockel in der Theme-Rolle `foundation` (Hebel 3): das Sockelprofil läuft als `foundation` statt `wall_plinth`
   * (dunkler und rauer als die Wand) und wird eingeschaltet, auch wenn `plinthProfile` fehlt.
   */
  readonly foundationBase?: boolean;
  /**
   * Vorsprung/Pfeiler ab n Blöcken Wandlänge (Hebel 4): jede Wandlinie ab `n` Zellen bekommt mindestens eine
   * Wandvorlage, zusätzlich gilt `n` als längster flacher Lauf (wie `pilasters`, aber Pflicht).
   */
  readonly pierFrom?: number;
  /**
   * Höchstens n gleiche Fensterachsen in Folge (Hebel 5): jede (n+1)-te Achse einer Wandlinie bekommt eine andere
   * Rahmung (Gebälk statt Fensterrahmen) – Wiederholung mit Bruch.
   */
  readonly maxIdenticalAxes?: number;
  /**
   * Genau ein Fokuspunkt je Fassade (Hebel 1): je Wandlinie bekommt genau eine Fensterachse – die nächste zur
   * Haustür – die höchste Detaildichte (zusätzliche Verdachung). Hat die Linie eine Tür, ist die Tür der Fokuspunkt.
   */
  readonly focus?: boolean;
  /**
   * Additiv (W2, Baustandard W1/I2): Außenhaut statt Grundriss. Ein Innenwand-Anschluss in der Außenwand (T bzw.
   * Wandende) bekommt außen das Wandfeld (`wall_primary`) statt eines Stamms – die Innenaufteilung zeichnet sich außen
   * nicht mehr ab. Innen trägt dafür die Endzelle der Innenwand den Pfosten (`beam`/Stamm), sichtbar von beiden Räumen.
   */
  readonly skin?: boolean;
  /**
   * Additiv (W2, Baustandard F1–F4/W2): Fassadenraster. Je Außenseite Pfosten und Felder (`bays`, kein Feld schmaler
   * als `bay`), einmal für alle Geschosse; ein Fenster je Feld in der Feldmitte auf allen Geschossen (Felder mit
   * Innenwand-Stoß, Überdeckung oder Tür bleiben blind), Außentüren bevorzugt auf Feldmitten (Haustür im Mittelfeld),
   * Wandvorlagen und Konsolen nur auf Pfostenspalten mit Abstand zu Öffnungen. `ShellOptions.windows` gilt dann nur
   * noch für „Fenster aus“ (`enabled: false`).
   */
  readonly grid?: boolean;
  /** Feldbreite des Rasters (Spalten zwischen zwei Pfosten, 2–8); fehlt = Vorgabe des Themes (`facade.bay`), sonst 3. */
  readonly bay?: number;
  /** Additiv (W2, Baustandard I4): Türlaibung – Innentüren bekommen links und rechts einen Pfosten (Stamm) in den Türreihen. */
  readonly jambs?: boolean;
  /**
   * Additiv (W4-C, Baustandard F3): Haustür im Mittelfeld – mit Raster wählt die Haustür nur Zellen im Mittelfeld einer
   * Fassadenlinie (gerade Feldzahl: die beiden mittleren Felder), wo der Eingangsraum solche hat; sonst wie bisher.
   */
  readonly centerDoor?: boolean;
  /**
   * Additiv (W4-C): Raumtypen, deren Haustür eine **Doppeltür** wird (zwei Flügel, Scharniere außen wie die
   * Vanilla-Doppeltür) – nur wo ein symmetrisches Zellpaar frei ist: mit Raster die Doppelachse des geraden
   * Mittelfelds, sonst die Mitte eines geraden Wandlaufs. Leer/fehlt = nur einfache Türen.
   */
  readonly doubleDoor?: readonly string[];
}

/**
 * Additiv (W2): Fassadenraster eines Geschosses auf einer Außenseite (nur mit `FacadeRules.grid`). Koordinaten sind
 * Weltkoordinaten entlang der Linie (+x bei Nord/Süd, +z bei Ost/West); Obergeschosse gleicher Ausdehnung (±1 bei
 * Auskragung) übernehmen Pfosten und Achsen des Geschosses darunter.
 */
export interface FacadeGridLine {
  readonly floorIndex: number;
  /** Bodenplatte des Geschosses. */
  readonly y0: number;
  /** Außenseite der Wand. */
  readonly out: HorizontalDir;
  /** Wandebene: z bei Nord/Süd, x bei Ost/West. */
  readonly plane: number;
  /** Erste und letzte Wandspalte der Linie (Ecken). */
  readonly from: number;
  readonly to: number;
  /** Pfostenspalten zwischen den Enden, aufsteigend. */
  readonly posts: readonly number[];
  /** Felder zwischen den Pfosten, aufsteigend. */
  readonly bays: readonly FacadeBay[];
  /**
   * Additiv (W7-A, 27.09.2026): Pfosten, an denen in der Wand wirklich ein Ständer steht – nur bei Fachwerk-Linien
   * gesetzt (`@mcda/pipeline` `shellFor` mit Theme; das Fachwerk legt Felder zusammen und nimmt dabei Rasterpfosten weg,
   * W7-C `mergeStrips`). Traufkonsolen und Pfosten-Laternen hängen nur hier. Fehlt = alle `posts` (bisheriges Verhalten).
   */
  readonly studs?: readonly number[];
}

/** Ein Feld des Fassadenrasters: Spalten und Achse (1 Spalte; 2 beim geraden Feld genau in der Linienmitte). */
export interface FacadeBay {
  readonly from: number;
  readonly to: number;
  readonly axis: readonly number[];
}

/** Außenprofil (research/18 §3). Alles aus = bisheriges Verhalten. */
export interface FacadeStyle {
  /** Additiv (Q2): Pflichtregeln der Fassade; fehlt = bisheriges Verhalten. */
  readonly rules?: FacadeRules;
  /** F2: Sockelprofil (Treppen-Anlauf vor der Wand auf Bodenplattenhöhe der untersten Etage, Rücken zur Wand; nicht vor Türen). */
  readonly plinthProfile?: boolean;
  /** F7: Gesims/Geschossband an der Etagengrenze. */
  readonly cornice?: boolean;
  /** F7: Eckquader an Außenecken. */
  readonly quoins?: boolean;
  /**
   * D2: Traufkonsolen alle n Blöcke unter dem Dachüberstand (0/undefined = aus). Additiv: dieselben Konsolen
   * sitzen unter gemalter Auskragung um 1 Block (F3a) – an jedem Pfosten der oberen Wand und dazwischen alle n.
   */
  readonly brackets?: number;
  /**
   * Additiv (research/16 Trick #1, W1): Wandvorlagen – Stamm 1 Block vor der Wand mit Fuß (Sockeltreppe bzw.
   * Kragstein) und Kopf (umgedrehte Treppe), nie vor Fenstern/Türen. Wert = längster flacher Wandlauf ohne
   * Vorlage in Blöcken (0/undefined = aus; research/16 R3 empfiehlt 3–4, bei Fensterrhythmus 1 + 4 eher 5).
   */
  readonly pilasters?: number;
  /**
   * Additiv (F1, research/16 W4): Anbauteile in Außenluft vor der Wand – offene Falltür-Paneele in der Brüstungsreihe
   * unter Fenstern und Streben als Treppe vor der Giebelwand. Fehlt das Feld, ist das Ergebnis zellgleich zu vorher.
   */
  readonly decor?: FacadeDecor;
  /**
   * Additiv (W5-B, Review W4-R N2): Rolle der Fensterrahmen der Hülle (`FacadeRules.windowFrame`). Fehlt = `window_frame`
   * nur an den Ecken von Bank und Sturz (bitgleich; die Mitte setzt das Fenstermodul der Außen-Deko). Gesetzt = Bank
   * und Sturz über die **ganze Breite** (Ecken und Mitte, auch die Fokus-Verdachung) in dieser Rolle – der Rahmen ist
   * dann aus einem Material, die Fenstermodule setzen nur noch Wangen und Laternen (ihre Bank/Sturz-Stücke passen nicht
   * mehr und entfallen je Linie, F6). `wall_cornice` = Stein-Rahmen wie das Gesims (Burg, Wachturm: kein Holz am
   * Turmschaft).
   */
  readonly frameRole?: FrameRole;
  /**
   * Additiv (W13-E, 28.09.2026, Nutzerbefund „Fassade oben nicht gut“): Wohnbauten wechseln das Material zwischen den
   * Geschossen – Stein bzw. Holz unten, Fachwerk mit Putz darüber (Vorbilder: reddit 1mqe6ho, YT 1XXpmsOBWpE,
   * YT sK2TL4NM7aI; plan/spikes/W13E_obergeschoss_fassade.md). Die Hülle setzt nur den Leseport `Shell.upperFrame`;
   * welches Kleid die Obergeschosse und Giebel bekommen, sagen die Wandregeln des Themes (`when.upperFrame`). Fehlt =
   * bitgleich; Themes ohne solche Regel bleiben ebenfalls gleich.
   */
  readonly upperFrame?: boolean;
  /**
   * Additiv (W16-B, 28.09.2026, Review R7-4 „fensterlose Wohnküche“): Raumtypen, die auf jeder Etage mindestens ein
   * Fenster bekommen. Bleibt ein solcher Raum nach Raster bzw. Wandlauf ohne Fenster (Feld mit Tür, Innenwand-Stoß oder
   * Anbau davor), setzt die Hülle eins in seine gerade Außenwand: nicht überdeckt, mindestens 2 Zellen neben jeder Tür,
   * möglichst weit von Türen und Laufkanten. Fehlt/leer = bitgleich.
   */
  readonly lightRooms?: readonly string[];
}

/** W5-B: Rollen der Fensterrahmen der Hülle (`FacadeStyle.frameRole`). */
export const FRAME_ROLES = ['window_frame', 'wall_cornice'] as const;
export type FrameRole = (typeof FRAME_ROLES)[number];

/** Dekor des Außenprofils (F1). `role` löst das Theme auf (z. B. dunkle Eiche); fehlt es, bleibt der Pass aus. */
export interface FacadeDecor {
  /** Rolle der Anbauteile (Falltür, Treppe); Standard `beam`. */
  readonly role?: string;
  /** Offene Falltür-Paneele in der Brüstungsreihe unter jedem Fenster (research/16 W4). */
  readonly panels?: boolean;
  /** Streben als Treppe vor der Giebelwand, im Takt zwischen den Riegeln (research/16 W4). */
  readonly gableBraces?: number;
}

/** Art einer Andockstelle (research/15 §5, research/18 §1.1). */
export type ShellAnchorKind =
  | 'door' | 'window' | 'eave' | 'verge' | 'ridge' | 'ridge_end' | 'gable' | 'corner' | 'plinth' | 'storey_line' | 'roof_face';

export interface ShellAnchor {
  readonly kind: ShellAnchorKind;
  /** Außenzelle (Luft) direkt vor bzw. über dem Bauteil. */
  readonly pos: Vec3;
  /** Nach außen (von der Wand weg); bei Dachankern die Fallrichtung. */
  readonly facing: HorizontalDir;
  /** Lauflänge ab `pos` quer zu `facing` (Traufe, Band) bzw. Fensterbreite. */
  readonly span?: number;
  readonly floorIndex: number;
  readonly roomId?: RoomId;
}
