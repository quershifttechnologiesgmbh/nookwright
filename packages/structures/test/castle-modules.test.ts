/**
 * W3-CA „Burg und Türme“ (plan/spikes/W3CA_burg.md): feste Module statt Zufall – Turmsatz (Abschluss je Rolle:
 * Ecktürme, Torhaus), Torbau zwischen den Torhaus-Türmen (Durchgang, Zinnen, Pechnase, Fallgitter), Licht in jedem
 * Turmgeschoss, Wehrplatte mit Belag und Ausguck mit Zeltdach. Ohne die neuen Optionen bleibt alles bitgleich
 * (compat.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@mcda/core';
import {
  buildStructures, flatGround, floatingCells, reachableStands, ringAround, standKey, type ParapetSpec, type RingSpec, type TowerStyle,
} from '../src/index.js';
import { cellMap, key } from './support.js';

const ground = flatGround();
const CORE = { minX: 0, minZ: 0, maxX: 26, maxZ: 12 };
const SET: TowerStyle = { shape: 'round', top: 'battlements', lit: true, corner: { top: 'roof', roofShape: 'cone', flare: true, finial: 'pole' } };
const ring = (towerStyle: TowerStyle, gateBlock = true, out: 'south' | 'east' = 'south'): RingSpec => ({
  core: CORE, door: out === 'south' ? { cell: [8, 13], out } : { cell: [27, 4], out }, offset: 6, height: 7, towerSpacing: 44, towerStyle,
  merlon: { width: 2, gap: 1 }, gate: { width: 3, height: 5, gatehouse: true, gateBlock },
});

describe('Turmsatz: Abschluss je Rolle (Ecke, Torhaus, Zwischenturm)', () => {
  for (const style of [SET, { shape: 'square', top: 'battlements', corner: { top: 'roof', roofShape: 'tent' } } as TowerStyle]) {
    it(`${style.shape}: Ecktürme mit Dach, Torhaus und Zwischentürme mit Zinnen, gleiche Größe`, () => {
      const res = buildStructures({ walls: ringAround(ring(style, false)).walls }, { ground, seed: 7 });
      expect(res.warnings).toEqual([]);
      const tops = res.towers.map((t) => t.top);
      expect(tops.filter((t) => t === 'roof')).toHaveLength(4);
      expect(tops.filter((t) => t === 'battlements').length).toBeGreaterThanOrEqual(2);
      expect(new Set(res.towers.map((t) => `${t.shape}/${t.size}`)).size).toBe(1);
      expect(floatingCells(res.cells, ground)).toEqual([]);
    });
  }

  it('Rollen-Überschreibung ändert Form und Größe nicht; ohne Überschreibung wie der Grundstil', () => {
    const plain = buildStructures({ walls: ringAround(ring({ shape: 'round', top: 'battlements' }, false)).walls }, { ground, seed: 7 });
    const same = buildStructures({ walls: ringAround(ring({ shape: 'round', top: 'battlements', gate: {} }, false)).walls }, { ground, seed: 7 });
    expect(same.cells).toEqual(plain.cells);
  });
});

describe('Torbau zwischen den Torhaus-Türmen', () => {
  for (const out of ['south', 'east'] as const) {
    it(`Tor ${out}: Durchgang hochgezogen, Zinnen, Pechnase, Fallgitter, Laterne; Wehrgang ganz begehbar`, () => {
      const res = buildStructures({ walls: ringAround(ring(SET, true, out)).walls }, { ground, seed: 3 });
      expect(res.warnings).toEqual([]);
      expect(floatingCells(res.cells, ground)).toEqual([]);
      const wall = res.walls[0]!;
      const gate = wall.gates[0]!;
      // beide Torhaus-Türme gleich hoch (Zinnen), der Torbau reicht bis zu ihrer Plattform
      const gc = gate.center;
      const pair = res.towers.filter((t) => t.top === 'battlements' && Math.hypot(t.center[0] - gc[0], t.center[1] - gc[1]) < 9);
      expect(pair).toHaveLength(2);
      expect(pair[0]!.topY).toBe(pair[1]!.topY);
      const Y = pair[0]!.topY;
      const m = cellMap(res.cells);
      // Plattform über dem Tor, Zinnen darüber
      expect(m.get(key(gc[0], Y, gc[1]))?.role).toBe('walkway');
      const aboveGate = res.cells.filter((c) => c.pos[1] > Y && Math.abs(c.pos[0] - gc[0]) + Math.abs(c.pos[2] - gc[1]) <= 3 && c.role === 'parapet');
      expect(aboveGate.length).toBeGreaterThanOrEqual(4);
      // Fallgitter: Zaun unter dem Sturz, darunter mindestens 3 Reihen frei
      const bars = res.cells.filter((c) => c.shape === 'fence' && gate.passage.some((p) => p[0] === c.pos[0] && p[2] === c.pos[2]));
      expect(bars.length).toBeGreaterThanOrEqual(3);
      expect(Math.min(...bars.map((c) => c.pos[1])) - gate.baseY).toBeGreaterThanOrEqual(4);
      for (const p of gate.passage) for (const dy of [0, 1, 2]) expect(m.get(key(p[0], p[1] + dy, p[2]))).toBeUndefined();
      // Pechnase: umgedrehte Treppe außen vor der Mauer auf Plattformhöhe
      expect(res.cells.some((c) => c.pos[1] === Y && c.shape === 'stairs' && c.orient?.half === 'top' && Math.abs(c.pos[0] - gc[0]) + Math.abs(c.pos[2] - gc[1]) <= 3)).toBe(true);
      // Laterne im überdeckten Durchgang
      expect(res.cells.some((c) => c.shape === 'lantern' && c.orient?.hanging === true && c.pos[1] === Y - 1)).toBe(true);
      // ganzer Wehrgang vom Aufgang aus begehbar (auch durch den Torbau)
      const bottom = wall.stairs[0]!.bottom;
      const seen = reachableStands(res.cells, ground, [[bottom[0], bottom[1] + 1, bottom[2]] as Vec3]);
      expect(wall.walkway.filter((p) => !seen.has(standKey(p)))).toEqual([]);
    });
  }

  it('ohne Torhaus kein Torbau; ohne `gateBlock` bitgleich zum Torhaus allein', () => {
    const lay = ringAround(ring(SET, false));
    const off = buildStructures({ walls: lay.walls }, { ground, seed: 3 });
    const noHouse = buildStructures({ walls: ringAround({ ...ring(SET, true), gate: { width: 3, height: 5, gatehouse: false, gateBlock: true } }).walls }, { ground, seed: 3 });
    expect(noHouse.warnings).toEqual([]);
    expect(noHouse.cells.some((c) => c.shape === 'fence' && c.role === 'beam' && c.pos[1] > 3 && c.pos[1] < 7)).toBe(false);
    expect(off.cells.filter((c) => c.shape === 'fence').length).toBeLessThan(buildStructures({ walls: ringAround(ring(SET, true)).walls }, { ground, seed: 3 }).cells.filter((c) => c.shape === 'fence').length);
  });
});

describe('Licht in jedem Turmgeschoss (`lit`)', () => {
  for (const style of [
    { shape: 'round', top: 'battlements', lit: true }, { shape: 'square', top: 'roof', lit: true }, { shape: 'round', top: 'roof', roofShape: 'cone', lit: true },
  ] as TowerStyle[]) {
    it(`${style.shape}/${style.top}: hängende Laterne je Geschoss mit Platz, getragen, nie im Weg`, () => {
      const res = buildStructures({ towers: [{ ...style, center: [0, 0], levels: 4 }] }, { ground, seed: 1 });
      const t = res.towers[0]!;
      const m = cellMap(res.cells);
      const lamps = res.cells.filter((c) => c.shape === 'lantern' && c.orient?.hanging === true);
      const levels = t.floors.filter((f, i) => i < t.floors.length - 1 && t.floors[i + 1]! - f >= 4).length + (t.top === 'roof' ? 1 : 0);
      expect(lamps).toHaveLength(levels);
      for (const l of lamps) {
        const [x, y, z] = l.pos;
        // darüber Kette oder tragender Block, darunter 2 Reihen Luft über dem Boden
        let yy = y + 1;
        while (m.get(key(x, yy, z))?.shape === 'chain') yy++;
        expect(m.get(key(x, yy, z)), `${l.pos}`).toBeDefined();
        expect(m.get(key(x, y - 1, z))).toBeUndefined();
        expect(m.get(key(x, y - 2, z))).toBeUndefined();
        // nie auf der Wendel (3×3-Kern)
        expect(Math.abs(x) > 1 || Math.abs(z) > 1).toBe(true);
      }
      // Turm bleibt begehbar bis oben (Wendel frei)
      const door = t.door!;
      const seen = reachableStands(res.cells, ground, [[door.pos[0], door.pos[1], door.pos[2]]]);
      expect(t.topStands.some((p) => seen.has(standKey(p)))).toBe(true);
    });
  }
});

describe('Wehrplatte mit Belag, Ausguck mit Zeltdach', () => {
  const square = (n: number, x0 = 0): ParapetSpec['cells'] => {
    const out: [number, number][] = [];
    for (let x = x0; x < x0 + n; x++) for (let z = 0; z < n; z++) out.push([x, z]);
    return out;
  };

  it('Belag: Wehrgang-Steine innen bündig mit der Brüstung, Brüstung und Zinnen wie ohne Belag, je Seite spiegelsymmetrisch', () => {
    const plain = buildStructures({ parapets: [{ cells: square(9), y: 20 }] });
    const res = buildStructures({ parapets: [{ cells: square(9), y: 20, deck: true }] });
    const m = cellMap(res.cells);
    for (const [x, z] of square(9)) expect(m.get(key(x, 21, z))?.role, `${x},${z}`).toBe(x === 0 || x === 8 || z === 0 || z === 8 ? 'parapet' : 'walkway');
    expect(res.cells.filter((c) => c.role === 'parapet')).toEqual(plain.cells.filter((c) => c.role === 'parapet'));
    for (let x = 0; x < 9; x++) expect(m.get(key(x, 22, 0)) !== undefined).toBe(m.get(key(8 - x, 22, 0)) !== undefined);
  });

  it('Ausguck: Pfosten an Ecken und Seitenmitten, Zaun-Brüstung, 2 Reihen offen, Zeltdach mit Stange, 4 Laternen', () => {
    const res = buildStructures({ parapets: [{ cells: square(9), y: 20, deck: true, crown: 'lookout' }] });
    expect(res.warnings).toEqual([]);
    const m = cellMap(res.cells);
    const posts = res.cells.filter((c) => c.shape === 'log' && c.pos[1] === 22);
    expect(posts.map((c) => `${c.pos[0]},${c.pos[2]}`).sort()).toEqual(['0,0', '0,4', '0,8', '4,0', '4,8', '8,0', '8,4', '8,8']);
    expect(res.cells.filter((c) => c.shape === 'fence' && c.pos[1] === 22)).toHaveLength(32 - 8);
    // offen über der Brüstung, Dach ab Traufe y + 5 (Belag + 3 Pfostenreihen)
    expect(m.get(key(2, 23, 0))).toBeUndefined();
    expect(m.get(key(2, 24, 0))).toBeUndefined();
    expect(res.cells.some((c) => c.role === 'roof_main' && c.pos[1] === 25)).toBe(true);
    expect(res.cells.filter((c) => c.shape === 'lantern' && c.orient?.hanging === true)).toHaveLength(4);
    const top = Math.max(...res.cells.map((c) => c.pos[1]));
    expect(m.get(key(4, top, 4))?.shape).toBe('log');
  });

  it('Ausguck nur auf quadratischem Dach mit ungerader Seite – sonst Zinnen und ein Hinweis', () => {
    const rect: [number, number][] = [];
    for (let x = 0; x < 11; x++) for (let z = 0; z < 7; z++) rect.push([x, z]);
    const res = buildStructures({ parapets: [{ cells: rect, y: 10, crown: 'lookout' }] });
    expect(res.warnings.join()).toMatch(/Ausguck nur auf quadratischem Flachdach/);
    expect(res.cells.every((c) => c.role === 'parapet')).toBe(true);
  });
});
