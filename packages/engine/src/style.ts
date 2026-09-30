/**
 * Gemeinsames Stil-Schema aller Generier-Operationen: Dach, Fenster, Dach-Details, Gauben, Außenprofil,
 * Außengestaltung. Eine Quelle für `building_generate` (überschreibt den Bautyp) und `rooms_generate` (vollständig).
 */
import { z } from 'zod';
import type { DormerStyle, FacadeDecor, FacadeRules, FacadeStyle, FrameRole, RoofDetail, RoofPitch, WindowStyle } from '@mcda/blueprint';
import {
  ENTRANCE_MODULES, EXTERIOR_GROUPS, FACADE_DETAIL_LEVELS, FACADE_DETAIL_PATTERNS, FANTASY_KITS, FANTASY_LEVELS, WINDOW_MODULES, type ExteriorGroup, type ExteriorStyle,
} from '@mcda/exterior';
import { BLOCK_RULE_PRESETS, normalizeBlockRules, withBlockBanned, withBlockPreset, type BlockRulePreset, type BlockRules } from '@mcda/pipeline';
import { HARMONY_CONTRASTS, HARMONY_SATURATIONS, PALETTE_GROUP_LABELS, normalizePaletteOverrides, type MoodVector, type PaletteGroup, type PaletteOverrides } from '@mcda/core';
import { PALETTE_GROUP_DEFS, paletteFamilyLabel } from '@mcda/catalog';
import { enumOf, type AssertCovered, type Uncovered } from './operation.js';
import { ROOF_STYLES } from './vocabulary.js';

const Int = z.number().int();

export const ROOF_PITCHES = enumOf<RoofPitch>()(['low', 'normal', 'steep']);
export const DORMER_KINDS = enumOf<DormerStyle['kind']>()(['gable', 'shed', 'hip', 'blind']);
type PortalKind = NonNullable<ExteriorStyle['portalKind']>;
export const PORTAL_KINDS = enumOf<PortalKind>()(['timber', 'arch']);
export const FRAME_ROLE_IDS = enumOf<FrameRole>()(['window_frame', 'wall_cornice']);
export const EXTERIOR_GROUP_IDS = enumOf<ExteriorGroup>()([
  'shutters', 'flowerBoxes', 'sills', 'hoods', 'portal', 'canopy', 'stoop', 'entranceDecor', 'chimneys', 'eaveLanterns', 'ridgeDecor', 'eaveBraces',
  'fantasyDecor', 'barnDoors', 'detailBlocks',
]);
// Laufzeit-Gegenprobe zur Liste der Domäne (Reihenfolge egal)
if (EXTERIOR_GROUPS.length !== EXTERIOR_GROUP_IDS.length) throw new Error('EXTERIOR_GROUPS und EXTERIOR_GROUP_IDS weichen ab');

export const windowsSchema = z
  .object({
    enabled: z.boolean().optional().describe('false = keine Fenster'),
    spacing: Int.min(2).max(8).optional().describe('Mindestabstand zwischen Fenstern in Wandblöcken'),
    margin: Int.min(0).max(4).optional().describe('Abstand von Ecke/Pfeiler zum ersten Fenster'),
  })
  .strict();

