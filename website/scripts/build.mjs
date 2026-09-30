// Baut die Website nach website/dist/ – eine App mit Seite, Editor und KI-Architekt:
//  1. Editor (packages/app) mit relativen Pfaden nach dist/editor/ (die Seite bettet editor/index.html?embed=1 als
//     iframe ein). VITE_ENGINE_URL=.. → der Editor ruft /v1/interpret am selben Ursprung (npm run web).
//  2. Seite (index.html, css, js, media, scenes, gallery) nach dist/
//  3. three.js aus node_modules nach dist/vendor/three/ (nur die benutzten Module) + Import-Map darauf
//  4. Schriften aus tools/public-support/fonts nach dist/fonts/, Lizenz OFL.txt (SIL OFL 1.1) nach dist/fonts/ und
//     dist/editor/assets/ (der Editor bündelt Inter und JetBrains Mono) – ohne Lizenzdatei bricht der Build ab
//  5. ki/vocabulary.json (scripts/build-vocabulary.ts): Namen statt IDs für die Plan-Karte des KI-Architekten
//  6. 404.html mit Pflicht-Hinweis (Quelle: packages/engine/src/node/notFoundPage.ts, wie die 404 des Servers)
//  7. Vorkomprimieren (scripts/precompress.mjs): `.br` (Brotli 11) und `.gz` (gzip 9) neben jede Text-Datei ab 1 KiB;
//     `npm run web` liefert sie bevorzugt aus (packages/engine/src/node/site.ts). WEB_PRECOMPRESS=0 schaltet das ab
//     (Vercel komprimiert selbst, deploy/vercel/build.mjs)
// Aufruf (Repo-Wurzel): npm run web:build bzw. node website/scripts/build.mjs – danach dist/ mit `npm run web`
// ausliefern (Seite + Editor + API + JEV) oder auf ein reines Datei-Hosting legen (dann ohne JEV, der Editor erkennt lokal).
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFontLicense, copyFonts } from './fonts.mjs';
import { precompressDir, precompressEnabled } from './precompress.mjs';
import { tsImport } from 'tsx/esm/api';
import { exitCode, localBin } from './bin.mjs';
import { buildAuthConfig } from '../js/auth-config.js';

const site = fileURLToPath(new URL('..', import.meta.url));
const repo = join(site, '..');
const dist = join(site, 'dist');
// Optional local env; only the publishable key is serialized below.
if (existsSync(join(repo, '.env'))) process.loadEnvFile(join(repo, '.env'));
const authConfig = buildAuthConfig(process.env);
const fail = (msg) => { console.error(`build.mjs: ${msg}`); process.exit(1); };
const run = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) process.exit(exitCode(r));
};
const fontSrc = join(repo, 'tools/public-support/fonts');
// vor dem langsamen Editor-Build: ohne Lizenz der Schriften keine Auslieferung
try { checkFontLicense(fontSrc); } catch (e) { fail(e.message); }
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. Editor
run(process.execPath, [localBin(repo, 'vite'), 'build', '--base', './', '--outDir', join(dist, 'editor'), '--emptyOutDir'], {
  cwd: join(repo, 'packages/app'),
  env: { ...process.env, VITE_ENGINE_URL: '..' },
});
if (!existsSync(join(dist, 'editor/index.html'))) fail('editor/index.html fehlt nach dem Vite-Build');

// 2. Seite
for (const p of ['css', 'js', 'media', 'scenes', 'gallery']) {
  if (existsSync(join(site, p))) cpSync(join(site, p), join(dist, p), { recursive: true });
}
// Import-Map der Quellseite zeigt auf node_modules (Entwicklung) → im Build auf ./vendor/three/ (Werte einer
// Import-Map müssen mit /, ./ oder ../ beginnen, sonst ignoriert der Browser sie)
const html = readFileSync(join(site, 'index.html'), 'utf8');
const importMap = /<script type="importmap">[^<]*<\/script>/.exec(html)?.[0];
if (importMap === undefined || !importMap.includes('"/node_modules/three/')) fail('index.html: Import-Map mit /node_modules/three/ fehlt');
writeFileSync(join(dist, 'index.html'), html.replace(importMap, importMap.replaceAll('"/node_modules/three/', '"./vendor/three/')));
mkdirSync(join(dist, 'config'), { recursive: true });
writeFileSync(join(dist, 'config/auth.json'), JSON.stringify(authConfig) + '\n');
for (const name of ['LICENSE', 'LICENSE_SCOPE.md', 'THIRD_PARTY_NOTICES.md']) {
  if (existsSync(join(repo, name))) copyFileSync(join(repo, name), join(dist, name));
}

