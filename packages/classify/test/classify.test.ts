import { describe, expect, it } from 'vitest';
import { classify, createSystemOneProvider, DecisionError, DEFAULT_DECISIONS_URL, MAX_CHOICES, NONE_OF_THESE, postJson, splitChoices, type FetchLike } from '../src/index.js';
import { configFromEnv, providerFromEnv, resolveEnv } from '../src/env.js';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function fakeFetch(respond: (body: any) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const r = respond(body);
    const status = r.status ?? 200;
    return { ok: status < 300, status, text: async () => r.text ?? JSON.stringify(r.json) };
  };
  return { fetch, calls };
}

const choiceAnswer = (probabilities: Record<string, number>) => {
  const [choice] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]!;
  return { type: 'choice', choice, confidence: 0.5, probabilities };
};

describe('System-One-Anbieter', () => {
  it('schickt Modell, Zustand und Fragen und setzt den Bearer-Key', async () => {
    const { fetch, calls } = fakeFetch(() => ({
      // Form wie die echte OpenRouter-Antwort: "jev-latest" kommt als aufgelöste Version zurück; id und provider werden ignoriert, cost bleibt.
      json: { model: 'typesafe/jev-1.13-20260917', answers: { ok: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 12, output_tokens: 3, cost: 0.00001 }, id: 'gen-dec-1', provider: 'TypeSafe', latency_ms: 170 },
    }));
    const p = createSystemOneProvider({ name: 't', baseUrl: 'https://x.test/api/alpha/', path: '/decisions', model: 'jev-latest', apiKey: 'sk-test', fetch });
    const res = await p.decide({ state: 'hallo', questions: { ok: { type: 'noul', instructions: 'Ist das ein Gruß?' } } });

    expect(calls[0]!.url).toBe('https://x.test/api/alpha/decisions');
    expect(calls[0]!.headers['authorization']).toBe('Bearer sk-test');
    expect(calls[0]!.body).toEqual({ model: 'jev-latest', state: 'hallo', questions: { ok: { type: 'noul', instructions: 'Ist das ein Gruß?' } } });
    expect(res).toEqual({ model: 'typesafe/jev-1.13-20260917', answers: { ok: { type: 'noul', noul: 0.9 } }, usage: { inputTokens: 12, outputTokens: 3, cost: 0.00001 }, latencyMs: 170 });
  });

  it('liest score-Antworten mit Legende', async () => {
    const { fetch } = fakeFetch(() => ({
      json: { answers: { s: { score: 1.4, confidence: 0.8, legend: { '0': 'klein', '1': 'mittel', '2': 'groß' }, probabilities: { '0': 0, '1': 0.6, '2': 0.4 } } } },
    }));
    const p = createSystemOneProvider({ name: 't', baseUrl: 'http://k', path: 'v1/systemone', model: 'kev-latest', fetch });
    const res = await p.decide({ state: 'x', questions: { s: { type: 'score', instructions: 'Wie groß?', criteria: ['klein', 'mittel', 'groß'] } } });
    expect(res.model).toBe('kev-latest');
    expect(res.answers['s']).toMatchObject({ type: 'score', score: 1.4, legend: { '1': 'mittel' } });
  });

  it('meldet HTTP-Fehler und fehlende Antworten als DecisionError', async () => {
    const q = { questions: { a: { type: 'noul', instructions: '?' } } } as const;
    const err = createSystemOneProvider({ name: 't', baseUrl: 'http://k', path: '/d', model: 'm', fetch: fakeFetch(() => ({ status: 401, text: 'nope' })).fetch });
    await expect(err.decide({ state: 'x', ...q })).rejects.toThrow(/401 \(Schlüssel ungültig/);
    await expect(err.decide({ state: 'x', ...q })).rejects.toMatchObject({ name: 'DecisionError', status: 401, body: 'nope' });

    const missing = createSystemOneProvider({ name: 't', baseUrl: 'http://k', path: '/d', model: 'm', retries: 0, fetch: fakeFetch(() => ({ json: { answers: {} } })).fetch });
    await expect(missing.decide({ state: 'x', ...q })).rejects.toBeInstanceOf(DecisionError);
  });
});

describe('classify', () => {
  it('baut eine choice-Frage und sortiert nach Wahrscheinlichkeit', async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { answers: { label: choiceAnswer({ library: 0.7, study: 0.2, kitchen: 0.1 }) } } }));
    const p = createSystemOneProvider({ name: 't', baseUrl: 'http://k', path: '/d', model: 'm', fetch });
    const res = await classify(p, 'Regale voller Bücher und ein Lesepult', { instructions: 'Welcher Raumtyp?', options: [
      { id: 'kitchen', description: 'Küche' },
      { id: 'library', description: 'Bibliothek' },
      { id: 'study', description: 'Arbeitszimmer' },
    ] });

    expect(calls[0]!.body.questions.label.criteria).toEqual({ kitchen: 'Küche', library: 'Bibliothek', study: 'Arbeitszimmer' });
    expect(res.label).toBe('library');
    expect(res.ranked.map((r) => r.label)).toEqual(['library', 'study', 'kitchen']);
  });

  it('lehnt unbekannte Antwort-Optionen und doppelte Optionen ab', async () => {
    const p = createSystemOneProvider({ name: 't', baseUrl: 'http://k', path: '/d', model: 'm', fetch: fakeFetch(() => ({ json: { answers: { label: choiceAnswer({ zzz: 1 }) } } })).fetch });
    await expect(classify(p, 'x', { instructions: '?', options: [{ id: 'a' }] })).rejects.toThrow(/unbekannte Option/);
    await expect(classify(p, 'x', { instructions: '?', options: [{ id: 'a' }, { id: 'a' }] })).rejects.toThrow(/doppelt/);
  });
});

