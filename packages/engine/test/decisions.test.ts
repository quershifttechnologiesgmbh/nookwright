/**
 * JEV-Adapter (Entscheidungsmodell über die Decisions-API) offline: Fragen automatisch aus Schema und Vokabular,
 * Anfrage-Form laut Doku (plan/spikes/jev-docs/submit-a-decisions-request.md), Schwellen, „nicht angegeben“,
 * Aufteilung über 255 Optionen, Fehler → lokaler Rückfall, Umgebung, HTTP-Server und MCP. Kein Netz, kein Schlüssel.
 */
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  DEFAULT_COMBINE, DEFAULT_MIN_CONFIDENCE, NOT_SPECIFIED, classifyLocal, combineLocal, createEngine, decideIntent, decisionPlan, optionText,
  typeThemeOverlaps, type DecisionAnswer, type DecisionPlan, type Vocabulary,
} from '../src/index.js';
import {
  DEFAULT_DECISIONS_URL, DEFAULT_MODEL, NL_TOOL, decisionPlanOf, engineMcpServer, engineServer, interpret, interpretOptionsFromEnv, isDecisionsModel,
  type InterpretOptions,
} from '../src/node/index.js';
import { TYPE_CONFIDENCE_MIN } from '../src/intent/local.js';
import { ctx, engine } from './fixture.js';

type Answers = Record<string, DecisionAnswer>;
type Seen = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
const plan = decisionPlanOf(engine);
const pick = (choice: string, confidence = 0.9): DecisionAnswer => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } });
const noul = (p: number): DecisionAnswer => ({ type: 'noul', noul: p });
const score = (s: number, confidence = 0.9): DecisionAnswer => ({ type: 'score', score: s, confidence });

