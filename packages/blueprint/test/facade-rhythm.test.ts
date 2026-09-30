/**
 * WS-Fassade (Bauprozess Schritt 4, 29.09.2026) – `ShellOptions.facadeRhythm`:
 *  - ohne die Option (oder mit beiden Teilen aus) bleibt die Hülle zellgleich,
 *  - mit `windows` kommen nur Fenster hinzu (nie weniger), auf Feldachsen, spiegelsymmetrisch je Wandlinie,
 *    mit Abstand zu den Ecken und zu Türen, und jedes Fenster hat innen Boden,
 *  - mit `dormers` bekommen leere Dachflächen Gauben.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, type HorizontalDir } from '@mcda/core';
import { Project, TARGET_VERSIONS, deriveShell, type FacadeRules, type Shell, type ShellOptions } from '../src/index.js';
import { MIN_GAP, RHYTHM_DORMERS } from '../src/shell/facade-rhythm.js';
import { rect, sampleHouse } from './support/houses.js';

function project(seed = 2026): Project {
  return Project.create({ id: 'p', name: 'Haus', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
}

/** Langes Haus: zwei Reihen Räume, damit die Südwand und die Nordwand lange flache Strecken haben. */
function longHouse(): Project {
  const p = project();
  p.paintRoom(0, CellSet.rect(0, 0, 10, 8), 'kitchen');
  p.paintRoom(0, CellSet.rect(11, 0, 26, 8), 'tavern');
  p.paintRoom(0, CellSet.rect(27, 0, 36, 8), 'bedroom');
  return p;
}

function twoStory(): Project {
  const p = project(9);
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 8, 6), 'bedroom');
  p.paintRoom(1, CellSet.rect(9, 0, 16, 6), 'alchemy');
  p.paintRoom(1, CellSet.rect(0, 7, 16, 11), 'library');
  p.paintRoom(1, CellSet.rect(17, 0, 22, 11), 'bedroom');
  p.placeStairs(0, [3, 10], 'east');
  return p;
}

const RULES: FacadeRules = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true };
const base = (extra: Partial<ShellOptions> = {}): ShellOptions => ({
  roof: 'gable', facade: { plinthProfile: true, cornice: true, rules: RULES }, windows: { enabled: true, spacing: 4 }, ...extra,
});

function digest(s: Shell): string {
  const rooms = [...s.rooms.values()].map((r) => ({ ...r, interior: [...r.interior], blocked: [...(r.blocked ?? [])] }));
  const text = JSON.stringify({ cells: s.cells, anchors: s.anchors, warnings: s.warnings, rooms });
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) h = Math.imul(h ^ text.charCodeAt(k), 0x01000193) >>> 0;
  return `${text.length}:${h.toString(16)}`;
}

interface Win { readonly floor: number; readonly out: HorizontalDir; readonly along: number }
const windowsOf = (s: Shell): Win[] => [...s.rooms.values()].flatMap((r) => r.windows.map((w) => ({
  floor: r.floorIndex, out: w.toward, along: w.toward === 'north' || w.toward === 'south' ? w.inside[0] : w.inside[1],
})));
const keyOf = (w: Win): string => `${w.floor}|${w.out}|${w.along}`;

describe('facadeRhythm: aus = zellgleich', () => {
  for (const [name, make] of [['Rechteck 23 × 12', () => rect(23, 12)], ['Beispielhaus', sampleHouse], ['zweistöckig', twoStory]] as const) {
    it(`${name}: ohne Option, mit leerem Stil und mit beiden Teilen aus dieselbe Hülle`, () => {
      const p = make();
      const ref = digest(deriveShell(p.state, base()));
      expect(digest(deriveShell(p.state, base({ facadeRhythm: {} })))).toBe(ref);
      expect(digest(deriveShell(p.state, base({ facadeRhythm: { windows: false, dormers: false } })))).toBe(ref);
    });
  }
});