describe('Konfiguration aus der Umgebung', () => {
  it('nimmt standardmäßig Jev über OpenRouter mit OPENROUTER_API_KEY', () => {
    const c = configFromEnv({ OPENROUTER_API_KEY: 'k1' });
    expect(c).toMatchObject({ name: 'jev-openrouter', baseUrl: 'https://openrouter.ai/api/alpha', path: '/decisions', apiKey: 'k1' });
  });

  it('lässt URL, Pfad und Modell überschreiben und wechselt den Anbieter', () => {
    const c = configFromEnv({ CLASSIFIER_PROVIDER: 'kev', CLASSIFIER_BASE_URL: 'https://kev.example', CLASSIFIER_MODEL: 'kev-9b' });
    expect(c).toMatchObject({ name: 'kev', baseUrl: 'https://kev.example', path: '/v1/systemone', model: 'kev-9b' });
    expect(c.apiKey).toBeUndefined();
  });

  it('verlangt für Jev einen Key und kennt nur bekannte Anbieter', () => {
    expect(() => configFromEnv({})).toThrow(/OPENROUTER_API_KEY/);
    expect(() => configFromEnv({ CLASSIFIER_PROVIDER: 'foo', CLASSIFIER_API_KEY: 'k' })).toThrow(/Unbekannter/);
  });

  it('Regel: Aufrufer-Variable (overrides, z. B. ENGINE_NL_*) → CLASSIFIER_* → Key/Modell/URL des Anbieters', () => {
    const env = { OPENROUTER_API_KEY: 'or', CLASSIFIER_API_KEY: 'cl', CLASSIFIER_MODEL: 'jev-latest', CLASSIFIER_TIMEOUT_MS: '500', CLASSIFIER_RETRIES: '2' };
    expect(configFromEnv(env)).toMatchObject({ apiKey: 'cl', model: 'jev-latest', timeoutMs: 500, retries: 2 });
    expect(configFromEnv(env, undefined, { apiKey: 'eng', model: 'typesafe/jev-1.13', url: 'https://x/d', timeoutMs: 50, retries: 0 }))
      .toMatchObject({ apiKey: 'eng', model: 'typesafe/jev-1.13', baseUrl: 'https://x/d', path: '', timeoutMs: 50, retries: 0 });
    // leere Werte zählen als nicht gesetzt
    expect(configFromEnv({ ...env, CLASSIFIER_API_KEY: '' }, undefined, { apiKey: '' }).apiKey).toBe('or');
    // Standard: festgepinntes Modell, Endpunkt der Decisions-API
    expect(configFromEnv({ OPENROUTER_API_KEY: 'or' })).toMatchObject({ model: 'typesafe/jev-1.13' });
    expect(DEFAULT_DECISIONS_URL).toBe('https://openrouter.ai/api/alpha/decisions');
  });

  it('Key je Anbieter: typesafe nimmt TYPESAFE_API_KEY (nicht OPENROUTER_API_KEY), Kev braucht keinen', () => {
    expect(configFromEnv({ CLASSIFIER_PROVIDER: 'typesafe', TYPESAFE_API_KEY: 'ts', OPENROUTER_API_KEY: 'or' })).toMatchObject({ name: 'typesafe', apiKey: 'ts', model: 'jev-1.13' });
    expect(() => configFromEnv({ CLASSIFIER_PROVIDER: 'typesafe', OPENROUTER_API_KEY: 'or' })).toThrow(/TYPESAFE_API_KEY/);
    expect(resolveEnv({ CLASSIFIER_PROVIDER: 'kev' })).toMatchObject({ provider: 'kev', missingKey: false });
    expect(resolveEnv({})).toMatchObject({ provider: 'jev-openrouter', missingKey: true, keyVars: ['CLASSIFIER_API_KEY', 'OPENROUTER_API_KEY'] });
    expect(configFromEnv({ CLASSIFIER_PROVIDER: 'kev', KEV_API_KEY: 'kk' }).apiKey).toBe('kk');
  });

  it('providerFromEnv liefert einen nutzbaren Anbieter', async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { answers: { label: choiceAnswer({ a: 1 }) } } }));
    const p = providerFromEnv({ CLASSIFIER_API_KEY: 'k2' }, fetch);
    await classify(p, 'x', { instructions: '?', options: [{ id: 'a' }] });
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(calls[0]!.headers['authorization']).toBe('Bearer k2');
  });
});

