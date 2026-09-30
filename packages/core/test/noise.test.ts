import { describe, expect, it } from 'vitest';
import { cellU, clusterU, hash01, pickIndexByU, valueNoise2, type NoiseParams } from '../src/index.js';

const CLUSTER: NoiseParams = { type: 'cluster', scale: 2.5, octaves: 2, dither: 0.08 };
const WHITE: NoiseParams = { type: 'white', scale: 1, octaves: 1, dither: 0 };

/** Material je Zelle einer N×N-Fläche nach Gewichten. */
function field(p: NoiseParams, weights: readonly number[], n: number, seed = 17): number[][] {
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => pickIndexByU(weights, clusterU(seed, x, y, p))));
}

/** Anteil gleicher 4er-Nachbarpaare. */
function sameNeighbours(f: number[][]): number {
  let same = 0;
  let pairs = 0;
  for (let y = 0; y < f.length; y++) {
    for (let x = 0; x < f.length; x++) {
      if (x + 1 < f.length) { pairs++; if (f[y]![x] === f[y]![x + 1]) same++; }
      if (y + 1 < f.length) { pairs++; if (f[y]![x] === f[y + 1]![x]) same++; }
    }
  }
  return same / pairs;
}

describe('Rauschen (research/12 §7.2)', () => {
  it('ist deterministisch und reihenfolgeunabhängig', () => {
    const a = [...Array(50).keys()].map((i) => clusterU(9, i, -i, CLUSTER));
    const b = [...Array(50).keys()].reverse().map((i) => clusterU(9, i, -i, CLUSTER)).reverse();
    expect(a).toEqual(b);
    expect(clusterU(9, 3, 4, CLUSTER)).not.toBe(clusterU(10, 3, 4, CLUSTER));
    expect(hash01(1, -5, 7)).toBe(hash01(1, -5, 7));
  });

  it('Wertrauschen liegt in [0, 1] und ist an Gitterpunkten der Gitterwert', () => {
    for (let i = 0; i < 200; i++) {
      const v = valueNoise2(3, i * 0.7, i * 1.3, 2.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(valueNoise2(3, 5, 10, 5)).toBeCloseTo(hash01(3, 1, 2), 12);
  });

  it('entzerrt: Cluster-Werte sind gleichverteilt (Dezile ± 1,5 %-Punkte über 4 × 128 × 128)', () => {
    for (const p of [CLUSTER, { ...CLUSTER, scale: 1.5, octaves: 1 }, { ...CLUSTER, scale: 4, octaves: 3, dither: 0 }]) {
      const bins = new Array<number>(10).fill(0);
      const n = 128;
      for (const seed of [5, 6, 7, 8]) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) bins[Math.floor(clusterU(seed, x, y, p) * 10)]!++;
      for (const b of bins) expect(Math.abs(b / (4 * n * n) - 0.1), JSON.stringify(p)).toBeLessThan(0.015);
    }
  });

  it('Gewichtstreue: 50/30/15/5 über 4 × 128 × 128 Zellen innerhalb ± 2 %-Punkte, je Fläche ± 4', () => {
    const w = [50, 30, 15, 5];
    const total = [0, 0, 0, 0];
    for (const seed of [1, 2, 3, 4]) {
      const counts = [0, 0, 0, 0];
      for (const row of field(CLUSTER, w, 128, seed)) for (const i of row) counts[i]!++;
      counts.forEach((c, i) => {
        total[i]! += c;
        expect(Math.abs(c / (128 * 128) - w[i]! / 100), `Seed ${seed}, Eintrag ${i}`).toBeLessThan(0.04);
      });
    }
    total.forEach((c, i) => expect(Math.abs(c / (4 * 128 * 128) - w[i]! / 100), `Eintrag ${i}`).toBeLessThan(0.02));
  });

  it('Cluster: Nachbarn sind deutlich häufiger gleich als bei weißem Rauschen', () => {
    const w = [50, 30, 15, 5];
    const cluster = sameNeighbours(field(CLUSTER, w, 96));
    const white = sameNeighbours(field(WHITE, w, 96));
    // Erwartung weiß: Σ p² = 0,365
    expect(white).toBeGreaterThan(0.33);
    expect(white).toBeLessThan(0.40);
    expect(cluster).toBeGreaterThan(white + 0.2);
  });

  it('Streuungs-Index (Zelle weicht von allen 4 Nachbarn ab) < halb so groß wie bei weißem Rauschen', () => {
    const scatter = (f: number[][]): number => {
      let s = 0;
      let n = 0;
      for (let y = 1; y < f.length - 1; y++) {
        for (let x = 1; x < f.length - 1; x++) {
          n++;
          const c = f[y]![x];
          if (c !== f[y]![x - 1] && c !== f[y]![x + 1] && c !== f[y - 1]![x] && c !== f[y + 1]![x]) s++;
        }
      }
      return s / n;
    };
    const w = [50, 30, 15, 5];
    expect(scatter(field(CLUSTER, w, 96))).toBeLessThan(0.5 * scatter(field(WHITE, w, 96)));
    expect(scatter(field(CLUSTER, w, 96))).toBeLessThan(0.15);
  });

  it('pickIndexByU: kumulativ, Gewicht 0 wird nie gewählt', () => {
    expect(pickIndexByU([1, 1], 0.49)).toBe(0);
    expect(pickIndexByU([1, 1], 0.51)).toBe(1);
    expect(pickIndexByU([1, 0, 1], 0.5)).toBe(2);
    expect(pickIndexByU([1, 0], 0.9999)).toBe(0);
    expect(() => pickIndexByU([0, 0], 0.5)).toThrow();
  });
});

// ---------------------------------------------------------------- Zellrauschen (research/30 K1, Blender Voronoi)

const CELLS: NoiseParams = { type: 'cells', cell: 3 };

describe('Zellrauschen `cells`: harte Kanten je Zellkern', () => {
  it('alle Blöcke einer Zelle haben denselben Wert, Nachbarzellen einen anderen', () => {
    const basis = cellU(1, 0, 0, CELLS);
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) expect(cellU(1, dx, dy, CELLS), `${dx},${dy}`).toBe(basis);
    expect(cellU(1, 3, 0, CELLS)).not.toBe(basis);
    // mehr als zwei Zustände über mehrere Zellen (kein Zwei-Zustands-Rauschen)
    expect(new Set([0, 1, 2, 3, 4].map((i) => cellU(1, i * 3, 0, CELLS))).size).toBeGreaterThan(3);
  });

  it('negative Koordinaten und gleiche Eingaben sind deterministisch', () => {
    for (const [x, y] of [[-1, -1], [-3, 5], [7, -8]] as const) expect(cellU(4, x, y, CELLS)).toBe(cellU(4, x, y, CELLS));
    expect(cellU(4, 5, 5, CELLS)).not.toBe(cellU(5, 5, 5, CELLS));
  });

  it('Werte sind gleichverteilt: Flächenanteile bleiben exakt', () => {
    // Große Fläche (10 000 Zellen à 3×3), damit die Zufallsstreuung der Zellkerne klein ist
    const N = 300;
    let unter3 = 0;
    let unter7 = 0;
    let gesamt = 0;
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) {
        const u = cellU(9, x, y, CELLS);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThan(1);
        if (u < 0.3) unter3++;
        if (u < 0.7) unter7++;
        gesamt++;
      }
    }
    expect(unter3 / gesamt).toBeGreaterThan(0.28);
    expect(unter3 / gesamt).toBeLessThan(0.32);
    expect(unter7 / gesamt).toBeGreaterThan(0.68);
    expect(unter7 / gesamt).toBeLessThan(0.72);
  });

  it('größere zusammenhängende Flächen als `cluster` (harte Blöcke statt weicher Flecken)', () => {
    const gleich = (p: NoiseParams): number => {
      let same = 0;
      let n = 0;
      for (let x = 0; x < 40; x++) {
        for (let y = 0; y < 40; y++) {
          if (Math.round(clusterU(3, x, y, p) * 255) === Math.round(clusterU(3, x + 1, y, p) * 255)) same++;
          n++;
        }
      }
      return same / n;
    };
    const zell = gleich({ type: 'cells', cell: 4 });
    const weich = gleich(CLUSTER);
    expect(zell).toBeGreaterThan(weich);
    expect(zell).toBeGreaterThan(0.7);
  });

  it('`white` und `cluster` bleiben unverändert (additiv)', () => {
    for (const [x, y] of [[0, 0], [3, -2], [17, 4]] as const) {
      expect(clusterU(1, x, y, { type: 'white' })).toBe(hash01(1, x, y));
      expect(clusterU(1, x, y, CLUSTER)).toBe(clusterU(1, x, y, { type: 'cluster', scale: 2.5, octaves: 2, dither: 0.08 }));
    }
    expect(clusterU(1, 3, 4, CLUSTER)).not.toBe(cellU(1, 3, 4, CELLS));
  });
});

