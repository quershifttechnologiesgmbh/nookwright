/**
 * Kennzahlen L1–L3 (research/58 §4, Q3): reine Funktionen, deshalb hier mit synthetischen Mustern **und** mit
 * einem echten Gelände-Ergebnis geprüft. Die Zahlen der Abnahme (vorher/nachher) stehen im Bericht
 * `plan/spikes/Q3_landschaft.md` und im Messwerkzeug `spikes/q3_landschaft.ts`, nicht in diesem Test.
 */
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import {
  FLOWER_ROLES, L1_TARGET, L2_TARGETS, L2_ZONES, L3_MIN_SPREAD, catalogObjectRates, catalogObjectRatesByKind, classifyName,
  columnClass, flowerClusterCoefficient, flowerSamples, l2Misses, l3Misses, landscapeShares, shareDistance, shareSpread, styleDistances,
  type FlowerSample, type LandscapeShares,
} from '../src/quality-l.js';
import { ZONE_KINDS } from '../src/model.js';
import { generateSite } from '../src/generate.js';
import { TEST_STYLE, fullSite, syntheticBuilding } from './fixtures.js';

/** Blumenmuster aus einer Spezies-Matrix (Punkt = keine Blume). */
function pattern(rows: readonly string[]): FlowerSample[] {
  const out: FlowerSample[] = [];
  rows.forEach((row, z) => [...row].forEach((ch, x) => {
    if (ch !== '.') out.push({ x, z, species: ch });
  }));
  return out;
}

describe('L1 Cluster-Koeffizient der Blumen', () => {
  it('zählt nur Nachbarn derselben Art im Chebyshev-Radius 1 (ohne die eigene Spalte)', () => {
    // Zwei Blumen derselben Art direkt nebeneinander → beide haben einen Nachbarn.
    expect(flowerClusterCoefficient(pattern(['aa']))).toBe(1);
    // Eine Zelle dazwischen: mit Radius 1 kein Nachbar, mit Radius 2 schon.
    expect(flowerClusterCoefficient(pattern(['a.a']))).toBe(0);
    expect(flowerClusterCoefficient(pattern(['a.a']), 2)).toBe(1);
    // Drei Zellen Abstand: auch mit Radius 2 kein Nachbar.
    expect(flowerClusterCoefficient(pattern(['a..a']), 2)).toBe(0);
    // Fremde Arten nebeneinander sind kein Cluster.
    expect(flowerClusterCoefficient(pattern(['ab']))).toBe(0);
  });

  it('unterscheidet Konfetti von Clustern mit dichtem Kern und ausgedünntem Rand', () => {
    const cluster = pattern([
      '..a..',
      '.aaa.',
      'aaaaa',
      '.aaa.',
      '..a..',
    ]);
    const confetti = pattern([
      'a.b.c',
      '.d.e.',
      'f.g.h',
      '.i.j.',
      'k.l.m',
    ]);
    expect(flowerClusterCoefficient(cluster)).toBeGreaterThanOrEqual(L1_TARGET);
    expect(flowerClusterCoefficient(cluster)).toBe(1);
    expect(flowerClusterCoefficient(confetti)).toBe(0);
    // Ohne Blumen ist das Ziel nicht erfüllt (kein Cluster).
    expect(flowerClusterCoefficient([])).toBe(0);
  });

  it('misst im echten Gelände die Blumen-Rollen und liefert einen Anteil in 0 … 1', { timeout: HEAVY_TIMEOUT }, () => {
    const res = generateSite(fullSite(5).state, TEST_STYLE, syntheticBuilding());
    const flowers = flowerSamples(res.cells);
    expect(flowers.length).toBeGreaterThan(0);
    expect(flowers.every((f) => FLOWER_ROLES.has(f.species))).toBe(true);
    const l1 = flowerClusterCoefficient(flowers);
    expect(l1).toBeGreaterThanOrEqual(0);
    expect(l1).toBeLessThanOrEqual(1);
  });
});

