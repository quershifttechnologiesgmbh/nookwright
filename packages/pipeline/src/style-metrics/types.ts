/**
 * Typen der Stil-Kennzahlen: Kennzahl-Definition (Ziel, Ampel-Toleranz, Verlässlichkeit), Messwert und Bericht.
 * Rein – nur Datentypen und die Ampel-Regel.
 */

export type Light = 'green' | 'yellow' | 'red' | 'na';

/** Verlässlichkeit der Messung selbst (nicht des Ziels): hoch = direkt und eindeutig, niedrig = Näherung. */
export type Reliability = 'hoch' | 'mittel' | 'niedrig';

/** Herkunft des Zielwerts: Quelle im Plan (`plan`), aus einer einzelnen Referenz abgeleitet (`ref`) oder eigene Schätzung (`own`). */
export type TargetOrigin = 'plan' | 'ref' | 'own';

export interface MetricTarget {
  readonly min?: number;
  readonly max?: number;
  /** Gelb, wenn der Wert höchstens so weit (in Einheiten des Werts) außerhalb der Grenze liegt; darüber Rot. */
  readonly slack: number;
  /** Zielwert als Text (Markdown-Tabelle). */
  readonly text: string;
  readonly origin: TargetOrigin;
}

export interface MetricDef {
  /** `LV-1a`, `KM3` … */
  readonly id: string;
  /** Regel in den Plänen: `LV-1` … `LV-23`, `KM1` … `KM9`. */
  readonly rule: string;
  readonly name: string;
  readonly unit: string;
  readonly target: MetricTarget;
  readonly reliability: Reliability;
  /** Warum diese Verlässlichkeit, was die Messung annähert (eine Zeile). */
  readonly note: string;
}

export type Detail = number | string | boolean | null;

/** Rohmessung einer Kennzahl an einer Szene; `weight` = Stichprobengröße (für den gewichteten Mittelwert). */
export interface Measure {
  readonly value: number | null;
  readonly weight: number;
  readonly details?: Readonly<Record<string, Detail>>;
}

export type Measures = Readonly<Record<string, Measure>>;

export interface MetricResult {
  readonly id: string;
  readonly rule: string;
  readonly name: string;
  readonly unit: string;
  readonly value: number | null;
  readonly weight: number;
  readonly light: Light;
  readonly target: string;
  readonly reliability: Reliability;
  readonly details: Readonly<Record<string, Detail>>;
}

/** Ampel nach Zielbereich: innerhalb = grün, bis `slack` daneben = gelb, sonst rot; ohne Wert = na. */
export function judge(value: number | null, t: MetricTarget): Light {
  if (value === null || !Number.isFinite(value)) return 'na';
  const eps = 1e-9;
  let miss = 0;
  if (t.min !== undefined && value < t.min - eps) miss = Math.max(miss, t.min - value);
  if (t.max !== undefined && value > t.max + eps) miss = Math.max(miss, value - t.max);
  if (miss === 0) return 'green';
  return miss <= t.slack + eps ? 'yellow' : 'red';
}
