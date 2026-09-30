/**
 * Dach-Paket (RF, research/18 §4 D1–D7, D14, W7; research/16 D1–D3): Profile, Grundriss-Felder der neuen Formen,
 * Hülle (Füllung, Kanten, Ortgang, Giebelfenster, Kappung) und Vanilla-Treppenformen. Die ASCII-Schnitte sind
 * zugleich die Doku (plan/spikes/RF_dach_paket.md); Legende in support/section.ts.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, type HorizontalDir } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { Project, TARGET_VERSIONS, deriveShell, type RoofDetail, type RoofPitch, type RoofStyle, type Shell, type ShellCell } from '../src/index.js';
import { OPP, STEP } from '../src/shell/grid.js';
import { placeGableWindows, settleRoofStairs, vanillaShapeAt } from '../src/shell/roof-finish.js';
import { roofField, roofProfile, type PitchedRoof } from '../src/shell/roof-shapes.js';
import { buildRoof, renderHeights, renderRoof, stairQuarters, vanillaStairShape, type RoofPlan } from '../src/shell/roof.js';
import { SHAPES, lcg, pad, randomFootprint, rectMask, type Mask } from './support/masks.js';
import { halfLeaks } from './support/leaks.js';
import { renderSection } from './support/section.js';

const PITCHED: readonly PitchedRoof[] = ['hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'];
const PITCHES: readonly RoofPitch[] = ['low', 'normal', 'steep'];

const empty = (): Project => Project.create({ id: 'p', name: 'Haus', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });

function house(w: number, d: number): Project {
  const p = empty();
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), 'storage');
  return p;
}

/**
 * W4 (27.09.2026): die Schnitte dokumentieren die Dachformen mit der Traufe auf Deckenhöhe – ohne Kniestock
 * (`kneeWall: false`, außer der Test setzt ihn selbst); den Kniestock prüft `roof-rules.test.ts`.
 */
const shellOf = (p: Project, roof: RoofStyle, roofDetail?: RoofDetail, overhang = 1): Shell =>
  deriveShell(p.state, { roof, overhang, ...(roofDetail !== undefined ? { roofDetail: { kneeWall: false, ...roofDetail } } : {}) });
const roofCells = (s: Shell): ShellCell[] => s.cells.filter((c) => c.kind === 'roof');
const key = (p: readonly number[]): string => p.join(',');
const plan = (style: PitchedRoof, g: Mask, overhang: number): RoofPlan =>
  buildRoof(roofField({ style, overhang, front: 'south' }, g.m, g.w, g.d), overhang);
const heights = (r: RoofPlan): string => renderHeights(Int32Array.from(r.cells, (c) => c?.d ?? 0), r.w, r.d);
/** Haustür-Richtung nach außen. */
const front = (s: Shell): HorizontalDir => [...s.rooms.values()].flatMap((r) => r.doors).find((d) => d.isMain)!.toward;

