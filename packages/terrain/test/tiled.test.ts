/**
 * feat/tiled-wfc: Pflaster, Beete und Feldbänder aus dem Tiled-WFC (`SiteGenerateOptions.tiled`). Ohne Schalter bitgleich;
 * mit Schalter deterministisch, spiegelsymmetrisch, ohne Windrad-Motive und ohne Verstöße.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, findPinwheels } from '@mcda/core';
import {
  PlotGrid, Site, fieldCrops, gardenPlan, generateSite, pavingPattern, plotAround, type SiteResult, type TiledEntry,
} from '../src/index.js';
import { TEST_STYLE, fullSite, plot, syntheticBuilding } from './fixtures.js';
import { loadStyles } from './helpers.js';

const THEMES = ['medieval', 'rustic', 'timber', 'farmstead', 'nordic', 'dwarven', 'elven', 'desert', 'tropical', 'ruin', 'winter', 'harbor'];
const grid = new PlotGrid({ minX: 0, minZ: 0, maxX: 39, maxZ: 39 });
const rect = (x0: number, z0: number, x1: number, z1: number, hole?: (x: number, z: number) => boolean): number[] => {
  const out: number[] = [];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (hole === undefined || !hole(x, z)) out.push(grid.idx(x, z));
  return out;
};
const code = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

function noPinwheel(m: ReadonlyMap<number, string>): void {
  const box = { minX: 0, minZ: 0, maxX: 39, maxZ: 39 };
  expect(findPinwheels((x, z) => {
    const v = m.get(grid.idx(x, z));
    return v === undefined ? undefined : code(v);
  }, box)).toEqual([]);
}

describe('Tiled-WFC im Gelände (feat/tiled-wfc)', () => {
  it('Pflaster: gespiegelt, Bänder laufen durch, kein Windrad, 0 Verstöße, Vielfalt über Seeds', () => {
    const seen = new Set<string>();
    for (const themeId of THEMES) {
      for (const [cells, what] of [[rect(2, 2, 13, 9), 'Rechteck'], [rect(2, 2, 12, 12, (x, z) => x >= 6 && x <= 8 && z >= 6 && z <= 8), 'mit Brunnen']] as const) {
        for (let seed = 1; seed <= 4; seed++) {
          const log: TiledEntry[] = [];
          const m = pavingPattern(grid, cells, 'z', seed, themeId, (e) => log.push(e));
          expect(m, `${themeId} ${what}`).toBeDefined();
          expect(log[0]!.violations).toBe(0);
          const xs = cells.map((i) => grid.x(i));
          const zs = cells.map((i) => grid.z(i));
          const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
          for (const i of cells) {
            const mx = grid.idx(x0 + x1 - grid.x(i), grid.z(i));
            const mz = grid.idx(grid.x(i), z0 + z1 - grid.z(i));
            if (m!.has(mx)) expect(m!.get(mx)).toBe(m!.get(i));
            if (m!.has(mz)) expect(m!.get(mz)).toBe(m!.get(i));
          }
          noPinwheel(m!);
          expect(pavingPattern(grid, cells, 'z', seed, themeId, () => undefined)).toEqual(m);
          seen.add(cells.map((i) => m!.get(i)).join(''));
        }
      }
    }
    expect(seen.size).toBeGreaterThan(12);
  });

  it('Beete: Wege hängen zusammen, Enden Beet, Nachbarbeete über den Weg verschieden, gespiegelt, kein Windrad', () => {
    const seen = new Set<string>();
    for (const themeId of THEMES) {
      for (const cells of [rect(0, 0, 10, 6), rect(0, 0, 15, 8), rect(0, 0, 6, 12), rect(0, 0, 21, 5)]) {
        for (let seed = 1; seed <= 3; seed++) {
          const log: TiledEntry[] = [];
          const plan = gardenPlan(grid, cells, 'g', seed, themeId, (e) => log.push(e));
          expect(plan, `${themeId} ${cells.length}`).toBeDefined();
          expect(log[0]!.violations).toBe(0);
          const set = new Set(cells);
          // Wege zusammenhängend
          const paths = [...plan!.paths];
          expect(paths.length).toBeGreaterThan(0);
          const seenPath = new Set([paths[0]!]);
          const queue = [paths[0]!];
          while (queue.length > 0) for (const j of grid.n4(queue.pop()!)) if (plan!.paths.has(j) && !seenPath.has(j)) (seenPath.add(j), queue.push(j));
          expect(seenPath.size).toBe(paths.length);
          // jede Zelle Weg oder Beet, nie beides
          for (const i of cells) expect(plan!.paths.has(i) !== plan!.plant.has(i)).toBe(true);
          // gespiegelt an beiden Achsen
          const xs = cells.map((i) => grid.x(i));
          const zs = cells.map((i) => grid.z(i));
          const label = new Map(cells.map((i) => [i, plan!.plant.get(i) ?? 'path'] as const));
          for (const i of cells) {
            const mx = grid.idx(Math.min(...xs) + Math.max(...xs) - grid.x(i), grid.z(i));
            const mz = grid.idx(grid.x(i), Math.min(...zs) + Math.max(...zs) - grid.z(i));
            expect(label.get(mx)).toBe(label.get(i));
            expect(label.get(mz)).toBe(label.get(i));
          }
          noPinwheel(label);
          void set;
          seen.add([...label.values()].join(','));
        }
      }
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it('Feldbänder: Nachbarn verschieden (außer am Spiegelpaar in der Mitte), Folge gespiegelt', () => {
    for (let n = 1; n <= 9; n++) {
      for (let seed = 1; seed <= 5; seed++) {
        const crops = fieldCrops(n, 'f', seed, () => undefined)!;
        expect(crops).toHaveLength(n);
        expect([...crops].reverse()).toEqual(crops);
        for (let i = 0; i + 1 < n; i++) if (!(n % 2 === 0 && i === n / 2 - 1)) expect(crops[i]).not.toBe(crops[i + 1]);
      }
    }
  });

  it('generateSite: ohne Schalter bitgleich, mit Schalter deterministisch und mit Bericht je Zone', () => {
    const building = syntheticBuilding();
    const s = fullSite(5);
    s.paintZone('plaza', CellSet.rect(-20, 2, -9, 9));
    const plain = generateSite(s.state, TEST_STYLE, building);
    const off = generateSite(s.state, TEST_STYLE, building, undefined, { tiled: undefined });
    const same = (a: SiteResult, b: SiteResult): boolean => JSON.stringify(a.cells) === JSON.stringify(b.cells) && a.surface.join() === b.surface.join();
    expect(same(off, plain)).toBe(true);
    expect(plain.tiled).toBeUndefined();
    const on = generateSite(s.state, TEST_STYLE, building, undefined, { tiled: { themeId: 'medieval' } });
    expect(same(on, generateSite(s.state, TEST_STYLE, building, undefined, { tiled: { themeId: 'medieval' } }))).toBe(true);
    expect(same(on, plain)).toBe(false);
    expect(on.tiled!.map((e) => e.app).sort()).toEqual(['field', 'garden', 'paving', 'paving']);
    expect(on.tiled!.every((e) => e.ok && e.violations === 0)).toBe(true);
    // Wege-Bericht nicht schlechter
    expect(on.pathAudit.unconnectedDoors.length).toBeLessThanOrEqual(plain.pathAudit.unconnectedDoors.length);
    expect(on.pathAudit.islandCells.length).toBeLessThanOrEqual(plain.pathAudit.islandCells.length);
    void plot;
  });

  it('Hof-Vorlage mit Katalog-Stilen: alle Themes ohne Rückfall und ohne Verstöße', () => {
    const styles = loadStyles();
    const building = syntheticBuilding();
    for (const themeId of THEMES) {
      for (const seed of [3, 4]) {
        const site = Site.create({ id: 's', projectId: 'p', seed, styleId: 'homestead', plot: plotAround(building, 16) });
        site.applyTemplate('homestead', building);
        const res = generateSite(site.state, styles.get('homestead')!, building, undefined, { tiled: { themeId } });
        expect(res.tiled!.length).toBeGreaterThanOrEqual(3);
        expect(res.tiled!.filter((e) => !e.ok || e.violations > 0), themeId).toEqual([]);
      }
    }
  });
});
