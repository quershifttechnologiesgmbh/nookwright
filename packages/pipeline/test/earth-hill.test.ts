/**
 * W13-C (plan/spikes/W13C_erdhaus_huegel.md): Erdhaus mit schmaler, hoher Front und weichem Hügel. Harte Regeln je Welt:
 *  - Front schmal: quer zur Front schmaler als tief, höchstens 17 breit; die Diele läuft als mittiges Band bis zur Front.
 *  - Stirnbogen: über der Decke steigt die Front zur Mitte an (Scheitel ≥ 2 Reihen über den Ecken), spiegelgleich.
 *  - Hügel glatt: benachbarte Hügelspalten unterscheiden sich um höchstens 1 Block – außer am Anschnitt direkt neben der
 *    Front (Laibung: Frontebene zur ersten Reihe davor, höchstens 1 quer neben dem Grundriss).
 *  - keine Löcher: über der obersten Hüllzelle jeder Grundriss-Spalte liegen `cover` Geländezellen.
 *  - nichts schwebt: jede Gelände- und Pflanzenzelle über der Grundhöhe steht auf einem Block (außer Baumkronen).
 *  - abgeflachter Kamm: mindestens 8 Spalten auf Scheitelhöhe.
 *  - Räume beleuchtet (0 dunkle Zellen), 0 harte Verstöße.
 *  - W16-C: Bogenfront (Band spiegelgleich, zur Mitte steigend, Wand bis unter das Band), Schornstein und Eiche.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cellKey, key3 } from '@mcda/core';
import { generateBase, projectFromBuildingType } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const STEP = { south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0] } as const;

describe('W13-C Erdhaus: schmale, hohe Front, weicher Hügel', () => {
  for (const [size, themeId, seed, front] of [['M', 'rustic', 2026, 'south'], ['S', 'medieval', 7, 'east'], ['L', 'rustic', 3, 'north'], ['M', 'medieval', 11, 'west']] as const) {
    it(`${size} ${themeId} Seed ${seed} Front ${front}`, () => {
      const def = ctx.buildingTypes.get('hobbit')!;
      const res = projectFromBuildingType(def, { size, themeId, front }, seed, ctx);
      const world = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
      expect(world.materialized.violations.filter((v) => v.severity === 'error')).toEqual([]);
      expect(world.materialized.light?.darkCells?.length ?? 0).toBe(0);
      const s = world.shell.settings!.find((x) => x.kind === 'buried')!;
      expect(s.front).toBe(front);
      const [fx, fz] = STEP[front];
      const [ax, az] = fz !== 0 ? [1, 0] : [0, 1];
      const fwd = (x: number, z: number): number => x * fx + z * fz;
      const along = (x: number, z: number): number => x * ax + z * az;
      const fp = s.footprint.toArray();
      const inFp = new Set(fp.map(([x, z]) => cellKey(x, z)));
      const plane = Math.max(...fp.map(([x, z]) => fwd(x, z)));
      const u0 = Math.min(...fp.map(([x, z]) => along(x, z)));
      const u1 = Math.max(...fp.map(([x, z]) => along(x, z)));
      const depth = plane - Math.min(...fp.map(([x, z]) => fwd(x, z))) + 1;
      const width = u1 - u0 + 1;
      // schmale Front
      expect(width).toBeLessThan(depth);
      expect(width).toBeLessThanOrEqual(17);
      const hallCells = res.plan.rooms.find((r) => r.roomTypeId === 'entrance_hall')!.cells.toArray();
      expect(Math.max(...hallCells.map(([x, z]) => fwd(x, z)))).toBe(plane);
      const hu = hallCells.map(([x, z]) => along(x, z));
      expect(Math.min(...hu) - u0).toBe(u1 - Math.max(...hu));
      // Stirnbogen: oberste Hüllzelle der Frontreihe, Mitte ≥ Ecken + 2, spiegelgleich
      const hullTop = new Map<string, number>();
      const occupied = new Set<string>();
      let y0 = Infinity;
      for (const c of world.shell.cells) {
        occupied.add(key3(c.pos));
        if (c.kind === 'floor') y0 = Math.min(y0, c.pos[1]);
        const k = cellKey(c.pos[0], c.pos[2]);
        if (inFp.has(k) && c.kind !== 'terrain' && c.kind !== 'plant') hullTop.set(k, Math.max(hullTop.get(k) ?? -Infinity, c.pos[1]));
      }
      const frontTop = new Map<number, number>();
      for (const [x, z] of fp) if (fwd(x, z) === plane) frontTop.set(along(x, z), hullTop.get(cellKey(x, z))!);
      const mid = (u0 + u1) / 2;
      expect(frontTop.get(Math.floor(mid))! - frontTop.get(u0)!).toBeGreaterThanOrEqual(2);
      for (const [u, t] of frontTop) expect(frontTop.get(u0 + u1 - u), `Spiegel u ${u}`).toBe(t);
      // Gelände: Oberkante je Spalte
      const terrain = world.surroundings.cells.filter((c) => c.kind === 'terrain');
      const top = new Map<string, number>();
      for (const c of terrain) top.set(cellKey(c.pos[0], c.pos[2]), Math.max(top.get(cellKey(c.pos[0], c.pos[2])) ?? -Infinity, c.pos[1]));
      const cells3 = new Set(terrain.map((c) => key3(c.pos)));
      // keine Löcher über den Räumen
      for (const [x, z] of fp) {
        const t = hullTop.get(cellKey(x, z))!;
        for (let d = 1; d <= s.cover!; d++) expect(cells3.has(key3([x, t + d, z])), `Loch ${x},${t + d},${z}`).toBe(true);
      }
      // Hügel: Grundriss und zusammenhängende Spalten über der Grundhöhe
      const hill = new Map<string, number>();
      const queue: Array<readonly [number, number]> = [];
      for (const [x, z] of fp) {
        hill.set(cellKey(x, z), top.get(cellKey(x, z))!);
        queue.push([x, z]);
      }
      while (queue.length > 0) {
        const [x, z] = queue.pop()!;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const k = cellKey(x + dx, z + dz);
          const t = top.get(k);
          if (hill.has(k) || t === undefined || t <= y0 + 1) continue;
          hill.set(k, t);
          queue.push([x + dx, z + dz]);
        }
      }
      const steps: string[] = [];
      for (const [k, t] of hill) {
        const [x, z] = k.split(',').map(Number) as [number, number];
        for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
          const n = hill.get(cellKey(x + dx, z + dz));
          if (n === undefined || Math.abs(n - t) <= 1) continue;
          const u = along(x, z);
          const jamb = (fwd(x, z) > plane) !== (fwd(x + dx, z + dz) > plane) && u >= u0 - 1 && u <= u1 + 1;
          if (!jamb) steps.push(`${k}→${x + dx},${z + dz}: ${Math.abs(n - t)}`);
        }
      }
      expect(steps).toEqual([]);
      // abgeflachter Kamm
      const peak = Math.max(...hill.values());
      expect([...hill.values()].filter((t) => t === peak).length).toBeGreaterThanOrEqual(8);
      // nichts schwebt
      const floating: string[] = [];
      for (const c of world.surroundings.cells) {
        // Baumkronen hängen am Stamm (Laub der Bäume), alles andere steht
        if ((c.kind !== 'terrain' && c.kind !== 'plant') || c.pos[1] <= y0 || (c.role.startsWith('leaves_') && c.role !== 'leaves_bush')) continue;
        const below = key3([c.pos[0], c.pos[1] - 1, c.pos[2]]);
        if (!cells3.has(below) && !occupied.has(below)) floating.push(key3(c.pos));
      }
      expect(floating).toEqual([]);
      // W16-C (2026-09-28, plan/spikes/W16C_erdhaus.md): Bogenfront – oberste Zelle des Bogenbands (Ebene vor der Front)
      // fällt von der Mitte nach außen nie an, liegt im Scheitel ≥ 3 über den Ecken, spiegelgleich; die Wand dahinter reicht
      // bis unter das Band (keine Erdlücke im Bogen)
      const band = new Map<number, number>();
      for (const c of world.shell.cells) {
        const u = along(c.pos[0], c.pos[2]);
        // Band: Holz der Traufe, dazu die Stirnholz-Scheiben (Stamm quer zur Front)
        if ((c.role !== 'roof_trim' && !(c.role === 'beam' && c.orient?.axis !== 'y')) || fwd(c.pos[0], c.pos[2]) !== plane + 1 || u < u0 || u > u1) continue;
        band.set(u, Math.max(band.get(u) ?? -Infinity, c.pos[1]));
      }
      expect(band.size).toBe(width);
      for (const [u, t] of band) {
        expect(band.get(u0 + u1 - u), `Band-Spiegel u ${u}`).toBe(t);
        const inner = u < mid ? u + 1 : u - 1;
        if (Math.abs(u - mid) >= 1) expect(band.get(inner)!, `Band steigt zur Mitte u ${u}`).toBeGreaterThanOrEqual(t);
        expect(frontTop.get(u)!, `Wand unter dem Band u ${u}`).toBeGreaterThanOrEqual(t - 1);
      }
      expect(band.get(Math.floor(mid))! - band.get(u0)!).toBeGreaterThanOrEqual(3);
      // Schornstein über dem Grundriss und Eiche auf der Flanke neben dem Grundriss
      const chimney = world.surroundings.outdoor.filter((o) => o.componentId === 'exterior/chimney');
      expect(chimney.length).toBe(1);
      expect(inFp.has(cellKey(chimney[0]!.cell[0], chimney[0]!.cell[1]))).toBe(true);
      const trunks = world.surroundings.cells.filter((c) => c.role === 'log_oak' && hill.has(cellKey(c.pos[0], c.pos[2])) && !inFp.has(cellKey(c.pos[0], c.pos[2])));
      expect(trunks.length).toBeGreaterThan(0);
    });
  }
});
