/**
 * Ein- und Ausgabe der Materialisierung (Domain Design §4.2: `materialize`, `validateWorld`).
 * Minecraft-Namen gibt es nur hier, in `platform` und in `export` (ADR 8).
 */
import type { PinwheelReport } from './pinwheel-guard.js';
import type { ResolvedTheme } from '@mcda/catalog';
import type { Vec3 } from '@mcda/core';
import type { Shell, StoryState } from '@mcda/blueprint';
import type { PlacedComponent } from '@mcda/furnishing';
import type { FamilyData, PhysicsData, Registry } from '@mcda/platform';
import type { Layer, VoxelVolume } from '@mcda/voxel';
import type { WeatheringOption } from './weathering.js';
import type { StoryProfile } from './story.js';
import type { SnowCoverOption } from './snow.js';
import type { NarrativeWeatheringLevel, NarrativeWeatheringStats } from './narrative-weathering.js';
import type { SurfaceTextureLevel, SurfaceTextureStats } from './surface-texture.js';
import type { RuinOption } from './ruin.js';
import type { TurfRoofOption } from './turf.js';
import type { LiningSpec } from './lining.js';

/** Plattform-Daten EINER Zielversion (aus dem Port `PlatformData`). */
export interface PlatformView {
  readonly registry: Registry;
  readonly families: FamilyData;
  readonly physics: PhysicsData;
  /**
   * Additiv (W3-BL): gesperrte Blöcke dieses Projekts – die Materialisierung sieht sie als „nicht vorhanden“ und ersetzt
   * sie (`banned.ts`). Fehlt oder leer = keine Sperren (bitgleich).
   */
  readonly bans?: BlockBans;
}

/** Gesperrte Blöcke samt optionaler fester Ersetzungen (Block-IDs ohne Namensraum). */
export interface BlockBans {
  readonly banned: readonly string[];
  /** Gesperrter Block → fester Ersatz (gilt vor der automatischen Wahl). */
  readonly replace?: ReadonlyMap<string, string>;
}

/** Ersatz eines gesperrten Blocks im fertigen Bau: was es gewesen wäre, was es ist, wie oft. */
export interface BlockReplacement {
  readonly from: string;
  readonly to: string;
  readonly count: number;
}

/** Eine platzierte Komponente mit ihrer Herkunft (Platzierungs-ID). */
export interface MaterializePlacement {
  /** Platzierungs-ID → `owner` jeder erzeugten Zelle/Entity. */
  readonly id: string;
  readonly placed: PlacedComponent;
  /** Seed der Platzierung (Mischungen, Item-Rollen, Loot-Seed); Default: aus der ID abgeleitet. */
  readonly seed?: number;
  /** Merge-Schicht; Default aus `mount` (wall → Anbauteil, *_inset → Architektur, sonst Möbel). */
  readonly layer?: Layer;
  /** Raum (nur für Meldungen). */
  readonly roomId?: string;
}

