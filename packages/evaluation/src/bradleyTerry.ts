/**
 * Bradley-Terry-Modell für Paarvergleiche (MineBench-/MC-Bench-Methode, DR1 Nr. 2, DR4 §4 Nr. 4):
 * P(i schlägt j) = p_i / (p_i + p_j), geschätzt mit der MM-Iteration (Hunter 2004). Unentschieden zählen je als
 * halber Sieg. Ein schwacher Prior (virtuelle Spiele gegen einen Anker der Stärke 1) hält die Schätzung endlich,
 * wenn ein System nie gewinnt oder nie verliert. Unsicherheit per Bootstrap über die Vergleiche (Seed).
 */
import { Rng, hashSeed } from '@mcda/core';
import type { Comparison } from './pairwise.js';

export interface BtOptions {
  /** Virtuelle Siege und Niederlagen je System gegen den Anker (Standard 0,5; 0 = reines ML, kann ±∞ ergeben). */
  readonly prior?: number;
  readonly maxIterations?: number;
  /** Abbruch, wenn sich keine Log-Stärke um mehr als diesen Wert ändert. */
  readonly tolerance?: number;
  /** Feste Menge und Reihenfolge der Systeme (auch solche ohne Vergleich); sonst aus den Vergleichen, sortiert. */
  readonly systems?: readonly string[];
}

export interface BtFit {
  readonly systems: readonly string[];
  /** Log-Stärke je System, Mittel 0. */
  readonly theta: Readonly<Record<string, number>>;
  readonly games: Readonly<Record<string, number>>;
  /** Siege (Unentschieden = 0,5) je System. */
  readonly wins: Readonly<Record<string, number>>;
  readonly iterations: number;
  readonly converged: boolean;
}

export const ELO_BASE = 1000;
const ELO_PER_THETA = 400 / Math.LN10;

/** Log-Stärke → Elo-ähnliche Skala (400 Punkte = Faktor 10 in den Gewinnchancen). */
export const toElo = (theta: number): number => ELO_BASE + ELO_PER_THETA * theta;

/** Gewinnwahrscheinlichkeit von A gegen B aus den Log-Stärken. */
export const winProbability = (thetaA: number, thetaB: number): number => 1 / (1 + Math.exp(thetaB - thetaA));

interface Tally {
  readonly n: number;
  /** games[i*n+j] = Zahl (Gewicht) der Spiele zwischen i und j (symmetrisch). */
  readonly games: Float64Array;
  readonly wins: Float64Array;
}

function tally(comparisons: readonly Comparison[], index: ReadonlyMap<string, number>, pick?: Uint32Array): Tally {
  const n = index.size;
  const games = new Float64Array(n * n);
  const wins = new Float64Array(n);
  const count = pick?.length ?? comparisons.length;
  for (let k = 0; k < count; k++) {
    const c = comparisons[pick === undefined ? k : pick[k]!]!;
    const i = index.get(c.a);
    const j = index.get(c.b);
    if (i === undefined || j === undefined) throw new Error(`Vergleich ${c.a}–${c.b}: System nicht in der Systemliste`);
    if (i === j) continue;
    const w = c.weight ?? 1;
    games[i * n + j] = games[i * n + j]! + w;
    games[j * n + i] = games[j * n + i]! + w;
    wins[i] = wins[i]! + w * c.result;
    wins[j] = wins[j]! + w * (1 - c.result);
  }
  return { n, games, wins };
}

function mm(t: Tally, prior: number, maxIterations: number, tolerance: number): { logP: Float64Array; iterations: number; converged: boolean } {
  const { n, games, wins } = t;
  let p = new Float64Array(n).fill(1);
  let next = new Float64Array(n);
  for (let it = 1; it <= maxIterations; it++) {
    let delta = 0;
    for (let i = 0; i < n; i++) {
      let denom = prior > 0 ? (2 * prior) / (p[i]! + 1) : 0;
      for (let j = 0; j < n; j++) {
        const g = games[i * n + j]!;
        if (g > 0) denom += g / (p[i]! + p[j]!);
      }
      const num = wins[i]! + prior;
      next[i] = denom > 0 ? num / denom : p[i]!;
    }
    if (prior === 0) {
      // ohne Anker ist die Skala frei: geometrisches Mittel auf 1 halten
      let s = 0;
      let m = 0;
      for (let i = 0; i < n; i++) if (next[i]! > 0 && Number.isFinite(next[i]!)) { s += Math.log(next[i]!); m++; }
      const g = m > 0 ? Math.exp(s / m) : 1;
      for (let i = 0; i < n; i++) next[i] = next[i]! / g;
    }
    for (let i = 0; i < n; i++) {
      const a = Math.log(p[i]!);
      const b = Math.log(next[i]!);
      const d = Number.isFinite(a) && Number.isFinite(b) ? Math.abs(b - a) : a === b ? 0 : Infinity;
      if (d > delta) delta = d;
    }
    [p, next] = [next, p];
    if (delta < tolerance) return { logP: centered(p), iterations: it, converged: true };
  }
  return { logP: centered(p), iterations: maxIterations, converged: false };
}

function centered(p: Float64Array): Float64Array {
  const out = new Float64Array(p.length);
  let s = 0;
  let m = 0;
  for (let i = 0; i < p.length; i++) {
    out[i] = Math.log(p[i]!);
    if (Number.isFinite(out[i]!)) { s += out[i]!; m++; }
  }
  const mean = m > 0 ? s / m : 0;
  for (let i = 0; i < p.length; i++) out[i] = out[i]! - mean;
  return out;
}

