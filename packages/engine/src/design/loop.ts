/**
 * F-JEV-iterativ, Schleife (`plan/spikes/F_jev_iterativ.md`): Planer (zwei Runden) → Umsetzung → Kritiker → Änderung →
 * neu umsetzen, bis die Punktzahl nicht mehr steigt, `maxRounds` erreicht ist oder das Budget endet; optional mehrere
 * Kandidaten (Seeds), aus denen das Modell per `choice` den besten wählt.
 *
 * Als Generator geschrieben: Jede Frage-Runde wird als {@link Ask} (Fragen + lokale Antworten) nach außen gegeben, der
 * Treiber antwortet mit {@link Reply}. `runDesignLocal` antwortet synchron lokal (reine Operation `design_iterate`),
 * `runDesign` fragt einen `DecisionProvider` (JEV) und fällt je Runde auf die lokalen Antworten zurück (Budget,
 * Zeitlimit, Fehler). So gibt es genau eine Schleife für beide Wege. Rein bis auf den Port.
 */
import type { DecisionProvider } from '@mcda/classify';
import type { Engine } from '../engine.js';
import { DEFAULT_MIN_CONFIDENCE, combineLocal, decideIntent, type DecisionAnswer, type DecisionPlan as QuestionPlan, type DecisionQuestion } from '../intent/decisions.js';
import { classifyLocal } from '../intent/local.js';
import type { Json, OperationResult } from '../operation.js';
import { criticRound, fixesOf, readVerdict, requirementsOf, type Requirement, type Verdict } from './critic.js';
import {
  LEVER_QUESTION, LEVER_TEXT, measureOf, measuredRounds, type CriticMode, type LeverAsk, type LeverId, type MeasurePlan, type MeasuredRound, type QualitySnapshot,
} from './measuredCritic.js';
import { localDesign, readRound1, readRound2, round1, round2, type DesignPlan } from './plan.js';
import { realize, type Realized, type WorldSummary } from './realize.js';

/** Grenzen der Schleife. */
export interface DesignBudget {
  /** Höchstzahl Kritiker-Runden (je Runde eine Generierung). Standard {@link DEFAULT_MAX_ROUNDS}. */
  readonly maxRounds?: number;
  /** Anzahl Kandidaten (Seeds) der besten Fassung, aus denen gewählt wird (1 = keine Wahl). */
  readonly candidates?: number;
  /** Höchstzahl Modellaufrufe (danach lokal weiter). Standard {@link DEFAULT_MAX_CALLS}. */
  readonly maxCalls?: number;
  /** Zeitlimit der ganzen Schleife in ms (danach lokal zu Ende). Standard {@link DEFAULT_DESIGN_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Mindest-Konfidenz je Antwort. */
  readonly minConfidence?: number;
}

export const DEFAULT_MAX_ROUNDS = 3;
export const DEFAULT_MAX_CALLS = 8;
export const DEFAULT_DESIGN_TIMEOUT_MS = 90_000;
/** Mindestgewinn der Punktzahl, damit eine Runde als Verbesserung zählt. */
export const MIN_GAIN = 0.01;
/** Punktzahl, ab der die Schleife vorzeitig endet. */
export const GOOD_ENOUGH = 0.95;

export type DesignPhase = 'plan' | 'critic' | 'pick' | 'measure';

/** Eine Frage-Runde an das Modell (oder lokal). */
export interface Ask {
  readonly phase: DesignPhase;
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
  readonly local: Readonly<Record<string, DecisionAnswer>>;
}

/** Antwort des Treibers. `source: 'local'` = lokale Antworten (kein Modell, Budget/Zeit aus oder Fehler). */
export interface Reply {
  readonly answers: Readonly<Record<string, DecisionAnswer | undefined>>;
  readonly source: 'model' | 'local';
  readonly model?: string;
  readonly cost?: number;
  readonly ms?: number;
  readonly error?: string;
  /** Budget noch übrig? `false` → die Schleife beendet sich nach dieser Runde. */
  readonly budgetLeft: boolean;
}

