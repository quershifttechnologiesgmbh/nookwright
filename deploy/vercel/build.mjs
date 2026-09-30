// Vercel-Build (W8-V, Build Output API v3): baut `.vercel/output/` aus der Website und EINER Function.
//  1. Website ohne .br/.gz bauen (`WEB_PRECOMPRESS=0 node website/scripts/build.mjs`; Vercel komprimiert selbst)
//  2. Prüfen: 404.html mit Pflicht-Hinweis, Mojang-Wächter (keine Client-JAR-/Textur-Dateien), dann nach `static/`
//     kopieren – ohne Sidecars (.br/.gz) und ohne Punktdateien
//  3. Function bündeln (esbuild, ESM, Node 24): `packages/engine/src/node/vercelEntry.ts` → `functions/v1/interpret.func`
//     mit Katalog-Kopie (`catalog/`), dieselbe Function unter `functions/healthz.func`; das Bündel darf weder
//     `node:sqlite` noch MCP-SDK oder Worker-Pool enthalten
//  4. `config.json`: Routen/Header aus site.ts (packages/engine/src/node/vercelConfig.ts)
// Aufruf (Repo-Wurzel): node deploy/vercel/build.mjs [--web-dir <gebautes dist>] [--out <dir>] [--skip-web-build]
//   --web-dir: vorhandenes Website-Verzeichnis nutzen (dann kein Website-Build); Standard website/dist nach Build
//   Danach: npx vercel@latest deploy --prebuilt (Preview). Getestet in website/test/vercel-output.test.ts.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const fail = (msg) => { console.error(`deploy/vercel/build.mjs: ${msg}`); process.exit(1); };
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) fail(`${name} braucht einen Wert`);
  return v;
};
const webDirArg = arg('--web-dir');
const out = resolve(arg('--out') ?? join(repo, '.vercel/output'));
const webDir = resolve(webDirArg ?? join(repo, 'website/dist'));

const cfg = await tsImport('../../packages/engine/src/node/vercelConfig.ts', import.meta.url);
const { NOT_FOUND_PAGE } = await tsImport('../../packages/engine/src/node/notFoundPage.ts', import.meta.url);

// 1. Website
if (webDirArg === undefined && !args.includes('--skip-web-build')) {
  const r = spawnSync(process.execPath, [join(repo, 'website/scripts/build.mjs')], { stdio: 'inherit', cwd: repo, env: { ...process.env, WEB_PRECOMPRESS: '0' } });
  if (r.status !== 0) fail(`Website-Build fehlgeschlagen (Exit ${r.status})`);
}
if (!existsSync(join(webDir, 'index.html'))) fail(`${webDir}/index.html fehlt – Website nicht gebaut`);

// 2. Prüfen und kopieren
/** Dateien relativ zu `dir` (mit /), Symlinks werden nicht verfolgt. */
function* walk(dir, base = dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, base);
    else if (e.isFile()) yield relative(base, p).replaceAll('\\', '/');
  }
}
const files = [...walk(webDir)];
const notFound = join(webDir, '404.html');
if (!existsSync(notFound)) fail('404.html fehlt (website/scripts/build.mjs schreibt sie)');
if (readFileSync(notFound, 'utf8') !== NOT_FOUND_PAGE) fail('404.html weicht von notFoundPage.ts ab (Pflicht-Hinweis) – Website neu bauen');
const mojang = cfg.mojangViolations(files);
if (mojang.length > 0) fail(`Mojang-Wächter: ${mojang.length} verbotene Datei(en) im Build, u. a. ${mojang.slice(0, 5).join(', ')}`);
const shipped = files.filter((f) => !cfg.isSidecar(f) && !cfg.isDotPath(f));
const dropped = files.length - shipped.length;

rmSync(out, { recursive: true, force: true });
const staticDir = join(out, 'static');
for (const f of shipped) {
  const to = join(staticDir, f);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(join(webDir, f), to);
}
const directories = [...new Set(shipped.filter((f) => f.endsWith('/index.html')).map((f) => f.slice(0, -'/index.html'.length)))];

// 3. Function
const { build } = await import('esbuild');
const [first, ...aliases] = cfg.VERCEL_FUNCTIONS;
const funcDir = join(out, 'functions', `${first}.func`);
const bundle = await build({
  entryPoints: [join(repo, 'packages/engine/src/node/vercelEntry.ts')],
  outfile: join(funcDir, 'index.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true, logLevel: 'warning', legalComments: 'none',
  // CJS-Abhängigkeiten rufen `require` für Node-Module auf; im ESM-Bündel bereitstellen
  banner: { js: "import { createRequire as __mcdaCreateRequire } from 'node:module'; const require = __mcdaCreateRequire(import.meta.url);" },
});
const inputs = Object.keys(bundle.metafile.inputs);
const imports = Object.values(bundle.metafile.inputs).flatMap((i) => i.imports.map((x) => x.path));
const forbidden = [...inputs, ...imports].filter((p) => /node:sqlite|@modelcontextprotocol|generatePool|sqliteStore|[\\/]node[\\/]mcp\.ts$/.test(p));
if (forbidden.length > 0) fail(`Function-Bündel enthält Verbotenes: ${[...new Set(forbidden)].slice(0, 5).join(', ')}`);
// Katalog (nur *.json5) ins Function-Paket
const catalogSrc = join(repo, 'catalog');
let catalogFiles = 0;
for (const f of walk(catalogSrc)) {
  if (!f.endsWith('.json5')) continue;
  const to = join(funcDir, 'catalog', f);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(join(catalogSrc, f), to);
  catalogFiles += 1;
}
writeFileSync(join(funcDir, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`);
writeFileSync(join(funcDir, '.vc-config.json'), `${JSON.stringify(cfg.vercelFunctionConfig(), null, 2)}\n`);
for (const a of aliases) cpSync(funcDir, join(out, 'functions', `${a}.func`), { recursive: true });

// 4. Routen
writeFileSync(join(out, 'config.json'), `${JSON.stringify(cfg.vercelOutputConfig(directories), null, 2)}\n`);

const mib = (n) => `${(n / 1024 / 1024).toFixed(1)} MiB`;
const size = (dir) => [...walk(dir)].reduce((s, f) => s + statSync(join(dir, f)).size, 0);
console.log(`→ ${relative(repo, out) || out}: static ${shipped.length} Dateien (${mib(size(staticDir))}, ${dropped} Sidecars/Punktdateien weggelassen), `
  + `Function ${cfg.VERCEL_FUNCTIONS.join(' + ')} (${cfg.VERCEL_NODE_RUNTIME}, Bündel ${mib(statSync(join(funcDir, 'index.mjs')).size)}, Katalog ${catalogFiles} Dateien), `
  + `Verzeichnis-Weiterleitungen: ${directories.join(', ') || '–'}`);
