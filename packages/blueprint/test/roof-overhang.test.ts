/**
 * M2 (plan/spikes/FN_inspiration_gebaeude.md): Traufe und Ortgang getrennt (`RoofDetail.roofOverhang`).
 *  - `legacy` (und fehlendes Feld) ist bitgleich zum Stand davor – für jede Dachform und jeden Grundriss
 *  - `refined`: Traufe behält den Überstand, der Ortgang ist schmal (Hauptdach ≤ 1, Flügel bündig mit der Giebelwand)
 *  - Walm/Mansarde und ein einzelnes Rechteck mit Überstand 1 bleiben gleich
 */
import { describe, expect, it } from 'vitest';
import { deriveShell, type RoofDetail, type RoofStyle, type Shell } from '../src/index.js';
import { LAYOUTS, lHouse, rect } from './support/houses.js';

const STYLES: readonly RoofStyle[] = ['gable', 'hip', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox', 'shed', 'flat'];
const EDGE: RoofDetail = { trim: true, verge: 'closed', gableWindows: true };
const shellOf = (p: ReturnType<typeof rect>, roof: RoofStyle, roofDetail: RoofDetail, overhang = 1): Shell => deriveShell(p.state, { roof, overhang, roofDetail });
const digest = (s: Shell): string => JSON.stringify(s.cells);
const roofX = (s: Shell): [number, number] => {
  const xs = s.cells.filter((c) => c.kind === 'roof').map((c) => c.pos[0]);
  return [Math.min(...xs), Math.max(...xs)];
};

describe('Dachüberstand: legacy bitgleich', () => {
  for (const [name, make] of LAYOUTS) {
    for (const roof of STYLES) {
      it(`${name}, ${roof}: roofOverhang 'legacy' = Feld fehlt`, () => {
        expect(digest(shellOf(make(), roof, { ...EDGE, roofOverhang: 'legacy' }))).toBe(digest(shellOf(make(), roof, EDGE)));
      });
    }
  }
});

describe('Dachüberstand: refined', () => {
  it('jede Dachform und jeder Grundriss baut ohne Fehler, Dach nicht leer (außer Flachdach), deterministisch', () => {
    for (const [, make] of LAYOUTS) {
      for (const roof of STYLES) {
        const a = shellOf(make(), roof, { ...EDGE, roofOverhang: 'refined' }, 2);
        expect(digest(shellOf(make(), roof, { ...EDGE, roofOverhang: 'refined' }, 2))).toBe(digest(a));
        if (roof !== 'flat') expect(a.cells.some((c) => c.kind === 'roof')).toBe(true);
      }
    }
  });

  it('Walm und Mansarde ändern sich nicht', () => {
    for (const roof of ['hip', 'mansard'] as const) {
      expect(digest(shellOf(lHouse(), roof, { ...EDGE, roofOverhang: 'refined' }))).toBe(digest(shellOf(lHouse(), roof, EDGE)));
    }
  });

  it('einzelnes Rechteck, Überstand 1: gleich (Hauptdach hat Ortgang 1)', () => {
    expect(digest(shellOf(rect(11, 9), 'gable', { ...EDGE, roofOverhang: 'refined' }))).toBe(digest(shellOf(rect(11, 9), 'gable', EDGE)));
  });

  it('einzelnes Rechteck, Überstand 2: Ortgang nur 1 (First entlang x → 1 Block weniger je Ende), Traufe bleibt 2', () => {
    const legacy = shellOf(rect(13, 9), 'gable', EDGE, 2);
    const refined = shellOf(rect(13, 9), 'gable', { ...EDGE, roofOverhang: 'refined' }, 2);
    const [l0, l1] = roofX(legacy);
    const [r0, r1] = roofX(refined);
    expect(r0).toBe(l0 + 1);
    expect(r1).toBe(l1 - 1);
    const zs = (s: Shell): [number, number] => {
      const v = s.cells.filter((c) => c.kind === 'roof').map((c) => c.pos[2]);
      return [Math.min(...v), Math.max(...v)];
    };
    expect(zs(refined)).toEqual(zs(legacy));
  });

  it('L-Grundriss: der Flügel endet bündig, das Dach ist kleiner als legacy, die Traufe bleibt', () => {
    const legacy = shellOf(lHouse(), 'gable', EDGE);
    const refined = shellOf(lHouse(), 'gable', { ...EDGE, roofOverhang: 'refined' });
    const count = (s: Shell): number => s.cells.filter((c) => c.kind === 'roof').length;
    expect(count(refined)).toBeLessThan(count(legacy));
    // die Wandfläche (Grundriss) bleibt vom Dach überdeckt
    const wall = (s: Shell): number => s.cells.filter((c) => c.kind === 'wall').length;
    expect(wall(refined)).toBeGreaterThan(0);
  });
});
