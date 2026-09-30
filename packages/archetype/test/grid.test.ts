/**
 * W6 (27.09.2026, Review W4-R R1, Baustandard F1/F2, Prüfbericht X2 §6.3): Trennwände auf dem Fassadenraster.
 *  - Einheit: `snapWidths` legt Grenzen neben Achsen und gibt jedem Raum mit Licht-Bedarf eine ganze Achse; `gridFromLines`
 *    liest das Raster der echten Hülle (`massingGrid`) in (u, v) des Rechtecks, drehgleich.
 *  - Plan: mit der Feldbreite des Themes (`archetypeContext` wie App und Engine) keine Wohn-/Gästeräume ohne Fenster in der
 *    Taverne (S/M/L × Seeds × Themes), Front gerade (Doppeltür), Pflichträume bleiben. Ohne `facadeBay` plant der
 *    Generator wie bisher (die übrigen Tests dieses Pakets laufen ohne und sind unverändert grün).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUME } from '@mcda/blueprint';
import { parseBuildingTypeDef, type BuildingTypeDef } from '@mcda/catalog';
import { CellSet } from '@mcda/core';
import { archetypeContext } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT, expectCpuBelow } from '../../core/test/support/timing.js';
import {
  gridFromLines, layoutGrid, lineAxes, massingGrid, planBuilding, planFacadeBay, requiredMissing, snapWidths, windowlessRooms, type BuildingPlan,
} from '../src/index.js';
import { axesOf } from '../src/frame.js';
import { axisWithin } from '../src/grid.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const arch = archetypeContext(ctx.catalog, ctx.themes);
const load = (id: string): BuildingTypeDef => {
  const r = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/${id}.json5`, 'utf8'), `${id}.json5`);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};

describe('W6 Raster im Planer: Einheit', () => {
  it('snapWidths: jeder Raum mit Licht-Bedarf bekommt eine ganze Achse, keine Grenze auf einer Achse, Mindestbreiten bleiben', () => {
    // [Länge, Feld, Rohbreiten, Licht-Bedarf]: nicht mehr Räume mit Licht als Felder, Bad (false) schmal
    const cases: ReadonlyArray<readonly [number, number, readonly number[], readonly boolean[]]> = [
      [22, 4, [7, 8, 7], [true, true, true]],
      [22, 4, [6, 9, 7], [true, true, true]],
      [26, 4, [5, 6, 5, 5, 5], [true, true, true, true, true]],
      [26, 4, [4, 6, 6, 5, 5], [false, true, true, true, true]],
      [21, 3, [6, 5, 5, 5], [true, true, true, true]],
      [25, 5, [8, 8, 9], [true, true, true]],
      [19, 3, [4, 5, 5, 5], [false, true, true, true]],
    ];
    for (const [L, bay, raw, lit] of cases) {
      const axes = lineAxes(L, bay);
      const w = snapWidths(0, raw, raw.map(() => 4), lit, axes, () => false, bay >= 5 ? 3 : 2);
      const where = `${L}/${bay} ${raw.join(',')} → ${w.join(',')}`;
      expect(w.reduce((x, y) => x + y, 0), where).toBe(L);
      let s = 0;
      w.forEach((x, i) => {
        expect(x, `${where}: Breite ${i}`).toBeGreaterThanOrEqual(4);
        if (i > 0) expect(axes.some((ax) => ax.includes(s - 1) || ax.includes(s)), `${where}: Grenze ${s} auf einer Achse`).toBe(false);
        if (lit[i] === true) expect(axisWithin(axes, s, s + x - 1), `${where}: Raum ${i} ohne Achse`).toBe(true);
        s += x;
      });
    }
  });

  it('gridFromLines: das Raster der Hülle eines freien Rechtecks = bays je Seite, in jeder Lage (u entlang x oder z, v gespiegelt)', () => {
    for (const [w, d] of [[22, 13], [13, 22], [17, 17]] as const) {
      for (const bay of [3, 4, 5]) {
        const box = { x0: 0, z0: 0, x1: w - 1, z1: d - 1 };
        const lines = massingGrid({
          typeId: 'probe', name: 'probe', seed: 1, floors: [{ index: 0, height: 3 }], volumes: [{ id: DEFAULT_VOLUME }],
          rooms: [{ volumeId: DEFAULT_VOLUME, floor: 0, cells: CellSet.rect(0, 0, w - 1, d - 1), roomTypeId: 'storage', entry: -1, required: false }],
        }, bay, 4);
        for (const side of ['low', 'high'] as const) {
          const axes = axesOf(box, side);
          const g = gridFromLines(axes, lines, bay);
          const want = layoutGrid(axes.L, axes.S, bay);
          const norm = (x: readonly (readonly number[])[]): string => JSON.stringify([...x].map((a) => [...a].sort((p, q) => p - q)).sort((p, q) => p[0]! - q[0]!));
          for (const k of ['back', 'front', 'low', 'high'] as const) expect(norm(g[k]), `${w}×${d} Feld ${bay} ${side} ${k}`).toBe(norm(want[k]));
        }
      }
    }
  });

  it('planFacadeBay: Feldbreite der Regel, sonst des Themes, sonst 3; Fensterabstand verbreitert; ohne facadeBay oder Raster keine', () => {
    const tavern = load('tavern');
    expect(planFacadeBay(tavern, { themeId: 'timber' }, arch)).toBe(4);
    expect(planFacadeBay(tavern, { themeId: 'medieval' }, arch)).toBe(3);
    expect(planFacadeBay(tavern, { themeId: 'nordic' }, arch)).toBe(5);
    expect(planFacadeBay(tavern, {}, arch)).toBe(4); // erstes Theme des Bautyps
    expect(planFacadeBay(tavern, { themeId: 'medieval', shell: { windows: { spacing: 7 } } }, arch)).toBe(6);
    expect(planFacadeBay(tavern, { themeId: 'timber' }, {})).toBeUndefined();
    const facade = { rules: { grid: false } };
    expect(planFacadeBay(tavern, { themeId: 'timber', shell: { facade } }, arch)).toBeUndefined();
    expect(planFacadeBay(tavern, { themeId: 'timber', shell: { facade: { rules: { grid: true, bay: 5 } } } }, arch)).toBe(5);
  });
});

describe('W6 Raster im Planer: Pläne', () => {
  const width = (plan: BuildingPlan): number => {
    const xs = plan.rooms.filter((r) => r.volumeId === DEFAULT_VOLUME && r.floor === 0).flatMap((r) => r.cells.toArray().map(([x]) => x));
    return Math.max(...xs) - Math.min(...xs) + 1;
  };

  it('Taverne S/M/L × 4 Seeds × 3 Themes: 0 Gäste-/Wohnräume ohne Fenster, gerade Front, Pflichträume, Plan < 1 s', { timeout: HEAVY_TIMEOUT }, () => {
    const def = load('tavern');
    let dark = 0;
    for (const themeId of ['timber', 'medieval', 'nordic']) {
      for (const size of ['S', 'M', 'L'] as const) {
        for (const seed of [1, 2, 3, 4]) {
          const where = `${themeId} ${size} ${seed}`;
          const { result: plan } = expectCpuBelow(() => planBuilding(def, { size, themeId }, seed * 7919, arch), 1000, where);
          expect(plan.warnings, where).toEqual([]);
          expect(requiredMissing(def, plan), where).toEqual([]);
          expect(width(plan) % 2, `${where}: gerade Front`).toBe(0);
          const n = windowlessRooms(plan, planFacadeBay(def, { size, themeId }, arch)!);
          if (n > 0) console.warn(`${where}: ${n} Räume ohne Fenster`);
          dark += n;
        }
      }
    }
    expect(dark).toBe(0);
  });

  it('Burg, Bauernhaus, Häuserzeile, Stadthaus, Langhaus: höchstens vereinzelt Räume ohne Fenster', { timeout: HEAVY_TIMEOUT }, () => {
    let dark = 0;
    let rooms = 0;
    for (const id of ['castle_compact', 'farmhouse', 'townhouse_row', 'townhouse', 'longhouse']) {
      const def = load(id);
      for (const themeId of def.themes ?? ['medieval']) {
        for (const size of (['S', 'M', 'L'] as const).filter((s) => def.sizes?.[s] !== undefined)) {
          for (const seed of [1, 2]) {
            const plan = planBuilding(def, { size, themeId }, seed * 7919, arch);
            expect(plan.warnings, `${id} ${themeId} ${size} ${seed}`).toEqual([]);
            dark += windowlessRooms(plan, planFacadeBay(def, { size, themeId }, arch)!);
            rooms += plan.rooms.length;
          }
        }
      }
    }
    // vorher (ohne Raster im Planer, gleiche Seeds): Burg allein 14 in 54 Welten; nachher 1 (Burg L nordisch)
    expect(dark).toBeLessThanOrEqual(1);
    expect(rooms).toBeGreaterThan(100);
  });
});
