/**
 * Breiten-Klemme (research/30 K5, Vorbild Blenders `Clamp Overlap`): dasselbe Problem, das Bordüre, Wandvorlage
 * und Konsole heute dreimal ad hoc lösen – hier einmal geprüft.
 */
import { describe, expect, it } from 'vitest';
import { bevelFits, clampBevel } from '../src/index.js';

describe('clampBevel', () => {
  it('klemmt auf die halbe kleinere freie Strecke', () => {
    expect(clampBevel(3, [10, 10])).toBe(3); // passt
    expect(clampBevel(5, [10, 10])).toBe(5);
    expect(clampBevel(6, [10, 10])).toBe(5); // halbe Lücke
    expect(clampBevel(3, [4, 10])).toBe(2); // kleinere Seite gibt den Takt
    expect(clampBevel(3, [3, 10])).toBe(1);
    expect(clampBevel(3, [2, 10])).toBe(1);
    expect(clampBevel(3, [1, 10])).toBe(0); // kein Platz
  });

  it('hält den Mindestabstand auf beiden Seiten ein', () => {
    expect(clampBevel(3, [6, 6], 1)).toBe(2); // (6−1)/2
    expect(clampBevel(3, [6, 6], 2)).toBe(2);
    expect(clampBevel(3, [4, 4], 2)).toBe(1);
    expect(clampBevel(3, [2, 2], 2)).toBe(0);
  });

  it('Sonderfälle: Breite 0, keine Strecken, negative Werte werden nie negativ', () => {
    expect(clampBevel(0, [10, 10])).toBe(0);
    expect(clampBevel(3, [])).toBe(0);
    expect(clampBevel(3, [0, 0])).toBe(0);
    expect(clampBevel(-1, [10, 10])).toBe(0);
    expect(clampBevel(2.5, [10, 10])).toBe(2); // ganzzahliges Raster
  });

  it('bevelFits sagt dasselbe in kurz', () => {
    expect(bevelFits(2, [5, 5])).toBe(true);
    expect(bevelFits(4, [5, 5])).toBe(false);
    expect(bevelFits(2, [5, 5], 2)).toBe(false);
    expect(bevelFits(0, [0, 0])).toBe(true);
  });
});
