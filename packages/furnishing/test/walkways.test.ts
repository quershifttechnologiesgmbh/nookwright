/**
 * W8-B „Wege im Raum“: Netz (Taschen, einziger Durchgang, 2 breit), Regel `useAccess` im Solver und Kennzahlen.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, cellKey } from '@mcda/core';
import { analyzeRoom, furnishRoom, roomWalkways, walkwayPart } from '../src/index.js';
import { accessCellOK, POCKET_MAX, walkNet, walkwayMetrics } from '../src/walkways.js';
import { catalog, DV, shellRoom } from './fixtures.js';

/** Raum aus ASCII: `#` belegt, `.` frei, `D` Tür (frei). Innenfläche = alle Zeichen. */
function fromAscii(rows: readonly string[]) {
  const cells: [number, number][] = [];
  const taken = new Set<string>();
  let door: [number, number] = [0, 0];
  rows.forEach((r, z) => [...r].forEach((ch, x) => {
    cells.push([x, z]);
    if (ch === '#') taken.add(cellKey(x, z));
    if (ch === 'D') door = [x, z];
  }));
  const a = analyzeRoom({ roomId: 't', baseY: 1, height: 3, interior: CellSet.of(cells), doors: [{ inside: door, toward: 'south', isMain: true }], windows: [] });
  return { a, taken };
}

describe('walkNet', () => {
  it('Sackgasse: Tiefe je Zelle, Nische der Tiefe 1 taugt, tiefer nicht', () => {
    const { a: c, taken: t3 } = fromAscii([
      '....#',
      '###.#',
      '.....',
      '.....',
      '..D..',
    ]);
    const n3 = walkNet(c, t3);
    // Gang (3,1) → (3,0) → (2,0) … (0,0): Tiefe 1, 2, 3 …
    expect(n3.pocket[1 * n3.w + 3]).toBe(1);
    expect(n3.pocket[0 * n3.w + 3]).toBe(2);
    expect(n3.pocket[0 * n3.w + 0]).toBe(5);
    expect(accessCellOK(n3, [3, 1])).toBe(POCKET_MAX >= 1);
    expect(accessCellOK(n3, [1, 0])).toBe(false);
    // die breite Fläche unten ist Kern und 2 breit
    expect(n3.pocket[3 * n3.w + 2]).toBe(0);
    expect(n3.wide[3 * n3.w + 2]).toBe(1);
  });

  it('einziger Durchgang zwischen zwei Flächen ist kein tauglicher Nutzungsplatz', () => {
    const { a, taken } = fromAscii([
      '...#...',
      '.......',
      '...#...',
      'D..#...',
    ]);
    const net = walkNet(a, taken);
    expect(net.cut[1 * net.w + 3]).toBe(1);
    expect(accessCellOK(net, [3, 1])).toBe(false);
    expect(net.cut[1 * net.w + 2]).toBe(1); // die Zellen davor und dahinter gehören zur selben Engstelle
    expect(accessCellOK(net, [1, 1])).toBe(true);
    const m = walkwayMetrics(a, taken, [[[3, 1]], [[1, 1], [0, 0]]]);
    expect(m.groups).toBe(2);
    expect(m.violations).toBe(1);
    expect(m.bottlenecks).toBe(1);
  });

  it('Türinnenzelle am Ende eines Gangs ist Ausgang, keine Sackgasse', () => {
    const { a, taken } = fromAscii([
      '.....',
      '.....',
      '##.##',
      '##D##',
    ]);
    const net = walkNet(a, taken);
    expect(net.pocket[2 * net.w + 2]).toBe(0); // Gang zur Tür bleibt Kern …
    expect(net.cut[2 * net.w + 2]).toBe(1); // … ist aber einziger Durchgang zur Tür
  });
});

describe('Regel useAccess im Solver', () => {
  const TYPES = ['storage', 'kitchen', 'bedroom', 'smithy', 'library', 'bakery', 'barracks', 'tavern'].filter((t) => catalog.roomTypeIds().includes(t));
  it('Nutzungsseiten liegen am begehbaren Netz (Rückfall nur mit Hinweis), deterministisch', () => {
    let groups = 0;
    for (const type of TYPES) {
      for (const [w, d] of [[7, 6], [10, 8], [14, 11]] as const) {
        for (const seed of [1, 2, 3]) {
          const g = shellRoom(w, d);
          const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
          const m = roomWalkways(r.placed, r.analysis);
          groups += m.groups;
          const relaxed = r.quality.notes.some((n) => n.startsWith('Nutzungsseite'));
          if (!relaxed) expect(m.violations, `${type} ${w}×${d} Seed ${seed}`).toBe(0);
          const part = r.quality.parts.find((p) => p.id === 'walkways')!;
          expect(part.value).toBeGreaterThanOrEqual(0.6);
          expect(part.detail).toContain('Umweg');
          const again = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
          expect(again.placements).toEqual(r.placements);
        }
      }
    }
    expect(groups).toBeGreaterThan(100);
  });

  it('Teilwert: schwach gewichtet und mit deutscher Begründung', () => {
    const best = walkwayPart({ groups: 4, violations: 0, detour: 1, bottlenecks: 0, wideShare: 1 });
    expect(best.value).toBe(1);
    expect(best.label).toBe('Wege im Raum');
    const worst = walkwayPart({ groups: 4, violations: 4, detour: 3, bottlenecks: 5, wideShare: 0 });
    expect(worst.value).toBeCloseTo(0.6);
    expect(worst.detail).toContain('4 von 4 Nutzungsseiten in Sackgasse oder Durchgang');
  });
});
