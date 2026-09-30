import { describe, expect, it } from 'vitest';
import { CellSet, cellKey, key3, type Cell, type HorizontalDir } from '@mcda/core';
import {
  Project, TARGET_VERSIONS, deriveShell, renderShellPlan, stairLayout,
  type ProjectState, type Shell, type ShellCell, type ShellOptions, type StairTurn, type StairType,
} from '../src/index.js';
import { STEP } from '../src/shell/grid.js';

const HIP: ShellOptions = { roof: 'hip' };
const GABLE: ShellOptions = { roof: 'gable' };
const FLAT: ShellOptions = { roof: 'flat' };
const WALLISH = new Set<ShellCell['kind']>(['wall', 'pillar', 'door', 'window', 'lintel']);

function project(height = 3): Project {
  return Project.create({ id: 'p', name: 'Haus', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height } });
}

/** Wie das Beispielhaus der Pipeline: 4 Räume unten, 3 oben (ohne Schmiede), gerade Treppe im Lager. */
function twoStory(): Project {
  const p = project();
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 8, 6), 'bedroom');
  p.paintRoom(1, CellSet.rect(9, 0, 14, 6), 'alchemy');
  p.paintRoom(1, CellSet.rect(0, 7, 14, 11), 'library');
  p.placeStairs(0, [3, 10], 'east');
  return p;
}

/** Halle 13×11 auf zwei Etagen (für alle Treppenarten). */
function halls(height = 3): Project {
  const p = project(height);
  p.paintRoom(0, CellSet.rect(0, 0, 12, 10), 'storage');
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 12, 10), 'library');
  return p;
}

const dirStep = (c: Cell, d: HorizontalDir): Cell => [c[0] + STEP[d][0], c[1] + STEP[d][1]];

/** Räume, die vom Haupteingang über Türen und Treppen erreichbar sind. */
export function reachable(shell: Shell): Set<string> {
  const byDoor = new Map<string, string[]>();
  const byLink = new Map<string, string[]>();
  let main: string | undefined;
  for (const [id, r] of shell.rooms) {
    for (const d of r.doors) {
      const [x, z] = dirStep(d.inside, d.toward);
      const k = `${r.floorIndex}:${x},${z}`;
      byDoor.set(k, [...(byDoor.get(k) ?? []), id]);
      if (d.isMain) main = id;
    }
    for (const s of r.stairs ?? []) byLink.set(s.linkId, [...(byLink.get(s.linkId) ?? []), id]);
  }
  const seen = new Set<string>(main !== undefined ? [main] : []);
  const groups = [...byDoor.values(), ...byLink.values()];
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of groups) if (g.some((r) => seen.has(r))) for (const r of g) if (!seen.has(r)) (seen.add(r), (grew = true));
  }
  return seen;
}

