import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAMILY_SHAPES } from '../src/familyShapes.js';
import { SHELL_ROLE_SHAPES } from '../src/roleShapes.js';

const FAMILIES = fileURLToPath(new URL('../../platform/data/families-1.21.11.json', import.meta.url));

/**
 * Die beiden Tabellen des Formvertrags sind Kopien von Plattform- bzw. Materialisierer-Daten (der Katalog darf
 * von beiden nicht abhängen). Dieser Test hält sie an der Quelle fest: Läuft `families-1.21.11.json` auseinander,
 * schlägt er fehl – dann `packages/catalog/src/familyShapes.ts` neu erzeugen (`spikes/quality/`).
 */
describe('Formvertrag: Tabellen stimmen mit den Quellen', () => {
  it('FAMILY_SHAPES entspricht families-1.21.11.json', () => {
    const raw = JSON.parse(readFileSync(FAMILIES, 'utf8')) as { families: Record<string, { shapes?: Record<string, string> }> };
    const expected = Object.fromEntries(Object.entries(raw.families).map(([id, f]) => [id, Object.keys(f.shapes ?? {}).sort()]));
    expect(Object.keys(FAMILY_SHAPES).sort()).toEqual(Object.keys(expected).sort());
    for (const id of Object.keys(expected)) expect([...FAMILY_SHAPES[id]!].sort(), id).toEqual(expected[id]);
  });

  it('der Formvertrag nennt nur Formen, die der Materialisierer überhaupt kennt', () => {
    // `ladder` ist keine Familienform (Leitern haben keine Familie), sondern ein eigener Block-Typ.
    // `ladder` und `bell` sind eigene Block-Typen ohne Plattform-Familie.
    const special = new Set(['ladder', 'bell', 'end_rod', 'lightning_rod', 'chain', 'lantern']);
    const all = new Set(Object.values(FAMILY_SHAPES).flat());
    for (const [role, shapes] of Object.entries(SHELL_ROLE_SHAPES)) {
      for (const shape of shapes) expect(all.has(shape) || special.has(shape), `${role}.${shape}`).toBe(true);
    }
  });
});