/** Antwort für jede Frage „nicht angegeben“ bzw. P(ja) = 0,02, überschrieben durch `set`. */
function answers(set: Answers, p: DecisionPlan = plan): Answers {
  const base = Object.fromEntries(Object.entries(p.questions).map(([k, q]): [string, DecisionAnswer] =>
    [k, q.type === 'noul' ? noul(0.02) : q.type === 'score' ? score(1, 0.2) : pick(NOT_SPECIFIED, 0.99)]));
  return { ...base, ...set };
}
function jev(steps: ReadonlyArray<readonly [number, unknown]>, seen: Seen[] = []): typeof fetch {
  let i = 0;
  return (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const [status, body] = steps[Math.min(i++, steps.length - 1)]!;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}
const ok = (a: Answers) => ({ model: 'typesafe/jev-1.13-20260917', answers: a, usage: { input_tokens: 5500, output_tokens: 2000, cost: 0.00023 } });
const opts = (f: typeof fetch, extra: Partial<InterpretOptions> = {}): InterpretOptions => ({ apiKey: 'k', model: DEFAULT_MODEL, mode: 'decisions', fetch: f, ...extra });

describe('Fragen aus Schema und Vokabular (kein zweiter Vertrag)', () => {
  it('Bautypen und Themes: choice mit allen IDs außer Entwürfen, Anzeigename + Beschreibung (+ Stimmung), Option „nicht angegeben“', () => {
    const bt = plan.questions['buildingTypeId']!;
    expect(bt.type).toBe('choice');
    const crit = (bt as { criteria: Record<string, string> }).criteria;
    // W7-L: Entwürfe (townhouse_row) nicht anbieten – live nahm JEV „Reihenhäuser“ sicher als Entwurf
    expect(Object.keys(crit).sort()).toEqual([...engine.vocabulary.buildingTypes.filter((b) => !b.draft).map((b) => b.id), NOT_SPECIFIED].sort());
    expect(crit['hobbit']).toMatch(/^hobbit: Erdhaus \(im Hügel\) – Einstöckiges Erdhaus/); // W8-D: Marke – öffentlich nur „Erdhaus“
    expect(JSON.stringify(plan.questions)).not.toMatch(/Hobbit/);
    expect(crit['townhouse_row']).toBeUndefined();
    expect(decideIntent(plan, 'building_generate', { buildingTypeId: pick('townhouse_row', 1) }, 0.6, {}).request.input).toEqual({});
    const th = (plan.questions['themeId'] as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(th).sort()).toEqual([...engine.vocabulary.themes.map((t) => t.id), NOT_SPECIFIED].sort());
    // W12 (2026-09-28): W12-D – nordic ist jetzt Blockbau (neue Beschreibung im Theme-Katalog)
    expect(th['nordic']).toMatch(/^nordic: Nordisch – Blockbau aus entrindeten Stämmen/);
    expect(th['ruin']).toMatch(/\(Stimmung: düster, finster, unheimlich\)$/); // aus MOOD_THEMES, Umlaute zurück
    expect(th['rustic']).toMatch(/\(Stimmung: gemütlich, cozy, heimelig\)$/); // „cosy“ als Schreibvariante weg
    expect(th['medieval']).not.toContain('Stimmung');
  });

  it('Typen: Enum → choice, Größe/Dachneigung → score + Tor, Boolean → noul, Etagen → choice über Zahlen, Seed nicht fragbar', () => {
    expect(plan.questions['size']).toMatchObject({ type: 'score', criteria: ['S: klein', 'M: mittel', 'L: groß'] });
    expect(plan.questions['size#given']).toMatchObject({ type: 'noul' });
    expect(plan.questions['shell.roofDetail.pitch']).toMatchObject({ type: 'score', criteria: ['low: flach', 'normal: 45°', 'steep: steil'] });
    expect(plan.questions['shell.roof']).toMatchObject({ type: 'choice', criteria: { flat: 'flat: Flachdach', half_hip: 'half_hip: Krüppelwalmdach' } });
    expect(Object.keys((plan.questions['floors'] as { criteria: object }).criteria)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', NOT_SPECIFIED]);
    expect(plan.fields).toContainEqual({ kind: 'noul', path: 'surroundings', key: 'surroundings', value: false }); // Standard true → Frage nach „ohne“
    expect(plan.fields).toContainEqual({ kind: 'noul', path: 'exterior.enabled', key: 'exterior.enabled', value: false }); // „false = keine Außen-Deko“
    expect(plan.fields).toContainEqual({ kind: 'noul', path: 'shell.facade.quoins', key: 'shell.facade.quoins', value: true });
    // W3-BL: Block-Listen (sperren, erlauben, ersetzen) sind freie Listen – fragbar ist nur das Preset (easy_farm)
    // W4 (27.09.2026): die Raumtypen mit Doppeltür (`shell.facade.rules.doubleDoor`) sind ebenfalls eine freie Liste
    // W15: einzeln abgeschaltete Fassaden-Details (`exterior.facadeDetailOff`) sind wie `exterior.off` eine freie Liste
    expect(plan.skipped.map((s) => s.path).sort()).toEqual([
      'blockRules.allowed', 'blockRules.banned', 'blockRules.replace', 'exterior.facadeDetailOff', 'exterior.off', 'exterior.variation', 'paletteOverrides.swaps', 'rerollCount', 'seed', 'setting.height', 'shell.facade.decor.role',
      // W16-B (28.09.2026): Raumtypen mit Fenster-Pflicht (`shell.facade.lightRooms`) sind eine freie Liste wie doubleDoor
      'shell.facade.lightRooms',
      'shell.facade.rules.doubleDoor',
    ]);
    expect(plan.questions['blockRules.preset']).toMatchObject({ type: 'choice' });
    // W13-G: Blockpalette je Gruppe fragbar („mit dunklem Holz und Ziegeldach“); der Familien-Tausch ist eine freie Liste
    const roof = (plan.questions['paletteOverrides.roof'] as { type: string; criteria: Record<string, string> });
    expect(roof.type).toBe('choice');
    expect(roof.criteria['bricks']).toMatch(/Ziegeldach/);
    expect((plan.questions['paletteOverrides.frame'] as { criteria: Record<string, string> }).criteria['dark_oak']).toMatch(/dunkles Holz/);
  });

  it('jedes Blatt des Schemas ist Frage oder begründet nicht fragbar; jede Text-Option hat eine Erklärung (describe „id = Text“)', () => {
    const leaves: string[] = [];
    const walk = (n: Record<string, unknown>, p: string): void => {
      const props = n['properties'];
      if (n['type'] === 'object' && props !== null && typeof props === 'object') {
        for (const [k, c] of Object.entries(props)) walk(c as Record<string, unknown>, p === '' ? k : `${p}.${k}`);
      } else leaves.push(p);
    };
    walk(engine.inputSchema('building_generate'), '');
    expect([...plan.fields.map((f) => f.path), ...plan.skipped.map((s) => s.path)].sort()).toEqual(leaves.sort());
    // Neuer Enum-Wert ohne Erklärung in .describe() fällt hier auf (Versionen und Katalog-IDs erklären sich selbst)
    for (const [key, q] of Object.entries(plan.questions)) {
      if (q.type !== 'choice' || key === 'targetVersion' || key === 'buildingTypeId' || key === 'themeId') continue;
      for (const [id, text] of Object.entries(q.criteria)) if (id !== NOT_SPECIFIED && !/^\d+$/.test(id)) expect(text, `${key}.${id}`).not.toBe(id);
    }
  });

  it('neues Enum-Feld / neuer Katalog-Eintrag → automatisch neue Frage / Option', () => {
    const vocab: Vocabulary = {
      ...engine.vocabulary,
      buildingTypes: [...engine.vocabulary.buildingTypes, { id: 'zz_mill', name: 'Windmühle', description: 'Mühle mit Flügeln', family: 'x', sizes: ['M'], themes: [], draft: false }],
    };
    const schema = z.toJSONSchema(z.object({
      buildingTypeId: z.enum(vocab.buildingTypes.map((b) => b.id) as [string, ...string[]]).describe('Bautyp'),
      mood: z.enum(['calm', 'spooky']).optional().describe('Stimmung: calm = ruhig, spooky = gruselig'),
      lit: z.boolean().optional().describe('beleuchtet'),
    }).strict()) as Record<string, unknown>;
    const p = decisionPlan(schema, vocab);
    expect((p.questions['buildingTypeId'] as { criteria: Record<string, string> }).criteria['zz_mill']).toBe('zz_mill: Windmühle – Mühle mit Flügeln');
    expect(p.questions['mood']).toMatchObject({ type: 'choice', criteria: { calm: 'calm: ruhig', spooky: 'spooky: gruselig', [NOT_SPECIFIED]: expect.any(String) } });
    expect(p.questions['lit']).toMatchObject({ type: 'noul' });
    const d = decideIntent(p, 'building_generate', answers({ buildingTypeId: pick('zz_mill'), mood: pick('spooky', 0.8), lit: noul(0.9) }, p), 0.5, {});
    expect(d.request.input).toEqual({ buildingTypeId: 'zz_mill', mood: 'spooky', lit: true });
  });

  it('Optionstext aus der Beschreibung', () => {
    expect(optionText('Lage: ground = ebenerdig (normal), buried = im Erdhügel', 'buried')).toBe('im Erdhügel');
    expect(optionText('Dachform: flat = Flachdach, hip = Walmdach', 'gable')).toBeUndefined();
  });

  it('mehr Optionen als JEV erlaubt (255) → Teilfragen, die sicherste echte Wahl gewinnt', () => {
    const p = decisionPlan(engine.inputSchema('building_generate'), engine.vocabulary, 5); // 4 Optionen + „nicht angegeben“ je Teil
    const keys = Object.keys(p.questions).filter((k) => k.startsWith('buildingTypeId'));
    expect(keys).toEqual(['buildingTypeId#1', 'buildingTypeId#2', 'buildingTypeId#3']);
    for (const k of keys) expect(Object.keys((p.questions[k] as { criteria: object }).criteria).length).toBeLessThanOrEqual(5);
    const d = decideIntent(p, 'building_generate', answers({
      'buildingTypeId#1': pick('castle_compact', 0.6), 'buildingTypeId#2': pick('longhouse', 0.95), 'buildingTypeId#3': pick(NOT_SPECIFIED, 1),
    }, p), 0.5, {});
    expect(d.request.input).toMatchObject({ buildingTypeId: 'longhouse' });
  });
});

describe('Schwellen und Abbildung', () => {
  const decide = (a: Answers, min = 0.5, local: Record<string, unknown> = { buildingTypeId: 'house' }) => decideIntent(plan, 'building_generate', answers(a), min, local);

  it('Live-Probe „kleine Hobbithöhle, Eingang nach Osten, ohne Garten“ → Felder mit Konfidenz', () => {
    const d = decide({ buildingTypeId: pick('hobbit', 1), front: pick('east', 1), size: score(0, 0.98), 'size#given': noul(0.95), surroundings: noul(0.97) });
    expect(d.request).toEqual({ op: 'building_generate', input: { buildingTypeId: 'hobbit', size: 'S', front: 'east', surroundings: false } });
    expect(d.confidence).toEqual({ buildingTypeId: 1, size: 0.95, front: 1, surroundings: 0.97 });
    expect(engine.validate(d.request)).toEqual([]);
  });

  it('unter der Schwelle oder „nicht angegeben“ → Feld weg; Schwelle einstellbar', () => {
    const a = { buildingTypeId: pick('tavern', 0.95), themeId: pick('medieval', 0.45), floors: pick('3', 0.62), front: pick(NOT_SPECIFIED, 0.99), 'shell.facade.quoins': noul(0.49) };
    expect(decide(a).request.input).toEqual({ buildingTypeId: 'tavern', floors: 3 });
    expect(decide(a, 0.4).request.input).toEqual({ buildingTypeId: 'tavern', floors: 3, themeId: 'medieval', shell: { facade: { quoins: true } } });
    expect(decide(a, 0.7).request.input).toEqual({ buildingTypeId: 'tavern' });
  });

  it('score: Tor „nennt die Bitte eine Größe?“ und Konfidenz müssen beide reichen; Index gerundet und begrenzt', () => {
    expect(decide({ size: score(1.98, 0.97), 'size#given': noul(0.3) }).request.input).not.toHaveProperty('size');
    expect(decide({ size: score(1.98, 0.3), 'size#given': noul(0.9) }).request.input).not.toHaveProperty('size');
    expect(decide({ size: score(2.4, 0.9), 'size#given': noul(0.9) }).request.input).toMatchObject({ size: 'L' });
  });

  it('Objekt ohne Pflichtfeld fällt weg (setting.front ohne setting.kind); verschachtelte Felder', () => {
    expect(decide({ 'setting.front': pick('east', 0.9) }).request.input).toEqual({ buildingTypeId: 'house' });
    expect(decide({ 'setting.kind': pick('buried', 0.9), 'setting.cover': pick('2', 0.8), 'shell.roof': pick('flat', 0.9), 'exterior.enabled': noul(0.9) }).request.input)
      .toEqual({ buildingTypeId: 'house', setting: { kind: 'buried', cover: 2 }, shell: { roof: 'flat' }, exterior: { enabled: false } });
  });

  it('nicht fragbare Felder (Seed) und fehlendes Pflichtfeld kommen vom lokalen Klassifikator; unbekannte Wahl zählt nicht', () => {
    const d = decide({ buildingTypeId: pick('nope', 1), themeId: pick('nordic', 0.9) }, 0.5, { buildingTypeId: 'watchtower', seed: 42, size: 'S' });
    expect(d.request.input).toEqual({ buildingTypeId: 'watchtower', themeId: 'nordic', seed: 42 });
    expect(d.fromLocal).toEqual(['seed', 'buildingTypeId']);
    expect(d.confidence).not.toHaveProperty('buildingTypeId');
  });
});

describe('interpret über die Decisions-API (gemocktes fetch)', () => {
  it('Anfrage-Form laut Doku: POST /api/alpha/decisions, Bearer, { model, state, questions } mit choice/noul/score', async () => {
    const seen: Seen[] = [];
    const it1 = await interpret('kleine Hobbithöhle, Eingang nach Osten', engine, opts(jev([[200, ok(answers({ buildingTypeId: pick('hobbit', 1), front: pick('east', 1) }))]], seen)));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(DEFAULT_DECISIONS_URL).toBe(seen[0]!.url);
    expect(seen[0]!.headers['authorization']).toBe('Bearer k');
    const body = seen[0]!.body;
    expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state']);
    expect(body['model']).toBe('typesafe/jev-1.13');
    expect(body['state']).toMatchObject({ bitte: 'kleine Hobbithöhle, Eingang nach Osten' });
    for (const [k, q] of Object.entries(body['questions'] as Record<string, Record<string, unknown>>)) {
      expect(typeof q['instructions'], k).toBe('string');
      if (q['type'] === 'choice') expect(Object.keys(q['criteria'] as object).length, k).toBeLessThanOrEqual(255);
      else if (q['type'] === 'score') expect(Array.isArray(q['criteria']), k).toBe(true);
      else expect(q, k).toMatchObject({ type: 'noul', criteria: { true: expect.any(String), false: expect.any(String) } });
    }
    expect(it1).toMatchObject({ model: 'typesafe/jev-1.13-20260917', request: { input: { buildingTypeId: 'hobbit', front: 'east' } }, confidence: { buildingTypeId: 1 } });
    expect(it1.usage).toMatchObject({ cost: 0.00023 });
    expect(it1.fallback).toBeUndefined();
  });

  it('Modus ohne Angabe: System-One-Modell → Decisions-API, Chat-Modell → chat/completions', async () => {
    const seen: Seen[] = [];
    await interpret('Burg', engine, { apiKey: 'k', model: 'typesafe/jev-1.13', fetch: jev([[200, ok(answers({ buildingTypeId: pick('castle_compact') }))]], seen) });
    expect(seen[0]!.url).toBe(DEFAULT_DECISIONS_URL);
    expect(isDecisionsModel('typesafe/jev-1.13') && isDecisionsModel('~typesafe/jev-latest') && isDecisionsModel('jev-1.13')).toBe(true);
    expect(isDecisionsModel('openai/gpt-oss-20b') || isDecisionsModel('google/gemini-2.5-flash-lite')).toBe(false);
  });

  it('Fehler → lokaler Rückfall mit Klartext; 401/400 ohne, 429/5xx mit einem Wiederholungsversuch', async () => {
    const cases: Array<[number, unknown, number, RegExp]> = [
      [401, { error: { code: 401, message: 'User not found.' } }, 1, /401 \(Schlüssel ungültig/],
      [402, { error: { code: 402, message: 'Insufficient credits' } }, 1, /402 \(Guthaben/],
      [400, { error: { code: 400, message: 'HTTP 400: {"detail":"Too many choices. Must have at most 255 choices."}' } }, 1, /400 .*Too many choices/],
      [429, { error: { code: 429, message: 'Rate limit exceeded' } }, 2, /429 \(Rate-Limit/],
      [503, { error: { code: 503, message: 'Provider Overloaded' } }, 2, /503 \(Anbieter-Fehler/],
    ];
    for (const [status, body, calls, msg] of cases) {
      const seen: Seen[] = [];
      const r = await interpret('kleine Hobbithöhle', engine, opts(jev([[status, body]], seen)));
      expect(r.model, String(status)).toBe('local');
      expect(r.fallback).toMatch(msg);
      expect(r.fallback).not.toContain('Bearer');
      expect(r.request.input).toMatchObject({ buildingTypeId: 'hobbit', size: 'S' });
      expect(seen, String(status)).toHaveLength(calls);
    }
    const retried = await interpret('Burg', engine, opts(jev([[429, { error: { message: 'Rate limit exceeded' } }], [200, ok(answers({ buildingTypeId: pick('castle_compact') }))]])));
    expect(retried).toMatchObject({ model: 'typesafe/jev-1.13-20260917', request: { input: { buildingTypeId: 'castle_compact' } } });
  });

  it('Zeitlimit, Antwort ohne answers, kein JSON → Rückfall; ohne Rückfall ein klarer Fehler', async () => {
    const hang = (async (_u: string | URL, init?: RequestInit) => new Promise<Response>((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
    const t = await interpret('Taverne', engine, opts(hang, { timeoutMs: 30, retries: 0 }));
    expect(t).toMatchObject({ model: 'local', fallback: expect.stringMatching(/Zeitlimit 30 ms/), request: { input: { buildingTypeId: 'tavern' } } });
    expect((await interpret('Taverne', engine, opts(jev([[200, { model: 'x' }]])))).fallback).toMatch(/ohne answers/);
    expect((await interpret('Taverne', engine, opts(jev([[200, 'Bad gateway']]), { retries: 0 }))).fallback).toMatch(/kein JSON/);
    await expect(interpret('Taverne', engine, opts(jev([[401, { error: { message: 'User not found.' } }]]), { fallback: false }))).rejects.toThrow(/401/);
  });

  it('ungültige Kombination wird von derselben zod-Validierung abgefangen → lokaler Rückfall', async () => {
    // Leerer Katalog: kein Bautyp gültig, lokaler Wert auch nicht → Engine lehnt ab, interpret fällt mit Grund zurück
    const empty = createEngine({ ...ctx, buildingTypes: { ids: () => [], get: () => { throw new Error('leer'); } } } as unknown as typeof ctx);
    const r = await interpret('Burg', empty, opts(jev([[200, ok({ buildingTypeId: pick('castle_compact') })]])));
    expect(r).toMatchObject({ model: 'local', fallback: expect.stringMatching(/ungültig/) });
  });
});

describe('Umgebung', () => {
  it('Standardmodell JEV → Modus decisions; Chat-Modell per ENGINE_NL_MODEL; Schwelle und Endpunkt einstellbar', () => {
    expect(DEFAULT_MODEL).toBe('typesafe/jev-1.13');
    expect(interpretOptionsFromEnv({ ENGINE_NL_API_KEY: 'k' })).toMatchObject({ model: 'typesafe/jev-1.13', mode: 'decisions' });
    expect(interpretOptionsFromEnv({ ENGINE_NL_API_KEY: 'k', ENGINE_NL_MODEL: '~typesafe/jev-latest' })).toMatchObject({ mode: 'decisions' });
    expect(interpretOptionsFromEnv({ ENGINE_NL_API_KEY: 'k', ENGINE_NL_MODEL: 'openai/gpt-oss-20b' })).toMatchObject({ mode: 'tools' });
    expect(interpretOptionsFromEnv({ ENGINE_NL_API_KEY: 'k', ENGINE_NL_MODEL: 'typesafe/jev-1.13', ENGINE_NL_MODE: 'tools' })).toMatchObject({ mode: 'decisions' });
    expect(interpretOptionsFromEnv({ ENGINE_NL_API_KEY: 'k', ENGINE_NL_MIN_CONFIDENCE: '0.7', ENGINE_NL_DECISIONS_URL: 'https://x/d' }))
      .toMatchObject({ minConfidence: 0.7, decisionsUrl: 'https://x/d' });
    expect(interpretOptionsFromEnv({})).toMatchObject({ mode: 'local', model: 'local' });
  });
});

describe('Anbindung: HTTP-Server und MCP liefern Modell und Konfidenzen', () => {
  const fetchJev = jev([[200, ok(answers({ buildingTypeId: pick('hobbit', 1), front: pick('east', 0.97) }))]]);

  it('POST /v1/interpret und /v1/prompt', async () => {
    const server = engineServer(engine, { interpret: opts(fetchJev) });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const path of ['/v1/interpret', '/v1/prompt']) {
        const r = await fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify({ prompt: 'Hobbithöhle nach Osten' }), headers: { 'content-type': 'application/json' } });
        const j = (await r.json()) as Record<string, unknown>;
        expect(r.status, path).toBe(200);
        expect(j, path).toMatchObject({ ok: true, model: 'typesafe/jev-1.13-20260917', confidence: { buildingTypeId: 1, front: 0.97 }, request: { input: { buildingTypeId: 'hobbit', front: 'east' } } });
      }
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('MCP nl_prompt', async () => {
    const client = new Client({ name: 't', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await engineMcpServer(engine, { outDir: mkdtempSync(join(tmpdir(), 'engine-jev-')), interpret: opts(fetchJev) }).connect(a);
    await client.connect(b);
    try {
      const r = await client.callTool({ name: NL_TOOL, arguments: { prompt: 'Hobbithöhle nach Osten' } });
      const data = JSON.parse((r as { content: { text: string }[] }).content[0]!.text) as Record<string, unknown>;
      expect(data).toMatchObject({ model: 'typesafe/jev-1.13-20260917', confidence: { buildingTypeId: 1 }, request: { input: { buildingTypeId: 'hobbit' } } });
      expect(data['file']).toMatch(/\.litematic$/);
    } finally {
      await client.close();
    }
  });
});

describe('Treffsicherheit (E1 „J2“, Live-Befunde 2026-09-25)', () => {
  it('Optionstext: Kommas in Klammern gehören dazu („schematic format“ fand live kein Format), fremde Klammer endet', () => {
    const d = 'Exportformat der Datei: litematic = Litematica, schem = Schematic (WorldEdit, .schem), nbt = Strukturblock (NBT)';
    expect(optionText(d, 'schem')).toBe('Schematic (WorldEdit, .schem)');
    expect(optionText(d, 'nbt')).toBe('Strukturblock (NBT)');
    expect(optionText('Traufkonsolen alle n Blöcke (0 = aus)', '0')).toBe('aus');
    // W7-L: Satzende beendet den Optionstext, Abkürzungen nicht
    expect(optionText('Lage: water = am Wasser, underwater = unter Wasser. Gebaut werden heute nur ground', 'underwater')).toBe('unter Wasser');
    expect(optionText('Zustand: belagert = Risse, z. B. Beschuss', 'belagert')).toBe('Risse');
    expect(optionText('Deko: viel = z. B. Fässer und Kisten', 'viel')).toBe('z. B. Fässer und Kisten');
    const format = (plan.questions['format'] as { criteria: Record<string, string> }).criteria;
    expect(format['schem']).toBe('schem: Schematic (WorldEdit, .schem)');
  });

  it('Theme-Frage: Bautyp-Wörter mit Theme-Namen aus dem Katalog abgeleitet („Fachwerkhaus, rustikal“ → live timber)', () => {
    const pairs = typeThemeOverlaps(engine.vocabulary).map(({ type, theme }) => `${type.id}/${theme.id}`);
    expect(pairs).toEqual(expect.arrayContaining(['timber/timber', 'farmhouse/farmstead']));
    expect(pairs).not.toContain('tavern/medieval');
    const th = plan.questions['themeId']!.instructions;
    expect(th).toContain('„Fachwerkhaus“ = Bautyp timber, nicht Theme timber');
    expect(th).toContain('ein eigenes Stilwort daneben zählt');
    // neuer Katalog-Eintrag → neuer Hinweis ohne Code-Änderung
    const vocab: Vocabulary = {
      ...engine.vocabulary,
      buildingTypes: [...engine.vocabulary.buildingTypes, { id: 'zz_fort', name: 'Wüstenfort', family: 'fort', sizes: [], themes: [], draft: false }],
    };
    const schema = z.toJSONSchema(z.object({
      buildingTypeId: z.enum(vocab.buildingTypes.map((b) => b.id) as [string, ...string[]]).describe('Bautyp'),
      themeId: z.enum(vocab.themes.map((t) => t.id) as [string, ...string[]]).optional().describe('Material-Theme'),
    }).strict()) as Record<string, unknown>;
    expect(decisionPlan(schema, vocab).questions['themeId']!.instructions).toContain('„Wüstenfort“ = Bautyp zz_fort, nicht Theme desert');
  });

  it('Bautyp-Frage: übrige Hauptangaben werden getrennt gefragt (live „in den Berg gehauen“/„unterirdisch“ → hobbit/twostory)', () => {
    const bt = plan.questions['buildingTypeId']!.instructions;
    expect(bt).toMatch(/Nur die Gebäudeart; .*Größenklasse.*Lage.*Dachform.*Material-Theme.* werden getrennt gefragt\./);
    expect(bt).not.toMatch(/Bautyp, /);
  });

  it('combineLocal: fill ergänzt nur fehlende Felder, local-first schlägt JEV, Standard-Bautyp des lokalen zählt nicht', () => {
    const decided = decideIntent(plan, 'building_generate', answers({ buildingTypeId: pick('watchtower'), themeId: pick('nordic') }), 0.6, {});
    const local = { buildingTypeId: 'house', themeId: 'medieval', format: 'schem', shell: { roof: 'flat' } };
    const fill = combineLocal(decided, local, false, 'fill');
    expect(fill.request.input).toEqual({ buildingTypeId: 'watchtower', themeId: 'nordic', format: 'schem', shell: { roof: 'flat' } });
    expect(fill.fromLocal).toEqual(['format', 'shell.roof']);
    expect(fill.confidence['themeId']).toBe(0.9);
    const first = combineLocal(decided, local, false, 'local-first');
    expect(first.request.input).toMatchObject({ buildingTypeId: 'watchtower', themeId: 'medieval' });
    expect(first.confidence['themeId']).toBeUndefined();
    expect(combineLocal(decided, local, true, 'local-first').request.input).toMatchObject({ buildingTypeId: 'house' });
    expect(combineLocal(decided, local, true, 'none')).toBe(decided);
    expect(decided.request.input).toEqual({ buildingTypeId: 'watchtower', themeId: 'nordic' }); // unverändert
  });

  it('interpret: Standard 0,6 + lokal zuerst, füllt auch („schematic format“: JEV 0,3 → lokal schem); ENGINE_NL_COMBINE=none schaltet ab', async () => {
    expect(DEFAULT_MIN_CONFIDENCE).toBe(0.6);
    expect(DEFAULT_COMBINE).toBe('local-first'); // W7-L: live gleich oder besser als fill
    const prompt = 'a small medieval watchtower facing north, schematic format';
    const live = answers({
      buildingTypeId: pick('watchtower', 1), front: pick('north', 0.95), themeId: pick('medieval', 0.9),
      format: { type: 'choice', choice: NOT_SPECIFIED, confidence: 0.59, probabilities: { schem: 0.3, [NOT_SPECIFIED]: 0.69 } },
      floors: pick('3', 0.55),
    });
    const it1 = await interpret(prompt, engine, opts(jev([[200, ok(live)]])));
    expect(it1.request.input).toMatchObject({ buildingTypeId: 'watchtower', front: 'north', themeId: 'medieval', format: 'schem' });
    expect(it1.request.input).not.toHaveProperty('floors'); // 0,55 < 0,6
    expect(it1.confidence).not.toHaveProperty('format');
    const none = await interpret(prompt, engine, opts(jev([[200, ok(live)]]), { combine: 'none' }));
    expect(none.request.input).not.toHaveProperty('format');
    expect(interpretOptionsFromEnv({ OPENROUTER_API_KEY: 'k', ENGINE_NL_COMBINE: 'local-first' }).combine).toBe('local-first');
    expect(interpretOptionsFromEnv({ OPENROUTER_API_KEY: 'k', ENGINE_NL_COMBINE: 'quatsch' }).combine).toBeUndefined();
  });

  it('lokal: verneinte Größe/Theme setzt nichts („nicht zu groß“ → live L, „nicht mittelalterlich sondern nordisch“)', () => {
    const v = engine.vocabulary;
    expect(classifyLocal('Gasthaus mit Walmdach, nicht zu groß', v).request.input).not.toHaveProperty('size');
    expect(classifyLocal('Burg, aber bitte nicht mittelalterlich sondern nordisch', v).request.input).toMatchObject({ themeId: 'nordic' });
    expect(classifyLocal('große Taverne, not too small', v).request.input).toMatchObject({ size: 'L' });
  });

  it.each([
    ['Gasthaus, kein Flachdach', 'tavern'],
    ['Taverne, keine 3 Etagen', 'tavern'],
    ['Haus, nicht unterirdisch', 'house'],
    ['Haus, kein NBT', 'house'],
    ['a house without a flat roof', 'house'],
    ['Haus, keine Burg', 'house'],
  ])('fill übernimmt keine verneinte Angabe: %s', async (prompt, buildingTypeId) => {
    const expected = { buildingTypeId };
    expect(classifyLocal(prompt, engine.vocabulary).request.input).toEqual(expected);
    const result = await interpret(prompt, engine, opts(jev([[200, ok(answers({ buildingTypeId: pick(buildingTypeId) }))]])));
    expect(result.request.input).toEqual(expected);
    expect(result.fallback).toBeUndefined();
  });
});

describe('P07: Fähigkeiten aus dem Befehlsschema werden automatisch zur NL-Entscheidung', () => {
  it('`project_furnish` bietet den verbindlichen Mittelgang (boolean) als Frage an', () => {
    const p = decisionPlan(engine.inputSchema('project_furnish'), engine.vocabulary, 5);
    expect(p.questions['minAisle'], `Fragen: ${Object.keys(p.questions).join(', ')}`).toBeDefined();
    expect(p.questions['minAisle']!.type).toBe('noul');
    expect(p.fields.some((f) => f.path === 'minAisle')).toBe(true);
    // Und die Möbeldichte bleibt als Zahl-Frage erhalten (nichts verdrängt).
    expect(p.questions['density']).toBeDefined();
  });
});
describe('P15/P07: Domänen-Fähigkeiten sind automatisch NL-Entscheidungen', () => {
  it('`storyState` ist eine Choice-Frage mit allen fünf Zuständen', () => {
    const p = decisionPlan(engine.inputSchema('building_generate'), engine.vocabulary, 12);
    const q = p.questions['storyState'] as { type: string; criteria: Record<string, string> } | undefined;
    expect(q, `Fragen: ${Object.keys(p.questions).join(', ')}`).toBeDefined();
    expect(q!.type).toBe('choice');
    const werte = Object.keys(q!.criteria);
    expect(werte).toEqual(expect.arrayContaining(['neu', 'bewohnt', 'verlassen', 'verfallen', 'belagert']));
  });

  it('`minAisle` ist eine Ja/Nein-Frage (`noul`) im Einrichtungsbefehl', () => {
    const p = decisionPlan(engine.inputSchema('project_furnish'), engine.vocabulary, 5);
    expect(p.questions['minAisle']).toMatchObject({ type: 'noul' });
  });

  it('W8-D: Fantasy-Kit-Optionen nennen kein Baumaterial („aus Stein“ ist nicht zwergisch)', () => {
    const q = plan.questions['exterior.fantasyKit'] as { type: string; criteria: Record<string, string> } | undefined;
    expect(q?.type).toBe('choice');
    expect(q!.criteria['elven']).toBe('elven: elbisches Fantasy-Kit');
    expect(q!.criteria['dwarven']).toBe('dwarven: zwergisches Fantasy-Kit');
    for (const text of Object.values(q!.criteria)) expect(text).not.toMatch(/Stein|Holz/);
  });
});

/**
 * W1-G (Review R1-02): Lässt JEV den Bautyp offen, ergänzt ihn der lokale Klassifikator – seine Sicherheit steht dann
 * als `confidence.buildingTypeId` in der Antwort (Unsinn 0,3 < `TYPE_CONFIDENCE_MIN`), damit Website und Editor keinen
 * angenommenen Standard als erkannt anzeigen. Antwortet JEV zum Bautyp, bleibt dessen Konfidenz.
 */
describe('JEV ohne Antwort zum Bautyp: lokale Sicherheit in der Antwort', () => {
  it('Unsinn → Haus mit 0,3; Kompositum → 0,8; JEV-Antwort bleibt unverändert', async () => {
    const open = await interpret('asdf qwer', engine, opts(jev([[200, ok(answers({}))]])));
    expect(open).toMatchObject({ request: { input: { buildingTypeId: 'house' } }, confidence: { buildingTypeId: 0.3 } });
    expect(open.confidence!['buildingTypeId']).toBeLessThan(TYPE_CONFIDENCE_MIN);
    const compound = await interpret('Zwergenfestung', engine, opts(jev([[200, ok(answers({}))]])));
    expect(compound).toMatchObject({ request: { input: { buildingTypeId: 'castle_compact' } }, confidence: { buildingTypeId: 0.8 } });
    const sure = await interpret('asdf qwer', engine, opts(jev([[200, ok(answers({ buildingTypeId: pick('tavern', 0.93) }))]])));
    expect(sure).toMatchObject({ request: { input: { buildingTypeId: 'tavern' } }, confidence: { buildingTypeId: 0.93 } });
  });
});
