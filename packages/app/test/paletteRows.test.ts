/**
 * Paletten-Zeilen der Seitenleiste (Axiom-Vorbild, research/13 §8 #17/#19): Gruppierung nach Rolle,
 * Anteile je Rolle, Ersatz-Beschriftungen. Rein – die Darstellung prüft der Browser-Test.
 */
import type { MaterialResolution, PaletteEntry } from '@mcda/materialize';
import { describe, expect, it } from 'vitest';
import { paletteByRole, percent, shortBlockName, substitutionLabel } from '../src/ui/paletteRows.js';

const e = (block: string, role: string | undefined, count: number): PaletteEntry => (role === undefined ? { block, count } : { block, role, count });

describe('Palette: Zeilen für die Seitenleiste', () => {
  it('gruppiert nach Rolle, sortiert Rollen nach Größe und Blöcke nach Anzahl', () => {
    const g = paletteByRole([
      e('minecraft:stone_bricks', 'wall_primary', 100),
      e('minecraft:cobblestone', 'wall_primary', 40),
      e('minecraft:spruce_planks', 'floor_primary', 60),
      e('minecraft:air', undefined, 5),
    ]);
    expect(g.map((x) => x.role)).toEqual(['wall_primary', 'floor_primary', '—']);
    expect(g[0]!.total).toBe(140);
    expect(g[0]!.rows.map((r) => shortBlockName(r.block))).toEqual(['stone_bricks', 'cobblestone']);
    expect(g[0]!.rows[0]!.share).toBeCloseTo(100 / 140, 10);
    expect(percent(g[0]!.rows[0]!.share)).toBe(71);
    expect(g[2]!.rows[0]!.block).toBe('minecraft:air');
  });

  it('begrenzt die Zeilen je Rolle und meldet den Rest', () => {
    const palette = Array.from({ length: 7 }, (_, i) => e(`minecraft:b${i}`, 'wall_primary', 10 - i));
    const g = paletteByRole(palette, 4);
    expect(g[0]!.rows).toHaveLength(4);
    expect(g[0]!.rest).toBe(3);
    expect(g[0]!.rows.map((r) => r.block)).toEqual(['minecraft:b0', 'minecraft:b1', 'minecraft:b2', 'minecraft:b3']);
    expect(paletteByRole(palette, 7)[0]!.rest).toBe(0);
  });

  it('Material-Schichten der Möbel landen in „Möbel & Deko" statt als Roh-ID (Review 3)', () => {
    const palette = [
      e('minecraft:stone_bricks', 'wall_primary', 100),
      e('minecraft:oak_fence', 'fence_plate', 8),
      e('minecraft:podzol', 'podzol', 5),
      e('minecraft:spruce_planks', 'floor_primary', 20),
    ];
    const themeRoles = new Set(['wall_primary', 'floor_primary', 'beam']);
    const g = paletteByRole(palette, 4, { themeRoles });
    // Theme-Rollen bleiben sichtbar, die beiden Layer-IDs werden zu EINER Gruppe zusammengefasst
    // Rollen bleiben nach Größe sortiert: wall_primary 100, floor_primary 20, Möbel 13
    expect(g.map((x) => x.label)).toEqual(['wall_primary', 'floor_primary', 'Möbel & Deko']);
    expect(g.map((x) => x.role)).toEqual(['wall_primary', 'floor_primary', '~mobiliar']);
    expect(g[2]!.total).toBe(13);
    expect(g[2]!.rows.map((r) => shortBlockName(r.block))).toEqual(['oak_fence', 'podzol']);
    // Ohne Theme-Rollen bleibt alles wie vorher (kein stiller Umbau für andere Aufrufer)
    expect(paletteByRole(palette).map((x) => x.label)).toContain('fence_plate');
    expect(paletteByRole(palette).map((x) => x.label)).toContain('podzol');
  });

  it('Ersatz-Auflösungen nennen ebenfalls keine Layer-IDs', () => {
    const roles = new Set(['wall_primary']);
    const sub: MaterialResolution = { role: 'wall_primary', shape: 'block', block: 'minecraft:stone_bricks', family: 'stone_bricks', via: 'version_fallback' };
    const layer: MaterialResolution = { role: 'fence_plate', shape: 'block', block: 'minecraft:oak_fence', family: 'oak', via: 'platform_fallback' };
    expect(substitutionLabel(sub, { themeRoles: roles })).toContain('wall_primary.block');
    expect(substitutionLabel(layer, { themeRoles: roles })).toContain('Möbel & Deko');
    expect(substitutionLabel(layer, { themeRoles: roles })).not.toContain('fence_plate');
    expect(substitutionLabel(layer)).toContain('fence_plate');
  });

  it('gleiche Anzahlen deterministisch nach Blockname, leere Palette bleibt leer', () => {
    const g = paletteByRole([e('minecraft:zzz', 'r', 5), e('minecraft:aaa', 'r', 5)]);
    expect(g[0]!.rows.map((r) => r.block)).toEqual(['minecraft:aaa', 'minecraft:zzz']);
    expect(paletteByRole([])).toEqual([]);
  });

  it('Ersatz-Beschriftung nennt Rolle, Form, Block und Grund', () => {
    const s: MaterialResolution = { role: 'textile_accent', shape: 'stairs', block: 'oak_stairs', family: 'oak', via: 'version_fallback' };
    expect(substitutionLabel(s)).toBe('textile_accent.stairs → oak_stairs · Versions-Fallback');
    expect(substitutionLabel({ ...s, via: 'role_fallback' })).toContain('Ersatzfamilie');
    expect(substitutionLabel({ ...s, via: 'direct' })).toContain('Ersatz');
    expect(shortBlockName('barrel')).toBe('barrel');
  });
});
