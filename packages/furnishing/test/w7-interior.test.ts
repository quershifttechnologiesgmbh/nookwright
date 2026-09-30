/**
 * W7-F „Innenraum-Feinschliff“ (plan/spikes/W7F_innen.md):
 *  - Insel (`island`): der Küchentisch steht in der Raummitte, der Hauptweg führt außen herum (Vorbilder 10/17);
 *  - Kamin in der Taverne (Vorbilder: Schankraum mit Kamin), mechanisch sicher (Lagerfeuer nie auf dem Laufweg, siehe
 *    auch `roomtypes-k3a.test.ts`), End-to-End mit Licht-Pass;
 *  - Licht am Himmelbett (Hänge-Andockpunkte neben dem Kopfende bzw. vor dem Fußende, nie unter dem Baldachin);
 *  - Alchemie: Braukessel bzw. Bord an der Brau-Theke.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { validateRoomTypeDef, type RoomTypeDef } from '@mcda/catalog';
import { CellSet, cellKey, key3 } from '@mcda/core';
import { generate, placedFor } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { analyzeRoom, footprintGap, furnishRoom, planIsland, planPath, type FurnishResult, type PlacedComponent, type RoomGeometry } from '../src/index.js';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { DV, assertHardGuarantees, catalog, shellRoom } from './fixtures.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const defOf = (p: PlacedComponent) => catalog.get(p.expanded.defId);
const tagged = (r: FurnishResult, ...tags: string[]): PlacedComponent[] => r.placed.filter((p) => defOf(p).tags.some((t) => tags.includes(t)));
const floorCells = (p: PlacedComponent, baseY: number): [number, number][] => p.cells.filter((c) => c.pos[1] === baseY).map((c) => [c.pos[0], c.pos[2]]);

/** Mittleres Drittel des Raums (beide Richtungen) – wie die Kennzahl „Tisch mittig“ im Bericht. */
function inMiddleThird(p: PlacedComponent, g: RoomGeometry): boolean {
  const b = g.interior.bounds()!;
  const cells = floorCells(p, g.baseY);
  const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
  const cz = cells.reduce((s, c) => s + c[1], 0) / cells.length;
  const fx = (cx - b.minX + 0.5) / (b.maxX - b.minX + 1);
  const fz = (cz - b.minZ + 0.5) / (b.maxZ - b.minZ + 1);
  return fx >= 1 / 3 - 1e-9 && fx <= 2 / 3 + 1e-9 && fz >= 1 / 3 - 1e-9 && fz <= 2 / 3 + 1e-9;
}

