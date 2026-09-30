/**
 * K3d (Innen-Tricks und offene Raumtypen; research/16 §6/§8, research/11 §3/§6/§7/§9–§11, research/17 §5):
 *  - Katalog: neue Komponenten (Sofa, Kamin mit Sims, Säule, Deckenkassette, Bettnische, Hochbett, Raumteiler,
 *    Falltür-Bilderrahmen/-Kronleuchter/-Paneele, Spüle, Thron/Podest, Tafeln, Kerker, Karten, Gewächshaus,
 *    Verzauberung) und Varianten an bestehenden (Oberschrank, Kommode, Einzelbett, Ofenzeile) sind geladen und
 *    erreichbar.
 *  - Solver: jeder neue Raumtyp × 3 Größen (minArea … groß) × lichte Höhe 3/4/5 × 3 Seeds → Signatur und Pflicht
 *    platziert, 0 Warnungen, harte Garantien (0 Kollisionen, 0 Taschen, Tür frei, Kopffreiheit), Qualität > 0,5,
 *    deterministisch; dazu lichte Höhe 2 und 6 und die Vertikalität.
 *  - Materialisierung (Testhelfer `@mcda/pipeline`): jede neue/erweiterte Komponente in passender Höhe (gedehnt) in
 *    1.21.11 + 26.3 × Themes ohne Verstöße; Mechanik: Falltüren liegen an, Ecksofa-Treppe `inner_*`, Kerker-Knopf
 *    außen am Türpfeiler, kein offenes Feuer auf Laufhöhe neben freiem Boden, versteckte Lichter allseitig verdeckt
 *    und heller als vorher.
 *  - End-to-End (Einrichtung → Licht-Pass → Materialisierung): 0 Warnungen, 0 Verstöße, 0 Spawn-Zellen.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type RoomShellInfo, type Shell, type ShellCell } from '@mcda/blueprint';
import { evalCount, type ComponentDef, type RoomTypeDef } from '@mcda/catalog';
import { CellSet, opposite, type Dir, type Vec3 } from '@mcda/core';
import { WorldView, isWalkable, materialize, type MaterializePlacement } from '@mcda/materialize';
import { generate, placedFor } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { RoomPlanner, expandComponent, fitsRoomHeight, furnishRoom, renderAscii, verticality, type FurnishResult, type PlacedComponent, type RoomGeometry } from '../src/index.js';
import { DV, assertHardGuarantees, catalog, shellRoom } from './fixtures.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const VERSIONS = ['1.21.11', '26.3'] as const;

/** Neue Raumtypen K3d → Signatur-Tags (mindestens einer muss platziert sein). */
const K3D_TYPES: Readonly<Record<string, readonly string[]>> = {
  throne_room: ['throne'],
  dining_hall: ['banquet_table'],
  dungeon: ['prison_cell'],
  map_room: ['map_desk', 'cartography_table'],
  greenhouse: ['garden_bed', 'planter'],
  enchanting_tower: ['enchanting_station'],
};

/** Neue Komponenten K3d (research/16 §6/§8 und Raumtypen). */
const K3D_NEW: readonly string[] = [
  'seat/sofa', 'decor/fireplace', 'arch/column', 'light/ceiling_coffer', 'bed/alcove', 'bed/loft', 'decor/room_divider',
  'decor/trapdoor_frame', 'light/trapdoor_chandelier', 'decor/wall_panels', 'work/sink', 'light/brazier', 'seat/throne',
  'arch/throne_dais', 'table/banquet_table', 'table/high_table', 'decor/prison_cell', 'decor/prison_cage', 'decor/hanging_cage',
  'decor/shackles', 'decor/bone_pile', 'light/grim_lantern', 'work/chart_table', 'decor/wall_map', 'decor/floor_map',
  'decor/instrument_frames', 'decor/garden_bed', 'decor/plant_shelf', 'work/potting_bench', 'decor/amethyst_hanging',
  'decor/frame_enchanted_book', 'work/enchanting_nook',
];
/** Bestehende Komponenten mit neuen K3d-Varianten (research/16 I2/I6/I8). */
const K3D_EXTENDED: Readonly<Record<string, readonly string[]>> = {
  'storage/upper_cabinet': ['doors', 'knobs'],
  'storage/wardrobe': ['dresser_knobs'],
  'bed/single': ['headboard', 'gate_headboard'],
  'work/kitchen_stove': ['hood_chimney', 'hopper_hood'],
};

