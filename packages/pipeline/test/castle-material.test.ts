/**
 * W5-B „Burg-Material und Theme-Treue“ (plan/spikes/W5B_burg.md) über den Anwendungsdienst (Weg der Galerie):
 *  - N4: der Bautyp gibt die Familie „wehrhaft“ vor, das Theme das Material – Stein-Portal und Stein-Fenster nur an
 *    Steinwänden (medieval), die Holzburg (nordic, rustic) und der Holzturm (rustic) nehmen die Module ihres Themes,
 *    im Portal der Holzburg liegt kein Stein (vorher Tiefenschiefer-Gewände);
 *  - N5 (D9 Bauwerk): nordische Holzburg mit Krone aus Stämmen und Wehrgang/Plattform aus Eiche statt „komplett braun“;
 *  - harte Regeln: 0 Physik-/Kollisionsverstöße.
 */
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType } from '../src/index.js';
import { ctx, loadType } from './buildingtype-fuzz.js';

const V = TARGET_VERSIONS['1.21.11'];
const build = (type: string, themeId: string, seed = 2026) => {
  const res = projectFromBuildingType(loadType(type), { size: 'M', themeId, targetVersion: V }, seed, ctx);
  return { res, w: generateBase(res.project, ctx, { ...res.build, ...res.surroundings }) };
};
const STONE = /deepslate|stone|cobble|andesite|brick|tuff|blackstone/;

describe('W5-B N4: Module im Material des Themes', () => {
  // W6 (27.09.2026, Review W4-R Runde 3 „Leichtes“): Fenster an Holzwänden aus der Familie „wehrhaft“ (`fort`: Stammwangen,
  // keine Läden) statt der Wohnhaus-Module des Themes; der Eingang bleibt beim Modul des Themes
  const CASES = [
    ['castle_compact', 'medieval', 'stone', 'stone'],
    ['castle_compact', 'nordic', 'fort', 'nordic'],
    ['castle_compact', 'rustic', 'fort', 'cottage'],
    ['watchtower', 'medieval', 'stone', 'stone'],
    ['watchtower', 'rustic', 'fort', 'cottage'],
  ] as const;
  for (const [type, theme, win, entr] of CASES) {
    it(`${type} ${theme}: Fenster ${win}, Eingang ${entr}`, { timeout: HEAVY_TIMEOUT }, () => {
      const { res, w } = build(type, theme);
      expect(res.build.exterior).toMatchObject({ windowModule: 'stone', entranceModule: 'stone', themeMaterial: true });
      const ids = new Set((w.exterior ?? []).map((p) => p.componentId));
      expect([...ids].filter((m) => m.startsWith('exterior/window_module_'))).toEqual([`exterior/window_module_${win}`]);
      expect([...ids].filter((m) => m.startsWith('exterior/entrance_module_'))).toEqual([`exterior/entrance_module_${entr}`]);
      if (theme !== 'medieval') {
        // kein Stein im Portal der Holzburg (vorher Tiefenschiefer-Gewände und Mauerwangen)
        // W12 (2026-09-28): W12-D deckt das nordische Dach mit Tiefenschiefer; die Dachstufen des Giebel-Vordachs
        // (Rolle `roof_main`) nehmen dieses Dach auf wie am Wohnhaus – geprüft bleiben Gewände, Pfosten und Stufen
        const vol = w.materialized.volume;
        const ROOF = /deepslate_tile/;
        const portal = (w.exterior ?? []).filter((p) => p.componentId.startsWith('exterior/entrance_module_'))
          .flatMap((p) => p.cells.map((c) => vol.stateAt(c).name)).filter((n) => STONE.test(n) && !(theme === 'nordic' && ROOF.test(n)));
        expect(portal).toEqual([]);
      }
      // W6: am Wehrbau keine Fensterläden und keine Blumenkästen (vorher Cottage-Läden am rustikalen Wachturm)
      expect((w.exterior ?? []).filter((p) => p.group === 'shutters' || p.group === 'flowerBoxes').map((p) => p.id)).toEqual([]);
      expect(w.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
    });
  }
});

describe('W5-B N5: nordische Holzburg nicht einfarbig (D9 Bauwerk)', () => {
  it('Krone aus Stämmen mit Rinde, Wehrgang und Turmplattformen aus Eiche, Mauer aus Fichte', { timeout: HEAVY_TIMEOUT }, () => {
    const { w } = build('castle_compact', 'nordic');
    const vol = w.materialized.volume;
    const names = (role: string): string[] => w.surroundings.cells.filter((c) => c.kind === 'fort' && c.role === role && vol.contains(c.pos))
      .map((c) => vol.stateAt(c.pos).name).filter((n) => n !== 'air');
    const share = (xs: string[], re: RegExp): number => xs.filter((n) => re.test(n)).length / Math.max(1, xs.length);
    expect(share(names('parapet'), /^(spruce|dark_oak)_log$/)).toBe(1);
    expect(share(names('walkway'), /^oak_/)).toBe(1);
    expect(share(names('wall_primary'), /spruce|dark_oak/)).toBeGreaterThan(0.9);
    expect(w.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
  });
});
