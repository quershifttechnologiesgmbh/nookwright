/**
 * Hülle je Baukörper (V0, research/19 §7.4): Häuserzeile, Turm neben Halle, Hang – ASCII-Schnitte und Invarianten:
 * eine gemeinsame Brandwand (keine Doppelwand), eigenes Dach je Baukörper (nie über fremden Spalten), Dächer dicht
 * (Voll- und Halbblock-Modell), Türen nur zwischen gleichen Böden, Außenprofil und Anker nie im Inneren, Zufallstest.
 * W4 (27.09.2026): Dachraum-Licht – in den Schnitten steht je Dachraum eine Laterne `L` auf dem Dachboden.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, cellKey } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { DomainError, deriveShell, renderShellPlan, volumeOf, type ProjectState, type RoofStyle, type Shell, type ShellOptions } from '../src/index.js';
import { halfLeaks } from './support/leaks.js';
import { lcg } from './support/masks.js';
import { renderSection } from './support/section.js';
import { addVolume, doubles, hillside, openings, rowHouses, towerAndHall, volumeProject } from './support/volumes.js';

const ROOFS: readonly RoofStyle[] = ['flat', 'hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'];
const FULL: Omit<ShellOptions, 'roof'> = { roofDetail: { trim: true, gableWindows: true }, facade: { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 } };
const WALLISH = new Set(['wall', 'pillar', 'door', 'window', 'lintel']);

/** Innen: Spalte eines Raums zwischen seiner tiefsten Bodenplatte und der obersten Hüllzelle (ohne Außenprofil). */
function insideTest(shell: Shell): (x: number, y: number, z: number) => boolean {
  const lo = new Map<string, number>();
  const hi = new Map<string, number>();
  for (const r of shell.rooms.values()) for (const [x, z] of r.interior) lo.set(cellKey(x, z), Math.min(lo.get(cellKey(x, z)) ?? Infinity, r.baseY - 1));
  for (const c of shell.cells) if (c.kind !== 'facade') hi.set(cellKey(c.pos[0], c.pos[2]), Math.max(hi.get(cellKey(c.pos[0], c.pos[2])) ?? -Infinity, c.pos[1]));
  return (x, y, z) => y >= (lo.get(cellKey(x, z)) ?? Infinity) && y <= (hi.get(cellKey(x, z)) ?? -Infinity);
}

/**
 * Doppelwände an Baukörper-Grenzen: zwei benachbarte Wandzellen verschiedener Baukörper auf gleicher Höhe, beidseits
 * davon Rauminnenluft.
 */
function doubleWalls(state: ProjectState, shell: Shell): string[] {
  const vol = new Map<string, string>();
  for (const r of state.rooms) for (const [x, z] of r.cells) vol.set(cellKey(x, z), volumeOf(r));
  const at = new Map(shell.cells.map((c) => [c.pos.join(','), c] as const));
  const air = new Set<string>();
  for (const r of shell.rooms.values()) for (const [x, z] of r.interior) for (let y = r.baseY; y < r.baseY + r.height; y++) air.add(`${x},${y},${z}`);
  const out: string[] = [];
  for (const c of shell.cells) {
    if (!WALLISH.has(c.kind)) continue;
    const [x, y, z] = c.pos;
    for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
      const n = at.get(`${x + dx},${y},${z + dz}`);
      if (n === undefined || !WALLISH.has(n.kind) || vol.get(cellKey(x, z)) === vol.get(cellKey(x + dx, z + dz))) continue;
      if (air.has(`${x - dx},${y},${z - dz}`) && air.has(`${x + 2 * dx},${y},${z + 2 * dz}`)) out.push(c.pos.join(','));
    }
  }
  return out;
}

