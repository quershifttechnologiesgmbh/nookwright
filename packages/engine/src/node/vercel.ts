/**
 * Vercel-Function (W8-V, Node-Runtime): `POST /v1/interpret` und `GET /healthz` als `(Request) → Response`.
 * Regeln = öffentlicher Modus von `server.ts` über den gemeinsamen Kern (`interpretCore.ts`): nur POST (405) +
 * `application/json` (415), `Origin` = eigener Ursprung oder `ENGINE_PUBLIC_ORIGINS` (403), Body ≤ 16 KiB (413),
 * leerer Prompt 400, `Authorization` ohne Schlüssel-Liste 401, Limit je IP 429 mit `Retry-After`, Tagesbudget.
 * Alle übrigen Pfade 404 (die Clients fallen dann wie auf reinem Datei-Hosting auf den lokalen Klassifikator zurück).
 *
 * Zustand über Instanzen: mit `UPSTASH_REDIS_REST_URL/_TOKEN` Rate-Limit und Budget in Redis. **Ohne** Upstash gibt es
 * keinen gemeinsamen Zähler → nur der lokale Klassifikator (kein Modellaufruf, keine Kosten), auch wenn ein
 * Modell-Schlüssel gesetzt ist; das Rate-Limit je IP gilt dann je Instanz.
 *
 * Gezielte Imports (nicht `./index.js`): das Bündel enthält weder `node:sqlite` noch MCP-SDK oder Worker-Pool.
 * Prompt-Log gibt es hier nicht (Dateisystem nur lesbar, Beschreibungen sind personenbezogen).
 */
import type { Engine } from '../engine.js';
import { envNumber, publicDailyBudget } from './config.js';
import {
  JSON_TYPE, MESSAGES, PUBLIC_MAX_BODY, admitAnonymous, handleInterpret, originOf, sameOrigin, takeRateLimit, type CoreReply, type InterpretDeps,
} from './interpretCore.js';
import { interpretOptionsFromEnv, type InterpretOptions } from './openrouter.js';
import {
  asyncRateLimiter, memoryDailyBudget, rateRuleOf, redisDailyBudget, redisTokenBuckets, tokenBuckets, upstashFromEnv,
  type AsyncRateLimiter, type DailyBudget, type UpstashConfig,
} from './rateLimit.js';

/** Grund des lokalen Betriebs ohne gemeinsamen Zähler (steht als `fallback` in der Antwort, wenn ein Modell konfiguriert ist). */
export const NO_SHARED_STORE = 'Kein Budget-Speicher konfiguriert (UPSTASH_REDIS_REST_URL/_TOKEN) – nur lokaler Klassifikator';

/** Standards auf Vercel: Client bricht nach 20 s ab, Function-Grenze 25 s (`maxDuration`). */
export const VERCEL_NL_TIMEOUT_MS = 8000;
export const VERCEL_NL_RETRIES = 1;

export interface VercelOptions {
  readonly engine: Engine;
  readonly interpret: InterpretOptions;
  /** Weitere erlaubte Ursprünge (auch CORS). Der eigene Ursprung (Host + `x-forwarded-proto`) ist immer erlaubt. */
  readonly publicOrigins?: readonly string[];
  readonly limiter?: AsyncRateLimiter | undefined;
  readonly budget?: DailyBudget | undefined;
  /** Art des Zähler-Speichers (nur Anzeige in {@link VercelHandler.mode}). */
  readonly store?: 'redis' | 'memory';
  /** Gesetzt: nie ein Modellaufruf (kein gemeinsamer Zähler). */
  readonly localOnly?: string | undefined;
  readonly now?: () => number;
  /** Eine JSON-Zeile je Anfrage (ohne IP, Prompt, Schlüssel); Standard: `console.log`. */
  readonly accessLog?: ((entry: Record<string, unknown>) => void) | undefined;
}

export interface VercelHandler {
  (request: Request, info?: { readonly ip?: string | undefined }): Promise<Response>;
  /** Beschreibung der Konfiguration ohne Geheimnisse (Start-Log, Tests). */
  readonly mode: { readonly nl: string; readonly store: 'redis' | 'memory'; readonly budgetPerDay: number; readonly localOnly: boolean };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

const coreResponse = (r: CoreReply, headers: Record<string, string> = {}): Response => json(r.status, r.body, { ...r.headers, ...headers });

/** Client-IP: `x-real-ip` (setzt Vercel), sonst erster `x-forwarded-for`-Eintrag (Vercel überschreibt ihn), sonst Transport. */
export function clientIp(headers: Headers, fallback?: string): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real !== undefined && real !== '') return real;
  const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd !== undefined && fwd !== '' ? fwd : (fallback ?? '?');
}

