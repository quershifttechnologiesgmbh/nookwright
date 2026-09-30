/**
 * W2 (26.09.2026, plan/baustandard.md) – Regeln der Außenhaut und des Fassadenrasters über die Hülle:
 *  - W1/I2 `skin`: Innenwand-Anschlüsse in der Außenwand sind außen Wandfeld, die Endzelle der Innenwand ist Pfosten.
 *  - F1–F3 `grid`: Fenster nur auf Feldachsen, fluchtend über die Geschosse, Tür auf einer Feldachse (Haustür bevorzugt
 *    im Mittelfeld), Felder mit Tür blind, keine Fenster direkt neben Türen.
 *  - W2/F4: Wandvorlagen nur auf Pfostenspalten, auf allen Geschossen gleich, ≥ 1 Spalte Abstand zu Öffnungen.
 *  - I4 `jambs`: Innentüren mit Pfosten links und rechts in den Türreihen.
 * Ohne die Regeln bleibt die Hülle zellgleich (shell-digest.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { CellSet, bays, key3, type HorizontalDir, type Vec3 } from '@mcda/core';
import { Project, TARGET_VERSIONS, deriveShell, type FacadeGridLine, type FacadeRules, type Shell, type ShellCell, type ShellOptions } from '../src/index.js';
import { exteriorModel } from '../src/shell/anchors.js';
import { STEP, axisOf } from '../src/shell/grid.js';

function project(seed = 2026): Project {
  return Project.create({ id: 'p', name: 'Haus', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
}

/** Zwei Geschosse mit Innenwänden an verschiedenen Stellen (wie das Beispielhaus der Pipeline, Süd 23 lang). */
function twoStory(seed = 2026): Project {
  const p = project(seed);
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

/** Eingeschossig mit Flur (T-Stöße an beiden Traufseiten). */
function oneStory(seed = 7): Project {
  const p = project(seed);
  p.paintRoom(0, CellSet.rect(0, 0, 6, 8), 'kitchen');
  p.paintRoom(0, CellSet.rect(7, 0, 10, 8), 'hallway');
  p.paintRoom(0, CellSet.rect(11, 0, 20, 8), 'tavern');
  return p;
}

const ALL: FacadeRules = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true };
const opts = (rules: FacadeRules, extra: Partial<ShellOptions> = {}): ShellOptions => ({ roof: 'gable', facade: { plinthProfile: true, cornice: true, rules }, ...extra });
const FIXTURES: ReadonlyArray<readonly [string, () => Project]> = [['zweistöckig', twoStory], ['Flurhaus', oneStory], ['zweistöckig s9', () => twoStory(9)]];

/** Wandzellen je Spalte einer Außenlinie (Etage, Seite, Wandebene) mit ihren Arten über die Wandreihen. */
function lineCols(s: Shell): Array<{ key: string; out: HorizontalDir; y0: number; plane: number; cols: Array<{ a: number; kinds: Set<string> }> }> {
  const m = exteriorModel(s);
  return m.levels.flatMap((l) => l.lines.map((line) => {
    const ns = axisOf(line.out) === 'z';
    return {
      key: `${l.index}|${line.out}`, out: line.out, y0: l.y0, plane: ns ? line.cols[0]![1] : line.cols[0]![0],
      cols: line.cols.map((c) => {
        const kinds = new Set<string>();
        for (let y = l.baseY; y <= l.topY; y++) kinds.add(m.at([c[0], y, c[1]])?.kind ?? '-');
        return { a: ns ? c[0] : c[1], kinds };
      }),
    };
  }));
}

