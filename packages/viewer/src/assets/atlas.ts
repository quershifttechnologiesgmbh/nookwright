/**
 * Texturatlas: Packen (Regal-Verfahren, deterministisch), UV-Berechnung, Zusammensetzen. Rein.
 *
 * Der Atlas ist quadratisch mit Zweierpotenz-Kante: WebGL 1 braucht das für Mipmaps, und deepslate
 * nimmt EINE Pixelgröße (`getPixelSize`) für u und v.
 */
import { blitImage, createImage, type RgbaImage } from './png.js';

export interface AtlasRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface AtlasItem {
  readonly id: string;
  readonly w: number;
  readonly h: number;
}

export interface AtlasLayout {
  /** Kantenlänge in Pixeln (Zweierpotenz) */
  readonly size: number;
  readonly rects: Readonly<Record<string, AtlasRect>>;
}

/** [u0, v0, u1, v1] normiert auf 0..1, v nach unten (Zeile 0 = oben), wie deepslate es erwartet. */
export type UV = [number, number, number, number];

const nextPow2 = (n: number): number => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

function shelfPack(sorted: readonly AtlasItem[], size: number): Record<string, AtlasRect> | undefined {
  const rects: Record<string, AtlasRect> = {};
  let x = 0, y = 0, shelf = 0;
  for (const it of sorted) {
    if (x + it.w > size) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    if (y + it.h > size || it.w > size) return undefined;
    rects[it.id] = { x, y, w: it.w, h: it.h };
    x += it.w;
    shelf = Math.max(shelf, it.h);
  }
  return rects;
}

/**
 * Packt Rechtecke in ein möglichst kleines Quadrat (Zweierpotenz). Reihenfolge: Höhe ↓, Breite ↓, ID ↑ –
 * damit ist das Ergebnis unabhängig von der Eingabereihenfolge.
 */
export function packAtlas(items: readonly AtlasItem[], opts: { readonly maxSize?: number } = {}): AtlasLayout {
  const maxSize = opts.maxSize ?? 8192;
  const seen = new Set<string>();
  let area = 0, maxSide = 1;
  for (const it of items) {
    if (seen.has(it.id)) throw new Error(`Textur doppelt im Atlas: ${it.id}`);
    if (!Number.isInteger(it.w) || !Number.isInteger(it.h) || it.w < 1 || it.h < 1) throw new RangeError(`Ungültige Texturgröße ${it.id}: ${it.w}×${it.h}`);
    seen.add(it.id);
    area += it.w * it.h;
    maxSide = Math.max(maxSide, it.w, it.h);
  }
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let size = nextPow2(Math.max(maxSide, Math.ceil(Math.sqrt(area)))); size <= maxSize; size *= 2) {
    const rects = shelfPack(sorted, size);
    if (rects) return { size, rects };
  }
  throw new Error(`Texturen passen nicht in einen Atlas mit höchstens ${maxSize}×${maxSize} Pixeln`);
}

export function atlasUv(r: AtlasRect, size: number): UV {
  return [r.x / size, r.y / size, (r.x + r.w) / size, (r.y + r.h) / size];
}

/** Setzt die Bilder an ihre Plätze; Pixel ohne Textur bleiben transparent. */
export function composeAtlas(layout: AtlasLayout, images: ReadonlyMap<string, RgbaImage>): RgbaImage {
  const out = createImage(layout.size, layout.size);
  for (const [id, r] of Object.entries(layout.rects)) {
    const img = images.get(id);
    if (img === undefined) throw new Error(`Bild für ${id} fehlt`);
    if (img.width !== r.w || img.height !== r.h) throw new Error(`${id}: Bild ${img.width}×${img.height}, Platz ${r.w}×${r.h}`);
    blitImage(out, img, r.x, r.y);
  }
  return out;
}

/** Schwarz-magentafarbene Ersatztextur (wie im Spiel) für fehlende Texturen. */
export function missingTexture(size = 16): RgbaImage {
  const img = createImage(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const magenta = (x < half) === (y < half);
      const o = (y * size + x) * 4;
      img.data[o] = magenta ? 248 : 0;
      img.data[o + 1] = 0;
      img.data[o + 2] = magenta ? 248 : 0;
      img.data[o + 3] = 255;
    }
  }
  return img;
}
