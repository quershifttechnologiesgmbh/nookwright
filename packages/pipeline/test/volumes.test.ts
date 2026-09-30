/**
 * Integration Baukörper (V0, research/19 §7.4): Häuserzeile (über `applyBuildingType`), Turm neben Halle, Hang →
 * Hülle (je Baukörper, Brandwände) → Einrichtung → Licht-Pass → Außen-Deko (X1) → Außenprofil → Materialisierung,
 * beide Zielversionen, zwei Themes: keine Kollision (der Merge wirft sonst), 0 harte Physik-Verstöße, 0 Spawn-Zellen,
 * keine dunklen Zellen, alle Räume erreichbar (Türen und Treppen; in der fertigen Welt zu Fuß ohne Leitern).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLUME, Project, TARGET_VERSIONS, type BuildingTypeDraft, type FacadeStyle, type ProjectEvent, type Shell, type VolumeProps,
} from '@mcda/blueprint';
import { CellSet, type HorizontalDir, type Vec3 } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generate, type GeneratedWorld } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { Walker, standKey } from './walk.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
type Version = keyof typeof TARGET_VERSIONS;
const FACADE: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4 };
const STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

const project = (version: Version, theme: string): Project =>
  Project.create({ id: 'v', name: 'Baukörper', seed: 2026, themeId: theme, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: 3 } });

function addVolume(p: Project, props: VolumeProps): string {
  const e = p.addVolume(props).find((x): x is Extract<ProjectEvent, { type: 'VolumeAdded' }> => x.type === 'VolumeAdded')!;
  return e.volume.id;
}

/** Häuserzeile als Bautyp-Plan: drei Häuser, Haus 2 höher (Erdgeschoss 5, 3 Etagen), Haus 3 steiles Dach, eine Etage. */
const ROW: BuildingTypeDraft = {
  origin: { buildingTypeId: 'townhouse_row', params: { houses: 3 }, seed: 2026, rerollCount: 0 },
  floors: { 0: 3, 1: 3, 2: 3 },
  volumes: [
    { key: DEFAULT_VOLUME, name: 'Haus 1', roof: 'gable' },
    { key: 'h2', name: 'Haus 2', roof: 'gable', floorHeights: { 0: 5 } },
    { key: 'h3', name: 'Haus 3', roof: 'gable', roofDetail: { pitch: 'steep', trim: true } },
  ],
  rooms: [
    { floorIndex: 0, cells: CellSet.rect(0, 0, 6, 10), roomTypeId: 'kitchen' },
    { floorIndex: 1, cells: CellSet.rect(0, 0, 6, 10), roomTypeId: 'bedroom' },
    { floorIndex: 0, cells: CellSet.rect(7, 0, 13, 10), roomTypeId: 'smithy', volume: 'h2' },
    { floorIndex: 1, cells: CellSet.rect(7, 0, 13, 10), roomTypeId: 'study', volume: 'h2' },
    { floorIndex: 2, cells: CellSet.rect(7, 0, 13, 10), roomTypeId: 'bedroom', volume: 'h2' },
    { floorIndex: 0, cells: CellSet.rect(14, 0, 20, 10), roomTypeId: 'storage', volume: 'h3' },
  ],
  stairs: [
    { floorIndex: 0, origin: [3, 3], facing: 'south' },
    { floorIndex: 0, origin: [9, 2], facing: 'south' },
    { floorIndex: 1, origin: [11, 8], facing: 'north' },
  ],
};

function rowHouses(version: Version, theme: string): Project {
  const p = project(version, theme);
  p.applyBuildingType(ROW);
  return p;
}

function towerAndHall(version: Version, theme: string): Project {
  const p = project(version, theme);
  for (let f = 0; f < 3; f++) p.addFloor();
  const tower = addVolume(p, { name: 'Turm', roof: 'flat' });
  p.paintRoom(0, CellSet.rect(0, 0, 14, 10), 'dining_hall');
  for (let f = 0; f < 4; f++) p.paintRoom(f, CellSet.rect(15, 2, 21, 8), f === 0 ? 'storage' : f === 3 ? 'bedroom' : 'tower_room', { volumeId: tower });
  for (let f = 0; f < 3; f++) p.placeStairs(f, [f % 2 === 0 ? 17 : 19, 3], 'north', 'ladder');
  return p;
}