describe('facadeRhythm: Fensterachsen', () => {
  for (const [name, make] of [['Rechteck 23 × 12', () => rect(23, 12)], ['Beispielhaus', sampleHouse], ['zweistöckig', twoStory]] as const) {
    const p = make();
    const off = deriveShell(p.state, base());
    const on = deriveShell(p.state, base({ facadeRhythm: { windows: true } }));
    const before = new Set(windowsOf(off).map(keyOf));
    const added = windowsOf(on).filter((w) => !before.has(keyOf(w)));

    it(`${name}: nie weniger Fenster, bestehende bleiben, mindestens eines kommt hinzu`, () => {
      const after = new Set(windowsOf(on).map(keyOf));
      for (const k of before) expect(after.has(k), `Fenster ${k} blieb erhalten`).toBe(true);
      expect(added.length).toBeGreaterThan(0);
    });

    it(`${name}: die neuen Fenster sind je Wandlinie spiegelsymmetrisch und halten Abstand zu den Ecken`, () => {
      const lines = on.facadeGrid ?? [];
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const mine = added.filter((w) => w.floor === line.floorIndex && w.out === line.out && w.along >= line.from && w.along <= line.to);
        const set = new Set(mine.map((w) => w.along));
        for (const w of mine) {
          expect(set.has(line.from + line.to - w.along), `${line.floorIndex}|${line.out}: Spiegelbild von ${w.along}`).toBe(true);
          expect(w.along - line.from, 'Abstand zur Ecke').toBeGreaterThanOrEqual(2);
          expect(line.to - w.along, 'Abstand zur Ecke').toBeGreaterThanOrEqual(2);
          expect(line.posts.includes(w.along), 'nicht auf einem Pfosten').toBe(false);
        }
      }
    });

    it(`${name}: neue Fenster haben höchstens MIN_GAP-Lücken zu Nachbarn übrig (Mindestdichte)`, () => {
      const all = windowsOf(on);
      for (const line of on.facadeGrid ?? []) {
        const along = all.filter((w) => w.floor === line.floorIndex && w.out === line.out && w.along >= line.from && w.along <= line.to)
          .map((w) => w.along).sort((a, b) => a - b);
        if (along.length === 0) continue;
        // die Lücken zwischen zwei Fenstern und zu den Eckzonen überschreiten nie 2 × MIN_GAP + 1 freie Zellen
        const marks = [line.from + 1, ...along, line.to - 1];
        for (let i = 1; i < marks.length; i++) {
          const gap = marks[i]! - marks[i - 1]! - 1;
          expect(gap, `${line.floorIndex}|${line.out}: Lücke ${marks[i - 1]}–${marks[i]}`).toBeLessThan(4 * MIN_GAP + 6);
        }
      }
    });

    it(`${name}: jedes Fenster hat innen Boden`, () => {
      for (const r of on.rooms.values()) for (const w of r.windows) expect(r.interior.has(w.inside[0], w.inside[1]), `Fenster ${w.inside}`).toBe(true);
    });
  }

  it('deterministisch: zweimal dieselbe Hülle', () => {
    const p = longHouse();
    expect(digest(deriveShell(p.state, base({ facadeRhythm: { windows: true, dormers: true } }))))
      .toBe(digest(deriveShell(p.state, base({ facadeRhythm: { windows: true, dormers: true } }))));
  });
});

describe('facadeRhythm: Gauben', () => {
  it('leere Dachflächen bekommen Gauben, die Standardgaube ist eine Giebelgaube', () => {
    expect(RHYTHM_DORMERS.kind).toBe('gable');
    const p = rect(23, 12);
    const cells = (o: ShellOptions): number => deriveShell(p.state, { ...o, roofDetail: { split: false, kneeWall: false } }).cells.length;
    expect(cells(base({ facadeRhythm: { dormers: true } }))).toBeGreaterThan(cells(base()));
  });
  it('eine ausdrücklich gesetzte Gaube hat Vorrang vor dem Rhythmus', () => {
    const p = rect(23, 12);
    const own = base({ dormers: { kind: 'shed', width: 3 } });
    expect(digest(deriveShell(p.state, { ...own, facadeRhythm: { dormers: true } }))).toBe(digest(deriveShell(p.state, own)));
  });
});
