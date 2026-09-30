/**
 * Integrationstest Gauben (B2, research/18 D4): Beispielhaus, zweistöckiges Haus, L-Grundriss und ein großes Rechteck
 * × alle 9 Dachformen × 3 Neigungen × Gaubenarten/-breiten, materialisiert (1.21.11; Themes × 26.3 stichprobenweise):
 *  - keine Zellkollision, jede (Rolle, Form) im Hüllen-Vertrag,
 *  - keine Verstöße außer Spawn (Physik, Masken, `stair_shape`); jede Dachtreppe hat die gebaute Vanilla-Form,
 *  - nichts schwebt, Luft über den Decken ist von außen nicht erreichbar (dicht), deterministisch,
 *  - mit Außengestaltung (`exterior`): keine Außen-Komponente auf einer Hüllenzelle, vor Gaubenscheiben nur Luft,
 *    keine neuen Verstöße gegenüber derselben Welt ohne Außen-Komponenten.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  deriveShell, Project, TARGET_VERSIONS, type DormerStyle, type RoofPitch, type RoofStyle, type Shell, type ShellOptions,
} from '@mcda/blueprint';
import { CellSet, key3, type Vec3 } from '@mcda/core';
import { SHELL_ROLE_SHAPES } from '@mcda/materialize';
import { isAir } from '@mcda/voxel';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { buildWorld, generate, generateWith, type World } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { sampleHouse, twoStoryHouse } from './helpers.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
type Version = keyof typeof TARGET_VERSIONS;
const ROOFS: readonly RoofStyle[] = ['flat', 'hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'];
const PITCHES: readonly RoofPitch[] = ['low', 'normal', 'steep'];
/** Je (Dachform, Neigung) zwei Gauben-Stile: Standard und einer aus der Rotation (Art × Breite). */
const ROTATION: readonly DormerStyle[] = [
  { kind: 'shed', width: 3 }, { kind: 'hip', width: 5 }, { kind: 'blind', width: 1 }, { kind: 'gable', width: 5 }, { kind: 'shed', width: 1 }, { kind: 'hip', width: 3 },
];

function lHouse(version: Version, themeId: string): Project {
  const p = Project.create({ id: 'l', name: 'L-Haus', seed: 7, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 16, 8), 'tavern');
  p.paintRoom(0, CellSet.rect(0, 9, 8, 20), 'bedroom');
  return p;
}
function hall(version: Version, themeId: string): Project {
  const p = Project.create({ id: 'h', name: 'Halle', seed: 11, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 10, 15), 'tavern');
  p.paintRoom(0, CellSet.rect(11, 0, 22, 15), 'storage');
  return p;
}
const HOUSES: Record<string, (v: Version, t: string) => Project> = { Beispielhaus: sampleHouse, zweistöckig: twoStoryHouse, 'L-Grundriss': lHouse, 'Halle 23 × 16': hall };

const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const N18: ReadonlyArray<readonly [number, number, number]> = [-1, 0, 1].flatMap((dx) =>
  [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dz) => [dx, dy, dz] as const))).filter(([dx, dy, dz]) => {
  const n = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
  return n === 1 || n === 2;
});

/** Hüllen-Zellen, die nicht (18er-Nachbarschaft) an der untersten Bodenplatte hängen. */
function floating(shell: Shell): string[] {
  const at = new Set(shell.cells.map((c) => key3(c.pos)));
  const y0 = Math.min(...shell.cells.map((c) => c.pos[1]));
  const queue: Vec3[] = shell.cells.filter((c) => c.pos[1] === y0).map((c) => c.pos);
  const seen = new Set(queue.map(key3));
  for (let q = 0; q < queue.length; q++) {
    const [x, y, z] = queue[q]!;
    for (const [dx, dy, dz] of N18) {
      const p: Vec3 = [x + dx, y + dy, z + dz];
      if (at.has(key3(p)) && !seen.has(key3(p))) {
        seen.add(key3(p));
        queue.push(p);
      }
    }
  }
  return shell.cells.filter((c) => !seen.has(key3(c.pos))).map((c) => `${c.kind}/${c.role}@${c.pos.join(',')}`);
}