describe('Vertikales Profil (D1 Neigung, D3 Glockenfuß, D7 Knick)', () => {
  const fmt = (style: PitchedRoof, detail: RoofDetail, o: number, rings: number): string => {
    const p = roofProfile(style, detail, o, rings);
    return `${p.y.join(',')} ${p.form.map((f) => (f === 'stairs' ? 'T' : f === 'slab_bottom' ? '_' : '‾')).join('')}`;
  };

  it('normal = bisher (y = k, Treppen), steil = Treppe auf Füllblock (2 je Ring), flach = Stufen oben/unten im Wechsel', () => {
    expect(fmt('gable', {}, 1, 6)).toBe('0,1,2,3,4,5 TTTTTT');
    expect(fmt('gable', { pitch: 'steep' }, 1, 6)).toBe('0,2,4,6,8,10 TTTTTT');
    expect(fmt('gable', { pitch: 'low' }, 1, 6)).toBe('0,1,1,2,2,3 ‾_‾_‾_');
  });

  it('Glockenfuß: Überstand und Wandring eine Stufe flacher; bei 1:2 ohne Wirkung', () => {
    expect(fmt('gable', { flare: true }, 1, 6)).toBe('0,1,1,2,3,4 ‾_TTTT');
    expect(fmt('gable', { pitch: 'steep', flare: true }, 1, 6)).toBe('0,1,3,5,7,9 TTTTTT');
    expect(fmt('gable', { pitch: 'low', flare: true }, 1, 6)).toBe(fmt('gable', { pitch: 'low' }, 1, 6));
  });

  it('Mansard/Gambrel: unten 2:1 bis zum Knick m (Standard aus der Tiefe), darüber 1:2; Neigung verschiebt beide', () => {
    expect(fmt('mansard', {}, 1, 6)).toBe('0,2,4,5,5,6 TTT_‾_'); // m = 2
    expect(fmt('mansard', { mansardBreak: 1 }, 1, 6)).toBe('0,2,3,3,4,4 TT_‾_‾');
    expect(fmt('mansard', { pitch: 'low' }, 1, 6)).toBe('0,1,2,3,3,4 TTT_‾_');
    expect(fmt('gambrel', { pitch: 'steep' }, 1, 8)).toBe('0,2,4,6,7,8,9,10 TTTTTTTT'); // m = 3, oben 1:1
  });

  it('Eigenschaft: Oberkante steigt je Ring um ½–2 Blöcke, Treppenringe haben gerade Oberkante', () => {
    for (const style of PITCHED) {
      for (const pitch of PITCHES) {
        for (const flare of [false, true]) {
          for (const o of [0, 1, 2]) {
            const p = roofProfile(style, { pitch, flare }, o, 9);
            const top = p.y.map((y, k) => 2 * y + (p.form[k] === 'slab_bottom' ? 1 : 2));
            for (let k = 1; k < top.length; k++) {
              expect(top[k]! - top[k - 1]!, `${style} ${pitch} ${flare} ${o} k=${k}`).toBeGreaterThanOrEqual(1);
              expect(top[k]! - top[k - 1]!).toBeLessThanOrEqual(4);
            }
          }
        }
      }
    }
  });
});

describe('Grundriss-Felder der neuen Formen', () => {
  it('Krüppelwalm (D6): Giebel bis Ring R − rows, darüber Walm (Standard 2 Walm-Ringe ab 5 Ringen)', () => {
    const r = plan('half_hip', pad(rectMask(9, 7), 2), 1);
    expect(renderRoof(r)).toBe([
      '.............', '.vvvvvvvvvvv.', '.vvvvvvvvvvv.', '.ovvvvvvvvvo.', '.>ovvvvvvvo<.', '.>>=======<<.',
      '.>o^^^^^^^o<.', '.o^^^^^^^^^o.', '.^^^^^^^^^^^.', '.^^^^^^^^^^^.', '.............',
    ].join('\n'));
    // halfHipRows 1: nur die Firstzelle am Ortgang fällt
    const one = buildRoof(roofField({ style: 'half_hip', overhang: 1, front: 'south', detail: { halfHipRows: 1 } }, pad(rectMask(9, 7), 2).m, 13, 11), 1);
    expect(heights(one).split('\n')[5]).toBe('.45555555554.');
  });

  it('Fußwalm (D6): Walm unten ringsum, Ziergiebel k Zellen zurückgesetzt (Sprung im Feld)', () => {
    const r = plan('dutch_gable', pad(rectMask(13, 9), 2), 1);
    expect(heights(r)).toBe([
      '.................', '.111111111111111.', '.122222222222221.', '.123333333333321.', '.123444444444321.', '.123555555555321.',
      '.123666666666321.', '.123555555555321.', '.123444444444321.', '.123333333333321.', '.122222222222221.', '.111111111111111.',
      '.................',
    ].join('\n'));
  });

  it('Saltbox (D14): Vorderseite um a = 2·round(Tiefe/6) Ringe höher, First aus der Mitte', () => {
    expect(heights(plan('saltbox', pad(rectMask(9, 7), 1), 0))).toBe(['...........', '.111111111.', '.222222222.', '.333333333.', '.444444444.', '.555555555.', '.444444444.', '.333333333.', '...........'].join('\n'));
  });

  it('Pultdach: eine Fläche quer zur Langseite, steigt von der Vorderseite weg', () => {
    const r = plan('shed', pad(rectMask(9, 5), 1), 0);
    expect(heights(r)).toBe(['...........', '.555555555.', '.444444444.', '.333333333.', '.222222222.', '.111111111.', '...........'].join('\n'));
    expect(renderRoof(r).split('\n')[3]).toBe('.^^^^^^^^^.');
  });
});

