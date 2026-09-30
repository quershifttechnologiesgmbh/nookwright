/**
 * Paarvergleichs-Format für den blinden A/B-Test (Protokoll: plan/ab_protokoll.md).
 *
 * Ein "System" ist, was gerankt wird (ein Golden-Lauf, eine Version, ein Theme oder ein Referenzkorpus); ein "Fall"
 * ist das gemeinsame Motiv (Bautyp + Theme + Seed), damit nur Gleiches mit Gleichem verglichen wird. Die Seiten
 * (links/rechts) vergibt ein Seed, nie die Reihenfolge der Eingabe, damit Positionsbias messbar bleibt.
 */
import { Rng, hashSeed } from '@mcda/core';

/** Bewertungsdimensionen (DR2 §4 Nr. 4). */
export const RUBRICS = ['visual', 'structural', 'prompt_fit'] as const;
export type Rubric = (typeof RUBRICS)[number];

export const RUBRIC_LABELS: Readonly<Record<Rubric, string>> = {
  visual: 'Visuelle Wirkung',
  structural: 'Strukturelle Plausibilität',
  prompt_fit: 'Passung zur Bitte',
};

/** Minecraft-Bauer (Fachleute) getrennt von Laien; `model` für VLM-Richter bei der Kalibrierung. */
export const RATER_KINDS = ['builder', 'layperson', 'model'] as const;
export type RaterKind = (typeof RATER_KINDS)[number];

export type Side = 'left' | 'right';
export type Outcome = Side | 'tie';
/** Antwort auf "Welches würden Sie behalten?". */
export type Keep = Side | 'both' | 'neither';

export interface PairCandidate {
  readonly system: string;
  readonly caseId: string;
  /** Einzelnes Motiv innerhalb des Falls (z. B. ein bestimmter Referenzbau); ohne: der Fall selbst. */
  readonly item?: string;
}

/** Ein blind gezeigtes Paar: Fall, beide Systeme und die per Seed gezogene Seitenzuordnung. */
export interface Pair {
  readonly pairId: string;
  readonly caseId: string;
  readonly left: string;
  readonly right: string;
  /** Gezeigte Motive, wenn ein System mehrere im selben Fall hat. */
  readonly leftItem?: string;
  readonly rightItem?: string;
}

/** Ein Urteil eines Raters zu einem Paar in einer Rubrik. `scores` (1–10) sind optional; fehlt `winner`, entscheidet der höhere Wert. */
export interface Judgement {
  readonly pairId: string;
  readonly rater: string;
  readonly raterKind: RaterKind;
  readonly rubric: Rubric;
  readonly winner: Outcome;
  readonly scores?: { readonly left: number; readonly right: number };
  readonly keep?: Keep;
  /** Gezeigt mit vertauschten Seiten (z. B. zweiter Durchgang eines VLM-Richters); `winner`/`scores`/`keep` beziehen sich dann auf die gezeigten Seiten. */
  readonly presentedSwapped?: boolean;
}

/** Ein Urteil, auf Systeme aufgelöst (Eingabe für Bradley-Terry). `result` aus Sicht von `a`: 1 Sieg, 0,5 Gleich, 0 Niederlage. */
export interface Comparison {
  readonly a: string;
  readonly b: string;
  readonly result: 0 | 0.5 | 1;
  readonly weight?: number;
}

/** Sieger aus zwei Noten 1–10 (gleiche Note = Unentschieden). */
export function outcomeFromScores(left: number, right: number): Outcome {
  for (const s of [left, right]) if (!Number.isInteger(s) || s < 1 || s > 10) throw new RangeError(`Note ${s} liegt nicht in 1..10`);
  return left === right ? 'tie' : left > right ? 'left' : 'right';
}

/** Seitenzuordnung eines Paares aus Seed und Paar-Schlüssel: unabhängig von Eingabereihenfolge und anderen Paaren. */
export function assignSides(a: string, b: string, caseId: string, seed: number): { left: string; right: string } {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return (hashSeed(seed, 'side', caseId, lo, hi) & 1) === 0 ? { left: lo, right: hi } : { left: hi, right: lo };
}

export interface ScheduleOptions {
  readonly seed: number;
  /** Höchstzahl Paare (deterministische Stichprobe); ohne: alle. */
  readonly maxPairs?: number;
}

