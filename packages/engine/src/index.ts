/**
 * @mcda/engine – Engine-API (ADR 12): die Steuerschicht über dem Anwendungsdienst. Jede Nutzer-Fähigkeit ist eine
 * Operation mit zod-Eingabe; daraus entstehen JSON Schema, Tool-Definitionen für LLMs und die Validierung.
 * Rein und deterministisch (keine I/O); HTTP-Server und LLM-Adapter liegen unter `@mcda/engine/node`.
 */
export { createEngine, type Engine, type EngineOptions, type EngineRequest, type ExecuteResult, type ToolDefinition } from './engine.js';
export {
  OPERATION_ID, defineOperation, enumOf,
  type AssertCovered, type EngineContext, type Json, type Operation, type OperationId, type OperationResult, type Uncovered,
} from './operation.js';
export { OPERATIONS, PIPELINE_SURFACE, type Exposure } from './registry.js';
export { CATALOG_KINDS, CATALOG_KIND_IDS, CONTEXT_SOURCES, type CatalogEntry, type CatalogKind, type CatalogKindId } from './catalogs.js';
export { PROJECT_COMMANDS } from './aggregates/project.js';
export { SITE_COMMANDS } from './aggregates/site.js';
export { commandSchema, excluded, type CommandKeys, type CommandSpec, type CommandTable, type Excluded } from './commands.js';
export { UNKNOWN_PROJECT, memorySessions, type ProjectSession, type SessionStore } from './session.js';
export {
  PROJECT_CONFLICT, memoryProjectStore, persistentSessions, reviveSession, serializeSession,
  type PersistentSessionOptions, type ProjectStore, type StoredProject,
} from './store.js';
export { structuresSchema } from './structures.js';
export { DORMER_KINDS, EXTERIOR_GROUP_IDS, PORTAL_KINDS, ROOF_PITCHES, exteriorSchema, shellSchema } from './style.js';
export {
  DIRECTIONS, EXPORT_FORMATS, ROOF_STYLES, SETTING_KINDS, SITE_TEMPLATE_IDS, SIZE_CLASSES, STAIR_TURNS, STAIR_TYPES, VERSIONS, idsOf, vocabularyOf,
  type BuildingTypeLabel, type Label, type Vocabulary,
} from './vocabulary.js';
export { classifyLocal, normalize, type LocalIntent } from './intent/local.js';
export { ROOM_TYPE_INSTRUCTIONS, classifyRoomTypeLocal, roomTypeOptions, roomTypeTask, type RoomTypeGuess } from './intent/roomtype.js';
export { ROOMTYPE_CLASSIFY, roomTypeResult } from './operations/roomtype.js';
export { DESIGN_ITERATE, designIterateInput } from './operations/design.js';
export {
  DEFAULT_DESIGN_TIMEOUT_MS, DEFAULT_MAX_CALLS, DEFAULT_MAX_ROUNDS, designLoop, designResult, runDesign, runDesignLocal,
  type Ask, type DesignBudget, type DesignResult, type DesignRound, type Reply,
} from './design/loop.js';
export { localDesign, type DesignParts, type DesignPlan } from './design/plan.js';
export { partsStructures, realize, type Realized, type WorldSummary } from './design/realize.js';
export { requirementsOf, type Requirement } from './design/critic.js';
export {
  CRITIC_MODES, LEVERS, LEVER_TEXT, MAX_REROLLS, VALUE_RANK, applyLever, closeness, leversFor, measureOf, measuredRounds, planMeasure, qualityScore, violations,
  type Checkpoint, type CriticMode, type LeverId, type MeasurePlan, type MeasuredRound, type MeasuredValue, type Measurement, type QualitySnapshot,
} from './design/measuredCritic.js';
export { syntheticDataset, type DatasetRow } from './intent/dataset.js';
export {
  COMBINE_MODES, DEFAULT_COMBINE, DEFAULT_MIN_CONFIDENCE, MAX_CHOICES, MAX_RANGE, NOT_SPECIFIED, combineLocal, decideIntent, decisionPlan, optionText, typeThemeOverlaps,
  type CombineMode, type DecidedIntent, type DecisionAnswer, type DecisionPlan, type DecisionQuestion, type FieldPlan,
} from './intent/decisions.js';
export { APP_MODULES_WITHOUT_USECASES, APP_SURFACE, APP_UI_FOLDERS, type AppExposure } from './surface/app.js';