function hillside(version: Version, theme: string): Project {
  const p = project(version, theme);
  const low = addVolume(p, { name: 'Unterhaus', baseOffset: -3 });
  p.paintRoom(0, CellSet.rect(0, 0, 10, 8), 'kitchen');
  p.paintRoom(0, CellSet.rect(11, 0, 19, 8), 'storage', { volumeId: low });
  return p;
}

/** Räume, die von den Haustüren über Türen (gleicher Boden) und Treppen (gleiche linkId) erreichbar sind. */
function reachable(shell: Shell): Set<string> {
  const groups = new Map<string, string[]>();
  const roots = new Set<string>();
  const outer = new Set(shell.cells.filter((c) => c.kind === 'door' && c.exterior === true).map((c) => `${c.pos[0]},${c.pos[2]}`));
  for (const [id, r] of shell.rooms) {
    for (const d of r.doors) {
      const at = `${d.inside[0] + STEP[d.toward][0]},${d.inside[1] + STEP[d.toward][1]}`;
      if (outer.has(at)) roots.add(id);
      groups.set(`${r.baseY}:${at}`, [...(groups.get(`${r.baseY}:${at}`) ?? []), id]);
    }
    for (const s of r.stairs ?? []) groups.set(s.linkId, [...(groups.get(s.linkId) ?? []), id]);
  }
  const seen = new Set(roots);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of groups.values()) if (g.some((r) => seen.has(r))) for (const r of g) if (!seen.has(r)) (seen.add(r), (grew = true));
  }
  return seen;
}