/** Kleinste Außenmaße (fast quadratisch), deren Innenfläche minArea erreicht; dazu mittel und groß. */
function sizesFor(rt: RoomTypeDef): (readonly [number, number])[] {
  const s = Math.ceil(Math.sqrt(rt.minArea));
  const min: [number, number] = [s + 2, Math.ceil(rt.minArea / s) + 2];
  return [min, [12, 9], [14, 11]];
}

const tagsOf = (r: FurnishResult): Set<string> => new Set(r.placements.flatMap((p) => catalog.get(p.componentId).tags));
const ascii = (g: RoomGeometry, r: FurnishResult): string => renderAscii(g, r.placed, (id) => catalog.get(id).tags);

function assertFurnished(g: RoomGeometry, rt: RoomTypeDef, r: FurnishResult, where: string): void {
  const w = `${where}\n${ascii(g, r)}`;
  expect(r.warnings, w).toEqual([]);
  assertHardGuarantees(g, r, where);
  const tags = tagsOf(r);
  expect(K3D_TYPES[rt.id]!.some((t) => tags.has(t)), `${w}\nSignatur fehlt`).toBe(true);
  for (const req of rt.required) {
    const [min] = evalCount(req.count, g.interior.size);
    if (min > 0) expect(req.tags.some((t) => tags.has(t)), `${w}\nPflicht ${req.tags.join('|')} fehlt`).toBe(true);
  }
}

describe('K3d · Katalog', () => {
  it('alle neuen Komponenten und Varianten sind geladen', () => {
    expect(new Set(K3D_NEW).size).toBe(K3D_NEW.length);
    for (const id of K3D_NEW) expect(catalog.find(id), id).toBeDefined();
    for (const [id, vs] of Object.entries(K3D_EXTENDED)) {
      const ids = catalog.get(id).variants?.map((v) => v.id) ?? [];
      expect(ids, id).toEqual(expect.arrayContaining([...vs]));
    }
    for (const type of Object.keys(K3D_TYPES)) expect(catalog.missingTags(type, DV), type).toEqual([]);
  });

  it('jede neue Komponente ist über einen Raumtyp, einen Socket oder den Licht-Pass erreichbar', () => {
    const reachable = new Set<string>();
    for (const id of catalog.roomTypeIds()) {
      const rt = catalog.roomType(id);
      for (const e of [...rt.required, ...rt.optional]) e.tags.forEach((t) => reachable.add(t));
      rt.lighting?.prefer?.forEach((t) => reachable.add(t));
    }
    for (const def of catalog.all()) {
      for (const v of def.variants?.map((x) => x.id) ?? [undefined]) expandComponent(def, v).sockets.forEach((s) => s.accepts.forEach((t) => reachable.add(t)));
    }
    // Sofa (seating_group), Bettnische (bed_single), Spüle (sink): bestehende Wohnräume/Küche ziehen sie bewusst;
    // das Hochbett (loft_bed) ist Baustein für Kinder-/Wachräume (K3a/K3b) und darf noch „nur Katalog“ sein
    const unreachable = K3D_NEW.filter((id) => !catalog.get(id).tags.some((t) => reachable.has(t)));
    expect(unreachable.filter((id) => !['bed/loft'].includes(id))).toEqual([]);
  });

  it('Tags ziehen bewusst: Kerker und Werkstatt bekommen kein Sofa, fremde Räume keine Kassette/kein Feuerbecken', () => {
    const tagsIn = (id: string): Set<string> => new Set([...catalog.roomType(id).required, ...catalog.roomType(id).optional].flatMap((e) => e.tags));
    const sofa = new Set(catalog.get('seat/sofa').tags);
    for (const id of ['dungeon', 'smithy', 'workshop_redstone', 'storage', 'stable', 'farm_room']) expect([...tagsIn(id)].filter((t) => sofa.has(t)), id).toEqual([]);
    for (const id of ['bedroom', 'kitchen', 'farm_room', 'library', 'tavern']) {
      const pulled = [...tagsIn(id), ...(catalog.roomType(id).lighting?.prefer ?? [])];
      expect(pulled.filter((t) => ['light_hidden', 'brazier', 'prison_cell', 'throne'].includes(t)), id).toEqual([]);
    }
  });
});

