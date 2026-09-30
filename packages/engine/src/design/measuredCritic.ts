/**
 * MX-K (DR0 Nr. 13, DR2 §4 Nr. 2; Bericht `plan/spikes/MX_kritiker.md`): Kritiker mit Stellgröße für `design_iterate`
 * (`critic: 'measured'`, Standard aus). Statt eines Text-Urteils liest er die berechneten Prüfwerte des Planers
 * (`QualityValue`, `@mcda/archetype` `check.ts`), nimmt je Runde genau EINEN verletzten Wert nach fester Rangfolge
 * (Procedura: ein diagnostizierter Fehler je Runde), bildet ihn über eine Zuordnungstabelle auf eine vorhandene Stellgröße
 * von `building_generate` ab (Dachneigung, Etagen, Silhouette, Variante), misst neu und springt auf den letzten guten
 * Stand zurück, wenn der Gesamtwert nicht steigt oder eine harte Regel bricht (SceneSmith: Checkpoint-Rücksprung).
 *
 * Rein bis auf den Mess-Port {@link MeasurePlan}: ohne Modell rein regelbasiert; ein Entscheidungsmodell (über den
 * Treiber der Schleife, also `@mcda/classify`) wählt nur, wenn für den Wert mehrere Stellgrößen passen.
 */
import { projectFromBuildingType } from '@mcda/pipeline';
import type { Engine } from '../engine.js';
import { engineContextOf } from '../engine.js';
import type { DecisionAnswer } from '../intent/decisions.js';
import type { EngineContext } from '../operation.js';
import { buildingParams, buildingTypeSchema } from '../operations/building.js';
import { checkLocal, type Requirement, type Verdict } from './critic.js';
import type { DesignPlan } from './plan.js';
import { TYPE_KEYS, realize, type Realized } from './realize.js';

/** Kritiker-Art von `design_iterate`: `requirements` = bisheriger Anforderungs-Kritiker allein, `measured` = danach gemessene Runden. */
export const CRITIC_MODES = ['requirements', 'measured'] as const;
export type CriticMode = (typeof CRITIC_MODES)[number];

/** Ein Prüfwert (tolerant: auch Werte, die der Planer künftig ergänzt – `id` ist offen). */
export interface MeasuredValue {
  readonly id: string;
  readonly value: number;
  readonly range: readonly [number, number];
  readonly ok: boolean;
}

/** Messung eines Plans ohne Welt: Prüfwerte, harte Planprobleme und die Stellgrößen-Ausgangslage. */
export interface Measurement {
  readonly values: readonly MeasuredValue[];
  /** Harte Probleme des Plans (Erreichbarkeit, Treppen, Flächen …); mehr als vorher = Rücksprung. */
  readonly hard: readonly string[];
  /** Etagen ab Erdgeschoss des geplanten Hauptbaus. */
  readonly floors: number;
  /** Wirksame Dach-Details (Bautyp, überschrieben durch `shell.roofDetail` der Anfrage), Basis der Neigungs-Stellgröße. */
  readonly roofDetail?: Readonly<Record<string, unknown>>;
}

/** Mess-Port: Felder des Hauptgebäudes (Eingabe von `building_generate`) → Messung. Wirft bei ungültiger Eingabe. */
export type MeasurePlan = (base: Readonly<Record<string, unknown>>) => Measurement;

/** Messung über den Anwendungsdienst (derselbe Plan wie `project_create` in `realize`: gleiche Felder, gleicher Seed). */
export function planMeasure(ctx: EngineContext, engine: Engine): MeasurePlan {
  const schema = buildingTypeSchema(engine.vocabulary);
  return (base) => {
    const fields = schema.parse(Object.fromEntries(TYPE_KEYS.filter((k) => base[k] !== undefined).map((k) => [k, base[k]])));
    const def = ctx.buildingTypes.get(fields.buildingTypeId);
    const themeId = typeof base['themeId'] === 'string' ? { themeId: base['themeId'] } : {};
    const { plan } = projectFromBuildingType(def, { ...buildingParams(fields), ...themeId, surroundings: false }, Number(base['seed'] ?? 1), ctx);
    const shell = base['shell'] as { roofDetail?: Record<string, unknown> } | undefined;
    const roofDetail = shell?.roofDetail ?? (def.shell?.roofDetail as Record<string, unknown> | undefined);
    return {
      values: plan.quality.map((q) => ({ id: q.id, value: q.value, range: q.range, ok: q.ok })),
      hard: [...plan.warnings],
      floors: plan.floors.filter((f) => f.index >= 0).length,
      ...(roofDetail !== undefined ? { roofDetail } : {}),
    };
  };
}

