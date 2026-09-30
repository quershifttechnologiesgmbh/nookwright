/**
 * FN (Welle FN, 28.09.2026, plan/spikes/FN_villagers.md) – Dorfbewohner- und Mob-Anlagen: Handelsbude (2/3 Stände, 13 Berufe),
 * Villager-Bettreihe, Futterspender, Heilzelle mit Eisentür, leerer Spawner-Käfig; Raumtypen fn_villager_hall, fn_villager_quarters,
 * fn_cure_room, fn_spawner_chamber. Geprüft werden
 *  - der Katalog (Tags mit Präfix fn_, keine Bestandspools betroffen, Mechanik-Lint an jeder Bude mit angehängtem Tag `villager_stall`),
 *  - der Solver: jeder Raumtyp × 3 Größen × lichte Höhe 3/4/5 × 3 Seeds → Signatur und Pflicht erfüllt, 0 Kollisionen,
 *  - End-to-End über `@mcda/pipeline` (Einrichtung → Licht-Pass → Materialisierung): 0 Warnungen, 0 Physik-Verstöße, 0 Spawn-Zellen,
 *  - die Spielmechanik direkt an der materialisierten Komponente (Buden-Geometrie ohne Flucht, Heilzelle mit Eisentür, Betten frei,
 *    Spawner-Käfig mit Fackel, Dropper/Knopf),
 *  - jede Komponente × Variante × passende Höhe in 1.21.11 + 26.3 × Themes.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type RoomShellInfo, type Shell, type ShellCell } from '@mcda/blueprint';
import { checkComponentMechanics, evalCount, type ComponentDef, type MaterialSpec, type RoomTypeDef } from '@mcda/catalog';
import { CellSet, key3, type Dir, type Vec3 } from '@mcda/core';
import { WorldView, faceSupport, materialize, type MaterializePlacement } from '@mcda/materialize';
import { generate, placedFor } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { RoomPlanner, expandComponent, fitsRoomHeight, furnishRoom, renderAscii, verticality, type PlacedComponent } from '../src/index.js';
import { DV, assertHardGuarantees, catalog, shellRoom } from './fixtures.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const VERSIONS = ['1.21.11', '26.3'] as const;

const FN_TYPES = ['fn_villager_hall', 'fn_villager_quarters', 'fn_cure_room', 'fn_spawner_chamber'] as const;

const FN_COMPONENTS = [
  'trade/fn_trade_booth', 'bed/fn_villager_bed', 'functional/fn_mob_feed_trough', 'functional/fn_mob_cure_cell', 'decor/fn_mob_spawner_cage',
] as const;

/** Arbeitsblöcke der 13 Berufe (Faktencheck #7). */
const JOB_BLOCKS: Readonly<Record<string, string>> = {
  blast_furnace: 'armorer', smoker: 'butcher', cartography_table: 'cartographer', brewing_stand: 'cleric', composter: 'farmer',
  barrel: 'fisherman', fletching_table: 'fletcher', cauldron: 'leatherworker', water_cauldron: 'leatherworker', lectern: 'librarian',
  stonecutter: 'mason', loom: 'shepherd', smithing_table: 'toolsmith', grindstone: 'weaponsmith',
};

/** Qualitäts-Schwelle (0,65 · Mittel + 0,35 · Minimum der Teilwerte). */
const MIN_QUALITY = 0.55;

const blockName = (id: string | undefined): string | undefined => id?.slice(id.indexOf(':') + 1);

function materialsOf(def: ComponentDef): MaterialSpec[] {
  return [def, ...(def.variants ?? [])].flatMap((p) => Object.values(p.legend ?? {}));
}

/** Signatur-Tags eines Raumtyps (Einträge mit `signature: true`). */
const signatureTags = (rt: RoomTypeDef): string[] => [...rt.required, ...rt.optional].filter((e) => e.signature === true).flatMap((e) => e.tags);

/** Kleinste Standardgröße (Außenmaß) mit genug Innenfläche für den Raumtyp. */
function smallest(rt: RoomTypeDef): readonly [number, number] {
  return ([[7, 6], [8, 7], [9, 8], [10, 8], [11, 9]] as const).find(([w, d]) => (w - 2) * (d - 2) >= rt.minArea) ?? [12, 9];
}

