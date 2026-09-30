/**
 * Schreibt das eingecheckte Schema der Engine: `schema/engine.schema.json` (Anfrage `{ op, input }`) und
 * `schema/tools.json` (Tool-Definitionen). `test/schema.test.ts` prüft, dass beide aktuell sind – jede Änderung an
 * der API (neue Operation, neues Feld, neue Katalogdatei) erscheint damit sichtbar im Diff.
 * Aufruf: npm run schema -w @mcda/engine
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nodeEngine } from '../src/node/index.js';
import { schemaFiles } from '../src/node/schemaFiles.js';

const dir = fileURLToPath(new URL('../schema/', import.meta.url));
mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(schemaFiles(nodeEngine()))) {
  writeFileSync(`${dir}${name}`, text);
  console.log(`schema/${name}`);
}
