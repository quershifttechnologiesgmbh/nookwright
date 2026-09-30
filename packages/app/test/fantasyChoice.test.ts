/**
 * W7-K Fantasy-Stufe im Editor (plan/spikes/W7K_fantasy_ui.md): Auswahl „nach Stil / aus / Akzent / voll“ und Art
 * „nach Material / elbisch / zwergisch“ im Außen-Panel – Optionen decken die Domäne ab, Setzen/Entfernen der Felder,
 * ein Undo-Schritt, Statuszeile, Projektdatei (Rundreise, alte Datei = nach Stil), Anzeige aus dem fertigen Plan und
 * die Befehlssuche (Strg+K).
 */
import { FANTASY_KITS, FANTASY_LEVELS, fantasyModuleComponent } from '@mcda/exterior';
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import { commandItems, searchCommands } from '../src/ui/commandSearch.js';
import {
  FANTASY_COMPONENT_PREFIX, FANTASY_KIT_OPTIONS, FANTASY_LEVEL_OPTIONS, fantasySeen, fantasyView, withFantasyKit, withFantasyLevel,
} from '../src/ui/fantasyChoice.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const refs = { catalog, themes: load.themeCatalog! };
const planOf = (s: uc.Session) => uc.exteriorOf(s.project, catalog, uc.shellStyle(s));
const level = (s: uc.Session, pick: Parameters<typeof withFantasyLevel>[1]) => uc.setShellStyle(s, { exterior: withFantasyLevel(uc.shellStyle(s).exterior, pick) }, catalog);
const kit = (s: uc.Session, pick: Parameters<typeof withFantasyKit>[1]) => uc.setShellStyle(s, { exterior: withFantasyKit(uc.shellStyle(s).exterior, pick) }, catalog);

describe('W7-K Fantasy-Auswahl: Optionen und Felder', () => {
  it('Präfix = Domäne, Optionen decken FANTASY_LEVELS und FANTASY_KITS ab (plus „nach Stil“/„nach Material“)', () => {
    expect(fantasyModuleComponent('lantern_arm').startsWith(FANTASY_COMPONENT_PREFIX)).toBe(true);
    expect(FANTASY_LEVEL_OPTIONS.map((o) => o.id)).toEqual(['', ...FANTASY_LEVELS]);
    expect(FANTASY_KIT_OPTIONS.map((o) => o.id)).toEqual(['', ...FANTASY_KITS]);
    expect(FANTASY_LEVEL_OPTIONS.map((o) => o.label)).toEqual(['nach Stil', 'aus', 'Akzent', 'voll']);
    expect(FANTASY_KIT_OPTIONS.map((o) => o.label)).toEqual(['nach Material', 'elbisch', 'zwergisch']);
  });

  it('withFantasyLevel: „nach Stil“ entfernt das Feld; voll/nach Stil schalten fantasyDecor an, aus/Akzent lassen die Gruppe', () => {
    const x0: uc.ExteriorChoice = { ...uc.DEFAULT_EXTERIOR, groups: { ...uc.DEFAULT_EXTERIOR.groups, fantasyDecor: false } };
    expect(withFantasyLevel(x0, 'accent').fantasy).toBe('accent');
    expect(withFantasyLevel(x0, 'accent').groups.fantasyDecor).toBe(false);
    expect(withFantasyLevel(x0, 'off').groups.fantasyDecor).toBe(false);
    expect(withFantasyLevel(x0, 'full').groups.fantasyDecor).toBe(true);
    const back = withFantasyLevel(withFantasyLevel(x0, 'full'), '');
    expect('fantasy' in back).toBe(false);
    expect(back.groups.fantasyDecor).toBe(true);
    expect(withFantasyKit(x0, 'dwarven').fantasyKit).toBe('dwarven');
    expect('fantasyKit' in withFantasyKit(withFantasyKit(x0, 'elven'), '')).toBe(false);
  });
});

