/**
 * W7-A (27.09.2026, plan/spikes/W7A_ruhe.md; Koordinator nach W7-C): Traufkonsolen und Pfosten-Laternen nur vor
 * Fachwerk-Ständern. Das Fachwerk legt Felder zusammen (`mergeStrips`) und nimmt dabei Rasterpfosten weg; `shellFor`
 * schreibt die übrigen als `FacadeGridLine.studs` in die Hülle und nimmt Konsolen der Hülle vor Putzfeldern weg.
 *
 * - Galerie-Weg (Seed 2026, M): hinter jeder Traufkonsole (Hülle und Außen-Deko) steht in einer Fachwerkwand ein Ständer.
 * - `timberWallParts` mit den wandartigen Zellen = mit allen Zellen der Hülle (gleiche Bauteile wie die Materialisierung).
 * - Themes ohne Fachwerk: keine `studs`, Hülle zellgleich (dasselbe Objekt aus `withTimberStuds`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS, type Shell, type ShellCell } from '@mcda/blueprint';
import { parseBuildingTypeDef } from '@mcda/catalog';
import { key3 } from '@mcda/core';
import { shellContext, timberPart, timberWallParts, wallRuleOf } from '@mcda/materialize';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, shellFor, type BaseWorld } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { withTimberStuds } from '../src/studs.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);

function project(type: string, themeId: string, seed = 2026) {
  const r = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/${type}.json5`, 'utf8'), `${type}.json5`);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return projectFromBuildingType(r.value, { size: 'M', themeId, targetVersion: TARGET_VERSIONS['1.21.11'] }, seed, ctx);
}

function build(type: string, themeId: string, seed = 2026): BaseWorld {
  const res = project(type, themeId, seed);
  return generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
}

const STEP: Record<string, readonly [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Konsolen (Hülle: `beam`/obere Treppe ohne Stamm darunter; Außen-Deko: Gruppe `eaveBraces`) vor Putz ohne Ständer. */
function bracesOverInfill(w: BaseWorld): string[] {
  const vol = w.materialized.volume;
  const name = (p: readonly number[]): string => (!vol.contains(p as [number, number, number]) || vol.isEmpty(p as [number, number, number]) ? 'air' : String(vol.stateAt(p as [number, number, number]).name));
  const byPos = new Map<string, ShellCell>(w.shell.cells.map((c) => [key3(c.pos), c] as const));
  const items: (readonly [number, number, number])[] = [];
  for (const c of w.shell.cells) {
    if (c.kind !== 'facade' || c.role !== 'beam' || c.shape !== 'stairs' || c.orient?.half !== 'top') continue;
    if (byPos.get(key3([c.pos[0], c.pos[1] - 1, c.pos[2]]))?.shape === 'log') continue;
    items.push(c.pos);
  }
  for (const pl of w.exterior ?? []) if (pl.group === 'eaveBraces') items.push(...pl.cells);
  const bad: string[] = [];
  for (const p of items) {
    const wall = Object.values(STEP).map(([dx, dz]) => [p[0] + dx, p[1], p[2] + dz] as const).find((q) => {
      const k = byPos.get(key3(q))?.kind;
      return k === 'wall' || k === 'pillar';
    });
    if (wall === undefined) continue;
    const behind = [name(wall), name([wall[0], wall[1] - 1, wall[2]])];
    const infill = behind.some((b) => /calcite/.test(b));
    const log = behind.some((b) => /_log$|_wood$/.test(b));
    if (infill && !log) bad.push(`${key3(p)} vor ${behind.join('/')}`);
  }
  return bad;
}

describe('W7-A Fachwerk-Ständer an der Hülle (Traufkonsolen nur vor Ständern)', () => {
  it('Galerie-Weg timber: keine Traufkonsole vor einem Putzfeld (vorher Taverne 4)', () => {
    for (const type of ['tavern', 'townhouse', 'townhouse_row', 'timber']) {
      const w = build(type, 'timber');
      expect(bracesOverInfill(w), type).toEqual([]);
      // Fachwerk-Linien tragen `studs`, jede Ständerliste ist eine Teilmenge der Rasterpfosten
      const lines = (w.shell.facadeGrid ?? []).filter((g) => g.studs !== undefined);
      expect(lines.length, type).toBeGreaterThan(0);
      for (const g of lines) for (const s of g.studs!) expect(g.posts).toContain(s);
    }
    // Die Taverne verliert an Nord und Süd je zwei Ständer (zusammengelegte Felder, W7-C)
    const tavern = build('tavern', 'timber');
    expect((tavern.shell.facadeGrid ?? []).some((g) => g.studs !== undefined && g.studs.length < g.posts.length)).toBe(true);
  }, HEAVY_TIMEOUT);

  it('timberWallParts nur mit wandartigen Zellen = mit allen Zellen (gleiche Bauteile wie die Materialisierung)', () => {
    for (const type of ['tavern', 'townhouse_row']) {
      const res = project(type, 'timber');
      const theme = ctx.themes.get('timber');
      const shell = shellFor(res.project, res.build, theme);
      const roomTypes = Object.fromEntries(res.project.state.rooms.map((r) => [r.id, r.roomTypeId]));
      const fast = timberWallParts(shell, theme, roomTypes)!;
      const contexts = shellContext(shell, roomTypes);
      const full = new Map<string, string>();
      shell.cells.forEach((c, i) => {
        if ((c.kind !== 'wall' && c.kind !== 'pillar') || !contexts[i]!.exterior) return;
        const rule = wallRuleOf(theme, contexts[i]!);
        if (rule?.timber !== undefined) full.set(key3(c.pos), timberPart(rule.timber, c, contexts[i]!, 0));
      });
      expect(fast.size, type).toBeGreaterThan(100);
      expect(new Map(fast), type).toEqual(full);
    }
  }, HEAVY_TIMEOUT);

  // W13-E (2026-09-28): die Taverne hat in medieval/rustic jetzt ein Fachwerk-Obergeschoss (`facade.upperFrame`) – ohne
  // Fachwerk ist hier der Nordstil und die Burg (Steinbau ohne Wandkleid); vorher Taverne in medieval, nordic, rustic
  it('ohne Fachwerk: keine studs, dieselbe Hülle', () => {
    for (const [typeId, themeId] of [['tavern', 'nordic'], ['castle_compact', 'medieval'], ['castle_compact', 'rustic']] as const) {
      const res = project(typeId, themeId);
      const theme = ctx.themes.get(themeId);
      const shell: Shell = shellFor(res.project, res.build, theme);
      expect((shell.facadeGrid ?? []).every((g) => g.studs === undefined), themeId).toBe(true);
      expect(withTimberStuds(shell, theme), themeId).toBe(shell);
    }
  }, HEAVY_TIMEOUT);

  it('W13-E: Wandkleid der Obergeschosse – Taverne in medieval mit studs nur über dem Steingeschoss', () => {
    const res = project('tavern', 'medieval');
    const theme = ctx.themes.get('medieval');
    const shell: Shell = shellFor(res.project, res.build, theme);
    expect(shell.upperFrame).toBe(true);
    const ground = Math.min(...(shell.facadeGrid ?? []).map((g) => g.y0));
    const lines = shell.facadeGrid ?? [];
    expect(lines.some((g) => g.y0 > ground && g.studs !== undefined)).toBe(true);
    expect(lines.filter((g) => g.y0 === ground).every((g) => g.studs === undefined)).toBe(true);
  }, HEAVY_TIMEOUT);
});
