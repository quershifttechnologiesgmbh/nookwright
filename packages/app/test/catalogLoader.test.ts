import { describe, expect, it } from 'vitest';
import { buildCatalog, catalogRelPath } from '../src/catalogLoader.js';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';

const box = (id: string) => `{ id: "${id}", kind: "static", category: "furniture", tags: ["box"], obtainability: "survival",
  mount: "floor", rotations: "all", layers: [["A"]], legend: { A: { block: "minecraft:barrel" } } }`;
const roomType = `{ id: "cellar", name: "Keller", minArea: 4, coverage: { target: 0.3 },
  required: [{ tags: ["box"], count: [1, 1] }], optional: [] }`;
/** Theme mit allen Pflicht-Rollen (sonst lehnt der ThemeCatalog es ab). */
const fullTheme = (id: string, name: string) => `{ id: "${id}", name: "${name}", roles: {
  floor_primary: { family: "spruce" }, wall_primary: { family: "stone_bricks" }, beam: { family: "dark_oak" },
  door: { family: "spruce" }, window: { family: "glass" }, ceiling: { family: "spruce" }, roof_main: { family: "deepslate_tiles" },
  furniture_wood: { family: "spruce" }, textile_primary: { color: "red" }, light_hanging: { family: "iron" }, metal: { family: "iron" } } }`;

describe('Katalog im Browser laden (import.meta.glob)', () => {
  const load = loadBundledCatalog();

  it('lädt alle Repo-Dateien fehlerfrei', () => {
    expect(load.errors).toEqual([]);
    expect(load.catalog).toBeDefined();
    expect(load.files).toBeGreaterThan(20);
  });

  it('liefert die Theme-Liste für die Auswahl', () => {
    expect(load.themes.map((t) => t.id)).toEqual(expect.arrayContaining(['medieval', 'rustic', 'nordic']));
  });

  it('enthält die MVP-Raumtypen', () => {
    expect(load.catalog!.roomTypeIds()).toEqual(expect.arrayContaining(['bedroom', 'kitchen', 'smithy', 'storage']));
    expect(load.catalog!.byTags(['bed']).length).toBeGreaterThan(0);
  });
});

describe('buildCatalog', () => {
  it('ordnet Dateien nach Ordner zu und prüft id gegen Pfad', () => {
    const r = buildCatalog({
      '../../../catalog/components/test/box.json5': box('test/box'),
      '../../../catalog/components/test/wrong.json5': box('test/other'),
      '../../../catalog/roomtypes/cellar.json5': roomType,
      '../../../catalog/themes/medieval.json5': fullTheme('medieval', 'Mittelalter'),
      '../../../catalog/notes/readme.json5': '{ ignored: true }',
    });
    expect(r.errors).toEqual([]);
    expect(r.catalog?.size).toBe(2);
    expect(r.catalog?.roomTypeIds()).toEqual(['cellar']);
    expect(r.themes).toEqual([{ id: 'medieval', name: 'Mittelalter' }]);
    expect(r.themeCatalog?.get('medieval').roles['beam']).toEqual({ family: 'dark_oak' });
    expect(r.warnings.join('\n')).toContain('passt nicht zum Pfad');
  });

  it('sortiert die Theme-Auswahl: klassische vier zuerst, dann alphabetisch (Review 3)', () => {
    const r = buildCatalog({
      '../../../catalog/components/test/box.json5': box('test/box'),
      '../../../catalog/roomtypes/cellar.json5': roomType,
      '../../../catalog/themes/winter.json5': fullTheme('winter', 'Winter'),
      '../../../catalog/themes/medieval.json5': fullTheme('medieval', 'Mittelalter'),
      '../../../catalog/themes/zwerg.json5': fullTheme('zwerg', 'Zwergisch'),
      '../../../catalog/themes/bauernhof.json5': fullTheme('bauernhof', 'Bauernhof'),
      '../../../catalog/themes/rustic.json5': fullTheme('rustic', 'Rustikal'),
    });
    expect(r.errors).toEqual([]);
    // „Mittelalter“ und „Rustikal“ stehen vorn (klassische Reihe), der Rest folgt nach Anzeigename:
    // Bauernhof < Winter < Zwergisch.
    expect(r.themes.map((t) => t.id)).toEqual(['medieval', 'rustic', 'bauernhof', 'winter', 'zwerg']);
  });

  it('ThemeCatalog: Vererbung aufgelöst; ungültige Themes fallen heraus und werden gemeldet', () => {
    const r = buildCatalog({
      'catalog/components/test/box.json5': box('test/box'),
      'catalog/roomtypes/cellar.json5': roomType,
      'catalog/themes/medieval.json5': fullTheme('medieval', 'Mittelalter'),
      'catalog/themes/nordic.json5': '{ id: "nordic", name: "Nordisch", base: "medieval", roles: { wall_primary: { family: "spruce" } } }',
      'catalog/themes/broken.json5': '{ id: "broken", name: "Kaputt", roles: { beam: { family: "oak" } } }',
      'catalog/themes/orphan.json5': '{ id: "orphan", name: "Waise", base: "broken", roles: { beam: { family: "oak" } } }',
    });
    expect(r.catalog).toBeDefined();
    expect(r.themes).toEqual([
      { id: 'medieval', name: 'Mittelalter' },
      { id: 'nordic', name: 'Nordisch' },
    ]);
    expect(r.themeCatalog?.get('nordic').roles['roof_main']).toEqual({ family: 'deepslate_tiles' });
    expect(r.errors.join('\n')).toContain('broken: Pflicht-Rollen fehlen');
    expect(r.errors.join('\n')).toContain('orphan');
  });

  it('meldet fehlerhafte Dateien sichtbar und behält den Rest', () => {
    const r = buildCatalog({
      'catalog/components/test/box.json5': box('test/box'),
      'catalog/components/test/broken.json5': '{ id: "test/broken", ',
      'catalog/roomtypes/cellar.json5': roomType,
    });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('components/test/broken.json5');
    expect(r.catalog?.size).toBe(1);
  });

  it('doppelte IDs verhindern den Katalog', () => {
    const r = buildCatalog({
      'catalog/components/a/box.json5': box('test/box'),
      'catalog/components/b/box.json5': box('test/box'),
      'catalog/roomtypes/cellar.json5': roomType,
    });
    expect(r.catalog).toBeUndefined();
    expect(r.errors.join()).toContain('doppelt');
  });

  it('meldet Raumtyp-Tags ohne Komponente als Hinweis', () => {
    const r = buildCatalog({ 'catalog/roomtypes/cellar.json5': roomType });
    expect(r.warnings.join()).toContain('keine Komponente für Tags box');
  });

  it('relativer Katalogpfad', () => {
    expect(catalogRelPath('../../../catalog/components/bed/single.json5')).toBe('components/bed/single.json5');
    expect(catalogRelPath('C:\\repo\\catalog\\roomtypes\\x.json5')).toBe('roomtypes/x.json5');
  });
});
