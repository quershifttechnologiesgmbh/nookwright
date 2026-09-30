/**
 * Test-Hilfen: Pfad zum lokalen Client-JAR (Tests damit laufen nur, wenn es vorhanden ist – CI hat keine
 * Mojang-Assets), ein Mini-ZIP-Schreiber und ein unabhängiger PNG-Bauer für beliebige Farbtypen.
 * Alle Testdaten hier sind selbst erzeugt; aus dem JAR wird nichts in Fixtures kopiert.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, deflateSync, inflateRawSync } from 'node:zlib';
import { crc32 } from '../src/assets/crc32.js';
import { ZipArchive } from '../src/assets/zip.js';

export const JAR_PATH = fileURLToPath(new URL('../../../local/mc-client/1.21.11/client.jar', import.meta.url));
/** `MCDA_SKIP_JAR=1` simuliert eine Umgebung ohne JAR (wie CI). */
export const HAS_JAR = !process.env['MCDA_SKIP_JAR'] && existsSync(JAR_PATH);

let jar: ZipArchive | undefined;
/** Das lokale JAR (einmal gelesen); nur aufrufen, wenn `HAS_JAR`. */
export function localJar(): ZipArchive {
  jar ??= new ZipArchive(toU8(readFileSync(JAR_PATH)), (d) => toU8(inflateRawSync(d)));
  return jar;
}

/** Node-Buffer → schlichte Uint8Array-Sicht (ohne Kopie), damit Vergleiche mit Uint8Array gelingen. */
export function toU8(b: Uint8Array): Uint8Array {
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

// ------------------------------------------------------------------------------------------ ZIP

export interface ZipFileSpec {
  readonly name: string;
  readonly data: Uint8Array;
  /** 0 = stored, 8 = deflate */
  readonly method?: 0 | 8;
  /** Größen erst im Data-Descriptor (Flag-Bit 3) – wie im Minecraft-JAR */
  readonly descriptor?: boolean;
}

/** Minimaler ZIP-Schreiber (nur für Tests). */
export function makeZip(files: readonly ZipFileSpec[], comment = ''): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const name = enc.encode(f.name);
    const method = f.method ?? 8;
    const body = method === 8 ? new Uint8Array(deflateRawSync(f.data)) : f.data;
    const crc = crc32(f.data);
    const flags = f.descriptor ? 0x8 : 0;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, f.descriptor ? 0 : crc, true);
    lv.setUint32(18, f.descriptor ? 0 : body.length, true);
    lv.setUint32(22, f.descriptor ? 0 : f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const desc = new Uint8Array(f.descriptor ? 16 : 0);
    if (f.descriptor) {
      const dv = new DataView(desc.buffer);
      dv.setUint32(0, 0x08074b50, true);
      dv.setUint32(4, crc, true);
      dv.setUint32(8, body.length, true);
      dv.setUint32(12, f.data.length, true);
    }
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, body, desc);
    central.push(cd);
    offset += local.length + body.length + desc.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const com = enc.encode(comment);
  const eocd = new Uint8Array(22 + com.length);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, com.length, true);
  eocd.set(com, 22);
  return concat([...parts, ...central, eocd]);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ------------------------------------------------------------------------------------------ PNG

export interface RawPngSpec {
  readonly width: number;
  readonly height: number;
  readonly colorType: 0 | 2 | 3 | 4 | 6;
  readonly depth: 1 | 2 | 4 | 8 | 16;
  readonly interlace?: boolean;
  readonly palette?: readonly (readonly [number, number, number])[];
  readonly trns?: readonly number[];
  /** Samples je Pixel in Rohwerten der Bittiefe (Anzahl = Kanäle des Farbtyps) */
  readonly pixel: (x: number, y: number) => readonly number[];
}

const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const;
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Baut ein PNG direkt aus Rohwerten (Filter 0) – unabhängig vom Codec unter Test. */
export function makeRawPng(s: RawPngSpec): Uint8Array {
  const ch = CH[s.colorType];
  const bits = ch * s.depth;
  const passes = s.interlace ? ADAM7 : [[0, 0, 1, 1] as const];
  const rows: number[] = [];
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((s.width - x0) / dx), ph = Math.ceil((s.height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bits) / 8);
    for (let py = 0; py < ph; py++) {
      const line = new Uint8Array(stride);
      let bit = 0;
      for (let px = 0; px < pw; px++) {
        const samples = s.pixel(x0 + px * dx, y0 + py * dy);
        for (const v of samples) {
          if (s.depth === 16) { line[bit >> 3] = v >> 8; line[(bit >> 3) + 1] = v & 255; }
          else if (s.depth === 8) line[bit >> 3] = v;
          else line[bit >> 3]! |= v << (8 - s.depth - (bit & 7));
          bit += s.depth;
        }
      }
      rows.push(0, ...line);
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, s.width);
  dv.setUint32(4, s.height);
  ihdr[8] = s.depth; ihdr[9] = s.colorType; ihdr[12] = s.interlace ? 1 : 0;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr)];
  if (s.palette) parts.push(pngChunk('PLTE', Uint8Array.from(s.palette.flat())));
  if (s.trns) parts.push(pngChunk('tRNS', Uint8Array.from(s.trns)));
  const z = new Uint8Array(deflateSync(Uint8Array.from(rows)));
  // IDAT absichtlich in zwei Chunks aufgeteilt
  const cut = Math.floor(z.length / 2);
  parts.push(pngChunk('IDAT', z.subarray(0, cut)), pngChunk('IDAT', z.subarray(cut)), pngChunk('IEND', new Uint8Array(0)));
  return concat(parts);
}