describe('K3d · Raumtypen einrichten (Solver)', () => {
  for (const type of Object.keys(K3D_TYPES)) {
    it(`${type}: 3 Größen × lichte Höhe 3/4/5 × 3 Seeds – Signatur, 0 Warnungen, harte Garantien, Qualität > 0,5`, { timeout: HEAVY_TIMEOUT }, () => {
      const rt = catalog.roomType(type);
      for (const [w, d] of sizesFor(rt)) {
        for (const H of [3, 4, 5]) {
          for (let seed = 0; seed < 3; seed++) {
            const g = shellRoom(w, d, { height: H, windowSpacing: 4, inner: seed === 2 ? ['north'] : [] });
            expect(g.interior.size).toBeGreaterThanOrEqual(rt.minArea);
            const r = furnishRoom(g, rt, catalog, { seed, dataVersion: DV });
            const where = `${type} ${w}×${d} H${H} seed ${seed}`;
            assertFurnished(g, rt, r, where);
            expect(r.quality.score, `${where}\n${ascii(g, r)}`).toBeGreaterThan(0.5);
          }
        }
      }
    });
  }

  it('lichte Höhe 2 und 6: weiterhin gültig (Kompaktformen bzw. gedehnte Formen)', { timeout: HEAVY_TIMEOUT }, () => {
    for (const type of Object.keys(K3D_TYPES)) {
      const rt = catalog.roomType(type);
      for (const H of [2, 6]) {
        for (const [w, d] of [sizesFor(rt)[0]!, [12, 9] as const]) {
          for (const seed of [0, 1]) {
            const g = shellRoom(w, d, { height: H, windowSpacing: 4 });
            assertFurnished(g, rt, furnishRoom(g, rt, catalog, { seed, dataVersion: DV }), `${type} ${w}×${d} H${H} seed ${seed}`);
          }
        }
      }
    }
  });

  it('Determinismus: gleicher Seed → gleiche Platzierungen und Qualität', () => {
    for (const type of Object.keys(K3D_TYPES)) {
      const g = shellRoom(12, 9, { height: 5, windowSpacing: 4 });
      const a = furnishRoom(g, catalog.roomType(type), catalog, { seed: 7, dataVersion: DV });
      const b = furnishRoom(g, catalog.roomType(type), catalog, { seed: 7, dataVersion: DV });
      expect(a.placements, type).toEqual(b.placements);
      expect(a.quality, type).toEqual(b.quality);
    }
  });

  it('„mehr in die Höhe“: bei lichter Höhe 5 nutzen alle neuen Raumtypen die Wand- und Deckenzone', () => {
    for (const type of Object.keys(K3D_TYPES)) {
      let above = 0;
      let ratio = 0;
      let n = 0;
      for (const [w, d] of [[10, 8], [12, 9], [14, 11]] as const) {
        for (const seed of [0, 1, 2]) {
          const g = shellRoom(w, d, { height: 5, windowSpacing: 4 });
          const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
          const v = verticality(r.placed, g);
          above += v.above;
          ratio += v.ratio;
          n++;
        }
      }
      expect(above / n, `${type}: Blöcke über Kopfhöhe je Raum`).toBeGreaterThan(15);
      expect(ratio / n, `${type}: Anteil genutzter Höhenebenen`).toBeGreaterThan(0.9);
    }
  });

  it('Thronsaal: Mittelgang frei (nur Thron als Blickpunkt, Läufer), Thron in der türfernen Hälfte, Rücken zur Wand', () => {
    let atHead = 0;
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const g = shellRoom(11, 14, { height: 5, windowSpacing: 4 });
      const r = furnishRoom(g, catalog.roomType('throne_room'), catalog, { seed, dataVersion: DV });
      const where = `seed ${seed}
${ascii(g, r)}`;
      const throne = r.placed.find((p) => catalog.get(p.expanded.defId).tags.includes('throne'))!;
      // Tür im Süden (z = 11), lange Achse z → Gang x 3..5, Stirnseite Norden
      expect(Math.min(...throne.cells.map((c) => c.pos[2])), where).toBeLessThan(6);
      const aisle = (x: number): boolean => x >= 3 && x <= 5;
      const inAisle = throne.cells.some((c) => aisle(c.pos[0]) && c.pos[1] <= g.baseY + 1);
      if (inAisle) {
        expect(throne.pose.rot, `${where}: Blickpunkt im Gang muss zur Tür schauen`).toBe(0);
        atHead++;
      }
      for (const p of r.placed) {
        if (p === throne || p.expanded.walkable || catalog.get(p.expanded.defId).tags.includes('throne')) continue;
        for (const c of p.cells.filter((x) => x.pos[1] <= g.baseY + 1)) expect(aisle(c.pos[0]), `${p.expanded.defId} im Mittelgang, ${where}`).toBe(false);
      }
    }
    expect(atHead, 'Thron nie am Gang-Ende').toBeGreaterThan(0);
  });

  it('Thronsaal mit Tür in der Längswand: Achse Haupttür → Gegenwand (`axis: door`), Thron blickt zur Tür', () => {
    let facing = 0;
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const g = shellRoom(16, 10, { height: 5, windowSpacing: 4 }); // Tür Süd in der langen Wand
      const r = furnishRoom(g, catalog.roomType('throne_room'), catalog, { seed, dataVersion: DV });
      const throne = r.placed.find((p) => catalog.get(p.expanded.defId).tags.includes('throne'))!;
      if (throne.pose.rot === 0) facing++;
    }
    expect(facing, 'Thron blickt selten zur Haupttür').toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------- Materialisierung

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
const add = (p: Vec3, d: Dir, n = 1): Vec3 => [p[0] + STEP[d][0] * n, p[1] + STEP[d][1] * n, p[2] + STEP[d][2] * n];
const HORIZONTAL: readonly Dir[] = ['north', 'east', 'south', 'west'];

/** Mechanik auf der fertigen Welt (Faktencheck #1/#2/#8/#13, T5 #3/#9, Solver-Regel Gefahr). */
function assertWorld(view: WorldView, geom: RoomShellInfo, where: string): void {
  for (const c of view.volume.cells()) {
    const n = c.state.name;
    if (n === 'chest') expect(view.info(add(c.pos, 'up')).phys.cls, `${where}: Block über Truhe bei ${c.pos.join(',')}`).not.toBe('full');
    if (n.endsWith('_bed')) expect(view.info(add(c.pos, 'up')).phys.cls, `${where}: Block über Bett bei ${c.pos.join(',')}`).not.toBe('full');
    if (n.endsWith('campfire')) {
      // Rauch: keine Falltür direkt darüber (Faktencheck #13)
      expect(view.state(add(c.pos, 'up')).name, `${where}: Falltür über Lagerfeuer`).not.toMatch(/trapdoor$/);
      // offenes Feuer auf Laufhöhe nie neben freiem, begehbarem Boden
      if (c.pos[1] === geom.baseY && view.info(add(c.pos, 'up')).phys.cls !== 'full') {
        for (const d of HORIZONTAL) {
          const q = add(c.pos, d);
          if (geom.interior.has(q[0], q[2])) expect(isWalkable(view, q), `${where}: Lagerfeuer auf Laufhöhe neben Laufweg bei ${c.pos.join(',')}`).toBe(false);
        }
      }
    }
    if (n === 'enchanting_table') {
      let shelves = 0;
      for (const dy of [0, 1]) {
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
            if (view.state([c.pos[0] + dx, c.pos[1] + dy, c.pos[2] + dz]).name !== 'bookshelf') continue;
            if (view.state([c.pos[0] + Math.trunc(dx / 2), c.pos[1] + dy, c.pos[2] + Math.trunc(dz / 2)]).name === 'air') shelves++;
          }
        }
      }
      expect(shelves, `${where}: Zaubertisch mit ${shelves} wirksamen Regalen`).toBeGreaterThanOrEqual(15);
    }
    if (n.endsWith('_leaves')) expect(c.state.properties['persistent'], `${where}: Blätter nicht persistent`).toBe('true');
  }
  for (const f of view.volume.entities()) {
    const s = STEP[FACING[(f.nbt.value['Facing'] as { value: number }).value]!];
    const behind: Vec3 = [f.blockPos[0] - s[0], f.blockPos[1] - s[1], f.blockPos[2] - s[2]];
    expect(view.info(behind).phys.cls, `${where}: Rahmen bei ${f.blockPos.join(',')} ohne festen Block`).toBe('full');
    expect(['air', 'thin'], `${where}: Rahmen-Zelle belegt`).toContain(view.info(f.blockPos).phys.cls);
  }
}

