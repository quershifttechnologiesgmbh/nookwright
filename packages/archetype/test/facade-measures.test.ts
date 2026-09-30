/**
 * MX-Q (DR2 §4 Nr. 1): Articulation-Index, Symmetrie-Differenz und Rasterentropie – Geometrie an kleinen Beispielen,
 * dazu die Opt-in-Regel in `silhouette()`: ohne Angabe in `checks` fehlen die Werte (bitgleich), mit Angabe erscheinen
 * sie als weicher Wert.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ShellCell } from '@mcda/blueprint';
import { parseBuildingTypeDef } from '@mcda/catalog';
import { nodeContext } from '@mcda/pipeline/node';
import { FACADE_MEASURE_BANDS, articulation, facadeMeasureLints, facadeMeasures, hullArea, planBuilding, type ArchetypeContext } from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const arch: ArchetypeContext = { minArea: (id) => (ctx.catalog.roomTypeIds().includes(id) ? ctx.catalog.roomType(id).minArea : 4) };

const rect = (w: number, d: number, x0 = 0, z0 = 0): [number, number][] =>
  Array.from({ length: w * d }, (_, i) => [x0 + (i % w), z0 + Math.floor(i / w)] as [number, number]);
const wall = (x: number, y: number, kind: ShellCell['kind'] = 'wall'): ShellCell => ({ pos: [x, y, 0], kind, role: kind, shape: 'block' });
const rooms = new Map([['r1', { floorIndex: 0, baseY: 0 }]]) as never;

describe('MX-Q: Fassadenmaße', () => {
  it('konvexe Hülle und Articulation-Index: Rechteck 1, L-Form kleiner', () => {
    expect(hullArea(rect(4, 3))).toBe(12);
    expect(articulation(rect(4, 3))).toBe(1);
    const l = [...rect(6, 2), ...rect(2, 4, 0, 2)];
    // 20 Zellen, Hülle über die Ecken (0,0) (6,0) (6,2) (2,6) (0,6): 6·2 + 2·4 + Dreieck 4·4/2 = 28
    expect(hullArea(l)).toBe(28);
    expect(articulation(l)).toBeCloseTo(20 / 28, 6);
  });

  it('symmetrische Front mit Fenstern übereinander: Differenz 0; versetzte Fenster: > 0; Entropie in Bit', () => {
    // 5 breit, 2 Geschosse (y 0–1 und 3–4), Fenster in Spalte 1 und 3, Tür in der Mitte
    const sym: ShellCell[] = [];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      const open = (y === 1 || y === 4) && (x === 1 || x === 3);
      sym.push(wall(x, y, open ? 'window' : x === 2 && y <= 1 ? 'door' : 'wall'));
    }
    const m = facadeMeasures({ cells: sym, rooms }, rect(5, 1), 'south');
    expect(m.mirrorDiff).toBe(0);
    expect(m.facadeEntropy).toBeGreaterThan(0);
    expect(m.facadeEntropy).toBeLessThanOrEqual(Math.log2(3));
    expect(m.articulationFront).toBe(1);
    const shifted = sym.map((c) => (c.pos[1] === 4 && c.pos[0] === 3 ? wall(3, 4) : c.pos[1] === 4 && c.pos[0] === 4 ? wall(4, 4, 'window') : c));
    const s = facadeMeasures({ cells: shifted, rooms }, rect(5, 1), 'south');
    expect(s.mirrorDiff).toBeGreaterThan(0);
    expect(s.floorDiff).toBeGreaterThan(0);
    expect(s.facadeSymmetry).toBeCloseTo((s.mirrorDiff + s.floorDiff) / 2, 2);
    // nur Wand: Entropie 0
    expect(facadeMeasures({ cells: rect(5, 5).map(([x, y]) => wall(x, y)), rooms }, rect(5, 1), 'south').facadeEntropy).toBe(0);
  });

  it('weiche Bänder: nur Ausreißer werden gemeldet', () => {
    const inBand = { articulationPlan: 0.9, articulationFront: 0.8, facadeSymmetry: 1, mirrorDiff: 1, floorDiff: 1, facadeEntropy: 0.5, frontCells: 10 };
    expect(facadeMeasureLints(inBand)).toEqual([]);
    expect(facadeMeasureLints({ ...inBand, articulationPlan: 0.5, facadeEntropy: 0.1 })).toEqual([
      `Fassade: articulationPlan 0.5 außerhalb ${FACADE_MEASURE_BANDS.articulationPlan!.join('–')}`,
      `Fassade: facadeEntropy 0.1 außerhalb ${FACADE_MEASURE_BANDS.facadeEntropy!.join('–')}`,
    ]);
  });

  it('silhouette(): Werte nur mit Angabe in `checks` (ohne Angabe bitgleich), mit Angabe als weicher Wert', () => {
    const src = readFileSync(`${ROOT}/buildingtypes/tavern.json5`, 'utf8');
    const parsed = parseBuildingTypeDef(src, 'tavern.json5');
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const plain = planBuilding(parsed.value, { size: 'M' }, 5, arch);
    expect(plain.quality.map((q) => q.id).sort()).toEqual(['ratio', 'roofToEave']);
    const def = { ...parsed.value, checks: { ...parsed.value.checks, articulationPlan: [0.5, 1], articulationFront: [0.5, 1], facadeSymmetry: [0, 1], facadeEntropy: [0, 1.6] } } as typeof parsed.value;
    const measured = planBuilding(def, { size: 'M' }, 5, arch);
    const q = Object.fromEntries(measured.quality.map((x) => [x.id, x]));
    for (const id of ['articulationPlan', 'articulationFront', 'facadeSymmetry', 'facadeEntropy']) {
      expect(q[id]?.ok, id).toBe(true);
      expect(q[id]?.value, id).toBeGreaterThanOrEqual(0);
    }
    expect(q['articulationPlan']!.value).toBeLessThanOrEqual(1);
    // Weite Bereiche: der Planer wählt dieselbe Variante wie ohne die Werte
    expect(measured.attempt).toBe(plain.attempt);
    expect(measured.rooms.map((r) => r.cells.toArray())).toEqual(plain.rooms.map((r) => r.cells.toArray()));
  });
});