export const roofDetailSchema = z
  .object({
    pitch: z.enum(ROOF_PITCHES).optional().describe('Dachneigung: low = flach, normal = 45°, steep = steil'),
    trim: z.boolean().optional().describe('abgesetzte Dachkante'),
    verge: z.enum(['plain', 'closed']).optional().describe('Ortgang-Unterseite: plain = offen, closed = geschlossen'),
    flare: z.boolean().optional().describe('Glockenfuß (unterste Reihe flacher)'),
    halfHipRows: Int.min(1).max(4).optional().describe('Reihen des Krüppelwalms'),
    mansardBreak: Int.min(1).max(8).optional().describe('Knickhöhe beim Mansard-/Gambreldach'),
    gableWindows: z.boolean().optional().describe('Fenster in Giebelwänden'),
    heightBudget: z.boolean().optional()
      .describe('Automatische Dachhöhe: true = die Neigung ist ein Höchstwert – Dach höchstens Traufhöhe (ein Geschoss) bzw. 1,5 × Traufhöhe und 2 Geschosse, sonst flachere Neigung; Pultdach nur bis 7 Tiefe. Fehlt/false = Neigung und Form genau wie angegeben'),
    split: z.boolean().optional()
      .describe('Dach-Teilung (Standard an): ein eingeschossiges Satteldach ab 15 Außenmaß quer zum First (steil/Gambrel ab 13), das in der gewählten Neigung zu hoch wird (eingeschossig Dachanteil > 50 %), wird geteilt: gedrungen zur Reihe von Quergiebeln, lang zu parallelen Satteldächern – die Neigung bleibt. Mit Kniestock erst, wenn 3 Kniestock-Reihen nicht reichen. false = ein Dach'),
    kneeWall: z.boolean().optional()
      .describe('Kniestock (Standard an): bei eingeschossigen Häusern muss die sichtbare Wand (Boden bis Traufunterkante) mindestens so hoch sein wie das Dach (Traufunterkante bis First); fehlende Reihen hebt die Hülle als Kniestock über der Decke an (höchstens 3, sonst Dach-Teilung mit höchstens 1) – die Neigung bleibt. Bei mehrgeschossigen Häusern (W5) darf das oberste Dach höchstens 1,5 × so hoch sein wie die sichtbare Wand; fehlen dafür höchstens 3 Reihen, ebenso als Kniestock (nicht mit heightBudget). false = Traufe auf Deckenhöhe'),
    roofOverhang: z.enum(['legacy', 'refined']).optional()
      .describe('Überstand von Traufe und Ortgang (Standard legacy): legacy = jedes Satteldach-Rechteck wächst gleichmäßig um den Überstand; refined = die Traufe (quer zum First) behält den Überstand, der Ortgang (entlang des Firsts) ist schmal – höchstens 1 Block beim Hauptdach, 0 bei Flügeln/Quergiebeln (bündig mit der Giebelwand). Walm- und Mansarddächer bleiben gleich'),
    hatch: z.boolean().optional()
      .describe('Nur Flachdach: Dachluke – Leiter an einer fensterlosen Wand des obersten Raums bis in die Dachplatte, darüber legt die Wehrplatte bzw. der Ausguck eine Falltür (Zugang zu Wehrplatte/Ausguck). Standard aus'),
    plainShaft: z.boolean().optional()
      .describe('Turmschaft ohne Band je Geschoss: Bodenplatten der Obergeschosse in der Außenwand in Wandmaterial, kein Gesims an den Etagengrenzen, Flachdach-Rand als Steingesims statt Holz. Standard aus'),
    shaftGrid: z.boolean().optional()
      .describe('Turmschaft mit eigenem Fassadenraster (nur mit mehreren Baukörpern): jede Seite des Baukörpers ist eine Rasterlinie von Ecke zu Ecke, auch wo ein Nachbarbaukörper davor steht oder in derselben Flucht weiterläuft; dessen Linie endet an der Fuge. So fluchten die Fenster des Turms über alle Geschosse. Standard aus'),
  })
  .strict();

export const dormersSchema = z
  .object({
    kind: z.enum(DORMER_KINDS).describe('Gauben: gable = Satteldach-Gaube, shed = Schleppgaube, hip = Walmgaube, blind = Blindgaube'),
    width: z.union([z.literal(1), z.literal(3), z.literal(5)]).optional().describe('Frontbreite'),
    minGap: Int.min(1).max(8).optional().describe('Mindestabstand zwischen Gauben'),
  })
  .strict();

export const facadeDecorSchema = z
  .object({
    role: z.string().min(1).max(64).optional()
      .describe('Theme-Rolle der Anbauteile (Falltür, Treppe), z. B. beam; Standard: Vorgabe des Themes (timber.decorRole), sonst beam'),
    panels: z.boolean().optional().describe('offene Falltür-Paneele unter den Fenstern; false = aus'),
    gableBraces: Int.min(0).max(8).optional().describe('Takt der Giebelstreben (Standard 3; 0 = aus)'),
  })
  .strict();

