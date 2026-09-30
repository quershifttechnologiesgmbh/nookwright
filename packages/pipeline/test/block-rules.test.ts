/**
 * W3-BL: Blöcke sperren und ersetzen. Garantien des Presets „Nur leicht farmbar“ über Bautypen, alle Themes und beide
 * Zielversionen: 0 gesperrte Blöcke im Ergebnis, 0 harte Verstöße, 0 dunkle Zellen (Lichtquellen-Ersatz); ohne Regeln
 * bitgleich; Katalog-Sicht blendet Varianten mit gesperrten Blöcken aus; feste Ersetzungen gelten.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { BLOCK_SUBSTITUTES, formatState } from '@mcda/platform';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import {
  EASY_FARM_BLOCKS, blockLook, blockRulesCatalog, blockRulesContext, generate, generateBase, materialList, normalizeBlockRules, projectFromBuildingType,
  withBlockBanned, withBlockPreset, withBlockReplacement, type BlockRules, type World,
} from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { loadType } from './buildingtype-fuzz.js';
import { sampleHouse } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const PRESET: BlockRules = withBlockPreset(undefined, 'easy_farm', true)!;
const banned = new Set(EASY_FARM_BLOCKS);

/** Namen aller Blöcke im Volumen, die gesperrt sind. */
function bannedIn(world: World, list: ReadonlySet<string> = banned): string[] {
  const out = new Set<string>();
  for (const c of world.materialized.volume.cells()) if (list.has(c.state.name)) out.add(c.state.name);
  return [...out].sort();
}

function digest(world: World): string {
  const parts: string[] = [];
  for (const c of world.materialized.volume.cells()) parts.push(`${c.pos.join(',')}=${formatState(c.state)}`);
  return parts.join('|');
}

describe('Block-Regeln: Normalform und Preset', () => {
  it('leere Regeln sind keine Regeln; Preset schreibt die Liste, Freigeben entfernt einzeln', () => {
    expect(normalizeBlockRules({ banned: [] })).toBeUndefined();
    expect(normalizeBlockRules({ banned: ['minecraft:Gold_Block', 'gold_block', ' stone '] })?.banned).toEqual(['gold_block', 'stone']);
    expect(PRESET.preset).toBe('easy_farm');
    expect(PRESET.banned).toEqual([...EASY_FARM_BLOCKS].sort());
    const freed = withBlockBanned(PRESET, 'gold_block', false)!;
    expect(freed.banned).not.toContain('gold_block');
    expect(freed.preset).toBe('easy_farm');
    expect(withBlockPreset(freed, 'easy_farm', false)).toBeUndefined();
    const own = withBlockBanned(PRESET, 'oak_planks', true)!;
    expect(withBlockPreset(own, 'easy_farm', false)).toEqual({ banned: ['oak_planks'] });
    // Ersetzungen nur für gesperrte Blöcke und nie auf gesperrte
    const r = withBlockReplacement(undefined, 'gold_block', 'honeycomb_block')!;
    expect(r).toEqual({ banned: ['gold_block'], replace: { gold_block: 'honeycomb_block' } });
    expect(normalizeBlockRules({ banned: ['gold_block', 'sponge'], replace: { gold_block: 'sponge', stone: 'dirt' } })?.replace).toBeUndefined();
  });

  it('ohne Regeln: derselbe Kontext und dieselbe Welt (bitgleich)', () => {
    expect(blockRulesContext(ctx, undefined)).toBe(ctx);
    expect(blockRulesContext(ctx, { banned: [] })).toBe(ctx);
    const a = generate(sampleHouse('1.21.11', 'medieval'), ctx);
    const b = generate(sampleHouse('1.21.11', 'medieval'), ctx, { blockRules: { banned: [] } });
    expect(digest(b)).toBe(digest(a));
    expect(a.materialized.banned).toBeUndefined();
  });
});

describe('Block-Regeln: Katalog-Sicht', () => {
  const view = blockRulesCatalog(ctx.catalog, PRESET);
  it('Schatz-Haufen nur noch als Kupfer-Variante, Originale bleiben über get auflösbar', () => {
    const hoard = view.byTags(['treasure_pile']).find((d) => d.id === 'treasure/gold_hoard');
    expect(hoard?.variants?.map((v) => v.id)).toEqual(['copper']);
    expect(view.get('treasure/gold_hoard').variants?.map((v) => v.id)).toEqual(['gold', 'heap', 'copper']);
  });
  it('Komponenten ohne erlaubte Variante und seltene treten zurück, solange es Alternativen gibt', () => {
    const trophies = view.byTags(['wall_decor', 'trophy']).map((d) => d.id);
    expect(trophies).not.toContain('decor/head_trophy');
    expect(trophies).not.toContain('decor/skull_trophy');
    expect(trophies.length).toBeGreaterThan(0);
    // ohne Alternative bleibt die Glocke (ihre Blöcke ersetzt die Materialisierung)
    expect(view.byTags(['bell']).map((d) => d.id)).toEqual(ctx.catalog.byTags(['bell']).map((d) => d.id));
  });
  it('ohne Regeln: derselbe Katalog', () => {
    expect(blockRulesCatalog(ctx.catalog, undefined)).toBe(ctx.catalog);
  });
});

