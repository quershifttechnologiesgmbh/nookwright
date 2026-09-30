/**
 * Gauben (B2, research/18 D4, research/16 D5): Lage, Rhythmus, Frontwand, Fenster (Merrell), Blindgaube, Dichtheit,
 * Vanilla-Treppenformen, Anker; dazu „Fenster aus“ ohne Giebel-/Gaubenfenster und die Auskragung auf Konsolen.
 * Die Ansichten sind zugleich die Doku (plan/spikes/B2_huelle_gauben.md); Legende bei `elevation`.
 */
import { describe, expect, it } from 'vitest';
import { key3, type HorizontalDir, type Vec3 } from '@mcda/core';
import {
  deriveShell, isAtticLight, type DormerStyle, type RoofDetail, type RoofPitch, type RoofStyle, type Shell, type ShellCell, type ShellOptions,
} from '../src/index.js';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { CW, OPP, STEP } from '../src/shell/grid.js';
import { rhythmSlots } from '../src/shell/dormers.js';
import { vanillaShapeAt } from '../src/shell/roof-finish.js';
import { LAYOUTS, jettyHouse, rect, rooms, twoStoryHouse } from './support/houses.js';
import { halfLeaks } from './support/leaks.js';
import { renderSection } from './support/section.js';

const PITCHED: readonly RoofStyle[] = ['hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'];
const PITCHES: readonly RoofPitch[] = ['low', 'normal', 'steep'];
const KINDS: ReadonlyArray<DormerStyle['kind']> = ['gable', 'shed', 'hip', 'blind'];
const NO_WINDOWS = { margin: 1_000_000, blankFrom: Number.POSITIVE_INFINITY }; // so übergibt die App „Fenster aus“

/**
 * Haus mit Satteldach und Gauben (`null` = ohne Gauben). W3 (27.09.2026): ohne Dach-Teilung (`split: false`) – das
 * Haus 23 × 16 (Außenmaß 18) läge sonst über dem Höhen-Budget und bekäme parallele Satteldächer; die Doku zeigt Gauben
 * auf einer ungeteilten Dachfläche. W4 (27.09.2026): ohne Kniestock (`kneeWall: false`) – die Ansichten zeigen die Traufe
 * auf Deckenhöhe wie bisher (der Kniestock hebt nur das ganze Dach, die Gaube bleibt gleich).
 */
const shellOf = (p = rect(23, 12), opts: Partial<ShellOptions> = {}, dormers: DormerStyle | null = { kind: 'gable' }, detail: RoofDetail = {}): Shell =>
  deriveShell(p.state, { roof: 'gable', roofDetail: { split: false, kneeWall: false, ...detail }, ...(dormers !== null ? { dormers } : {}), ...opts });
/** Gaubenscheiben: Scheiben, die es ohne Gauben (`base`) nicht gibt. */
const dormerPanes = (s: Shell, base: Shell): ShellCell[] => {
  const before = new Set(base.cells.filter((c) => c.kind === 'window').map((c) => key3(c.pos)));
  return s.cells.filter((c) => c.kind === 'window' && c.shape === 'pane' && !before.has(key3(c.pos)));
};

/**
 * Ansicht der Traufseite von `from` (Blick nach OPP[from]), vorderste Zelle je Spalte und Höhe; Ausschnitt [u0, u1] ×
 * [y0, y1]. `^` Treppe steigt vom Betrachter weg, `/` `\` steigt nach rechts/links, `_` `‾` Stufe unten/oben, `#`
 * Dachblock, `|` Pfosten, `=` Rähm, `g` Scheibe, `W` Wand, `.` Luft.
 */
