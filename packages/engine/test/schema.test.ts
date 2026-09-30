/**
 * Das eingecheckte Schema ist aktuell. Schlägt fehl nach jeder API-Änderung (Operation, Feld, Katalogdatei):
 * `npm run schema -w @mcda/engine` ausführen und das geänderte Schema mit committen – so ist jede Änderung der
 * Steuerbarkeit im Review sichtbar.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { schemaFiles } from '../src/node/schemaFiles.js';
import { engine } from './fixture.js';

describe('schema/ ist aktuell', () => {
  for (const [name, text] of Object.entries(schemaFiles(engine))) {
    it(name, () => {
      const onDisk = readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8');
      expect(onDisk === text, `schema/${name} veraltet – npm run schema -w @mcda/engine`).toBe(true);
    });
  }
});
