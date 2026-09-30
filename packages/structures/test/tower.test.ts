import { describe, expect, it } from 'vitest';
import { buildTowerStructure, flatGround, floatingCells, footprintOffsets, type HeightField } from '../src/index.js';
import { cellMap, dump, key, reachShare } from './support.js';

const ground = flatGround();

describe('Freistehende Türme', () => {
  for (const shape of ['round', 'square'] as const) {
    for (const top of ['roof', 'battlements'] as const) {
      it(`${shape} · ${top}: steht, ist erreichbar und hat alle Geschosse`, () => {
        const res = buildTowerStructure({ center: [0, 0], shape, top, levels: 3 });
        const t = res.towers[0]!;
        expect(res.warnings).toEqual([]);
        expect(floatingCells(res.cells, ground)).toEqual([]);
        expect(t.floors).toEqual([0, 4, 8, 12]);
        expect(t.door).toBeDefined();
        // Tür: zwei Hälften, darunter die Bodenplatte, davor eine Vortreppe zum Gelände
        const m = cellMap(res.cells);
        const [dx, , dz] = t.door!.pos;
        expect(m.get(key(dx, 1, dz))?.orient?.half).toBe('lower');
        expect(m.get(key(dx, 2, dz))?.orient?.half).toBe('upper');
        expect(m.get(key(dx, 0, dz))?.shape).toBe('block');
        // von draußen bis ganz oben (Wendeltreppe durch alle Geschosse)
        expect(t.topStands.length).toBeGreaterThan(10);
        expect(reachShare(res, ground, [[-12, 0, -12]], t.topStands)).toBe(1);
        // jedes Geschoss hat Standplätze auf dem Ring, die erreichbar sind
        for (const f of t.floors) {
          const ring = footprintOffsets(shape, (t.size - 1) / 2)
            .filter(([x, z]) => Math.max(Math.abs(x), Math.abs(z)) === 2)
            .map(([x, z]): [number, number, number] => [x, f + 1, z]);
          expect(reachShare(res, ground, [[-12, 0, -12]], ring), `Geschoss ${f}`).toBeGreaterThan(0.5);
        }
      });
    }
  }

  it('Dach: Kegel/Zelt aus Treppen, Ringe steigen nach innen, Spitze ist ein Block', () => {
    for (const shape of ['round', 'square'] as const) {
      const res = buildTowerStructure({ center: [0, 0], shape, top: 'roof', levels: 2, roofPitch: 2 });
      const roof = res.cells.filter((c) => c.role === 'roof_main');
      const stairs = roof.filter((c) => c.shape === 'stairs');
      expect(stairs.length).toBeGreaterThan(20);
      // jede Treppe zeigt (hohe Rückseite) nicht von der Mitte weg
      for (const c of stairs) {
        const [x, , z] = c.pos;
        const f = c.orient!.facing!;
        const [fx, fz] = f === 'east' ? [1, 0] : f === 'west' ? [-1, 0] : f === 'south' ? [0, 1] : [0, -1];
        expect(fx * -x + fz * -z, `${shape} ${c.pos.join(',')}`).toBeGreaterThanOrEqual(0);
      }
      // Höhe fällt nach außen: höchste Dachzelle über der Mitte
      const top = Math.max(...roof.map((c) => c.pos[1]));
      expect(roof.filter((c) => c.pos[1] === top).every((c) => Math.abs(c.pos[0]) <= 1 && Math.abs(c.pos[2]) <= 1)).toBe(true);
    }
  });

  it('Zinnenkranz: Kragsteine (umgedrehte Treppen) und Zinnen im Wechsel', () => {
    const res = buildTowerStructure({ center: [0, 0], shape: 'square', size: 7, top: 'battlements', levels: 2 });
    const t = res.towers[0]!;
    const m = cellMap(res.cells);
    const ring: [number, number][] = [];
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) if (Math.max(Math.abs(x), Math.abs(z)) === 4) ring.push([x, z]);
    const corbels = ring.filter(([x, z]) => m.get(key(x, t.topY, z))?.orient?.half === 'top');
    expect(corbels.length).toBe(ring.length - 4); // Ecken: Vollblock
    expect(ring.every(([x, z]) => m.get(key(x, t.topY + 1, z)) !== undefined)).toBe(true); // Brüstung
    // Nordseite von West nach Ost: Zinne, Scharte, Zinne …; Ecken sind Zinnen
    const north = Array.from({ length: 9 }, (_, i) => (m.get(key(i - 4, t.topY + 2, -4)) !== undefined ? 'Z' : '_')).join('');
    expect(north).toBe('Z_Z_Z_Z_Z');
  });

  it('Treppenkern: Luke oben, Kopffreiheit über jeder Stufe', () => {
    const res = buildTowerStructure({ center: [5, 5], shape: 'round', top: 'battlements', levels: 3 });
    const t = res.towers[0]!;
    const m = cellMap(res.cells);
    const steps = res.cells.filter((c) => c.shape === 'stairs' && Math.abs(c.pos[0] - 5) <= 1 && Math.abs(c.pos[2] - 5) <= 1 && c.orient?.half === 'bottom');
    expect(steps.length).toBe(t.topY - t.baseY);
    for (const s of steps) {
      const [x, y, z] = s.pos;
      expect(m.get(key(x, y + 1, z)), `Kopf ${s.pos.join(',')}`).toBeUndefined();
      expect(m.get(key(x, y + 2, z))).toBeUndefined();
    }
  });

  it('passt sich dem Gelände an: Sockel bis zum tiefsten Punkt, Platte über dem höchsten', () => {
    const slope: HeightField = { groundY: (x) => Math.floor(x / 2) };
    const res = buildTowerStructure({ center: [0, 0], shape: 'round', levels: 2 }, { ground: slope });
    const t = res.towers[0]!;
    expect(t.baseY).toBe(Math.floor(4 / 2) + 1);
    expect(floatingCells(res.cells, slope)).toEqual([]);
    expect(reachShare(res, slope, [[-10, slope.groundY(-10, 0) + 1, 0]], t.topStands)).toBe(1);
  });

  it('ist deterministisch; der Seed variiert nur Details (Turmspitze)', () => {
    const a = buildTowerStructure({ center: [0, 0] }, { seed: 1 });
    expect(dump(a)).toBe(dump(buildTowerStructure({ center: [0, 0] }, { seed: 1 })));
    const variants = new Set([1, 2, 3, 4, 5, 6].map((seed) => dump(buildTowerStructure({ center: [0, 0] }, { seed }))));
    expect(variants.size).toBe(2);
  });

  it('korrigiert zu kleine oder gerade Maße mit Hinweis', () => {
    const res = buildTowerStructure({ center: [0, 0], shape: 'round', size: 6 });
    expect(res.towers[0]!.size).toBe(9);
    expect(res.warnings.join()).toMatch(/Turmgröße 6 → 9/);
  });
});