function elevation(s: Shell, from: HorizontalDir, u0: number, u1: number, y0: number, y1: number): string {
  const right = CW[OPP[from]] === 'east' || CW[OPP[from]] === 'south' ? CW[OPP[from]] : CW[OPP[from]];
  const u = (p: Vec3): number => (right === 'east' || right === 'west' ? p[0] : p[2]) * (right === 'west' || right === 'north' ? -1 : 1);
  const depth = (p: Vec3): number => p[0] * STEP[from][0] + p[2] * STEP[from][1];
  const best = new Map<string, ShellCell>();
  for (const c of s.cells) {
    const k = `${u(c.pos)},${c.pos[1]}`;
    const b = best.get(k);
    if (b === undefined || depth(c.pos) > depth(b.pos)) best.set(k, c);
  }
  const glyph = (c: ShellCell): string => {
    if (c.kind === 'window') return 'g';
    if (c.kind === 'pillar') return '|';
    if (c.kind === 'lintel') return '=';
    if (c.kind === 'wall') return 'W';
    if (c.shape === 'stairs') return c.orient?.facing === OPP[from] ? '^' : c.orient?.facing === right ? '/' : c.orient?.facing === OPP[right] ? '\\' : 'v';
    if (c.shape === 'slab') return c.orient?.half === 'top' ? '‾' : '_';
    return '#';
  };
  const rows: string[] = [];
  for (let y = y1; y >= y0; y--) {
    let r = '';
    for (let v = u0; v <= u1; v++) {
      const c = best.get(`${v},${y}`);
      r += c === undefined ? '.' : glyph(c);
    }
    rows.push(r);
  }
  return rows.join('\n');
}

/** Invarianten jeder Hülle mit Gauben. */
function check(s: Shell, base: Shell, where: string): void {
  const keys = s.cells.map((c) => key3(c.pos));
  expect(new Set(keys).size, `${where}: Zellkollision`).toBe(keys.length);
  expect(halfLeaks(s), `${where}: Lücke`).toEqual([]);
  const at = new Map(s.cells.map((c) => [key3(c.pos), c] as const));
  const stairs = new Map(s.cells.filter((c) => c.shape === 'stairs' && c.orient?.facing !== undefined).map((c) => [key3(c.pos), { facing: c.orient!.facing!, half: c.orient!.half ?? 'bottom' }] as const));
  for (const c of s.cells) {
    if (c.kind === 'roof' && c.shape === 'stairs' && c.orient?.half === 'bottom') expect(c.orient.stairShape, `${where} ${c.pos}`).toBe(vanillaShapeAt(stairs, c.pos));
  }
  // Merrell: jede Scheibe hat genau eine Seite Außenluft quer zur Wand, die andere Innenluft oder (Blindgaube) Vollblock
  for (const w of dormerPanes(s, base)) {
    const free = (['north', 'east', 'south', 'west'] as const).filter((d) => !at.has(key3([w.pos[0] + STEP[d][0], w.pos[1], w.pos[2] + STEP[d][1]])));
    expect(free.length, `${where}: Scheibe ${w.pos}`).toBeLessThanOrEqual(2);
    expect(free.length, `${where}: Scheibe ${w.pos}`).toBeGreaterThanOrEqual(1);
  }
  // Gaubenfenster sind Fensteranker (Luft davor)
  const anchored = new Set((s.anchors ?? []).filter((a) => a.kind === 'window').flatMap((a) =>
    Array.from({ length: a.span ?? 1 }, (_, k) => key3([a.pos[0] - STEP[a.facing][0] + (a.facing === 'north' || a.facing === 'south' ? k : 0), a.pos[1], a.pos[2] - STEP[a.facing][1] + (a.facing === 'east' || a.facing === 'west' ? k : 0)]))));
  for (const w of dormerPanes(s, base)) if (at.get(key3([w.pos[0], w.pos[1] - 1, w.pos[2]]))?.kind !== 'window') expect(anchored.has(key3(w.pos)), `${where}: Anker ${w.pos}`).toBe(true);
}

describe('Gauben: alle Dachformen, Neigungen, Arten und Breiten', () => {
  for (const [name, make] of [...LAYOUTS, ['Haus 23 × 16', () => rect(23, 16)] as const]) {
    it(`${name}: dicht, kollisionsfrei, Vanilla-Treppen, Merrell, Anker, deterministisch`, () => {
      const p = make();
      for (const roof of PITCHED) {
        for (const pitch of PITCHES) {
          const plain: ShellOptions = { roof, roofDetail: { pitch, trim: true, verge: 'closed' } };
          const base = deriveShell(p.state, plain);
          for (const kind of KINDS) {
            for (const width of [1, 3, 5] as const) {
              const opts: ShellOptions = { ...plain, dormers: { kind, width } };
              const s = deriveShell(p.state, opts);
              check(s, base, `${name} · ${roof}/${pitch} · ${kind}/${width}`);
              if (width === 3 && kind === 'gable') expect(JSON.stringify(deriveShell(p.state, opts))).toBe(JSON.stringify(s));
            }
          }
        }
      }
    }, HEAVY_TIMEOUT);
  }

  it('mit Außenprofil: kollisionsfrei, vor Gaubenscheiben nichts', () => {
    const facade = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 };
    for (const p of [rect(23, 12), twoStoryHouse()]) {
      for (const roof of PITCHED) {
        const s = deriveShell(p.state, { roof, facade, dormers: { kind: 'gable' } });
        check(s, deriveShell(p.state, { roof, facade }), `Profil · ${roof}`);
      }
    }
  });
});