describe('Block-Regeln: Garantien des Presets (Bautypen × Themes × Versionen)', () => {
  const themes = ctx.themes.ids();
  const cases: [string, string, keyof typeof TARGET_VERSIONS][] = themes.flatMap((t, i) => [
    ['tavern', t, i % 2 === 0 ? '1.21.11' : '26.3'],
    ['castle_compact', t, i % 2 === 0 ? '26.3' : '1.21.11'],
  ] as [string, string, keyof typeof TARGET_VERSIONS][]);
  it(`${cases.length} Welten: 0 gesperrte Blöcke, 0 harte Verstöße, 0 dunkle Zellen`, { timeout: HEAVY_TIMEOUT * 4 }, () => {
    const stats: string[] = [];
    for (const [type, theme, version] of cases) {
      const where = `${type} ${theme} ${version}`;
      const res = projectFromBuildingType(loadType(type), { themeId: theme, targetVersion: TARGET_VERSIONS[version] }, 7, ctx);
      const world = generateBase(res.project, ctx, { ...res.build, ...res.surroundings, blockRules: PRESET });
      expect(bannedIn(world), where).toEqual([]);
      expect(world.materialized.banned?.unreplaced, where).toEqual([]);
      // wie im Bautyp-Fuzz: alles außer Spawn-Hinweisen ist hart
      const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
      expect(hard.map((v) => v.message).slice(0, 3), where).toEqual([]);
      expect(world.materialized.light.darkCells.length, `${where}: dunkle Zellen`).toBe(0);
      stats.push(`${where}: ${world.materialized.banned?.replaced.map((r) => `${r.from}→${r.to}×${r.count}`).join(' ') ?? ''}`);
    }
    if (process.env["W3BL_DEBUG"] !== undefined) writeFileSync(process.env["W3BL_DEBUG"], stats.join("\n"));
    // Eine Welt ersetzt ihr Prismarin wirklich (sonst prüft der Test nichts). W13-F (2026-09-28): Prismarin trägt jetzt
    // das Elfendach; die Küste hat es nicht mehr (Steinziegel/Blasseiche) – vorher 'tavern harbor'
    expect(stats.some((s) => s.startsWith('tavern elven') && s.includes('prismarine'))).toBe(true);
  });
});

describe('Block-Regeln: Ersatz im Einzelnen', () => {
  it('feste Ersetzung des Nutzers gilt; ohne sie ersetzt das nächste Familienmitglied', () => {
    const p = sampleHouse('1.21.11', 'medieval');
    const plain = generate(p, ctx);
    const top = [...new Set([...plain.materialized.volume.cells()].map((c) => c.state.name))];
    const target = top.find((b) => b.endsWith('_planks')) ?? top[0]!;
    const fixed = generate(sampleHouse('1.21.11', 'medieval'), ctx, { blockRules: withBlockReplacement(undefined, target, 'cherry_planks')! });
    expect(bannedIn(fixed, new Set([target]))).toEqual([]);
    expect(fixed.materialized.banned?.replaced.some((r) => r.from === target && r.to === 'cherry_planks')).toBe(true);
    const auto = generate(sampleHouse('1.21.11', 'medieval'), ctx, { blockRules: { banned: [target] } });
    expect(bannedIn(auto, new Set([target]))).toEqual([]);
    expect(auto.materialized.light.darkCells.length).toBe(0);
  });

  it('Lichtquellen werden durch gleich helle ersetzt (Laterne gesperrt → 0 dunkle Zellen)', () => {
    const w = generate(sampleHouse('1.21.11', 'medieval'), ctx, { blockRules: { banned: ['lantern', 'torch', 'wall_torch'] } });
    expect(bannedIn(w, new Set(['lantern', 'torch', 'wall_torch']))).toEqual([]);
    expect(w.materialized.light.darkCells.length).toBe(0);
    expect(w.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual(generate(sampleHouse('1.21.11', 'medieval'), ctx).materialized.violations.filter((v) => v.kind !== 'spawn'));
  });
});

describe('Vorschaufarben (HANDOFF §7: neue Blöcke brauchen eine Farbe)', () => {
  it('jeder kuratierte Ersatz hat eine eigene Vorschaufarbe', () => {
    const list = [...new Set(Object.values(BLOCK_SUBSTITUTES).flat())];
    expect(list.filter((b) => blockLook(b).rule === 'fallback')).toEqual([]);
  });
});

describe('Materialliste', () => {
  it('Haus und Umgebung getrennt; Summen passen zu den Zeilen', () => {
    const res = projectFromBuildingType(loadType('farmhouse'), { targetVersion: TARGET_VERSIONS['1.21.11'] }, 3, ctx);
    const world = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
    const list = materialList(world, world.surroundings);
    expect(list.house).toBeGreaterThan(1000);
    expect(list.surroundings).toBeGreaterThan(0);
    expect(list.rows.reduce((n, r) => n + r.house, 0)).toBe(list.house);
    expect(list.rows.reduce((n, r) => n + r.surroundings, 0)).toBe(list.surroundings);
    // Wandvarianten zählen als Gegenstand, keine Luft, keine oberen Türhälften doppelt
    expect(list.rows.some((r) => r.item.includes('_wall_torch') || r.item === 'air')).toBe(false);
    const all = materialList(world);
    expect(all.house).toBe(list.house + list.surroundings);
    expect(all.surroundings).toBe(0);
  });
});
