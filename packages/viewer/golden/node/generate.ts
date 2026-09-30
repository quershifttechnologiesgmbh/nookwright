/**
 * Goldene Galerie (P0-A), Node: ein Eintrag der goldenen Menge → Welt → `.nbt`-Bytes.
 *
 * Weg wie Galerie und Engine (`website/scripts/build-gallery.ts`): `projectFromBuildingType` +
 * `generateBase(project, ctx, { ...res.build, ...res.surroundings })`, dann `toExport` und der `.nbt`-Writer von
 * @mcda/export. Der Lauf rendert anschließend aus genau diesen Bytes – derselbe Weg wie für `.nbt` alter Commits.
 */
import { join } from 'node:path';
import JSON5 from 'json5';
import { readFileSync } from 'node:fs';
import { exportFile } from '@mcda/export/node';
import { generateBase, projectFromBuildingType, toExport } from '@mcda/pipeline';
import { nodeContext, type NodeContext } from '@mcda/pipeline/node';
import { expandSet, type GoldenEntry, type GoldenSet } from '../lib/set.js';
import { REPO_ROOT } from './paths.js';

export const DEFAULT_SET = join(REPO_ROOT, 'packages/viewer/golden/set.json5');

export function readSet(path = DEFAULT_SET): GoldenSet {
  return expandSet(JSON5.parse(readFileSync(path, 'utf8')));
}

let ctx: NodeContext | undefined;
export function catalogContext(): NodeContext {
  ctx ??= nodeContext(join(REPO_ROOT, 'catalog'));
  return ctx;
}

export interface Generated {
  readonly nbt: Uint8Array;
  readonly ms: number;
  /** Wahrheit aus dem Projekt, nur zur Kontrolle der Heuristiken (Manifest) */
  readonly truth: {
    readonly origin: readonly [number, number, number];
    readonly floors: readonly number[];
    /** Raum-Zellen (x/z) in Rasterkoordinaten */
    readonly roomsBox: { readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number } | undefined;
    readonly warnings: number;
  };
}

export function generateEntry(e: GoldenEntry): Generated {
  const c = catalogContext();
  const t0 = performance.now();
  const def = c.buildingTypes.get(e.type);
  // FN-Themes: `<theme>.<palette>` rendert ein Theme mit Farbpalette (Vorher-Vergleich für Stile ohne eigenes Theme)
  const [themeId, paletteId] = e.theme.split('.') as [string, string | undefined];
  const res = projectFromBuildingType(def, { size: e.size as 'S' | 'M' | 'L', themeId, ...(paletteId !== undefined ? { paletteId } : {}), targetVersion: e.targetVersion, ...(e.landform === 'natural' || e.landform === 'dramatic' ? { landform: e.landform } : {}) }, e.seed, c);
  const world = generateBase(res.project, c, { ...res.build, ...res.surroundings, ...(e.weathering === 'some' || e.weathering === 'rich' ? { weathering: e.weathering } : {}) });
  const ev = toExport(res.project, world);
  const nbt = exportFile('nbt', ev);
  const ms = performance.now() - t0;
  const origin = world.materialized.volume.origin;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of res.project.state.rooms) {
    for (const [x, z] of r.cells.toArray()) {
      x0 = Math.min(x0, x - origin[0]); x1 = Math.max(x1, x - origin[0]);
      z0 = Math.min(z0, z - origin[2]); z1 = Math.max(z1, z - origin[2]);
    }
  }
  return {
    nbt, ms,
    truth: {
      origin: [origin[0], origin[1], origin[2]],
      floors: [...new Set(res.project.state.rooms.map((r) => r.floorIndex))].sort((a, b) => a - b),
      roomsBox: Number.isFinite(x0) ? { x0, x1, z0, z1 } : undefined,
      warnings: world.warnings.length,
    },
  };
}