/** Gemeinsame Prüfungen einer Hülle mit Baukörpern. */
function assertSound(state: ProjectState, shell: Shell): void {
  expect(shell.warnings).toEqual([]);
  expect(doubles(shell)).toEqual([]);
  expect(openings(shell)).toEqual([]);
  const roofed = new Set(shell.cells.filter((c) => c.kind === 'roof').map((c) => `${c.pos[0]},${c.pos[2]}`));
  expect(halfLeaks(shell).filter((k) => roofed.has(`${k.split(',')[0]},${k.split(',')[2]}`))).toEqual([]);
  expect(doubleWalls(state, shell)).toEqual([]);
  const inside = insideTest(shell);
  expect(shell.cells.filter((c) => c.kind === 'facade' && inside(c.pos[0], c.pos[1], c.pos[2])).map((c) => c.pos.join(','))).toEqual([]);
  expect((shell.anchors ?? []).filter((a) => inside(a.pos[0], a.pos[1], a.pos[2])).map((a) => `${a.kind}@${a.pos.join(',')}`)).toEqual([]);
}

/** Dachzellen je Baukörper (über die Raum-ID) und Spalten fremder Baukörper darunter. */
function roofsByVolume(state: ProjectState, shell: Shell): { readonly count: Map<string, number>; readonly foreign: string[] } {
  const vol = new Map<string, string>();
  for (const r of state.rooms) for (const [x, z] of r.cells) vol.set(cellKey(x, z), volumeOf(r));
  const roomVol = new Map(state.rooms.map((r) => [r.id, volumeOf(r)] as const));
  const count = new Map<string, number>();
  const foreign: string[] = [];
  for (const c of shell.cells) {
    if (c.kind !== 'roof' || c.roomId === undefined) continue;
    const v = roomVol.get(c.roomId)!;
    count.set(v, (count.get(v) ?? 0) + 1);
    const under = vol.get(cellKey(c.pos[0], c.pos[2]));
    if (under !== undefined && under !== v) foreign.push(c.pos.join(','));
  }
  return { count, foreign };
}

