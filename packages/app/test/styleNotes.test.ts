import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { worldOf } from '../src/exporting.js';
import { quoinEffect, roofFitNote } from '../src/ui/styleNotes.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;

describe('W4-D Stil-Hinweise', () => {
  it('roofFitNote: Teilung und gesenkte Neigung in Nutzersprache, sonst nichts', () => {
    expect(roofFitNote(undefined)).toBeUndefined();
    expect(roofFitNote([{ volumeId: 'v0', floorIndex: 0, requested: 'steep', pitch: 'steep', area: 80 }])).toBeUndefined();
    expect(roofFitNote([{ volumeId: 'v0', floorIndex: 0, requested: 'normal', pitch: 'normal', area: 200, split: true }]))
      .toBe('Dach geteilt (zu breit für ein Dach in dieser Neigung).');
    expect(roofFitNote([
      { volumeId: 'v1', floorIndex: 0, requested: 'steep', pitch: 'low', area: 20 },
      { volumeId: 'v0', floorIndex: 0, requested: 'steep', pitch: 'normal', area: 200 },
    ])).toBe('Neigung gesenkt: steil → normal, steil → flach (automatische Dachhöhe).');
    // W4-F (27.09.2026): Kniestock – Teilung und Kniestock zusammen, größter Kniestock je Bau
    expect(roofFitNote([{ volumeId: 'v0', floorIndex: 0, requested: 'normal', pitch: 'normal', area: 120, knee: 2 }]))
      .toBe('Wand um 2 Reihen erhöht (Kniestock – sonst wäre das Dach höher als die Wand).');
    expect(roofFitNote([{ volumeId: 'v0', floorIndex: 0, requested: 'normal', pitch: 'normal', area: 400, split: true, knee: 1 }]))
      .toBe('Dach geteilt (zu breit für ein Dach in dieser Neigung) · Wand um 1 Reihe erhöht (Kniestock – sonst wäre das Dach höher als die Wand).');
  });

  it('quoinEffect stimmt mit dem fertigen Bau überein: ohne Wirkung ⇒ Eckquader an/aus bitgleich', async () => {
    const ctx = await browserContext(load)!.ready('1.21.11');
    const themes = ['asian', 'desert', 'dwarven', 'elven', 'farmstead', 'gothic', 'harbor', 'medieval', 'nordic', 'nordic_falu', 'ruin', 'rustic', 'steampunk', 'terracotta_birch', 'timber', 'tropical', 'winter'];
    const seen = { full: 0, partial: 0, none: 0 };
    for (const themeId of themes) {
      let s = uc.createSession(11, 'X', themeId);
      s = uc.paintRect(s, catalog, { x1: 3, z1: 3, x2: 14, z2: 12 }, 'bedroom').session;
      const style = uc.shellStyle(s);
      const blocks = (quoins: boolean): string => {
        const w = worldOf(s.project, ctx, { ...style, facade: { ...style.facade, quoins } });
        return w.materialized.palette.map((e) => `${e.block}:${e.count}`).sort().join('|');
      };
      const effect = quoinEffect(uc.shellThemeOf(catalog, themeId));
      seen[effect]++;
      // „teilweise“ hängt am Haus (Geschoss, lichte Höhe) – dort nur die beiden eindeutigen Fälle
      if (effect === 'full') expect(blocks(true), themeId).not.toBe(blocks(false));
      if (effect === 'none') expect(blocks(true), themeId).toBe(blocks(false));
    }
    // beide Richtungen kommen vor (sonst prüft der Test nichts)
    expect(seen.full).toBeGreaterThan(0);
    expect(seen.none, JSON.stringify(seen)).toBeGreaterThan(0);
  });
});
