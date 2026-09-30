/**
 * W8-F: Zeilen der Statusleiste ohne Laufzeit. Laufzeiten („234 ms“) schwanken von Lauf zu Lauf; sichtbarer Text bleibt
 * deshalb gleich für gleiche Eingaben (wie die Vorschlagskarten seit W8-D), die Dauer steht nur im Tooltip.
 */

/** Blockzahl, Theme, Version und dunkle Stellen der Vorschau – ohne Zeitangabe. */
export function previewStatsText(r: { readonly blocks: number; readonly themeName: string; readonly version: string; readonly darkCells: number }): string {
  return `${r.blocks} Blöcke · ${r.themeName} · Minecraft ${r.version} · ${r.darkCells === 0 ? 'keine dunklen Stellen' : `${r.darkCells} dunkle Zellen`}`;
}

/** Tooltip mit der gemessenen Dauer, `undefined` ohne Messung. */
export function durationTitle(label: string, ms: number | undefined): string | undefined {
  return ms === undefined ? undefined : `${label}: ${Math.round(ms)} ms`;
}

/** W11-B: „Licht +5“ war Jargon – jetzt „5 Lichter ergänzt“ (leer bei 0). */
export function lightAddedText(added: number): string {
  return added <= 0 ? '' : `${added} ${added === 1 ? 'Licht' : 'Lichter'} ergänzt`;
}

/**
 * W11-B: entfernte Treppen mit Etagen statt interner ID („Treppe s12 entfernt“ → „Treppe EG → 1. OG entfernt“).
 * `floorName` wie überall in der App (`floorLabel`).
 */
export function stairsRemovedText(links: ReadonlyArray<{ readonly floorIndex: number }>, floorName: (index: number) => string): string {
  if (links.length === 0) return '';
  const names = links.map((l) => `${floorName(l.floorIndex)} → ${floorName(l.floorIndex + 1)}`).join(', ');
  return `${links.length === 1 ? 'Treppe' : 'Treppen'} ${names} entfernt (passt nicht mehr – Rückgängig holt sie zurück)`;
}

/**
 * W11-B: Rückgängig/Wiederholen nennen, was zurückgenommen wird („Rückgängig: Raum gemalt und eingerichtet“) – vorher
 * stand nur „Rückgängig · 2 Räume neu eingerichtet“. Erklärende Zusätze der ursprünglichen Meldung („ – …“, „(…)“)
 * entfallen.
 */
export function undoText(kind: 'Rückgängig' | 'Wiederholt', action: string | undefined): string {
  const what = action?.replace(/\s+–\s.*$/, '').replace(/\s*\([^()]*\)\s*$/, '').trim();
  return what === undefined || what === '' ? kind : `${kind}: ${what}`;
}