// 3. three.js: Einstiege = alle three-Importe der Website-Skripte, dann relative Importe rekursiv
const threeRoot = join(repo, 'node_modules/three');
const threeOut = join(dist, 'vendor/three');
const IMPORT = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
const specifiers = (code) => [...code.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3]);
/** Bare-Specifier wie in der Import-Map: three → build/three.module.js, three/addons/x → examples/jsm/x */
const bare = (spec) => {
  if (spec === 'three') return join(threeRoot, 'build/three.module.js');
  if (spec.startsWith('three/addons/')) return join(threeRoot, 'examples/jsm', spec.slice('three/addons/'.length));
  return undefined;
};
const queue = [];
for (const f of readdirSync(join(site, 'js')).filter((n) => n.endsWith('.js'))) {
  for (const spec of specifiers(readFileSync(join(site, 'js', f), 'utf8'))) {
    if (spec.startsWith('.')) continue;
    const file = bare(spec);
    if (file === undefined) fail(`js/${f}: unbekannter Import '${spec}' (nur three und three/addons/ sind in der Import-Map)`);
    queue.push(file);
  }
}
const copied = new Set();
while (queue.length > 0) {
  const file = queue.pop();
  if (copied.has(file)) continue;
  if (!existsSync(file)) fail(`three.js-Modul fehlt: ${relative(repo, file)}`);
  copied.add(file);
  const out = join(threeOut, relative(threeRoot, file));
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(file, out);
  for (const spec of specifiers(readFileSync(file, 'utf8'))) {
    const dep = spec.startsWith('.') ? resolve(dirname(file), spec) : bare(spec);
    if (dep === undefined) fail(`${relative(repo, file)}: unbekannter Import '${spec}'`);
    queue.push(dep);
  }
}
copyFileSync(join(threeRoot, 'LICENSE'), join(threeOut, 'LICENSE'));
const threeVersion = JSON.parse(readFileSync(join(threeRoot, 'package.json'), 'utf8')).version;

// 4. Schriften und Lizenz (variable Schriften: eine Datei je Familie; Teilmenge Latein, wie von Google Fonts ausgeliefert)
try {
  copyFonts({ srcDir: fontSrc, fontsOut: join(dist, 'fonts'), licenseOut: [join(dist, 'editor/assets')] });
} catch (e) { fail(e.message); }
writeFileSync(join(dist, 'fonts/README.txt'), [
  'Schriften dieser Website (selbst ausgeliefert, Teilmenge Latein wie von Google Fonts bereitgestellt):',
  '- Unbounded       https://github.com/googlefonts/unbounded',
  '- Inter           https://github.com/rsms/inter',
  '- JetBrains Mono  https://github.com/JetBrains/JetBrainsMono',
  'Alle stehen unter der SIL Open Font License, Version 1.1 – Lizenztext mit Copyright-Zeilen: OFL.txt',
  '',
].join('\n'));

// 5. Vokabular des KI-Architekten
run(process.execPath, [localBin(repo, 'tsx'), join(site, 'scripts/build-vocabulary.ts'), dist], { cwd: repo });

// 6. 404-Seite mit Pflicht-Hinweis (dieselbe Quelle wie die 404 des Node-Servers, site.ts); statische Hoster wie
//    Vercel liefern sie für unbekannte Pfade
const { NOT_FOUND_PAGE } = await tsImport('../../packages/engine/src/node/notFoundPage.ts', import.meta.url);
writeFileSync(join(dist, '404.html'), NOT_FOUND_PAGE);

// 7. Vorkomprimieren – als letzter Schritt, damit jede Datei ihre endgültige Fassung hat; WEB_PRECOMPRESS=0 → aus
let sidecars = 'ohne .br/.gz (WEB_PRECOMPRESS=0)';
if (precompressEnabled(process.env)) {
  const t0 = performance.now();
  const pc = await precompressDir(dist);
  const kib = (n) => `${(n / 1024).toFixed(0)} KiB`;
  console.log(`→ vorkomprimiert: ${pc.files} Dateien, ${kib(pc.raw)} → br ${kib(pc.br)} / gzip ${kib(pc.gzip)} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  sidecars = '.br/.gz';
}

console.log(`→ ${dist} (Editor, Seite, three.js ${threeVersion}: ${copied.size} Module, Schriften, ki/vocabulary.json, 404.html, ${sidecars})`);
