/**
 * Stimmung im Einrichtungs-Solver (feat/theme-moods, WFC-Bericht §4.1): der Stimmungsvektor (`@mcda/core` `mood.ts`)
 * multipliziert **nur weiche** Größen – die Gewichte `W` der Bewertung, Variantengewichte, die Stil-Vorliebe bei der
 * Formwahl, Deko-Budgets und die Dichte optionaler Objekte. Harte Regeln (Posen, Erreichbarkeit, Konnektivität,
 * Pflichtobjekte, Mechanik, Licht) sieht dieses Modul nie: Schönheit „kauft“ keine unerreichbare Tür.
 *
 * Fehlt die Stimmung, liefert `solverMood` `undefined` und der Solver nimmt exakt die bisherigen Pfade (bitgleich).
 *
 * Lexika (aus dem Katalog abgeleitet, `plan/spikes/F_theme_moods.md` §2): Stil-Tags der Komponenten (`styleTags`,
 * 413 Komponenten: noble 71, cozy 15, grim 15, overgrown 9, ruin 8, abandoned 5, festive 3 …) und Varianten-IDs
 * (248 Komponenten mit Varianten: plain 14, full 4, grand 3, pair 7, double 7, heap 3, mixed 3 …).
 */
import type { ComponentDef } from '@mcda/catalog';
import { moodAxis, moodLever, type MoodAxis, type MoodVector } from '@mcda/core';

/** Stil-Tags → Pol je Achse (+1 = passt zum positiven Pol, −1 = zum negativen). */
export const MOOD_STYLE_TAGS: Readonly<Record<MoodAxis, Readonly<Record<string, number>>>> = {
  wear: { ruin: 1, abandoned: 1, overgrown: 1, grim: 0.5, noble: -0.5, festive: -1 },
  richness: { festive: 1, noble: 0.5, abandoned: -1, ruin: -0.5 },
  formality: { noble: 1, sacred: 1, martial: 0.5, festive: 0.5, cozy: -1, cottage: -1, village: -0.5, farm: -0.5, tavern: -0.5 },
  organic: { overgrown: 1, cottage: 0.5, elven: 0.5, dwarven: -0.5, sacred: -0.5, noble: -0.5 },
};

/** Varianten-IDs → Pol je Achse (Katalog-Namen; unbekannte Varianten sind neutral). */
export const MOOD_VARIANT_IDS: Readonly<Record<MoodAxis, Readonly<Record<string, number>>>> = {
  wear: { heap: 0.5, pile: 0.5, mixed: 0.5, plain: 0.25, grand: -0.5, framed: -0.5, bordered: -0.5 },
  richness: {
    full: 1, grand: 1, double: 0.5, triple: 1, large: 0.5, mixed: 0.5, heap: 0.5, pile: 0.5, bordered: 0.5, framed: 0.5,
    plain: -1, single: -0.5, small: -0.5, compact: -0.5, simple: -1,
  },
  formality: { grand: 1, bordered: 0.5, framed: 0.5, pair: 0.5, double: 0.25, heap: -0.5, pile: -0.5, mixed: -0.5, plain: -0.25 },
  organic: { mixed: 1, heap: 1, pile: 1, corner: 0.5, pair: -1, double: -0.5, triple: -0.5 },
};

/** Stärke je Hebel (Exponent k in `2^(k·v)`); Werte in §3 des Berichts kalibriert. */
const K = {
  /** Deko-Budget (Programm und Deko-Kinder): üppig ×1,74, karg ×0,57. */
  decor: 0.8,
  /** Dichte optionaler Objekte (`buildProgram`): üppig ×1,41, karg ×0,71. */
  density: 0.5,
  /** Ordnung: Reihe, Gang, Blickpunkt (symmetrisch ×2, organisch ×½). */
  order: 1,
  /** Vielfalts-Wurf der Signatur (organisch ×2). */
  variety: 1,
  /** Repräsentativ: große Signatur, Blickpunkt; gemütlich: Gruppe am Bezugsmöbel. */
  size: 0.6,
  focal: 0.6,
  near: 0.6,
  /** Varianten-Gewicht je Lexikon-Treffer. */
  variant: 1.2,
  /** Top-k-Fenster (organisch breiter, symmetrisch enger). */
  window: 1,
  /** Spiegelpaar: Gewicht je Einheit `organic` (symmetrisch +, organisch −), voll bei ganz gespiegelter Grundfläche. */
  mirror: 5,
} as const;

