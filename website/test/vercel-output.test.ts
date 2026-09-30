/**
 * W8-V: Vercel-Build (`deploy/vercel/build.mjs`, Build Output API v3) auf einer kleinen Fake-Website. Geprüft:
 * Header/Cache-Regeln = Node-Server (`SITE_HEADERS`, `siteCacheControl`), keine Sidecars und Punktdateien, 404 mit
 * Pflicht-Hinweis, Mojang-Wächter bricht ab, Function-Konfiguration (Node 24, 25 s) und Bündel ohne `node:sqlite`/MCP –
 * und das Bündel läuft außerhalb des Repos (eigener Prozess, Katalog-Kopie) mit `POST /v1/interpret` → 200 lokal.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { EXPORT_DISCLAIMER } from '@mcda/pipeline';
import { HEAVY_TIMEOUT } from '../../packages/core/test/support/slack.js';
import { NOT_FOUND_PAGE } from '../../packages/engine/src/node/notFoundPage.js';
import { SITE_HEADERS, siteCacheControl } from '../../packages/engine/src/node/site.js';
import { VERCEL_MAX_DURATION, VERCEL_NODE_RUNTIME, mojangViolations, vercelOutputConfig, type VercelRoute } from '../../packages/engine/src/node/vercelConfig.js';
import { precompressEnabled } from '../scripts/precompress.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'w8v-vercel-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function* walk(dir: string, base = dir): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, base);
    else yield relative(base, p).replaceAll('\\', '/');
  }
}

function fakeSite(dir: string, extra: Record<string, string> = {}): void {
  const files: Record<string, string> = {
    'index.html': '<!doctype html><h1>Start</h1>',
    'index.html.br': 'x', 'index.html.gz': 'x',
    '404.html': NOT_FOUND_PAGE,
    'editor/index.html': '<!doctype html><h1>Editor</h1>',
    'editor/assets/index-Abc123.js': 'export const a = 1;',
    'editor/assets/index-Abc123.js.br': 'x',
    'gallery/index.html': '<!doctype html>',
    'gallery/files/haus.litematic': 'x',
    'css/site.css': 'body{}',
    '.env': 'GEHEIM=1', '.git/config': 'x', 'editor/.hidden.js': 'x',
    ...extra,
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
}

const build = (webDir: string, out: string): ReturnType<typeof spawnSync> =>
  spawnSync(process.execPath, [join(repo, 'deploy/vercel/build.mjs'), '--web-dir', webDir, '--out', out], { cwd: repo, encoding: 'utf8' });

/** Header einer Antwort nach den Routen (vereinfachter Vercel-Router: `continue`-Regeln sammeln, spätere überschreiben). */
function headersFor(routes: readonly VercelRoute[], path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of routes) {
    if (r.handle !== undefined) break;
    if (r.src !== undefined && new RegExp(r.src).test(path)) {
      Object.assign(out, r.headers);
      if (r.continue !== true) break;
    }
  }
  return out;
}

describe('Vercel-Konfiguration aus den Konstanten des Node-Servers', () => {
  it('Sicherheits-Header überall, Cache-Regeln wie siteCacheControl, API ohne Website-Cache, /editor → 301', () => {
    const { routes } = vercelOutputConfig(['editor', 'gallery']);
    for (const [path, rel] of [['/', 'index.html'], ['/editor/', 'editor/index.html'], ['/gallery/index.html', 'gallery/index.html'], ['/editor/assets/index-Abc.js', 'editor/assets/index-Abc.js'], ['/css/site.css', 'css/site.css'], ['/gallery/files/haus.litematic', 'gallery/files/haus.litematic']] as const) {
      const h = headersFor(routes, path);
      expect(h, path).toMatchObject({ ...SITE_HEADERS, 'cache-control': siteCacheControl(rel) });
    }
    expect(headersFor(routes, '/gallery/files/haus.litematic')['content-type']).toBe('application/octet-stream');
    for (const api of ['/v1/interpret', '/healthz']) {
      expect(headersFor(routes, api), api).toEqual({ ...SITE_HEADERS });
    }
    const redirect = routes.find((r) => r.src === '^/editor$')!;
    expect(redirect).toMatchObject({ status: 301, headers: { location: '/editor/', ...SITE_HEADERS } });
    expect(routes.findIndex((r) => r.handle === 'filesystem')).toBeLessThan(routes.findIndex((r) => r.dest === '/404.html'));
    expect(routes.at(-1)).toMatchObject({ status: 404, dest: '/404.html' });
  });

  it('Mojang-Wächter erkennt Client-Dateien; Vorkomprimieren schaltbar; 404-Seite mit Pflicht-Hinweis', () => {
    expect(mojangViolations(['editor/assets/index.js', 'media/logo.png', 'gallery/thumbs/a.png'])).toEqual([]);
    expect(mojangViolations(['atlas-1.21.11.png', 'x/blockstates.json', 'models.json', 'block-flags.json', 'client.jar', 'a/assets/minecraft/textures/block/stone.png', 'editor/assets/stone.png']))
      .toHaveLength(7);
    expect(precompressEnabled({})).toBe(true);
    expect(precompressEnabled({ WEB_PRECOMPRESS: '1' })).toBe(true);
    for (const off of ['0', 'off', 'false', ' OFF ']) expect(precompressEnabled({ WEB_PRECOMPRESS: off }), off).toBe(false);
    expect(NOT_FOUND_PAGE).toContain(EXPORT_DISCLAIMER);
  });
});