/** Body lesen mit Grenze (auch ohne/mit falschem `content-length`); leer → `{}`. */
async function readJson(request: Request, max: number): Promise<{ ok: true; body: unknown } | { ok: false; reply: CoreReply }> {
  const tooLarge = { ok: false as const, reply: { status: 413, body: { ok: false, errors: [MESSAGES.tooLarge(max)] } } };
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return tooLarge;
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body !== null) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        return tooLarge;
      }
      chunks.push(value);
    }
  }
  if (size === 0) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, reply: { status: 400, body: { ok: false, errors: [MESSAGES.badJson] } } };
  }
}

/** Handler aus fertigen Bausteinen (Tests: Fakes; Betrieb: {@link vercelHandlerFromEnv}). */
export function vercelHandler(opts: VercelOptions): VercelHandler {
  const publicOrigins = opts.publicOrigins ?? [];
  const now = opts.now ?? Date.now;
  const accessLog = opts.accessLog ?? ((e) => console.log(JSON.stringify({ level: 'info', msg: 'request', ...e })));
  const deps: InterpretDeps = { engine: opts.engine, interpret: opts.interpret, budget: opts.budget, now };

  const cors = (origin: string | null): Record<string, string> => origin === null || !publicOrigins.includes(origin)
    ? {}
    : {
      'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization', 'access-control-expose-headers': 'retry-after, x-engine-ms',
      'access-control-max-age': '600',
    };

  const route = async (request: Request, ip: string, path: string): Promise<{ res: Response; model?: string }> => {
    const origin = request.headers.get('origin');
    const extra = cors(origin);
    if (request.method === 'OPTIONS') return { res: new Response(null, { status: 204, headers: extra }) };
    if (path === '/healthz') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return { res: json(405, { ok: false, errors: [`${request.method} /healthz nicht erlaubt`] }, { allow: 'GET, HEAD', ...extra }) };
      // Öffentlich (Review R1-19): nur Lebenszeichen und Modus, keine Interna
      const res = json(200, { ok: true, auth: 'public' }, extra);
      return { res: request.method === 'HEAD' ? new Response(null, { status: 200, headers: res.headers }) : res };
    }
    if (path !== '/v1/interpret') return { res: json(404, { ok: false, errors: [`${request.method} ${path.slice(0, 200)} unbekannt`] }, extra) };
    if (request.method !== 'POST') return { res: json(405, { ok: false, errors: [`${request.method} /v1/interpret nicht erlaubt (nur POST)`] }, { allow: 'POST, OPTIONS', ...extra }) };
    // Vor dem Lesen des Bodys (Reihenfolge wie server.ts): fremder Ursprung, Content-Type, Anmeldung, Rate-Limit
    const url = new URL(request.url);
    const proto = request.headers.get('x-forwarded-proto')?.split(',').at(-1)?.trim().toLowerCase();
    const own = originOf(request.headers.get('host') ?? url.host, proto === 'http' || proto === 'https' ? proto : url.protocol === 'http:' ? 'http' : 'https');
    const allowed = (o: string): boolean => publicOrigins.includes(o) || sameOrigin(o, own);
    if (origin !== null && !allowed(origin)) return { res: json(403, { ok: false, errors: [MESSAGES.foreignOrigin(origin)] }, extra) };
    if (!JSON_TYPE.test(request.headers.get('content-type') ?? '')) return { res: json(415, { ok: false, errors: [MESSAGES.jsonOnly] }, extra) };
    // Keine Schlüssel-Liste auf Vercel: jede Anmeldung ist ungültig (wie der öffentliche Modus ohne ENGINE_API_KEYS)
    if (request.headers.get('authorization') !== null) {
      return { res: json(401, { ok: false, errors: [MESSAGES.noKey] }, { 'www-authenticate': 'Bearer realm="engine"', ...extra }) };
    }
    const denied = admitAnonymous(origin ?? undefined, allowed);
    if (denied !== undefined) return { res: coreResponse(denied, extra) };
    const limited = await takeRateLimit(opts.limiter, `web-ip:${ip}`);
    if (limited !== undefined && !('degraded' in limited)) return { res: coreResponse(limited, extra) };
    const read = await readJson(request, PUBLIC_MAX_BODY);
    if (!read.ok) return { res: coreResponse(read.reply, extra) };
    const localOnly = opts.localOnly ?? (limited !== undefined && 'degraded' in limited ? limited.degraded : undefined);
    const r = await handleInterpret({ body: read.body, anonymous: true, localOnly }, deps);
    const model = typeof r.body['model'] === 'string' ? r.body['model'] : undefined;
    return { res: coreResponse(r, extra), ...(model !== undefined ? { model } : {}) };
  };

  const handler = async (request: Request, info?: { readonly ip?: string | undefined }): Promise<Response> => {
    const t0 = performance.now();
    const path = new URL(request.url).pathname;
    let out: { res: Response; model?: string };
    try {
      out = await route(request, clientIp(request.headers, info?.ip), path);
    } catch (err) {
      out = { res: json(500, { ok: false, errors: [err instanceof Error ? err.message : String(err)] }) };
    }
    accessLog({ ts: new Date().toISOString(), method: request.method, path: path.slice(0, 200), status: out.res.status, ms: Math.round(performance.now() - t0), ...(out.model !== undefined ? { model: out.model } : {}) });
    return out.res;
  };
  return Object.assign(handler, {
    mode: {
      nl: opts.localOnly !== undefined || opts.interpret.mode === 'local' ? 'local' : `${opts.interpret.mode ?? 'tools'} ${opts.interpret.model}`,
      store: opts.store ?? 'memory',
      budgetPerDay: opts.budget?.max ?? 0,
      localOnly: opts.localOnly !== undefined || opts.interpret.mode === 'local',
    },
  });
}