/** Zu Fuß in der fertigen Welt ab der Innenseite jeder Außentür erreichte Räume. */
function walked(project: Project, w: GeneratedWorld): string[] {
  const shell = w.shell;
  const outer = new Set(shell.cells.filter((c) => c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower').map((c) => c.pos.join(',')));
  const starts: Vec3[] = [...shell.rooms.values()].flatMap((r) => r.doors
    .filter((d) => outer.has([d.inside[0] + STEP[d.toward][0], r.baseY, d.inside[1] + STEP[d.toward][1]].join(',')))
    .map((d): Vec3 => [d.inside[0], r.baseY, d.inside[1]]));
  const seen = new Walker(w.materialized.volume, ctx.platform(project.state.targetVersion.name)).reach(starts);
  return [...shell.rooms.values()].filter((r) => [...r.interior].some(([x, z]) => seen.has(standKey([x, r.baseY, z])))).map((r) => r.roomId).sort();
}

const SCENARIOS = [
  ['Häuserzeile (Bautyp-Plan)', rowHouses, 6],
  ['Turm neben Halle', towerAndHall, 2],
  ['Hang', hillside, 2],
] as const;

describe('Baukörper in der Pipeline', () => {
  for (const [name, make, onFoot] of SCENARIOS) {
    it(`${name}: 2 Zielversionen × 2 Themes – eingerichtet, beleuchtet, Außen-Deko, Außenprofil, 0 Verstöße, erreichbar`, { timeout: HEAVY_TIMEOUT }, () => {
      for (const version of ['1.21.11', '26.3'] as const) {
        for (const theme of ['medieval', 'rustic']) {
          const where = `${name} · ${version} · ${theme}`;
          const p = make(version, theme);
          const w = generate(p, ctx, { roof: 'gable', roofDetail: { trim: true, gableWindows: true }, facade: FACADE, exterior: {} });
          expect(w.warnings, where).toEqual([]);
          const hard = w.materialized.violations.filter((v) => v.kind !== 'spawn');
          expect(hard.map((v) => `${v.kind}@${v.pos?.join(',')}: ${v.message}`), where).toEqual([]);
          expect(w.materialized.violations.filter((v) => v.kind === 'spawn'), where).toEqual([]);
          expect(w.materialized.light.darkCells, where).toEqual([]);
          expect((w.exterior ?? []).length, `${where}: Außen-Deko`).toBeGreaterThan(5);
          expect(w.shell.cells.some((c) => c.kind === 'facade'), `${where}: Außenprofil`).toBe(true);
          expect([...reachable(w.shell)].sort(), `${where}: Türen und Treppen`).toEqual(p.state.rooms.map((r) => r.id).sort());
          // zu Fuß (ohne Leitern): die Türen durch die Brandwände sind wirklich begehbar
          expect(walked(p, w).length, `${where}: zu Fuß`).toBeGreaterThanOrEqual(onFoot);
          // jede Platzierung liegt in ihrem Raum auf seiner Höhe (Boden des Baukörpers)
          for (const pl of p.state.placements) {
            const info = w.shell.rooms.get(pl.roomId)!;
            expect(pl.pose.pos[1] >= info.baseY - 1 && pl.pose.pos[1] < info.baseY + info.height, `${where}: ${pl.componentId} ${pl.pose.pos}`).toBe(true);
          }
        }
      }
    });
  }

  it('Häuserzeile: Neu-Würfeln ersetzt den Plan in einem Schritt, Undo stellt ihn wieder her; Welt bleibt fehlerfrei', { timeout: HEAVY_TIMEOUT }, () => {
    const p = rowHouses('1.21.11', 'medieval');
    const before = JSON.stringify(p.state.rooms.map((r) => [r.id, r.volumeId, r.cells.size]));
    p.rerollBuildingType({ ...ROW, origin: { ...ROW.origin, rerollCount: 1 } });
    expect(p.history.at(-1)!.type).toBe('BuildingTypeRerolled');
    expect(p.state.origin?.rerollCount).toBe(1);
    const undone = p.undo(1);
    expect(JSON.stringify(undone.state.rooms.map((r) => [r.id, r.volumeId, r.cells.size]))).toBe(before);
    expect(undone.state.origin?.rerollCount).toBe(0);
    const w = generate(p, ctx, { roof: 'gable' });
    expect(w.warnings).toEqual([]);
    expect(w.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
  });
});

describe('Baukörper in der Pipeline: Zufallstest', () => {
  const ROOFS = ['flat', 'hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox'] as const;
  const lcg = (seed: number): (() => number) => {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 0x100000000);
  };

  it('2–3 angebaute Baukörper (Versatz, eigene Höhen und Dächer): keine Kollision, 0 Verstöße, 0 Spawn, keine Dunkelzellen', { timeout: HEAVY_TIMEOUT }, () => {
    for (let seed = 1; seed <= 24; seed++) {
      const rnd = lcg(seed * 104729);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
      const p = project(pick(['1.21.11', '26.3'] as const), pick(['medieval', 'rustic']));
      const vols: Array<string | undefined> = [undefined];
      const nv = 2 + Math.floor(rnd() * 2);
      for (let k = 1; k < nv; k++) vols.push(addVolume(p, { baseOffset: pick([0, 0, -3, 2, -4]), roof: pick(ROOFS), ...(rnd() < 0.4 ? { floorHeights: { 0: pick([3, 4, 5]) } } : {}) }));
      let [bx, bz, bw, bd] = [0, 0, 0, 0];
      for (let k = 0; k < nv; k++) {
        const w = 6 + Math.floor(rnd() * 6);
        const d = 6 + Math.floor(rnd() * 6);
        const side = Math.floor(rnd() * 4);
        const [x, z] = k === 0 ? [0, 0]
          : side === 0 ? [bx + bw, bz + Math.floor(rnd() * bd) - 2]
          : side === 1 ? [bx - w, bz + Math.floor(rnd() * bd) - 2]
          : side === 2 ? [bx + Math.floor(rnd() * bw) - 2, bz + bd]
          : [bx + Math.floor(rnd() * bw) - 2, bz - d];
        [bx, bz, bw, bd] = [x, z, w, d];
        try {
          p.paintRoom(0, CellSet.rect(x, z, x + w - 1, z + d - 1), pick(['kitchen', 'storage', 'bedroom', 'smithy']), vols[k] !== undefined ? { volumeId: vols[k]! } : {});
        } catch (e) {
          if (!(e instanceof Error) || e.name !== 'DomainError') throw e; // Überschneidung mit einem anderen Baukörper
        }
      }
      const where = `Seed ${seed}`;
      const w = generate(p, ctx, { roof: pick(ROOFS), roofDetail: { trim: true, gableWindows: true }, facade: FACADE, exterior: {} });
      expect(w.materialized.violations.filter((v) => v.kind !== 'spawn').map((v) => `${v.kind}@${v.pos?.join(',')}: ${v.message}`), where).toEqual([]);
      expect(w.materialized.violations.filter((v) => v.kind === 'spawn'), where).toEqual([]);
      expect(w.materialized.light.darkCells, where).toEqual([]);
    }
  });
});
