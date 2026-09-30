/**
 * Register aller Operationen und Abdeckung des Anwendungsdienstes (ADR 12).
 *
 * `PIPELINE_SURFACE` klassifiziert JEDEN Laufzeit-Export von `@mcda/pipeline`: über eine Operation erreichbar,
 * bewusst intern oder geplant. `test/coverage.test.ts` vergleicht die Liste mit den echten Exporten – wer der
 * Pipeline eine neue Fähigkeit gibt, muss sie hier einordnen (und in aller Regel eine Operation dafür anlegen).
 */
import type { Operation, OperationId } from './operation.js';
import { buildingGenerate } from './operations/building.js';
import { catalogDescribe } from './operations/catalog.js';
import { catalogGet, catalogList } from './operations/catalogItems.js';
import { designIterate } from './operations/design.js';
import { buildGuideOp } from './operations/guide.js';
import { PROJECT_OPERATIONS } from './operations/project.js';
import { paletteSuggest } from './operations/palette.js';
import { buildingPropose } from './operations/propose.js';
import { roomsGenerate } from './operations/rooms.js';
import { roomtypeClassify } from './operations/roomtype.js';

export const OPERATIONS: readonly Operation[] = [catalogDescribe, catalogList, catalogGet, buildingGenerate, buildingPropose, paletteSuggest, roomsGenerate, roomtypeClassify, designIterate, ...PROJECT_OPERATIONS, buildGuideOp] as readonly Operation[];

export type Exposure =
  /** Über diese Operation erreichbar. */
  | { readonly op: OperationId }
  /** Baustein anderer Dienste oder Adapter-Sache – nie direkt für Nutzer. Begründung Pflicht. */
  | { readonly internal: string }
  /** Nutzer-Fähigkeit ohne Operation: Name der geplanten Operation und was fehlt. Offene Schuld, siehe HANDOFF §6. */
  | { readonly planned: OperationId; readonly why: string };

const via = (op: OperationId): Exposure => ({ op });
const internal = (why: string): Exposure => ({ internal: why });
const planned = (op: OperationId, why: string): Exposure => ({ planned: op, why });

