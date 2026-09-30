/**
 * „Beschreibe dein Gebäude“ (C3): Freitext → Engine-Server (`/v1/interpret`) oder lokaler Klassifikator → Parameter des
 * Bautyp-Assistenten → derselbe Übernahme-Weg wie von Hand (`proposal`, `typeSession`). Ohne Netz: `fetch` ist eine Attrappe.
 */
import { describe, expect, it } from 'vitest';
import { TYPE_CONFIDENCE_MIN, vocabularyOf } from '@mcda/engine/intent';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import {
  ENGINE_PROXY_PATH, SOURCE_NOTES, UNCERTAIN_TYPE_TEXT, confidenceText, describeBuilding, describeOutcome, engineBaseUrl, sourceText, suggestionFor, typeConfidence,
  withLocalConfidence,
} from '../src/nlPrompt.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types };
const themeIds = ctx.themes.ids();
const vocabulary = vocabularyOf({ ...ctx, buildingTypes: types } as unknown as Parameters<typeof vocabularyOf>[0]);
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });

type Call = { url: string; body: unknown };
const server = (status: number, body: unknown, calls: Call[] = []): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
const down: typeof fetch = (async () => {
  throw new TypeError('Failed to fetch');
}) as typeof fetch;

describe('Basis-URL', () => {
  it('Proxy der App als Standard, sonst VITE_ENGINE_URL ohne Schrägstrich am Ende', () => {
    expect(engineBaseUrl({})).toBe(ENGINE_PROXY_PATH);
    expect(engineBaseUrl({ VITE_ENGINE_URL: ' ' })).toBe(ENGINE_PROXY_PATH);
    expect(engineBaseUrl({ VITE_ENGINE_URL: 'http://127.0.0.1:8787/' })).toBe('http://127.0.0.1:8787');
  });

  it('relativ (W1): gebauter Editor unter /editor/ mit VITE_ENGINE_URL=.. ruft /v1/interpret desselben Ursprungs', async () => {
    // so löst fetch im Browser relative Adressen auf: gegen die Adresse der Seite
    const page = 'https://nookwright.example/editor/index.html?embed=1';
    for (const env of ['..', '../', ' .. ']) {
      const base = engineBaseUrl({ VITE_ENGINE_URL: env });
      expect(base).toBe('..');
      expect(new URL(`${base}/v1/interpret`, page).href).toBe('https://nookwright.example/v1/interpret');
    }
    // Vite-Dev: Proxy /engine → Engine-Server
    expect(new URL(`${engineBaseUrl({})}/v1/interpret`, 'http://localhost:5173/').pathname).toBe('/engine/v1/interpret');
    // Wurzel desselben Ursprungs
    expect(new URL(`${engineBaseUrl({ VITE_ENGINE_URL: '/' })}/v1/interpret`, page).href).toBe('https://nookwright.example/v1/interpret');
    // und describeBuilding fragt genau diese Adresse
    const calls: Call[] = [];
    await describeBuilding('Taverne', { baseUrl: engineBaseUrl({ VITE_ENGINE_URL: '..' }), vocabulary, fetch: server(200, { ok: true, request: { op: 'building_generate', input: { buildingTypeId: 'tavern' } }, model: 'typesafe/jev-1.13' }, calls) });
    expect(calls.map((c) => c.url)).toEqual(['../v1/interpret']);
  });
});

describe('Quelle der Erkennung in Nutzersprache (A3)', () => {
  it('JEV mit Modell-ID ohne Datumsanhang, Kev, andere Modelle, Server-lokal, Browser', () => {
    expect(sourceText({ source: 'server', model: 'typesafe/jev-1.13-20260917' })).toBe('Erkannt mit JEV (typesafe/jev-1.13)');
    expect(sourceText({ source: 'server', model: 'jev-1.13' })).toBe('Erkannt mit JEV (jev-1.13)');
    expect(sourceText({ source: 'server', model: 'kev-latest' })).toBe('Erkannt mit Kev (kev-latest)');
    expect(sourceText({ source: 'server', model: 'openai/gpt-oss-20b' })).toBe('Erkannt mit Sprachmodell (openai/gpt-oss-20b)');
    expect(sourceText({ source: 'server', model: 'local' })).toBe(SOURCE_NOTES.serverLocal);
    expect(sourceText({ source: 'server' })).toBe('Vom KI-Server erkannt');
    expect(sourceText({ source: 'local' })).toBe('Im Browser erkannt');
    expect(sourceText({ source: 'local', note: SOURCE_NOTES.unreachable })).toBe('KI-Server nicht erreichbar – im Browser erkannt');
  });
});

