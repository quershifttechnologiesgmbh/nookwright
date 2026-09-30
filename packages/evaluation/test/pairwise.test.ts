import { describe, expect, it } from 'vitest';
import {
  assignSides, binomialTwoSided, interRaterAgreement, judgeAgreement, normalizeJudgement, normalQuantile, outcomeFromScores, positionBias,
  requiredComparisons, schedulePairs, swapConsistency, toComparisons, wilsonInterval, type Judgement, type Pair,
} from '../src/index.js';

const J = (pairId: string, winner: Judgement['winner'], extra: Partial<Judgement> = {}): Judgement => ({
  pairId, rater: 'r1', raterKind: 'builder', rubric: 'visual', winner, ...extra,
});

describe('Paarplan und Seitenzuordnung', () => {
  it('Seiten hängen nur von Seed und Paar ab, nicht von der Argumentreihenfolge', () => {
    expect(assignSides('a', 'b', 'c1', 4)).toEqual(assignSides('b', 'a', 'c1', 4));
    let left = 0;
    for (let s = 0; s < 400; s++) if (assignSides('a', 'b', 'c1', s).left === 'a') left++;
    expect(left).toBeGreaterThan(160);
    expect(left).toBeLessThan(240);
  });

  it('paart alle Systeme je Fall, lässt Einzelfälle weg, mischt deterministisch', () => {
    const cands = ['s1', 's2', 's3'].flatMap((system) => ['farm', 'tower'].map((caseId) => ({ system, caseId })));
    cands.push({ system: 's1', caseId: 'solo' });
    const pairs = schedulePairs(cands, { seed: 1 });
    expect(pairs).toHaveLength(6);
    expect(pairs.every((p) => p.caseId !== 'solo' && p.left !== p.right)).toBe(true);
    expect(new Set(pairs.map((p) => p.pairId)).size).toBe(6);
    expect(schedulePairs([...cands].reverse(), { seed: 1 })).toEqual(pairs);
    expect(schedulePairs(cands, { seed: 1, maxPairs: 2 })).toEqual(pairs.slice(0, 2));
    expect(schedulePairs(cands, { seed: 2 }).map((p) => p.pairId)).not.toEqual(pairs.map((p) => p.pairId));
  });

  it('Motive je Fall: Community-Referenzen gegen eigene Bauten desselben Bautyps', () => {
    const cands = [
      { system: 'ours', caseId: 'farmhouse', item: 'farmhouse-medieval-s5' }, { system: 'ours', caseId: 'farmhouse', item: 'farmhouse-nordic-s5' },
      { system: 'community', caseId: 'farmhouse', item: 'ref-a' }, { system: 'community', caseId: 'farmhouse', item: 'ref-b' }, { system: 'community', caseId: 'farmhouse', item: 'ref-c' },
    ];
    const pairs = schedulePairs(cands, { seed: 3 });
    expect(pairs).toHaveLength(6); // 2 × 3, nie ours gegen ours
    for (const p of pairs) {
      expect(p.left).not.toBe(p.right);
      const items = [p.leftItem, p.rightItem];
      expect(items.some((i) => i!.startsWith('ref-')) && items.some((i) => i!.startsWith('farmhouse-'))).toBe(true);
    }
    expect(new Set(pairs.map((p) => p.pairId)).size).toBe(6);
    expect(new Set(pairs.map((p) => p.left)).size).toBe(2);
  });

  it('Urteile → Vergleiche, auch bei vertauscht gezeigten Seiten', () => {
    const pairs: Pair[] = [{ pairId: 'p', caseId: 'c', left: 'A', right: 'B' }];
    const js = [J('p', 'left'), J('p', 'left', { presentedSwapped: true }), J('p', 'tie', { rubric: 'structural' }), J('p', 'right', { raterKind: 'layperson' })];
    expect(toComparisons(js, pairs, { rubric: 'visual', raterKind: 'builder' })).toEqual([{ a: 'A', b: 'B', result: 1 }, { a: 'A', b: 'B', result: 0 }]);
    expect(toComparisons(js, pairs, { rubric: 'structural' })).toEqual([{ a: 'A', b: 'B', result: 0.5 }]);
    expect(() => toComparisons([J('x', 'left')], pairs)).toThrow(/unbekanntem Paar/);
  });

  it('Noten 1–10 bestimmen den Sieger; Widerspruch ist ein Fehler', () => {
    expect(outcomeFromScores(7, 4)).toBe('left');
    expect(outcomeFromScores(5, 5)).toBe('tie');
    expect(() => outcomeFromScores(0, 5)).toThrow(RangeError);
    const base = { pairId: 'p', rater: 'r', raterKind: 'layperson', rubric: 'visual' } as const;
    expect(normalizeJudgement({ ...base, scores: { left: 3, right: 8 } }).winner).toBe('right');
    expect(() => normalizeJudgement({ ...base, winner: 'left', scores: { left: 3, right: 8 } })).toThrow(/widerspricht/);
    expect(() => normalizeJudgement(base)).toThrow(/ohne Sieger/);
  });
});

