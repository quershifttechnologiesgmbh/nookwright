/**
 * W8-G: Angriffs-Bitmaps für den Windrad-/Hakenkreuz-Detektor (Projektregel HANDOFF §1). Alle Fälle aus dem Review
 * F_tiled_wfc (adversarial.ts) plus Skalierung, Rauschen, zwei Materialien – je Rechts- und Linksdrehung. Soll: kein
 * Fehlschlag, und keine Meldung bei spiegelsymmetrischen Mustern (Kreuz, Ring, Schachbrett, T-Kreuz, Möbelgruppen).
 */
import { describe, expect, it } from 'vitest';
import { findChiralFigures, findPinwheels, scanLabelGrid } from '../src/index.js';

type Bmp = number[][]; // [z][x]

function swastika(a: number, right: boolean): Bmp {
  const n = 2 * a + 1;
  const b: Bmp = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    b[a]![i] = 1;
    b[i]![a] = 1;
  }
  const hook: Array<[number, number]> = [];
  for (let x = a; x < n; x++) hook.push([x, 0]);
  for (let r = 0; r < 4; r++) {
    for (const [x0, z0] of hook) {
      let x = x0, z = z0;
      for (let k = 0; k < r; k++) [x, z] = [n - 1 - z, x];
      b[z]![right ? x : n - 1 - x] = 1;
    }
  }
  return b;
}
const mirror = (b: Bmp): Bmp => b.map((r) => [...r].reverse());
const scale = (b: Bmp, s: number): Bmp => b.flatMap((row) => Array.from({ length: s }, () => row.flatMap((v) => Array<number>(s).fill(v))));
const PINWHEEL4: Bmp = [[0, 1, 0, 0], [0, 1, 1, 1], [1, 1, 1, 0], [0, 0, 1, 0]];
function embed(b: Bmp, pad: number, bg: (x: number, z: number) => number = () => 0): Bmp {
  const n = b.length, m = b[0]!.length;
  return Array.from({ length: n + 2 * pad }, (_, z) => Array.from({ length: m + 2 * pad }, (_, x) => {
    const bz = z - pad, bx = x - pad;
    return bz >= 0 && bx >= 0 && bz < n && bx < m ? b[bz]![bx]! : bg(x, z);
  }));
}
function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
/** 45° gedrehtes Hakenkreuz aus Diagonalpixeln. */
function diagonal(a: number): Bmp {
  const src = swastika(a, true);
  const n = src.length;
  const N = 2 * n - 1;
  const b: Bmp = Array.from({ length: N }, () => Array<number>(N).fill(0));
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (src[z]![x] === 1) b[x + z]![x - z + n - 1] = 1;
  return b;
}
/** Maske „Wert in `on`“ als flaches Raster. */
function mask(b: Bmp, on: (v: number) => boolean = (v) => v === 1): { m: Uint8Array; w: number; d: number } {
  const d = b.length, w = b[0]!.length;
  const m = new Uint8Array(w * d);
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) m[z * w + x] = on(b[z]![x]!) ? 1 : 0;
  return { m, w, d };
}
const hits = (b: Bmp, on?: (v: number) => boolean): number => {
  const { m, w, d } = mask(b, on);
  return findChiralFigures(m, w, d).length;
};
const labelHits = (b: Bmp): number => scanLabelGrid(b.flat(), b[0]!.length, b.length).length;

