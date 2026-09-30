/**
 * Goldene Galerie (P0-A), Node: kleiner HTTP-Server (nur 127.0.0.1) für Harness, Assets und Szenen, dazu Chromium
 * über playwright-core. Bilder kommen per PUT zurück und landen im Lauf-Ordner.
 *
 * playwright-core ist keine Abhängigkeit des Repos: Pfad über `PLAYWRIGHT_CORE` (Ordner des Pakets), sonst
 * `local/tools/node_modules/playwright-core`, sonst die normale Modulauflösung. Chromium muss installiert sein
 * (`npx playwright-core install chromium`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { decodePng } from '../../src/assets/png.js';
import { REPO_ROOT } from './paths.js';

export interface AssetFiles {
  readonly version: string;
  readonly dir: string;
}

const HARNESS_ENTRY = join(REPO_ROOT, 'packages/viewer/golden/browser/harness.ts');

export async function bundleHarness(): Promise<string> {
  const r = await build({
    entryPoints: [HARNESS_ENTRY], bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', write: false,
    logLevel: 'silent', legalComments: 'none',
  });
  return r.outputFiles[0]!.text;
}

/** Assets aus `local/mc-assets/<version>` (vom Skript extract-assets.ts erzeugt). */
export function loadAssets(a: AssetFiles): { meta: string; atlas: Uint8Array; width: number; height: number } {
  const need = ['atlas.png', 'atlas.json', 'blockstates.json', 'models.json', 'block-flags.json'];
  const missing = need.filter((f) => !existsSync(join(a.dir, f)));
  if (missing.length > 0) {
    throw new Error(`Mojang-Assets fehlen in ${a.dir}: ${missing.join(', ')}. Erzeugen mit: npx tsx packages/viewer/scripts/extract-assets.ts (braucht local/mc-client/${a.version}/client.jar)`);
  }
  const img = decodePng(new Uint8Array(readFileSync(join(a.dir, 'atlas.png'))), (d) => new Uint8Array(inflateSync(d)));
  const json = (f: string): unknown => JSON.parse(readFileSync(join(a.dir, f), 'utf8'));
  const meta = JSON.stringify({
    version: a.version, width: img.width, height: img.height,
    atlasIndex: json('atlas.json'), blockstates: json('blockstates.json'), models: json('models.json'), blockFlags: json('block-flags.json'),
  });
  return { meta, atlas: new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength), width: img.width, height: img.height };
}

export interface GoldenServer {
  readonly url: string;
  readonly scenes: Map<string, string>;
  close(): Promise<void>;
}

const SAFE = /^[A-Za-z0-9._-]+$/;

export async function startServer(opts: { port: number; harness: string; assets: { meta: string; atlas: Uint8Array }; outDir: string }): Promise<GoldenServer> {
  const scenes = new Map<string, string>();
  const page = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}</style></head><body><script type="module" src="/harness.js"></script></body></html>';
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, type: string, body: string | Uint8Array): void => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(200, 'text/html; charset=utf-8', page);
      if (req.method === 'GET' && url.pathname === '/harness.js') return send(200, 'text/javascript; charset=utf-8', opts.harness);
      if (req.method === 'GET' && url.pathname === '/assets/meta.json') return send(200, 'application/json', opts.assets.meta);
      if (req.method === 'GET' && url.pathname === '/assets/atlas.rgba') return send(200, 'application/octet-stream', opts.assets.atlas);
      const scene = /^\/scene\/([^/]+)\.json$/.exec(url.pathname);
      if (req.method === 'GET' && scene !== null) {
        const body = scenes.get(decodeURIComponent(scene[1]!));
        return body === undefined ? send(404, 'text/plain', 'unbekannte Szene') : send(200, 'application/json', body);
      }
      // PUT /out/<id>/<datei> oder /out/<id>/thumb/<datei>
      const out = /^\/out\/([^/]+)\/(?:(thumb)\/)?([^/]+)$/.exec(url.pathname);
      if (req.method === 'PUT' && out !== null) {
        const id = decodeURIComponent(out[1]!), file = decodeURIComponent(out[3]!);
        if (!SAFE.test(id) || !SAFE.test(file) || !/\.(png|jpg)$/.test(file)) return send(400, 'text/plain', 'Name');
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const dir = out[2] === undefined ? join(opts.outDir, id) : join(opts.outDir, id, 'thumb');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, file), Buffer.concat(chunks));
          send(200, 'text/plain', 'ok');
        });
        return;
      }
      send(404, 'text/plain', 'nicht gefunden');
    } catch (e) {
      send(500, 'text/plain', e instanceof Error ? e.message : String(e));
    }
  });
  const port = await listen(server, opts.port);
  return {
    url: `http://127.0.0.1:${port}/`,
    scenes,
    close: () => new Promise((ok) => server.close(() => ok())),
  };
}

/** Port `port` … `port + 4` (5195–5199: nicht mit App/Engine/Website kollidieren). */
async function listen(server: Server, port: number): Promise<number> {
  for (let p = port; p < port + 5; p++) {
    const ok = await new Promise<boolean>((resolve) => {
      const onError = (): void => resolve(false);
      server.once('error', onError);
      server.listen(p, '127.0.0.1', () => {
        server.off('error', onError);
        resolve(true);
      });
    });
    if (ok) return p;
  }
  throw new Error(`Kein freier Port in ${port}–${port + 4}`);
}

// ---------------------------------------------------------------------------------------------- Chromium

/** Der Teil von playwright-core, den der Lauf braucht (keine Typ-Abhängigkeit auf das Paket). */
export interface PwPage {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: string, arg?: unknown, opts?: { timeout?: number }): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  on(event: 'console', cb: (m: { type(): string; text(): string }) => void): void;
  on(event: 'pageerror', cb: (e: Error) => void): void;
}
interface PwBrowser {
  newPage(opts: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<PwPage>;
  close(): Promise<void>;
  version(): string;
}
interface Pw {
  chromium: { launch(opts: { args: string[]; headless?: boolean }): Promise<PwBrowser> };
}

export function loadPlaywright(localDir: string): { pw: Pw; from: string } {
  const require = createRequire(import.meta.url);
  const candidates = [process.env['PLAYWRIGHT_CORE'], join(localDir, 'tools/node_modules/playwright-core'), 'playwright-core'].filter((c): c is string => c !== undefined && c !== '');
  const errors: string[] = [];
  for (const c of candidates) {
    try {
      return { pw: require(c) as Pw, from: c };
    } catch (e) {
      errors.push(`${c}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }
  throw new Error(`playwright-core nicht gefunden. PLAYWRIGHT_CORE=<Ordner von playwright-core> setzen oder in local/tools installieren (npm i --prefix local/tools playwright-core && npx --prefix local/tools playwright-core install chromium).\n${errors.join('\n')}`);
}

/** Chromium-Schalter: auf macOS GPU über Metal (schnell); `GOLDEN_GL=swiftshader` rendert per Software. */
export function chromiumArgs(): string[] {
  const gl = process.env['GOLDEN_GL'] ?? (process.platform === 'darwin' ? 'metal' : 'default');
  if (gl === 'swiftshader') return ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  if (gl === 'metal') return ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
  return ['--enable-gpu', '--ignore-gpu-blocklist'];
}

export async function openBrowser(pw: Pw, width: number, height: number): Promise<{ browser: PwBrowser; page: PwPage; errors: string[] }> {
  const browser = await pw.chromium.launch({ args: chromiumArgs() });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return { browser, page, errors };
}

