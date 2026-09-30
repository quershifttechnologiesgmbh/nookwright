/**
 * Stil-Kennzahlen (LV-1…LV-23, KM1…KM9): messen die Regeln aus `plan/spikes/LV_builderstile.md` §5 und
 * `plan/spikes/LV_tiefe_detail.md` Kap. 5.4 als Zahlen an beliebiger Generator-Ausgabe. Rein, ändert nichts.
 */
export { measureStyle, measureEnsemble, reportOf, reportToJson, reportToMarkdown, formatNumber } from './report.js';
export type { StyleMeasurement, StyleReport } from './report.js';
export type { StyleInput, StylePlacement } from './scene.js';
export { METRIC_DEFS as STYLE_METRIC_DEFS, UNMEASURABLE as STYLE_UNMEASURABLE } from './targets.js';
export { judge as judgeMetric } from './types.js';
export type { Light as MetricLight, MetricDef, MetricResult, MetricTarget, Reliability, TargetOrigin } from './types.js';
