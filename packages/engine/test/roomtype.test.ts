/**
 * `roomtype_classify` offline: Optionen automatisch aus dem Raumtyp-Katalog, lokaler Rückfall (Katalognamen +
 * Schlüsselwörter), JEV über @mcda/classify mit gemocktem fetch (Anfrage-Form, Fehler → Rückfall), Anbindung an
 * HTTP-Server und MCP, Anbieterwahl/Env-Regel der Engine. Kein Netz, kein Schlüssel.
 */
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ROOMTYPE_CLASSIFY, classifyRoomTypeLocal, roomTypeTask } from '../src/index.js';
import {
  DEFAULT_MODEL, engineMcpServer, engineServer, executeRoomTypeClassify, interpret, interpretOptionsFromEnv, type InterpretOptions,
} from '../src/node/index.js';
import { engine } from './fixture.js';

type Seen = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
function jev(steps: ReadonlyArray<readonly [number, unknown]>, seen: Seen[] = []): typeof fetch {
  let i = 0;
  return (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const [status, body] = steps[Math.min(i++, steps.length - 1)]!;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}
const library = { model: 'typesafe/jev-1.13-20260917', answers: { label: { type: 'choice', choice: 'library', confidence: 0.97, probabilities: { library: 0.97, study: 0.03 } } } };
const opts = (f: typeof fetch, extra: Partial<InterpretOptions> = {}): InterpretOptions => ({ apiKey: 'k', model: DEFAULT_MODEL, mode: 'decisions', fetch: f, ...extra });
type Data = { roomTypeId: string | null; name: string | null; confidence: number; model: string; fallback?: string; ranked: Array<{ roomTypeId: string; probability: number }> };

describe('Optionen aus dem Katalog', () => {
  it('jede Raumtyp-ID mit Katalognamen; neue Katalogdatei = neue Option', () => {
    const t = roomTypeTask(engine.vocabulary);
    expect(t.options.map((o) => o.id)).toEqual(engine.vocabulary.roomTypes.map((r) => r.id));
    expect(t.options.find((o) => o.id === 'library')?.description).toMatch(/^Bibliothek/);
    // Kennzeichen (Signatur-Tags) des Katalogs beschreiben den Raum fürs Modell – automatisch, ohne Pflegeliste
    expect(t.options.find((o) => o.id === 'dungeon')?.description).toMatch(/^Kerker – .*prison cell/);
    expect(engine.inputSchema(ROOMTYPE_CLASSIFY)).toMatchObject({ required: ['description'] });
  });
});

describe('lokaler Rückfall (Schlüsselwörter, Katalognamen)', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['Raum voller Bücher', 'library'],
    ['gemütliche Bibliothek mit Leseecke', 'library'],
    ['Küche mit großem Herd', 'kitchen'],
    ['a room with a bed and a nightstand', 'bedroom'],
    ['Schmiede mit Amboss und Esse', 'smithy'],
    ['Weinkeller mit Fässern', 'wine_cellar'],
    ['Thronsaal für den König', 'throne_room'],
    ['Redstone-Werkstatt mit Kolben', 'workshop_redstone'],
    ['Stall für Pferde', 'stable'],
    ['Portalraum zum Nether', 'portal_room'],
    ['dunkler Keller mit Gitterzellen', 'dungeon'],
  ];
  for (const [text, id] of cases) {
    it(`${text} → ${id}`, () => {
      const g = classifyRoomTypeLocal(text, engine.vocabulary);
      expect(g.roomTypeId).toBe(id);
      expect(g.confidence).toBeGreaterThan(0);
    });
  }

  it('ohne Treffer: null, Konfidenz 0; reine Operation liefert dieselbe Form wie mit Modell', () => {
    expect(classifyRoomTypeLocal('xyz qwrt', engine.vocabulary)).toMatchObject({ roomTypeId: null, confidence: 0, ranked: [] });
    const r = engine.execute({ op: ROOMTYPE_CLASSIFY, input: { description: 'Raum voller Bücher' } });
    expect(r).toMatchObject({ ok: true, data: { roomTypeId: 'library', name: 'Bibliothek', confidence: 1, model: 'local' } });
    expect(engine.execute({ op: ROOMTYPE_CLASSIFY, input: { description: '  ' } }).ok).toBe(false);
  });
});

