/** NL-Adapter und HTTP-Server mit gemocktem OpenRouter (kein Netz, kein Schlüssel). */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { engineServer, interpret, interpretOptionsFromEnv, llmSchema, systemPrompt, type PromptLogEntry } from '../src/node/index.js';
import { TYPE_CONFIDENCE_MIN } from '../src/intent/local.js';
import { engine } from './fixture.js';

type Seen = { url: string; body: Record<string, unknown> };
function mockFetch(message: Record<string, unknown>, seen: Seen[] = [], status = 200): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ model: 'mock/model', choices: [{ message }] }), { status });
  }) as typeof fetch;
}
const toolCall = (name: string, args: unknown) => ({ tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] });

describe('interpret (OpenRouter)', () => {
  it('tools-Modus: Tool-Call → Engine-Anfrage; Tools und Vokabular werden mitgeschickt', async () => {
    const seen: Seen[] = [];
    const it1 = await interpret('kleine Hobbithöhle', engine, {
      apiKey: 'k', model: 'm', fetch: mockFetch(toolCall('building_generate', { buildingTypeId: 'hobbit', size: 'S' }), seen),
    });
    expect(it1.request).toEqual({ op: 'building_generate', input: { buildingTypeId: 'hobbit', size: 'S' } });
    expect(seen[0]!.url).toMatch(/\/chat\/completions$/);
    expect((seen[0]!.body['tools'] as unknown[]).length).toBe(engine.stateless.length);
    expect(systemPrompt(engine)).toContain('hobbit');
    expect(engine.execute(it1.request).ok).toBe(true);
  });

  it('json_schema-Modus: Antwort ist direkt { op, input }', async () => {
    const seen: Seen[] = [];
    const r = await interpret('Taverne', engine, {
      apiKey: 'k', model: 'm', mode: 'json_schema',
      fetch: mockFetch({ content: JSON.stringify({ op: 'building_generate', input: { buildingTypeId: 'tavern' } }) }, seen),
    });
    expect(r.request.op).toBe('building_generate');
    expect(seen[0]!.body['response_format']).toMatchObject({ type: 'json_schema' });
  });

  it('Fehler sind lesbar (kein Tool, HTTP-Fehler, Proxy-Text) – ohne Rückfall', async () => {
    await expect(interpret('x', engine, { apiKey: 'k', model: 'm', fallback: false, fetch: mockFetch({ content: 'hallo' }) })).rejects.toThrow(/kein Tool/);
    const text = (async () => new Response('Host not in allowlist', { status: 403 })) as unknown as typeof fetch;
    await expect(interpret('x', engine, { apiKey: 'k', model: 'm', fallback: false, fetch: text })).rejects.toThrow(/403 .*: Host not in allowlist/);
  });

  it('Rückfall: Netzfehler oder ungültige Modell-Antwort → lokaler Klassifikator, Grund wird genannt', async () => {
    const blocked = (async () => new Response('Host not in allowlist', { status: 403 })) as unknown as typeof fetch;
    const a = await interpret('kleine Hobbithöhle', engine, { apiKey: 'k', model: 'm', fetch: blocked });
    expect(a).toMatchObject({ model: 'local', fallback: expect.stringContaining('403'), request: { input: { buildingTypeId: 'hobbit', size: 'S' } } });
    const bad = await interpret('Taverne', engine, { apiKey: 'k', model: 'm', fetch: mockFetch(toolCall('building_generate', { buildingTypeId: 'nope' })) });
    expect(bad).toMatchObject({ model: 'local', fallback: expect.stringContaining('ungültig'), request: { input: { buildingTypeId: 'tavern' } } });
  });

  it('localFirst: sichere lokale Treffer ohne Modellaufruf; Modus local', async () => {
    const seen: Seen[] = [];
    const r = await interpret('Wikinger Langhaus', engine, { apiKey: 'k', model: 'm', localFirst: 0.9, fetch: mockFetch({}, seen) });
    expect(r.model).toBe('local');
    expect(seen).toHaveLength(0);
    expect((await interpret('Burg', engine, { apiKey: '', model: 'local', mode: 'local' })).request.input).toMatchObject({ buildingTypeId: 'castle_compact' });
  });

  it('Umgebung: ohne Schlüssel lokal (bzw. Fehler bei verlangtem Modell), Schlüssel anbieterneutral, Modell konfigurierbar', () => {
    expect(interpretOptionsFromEnv({})).toMatchObject({ mode: 'local', model: 'local' });
    expect(() => interpretOptionsFromEnv({ ENGINE_NL_MODE: 'tools' })).toThrow(/ENGINE_NL_API_KEY/);
    expect(interpretOptionsFromEnv({ ENGINE_NL_API_KEY: 'g', ENGINE_NL_MODEL: 'openai/gpt-oss-20b', ENGINE_NL_BASE_URL: 'https://x/v1' }))
      .toMatchObject({ apiKey: 'g', mode: 'tools', baseUrl: 'https://x/v1' });
    expect(interpretOptionsFromEnv({ OPENROUTER_API_KEY: 'k', ENGINE_NL_MODEL: 'x/y', ENGINE_NL_MODE: 'json_schema' }))
      .toMatchObject({ model: 'x/y', mode: 'json_schema' });
  });
});