describe('W1/I2 Außenhaut: Anschluss außen Wandfeld, innen Pfosten', () => {
  it('keine Pfeilerzelle mitten in einer Außenlinie; jede Innenwand-Endzelle am Anschluss ist Pfosten', () => {
    for (const [name, make] of FIXTURES) {
      const plain = deriveShell(make().state, opts({}));
      const skin = deriveShell(make().state, opts({ skin: true }));
      const m = exteriorModel(skin);
      let junctions = 0;
      for (const l of m.levels) {
        for (const line of l.lines) {
          line.cols.forEach((c, i) => {
            if (i === 0 || i === line.cols.length - 1) return;
            const inward = [c[0] - STEP[line.out][0], l.baseY, c[1] - STEP[line.out][1]] as Vec3;
            const wallish = ['wall', 'pillar', 'door', 'lintel'].includes(m.at(inward)?.kind ?? '');
            expect(m.at([c[0], l.baseY, c[1]])?.kind, `${name}: ${c} mitten in der Außenlinie`).not.toBe('pillar');
            if (!wallish) return;
            junctions++;
            // die Endzelle der Innenwand (innen sichtbar) trägt den Pfosten, außer es ist eine Tür
            expect(['pillar', 'door'], `${name}: Anschluss ${c} innen ohne Pfosten`).toContain(m.at(inward)?.kind);
          });
        }
      }
      expect(junctions, `${name}: Fixture hat Anschlüsse`).toBeGreaterThan(0);
      // ohne Regel: am Anschluss steht der Stamm in der Außenwand
      expect(plain.cells.filter((c) => c.kind === 'pillar' && c.exterior === true).length).toBeGreaterThan(skin.cells.filter((c) => c.kind === 'pillar' && c.exterior === true).length);
      // nur die Zellart ändert sich, nicht die Geometrie
      expect(new Set(skin.cells.map((c) => key3(c.pos)))).toEqual(new Set(plain.cells.map((c) => key3(c.pos))));
    }
  });
});

