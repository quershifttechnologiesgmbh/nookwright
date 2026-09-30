/**
 * K3b – Raumtypen Handwerk, Vorrat, Wehr & Handel (research/17 §4.14–4.25, §6.1): Weberei, Tischlerei, Töpferei,
 * Bäckerei, Metzgerei, Brauhaus, Weinkeller, Kaserne, Waffenkammer, Schatzkammer, Handelshalle, Portalraum,
 * Methalle. Geprüft werden
 *  - der Katalog (Komponenten, Tags nach research/17 §7.2, functionTag `villager_workstation` an Arbeitsblöcken),
 *  - der Solver: jeder Raumtyp × 3 Größen × lichte Höhe 3/4/5 × 3 Seeds → Signatur und Pflicht erfüllt,
 *    0 Kollisionen, keine Taschen, Qualität > Schwelle, deterministisch; Portal ab lichter Höhe 5,
 *  - End-to-End über `@mcda/pipeline` (Einrichtung → Licht-Pass → Materialisierung): 0 Warnungen, 0 Physik-
 *    Verstöße, 0 Spawn-Zellen, Truhen/Betten frei, Rahmen an vollen Blöcken,
 *  - die Spielmechanik direkt an der materialisierten Komponente: Portalrahmen gültig und unentzündet mit
 *    Ankunftsfläche, Villager-Stand (Maße, Arbeitsblock, keine Flucht, 13 verschiedene Berufe), Heilstation,
 *    Etagenbett (Bett auf Bett, nicht erstickend),
 *  - jede neue Komponente × Variante × passende Höhe (2–8, gedehnt) in 1.21.11 + 26.3 × Themes.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type RoomShellInfo, type Shell, type ShellCell } from '@mcda/blueprint';
import { Catalog, evalCount, type ComponentDef, type MaterialSpec, type RoomTypeDef } from '@mcda/catalog';
import { CellSet, key3, type Dir, type Vec3 } from '@mcda/core';
import { WorldView, faceSupport, materialize, type MaterializePlacement } from '@mcda/materialize';
import { generate, placedFor } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { RoomPlanner, expandComponent, fitsRoomHeight, furnishRoom, renderAscii, verticality, type PlacedComponent } from '../src/index.js';
import { DV, assertHardGuarantees, catalog, shellRoom } from './fixtures.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const VERSIONS = ['1.21.11', '26.3'] as const;

const K3B_TYPES = [
  'weaving_room', 'carpentry', 'pottery', 'bakery', 'butchery', 'brewhouse', 'wine_cellar',
  'barracks', 'armory', 'treasury', 'trading_hall', 'portal_room', 'mead_hall',
] as const;

const K3B_COMPONENTS = [
  'work/loom', 'work/cloth_shelf', 'work/spinning_wheel', 'table/cutting_table', 'work/saw_bench', 'storage/lumber_stack',
  'work/pottery_kiln', 'work/potters_wheel', 'storage/pot_rack', 'work/bread_oven', 'table/bread_counter', 'decor/hanging_carcass',
  'work/brew_vat', 'storage/wine_rack', 'storage/cask_big', 'bed/bunk_bed', 'work/fletcher_bench', 'treasure/gold_hoard',
  'storage/strongbox', 'trade/villager_stall', 'trade/cure_station', 'portal/nether_portal_frame', 'portal/portal_shrine',
  'nordic/fire_pit', 'nordic/fur_platform', 'decor/armor_bay',
] as const;

/** Arbeitsblöcke der 13 Berufe (Faktencheck #7). */
const JOB_BLOCKS: Readonly<Record<string, string>> = {
  blast_furnace: 'armorer', smoker: 'butcher', cartography_table: 'cartographer', brewing_stand: 'cleric', composter: 'farmer',
  barrel: 'fisherman', fletching_table: 'fletcher', cauldron: 'leatherworker', water_cauldron: 'leatherworker', lectern: 'librarian',
  stonecutter: 'mason', loom: 'shepherd', smithing_table: 'toolsmith', grindstone: 'weaponsmith',
};

/** research/17 §7.2: bewusst NICHT vergebene Tags (dazu eigene Abgrenzungen, siehe Komponenten-Kommentare). */
const FORBIDDEN_TAGS = ['rug', 'sink', 'desk', 'counter', 'bookshelf_wall', 'bed_single', 'table', 'wall_bench'];

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
  return ([[7, 6], [8, 7], [9, 8], [10, 8]] as const).find(([w, d]) => (w - 2) * (d - 2) >= rt.minArea) ?? [10, 8];
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