/**
 * Offene Falltüren einer Komponente liegen an einem Block an (Armlehne, Einfassung, Schirm, Paneel, Tür) oder stehen
 * als hohe Lehne auf einem Block (Stuhl-/Sofalehne): nie frei in der Luft.
 */
function assertTrapdoorsAttached(view: WorldView, owner: string, where: string): void {
  for (const c of view.volume.cellsOf(owner)) {
    const p = c.state.properties;
    if (!c.state.name.endsWith('_trapdoor') || p['open'] !== 'true') continue;
    const side = opposite(p['facing'] as Dir) as Dir;
    const touches = view.state(add(c.pos, side)).name !== 'air' || view.state(add(c.pos, 'down')).name !== 'air';
    expect(touches, `${where}: offene Falltür bei ${c.pos.join(',')} hängt frei in der Luft`).toBe(true);
  }
}

/** Erste gültige Pose in passender lichter Höhe (gedehnt wie im Solver); Wand, Decke, Boden. */
function poseFor(def: ComponentDef, variantId: string | undefined, H: number): { placed: PlacedComponent; shell: Shell; geom: RoomShellInfo } | undefined {
  const { shell, geom } = shellOf(H);
  const planner = new RoomPlanner(geom);
  const v = planner.adapt(def, variantId);
  const placed = planner.poses(def, v)[0];
  return placed === undefined ? undefined : { placed, shell, geom };
}

