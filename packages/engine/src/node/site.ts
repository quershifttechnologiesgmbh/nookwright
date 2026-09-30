/**
 * Statische Website (W1: eine App): liefert das gebaute Website-Verzeichnis (`website/dist`: Startseite, Galerie,
 * KI-Architekt, Editor unter `editor/`) vom selben Ursprung wie die Engine-API aus. Nur node:fs, kein Framework.
 *
 * - Nur GET/HEAD; der Server ruft das Modul nur für Pfade außerhalb von `/v1/` und `/healthz` auf.
 * - `/` → `index.html`, `/editor/` → `editor/index.html`; Verzeichnis ohne Schrägstrich → 301 auf `…/`, ohne
 *   `index.html` → 404. Kein Verzeichnis-Listing.
 * - Pfad-Sicherheit: Segmente einzeln dekodiert; abgelehnt werden `..`, `.`, leere Segmente, führende Punkte
 *   (`.env`, `.git`), `/` `\` `:` und Steuerzeichen nach dem Dekodieren (`%2e%2e`, `%2f`, `%5c`, `%00`). Die Datei muss
 *   nach Auflösen aller Symlinks unter `dir` liegen (kein Symlink nach außen).
 * - Streaming über eine geöffnete Datei (Größe und Inhalt aus demselben Handle), ETag → 304.
 * - Cache: HTML `no-cache` (verweist auf gehashte Dateien), `editor/assets/` ein Jahr `immutable` (Vite-Hash im
 *   Namen), sonst 5 Minuten.
 * - Sicherheits-Header auf jeder Antwort ({@link SITE_HEADERS}); der Editor läuft im iframe desselben Ursprungs.
 * - Komprimierung nur für Text ({@link COMPRESSIBLE}, ab 1 KiB): `Accept-Encoding` → br, sonst gzip, sonst roh;
 *   `vary: Accept-Encoding` auf jeder Antwort dieser Typen.
 * - Vorkomprimiert (W7-H): liegt neben der Datei `<datei>.br` bzw. `<datei>.gz` ({@link PRECOMPRESSED_EXT}, vom Build
 *   `website/scripts/precompress.mjs` mit Brotli 11 / gzip 9 erzeugt), geht diese Datei unverändert hinaus – ohne
 *   Rechenzeit und kleiner als die Laufzeit-Stufe. Nur, wenn sie eine reguläre Datei unter der Wurzel ist, nicht älter
 *   als das Original und kleiner; sonst (oder ohne Build-Schritt) wie folgt zur Laufzeit.
 * - Laufzeit-Komprimierung: bis 8 MiB im Speicher komprimiert (mit `content-length`) und in einem LRU-Cache nach
 *   Bytes gehalten (Schlüssel: Kodierung, Pfad, Größe, mtime – eine geänderte Datei wird neu komprimiert; gleichzeitige
 *   erste Anfragen komprimieren nur einmal). Größere Dateien gestreamt (chunked, ohne Cache). Stufen gemessen am Editor-Hauptchunk (2,6 MiB → br 595 KiB, plan/spikes/W1A_server.md): Brotli 7, weil
 *   10 (≈ 1 s) und 11 (≈ 2,5 s) die erste Anfrage bremsen und 9 kaum kleiner ist; so bleibt der erste Abruf auch auf
 *   langsamen Servern deutlich unter 1 s.
 */
import { realpathSync } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, createBrotliCompress, createGzip, gzip } from 'node:zlib';
// 404-Seite mit Pflicht-Hinweis (HANDOFF §1): eine Quelle auch für `dist/404.html` des Builds (Vercel)
import { NOT_FOUND_PAGE } from './notFoundPage.js';

export { NOT_FOUND_PAGE };

export interface SiteOptions {
  /** Gebautes Website-Verzeichnis (Startskript: `ENGINE_WEB_DIR`, Standard `website/dist`). */
  readonly dir: string;
  /** Speicher für komprimierte Dateien in Bytes (LRU; Standard 32 MiB, 0 = kein Cache). Ein Eintrag höchstens ¼ davon. */
  readonly compressCacheBytes?: number;
}

/** Inhaltskodierung einer Antwort der Website (ohne = roh). */
export type SiteEncoding = 'br' | 'gzip';

/** Zähler des Komprimier-Caches (für `/healthz` und Tests). */
export interface SiteCacheStats {
  readonly entries: number;
  readonly bytes: number;
  /** Aus dem Cache bzw. an eine laufende Komprimierung derselben Datei angehängt. */
  readonly hits: number;
  /** Neu komprimiert. */
  readonly misses: number;
  /** Aus einer vorkomprimierten Datei (`.br`/`.gz` des Builds) beantwortet – ohne Cache und ohne Rechenzeit. */
  readonly precompressed: number;
}

