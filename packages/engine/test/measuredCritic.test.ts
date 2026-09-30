/**
 * MX-K (`plan/spikes/MX_kritiker.md`): Kritiker mit Stellgröße. Reine Teile (Gesamtwert, Rangfolge, Zuordnungstabelle),
 * gemessene Runden mit Attrappe des Mess-Ports (Runde behebt, Rücksprung bei sinkendem Gesamtwert und harter Regel,
 * Abbruch ohne Stellgröße bzw. nach maxRounds, Auswahl unter mehreren Stellgrößen über die Frage-Runde) und
 * `design_iterate` mit `critic: 'measured'` gegen den echten Planer. Kein Netz.
 */
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/slack.js';
import {
  applyLever, closeness, designLoop, leversFor, measuredRounds, planMeasure, qualityScore, realize, violations, type Ask, type Reply,
  type Checkpoint, type LeverId, type MeasurePlan, type MeasuredRound, type MeasuredValue, type Measurement,
} from '../src/index.js';
import { NO_PARTS } from '../src/design/plan.js';
import { decisionPlan } from '../src/intent/decisions.js';
import { ctx, engine } from './fixture.js';

const val = (id: string, value: number, range: [number, number]): MeasuredValue => ({ id, value, range, ok: value >= range[0] && value <= range[1] });
const M = (values: MeasuredValue[], extra: Partial<Measurement> = {}): Measurement => ({ values, hard: [], floors: 1, roofDetail: { pitch: 'normal', trim: true }, ...extra });
const pitchOf = (base: Readonly<Record<string, unknown>>): string =>
  String(((base['shell'] as { roofDetail?: { pitch?: string } } | undefined)?.roofDetail?.pitch) ?? 'normal');

/** Treiber: beantwortet jede Frage-Runde mit `answer` (Standard: keine Antwort = erste Stellgröße). */
function drive<T>(gen: Generator<unknown, T, unknown>, answer: (ask: unknown) => unknown = () => undefined): T {
  let step = gen.next();
  while (!step.done) step = gen.next(answer(step.value));
  return step.value;
}
const localChoose = function* (): Generator<unknown, LeverId | undefined, unknown> { return undefined; };

let startCache: Checkpoint | undefined;
/** Checkpoint: kleiner Wachturm, ohne Anforderungen (Welt einmal umgesetzt). */
function start(): Checkpoint {
  startCache ??= (() => {
    const plan = { base: { buildingTypeId: 'watchtower', seed: 1 }, parts: NO_PARTS, rooms: [], asked: [] };
    return { plan, world: realize(engine, plan), verdict: { score: 1, requirements: {}, overall: 1, moodDelta: {} }, reqs: [] };
  })();
  return startCache;
}

describe('Gesamtwert und Rangfolge', () => {
  it('Nähe 1 im Bereich, fällt mit dem Abstand; Gesamtwert ist das Mittel', () => {
    expect(closeness(val('ratio', 1.5, [1.2, 2]))).toBe(1);
    expect(closeness(val('ratio', 1.04, [1.2, 2]))).toBeCloseTo(0.8, 5);
    expect(qualityScore([val('ratio', 1.5, [1.2, 2]), val('heightToWidth', 1.18, [0.5, 0.9])])).toBeCloseTo(0.65, 3);
    expect(qualityScore([])).toBe(1);
  });
  it('feste Rangfolge; unbekannte (neue) Werte zuletzt', () => {
    const v = violations([val('ratio', 1, [1.2, 2]), val('articulation', 0.1, [0.4, 0.9]), val('roofToEave', 2, [0.4, 1.5]), val('width', 6, [5, 7])]);
    expect(v.map((x) => x.id)).toEqual(['roofToEave', 'ratio', 'articulation']);
  });
});

