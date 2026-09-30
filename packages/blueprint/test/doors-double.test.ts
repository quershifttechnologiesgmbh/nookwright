/**
 * W4-C (plan/spikes/W4C_tueren.md): Doppeltür als Haustür und Haustür im Mittelfeld (Regeln `doubleDoor`, `centerDoor`).
 *
 * - Doppeltür: zwei Türflügel nebeneinander auf der Doppelachse des geraden Mittelfelds, gleiche Blickrichtung,
 *   Scharniere außen wie die Vanilla-Doppeltür (Faktencheck #18: der linke Flügel `hinge=left`, der rechte `right`),
 *   Sturz über beiden, beide Flügel als Haustür in der Raumsicht mit Verweis auf den Partner.
 * - Nur für die genannten Raumtypen und nur, wo ein symmetrisches Paar frei ist; sonst die einfache Tür wie bisher.
 * - Ohne die Regeln bleibt die Hülle zellgleich (Vertrag „nur additiv“).
 */
import { describe, expect, it } from 'vitest';
import { CellSet, key3, type HorizontalDir } from '@mcda/core';
import { FACADE_QUALITY_RULES, Project, TARGET_VERSIONS, deriveShell, type FacadeRules, type Shell, type ShellCell } from '../src/index.js';
import { doublePairs, middleBayCells, type GridLine } from '../src/shell/bays.js';
import { runPairs } from '../src/shell/doors.js';

