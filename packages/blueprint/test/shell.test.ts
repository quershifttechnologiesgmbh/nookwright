import { describe, expect, it } from 'vitest';
import { CellSet, cellKey, key3, type Cell, type HorizontalDir } from '@mcda/core';
import { Project, TARGET_VERSIONS, deriveShell, isAtticLight, renderShellPlan, type ProjectState, type Shell, type ShellCell, type ShellOptions } from '../src/index.js';
import { CW, CCW, DIRS, STEP } from '../src/shell/grid.js';
import { windowSlots } from '../src/shell/windows.js';
import { lcg } from './support/masks.js';

// ------------------------------------------------------------------ Aufbau

interface Setup {
  readonly seed?: number;
  readonly y0?: number;
  readonly height?: number;
  /** Raumtyp je Zeichen (Standard: 'bedroom'). */
  readonly types?: Readonly<Record<string, string>>;
}

function newProject(s: Setup = {}): Project {
  return Project.create({
    id: 'p',
    name: 'Haus',
    seed: s.seed ?? 1234,
    themeId: 'medieval',
    targetVersion: TARGET_VERSIONS['1.21.11'],
    floor: { y0: s.y0 ?? 64, height: s.height ?? 3 },
  });
}

/** Grundriss als ASCII: jedes Zeichen außer '.' ist ein Raum (Malreihenfolge = Zeichenreihenfolge). */
function plan(ascii: string, s: Setup = {}): ProjectState {
  const rows = ascii
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const cells = new Map<string, Cell[]>();
  rows.forEach((row, z) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === '.') continue;
      (cells.get(ch) ?? cells.set(ch, []).get(ch)!).push([x, z]);
    }
  });
  const p = newProject(s);
  for (const ch of [...cells.keys()].sort()) p.paintRoom(0, CellSet.of(cells.get(ch)!), s.types?.[ch] ?? 'bedroom');
  return p.state;
}

/** Rechtecke nacheinander malen (spätere übermalen frühere). */
function rects(list: ReadonlyArray<readonly [number, number, number, number, string?]>, s: Setup = {}): ProjectState {
  const p = newProject(s);
  for (const [x1, z1, x2, z2, type] of list) p.paintRoom(0, CellSet.rect(x1, z1, x2, z2), type ?? 'bedroom');
  return p.state;
}

const HIP: ShellOptions = { roof: 'hip' };
const FLAT: ShellOptions = { roof: 'flat' };
const WALLISH = new Set<ShellCell['kind']>(['wall', 'pillar', 'door', 'window', 'lintel']);

// ------------------------------------------------------------------ Invarianten

interface CheckResult {
  readonly mainRoom: string | undefined;
  readonly doorCount: number;
  readonly windowCount: number;
}

