/**
 * Gemeinsamer Kern von `POST /v1/interpret` (W8-V): EINE Implementierung der Regeln für den Node-Server
 * (`server.ts`) und die Vercel-Function (`vercel.ts`). Transportfrei: bekommt geprüfte Kopfdaten bzw. den gelesenen
 * Body und liefert `{ status, body, headers }`; das Lesen/Schreiben macht der jeweilige Adapter.
 *
 * Ablauf (Reihenfolge wie bisher in `server.ts`): Ursprung ({@link admitAnonymous}) → Rate-Limit je IP
 * ({@link rateLimitReply}) → Body lesen (Adapter: 413/400) → {@link handleInterpret}: 503 ohne NL-Konfiguration,
 * 400 leerer Prompt, Tagesbudget (nur anonym, zählt erst gültige Beschreibungen) → 429, Klassifikation → 200/400.
 *
 * Speicherfehler (Redis weg, Zeitlimit): nie ein Modellaufruf ohne Budget-Zählung – dann lokaler Klassifikator mit
 * `fallback: 'Budget-Speicher nicht erreichbar'` (kostet nichts, der Nutzer bekommt trotzdem einen Plan).
 */
import type { Engine } from '../engine.js';
import type { PromptLogEntry } from './log.js';
import { interpret, type InterpretOptions } from './openrouter.js';
import type { AsyncRateLimiter, DailyBudget, Take } from './rateLimit.js';

