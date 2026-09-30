/**
 * Natural Language → Engine-Anfrage über OpenRouter (OpenAI-kompatibel). Das Modell klassifiziert nur: Es wählt eine
 * Operation und füllt deren Felder aus dem Vokabular (enums im Schema). Die eigentliche Generierung ist die
 * deterministische Engine – das Modell sieht keine Blöcke und erzeugt keine.
 *
 * Modi:
 * - `decisions` (Standard, Modell `typesafe/jev-1.13`): Entscheidungsmodell über die Decisions-API; Fragen automatisch
 *   aus dem Schema von `building_generate` (`decisions.ts`, `../intent/decisions.ts`). Gewählt, sobald ENGINE_NL_MODEL
 *   ein System-One-Modell ist (`typesafe/…`, `jev-…`).
 * - `tools`: Function Calling mit `engine.tools()`, `tool_choice: required` (Chat-Modelle)
 * - `json_schema`: `response_format` mit `engine.requestSchema()` (Antwort ist direkt `{ op, input }`)
 * - `local`: nur der lokale Klassifikator (ohne Schlüssel)
 *
 * Konfiguration nur über Umgebung (nie einchecken, Regel siehe `interpretOptionsFromEnv`): ENGINE_NL_API_KEY, CLASSIFIER_PROVIDER, ENGINE_NL_MODEL, ENGINE_NL_MODE,
 * ENGINE_NL_TIMEOUT_MS, ENGINE_NL_RETRIES, ENGINE_NL_REASONING, ENGINE_NL_MIN_CONFIDENCE, ENGINE_NL_DECISIONS_URL.
 *
 * Robustheit (Live-Test 2026-09-24): Zeitlimit je Versuch, ein Wiederholungsversuch bei 429/5xx/Netz/Zeitlimit,
 * Klartext-Fehler je HTTP-Status (Schlüssel nie in Meldungen), Tupel-Schemas (`prefixItems`) für Anbieter wie Gemini
 * umgeschrieben und Grenzen als Text, geringer Reasoning-Aufwand als Standard (gpt-oss-20b brauchte sonst bis 81 s).
 */
import type { Engine, EngineRequest } from '../engine.js';
import { COMBINE_MODES, type CombineMode } from '../intent/decisions.js';
import { classifyLocal } from '../intent/local.js';
import type { OperationId } from '../operation.js';
import { DEFAULT_DECISIONS_MODEL, PRESETS, endpointOf, postJson, type ErrorBody, type FetchLike, type PresetName } from '@mcda/classify';
import { providerNameFromEnv, resolveEnv } from '@mcda/classify/env';
import { interpretDecisions, isDecisionsModel } from './decisions.js';
import { iterateOptionsFromEnv, type IterateOptions } from './design.js';

/** Fehler des Modellaufrufs (aus `@mcda/classify`, dort `DecisionError`: status, retry, body). */
export { DecisionError as ModelError } from '@mcda/classify';

/** `decisions`: Entscheidungsmodell (System One, z. B. JEV) über die Decisions-API, siehe `decisions.ts`. */
export type InterpretMode = 'tools' | 'json_schema' | 'decisions' | 'local';

