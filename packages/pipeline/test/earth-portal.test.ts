/**
 * W7-I Erdhaus-Portal (plan/spikes/W7I_gelaende.md): das Gelände setzt an der Rundtür des Erdhauses Türblatt und
 * Laternenpaar (`exterior/earth_portal`, terrain `placeEarthPortals`). In allen Themes materialisiert das Erdhaus mit
 * Portal ohne harte Verstöße (Laternen stehen auf den Ring-Treppen der Hülle, auch in der Ruine), der Laufweg vor der
 * Tür bleibt frei, und die Laternen leuchten.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { key3 } from '@mcda/core';
import { generateBase, projectFromBuildingType } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

describe('W7-I Erdhaus-Portal an der Rundtür', () => {
  it('alle Themes: Portal gesetzt, 0 harte Verstöße, Tür frei, Laternen auf den Ring-Treppen', () => {
    const def = ctx.buildingTypes.get('hobbit')!;
    for (const themeId of ctx.themes.ids()) {
      const res = projectFromBuildingType(def, { size: 'M', themeId }, 2026, ctx);
      const world = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
      const portal = world.surroundings.outdoor.filter((o) => o.componentId === 'exterior/earth_portal');
      // W9-G4 (2026-09-27): große Rundtür (Ring r = 3) – rundes Türblatt und Laternenpaar auf den unteren Bogentreppen
      expect(portal.map((p) => p.variantId), themeId).toEqual(['leaf_round', 'lanterns_wide']);
      const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
      expect(hard, `${themeId}: ${JSON.stringify(hard.slice(0, 2))}`).toEqual([]);
      const vol = world.materialized.volume;
      const door = world.shell.cells.find((c) => c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower')!;
      const f = door.orient!.facing!;
      const dx = f === 'east' ? 1 : f === 'west' ? -1 : 0;
      const dz = f === 'south' ? 1 : f === 'north' ? -1 : 0;
      const ahead = (dy: number): string => vol.stateAt([door.pos[0] + dx, door.pos[1] + dy, door.pos[2] + dz]).name;
      expect([ahead(0), ahead(1)], themeId).toEqual(['air', 'air']);
      const lamps = vol.cellsOf(portal[1]!.id).filter((c) => c.state.name.includes('lantern'));
      expect(lamps.length, themeId).toBe(2);
      // W12-B (2026-09-28): die Laternen stehen auf den äußeren Ringpfosten (volle Blöcke)
      for (const l of lamps) expect(vol.stateAt([l.pos[0], l.pos[1] - 1, l.pos[2]]).name, `${themeId}: Unterlage ${key3(l.pos)}`).not.toMatch(/(air|stairs|slab|lantern)/);
    }
  });
});

/**
 * W9-G4 (plan/spikes/W9G4_erdhaus.md, Review R5 G4): Erdhaus mit organischem Hügel, großer Rundtür, Rundfenstern und
 * Flanken – je Welt: Rundtür r = 3 spiegelsymmetrisch (Blöcke im Volumen), ≥ 1 Rundfenster, Stützmauer an den Flanken,
 * am Hügel < 2 % sichtbare Erdflächen, 0 harte Verstöße.
 */