// ---------------------------------------------------------------- Welt-Hilfen

const FACING: Readonly<Record<number, Dir>> = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
const STEP: Readonly<Record<Dir, Vec3>> = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const add = (p: Vec3, d: Dir, n = 1): Vec3 => [p[0] + STEP[d][0] * n, p[1] + STEP[d][1] * n, p[2] + STEP[d][2] * n];

/** Mechanik der fertigen Welt: Truhe/Bett ohne vollen Block darüber, Rahmen an vollen Blöcken (nicht Truhe/Fass). */
function assertWorld(view: WorldView, where: string): void {
  for (const c of view.volume.cells()) {
    const above = view.info(add(c.pos, 'up'));
    if (c.state.name === 'chest' || c.state.name === 'ender_chest') expect(above.phys.cls, `${where}: Block über Truhe bei ${c.pos.join(',')}`).not.toBe('full');
    if (c.state.name.endsWith('_bed')) expect(above.phys.cls, `${where}: erstickender Block über Bett bei ${c.pos.join(',')}`).not.toBe('full');
    expect(c.state.name, `${where}: Portal ist unentzündet zu exportieren`).not.toBe('nether_portal');
  }
  for (const f of view.volume.entities()) {
    const s = STEP[FACING[(f.nbt.value['Facing'] as { value: number }).value]!];
    const behind: Vec3 = [f.blockPos[0] - s[0], f.blockPos[1] - s[1], f.blockPos[2] - s[2]];
    expect(view.info(behind).phys.cls, `${where}: Rahmen bei ${f.blockPos.join(',')} ohne festen Block`).toBe('full');
    expect(view.state(behind).name, `${where}: Rahmen an Truhe/Fass`).not.toMatch(/chest|barrel/);
    expect(['air', 'thin'], `${where}: Rahmen-Zelle belegt`).toContain(view.info(f.blockPos).phys.cls);
  }
}

/** Synthetische Hülle (Vertrag blueprint/shell, wie vertical-pipeline.test): Innenraum 10×8 ab (1,1), lichte Höhe H. */
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

function materializeParts(shell: Shell, parts: readonly PlacedComponent[], version: string, themeId = 'medieval') {
  const placements: MaterializePlacement[] = parts.map((placed, i) => ({ id: `c${i}`, placed, roomId: 'r1' }));
  const platform = ctx.platform(version);
  const r = materialize({ shell, placements, theme: ctx.themes.get(themeId), platform, seed: 11 });
  return { r, view: new WorldView(r.volume, platform) };
}

/** Pose mit Front nach Süden (Drehung 0) direkt an der Nordwand (z = 1), möglichst mittig. */
function northWallPose(def: ComponentDef, variantId: string | undefined, geom: RoomShellInfo): PlacedComponent {
  const poses = new RoomPlanner(geom).poses(def, variantId).filter((p) => p.pose.rot === 0 && p.pose.pos[2] === 1);
  expect(poses.length, `${def.id}#${variantId}: keine Pose an der Nordwand`).toBeGreaterThan(0);
  return poses.sort((a, b) => Math.abs(a.pose.pos[0] - 4) - Math.abs(b.pose.pos[0] - 4))[0]!;
}

/** Unterkante der Kollision einer Zelle (relativ zur Zelle): 0 bei Vollblock/unterer Stufe, sonst ∞ (frei). */
function collisionBottom(view: WorldView, p: Vec3): number {
  const info = view.info(p);
  if (info.phys.cls === 'air' || info.phys.cls === 'thin') return Infinity;
  return faceSupport(info, 'down') === 'full' || info.phys.cls === 'full' ? 0 : 0.5;
}


// ================================================================ Katalog