describe('K3b: Katalog (Komponenten, Tags, Raumtypen)', () => {
  it('alle neuen Komponenten und Raumtypen sind geladen, jeder Raumtyp-Tag hat Komponenten', () => {
    for (const id of K3B_COMPONENTS) expect(catalog.find(id), id).toBeDefined();
    for (const t of K3B_TYPES) {
      expect(catalog.roomTypeIds(), t).toContain(t);
      expect(catalog.missingTags(t, DV), t).toEqual([]);
      expect(signatureTags(catalog.roomType(t)).length, `${t}: Signatur`).toBeGreaterThan(0);
    }
  });

  it('bewusst nicht vergebene Tags (research/17 §7.2) fehlen; Arbeitsblöcke tragen `villager_workstation`', () => {
    for (const id of K3B_COMPONENTS) {
      const def = catalog.get(id);
      for (const t of FORBIDDEN_TAGS) expect(def.tags, `${id}: Tag ${t}`).not.toContain(t);
      const jobs = materialsOf(def).map((m) => blockName(m.block)).filter((b): b is string => b !== undefined && b in JOB_BLOCKS);
      if (jobs.length > 0) expect(def.functionTags ?? [], `${id} (${jobs.join(', ')})`).toContain('villager_workstation');
    }
    expect(catalog.get('storage/lumber_stack').tags).not.toContain('goods');
    expect(catalog.get('storage/pot_rack').tags).not.toContain('pottery');
    expect(catalog.get('trade/villager_stall').functionTags).toEqual(expect.arrayContaining(['trade', 'villager_workstation']));
    expect(catalog.get('portal/nether_portal_frame').functionTags).toContain('portal');
  });

  it('keine Wasser-Varianten (Wasser im Falltür-Ring ungeprüft, research/17 T11), kein entzündetes Portal', () => {
    for (const id of K3B_COMPONENTS) {
      const blocks = materialsOf(catalog.get(id)).map((m) => blockName(m.block));
      expect(blocks, id).not.toContain('water');
      expect(blocks, id).not.toContain('nether_portal');
      expect(blocks, id).not.toContain('lava');
    }
  });
});

// ================================================================ Solver

describe('K3b: Solver – Raumtyp × 3 Größen × lichte Höhe 3/4/5 × 3 Seeds', () => {
  for (const type of K3B_TYPES) {
    it(`${type}: Signatur + Pflicht, 0 Kollisionen, keine Taschen, Qualität > ${MIN_QUALITY}, deterministisch`, { timeout: HEAVY_TIMEOUT }, () => {
      const rt = catalog.roomType(type);
      const [sw, sd] = smallest(rt);
      const rooms = (H: number) => [
        { ...shellRoom(sw, sd, { height: H }), roomId: `${sw}x${sd}` }, // Fenster alle 3 Zellen: ungünstigster Fall
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
              expect(again.quality).toEqual(r.quality);
            }
          }
        }
      }
      expect(q / n).toBeGreaterThan(0.75);
    });
  }

  it('Portalraum: ab lichter Höhe 5 steht ein echtes Portal, darunter der Portal-Schrein', () => {
    const rt = catalog.roomType('portal_room');
    for (const H of [3, 4, 5, 6]) {
      for (const [w, d] of [[10, 8], [12, 9]] as const) {
        for (let seed = 0; seed < 3; seed++) {
          const r = furnishRoom(shellRoom(w, d, { height: H, windowSpacing: 4 }), rt, catalog, { seed, dataVersion: DV });
          const ids = r.placements.map((p) => p.componentId);
          expect(ids, `H${H} ${w}×${d} seed ${seed}`).toContain(H >= 5 ? 'portal/nether_portal_frame' : 'portal/portal_shrine');
        }
      }
    }
  });

  it('Handelshalle: mehrere Stände in Reihe, Rücken zur Wand, mit verschiedenen Berufen je Raum überwiegend', () => {
    const rt = catalog.roomType('trading_hall');
    const measure = (cat: Catalog): { n: number; jobs: number }[] =>
      Array.from({ length: 6 }, (_, seed) => {
        const r = furnishRoom(shellRoom(14, 10, { inner: ['north', 'east'], doorSide: 'west', doorAt: 1, height: 4 }), rt, cat, { seed, dataVersion: DV });
        const mine = r.placements.filter((p) => cat.get(p.componentId).tags.includes('villager_stall'));
        return { n: mine.length, jobs: new Set(mine.map((p) => p.variantId?.split('~')[0])).size };
      });
    // (a) Die klassische Reihe (nur trade/villager_stall) hält die V3-Kennzahl: ≥ 3 Stände je Raum, im Mittel ≥ 4.
    const onlyVillager = measure(Catalog.of([catalog.get('trade/villager_stall')], [rt]));
    for (const [i, m] of onlyVillager.entries()) expect(m.n, `villager_stall seed ${i}`).toBeGreaterThanOrEqual(3);
    expect(onlyVillager.reduce((t, m) => t + m.n, 0) / onlyVillager.length).toBeGreaterThanOrEqual(4);
    // (b) Q1a: seit `trade/market_stall_food` tragen ZWEI Stand-Formen den Tag `villager_stall`. Im vollen Katalog
    // zählt die Prüfung alle Stände über den Tag; je Raum bleiben ≥ 3 Stände und ≥ 3 verschiedene Berufe.
    const both = measure(catalog);
    for (const [i, m] of both.entries()) {
      expect(m.n, `seed ${i}`).toBeGreaterThanOrEqual(3);
      expect(m.jobs, `seed ${i}: verschiedene Berufe`).toBeGreaterThanOrEqual(3);
    }
  });
});

