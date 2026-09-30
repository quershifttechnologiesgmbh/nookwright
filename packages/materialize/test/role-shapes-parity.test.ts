import { describe, expect, it } from 'vitest';
import { SHELL_ROLE_SHAPES as CATALOG } from '@mcda/catalog';
import { SHELL_ROLE_SHAPES as MATERIALIZE } from '../src/shell-shapes.js';

/**
 * Der Katalog braucht den Form-Vertrag der Hüllen-Rollen für den Paletten-Filter (`resolvePalettedTheme`), darf
 * aber nicht von `@mcda/materialize` abhängen. Damit beide Tabellen nicht auseinanderlaufen, vergleicht dieser
 * Test sie Feld für Feld.
 */
describe('Form-Vertrag der Hüllen-Rollen: Katalog und Materialisierer gleich', () => {
  it('gleiche Rollen und gleiche Formen', () => {
    expect(Object.keys(CATALOG).sort()).toEqual(Object.keys(MATERIALIZE).sort());
    for (const role of Object.keys(MATERIALIZE)) {
      expect([...CATALOG[role]!].sort(), role).toEqual([...MATERIALIZE[role]!].sort());
    }
  });
});
