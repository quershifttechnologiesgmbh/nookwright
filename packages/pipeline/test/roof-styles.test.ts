/**
 * Integrationstest Dach-Paket (RF, research/18 §4): jede geneigte Dachform × Neigung am Beispielhaus, an einem
 * L-Grundriss und am zweistöckigen Haus, ohne und mit allen Details (Kante, geschlossener Ortgang, Glockenfuß,
 * Giebelfenster) – materialisiert (ohne Einrichtung, das Dach berührt sie nicht):
 *  - keine Zellkollisionen, jede (Rolle, Form) im Hüllen-Vertrag,
 *  - keine Verstöße außer Spawn (Physik, Masken, `stair_shape`: jede Dachtreppe hat die Form der Vanilla-Regel),
 *  - nichts schwebt (alle Hüllen-Blöcke hängen über Flächen- oder Kantennachbarn am Boden – so hängen auch die
 *    Ringe eines 45°-Walmdachs aneinander),
 *  - dicht: Luft über den Decken (Dachboden, Räume) ist von außen nicht erreichbar (keine Lücken im Dach),
 *  - deterministisch.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deriveShell, Project, TARGET_VERSIONS, type RoofDetail, type RoofPitch, type RoofStyle, type Shell } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { SHELL_ROLE_SHAPES } from '@mcda/materialize';
import { buildWorld } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { sampleHouse, twoStoryHouse } from './helpers.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const STYLES: readonly RoofStyle[] = ['hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'];
const PITCHES: readonly RoofPitch[] = ['low', 'normal', 'steep'];

function lHouse(version: '1.21.11' | '26.3', themeId: string): Project {
  const p = Project.create({ id: 'l', name: 'L-Haus', seed: 7, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 12, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(0, 7, 6, 15), 'bedroom');
  return p;
}

const LAYOUTS: ReadonlyArray<readonly [string, (v: '1.21.11' | '26.3', t: string) => Project]> = [
  ['Beispielhaus', (v, t) => sampleHouse(v, t)],
  ['L-Grundriss', lHouse],
  ['zweistöckig', (v, t) => twoStoryHouse(v, t)],
];

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
/** Flächen- und Kantennachbarn (18er-Nachbarschaft). */
const N18: ReadonlyArray<readonly [number, number, number]> = [-1, 0, 1].flatMap((dx) =>
  [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dz) => [dx, dy, dz] as const))).filter(([dx, dy, dz]) => {
  const n = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
  return n === 1 || n === 2;
});

/** Alle Hüllen-Zellen hängen (18er-Nachbarschaft über Hüllen-Zellen) an der untersten Bodenplatte. */
function floating(shell: Shell): string[] {
  const at = new Set(shell.cells.map((c) => key(...c.pos)));
  const y0 = Math.min(...shell.cells.map((c) => c.pos[1]));
  const seen = new Set<string>();
  const queue = shell.cells.filter((c) => c.pos[1] === y0).map((c) => c.pos);
  for (const p of queue) seen.add(key(...p));
  for (let q = 0; q < queue.length; q++) {
    const [x, y, z] = queue[q]!;
    for (const [dx, dy, dz] of N18) {
      const k = key(x + dx, y + dy, z + dz);
      if (at.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push([x + dx, y + dy, z + dz]);
      }
    }
  }
  return shell.cells.filter((c) => !seen.has(key(...c.pos))).map((c) => `${c.kind}/${c.role}@${c.pos.join(',')}`);
}

/** Luftzellen direkt über einer Decke, die von außen (Rand der Bounding Box) erreichbar sind. */
function leaks(shell: Shell): string[] {
  const at = new Set(shell.cells.map((c) => key(...c.pos)));
  const lo = [0, 1, 2].map((k) => Math.min(...shell.cells.map((c) => c.pos[k]!)) - 1);
  const hi = [0, 1, 2].map((k) => Math.max(...shell.cells.map((c) => c.pos[k]!)) + 1);
  const inBox = (x: number, y: number, z: number): boolean => x >= lo[0]! && y >= lo[1]! && z >= lo[2]! && x <= hi[0]! && y <= hi[1]! && z <= hi[2]!;
  const out = new Set<string>([key(lo[0]!, lo[1]!, lo[2]!)]);
  const queue: Array<readonly [number, number, number]> = [[lo[0]!, lo[1]!, lo[2]!]];
  for (let q = 0; q < queue.length; q++) {
    const [x, y, z] = queue[q]!;
    for (const [dx, dy, dz] of N6) {
      const n = [x + dx, y + dy, z + dz] as const;
      const k = key(...n);
      if (inBox(...n) && !at.has(k) && !out.has(k)) {
        out.add(k);
        queue.push(n);
      }
    }
  }
  return shell.cells.filter((c) => c.kind === 'ceiling' && out.has(key(c.pos[0], c.pos[1] + 1, c.pos[2]))).map((c) => c.pos.join(','));
}

