/**
 * W5-B (Review W4-R N4, plan/spikes/W5B_burg.md): Module im Material des Themes. Der Bautyp gibt die Familie vor
 * (Burg: `stone`), das Theme das Material – mit `themeMaterial` gilt das Modul des Stils nur, wenn es für dasselbe
 * Wandmaterial gebaut ist wie das Modul des Themes (Katalog-Tags `walls_stone`/`walls_wood`). Ohne das Feld gilt das
 * gewählte Modul immer (bitgleich).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Catalog, ThemeCatalog, isWoodRole, parseComponentDef, parseThemeDef } from '@mcda/catalog';
import { ENTRANCE_MODULES, MODULE_WALL_TAGS, WINDOW_MODULES, entranceModuleComponent, entranceModuleFor, moduleWalls } from '../src/index.js';
import { windowModuleComponent, windowModuleFor } from '../src/windows.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.json5') ? [join(d, n)] : []));
const unwrap = <T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};
const catalog = Catalog.of(walk(join(ROOT, 'components')).map((f) => unwrap(parseComponentDef(readFileSync(f, 'utf8'), f))));
const themes = ThemeCatalog.of(walk(join(ROOT, 'themes')).map((f) => unwrap(parseThemeDef(readFileSync(f, 'utf8'), f))));

describe('W5-B Modulwahl nach Wandmaterial (themeMaterial)', () => {
  it('jedes Fenster- und Eingangsmodul trägt genau ein Wandmaterial-Tag', () => {
    for (const id of WINDOW_MODULES) expect(moduleWalls(catalog, windowModuleComponent(id)), id).toBeDefined();
    for (const id of ENTRANCE_MODULES) expect(moduleWalls(catalog, entranceModuleComponent(id)), id).toBeDefined();
    for (const id of [...WINDOW_MODULES.map(windowModuleComponent), ...ENTRANCE_MODULES.map(entranceModuleComponent)]) {
      const tags = catalog.get(id).tags.filter((t) => Object.values(MODULE_WALL_TAGS).includes(t));
      expect(tags, id).toHaveLength(1);
    }
    expect(moduleWalls(catalog, windowModuleComponent('stone'))).toBe('stone');
    expect(moduleWalls(catalog, entranceModuleComponent('nordic'))).toBe('wood');
  });

  it('das Modul jedes Themes steht für sein Wandmaterial (Tag = isWoodRole der Außenwand), Fenster und Eingang gleich', () => {
    for (const t of themes.ids()) {
      const wood = isWoodRole(themes.get(t), 'wall_primary') ? 'wood' : 'stone';
      expect(moduleWalls(catalog, windowModuleComponent(windowModuleFor(catalog, {}, t))), `Fenster ${t}`).toBe(wood);
      expect(moduleWalls(catalog, entranceModuleComponent(entranceModuleFor(catalog, {}, t))), `Eingang ${t}`).toBe(wood);
    }
  });

  it('Burg (stone + themeMaterial): Stein-Module an Steinwänden, sonst die Module des Themes', () => {
    const castle = { windowModule: 'stone', entranceModule: 'stone', themeMaterial: true } as const;
    for (const t of themes.ids()) {
      const wood = isWoodRole(themes.get(t), 'wall_primary');
      // W6 (27.09.2026): Fenster an Holzwänden aus derselben Familie „wehrhaft“ (`fort`), nicht das Wohnhaus-Modul des Themes
      expect(windowModuleFor(catalog, castle, t), t).toBe(wood ? 'fort' : 'stone');
      expect(entranceModuleFor(catalog, castle, t), t).toBe(wood ? entranceModuleFor(catalog, {}, t) : 'stone');
    }
    expect(entranceModuleFor(catalog, castle, 'nordic')).toBe('nordic');
    expect(entranceModuleFor(catalog, castle, 'rustic')).toBe('cottage');
    expect(entranceModuleFor(catalog, castle, 'medieval')).toBe('stone');
    // Ohne Theme bleibt das Modul des Stils
    expect(windowModuleFor(catalog, castle, undefined)).toBe('stone');
  });

  it('ohne themeMaterial gilt das gewählte Modul immer (bitgleich zu vorher)', () => {
    expect(windowModuleFor(catalog, { windowModule: 'stone' }, 'nordic')).toBe('stone');
    expect(entranceModuleFor(catalog, { entranceModule: 'stone' }, 'rustic')).toBe('stone');
    expect(windowModuleFor(catalog, { windowModule: 'stone', themeMaterial: false }, 'nordic')).toBe('stone');
    // themeMaterial ohne gewähltes Modul: das Modul des Themes
    expect(windowModuleFor(catalog, { themeMaterial: true }, 'nordic')).toBe('nordic');
  });
});

describe('W6-B Modulfamilie „wehrhaft“ (Review W4-R Runde 3: Wachturm rustikal mit Cottage-Läden)', () => {
  it('Stein und Wehrbau Holz bilden eine Familie; das Holzmodul hat weder Läden noch Kästen', () => {
    expect(catalog.get(windowModuleComponent('stone')).tags).toContain('module_fort');
    expect(catalog.get(windowModuleComponent('fort')).tags).toContain('module_fort');
    expect(moduleWalls(catalog, windowModuleComponent('fort'))).toBe('wood');
    const vs = catalog.get(windowModuleComponent('fort')).variants ?? [];
    expect(vs.some((v) => v.id.startsWith('box_'))).toBe(false);
    const jamb = vs.find((v) => v.id === 'jamb');
    expect(Object.values(jamb?.legend ?? {}).map((l) => l.shape)).toEqual(['log']);
    // kein Theme wählt das Modul von sich aus (nur über die Familie oder ausdrücklich)
    for (const t of themes.ids()) expect(windowModuleFor(catalog, {}, t), t).not.toBe('fort');
  });

  it('die Familie greift nur mit themeMaterial und nur an Holzwänden; ausdrücklich `fort` an Steinwänden → Stein', () => {
    const tower = { windowModule: 'stone', themeMaterial: true } as const;
    expect(windowModuleFor(catalog, tower, 'rustic')).toBe('fort');
    expect(windowModuleFor(catalog, tower, 'nordic')).toBe('fort');
    expect(windowModuleFor(catalog, tower, 'medieval')).toBe('stone');
    expect(windowModuleFor(catalog, { windowModule: 'fort', themeMaterial: true }, 'medieval')).toBe('stone');
    expect(windowModuleFor(catalog, { windowModule: 'stone' }, 'rustic')).toBe('stone');
    // Module ohne Familie fallen wie bisher auf das Modul des Themes zurück
    expect(windowModuleFor(catalog, { windowModule: 'townhouse', themeMaterial: true }, 'rustic')).toBe('cottage');
    // Eingangsmodule haben keine Familie: der Eingang bleibt beim Modul des Themes
    expect(entranceModuleFor(catalog, { entranceModule: 'stone', themeMaterial: true }, 'rustic')).toBe('cottage');
  });
});