describe('W9-G4 Erdhaus: Hügel ohne Erdkanten, Rundtür, Rundfenster, Flanken', () => {
  const DIRT = /^minecraft:(dirt|coarse_dirt|rooted_dirt|grass_block|podzol)$/;
  const OPEN = /(air|short_grass|fern|bush|flower|tulip|poppy|dandelion|daisy|orchid|allium|bluet|cornflower|lily_of|petals|carpet|lantern|azalea|slab|stairs|fence|trapdoor|door|pane|leaves|rose|peony|lilac|wildflowers|leaf_litter)/;
  for (const [size, themeId, seed, front] of [['M', 'rustic', 2026, 'south'], ['S', 'medieval', 7, 'east'], ['L', 'rustic', 3, 'north']] as const) {
    it(`${size} ${themeId} Seed ${seed} Front ${front}`, () => {
      const def = ctx.buildingTypes.get('hobbit')!;
      const res = projectFromBuildingType(def, { size, themeId, front }, seed, ctx);
      const world = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
      expect(world.materialized.violations.filter((v) => v.severity === 'error')).toEqual([]);
      const vol = world.materialized.volume;
      const name = (p: readonly number[]): string => (vol.contains(p as [number, number, number]) ? vol.stateAt(p as [number, number, number]).name : 'minecraft:air');
      const door = world.shell.cells.find((c) => c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower')!;
      const f = door.orient!.facing!;
      expect(f).toBe(front);
      const [fx, fz] = ({ south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] } as const)[f];
      const [ax, az] = fz !== 0 ? [1, 0] : [0, 1];
      const P = (u: number, dy: number): [number, number, number] => [door.pos[0] + fx + ax * u, door.pos[1] + dy, door.pos[2] + fz + az * u];
      // Rundtür r = 3: Pfosten, Bogen, Scheitel; spiegelsymmetrisch (Treppen gespiegelt)
      expect([name(P(-3, 0)), name(P(3, 0)), name(P(0, 4))].map((n) => n !== 'minecraft:air' && !/(door|lantern|trapdoor)/.test(n))).toEqual([true, true, true]);
      // W12-B (2026-09-28): über der Scheitelstufe liegt der volle Bogenrücken
      expect(name(P(0, 3))).toMatch(/slab/);
      expect(name(P(0, 4))).not.toMatch(/(slab|stairs)/);
      const flip: Record<string, string> = fz !== 0 ? { east: 'west', west: 'east' } : { north: 'south', south: 'north' };
      for (let u = 1; u <= 3; u++) for (let dy = 0; dy <= 4; dy++) {
        const a = vol.stateAt(P(u, dy));
        const b = vol.stateAt(P(-u, dy));
        const facing = a.properties['facing'];
        expect([b.name, b.properties['half'], b.properties['type'], b.properties['facing']], `u ${u} dy ${dy}`)
          .toEqual([a.name, a.properties['half'], a.properties['type'], facing === undefined ? undefined : flip[facing] ?? facing]);
      }
      const portal = world.surroundings.outdoor.filter((o) => o.componentId === 'exterior/earth_portal').map((o) => o.variantId);
      expect(portal).toEqual(['leaf_round', 'lanterns_wide']);
      // ≥ 1 Rundfenster (W12-B: Wange aus vollen Holzblöcken vor der Front)
      expect(world.shell.cells.filter((c) => c.kind === 'facade' && c.role === 'roof_trim' && c.shape === 'block').length).toBeGreaterThan(0);
      // Flanken: Stützmauer im Gelände
      const terrain = world.surroundings.cells.filter((c) => c.kind === 'terrain');
      expect(terrain.filter((c) => c.role === 'mound_wall').length).toBeGreaterThan(4);
      // Hügel (über der Grundhöhe, zusammenhängend mit dem Grundriss): < 2 % sichtbare Erdflächen
      const y0 = door.pos[1] - 1;
      const tops = new Map<string, number>();
      for (const c of terrain) tops.set(`${c.pos[0]},${c.pos[2]}`, Math.max(tops.get(`${c.pos[0]},${c.pos[2]}`) ?? -Infinity, c.pos[1]));
      const plot = world.surroundings.site!.grid.plot;
      const inner = (x: number, z: number): boolean => x > plot.minX && x < plot.maxX && z > plot.minZ && z < plot.maxZ;
      const mound = new Set<string>();
      const queue: Array<readonly [number, number]> = [];
      for (const [x, z] of world.shell.settings!.find((s) => s.kind === 'buried')!.footprint) {
        mound.add(`${x},${z}`);
        queue.push([x, z]);
      }
      const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
      while (queue.length > 0) {
        const [x, z] = queue.pop()!;
        for (const [dx, dz] of N4) {
          const k = `${x + dx},${z + dz}`;
          if (mound.has(k) || !inner(x + dx, z + dz) || (tops.get(k) ?? -Infinity) <= y0) continue;
          mound.add(k);
          queue.push([x + dx, z + dz]);
        }
      }
      let faces = 0;
      let dirt = 0;
      for (const c of terrain) {
        const [x, y, z] = c.pos;
        if (y <= y0 || !mound.has(`${x},${z}`)) continue;
        const n = name(c.pos);
        if (OPEN.test(name([x, y + 1, z]))) faces++;
        for (const [dx, dz] of N4) {
          if (!inner(x + dx, z + dz) || !OPEN.test(name([x + dx, y, z + dz]))) continue;
          faces++;
          if (DIRT.test(n)) dirt++;
        }
      }
      expect(faces).toBeGreaterThan(200);
      expect(dirt / faces, `${dirt}/${faces}`).toBeLessThan(0.02);
    });
  }
});