// ================================================================ End-to-End

function singleRoom(version: keyof typeof TARGET_VERSIONS, type: string, w: number, d: number, seed: number, height: number, themeId = 'medieval'): Project {
  const p = Project.create({ id: 'k3b', name: 'K3b', seed, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  return p;
}

function checkGenerated(p: Project, label: string): { above: number; ratio: number } {
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
  const v = verticality(placed, info);
  return { above: v.above, ratio: v.ratio };
}

describe('K3b End-to-End: Einrichtung → Licht-Pass → Materialisierung (0 Warnungen, 0 Verstöße, 0 Spawn-Zellen)', () => {
  const vertical = new Map<string, { above: number; ratio: number; n: number }>();
  for (const type of K3B_TYPES) {
    it(`${type}: 2 Größen × lichte Höhe 3/4/5/6 (1.21.11), 26.3 × alle Themes`, { timeout: HEAVY_TIMEOUT }, () => {
      const rt = ctx.catalog.roomType(type);
      const st = { above: 0, ratio: 0, n: 0 };
      for (const [w, d] of [smallest(rt), [12, 9] as const]) {
        for (const H of [3, 4, 5, 6]) {
          const v = checkGenerated(singleRoom('1.21.11', type, w, d, H, H), `${type} ${w}×${d} H${H}`);
          st.above += v.above;
          st.ratio += v.ratio;
          st.n++;
        }
      }
      for (const theme of ctx.themes.ids()) checkGenerated(singleRoom('26.3', type, 12, 9, 7, 4, theme), `${type} 26.3 ${theme}`);
      vertical.set(type, st);
      // mehr in die Höhe: jeder Raumtyp nutzt fast alle Höhenebenen. W8-B (2026-09-27): die Tischlerei 7 × 6 (Innen 5 × 4)
      // verliert mit der Regel `useAccess` in H4/H5 ein Deko-Stück (vorher stand es an einer 4 Zellen tiefen Sackgasse
      // entlang der Wand); gemessen 0,877 statt 0,91 – dort gilt 0,85 (plan/spikes/W8B_wege_im_raum.md)
      expect(st.ratio / st.n, `${type}: Anteil genutzter Höhenebenen`).toBeGreaterThan(type === 'carpentry' ? 0.85 : 0.9);
    });
  }
});

// ================================================================ Mechanik an der Komponente

describe('K3b: Portalrahmen-Geometrie (materialisiert, unentzündet, Ankunftsfläche)', () => {
  const def = catalog.get('portal/nether_portal_frame');
  for (const base of def.variants!.map((v) => v.id)) {
    for (const H of [5, 6, 8]) {
      it(`${base} bei lichter Höhe ${H}`, () => {
        const { shell, geom } = shellOf(H);
        const planner = new RoomPlanner(geom);
        const variantId = planner.adapt(def, base);
        const placed = northWallPose(def, variantId, geom);
        for (const version of VERSIONS) {
          const { r, view } = materializeParts(shell, [placed], version);
          expect(r.violations.filter((v) => v.kind !== 'spawn'), version).toEqual([]);
          const obsidian = r.volume.cellsOf('c0').filter((c) => c.state.name === 'obsidian').map((c) => c.pos);
          const xs = obsidian.map((p) => p[0]), ys = obsidian.map((p) => p[1]), zs = new Set(obsidian.map((p) => p[2]));
          expect(zs.size, 'Rahmen liegt in einer Ebene').toBe(1);
          const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
          const z = [...zs][0]!;
          // Innenmaß 2 × 3 (Minimum 2 × 3, Rahmen 4 × 5), Rahmen vollständig (Ecken inklusive)
          expect([x1 - x0 + 1, y1 - y0 + 1]).toEqual([4, 5]);
          const key = new Set(obsidian.map(key3));
          for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
              const edge = x === x0 || x === x1 || y === y0 || y === y1;
              if (edge) expect(key.has(key3([x, y, z])), `Rahmenblock ${x},${y},${z}`).toBe(true);
              else expect(view.state([x, y, z]).name, `Portal-Innenraum ${x},${y},${z} ist Luft (unentzündet)`).toBe('air');
            }
          }
          expect(y0, 'Schwelle auf dem Boden').toBe(geom.baseY);
          // Ankunftsfläche: 2 Zellen vor der Öffnung begehbar (flach, Kopf frei, fester Boden)
          for (let x = x0 + 1; x < x1; x++) {
            for (const dz of [1, 2]) {
              const feet: Vec3 = [x, geom.baseY, z + dz];
              expect(['air', 'thin', 'flat'], `Ankunft ${feet.join(',')}`).toContain(view.info(feet).phys.cls);
              expect(['air', 'thin'], `Kopf ${feet.join(',')}`).toContain(view.info(add(feet, 'up')).phys.cls);
              expect(view.face(add(feet, 'down'), 'up')).toBe('full');
            }
          }
          // Feuerzeug im Rahmen zum Selbst-Entzünden
          const items = r.volume.entitiesOf('c0').map((e) => JSON.stringify(e.nbt.value['Item'] ?? ''));
          expect(items.join(), 'Feuerzeug im Rahmen').toContain('flint_and_steel');
          assertWorld(view, `${base} H${H} ${version}`);
        }
      });
    }
  }
});

