import { parseJson5Text } from './json5Text.js';
import { z } from 'zod';
import { SHELL_ROLE_SHAPES } from './roleShapes.js';
import { PALETTE_ROLES, type PaletteRole } from './paletteRoles.js';
import type { PaletteDef } from './palette.js';
import { resolvePalettedTheme } from './palette.js';
import { roleStandardWarnings } from './standard.js';
import type { ValidationResult } from './validate.js';
import { ThemeLiningSchema, liningRoles, type LiningRule } from './lining.js';

/**
 * Theme = Rollen → Material-Familien, Textilfarben, Item-Rollen, Versions-Fallbacks
 * (plan/01 §4.2, research/04 §10). Reine Daten + Validierung; die Auflösung zu Blöcken
 * (Familie + Form → Block-ID einer Version) macht `@mcda/materialize` mit den Plattform-Daten.
 *
 * Konventionen:
 *  - Familien-IDs sind die der Plattform (`spruce`, `stone_bricks`, `iron`, `color:red` …), ohne Namespace.
 *  - Eine Rolle nennt GENAU EINES von `family`, `color` (Textilien), `mix` (gewichtete Mischung) oder
 *    `gradient` (Verlauf: Mischungen an Stopps entlang einer Kontextachse, research/12 §7.4).
 *  - Mischungs-Einträge: `family` (optional mit `variant` = Form der Familie wie `mossy`, `cracked`,
 *    `stripped_wood`), `color` oder `block` (fester Block ohne Plattform-Familie, nur für Form `block`).
 *    Einträge stehen HELL → DUNKEL: das Cluster-Rauschen (`noise.type: "cluster"`) lässt so nur Nachbarn
 *    der Liste aneinanderstoßen („Drip-Gradient“).
 *  - `noise` steuert die Wahl in Mischungen/Verläufen: `white` = unabhängig je Zelle (bisheriges Verhalten,
 *    Standard), `cluster` = zusammenhängende Flecken mit exakten Anteilen.
 *  - `surfaces` (Muster für Boden, Wand samt Fachwerk, Wandfuß, Decke, Dach) und `decor` (Verwitterung) sind optional.
 *  - `base` vererbt: Rollen des Kindes ersetzen die gleichnamigen Rollen der Basis vollständig;
 *    `items`, `versionFallbacks`, `surfaces` (je Fläche) und `decor` (je Effekt) werden schlüsselweise überschrieben.
 *  - Pflicht-Rollen (`REQUIRED_THEME_ROLES`) gelten für das AUFGELÖSTE Theme (inkl. Basis), ebenso die
 *    Prüfung, dass jede in `surfaces`/`decor` genannte Rolle existiert.
 */

/** Rollen, die jedes aufgelöste Theme haben muss (Hülle + MVP-Katalog). */
export const REQUIRED_THEME_ROLES = [
  'floor_primary',
  'wall_primary',
  'beam',
  'door',
  'window',
  'ceiling',
  'roof_main',
  'furniture_wood',
  'textile_primary',
  'light_hanging',
  'metal',
] as const;
export type RequiredThemeRole = (typeof REQUIRED_THEME_ROLES)[number];

/** Die 16 Farbstoffe (gleiche Reihenfolge wie im Spiel). */
export const THEME_COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];

/**
 * Kontextachsen für Verläufe (research/12 §7.4), jeweils 0–1. Ohne Kontext (Komponenten) gilt 0,5.
 *  - `wall_h`: 0 = unterste Wandreihe (auch Bodenplatte unter der Wand), 1 = oberste Reihe unter der Decke
 *  - `building_h`: 0 = tiefste, 1 = höchste Zelle der Hülle
 *  - `roof_t`: 0 = Traufe, 1 = First
 *  - `floor_d`: 0 = Randring an der Wand, 1 = Raummitte (Boden und Decke)
 *  - `path_d`: 0 = an der Tür (Laufweg, abgenutzt), 1 = ab 4 Schritten Abstand zur nächsten Tür
 *  - `facade_h` (additiv, W2 Regel W5): 0 = Bodenplatte des Erdgeschosses (Sockel), 1 = oberste Wandreihe des
 *    höchsten Geschosses (Traufe) – **ein** Verlauf über die ganze Fassade statt je Geschoss neu (`wall_h`). Giebel
 *    über der Traufe bleiben bei 1, Keller unter dem Sockel bei 0. Bauwerke (Mauern, Türme): wie `wall_h` (Fuß →
 *    Krone der Spalte). Ohne Kontext (Komponenten) gilt `wall_h`, sonst 0,5.
 */
export const GRADIENT_AXES = ['wall_h', 'building_h', 'roof_t', 'floor_d', 'path_d', 'facade_h'] as const;
export type GradientAxis = (typeof GRADIENT_AXES)[number];

/**
 * Standardwerte, wenn `noise` bzw. `gradient` Felder weglässt.
 *
 * `type: 'cluster'` seit der Profi-Recherche (research/20 §0.2, research/12 §7.4): Rollen mit Mischung oder Verlauf
 * bekommen ohne eigene Angabe **geclustertes** Rauschen. Vorher war der Standard `white`, und der Materialisierer
 * erzeugt für `white` gar kein Rauschen (`theme-resolve.plan`) – Flächen wie Blätter, Erde und Wege standen dadurch
 * einfarbig. Betroffen sind nur Rollen ohne eigene `noise`-Angabe; alle Themes setzen für ihre Architektur-Rollen
 * weiterhin eigene Werte.
 */
export const THEME_NOISE_DEFAULTS = { type: 'cluster', scale: 2.5, octaves: 2, dither: 0.08 } as const;
export const THEME_GRADIENT_DEFAULTS = { jitter: 0.15, interpolate: 'linear' } as const;

const ID = /^[a-z0-9_]+$/;
const FAMILY_ID = /^[a-z0-9_]+(:[a-z0-9_]+)?$/;
const BLOCK_ID = /^[a-z0-9_.-]+:[a-z0-9_/.-]+$/;
const ITEM_ROLE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

const FamilyIdSchema = z.string().regex(FAMILY_ID, 'Familien-ID: klein, optional mit Präfix (z. B. spruce, color:red)');
const ShapeSchema = z.string().regex(ID, 'Form: klein, z. B. stairs');
const ColorSchema = z.enum(THEME_COLORS);
const BlockIdSchema = z.string().regex(BLOCK_ID, 'Block-ID im Format namespace:name');
const RoleRefSchema = z.string().regex(ID, 'Rollenname: klein, z. B. floor_border');

const exactlyOne = (...vals: unknown[]): boolean => vals.filter((v) => v !== undefined).length === 1;

export const ThemeMixEntrySchema = z
  .object({
    family: FamilyIdSchema.optional(),
    color: ColorSchema.optional(),
    /** Fester Block ohne Plattform-Familie (z. B. `minecraft:coarse_dirt`); zählt nur für die Form `block`. */
    block: BlockIdSchema.optional(),
    /**
     * Form-Variante der Familie (`mossy`, `cracked`, `stripped_wood` …): bei Form `block` die Form der Familie,
     * sonst die Familie `<variant>_<family>` (z. B. `mossy_stone_bricks.stairs`), sonst die Grundform.
     */
    variant: ShapeSchema.optional(),
    weight: z.number().positive(),
  })
  .strict()
  .refine((m) => exactlyOne(m.family, m.color, m.block), { message: 'Mischungs-Eintrag braucht genau eins von family, color oder block' })
  .refine((m) => m.variant === undefined || m.family !== undefined, { message: 'variant gilt nur zusammen mit family' });

