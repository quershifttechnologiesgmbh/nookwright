/**
 * Höhenfeld (research/03 §C10): fBm aus Wertrauschen, Fundament-Anpassung (planieren + weich überblenden),
 * Ebnen der Außenbereiche und ein exakter Talus-Pass (4er-Nachbarn ≤ 1 Block, „überall begehbar“).
 * Rein und deterministisch; Höhen sind absolute Y-Werte der obersten Geländezelle.
 */
import { hashSeed, valueNoise2 } from '@mcda/core';
import type { PlotGrid } from './grid.js';
import type { TerrainStyleDef } from './style.js';

const BIG = 1 << 20;

/** fBm in [0, 1] (Oktaven mit versetzten Seeds, Frequenz ×2, Amplitude × gain). */
export function fbm(seed: number, x: number, z: number, scale: number, octaves: number, gain: number): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  for (let k = 0; k < octaves; k++) {
    sum += amp * valueNoise2(hashSeed(seed, 'fbm', k), x + k * 101, z - k * 57, Math.max(1, scale / 2 ** k));
    norm += amp;
    amp *= gain;
  }
  return sum / norm;
}

/** Natürlicher Höhen-Versatz (ganzzahlig, ±amplitude) einer Spalte. Wertrauschen streut um 0,5 → Faktor 2,5 + Kappung. */
export function naturalOffset(seed: number, x: number, z: number, relief: TerrainStyleDef['relief']): number {
  if (relief.amplitude <= 0) return 0;
  const n = fbm(seed, x, z, relief.scale, relief.octaves ?? 3, relief.gain ?? 0.5);
  const v = Math.max(-1, Math.min(1, (n - 0.5) * 2.5));
  return Math.round(v * relief.amplitude);
}

/** Weiche Abfall-Kurve (smoothstep) für die Überblendung zum natürlichen Gelände. */
export function blendFactor(dist: number, blend: number): number {
  if (dist <= 0) return 0;
  if (dist >= blend) return 1;
  const t = dist / blend;
  return t * t * (3 - 2 * t);
}

/** Zwei-Pass-Chamfer (exakt für Manhattan ohne Hindernisse): out = best(v(y) ± d(x, y)). */
function chamfer(grid: PlotGrid, v: Int32Array, mode: 'min' | 'max'): Int32Array {
  const out = Int32Array.from(v);
  const { w, d } = grid;
  const better = mode === 'min' ? (a: number, b: number) => (b + 1 < a ? b + 1 : a) : (a: number, b: number) => (b - 1 > a ? b - 1 : a);
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const i = x + z * w;
      if (x > 0) out[i] = better(out[i]!, out[i - 1]!);
      if (z > 0) out[i] = better(out[i]!, out[i - w]!);
    }
  }
  for (let z = d - 1; z >= 0; z--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = x + z * w;
      if (x < w - 1) out[i] = better(out[i]!, out[i + 1]!);
      if (z < d - 1) out[i] = better(out[i]!, out[i + w]!);
    }
  }
  return out;
}

/**
 * Talus-Pass: macht das Feld 1-Lipschitz (|h(a) − h(b)| ≤ 1 für 4er-Nachbarn) und hält gepinnte Zellen fest.
 *  1. Schranken aus den Pins: U = min(h_p + d), L = max(h_p − d); freie Zellen werden in [L, U] geklemmt.
 *  2. Natürliches Gelände: obere Hülle G = max(h(y) − d), untere Hülle H = min(h(y) + d), Basis ⌊(G + H) / 2⌋
 *     (Spitzen und Senken symmetrisch geglättet).
 *  3. Terraforming (`targets`, absolute Wunschhöhen, in [L, U] geklemmt): Anheben wirkt als Kegel
 *     R = max(t(y) − d) (Hügel mit Böschung), Senken als Trichter W = min(t(y) + d); Ergebnis min(max(Basis, R), W).
 * Max/Min von 1-Lipschitz-Funktionen bleiben 1-Lipschitz und stimmen an widerspruchsfreien Pins mit h überein.
 * Widersprüchliche Pins (Abstand kleiner als Höhenunterschied) bleiben gesetzt und werden gemeldet.
 */
export function enforceTalus(
  grid: PlotGrid, h: Int32Array, pinned: Uint8Array, targets?: ReadonlyMap<number, number>,
): { heights: Int32Array; conflicts: number } {
  const n = grid.size;
  const up = new Int32Array(n).fill(BIG);
  const lo = new Int32Array(n).fill(-BIG);
  for (let i = 0; i < n; i++) {
    if (pinned[i] === 1) {
      up[i] = h[i]!;
      lo[i] = h[i]!;
    }
  }
  const U = chamfer(grid, up, 'min');
  const L = chamfer(grid, lo, 'max');
  const clampTo = (i: number, v: number): number => {
    const a = L[i]!;
    const b = U[i]!;
    return a <= b ? Math.max(a, Math.min(b, v)) : Math.round((a + b) / 2);
  };
  const clamped = Int32Array.from(h, (v, i) => (pinned[i] === 1 ? v : clampTo(i, v)));
  const G = chamfer(grid, clamped, 'max');
  const H = chamfer(grid, clamped, 'min');
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = pinned[i] === 1 ? h[i]! : Math.floor((G[i]! + H[i]!) / 2);
  if (targets !== undefined && targets.size > 0) {
    const raise = new Int32Array(n).fill(-BIG);
    const lower = new Int32Array(n).fill(BIG);
    for (const [i, t] of targets) {
      if (pinned[i] === 1) continue;
      const v = clampTo(i, t);
      if (v > out[i]!) raise[i] = v;
      else if (v < out[i]!) lower[i] = v;
    }
    const R = chamfer(grid, raise, 'max');
    const W = chamfer(grid, lower, 'min');
    for (let i = 0; i < n; i++) if (pinned[i] !== 1) out[i] = Math.min(Math.max(out[i]!, R[i]!), W[i]!);
  }
  let conflicts = 0;
  for (let i = 0; i < n; i++) if (pinned[i] === 1 && (L[i]! > h[i]! || U[i]! < h[i]!)) conflicts++;
  return { heights: out, conflicts };
}

/**
 * Zulässige Höhe für eine Region, die EINE Höhe bekommt (ebenes Feld, Hof …), gegeben die bisherigen Pins:
 * [max(h_p − d(R, p)), min(h_p + d(R, p))]. `undefined` = keine Pins.
 */
export function levelRange(grid: PlotGrid, region: readonly number[], h: Int32Array, pinned: Uint8Array): { lo: number; hi: number } | undefined {
  const dist = grid.distance(region, 4);
  let lo = -BIG;
  let hi = BIG;
  for (let i = 0; i < grid.size; i++) {
    if (pinned[i] !== 1) continue;
    lo = Math.max(lo, h[i]! - dist[i]!);
    hi = Math.min(hi, h[i]! + dist[i]!);
  }
  return lo === -BIG ? undefined : { lo, hi };
}
