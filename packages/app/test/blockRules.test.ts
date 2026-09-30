/**
 * W3-BL in der App: Block-Regeln als Einstellung (ein Undo-Schritt, Stil-Schlüssel, Projektdatei), Auswahl ohne
 * gesperrte Varianten, Materialliste des Tabs „Material“ mit Ersatz, Mengen und Stapeln.
 */
import { describe, expect, it } from 'vitest';
import { EASY_FARM_BLOCKS, withBlockBanned, withBlockPreset } from '@mcda/pipeline';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { worldOf } from '../src/exporting.js';
import { lightSession } from '../src/lighting.js';
import { parseProjectFile, serializeProject } from '../src/projectFile.js';
import { baseWorldOf } from '../src/surroundingsWorld.js';
import { materialText, materialView } from '../src/ui/materialRows.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });
const PRESET = withBlockPreset(undefined, 'easy_farm', true);

describe('Block-Regeln als Einstellung der Sitzung', () => {
  const s0 = sampleSession(catalog);

  it('ein Undo-Schritt; Stil-Schlüssel ändert sich, Hülle nicht; gleiche Regeln = keine Änderung', () => {
    const s1 = uc.setBlockRules(s0, catalog, PRESET);
    expect(s1.past.length).toBe(s0.past.length + 1);
    expect(s1.blockRules).toEqual(PRESET);
    expect(uc.styleKey(uc.shellStyle(s1))).not.toBe(uc.styleKey(uc.shellStyle(s0)));
    expect(uc.shellKey(uc.shellStyle(s1))).toBe(uc.shellKey(uc.shellStyle(s0)));
    expect(s1.needsLight).toBe(true);
    expect(uc.setBlockRules(s1, catalog, PRESET)).toBe(s1);
    const back = uc.undo(s1);
    expect(back.blockRules).toBeUndefined();
    expect(back.project.state).toEqual(s0.project.state);
    expect(uc.redo(back).blockRules).toEqual(PRESET);
  });

  it('Räume ohne betroffene Möbel bleiben bitgleich (gleicher Seed, gleiche Auswahl)', () => {
    const s1 = uc.setBlockRules(s0, catalog, PRESET);
    // verglichen wird, was steht (Komponente, Variante, Lage) – IDs und Reihenfolge vergibt das Neu-Einrichten neu (W7-G)
    const furniture = (s: uc.Session, roomId: string) =>
      JSON.stringify(s.project.state.placements.filter((p) => p.roomId === roomId).map((p) => JSON.stringify([p.componentId, p.variantId ?? '', p.pose])).sort());
    const same = s0.project.state.rooms.filter((r) => furniture(s0, r.id) === furniture(s1, r.id));
    expect(same.length).toBeGreaterThanOrEqual(3);
  });

  it('Projektdatei trägt die Regeln (Round-Trip), Tauschen bietet keine gesperrten Varianten an', () => {
    const s1 = uc.setBlockRules(s0, catalog, withBlockBanned(PRESET, 'oak_planks', true));
    const r = parseProjectFile(serializeProject(s1, { savedAt: new Date(0) }), { catalog, themes: load.themeCatalog! });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.session.blockRules).toEqual(s1.blockRules);
    expect(uc.selectionCatalog(catalog, uc.shellStyle(s1))).not.toBe(catalog);
    expect(uc.selectionCatalog(catalog, uc.shellStyle(s0))).toBe(catalog);
  });
});

describe('Tab „Material“', () => {
  it('Preset an: Blöcke und Materialliste ohne gesperrte Blöcke, Ersatz sichtbar, 0 dunkle Zellen', async () => {
    const pctx = await browserContext(load)!.ready('1.21.11');
    // W13-F (2026-09-28): elven statt harbor – Prismarin trägt jetzt das Elfendach, die Küste hat keins mehr
    const typed = bt.typeSession(types.get('tavern'), { ...bt.defaultParams(types.get('tavern'), ctx.themes.ids(), 'elven', NEW), themeId: 'elven', size: 'S' }, 5, ctx, NEW).session;
    const s = lightSession({ ...uc.setBlockRules(typed, catalog, PRESET), needsLight: true }, pctx).session;
    const world = baseWorldOf(s.project, pctx, uc.shellStyle(s), s.surroundings, ctx.terrainStyles);
    const banned = new Set(EASY_FARM_BLOCKS);
    expect([...world.materialized.volume.cells()].filter((c) => banned.has(c.state.name))).toEqual([]);
    expect(world.materialized.light.darkCells).toEqual([]);
    const v = materialView(world, s.blockRules, 'house');
    expect(v.presetOn).toBe(true);
    expect(v.rows.length).toBe(8);
    expect(v.rows.every((r) => !banned.has(r.item))).toBe(true);
    expect(v.banned.some((b) => b.block.includes('prismarine') && b.to.length > 0 && b.count > 0)).toBe(true);
    expect(v.presetUnused).toBeGreaterThan(20);
    const all = materialView(world, s.blockRules, 'all');
    expect(all.total).toBeGreaterThan(v.total);
    // Suche filtert, Stapel stehen dabei
    const stone = materialView(world, s.blockRules, 'house', 'stone');
    expect(stone.rows.every((r) => r.item.includes('stone'))).toBe(true);
    expect(v.rows[0]!.stacks).toMatch(/St\./);
    expect(materialText(world, 'house').split('\n')[0]).toBe('Block\tAnzahl\tStapel');
    // ohne Regeln: nichts gesperrt, Preset aus
    const plain = worldOf(typed.project, pctx, uc.shellStyle(typed));
    expect(materialView(plain, undefined, 'house').banned).toEqual([]);
  }, HEAVY_TIMEOUT);
});
