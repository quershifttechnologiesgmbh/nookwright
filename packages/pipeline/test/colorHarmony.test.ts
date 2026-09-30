/**
 * WS-Farbe (Schritt 3 „Farben“): Farbharmonie-Schalter `paletteOverrides.colorHarmony` und Farbkennzahlen.
 * Aus = bitgleich; an = Helligkeitsabstände wachsen, nie schlechter; das Theme `terracotta_birch` löst auf und baut.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizePaletteOverrides, paletteOverridesKey } from '@mcda/core';
import { colorMetrics, generateBase, harmonizeTheme, harmonyOf, harmonyReport, projectFromBuildingType, themeWith } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(join(import.meta.dirname, '..', '..', '..', 'catalog'));

describe('Farbharmonie: Schalter und Normalform', () => {
  it('aus, normal und auto fallen weg (bitgleich zu vorher)', () => {
    expect(normalizePaletteOverrides({ colorHarmony: 'on' as const })).toEqual({ colorHarmony: 'on' });
    expect(normalizePaletteOverrides({ harmonyContrast: 'strong' })).toBeUndefined();
    expect(normalizePaletteOverrides({ colorHarmony: 'on', harmonyContrast: 'normal', harmonySaturation: 'auto' })).toEqual({ colorHarmony: 'on' });
    expect(paletteOverridesKey({ colorHarmony: 'on' })).not.toBe(paletteOverridesKey(undefined));
    expect(paletteOverridesKey({ colorHarmony: 'on', harmonyContrast: 'strong' })).not.toBe(paletteOverridesKey({ colorHarmony: 'on' }));
  });

  it('ohne Schalter liefert harmonyOf dasselbe Theme-Objekt', () => {
    const t = themeWith(ctx, 'nordic', undefined);
    expect(harmonyOf(t, undefined)).toBe(t);
    expect(harmonyOf(t, {})).toBe(t);
    expect(themeWith(ctx, 'nordic', undefined, undefined)).toBe(themeWith(ctx, 'nordic', undefined));
  });

  it('gleiche Eingabe, gleiches Ergebnis (deterministisch)', () => {
    const t = themeWith(ctx, 'nordic', undefined);
    expect(JSON.stringify(harmonizeTheme(t).roles)).toBe(JSON.stringify(harmonizeTheme(t).roles));
  });
});

describe('Farbharmonie: Regeln', () => {
  for (const id of ['medieval', 'nordic', 'timber', 'terracotta_birch']) {
    it(`${id}: kein Abstand wird schlechter`, () => {
      const t = themeWith(ctx, id, undefined);
      const before = harmonyReport(t);
      const after = harmonyReport(harmonizeTheme(t));
      for (const g of before.gaps) {
        const a = after.gaps.find((x) => x.pair === g.pair);
        expect(a).toBeDefined();
        expect(a!.gap).toBeGreaterThanOrEqual(g.gap - 0.02);
      }
    });
  }

  it('nordic: Sockel ↔ Wand bekommt spürbar mehr Abstand', () => {
    const t = themeWith(ctx, 'nordic', undefined);
    const gap = (th: typeof t): number => harmonyReport(th).gaps.find((g) => g.pair === 'baseWall')!.gap;
    expect(gap(harmonizeTheme(t))).toBeGreaterThan(gap(t) + 0.03);
  });
});

describe('Farbkennzahlen', () => {
  it('Kontrast, Akzentverhältnis und Töne aus dem Rollenprotokoll', () => {
    const m = colorMetrics([
      { block: 'minecraft:stone_bricks', role: 'foundation', count: 10 },
      { block: 'minecraft:birch_planks', role: 'wall_primary', count: 60 },
      { block: 'minecraft:red_sandstone', role: 'roof_main', count: 20 },
      { block: 'minecraft:dark_oak_planks', role: 'beam', count: 10 },
      { block: 'minecraft:oak_planks', role: 'interior_floor', count: 999 }, // Innenrolle zählt nicht
    ]);
    expect(m.blocks).toBe(100);
    expect(m.parts.wall.count).toBe(60);
    expect(m.contrast.baseWall).toBeGreaterThan(0.05);
    expect(m.contrast.trimWall).toBeGreaterThan(0.2);
    expect(m.accentRatio).toBeGreaterThanOrEqual(0);
    expect(m.accentRatio).toBeLessThanOrEqual(1);
    expect(Object.values(m.classShare).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
  });
});

describe('Farbharmonie am Bau und Theme terracotta_birch', () => {
  const build = (theme: string, paletteOverrides?: object) => {
    const res = projectFromBuildingType(ctx.buildingTypes.get('tavern')!, {
      size: 'M', themeId: theme, targetVersion: { name: '1.21.11', dataVersion: 4671 }, ...(paletteOverrides !== undefined ? { paletteOverrides } : {}),
    } as never, 5, ctx);
    return generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
  };
  const sig = (w: ReturnType<typeof build>): string => JSON.stringify(w.materialized.palette);

  it('colorHarmony off = bitgleich zum Bau ohne Angabe', () => {
    expect(sig(build('nordic', { colorHarmony: 'off' }))).toBe(sig(build('nordic')));
  });

  it('colorHarmony on ändert nur Farben, nicht die Geometrie (gleiche Blockzahl)', () => {
    const a = build('nordic');
    const b = build('nordic', { colorHarmony: 'on' });
    const n = (w: typeof a): number => w.materialized.palette.reduce((s, p) => s + p.count, 0);
    expect(n(b)).toBe(n(a));
    expect(sig(b)).not.toBe(sig(a));
  });

  it('terracotta_birch: vier Materialfamilien (Terrakotta-Dach, Birke, Dunkelholz, Sandstein)', () => {
    const w = build('terracotta_birch');
    const blocks = new Set(w.materialized.palette.map((p) => p.block.replace('minecraft:', '')));
    const has = (re: RegExp): boolean => [...blocks].some((b) => re.test(b));
    expect(has(/sandstone/)).toBe(true);
    expect(has(/dark_oak|spruce/)).toBe(true);
    expect(has(/birch|white_concrete|quartz|calcite|smooth_quartz/)).toBe(true);
  });
});
