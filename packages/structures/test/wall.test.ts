import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@mcda/core';
import {
  buildStructures, buildWallStructure, flatGround, floatingCells, reachableStands, standKey,
  type HeightField, type WallPlan,
} from '../src/index.js';
import { cellMap, dump, key, reachShare } from './support.js';

const ground = flatGround();
const OUTSIDE: Vec3 = [-20, 0, -20];
/** Mauerring 39 × 28 um das Beispielhaus (Hof innen), Tor im Süden. */
const RING: WallPlan = { points: [[-8, -8], [30, -8], [30, 19], [-8, 19]], closed: true, towerSpacing: 0, gates: [{ at: [11, 19] }] };

describe('Wehrmauer aus einem Mauerzug', () => {
  it('Ring: 4 Ecktürme, Tor, Treppenaufgang, nichts schwebt, keine Hinweise', () => {
    const res = buildWallStructure(RING);
    expect(res.warnings).toEqual([]);
    expect(res.towers.map((t) => t.center)).toEqual([[-8, -8], [30, -8], [30, 19], [-8, 19]]);
    expect(res.walls[0]!.gates.map((g) => g.kind)).toEqual(['arch']);
    expect(res.walls[0]!.stairs).toHaveLength(1);
    expect(floatingCells(res.cells, ground)).toEqual([]);
    expect(res.cells.every((c) => c.kind === 'fort' && c.exterior === true && c.roomId?.startsWith('fort:w0'))).toBe(true);
    const roles = new Set(res.cells.map((c) => `${c.role}.${c.shape}`));
    for (const r of roles) {
      expect([
        'wall_primary.block', 'wall_primary.stairs', 'foundation.block', 'foundation.stairs', 'roof_main.block', 'roof_main.stairs', 'beam.log', 'door.door',
        'parapet.block', 'walkway.block', 'walkway.stairs', 'tower_floor.block', 'arrow_slit.pane',
        // W7 (27.09.2026): Sockelgeschoss der Mauertürme bis zum Wehrgang (Rückfall `wall_primary`)
        'fort_base.block',
      ]).toContain(r);
    }
    // Befestigungsrollen (B1): Brüstung, Wehrgang, Turmböden und Scharten sind wirklich im Einsatz
    for (const r of ['parapet.block', 'walkway.block', 'tower_floor.block', 'arrow_slit.pane', 'fort_base.block']) expect(roles.has(r), r).toBe(true);
    // Grundfläche für den Kontext Gelände: jede Spalte mit Blöcken am Boden ist belegt
    const fp = new Set(res.footprint.map(([x, z]) => `${x},${z}`));
    for (const c of res.cells) if (c.pos[1] <= 1) expect(fp.has(`${c.pos[0]},${c.pos[2]}`), c.pos.join(',')).toBe(true);
  });

  it('Wehrgang: zusammenhängend, von außen durchs Tor erreichbar, alle Türme bis oben erreichbar', () => {
    const res = buildWallStructure(RING);
    const wall = res.walls[0]!;
    expect(wall.walkway.length).toBeGreaterThan(150);
    // Zusammenhang: von EINEM Wehrgang-Standplatz aus erreicht man alle anderen
    const seen = reachableStands(res.cells, ground, [wall.walkway[0]!]);
    expect(wall.walkway.filter((p) => !seen.has(standKey(p)))).toEqual([]);
    // von außen: durch das Tor in den Hof, über Treppe/Turm auf den Wehrgang und auf jede Turmplattform
    expect(reachShare(res, ground, [OUTSIDE], wall.walkway)).toBe(1);
    for (const t of res.towers) expect(reachShare(res, ground, [OUTSIDE], t.topStands), t.id).toBe(1);
    expect(reachShare(res, ground, [OUTSIDE], [[11, 0, 5]])).toBe(1); // Hof
  });

  it('Wehrgang allein über den Treppenaufgang erreichbar (ohne Türme)', () => {
    const res = buildWallStructure({ ...RING, towers: 'none' });
    const wall = res.walls[0]!;
    expect(res.towers).toEqual([]);
    const [st] = wall.stairs;
    expect(st!.top[1] - st!.bottom[1]).toBe(5);
    expect(reachShare(res, ground, [OUTSIDE], wall.walkway)).toBe(1);
    expect(floatingCells(res.cells, ground)).toEqual([]);
  });

  it('Zinnen-Rhythmus entlang der Bogenlänge (1:1 und 2:1), Brüstung außen durchgehend', () => {
    for (const [width, gap, pattern] of [[1, 1, 'Z_Z_Z_Z_Z_Z_'], [2, 1, 'ZZ_ZZ_ZZ_ZZ_']] as const) {
      const res = buildWallStructure({ points: [[0, 0], [40, 0]], towers: 'none', stairs: 'none', merlon: { width, gap } });
      const m = cellMap(res.cells);
      // offener Zug nach Osten, außen = links = Norden: Brüstung in Reihe z = −1, Wehrgang-Boden y = 5
      const row = Array.from({ length: 12 }, (_, i) => (m.get(key(12 + i, 7, -1)) !== undefined ? 'Z' : '_')).join('');
      expect(row).toBe(pattern);
      for (let x = 1; x < 40; x++) {
        expect(m.get(key(x, 6, -1)), `Brüstung ${x}`).toBeDefined();
        expect(m.get(key(x, 6, 0))).toBeUndefined(); // Wehrgang frei
        expect(m.get(key(x, 5, 1))?.role).toBe('walkway'); // Wehrgang-Belag
        expect(m.get(key(x, 4, 1))?.role).toBe('wall_primary');
        expect(m.get(key(x, 6, -1))?.role).toBe('parapet'); // Brüstung
        expect(m.get(key(x, 0, 1))?.role).toBe('foundation'); // Sockel
        expect(m.get(key(x, 0, -2))?.shape).toBe('stairs'); // Anlauf außen
      }
    }
  });

  it('Tore: Tür (1), Doppeltür (2), Bogen (≥ 3) – Durchgang frei, Sturz trägt den Wehrgang', () => {
    const res = buildWallStructure({
      points: [[0, 0], [60, 0]], towers: 'none', stairs: 'none',
      gates: [{ at: [10, 0], width: 1 }, { at: [25, 0], width: 2 }, { at: [45, 0], width: 5, height: 4 }],
    });
    const m = cellMap(res.cells);
    const [door, double, arch] = res.walls[0]!.gates;
    expect([door!.kind, double!.kind, arch!.kind]).toEqual(['door', 'double_door', 'arch']);
    // Tür außen (Norden), Blick beim Hinausgehen nach Norden
    expect(m.get(key(10, 1, -1))).toMatchObject({ role: 'door', orient: { facing: 'north', half: 'lower' } });
    expect(m.get(key(10, 2, -1))).toMatchObject({ role: 'door', orient: { half: 'upper' } });
    expect(m.get(key(10, 3, -1))?.role).toBe('wall_primary');
    // Doppeltür: Scharniere außen (links = Westen bei Blick nach Norden)
    expect(m.get(key(24, 1, -1))?.orient?.hinge).toBe('left');
    expect(m.get(key(25, 1, -1))?.orient?.hinge).toBe('right');
    // Bogen: 5 breit, 4 hoch, Ecken als umgedrehte Treppen, Wehrgang darüber
    for (let x = 43; x <= 47; x++) for (let y = 1; y <= 3; y++) for (let z = -1; z <= 1; z++) expect(m.get(key(x, y, z))).toBeUndefined();
    expect(m.get(key(43, 4, 0))).toMatchObject({ shape: 'stairs', orient: { facing: 'west', half: 'top' } });
    expect(m.get(key(47, 4, 0))).toMatchObject({ shape: 'stairs', orient: { facing: 'east', half: 'top' } });
    expect(m.get(key(45, 4, 0))).toBeUndefined();
    expect(m.get(key(45, 5, 0))?.role).toBe('walkway');
    // Zugang für Wege: Vorplätze beiderseits (Norden und Süden) jedes Tores
    for (const g of res.walls[0]!.gates) {
      expect(g.approach.some(([, z]) => z < -1), `${g.kind} Nord`).toBe(true);
      expect(g.approach.some(([, z]) => z > 1), `${g.kind} Süd`).toBe(true);
      const fp = new Set(res.footprint.map(([x, z]) => `${x},${z}`));
      for (const [x, z] of g.approach) expect(fp.has(`${x},${z}`), `${x},${z}`).toBe(true);
    }
    // alle Durchgänge von beiden Seiten begehbar
    const seen = reachableStands(res.cells, ground, [[30, 0, -8]]);
    for (const g of res.walls[0]!.gates) for (const p of g.passage) expect(seen.has(standKey(p)), `${g.kind} ${p.join(',')}`).toBe(true);
    expect(seen.has(standKey([30, 0, 4]))).toBe(true); // Südseite
    expect(floatingCells(res.cells, ground)).toEqual([]);
  });

  it('Torhaus: zwei flankierende Türme mit einer Laibung Abstand', () => {
    const res = buildWallStructure({ points: [[0, 0], [60, 0]], towerSpacing: 0, gates: [{ at: [30, 0], gatehouse: true }] });
    const centers = res.towers.map((t) => t.center[0]);
    expect(centers).toEqual([0, 23, 37, 60]); // Enden + Torhaus (r = 4: 30 ± (1 + 1 + 1 + 4))
    expect(res.warnings).toEqual([]);
  });

  it('Türme: Ecken ab Knickwinkel, Zwischentürme nach Abstand, Konflikte mit Hinweis', () => {
    const flat = buildWallStructure({ points: [[0, 0], [30, 0], [60, 8]], towerSpacing: 0 });
    expect(flat.towers.map((t) => t.center)).toEqual([[0, 0], [60, 8]]); // 15° Knick → kein Turm
    const spaced = buildWallStructure({ points: [[0, 0], [100, 0]], towerSpacing: 24 });
    expect(spaced.towers.map((t) => t.center[0])).toEqual([0, 20, 40, 60, 80, 100]);
    const clash = buildWallStructure({ points: [[0, 0], [30, 0], [30, 30]], towerSpacing: 0, gates: [{ at: [29, 0] }] });
    expect(clash.warnings.join()).toMatch(/Ecke 1: kein Turm \(Konflikt mit Tor\)/);
  });

  it('offener Zug mit Außenseite rechts: Brüstung im Süden', () => {
    const res = buildWallStructure({ points: [[0, 0], [30, 0]], outside: 'right', towers: 'none', stairs: 'none' });
    const m = cellMap(res.cells);
    expect(m.get(key(15, 6, 1))).toBeDefined();
    expect(m.get(key(15, 6, -1))).toBeUndefined();
  });

  it('Gelände: Sockel folgt dem Boden, Wehrgang steigt höchstens 1 je Schritt (Treppen), alles erreichbar', () => {
    const hills: HeightField = { groundY: (x, z) => Math.floor(x / 4) + Math.floor(Math.abs(z - 8) / 6) + ((x * 7 + z * 13) % 5 === 0 ? 1 : 0) };
    const res = buildStructures({
      walls: [{ points: [[0, 0], [40, 0], [48, 22], [10, 30], [-4, 16]], closed: true, gates: [{ at: [20, 0], gatehouse: true }, { at: [30, 26], width: 1 }] }],
    }, { ground: hills, seed: 3 });
    expect(floatingCells(res.cells, hills)).toEqual([]);
    const m = cellMap(res.cells);
    // jede Mauerspalte beginnt direkt über dem Gelände
    const cols = new Map<string, number>();
    for (const c of res.cells) if (c.roomId === 'fort:w0') cols.set(`${c.pos[0]},${c.pos[2]}`, Math.min(cols.get(`${c.pos[0]},${c.pos[2]}`) ?? Infinity, c.pos[1]));
    for (const [k, y] of cols) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      if (m.get(key(x, y, z))?.shape === 'block') expect(y, k).toBe(hills.groundY(x, z) + 1);
    }
    // Wehrgang: Nachbarn unterscheiden sich um ≤ 1 (Stand auf Treppe zählt halb)
    const walk = new Map(res.walls[0]!.walkway.map((p) => [`${p[0]},${p[2]}`, p[1]]));
    for (const [k, y] of walk) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
        const n = walk.get(`${x + dx},${z + dz}`);
        if (n !== undefined) expect(Math.abs(n - y), k).toBeLessThanOrEqual(1);
      }
    }
    const start: Vec3 = [-15, hills.groundY(-15, -15) + 1, -15];
    expect(reachShare(res, hills, [start], res.walls[0]!.walkway)).toBe(1);
    for (const t of res.towers) expect(reachShare(res, hills, [start], t.topStands), t.id).toBe(1);
  });

  it('ist deterministisch; der Seed ändert nur die Turmhöhen (±1) und Turmspitzen', () => {
    const a = buildWallStructure(RING, { seed: 7 });
    expect(dump(a)).toBe(dump(buildWallStructure(RING, { seed: 7 })));
    const b = buildWallStructure(RING, { seed: 8 });
    expect(dump(a)).not.toBe(dump(b));
    const wallOnly = (r: typeof a): string => JSON.stringify(r.cells.filter((c) => c.roomId === 'fort:w0'));
    expect(wallOnly(a)).toBe(wallOnly(b));
  });

  it('weicht vorhandenen Bauwerken aus (freistehender Turm auf der Linie)', () => {
    const res = buildStructures({ towers: [{ center: [20, 0] }], walls: [{ points: [[0, 0], [40, 0]], towers: 'none', stairs: 'none' }] });
    expect(res.warnings.join()).toMatch(/Mauerzellen entfallen/);
    const owners = new Map<string, string>();
    for (const c of res.cells) {
      const k = `${c.pos[0]},${c.pos[2]}`;
      const o = c.roomId!.split('.')[0]!;
      if (owners.has(k) && owners.get(k) !== o && c.pos[1] <= 1) throw new Error(`Spalte ${k} doppelt belegt`);
      owners.set(k, o);
    }
  });
});