export const ThemeNoiseSchema = z
  .object({
    type: z.enum(['white', 'cluster', 'cells']).optional(),
    /** Typische Clustergröße in Blöcken (`cluster`). */
    scale: z.number().min(1).max(16).optional(),
    /** Jede weitere Oktave legt größere Zonen (Skala × 2) mit halber Stärke darüber. */
    octaves: z.number().int().min(1).max(3).optional(),
    /** Weißer Anteil, bricht Höhenlinien auf. */
    dither: z.number().min(0).max(0.3).optional(),
    /** Nur `cells`: Zellgröße in Blöcken (research/30 K1, Standard 3). */
    cell: z.number().int().min(1).max(8).optional(),
    /** Nur `cells`: reserviert für die Fugenstellung (noch nicht im Resolver verdrahtet). */
    joint: z.number().min(0).max(0.5).optional(),
    /** Nur `cells`: reserviert für das Abstandsmaß des Zellrands. */
    metric: z.enum(['chebyshev', 'manhattan']).optional(),
    /** Nur `cells`: reserviert für ein unregelmäßiges Gitter. */
    randomness: z.number().min(0).max(1).optional(),
    /**
     * Name des Rauschfelds (research/30 K3): Das Feld **ersetzt** den Rollennamen im Seed. Zwei Rollen mit
     * **gleichem** Kanal liegen damit auf demselben Feld (Muster deckt sich, z. B. Wand und ihr Fundament),
     * verschiedene Kanäle sind unabhängig („Flecken **und** Verwitterung“). Ohne Angabe ist der Rollenname
     * das Feld (bisheriges Verhalten, bitgleich).
     */
    channel: z.string().regex(ID, 'Kanalname: klein, z. B. weather').optional(),
    /** Nur `cluster`: Scherung des Rauschgitters gegen das Blockraster (0 = aus, 1–8; research/30 K3). */
    shear: z.number().int().min(0).max(8).optional(),
    /**
     * Additiv (W4, 27.09.2026, Review M6 „Tarnmuster“): **Dielen** – die Wahl gilt je Brett aus `boards` Blöcken
     * entlang der ersten Flächenachse (Boden: x), Bretter je Reihe versetzt. Aus runden Flecken werden Brettreihen;
     * das Rauschen läuft über (Brett, Reihe). Ohne Angabe je Block (bitgleich).
     */
    boards: z.number().int().min(2).max(8).optional(),
    /**
     * Additiv (W12-D, 28.09.2026): Laufrichtung der Bretter bei `boards` – `a` (Standard, erste Flächenachse: Boden x,
     * Wand waagerecht) oder `b` (zweite Achse: an der Wand **senkrecht**, Bretter je Spalte versetzt – Bretterschalung
     * im Giebel). Ohne Angabe wie bisher (bitgleich); ohne `boards` wirkungslos.
     */
    boardAxis: z.enum(['a', 'b']).optional(),
  })
  .strict();

export const ThemeGradientStopSchema = z
  .object({
    at: z.number().min(0).max(1),
    mix: z.array(ThemeMixEntrySchema).min(1),
  })
  .strict();

export const ThemeGradientSchema = z
  .object({
    along: z.enum(GRADIENT_AXES),
    /** Stopps aufsteigend, erster bei 0, letzter bei 1. */
    stops: z.array(ThemeGradientStopSchema).min(2),
    /** Verschiebt t je Zelle per Cluster-Rauschen um ±jitter → unregelmäßige Übergangszonen. */
    jitter: z.number().min(0).max(0.5).optional(),
    /** linear: Gewichte der Nachbarstopps mischen; step: nächstniedrigerer Stopp; ease: weich (Smoothstep). */
    interpolate: z.enum(['linear', 'step', 'ease']).optional(),
    /**
     * Übergangsbreite in **Reihen/Blöcken** (research/30 K2, Vorbild Map Range `Steps`): die Mischung zwischen
     * zwei Stopps läuft nicht über den ganzen Abstand, sondern nur über `fade` Reihen um dessen Mitte. Ohne
     * Angabe bleibt der Übergang so breit wie der Stopp-Abstand (heutiges Bild).
     */
    fade: z.number().min(0).max(3).optional(),
    /**
     * Additiv (W2 Regel D1, „Deckungsrezept“): `ring` wählt **je Reihe/Ring** (gleicher Achsenwert, z. B. eine
     * Dachreihe über `roof_t`) genau einen Eintrag – ohne Jitter und ohne Rauschen innerhalb der Reihe. Gewählt wird
     * der Median der Gewichte an dieser Stelle (Einträge in Tonordnung HELL → DUNKEL), dadurch laufen die Töne
     * monoton in ganzen Ringen (dunkel an der Traufe → hell am First). Ohne Angabe bleibt die Wahl je Zelle.
     */
    quantize: z.enum(['ring']).optional(),
    /**
     * Additiv (W9-G5, Materialspiel; nur mit `quantize: "ring"`): Anteil je Ring (höchstens 10 %, Baustandard D1
     * „Materialwechsel in derselben Dachreihe < 10 %“), der als zusammenhängende Flecken (festes Cluster-Rauschen über
     * die Fläche, reihenübergreifend) den **Nachbarton** der Tonreihe bekommt – den nächsten Eintrag, am Ende den
     * vorigen. So hat die Fläche Textur („cluster, don't sprinkle“), die Ringe bleiben lesbar. Ohne Angabe bitgleich.
     */
    patch: z.number().min(0).max(0.1).optional(),
  })
  .strict();

export const ThemeRoleSchema = z
  .object({
    /** Material-Familie der Plattform (z. B. `spruce`, `deepslate_tiles`, `iron`). */
    family: FamilyIdSchema.optional(),
    /** Textilfarbe: wird zur Wollfamilie `<farbe>_wool`, sonst `color:<farbe>` (Kerze, Beton …). */
    color: ColorSchema.optional(),
    /** Gewichtete Mischung (z. B. 70 % Steinziegel, 20 % bemoost, 10 % Bruchstein). */
    mix: z.array(ThemeMixEntrySchema).min(2).optional(),
    /** Verlauf: Mischungen an Stopps entlang einer Kontextachse (z. B. Wandfuß dunkel → oben hell). */
    gradient: ThemeGradientSchema.optional(),
    /** Wahl in Mischung/Verlauf: `white` (je Zelle unabhängig, Standard) oder `cluster` (Flecken). */
    noise: ThemeNoiseSchema.optional(),
    /** Komponenten: Mischung je Zelle statt je Platzierung (Mauerwerk wie Herd/Esse). */
    perCell: z.boolean().optional(),
    /** Form-Umleitung: gewünschte Form → Form der Familie (z. B. `log` → `stripped_log`). */
    shapes: z.record(ShapeSchema, ShapeSchema).optional(),
    /** Feste Blöcke je Form (z. B. `lantern` → `minecraft:soul_lantern`); Vorrang vor der Familie. */
    blocks: z.record(ShapeSchema, BlockIdSchema).optional(),
    /** Ersatzfamilien, falls die Familie die Form nicht hat (vor den Plattform-Fallbacks). */
    fallback: z.array(FamilyIdSchema).min(1).optional(),
  })
  .strict()
  .refine((r) => exactlyOne(r.family, r.color, r.mix, r.gradient), { message: 'Rolle braucht genau eins von family, color, mix oder gradient' });

// ---------------------------------------------------------------- Flächen-Muster (research/12 §3–§5)

const IntRangeSchema = z.union([z.number().int(), z.tuple([z.number().int(), z.number().int()])]);

/** Bedingung einer Flächen-Regel; alle genannten Felder müssen passen. */
export const SurfaceWhenSchema = z
  .object({
    /** Raumtypen (Raum der Zelle bzw. Träger-Raum der Wand). */
    roomTypes: z.array(z.string().regex(ID)).min(1).optional(),
    /** Außenwand bzw. Wandfuß unter einer Außenwand. */
    exterior: z.boolean().optional(),
    /** Wand: Reihe über der Bodenplatte (0 = erste Reihe), Zahl oder [min, max]. */
    hRel: IntRangeSchema.optional(),
    /** Wand: Reihe unter der Decke (0 = oberste Reihe). */
    fromTop: IntRangeSchema.optional(),
    /** Lichte Höhe des Raums ≥ / ≤. */
    minHeight: z.number().int().min(1).optional(),
    maxHeight: z.number().int().min(1).optional(),
    /** Additiv (F1): Geschoss (0 = Erdgeschoss), Zahl oder [min, max]. */
    storey: IntRangeSchema.optional(),
    /** Additiv (F1): oberstes Geschoss an dieser Stelle (darüber Decke/Dach statt einer weiteren Etage). */
    topStorey: z.boolean().optional(),
    /**
     * Additiv (W2, Baustandard I3): unterstes Geschoss an dieser Stelle – unter dem Boden liegt kein Raum und keine
     * Wand einer tieferen Etage (Keller). Ein Boden mit `bottomStorey: false` ist zugleich die Decke des Raums
     * darunter; dort gehören Steinboden, Lehm oder Wollläufer nicht hin.
     */
    bottomStorey: z.boolean().optional(),
    /** Additiv (research/16 D12): Dachlinie der Zelle – Grat (`hip`, Außenecke) bzw. Kehle (`valley`, Innenecke). */
    roofLine: z.array(z.enum(['hip', 'valley'])).min(1).optional(),
    /**
     * Additiv (W13-E, 28.09.2026): der Bautyp gibt den Obergeschossen ein eigenes Wandkleid (`FacadeStyle.upperFrame`,
     * Leseport `Shell.upperFrame`). `true` passt nur an solchen Hüllen, `false` nur an allen anderen.
     */
    upperFrame: z.boolean().optional(),
  })
  .strict();

