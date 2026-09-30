/**
 * Messung und Bericht der Stil-Kennzahlen: `measureStyle` misst eine Ausgabe (Bau, Ensemble, Einzelraum), `reportOf`
 * fasst mehrere Messungen zu einem Bericht mit Ampel je Regel zusammen (gewichtetes Mittel), `reportToJson` und
 * `reportToMarkdown` geben ihn aus. Rein: kein I/O, keine Zufallszahlen.
 */
import { measureCohesion } from './cohesion.js';
import { measureFacade } from './facade.js';
import { measureInterior } from './interior.js';
import { ensembleMeasures, measureMassing, type BuildingSummary } from './massing.js';
import { buildScene, type StyleInput } from './scene.js';
import { measureTerrain } from './terrain.js';
import { METRIC_DEFS, UNMEASURABLE } from './targets.js';
import { judge, type Detail, type Light, type Measure, type Measures, type MetricResult } from './types.js';

/** Messung einer einzelnen Ausgabe. */
export interface StyleMeasurement {
  readonly id: string;
  readonly label: string;
  readonly buildingType?: string;
  readonly themeId?: string;
  readonly seed?: number;
  /** Anzahl erkannter Baukörper. */
  readonly buildings: number;
  readonly measures: Measures;
  readonly summaries: readonly BuildingSummary[];
}

/** Misst alle Kennzahlen an einer Ausgabe. Verändert weder Hülle noch Volumen. */
export function measureStyle(input: StyleInput): StyleMeasurement {
  const scene = buildScene(input);
  const massing = measureMassing(scene);
  const measures: Record<string, Measure> = {
    ...measureFacade(scene),
    ...massing.measures,
    ...ensembleMeasures(massing.summaries),
    ...measureTerrain(scene, input),
    ...measureInterior(scene, input),
    ...measureCohesion(scene),
  };
  return {
    id: input.id, label: input.label ?? input.id,
    ...(input.buildingType !== undefined ? { buildingType: input.buildingType } : {}),
    ...(input.themeId !== undefined ? { themeId: input.themeId } : {}),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    buildings: scene.buildings.length, measures, summaries: massing.summaries,
  };
}

/**
 * Ensemble aus mehreren einzeln erzeugten Bauten (Dorf-Ersatz: der Generator erzeugt kein Dorf in einem Volumen):
 * nur die Silhouetten-Kennzahlen LV-13b/c über alle Baukörper zusammen; alles andere bleibt bei den Einzelmessungen.
 */
export function measureEnsemble(id: string, parts: readonly StyleMeasurement[], label = id): StyleMeasurement {
  const summaries = parts.flatMap((p) => p.summaries);
  return { id, label, buildings: summaries.length, measures: ensembleMeasures(summaries), summaries };
}

export interface StyleReport {
  readonly title: string;
  /** Anzahl zusammengefasster Messungen. */
  readonly inputs: number;
  readonly buildings: number;
  readonly metrics: readonly MetricResult[];
  readonly counts: Readonly<Record<Light, number>>;
  readonly unmeasurable: readonly { readonly rule: string; readonly name: string; readonly why: string }[];
}

/** Gewichteter Mittelwert; ohne Gewichte das einfache Mittel. */
function combine(parts: readonly Measure[]): { value: number | null; weight: number; details: Record<string, Detail> } {
  const have = parts.filter((p) => p.value !== null && Number.isFinite(p.value));
  if (have.length === 0) return { value: null, weight: 0, details: {} };
  let wsum = 0, acc = 0;
  for (const p of have) { wsum += p.weight; acc += (p.value as number) * p.weight; }
  const value = wsum > 0 ? acc / wsum : have.reduce((a, p) => a + (p.value as number), 0) / have.length;
  const sums = new Map<string, { s: number; n: number }>();
  const texts = new Map<string, Detail>();
  for (const p of have) {
    for (const [k, v] of Object.entries(p.details ?? {})) {
      if (typeof v === 'number') { const e = sums.get(k) ?? { s: 0, n: 0 }; e.s += v; e.n++; sums.set(k, e); } else if (!texts.has(k)) texts.set(k, v);
    }
  }
  const details: Record<string, Detail> = { samples: have.length };
  for (const [k, e] of [...sums].sort((a, b) => (a[0] < b[0] ? -1 : 1))) details[k] = round(e.s / e.n);
  for (const [k, v] of [...texts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) details[k] = v;
  return { value, weight: wsum, details };
}

const round = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;

/** Fasst Messungen zu einem Bericht zusammen (je Kennzahl gewichtetes Mittel, Ampel nach Zielbereich). */
export function reportOf(measurements: readonly StyleMeasurement[], title = 'Stil-Kennzahlen'): StyleReport {
  const counts: Record<Light, number> = { green: 0, yellow: 0, red: 0, na: 0 };
  const metrics: MetricResult[] = METRIC_DEFS.map((d) => {
    const c = combine(measurements.map((m) => m.measures[d.id]).filter((x): x is Measure => x !== undefined));
    const value = c.value === null ? null : round(c.value);
    const light = judge(value, d.target);
    counts[light]++;
    return { id: d.id, rule: d.rule, name: d.name, unit: d.unit, value, weight: round(c.weight, 1), light, target: d.target.text, reliability: d.reliability, details: c.details };
  });
  return { title, inputs: measurements.length, buildings: measurements.reduce((a, m) => a + m.buildings, 0), metrics, counts, unmeasurable: UNMEASURABLE };
}

/** Stabile JSON-Ausgabe (Schlüsselreihenfolge fest, 2 Leerzeichen Einrückung, Zeilenende LF). */
export function reportToJson(report: StyleReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const LIGHT_TEXT: Readonly<Record<Light, string>> = { green: 'grün', yellow: 'gelb', red: 'rot', na: '–' };

/** Zahl deutsch (Komma), höchstens 2 Nachkommastellen. */
export function formatNumber(v: number | null): string {
  if (v === null) return '–';
  const s = (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)).replace(/\.?0+$/, '');
  return s.replace('.', ',');
}

/** Lesbare Markdown-Tabelle mit Ampel je Regel. */
export function reportToMarkdown(report: StyleReport): string {
  const lines: string[] = [];
  lines.push(`### ${report.title}`, '');
  lines.push(`${report.inputs} Messung(en), ${report.buildings} Baukörper. Ampel: grün ${report.counts.green}, gelb ${report.counts.yellow}, rot ${report.counts.red}, nicht anwendbar ${report.counts.na}.`, '');
  lines.push('| Ampel | Kennzahl | Regel | Wert | Ziel | n | Verlässlichkeit |', '| --- | --- | --- | ---: | --- | ---: | --- |');
  for (const r of report.metrics) {
    lines.push(`| ${LIGHT_TEXT[r.light]} | ${r.id} | ${r.name} | ${formatNumber(r.value)} | ${r.target} | ${formatNumber(r.weight)} | ${r.reliability} |`);
  }
  lines.push('', 'Nicht messbar: ' + report.unmeasurable.map((u) => `${u.rule} (${u.name})`).join(', ') + '.', '');
  return lines.join('\n');
}
