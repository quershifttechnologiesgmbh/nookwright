/** W10 „Augenhöhe“ im Editor: Kamera vor der Haupttür, 1,7 über dem Boden, waagerecht; Haus ganz im Bild. */
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, eyeLevelCamera } from '../src/viewer/eyeLevel.js';

const box = { min: [10, 0, 10] as const, max: [24, 12, 20] as const };
const door = { pos: [16, 1, 21] as const, out: [0, 1] as const };

describe('eyeLevelCamera', () => {
  it('Auge 1,7 über dem Türboden, vor der Tür, waagerechter Blick', () => {
    const c = eyeLevelCamera(box, door, 1.6);
    expect(c.position[1]).toBeCloseTo(1 + EYE_HEIGHT, 9);
    expect(c.target[1]).toBe(c.position[1]);
    expect(c.position[2]).toBeGreaterThan(21 + 3);
    expect(c.fov).toBe(32);
    expect(c.shiftY).toBeGreaterThan(0);
  });

  it('ohne Shift (Texturen, 70°): Bau passt ohne Kippen, keine Verschiebung', () => {
    const c = eyeLevelCamera(box, door, 1.6, { shift: false });
    expect(c.shiftY).toBe(0);
    expect(c.fov).toBe(70);
    const t = Math.tan((70 * Math.PI) / 360);
    const d = Math.hypot(c.position[0] - 17, c.position[2] - 15.5);
    expect((13 - c.position[1]) / (d - 8)).toBeLessThanOrEqual(t);
  });

  it('deterministisch und ohne Tür von Süden', () => {
    expect(eyeLevelCamera(box, door, 1.6)).toEqual(eyeLevelCamera(box, door, 1.6));
    const c = eyeLevelCamera(box, undefined, 1.6, { swingDeg: 0 });
    expect(c.position[2]).toBeGreaterThan(21);
    expect(c.position[0]).toBeCloseTo(17.5, 6);
  });
});