describe('Gauben: Ansichten (Doku) – Haus 23 × 12, Satteldach 1:1, Überstand 1', () => {
  // W3 (27.09.2026): Gaubenmodul „Glasgiebel“ – keine Eckpfosten, kein Rähm; über der Brüstung füllt die Scheibe die
  // Front (Mitte 2 hoch, Wangen 1 hoch unter dem Gaubendach)
  // W4 (27.09.2026): Brüstung in der Dachdeckung (`#` statt `W`)
  it('Satteldach-Gaube W = 3: Glasgiebel über der Brüstung, Gaubenfirst 1 unter dem Hauptfirst; Luft dahinter', () => {
    const s = shellOf();
    expect(elevation(s, 'south', 7, 15, 4, 9)).toBe(['^^^^_^^^^', '^^^/g\\^^^', '^^/ggg\\^^', '^^^###^^^', '^^^^^^^^^', '^^^^^^^^^'].join('\n'));
    // Schnitt entlang der Achse x = 11 (z nach rechts): Front bei z = 1 bzw. 10, Gaubenfirst bis zur Kehlreihe
    // W4 (27.09.2026): Dachraum-Licht – Laternen `L` auf dem Dachboden (Mitte und unter der Südgaube)
    expect(renderSection(s, { x: 11 })).toBe([
      '....../\\......', '..___/..\\___..', '..g........g..', '..g........g..', '..#........#..', './....L....L\\.', '/CCCCCCCCCCCC\\',
      '.W..........W.', '.W..........W.', '.W..........W.', '.FFFFFFFFFFFF.',
    ].join('\n'));
  });

  it('W = 1 (Fenstergaube), W = 5 (Fensterband, Haus 23 × 16), Schleppgaube, Walmgaube', () => {
    expect(elevation(shellOf(rect(23, 12), {}, { kind: 'gable', width: 1 }), 'south', 4, 12, 4, 9)).toBe(
      ['^^^^^^^^^', '^^^^_^^^^', '^^^/g\\^^^', '^^^^#^^^^', '^^^^^^^^^', '^^^^^^^^^'].join('\n'));
    expect(elevation(shellOf(rect(23, 16), {}, { kind: 'gable', width: 5 }), 'south', 0, 11, 4, 11)).toBe(
      ['^^^^^^^^^^^^', '^^^^^_^^^^^^', '^^^^/=\\^^^^^', '^^^/ggg\\^^^^', '^^/WgggW\\^^^', '^^^W###W^^^^', '^^^^^^^^^^^^', '^^^^^^^^^^^^'].join('\n'));
    const shed = shellOf(rect(23, 12), {}, { kind: 'shed' });
    // W3 (27.09.2026): Wangen aus Giebelfeld statt Pfosten (Gaubenmodul)
    expect(elevation(shed, 'south', 6, 14, 4, 9)).toBe(['^^^^^^^^^', '^^^_____^', '^^^WgggW^', '^^^W###W^', '^^^^^^^^^', '^^^^^^^^^'].join('\n'));
    expect(renderSection(shed, { x: 10 }).split('\n').slice(0, 5)).toEqual(['....../\\......', '...../..\\.....', '..__/....\\__..', '..g........g..', '..#........#..']);
    const hip = shellOf(rect(23, 12), {}, { kind: 'hip' });
    expect(elevation(hip, 'south', 7, 15, 4, 9)).toBe(['^^^^_^^^^', '^^^^^^^^^', '^^/ggg\\^^', '^^^###^^^', '^^^^^^^^^', '^^^^^^^^^'].join('\n'));
    expect(renderSection(hip, { x: 11 }).split('\n').slice(0, 5)).toEqual(['....../\\......', '...__/..\\__...', '../........\\..', '..g........g..', '..#........#..']);
  });

  it('Blindgaube steil (2:1): Scheibe 2 hoch, Glas vor Vollblock; darüber das steile Gaubendreieck', () => {
    const s = shellOf(rect(23, 12), {}, { kind: 'blind' }, { pitch: 'steep' });
    expect(elevation(s, 'south', 7, 15, 6, 15)).toBe([
      '#########', '^^^^_^^^^', '#########', '^^^/W\\^^^', '####W####', '^^/===\\^^', '###ggg###', '^^^ggg^^^', '#########', '^^^^^^^^^',
    ].join('\n'));
    expect(renderSection(s, { x: 11 }).split('\n').slice(0, 11)).toEqual([
      '....../\\......', '......##......', '..___/..\\___..', '..###....###..', '..W........W..', '..W........W..', '..W........W..',
      '..gW......Wg..', '..gW......Wg..', '..#........#..', './..........\\.',
    ]);
  });

  it('Draufsicht Walmdach 23 × 16: je Traufseite eine Gaube (Rand zum Grat ≥ 2 über die ganze Tiefe), Kehlen beidseits', () => {
    const s = shellOf(rect(23, 16), { roof: 'hip' });
    const top = new Map<string, ShellCell>();
    for (const c of s.cells) if ((top.get(`${c.pos[0]},${c.pos[2]}`)?.pos[1] ?? -Infinity) < c.pos[1]) top.set(`${c.pos[0]},${c.pos[2]}`, c);
    const arrow = { north: '^', east: '>', south: 'v', west: '<' } as const;
    const rows: string[] = [];
    for (let z = -1; z <= 5; z++) {
      let r = '';
      for (let x = -1; x <= 23; x++) {
        const c = top.get(`${x},${z}`)!;
        r += c.kind === 'roof' ? (c.shape === 'stairs' ? arrow[c.orient!.facing!] : c.shape === 'slab' ? '_' : '#') : 'W';
      }
      rows.push(r);
    }
    expect(rows).toEqual([
      '>vvvvvvvvvvvvvvvvvvvvvvvv', '>>vvvvvvvvvvvvvvvvvvvvvv<', '>>>vvvvvvv>>_<<vvvvvvvv<<', '>>>>vvvvvv>>_<vvvvvvvv<<<', '>>>>>vvvvvv>_vvvvvvvv<<<<',
      '>>>>>>vvvvvvvvvvvvvv<<<<<', '>>>>>>>vvvvvvvvvvvv<<<<<<',
    ]);
  });
});