describe('F1–F3 Fassadenraster: ein Fenster je Feld, fluchtend, Tür auf der Feldachse', () => {
  it('Raster wird veröffentlicht; Fenster nur auf Feldachsen, je Feld höchstens eins (Doppelachse ganz)', () => {
    for (const [name, make] of FIXTURES) {
      const s = deriveShell(make().state, opts(ALL));
      expect(s.facadeGrid, name).toBeDefined();
      for (const g of s.facadeGrid!) {
        // symmetrisches Raster: Pfosten spiegelgleich zur Linienmitte (eigene oder übernommene Linie)
        expect(g.posts.every((p) => p > g.from && p < g.to), name).toBe(true);
        for (const b of g.bays) expect(b.axis.every((x) => x >= b.from && x <= b.to), name).toBe(true);
      }
      for (const line of lineCols(s)) {
        const g = s.facadeGrid!.find((x) => x.out === line.out && x.y0 === line.y0 && x.plane === line.plane);
        expect(g, `${name} ${line.key}: Raster fehlt`).toBeDefined();
        const axes = new Set(g!.bays.flatMap((b) => [...b.axis]));
        for (const c of line.cols) if (c.kinds.has('window')) expect(axes.has(c.a), `${name} ${line.key}: Fenster ${c.a} außerhalb der Feldachse`).toBe(true);
        for (const b of g!.bays) {
          const wins = line.cols.filter((c) => c.a >= b.from && c.a <= b.to && c.kinds.has('window')).map((c) => c.a);
          expect(wins.length === 0 || wins.length === b.axis.length, `${name} ${line.key}: Feld ${b.from}–${b.to}`).toBe(true);
          if (line.cols.some((c) => c.a >= b.from && c.a <= b.to && c.kinds.has('door'))) expect(wins, `${name}: Feld mit Tür bleibt blind`).toEqual([]);
        }
        // nie ein Fenster direkt neben einer Tür
        const at = new Map(line.cols.map((c) => [c.a, c.kinds] as const));
        for (const c of line.cols) if (c.kinds.has('door')) for (const n of [c.a - 1, c.a + 1]) expect(at.get(n)?.has('window') ?? false, name).toBe(false);
      }
    }
  });

  it('Obergeschoss gleicher Ausdehnung: dieselben Pfosten und Achsen, Fenster über Öffnungen', () => {
    const s = deriveShell(twoStory().state, opts(ALL));
    const byKey = (floor: number): Map<string, FacadeGridLine> =>
      new Map(s.facadeGrid!.filter((g) => g.floorIndex === floor).map((g) => [`${g.out}|${g.plane}|${g.from}|${g.to}`, g] as const));
    const g0 = byKey(0);
    const g1 = byKey(1);
    let same = 0;
    for (const [k, up] of g1) {
      const lo = g0.get(k);
      if (lo === undefined) continue;
      same++;
      expect(up.posts, k).toEqual(lo.posts);
      expect(up.bays.map((b) => b.axis), k).toEqual(lo.bays.map((b) => b.axis));
    }
    expect(same).toBeGreaterThan(0);
    // Flucht: jedes Fenster im OG liegt über einer Öffnung oder einem blinden Feld desselben Rasters – nie versetzt
    const lines = lineCols(s);
    for (const up of lines.filter((l) => l.key.startsWith('1|'))) {
      const lo = lines.find((l) => l.key === `0|${up.out}` && l.plane === up.plane);
      if (lo === undefined) continue;
      const g = s.facadeGrid!.find((x) => x.floorIndex === 0 && x.out === up.out && x.plane === up.plane)!;
      const axes = new Set(g.bays.flatMap((b) => [...b.axis]));
      for (const c of up.cols) if (c.kinds.has('window')) expect(axes.has(c.a), `${up.key}: ${c.a}`).toBe(true);
    }
  });

  it('Haustür auf einer Feldachse, bevorzugt im Mittelfeld ihrer Linie', () => {
    let middle = 0;
    let doors = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const s = deriveShell(oneStory(seed).state, opts(ALL));
      const main = [...s.rooms.values()].flatMap((r) => r.doors.filter((d) => d.isMain).map((d) => ({ d, r })))[0];
      expect(main, `Seed ${seed}: Haustür`).toBeDefined();
      const out = main!.d.toward;
      const cell = [main!.d.inside[0] + STEP[out][0], main!.d.inside[1] + STEP[out][1]] as const;
      const ns = axisOf(out) === 'z';
      const g = s.facadeGrid!.find((x) => x.out === out && x.floorIndex === 0 && x.plane === (ns ? cell[1] : cell[0]))!;
      const a = ns ? cell[0] : cell[1];
      doors++;
      expect(g.bays.some((b) => b.axis.includes(a)), `Seed ${seed}: Tür ${a} auf einer Feldachse`).toBe(true);
      if (g.bays.length % 2 === 1 && g.bays[(g.bays.length - 1) / 2]!.axis.includes(a)) middle++;
    }
    expect(middle / doors).toBeGreaterThanOrEqual(0.5);
  });

  it('deterministisch; ohne Raster-Regel kein Raster und die Fensterplanung je Wandlauf wie bisher', () => {
    const a = deriveShell(twoStory().state, opts(ALL));
    const b = deriveShell(twoStory().state, opts(ALL));
    expect(a).toEqual(b);
    const without = deriveShell(twoStory().state, opts({ windowFrame: true }));
    expect(without.facadeGrid).toBeUndefined();
    const legacy = deriveShell(twoStory().state, { roof: 'gable' });
    expect(without.cells.filter((c) => c.kind === 'window').map((c) => key3(c.pos)).sort())
      .toEqual(legacy.cells.filter((c) => c.kind === 'window').map((c) => key3(c.pos)).sort());
  });

  it('„Fenster aus“ gilt auch mit Raster', () => {
    const s = deriveShell(twoStory().state, opts(ALL, { windows: { enabled: false } }));
    expect(s.cells.filter((c) => c.kind === 'window')).toEqual([]);
  });

  it('eigenes Raster = bays(Länge, Feldbreite); Feldbreite aus der Regel', () => {
    for (const bay of [3, 4, 5]) {
      const s = deriveShell(oneStory().state, opts({ ...ALL, bay }));
      for (const g of s.facadeGrid!) {
        const b = bays(g.to - g.from + 1, bay);
        expect(g.posts, `Feld ${bay}`).toEqual(b.posts.slice(1, -1).map((p) => p + g.from));
      }
    }
  });
});