/** Luftzellen direkt über einer Decke, die von außen (Rand der Bounding Box) erreichbar sind. */
function leaks(shell: Shell): string[] {
  const at = new Set(shell.cells.map((c) => key3(c.pos)));
  const lo = [0, 1, 2].map((k) => Math.min(...shell.cells.map((c) => c.pos[k]!)) - 1);
  const hi = [0, 1, 2].map((k) => Math.max(...shell.cells.map((c) => c.pos[k]!)) + 1);
  const inBox = (p: Vec3): boolean => p.every((v, k) => v >= lo[k]! && v <= hi[k]!);
  const start: Vec3 = [lo[0]!, lo[1]!, lo[2]!];
  const out = new Set([key3(start)]);
  const queue: Vec3[] = [start];
  for (let q = 0; q < queue.length; q++) {
    const [x, y, z] = queue[q]!;
    for (const [dx, dy, dz] of N6) {
      const p: Vec3 = [x + dx, y + dy, z + dz];
      if (inBox(p) && !at.has(key3(p)) && !out.has(key3(p))) {
        out.add(key3(p));
        queue.push(p);
      }
    }
  }
  return shell.cells.filter((c) => c.kind === 'ceiling' && out.has(key3([c.pos[0], c.pos[1] + 1, c.pos[2]]))).map((c) => c.pos.join(','));
}

const hard = (w: World): string[] => w.materialized.violations.filter((v) => v.kind !== 'spawn').map((v) => `${v.kind}@${v.pos?.join(',') ?? '-'}: ${v.message}`);

/** Materialisiert eine Hülle mit Gauben und prüft alles; liefert die Zahl der Gaubenscheiben. */
function check(project: Project, opts: ShellOptions, where: string): number {
  const shell = deriveShell(project.state, opts);
  const { dormers: _, ...plain } = opts;
  const base = new Set(deriveShell(project.state, plain).cells.filter((c) => c.kind === 'window').map((c) => key3(c.pos)));
  const keys = shell.cells.map((c) => key3(c.pos));
  expect(new Set(keys).size, `${where}: Zellkollision`).toBe(keys.length);
  expect(shell.cells.filter((c) => !(SHELL_ROLE_SHAPES[c.role] ?? []).includes(c.shape)).map((c) => `${c.role}.${c.shape}`), where).toEqual([]);
  expect(floating(shell), `${where}: schwebt`).toEqual([]);
  if (opts.roof !== 'flat') expect(leaks(shell), `${where}: Lücke im Dach`).toEqual([]); // Flachdach: Decke = Dach
  const world = buildWorld(project, ctx, shell);
  expect(hard(world), where).toEqual([]);
  for (const c of shell.cells) {
    if (c.kind === 'roof' && c.shape === 'stairs' && c.orient?.half === 'bottom') {
      expect(world.materialized.volume.stateAt(c.pos).properties['shape'], `${where} ${c.pos}`).toBe(c.orient.stairShape);
    }
  }
  expect(JSON.stringify(deriveShell(project.state, opts).cells), `${where}: deterministisch`).toBe(JSON.stringify(shell.cells));
  return shell.cells.filter((c) => c.kind === 'window' && !base.has(key3(c.pos))).length;
}

describe('Gauben: jede Dachform × Neigung baut sich physikalisch sauber (Materialisierung)', () => {
  for (const [name, make] of Object.entries(HOUSES)) {
    it(`${name}: 9 Dachformen × 3 Neigungen × Gaubenstile`, { timeout: HEAVY_TIMEOUT }, () => {
      const project = make('1.21.11', 'medieval');
      let panes = 0;
      ROOFS.forEach((roof, r) => {
        PITCHES.forEach((pitch, k) => {
          for (const dormers of [{ kind: 'gable' } as const, ROTATION[(r + k) % ROTATION.length]!]) {
            panes += check(project, { roof, overhang: 1, roofDetail: { pitch, trim: true, verge: 'closed' }, dormers }, `${name} · ${roof}/${pitch} · ${dormers.kind}/${dormers.width ?? 3}`);
          }
        });
      });
      if (name !== 'L-Grundriss') expect(panes, `${name}: Gauben entstanden`).toBeGreaterThan(20);
    });
  }

  it('alle Themes und 26.3: Pfosten, Rähm, Scheiben und Blindblöcke lösen auf', { timeout: HEAVY_TIMEOUT }, () => {
    for (const theme of ctx.themes.ids()) {
      for (const version of ['1.21.11', '26.3'] as const) {
        check(sampleHouse(version, theme), { roof: 'gable', roofDetail: { pitch: 'steep', trim: true }, dormers: { kind: 'blind', width: 3 } }, `${version} · ${theme}`);
        check(hall(version, theme), { roof: 'mansard', dormers: { kind: 'shed', width: 5 } }, `${version} · ${theme} · Mansarde`);
      }
    }
  });
});