// W13-E (2026-09-28): Giebelfenster Drillingsfenster 3 × 2 statt Okulus (Plus las sich als Kreuz) – Schnitte mit `ggg`
// statt `g`-Plus (Häuserzeile, Turm, Hang, Brandwand)
describe('Häuserzeile: geteilte Wände, je eigenes Satteldach, verschiedene Höhen', () => {
  const p = rowHouses();
  const shell = deriveShell(p.state, { roof: 'hip', ...FULL });

  it('Querschnitt: Haus 2 (höher) trägt beide Brandwände, drei Firste, Dächer schließen an die Brandwand an', () => {
    assertSound(p.state, shell);
    // W2 (26.09.2026): Regel D2 – über der Traufe an der Brandwand-Seite Dachfüllung statt Wandzelle
    // W3 (27.09.2026): K6 – kein Gesims, keine Fensterrahmen über dem Dach eines niedrigeren Baukörpers; Baukörperfuge –
    // der Anschluss einer Brandwand an die Fassade ist ein Eckquader (Plan: `-`/`|` statt Pfosten `+`).
    expect(renderSection(shell, { z: 5 })).toMatchInlineSnapshot(`
      "..........._...........
      ........../.\\..........
      ........./...\\.........
      ......../..L..\\........
      ........CCCCCCC........
      ........W.....W........
      ...._...W.....W..._....
      .../.\\..W..#.#W...#....
      ../...\\.FFFF=FF../.\\...
      ./..L..\\W...#.W..#.#...
      /CCCCCCCW...#.W./...\\..
      vW......W#.##.W.#...#..
      #W......FF.FFFF/.....\\.
      #W.#.#..W.....W...L..#.
      vFFF.FFFW.=...WCCCCCCC\\
      vW..=...W.#...W......Wv
      #W..#...W.#...W......W#
      #W..#...W.#...W......W#
      /FFFFFFFFFFFFFFFFFFFFF\\"
    `);
    const { count, foreign } = roofsByVolume(p.state, shell);
    expect(count.size).toBe(3);
    expect(foreign).toEqual([]);
    expect((shell.anchors ?? []).filter((a) => a.kind === 'ridge')).toHaveLength(3);
  });

  it('Grundriss Erdgeschoss: eine Haustür, Türen durch beide Brandwände (gleicher Boden), Treppe je Haus', () => {
    // W3 (27.09.2026): K6 – kein Gesims, keine Fensterrahmen über dem Dach eines niedrigeren Baukörpers; Baukörperfuge –
    // der Anschluss einer Brandwand an die Fassade ist ein Eckquader (Plan: `-`/`|` statt Pfosten `+`).
    expect(renderShellPlan(shell, 0)).toMatchInlineSnapshot(`
      ".......................
      .+--FF-----H-----FF--+.
      .|aaaaaa|bbbbb|cccccc|.
      .Faaaaaa|bSbbb|ccccccF.
      .|aaSaaa|bSbbb|cccccc|.
      .|aaSaaa|bSbbb|cccccc|.
      .|aaSaaaDbSbbbDcccccc|.
      .|aaSaaa|bSbbb|cccccc|.
      .|aaaaaa|bSbbb|cccccc|.
      .Faaaaaa|bbbbb|ccccccF.
      .|aaaaaa|bbbbb|cccccc|.
      .+--FF-----F-----FF--+.
      ......................."
    `);
    // Haus 1 Obergeschoss (Boden 4) und Haus 2 Obergeschoss (Boden 6): verschiedene Böden, keine Tür dazwischen
    expect(renderShellPlan(shell, 1, 5)).toMatchInlineSnapshot(`
      "........
      .+--FF-|
      .|aaaaaa
      .Faaaaaa
      .|a###aa
      .|a#o#aa
      .|a#o#aa
      .|a#S#aa
      .|aaaaaa
      .Faaaaaa
      .|aaaaaa
      .+--FF-|
      ........"
    `);
  });

  it('Straßenansicht (Giebelwände z = 0): Giebelfenster je Haus, Haustür nur in Haus 2', () => {
    // W3 (27.09.2026): K6 – kein Gesims, keine Fensterrahmen über dem Dach eines niedrigeren Baukörpers; Baukörperfuge –
    // der Anschluss einer Brandwand an die Fassade ist ein Eckquader (Plan: `-`/`|` statt Pfosten `+`).
    // W4 (27.09.2026): Okulus-Ecken sind Giebelwand statt Treppen (`o` → `W`)
    // W5 (27.09.2026, N1): Eckquader bis zur Traufunterkante – die Deckenring-Ecken sind Pfeiler (`C` → `W`); an der
    // Baukörperfuge (Eckquader in der Wand, das Theme setzt dort das Wandfeld) läuft nichts weiter
    expect(renderSection(shell, { z: 0 })).toMatchInlineSnapshot(`
      "..........._...........
      ........../W\\..........
      ........./WgW\\.........
      ......../WWWWW\\........
      ........WCCCCCW........
      ........WWWgWWW........
      ...._...WWWgWWW..._....
      .../W\\..WWWWWWW...W....
      ../WgW\\.FFFFFFF../W\\...
      ./WWWWW\\WWWgWWW..WWW...
      /WCCCCCCWWWgWWW./WWW\\..
      .WWWggWWWWWWWWW.WgggW..
      .WWWggWWFFFFFFF/WgggW\\.
      .WWWWWWWWWWWWWWWWWWWWW.
      vFFFFFFFWWWWWWWCCCCCCW\\
      .WWWggWWWWWWWWWWWggWWW.
      .WWWggWWWWWWWWWWWggWWW.
      .WWWWWWWWWWWWWWWWWWWWW.
      /FFFFFFFFFFFFFFFFFFFFF\\"
    `);
  });
});

