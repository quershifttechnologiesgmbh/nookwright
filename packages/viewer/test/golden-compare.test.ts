/**
 * Goldene Galerie (P0-A): Vergleich (Pixel-Differenz, Miniatur), goldene Menge (alle Bautypen des Katalogs) und die
 * HTML-Seiten (Kontaktbogen, Vergleich).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { diffImages, downscale } from '../golden/lib/diff.js';
import { compareHtml, contactSheetHtml } from '../golden/lib/html.js';
import { expandSet, selectEntries } from '../golden/lib/set.js';

const img = (w: number, h: number, rgb: [number, number, number]): { width: number; height: number; data: Uint8Array } => {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { width: w, height: h, data };
};

describe('Goldene Galerie: Pixel-Vergleich', () => {
  it('gleiche Bilder: 0 %', () => {
    const d = diffImages(img(8, 5, [10, 20, 30]), img(8, 5, [10, 20, 30]));
    expect(d).toMatchObject({ percent: 0, changed: 0, total: 40, maxDelta: 0, sameSize: true });
  });

  it('ein Pixel über der Schwelle zählt, darunter nicht', () => {
    const a = img(10, 10, [100, 100, 100]);
    const b = img(10, 10, [100, 100, 100]);
    b.data[0] = 150; // Pixel 0: Δ 50
    b.data[4 * 7 + 1] = 110; // Pixel 7: Δ 10 (unter 16)
    const d = diffImages(a, b);
    expect(d.changed).toBe(1);
    expect(d.percent).toBeCloseTo(1, 9);
    expect(d.maxDelta).toBe(50);
    // Differenzbild: verändert rot, sonst abgedunkeltes Grau
    expect(d.image!.data[0]).toBeGreaterThan(110);
    expect(d.image!.data[1]).toBe(24);
    expect(d.image!.data[4 * 7]).toBe(d.image!.data[4 * 7 + 1]);
    expect(diffImages(a, b, 5).changed).toBe(2);
  });

  it('verschiedene Größe: 100 %', () => {
    const d = diffImages(img(4, 4, [0, 0, 0]), img(4, 5, [0, 0, 0]));
    expect(d.percent).toBe(100);
    expect(d.sameSize).toBe(false);
    expect(d.image).toBeUndefined();
  });

  it('Miniatur behält markierte Pixel', () => {
    const a = img(64, 40, [100, 100, 100]);
    const b = img(64, 40, [100, 100, 100]);
    b.data[(20 * 64 + 33) * 4] = 255;
    const d = diffImages(a, b);
    const t = downscale(d.image!, 16);
    expect(t.width).toBe(16);
    expect(t.height).toBe(10);
    const red = [...Array(16 * 10).keys()].filter((i) => t.data[i * 4]! > t.data[i * 4 + 1]! + 60);
    expect(red).toEqual([5 * 16 + 8]);
  });
});

describe('Goldene Galerie: goldene Menge', () => {
  const setFile = fileURLToPath(new URL('../golden/set.json5', import.meta.url));
  const set = expandSet(JSON5.parse(readFileSync(setFile, 'utf8')));

  it('enthält jeden Bautyp des Katalogs (Standard-Theme + Variante), IDs eindeutig', () => {
    const catalogDir = fileURLToPath(new URL('../../../catalog/buildingtypes', import.meta.url));
    const types = readdirSync(catalogDir).filter((f) => f.endsWith('.json5')).map((f) => f.replace(/\.json5$/, '')).sort();
    const std = set.entries.filter((e) => !e.variant);
    expect(std.map((e) => e.type).sort()).toEqual(types);
    expect(new Set(set.entries.map((e) => e.id)).size).toBe(set.entries.length);
    for (const e of set.entries) {
      expect(e.id).toBe(`${e.type}-${e.theme}`);
      expect(e.seed).toBe(2026);
      expect(e.size).toBe('M');
    }
  });

  it('Standard-Theme = erstes Theme des Bautyps (feste Vorlagen: medieval)', () => {
    const catalogDir = fileURLToPath(new URL('../../../catalog/buildingtypes', import.meta.url));
    for (const e of set.entries.filter((x) => !x.variant)) {
      const def = JSON5.parse(readFileSync(`${catalogDir}/${e.type}.json5`, 'utf8')) as { themes?: string[] };
      expect(e.theme, e.type).toBe(def.themes?.[0] ?? 'medieval');
      if (def.themes !== undefined) {
        for (const v of set.entries.filter((x) => x.type === e.type && x.variant)) expect(def.themes, e.type).toContain(v.theme);
      }
    }
  });

  it('--only nach Bautyp oder ID; Unbekanntes ist ein Fehler', () => {
    expect(selectEntries(set.entries, ['tavern']).map((e) => e.id)).toEqual(['tavern-timber', 'tavern-medieval']);
    expect(selectEntries(set.entries, ['hall-nordic']).map((e) => e.id)).toEqual(['hall-nordic']);
    expect(() => selectEntries(set.entries, ['schloss'])).toThrow(/unbekannt/);
  });

  it('ungültige Menge wird abgelehnt', () => {
    expect(() => expandSet({ version: 2 })).toThrow(/version/);
    expect(() => expandSet({ version: 1, seed: 1, size: 'M', targetVersion: { name: '1.21.11', dataVersion: 4671 }, entries: [{ type: 'a', theme: 'x' }, { type: 'a', theme: 'x' }] })).toThrow(/doppelte/);
  });
});

describe('Goldene Galerie: HTML', () => {
  it('Kontaktbogen: je Bau eine Zeile, Bilder relativ, Text maskiert', () => {
    const html = contactSheetHtml({ title: 'Lauf <1>', lines: ['a & b'] }, [
      { id: 'tavern-timber', title: 'tavern', facts: ['x'], views: [{ name: 'hero-so', label: 'Hero', group: 'hero', image: 'tavern-timber/hero-so.png', thumb: 'tavern-timber/thumb/hero-so.jpg' }] },
    ]);
    expect(html).toContain('Lauf &lt;1&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('src="tavern-timber/thumb/hero-so.jpg"');
    expect(html).toContain('"src":"tavern-timber/hero-so.png"');
    expect(html).toContain('Mojang-Texturen');
  });

  it('Vergleich: nach größter Änderung sortiert, Nur-in-Listen', () => {
    const it = (key: string, percent: number) => ({ key, percent, a: `A/${key}.png`, b: `B/${key}.png`, aThumb: 'a.jpg', bThumb: 'b.jpg' });
    const html = compareHtml({ title: 'V', lines: [] }, [it('x/hero-so', 0.5), it('y/innen-1', 12), it('z/fassade-n', 0)], ['q/nah-ecke'], [], ['A', 'B']);
    expect(html.indexOf('y/innen-1')).toBeLessThan(html.indexOf('x/hero-so'));
    expect(html.indexOf('x/hero-so')).toBeLessThan(html.indexOf('z/fassade-n'));
    expect(html).toContain('3 Bildpaare, davon 2 verändert');
    expect(html).toContain('q/nah-ecke');
  });
});
