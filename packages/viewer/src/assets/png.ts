/**
 * Minimaler PNG-Codec für RGBA8 (rein; zlib wird injiziert: Node `inflateSync`/`deflateSync`).
 *
 * Warum eigen: keine neue Abhängigkeit (kein pngjs/sharp), und der Atlas bleibt ein normales PNG, das der
 * Browser selbst dekodiert (schnell, kompakt) – statt eines 16-MiB-RGBA-Blobs.
 *
 * Dekodieren: alle Farbtypen (Grau, RGB, Palette, Grau+Alpha, RGBA), Bittiefen 1–16, tRNS, Adam7.
 * Kodieren: immer RGBA8 ohne Interlacing, Filter pro Zeile wählbar (Standard: adaptiv).
 */
import { crc32 } from './crc32.js';

/** RGBA8-Bild, Zeilen von oben nach unten, 4 Bytes je Pixel. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** zlib-Stream (RFC 1950) → Bytes bzw. umgekehrt. */
export type ZlibFn = (data: Uint8Array) => Uint8Array;

export type PngFilter = 0 | 1 | 2 | 3 | 4;

export class PngFormatError extends Error {
  override readonly name = 'PngFormatError';
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};
/** Adam7: [x0, y0, dx, dy] je Durchgang */
const ADAM7 = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
] as const;

export function createImage(width: number, height: number): RgbaImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) throw new RangeError(`Ungültige Bildgröße ${width}×${height}`);
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** Ausschnitt als neues Bild (Kopie). */
export function cropImage(img: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  if (x < 0 || y < 0 || x + w > img.width || y + h > img.height) throw new RangeError(`Ausschnitt ${x},${y} ${w}×${h} liegt außerhalb von ${img.width}×${img.height}`);
  const out = createImage(w, h);
  for (let r = 0; r < h; r++) {
    const s = ((y + r) * img.width + x) * 4;
    out.data.set(img.data.subarray(s, s + w * 4), r * w * 4);
  }
  return out;
}

/** Kopiert `src` nach `dst` an (dx, dy), ohne Mischen. */
export function blitImage(dst: RgbaImage, src: RgbaImage, dx: number, dy: number): void {
  if (dx < 0 || dy < 0 || dx + src.width > dst.width || dy + src.height > dst.height) {
    throw new RangeError(`Bild ${src.width}×${src.height} passt nicht an ${dx},${dy} in ${dst.width}×${dst.height}`);
  }
  for (let r = 0; r < src.height; r++) {
    const s = r * src.width * 4;
    dst.data.set(src.data.subarray(s, s + src.width * 4), ((dy + r) * dst.width + dx) * 4);
  }
}

// ------------------------------------------------------------------------------------------ Dekodieren

function u32(b: Uint8Array, p: number): number {
  return ((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Macht die Filter eines (Teil-)Bildes rückgängig. Liefert die Zeilen ohne Filterbyte. */
function unfilter(raw: Uint8Array, offset: number, h: number, stride: number, bpp: number): Uint8Array {
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const src = offset + y * (stride + 1);
    if (src + 1 + stride > raw.length) throw new PngFormatError('Bilddaten sind zu kurz');
    const ft = raw[src]!;
    const o = y * stride;
    const prev = y > 0 ? o - stride : -1;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + 1 + i]!;
      const a = i >= bpp ? out[o + i - bpp]! : 0;
      const b = prev >= 0 ? out[prev + i]! : 0;
      const c = prev >= 0 && i >= bpp ? out[prev + i - bpp]! : 0;
      let v: number;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new PngFormatError(`Unbekannter Filtertyp ${ft}`);
      }
      out[o + i] = v & 0xff;
    }
  }
  return out;
}

interface Header {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly colorType: number;
  readonly interlace: number;
  readonly palette: Uint8Array | undefined;
  readonly trns: Uint8Array | undefined;
}