const SurfaceOutSchema = z.object({ role: RoleRefSchema, shape: ShapeSchema.optional() }).strict();

/**
 * Zweiter Bordürenring mit eigener Mindestgröße (`minSide`, research/30 K5 „Clamp Overlap“):
 * eine Bordüre braucht Platz – ohne Angabe gelten die bisherigen Schwellen (Rand ≥ 3, zweiter Ring ≥ 5).
 */
const BorderInnerSchema = z
  .object({
    role: RoleRefSchema,
    shape: ShapeSchema.optional(),
    /** Mindestbreite (kurze Innenseite) für DIESEN Ring; Standard 5. */
    minSide: z.number().int().min(2).max(16).optional(),
  })
  .strict();

/**
 * Fachwerk-Motive je Feld (research/18 F1, research/12 §3.3), Feld = Gefach zwischen zwei Ständern, Schwelle und Rähm.
 * `brace` = Strebe („/“ links der Fassadenmitte, „\“ rechts), `cross` = Andreaskreuz, `k` = K-Strebe („Mann“),
 * `rhombus` = Raute, `feet` = Fußbänder, `rail` = nur Riegel, `none` = leeres Gefach.
 */
export const TIMBER_MOTIFS = ['none', 'brace', 'cross', 'k', 'rhombus', 'feet', 'rail'] as const;
export type TimberMotif = (typeof TIMBER_MOTIFS)[number];

/**
 * Fachwerk (additiv, F1) an einer Wandregel: die Regel-Rolle ist das Gefach, `role` das Holz. Ständer an Ecken, neben
 * Öffnungen und im Feldrhythmus `bay`; Brüstungs- und Sturzriegel an Fenstern; Streben je Feld nach `motifs`, per Seed
 * spiegelsymmetrisch zur Fassadenmitte. Schwelle: die Bodenplatte darunter (Wandfuß-Regel mit `along`) bzw. mit `sill`
 * die unterste Wandreihe; Rähm: Deckenrähm (`surfaces.ceiling[].plate`) bzw. Bodenplatte der Etage darüber. Giebel und
 * Gauben: Ständer laufen durch, Riegel alle 4 Reihen, Fenster gerahmt.
 */
export const WallTimberSchema = z
  .object({
    /** Holz (Ständer, Riegel, Streben), Standard `beam`. */
    role: RoleRefSchema.optional(),
    /** Motive der fensterlosen Felder (Standard: cross, brace, k, none). */
    motifs: z.array(z.enum(TIMBER_MOTIFS)).min(1).optional(),
    /** Wunschbreite eines Feldes zwischen zwei Ständern (Standard 3, research/16 R1). */
    bay: z.number().int().min(2).max(6).optional(),
    /** Unterste Wandreihe als Schwelle (liegender Stamm); sonst trägt die Bodenplatte darunter. */
    sill: z.boolean().optional(),
    /**
     * Additiv (F1, research/16 W4): zusätzliche Anbauteile in Außenluft (Schicht 6) – offene Falltür-Paneele unter
     * Fenstern und Streben als Treppe vor der Wand (Giebel). Standard aus (`decorate: false`); die App setzt den
     * Schalter „Fachwerk-Deko“ daraus vor. Die Rollen-Form-Paare (`beam.trapdoor`, `beam.stairs`) sind in
     * `SHELL_ROLE_SHAPES` (`@mcda/materialize`) eingetragen und damit in jedem Theme geprüft.
     */
    decorate: z.boolean().optional(),
    /** Rolle der Deko (Standard `beam`); muss im Theme (auch geerbt) aufgelöst werden können. */
    decorRole: RoleRefSchema.optional(),
  })
  .strict();

/** Wand- und Wandfuß-Regel: erste passende Regel gewinnt und setzt Rolle (und Form). */
export const SurfaceRuleSchema = z
  .object({
    when: SurfaceWhenSchema.optional(),
    role: RoleRefSchema,
    shape: ShapeSchema.optional(),
    /** Additiv (F1): Stamm/Holz liegt entlang der Wand (Schwelle, Band); an Spalten ohne Laufrichtung Form `corner`. */
    along: z.boolean().optional(),
    /** Form an Ecken bei `along` (Standard `wood`, rundum Rinde). */
    corner: ShapeSchema.optional(),
    /** Additiv (F1): Fachwerk-Muster (nur in `surfaces.wall`). */
    timber: WallTimberSchema.optional(),
  })
  .strict();

export const FloorBorderSchema = z
  .object({
    /** Rolle des Randrings (Wandabstand 1). */
    role: RoleRefSchema,
    /** Form am Rand, Standard `log` (Achse parallel zur Wand). */
    shape: ShapeSchema.optional(),
    /** Form an Ecken, Standard `wood` (rundum Rinde, achsenneutral). */
    corner: ShapeSchema.optional(),
    /** Zweiter Ring (Doppelbordüre, Wandabstand 2), Standard ab 5 × 5 (`minSide` überschreibt). */
    inner: BorderInnerSchema.optional(),
    /** Mindestbreite (kurze Innenseite) für die Bordüre; Standard 3. */
    minSide: z.number().int().min(2).max(16).optional(),
    /** Türschwellen bekommen die Bordüre, damit der Rahmen durch die Tür läuft (Standard true). */
    thresholds: z.boolean().optional(),
  })
  .strict();

const patternOut = { role: RoleRefSchema, shape: ShapeSchema.optional() };

/**
 * Bodenmuster in raumlokalen Koordinaten (u entlang der langen Achse der Innenfläche, v quer).
 * Slot 1 = `role`/`shape` des Musters, sonst gilt die Grundrolle des Rezepts.
 */
export const FloorPatternSchema = z.discriminatedUnion('type', [
  /** (⌊u/size⌋ + ⌊v/size⌋) mod 2 = 1 */
  z.object({ type: z.literal('checker'), size: z.number().int().min(1).max(4).optional(), ...patternOut }).strict(),
  /** (u + v) mod period < width */
  z.object({ type: z.literal('diagonal'), period: z.number().int().min(2).max(8).optional(), width: z.number().int().min(1).max(4).optional(), ...patternOut }).strict(),
  /** alle Zellen: liegender Stamm, Achse u wenn ((u − v) mod 2·length) < length, sonst v */
  z.object({ type: z.literal('herringbone'), length: z.number().int().min(1).max(4).optional(), ...patternOut }).strict(),
  /** Streifen der Breite size mit wechselnder Achse, Fugen (`joint`) dazwischen */
  z.object({ type: z.literal('basketweave'), size: z.number().int().min(2).max(4).optional(), joint: SurfaceOutSchema.optional(), ...patternOut }).strict(),
  /** Dielenstöße: (v + 3u) mod period = 0 */
  z.object({ type: z.literal('joints'), period: z.number().int().min(3).max(9).optional(), ...patternOut }).strict(),
  /** konzentrische Ringe um die Raummitte: Ring mod period = 0 */
  z.object({ type: z.literal('rings'), period: z.number().int().min(2).max(6).optional(), ...patternOut }).strict(),
  /** Läufer von der Haupttür zur Gegenwand (Breite automatisch 1–3), optional mit Randfarbe `edge` */
  z.object({ type: z.literal('runner'), width: z.number().int().min(1).max(3).optional(), edge: SurfaceOutSchema.optional(), ...patternOut }).strict(),
]);

