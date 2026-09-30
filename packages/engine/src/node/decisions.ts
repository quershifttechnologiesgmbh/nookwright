/**
 * Natural Language → `building_generate` über ein Entscheidungsmodell (System One, z. B. JEV `typesafe/jev-1.13`).
 * Transport, Anbieterwahl, Fehlerbehandlung, Retry und Zeitlimit liegen in `@mcda/classify` (EIN System-One-Client im
 * Repo); hier nur die Engine-Seite: Fragen automatisch aus dem JSON Schema der Operation und dem Vokabular
 * (`../intent/decisions.ts`), Antworten unter der Schwelle (`minConfidence`, Standard 0,6) oder „nicht angegeben“
 * lassen das Feld weg; Felder, die der lokale Klassifikator sicher erkennt und JEV weglässt, ergänzt er (`combine`,
 * Standard `fill`, siehe E1 „J2 Treffsicherheit“). Das Ergebnis geht durch dieselbe zod-Validierung wie beim Chat-Modell (`interpret`), bei Fehler
 * lokaler Rückfall. Quellen: plan/spikes/jev-docs/ (Tutorial, API-Referenz, Klassifikations-Kochbuch).
 */
import {
  DECISIONS_TIMEOUT_MS, DEFAULT_DECISIONS_URL, PRESETS, createSystemOneProvider, endpointOf, isSystemOneModel,
  type DecisionProvider, type DecisionRequest, type PresetName,
} from '@mcda/classify';
import type { Engine } from '../engine.js';
import { DEFAULT_COMBINE, DEFAULT_MIN_CONFIDENCE, combineLocal, decideIntent, decisionPlan, type DecisionPlan } from '../intent/decisions.js';
import { classifyLocal } from '../intent/local.js';
import type { InterpretOptions, Interpretation } from './openrouter.js';

export { DECISIONS_TIMEOUT_MS, DEFAULT_DECISIONS_URL };
/** Operation, auf die das Entscheidungsmodell abbildet (einzelne Bitte → ein Gebäude). */
export const DECISIONS_OP = 'building_generate';

/** System-One-/Decisions-Modell (TypeSafe): `typesafe/jev-1.13`, `~typesafe/jev-latest`, `jev-1.13`, `kev-latest`. */
export const isDecisionsModel = isSystemOneModel;

const plans = new WeakMap<Engine, DecisionPlan>();
/** Fragen einmal je Engine (Vokabular ist fest). */
export function decisionPlanOf(engine: Engine): DecisionPlan {
  let plan = plans.get(engine);
  if (plan === undefined) {
    plan = decisionPlan(engine.inputSchema(DECISIONS_OP), engine.vocabulary);
    plans.set(engine, plan);
  }
  return plan;
}

/** Anfrage laut API-Referenz (`state`, `questions`; `model` setzt der Anbieter). */
export function decisionsRequest(prompt: string, plan: DecisionPlan): DecisionRequest {
  return {
    state: { bitte: prompt, kontext: 'Bitte eines Nutzers an einen Generator für eingerichtete Minecraft-Gebäude' },
    questions: plan.questions,
  };
}

/**
 * System-One-Anbieter aus den Interpret-Optionen (Anbieter-Preset, Endpunkt, Modell, Key, Zeitlimit, Retry, fetch).
 * Auch für `roomtype_classify` im HTTP-Server und MCP.
 */
export function decisionProviderOf(opts: InterpretOptions): DecisionProvider {
  const name: PresetName = opts.provider ?? 'jev-openrouter';
  const preset = PRESETS[name];
  return createSystemOneProvider({
    name,
    baseUrl: opts.decisionsUrl ?? endpointOf(preset),
    path: '',
    model: opts.model,
    timeoutMs: opts.timeoutMs ?? DECISIONS_TIMEOUT_MS,
    keyHint: `ENGINE_NL_API_KEY bzw. CLASSIFIER_API_KEY/${preset.apiKeyEnv}`,
    ...(opts.apiKey !== '' ? { apiKey: opts.apiKey } : {}),
    ...(opts.retries !== undefined ? { retries: opts.retries } : {}),
    ...(name === 'jev-openrouter' ? { headers: { 'X-Title': 'base-interior-generator' } } : {}),
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
  });
}

export async function interpretDecisions(prompt: string, engine: Engine, opts: InterpretOptions): Promise<Interpretation> {
  const plan = decisionPlanOf(engine);
  const res = await decisionProviderOf(opts).decide(decisionsRequest(prompt, plan), opts.signal !== undefined ? { signal: opts.signal } : {});
  const li = classifyLocal(prompt, engine.vocabulary);
  const local = li.request.input as Record<string, unknown>;
  const decided = combineLocal(
    decideIntent(plan, DECISIONS_OP, res.answers, opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE, local), local, li.confidence >= 1, opts.combine ?? DEFAULT_COMBINE,
  );
  return { request: decided.request, model: res.model, ...(res.usage !== undefined ? { usage: res.usage } : {}), confidence: decided.confidence };
}
