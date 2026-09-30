/**
 * Baustandard W2 (plan/baustandard.md) als Katalog-Prüfung: Materialbudget (W4), Sockel (W7), Deckungsrezept (D1),
 * Kantenkontrast (D3) und Verlauf über die Bauwerkshöhe (W5). Die Themes im Repo halten alle Regeln ein; jede Regel
 * meldet einen Verstoß mit ihrer ID (Beispiele unten sind die Befunde der Prüfberichte X1/X3).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_THEME_ROLES, ThemeCatalog, baseBlockKey, isWoodFamily, isWoodRole, parseThemeDef, resolveTheme, roleStandardWarnings,
  themeStandardWarnings, validateThemeDef, mainFamily, roleLightness, type ThemeDef,
} from '../src/index.js';

const THEME_DIR = fileURLToPath(new URL('../../../catalog/themes', import.meta.url));
const repoThemes = (): ThemeDef[] => readdirSync(THEME_DIR).filter((f) => f.endsWith('.json5')).map((f) => {
  const r = parseThemeDef(readFileSync(join(THEME_DIR, f), 'utf8'), f);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
});

const minimalRoles = Object.fromEntries(REQUIRED_THEME_ROLES.map((r) => [r, { family: 'oak' }]));
const theme = (roles: Record<string, unknown>, extra: Record<string, unknown> = {}): ThemeDef => {
  const r = validateThemeDef({ id: 't', name: 'T', roles: { ...minimalRoles, ...roles }, ...extra });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};
const g = (along: string, stops: unknown, extra: Record<string, unknown> = {}) => ({ gradient: { along, stops, ...extra } });

describe('Baustandard W2: Themes im Repo', () => {
  it('keine Hinweise zu W4/W5/W7/D1/D3 in allen zwölf Themes (aufgelöst mit Vererbung)', () => {
    const cat = ThemeCatalog.of(repoThemes());
    for (const id of cat.ids()) expect(themeStandardWarnings(cat.get(id)), id).toEqual([]);
    for (const def of repoThemes()) expect(roleStandardWarnings(def), def.id).toEqual([]);
  });

  it('Holz-Themes sind als Holzfeld erkannt (W3: Eckstamm), Stein-Themes nicht', () => {
    const cat = ThemeCatalog.of(repoThemes());
    const wood = cat.ids().filter((id) => isWoodRole(cat.get(id), 'wall_primary'));
    // W13-F (2026-09-28): elven hat jetzt eine Kalzitwand (Stein) statt Birkenbrettern – vorher mit 'elven'
    expect(wood.sort()).toEqual(['farmstead', 'harbor', 'nordic', 'nordic_falu', 'rustic', 'tropical', 'winter']);
  });
});

describe('Baustandard W2: Regeln melden die Befunde der Prüfberichte', () => {
  it('W4: mehr als drei Grundblöcke je Stopp, mehr als vier im Ganzen; Verwitterung zählt nicht', () => {
    const fuenf = [{ family: 'stone_bricks', weight: 35 }, { family: 'cobblestone', weight: 25 }, { family: 'tuff', weight: 15 }, { family: 'tuff_bricks', weight: 5 }, { family: 'cobbled_deepslate', weight: 20 }];
    const w = roleStandardWarnings(theme({ wall_primary: g('facade_h', [{ at: 0, mix: fuenf }, { at: 1, mix: [{ family: 'andesite', weight: 1 }] }]) }));
    expect(w.join('\n')).toMatch(/W4 Materialbudget – Stopp 0 hat 5 Grundblöcke/);
    expect(w.join('\n')).toMatch(/6 Grundblöcke über alle Stopps/);
    // bemooste/rissige Varianten und `mossy_`-Familien sind Verwitterung desselben Grundblocks
    const moos = roleStandardWarnings(theme({ wall_primary: { mix: [
      { family: 'stone_bricks', weight: 6 }, { family: 'stone_bricks', variant: 'mossy', weight: 2 }, { family: 'mossy_stone_bricks', weight: 1 }, { family: 'cracked_stone_bricks', weight: 1 },
    ] } }));
    expect(moos).toEqual([]);
    expect(baseBlockKey({ family: 'mossy_cobblestone', weight: 1 })).toBe(baseBlockKey({ family: 'cobblestone', weight: 1 }));
  });

  it('W4: Stämme als Zufallsblöcke im Bretterfeld (X1 B4: nordic/rustic)', () => {
    const w = roleStandardWarnings(theme({ wall_primary: { mix: [{ family: 'spruce', weight: 6 }, { family: 'spruce', variant: 'log', weight: 3 }] } }));
    expect(w.join('\n')).toMatch(/W4 Stämme als Zufallsblöcke im Bretterfeld/);
    // Bretter zweier Hölzer sind erlaubt
    expect(roleStandardWarnings(theme({ wall_primary: { mix: [{ family: 'spruce', weight: 6 }, { family: 'dark_oak', weight: 3 }] } }))).toEqual([]);
  });

  it('W7: Sockel aus höchstens zwei Grundsteinen', () => {
    const w = roleStandardWarnings(theme({ foundation: { mix: [{ family: 'cobblestone', weight: 4 }, { family: 'andesite', weight: 1 }, { family: 'tuff', weight: 1 }] } }));
    expect(w.join('\n')).toMatch(/W7 Sockel aus 3 Grundsteinen/);
    expect(roleStandardWarnings(theme({ foundation: { mix: [{ family: 'cobblestone', weight: 4 }, { family: 'mossy_cobblestone', weight: 1 }, { family: 'cobbled_deepslate', weight: 1 }] } }))).toEqual([]);
  });

  it('D1: gemischte Dachdeckung ohne Ringe wird gemeldet, ganze Ringe mit höchstens drei Tönen nicht', () => {
    const gemischt = theme({ roof_main: { mix: [{ family: 'deepslate_tiles', weight: 5 }, { family: 'blackstone', weight: 2 }], noise: { type: 'cluster' } } });
    expect(roleStandardWarnings(gemischt).join('\n')).toMatch(/D1 Deckungsrezept – 2 Materialien je Zelle gemischt/);
    const ringe = (n: number) => theme({ roof_main: g('roof_t', [
      { at: 0, mix: [{ family: 'deepslate_tiles', weight: 1 }] },
      { at: 0.5, mix: [{ family: 'deepslate_bricks', weight: 1 }] },
      { at: 1, mix: [{ family: n > 2 ? 'cobbled_deepslate' : 'deepslate_bricks', weight: 1 }, ...(n > 3 ? [{ family: 'polished_deepslate', weight: 1 }] : [])] },
    ], { quantize: 'ring', interpolate: 'step' }) });
    expect(roleStandardWarnings(ringe(3))).toEqual([]);
    expect(roleStandardWarnings(ringe(4)).join('\n')).toMatch(/D1 Deckungsrezept – 4 Töne/);
    // ein einziges Material ist immer ein gültiges Rezept
    expect(roleStandardWarnings(theme({ roof_main: { family: 'spruce' } }))).toEqual([]);
  });

  it('D1: Jitter oder Rauschen neben quantize "ring" sind wirkungslos und werden gemeldet', () => {
    const r = validateThemeDef({ id: 't', name: 'T', roles: { ...minimalRoles, roof_main: { ...g('roof_t', [{ at: 0, mix: [{ family: 'a', weight: 1 }] }, { at: 1, mix: [{ family: 'b', weight: 1 }] }], { quantize: 'ring', jitter: 0.2 }), noise: { type: 'cluster' } } } });
    expect(r.warnings.join('\n')).toMatch(/quantize "ring" wählt je Ring ohne Jitter und Rauschen/);
    expect(validateThemeDef({ id: 't', name: 'T', roles: { ...minimalRoles, roof_main: g('roof_t', [{ at: 0, mix: [{ family: 'a', weight: 1 }] }, { at: 1, mix: [{ family: 'b', weight: 1 }] }], { quantize: 'stripes' }) } }).ok).toBe(false);
  });

  it('D3: Ortgang/Traufe (roof_trim) aus einer Familie der Dachfläche wird gemeldet (X3: rustic Eiche in Eiche)', () => {
    const defs = new Map([['t', theme({ roof_main: g('roof_t', [{ at: 0, mix: [{ family: 'spruce', weight: 1 }] }, { at: 1, mix: [{ family: 'oak', weight: 1 }] }], { quantize: 'ring', interpolate: 'step' }), roof_trim: { family: 'oak' } })]]);
    const r = resolveTheme(defs, 't');
    expect(r.ok && themeStandardWarnings(r.value).join('\n')).toMatch(/D3 Kantenkontrast – roof_trim \(oak\)/);
    // W2-FB: Windbrett/Traufkante auch nicht aus der tragenden Wandfamilie (rustic vorher: Eiche an Eichenwand)
    const wand = resolveTheme(new Map([['t', theme({ wall_primary: { family: 'oak' }, roof_trim: { family: 'oak' } })]]), 't');
    expect(wand.ok && themeStandardWarnings(wand.value).join('\n')).toMatch(/roof_trim \(oak\) ist die tragende Familie der Wand/);
  });

  it('W5: Außenwand-Verlauf je Geschoss (`wall_h`) wird gemeldet, über die Bauwerkshöhe (`facade_h`) nicht', () => {
    // W4 (27.09.2026): Dach aus Tiefenschieferfliesen, damit nur W5 geprüft wird (D9: Eichendach an Steinwand ist zu hell)
    const wand = (along: string) => resolveTheme(new Map([['t', theme({ wall_primary: g(along, [{ at: 0, mix: [{ family: 'cobblestone', weight: 1 }] }, { at: 1, mix: [{ family: 'stone_bricks', weight: 1 }] }]), roof_main: { family: 'deepslate_tiles' } })]]), 't');
    const je = wand('wall_h');
    expect(je.ok && themeStandardWarnings(je.value).join('\n')).toMatch(/W5 wall_primary verläuft je Geschoss/);
    const ganz = wand('facade_h');
    expect(ganz.ok && themeStandardWarnings(ganz.value)).toEqual([]);
  });

  it('D9 (W4, Review M5): Wand und Dach mit zu kleinem Helligkeitsabstand werden gemeldet (nordic vorher: Fichte an Fichte)', () => {
    const def = (wall: unknown, roof: unknown) => resolveTheme(new Map([['t', theme({ wall_primary: wall, roof_main: roof, roof_trim: { family: 'pale_oak' } })]]), 't');
    const fichte = def({ family: 'spruce' }, g('roof_t', [{ at: 0, mix: [{ family: 'spruce', weight: 1 }] }, { at: 0.8, mix: [{ family: 'oak', weight: 1 }] }, { at: 1, mix: [{ family: 'oak', weight: 1 }] }], { quantize: 'ring', interpolate: 'step' }));
    expect(fichte.ok && themeStandardWarnings(fichte.value).join('\n')).toMatch(/D9 Wert-Kontrast – Wand spruce \(L 0.47\) und Dach spruce/);
    // Hauptfamilie nach Fläche: ein schmaler Sockelring zählt nicht wie die ganze Wand
    const ring = g('facade_h', [{ at: 0, mix: [{ family: 'dark_oak', weight: 1 }] }, { at: 0.15, mix: [{ family: 'spruce', weight: 1 }] }, { at: 1, mix: [{ family: 'spruce', weight: 1 }] }], { quantize: 'ring', interpolate: 'step' });
    expect(mainFamily(ring as never)).toBe('spruce');
    const dunkel = def(ring, { family: 'dark_oak' });
    expect(dunkel.ok && themeStandardWarnings(dunkel.value)).toEqual([]);
    // unbekannte Familien werden nicht geprüft
    const fremd = def({ family: 'unbekannt' }, { family: 'spruce' });
    expect(fremd.ok && themeStandardWarnings(fremd.value)).toEqual([]);
  });

  it('D9 Bauwerk (W5, Review W4-R N5): Krone und Wehrgang aus Holz heben sich von der Holzmauer ab; Stein prüft die Regel nicht', () => {
    const dunkel = { family: 'dark_oak' };
    const def = (roles: Record<string, unknown>) => resolveTheme(new Map([['t', theme({ wall_primary: { family: 'spruce' }, roof_main: dunkel, roof_trim: { family: 'pale_oak' }, ...roles })]]), 't');
    // nordic vorher: Wehrgang Fichte an Fichtenmauer, Krone gefleckt (Bretter + Rinde, 0,35 an 0,47)
    const vorher = def({ parapet: { mix: [{ family: 'spruce', weight: 35 }, { family: 'spruce', variant: 'log', weight: 65 }] }, walkway: { family: 'spruce' } });
    const w = vorher.ok ? themeStandardWarnings(vorher.value).join('\n') : '';
    expect(w).toMatch(/D9 Bauwerk – walkway \(L 0.47\) hebt sich nicht von der Holzmauer/);
    // Rinde zählt mit ihrer eigenen Helligkeit: 65 % Fichtenstamm (0,29) + 35 % Bretter (0,47) = 0,35
    expect(roleLightness({ mix: [{ family: 'spruce', weight: 35 }, { family: 'spruce', variant: 'log', weight: 65 }] } as never)).toBeCloseTo(0.353, 2);
    // nachher: Krone aus Stämmen mit Rinde, Wehrgang Eiche
    const nachher = def({ parapet: { mix: [{ family: 'spruce', variant: 'log', weight: 85 }, { family: 'dark_oak', variant: 'log', weight: 15 }] }, walkway: { family: 'oak' } });
    expect(nachher.ok && themeStandardWarnings(nachher.value)).toEqual([]);
    // Stein auf Holz (anderer Farbton) und Stein auf Stein prüft die Regel nicht
    const stein = def({ parapet: { family: 'stone_bricks' }, walkway: { family: 'stone_bricks' } });
    expect(stein.ok && themeStandardWarnings(stein.value)).toEqual([]);
    const mauer = resolveTheme(new Map([['t', theme({ wall_primary: { family: 'stone_bricks' }, roof_main: { family: 'deepslate_tiles' }, roof_trim: { family: 'dark_oak' }, parapet: { family: 'stone_bricks' }, walkway: { family: 'stone_bricks' } })]]), 't');
    expect(mauer.ok && themeStandardWarnings(mauer.value)).toEqual([]);
  });

  it('D3-Ausnahme (W5, Review W4-R N5 „gerahmtes Bild“): Kante im Holzton der Wand nur unter dunklem Dach', () => {
    const def = (roof: string) => resolveTheme(new Map([['t', theme({ wall_primary: { family: 'spruce' }, roof_main: { family: roof }, roof_trim: { family: 'spruce' } })]]), 't');
    // dunkles Dach (dunkle Eiche 0,31) über Fichtenwand: Fichtenkante (0,47) hebt sich vom Dach ab – kein Hinweis
    const dunkel = def('dark_oak');
    expect(dunkel.ok && themeStandardWarnings(dunkel.value)).toEqual([]);
    // helles Dach (Birke 0,76): die Fichtenkante ist dunkler als das Dach – der Wand-Teil von D3 gilt weiter
    const hell = def('birch');
    expect(hell.ok && themeStandardWarnings(hell.value).join('\n')).toMatch(/roof_trim \(spruce\) ist die tragende Familie der Wand/);
    // Steinwand: keine Ausnahme
    const stein = resolveTheme(new Map([['t', theme({ wall_primary: { family: 'stone_bricks' }, roof_main: { family: 'deepslate_tiles' }, roof_trim: { family: 'stone_bricks' } })]]), 't');
    expect(stein.ok && themeStandardWarnings(stein.value).join('\n')).toMatch(/roof_trim \(stone_bricks\) ist die tragende Familie der Wand/);
  });

  it('Holzfamilien: Bretter/Stamm der Plattform, Bambus-Mosaik gehört zum Bambus; Stein nicht', () => {
    expect(['oak', 'spruce', 'crimson', 'bamboo', 'bamboo_mosaic'].every(isWoodFamily)).toBe(true);
    expect(['stone_bricks', 'cobblestone', 'sandstone', 'calcite', 'unbekannt'].some(isWoodFamily)).toBe(false);
  });
});
