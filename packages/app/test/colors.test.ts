import { describe, expect, it } from 'vitest';
import { blockFamily, categoryColor, css, hashColor, isLightMaterial, materialColor, roleColor, roomTypeColor } from '../src/colors.js';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';

const catalog = loadBundledCatalog().catalog!;
const isRgb = (c: number) => Number.isInteger(c) && c >= 0 && c <= 0xffffff;

describe('Farbzuordnung', () => {
  it('MVP-Raumtypen haben feste, unterscheidbare Farben', () => {
    const colors = ['bedroom', 'kitchen', 'smithy', 'storage'].map(roomTypeColor);
    expect(new Set(colors).size).toBe(4);
    expect(roomTypeColor('bedroom')).toBe(0x6c8ebf);
  });

  it('unbekannte Raumtypen/Rollen bekommen eine stabile Farbe aus dem Namen', () => {
    expect(roomTypeColor('library')).toBe(roomTypeColor('library'));
    expect(roomTypeColor('library')).not.toBe(roomTypeColor('brewery'));
    expect(isRgb(hashColor('x'))).toBe(true);
    expect(isRgb(roleColor('something_new'))).toBe(true);
  });

  it('Material: Rolle vor Blockfamilie vor Kategorie', () => {
    expect(materialColor({ role: 'furniture_wood', shape: 'slab' }, 'decor')).toBe(roleColor('furniture_wood'));
    expect(materialColor({ block: 'minecraft:chest' }, 'furniture')).not.toBe(categoryColor('furniture'));
    expect(materialColor({ block: 'minecraft:potted_fern' }, 'decor')).toBe(materialColor({ block: 'minecraft:potted_poppy' }, 'decor'));
    expect(materialColor({ block: 'minecraft:unknown_thing' }, 'work')).toBe(categoryColor('work'));
  });

  it('Blockfamilie ohne Namensraum', () => {
    expect(blockFamily('minecraft:blast_furnace')).toBe('blast_furnace');
    expect(blockFamily('barrel')).toBe('barrel');
  });

  it('Lichtquellen erkennen', () => {
    expect(isLightMaterial({ role: 'light_hanging', shape: 'lantern' })).toBe(true);
    expect(isLightMaterial({ role: 'metal', shape: 'chain' })).toBe(false);
    expect(isLightMaterial({ block: 'minecraft:wall_torch' })).toBe(true);
    expect(isLightMaterial({ block: 'minecraft:candle' })).toBe(true);
    expect(isLightMaterial({ block: 'minecraft:chest' })).toBe(false);
  });

  it('jedes Material im Katalog bekommt eine gültige Farbe; jede Lichtkomponente leuchtet', () => {
    for (const def of catalog.all()) {
      const mats = [...Object.values(def.legend ?? {}), ...(def.cells ?? []).map((c) => c.mat), ...(def.variants ?? []).flatMap((v) => [...Object.values(v.legend ?? {}), ...(v.cells ?? []).map((c) => c.mat)])];
      expect(mats.length, def.id).toBeGreaterThan(0);
      for (const m of mats) expect(isRgb(materialColor(m, def.category)), def.id).toBe(true);
      if (def.category === 'light') expect(mats.some(isLightMaterial), def.id).toBe(true);
    }
  });

  it('CSS-Hex mit führenden Nullen', () => {
    expect(css(0x00ff0a)).toBe('#00ff0a');
    expect(css(0)).toBe('#000000');
  });
});