describe('Anbieter offline (gemocktes fetch)', () => {
  it('typesafe: POST https://api.typesafe.ai/v1/systemone, Bearer TYPESAFE_API_KEY, bare Modell-ID', async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { model: 'jev-1.13', answers: { label: choiceAnswer({ a: 0.8, b: 0.2 }) } } }));
    const r = await classify(providerFromEnv({ CLASSIFIER_PROVIDER: 'typesafe', TYPESAFE_API_KEY: 'ts' }, fetch), 'x', { instructions: '?', options: [{ id: 'a' }, { id: 'b' }] });
    expect(calls[0]!.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(calls[0]!.headers['authorization']).toBe('Bearer ts');
    expect(calls[0]!.headers['X-Title']).toBeUndefined();
    expect(calls[0]!.body.model).toBe('jev-1.13');
    expect(r).toMatchObject({ label: 'a', model: 'jev-1.13' });
  });

  it('kev: lokaler Endpunkt ohne Authorization; Basis-URL per CLASSIFIER_BASE_URL', async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { answers: { label: choiceAnswer({ b: 0.9, a: 0.1 }) } } }));
    const r = await classify(providerFromEnv({ CLASSIFIER_PROVIDER: 'kev' }, fetch), 'x', { instructions: '?', options: [{ id: 'a' }, { id: 'b' }] });
    expect(calls[0]!.url).toBe('http://127.0.0.1:8009/v1/systemone');
    expect(calls[0]!.headers['authorization']).toBeUndefined();
    expect(r).toMatchObject({ label: 'b', model: 'kev-latest' });
    const other = fakeFetch(() => ({ json: { answers: { label: choiceAnswer({ a: 1 }) } } }));
    await classify(providerFromEnv({ CLASSIFIER_PROVIDER: 'kev', CLASSIFIER_BASE_URL: 'https://kev.example/' }, other.fetch), 'x', { instructions: '?', options: [{ id: 'a' }] });
    expect(other.calls[0]!.url).toBe('https://kev.example/v1/systemone');
  });
});