describe('Turm neben Halle: Turm höher (4 Etagen, Flachdach), Halle mit Satteldach', () => {
  const p = towerAndHall();
  const shell = deriveShell(p.state, { roof: 'gable', ...FULL });

  it('Schnitt: Turmwand von unten bis oben, Hallendach endet an ihr (keine Giebelwand davor)', () => {
    assertSound(p.state, shell);
    // W2 (26.09.2026): Regel D8 – Flachdach des Turms mit Gesims
    expect(renderSection(shell, { z: 5 })).toMatchInlineSnapshot(`
      "................CCCCCCCv
      ................g.....g.
      ................g.....g.
      ................W.....W.
      ................FFFFFFFv
      ................W.....g.
      ________________W.....g.
      .W..............W.....W.
      .W..............FFFFFFFv
      .g..............W.....g.
      .g..............W.....g.
      .W......L.......W.....W.
      .CCCCCCCCCCCCCCCFFFFFFFv
      vW..............W.....g.
      #W..............W.....g.
      #W..............W.....W.
      /FFFFFFFFFFFFFFFFFFFFFF\\"
    `);
    // W3 (27.09.2026): K6 – kein Gesims, keine Fensterrahmen über dem Dach eines niedrigeren Baukörpers; Baukörperfuge –
    // der Anschluss einer Brandwand an die Fassade ist ein Eckquader (Plan: `-`/`|` statt Pfosten `+`).
    // W5 (27.09.2026, N1): Eckquader bis zur Traufunterkante – die Deckenring-Ecken der Halle sind Pfeiler (`C` → `W`)
    expect(renderSection(shell, { x: 14 })).toMatchInlineSnapshot(`
      "......_......
      ...../.\\.....
      ..../...\\....
      .../.....\\...
      ../.......\\..
      ./W.......W\\.
      /WCCCCCCCCCW\\
      .WWW.....WWW.
      .WWW.....WWW.
      .WWW.....WWW.
      /FFFFFFFFFFF\\"
    `);
    expect(roofsByVolume(p.state, shell).foreign).toEqual([]);
  });

  it('Grundriss: Tür von der Halle in den Turm, Leitern zwischen den Turmetagen', () => {
    // W3 (27.09.2026): K6 – kein Gesims, keine Fensterrahmen über dem Dach eines niedrigeren Baukörpers; Baukörperfuge –
    // der Anschluss einer Brandwand an die Fassade ist ein Eckquader (Plan: `-`/`|` statt Pfosten `+`).
    expect(renderShellPlan(shell, 0)).toMatchInlineSnapshot(`
      "........................
      .+-F----F----F-+........
      .|aaaaaaaaaaaaa|........
      .Faaaaaaaaaaaaa+---F--+.
      .|aaaaaaaaaaaaaa|bSbbb|.
      .|aaaaaaaaaaaaaa|bbbbb|.
      .|aaaaaaaaaaaaaaDbbbbbF.
      .|aaaaaaaaaaaaaa|bbbbb|.
      .|aaaaaaaaaaaaaa|bbbbb|.
      .Faaaaaaaaaaaaa+---F--+.
      .|aaaaaaaaaaaaa|........
      .+------H------+........
      ........................"
    `);
    expect([...shell.rooms.values()].map((r) => `${r.roomId}:${r.floorIndex}@${r.baseY}+${r.height} ${r.stairs?.length ?? 0}`)).toMatchInlineSnapshot(`
      [
        "r2:0@1+3 0",
        "r3:0@1+3 1",
        "r4:1@5+3 2",
        "r5:2@9+3 2",
        "r6:3@13+3 1",
      ]
    `);
  });
});