describe('W7-K Fantasy-Auswahl: Sitzung, Undo, Statuszeile, Projektdatei', () => {
  it('je Änderung ein Undo-Schritt, Undo zurück zum vorigen Stil; Hülle bleibt; gleiche Wahl ist keine Aktion', () => {
    const s0 = sampleSession(catalog);
    const s1 = level(s0, 'accent');
    expect(s1.past).toHaveLength(s0.past.length + 1);
    expect(uc.shellKey(uc.shellStyle(s1))).toBe(uc.shellKey(uc.shellStyle(s0)));
    expect(uc.styleKey(uc.shellStyle(s1))).not.toBe(uc.styleKey(uc.shellStyle(s0)));
    const s2 = kit(s1, 'dwarven');
    expect(s2.past).toHaveLength(s1.past.length + 1);
    expect(uc.shellStyle(uc.undo(s2)).exterior).toEqual(uc.shellStyle(s1).exterior);
    expect(uc.shellStyle(uc.undo(uc.undo(s2))).exterior).toEqual(uc.shellStyle(s0).exterior);
    expect(uc.shellStyle(uc.redo(uc.undo(s2))).exterior.fantasyKit).toBe('dwarven');
    expect(level(s1, 'accent')).toBe(s1);
  });

  it('Statuszeile: „Fantasy: Akzent“, „Fantasy-Art: zwergisch“, zurück „Fantasy: nach Stil“', () => {
    const before = uc.shellStyle(sampleSession(catalog));
    const label = (x: uc.ExteriorChoice) => uc.styleChangeLabel(before, { exterior: x });
    expect(label(withFantasyLevel(before.exterior, 'accent'))).toBe('Fantasy: Akzent');
    expect(label(withFantasyKit(before.exterior, 'dwarven'))).toBe('Fantasy-Art: zwergisch');
    const accented = { ...before, exterior: withFantasyLevel(before.exterior, 'accent') };
    expect(uc.styleChangeLabel(accented, { exterior: withFantasyLevel(accented.exterior, '') })).toBe('Fantasy: nach Stil');
  });

  it('Projektdatei: Stufe und Art überstehen die Rundreise; alte Datei ohne Feld = nach Stil/nach Material', () => {
    const s = kit(level(sampleSession(catalog), 'full'), 'elven');
    const r = parseProjectFile(serializeProject(s), refs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(uc.shellStyle(r.session).exterior.fantasy).toBe('full');
    expect(uc.shellStyle(r.session).exterior.fantasyKit).toBe('elven');
    expect(uc.styleKey(uc.shellStyle(r.session))).toBe(uc.styleKey(uc.shellStyle(s)));
    const file = JSON.parse(serializeProject(s)) as Record<string, unknown>;
    const strip = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(strip) : v !== null && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'fantasy' && k !== 'fantasyKit').map(([k, w]) => [k, strip(w)])) : v;
    const old = parseProjectFile(JSON.stringify(strip(file)), refs);
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect(old.warnings).toEqual([]);
    expect('fantasy' in uc.shellStyle(old.session).exterior).toBe(false);
    expect('fantasyKit' in uc.shellStyle(old.session).exterior).toBe(false);
  });
});

describe('W7-K Fantasy-Auswahl: Anzeige aus dem fertigen Plan', () => {
  it('Mittelalter nach Stil: keine Fantasy-Teile, Art verborgen; Akzent zeigt die Art, „nach Material“ nennt das Ergebnis', () => {
    const s0 = sampleSession(catalog);
    const v0 = fantasyView(uc.shellStyle(s0).exterior, planOf(s0));
    expect(v0.parts).toBe(0);
    expect(v0.showKit).toBe(false);
    expect(v0.levelText('')).toBe('nach Stil');
    const s1 = level(s0, 'accent');
    const seen = fantasySeen(planOf(s1));
    expect(seen.parts).toBeGreaterThan(0);
    const v1 = fantasyView(uc.shellStyle(s1).exterior, planOf(s1));
    expect(v1.showKit).toBe(true);
    expect(v1.kitText('')).toBe(`nach Material (${seen.kit === 'elven' ? 'elbisch' : 'zwergisch'})`);
    const s2 = kit(s1, 'dwarven');
    expect(fantasySeen(planOf(s2)).kit).toBe('dwarven');
    // voll bringt mehr Module als Akzent
    expect(fantasySeen(planOf(level(s2, 'full'))).parts).toBeGreaterThan(fantasySeen(planOf(s2)).parts);
  });

  it('Elbisch nach Stil: „nach Stil (voll)“, Art sichtbar mit „nach Material (elbisch)“; aus: keine Teile, Art verborgen', () => {
    const s0 = uc.setTheme(sampleSession(catalog), catalog, 'elven');
    const v0 = fantasyView(uc.shellStyle(s0).exterior, planOf(s0));
    expect(v0.parts).toBeGreaterThan(0);
    expect(v0.levelText('')).toBe('nach Stil (voll)');
    expect(v0.showKit).toBe(true);
    expect(v0.kitText('')).toBe('nach Material (elbisch)');
    const off = level(s0, 'off');
    const v1 = fantasyView(uc.shellStyle(off).exterior, planOf(off));
    expect(v1.parts).toBe(0);
    expect(v1.showKit).toBe(false);
  });

  it('Gruppe fantasyDecor aus (über ein Außen-Teil): „voll (ohne Banner, Zier)“', () => {
    const s0 = uc.setTheme(sampleSession(catalog), catalog, 'elven');
    const x = uc.shellStyle(s0).exterior;
    const s1 = uc.setShellStyle(s0, { exterior: { ...x, groups: { ...x.groups, fantasyDecor: false } } }, catalog);
    const v = fantasyView(uc.shellStyle(s1).exterior, planOf(s1));
    expect(v.levelText('')).toBe('nach Stil (voll ohne Banner, Zier)');
    expect(v.levelText('full')).toBe('voll (ohne Banner, Zier)');
  });
});

describe('W7-K Fantasy-Auswahl: Befehlssuche (Strg+K)', () => {
  it('„fantasy“, „elbisch“, „zwergisch“, „akzent“ und der frühere Schalter führen nach Haus › Mehr', () => {
    const items = commandItems();
    expect(searchCommands(items, 'fantasy').slice(0, 2).map((i) => i.id).sort()).toEqual(['exterior.fantasy', 'exterior.fantasyKit']);
    expect(searchCommands(items, 'zwergisch')[0]?.id).toBe('exterior.fantasyKit');
    expect(searchCommands(items, 'elbisch')[0]?.id).toBe('exterior.fantasyKit');
    expect(searchCommands(items, 'akzent')[0]?.id).toBe('exterior.fantasy');
    expect(searchCommands(items, 'Fantasy-Akzente')[0]?.id).toBe('exterior.fantasy');
    const hit = items.find((i) => i.id === 'exterior.fantasy')!;
    expect(hit.path).toBe('Haus › Mehr');
    expect(hit.find).toBe('Fantasy-Stufe');
  });
});
