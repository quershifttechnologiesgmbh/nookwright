import { describe, expect, it } from 'vitest';
import { cellKey, type Cell, type HorizontalDir } from '@mcda/core';
import { STAIR_LIMITS, StairError, stairLayout, type StairLayout, type StairTurn, type StairType } from '../src/index.js';
import { DIRS, STEP } from '../src/shell/grid.js';

const k = (c: Cell): string => cellKey(c[0], c[1]);
const adj = (a: Cell, b: Cell): boolean => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

/**
 * Begehbarkeit mit Minecraft-Maßen: Füße stehen auf dem obersten Block einer Spalte (unten: Boden, Füße 1;
 * oben: Bodenplatte, Füße rise+1). Ein Schritt geht zur Nachbarspalte, gleich hoch oder abwärts, aufwärts nur
 * um 1 und nur auf eine Treppe (Halbstufe). Kopffreiheit: Füße und Kopf frei, also darf über einer Spalte die
 * obere Bodenplatte nur liegen, wenn der Kopf (Füße + 1) darunter bleibt.
 */
function walkable(l: StairLayout, rise: number): boolean {
  const top = new Map<string, { dy: number; part: string }>();
  for (const b of l.blocks) {
    const cur = top.get(k(b.cell));
    if (cur === undefined || b.dy > cur.dy) top.set(k(b.cell), { dy: b.dy, part: b.part });
  }
  const open = new Set([...l.holes, ...l.top].map(k));
  const feet = (c: Cell): number | undefined => {
    if (k(c) === k(l.bottom.inside)) return 1;
    if (k(c) === k(l.arrival.inside)) return rise + 1;
    const t = top.get(k(c));
    if (t === undefined || t.part === 'post' || t.part === 'fill') return undefined;
    return t.dy + 1;
  };
  const headroom = (c: Cell, f: number): boolean => f + 1 < rise || open.has(k(c)) || f > rise;
  const cells: Cell[] = [l.bottom.inside, l.arrival.inside, ...l.footprint];
  const seen = new Set([k(l.bottom.inside)]);
  const queue: Cell[] = [l.bottom.inside];
  while (queue.length > 0) {
    const a = queue.shift()!;
    const fa = feet(a)!;
    if (k(a) === k(l.arrival.inside)) return true;
    for (const b of cells) {
      if (seen.has(k(b)) || !adj(a, b)) continue;
      const fb = feet(b);
      if (fb === undefined || !headroom(b, fb)) continue;
      const stepUp = fb - fa;
      if (stepUp > 1 || (stepUp === 1 && top.get(k(b))?.part !== 'tread')) continue;
      seen.add(k(b));
      queue.push(b);
    }
  }
  return false;
}

const TYPES: ReadonlyArray<StairType> = ['straight', 'l', 'u', 'spiral'];
const TURNS: ReadonlyArray<StairTurn> = ['left', 'right'];