/** Q2-Pflichtregeln der Fassade (research/58 §Q2): fehlt das Feld, bleibt die Hülle wie bisher. */
export const facadeRulesSchema = z
  .object({
    minOverhang: Int.min(1).max(3).optional().describe('Dachüberstand mindestens so viele Blöcke (Pflicht, hebt overhang: 0 an)'),
    roofEdge: z.boolean().optional().describe('Dachkante Pflicht: Traufe/Ortgang in der Rolle roof_trim'),
    windowFrame: z.boolean().optional().describe('Fensterrahmen Pflicht: Bank, Verdachung und Wangen in Außenluft (Scheibe 1 Block zurück)'),
    foundationBase: z.boolean().optional().describe('Sockel in der Theme-Rolle foundation (dunkler/rauer als die Wand)'),
    pierFrom: Int.min(3).max(12).optional().describe('Vorsprung/Pfeiler ab so vielen Blöcken Wandlänge (Pflicht)'),
    maxIdenticalAxes: Int.min(1).max(8).optional().describe('höchstens so viele gleiche Fensterachsen in Folge'),
    focus: z.boolean().optional().describe('genau ein Fokuspunkt je Fassade (Achse mit der höchsten Detaildichte)'),
    skin: z.boolean().optional()
      .describe('Außenhaut: Innenwand-Anschlüsse zeigen außen das Wandfeld statt eines Stamms; innen trägt die Endzelle der Innenwand den Pfosten'),
    grid: z.boolean().optional()
      .describe('Fassadenraster: Pfosten und Felder je Seite für alle Geschosse, ein Fenster je Feld in der Feldmitte, Tür bevorzugt im Mittelfeld, Wandvorlagen nur auf Pfosten'),
    bay: Int.min(2).max(8).optional().describe('Feldbreite des Fassadenrasters in Blöcken (Standard: Vorgabe des Themes, sonst 3)'),
    jambs: z.boolean().optional().describe('Türlaibung: Innentüren bekommen links und rechts einen Pfosten'),
    centerDoor: z.boolean().optional()
      .describe('Haustür im Mittelfeld: mit Fassadenraster nur Zellen im Mittelfeld einer Linie (gerade Feldzahl: die beiden mittleren), wo der Eingangsraum welche hat'),
    doubleDoor: z.array(z.string()).optional()
      .describe('Raumtypen, deren Haustür eine Doppeltür wird (zwei Flügel, Scharniere außen), wo ein symmetrisches Zellpaar frei ist (Doppelachse des geraden Mittelfelds); [] = nur einfache Türen'),
  })
  .strict();

export const facadeSchema = z
  .object({
    plinthProfile: z.boolean().optional().describe('Sockelprofil aus Treppen'),
    cornice: z.boolean().optional().describe('Gesims an der Etagengrenze'),
    quoins: z.boolean().optional().describe('Eckquader'),
    brackets: Int.min(0).max(8).optional().describe('Traufkonsolen alle n Blöcke (0 = aus)'),
    pilasters: Int.min(0).max(8).optional().describe('Wandvorlagen: längster Wandlauf ohne Vorlage (0 = aus)'),
    rules: facadeRulesSchema.optional()
      .describe('Pflichtregeln der Fassade (Dachkante, Fensterrahmen, Sockel, Vorsprung, Achsenbruch, Fokuspunkt, Außenhaut, Fassadenraster, Türlaibung)'),
    decor: facadeDecorSchema.optional()
      .describe('Fachwerk-Deko (Paneele, Giebelstreben); überschreibt die Theme-Vorgabe feldweise. Ohne Theme-Vorgabe schaltet nur panels: true oder gableBraces > 0 ein'),
    frameRole: z.enum(FRAME_ROLE_IDS).optional()
      .describe('Rolle der Fensterrahmen, Bank und Sturz über die ganze Breite (mit rules.windowFrame): window_frame = Rahmenholz des Themes, wall_cornice = Stein-Rahmen wie das Gesims (Burg, Wachturm); fehlt = nur die Ecken in window_frame, die Mitte setzt das Fenstermodul'),
    upperFrame: z.boolean().optional()
      .describe('Wandkleid der Obergeschosse: Obergeschosse und Giebel bekommen das Kleid, das das Theme dafür vorsieht (Mittelalter: Fachwerk mit Putz über dem Steingeschoss, Rustikal: Putz im Holzrahmen); Wohnbauten setzen es aus dem Bautyp. Fehlt = gleiches Material in allen Geschossen'),
    lightRooms: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/).max(64)).max(32).optional()
      .describe('Raumtypen mit Fenster-Pflicht je Etage (z. B. kitchen): bleibt ein solcher Raum ohne Fenster, setzt die Hülle eins in seine gerade Außenwand, mindestens 2 neben jeder Tür. Fehlt = nur das Fensterraster'),
  })
  .strict();

