/** Kleine Statistik-Helfer ohne Abhängigkeiten (Wilson-Intervall, exakter Binomialtest, Normalquantil, Rundenzahl). */

/** Quantil der Standardnormalverteilung (Acklam, relativer Fehler < 1,2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`p ${p} nicht in (0, 1)`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Wilson-Intervall für einen Anteil k/n. */
export function wilsonInterval(k: number, n: number, level = 0.95): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const z = normalQuantile(1 - (1 - level) / 2);
  const p = k / n;
  const den = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** Zweiseitiger exakter Binomialtest gegen p0 (Summe aller Ausgänge, die nicht wahrscheinlicher sind als k). */
export function binomialTwoSided(k: number, n: number, p0 = 0.5): number {
  if (n === 0) return 1;
  const pmf = (i: number): number => Math.exp(logChoose(n, i) + i * Math.log(p0) + (n - i) * Math.log(1 - p0));
  const obs = pmf(k);
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const v = pmf(i);
    if (v <= obs * (1 + 1e-9)) s += v;
  }
  return Math.min(1, s);
}

/**
 * Mindestzahl entschiedener Paarvergleiche (ohne Unentschieden), um eine wahre Gewinnrate `pAlt` eines Systems gegen
 * ein anderes von 50 % zu unterscheiden (zweiseitig, Normalnäherung).
 */
export function requiredComparisons(pAlt: number, alpha = 0.05, power = 0.8): number {
  if (!(pAlt > 0 && pAlt < 1) || pAlt === 0.5) throw new RangeError(`pAlt ${pAlt} muss in (0, 1) und ≠ 0,5 liegen`);
  const za = normalQuantile(1 - alpha / 2);
  const zb = normalQuantile(power);
  const n = (za * 0.5 + zb * Math.sqrt(pAlt * (1 - pAlt))) / Math.abs(pAlt - 0.5);
  return Math.ceil(n * n);
}