export interface MaterializeOptions {
  /**
   * W8-G (2026-09-27) Windrad-Wächter (HANDOFF §1, `pinwheel-guard.ts`): nach Autotiling die fertige Welt nach
   * chiralen 4-zähligen Figuren absuchen und sie deterministisch beheben. **Standard an** (Projektregel); `false` nur
   * für Messungen. Ohne Befund bleibt das Volumen unverändert (bitgleich).
   */
  readonly pinwheelGuard?: boolean;
  /** Benachbarte Einzeltruhen gleicher Ausrichtung zu Doppeltruhen koppeln (Default: true). */
  readonly pairChests?: boolean;
  /** Volumen-Ausschnitt; Default: Hüllkörper aller Zellen. */
  readonly bounds?: { readonly origin: Vec3; readonly size: Vec3 };
  /**
   * Dekorateur „Verwitterung/Bewuchs“ (Variantenwechsel mossy/cracked, keine Geometrie). Default: wie im
   * Theme (`decor.weathering`); `false` schaltet ab, ein Objekt übersteuert Alter/Faktoren.
   */
  readonly weathering?: WeatheringOption;
  /** Flächen-Muster des Themes (`surfaces`) anwenden (Default: true). */
  readonly surfaces?: boolean;
  /**
   * Zielwert für die Lichtlücke eines Raums in Taxi-Blöcken (research/37: Blocklicht fällt je Block um 1).
   * **Ohne Angabe wird nicht geprüft** – die Prüfung gehört zur fertigen Welt (Pipeline setzt 16), nicht zu
   * jeder Einzelmaterialisierung im Test. Gemessen liegen unsere Häuser bei 6–9 Blöcken; die recherchierten
   * Extremfälle sind Laterne in Decke 4 → 21 und Decke 8 → 13. Ohne Quelle im Bau gibt es keine Meldung.
   */
  readonly lightGap?: number;
  /**
   * Zell-Attribute capturen (research/30 K7): Deko-Zellen in Außenluft erben `wall_h`/`hRel`/`storey` ihrer
   * Trägerwand, damit Verläufe, Muster-Jitter und Verwitterung dort weiterlaufen. **Default `false`** – ohne den
   * Schalter trägt keine Zelle `attrs` und alle Prüfsummen bleiben bitgleich.
   */
  readonly captureAttributes?: boolean;
  /**
   * Dekorateur „Schneeauflage“ (additiv, research/24 §7.4): Default wie im Theme (`decor.snowCover`),
   * `false` schaltet ab, ein Objekt übersteuert Rollen/Schichthöhe/Wahrscheinlichkeit/Dachgrenze.
   * **Ohne das Theme-Feld passiert nichts** – alle Prüfsummen bleiben bitgleich.
   */
  readonly snowCover?: SnowCoverOption;
  /**
   * Dekorateur „Ruine“ (additiv, research/50 C1): entfernt Zellen der Hülle von oben (Erosion der Silhouette).
   * Default wie im Theme (`decor.ruin`), `false` schaltet ab, ein Objekt übersteuert Rollen/Anteil/Tiefe/Dachgrenze.
   * **Ohne das Theme-Feld passiert nichts** – alle Prüfsummen bleiben bitgleich.
   */
  readonly ruin?: RuinOption;
  /**
   * W13-B Dekorateur „Torfdach“ (additiv): Default wie im Theme (`decor.turfRoof`, der Seed wählt Torf- oder Holzdach
   * nach `share`); `true` erzwingt das Torfdach, `false` schaltet ab, ein Objekt übersteuert Anteil/Moos/Bewuchs.
   * **Ohne das Theme-Feld passiert nichts** – alle Prüfsummen bleiben bitgleich.
   */
  readonly turfRoof?: TurfRoofOption;
  /**
   * Nutzungszustand (additiv, Q5/P15, research/55 §2): material- und ortsbezogene Spuren der Hüllzellen
   * (`story.ts`) – Flechten/Risse am Stein, entrindetes Holz, vergraute Farbflächen, Laufspur an der Tür.
   * **Ohne Angabe passiert nichts** – alle Prüfsummen bleiben bitgleich. Geometrie, Rollen und Physik-Klassen
   * ändern sich nie, nur der Block der Zelle.
   */
  readonly storyState?: StoryState;
  /**
   * feat/theme-moods: fertiges Story-Profil (`moodStoryProfile`, Stimmungsachse `wear` über dem Zustand). Hat Vorrang
   * vor `storyState`; dieselben Kanäle, nur stufenlos. **Ohne Angabe passiert nichts** (bitgleich).
   */
  readonly storyProfile?: StoryProfile;
  /**
   * WS-Verwitterung (Schritt 5 „Texturierung mit Bedeutung“, additiv): erzählende Verwitterungs-Cluster mit Ursache
   * (Regenstreifen unter Fenstern, Schatten unter Überhängen, Moos/Bruchstein am Sockel, Dachtäler mit Wasserablauf,
   * Baumkontakt), die über eine Übergangskachel in die Grundfarbe auslaufen (`narrative-weathering.ts`). Stärke aus
   * Stufe × Story-Profil (`age`, also Stimmung `wear`). **Ohne Angabe passiert nichts** – alle Prüfsummen bleiben
   * bitgleich; Geometrie, Rollen und Physik-Klassen ändern sich nie, nur der Block der Zelle.
   */
  readonly narrativeWeathering?: NarrativeWeatheringLevel;
  /** Nur Messung (WS-Verwitterung): `rule` = regelbasierter Verlauf statt WFC-Solver; fehlt = WFC. */
  readonly narrativeWeatheringSolver?: 'wfc' | 'rule';
  /**
   * TX-B Oberflächen-Textur (additiv): Blockmischung aus Schwesterblöcken in zusammenhängenden Flecken (Wand, Sockel,
   * Dachhaut), Verläufe (Sockel dunkler, unter Gesims/Traufe dunkler, Dach Traufe→First), Kontrast an Ecken und
   * Öffnungen, Musterbruch durch Streublöcke (`surface-texture.ts`). Jede Änderung gehört zu einer benannten Regel.
   * Stärke aus Stufe × Story-Profil (`age`). Läuft **vor** der Verwitterung. **Ohne Angabe passiert nichts** – alle
   * Prüfsummen bleiben bitgleich; nur der Block einer Hüllzelle wird getauscht, Belegung/Rollen/Physik bleiben.
   */
  readonly surfaceTexture?: SurfaceTextureLevel;
}