/** Antworten der Reihe nach (Status, Body); zählt Aufrufe und merkt sich die Anfrage-Bodies. */
function sequence(steps: ReadonlyArray<readonly [number, unknown, Record<string, string>?]>, seen: Seen[] = []): typeof fetch {
  let i = 0;
  return (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const [status, body, headers] = steps[Math.min(i++, steps.length - 1)]!;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, ...(headers !== undefined ? { headers } : {}) });
  }) as typeof fetch;
}
const okTool = (name: string, args: unknown) => ({ model: 'mock/model', choices: [{ message: toolCall(name, args) }] });
const walk = (v: unknown, f: (k: string, x: unknown) => void): void => {
  if (Array.isArray(v)) v.forEach((x) => walk(x, f));
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { f(k, x); walk(x, f); }
};

describe('Robustheit (Befunde Live-Test 2026-09-24)', () => {
  it('Tool-Schemas für Anbieter: keine prefixItems (Gemini „items: missing field“), Grenzen als Text („too many states“)', async () => {
    const seen: Seen[] = [];
    await interpret('Burg', engine, { apiKey: 'k', model: 'm', fetch: sequence([[200, okTool('building_generate', { buildingTypeId: 'castle_compact' })]], seen) });
    const keys = new Set<string>();
    walk(seen[0]!.body['tools'], (k, x) => { if (typeof x !== 'object' || k === 'prefixItems') keys.add(k); });
    for (const k of ['prefixItems', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength']) expect(keys.has(k), k).toBe(false);
    expect(JSON.stringify(engine.tools(engine.stateless))).toContain('prefixItems'); // Engine selbst bleibt vollständig
    expect(llmSchema({ type: 'integer', minimum: 1, maximum: 5, description: 'Etagen' })).toEqual({ type: 'integer', description: 'Etagen [1–5]' });
    expect(llmSchema({ type: 'array', prefixItems: [{ type: 'integer' }, { type: 'integer' }] })).toEqual({ type: 'array', items: { type: 'integer' }, description: '[2 Werte]' });
  });

  it('Reasoning-Aufwand: bei OpenRouter standardmäßig low (gpt-oss-20b sonst bis 81 s), anderswo nur auf Wunsch', async () => {
    const seen: Seen[] = [];
    const f = sequence([[200, okTool('building_generate', { buildingTypeId: 'house' })]], seen);
    await interpret('Haus', engine, { apiKey: 'k', model: 'm', fetch: f });
    await interpret('Haus', engine, { apiKey: 'k', model: 'm', fetch: f, baseUrl: 'https://x/v1' });
    await interpret('Haus', engine, { apiKey: 'k', model: 'm', fetch: f, baseUrl: 'https://x/v1', reasoning: 'medium' });
    await interpret('Haus', engine, { apiKey: 'k', model: 'm', fetch: f, reasoning: 'off' });
    expect(seen[0]!.body['reasoning']).toEqual({ effort: 'low' });
    expect(seen[1]!.body).not.toHaveProperty('reasoning');
    expect(seen[1]!.body).not.toHaveProperty('reasoning_effort');
    expect(seen[2]!.body['reasoning_effort']).toBe('medium');
    expect(seen[3]!.body).not.toHaveProperty('reasoning');
  });

  it('401: kein Wiederholungsversuch, Klartext ohne Schlüssel, lokaler Rückfall nennt den Grund', async () => {
    const seen: Seen[] = [];
    const f = sequence([[401, { error: { message: 'User not found.', code: 401 } }]], seen);
    const secret = 'sk-test-geheim';
    await expect(interpret('x', engine, { apiKey: secret, model: 'm', fallback: false, fetch: f })).rejects.toThrow(/401 \(Schlüssel ungültig.*ENGINE_NL_API_KEY/);
    expect(seen).toHaveLength(1);
    const r = await interpret('kleine Hobbithöhle', engine, { apiKey: secret, model: 'm', fetch: f });
    expect(r).toMatchObject({ model: 'local', fallback: expect.stringContaining('401'), request: { input: { buildingTypeId: 'hobbit' } } });
    expect(r.fallback).not.toContain(secret);
  });

  it('429/5xx: ein Wiederholungsversuch (Retry-After beachtet), dann Erfolg oder Rückfall mit Klartext', async () => {
    const seen: Seen[] = [];
    const ok = await interpret('Taverne', engine, {
      apiKey: 'k', model: 'm', fetch: sequence([[429, { error: { message: 'Rate limit exceeded' } }, { 'retry-after': '0.01' }], [200, okTool('building_generate', { buildingTypeId: 'tavern' })]], seen),
    });
    expect(seen).toHaveLength(2);
    expect(ok.model).toBe('mock/model');
    const seen2: Seen[] = [];
    const down = await interpret('Taverne', engine, { apiKey: 'k', model: 'm', fetch: sequence([[503, 'Service Unavailable']], seen2) });
    expect(seen2).toHaveLength(2);
    expect(down).toMatchObject({ model: 'local', fallback: expect.stringMatching(/503 \(Anbieter-Fehler\)/) });
    await expect(interpret('x', engine, { apiKey: 'k', model: 'm', fallback: false, retries: 0, fetch: sequence([[429, { error: { message: 'slow down' } }]]) }))
      .rejects.toThrow(/429 \(Rate-Limit erreicht\)/);
  });

  it('Zeitlimit je Versuch → Klartext, mit Rückfall lokal', async () => {
    let calls = 0;
    const hang = ((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      calls++;
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    await expect(interpret('x', engine, { apiKey: 'k', model: 'm', fallback: false, timeoutMs: 30, retries: 1, fetch: hang })).rejects.toThrow(/Zeitlimit 30 ms/);
    expect(calls).toBe(2);
    const r = await interpret('Burg', engine, { apiKey: 'k', model: 'm', timeoutMs: 30, retries: 0, fetch: hang });
    expect(r).toMatchObject({ model: 'local', fallback: expect.stringContaining('Zeitlimit'), request: { input: { buildingTypeId: 'castle_compact' } } });
  });

  it('ungültiges JSON (Antwort oder Tool-Argumente) → lokaler Rückfall mit Klartext', async () => {
    const a = await interpret('Burg', engine, { apiKey: 'k', model: 'm', fetch: sequence([[200, '<html>gateway</html>']]) });
    expect(a).toMatchObject({ model: 'local', fallback: expect.stringContaining('kein JSON') });
    const b = await interpret('Burg', engine, { apiKey: 'k', model: 'm', fetch: sequence([[200, { choices: [{ message: { tool_calls: [{ function: { name: 'building_generate', arguments: '{buildingTypeId:' } }] } }] }]]) });
    expect(b).toMatchObject({ model: 'local', fallback: expect.stringContaining('kein JSON') });
  });

  it('Anbieter-Detail (metadata.raw) erscheint in der Meldung', async () => {
    const raw = JSON.stringify({ error: { code: 400, message: 'The specified schema produces a constraint that has too many states' } });
    await expect(interpret('x', engine, {
      apiKey: 'k', model: 'm', fallback: false, fetch: sequence([[400, { error: { message: 'Provider returned error', metadata: { raw, provider_name: 'Google AI Studio' } } }]]),
    })).rejects.toThrow(/400 \(Anfrage abgelehnt\): Provider returned error \(Google AI Studio\): The specified schema .*too many states/);
  });

  it('leerer Prompt: klarer Fehler ohne Modellaufruf (Modell antwortete live mit Text statt Tool)', async () => {
    const seen: Seen[] = [];
    await expect(interpret('   ', engine, { apiKey: 'k', model: 'm', fetch: sequence([[200, {}]], seen) })).rejects.toThrow(/Prompt ist leer/);
    expect(seen).toHaveLength(0);
  });

  it('Umgebung: Zeitlimit, Wiederholungen, Reasoning', () => {
    expect(interpretOptionsFromEnv({ ENGINE_NL_API_KEY: 'k', ENGINE_NL_TIMEOUT_MS: '5000', ENGINE_NL_RETRIES: '0', ENGINE_NL_REASONING: 'off' }))
      .toMatchObject({ timeoutMs: 5000, retries: 0, reasoning: 'off' });
    expect(interpretOptionsFromEnv({ ENGINE_NL_API_KEY: 'k', ENGINE_NL_TIMEOUT_MS: 'x', ENGINE_NL_REASONING: 'turbo' })).not.toHaveProperty('timeoutMs');
    expect(interpretOptionsFromEnv({ ENGINE_NL_API_KEY: 'k', ENGINE_NL_REASONING: 'turbo' })).not.toHaveProperty('reasoning');
  });
});

describe('HTTP-Server', () => {
  const logged: PromptLogEntry[] = [];
  const server = engineServer(engine, {
    log: (e) => logged.push(e),
    interpret: { apiKey: 'k', model: 'm', fetch: mockFetch(toolCall('building_generate', { buildingTypeId: 'house', surroundings: false })) },
  });
  let base = '';
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('GET /v1/tools, /v1/schema, /v1/operations', async () => {
    expect(((await (await fetch(`${base}/v1/tools`)).json()) as unknown[]).length).toBe(engine.operations.length);
    expect(await (await fetch(`${base}/v1/schema`)).json()).toMatchObject({ oneOf: expect.any(Array) });
    expect(((await (await fetch(`${base}/v1/operations`)).json()) as unknown[]).length).toBe(engine.operations.length);
  });

  it('POST /v1/execute: JSON und Datei', async () => {
    const body = JSON.stringify({ op: 'building_generate', input: { buildingTypeId: 'house', surroundings: false, format: 'schem' } });
    const j = (await (await fetch(`${base}/v1/execute`, { method: 'POST', body, headers: { 'content-type': 'application/json' } })).json()) as { ok: boolean; data: { blocks: number } };
    expect(j.ok).toBe(true);
    const f = await fetch(`${base}/v1/execute?file=1`, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
    expect(f.headers.get('content-disposition')).toMatch(/\.schem"/);
    expect((await f.arrayBuffer()).byteLength).toBeGreaterThan(100);
    const bad = await fetch(`${base}/v1/execute`, { method: 'POST', body: JSON.stringify({ op: 'building_generate', input: {} }), headers: { 'content-type': 'application/json' } });
    expect(bad.status).toBe(400);
  });

  it('POST /v1/prompt: NL → Anfrage → Ergebnis', async () => {
    const r = await fetch(`${base}/v1/prompt`, { method: 'POST', body: JSON.stringify({ prompt: 'ein kleines Haus' }), headers: { 'content-type': 'application/json' } });
    const j = (await r.json()) as { ok: boolean; request: { input: { buildingTypeId: string } }; model: string };
    expect(j.ok).toBe(true);
    expect(j.request.input.buildingTypeId).toBe('house');
    expect(j.model).toBe('mock/model');
    expect(logged).toMatchObject([{ prompt: 'ein kleines Haus', model: 'mock/model', ok: true, request: { op: 'building_generate' } }]);
  });

  it('POST /v1/interpret: NL → Anfrage ohne Ausführung (Web-App), Log-Eintrag', async () => {
    const before = logged.length;
    const r = await fetch(`${base}/v1/interpret`, { method: 'POST', body: JSON.stringify({ prompt: 'ein kleines Haus' }), headers: { 'content-type': 'application/json' } });
    const j = (await r.json()) as { ok: boolean; request: { op: string; input: { buildingTypeId: string } }; model: string; data?: unknown };
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ ok: true, model: 'mock/model', request: { op: 'building_generate', input: { buildingTypeId: 'house' } } });
    expect(j.data).toBeUndefined(); // nichts gebaut
    expect(logged.length).toBe(before + 1);
    expect((await fetch(`${base}/v1/interpret`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status).toBe(400);
  });

  it('CORS: erlaubter Ursprung bekommt Kopfzeilen und Preflight, fremder nicht', async () => {
    const pre = await fetch(`${base}/v1/interpret`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/content-type/);
    const evil = await fetch(`${base}/v1/tools`, { headers: { origin: 'https://example.com' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('POST /v1/prompt ohne Rückfall: Modellfehler → 502 mit Klartext', async () => {
    const strict = engineServer(engine, { interpret: { apiKey: 'k', model: 'm', fallback: false, retries: 0, fetch: sequence([[401, { error: { message: 'User not found.' } }]]) } });
    await new Promise<void>((r) => strict.listen(0, '127.0.0.1', r));
    try {
      const r = await fetch(`http://127.0.0.1:${(strict.address() as AddressInfo).port}/v1/prompt`, { method: 'POST', body: JSON.stringify({ prompt: 'Haus' }), headers: { 'content-type': 'application/json' } });
      expect(r.status).toBe(502);
      expect(((await r.json()) as { errors: string[] }).errors[0]).toMatch(/401/);
    } finally {
      await new Promise<void>((r) => strict.close(() => r()));
    }
  });
});

describe('Nur angebotene Operationen (Review M2)', () => {
  it('Modell wählt project_delete → lokaler Rückfall mit Grund; ohne Rückfall Fehler; /v1/prompt führt nichts Zustandsbehaftetes aus', async () => {
    const f = () => sequence([[200, okTool('project_delete', { projectId: 'p1' })]]);
    const r = await interpret('kleine Hobbithöhle', engine, { apiKey: 'k', model: 'm', fetch: f() });
    expect(r).toMatchObject({ model: 'local', fallback: expect.stringContaining('project_delete'), request: { op: 'building_generate' } });
    const json = await interpret('Taverne', engine, {
      apiKey: 'k', model: 'm', mode: 'json_schema', fetch: sequence([[200, { choices: [{ message: { content: JSON.stringify({ op: 'project_create', input: {} }) } }] }]]),
    });
    expect(json).toMatchObject({ model: 'local', fallback: expect.stringContaining('project_create') });
    await expect(interpret('x', engine, { apiKey: 'k', model: 'm', fallback: false, fetch: f() })).rejects.toThrow(/nicht angeboten/);
    // ausdrücklich angebotene Operation bleibt erlaubt
    const offered = await interpret('x', engine, { apiKey: 'k', model: 'm', operations: ['project_delete'], fetch: f() });
    expect(offered).toMatchObject({ model: 'mock/model', request: { op: 'project_delete' } });
    // Server: selbst mit so konfiguriertem Adapter keine zustandsbehaftete Operation über /v1/prompt
    const srv = engineServer(engine, { interpret: { apiKey: 'k', model: 'm', operations: ['project_create'], fetch: sequence([[200, okTool('project_create', {})]]) } });
    await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
    try {
      const u = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const p = await fetch(`${u}/v1/prompt`, { method: 'POST', body: JSON.stringify({ prompt: 'Haus' }), headers: { 'content-type': 'application/json' } });
      expect(p.status).toBe(400);
      expect(((await p.json()) as { errors: string[] }).errors[0]).toMatch(/project_create.*nicht erlaubt/);
      const list = await fetch(`${u}/v1/execute`, { method: 'POST', body: JSON.stringify({ op: 'project_list', input: {} }), headers: { 'content-type': 'application/json' } });
      expect(((await list.json()) as { data: unknown[] }).data).toEqual([]);
    } finally {
      await new Promise<void>((res) => srv.close(() => res()));
    }
  });
});

/**
 * W1-G (S2 / Review R1-02): Lokal erkannt (Modus local oder Rückfall) liefert der Server die Sicherheit zum Bautyp im
 * Format von JEV (`confidence: { buildingTypeId: 0–1 }`). Unter `TYPE_CONFIDENCE_MIN` gilt kein Bautyp als erkannt –
 * Website und Editor schlagen dann nichts vor („Kein Bautyp sicher erkannt – bitte wähle einen“).
 */
describe('Sicherheit zum Bautyp bei lokaler Erkennung', () => {
  const LOCAL = { apiKey: '', model: 'local', mode: 'local' as const };

  it('interpret: 1 genannt, 0,8 Kompositum, 0,3 angenommen – auch als Rückfall', async () => {
    expect((await interpret('Taverne mit Flachdach', engine, LOCAL)).confidence).toEqual({ buildingTypeId: 1 });
    const compound = await interpret('Zwergenfestung', engine, LOCAL);
    expect(compound).toMatchObject({ request: { input: { buildingTypeId: 'castle_compact' } }, confidence: { buildingTypeId: 0.8 } });
    expect(compound.confidence!['buildingTypeId']).toBeGreaterThanOrEqual(TYPE_CONFIDENCE_MIN);
    const unsure = await interpret('asdf qwer', engine, LOCAL);
    expect(unsure).toMatchObject({ model: 'local', request: { input: { buildingTypeId: 'house' } }, confidence: { buildingTypeId: 0.3 } });
    expect(unsure.confidence!['buildingTypeId']).toBeLessThan(TYPE_CONFIDENCE_MIN);
    const blocked = (async () => new Response('Host not in allowlist', { status: 403 })) as unknown as typeof fetch;
    expect(await interpret('asdf qwer', engine, { apiKey: 'k', model: 'm', fetch: blocked }))
      .toMatchObject({ model: 'local', fallback: expect.stringContaining('403'), confidence: { buildingTypeId: 0.3 } });
  });

  it('POST /v1/interpret: confidence.buildingTypeId in der Antwort', async () => {
    const srv = engineServer(engine, { interpret: LOCAL });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const ask = async (prompt: string) => (await (await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1/interpret`, {
        method: 'POST', body: JSON.stringify({ prompt }), headers: { 'content-type': 'application/json' },
      })).json()) as { ok: boolean; model: string; confidence?: Record<string, number> };
      expect(await ask('asdf qwer')).toMatchObject({ ok: true, model: 'local', confidence: { buildingTypeId: 0.3 } });
      expect(await ask('kleiner Wachturm')).toMatchObject({ ok: true, model: 'local', confidence: { buildingTypeId: 1 } });
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
