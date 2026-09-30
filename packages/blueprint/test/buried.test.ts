/**
 * Lage `buried` (BT16, buried.ts): Dach `earth` (flach), Außentüren und Fenster nur in der Frontebene, keine Anker und kein
 * Außenprofil in der Hügel-Zone, Rundtür und Rundfenster spiegelsymmetrisch vor der Front, `Shell.settings` für das
 * Gelände; `ground` bleibt zellgleich.
 */
import { describe, expect, it } from 'vitest';
import { cellKey, type HorizontalDir } from '@mcda/core';
import { deriveShell, type Project, type Shell, type ShellOptions } from '../src/index.js';
import { renderSection } from './support/section.js';
import { LAYOUTS, lHouse, rect, sampleHouse } from './support/houses.js';

const STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const FRONTS: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];
const OPTS: ShellOptions = { roof: 'gable', facade: { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 } };
const fwd = (d: HorizontalDir, x: number, z: number): number => x * STEP[d][0] + z * STEP[d][1];

function buried(make: () => Project, front: HorizontalDir, cover?: number): { p: Project; shell: Shell } {
  const p = make();
  p.changeVolume('v0', { setting: { kind: 'buried', front, ...(cover !== undefined ? { cover } : {}) } });
  return { p, shell: deriveShell(p.state, OPTS) };
}

const digest = (s: Shell): string => JSON.stringify({ cells: s.cells, anchors: s.anchors, warnings: s.warnings, rooms: [...s.rooms.values()].map((r) => ({ ...r, interior: [...r.interior] })) });

