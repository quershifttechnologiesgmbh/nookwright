/**
 * Regression zum Review-Befund 1 (F1): `bindThemes` darf nicht den **ersten** ThemeCatalog je Theme-ID festhalten.
 * Sonst sieht die Hülle nach dem Laden eines zweiten Katalogs weiter die Theme-Daten des ersten – bei einem
 * Katalog-Update (oder in Tests, die mehrere Kataloge bauen) entstehen so veraltete Ergebnisse.
 *
 * Ablauf: Katalog laden (Fachwerk-Deko an) → zweiten Katalog aus denselben Dateien mit `decorate: false` laden →
 * die Hülle muss der **zweiten** Angabe folgen. Vor der Korrektur blieb die Deko des ersten Katalogs stehen.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG_FILES, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { buildCatalog } from '../src/catalogLoader.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const NEW_STYLE = { roof: 'gable' as const, overhang: 1, windows: { enabled: true, spacing: 6 }, roofDetail: uc.PLAIN_ROOF_DETAIL, dormers: uc.PLAIN_DORMERS, facade: uc.DEFAULT_FACADE, exterior: uc.PLAIN_EXTERIOR };
const NEW = uc.shellStyle(NEW_STYLE);

const timberPath = Object.keys(CATALOG_FILES).find((p) => p.endsWith('themes/timber.json5'));
if (timberPath === undefined) throw new Error('timber.json5 nicht im Bundle');

/** Deko-Zellen der Hülle: F1-Anbauten in der Holzrolle (Falltür/Treppe am Außenprofil). Q2: Köpfe der Pflicht-Wandvorlagen
 * (gleicher Rollen-/Formschlüssel, Stamm derselben Spalte darunter) zählen nicht als Deko. */
function decorCells(load: ReturnType<typeof buildCatalog>): number {
  const catalog = load.catalog!;
  const s = sampleSession(catalog, { themeId: 'timber' });
  const theme = uc.shellThemeOf(catalog, s.project.state.themeId);
  expect(theme, 'Theme im Katalog aufgelöst').toBeDefined();
  const cells = uc.shellOf(s.project, uc.shellStyle(s), theme).cells;
  return cells.filter((c) => c.kind === 'facade' && c.role === 'beam' && (c.shape === 'trapdoor' || c.shape === 'stairs')
    && !cells.some((o) => o.role === 'beam' && o.shape === 'log' && o.pos[0] === c.pos[0] && o.pos[2] === c.pos[2] && o.pos[1] === c.pos[1] - 1)).length;
}

describe('Theme-Katalog je Katalog, nicht je Theme-ID (Review-Befund 1)', () => {
  it('ein zweiter Katalog mit gleicher Theme-ID gilt sofort', () => {
    const withDecorate = (on: boolean): Readonly<Record<string, string>> => ({
      ...CATALOG_FILES,
      [timberPath]: CATALOG_FILES[timberPath]!.replaceAll('decorate: true', `decorate: ${on}`),
    });

    const mitDeko = buildCatalog(withDecorate(true));
    expect(mitDeko.errors).toEqual([]);
    expect(decorCells(mitDeko), 'Katalog 1: Deko an').toBeGreaterThan(0);

    const ohneDeko = buildCatalog(withDecorate(false));
    expect(ohneDeko.errors).toEqual([]);
    expect(decorCells(ohneDeko), 'Katalog 2: Deko aus').toBe(0);

    // und wieder zurück: auch der dritte Katalog gilt
    const wiederAn = buildCatalog(withDecorate(true));
    expect(decorCells(wiederAn), 'Katalog 3: Deko wieder an').toBeGreaterThan(0);
  });

  it('der gebündelte Katalog bleibt unverändert nutzbar', () => {
    const load = loadBundledCatalog();
    expect(load.errors).toEqual([]);
    expect(decorCells(load)).toBeGreaterThan(0);
  });
});

describe('Optik: Fachwerk-Typen starten ohne Wandvorlagen (Review-Befund 3)', () => {
  it('Fachwerk-Theme: Vorlagen aus; Stein-Theme und ausdrückliche Angabe bleiben', () => {
    const load = loadBundledCatalog();
    const themes = load.themeCatalog!;
    const def = load.buildingTypes.get('timber');
    const p = bt.defaultParams(def, themes.ids(), 'timber', NEW);
    const current = uc.shellStyle({ ...NEW_STYLE, facade: { ...uc.DEFAULT_FACADE, pilasters: 5 } });

    // Fachwerk-Theme: die geerbten Wandvorlagen entfallen (sie überdecken Ständer, Riegel und Motive)
    const mitFachwerk = bt.withoutPilastersForTheme({ ...bt.typeBuildOptions(def), facade: { plinthProfile: true, pilasters: 5 } }, themes, 'timber');
    expect(mitFachwerk.facade?.pilasters, 'Fachwerk: Vorlagen aus').toBe(0);
    // Stein-Theme bleibt unberührt
    const stein = bt.withoutPilastersForTheme({ facade: { plinthProfile: true, pilasters: 5 } }, themes, 'medieval');
    expect(stein.facade?.pilasters, 'Stein: Vorlagen bleiben').toBe(5);
    // ausdrückliche Angabe des Bautyps gilt weiter (Panel-Einstellung bleibt möglich)
    const vorgabe = bt.withoutPilastersForTheme({ facade: { pilasters: 4 } }, themes, 'timber');
    expect(vorgabe.facade?.pilasters, 'ohne ausdrückliche Angabe: aus').toBe(0);
    expect(bt.typeStyle(def, { facade: { pilasters: 4 } }, { exterior: true }, current).facade.pilasters).toBe(4);
    void p;
  });
});