describe('W7 Insel (`island`): Küchentisch in der Raummitte, Hauptweg außen herum', () => {
  it('planIsland: mittig, mit Rand 2 zu jeder Wand; schmale Räume und Kammern ohne Insel', () => {
    const a = analyzeRoom(shellRoom(9, 8)); // Innenraum 7 × 6
    const isl = planIsland(a, [{ sx: 3, sz: 1 }])!;
    expect(isl.toArray().map(([x, z]) => `${x},${z}`).sort()).toEqual(['2,2', '3,2', '4,2']);
    // zu lang für den Rand (7 − 2·2 = 3): die nächste Form
    expect(planIsland(a, [{ sx: 4, sz: 1 }, { sx: 2, sz: 1 }])!.size).toBe(2);
    expect(planIsland(analyzeRoom(shellRoom(6, 6)), [{ sx: 1, sz: 1 }])).toBeUndefined(); // 4 × 4: kein Platz für Rand
    expect(planIsland(analyzeRoom(shellRoom(5, 9)), [{ sx: 1, sz: 1 }])).toBeUndefined(); // 3 breit: kein Weg
  });

  it('der Hauptweg meidet die Insel und endet an ihrem Rand (eine Tür)', () => {
    const a = analyzeRoom(shellRoom(10, 9));
    const island = { cells: planIsland(a, [{ sx: 3, sz: 1 }])!, tags: ['kitchen_table'], entry: 0 };
    const path = planPath({ ...a, island })!;
    expect(path.toArray().filter(([x, z]) => island.cells.has(x, z))).toEqual([]);
    const rim = path.toArray().some(([x, z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => island.cells.has(x + dx!, z + dz!)));
    expect(rim, 'Weg erreicht die Insel').toBe(true);
    // ohne Insel unverändert durch die Raummitte
    expect(planPath(a)!.toArray().some(([x, z]) => island.cells.has(x, z))).toBe(true);
  });

  it('Küche: Tisch auf der Insel (mittleres Drittel) in fast allen Räumen, Weg frei, Arbeitszeile, 0 Warnungen', { timeout: HEAVY_TIMEOUT }, () => {
    const rt = catalog.roomType('kitchen');
    let n = 0, mid = 0, onIsland = 0;
    for (const [w, d] of [[9, 8], [10, 8], [10, 9], [11, 9]] as const) {
      for (const H of [3, 4]) {
        for (let seed = 0; seed < 5; seed++) {
          const g = shellRoom(w, d, { height: H, inner: seed % 2 === 0 ? ['north'] : [], windowSpacing: 4 });
          const r = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
          const where = `${w}×${d} H${H} seed ${seed}`;
          assertHardGuarantees(g, r, where);
          expect(r.warnings, where).toEqual([]);
          n++;
          const table = tagged(r, 'kitchen_table', 'table_small', 'breakfast_nook_booth')[0];
          if (table !== undefined && inMiddleThird(table, g)) mid++;
          const isl = r.analysis.island;
          if (isl === undefined) continue;
          // harte Regel: auf der Insel steht auf Bodenhöhe nur das Insel-Möbel; der Weg meidet sie
          for (const p of r.placed) {
            if (p.expanded.walkable) continue;
            const on = floorCells(p, g.baseY).some(([x, z]) => isl.cells.has(x, z));
            if (on) expect(defOf(p).tags.some((t) => isl.tags.includes(t)), `${where}: ${p.expanded.defId} auf der Insel`).toBe(true);
          }
          expect(r.analysis.path?.toArray().filter(([x, z]) => isl.cells.has(x, z)) ?? [], where).toEqual([]);
          if (table !== undefined && floorCells(table, g.baseY).some(([x, z]) => isl.cells.has(x, z))) onIsland++;
          // Arbeitszeile: mindestens zwei Arbeitsplatten am Herd bzw. aneinander
          const hearth = tagged(r, 'hearth')[0]!;
          const counters = tagged(r, 'counter');
          expect(counters.filter((c) => footprintGap(c, hearth) <= 0 || counters.some((o) => o !== c && footprintGap(c, o) <= 0)).length, where).toBeGreaterThanOrEqual(2);
        }
      }
    }
    expect(onIsland / n, `Tisch auf der Insel ${onIsland}/${n}`).toBeGreaterThanOrEqual(0.8);
    expect(mid / n, `Tisch im mittleren Drittel ${mid}/${n}`).toBeGreaterThanOrEqual(0.8);
  });

  it('Raumtypen ohne `island` planen keine Insel; Validator: eine Insel je Raumtyp mit höchstens einem Stück', () => {
    const r = furnishRoom(shellRoom(10, 9, { height: 4 }), catalog.roomType('bedroom'), catalog, { seed: 1, dataVersion: DV });
    expect(r.analysis.island).toBeUndefined();
    const base: RoomTypeDef = { id: 'x', name: 'x', minArea: 1, coverage: { target: 0 }, required: [{ tags: ['hearth'], count: [1, 1] }], optional: [] };
    expect(validateRoomTypeDef({ ...base, optional: [{ tags: ['table_small'], count: [1, 1], island: true }] }).ok).toBe(true);
    expect(validateRoomTypeDef({ ...base, optional: [{ tags: ['table_small'], count: [1, 2], island: true }] }).ok).toBe(false);
    expect(validateRoomTypeDef({ ...base, optional: [{ tags: ['table_small'], count: [1, 1], island: true }, { tags: ['rug'], count: [0, 1], island: true }] }).ok).toBe(false);
  });
});

describe('W7 Taverne: Kamin in der Gaststube', () => {
  it('ab ≈ 30 Zellen fast immer ein Kamin an der Wand, Lagerfeuer abgedeckt oder eingefasst, 0 Warnungen', { timeout: HEAVY_TIMEOUT }, () => {
    const rt = catalog.roomType('tavern');
    let n = 0, fire = 0;
    for (const [w, d] of [[10, 8], [12, 9], [14, 10]] as const) {
      for (const H of [3, 4, 5]) {
        for (let seed = 0; seed < 4; seed++) {
          const g = shellRoom(w, d, { height: H, inner: seed % 2 === 0 ? ['north'] : [], windowSpacing: 4 });
          const r = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
          const where = `${w}×${d} H${H} seed ${seed}`;
          assertHardGuarantees(g, r, where);
          expect(r.warnings, where).toEqual([]);
          n++;
          const fp = tagged(r, 'fireplace');
          if (fp.length > 0) fire++;
          const blocks = new Set(r.placed.flatMap((p) => p.cells.map((c) => key3(c.pos))));
          for (const p of fp) {
            for (const c of p.cells.filter((x) => x.mat.block === 'minecraft:campfire')) {
              const covered = blocks.has(key3([c.pos[0], c.pos[1] + 1, c.pos[2]]));
              const enclosed = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => !g.interior.has(c.pos[0] + dx!, c.pos[2] + dz!) || blocks.has(key3([c.pos[0] + dx!, c.pos[1], c.pos[2] + dz!])));
              expect(covered || enclosed, `${where}: Lagerfeuer offen bei ${c.pos.join(',')}`).toBe(true);
            }
          }
        }
      }
    }
    expect(fire / n, `Kamin ${fire}/${n}`).toBeGreaterThanOrEqual(0.85);
  });

  it('End-to-End (Einrichtung → Licht-Pass → Welt): Kamin, 0 Physik-Verstöße, 0 Spawn-Zellen, beide Versionen', { timeout: HEAVY_TIMEOUT }, () => {
    for (const version of ['1.21.11', '26.3'] as const) {
      for (const [seed, H] of [[1, 4], [2, 5], [3, 3]] as const) {
        const p = Project.create({ id: 'w7t', name: 'W7 Taverne', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: H } });
        p.paintRoom(0, CellSet.rect(0, 0, 11, 8), 'tavern');
        const world = generate(p, ctx);
        const where = `${version} seed ${seed} H${H}`;
        expect(world.warnings, where).toEqual([]);
        expect(world.materialized.violations, where).toEqual([]);
        expect(world.materialized.light.darkCells, where).toEqual([]);
        const ids = p.state.placements.map((x) => placedFor(x, ctx.catalog).expanded.defId);
        expect(ids.some((id) => ctx.catalog.get(id).tags.includes('fireplace')), `${where}: kein Kamin`).toBe(true);
      }
    }
  });
});

