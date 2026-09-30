import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ThemeResolver } from '@mcda/materialize';
import { ctx, engine } from './fixture.js';

describe('Q4: wählbarer Höhenverlauf', () => {
  const id = 'steinburg_verlauf';
  it('ist mit Stopps über den Katalog abrufbar', () => {
    const result = engine.execute({ op: 'catalog_get', input: { kind: 'palette', id } });
    expect(result).toMatchObject({ ok: true, data: { id, roles: { roof: { gradientStops: [
      { at: 0 }, { at: 0.55 }, { at: 1 },
    ] } } } });
  });

  for (const version of ['1.21.11', '26.3'] as const) {
    it(`${version}: materialisiert unterschiedliche Dachenden und gültige Treppen`, () => {
      const palette = ctx.palettes!.get(id);
      const theme = ctx.themes.resolveWith('medieval', palette);
      const platform = ctx.platform(version);
      const resolver = new ThemeResolver(theme, platform.families, platform.registry);
      const sample = (t: number) => new Set(Array.from({ length: 100 }, (_, seed) => {
        const out = resolver.resolve('roof_main', 'stairs', { mixSeed: seed, t: { roof_t: t } });
        expect(out.via).toBe('direct');
        expect(platform.registry.defaultState(out.block)).toBeDefined();
        return out.block;
      }));
      const low = sample(0);
      const high = sample(1);
      expect(low.has('blackstone_stairs')).toBe(true);
      expect(high.has('cobbled_deepslate_stairs')).toBe(true);
      expect(low).not.toEqual(high);
    });

    it(`${version}: API-Auswahl wirkt und bleibt reproduzierbar`, () => {
      const digest = (paletteId: string) => {
        const result = engine.execute({ op: 'building_generate', input: {
          buildingTypeId: 'house', themeId: 'medieval', targetVersion: version,
          paletteId, seed: 7, surroundings: false,
        } });
        if (!result.ok || result.artifacts?.export === undefined) throw new Error(JSON.stringify(result));
        return createHash('sha256').update(JSON.stringify(result.artifacts.export.blocks,
          (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value)).digest('hex');
      };
      expect(digest(id)).not.toEqual(digest('steinburg_grau'));
      expect(digest(id)).toEqual(digest(id));
    });
  }
});