function checkInvariants(state: ProjectState, shell: Shell, opts: { allReachable?: boolean } = {}): CheckResult {
  const floor = state.floors[0]!;
  const y0 = floor.y0;
  const h = floor.height;
  const base = y0 + 1;
  const roomAt = new Map<string, string>();
  for (const r of state.rooms) for (const [x, z] of r.cells) roomAt.set(cellKey(x, z), r.id);

  // keine doppelten Zellen gleicher Position
  const byPos = new Map<string, ShellCell>();
  for (const c of shell.cells) {
    const k = key3(c.pos);
    expect(byPos.has(k), `doppelte Zelle ${k}`).toBe(false);
    byPos.set(k, c);
  }
  const at = (x: number, y: number, z: number): ShellCell | undefined => byPos.get(key3([x, y, z]));

  // Boden und Decke unter/über allen Raumzellen
  for (const [k] of roomAt) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    expect(at(x, y0, z)?.kind, `Boden ${k}`).toBe('floor');
    expect(at(x, y0 + h + 1, z)?.kind, `Decke ${k}`).toBe('ceiling');
  }
  expect(shell.cells.filter((c) => c.kind === 'floor').length).toBe(roomAt.size);
  // W4 (27.09.2026): Dachraum-Licht – Laternen auf dem Dachboden sind `kind: 'ceiling'`, aber keine Deckenplatte
  expect(shell.cells.filter((c) => c.kind === 'ceiling' && !isAtticLight(c)).length).toBe(roomAt.size);

  // Interior + Wände = Raumzellen; Wandsäulen voll, Innenraum frei
  const interiorOf = new Map<string, string>();
  for (const r of state.rooms) {
    const info = shell.rooms.get(r.id)!;
    expect(info, `RoomShellInfo ${r.id}`).toBeDefined();
    expect(info.baseY).toBe(base);
    expect(info.height).toBe(h);
    const walls = new Set(shell.cells.filter((c) => c.roomId === r.id && c.pos[1] === base && WALLISH.has(c.kind)).map((c) => cellKey(c.pos[0], c.pos[2])));
    for (const [x, z] of info.interior) {
      const k = cellKey(x, z);
      interiorOf.set(k, r.id);
      expect(walls.has(k), `${k} zugleich Wand und Innen`).toBe(false);
      for (let y = base; y <= y0 + h; y++) expect(at(x, y, z), `Innenraum ${k} y=${y} nicht frei`).toBeUndefined();
    }
    const wallCells = [...walls].map((k) => k.split(',').map(Number) as [number, number]);
    expect(CellSet.of([...info.interior, ...wallCells]).equals(r.cells), `Raum ${r.id}: Interior + Wände ≠ Raumzellen`).toBe(true);
    for (const k of walls) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      for (let y = base; y <= y0 + h; y++) expect(WALLISH.has(at(x, y, z)?.kind ?? 'floor'), `Wandsäule ${k} y=${y}`).toBe(true);
    }
  }
  // kein Leck: Innenfläche nie 8-benachbart zu außen oder zur Innenfläche eines anderen Raums
  for (const [k, id] of interiorOf) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const nk = cellKey(x + dx, z + dz);
        expect(roomAt.has(nk), `Innenzelle ${k} grenzt an außen`).toBe(true);
        const other = interiorOf.get(nk);
        expect(other === undefined || other === id, `Innenzelle ${k} grenzt an Innenfläche von ${other}`).toBe(true);
      }
  }

  // Türen
  const sideOf = (x: number, z: number): string | undefined => {
    const k = cellKey(x, z);
    if (!roomAt.has(k)) return 'außen';
    return interiorOf.get(k); // undefined = Wand (ungültig)
  };
  const edges: Array<[string, string]> = [];
  let mainDoors = 0;
  const doorCols = shell.cells.filter((c) => c.kind === 'door' && c.orient?.half === 'lower');
  expect(shell.cells.filter((c) => c.kind === 'door').length).toBe(2 * doorCols.length);
  for (const d of doorCols) {
    const [x, y, z] = d.pos;
    expect(y).toBe(base);
    const f = d.orient!.facing!;
    expect(d.role).toBe('door');
    expect(d.shape).toBe('door');
    const upper = at(x, y + 1, z)!;
    expect(upper.kind).toBe('door');
    expect(upper.orient).toEqual({ ...d.orient, half: 'upper' });
    if (h > 2) expect(at(x, y + 2, z)?.kind, 'Sturz').toBe('lintel');
    // Wand links und rechts
    for (const side of [CW[f], CCW[f]]) {
      const n = at(x + STEP[side][0], y, z + STEP[side][1]);
      expect(n?.kind === 'wall' || n?.kind === 'pillar', `Tür ${x},${z}: keine Wand ${side}`).toBe(true);
    }
    // verbindet zwei Räume bzw. Raum ↔ außen
    const front = sideOf(x + STEP[f][0], z + STEP[f][1]);
    const back = sideOf(x - STEP[f][0], z - STEP[f][1]);
    expect(front, `Tür ${x},${z}: vorn keine begehbare Zelle`).toBeDefined();
    expect(back, `Tür ${x},${z}: hinten keine begehbare Zelle`).toBeDefined();
    expect(front).not.toBe(back);
    expect(front === 'außen' && back === 'außen').toBe(false);
    edges.push([front!, back!]);
    if (front === 'außen' || back === 'außen') expect(d.exterior).toBe(true);
  }
  // RoomShellInfo-Türen passen zu den Türzellen
  const doorKeys = new Set(doorCols.map((c) => cellKey(c.pos[0], c.pos[2])));
  let mainRoom: string | undefined;
  for (const [id, info] of shell.rooms) {
    for (const d of info.doors) {
      expect(info.interior.has(d.inside[0], d.inside[1]), `Tür-Innenzelle von ${id}`).toBe(true);
      const k = cellKey(d.inside[0] + STEP[d.toward][0], d.inside[1] + STEP[d.toward][1]);
      expect(doorKeys.has(k), `Tür ${k} von ${id} ohne Türzelle`).toBe(true);
      if (d.isMain) {
        mainDoors++;
        mainRoom = id;
        const [ox, oz] = [d.inside[0] + 2 * STEP[d.toward][0], d.inside[1] + 2 * STEP[d.toward][1]];
        expect(roomAt.has(cellKey(ox, oz)), 'Haustür führt nicht nach außen').toBe(false);
        const cellAtDoor = at(d.inside[0] + STEP[d.toward][0], base, d.inside[1] + STEP[d.toward][1])!;
        expect(cellAtDoor.orient?.facing, 'Haustür zeigt nach außen').toBe(d.toward);
      }
    }
  }
  const roomSideCount = edges.reduce((n, [a, b]) => n + (a === 'außen' ? 0 : 1) + (b === 'außen' ? 0 : 1), 0);
  expect([...shell.rooms.values()].reduce((n, r) => n + r.doors.length, 0)).toBe(roomSideCount);
  const noMain = shell.warnings.some((w) => w.startsWith('Keine Haustür'));
  expect(mainDoors).toBe(noMain ? 0 : 1);

  // alle Räume vom Haupteingang erreichbar (BFS über Türen)
  if (opts.allReachable ?? true) {
    expect(mainRoom, 'Haupteingang').toBeDefined();
    const seen = new Set([mainRoom!]);
    const queue = [mainRoom!];
    while (queue.length > 0) {
      const r = queue.shift()!;
      for (const [a, b] of edges) {
        const n = a === r ? b : b === r ? a : undefined;
        if (n !== undefined && n !== 'außen' && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    expect([...seen].sort()).toEqual(state.rooms.map((r) => r.id).sort());
  }

  // Fenster nur außen, 1 Block breit, richtige Höhe
  const windowCells = shell.cells.filter((c) => c.kind === 'window');
  for (const wc of windowCells) {
    const [x, y, z] = wc.pos;
    expect(y > base && y <= base + Math.min(2, h - 1), `Fensterhöhe ${y}`).toBe(true);
    expect(wc.exterior).toBe(true);
    expect(wc.role).toBe('window');
    expect(wc.shape).toBe('pane');
    const ok = DIRS.some((dir) => {
      const out = sideOf(x + STEP[dir][0], z + STEP[dir][1]);
      const inn = sideOf(x - STEP[dir][0], z - STEP[dir][1]);
      return out === 'außen' && inn !== undefined && inn !== 'außen';
    });
    expect(ok, `Fenster ${x},${z} liegt nicht zwischen Innenraum und außen`).toBe(true);
  }
  const windowCols = new Set(windowCells.map((c) => cellKey(c.pos[0], c.pos[2])));
  let infoWindows = 0;
  for (const [id, info] of shell.rooms) {
    for (const w of info.windows) {
      infoWindows++;
      expect(info.interior.has(w.inside[0], w.inside[1]), `Fenster-Innenzelle von ${id}`).toBe(true);
      expect(windowCols.has(cellKey(w.inside[0] + STEP[w.toward][0], w.inside[1] + STEP[w.toward][1]))).toBe(true);
    }
  }
  expect(infoWindows).toBe(windowCols.size);
  return { mainRoom, doorCount: doorCols.length, windowCount: windowCols.size };
}

// ------------------------------------------------------------------ Grundrisse

const LAYOUTS: Record<string, string> = {
  rect: `
    1111111
    1111111
    1111111
    1111111
    1111111`,
  two: `
    11111222222
    11111222222
    11111222222
    11111222222
    11111222222`,
  three: `
    111111111222222
    111111111222222
    111111111222222
    111111111222222
    111111111222222
    111111111222222
    111111111222222
    333333333333333
    333333333333333
    333333333333333
    333333333333333
    333333333333333`,
  L: `
    11111....
    11111....
    11111....
    111111111
    111111111
    111111111`,
  T: `
    11111111111
    11111111111
    11111111111
    11111111111
    ....111....
    ....111....
    ....111....
    ....111....`,
  U: `
    1111...1111
    1111...1111
    1111...1111
    1111...1111
    11111111111
    11111111111
    11111111111`,
  L_two_rooms: `
    22222....
    22222....
    22222....
    111111111
    111111111
    111111111`,
  T_three_rooms: `
    11111222222
    11111222222
    11111222222
    11111222222
    ...33333...
    ...33333...
    ...33333...
    ...33333...`,
  U_three_rooms: `
    1111...3333
    1111...3333
    1111...3333
    1111...3333
    22222222222
    22222222222
    22222222222`,
  grid_2x2: `
    1111122222
    1111122222
    1111122222
    1111122222
    3333344444
    3333344444
    3333344444
    3333344444`,
  room_in_room: `
    111111111
    111111111
    111111111
    111222111
    111222111
    111222111
    111111111
    111111111
    111111111`,
  ring_with_court: `
    11111111111
    11111111111
    11111111111
    111.....111
    111.....111
    111.....111
    22222222222
    22222222222
    22222222222`,
  corridor: `
    2222222333333
    2222222333333
    2222222333333
    2222222333333
    1111111111111
    1111111111111
    1111111111111
    4444444555555
    4444444555555
    4444444555555
    4444444555555`,
};

describe('deriveShell – Invarianten über viele Grundrisse', () => {
  for (const [name, ascii] of Object.entries(LAYOUTS)) {
    for (const roof of [FLAT, HIP]) {
      it(`${name} (${roof.roof})`, () => {
        const state = plan(ascii, { types: name === 'corridor' ? { '1': 'hallway' } : {} });
        const shell = deriveShell(state, roof);
        checkInvariants(state, shell);
        expect(shell.warnings).toEqual([]);
      });
    }
  }

  for (const height of [2, 3, 4, 5]) {
    it(`Wandhöhe = Etagenhöhe (${height}), Sturz nur ab Höhe 3, Fensterzeilen base+1..base+min(2, h−1)`, () => {
      const state = plan(LAYOUTS.three!, { height, y0: -10 });
      const shell = deriveShell(state, FLAT);
      checkInvariants(state, shell);
      const ys = (kind: ShellCell['kind']) => [...new Set(shell.cells.filter((c) => c.kind === kind).map((c) => c.pos[1]))].sort((a, b) => a - b);
      expect(ys('floor')).toEqual([-10]);
      expect(ys('ceiling')).toEqual([-10 + height + 1]);
      expect(Math.min(...ys('pillar'))).toBe(-9);
      expect(Math.max(...ys('pillar'))).toBe(-10 + height);
      expect(ys('lintel')).toEqual(height > 2 ? [-7] : []);
      expect(ys('window')).toEqual(height === 2 ? [-8] : [-8, -7]);
    });
  }

  it('Zufallsgrundrisse (Rechtecke übermalen sich): Invarianten halten, Unerreichbares wird gemeldet', () => {
    const rnd = lcg(99);
    let checked = 0;
    for (let iter = 0; iter < 120; iter++) {
      const list: Array<[number, number, number, number, string]> = [];
      const n = 2 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const w = 2 + Math.floor(rnd() * 9);
        const d = 2 + Math.floor(rnd() * 8);
        const x = Math.floor(rnd() * (22 - w));
        const z = Math.floor(rnd() * (16 - d));
        list.push([x, z, x + w - 1, z + d - 1, rnd() < 0.15 ? 'hallway' : 'bedroom']);
      }
      const state = rects(list, { seed: iter, height: 2 + (iter % 3) });
      const shell = deriveShell(state, iter % 2 === 0 ? HIP : FLAT);
      const res = checkInvariants(state, shell, { allReachable: false });
      // Jeder Raum ist vom Haupteingang erreichbar ODER in den Warnungen genannt.
      const reach = reachableRooms(shell, res.mainRoom);
      for (const r of state.rooms) {
        if (!reach.has(r.id)) expect(shell.warnings.some((w) => w.includes(`Raum ${r.id} `) || w.includes(` ${r.id} `)), `Raum ${r.id} still unerreichbar`).toBe(true);
      }
      checked++;
    }
    expect(checked).toBe(120);
  });
});

function reachableRooms(shell: Shell, main: string | undefined): Set<string> {
  if (main === undefined) return new Set();
  const doorRooms = new Map<string, string[]>();
  for (const [id, info] of shell.rooms)
    for (const d of info.doors) {
      const k = cellKey(d.inside[0] + STEP[d.toward][0], d.inside[1] + STEP[d.toward][1]);
      (doorRooms.get(k) ?? doorRooms.set(k, []).get(k)!).push(id);
    }
  const seen = new Set([main]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const rs of doorRooms.values()) {
      if (rs.some((r) => seen.has(r))) for (const r of rs) if (!seen.has(r)) (seen.add(r), (grew = true));
    }
  }
  return seen;
}

