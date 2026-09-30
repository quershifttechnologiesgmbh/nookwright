/** Silhouetten-Kennwert: Firsthöhen-Klassen, Umrisswechsel, Streuung – rein aus Hüllenzellen. */
import { describe, expect, it } from 'vitest';
import { silhouetteMetrics, type SilhouetteCell } from '../src/index.js';

/** Quader aus Wänden: x0..x1, z0..z1, Höhe h. */
function box(x0: number, x1: number, z0: number, z1: number, h: number): SilhouetteCell[] {
  const out: SilhouetteCell[] = [];
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = 0; y < h; y++) out.push({ pos: [x, y, z], kind: 'wall' });
  return out;
}

/** Satteldach mit First entlang x: Wandhöhe `wall`, je Zeile zur Mitte eine Zelle höher. */
function gable(x0: number, x1: number, z0: number, z1: number, wall: number): SilhouetteCell[] {
  const out: SilhouetteCell[] = [];
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const h = wall + Math.min(z - z0, z1 - z);
    for (let y = 0; y < h; y++) out.push({ pos: [x, y, z], kind: y >= wall ? 'roof' : 'wall' });
  }
  return out;
}

describe('silhouetteMetrics', () => {
  it('leere Eingabe ist 0', () => {
    expect(silhouetteMetrics([]).interest).toBe(0);
  });

  it('Gelände und Pflanzen zählen nicht', () => {
    const cells: SilhouetteCell[] = [...box(0, 6, 0, 6, 5), { pos: [3, 40, 3], kind: 'plant' }, { pos: [3, 41, 3], kind: 'terrain' }];
    expect(silhouetteMetrics(cells)).toEqual(silhouetteMetrics(box(0, 6, 0, 6, 5)));
  });

  it('ein Quader hat einen Gipfel und keine Traufenstreuung', () => {
    const m = silhouetteMetrics(box(0, 8, 0, 8, 6));
    expect(m.peaks).toBe(1);
    expect(m.distinctPeakHeights).toBe(1);
    expect(m.outlineHeightStd).toBe(0);
  });

  it('zwei Baukörper mit verschiedener Höhe zählen als zwei Firsthöhen und erhöhen das Interesse', () => {
    const single = silhouetteMetrics(gable(0, 10, 0, 8, 5));
    const two = silhouetteMetrics([...gable(0, 10, 0, 8, 5), ...gable(11, 15, 2, 6, 3)]);
    expect(two.distinctPeakHeights).toBe(2);
    expect(two.peaks).toBe(2);
    expect(two.interest).toBeGreaterThan(single.interest);
    expect(two.outlineHeightStd).toBeGreaterThan(single.outlineHeightStd);
  });

  it('deterministisch und im Bereich 0 … 1', () => {
    const cells = [...gable(0, 10, 0, 8, 5), ...gable(11, 15, 2, 6, 3), ...box(-3, -1, 0, 2, 12)];
    const a = silhouetteMetrics(cells);
    expect(silhouetteMetrics(cells)).toEqual(a);
    expect(a.interest).toBeGreaterThanOrEqual(0);
    expect(a.interest).toBeLessThanOrEqual(1);
  });
});
