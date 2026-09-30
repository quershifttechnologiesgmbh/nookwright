/**
 * Lädt die Rohdaten für die Plattform-Daten nach packages/platform/raw/ (gitignored).
 *
 * Quellen:
 *  - misode/mcmeta (GitHub). Namensschema der Tags: `<version>-<branch>`, z. B. `1.21.11-summary`,
 *    `26.3-registries`, `26.3-atlas`. Die Branches `summary`, `registries`, `atlas` … zeigen immer auf die
 *    NEUESTE Version (auch Snapshots). Deshalb wird ausschließlich über Versions-Tags geladen; die Versionen
 *    sind in src/versions.ts fest gepinnt.
 *      <v>-summary    → blocks/data.min.json          (Block → [Properties mit Werten, Default-State])
 *                     → version.json                  (DataVersion etc.)
 *                     → data/tag/block/data.min.json  (Block-Tags, z. B. #climbable)
 *      <v>-registries → item/data.min.json            (Item-IDs)
 *                     → loot_table/data.min.json      (Loot-Table-IDs, nur die Liste, nicht der Inhalt)
 *      <latest>-atlas → blocks/atlas.png + data.min.json (nur für mittlere Blockfarben → Fallback-Ähnlichkeit)
 *  - PrismarineJS/minecraft-data (GitHub, master): data/pc/<v>/blockCollisionShapes.json + blocks.json
 *    (blocks.json wird für die State-Reihenfolge benötigt).
 *
 * Aufruf: `npm run fetch -w @mcda/platform` (optional `-- --force` zum erneuten Laden).
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_VERSIONS, LATEST_VERSION, PRISMARINE_VERSIONS } from '../src/build/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'raw');
const MCMETA = 'https://raw.githubusercontent.com/misode/mcmeta';
const PRISMARINE = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc';
const force = process.argv.includes('--force');

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function rel(p: string): string {
  return p.slice(ROOT.length + 1);
}

async function download(url: string, target: string, binary = false): Promise<void> {
  if (!force && (await exists(target))) {
    console.log(`  = ${rel(target)} (vorhanden)`);
    return;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!binary) JSON.parse(buf.toString('utf8')); // Validierung: muss JSON sein
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buf);
  console.log(`  + ${rel(target)} (${(buf.length / 1024).toFixed(0)} KiB)`);
}

async function main(): Promise<void> {
  for (const v of BUILD_VERSIONS) {
    console.log(`mcmeta ${v}`);
    const dir = join(RAW, 'mcmeta', v);
    await download(`${MCMETA}/${v}-summary/version.json`, join(dir, 'version.json'));
    await download(`${MCMETA}/${v}-summary/blocks/data.min.json`, join(dir, 'blocks.json'));
    await download(`${MCMETA}/${v}-summary/data/tag/block/data.min.json`, join(dir, 'block_tags.json'));
    await download(`${MCMETA}/${v}-registries/item/data.min.json`, join(dir, 'items.json'));
    await download(`${MCMETA}/${v}-registries/loot_table/data.min.json`, join(dir, 'loot_tables.json'));
  }
  // Textur-Atlas nur für die neueste Version. Daraus werden mittlere Blockfarben berechnet;
  // in data/ landen nur diese abgeleiteten Farbwerte, keine Texturen.
  console.log(`mcmeta atlas ${LATEST_VERSION}`);
  await download(`${MCMETA}/${LATEST_VERSION}-atlas/blocks/data.min.json`, join(RAW, 'mcmeta', LATEST_VERSION, 'atlas.json'));
  await download(`${MCMETA}/${LATEST_VERSION}-atlas/blocks/atlas.png`, join(RAW, 'mcmeta', LATEST_VERSION, 'atlas.png'), true);

  for (const v of PRISMARINE_VERSIONS) {
    console.log(`prismarine ${v}`);
    const dir = join(RAW, 'prismarine', v);
    await download(`${PRISMARINE}/${v}/blockCollisionShapes.json`, join(dir, 'blockCollisionShapes.json'));
    await download(`${PRISMARINE}/${v}/blocks.json`, join(dir, 'blocks.json'));
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