describe('Gauben: Lage und Rhythmus', () => {
  /** Achsen (x) der Gauben je Front (Richtung nach außen) aus den Fensterankern, die es ohne Gauben nicht gibt. */
  const axes = (s: Shell, base: Shell): Record<string, number[]> => {
    const before = new Set((base.anchors ?? []).map((a) => `${a.kind}|${key3(a.pos)}`));
    const out: Record<string, number[]> = {};
    for (const a of s.anchors ?? []) {
      if (a.kind !== 'window' || before.has(`window|${key3(a.pos)}`)) continue;
      (out[a.facing] ??= []).push(a.pos[0] + ((a.span ?? 1) - 1) / 2);
    }
    for (const list of Object.values(out)) list.sort((p, q) => p - q);
    return out;
  };
  const base = shellOf(rect(23, 12), {}, null);

  it('23 × 12: je Traufseite 3 Gauben (W = 3) bzw. 4 (W = 1), symmetrisch zur Mitte x = 11, gleichmäßig verteilt', () => {
    expect(axes(shellOf(), base)).toEqual({ north: [3, 11, 19], south: [3, 11, 19] });
    expect(axes(shellOf(rect(23, 12), {}, { kind: 'gable', width: 1 }), base)).toEqual({ north: [2, 8, 14, 20], south: [2, 8, 14, 20] });
    // W = 5 passt nicht unter den First (Gaubenfirst läge nicht ≥ 1 unter dem Hauptfirst)
    expect(axes(shellOf(rect(23, 12), {}, { kind: 'gable', width: 5 }), base)).toEqual({});
  });

  it('minGap: Abstand zwischen den Gaubendächern ≥ minGap (weniger Gauben statt enger)', () => {
    for (const minGap of [0, 2, 4, 8, 12]) {
      for (const width of [1, 3] as const) {
        for (const list of Object.values(axes(shellOf(rect(23, 12), {}, { kind: 'gable', width, minGap }), base))) {
          for (let k = 1; k < list.length; k++) expect(list[k]! - list[k - 1]! - (width + 2), `${width}/${minGap}`).toBeGreaterThanOrEqual(minGap);
        }
      }
    }
    expect(axes(shellOf(rect(23, 12), {}, { kind: 'gable', width: 1, minGap: 6 }), base)).toEqual({ north: [5, 17], south: [5, 17] });
  });

  it('rhythmSlots: symmetrisch, höchstens 1 je 6 Blöcke, ungültige Achsen verringern die Zahl', () => {
    expect(rhythmSlots(-1, 23, () => true, 7)).toEqual([3, 11, 19]);
    expect(rhythmSlots(-1, 23, () => true, 5)).toEqual([2, 8, 14, 20]);
    expect(rhythmSlots(0, 5, () => true, 3)).toEqual([2]); // gerade Länge, eine Gaube: Mitte abgerundet
    expect(rhythmSlots(-1, 23, (a) => a !== 3, 7)).toEqual([5, 17]);
    expect(rhythmSlots(-1, 23, (a) => a > 20, 7)).toEqual([]);
  });

  it('Flache Neigung (1:2) am 12 tiefen Haus: keine Gauben (First zu nah); am 18 tiefen Haus mit Brüstung und Scheibe', () => {
    expect(axes(shellOf(rect(23, 12), {}, { kind: 'gable' }, { pitch: 'low' }), shellOf(rect(23, 12), {}, null, { pitch: 'low' }))).toEqual({});
    const deep = shellOf(rect(23, 18), {}, { kind: 'gable' }, { pitch: 'low' });
    expect(axes(deep, shellOf(rect(23, 18), {}, null, { pitch: 'low' }))).toEqual({ north: [3, 11, 19], south: [3, 11, 19] });
    // W4 (27.09.2026): Dachraum-Licht – Laterne `L` auf dem Dachboden
    expect(renderSection(deep, { x: 11 }).split('\n').slice(0, 5)).toEqual([
      '.........__.........', '......._‾..‾_.......', '..____‾......‾____..', '..g..............g..', '._#.........L....#_.',
    ]);
  });

  it('zweistöckig: Gauben nur mit Abstand zur Wand oben; kein Fenster des Obergeschosses grenzt an eine Dachzelle', () => {
    const s = deriveShell(twoStoryHouse().state, { roof: 'gable', dormers: { kind: 'gable', width: 1 } });
    const roofAt = new Set(s.cells.filter((c) => c.kind === 'roof' || c.kind === 'pillar').map((c) => key3(c.pos)));
    for (const w of s.cells.filter((c) => c.kind === 'window' && c.pos[1] >= 5 && c.pos[1] <= 7)) {
      for (const d of ['north', 'east', 'south', 'west'] as const) expect(roofAt.has(key3([w.pos[0] + STEP[d][0], w.pos[1], w.pos[2] + STEP[d][1]])), `${w.pos}`).toBe(false);
    }
    expect(dormerPanes(s, deriveShell(twoStoryHouse().state, { roof: 'gable' })).length).toBeGreaterThan(0);
  });

  it('Breite außerhalb 1/3/5 gilt als 3; Flachdach: keine Gauben', () => {
    expect(JSON.stringify(shellOf(rect(23, 12), {}, { kind: 'gable', width: 4 as 3 }).cells)).toBe(JSON.stringify(shellOf().cells));
    expect(JSON.stringify(shellOf(rect(23, 12), { roof: 'flat' }).cells)).toBe(JSON.stringify(shellOf(rect(23, 12), { roof: 'flat' }, null).cells));
  });
});