describe('describeBuilding: Server, sonst lokal', () => {
  const request = { op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'L', floors: 3 } };

  it('Server erreichbar: Anfrage des Modells, nur der Prompt geht hinaus', async () => {
    const calls: Call[] = [];
    const it = await describeBuilding('  große Taverne  ', { baseUrl: '/engine', vocabulary, fetch: server(200, { ok: true, request, model: 'openai/gpt-oss-20b' }, calls) });
    expect(it).toMatchObject({ source: 'server', request, model: 'openai/gpt-oss-20b' });
    expect(it.note).toBeUndefined();
    expect(calls).toEqual([{ url: '/engine/v1/interpret', body: { prompt: 'große Taverne' } }]);
  });

  it('JEV: Modell und Konfidenz je Feld kommen durch (Tooltip-Text)', async () => {
    const it = await describeBuilding('große Taverne', {
      baseUrl: '', vocabulary, fetch: server(200, { ok: true, request, model: 'typesafe/jev-1.13-20260917', confidence: { buildingTypeId: 1, size: 0.97, bad: 'x' } }),
    });
    expect(it).toMatchObject({ source: 'server', model: 'typesafe/jev-1.13-20260917', confidence: { buildingTypeId: 1, size: 0.97 } });
    expect(it.confidence).not.toHaveProperty('bad');
    expect(confidenceText(it.confidence)).toBe('buildingTypeId 1,00 · size 0,97');
    expect(confidenceText(undefined)).toBe('');
  });

  it('Server hat selbst lokal klassifiziert: Hinweis ohne Rohtext, Grund nur im Tooltip-Feld', async () => {
    const it = await describeBuilding('Haus', { baseUrl: '', vocabulary, fetch: server(200, { ok: true, request, model: 'local', fallback: '401 Schlüssel' }) });
    expect(it.source).toBe('server');
    expect(it.note).toBe(SOURCE_NOTES.modelFailed);
    expect(it.reason).toBe('401 Schlüssel');
    expect(sourceText(it)).toBe('Sprachmodell gerade nicht nutzbar – der Server hat lokal erkannt');
    const plain = await describeBuilding('Haus', { baseUrl: '', vocabulary, fetch: server(200, { ok: true, request, model: 'local' }) });
    expect(sourceText(plain)).toBe('Server ohne Sprachmodell – lokal erkannt');
  });

  it('Server nicht erreichbar / ohne Modell / abgelehnt / Proxy ohne Ziel → lokaler Klassifikator mit Hinweis ohne HTTP-Codes', async () => {
    const prompt = 'Große mittelalterliche Taverne mit drei Etagen';
    const cases: Array<[typeof fetch, string, RegExp | undefined]> = [
      [down, SOURCE_NOTES.unreachable, /Failed to fetch/],
      [server(503, { ok: false, errors: ['NL-Steuerung nicht konfiguriert'] }), SOURCE_NOTES.noModel, /HTTP 503: NL-Steuerung/],
      [server(400, { ok: false, errors: ['ungültig'] }), SOURCE_NOTES.rejected, /HTTP 400: ungültig/],
      [server(401, { ok: false, errors: ['Anmeldung fehlt'] }), SOURCE_NOTES.denied, /HTTP 401/],
      [server(403, { ok: false, errors: ['nicht erlaubt'] }), SOURCE_NOTES.denied, /HTTP 403/],
      [server(429, { ok: false, errors: ['Rate-Limit'] }), SOURCE_NOTES.busy, /HTTP 429/],
      [server(404, { ok: false, errors: ['unbekannt'] }), SOURCE_NOTES.unreachable, /HTTP 404/],
      [server(502, { ok: false, errors: ['Modell 500'] }), SOURCE_NOTES.failed, /HTTP 502/],
      [server(404, '<!doctype html><title>404</title>'), SOURCE_NOTES.unreachable, /HTTP 404 ohne JSON/],
      [server(500, 'Error: connect ECONNREFUSED'), SOURCE_NOTES.unreachable, /HTTP 500 ohne JSON/],
    ];
    for (const [f, note, reason] of cases) {
      const it = await describeBuilding(prompt, { baseUrl: '/engine', vocabulary, fetch: f });
      expect(it.source).toBe('local');
      expect(it.note).toBe(note);
      expect(it.note).not.toMatch(/HTTP|\b[1-5]\d\d\b|Engine/);
      if (reason !== undefined) expect(it.reason).toMatch(reason);
      expect(it.request).toMatchObject({ op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'L', floors: 3, themeId: 'medieval' } });
    }
  });

  it('Zeitlimit: Server antwortet nicht → lokal', async () => {
    const hang = ((_u: unknown, init?: RequestInit) => new Promise((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as typeof fetch;
    const it = await describeBuilding('Wachturm', { baseUrl: '/engine', vocabulary, fetch: hang, timeoutMs: 20 });
    expect(it).toMatchObject({ source: 'local', request: { input: { buildingTypeId: 'watchtower' } } });
    expect(it.note).toBe(SOURCE_NOTES.timeout);
  });

  it('alle Hinweise in Nutzersprache: keine HTTP-Codes, kein „Engine“', () => {
    for (const note of Object.values(SOURCE_NOTES)) expect(note).not.toMatch(/HTTP|\b[1-5]\d\d\b|Engine/);
  });

  it('leerer Text: Fehler ohne Anfrage', async () => {
    const calls: Call[] = [];
    await expect(describeBuilding('   ', { baseUrl: '/engine', vocabulary, fetch: server(200, {}, calls) })).rejects.toThrow(/beschreiben/);
    expect(calls).toEqual([]);
  });
});

describe('suggestionFor: Anfrage → Parameter des Assistenten', () => {
  const themeName = (id: string): string => ctx.themes.get(id).name;

  it('building_generate: Bautyp, Größe, Etagen, Front, Theme, Dach, ohne Gelände; Format/Version nicht übernommen', () => {
    const s = suggestionFor({ op: 'building_generate', input: {
      buildingTypeId: 'tavern', size: 'L', floors: 3, front: 'east', themeId: 'medieval', shell: { roof: 'flat' }, surroundings: false, format: 'schem', targetVersion: '26.3', seed: 7,
    } }, types, themeIds, 'nordic', NEW)!;
    expect(s.def.id).toBe('tavern');
    expect(s.params).toMatchObject({ size: 'L', front: 'east', themeId: 'medieval', shell: { roof: 'flat' }, site: false });
    expect(s.seed).toBe(7);
    expect(s.applied).toEqual(expect.arrayContaining(['groß (L)', '3 Etagen', 'Eingang nach Osten', 'Stil medieval', 'Flachdach', 'Seed 7']));
    expect(s.ignored.join(' ')).toMatch(/Exportformat schem.*Zielversion 26\.3/);
  });

  it('Nutzersprache wie die Plan-Karte des KI-Architekten (W1-G L3): Theme-Name, „groß (L)“, Dach als Nomen', () => {
    const s = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'L', themeId: 'medieval', shell: { roof: 'flat', roofDetail: { pitch: 'steep' } } } },
      types, themeIds, 'medieval', NEW, { themeName })!;
    expect(s.applied).toEqual(['Taverne / Gasthaus', 'groß (L)', 'Stil Mittelalter', 'Flachdach', 'steiles Dach']);
    expect(s.applied.join(' ')).not.toMatch(/medieval|Theme|Größe L|Dach Flach/);
  });

  it('nicht angebotene Werte: Größe/Etagen/Theme verworfen, Standard des Assistenten bleibt', () => {
    const def = types.get('hobbit');
    const s = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'hobbit', size: 'X', floors: 8, themeId: 'gibtsnicht' } }, types, themeIds, 'medieval', NEW)!;
    expect(s.params).toEqual(bt.defaultParams(def, themeIds, 'medieval', NEW));
    expect(s.ignored).toEqual(['Größe X', '8 Etagen', 'Stil gibtsnicht']);
  });

  it('W8-D: Etagen ohne Größe wählen die Größe (Wachturm 3 Etagen → S), ausdrückliche Größe gewinnt', () => {
    for (const [floors, size] of [[3, 'S'], [4, 'M'], [5, 'L']] as const) {
      const s = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'watchtower', floors } }, types, themeIds, 'medieval', NEW)!;
      expect(s.ignored, `${floors}`).toEqual([]);
      expect(s.applied, `${floors}`).toContain(`${floors} Etagen`);
      expect(s.params.size, `${floors}`).toBe(size);
    }
    const m = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'watchtower', size: 'M', floors: 3 } }, types, themeIds, 'medieval', NEW)!;
    expect(m.params.size).toBe('M');
    expect(m.ignored).toEqual(['3 Etagen']);
  });

  it('feste Vorlage (L3): genau ihre Etagenzahl gilt als übernommen, eine andere wird mit Grund verworfen; „1 Etage“', () => {
    const two = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'timber', floors: 2 } }, types, themeIds, 'medieval', NEW)!;
    expect(two.applied).toContain('2 Etagen');
    expect(two.ignored).toEqual([]);
    const three = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'timber', floors: 3, size: 'S' } }, types, themeIds, 'medieval', NEW)!;
    expect(three.ignored).toEqual(['klein (S) – fester Grundriss', '3 Etagen – fester Grundriss mit 2 Etagen']);
    const one = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'house', floors: 1 } }, types, themeIds, 'medieval', NEW)!;
    expect(one.applied).toContain('1 Etage');
    expect(bt.typeSummary(types.get('longhouse'), catalog)).toMatch(/^1 Etage ·/);
  });

  it('Lage (S1b): nur baubare Lagen werden übernommen, andere als „noch nicht baubar“ gemeldet und nicht gesetzt', () => {
    const stilts = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'house', setting: { kind: 'stilts', height: 4 } } }, types, themeIds, 'medieval', NEW)!;
    expect(stilts.params.setting).toBeUndefined();
    expect(stilts.applied.join(' ')).not.toMatch(/Stelzen/);
    expect(stilts.ignored).toEqual(['auf Stelzen (noch nicht baubar)']);
    for (const kind of ['cliff', 'carved', 'tree', 'water', 'underwater']) {
      const s = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'house', setting: { kind } } }, types, themeIds, 'medieval', NEW)!;
      expect(s.params.setting, kind).toBeUndefined();
      expect(s.ignored.join(' '), kind).toMatch(/noch nicht baubar/);
    }
    const buried = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'house', setting: { kind: 'buried' } } }, types, themeIds, 'medieval', NEW)!;
    expect(buried.params.setting).toEqual({ kind: 'buried' });
    expect(buried.applied).toContain('im Erdhügel');
  });

  it('project_create mit Bautyp und building_propose gehen; freie Räume oder unbekannter Bautyp nicht', () => {
    expect(suggestionFor({ op: 'project_create', input: { themeId: 'nordic', buildingType: { buildingTypeId: 'longhouse' } } }, types, themeIds, 'medieval', NEW)?.params.themeId).toBe('nordic');
    expect(suggestionFor({ op: 'building_propose', input: { buildingTypeId: 'watchtower' } }, types, themeIds, 'medieval', NEW)?.def.id).toBe('watchtower');
    expect(suggestionFor({ op: 'rooms_generate', input: { rooms: [] } }, types, themeIds, 'medieval', NEW)).toBeUndefined();
    expect(suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'raumschiff' } }, types, themeIds, 'medieval', NEW)).toBeUndefined();
  });

  it('W7-G: erkannter Zustand wird übernommen wie in der Engine (building_generate storyState), unbekannter bleibt Hinweis', () => {
    const s = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'house', storyState: 'verlassen' } }, types, themeIds, 'medieval', NEW)!;
    expect(s.params.storyState).toBe('verlassen');
    expect(s.applied).toContain('Zustand verlassen');
    expect(s.ignored.join(' ')).not.toContain('Zustand');
    const session = bt.typeSession(s.def, s.params, 3, ctx, NEW).session;
    expect(session.project.state.storyState).toBe('verlassen');
    expect(session.past).toEqual([]);
    const odd = suggestionFor({ op: 'building_generate', input: { buildingTypeId: 'house', storyState: 'verzaubert' } }, types, themeIds, 'medieval', NEW)!;
    expect(odd.params.storyState).toBeUndefined();
    expect(odd.ignored).toContain('Zustand verzaubert');
    // App-Standard-Theme = Theme-Rückfall der Engine (eine Konstante)
    expect(uc.DEFAULT_THEME).toBe('medieval');
  });

  it('Übernahme über denselben Weg wie von Hand: Vorschlag und neues Projekt tragen Dach und Lage aus dem Text', async () => {
    const it = await describeBuilding('Wikingerhaus mit Flachdach, ohne Garten', { baseUrl: '/engine', vocabulary, fetch: down });
    const s = suggestionFor(it.request, types, themeIds, 'medieval', NEW)!;
    expect(s.def.id).toBe('longhouse');
    const p = bt.proposal(s.def, s.params, 3, ctx, NEW);
    expect(p.style.roof).toBe('flat');
    const session = bt.typeSession(s.def, s.params, 3, ctx, NEW).session;
    expect(uc.shellStyle(session).roof).toBe('flat');
    expect(session.surroundings?.terrain ?? false).toBe(false);
  });
});

