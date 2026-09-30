/**
 * V3 über die Pipeline (Testhelfer `@mcda/pipeline`, wie in terrain/structures): jede neue bzw. für die Höhe
 * erweiterte Komponente materialisiert in 1.21.11 und 26.3 fehlerfrei – in Räumen der passenden lichten Höhe
 * (3 … 16), gedehnte Formen mit der Länge für den Raum, Stapel auf ihrem Eltern-Möbel. Dazu der End-to-End-Fuzz
 * (Einrichtung → Licht-Pass → Materialisierung) für alle Raumtypen bei lichter Höhe 3–6.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type RoomShellInfo, type Shell, type ShellCell } from '@mcda/blueprint';
import type { ComponentDef } from '@mcda/catalog';
import { CellSet, type Dir, type Vec3 } from '@mcda/core';
import { WorldView, materialize, type MaterializePlacement } from '@mcda/materialize';
import { generate, placedFor } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { RoomPlanner, expandComponent, fitsRoomHeight, renderAscii, verticality, type PlacedComponent } from '../src/index.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const VERSIONS = ['1.21.11', '26.3'] as const;

/** Neue Komponenten (V3) und Komponenten, die V3 für die Höhe erweitert hat (Dehnung, Stapel, Wandhöhen, hang). */
const V3_NEW = [
  'storage/chest_tower', 'storage/barrel_stack', 'storage/crate_stack', 'storage/shelf_hutch', 'storage/tall_cabinet',
  'storage/bookshelf_wall_tall', 'storage/hay_stack', 'light/lantern_cluster', 'decor/hanging_chains', 'decor/hanging_banner',
  'decor/herb_rack', 'decor/tool_wall', 'decor/head_trophy',
] as const;
const V3_EXTENDED = [
  'storage/chest', 'storage/barrel_upright', 'light/hanging_lantern', 'light/candle_chandelier', 'decor/hanging_planter',
  'bed/canopy', 'bed/canopy_double', 'decor/wall_shelf', 'decor/tapestry', 'decor/wall_banner', 'storage/upper_cabinet', 'decor/frame_tools',
] as const;

/** Synthetische Hülle (Vertrag blueprint/shell): Innenraum 10×8, lichte Höhe H, feste Wände, Tür Süd. */
function shellOf(H: number): { shell: Shell; geom: RoomShellInfo } {
  const roomId = 'r1';
  const cells: ShellCell[] = [];
  const W = 11, D = 9, doorX = 5;
  for (let x = 0; x <= W; x++) {
    for (let z = 0; z <= D; z++) {
      cells.push({ pos: [x, 0, z], kind: 'floor', role: 'floor_primary', shape: 'block', roomId });
      cells.push({ pos: [x, H + 1, z], kind: 'ceiling', role: 'ceiling', shape: 'block', roomId, exterior: true });
      const edgeX = x === 0 || x === W, edgeZ = z === 0 || z === D;
      if (!edgeX && !edgeZ) continue;
      for (let y = 1; y <= H; y++) {
        const pos: Vec3 = [x, y, z];
        if (edgeX && edgeZ) cells.push({ pos, kind: 'pillar', role: 'beam', shape: 'log', orient: { axis: 'y' }, roomId, exterior: true });
        else if (z === D && x === doorX && y <= 2) cells.push({ pos, kind: 'door', role: 'door', shape: 'door', orient: { facing: 'south', half: y === 1 ? 'lower' : 'upper', hinge: 'left' }, roomId, exterior: true });
        else cells.push({ pos, kind: 'wall', role: 'wall_primary', shape: 'block', roomId, exterior: true });
      }
    }
  }
  const geom: RoomShellInfo = {
    roomId, floorIndex: 0, baseY: 1, height: H, interior: CellSet.rect(1, 1, W - 1, D - 1),
    doors: [{ inside: [doorX, D - 1], toward: 'south', isMain: true }], windows: [],
  };
  return { shell: { cells, rooms: new Map([[roomId, geom]]), warnings: [] }, geom };
}

const FACING: Readonly<Record<number, Dir>> = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
const STEP: Readonly<Record<Dir, Vec3>> = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const up = (p: Vec3): Vec3 => [p[0], p[1] + 1, p[2]];

/** Mechanik auf der fertigen Welt: Truhe ohne vollen Block darüber, Bett ohne erstickenden Block, Rahmen an vollen Blöcken. */
function assertWorld(view: WorldView, where: string): void {
  for (const c of view.volume.cells()) {
    if (c.state.name === 'chest') expect(view.info(up(c.pos)).phys.cls, `${where}: Block über Truhe bei ${c.pos.join(',')}`).not.toBe('full');
    if (c.state.name.endsWith('_bed')) expect(view.info(up(c.pos)).phys.cls, `${where}: Block über Bett bei ${c.pos.join(',')}`).not.toBe('full');
  }
  for (const f of view.volume.entities()) {
    const s = STEP[FACING[(f.nbt.value['Facing'] as { value: number }).value]!];
    const behind: Vec3 = [f.blockPos[0] - s[0], f.blockPos[1] - s[1], f.blockPos[2] - s[2]];
    expect(view.info(behind).phys.cls, `${where}: Rahmen bei ${f.blockPos.join(',')} ohne festen Block`).toBe('full');
    expect(['air', 'thin'], `${where}: Rahmen-Zelle belegt`).toContain(view.info(f.blockPos).phys.cls);
  }
}