/** Antwort des Kerns; der Adapter schreibt sie als JSON. */
export interface CoreReply {
  readonly status: number;
  readonly body: { readonly ok: boolean } & Record<string, unknown>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Body-Grenze anonymer Anfragen: eine Beschreibung, kein Dokument. */
export const PUBLIC_MAX_BODY = 16 * 1024;
/** Mandant der anonymen Anfragen im öffentlichen Web-Modus. */
export const WEB_TENANT = 'web';
/** POST nur als JSON: Browser senden text/plain & Co. ohne Preflight (CSRF), application/json nie. */
export const JSON_TYPE = /^application\/json\s*(;|$)/i;
/** Grund des lokalen Rückfalls, wenn der Zähler (Budget/Rate-Limit) nicht erreichbar ist. */
export const STORE_UNAVAILABLE = 'Budget-Speicher nicht erreichbar';

/** Klartexte, die beide Adapter gleich senden (Paritätstest). */
export const MESSAGES = {
  foreignOrigin: (origin: string): string => `Ursprung ${origin.slice(0, 100)} darf nicht schreibend zugreifen (erlaubt: corsOrigins)`,
  anonymousOrigin: 'Ohne API-Schlüssel nur aus der Website dieses Servers (Origin fehlt oder ist fremd)',
  jsonOnly: 'POST nur mit „Content-Type: application/json“',
  tooLarge: (max: number): string => `Anfrage zu groß (höchstens ${max} Bytes)`,
  badJson: 'Anfrage ist kein gültiges JSON',
  noKey: 'API-Schlüssel fehlt oder ist ungültig – Header „Authorization: Bearer <key>“ senden',
  rateLimited: (s: number): string => `Rate-Limit erreicht – in ${s} s erneut versuchen`,
  dailyExhausted: 'Tageskontingent für Beschreibungen erschöpft – ab Mitternacht (UTC) wieder möglich; der Editor funktioniert weiter ohne KI',
  notConfigured: 'NL-Steuerung nicht konfiguriert',
  promptMissing: 'prompt fehlt',
} as const;

/** Host-Kopfzeile, aus der ein eigener Ursprung abgeleitet werden darf (Name/IPv4 bzw. [IPv6], optional Port). */
const ORIGIN_HOST = /^([a-z0-9-]+(\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(:\d{1,5})?$/i;

/** Eigener Ursprung aus `Host` und Schema (`http`/`https`); `undefined` bei ungültigem Host. */
export function originOf(host: string, proto: 'http' | 'https'): string | undefined {
  if (!ORIGIN_HOST.test(host)) return undefined;
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return undefined;
  }
}

/** `origin` gleich `own` (normalisiert: Groß-/Kleinschreibung, Standard-Port). */
export function sameOrigin(origin: string, own: string | undefined): boolean {
  if (own === undefined) return false;
  try {
    return new URL(origin).origin === own;
  } catch {
    return false;
  }
}

/** Anonymer Zugang nur mit `Origin` = eigener bzw. erlaubter Ursprung; sonst 403 (vor dem Lesen des Bodys). */
export function admitAnonymous(origin: string | undefined, allowed: (origin: string) => boolean): CoreReply | undefined {
  if (origin !== undefined && allowed(origin)) return undefined;
  return { status: 403, body: { ok: false, errors: [MESSAGES.anonymousOrigin] } };
}

/** 429-Antwort zu einem abgelehnten Token. */
export const rateLimitReply = (t: Take & { ok: false }, message: string = MESSAGES.rateLimited(t.retryAfterS)): CoreReply =>
  ({ status: 429, body: { ok: false, errors: [message] }, headers: { 'retry-after': String(t.retryAfterS) } });

/**
 * Rate-Limit mit asynchronem Speicher: 429-Antwort, `undefined` (frei) oder `{ degraded }`, wenn der Speicher nicht
 * antwortet (dann nur lokal klassifizieren, kein Modellaufruf).
 */
export async function takeRateLimit(limiter: AsyncRateLimiter | undefined, key: string): Promise<CoreReply | { readonly degraded: string } | undefined> {
  if (limiter === undefined) return undefined;
  let t: Take;
  try {
    t = await limiter.take(key);
  } catch {
    return { degraded: STORE_UNAVAILABLE };
  }
  return t.ok ? undefined : rateLimitReply(t);
}

export interface InterpretDeps {
  readonly engine: Engine;
  /** Ohne → 503 (NL-Steuerung nicht konfiguriert). */
  readonly interpret: InterpretOptions | undefined;
  /** Tagesbudget der anonymen Aufrufe; fehlt oder `max <= 0` = unbegrenzt. */
  readonly budget?: DailyBudget | undefined;
  /** Prompt-Log (Trainingsdaten); auf Vercel nie gesetzt. */
  readonly log?: ((entry: PromptLogEntry) => void) | undefined;
  /** Uhr für den Tag des Budgets (Standard `Date.now`). */
  readonly now?: (() => number) | undefined;
  /** F-JEV-iterativ: „Planen & verbessern“ verfügbar (Server: `iteratesWithModel`); fehlt = aus (Vercel). */
  readonly iterate?: boolean | undefined;
}

export interface InterpretCall {
  /** Gelesener JSON-Body. */
  readonly body: unknown;
  /** Anonymer Aufruf (öffentlicher Modus ohne Schlüssel): Budget gilt. */
  readonly anonymous: boolean;
  /** Grund, aus dem nur lokal klassifiziert werden darf (z. B. Speicher weg, kein Budget-Speicher konfiguriert). */
  readonly localOnly?: string | undefined;
}

/** `POST /v1/interpret` nach Anmeldung, Ursprung und Rate-Limit: Prompt prüfen, Budget zählen, klassifizieren. */
export async function handleInterpret(call: InterpretCall, deps: InterpretDeps): Promise<CoreReply> {
  if (deps.interpret === undefined) return { status: 503, body: { ok: false, errors: [MESSAGES.notConfigured] } };
  const prompt = (call.body as { prompt?: unknown } | null)?.prompt;
  if (typeof prompt !== 'string' || prompt.trim() === '') return { status: 400, body: { ok: false, errors: [MESSAGES.promptMissing] } };
  let localOnly = call.localOnly;
  const budget = deps.budget;
  if (call.anonymous && budget !== undefined && budget.max > 0) {
    // Tagesbudget aller anonymen Aufrufe (UTC-Tag); zählt erst gültige Beschreibungen
    let t: Take | undefined;
    try {
      t = await budget.take((deps.now ?? Date.now)());
    } catch {
      localOnly ??= STORE_UNAVAILABLE;
    }
    if (t !== undefined && !t.ok) return rateLimitReply(t, MESSAGES.dailyExhausted);
  }
  const opts = deps.interpret;
  const forced = localOnly !== undefined && opts.mode !== 'local';
  const engine = deps.engine;
  const t0 = performance.now();
  try {
    const it0 = await interpret(prompt, engine, forced ? { ...opts, mode: 'local' } : opts);
    const it = forced ? { ...it0, fallback: localOnly } : it0;
    const errors = engine.validate(it.request);
    deps.log?.({
      ts: new Date().toISOString(), prompt, model: it.model, request: it.request, ok: errors.length === 0,
      ...(it.fallback !== undefined ? { fallback: it.fallback } : {}), ...(errors.length > 0 ? { errors } : {}),
    });
    return {
      status: errors.length === 0 ? 200 : 400,
      body: {
        ok: errors.length === 0, request: it.request, model: it.model, interpretMs: Math.round(performance.now() - t0),
        ...(it.fallback !== undefined ? { fallback: it.fallback } : {}), ...(it.confidence !== undefined ? { confidence: it.confidence } : {}),
        ...(errors.length > 0 ? { errors } : {}),
        // F-JEV-iterativ: Schalter an (und nicht auf lokal gezwungen) → die App bietet „Planen & verbessern“ an; aus → Feld fehlt
        ...(deps.iterate === true && !forced ? { iterate: true } : {}),
      },
    };
  } catch (err) {
    return { status: 502, body: { ok: false, errors: [err instanceof Error ? err.message : String(err)] } };
  }
}
