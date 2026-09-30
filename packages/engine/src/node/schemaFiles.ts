import type { Engine } from '../engine.js';

/** Inhalt der eingecheckten Schema-Dateien (stabil formatiert, mit Zeilenende). */
export const schemaFiles = (engine: Engine): Record<string, string> => ({
  'engine.schema.json': `${JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'EngineRequest', ...engine.requestSchema() }, null, 2)}\n`,
  'tools.json': `${JSON.stringify(engine.tools(), null, 2)}\n`,
});
