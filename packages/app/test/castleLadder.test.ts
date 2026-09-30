/**
 * Befund aus der App (Burg kompakt, M, Front Süd, medieval, Seed 2273086392, erster Vorschlag): Panel „Gebäude“
 * meldete „Treppe in ‚Kaserne · 4 (EG)‘ ist zu kurz für eine Etage“. Ursache: Der Bergfried (Massing `tower`) wird
 * absichtlich mit **Leitern** erschlossen; eine Leiter sperrt im unteren Raum genau eine Zelle, und die Prüfung
 * „1–2 gesperrte Zellen = zu kurze Treppenfolge“ (research/21 §0.5) hielt das für eine Treppe mit zu wenig Stufen.
 * Eine Leiter hat keine Stufen und überwindet jede Etagenhöhe – das war ein Fehlalarm der Prüfung.
 */
import { circulation } from '@mcda/pipeline';
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });

describe('Burg mit Leitern im Bergfried: kein Hinweis „Treppe zu kurz“', () => {
  it.each([
    ['Seed des Befunds', 2273086392],
    ['erster Vorschlag zur Basis des Befunds', bt.proposalSeeds(2273086392)[0]!],
  ])('%s', (_label, seed) => {
    const def = types.get('castle_compact');
    const p = { ...bt.defaultParams(def, ctx.themes.ids(), 'medieval', NEW), size: 'M' as const, front: 'south' as const };
    const { session } = bt.typeSession(def, p, seed, ctx, NEW);
    const shell = uc.shellOf(session.project, uc.shellStyle(session), uc.shellThemeOf(catalog, session.project.state.themeId));
    // Vorbedingung: Der Bergfried steigt über Leitern (sonst prüfte der Test nichts)
    expect(session.project.state.links.some((l) => l.type === 'ladder')).toBe(true);
    const report = circulation(shell, session.project);
    expect(report.warnings.filter((w) => w.startsWith('Treppe zu kurz'))).toEqual([]);
  }, HEAVY_TIMEOUT);
});
