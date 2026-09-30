/**
 * Browser-Einstieg `@mcda/engine/intent`: nur der lokale Klassifikator und das Vokabular – ohne Operationen, zod und
 * Node-Adapter. Die Web-App nutzt ihn als Rückfall für „Beschreibe dein Gebäude“, wenn der Engine-Server nicht
 * erreichbar ist (rein, ohne Netz).
 */
export {
  FANTASY_WORDS, LOCAL_CONFIDENCE, MOOD_THEMES, SAFE_MODIFIERS, TYPE_CONFIDENCE_MIN, classifyLocal, normalize, type LocalIntent,
} from './local.js';
export { vocabularyOf, type BuildingTypeLabel, type Label, type Vocabulary } from '../vocabulary.js';
export type { EngineRequest } from '../engine.js';
