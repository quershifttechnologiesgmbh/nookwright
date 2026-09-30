/**
 * W16-B (plan/spikes/W16B_bauernhaus.md, Review R7-2 und R7-4): Bauernhof über den Anwendungsdienst
 * (`projectFromBuildingType` + `generateBase`, wie Assistent, Engine und goldene Menge).
 *
 * - Wohnküche mit Fenster (`FacadeStyle.lightRooms`): auch dort, wo das Fensterraster sie ohne Fenster ließ (Golden-Seed
 *   2026 M, Seed 8 M, Seeds 5/6 S); ohne die Regel bleibt sie dort fensterlos (Nachweis, dass die Regel wirkt).
 * - Scheune mit eigenem, dunklem Dach (`Volume.exterior.roof` = `roof_barn`), das Wohnhaus behält seine Deckung.
 * - Hochsilo schon in M, vor der Scheune an der Außenecke (im ersten Blick sichtbar), Kuppel im Scheunendach.
 * - Feld vor der Scheune (Zone mit `part`), Feldfrüchte reif.
 * - 0 harte Verstöße, deterministisch.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, shellFor, themeFor, type BaseWorld, type BuildingTypeResult } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

function plan(size: 'S' | 'M' | 'L', theme: string, seed: number): BuildingTypeResult {
  return projectFromBuildingType(ctx.buildingTypes.get('farmhouse')!, { size, themeId: theme, targetVersion: TARGET_VERSIONS['1.21.11'] }, seed, ctx);
}

function build(size: 'S' | 'M' | 'L', theme: string, seed: number): { res: BuildingTypeResult; world: BaseWorld } {
  const res = plan(size, theme, seed);
  return { res, world: generateBase(res.project, ctx, { ...res.build, ...res.surroundings }) };
}

/** Fenster der Küche im Erdgeschoss (Hülle mit bzw. ohne Fenster-Pflicht). */
function kitchenWindows(res: BuildingTypeResult, light: boolean): number {
  const { lightRooms, ...rest } = res.build.facade ?? {};
  const facade = res.build.facade === undefined ? undefined : light && lightRooms !== undefined ? { ...rest, lightRooms } : rest;
  const shell = shellFor(res.project, { ...res.build, ...(facade !== undefined ? { facade } : {}) }, themeFor(res.project, ctx));
  const k = res.project.state.rooms.find((r) => r.roomTypeId === 'kitchen' && r.floorIndex === 0)!;
  return shell.rooms.get(k.id)!.windows.length;
}

describe('W16-B: Bauernhaus (Küche mit Fenster, dunkles Scheunendach, Silo und Feld vorn)', () => {
  it('Wohnküche bekommt ein Fenster, wo das Raster sie ohne ließ (R7-4)', { timeout: HEAVY_TIMEOUT }, () => {
    for (const [size, seed] of [['M', 2026], ['M', 8], ['S', 5], ['S', 6]] as const) {
      for (const theme of ['rustic', 'medieval']) {
        const res = plan(size, theme, seed);
        expect(res.build.facade?.lightRooms, 'Bautyp setzt die Regel').toEqual(['kitchen']);
        expect(kitchenWindows(res, false), `${theme} ${size} ${seed}: ohne Regel fensterlos (Vorbedingung)`).toBe(0);
        expect(kitchenWindows(res, true), `${theme} ${size} ${seed}: mit Regel`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('M (Golden-Seed): dunkles Scheunendach, Silo vor der Scheune, Feld davor, reife Früchte, 0 harte Verstöße', { timeout: HEAVY_TIMEOUT }, () => {
    for (const theme of ['rustic', 'medieval']) {
      const { res, world } = build('M', theme, 2026);
      const st = res.project.state;
      const barnV = (st.volumes ?? []).find((v) => v.exterior?.barn === true)!;
      expect(barnV.exterior?.roof).toBe('roof_barn');
      const barnRooms = new Set(st.rooms.filter((r) => r.volumeId === barnV.id).map((r) => r.id));
      const roofOf = (inBarn: boolean): string[] => world.shell.cells.filter((c) => c.kind === 'roof' && c.roomId !== undefined && barnRooms.has(c.roomId) === inBarn).map((c) => c.role);
      expect(roofOf(true)).toContain('roof_barn');
      expect(roofOf(true)).not.toContain('roof_main');
      expect(roofOf(false)).not.toContain('roof_barn');
      // Silo: vor der Scheune (Plan-Vorderseite = Richtung der Haustür), Kuppel im Scheunendach
      const silo = world.shell.cells.filter((c) => c.kind === 'fort' && String(c.roomId ?? '').includes('silo'));
      expect(silo.length, `${theme}: Silo in M`).toBeGreaterThan(200);
      expect(silo.some((c) => c.role === 'roof_barn')).toBe(true);
      const barnZ = st.rooms.filter((r) => barnRooms.has(r.id)).flatMap((r) => r.cells.toArray().map((c) => c[1]));
      const siloZ = silo.map((c) => c.pos[2]);
      expect(res.plan.params.front).toBe('south');
      expect(Math.min(...siloZ), `${theme}: Silo vor der Vorderwand der Scheune`).toBeGreaterThan(Math.max(...barnZ));
      // Feld vor der Scheune (zweites Feld neben dem Feld der Vorlage hinter dem Haus)
      const fields = (res.site?.state.zones ?? []).filter((z) => z.kind === 'field');
      expect(fields.length).toBeGreaterThanOrEqual(2);
      const barnX = st.rooms.filter((r) => barnRooms.has(r.id)).flatMap((r) => r.cells.toArray().map((c) => c[0]));
      expect(fields.some((z) => z.cells.toArray().every(([x, zz]) => zz > Math.max(...barnZ) && x >= Math.min(...barnX) - 1 && x <= Math.max(...barnX) + 1)), `${theme}: Feld vor der Scheune`).toBe(true);
      // reife Früchte (Stufe 7 bzw. Rote Bete 3)
      const vol = world.materialized.volume;
      const crops = (world.surroundings?.cells ?? []).filter((c) => /^crop_/.test(c.role)).filter((c) => vol.contains(c.pos) && !vol.isEmpty(c.pos));
      expect(crops.length).toBeGreaterThan(20);
      for (const c of crops) {
        const s = vol.stateAt(c.pos);
        expect(String(s.properties?.['age']), `${String(s.name)} bei ${c.pos.join(',')}`).toBe(String(s.name).endsWith('beetroots') ? '3' : '7');
      }
      expect(world.materialized.violations.filter((v) => v.kind !== 'spawn'), theme).toEqual([]);
    }
  });

  it('deterministisch: gleicher Seed → gleiche Hülle, Bauwerke und Zonen', { timeout: HEAVY_TIMEOUT }, () => {
    const a = build('M', 'rustic', 2026);
    const b = build('M', 'rustic', 2026);
    const sig = (w: BaseWorld): string[] => w.shell.cells.map((c) => `${c.pos.join(',')}:${c.kind}:${c.role}:${c.shape}`);
    expect(sig(b.world)).toEqual(sig(a.world));
    expect((b.res.site?.state.zones ?? []).map((z) => `${z.kind}:${z.cells.size}`)).toEqual((a.res.site?.state.zones ?? []).map((z) => `${z.kind}:${z.cells.size}`));
  });
});