describe('Transport: Retry, Zeitlimit, Fehlerkörper', () => {
  it('429/5xx einmal wiederholt (Retry-After), 4xx nicht; Fehler bei HTTP 200 mit error-Körper', async () => {
    let n = 0;
    const flaky: FetchLike = async () => (n++ === 0
      ? { ok: false, status: 429, headers: { get: (h: string) => (h === 'retry-after' ? '0.01' : null) }, text: async () => '{"error":{"message":"slow"}}' }
      : { ok: true, status: 200, text: async () => '{"fine":1}' });
    expect(await postJson('http://k', '{}', { fetch: flaky })).toEqual({ fine: 1 });
    expect(n).toBe(2);

    const counted = (status: number, text: string) => { const c = { n: 0 }; const f: FetchLike = async () => { c.n++; return { ok: status < 300, status, text: async () => text }; }; return { c, f }; };
    const bad = counted(400, '{"error":{"message":"Too many choices"}}');
    await expect(postJson('http://k', '{}', { fetch: bad.f })).rejects.toThrow(/400 \(Anfrage abgelehnt\): Too many choices/);
    expect(bad.c.n).toBe(1);
    const down = counted(503, 'Service Unavailable');
    await expect(postJson('http://k', '{}', { fetch: down.f, retries: 1 })).rejects.toMatchObject({ status: 503, retry: true });
    expect(down.c.n).toBe(2);
    const hidden = counted(200, '{"error":{"message":"Provider error"}}');
    await expect(postJson('http://k', '{}', { fetch: hidden.f, retries: 0 })).rejects.toThrow(/502 .*Provider error/);
  });

  it('Zeitlimit je Versuch; Schlüssel nie in der Meldung', async () => {
    const hang: FetchLike = (_u, init) => new Promise((_r, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(postJson('http://k', '{}', { fetch: hang, timeoutMs: 20, retries: 0, apiKey: 'sk-geheim' })).rejects.toThrow(/Zeitlimit 20 ms/);
    const e = await postJson('http://k', '{}', { fetch: hang, timeoutMs: 20, retries: 0, apiKey: 'sk-geheim' }).catch((x: Error) => x);
    expect(String((e as Error).message)).not.toContain('sk-geheim');
  });
});

describe('mehr als 255 Optionen', () => {
  it('splitChoices: Stücke mit Platz für Zusatzoptionen', () => {
    expect(splitChoices([1, 2, 3, 4, 5], 3, 1)).toEqual([[1, 2], [3, 4], [5]]);
    expect(splitChoices([1], MAX_CHOICES, 1)).toEqual([[1]]);
  });

  it('classify teilt auf, fragt in EINER Anfrage und nimmt die sicherste echte Wahl', async () => {
    const options = Array.from({ length: 300 }, (_, i) => ({ id: `o${i}` }));
    const { fetch, calls } = fakeFetch((body) => ({
      json: { answers: {
        'label#1': { type: 'choice', choice: NONE_OF_THESE, confidence: 0.9, probabilities: { [NONE_OF_THESE]: 0.9 } },
        'label#2': { type: 'choice', choice: 'o280', confidence: 0.7, probabilities: { o280: 0.7 } },
        _n: Object.keys(body.questions).length,
      } },
    }));
    const p = createSystemOneProvider({ name: 't', baseUrl: 'http://k', path: '/d', model: 'm', fetch });
    const r = await classify(p, 'x', { instructions: '?', options });
    expect(calls).toHaveLength(1);
    const qs = calls[0]!.body.questions as Record<string, { criteria: Record<string, unknown> }>;
    expect(Object.keys(qs)).toEqual(['label#1', 'label#2']);
    for (const q of Object.values(qs)) expect(Object.keys(q.criteria).length).toBeLessThanOrEqual(MAX_CHOICES);
    expect(r).toMatchObject({ label: 'o280', confidence: 0.7 });
    expect(r.ranked[0]).toEqual({ label: 'o280', probability: 0.7 });
  });
});
