/**
 * Galerie der Website: generiert Bauten mit der ECHTEN Pipeline und schreibt je Bau
 *  - gallery/<id>.json   Szene für den 3D-Viewer (Format: tools/public-support/scripts/scene.ts)
 *  - gallery/files/<id>.{litematic,schem,nbt}   die Exportdateien (Java 1.21.11), wie sie der Editor erzeugt
 * und gallery/index.json mit den Karten-Daten und je Bau Blockzahl + Fingerabdruck (`digest`, siehe gallery-entries.ts).
 * Deterministisch: gleicher Seed → gleicher Bau. Die Einträge stehen in gallery-entries.ts; der Test
 * website/test/gallery-current.test.ts schlägt fehl, sobald der Generator anders baut als die eingecheckte Galerie.
 *
 * Aufruf (Repo-Wurzel): npx tsx website/scripts/build-gallery.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportFile } from '@mcda/export/node';
import { toExport } from '../../packages/pipeline/src/index.js';
import { nodeContext } from '../../packages/pipeline/src/node-context.js';
import { sceneOf } from '../../tools/public-support/scripts/scene.js';
import { buildDigest, galleryEntries } from './gallery-entries.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const ctx = nodeContext(join(here, '../../catalog'));
const outDir = join(here, '../gallery');
mkdirSync(join(outDir, 'files'), { recursive: true });
const ENTRIES = galleryEntries(ctx);

const THEME_NAMES: Record<string, string> = Object.fromEntries(ctx.themes.ids().map((id) => [id, ctx.themes.get(id).name]));

const index = [];
for (const e of ENTRIES) {
  const t0 = performance.now();
  const { project, world } = e.build();
  const ms = performance.now() - t0;
  const scene = sceneOf(e.id, e.title, project, world, ctx.catalog, ms);
  writeFileSync(join(outDir, `${e.id}.json`), JSON.stringify(scene));
  const ev = toExport(project, world, 'Nookwright');
  const files: Record<string, number> = {};
  let digest = '';
  for (const fmt of ['litematic', 'schem', 'nbt'] as const) {
    const bytes = exportFile(fmt, ev);
    writeFileSync(join(outDir, 'files', `${e.id}.${fmt}`), bytes);
    files[fmt] = bytes.length;
    if (fmt === 'nbt') digest = buildDigest(bytes);
  }
  const floors = new Set(project.state.rooms.map((r) => r.floorIndex)).size;
  const roomNames = [...new Set(scene.rooms.map((r) => r.name))];
  index.push({
    id: e.id, title: e.title, blurb: e.blurb, kind: e.kind, theme: project.state.themeId, themeName: THEME_NAMES[project.state.themeId] ?? project.state.themeId,
    seed: e.seed, size: e.size ?? null, type: e.type ?? null, floors, rooms: roomNames, roomCount: scene.rooms.length,
    footprint: [ev.size[0], ev.size[2]], height: ev.size[1], blocks: scene.stats.blocks, digest, ms: Math.round(ms), version: '1.21.11', files,
  });
  console.log(`${e.id}: ${scene.stats.blocks} Blöcke, ${scene.rooms.length} ${scene.rooms.length === 1 ? 'Raum' : 'Räume'}, ${ev.size.join('×')}, ${Math.round(ms)} ms`);
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