describe('W2/F4 Wandvorlagen nur auf Pfosten, fluchtend, mit Abstand zu Öffnungen', () => {
  it('jede Vorlage steht auf einer Pfostenspalte, nicht neben einer Öffnung, auf allen Geschossen derselben Linie gleich', () => {
    let total = 0;
    for (const [name, make] of FIXTURES) {
      for (const pilasters of [3, 4]) {
        const s = deriveShell(make().state, { ...opts(ALL), facade: { plinthProfile: true, cornice: true, pilasters, rules: ALL } });
        const m = exteriorModel(s);
        const perLine = new Map<string, string>();
        for (const l of m.levels) {
          for (const line of l.lines) {
            const ns = axisOf(line.out) === 'z';
            const plane = ns ? line.cols[0]![1] : line.cols[0]![0];
            const g = s.facadeGrid!.find((x) => x.out === line.out && x.y0 === l.y0 && x.plane === plane);
            const cols: number[] = [];
            line.cols.forEach((c, i) => {
              const f = m.at([c[0] + STEP[line.out][0], l.baseY + 1, c[1] + STEP[line.out][1]]);
              if (f?.kind !== 'facade' || f.role !== 'beam' || f.shape !== 'log') return;
              const a = ns ? c[0] : c[1];
              cols.push(a);
              total++;
              expect(g?.posts.includes(a), `${name}: Vorlage ${a} nicht auf einem Pfosten`).toBe(true);
              for (const j of [i - 1, i, i + 1]) {
                const n = line.cols[j];
                if (n === undefined) continue;
                for (let y = l.baseY; y <= l.topY; y++) expect(['window', 'door'], `${name}: Vorlage ${a} neben Öffnung`).not.toContain(m.at([n[0], y, n[1]])?.kind);
              }
            });
            const k = `${line.out}|${g?.posts.join(',')}`;
            if (perLine.has(k) && g !== undefined) expect(cols.join(','), `${name}: Vorlagen fluchten nicht (${k})`).toBe(perLine.get(k));
            else perLine.set(k, cols.join(','));
          }
        }
      }
    }
    expect(total, 'Fixtures haben Wandvorlagen').toBeGreaterThan(0);
  });
});

describe('I4 Türlaibung', () => {
  it('jede Innentür hat links und rechts einen Pfosten in beiden Türreihen (wo gerade Wand war)', () => {
    for (const [name, make] of FIXTURES) {
      const s = deriveShell(make().state, opts({ jambs: true }));
      const plain = deriveShell(make().state, opts({}));
      const at = new Map(s.cells.map((c) => [key3(c.pos), c] as const));
      const before = new Map(plain.cells.map((c) => [key3(c.pos), c] as const));
      let framed = 0;
      for (const c of s.cells) {
        if (c.kind !== 'door' || c.orient?.half !== 'lower' || c.exterior === true) continue;
        const along = axisOf(c.orient.facing!) === 'z' ? [1, 0] : [0, 1];
        for (const k of [-1, 1]) {
          for (const dy of [0, 1]) {
            const p: Vec3 = [c.pos[0] + along[0]! * k, c.pos[1] + dy, c.pos[2] + along[1]! * k];
            const was: ShellCell | undefined = before.get(key3(p));
            if (was?.kind !== 'wall' || was.exterior === true) continue;
            expect(at.get(key3(p))?.kind, `${name}: Laibung ${p}`).toBe('pillar');
            framed++;
          }
        }
      }
      expect(framed, name).toBeGreaterThan(0);
    }
  });
});

describe('W6 (27.09.2026): geerbtes Raster über einem abgeschnittenen Feld', () => {
  it('ein Feld ohne Achse (Rücksprung über einem Anbau) macht die Linie darüber nicht blind', () => {
    // Taverne L: Stallflügel bündig an der Ostseite nur im Erdgeschoss – das 1. OG erbt die Ostlinie teilweise
    // (`overlapped`, kurzes Feld am Rücksprung ohne Achse), das 2. OG erbt das 1. OG ganz (`inherited`)
    const p = project(3);
    p.paintRoom(0, CellSet.rect(0, 7, 25, 23), 'tavern');
    p.paintRoom(0, CellSet.rect(18, 0, 25, 6), 'stable');
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 7, 25, 23), 'gallery');
    p.addFloor();
    p.paintRoom(2, CellSet.rect(0, 7, 25, 23), 'gallery');
    const s = deriveShell(p.state, opts({ ...ALL, bay: 3 }));
    const east = (f: number): FacadeGridLine => s.facadeGrid!.find((g) => g.floorIndex === f && g.out === 'east')!;
    const one = east(1);
    const two = east(2);
    expect(one.bays.some((b) => b.axis.length === 0), 'kurzes Feld am Rücksprung ohne Achse').toBe(true);
    expect(two.posts).toEqual(one.posts);
    expect(two.bays.map((b) => b.axis)).toEqual(one.bays.map((b) => b.axis));
    expect(two.bays.filter((b) => b.axis.length > 0).length).toBeGreaterThan(1);
  });
});