describe('Gauben mit Außengestaltung (X1): keine Kollision, Scheiben frei', () => {
  const STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as const;
  for (const [name, make] of Object.entries(HOUSES)) {
    it(`${name}: 9 Dachformen mit Gauben und Außen-Komponenten (Dichte 2)`, { timeout: HEAVY_TIMEOUT }, () => {
      for (const roof of ROOFS) {
        const where = `${name} · ${roof}`;
        const g = generate(make('1.21.11', 'medieval'), ctx, { roof, dormers: { kind: 'gable', width: 3 }, exterior: { density: 2 }, lighting: false });
        const plain = buildWorld(make('1.21.11', 'medieval'), ctx, g.shell);
        // Außen-Zellen liegen nie auf einer Hüllenzelle (Gauben eingeschlossen)
        const shellAt = new Set(g.shell.cells.map((c) => key3(c.pos)));
        const extCells = (g.exterior ?? []).flatMap((p) => p.cells.map((c) => `${p.componentId}@${key3(c)}`)).filter((s) => shellAt.has(s.split('@')[1]!));
        expect(extCells, where).toEqual([]);
        // keine neuen Verstöße durch die Außen-Komponenten
        expect(hard(g).sort(), where).toEqual(hard(plain).sort());
        // vor jeder Scheibe über der Wand (Giebel, Gaube) nur Luft oder durchsichtiges
        const vol = g.materialized.volume;
        const top = Math.max(...[...g.shell.rooms.values()].map((r) => r.baseY + r.height - 1));
        for (const w of g.shell.cells.filter((c) => c.kind === 'window' && c.shape === 'pane' && c.pos[1] > top)) {
          for (const [dx, dz] of Object.values(STEP)) {
            const q: Vec3 = [w.pos[0] + dx, w.pos[1], w.pos[2] + dz];
            if (shellAt.has(key3(q))) continue;
            expect(!vol.contains(q) || isAir(vol.stateAt(q)), `${where}: vor Scheibe ${w.pos} bei ${q}: ${vol.contains(q) ? vol.stateAt(q).name : '-'}`).toBe(true);
          }
        }
      }
    });
  }
});

describe('Anbau (B2, T1/T3 Hüllen-Teil): Treppenturm am zweistöckigen Haus', () => {
  /** Obergeschoss ohne Treppe im Haus, erreichbar nur über den (später gebauten) Turm an der Ostwand. */
  const project = (): Project => {
    const p = Project.create({ id: 't', name: 'Turmhaus', seed: 5, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
    p.paintRoom(0, CellSet.rect(0, 0, 14, 8), 'tavern');
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 14, 8), 'bedroom');
    return p;
  };
  const annexes = [{ id: 'turm', footprint: CellSet.rect(15, 2, 19, 6), top: 12, openings: [{ floorIndex: 0, at: [14, 4] as const }, { floorIndex: 1, at: [14, 4] as const }] }];

  it('9 Dachformen mit Gauben, Außenprofil und Außengestaltung: nichts im Turm-Grundriss, keine Verstöße, Türen hinein', { timeout: HEAVY_TIMEOUT }, () => {
    for (const roof of ROOFS) {
      const opts = { roof, annexes, dormers: { kind: 'gable' as const, width: 1 as const }, facade: { plinthProfile: true, quoins: true, brackets: 3 } };
      const where = `Turm · ${roof}`;
      check(project(), opts, where);
      // `BuildOptions` reicht `annexes` (noch) nicht durch: Hülle direkt ableiten, dann die Kette wie `generate`
      const p = project();
      const g = generateWith(p, ctx, deriveShell(p.state, opts), { exterior: { density: 2 }, lighting: false }, []);
      expect(g.shell.warnings.filter((w) => !w.startsWith('r')), where).toEqual([]);
      const inTower = (c: readonly number[]): boolean => annexes[0]!.footprint.has(c[0]!, c[2]!);
      expect(g.shell.cells.filter((c) => inTower(c.pos)), where).toEqual([]);
      expect((g.exterior ?? []).filter((p) => p.cells.some(inTower)).map((p) => p.componentId), where).toEqual([]);
      expect([...g.materialized.volume.cells()].filter((c) => inTower(c.pos)).map((c) => c.state.name), where).toEqual([]);
      expect(hard(g), where).toEqual([]);
      expect(g.shell.annexes?.[0]?.doors.length, where).toBe(2);
    }
  });
});
