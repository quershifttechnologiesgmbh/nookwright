/**
 * Web-App (W1-A): Website und Engine-API auf einem Ursprung. Statische Auslieferung (Content-Types, Cache,
 * Sicherheits-Header, HEAD, ETag), Pfad-Ausbruch, Same-Origin-POST, Zugriffsmodi (lokal, Schlüssel, öffentlich) mit
 * Rate-Limit je IP und Tagesbudget. Offline (lokaler Klassifikator), Port 0, Fake-Website im Temp-Verzeichnis.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants, gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PRECOMPRESSED_EXT, SITE_HEADERS, SITE_TYPES, apiKeyLine, engineServer, generateApiKey, negotiateEncoding, parseApiKeys, siteCacheControl, sitePath,
  type AccessLogEntry, type InterpretOptions, type ServerOptions, type SiteCacheStats,
} from '../src/node/index.js';
import { EXPORT_DISCLAIMER } from '@mcda/pipeline';
import { DEFAULT_PUBLIC_NL_DAILY, publicDailyBudget } from '../src/node/launch.js';
import { engine } from './fixture.js';

/** Temp-Wurzel: `secret.txt` und `package.json` liegen AUSSERHALB der Website (`site/`). */
const tmp = mkdtempSync(join(tmpdir(), 'engine-web-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const SECRET = 'GEHEIM-ausserhalb-der-website';
writeFileSync(join(tmp, 'package.json'), `{"secret":"${SECRET}"}`);
writeFileSync(join(tmp, 'secret.txt'), SECRET);
const site = join(tmp, 'site');
/** Gut komprimierbarer Text wie ein Vite-Chunk (~320 KB, deterministisch). */
const jsText = (tag: string): string =>
  Array.from({ length: 4000 }, (_, i) => `export const ${tag}${i} = { id: ${i}, name: "block_${(i * 7919) % 1000}", hash: "${((i * 2654435761) >>> 0).toString(16)}" };`).join('\n');
const BIG_JS = jsText('v');
/** 8 KiB, die sich gut komprimieren ließen – bei diesen Typen trotzdem nie komprimieren. */
const FILLER = Buffer.alloc(8 * 1024, 0x41);
const files: Record<string, string | Buffer> = {
  'editor/assets/index-Big123.js': BIG_JS,
  'editor/assets/style-Big123.css': `.a{color:red}\n`.repeat(400),
  'media/gross.svg': `<svg xmlns="http://www.w3.org/2000/svg">${'<rect width="1" height="1"/>'.repeat(200)}</svg>`,
  'media/foto.png': FILLER,
  'media/foto.jpg': FILLER,
  'fonts/schrift.woff2': FILLER,
  'gallery/files/gross.litematic': FILLER,
  'gallery/files/gross.schem': FILLER,
  'gallery/files/gross.nbt': FILLER,
  'index.html': '<!doctype html><h1>Startseite</h1>',
  'editor/index.html': '<!doctype html><h1>Editor</h1>',
  'editor/assets/index-AbC123.js': 'export const editor = 1;',
  'css/site.css': 'body{margin:0}',
  'js/site.js': 'console.log(1)',
  'js/worker.mjs': 'export {}',
  'gallery/index.json': '[]',
  'gallery/files/haus.litematic': Buffer.from([0x1f, 0x8b, 0x08, 0x00]),
  'gallery/files/haus.schem': Buffer.from([0x1f, 0x8b]),
  'gallery/files/haus.nbt': Buffer.from([0x0a, 0x00]),
  'gallery/files/haus.litematic.b64.txt': 'H4sIAA==',
  'media/bild.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  'media/bild.jpg': Buffer.from([0xff, 0xd8, 0xff]),
  'media/bild.webp': Buffer.from('RIFF'),
  'media/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  'fonts/inter.woff2': Buffer.from('wOF2'),
  'media/gross.bin': Buffer.alloc(1024 * 1024 + 7, 0x41),
  'scenes/base.json': '{}',
  // Punktdateien innerhalb der Website: nie ausliefern
  '.env': `OPENROUTER_API_KEY=${SECRET}`,
  '.git/config': `[core] ${SECRET}`,
  'editor/.hidden.js': SECRET,
};
for (const [p, content] of Object.entries(files)) {
  mkdirSync(join(site, p, '..'), { recursive: true });
  writeFileSync(join(site, p), content);
}
// Symlinks: nach außen (verboten) und nach innen (erlaubt).
// Windows ohne Entwicklermodus/Adminrechte darf keine Symlinks anlegen (EPERM): Nur dort werden die Symlink-Fälle
// übersprungen; die Sicherheits-Eigenschaft prüfen POSIX und CI. Jeder andere Fehler (und EPERM auf POSIX) bleibt rot.
function trySymlink(target: string, path: string, type?: 'dir' | 'file'): boolean {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (e) {
    if (process.platform === 'win32' && (e as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw e;
  }
}
const SYMLINKS =
  trySymlink(join(tmp, 'secret.txt'), join(site, 'raus.txt'), 'file') &&
  trySymlink(tmp, join(site, 'rausdir'), 'dir') &&
  trySymlink(join(site, 'css/site.css'), join(site, 'drinnen.css'), 'file');
if (!SYMLINKS) console.warn('web.test: Symlinks unter Windows nicht erlaubt (EPERM) – Symlink-Fälle übersprungen, geprüft auf POSIX/CI.');

const LOCAL_NL: InterpretOptions = { apiKey: '', model: 'local', mode: 'local' };
const KEY = generateApiKey();
const apiKeys = parseApiKeys(apiKeyLine('alice', KEY));

async function start(opts: ServerOptions): Promise<{ base: string; port: number; stop: () => Promise<void> }> {
  const server = engineServer(engine, opts);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, port, stop: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

interface Raw { readonly status: number; readonly headers: IncomingHttpHeaders; readonly body: Buffer; readonly text: string }
/** Rohe Anfrage: Pfad wird unverändert gesendet (fetch/URL würden `..` wegnormalisieren), Host/Origin frei. */
function raw(base: string, path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Raw> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: u.hostname, port: u.port, path, method: opts.method ?? 'GET', headers: opts.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text: body.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

const json = { 'content-type': 'application/json' };
const interpretBody = JSON.stringify({ prompt: 'kleine Taverne mit Garten' });
const describe_ = (base: string, headers: Record<string, string>, body = interpretBody): Promise<Raw> =>
  raw(base, '/v1/interpret', { method: 'POST', headers: { ...json, ...headers }, body });

describe('sitePath: roher Pfad → Segmente', () => {
  it('normale Pfade, Verzeichnisse, Query', () => {
    expect(sitePath('/')).toEqual({ segments: [], slash: true });
    expect(sitePath('/editor/')).toEqual({ segments: ['editor'], slash: true });
    expect(sitePath('/editor/index.html?embed=1&describe=Haus')).toEqual({ segments: ['editor', 'index.html'], slash: false });
    expect(sitePath('/gallery/Burg%20Nord.json')).toEqual({ segments: ['gallery', 'Burg Nord.json'], slash: false });
  });

  it('lehnt Ausbruch, Punktsegmente, kodierte Trenner, NUL und Steuerzeichen ab', () => {
    for (const p of [
      '/../package.json', '/a/../../package.json', '/%2e%2e/package.json', '/%2E%2E/package.json', '/.%2e/x', '/./index.html',
      '/editor/..%2f..%2fpackage.json', '/editor/%2f', '/..\\package.json', '/editor%5c..%5c..%5cpackage.json', '/%00', '/index.html%00.js',
      '/.env', '/.git/config', '/editor/.hidden.js', '//etc/passwd', '/a//b', '/%', '/%zz', '/C:/Windows', '/x%0d%0ay', 'relativ', `/${'a'.repeat(1100)}`,
    ]) {
      expect(sitePath(p), p).toBeUndefined();
    }
  });

  it('Cache-Regeln', () => {
    expect(siteCacheControl('index.html')).toBe('no-cache');
    expect(siteCacheControl('editor/index.html')).toBe('no-cache');
    expect(siteCacheControl('editor/manifest.json')).toBe('public, max-age=300'); // keine Sonderregel mehr (R1-18)
    expect(siteCacheControl('editor/assets/index-AbC123.js')).toMatch(/immutable/);
    expect(siteCacheControl('gallery/index.json')).toBe('public, max-age=300');
  });
});

describe('Website ausliefern (lokaler Modus)', () => {
  let s: Awaited<ReturnType<typeof start>>;
  afterAll(() => s.stop());

  it('/ und /editor/ liefern index.html; /editor → 301 auf /editor/ (Query bleibt)', async () => {
    s = await start({ site: { dir: site }, interpret: LOCAL_NL });
    const home = await raw(s.base, '/');
    expect(home.status).toBe(200);
    expect(home.text).toContain('Startseite');
    expect(home.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(home.headers['cache-control']).toBe('no-cache');
    for (const [k, v] of Object.entries(SITE_HEADERS)) expect(home.headers[k], k).toBe(v);
    expect(home.headers['content-security-policy']).toBe("frame-ancestors 'self'");
    const editor = await raw(s.base, '/editor/');
    expect(editor.status).toBe(200);
    expect(editor.text).toContain('Editor');
    expect((await raw(s.base, '/editor/index.html?embed=1')).text).toContain('Editor');
    const redirect = await raw(s.base, '/editor?embed=1');
    expect(redirect.status).toBe(301);
    expect(redirect.headers.location).toBe('/editor/?embed=1');
  });

  it('Content-Types je Endung und Cache-Regeln', async () => {
    const expected: Record<string, string> = {
      '/index.html': 'text/html; charset=utf-8', '/js/site.js': 'text/javascript; charset=utf-8', '/js/worker.mjs': 'text/javascript; charset=utf-8',
      '/css/site.css': 'text/css; charset=utf-8', '/gallery/index.json': 'application/json; charset=utf-8', '/media/bild.png': 'image/png',
      '/media/bild.jpg': 'image/jpeg', '/media/bild.webp': 'image/webp', '/media/logo.svg': 'image/svg+xml', '/fonts/inter.woff2': 'font/woff2',
      '/gallery/files/haus.litematic.b64.txt': 'text/plain; charset=utf-8', '/gallery/files/haus.litematic': 'application/octet-stream',
      '/gallery/files/haus.schem': 'application/octet-stream', '/gallery/files/haus.nbt': 'application/octet-stream',
      '/media/gross.bin': 'application/octet-stream',
    };
    for (const [path, type] of Object.entries(expected)) {
      const r = await raw(s.base, path);
      expect(r.status, path).toBe(200);
      expect(r.headers['content-type'], path).toBe(type);
      expect(r.headers['x-content-type-options'], path).toBe('nosniff');
    }
    expect(SITE_TYPES['.litematic']).toBe('application/octet-stream');
    expect((await raw(s.base, '/editor/assets/index-AbC123.js')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await raw(s.base, '/css/site.css')).headers['cache-control']).toBe('public, max-age=300');
    // Binärdatei byte-genau
    expect((await raw(s.base, '/gallery/files/haus.litematic')).body.equals(files['gallery/files/haus.litematic'] as Buffer)).toBe(true);
  });

  it('große Datei gestreamt (Länge und Inhalt), HEAD ohne Body, ETag → 304', async () => {
    const big = await raw(s.base, '/media/gross.bin');
    expect(big.headers['content-length']).toBe(String(1024 * 1024 + 7));
    expect(big.body.equals(files['media/gross.bin'] as Buffer)).toBe(true);
    const head = await raw(s.base, '/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe(String(Buffer.byteLength(files['index.html'] as string)));
    expect(head.body.length).toBe(0);
    const etag = head.headers.etag!;
    expect(etag).toMatch(/^W\/"/);
    const again = await raw(s.base, '/', { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
    expect(again.headers['cache-control']).toBe('no-cache');
  });

  it('Unbekanntes und Verzeichnis ohne index.html → 404 mit kleiner HTML-Seite, kein Listing', async () => {
    for (const path of ['/gibt-es-nicht.html', '/scenes', '/scenes/', '/gallery/files/', '/editor/assets/', '/index.html/']) {
      const r = await raw(s.base, path);
      expect(r.status, path).toBe(404);
      expect(r.headers['content-type'], path).toBe('text/html; charset=utf-8');
      expect(r.text, path).toContain('Seite nicht gefunden');
      expect(r.text, path).toContain(EXPORT_DISCLAIMER);
      expect(r.text, path).not.toContain('base.json');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
    }
    const head = await raw(s.base, '/gibt-es-nicht.html', { method: 'HEAD' });
    expect(head.status).toBe(404);
    expect(head.body.length).toBe(0);
  });

  it('Pfad-Ausbruch, Punktdateien, kodierte Trenner, Backslash, NUL, Symlink nach außen → 404', async () => {
    for (const path of [
      '/../package.json', '/../../package.json', '/%2e%2e/%2e%2e/package.json', '/%2e%2e/package.json', '/.%2e/secret.txt',
      '/editor/..%2f..%2fpackage.json', '/editor/..%2F..%2Fpackage.json', '/editor/%2e%2e%2f%2e%2e%2fpackage.json',
      '/..\\package.json', '/editor/..%5c..%5cpackage.json', '/%00', '/index.html%00', '//package.json', '/.env', '/.git/config',
      '/%2eenv', '/editor/.hidden.js', '/raus.txt', '/rausdir/secret.txt', '/rausdir/package.json',
    ]) {
      const r = await raw(s.base, path);
      expect(r.status, path).toBe(404);
      expect(r.text, path).not.toContain(SECRET);
    }
    // Symlink innerhalb der Website bleibt erlaubt (nur wenn Symlinks angelegt werden konnten, siehe oben)
    if (SYMLINKS) expect((await raw(s.base, '/drinnen.css')).text).toBe('body{margin:0}');
  });

  it('API-Pfade gehören nicht zur Website', async () => {
    const health = await raw(s.base, '/healthz');
    expect(JSON.parse(health.text)).toMatchObject({ ok: true, auth: 'local' });
    const unknown = await raw(s.base, '/v1/gibt-es-nicht');
    expect(unknown.status).toBe(404);
    expect(unknown.headers['content-type']).toMatch(/application\/json/);
    expect((await raw(s.base, '/v1/operations')).status).toBe(200);
    // POST auf eine Seite ist keine statische Auslieferung
    const post = await raw(s.base, '/index.html', { method: 'POST', headers: json, body: '{}' });
    expect(post.status).toBe(404);
    expect(post.headers['content-type']).toMatch(/application\/json/);
  });

  it('lokaler Modus: Website nur mit localhost-Host (DNS-Rebinding) – wie die API', async () => {
    expect((await raw(s.base, '/', { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await raw(s.base, '/', { headers: { host: `localhost:${s.port}` } })).status).toBe(200);
  });

  it('Same-Origin-POST auf /v1/interpret erlaubt, fremder Ursprung 403', async () => {
    for (const host of [`127.0.0.1:${s.port}`, `localhost:${s.port}`]) {
      const r = await describe_(s.base, { host, origin: `http://${host}` });
      expect(r.status, host).toBe(200);
      expect(JSON.parse(r.text)).toMatchObject({ ok: true, model: 'local', request: { op: expect.any(String) } });
    }
    expect((await describe_(s.base, { host: `127.0.0.1:${s.port}`, origin: 'http://evil.example' })).status).toBe(403);
    // anderer Port = anderer Ursprung
    expect((await describe_(s.base, { host: `127.0.0.1:${s.port}`, origin: `http://127.0.0.1:${s.port + 1}` })).status).toBe(403);
    expect((await describe_(s.base, { host: `127.0.0.1:${s.port}`, origin: `https://127.0.0.1:${s.port}` })).status).toBe(403);
    expect((await describe_(s.base, { host: `127.0.0.1:${s.port}`, origin: 'null' })).status).toBe(403);
    // Vite-Dev-Server bleibt erlaubt (corsOrigins)
    expect((await describe_(s.base, { host: `127.0.0.1:${s.port}`, origin: 'http://localhost:5173' })).status).toBe(200);
  });
});

describe('ohne `site`: Verhalten wie bisher', () => {
  it('keine Website, eigener Ursprung zählt nicht als erlaubt', async () => {
    const s = await start({ interpret: LOCAL_NL });
    try {
      const root = await raw(s.base, '/');
      expect(root.status).toBe(404);
      expect(root.headers['content-type']).toMatch(/application\/json/);
      expect((await describe_(s.base, { host: `127.0.0.1:${s.port}`, origin: `http://127.0.0.1:${s.port}` })).status).toBe(403);
      expect((await describe_(s.base, {})).status).toBe(200);
      const health = JSON.parse((await raw(s.base, '/healthz')).text);
      expect(health).not.toHaveProperty('publicInterpret');
      expect(health).not.toHaveProperty('site');
    } finally {
      await s.stop();
    }
  });

  it('fehlendes Website-Verzeichnis: Fehler beim Anlegen, nicht erst bei der Anfrage', () => {
    expect(() => engineServer(engine, { site: { dir: join(tmp, 'fehlt') } })).toThrow();
  });
});

describe('Komprimierung', () => {
  const decode = (r: Raw): string => {
    const enc = r.headers['content-encoding'];
    const body = enc === 'br' ? brotliDecompressSync(r.body) : enc === 'gzip' ? gunzipSync(r.body) : r.body;
    return body.toString('utf8');
  };
  const get = (base: string, path: string, ae?: string, method = 'GET'): Promise<Raw> =>
    raw(base, path, { method, headers: ae !== undefined ? { 'accept-encoding': ae } : {} });
  const stats = async (base: string): Promise<SiteCacheStats> =>
    (JSON.parse((await raw(base, '/healthz')).text) as { site: { compressCache: SiteCacheStats } }).site.compressCache;

  it('Accept-Encoding: br vor gzip, q-Werte, *, identity', () => {
    const cases: [string | undefined, string | undefined][] = [
      [undefined, undefined], ['', undefined], ['identity', undefined], ['deflate', undefined], ['*;q=0', undefined],
      ['gzip', 'gzip'], ['x-gzip', 'gzip'], ['br', 'br'], ['BR', 'br'], ['gzip, deflate, br, zstd', 'br'], ['*', 'br'],
      ['br;q=0, gzip', 'gzip'], ['br;q=0.5, gzip;q=0.8', 'gzip'], ['br;q=0.8, gzip;q=0.8', 'br'], ['gzip;q=0, *', 'br'],
      ['br;q=0, gzip;q=0', undefined], ['gzip ; q=0.3', 'gzip'], ['br;q=abc, gzip', 'gzip'], ['br;q=2, gzip;q=0.1', 'gzip'],
      ['br;q=1.000, gzip', 'br'], ['br;q=0.001', 'br'],
    ];
    for (const [header, want] of cases) expect(negotiateEncoding(header), String(header)).toBe(want);
  });

  it('JS-Chunk: br/gzip/roh je Accept-Encoding, Vary, Länge stimmt, entpackt == Original', async () => {
    const s = await start({ site: { dir: site } });
    try {
      const path = '/editor/assets/index-Big123.js';
      const want: [string | undefined, string | undefined][] = [
        ['br', 'br'], ['gzip', 'gzip'], ['gzip, deflate, br, zstd', 'br'], ['br;q=0, gzip', 'gzip'], [undefined, undefined], ['identity', undefined],
      ];
      for (const [ae, enc] of want) {
        const r = await get(s.base, path, ae);
        expect(r.status, String(ae)).toBe(200);
        expect(r.headers['content-encoding'], String(ae)).toBe(enc);
        expect(r.headers.vary, String(ae)).toBe('Accept-Encoding');
        expect(r.headers['content-length'], String(ae)).toBe(String(r.body.length));
        expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
        expect(r.headers['cache-control']).toMatch(/immutable/);
        expect(decode(r), String(ae)).toBe(BIG_JS);
        if (enc !== undefined) expect(r.body.length, String(ae)).toBeLessThan(Buffer.byteLength(BIG_JS) / 4);
      }
      // CSS und SVG ebenso
      for (const [p, text] of [['/editor/assets/style-Big123.css', files['editor/assets/style-Big123.css']], ['/media/gross.svg', files['media/gross.svg']]] as const) {
        const r = await get(s.base, p, 'gzip, br');
        expect(r.headers['content-encoding'], p).toBe('br');
        expect(decode(r), p).toBe(text);
      }
      // HEAD: gleiche Kopfzeilen wie GET, kein Body
      const g = await get(s.base, path, 'br');
      const h = await get(s.base, path, 'br', 'HEAD');
      expect(h.headers['content-encoding']).toBe('br');
      expect(h.headers['content-length']).toBe(g.headers['content-length']);
      expect(h.body.length).toBe(0);
      // 304 trägt Vary
      const nm = await raw(s.base, path, { headers: { 'accept-encoding': 'br', 'if-none-match': g.headers.etag! } });
      expect(nm.status).toBe(304);
      expect(nm.headers.vary).toBe('Accept-Encoding');
      expect(nm.body.length).toBe(0);
    } finally {
      await s.stop();
    }
  });

  it('Bilder, Schriften, Minecraft-Exporte und Unbekanntes nie komprimiert, kein Vary; kleine Texte roh mit Vary', async () => {
    const s = await start({ site: { dir: site } });
    try {
      for (const p of ['/media/foto.png', '/media/foto.jpg', '/fonts/schrift.woff2', '/gallery/files/gross.litematic', '/gallery/files/gross.schem', '/gallery/files/gross.nbt', '/media/gross.bin']) {
        const r = await get(s.base, p, 'br, gzip');
        expect(r.status, p).toBe(200);
        expect(r.headers['content-encoding'], p).toBeUndefined();
        expect(r.headers.vary, p).toBeUndefined();
        expect(r.body.equals(files[p.slice(1)] as Buffer), p).toBe(true);
      }
      const small = await get(s.base, '/', 'br');
      expect(small.headers['content-encoding']).toBeUndefined();
      expect(small.headers.vary).toBe('Accept-Encoding');
      expect(small.text).toBe(files['index.html']);
      // Text, der nicht kleiner wird (Zufallsbytes): roh ausgeliefert, vollständig (Lesen ab Dateianfang)
      const noise = randomBytes(4096);
      writeFileSync(join(site, 'media/zufall.txt'), noise);
      for (const ae of ['br', 'gzip', 'br']) {
        const r = await get(s.base, '/media/zufall.txt', ae);
        expect(r.headers['content-encoding'], ae).toBeUndefined();
        expect(r.headers['content-length'], ae).toBe('4096');
        expect(r.body.equals(noise), ae).toBe(true);
      }
    } finally {
      await s.stop();
    }
  });

  it('Cache: einmal komprimiert je Datei und Kodierung, gleichzeitige erste Anfragen teilen sich die Arbeit', async () => {
    writeFileSync(join(site, 'editor/assets/parallel-Q1.js'), jsText('p'));
    const s = await start({ site: { dir: site } });
    try {
      expect(await stats(s.base)).toEqual({ entries: 0, bytes: 0, hits: 0, misses: 0, precompressed: 0 });
      const first = await get(s.base, '/editor/assets/index-Big123.js', 'br');
      const again = await get(s.base, '/editor/assets/index-Big123.js', 'br');
      expect(again.body.equals(first.body)).toBe(true);
      expect(await stats(s.base)).toMatchObject({ entries: 1, bytes: first.body.length, hits: 1, misses: 1 });
      await get(s.base, '/editor/assets/index-Big123.js', 'gzip');
      expect(await stats(s.base)).toMatchObject({ entries: 2, hits: 1, misses: 2 });
      const parallel = await Promise.all(Array.from({ length: 5 }, () => get(s.base, '/editor/assets/parallel-Q1.js', 'br')));
      for (const r of parallel) expect(decode(r)).toBe(jsText('p'));
      expect(await stats(s.base)).toMatchObject({ entries: 3, hits: 5, misses: 3 });
    } finally {
      await s.stop();
    }
  });

  it('andere Dateien: Cache-Schlüssel mit Größe und mtime – geänderte Datei wird neu komprimiert', async () => {
    const file = join(site, 'gallery/live.json');
    const a = JSON.stringify({ v: 'a'.repeat(3000) });
    const b = JSON.stringify({ v: 'b'.repeat(3000), neu: true });
    writeFileSync(file, a);
    utimesSync(file, new Date(2026, 0, 1), new Date(2026, 0, 1));
    const s = await start({ site: { dir: site } });
    try {
      expect(decode(await get(s.base, '/gallery/live.json', 'gzip'))).toBe(a);
      writeFileSync(file, b);
      expect(decode(await get(s.base, '/gallery/live.json', 'gzip'))).toBe(b);
      // gleiche Größe, andere mtime
      const c = b.replace('neu', 'alt');
      writeFileSync(file, c);
      utimesSync(file, new Date(2026, 5, 1), new Date(2026, 5, 1));
      expect(decode(await get(s.base, '/gallery/live.json', 'gzip'))).toBe(c);
      expect(await stats(s.base)).toMatchObject({ hits: 0, misses: 3 });
    } finally {
      await s.stop();
    }
  });

  it('LRU nach Bytes: Budget wird eingehalten, ältester Eintrag fällt heraus', async () => {
    // Pseudozufällige Hex-Texte (8 KiB) komprimieren nur auf ~die Hälfte: 24 KiB Budget → höchstens 5 Einträge
    let x = 12345;
    const hex = (): string => Array.from({ length: 1024 }, () => ((x = (x * 1103515245 + 12345) >>> 0) >>> 0).toString(16).padStart(8, '0')).join('').slice(0, 8192);
    mkdirSync(join(site, 'lru'), { recursive: true });
    for (let i = 0; i < 10; i++) writeFileSync(join(site, `lru/f${i}.txt`), hex());
    const budget = 24 * 1024;
    const s = await start({ site: { dir: site, compressCacheBytes: budget } });
    try {
      for (let i = 0; i < 10; i++) expect((await get(s.base, `/lru/f${i}.txt`, 'br')).headers['content-encoding']).toBe('br');
      const st = await stats(s.base);
      expect(st.misses).toBe(10);
      expect(st.bytes).toBeLessThanOrEqual(budget);
      expect(st.entries).toBeGreaterThan(0);
      expect(st.entries).toBeLessThan(10);
      await get(s.base, '/lru/f9.txt', 'br'); // jüngster: im Cache
      await get(s.base, '/lru/f0.txt', 'br'); // ältester: verdrängt
      expect(await stats(s.base)).toMatchObject({ hits: 1, misses: 11 });
    } finally {
      await s.stop();
    }
  });

  describe('vorkomprimierte Dateien des Builds (W7-H)', () => {
    const br = (b: string | Buffer, quality = 11): Buffer => brotliCompressSync(b, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: quality } });
    /** Original + `.br`/`.gz` daneben (Sidecar zeitlich nach dem Original, wie im Build). */
    const withSidecars = (rel: string, text: string, which: readonly ('br' | 'gzip')[] = ['br', 'gzip']): Record<string, Buffer> => {
      const file = join(site, rel);
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, text);
      utimesSync(file, new Date(2026, 0, 1), new Date(2026, 0, 1));
      const out: Record<string, Buffer> = {};
      for (const enc of which) {
        out[enc] = enc === 'br' ? br(text) : gzipSync(text, { level: 9 });
        writeFileSync(file + PRECOMPRESSED_EXT[enc], out[enc]);
      }
      return out;
    };

    it('bevorzugt ausgeliefert: Bytes der Datei unverändert, mit Länge, gleiche Kopfzeilen und ETag wie zur Laufzeit', async () => {
      expect(PRECOMPRESSED_EXT).toEqual({ br: '.br', gzip: '.gz' });
      const text = jsText('pre');
      const side = withSidecars('editor/assets/pre-W7H.js', text);
      writeFileSync(join(site, 'editor/assets/runtime-W7H.js'), text);
      const s = await start({ site: { dir: site } });
      try {
        const path = '/editor/assets/pre-W7H.js';
        for (const [ae, enc] of [['br', 'br'], ['gzip, deflate, br, zstd', 'br'], ['gzip', 'gzip'], ['br;q=0, gzip', 'gzip']] as const) {
          const r = await get(s.base, path, ae);
          expect(r.status, ae).toBe(200);
          expect(r.headers['content-encoding'], ae).toBe(enc);
          expect(r.body.equals(side[enc]!), ae).toBe(true);
          expect(r.headers['content-length'], ae).toBe(String(side[enc]!.length));
          expect(r.headers.vary, ae).toBe('Accept-Encoding');
          expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
          expect(r.headers['cache-control']).toMatch(/immutable/);
          expect(decode(r), ae).toBe(text);
        }
        // gleiches ETag wie ohne Vorkomprimierung (hängt nur am Original); 304 bleibt 304
        const g = await get(s.base, path, 'br');
        const plain = await get(s.base, path);
        expect(plain.headers['content-encoding']).toBeUndefined();
        expect(plain.text).toBe(text);
        expect(g.headers.etag).toBe(plain.headers.etag);
        const nm = await raw(s.base, path, { headers: { 'accept-encoding': 'br', 'if-none-match': g.headers.etag! } });
        expect(nm.status).toBe(304);
        // HEAD: Länge der vorkomprimierten Datei, kein Body
        const h = await get(s.base, path, 'br', 'HEAD');
        expect(h.headers['content-length']).toBe(String(side['br']!.length));
        expect(h.body.length).toBe(0);
        // Brotli 11 schlägt die Laufzeit-Stufe 7 (gleicher Inhalt ohne Sidecar)
        const rt = await get(s.base, '/editor/assets/runtime-W7H.js', 'br');
        expect(side['br']!.length).toBeLessThan(rt.body.length);
        expect(await stats(s.base)).toMatchObject({ precompressed: 6, misses: 1 });
      } finally {
        await s.stop();
      }
    });

    it('nur .br vorhanden: gzip zur Laufzeit; unpassende Sidecars werden übergangen (älter, nicht kleiner, Verzeichnis, Symlink nach außen)', async () => {
      const text = jsText('side');
      withSidecars('editor/assets/nurbr-W7H.js', text, ['br']);
      // älter als das Original: womöglich veraltet
      withSidecars('editor/assets/alt-W7H.js', text);
      for (const ext of ['.br', '.gz']) utimesSync(join(site, `editor/assets/alt-W7H.js${ext}`), new Date(2025, 0, 1), new Date(2025, 0, 1));
      // nicht kleiner als das Original
      withSidecars('editor/assets/gross-W7H.js', text, []);
      writeFileSync(join(site, 'editor/assets/gross-W7H.js.br'), Buffer.alloc(Buffer.byteLength(text) + 1, 0x41));
      // Verzeichnis statt Datei, Symlink aus der Website hinaus
      withSidecars('editor/assets/dir-W7H.js', text, []);
      mkdirSync(join(site, 'editor/assets/dir-W7H.js.br'));
      withSidecars('editor/assets/link-W7H.js', text, []);
      writeFileSync(join(tmp, 'aussen.br'), br(SECRET));
      // Windows ohne Symlink-Recht: Fall entfällt (link-W7H.js hat dann kein Sidecar, Erwartungen gelten unverändert)
      trySymlink(join(tmp, 'aussen.br'), join(site, 'editor/assets/link-W7H.js.br'), 'file');
      const s = await start({ site: { dir: site } });
      try {
        const g = await get(s.base, '/editor/assets/nurbr-W7H.js', 'gzip');
        expect(g.headers['content-encoding']).toBe('gzip');
        expect(decode(g)).toBe(text);
        expect(await stats(s.base)).toMatchObject({ precompressed: 0, misses: 1 });
        for (const p of ['alt', 'gross', 'dir', 'link']) {
          const r = await get(s.base, `/editor/assets/${p}-W7H.js`, 'br');
          expect(r.headers['content-encoding'], p).toBe('br');
          expect(decode(r), p).toBe(text);
        }
        expect(await stats(s.base)).toMatchObject({ precompressed: 0, misses: 5 });
        // zum Vergleich: dieselbe Datei mit gültigem .br
        expect((await get(s.base, '/editor/assets/nurbr-W7H.js', 'br')).headers['content-encoding']).toBe('br');
        expect(await stats(s.base)).toMatchObject({ precompressed: 1, misses: 5 });
      } finally {
        await s.stop();
      }
    });

    it('große Textdatei (> 8 MiB) mit .br/.gz: mit Länge statt chunked, ohne Rechenzeit', async () => {
      const big = jsText('pg').repeat(30);
      expect(big.length).toBeGreaterThan(8 * 1024 * 1024);
      const file = join(site, 'media/riesig-pre.txt');
      writeFileSync(file, big);
      utimesSync(file, new Date(2026, 0, 1), new Date(2026, 0, 1));
      // schnelle Stufen: hier zählt nur, dass die Datei hinausgeht
      const side = { br: br(big, 1), gzip: gzipSync(big, { level: 1 }) };
      writeFileSync(`${file}.br`, side.br);
      writeFileSync(`${file}.gz`, side.gzip);
      const s = await start({ site: { dir: site } });
      try {
        for (const enc of ['br', 'gzip'] as const) {
          const r = await get(s.base, '/media/riesig-pre.txt', enc);
          expect(r.headers['content-encoding'], enc).toBe(enc);
          expect(r.headers['content-length'], enc).toBe(String(side[enc].length));
          expect(r.headers['transfer-encoding'], enc).toBeUndefined();
          expect(r.body.equals(side[enc]), enc).toBe(true);
        }
        expect(await stats(s.base)).toMatchObject({ precompressed: 2, misses: 0, entries: 0 });
      } finally {
        await s.stop();
      }
    });
  });

  it('große Textdatei (> 8 MiB): gestreamt komprimiert, ohne Länge, entpackt == Original; HEAD ohne Body', async () => {
    const big = jsText('g').repeat(30); // ~9,6 MB
    expect(big.length).toBeGreaterThan(8 * 1024 * 1024);
    writeFileSync(join(site, 'media/riesig.txt'), big);
    const s = await start({ site: { dir: site } });
    try {
      for (const ae of ['br', 'gzip']) {
        const r = await get(s.base, '/media/riesig.txt', ae);
        expect(r.headers['content-encoding'], ae).toBe(ae);
        expect(r.headers['content-length'], ae).toBeUndefined();
        expect(r.headers['transfer-encoding'], ae).toBe('chunked');
        expect(r.headers.vary).toBe('Accept-Encoding');
        expect(decode(r) === big, ae).toBe(true);
      }
      const h = await get(s.base, '/media/riesig.txt', 'br', 'HEAD');
      expect(h.headers['content-encoding']).toBe('br');
      expect(h.body.length).toBe(0);
      const plain = await get(s.base, '/media/riesig.txt');
      expect(plain.headers['content-length']).toBe(String(Buffer.byteLength(big)));
      // gestreamte Dateien belegen keinen Cache
      expect(await stats(s.base)).toMatchObject({ entries: 0, misses: 0 });
    } finally {
      await s.stop();
    }
  });
});

describe('Schlüssel-Modus mit Website', () => {
  it('Website und /healthz ohne Anmeldung, /v1 mit Schlüssel; eigener Ursprung darf mit Schlüssel POSTen', async () => {
    const s = await start({ site: { dir: site }, apiKeys, interpret: LOCAL_NL });
    try {
      expect((await raw(s.base, '/', { headers: { host: 'www.example.org' } })).status).toBe(200);
      expect((await raw(s.base, '/editor/', { headers: { host: 'www.example.org' } })).status).toBe(200);
      expect((await raw(s.base, '/healthz')).status).toBe(200);
      expect((await raw(s.base, '/v1/operations')).status).toBe(401);
      const own = { host: 'www.example.org', origin: 'http://www.example.org' };
      expect((await describe_(s.base, own)).status).toBe(401);
      expect((await describe_(s.base, { ...own, authorization: `Bearer ${KEY}` })).status).toBe(200);
      expect((await describe_(s.base, { host: 'www.example.org', origin: 'http://evil.example', authorization: `Bearer ${KEY}` })).status).toBe(403);
    } finally {
      await s.stop();
    }
  });
});

describe('Öffentlicher Web-Modus', () => {
  const host = 'nookwright.example';
  const own = { host, origin: `http://${host}` };

  it('ohne Schlüssel: Website öffentlich; nur /v1/interpret anonym und nur vom eigenen Ursprung; übrige /v1 → 401', async () => {
    const access: AccessLogEntry[] = [];
    const s = await start({ site: { dir: site }, publicInterpret: true, interpret: LOCAL_NL, accessLog: (e) => access.push(e) });
    try {
      // R1-19: öffentlich ohne Schlüssel nur Lebenszeichen und Modus, keine Interna
      expect(JSON.parse((await raw(s.base, '/healthz')).text)).toEqual({ ok: true, auth: 'public' });
      expect(JSON.parse((await raw(s.base, '/healthz', { headers: { authorization: 'Bearer falsch' } })).text)).toEqual({ ok: true, auth: 'public' });
      expect((await raw(s.base, '/', { headers: { host } })).status).toBe(200);
      const ok = await describe_(s.base, own);
      expect(ok.status).toBe(200);
      expect(JSON.parse(ok.text)).toMatchObject({ ok: true, model: 'local' });
      expect(access).toContainEqual(expect.objectContaining({ path: '/v1/interpret', status: 200, tenant: 'web' }));
      // fehlender bzw. fremder Ursprung
      expect((await describe_(s.base, { host })).status).toBe(403);
      expect((await describe_(s.base, { host, origin: 'http://evil.example' })).status).toBe(403);
      expect((await describe_(s.base, { host, origin: `https://${host}` })).status).toBe(403);
      // alles andere verlangt einen Schlüssel – es gibt keinen
      for (const [path, body] of [['/v1/execute', '{"op":"project_list","input":{}}'], ['/v1/prompt', interpretBody]] as const) {
        const r = await raw(s.base, path, { method: 'POST', headers: { ...json, ...own }, body });
        expect(r.status, path).toBe(401);
      }
      expect((await raw(s.base, '/v1/operations', { headers: { host } })).status).toBe(401);
      expect((await describe_(s.base, { ...own, authorization: 'Bearer falsch' })).status).toBe(401);
      // anonyme Anfragen: kleine Body-Grenze
      const long = await describe_(s.base, own, JSON.stringify({ prompt: 'x'.repeat(20 * 1024) }));
      expect(long.status).toBe(413);
      // Zugriffslog ohne Prompt
      expect(JSON.stringify(access)).not.toContain('Taverne');
    } finally {
      await s.stop();
    }
  });

  it('ENGINE_PUBLIC_ORIGINS: weiterer Ursprung erlaubt (auch CORS); mit Schlüsseln bleibt /v1 nutzbar', async () => {
    const s = await start({ site: { dir: site }, publicInterpret: true, publicOrigins: ['https://www.example.org'], apiKeys, interpret: LOCAL_NL });
    try {
      const r = await describe_(s.base, { host, origin: 'https://www.example.org' });
      expect(r.status).toBe(200);
      expect(r.headers['access-control-allow-origin']).toBe('https://www.example.org');
      const pre = await raw(s.base, '/v1/interpret', { method: 'OPTIONS', headers: { origin: 'https://www.example.org' } });
      expect(pre.status).toBe(204);
      expect(pre.headers['access-control-allow-methods']).toMatch(/POST/);
      expect((await raw(s.base, '/v1/execute', { method: 'POST', headers: { ...json, authorization: `Bearer ${KEY}` }, body: '{"op":"project_list","input":{}}' })).status).toBe(200);
      expect((await raw(s.base, '/v1/execute', { method: 'POST', headers: { ...json, ...own }, body: '{"op":"project_list","input":{}}' })).status).toBe(401);
      // R1-19: /healthz ausführlich nur mit gültigem Schlüssel, `auth` wahrheitsgemäß
      expect(JSON.parse((await raw(s.base, '/healthz')).text)).toEqual({ ok: true, auth: 'public' });
      const detail = JSON.parse((await raw(s.base, '/healthz', { headers: { authorization: `Bearer ${KEY}` } })).text);
      expect(detail).toMatchObject({ ok: true, auth: 'public', store: 'memory', site: { compressCache: { entries: expect.any(Number) } } });
      expect((await raw(s.base, '/healthz', { method: 'HEAD' })).status).toBe(200);
    } finally {
      await s.stop();
    }
  });

  it('NL-Rate-Limit je IP (429); hinter Proxy zählt der letzte X-Forwarded-For-Eintrag, https aus X-Forwarded-Proto', async () => {
    const s = await start({ site: { dir: site }, publicInterpret: true, interpret: LOCAL_NL, trustProxy: true, rateLimit: { nl: { perMinute: 1, burst: 2 } } });
    try {
      const via = (ip: string, origin = `https://${host}`): Record<string, string> => ({ host, origin, 'x-forwarded-for': ip, 'x-forwarded-proto': 'https' });
      expect((await describe_(s.base, via('9.9.9.9'))).status).toBe(200);
      // gefälschter erster Eintrag hilft nicht: der Proxy hängt die echte IP hinten an
      expect((await describe_(s.base, via('1.1.1.1, 9.9.9.9'))).status).toBe(200);
      const limited = await describe_(s.base, via('2.2.2.2, 9.9.9.9'));
      expect(limited.status).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(30);
      // andere IP: eigenes Kontingent
      expect((await describe_(s.base, via('8.8.8.8'))).status).toBe(200);
      // hinter TLS-Proxy ist http:// nicht der eigene Ursprung
      expect((await describe_(s.base, via('7.7.7.7', `http://${host}`))).status).toBe(403);
    } finally {
      await s.stop();
    }
  });

  it('Tagesbudget (O3): erschöpft → 429 bis Mitternacht UTC, am nächsten Tag wieder frei', async () => {
    let t = Date.UTC(2026, 8, 26, 23, 59, 0);
    const s = await start({ site: { dir: site }, publicInterpret: true, publicDailyBudget: 2, apiKeys, interpret: LOCAL_NL, now: () => t });
    try {
      expect((await describe_(s.base, own)).status).toBe(200);
      // ungültige Beschreibung verbraucht kein Budget
      expect((await describe_(s.base, own, '{"prompt":""}')).status).toBe(400);
      expect((await describe_(s.base, own)).status).toBe(200);
      const out = await describe_(s.base, own);
      expect(out.status).toBe(429);
      expect(out.headers['retry-after']).toBe('60');
      expect(JSON.parse(out.text).errors[0]).toMatch(/Tageskontingent/);
      // mit Schlüssel nicht betroffen
      expect((await describe_(s.base, { authorization: `Bearer ${KEY}` })).status).toBe(200);
      t += 60_000;
      expect((await describe_(s.base, own)).status).toBe(200);
    } finally {
      await s.stop();
    }
  });
});

describe('Kostenbremse im öffentlichen Modus (Review R1-06)', () => {
  it('Tagesbudget: gesetzt gilt (0 = bewusst unbegrenzt), mit Modell sonst 300/Tag, lokal unbegrenzt', () => {
    expect(DEFAULT_PUBLIC_NL_DAILY).toBe(300);
    for (const mode of ['decisions', 'tools', 'json_schema', undefined] as const) {
      expect(publicDailyBudget(undefined, mode), String(mode)).toEqual({ perDay: 300, source: 'default' });
    }
    expect(publicDailyBudget(undefined, 'local')).toEqual({ perDay: 0, source: 'local' });
    expect(publicDailyBudget(2000, 'decisions')).toEqual({ perDay: 2000, source: 'env' });
    expect(publicDailyBudget(12.7, 'decisions')).toEqual({ perDay: 12, source: 'env' });
    expect(publicDailyBudget(0, 'decisions')).toEqual({ perDay: 0, source: 'env' });
  });

  /** web.ts als eigener Prozess (Port 0, nur Loopback) bis zur Startmeldung; `extra` ergänzt/überschreibt die Umgebung. */
  async function startLog(extra: Record<string, string>): Promise<Record<string, unknown>[]> {
    const repo = fileURLToPath(new URL('../../..', import.meta.url));
    const child = spawn(process.execPath, ['--import', 'tsx', 'packages/engine/scripts/web.ts', '0'], {
      cwd: repo,
      // Leere Werte schirmen gegen eine lokale .env ab (loadEnvFile überschreibt gesetzte Variablen nicht)
      env: {
        PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '', ENGINE_WEB_PUBLIC: '1', ENGINE_WEB_DIR: site, ENGINE_HOST: '127.0.0.1',
        ENGINE_GENERATE_WORKERS: '0', ENGINE_WEB_NL_DAILY: '', ENGINE_API_KEYS: '', ENGINE_API_KEYS_FILE: '', ENGINE_STORE_FILE: '', ENGINE_NL_LOG: '',
        // W7 (27.09.2026): auch Modell und Schlüssel abschirmen – eine lokale .env mit ENGINE_NL_MODEL überstimmte den Preset
        ENGINE_NL_MODEL: '', ENGINE_NL_API_KEY: '', OPENROUTER_API_KEY: '', CLASSIFIER_API_KEY: '', CLASSIFIER_MODEL: '', ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines: Record<string, unknown>[] = [];
    let err = '';
    child.stderr.on('data', (c: Buffer) => { err += c.toString(); });
    try {
      await new Promise<void>((resolve, reject) => {
        let buf = '';
        child.stdout.on('data', (c: Buffer) => {
          buf += c.toString();
          for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            try {
              lines.push(JSON.parse(line) as Record<string, unknown>);
            } catch {
              continue;
            }
            if (lines.at(-1)?.['msg'] === 'Web-App gestartet') setTimeout(resolve, 200); // Warnung folgt direkt danach
          }
        });
        child.on('exit', (code) => reject(new Error(`web.ts beendet (${code}) vor der Startmeldung: ${err.slice(0, 500)}`)));
      });
    } finally {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await exited;
    }
    return lines;
  }

  it('web.ts: Startmeldung zeigt die Kostenbremse (Modell ohne ENGINE_WEB_NL_DAILY) bzw. warnt bei 0', async () => {
    // Kev: Entscheidungsmodell ohne Schlüssel – beim Start kein Netzaufruf
    const def = await startLog({ CLASSIFIER_PROVIDER: 'kev' });
    const started = def.find((l) => l['msg'] === 'Web-App gestartet')!;
    expect(started['publicBudget']).toBe('300 je UTC-Tag (Standard-Kostenbremse; ENGINE_WEB_NL_DAILY setzen)');
    expect(String(started['nl'])).toContain('Entscheidungsmodell kev-latest');
    expect(String(started['url'])).toMatch(/^http:\/\/127\.0\.0\.1:\d{2,5}\/$/); // tatsächlicher Port statt 0
    expect(def.some((l) => l['level'] === 'warn')).toBe(false);
    const off = await startLog({ CLASSIFIER_PROVIDER: 'kev', ENGINE_WEB_NL_DAILY: '0' });
    expect(off.find((l) => l['msg'] === 'Web-App gestartet')!['publicBudget']).toBe('unbegrenzt (ENGINE_WEB_NL_DAILY=0)');
    expect(off.some((l) => l['level'] === 'warn' && String(l['msg']).includes('ohne Tagesbudget'))).toBe(true);
  }, 60_000);
});