// ---------------------------------------------------------------- Scherung (research/30 K3, Blender Mapping)

describe('Scherung des Rauschgitters (`shear`)', () => {
  const OHNE: NoiseParams = { type: 'cluster', scale: 3, octaves: 1, dither: 0 };

  it('shear 0 ist bitgleich, shear > 0 ist deterministisch und verschieden', () => {
    for (const [x, y] of [[0, 0], [5, 3], [-7, 11]] as const) {
      expect(clusterU(4, x, y, { ...OHNE, shear: 0 })).toBe(clusterU(4, x, y, OHNE));
    }
    expect(clusterU(4, 5, 3, { ...OHNE, shear: 3 })).toBe(clusterU(4, 5, 3, { ...OHNE, shear: 3 }));
    expect(clusterU(4, 5, 3, { ...OHNE, shear: 3 })).not.toBe(clusterU(4, 5, 3, OHNE));
    expect(clusterU(4, 5, 3, { ...OHNE, shear: 3 })).not.toBe(clusterU(5, 5, 3, { ...OHNE, shear: 3 }));
  });

  it('Anteile bleiben gleichverteilt (die Scherung ist eine Bijektion des Gitters)', () => {
    for (const shear of [0, 3, 8]) {
      const p: NoiseParams = { ...OHNE, shear };
      let unter = 0;
      let n = 0;
      for (let x = 0; x < 120; x++) {
        for (let y = 0; y < 120; y++) {
          if (clusterU(6, x, y, p) < 0.4) unter++;
          n++;
        }
      }
      expect(unter / n, `shear ${shear}`).toBeGreaterThan(0.37);
      expect(unter / n, `shear ${shear}`).toBeLessThan(0.43);
    }
  });

  it('macht das Feld anisotrop: die Ausrichtung am Blockraster fällt weg (gemessen)', () => {
    // Mittlere Differenz zum Nachbarn je Achse: ohne Scherung gleich groß in x und y (isotrop, am Blockraster
    // ausgerichtet), mit Scherung wächst sie in y stark an – das Muster läuft schräg zum Blockgitter.
    const diffs = (shear: number): { x: number; y: number } => {
      const p: NoiseParams = { ...OHNE, shear };
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let x = 0; x < 60; x++) {
        for (let y = 0; y < 60; y++) {
          sx += Math.abs(clusterU(8, x, y, p) - clusterU(8, x + 1, y, p));
          sy += Math.abs(clusterU(8, x, y, p) - clusterU(8, x, y + 1, p));
          n++;
        }
      }
      return { x: sx / n, y: sy / n };
    };
    const ohne = diffs(0);
    const mit = diffs(3);
    expect(ohne.x / ohne.y).toBeCloseTo(1, 1);
    expect(mit.x / mit.y).toBeLessThan(0.5);
    // Beträge bleiben vergleichbar: die Scherung verschiebt Struktur, sie erzeugt kein feineres Rauschen
    expect(mit.x).toBeGreaterThan(ohne.x * 0.85);
    expect(mit.x).toBeLessThan(ohne.x * 1.15);
  });
});
