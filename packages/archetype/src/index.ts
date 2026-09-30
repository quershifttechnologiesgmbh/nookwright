/**
 * Kontext Bautyp (research/19 §7.3): Grundriss-Generator vom Massing zu gemalten Räumen.
 * Eingang: `BuildingTypeDef` (Katalog) + Parameter + Seed; Ausgang: `BuildingPlan` (reine Daten). Übernommen wird der
 * Plan über `Project.applyBuildingType(planDraft(plan, origin))` – ein Undo-Schritt, danach ein normales Projekt.
 */
export const ARCHETYPE_CONTEXT = 'archetype' as const;
export * from './plan.js';
export {
  MAX_ATTEMPTS, TYPE_SHELL, defaultSize, planBuilding, planFacadeBay, requiredMissing, resolveShell, type ArchetypeContext, type LayoutCostTerms, type LayoutTraceEvent,
} from './generate.js';
export { FUNCTION_BUDGET, DEFAULT_FUNCTION_SHARE, RICH_SHARE_FACTOR, supportsFunctions, withFunctions, type FunctionSelection } from './functions.js';
export { SILHOUETTE_DEFAULT, SILHOUETTE_MODES, SILHOUETTE_PART, supportsSilhouette, withSilhouette, type SilhouetteMode } from './silhouette.js';
export { gridFromLines, layoutGrid, lineAxes, mayHaveWindow, snapWidths, type AxisList, type LayoutGrid } from './grid.js';
export { checkPlan, massingGrid, planDraft, planFacadeMeasures, planShellOptions, reachableRooms, silhouette, windowlessRooms, type ArchetypeFurnishable, type PlanCheck } from './check.js';
export { FACADE_MEASURE_BANDS, articulation, facadeMeasureLints, facadeMeasures, frontRaster, hullArea, type FacadeMeasures, type FrontRasterCell } from './facade-measures.js';
export { renderPlan } from './ascii.js';
export { DEFAULT_LOOP_DOORS, UNDERGROUND_CORRIDOR, UNDERGROUND_DEFAULTS, planUnderground, undergroundDefault, type UndergroundInput, type UndergroundParams, type UndergroundReport, type UndergroundResult } from './underground.js';
