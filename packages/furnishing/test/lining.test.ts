/**
 * W2-FD (Baustandard I1/I4/I6): Innenhaut-Planer, Hauptweg und Deko-Budget. Rein, ohne Materialisierung.
 */
import { describe, expect, it } from 'vitest';
import { liningRecipeFor, type LiningRecipe } from '@mcda/catalog';
import { CellSet, cellKey, key3 } from '@mcda/core';
import {
  analyzeRoom, expandComponent, furnishRoom, placeComponent, planLining, planPath, type LiningBoundary, type RoomGeometry,
} from '../src/index.js';
import { pose } from '@mcda/core';
import { DV, catalog, shellRoom } from './fixtures.js';

const RECIPE: LiningRecipe = liningRecipeFor([{}], { storey: 0, height: 3 })!;

/** Wandflächen wie die Hülle: Außenring = Mauerwerk, Tür- und Fensterzellen der Geometrie. */
function boundaryOf(g: RoomGeometry): (x: number, y: number, z: number) => LiningBoundary {
  const step: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const door = new Set(g.doors.map((d) => cellKey(d.inside[0] + step[d.toward]![0], d.inside[1] + step[d.toward]![1])));
  const glass = new Set(g.windows.map((w) => cellKey(w.inside[0] + step[w.toward]![0], w.inside[1] + step[w.toward]![1])));
  return (x, y, z) => {
    const k = cellKey(x, z);
    const r = y - g.baseY;
    if (door.has(k) && r < 2) return 'door';
    if (glass.has(k) && r >= 1 && r < 2) return 'glass';
    return 'wall';
  };
}

describe('Innenhaut: Rezept aus den Theme-Regeln', () => {
  it('erste passende Regel gewinnt; off und panel: false', () => {
    const rules = [{ when: { roomTypes: ['library'] }, panel: { role: 'a' }, trim: { role: 'b' } }, { when: { storey: [-4, -1] as [number, number] }, off: true }, {}];
    expect(liningRecipeFor(rules, { roomType: 'library', storey: 0, height: 3 })?.panel?.role).toBe('a');
    expect(liningRecipeFor(rules, { roomType: 'kitchen', storey: -1, height: 3 })).toBeUndefined();
    const plain = liningRecipeFor(rules, { roomType: 'kitchen', storey: 0, height: 3 })!;
    expect(plain.panel).toEqual({ role: 'lining_panel', shape: 'trapdoor' });
    expect(plain.crown).toEqual({ role: 'lining_trim', shape: 'stairs' });
    expect(liningRecipeFor([{ panel: false }], { storey: 0, height: 3 })?.skirting).toBeUndefined();
    expect(liningRecipeFor(undefined, { storey: 0, height: 3 })).toBeUndefined();
  });
});

