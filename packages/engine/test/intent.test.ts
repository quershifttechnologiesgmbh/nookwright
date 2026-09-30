/** Lokaler Klassifikator und synthetischer Datensatz: Gültigkeit, Genauigkeit, handgeschriebene Praxis-Prompts. */
import { describe, expect, it } from 'vitest';
import { classifyLocal, syntheticDataset } from '../src/index.js';
import { FANTASY_KITS } from '@mcda/exterior';
import { FANTASY_THEMES, FANTASY_WORDS, LOCAL_CONFIDENCE, MOOD_THEMES, SAFE_MODIFIERS, TYPE_CONFIDENCE_MIN, normalize } from '../src/intent/local.js';
import { engine } from './fixture.js';

const v = engine.vocabulary;
const canon = (x: unknown): string => JSON.stringify(x, (_k, y: unknown) =>
  (y !== null && typeof y === 'object' && !Array.isArray(y) ? Object.fromEntries(Object.entries(y).sort(([a], [b]) => a.localeCompare(b))) : y));

describe('synthetischer Datensatz', () => {
  const rows = syntheticDataset(v, 600, 7);
  it('deterministisch und jede Anfrage schema-gültig', () => {
    expect(syntheticDataset(v, 50, 7)).toEqual(rows.slice(0, 50));
    for (const r of rows) expect(engine.validate(r.request), r.prompt).toEqual([]);
    expect(new Set(rows.map((r) => (r.request.input as { buildingTypeId: string }).buildingTypeId)).size).toBeGreaterThan(8);
  });

  it('lokaler Klassifikator: Bautyp ≥ 97 %, alle Felder exakt ≥ 85 %', () => {
    let type = 0;
    let exact = 0;
    const misses: string[] = [];
    for (const r of rows) {
      const got = classifyLocal(r.prompt, v).request.input as Record<string, unknown>;
      const want = r.request.input as Record<string, unknown>;
      if (got['buildingTypeId'] === want['buildingTypeId']) type++;
      if (canon(got) === canon(want)) exact++;
      else if (misses.length < 5) misses.push(`${r.prompt}\n  want ${canon(want)}\n  got  ${canon(got)}`);
    }
    expect(type / rows.length, misses.join('\n')).toBeGreaterThanOrEqual(0.97);
    expect(exact / rows.length, misses.join('\n')).toBeGreaterThanOrEqual(0.85);
  });
});