describe('Dachtreppen der Satteldach-Familie gegen die Vanilla-Regel', () => {
  /** Kehle am Dachrand: die Vorderseite fehlt, Vanilla kann dort keine Innenecke bilden. */
  const boundaryValley = (r: RoofPlan, i: number): boolean => {
    const c = r.cells[i]!;
    const f = c.options[r.choice[i]!]!.facing;
    const j = i + STEP[OPP[f]][0] + STEP[OPP[f]][1] * r.w;
    return c.cls === 'valley' && r.cells[j] === undefined;
  };

  for (const style of ['gable', 'gambrel'] as const) {
    it(`${style}: auf allen Test-Grundrissen (Überstand 0/1) ist jede Treppe update-stabil außer Kehlen am Dachrand`, () => {
      for (const [name, g] of Object.entries(SHAPES)) {
        for (const o of [0, 1]) {
          const r = plan(style, pad(g, o + 2), o);
          r.cells.forEach((c, i) => {
            if (c === undefined || c.options.length === 0 || r.unstable.includes(i)) return;
            expect(stairQuarters(c.options[r.choice[i]!]!.facing, vanillaStairShape(r.cells, r.choice, r.w, r.d, i)), `${name}/${o}`).toBe(c.high);
          });
          for (const i of r.unstable) expect(boundaryValley(r, i), `${name}/${o} @${i % r.w},${Math.floor(i / r.w)}`).toBe(true);
        }
      }
    });
  }

  it('alle Formen, Zufallsgrundrisse: < 0,5 % der Dachtreppen nicht update-stabil', () => {
    for (const style of PITCHED) {
      const rnd = lcg(3);
      let stairs = 0;
      let unstable = 0;
      for (let k = 0; k < 60; k++) {
        const r = plan(style, pad(randomFootprint(rnd), 3), k % 3);
        stairs += r.cells.filter((c) => c !== undefined && c.options.length > 0).length;
        unstable += r.unstable.length;
      }
      expect(unstable / stairs, style).toBeLessThan(0.005);
    }
  });

  it('Hülle: jede Dachtreppe trägt die Form, die Vanilla aus den Nachbarn bildet (auch über Etagen hinweg)', () => {
    const rnd = lcg(5);
    const projects = [house(11, 7), house(9, 9), twoStoryHouse(), ...Array.from({ length: 12 }, () => fromMask(randomFootprint(rnd)))];
    for (const p of projects) {
      for (const roof of PITCHED) {
        for (const overhang of [0, 1, 2, 3]) {
          const s = shellOf(p, roof, { pitch: overhang === 2 ? 'steep' : 'normal', verge: 'closed' }, overhang);
          const stairs = new Map(s.cells.filter((c) => c.shape === 'stairs' && c.orient?.facing !== undefined).map((c) => [key(c.pos), { facing: c.orient!.facing!, half: c.orient!.half ?? 'bottom' }] as const));
          for (const c of roofCells(s)) {
            if (c.shape !== 'stairs' || c.orient?.half !== 'bottom') continue;
            expect(c.orient.stairShape, `${roof}/${overhang} ${c.pos}`).toBe(vanillaShapeAt(stairs, c.pos));
          }
        }
      }
    }
  }, HEAVY_TIMEOUT);

  it('settleRoofStairs: Außenecke aus zwei Treppen bekommt outer, allein stehende straight', () => {
    const cells: ShellCell[] = [
      { pos: [0, 5, 0], kind: 'roof', role: 'roof_main', shape: 'stairs', orient: { facing: 'south', half: 'bottom', stairShape: 'straight' } },
      { pos: [0, 5, 1], kind: 'roof', role: 'roof_main', shape: 'stairs', orient: { facing: 'east', half: 'bottom', stairShape: 'straight' } },
      { pos: [5, 5, 5], kind: 'roof', role: 'roof_main', shape: 'stairs', orient: { facing: 'north', half: 'bottom', stairShape: 'inner_left' } },
    ];
    settleRoofStairs(cells);
    // A: hinten (Süden) steht B mit facing east = CCW(south) → outer_left
    expect(cells.map((c) => c.orient?.stairShape)).toEqual(['outer_left', 'straight', 'straight']);
  });
});