function systemsOf(comparisons: readonly Comparison[], fixed?: readonly string[]): string[] {
  if (fixed !== undefined) return [...fixed];
  const s = new Set<string>();
  for (const c of comparisons) { s.add(c.a); s.add(c.b); }
  return [...s].sort();
}

const DEFAULTS = { prior: 0.5, maxIterations: 10_000, tolerance: 1e-10 };

/** Punktschätzung der Stärken. */
export function fitBradleyTerry(comparisons: readonly Comparison[], opts: BtOptions = {}): BtFit {
  const systems = systemsOf(comparisons, opts.systems);
  const index = new Map(systems.map((s, i) => [s, i]));
  const prior = opts.prior ?? DEFAULTS.prior;
  if (!(prior >= 0)) throw new RangeError(`prior ${prior} < 0`);
  const t = tally(comparisons, index);
  const r = mm(t, prior, opts.maxIterations ?? DEFAULTS.maxIterations, opts.tolerance ?? DEFAULTS.tolerance);
  const theta: Record<string, number> = {};
  const games: Record<string, number> = {};
  const wins: Record<string, number> = {};
  systems.forEach((s, i) => {
    theta[s] = r.logP[i]!;
    let g = 0;
    for (let j = 0; j < t.n; j++) g += t.games[i * t.n + j]!;
    games[s] = g;
    wins[s] = t.wins[i]!;
  });
  return { systems, theta, games, wins, iterations: r.iterations, converged: r.converged };
}

export interface BootstrapOptions extends BtOptions {
  readonly seed: number;
  /** Zahl der Bootstrap-Stichproben (Standard 1000). */
  readonly samples?: number;
  /** Konfidenzniveau der Perzentil-Intervalle (Standard 0,95). */
  readonly level?: number;
}

export interface RankingEntry {
  readonly system: string;
  readonly theta: number;
  readonly elo: number;
  /** Perzentil-Intervall der Log-Stärke. */
  readonly thetaLo: number;
  readonly thetaHi: number;
  readonly eloLo: number;
  readonly eloHi: number;
  /** Rang 1 = stärkstes System; Intervall aus den Bootstrap-Rängen. */
  readonly rank: number;
  readonly rankLo: number;
  readonly rankHi: number;
  readonly games: number;
  readonly winRate: number | null;
}

export interface Ranking {
  readonly entries: readonly RankingEntry[];
  readonly comparisons: number;
  readonly samples: number;
  readonly level: number;
  readonly seed: number;
  readonly converged: boolean;
}

/** Perzentil mit linearer Interpolation (q in [0, 1]) einer aufsteigend sortierten Liste. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo);
}

/** Punktschätzung plus Bootstrap-Intervalle (Stärke und Rang), deterministisch über `seed`. */
export function rankSystems(comparisons: readonly Comparison[], opts: BootstrapOptions): Ranking {
  const samples = opts.samples ?? 1000;
  const level = opts.level ?? 0.95;
  const fit = fitBradleyTerry(comparisons, opts);
  const systems = fit.systems;
  const n = systems.length;
  const index = new Map(systems.map((s, i) => [s, i]));
  const prior = opts.prior ?? DEFAULTS.prior;
  const maxIt = opts.maxIterations ?? DEFAULTS.maxIterations;
  const tol = Math.max(opts.tolerance ?? DEFAULTS.tolerance, 1e-8);
  const thetas = systems.map(() => new Float64Array(samples));
  const ranks = systems.map(() => new Float64Array(samples));
  const rng = new Rng(hashSeed(opts.seed, 'bootstrap'));
  const m = comparisons.length;
  const pick = new Uint32Array(m);
  let converged = fit.converged;
  for (let b = 0; b < samples; b++) {
    for (let k = 0; k < m; k++) pick[k] = Math.floor(rng.next() * m);
    const r = mm(tally(comparisons, index, pick), prior, maxIt, tol);
    converged &&= r.converged;
    const order = [...r.logP.keys()].sort((x, y) => r.logP[y]! - r.logP[x]! || x - y);
    order.forEach((i, pos) => { ranks[i]![b] = pos + 1; });
    for (let i = 0; i < n; i++) thetas[i]![b] = r.logP[i]!;
  }
  const a = (1 - level) / 2;
  const pointOrder = systems.map((s, i) => ({ s, i, t: fit.theta[s]! })).sort((x, y) => y.t - x.t || x.i - y.i);
  const pointRank = new Map(pointOrder.map((x, pos) => [x.s, pos + 1]));
  const entries = systems.map((s, i): RankingEntry => {
    const ts = thetas[i]!.slice().sort();
    const rs = ranks[i]!.slice().sort();
    const theta = fit.theta[s]!;
    const lo = samples > 0 ? quantile(ts, a) : theta;
    const hi = samples > 0 ? quantile(ts, 1 - a) : theta;
    const g = fit.games[s]!;
    return {
      system: s, theta, elo: toElo(theta), thetaLo: lo, thetaHi: hi, eloLo: toElo(lo), eloHi: toElo(hi),
      rank: pointRank.get(s)!, rankLo: samples > 0 ? Math.round(quantile(rs, a)) : pointRank.get(s)!, rankHi: samples > 0 ? Math.round(quantile(rs, 1 - a)) : pointRank.get(s)!,
      games: g, winRate: g > 0 ? fit.wins[s]! / g : null,
    };
  }).sort((x, y) => x.rank - y.rank);
  return { entries, comparisons: m, samples, level, seed: opts.seed, converged };
}