/** Schreibt die Pixel eines (Teil-)Bildes nach RGBA. */
function writePixels(h: Header, lines: Uint8Array, pw: number, ph: number, stride: number, out: Uint8Array, x0: number, y0: number, dx: number, dy: number): void {
  const { depth, colorType, palette, trns } = h;
  const ch = CHANNELS[colorType]!;
  const max = (1 << depth) - 1;
  const sample = (line: number, x: number, c: number): number => {
    if (depth === 8) return lines[line + x * ch + c]!;
    if (depth === 16) {
      const p = line + (x * ch + c) * 2;
      return (lines[p]! << 8) | lines[p + 1]!;
    }
    const bit = (x * ch + c) * depth;
    return (lines[line + (bit >> 3)]! >> (8 - depth - (bit & 7))) & max;
  };
  const to8 = (v: number): number => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / max));
  const trnsGray = colorType === 0 && trns && trns.length >= 2 ? (trns[0]! << 8) | trns[1]! : -1;
  const trnsRgb = colorType === 2 && trns && trns.length >= 6 ? [(trns[0]! << 8) | trns[1]!, (trns[2]! << 8) | trns[3]!, (trns[4]! << 8) | trns[5]!] : undefined;

  for (let y = 0; y < ph; y++) {
    const line = y * stride;
    for (let x = 0; x < pw; x++) {
      const o = ((y0 + y * dy) * h.width + (x0 + x * dx)) * 4;
      let r: number, g: number, b: number, a = 255;
      switch (colorType) {
        case 0: {
          const v = sample(line, x, 0);
          r = g = b = to8(v);
          if (v === trnsGray) a = 0;
          break;
        }
        case 2: {
          const rv = sample(line, x, 0), gv = sample(line, x, 1), bv = sample(line, x, 2);
          r = to8(rv); g = to8(gv); b = to8(bv);
          if (trnsRgb && rv === trnsRgb[0] && gv === trnsRgb[1] && bv === trnsRgb[2]) a = 0;
          break;
        }
        case 3: {
          const i = sample(line, x, 0);
          if (!palette || i * 3 + 2 >= palette.length) throw new PngFormatError(`Palettenindex ${i} fehlt`);
          r = palette[i * 3]!; g = palette[i * 3 + 1]!; b = palette[i * 3 + 2]!;
          if (trns && i < trns.length) a = trns[i]!;
          break;
        }
        case 4:
          r = g = b = to8(sample(line, x, 0));
          a = to8(sample(line, x, 1));
          break;
        default:
          r = to8(sample(line, x, 0)); g = to8(sample(line, x, 1)); b = to8(sample(line, x, 2));
          a = to8(sample(line, x, 3));
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
}

export function decodePng(bytes: Uint8Array, inflate: ZlibFn): RgbaImage {
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) throw new PngFormatError('Keine PNG-Datei (Signatur fehlt)');
  let width = 0, height = 0, depth = 0, colorType = -1, interlace = 0;
  let palette: Uint8Array | undefined;
  let trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let p = 8;
  let ended = false;
  while (p + 12 <= bytes.length && !ended) {
    const len = u32(bytes, p);
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
    if (p + 12 + len > bytes.length) throw new PngFormatError(`Chunk ${type} ist abgeschnitten`);
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (crc32(bytes.subarray(p + 4, p + 8 + len)) !== u32(bytes, p + 8 + len)) throw new PngFormatError(`Chunk ${type}: CRC-32 stimmt nicht`);
    switch (type) {
      case 'IHDR':
        width = u32(data, 0); height = u32(data, 4); depth = data[8]!; colorType = data[9]!; interlace = data[12]!;
        if (data[10] !== 0 || data[11] !== 0) throw new PngFormatError('Unbekannte Kompression/Filtermethode');
        break;
      case 'PLTE': palette = data; break;
      case 'tRNS': trns = data; break;
      case 'IDAT': idat.push(data); break;
      case 'IEND': ended = true; break;
      default: break; // Zusatz-Chunks (gAMA, sRGB, tEXt …) ignorieren
    }
    p += 12 + len;
  }
  if (colorType < 0) throw new PngFormatError('IHDR fehlt');
  if (!(DEPTHS[colorType] ?? []).includes(depth)) throw new PngFormatError(`Farbtyp ${colorType} mit Bittiefe ${depth} ist ungültig`);
  if (interlace > 1) throw new PngFormatError(`Unbekanntes Interlacing ${interlace}`);
  if (idat.length === 0) throw new PngFormatError('IDAT fehlt');

  const total = idat.reduce((s, c) => s + c.length, 0);
  const z = new Uint8Array(total);
  let o = 0;
  for (const c of idat) { z.set(c, o); o += c.length; }
  const raw = inflate(z);

  const h: Header = { width, height, depth, colorType, interlace, palette, trns };
  const bits = CHANNELS[colorType]! * depth;
  const bpp = Math.max(1, bits >> 3);
  const out = new Uint8Array(width * height * 4);
  const passes = interlace === 0 ? [[0, 0, 1, 1] as const] : ADAM7;
  let off = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bits) / 8);
    const lines = unfilter(raw, off, ph, stride, bpp);
    writePixels(h, lines, pw, ph, stride, out, x0, y0, dx, dy);
    off += ph * (stride + 1);
  }
  return { width, height, data: out };
}

// ------------------------------------------------------------------------------------------ Kodieren

function filterRow(ft: PngFilter, cur: Uint8Array, prev: Uint8Array | undefined, out: Uint8Array, o: number): void {
  out[o] = ft;
  for (let i = 0; i < cur.length; i++) {
    const a = i >= 4 ? cur[i - 4]! : 0;
    const b = prev ? prev[i]! : 0;
    const c = prev && i >= 4 ? prev[i - 4]! : 0;
    const x = cur[i]!;
    let v: number;
    switch (ft) {
      case 0: v = x; break;
      case 1: v = x - a; break;
      case 2: v = x - b; break;
      case 3: v = x - ((a + b) >> 1); break;
      default: v = x - paeth(a, b, c);
    }
    out[o + 1 + i] = v & 0xff;
  }
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export interface EncodeOptions {
  /** Fester Filtertyp für alle Zeilen; Standard: adaptiv (kleinste Summe der Beträge je Zeile). */
  readonly filter?: PngFilter;
}

/** RGBA8-PNG ohne Interlacing. */
export function encodePng(img: RgbaImage, deflate: ZlibFn, opts: EncodeOptions = {}): Uint8Array {
  const { width, height, data } = img;
  if (data.length !== width * height * 4) throw new RangeError(`RGBA-Daten passen nicht zu ${width}×${height}`);
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  const tmp = new Uint8Array(stride + 1);
  for (let y = 0; y < height; y++) {
    const cur = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : undefined;
    const o = y * (stride + 1);
    if (opts.filter !== undefined) {
      filterRow(opts.filter, cur, prev, raw, o);
      continue;
    }
    let best = Infinity;
    for (const ft of [0, 1, 2, 3, 4] as const) {
      filterRow(ft, cur, prev, tmp, 0);
      let sum = 0;
      for (let i = 1; i < tmp.length; i++) { const v = tmp[i]!; sum += v < 128 ? v : 256 - v; }
      if (sum < best) { best = sum; raw.set(tmp, o); }
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', deflate(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of parts) { out.set(c, o); o += c.length; }
  return out;
}