/** Mess-Port einer Engine (aus ihrem Kontext) oder `undefined`, wenn die Engine keinen kennt. */
export function measureOf(engine: Engine): MeasurePlan | undefined {
  const ctx = engineContextOf(engine);
  return ctx === undefined ? undefined : planMeasure(ctx, engine);
}

// ------------------------------------------------------------------------------------------ Gesamtwert, Rangfolge

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/** Nähe eines Werts zu seinem Bereich: 1 im Bereich, sonst linear fallend mit dem Abstand (Maß: Bereichsbreite). */
export function closeness(v: MeasuredValue): number {
  const [lo, hi] = v.range;
  if (v.value >= lo && v.value <= hi) return 1;
  const span = Math.max(hi - lo, 0.25 * Math.max(Math.abs(lo), Math.abs(hi)), 0.01);
  const d = v.value < lo ? lo - v.value : v.value - hi;
  return Math.max(0, 1 - d / span);
}

/** Gesamtwert: Mittel der Nähe aller Prüfwerte (1 = alle im Bereich; ohne Prüfwerte 1). */
export function qualityScore(values: readonly MeasuredValue[]): number {
  return values.length === 0 ? 1 : r3(values.reduce((s, v) => s + closeness(v), 0) / values.length);
}

/**
 * Feste Rangfolge der Werte (zuerst, was die Silhouette am stärksten prägt und eine gezielte Stellgröße hat; Seitenverhältnis
 * und Frontbreite zuletzt, weil nur eine neue Variante hilft). Unbekannte Werte danach alphabetisch.
 */
export const VALUE_RANK: readonly string[] = ['floors', 'heightToWidth', 'roofToEave', 'focusOverMain', 'partOverMain', 'massCount', 'ratio', 'width'];

const rankOf = (id: string): number => {
  const i = VALUE_RANK.indexOf(id);
  return i >= 0 ? i : VALUE_RANK.length;
};

/** Verletzte Werte in Rangfolge. */
export function violations(values: readonly MeasuredValue[]): MeasuredValue[] {
  return values.filter((v) => !v.ok).sort((a, b) => rankOf(a.id) - rankOf(b.id) || a.id.localeCompare(b.id));
}

// ------------------------------------------------------------------------------------------ Stellgrößen

export type Direction = 'low' | 'high';
export type LeverId = 'pitchUp' | 'pitchDown' | 'floorsUp' | 'floorsDown' | 'silhouetteVaried' | 'silhouetteOff' | 'reroll';

/** Höchstzahl neuer Varianten (`rerollCount`), die der Kritiker versucht. */
export const MAX_REROLLS = 3;
const PITCHES = ['low', 'normal', 'steep'] as const;

/**
 * Zuordnungstabelle: verletzter Wert und Richtung → Stellgrößen in Vorrang-Reihenfolge. `low` = Wert unter dem Bereich.
 * Fokus/Teil über Hauptbau zu niedrig: das Hauptdach flacher (der Bergfried hat keine eigene Stellgröße in der API).
 */
export const LEVERS: Readonly<Record<string, Readonly<Record<Direction, readonly LeverId[]>>>> = {
  floors: { low: ['floorsUp'], high: ['floorsDown'] },
  heightToWidth: { low: ['floorsUp', 'pitchUp'], high: ['pitchDown', 'floorsDown'] },
  roofToEave: { low: ['pitchUp'], high: ['pitchDown'] },
  focusOverMain: { low: ['pitchDown', 'floorsDown'], high: ['pitchUp'] },
  partOverMain: { low: ['pitchDown', 'floorsDown'], high: ['pitchUp'] },
  massCount: { low: ['silhouetteVaried', 'reroll'], high: ['silhouetteOff', 'reroll'] },
  ratio: { low: ['reroll'], high: ['reroll'] },
  width: { low: ['reroll'], high: ['reroll'] },
};
const FALLBACK: Readonly<Record<Direction, readonly LeverId[]>> = { low: ['reroll'], high: ['reroll'] };

export const LEVER_TEXT: Readonly<Record<LeverId, string>> = {
  pitchUp: 'Dachneigung steiler',
  pitchDown: 'Dachneigung flacher',
  floorsUp: 'eine Etage mehr',
  floorsDown: 'eine Etage weniger',
  silhouetteVaried: 'Silhouette „varied“ (Anbau mit eigener Dachhöhe)',
  silhouetteOff: 'Silhouette aus',
  reroll: 'neue Grundriss-Variante (rerollCount)',
};

/**
 * Stellgröße anwenden: neue Felder des Hauptgebäudes oder `undefined`, wenn sie nicht greift (Grenze erreicht, Feld von
 * der Bitte genannt, schon gesetzt). Felder, die die Bitte nennt (`asked`), fasst der Kritiker nie an.
 */