export const exteriorSchema = z
  .object({
    enabled: z.boolean().optional().describe('false = keine Außen-Deko'),
    density: z.number().min(0).max(2).optional().describe('Menge der Außen-Deko: 0 = sparsam, 1 = Standard, 2 = üppig'),
    variation: Int.min(0).max(999).optional().describe('andere Variante der Außen-Deko'),
    portalKind: z.enum(PORTAL_KINDS).optional().describe('Portal an der Haustür: timber = Holz, arch = Bogen'),
    windowModule: z.enum(WINDOW_MODULES).optional()
      .describe('Fenstermodul (Sturz, Bank, Läden/Wangen, Blumenkasten, Laterne): townhouse = Stadthaus, cottage = Läden + Blumenkasten, timber = Fachwerk (Kasten, ohne Läden), stone = tiefe Laibung aus Wandstein, nordic = Stammrahmen, fort = Wehrbau Holz (Stammwangen ohne Läden und Kästen); Standard nach Theme'),
    entranceModule: z.enum(ENTRANCE_MODULES).optional()
      .describe('Eingangsmodul der Haustür (Portal, Vordach, Laternenpaar, Stufe): townhouse = Stadthaus (Steingewände, Treppenbogen, Laternen am Zaun-Arm), cottage = Vordach auf Pfosten mit Laternen darunter, timber = Fachwerk-Ständer mit Kopfbändern, stone = Eckstein-Gewände mit Bogen und Laternen auf Wangen, nordic = Giebelvordach auf Pfosten; Standard nach Theme. portalKind ersetzt nur das Portal'),
    themeMaterial: z.boolean().optional()
      .describe('Module im Material des Themes: windowModule/entranceModule geben nur die Familie vor; passt das Modul nicht zum Wandmaterial des Themes (Stein-Modul an Holzwand), nimmt das Gebäude ein Modul derselben Familie im Material des Themes (Fenster: stone ↔ fort, Wachturm rustikal mit Stammwangen) bzw. sonst das Modul des Themes (Burg nordisch: nordisches Portal). Fehlt = das gewählte Modul gilt immer'),
    fantasy: z.enum(FANTASY_LEVELS).optional()
      .describe('Fantasy-Stufe: wiederkehrende Fantasy-Module an festen Ankern statt Rauschen. off = keine; accent = sparsamer Akzent in jedem Theme (Hängelaternen am geschwungenen Arm statt am geraden Zaun-Arm, aufgebogene Giebelhörner an den Traufecken); full = alle Module des Kits (dazu je Fassadenseite ein einfarbiges Banner hoch oben, Giebelzier in der Giebelspitze, Laubranken an den Ecken der Eingangsseite bzw. Feuerschalen statt der Eingangslaternen). Standard: full in den Themes elven und dwarven, sonst off (unverändert)'),
    fantasyKit: z.enum(FANTASY_KITS).optional()
      .describe('Kit der Fantasy-Module (Elfen- oder Zwergen-Zierrat, nicht das Baumaterial): elven = elbisches Fantasy-Kit; dwarven = zwergisches Fantasy-Kit. Elbisch: Holzzier, grüne Banner, Amethyst in der Giebelspitze, Azaleenlaub. Zwergisch: Steinzier, rote Banner, Runenstein (gemeißelter Tuff), Feuerschalen am Eingang. Standard: Kit gleichen Namens wie das Theme, sonst nach Wandmaterial des Themes (Holz → elven, Stein → dwarven)'),
    facadeDetail: z.enum(FACADE_DETAIL_LEVELS).optional()
      .describe('Fassaden-Details aus Teilblöcken (Tiefe an der Fassade): off = keine; subtle = dezent – Konsolen aus umgedrehten Treppen unter Auskragungen, Gesimsbändern und Fensterbänken im Obergeschoss, Hängezapfen (Zaun) unter der Giebelspitze, Regal-Auslage neben Laden- und Werkstatttüren (Shelf ab 1.21.9, sonst Fass), in Hof-Themes Fässer bzw. Heuballen an Nebentüren, in nordic/winter/rustic ein Holzstapel an der Seitenwand; rich = dazu Zahnschnitt unter Auskragung und Traufe, Laterne am Hängezapfen, Giebelbanner, Regentonnen an den Ecken der Eingangsseite, Holzstapel je Seite; grand = prunkvoll, dazu die großen Bauteile: Balkon vor dem mittleren Fenster des ersten Obergeschosses der Eingangsseite, Erker auf Konsolen vor den übrigen Seiten, Geschossband, Verdachung über den Fenstern, Strebepfeiler an langen Steinwänden, Wetterfahne und Glockentürmchen auf dem First, Rankgitter und Taubenschlag an Seitenwänden, dazu Wandrelief am Erdgeschoss: Sockelabsatz, Wandpfeiler mit Kämpferstein, Blindbogenfenster und Regenfallrohr. Welche Muster zu einem Theme passen, sagt der Katalog (exterior/detail_*). Alles spiegelsymmetrisch je Fassade, nie vor Fenstern oder im Laufweg. Standard: subtle (off = Stand vor W15)'),
    facadeDetailOff: z.array(z.enum(FACADE_DETAIL_PATTERNS)).optional()
      .describe('einzeln abgeschaltete Muster der Fassaden-Details: jettyCorbels = Konsolen unter der Auskragung, sillCorbels = Konsolen unter der Fensterbank, gablePendant = Hängezapfen im Giebel, eaveDentils = Zahnschnitt unter der Traufe, gableBanner = Giebelbanner, shopShelves = Regal-Auslage am Laden, entranceGoods = Fässer/Heuballen an Nebentüren, rainBarrels = Regentonnen an den Hausecken, woodStack = Holzstapel an der Seitenwand; nur Stufe grand: balcony = Balkon, orielWindow = Erker, windowHoods = Verdachung über Fenstern, stringCourse = Geschossband, buttress = Strebepfeiler, weathervane = Wetterfahne auf dem First, bellTurret = Glockentürmchen auf dem First, trellis = Rankgitter, dovecote = Taubenschlag, plinthLedge = Sockelabsatz, pilasters = Wandpfeiler mit Kämpferstein, blindArch = Blindbogenfenster an fensterlosen Wänden, downspout = Regenfallrohr aus Kette'),
    off: z.array(z.enum(EXTERIOR_GROUP_IDS)).optional().describe('abgeschaltete Gruppen (z. B. shutters, chimneys; eaveBraces = Traufkonsolen; fantasyDecor = Fantasy-Akzente; detailBlocks = alle Fassaden-Details)'),
    eaveBraces: z.boolean().optional()
      .describe('Traufkonsolen (umgedrehte Treppen unter dem Dachüberstand an den Rasterpfosten): fehlt = wie eaveLanterns (aus, wenn off eaveLanterns enthält); true = auch ohne Traufenlaternen; false = aus'),
  })
  .strict();