/** Invarianten über alle Etagen. */
function checkFloors(state: ProjectState, shell: Shell): void {
  const byPos = new Map<string, ShellCell>();
  for (const c of shell.cells) {
    expect(byPos.has(key3(c.pos)), `doppelte Zelle ${key3(c.pos)}`).toBe(false);
    byPos.set(key3(c.pos), c);
  }
  const at = (x: number, y: number, z: number): ShellCell | undefined => byPos.get(key3([x, y, z]));
  const footprint = (f: number): Set<string> => new Set(state.rooms.filter((r) => r.floorIndex === f).flatMap((r) => r.cells.toArray().map(([x, z]) => cellKey(x, z))));
  for (const floor of state.floors) {
    const cells = footprint(floor.index);
    if (cells.size === 0) continue;
    const up = state.floors.find((f) => f.index === floor.index + 1);
    const upCells = footprint(floor.index + 1);
    const ceilingY = floor.y0 + floor.height + 1;
    for (const k of cells) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      // Decke: eigene Deckenzelle, oder die Bodenplatte / Treppe / Öffnung der Etage darüber
      const c = at(x, ceilingY, z);
      if (up !== undefined && upCells.has(k)) expect(c?.kind === 'floor' || c?.kind === 'stairs' || c === undefined, `Decke ${k} = Boden oben`).toBe(true);
      else expect(c?.kind, `Decke ${k}`).toBe('ceiling');
    }
  }
  // Raumsichten
  for (const [id, r] of shell.rooms) {
    const blocked = r.blocked ?? CellSet.empty();
    for (const [x, z] of blocked) expect(r.interior.has(x, z), `${id}: gesperrt außerhalb der Innenfläche`).toBe(true);
    for (const s of r.stairs ?? []) {
      expect(r.interior.has(s.inside[0], s.inside[1]) && !blocked.has(s.inside[0], s.inside[1]), `${id}: Zugang ${s.inside} frei`).toBe(true);
      const [x, z] = dirStep(s.inside, s.toward);
      const y = s.end === 'bottom' ? r.baseY : r.baseY - 1;
      expect(at(x, y, z)?.kind, `${id}: Zugang führt zur Treppe`).toBe('stairs');
    }
    // obere Etagen: keine Außentüren
    const floorOf = state.floors.find((f) => f.index === r.floorIndex)!;
    if (floorOf.index !== 0) {
      for (const d of r.doors) {
        const [x, z] = dirStep(dirStep(d.inside, d.toward), d.toward);
        expect(footprint(r.floorIndex).has(cellKey(x, z)), `${id}: Außentür auf Etage ${r.floorIndex}`).toBe(true);
      }
    }
  }
  // Treppen: Kopffreiheit über jeder Trittfläche (2 Blöcke), Geländer auf der oberen Etage
  for (const c of shell.cells) {
    if (c.kind === 'stairs' && (c.shape === 'stairs' || c.shape === 'planks')) {
      const [x, y, z] = c.pos;
      if (at(x, y + 1, z)?.kind === 'stairs') continue; // Unterbau
      expect(at(x, y + 1, z), `Kopffreiheit über ${key3(c.pos)}`).toBeUndefined();
      expect(at(x, y + 2, z), `Kopffreiheit über ${key3(c.pos)} (+2)`).toBeUndefined();
    }
    if (c.kind === 'railing') {
      expect([c.role, c.shape]).toEqual(['beam', 'fence']);
      const info = shell.rooms.get(c.roomId!)!;
      expect(c.pos[1]).toBe(info.baseY);
      expect(info.blocked?.has(c.pos[0], c.pos[2])).toBe(true);
    }
  }
  expect([...reachable(shell)].sort(), 'alle Räume über Türen und Treppen erreichbar').toEqual(state.rooms.map((r) => r.id).sort());
}