/**
 * Handler aus der Umgebung (Betrieb auf Vercel). Variablen: ENGINE_NL_* (Modell, `.env.example`), ENGINE_RATE_NL,
 * ENGINE_WEB_NL_DAILY, ENGINE_PUBLIC_ORIGINS, UPSTASH_REDIS_REST_URL/_TOKEN, ENGINE_REDIS_PREFIX.
 * ENGINE_NL_TIMEOUT_MS/RETRIES ohne Angabe 8000/1 (statt 30 000), damit die Antwort vor `maxDuration` kommt.
 */
export function vercelHandlerFromEnv(engine: Engine, env: NodeJS.ProcessEnv = process.env, extra: { readonly fetch?: typeof fetch; readonly now?: () => number } = {}): VercelHandler {
  const withDefaults: NodeJS.ProcessEnv = {
    ...env,
    ENGINE_NL_TIMEOUT_MS: env['ENGINE_NL_TIMEOUT_MS'] ?? env['CLASSIFIER_TIMEOUT_MS'] ?? String(VERCEL_NL_TIMEOUT_MS),
    ENGINE_NL_RETRIES: env['ENGINE_NL_RETRIES'] ?? env['CLASSIFIER_RETRIES'] ?? String(VERCEL_NL_RETRIES),
  };
  const nl = interpretOptionsFromEnv(withDefaults);
  const publicOrigins = (env['ENGINE_PUBLIC_ORIGINS'] ?? '').split(',').map((o) => o.trim()).filter((o) => o !== '');
  for (const o of publicOrigins) {
    let origin: string | undefined;
    try {
      origin = new URL(o).origin;
    } catch {
      origin = undefined;
    }
    if (origin !== o) throw new Error(`ENGINE_PUBLIC_ORIGINS: '${o.slice(0, 100)}' ist kein Ursprung (Schema://Host[:Port], ohne Pfad und ohne / am Ende)`);
  }
  const rule = rateRuleOf(env['ENGINE_RATE_NL'], { perMinute: 20, burst: 5 });
  const explicit = (env['ENGINE_WEB_NL_DAILY'] ?? '').trim() === '' ? undefined : Math.floor(envNumber(env, 'ENGINE_WEB_NL_DAILY', 0));
  const perDay = publicDailyBudget(explicit, nl.mode).perDay;
  const redis: UpstashConfig | undefined = upstashFromEnv(env);
  const cfg = redis !== undefined && extra.fetch !== undefined ? { ...redis, fetch: extra.fetch } : redis;
  const now = extra.now ?? Date.now;
  if (cfg === undefined) {
    // Kein gemeinsamer Zähler → keine Kostenbremse über Instanzen → nie ein Modellaufruf
    return vercelHandler({
      engine, interpret: nl, publicOrigins, now, budget: memoryDailyBudget(perDay), store: 'memory',
      limiter: rule !== undefined ? asyncRateLimiter(tokenBuckets(rule)) : undefined,
      localOnly: nl.mode === 'local' ? undefined : NO_SHARED_STORE,
    });
  }
  return vercelHandler({
    engine, interpret: nl, publicOrigins, now, store: 'redis',
    limiter: rule !== undefined ? redisTokenBuckets(cfg, rule, now) : undefined,
    budget: redisDailyBudget(cfg, perDay),
  });
}