// ------------------------------------------------------------------ Einzelregeln

describe('deriveShell – Wände (Außenmaß)', () => {
  it('Rechteck: 4 Ecken als Pfeiler (beam/log/axis y), Rest gerade Wandfelder (wall_primary/block)', () => {
    const state = plan(LAYOUTS.rect!);
    const shell = deriveShell(state, FLAT);
    const at = (kind: ShellCell['kind']) => shell.cells.filter((c) => c.kind === kind && c.pos[1] === 65);
    expect(at('pillar').map((c) => cellKey(c.pos[0], c.pos[2])).sort()).toEqual(['0,0', '0,4', '6,0', '6,4']);
    for (const c of at('pillar')) expect([c.role, c.shape, c.orient]).toEqual(['beam', 'log', { axis: 'y' }]);
    for (const c of at('wall')) expect([c.role, c.shape, c.exterior]).toEqual(['wall_primary', 'block', true]);
    for (const c of shell.cells.filter((x) => x.kind === 'floor')) expect([c.role, c.shape]).toEqual(['floor_primary', 'block']);
    expect(shell.rooms.get('r1')!.interior.equals(CellSet.rect(1, 1, 5, 3))).toBe(true);
  });

  it('gemeinsame Wand nur einmal: der größere Raum trägt sie, der kleinere behält seine lichte Breite', () => {
    const state = plan(LAYOUTS.two!); // r1 5×5, r2 6×5
    const shell = deriveShell(state, FLAT);
    for (let z = 1; z <= 3; z++) {
      const row = shell.cells.filter((c) => c.pos[1] === 65 && c.pos[2] === z && WALLISH.has(c.kind)).map((c) => c.pos[0]);
      expect(row.sort((a, b) => a - b)).toEqual([0, 5, 10]);
    }
    const shared = shell.cells.find((c) => c.pos[0] === 5 && c.pos[1] === 65 && c.pos[2] === 2)!;
    expect(shared.roomId).toBe('r2');
    expect(shared.exterior).toBe(false);
    expect(shell.rooms.get('r1')!.interior.size).toBe(3 * 4);
    expect(shell.rooms.get('r2')!.interior.size).toBe(3 * 4);
  });

  it('Raum im Raum: der Außenraum spendet den Wandring, der Innenraum behält seine volle Fläche', () => {
    const state = rects([
      [0, 0, 8, 8],
      [3, 3, 5, 5],
    ]);
    const shell = deriveShell(state, FLAT);
    checkInvariants(state, shell);
    expect(shell.rooms.get('r2')!.interior.equals(CellSet.rect(3, 3, 5, 5))).toBe(true);
    expect(shell.rooms.get('r2')!.doors).toHaveLength(1);
    expect(shell.rooms.get('r1')!.interior.size).toBe(81 - 32 - 16 - 9); // Außenring, gespendeter Ring, Innenraum
  });

  it('Flur (Raumtyp hallway) behält seine Breite und bekommt Türen zu allen Nachbarn', () => {
    const state = plan(LAYOUTS.corridor!, { types: { '1': 'hallway' } });
    const shell = deriveShell(state, FLAT);
    checkInvariants(state, shell);
    const hall = shell.rooms.get('r1')!;
    expect(hall.interior.size).toBe(11 * 3);
    expect(hall.doors.filter((d) => !d.isMain)).toHaveLength(4);
    expect(hall.doors.some((d) => d.isMain)).toBe(true); // Flur wird als Eingang bevorzugt
    // ohne Flur-Typ spendet der Flur (größter Raum) alle Wände und wird 1 breit
    const plainShell = deriveShell(plan(LAYOUTS.corridor!), FLAT);
    expect(plainShell.rooms.get('r1')!.interior.size).toBe(11);
    // eigener Flur-Typ über die Option
    const custom = deriveShell(plan(LAYOUTS.corridor!, { types: { '1': 'gang' } }), { roof: 'flat', corridorTypes: ['gang'] });
    expect(custom.rooms.get('r1')!.interior.size).toBe(11 * 3);
  });
});

