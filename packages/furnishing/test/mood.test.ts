/**
 * feat/theme-moods – Stimmung im Einrichtungs-Solver: ohne Stimmung derselbe Pfad (bitgleich), neutrale Faktoren genau
 * 1, Lexika zeigen in die richtige Richtung, Spiegelpaar-Anteil, Determinismus und harte Regeln mit Stimmung.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Catalog, parseComponentDef, parseRoomTypeDef } from '@mcda/catalog';
import { CellSet, isNeutralMood, mergeMood, moodLever, type MoodVector } from '@mcda/core';
import { furnishRoom, type RoomGeometry } from '../src/index.js';
import { mirrorShare, moodWeights, solverMood } from '../src/mood.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json5') ? [p] : [];
  });
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T => {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
};
const catalog = Catalog.of(
  walk(join(ROOT, 'components')).map((f) => unwrap(parseComponentDef(readFileSync(f, 'utf8'), f))),
  walk(join(ROOT, 'roomtypes')).map((f) => unwrap(parseRoomTypeDef(readFileSync(f, 'utf8'), f))),
);
const DV = 4671;

const room = (w: number, d: number): RoomGeometry => ({
  roomId: 'r1', baseY: 1, height: 4, interior: CellSet.rect(0, 0, w - 1, d - 1),
  doors: [{ inside: [Math.floor(w / 2), d - 1], toward: 'south', isMain: true }],
  windows: [{ inside: [Math.floor(w / 2), 0], toward: 'north' }],
});
const run = (rt: string, seed: number, mood?: MoodVector) =>
  furnishRoom(room(9, 7), catalog.roomType(rt), catalog, { seed, dataVersion: DV, ...(mood !== undefined ? { mood } : {}) });
const sig = (r: ReturnType<typeof run>): string => JSON.stringify(r.placements);

describe('Stimmung: Vektor und Hebel (@mcda/core)', () => {
  it('Hebel bei 0 genau 1, symmetrisch in Faktoren; Werte begrenzt; neutral erkannt', () => {
    expect(moodLever(0, 5)).toBe(1);
    expect(moodLever(1, 1) * moodLever(-1, 1)).toBeCloseTo(1, 12);
    expect(mergeMood({ wear: 3, richness: -0.5 }, { richness: 0.25 })).toEqual({ wear: 1, richness: 0.25 });
    expect(isNeutralMood({})).toBe(true);
    expect(isNeutralMood({ wear: 0 })).toBe(true);
    expect(isNeutralMood({ organic: 0.25 })).toBe(false);
  });
});

describe('Stimmung im Solver', () => {
  it('ohne Stimmung: kein Solver-Objekt, Gewichte sind dasselbe Objekt', () => {
    const W = { row: 3, focal: 2 } as const;
    expect(solverMood(undefined)).toBeUndefined();
    expect(moodWeights(W, undefined)).toBe(W);
  });

  it('neutrale Stimmung: alle Faktoren genau 1, Stil- und Varianten-Vorliebe neutral, kein Spiegelterm', () => {
    const m = solverMood({})!;
    expect(Object.values(m.weights).every((f) => f === 1)).toBe(true);
    expect([m.decor, m.density, m.window]).toEqual([1, 1, 1]);
    expect(m.style({ styleTags: ['noble', 'cozy', 'ruin'] })).toBe(0);
    expect(m.variant('grand')).toBe(1);
    expect(m.mirror === 0).toBe(true);
  });

  it('Richtungen: üppig mehr Deko, symmetrisch stärkere Reihen, repräsentativ noble Möbel, verwittert Ruinen-Möbel', () => {
    expect(solverMood({ richness: 1 })!.decor).toBeGreaterThan(1.5);
    expect(solverMood({ richness: -1 })!.decor).toBeLessThan(0.6);
    expect(solverMood({ organic: -1 })!.weights['row']).toBe(2);
    expect(solverMood({ organic: 1 })!.weights['variety']).toBe(2);
    expect(solverMood({ organic: -1 })!.mirror).toBeGreaterThan(0);
    expect(solverMood({ formality: 1 })!.style({ styleTags: ['noble'] })).toBeGreaterThan(0);
    expect(solverMood({ formality: 1 })!.style({ styleTags: ['cozy'] })).toBeLessThan(0);
    expect(solverMood({ wear: 1 })!.style({ styleTags: ['ruin'] })).toBeGreaterThan(0);
    expect(solverMood({ richness: 1 })!.variant('full')).toBeGreaterThan(1);
    expect(solverMood({ richness: -1 })!.variant('full')).toBeLessThan(1);
  });

  it('Spiegelpaar-Anteil: gespiegelte Grundfläche = 1, sonst 0', () => {
    const b = { minX: 0, maxX: 8, minZ: 0, maxZ: 6 };
    expect(mirrorShare([[1, 2], [1, 3]], new Set(['7,2', '7,3']), b)).toBe(1);
    expect(mirrorShare([[1, 2]], new Set(['6,2']), b)).toBe(0);
    expect(mirrorShare([[1, 2]], new Set(), b)).toBe(0);
  });

  it('Stimmung ändert die Einrichtung, bleibt deterministisch und hält harte Regeln (keine Pflicht-Warnung)', () => {
    for (const rt of ['bedroom', 'kitchen', 'tavern', 'chapel']) {
      if (!catalog.roomTypeIds().includes(rt)) continue;
      const plain = run(rt, 7);
      for (const mood of [{ richness: 1, organic: -1 }, { richness: -1, formality: 1, wear: 1 }] as const) {
        const a = run(rt, 7, mood);
        expect(sig(a)).toBe(sig(run(rt, 7, mood)));
        expect(a.warnings.filter((w) => w.includes('Pflicht')), rt).toEqual(plain.warnings.filter((w) => w.includes('Pflicht')));
      }
    }
  });

  it('Deko-Budget folgt der Achse karg ↔ üppig (Summe über Seeds)', () => {
    const decor = (mood: MoodVector): number => {
      let n = 0;
      for (let seed = 1; seed <= 6; seed++) {
        n += run('bedroom', seed, mood).placements.filter((p) => ['decor', 'attachment'].includes(catalog.get(p.componentId).category)).length;
      }
      return n;
    };
    expect(decor({ richness: 1 })).toBeGreaterThan(decor({ richness: -1 }));
  });
});
