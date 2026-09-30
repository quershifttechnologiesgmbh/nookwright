/**
 * feat/theme-moods – A/B-Welten als `.nbt` für die goldene Galerie (`npm run golden -- --nbt <ordner>`):
 * Bautyp × Stimmung (aus / streng / wild) bzw. Theme-Vorgabe aus/an. Ausgabe nur unter `local/` (Bilder mit
 * Mojang-Texturen bleiben lokal).
 *
 *   npx tsx packages/pipeline/scripts/mood-nbt.ts local/mood-nbt
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBuildingTypeDef } from '@mcda/catalog';
import type { MoodVector } from '@mcda/core';
import { exportFile } from '@mcda/export/node';
import { generateBase, projectFromBuildingType, toExport } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

/** „aus“ auch für neue Projekte (B4 setzt sonst `mood: {}`): alle Achsen 0 = keine Stimmung. */
const OFF: MoodVector = { wear: 0, richness: 0, formality: 0, organic: 0 };
const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const out = process.argv[2] ?? 'local/mood-nbt';
mkdirSync(out, { recursive: true });

const MOODS: Readonly<Record<string, MoodVector | undefined>> = {
  aus: undefined,
  streng: { wear: -1, richness: -1, formality: 1, organic: -1 },
  wild: { wear: 1, richness: 1, formality: -1, organic: 1 },
  theme: {},
};
const jobs = (process.env['MOOD_JOBS'] ?? 'tavern:aus,tavern:streng,tavern:wild,farmhouse:aus,farmhouse:streng,farmhouse:wild,castle_compact:aus,castle_compact:streng,castle_compact:wild')
  .split(',').map((j) => j.split(':') as [string, string, string?]);
for (const [type, mood, theme] of jobs) {
  const d = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/${type}.json5`, 'utf8'), `${type}.json5`);
  if (!d.ok) throw new Error(d.errors.join('\n'));
  const m = MOODS[mood];
  const seed = Number(process.env['MOOD_SEED'] ?? 2026);
  const res = projectFromBuildingType(d.value, { size: 'M', ...(theme !== undefined ? { themeId: theme } : {}), mood: m ?? OFF }, seed, ctx);
  const world = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
  const id = `${type}-${theme ?? res.project.state.themeId}-${mood}`;
  writeFileSync(join(out, `${id}.nbt`), exportFile('nbt', toExport(res.project, world)));
  console.log(id, world.materialized.violations.filter((v) => v.kind !== 'spawn').length, 'harte Verstöße');
}
