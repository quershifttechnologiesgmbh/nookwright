/**
 * Typen der generierten Plattform-Daten (data/*.json). Block-/Item-IDs stehen immer OHNE `minecraft:`.
 * Nur dieser Kontext kennt Mojang-Namen, DataVersions und Property-Tabellen (ACL, Domain Design §2.2).
 */

export type PropertyMap = Readonly<Record<string, string>>;

export interface BlockDef {
  /** Property → erlaubte Werte (Reihenfolge wie im Spiel). Leeres Objekt = keine Properties. */
  readonly properties: Readonly<Record<string, readonly string[]>>;
  /** Default-State (alle Properties gesetzt). */
  readonly default: PropertyMap;
}

/** Inhalt von data/registry-<version>.json */
export interface RegistryData {
  readonly version: string;
  readonly dataVersion: number;
  readonly source: string;
  readonly blocks: Readonly<Record<string, BlockDef>>;
  readonly items: readonly string[];
  readonly lootTables: readonly string[];
  /** Block-Tags kompakt: Einträge sind Block-IDs oder `#tag`-Verweise (Auflösung: Registry.blockTag / resolveTag). */
  readonly blockTags: Readonly<Record<string, readonly string[]>>;
}

/** Blockzustand: konkreter Name + Properties (Glossar: `BlockState`). */
export interface BlockState {
  readonly name: string;
  readonly properties: PropertyMap;
}

// ---------------------------------------------------------------- Physik

/**
 * Physik-Klassen (Komponentenmodell §3.1), Glossar-Brücke:
 *   air  = Luft   (air, cave_air, void_air)
 *   thin = dünn   (keine Kollision: Fackel, Schild, Druckplatte)
 *   flat = flach  (Kollisionshöhe ≤ 1/8: Teppich, Schneeschicht 2)
 *   half = halb   (Höhe ≤ 1, kein voller Würfel: Stufe, Treppe, Bett, Truhe, Tür)
 *   tall = hoch   (Höhe > 1: Zaun, Mauer, geschlossenes Zauntor)
 *   full = voll   (voller Würfel, auch aus mehreren Boxen)
 */
export const PHYSICS_CLASSES = ['air', 'thin', 'flat', 'half', 'tall', 'full'] as const;
export type PhysicsClass = (typeof PHYSICS_CLASSES)[number];

/**
 * Physik-Flags, Glossar-Brücke:
 *   climbable     = kletterbar      (Tag #climbable)
 *   liquid        = flüssig         (Wasser, Lava, Blasensäule, Seetang, Seegras)
 *   hazard        = Gefahr          (manuelle Liste ∪ 26.x-Tag #dangerous_for_teleportation)
 *   falls         = fällt           (Schwerkraft, Faktencheck 15)
 *   needsSupport  = braucht Stütze  (Faktencheck 15)
 *   signalSource  = Signalquelle    (Redstone-Quelle, blockiert Spawns in der Zelle, Faktencheck 5)
 *   waterloggable = wasserfähig     (Property `waterlogged`)
 */
export const PHYSICS_FLAGS = [
  'climbable',
  'liquid',
  'hazard',
  'falls',
  'needsSupport',
  'signalSource',
  'waterloggable',
] as const;
export type PhysicsFlag = (typeof PHYSICS_FLAGS)[number];

/** Physik eines einzelnen Zustands. */
export interface StatePhysics {
  readonly cls: PhysicsClass;
  /** max. Kollisionshöhe (0 = keine Kollision; 1.5 = Zaun/Mauer) */
  readonly h: number;
  /** Oberseite bei y=1 vollständig bedeckt (Abstellfläche/Spawn-Untergrund-Kandidat) */
  readonly topFull: boolean;
}

export interface BlockPhysics extends StatePhysics {
  /** Datenquelle: `prismarine:<version>` oder `heuristic:<analogie|tags>` */
  readonly src: string;
  readonly flags: readonly PhysicsFlag[];
  /** Mob kann in dieser Zelle NICHT spawnen (Default-State); FC 5 */
  readonly spawnBlocked: boolean;
  /** Mob kann AUF diesem Block spawnen (Default-State, vor Licht-Check); FC 5 */
  readonly spawnFloor: boolean;
  /** Falls der Zustand variiert: welche Properties Klasse/Höhe/Oberseite bestimmen */
  readonly by?: {
    readonly props: readonly string[];
    /** Schlüssel = Werte der props mit "," verbunden */
    readonly map: Readonly<Record<string, StatePhysics>>;
  };
  /** Alle vorkommenden Klassen (nur wenn variabel und nicht über `by` auflösbar, z. B. Mauern) */
  readonly classes?: readonly PhysicsClass[];
  /** Nur bei unbekannten Blöcken: Begründung der Heuristik */
  readonly guess?: string;
}

/** Inhalt von data/physics-<version>.json */
export interface PhysicsData {
  readonly version: string;
  readonly collisionSource: string;
  readonly blocks: Readonly<Record<string, BlockPhysics>>;
  /** Blöcke ohne Kollisionsdaten (heuristisch klassifiziert, zu kuratieren) */
  readonly unknown: readonly { readonly block: string; readonly suggestion: PhysicsClass; readonly reason: string }[];
  /** Begründungen der manuellen Gefahr-Liste (`hazard`) */
  readonly dangerReasons: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------- Familien

export const FAMILY_KINDS = [
  'wood',
  'stone',
  'copper',
  'wool',
  'concrete',
  'terracotta',
  'glass',
  'color',
  'other',
] as const;
export type FamilyKind = (typeof FAMILY_KINDS)[number];

/** Material-Familie: Form (Glossar: `Shape`) → Block-ID in einer Version. */
export interface Family {
  readonly id: string;
  readonly kind: FamilyKind;
  /** Form → Block-ID */
  readonly shapes: Readonly<Record<string, string>>;
  /** Weitere Blöcke je Form (z. B. Pappel-Laub in 3 Farben, Seelenlaterne) */
  readonly alternates?: Readonly<Record<string, readonly string[]>>;
  /** Abweichende Kern-Formen für die Lücken-Erkennung (Default: coreShapes[kind]) */
  readonly core?: readonly string[];
  /** Bei Farb-Familien: Farbstoff */
  readonly dye?: string;
  /** Mittlere Texturfarbe des Repräsentanten (#rrggbb), nur für Fallback-Vorschläge */
  readonly color?: string;
}

export interface FallbackStep {
  readonly family: string;
  readonly shape: string;
  readonly block: string;
  /** Kurzbegründung (Text): „gleiche Familie“, „Name …“, „Farbe Δ…“ */
  readonly why: string;
}

export interface Gap {
  readonly family: string;
  readonly kind: FamilyKind;
  readonly shape: string;
  /** true: Die Form existiert in dieser Version in KEINER Familie dieser Art */
  readonly shapeAbsentInKind: boolean;
  /** Vorgeschlagene Fallback-Kette (beste zuerst); leer = kein Block-Ersatz */
  readonly fallback: readonly FallbackStep[];
}

/** Inhalt von data/families-<version>.json */
export interface FamilyData {
  readonly version: string;
  readonly coreShapes: Readonly<Record<string, readonly string[]>>;
  readonly families: Readonly<Record<string, Family>>;
  readonly gaps: readonly Gap[];
  /** Familien der neuesten Version, die hier fehlen → ähnlichste vorhandene Familie(n) */
  readonly versionFallbacks: Readonly<Record<string, readonly string[]>>;
  /** Blöcke mit Form-Suffix, die bewusst keiner Familie zugeordnet wurden */
  readonly ignored: Readonly<Record<string, string>>;
}