describe('Hülle: normal ohne Details = bisher, Schnitte je Form und Neigung', () => {
  // W2 (26.09.2026): Regel D6 gilt mit Dach-Details (Kappung an höheren Wänden ≤ 2) – der Vergleich deshalb ohne das
  // zweistöckige Haus (dort steigt das untere Dach an die höhere Wand)
  it('ohne roofDetail ≡ { pitch: normal, gableWindows: false } für alle Formen, Grundrisse (eine Etage) und Überstände', () => {
    const rnd = lcg(9);
    for (const p of [house(11, 7), house(8, 6), fromMask(SHAPES.L!), fromMask(SHAPES.U!), fromMask(randomFootprint(rnd))]) {
      for (const roof of PITCHED) {
        for (const overhang of [0, 1, 2]) {
          expect(JSON.stringify(shellOf(p, roof, { pitch: 'normal', gableWindows: false }, overhang).cells), `${roof}/${overhang}`).toBe(JSON.stringify(shellOf(p, roof, undefined, overhang).cells));
        }
      }
    }
  });

  it('Schnappschuss Walm/Sattel ohne Details (Dachzellen + Giebelwände über der Decke)', () => {
    const digest = (s: Shell): string => {
      const text = JSON.stringify(s.cells.filter((c) => c.kind === 'roof' || (c.kind === 'wall' && c.pos[1] > 4)));
      let h = 0x811c9dc5;
      for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 0x01000193) >>> 0;
      return `${text.length}:${h.toString(16)}`;
    };
    const rooms = (list: ReadonlyArray<readonly [number, number, number, number]>): Project => {
      const p = empty();
      for (const [x1, z1, x2, z2] of list) p.paintRoom(0, CellSet.rect(x1, z1, x2, z2), 'storage');
      return p;
    };
    // Werte vor dem Dach-Paket erzeugt (gleiche Grundrisse wie shell-floors.test.ts, Überstand 1)
    // W2 (26.09.2026): Regel D4 – Satteldach-Giebel jetzt in der Rolle `wall_gable` (Walm unverändert)
    const layouts = [house(11, 7), rooms([[0, 0, 10, 4], [0, 5, 4, 12]]), rooms([[0, 0, 14, 4], [5, 5, 9, 12]]), rooms([[6, 0, 10, 16], [0, 6, 16, 10]])];
    const out = layouts.flatMap((p) => (['hip', 'gable'] as const).map((roof) => digest(shellOf(p, roof))));
    expect(out).toMatchInlineSnapshot(`
      [
        "18462:1704a7a",
        "19847:d62c4149",
        "22785:954eddd2",
        "23517:908d5878",
        "27146:500a7899",
        "27880:a54ed6ef",
        "33692:8ea041a2",
        "34654:f0ea7dec",
      ]
    `);
  });

  const cut = (roof: RoofStyle, detail: RoofDetail, plane: { x: number } | { z: number }, w = 11, d = 9): string => renderSection(shellOf(house(w, d), roof, detail), plane);

  // W4 (27.09.2026): Dachraum-Licht – in den Schnitten steht die Laterne `L` mittig auf dem Dachboden
  it('Satteldach 11×9: 1:2 Stufen im Wechsel, 1:1 Treppen, 2:1 Treppe auf Füllblock (Querschnitt)', () => {
    expect(cut('gable', { pitch: 'low', gableWindows: false }, { x: 5 })).toBe(['....._.....', '..._‾.‾_...', '._‾..L..‾_.', '‾CCCCCCCCC‾', '.W.......W.', '.W.......W.', '.W.......W.', '.FFFFFFFFF.'].join('\n'));
    expect(cut('gable', { gableWindows: false }, { x: 5 })).toBe(['....._.....', '..../.\\....', '.../...\\...', '../.....\\..', './...L...\\.', '/CCCCCCCCC\\', '.W.......W.', '.W.......W.', '.W.......W.', '.FFFFFFFFF.'].join('\n'));
    // W2 (26.09.2026): Regel D2 – über der Traufe keine Wandzelle mehr, der Füllblock gehört zur Dachfläche
    expect(cut('gable', { pitch: 'steep', gableWindows: false }, { x: 5 })).toBe([
      '....._.....', '.....#.....', '..../.\\....', '....#.#....', '.../...\\...', '...#...#...', '../.....\\..', '..#.....#..', './.......\\.', '.#...L...#.',
      '/CCCCCCCCC\\', '.W.......W.', '.W.......W.', '.W.......W.', '.FFFFFFFFF.',
    ].join('\n'));
  });

  it('Mansard/Gambrel: unten steil mit Füllblock, oben Stufen; Giebel des Gambrels folgt dem Knick (mit Okulus)', () => {
    // W2 (26.09.2026): Regel D2 – Traufseite ohne Wandband
    expect(cut('mansard', { gableWindows: false }, { x: 5 })).toBe(['....._.....', '..._‾.‾_...', '../.....\\..', '..#.....#..', './.......\\.', '.#...L...#.', '/CCCCCCCCC\\', '.W.......W.', '.W.......W.', '.W.......W.', '.FFFFFFFFF.'].join('\n'));
    // W4 (27.09.2026): Okulus-Ecken sind Giebelwand (`W`) statt Treppen (`o`)
    // W13-E (2026-09-28): Drillingsfenster 3 × 2 statt Okulus (Glas im Plus las sich als Kreuz); vorher Zeilen 3–5 Plus
    expect(cut('gambrel', {}, { x: 0 }, 13)).toBe(['....._.....', '..._#W#_...', '../WWWWW\\..', '..WWgggWW..', './WWgggWW\\.', '.WWWWWWWWW.', '/CCCCCCCCC\\', '.WWWWgWWWW.', '.WWWWgWWWW.', '.WWWWWWWWW.', '.FFFFFFFFF.'].join('\n'));
  });

  it('Krüppelwalm und Fußwalm im Längsschnitt: First kürzer bzw. Ziergiebel zurückgesetzt', () => {
    expect(cut('half_hip', { gableWindows: false }, { z: 4 }, 13)).toBe(['..___________..', './...........\\.', '/W...........W\\', '.W...........W.', '.W.....L.....W.', '.CCCCCCCCCCCCC.', '.g...........g.', '.g...........g.', '.W...........W.', '.FFFFFFFFFFFFF.'].join('\n'));
    expect(cut('dutch_gable', { gableWindows: false }, { z: 4 }, 13)).toBe(['..._________...', '...W.......W...', '...W.......W...', '../.........\\..', './.....L.....\\.', '/CCCCCCCCCCCCC\\', '.g...........g.', '.g...........g.', '.W...........W.', '.FFFFFFFFFFFFF.'].join('\n'));
  });

  it('Saltbox: Vorderseite (Haustür) mit Kniestock höher, First aus der Mitte; Pultdach steigt von der Tür weg', () => {
    for (const roof of ['saltbox', 'shed'] as const) {
      const s = shellOf(house(13, 9), roof, { gableWindows: false });
      const f = front(s);
      const eave = (side: HorizontalDir): number => {
        const line = side === 'north' ? -1 : side === 'south' ? 9 : side === 'west' ? -1 : 13;
        const along = side === 'north' || side === 'south';
        return Math.max(...roofCells(s).filter((c) => (along ? c.pos[2] : c.pos[0]) === line).map((c) => c.pos[1]));
      };
      if (roof === 'saltbox') expect(eave(f), roof).toBeGreaterThan(eave(OPP[f]));
      else expect(eave(f), roof).toBeLessThan(eave(OPP[f]));
    }
  });
});

