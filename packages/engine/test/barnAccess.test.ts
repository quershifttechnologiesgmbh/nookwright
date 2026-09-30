/**
 * W12-E (Review R6-5): Das Bauernhaus der goldenen Menge (M, Seed 2026, rustikal/mittelalterlich) stellt die Scheune
 * frei neben das Haus, mit eigenem Tor. `building_generate` meldet Stall und Lager nicht mehr als „ohne Weg“ – dieselbe
 * Regel wie Editor und Exportdialog der App (`circulation` in @mcda/pipeline).
 */
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { engine } from './fixture.js';

describe('W12-E: Scheune mit eigenem Eingang über die Engine', () => {
  for (const themeId of ['rustic', 'medieval']) {
    it(`building_generate Bauernhaus M (${themeId}, Seed 2026): kein Raum ohne Weg, kein Zugangs-Hinweis`, () => {
      const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'farmhouse', size: 'M', seed: 2026, themeId } });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      const c = (r.data as { circulation: { unreachable: string[]; hints: string[] } }).circulation;
      expect(c.unreachable).toEqual([]);
      expect(c.hints.join('\n')).not.toMatch(/Ohne Weg vom Eingang/);
    }, HEAVY_TIMEOUT);
  }
});