describe('Praxis-Prompts (handgeschrieben)', () => {
  const CASES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['Eine kleine Hobbithöhle, rustikal, Eingang nach Osten, ohne Garten', { buildingTypeId: 'hobbit', size: 'S', themeId: 'rustic', front: 'east', surroundings: false }],
    ['bau mir eine burg', { buildingTypeId: 'castle_compact' }],
    ['Große mittelalterliche Taverne mit Flachdach', { buildingTypeId: 'tavern', size: 'L', themeId: 'medieval', shell: { roof: 'flat' } }],
    ['nordisches Wikinger Langhaus', { buildingTypeId: 'longhouse', themeId: 'nordic' }],
    ['a small cottage with a hip roof, entrance facing west', { buildingTypeId: 'house', shell: { roof: 'hip' }, front: 'west' }],
    ['Fachwerkhaus mit zwei Etagen als schematic', { buildingTypeId: 'timber', floors: 2, format: 'schem' }],
    ['Ein Wachturm aus nordischem Holz, seed 42', { buildingTypeId: 'watchtower', seed: 42 }],
    ['Bauernhof mit Scheune, viel Deko', { buildingTypeId: 'farmhouse', exterior: { density: 2 } }],
    ['medieval inn, large, without garden', { buildingTypeId: 'tavern', themeId: 'medieval', size: 'L', surroundings: false }],
    ['Ein Stadthaus', { buildingTypeId: 'townhouse' }],
    // Funktionsgrad (W2-1)
    ['Ein Redstone-Haus als Taverne', { buildingTypeId: 'tavern', functionLevel: 'rich' }],
    ['Langhaus mit funktionalen Anlagen', { buildingTypeId: 'longhouse', functionLevel: 'some' }],
    ['a fully functional farmhouse', { buildingTypeId: 'farmhouse', functionLevel: 'rich' }],
    // Geländeform (feat/gelaende)
    ['Bauernhaus auf terrassiertem Gelände', { buildingTypeId: 'farmhouse', landform: 'dramatic' }],
    ['hügelige Taverne mit Teich', { buildingTypeId: 'tavern', landform: 'natural' }],
    ['a cottage on hilly terrain', { buildingTypeId: 'house', landform: 'natural' }],
  ];
  for (const [prompt, want] of CASES) {
    it(prompt, () => {
      const r = classifyLocal(prompt, v);
      expect(r.request.input).toMatchObject(want);
      expect(engine.validate(r.request)).toEqual([]);
    });
  }

  it('ohne Wunsch nach Landschaft setzt der lokale Klassifikator keine Geländeform', () => {
    for (const prompt of ['Ein Stadthaus', 'Taverne mit Flachdach', 'bau mir eine burg']) {
      expect(classifyLocal(prompt, v).request.input, prompt).not.toHaveProperty('landform');
    }
  });

  it('ohne Wunsch nach Funktionen setzt der lokale Klassifikator keinen Funktionsgrad', () => {
    for (const prompt of ['Ein Stadthaus', 'Taverne mit Flachdach', 'bau mir eine burg']) {
      expect(classifyLocal(prompt, v).request.input, prompt).not.toHaveProperty('functionLevel');
    }
  });

  // Exakt (keine Zusatzfelder): Regressionen nach dem Merge von feat/profi-welle-a (Theme farmstead „Bauernhof“).
  const EXACT: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['Haus mit Mansarddach', { buildingTypeId: 'house', shell: { roof: 'mansard' } }],
    ['zweistöckiges Haus', { buildingTypeId: 'twostory' }],
    ['two story house, with three floors', { buildingTypeId: 'twostory', floors: 3 }],
    ['zweistöckige Taverne', { buildingTypeId: 'tavern', floors: 2 }],
    ['Bauernhof', { buildingTypeId: 'farmhouse' }],
    ['rustikaler Bauernhof', { buildingTypeId: 'farmhouse', themeId: 'rustic' }],
    // Befunde Live-Test 2026-09-24 (LLM vs. lokal): Theme-Wort nur als Teil des Bautyp-Worts, Stil-Angaben, Beugung
    ['Wikinger-Langhaus', { buildingTypeId: 'longhouse' }],
    ['Wikingerhaus mit Flachdach', { buildingTypeId: 'longhouse', shell: { roof: 'flat' } }],
    ['viking longhouse', { buildingTypeId: 'longhouse' }],
    ['Wikinger-Burg', { buildingTypeId: 'castle_compact', themeId: 'nordic' }],
    ['Stadthaus im Bauernhof-Stil', { buildingTypeId: 'townhouse', themeId: 'farmstead' }],
    ['Stadthaus im Bauernhof-Stil mit zwei Etagen', { buildingTypeId: 'townhouse', themeId: 'farmstead', floors: 2 }],
    ['Stadthaus im Stil eines Bauernhofs', { buildingTypeId: 'townhouse', themeId: 'farmstead' }],
    ['farmhouse style townhouse', { buildingTypeId: 'townhouse', themeId: 'farmstead' }],
    ['unterirdisches Haus mit zwei Stockwerken', { buildingTypeId: 'house', floors: 2, setting: { kind: 'buried' } }],
    ['a cozy nordic longhouse with a steep roof and no garden',
      { buildingTypeId: 'longhouse', themeId: 'nordic', shell: { roofDetail: { pitch: 'steep' } }, surroundings: false }],
  ];
  for (const [prompt, want] of EXACT) {
    it(`exakt: ${prompt}`, () => {
      expect(classifyLocal(prompt, v).request.input).toEqual(want);
    });
  }

  it('ohne erkannten Bautyp: Haus mit geringer Sicherheit', () => {
    const r = classifyLocal('irgendwas Schönes bitte', v);
    expect(r.request.input).toMatchObject({ buildingTypeId: 'house' });
    expect(r.confidence).toBeLessThan(0.5);
  });
});

