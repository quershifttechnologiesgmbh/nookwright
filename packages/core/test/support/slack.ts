/**
 * Lastfaktoren für Tests (ohne vitest-Abhängigkeit, damit auch `vitest.config.ts` sie nutzt).
 *
 * - `MCDA_PERF_SLACK` (≥ 1, Standard 1): Faktor auf Laufzeitgrenzen (siehe `timing.ts`), z. B. für langsame CI-Maschinen.
 * - `MCDA_TIMEOUT_SLACK` (≥ 1, Standard 1): Faktor auf die vitest-Timeouts.
 *
 * vitest-Timeouts sind reiner Hänger-Schutz, keine Laufzeitprüfung (die steht als eigene Erwartung im Test). Zwei Stufen:
 * {@link DEFAULT_TIMEOUT} für alle Tests ohne eigenen Wert, {@link HEAVY_TIMEOUT} für schwere Tests (ganze Welten, Fuzz,
 * Matrizen). Unter Fremdlast (Load 50–80 auf 14 Kernen) dauern Tests bis ~10× so lang wie allein; beobachtet: leichte
 * Tests ≤ 40 s, schwere ≤ 150 s. Beide Stufen haben darüber noch mehrfachen Puffer.
 */
function factor(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return 1;
  const f = Number(raw);
  if (!Number.isFinite(f) || f < 1) throw new Error(`${name} muss eine Zahl ≥ 1 sein, ist '${raw}'`);
  return f;
}

/** Faktor aus `MCDA_PERF_SLACK`. */
export const PERF_SLACK = factor('MCDA_PERF_SLACK');

/** Faktor aus `MCDA_TIMEOUT_SLACK`. */
export const TIMEOUT_SLACK = factor('MCDA_TIMEOUT_SLACK');

/** Hänger-Schutz in ms, skaliert mit `MCDA_TIMEOUT_SLACK`. */
export function hangTimeout(ms: number): number {
  return ms * TIMEOUT_SLACK;
}

/** Standard-Timeout (Tests und Hooks ohne eigenen Wert). */
export const DEFAULT_TIMEOUT = hangTimeout(120_000);

/** Timeout schwerer Tests. */
export const HEAVY_TIMEOUT = hangTimeout(600_000);