export const PIPELINE_SURFACE: Readonly<Record<string, Exposure>> = {
  // Nutzer-Fähigkeiten
  projectFromBuildingType: via('building_generate'),
  generateBase: via('building_generate'),
  toExport: via('building_generate'),
  planBuildOptions: via('building_generate'),
  rerollBuildingType: via('building_generate'), // zustandslos: `rerollCount`
  generate: via('rooms_generate'),
  exteriorFor: via('building_generate'), // `exterior` in beiden Generier-Operationen
  shellWithTowers: via('project_structures'), // angedockte Türme
  applyBuildingType: via('project_command'), // Befehl applyBuildingType
  furnishRooms: via('project_furnish'),
  furnishRoomsDetailed: via('project_furnish'),
  // F „Bereich neu einrichten“ (WFC 3.2): Zone/Rechteck neu, Rest eingefroren – dieselbe Funktion wie der Editor
  refurnishBlock: via('project_refurnish_block'),
  planBlockRefurnish: via('project_refurnish_block'),
  roomZones: via('project_refurnish_block'), // Zonen stehen im Ergebnis (zones)
  silhouetteMetrics: internal('Reine Messfunktion (Silhouetten-Interesse) für Bericht und Vergleichsskripte; ändert nichts am Bau'),
  ringAround: internal('Teilschritt von refurnishBlock (Überlappungsrand)'),
  BLOCK_MARGIN: via('project_refurnish_block'),
  BLOCK_ATTEMPTS: via('project_refurnish_block'),
  completeBase: internal('Beispiel-Fixture für Tests und `npm run sample`'),
  homesteadBase: internal('Beispiel-Fixture für Tests und `npm run sample`'),
  sampleHouse: internal('Beispiel-Fixture für Tests und `npm run sample`'),
  twoStoryHouse: internal('Beispiel-Fixture für Tests und `npm run sample`'),
  // Bausteine der Kette (werden von generate/generateBase aufgerufen)
  buildWorld: internal('Teilschritt von generate'),
  generateWith: internal('Teilschritt von generate'),
  shellFor: internal('Teilschritt von generate'),
  furnishingGeometry: internal('Teilschritt von generate'),
  styleChainOf: internal('Teilschritt von generate'),
  lightRooms: internal('Licht-Pass, Teilschritt von generate'),
  // feat/int-decor: Innen-Deko-Pass – Projektfeld `interiorDecor` (Befehl setInteriorDecor, building_generate/rooms_generate `interiorDecor`)
  decorRooms: via('project_generate'), // Teilschritt von generate (nach der Einrichtung, vor dem Licht)
  decorBudget: internal('Regel hinter decorRooms (Höchstzahl je Raum)'),
  DECOR_RECIPES: internal('Konstante: Deko-Rezepte je Raumtyp'),
  circulation: via('building_generate'), // Erschließungsbericht, kompakt als `circulation` in allen Generier-Ergebnissen
  entryAuditOf: internal('Teilschritt von circulation (Eingangs-/Windfang-Bericht, steht in dessen Ergebnis)'),
  decorFor: internal('Teilschritt von shellFor: mischt Theme-Vorgabe (timberDecor) mit shell.facade.decor'),
  facadeForTheme: internal('Teilschritt von shellFor: Feldbreite des Fassadenrasters aus dem Theme (facade.bay), sofern rules.grid ohne bay'),
  materializeWorld: internal('Teilschritt von generate'),
  placedFor: internal('Teilschritt von generate'),
  // Farbwelt (Q4): Theme des Projekts mit gewählter Palette; dieselbe Auflösung in allen Generier-Operationen
  themeFor: via('project_generate'), // `paletteId` des Projekts; auch building_generate/applyBuildingType
  // feat/theme-moods: Stimmung – Projektfeld `mood` (Befehl setMood, building_generate/rooms_generate `mood`)
  moodOf: via('project_furnish'), // wirksame Stimmung (Theme-Vorgabe + Nutzer); auch generate/generateBase
  moodOption: via('project_furnish'),
  effectiveMood: internal('Regel hinter moodOf (App und Engine gleich)'),
  moodExteriorDensity: internal('Teilschritt von exteriorFor (Achse richness → Außen-Deko-Dichte)'),
  moodStory: internal('Teilschritt von materializeWorld (Achse wear → Story-Profil)'),
  applyNewProjectMood: via('project_create'), // B4: neue Projekte mit Theme-Stimmung; auch building_generate/rooms_generate
  NEW_PROJECT_MOOD: internal('Konstante: Stimmung neuer Projekte ({} = Theme-Vorgabe)'),
  MOODS_DEFAULT_ON: internal('Konstante: Standard ohne Projektfeld (aus = bitgleich)'),
  themeWith: internal('Farbwelt-Auflösung für Vorschau und Plan-Nutzung (projectFromBuildingType, building_propose)'),
  surroundings: internal('Teilschritt von generateBase'),
  siteHeightField: internal('Teilschritt von generateBase'),
  structureKeepOut: internal('Teilschritt von generateBase'),
  buildingOf: internal('Teilschritt von generateBase und rooms_generate (Gelände-Grundstück)'),
  attachedTowerSpecs: internal('Teilschritt von generateBase'),
  towerAnnexes: internal('Teilschritt von generateBase'),
  // F-Ensemble (Feature-Branch): Verbindungsgraph über den Schalter `ensemble` von building_generate/rooms_generate
  planEnsemble: via('building_generate'), // `ensemble: true`; auch rooms_generate, project_style
  resolveEnsemble: internal('Teilschritt von generateBase (Schalter ensemble): Hülle mit Brückentüren und Umgebung; die App nutzt ihn in shellOf/baseWorldOf'),
  bridgeAnnexes: internal('Teilschritt von generateBase (Schalter ensemble): Brückentüren als Anbau der Hülle'),
  bridgeSpecs: internal('Teilschritt von generateBase (Schalter ensemble): Brücken als Bauwerk'),
  BRIDGE_MAX_RISE: internal('Regel des Verbindungsgraphen (größter Höhenwechsel einer Brücke), wirkt in generateBase'),
  ENSEMBLE_DEFAULT: internal('Standard des Schalters ensemble in generateBase (derzeit aus)'),
  // feat/site-decor: Grundstücks-Deko über den Schalter `siteDecor` (building_generate, rooms_generate, project_style)
  siteDecorContext: internal('Regel von App und Engine (Theme und Raumhinweise der Grundstücks-Deko), wirkt in generateBase bei siteDecor; die App nutzt sie in baseWorldOf'),
  exteriorBuilding: internal('Teilschritt von exteriorFor'),
  exteriorMaterializePlacements: internal('Teilschritt von exteriorFor'),
  fitExterior: internal('Teilschritt von exteriorFor'),
  catalogMinArea: internal('Hilfsfunktion des Bautyp-Dienstes (auch in building_propose)'),
  archetypeContext: via('building_propose'), // W6: Katalog-Sicht des Planers (Feldbreite je Theme); auch building_generate, project_create, App-Assistent
  // Gemeinsame Regeln von App und Engine (C2): in allen Bautyp- bzw. Generier-Operationen angewandt
  withoutPilastersForTheme: via('building_generate'), // auch project_create, applyBuildingType, rerollBuildingType
  withFacadeRhythm: via('building_generate'), // WS-Fassade: auch rooms_generate, project_style { facadeRhythm }
  parapetSpecsFor: via('project_structures'), // Wehrplatten: Spalten/Höhe aus dem Baukörper (BT01), App und Engine gleich
  roomVolumeOf: via('project_structures'), // Raum → Baukörper (BT01): die Hülle kennt keine Baukörper
  roomCellsOf: via('project_structures'), // Raum → Raumzellen (BT01): Wehrplatte bündig auf der Außenkante der Dachplatte
  volumeTooLarge: via('building_generate'), // Export-Obergrenze in allen Generier-Operationen
  fixedFurnitureInStairs: via('project_command'), // Befehl placeStairs lehnt Treppen durch gesperrte/eigene Möbel ab
  // W1-G: ehrliche Übersetzung einer Beschreibung und Vorschläge ohne Doppel (App-Assistent; Engine siehe W1G_treue.md)
  BUILDABLE_SETTINGS: internal('Konstante der Regel settingBuildable (baubare Lagen ground/buried)'),
  settingBuildable: via('building_generate'), // W7-E: nicht baubare Lage → Hinweis in notes (settingNote), auch project_create
  settingNote: via('building_generate'), // W7-E: Hinweistext „Lage … noch nicht baubar – ebenerdig gebaut“ (notes), auch project_create
  FALLBACK_THEME_ID: via('building_generate'), // W7-E: Theme ohne Angabe bei Bautypen ohne eigenes Theme, auch project_create
  planLayoutKey: via('building_propose'), // W7-E: Vorschläge ohne Doppel (wie der App-Assistent, W1-G M2)
  distinctPicks: via('building_propose'),
  distinctCount: internal('Zahl verschiedener Grundrisse (W1-G, M2); Baustein von distinctPicks'),
  // W8-E: spielbare Vorschläge (App-Assistent und building_propose gleich; Pareto-Zweig nutzt playabilityOf)
  playabilityIssues: via('building_propose'),
  playablePicks: via('building_propose'),
  playabilityText: via('building_propose'), // Hinweis „Pflichtobjekt fehlt: …“ (notice/warnings)
  playableDistinct: internal('Abbruchbedingung der Kandidatenschleife (W8-E); Baustein von playablePicks'),
  playabilityOf: internal('Kern von playabilityIssues auf fertigem Projekt/Hülle/Bericht (auch für die Pareto-Wahl)'),
  playabilityKinds: internal('Arten der Befunde ohne Ort (Pareto-Zweig: ProposalCandidate.issues)'),
  PLAYABILITY_ISSUES: internal('Konstante der Befund-Arten (W8-E)'),
  // W11-A: Treppen automatisch aus den Räumen (Editor und API gleich)
  planAutoStairs: via('project_auto_stairs'),
  applyAutoStairs: via('project_auto_stairs'),
  autoStairsText: via('project_auto_stairs'), // Ergebnis `message`
  disconnectedFloors: via('project_auto_stairs'), // Lücken = was die Operation schließt
  storyLabel: internal('Etagenname (EG, 1. OG, 1. UG) für die Meldung von autoStairsText'),
  STAIR_CIRCULATION: internal('Raum-Rang der automatischen Treppe: Erschließung (W11-A)'),
  STAIR_COMMON: internal('Raum-Rang der automatischen Treppe: Gemeinschaftsräume (W11-A)'),
  STAIR_PRIVATE: internal('Raum-Rang der automatischen Treppe: private Räume nur ohne Alternative (W11-A)'),
  // Kennzahlen der Fassade (Q2, research/58 §4): Messwerkzeug für Tests und Berichte, keine Nutzer-Fähigkeit
  facadeQuality: internal('Kennzahl-Messwerkzeug F1–F4 (research/58 §4); nur Test/Bericht, keine Operation'),
  facadeTargetMisses: internal('Zielband-Prüfung der Kennzahlen F1–F4; nur Test/Bericht'),
  isFullBlock: internal('Baustein der Kennzahl F2 (Nicht-Vollblock-Anteil)'),
  windowRhythm: internal('Kennzahl F4 allein aus der Hülle; Baustein der Mehrziel-Vorschläge (paretoProposals)'),
  // MX-Q: Fassadenmaße, Detail-Obergrenze, Bodenverbindung/Auflager – `building_generate` mit `measure: true`
  qualityMeasures: via('building_generate'),
  detailDensity: via('building_generate'),
  supportReport: via('building_generate'),
  DETAIL_FREE_MIN: via('building_generate'),
  DETAIL_FRAME_DELTA: internal('Konstante des Farb-Lints (OKLab-Abstand), Teil von detailDensity'),
  DETAIL_FRAME_SHARE_MAX: internal('Konstante des Farb-Lints, Teil von detailDensity'),
  DETAIL_FRAME_MIN_BLOCKS: internal('Konstante des Farb-Lints, Teil von detailDensity'),
  MAX_CANTILEVER: via('building_generate'),
  // Stil-Kennzahlen LV/KM (plan/spikes/LV_baseline.md): Messwerkzeug für Tests, Berichte und das Skript spikes/stilmetrik
  measureStyle: internal('Stil-Kennzahlen LV-1…LV-23/KM1…KM9 an einer Generator-Ausgabe; Messwerkzeug, keine Operation'),
  measureEnsemble: internal('Silhouetten-Kennzahlen LV-13b/c über mehrere einzeln erzeugte Bauten (Dorf-Ersatz)'),
  reportOf: internal('Bericht aus Stil-Messungen (gewichtetes Mittel, Ampel); Baustein von measureStyle'),
  reportToJson: internal('JSON-Ausgabe des Stil-Kennzahlen-Berichts'),
  reportToMarkdown: internal('Markdown-Tabelle des Stil-Kennzahlen-Berichts'),
  formatNumber: internal('Zahlenformat (deutsch) des Stil-Kennzahlen-Berichts'),
  STYLE_METRIC_DEFS: internal('Definitionen und Zielwerte der Stil-Kennzahlen'),
  STYLE_UNMEASURABLE: internal('Liste der nicht messbaren Regeln KM2/KM7/KM8/KM9 mit Begründung'),
  judgeMetric: internal('Ampel-Regel der Stil-Kennzahlen (innerhalb/Toleranz/außerhalb)'),
  // feat/pareto-proposals: Mehrziel-Vorschläge hinter `building_propose` mit `pareto: true` (Standard aus)
  paretoProposals: via('building_propose'),
  PARETO_POOL: via('building_propose'),
  PARETO_RESERVE: via('building_propose'),
  needsReserve: internal('Baustein von paretoProposals und des App-Assistenten (Reserve nur bei einigen, aber zu wenigen spielbaren)'),
  noPlayableNotice: via('building_propose'), // Warnung ohne spielbaren Kandidaten (Review A3), gleicher Text in der App
  enoughPlayable: internal('Baustein von paretoProposals und des App-Assistenten (Reserve nur bei zu wenig spielbaren)'),
  PROPOSAL_LABEL_TEXT: via('building_propose'),
  evaluateCandidate: internal('Baustein von paretoProposals (ein Kandidat → Zielvektor, Spielbarkeit)'),
  pickProposals: internal('Baustein von paretoProposals (Front → drei beschriftete Vorschläge)'),
  paretoFront: internal('Baustein von pickProposals (nicht dominierte Vektoren)'),
  dominates: internal('Baustein von paretoFront'),
  vectorOf: internal('Zielvektor als Zahlenreihe (Spalten = PROPOSAL_OBJECTIVES); für Tests und späteres Lernen der Gewichte'),
  PROPOSAL_OBJECTIVES: internal('Spalten des Zielvektors (stabil; gelernte Gewichte hängen daran)'),
  OBJECTIVE_GROUP: internal('Gruppe je Ziel (schön/praktisch) für die Wahl'),
  OBJECTIVE_LABEL: internal('Deutsche Namen der Ziele (App-Karte, Begründung)'),
  PROPOSAL_LABELS: internal('Reihenfolge der Beschriftungen (App-Karte)'),
  FACADE_TARGETS: internal('Konstante der Zielbänder F1–F4 (research/58 §4)'),
  // Kennzahl P1 und Farbquelle der Block-Vorschau (Q4, research/58 §4): Messwerkzeug, keine Nutzer-Fähigkeit
  P1: internal('Kennzahl Wertkontrast Wand ↔ Dach (Qualitaetsoffensive, Bericht und Tests)'),
  P1Percent: internal('Kennzahl P1 als Prozent des Mindestabstands (Bericht)'),
  P1Text: internal('Kurztext der Kennzahl P1 (Bericht)'),
  P1_MIN_DISTANCE: internal('Mindestabstand der Kennzahl P1 (Konstante)'),
  P1_ROLES: internal('Messrollen der Kennzahl P1 (Konstante)'),
  oklabL: internal('OKLab-Helligkeit einer Farbe (Baustein der Kennzahl P1)'),
  blockLightness: internal('Helligkeit eines Blocks (Baustein der Kennzahl P1)'),
  mixLightness: internal('Helligkeit einer gewichteten Blockliste (Baustein der Kennzahl P1)'),
  paletteRoleLightness: internal('Helligkeit einer Paletten-Rolle (Baustein der Kennzahl P1)'),
  blockLook: internal('Flaechenfarbe eines Blocknamens (Vorschau der App und Farbquelle von P1)'),
  // WS-Farbe (Schritt 3 „Farben“): Farbharmonie `paletteOverrides.colorHarmony` (building_generate, project_style) und Farbkennzahlen
  harmonizeTheme: internal('Farbharmonie eines Themes (Helligkeitsabstände, Sättigung, Hauptfarbe/Akzent); Baustein von harmonyOf'),
  harmonyOf: via('building_generate'),
  harmonyReport: internal('Messbericht der Farbharmonie eines Themes (Tests, Bericht, Skripte)'),
  partLightness: internal('Helligkeit eines Bauteils im Theme (Baustein der Farbharmonie)'),
  HARMONY_GAPS: internal('Soll-Helligkeitsabstände der Farbharmonie (Konstante)'),
  HARMONY_PARTS: internal('Rollen je Bauteil der Farbharmonie (Konstante)'),
  FANTASY_THEMES: internal('Themes mit kräftiger Fantasy-Sättigung (Konstante der Farbharmonie)'),
  colorMetrics: internal('Farbkennzahlen eines fertigen Baus (Kontrast, Hauptfarbe/Akzent, Sättigung, Töne); Messwerkzeug, keine Operation'),
  colorClassOf: internal('Farbklasse eines Blocks (Baustein von colorMetrics)'),
  blockChroma: internal('Buntheit und Farbwinkel eines Blocks (Baustein von colorMetrics)'),
  COLOR_PARTS: internal('Rollen je Bauteil der Farbkennzahlen (Konstante)'),
  COLOR_PART_IDS: internal('Bauteil-Gruppen der Farbkennzahlen (Konstante)'),
  DYE_COLORS: internal('Farbstoffe der Block-Vorschau (Konstante)'),
  mix: internal('Farbmischung der Block-Vorschau (Baustein)'),
  // W3-BL: Blöcke sperren und ersetzen – Projekt-Einstellung `blockRules` (project_style, building_generate, rooms_generate)
  blockRulesContext: via('project_generate'), // generateBase/generateWith bauen damit; auch building_generate/rooms_generate
  blockRulesCatalog: via('project_furnish'), // Auswahl-Sicht ohne gesperrte Varianten; auch in generateBase
  normalizeBlockRules: via('project_style'), // Normalform der Regeln (blockRulesOf)
  withBlockPreset: via('project_style'), // preset easy_farm
  withBlockBanned: via('project_style'), // banned/allowed
  withBlockReplacement: via('project_style'), // replace
  blockRulesKey: internal('Vergleichsschlüssel der Block-Regeln (Caches)'),
  hiddenVariants: internal('Anzeige der App (Tab „Material“): welche Möbel-Varianten die Sperren ausblenden'),
  easyFarmReason: internal('Anzeige: Begründung eines Preset-Blocks (catalog_describe blockPresets trägt sie je Gruppe)'),
  EASY_FARM_BLOCKS: via('catalog_describe'), // blockPresets.easy_farm
  EASY_FARM_GROUPS: via('catalog_describe'), // blockPresets.easy_farm
  BLOCK_RULE_PRESETS: via('catalog_describe'), // Werte von blockRules.preset
  // W13-G: Paletten-Editor – Blockpalette vor dem Generieren (palette_suggest; setzen über building_generate.paletteOverrides
  // bzw. den Befehl setPaletteOverrides)
  paletteEditorView: via('palette_suggest'),
  rollPaletteOverrides: via('palette_suggest'), // roll + lock + seed
  swapTargets: via('palette_suggest'), // swapFrom
  paletteOverrideProblems: via('palette_suggest'), // problems; dieselbe Prüfung in building_generate und setPaletteOverrides
  familySwatch: internal('Vorschau-Block und -Farbe einer Familie (Baustein von palette_suggest)'),
  harmonyScore: internal('Harmonie einer Farbe gegen die anderen Gruppen (Baustein von palette_suggest: fits)'),
  luminance: internal('Helligkeit einer Vorschaufarbe (Baustein der Harmonie)'),
  PALETTE_HARMONY: internal('Harmonie-Regeln je Gruppe (Konstante, beschrieben in palette_suggest)'),
  // W3-BL: Möbel bearbeiten – dieselbe Passt-Prüfung und „Aufliegendes folgt“ wie die App (placementEdit)
  placementProblem: via('project_command'), // Befehle movePlacement/swapPlacement lehnen ungültige Lagen mit Grund ab
  placementGroup: via('project_command'), // movePlacement bewegt aufgesetzte Teile mit
  movePoses: via('project_command'), // movePlacement: neue Lage des Möbels, Kinder folgen
  nudgePoses: internal('Pfeiltasten der App (1 Feld); die API nimmt die neue Lage direkt (movePlacement)'),
  rotatePoses: internal('Taste Q der App (Drehen um die Mitte); die API nimmt die neue Lage direkt (movePlacement mit rot)'),
  // W7-G (U7): Nachbarn behalten Möbel – `project_furnish` mit `keep: true` nimmt dieselben Vorgaben wie die App
  keepHintsOf: via('project_furnish'),
  keepOptionsOf: via('project_furnish'),
  materialList: via('project_generate'), // `materials` in allen Generier-Antworten (Haus und Umgebung getrennt)
  stacksText: internal('Anzeige der App: Menge in Stapeln'),
  // Konstanten
  DEFAULT_LIGHT_PREFERENCE: internal('Konstante des Licht-Passes'),
  EXPORT_LIMITS: internal('Konstante der Export-Obergrenze (volumeTooLarge)'),
  // DR5 K2/K10: Bauplan-Ausgabe (Ebenen, Palette, Materialliste mit Stapeln/Shulker-Kisten) und Nutzungshinweis (Entwurf)
  buildGuide: via('build_guide'), buildGuideMarkdown: via('build_guide'), buildGuideCsv: via('build_guide'),
  stacksOf: internal('Rechenregel hinter buildGuide (Stapel, Plätze, Shulker-Kisten)'),
  SHULKER_SLOTS: internal('Konstante: Plätze einer Shulker-Kiste (buildGuide)'),
  GUIDE_GRID_MAX: internal('Konstante: größte Grundfläche mit Raster je Ebene (build_guide grids)'),
  OUTPUT_LICENSE_DRAFT: via('build_guide'), // steht als `license` in jeder build_guide-Antwort und im Markdown
  EXPORT_DISCLAIMER: internal('Konstante des Pflicht-Hinweises (HANDOFF §1); toExport setzt ihn in jedes Export-Volumen aller Generier-Operationen'),
  SPEED: internal('Konstante des Erschließungsberichts (Laufgeschwindigkeiten)'),
  EXTERIOR_GROUPS: internal('Konstante; geht mit building_style ins Vokabular'),
  EXTERIOR_GROUP_LABELS: internal('Anzeige-Texte der App'),
};
