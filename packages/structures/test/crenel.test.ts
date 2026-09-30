/**
 * feat/tiled-wfc: Zinnenkränze aus dem Tiled-WFC (`StructureOptions.tiled`). Ohne Schalter bleibt alles bitgleich
 * (die übrigen Tests dieses Pakets laufen unverändert ohne Schalter); mit Schalter: deterministisch, keine Verstöße,
 * Ecken Zinnen, an beiden Achsen gespiegelt, kein Windrad.
 */
import { describe, expect, it } from 'vitest';
import { findPinwheels } from '@mcda/core';
import {
  CRENEL_WEIGHTS, buildStructures, crenelViolations, flatGround, floatingCells, palindromePairs, solveCrenels,
  type StructuresInput, type StructuresResult, type TowerTop,
} from '../src/index.js';

const THEMES = Object.keys(CRENEL_WEIGHTS);
const dump = (r: StructuresResult): string => JSON.stringify(r.cells);

/** Draufsicht der Brüstung: 1 = Brüstung, 2 = Zinne, 12 = Zinne mit Deckplatte (Höhe relativ zur Brüstung). */
function topView(r: StructuresResult): Map<string, number> {
  const base = new Map<string, number>();
  for (const c of r.cells) if (c.role === 'parapet') base.set(`${c.pos[0]},${c.pos[2]}`, Math.min(base.get(`${c.pos[0]},${c.pos[2]}`) ?? Infinity, c.pos[1]));
  const out = new Map<string, number>();
  for (const c of r.cells) {
    const k = `${c.pos[0]},${c.pos[2]}`;
    const b = base.get(k);
    if (b === undefined) continue;
    const v = c.role === 'parapet' ? c.pos[1] - b + 1 : c.role === 'wall_cornice' && c.pos[1] === b + 2 ? 12 : 0;
    out.set(k, Math.max(out.get(k) ?? 0, v));
  }
  return out;
}

function pinwheels(view: Map<string, number>): number {
  const xs = [...view.keys()].map((k) => Number(k.split(',')[0]));
  const zs = [...view.keys()].map((k) => Number(k.split(',')[1]));
  return findPinwheels((x, z) => view.get(`${x},${z}`), { minX: Math.min(...xs), minZ: Math.min(...zs), maxX: Math.max(...xs), maxZ: Math.max(...zs) }).length;
}

