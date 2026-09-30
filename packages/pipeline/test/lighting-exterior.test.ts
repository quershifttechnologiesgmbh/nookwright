/**
 * C4 – Außenlicht im Licht-Pass: Außen-Laternen (X1, Wand- und Traufenlaternen, Portal) leuchten durch Fenster und
 * Türen in die Räume. Mit `exterior` misst der Pass sie mit und ergänzt höchstens so viele Lichter wie ohne; das Ziel
 * (kein Spawn, Stimmungslicht) bleibt erfüllt. Ohne `exterior` bzw. leer: bitgleich.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, type Shell } from '@mcda/blueprint';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { exteriorFor, furnishRoomsDetailed, generate, lightRooms, sampleHouse, shellFor, twoStoryHouse, type LightingResult } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

/** Eingerichtetes Projekt + Hülle + Außen-Plan (Dichte 2: viele Laternen). */
function setup(make: () => Project, density: number, furnish = true): { project: Project; shell: Shell; exterior: ReturnType<typeof exteriorFor>['placements'] } {
  const project = make();
  const shell = shellFor(project, { roof: 'gable' });
  if (furnish) furnishRoomsDetailed(project, shell, ctx.catalog);
  return { project, shell, exterior: exteriorFor(project, shell, ctx.catalog, { density }).placements };
}
const added = (r: LightingResult): number => r.rooms.reduce((n, x) => n + x.added, 0);
const lanterns = (ext: ReturnType<typeof exteriorFor>['placements']): number => ext.filter((p) => /lantern|lamp|torch/.test(p.componentId)).length;

describe('Licht-Pass mit Außenlicht (C4)', () => {
  const HOUSES = { Beispielhaus: () => sampleHouse('1.21.11', 'medieval'), zweistöckig: () => twoStoryHouse('1.21.11', 'medieval'), rustikal: () => sampleHouse('26.3', 'rustic', 7) };
  for (const [name, make] of Object.entries(HOUSES)) {
    it(`${name}: höchstens so viele Ergänzungen wie ohne Außenlicht, Ziel weiter erfüllt, Außenlicht wirkt`, { timeout: HEAVY_TIMEOUT }, () => {
      for (const density of [1, 2]) {
        const a = setup(make, density);
        const b = setup(make, density);
        expect(lanterns(a.exterior), `${name}/${density}: Außen-Laternen`).toBeGreaterThan(0);
        const without = lightRooms(a.project, a.shell, ctx);
        const withExt = lightRooms(b.project, b.shell, ctx, { exterior: b.exterior });
        const where = `${name}/${density}: ${added(withExt)} mit, ${added(without)} ohne Außenlicht`;
        expect(added(withExt), where).toBeLessThanOrEqual(added(without));
        for (const r of withExt.rooms) expect(r, where).toMatchObject({ darkCells: 0, belowTarget: 0 });
        expect(withExt.warnings, where).toEqual([]);
        // die Welt des Passes enthält die Außen-Teile (Vorschau/Export brauchen nicht neu zu materialisieren)
        expect(withExt.world.exterior, where).toEqual(b.exterior);
        // Außenlicht kommt an: Gleiche Einrichtung ohne ergänzte Innenlichter vergleichen.
        // Innenlichter können den Beitrag der Außenlaternen durch die Maximum-Bildung verdecken.
        // Das erreichte Stimmungsziel allein sagt nichts über zusätzlichen Helligkeitsgewinn aus.
        // W2 (26.09.2026): ohne Einrichtung vergleichen – nach Regel I6 (Deko-Budget, Hauptweg) hängen Programm-Lichter
        // teils nah an Tür und Fenster und überdecken das Außenlicht (Maximum-Bildung); gefragt ist nur, ob es ankommt
        const c = setup(make, density, false);
        const d = setup(make, density, false);
        const plain = lightRooms(c.project, c.shell, ctx, { maxRounds: 0 });
        const lit = lightRooms(d.project, d.shell, ctx, { maxRounds: 0, exterior: d.exterior });
        let reached = 0;
        let gain = 0;
        for (const g of d.shell.rooms.values()) {
          for (const [x, z] of g.interior.toArray()) {
            const before = plain.world.materialized.light.levelAt([x, g.baseY, z]);
            const after = lit.world.materialized.light.levelAt([x, g.baseY, z]);
            if (after > before) {
              reached++;
              gain += after - before;
            }
          }
        }
        expect(reached, `${where} (Außenlicht erreicht ${reached} Zelle(n), Zugewinn ${gain})`).toBeGreaterThan(0);
      }
    });
  }

  it('ohne bzw. mit leerem `exterior` bitgleich; generate mit Außen-Deko: Pass misst sie mit', { timeout: HEAVY_TIMEOUT }, () => {
    const a = setup(() => sampleHouse('1.21.11', 'medieval'), 1);
    const b = setup(() => sampleHouse('1.21.11', 'medieval'), 1);
    const x = lightRooms(a.project, a.shell, ctx);
    const y = lightRooms(b.project, b.shell, ctx, { exterior: [] });
    expect(JSON.stringify(y.rooms)).toBe(JSON.stringify(x.rooms));
    expect(JSON.stringify(b.project.state.placements)).toBe(JSON.stringify(a.project.state.placements));
    expect(y.world.exterior).toBeUndefined();
    // generate: Außen-Deko an → gleiche oder weniger Ergänzungen als dieselbe Kette ohne Außen-Deko
    const on = generate(sampleHouse('1.21.11', 'medieval'), ctx, { roof: 'gable', exterior: { density: 2 } });
    const off = generate(sampleHouse('1.21.11', 'medieval'), ctx, { roof: 'gable' });
    expect(added(on.lighting!)).toBeLessThanOrEqual(added(off.lighting!));
    expect(on.lighting!.rooms.every((r) => r.darkCells === 0 && r.belowTarget === 0)).toBe(true);
    expect(on.exterior?.length).toBeGreaterThan(0);
  });
});
