import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseComponentDef, type ComponentDef } from '@mcda/catalog';
import { Rng, pose, type Quarter, type Vec3 } from '@mcda/core';
import { allowedRotations, expandComponent, occupied, pickVariant, placeComponent, worldDir } from '../src/index.js';

function load(id: string): ComponentDef {
  const file = fileURLToPath(new URL(`../../../catalog/components/${id}.json5`, import.meta.url));
  const r = parseComponentDef(readFileSync(file, 'utf8'), id);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
}

const sortV = (vs: readonly Vec3[]) => [...vs].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

describe('expandComponent', () => {
  it('Stuhl: eine Zelle, Treppe mit Lehne hinten', () => {
    const e = expandComponent(load('seat/chair'));
    expect(e.size).toEqual([1, 1, 1]);
    expect(e.cells).toEqual([{ at: [0, 0, 0], mat: { role: 'furniture_wood', shape: 'stairs', orient: { back: 'back' } } }]);
  });

  it('Bett: Kopfende hinten (z = 0), Fußende vorn (z = 1)', () => {
    const e = expandComponent(load('bed/single'));
    expect(e.size).toEqual([1, 1, 2]);
    expect(e.cells.map((c) => [c.at, c.mat.orient?.part])).toEqual([
      [[0, 0, 0], 'head'],
      [[0, 0, 1], 'foot'],
    ]);
  });

  it('Varianten überschreiben Inhalt und Sockets', () => {
    const table = load('table/small');
    const plate = expandComponent(table, 'fence_plate');
    expect(plate.size).toEqual([1, 2, 1]);
    expect(plate.sockets).toEqual([]);
    const slab = expandComponent(table, 'slab_top');
    expect(slab.size).toEqual([1, 1, 1]);
    expect(slab.sockets.map((s) => s.id)).toEqual(['top']);
    // Basis-Masken gelten für alle Varianten
    expect(slab.masks.use).toEqual([{ side: 'front' }]);
  });

  it('nur-Varianten-Komponenten verlangen eine Variante; pickVariant ist deterministisch und gewichtet', () => {
    const table = load('table/small');
    expect(() => expandComponent(table)).toThrow(/variantId/);
    const pick = (seed: number) => pickVariant(table, new Rng(seed))?.id;
    expect(pick(99)).toBe(pick(99));
    const counts = { fence_plate: 0, slab_top: 0 };
    const rng = new Rng(5);
    for (let i = 0; i < 2000; i++) counts[pickVariant(table, rng)!.id as keyof typeof counts]++;
    // Gewichte 2 : 3 → etwa 40 % / 60 %
    expect(counts.slab_top / 2000).toBeGreaterThan(0.55);
    expect(counts.slab_top / 2000).toBeLessThan(0.65);
  });

  it('Rotationsregeln', () => {
    expect(allowedRotations(load('light/hanging_lantern'))).toEqual([0]);
    expect(allowedRotations(load('bed/single'))).toEqual([0, 1, 2, 3]);
  });
});

describe('placeComponent', () => {
  it('Bett um 90° gedreht: Kopfende zeigt nach Osten, Sockets drehen mit', () => {
    const bed = expandComponent(load('bed/single'));
    const placed = placeComponent(bed, pose([10, 64, 10], 1));
    expect(placed.size).toEqual([2, 1, 1]);
    const head = placed.cells.find((c) => c.mat.orient?.part === 'head')!;
    const foot = placed.cells.find((c) => c.mat.orient?.part === 'foot')!;
    expect(head.pos).toEqual([11, 64, 10]);
    expect(foot.pos).toEqual([10, 64, 10]);
    expect(worldDir(placed, 'back')).toBe('east'); // Kopfende = Rückseite
    const left = placed.sockets.find((s) => s.def.id === 'nightstand_l')!;
    expect(left.side).toBe('south');
    // der linke Nachttisch liegt direkt in Richtung „links“ neben dem Kopfende
    expect(left.pos).toEqual([11, 64, 11]);
  });

  it('für jede Drehung/Spiegelung: Sockets liegen auf der Seite, die `side` angibt', () => {
    const bed = expandComponent(load('bed/single'));
    const step = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] } as const;
    for (const rot of [0, 1, 2, 3] as Quarter[]) {
      for (const mirror of ['none', 'x', 'z'] as const) {
        const placed = placeComponent(bed, pose([0, 0, 0], rot, mirror));
        const head = placed.cells.find((c) => c.mat.orient?.part === 'head')!.pos;
        // W3 (27.09.2026): das Einzelbett hat zusätzlich den Hänge-Andockpunkt `lamp` (ohne Seite) – geprüft werden die Nachttische
        for (const s of placed.sockets.filter((x) => x.def.type === 'adjacent')) {
          const d = step[s.side as keyof typeof step];
          expect(s.pos, `${s.def.id} rot=${rot} mirror=${mirror}`).toEqual([head[0] + d[0], head[1] + d[1], head[2] + d[2]]);
        }
      }
    }
  });

  it('Belegung und Größe bleiben unter Drehung erhalten', () => {
    const table = expandComponent(load('table/small'), 'fence_plate');
    for (const rot of [0, 1, 2, 3] as Quarter[]) {
      const placed = placeComponent(table, pose([5, 70, -3], rot));
      expect(sortV(occupied(placed))).toEqual([
        [5, 70, -3],
        [5, 71, -3],
      ]);
    }
  });
});