describe('Gauben: Front, Fenster, Anker', () => {
  it('Blindgaube = Satteldach-Gaube + Vollblock hinter jeder Scheibe; echte Gaube hat Dachraum-Luft dahinter', () => {
    const real = shellOf();
    const blind = shellOf(rect(23, 12), {}, { kind: 'blind' });
    const panes = dormerPanes(real, shellOf(rect(23, 12), {}, null));
    expect(panes).toHaveLength(24); // W3: 6 Gauben × Glasgiebel (Mitte 2 hoch, Wangen je 1)
    // W4 (27.09.2026): Dachraum-Licht – die Laternen hängen hinten an und hängen vom Dachraum ab (Vollblöcke der
    // Blindgaube), darum ohne sie vergleichen
    const shellCells = (s: typeof real): ShellCell[] => s.cells.filter((c) => !isAtticLight(c));
    const extra = shellCells(blind).slice(shellCells(real).length);
    expect(shellCells(blind).slice(0, shellCells(real).length)).toEqual(shellCells(real));
    expect(extra.map((c) => `${c.kind}/${c.role}@${key3(c.pos)}`).sort()).toEqual(panes.map((w) => {
      const back: Vec3 = w.pos[2] < 6 ? [w.pos[0], w.pos[1], w.pos[2] + 1] : [w.pos[0], w.pos[1], w.pos[2] - 1];
      return `wall/wall_primary@${key3(back)}`;
    }).sort());
    const at = new Set(real.cells.map((c) => key3(c.pos)));
    for (const w of panes) expect(at.has(key3([w.pos[0], w.pos[1], w.pos[2] + (w.pos[2] < 6 ? 1 : -1)]))).toBe(false);
  });

  // W2 (26.09.2026): Regel D4 – Brüstung und Dreieck sind Giebelfeld (`wall_gable`, Rückfall `wall_primary`)
  // W3 (27.09.2026): Gaubenmodul „Glasgiebel“ – keine Pfosten, kein Rähm; Scheiben über der ganzen Brüstung
  // W4 (27.09.2026): die Brüstung unter den Scheiben ist Dachdeckung (`roof_main`) – im Fachwerk war sie ein schwarzer Riegel
  it('Rollen: Brüstung in der Dachdeckung, darüber Glasgiebel (keine Pfosten, kein Rähm), Schulter = Haupttreppe', () => {
    const s = shellOf();
    const at = new Map(s.cells.map((c) => [key3(c.pos), c] as const));
    // Südfront der mittleren Gaube (Decke y = 4): Front z = 10, Brüstung y = 6, Scheiben y = 7 (Mitte bis y = 8), First y = 9
    expect([10, 11, 12].map((x) => [6, 7, 8, 9].map((y) => { const c = at.get(key3([x, y, 10])); return c === undefined ? '.' : `${c.kind}/${c.role}/${c.shape}`; }))).toEqual([
      ['roof/roof_main/block', 'window/window/pane', 'roof/roof_main/stairs', '.'],
      ['roof/roof_main/block', 'window/window/pane', 'window/window/pane', 'roof/roof_main/slab'],
      ['roof/roof_main/block', 'window/window/pane', 'roof/roof_main/stairs', '.'],
    ]);
    expect(s.cells.some((c) => (c.kind === 'pillar' || c.kind === 'lintel') && c.pos[1] > 5)).toBe(false);
    // Schulter: Haupttreppe (bergauf = Norden) unter der Gauben-Traufe (Treppe steigt zur Gaube, nach Osten)
    expect(at.get(key3([9, 6, 10]))).toMatchObject({ kind: 'roof', role: 'roof_main', shape: 'stairs', orient: { facing: 'north', half: 'bottom' } });
    expect(at.get(key3([9, 7, 10]))).toMatchObject({ kind: 'roof', shape: 'stairs', orient: { facing: 'east' } });
  });

  it('Anker: je Gaube ein Fensteranker (span = Scheibenspalten), keine Giebel-/First-Anker aus Gauben, übrige Anker gleich', () => {
    // Dachflächen-Anker (roof_face) verschieben sich mit den Gauben – sie sind hier ausgenommen
    const base = shellOf(rect(23, 16), {}, null);
    // W3: die 3 breite Satteldach-Gaube ist ein Glasgiebel (3 Scheibenspalten)
    for (const [kind, width, span] of [['gable', 3, 3], ['gable', 5, 3], ['shed', 3, 3], ['hip', 1, 1]] as const) {
      const s = shellOf(rect(23, 16), {}, { kind, width });
      const added = (s.anchors ?? []).filter((a) => a.kind !== 'roof_face' && !(base.anchors ?? []).some((b) => JSON.stringify(b) === JSON.stringify(a)));
      expect(added.length, `${kind}/${width}`).toBeGreaterThan(0);
      expect(added.every((a) => a.kind === 'window' && a.span === span && a.roomId === 'r1'), `${kind}/${width}`).toBe(true);
      const kept = (s.anchors ?? []).filter((a) => !added.includes(a) && a.kind !== 'roof_face');
      expect(kept, `${kind}/${width}`).toEqual((base.anchors ?? []).filter((a) => a.kind !== 'roof_face'));
    }
  });
});

