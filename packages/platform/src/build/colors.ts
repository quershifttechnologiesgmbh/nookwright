/**
 * Build: mittlere Texturfarben aus dem Block-Atlas (misode/mcmeta `<v>-atlas`).
 * Enthält einen minimalen PNG-Decoder (8 Bit, RGBA/RGB, ohne Interlacing) – keine Abhängigkeiten.
 * Nur die abgeleiteten Mittelwerte werden weiterverwendet (Ähnlichkeit für Fallback-Ketten), keine Texturen.
 */
import { inflateSync } from 'node:zlib';

export type RGB = readonly [number, number, number];

interface Image {
  width: number;
  height: number;
  /** RGBA, 4 Byte pro Pixel */
  data: Uint8Array;
}

export function decodePng(buf: Uint8Array): Image {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('Keine PNG-Datei');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  while (pos < buf.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(buf[pos + 4]!, buf[pos + 5]!, buf[pos + 6]!, buf[pos + 7]!);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const depth = body[8];
      colorType = body[9] ?? 0;
      const interlace = body[12];
      if (depth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
        throw new Error(`PNG-Format nicht unterstützt (depth=${depth}, colorType=${colorType}, interlace=${interlace})`);
      }
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const pixels = new Uint8Array(width * height * bpp);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      const v = line[x]!;
      let r: number;
      switch (filter) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`Unbekannter PNG-Filter ${filter}`);
      }
      out[x] = r & 0xff;
    }
    prev = out;
  }
  if (bpp === 4) return { width, height, data: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    rgba[j] = pixels[i]!;
    rgba[j + 1] = pixels[i + 1]!;
    rgba[j + 2] = pixels[i + 2]!;
    rgba[j + 3] = 255;
  }
  return { width, height, data: rgba };
}

/** Atlas-Index: `block/<textur>` → [x, y, w, h] */
export type AtlasIndex = Record<string, [number, number, number, number]>;

/** Mittlere Farbe (alpha-gewichtet) je Textur des Atlas. */
export function averageColors(img: Image, index: AtlasIndex): Map<string, RGB> {
  const res = new Map<string, RGB>();
  for (const [key, [x0, y0, w, h]] of Object.entries(index)) {
    // animierte Texturen: nur das erste Frame (quadratisch) nutzen
    const hh = Math.min(h, w);
    let r = 0;
    let g = 0;
    let b = 0;
    let wsum = 0;
    for (let y = y0; y < y0 + hh; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * img.width + x) * 4;
        const a = img.data[i + 3]! / 255;
        if (a === 0) continue;
        r += img.data[i]! * a;
        g += img.data[i + 1]! * a;
        b += img.data[i + 2]! * a;
        wsum += a;
      }
    }
    if (wsum > 0) res.set(key.replace(/^block\//, ''), [r / wsum, g / wsum, b / wsum]);
  }
  return res;
}

const TEXTURE_ALIASES: Record<string, string> = {
  smooth_sandstone: 'sandstone_top',
  smooth_red_sandstone: 'red_sandstone_top',
  smooth_quartz: 'quartz_block_bottom',
  quartz_block: 'quartz_block_side',
  bamboo_block: 'bamboo_block',
};

/** Textur zu einem Blocknamen finden (Heuristik: exakter Name, _side, _front, _top …). */
export function colorOfBlock(block: string, colors: ReadonlyMap<string, RGB>): RGB | undefined {
  const alias = TEXTURE_ALIASES[block];
  const cands = [
    ...(alias ? [alias] : []),
    block,
    `${block}_side`,
    `${block}_front`,
    `${block}_top`,
    block.replace(/_block$/, ''),
    `${block.replace(/_block$/, '')}_side`,
    block.replace(/^waxed_/, ''),
  ];
  for (const c of cands) {
    const hit = colors.get(c);
    if (hit) return hit;
  }
  return undefined;
}

export function toHex(c: RGB): string {
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export function fromHex(h: string): RGB {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Wahrnehmungsnahe Farbdistanz („redmean“), 0 … ~765 */
export function colorDistance(a: RGB, b: RGB): number {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