describe('Zinnen aus dem Tiled-WFC (feat/tiled-wfc)', () => {
  it('Solver: Palindrom je Seite, Ecken Zinnen, keine zwei Scharten nebeneinander', () => {
    for (const n of [5, 6, 9, 12, 17]) {
      for (let seed = 1; seed <= 10; seed++) {
        const mirror = palindromePairs([[0, n - 1]]);
        const tiles = solveCrenels({ n, ring: false, mirror, merlons: [0, n - 1], seed, themeId: THEMES[seed % THEMES.length]! });
        expect(tiles, `n=${n}`).toBeDefined();
        expect(crenelViolations(tiles!, { ring: false, mirror, merlons: [0, n - 1] })).toEqual([]);
        expect(tiles!.join(' ')).not.toMatch(/\bC C\b/);
      }
    }
  });

  for (const shape of ['square', 'round'] as const) {
    for (const corbels of [false, true]) {
      it(`Turm ${shape}${corbels ? ' mit Kragsteinen' : ''}: an beiden Achsen gespiegelt, kein Windrad, deterministisch, Theme wirkt`, () => {
        const patterns = new Set<string>();
        for (const themeId of THEMES) {
          for (const r of [2, 3, 4]) {
            for (let seed = 1; seed <= 3; seed++) {
              const input: StructuresInput = { towers: [{ id: 't', center: [0, 0], shape, size: 2 * r + 1, top: 'battlements' as TowerTop, corbels }] };
              const res = buildStructures(input, { seed, tiled: { themeId } });
              expect(res.tiled?.every((e) => e.ok && e.violations === 0), JSON.stringify(res.tiled)).toBe(true);
              expect(dump(res)).toBe(dump(buildStructures(input, { seed, tiled: { themeId } })));
              const view = topView(res);
              for (const [k, v] of view) {
                const [x, z] = k.split(',').map(Number) as [number, number];
                expect(view.get(`${-x},${z}`), `Spiegel x ${k}`).toBe(v);
                expect(view.get(`${x},${-z}`), `Spiegel z ${k}`).toBe(v);
              }
              if (shape === 'square') {
                const e = Math.max(...[...view.keys()].map((k) => Math.abs(Number(k.split(',')[0]))));
                for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) expect(view.get(`${sx! * e},${sz! * e}`)).toBeGreaterThanOrEqual(2);
              }
              expect(pinwheels(view)).toBe(0);
              expect(floatingCells(res.cells, flatGround())).toEqual([]);
              patterns.add(res.tiled!.map((t) => t.pattern).join('|'));
              // Review F (A3): gleichmäßiger Takt – höchstens zwei Zinnenbreiten je Kranz
              for (const t of res.tiled!) expect(new Set((t.pattern.match(/m|\^|\[\]|\{=\}/g) ?? []).map((m) => (m === '^' ? 'm' : m))).size).toBeLessThanOrEqual(2);
            }
          }
        }
        expect(patterns.size).toBeGreaterThan(4); // regelmäßiger Takt: Vielfalt über Breite und Theme, nicht innerhalb des Kranzes
      });
    }
  }

  it('Wehrplatte (Rechteck) und Mauerzüge (offen und geschlossen): Knicke Zinnen, jede Seite ein Palindrom, kein Windrad', () => {
    for (const themeId of THEMES) {
      for (let seed = 1; seed <= 3; seed++) {
        const cells: [number, number][] = [];
        for (let x = 0; x < 9; x++) for (let z = 0; z < 7; z++) cells.push([x, z]);
        const input: StructuresInput = {
          parapets: [{ id: 'p', cells, y: 8 }],
          walls: [
            { id: 'ring', points: [[20, 0], [44, 0], [44, 20], [20, 20]], closed: true, towers: 'none', gates: [] },
            { id: 'line', points: [[0, 30], [30, 30], [30, 45]], towers: 'none', gates: [] },
          ],
        };
        const res = buildStructures(input, { seed, tiled: { themeId } });
        expect(res.tiled?.map((e) => e.kind).sort()).toEqual(['parapet', 'wall', 'wall']);
        expect(res.tiled?.every((e) => e.ok && e.violations === 0), JSON.stringify(res.tiled)).toBe(true);
        expect(pinwheels(topView(res))).toBe(0);
        // Mauern stehen; die Wehrplatte liegt ohne Haus in der Luft (im Bestand trägt sie die Dachplatte)
        expect(floatingCells(res.cells.filter((c) => !c.roomId?.endsWith(':p')), flatGround())).toEqual([]);
        // Wehrplatte: Rand an beiden Achsen gespiegelt, Ecken Zinnen
        const view = topView(res);
        for (let x = 0; x < 9; x++) for (const z of [0, 6]) expect(view.get(`${x},${z}`)).toBe(view.get(`${8 - x},${z}`));
        for (let z = 0; z < 7; z++) for (const x of [0, 8]) expect(view.get(`${x},${z}`)).toBe(view.get(`${x},${6 - z}`));
        for (const [x, z] of [[0, 0], [8, 0], [0, 6], [8, 6]]) expect(view.get(`${x},${z}`)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('ohne Schalter: kein Bericht, Zellen wie ohne Option (bitgleich)', () => {
    const input: StructuresInput = {
      towers: [{ id: 't', center: [0, 0], shape: 'round', size: 7, top: 'battlements' }],
      walls: [{ id: 'w', points: [[10, 0], [30, 0], [30, 12]], towers: 'auto' }],
    };
    const plain = buildStructures(input, { seed: 4 });
    expect(plain.tiled).toBeUndefined();
    expect(dump(buildStructures(input, { seed: 4, ground: flatGround() }))).toBe(dump(plain));
    expect(dump(buildStructures(input, { seed: 4, tiled: { themeId: 'medieval' } }))).not.toBe(dump(plain));
  });
});
