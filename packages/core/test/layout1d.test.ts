/**
 * 1D-Verteilung (research/30 K4): Erwartungstabellen der beiden Modi und die Eigenschaften, die jede Verteilung
 * halten muss. Die Zahlen sind die **heutigen** Werte der Aufrufer (`spread`/`rhythm` in
 * `blueprint/src/shell/facade.ts`, `beamPositions` in `materialize/src/surfaces.ts`) – der Test ist damit die
 * Absicherung, dass der gemeinsame Kern nichts verschiebt.
 */
import { describe, expect, it } from 'vitest';
import { bayAxis, bays, distribute, distributeSymmetric, symmetricWidths } from '../src/index.js';

/** Deterministischer Zahlenstrom für die Eigenschaftstests (kein Math.random). */
function* lengths(): Generator<[number, number]> {
  let s = 12345;
  const next = (): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8);
  for (let i = 0; i < 200; i++) yield [next() % 65, (next() % 9) + 1];
}

describe('distribute: beide Enden (`both`, bisher `spread`)', () => {
  it('Erwartungstabelle', () => {
    expect(distribute(8, { step: 3, ends: 'both' })).toEqual([0, 2, 5, 7]);
    expect(distribute(10, { step: 4, ends: 'both' })).toEqual([0, 3, 6, 9]);
    expect(distribute(6, { step: 3, ends: 'both' })).toEqual([0, 3, 5]);
    expect(distribute(4, { step: 3, ends: 'both' })).toEqual([0, 3]);
    expect(distribute(3, { step: 3, ends: 'both' })).toEqual([0, 2]);
    expect(distribute(2, { step: 3, ends: 'both' })).toEqual([0, 1]);
    // Sonderfall VOR der step-Prüfung: Länge 1 ist immer [0]
    expect(distribute(1, { step: 0, ends: 'both' })).toEqual([0]);
    expect(distribute(0, { step: 3, ends: 'both' })).toEqual([]);
    expect(distribute(5, { step: 0, ends: 'both' })).toEqual([]);
    // Standard ist `both`
    expect(distribute(8, { step: 3 })).toEqual([0, 2, 5, 7]);
  });

  it('Eigenschaft: beide Enden belegt, Abstand ≤ step, im Bereich, symmetrisch bis auf eine halbe Zelle', () => {
    for (const [len, step] of lengths()) {
      const r = distribute(len, { step, ends: 'both' });
      if (len <= 1 || step < 1) continue;
      expect(r[0], `len ${len}`).toBe(0);
      expect(r[r.length - 1], `len ${len}`).toBe(len - 1);
      for (let i = 0; i < r.length; i++) {
        expect(r[i]!, `len ${len}`).toBeGreaterThanOrEqual(0);
        expect(r[i]!, `len ${len}`).toBeLessThanOrEqual(len - 1);
        if (i > 0) expect(r[i]! - r[i - 1]!, `len ${len} step ${step}`).toBeLessThanOrEqual(step);
      }
      // Spiegelbild: bei aufgehendem Raster exakt, sonst höchstens eine halbe Zelle daneben (Math.round rundet
      // die mittlere Position eines ungeraden Rasters auf) – dieselbe Eigenschaft wie beim bisherigen `spread`.
      const spieg = r.map((i) => len - 1 - i).reverse();
      for (let i = 0; i < r.length; i++) expect(Math.abs(spieg[i]! - r[i]!), `len ${len} step ${step}`).toBeLessThanOrEqual(1);
      if ((len - 1) % (r.length - 1) === 0) expect(spieg, `len ${len}`).toEqual(r);
    }
  });

  it('halbe Zelle in der Mitte: dokumentierter Sonderfall von `round` (len 56, step 4 → 27 / 28)', () => {
    const r = distribute(56, { step: 4, ends: 'both' });
    expect(r).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 31, 35, 39, 43, 47, 51, 55]);
    // Idealpunkt der Mitte wäre 27,5; gerundet wird auf 28, das Spiegelbild ist 27 – genau eine Zelle daneben
    expect(r.filter((i) => Math.abs(i - 27.5) <= 0.5)).toEqual([28]);
    expect(r).toContain(28);
    expect(r).not.toContain(27); // das exakte Spiegelbild fehlt an dieser einen Stelle
  });
});

describe('distribute: nur innen (`open`, bisher `rhythm`)', () => {
  it('Erwartungstabelle', () => {
    expect(distribute(23, { step: 3, ends: 'open' })).toEqual([2, 5, 8, 11, 14, 17, 20]);
    expect(distribute(9, { step: 3, ends: 'open' })).toEqual([1, 4, 7]);
    expect(distribute(2, { step: 3, ends: 'open' })).toEqual([]);
    expect(distribute(3, { step: 1, ends: 'open' })).toEqual([1]);
    expect(distribute(3, { step: 3, ends: 'open' })).toEqual([1]);
    expect(distribute(4, { step: 3, ends: 'open' })).toEqual([1]);
    expect(distribute(5, { step: 3, ends: 'open' })).toEqual([2]);
    expect(distribute(6, { step: 3, ends: 'open' })).toEqual([1, 4]);
    expect(distribute(12, { step: 4, ends: 'open' })).toEqual([1, 5, 9]);
    expect(distribute(5, { step: 10, ends: 'open' })).toEqual([2]);
    expect(distribute(1, { step: 3, ends: 'open' })).toEqual([]);
  });

  it('Eigenschaft: nur innen, exakter Abstand `step`, im Bereich', () => {
    for (const [len, step] of lengths()) {
      const r = distribute(len, { step, ends: 'open' });
      if (len < 3 || step < 1) continue;
      for (let i = 0; i < r.length; i++) {
        expect(r[i]!, `len ${len}`).toBeGreaterThanOrEqual(1);
        expect(r[i]!, `len ${len}`).toBeLessThanOrEqual(len - 2);
        if (i > 0) expect(r[i]! - r[i - 1]!, `len ${len}`).toBe(step);
      }
    }
  });
});

