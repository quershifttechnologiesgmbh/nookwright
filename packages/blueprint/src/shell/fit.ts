/**
 * Breiten-Klemme im Auflösungsraster (research/30 K5, Vorbild Blenders `Clamp Overlap`): Anbauteile,
 * Bordüren und Wandvorlagen dürfen sich nicht überlappen. Bei uns ist „Bevel“ keine Geometrieverschiebung,
 * sondern eine **Breitenwahl** in ganzen Blöcken – dieselbe Rechnung an drei Stellen (Bordüre, Wandvorlage,
 * Konsole), deshalb hier einmal zentral.
 */

/**
 * Breite eines Bandes so klemmen, dass zu beiden Nachbarn mindestens `minGap` frei bleibt.
 *
 * @param width gewünschte Breite in Blöcken (≥ 0)
 * @param runs  freie Strecken links und rechts bis zum nächsten Anbauteil bzw. zur Wand (≥ 0)
 * @param minGap Mindestabstand, der auf jeder Seite bleiben muss (Standard 0 = nur nicht überlappen)
 * @returns nutzbare Breite: höchstens die halbe kleinere freie Strecke, nie negativ
 */
export function clampBevel(width: number, runs: readonly number[], minGap = 0): number {
  if (width <= 0 || runs.length === 0) return 0;
  const room = Math.min(...runs) - minGap;
  return Math.max(0, Math.min(Math.floor(width), Math.floor(room / 2)));
}

/** Passt ein Band der Breite `width` mit `minGap` auf beiden Seiten in die freien Strecken? */
export function bevelFits(width: number, runs: readonly number[], minGap = 0): boolean {
  return clampBevel(width, runs, minGap) >= Math.min(Math.floor(width), Math.max(0, width));
}
