/**
 * Schichten beim Zusammenführen (plan/01 §6.1) und die Merge-Regel.
 *
 * Die Zahl ist die Priorität: höhere Schichten werden später gemergt und dürfen niedrigere
 * nur in den erlaubten Fällen überschreiben. Eine unerlaubte Überschreibung ist ein Fehler
 * des Solvers bzw. der Materialisierung (Assertion) und kein stiller Konflikt.
 */

export const Layer = {
  /** Terrain / Höhle – überschreibt nichts */
  Terrain: 1,
  /** Struktur (Wand, Boden, Decke, Dach) – überschreibt Terrain */
  Structure: 2,
  /** Architektur-Komponenten (Tür, Fenster, Kamin, Nische) – Struktur nur in `carve`-Zellen */
  Architecture: 3,
  /** Boden-Overlays – ersetzen Bodenblöcke */
  FloorOverlay: 4,
  /** Möbel und Deko – nur Luft */
  Furniture: 5,
  /** Anbauteile an Flächen – nur Luft oder DÜNN-kompatibel */
  Attachment: 6,
  /** Dekorateure – nur Varianten derselben Rolle */
  Decorator: 7,
} as const;

export type Layer = (typeof Layer)[keyof typeof Layer];

/** Schicht-Wert einer nie beschriebenen (leeren) Zelle. */
export const NO_LAYER = 0;

export const LAYERS: readonly Layer[] = [1, 2, 3, 4, 5, 6, 7];

export function isLayer(n: number): n is Layer {
  return Number.isInteger(n) && n >= Layer.Terrain && n <= Layer.Decorator;
}

/**
 * Freigabe für die kontextabhängigen Fälle aus §6.1, die nur der Aufrufer beurteilen kann:
 * - `carve`: Zelle liegt in der carve-Maske einer Architektur-Komponente
 * - `floor`: überschriebener Block ist ein Bodenblock
 * - `thin`: Ziel ist DÜNN-kompatibel (Anbauteil)
 * - `variant`: neuer Zustand ist eine Variante derselben Rolle (Dekorateur)
 */
export type Permit = 'carve' | 'floor' | 'thin' | 'variant';

export interface LayerRule {
  /** Niedrigere Schichten, deren Nicht-Luft-Blöcke diese Schicht ersetzen darf … */
  readonly replaces: readonly Layer[];
  /** … und die dafür nötige Freigabe (fehlt = ohne Bedingung). */
  readonly permit?: Permit;
}

/** §6.1 als Daten (nur Nicht-Luft; Luft einer niedrigeren Schicht darf jede höhere Schicht überschreiben). */
export const LAYER_RULES: Readonly<Record<Layer, LayerRule>> = {
  [Layer.Terrain]: { replaces: [] },
  [Layer.Structure]: { replaces: [Layer.Terrain] },
  [Layer.Architecture]: { replaces: [Layer.Structure], permit: 'carve' },
  [Layer.FloorOverlay]: { replaces: [Layer.Structure], permit: 'floor' },
  [Layer.Furniture]: { replaces: [] },
  [Layer.Attachment]: {
    replaces: [Layer.Terrain, Layer.Structure, Layer.Architecture, Layer.FloorOverlay, Layer.Furniture], permit: 'thin',
  },
  [Layer.Decorator]: {
    replaces: [Layer.Terrain, Layer.Structure, Layer.Architecture, Layer.FloorOverlay, Layer.Furniture, Layer.Attachment],
    permit: 'variant',
  },
};

/** Was in einer Zelle liegt (für die Merge-Regel). `layer` 0 = leer. */
export interface Occupant {
  readonly layer: Layer | typeof NO_LAYER;
  readonly owner: string | undefined;
  readonly air: boolean;
}

/** Was geschrieben werden soll. */
export interface Incoming {
  readonly layer: Layer;
  readonly owner: string;
  readonly permit?: Permit;
}

/**
 * Merge-Regel: `undefined`, wenn `incoming` die Zelle überschreiben darf, sonst der Grund.
 * 1. Leere Zellen darf jede Schicht beschreiben.
 * 2. Dieselbe Herkunft darf ihre eigene Zelle in gleicher oder höherer Schicht neu schreiben.
 * 3. Gleiche oder niedrigere Schicht einer anderen Herkunft: nie (Überlappung = Solver-Fehler).
 * 4. Höhere Schicht: Luft immer; Nicht-Luft nur laut `LAYER_RULES` (ggf. mit Freigabe).
 */
export function overwriteConflict(existing: Occupant, incoming: Incoming): string | undefined {
  if (existing.layer === NO_LAYER) return undefined;
  if (existing.owner === incoming.owner && incoming.layer >= existing.layer) return undefined;
  if (incoming.layer <= existing.layer) {
    return `Schicht ${incoming.layer} darf Schicht ${existing.layer} (Herkunft ${existing.owner}) nicht überschreiben`;
  }
  if (existing.air) return undefined; // höhere Schicht (≥ Struktur) über Luft
  const rule = LAYER_RULES[incoming.layer];
  if (!rule.replaces.includes(existing.layer)) {
    return `Schicht ${incoming.layer} darf Blöcke der Schicht ${existing.layer} nicht ersetzen (nur ${rule.replaces.length > 0 ? rule.replaces.join('/') : 'Luft'})`;
  }
  if (rule.permit !== undefined && incoming.permit !== rule.permit) {
    return `Schicht ${incoming.layer} braucht die Freigabe '${rule.permit}', um Schicht ${existing.layer} zu ersetzen`;
  }
  return undefined;
}
