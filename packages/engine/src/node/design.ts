/**
 * `design_iterate` mit Entscheidungsmodell (F-JEV-iterativ, `plan/spikes/F_jev_iterativ.md`). **Schalter
 * `ENGINE_NL_ITERATE`, Standard aus**: nur mit Schalter und konfiguriertem System-One-Modell (JEV über `@mcda/classify`)
 * sind Planer und Kritiker das Modell; sonst ist das Ergebnis genau `engine.execute({ op: 'design_iterate', … })`
 * (lokale Antworten). Fehler, Budget (`ENGINE_NL_ITERATE_MAX_CALLS`) und Zeitlimit (`ENGINE_NL_ITERATE_TIMEOUT_MS`)
 * lassen die restlichen Runden lokal laufen; `fallback` nennt den Grund.
 */
import type { Engine, ExecuteResult } from '../engine.js';
import { DEFAULT_DESIGN_TIMEOUT_MS, DEFAULT_MAX_CALLS, designLoop, designResult, runDesign, type DesignBudget } from '../design/loop.js';
import { DESIGN_ITERATE, designIterateInput } from '../operations/design.js';
import { decisionPlanOf, decisionProviderOf } from './decisions.js';
import type { InterpretOptions } from './openrouter.js';
import { usesDecisionModel } from './roomtype.js';

export { DESIGN_ITERATE };

/** Standard des Schalters: aus (bis die Messung zeigt, dass der iterative Weg besser ist). */
export const ITERATE_DEFAULT = false;

/** Schalter und Budget aus der Umgebung (`ENGINE_NL_ITERATE=1`, `_MAX_CALLS`, `_TIMEOUT_MS`). */
export interface IterateOptions {
  readonly enabled: boolean;
  readonly maxCalls: number;
  readonly timeoutMs: number;
}

export function iterateOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): IterateOptions {
  const on = env['ENGINE_NL_ITERATE'];
  const num = (k: string, d: number): number => {
    const v = Number(env[k]);
    return env[k] !== undefined && env[k] !== '' && Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    enabled: on === undefined || on === '' ? ITERATE_DEFAULT : on === '1' || on === 'true' || on === 'on',
    maxCalls: num('ENGINE_NL_ITERATE_MAX_CALLS', DEFAULT_MAX_CALLS),
    timeoutMs: num('ENGINE_NL_ITERATE_TIMEOUT_MS', DEFAULT_DESIGN_TIMEOUT_MS),
  };
}

/** Fragt `design_iterate` das Modell? (Schalter an und System-One-Modell konfiguriert.) */
export const iteratesWithModel = (opts: InterpretOptions | undefined): opts is InterpretOptions & { iterate: IterateOptions } =>
  usesDecisionModel(opts) && opts.iterate?.enabled === true;

/**
 * `design_iterate` ausführen: mit Schalter und Modell über das Modell (je Runde lokaler Rückfall), sonst die reine
 * Operation. Ungültige Eingabe → wie `execute`.
 */
export async function executeDesignIterate(engine: Engine, input: unknown, opts?: InterpretOptions): Promise<ExecuteResult> {
  const request = { op: DESIGN_ITERATE, input } as const;
  if (!iteratesWithModel(opts) || engine.validate(request).length > 0) return engine.execute(request);
  const i = designIterateInput().parse(input);
  const budget: DesignBudget = { maxRounds: i.maxRounds, candidates: i.candidates, maxCalls: opts.iterate.maxCalls, timeoutMs: opts.iterate.timeoutMs };
  const gen = designLoop(engine, decisionPlanOf(engine), {
    prompt: i.prompt, seed: i.seed, format: i.format, ...(i.targetVersion !== undefined ? { targetVersion: i.targetVersion } : {}),
    ...(i.critic !== undefined ? { critic: i.critic } : {}),
  }, budget);
  try {
    const r = await runDesign(gen, decisionProviderOf(opts), budget, opts.signal);
    const errors = r.rounds.map((x) => x.error).filter((e): e is string => e !== undefined);
    const model = r.rounds.find((x) => x.source === 'model') !== undefined ? opts.model : 'local';
    if (errors.length > 0 && opts.fallback === false) return { ok: false, op: DESIGN_ITERATE, errors: [errors[0]!] };
    return { ok: true, op: DESIGN_ITERATE, ...designResult(r, model, errors[0]) };
  } catch (err) {
    return { ok: false, op: DESIGN_ITERATE, errors: [err instanceof Error ? err.message : String(err)] };
  }
}