export function applyLever(lever: LeverId, base: Readonly<Record<string, unknown>>, m: Measurement, asked: ReadonlySet<string>): Record<string, unknown> | undefined {
  const pitch = (dir: 1 | -1): Record<string, unknown> | undefined => {
    if (asked.has('shell') || m.roofDetail === undefined) return undefined;
    const cur = PITCHES.indexOf((m.roofDetail['pitch'] as (typeof PITCHES)[number] | undefined) ?? 'normal');
    const next = PITCHES[cur + dir];
    if (next === undefined) return undefined;
    const shell = (base['shell'] as Record<string, unknown> | undefined) ?? {};
    return { ...base, shell: { ...shell, roofDetail: { ...m.roofDetail, pitch: next } } };
  };
  const floors = (dir: 1 | -1): Record<string, unknown> | undefined => {
    if (asked.has('floors') || asked.has('size')) return undefined;
    const next = m.floors + dir;
    return next < 1 || next > 8 ? undefined : { ...base, floors: next };
  };
  switch (lever) {
    case 'pitchUp': return pitch(1);
    case 'pitchDown': return pitch(-1);
    case 'floorsUp': return floors(1);
    case 'floorsDown': return floors(-1);
    case 'silhouetteVaried':
      return asked.has('silhouette') || base['silhouette'] === 'varied' ? undefined : { ...base, silhouette: 'varied' };
    case 'silhouetteOff': {
      if (asked.has('silhouette') || base['silhouette'] !== 'varied') return undefined;
      const { silhouette: _, ...rest } = base;
      return rest;
    }
    case 'reroll': {
      const n = Number(base['rerollCount'] ?? 0);
      return n >= MAX_REROLLS ? undefined : { ...base, rerollCount: n + 1 };
    }
  }
}

/**
 * Anwendbare Stellgrößen für einen verletzten Wert (ohne schon versuchte). `key` merkt den Versuch: je Wert und Stellgröße,
 * bei neuen Varianten je `rerollCount` (eine verworfene Variante wird nie wiederholt, die nächste darf es sein).
 */
export function leversFor(
  v: MeasuredValue, base: Readonly<Record<string, unknown>>, m: Measurement, asked: ReadonlySet<string>, tried: ReadonlySet<string>,
): Array<{ lever: LeverId; base: Record<string, unknown>; key: string }> {
  const dir: Direction = v.value < v.range[0] ? 'low' : 'high';
  const out: Array<{ lever: LeverId; base: Record<string, unknown>; key: string }> = [];
  for (const lever of (LEVERS[v.id] ?? FALLBACK)[dir]) {
    if (lever === 'reroll') {
      let next = applyLever('reroll', base, m, asked);
      while (next !== undefined && tried.has(`reroll=${String(next['rerollCount'])}`)) next = applyLever('reroll', next, m, asked);
      if (next !== undefined) out.push({ lever, base: next, key: `reroll=${String(next['rerollCount'])}` });
      continue;
    }
    if (tried.has(`${v.id}:${lever}`)) continue;
    const next = applyLever(lever, base, m, asked);
    if (next !== undefined) out.push({ lever, base: next, key: `${v.id}:${lever}` });
  }
  return out;
}

// ------------------------------------------------------------------------------------------ Runde

/** Stand, auf den der Kritiker zurückspringt (Checkpoint). */
export interface Checkpoint {
  readonly plan: DesignPlan;
  readonly world: Realized;
  readonly verdict: Verdict;
  readonly reqs: Requirement[];
}

/** Protokoll einer gemessenen Runde. */
export interface MeasuredRound {
  /** Gewählter verletzter Wert (`id`, Wert, Bereich) – fehlt, wenn keiner mehr verletzt ist bzw. keine Stellgröße passt. */
  readonly target?: { readonly id: string; readonly value: number; readonly range: readonly [number, number] };
  readonly lever?: LeverId;
  /** Zur Wahl stehende Stellgrößen (mehr als eine: Auswahl durch das Modell bzw. lokal die erste). */
  readonly options?: readonly LeverId[];
  readonly accepted: boolean;
  /** Gesamtwert vor und nach der Änderung. */
  readonly before: number;
  readonly after?: number;
  readonly reason: string;
  readonly values: Readonly<Record<string, number>>;
}

/** Messbild für das Ergebnis. */
export interface QualitySnapshot {
  readonly score: number;
  readonly values: readonly MeasuredValue[];
}

/** Lokale Erfüllung der Anforderungen (Mittel, 0–1) – darf durch eine Stellgröße nicht sinken. */
export const requirementMean = (reqs: readonly Requirement[], w: Realized): number =>
  reqs.length === 0 ? 1 : reqs.reduce((s, r) => s + checkLocal(r, w), 0) / reqs.length;