describe('Übereinstimmung und Positionsbias', () => {
  const human = [J('a', 'left'), J('b', 'right'), J('c', 'left'), J('d', 'tie'), J('e', 'right', { rater: 'r2' }), J('e', 'right', { rater: 'r3' }), J('e', 'left')];

  it('Richter gleich Mensch → Rate 1, Kappa 1, Kriterium erfüllt', () => {
    const judge = [J('a', 'left'), J('b', 'right'), J('c', 'left'), J('d', 'tie'), J('e', 'right')].map((j) => ({ ...j, rater: 'vlm', raterKind: 'model' as const }));
    const r = judgeAgreement(human, judge);
    expect(r).toMatchObject({ n: 5, agree: 5, rate: 1, kappa: 1, meetsThreshold: true, robust: false });
  });

  it('bekannte Konfusion: 3 von 5 → 60 %, Kriterium verfehlt; Referenz-Unentschieden auslassbar', () => {
    const judge = [J('a', 'left'), J('b', 'left'), J('c', 'left'), J('d', 'left'), J('e', 'right')];
    const r = judgeAgreement(human, judge);
    expect(r.rate).toBeCloseTo(0.6, 10);
    expect(r.meetsThreshold).toBe(false);
    // Referenz: L,R,L,T,R; Richter: L,L,L,L,R → pe = (2/5·4/5)+(2/5·1/5)+(1/5·0) = 0,4
    expect(r.kappa).toBeCloseTo((0.6 - 0.4) / 0.6, 10);
    expect(judgeAgreement(human, judge, { ignoreReferenceTies: true }).rate).toBeCloseTo(0.75, 10);
  });

  it('Positionsbias: exakter Binomialtest', () => {
    const allLeft = Array.from({ length: 10 }, (_, i) => J(`p${i}`, 'left'));
    const r = positionBias([...allLeft, J('t', 'tie')]);
    expect(r).toMatchObject({ decided: 10, ties: 1, leftRate: 1 });
    expect(r.pValue).toBeCloseTo(2 / 1024, 12);
    expect(positionBias([J('a', 'left'), J('b', 'right')]).pValue).toBeCloseTo(1, 12);
  });

  it('Reihenfolge-Stabilität und Übereinstimmung zwischen Ratern', () => {
    const js = [J('a', 'left'), J('a', 'right', { presentedSwapped: true }), J('b', 'left'), J('b', 'left', { presentedSwapped: true })];
    expect(swapConsistency(js)).toEqual({ pairs: 2, consistent: 1, rate: 0.5 });
    expect(interRaterAgreement([J('a', 'left'), J('a', 'left', { rater: 'r2' }), J('a', 'right', { rater: 'r3' })])).toEqual({ pairs: 3, agree: 1, rate: 1 / 3 });
  });
});

describe('Statistik-Helfer', () => {
  it('Normalquantil, Wilson-Intervall, Binomialtest', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.01)).toBeCloseTo(-2.326348, 5);
    const w = wilsonInterval(8, 10);
    expect(w.lo).toBeCloseTo(0.4902, 3);
    expect(w.hi).toBeCloseTo(0.9433, 3);
    expect(binomialTwoSided(2, 10)).toBeCloseTo(0.109375, 10);
  });

  it('Mindestzahl entschiedener Vergleiche', () => {
    expect(requiredComparisons(0.6)).toBe(194);
    expect(requiredComparisons(0.65)).toBe(85);
    expect(requiredComparisons(0.7)).toBeLessThan(requiredComparisons(0.65));
    expect(() => requiredComparisons(0.5)).toThrow(RangeError);
  });
});
