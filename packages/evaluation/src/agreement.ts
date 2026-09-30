/**
 * Übereinstimmungs- und Positionsbias-Maße für die spätere VLM-Kalibrierung (DR4 §4 Nr. 3: ein Richter darf erst
 * steuern, wenn er ≥ 80 % mit unseren menschlichen Blind-Urteilen übereinstimmt; DR2 §4 Nr. 3: Reihenfolge tauschen).
 */
import { canonicalOutcome, type Judgement, type Outcome } from './pairwise.js';
import { binomialTwoSided, wilsonInterval } from './stats.js';

/** Kalibrier-Kriterium aus DR4 §4 Nr. 3. */
export const JUDGE_AGREEMENT_THRESHOLD = 0.8;

const keyOf = (j: Pick<Judgement, 'pairId' | 'rubric'>): string => `${j.pairId}\u0000${j.rubric}`;

/** Mehrheitsurteil je Paar und Rubrik (Gleichstand der Stimmen = Unentschieden), bezogen auf die Paar-Seiten. */
export function majorityOutcomes(judgements: readonly Judgement[]): Map<string, Outcome> {
  const votes = new Map<string, { left: number; right: number; tie: number }>();
  for (const j of judgements) {
    const k = keyOf(j);
    const v = votes.get(k) ?? { left: 0, right: 0, tie: 0 };
    v[canonicalOutcome(j)]++;
    votes.set(k, v);
  }
  const out = new Map<string, Outcome>();
  for (const [k, v] of votes) {
    const best = Math.max(v.left, v.right, v.tie);
    const tops = (['left', 'right', 'tie'] as const).filter((o) => v[o] === best);
    out.set(k, tops.length === 1 ? tops[0]! : 'tie');
  }
  return out;
}

export interface AgreementResult {
  /** Verglichene Urteile (Schlüssel Paar + Rubrik, in beiden Mengen vorhanden). */
  readonly n: number;
  readonly agree: number;
  readonly rate: number | null;
  readonly lo: number;
  readonly hi: number;
  /** Cohens Kappa über die drei Ausgänge (zufallsbereinigt). */
  readonly kappa: number | null;
  readonly threshold: number;
  /** `rate` ≥ Schwelle (Punktschätzung); `robust`: auch die untere Intervallgrenze. */
  readonly meetsThreshold: boolean;
  readonly robust: boolean;
}

export interface AgreementOptions {
  readonly threshold?: number;
  /** Schlüssel, bei denen die Referenz unentschieden ist, auslassen (Standard: nein). */
  readonly ignoreReferenceTies?: boolean;
}

/** Übereinstimmung eines Richters (z. B. VLM) mit einer Referenz (Mehrheit der Menschen), je Paar und Rubrik. */
export function judgeAgreement(reference: readonly Judgement[], judge: readonly Judgement[], opts: AgreementOptions = {}): AgreementResult {
  const ref = majorityOutcomes(reference);
  const jud = majorityOutcomes(judge);
  const cats = ['left', 'right', 'tie'] as const;
  const conf = new Map<string, number>();
  let n = 0;
  let agree = 0;
  for (const [k, r] of ref) {
    const j = jud.get(k);
    if (j === undefined) continue;
    if (opts.ignoreReferenceTies === true && r === 'tie') continue;
    n++;
    if (r === j) agree++;
    conf.set(`${r}|${j}`, (conf.get(`${r}|${j}`) ?? 0) + 1);
  }
  let pe = 0;
  for (const c of cats) {
    let rc = 0;
    let jc = 0;
    for (const d of cats) { rc += conf.get(`${c}|${d}`) ?? 0; jc += conf.get(`${d}|${c}`) ?? 0; }
    pe += n > 0 ? (rc / n) * (jc / n) : 0;
  }
  const rate = n > 0 ? agree / n : null;
  const kappa = rate === null ? null : pe >= 1 ? (rate === 1 ? 1 : 0) : (rate - pe) / (1 - pe);
  const { lo, hi } = wilsonInterval(agree, n);
  const threshold = opts.threshold ?? JUDGE_AGREEMENT_THRESHOLD;
  return { n, agree, rate, lo, hi, kappa, threshold, meetsThreshold: rate !== null && rate >= threshold, robust: n > 0 && lo >= threshold };
}

