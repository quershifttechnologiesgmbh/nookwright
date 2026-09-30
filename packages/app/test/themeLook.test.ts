import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { worldOf } from '../src/exporting.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;

/**
 * Review 3: „Winter ohne Schnee", „Ruine wie ein intaktes Haus". Hier wird **gemessen**, was die Themes am
 * fertigen Bau wirklich bewirken – als Beleg und als Wächter: die Zahlen dürfen nicht unbemerkt einbrechen.
 * Beide Lücken sind inzwischen geschlossen (Schneeauflage research/24 §7.4, Erosion research/50 C1), deshalb
 * prüft der Wächter jetzt die Wirkung **und** die Kontrolle (Theme ohne Feld bleibt unverändert).
 */
describe('Theme-Look am fertigen Bau (Review 3)', () => {
  const bau = async (themeId: string) => {
    const ctx = await browserContext(load)!.ready('1.21.11');
    let s = uc.createSession(11, 'X', themeId);
    s = uc.paintRect(s, catalog, { x1: 3, z1: 3, x2: 14, z2: 12 }, 'bedroom').session;
    s = uc.paintRect(s, catalog, { x1: 3, z1: 14, x2: 14, z2: 22 }, 'kitchen').session;
    const w = worldOf(s.project, ctx, uc.shellStyle(s));
    const count = (re: RegExp) => w.materialized.palette.filter((e) => re.test(e.block)).reduce((n, e) => n + e.count, 0);
    const total = w.materialized.palette.reduce((n, e) => n + e.count, 0);
    // Silhouette: Hüllzellen, die im fertigen Volumen fehlen (Erosion). Gemessen über die **Positionen** –
    // `stateAt` auf einer entfernten Zelle liefert nicht zuverlässig Luft (die Zelle ist gar nicht im Volumen).
    const shell = uc.shellOf(s.project, uc.shellStyle(s), uc.shellThemeOf(catalog, s.project.state.themeId));
    const da = new Set([...w.materialized.volume.cells()].map((c) => c.pos.join(',')));
    const fehlend = shell.cells.filter((c) => !da.has(c.pos.join(','))).length;
    return { total, count, fehlend, shellCells: shell.cells.length };
  };

  it('Ruine: Moos, Risse und fehlende Hüllzellen (Silhouette bricht)', async () => {
    const { total, count, fehlend, shellCells } = await bau('ruin');
    expect(total).toBeGreaterThan(1000);
    expect(count(/moss/)).toBeGreaterThan(100); // gemessen 191 von 1422
    expect(count(/cracked/)).toBeGreaterThan(30); // gemessen 71
    // Erosion (research/50 C1): sichtbar, aber nicht zerstörerisch
    expect(fehlend, `fehlende Hüllzellen von ${shellCells}`).toBeGreaterThan(10);
    expect(fehlend / shellCells).toBeLessThan(0.25);
    // Kontrolle: ein Theme ohne `decor.ruin` verliert keine Hüllzelle
    expect((await bau('medieval')).fehlend).toBe(0);
  });

  it('Winter: Schnee liegt auf dem Dach (Schneeauflage, research/24 §7.4)', async () => {
    const { count } = await bau('winter');
    // Gemessen: 111 Schneeblöcke am Beispielhaus (Dach + First), vorher waren es 0 (research/48 §14).
    // W2 (26.09.2026): Regel D1 / X3-Schneehinweis – Schnee als Vollblock nur noch am First (minRoofT 0,85); die
    // Schneefläche darunter trägt das Deckungsrezept in ganzen Ringen aus glattem Quarz (keine Leitersprossen mehr).
    expect(count(/snow/)).toBeGreaterThan(10);
    expect(count(/^smooth_quartz/)).toBeGreaterThan(30);
    // Kontrolle: ein Theme ohne `decor.snowCover` bleibt schneefrei
    expect((await bau('medieval')).count(/snow/)).toBe(0);
  });
});