describe('W7 Himmelbett: Licht am Bett', () => {
  it('Laterne neben dem Kopfende oder vor dem Fußende in fast allen Schlafzimmern, nie unter dem Baldachin', { timeout: HEAVY_TIMEOUT }, () => {
    const rt = catalog.roomType('bedroom');
    let n = 0, lit = 0;
    for (const [w, d] of [[6, 6], [7, 6], [8, 7], [9, 8]] as const) {
      for (const H of [3, 4, 5]) {
        for (let seed = 0; seed < 6; seed++) {
          const g = shellRoom(w, d, { height: H, inner: seed % 2 === 0 ? ['north'] : [], windowSpacing: 4 });
          const r = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
          const where = `${w}×${d} H${H} seed ${seed}`;
          assertHardGuarantees(g, r, where);
          const bed = tagged(r, 'canopy_bed')[0]!;
          n++;
          const bedCols = new Set(floorCells(bed, g.baseY).map(([x, z]) => cellKey(x, z)));
          const lights = r.placed.filter((p) => ['light', 'decor'].includes(defOf(p).category) && p.cells.some((c) => c.mat.shape === 'lantern' || c.mat.shape === 'candle' || /lantern|candle/.test(c.mat.block ?? '')));
          const near = lights.some((l) => footprintGap(l, bed) <= 1);
          if (near) lit++;
          // Hängelaternen des Betts: nie über dem Bett unter dem Baldachin (obere Stufe trägt keine Laterne)
          r.placements.forEach((pl, i) => {
            if (pl.parentKey === undefined || !pl.socketId?.startsWith('lamp')) return;
            const parent = r.placements.find((q) => q.key === pl.parentKey)!;
            if (!catalog.get(parent.componentId).tags.includes('canopy_bed')) return;
            const lamp = r.placed[i]!;
            if (bed.expanded.defId !== 'bed/canopy_head') for (const c of lamp.cells) expect(bedCols.has(cellKey(c.pos[0], c.pos[2])), `${where}: Laterne unter dem Baldachin`).toBe(false);
            expect(Math.max(...lamp.cells.map((c) => c.pos[1])), `${where}: Laterne hängt unter der Decke`).toBe(g.baseY + g.height - 1);
          });
        }
      }
    }
    expect(lit / n, `Licht am Bett ${lit}/${n}`).toBeGreaterThanOrEqual(0.85);
  });
});

describe('W7 Alchemie: Kessel bzw. Bord an der Brau-Theke', () => {
  it('kleine und mittlere Räume: Kessel ≤ 1 Zelle oder Bord an der Theke in fast allen', { timeout: HEAVY_TIMEOUT }, () => {
    const rt = catalog.roomType('alchemy');
    let n = 0, ok = 0;
    for (const [w, d] of [[7, 6], [8, 6], [9, 7], [11, 6]] as const) {
      for (let seed = 0; seed < 6; seed++) {
        const g = shellRoom(w, d, { height: 3, inner: seed % 2 === 0 ? ['north', 'east'] : [], windowSpacing: 4 });
        const r = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
        assertHardGuarantees(g, r, `${w}×${d} seed ${seed}`);
        const bench = tagged(r, 'brewing_counter')[0]!;
        n++;
        if (tagged(r, 'brew_kettle', 'potion_shelf').some((k) => footprintGap(k, bench) <= 1)) ok++;
      }
    }
    expect(ok / n, `Kessel/Bord an der Theke ${ok}/${n}`).toBeGreaterThanOrEqual(0.8);
  });
});