/** Summe Achse × Pol über ein Lexikon. */
function affinity(m: MoodVector, lex: Readonly<Record<MoodAxis, Readonly<Record<string, number>>>>, keys: readonly string[]): number {
  let s = 0;
  for (const axis of Object.keys(lex) as MoodAxis[]) {
    const v = moodAxis(m, axis);
    if (v === 0) continue;
    for (const k of keys) s += v * (lex[axis][k] ?? 0);
  }
  return s;
}

/** Was der Solver je Raum aus der Stimmung braucht (alles vorab berechnet, rein). */
export interface SolverMood {
  /** Faktor je Gewicht von `W` (fehlende = 1). */
  readonly weights: Readonly<Record<string, number>>;
  /** Faktor auf das Deko-Budget (Programm und Deko-Kinder). */
  readonly decor: number;
  /** Faktor auf die Dichte optionaler Objekte. */
  readonly density: number;
  /** Faktor auf das Top-k-Fenster. */
  readonly window: number;
  /** Stil-Vorliebe einer Komponente (additiv zum Sortierschlüssel bzw. zur Signatur-Wertung; 0 = neutral). */
  readonly style: (def: Pick<ComponentDef, 'styleTags'>) => number;
  /** Faktor auf das Katalog-Gewicht einer Variante. */
  readonly variant: (variantId: string | undefined) => number;
  /** Gewicht des Spiegelpaar-Terms (`mirrorShare`); 0 = aus. Positiv = Spiegelbilder bevorzugt (symmetrisch). */
  readonly mirror: number;
}

/** Solver-Stimmung aus dem Vektor; `undefined` ohne Vektor (bitgleicher Pfad). */
export function solverMood(m: MoodVector | undefined): SolverMood | undefined {
  if (m === undefined) return undefined;
  const organic = moodAxis(m, 'organic');
  const formality = moodAxis(m, 'formality');
  const richness = moodAxis(m, 'richness');
  const order = moodLever(-organic, K.order);
  const focal = order * moodLever(formality, K.focal);
  return {
    weights: {
      row: order, rowLine: order, aisleSide: order, aisleFacing: order, aisleHead: order, aisleForm: order,
      focal, variety: moodLever(organic, K.variety), size: moodLever(formality, K.size),
      near: moodLever(-formality, K.near), nearFacing: moodLever(-formality, K.near),
    },
    decor: moodLever(richness, K.decor),
    density: moodLever(richness, K.density),
    window: moodLever(organic, K.window),
    style: (def) => (def.styleTags === undefined ? 0 : affinity(m, MOOD_STYLE_TAGS, def.styleTags)),
    variant: (id) => (id === undefined ? 1 : moodLever(affinity(m, MOOD_VARIANT_IDS, [id]), K.variant)),
    mirror: -organic * K.mirror,
  };
}

/** Grenzen eines Raums in (x, z) – Spiegelachsen liegen in der Mitte. */
export interface MirrorBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Anteil der Grundzellen `cells`, deren Spiegelbild an der Raummitte (bessere der beiden Achsen x/z) in `partners`
 * liegt (Grundzellen gleicher Komponente, die schon stehen). 0 ohne Partner. Rein; nur weiche Wertung.
 */
export function mirrorShare(cells: ReadonlyArray<readonly [number, number]>, partners: ReadonlySet<string>, b: MirrorBounds): number {
  if (cells.length === 0 || partners.size === 0) return 0;
  let hx = 0;
  let hz = 0;
  for (const [x, z] of cells) {
    if (partners.has(`${b.minX + b.maxX - x},${z}`)) hx++;
    if (partners.has(`${x},${b.minZ + b.maxZ - z}`)) hz++;
  }
  return Math.max(hx, hz) / cells.length;
}

/** Gewichte `W` mit den Faktoren der Stimmung (nur Schlüssel, die `W` hat). */
export function moodWeights<T extends Readonly<Record<string, number>>>(base: T, mood: SolverMood | undefined): T {
  if (mood === undefined) return base;
  const out: Record<string, number> = { ...base };
  for (const [k, f] of Object.entries(mood.weights)) if (k in out) out[k] = out[k]! * f;
  return out as T;
}