describe('Hang: zweiter Baukörper 3 Blöcke tiefer', () => {
  const p = hillside();
  const shell = deriveShell(p.state, { roof: 'gable', ...FULL });

  it('Schnitt: Brandwand bis zum tieferen Boden hinab, Dach des Unterhauses schließt an die Wand des Haupthauses an', () => {
    assertSound(p.state, shell);
    // W4 (27.09.2026): das eingeschossige Haupthaus bekommt 2 Reihen Kniestock (D5: Wand ≥ Dach), Okulus-Ecken als Wand;
    // W4-E: `L` Dachraum-Laternen (im Dachraum beider Baukörper)
    expect(renderSection(shell, { z: 4 })).toMatchInlineSnapshot(`
      "____________..........
      .W.........W..........
      .W.........W..........
      .g.........g..........
      .g.........g..........
      .W.........W__________
      .W....L....W........W.
      .CCCCCCCCCCC........W.
      .g.........W........g.
      .g.........W...L....W.
      .W.........WCCCCCCCCC.
      /FFFFFFFFFFF........W.
      ...........W........W.
      ...........W........W.
      ...........WFFFFFFFFF."
    `);
    expect(renderSection(shell, { x: 10 })).toMatchInlineSnapshot(`
      "....._.....
      ..../W\\....
      .../WWW\\...
      ../WgggW\\..
      ./WWgggWW\\.
      /WWWWWWWWW\\
      .WWWWWWWWW.
      .CCCCCCCCC.
      .WWWWWWWWW.
      .WWWWWWWWW.
      .WWWWWWWWW.
      /FFFFFFFFF\\
      .WWWWWWWWW.
      .WWWWWWWWW.
      .WWWWWWWWW."
    `);
  });

  it('keine Tür zwischen verschiedenen Böden: jedes Haus hat seinen eigenen Eingang', () => {
    expect(renderShellPlan(shell, 0, -2)).toMatchInlineSnapshot(`
      "..........
      |F----F-+.
      aaaaaaaa|.
      aaaaaaaa|.
      aaaaaaaa|.
      aaaaaaaaH.
      aaaaaaaa|.
      aaaaaaaa|.
      aaaaaaaa|.
      |F----F-+.
      .........."
    `);
    // W3 (27.09.2026): K6 – kein Gesims, keine Fensterrahmen über dem Dach eines niedrigeren Baukörpers; Baukörperfuge –
    // der Anschluss einer Brandwand an die Fassade ist ein Eckquader (Plan: `-`/`|` statt Pfosten `+`).
    expect(renderShellPlan(shell, 0, 1)).toMatchInlineSnapshot(`
      "............
      .+-F-----F-|
      .|aaaaaaaaa|
      .|aaaaaaaaa|
      .|aaaaaaaaa|
      .Faaaaaaaaa|
      .|aaaaaaaaa|
      .|aaaaaaaaa|
      .|aaaaaaaaa|
      .+----H----|
      ............"
    `);
    const main = [...shell.rooms.values()].map((r) => r.doors.filter((d) => d.isMain).length);
    expect(main).toEqual([1, 1]);
    for (const r of shell.rooms.values()) expect(r.doors, r.roomId).toHaveLength(1);
  });
});

describe('Gleiche Böden, andere Höhen: Tür durch die Brandwand, die Wand reicht bis zur höheren Decke', () => {
  it('Halle (lichte Höhe 5) neben Haus (lichte Höhe 3)', () => {
    const p = volumeProject();
    const hall = addVolume(p, { roof: 'gable', floorHeights: { 0: 5 } });
    p.paintRoom(0, CellSet.rect(0, 0, 8, 8), 'kitchen');
    p.paintRoom(0, CellSet.rect(9, 0, 19, 8), 'dining_hall', { volumeId: hall });
    const shell = deriveShell(p.state, { roof: 'hip', ...FULL });
    assertSound(p.state, shell);
    const doors = [...shell.rooms.values()].flatMap((r) => r.doors.filter((d) => !d.isMain));
    expect(doors).toHaveLength(2); // dieselbe Tür von beiden Seiten
    expect(renderSection(shell, { z: 4 })).toMatchInlineSnapshot(`
      "..........____________
      ..........W.........W.
      ....._....W.........W.
      ..../.\\...g.........g.
      .../...\\..W....L....W.
      ../.....\\.CCCCCCCCCCC.
      ./...L...\\W.........W.
      /CCCCCCCCCW.........W.
      .W........W.........g.
      .W........W.........g.
      .W........W.........W.
      .FFFFFFFFFFFFFFFFFFFF\\"
    `);
  });
});

