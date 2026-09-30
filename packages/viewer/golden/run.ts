/**
 * Goldene Galerie (P0-A): `npm run golden` – rendert Welten mit echten Texturen aus festen Kameras.
 *
 *   npm run golden -- [--run <name>] [--only <bautyp|id,…>] [--views <ansicht|gruppe,…>] [--nbt <ordner>] [--set <datei>]
 *                     [--size 1280x800] [--port 5195]
 *
 * Ohne `--nbt`: die goldene Menge (golden/set.json5) mit dem aktuellen Generator erzeugen, als `.nbt` in den Lauf
 * schreiben und genau aus diesen Bytes rendern. Mit `--nbt <ordner>`: alle `*.nbt` dort (z. B. Welten alter Commits
 * aus `local/golden-bisect/<commit>/`). Ausgabe: `local/golden/<lauf>/` mit PNGs, Miniaturen, `manifest.json` und
 * `index.html` (Kontaktbogen). Alles unter `local/` ist git-ignoriert: die Bilder enthalten Mojang-Texturen.
 *
 * Umgebung: `PLAYWRIGHT_CORE` (Ordner von playwright-core), `MCDA_LOCAL_DIR` (statt `local/`), `GOLDEN_GL`
 * (`metal` | `swiftshader` | `default`).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { importFile } from '@mcda/export/node';
import { analyze, type Analysis } from './lib/analyze.js';
import { deriveCameras, firstViewFor, selectViews, type ViewSpec } from './lib/cameras.js';
import { blockCounts, gridDigest, gridFromVolume } from './lib/grid.js';
import { contactSheetHtml, type SheetRow } from './lib/html.js';
import { GOLDEN_LIGHTING, scenePayload } from './lib/payload.js';
import { selectEntries, type GoldenEntry } from './lib/set.js';
import { bundleHarness, loadAssets, loadPlaywright, openBrowser, startServer } from './node/browser.js';
import { nodeClassifier } from './node/classify.js';
import { DEFAULT_SET, generateEntry, readSet, type Generated } from './node/generate.js';
import { checkRunName, commitInfo, localDir, REPO_ROOT } from './node/paths.js';
import type { SceneResult } from './browser/harness.js';

// ---------------------------------------------------------------------------------------------- Argumente

interface Args {
  readonly run?: string;
  readonly only: string[];
  readonly views: string[];
  readonly nbt?: string;
  readonly set: string;
  readonly width: number;
  readonly height: number;
  readonly port: number;
}

const HELP = `npm run golden -- [--run <name>] [--only <bautyp|id,…>] [--views <ansicht|gruppe,…>] [--nbt <ordner>] [--set <datei>] [--size 1280x800] [--port 5195]
Ansichten: praesentation (auge, auge-abend, tief), fassade(-n|-o|-s|-w), hero(-so|-nw), nah(-ecke|-traufe|-eingang), schnitt(-1…), innen(-1…)`;

function parseArgs(argv: readonly string[]): Args {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      console.log(HELP);
      process.exit(0);
    }
    if (!a.startsWith('--')) throw new Error(`Unbekanntes Argument „${a}“\n${HELP}`);
    const eq = a.indexOf('=');
    if (eq > 0) m.set(a.slice(2, eq), a.slice(eq + 1));
    else {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} braucht einen Wert`);
      m.set(a.slice(2), v);
      i++;
    }
  }
  const known = new Set(['run', 'only', 'views', 'nbt', 'set', 'size', 'port']);
  for (const k of m.keys()) if (!known.has(k)) throw new Error(`Unbekannte Option --${k}\n${HELP}`);
  const list = (k: string): string[] => (m.get(k) ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  const [w, h] = (m.get('size') ?? '1280x800').split('x').map(Number);
  if (!w || !h || w < 64 || h < 64) throw new Error('--size BxH, z. B. 1280x800');
  const run = m.get('run');
  const nbt = m.get('nbt');
  return {
    ...(run !== undefined ? { run: checkRunName(run) } : {}),
    only: list('only'), views: list('views'),
    ...(nbt !== undefined ? { nbt } : {}),
    set: m.get('set') ?? DEFAULT_SET, width: w, height: h, port: Number(m.get('port') ?? 5195),
  };
}

// ---------------------------------------------------------------------------------------------- Lauf

interface Job {
  readonly id: string;
  readonly entry?: GoldenEntry;
  /** Bytes der `.nbt`-Datei */
  load(): { nbt: Uint8Array; generated?: Generated; file: string };
}

const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
const round = (v: number): number => Math.round(v);

