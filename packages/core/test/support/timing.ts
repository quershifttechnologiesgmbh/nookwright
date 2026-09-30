/**
 * Laufzeitprüfungen in Tests, robust gegen Fremdlast (parallele Testdateien, andere Sitzungen, CI).
 *
 * Gemessen wird die **CPU-Zeit des aufrufenden Threads** (`process.threadCpuUsage`), nicht die Wanduhr. Warten auf einen
 * freien Kern zählt damit nicht mit, die eigentliche Rechenarbeit schon – eine echte Verlangsamung bleibt sichtbar.
 * Bewusst nicht `process.cpuUsage()`: das zählt alle Threads des Prozesses (V8-GC-Hilfsthreads, libuv-Pool, im
 * vitest-Pool `threads` sogar fremde Testdateien im selben Prozess). Die geprüften Funktionen laufen synchron im Test-
 * Thread, also misst `threadCpuUsage` genau sie – in den Pools `forks` und `threads` gleich.
 *
 * Auch CPU-Zeit wächst unter Last etwas (Verlagerung auf Effizienzkerne, Cache-Konkurrenz). Deshalb misst
 * {@link expectCpuBelow} bei einer Überschreitung bis zu `retries`-mal nach und wertet das **Minimum**: Störungen kommen
 * nur hinzu, eine echte Regression liegt in jedem Lauf über der Grenze. Grenzen behalten so ihre fachliche Bedeutung.
 *
 * `MCDA_PERF_SLACK` (Zahl ≥ 1, Standard 1): Faktor auf alle Grenzen, für deutlich langsamere Maschinen (CI).
 * Nur für Laufzeitprüfungen gedacht; Hänger-Schutz (vitest-Timeouts) siehe `slack.ts`.
 */
import { expect } from 'vitest';
import { PERF_SLACK } from './slack.js';

export { DEFAULT_TIMEOUT, HEAVY_TIMEOUT, PERF_SLACK, TIMEOUT_SLACK, hangTimeout } from './slack.js';

/** Laufzeitgrenze in ms mit `MCDA_PERF_SLACK` (auch für Wanduhr-Latenzen, die fachlich Wanduhr sein müssen). */
export function perfBudget(ms: number): number {
  return ms * PERF_SLACK;
}

/** CPU-Zeit des aufrufenden Threads in ms (monoton, nur als Differenz sinnvoll). */
export function threadCpuMs(): number {
  const u = process.threadCpuUsage();
  return (u.user + u.system) / 1000;
}

/** Führt `fn` aus und liefert Ergebnis und CPU-Zeit des Threads in ms. */
export function timeCpu<T>(fn: () => T): { result: T; ms: number } {
  const t0 = threadCpuMs();
  const result = fn();
  return { result, ms: threadCpuMs() - t0 };
}

/** Median der CPU-Zeit über `runs` Läufe (nach `warmup` ungezählten Läufen). */
export function medianCpuMs(fn: (run: number) => unknown, runs: number, warmup = 1): number {
  for (let i = 0; i < warmup; i++) fn(-1 - i);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) times.push(timeCpu(() => fn(i)).ms);
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

/**
 * Prüft, dass `measure()` (eine CPU-Zeit in ms, z. B. von {@link timeCpu} oder {@link medianCpuMs}) unter
 * `limitMs × MCDA_PERF_SLACK` liegt. Liegt die erste Messung darüber, wird bis zu `retries`-mal nachgemessen und das
 * Minimum gewertet. Rückgabe: die erste Messung (für Berichte).
 */
export function expectCpuMsBelow(measure: () => number, limitMs: number, label: string, retries = 3): number {
  const limit = perfBudget(limitMs);
  const first = measure();
  let best = first;
  for (let i = 0; i < retries && best >= limit; i++) best = Math.min(best, measure());
  expect(best, `${label}: CPU ${best.toFixed(0)} ms (erste Messung ${first.toFixed(0)} ms), Grenze ${limit.toFixed(0)} ms`).toBeLessThan(limit);
  return first;
}

/**
 * Führt `fn` aus, prüft seine CPU-Zeit gegen `limitMs` (siehe {@link expectCpuMsBelow}; bei Überschreitung wird `fn`
 * erneut ausgeführt, muss also wiederholbar sein) und liefert das Ergebnis des ersten Laufs samt dessen CPU-Zeit.
 */
export function expectCpuBelow<T>(fn: () => T, limitMs: number, label: string, retries = 3): { result: T; ms: number } {
  const first = timeCpu(fn);
  let n = 0;
  expectCpuMsBelow(() => (n++ === 0 ? first.ms : timeCpu(fn).ms), limitMs, label, retries);
  return first;
}