/**
 * W1-G (Befund S2): Deutsche Komposita tragen die Gebäudeart am Wortende („Zwergenfestung“, „Leuchtturm“). Der
 * Klassifikator erkennt den Kopf (≥ 4 Zeichen, Bestimmungswort ≥ 3 Buchstaben) mit geringerer Sicherheit (0,8) – ganze
 * Wörter und Wortanfänge gewinnen bei gleicher Länge (Längenvorrang), bestehende Treffer bleiben gleich.
 */
describe('Komposita mit Kopf am Wortende', () => {
  const HEADS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['Zwergenfestung tief im Berg', { buildingTypeId: 'castle_compact', themeId: 'dwarven' }],
    ['Leuchtturm an der Küste', { buildingTypeId: 'watchtower', themeId: 'harbor' }],
    ['eine Festhalle für Bankette', { buildingTypeId: 'hall' }],
    ['kleine Dorfschenke', { buildingTypeId: 'tavern', size: 'S' }],
    ['Steinturm am Hang', { buildingTypeId: 'watchtower' }],
  ];
  for (const [prompt, want] of HEADS) {
    it(`Kopf mit unbedenklichem Bestimmungswort sicher erkannt: ${prompt}`, () => {
      const r = classifyLocal(prompt, v);
      expect(r.request.input).toMatchObject(want);
      expect(r.confidence).toBe(LOCAL_CONFIDENCE.compound);
      expect(r.confidence).toBeGreaterThanOrEqual(TYPE_CONFIDENCE_MIN);
      expect(r.matched.some((m) => /^bautyp:[a-z]+…/.test(m))).toBe(true);
      expect(engine.validate(r.request)).toEqual([]);
    });
  }

  // Review R2-03: das Bestimmungswort macht den Bau zu etwas anderem → nur Vermutung, unter der Schwelle
  const UNSURE: ReadonlyArray<readonly [string, string]> = [
    ['Kirche mit Glockenturm', 'watchtower'], ['Fernsehturm', 'watchtower'], ['Wasserturm', 'watchtower'],
    ['Turnhalle', 'hall'], ['Schwimmhalle', 'hall'], ['Bahnhofshalle', 'hall'], ['Hundehütte', 'house'], ['Elfen-Baumhaus im Wald', 'house'],
  ];
  for (const [prompt, guess] of UNSURE) {
    it(`Kopf mit fremdem Bestimmungswort bleibt unsicher: ${prompt}`, () => {
      const r = classifyLocal(prompt, v);
      expect((r.request.input as { buildingTypeId: string }).buildingTypeId).toBe(guess);
      expect(r.confidence).toBe(LOCAL_CONFIDENCE.compoundUnknown);
      expect(r.confidence).toBeLessThan(TYPE_CONFIDENCE_MIN);
    });
  }

  it('Liste der unbedenklichen Bestimmungswörter: normalisiert, ohne die Fehltreffer des Reviews', () => {
    for (const m of SAFE_MODIFIERS) expect(normalize(m).trim(), m).toBe(m);
    for (const bad of ['glocken', 'fernseh', 'wasser', 'turn', 'schwimm', 'bahnhofs', 'hunde', 'baum']) expect(SAFE_MODIFIERS.has(bad), bad).toBe(false);
    expect(LOCAL_CONFIDENCE.compound).toBeGreaterThanOrEqual(TYPE_CONFIDENCE_MIN);
    expect(LOCAL_CONFIDENCE.compoundUnknown).toBeLessThan(TYPE_CONFIDENCE_MIN);
  });

  it('Längenvorrang: genannte Wörter und längere Köpfe bleiben (Sicherheit 1 bzw. spezifischer Typ)', () => {
    const cases: ReadonlyArray<readonly [string, string, number]> = [
      ['Bauernhaus', 'farmhouse', 1], ['Gasthaus am Markt', 'tavern', 1], ['Wachturm', 'watchtower', 1], ['Aussichtsturm', 'watchtower', 1],
      ['Haus mit Glockenturm', 'house', 1], ['Burg mit Leuchtturm', 'castle_compact', 1], ['Wikingerlanghaus', 'longhouse', LOCAL_CONFIDENCE.compound],
      ['Hobbithöhle', 'hobbit', 1], ['Fachwerkhaus', 'timber', 1],
    ];
    for (const [prompt, id, conf] of cases) {
      const r = classifyLocal(prompt, v);
      expect((r.request.input as { buildingTypeId: string }).buildingTypeId, prompt).toBe(id);
      expect(r.confidence, prompt).toBe(conf);
    }
  });

  it('kein Kopf: zu kurzes Bestimmungswort („shall“ ist keine Halle), Unsinn bleibt unsicher', () => {
    expect(classifyLocal('it shall be cozy', v).confidence).toBe(LOCAL_CONFIDENCE.assumed);
    expect(classifyLocal('asdf qwer zxcv', v).confidence).toBe(LOCAL_CONFIDENCE.assumed);
    expect(classifyLocal('Schmiede mit Esse und Amboss', v).confidence).toBe(LOCAL_CONFIDENCE.assumed);
    expect(classifyLocal('tiny winter cabin in the snow', v)).toMatchObject({ confidence: 1, request: { input: { buildingTypeId: 'house', themeId: 'winter' } } });
  });
});