export interface InterpretOptions {
  /** Leer bei Modus `local`. */
  readonly apiKey: string;
  /** OpenRouter-Modell-ID, z. B. `typesafe/jev-1.13` (Modus decisions) oder `openai/gpt-oss-20b` (Chat). */
  readonly model: string;
  readonly mode?: InterpretMode;
  readonly baseUrl?: string;
  /** Modus decisions: System-One-Anbieter (Standard `jev-openrouter`; `typesafe`, `kev`), siehe `@mcda/classify`. */
  readonly provider?: PresetName;
  readonly fetch?: typeof fetch | FetchLike;
  readonly signal?: AbortSignal;
  /** Bei Fehler des Modells (Netz, Sperre, ungültige Antwort) lokal klassifizieren (Standard true). */
  readonly fallback?: boolean;
  /** Lokaler Vorfilter: ab dieser Sicherheit des lokalen Klassifikators kein Modellaufruf (Standard: aus). */
  readonly localFirst?: number;
  /** Angebotene Operationen (Standard: die zustandslosen, `engine.stateless`). */
  readonly operations?: readonly OperationId[];
  /** Zeitlimit je Modellaufruf in ms (Standard 30 000). */
  readonly timeoutMs?: number;
  /** Wiederholungen bei 429, 5xx, Netzfehler oder Zeitlimit (Standard 1). */
  readonly retries?: number;
  /** Reasoning-Aufwand für Reasoning-Modelle (Standard bei OpenRouter `low`, sonst nicht gesendet; `off` = nie senden). */
  readonly reasoning?: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  /** Modus decisions: volle Endpunkt-URL (Standard: Endpunkt des Anbieters, `DEFAULT_DECISIONS_URL` bei OpenRouter). */
  readonly decisionsUrl?: string;
  /** Modus decisions: Mindest-Konfidenz bzw. P(ja) je Feld (Standard 0,6). */
  readonly minConfidence?: number;
  /** Modus decisions: Kombination mit dem lokalen Klassifikator (Standard `fill`: ergänzt, was JEV weglässt). */
  readonly combine?: CombineMode;
  /**
   * F-JEV-iterativ (`plan/spikes/F_jev_iterativ.md`): Schalter und Budget für `design_iterate` mit Modell (Planer und
   * Kritiker in einer Schleife). Fehlt oder `enabled: false` = aus: `design_iterate` antwortet lokal. Nur aus
   * `ENGINE_NL_ITERATE` gesetzt; ohne die Variable fehlt das Feld.
   */
  readonly iterate?: IterateOptions;
}

export interface Interpretation {
  readonly request: EngineRequest;
  readonly model: string;
  readonly usage?: unknown;
  /** Grund, falls lokal statt per Modell klassifiziert wurde. */
  readonly fallback?: string;
  /**
   * Modus decisions: Konfidenz je übernommenem Feld (Pfad → 0–1), für Oberfläche und Fehlersuche. Lokal erkannt
   * (`model: 'local'`, auch als Rückfall): `{ buildingTypeId }` = Sicherheit des lokalen Klassifikators (1 genannt,
   * 0,8 Kompositum, 0,3 angenommen); „sicher erkannt“ ab `TYPE_CONFIDENCE_MIN` (`@mcda/engine/intent`).
   */
  readonly confidence?: Readonly<Record<string, number>>;
}

/**
 * Standard: JEV (TypeSafe, System One) – 0,3–0,6 s, ca. 0,0001 $ je Prompt, typisierte Antworten mit Konfidenz
 * (Vergleich in plan/spikes/E1_engine_api.md). Chat-Modelle bleiben per ENGINE_NL_MODEL wählbar.
 */
export const DEFAULT_MODEL: string = DEFAULT_DECISIONS_MODEL;
/** Bisheriger Standard der Chat-Modelle (Function Calling). */
export const DEFAULT_CHAT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
const REASONING = ['off', 'minimal', 'low', 'medium', 'high'] as const;

/**
 * Optionen aus der Umgebung – Regel in `@mcda/classify/env` (dokumentiert in `.env.example`):
 * - Anbieter: CLASSIFIER_PROVIDER (jev-openrouter | typesafe | kev); typesafe/kev erzwingen den Modus decisions.
 * - Key: ENGINE_NL_API_KEY → CLASSIFIER_API_KEY → Key des Anbieters (OPENROUTER_API_KEY | TYPESAFE_API_KEY | KEV_API_KEY).
 * - Modell: ENGINE_NL_MODEL → CLASSIFIER_MODEL → Preset (Standard `typesafe/jev-1.13`). Chat-Modelle nur über OpenRouter.
 * - Endpunkt: ENGINE_NL_DECISIONS_URL → CLASSIFIER_BASE_URL + CLASSIFIER_PATH → Preset.
 * - ENGINE_NL_TIMEOUT_MS/_RETRIES → CLASSIFIER_TIMEOUT_MS/_RETRIES.
 * Ohne nötigen Schlüssel: Modus `local` (lokaler Klassifikator), sofern nicht ausdrücklich ein Modell-Modus verlangt
 * ist – dann ein klarer Fehler. Kev braucht keinen Schlüssel.
 */
