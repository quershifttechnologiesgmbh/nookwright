/**
 * Rate-Limit (D2): Token-Bucket je Schlüssel (bzw. IP im lokalen Modus). `perMinute` Anfragen je Minute, bis zu
 * `burst` am Stück (Standard = `perMinute`). Abgelehnt → Sekunden bis zum nächsten Token (für `Retry-After`).
 */
export interface RateRule {
  readonly perMinute: number;
  readonly burst?: number;
}

export type Take = { readonly ok: true } | { readonly ok: false; readonly retryAfterS: number };

export interface RateLimiter {
  take(key: string): Take;
}

export function tokenBuckets(rule: RateRule, now: () => number = () => performance.now()): RateLimiter {
  const cap = Math.max(1, rule.burst ?? rule.perMinute);
  const perMs = rule.perMinute / 60_000;
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    take(key) {
      const t = now();
      const b = buckets.get(key) ?? { tokens: cap, at: t };
      b.tokens = Math.min(cap, b.tokens + (t - b.at) * perMs);
      b.at = t;
      buckets.set(key, b);
      if (buckets.size > 10_000) {
        // volle Eimer vergessen (gleichwertig mit neuem Eimer)
        for (const [k, x] of buckets) if (Math.min(cap, x.tokens + (t - x.at) * perMs) >= cap) buckets.delete(k);
      }
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { ok: true };
      }
      return { ok: false, retryAfterS: Math.max(1, Math.ceil((1 - b.tokens) / perMs / 1000)) };
    },
  };
}

// ── W8-V: asynchrone Adapter (gemeinsamer Zustand über Instanzen, z. B. Vercel-Functions) ──────────────────────

/** Rate-Limit mit asynchronem Speicher. Wirft bei Speicherfehler (Aufrufer entscheidet: kein Modellaufruf). */
export interface AsyncRateLimiter {
  take(key: string): Promise<Take>;
}

/** Speicher-Implementierung (Node-Server, Tests, Function ohne Redis): der synchrone Token-Bucket. */
export const asyncRateLimiter = (limiter: RateLimiter): AsyncRateLimiter => ({ take: (key) => Promise.resolve(limiter.take(key)) });

/**
 * Tagesbudget aller anonymen Beschreibungen (UTC-Tag). `take` zählt einen Aufruf; erschöpft → Sekunden bis Mitternacht
 * UTC. Wirft bei Speicherfehler.
 */
export interface DailyBudget {
  readonly max: number;
  take(now: number): Promise<Take>;
}

export const DAY_MS = 86_400_000;
const untilMidnightS = (now: number): number => Math.max(1, Math.ceil(((Math.floor(now / DAY_MS) + 1) * DAY_MS - now) / 1000));

/** Tagesbudget im Prozess (Node-Server: ein Prozess = ein Zähler). */
export function memoryDailyBudget(max: number): DailyBudget {
  const state = { day: -1, used: 0 };
  return {
    max,
    take(now) {
      const day = Math.floor(now / DAY_MS);
      if (day !== state.day) Object.assign(state, { day, used: 0 });
      if (state.used >= max) return Promise.resolve({ ok: false, retryAfterS: untilMidnightS(now) });
      state.used += 1;
      return Promise.resolve({ ok: true });
    },
  };
}

/** Zugang zu Upstash Redis über die REST-API (nur `fetch`, keine Abhängigkeit). */
export interface UpstashConfig {
  /** `UPSTASH_REDIS_REST_URL`, z. B. `https://eu1-xyz.upstash.io`. */
  readonly url: string;
  /** `UPSTASH_REDIS_REST_TOKEN` (geheim; nie loggen). */
  readonly token: string;
  /** Zeitlimit je Befehl in ms (Standard 500): lieber lokal klassifizieren als die Beschreibung aufhalten. */
  readonly timeoutMs?: number;
  /** Präfix aller Schlüssel (Standard `nl:`); Preview-Deployments bekommen ein eigenes (`ENGINE_REDIS_PREFIX`). */
  readonly prefix?: string;
  readonly fetch?: typeof fetch;
}

/** Upstash-Konfiguration aus der Umgebung; `undefined`, wenn URL oder Token fehlt. */
export function upstashFromEnv(env: NodeJS.ProcessEnv): UpstashConfig | undefined {
  const url = env['UPSTASH_REDIS_REST_URL']?.trim() ?? '';
  const token = env['UPSTASH_REDIS_REST_TOKEN']?.trim() ?? '';
  if (url === '' || token === '') return undefined;
  const prefix = env['ENGINE_REDIS_PREFIX']?.trim();
  return { url, token, ...(prefix !== undefined && prefix !== '' ? { prefix } : {}) };
}