describe('deriveShell – mehrere Etagen', () => {
  for (const opts of [HIP, GABLE, FLAT]) {
    it(`zweistöckig mit gerader Treppe (${opts.roof}): Invarianten, keine Warnungen`, () => {
      const p = twoStory();
      const shell = deriveShell(p.state, opts);
      expect(shell.warnings).toEqual([]);
      checkFloors(p.state, shell);
    });
  }

  it('Treppe: Stufen in der unteren Etage, oberste Stufe in der Bodenplatte, Öffnung und Geländer oben', () => {
    const p = twoStory();
    const shell = deriveShell(p.state, HIP);
    const at = (x: number, y: number, z: number) => shell.cells.find((c) => c.pos[0] === x && c.pos[1] === y && c.pos[2] === z);
    for (const [x, y] of [[3, 1], [4, 2], [5, 3], [6, 4]] as const) expect(at(x, y, 10), `Stufe ${x}`).toMatchObject({ kind: 'stairs', role: 'beam', shape: 'stairs', orient: { facing: 'east', half: 'bottom' } });
    expect(at(6, 1, 10)).toMatchObject({ kind: 'stairs', shape: 'planks' }); // Unterbau
    expect(at(4, 4, 10)).toBeUndefined(); // Öffnung über Stufe 2
    expect(at(5, 4, 10)).toBeUndefined(); // … und 3
    expect(at(3, 4, 10)?.kind).toBe('floor'); // über Stufe 1 liegt die Bodenplatte
    expect(at(7, 4, 10)?.kind).toBe('floor'); // Austritt
    const lib = shell.rooms.get('r7')!;
    expect(lib.stairs).toEqual([{ inside: [7, 10], toward: 'west', linkId: 's8', end: 'top' }]);
    expect(shell.rooms.get('r3')!.stairs).toEqual([{ inside: [2, 10], toward: 'east', linkId: 's8', end: 'bottom' }]);
    expect(shell.rooms.get('r3')!.blocked!.toArray().sort()).toEqual([[3, 10], [4, 10], [5, 10], [6, 10]].sort());
    expect(renderShellPlan(shell, 1)).toMatchInlineSnapshot(`
      "+---F---+--F--+
      |aaaaaaa|bbbbb|
      |aaaaaaa|bbbbb|
      Faaaaaaa|bbbbb|
      Faaaaaaa|bbbbb|
      |aaaaaaa|bbbbb|
      |aaaaaaa|bbbbb|
      +---D---+--D--+
      |ccccccccccccc|
      Fcc####ccccccc|
      |cc#ooSccccccc|
      +-F----F----F-+"
    `);
    expect(renderShellPlan(shell, 0)).toMatchInlineSnapshot(`
      "+---F---+--H---+--FF--+
      |aaaaaaa|bbbbbb|dddddd|
      |aaaaaaa|bbbbbb|dddddd|
      FaaaaaaaDbbbbbb|ddddddF
      Faaaaaaa|bbbbbb|dddddd|
      |aaaaaaa|bbbbbb|dddddd|
      |aaaaaaa|bbbbbb|dddddd|
      +---D---+------+dddddd|
      |cccccccccccccc|ddddddF
      FccccccccccccccDdddddd|
      |ccSSSScccccccc|dddddd|
      +--F--------F--+--FF--+"
    `);
  });

  for (const [type, origin, facing, turn] of [
    ['straight', [3, 5], 'east', undefined],
    ['l', [3, 6], 'east', 'left'],
    ['u', [3, 5], 'east', 'right'],
    ['spiral', [4, 5], 'north', 'right'],
    ['spiral', [4, 5], 'west', 'left'],
    ['ladder', [5, 5], 'north', undefined],
    ['ladder', [5, 1], 'north', undefined],
  ] as ReadonlyArray<readonly [StairType, Cell, HorizontalDir, StairTurn | undefined]>) {
    it(`${type} ${facing}${turn !== undefined ? ` ${turn}` : ''}: passt in die Halle, begehbar, keine Warnungen`, () => {
      for (const height of [3, 4]) {
        const p = halls(height);
        p.placeStairs(0, origin, facing, type, turn !== undefined ? { turn } : {});
        for (const opts of [HIP, GABLE]) {
          const shell = deriveShell(p.state, opts);
          expect(shell.warnings, `${type} h=${height}`).toEqual([]);
          checkFloors(p.state, shell);
          const layout = stairLayout(p.state.links[0]!, height + 1);
          const stairsCells = shell.cells.filter((c) => c.kind === 'stairs');
          expect(stairsCells.length).toBeGreaterThanOrEqual(layout.blocks.filter((b) => b.part !== 'support').length);
          if (type === 'ladder') {
            const ladder = stairsCells.filter((c) => c.shape === 'ladder');
            expect(ladder).toHaveLength(height + 1);
            expect(ladder.every((c) => c.orient?.facing === 'south' && c.role === 'ladder')).toBe(true);
            const support = layout.support!;
            const post = stairsCells.filter((c) => c.pos[0] === support[0] && c.pos[2] === support[1]);
            const wallAtSupport = shell.cells.filter((c) => c.pos[0] === support[0] && c.pos[2] === support[1] && c.pos[1] > 0 && c.pos[1] <= height);
            if (origin[1] === 1) {
              // tragende Wand: bleibt Wand (keine Tür, kein Fenster)
              expect(post).toEqual([]);
              expect(wallAtSupport.every((c) => c.kind === 'wall' || c.kind === 'pillar')).toBe(true);
            } else {
              expect(post.map((c) => [c.role, c.shape])).toEqual(Array.from({ length: height }, () => ['beam', 'log']));
            }
          }
        }
      }
    });
  }

  it('Obergeschoss ohne Treppe: Warnung, Türen zwischen den Räumen dort trotzdem', () => {
    const p = twoStory();
    p.removeStairs('s8');
    const shell = deriveShell(p.state, HIP);
    expect(shell.warnings).toEqual(['Etage 1: keine Treppe führt hierher – Räume r5, r6, r7 sind nicht erreichbar']);
    expect([...shell.rooms.values()].filter((r) => r.floorIndex === 1).every((r) => r.doors.length > 0)).toBe(true);
  });

  it('Auskragung (Balkon): Warnung mit Zellenzahl, Boden oben, darunter keine Decke', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'storage');
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 10, 6), 'bedroom');
    p.placeStairs(0, [2, 3], 'east');
    const shell = deriveShell(p.state, HIP);
    expect(shell.warnings).toEqual(['Raum r2 (Etage 1) kragt mit 14 Zellen über Etage 0 hinaus (Balkon/Auskragung ohne Unterbau)']);
    expect(shell.cells.filter((c) => c.kind === 'floor' && c.pos[1] === 4 && c.pos[0] >= 9)).toHaveLength(14);
    checkFloors(p.state, shell);
  });

  it('Treppe, die nicht mehr in die Räume passt (fremder Zustand), wird mit Warnung ignoriert', () => {
    const p = twoStory();
    const link = p.state.links[0]!;
    const shell = deriveShell({ ...p.state, links: [{ ...link, origin: [12, 10] }] }, HIP);
    expect(shell.warnings.some((w) => w.startsWith('Treppe s8 passt nicht'))).toBe(true);
    expect(shell.cells.some((c) => c.kind === 'stairs')).toBe(false);
  });

  it('deterministisch; Reihenfolge der Räume egal', () => {
    const p = twoStory();
    const a = deriveShell(p.state, GABLE);
    expect(deriveShell(p.state, GABLE)).toEqual(a);
    const shuffled = deriveShell({ ...p.state, rooms: [...p.state.rooms].reverse() }, GABLE);
    expect(shuffled.cells).toEqual(a.cells);
  });
});

