/**
 * Asset-Bündel direkt aus einem Client-JAR – asynchron, rein (kein I/O), Entpacken injiziert.
 *
 * Für den Browser: Die App liest das JAR des Nutzers lokal (Dateiauswahl) und entpackt mit
 * `DecompressionStream('deflate-raw')` bzw. `('deflate')` für PNG-Daten; in Node gehen `zlib.inflateRaw`/`inflate`.
 * Umfang und Bausteine sind dieselben wie in scripts/extract-assets.ts (EXTRACT_SCOPE, buildJsonBundles,
 * firstFrame, buildAtlas, computeBlockFlags); das Ergebnis entspricht atlas.json, blockstates.json,
 * models.json und block-flags.json des Skripts – nur ohne Rohdateien und Farben.
 *
 * Mojang-Daten: Hier wird nichts gespeichert oder gesendet (research/08 §5). Was der Aufrufer damit macht
 * (Vorschau, lokaler Cache), bleibt auf dem Gerät des Nutzers.
 */
import { crc32 } from './crc32.js';
import {
  ASSET_ROOT, buildAtlas, buildJsonBundles, computeBlockFlags, firstFrame, inExtractScope, textureIdOf, textureStats,
  type AtlasIndex, type BlockFlags, type JsonBundle, type TextureStats,
} from './extract.js';
import { PngFormatError, decodePng, type RgbaImage } from './png.js';
import { ZipFormatError, readZipDirectory, zipEntryData, type ZipEntry } from './zip.js';

/** Bytes → Bytes, asynchron (z. B. über `DecompressionStream`). */
export type AsyncBytesFn = (data: Uint8Array) => Promise<Uint8Array>;

export interface AsyncInflate {
  /** Rohes Deflate (RFC 1951) – ZIP-Einträge. */
  readonly inflateRaw: AsyncBytesFn;
  /** zlib-Stream (RFC 1950) – PNG-Bilddaten. */
  readonly inflate: AsyncBytesFn;
}

/** Wie `extractZipEntry`, aber mit asynchronem Entpacker; prüft Größe und CRC-32. */
export async function readZipEntryAsync(buf: Uint8Array, e: ZipEntry, inflateRaw: AsyncBytesFn): Promise<Uint8Array> {
  if (e.flags & 0x1) throw new ZipFormatError(`${e.name}: verschlüsselte Einträge werden nicht unterstützt`);
  const raw = zipEntryData(buf, e);
  let out: Uint8Array;
  if (e.method === 0) out = raw;
  else if (e.method === 8) out = await inflateRaw(raw);
  else throw new ZipFormatError(`${e.name}: Kompressionsmethode ${e.method} wird nicht unterstützt`);
  if (out.length !== e.size) throw new ZipFormatError(`${e.name}: Größe ${out.length} statt ${e.size}`);
  if (crc32(out) !== e.crc32) throw new ZipFormatError(`${e.name}: CRC-32 stimmt nicht`);
  return out;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

/** Verkettete IDAT-Daten (zlib-Stream) einer PNG-Datei; die übrigen Prüfungen macht `decodePng`. */
export function pngIdat(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8 || PNG_SIGNATURE.some((v, i) => bytes[i] !== v)) throw new PngFormatError('Keine PNG-Datei (Signatur fehlt)');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let p = 8; p + 12 <= bytes.length;) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4]!, bytes[p + 5]!, bytes[p + 6]!, bytes[p + 7]!);
    if (p + 12 + len > bytes.length) throw new PngFormatError(`Chunk ${type} ist abgeschnitten`);
    if (type === 'IDAT') {
      parts.push(bytes.subarray(p + 8, p + 8 + len));
      total += len;
    } else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of parts) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** PNG → RGBA8 mit asynchronem zlib (entpackt vorab, dann der synchrone Codec aus png.ts). */
export async function decodePngAsync(bytes: Uint8Array, inflate: AsyncBytesFn): Promise<RgbaImage> {
  const raw = await inflate(pngIdat(bytes));
  return decodePng(bytes, () => raw);
}

/** Angaben aus `version.json` im Wurzelverzeichnis des Client-JARs. */
export interface JarVersionInfo {
  readonly id: string;
  readonly name?: string;
  /** `world_version` = DataVersion */
  readonly dataVersion?: number;
}

export function parseJarVersion(text: string): JarVersionInfo | undefined {
  try {
    const v = JSON.parse(text) as { id?: unknown; name?: unknown; world_version?: unknown };
    if (typeof v.id !== 'string' || !/^[0-9a-z][0-9a-z.\-_ ]*$/i.test(v.id)) return undefined;
    return {
      id: v.id,
      ...(typeof v.name === 'string' ? { name: v.name } : {}),
      ...(typeof v.world_version === 'number' ? { dataVersion: v.world_version } : {}),
    };
  } catch {
    return undefined;
  }
}

export type BundlePhase = 'read' | 'decode' | 'atlas';