describe('FN: Katalog (Tags, Raumtypen, kein Regress im Bestand)', () => {
  it('alle Komponenten und Raumtypen sind geladen, jeder Raumtyp-Tag hat Komponenten', () => {
    for (const id of FN_COMPONENTS) expect(catalog.find(id), id).toBeDefined();
    for (const t of FN_TYPES) {
      expect(catalog.roomTypeIds(), t).toContain(t);
      expect(catalog.missingTags(t, DV), t).toEqual([]);
      expect(signatureTags(catalog.roomType(t)).length, `${t}: Signatur`).toBeGreaterThan(0);
    }
  });

  it('eigene Tags haben das Präfix fn_ und stehen in keinem Bestands-Raumtyp (sonst Regress der Prüfsummen)', () => {
    const own = new Set(FN_COMPONENTS.flatMap((id) => catalog.get(id).tags));
    for (const t of own) expect(t.startsWith('fn_'), t).toBe(true);
    for (const id of catalog.roomTypeIds()) {
      if (id.startsWith('fn_')) continue;
      const rt = catalog.roomType(id);
      for (const e of [...rt.required, ...rt.optional]) for (const t of e.tags) expect(own.has(t), `${id} nutzt ${t}`).toBe(false);
    }
    // die Bestands-Tags der Raumtypen tauchen an den FN-Komponenten nicht auf (kein Pool-Übergriff)
    for (const id of FN_COMPONENTS) {
      for (const t of ['villager_stall', 'cure_station', 'bed', 'bed_single', 'prison_cell', 'animal_pen']) expect(catalog.get(id).tags, `${id}: ${t}`).not.toContain(t);
    }
  });

  it('Buden: 23 Varianten (13 solo, 6 Paare, 4 Trios), jeder Stand ein anderer Beruf je Bude, alle 13 Berufe abgedeckt', () => {
    const def = catalog.get('trade/fn_trade_booth');
    expect(def.variants).toHaveLength(23);
    const all = new Set<string>();
    for (const v of def.variants!) {
      const jobs = Object.entries(v.legend!).filter(([k]) => 'abc'.includes(k)).map(([, m]) => blockName(m.block)!);
      expect(v.id.startsWith('solo') ? jobs.length === 1 : v.id.startsWith('pair') ? jobs.length === 2 : jobs.length === 3, v.id).toBe(true);
      expect(new Set(jobs).size, `${v.id}: verschiedene Arbeitsblöcke`).toBe(jobs.length);
      for (const j of jobs) {
        expect(Object.keys(JOB_BLOCKS), `${v.id}: ${j}`).toContain(j);
        all.add(JOB_BLOCKS[j]!);
      }
    }
    expect(all).toEqual(new Set(Object.values(JOB_BLOCKS)));
    expect(def.functionTags).toEqual(expect.arrayContaining(['trade', 'villager_workstation']));
  });

  it('Mechanik-Lint der Stände (stallGeometry, jobSiteReachable) gilt für jede Bude mit angehängtem Tag villager_stall', () => {
    const def = catalog.get('trade/fn_trade_booth');
    const linted = { ...def, tags: [...def.tags, 'villager_stall'] };
    expect(checkComponentMechanics(linted)).toEqual([]);
    for (const id of FN_COMPONENTS) expect(checkComponentMechanics(catalog.get(id)), id).toEqual([]);
  });

  it('kein Wasser/Lava/Portal, Spawner nur als creative-Komponente', () => {
    for (const id of FN_COMPONENTS) {
      const blocks = materialsOf(catalog.get(id)).map((m) => blockName(m.block));
      for (const b of ['water', 'lava', 'nether_portal', 'tnt', 'redstone_block']) expect(blocks, `${id}: ${b}`).not.toContain(b);
      if (blocks.includes('spawner')) expect(catalog.get(id).obtainability).toBe('creative');
    }
  });
});

// ================================================================ Solver