export interface SiteHandler {
  (req: IncomingMessage, res: ServerResponse): Promise<void>;
  stats(): SiteCacheStats;
}

/** Endungen, die komprimiert werden (Text). Bilder, Schriften und Minecraft-Exporte sind schon komprimiert. */
export const COMPRESSIBLE: ReadonlySet<string> = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.txt']);

/** Endung der vorkomprimierten Datei je Kodierung (wie `SIDECAR` in `website/scripts/precompress.mjs`). */
export const PRECOMPRESSED_EXT: Readonly<Record<SiteEncoding, string>> = { br: '.br', gzip: '.gz' };

/** Content-Type je Endung; Unbekanntes als `application/octet-stream` (mit `nosniff` nie als HTML/Skript gedeutet). */
export const SITE_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  // Minecraft-Exporte der Galerie
  '.litematic': 'application/octet-stream',
  '.schem': 'application/octet-stream',
  '.nbt': 'application/octet-stream',
};

/** Auf jeder Antwort der Website (auch 301/304/404). */
export const SITE_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'content-security-policy': "frame-ancestors 'self'",
};

const HTML_NO_CACHE = 'no-cache';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const MODERATE = 'public, max-age=300';
/** Längster Pfad (Zeichen, roh); längere Anfragen sind nie eine Datei der Website. */
const MAX_PATH = 1024;
/** Verboten in einem dekodierten Segment: Trenner, Laufwerks-/Stream-Doppelpunkt, Steuerzeichen. */
const BAD_SEGMENT = /[/\\:\u0000-\u001f\u007f]/;

/** Kleinere Dateien roh (Kopf und Rechenzeit lohnen nicht). */
const MIN_COMPRESS = 1024;
/** Bis zu dieser Größe im Speicher komprimieren (mit Länge, cachebar); darüber gestreamt. */
const MAX_BUFFERED = 8 * 1024 * 1024;
const DEFAULT_CACHE_BYTES = 32 * 1024 * 1024;
/**
 * Stufen im Speicher (einmal je Datei, dann Cache) und beim Streamen (je Anfrage, daher günstiger). Brotli 7: erster
 * Abruf des Editor-Hauptchunks nach Serverstart 0,11–0,14 s (Apple M5); Stufe 9 wäre 0,8 % kleiner, aber 0,20–0,37 s.
 */