export const BLOCK_RULE_PRESET_IDS = enumOf<BlockRulePreset>()(['easy_farm']);
if (BLOCK_RULE_PRESETS.length !== BLOCK_RULE_PRESET_IDS.length) throw new Error('BLOCK_RULE_PRESETS und BLOCK_RULE_PRESET_IDS weichen ab');

const blockId = z.string().regex(/^(minecraft:)?[a-z0-9_]+$/).max(64);

/** W3-BL: Blöcke sperren und ersetzen (Projekt-Einstellung, dieselbe Regel wie im Tab „Material“ der App). */
export const blockRulesSchema = z
  .object({
    preset: z.enum(BLOCK_RULE_PRESET_IDS).optional()
      .describe('Preset: easy_farm = „Nur leicht farmbar“ – sperrt schwer zu farmende Blöcke (Prismarin, Meereslaterne, Schwamm, Purpur, Endstein, Endstab, Netherit, Gold-/Diamant-/Smaragdblock, Leuchtfeuer, Köpfe, Glocke, Froschlicht …; Liste in catalog_describe blockPresets)'),
    banned: z.array(blockId.describe('Block-ID, z. B. prismarine_bricks')).max(512).optional()
      .describe('weitere gesperrte Blöcke (IDs ohne minecraft:); der Generator ersetzt sie passend (gleiche Form aus einer ähnlichen Materialfamilie, Lichtquellen durch gleich helle)'),
    allowed: z.array(blockId.describe('Block-ID')).max(512).optional()
      .describe('Blöcke des Presets, die doch erlaubt sein sollen'),
    replace: z.record(blockId, blockId.describe('Ersatzblock')).optional()
      .describe('feste Ersetzungen gesperrter Blöcke, z. B. { "gold_block": "honeycomb_block" }; sonst wählt der Generator'),
  })
  .strict();