/** Bodenrezept je Raum: Grundrolle + Bordüre + höchstens ein Muster (research/12 §4, Regel 4). */
export const FloorRecipeSchema = z
  .object({
    when: SurfaceWhenSchema.optional(),
    /** Grundrolle der Innenfläche (Standard: Rolle der Hülle, `floor_primary`). */
    role: RoleRefSchema.optional(),
    border: FloorBorderSchema.optional(),
    pattern: FloorPatternSchema.optional(),
  })
  .strict();

/** Deckenrezept: Balkenraster quer zur kürzeren Spannweite, Unterzug, Rähm über den Wänden (research/12 §5). */
export const CeilingRecipeSchema = z
  .object({
    when: SurfaceWhenSchema.optional(),
    /** Grundrolle der Felder (Standard: Rolle der Hülle, `ceiling`). */
    role: RoleRefSchema.optional(),
    beams: z
      .object({
        role: RoleRefSchema,
        /** Form der Balken, Standard `log` (Achse = Balkenrichtung). */
        shape: ShapeSchema.optional(),
        /** Form an Kreuzungen mit dem Unterzug, Standard `wood`. */
        crossing: ShapeSchema.optional(),
        /** Achsabstand, Standard 3. */
        period: z.number().int().min(2).max(8).optional(),
        /** Unterzug entlang der langen Achse ab dieser kurzen Spannweite (Standard 8). */
        girderSpan: z.number().int().min(3).max(64).optional(),
      })
      .strict()
      .optional(),
    /** Rähm: Deckenzellen über den Wänden als Balken entlang der Wand, Ecken `corner` (Standard `wood`). */
    plate: z.object({ role: RoleRefSchema, shape: ShapeSchema.optional(), corner: ShapeSchema.optional() }).strict().optional(),
  })
  .strict();

/** Flächen → Regeln; jeweils erste passende Zeile gewinnt. Nur Zellen mit der Standardrolle der Hülle werden umgestaltet. */
export const ThemeSurfacesSchema = z
  .object({
    floor: z.array(FloorRecipeSchema).optional(),
    wall: z.array(SurfaceRuleSchema).optional(),
    /** Bodenplatte unter Wandspalten (Sockel/Schwelle von außen gesehen). */
    footing: z.array(SurfaceRuleSchema).optional(),
    ceiling: z.array(CeilingRecipeSchema).optional(),
    /** Additiv (research/16 D12): Dachflächen (`roof_main`), Form und Ausrichtung bleiben – z. B. Grat/Kehle in `roof_trim`. */
    roof: z.array(SurfaceRuleSchema).optional(),
  })
  .strict();

/** Verwitterung/Bewuchs als reiner Variantenwechsel (mossy/cracked, research/12 §6.1). */
export const ThemeWeatheringSchema = z
  .object({
    /** Alter A (0 = neu, 0,3 = bewohnt, 0,5 = alt, 0,75 = verlassen). */
    age: z.number().min(0).max(1),
    /** Faktor für Moos (Standard 1). */
    moss: z.number().min(0).max(2).optional(),
    /** Faktor für Risse (Standard 1). */
    cracks: z.number().min(0).max(2).optional(),
    /**
     * Randzone statt Binärschwelle (research/30 K2, Vorbild ColorRamp): gesetzt wird
     * unterhalb von `pIn = p·(1 − fade/2)` immer und zwischen `pIn` und `pOut = p·(1 + fade/2)` mit linear
     * abnehmender Wahrscheinlichkeit. Erwartungswert des Anteils bleibt **p** (die Zone ist symmetrisch), der
     * Rand ist aber ausgefranst statt gerade. 0 = heutiges Verhalten (harte Schwelle).
     */
    fade: z.number().min(0).max(2).optional(),
    /**
     * Additiv (W2, Baustandard I1): `false` = Wandzellen, deren Innenseite in einem Raum ab dem Erdgeschoss liegt
     * (Wände sind 1 Block dick), verwittern nicht – Moos und Risse bleiben am Sockel/Fundament, im Keller und an
     * Bauwerken. Ohne Angabe (`true`) verwittert jede Zelle der genannten Rollen (bisheriges Verhalten).
     */
    interiorFaces: z.boolean().optional(),
    /** Rollen, deren Hüllzellen verwittern dürfen. */
    roles: z.array(RoleRefSchema).min(1),
  })
  .strict();

/**
 * Schneeauflage (additiv, research/24 §7.4 „winter“): legt auf die **oberste** Zelle einer Hüllspalte
 * (Dachfläche, Flachdach-Decke, Mauerkrone) eine Schneeauflage. Die Entscheidung je Zelle ist deterministisch
 * (Projekt-Seed + Position), es gibt keine Zufallsquelle. Die Blockwahl hängt an der Auflagefläche:
 * trägt sie eine volle Oberseite (Vollblock, obere Stufe/Platte, Flachdach), entsteht eine dünne
 * `minecraft:snow`-Schicht (`layers`); sonst – das geneigte Treppendach ist der Regelfall – ein voller
 * `minecraft:snow_block`, weil eine Schneeschicht auf einer unteren Treppenstufe im Spiel sofort wieder
 * abfällt (`SnowLayerBlock#canSurvive` braucht eine volle Auflage; vgl. physics.ts/vanilla.ts).
 */
export const ThemeSnowCoverSchema = z
  .object({
    /** Rollen der Zellen, die Schnee tragen dürfen (z. B. `roof_main`, `roof_trim`, `ceiling`). */
    roles: z.array(RoleRefSchema).min(1, 'Schnee-Decke braucht mindestens eine Rolle'),
    /** Schichthöhe der dünnen Auflage (1–8) auf Flächen mit voller Auflage; Standard 1. */
    layers: z.number().int('Schichthöhe: ganze Zahl 1–8').min(1, 'Schichthöhe: mindestens 1').max(8, 'Schichthöhe: höchstens 8').optional(),
    /** Wahrscheinlichkeit je Zelle (0–1); 1 = jede geeignete Zelle. Standard 1. */
    chance: z.number().min(0, 'Schneewahrscheinlichkeit: mindestens 0').max(1, 'Schneewahrscheinlichkeit: höchstens 1').optional(),
    /** Nur Zellen ab diesem Dachparameter `roof_t` (0 = Traufe, 1 = First); Standard 0 (ganzes Dach). */
    minRoofT: z.number().min(0, 'Dachgrenze roof_t: mindestens 0').max(1, 'Dachgrenze roof_t: höchstens 1').optional(),
  })
  .strict();

/**
 * Ruine (additiv, research/50 C1): bricht die **Silhouette** eines Baus, indem der Materialisierer Zellen der
 * Hülle entfernt (Erosion). Die Entscheidung je Spalte ist deterministisch (Projekt-Seed + Position), es gibt
 * keine Zufallsquelle. Entfernt wird nur ein **zusammenhängender Cap von oben** je Spalte; eine Zelle, die eine
 * Komponente trägt, bleibt immer stehen (siehe `@mcda/materialize` `ruin.ts`).
 */
export const ThemeRuinSchema = z
  .object({
    /** Rollen, deren Hüllzellen erodieren dürfen (z. B. `wall_primary`, `roof_main`, `ceiling`). */
    roles: z.array(RoleRefSchema).min(1, 'Ruine braucht mindestens eine Rolle'),
    /** Anteil der Spalten, die überhaupt erodieren (0–1); 1 = jede Spalte. Standard 0,5. */
    chance: z.number().min(0, 'Erosionswahrscheinlichkeit: mindestens 0').max(1, 'Erosionswahrscheinlichkeit: höchstens 1').optional(),
    /** Größte Erosionstiefe je Spalte in Zellen (1–8, von oben); Standard 2. */
    maxDrop: z.number().int('Erosionstiefe: ganze Zahl 1–8').min(1, 'Erosionstiefe: mindestens 1').max(8, 'Erosionstiefe: höchstens 8').optional(),
    /** Nur Dachzellen ab diesem Dachparameter `roof_t` (0 = Traufe, 1 = First); Standard 0 (ganzes Dach). */
    minRoofT: z.number().min(0, 'Dachgrenze roof_t: mindestens 0').max(1, 'Dachgrenze roof_t: höchstens 1').optional(),
  })
  .strict();