/** Materialisiert Platzierungen in einer Hülle und prüft: keine Verstöße, alle Zellen und Entities gesetzt. */
function check(shell: Shell, parts: readonly PlacedComponent[], where: string, themes: readonly string[]): void {
  const placements: MaterializePlacement[] = parts.map((placed, i) => ({ id: `c${i}`, placed, roomId: 'r1' }));
  for (const version of VERSIONS) {
    const platform = ctx.platform(version);
    for (const themeId of themes) {
      const w = `${where} · ${themeId} · ${version}`;
      const r = materialize({ shell, placements, theme: ctx.themes.get(themeId), platform, seed: 11 });
      const hard = r.violations.filter((v) => v.kind !== 'spawn');
      expect(hard, `${w}: ${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
      parts.forEach((p, i) => {
        expect(r.volume.cellsOf(`c${i}`).length, w).toBe(p.cells.length);
        expect(r.volume.entitiesOf(`c${i}`).length, w).toBe(p.entities.length);
      });
      assertWorld(new WorldView(r.volume, platform), w);
    }
  }
}

/** Erste gültige Pose (gedehnt für die Raumhöhe); Stapel- und Aufsatz-Formen auf einem passenden Eltern-Möbel. */
function setup(def: ComponentDef, base: string | undefined, geom: RoomShellInfo): PlacedComponent[] | undefined {
  const planner = new RoomPlanner(geom);
  const variantId = planner.adapt(def, base);
  if (def.tags.includes('dresser_top')) {
    for (const [pid, pv] of [['storage/wardrobe', 'dresser'], ['table/sideboard', 'barrel']] as const) {
      const parent = planner.poses(ctx.catalog.get(pid), pv)[0];
      if (parent === undefined) continue;
      const p2 = new RoomPlanner(geom, [parent]);
      const sp = p2.socketPoses(def, variantId, [{ key: 'p', placed: parent }])[0];
      if (sp !== undefined) return [parent, sp.placed];
    }
    return undefined;
  }
  const placed = planner.poses(def, variantId)[0];
  return placed === undefined ? undefined : [placed];
}

describe('V3: neue und erweiterte Komponenten materialisieren in 1.21.11 + 26.3 (Räume der passenden Höhe)', () => {
  it('die V3-Komponenten sind im Katalog', () => {
    for (const id of [...V3_NEW, ...V3_EXTENDED]) expect(ctx.catalog.find(id), id).toBeDefined();
  });

  const HEIGHTS = [3, 4, 5, 6, 8, 12, 16];
  for (const id of [...V3_NEW, ...V3_EXTENDED]) {
    it(id, { timeout: HEAVY_TIMEOUT }, () => {
      const def = ctx.catalog.get(id);
      let tested = 0;
      for (const base of def.variants?.map((v) => v.id) ?? [undefined]) {
        // passende Höhen: Höhen-Auswahl, Größe (gedehnt) und – an der Decke – Kopffreiheit (unterste Zelle ≥ Boden + 2)
        const heights = HEIGHTS.filter((H) => {
          const size = expandComponent(def, new RoomPlanner(shellOf(H).geom).adapt(def, base)).size[1];
          return fitsRoomHeight(def, base, H) && size <= H && (def.mount !== 'ceiling' || H - size >= 2);
        });
        expect(heights.length, `${id}#${base}: keine passende Höhe`).toBeGreaterThan(0);
        heights.forEach((H, i) => {
          const { shell, geom } = shellOf(H);
          const parts = setup(def, base, geom);
          expect(parts, `${id}#${base} H${H}: keine gültige Pose`).toBeDefined();
          // alle Themes bei der ersten passenden Höhe, sonst das Standard-Theme
          check(shell, parts!, `${id}#${base ?? ''} H${H} (${parts!.at(-1)!.expanded.variantId ?? '-'})`, i === 0 ? ctx.themes.ids() : ['medieval']);
          tested++;
        });
      }
      expect(tested).toBeGreaterThan(0);
    });
  }

  it('Stapel: Truhe auf Truhe auf Truhe mit Krug, Fass auf Fass, Laterne über dem Tisch – als ganze Gruppe', () => {
    const { shell, geom } = shellOf(5);
    const chest = expandComponent(ctx.catalog.get('storage/chest'));
    const vase = expandComponent(ctx.catalog.get('decor/vase'));
    const barrel = expandComponent(ctx.catalog.get('storage/barrel_upright'));
    const planner = new RoomPlanner(geom);
    const parts: PlacedComponent[] = [];
    const add = (p: PlacedComponent | undefined): PlacedComponent => {
      expect(p).toBeDefined();
      planner.add(p!);
      parts.push(p!);
      return p!;
    };
    // Truhen-Säule an der Nordwand
    let top = add(planner.poses(ctx.catalog.get('storage/chest')).find((p) => p.pose.pos[2] === 1 && p.pose.pos[0] === 3));
    for (let k = 0; k < 2; k++) top = add(planner.socketPoses(ctx.catalog.get('storage/chest'), undefined, [{ key: 't', placed: top }]).find((s) => s.socketId === 'stack')?.placed);
    add(planner.socketPoses(ctx.catalog.get('decor/vase'), undefined, [{ key: 't', placed: top }]).find((s) => s.socketId === 'top')?.placed);
    // Fass-Säule
    let b = add(planner.poses(ctx.catalog.get('storage/barrel_upright')).find((p) => p.pose.pos[2] === 1 && p.pose.pos[0] === 8));
    b = add(planner.socketPoses(ctx.catalog.get('storage/barrel_upright'), undefined, [{ key: 'b', placed: b }]).find((s) => s.socketId === 'stack')?.placed);
    // Tavernentisch mit Hängelaterne (gedehnt für H5)
    const table = add(planner.poses(ctx.catalog.get('table/tavern_table')).find((p) => p.pose.pos[0] === 5 && p.pose.pos[2] === 4));
    const lantern = ctx.catalog.get('light/hanging_lantern');
    add(planner.socketPoses(lantern, planner.adapt(lantern), [{ key: 'tt', placed: table }]).find((s) => s.socketId === 'lamp')?.placed);
    expect(parts.filter((p) => p.expanded === chest || p.expanded.defId === chest.defId)).toHaveLength(3);
    void vase; void barrel; void b;
    check(shell, parts, 'Stapel H5', ctx.themes.ids());
  });
});