export function interpretOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): InterpretOptions {
  const num = (k: string): number | undefined => {
    const v = env[k];
    return v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  const provider = providerNameFromEnv(env);
  const r = resolveEnv(env, {
    apiKey: env['ENGINE_NL_API_KEY'], model: env['ENGINE_NL_MODEL'], url: env['ENGINE_NL_DECISIONS_URL'],
    timeoutMs: num('ENGINE_NL_TIMEOUT_MS'), retries: num('ENGINE_NL_RETRIES'),
  });
  const apiKey = r.config.apiKey ?? '';
  const mode = env['ENGINE_NL_MODE'];
  if (r.missingKey && mode !== undefined && mode !== 'local') {
    throw new Error(`ENGINE_NL_API_KEY/${r.keyVars.join('/')} fehlt (in .env oder Umgebung setzen, nie einchecken) – oder ENGINE_NL_MODE=local`);
  }
  const local = env['ENGINE_NL_LOCAL_FIRST'];
  const reasoning = REASONING.find((x) => x === env['ENGINE_NL_REASONING']);
  const model = r.config.model;
  const minConfidence = num('ENGINE_NL_MIN_CONFIDENCE');
  const combine = COMBINE_MODES.find((m) => m === env['ENGINE_NL_COMBINE']);
  const decisions = mode === 'decisions' || provider !== 'jev-openrouter' || isDecisionsModel(model);
  const url = endpointOf(r.config);
  const decisionsUrl = url !== endpointOf(PRESETS[provider]) ? url : undefined;
  return {
    apiKey,
    model: r.missingKey ? 'local' : model,
    // Das Modell bestimmt die Schnittstelle: Entscheidungsmodelle können kein Chat (400), Chat-Modelle keine Decisions
    mode: r.missingKey || mode === 'local' ? 'local' : decisions ? 'decisions' : mode === 'json_schema' ? 'json_schema' : 'tools',
    ...(provider !== 'jev-openrouter' ? { provider } : {}),
    ...(decisionsUrl ? { decisionsUrl } : {}),
    ...(minConfidence !== undefined ? { minConfidence } : {}),
    ...(combine !== undefined ? { combine } : {}),
    ...(env['ENGINE_NL_BASE_URL'] !== undefined ? { baseUrl: env['ENGINE_NL_BASE_URL'] } : {}),
    ...(env['ENGINE_NL_FALLBACK'] === '0' ? { fallback: false } : {}),
    ...(local !== undefined && local !== '' ? { localFirst: Number(local) } : {}),
    ...(r.config.timeoutMs !== undefined ? { timeoutMs: r.config.timeoutMs } : {}),
    ...(r.config.retries !== undefined ? { retries: r.config.retries } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(env['ENGINE_NL_ITERATE'] !== undefined && env['ENGINE_NL_ITERATE'] !== '' ? { iterate: iterateOptionsFromEnv(env) } : {}),
  };
}

/** Grenzen, die als Text in die Beschreibung wandern (siehe `llmSchema`). */
const BOUNDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems'] as const;

/**
 * JSON Schema für LLM-Anbieter (Befunde Live-Test mit Gemini über OpenRouter):
 * - Tupel (`prefixItems`, aus zod-Tupeln wie `[x, z]`) werden zu `items` – Gemini: „items: missing field“.
 * - Zahlen-, Längen- und Anzahl-Grenzen wandern in die Beschreibung („[1–5]“) – Gemini: „too many states for serving“.
 * Die Engine prüft jede Antwort ohnehin mit dem vollständigen zod-Schema (ungültig → lokaler Rückfall).
 */
export function llmSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((x) => llmSchema(x) as unknown) as T;
  if (schema === null || typeof schema !== 'object') return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === 'prefixItems' || ((BOUNDS as readonly string[]).includes(k) && typeof v === 'number')) continue;
    out[k] = llmSchema(v);
  }
  const prefix = src['prefixItems'];
  if (Array.isArray(prefix) && prefix.length > 0) {
    const items = prefix.map((x) => llmSchema(x) as unknown);
    const unique = [...new Map(items.map((x) => [JSON.stringify(x), x])).values()];
    out['items'] = unique.length === 1 ? unique[0] : { anyOf: unique };
  }
  const n = (k: string): number | undefined => (typeof src[k] === 'number' ? src[k] : undefined);
  const range = (lo: number | undefined, hi: number | undefined, unit = ''): string | undefined =>
    lo === undefined && hi === undefined ? undefined : lo === hi ? `${lo}${unit}` : `${lo ?? ''}–${hi ?? ''}${unit}`;
  const hint = range(n('minimum') ?? n('exclusiveMinimum'), n('maximum') ?? n('exclusiveMaximum'))
    ?? range(n('minLength'), n('maxLength'), ' Zeichen')
    ?? (Array.isArray(prefix) && prefix.length > 0 ? `${prefix.length} Werte` : range(n('minItems'), n('maxItems'), ' Einträge'));
  if (hint !== undefined) out['description'] = `${typeof src['description'] === 'string' ? `${src['description']} ` : ''}[${hint}]`;
  return out as T;
}

