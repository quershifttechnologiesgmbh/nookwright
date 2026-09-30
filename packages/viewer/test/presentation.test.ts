/** W10 Präsentations-Look: reine Mathematik (Licht-Matrix, Inverse, Stimmungen). */
import { describe, expect, it } from 'vitest';
import { transformPoint } from '../src/camera.js';
import { invert, lightMatrix, MOODS, multiply } from '../src/presentation.js';

describe('Präsentation: Mathematik', () => {
  it('Licht-Matrix: Mitte der Kugel → Bildmitte, Rand der Kugel im Bild (Parallelprojektion entlang der Sonne)', () => {
    const c = [10, 5, 8] as const;
    const m = lightMatrix([0.4, 0.7, -0.3], c, 12);
    const p = transformPoint(m, c);
    expect(p[0]).toBeCloseTo(0, 5);
    expect(p[1]).toBeCloseTo(0, 5);
    expect(Math.abs(p[2])).toBeLessThan(1);
    for (const d of [[12, 0, 0], [0, 12, 0], [0, 0, 12], [-12, 0, 0]] as const) {
      const q = transformPoint(m, [c[0] + d[0], c[1] + d[1], c[2] + d[2]]);
      for (const v of q) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  it('Inverse: M · M⁻¹ = Einheit', () => {
    const m = lightMatrix([0.1, 0.9, 0.2], [3, 4, 5], 7);
    const id = multiply(m, invert(m));
    id.forEach((v, i) => expect(v).toBeCloseTo(i % 5 === 0 ? 1 : 0, 4));
  });

  it('Stimmungen: Abend wärmer und die Sonne röter als am Tag', () => {
    const warm = (c: readonly number[]): number => c[0]! / c[2]!;
    expect(warm(MOODS.abend.sun)).toBeGreaterThan(warm(MOODS.tag.sun));
    expect(warm(MOODS.abend.horizon)).toBeGreaterThan(warm(MOODS.tag.horizon));
  });
});