describe('deriveShell – Türen', () => {
  it('genau eine Haustür, per Seed gewählt, in einer Außenwand mit Lauf ≥ 3', () => {
    const mains = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const state = plan(LAYOUTS.three!, { seed });
      const shell = deriveShell(state, FLAT);
      const res = checkInvariants(state, shell);
      mains.add(res.mainRoom!);
    }
    expect(mains.size).toBeGreaterThan(1); // der Seed entscheidet wirklich
  });

  it('bevorzugt Räume mit Außenwandlauf ≥ 3', () => {
    // r1 (3×3) hat nur Außenwandläufe der Länge ≤ 2, r2 ist groß
    const state = plan(
      `
      111222222
      111222222
      111222222
      ...222222
      ...222222`,
    );
    for (let seed = 0; seed < 20; seed++) {
      const shell = deriveShell({ ...state, seed }, FLAT);
      expect(shell.rooms.get('r2')!.doors.some((d) => d.isMain)).toBe(true);
    }
  });

  it('Türausrichtung: facing = hinaus (Richtung Ausgang), Scharnier zur näheren Ecke', () => {
    const state = plan(LAYOUTS.three!);
    const shell = deriveShell(state, FLAT);
    const res = checkInvariants(state, shell);
    // Türzelle → Räume auf beiden Seiten (mit ihrer Richtung zur Tür)
    const sides = new Map<string, Array<{ room: string; toward: HorizontalDir }>>();
    for (const [room, info] of shell.rooms)
      for (const d of info.doors) {
        const k = cellKey(d.inside[0] + STEP[d.toward][0], d.inside[1] + STEP[d.toward][1]);
        (sides.get(k) ?? sides.set(k, []).get(k)!).push({ room, toward: d.toward });
      }
    const depth = new Map<string, number>([[res.mainRoom!, 1]]);
    for (let i = 0; i < shell.rooms.size; i++)
      for (const s of sides.values()) {
        if (s.length !== 2) continue;
        const [a, b] = [s[0]!, s[1]!];
        if (depth.has(a.room) && !depth.has(b.room)) depth.set(b.room, depth.get(a.room)! + 1);
        if (depth.has(b.room) && !depth.has(a.room)) depth.set(a.room, depth.get(b.room)! + 1);
      }
    let inner = 0;
    for (const c of shell.cells.filter((x) => x.kind === 'door' && x.orient?.half === 'lower')) {
      const s = sides.get(cellKey(c.pos[0], c.pos[2]))!;
      const f = c.orient!.facing!;
      if (s.length === 2) {
        inner++;
        const deeper = depth.get(s[0]!.room)! > depth.get(s[1]!.room)! ? s[0]! : s[1]!;
        expect(f).toBe(deeper.toward); // aus dem tieferen Raum hinaus
      } else {
        expect(f).toBe(s[0]!.toward); // Außentür: nach außen
      }
      // Scharnier auf der Seite mit dem kürzeren Wandstück bis zum Pfeiler (left = gegen den Uhrzeigersinn)
      const run = (dir: HorizontalDir): number => {
        let n = 0;
        const wallAt = (k: number) => shell.cells.some((o) => o.kind === 'wall' && o.pos[1] === c.pos[1] && o.pos[0] === c.pos[0] + k * STEP[dir][0] && o.pos[2] === c.pos[2] + k * STEP[dir][1]);
        while (wallAt(n + 1)) n++;
        return n;
      };
      expect(c.orient!.hinge).toBe(run(CCW[f]) <= run(CW[f]) ? 'left' : 'right');
    }
    expect(inner).toBe(2);
  });

  it('Kette von Räumen: BFS-Reparatur verbindet alle mit einem Baum aus Türen', () => {
    const state = plan(`
      11111222223333344444
      11111222223333344444
      11111222223333344444
      11111222223333344444
      11111222223333344444`);
    const shell = deriveShell(state, FLAT);
    const res = checkInvariants(state, shell);
    expect(res.doorCount).toBe(4); // 1 Haustür + 3 Verbindungen (Baum)
  });

  it('nur über Eck berührende Räume: Warnung und eigener Nebeneingang', () => {
    const state = plan(`
      1111.....
      1111.....
      1111.....
      1111.....
      ....2222.
      ....2222.
      ....2222.
      ....2222.`);
    const shell = deriveShell(state, FLAT);
    checkInvariants(state, shell, { allReachable: false });
    expect(shell.warnings.some((w) => w.includes('r1 und r2 berühren sich nur über Eck'))).toBe(true);
    expect(shell.warnings.some((w) => w.includes('nicht mit dem Haupteingang verbunden (eigener Nebeneingang)'))).toBe(true);
    const doors = [...shell.rooms.values()].flatMap((r) => r.doors);
    expect(doors.filter((d) => d.isMain)).toHaveLength(1);
    expect(doors).toHaveLength(2);
  });

  it('Warnungen: Raum ohne Innenfläche, zerfallende Fläche, keine Haustür möglich', () => {
    const tiny = deriveShell(plan(`
      11..........
      11..........
      ............
      ...222222...
      ...222222...
      ...222222...
      ...222222...`), FLAT);
    expect(tiny.warnings).toContain('Raum r1 ist nach Wandabzug schmaler als 1 Block – keine begehbare Fläche');
    expect(tiny.warnings.some((w) => w.startsWith('Raum r1 ist nicht erreichbar'))).toBe(true);
    expect(tiny.rooms.get('r1')!.interior.isEmpty).toBe(true);

    const dumbbell = deriveShell(plan(`
      11111.....11111
      11111.....11111
      111111111111111
      11111.....11111
      11111.....11111`), FLAT);
    expect(dumbbell.warnings).toContain('Raum r1: die begehbare Fläche zerfällt nach Wandabzug in 2 Teile');

    const noDoor = deriveShell(plan('11\n11'), FLAT);
    expect(noDoor.warnings).toContain('Keine Haustür möglich: kein Raum hat ein gerades Außenwandstück mit begehbarer Innenseite');
    expect(noDoor.cells.some((c) => c.kind === 'door')).toBe(false);
  });
});