export interface InterRaterResult {
  /** Rater-Paare mit gemeinsamem Urteil (gleiches Paar, gleiche Rubrik). */
  readonly pairs: number;
  readonly agree: number;
  readonly rate: number | null;
}

/** Paarweise prozentuale Übereinstimmung zwischen Ratern (je Rater zählt sein Mehrheitsurteil je Schlüssel). */
export function interRaterAgreement(judgements: readonly Judgement[]): InterRaterResult {
  const byKey = new Map<string, Map<string, Outcome>>();
  const perRater = new Map<string, Judgement[]>();
  for (const j of judgements) perRater.set(j.rater, [...(perRater.get(j.rater) ?? []), j]);
  for (const [rater, js] of perRater) {
    for (const [k, o] of majorityOutcomes(js)) {
      const m = byKey.get(k) ?? new Map<string, Outcome>();
      m.set(rater, o);
      byKey.set(k, m);
    }
  }
  let pairs = 0;
  let agree = 0;
  for (const m of byKey.values()) {
    const os = [...m.values()];
    for (let i = 0; i < os.length; i++) for (let k = i + 1; k < os.length; k++) { pairs++; if (os[i] === os[k]) agree++; }
  }
  return { pairs, agree, rate: pairs > 0 ? agree / pairs : null };
}

export interface PositionBiasResult {
  /** Entschiedene Urteile (ohne Unentschieden). */
  readonly decided: number;
  readonly ties: number;
  /** Anteil der Siege der links GEZEIGTEN Seite (0,5 = kein Bias). */
  readonly leftRate: number | null;
  readonly lo: number;
  readonly hi: number;
  /** Zweiseitiger exakter Binomialtest gegen 0,5. */
  readonly pValue: number;
}

/** Positionsbias: gewinnt die links gezeigte Seite öfter als der Zufall? */
export function positionBias(judgements: readonly Judgement[]): PositionBiasResult {
  let left = 0;
  let right = 0;
  let ties = 0;
  for (const j of judgements) {
    if (j.winner === 'left') left++;
    else if (j.winner === 'right') right++;
    else ties++;
  }
  const decided = left + right;
  const { lo, hi } = wilsonInterval(left, decided);
  return { decided, ties, leftRate: decided > 0 ? left / decided : null, lo, hi, pValue: binomialTwoSided(left, decided) };
}

export interface SwapConsistencyResult {
  /** Urteile, die in beiden Seitenlagen vorliegen (gleicher Rater, Paar, Rubrik). */
  readonly pairs: number;
  readonly consistent: number;
  readonly rate: number | null;
}

/** Reihenfolge-Stabilität: gleiches Urteil (auf Paar-Seiten bezogen), wenn dasselbe Paar vertauscht gezeigt wird. */
export function swapConsistency(judgements: readonly Judgement[]): SwapConsistencyResult {
  const seen = new Map<string, { plain?: Outcome; swapped?: Outcome }>();
  for (const j of judgements) {
    const k = `${j.rater}\u0000${keyOf(j)}`;
    const e = seen.get(k) ?? {};
    if (j.presentedSwapped === true) e.swapped = canonicalOutcome(j);
    else e.plain = canonicalOutcome(j);
    seen.set(k, e);
  }
  let pairs = 0;
  let consistent = 0;
  for (const e of seen.values()) {
    if (e.plain === undefined || e.swapped === undefined) continue;
    pairs++;
    if (e.plain === e.swapped) consistent++;
  }
  return { pairs, consistent, rate: pairs > 0 ? consistent / pairs : null };
}