export type BlockRulesInput = z.output<typeof blockRulesSchema>;

/** API-Eingabe → Block-Regeln (Preset-Liste ∪ `banned` ∖ `allowed`, feste Ersetzungen); leer = keine Regeln. */
export function blockRulesOf(input: BlockRulesInput): BlockRules | undefined {
  let r = input.preset !== undefined ? withBlockPreset(undefined, input.preset, true) : undefined;
  for (const b of input.banned ?? []) r = withBlockBanned(r, b, true);
  for (const b of input.allowed ?? []) r = withBlockBanned(r, b, false);
  return normalizeBlockRules(r === undefined ? undefined : { ...r, ...(input.replace !== undefined ? { replace: input.replace } : {}) });
}

/** Hüllen-Stil (= `Partial<PlanShell>` des Bautyps). */
export const shellSchema = z
  .object({
    roof: z.enum(ROOF_STYLES).optional().describe('Dachform: flat = Flachdach, hip = Walmdach, gable = Satteldach, shed = Pultdach, half_hip = Krüppelwalmdach, dutch_gable = Walmdach mit Giebel (Fußwalm), mansard = Mansarddach, gambrel = Mansard-Satteldach (Scheunendach), saltbox = Saltbox-Dach (ungleiches Satteldach)'),
    overhang: Int.min(0).max(3).optional().describe('Dachüberstand in Blöcken'),
    windows: windowsSchema.optional().describe('Fenster'),
    roofDetail: roofDetailSchema.optional().describe('Dach-Details'),
    dormers: dormersSchema.optional().describe('Gauben'),
    facade: facadeSchema.optional().describe('Außenprofil der Fassade'),
    stableCellIds: z.boolean().optional().describe('Stabile Zell-IDs (K8): Muster/Verläufe bleiben beim Verschieben des Gebäudes stehen; Standard an, false = ortsgebundenes Verhalten'),
  })
  .strict();

export type ShellInput = z.output<typeof shellSchema>;
export type ExteriorInput = z.output<typeof exteriorSchema>;

// Compile-Zeit-Zwang (ADR 12): jedes Stil-Feld der Domäne ist hier oder begründet ausgenommen.
/** Fensterfreie Laufmitte: Feinheit der Wandvorlagen, bleibt beim Standard. */
const _w: AssertCovered<Uncovered<WindowStyle, NonNullable<ShellInput['windows']>, 'blankFrom' | 'blankWidth'>> = true;
const _r: AssertCovered<Uncovered<RoofDetail, NonNullable<ShellInput['roofDetail']>>> = true;
const _d: AssertCovered<Uncovered<DormerStyle, NonNullable<ShellInput['dormers']>>> = true;
const _f: AssertCovered<Uncovered<FacadeStyle, NonNullable<ShellInput['facade']>>> = true;
const _fr: AssertCovered<Uncovered<FacadeRules, NonNullable<NonNullable<ShellInput['facade']>['rules']>>> = true;
const _fd: AssertCovered<Uncovered<FacadeDecor, NonNullable<NonNullable<ShellInput['facade']>['decor']>>> = true;
/** Gruppen-Schalter kommen gesammelt über `off`; Schild-/Schornstein-Tags hängen am Katalog, nicht am Nutzer. */
type ExteriorInternal = ExteriorGroup | 'signRoomTypes' | 'chimneyTags';
const _e: AssertCovered<Uncovered<ExteriorStyle, ExteriorInput, ExteriorInternal>> = true;
/** `allowed` ist nur Eingabe (Preset einzeln anpassen); die Domäne speichert die fertige Liste. */
const _b: AssertCovered<Uncovered<BlockRules, BlockRulesInput>> = true;
void [_w, _r, _d, _f, _fr, _fd, _e, _b];