describe('deriveShell – Fenster', () => {
  it('Fensterplätze sind symmetrisch, halten Abstand zu Pfeilern und untereinander (Standard: ≥ 4 Wandzellen)', () => {
    for (let L = 1; L <= 40; L++) {
      const slots = windowSlots(L);
      expect(slots.map((p) => L - 1 - p).reverse(), `L=${L}`).toEqual(slots);
      for (const p of slots) expect(p >= 1 && p <= L - 2).toBe(true);
      if (L >= 3) expect(slots.length, `L=${L}`).toBeGreaterThan(0);
      // Abstände: Doppelfenster (1) oder mindestens 4 Wandzellen dazwischen
      for (let i = 1; i < slots.length; i++) expect([1].includes(slots[i]! - slots[i - 1]!) || slots[i]! - slots[i - 1]! >= 5, `L=${L}: ${slots}`).toBe(true);
      // lange Wände: fensterfreie Mitte (mindestens 6 Zellen)
      if (L >= 14) {
        const mid = slots.filter((p) => Math.abs(p - (L - 1) / 2) < 3);
        expect(mid, `L=${L}`).toEqual([]);
      }
    }
    expect(windowSlots(5)).toEqual([2]);
    expect(windowSlots(4)).toEqual([1, 2]); // mittiges Doppelfenster
    expect(windowSlots(6)).toEqual([2, 3]);
    expect(windowSlots(13)).toEqual([1, 6, 11]); // je 4 Wandzellen dazwischen
    expect(windowSlots(14)).toEqual([2, 11]); // Mitte 4…9 fensterfrei
    // alter Stil (alle 3 Blöcke) bleibt einstellbar
    expect(windowSlots(13, { spacing: 2, blankFrom: Infinity })).toEqual([3, 6, 9]);
    expect(windowSlots(13, 1, 2)).toEqual([3, 6, 9]);
  });

  it('Fenster-Stil ist über die Hüllen-Option einstellbar', () => {
    const state = rects([[0, 0, 16, 6]]);
    const count = (s: Shell) => s.cells.filter((c) => c.kind === 'window' && c.pos[1] === 66).length;
    const dense = deriveShell(state, { roof: 'flat', windows: { spacing: 2, blankFrom: Infinity } });
    const airy = deriveShell(state, FLAT);
    checkInvariants(state, airy);
    expect(count(dense)).toBeGreaterThan(count(airy));
    // Nordwand (Lauf 15): fensterfreie Mitte
    const north = airy.cells.filter((c) => c.kind === 'window' && c.pos[2] === 0 && c.pos[1] === 66).map((c) => c.pos[0]).sort((a, b) => a - b);
    expect(north.every((x) => Math.abs(x - 8) >= 3)).toBe(true);
  });

  it('keine Fenster in Innenwänden; beim Anbauen verschwinden die Fenster der gemeinsamen Wand', () => {
    const alone = rects([[0, 0, 6, 6]]);
    const before = deriveShell(alone, FLAT);
    const eastWindows = (s: Shell) => s.cells.filter((c) => c.kind === 'window' && c.pos[0] === 6);
    expect(eastWindows(before).length).toBeGreaterThan(0);
    const extended = rects([
      [0, 0, 6, 6],
      [7, 0, 13, 6],
    ]);
    const after = deriveShell(extended, FLAT);
    checkInvariants(extended, after);
    expect(eastWindows(after)).toEqual([]);
    expect(after.cells.filter((c) => c.kind === 'window' && c.pos[0] === 7)).toEqual([]);
  });

  it('keine Fenster auf Wandläufen mit Tür', () => {
    const state = plan(LAYOUTS.three!);
    const shell = deriveShell(state, FLAT);
    for (const d of shell.cells.filter((c) => c.kind === 'door' && c.orient?.half === 'lower')) {
      const along = [CW[d.orient!.facing!], CCW[d.orient!.facing!]] as const;
      for (const dir of along) {
        for (let s = 1; ; s++) {
          const c = shell.cells.find((x) => x.pos[1] === d.pos[1] + 1 && x.pos[0] === d.pos[0] + s * STEP[dir][0] && x.pos[2] === d.pos[2] + s * STEP[dir][1]);
          if (c === undefined || c.kind === 'pillar') break;
          expect(c.kind).not.toBe('window');
        }
      }
    }
  });
});

