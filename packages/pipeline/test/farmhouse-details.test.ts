/**
 * W12-C (plan/spikes/W12C_bauernhof_details.md, Review R6-4 „Bauernhaus-Details“): Details des Hofs über den
 * Anwendungsdienst (`projectFromBuildingType` + `generateBase`, wie Assistent, Engine und goldene Menge).
 *
 * - Scheune: heller Rand (Ortgang jenseits der Giebelwände und Eckspalten in `trim_light`, gebaut hell: OKLab-L ≥ 0,7),
 *   Scheunentor mittig im Außengiebel (Tür + Torflügel), Heuluke und Heubalken im Giebel, keine Blumenkästen.
 * - Wohnhaus: Vordach/Laube an der Haustür (Eingangsmodul Cottage) in jedem Theme.
 * - L: Hochsilo, spiegelsymmetrisch ab dem Sockel, alles in freier Luft auf Vollblöcken (0 harte Verstöße).
 * - farmstead: Wand/Dach-Abstand des Wohnhauses ≥ Mittelalterhaus (Lehmputz statt Kalk im Giebel).
 * - 0 harte Verstöße, deterministisch.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { blockLook, generateBase, projectFromBuildingType, type BaseWorld, type BuildingTypeResult } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

function build(size: 'M' | 'L', theme: string, seed: number): { res: BuildingTypeResult; world: BaseWorld } {
  const def = ctx.buildingTypes.get('farmhouse')!;
  const res = projectFromBuildingType(def, { size, themeId: theme, targetVersion: TARGET_VERSIONS['1.21.11'] }, seed, ctx);
  return { res, world: generateBase(res.project, ctx, { ...res.build, ...res.surroundings }) };
}

function lightness(rgb: number): number {
  const lin = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = lin((rgb >> 16) & 255), g = lin((rgb >> 8) & 255), b = lin(rgb & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

interface Details {
  readonly vergeLight: number;
  readonly cornerLight: number;
  readonly barnDoorCentered: boolean;
  readonly components: Map<string, number>;
  readonly barnFlowerBoxes: number;
  readonly canopy: number;
  readonly silo: { cells: number; symmetric: boolean };
  readonly hard: number;
  /** Baumstämme im Sichtkeil vor der Haustür (Halbwinkel 70°, ± 4 an der Tür; Geländestil homestead `groups.sight`). */
  readonly treesInSight: number;
}

