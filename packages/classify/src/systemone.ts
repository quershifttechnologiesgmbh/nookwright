import { DecisionError, postJson, type ErrorBody, type FetchLike } from './transport.js';
import type { Answer, DecisionProvider, DecisionRequest, DecisionResponse } from './types.js';


/** Zeitlimit je Versuch: Jev antwortet in 0,3–0,6 s; Reserve für Kaltstart und Netz. */
export const DECISIONS_TIMEOUT_MS = 10_000;

export interface SystemOneConfig {
  /** Anzeigename für Logs und Fehlermeldungen, z. B. "jev-openrouter". */
  readonly name: string;
  /** Basis-URL, z. B. "https://openrouter.ai/api/alpha". */
  readonly baseUrl: string;
  /** Pfad des Entscheidungs-Endpunkts, z. B. "/decisions" (OpenRouter) oder "/v1/systemone" (TypeSafe, Kev); leer = `baseUrl` ist schon der Endpunkt. */
  readonly path: string;
  /** Modell-ID, wie der Anbieter sie erwartet. */
  readonly model: string;
  /** Bearer-Token. Nur aus der Umgebung übergeben, nie im Code. Leer = ohne Authorization-Header (lokales Kev). */
  readonly apiKey?: string;
  /** Zeitlimit je Versuch (Standard {@link DECISIONS_TIMEOUT_MS}). */
  readonly timeoutMs?: number;
  /** Wiederholungen bei 429/5xx/Netz/Zeitlimit (Standard 1). */
  readonly retries?: number;
  /** Zusätzliche Header (z. B. OpenRouters "X-Title"). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Hinweis bei 401, welche Variable zu prüfen ist. */
  readonly keyHint?: string;
  /** Für Tests; Standard ist das globale `fetch`. */
  readonly fetch?: FetchLike;
}

/** Vollständige Endpunkt-URL aus Basis und Pfad. */
export const endpointOf = (c: Pick<SystemOneConfig, 'baseUrl' | 'path'>): string =>
  c.path.replace(/^\/+/, '') === '' ? c.baseUrl : `${c.baseUrl.replace(/\/+$/, '')}/${c.path.replace(/^\/+/, '')}`;

interface RawResponse extends ErrorBody {
  readonly model?: unknown;
  readonly answers?: unknown;
  readonly usage?: unknown;
  readonly latency_ms?: unknown;
}

/**
 * Anbieter für jede API im System-One-Format: Jev über OpenRouter, TypeSafe direkt, Kev oder OpenJev.
 * Alle sprechen dasselbe JSON; es unterscheiden sich nur Basis-URL, Pfad, Modell-ID und Key.
 * Fehler: {@link DecisionError} mit Status und Klartext; ein Wiederholungsversuch bei 429/5xx/Netz/Zeitlimit.
 */
export function createSystemOneProvider(config: SystemOneConfig): DecisionProvider {
  const url = endpointOf(config);
  return {
    name: config.name,
    async decide(request: DecisionRequest, options = {}): Promise<DecisionResponse> {
      const json = await postJson<RawResponse>(url, JSON.stringify({ model: config.model, state: request.state, questions: request.questions }), {
        name: config.name,
        timeoutMs: config.timeoutMs ?? DECISIONS_TIMEOUT_MS,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        ...(config.retries !== undefined ? { retries: config.retries } : {}),
        ...(config.headers !== undefined ? { headers: config.headers } : {}),
        ...(config.keyHint !== undefined ? { keyHint: config.keyHint } : {}),
        ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
      return parseDecisionResponse(json, request, config.model);
    },
  };
}

/**
 * Liest die Antwort tolerant (snake_case, fehlendes `type`, fehlende Konfidenz → Wahrscheinlichkeit der Wahl).
 * Fehlt eine einzelne Antwort, fehlt sie auch im Ergebnis (Aufrufer entscheiden, z. B. `classify` wirft); fehlen alle
 * oder ist eine vorhandene Antwort ungültig → {@link DecisionError}.
 */
export function parseDecisionResponse(json: unknown, request: DecisionRequest, fallbackModel: string): DecisionResponse {
  if (!isObject(json) || !isObject(json['answers'])) throw new DecisionError(`Antwort ohne answers: ${JSON.stringify(json).slice(0, 200)}`);
  const raw = json['answers'];
  const answers: Record<string, Answer> = {};
  for (const [id, q] of Object.entries(request.questions)) {
    const a = raw[id];
    if (isObject(a)) answers[id] = parseAnswer(id, q.type, a);
  }
  if (Object.keys(answers).length === 0) throw new DecisionError(`Keine Antwort auf die gestellten Fragen: ${JSON.stringify(raw).slice(0, 200)}`);
  const u = json['usage'];
  const usage = isObject(u)
    ? {
      inputTokens: num(u['input_tokens'] ?? u['prompt_tokens']), outputTokens: num(u['output_tokens'] ?? u['completion_tokens']),
      ...(typeof u['cost'] === 'number' ? { cost: u['cost'] } : {}),
    }
    : undefined;
  const latency = json['latency_ms'];
  return {
    model: typeof json['model'] === 'string' ? json['model'] : fallbackModel,
    answers,
    ...(usage ? { usage } : {}),
    ...(typeof latency === 'number' ? { latencyMs: latency } : {}),
  };
}

function parseAnswer(id: string, type: Answer['type'], a: Record<string, unknown>): Answer {
  const bad = (field: string) => new DecisionError(`Antwort "${id}" (${type}): Feld "${field}" fehlt oder ist ungültig`);
  switch (type) {
    case 'noul': {
      if (typeof a['noul'] !== 'number') throw bad('noul');
      return { type, noul: a['noul'] };
    }
    case 'choice': {
      if (typeof a['choice'] !== 'string') throw bad('choice');
      const probabilities = numRecord(a['probabilities']);
      return { type, choice: a['choice'], confidence: num(a['confidence'] ?? probabilities[a['choice']]), probabilities };
    }
    case 'score': {
      if (typeof a['score'] !== 'number') throw bad('score');
      const legend: Record<string, string> = {};
      if (isObject(a['legend'])) for (const [k, v] of Object.entries(a['legend'])) if (typeof v === 'string') legend[k] = v;
      const probabilities = numRecord(a['probabilities']);
      return { type, score: a['score'], confidence: num(a['confidence'] ?? probabilities[String(Math.round(a['score']))]), probabilities, legend };
    }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObject(v)) for (const [k, p] of Object.entries(v)) if (typeof p === 'number') out[k] = p;
  return out;
}
