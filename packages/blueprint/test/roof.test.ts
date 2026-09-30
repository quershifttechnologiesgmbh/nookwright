/** Walmdach: Tests aus Spike T4 (spikes/algorithms/tests/roof.test.ts), auf blueprint/shell/roof.ts umgestellt. */
import { describe, expect, it } from 'vitest';
import { STEP } from '../src/shell/grid.js';
import { chebyshevDT, hipRoof, renderHeights, renderRoof, stairQuarters, upsample2, vanillaStairShape, type HipRoof } from '../src/shell/roof.js';
import { SHAPES, at, lcg, pad, randomFootprint, rectMask, type Mask } from './support/masks.js';
import { euclideanHeights, rasterize, skeletonHeights, stepLoop, traceLoops } from './support/skeleton.js';

const roofOf = (g: Mask, overhang = 0): HipRoof => hipRoof(g.m, g.w, g.d, overhang);
const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

function chebyshevBrute(g: Mask): Int32Array {
  const out = new Int32Array(g.w * g.d);
  for (let z = 0; z < g.d; z++)
    for (let x = 0; x < g.w; x++) {
      if (!g.m[z * g.w + x]) continue;
      let best = Infinity;
      for (let oz = -1; oz <= g.d; oz++)
        for (let ox = -1; ox <= g.w; ox++) if (!at(g, ox, oz)) best = Math.min(best, Math.max(Math.abs(ox - x), Math.abs(oz - z)));
      out[z * g.w + x] = best;
    }
  return out;
}

function skeletonMismatches(g: Mask): number {
  const d = chebyshevDT(g.m, g.w, g.d);
  const s = skeletonHeights(g);
  let bad = 0;
  for (let i = 0; i < g.m.length; i++) if (g.m[i] && s[i] !== d[i]! - 0.5) bad++;
  return bad;
}

const classCount = (g: Mask): Record<string, number> => {
  const c: Record<string, number> = {};
  for (const cell of roofOf(pad(g, 1)).cells) if (cell) c[cell.cls] = (c[cell.cls] ?? 0) + 1;
  return c;
};

describe('Chebyshev-Walmdach', () => {
  it('Zwei-Pass-DT == Brute-Force', () => {
    const rnd = lcg(1);
    for (let i = 0; i < 100; i++) {
      const g = randomFootprint(rnd);
      expect([...chebyshevDT(g.m, g.w, g.d)]).toEqual([...chebyshevBrute(g)]);
    }
  });

  it('Rechteck: Höhenkarte + First', () => {
    const r = roofOf(pad(rectMask(7, 5), 1));
    expect(renderHeights(r.dist, r.w, r.d)).toBe(['.........', '.1111111.', '.1222221.', '.1233321.', '.1222221.', '.1111111.', '.........'].join('\n'));
    expect(renderRoof(r)).toBe(['.........', '.ovvvvvo.', '.>ovvvo<.', '.>>===<<.', '.>o^^^o<.', '.o^^^^^o.', '.........'].join('\n'));
  });

  it('Eigenschaft: 8-Nachbarn unterscheiden sich um höchstens 1, Rand hat d = 1', () => {
    const rnd = lcg(2);
    for (let i = 0; i < 100; i++) {
      const r = roofOf(pad(randomFootprint(rnd), 3), i % 3);
      for (let z = 0; z < r.d; z++)
        for (let x = 0; x < r.w; x++) {
          const v = r.dist[z * r.w + x]!;
          if (!v) continue;
          let touchesOutside = false;
          for (const [dx, dz] of N8) {
            const n = r.dist[(z + dz) * r.w + x + dx] ?? 0;
            expect(Math.abs(n - v)).toBeLessThanOrEqual(1);
            if (n === 0) touchesOutside = true;
          }
          expect(v === 1).toBe(touchesOutside);
        }
    }
  });

  it('Eigenschaft: Fläche hat eine eindeutige Abwärtsrichtung; Nachbar dort nie höher, fast immer genau 1 tiefer', () => {
    const rnd = lcg(4);
    let slopes = 0;
    let exact = 0;
    for (let i = 0; i < 100; i++) {
      const r = roofOf(pad(randomFootprint(rnd), 1));
      r.cells.forEach((c, idx) => {
        if (!c || c.cls !== 'slope') return;
        expect(c.options).toHaveLength(1);
        slopes++;
        const x = idx % r.w;
        const z = Math.floor(idx / r.w);
        const up = STEP[c.options[0]!.facing];
        const dn = r.dist[(z - up[1]) * r.w + x - up[0]]!;
        expect(dn).toBeLessThanOrEqual(c.d);
        if (dn === c.d - 1) exact++;
        expect(r.dist[(z + up[1]) * r.w + x + up[0]]!).toBeGreaterThanOrEqual(c.d);
      });
    }
    expect(exact / slopes).toBeGreaterThan(0.99);
  });

  it('konkave Ecken erzeugen Kehlen, konvexe Grate', () => {
    expect(classCount(SHAPES.L!).valley).toBeGreaterThanOrEqual(1);
    expect(classCount(SHAPES.T!).valley).toBeGreaterThanOrEqual(2);
    expect(classCount(SHAPES.U!).valley).toBeGreaterThanOrEqual(2);
    expect(classCount(SHAPES.plus!).valley).toBe(4);
    expect(classCount(SHAPES.ring!).valley).toBe(4);
    expect(classCount(SHAPES.rect_9x5!).valley).toBeUndefined();
    expect(classCount(SHAPES.rect_9x5!).hip).toBe(8);
  });

  it('Ring: Innenhof bleibt offen, Dach fällt zum Hof hin ab', () => {
    expect(renderRoof(roofOf(pad(SHAPES.ring!, 1)))).toBe(
      [
        '.............',
        '.ovvvvvvvvvo.',
        '.>=========<.',
        '.>=x^^^^^x=<.',
        '.>=<.....>=<.',
        '.>=<.....>=<.',
        '.>=<.....>=<.',
        '.>=xvvvvvx=<.',
        '.>=========<.',
        '.o^^^^^^^^^o.',
        '.............',
      ].join('\n'),
    );
  });

  it('Überstand verschiebt nur (innen gleiches t), schließt aber Spalten ≤ 2·Überstand', () => {
    for (const name of ['L', 'T', 'U', 'plus', 'ring', 'H']) {
      const g = pad(SHAPES[name]!, 2);
      const r0 = roofOf(g, 0);
      const r1 = roofOf(g, 1);
      for (let i = 0; i < g.m.length; i++) if (g.m[i]) expect(r1.cells[i]!.t).toBe(r0.cells[i]!.t);
    }
    const g = pad(SHAPES.U_narrow_gap!, 2);
    const r0 = roofOf(g, 0);
    const r1 = roofOf(g, 1);
    expect(r1.mask[2 * g.w + 5 + 2]).toBe(1); // Spalt bei (5, 0) überdacht
    let changed = 0;
    for (let i = 0; i < g.m.length; i++) if (g.m[i] && r1.cells[i]!.t !== r0.cells[i]!.t) changed++;
    expect(changed).toBeGreaterThan(0);
  });
});

