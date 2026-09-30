/**
 * W7-D (plan/spikes/W7D_fantasy.md) über die Engine-API: Fantasy-Stufe und -Kit der Außengestaltung
 * (`exterior.fantasy`, `exterior.fantasyKit`) in `building_generate` – Standard nach Theme (elven/dwarven voll, sonst
 * aus, bitgleich), in anderen Themes zuschaltbar, abschaltbar über die Gruppe `fantasyDecor` bzw. `fantasy: off`.
 */
import { describe, expect, it } from 'vitest';
import type { ExportVolume } from '@mcda/export';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import type { ExecuteResult } from '../src/index.js';
import { engine } from './fixture.js';

/** Blöcke, die nur Fantasy-Module setzen (Giebelzier, Banner) – Namen ohne Namensraum. */
const FANTASY_BLOCKS = ['amethyst_cluster', 'green_wall_banner', 'red_wall_banner', 'chiseled_tuff_bricks'];
const blocks = (r: ExecuteResult): Set<string> => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return new Set((r.artifacts!['export'] as ExportVolume).blocks.map((b) => b.name.replace(/^minecraft:/, '')));
};
const fantasyIn = (r: ExecuteResult): string[] => FANTASY_BLOCKS.filter((b) => blocks(r).has(b)).sort();
const base = { buildingTypeId: 'house', size: 'M', seed: 2026, surroundings: false };
/**
 * Fantasy-Blöcke, die die Stufe gegenüber `fantasy: off` desselben Themes hinzufügt. W8-B (2026-09-27): Die
 * Einrichtung kann Banner auch innen als Deko setzen (z. B. `red_wall_banner` im medieval-Haus) – gezählt wird deshalb
 * nur, was die Außengestaltung zusätzlich bringt.
 */
const offCache = new Map<string, string[]>();
const fantasyAdded = (r: ExecuteResult, themeId: string): string[] => {
  let off = offCache.get(themeId);
  if (off === undefined) {
    off = fantasyIn(engine.execute({ op: 'building_generate', input: { ...base, themeId, exterior: { fantasy: 'off' } } }));
    offCache.set(themeId, off);
  }
  return fantasyIn(r).filter((b) => !off.includes(b));
};

describe('W7-D: Fantasy-Stufe über die Engine-API', () => {
  it('Standard nach Theme: medieval ohne Fantasy-Module, elven und dwarven mit ihrem Kit', () => {
    expect(fantasyAdded(engine.execute({ op: 'building_generate', input: { ...base, themeId: 'medieval' } }), 'medieval')).toEqual([]);
    const elven = fantasyAdded(engine.execute({ op: 'building_generate', input: { ...base, themeId: 'elven' } }), 'elven');
    expect(elven).toContain('amethyst_cluster');
    expect(elven).not.toContain('red_wall_banner');
    const dwarven = fantasyAdded(engine.execute({ op: 'building_generate', input: { ...base, themeId: 'dwarven' } }), 'dwarven');
    expect(dwarven).toContain('chiseled_tuff_bricks');
    expect(dwarven).not.toContain('amethyst_cluster');
  }, HEAVY_TIMEOUT);

  it('zuschaltbar in anderen Themes (full + Kit), abschaltbar (off bzw. Gruppe fantasyDecor)', () => {
    const on = fantasyAdded(engine.execute({ op: 'building_generate', input: { ...base, themeId: 'medieval', exterior: { fantasy: 'full', fantasyKit: 'elven' } } }), 'medieval');
    expect(on).toContain('amethyst_cluster');
    // Stufe „Akzent“: nur ersetzende Module (Bogenarm, Giebelhorn) – keine Banner, Zier, Ranken
    expect(fantasyAdded(engine.execute({ op: 'building_generate', input: { ...base, themeId: 'medieval', exterior: { fantasy: 'accent' } } }), 'medieval')).toEqual([]);
    // „aus“ hat keine Giebelzier (Amethyst), Gruppe fantasyDecor aus fügt nichts gegenüber „aus“ hinzu
    expect(fantasyIn(engine.execute({ op: 'building_generate', input: { ...base, themeId: 'elven', exterior: { fantasy: 'off' } } }))).not.toContain('amethyst_cluster');
    expect(fantasyAdded(engine.execute({ op: 'building_generate', input: { ...base, themeId: 'elven', exterior: { off: ['fantasyDecor'] } } }), 'elven')).toEqual([]);
  }, HEAVY_TIMEOUT);

  it('ungültige Stufe bzw. ungültiges Kit werden abgewiesen', () => {
    expect(engine.execute({ op: 'building_generate', input: { ...base, exterior: { fantasy: 'max' } } }).ok).toBe(false);
    expect(engine.execute({ op: 'building_generate', input: { ...base, exterior: { fantasyKit: 'orcish' } } }).ok).toBe(false);
  });
});