describe('distributeSymmetric: Kandidatenwahl nach Idealpunkten (aus pilasterSlots)', () => {
  it('Gleichstand: erst `post`, dann Mitte, dann kleinerer Index', () => {
    // Idealpunkt für len 12, k 1 ist 5,5 – 5 und 6 sind gleich weit weg
    expect(distributeSymmetric(12, 1, [5, 6])).toEqual([5]);
    expect(distributeSymmetric(12, 1, [5, 6], (i) => i === 6)).toEqual([6]);
  });

  it('Idealpunkte gewinnen: 11 liegt exakt auf dem mittleren Idealpunkt, fällt sie weg, rückt 10 nach', () => {
    // len 23, k 3 → Idealpunkte 5,5 / 11 / 16,5
    expect(distributeSymmetric(23, 3, [6, 10, 11, 16])).toEqual([6, 11, 16]);
    expect(distributeSymmetric(23, 3, [6, 10, 16])).toEqual([6, 10, 16]);
    const r = distributeSymmetric(23, 3, [6, 10, 16]);
    expect(r).toEqual([...r].sort((a, b) => a - b));
    expect(distributeSymmetric(23, 3, [])).toEqual([]);
  });
});

describe('bays: Fassadenraster (W2, Baustandard F1/W2)', () => {
  it('Erwartungstabelle (Feld 3/4/5)', () => {
    // Taverne Süd 21, Ost 15 (X2 grid_sketch): Pfosten und Feldmitten wie im Soll-Raster
    expect(bays(21, 3)).toEqual({ posts: [0, 4, 8, 12, 16, 20], fields: [[1, 3], [5, 7], [9, 11], [13, 15], [17, 19]] });
    expect(bays(15, 3)).toEqual({ posts: [0, 5, 9, 14], fields: [[1, 4], [6, 8], [10, 13]] });
    expect(bays(11, 3)).toEqual({ posts: [0, 5, 10], fields: [[1, 4], [6, 9]] });
    // gerade Länge: gerade Feldzahl ginge nur unsymmetrisch → ein Feld weniger
    expect(bays(12, 3)).toEqual({ posts: [0, 11], fields: [[1, 10]] });
    expect(bays(15, 4)).toEqual({ posts: [0, 7, 14], fields: [[1, 6], [8, 13]] });
    expect(bays(21, 5)).toEqual({ posts: [0, 7, 13, 20], fields: [[1, 6], [8, 12], [14, 19]] });
    expect(bays(4, 3)).toEqual({ posts: [0, 3], fields: [[1, 2]] });
    expect(bays(2, 3)).toEqual({ posts: [0, 1], fields: [] });
  });

  it('Eigenschaften: Summe, spiegelsymmetrisch, kein Feld schmaler als die Feldbreite (len 3–60, Feld 2–6)', () => {
    for (let len = 3; len <= 60; len++) {
      for (let field = 2; field <= 6; field++) {
        const b = bays(len, field);
        expect(b).toEqual(bays(len, field));
        expect(b.posts[0]).toBe(0);
        expect(b.posts[b.posts.length - 1]).toBe(len - 1);
        expect(b.posts.length).toBe(b.fields.length + 1);
        const widths = b.fields.map(([a, e]) => e - a + 1);
        expect(widths.reduce((s, w) => s + w, 0) + b.posts.length).toBe(len);
        expect(b.posts.map((p) => len - 1 - p).reverse()).toEqual(b.posts);
        if (len - 2 >= field) for (const w of widths) expect(w).toBeGreaterThanOrEqual(field);
        b.fields.forEach(([a, e], i) => {
          expect(a).toBe(b.posts[i]! + 1);
          expect(e).toBe(b.posts[i + 1]! - 1);
        });
      }
    }
  });

  it('bayAxis: ungerade Mitte, gerade zur Linienmitte hin, gerades Mittelfeld doppelt – spiegelgleich', () => {
    expect(bayAxis(1, 3, 0, 20)).toEqual([2]);
    expect(bayAxis(1, 4, 0, 14)).toEqual([3]);
    expect(bayAxis(10, 13, 0, 14)).toEqual([11]);
    expect(bayAxis(1, 10, 0, 11)).toEqual([5, 6]);
    for (let len = 3; len <= 40; len++) {
      for (let field = 2; field <= 6; field++) {
        const axes = bays(len, field).fields.flatMap(([a, e]) => bayAxis(a, e, 0, len - 1));
        expect(axes.map((x) => len - 1 - x).sort((p, q) => p - q)).toEqual([...axes].sort((p, q) => p - q));
      }
    }
  });

  it('symmetricWidths: Rest von der Mitte, ungerader Rest bei gerader Anzahl geht nicht', () => {
    expect(symmetricWidths(11, 3)).toEqual([4, 3, 4]);
    expect(symmetricWidths(10, 3)).toEqual([3, 4, 3]);
    expect(symmetricWidths(9, 2)).toBeUndefined();
    expect(symmetricWidths(2, 3)).toBeUndefined();
  });
});