describe('Zuordnungstabelle', () => {
  it('Dach zu flach → steiler, zu steil → flacher; Dach-Details des Bautyps bleiben', () => {
    const [up] = leversFor(val('roofToEave', 0.2, [0.4, 1.5]), { buildingTypeId: 'tavern' }, M([]), new Set(), new Set());
    expect(up).toMatchObject({ lever: 'pitchUp', base: { shell: { roofDetail: { pitch: 'steep', trim: true } } } });
    expect(leversFor(val('roofToEave', 2, [0.4, 1.5]), {}, M([]), new Set(), new Set())[0]!.lever).toBe('pitchDown');
    expect(applyLever('pitchUp', {}, M([], { roofDetail: { pitch: 'steep' } }), new Set())).toBeUndefined();
  });
  it('von der Bitte genannte Felder fasst der Kritiker nicht an', () => {
    expect(leversFor(val('heightToWidth', 0.2, [0.5, 0.9]), {}, M([]), new Set(['floors', 'shell']), new Set())).toEqual([]);
    expect(leversFor(val('massCount', 1, [2, 4]), {}, M([]), new Set(['silhouette']), new Set()).map((l) => l.lever)).toEqual(['reroll']);
  });
  it('neue Varianten: verworfene werden nicht wiederholt, höchstens MAX_REROLLS', () => {
    const r = leversFor(val('ratio', 1, [1.2, 2]), { rerollCount: 0 }, M([]), new Set(), new Set(['reroll=1']));
    expect(r).toEqual([{ lever: 'reroll', base: { rerollCount: 2 }, key: 'reroll=2' }]);
    expect(leversFor(val('ratio', 1, [1.2, 2]), { rerollCount: 3 }, M([]), new Set(), new Set())).toEqual([]);
  });
});

describe('gemessene Runden (Attrappe des Mess-Ports)', () => {
  it('Runde behebt: ein verletzter Wert, eine Stellgröße, übernommen, danach alles im Bereich', { timeout: HEAVY_TIMEOUT }, () => {
    const measure: MeasurePlan = (b) => M([val('roofToEave', pitchOf(b) === 'steep' ? 0.8 : 0.2, [0.4, 1.5]), val('ratio', 1.5, [1.2, 2])], { roofDetail: { pitch: pitchOf(b) } });
    const out = drive(measuredRounds(engine, start(), measure, 3, undefined, localChoose));
    expect(out.rounds.map((r) => [r.target?.id, r.lever, r.accepted])).toEqual([['roofToEave', 'pitchUp', true], [undefined, undefined, false]]);
    expect(out.rounds[1]!.reason).toBe('alle Prüfwerte im Bereich');
    expect(out.before.score).toBeLessThan(out.after.score);
    expect(out.after.score).toBe(1);
    expect(pitchOf(out.best.plan.base)).toBe('steep');
    expect(out.best.world).not.toBe(start().world);
  });
  it('Rücksprung greift: Gesamtwert sinkt bzw. harte Regel bricht → Checkpoint bleibt', { timeout: HEAVY_TIMEOUT }, () => {
    // Höhe zu Breite zu niedrig: mehr Etagen verschlechtert die Frontbreite stark (Gesamtwert sinkt), steileres Dach bricht eine harte Regel
    const measure: MeasurePlan = (b) => {
      const floors = Number(b['floors'] ?? 1);
      return M([val('heightToWidth', floors > 1 ? 0.6 : 0.3, [0.5, 0.9]), val('width', floors > 1 ? 20 : 6, [5, 7])], {
        floors, roofDetail: { pitch: pitchOf(b) }, hard: pitchOf(b) === 'steep' ? ['Raum r2 nicht erreichbar'] : [],
      });
    };
    const logged: MeasuredRound[] = [];
    const out = drive(measuredRounds(engine, start(), measure, 5, undefined, localChoose, (r) => logged.push(r)));
    expect(logged).toEqual(out.rounds);
    expect(out.rounds[0]).toMatchObject({ target: { id: 'heightToWidth' }, lever: 'floorsUp', accepted: false, options: ['floorsUp', 'pitchUp'] });
    expect(out.rounds[0]!.reason).toMatch(/Gesamtwert sinkt/);
    expect(out.rounds[1]).toMatchObject({ lever: 'pitchUp', accepted: false });
    expect(out.rounds[1]!.reason).toMatch(/harte Regel/);
    expect(out.rounds[2]!.reason).toMatch(/keine Stellgröße mehr für heightToWidth/);
    expect(out.best).toBe(start());
    expect(out.after.score).toBe(out.before.score);
  });
  it('Abbruch nach maxRounds; Auswahl unter mehreren Stellgrößen über die Frage-Runde', () => {
    const measure: MeasurePlan = () => M([val('massCount', 1, [2, 4])]); // keine Stellgröße wirkt
    const asks: Array<{ options: readonly LeverId[] }> = [];
    const choose = function* (a: { options: readonly LeverId[] }): Generator<unknown, LeverId | undefined, unknown> {
      return (yield a) as LeverId;
    };
    // Modell wählt die zweite Stellgröße (neue Variante) statt der ersten (Silhouette)
    const out = drive(measuredRounds(engine, start(), measure, 2, undefined, choose), (ask) => { asks.push(ask as never); return 'reroll'; });
    expect(asks.map((a) => a.options)).toEqual([['silhouetteVaried', 'reroll'], ['silhouetteVaried', 'reroll']]);
    expect(out.rounds.map((r) => [r.lever, r.accepted])).toEqual([['reroll', false], ['reroll', false]]);
    expect(out.rounds[0]!.reason).toMatch(/kein Gewinn/);
    expect(out.best).toBe(start());
  });
});

