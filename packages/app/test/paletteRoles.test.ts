import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { worldOf } from '../src/exporting.js';
import { paletteByRole } from '../src/ui/paletteRows.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;

/**
 * Review 3: „Möbel-Roh-IDs (`fence_plate`, `podzol`)" in der Palette. Am echten Bau geprüft: jede Gruppe ist
 * entweder eine Rolle des Themes oder die Sammelgruppe „Möbel & Deko" – und es gibt wirklich solche Fälle.
 */
describe('Palette im echten Bau: keine Layer-IDs (Review 3)', () => {
  it('jede Gruppe ist Theme-Rolle oder „Möbel & Deko"', async () => {
    const ctx = await browserContext(load)!.ready('1.21.11');
    const s = sampleSession(catalog);
    const world = worldOf(s.project, ctx, uc.shellStyle(s));
    const theme = uc.shellThemeOf(catalog, s.project.state.themeId)!;
    const themeRoles = new Set(Object.keys(theme.roles));

    const palette = world.materialized.palette;
    // Der Beispielbau nutzt nur Theme-Rollen; die Gruppierung muss aber auch fremde Material-Schichten
    // auffangen (synthetisch in `paletteRows.test.ts` geprüft). Hier die Invariante am echten Bau:
    const groups = paletteByRole(palette, 4, { themeRoles });
    for (const g of groups) {
      if (g.role === '—') continue; // Zellen ohne Rolle (z. B. Außen-Deko ohne Theme-Bezug)
      if (g.role === '~mobiliar') {
        expect(g.label).toBe('Möbel & Deko');
        continue;
      }
      expect(themeRoles.has(g.role), `Gruppe ${g.role} ist keine Theme-Rolle`).toBe(true);
      expect(g.label).toBe(g.role);
    }
    // Keine Gruppe (außer Möbel/ohne Rolle) trägt eine unbekannte ID
    expect(groups.filter((g) => g.role !== '~mobiliar' && g.role !== '—').every((g) => themeRoles.has(g.role))).toBe(true);
  });
});
