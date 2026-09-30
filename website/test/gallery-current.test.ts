/**
 * Die eingecheckte Galerie (website/gallery) entspricht dem aktuellen Generator (Review R2-01): Jeder Eintrag wird mit
 * denselben Parametern wie in build-gallery.ts gebaut; Blockzahl und Fingerabdruck (sha256 der entpackten `.nbt`)
 * müssen mit `index.json` und der Datei übereinstimmen. Ändert eine Pipeline-Änderung einen Bau, schlägt dieser Test
 * fehl, bis die Galerie neu erzeugt ist: `npm run web:gallery` (website/scripts/gallery.mjs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../packages/core/test/support/slack.js';
import { toExport } from '../../packages/pipeline/src/index.js';
import { nodeContext } from '../../packages/pipeline/src/node-context.js';
import { sceneOf } from '../../tools/public-support/scripts/scene.js';
import { buildDigest, galleryEntries, nbtOf } from '../scripts/gallery-entries.js';

const dir = fileURLToPath(new URL('../gallery/', import.meta.url));
const ctx = nodeContext(fileURLToPath(new URL('../../catalog', import.meta.url)));
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Array<{ id: string; blocks: number; digest?: string; seed: number }>;
const entries = galleryEntries(ctx);
const HINT = 'Galerie veraltet – neu erzeugen: npm run web:gallery';

describe('Galerie = aktueller Generator', () => {
  it('gleiche Einträge in gleicher Reihenfolge wie build-gallery.ts', () => {
    expect(index.map((e) => e.id), HINT).toEqual(entries.map((e) => e.id));
  });
  for (const e of entries) {
    it(`${e.id}: Blockzahl und Fingerabdruck wie eingecheckt`, { timeout: HEAVY_TIMEOUT }, () => {
      const stored = index.find((x) => x.id === e.id);
      expect(stored, HINT).toBeDefined();
      expect(stored!.digest, `${HINT} (index.json ohne digest)`).toMatch(/^[0-9a-f]{16}$/);
      // die eingecheckte Datei passt zum Index
      expect(buildDigest(readFileSync(join(dir, 'files', `${e.id}.nbt`))), HINT).toBe(stored!.digest);
      // der aktuelle Generator baut dasselbe
      const { project, world } = e.build();
      const digest = buildDigest(nbtOf(toExport(project, world, 'Nookwright')));
      const blocks = sceneOf(e.id, e.title, project, world, ctx.catalog, 0).stats.blocks;
      expect({ blocks, digest }, HINT).toEqual({ blocks: stored!.blocks, digest: stored!.digest });
    });
  }
});
