/**
 * W3-CA „Burg und Türme“ über den Anwendungsdienst (`projectFromBuildingType` + `generateBase`, Weg der Galerie):
 *  - Burg: Fenstermodul „Stein“ aus dem Bautyp, keine Fassadenzelle über einem Dach (K6), Turmsatz (Ecktürme mit Dach,
 *    übrige mit Zinnen), Torbau mit Laterne, jedes Turmgeschoss hell, Bergfried mit Steinbelag;
 *  - Wachturm: kein Gesims je Etage, Ausguck mit Zeltdach auf dem Flachdach.
 * Die harten Regeln (Physik, Erreichbarkeit, Spawn im Haus) prüfen die Fuzz-Tests `bt-fuzz-castle`/`-watchtower`.
 */
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { BUILDING_WINDOW_MODULES } from '@mcda/catalog';
import { WINDOW_MODULES } from '@mcda/exterior';
import type { Vec3 } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, projectFromBuildingType, type BaseWorld } from '../src/index.js';
import { ctx, loadType } from './buildingtype-fuzz.js';
import { corniceCells } from './frames.js';

const V = TARGET_VERSIONS['1.21.11'];
const world = (type: string, size: 'S' | 'M' | 'L', seed: number, themeId: string) => {
  const res = projectFromBuildingType(loadType(type), { size, themeId, targetVersion: V }, seed, ctx);
  return { res, world: generateBase(res.project, ctx, { ...res.build, ...res.surroundings }) };
};

/** K6: Hüllzellen des Hauses (ohne Bauwerke, Gelände, Pflanzen) über dem höchsten Dachblock ihrer Spalte. */
function overRoof(w: BaseWorld): string[] {
  const house = w.shell.cells.filter((c) => c.kind !== 'fort' && c.kind !== 'terrain' && c.kind !== 'plant');
  const top = new Map<string, number>();
  for (const c of house) if (c.kind === 'roof') top.set(`${c.pos[0]},${c.pos[2]}`, Math.max(top.get(`${c.pos[0]},${c.pos[2]}`) ?? -Infinity, c.pos[1]));
  return house.filter((c) => c.kind !== 'roof' && (top.get(`${c.pos[0]},${c.pos[2]}`) ?? Infinity) < c.pos[1]).map((c) => `${c.kind}/${c.role}@${c.pos.join(',')}`);
}

/** Begehbare, überdachte Zellen im Inneren der Mauertürme ohne Blocklicht. */
function darkTowerCells(w: BaseWorld): Vec3[] {
  const vol = w.materialized.volume;
  const empty = (p: Vec3): boolean => !vol.contains(p) || vol.isEmpty(p);
  const out: Vec3[] = [];
  for (const t of w.surroundings.structures?.towers ?? []) {
    const r = (t.size - 1) / 2;
    for (let dx = -r + 1; dx <= r - 1; dx++) for (let dz = -r + 1; dz <= r - 1; dz++) {
      const [x, z] = [t.center[0] + dx, t.center[1] + dz];
      for (let y = t.baseY + 1; y <= t.topY + 4; y++) {
        const p: Vec3 = [x, y, z];
        if (!empty(p) || !empty([x, y + 1, z]) || empty([x, y - 1, z])) continue;
        let covered = false;
        for (let k = y + 2; k <= t.topY + 20 && !covered; k++) covered = !empty([x, k, z]);
        if (covered && w.materialized.light.levelAt(p) === 0) out.push(p);
      }
    }
  }
  return out;
}

describe('W3-CA: Burg über den Anwendungsdienst', () => {
  it('Fenstermodul-Liste des Katalogs = Module der Außengestaltung', () => {
    expect([...BUILDING_WINDOW_MODULES]).toEqual([...WINDOW_MODULES]);
  });

  for (const [size, seed, theme] of [['M', 2026, 'medieval'], ['M', 3257322930, 'medieval'], ['S', 3850358107, 'nordic']] as const) {
    it(`${size} Seed ${seed} ${theme}: Stein-Fenster, K6, Turmsatz, Torbau, helle Türme, Steinbelag`, { timeout: HEAVY_TIMEOUT }, () => {
      const { res, world: w } = world('castle_compact', size, seed, theme);
      expect(res.build.exterior?.windowModule).toBe('stone');
      const modules = new Set((w.exterior ?? []).filter((p) => p.anchor === 'window').map((p) => p.componentId));
      // W5 (27.09.2026, Review W4-R N4): Stein-Modul nur an Steinwänden (`themeMaterial`), die Holzburg nimmt das Modul ihres Themes
      // W6 (27.09.2026): Holzwände nehmen das Holzmodul der Familie „wehrhaft“ (`fort`), nicht mehr das nordische
      const want = theme === 'medieval' ? 'stone' : 'fort';
      expect([...modules].filter((m) => m.startsWith('exterior/window_module_'))).toEqual([`exterior/window_module_${want}`]);
      expect(overRoof(w)).toEqual([]);
      const fort = w.surroundings.structures!;
      const ring = fort.towers.filter((t) => t.wall === 'fort:ring');
      const corner = res.plan.ring!.towerStyle.corner;
      expect(ring.filter((t) => t.top === 'roof')).toHaveLength(corner?.top === 'roof' ? 4 : 0);
      expect(ring.filter((t) => t.top === 'battlements').length).toBeGreaterThanOrEqual(2);
      expect(w.warnings.filter((x) => /Torbau/.test(x))).toEqual([]);
      expect(w.surroundings.cells.some((c) => c.roomId === 'fort:ring' && c.shape === 'lantern')).toBe(true);
      expect(darkTowerCells(w)).toEqual([]);
      const deck = w.surroundings.cells.filter((c) => c.roomId === 'fort:keep-parapet' && c.role === 'walkway');
      expect(deck.length).toBeGreaterThan(40);
    });
  }
});

describe('W3-CA: Wachturm über den Anwendungsdienst', () => {
  for (const theme of ['medieval', 'rustic']) {
    it(`M ${theme}: kein Gesims je Etage, Ausguck mit Zeltdach, Pfosten und Laternen`, { timeout: HEAVY_TIMEOUT }, () => {
      const { res, world: w } = world('watchtower', 'M', 2026, theme);
      expect(res.plan.parapet).toEqual({ crown: 'lookout', deck: true });
      // W4 (27.09.2026): Gesims je Etage = Profilzelle; der Flachdach-Rand des Turmschafts ist seit W4-B Stein (`wall_cornice`)
      // W5 (27.09.2026): die Fensterrahmen liegen jetzt auch in `wall_cornice` (`frameRole`, Review W4-R N2) – ausgenommen
      expect(corniceCells(w.shell)).toEqual([]);
      const crown = w.surroundings.cells.filter((c) => c.roomId === 'fort:main-parapet');
      expect(crown.filter((c) => c.shape === 'log').length).toBeGreaterThanOrEqual(8 * 3);
      expect(crown.some((c) => c.role === 'roof_main')).toBe(true);
      expect(crown.filter((c) => c.shape === 'lantern')).toHaveLength(4);
      expect(overRoof(w)).toEqual([]);
      expect(w.materialized.violations.filter((v) => v.severity === 'error')).toEqual([]);
    });
  }
});