/**
 * W1-G (S2): Nichts vortäuschen. Die Sicherheit zum Bautyp kommt aus JEV (`confidence.buildingTypeId`) oder vom
 * lokalen Klassifikator (`localConfidence`); unter `TYPE_CONFIDENCE_MIN` schlägt der Assistent nichts vor.
 */
describe('Bautyp sicher erkannt?', () => {
  const local = { op: 'building_generate' as const, input: { buildingTypeId: 'house' } };

  it('lokal im Browser: Sicherheit des Klassifikators wird weitergereicht (Unsinn 0,3, Kompositum 0,8, Wort 1)', async () => {
    const sure = async (text: string) => typeConfidence(await describeBuilding(text, { baseUrl: '', vocabulary, fetch: down }));
    expect(await sure('asdf qwer')).toBeLessThan(TYPE_CONFIDENCE_MIN);
    expect(await sure('Pfahlbau am See')).toBeLessThan(TYPE_CONFIDENCE_MIN);
    expect(await sure('Zwergenfestung')).toBe(0.8);
    expect(await sure('Taverne mit Flachdach')).toBe(1);
  });

  it('Server ohne Modell (model local) und Rückfall: lokale Sicherheit ergänzt; JEV: Konfidenz des Felds zählt', async () => {
    const plain = await describeBuilding('asdf qwer', { baseUrl: '', vocabulary, fetch: server(200, { ok: true, request: local, model: 'local' }) });
    expect(plain.localConfidence).toBe(0.3);
    expect(typeConfidence(plain)).toBeLessThan(TYPE_CONFIDENCE_MIN);
    const jev = await describeBuilding('asdf qwer', { baseUrl: '', vocabulary, fetch: server(200, { ok: true, request: local, model: 'typesafe/jev-1.13', confidence: { buildingTypeId: 0.93 } }) });
    expect(jev.localConfidence).toBeUndefined();
    expect(typeConfidence(jev)).toBe(0.93);
    // JEV ließ den Bautyp offen (lokal ergänzt): dann gilt die lokale Sicherheit
    const filled = await describeBuilding('asdf qwer', { baseUrl: '', vocabulary, fetch: server(200, { ok: true, request: local, model: 'typesafe/jev-1.13', confidence: { size: 0.9 } }) });
    expect(typeConfidence(filled)).toBe(0.3);
    // Chat-Modell ohne Konfidenz: seine Wahl gilt (unbekannt statt unsicher)
    const chat = await describeBuilding('asdf qwer', { baseUrl: '', vocabulary, fetch: server(200, { ok: true, request: local, model: 'openai/gpt-x' }) });
    expect(typeConfidence(chat)).toBeUndefined();
  });

  it('Server liefert lokale Sicherheit mit (W1-G R1-02: confidence.buildingTypeId wie bei JEV) – sie gilt', async () => {
    const it = await describeBuilding('asdf qwer', { baseUrl: '', vocabulary, fetch: server(200, { ok: true, request: local, model: 'local', confidence: { buildingTypeId: 0.3 } }) });
    expect(it.localConfidence).toBeUndefined();
    expect(typeConfidence(it)).toBe(0.3);
  });

  it('Erkennung der Website ohne Bautyp-Konfidenz: withLocalConfidence ergänzt nur, wenn der lokale Typ derselbe ist', () => {
    const it = withLocalConfidence({ source: 'server', request: local, model: 'local' }, 'asdf qwer', vocabulary);
    expect(it.localConfidence).toBe(0.3);
    const other = withLocalConfidence({ source: 'server', request: { op: 'building_generate', input: { buildingTypeId: 'tavern' } }, model: 'local' }, 'asdf qwer', vocabulary);
    expect(other.localConfidence).toBeUndefined();
    const withJev = { source: 'server' as const, request: local, confidence: { buildingTypeId: 0.2 } };
    expect(withLocalConfidence(withJev, 'asdf', vocabulary)).toBe(withJev);
  });
});