describe('FN: Solver – Raumtyp × 3 Größen × lichte Höhe 3/4/5 × 3 Seeds', () => {
  for (const type of FN_TYPES) {
    it(`${type}: Signatur + Pflicht, 0 Kollisionen, keine Taschen, Qualität > ${MIN_QUALITY}, deterministisch`, { timeout: HEAVY_TIMEOUT }, () => {
      const rt = catalog.roomType(type);
      const [sw, sd] = smallest(rt);
      const rooms = (H: number) => [
        { ...shellRoom(sw, sd, { height: H }), roomId: `${sw}x${sd}` },
        { ...shellRoom(11, 9, { height: H, inner: ['north'], windowSpacing: 4 }), roomId: '11x9i' },
        { ...shellRoom(14, 10, { height: H, windowSpacing: 4 }), roomId: '14x10' },
      ];
      let q = 0, n = 0;
      for (const H of [3, 4, 5]) {
        for (const g of rooms(H)) {
          for (let seed = 0; seed < 3; seed++) {
            const r = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
            const where = `${type} ${g.roomId} H${H} seed ${seed}\n${renderAscii(g, r.placed, (id) => catalog.get(id).tags)}`;
            expect(r.warnings, where).toEqual([]);
            const tags = new Set(r.placements.flatMap((p) => catalog.get(p.componentId).tags));
            expect(signatureTags(rt).some((t) => tags.has(t)), `${where}\nSignatur fehlt`).toBe(true);
            for (const e of rt.required) {
              if (evalCount(e.count, g.interior.size)[0] > 0) expect(e.tags.some((t) => tags.has(t)), `${where}\nPflicht ${e.tags.join('|')}`).toBe(true);
            }
            assertHardGuarantees(g, r, where);
            expect(r.quality.score, where).toBeGreaterThan(MIN_QUALITY);
            q += r.quality.score;
            n++;
            if (seed === 0) {
              const again = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
              expect(again.placements, `${where}: deterministisch`).toEqual(r.placements);
            }
          }
        }
      }
      expect(q / n).toBeGreaterThan(0.7);
    });
  }

  it('Händlerhalle wächst mit der Fläche: mehr Stände im großen Raum, verschiedene Berufe', () => {
    const rt = catalog.roomType('fn_villager_hall');
    const stalls = (w: number, d: number, seed: number): { booths: number; stands: number; jobs: number } => {
      const r = furnishRoom(shellRoom(w, d, { inner: ['north', 'east'], doorSide: 'west', doorAt: 1, height: 4 }), rt, catalog, { seed, dataVersion: DV });
      const mine = r.placements.filter((p) => catalog.get(p.componentId).tags.includes('fn_trade_booth'));
      const jobs = new Set(mine.flatMap((p) => (p.variantId ?? '').split('~')[0]!.split('_').slice(1)));
      return { booths: mine.length, stands: mine.reduce((t, p) => t + ((p.variantId ?? '').startsWith('trio') ? 3 : (p.variantId ?? '').startsWith('pair') ? 2 : 1), 0), jobs: jobs.size };
    };
    const small = Array.from({ length: 4 }, (_, s) => stalls(9, 8, s));
    const big = Array.from({ length: 4 }, (_, s) => stalls(16, 12, s));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(small.map((s) => s.booths))).toBeGreaterThanOrEqual(1);
    expect(mean(big.map((s) => s.stands)), 'große Halle hat mehr Stände').toBeGreaterThan(mean(small.map((s) => s.stands)));
    for (const b of big) expect(b.jobs, 'verschiedene Berufe in der großen Halle').toBeGreaterThanOrEqual(4);
  });

  it('Schlafhalle: mehrere Betten und ein Futterspender', () => {
    const q = furnishRoom(shellRoom(12, 9, { height: 4, windowSpacing: 4 }), catalog.roomType('fn_villager_quarters'), catalog, { seed: 1, dataVersion: DV });
    const ids = q.placements.map((p) => p.componentId);
    expect(ids).toContain('functional/fn_mob_feed_trough');
    expect(ids.filter((i) => i === 'bed/fn_villager_bed').length).toBeGreaterThanOrEqual(1);
  });
});

// ================================================================ End-to-End

