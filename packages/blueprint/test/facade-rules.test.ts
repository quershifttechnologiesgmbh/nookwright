/**
 * Q2 – Fassaden-Pflichtregeln (research/58 §Q2 aus research/59 Hebel 1–5, research/53 §1–5, research/55 Hebel 1/5).
 * Geprüft wird jede Regel einzeln über die Hülle: Dachüberstand ≥ 1, Dachkante, Fensterrahmen mit Rücksprung, Sockel
 * in der Theme-Rolle `foundation`, Vorsprung ab 6 Blöcken Wandlänge, höchstens 3 gleiche Fensterachsen in Folge und
 * genau ein Fokuspunkt je Fassade. Ohne `FacadeStyle.rules` bleibt die Hülle zellgleich (Prüfsummen-Test).
 */
import { describe, expect, it } from 'vitest';
import { CellSet, HORIZONTAL, key3, type HorizontalDir, type Vec3 } from '@mcda/core';
import { Project, TARGET_VERSIONS, deriveShell, type FacadeRules, type Shell, type ShellCell } from '../src/index.js';
import { FACADE_QUALITY_RULES } from '../src/shell/facade.js';
import { OPP, STEP, axisOf } from '../src/shell/grid.js';

function house(seed = 2026): Project {
  const p = Project.create({ id: 'p', name: 'Haus', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  return p;
}

/** Langhaus: eine Wandlinie deutlich über 6 Blöcke (Südwand 19 Spalten). */
function longHouse(): Project {
  const p = Project.create({ id: 'p2', name: 'Langhaus', seed: 3, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 18, 5), 'tavern');
  return p;
}

const shell = (p: Project, rules: FacadeRules | undefined, extra: object = {}): Shell =>
  deriveShell(p.state, { roof: 'gable', facade: { ...extra, ...(rules !== undefined ? { rules } : {}) } });
const facadeOf = (s: Shell): ShellCell[] => s.cells.filter((c) => c.kind === 'facade');
const roleCells = (s: Shell, role: string): ShellCell[] => s.cells.filter((c) => c.role === role);
const at = (p: Vec3, d: HorizontalDir, k = 1): Vec3 => [p[0] + STEP[d][0] * k, p[1], p[2] + STEP[d][1] * k];
const key = (p: Vec3): string => key3(p);
const onSameCell = (a: Vec3, b: Vec3): boolean => key(a) === key(b);

/** Fensteranker nach Fassadenlinie (Etage + Außenseite + Wandebene), in Laufrichtung sortiert. */
function axesByLine(s: Shell): Map<string, Array<{ pos: Vec3; facing: HorizontalDir; span: number }>> {
  const out = new Map<string, Array<{ pos: Vec3; facing: HorizontalDir; span: number }>>();
  for (const a of (s.anchors ?? []).filter((x) => x.kind === 'window')) {
    const k = `${a.floorIndex}|${a.facing}|${axisOf(a.facing) === 'z' ? a.pos[2] : a.pos[0]}`;
    (out.get(k) ?? out.set(k, []).get(k)!).push({ pos: a.pos, facing: a.facing, span: a.span ?? 1 });
  }
  for (const list of out.values()) list.sort((x, y) => (axisOf(x.facing) === 'z' ? x.pos[0] - y.pos[0] : x.pos[2] - y.pos[2]));
  return out;
}

describe('Q2 Dach: Überstand ≥ 1 und Dachkante', () => {
  it('minOverhang hebt `overhang: 0` an; ohne die Regel bleibt 0', () => {
    const p = house();
    const roof = (s: Shell): string => JSON.stringify(s.cells.filter((c) => c.kind === 'roof'));
    const zero = deriveShell(p.state, { roof: 'gable', overhang: 0 });
    const one = deriveShell(p.state, { roof: 'gable', overhang: 1 });
    const forced = deriveShell(p.state, { roof: 'gable', overhang: 0, facade: { rules: { minOverhang: 1 } } });
    expect(roof(zero)).not.toBe(roof(one)); // Überstand 0 ist wirklich flacher
    expect(roof(forced)).toBe(roof(one)); // … und wird angehoben
  });

  it('roofEdge erzwingt die Rolle `roof_trim`, ohne sie gibt es keine – Giebelfenster bleiben, wie sie waren', () => {
    const p = house();
    expect(roleCells(shell(p, undefined), 'roof_trim')).toHaveLength(0);
    expect(roleCells(shell(p, { roofEdge: true }), 'roof_trim').length).toBeGreaterThan(0);
    const gableWindows = (s: Shell): number => {
      const ceiling = Math.max(...s.cells.filter((c) => c.kind === 'ceiling').map((c) => c.pos[1]));
      return s.cells.filter((c) => c.kind === 'window' && c.pos[1] > ceiling).length;
    };
    expect(gableWindows(shell(p, { roofEdge: true }))).toBe(gableWindows(shell(p, undefined)));
  });
});

describe('Q2 Sockel in der Rolle `foundation`', () => {
  it('foundationBase schaltet das Sockelprofil ein und färbt es als foundation', () => {
    const p = house();
    expect(facadeOf(shell(p, undefined)).filter((c) => c.role === 'wall_plinth')).toHaveLength(0);
    const plain = shell(p, undefined, { plinthProfile: true });
    const plinth = facadeOf(plain).filter((c) => c.role === 'wall_plinth');
    expect(plinth.length).toBeGreaterThan(0);
    const forced = facadeOf(shell(p, { foundationBase: true }));
    expect(forced.filter((c) => c.role === 'wall_plinth')).toHaveLength(0);
    expect(forced.filter((c) => c.role === 'foundation')).toHaveLength(plinth.length);
  });
});

describe('Q2 Fenster: Rahmen mit 1 Block Rücksprung', () => {
  it('windowFrame setzt Rahmenzellen um jede Öffnung, aber nie direkt vor die Scheibe', () => {
    const p = house();
    expect(facadeOf(shell(p, undefined)).filter((c) => c.role === 'window_frame')).toHaveLength(0);
    const s = shell(p, { windowFrame: true });
    const frames = facadeOf(s).filter((c) => c.role === 'window_frame');
    expect(frames.length).toBeGreaterThan(0);
    // Jede Öffnung bekommt ihre Rahmenecken: in den Nebenspalten eine Reihe unter der Bank und über der Verdachung
    for (const [k, list] of axesByLine(s)) {
      for (const a of list) {
        const along: HorizontalDir = axisOf(a.facing) === 'z' ? 'east' : 'south';
        const got = [-1, a.span].flatMap((j) => [-1, 2].map((dy) => [j, dy] as const))
          .filter(([j, dy]) => frames.some((f) => onSameCell(f.pos, [a.pos[0] + STEP[along][0] * j, a.pos[1] + dy, a.pos[2] + STEP[along][1] * j])));
        expect(got.length, `${k} @${a.pos}: Rahmenecken`).toBeGreaterThan(0);
      }
    }
    // Nie auf der Scheibe und nie in der Zelle direkt davor
    const windows = s.cells.filter((c) => c.kind === 'window');
    const anchors = (s.anchors ?? []).filter((a) => a.kind === 'window');
    for (const f of frames) {
      expect(windows.some((w) => onSameCell(f.pos, w.pos)), `Rahmen auf der Scheibe ${key(f.pos)}`).toBe(false);
      expect(anchors.some((a) => onSameCell(f.pos, a.pos)), `Rahmen vor der Scheibe ${key(f.pos)}`).toBe(false);
    }
  });

  it('Fensterachsen brechen spätestens nach `maxIdenticalAxes` Rahmen (Wiederholung mit Bruch)', () => {
    const p = longHouse();
    const s = shell(p, { windowFrame: true, maxIdenticalAxes: 3 });
    const signature = (a: { pos: Vec3; facing: HorizontalDir; span: number }): string => {
      const along: HorizontalDir = axisOf(a.facing) === 'z' ? 'east' : 'south';
      const ring: string[] = [];
      for (let j = -1; j <= a.span; j++) for (let dy = -1; dy <= 4; dy++) {
        const b = at(a.pos, along, j);
        const c = s.cells.find((x) => x.kind === 'facade' && x.pos[0] === b[0] && x.pos[2] === b[2] && x.pos[1] === b[1] + dy);
        if (c !== undefined) ring.push(`${j}:${dy}:${c.role}/${c.shape}`);
      }
      ring.sort();
      return `${a.span}|${ring.join(',')}`;
    };
    for (const [k, list] of axesByLine(s)) {
      let run = 0;
      for (let i = 0; i < list.length; i++) {
        run = i > 0 && signature(list[i]!) === signature(list[i - 1]!) ? run + 1 : 1;
        expect(run, `${k}: höchstens 3 gleiche Fensterachsen in Folge`).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('Q2 Wandlänge und Fokuspunkt', () => {
  it('pierFrom erzwingt eine Wandvorlage ab der Wandlänge – auch bei `pilasters: 0`', () => {
    const p = longHouse();
    const logs = (s: Shell): number => facadeOf(s).filter((c) => c.shape === 'log').length;
    expect(logs(shell(p, undefined, { pilasters: 0 }))).toBe(0);
    expect(logs(shell(p, { pierFrom: 6 }, { pilasters: 0 }))).toBeGreaterThan(0);
    expect(logs(shell(house(), { pierFrom: 6 }, { pilasters: 0 }))).toBeLessThan(logs(shell(p, { pierFrom: 6 }, { pilasters: 0 })));
  });

  it('focus gibt höchstens einer Achse je Fassade die höchste Detaildichte (zusätzliche Verdachung), nie auf der Traufe', () => {
    const s = shell(house(), { windowFrame: true, focus: true });
    /** Hüllzelle hinter der Ankerzeile (Wandebene der Öffnung). */
    const behind = (a: { pos: Vec3; facing: HorizontalDir }): Vec3 => at(a.pos, OPP[a.facing]);
    const column = (p: Vec3): ShellCell[] => s.cells.filter((c) => c.pos[0] === p[0] && c.pos[2] === p[2]);
    /** Öffnungshöhe: zusammenhängende Fensterzellen über der Ankerzeile. */
    const openingHeight = (a: { pos: Vec3; facing: HorizontalDir }): number => {
      const col = column(behind(a));
      let h = 0;
      while (col.some((c) => c.kind === 'window' && c.pos[1] === a.pos[1] + h)) h++;
      return Math.max(1, h);
    };
    /** Wandhöhe der Linie (zusammenhängende Wandreihen durch die Ankerzeile). */
    const wallHeight = (a: { pos: Vec3; facing: HorizontalDir }): number => {
      const structural = new Set(['wall', 'pillar', 'window', 'door', 'lintel']);
      const rows = column(behind(a)).filter((c) => structural.has(c.kind)).map((c) => c.pos[1]);
      return Math.max(...rows.filter((y) => y >= a.pos[1])) - Math.min(...rows.filter((y) => y <= a.pos[1])) + 1;
    };
    // W2 (26.09.2026): Regel F8 „Traufzone frei“ – eine Fokus-Verdachung, die auf die Traufe käme, entfällt; je Fassade
    // also höchstens ein Fokuspunkt (genau einer, wo er unter der Traufe Platz hat) und nie eine Rahmenzelle über der Traufe.
    let total = 0;
    for (const [k, list] of axesByLine(s)) {
      const focused = list.filter((a) => s.cells.some((c) => c.kind === 'facade' && c.role === 'window_frame' && c.shape === 'stairs'
        && c.pos[0] === a.pos[0] && c.pos[2] === a.pos[2] && c.pos[1] === a.pos[1] + openingHeight(a) + 1));
      expect(focused.length, `${k}: höchstens ein Fokuspunkt`).toBeLessThanOrEqual(1);
      total += focused.length;
      // Research 55/58 §Q2: die 25-%-Regel gilt für Höhe/Breite des Fokusobjekts, nicht für die Detaildichte.
      for (const f of focused) expect(openingHeight(f) / wallHeight(f), `${k}: Fokusobjekt ≥ 25 % der Wandhöhe`).toBeGreaterThanOrEqual(0.25);
    }
    expect(total, 'mindestens ein Fokuspunkt am Haus').toBeGreaterThan(0);
    const roofBelow = (c: ShellCell): boolean => s.cells.some((r) => r.kind === 'roof' && r.pos[0] === c.pos[0] && r.pos[2] === c.pos[2] && r.pos[1] < c.pos[1]);
    expect(s.cells.filter((c) => c.role === 'window_frame' && roofBelow(c)), 'keine Rahmenzelle über der Traufe').toEqual([]);
  });
});

describe('Q2 Standardregelsatz', () => {
  it('FACADE_QUALITY_RULES deckt alle Pflichten ab', () => {
    // W2 (26.09.2026): Regeln W1/I2 (`skin`), F1–F4/W2 (`grid`) und I4 (`jambs`) sind Standard
    // W4 (27.09.2026): Haustür im Mittelfeld (`centerDoor`, F3) und Doppeltür für Säle (`doubleDoor`) sind Standard
    expect(FACADE_QUALITY_RULES).toEqual({
      minOverhang: 1, roofEdge: true, windowFrame: true, foundationBase: true, pierFrom: 6, maxIdenticalAxes: 3, focus: true,
      skin: true, grid: true, jambs: true, centerDoor: true,
      doubleDoor: ['tavern', 'throne_room', 'mead_hall', 'dining_hall', 'trading_hall', 'chapel'],
    });
  });

  it('der volle Satz erzeugt keine doppelte Zelle; hinter jeder Fassadenzelle liegt eine Hüllzelle', () => {
    const s = shell(house(), FACADE_QUALITY_RULES, { plinthProfile: true, cornice: true, quoins: true, brackets: 3 });
    const seen = new Set<string>();
    for (const c of s.cells) {
      expect(seen.has(key(c.pos)), `Doppelte Zelle ${key(c.pos)}`).toBe(false);
      seen.add(key(c.pos));
    }
    const byKey = new Map(s.cells.map((c) => [key(c.pos), c] as const));
    // Außenprofil klebt an der Hülle: jede Fassadenzelle hat (auch diagonal, z. B. die Sockel-Ecke) eine Zelle
    // anderen Typs daneben; nichts schwebt in der Luft.
    for (const c of facadeOf(s)) {
      const near: ShellCell[] = [];
      for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
        if (dx === 0 && dz === 0) continue;
        const x = byKey.get(key([c.pos[0] + dx, c.pos[1], c.pos[2] + dz]));
        if (x !== undefined) near.push(x);
      }
      expect(near.some((x) => x.kind !== 'facade'), `neben ${key(c.pos)} liegt eine Hüllzelle`).toBe(true);
    }
  });
});