/** System-Prompt: Rolle + kompaktes Vokabular (IDs mit Namen), damit „Hobbithöhle“ auf `hobbit` fällt. */
export function systemPrompt(engine: Engine): string {
  const v = engine.vocabulary;
  const bt = v.buildingTypes.filter((b) => !b.draft).map((b) => `${b.id} (${b.name}; Größen ${b.sizes.join('/')}${b.themes.length > 0 ? `; Themes ${b.themes.join('/')}` : ''})`);
  return [
    'Du steuerst einen Generator für eingerichtete Minecraft-Gebäude. Übersetze die Bitte des Nutzers in GENAU EINEN Aufruf.',
    'Wähle nur Werte aus dem Schema. Lass Felder weg, zu denen der Nutzer nichts sagt (die Engine hat gute Standards).',
    'klein → S, mittel → M, groß → L. Mehrere Etagen → floors. In einen Hügel/unter die Erde → setting.kind buried.',
    'Eingang/Front nach Norden/Osten/Süden/Westen → front. Stil- und Epochenwörter → themeId (mittelalterlich → medieval, '
      + 'nordisch → nordic, rustikal → rustic, „im Bauernhof-Stil“ → farmstead), auch wenn der Bautyp schon passt.',
    `Bautypen: ${bt.join(', ')}.`,
    `Themes: ${v.themes.map((t) => `${t.id} (${t.name})`).join(', ')}.`,
  ].join('\n');
}

interface ChatResponse extends ErrorBody {
  readonly model?: string;
  readonly usage?: unknown;
  readonly choices?: ReadonlyArray<{
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: ReadonlyArray<{ readonly function?: { readonly name?: string; readonly arguments?: string } }>;
    };
  }>;
}

/**
 * Prompt → `{ op, input }` (noch nicht ausgeführt). Reihenfolge: lokaler Vorfilter (`localFirst`) → Modell →
 * bei Fehler oder ungültiger Anfrage lokaler Rückfall (`fallback`, Standard an).
 */
export async function interpret(prompt: string, engine: Engine, opts: InterpretOptions): Promise<Interpretation> {
  if (prompt.trim() === '') throw new Error('Prompt ist leer – bitte beschreiben, was gebaut werden soll');
  const local = (reason?: string): Interpretation => {
    const r = classifyLocal(prompt, engine.vocabulary);
    // W1-G (S2/R1-02): Sicherheit zum Bautyp wie bei JEV (Feldpfad → 0–1), damit Website und Editor unter
    // `TYPE_CONFIDENCE_MIN` nichts vorschlagen, sondern um eine Wahl bitten (Unsinn → 0,3 statt stillem Beispielhaus)
    return { request: r.request, model: 'local', confidence: { buildingTypeId: r.confidence }, ...(reason !== undefined ? { fallback: reason } : {}) };
  };
  if (opts.mode === 'local') return local();
  if (opts.localFirst !== undefined && classifyLocal(prompt, engine.vocabulary).confidence >= opts.localFirst) return local();
  try {
    const decisions = opts.mode === 'decisions' || (opts.mode === undefined && isDecisionsModel(opts.model));
    const it = decisions ? await interpretDecisions(prompt, engine, opts) : await interpretRemote(prompt, engine, opts);
    // Das Modell darf nur angebotene Operationen wählen (sonst z. B. project_delete per Prompt)
    const offered = opts.operations ?? engine.stateless;
    if (!offered.includes(it.request.op)) {
      const reason = `Modell wählte nicht angebotene Operation '${String(it.request.op).slice(0, 64)}'`;
      if (opts.fallback === false) throw new Error(reason);
      return local(reason);
    }
    const errors = engine.validate(it.request);
    if (errors.length > 0 && opts.fallback !== false) return local(`Modell-Anfrage ungültig: ${errors.join('; ')}`);
    return withLocalTypeConfidence(it, prompt, engine);
  } catch (err) {
    if (opts.fallback === false) throw err;
    return local(err instanceof Error ? err.message : String(err));
  }
}

