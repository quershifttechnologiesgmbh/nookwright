import { Rng } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { fitBradleyTerry, rankSystems, toElo, winProbability, type Comparison } from '../src/index.js';

const TRUTH: Record<string, number> = { A: 1.2, B: 0.6, C: 0, D: -0.5, E: -1.3 };

/** Simulierte Runde: jedes Paar `n`-mal, Ausgang aus den wahren Stärken (Seed). */
function simulate(n: number, seed: number, truth = TRUTH): Comparison[] {
  const rng = new Rng(seed);
  const s = Object.keys(truth);
  const out: Comparison[] = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    for (let k = 0; k < n; k++) {
      const p = winProbability(truth[s[i]!]!, truth[s[j]!]!);
      out.push({ a: s[i]!, b: s[j]!, result: rng.next() < p ? 1 : 0 });
    }
  }
  return out;
}

describe('Bradley-Terry (MM)', () => {
  it('rekonstruiert bekannte Stärken aus simulierten Vergleichen', () => {
    const fit = fitBradleyTerry(simulate(400, 7), { prior: 0 });
    expect(fit.converged).toBe(true);
    // Standardfehler je System ≈ 0,06: Einzelabweichung < 0,2 (gut 3 SE), mittlere < 0,1
    let sum = 0;
    for (const [s, t] of Object.entries(TRUTH)) { expect(Math.abs(fit.theta[s]! - t), s).toBeLessThan(0.2); sum += Math.abs(fit.theta[s]! - t); }
    expect(sum / 5).toBeLessThan(0.1);
    const order = [...fit.systems].sort((a, b) => fit.theta[b]! - fit.theta[a]!);
    expect(order).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('trifft die geschlossene Lösung für zwei Systeme (3 von 4 Siegen → Verhältnis 3)', () => {
    const c: Comparison[] = [{ a: 'x', b: 'y', result: 1 }, { a: 'x', b: 'y', result: 1 }, { a: 'y', b: 'x', result: 0 }, { a: 'x', b: 'y', result: 0 }];
    const fit = fitBradleyTerry(c, { prior: 0 });
    expect(fit.theta['x']! - fit.theta['y']!).toBeCloseTo(Math.log(3), 8);
    expect(fit.theta['x']! + fit.theta['y']!).toBeCloseTo(0, 10);
    expect(fit.wins).toEqual({ x: 3, y: 1 });
    expect(fit.games).toEqual({ x: 4, y: 4 });
  });

  it('zählt Unentschieden als halben Sieg', () => {
    const c: Comparison[] = [{ a: 'x', b: 'y', result: 0.5 }, { a: 'x', b: 'y', result: 0.5 }, { a: 'x', b: 'y', result: 1 }, { a: 'x', b: 'y', result: 0 }];
    const fit = fitBradleyTerry(c, { prior: 0 });
    expect(fit.theta['x']).toBeCloseTo(0, 8);
    expect(fit.wins['x']).toBe(2);
  });

  it('bleibt mit Prior endlich, auch wenn ein System nie gewinnt', () => {
    const c: Comparison[] = [{ a: 'x', b: 'y', result: 1 }, { a: 'x', b: 'y', result: 1 }, { a: 'x', b: 'z', result: 1 }, { a: 'y', b: 'z', result: 0.5 }];
    const fit = fitBradleyTerry(c);
    for (const s of fit.systems) expect(Number.isFinite(fit.theta[s]!)).toBe(true);
    expect(fit.theta['x']).toBeGreaterThan(fit.theta['y']!);
  });

  it('nimmt feste Systemlisten auch ohne Vergleich an', () => {
    const fit = fitBradleyTerry([{ a: 'x', b: 'y', result: 1 }], { systems: ['x', 'y', 'q'] });
    expect(fit.systems).toEqual(['x', 'y', 'q']);
    expect(fit.games['q']).toBe(0);
    expect(() => fitBradleyTerry([{ a: 'x', b: 'w', result: 1 }], { systems: ['x'] })).toThrow(/Systemliste/);
  });

  it('Elo-Skala: 400 Punkte = zehnfache Gewinnchance', () => {
    expect(toElo(Math.LN10) - toElo(0)).toBeCloseTo(400, 8);
    expect(winProbability(Math.LN10, 0)).toBeCloseTo(10 / 11, 10);
  });
});

describe('Bootstrap-Intervalle', () => {
  it('überdecken die wahren Stärken und ordnen richtig', () => {
    const r = rankSystems(simulate(60, 11), { seed: 3, samples: 300, prior: 0.5 });
    expect(r.entries.map((e) => e.system)).toEqual(['A', 'B', 'C', 'D', 'E']);
    let covered = 0;
    for (const e of r.entries) {
      expect(e.thetaLo).toBeLessThanOrEqual(e.theta);
      expect(e.thetaHi).toBeGreaterThanOrEqual(e.theta);
      expect(e.rankLo).toBeLessThanOrEqual(e.rank);
      expect(e.rankHi).toBeGreaterThanOrEqual(e.rank);
      if (TRUTH[e.system]! >= e.thetaLo && TRUTH[e.system]! <= e.thetaHi) covered++;
    }
    expect(covered).toBeGreaterThanOrEqual(4);
    expect(r.entries[0]!.rankHi).toBeLessThanOrEqual(2);
  });

  it('ist deterministisch über den Seed und wird mit mehr Daten enger', () => {
    const c = simulate(20, 5);
    const a = rankSystems(c, { seed: 9, samples: 200 });
    const b = rankSystems(c, { seed: 9, samples: 200 });
    expect(a).toEqual(b);
    const other = rankSystems(c, { seed: 10, samples: 200 });
    expect(other.entries.map((e) => e.thetaLo)).not.toEqual(a.entries.map((e) => e.thetaLo));
    const big = rankSystems(simulate(200, 5), { seed: 9, samples: 200 });
    const width = (r: typeof a): number => r.entries.reduce((s, e) => s + e.thetaHi - e.thetaLo, 0);
    expect(width(big)).toBeLessThan(width(a) * 0.7);
  });

  it('kleine Runden zeigen überlappende Intervalle (kein Scheinsieger)', () => {
    const c: Comparison[] = [{ a: 'x', b: 'y', result: 1 }, { a: 'x', b: 'y', result: 1 }, { a: 'x', b: 'y', result: 0 }];
    const r = rankSystems(c, { seed: 1, samples: 500 });
    const [first, second] = r.entries;
    expect(first!.system).toBe('x');
    expect(first!.thetaLo).toBeLessThan(second!.thetaHi);
    expect(first!.rankHi).toBe(2);
  });
});