function details(res: BuildingTypeResult, world: BaseWorld): Details {
  const vol = world.materialized.volume;
  const nameAt = (p: readonly [number, number, number]): string | undefined => (!vol.contains(p) || vol.isEmpty(p) ? undefined : String(vol.stateAt(p).name));
  const light = (p: readonly [number, number, number]): boolean => {
    const n = nameAt(p);
    return n !== undefined && lightness(blockLook(n).color) >= 0.7;
  };
  const st = res.project.state;
  const barnV = (st.volumes ?? []).find((v) => v.exterior?.barn === true)!.id;
  const barnRooms = new Set(st.rooms.filter((r) => r.volumeId === barnV).map((r) => r.id));
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of st.rooms) if (barnRooms.has(r.id)) for (const [x, z] of r.cells) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const alongX = x1 - x0 >= z1 - z0;
  const inVerge = (x: number, z: number): boolean => (alongX
    ? ((x >= x0 - 2 && x < x0) || (x > x1 && x <= x1 + 2)) && z >= z0 - 2 && z <= z1 + 2
    : ((z >= z0 - 2 && z < z0) || (z > z1 && z <= z1 + 2)) && x >= x0 - 2 && x <= x1 + 2);
  const corners = new Set([`${x0},${z0}`, `${x0},${z1}`, `${x1},${z0}`, `${x1},${z1}`]);
  let verge = 0, vergeLight = 0, corner = 0, cornerLight = 0;
  for (const c of world.shell.cells) {
    if (c.kind === 'roof' && inVerge(c.pos[0], c.pos[2])) {
      verge++;
      if (light(c.pos)) vergeLight++;
    }
    if (c.roomId !== undefined && barnRooms.has(c.roomId) && c.exterior === true && (c.kind === 'pillar' || c.kind === 'wall') && corners.has(`${c.pos[0]},${c.pos[2]}`)) {
      corner++;
      if (light(c.pos)) cornerLight++;
    }
  }
  const door = (world.shell.anchors ?? []).find((a) => a.kind === 'door' && a.roomId !== undefined && barnRooms.has(a.roomId));
  const barnDoorCentered = door !== undefined && (alongX
    ? (door.pos[0] === x1 + 1 || door.pos[0] === x0 - 1) && 2 * door.pos[2] === z0 + z1
    : (door.pos[2] === z1 + 1 || door.pos[2] === z0 - 1) && 2 * door.pos[0] === x0 + x1);
  const ext = world.exterior ?? [];
  const components = new Map<string, number>();
  for (const p of ext) components.set(p.componentId, (components.get(p.componentId) ?? 0) + 1);
  const nearBarn = (c: readonly number[]): boolean => c[0]! >= x0 - 1 && c[0]! <= x1 + 1 && c[2]! >= z0 - 1 && c[2]! <= z1 + 1;
  const barnFlowerBoxes = ext.filter((p) => p.group === 'flowerBoxes' && p.cells.some(nearBarn)).length;
  let main: [number, number] | undefined;
  const STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as const;
  for (const r of world.shell.rooms.values()) for (const d of r.doors) if (d.isMain) main = [d.inside[0] + STEP[d.toward][0], d.inside[1] + STEP[d.toward][1]];
  const canopy = main === undefined ? 0 : ext.filter((p) => p.group === 'canopy' && p.cells.some((c) => Math.abs(c[0] - main![0]) + Math.abs(c[2] - main![1]) <= 3)).length;
  const siloCells = world.shell.cells.filter((c) => c.kind === 'fort' && String(c.roomId ?? '').includes('silo'));
  let symmetric = siloCells.length > 0;
  if (symmetric) {
    const y0 = Math.min(...siloCells.filter((c) => c.role === 'hay').map((c) => c.pos[1]));
    const body = siloCells.filter((c) => c.pos[1] >= y0);
    const xs = body.map((c) => c.pos[0]), zs = body.map((c) => c.pos[2]);
    const cx = Math.min(...xs) + Math.max(...xs), cz = Math.min(...zs) + Math.max(...zs);
    const keys = new Map(body.map((c) => [`${c.pos[0]},${c.pos[1]},${c.pos[2]}`, `${c.role}/${c.shape}`] as const));
    symmetric = body.every((c) => keys.get(`${cx - c.pos[0]},${c.pos[1]},${c.pos[2]}`) === `${c.role}/${c.shape}` && keys.get(`${c.pos[0]},${c.pos[1]},${cz - c.pos[2]}`) === `${c.role}/${c.shape}`);
  }
  let treesInSight = 0;
  const door0 = [...world.shell.rooms.values()].flatMap((r) => r.doors).find((d) => d.isMain);
  if (door0 !== undefined) {
    const [fx, fz] = STEP[door0.toward];
    const wall = [door0.inside[0] + fx, door0.inside[1] + fz] as const;
    const tan = Math.tan((70 * Math.PI) / 180);
    const trunks = new Set((world.surroundings?.cells ?? []).filter((c) => /^log_/.test(c.role)).map((c) => `${c.pos[0]},${c.pos[2]}`));
    for (const k of trunks) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      const v = (x - wall[0]) * fx + (z - wall[1]) * fz;
      const u = Math.abs((x - wall[0]) * fz - (z - wall[1]) * fx);
      if (v >= 1 && u <= 4 + v * tan) treesInSight++;
    }
  }
  return {
    treesInSight,
    vergeLight: verge === 0 ? 0 : vergeLight / verge, cornerLight: corner === 0 ? 0 : cornerLight / corner, barnDoorCentered, components,
    barnFlowerBoxes, canopy, silo: { cells: siloCells.length, symmetric },
    hard: world.materialized.violations.filter((v) => v.kind !== 'spawn').length,
  };
}

