/**
 * @mcda/pipeline – Anwendungsdienst (plan/03 §4.2): orchestriert die Domänenkontexte zur Kette
 * Projekt → Hülle → Einrichtung → Materialisierung (+ Licht-Pass) → Export-Volumen, dazu Gelände (@mcda/terrain)
 * und Bauwerke (@mcda/structures) als Zusatz-Zellen (`generateBase`). Keine I/O; Plattform-Daten, Kataloge und
 * Geländestile kommen über den Kontext herein (Node-Adapter im Skript, Browser-Adapter in der App).
 */
export { materializeWorld, moodOf, moodOption, placedFor, themeFor, themeWith, type PipelineContext, type World } from './world.js';
// feat/theme-moods: Stimmung – eine Regel für App und Engine (Schalter, Theme-Vorgabe, Außen-Dichte, Story-Profil)
export { MOODS_DEFAULT_ON, NEW_PROJECT_MOOD, applyNewProjectMood, effectiveMood, moodExteriorDensity, moodStory } from './mood.js';
export {
  DEFAULT_LIGHT_PREFERENCE, lightRooms, type LightTraceEvent, type LightingOptions, type LightingResult, type RoomLightReport,
} from './lighting.js';
// feat/int-decor: Innen-Deko-Pass (Stufe `interiorDecor` des Projekts) – App und Engine gleich
export { DECOR_RECIPES, decorBudget, decorRooms, type DecorOptions, type DecorRecipe, type DecorResult, type DecorStep, type RoomDecorReport } from './decor.js';
export { furnishingGeometry } from './geometry.js';
// W8-E: Spielbarkeit eines Bautyp-Kandidaten und spielbare Vorschläge – App-Assistent und building_propose gleich
export {
  PLAYABILITY_ISSUES, playabilityIssues, playabilityKinds, playabilityOf, playabilityText, playableDistinct, playablePicks, type PlayabilityFinding,
  type PlayabilityIssue,
} from './playability.js';
// W11-A: Treppen automatisch aus den Räumen (App und Engine)
export {
  STAIR_CIRCULATION, STAIR_COMMON, STAIR_PRIVATE, applyAutoStairs, autoStairsText, disconnectedFloors, planAutoStairs, storyLabel,
  type AutoStair, type AutoStairGap, type AutoStairsOptions, type AutoStairsPlan,
} from './autoStairs.js';
// F „Bereich neu einrichten“ (WFC 3.2, Modifying in Blocks): Zone/Rechteck neu, Rest eingefroren, Überlappungsrand
export {
  BLOCK_ATTEMPTS, BLOCK_MARGIN, planBlockRefurnish, refurnishBlock, ringAround, roomZones,
  type BlockRefurnishOptions, type BlockRefurnishPlan, type BlockRefurnishReport, type BlockRefurnishRequest,
} from './refurnish.js';
// Erschließung/Laufwege (research/22, research/23; Synthese 25 Regeln 3/4/7)
export { circulation, entryAuditOf, SPEED, type CirculationOptions, type CirculationReport, type EntryAudit, type RoomTravel } from './circulation.js';
export { completeBase, homesteadBase, sampleHouse, twoStoryHouse, type BaseSample, type SampleVersion } from './samples.js';
export {
  buildWorld, decorFor, furnishRooms, furnishRoomsDetailed, generate, styleChainOf, generateWith, shellFor, toExport, type BuildOptions, type FurnishOptions, type FurnishReport,
  type GeneratedWorld,
} from './house.js';
// Pflicht-Hinweis im Export (HANDOFF §1): `toExport` setzt ihn in jedes Export-Volumen, App und Engine gleich
export { EXPORT_DISCLAIMER, OUTPUT_LICENSE_DRAFT } from './disclaimer.js';
// Bauplan-Ausgabe (DR5 K2): Ebenen, Palette, Materialliste mit Stapeln/Shulker-Kisten als Markdown und CSV
export {
  GUIDE_GRID_MAX, SHULKER_SLOTS, buildGuide, buildGuideCsv, buildGuideMarkdown, stacksOf,
  type BuildGuide, type BuildGuideOptions, type GuideLayer, type GuideMaterial,
} from './buildGuide.js';
export {
  attachedTowerSpecs, buildingOf, generateBase, resolveEnsemble, shellWithTowers, siteHeightField, structureKeepOut, surroundings, towerAnnexes,
  type AttachedTower, type BaseOptions, type BaseWorld, type EnsembleReport, type EnsembleResolution, type Surroundings, type SurroundingsInput,
} from './base.js';
// F-Ensemble (Feature-Branch): Verbindungsgraph der Base – Spannbaum + Rundwege, Brücken zum Wehrgang/Nachbarhaus
export {
  BRIDGE_MAX_RISE, ENSEMBLE_DEFAULT, bridgeAnnexes, bridgeSpecs, planEnsemble, type EnsembleEdge, type EnsembleEdgeKind, type EnsembleInput, type EnsembleOptions,
  type EnsemblePlace, type EnsemblePlaceKind, type EnsemblePlan, type PlannedBridge,
} from './ensemble.js';
// Außengestaltung (X1): Plan für eine Hülle, Materialisierungs-Eingang, Gelände-Kopplung
export { exteriorBuilding, exteriorFor, exteriorMaterializePlacements, fitExterior } from './exterior.js';
export {
  EXTERIOR_GROUPS, EXTERIOR_GROUP_LABELS, type ExteriorGroup, type ExteriorPlacement, type ExteriorPlan, type ExteriorStyle,
} from '@mcda/exterior';
// Bautypen (research/19 §7): Bautyp + Parameter + Seed → Projekt (ein Schritt), Stil und Umgebung
export {
  FALLBACK_THEME_ID, applyBuildingType, catalogMinArea, parapetSpecsFor, planBuildOptions, projectFromBuildingType, rerollBuildingType, roomCellsOf,
  roomVolumeOf, settingNote, type BuildingTypeParams, type BuildingTypeResult,
} from './buildingType.js';
// Gemeinsame Generier-Regeln von App und Engine-API (Fachwerk ohne Wandvorlagen, Export-Obergrenze)
export {
  BUILDABLE_SETTINGS, EXPORT_LIMITS, archetypeContext, distinctCount, distinctPicks, facadeForTheme, fixedFurnitureInStairs, planLayoutKey, settingBuildable, volumeTooLarge,
  siteDecorContext, withFacadeRhythm, withoutPilastersForTheme,
} from './rules.js';
// Farb-Grundlagen der Block-Vorschau (auch Quelle der Kennzahl P1); die App re-exportiert sie unverändert
export { DYE_COLORS, blockLook, mix, type BlockLook, type BlockRule } from './blockColors.js';
// Kennzahl P1 (Qualitätsoffensive, research/58 §4): Wertkontrast Wand ↔ Dach ↔ Kante in OKLab-L
export {
  P1, P1_MIN_DISTANCE, P1Percent, P1Text, P1_ROLES, blockLightness, mixLightness, oklabL, paletteRoleLightness,
  type P1Result, type P1Surface,
} from './quality-p1.js';
// WS-Farbe (Schritt 3 „Farben“): Farbkennzahlen eines fertigen Baus (Kontrast, Hauptfarbe/Akzent, Sättigung, Töne)
export {
  COLOR_PARTS, COLOR_PART_IDS, blockChroma, colorClassOf, colorMetrics,
  type ColorClass, type ColorEntry, type ColorMetrics, type ColorPart, type PartMetric,
} from './colorMetrics.js';
export {
  FANTASY_THEMES, HARMONY_GAPS, HARMONY_PARTS, harmonizeTheme, harmonyOf, harmonyReport, partLightness,
  type HarmonyContrast, type HarmonyPart, type HarmonyReport, type HarmonySaturation, type HarmonyTuning,
} from './colorHarmony.js';
// Bauwerke (BT01): an einen Baukörper gebundene Wehrplatten – App und Engine leiten sie gleich ab
export type { ParapetBinding, ParapetSpec, StructuresInput } from '@mcda/structures';
// WS-Verwitterung: Werte des Schalters `weathering` (off | some | rich) für Engine, Projektdatei und App
export type { WeatheringSwitch } from '@mcda/materialize';
// TX-B: Werte des Schalters `surfaceTexture` (off | subtle | rich)
export type { SurfaceTextureSwitch } from '@mcda/materialize';
// Kennzahlen der Fassade (research/58 §4, Q2): F1–F4 als reine Funktionen für Tests und Berichte
// (eigene Datei `quality-f.ts`, damit das geplante Mess-Werkzeug `quality.ts` des Planers kollisionsfrei bleibt)
export { FACADE_TARGETS, facadeQuality, facadeTargetMisses, isFullBlock, windowRhythm, type FacadeQuality } from './quality-f.js';
// MX-Q (DR0 Nr. 9–11): Fassadenmaße, Detail-Obergrenze, Bodenverbindung/Auflager – weiche Messwerte und Lints
export {
  DETAIL_FRAME_DELTA, DETAIL_FRAME_MIN_BLOCKS, DETAIL_FRAME_SHARE_MAX, DETAIL_FREE_MIN, MAX_CANTILEVER, detailDensity, qualityMeasures, supportReport,
  type DetailDensity, type MeasuredWorld, type QualityMeasures, type SupportOverhang, type SupportPart, type SupportReport,
} from './quality-mx.js';
// Stil-Kennzahlen LV-1…LV-23 und KM1…KM9 (plan/spikes/LV_baseline.md): Messwerkzeug für Tests und Berichte, ändert nichts
export {
  measureStyle, measureEnsemble, reportOf, reportToJson, reportToMarkdown, formatNumber, STYLE_METRIC_DEFS, STYLE_UNMEASURABLE, judgeMetric,
  type StyleInput, type StyleMeasurement, type StylePlacement, type StyleReport, type MetricDef, type MetricResult, type MetricLight,
} from './style-metrics/index.js';
// feat/pareto-proposals: Mehrziel-Vorschläge (Schalter, Standard aus; plan/spikes/F_pareto_proposals.md)
export {
  OBJECTIVE_GROUP, OBJECTIVE_LABEL, PARETO_POOL, PARETO_RESERVE, enoughPlayable, needsReserve, noPlayableNotice, PROPOSAL_LABELS, PROPOSAL_LABEL_TEXT, PROPOSAL_OBJECTIVES, dominates, evaluateCandidate, paretoFront,
  paretoProposals, pickProposals, vectorOf, type ParetoResult, type ProposalCandidate, type ProposalLabel, type ProposalObjective,
  type ProposalPick, type ProposalRaw, type ScoreVector,
} from './pareto.js';
// W3-BL: Blöcke sperren und ersetzen (Projekt-Einstellung, Preset „Nur leicht farmbar“) und Materialliste – App und Engine gleich
export {
  BLOCK_RULE_PRESETS, EASY_FARM_BLOCKS, EASY_FARM_GROUPS, blockRulesCatalog, easyFarmReason, blockRulesContext, blockRulesKey, hiddenVariants, normalizeBlockRules, withBlockBanned,
  withBlockPreset, withBlockReplacement, type BlockRulePreset, type BlockRules,
} from './blockRules.js';
// W13-G: Paletten-Editor (Familie je Rollengruppe, Tausch, Harmonie, neu würfeln) – App und Engine gleich
export {
  PALETTE_HARMONY, familySwatch, harmonyScore, luminance, paletteEditorView, paletteOverrideProblems, rollPaletteOverrides, swapTargets,
  type PaletteEditorContext, type PaletteEditorView, type PaletteGroupView, type PaletteOptionView, type PaletteSwapView, type PaletteSwatch,
} from './paletteEditor.js';
export { materialList, stacksText, type MaterialList, type MaterialRow, type MaterialSurroundings } from './materials.js';
// W3-BL: Passt-Prüfung beim Verschieben/Drehen/Tauschen von Möbeln samt „Aufliegendes folgt“ – App und Engine gleich
export {
  movePoses, nudgePoses, placementGroup, placementProblem, rotatePoses, type PlacementChange, type PlacementRooms,
} from './placementRules.js';
// W7-G (U7): Nachbarn behalten Möbel – Vorgaben fürs Neu-Einrichten nach einer Geometrie-Änderung, App und Engine gleich
export { keepHintsOf, keepOptionsOf } from './keep.js';
// WS 7 Schritte, Schritt 2: Silhouetten-Kennwert (Schalter `silhouette` in `BuildingTypeParams`, Regel im Planer)
export { silhouetteMetrics, type SilhouetteCell, type SilhouetteMetrics } from './silhouette.js';