describe('deriveShell – Dächer über mehreren Etagen', () => {
  const roofOf = (shell: Shell) => shell.cells.filter((c) => c.kind === 'roof');

  it('Dachregion = Grundriss(f) \\ Grundriss(f+1): unteres Dach nie unter/in der oberen Etage, gekappt auf deren Wandhöhe', () => {
    for (const opts of [HIP, GABLE]) {
      const p = twoStory();
      const shell = deriveShell(p.state, opts);
      // unteres Dach (Schmiede): Dachzellen unter der oberen Decke (y < 8) liegen nie über dem Grundriss des
      // Obergeschosses (x 0–14, z 0–11) und sind auf die Oberkante seiner Wand gekappt (y0 4 + Höhe 3)
      const lower = roofOf(shell).filter((c) => c.pos[1] < 8);
      expect(lower.length).toBeGreaterThan(0);
      const upper = (x: number, z: number): boolean => x >= 0 && x <= 14 && z >= 0 && z <= 11;
      for (const c of lower) expect(upper(c.pos[0], c.pos[2]), `${opts.roof}: unteres Dach im Obergeschoss ${key3(c.pos)}`).toBe(false);
      expect(Math.max(...lower.map((c) => c.pos[1]))).toBe(7);
      // Pultdach: Dachtreppen der Schmiede steigen zur Wand des Obergeschosses (Westen) oder zu den Seiten, nie nach Osten weg
      const rising = lower.filter((c) => c.shape === 'stairs' && c.pos[1] >= 6);
      expect(rising.some((c) => c.orient?.facing === 'west')).toBe(true);
      // Fenster des Obergeschosses, die das Dach verdecken würde, entfallen (Ostwand x = 14)
      expect(shell.cells.filter((c) => c.kind === 'window' && c.pos[0] === 14 && c.pos[1] > 4)).toEqual([]);
    }
  });

  it('Satteldach: First entlang der Langseite, Giebelwände an den Schmalseiten', () => {
    const p = project();
    p.paintRoom(0, CellSet.rect(0, 0, 10, 6), 'storage'); // 11×7, Decke y = 4
    const shell = deriveShell(p.state, GABLE);
    expect(shell.warnings).toEqual([]);
    const roof = roofOf(shell);
    // Traufe (Überstand) auf Deckenhöhe, First in der Mitte (z = 3) als Stufe
    expect(roof.filter((c) => c.shape === 'slab').map((c) => c.pos[2])).toEqual(Array.from({ length: 13 }, () => 3));
    for (const c of roof.filter((x) => x.shape === 'stairs')) expect(c.orient!.facing).toBe(c.pos[2] < 3 ? 'south' : 'north');
    // Giebeldreiecke an x = 0 und x = 10: Wandblöcke über der Decke, bis unter das Dach
    const gable = shell.cells.filter((c) => c.kind === 'wall' && c.pos[1] > 4);
    expect(new Set(gable.map((c) => c.pos[0]))).toEqual(new Set([0, 10]));
    for (const c of gable) {
      const above = roof.find((r) => r.pos[0] === c.pos[0] && r.pos[2] === c.pos[2])!;
      expect(c.pos[1]).toBeLessThan(above.pos[1]);
    }
    expect(gable).toHaveLength(2 * (1 + 2 + 3 + 2 + 1)); // Zeilen z = 1…5 (Wand an z = 0/6 ohne Lücke)
  });

  it('Satteldach auf L, T, U, Plus: benachbarte Dachzellen springen höchstens um 1', () => {
    const shapes: Record<string, ReadonlyArray<readonly [number, number, number, number]>> = {
      L: [[0, 0, 10, 4], [0, 5, 4, 12]],
      T: [[0, 0, 14, 4], [5, 5, 9, 12]],
      U: [[0, 0, 14, 4], [0, 5, 4, 10], [10, 5, 14, 10]],
      plus: [[6, 0, 10, 16], [0, 6, 16, 10]],
    };
    for (const [name, list] of Object.entries(shapes)) {
      const p = project();
      for (const [x1, z1, x2, z2] of list) p.paintRoom(0, CellSet.rect(x1, z1, x2, z2), 'storage');
      const shell = deriveShell(p.state, GABLE);
      const h = new Map(roofOf(shell).map((c) => [cellKey(c.pos[0], c.pos[2]), c.pos[1]] as const));
      for (const [k, y] of h) {
        const [x, z] = k.split(',').map(Number) as [number, number];
        for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
          const o = h.get(cellKey(x + dx, z + dz));
          if (o !== undefined) expect(Math.abs(o - y), `${name} ${k}`).toBeLessThanOrEqual(1);
        }
      }
      // keine offenen Dachböden: jede Außenwand-Spalte reicht bis unter das Dach
      const cols = new Map<string, number[]>();
      for (const c of shell.cells) if (WALLISH.has(c.kind)) cols.set(cellKey(c.pos[0], c.pos[2]), [...(cols.get(cellKey(c.pos[0], c.pos[2])) ?? []), c.pos[1]]);
      for (const c of shell.cells.filter((x) => x.kind === 'wall' && x.exterior === true && x.pos[1] === 3)) {
        const roofY = h.get(cellKey(c.pos[0], c.pos[2]))!;
        const top = Math.max(...cols.get(cellKey(c.pos[0], c.pos[2]))!);
        expect(Math.max(top, 4), `${name}: Lücke unter dem Dach bei ${cellKey(c.pos[0], c.pos[2])}`).toBeGreaterThanOrEqual(roofY - 1);
      }
    }
  });
});
