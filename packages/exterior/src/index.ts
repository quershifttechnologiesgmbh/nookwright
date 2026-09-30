/**
 * Kontext Außengestaltung (research/18 §14, plan/02 Stufe 9/10): Außen-Komponenten an den Ankern der Hülle
 * (`Shell.anchors`). Eingang: Hülle + Katalog + Seed + Stil (+ Einrichtung für Schornsteine); Ausgang:
 * Platzierungen für die Materialisierung. Rein und deterministisch, abgeleitet wie die Hülle (nicht im Projekt).
 */
export const EXTERIOR_CONTEXT = 'exterior' as const;
export * from './types.js';
export { planExterior } from './plan.js';
export { ExteriorSite, atDensity, rhythm, type Level, type Part } from './site.js';
export { entranceKit, entranceModuleComponent, entranceModuleFor, type EntranceKit } from './entrance.js';
export { chooseModule, moduleWalls } from './modules.js';
export { windowModuleFor, windowModuleComponent } from './windows.js';
export {
  FACADE_DETAIL_COMPONENTS, FACADE_DETAIL_SUBTLE_TAG, facadeDetailActive, facadeDetailLevelFor, planFacadeDetail, variantMinVersion, type FacadeDetailOptions,
} from './detail.js';
export {
  FANTASY_ACCENT_TAG, FANTASY_MODULES, fantasyKitFor, fantasyLevelFor, fantasyModuleComponent, fantasyPiece, type FantasyModuleId, type FantasyPiece,
} from './fantasy.js';