/**
 * W1-G (R1-02): JEV ließ den Bautyp offen (keine Konfidenz dafür) – dann hat ihn der lokale Klassifikator ergänzt
 * (`decideIntent`, Pflichtfeld). Seine Sicherheit gehört in die Antwort, sonst hielten Website und Editor einen
 * angenommenen Standard („Haus“) für erkannt. Chat-Modelle ohne Konfidenz bleiben unverändert.
 */
function withLocalTypeConfidence(it: Interpretation, prompt: string, engine: Engine): Interpretation {
  if (it.confidence === undefined || it.confidence['buildingTypeId'] !== undefined) return it;
  const r = classifyLocal(prompt, engine.vocabulary);
  const typeOf = (x: unknown): unknown => (typeof x === 'object' && x !== null ? (x as Record<string, unknown>)['buildingTypeId'] : undefined);
  if (typeOf(it.request.input) === undefined || typeOf(r.request.input) !== typeOf(it.request.input)) return it;
  return { ...it, confidence: { ...it.confidence, buildingTypeId: r.confidence } };
}

async function interpretRemote(prompt: string, engine: Engine, opts: InterpretOptions): Promise<Interpretation> {
  const mode = opts.mode ?? 'tools';
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const ops = opts.operations ?? engine.stateless;
  const openrouter = base.startsWith('https://openrouter.ai/');
  const effort = opts.reasoning ?? (openrouter ? 'low' : 'off');
  const body = {
    model: opts.model,
    temperature: 0,
    messages: [{ role: 'system', content: systemPrompt(engine) }, { role: 'user', content: prompt }],
    ...(effort === 'off' ? {} : openrouter ? { reasoning: { effort } } : { reasoning_effort: effort }),
    ...(mode === 'tools'
      ? { tools: llmSchema(engine.tools(ops)), tool_choice: 'required' }
      : { response_format: { type: 'json_schema', json_schema: { name: 'engine_request', strict: false, schema: llmSchema(engine.requestSchema(ops)) } } }),
  };
  const json = await postJson<ChatResponse>(`${base}/chat/completions`, JSON.stringify(body), {
    apiKey: opts.apiKey, keyHint: 'ENGINE_NL_API_KEY', headers: { 'X-Title': 'base-interior-generator' },
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
  });
  const msg = json.choices?.[0]?.message;
  const model = json.model ?? opts.model;
  const usage = json.usage;
  if (mode === 'tools') {
    const call = msg?.tool_calls?.[0]?.function;
    if (call?.name === undefined) throw new Error(`Modell hat kein Tool gewählt: ${msg?.content ?? '(leer)'}`);
    return { request: { op: call.name as EngineRequest['op'], input: parseArgs(call.arguments) }, model, usage };
  }
  const parsed = parseArgs(msg?.content ?? undefined) as Partial<EngineRequest>;
  if (typeof parsed.op !== 'string') throw new Error(`Antwort ist keine Engine-Anfrage: ${msg?.content ?? '(leer)'}`);
  return { request: { op: parsed.op, input: parsed.input ?? {} }, model, usage };
}

function parseArgs(s: string | undefined): unknown {
  if (s === undefined || s.trim() === '') return {};
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`Modell-Antwort ist kein JSON: ${s.slice(0, 200)}`);
  }
}