describe('Lage buried: Hülle', () => {
  it('ground und ohne Lage: zellgleich (alle Test-Grundrisse)', () => {
    for (const [, make] of LAYOUTS) {
      const plain = make();
      const ground = make();
      ground.changeVolume('v0', { setting: { kind: 'ground' } });
      expect(digest(deriveShell(ground.state, OPTS))).toBe(digest(deriveShell(plain.state, OPTS)));
      expect(deriveShell(ground.state, OPTS).settings).toBeUndefined();
    }
  });

  for (const [name, make] of [['Rechteck 11×9', () => rect(11, 9)], ['Beispielhaus', sampleHouse], ['L-Grundriss', lHouse]] as const) {
    for (const front of FRONTS) {
      it(`${name}, Front ${front}: Öffnungen nur vorn, flaches Dach, Hügel-Zone frei von Ankern und Profil`, () => {
        const { p, shell } = buried(make, front);
        const foot = new Set(p.state.rooms.flatMap((r) => r.cells.toArray().map(([x, z]) => cellKey(x, z))));
        const plane = Math.max(...p.state.rooms.flatMap((r) => r.cells.toArray().map(([x, z]) => fwd(front, x, z))));
        expect(shell.warnings).toEqual([]);
        expect(shell.settings).toEqual([expect.objectContaining({ volumeId: 'v0', kind: 'buried', front, cover: 2 })]);
        expect(shell.cells.filter((c) => c.kind === 'roof')).toEqual([]);
        const doors = shell.cells.filter((c) => c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower');
        expect(doors.length).toBeGreaterThan(0);
        for (const d of doors) expect([d.orient!.facing, fwd(front, d.pos[0], d.pos[2])]).toEqual([front, plane]);
        for (const w of shell.cells.filter((c) => c.kind === 'window')) {
          expect(fwd(front, w.pos[0], w.pos[2])).toBe(plane);
          expect(foot.has(cellKey(w.pos[0] + STEP[front][0], w.pos[2] + STEP[front][1]))).toBe(false);
        }
        // Hinter der Frontebene außerhalb des Grundrisses liegt Erde: weder Anker noch Außenprofil
        const inMound = (x: number, z: number): boolean => !foot.has(cellKey(x, z)) && fwd(front, x, z) <= plane;
        expect((shell.anchors ?? []).filter((a) => inMound(a.pos[0], a.pos[2])).map((a) => a.kind)).toEqual([]);
        expect(shell.cells.filter((c) => c.kind === 'facade' && inMound(c.pos[0], c.pos[2])).map((c) => c.pos.join(','))).toEqual([]);
      });
    }
  }

  it('Rundtür und Rundfenster: vor der Front, spiegelsymmetrisch um Tür bzw. Fenster, Scheiben und Türweg frei', () => {
    for (const front of FRONTS) {
      const { shell } = buried(sampleHouse, front);
      const facade = shell.cells.filter((c) => c.kind === 'facade');
      const at = new Map(facade.map((c) => [c.pos.join(','), c] as const));
      const A: HorizontalDir = front === 'north' || front === 'south' ? 'east' : 'south';
      const OPP: Readonly<Record<HorizontalDir, HorizontalDir>> = { north: 'south', south: 'north', east: 'west', west: 'east' };
      const mirror = (d: HorizontalDir | undefined): HorizontalDir | undefined => (d === A || d === OPP[A] ? OPP[d] : d);
      const door = shell.cells.find((c) => c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower')!;
      const o = [door.pos[0] + STEP[front][0], door.pos[1], door.pos[2] + STEP[front][1]] as const;
      const paneCols = new Set(shell.cells.filter((c) => c.kind === 'window').map((c) => `${c.pos[0]},${c.pos[2]}`));
      const isWindowFrame = (c: { pos: readonly [number, number, number] }): boolean => [-1, 0, 1].some((k) =>
        paneCols.has(`${c.pos[0] - STEP[front][0] + k * STEP[A][0]},${c.pos[2] - STEP[front][1] + k * STEP[A][1]}`));
      // W9-G4 (2026-09-27): große Rundtür r = 3 (7 breit) – Ring über |u| ≤ 3, mindestens Pfosten, Bogen und Scheitel.
      // W12-B (2026-09-28): lückenloser Ring; Pfeiler vor der Front liegen außerhalb |u| ≤ 3
      const ring = facade.filter((c) => Math.abs(fwd(A, c.pos[0], c.pos[2]) - fwd(A, o[0], o[2])) <= 3 && c.pos[1] <= o[1] + 4 && fwd(front, c.pos[0], c.pos[2]) === fwd(front, o[0], o[2])
        && c.role === 'portal_stone' && !isWindowFrame(c));
      expect(ring.length).toBeGreaterThanOrEqual(11);
      for (const c of ring) {
        const u = fwd(A, c.pos[0], c.pos[2]) - fwd(A, o[0], o[2]);
        const m = at.get([c.pos[0] - 2 * u * STEP[A][0], c.pos[1], c.pos[2] - 2 * u * STEP[A][1]].join(','));
        expect([m?.shape, m?.orient?.half, m?.orient?.facing]).toEqual([c.shape, c.orient?.half, mirror(c.orient?.facing)]);
      }
      // Türweg frei (2 hoch), vor jeder Scheibe Luft
      expect([at.has(o.join(',')), at.has([o[0], o[1] + 1, o[2]].join(','))]).toEqual([false, false]);
      for (const w of shell.cells.filter((c) => c.kind === 'window')) expect(at.has([w.pos[0] + STEP[front][0], w.pos[1], w.pos[2] + STEP[front][1]].join(','))).toBe(false);
      const panes = shell.cells.filter((c) => c.kind === 'window').length;
      // W12-B (2026-09-28): Rundfenster – Wangen aus vollen Blöcken (`roof_trim`; die flache Falltür ließ eine Luftzelle
      // zwischen Ecke und Scheibe), Bank/Sturz in `roof_trim`
      expect(facade.filter((c) => c.role === 'shutter').length).toBe(0);
      // W13-C (2026-09-28): Holzblöcke auch im Rahmen des Stirnbogens – gezählt werden nur die Fensterrahmen
      expect(facade.filter((c) => c.role === 'roof_trim' && c.shape === 'block' && isWindowFrame(c) && c.pos[1] <= o[1] + 3).length > 0).toBe(panes > 0);
    }
  });

  /**
   * W12-B (28.09.2026, plan/spikes/W12B_erdhausfront.md, Review R6-2): der Rundbogen ist lückenlos – genau das Muster
   * aus buried.ts (Pfosten, Kämpfertreppen, Scheitelstufe, Bogenrücken), alle Ringzellen 4er-zusammenhängend; davor
   * die Laibung als zweite Ebene. Bei jeder Front mit r = 3.
   */
  it('W12-B: Rundbogen lückenlos, 4er-zusammenhängend, Laibung als zweite Ebene', () => {
    const want = [
      '.▄███▄.',
      '██◤▀◥██',
      '█◤...◥█',
      '█.....█',
      '█.....█',
    ];
    for (const [name, make] of [['Rechteck 11×9', () => rect(11, 9)], ['Beispielhaus', sampleHouse]] as const) {
      for (const front of FRONTS) {
        const { shell } = buried(make, front);
        const A: HorizontalDir = front === 'north' || front === 'south' ? 'east' : 'south';
        const at = new Map(shell.cells.filter((c) => c.kind === 'facade').map((c) => [c.pos.join(','), c] as const));
        const door = shell.cells.find((c) => c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower')!;
        const P = (u: number, dy: number, k = 1): string =>
          [door.pos[0] + k * STEP[front][0] + u * STEP[A][0], door.pos[1] + dy, door.pos[2] + k * STEP[front][1] + u * STEP[A][1]].join(',');
        const glyph = (u: number, dy: number): string => {
          const c = at.get(P(u, dy));
          if (c === undefined || c.role !== 'portal_stone') return '.';
          if (c.shape === 'block') return '█';
          if (c.shape === 'slab') return c.orient?.half === 'top' ? '▀' : '▄';
          // umgedrehte Treppe, nach außen gerichtet (ihr offenes Viertel rundet die Öffnung)
          return c.orient?.half === 'top' && (c.orient.facing === A) === (u > 0) ? (u < 0 ? '◤' : '◥') : '?';
        };
        const got = [4, 3, 2, 1, 0].map((dy) => [-3, -2, -1, 0, 1, 2, 3].map((u) => glyph(u, dy)).join(''));
        expect(got, `${name} ${front}`).toEqual(want);
        // 4er-Zusammenhang der Ringzellen (quer und senkrecht)
        const ring = new Set<string>();
        for (let dy = 0; dy <= 4; dy++) for (let u = -3; u <= 3; u++) if (glyph(u, dy) !== '.') ring.add(`${u},${dy}`);
        const seen = new Set<string>([[...ring][0]!]);
        const queue = [...seen];
        while (queue.length > 0) {
          const [u, dy] = queue.pop()!.split(',').map(Number) as [number, number];
          for (const n of [`${u + 1},${dy}`, `${u - 1},${dy}`, `${u},${dy + 1}`, `${u},${dy - 1}`]) {
            if (ring.has(n) && !seen.has(n)) {
              seen.add(n);
              queue.push(n);
            }
          }
        }
        expect(seen.size, `${name} ${front}`).toBe(ring.size);
        // Laibung: vor den Ringpfosten 2 Blöcke und eine Treppe zur Wand (zweite Ebene vor dem Ring)
        for (const u of [-3, 3]) {
          expect([0, 1, 2].map((dy) => at.get(P(u, dy, 2))?.shape), `${name} ${front} u ${u}`).toEqual(['block', 'block', 'stairs']);
          expect(at.get(P(u, 2, 2))?.orient?.facing).toBe(({ north: 'south', south: 'north', east: 'west', west: 'east' } as const)[front]);
        }
      }
    }
  });

  // W9-G4 (2026-09-27): Schnappschuss neu – große Rundtür (7 breit, Kreis mit Scheitel aus drei Stufen), Rundfenster mit
  // Falltür-Wangen statt Stammwangen, Traufleiste aus oberen Stufen über der Front (plan/spikes/W9G4_erdhaus.md)
  // W12-B (2026-09-28): Schnappschuss neu – Tür in der Frontmitte, lückenloser Bogen (Bogenrücken über dem Scheitel),
  // Steinpfeiler an den Ecken und zwischen Rahmen und Ring, Holzwangen der Rundfenster (plan/spikes/W12B_erdhausfront.md)
  // W13-C (2026-09-28): Schnappschuss neu – Rahmen des Stirnbogens über der Traufe (plan/spikes/W13C_erdhaus_huegel.md)
  // W13-C Runde 2 (2026-09-28): Schnappschuss neu – Bogen höchstens 2 Reihen, Rahmen als zweilagiges Band, Doppelfenster
  // W16-C (2026-09-28): Schnappschuss neu – Bogenfront: Band als Halbellipse über die ganze Front (mit Stirnholz-Scheiben)
  // statt Rahmen und Traufleiste, Stirn aus liegenden Stämmen bis unter das Band (plan/spikes/W16C_erdhaus.md)
  it('Schnitt: Front mit Rundtür (Beispielhaus, Front Süden)', () => {
    const { shell } = buried(sampleHouse, 'south');
    const door = shell.cells.find((c) => c.kind === 'door' && c.exterior === true)!;
    expect(`\n${renderSection(shell, { z: door.pos[2] + 1 })}`).toMatchInlineSnapshot(`
      "
      .......t#tt#tt#t.......
      ....t#tv‾‾‾‾‾‾‾vt#t....
      .t#tv‾‾.........‾‾vt#t.
      tv‾‾....._###_.....‾‾vt
      v.......##v‾v##..v‾‾‾vv
      #...v...#v...v#.vt...t#
      #...#...#.....#.#t...t#
      #...#...#.....#.#\\___/#
      ===========.==========="
    `);
  });
});