const CCW: Record<HorizontalDir, HorizontalDir> = { north: 'west', west: 'south', south: 'east', east: 'north' };
const STEP: Record<HorizontalDir, readonly [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

function hall(w: number, d: number, type = 'tavern', seed = 2026): Project {
  const p = Project.create({ id: 'd', name: 'Saal', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 4 } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  return p;
}
const shellOf = (p: Project, rules: FacadeRules = FACADE_QUALITY_RULES): Shell => deriveShell(p.state, { roof: 'gable', facade: { rules } });
const mainDoors = (s: Shell) => [...s.rooms.values()].flatMap((r) => r.doors.filter((d) => d.isMain));
const doorCells = (s: Shell): ShellCell[] => s.cells.filter((c) => c.kind === 'door' && c.exterior === true);

describe('W4-C: Doppeltür an der Haustür', () => {
  it('Schankraum 16 × 9: zwei Flügel auf der Doppelachse des Mittelfelds, Scharniere außen, Sturz über beiden', () => {
    const s = shellOf(hall(16, 9));
    const mains = mainDoors(s);
    expect(mains).toHaveLength(2);
    const [a, b] = mains as [typeof mains[number], typeof mains[number]];
    expect(a.toward).toBe(b.toward);
    expect(a.partner).toEqual(b.inside);
    expect(b.partner).toEqual(a.inside);
    expect(Math.abs(a.inside[0] - b.inside[0]) + Math.abs(a.inside[1] - b.inside[1])).toBe(1);
    // Türzellen: je Flügel untere und obere Hälfte, gleiche Blickrichtung (hinaus), Scharnier außen
    const doors = doorCells(s);
    expect(doors).toHaveLength(4);
    const facing = doors[0]!.orient!.facing!;
    expect(facing).toBe(a.toward);
    for (const c of doors) {
      expect(c.orient?.facing).toBe(facing);
      const other = doors.find((o) => o !== c && o.pos[1] === c.pos[1] && Math.abs(o.pos[0] - c.pos[0]) + Math.abs(o.pos[2] - c.pos[2]) === 1)!;
      expect(other, `Partnerflügel zu ${key3(c.pos)}`).toBeDefined();
      // steht der Partner links (gegen den Uhrzeigersinn von facing), sitzt das Scharnier rechts – und umgekehrt
      const [lx, lz] = STEP[CCW[facing]];
      const partnerLeft = other.pos[0] - c.pos[0] === lx && other.pos[2] - c.pos[2] === lz;
      expect(c.orient?.hinge, `Scharnier ${key3(c.pos)}`).toBe(partnerLeft ? 'right' : 'left');
      // obere und untere Hälfte stimmen überein (sonst `door_half`)
      const twin = doors.find((o) => o.pos[0] === c.pos[0] && o.pos[2] === c.pos[2] && o !== c)!;
      expect(twin.orient?.hinge).toBe(c.orient?.hinge);
      expect(new Set([c.orient?.half, twin.orient?.half])).toEqual(new Set(['lower', 'upper']));
    }
    // Sturz über beiden Flügeln
    const byPos = new Map(s.cells.map((c) => [key3(c.pos), c] as const));
    for (const c of doors.filter((d) => d.orient?.half === 'upper')) expect(byPos.get(key3([c.pos[0], c.pos[1] + 1, c.pos[2]]))?.kind).toBe('lintel');
    // auf der Doppelachse des Mittelfelds der Linie
    const line = s.facadeGrid!.find((g) => g.out === facing && g.floorIndex === 0 && g.bays.some((bay) => bay.axis.length === 2))!;
    const cols = doors.map((c) => (facing === 'north' || facing === 'south' ? c.pos[0] : c.pos[2]));
    const mid = line.bays[(line.bays.length - 1) / 2]!;
    expect([...new Set(cols)].sort((p, q) => p - q)).toEqual([...mid.axis].sort((p, q) => p - q));
  });

  it('deterministisch; linker und rechter Flügel haben verschiedene Scharniere', () => {
    const a = shellOf(hall(12, 9));
    expect(shellOf(hall(12, 9)).cells).toEqual(a.cells);
    const hinges = new Set(doorCells(a).map((c) => c.orient?.hinge));
    expect(hinges).toEqual(new Set(['left', 'right']));
  });

  it('nur für die genannten Raumtypen: Schlafzimmer gleicher Größe und leere Liste → einfache Tür', () => {
    expect(mainDoors(shellOf(hall(16, 9, 'bedroom')))).toHaveLength(1);
    expect(mainDoors(shellOf(hall(16, 9), { ...FACADE_QUALITY_RULES, doubleDoor: [] }))).toHaveLength(1);
    expect(mainDoors(shellOf(hall(16, 9, 'bedroom'), { ...FACADE_QUALITY_RULES, doubleDoor: ['bedroom'] }))).toHaveLength(2);
  });

  it('ungerade Fassaden (kein symmetrisches Paar) → einfache Tür', () => {
    for (const [w, d] of [[15, 9], [13, 11], [17, 9]] as const) {
      const mains = mainDoors(shellOf(hall(w, d)));
      expect(mains, `${w} × ${d}`).toHaveLength(1);
      expect(mains[0]!.partner).toBeUndefined();
    }
  });

  it('ohne Raster: mittleres Zellpaar eines geraden Wandlaufs', () => {
    const s = shellOf(hall(12, 9), { doubleDoor: ['tavern'] });
    const mains = mainDoors(s);
    expect(mains).toHaveLength(2);
    expect(mains.every((m) => m.partner !== undefined)).toBe(true);
  });

  it('ohne die Regeln bleibt die Hülle zellgleich zur Hülle ohne W4-Felder', () => {
    const { centerDoor: _c, doubleDoor: _d, ...w3 } = FACADE_QUALITY_RULES;
    const p = hall(16, 9);
    const s = shellOf(p, w3);
    expect(mainDoors(s)).toHaveLength(1);
    expect(deriveShell(p.state, { roof: 'gable' }).cells.filter((c) => c.kind === 'door')).toHaveLength(2);
  });
});

describe('W4-C: Raster-Hilfen', () => {
  const frame = { x0: 0, z0: 0, w: 40, d: 40 };
  const line = (bays: GridLine['bays']): GridLine => ({ out: 'south', plane: 10, from: 0, to: 30, posts: [], bays });
  it('middleBayCells: Rang 3 im echten Mittelfeld, 2 in den mittleren Feldern einer geraden Feldzahl ≥ 4, 1 sonst', () => {
    const odd = middleBayCells(frame, [line([{ from: 1, to: 3, axis: [2] }, { from: 5, to: 8, axis: [6, 7] }, { from: 10, to: 12, axis: [11] }])]);
    expect([...odd]).toEqual([[10 * 40 + 6, 3], [10 * 40 + 7, 3]]);
    const even = middleBayCells(frame, [line([1, 5, 9, 13].map((f) => ({ from: f, to: f + 2, axis: [f + 1] })))]);
    expect([...even]).toEqual([[10 * 40 + 6, 2], [10 * 40 + 10, 2]]);
    const two = middleBayCells(frame, [line([{ from: 1, to: 3, axis: [2] }, { from: 5, to: 7, axis: [6] }])]);
    expect([...two.values()]).toEqual([1, 1]);
  });
  it('doublePairs: nur Doppelachsen, Schlüssel = linke Zelle', () => {
    const pairs = doublePairs(frame, [line([{ from: 1, to: 3, axis: [2] }, { from: 5, to: 8, axis: [7, 6] }])]);
    expect([...pairs]).toEqual([[10 * 40 + 6, 10 * 40 + 7]]);
  });
  it('runPairs: Mitte gerader Wandläufe ab 4 Zellen', () => {
    const p = hall(12, 9);
    const s = shellOf(p, { doubleDoor: ['tavern'] });
    expect(s.cells.length).toBeGreaterThan(0);
    const plan = { runs: [{ axis: 'x' as const, cells: [1, 2, 3, 4], exterior: true }, { axis: 'z' as const, cells: [5, 6, 7], exterior: true }] };
    expect([...runPairs(plan as never)]).toEqual([[2, 3]]);
  });
});
