/**
 * HTTP zum Modell-Anbieter (System-One-/Decisions-API und OpenAI-kompatible Chat-Completions): Zeitlimit je Versuch,
 * Wiederholung bei 429/5xx/Netz/Zeitlimit (mit `Retry-After`), Klartext-Fehler je Status, OpenRouter-Fehlerkörper
 * (auch bei HTTP 200). Der Schlüssel erscheint nie in Meldungen. Einzige Stelle für diese Regeln im Repo – die Engine
 * nutzt sie für JEV und für Chat-Modelle.
 */

/** Minimal-`fetch` (globales `fetch` passt; Tests geben eigene Funktionen). */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers?: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface PostOptions {
  /** Bearer-Token; leer = ohne Authorization-Header (lokales Kev). */
  readonly apiKey?: string;
  readonly fetch?: FetchLike;
  readonly signal?: AbortSignal;
  /** Zeitlimit je Versuch in ms (Standard {@link DEFAULT_TIMEOUT_MS}). */
  readonly timeoutMs?: number;
  /** Wiederholungen bei 429, 5xx, Netzfehler oder Zeitlimit (Standard 1). */
  readonly retries?: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Name für Meldungen, z. B. „jev-openrouter“ (Standard „Modell-Anbieter“). */
  readonly name?: string;
  /** Hinweis bei 401, welche Variable zu prüfen ist (z. B. „ENGINE_NL_API_KEY“). */
  readonly keyHint?: string;
}

/** Fehlerteil einer Anbieter-Antwort (OpenRouter-Format). */
export interface ErrorBody {
  readonly error?: { readonly message?: string; readonly metadata?: { readonly raw?: unknown; readonly provider_name?: string } };
}

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Fehler des Modellaufrufs; `retry` = Wiederholung sinnvoll (429, 5xx, Netz, Zeitlimit). */
export class DecisionError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: string, readonly retry: boolean = false) {
    super(message);
    this.name = 'DecisionError';
  }
}

/** Klartext je Status; Anbieter-Detail (`metadata.raw`) gekürzt dazu, damit Schema-Ablehnungen sichtbar sind. */
function httpError(name: string, status: number, json: ErrorBody | undefined, text: string, keyHint: string): DecisionError {
  const raw = json?.error?.metadata?.raw;
  let detail = json?.error?.message ?? text.slice(0, 200);
  if (raw !== undefined) {
    const r = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const inner = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(r)?.[1] ?? r;
    detail = `${detail}${json?.error?.metadata?.provider_name !== undefined ? ` (${json.error.metadata.provider_name})` : ''}: ${inner.replace(/\\n/g, ' ').slice(0, 300)}`;
  }
  const hint = status === 401 ? `Schlüssel ungültig oder abgelaufen – ${keyHint} prüfen`
    : status === 402 ? 'Guthaben oder Limit des Schlüssels erschöpft'
      : status === 403 ? 'Zugriff verweigert (Schlüssel, Modell oder Netz gesperrt)'
        : status === 429 ? 'Rate-Limit erreicht'
          : status >= 500 ? 'Anbieter-Fehler'
            : status === 400 ? 'Anfrage abgelehnt' : 'Fehler';
  return new DecisionError(`${name} ${status} (${hint}): ${detail}`, status, text.slice(0, 1000), status === 429 || status >= 500);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** POST mit JSON-Körper, Antwort als JSON. Wirft {@link DecisionError}. */
export async function postJson<T extends ErrorBody>(url: string, body: string, opts: PostOptions = {}): Promise<T> {
  const retries = Math.max(0, opts.retries ?? 1);
  for (let attempt = 0; ; attempt++) {
    try {
      return await postOnce<T>(url, body, opts);
    } catch (err) {
      const e = err instanceof DecisionError ? err : new DecisionError(err instanceof Error ? err.message : String(err), undefined, undefined, true);
      if (!e.retry || attempt >= retries || opts.signal?.aborted === true) throw e;
      await sleep(Math.min(5_000, (e as DecisionError & { retryAfterMs?: number }).retryAfterMs ?? 500 * (attempt + 1)));
    }
  }
}

async function postOnce<T extends ErrorBody>(url: string, body: string, opts: PostOptions): Promise<T> {
  const name = opts.name ?? 'Modell-Anbieter';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal !== undefined ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const headers: Record<string, string> = { 'content-type': 'application/json', ...opts.headers };
  if (opts.apiKey) headers['authorization'] = `Bearer ${opts.apiKey}`;
  const doFetch: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  let res: Awaited<ReturnType<FetchLike>>;
  let text: string;
  try {
    res = await doFetch(url, { method: 'POST', headers, body, signal });
    text = await res.text();
  } catch (err) {
    if (timeout.aborted) throw new DecisionError(`${name}: Zeitlimit ${timeoutMs} ms überschritten`, undefined, undefined, true);
    if (opts.signal?.aborted === true) throw new DecisionError('Modellaufruf abgebrochen');
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${(err.cause as { code?: string }).code ?? err.cause.message})` : '';
    throw new DecisionError(`${name} nicht erreichbar: ${err instanceof Error ? err.message : String(err)}${cause}`, undefined, undefined, true);
  }
  let json: T | undefined;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = undefined;
  }
  if (!res.ok || json?.error !== undefined) {
    const e = httpError(name, res.ok ? 502 : res.status, json, text, opts.keyHint ?? 'API-Key');
    const ra = Number(res.headers?.get('retry-after'));
    if (Number.isFinite(ra) && ra > 0) Object.assign(e, { retryAfterMs: ra * 1000 });
    throw e;
  }
  if (json === undefined) throw new DecisionError(`${name} ${res.status}: Antwort ist kein JSON: ${text.slice(0, 200)}`, res.status, text.slice(0, 1000));
  return json;
}