describe('W8-G Windrad-Detektor: Angriffs-Bitmaps (alle müssen erkannt werden)', () => {
  const positives: Array<[string, Bmp, ((v: number) => boolean)?]> = [];
  for (const right of [true, false]) {
    const h = right ? 'rechts' : 'links';
    const f = (b: Bmp): Bmp => (right ? b : mirror(b));
    positives.push([`Tetromino-Windrad 4 × 4 ${h}`, f(PINWHEEL4)]);
    for (const a of [2, 3, 4, 5, 6, 7]) positives.push([`Hakenkreuz ${2 * a + 1} × ${2 * a + 1} ${h}`, swastika(a, right)]);
    positives.push([`Hakenkreuz 5 doppelt skaliert (10 × 10) ${h}`, scale(swastika(2, right), 2)]);
    positives.push([`Hakenkreuz 5 dreifach skaliert (15 × 15) ${h}`, scale(swastika(2, right), 3)]);
    positives.push([`Hakenkreuz 7 doppelt skaliert (14 × 14) ${h}`, scale(swastika(3, right), 2)]);
    positives.push([`Hakenkreuz 7 dreifach skaliert (21 × 21) ${h}`, scale(swastika(3, right), 3)]);
    positives.push([`Hakenkreuz 7 in buntem Umfeld ${h}`, embed(swastika(3, right), 4, (x, z) => 2 + ((x * 7 + z * 13) % 3))]);
    {
      const b = swastika(3, right).map((r) => [...r]);
      b[1]![1] = 2;
      positives.push([`Hakenkreuz 7 + Fremdblock im Hüllrechteck ${h}`, b]);
    }
    {
      const b = embed(swastika(3, right), 2).map((r) => [...r]);
      b[3]![3] = 1; // gleicher Block im Innenwinkel (Toleranz 1)
      positives.push([`Hakenkreuz 7 + gleicher Störblock ${h}`, b]);
    }
    {
      const b = embed(swastika(4, right), 2).map((r) => [...r]);
      b[2 + 4]![2 + 4] = 0; // Mitte fehlt
      positives.push([`Hakenkreuz 9 mit Loch in der Mitte ${h}`, b]);
    }
    {
      const b = swastika(3, right).map((r) => [...r]);
      b[0]![right ? 6 : 0] = 0;
      positives.push([`fast-Hakenkreuz 7 (ein Haken um 1 kürzer) ${h}`, b]);
    }
    {
      const b = swastika(3, right).map((r, z) => r.map((v, x) => (v === 1 && x !== 3 && z !== 3 ? 3 : v)));
      positives.push([`Hakenkreuz 7 zweifarbig (Haken anders) ${h}`, b, (v) => v === 1 || v === 3]);
    }
    {
      const R = lcg(right ? 7 : 11);
      const b = embed(swastika(3, right), 3).map((r) => r.map((v) => (v === 1 ? (R() < 0.5 ? 1 : 3) : v)));
      positives.push([`Hakenkreuz 7 aus zufälliger Steinmischung (Klassen-Maske) ${h}`, b, (v) => v === 1 || v === 3]);
    }
    {
      const b = embed(swastika(3, right), 3);
      for (let z = 0; z < 3; z++) b[z]![6] = 1;
      positives.push([`Hakenkreuz 7, Arm läuft als Weg weiter ${h}`, b]);
    }
    for (const a of [2, 3, 4]) positives.push([`diagonales Hakenkreuz ${4 * a + 1} × ${4 * a + 1} ${h}`, f(diagonal(a))]);
    {
      const b: Bmp = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
      const L = [[0, 0], [1, 0], [2, 0], [0, 1]] as const;
      for (let r = 0; r < 4; r++) {
        for (const [x0, z0] of L) {
          let x = x0 + 1, z = z0 + 1;
          for (let k = 0; k < r; k++) [x, z] = [7 - z, x];
          b[z]![right ? x : 7 - x] = 1 + (r % 2) * 2; // abwechselnd Pflaster (1) und Beet (3)
        }
      }
      positives.push([`4 Winkel aus zwei Materialien (Vereinigung) ${h}`, b, (v) => v === 1 || v === 3]);
    }
  }
  for (const [name, b, on] of positives) {
    it(name, () => {
      expect(hits(b, on)).toBeGreaterThan(0);
    });
  }

  it('Label-Raster: jede Marke einzeln (Figur aus Andesit zwischen Bruchstein)', () => {
    const b = embed(PINWHEEL4, 3, (x, z) => 5 + ((x + z) % 2));
    expect(labelHits(b)).toBeGreaterThan(0);
    const hit = scanLabelGrid(b.flat(), b[0]!.length, b.length).find((h) => h.label === 1)!;
    expect(hit.cells).toHaveLength(8);
    expect(hit.rotDiff).toBe(0);
    expect(hit.mirrorDiff).toBeGreaterThanOrEqual(8);
  });

  it('findPinwheels (Branch-API) sieht jetzt auch 11 × 11 und 13 × 13', () => {
    for (const a of [5, 6]) {
      const b = swastika(a, true);
      expect(findPinwheels((x, z) => b[z]?.[x], { minX: 0, minZ: 0, maxX: b.length - 1, maxZ: b.length - 1 }).length).toBeGreaterThan(0);
    }
  });
});