/**
 * W7-E (Nutzer-Feedback 26.09.): Stimmungswörter → Theme, alle Lagen, Nutzungszustand, Tippfehler, Fantasy-Akzent.
 * Der Testsatz mit Soll und Trefferquote steht in `descriptions.test.ts`; hier die Einzelregeln.
 */
describe('Stimmung, Lage, Zustand, Tippfehler (W7-E)', () => {
  const input = (p: string): Record<string, unknown> => classifyLocal(p, v).request.input as Record<string, unknown>;

  it('Stimmungswörter → Theme des Katalogs', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['ein gemütliches Haus', 'rustic'], ['cozy cottage', 'rustic'], ['verwunschenes Häuschen im Wald', 'elven'],
      ['Fantasy-Turm', 'elven'], ['dark fantasy fortress', 'dwarven'], ['düstere Burg', 'ruin'], ['spooky house', 'ruin'],
      ['winterliche Hütte', 'winter'], ['Taverne im Schnee', 'winter'], ['orientalischer Palast', 'desert'], ['Burg am Meer', 'harbor'],
      ['Blockhütte aus Fichtenholz', 'nordic'], ['Haus im Dschungel', 'tropical'],
    ];
    for (const [p, theme] of cases) expect(input(p)['themeId'], p).toBe(theme);
    for (const id of Object.keys(MOOD_THEMES)) expect(v.themes.some((t) => t.id === id), id).toBe(true);
  });

  it('ausdrückliches Theme schlägt die Stimmung; verneinte Stimmung zählt nicht; „dunkle Eiche“ ist kein Theme', () => {
    // „Nordisches Langhaus“ ist der Name des Bautyps: kein eigenes Theme, gebaut wird dessen Theme nordic
    expect(input('gemütliches nordisches Langhaus')['themeId']).toBeUndefined();
    expect(input('gemütliches Wikinger-Langhaus')['themeId']).toBeUndefined();
    expect(input('gemütliche nordische Burg')['themeId']).toBe('nordic');
    expect(input('düstere Burg im Fachwerkstil')['themeId']).toBe('timber');
    expect(input('Haus, bitte nicht düster')['themeId']).toBeUndefined();
    expect(input('Haus aus dunkler Eiche')['themeId']).toBeUndefined();
    expect(input('a house with dark oak walls')['themeId']).toBeUndefined();
  });

  it('alle Lagen des Vokabulars, der Hobbit bleibt im Hügel', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['Haus unter der Erde', 'buried'], ['Unterwasser-Haus', 'underwater'], ['Pfahlbau am See', 'stilts'], ['elven house up in a tree', 'tree'],
      ['Zwergenfestung tief im Berg', 'carved'], ['dwarven hall carved into the mountain', 'carved'], ['düstere Burg auf einem Felsen', 'cliff'],
      ['Steinturm am Hang', 'cliff'], ['Hütte am Fluss', 'water'], ['tavern by the lake', 'water'],
    ];
    for (const [p, kind] of cases) expect(input(p)['setting'], p).toEqual({ kind });
    expect(input('Erdhaus im Hang wie bei Herr der Ringe')).toEqual({ buildingTypeId: 'hobbit' });
    for (const [p] of cases) expect(engine.validate(classifyLocal(p, v).request), p).toEqual([]);
  });

  it('Nutzungszustand (storyState)', () => {
    expect(input('verfallene Ruine eines Wachturms')['storyState']).toBe('verfallen');
    expect(input('a haunted mansion')['storyState']).toBe('verlassen');
    expect(input('verlassenes Bauernhaus')['storyState']).toBe('verlassen');
    expect(input('belagerte Burg')['storyState']).toBe('belagert');
    expect(input('brandneues Stadthaus')['storyState']).toBe('neu');
    expect(input('ein neues Haus')['storyState']).toBeUndefined();
  });

  it('Tippfehler im Bautyp: sicher genug, aber unter „genannt“; nur ab 6 Buchstaben und gleichem Anfang', () => {
    const r = classifyLocal('Tarverne im Dorf', v);
    expect(r.request.input).toMatchObject({ buildingTypeId: 'tavern' });
    expect(r.confidence).toBe(LOCAL_CONFIDENCE.typo);
    expect(r.confidence).toBeGreaterThanOrEqual(TYPE_CONFIDENCE_MIN);
    expect(classifyLocal('a house in a cavern', v).request.input).toMatchObject({ buildingTypeId: 'house' });
    expect(classifyLocal('Landhaus', v).request.input).toMatchObject({ buildingTypeId: 'house' });
    expect(classifyLocal('asdf qwer zxcv', v).confidence).toBe(LOCAL_CONFIDENCE.assumed);
  });

  it('Verkleinerung und Komposita mit unbedenklichem Bestimmungswort', () => {
    for (const [p, id] of [['Häuschen', 'house'], ['Strandhütte', 'house'], ['Magierturm', 'watchtower'], ['Blockhütte', 'house']] as const) {
      const r = classifyLocal(p, v);
      expect(r.request.input, p).toMatchObject({ buildingTypeId: id });
      expect(r.confidence, p).toBeGreaterThanOrEqual(TYPE_CONFIDENCE_MIN);
    }
  });

  it('Fantasy-Akzent: in accent/matched; W7-D: in der Anfrage als exterior.fantasy = accent, außer bei Fantasy-Themes', () => {
    const r = classifyLocal('Fantasy-Turm für einen Magier', v);
    expect(r.accent).toBe('fantasy');
    expect(r.matched).toContain('akzent:fantasy');
    // W7-D (27.09.2026): die Stimmung wählt schon das Theme elven – dessen Kit ist ohne Angabe voll, kein Feld nötig
    expect(r.request.input).toMatchObject({ themeId: 'elven' });
    expect((r.request.input as { exterior?: unknown }).exterior).toBeUndefined();
    // ausdrückliches anderes Theme: Fantasy-Stufe „Akzent“ in der Anfrage (Rest der Außen-Deko bleibt)
    expect(classifyLocal('magische Taverne im Wüstenstil', v).request.input).toMatchObject({ themeId: 'desert', exterior: { fantasy: 'accent' } });
    expect(classifyLocal('verwunschenes nordisches Langhaus mit viel Deko', v).request.input)
      .toMatchObject({ buildingTypeId: 'longhouse', exterior: { density: 2, fantasy: 'accent' } });
    // Außen-Deko aus: keine Fantasy-Stufe
    expect((classifyLocal('magisches Stadthaus ohne Deko', v).request.input as { exterior?: unknown }).exterior).toEqual({ enabled: false });
    expect(classifyLocal('Stadthaus', v).accent).toBeUndefined();
    expect(JSON.stringify(classifyLocal('Stadthaus', v).request)).not.toContain('fantasy');
    for (const w of FANTASY_WORDS) expect(normalize(w).trim(), w).toBe(w);
    // die Liste der Fantasy-Themes des Klassifikators ist die der Kits (Kit gleichen Namens wie das Theme)
    expect([...FANTASY_THEMES]).toEqual([...FANTASY_KITS]);
  });
});