describe('mit JEV über @mcda/classify (gemocktes fetch)', () => {
  it('eine choice-Frage über alle Raumtypen an die Decisions-API; Antwort mit Name, Konfidenz, Kandidaten', async () => {
    const seen: Seen[] = [];
    const r = await executeRoomTypeClassify(engine, { description: 'Raum voller Bücher' }, opts(jev([[200, library]], seen)));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(seen[0]!.headers['authorization']).toBe('Bearer k');
    expect(seen[0]!.body).toMatchObject({ model: 'typesafe/jev-1.13', state: 'Raum voller Bücher' });
    const q = (seen[0]!.body['questions'] as Record<string, { type: string; criteria: Record<string, string> }>)['label']!;
    expect(q.type).toBe('choice');
    expect(Object.keys(q.criteria)).toEqual(engine.vocabulary.roomTypes.map((x) => x.id));
    expect(r).toMatchObject({ ok: true, data: { roomTypeId: 'library', name: 'Bibliothek', confidence: 0.97, model: 'typesafe/jev-1.13-20260917' } });
    expect((r as unknown as { data: Data }).data.ranked[0]).toMatchObject({ roomTypeId: 'library', probability: 0.97 });
    expect((r as unknown as { data: Data }).data.fallback).toBeUndefined();
  });

  it('Fehler (401, unbekannte Option, Zeitlimit) → lokaler Rückfall mit Grund; ohne Rückfall ein Fehler', async () => {
    const e401 = await executeRoomTypeClassify(engine, { description: 'Raum voller Bücher' }, opts(jev([[401, { error: { message: 'User not found.' } }]])));
    expect(e401).toMatchObject({ ok: true, data: { roomTypeId: 'library', model: 'local', fallback: expect.stringMatching(/401 \(Schlüssel ungültig/) } });
    const bogus = { answers: { label: { type: 'choice', choice: 'nope', confidence: 1, probabilities: {} } } };
    const u = await executeRoomTypeClassify(engine, { description: 'Küche' }, opts(jev([[200, bogus]])));
    expect(u).toMatchObject({ ok: true, data: { roomTypeId: 'kitchen', model: 'local', fallback: expect.stringMatching(/unbekannte Option/) } });
    const hang = (async (_u: string | URL, init?: RequestInit) => new Promise<Response>((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
    const t = await executeRoomTypeClassify(engine, { description: 'Küche' }, opts(hang, { timeoutMs: 30, retries: 0 }));
    expect((t as unknown as { data: Data }).data.fallback).toMatch(/Zeitlimit 30 ms/);
    const strict = await executeRoomTypeClassify(engine, { description: 'Küche' }, opts(jev([[401, { error: { message: 'x' } }]]), { fallback: false }));
    expect(strict).toMatchObject({ ok: false, errors: [expect.stringMatching(/401/)] });
  });

  it('ohne Modell (lokal oder Chat-Modell) kein Netzaufruf; ungültige Eingabe wie execute', async () => {
    const seen: Seen[] = [];
    const f = jev([[200, library]], seen);
    expect(await executeRoomTypeClassify(engine, { description: 'Küche' }, { apiKey: '', model: 'local', mode: 'local', fetch: f })).toMatchObject({ data: { model: 'local' } });
    expect(await executeRoomTypeClassify(engine, { description: 'Küche' }, { apiKey: 'k', model: 'openai/gpt-oss-20b', fetch: f })).toMatchObject({ data: { model: 'local' } });
    expect(await executeRoomTypeClassify(engine, { description: '' }, opts(f))).toMatchObject({ ok: false });
    expect(seen).toHaveLength(0);
  });

  it('HTTP /v1/execute und MCP-Tool nutzen das Modell', async () => {
    const server = engineServer(engine, { interpret: opts(jev([[200, library]])) });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const r = await fetch(`${base}/v1/execute`, { method: 'POST', body: JSON.stringify({ op: ROOMTYPE_CLASSIFY, input: { description: 'Raum voller Bücher' } }), headers: { 'content-type': 'application/json' } });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ok: true, data: { roomTypeId: 'library', model: 'typesafe/jev-1.13-20260917' } });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
    const client = new Client({ name: 't', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await engineMcpServer(engine, { outDir: mkdtempSync(join(tmpdir(), 'engine-rt-')), interpret: opts(jev([[200, library]])) }).connect(a);
    await client.connect(b);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain(ROOMTYPE_CLASSIFY);
      const res = await client.callTool({ name: ROOMTYPE_CLASSIFY, arguments: { description: 'Raum voller Bücher' } });
      expect(JSON.parse((res as { content: { text: string }[] }).content[0]!.text)).toMatchObject({ roomTypeId: 'library', model: 'typesafe/jev-1.13-20260917' });
    } finally {
      await client.close();
    }
  });
});

describe('Anbieterwahl und Env-Regel der Engine (über @mcda/classify)', () => {
  it('Key: ENGINE_NL_API_KEY → CLASSIFIER_API_KEY → OPENROUTER_API_KEY; bisherige Variablen gelten weiter', () => {
    expect(interpretOptionsFromEnv({ ENGINE_NL_API_KEY: 'e', CLASSIFIER_API_KEY: 'c', OPENROUTER_API_KEY: 'o' }).apiKey).toBe('e');
    expect(interpretOptionsFromEnv({ CLASSIFIER_API_KEY: 'c', OPENROUTER_API_KEY: 'o' }).apiKey).toBe('c');
    expect(interpretOptionsFromEnv({ OPENROUTER_API_KEY: 'o' })).toMatchObject({ apiKey: 'o', mode: 'decisions', model: 'typesafe/jev-1.13' });
    expect(interpretOptionsFromEnv({ OPENROUTER_API_KEY: 'o', CLASSIFIER_MODEL: 'jev-latest' }).model).toBe('jev-latest');
    expect(interpretOptionsFromEnv({ OPENROUTER_API_KEY: 'o', CLASSIFIER_MODEL: 'jev-latest', ENGINE_NL_MODEL: 'typesafe/jev-1.13' }).model).toBe('typesafe/jev-1.13');
    expect(interpretOptionsFromEnv({ OPENROUTER_API_KEY: 'o', CLASSIFIER_TIMEOUT_MS: '700', ENGINE_NL_RETRIES: '0' })).toMatchObject({ timeoutMs: 700, retries: 0 });
  });

  it('CLASSIFIER_PROVIDER: typesafe (TYPESAFE_API_KEY, eigener Endpunkt) und kev (ohne Key) erzwingen decisions', async () => {
    const ts = interpretOptionsFromEnv({ CLASSIFIER_PROVIDER: 'typesafe', TYPESAFE_API_KEY: 't', OPENROUTER_API_KEY: 'o' });
    expect(ts).toMatchObject({ provider: 'typesafe', apiKey: 't', model: 'jev-1.13', mode: 'decisions' });
    expect(interpretOptionsFromEnv({ CLASSIFIER_PROVIDER: 'typesafe', OPENROUTER_API_KEY: 'o' })).toMatchObject({ mode: 'local' });
    const kev = interpretOptionsFromEnv({ CLASSIFIER_PROVIDER: 'kev', CLASSIFIER_BASE_URL: 'http://kev:9000' });
    expect(kev).toMatchObject({ provider: 'kev', apiKey: '', model: 'kev-latest', mode: 'decisions', decisionsUrl: 'http://kev:9000/v1/systemone' });
    expect(() => interpretOptionsFromEnv({ CLASSIFIER_PROVIDER: 'nope' })).toThrow(/Unbekannter CLASSIFIER_PROVIDER/);

    const seen: Seen[] = [];
    const answers = { answers: { buildingTypeId: { type: 'choice', choice: 'tavern', confidence: 0.9, probabilities: { tavern: 0.9 } } } };
    await interpret('Taverne', engine, { ...ts, fetch: jev([[200, answers]], seen) });
    expect(seen[0]!.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(seen[0]!.headers['authorization']).toBe('Bearer t');
    const r = await executeRoomTypeClassify(engine, { description: 'Bücher' }, { ...kev, fetch: jev([[200, library]], seen) });
    expect(seen[1]!.url).toBe('http://kev:9000/v1/systemone');
    expect(seen[1]!.headers['authorization']).toBeUndefined();
    expect(r).toMatchObject({ data: { roomTypeId: 'library' } });
  });
});