export interface MaterializeInput {
  readonly shell: Shell;
  readonly placements: readonly MaterializePlacement[];
  readonly theme: ResolvedTheme;
  readonly platform: PlatformView;
  /** Projekt-Seed (Mischungen der Hülle). */
  readonly seed: number;
  /** Raum-ID → Raumtyp-ID (für raumtypabhängige Flächen-Regeln, z. B. Steinboden in der Küche). */
  readonly roomTypes?: Readonly<Record<string, string>>;
  readonly options?: MaterializeOptions;
  /**
   * Additiv (W2, Baustandard I1/I4): Innenhaut in der Innenluft vor den Wänden (`lining.ts`; geplant von
   * `@mcda/furnishing` `planLining`, die Pipeline liefert sie je Raum). Gesetzt nur in freie Luft, nie in
   * Luft-Masken oder Entity-Zellen. Fehlt = keine Innenhaut (bitgleich).
   */
  readonly lining?: readonly LiningSpec[];
}

export type ViolationKind =
  | 'support' //       Block braucht Stütze und hat keine (Faktencheck 3/4/15)
  | 'support_mask' //  Stütz-Maske der Komponente nicht erfüllt
  | 'gravity' //       fallender Block ohne Unterlage
  | 'air_mask' //      Luft-Maske der Komponente belegt
  | 'bed_half' //      Bett-Hälfte ohne passenden Partner
  | 'door_half' //     Tür-Hälfte ohne passenden Partner
  | 'chest_pair' //    Truhenhälfte ohne passenden Partner (→ auf single gesetzt)
  | 'stair_shape' //   Soll-Form der Hülle ≠ Vanilla-Regel (Vanilla gilt, sonst korrigiert /place non-strict)
  | 'redstone' //      Redstone-Bauteil inkonsistent (ausgefahrener Kolben ohne Kopf, Kopf ohne Kolben)
  | 'entity_support' // Rahmen/Gemälde ohne festen Träger (isSolid), ohne Freiraum oder überlappend (fällt ab, M2)
  | 'spawn' //        begehbare Innenzellen mit Blocklicht 0
  | 'light_gap' //   Lichtlücke eines Raums über dem Zielwert (research/37: Level − 1 je Block)
  | 'project'; //     Projektweite Meldung (Review 3: „leeres Projekt exportierbar“)

export interface Violation {
  readonly kind: ViolationKind;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly pos?: Vec3;
  readonly owner?: string;
  readonly block?: string;
  readonly roomId?: string;
  /** Betroffene Zellen (z. B. dunkle Zellen eines Raums). */
  readonly cells?: readonly Vec3[];
}

export interface DarkCell {
  readonly pos: Vec3;
  readonly roomId: string;
  /** true: Untergrund und Zelle erlauben laut Physik-Daten einen Mob-Spawn (Faktencheck 5). */
  readonly spawnable: boolean;
  /**
   * Additiv (W4, 27.09.2026): Zelle im Dachraum (Luft unter einem geneigten Dach über der obersten Decke, kein Raum);
   * `roomId` ist dann der Raum der Decke darunter.
   */
  readonly attic?: true;
}

/**
 * Lichtlücke eines Raums (research/23 §Q1, research/37 „Licht ist exakt rechenbar“): größter **Taxi-Abstand**
 * einer begehbaren Innenzelle zur nächsten Lichtquelle. Blocklicht fällt je Block um 1 – der Wert sagt also
 * direkt, wie dunkel die dunkelste Ecke ist (`−1` = gar keine Lichtquelle im Bau).
 */