describe('Hülle: Kanten, Ortgang, Giebelfenster, Kappung', () => {
  it('trim: Traufe, Ortgang, First und Grate in roof_trim, Fläche roof_main; ohne trim keine Kante', () => {
    for (const roof of ['gable', 'hip'] as const) {
      const s = shellOf(house(11, 9), roof, { trim: true });
      const cells = roofCells(s);
      const y0 = Math.min(...cells.map((c) => c.pos[1]));
      expect(cells.filter((c) => c.pos[1] === y0).every((c) => c.role === 'roof_trim'), `${roof} Traufe`).toBe(true);
      expect(cells.filter((c) => c.shape === 'slab').every((c) => c.role === 'roof_trim'), `${roof} First`).toBe(true);
      expect(cells.some((c) => c.role === 'roof_main')).toBe(true);
      if (roof === 'gable') expect(cells.filter((c) => c.pos[0] === -1 || c.pos[0] === 11).every((c) => c.role === 'roof_trim')).toBe(true);
      else expect(cells.filter((c) => c.orient?.stairShape?.startsWith('outer')).every((c) => c.role === 'roof_trim')).toBe(true);
      expect(roofCells(shellOf(house(11, 9), roof, {})).some((c) => c.role === 'roof_trim')).toBe(false);
    }
  });

  it('verge closed: unter jeder Ortgang-Treppe eine umgedrehte Treppe (Front zur Traufe), unter dem First eine obere Stufe', () => {
    for (const pitch of PITCHES) {
      const s = shellOf(house(11, 8), 'gable', { pitch, verge: 'closed' });
      const at = new Map(s.cells.map((c) => [key(c.pos), c] as const));
      const verge = roofCells(s).filter((c) => c.pos[0] === -1 && c.orient?.half !== 'top');
      const surface = new Map<number, ShellCell>();
      for (const c of verge) if ((surface.get(c.pos[2])?.pos[1] ?? -Infinity) < c.pos[1]) surface.set(c.pos[2], c);
      for (const top of surface.values()) {
        if (top.shape === 'slab' && top.orient?.half === 'top') continue; // obere Stufe: Unterkante liegt schon halb hoch
        // W4 (27.09.2026, D5): unter dem äußersten Ring (Traufecke) keine Unterseite – die Kante endet über der Traufunterkante
        if (top.pos[2] === -1 || top.pos[2] === 8) {
          expect(at.get(key([-1, top.pos[1] - 1, top.pos[2]])), `${pitch} Traufecke z=${top.pos[2]}`).toBeUndefined();
          continue;
        }
        const col = verge.filter((c) => c.pos[2] === top.pos[2]);
        const low = Math.min(...col.map((c) => c.pos[1]));
        const under = at.get(key([-1, low - 1, top.pos[2]]));
        expect(under?.kind, `${pitch} z=${top.pos[2]}`).toBe('roof');
        expect(under?.orient?.half).toBe('top');
        if (top.shape === 'stairs') expect(under?.orient?.facing).toBe(OPP[top.orient!.facing!]);
      }
      // nichts im Grundriss (dort steht die Giebelwand)
      expect(roofCells(s).filter((c) => c.orient?.half === 'top' && c.shape === 'stairs' && c.pos[0] >= 0 && c.pos[0] <= 10 && c.pos[2] >= 0 && c.pos[2] <= 7)).toEqual([]);
    }
  });

  it('dicht auch in Halbblöcken (Stufen-Spalten): Luft über den Decken ist von außen nicht erreichbar', () => {
    for (const p of [house(11, 9), house(17, 13), twoStoryHouse(), fromMask(SHAPES.L!)]) {
      for (const roof of PITCHED) {
        for (const pitch of PITCHES) {
          for (const overhang of [0, 1, 2]) {
            const s = shellOf(p, roof, { pitch, flare: true, verge: 'closed' }, overhang);
            expect(halfLeaks(s), `${roof}/${pitch}/${overhang}`).toEqual([]);
          }
        }
      }
    }
  }, HEAVY_TIMEOUT);

  it('Giebelfenster (W7): 11×7 je Giebel 1 Fenster auf der Achse, 11×9 Band 3×1; aus ohne Details oder gableWindows: false', () => {
    const panes = (s: Shell): string[] => s.cells.filter((c) => c.kind === 'window' && c.pos[1] > 4).map((c) => `${key(c.pos)}:${c.shape}`).sort();
    expect(panes(shellOf(house(11, 7), 'gable', {}))).toEqual(['0,6,3:pane', '10,6,3:pane']);
    const oculus = panes(shellOf(house(11, 9), 'gable', {}));
    // W4 (27.09.2026): Okulus als Pixelkreis – Glas im Plus, die Ecken bleiben Giebelwand (vorher Treppen: die obere und
    // untere Scheibe hatten keine Verbindung)
    // W13-E (2026-09-28): statt des Okulus (Plus, las sich als Kreuz) ein liegendes Band 3 × 1 – das Drillingsfenster 3 × 2
    // ist hier zu hoch; vorher 5 Scheiben im Plus ('0,5,4', '0,6,3', '0,6,4', '0,6,5', '0,7,4')
    expect(oculus.filter((c) => c.startsWith('0,'))).toEqual(['0,6,3:pane', '0,6,4:pane', '0,6,5:pane']);
    expect(oculus).toHaveLength(6);
    const g = shellOf(house(11, 9), 'gable', {});
    expect(g.cells.filter((c) => c.role === 'window_frame' && c.pos[0] === 0)).toEqual([]);
    for (const [y, z] of [[5, 3], [5, 4], [5, 5], [7, 3], [7, 4], [7, 5]] as const) expect(g.cells.find((c) => key(c.pos) === key([0, y, z]))?.kind).toBe('wall');
    expect(panes(shellOf(house(11, 9), 'gable'))).toEqual([]);
    expect(panes(shellOf(house(11, 9), 'gable', { gableWindows: false }))).toEqual([]);
  });

  it('Giebelfenster (Merrell): verdeckte Scheibe (Zelle außen belegt) entfällt, sonst Fenster auf der Achse', () => {
    const wall = (x: number, y: number, z: number): ShellCell => ({ pos: [x, y, z], kind: 'wall', role: 'wall_primary', shape: 'block', roomId: 'r1', exterior: true });
    const tri = [1, 2, 3, 2, 1];
    const columns = tri.map((h, z) => ({ x: 0, z, dir: 'west' as const, y0: 5, y1: 4 + h, group: 4 }));
    const build = (blocked: boolean): ShellCell[] => {
      const cells = columns.flatMap((g) => Array.from({ length: g.y1 - g.y0 + 1 }, (_, k) => wall(0, g.y0 + k, g.z)));
      // Merrell: außen belegt (z. B. anderes Dach) – beide möglichen Zeilen verdeckt
      if (blocked) for (const y of [5, 6]) cells.push({ pos: [-1, y, 2], kind: 'roof', role: 'roof_main', shape: 'block', exterior: true });
      placeGableWindows(cells, columns);
      return cells.filter((c) => c.kind === 'window');
    };
    expect(build(false).map((c) => key(c.pos))).toEqual(['0,6,2']);
    expect(build(true)).toEqual([]);
  });

  it('Fußwalm: der Ziergiebel ist Wand im Grundriss über dem Walm; mit Details trägt er ein Fenster, wenn er groß genug ist', () => {
    // W3 (27.09.2026): Dach-Teilung aus – 17 × 13 mit lichter Höhe 3 läge über dem Höhen-Budget und würde geteilt;
    // hier geht es um den Ziergiebel eines ungeteilten Fußwalms
    const s = shellOf(house(17, 13), 'dutch_gable', { split: false });
    const gablet = s.cells.filter((c) => (c.kind === 'wall' || c.kind === 'window') && c.pos[1] > 5 && c.pos[0] > 0 && c.pos[0] < 16);
    expect(gablet.length).toBeGreaterThan(8);
    expect(new Set(gablet.map((c) => c.pos[0])).size).toBe(2); // je Ende eine Ebene
    expect(gablet.some((c) => c.kind === 'window')).toBe(true);
  });

  it('zwei Etagen: unteres Dach nie über der Wand oben (Kappung je Neigung), kein Fenster grenzt an eine Dachzelle (Merrell)', () => {
    const p = twoStoryHouse();
    for (const roof of PITCHED) {
      for (const pitch of PITCHES) {
        const s = shellOf(p, roof, { pitch, trim: true, verge: 'closed', flare: true });
        const lower = roofCells(s).filter((c) => c.roomId === 'r4'); // Schmiede (eingeschossig, Pultdach an der Wand oben)
        expect(lower.length, `${roof}/${pitch}`).toBeGreaterThan(0);
        expect(Math.max(...lower.filter((c) => c.pos[0] === 15).map((c) => c.pos[1])), `${roof}/${pitch}`).toBeLessThanOrEqual(4 + 3);
        const roofAt = new Set(roofCells(s).map((c) => key(c.pos)));
        for (const w of s.cells.filter((c) => c.kind === 'window' && c.shape === 'pane')) {
          for (const dir of ['north', 'east', 'south', 'west'] as const) {
            expect(roofAt.has(key([w.pos[0] + STEP[dir][0], w.pos[1], w.pos[2] + STEP[dir][1]])), `${roof}/${pitch} Fenster ${w.pos}`).toBe(false);
          }
        }
      }
    }
  });
});

/** Grundriss aus einer Maske; getrennte Teile werden eigene Räume. */
function fromMask(g: Mask): Project {
  const p = empty();
  const cells: Array<[number, number]> = [];
  for (let z = 0; z < g.d; z++) for (let x = 0; x < g.w; x++) if (g.m[z * g.w + x]) cells.push([x + 2, z + 2]);
  for (const part of CellSet.of(cells).components()) p.paintRoom(0, part, 'storage');
  return p;
}

function twoStoryHouse(): Project {
  const p = empty();
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