function check(name: string, project: Project, roof: RoofStyle, detail: RoofDetail): void {
  const shell = deriveShell(project.state, { roof, overhang: 1, roofDetail: detail });
  const where = `${name} · ${roof} · ${JSON.stringify(detail)}`;
  const keys = shell.cells.map((c) => key(...c.pos));
  expect(new Set(keys).size, `${where}: Zellkollision`).toBe(keys.length);
  const outside = shell.cells.filter((c) => !(SHELL_ROLE_SHAPES[c.role] ?? []).includes(c.shape)).map((c) => `${c.role}.${c.shape}`);
  expect(outside, where).toEqual([]);
  const roofStairs = shell.cells.filter((c) => c.kind === 'roof' && c.shape === 'stairs' && c.orient?.half === 'bottom');
  expect(roofStairs.every((c) => c.orient?.stairShape !== undefined), where).toBe(true);
  expect(floating(shell), `${where}: schwebt`).toEqual([]);
  expect(leaks(shell), `${where}: Lücke im Dach`).toEqual([]);
  const world = buildWorld(project, ctx, shell);
  const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
  expect(hard, `${where}: ${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
  // Soll-Form = gebaute Form (die Materialisierung meldet Abweichungen als stair_shape; hier zusätzlich direkt)
  for (const c of roofStairs) expect(world.materialized.volume.stateAt(c.pos).properties['shape'], `${where} ${c.pos}`).toBe(c.orient!.stairShape);
  // deterministisch
  expect(JSON.stringify(deriveShell(project.state, { roof, overhang: 1, roofDetail: detail }).cells)).toBe(JSON.stringify(shell.cells));
}

describe('Dach-Paket: jede Form × Neigung baut sich physikalisch sauber (Materialisierung)', () => {
  for (const [name, make] of LAYOUTS) {
    for (const roof of STYLES) {
      it(`${name} · ${roof}: low/normal/steep, ohne und mit Details`, () => {
        const project = make('1.21.11', 'medieval');
        for (const pitch of PITCHES) {
          check(name, project, roof, { pitch });
          check(name, project, roof, { pitch, trim: true, verge: 'closed', flare: pitch !== 'low', gableWindows: true });
        }
      });
    }
  }

  it('Kontrolle: die Prüfungen sind trennscharf (fehlende Dachzelle = Lücke, fehlender Füllblock = Lücke, loser Block schwebt)', () => {
    const project = sampleHouse('1.21.11', 'medieval');
    // W4 (27.09.2026): ohne Kniestock – die Probe entfernt eine Treppe über y = 6 (mit Kniestock läge der Schnitt anders)
    const shell = deriveShell(project.state, { roof: 'gable', overhang: 1, roofDetail: { pitch: 'steep', kneeWall: false } });
    expect(leaks(shell)).toEqual([]);
    const roofs = shell.cells.filter((c) => c.kind === 'roof');
    const mid = roofs.find((c) => c.pos[0] === 10 && c.shape === 'stairs' && c.pos[1] > 6)!;
    expect(leaks({ ...shell, cells: shell.cells.filter((c) => c !== mid) }).length).toBeGreaterThan(0);
    const fill = roofs.filter((c) => c.shape === 'block' && c.pos[0] === 10);
    expect(fill.length).toBeGreaterThan(0);
    expect(leaks({ ...shell, cells: shell.cells.filter((c) => !fill.includes(c)) }).length).toBeGreaterThan(0);
    expect(floating({ ...shell, cells: [...shell.cells, { pos: [5, 30, 5], kind: 'roof', role: 'roof_main', shape: 'block', exterior: true }] })).toEqual(['roof/roof_main@5,30,5']);
  });

  it('26.3 und andere Themes: Kanten (roof_trim), Okulus (window_frame) und Stufen lösen auf', () => {
    for (const theme of ctx.themes.ids()) {
      for (const roof of ['gable', 'mansard', 'saltbox'] as const) {
        check('Beispielhaus 26.3', sampleHouse('26.3', theme), roof, { pitch: 'steep', trim: true, verge: 'closed' });
        check('L 26.3', lHouse('26.3', theme), roof, { pitch: 'low', trim: true, verge: 'closed', flare: true });
      }
    }
  });

  it('Satteldach-Überstand 2/3 und zwei Etagen: keine stair_shape-Warnungen mehr (App-Befund I1), Lücken geschlossen', () => {
    const app = Project.create({ id: 'a', name: 'App', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
    app.addFloor();
    app.paintRoom(0, CellSet.rect(0, 0, 11, 7), 'tavern');
    app.paintRoom(0, CellSet.rect(12, 0, 18, 7), 'kitchen');
    app.paintRoom(0, CellSet.rect(0, 8, 18, 12), 'storage');
    app.paintRoom(1, CellSet.rect(0, 0, 8, 7), 'bedroom');
    app.paintRoom(1, CellSet.rect(9, 0, 18, 7), 'library');
    app.paintRoom(1, CellSet.rect(0, 8, 10, 12), 'alchemy');
    app.placeStairs(0, [3, 10], 'east');
    for (const roof of ['hip', 'gable'] as const) {
      for (const overhang of [0, 1, 2, 3]) {
        const shell = deriveShell(app.state, { roof, overhang });
        const world = buildWorld(app, ctx, shell);
        const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
        expect(hard, `${roof} Überstand ${overhang}: ${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
        expect(leaks(shell), `${roof} Überstand ${overhang}`).toEqual([]);
      }
    }
  });
});
