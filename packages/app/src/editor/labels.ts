/**
 * Raum-Beschriftungen im Grundriss lesbar halten (Review R1-14: bei 1440 px ~7 px Schrift, „Lager · 2“ überlappte).
 * Rein und testbar; gezeichnet wird in `FloorPlan.tsx`.
 *
 * - Die Zeichenfläche hat feste Pixel (16 je Zelle) und wird per CSS verkleinert. Die Schrift wird deshalb in
 *   Zeichenflächen-Pixeln so groß gewählt, dass sie **angezeigt** mindestens {@link MIN_LABEL_PX} px hat.
 * - Jede Beschriftung muss in das Rechteck ihres Raums passen und darf keine andere überdecken. Sonst die Kurzform
 *   (nur die Anzeige-Nummer), sonst keine – Name und Nummer stehen ohnehin im Panel „Raum“.
 * - Größere Räume werden zuerst beschriftet.
 */

/** Kleinste angezeigte Schriftgröße der Raum-Beschriftung in CSS-Pixeln. */
export const MIN_LABEL_PX = 11;

/** Schriftgröße in Zeichenflächen-Pixeln für eine Anzeige mit `displayScale` (angezeigte Breite / Zeichenbreite). */
export function labelFontPx(displayScale: number, minDisplayPx = MIN_LABEL_PX): number {
  const scale = Number.isFinite(displayScale) && displayScale > 0.05 ? displayScale : 1;
  return Math.max(minDisplayPx, Math.ceil((minDisplayPx / scale) * 10) / 10);
}

/** Raum für die Beschriftung: Zell-Rechteck (einschließlich) und Texte in Vorzugsreihenfolge. */
export interface LabelCandidate {
  readonly key: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** z. B. [„Lager · 2“, „2“] – der erste passende wird genommen. */
  readonly texts: readonly string[];
}

/** Gesetzte Beschriftung: Mittelpunkt und Größe des Hintergrund-Kästchens in Zeichenflächen-Pixeln. */
export interface PlacedLabel {
  readonly key: string;
  readonly text: string;
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
}

const overlaps = (a: PlacedLabel, b: PlacedLabel, gap: number): boolean =>
  Math.abs(a.cx - b.cx) * 2 < a.w + b.w + gap * 2 && Math.abs(a.cy - b.cy) * 2 < a.h + b.h + gap * 2;

/**
 * Beschriftungen setzen: je Raum der erste Text, der mit Innenabstand in das Raum-Rechteck passt und keine gesetzte
 * Beschriftung überdeckt. `measure` misst die Textbreite in Zeichenflächen-Pixeln (Canvas: `measureText`).
 */
export function layoutLabels(candidates: readonly LabelCandidate[], cell: number, fontPx: number, measure: (text: string) => number): PlacedLabel[] {
  const padX = Math.round(fontPx * 0.4);
  const h = Math.ceil(fontPx * 1.35);
  const inset = 2;
  const gap = 2;
  const byArea = [...candidates].sort((a, b) => (b.maxX - b.minX + 1) * (b.maxZ - b.minZ + 1) - (a.maxX - a.minX + 1) * (a.maxZ - a.minZ + 1));
  const placed: PlacedLabel[] = [];
  for (const c of byArea) {
    const boxW = (c.maxX - c.minX + 1) * cell - inset * 2;
    const boxH = (c.maxZ - c.minZ + 1) * cell - inset * 2;
    if (h > boxH) continue;
    const cx = ((c.minX + c.maxX + 1) / 2) * cell;
    const cy = ((c.minZ + c.maxZ + 1) / 2) * cell;
    for (const text of c.texts) {
      const w = Math.ceil(measure(text)) + padX * 2;
      if (w > boxW) continue;
      const label: PlacedLabel = { key: c.key, text, cx, cy, w, h };
      if (placed.some((p) => overlaps(p, label, gap))) continue;
      placed.push(label);
      break;
    }
  }
  return placed;
}
