/**
 * Bestehender 23er-Satz (E1 „Live-Vergleich“): Live-Tabelle vom 2026-09-24 plus die 10 Praxis-Prompts aus
 * `test/intent.test.ts`. Regressionen des lokalen Klassifikators – keine unabhängige Messung für ihn.
 */
import type { NlCase } from './types.js';

export const REGRESSION: readonly NlCase[] = [
  // Live-Tabelle (E1, 2026-09-24): Bautyp + erwartete Felder
  { prompt: 'kleine Hobbithöhle, Eingang nach Osten', want: { buildingTypeId: 'hobbit', size: 'S', front: 'east' } },
  { prompt: 'a cozy nordic longhouse with a steep roof and no garden', want: { buildingTypeId: 'longhouse', themeId: 'nordic', shell: { roofDetail: { pitch: 'steep' } }, surroundings: false } },
  { prompt: 'Burg mit zwei Türmen und Mauer', want: { buildingTypeId: 'castle_compact' } },
  { prompt: 'Stadthaus im Bauernhof-Stil', want: { buildingTypeId: 'townhouse', themeId: 'farmstead' } },
  { prompt: 'Wikinger-Langhaus', want: { buildingTypeId: 'longhouse' } },
  { prompt: 'Wikingerhaus mit Flachdach', want: { buildingTypeId: 'longhouse', shell: { roof: 'flat' } } },
  { prompt: 'Große mittelalterliche Taverne mit drei Etagen', want: { buildingTypeId: 'tavern', size: 'L', floors: 3, themeId: 'medieval' } },
  { prompt: 'a small medieval watchtower facing north, schematic format', want: { buildingTypeId: 'watchtower', size: 'S', front: 'north', themeId: 'medieval', format: 'schem' } },
  { prompt: 'Fachwerkhaus, rustikal, ohne Deko', want: { buildingTypeId: 'timber', themeId: 'rustic', exterior: { enabled: false } } },
  { prompt: 'unterirdisches Haus mit zwei Stockwerken', want: { buildingTypeId: 'house', floors: 2, setting: { kind: 'buried' } } },
  // W7-L: Häuserzeile ist Entwurf und wird nicht angeboten (Soll wie descriptions.ts: Stadthaus)
  { prompt: 'Reihenhäuser im Stadtstil, seed 7', want: { buildingTypeId: 'townhouse', seed: 7 } },
  { prompt: 'build me something spooky for halloween', want: {} },
  { prompt: 'asdf qwertz 123', want: {} },
  // Praxis-Prompts (test/intent.test.ts)
  { prompt: 'Eine kleine Hobbithöhle, rustikal, Eingang nach Osten, ohne Garten', want: { buildingTypeId: 'hobbit', size: 'S', themeId: 'rustic', front: 'east', surroundings: false } },
  { prompt: 'bau mir eine burg', want: { buildingTypeId: 'castle_compact' } },
  { prompt: 'Große mittelalterliche Taverne mit Flachdach', want: { buildingTypeId: 'tavern', size: 'L', themeId: 'medieval', shell: { roof: 'flat' } } },
  { prompt: 'nordisches Wikinger Langhaus', want: { buildingTypeId: 'longhouse', themeId: 'nordic' } },
  { prompt: 'a small cottage with a hip roof, entrance facing west', want: { buildingTypeId: 'house', shell: { roof: 'hip' }, front: 'west' } },
  { prompt: 'Fachwerkhaus mit zwei Etagen als schematic', want: { buildingTypeId: 'timber', floors: 2, format: 'schem' } },
  { prompt: 'Ein Wachturm aus nordischem Holz, seed 42', want: { buildingTypeId: 'watchtower', seed: 42 } },
  { prompt: 'Bauernhof mit Scheune, viel Deko', want: { buildingTypeId: 'farmhouse', exterior: { density: 2 } } },
  { prompt: 'medieval inn, large, without garden', want: { buildingTypeId: 'tavern', themeId: 'medieval', size: 'L', surroundings: false } },
  { prompt: 'Ein Stadthaus', want: { buildingTypeId: 'townhouse' } },
];