/** Ein Redis-Befehl über Upstash-REST (`POST <url>` mit JSON-Array). Fehler/Zeitlimit → Exception ohne Token. */
export async function upstashCommand(cfg: UpstashConfig, command: readonly (string | number)[]): Promise<unknown> {
  const f = cfg.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(cfg.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 500),
    });
  } catch (err) {
    throw new Error(`Redis nicht erreichbar (${err instanceof Error ? err.name : 'Fehler'})`);
  }
  let body: { result?: unknown; error?: unknown };
  try {
    body = (await res.json()) as { result?: unknown; error?: unknown };
  } catch {
    throw new Error(`Redis-Antwort ungültig (HTTP ${res.status})`);
  }
  if (!res.ok || body.error !== undefined) throw new Error(`Redis-Fehler (HTTP ${res.status}): ${String(body.error ?? '').slice(0, 120)}`);
  return body.result;
}

/**
 * Token-Bucket als Lua-Skript (atomar über alle Instanzen). KEYS[1] = Eimer; ARGV = Kapazität, Tokens je ms, jetzt (ms).
 * Rückgabe `{1, 0}` erlaubt bzw. `{0, retryAfterS}`. Gleiche Rechnung wie {@link tokenBuckets} (JS-Spiegel:
 * {@link bucketStep}); der Eimer verfällt, sobald er wieder voll wäre.
 */
export const TOKEN_BUCKET_LUA = `local cap = tonumber(ARGV[1])
local perMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local b = redis.call('HMGET', KEYS[1], 't', 'a')
local tokens = tonumber(b[1]) or cap
local at = tonumber(b[2]) or now
tokens = math.min(cap, tokens + math.max(0, now - at) * perMs)
local ok = 0
if tokens >= 1 then
  tokens = tokens - 1
  ok = 1
end
redis.call('HSET', KEYS[1], 't', tostring(tokens), 'a', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(cap / perMs) + 1000)
if ok == 1 then return {1, 0} end
return {0, math.max(1, math.ceil((1 - tokens) / perMs / 1000))}`;

/** Tagesbudget als Lua-Skript: `INCR` und beim ersten Aufruf des Tages `EXPIRE` (ARGV[1] s). Rückgabe: neuer Stand. */
export const DAILY_BUDGET_LUA = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

/** Ein Schritt des Token-Buckets (JS-Spiegel von {@link TOKEN_BUCKET_LUA}, für Tests mit einem Fake-Redis). */
export function bucketStep(state: { tokens: number; at: number } | undefined, cap: number, perMs: number, now: number): { state: { tokens: number; at: number }; take: Take } {
  let tokens = Math.min(cap, (state?.tokens ?? cap) + Math.max(0, now - (state?.at ?? now)) * perMs);
  if (tokens >= 1) {
    tokens -= 1;
    return { state: { tokens, at: now }, take: { ok: true } };
  }
  return { state: { tokens, at: now }, take: { ok: false, retryAfterS: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) } };
}

/** Token-Buckets je Schlüssel in Redis (Upstash-REST). `now` in ms (Standard `Date.now`: Uhr der Instanz). */
export function redisTokenBuckets(cfg: UpstashConfig, rule: RateRule, now: () => number = Date.now): AsyncRateLimiter {
  const cap = Math.max(1, rule.burst ?? rule.perMinute);
  const perMs = rule.perMinute / 60_000;
  const prefix = cfg.prefix ?? 'nl:';
  return {
    async take(key) {
      const r = await upstashCommand(cfg, ['EVAL', TOKEN_BUCKET_LUA, 1, `${prefix}rl:${key}`, cap, perMs, Math.floor(now())]);
      if (!Array.isArray(r) || r.length !== 2) throw new Error('Redis-Antwort des Rate-Limits ungültig');
      return Number(r[0]) === 1 ? { ok: true } : { ok: false, retryAfterS: Math.max(1, Number(r[1]) || 1) };
    },
  };
}

/** Tagesbudget in Redis: Schlüssel `<prefix>budget:<UTC-Tag>` (`INCR`, `EXPIRE 172800`). */
export function redisDailyBudget(cfg: UpstashConfig, max: number): DailyBudget {
  const prefix = cfg.prefix ?? 'nl:';
  return {
    max,
    async take(now) {
      const day = new Date(now).toISOString().slice(0, 10);
      const n = Number(await upstashCommand(cfg, ['EVAL', DAILY_BUDGET_LUA, 1, `${prefix}budget:${day}`, 172_800]));
      if (!Number.isFinite(n)) throw new Error('Redis-Antwort des Tagesbudgets ungültig');
      return n <= max ? { ok: true } : { ok: false, retryAfterS: untilMidnightS(now) };
    },
  };
}

/** `ENGINE_RATE_*`: Zahl je Minute, optional `/burst` (z. B. `120` oder `10/3`); `0` = aus. */
export function rateRuleOf(text: string | undefined, fallback: RateRule | undefined): RateRule | undefined {
  if (text === undefined || text.trim() === '') return fallback;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?\s*$/.exec(text);
  if (m === null) throw new Error(`Rate-Limit '${text}' ungültig (erwartet <je Minute>[/<burst>])`);
  const perMinute = Number(m[1]);
  if (perMinute === 0) return undefined;
  return { perMinute, ...(m[2] !== undefined ? { burst: Number(m[2]) } : {}) };
}