describe('Fenster aus (B2): keine Giebel- und Gaubenfenster', () => {
  it('„aus“ wie die App (Randabstand ohne Platz) und `enabled: false`: kein Fenster über der Wand, Gaubenfront geschlossen', () => {
    for (const windows of [NO_WINDOWS, { enabled: false }]) {
      const s = shellOf(rect(23, 12), { windows }, { kind: 'gable' }, { gableWindows: true });
      expect(s.cells.filter((c) => c.kind === 'window')).toEqual([]);
      expect(s.cells.filter((c) => c.kind === 'lintel' && c.pos[1] > 4)).toEqual([]);
      // gleiche Zellen wie mit Fenstern; über der Wand sind Gaubenscheiben und Rähm Wand geblieben
      const on = shellOf(rect(23, 12), {}, { kind: 'gable' }, { gableWindows: false });
      expect(s.cells.map((c) => key3(c.pos))).toEqual(on.cells.map((c) => key3(c.pos)));
      s.cells.forEach((c, k) => {
        const o = on.cells[k]!;
        if (c.pos[1] > 4) expect(o.kind === 'window' || o.kind === 'lintel' ? 'wall' : o.kind).toBe(c.kind);
      });
      check(s, shellOf(rect(23, 12), { windows }, null, { gableWindows: true }), 'aus');
    }
    // `enabled: false` auch ohne Dach-Details: keine Wandfenster
    expect(deriveShell(rect(23, 12).state, { roof: 'hip', windows: { enabled: false } }).cells.some((c) => c.kind === 'window')).toBe(false);
  });

  it('Giebelfenster entfallen bei „Fenster aus“ auch mit gableWindows: true; mit Fenstern bleiben sie', () => {
    const gable = (windows?: object): number => deriveShell(rect(11, 9).state, { roof: 'gable', roofDetail: { gableWindows: true }, ...(windows !== undefined ? { windows } : {}) })
      .cells.filter((c) => c.kind === 'window' && c.pos[1] > 4).length;
    // W4 (27.09.2026): 10 Scheiben (zwei Okuli à 5); die Eck-Treppen des Okulus (`window`/`window_frame`) sind jetzt Wand
    // W13-E (2026-09-28): Drillingsfenster 3 × 2 statt Okulus (Plus) – 12 Scheiben (vorher 10)
    expect(gable()).toBe(12);
    expect(gable({ spacing: 6 })).toBe(12);
    expect(gable(NO_WINDOWS)).toBe(0);
    expect(gable({ enabled: false })).toBe(0);
  });
});