describe('W12-C: Bauernhof-Details (Scheune, Vordach, Silo)', () => {
  it('M in allen drei Themes: heller Rahmen, Tor mittig im Giebel, Heuluke, keine Blumenkästen an der Scheune, Vordach, 0 harte Verstöße', { timeout: HEAVY_TIMEOUT }, () => {
    for (const theme of ['rustic', 'farmstead', 'medieval']) {
      for (const seed of [1, 2]) {
        const where = `${theme} Seed ${seed}`;
        const { res, world } = build('M', theme, seed);
        const d = details(res, world);
        expect(d.hard, where).toBe(0);
        expect(d.vergeLight, `${where}: Ortgang hell`).toBeGreaterThanOrEqual(0.8);
        expect(d.cornerLight, `${where}: Ecken hell`).toBeGreaterThanOrEqual(0.8);
        expect(d.barnDoorCentered, `${where}: Tor mittig im Außengiebel`).toBe(true);
        expect(d.components.get('exterior/barn_door'), `${where}: Scheunentor`).toBe(1);
        expect(d.components.get('exterior/hay_loft'), `${where}: Heuluke`).toBe(1);
        expect(d.components.get('exterior/hay_hood'), `${where}: Heubalken`).toBe(1);
        expect(d.barnFlowerBoxes, `${where}: Blumenkästen an der Scheune`).toBe(0);
        expect(d.canopy, `${where}: Vordach an der Haustür`).toBeGreaterThan(0);
        // W16-B (28.09.2026): Hochsilo schon in M (vorher 0), spiegelsymmetrisch
        expect(d.silo.cells, `${where}: Silo in M`).toBeGreaterThan(200);
        expect(d.silo.symmetric, `${where}: Silo spiegelsymmetrisch`).toBe(true);
        expect(d.treesInSight, `${where}: Bäume im Sichtkeil vor der Haustür`).toBe(0);
      }
    }
  });

  it('L: Hochsilo spiegelsymmetrisch neben der Scheune, 0 harte Verstöße', { timeout: HEAVY_TIMEOUT }, () => {
    for (const theme of ['rustic', 'farmstead']) {
      const { res, world } = build('L', theme, 1);
      const d = details(res, world);
      expect(d.hard, theme).toBe(0);
      // W16-B: Silo schlanker (r 2 statt 3, Mantel 18 statt 16)
      expect(d.silo.cells, `${theme}: Silo`).toBeGreaterThan(200);
      expect(d.silo.symmetric, `${theme}: Silo spiegelsymmetrisch`).toBe(true);
    }
  });

  it('farmstead: Wand/Dach-Abstand des Wohnhauses ≥ 0,215 (Mittelalterhaus), auch im ungünstigen Seed 8', { timeout: HEAVY_TIMEOUT }, () => {
    const { res, world } = build('M', 'farmstead', 8);
    const vol = world.materialized.volume;
    const wall: number[] = [], roof: number[] = [];
    for (const c of world.shell.cells) {
      if (c.roomId === undefined || res.project.state.rooms.find((r) => r.id === c.roomId)?.volumeId !== undefined) continue;
      const isRoof = c.kind === 'roof' && c.role === 'roof_main';
      const isWall = c.exterior === true && (c.kind === 'wall' || c.kind === 'pillar' || c.kind === 'facade' || c.kind === 'floor');
      if ((!isRoof && !isWall) || !vol.contains(c.pos) || vol.isEmpty(c.pos)) continue;
      const name = String(vol.stateAt(c.pos).name);
      if (/air$|glass|pane/.test(name)) continue;
      (isRoof ? roof : wall).push(lightness(blockLook(name).color));
    }
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
    expect(Math.abs(mean(wall) - mean(roof))).toBeGreaterThanOrEqual(0.215);
  });

  it('deterministisch: gleicher Seed → gleiche Außen-Deko und gleiche Bauwerke', { timeout: HEAVY_TIMEOUT }, () => {
    const a = build('L', 'rustic', 3).world;
    const b = build('L', 'rustic', 3).world;
    expect((b.exterior ?? []).map((p) => p.id)).toEqual((a.exterior ?? []).map((p) => p.id));
    const fort = (w: BaseWorld): string[] => w.shell.cells.filter((c) => c.kind === 'fort').map((c) => `${c.pos.join(',')}:${c.role}:${c.shape}`);
    expect(fort(b)).toEqual(fort(a));
  });
});