const BROTLI_QUALITY = 7;
const BROTLI_STREAM_QUALITY = 5;
const GZIP_LEVEL = 9;
const GZIP_STREAM_LEVEL = 6;
const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const brotliParams = (quality: number, size: number): Record<number, number> => ({
  [zlibConstants.BROTLI_PARAM_QUALITY]: quality,
  [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
  [zlibConstants.BROTLI_PARAM_SIZE_HINT]: size,
});

/**
 * `Accept-Encoding` → gewählte Kodierung: höchster q-Wert von br und gzip (`x-gzip`, `*` zählen mit), bei Gleichstand
 * br; q=0 schließt aus. `undefined` = roh (auch bei `identity` oder unbekannten Kodierungen).
 */
export function negotiateEncoding(header: string | undefined): SiteEncoding | undefined {
  if (header === undefined || header.trim() === '') return undefined;
  const q = new Map<string, number>();
  for (const part of header.toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((s) => s.trim());
    if (name === undefined || name === '') continue;
    let v = 1;
    for (const p of params) {
      const m = /^q\s*=\s*(.*)$/.exec(p);
      // qvalue nach RFC 9110 (0 … 1, höchstens 3 Nachkommastellen); ungültig → nicht annehmbar
      if (m !== null) v = /^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(m[1]!) ? Number(m[1]) : 0;
    }
    q.set(name, v);
  }
  const of = (coding: string, alias?: string): number => q.get(coding) ?? (alias !== undefined ? q.get(alias) : undefined) ?? q.get('*') ?? 0;
  const br = of('br');
  const gz = of('gzip', 'x-gzip');
  if (br > 0 && br >= gz) return 'br';
  if (gz > 0) return 'gzip';
  return undefined;
}

/**
 * Roher Anfragepfad (`req.url`) → dekodierte Segmente, `slash` = endet auf `/`; `undefined` bei allem, was keine
 * Datei der Website sein kann. Arbeitet bewusst auf dem rohen Pfad (nicht auf `new URL(…).pathname`, das `..` und
 * `%2e%2e` still wegnormalisiert und `%2f` stehen lässt).
 */
export function sitePath(rawUrl: string): { readonly segments: readonly string[]; readonly slash: boolean } | undefined {
  const path = rawUrl.split(/[?#]/, 1)[0] ?? '';
  if (!path.startsWith('/') || path.length > MAX_PATH) return undefined;
  const parts = path.slice(1).split('/');
  const segments: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i]!;
    if (raw === '') {
      if (i === parts.length - 1) break; // abschließender Schrägstrich
      return undefined; // `//`: leeres Segment
    }
    let s: string;
    try {
      s = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (s.startsWith('.') || BAD_SEGMENT.test(s)) return undefined;
    segments.push(s);
  }
  return { segments, slash: path.endsWith('/') };
}

/** Cache-Regel je Datei (Pfad relativ zur Wurzel, mit `/`). */
export function siteCacheControl(rel: string): string {
  if (extname(rel) === '.html') return HTML_NO_CACHE;
  if (rel.startsWith('editor/assets/')) return IMMUTABLE;
  return MODERATE;
}

/**
 * Handler für GET/HEAD auf die Website. Antwortet immer selbst (200, 301, 304 oder 404). Das Verzeichnis muss beim
 * Anlegen existieren (sonst Fehler beim Start statt 404 auf jede Anfrage).
 */
export function siteHandler(opts: SiteOptions): SiteHandler {
  const root = realpathSync(opts.dir);
  const cacheBytes = opts.compressCacheBytes ?? DEFAULT_CACHE_BYTES;
  /** LRU: Einfügereihenfolge der Map, Treffer werden ans Ende gesetzt. */
  const cache = new Map<string, Buffer>();
  const inflight = new Map<string, Promise<Buffer>>();
  const counts = { bytes: 0, hits: 0, misses: 0, precompressed: 0 };
  const remember = (key: string, body: Buffer): void => {
    if (body.length > cacheBytes / 4) return;
    cache.set(key, body);
    counts.bytes += body.length;
    for (const [k, v] of cache) {
      if (counts.bytes <= cacheBytes) break;
      cache.delete(k);
      counts.bytes -= v.length;
    }
  };
  /** Datei komprimiert (Cache → laufende Komprimierung → neu); nur Dateien bis MAX_BUFFERED. */
  const compressed = (fh: FileHandle, file: string, size: number, mtimeMs: number, enc: SiteEncoding): Promise<Buffer> => {
    const key = `${enc}\u0000${size}\u0000${mtimeMs}\u0000${file}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      counts.hits += 1;
      cache.delete(key);
      cache.set(key, hit);
      return Promise.resolve(hit);
    }
    const running = inflight.get(key);
    if (running !== undefined) {
      counts.hits += 1;
      return running;
    }
    counts.misses += 1;
    const job = (async () => {
      const raw = await fh.readFile();
      const body = enc === 'br'
        ? await brotliAsync(raw, { params: brotliParams(BROTLI_QUALITY, raw.length) })
        : await gzipAsync(raw, { level: GZIP_LEVEL });
      // Datei zwischen stat und Lesen geändert → Schlüssel passt nicht zum Inhalt: nicht cachen
      if (raw.length === size) remember(key, body);
      return body;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  };
  const inside = (p: string): boolean => p === root || p.startsWith(root + sep);
  /** Realer Pfad (Symlinks aufgelöst), nur wenn er existiert und unter der Wurzel liegt. */
  const resolveInside = async (p: string): Promise<string | undefined> => {
    try {
      const real = await realpath(p);
      return inside(real) ? real : undefined;
    } catch {
      return undefined;
    }
  };

  /**
   * Vorkomprimierte Fassung von `file` (`file` ist schon aufgelöst): geöffnet mit Größe, wenn sie eine reguläre Datei
   * unter der Wurzel ist, nicht älter als das Original (sonst womöglich veraltet) und kleiner; sonst `undefined`.
   */
  const precompressedFile = async (file: string, original: { size: number; mtimeMs: number }, enc: SiteEncoding): Promise<{ fh: FileHandle; size: number } | undefined> => {
    const sidecar = await resolveInside(file + PRECOMPRESSED_EXT[enc]);
    if (sidecar === undefined) return undefined;
    let fh: FileHandle | undefined;
    try {
      fh = await open(sidecar, 'r');
      const st = await fh.stat();
      if (st.isFile() && st.mtimeMs >= original.mtimeMs && st.size < original.size) return { fh, size: st.size };
    } catch {
      // nicht lesbar: wie ohne vorkomprimierte Datei
    }
    await fh?.close().catch(() => undefined);
    return undefined;
  };

  const notFound = (res: ServerResponse, head: boolean): void => {
    res.writeHead(404, { ...SITE_HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': String(Buffer.byteLength(NOT_FOUND_PAGE)) });
    res.end(head ? undefined : NOT_FOUND_PAGE);
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const head = req.method === 'HEAD';
    const rawUrl = req.url ?? '/';
    const parsed = sitePath(rawUrl);
    if (parsed === undefined) return notFound(res, head);
    let file = await resolveInside(join(root, ...parsed.segments));
    if (file === undefined) return notFound(res, head);
    let rel = parsed.segments.join('/');
    try {
      if ((await stat(file)).isDirectory()) {
        // Verzeichnis ohne index.html: 404 wie eine fehlende Datei (verrät nicht, dass es das Verzeichnis gibt)
        file = await resolveInside(join(file, 'index.html'));
        if (file === undefined) return notFound(res, head);
        if (!parsed.slash) {
          // `/editor` → `/editor/`, damit relative Pfade (Vite `--base ./`) im Verzeichnis auflösen
          const q = rawUrl.indexOf('?');
          const query = q >= 0 && /^[\x21-\x7e]*$/.test(rawUrl.slice(q)) ? rawUrl.slice(q) : '';
          const location = `/${parsed.segments.map(encodeURIComponent).join('/')}/${query}`;
          res.writeHead(301, { ...SITE_HEADERS, location, 'cache-control': HTML_NO_CACHE, 'content-length': '0' });
          res.end();
          return;
        }
        rel = rel === '' ? 'index.html' : `${rel}/index.html`;
      } else if (parsed.slash) {
        return notFound(res, head); // Datei mit abschließendem Schrägstrich
      }
    } catch {
      return notFound(res, head);
    }

    let fh;
    try {
      fh = await open(file, 'r');
    } catch {
      return notFound(res, head);
    }
    try {
      const st = await fh.stat();
      if (!st.isFile()) return notFound(res, head);
      const ext = extname(file).toLowerCase();
      const compressible = COMPRESSIBLE.has(ext);
      // Schwaches ETag für alle Kodierungen derselben Datei (gleicher Inhalt; Caches trennen über Vary)
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      const headers = {
        ...SITE_HEADERS,
        'content-type': SITE_TYPES[ext] ?? 'application/octet-stream',
        'cache-control': siteCacheControl(rel),
        etag,
        'last-modified': st.mtime.toUTCString(),
        ...(compressible ? { vary: 'Accept-Encoding' } : {}),
      };
      const match = req.headers['if-none-match'];
      if (match !== undefined && match.split(',').some((t) => t.trim() === etag || t.trim() === '*')) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      const enc = compressible && st.size >= MIN_COMPRESS ? negotiateEncoding(req.headers['accept-encoding']) : undefined;
      const pre = enc === undefined ? undefined : await precompressedFile(file, st, enc);
      if (pre !== undefined && enc !== undefined) {
        try {
          counts.precompressed += 1;
          res.writeHead(200, { ...headers, 'content-encoding': enc, 'content-length': String(pre.size) });
          if (head) {
            res.end();
            return;
          }
          await pipeline(pre.fh.createReadStream({ start: 0, autoClose: false }), res);
          return;
        } finally {
          await pre.fh.close().catch(() => undefined);
        }
      }
      if (enc !== undefined && st.size > MAX_BUFFERED) {
        // Große Textdatei: beim Senden komprimieren (chunked, ohne Länge), nicht cachen
        res.writeHead(200, { ...headers, 'content-encoding': enc });
        if (head) {
          res.end();
          return;
        }
        const z = enc === 'br' ? createBrotliCompress({ params: brotliParams(BROTLI_STREAM_QUALITY, st.size) }) : createGzip({ level: GZIP_STREAM_LEVEL });
        await pipeline(fh.createReadStream({ start: 0, autoClose: false }), z, res);
        return;
      }
      if (enc !== undefined) {
        const body = await compressed(fh, file, st.size, st.mtimeMs, enc);
        if (body.length < st.size) {
          res.writeHead(200, { ...headers, 'content-encoding': enc, 'content-length': String(body.length) });
          res.end(head ? undefined : body);
          return;
        }
      }
      res.writeHead(200, { ...headers, 'content-length': String(st.size) });
      if (head) {
        res.end();
        return;
      }
      // start: 0 – readFile beim Komprimieren hat die Position des Handles verschoben
      await pipeline(fh.createReadStream({ start: 0, autoClose: false }), res);
    } catch {
      // Client weg oder Lesefehler nach dem Kopf: Verbindung schließen (Länge stimmt sonst nicht)
      if (!res.headersSent) return notFound(res, head);
      res.destroy();
    } finally {
      await fh.close().catch(() => undefined);
    }
  };
  return Object.assign(handler, { stats: (): SiteCacheStats => ({ entries: cache.size, ...counts }) });
}