describe('stairLayout – Treppengeometrie', () => {
  it('gerade Treppe, lichte Höhe 3: 4 Stufen, die oberste in der Bodenplatte, Öffnung über Stufe 2 und 3', () => {
    const l = stairLayout({ type: 'straight', origin: [0, 0], facing: 'east' }, 4);
    const treads = l.blocks.filter((b) => b.part === 'tread');
    expect(treads.map((b) => [b.cell[0], b.dy, b.facing])).toEqual([[0, 1, 'east'], [1, 2, 'east'], [2, 3, 'east'], [3, 4, 'east']]);
    expect(l.blocks.filter((b) => b.part === 'fill')).toHaveLength(0 + 1 + 2 + 3);
    expect(l.holes.map(k)).toEqual(['1,0', '2,0']);
    expect(l.top.map(k)).toEqual(['3,0']);
    expect(l.bottom).toEqual({ inside: [-1, 0], toward: 'east' });
    expect(l.arrival).toEqual({ inside: [4, 0], toward: 'west' });
  });

  for (const type of TYPES) {
    it(`${type}: begehbar mit Kopffreiheit für alle Etagenabstände, Richtungen und Drehsinne`, () => {
      const maxRise = type === 'spiral' ? STAIR_LIMITS.spiralMaxRise : 10;
      for (let rise = STAIR_LIMITS.minRise; rise <= maxRise; rise++) {
        for (const facing of DIRS) {
          for (const turn of TURNS) {
            const l = stairLayout({ type, origin: [5, 5], facing, turn }, rise);
            const tag = `${type} rise=${rise} ${facing} ${turn}`;
            // keine doppelten Blöcke, jede Spalte lückenlos von 1 bis zur Trittfläche
            const pos = l.blocks.map((b) => `${k(b.cell)}@${b.dy}`);
            expect(new Set(pos).size, tag).toBe(pos.length);
            const cols = new Map<string, number[]>();
            for (const b of l.blocks) cols.set(k(b.cell), [...(cols.get(k(b.cell)) ?? []), b.dy]);
            for (const [c, ys] of cols) expect(ys.sort((a, b) => a - b), `${tag} Spalte ${c}`).toEqual(Array.from({ length: ys.length }, (_, i) => i + 1));
            // oberste Stufe liegt in der Bodenplatte, Zugänge liegen neben der Treppe und außerhalb
            expect(l.top.length, tag).toBe(1);
            expect(cols.get(k(l.top[0]!))!.at(-1), tag).toBe(rise);
            const fp = new Set(l.footprint.map(k));
            expect(fp.has(k(l.bottom.inside)) || fp.has(k(l.arrival.inside)), tag).toBe(false);
            const toward = (a: { inside: Cell; toward: HorizontalDir }): string => k([a.inside[0] + STEP[a.toward][0], a.inside[1] + STEP[a.toward][1]]);
            expect(fp.has(toward(l.bottom)) && fp.has(toward(l.arrival)), tag).toBe(true);
            // erste Stufe in Laufrichtung
            expect(l.blocks.find((b) => b.part === 'tread' && b.dy === 1)?.facing, tag).toBe(facing);
            expect(walkable(l, rise), tag).toBe(true);
          }
        }
      }
    });
  }

  it('Öffnung genau über den Trittflächen mit dy ∈ [Δ−2, Δ−1]; ohne Öffnung stößt man sich den Kopf', () => {
    const l = stairLayout({ type: 'straight', origin: [0, 0], facing: 'south' }, 5);
    expect(l.holes.map(k)).toEqual(['0,2', '0,3']);
    expect(walkable({ ...l, holes: l.holes.slice(1) }, 5)).toBe(false);
  });

  it('Wendeltreppe: 3×3 um einen Pfosten, höchstens 7 Stufen', () => {
    const l = stairLayout({ type: 'spiral', origin: [0, 0], facing: 'north', turn: 'right' }, 4);
    // Mitte rechts von der ersten Stufe (im Uhrzeigersinn)
    expect(l.blocks.filter((b) => b.part === 'post').map((b) => k(b.cell))).toEqual(['1,0', '1,0', '1,0']);
    expect(l.footprint).toHaveLength(5);
    expect(() => stairLayout({ type: 'spiral', origin: [0, 0], facing: 'north' }, 8)).toThrow(StairError);
  });

  it('Leiter: Leiterblöcke bis in die Bodenplatte, Blick weg von der Wand, Loch oben', () => {
    const l = stairLayout({ type: 'ladder', origin: [0, 0], facing: 'north' }, 4);
    expect(l.blocks.filter((b) => b.part === 'ladder').map((b) => [b.dy, b.facing])).toEqual([[1, 'south'], [2, 'south'], [3, 'south'], [4, 'south']]);
    expect(l.support).toEqual([0, -1]);
    expect(l.holes.map(k)).toEqual(['0,0']);
    expect(l.bottom.inside).toEqual([0, 1]);
    expect(l.arrival.inside).toEqual([0, 1]);
  });

  it('zu geringer Etagenabstand wird abgelehnt', () => {
    expect(() => stairLayout({ type: 'straight', origin: [0, 0], facing: 'east' }, 2)).toThrow(/zu klein/);
  });
});