describe('W8-G Windrad-Detektor: spiegelsymmetrische Gegenproben (kein Fehlalarm)', () => {
  const tcross = swastika(3, true).map((r, z) => r.map((v, x) => v | swastika(3, false)[z]![x]!));
  const ring = (n: number): Bmp => Array.from({ length: n }, (_, z) => Array.from({ length: n }, (_, x) => (x === 0 || z === 0 || x === n - 1 || z === n - 1 ? 1 : 0)));
  const plus = (a: number, t = 1): Bmp => Array.from({ length: 2 * a + 1 }, (_, z) => Array.from({ length: 2 * a + 1 }, (_, x) => (Math.abs(x - a) < t || Math.abs(z - a) < t ? 1 : 0)));
  const checker = (n: number): Bmp => Array.from({ length: n }, (_, z) => Array.from({ length: n }, (_, x) => (x + z) % 2));
  const diamond = (a: number): Bmp => Array.from({ length: 2 * a + 1 }, (_, z) => Array.from({ length: 2 * a + 1 }, (_, x) => (Math.abs(x - a) + Math.abs(z - a) <= a ? 1 : 0)));
  // Tisch 2 × 2 mit Stühlen mittig an allen Seiten; Esstisch 2 × 4 mit 6 Stühlen; 3 × 3-Teppich mit Rand
  const table: Bmp = embed([[0, 2, 2, 0], [2, 1, 1, 2], [2, 1, 1, 2], [0, 2, 2, 0]], 2);
  const dining: Bmp = embed([[0, 2, 2, 2, 2, 0], [2, 1, 1, 1, 1, 2], [2, 1, 1, 1, 1, 2], [0, 2, 2, 2, 2, 0]], 2);
  // Windmühlen-Flügel mit beidseitiger Bespannung (Bestand windmill.test.ts)
  const sails: Bmp = Array.from({ length: 15 }, (_, z) => Array.from({ length: 15 }, (_, x) => {
    const u = x - 7, v = z - 7;
    return u === 0 || v === 0 || (Math.abs(u) === 1 && Math.abs(v) >= 2) || (Math.abs(v) === 1 && Math.abs(u) >= 2) ? 1 : 0;
  }));
  // vier Einzelblöcke (Streu) in Windrad-Stellung: unter der Sichtbarkeitsschwelle
  const specks: Bmp = [[0, 1, 0, 0, 0], [0, 0, 0, 0, 1], [0, 0, 0, 0, 0], [1, 0, 0, 0, 0], [0, 0, 0, 1, 0]];
  // Feldreihen (Beete in Streifen), Doppelkreuz, Quadrat mit Loch
  const rows: Bmp = Array.from({ length: 9 }, (_, z) => Array.from({ length: 9 }, () => (z % 2 === 0 ? 1 : 0)));
  const negatives: Array<[string, Bmp]> = [
    ['Plus 3', plus(1)], ['Plus 7', plus(3)], ['breites Plus 9', plus(4, 2)], ['Ring 5', ring(5)], ['Ring 12', ring(12)],
    ['Schachbrett 6', checker(6)], ['Schachbrett 11', checker(11)], ['T-Kreuz 7 (Haken beidseitig)', tcross], ['Raute 9', diamond(4)],
    ['Tisch mit 4 Stühlen', table], ['Esstisch mit 8 Stühlen', dining], ['Windmühlen-Flügel beidseitig bespannt', sails],
    ['Streu in Windrad-Stellung', specks], ['Feldreihen', rows], ['Quadrat 6 voll', Array.from({ length: 6 }, () => Array<number>(6).fill(1))],
  ];
  for (const [name, b] of negatives) {
    it(name, () => {
      expect(hits(b, (v) => v !== 0)).toBe(0);
      expect(labelHits(b)).toBe(0);
    });
  }

  it('gemischter Hintergrund ohne Figur: Plus in bunter Fläche', () => {
    expect(labelHits(embed(plus(3), 4, (x, z) => 2 + ((x * 7 + z * 13) % 3)))).toBe(0);
  });
});