describe('Verifikation gegen unabhängige Straight-Skeleton-Simulation', () => {
  for (const [name, g] of Object.entries(SHAPES)) {
    it(`${name}: Skelett-Höhe an jeder Zellmitte == d − ½`, () => {
      expect(skeletonMismatches(pad(g, 1))).toBe(0);
    });
  }

  it('150 zufällige rektilineare Grundrisse (mit Innenhöfen): keine Abweichung', () => {
    const rnd = lcg(7);
    for (let i = 0; i < 150; i++) expect(skeletonMismatches(randomFootprint(rnd))).toBe(0);
  });

  it('Kontrolle: euklidische Distanz weicht an Innenecken ab (Test ist trennscharf)', () => {
    const L = pad(SHAPES.L!, 1);
    const e = euclideanHeights(L);
    const d = chebyshevDT(L.m, L.w, L.d);
    let diff = 0;
    for (let i = 0; i < L.m.length; i++) if (L.m[i] && Math.abs(e[i]! - (d[i]! - 0.5)) > 1e-9) diff++;
    expect(diff).toBeGreaterThan(0);
  });

  it('Kontrolle: Wellenfront-Fläche folgt A(t) = A − P·t + (k_konvex − k_reflex)·t²', () => {
    const areaAfterHalfStep = (g: Mask): number => {
      const r = { w: 2 * g.w, d: 2 * g.d, m: upsample2(g.m, g.w, g.d) };
      return rasterize(traceLoops(r).map(stepLoop), r.w, r.d).m.reduce((s, v) => s + v, 0) / 4;
    };
    expect(areaAfterHalfStep(pad(SHAPES.L!, 1))).toBe(39); // 55 − 17 + 1
    expect(areaAfterHalfStep(pad(SHAPES.ring!, 1))).toBe(56); // 84 − 28 + 0
  });
});

describe('Dachtreppen gegen die Vanilla-Treppenregel (update-stabil)', () => {
  const stableShapes = ['rect_9x5', 'rect_8x6', 'L', 'T', 'U', 'U_narrow_gap', 'plus', 'ring', 'ring_thick_small_court', 'staircase', 'H'];
  for (const name of stableShapes) {
    for (const overhang of [0, 1]) {
      it(`${name} (Überstand ${overhang}): Vanilla ergibt überall die Soll-Form`, () => {
        const r = roofOf(pad(SHAPES[name]!, overhang + 1), overhang);
        expect(r.unstable).toEqual([]);
        r.cells.forEach((c, i) => {
          if (!c || c.options.length === 0) return;
          const o = c.options[r.choice[i]!]!;
          const want = c.cls === 'slope' ? 'straight' : c.cls === 'hip' ? 'outer' : c.cls === 'valley' ? 'inner' : '?';
          expect(o.shape.startsWith(want)).toBe(true);
          expect(stairQuarters(o.facing, vanillaStairShape(r.cells, r.choice, r.w, r.d, i))).toBe(c.high);
        });
      });
    }
  }

  it('1er-Treppenstufen: höchstens 2 Treppen nicht update-stabil (bekannte Grenze)', () => {
    expect(roofOf(pad(SHAPES.staircase_1!, 1)).unstable.length).toBeLessThanOrEqual(2);
  });

  it('Zufallsgrundrisse: < 0,1 % der Dachtreppen nicht update-stabil', () => {
    const rnd = lcg(3);
    let stairs = 0;
    let unstable = 0;
    for (let i = 0; i < 100; i++) {
      const r = roofOf(pad(randomFootprint(rnd), 2), i % 2);
      stairs += r.cells.filter((c) => c !== undefined && c.options.length > 0).length;
      unstable += r.unstable.length;
    }
    expect(unstable / stairs).toBeLessThan(0.001);
  });
});