/**
 * W12-B (plan/spikes/W12B_erdhausfront.md, Review R6-2): Front mit Gliederung und Tiefe – Tür in der Frontmitte
 * (|Versatz| ≤ 1), lückenloser Bogen im Volumen (je Reihe keine Luft zwischen den äußeren Ringblöcken, außer dem Laufweg
 * vor der Tür), mindestens drei Ebenen mit Gebäudeblöcken (Wand, Ring und Rahmen, Laibung und Strebefüße), Fenster
 * spiegelgleich zur Tür, 0 harte Verstöße, deterministisch.
 */
describe('W12-B Erdhaus-Front: Tür mittig, Bogen lückenlos, Tiefe, Fenster paarweise', () => {
  const NATURAL = /(grass|moss|dirt|leaves|fern|flower|tulip|poppy|dandelion|daisy|orchid|allium|bluet|cornflower|lily_of|petals|azalea|bush|rose|peony|lilac|podzol|wildflowers|leaf_litter|cobblestone|andesite)/;
  for (const [size, themeId, seed, front] of [['M', 'rustic', 2026, 'south'], ['S', 'medieval', 7, 'east'], ['L', 'rustic', 3, 'north'], ['M', 'medieval', 11, 'west']] as const) {
    it(`${size} ${themeId} Seed ${seed} Front ${front}`, () => {
      const def = ctx.buildingTypes.get('hobbit')!;
      const make = () => {
        const res = projectFromBuildingType(def, { size, themeId, front }, seed, ctx);
        return generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
      };
      const world = make();
      expect(world.materialized.violations.filter((v) => v.severity === 'error')).toEqual([]);
      const vol = world.materialized.volume;
      const name = (p: readonly number[]): string => (vol.contains(p as [number, number, number]) ? vol.stateAt(p as [number, number, number]).name : 'minecraft:air');
      const setting = world.shell.settings!.find((s) => s.kind === 'buried')!;
      const door = world.shell.cells.find((c) => c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower')!;
      const [fx, fz] = ({ south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] } as const)[front];
      const [ax, az] = fz !== 0 ? [1, 0] : [0, 1];
      const u = (x: number, z: number): number => x * ax + z * az;
      const us = setting.footprint.toArray().map(([x, z]) => u(x, z));
      const du = u(door.pos[0], door.pos[2]);
      expect(Math.abs(du - (Math.min(...us) + Math.max(...us)) / 2)).toBeLessThanOrEqual(1);
      const P = (du2: number, dy: number, k: number): [number, number, number] =>
        [door.pos[0] + fx * k + ax * du2, door.pos[1] + dy, door.pos[2] + fz * k + az * du2];
      // Bogen lückenlos: je Reihe zwischen den äußersten Blöcken der Ringebene keine Luft (Laufweg vor der Tür ausgenommen)
      for (let dy = 0; dy <= 4; dy++) {
        const row = [-3, -2, -1, 0, 1, 2, 3].map((v) => name(P(v, dy, 1)) !== 'minecraft:air');
        const lo = row.indexOf(true);
        const hi = row.lastIndexOf(true);
        for (let i = lo; i <= hi; i++) if (!(i === 3 && dy <= 1)) expect(row[i], `Reihe ${dy} u ${i - 3}`).toBe(true);
      }
      // Tiefe: Gebäudeblöcke in der Wand, eine und zwei Ebenen davor (je ≥ 4)
      const planes = [0, 1, 2].map((k) => {
        let n = 0;
        for (let v = Math.min(...us); v <= Math.max(...us); v++) for (let dy = 0; dy <= 4; dy++) {
          const nm = name(P(v - du, dy, k));
          if (nm !== 'minecraft:air' && !NATURAL.test(nm)) n++;
        }
        return n;
      });
      expect(planes.every((n) => n >= 4), JSON.stringify(planes)).toBe(true);
      // Fenster spiegelgleich zur Tür
      const cols = new Set(world.shell.cells.filter((c) => c.kind === 'window').map((c) => u(c.pos[0], c.pos[2])));
      expect(cols.size).toBeGreaterThan(0);
      for (const c of cols) expect(cols.has(2 * du - c), `Fenster ${c - du}`).toBe(true);
      // deterministisch (Hülle und Gelände eines zweiten Laufs gleich)
      const again = make();
      expect(JSON.stringify(again.shell.cells)).toBe(JSON.stringify(world.shell.cells));
      expect(JSON.stringify(again.surroundings.cells)).toBe(JSON.stringify(world.surroundings.cells));
    });
  }
});
