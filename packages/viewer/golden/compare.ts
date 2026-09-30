/**
 * Goldene Galerie (P0-A): `npm run golden:compare -- <laufA> <laufB> [--threshold 16]`
 *
 * Paart die Bilder zweier Läufe (`<bau>/<ansicht>.png`), misst je Paar den Anteil veränderter Pixel und schreibt
 * `local/golden/compare-<A>-<B>/index.html` (nebeneinander, Umschalten A↔B, Differenzbild, sortiert nach größter
 * Änderung) sowie `compare.json`. Läufe als Name unter `local/golden/` oder als Pfad.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { decodePng, encodePng } from '../src/assets/png.js';
import { DEFAULT_THRESHOLD, diffImages, downscale } from './lib/diff.js';
import { compareHtml, type CompareItem } from './lib/html.js';
import { localDir } from './node/paths.js';

const HELP = 'npm run golden:compare -- <laufA> <laufB> [--threshold 16] [--out <ordner>]';

function runDir(arg: string): string {
  if (existsSync(arg) && statSync(arg).isDirectory()) return resolve(arg);
  const inLocal = join(localDir(), 'golden', arg);
  if (existsSync(inLocal)) return inLocal;
  throw new Error(`Lauf nicht gefunden: ${arg} (weder Pfad noch ${inLocal})`);
}

/** `<id>/<ansicht>.png` eines Laufs (ohne Miniaturen und Vergleichsordner). */
function imageKeys(dir: string): string[] {
  const out: string[] = [];
  for (const id of readdirSync(dir).sort()) {
    const sub = join(dir, id);
    if (id === 'nbt' || id === 'thumb' || !statSync(sub).isDirectory()) continue;
    for (const f of readdirSync(sub).sort()) if (f.endsWith('.png')) out.push(`${id}/${f.slice(0, -4)}`);
  }
  return out;
}

function manifestLine(dir: string): string {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      run?: string; createdAt?: string; commit?: { short?: string; dirty?: boolean; branch?: string }; source?: { kind?: string; dir?: string; worldCommit?: string };
    };
    const src = m.source?.kind === 'nbt' ? `.nbt aus ${m.source.dir ?? '?'}` : `Generator @ ${m.source?.worldCommit ?? m.commit?.short ?? '?'}`;
    return `${m.run ?? basename(dir)}: ${src}, Werkzeug ${m.commit?.short ?? '?'}${m.commit?.dirty ? '+' : ''} (${m.commit?.branch ?? '?'}), ${m.createdAt ?? ''}`;
  } catch {
    return `${basename(dir)}: ohne manifest.json`;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return;
  }
  const pos: string[] = [];
  let threshold = DEFAULT_THRESHOLD;
  let outArg: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--threshold') threshold = Number(args[++i]);
    else if (a.startsWith('--threshold=')) threshold = Number(a.slice(12));
    else if (a === '--out') outArg = args[++i];
    else if (a.startsWith('--')) throw new Error(`Unbekannte Option ${a}\n${HELP}`);
    else pos.push(a);
  }
  if (pos.length !== 2 || !Number.isFinite(threshold)) throw new Error(HELP);
  const t0 = performance.now();
  const [dirA, dirB] = [runDir(pos[0]!), runDir(pos[1]!)];
  const [nameA, nameB] = [basename(dirA), basename(dirB)];
  const outDir = outArg !== undefined ? resolve(outArg) : join(localDir(), 'golden', `compare-${nameA}-${nameB}`);
  mkdirSync(outDir, { recursive: true });
  const keysA = imageKeys(dirA), keysB = imageKeys(dirB);
  const setB = new Set(keysB), setA = new Set(keysA);
  const both = keysA.filter((k) => setB.has(k));
  const inflate = (d: Uint8Array): Uint8Array => new Uint8Array(inflateSync(d));
  const deflate = (d: Uint8Array): Uint8Array => new Uint8Array(deflateSync(d, { level: 6 }));
  const rel = (p: string): string => relative(outDir, p).split('\\').join('/');
  const thumbOf = (dir: string, key: string): string => {
    const [id, view] = key.split('/') as [string, string];
    const t = join(dir, id, 'thumb', `${view}.jpg`);
    return existsSync(t) ? rel(t) : rel(join(dir, `${key}.png`));
  };
  const items: CompareItem[] = [];
  for (const key of both) {
    const [id, view] = key.split('/') as [string, string];
    const fa = join(dirA, `${key}.png`), fb = join(dirB, `${key}.png`);
    const a = decodePng(new Uint8Array(readFileSync(fa)), inflate);
    const b = decodePng(new Uint8Array(readFileSync(fb)), inflate);
    const d = diffImages(a, b, threshold, true);
    let diff: string | undefined, diffThumb: string | undefined;
    if (d.image !== undefined && d.changed > 0) {
      const dd = join(outDir, 'diff', id);
      mkdirSync(join(dd, 'thumb'), { recursive: true });
      writeFileSync(join(dd, `${view}.png`), encodePng(d.image, deflate));
      writeFileSync(join(dd, 'thumb', `${view}.png`), encodePng(downscale(d.image, 320), deflate));
      diff = rel(join(dd, `${view}.png`));
      diffThumb = rel(join(dd, 'thumb', `${view}.png`));
    }
    items.push({
      key, percent: d.percent, a: rel(fa), b: rel(fb), aThumb: thumbOf(dirA, key), bThumb: thumbOf(dirB, key),
      ...(diff !== undefined ? { diff } : {}), ...(diffThumb !== undefined ? { diffThumb } : {}),
      ...(!d.sameSize ? { note: `Bildgröße verschieden (${a.width}×${a.height} / ${b.width}×${b.height})` } : {}),
    });
  }
  const onlyA = keysA.filter((k) => !setB.has(k)), onlyB = keysB.filter((k) => !setA.has(k));
  const sorted = [...items].sort((x, y) => y.percent - x.percent || (x.key < y.key ? -1 : 1));
  writeFileSync(join(outDir, 'compare.json'), `${JSON.stringify({
    a: dirA, b: dirB, threshold, createdAt: new Date().toISOString(),
    pairs: sorted.map((i) => ({ key: i.key, percent: Math.round(i.percent * 1000) / 1000 })), onlyA, onlyB,
  }, null, 1)}\n`);
  writeFileSync(join(outDir, 'index.html'), compareHtml({
    title: `Vergleich ${nameA} ↔ ${nameB}`,
    lines: [`A = ${manifestLine(dirA)}`, `B = ${manifestLine(dirB)}`, `Schwelle ${threshold}/255 je Kanal · ${((performance.now() - t0) / 1000).toFixed(1)} s`],
  }, items, onlyA, onlyB, [nameA, nameB]));
  const changed = items.filter((i) => i.percent > 0);
  console.log(`${items.length} Paare, ${changed.length} verändert, nur A: ${onlyA.length}, nur B: ${onlyB.length}`);
  for (const i of sorted.slice(0, 10)) console.log(`  ${i.percent.toFixed(2).padStart(6)} %  ${i.key}`);
  console.log(`Vergleich: ${join(outDir, 'index.html')}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