/**
 * W13-B (additiv, plan/spikes/W13B_nordisch_dach.md): **Torfdach** – Soden auf der Dachhaut wie an nordischen
 * Blockhäusern (en.wikipedia.org/wiki/Sod_roof). Der Materialisierer legt auf jede **innere** oberste Dachzelle der
 * genannten Rollen einen Gras- oder Moosblock (Vollblock: braucht keine Stütze), ersetzt die halbe Firstplatte eines
 * einreihigen Firsts durch einen Soden-Block und hebt die Ortgangtreppen am Giebel um eine Treppe an (Windbretter
 * halten den Torf). Die Traufreihe (`roof_t` unter `minRoofT`) bleibt frei: sie liest sich als Traufbrett. Ob ein
 * Projekt ein Torf- oder ein Holzdach bekommt, entscheidet der Projekt-Seed (`share`); `share: 0` schaltet den Pass
 * ab (Erben wie winter/harbor bleiben bitgleich). Rein und deterministisch (Seed + Position).
 */
export const ThemeTurfRoofSchema = z
  .object({
    roles: z.array(RoleRefSchema).min(1, 'Torfdach braucht mindestens eine Rolle')
      .describe('Dachrollen, deren oberste Zellen Soden tragen'),
    boards: z.array(RoleRefSchema).optional()
      .describe('Rollen (aus roles), deren Giebelkante (Ortgang) statt Soden eine zweite Treppe als Windbrett bekommt; Standard keine'),
    share: z.number().min(0, 'Torfdach-Anteil: mindestens 0').max(1, 'Torfdach-Anteil: höchstens 1').optional()
      .describe('Anteil der Projekt-Seeds mit Torfdach (0 = aus, 1 = immer); Standard 1'),
    moss: z.number().min(0, 'Moosanteil: mindestens 0').max(1, 'Moosanteil: höchstens 1').optional()
      .describe('Anteil der Soden aus Moos statt Gras (in Flecken); Standard 0,25'),
    plants: z.number().min(0, 'Pflanzenanteil: mindestens 0').max(1, 'Pflanzenanteil: höchstens 1').optional()
      .describe('Anteil der Grassoden mit Gras oder Blume obendrauf; Standard 0,08'),
    minRoofT: z.number().min(0, 'Dachgrenze roof_t: mindestens 0').max(1, 'Dachgrenze roof_t: höchstens 1').optional()
      .describe('Soden erst ab diesem Dachparameter roof_t (0 = Traufe); Standard 0,01 – die Traufreihe bleibt Brett'),
  })
  .strict();

export const ThemeDecorSchema = z
  .object({
    weathering: ThemeWeatheringSchema.optional(), snowCover: ThemeSnowCoverSchema.optional(), ruin: ThemeRuinSchema.optional(),
    turfRoof: ThemeTurfRoofSchema.optional(),
  })
  .strict();

/**
 * Fassade des Themes (additiv, W2 Baustandard F1): Feldbreite des Fassadenrasters (`FacadeRules.grid`) – Spalten
 * zwischen zwei Pfosten. Startwerte research/18 §2 und X2 §6.2: Stein 3, Fachwerk 4, nordische Hallen 5. Vererbt wie
 * `surfaces` (feldweise vom nächsten Theme der Kette, das es nennt); fehlt überall = 3.
 */
export const ThemeFacadeSchema = z
  .object({
    bay: z.number().int('Feldbreite: ganze Zahl 2–8').min(2, 'Feldbreite: mindestens 2').max(8, 'Feldbreite: höchstens 8').optional(),
  })
  .strict();

/**
 * feat/theme-moods: Achsen der Stimmung – gleiche Liste wie `MOOD_AXES` in `@mcda/core` (der Katalog hängt nicht von
 * core ab; `test/mood.test.ts` hält beide gleich). Jede Achse −1 … +1, 0 = neutral.
 */
export const THEME_MOOD_AXES = ['wear', 'richness', 'formality', 'organic'] as const;
const MoodValue = z.number().min(-1).max(1);
export const ThemeMoodSchema = z
  .object({
    wear: MoodValue.optional().describe('ordentlich (−1) … verwittert (+1)'),
    richness: MoodValue.optional().describe('karg (−1) … üppig (+1)'),
    formality: MoodValue.optional().describe('gemütlich (−1) … repräsentativ (+1)'),
    organic: MoodValue.optional().describe('symmetrisch (−1) … organisch (+1)'),
  })
  .strict();
export type ThemeMood = z.infer<typeof ThemeMoodSchema>;

export const ThemeDefSchema = z
  .object({
    id: z.string().regex(ID, 'id: klein, z. B. medieval'),
    name: z.string().min(1),
    description: z.string().optional(),
    /** Vererbung: nur die hier genannten Rollen ändern sich gegenüber der Basis. */
    base: z.string().regex(ID).optional(),
    roles: z.record(z.string().regex(ID, 'Rollenname: klein, z. B. wall_primary'), ThemeRoleSchema),
    /** Item-Rollen → konkrete Items (z. B. `food.baked` → Brot); Auswahl per Seed. */
    items: z.record(z.string().regex(ITEM_ROLE, 'Item-Rolle: z. B. food.baked'), z.array(z.string().regex(BLOCK_ID)).min(1)).optional(),
    /** Familie fehlt in der Zielversion → Ersatzfamilien in dieser Reihenfolge (z. B. poplar → oak). */
    versionFallbacks: z.record(FamilyIdSchema, z.array(FamilyIdSchema).min(1)).optional(),
    /** Muster für Boden, Wand, Wandfuß und Decke. */
    surfaces: ThemeSurfacesSchema.optional(),
    /** Dekorateure (Verwitterung). */
    decor: ThemeDecorSchema.optional(),
    /** Fassade (additiv, W2): Feldbreite des Fassadenrasters. */
    facade: ThemeFacadeSchema.optional(),
    /**
     * Farbwelt-Anschluss (research/54 §3.2): ordnet jeder **Paletten-Rolle** (`packages/catalog/src/palette.ts`,
     * z. B. `wall_primary`, `roof`, `light`) die **Theme-Rollen** zu, die eine Palette beim Umfärben ersetzt.
     * Zuordnung ist n:1 – mehrere Theme-Rollen dürfen an einer Paletten-Rolle hängen, aber jede Theme-Rolle nur
     * an einer. Themes ohne dieses Feld sind nicht palettierbar (`applyPalette` liefert sie unverändert).
     *
     * Beim Umfärben gilt der **Formvertrag** (`SHELL_ROLE_SHAPES`): Ein Paletten-Eintrag, der die von der
     * Theme-Rolle geforderte Form nicht auflösen kann (z. B. glasierte Terrakotta als Dachtreppe), wird
     * übersprungen – die Rolle behält dann ihr Theme-Material, statt den Bau unbaubar zu machen.
     */
    paletteRoleMap: z.partialRecord(
      z.enum(PALETTE_ROLES),
      z.array(RoleRefSchema, 'Paletten-Rolle braucht mindestens eine Theme-Rolle').min(1),
    ).optional(),
    /**
     * Additiv (W2, Baustandard I1/I4): Innenhaut vor den Wänden jedes Raums – Regeln je Raumtyp, erste passende
     * gewinnt (`lining.ts`). Vererbung: das nächste Theme der Kette, das das Feld nennt, gilt ganz. Ohne das Feld in
     * der ganzen Kette gibt es keine Innenhaut (bitgleich).
     */
    lining: ThemeLiningSchema.optional(),
    /**
     * feat/theme-moods: Stimmungs-Vorgabe des Themes (achsenweise vererbt). Wirkt nur, wenn die Stimmung für das
     * Projekt eingeschaltet ist (`ProjectState.mood`); ohne Schalter bleibt jedes Ergebnis bitgleich.
     */
    mood: ThemeMoodSchema.optional(),
  })
  .strict();

