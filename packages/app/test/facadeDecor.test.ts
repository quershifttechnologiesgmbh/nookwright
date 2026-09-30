/**
 * F1-Deko im App-Stil (research/16 W4): Theme-Vorgabe (Fachwerk) trifft auf den Schalter „Fachwerk-Deko“ im Panel
 * „Gebäude“. `decorate`/`gableBraces` stehen in `FacadeChoice`, `facadeOptions` übersetzt sie in die Domäne.
 */
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;

const facadeOf = (choice: uc.FacadeChoice) => uc.facadeOptions(choice);
/**
 * Deko-Zellen (Paneele und Giebelstreben): `beam`-Zellen in Außenluft. Q2: Wandvorlagen (Pflichtregel `pierFrom`)
 * haben denselben Rollen-/Formschlüssel wie eine Giebelstrebe – ihre Köpfe erkennt man am Stamm derselben Spalte
 * direkt darunter und zählt sie hier nicht mit.
 */
const decorCells = (s: uc.Session) => {
  const cells = uc.shellOf(s.project, uc.shellStyle(s)).cells;
  const isPilasterHead = (c: (typeof cells)[number]): boolean =>
    c.role === 'beam' && c.shape === 'stairs' &&
    cells.some((o) => o.role === 'beam' && o.shape === 'log' && o.pos[0] === c.pos[0] && o.pos[2] === c.pos[2] && o.pos[1] === c.pos[1] - 1);
  return cells.filter((c) => c.kind === 'facade' && c.role === 'beam' && (c.shape === 'trapdoor' || c.shape === 'stairs') && !isPilasterHead(c));
};

describe('Fachwerk-Deko als App-Einstellung (F1)', () => {
  it('Fachwerk bekommt die Deko ohne Zutun, andere Themes nicht; Schalter aus entfernt sie', () => {
    const timber = sampleSession(catalog, { themeId: 'timber' });
    expect(decorCells(timber).length).toBeGreaterThan(0);
    const off = uc.setShellStyle(timber, { facade: { ...uc.shellStyle(timber).facade, decorate: false } }, catalog);
    expect(decorCells(off)).toEqual([]);
    const medieval = sampleSession(catalog, { themeId: 'medieval' });
    expect(decorCells(medieval)).toEqual([]);
    // der Schalter schaltet sie auch dort ein (Holzrolle kommt dann aus dem Theme)
    const on = uc.setShellStyle(medieval, { facade: { ...uc.shellStyle(medieval).facade, decorate: true } }, catalog);
    expect(decorCells(on).length).toBeGreaterThan(0);
  });

  it('Giebelstreben-Takt wirkt nur bei eingeschalteter Deko; 0 = keine Streben', () => {
    const timber = sampleSession(catalog, { themeId: 'timber' });
    const count = (s: uc.Session): number => decorCells(s).filter((c) => c.shape === 'stairs').length;
    const withBraces = (n: number): number => count(uc.setShellStyle(timber, { facade: { ...uc.shellStyle(timber).facade, gableBraces: n } }, catalog));
    expect(withBraces(0)).toBe(0);
    // W2 (26.09.2026): Regeln F2/F4 (W2-FA) – im Giebel des Beispielhauses sitzt jetzt ein Erdgeschoss-Fenster mit
    // Verdachung; deren Stufe belegt einen Streben-Platz der Giebelbasis. Takt 2 und 3 setzen deshalb gleich viele
    // Streben, aber an anderen Stellen; Takt 6 weniger.
    const at = (n: number): string[] => decorCells(uc.setShellStyle(timber, { facade: { ...uc.shellStyle(timber).facade, gableBraces: n } }, catalog))
      .filter((c) => c.shape === 'stairs').map((c) => c.pos.join(',')).sort();
    expect(withBraces(2)).toBeGreaterThanOrEqual(withBraces(3));
    expect(at(2)).not.toEqual(at(3));
    expect(withBraces(3)).toBeGreaterThan(withBraces(6));
    // der Zwischenspeicher der Hülle sieht den neuen Takt (verschachteltes Feld in `facade`)
    expect(uc.shellKey(uc.shellStyle(timber))).not.toBe(uc.shellKey(uc.shellStyle(uc.setShellStyle(timber, { facade: { ...uc.shellStyle(timber).facade, gableBraces: 2 } }, catalog))));
  });

  it('`facadeOptions` übersetzt die Wahl: ausdrücklich an/aus und der Takt', () => {
    expect(facadeOf({ ...uc.PLAIN_FACADE, decorate: true })).toEqual({ decor: { panels: true, gableBraces: uc.GABLE_BRACE_RANGE.standard } });
    expect(facadeOf({ ...uc.PLAIN_FACADE, decorate: false })).toEqual({ decor: { panels: false, gableBraces: 0 } });
    expect(facadeOf({ ...uc.PLAIN_FACADE, gableBraces: 4 })).toEqual({ decor: { gableBraces: 4 } });
    // ohne Angabe bleibt die Hülle ohne Deko (Theme-Vorgabe entscheidet in der Pipeline)
    expect(facadeOf({ ...uc.PLAIN_FACADE })).toBeUndefined();
    expect(facadeOf({ ...uc.PLAIN_FACADE, gableBraces: 0 })).toEqual({ decor: { gableBraces: 0 } });
  });

  it('Validierung: Takt außerhalb des Bereichs wird gemeldet', () => {
    expect(uc.facadeProblem({ ...uc.PLAIN_FACADE, gableBraces: 1 })).toMatch(/Giebelstreben/);
    expect(uc.facadeProblem({ ...uc.PLAIN_FACADE, gableBraces: uc.GABLE_BRACE_RANGE.max + 1 })).toMatch(/Giebelstreben/);
    expect(uc.facadeProblem({ ...uc.PLAIN_FACADE, gableBraces: 3 })).toBeUndefined();
    expect(uc.facadeProblem({ ...uc.PLAIN_FACADE, decorate: true, gableBraces: 3 })).toBeUndefined();
    expect(() => uc.setShellStyle(sampleSession(catalog, { themeId: 'timber' }), { facade: { ...uc.PLAIN_FACADE, gableBraces: 1 } }, catalog)).toThrow(/Giebelstreben/);
  });

  it('Projektdatei: die Deko-Wahl überlebt Speichern und Laden', () => {
    const timber = sampleSession(catalog, { themeId: 'timber' });
    const off = uc.setShellStyle(timber, { facade: { ...uc.shellStyle(timber).facade, decorate: false } }, catalog);
    const text = serializeProject(off);
    const back = parseProjectFile(text, { catalog });
    expect(back.ok).toBe(true);
    if (!back.ok) throw new Error(back.error);
    expect(uc.shellStyle(back.session).facade.decorate).toBe(false);
    expect(decorCells(back.session)).toEqual([]);
  });
});
