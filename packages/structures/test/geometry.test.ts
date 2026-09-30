import { describe, expect, it } from 'vitest';
import { Polyline, footprintOffsets, inFootprint, roofRing, towerFloors } from '../src/index.js';
import { N4, pseudoAngle, snapDir } from '../src/geometry.js';

describe('Polyline: Bogenlänge, nächster Punkt, Seiten', () => {
  const ring = new Polyline([[0, 0], [10, 0], [10, 6], [0, 6]], true);

  it('Länge, Punkt bei s und zyklische Differenz', () => {
    expect(ring.total).toBe(32);
    expect(ring.pointAt(13)).toMatchObject({ x: 10, z: 3, seg: 1 });
    expect(ring.pointAt(33)).toMatchObject({ x: 1, z: 0 });
    expect(ring.delta(31, 1)).toBe(2);
    expect(ring.delta(1, 31)).toBe(-2);
  });

  it('nächster Punkt mit Vorzeichen (links der Zeichenrichtung = +)', () => {
    const n = ring.nearest(4, -2);
    expect(n).toMatchObject({ seg: 0, s: 4, dist: 2 });
    expect(n.left).toBe(2); // Norden liegt links, wenn man nach Osten zeichnet
    expect(ring.nearest(4, 2).left).toBe(-2);
  });

  it('entfernt doppelte Punkte und den wiederholten Startpunkt', () => {
    const p = new Polyline([[0, 0], [0, 0], [5, 0], [5, 5], [0, 0]], true);
    expect(p.points).toEqual([[0, 0], [5, 0], [5, 5]]);
    expect(p.segments).toHaveLength(3);
  });

  it('Knick: gerade = 1, rechter Winkel = 0, offene Enden ohne Knick', () => {
    const open = new Polyline([[0, 0], [5, 0], [10, 0], [10, 5]], false);
    expect(open.turnCos(0)).toBeUndefined();
    expect(open.turnCos(1)).toBe(1);
    expect(open.turnCos(2)).toBe(0);
    expect(open.turnCos(3)).toBeUndefined();
  });
});

describe('Turm-Grundrisse im Raster', () => {
  it('rund: Kreis mit Durchmesser 2r+1, symmetrisch', () => {
    for (const r of [3, 4, 5, 6]) {
      const offs = footprintOffsets('round', r);
      const row0 = offs.filter(([, dz]) => dz === 0).length;
      expect(row0).toBe(2 * r + 1);
      for (const [dx, dz] of offs) {
        expect(inFootprint('round', r, -dx, dz) && inFootprint('round', r, dz, dx)).toBe(true);
      }
    }
    // r = 4: Zeilenbreiten 5, 7, 9, 9, 9, 9, 9, 7, 5
    const widths = Array.from({ length: 9 }, (_, i) => footprintOffsets('round', 4).filter(([, dz]) => dz === i - 4).length);
    expect(widths).toEqual([5, 7, 9, 9, 9, 9, 9, 7, 5]);
  });

  it('Dachringe: 0 im Überstand, 1 über der Außenwand, 4-Nachbarn unterscheiden sich um ≤ 1', () => {
    for (const shape of ['round', 'square'] as const) {
      for (const r of [3, 4, 5]) {
        for (const [dx, dz] of footprintOffsets(shape, r + 1)) {
          const k = roofRing(shape, r, dx, dz);
          const onWall = inFootprint(shape, r, dx, dz) && N4.some(([ax, az]) => !inFootprint(shape, r, dx + ax, dz + az));
          if (!inFootprint(shape, r, dx, dz)) expect(k).toBe(0);
          if (onWall) expect(k).toBe(1);
          for (const [ax, az] of N4) {
            if (inFootprint(shape, r + 1, dx + ax, dz + az)) expect(Math.abs(roofRing(shape, r, dx + ax, dz + az) - k)).toBeLessThanOrEqual(1);
          }
        }
        expect(roofRing(shape, r, 0, 0)).toBe(r + 1);
      }
    }
  });

  it('Geschossböden: Pflichtböden + Zwischenböden mit ≥ 3 Luftreihen', () => {
    expect(towerFloors(0, 12, 4)).toEqual([0, 4, 8, 12]);
    expect(towerFloors(0, 10, 4, 5)).toEqual([0, 5, 10]);
    expect(towerFloors(0, 20, 4, 9)).toEqual([0, 4, 9, 13, 20]);
    for (const f of [towerFloors(3, 30, 4, 17), towerFloors(0, 7, 4)]) {
      for (let i = 1; i < f.length; i++) expect(f[i]! - f[i - 1]!).toBeGreaterThanOrEqual(3);
    }
  });

  it('Hilfsrichtungen: Achse eines Vektors, Rauten-Winkel monoton', () => {
    expect(snapDir(3, -1)).toBe('east');
    expect(snapDir(-1, -3)).toBe('north');
    const pts: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const a = pts.map(([x, z]) => pseudoAngle(x, z));
    for (let i = 1; i < a.length; i++) expect(a[i]!).toBeGreaterThan(a[i - 1]!);
  });
});
