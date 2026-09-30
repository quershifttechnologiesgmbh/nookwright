/**
 * W8-V: Vercel-Function (`vercel.ts`) und gemeinsamer Interpret-Kern. Handler-Regeln (200/400/401/403/404/405/413/415/
 * 429), asynchrone Adapter (Speicher und Upstash-REST mit Fake-Redis, gleiche Testtabelle), „Redis weg → lokal, kein
 * Modellaufruf“, „ohne Upstash → nur lokal“ und Parität Node-Server ↔ Function (gleicher Status, gleicher Body).
 * Offline: lokaler Klassifikator bzw. gezählte Fake-`fetch`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { engineServer, type InterpretOptions, type ServerOptions } from '../src/node/index.js';
import { STORE_UNAVAILABLE } from '../src/node/interpretCore.js';
import {
  DAILY_BUDGET_LUA, TOKEN_BUCKET_LUA, asyncRateLimiter, bucketStep, memoryDailyBudget, redisDailyBudget, redisTokenBuckets, tokenBuckets,
  upstashFromEnv, type AsyncRateLimiter, type DailyBudget, type RateRule, type UpstashConfig,
} from '../src/node/rateLimit.js';
import { NO_SHARED_STORE, clientIp, vercelHandler, vercelHandlerFromEnv, type VercelOptions } from '../src/node/vercel.js';
import { engine } from './fixture.js';

const LOCAL_NL: InterpretOptions = { apiKey: '', model: 'local', mode: 'local' };
const HOST = 'nookwright.example';
const OWN = `https://${HOST}`;
const PROMPT = JSON.stringify({ prompt: 'kleine Taverne mit Garten' });

const tmp = mkdtempSync(join(tmpdir(), 'engine-vercel-'));
writeFileSync(join(tmp, 'index.html'), '<!doctype html><h1>x</h1>');
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

/** Anfrage an die Function wie hinter Vercel (https, Host, x-real-ip). */
function req(opts: { method?: string; headers?: Record<string, string>; body?: string; path?: string; ip?: string } = {}): Request {
  const method = opts.method ?? 'POST';
  return new Request(`${OWN}${opts.path ?? '/v1/interpret'}`, {
    method,
    headers: { host: HOST, 'x-forwarded-proto': 'https', 'x-real-ip': opts.ip ?? '9.9.9.9', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    ...(opts.body !== undefined || method === 'POST' ? { body: opts.body ?? PROMPT } : {}),
  });
}
const quiet = { accessLog: (): void => undefined };
const handler = (o: Partial<VercelOptions> = {}): ReturnType<typeof vercelHandler> => vercelHandler({ engine, interpret: LOCAL_NL, ...quiet, ...o });
const bodyOf = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

/** Fake-Upstash: versteht genau die beiden Skripte (Rechnung über den JS-Spiegel) und zählt Aufrufe. */
function fakeUpstash(opts: { fail?: 'network' | 'http500' | 'timeout' } = {}): { cfg: UpstashConfig; calls: unknown[][]; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const calls: unknown[][] = [];
  const f = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (opts.fail === 'network') throw new TypeError('fetch failed');
    if (opts.fail === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    if (opts.fail === 'http500') return new Response(JSON.stringify({ error: 'ERR internal' }), { status: 500 });
    expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer test-token');
    const cmd = JSON.parse(String(init?.body)) as unknown[];
    calls.push(cmd);
    const [name, script, , key, ...argv] = cmd as [string, string, number, string, ...number[]];
    expect(name).toBe('EVAL');
    if (script === TOKEN_BUCKET_LUA) {
      const [cap, perMs, now] = argv as [number, number, number];
      const step = bucketStep(store.get(key) as { tokens: number; at: number } | undefined, cap, perMs, now);
      store.set(key, step.state);
      return Response.json({ result: step.take.ok ? [1, 0] : [0, step.take.retryAfterS] });
    }
    if (script === DAILY_BUDGET_LUA) {
      const n = Number(store.get(key) ?? 0) + 1;
      store.set(key, n);
      if (n === 1) store.set(`${key}#ttl`, argv[0]);
      return Response.json({ result: n });
    }
    return Response.json({ error: 'unbekanntes Skript' }, { status: 400 });
  };
  return { cfg: { url: 'https://fake.upstash.io', token: 'test-token', fetch: f as typeof fetch }, calls, store };
}

describe('Adapter: gleiche Testtabelle für Speicher und Redis (Upstash-REST)', () => {
  const RULE: RateRule = { perMinute: 6, burst: 2 };
  const impls: [string, (now: () => number) => AsyncRateLimiter, (max: number) => DailyBudget][] = [
    ['Speicher', (now) => asyncRateLimiter(tokenBuckets(RULE, now)), (max) => memoryDailyBudget(max)],
    ['Redis', (now) => redisTokenBuckets(fakeUpstash().cfg, RULE, now), (max) => redisDailyBudget(fakeUpstash().cfg, max)],
  ];
  for (const [name, limiterOf, budgetOf] of impls) {
    it(`${name}: Token-Bucket – Burst, 429 mit Retry-After, Nachfüllen, getrennte Schlüssel`, async () => {
      let t = 1_000_000;
      const l = limiterOf(() => t);
      expect(await l.take('a')).toEqual({ ok: true });
      expect(await l.take('a')).toEqual({ ok: true });
      expect(await l.take('a')).toEqual({ ok: false, retryAfterS: 10 });
      expect(await l.take('b')).toEqual({ ok: true });
      t += 10_000; // 6/min → ein Token je 10 s
      expect(await l.take('a')).toEqual({ ok: true });
      expect(await l.take('a')).toMatchObject({ ok: false });
      t += 60_000; // nie mehr als der Burst
      expect(await l.take('a')).toEqual({ ok: true });
      expect(await l.take('a')).toEqual({ ok: true });
      expect(await l.take('a')).toMatchObject({ ok: false });
    });

    it(`${name}: Tagesbudget – Grenze, Retry-After bis Mitternacht UTC, neuer Tag frei`, async () => {
      const b = budgetOf(2);
      const t = Date.UTC(2026, 8, 26, 23, 59, 0);
      expect(await b.take(t)).toEqual({ ok: true });
      expect(await b.take(t)).toEqual({ ok: true });
      expect(await b.take(t)).toEqual({ ok: false, retryAfterS: 60 });
      expect(await b.take(t + 60_000)).toEqual({ ok: true });
    });
  }

  it('Redis: Schlüssel mit Präfix und UTC-Tag, EXPIRE 172800, Präfix aus der Umgebung', async () => {
    const fake = fakeUpstash();
    await redisDailyBudget({ ...fake.cfg, prefix: 'preview:' }, 5).take(Date.UTC(2026, 8, 27, 12));
    await redisTokenBuckets(fake.cfg, RULE, () => 5).take('web-ip:1.2.3.4');
    expect(fake.calls.map((c) => c[3])).toEqual(['preview:budget:2026-09-27', 'nl:rl:web-ip:1.2.3.4']);
    expect(fake.store.get('preview:budget:2026-09-27#ttl')).toBe(172_800);
    expect(upstashFromEnv({})).toBeUndefined();
    expect(upstashFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' })).toBeUndefined();
    expect(upstashFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't', ENGINE_REDIS_PREFIX: 'preview:' }))
      .toEqual({ url: 'https://x.upstash.io', token: 't', prefix: 'preview:' });
  });

  it('Redis-Fehler (Netz, HTTP 500, Zeitlimit) → Exception ohne Token im Text', async () => {
    for (const fail of ['network', 'http500', 'timeout'] as const) {
      const { cfg } = fakeUpstash({ fail });
      const err = await redisDailyBudget(cfg, 3).take(0).then(() => undefined, (e: unknown) => e);
      expect(err, fail).toBeInstanceOf(Error);
      expect(String(err)).not.toContain('test-token');
      await expect(redisTokenBuckets(cfg, RULE).take('k')).rejects.toThrow(/Redis/);
    }
  });
});