export interface LightGap {
  readonly roomId: string;
  readonly maxDistance: number;
  readonly cell: Vec3;
}

export interface LightReport {
  /** Blocklicht 0–15 je Position (außerhalb des Volumens: 0). */
  levelAt(pos: Vec3): number;
  readonly emitters: readonly { readonly pos: Vec3; readonly block: string; readonly level: number }[];
  /** Begehbare Innenzellen mit Blocklicht 0. */
  readonly darkCells: readonly DarkCell[];
  /** Anzahl geprüfter begehbarer Innenzellen. */
  readonly walkableCells: number;
  /** Lichtlücke je Raum, absteigend nach Abstand (additiv, research/37). */
  readonly gaps: readonly LightGap[];
  /** Additiv (W4): Anzahl geprüfter begehbarer Dachraum-Zellen (`DarkCell.attic`). */
  readonly atticCells?: number;
}

/** Wie eine Rolle + Form aufgelöst wurde (für UI/Bericht: Ersatz sichtbar machen). */
export interface MaterialResolution {
  readonly role: string;
  readonly shape: string;
  readonly block: string;
  readonly family: string;
  readonly via: 'direct' | 'block' | 'role_fallback' | 'version_fallback' | 'platform_fallback';
}

/**
 * Ein Posten der **gemessenen Palette** (Axiom-Palettenvorschau, research/13 #17/#19): wie oft ein Block im
 * fertigen Volumen vorkommt, mit der Rolle, über die er dorthin kam. Gezählt wird NACH dem Merge, also der
 * tatsächlich sichtbare Bestand (spätere Schichten überschreiben frühere).
 */
export interface PaletteEntry {
  readonly block: string;
  /** Rolle der Zelle (Hülle) bzw. des Materials (Komponente); fehlt, wenn die Zelle keine Rolle hat. */
  readonly role?: string;
  readonly count: number;
}

export interface MaterializeResult {
  readonly volume: VoxelVolume;
  readonly violations: readonly Violation[];
  readonly light: LightReport;
  readonly version: string;
  readonly dataVersion: number;
  /** Alle Rolle+Form-Auflösungen, die NICHT direkt waren (Ersatz, Versions-Fallback). */
  readonly substitutions: readonly MaterialResolution[];
  /**
   * Gemessene Palette des fertigen Volumens, absteigend nach Anzahl (bei Gleichstand nach Rolle/Block).
   * Additiv (research/13 „Palette mit Prozentanteilen"): die App zeigt daraus Anteile je Block und Rolle.
   */
  readonly palette: readonly PaletteEntry[];
  /**
   * Additiv (W3-BL): nur mit gesperrten Blöcken (`PlatformView.bans`) – je gesperrtem Block, wodurch er im fertigen Bau
   * ersetzt wurde (Zellen). `unreplaced`: gesperrte Blöcke, für die kein Ersatz passte (bleiben im Bau, mit Warnung).
   */
  readonly banned?: { readonly replaced: readonly BlockReplacement[]; readonly unreplaced: readonly string[] };
  /** Additiv (W8-G): nur wenn der Windrad-Wächter etwas gefunden hat – Befund, Änderungen, Unbehebbares. */
  readonly pinwheel?: PinwheelReport;
  /** Additiv (WS-Verwitterung): nur mit `options.weathering` – kennzahlen des Passes (Ursachen, Cluster, Solver). */
  readonly narrativeWeathering?: NarrativeWeatheringStats;
  /** TX-B: Kennzahlen des Oberflächen-Textur-Passes (nur mit `surfaceTexture`). */
  readonly surfaceTexture?: SurfaceTextureStats;
}

/** Sammelfehler der Auflösung: unbekannte Rolle/Form, unbekannte Orientierung, ungültiger State. */
export class MaterializeError extends Error {
  override readonly name = 'MaterializeError';

  constructor(readonly problems: readonly string[]) {
    super(`Materialisierung fehlgeschlagen (${problems.length} Problem${problems.length === 1 ? '' : 'e'}):\n- ${problems.join('\n- ')}`);
  }
}