describe('K3b: Villager-Stand (Maße, Arbeitsblock, keine Flucht, 13 Berufe)', () => {
  const def = catalog.get('trade/villager_stall');
  it('13 Varianten mit 13 verschiedenen Arbeitsblöcken (alle Berufe)', () => {
    const jobs = def.variants!.map((v) => blockName(v.legend!['J']!.block)!);
    expect(new Set(jobs).size).toBe(13);
    expect(new Set(jobs.map((j) => JOB_BLOCKS[j]))).toEqual(new Set(Object.values(JOB_BLOCKS)));
  });

  // Alle Höhen 2–6: die Stand-Decke auf +2 hält den Villager (Ingame G2: ohne sie entkommen 13/13)
  for (const H of [2, 3, 4, 5, 6]) {
    it(`Stand-Geometrie bei lichter Höhe ${H} für alle Berufe`, () => {
      const { shell, geom } = shellOf(H);
      for (const base of def.variants!.map((v) => v.id)) {
        const placed = northWallPose(def, new RoomPlanner(geom).adapt(def, base), geom);
        for (const version of VERSIONS) {
          const where = `${base} H${H} ${version}`;
          const { r, view } = materializeParts(shell, [placed], version);
          expect(r.violations.filter((v) => v.kind !== 'spawn'), where).toEqual([]);
          const v = r.volume.cellsOf('c0').find((c) => c.state.name === 'torch')!.pos; // Villager-Platz
          // 2,0 frei (Villager 1,95): Füße kollisionsfrei, Kopf Luft, darüber Decke mit Unterkante bei genau 2,0
          expect(view.face(add(v, 'down'), 'up'), where).toBe('full');
          expect(view.info(v).phys.cls, where).toBe('thin');
          expect(view.info(add(v, 'up')).phys.cls, where).toBe('air');
          expect(collisionBottom(view, add(v, 'up', 2)), `${where}: Decke über dem Platz`).toBe(0);
          // Seiten und Rücken geschlossen (Pfosten, Raumwand) auf Fuß- und Kopfhöhe
          for (const d of ['west', 'east', 'north'] as const) {
            for (const dy of [0, 1]) expect(view.info(add(add(v, d), 'up', dy)).phys.cls, `${where}: ${d} +${dy}`).toBe('full');
          }
          // Arbeitsblock vorn auf Fußhöhe (Nachbarfeld → erreichbar), darüber Luft zum Handeln, Decke bei 2,0
          const j = add(v, 'south');
          const job = view.state(j).name;
          expect(Object.keys(JOB_BLOCKS), `${where}: Arbeitsblock`).toContain(job);
          expect(view.info(add(j, 'up')).phys.cls, where).toBe('air');
          expect(collisionBottom(view, add(j, 'up', 2)), `${where}: Decke über dem Arbeitsblock`).toBe(0);
          const free = 2 - view.info(j).phys.h;
          expect(free, `${where}: über dem Arbeitsblock nur ${free} frei → Villager (1,95) kann nicht aufsteigen`).toBeLessThan(1.95);
          // keine Diagonale: die vorderen Ecken sind auf Fuß- und Kopfhöhe belegt
          for (const d of ['west', 'east'] as const) {
            for (const dy of [0, 1]) expect(view.info(add(add(j, d), 'up', dy)).phys.cls, `${where}: Ecke ${d} +${dy}`).not.toMatch(/^(air|thin|flat)$/);
          }
          // Fackel leuchtet im Stand (Licht 14) – kein Spawn im Villager-Platz
          expect(r.light.darkCells.some((c) => key3(c.pos) === key3(v)), where).toBe(false);
        }
      }
    });
  }

  it('Heilstation: gleiche Zellen-Maße, Gitter vorn auf Fußhöhe, darüber offen, Decke bei 2,0', () => {
    const cure = catalog.get('trade/cure_station');
    for (const H of [2, 3, 4]) {
      const { shell, geom } = shellOf(H);
      const placed = northWallPose(cure, new RoomPlanner(geom).adapt(cure), geom);
      for (const version of VERSIONS) {
        const { r, view } = materializeParts(shell, [placed], version);
        expect(r.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
        const v = r.volume.cellsOf('c0').find((c) => c.state.name === 'soul_torch')!.pos;
        expect(view.info(add(v, 'up')).phys.cls).toBe('air');
        expect(collisionBottom(view, add(v, 'up', 2))).toBe(0);
        const front = add(v, 'south');
        expect(view.state(front).name).toMatch(/_bars$/);
        expect(view.info(add(front, 'up')).phys.cls).toBe('air');
        expect(collisionBottom(view, add(front, 'up', 2))).toBe(0);
        for (const d of ['west', 'east', 'north'] as const) for (const dy of [0, 1]) expect(view.info(add(add(v, d), 'up', dy)).phys.cls).toBe('full');
      }
    }
  });
});

describe('K3b: Etagenbett (Bett direkt auf Bett, nicht erstickend, Spind frei)', () => {
  it('lichte Höhe 3–5: oberes Bett gleich ausgerichtet über dem unteren, darüber Luft, Truhe öffnet', () => {
    const def = catalog.get('bed/bunk_bed');
    expect(fitsRoomHeight(def, 'stacked', 2), 'bei lichter Höhe 2 die Pritsche').toBe(false);
    expect(fitsRoomHeight(def, 'cot', 2)).toBe(true);
    for (const [base, H] of [['stacked', 3], ['stacked', 5], ['shelf', 4], ['shelf', 6]] as const) {
      const { shell, geom } = shellOf(H);
      const placed = northWallPose(def, base, geom);
      for (const version of VERSIONS) {
        const { r, view } = materializeParts(shell, [placed], version);
        expect(r.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
        const beds = r.volume.cellsOf('c0').filter((c) => c.state.name.endsWith('_bed'));
        expect(beds).toHaveLength(4);
        for (const b of beds.filter((c) => c.pos[1] === geom.baseY)) {
          const up = view.state(add(b.pos, 'up'));
          expect(up.name, 'Bett auf Bett (Vanilla BedBlock#isBunkBed)').toBe(b.state.name);
          expect(up.properties).toEqual(b.state.properties);
          expect(view.info(add(b.pos, 'up', 2)).phys.cls, 'über dem oberen Bett Luft').toBe('air');
        }
        const chest = r.volume.cellsOf('c0').find((c) => c.state.name === 'chest')!;
        expect(view.info(add(chest.pos, 'up')).phys.cls).toBe('air');
        // Aufwachplatz links neben dem unteren Kopfteil frei
        const head = beds.find((c) => c.pos[1] === geom.baseY && c.state.properties['part'] === 'head')!;
        expect(['air', 'thin'], 'Aufwachplatz').toContain(view.info(add(head.pos, 'east')).phys.cls);
      }
    }
  });
});

// ================================================================ jede Komponente × Variante × Höhe

describe('K3b: jede neue Komponente × Variante materialisiert in passenden Höhen (1.21.11 + 26.3, Themes)', () => {
  const HEIGHTS = [2, 3, 4, 5, 6, 8];
  for (const id of K3B_COMPONENTS) {
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