describe('design_iterate mit critic: measured (echter Planer)', () => {
  it('Mess-Port misst den Plan wie der Planer', () => {
    const m = planMeasure(ctx, engine)({ buildingTypeId: 'longhouse', seed: 1 });
    expect(m.values.map((v) => v.id)).toEqual(['ratio', 'heightToWidth']);
    expect(m.values.find((v) => v.id === 'heightToWidth')!.ok).toBe(false);
    expect(m.roofDetail).toMatchObject({ pitch: 'normal' });
  });
  it('Langhaus: Höhe zu Breite über die Dachneigung behoben, deterministisch; ohne Option bzw. requirements unverändert', { timeout: HEAVY_TIMEOUT }, () => {
    const input = { prompt: 'ein Wikinger-Langhaus', seed: 1 };
    const plain = engine.execute({ op: 'design_iterate', input });
    const req = engine.execute({ op: 'design_iterate', input: { ...input, critic: 'requirements' } });
    const a = engine.execute({ op: 'design_iterate', input: { ...input, critic: 'measured' } });
    const b = engine.execute({ op: 'design_iterate', input: { ...input, critic: 'measured' } });
    if (!plain.ok || !a.ok || !b.ok || !req.ok) throw new Error('design_iterate fehlgeschlagen');
    type D = { quality?: { before: { score: number }; after: { score: number } }; request: { input: Record<string, unknown> }; rounds: Array<{ phase: string }> };
    const p = plain.data as D;
    const d = a.data as D;
    expect(p.quality).toBeUndefined();
    expect(p.rounds.some((r) => r.phase === 'measure')).toBe(false);
    expect(req.data).toEqual(plain.data);
    expect(d.quality!.after.score).toBeGreaterThan(d.quality!.before.score);
    expect(d.request.input['shell']).toMatchObject({ roofDetail: { pitch: 'low' } });
    expect(d.rounds.filter((r) => r.phase === 'measure').length).toBeGreaterThan(0);
    expect(b.data).toEqual(a.data);
  });
});

describe('Schleife: Auswahl der Stellgröße über das Entscheidungsmodell', () => {
  it('Frage fix.lever nur bei mehreren Stellgrößen; Modellwahl gilt, lokal die erste', { timeout: HEAVY_TIMEOUT }, () => {
    const questions = decisionPlan(engine.inputSchema('building_generate'), engine.vocabulary);
    // Attrappe: Höhe zu Breite zu niedrig, beide Stellgrößen (Etage, steileres Dach) beheben es
    const measure: MeasurePlan = (b) => M([val('heightToWidth', Number(b['floors'] ?? 1) > 1 || pitchOf(b) === 'steep' ? 0.7 : 0.3, [0.5, 0.9])], {
      floors: Number(b['floors'] ?? 1), roofDetail: { pitch: pitchOf(b) },
    });
    const run = (pick?: string): { base: Record<string, unknown>; phases: string[]; asked: number } => {
      const gen = designLoop(engine, questions, { prompt: 'ein Wachturm', seed: 1, critic: 'measured' }, { maxRounds: 1 }, measure);
      let asked = 0;
      let step = gen.next();
      while (!step.done) {
        const ask: Ask = step.value;
        const answers = { ...ask.local };
        if (ask.phase === 'measure') {
          asked++;
          if (pick !== undefined) answers['fix.lever'] = { type: 'choice', choice: pick, confidence: 0.95 };
        }
        const reply: Reply = { answers, source: pick !== undefined && ask.phase === 'measure' ? 'model' : 'local', budgetLeft: true };
        step = gen.next(reply);
      }
      return { base: step.value.plan.base as Record<string, unknown>, phases: step.value.rounds.map((r) => r.phase), asked };
    };
    const local = run();
    expect(local.asked).toBe(1);
    expect(local.base['floors']).toBe(2);
    const model = run('pitchUp');
    expect(model.base['floors']).toBeUndefined();
    expect(pitchOf(model.base)).toBe('steep');
    expect(model.phases.filter((p) => p === 'measure').length).toBe(2); // Frage-Runde + gemessene Runde
  });
});