export interface BundleOptions {
  /** Gleichzeitige Entpack-Aufträge (Standard 16). */
  readonly concurrency?: number;
  /** Fortschritt je Phase: gelesene Dateien, dekodierte Texturen, Atlas. */
  readonly onProgress?: (phase: BundlePhase, done: number, total: number) => void;
  /** Version, falls `version.json` fehlt (sonst Fehler). */
  readonly fallbackVersion?: string;
}

/** Alles, was die Vorschau (Port `ViewerResources`) aus dem JAR braucht. */
export interface AssetBundle {
  readonly version: string;
  readonly dataVersion?: number;
  readonly atlas: RgbaImage;
  readonly atlasIndex: AtlasIndex;
  readonly blockstates: JsonBundle;
  readonly models: JsonBundle;
  readonly blockFlags: Record<string, BlockFlags>;
  readonly counts: {
    readonly files: number;
    readonly blockstates: number;
    readonly models: number;
    readonly textures: number;
    readonly animated: number;
  };
}

export class NotAClientJarError extends Error {
  override readonly name = 'NotAClientJarError';
}

/** Führt `fn` für alle Elemente aus, höchstens `limit` gleichzeitig. */
async function eachLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/**
 * Client-JAR (Bytes) → Asset-Bündel. Wirft `NotAClientJarError`, wenn das Archiv keine Minecraft-Assets
 * enthält (z. B. ein Server-JAR oder eine Mod), und `ZipFormatError`/`PngFormatError` bei beschädigten Daten.
 * Deterministisch: gleiche Eingabe → gleiches Bündel (unabhängig von der Reihenfolge des Entpackens).
 */
export async function bundleFromJar(bytes: Uint8Array, codec: AsyncInflate, opts: BundleOptions = {}): Promise<AssetBundle> {
  const concurrency = opts.concurrency ?? 16;
  const progress = opts.onProgress ?? (() => undefined);
  const entries = readZipDirectory(bytes);
  const text = new TextDecoder('utf-8');

  const versionEntry = entries.find((e) => e.name === 'version.json');
  const info = versionEntry === undefined ? undefined : parseJarVersion(text.decode(await readZipEntryAsync(bytes, versionEntry, codec.inflateRaw)));
  const version = info?.id ?? opts.fallbackVersion;

  const wanted = entries
    .filter((e) => e.name.startsWith(ASSET_ROOT) && inExtractScope(e.name.slice(ASSET_ROOT.length)))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (!wanted.some((e) => e.name.startsWith(`${ASSET_ROOT}blockstates/`)) || !wanted.some((e) => e.name.startsWith(`${ASSET_ROOT}textures/block/`))) {
    throw new NotAClientJarError('Das Archiv enthält keine Minecraft-Blockmodelle und -Texturen – bitte das Client-JAR wählen (versions/<version>/<version>.jar)');
  }
  if (version === undefined) throw new NotAClientJarError('version.json fehlt im JAR – Version unbekannt');

  // 1. Entpacken
  const files = new Map<string, Uint8Array>();
  let read = 0;
  progress('read', 0, wanted.length);
  await eachLimit(wanted, concurrency, async (e) => {
    files.set(e.name.slice(ASSET_ROOT.length), await readZipEntryAsync(bytes, e, codec.inflateRaw));
    progress('read', ++read, wanted.length);
  });

  // 2. Bündel für deepslate (sortiert, also unabhängig von der Entpack-Reihenfolge)
  const jsonFiles = [...files].filter(([rel]) => rel.endsWith('.json')).map(([rel, d]) => [rel, text.decode(d)] as const);
  const { blockstates, models } = buildJsonBundles(jsonFiles);

  // 3. Texturen: erstes Animationsbild + Statistik
  const pngs = [...files].filter(([rel]) => textureIdOf(rel) !== undefined);
  const textures = new Map<string, RgbaImage>();
  const stats = new Map<string, TextureStats>();
  let animated = 0;
  let decoded = 0;
  progress('decode', 0, pngs.length);
  await eachLimit(pngs, concurrency, async ([rel, data]) => {
    const id = textureIdOf(rel)!;
    const metaBytes = files.get(`${rel}.mcmeta`);
    const meta = metaBytes === undefined ? undefined : (JSON.parse(text.decode(metaBytes)) as unknown);
    const full = await decodePngAsync(data, codec.inflate);
    const img = firstFrame(full, meta);
    if (img !== full) animated++;
    textures.set(id, img);
    stats.set(id, textureStats(img));
    progress('decode', ++decoded, pngs.length);
  });

  // 4. Atlas (packt deterministisch nach Größe und ID) und Block-Flags
  progress('atlas', 0, 1);
  const { image, index } = buildAtlas(version, textures);
  const blockFlags = computeBlockFlags(blockstates, models, (id) => stats.get(id));
  progress('atlas', 1, 1);

  return {
    version,
    ...(info?.dataVersion !== undefined ? { dataVersion: info.dataVersion } : {}),
    atlas: image,
    atlasIndex: index,
    blockstates,
    models,
    blockFlags,
    counts: {
      files: files.size,
      blockstates: Object.keys(blockstates).length,
      models: Object.keys(models).length,
      textures: textures.size,
      animated,
    },
  };
}