/**
 * Alle Paare verschiedener Systeme mit demselben Fall (bei Motiven: jede Motiv-Kombination), Seiten per Seed,
 * Reihenfolge per Seed gemischt. Kandidaten ohne Gegenstück im selben Fall fallen weg.
 */
export function schedulePairs(candidates: readonly PairCandidate[], opts: ScheduleOptions): Pair[] {
  const byCase = new Map<string, Map<string, PairCandidate>>();
  for (const c of candidates) {
    const m = byCase.get(c.caseId) ?? new Map<string, PairCandidate>();
    m.set(`${c.system}\u0000${c.item ?? ''}`, c);
    byCase.set(c.caseId, m);
  }
  const pairs: Pair[] = [];
  for (const caseId of [...byCase.keys()].sort()) {
    const cs = [...byCase.get(caseId)!.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((e) => e[1]);
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i]!;
        const b = cs[j]!;
        if (a.system === b.system) continue;
        const ai = a.item ?? '';
        const bi = b.item ?? '';
        const withItems = a.item !== undefined || b.item !== undefined;
        const sides = assignSides(withItems ? `${a.system}\u0000${ai}` : a.system, withItems ? `${b.system}\u0000${bi}` : b.system, caseId, opts.seed);
        const leftIsA = sides.left === (withItems ? `${a.system}\u0000${ai}` : a.system);
        const [l, r] = leftIsA ? [a, b] : [b, a];
        const pairId = `p${(withItems ? hashSeed(opts.seed, 'pair', caseId, a.system, ai, b.system, bi) : hashSeed(opts.seed, 'pair', caseId, a.system, b.system)).toString(36)}`;
        pairs.push({
          pairId, caseId, left: l.system, right: r.system,
          ...(l.item !== undefined ? { leftItem: l.item } : {}), ...(r.item !== undefined ? { rightItem: r.item } : {}),
        });
      }
    }
  }
  const shuffled = new Rng(hashSeed(opts.seed, 'order')).shuffle(pairs);
  return opts.maxPairs === undefined ? shuffled : shuffled.slice(0, Math.max(0, opts.maxPairs));
}

export interface ComparisonFilter {
  readonly rubric?: Rubric;
  readonly raterKind?: RaterKind | readonly RaterKind[];
}

/** Urteile → Vergleiche zwischen Systemen (unbekannte Paare sind ein Fehler, nicht still verworfen). */
export function toComparisons(judgements: readonly Judgement[], pairs: readonly Pair[], filter: ComparisonFilter = {}): Comparison[] {
  const byId = new Map(pairs.map((p) => [p.pairId, p]));
  const kinds = filter.raterKind === undefined ? undefined : typeof filter.raterKind === 'string' ? [filter.raterKind] : filter.raterKind;
  const out: Comparison[] = [];
  for (const j of judgements) {
    if (filter.rubric !== undefined && j.rubric !== filter.rubric) continue;
    if (kinds !== undefined && !kinds.includes(j.raterKind)) continue;
    const p = byId.get(j.pairId);
    if (p === undefined) throw new Error(`Urteil zu unbekanntem Paar ${j.pairId}`);
    const w = canonicalOutcome(j);
    out.push({ a: p.left, b: p.right, result: w === 'left' ? 1 : w === 'right' ? 0 : 0.5 });
  }
  return out;
}

const flip = (o: Outcome): Outcome => (o === 'left' ? 'right' : o === 'right' ? 'left' : 'tie');

/** Sieger bezogen auf die Seiten des Paares (nicht auf die gezeigten Seiten). */
export function canonicalOutcome(j: Pick<Judgement, 'winner' | 'presentedSwapped'>): Outcome {
  return j.presentedSwapped === true ? flip(j.winner) : j.winner;
}

/** Normalisiert ein Urteil: Sieger aus Noten, falls nur Noten vorliegen; Widerspruch zwischen beiden ist ein Fehler. */
export function normalizeJudgement(j: Omit<Judgement, 'winner'> & { readonly winner?: Outcome }): Judgement {
  const fromScores = j.scores === undefined ? undefined : outcomeFromScores(j.scores.left, j.scores.right);
  const winner = j.winner ?? fromScores;
  if (winner === undefined) throw new Error(`Urteil ${j.pairId}/${j.rubric} ohne Sieger und ohne Noten`);
  if (fromScores !== undefined && fromScores !== winner) throw new Error(`Urteil ${j.pairId}/${j.rubric}: Sieger ${winner} widerspricht den Noten`);
  return { ...j, winner };
}