describe('Function-Handler (öffentlicher Modus)', () => {
  it('eigener Ursprung 200 (Antwortform wie server.ts); /healthz öffentlich; übrige Pfade 404', async () => {
    const h = handler();
    const ok = await h(req({ headers: { origin: OWN } }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toMatch(/application\/json/);
    expect(await bodyOf(ok)).toMatchObject({ ok: true, model: 'local', request: { op: 'building_generate', input: { buildingTypeId: 'tavern' } }, interpretMs: expect.any(Number), confidence: { buildingTypeId: 1 } });
    const health = await h(req({ method: 'GET', path: '/healthz' }));
    expect(await bodyOf(health)).toEqual({ ok: true, auth: 'public' });
    expect((await h(req({ method: 'HEAD', path: '/healthz' }))).status).toBe(200);
    expect((await h(req({ method: 'POST', path: '/healthz', headers: { origin: OWN } }))).status).toBe(405);
    for (const path of ['/v1/execute', '/v1/prompt', '/v1/operations', '/api']) {
      expect((await h(req({ path, headers: { origin: OWN } }))).status, path).toBe(404);
    }
  });

  it('403 fremder/fehlender/http-Ursprung, 415 text/plain, 405 GET, 401 Bearer, 413 > 16 KiB, 400 leer/kaputt', async () => {
    const h = handler();
    expect((await h(req({ headers: { origin: 'https://evil.example' } }))).status).toBe(403);
    expect((await h(req())).status).toBe(403);
    expect((await h(req({ headers: { origin: `http://${HOST}` } }))).status).toBe(403);
    const plain = await h(req({ headers: { origin: OWN, 'content-type': 'text/plain' } }));
    expect(plain.status).toBe(415);
    const get = await h(req({ method: 'GET', headers: { origin: OWN } }));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toMatch(/POST/);
    const bearer = await h(req({ headers: { origin: OWN, authorization: 'Bearer eng_x' } }));
    expect(bearer.status).toBe(401);
    expect(bearer.headers.get('www-authenticate')).toMatch(/Bearer/);
    const big = await h(req({ headers: { origin: OWN }, body: JSON.stringify({ prompt: 'x'.repeat(20 * 1024) }) }));
    expect(big.status).toBe(413);
    // ohne content-length (gestreamt): Grenze beim Lesen
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify({ prompt: 'y'.repeat(20 * 1024) }))); c.close(); } });
    const streamed = new Request(`${OWN}/v1/interpret`, { method: 'POST', headers: { host: HOST, origin: OWN, 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
    expect((await h(streamed)).status).toBe(413);
    expect((await h(req({ headers: { origin: OWN }, body: '{"prompt":"  "}' }))).status).toBe(400);
    expect((await h(req({ headers: { origin: OWN }, body: '{kaputt' }))).status).toBe(400);
  });

  it('ENGINE_PUBLIC_ORIGINS: weiterer Ursprung erlaubt, mit CORS; Preflight 204', async () => {
    const h = handler({ publicOrigins: ['https://www.example.org'] });
    const r = await h(req({ headers: { origin: 'https://www.example.org' } }));
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('https://www.example.org');
    const pre = await h(req({ method: 'OPTIONS', headers: { origin: 'https://www.example.org' } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toMatch(/POST/);
    expect((await h(req({ headers: { origin: 'https://evil.example' } }))).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('429 je IP mit Retry-After (x-real-ip), andere IP eigenes Kontingent; Budget zählt nur gültige Beschreibungen', async () => {
    let t = Date.UTC(2026, 8, 26, 23, 59, 0);
    const h = handler({ limiter: asyncRateLimiter(tokenBuckets({ perMinute: 1, burst: 2 })), budget: memoryDailyBudget(3), now: () => t });
    const as = (ip: string, body?: string): Promise<Response> => h(req({ ip, headers: { origin: OWN }, ...(body !== undefined ? { body } : {}) }));
    expect((await as('1.1.1.1')).status).toBe(200);
    expect((await as('1.1.1.1')).status).toBe(200);
    const limited = await as('1.1.1.1');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(30);
    expect((await as('2.2.2.2', '{"prompt":""}')).status).toBe(400); // verbraucht kein Budget
    expect((await as('3.3.3.3')).status).toBe(200);
    const out = await as('4.4.4.4');
    expect(out.status).toBe(429);
    expect(out.headers.get('retry-after')).toBe('60');
    expect(((await bodyOf(out))['errors'] as string[])[0]).toMatch(/Tageskontingent/);
    t += 60_000;
    expect((await as('4.4.4.4')).status).toBe(200);
  });

  it('Redis weg (Rate-Limit oder Budget) → 200 lokal mit Hinweis, KEIN Modellaufruf', async () => {
    const modelFetch = vi.fn(async () => new Response('{}', { status: 500 }));
    const model: InterpretOptions = { apiKey: 'sk-test', model: 'openai/gpt-oss-20b', mode: 'tools', fetch: modelFetch as unknown as typeof fetch, fallback: false };
    for (const fail of ['network', 'http500', 'timeout'] as const) {
      const { cfg } = fakeUpstash({ fail });
      const h = handler({ interpret: model, limiter: redisTokenBuckets(cfg, { perMinute: 20, burst: 5 }), budget: redisDailyBudget(cfg, 300) });
      const r = await h(req({ headers: { origin: OWN } }));
      expect(r.status, fail).toBe(200);
      expect(await bodyOf(r)).toMatchObject({ ok: true, model: 'local', fallback: STORE_UNAVAILABLE });
    }
    // nur das Budget weg (Limiter im Speicher)
    const { cfg } = fakeUpstash({ fail: 'network' });
    const h = handler({ interpret: model, limiter: asyncRateLimiter(tokenBuckets({ perMinute: 20 })), budget: redisDailyBudget(cfg, 300) });
    expect(await bodyOf(await h(req({ headers: { origin: OWN } })))).toMatchObject({ model: 'local', fallback: STORE_UNAVAILABLE });
    expect(modelFetch).not.toHaveBeenCalled();
  });

  it('aus der Umgebung: ohne Upstash nur lokal (auch mit Modell-Schlüssel), mit Upstash Modell + Redis; kein fetch ohne Redis', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const withKey = vercelHandlerFromEnv(engine, { ENGINE_NL_API_KEY: 'test-key-nicht-echt' });
    expect(withKey.mode).toMatchObject({ localOnly: true, store: 'memory', nl: 'local' });
    const r = await withKey(req({ headers: { origin: OWN } }));
    expect(await bodyOf(r)).toMatchObject({ ok: true, model: 'local', fallback: NO_SHARED_STORE });
    const noKey = vercelHandlerFromEnv(engine, {});
    expect(noKey.mode).toMatchObject({ localOnly: true, store: 'memory', budgetPerDay: 0 });
    expect(await bodyOf(await noKey(req({ headers: { origin: OWN } })))).not.toHaveProperty('fallback');
    expect(spy).not.toHaveBeenCalled();
    const fake = fakeUpstash();
    const redis = vercelHandlerFromEnv(engine, { ENGINE_NL_API_KEY: 'test-key-nicht-echt', UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'test-token' }, { fetch: fake.cfg.fetch! });
    expect(redis.mode).toMatchObject({ localOnly: false, store: 'redis', budgetPerDay: 300 });
    expect(() => vercelHandlerFromEnv(engine, { ENGINE_PUBLIC_ORIGINS: 'https://www.example.org/' })).toThrow(/kein Ursprung/);
  });

  it('Client-IP: x-real-ip, sonst erster x-forwarded-for, sonst Transport', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe('1.1.1.1');
    expect(clientIp(new Headers({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' }))).toBe('2.2.2.2');
    expect(clientIp(new Headers(), '::1')).toBe('::1');
  });
});

describe('Parität Node-Server (öffentlicher Modus) ↔ Function', () => {
  interface Out { readonly status: number; readonly body: Record<string, unknown>; readonly retryAfter: string | null }
  const normalize = (b: Record<string, unknown>): Record<string, unknown> => {
    const { interpretMs: _ms, ...rest } = b;
    return rest;
  };

  async function viaServer(opts: ServerOptions, run: (send: (c: Case) => Promise<Out>) => Promise<void>): Promise<void> {
    const server = engineServer(engine, { site: { dir: tmp }, publicInterpret: true, trustProxy: true, interpret: LOCAL_NL, ...opts });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      await run((c) => new Promise<Out>((resolve, reject) => {
        const body = c.body ?? PROMPT;
        const r = httpRequest({
          host: '127.0.0.1', port, path: '/v1/interpret', method: c.method ?? 'POST',
          headers: { host: HOST, 'x-forwarded-proto': 'https', 'x-forwarded-for': c.ip ?? '9.9.9.9', 'content-type': 'application/json', ...c.headers },
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (d: Buffer) => chunks.push(d));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: normalize(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>), retryAfter: (res.headers['retry-after'] as string | undefined) ?? null }));
        });
        r.on('error', reject);
        r.end(body);
      }));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }
  interface Case { readonly name: string; readonly headers?: Record<string, string>; readonly body?: string; readonly ip?: string; readonly method?: string }
  const viaFunction = (h: ReturnType<typeof vercelHandler>) => async (c: Case): Promise<Out> => {
    const r = await h(req({ ...(c.method !== undefined ? { method: c.method } : {}), ...(c.headers !== undefined ? { headers: c.headers } : {}), ...(c.body !== undefined ? { body: c.body } : {}), ip: c.ip ?? '9.9.9.9' }));
    return { status: r.status, body: normalize(await bodyOf(r)), retryAfter: r.headers.get('retry-after') };
  };

  const BASIC: Case[] = [
    { name: 'eigener Ursprung', headers: { origin: OWN } },
    { name: 'eigener Ursprung, Stil', headers: { origin: OWN }, body: JSON.stringify({ prompt: 'mittelalterliche Burg, groß, Eingang im Süden' }) },
    { name: 'Unsinn', headers: { origin: OWN }, body: JSON.stringify({ prompt: 'asdf qwer' }) },
    { name: 'fremder Ursprung', headers: { origin: 'https://evil.example' } },
    { name: 'http statt https', headers: { origin: `http://${HOST}` } },
    { name: 'Origin fehlt' },
    { name: 'text/plain', headers: { origin: OWN, 'content-type': 'text/plain' } },
    { name: 'Bearer ohne Schlüssel', headers: { origin: OWN, authorization: 'Bearer eng_falsch' } },
    { name: 'Bearer ohne Origin', headers: { authorization: 'Bearer eng_falsch' } },
    { name: '20 KiB', headers: { origin: OWN }, body: JSON.stringify({ prompt: 'x'.repeat(20 * 1024) }) },
    { name: 'leerer Prompt', headers: { origin: OWN }, body: '{"prompt":""}' },
    { name: 'kein Prompt', headers: { origin: OWN }, body: '{}' },
    { name: 'kaputtes JSON', headers: { origin: OWN }, body: '{kaputt' },
  ];

  it('gleiche Antworten für die Grundfälle (Status, Body ohne interpretMs)', async () => {
    const fn = viaFunction(handler());
    await viaServer({}, async (send) => {
      for (const c of BASIC) {
        const [a, b] = [await send(c), await fn(c)];
        expect(b, c.name).toEqual(a);
      }
    });
  });

  it('gleiches Rate-Limit je IP und gleiches Tagesbudget (Retry-After)', async () => {
    let t = Date.UTC(2026, 8, 26, 23, 59, 0);
    const seq: Case[] = [
      { name: 'a1', ip: '1.1.1.1', headers: { origin: OWN } }, { name: 'a2', ip: '1.1.1.1', headers: { origin: OWN } },
      { name: 'a3 (Limit)', ip: '1.1.1.1', headers: { origin: OWN } }, { name: 'b leer', ip: '2.2.2.2', headers: { origin: OWN }, body: '{"prompt":""}' },
      { name: 'c1', ip: '3.3.3.3', headers: { origin: OWN } }, { name: 'd (Budget)', ip: '4.4.4.4', headers: { origin: OWN } },
    ];
    const fnOut: Out[] = [];
    const fn = viaFunction(handler({ limiter: asyncRateLimiter(tokenBuckets({ perMinute: 1, burst: 2 })), budget: memoryDailyBudget(3), now: () => t }));
    for (const c of seq) fnOut.push(await fn(c));
    const srvOut: Out[] = [];
    await viaServer({ rateLimit: { nl: { perMinute: 1, burst: 2 } }, publicDailyBudget: 3, now: () => t }, async (send) => {
      for (const c of seq) srvOut.push(await send(c));
    });
    expect(fnOut.map((o) => o.status)).toEqual([200, 200, 429, 400, 200, 429]);
    // Retry-After des Rate-Limits hängt an der Uhr (performance.now) → nur Größenordnung vergleichen
    expect(fnOut.map((o, i) => (i === 2 ? { ...o, retryAfter: Number(o.retryAfter) > 30 } : o)))
      .toEqual(srvOut.map((o, i) => (i === 2 ? { ...o, retryAfter: Number(o.retryAfter) > 30 } : o)));
    t += 60_000;
  });

  it('bewusste Abweichung: GET /v1/interpret → Function 405 (nur POST), Server 401 (übrige Methoden verlangen Schlüssel)', async () => {
    expect((await viaFunction(handler())({ name: 'GET', method: 'GET', headers: { origin: OWN } })).status).toBe(405);
  });
});
