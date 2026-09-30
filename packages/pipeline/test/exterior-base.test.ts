/**
 * Komplette Base MIT Außengestaltung (X1) und Außenprofil: Das Gelände kennt die Außen-Komponenten (`exteriorBuilding`)
 * – keine Gelände-, Pflanzen- oder Bauwerkszelle an ihren Positionen, keine Pflanzen in ihren bodennahen Spalten,
 * keine Wege durch Hindernisse in Laufhöhe; die Vortreppe liegt im Türausgang; der frühe Plan (vor der Einrichtung,
 * fürs Gelände) und der endgültige unterscheiden sich nur um Dachteile; 0 harte Verstöße.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FacadeStyle } from '@mcda/blueprint';
import { key3 } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { completeBase, exteriorFor, generateBase, shellFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const ALL: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 };

describe('Beispiel-Base mit Außengestaltung', () => {
  for (const version of ['1.21.11', '26.3'] as const) {
    it(`${version}: Gelände gekoppelt, keine Überschneidung, 0 harte Verstöße`, { timeout: HEAVY_TIMEOUT }, () => {
      const base = completeBase(version, 'medieval');
      const early = exteriorFor(base.project, shellFor(base.project, { ...base.options, facade: ALL }), ctx.catalog, { density: 2 });
      const world = generateBase(base.project, ctx, { ...base.options, facade: ALL, exterior: { density: 2 } });
      const ext = world.exterior ?? [];
      expect(ext.length).toBeGreaterThan(20);
      expect(world.warnings.filter((w) => w.startsWith('Außen'))).toEqual([]);
      expect(world.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);

      // früher Plan (Gelände) = endgültiger Plan ohne Dachteile (Schornsteine hängen an der Einrichtung)
      const roofish = new Set(['chimneys', 'ridgeDecor']);
      expect(ext.filter((p) => !roofish.has(p.group))).toEqual(early.placements.filter((p) => !roofish.has(p.group)));
      expect(ext.some((p) => p.group === 'chimneys')).toBe(true);

      // keine Zelle der Umgebung an einer Außen-Position, keine Pflanze in bodennahen Außen-Spalten
      const pos = new Set(ext.flatMap((p) => p.cells.map(key3)));
      expect(world.surroundings.cells.filter((c) => pos.has(key3(c.pos))).map((c) => `${c.kind}@${c.pos}`)).toEqual([]);
      const y0 = Math.min(...world.shell.cells.filter((c) => c.kind === 'floor').map((c) => c.pos[1]));
      const cols = new Set(ext.flatMap((p) => p.cells.filter((c) => c[1] <= y0 + 3).map((c) => `${c[0]},${c[2]}`)));
      const plants = world.surroundings.cells.filter((c) => c.kind === 'plant' && cols.has(`${c.pos[0]},${c.pos[2]}`));
      expect(plants.map((c) => `${c.role}@${c.pos}`)).toEqual([]);
      // keine Wege durch Hindernisse in Laufhöhe
      const obstacles = new Set(ext.flatMap((p) => p.cells.filter((c) => c[1] >= y0 + 1 && c[1] <= y0 + 2).map((c) => `${c[0]},${c[2]}`)));
      const site = world.surroundings.site!;
      expect(site.paths.toArray().filter(([x, z]) => obstacles.has(`${x},${z}`))).toEqual([]);
      // Vortreppe im Türausgang auf Bodenplattenhöhe, der Ausgang bleibt Ausgang
      const stoops = ext.filter((p) => p.group === 'stoop').flatMap((p) => p.cells);
      for (const [x, z] of site.doorExits) {
        expect(stoops.some((c) => c[0] === x && c[2] === z && c[1] === y0), `Vortreppe am Ausgang ${x},${z}`).toBe(true);
        expect(world.materialized.volume.stateAt([x, y0, z]).name).toMatch(/_stairs$/);
      }
    });
  }
});
