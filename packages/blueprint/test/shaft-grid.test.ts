/**
 * W7-B „Burg: Fassadenraster“ (plan/spikes/W7B_burg.md, Baustandard F1/F2): Turmschaft mit eigenem Raster
 * (`RoofDetail.shaftGrid`). Szenario wie die Burg: Palas 21 × 13 (Erdgeschoss 4, Obergeschoss 3) und Bergfried 9 × 9
 * mit 4 Geschossen à 3 an der linken hinteren Ecke, bündig mit der Nordwand; der Bergfried nimmt dem Palas die
 * gemeinsame Wandspalte. Vorher lief das Raster im Erdgeschoss über beide Baukörper, und die Südseite des Bergfrieds war
 * neben dem Palas eine Spalte kürzer – die Achsen des Erdgeschosses passten nicht zu denen darüber.
 */
import { describe, expect, it } from 'vitest';
import { CellSet } from '@mcda/core';
import { DEFAULT_VOLUME, deriveShell, type FacadeGridLine, type RoofDetail, type Shell, type ShellOptions } from '../src/index.js';
import { addVolume, volumeProject } from './support/volumes.js';

const OPTS: ShellOptions = { roof: 'gable', roofDetail: { trim: true }, facade: { quoins: true, rules: { grid: true, bay: 3 } } };
const KEEP = { x0: 0, x1: 8, z0: 0, z1: 8 };

function castle(detail: RoofDetail | undefined): Shell {
  const p = volumeProject();
  for (let f = 1; f < 4; f++) p.addFloor();
  p.changeVolume(DEFAULT_VOLUME, { name: 'Palas', roof: 'gable', floorHeights: { 0: 4 } });
  const keep = addVolume(p, { name: 'Bergfried', roof: 'flat', ...(detail !== undefined ? { roofDetail: detail } : {}) });
  const keepCells = CellSet.rect(KEEP.x0, KEEP.z0, KEEP.x1, KEEP.z1);
  const palas = CellSet.rect(8, 0, 28, 12).difference(keepCells);
  p.paintRoom(0, palas, 'dining_hall');
  p.paintRoom(1, palas, 'bedroom');
  for (let f = 0; f < 4; f++) p.paintRoom(f, keepCells, f === 0 ? 'storage' : 'library', { volumeId: keep });
  return deriveShell(p.state, OPTS);
}

/** Rasterlinien einer Außenseite des Bergfrieds (Ebene), je Geschoss von unten. */
const keepSide = (s: Shell, out: FacadeGridLine['out'], plane: number): FacadeGridLine[] =>
  (s.facadeGrid ?? []).filter((g) => g.out === out && g.plane === plane && g.from >= KEEP.x0 - 1 && g.to <= (out === 'north' || out === 'south' ? KEEP.x1 : KEEP.z1)).sort((a, b) => a.y0 - b.y0);
const shape = (g: FacadeGridLine): string => JSON.stringify({ from: g.from, to: g.to, posts: g.posts, axes: g.bays.map((b) => b.axis) });

describe('Turmschaft mit eigenem Raster (`shaftGrid`)', () => {
  const before = castle({ trim: true });
  const after = castle({ trim: true, shaftGrid: true });

  it('vorher: im Erdgeschoss eine Linie über Bergfried und Palas, die Südseite neben dem Palas eine Spalte kürzer', () => {
    const north0 = (before.facadeGrid ?? []).filter((g) => g.out === 'north' && g.plane === 0 && g.y0 === 0);
    expect(north0.map((g) => [g.from, g.to])).toEqual([[0, 28]]);
    const south = keepSide(before, 'south', KEEP.z1);
    expect(south[0]!.to).toBe(KEEP.x1 - 1);
  });

  it('jede Seite des Bergfrieds hat auf allen Geschossen dieselbe Linie von Ecke zu Ecke (Pfosten und Achsen)', () => {
    for (const [out, plane] of [['north', KEEP.z0], ['south', KEEP.z1], ['west', KEEP.x0]] as const) {
      const lines = keepSide(after, out, plane);
      expect(lines.length, out).toBe(4);
      expect(new Set(lines.map(shape)).size, out).toBe(1);
      expect([lines[0]!.from, lines[0]!.to], out).toEqual([out === 'west' ? KEEP.z0 : KEEP.x0, out === 'west' ? KEEP.z1 : KEEP.x1]);
    }
  });

  it('die Nordlinie des Palas endet an der Fuge (die Fugenspalte ist ihre Ecke), auf beiden Geschossen gleich', () => {
    const palas = (after.facadeGrid ?? []).filter((g) => g.out === 'north' && g.plane === 0 && g.to === 28);
    expect(palas.map((g) => g.from)).toEqual([KEEP.x1, KEEP.x1]);
    expect(new Set(palas.map((g) => JSON.stringify(g.bays.map((b) => b.axis)))).size).toBe(1);
  });

  it('F1: die Fenster des Bergfrieds fluchten über alle Geschosse (je Seite dieselben Spalten)', () => {
    const cols = (out: 'north' | 'south' | 'west', plane: number): string[] => {
      const ns = out !== 'west';
      const win = after.cells.filter((c) => c.kind === 'window' && (ns ? c.pos[2] === plane : c.pos[0] === plane) && (ns ? c.pos[0] <= KEEP.x1 : c.pos[2] <= KEEP.z1));
      const byFloor = new Map<number, Set<number>>();
      for (const c of win) {
        const room = after.rooms.get(c.roomId!)!;
        (byFloor.get(room.floorIndex) ?? byFloor.set(room.floorIndex, new Set()).get(room.floorIndex)!).add(ns ? c.pos[0] : c.pos[2]);
      }
      return [...byFloor.values()].map((s) => [...s].sort((a, b) => a - b).join(','));
    };
    for (const [out, plane] of [['north', KEEP.z0], ['south', KEEP.z1], ['west', KEEP.x0]] as const) {
      const floors = cols(out, plane);
      expect(floors.length, out).toBeGreaterThanOrEqual(3);
      expect(new Set(floors).size, `${out}: ${floors.join(' | ')}`).toBe(1);
    }
  });

  it('keine Rasterlinie auf der Brandwand (keine Außenluft davor)', () => {
    const fire = (after.facadeGrid ?? []).filter((g) => g.out === 'east' && g.plane === KEEP.x1 && g.y0 < 5);
    expect(fire).toEqual([]);
  });

  it('ohne zweiten Baukörper wirkungslos', () => {
    const solo = (detail: RoofDetail): Shell => {
      const p = volumeProject();
      p.addFloor();
      p.changeVolume(DEFAULT_VOLUME, { name: 'Turm', roof: 'flat', roofDetail: detail });
      p.paintRoom(0, CellSet.rect(0, 0, 8, 8), 'storage');
      p.paintRoom(1, CellSet.rect(0, 0, 8, 8), 'library');
      return deriveShell(p.state, OPTS);
    };
    expect(solo({ trim: true, shaftGrid: true })).toEqual(solo({ trim: true }));
  });
});