describe('Zufallstest: 2–4 Baukörper, alle Dachformen, Versatz und eigene Höhen', () => {
  it('dicht, keine Doppelwand, keine Doppelzelle, Dach nie über fremden Spalten, Profil und Anker außen', { timeout: HEAVY_TIMEOUT }, () => {
    for (let seed = 1; seed <= 80; seed++) {
      const rnd = lcg(seed * 7919);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
      const p = volumeProject(seed);
      p.addFloor();
      p.addFloor();
      const vols: Array<string | undefined> = [undefined];
      const nv = 2 + Math.floor(rnd() * 3);
      for (let k = 1; k < nv; k++) {
        vols.push(addVolume(p, {
          baseOffset: pick([0, 0, -3, -4, 2, 4, -1, 1]),
          ...(rnd() < 0.4 ? { floorHeights: { 0: pick([2, 3, 4, 5]), 1: pick([3, 4]) } } : {}),
          roof: pick(ROOFS),
          ...(rnd() < 0.3 ? { roofDetail: { pitch: pick(['low', 'normal', 'steep'] as const), trim: true } } : {}),
        }));
      }
      let [bx, bz, bw, bd] = [0, 0, 0, 0];
      for (let k = 0; k < nv; k++) {
        const w = 5 + Math.floor(rnd() * 7);
        const d = 5 + Math.floor(rnd() * 7);
        const side = Math.floor(rnd() * 4);
        const [x, z] = k === 0 ? [0, 0]
          : side === 0 ? [bx + bw, bz + Math.floor(rnd() * bd) - 2]
          : side === 1 ? [bx - w, bz + Math.floor(rnd() * bd) - 2]
          : side === 2 ? [bx + Math.floor(rnd() * bw) - 2, bz + bd]
          : [bx + Math.floor(rnd() * bw) - 2, bz - d];
        [bx, bz, bw, bd] = [x, z, w, d];
        const floors = 1 + Math.floor(rnd() * 3);
        for (let f = 0; f < floors; f++) {
          try {
            p.paintRoom(f, CellSet.rect(x, z, x + w - 1, z + d - 1), pick(['kitchen', 'storage', 'bedroom', 'hallway']), vols[k] !== undefined ? { volumeId: vols[k]! } : {});
          } catch (e) {
            if (!(e instanceof DomainError)) throw e; // Überschneidung mit einem anderen Baukörper: abgelehnt
          }
        }
      }
      for (const roof of [pick(ROOFS), 'gable' as RoofStyle]) {
        const where = `Seed ${seed}, ${roof}`;
        const shell = deriveShell(p.state, { roof, ...FULL, ...(rnd() < 0.5 ? { dormers: { kind: pick(['gable', 'shed', 'hip', 'blind'] as const) } } : {}) });
        expect(doubles(shell), where).toEqual([]);
        expect(openings(shell), where).toEqual([]);
        const roofed = new Set(shell.cells.filter((c) => c.kind === 'roof').map((c) => `${c.pos[0]},${c.pos[2]}`));
        expect(halfLeaks(shell).filter((k) => roofed.has(`${k.split(',')[0]},${k.split(',')[2]}`)), where).toEqual([]);
        expect(doubleWalls(p.state, shell), where).toEqual([]);
        expect(roofsByVolume(p.state, shell).foreign, where).toEqual([]);
        const inside = insideTest(shell);
        expect(shell.cells.filter((c) => c.kind === 'facade' && inside(c.pos[0], c.pos[1], c.pos[2])).length, where).toBe(0);
        expect((shell.anchors ?? []).filter((a) => inside(a.pos[0], a.pos[1], a.pos[2])).length, where).toBe(0);
        expect(JSON.stringify(deriveShell(p.state, { roof, ...FULL }).cells), `${where}: deterministisch`).toBe(JSON.stringify(deriveShell(p.state, { roof, ...FULL }).cells));
      }
    }
  });
});