/** zod-Ausgabe → Domänen-Typ unter `exactOptionalPropertyTypes`: Schlüssel mit `undefined` entfernen (rekursiv). */
export function defined<T>(v: object): T {
  const strip = (x: unknown): unknown => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).map(([k, y]) => [k, strip(y)]))
    : x);
  return strip(v) as T;
}

/**
 * Außen-Deko: `enabled: false` → keine; sonst Vorgabe (Bautyp) mit den Angaben überschrieben. `off` ersetzt die
 * abgeschalteten Gruppen der Vorgabe nicht, sondern ergänzt sie.
 */
export function exteriorStyle(input: ExteriorInput | undefined, base: ExteriorStyle | undefined): ExteriorStyle | undefined {
  if (input === undefined) return base;
  if (input.enabled === false) return undefined;
  const { enabled: _, off, ...rest } = input;
  return { ...(base ?? {}), ...defined<ExteriorStyle>(rest), ...Object.fromEntries((off ?? []).map((g) => [g, false])) };
}

/**
 * feat/theme-moods: Stimmungsvektor (`@mcda/core` `MoodVector`) – Schalter und Werte in einem. Ist das Feld gesetzt
 * (auch `{}`), gilt die Stimmung des Themes, achsenweise überschrieben; fehlt es, bleibt alles wie bisher.
 */
const MoodValue = z.number().min(-1).max(1);
export const moodSchema = z
  .object({
    wear: MoodValue.optional().describe('Verwitterung: -1 = ordentlich (gepflegt, kaum Moos und Risse), 0 = neutral, 1 = verwittert (Moos, Risse, entrindetes Holz, vergraute Farben); Zwischenwerte erlaubt'),
    richness: MoodValue.optional().describe('Ausstattung: -1 = karg (wenig Deko, schlichte Varianten), 0 = neutral, 1 = üppig (mehr Deko und Außen-Deko, volle Varianten); Zwischenwerte erlaubt'),
    formality: MoodValue.optional().describe('Wirkung: -1 = gemütlich (Sitzgruppen, cozy/cottage-Möbel), 0 = neutral, 1 = repräsentativ (große Signatur, Blickachse, noble Möbel); Zwischenwerte erlaubt'),
    organic: MoodValue.optional().describe('Ordnung: -1 = symmetrisch (Reihen, Mittelachse, gespiegelte Paare), 0 = neutral, 1 = organisch (freier gestreut, gemischte Formen); Zwischenwerte erlaubt'),
  })
  .strict();
const _mood: AssertCovered<Uncovered<Required<MoodVector>, z.output<typeof moodSchema>>> = true;
void _mood;
/** Beschreibung des Stimmungs-Feldes (gleich in allen Operationen). */
// ---------------------------------------------------------------- W13-G Paletten-Überschreibungen

export const PALETTE_GROUP_IDS = enumOf<PaletteGroup>()(['wall', 'frame', 'roof', 'base', 'floor', 'accent', 'interior_wood']);

const FAMILY_ID = /^[a-z0-9_]+(:[a-z0-9_]+)?$/;

/** Familie einer Gruppe: Enum der handverlesenen Familien, Optionstext „id = deutscher Name“ (fragbar per Entscheidungsmodell). */
const groupFamily = (g: PaletteGroup) => {
  const fams = PALETTE_GROUP_DEFS[g].families as readonly [string, ...string[]];
  return z.enum(fams).optional()
    .describe(`${PALETTE_GROUP_LABELS[g]}: ${fams.map((f) => `${f} = ${paletteFamilyLabel(f)}`).join(', ')}; ohne Angabe wie im Theme`);
};

