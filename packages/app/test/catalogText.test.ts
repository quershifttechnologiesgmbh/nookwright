/**
 * W7-H: Der Build bündelt die Katalogtexte als kompaktes JSON (`compactJson5`, Plugin in vite.config.ts). Der Lader
 * muss daraus exakt dasselbe lesen wie aus den Originaldateien (Dev-Server, Vitest).
 */
import {
  parseBuildingTypeDef, parseComponentDef, parsePaletteDef, parseRoomTypeDef, parseThemeDef,
} from '@mcda/catalog';
import { parseTerrainStyle } from '@mcda/terrain';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { CATALOG_FILES } from '../src/adapters/browserContext.js';
import { compactJson5, isCatalogTextId } from '../src/adapters/catalogText.js';
import { buildCatalog, catalogRelPath } from '../src/catalogLoader.js';

const PARSERS: ReadonlyArray<readonly [string, (text: string, source: string) => unknown]> = [
  ['components/', parseComponentDef], ['roomtypes/', parseRoomTypeDef], ['themes/', parseThemeDef],
  ['palettes/', parsePaletteDef], ['buildingtypes/', parseBuildingTypeDef], ['terrain/', parseTerrainStyle],
];

describe('compactJson5', () => {
  it('Kommentare, Einrückung, Schlüssel ohne Anführungszeichen, Komma am Ende → kompaktes JSON mit gleichem Wert', () => {
    const text = `// Kopf\n{\n  id: 'bett', /* Block */ size: [1, 2,],\n  "name": "Bett \\u00e4",\n  hex: 0x10, half: .5, plus: +1,\n  multi: 'a\\\nb',\n}\n`;
    const out = compactJson5(text);
    expect(out).toBe('{"id":"bett","size":[1,2],"name":"Bett ä","hex":16,"half":0.5,"plus":1,"multi":"ab"}');
    expect(JSON5.parse(out)).toEqual(JSON5.parse(text));
  });
  it('unlesbar oder nicht als JSON darstellbar (NaN, Infinity, -0) → Originaltext', () => {
    for (const text of ['{ id: ', '{ a: NaN, b: 1 }', '{ a: Infinity }', '{ a: -Infinity }', '{ a: -0 }', '[1, 2, -0]']) {
      expect(compactJson5(text), text).toBe(text);
    }
  });
  it('schon kompakt → unverändert; Schlüsselreihenfolge bleibt', () => {
    expect(compactJson5('{"b":1,"a":2}')).toBe('{"b":1,"a":2}');
    expect(compactJson5('{ b: 1, a: [ { z: 1, y: 2 } ] }')).toBe('{"b":1,"a":[{"z":1,"y":2}]}');
  });
});

describe('isCatalogTextId', () => {
  const dir = '/repo/catalog/';
  it('nur ?raw-Importe von .json5 unter catalog/', () => {
    expect(isCatalogTextId('/repo/catalog/components/bed/single.json5?raw', dir)).toBe(true);
    expect(isCatalogTextId('/repo/catalog/themes/nordic.json5?import&raw', dir)).toBe(true);
    expect(isCatalogTextId('C:\\repo\\catalog\\themes\\nordic.json5?raw', 'C:\\repo\\catalog\\')).toBe(true);
    expect(isCatalogTextId('/repo/catalog/components/bed/single.json5', dir)).toBe(false);
    expect(isCatalogTextId('/repo/catalog/components/bed/single.json5?url', dir)).toBe(false);
    expect(isCatalogTextId('/repo/catalog/README.md?raw', dir)).toBe(false);
    expect(isCatalogTextId('/repo/packages/platform/data/x.json5?raw', dir)).toBe(false);
    expect(isCatalogTextId('/repo/catalogue/x.json5?raw', dir)).toBe(false);
  });
});

describe('ganzer Katalog: kompakt gebündelt == Originaltext', () => {
  const compact = Object.fromEntries(Object.entries(CATALOG_FILES).map(([p, t]) => [p, compactJson5(t)]));

  it('jede Datei: gleiches Ergebnis des Parsers (Wert, Fehler, Warnungen), deutlich kleiner', () => {
    let raw = 0;
    let small = 0;
    for (const [path, text] of Object.entries(CATALOG_FILES)) {
      const rel = catalogRelPath(path);
      raw += text.length;
      small += compact[path]!.length;
      const parse = PARSERS.find(([prefix]) => rel.startsWith(prefix))?.[1];
      if (parse === undefined) continue;
      expect(parse(compact[path]!, rel), rel).toEqual(parse(text, rel));
    }
    expect(Object.keys(CATALOG_FILES).length).toBeGreaterThan(400);
    // gemessen 1 003 → 546 KiB; Puffer für künftige Dateien
    expect(small / raw).toBeLessThan(0.65);
  });

  it('Katalog, Themes, Paletten, Bautypen und Meldungen gleich', () => {
    const a = buildCatalog(CATALOG_FILES);
    const b = buildCatalog(compact);
    expect(b.errors).toEqual(a.errors);
    expect(b.warnings).toEqual(a.warnings);
    expect(b.files).toBe(a.files);
    expect(b.themes).toEqual(a.themes);
    expect(b.palettes).toEqual(a.palettes);
    expect(b.buildingTypes.ids()).toEqual(a.buildingTypes.ids());
    for (const id of a.buildingTypes.ids()) expect(b.buildingTypes.get(id), id).toEqual(a.buildingTypes.get(id));
    expect(b.catalog!.roomTypeIds()).toEqual(a.catalog!.roomTypeIds());
    for (const id of a.themeCatalog!.ids()) expect(b.themeCatalog!.get(id), id).toEqual(a.themeCatalog!.get(id));
  });
});