/** Frage an das Modell (nur mit mehreren Stellgrößen) und ihre lokale Antwort. */
export interface LeverAsk {
  readonly target: MeasuredValue;
  readonly options: readonly LeverId[];
  readonly local: DecisionAnswer;
}

export const LEVER_QUESTION = 'fix.lever';

export interface MeasuredOutcome {
  readonly best: Checkpoint;
  readonly rounds: MeasuredRound[];
  readonly before: QualitySnapshot;
  readonly after: QualitySnapshot;
}

/**
 * Gemessene Runden ab `start`: je Runde ein verletzter Wert, eine Stellgröße, neu messen (Plan), bei Gewinn umsetzen
 * (Welt) und prüfen (harte Regeln, Anforderungen); sonst Rücksprung auf den Checkpoint. Endet ohne verletzten Wert,
 * ohne passende Stellgröße oder nach `maxRounds`. `choose` fragt bei mehreren Stellgrößen (Generator-Treiber: Modell
 * oder lokal) und liefert die gewählte oder `undefined` (= die erste).
 */
export function* measuredRounds<Y, R>(
  engine: Engine, start: Checkpoint, measure: MeasurePlan, maxRounds: number, format: string | undefined,
  choose: (ask: LeverAsk) => Generator<Y, LeverId | undefined, R>, log: (round: MeasuredRound) => void = () => undefined,
): Generator<Y, MeasuredOutcome, R> {
  let best = start;
  let m = measure(best.plan.base);
  const before: QualitySnapshot = { score: qualityScore(m.values), values: m.values };
  const tried = new Set<string>();
  const rounds: MeasuredRound[] = [];
  const push = (r: MeasuredRound): void => { rounds.push(r); log(r); };
  const valuesOf = (x: Measurement): Record<string, number> => Object.fromEntries(x.values.map((v) => [v.id, v.value]));
  for (let n = 0; n < maxRounds; n++) {
    const score = qualityScore(m.values);
    const asked = new Set(best.plan.asked);
    const bad = violations(m.values);
    let target: MeasuredValue | undefined;
    let options: ReturnType<typeof leversFor> = [];
    for (const v of bad) {
      options = leversFor(v, best.plan.base, m, asked, tried);
      if (options.length > 0) { target = v; break; }
    }
    if (target === undefined) {
      push({ accepted: false, before: score, values: valuesOf(m), reason: bad.length === 0 ? 'alle Prüfwerte im Bereich' : `keine Stellgröße mehr für ${bad.map((v) => v.id).join(', ')}` });
      break;
    }
    let pick = options[0]!;
    if (options.length > 1) {
      const chosen = yield* choose({ target, options: options.map((o) => o.lever), local: { type: 'choice', choice: pick.lever, confidence: 0.9 } });
      pick = options.find((o) => o.lever === chosen) ?? pick;
    }
    tried.add(pick.key);
    const entry = { target: { id: target.id, value: target.value, range: target.range }, lever: pick.lever, ...(options.length > 1 ? { options: options.map((o) => o.lever) } : {}) };
    let next: Measurement;
    try {
      next = measure(pick.base);
    } catch (err) {
      push({ ...entry, accepted: false, before: score, values: valuesOf(m), reason: `Rücksprung: Stellgröße abgelehnt (${err instanceof Error ? err.message.slice(0, 120) : String(err)})` });
      continue;
    }
    const after = qualityScore(next.values);
    const reject = (reason: string): void => { push({ ...entry, accepted: false, before: score, after, values: valuesOf(next), reason: `Rücksprung: ${reason}` }); };
    if (next.hard.length > m.hard.length) { reject(`harte Regel verletzt (${next.hard[0]})`); continue; }
    if (after <= score) { reject(after < score ? 'Gesamtwert sinkt' : 'kein Gewinn'); continue; }
    const plan: DesignPlan = { ...best.plan, base: pick.base };
    let world: Realized;
    try {
      world = realize(engine, plan, format !== undefined ? { format } : {});
    } catch (err) {
      reject(`Umsetzung abgelehnt (${err instanceof Error ? err.message.slice(0, 120) : String(err)})`);
      continue;
    }
    if (world.summary.verstoesse.length > best.world.summary.verstoesse.length) { reject(`Spielbarkeit (${world.summary.verstoesse[0]})`); continue; }
    if (requirementMean(best.reqs, world) < requirementMean(best.reqs, best.world)) { reject('Anforderung der Bitte verfehlt'); continue; }
    push({ ...entry, accepted: true, before: score, after, values: valuesOf(next), reason: 'übernommen' });
    best = { ...best, plan, world };
    m = next;
  }
  return { best, rounds, before, after: { score: qualityScore(m.values), values: m.values } };
}