/**
 * Paletten-Überschreibungen vor dem Generieren (W13-G): Materialfamilie je Rollengruppe (flach, damit jede Gruppe eine
 * eigene Frage ist) und Familien-Tausch. Gleiche Prüfung wie die App (`paletteOverrideProblems`, Zielversion).
 */
export const paletteOverridesSchema = z
  .object({
    wall: groupFamily('wall'),
    frame: groupFamily('frame'),
    roof: groupFamily('roof'),
    base: groupFamily('base'),
    floor: groupFamily('floor'),
    accent: groupFamily('accent'),
    interior_wood: groupFamily('interior_wood'),
    swaps: z.array(z.object({
      from: z.string().regex(FAMILY_ID).describe('Familie, die das Theme benutzt (z. B. oak, stone_bricks, color:red)'),
      to: z.string().regex(FAMILY_ID).describe('Ersatz gleicher Art (Holz ↔ Holz, Stein ↔ Stein, Farbe ↔ Farbe), z. B. spruce'),
    }).strict()).max(8).optional()
      .describe('Familien-Tausch in allen übrigen Rollen (Verläufe und Mischungen bleiben), z. B. oak → spruce; ohne Angabe keiner'),
    colorHarmony: z.enum(['off', 'on']).optional()
      .describe('Farbharmonie (WS-Farbe): off = Farben des Themes, bitgleich (Standard); on = Helligkeitsabstände zwischen Sockel, Wand, Dach und Zierholz sichern, '
        + 'Sättigung zum Stil, Hauptfarbe etwa 80 %, Akzent etwa 20 %'),
    harmonyContrast: z.enum(HARMONY_CONTRASTS).optional()
      .describe('Stärke des Helligkeitsabstands bei colorHarmony on: soft = weich, normal = Standard, strong = kräftig'),
    harmonySaturation: z.enum(HARMONY_SATURATIONS).optional()
      .describe('Sättigung bei colorHarmony on: auto = nach Stil (realistisch gedämpft, Fantasy kräftig), muted = gedämpft, natural = natürlich, vivid = kräftig'),
  })
  .strict();
type PaletteOverridesInput = z.output<typeof paletteOverridesSchema>;
const _paletteGroups: AssertCovered<Uncovered<Required<NonNullable<PaletteOverrides['groups']>>, PaletteOverridesInput>> = true;
void _paletteGroups;

export const PALETTE_OVERRIDES_DESCRIPTION =
  'Blockpalette vor dem Generieren anpassen: Materialfamilie je Gruppe (Wand, Rahmen, Dach, Sockel, Boden, Akzent, Innenholz) '
  + 'Familien-Tausch und Farbharmonie (colorHarmony); siehe palette_suggest für gültige Familien, Farben und harmonische Vorschläge. Ohne Angabe Farben des Themes';

/** API-Eingabe → Domänen-Wert (Normalform; leer → `undefined`). */
export function paletteOverridesOf(i: PaletteOverridesInput | undefined): PaletteOverrides | undefined {
  if (i === undefined) return undefined;
  const { swaps, colorHarmony, harmonyContrast, harmonySaturation, ...groups } = i;
  const g: Partial<Record<PaletteGroup, string>> = {};
  for (const k of PALETTE_GROUP_IDS) if (groups[k] !== undefined) g[k] = groups[k];
  return normalizePaletteOverrides({
    groups: g,
    ...(swaps !== undefined ? { swaps } : {}),
    ...(colorHarmony === 'on' ? { colorHarmony } : {}),
    ...(harmonyContrast !== undefined ? { harmonyContrast } : {}),
    ...(harmonySaturation !== undefined ? { harmonySaturation } : {}),
  });
}

export const MOOD_DESCRIPTION =
  'Stimmung: Achsen −1 … +1, 0 = neutral; {} = Vorgabe des Themes. Wirkt nur auf weiche Größen '
  + '(Einrichtungs-Gewichte, Deko-Menge, Verwitterung), nie auf Erreichbarkeit, Licht oder Pflichtmöbel. Ohne Angabe wie bisher';