describe('Innenhaut: Planer', () => {
  const g = shellRoom(9, 8);
  const cells = planLining({ geometry: g, boundary: boundaryOf(g), placed: [], recipe: RECIPE });
  const at = new Map(cells.map((c) => [key3(c.pos), c]));

  it('leerer Raum: jede Wandfläche bekommt Sockel, Paneel bzw. Deckenleiste; freie Innenecken einen Ständer', () => {
    // Nordwand, Mitte: Reihe 0 Sockel, 1 Paneel (Fenster? nein: Nordwand hat Fenster bei windowSlots), 2 Leiste
    const parts = (x: number, z: number) => [0, 1, 2].map((r) => at.get(key3([x, g.baseY + r, z]))?.part);
    expect(parts(0, 0)).toEqual(['post', 'post', 'crown']);
    expect(parts(6, 0)).toEqual(['post', 'post', 'crown']);
    // Innenzellen ohne Wand: nichts
    expect(parts(3, 3)).toEqual([undefined, undefined, undefined]);
    // Falltür offen, Rücken zur Wand (facing weg von der Wand)
    const wallCell = cells.find((c) => c.part === 'skirting' && c.pos[2] === 0 && c.pos[0] > 0 && c.pos[0] < 6)!;
    expect(wallCell.orient).toEqual({ facing: 'south', half: 'bottom', open: true });
    const crown = cells.find((c) => c.part === 'crown' && c.pos[2] === 0 && c.pos[0] === 3)!;
    expect(crown.orient).toEqual({ facing: 'north', half: 'top' });
  });

  it('Fenster und Türöffnung bleiben frei, neben der Tür steht der Rahmen', () => {
    for (const w of g.windows) expect(at.get(key3([w.inside[0], g.baseY + 1, w.inside[1]])), `Fenster ${w.inside}`).toBeUndefined();
    const d = g.doors[0]!;
    expect(at.get(key3([d.inside[0], g.baseY, d.inside[1]]))).toBeUndefined();
    expect(at.get(key3([d.inside[0], g.baseY + 1, d.inside[1]]))).toBeUndefined();
    expect(at.get(key3([d.inside[0], g.baseY + 2, d.inside[1]]))?.part).toBe('crown');
    for (const dx of [-1, 1]) {
      expect(at.get(key3([d.inside[0] + dx, g.baseY, d.inside[1]]))?.part).toBe('jamb');
      expect(at.get(key3([d.inside[0] + dx, g.baseY + 1, d.inside[1]]))?.part).toBe('jamb');
    }
  });

  it('Möbel gewinnen: keine Innenhaut in Möbelzellen, nie über Lagerfeuer; Ständer nie über einer Truhe', () => {
    const chest = placeComponent(expandComponent(catalog.get('storage/chest')), pose([0, g.baseY, 1], 0));
    const res = planLining({ geometry: g, boundary: boundaryOf(g), placed: [chest], recipe: RECIPE });
    const k = new Set(res.map((c) => key3(c.pos)));
    for (const c of chest.cells) expect(k.has(key3(c.pos))).toBe(false);
    // über der Truhe (Ecke? nein, Wandzelle): Paneel erlaubt (Falltür leitet nicht), aber kein Ständer
    const above = res.find((c) => c.pos[0] === 0 && c.pos[2] === 1 && c.pos[1] === g.baseY + 1);
    expect(above?.part).not.toBe('post');
  });

  it('kein Ständer in schmalen Fluren (kurze Innenseite < 3)', () => {
    const hall = shellRoom(4, 12, { doorSide: 'south' });
    const res = planLining({ geometry: hall, boundary: boundaryOf(hall), placed: [], recipe: RECIPE });
    expect(res.filter((c) => c.part === 'post')).toEqual([]);
  });
});

describe('Hauptweg 2 breit (I6)', () => {
  it('von der Tür in die Raummitte, 2 breit; kleine Räume ohne Weg', () => {
    const g = shellRoom(10, 9);
    const path = planPath(analyzeRoom(g))!;
    expect(path.has(g.doors[0]!.inside[0], g.doors[0]!.inside[1])).toBe(true);
    for (const [x, z] of path) {
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => path.has(x + dx!, z + dz!)).length;
      expect(n, `Wegzelle ${x},${z} hat einen Nachbarn im Weg`).toBeGreaterThan(0);
    }
    expect(path.size).toBeGreaterThanOrEqual(6);
    expect(planPath(analyzeRoom(shellRoom(5, 5)))).toBeUndefined();
  });

  it('der Solver hält den Weg frei (nur Durchlaufbares in Laufhöhe) und erfüllt die Pflichtmöbel', () => {
    const g = shellRoom(10, 9);
    const res = furnishRoom(g, catalog.roomType('kitchen'), catalog, { seed: 7, dataVersion: DV });
    // W7 (27.09.2026): die Küche hat eine Insel (Küchentisch in der Mitte) – der Weg führt dann außen herum; geprüft wird
    // der Weg, den der Solver genommen hat (mit Insel derselbe `planPath` wie ohne, nur um die Insel)
    const path = res.analysis.path!;
    expect(res.analysis.island === undefined ? planPath(analyzeRoom(g)) : planPath({ ...analyzeRoom(g), island: res.analysis.island })).toEqual(path);
    const blocked = res.placed.filter((p) => !p.expanded.walkable).flatMap((p) => p.cells).filter((c) => c.pos[1] <= g.baseY + 1 && path.has(c.pos[0], c.pos[2]));
    expect(blocked).toEqual([]);
    expect(res.warnings.filter((w) => w.startsWith('Pflichtobjekt'))).toEqual([]);
  });
});