/**
 * Editor (W1-G S2 / Review R1-02, R1-01): was der Assistent aus einer Erkennung macht – `describeOutcome` ist die Logik
 * hinter „Vorschlagen“ (BuildingTypeWizard): unter der Schwelle kein Vorschlag und nichts vorausgewählt.
 */
describe('Assistent: Vorschlag oder Rückfrage', () => {
  const outcome = async (text: string, f: typeof fetch = down) => describeOutcome(await describeBuilding(text, { baseUrl: '', vocabulary, fetch: f }), types, themeIds, 'medieval', NEW);

  it('Unsinn, Pfahlbau ohne Bautyp: „Kein Bautyp sicher erkannt – bitte wähle einen“, kein Vorschlag; Erkanntes steht dabei', async () => {
    const nonsense = await outcome('asdf qwer');
    expect(nonsense.kind).toBe('uncertain');
    expect(nonsense.text.startsWith(UNCERTAIN_TYPE_TEXT)).toBe(true);
    expect(nonsense.text).not.toMatch(/Beispielhaus/);
    const stilts = await outcome('Pfahlbau am See');
    expect(stilts).toMatchObject({ kind: 'uncertain' });
    // W7-E: „am See“ nennt jetzt auch den Stil Küste (Stimmung/Ort → Theme) – er steht vor der Lage
    expect(stilts.text).toMatch(/Erkannt: (Stil [^·]+ · )?auf Stelzen \(noch nicht baubar\)/);
    // dieselbe Rückfrage, wenn der Server lokal erkannt hat (Antwort mit confidence.buildingTypeId 0,3)
    const viaServer = await outcome('asdf qwer', server(200, { ok: true, request: { op: 'building_generate', input: { buildingTypeId: 'house' } }, model: 'local', confidence: { buildingTypeId: 0.3 } }));
    expect(viaServer.kind).toBe('uncertain');
  });

  it('Kompositum und genanntes Wort: Vorschlag in Nutzersprache', async () => {
    const dwarf = await outcome('Zwergenfestung');
    expect(dwarf.kind).toBe('suggestion');
    if (dwarf.kind === 'suggestion') expect(dwarf.suggestion.def.id).toBe('castle_compact');
    const tavern = await outcome('große Taverne mit Flachdach');
    expect(tavern.text).toBe('Vorschlag: Taverne / Gasthaus · groß (L) · Flachdach');
  });

  it('R1-01: „desert house with a flat roof“ → nach Übernehmen ist das Dach flach (feste Vorlage, Dach aus der Beschreibung)', async () => {
    const o = await outcome('desert house with a flat roof');
    expect(o.kind).toBe('suggestion');
    if (o.kind !== 'suggestion') return;
    expect(o.suggestion.def.id).toBe('house');
    expect(o.text).toMatch(/Flachdach/);
    const p = bt.proposal(o.suggestion.def, o.suggestion.params, 2026, ctx, NEW);
    expect(p.style.roof).toBe('flat');
    const session = bt.typeSession(o.suggestion.def, o.suggestion.params, 2026, ctx, NEW).session;
    expect(uc.shellStyle(session).roof).toBe('flat');
    expect(session.project.state.themeId).toBe('desert');
  });
});