/** Kleinste passende lichte Höhe einer Variante (mindestens 3), dazu eine hohe für gedehnte Formen. */
function heightsFor(def: ComponentDef, variantId: string | undefined): number[] {
  const out = [2, 3, 4, 5, 6, 8].filter((H) => fitsRoomHeight(def, variantId, H));
  const first = out.find((H) => H >= 3) ?? out[0]!;
  const tall = out.includes(8) ? [8] : [];
  return [...new Set([first, ...tall])];
}

const variantsOf = (def: ComponentDef): (string | undefined)[] => def.variants?.map((v) => v.id) ?? [undefined];

describe('K3d · Komponenten materialisieren (1.21.11 + 26.3, alle Themes)', () => {
  const ids = [...K3D_NEW, ...Object.keys(K3D_EXTENDED)];
  for (const id of ids) {
    it(id, { timeout: HEAVY_TIMEOUT }, () => {
      const def = ctx.catalog.get(id);
      const vs = K3D_EXTENDED[id] ?? variantsOf(def);
      for (const variantId of vs) {
        for (const H of heightsFor(def, variantId)) {
          const setup = poseFor(def, variantId, H);
          const label = `${id}${variantId !== undefined ? `#${variantId}` : ''} H${H}`;
          expect(setup, `${label}: keine gültige Pose`).toBeDefined();
          const placements: MaterializePlacement[] = [{ id: 'c', placed: setup!.placed, roomId: 'r1' }];
          for (const version of VERSIONS) {
            const platform = ctx.platform(version);
            const themes = version === '26.3' && H === heightsFor(def, variantId)[0] ? ctx.themes.ids() : ['medieval'];
            for (const themeId of themes) {
              const where = `${label} · ${themeId} · ${version}`;
              const r = materialize({ shell: setup!.shell, placements, theme: ctx.themes.get(themeId), platform, seed: 11 });
              const hard = r.violations.filter((x) => x.kind !== 'spawn');
              expect(hard, `${where}: ${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
              expect(r.volume.cellsOf('c').length, where).toBe(setup!.placed.cells.length);
              expect(r.volume.entitiesOf('c').length, where).toBe(setup!.placed.entities.length);
              const view = new WorldView(r.volume, platform);
              assertWorld(view, setup!.geom, where);
              assertTrapdoorsAttached(view, 'c', where);
            }
          }
        }
      }
    });
  }
});

describe('K3d · Mechanik im Detail', () => {
  const world = (placed: PlacedComponent, shell: Shell, version: (typeof VERSIONS)[number] = '1.21.11') => {
    const platform = ctx.platform(version);
    const r = materialize({ shell, placements: [{ id: 'c', placed, roomId: 'r1' }], theme: ctx.themes.get('medieval'), platform, seed: 11 });
    return { r, view: new WorldView(r.volume, platform) };
  };

  it('Ecksofa: die Ecktreppe wird per Autotiling zur Innenecke (inner_*), Armlehnen liegen an den Treppen', () => {
    for (const v of ['corner', 'corner_r']) {
      const s = poseFor(ctx.catalog.get('seat/sofa'), v, 3)!;
      const { view } = world(s.placed, s.shell);
      const shapes = view.volume.cellsOf('c').filter((c) => c.state.name.endsWith('_stairs')).map((c) => c.state.properties['shape']);
      expect(shapes.filter((x) => x?.startsWith('inner_')), v).toHaveLength(1);
      for (const c of view.volume.cellsOf('c').filter((x) => x.state.name.endsWith('_trapdoor'))) {
        expect(view.state(add(c.pos, opposite(c.state.properties['facing'] as Dir) as Dir)).name, `${v}: Armlehne`).toMatch(/_stairs$/);
      }
    }
  });

  it('Kerker: der Knopf sitzt außen an einem Block neben der Eisentür, innen gibt es keinen Öffner', () => {
    for (const id of ['decor/prison_cell', 'decor/prison_cage']) {
      const def = ctx.catalog.get(id);
      for (const v of variantsOf(def)) {
        const H = heightsFor(def, v)[0]!;
        const s = poseFor(def, v, H)!;
        const { view } = world(s.placed, s.shell);
        const cells = view.volume.cellsOf('c');
        const buttons = cells.filter((c) => c.state.name.endsWith('_button'));
        const doors = cells.filter((c) => c.state.name === 'iron_door');
        expect(buttons, `${id}#${v}`).toHaveLength(1);
        expect(doors, `${id}#${v}`).toHaveLength(2);
        const b = buttons[0]!;
        const carrier = add(b.pos, opposite(b.state.properties['facing'] as Dir) as Dir);
        const touches = doors.some((d) => HORIZONTAL.concat(['up', 'down']).some((dir) => add(d.pos, dir as Dir).join() === carrier.join()));
        expect(touches, `${id}#${v}: Knopf-Träger grenzt an keine Türhälfte`).toBe(true);
        // außen: auf der Seite, von der der Spieler die Tür gesetzt hat (Blickrichtung facing → außen = opposite)
        const door = doors[0]!;
        const out = STEP[opposite(door.state.properties['facing'] as Dir) as Dir];
        const rel = [b.pos[0] - door.pos[0], b.pos[2] - door.pos[2]];
        expect(rel[0]! * out[0] + rel[1]! * out[2], `${id}#${v}: Knopf innen`).toBeGreaterThan(0);
      }
    }
  });

  it('versteckte Lichter (L1 Kassette, L2 Podest): Lichtblock allseitig verdeckt, der Raum wird heller', () => {
    const cases: [string, string, number][] = [
      ...['glowstone', 'shroomlight', 'froglight', 'double'].map((v): [string, string, number] => ['light/ceiling_coffer', v, 4]),
      ['light/ceiling_coffer', 'glowstone', 6],
      ['arch/throne_dais', 'grand', 4],
    ];
    for (const [id, v, H] of cases) {
      const s = poseFor(ctx.catalog.get(id), v, H)!;
      const empty = materialize({ shell: s.shell, placements: [], theme: ctx.themes.get('medieval'), platform: ctx.platform('1.21.11'), seed: 11 });
      const { r, view } = world(s.placed, s.shell);
      const lights = view.volume.cellsOf('c').filter((c) => /glowstone|shroomlight|froglight/.test(c.state.name));
      expect(lights.length, `${id}#${v}`).toBeGreaterThan(0);
      for (const c of lights) {
        // keine Seite liegt an Luft: die Quelle selbst ist nicht zu sehen (Falltür, Teppich, Balken, Decke davor)
        for (const d of [...HORIZONTAL, 'up', 'down'] as Dir[]) expect(view.state(add(c.pos, d)).name, `${id}#${v}: Lichtblock bei ${c.pos.join(',')} offen nach ${d}`).not.toBe('air');
      }
      let gain = 0;
      for (const [x, z] of s.geom.interior.toArray()) {
        for (let y = s.geom.baseY; y < s.geom.baseY + H; y++) {
          const p: Vec3 = [x, y, z];
          if (!isWalkable(view, p)) continue;
          expect(r.light.levelAt(p), `${id}#${v}: dunkler als vorher bei ${p.join(',')}`).toBeGreaterThanOrEqual(empty.light.levelAt(p));
          gain += r.light.levelAt(p) - empty.light.levelAt(p);
        }
      }
      expect(gain, `${id}#${v}: kein Lichtgewinn`).toBeGreaterThan(20);
      // unter der Kassette ist der Boden hell (≥ 9), obwohl keine Leuchte sichtbar ist
      if (id === 'light/ceiling_coffer') {
        const below: Vec3 = [lights[0]!.pos[0], s.geom.baseY, lights[0]!.pos[2]];
        expect(r.light.levelAt(below), `${id}#${v} H${H}`).toBeGreaterThanOrEqual(15 - H - 1);
      }
    }
  });

  it('gedehnte Formen: Säule, Kamin-Schlot und Käfigzelle reichen bis unter die Decke, Kronleuchter/Käfig hängen mittig', () => {
    for (const H of [4, 6, 9]) {
      for (const [id, v] of [['arch/column', 'timber'], ['decor/fireplace', 'brick'], ['decor/prison_cell', 'wide']] as const) {
        const s = poseFor(ctx.catalog.get(id), v, H)!;
        expect(Math.max(...s.placed.cells.map((c) => c.pos[1])), `${id}#${v} H${H}`).toBe(s.geom.baseY + H - 1);
      }
      for (const [id, v] of [['light/trapdoor_chandelier', 'pendant'], ['decor/hanging_cage', undefined], ['decor/amethyst_hanging', 'geode']] as const) {
        if (!fitsRoomHeight(ctx.catalog.get(id), v, H)) continue;
        const s = poseFor(ctx.catalog.get(id), v, H)!;
        const bottom = Math.min(...s.placed.cells.map((c) => c.pos[1]));
        expect(bottom - s.geom.baseY, `${id} H${H}`).toBeGreaterThanOrEqual(2);
        expect(Math.max(...s.placed.cells.map((c) => c.pos[1])), `${id} H${H}`).toBe(s.geom.baseY + H - 1);
      }
    }
  });
});

// ---------------------------------------------------------------- End-to-End

function singleRoom(version: keyof typeof TARGET_VERSIONS, type: string, w: number, d: number, seed: number, height: number, themeId = 'medieval'): Project {
  const p = Project.create({ id: 'k3d', name: 'K3d', seed, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  return p;
}

function checkE2E(p: Project, where: string): string[] {
  const world = generate(p, ctx);
  const room = p.state.rooms[0]!;
  const info = world.shell.rooms.get(room.id)!;
  const placements = p.state.placements.filter((x) => x.roomId === room.id);
  const w = `${where}\n${renderAscii(info, placements.map((x) => placedFor(x, ctx.catalog)), (id) => ctx.catalog.get(id).tags)}`;
  expect(world.warnings, w).toEqual([]);
  const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
  expect(hard, `${w}\n${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
  expect(world.materialized.light.darkCells, w).toEqual([]);
  const tags = new Set(placements.flatMap((x) => ctx.catalog.get(x.componentId).tags));
  expect(K3D_TYPES[room.roomTypeId]!.some((t) => tags.has(t)), `${w}\nSignatur fehlt`).toBe(true);
  assertWorld(new WorldView(world.materialized.volume, ctx.platform(p.state.targetVersion.name)), info, where);
  return placements.map((x) => x.componentId);
}

describe('K3d · End-to-End (Einrichtung → Licht-Pass → Materialisierung)', () => {
  const used = new Set<string>();
  for (const type of Object.keys(K3D_TYPES)) {
    it(`${type}: minArea … 12×9 × lichte Höhe 3/4/5 × 2 Seeds (1.21.11), 26.3 × Themes`, { timeout: HEAVY_TIMEOUT }, () => {
      const rt = ctx.catalog.roomType(type);
      for (const [w, d] of [sizesFor(rt)[0]!, [12, 9] as const]) {
        for (const H of [3, 4, 5]) {
          for (const seed of [0, 1]) for (const id of checkE2E(singleRoom('1.21.11', type, w, d, seed, H), `${type} ${w}×${d} H${H} seed ${seed}`)) used.add(id);
        }
      }
      for (const themeId of ctx.themes.ids()) for (const id of checkE2E(singleRoom('26.3', type, 12, 9, 5, 5, themeId), `${type} 12×9 H5 26.3 ${themeId}`)) used.add(id);
    });
  }

  it('die neuen Komponenten kommen in den Räumen zum Einsatz (≥ 20 verschiedene)', () => {
    const mine = K3D_NEW.filter((id) => used.has(id));
    expect(mine.length, mine.join(', ')).toBeGreaterThanOrEqual(20);
  });
});
