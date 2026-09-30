/**
 * Komplette Base MIT Außenprofil (FA + M2): keine Pflanze über oder in Profilspalten, Sockel sichtbar (Gelände davor
 * eine Reihe tiefer), Türpodest auf Bodenplattenhöhe, keine harten Verstöße.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FacadeStyle } from '@mcda/blueprint';
import { CellSet, opposite, type HorizontalDir, type Vec3 } from '@mcda/core';
import { isAir } from '@mcda/voxel';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { completeBase, generateBase } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const ALL: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 };
const STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

describe('Beispiel-Base mit Außenprofil', () => {
  for (const version of ['1.21.11', '26.3'] as const) {
    it(`${version}: Sockel sichtbar, keine Pflanzen im Profil, 0 harte Verstöße`, { timeout: HEAVY_TIMEOUT }, () => {
      const base = completeBase(version, 'medieval');
      const world = generateBase(base.project, ctx, { ...base.options, facade: ALL });
      const vol = world.materialized.volume;
      const facade = world.shell.cells.filter((c) => c.kind === 'facade');
      expect(facade.length).toBeGreaterThan(0);
      expect(world.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);

      const profile = CellSet.of(facade.map((c) => [c.pos[0], c.pos[2]] as const));
      const plants = world.surroundings.cells.filter((c) => c.kind === 'plant' && profile.has(c.pos[0], c.pos[2]));
      expect(plants.map((c) => `${c.role}@${c.pos}`)).toEqual([]);

      const site = world.surroundings.site!;
      const y0 = Math.min(...world.shell.cells.filter((c) => c.kind === 'floor').map((c) => c.pos[1]));
      const plinth = facade.filter((c) => c.pos[1] === y0 && c.shape === 'stairs' && c.orient?.stairShape === undefined);
      expect(plinth.length).toBeGreaterThan(20);
      const exits = new Set(site.doorExits.map(([x, z]) => `${x},${z}`));
      for (const c of plinth) {
        // Treppe mit Rücken zur Wand: nach außen = Gegenrichtung von facing
        const out = opposite(c.orient!.facing!) as HorizontalDir;
        const q: Vec3 = [c.pos[0] + STEP[out][0], y0, c.pos[2] + STEP[out][1]];
        if (exits.has(`${q[0]},${q[2]}`) || !vol.contains(q)) continue;
        const i = site.grid.at(q[0], q[2]);
        if (i < 0) continue;
        expect(site.top[i], `Gelände vor dem Sockel ${c.pos}`).toBeLessThanOrEqual(y0 - 1);
        expect(isAir(vol.stateAt([c.pos[0], y0 - 1, c.pos[2]])), `Sockel ${c.pos} ohne Unterbau`).toBe(false);
      }
      // Die Haustür bleibt erreichbar: Podest vor jeder Außentür auf y0
      for (const [x, z] of site.doorExits) expect(site.top[site.grid.idx(x, z)], `Podest ${x},${z}`).toBe(y0);
    });
  }
});
