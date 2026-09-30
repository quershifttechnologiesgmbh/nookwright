/**
 * feat/theme-moods – Messung (Bericht `plan/spikes/F_theme_moods.md` §5): Bautypen × Stimmungen × Seeds über
 * `projectFromBuildingType` + `generateBase`. Je Welt: Deko-Anzahl, Möbel gesamt, Verwitterungsanteil der Blöcke,
 * Symmetrie der Einrichtung, Außen-Deko, Raumqualität, harte Verstöße, unerreichbare Räume, dunkle Zellen.
 *
 *   npx tsx packages/pipeline/scripts/mood-measure.ts [json-out]
 *   MOOD_SET=axes …   einzelne Achsen ±1 statt der drei Stimmungen
 *   MOOD_SET=themes … Theme-Vorgabe an/aus je Theme (Standard-an-Frage)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reachableRooms } from '@mcda/archetype';
import type { Project } from '@mcda/blueprint';
import { parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import type { MoodVector } from '@mcda/core';
import { generateBase, projectFromBuildingType } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

/** „aus“ auch für neue Projekte (B4 setzt sonst `mood: {}`): alle Achsen 0 = keine Stimmung. */
const OFF: MoodVector = { wear: 0, richness: 0, formality: 0, organic: 0 };
const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const loadType = (id: string): BuildingTypeDef => {
  const r = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/${id}.json5`, 'utf8'), `${id}.json5`);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};

/**
 * Symmetrie der Einrichtung: Anteil der Grundzellen (Bodenhöhe) aller Möbel, deren Spiegelbild an der Raummitte
 * (bessere Achse je Raum) von einem Möbel **derselben Komponente** belegt ist – gespiegelte Paare, Reihen.
 */
export function symmetryScore(project: Project): number {
  let hit = 0;
  let all = 0;
  for (const room of project.state.rooms) {
    const byComp = new Map<string, Set<string>>();
    const cells: Array<readonly [number, number, string]> = [];
    for (const p of project.state.placements) {
      if (p.roomId !== room.id || p.parentKey !== undefined) continue;
      const set = byComp.get(p.componentId) ?? new Set<string>();
      byComp.set(p.componentId, set);
      for (const c of placedCells(p)) {
        set.add(`${c[0]},${c[1]}`);
        cells.push([c[0], c[1], p.componentId]);
      }
    }
    if (cells.length === 0) continue;
    const b = room.cells.bounds()!;
    let hx = 0;
    let hz = 0;
    for (const [x, z, id] of cells) {
      const set = byComp.get(id)!;
      if (set.has(`${b.minX + b.maxX - x},${z}`)) hx++;
      if (set.has(`${x},${b.minZ + b.maxZ - z}`)) hz++;
    }
    hit += Math.max(hx, hz);
    all += cells.length;
  }
  return all === 0 ? 0 : hit / all;
}

const FORMAL = new Set(['noble', 'sacred', 'festive', 'martial']);
const HOMELY = new Set(['cozy', 'cottage', 'village', 'farm', 'tavern', 'rustic']);
const WORN = new Set(['ruin', 'abandoned', 'overgrown', 'grim']);
/** Stil-Index der Möbel: (formell − gemütlich) / Möbel mit Stil-Tags; dazu Anteil verwitterter Stil-Tags. */
function styleIndex(project: Project): { formal: number; wornStyle: number } {
  let f = 0;
  let h = 0;
  let w = 0;
  let n = 0;
  for (const p of project.state.placements) {
    const tags = ctx.catalog.find(p.componentId)?.styleTags;
    if (tags === undefined || tags.length === 0) continue;
    n++;
    if (tags.some((t) => FORMAL.has(t))) f++;
    if (tags.some((t) => HOMELY.has(t))) h++;
    if (tags.some((t) => WORN.has(t))) w++;
  }
  return n === 0 ? { formal: 0, wornStyle: 0 } : { formal: (f - h) / n, wornStyle: w / n };
}

let placedCells: (p: Project['state']['placements'][number]) => ReadonlyArray<readonly [number, number]> = () => [];

async function main(): Promise<void> {
  const { placedFor } = await import('../src/index.js');
  placedCells = (p) => placedFor(p, ctx.catalog).cells.map((c) => [c.pos[0], c.pos[2]] as const);
  const set = process.env['MOOD_SET'] ?? 'moods';
  const types = (process.env['MOOD_TYPES'] ?? 'tavern,farmhouse,castle_compact').split(',');
  const seeds = (process.env['MOOD_SEEDS'] ?? '1,2,3').split(',').map(Number);
  const moods: ReadonlyArray<readonly [string, MoodVector | undefined, string | undefined]> =
    set === 'axes'
      ? [
          ['aus', undefined, undefined],
          ...(['wear', 'richness', 'formality', 'organic'] as const).flatMap((a) => [[`${a}-1`, { [a]: -1 }, undefined], [`${a}+1`, { [a]: 1 }, undefined]] as const),
        ]
      : set === 'themes'
        ? (process.env['MOOD_THEMES'] ?? 'medieval,rustic,nordic,ruin,elven,dwarven,farmstead,harbor').split(',').flatMap((t) => [[`${t}:aus`, undefined, t], [`${t}:an`, {}, t]] as const)
        : [
            ['aus', undefined, undefined],
            ['streng', { wear: -1, richness: -1, formality: 1, organic: -1 }, undefined],
            ['wild', { wear: 1, richness: 1, formality: -1, organic: 1 }, undefined],
          ];
  const rows: Record<string, unknown>[] = [];
  for (const type of types) {
    const def = loadType(type);
    for (const [name, mood, theme] of moods) {
      for (const seed of seeds) {
        const t0 = performance.now();
        const res = projectFromBuildingType(def, { size: 'M', ...(theme !== undefined ? { themeId: theme } : {}), mood: mood ?? OFF }, seed, ctx);
        const world = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
        const ms = performance.now() - t0;
        const cells = [...world.materialized.volume.cells()];
        const shellBlocks = cells.length;
        const worn = cells.filter((c) => /mossy|cracked|^stripped_|^(gray|light_gray)_(wool|terracotta|concrete|stained_glass)|weathered_copper|oxidized_copper/.test(c.state.name)).length;
        const placements = res.project.state.placements;
        const decor = placements.filter((p) => {
          const c = ctx.catalog.find(p.componentId)?.category;
          return c === 'decor' || c === 'attachment';
        }).length;
        const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn').length;
        const reach = reachableRooms(world.shell);
        const unreachable = res.project.state.rooms.filter((r) => !reach.has(r.id)).length;
        rows.push({
          type, mood: name, seed, theme: res.project.state.themeId,
          placements: placements.length, decor, exterior: world.exterior?.length ?? 0,
          wornShare: +(worn / shellBlocks).toFixed(4), worn, blocks: shellBlocks,
          symmetry: +symmetryScore(res.project).toFixed(4),
          formal: +styleIndex(res.project).formal.toFixed(4), wornStyle: +styleIndex(res.project).wornStyle.toFixed(4),
          hard, unreachable, dark: world.materialized.light.darkCells.length,
          furnishWarnings: world.warnings.filter((w) => /^r\d+ \(/.test(w)).length,
          ms: Math.round(ms),
        });
        const r = rows[rows.length - 1]!;
        console.log(JSON.stringify(r));
      }
    }
  }
  const out = process.argv[2];
  if (out !== undefined) writeFileSync(out, JSON.stringify(rows, null, 1));
}

void main();