describe('L2 Katalog-Objekte je 100 Geländezellen', () => {
  it('rechnet die Rate je Zone und je Zonenart', () => {
    const areas = [
      { zoneId: 'z1', kind: 'yard' as const, cells: 50 },
      { zoneId: 'z2', kind: 'yard' as const, cells: 50 },
      { zoneId: 'z3', kind: 'field' as const, cells: 200 },
    ];
    const objects = [
      { zoneId: 'z1' }, { zoneId: 'z1' }, { zoneId: 'z1' }, { zoneId: 'z2' }, { zoneId: 'z2' }, { zoneId: 'z2' },
      { zoneId: 'z3' }, { zoneId: 'z3' },
    ];
    const rates = catalogObjectRates(areas, objects);
    expect(rates.map((r) => r.zoneId)).toEqual(['z1', 'z2', 'z3']);
    expect(rates[0]!.per100).toBe(6);
    expect(rates[2]!.per100).toBe(1);
    const byKind = catalogObjectRatesByKind(rates);
    expect(byKind.get('yard')!.per100).toBe(6);
    expect(byKind.get('field')!.objects).toBe(2);
    expect(l2Misses(byKind)).toEqual([]); // 6/100 liegt im Hofband 6–8, 1/100 im Feldband 1–2
    const tooThin = catalogObjectRatesByKind(catalogObjectRates([{ zoneId: 'z9', kind: 'garden', cells: 100 }], []));
    expect(l2Misses(tooThin)).toEqual(['garden 0.00/100 außerhalb 3–5']);
  });

  it('hat für jede Zonenart ein Zielband', () => {
    expect([...L2_ZONES].sort()).toEqual([...ZONE_KINDS].sort());
    for (const kind of ZONE_KINDS) {
      const t = L2_TARGETS[kind];
      expect(t.min).toBeGreaterThan(0);
      expect(t.max).toBeGreaterThanOrEqual(t.min);
    }
  });
});

describe('L3 Unterschied der Geländestile', () => {
  it('klassifiziert Rollen und Blocknamen gleich', () => {
    expect(classifyName('flower_wild')).toBe('flower');
    expect(classifyName('minecraft:poppy')).toBe('flower');
    expect(classifyName('log_oak')).toBe('tree');
    expect(classifyName('minecraft:oak_leaves')).toBe('tree');
    expect(classifyName('leaves_bush')).toBe('tree');
    expect(classifyName('water')).toBe('water');
    expect(classifyName('minecraft:andesite')).toBe('rock');
    expect(classifyName('minecraft:mossy_cobblestone')).toBe('rock');
    expect(classifyName('minecraft:short_grass')).toBeUndefined();
    expect(classifyName('minecraft:cobblestone_wall')).toBe('rock');
  });

  it('nimmt je Spalte die höchste Klasse (Wasser > Fels > Baum > Blume)', () => {
    expect(columnClass(['ground_grass', 'flower_wild'])).toBe('flower');
    expect(columnClass(['minecraft:andesite', 'minecraft:stone', 'flower_wild'])).toBe('rock');
    expect(columnClass(['water', 'ground_stone'])).toBe('water');
    expect(columnClass(['ground_grass', 'ground_dirt'])).toBeUndefined();
  });

  it('rechnet Anteile, Distanz und größten Klassenunterschied; die Schwelle bedeutet ≥ 10 Prozentpunkte', () => {
    const five = (names: readonly string[]): LandscapeShares => landscapeShares([names, [], [], [], []]);
    const a = landscapeShares([['water'], ['water'], [], [], []]);
    const b = landscapeShares([['minecraft:andesite'], ['minecraft:andesite'], [], [], []]);
    expect(a.water).toBeCloseTo(0.4, 6);
    expect(b.rock).toBeCloseTo(0.4, 6);
    expect(shareDistance(a, b)).toBeCloseTo(0.8, 6);
    expect(shareDistance(a, a)).toBe(0);
    expect(shareSpread(a, b)).toBeCloseTo(0.4, 6); // eine Klasse (Wasser/Fels) unterscheidet sich um 0,4
    expect(L3_MIN_SPREAD).toBe(0.1);
    const pairs = styleDistances(new Map<string, LandscapeShares>([['flach', a], ['fels', b]]));
    expect(pairs).toEqual([{ a: 'fels', b: 'flach', distance: 0.8, spread: 0.4 }]);
    expect(l3Misses(pairs)).toEqual([]);
    // 1 von 10 Spalten Wasser gegen 0 → größter Klassenunterschied 0,1 (erfüllt die Schwelle genau).
    const ten = (names: readonly string[]): LandscapeShares => landscapeShares([names, [], [], [], [], [], [], [], [], []]);
    expect(l3Misses(styleDistances(new Map<string, LandscapeShares>([['x', ten(['water'])], ['y', ten([])]])))).toEqual([]);
    // 1 von 20 Spalten Wasser gegen 0 → 0,05 < 0,1 (nicht deutlich verschieden).
    const twenty = (names: readonly string[]): LandscapeShares => landscapeShares(Array.from({ length: 20 }, (_, i) => (i === 0 ? names : [])));
    expect(l3Misses(styleDistances(new Map<string, LandscapeShares>([['x', twenty(['water'])], ['y', twenty([])]]))))
      .toEqual(['x ↔ y: größter Klassenunterschied 0.050 < 0.1']);
  });
});