describe('deriveShell – Dach', () => {
  it('Flachdach: Decke ist die Dachfläche (außen), keine Dachzellen', () => {
    const shell = deriveShell(plan(LAYOUTS.L!), FLAT);
    expect(shell.cells.some((c) => c.kind === 'roof')).toBe(false);
    for (const c of shell.cells.filter((x) => x.kind === 'ceiling')) expect([c.role, c.shape, c.exterior]).toEqual(['ceiling', 'block', true]);
  });

  it('Walmdach: Überstand 1 auf Deckenhöhe, Wandlinie eine Ebene höher, Treppen mit facing/stairShape, First als Stufe', () => {
    const state = plan(LAYOUTS.rect!); // 7×5, y0 = 64, Höhe 3 → Decke 68
    const shell = deriveShell(state, HIP);
    checkInvariants(state, shell);
    const roof = shell.cells.filter((c) => c.kind === 'roof');
    expect(roof).toHaveLength(9 * 7);
    const yAt = (x: number, z: number) => roof.find((c) => c.pos[0] === x && c.pos[2] === z)!.pos[1];
    expect(yAt(-1, -1)).toBe(68); // Überstand
    expect(yAt(0, 0)).toBe(69); // über der Wandlinie
    expect(yAt(3, 2)).toBe(71); // First
    for (const c of roof) {
      expect(c.role).toBe('roof_main');
      expect(c.exterior).toBe(true);
      if (c.shape === 'stairs') {
        expect(c.orient?.half).toBe('bottom');
        expect(c.orient?.stairShape).toBeDefined();
        // bergauf: in facing-Richtung liegt kein tieferes Dachteil
        const f = c.orient!.facing!;
        const up = roof.find((o) => o.pos[0] === c.pos[0] + STEP[f][0] && o.pos[2] === c.pos[2] + STEP[f][1]);
        if (up !== undefined) expect(up.pos[1]).toBeGreaterThanOrEqual(c.pos[1]);
        const down = roof.find((o) => o.pos[0] === c.pos[0] - STEP[f][0] && o.pos[2] === c.pos[2] - STEP[f][1]);
        if (down !== undefined) expect(down.pos[1]).toBeLessThanOrEqual(c.pos[1]);
      }
    }
    const ridge = roof.filter((c) => c.shape === 'slab');
    expect(ridge.map((c) => cellKey(c.pos[0], c.pos[2])).sort()).toEqual(['2,2', '3,2', '4,2']);
    for (const c of ridge) expect(c.orient).toEqual({ half: 'bottom' });
    expect(roof.filter((c) => c.orient?.stairShape?.startsWith('outer')).length).toBe(12); // 4 Grate × 3 Zellen (9×7 inkl. Überstand)
  });

  it('Walmdach: Überstand einstellbar, 0 = bündig', () => {
    const state = plan(LAYOUTS.L!);
    const r0 = deriveShell(state, { roof: 'hip', overhang: 0 }).cells.filter((c) => c.kind === 'roof');
    const r2 = deriveShell(state, { roof: 'hip', overhang: 2 }).cells.filter((c) => c.kind === 'roof');
    const cells = state.rooms[0]!.cells;
    expect(r0).toHaveLength(cells.size);
    expect(Math.min(...r0.map((c) => c.pos[1]))).toBe(69); // t = 0 über der Wandlinie, eine Ebene über der Decke
    expect(Math.min(...r2.map((c) => c.pos[1]))).toBe(67); // t = −2
    expect(r2.length).toBeGreaterThan(r0.length);
  });
});

