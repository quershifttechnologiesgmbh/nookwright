/**
 * Minimaler ZIP-Leser (nur Lesen, nur „stored“ und „deflate“) über das Zentralverzeichnis.
 *
 * Warum eigen und nicht Python/PowerShell/JSZip: keine neue Abhängigkeit, plattformunabhängig und rein
 * (Bytes rein, Bytes raus). Das Entpacken wird injiziert (`inflateRaw`): in Node `zlib.inflateRawSync`,
 * im Browser später `DecompressionStream('deflate-raw')` – derselbe Code kann dann ein Nutzer-JAR lokal lesen.
 *
 * Grenzen: kein ZIP64, keine Verschlüsselung, keine mehrteiligen Archive (für ein Minecraft-JAR unnötig).
 * Die Größen stehen im Zentralverzeichnis; Einträge mit Data-Descriptor (Flag-Bit 3, wie im Client-JAR)
 * funktionieren deshalb ohne Sonderfall.
 */
import { crc32 } from './crc32.js';

export interface ZipEntry {
  readonly name: string;
  /** 0 = stored, 8 = deflate */
  readonly method: number;
  readonly flags: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localHeaderOffset: number;
}

export class ZipFormatError extends Error {
  override readonly name = 'ZipFormatError';
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;

const utf8 = new TextDecoder('utf-8');

function view(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Sucht den End-of-Central-Directory-Datensatz (von hinten, max. 64 KiB Kommentar). */
function findEocd(buf: Uint8Array, dv: DataView): number {
  const stop = Math.max(0, buf.length - EOCD_MIN - 0xffff);
  for (let i = buf.length - EOCD_MIN; i >= stop; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD && i + EOCD_MIN + dv.getUint16(i + 20, true) === buf.length) return i;
  }
  throw new ZipFormatError('Kein ZIP-Archiv (End-of-Central-Directory fehlt)');
}

/** Liest das Zentralverzeichnis. Ordner-Einträge (Name endet auf „/“) werden übersprungen. */
export function readZipDirectory(buf: Uint8Array): ZipEntry[] {
  if (buf.length < EOCD_MIN) throw new ZipFormatError('Kein ZIP-Archiv (zu kurz)');
  const dv = view(buf);
  const eocd = findEocd(buf, dv);
  const total = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (total === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ZipFormatError('ZIP64 wird nicht unterstützt');
  if (dv.getUint16(eocd + 4, true) !== 0 || dv.getUint16(eocd + 6, true) !== 0) throw new ZipFormatError('Mehrteilige ZIP-Archive werden nicht unterstützt');
  if (cdOffset + cdSize > eocd) throw new ZipFormatError('Zentralverzeichnis liegt außerhalb des Archivs');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== SIG_CENTRAL) throw new ZipFormatError(`Zentralverzeichnis-Eintrag ${n} ist beschädigt`);
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHeaderOffset = dv.getUint32(p + 42, true);
    const name = utf8.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    entries.push({ name, method, flags, crc32: crc, compressedSize, size, localHeaderOffset });
  }
  return entries;
}

/** Rohdaten (noch komprimiert) eines Eintrags; der lokale Header wird für die Längen neu gelesen. */
export function zipEntryData(buf: Uint8Array, e: ZipEntry): Uint8Array {
  const dv = view(buf);
  const p = e.localHeaderOffset;
  if (p + 30 > buf.length || dv.getUint32(p, true) !== SIG_LOCAL) throw new ZipFormatError(`${e.name}: lokaler Header fehlt`);
  const start = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true);
  const end = start + e.compressedSize;
  if (end > buf.length) throw new ZipFormatError(`${e.name}: Daten reichen über das Archivende`);
  return buf.subarray(start, end);
}

/** Entpackt einen Eintrag und prüft Größe und CRC-32. */
export function extractZipEntry(buf: Uint8Array, e: ZipEntry, inflateRaw: (data: Uint8Array) => Uint8Array): Uint8Array {
  if (e.flags & 0x1) throw new ZipFormatError(`${e.name}: verschlüsselte Einträge werden nicht unterstützt`);
  const raw = zipEntryData(buf, e);
  let out: Uint8Array;
  if (e.method === 0) out = raw;
  else if (e.method === 8) out = inflateRaw(raw);
  else throw new ZipFormatError(`${e.name}: Kompressionsmethode ${e.method} wird nicht unterstützt`);
  if (out.length !== e.size) throw new ZipFormatError(`${e.name}: Größe ${out.length} statt ${e.size}`);
  if (crc32(out) !== e.crc32) throw new ZipFormatError(`${e.name}: CRC-32 stimmt nicht`);
  return out;
}

/** Bequemer Zugriff: Name → Eintrag, Lesen mit injiziertem Entpacker. */
export class ZipArchive {
  private readonly buf: Uint8Array;
  private readonly inflateRaw: (data: Uint8Array) => Uint8Array;
  private readonly byName: ReadonlyMap<string, ZipEntry>;

  constructor(buf: Uint8Array, inflateRaw: (data: Uint8Array) => Uint8Array) {
    this.buf = buf;
    this.inflateRaw = inflateRaw;
    this.byName = new Map(readZipDirectory(buf).map((e) => [e.name, e]));
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Entpackter Inhalt oder `undefined`, wenn es den Eintrag nicht gibt. */
  read(name: string): Uint8Array | undefined {
    const e = this.byName.get(name);
    return e === undefined ? undefined : extractZipEntry(this.buf, e, this.inflateRaw);
  }
}