/** Protokoll je Runde (Transparenz, Verlauf im Editor). */
export interface DesignRound {
  readonly n: number;
  readonly phase: DesignPhase;
  readonly source: 'model' | 'local';
  readonly questions: number;
  /** Antworten kompakt: Schlüssel → Wahl, P(ja) bzw. Stufe. */
  readonly answers: Readonly<Record<string, string | number>>;
  readonly changes: readonly string[];
  readonly score?: number;
  readonly requirements?: Readonly<Record<string, number>>;
  readonly ms?: number;
  readonly cost?: number;
  readonly error?: string;
  /** MX-K: gemessene Runde (nur mit `critic: 'measured'`). */
  readonly measured?: MeasuredRound;
}

export interface DesignResult {
  readonly prompt: string;
  readonly plan: DesignPlan;
  readonly requirements: readonly Requirement[];
  readonly best: Realized;
  readonly score: number;
  readonly rounds: readonly DesignRound[];
  readonly calls: { readonly model: number; readonly local: number };
  readonly cost: number;
  /** MX-K: Prüfwerte vor und nach den gemessenen Runden (nur mit `critic: 'measured'`). */
  readonly quality?: { readonly before: QualitySnapshot; readonly after: QualitySnapshot };
}

export interface DesignInput {
  readonly prompt: string;
  readonly seed?: number;
  readonly format?: string;
  readonly targetVersion?: string;
  /** MX-K: `measured` = nach dem Anforderungs-Kritiker gemessene Runden mit Stellgröße; fehlt = wie bisher. */
  readonly critic?: CriticMode;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
function compact(a: Readonly<Record<string, DecisionAnswer | undefined>>, keys: readonly string[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const k of keys) {
    const x = a[k];
    if (x === undefined) continue;
    out[k] = x.type === 'noul' ? round3(x.noul) : x.type === 'score' ? round3(x.score) : `${x.choice} (${round3(x.confidence ?? 0)})`;
  }
  return out;
}

/** Zustand für das Modell: Bitte plus Kontext; Welt-Zusammenfassungen für den Kritiker. */
const stateOf = (prompt: string, extra: Record<string, unknown>): Record<string, unknown> => ({
  bitte: prompt,
  kontext: 'Bitte eines Nutzers an einen Generator für eingerichtete Minecraft-Gebäude und -Anlagen',
  ...extra,
});

/**
 * Die Schleife. `questionPlan` = Einmal-Fragen aus dem Schema von `building_generate` (`decisionPlanOf`); ihre
 * Antworten bilden – wie beim Einmal-Weg – die Felder des Hauptgebäudes.
 */
export function* designLoop(
  engine: Engine, questionPlan: QuestionPlan, input: DesignInput, budget: DesignBudget = {}, measure?: MeasurePlan,
): Generator<Ask, DesignResult, Reply> {
  const vocab = engine.vocabulary;
  const min = budget.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const maxRounds = Math.max(1, budget.maxRounds ?? DEFAULT_MAX_ROUNDS);
  const rounds: DesignRound[] = [];
  let calls = { model: 0, local: 0 };
  let cost = 0;
  let budgetLeft = true;
  const note = (phase: DesignPhase, ask: Ask, r: Reply, changes: readonly string[], extra: Partial<DesignRound> = {}): void => {
    calls = r.source === 'model' ? { ...calls, model: calls.model + 1 } : { ...calls, local: calls.local + 1 };
    cost += r.cost ?? 0;
    budgetLeft = r.budgetLeft;
    rounds.push({
      n: rounds.length + 1, phase, source: r.source, questions: Object.keys(ask.questions).length,
      answers: compact(r.answers, Object.keys(ask.questions).filter((k) => k.startsWith('design.') || k.startsWith('crit.') || k.startsWith('req.') || k === 'buildingTypeId')),
      changes, ...(r.ms !== undefined ? { ms: Math.round(r.ms) } : {}), ...(r.cost !== undefined ? { cost: r.cost } : {}),
      ...(r.error !== undefined ? { error: r.error.slice(0, 200) } : {}), ...extra,
    });
  };

  // Runde 1: Einmal-Fragen + Zerlegung
  const local = localDesign(input.prompt, vocab);
  const li = classifyLocal(input.prompt, vocab);
  const localInput = li.request.input as Record<string, unknown>;
  const r1q = round1(vocab, local);
  const ask1: Ask = { phase: 'plan', state: stateOf(input.prompt, {}), questions: { ...questionPlan.questions, ...r1q.questions }, local: r1q.local };
  const reply1 = yield ask1;
  let base: Record<string, unknown>;
  let asked: string[];
  if (reply1.source === 'model') {
    const decided = combineLocal(decideIntent(questionPlan, 'building_generate', reply1.answers, min, localInput), localInput, li.confidence >= 1, 'local-first');
    base = { ...(decided.request.input as Record<string, unknown>) };
    asked = Object.keys(decided.confidence).concat(decided.fromLocal.filter((p) => p !== 'buildingTypeId' || li.confidence >= 1));
    if (engine.validate({ op: 'building_generate', input: base }).length > 0) { base = { ...localInput }; asked = Object.keys(localInput); }
  } else {
    base = { ...localInput };
    asked = Object.keys(localInput).filter((k) => k !== 'buildingTypeId' || li.confidence >= 1);
  }
  asked = [...new Set(asked.map((p) => p.split('.')[0]!))];
  if (input.seed !== undefined) base['seed'] = input.seed;
  if (input.format !== undefined) base['format'] = input.format;
  if (input.targetVersion !== undefined) base['targetVersion'] = input.targetVersion;
  const r1 = readRound1(reply1.answers, local, min);
  note('plan', ask1, reply1, [
    `Hauptgebäude ${r1.mainType ?? String(base['buildingTypeId'])}`,
    `Teile: ${JSON.stringify({ ...r1.parts, shift: undefined })}`,
    ...(r1.wantsRooms ? ['weitere Nutzungen genannt'] : []),
  ]);

  // Runde 2: Details je Teil (state enthält Runde 1)
  const r2q = round2(vocab, r1, local);
  let plan: DesignPlan;
  const typeName = vocab.buildingTypes.find((t) => t.id === (r1.mainType ?? base['buildingTypeId']))?.name;
  const ask2: Ask = {
    phase: 'plan',
    state: stateOf(input.prompt, { erkannt: { hauptgebaeude: typeName ?? null, teile: r1.parts, weitereNutzungen: r1.wantsRooms } }),
    questions: r2q.questions, local: r2q.local,
  };
  if (budgetLeft) {
    const reply2 = yield ask2;
    plan = readRound2(base, asked, r1, reply2.answers, local, vocab, min);
    note('plan', ask2, reply2, [
      ...(plan.rooms.length > 0 ? [`Nutzungen: ${plan.rooms.join(', ')}`] : []),
      ...(plan.base['mood'] !== undefined ? [`Stimmung: ${JSON.stringify(plan.base['mood'])}`] : []),
      ...(plan.parts.wall !== undefined ? [`Mauer: ${plan.parts.wall}`] : []),
      ...(plan.parts.towerTop !== undefined ? [`Turm: ${plan.parts.towerTop}`] : []),
    ]);
  } else plan = readRound2(base, asked, r1, r2q.local, local, vocab, min);

  // Kritiker-Schleife
  let best: { plan: DesignPlan; world: Realized; verdict: Verdict; reqs: Requirement[] } | undefined;
  let stale = 0;
  for (let round = 1; round <= maxRounds; round++) {
    const reqs = requirementsOf(plan, vocab);
    let world: Realized;
    try {
      world = realize(engine, plan, { ...(input.format !== undefined ? { format: input.format } : {}) });
    } catch (err) {
      // Änderung abgelehnt (z. B. Volumen zu groß): beim besten Stand bleiben
      rounds.push({ n: rounds.length + 1, phase: 'critic', source: 'local', questions: 0, answers: {}, changes: [`Umsetzung abgelehnt: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`] });
      if (best === undefined) throw err;
      break;
    }
    const cq = criticRound(reqs, world, vocab);
    const ask: Ask = { phase: 'critic', state: stateOf(input.prompt, { welt: world.summary }), questions: cq.questions, local: cq.local };
    const reply = budgetLeft ? yield ask : { answers: cq.local, source: 'local' as const, budgetLeft: false };
    const verdict = readVerdict(reqs, reply.answers, min);
    const improved = best === undefined || verdict.score > best.verdict.score + MIN_GAIN;
    if (improved) { best = { plan, world, verdict, reqs }; stale = 0; } else stale++;
    const last = round === maxRounds || verdict.score >= GOOD_ENOUGH || stale >= 1 || !reply.budgetLeft;
    const next = last ? undefined : fixesOf(best!.plan, best!.reqs, best!.verdict, best!.world, vocab, round);
    note('critic', ask, reply, next?.changes ?? [improved ? 'fertig' : 'keine Verbesserung – bester Stand bleibt'], {
      score: verdict.score, requirements: Object.fromEntries(Object.entries(verdict.requirements).map(([k, x]) => [k, round3(x)])),
    });
    if (next === undefined || next.changes.length === 0) break;
    plan = next.plan;
  }

  // MX-K: gemessene Runden (ein verletzter Prüfwert je Runde, Stellgröße, Rücksprung auf den besten Stand)
  let quality: DesignResult['quality'];
  if (input.critic === 'measured' && best !== undefined) {
    const port = measure ?? measureOf(engine);
    if (port === undefined) throw new Error('critic "measured": die Engine kennt keinen Kontext zum Messen');
    const cp = best;
    const choose = function* (a: LeverAsk): Generator<Ask, LeverId | undefined, Reply> {
      if (!budgetLeft) return undefined;
      const ask: Ask = {
        phase: 'measure',
        state: stateOf(input.prompt, { welt: cp.world.summary, pruefwert: { id: a.target.id, wert: a.target.value, bereich: [...a.target.range] } }),
        questions: {
          [LEVER_QUESTION]: {
            type: 'choice',
            instructions: `Der Prüfwert „${a.target.id}“ des Hauptgebäudes liegt mit ${a.target.value} außerhalb ${a.target.range[0]}–${a.target.range[1]}. Welche Änderung behebt das am ehesten, ohne die Bitte zu verfehlen?`,
            criteria: Object.fromEntries(a.options.map((o) => [o, LEVER_TEXT[o]])),
          },
        },
        local: { [LEVER_QUESTION]: a.local },
      };
      const reply = yield ask;
      const x = reply.answers[LEVER_QUESTION];
      const chosen = x?.type === 'choice' && (x.confidence ?? 0) >= min && (a.options as readonly string[]).includes(x.choice) ? x.choice as LeverId : undefined;
      note('measure', ask, reply, [`Stellgröße für ${a.target.id}: ${LEVER_TEXT[chosen ?? a.options[0]!]}`]);
      return chosen;
    };
    const log = (r: MeasuredRound): void => {
      const what = r.target === undefined ? r.reason
        : `${r.target.id} ${r.target.value} außerhalb ${r.target.range[0]}–${r.target.range[1]} → ${LEVER_TEXT[r.lever!]}: ${r.reason} (Gesamtwert ${r.before}${r.after !== undefined ? ` → ${r.after}` : ''})`;
      rounds.push({ n: rounds.length + 1, phase: 'measure', source: 'local', questions: 0, answers: {}, changes: [what], score: cp.verdict.score, measured: r });
    };
    const out = yield* measuredRounds(engine, cp, port, maxRounds, input.format, choose, log);
    best = { ...cp, plan: out.best.plan, world: out.best.world };
    quality = { before: out.before, after: out.after };
  }

  // Kandidaten: weitere Seeds der besten Fassung, das Modell wählt
  const n = Math.max(1, Math.min(4, budget.candidates ?? 1));
  if (n > 1 && best !== undefined) {
    const seed0 = Number(best.plan.base['seed'] ?? 1);
    const worlds: Array<{ plan: DesignPlan; world: Realized }> = [{ plan: best.plan, world: best.world }];
    for (let k = 1; k < n; k++) {
      const p: DesignPlan = { ...best.plan, base: { ...best.plan.base, seed: (seed0 + k * 7919) % 2 ** 31 } };
      try { worlds.push({ plan: p, world: realize(engine, p, input.format !== undefined ? { format: input.format } : {}) }); } catch { /* Kandidat entfällt */ }
    }
    if (worlds.length > 1) {
      const ids = worlds.map((_, i) => String.fromCharCode(65 + i));
      const localScores = worlds.map((w) => readVerdict(best!.reqs, criticRound(best!.reqs, w.world, vocab).local, min).score);
      const top = localScores.indexOf(Math.max(...localScores));
      const ask: Ask = {
        phase: 'pick',
        state: stateOf(input.prompt, { kandidaten: Object.fromEntries(ids.map((id, i) => [id, worlds[i]!.world.summary as unknown as Json])) }),
        questions: { 'crit.pick': { type: 'choice', instructions: 'Welche der Kandidaten-Welten erfüllt die Bitte am besten?', criteria: Object.fromEntries(ids.map((id) => [id, `Kandidat ${id}`])) } },
        local: { 'crit.pick': { type: 'choice', choice: ids[top]!, confidence: 0.9 } },
      };
      const reply = budgetLeft ? yield ask : { answers: ask.local, source: 'local' as const, budgetLeft: false };
      const a = reply.answers['crit.pick'];
      const i = a?.type === 'choice' ? ids.indexOf(a.choice) : -1;
      const chosen = worlds[i >= 0 ? i : top]!;
      note('pick', ask, reply, [`Kandidat ${ids[i >= 0 ? i : top]} (Seed ${String(chosen.plan.base['seed'])})`]);
      if (chosen.world !== best.world) best = { ...best, plan: chosen.plan, world: chosen.world };
    }
  }
  return {
    prompt: input.prompt, plan: best!.plan, requirements: best!.reqs, best: best!.world, score: best!.verdict.score, rounds, calls, cost: round6(cost),
    ...(quality !== undefined ? { quality } : {}),
  };
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Treiber ohne Modell: jede Runde lokal (reine Operation, Rückfall). */
export function runDesignLocal(gen: Generator<Ask, DesignResult, Reply>): DesignResult {
  let step = gen.next();
  while (!step.done) step = gen.next({ answers: step.value.local, source: 'local', budgetLeft: true });
  return step.value;
}

/**
 * Treiber mit Entscheidungsmodell: fragt je Runde den Anbieter; fehlende Antworten ergänzt die lokale Antwort. Nach
 * `maxCalls` Aufrufen, nach dem Zeitlimit oder nach einem Fehler antworten die restlichen Runden lokal.
 */
export async function runDesign(
  gen: Generator<Ask, DesignResult, Reply>, provider: DecisionProvider, budget: DesignBudget = {}, signal?: AbortSignal, now: () => number = () => performance.now(),
): Promise<DesignResult> {
  const maxCalls = budget.maxCalls ?? DEFAULT_MAX_CALLS;
  const deadline = now() + (budget.timeoutMs ?? DEFAULT_DESIGN_TIMEOUT_MS);
  let calls = 0;
  let failed: string | undefined;
  let step = gen.next();
  while (!step.done) {
    const ask = step.value;
    let reply: Reply;
    if (failed !== undefined || calls >= maxCalls || now() >= deadline || signal?.aborted === true) {
      reply = { answers: ask.local, source: 'local', budgetLeft: false, ...(failed !== undefined ? { error: failed } : {}) };
    } else {
      const t = now();
      try {
        const res = await provider.decide({ state: ask.state, questions: ask.questions }, signal !== undefined ? { signal } : {});
        calls++;
        reply = {
          answers: { ...ask.local, ...res.answers } as Record<string, DecisionAnswer>, source: 'model', model: res.model, ms: now() - t,
          ...(res.usage?.cost !== undefined ? { cost: res.usage.cost } : {}),
          budgetLeft: calls < maxCalls && now() < deadline,
        };
      } catch (err) {
        failed = err instanceof Error ? err.message : String(err);
        reply = { answers: ask.local, source: 'local', ms: now() - t, error: failed, budgetLeft: true };
      }
    }
    step = gen.next(reply);
  }
  return step.value;
}

/** Antwort der Operation `design_iterate` (JSON) samt Export-Artefakt der besten Welt. */
export function designResult(r: DesignResult, model: string, fallback?: string): OperationResult {
  const data = r.best.result.data as Record<string, Json>;
  return {
    data: {
      prompt: r.prompt,
      model,
      ...(fallback !== undefined ? { fallback } : {}),
      score: r.score,
      request: { op: 'building_generate', input: r.plan.base as Json },
      plan: { parts: r.plan.parts as unknown as Json, rooms: [...r.plan.rooms], asked: [...r.plan.asked] },
      requirements: r.requirements.map((q) => ({ id: q.id, text: q.text })),
      recipe: r.best.recipe as unknown as Json,
      summary: r.best.summary as unknown as Json,
      notes: [...r.best.notes],
      rounds: r.rounds as unknown as Json,
      calls: r.calls,
      cost: r.cost,
      world: data,
      ...(r.quality !== undefined ? { quality: r.quality as unknown as Json } : {}),
    },
    ...(r.best.result.artifacts !== undefined ? { artifacts: r.best.result.artifacts } : {}),
  };
}

export type { WorldSummary };