describe('deriveShell – Determinismus', () => {
  it('gleiche Eingabe → gleiche Ausgabe; Reihenfolge der Räume egal', () => {
    for (const ascii of Object.values(LAYOUTS)) {
      const state = plan(ascii);
      const a = deriveShell(state, HIP);
      const b = deriveShell(state, HIP);
      expect(b).toEqual(a);
      const shuffled = deriveShell({ ...state, rooms: [...state.rooms].reverse() }, HIP);
      expect(shuffled.cells).toEqual(a.cells);
      expect([...shuffled.rooms.keys()]).toEqual([...a.rooms.keys()]);
      expect(shuffled.warnings).toEqual(a.warnings);
    }
  });

  it('verschobener Grundriss → verschobene Hülle (Weltkoordinaten)', () => {
    const a = deriveShell(rects([[0, 0, 8, 6], [9, 0, 14, 6]]), FLAT);
    const b = deriveShell(rects([[100, -50, 108, -44], [109, -50, 114, -44]]), FLAT);
    // Türplätze entscheidet ein Hash der Weltposition; die Wandstruktur (Wand/Tür/Fenster/Pfeiler zusammengefasst),
    // Böden, Decken und Pfeiler verschieben sich exakt mit.
    const structure = (s: Shell, dx: number, dz: number) =>
      s.cells.map((c) => `${c.pos[0] - dx},${c.pos[1]},${c.pos[2] - dz}:${WALLISH.has(c.kind) && c.kind !== 'pillar' ? 'wall' : c.kind}`).sort();
    expect(structure(b, 100, -50)).toEqual(structure(a, 0, 0));
    expect(b.warnings).toEqual(a.warnings);
  });

  it('Draufsicht (Beispielhaus mit 3 Räumen)', () => {
    const shell = deriveShell(plan(LAYOUTS.three!), HIP);
    expect(renderShellPlan(shell)).toMatchInlineSnapshot(`
      "+---F---+--F--+
      |aaaaaaa|bbbbb|
      |aaaaaaa|bbbbb|
      Faaaaaaa|bbbbbF
      Faaaaaaa|bbbbbF
      |aaaaaaa|bbbbb|
      |aaaaaaa|bbbbb|
      +---D---+--D--+
      |ccccccccccccc|
      FcccccccccccccF
      |ccccccccccccc|
      +------H------+"
    `);
  });
});
