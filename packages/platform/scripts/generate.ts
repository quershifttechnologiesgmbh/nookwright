/**
 * Generator: raw/ → data/ (eingecheckt, deterministisch) und raw/reports/ (gitignored, nur zum Review).
 *
 *   data/registry-<v>.json   Blöcke (Property-Enums + Defaults), Items, Loot-Tables, Block-Tags
 *   data/families-<v>.json   Familie × Form, Lücken, Fallback-Ketten, Versions-Fallbacks
 *   data/physics-<v>.json    Physik-Klasse + Flags je Block, unbekannte Blöcke
 *   data/index.json          Versionen (id, DataVersion)
 *
 *   raw/reports/families-<v>.md, diff-<a>_<b>.json, summary.json
 *
 * Aufruf: `npm run generate -w @mcda/platform` (vorher `npm run fetch -w @mcda/platform`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { averageColors, colorOfBlock, decodePng, toHex, type AtlasIndex } from '../src/build/colors.js';
import { LATEST_VERSION, PRISMARINE_PRIMARY, PRISMARINE_SUPPLEMENT } from '../src/build/config.js';
import { diffRegistries, type RegistryDiff } from '../src/build/diff.js';
import { computeVersionFallbacks, deriveFamilies } from '../src/build/families.js';
import { collisionSource, computePhysics, type PrismarineBlock, type PrismarineShapes } from '../src/build/physics.js';
import { buildRegistry, type McmetaBlocks, type McmetaTags } from '../src/build/registry.js';
import { buildSummary, familiesMarkdown } from '../src/build/report.js';
import { DATA_FILES, type PlatformIndex } from '../src/port.js';
import type { FamilyData, PhysicsData, RegistryData } from '../src/types.js';
import { PLATFORM_VERSIONS } from '../src/versions.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'raw');
const DATA = join(ROOT, 'data');
const REPORTS = join(RAW, 'reports');
mkdirSync(DATA, { recursive: true });
mkdirSync(REPORTS, { recursive: true });

const readJson = <T>(...p: string[]): T => JSON.parse(readFileSync(join(RAW, ...p), 'utf8')) as T;
const writeTo = (dir: string, label: string, file: string, data: unknown, pretty = false): void => {
  const text = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  writeFileSync(join(dir, file), `${text}\n`);
  console.log(`  → ${label}/${file} (${(text.length / 1024).toFixed(0)} KiB)`);
};
const writeData = (file: string, data: unknown, pretty = false): void => writeTo(DATA, 'data', file, data, pretty);
const writeReport = (file: string, data: unknown): void => writeTo(REPORTS, 'raw/reports', file, data, true);

// ------------------------------------------------------------ Farben (einmal, neueste Version)
const atlasImg = decodePng(readFileSync(join(RAW, 'mcmeta', LATEST_VERSION, 'atlas.png')));
const textureColors = averageColors(atlasImg, readJson<AtlasIndex>('mcmeta', LATEST_VERSION, 'atlas.json'));
const colorOf = (b: string) => colorOfBlock(b, textureColors);

// ------------------------------------------------------------ Kollisionsquellen
const loadCollision = (v: string) =>
  collisionSource(
    v,
    readJson<PrismarineBlock[]>('prismarine', v, 'blocks.json'),
    readJson<PrismarineShapes>('prismarine', v, 'blockCollisionShapes.json'),
  );
const primary = loadCollision(PRISMARINE_PRIMARY);
const supplement = loadCollision(PRISMARINE_SUPPLEMENT);

// ------------------------------------------------------------ je Version
const registries: RegistryData[] = [];
const familyData: FamilyData[] = [];
const physicsData: PhysicsData[] = [];
for (const { id, dataVersion } of PLATFORM_VERSIONS) {
  console.log(`Version ${id}`);
  const ver = readJson<{ data_version: number }>('mcmeta', id, 'version.json');
  if (ver.data_version !== dataVersion) {
    throw new Error(`DataVersion von ${id}: mcmeta ${ver.data_version}, src/versions.ts ${dataVersion} – bitte angleichen`);
  }
  const reg = buildRegistry({
    version: id,
    dataVersion: ver.data_version,
    blocks: readJson<McmetaBlocks>('mcmeta', id, 'blocks.json'),
    items: readJson<string[]>('mcmeta', id, 'items.json'),
    lootTables: readJson<string[]>('mcmeta', id, 'loot_tables.json'),
    blockTags: readJson<McmetaTags>('mcmeta', id, 'block_tags.json'),
  });
  registries.push(reg);
  writeData(DATA_FILES.registry(id), reg);

  familyData.push(deriveFamilies(id, Object.keys(reg.blocks), colorOf, toHex));
  const phys = computePhysics(reg, primary, supplement);
  physicsData.push(phys);
  writeData(DATA_FILES.physics(id), phys);
}

// Versions-Fallbacks relativ zur neuesten Version, dann Familien schreiben
const newestFamilies = familyData[familyData.length - 1]?.families ?? {};
for (let i = 0; i < familyData.length; i++) {
  const fd = familyData[i] as FamilyData;
  const withVf: FamilyData = { ...fd, versionFallbacks: computeVersionFallbacks(fd.families, newestFamilies) };
  familyData[i] = withVf;
  writeData(DATA_FILES.families(fd.version), withVf);
  writeFileSync(join(REPORTS, `families-${fd.version}.md`), familiesMarkdown(withVf));
  console.log(`  → raw/reports/families-${fd.version}.md`);
}

const index: PlatformIndex = { versions: registries.map((r) => ({ id: r.version, dataVersion: r.dataVersion })) };
writeData(DATA_FILES.index, index, true);

// ------------------------------------------------------------ Berichte (nicht eingecheckt)
const diffs: RegistryDiff[] = [];
for (let i = 1; i < registries.length; i++) {
  const d = diffRegistries(registries[i - 1] as RegistryData, registries[i] as RegistryData);
  diffs.push(d);
  writeReport(`diff-${d.from}_${d.to}.json`, d);
}
writeReport(
  'summary.json',
  buildSummary({
    registries,
    families: familyData,
    physics: physicsData,
    diffs,
    primaryCollisionBlocks: new Set(primary.blocks.keys()),
    sources: {
      mcmeta: registries.map((r) => `${r.version}-summary / ${r.version}-registries`),
      prismarine: [PRISMARINE_PRIMARY, PRISMARINE_SUPPLEMENT],
      atlas: `${LATEST_VERSION}-atlas`,
    },
  }),
);
