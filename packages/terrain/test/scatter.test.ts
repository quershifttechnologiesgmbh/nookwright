/**
 * Streuungsregeln (research/30 K6): harte Schwelle VOR dem Zufallszug, garantiert freie Stellen, Mindestabstand.
 * Kern der Nutzerkritik „Blumen wie Konfetti" und „die Wege müssen frei bleiben".
 */
import { Rng } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { clusterSpots, poissonDisk } from '../src/vegetation.js';

/** Deterministische Kandidatenfläche 40×40. */
const cands: Array<readonly [number, number]> = [];
for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) cands.push([x, z]);

describe('poissonDisk: Schwelle und garantierte Lücken', () => {
  it('ohne Optionen bitgleich zu vorher (keine zusätzliche Zufallszahl)', () => {
    const a = poissonDisk(cands, 3, new Rng(7), () => true);
    const b = poissonDisk(cands, 3, new Rng(7), () => true, [], {});
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(50);
  });

  it('threshold 1 ⇒ nichts; mittlere Schwelle dünnt monoton aus', () => {
    const count = (min: number): number =>
      poissonDisk(cands, 3, new Rng(7), () => true, [], { threshold: (x, z) => ((x * 7 + z * 13) % 100) / 100, min }).length;
    const ohne = count(0);
    const mittel = count(0.5);
    const alles = count(1);
    expect(alles).toBe(0);
    expect(mittel).toBeLessThan(ohne);
    expect(mittel).toBeGreaterThan(0);
  });

  it('keepFree: diese Zellen bleiben frei, auch bei voller Dichte', () => {
    const frei = (x: number, z: number): boolean => x < 5;
    const p = poissonDisk(cands, 1, new Rng(3), () => true, [], { keepFree: frei });
    expect(p.length).toBeGreaterThan(0);
    expect(p.some(([x]) => x < 5)).toBe(false);
    expect(p.every(([x]) => x >= 5)).toBe(true);
  });

  it('Mindestabstand wird nie unterschritten, `taken` zählt mit', () => {
    const taken: Array<readonly [number, number]> = [[20, 20]];
    const p = poissonDisk(cands, 4, new Rng(11), () => true, taken);
    const alle = [...taken, ...p];
    for (let i = 0; i < alle.length; i++) {
      for (let j = i + 1; j < alle.length; j++) {
        const dx = alle[i]![0] - alle[j]![0];
        const dz = alle[i]![1] - alle[j]![1];
        expect(Math.sqrt(dx * dx + dz * dz), `${alle[i]} / ${alle[j]}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('deterministisch: gleicher Seed ⇒ gleiche Punkte', () => {
    const a = poissonDisk(cands, 3, new Rng(5), (x) => x % 2 === 0);
    const b = poissonDisk(cands, 3, new Rng(5), (x) => x % 2 === 0);
    expect(b).toEqual(a);
  });
});

describe('clusterSpots: Kerne mit höherer Dichte, ausgedünnter Rand (Q3)', () => {
  it('belegt nur Kandidatenzellen, jede höchstens einmal, und ist deterministisch', () => {
    const opts = { radius: [2, 3] as const, core: 1, edge: 0.35 };
    const a = clusterSpots(cands, 6, new Rng(4), opts);
    const b = clusterSpots(cands, 6, new Rng(4), opts);
    expect(b).toEqual(a);
    const seen = new Set(a.map((p) => `${p.x},${p.z}`));
    expect(seen.size).toBe(a.length);
    expect(a.every((p) => p.x >= 0 && p.x < 40 && p.z >= 0 && p.z < 40)).toBe(true);
    expect(a.length).toBeGreaterThan(40);
  });

  it('Kern ist dichter als der Rand: in Radius 1 sitzt fast jede Zelle, am Rand deutlich weniger', () => {
    const spots = clusterSpots(cands, 8, new Rng(9), { radius: [3, 3], core: 1, edge: 0.2 });
    const byCenter = new Map<string, { core: number; edge: number }>();
    for (const s of spots) {
      const k = `${s.centerX},${s.centerZ}`;
      const e = byCenter.get(k) ?? { core: 0, edge: 0 };
      if (Math.max(Math.abs(s.x - s.centerX), Math.abs(s.z - s.centerZ)) <= 1) e.core++;
      else e.edge++;
      byCenter.set(k, e);
    }
    expect(byCenter.size).toBeGreaterThan(3);
    const cores = [...byCenter.values()].map((e) => e.core);
    const edges = [...byCenter.values()].map((e) => e.edge);
    // Kern: alle 9 Zellen des 3×3-Kerns (Kern + 8 Nachbarn; am Rand der Fläche weniger) sind meist besetzt.
    expect(Math.min(...cores)).toBeGreaterThanOrEqual(3);
    // Rand: im Mittel deutlich dünner als der Kern (9 Zellen gegen 16 Randzellen bei core 1 / edge 0,2).
    const meanEdge = edges.reduce((a, b) => a + b, 0) / edges.length;
    expect(meanEdge).toBeLessThan(0.5 * (cores.reduce((a, b) => a + b, 0) / cores.length));
  });

  it('respektiert keepFree über die Poisson-Zentren (Wege bleiben frei)', () => {
    const spots = clusterSpots(cands, 5, new Rng(2), { radius: [1, 2], core: 1, edge: 0.5 }, () => true, [], { keepFree: (x) => x < 6 });
    expect(spots.length).toBeGreaterThan(0);
    // Der Kern kann in die Nähe eines Zentrums reichen, aber kein Zentrum liegt im Freihaltebereich.
    expect(spots.every((s) => s.centerX >= 6)).toBe(true);
  });
});