function analysisSummary(a: Analysis): unknown {
  return {
    groundY: a.groundY, baseY: a.baseY, building: a.building, main: a.main, components: a.components.map((c) => ({ columns: c.columns, box: c.box })),
    floors: a.floors.map((f) => ({ index: f.index, feetY: f.feetY, cells: f.cells, cutY: f.cutY, spot: f.spot })),
    doors: a.doors.length, exteriorDoors: a.doors.filter((d) => d.outward !== undefined).length,
    mainDoor: a.mainDoor, corners: a.corners,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  const local = localDir();
  const commit = commitInfo();
  const started = new Date();
  const set = readSet(args.set);
  const version = set.entries[0]?.targetVersion.name ?? '1.21.11';

  // Aufträge: goldene Menge oder .nbt-Ordner
  let jobs: Job[];
  let source: Record<string, unknown>;
  let runName: string;
  const outRoot = join(local, 'golden');
  if (args.nbt !== undefined) {
    const dir = args.nbt;
    if (!existsSync(dir)) throw new Error(`Ordner fehlt: ${dir}`);
    const files = readdirSync(dir).filter((f) => f.endsWith('.nbt')).sort();
    const byId = new Map(set.entries.map((e) => [e.id, e]));
    const wanted = files.map((f) => basename(f, '.nbt')).filter((id) => args.only.length === 0 || args.only.some((o) => id === o || id.startsWith(`${o}-`)));
    jobs = wanted.map((id) => ({ id, ...(byId.has(id) ? { entry: byId.get(id)! } : {}), load: () => ({ nbt: new Uint8Array(readFileSync(join(dir, `${id}.nbt`))), file: join(dir, `${id}.nbt`) }) }));
    source = { kind: 'nbt', dir, worldCommit: basename(dir) };
    runName = args.run ?? checkRunName(`nbt-${basename(dir)}`);
  } else {
    const entries = selectEntries(set.entries, args.only);
    jobs = entries.map((e) => ({ id: e.id, entry: e, load: () => { const g = generateEntry(e); return { nbt: g.nbt, generated: g, file: '' }; } }));
    source = { kind: 'generator', set: relative(REPO_ROOT, args.set), setSha1: createHash('sha1').update(readFileSync(args.set)).digest('hex'), worldCommit: commit.short };
    runName = args.run ?? checkRunName(`${stamp(started)}-${commit.short ?? 'ohne-git'}${commit.dirty ? '-dirty' : ''}`);
  }
  if (jobs.length === 0) throw new Error('Nichts zu rendern (Filter --only?)');
  const outDir = join(outRoot, runName);
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true }); // eigener Ausgabeordner des Laufs
  mkdirSync(join(outDir, 'nbt'), { recursive: true });
  console.log(`Goldene Galerie: ${jobs.length} Bauten → ${outDir}`);

  // Browser und Server
  const assetDir = join(local, 'mc-assets', version);
  const assets = loadAssets({ version, dir: assetDir });
  const harness = await bundleHarness();
  const server = await startServer({ port: args.port, harness, assets, outDir });
  const { pw, from } = loadPlaywright(local);
  const { browser, page, errors } = await openBrowser(pw, args.width, args.height);
  const chromium = browser.version();
  let gl = '?';
  const classifier = nodeClassifier(version);
  const entries: unknown[] = [];
  const rows: SheetRow[] = [];
  const failures: string[] = [];
  let generateMs = 0, prepareMs = 0, renderMs = 0, images = 0;
  try {
    await page.goto(server.url);
    await page.waitForFunction('window.golden && window.golden.ready === true', undefined, { timeout: 60_000 });
    gl = await page.evaluate(([w, h]) => window.golden.init(w, h, 320), [args.width, args.height] as const);
    console.log(`Renderer: ${gl} · Chromium ${chromium}`);

    for (const job of jobs) {
      const tj = performance.now();
      try {
        const loaded = job.load();
        const tg = performance.now();
        const nbtFile = join(outDir, 'nbt', `${job.id}.nbt`);
        writeFileSync(nbtFile, loaded.nbt);
        const volume = importFile('nbt', loaded.nbt);
        const grid = gridFromVolume(volume, classifier.classify);
        const a = analyze(grid);
        const [gx, gy, gz] = grid.size;
        // Sichtlinien der Augenhöhe: belegt = Block mit Körper (keine Gräser/Blumen/Fackeln: Klasse „flat“/„thin“)
        const solid = (x: number, y: number, z: number): boolean => {
          if (x < 0 || y < 0 || z < 0 || x >= gx || y >= gy || z >= gz) return false;
          const p = grid.cells[x + gx * (z + gz * y)]!;
          if (p === 0) return false;
          const c = grid.traits[p]!.cls;
          return c === 'full' || c === 'tall' || c === 'half';
        };
        const type = job.entry?.type ?? job.id.split('-')[0];
        const cams = deriveCameras(a, { aspect: args.width / args.height, buried: type === 'hobbit', solid, first: firstViewFor(type) });
        const views: ViewSpec[] = selectViews(cams.views, args.views);
        const payload = scenePayload(job.id, grid, cams.variants, views, classifier);
        server.scenes.set(job.id, JSON.stringify(payload));
        const tp = performance.now();
        const result: SceneResult = await page.evaluate((id) => window.golden.renderScene(id), job.id);
        server.scenes.delete(job.id);
        const tr = performance.now();
        generateMs += tg - tj; prepareMs += tp - tg; renderMs += tr - tp; images += views.length;
        const counts = blockCounts(grid);
        const e = job.entry;
        entries.push({
          id: job.id,
          ...(e !== undefined ? { type: e.type, theme: e.theme, variant: e.variant, seed: e.seed, size: e.size } : {}),
          nbt: relative(outDir, nbtFile), ...(loaded.file !== '' ? { source: loaded.file } : {}),
          digest: gridDigest(grid), dimensions: grid.size, blocks: counts, entities: volume.entities.length, frames: grid.frames.length,
          palette: grid.palette.length - 1,
          analysis: analysisSummary(a),
          ...(loaded.generated !== undefined ? { truth: loaded.generated.truth } : {}),
          ms: { generate: round(tg - tj), prepare: round(tp - tg), render: round(tr - tp) },
          render: result.variants,
          views: views.map((v) => ({ name: v.name, label: v.label, group: v.group, file: `${job.id}/${v.name}.png`, thumb: `${job.id}/thumb/${v.name}.jpg`, variant: v.variant, projection: v.projection, orbit: v.orbit })),
        });
        const unknown = [...new Set(result.variants.flatMap((v) => v.unknownBlocks))];
        const title = e !== undefined ? `${e.type} · ${e.theme}${e.variant ? ' (Variante)' : ''}` : job.id;
        rows.push({
          id: job.id, title,
          facts: [
            ...(e !== undefined ? [`Größe ${e.size} · Seed ${e.seed}`] : []),
            `${grid.size.join(' × ')} · ${counts.total.toLocaleString('de-DE')} Blöcke (${counts.natural.toLocaleString('de-DE')} Gelände)`,
            `Etagen: ${a.floors.length === 0 ? '–' : a.floors.map((f) => `y${f.feetY}`).join(', ')}`,
            `Haupttür: ${a.mainDoor === undefined ? '–' : `${a.mainDoor.pos.join(',')} → ${a.mainDoor.outward}`}`,
            `Prüfsumme ${gridDigest(grid)}`,
            ...(unknown.length > 0 ? [`unbekannte Blöcke: ${unknown.join(', ')}`] : []),
          ],
          views: views.map((v) => ({ name: v.name, label: v.label, group: v.group, image: `${job.id}/${v.name}.png`, thumb: `${job.id}/thumb/${v.name}.jpg` })),
        });
        console.log(`  ${job.id}: ${views.length} Bilder, ${counts.total} Blöcke, erzeugen ${round(tg - tj)} ms, vorbereiten ${round(tp - tg)} ms, rendern ${round(tr - tp)} ms${unknown.length > 0 ? `, unbekannt: ${unknown.join(', ')}` : ''}`);
      } catch (err) {
        const msg = `${job.id}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
        failures.push(msg);
        console.error(`  FEHLER ${msg}`);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const totalMs = performance.now() - t0;
  const manifest = {
    tool: 'golden', format: 1, run: runName, createdAt: started.toISOString(),
    commit, source,
    render: {
      width: args.width, height: args.height, thumbWidth: 320, lighting: GOLDEN_LIGHTING, assets: { version, dir: assetDir },
      playwright: from, chromium, gl, glArgs: process.env['GOLDEN_GL'] ?? 'standard',
    },
    filters: { only: args.only, views: args.views },
    timings: { totalMs: round(totalMs), generateMs: round(generateMs), prepareMs: round(prepareMs), renderMs: round(renderMs), images },
    entries, failures, browserErrors: errors,
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  const srcLine = source['kind'] === 'nbt' ? `Quelle: .nbt aus ${String(source['dir'])}` : `Quelle: Generator (goldene Menge ${String(source['set'])})`;
  writeFileSync(join(outDir, 'index.html'), contactSheetHtml({
    title: `Goldene Galerie – ${runName}`,
    lines: [
      `${srcLine} · Werkzeug-Commit ${commit.short ?? '?'}${commit.dirty ? ' (mit lokalen Änderungen)' : ''} auf ${commit.branch ?? '?'} · ${started.toLocaleString('de-DE')}`,
      `${rows.length} Bauten, ${images} Bilder ${args.width}×${args.height} · Mittag, Helligkeit 50 % · Laufzeit ${(totalMs / 1000).toFixed(1)} s${failures.length > 0 ? ` · ${failures.length} FEHLER (manifest.json)` : ''}`,
    ],
  }, rows));
  console.log(`Fertig in ${(totalMs / 1000).toFixed(1)} s (erzeugen ${(generateMs / 1000).toFixed(1)} s, vorbereiten ${(prepareMs / 1000).toFixed(1)} s, rendern ${(renderMs / 1000).toFixed(1)} s): ${images} Bilder`);
  console.log(`Kontaktbogen: ${join(outDir, 'index.html')}`);
  if (errors.length > 0) console.warn(`Browser-Meldungen: ${errors.length} (manifest.json)`);
  if (failures.length > 0) {
    console.error(`${failures.length} Bau(ten) fehlgeschlagen`);
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