export type ThemeMixEntry = z.infer<typeof ThemeMixEntrySchema>;
export type ThemeNoise = z.infer<typeof ThemeNoiseSchema>;
export type ThemeGradientStop = z.infer<typeof ThemeGradientStopSchema>;
export type ThemeGradient = z.infer<typeof ThemeGradientSchema>;
export type ThemeRoleSpec = z.infer<typeof ThemeRoleSchema>;
export type SurfaceWhen = z.infer<typeof SurfaceWhenSchema>;
export type SurfaceRule = z.infer<typeof SurfaceRuleSchema>;
export type WallTimber = z.infer<typeof WallTimberSchema>;
export type FloorBorder = z.infer<typeof FloorBorderSchema>;
export type FloorPattern = z.infer<typeof FloorPatternSchema>;
export type FloorRecipe = z.infer<typeof FloorRecipeSchema>;
export type CeilingRecipe = z.infer<typeof CeilingRecipeSchema>;
export type ThemeSurfaces = z.infer<typeof ThemeSurfacesSchema>;
export type ThemeWeathering = z.infer<typeof ThemeWeatheringSchema>;
export type ThemeSnowCover = z.infer<typeof ThemeSnowCoverSchema>;
export type ThemeRuin = z.infer<typeof ThemeRuinSchema>;
export type ThemeTurfRoof = z.infer<typeof ThemeTurfRoofSchema>;
export type ThemeDecor = z.infer<typeof ThemeDecorSchema>;
export type ThemeFacade = z.infer<typeof ThemeFacadeSchema>;
export type ThemeDef = z.infer<typeof ThemeDefSchema>;

/** Theme nach Auflösung der Vererbung. */
export interface ResolvedTheme {
  readonly id: string;
  readonly name: string;
  /** Vererbungskette von der Wurzel bis zu diesem Theme. */
  readonly chain: readonly string[];
  readonly roles: Readonly<Record<string, ThemeRoleSpec>>;
  readonly items: Readonly<Record<string, readonly string[]>>;
  readonly versionFallbacks: Readonly<Record<string, readonly string[]>>;
  /** Flächen-Muster (je Fläche vom nächsten Theme der Kette, das sie nennt). */
  readonly surfaces: ThemeSurfaces;
  readonly decor: ThemeDecor;
  /** Additiv (W2): Fassade (feldweise vom nächsten Theme der Kette, das sie nennt); fehlt bei Themes ohne Angabe. */
  readonly facade?: ThemeFacade;
  /** Farbwelt-Anschluss (Feldweise vom nächsten Theme der Kette, das eine Paletten-Rolle nennt). */
  readonly paletteRoleMap: ThemePaletteRoleMap;
  /** Innenhaut-Regeln (W2, I1/I4) vom nächsten Theme der Kette, das sie nennt; fehlt = keine Innenhaut. */
  readonly lining?: readonly LiningRule[];
  /** feat/theme-moods: Stimmungs-Vorgabe (achsenweise vom nächsten Theme der Kette); fehlt ohne Angabe in der Kette. */
  readonly mood?: ThemeMood;
}

/** Paletten-Rolle → Theme-Rollen, die eine Palette ersetzt (siehe `ThemeDef.paletteRoleMap`). */
export type ThemePaletteRoleMap = Partial<Record<PaletteRole, readonly string[]>>;

// ---------------------------------------------------------------- Mischungen und Verläufe

/** Identität eines Mischungs-Eintrags (ohne Gewicht), z. B. `f:stone_bricks.mossy`, `c:red`, `b:minecraft:gravel`. */
export function mixEntryKey(e: ThemeMixEntry): string {
  if (e.family !== undefined) return `f:${e.family}${e.variant !== undefined ? `.${e.variant}` : ''}`;
  if (e.color !== undefined) return `c:${e.color}`;
  return `b:${e.block}`;
}

/**
 * Palette eines Verlaufs: alle Einträge der Stopps genau einmal, in einer Reihenfolge, die die Reihenfolge
 * JEDES Stopps respektiert (topologisch; bei Gleichstand gewinnt das erste Auftreten). `consistent = false`,
 * wenn sich Stopps widersprechen (a vor b und b vor a) – dann gilt die Reihenfolge des ersten Auftretens.
 */
export function gradientPalette(g: ThemeGradient): { readonly keys: readonly string[]; readonly entries: readonly ThemeMixEntry[]; readonly consistent: boolean } {
  const first = new Map<string, ThemeMixEntry>();
  for (const s of g.stops) for (const e of s.mix) if (!first.has(mixEntryKey(e))) first.set(mixEntryKey(e), e);
  const keys = [...first.keys()];
  const index = new Map(keys.map((k, i) => [k, i] as const));
  const indeg = new Array<number>(keys.length).fill(0);
  const next = keys.map(() => new Set<number>());
  for (const s of g.stops) {
    for (let i = 1; i < s.mix.length; i++) {
      const a = index.get(mixEntryKey(s.mix[i - 1]!))!;
      const b = index.get(mixEntryKey(s.mix[i]!))!;
      if (a !== b && !next[a]!.has(b)) {
        next[a]!.add(b);
        indeg[b]!++;
      }
    }
  }
  const order: number[] = [];
  const done = new Array<boolean>(keys.length).fill(false);
  while (order.length < keys.length) {
    const i = indeg.findIndex((d, k) => d === 0 && !done[k]);
    if (i < 0) break; // Zyklus
    done[i] = true;
    order.push(i);
    for (const j of next[i]!) indeg[j]!--;
  }
  const consistent = order.length === keys.length;
  const final = consistent ? order : keys.map((_, i) => i);
  return { keys: final.map((i) => keys[i]!), entries: final.map((i) => first.get(keys[i]!)!), consistent };
}

// ---------------------------------------------------------------- Validierung

function checkMix(where: string, mix: readonly ThemeMixEntry[], warnings: string[]): void {
  const seen = new Set<string>();
  for (const e of mix) {
    const k = mixEntryKey(e);
    if (seen.has(k)) warnings.push(`${where}: Eintrag ${k} doppelt`);
    seen.add(k);
    if (e.variant === 'block') warnings.push(`${where}: variant "block" ist wirkungslos`);
  }
  dominance(where, mix, warnings);
}

/**
 * Palette-Dominanz (research/20 §0.3, research/24 §0.5, Synthese 25 W1): Eine Mischung lebt von **einem** tragenden
 * Material. Die Quellen nennen 60/30/10, 50/30/20 und 70/20/10; der gemeinsame Nenner ist, dass der größte Anteil die
 * Mehrheit stellt und kein Anteil zur Staffage verkommt. Gewarnt wird nur außerhalb des Bandes, damit die Prüfung kein
 * bestehendes Theme ohne Grund anfasst.
 */
/**
 * Sichtflächen, für die das Dominanzband gilt: Wände und Hauptboden tragen den Gesamteindruck. Für Nebenflächen
 * (Wege, Fundament, Teichboden) sind gleichmäßige Mischungen Absicht – ein Steinboden aus drei Sorten ist gewollt
 * (research/12 §7.4) und wird deshalb nicht gewarnt. Verläufe sind ausgenommen: sie variieren absichtlich.
 */
const DOMINANT_ROLES: readonly string[] = ['wall_primary', 'floor_primary'];

/** 1 im Band 45–95 % (research/20 §0.3, research/24 §0.5, Synthese 25 W1); sonst Hinweis mit dem Ist-Wert. */
function dominance(where: string, mix: readonly ThemeMixEntry[], warnings: string[]): void {
  if (mix.length < 2 || where.includes('.gradient.')) return;
  if (!DOMINANT_ROLES.some((r) => where.includes(`.${r}.`))) return;
  // `variant` ist eine Form derselben Familie und keine eigene Farbe (research/24 §3.1)
  const plain = mix.filter((e) => e.variant === undefined);
  if (plain.length < 2) return;
  const total = plain.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return;
  const share = Math.max(...plain.map((e) => e.weight / total));
  if (share < 0.45) warnings.push(`${where}: kein tragendes Material (größter Anteil ${Math.round(share * 100)} %, empfohlen 50–80 %; research/20 §0.3)`);
  else if (share > 0.95) warnings.push(`${where}: nur ein Material (${Math.round(share * 100)} %; research/20 §0.3)`);
}

