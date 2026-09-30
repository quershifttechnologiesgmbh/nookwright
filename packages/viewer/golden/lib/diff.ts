/**
 * Goldene Galerie (P0-A): Pixel-Vergleich zweier Bilder (rein).
 *
 * Ein Pixel gilt als verändert, wenn ein Farbkanal um mehr als `threshold` (0–255) abweicht. Der Renderer ist
 * deterministisch; die Schwelle schluckt nur Rundungsrauschen (Kantenglättung), echte Änderungen – auch leichte
 * Lichtänderungen durch eine neue Laterne – liegen darüber. Das Differenzbild zeigt B abgedunkelt in Grau und
 * veränderte Pixel rot (Helligkeit = Stärke der Abweichung).
 */

export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export interface DiffResult {
  /** Anteil veränderter Pixel in Prozent (100 bei unterschiedlicher Bildgröße) */
  readonly percent: number;
  readonly changed: number;
  readonly total: number;
  /** größte Kanalabweichung */
  readonly maxDelta: number;
  readonly sameSize: boolean;
  /** Differenzbild (nur bei gleicher Größe) */
  readonly image?: { width: number; height: number; data: Uint8Array };
}

export const DEFAULT_THRESHOLD = 16;

export function diffImages(a: Rgba, b: Rgba, threshold = DEFAULT_THRESHOLD, withImage = true): DiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    return { percent: 100, changed: Math.max(a.width * a.height, b.width * b.height), total: Math.max(a.width * a.height, b.width * b.height), maxDelta: 255, sameSize: false };
  }
  const n = a.width * a.height;
  const out = withImage ? new Uint8Array(n * 4) : undefined;
  let changed = 0, maxDelta = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a.data[o]! - b.data[o]!), Math.abs(a.data[o + 1]! - b.data[o + 1]!), Math.abs(a.data[o + 2]! - b.data[o + 2]!), Math.abs(a.data[o + 3]! - b.data[o + 3]!));
    if (d > maxDelta) maxDelta = d;
    const hit = d > threshold;
    if (hit) changed++;
    if (out !== undefined) {
      if (hit) {
        const v = 110 + Math.round((145 * d) / 255);
        out[o] = v; out[o + 1] = 24; out[o + 2] = 24;
      } else {
        const g = Math.round((0.299 * b.data[o]! + 0.587 * b.data[o + 1]! + 0.114 * b.data[o + 2]!) * 0.35);
        out[o] = g; out[o + 1] = g; out[o + 2] = g;
      }
      out[o + 3] = 255;
    }
  }
  return {
    percent: (100 * changed) / n, changed, total: n, maxDelta, sameSize: true,
    ...(out !== undefined ? { image: { width: a.width, height: a.height, data: out } } : {}),
  };
}

/** Verkleinern mit Mittelwert je Zielpixel (Miniaturen des Differenzbilds). */
export function downscale(img: Rgba, width: number): { width: number; height: number; data: Uint8Array } {
  const w = Math.max(1, Math.min(width, img.width));
  const h = Math.max(1, Math.round((img.height * w) / img.width));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, al = 0, n = 0, hot = -1;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const o = (yy * img.width + xx) * 4;
        r += img.data[o]!; g += img.data[o + 1]!; b += img.data[o + 2]!; al += img.data[o + 3]!; n++;
        // markierte (rote) Pixel bleiben in der Miniatur sichtbar
        if (img.data[o]! > img.data[o + 1]! + 60 && (hot < 0 || img.data[o]! > img.data[hot]!)) hot = o;
      }
      const o = (y * w + x) * 4;
      if (hot >= 0) {
        out[o] = img.data[hot]!; out[o + 1] = img.data[hot + 1]!; out[o + 2] = img.data[hot + 2]!; out[o + 3] = 255;
      } else {
        out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(al / n);
      }
    }
  }
  return { width: w, height: h, data: out };
}