describe('deploy/vercel/build.mjs', () => {
  it('baut .vercel/output: static ohne Sidecars/Punktdateien, Function mit Katalog, Bündel läuft außerhalb des Repos', () => {
    const web = join(tmp, 'site');
    const out = join(tmp, 'output');
    fakeSite(web);
    const r = build(web, out);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const shipped = [...walk(join(out, 'static'))].sort();
    expect(shipped).toEqual(['404.html', 'css/site.css', 'editor/assets/index-Abc123.js', 'editor/index.html', 'gallery/files/haus.litematic', 'gallery/index.html', 'index.html']);
    expect(readFileSync(join(out, 'static/404.html'), 'utf8')).toContain(EXPORT_DISCLAIMER);
    const config = JSON.parse(readFileSync(join(out, 'config.json'), 'utf8')) as { version: number; routes: VercelRoute[] };
    expect(config).toEqual(JSON.parse(JSON.stringify(vercelOutputConfig(['editor', 'gallery']))));
    for (const fn of ['v1/interpret', 'healthz']) {
      const dir = join(out, 'functions', `${fn}.func`);
      expect(JSON.parse(readFileSync(join(dir, '.vc-config.json'), 'utf8')), fn).toEqual({
        runtime: VERCEL_NODE_RUNTIME, handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: false, maxDuration: VERCEL_MAX_DURATION,
      });
      expect(existsSync(join(dir, 'catalog/buildingtypes')), fn).toBe(true);
    }
    const code = readFileSync(join(out, 'functions/v1/interpret.func/index.mjs'), 'utf8');
    expect(code).not.toMatch(/node:sqlite|@modelcontextprotocol|generateWorker/);
    expect(code).not.toContain('ENGINE_NL_LOG');
    // Außerhalb des Repos (keine node_modules, Katalog nur als Kopie): echte Anfrage über den Node-Listener
    const fnDir = join(tmp, 'deployed.func');
    cpSync(join(out, 'functions/v1/interpret.func'), fnDir, { recursive: true });
    const harness = join(tmp, 'harness.mjs');
    writeFileSync(harness, `
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(${JSON.stringify(join(fnDir, 'index.mjs'))}).href);
const server = createServer((req, res) => void mod.default(req, res));
server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (origin) => fetch(base + '/v1/interpret', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'http', origin }, body: JSON.stringify({ prompt: 'kleine Taverne mit Garten' }) });
  const ok = await post(base);
  const health = await fetch(base + '/healthz');
  const other = await fetch(base + '/v1/execute', { method: 'POST' });
  console.log('RESULT ' + JSON.stringify({ ok: ok.status, body: await ok.json(), foreign: (await post('https://evil.example')).status, health: await health.json(), other: other.status }));
  server.close();
});`);
    const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], SYSTEMROOT: process.env['SYSTEMROOT'] };
    const run = spawnSync(process.execPath, [harness], { cwd: tmp, encoding: 'utf8', env });
    const line = run.stdout.split('\n').find((l) => l.startsWith('RESULT '));
    expect(line, `${run.stdout}\n${run.stderr}`).toBeDefined();
    const res = JSON.parse(line!.slice(7)) as Record<string, unknown>;
    expect(res).toMatchObject({ ok: 200, body: { ok: true, model: 'local', request: { op: 'building_generate', input: { buildingTypeId: 'tavern' } } }, foreign: 403, health: { ok: true, auth: 'public' }, other: 404 });
    expect(run.stdout).toMatch(/"msg":"Function gestartet".*"localOnly":true/);
  }, HEAVY_TIMEOUT);

  it('bricht ab bei Mojang-Dateien und bei fehlender/veralteter 404-Seite', () => {
    const mojang = join(tmp, 'site-mojang');
    fakeSite(mojang, { 'editor/assets/atlas-blocks.png': 'x' });
    const r = build(mojang, join(tmp, 'out-mojang'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Mojang-Wächter/);
    expect(existsSync(join(tmp, 'out-mojang'))).toBe(false);
    const stale = join(tmp, 'site-404');
    fakeSite(stale, { '404.html': '<h1>alt</h1>' });
    const s = build(stale, join(tmp, 'out-404'));
    expect(s.status).toBe(1);
    expect(s.stderr).toMatch(/404\.html/);
  }, HEAVY_TIMEOUT);
});