function singleRoom(version: keyof typeof TARGET_VERSIONS, type: string, w: number, d: number, seed: number, height: number, themeId = 'medieval'): Project {
  const p = Project.create({ id: 'fn', name: 'FN', seed, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  return p;
}

function checkGenerated(p: Project, label: string): void {
  const world = generate(p, ctx);
  const room = p.state.rooms[0]!;
  const info = world.shell.rooms.get(room.id)!;
  const placed = p.state.placements.filter((x) => x.roomId === room.id).map((x) => placedFor(x, ctx.catalog));
  const where = `${label}\n${renderAscii(info, placed, (id) => ctx.catalog.get(id).tags)}`;
  expect(world.warnings, where).toEqual([]);
  const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
  expect(hard, `${where}\n${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
  expect(world.materialized.light.darkCells, where).toEqual([]);
  assertWorld(new WorldView(world.materialized.volume, ctx.platform(p.state.targetVersion.name)), where);
}

describe('FN End-to-End: Einrichtung → Licht-Pass → Materialisierung (0 Warnungen, 0 Verstöße, 0 Spawn-Zellen)', () => {
  for (const type of FN_TYPES) {
    it(`${type}: 2 Größen × lichte Höhe 3/4/5/6 (1.21.11), 26.3 × alle Themes`, { timeout: HEAVY_TIMEOUT }, () => {
      const rt = ctx.catalog.roomType(type);
      for (const [w, d] of [smallest(rt), [12, 9] as const]) {
        for (const H of [3, 4, 5, 6]) checkGenerated(singleRoom('1.21.11', type, w, d, H, H), `${type} ${w}×${d} H${H}`);
      }
      for (const theme of ctx.themes.ids()) checkGenerated(singleRoom('26.3', type, 12, 9, 7, 4, theme), `${type} 26.3 ${theme}`);
    });
  }
});

// ================================================================ Mechanik an der Komponente

describe('FN: Handelsbude (Maße, Arbeitsblock, keine Flucht je Stand, Berufe)', () => {
  const def = catalog.get('trade/fn_trade_booth');
  for (const H of [2, 3, 4, 5, 6]) {
    it(`Stand-Geometrie bei lichter Höhe ${H} für alle Varianten`, () => {
      const { shell, geom } = shellOf(H);
      for (const base of def.variants!.map((v) => v.id)) {
        const placed = northWallPose(def, new RoomPlanner(geom).adapt(def, base), geom);
        for (const version of VERSIONS) {
          const where = `${base} H${H} ${version}`;
          const { r, view } = materializeParts(shell, [placed], version);
          expect(r.violations.filter((v) => v.kind !== 'spawn'), where).toEqual([]);
          const spots = r.volume.cellsOf('c0').filter((c) => c.state.name === 'torch').map((c) => c.pos); // Villager-Plätze
          expect(spots.length, where).toBe(base.startsWith('solo') ? 1 : base.startsWith('pair') ? 2 : 3);
          for (const v of spots) {
            expect(view.face(add(v, 'down'), 'up'), where).toBe('full');
            expect(view.info(v).phys.cls, where).toBe('thin');
            expect(view.info(add(v, 'up')).phys.cls, where).toBe('air');
            expect(collisionBottom(view, add(v, 'up', 2)), `${where}: Decke über dem Platz`).toBe(0);
            for (const d of ['west', 'east', 'north'] as const) {
              expect(view.info(d === 'north' ? add(v, d) : add(v, d)).phys.cls, `${where}: ${d} Fuß`).toBe('full');
              expect(view.info(add(add(v, d), 'up')).phys.cls, `${where}: ${d} Kopf (Zaun, kein Vollblock)`).toMatch(/^(full|tall)$/);
            }
            const j = add(v, 'south');
            expect(Object.keys(JOB_BLOCKS), `${where}: Arbeitsblock`).toContain(view.state(j).name);
            expect(view.info(add(j, 'up')).phys.cls, where).toBe('air');
            expect(collisionBottom(view, add(j, 'up', 2)), `${where}: Decke über dem Arbeitsblock`).toBe(0);
            expect(2 - view.info(j).phys.h, `${where}: Villager (1,95) darf nicht aufsteigen`).toBeLessThan(1.95);
            for (const d of ['west', 'east'] as const) {
              for (const dy of [0, 1]) expect(view.info(add(add(j, d), 'up', dy)).phys.cls, `${where}: Ecke ${d} +${dy}`).not.toMatch(/^(air|thin|flat)$/);
            }
            expect(r.light.darkCells.some((c) => key3(c.pos) === key3(v)), where).toBe(false);
          }
          const jobs = spots.map((v) => view.state(add(v, 'south')).name);
          expect(new Set(jobs).size, `${where}: verschiedene Berufe`).toBe(jobs.length);
        }
      }
    });
  }
});

describe('FN: Heilzelle mit Eisentür (Ausbruchsicherheit)', () => {
  const def = catalog.get('functional/fn_mob_cure_cell');
  for (const H of [2, 3, 4, 6]) {
    it(`lichte Höhe ${H}: Zelle 1 × 2 hoch, Dach, Eisentür zu, Knöpfe nur außen, Gitterfenster`, () => {
      const { shell, geom } = shellOf(H);
      const placed = northWallPose(def, new RoomPlanner(geom).adapt(def, H >= 3 ? 'full' : 'low'), geom);
      for (const version of VERSIONS) {
        const where = `H${H} ${version}`;
        const { r, view } = materializeParts(shell, [placed], version);
        expect(r.violations.filter((v) => v.kind !== 'spawn'), where).toEqual([]);
        const v = r.volume.cellsOf('c0').find((c) => c.state.name === 'soul_torch')!.pos;
        expect(view.info(add(v, 'up')).phys.cls, where).toBe('air');
        expect(collisionBottom(view, add(v, 'up', 2)), `${where}: Dach über der Zelle`).toBe(0);
        for (const d of ['west', 'east'] as const) {
          expect(view.info(add(v, d)).phys.cls, where).toBe('full');
          expect(view.state(add(add(v, d), 'up')).name, `${where}: Fenster ${d}`).toMatch(/_bars$/);
        }
        for (const dy of [0, 1]) expect(view.info(add(add(v, 'north'), 'up', dy)).phys.cls, where).toBe('full');
        const lower = add(v, 'south');
        expect(view.state(lower).name, where).toBe('iron_door');
        expect(view.state(lower).properties['open'], where).toBe('false');
        expect(view.state(add(lower, 'up')).name, where).toBe('iron_door');
        expect(view.state(add(lower, 'up')).properties['open'], where).toBe('false');
        const buttons = r.volume.cellsOf('c0').filter((c) => c.state.name === 'stone_button');
        expect(buttons, where).toHaveLength(2);
        for (const b of buttons) {
          expect(b.pos[2], `${where}: Knopf außen (vor der Tür)`).toBe(lower[2] + 1);
          expect(b.state.properties['face'], where).toBe('wall');
        }
        expect(r.light.darkCells.some((c) => key3(c.pos) === key3(v)), where).toBe(false);
      }
    });
  }
});

describe('FN: Villager-Bettreihe (Betten frei, Zugang, Laterne)', () => {
  const def = catalog.get('bed/fn_villager_bed');
  it('lichte Höhe 2–5: Bettanzahl, Luft über den Betten, Fußende frei', () => {
    for (const [base, beds] of [['single', 2], ['pair', 4], ['trio', 6]] as const) {
      for (const H of [2, 3, 5]) {
        const { shell, geom } = shellOf(H);
        const placed = northWallPose(def, base, geom);
        for (const version of VERSIONS) {
          const { r, view } = materializeParts(shell, [placed], version);
          expect(r.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
          const bedCells = r.volume.cellsOf('c0').filter((c) => c.state.name.endsWith('_bed'));
          expect(bedCells).toHaveLength(beds);
          for (const b of bedCells) expect(view.info(add(b.pos, 'up')).phys.cls, 'Luft über dem Bett').not.toBe('full');
          const foot = bedCells.filter((c) => c.state.properties['part'] === 'foot');
          for (const f of foot) expect(['air', 'thin', 'flat'], 'Zugang am Fußende').toContain(view.info(add(f.pos, 'south')).phys.cls);
          assertWorld(view, `${base} H${H} ${version}`);
        }
      }
    }
  });
});

describe('FN: Futterspender (Dropper nach vorn, Knopf oben)', () => {
  const def = catalog.get('functional/fn_mob_feed_trough');
  it('Dropper blickt in den Raum, trägt oben einen Steinknopf (Boden-Knopf); breit: Laternen stehen auf Zaunpfosten', () => {
    for (const variant of ['narrow', 'wide']) {
      for (const H of [2, 3, 5]) {
        const { shell, geom } = shellOf(H);
        const placed = northWallPose(def, variant, geom);
        for (const version of VERSIONS) {
          const { r, view } = materializeParts(shell, [placed], version);
          expect(r.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
          const d = r.volume.cellsOf('c0').find((c) => c.state.name === 'dropper')!;
          expect(d.state.properties['facing'], 'wirft nach vorn (Süden)').toBe('south');
          expect(view.state(add(d.pos, 'up')).name).toBe('stone_button');
          expect(view.state(add(d.pos, 'up')).properties['face']).toBe('floor');
          expect(view.info(add(d.pos, 'south')).phys.cls, 'Wurf-Zelle vor dem Dropper frei').toMatch(/^(air|thin|flat)$/);
          const lanterns = r.volume.cellsOf('c0').filter((c) => c.state.name === 'lantern');
          expect(lanterns).toHaveLength(variant === 'wide' ? 2 : 0);
          for (const l of lanterns) expect(l.state.properties['hanging']).toBe('false');
        }
      }
    }
  });
});

describe('FN: Spawner-Käfig (leer, Fackel, Gitter)', () => {
  const def = catalog.get('decor/fn_mob_spawner_cage');
  it('Spawner in der Mitte, Fackel darauf, Gitter ringsum in allen Höhenvarianten (flach 2, niedrig 3, hoch ab 4)', () => {
    for (const H of [2, 3, 4, 6]) {
      const { shell, geom } = shellOf(H);
      const planner = new RoomPlanner(geom);
      const variant = H >= 4 ? 'tall' : H === 3 ? 'low' : 'flat';
      const poses = planner.poses(def, planner.adapt(def, variant));
      expect(poses.length, `H${H}`).toBeGreaterThan(0);
      for (const version of VERSIONS) {
        const { r, view } = materializeParts(shell, [poses[0]!], version);
        expect(r.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
        const s = r.volume.cellsOf('c0').filter((c) => c.state.name === 'spawner');
        expect(s, `H${H}: genau ein Spawner`).toHaveLength(1);
        expect(view.state(add(s[0]!.pos, 'up')).name, 'Fackel auf dem Spawner').toBe('torch');
        for (const d of ['north', 'south', 'west', 'east'] as const) expect(view.state(add(s[0]!.pos, d)).name, `Gitter ${d}`).toMatch(/_bars$/);
        expect(r.volume.entitiesOf('c0').length).toBe(0);
      }
    }
  });
});

// ================================================================ jede Komponente × Variante × Höhe

describe('FN: jede Komponente × Variante materialisiert in passenden Höhen (1.21.11 + 26.3, Themes)', () => {
  const HEIGHTS = [2, 3, 4, 5, 6, 8];
  for (const id of FN_COMPONENTS) {
    it(id, { timeout: HEAVY_TIMEOUT }, () => {
      const def = catalog.get(id);
      let tested = 0;
      for (const base of def.variants?.map((v) => v.id) ?? [undefined]) {
        const heights = HEIGHTS.filter((H) => {
          const size = expandComponent(def, new RoomPlanner(shellOf(H).geom).adapt(def, base)).size[1];
          return fitsRoomHeight(def, base, H) && size <= H && (def.mount !== 'ceiling' || H - size >= 2);
        });
        expect(heights.length, `${id}#${base}: keine passende Höhe`).toBeGreaterThan(0);
        heights.forEach((H, i) => {
          const { shell, geom } = shellOf(H);
          const planner = new RoomPlanner(geom);
          const placed = planner.poses(def, planner.adapt(def, base))[0];
          expect(placed, `${id}#${base} H${H}: keine gültige Pose`).toBeDefined();
          for (const version of VERSIONS) {
            for (const themeId of i === 0 ? ctx.themes.ids() : ['medieval']) {
              const where = `${id}#${base ?? ''} H${H} ${themeId} ${version}`;
              const { r, view } = materializeParts(shell, [placed!], version, themeId);
              const hard = r.violations.filter((v) => v.kind !== 'spawn');
              expect(hard, `${where}: ${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
              expect(r.volume.cellsOf('c0').length, where).toBe(placed!.cells.length);
              expect(r.volume.entitiesOf('c0').length, where).toBe(placed!.entities.length);
              assertWorld(view, where);
            }
          }
          tested++;
        });
      }
      expect(tested).toBeGreaterThan(0);
    });
  }
});