/** Stand vor V3 (Einrichtung ohne Licht-Pass, gleicher Raumsatz wie vertical.test.ts): Blöcke über Kopfhöhe je Raum. */
describe('V3 End-to-End: alle Raumtypen, lichte Höhe 3–6 (Einrichtung → Licht-Pass → Materialisierung)', () => {
  const sizes = [[9, 8], [12, 9]] as const;
  const rows: string[] = [];
  for (const H of [3, 4, 5, 6]) {
    it(`lichte Höhe ${H} (1.21.11), 0 Warnungen, 0 Verstöße, 0 Spawn-Zellen, Truhen/Betten/Rahmen ok`, { timeout: HEAVY_TIMEOUT }, () => {
      let above = 0, levels = 0, n = 0;
      for (const type of ctx.catalog.roomTypeIds()) {
        for (const [w, d] of sizes) {
          if ((w - 2) * (d - 2) < ctx.catalog.roomType(type).minArea) continue;
          for (const seed of [0, 1]) {
            const p = Project.create({ id: 'v3', name: 'V3', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: H } });
            p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
            const world = generate(p, ctx);
            const room = p.state.rooms[0]!;
            const info = world.shell.rooms.get(room.id)!;
            const placed = p.state.placements.filter((x) => x.roomId === room.id).map((x) => placedFor(x, ctx.catalog));
            const where = `${type} ${w}×${d} H${H} seed ${seed}\n${renderAscii(info, placed, (id) => ctx.catalog.get(id).tags)}`;
            expect(world.warnings, where).toEqual([]);
            const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
            expect(hard, `${where}\n${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
            expect(world.materialized.light.darkCells, where).toEqual([]);
            assertWorld(new WorldView(world.materialized.volume, ctx.platform('1.21.11')), where);
            const v = verticality(placed, info);
            above += v.above;
            levels += v.ratio;
            n++;
          }
        }
      }
      rows.push(`H${H}: ${(above / n).toFixed(1)} Blöcke über Kopfhöhe je Raum, ${Math.round((100 * levels) / n)} % der Höhenebenen genutzt (${n} Räume)`);
      expect(levels / n).toBeGreaterThan(0.9);
    });
  }

  it('26.3 × alle Themes bei lichter Höhe 5', { timeout: HEAVY_TIMEOUT }, () => {
    for (const type of ctx.catalog.roomTypeIds()) {
      for (const themeId of ctx.themes.ids()) {
        const p = Project.create({ id: 'v3', name: 'V3', seed: 4, themeId, targetVersion: TARGET_VERSIONS['26.3'], floor: { y0: 0, height: 5 } });
        p.paintRoom(0, CellSet.rect(0, 0, 11, 8), type);
        const world = generate(p, ctx);
        const where = `${type} 26.3 ${themeId}`;
        expect(world.warnings, where).toEqual([]);
        expect(world.materialized.violations.filter((v) => v.kind !== 'spawn'), where).toEqual([]);
        expect(world.materialized.light.darkCells, where).toEqual([]);
        assertWorld(new WorldView(world.materialized.volume, ctx.platform('26.3')), where);
      }
    }
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});
