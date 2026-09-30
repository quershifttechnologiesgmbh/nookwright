/**
 * Stimmung (feat/theme-moods, WFC-Bericht §4 „höhere Dimensionen“): ein kleiner **Gewichtsvektor** über ästhetische
 * Achsen, den ein Theme (`ThemeDef.mood`) oder der Nutzer (`ProjectState.mood`) setzt. Er multipliziert nur
 * **weiche** Größen – Solver-Gewichte `W`, Variantengewichte, Deko-Budgets, Verwitterung/Story-Mischung – wie die
 * „Wald → Ruine“-Stellschraube in WFC. **Spielbarkeit bleibt hart** (Erreichbarkeit, Licht, Pflichtobjekte,
 * Mechanik): keine Achse lockert eine harte Regel.
 *
 * Jede Achse liegt in [−1, 1], 0 = neutral (Faktor genau 1). Vier Achsen, abgeleitet aus den Stil-Tags des Katalogs
 * (`styleTags`: noble/cozy/rustic/ruin/abandoned/overgrown/grim/festive …) und den Variantennamen (plain/grand/full/
 * compact/pair/heap …), siehe `plan/spikes/F_theme_moods.md` §2:
 *
 * | Achse | −1 | +1 | wirkt auf |
 * |---|---|---|---|
 * | `wear` | ordentlich | verwittert | Story-Profil (Moos, Risse, Holz, Farbe), Stil-Tags ruin/abandoned/overgrown/grim |
 * | `richness` | karg | üppig | Deko-Budgets, Dichte optionaler Objekte, Außen-Deko, Varianten full/grand vs. plain/compact |
 * | `formality` | gemütlich | repräsentativ | `W.size`/`W.focal` ↑ bzw. `W.near` ↑ (Gruppe), Stil-Tags noble/sacred vs. cozy/cottage |
 * | `organic` | symmetrisch | organisch | `W.row`/`W.aisle*`/`W.focal` ↓, `W.variety` ↑, Varianten pair/double vs. heap/mixed |
 *
 * Rein und deterministisch: keine Zufallszahl, nur Arithmetik.
 */

/** Achsen der Stimmung in fester Reihenfolge (Schema, UI, Bericht lesen dieselbe Liste). */
export const MOOD_AXES = ['wear', 'richness', 'formality', 'organic'] as const;
export type MoodAxis = (typeof MOOD_AXES)[number];

/** Stimmungsvektor; fehlende Achse = 0 (neutral). */
export type MoodVector = { readonly [K in MoodAxis]?: number | undefined };

/** Deutsche Pole je Achse (−1, +1) – für UI, Engine-Beschreibung und Bericht. */
export const MOOD_POLES: Readonly<Record<MoodAxis, readonly [string, string]>> = {
  wear: ['ordentlich', 'verwittert'],
  richness: ['karg', 'üppig'],
  formality: ['gemütlich', 'repräsentativ'],
  organic: ['symmetrisch', 'organisch'],
};

const clamp1 = (v: number): number => (Number.isFinite(v) ? (v < -1 ? -1 : v > 1 ? 1 : v) : 0);

/** Wert einer Achse, auf [−1, 1] begrenzt; fehlt = 0. */
export const moodAxis = (m: MoodVector | undefined, axis: MoodAxis): number => clamp1(m?.[axis] ?? 0);

/** Achsenweise zusammenführen: spätere Vektoren überschreiben frühere (Theme-Vorgabe, dann Nutzer). */
export function mergeMood(...layers: ReadonlyArray<MoodVector | undefined>): MoodVector {
  const out: Partial<Record<MoodAxis, number>> = {};
  for (const l of layers) {
    if (l === undefined) continue;
    for (const a of MOOD_AXES) if (l[a] !== undefined) out[a] = clamp1(l[a]!);
  }
  return out;
}

/** Alle Achsen 0 (oder fehlend)? Dann sind alle Faktoren genau 1. */
export const isNeutralMood = (m: MoodVector | undefined): boolean => MOOD_AXES.every((a) => moodAxis(m, a) === 0);

/**
 * Exponentieller Hebel `2^(k·v)`: bei v = 0 **genau** 1 (bitgleich), symmetrisch in Faktoren (×2 ↔ ×½) und nie
 * negativ – ein Gewicht kippt nie ins Gegenteil, es wird nur stärker oder schwächer.
 */
export const moodLever = (v: number, k: number): number => (v === 0 ? 1 : 2 ** (k * v));