describe('Auskragung auf Konsolen (B2)', () => {
  const facade = { brackets: 3 };
  it('Auskragung um 1 mit Traufkonsolen: keine Warnung; ohne Konsolen wie bisher', () => {
    const warn = (opts: Partial<ShellOptions>): string[] => deriveShell(jettyHouse().state, { roof: 'gable', ...opts }).warnings.filter((w) => w.includes('kragt'));
    expect(warn({})).toEqual(['Raum r2 (Etage 1) kragt mit 22 Zellen über Etage 0 hinaus (Balkon/Auskragung ohne Unterbau)']);
    expect(warn({ facade })).toEqual([]);
    expect(warn({ facade: { brackets: 0, plinthProfile: true } })).toHaveLength(1);
  });

  it('weiter als 1 Block (dort setzt facade.ts keine Konsolen): nur die nicht getragenen Zellen bleiben Warnung', () => {
    const p = rooms([[0, 0, 10, 6, 'kitchen']], [[0, -2, 10, 7, 'bedroom']], [2, 3]); // Norden 2, Süden 1
    const w = deriveShell(p.state, { roof: 'gable', facade }).warnings.filter((x) => x.includes('kragt'));
    expect(w).toEqual(['Raum r2 (Etage 1) kragt mit 22 Zellen über Etage 0 hinaus (Balkon/Auskragung ohne Unterbau) (11 weitere auf Konsolen)']);
    const s = deriveShell(p.state, { roof: 'gable', facade });
    // Gegenprobe: an der Südseite (1 Block) stehen Konsolen, an der Nordseite (2 Blöcke) keine
    const consoles = s.cells.filter((c) => c.kind === 'facade' && c.pos[1] === 3);
    expect(consoles.some((c) => c.pos[2] === 7)).toBe(true);
    expect(consoles.some((c) => c.pos[2] < 0)).toBe(false);
  });
});