describe('W5 (27.09.2026, Review N6): Hauptweg schonend an der Treppe, Lager mit Weg von Tür zu Treppe', () => {
  /** Küche wie im Stadthaus: Treppenloch an der Westwand (Zugang oben links), Türen unten und rechts. */
  const kitchen = (): RoomGeometry => {
    const blocked = CellSet.rect(0, 1, 0, 4);
    const g = shellRoom(7, 8, { doorSide: 'east', doorAt: 5, blocked });
    return {
      ...g,
      interior: g.interior.difference(blocked),
      doors: [...g.doors, { inside: [0, 0], toward: 'south', isMain: false }, { inside: [2, 5], toward: 'south', isMain: false }],
      windows: [...g.windows.filter((w) => !blocked.has(w.inside[0], w.inside[1])), ...[1, 2, 3, 4].map((z) => ({ inside: [1, z] as [number, number], toward: 'west' as const }))],
    };
  };
  /** 2 × 2-Felder des Wegs hängen von der ersten Tür zu allen übrigen zusammen (Kennzahl „Hauptweg 2 breit“). */
  const squareConnected = (path: CellSet, doors: readonly (readonly [number, number])[]): boolean => {
    const wide = (x: number, z: number): boolean => [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([a, b]) => [[0, 0], [1, 0], [0, 1], [1, 1]].every(([c, d]) => path.has(x + a! + c!, z + b! + d!)));
    const door = new Set(doors.map(([x, z]) => cellKey(x, z)));
    const seen = new Set([cellKey(doors[0]![0], doors[0]![1])]);
    const q = [doors[0]!];
    while (q.length > 0) {
      const [x, z] = q.pop()!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = cellKey(x + dx, z + dz);
        if (seen.has(k) || !path.has(x + dx, z + dz) || !(wide(x + dx, z + dz) || door.has(k))) continue;
        seen.add(k);
        q.push([x + dx, z + dz]);
      }
    }
    return [...door].every((k) => seen.has(k));
  };

  it('`spare`: Weg aus ganzen 2 × 2-Feldern, an der offenen Kante (Treppe) entlang, die feste Ostwand bleibt frei', () => {
    const g = kitchen();
    const a = analyzeRoom(g);
    const spare = planPath(a, 'spare')!;
    expect(squareConnected(spare, g.doors.map((d) => d.inside))).toBe(true);
    // an der Treppe (x = 1) läuft der Weg, die Ostwand (x = 4) trägt ihn nur an der Tür
    expect([1, 2, 3, 4].filter((z) => spare.has(1, z)).length).toBeGreaterThanOrEqual(3);
    expect([1, 2, 3].filter((z) => spare.has(4, z))).toEqual([]);
    expect(planPath(a, 'spare')).toEqual(spare);
    // Standard unverändert: `open` ist der bisherige Weg (bitgleich)
    expect(planPath(a)).toEqual(planPath(a, 'open'));
  });

  it('Lager (`aisle.doorPath`): Weg von der Tür zur Treppe frei, Ware an der Wand', () => {
    const rt = catalog.roomType('storage');
    expect(rt.aisle?.doorPath).toBe(true);
    const blocked = CellSet.rect(1, 1, 4, 1);
    const base = shellRoom(12, 6, { blocked });
    const g: RoomGeometry = { ...base, interior: base.interior.difference(blocked), doors: [...base.doors, { inside: [0, 1], toward: 'east', isMain: false }] };
    for (const seed of [1, 2, 3]) {
      const res = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
      const path = planPath(analyzeRoom(g))!;
      const inWay = res.placed.filter((p) => !p.expanded.walkable).flatMap((p) => p.cells).filter((c) => c.pos[1] <= g.baseY + 1 && path.has(c.pos[0], c.pos[2]));
      expect(inWay, `Seed ${seed}`).toEqual([]);
      expect(res.warnings.filter((w) => w.startsWith('Pflichtobjekt'))).toEqual([]);
    }
  });
});

describe('Deko-Budget (I6)', () => {
  it('reine Deko je Fläche begrenzt; Kinder derselben Komponente höchstens dreimal, Essen einmal', () => {
    for (const [rt, seed] of [['bedroom', 1], ['kitchen', 2], ['tavern', 3], ['solar', 4]] as const) {
      const g = shellRoom(12, 10);
      const res = furnishRoom(g, catalog.roomType(rt), catalog, { seed, dataVersion: DV });
      const area = g.interior.size;
      const decor = res.placed.filter((p) => ['decor', 'attachment'].includes(catalog.get(p.expanded.defId).category));
      // Budget 2 + Fläche/14; Pflicht-Andockpunkte (z. B. Schneidebrett auf der Theke) zählen nicht dagegen → +2 Spiel
      expect(decor.length, `${rt}: ${decor.map((p) => p.expanded.defId).join(', ')}`).toBeLessThanOrEqual(Math.round(2 + area / 14) + 2);
      const food = res.placed.filter((p) => catalog.get(p.expanded.defId).tags.includes('food'));
      for (const id of new Set(food.map((p) => p.expanded.defId))) expect(food.filter((p) => p.expanded.defId === id).length, `${rt} ${id}`).toBeLessThanOrEqual(1);
    }
  });
});