export function validateThemeDef(input: unknown): ValidationResult<ThemeDef> {
  const parsed = ThemeDefSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.length > 0 ? i.path.join('.') : '(wurzel)'}: ${i.message}`), warnings: [] };
  }
  const t = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (t.base === t.id) errors.push(`${t.id}: base verweist auf sich selbst`);
  for (const [role, spec] of Object.entries(t.roles)) {
    const where = `${t.id}.${role}`;
    const entries = [...(spec.mix ?? []), ...(spec.gradient?.stops.flatMap((s) => s.mix) ?? [])];
    const fams = [spec.family, ...entries.map((m) => m.family)].filter((f): f is string => f !== undefined);
    for (const f of spec.fallback ?? []) if (fams.includes(f)) warnings.push(`${where}: Ersatzfamilie '${f}' ist schon Hauptfamilie`);
    for (const [shape, target] of Object.entries(spec.shapes ?? {})) {
      if (shape === target) warnings.push(`${where}: Form-Umleitung ${shape} → ${target} ist wirkungslos`);
    }
    if (spec.mix !== undefined) checkMix(`${where}.mix`, spec.mix, warnings);
    const g = spec.gradient;
    if (g !== undefined) {
      g.stops.forEach((s, i) => checkMix(`${where}.gradient.stops[${i}]`, s.mix, warnings));
      if (g.stops[0]!.at !== 0) errors.push(`${where}: erster Verlaufs-Stopp muss bei at = 0 liegen`);
      if (g.stops[g.stops.length - 1]!.at !== 1) errors.push(`${where}: letzter Verlaufs-Stopp muss bei at = 1 liegen`);
      for (let i = 1; i < g.stops.length; i++) {
        if (g.stops[i]!.at <= g.stops[i - 1]!.at) errors.push(`${where}: Verlaufs-Stopps müssen streng aufsteigen (Stopp ${i})`);
      }
      if (!gradientPalette(g).consistent) warnings.push(`${where}: Stopps ordnen die Einträge widersprüchlich (Reihenfolge hell → dunkel in allen Stopps gleich halten)`);
      if (g.fade !== undefined && (g.interpolate ?? THEME_GRADIENT_DEFAULTS.interpolate) === 'step') {
        warnings.push(`${where}: gradient.fade wirkt nicht mit interpolate "step" (dort gibt es keinen Übergang)`);
      }
      // D1 (W2): ganze Ringe wählen ohne Jitter und ohne Rauschen – beides wäre wirkungslos
      if (g.quantize === 'ring' && ((g.jitter ?? 0) > 0 || spec.noise !== undefined)) {
        warnings.push(`${where}: gradient.quantize "ring" wählt je Ring ohne Jitter und Rauschen (jitter/noise wirkungslos)`);
      }
      if (g.patch !== undefined && g.quantize !== 'ring') warnings.push(`${where}: gradient.patch wirkt nur mit quantize "ring"`);
    }
    if (spec.noise !== undefined && spec.mix === undefined && spec.gradient === undefined) warnings.push(`${where}: noise ohne mix/gradient ist wirkungslos`);
    const n = spec.noise;
    if (n !== undefined && n.type !== 'cells' && (n.cell !== undefined || n.joint !== undefined || n.metric !== undefined || n.randomness !== undefined)) {
      warnings.push(`${where}: cell/joint/metric/randomness wirken nur mit noise.type "cells"`);
    }
    if (n !== undefined && n.type === 'cells' && (n.scale !== undefined || n.octaves !== undefined || n.dither !== undefined || n.shear !== undefined)) {
      warnings.push(`${where}: scale/octaves/dither/shear wirken nur mit noise.type "cluster"`);
    }
    if (n !== undefined && n.type === 'white' && (n.channel !== undefined || n.shear !== undefined)) {
      warnings.push(`${where}: channel/shear wirken nicht mit noise.type "white"`);
    }
    if (spec.perCell === true && spec.mix === undefined && spec.gradient === undefined) warnings.push(`${where}: perCell ohne mix/gradient ist wirkungslos`);
  }
  for (const surface of ['wall', 'footing', 'roof'] as const) {
    t.surfaces?.[surface]?.forEach((r, i) => {
      const where = `${t.id}.surfaces.${surface}[${i}]`;
      if (r.timber !== undefined && surface !== 'wall') warnings.push(`${where}: timber wirkt nur in surfaces.wall`);
      if (surface === 'roof' && (r.along === true || r.shape !== undefined)) warnings.push(`${where}: shape/along sind am Dach wirkungslos (Form und Ausrichtung bleiben)`);
      if (r.corner !== undefined && r.along !== true) warnings.push(`${where}: corner ohne along ist wirkungslos`);
    });
  }
  // Baustandard W2 (plan/baustandard.md): Materialbudget der Wandfelder (W4), Sockel (W7), Deckungsrezept (D1)
  warnings.push(...roleStandardWarnings(t));
  // Farbwelt-Anschluss (research/54 §3.2): jede Theme-Rolle darf nur an EINER Paletten-Rolle hängen (n:1).
  {
    const owner = new Map<string, string>();
    for (const [role, targets] of Object.entries(t.paletteRoleMap ?? {})) {
      if (targets.length === 0) warnings.push(`${t.id}.paletteRoleMap.${role}: leere Ziel-Liste ist wirkungslos`);
      for (const target of targets) {
        const prev = owner.get(target);
        if (prev !== undefined && prev !== role) warnings.push(`${t.id}.paletteRoleMap: Theme-Rolle '${target}' bei '${prev}' und '${role}' (nur einmal erlaubt)`);
        owner.set(target, role);
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, value: t, warnings };
}

/** Liest ein Theme aus JSON5-Text (Katalog-Dateien erlauben Kommentare). */
export function parseThemeDef(text: string, source = '<text>'): ValidationResult<ThemeDef> {
  let raw: unknown;
  try {
    raw = parseJson5Text(text);
  } catch (e) {
    return { ok: false, errors: [`${source}: JSON5-Fehler: ${(e as Error).message}`], warnings: [] };
  }
  const r = validateThemeDef(raw);
  return r.ok ? r : { ...r, errors: r.errors.map((m) => `${source}: ${m}`) };
}

/** Alle Rollen, auf die `surfaces` und `decor` verweisen (mit Fundstelle). */
export function referencedRoles(surfaces: ThemeSurfaces, decor: ThemeDecor): Array<readonly [where: string, role: string]> {
  const out: Array<readonly [string, string]> = [];
  surfaces.floor?.forEach((r, i) => {
    const w = `surfaces.floor[${i}]`;
    if (r.role !== undefined) out.push([`${w}.role`, r.role]);
    if (r.border !== undefined) {
      out.push([`${w}.border.role`, r.border.role]);
      if (r.border.inner !== undefined) out.push([`${w}.border.inner.role`, r.border.inner.role]);
    }
    if (r.pattern !== undefined) {
      out.push([`${w}.pattern.role`, r.pattern.role]);
      if (r.pattern.type === 'basketweave' && r.pattern.joint !== undefined) out.push([`${w}.pattern.joint.role`, r.pattern.joint.role]);
      if (r.pattern.type === 'runner' && r.pattern.edge !== undefined) out.push([`${w}.pattern.edge.role`, r.pattern.edge.role]);
    }
  });
  surfaces.wall?.forEach((r, i) => {
    out.push([`surfaces.wall[${i}].role`, r.role]);
    if (r.timber !== undefined) {
      out.push([`surfaces.wall[${i}].timber.role`, r.timber.role ?? 'beam']);
      if (r.timber.decorRole !== undefined) out.push([`surfaces.wall[${i}].timber.decorRole`, r.timber.decorRole]);
    }
  });
  surfaces.footing?.forEach((r, i) => out.push([`surfaces.footing[${i}].role`, r.role]));
  surfaces.roof?.forEach((r, i) => out.push([`surfaces.roof[${i}].role`, r.role]));
  surfaces.ceiling?.forEach((r, i) => {
    const w = `surfaces.ceiling[${i}]`;
    if (r.role !== undefined) out.push([`${w}.role`, r.role]);
    if (r.beams !== undefined) out.push([`${w}.beams.role`, r.beams.role]);
    if (r.plate !== undefined) out.push([`${w}.plate.role`, r.plate.role]);
  });
  decor.weathering?.roles.forEach((r, i) => out.push([`decor.weathering.roles[${i}]`, r]));
  decor.snowCover?.roles.forEach((r, i) => out.push([`decor.snowCover.roles[${i}]`, r]));
  decor.ruin?.roles.forEach((r, i) => out.push([`decor.ruin.roles[${i}]`, r]));
  decor.turfRoof?.roles.forEach((r, i) => out.push([`decor.turfRoof.roles[${i}]`, r]));
  decor.turfRoof?.boards?.forEach((r, i) => out.push([`decor.turfRoof.boards[${i}]`, r]));
  return out;
}

/**
 * Löst die Vererbung eines Themes auf und prüft die Pflicht-Rollen.
 * Fehler: unbekannte Basis, Zyklus, fehlende Pflicht-Rollen, Verweise aus surfaces/decor auf fehlende Rollen.
 */
export function resolveTheme(defs: ReadonlyMap<string, ThemeDef>, id: string): ValidationResult<ResolvedTheme> {
  const chain: ThemeDef[] = [];
  const seen = new Set<string>();
  for (let cur: string | undefined = id; cur !== undefined;) {
    if (seen.has(cur)) return { ok: false, errors: [`${id}: Vererbungszyklus über '${cur}' (${[...seen].join(' → ')})`], warnings: [] };
    seen.add(cur);
    const def = defs.get(cur);
    if (def === undefined) {
      return { ok: false, errors: [cur === id ? `Unbekanntes Theme '${id}'` : `${id}: unbekannte Basis '${cur}'`], warnings: [] };
    }
    chain.unshift(def);
    cur = def.base;
  }
  const roles: Record<string, ThemeRoleSpec> = {};
  const items: Record<string, readonly string[]> = {};
  const versionFallbacks: Record<string, readonly string[]> = {};
  const surfaces: Record<string, unknown> = {};
  const decor: Record<string, unknown> = {};
  const facade: Record<string, unknown> = {};
  const paletteRoleMap: Record<string, readonly string[]> = {};
  let lining: readonly LiningRule[] | undefined;
  const mood: Record<string, number> = {};
  for (const d of chain) {
    Object.assign(mood, d.mood ?? {});
    Object.assign(roles, d.roles);
    Object.assign(items, d.items ?? {});
    Object.assign(versionFallbacks, d.versionFallbacks ?? {});
    Object.assign(surfaces, d.surfaces ?? {});
    Object.assign(decor, d.decor ?? {});
    Object.assign(facade, d.facade ?? {});
    Object.assign(paletteRoleMap, d.paletteRoleMap ?? {});
    // Innenhaut (W2): die Regel-Liste des spezifischsten Themes gilt ganz (erste passende Regel gewinnt)
    if (d.lining !== undefined) lining = d.lining;
  }
  const missing = REQUIRED_THEME_ROLES.filter((r) => !Object.hasOwn(roles, r));
  if (missing.length > 0) return { ok: false, errors: [`${id}: Pflicht-Rollen fehlen: ${missing.join(', ')}`], warnings: [] };
  const s = surfaces as ThemeSurfaces;
  const dc = decor as ThemeDecor;
  const unknown = [...referencedRoles(s, dc), ...liningRoles(lining)].filter(([, r]) => !Object.hasOwn(roles, r));
  if (unknown.length > 0) return { ok: false, errors: unknown.map(([w, r]) => `${id}: ${w} verweist auf unbekannte Rolle '${r}'`), warnings: [] };
  const self = chain[chain.length - 1]!;
  return {
    ok: true,
    value: {
      id, name: self.name, chain: chain.map((d) => d.id), roles, items, versionFallbacks, surfaces: s, decor: dc,
      ...(Object.keys(facade).length > 0 ? { facade: facade as ThemeFacade } : {}),
      paletteRoleMap: paletteRoleMap as ThemePaletteRoleMap,
      ...(lining !== undefined ? { lining } : {}),
      ...(Object.keys(mood).length > 0 ? { mood: mood as ThemeMood } : {}),
    },
    warnings: [],
  };
}

/**
 * Deko-Wunsch des Themas (F1, research/16 W4) aus den Wandregeln: die spezifischste Regel mit `timber.decorate: true`
 * gewinnt, sonst die erste. Rein; die App setzt daraus den Schalter „Fachwerk-Deko“ vor, die Pipeline baut daraus
 * `FacadeStyle.decor`. `undefined` = das Theme will keine Deko (Bestandsthemes: unverändert).
 */
export function timberDecor(theme: ResolvedTheme): { readonly role?: string } | undefined {
  const rules = (theme.surfaces.wall ?? []).filter((r) => r.timber?.decorate === true);
  const rule = rules.find((r) => r.timber?.decorRole !== undefined) ?? rules[0];
  return rule === undefined ? undefined : rule.timber?.decorRole !== undefined ? { role: rule.timber.decorRole } : {};
}

/** Feldbreite des Fassadenrasters (W2) aus dem Theme; `undefined` = keine Vorgabe (dann gilt die der Hülle, 3). */
export function themeFacadeBay(theme: ResolvedTheme): number | undefined {
  return theme.facade?.bay;
}

/** Unveränderliche Theme-Sammlung (separat vom Komponenten-Katalog). Prüft alle Themes beim Anlegen. */
export class ThemeCatalog {
  private readonly defs: ReadonlyMap<string, ThemeDef>;
  private readonly resolved: ReadonlyMap<string, ResolvedTheme>;
  /** W13-G: umgefärbte Themes je Palette und Theme-ID (rein, gleiche Eingabe → dasselbe Objekt für Vorschau-Caches). */
  private readonly paletted = new WeakMap<PaletteDef, Map<string, ResolvedTheme>>();

  private constructor(defs: ReadonlyMap<string, ThemeDef>, resolved: ReadonlyMap<string, ResolvedTheme>) {
    this.defs = defs;
    this.resolved = resolved;
  }

  static of(themes: readonly ThemeDef[]): ThemeCatalog {
    const defs = new Map<string, ThemeDef>();
    for (const t of themes) {
      if (defs.has(t.id)) throw new Error(`Theme '${t.id}' ist doppelt`);
      defs.set(t.id, t);
    }
    const resolved = new Map<string, ResolvedTheme>();
    const errors: string[] = [];
    for (const id of defs.keys()) {
      const r = resolveTheme(defs, id);
      if (r.ok) resolved.set(id, r.value);
      else errors.push(...r.errors);
    }
    if (errors.length > 0) throw new Error(`Themes ungültig:\n${errors.join('\n')}`);
    return new ThemeCatalog(defs, resolved);
  }

  get(id: string): ResolvedTheme {
    const t = this.resolved.get(id);
    if (t === undefined) throw new Error(`Unbekanntes Theme '${id}' (vorhanden: ${this.ids().join(', ')})`);
    return t;
  }

  def(id: string): ThemeDef | undefined {
    return this.defs.get(id);
  }

  ids(): string[] {
    return [...this.resolved.keys()].sort();
  }

  /** Die unaufgelösten Definitionen (z. B. für `resolvePalettedTheme`, das die Vererbungskette braucht). */
  themeDefs(): ReadonlyMap<string, ThemeDef> {
    return this.defs;
  }

  /**
   * Theme mit optionaler Farbwelt (research/54 §3.2). Ohne Palette identisch zu `get(id)` – inklusive
   * Referenzgleichheit, damit nichts still umgebaut wird.
   */
  resolveWith(id: string, palette?: PaletteDef): ResolvedTheme {
    if (palette === undefined) return this.get(id);
    let byId = this.paletted.get(palette);
    const hit = byId?.get(id);
    if (hit !== undefined) return hit;
    const r = resolvePalettedTheme(this.defs, id, palette);
    if (!r.ok) throw new Error(`Theme '${id}' mit Palette '${palette.id}' ungültig:\n${r.errors.join('\n')}`);
    if (byId === undefined) {
      byId = new Map();
      this.paletted.set(palette, byId);
    }
    byId.set(id, r.value);
    return r.value;
  }
}
