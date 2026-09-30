/**
 * V3 – Raumhöhe nutzen: Stapel-Sockets `above`/`below`, Regel `containerOpen`, Wand-Montage in mehreren Höhen
 * (`wallHeights`, über niedrigen Möbeln), Höhen-Auswahl (`minRoomHeight`/`maxRoomHeight`), gedehnte Formen
 * (`stretch`: Kettenlänge, Regal bis zur Decke), Decke nach Zonen, Qualitätsmaß „Vertikalität“ und der Fuzz über
 * lichte Höhe 3–6 mit Messung gegen den Stand vor V3.
 */
import { describe, expect, it } from 'vitest';
import { Catalog, ComponentDefSchema, type ComponentDef, type RoomTypeDef } from '@mcda/catalog';
import { CellSet, cellKey, key3, pose, type Vec3 } from '@mcda/core';
import {
  MECH_CHEST, MECH_CONDUCTOR, MECH_NEUTRAL, RoomPlanner, adaptVariant, cellMechanics, dropLevel, expandComponent, fitsRoomHeight,
  formatVariantId, furnishRoom, parseVariantId, placeComponent, verticality, wallLevels,
  type FurnishResult, type PlacedComponent, type RoomGeometry,
} from '../src/index.js';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { DV, assertHardGuarantees, catalog, lShellRoom, shellRoom } from './fixtures.js';

const PLANKS = { block: 'minecraft:oak_planks' };
const CHEST = { block: 'minecraft:chest', orient: { front: 'front' } };
const BARREL = { block: 'minecraft:barrel', orient: { front: 'front' } };
const SLAB = { role: 'furniture_wood', shape: 'slab', orient: { upsideDown: true } };

function def(o: Record<string, unknown>): ComponentDef {
  return ComponentDefSchema.parse({ kind: 'static', category: 'furniture', obtainability: 'survival', mount: 'floor', rotations: 'backToWall', tags: ['t'], ...o });
}
function roomType(id: string, required: RoomTypeDef['required'], optional: RoomTypeDef['optional'] = []): RoomTypeDef {
  return { id, name: id, minArea: 1, coverage: { target: 0 }, required, optional };
}
const variantsOf = (d: ComponentDef): (string | undefined)[] => d.variants?.map((v) => v.id) ?? [undefined];
const ascii = (r: FurnishResult): string => r.placements.map((p) => `${p.key} ${p.componentId}${p.variantId ? `#${p.variantId}` : ''} ${p.pose.pos.join(',')} r${p.pose.rot}${p.socketId ? ` <${p.socketId}` : ''}`).join('\n');

/** Mechanik-Regeln auf abstrakter Ebene (vor der Materialisierung): Truhe öffnet, Kopffreiheit, keine Lampe im Laufraum. */
function assertVertical(g: RoomGeometry, r: FurnishResult, where: string): void {
  const mech = new Map<string, number>();
  const furniture = new Set<string>();
  for (const p of r.placed) {
    for (const c of p.cells) {
      mech.set(key3(c.pos), cellMechanics(c.mat));
      if (p.expanded.mount !== 'ceiling' && !p.expanded.walkable && c.pos[1] <= g.baseY + 1) furniture.add(cellKey(c.pos[0], c.pos[2]));
    }
  }
  const top = g.baseY + g.height - 1;
  for (const p of r.placed) {
    for (const c of p.cells) {
      const k = key3(c.pos);
      // Faktencheck #2 / T5 #6: über jeder Truhe kein Leiter und nicht die Decke
      if (mech.get(k) === MECH_CHEST) {
        expect(c.pos[1], `${where}: Truhe unter der Decke bei ${k}`).toBeLessThan(top);
        expect(mech.get(key3([c.pos[0], c.pos[1] + 1, c.pos[2]])), `${where}: Leiter über Truhe bei ${k}`).not.toBe(MECH_CONDUCTOR);
      }
      // Kopffreiheit über Laufwegen: nichts von der Decke und keine Lampe unter Boden + 2 über freiem Boden
      const lamp = /lantern|candle|torch/.test(c.mat.block ?? c.mat.shape ?? '');
      if (c.pos[1] < g.baseY + 2 && (p.expanded.mount === 'ceiling' || (lamp && p.expanded.mount !== 'floor' && p.expanded.mount !== 'surface' && p.expanded.mount !== 'wall'))) {
        expect(furniture.has(cellKey(c.pos[0], c.pos[2])), `${where}: Deckenobjekt/Lampe im Kopfbereich über dem Laufweg bei ${k}`).toBe(true);
      }
    }
  }
}

describe('Varianten-IDs mit Dehnung und Höhen-Auswahl', () => {
  it('parse/format: `tall~3`, `~2`, ohne Dehnung unverändert', () => {
    expect(parseVariantId('tall~3')).toEqual({ base: 'tall', n: 3 });
    expect(parseVariantId('~2')).toEqual({ base: undefined, n: 2 });
    expect(parseVariantId('plain')).toEqual({ base: 'plain', n: 0 });
    expect(parseVariantId(undefined)).toEqual({ base: undefined, n: 0 });
    expect(formatVariantId('tall', 0)).toBe('tall');
    expect(formatVariantId(undefined, 4)).toBe('~4');
    expect(() => parseVariantId('x~-1')).toThrow();
  });

  it('stretch: Zusatz-Schichten über `layer`, darüber rückt alles (Zellen, Masken, Sockets) nach oben', () => {
    const d = def({
      id: 't/lamp', mount: 'ceiling', rotations: [0], layers: [['L'], ['C']], legend: { L: { block: 'minecraft:lantern', orient: { hanging: true } }, C: { role: 'metal', shape: 'chain' } },
      masks: { support: [{ at: [0, 1, 0], side: 'up', kind: 'center' }] }, stretch: { layer: 0, max: 5, fill: 'drop', rows: ['C'] },
    });
    const e = expandComponent(d, '~3');
    expect(e.size).toEqual([1, 5, 1]);
    expect(e.variantId).toBe('~3');
    expect(e.cells.map((c) => c.at[1]).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(e.cells.filter((c) => c.mat.role === 'metal')).toHaveLength(4);
    expect(e.masks.support![0]!.at).toEqual([0, 4, 0]); // Stütze bleibt an der obersten Kette
    expect(() => expandComponent(d, '~6')).toThrow(/max 5/);
    // drop: unterste Zelle etwa auf halber Höhe, nie unter Boden + 2
    for (const H of [4, 5, 6, 8, 10, 16]) {
      const v = adaptVariant(d, undefined, H);
      const size = expandComponent(d, v).size[1];
      expect(H - size, `H${H}`).toBe(Math.max(dropLevel(H), H - 2 - 5));
      expect(H - size).toBeGreaterThanOrEqual(2);
    }
  });

  it('Katalog: Bücherwand reicht bis unter die Decke, Himmelbett-Pfosten bis 5 hoch, Kettenlaterne hängt über Kopfhöhe', () => {
    const shelf = catalog.get('storage/bookshelf_wall_tall');
    for (const H of [4, 5, 6, 8, 12, 15]) for (const v of variantsOf(shelf)) expect(expandComponent(shelf, adaptVariant(shelf, v, H)).size[1], `H${H} ${v}`).toBe(H);
    const bed = catalog.get('bed/canopy');
    for (const [H, want] of [[3, 3], [4, 4], [5, 5], [8, 5]] as const) expect(expandComponent(bed, adaptVariant(bed, 'log_slab', H)).size[1], `H${H}`).toBe(want);
    const lantern = catalog.get('light/hanging_lantern');
    for (const H of [4, 5, 6, 7, 8, 10, 12, 16]) {
      const size = expandComponent(lantern, adaptVariant(lantern, undefined, H)).size[1];
      expect(H - size, `H${H}: Laterne auf Höhe ${H - size}`).toBe(dropLevel(H));
    }
    // alle gedehnten Katalog-Formen lassen sich bis `max` expandieren (Zeilenmaße stimmen)
    for (const d of catalog.all()) {
      for (const v of variantsOf(d)) {
        const spec = d.variants?.find((x) => x.id === v)?.stretch ?? d.stretch;
        if (spec === undefined) continue;
        const e = expandComponent(d, formatVariantId(v, spec.max));
        expect(e.size[1], `${d.id}#${v}`).toBe(expandComponent(d, v).size[1] + spec.max);
      }
    }
  });

  it('minRoomHeight/maxRoomHeight: Variante vor Komponente, Auswahl im Solver (RoomPlanner prüft es nicht)', () => {
    const cab = catalog.get('storage/tall_cabinet');
    expect(fitsRoomHeight(cab, 'h2', 3)).toBe(true);
    expect(fitsRoomHeight(cab, 'h2', 4)).toBe(false);
    expect(fitsRoomHeight(cab, 'h4', 4)).toBe(false);
    expect(fitsRoomHeight(cab, 'h4', 5)).toBe(true);
    expect(fitsRoomHeight(catalog.get('storage/bookshelf_wall_tall'), 'wide', 3)).toBe(false);
    for (const d of catalog.all()) {
      for (const v of [d, ...(d.variants ?? [])]) if (v.minRoomHeight !== undefined && v.maxRoomHeight !== undefined) expect(v.minRoomHeight, d.id).toBeLessThanOrEqual(v.maxRoomHeight);
    }
    // Solver: bei lichter Höhe 5 nie der 2 hohe, meist der 4 hohe Schrank; bei Höhe 3 nie der 4 hohe
    const rt = roomType('c', [{ tags: ['tall_cabinet'], count: [1, 1] }]);
    const at5 = new Map<string, number>();
    for (let seed = 0; seed < 12; seed++) {
      const r5 = furnishRoom(shellRoom(9, 8, { height: 5, inner: ['north'] }), rt, catalog, { seed, dataVersion: DV });
      const v5 = r5.placements.find((p) => p.componentId === 'storage/tall_cabinet')!.variantId!;
      at5.set(v5, (at5.get(v5) ?? 0) + 1);
      const r3 = furnishRoom(shellRoom(9, 8, { height: 3, inner: ['north'] }), rt, catalog, { seed, dataVersion: DV });
      expect(['h2', 'h3']).toContain(r3.placements.find((p) => p.componentId === 'storage/tall_cabinet')!.variantId);
    }
    expect(at5.has('h2')).toBe(false);
    expect(at5.get('h4') ?? 0).toBeGreaterThan(at5.get('h3') ?? 0);
    expect(new RoomPlanner(shellRoom(9, 8, { height: 5 })).fitsRoom(cab, 'h2')).toBe(false);
  });
});

describe('Regel containerOpen (Faktencheck #2, In-Game T5 #6/T4)', () => {
  it('Klassen: Truhe, Leiter (Fass, Planken, Stamm, Bücherregal), neutral (Stufe, Treppe, Truhe, Topf, Zaun, Laterne)', () => {
    expect(cellMechanics({ block: 'minecraft:chest' })).toBe(MECH_CHEST);
    expect(cellMechanics({ block: 'minecraft:trapped_chest' })).toBe(MECH_CHEST);
    for (const b of ['barrel', 'oak_planks', 'bookshelf', 'hay_block', 'furnace', 'crafting_table']) expect(cellMechanics({ block: `minecraft:${b}` }), b).toBe(MECH_CONDUCTOR);
    for (const b of ['decorated_pot', 'lantern', 'oak_slab', 'spruce_stairs', 'red_carpet', 'potted_fern', 'zombie_head', 'iron_chain']) expect(cellMechanics({ block: `minecraft:${b}` }), b).toBe(MECH_NEUTRAL);
    expect(cellMechanics({ role: 'beam', shape: 'log' })).toBe(MECH_CONDUCTOR);
    for (const s of ['slab', 'stairs', 'fence', 'trapdoor', 'chain', 'lantern', 'wall_banner']) expect(cellMechanics({ role: 'x', shape: s }), s).toBe(MECH_NEUTRAL);
  });

  it('Fass/Planken nie über einer Truhe, Truhe nie unter der Decke oder unter einem Leiter; Truhe über Truhe geht', () => {
    const g = shellRoom(9, 7, { height: 3, inner: ['north'] });
    const chest = def({ id: 't/chest', layers: [['C']], legend: { C: CHEST } });
    const barrel = def({ id: 't/barrel', rotations: 'all', layers: [['B']], legend: { B: BARREL } });
    const tower = (id: string, rows: string[], legend: Record<string, unknown>) => def({ id, layers: rows.map((r) => [r]), legend });
    const planner = new RoomPlanner(g, [placeComponent(expandComponent(chest), pose([3, g.baseY, 0], 0))]);
    // auf der Truhe: Fass (Wand-Montage in Höhe 1) nein, Stufe ja
    const barrelWall = def({ id: 't/bw', mount: 'wall', wallHeight: 1, layers: [['B']], legend: { B: BARREL } });
    const slabWall = def({ id: 't/sw', mount: 'wall', wallHeight: 1, layers: [['S']], legend: { S: SLAB } });
    const over = (p: PlacedComponent) => p.pose.pos[0] === 3 && p.pose.pos[2] === 0;
    expect(planner.candidates(barrelWall).some(over)).toBe(false);
    expect(planner.candidates(slabWall).some(over)).toBe(true);
    // innerhalb einer Komponente: Fass über Truhe nie, Truhe über Truhe ja, Truhe ganz oben (Decke) nie
    const empty = new RoomPlanner(g);
    expect(empty.candidates(tower('t/bad', ['C', 'B'], { C: CHEST, B: BARREL }))).toEqual([]);
    expect(empty.candidates(tower('t/cc', ['C', 'C'], { C: CHEST })).length).toBeGreaterThan(0);
    expect(empty.candidates(tower('t/ccc', ['C', 'C', 'C'], { C: CHEST }))).toEqual([]); // oberste Truhe unter der Decke
    expect(empty.candidates(tower('t/ccs', ['C', 'C', 'S'], { C: CHEST, S: SLAB })).length).toBeGreaterThan(0);
    expect(empty.candidates(tower('t/bc', ['B', 'C'], { C: CHEST, B: BARREL })).length).toBeGreaterThan(0); // Truhe auf Fass
    // umgekehrt: eine Truhe unter ein vorhandenes Fass stellen geht nicht
    const high = new RoomPlanner(g, [placeComponent(expandComponent(barrelWall), pose([5, g.baseY + 1, 0], 0))]);
    expect(high.candidates(chest).some((p) => p.pose.pos[0] === 5 && p.pose.pos[2] === 0)).toBe(false);
    void barrel;
  });
});

describe('Rahmen-Freiraum (Vanilla ItemFrame#survives, Prüfung entity_support)', () => {
  it('kein Rahmen direkt über Zaun/Mauer (ragen ½ Block hoch) – eigene und vorhandene Blöcke; eine Zelle höher geht', () => {
    const g = shellRoom(9, 7, { height: 4, inner: ['north'] });
    const fence = def({ id: 't/fence', layers: [['F']], legend: { F: { role: 'furniture_wood', shape: 'fence' } } });
    const frame = catalog.get('decor/frame_tools'); // Rahmen in Lage 0 (Luft), Zaun-Haken darüber
    const planner = new RoomPlanner(g, [placeComponent(expandComponent(fence), pose([4, g.baseY, 0], 0))]);
    const levels = planner.candidates(frame, 'axe').filter((p) => p.pose.pos[0] === 4 && p.pose.pos[2] === 0).map((p) => p.pose.pos[1] - g.baseY);
    expect(levels).toEqual([2]); // Höhe 1 (Rahmen direkt über dem Zaun) fällt weg
    // innerhalb einer Komponente: Zaun mit Rahmen direkt darüber ist nie gültig, mit Luft dazwischen schon
    const bad = def({ id: 't/bad', layers: [['F'], ['_']], legend: { F: { role: 'furniture_wood', shape: 'fence' } }, entities: [{ type: 'item_frame', at: [0, 1, 0], face: 'front' }] });
    const ok = def({ id: 't/ok', layers: [['F'], ['_'], ['_']], legend: { F: { role: 'furniture_wood', shape: 'fence' } }, entities: [{ type: 'item_frame', at: [0, 2, 0], face: 'front' }] });
    expect(new RoomPlanner(g).candidates(bad)).toEqual([]);
    expect(new RoomPlanner(g).candidates(ok).length).toBeGreaterThan(0);
    // Katalog: der Waffenständer ist überall platzierbar (Rahmen nicht über den Zäunen)
    for (const v of ['tall', 'low']) expect(new RoomPlanner(g).candidates(catalog.get('decor/weapon_rack'), v).length, v).toBeGreaterThan(0);
  });
});

describe('Stapel-Sockets `above`/`below`', () => {
  const chest = catalog.get('storage/chest');

  it('Truhen stapeln sich bis zur Regel-Grenze: lichte Höhe 3 → höchstens 2, Höhe 4 → höchstens 3; Kette mit parentKey', () => {
    const chest = catalog.get('storage/chest');
    const rt = roomType('s', [{ tags: ['chest'], count: [6, 6] }]);
    // Q1a: seit storage/lockbox tragen zwei Komponenten den Tag `chest`. Dieser Test prüft den Stapel-Socket
    // von `storage/chest` selbst und arbeitet deshalb mit einem Katalog, der nur diese Komponente enthält.
    const onlyChest = Catalog.of([chest], [rt]);
    for (const [H, max] of [[3, 2], [4, 3], [6, 5]] as const) {
      let stacked = 0, tallest = 0;
      for (let seed = 0; seed < 12; seed++) {
        const g = shellRoom(10, 8, { height: H, inner: ['north', 'east'] });
        const r = furnishRoom(g, rt, onlyChest, { seed, dataVersion: DV });
        assertHardGuarantees(g, r, `H${H} seed ${seed}`);
        assertVertical(g, r, `H${H} seed ${seed}`);
        const cols = new Map<string, number>();
        r.placements.forEach((p, i) => {
          if (p.componentId !== 'storage/chest') return;
          const c = r.placed[i]!.cells[0]!.pos;
          cols.set(cellKey(c[0], c[2]), (cols.get(cellKey(c[0], c[2])) ?? 0) + 1);
          if (p.socketId === 'stack') {
            stacked++;
            const parent = r.placements.find((x) => x.key === p.parentKey)!;
            expect(parent.componentId).toBe('storage/chest');
            expect(p.pose.pos[1]).toBe(parent.pose.pos[1] + 1);
          }
        });
        tallest = Math.max(tallest, ...cols.values());
      }
      expect(stacked, `H${H}`).toBeGreaterThan(6);
      expect(tallest, `H${H}`).toBeLessThanOrEqual(max);
      expect(tallest, `H${H}`).toBeGreaterThanOrEqual(Math.min(max, 3));
    }
    expect(chest.sockets?.some((s) => s.type === 'above')).toBe(true);
  });

  it('Aufsatzregal auf der Kommode: in jeder Drehung genau über den 3 Kommoden-Zellen', () => {
    const dresser = catalog.get('storage/wardrobe');
    const hutch = catalog.get('storage/shelf_hutch');
    const g = shellRoom(10, 9, { height: 3, inner: ['north', 'east', 'south', 'west'] });
    for (const rot of [0, 1, 2, 3] as const) {
      const planner = new RoomPlanner(g);
      const parent = planner.poses(dresser, 'dresser').find((p) => p.pose.rot === rot)!;
      planner.add(parent);
      const sp = planner.socketPoses(hutch, 'pot', [{ key: 'd', placed: parent }]);
      expect(sp.map((x) => x.socketId), `rot ${rot}`).toEqual(['hutch']);
      const top = new Set(parent.cells.map((c) => cellKey(c.pos[0], c.pos[2])));
      const bottom = sp[0]!.placed.cells.filter((c) => c.pos[1] === g.baseY + 1);
      expect(bottom.map((c) => cellKey(c.pos[0], c.pos[2])).sort(), `rot ${rot}`).toEqual([...top].sort());
      expect(sp[0]!.placed.pose.rot).toBe(rot);
    }
  });

  it('Stapel-Kind braucht Halt: über Luft (neben dem Elternteil) nie; `below` stellt ein Möbel unter ein Wandbord', () => {
    const post = def({ id: 't/post', layers: [['X']], legend: { X: PLANKS }, sockets: [{ id: 'side', type: 'above', at: [1, 1, 0], accepts: ['t_box'] }] });
    const box = def({ id: 't/box', rotations: 'all', tags: ['t_box'], layers: [['X']], legend: { X: PLANKS } });
    const g = shellRoom(9, 7, { height: 4, inner: ['north'] });
    const planner = new RoomPlanner(g);
    const parent = planner.poses(post)[0]!;
    planner.add(parent);
    expect(planner.socketPoses(box, undefined, [{ key: 'p', placed: parent }])).toEqual([]);
    // below: Bord an der Wand in Höhe 2, darunter eine Kiste auf dem Boden (oberste Lage direkt unter `at`)
    const shelf = def({ id: 't/shelf', mount: 'wall', wallHeight: 2, layers: [['S']], legend: { S: SLAB }, sockets: [{ id: 'under', type: 'below', at: [0, -1, 0], accepts: ['t_box2'] }] });
    const box2 = def({ id: 't/box2', tags: ['t_box2'], layers: [['X'], ['X']], legend: { X: PLANKS } });
    const rt = roomType('b', [{ tags: ['t_shelf'], count: [1, 1] }]);
    const cat = Catalog.of([{ ...shelf, tags: ['t_shelf'] }, box2]);
    let under = 0;
    for (let seed = 0; seed < 8; seed++) {
      const r = furnishRoom(g, rt, cat, { seed, dataVersion: DV });
      assertHardGuarantees(g, r, `seed ${seed}`);
      const s = r.placed.find((p) => p.expanded.defId === 't/shelf')!;
      const b = r.placed.find((p) => p.expanded.defId === 't/box2');
      if (b === undefined) continue;
      under++;
      expect(b.pose.pos).toEqual([s.pose.pos[0], g.baseY, s.pose.pos[2]]);
    }
    expect(under).toBe(8);
  });
});

describe('Wand in der Höhe (`wallHeights`)', () => {
  it('Höhen in Wunsch-Reihenfolge, negativ von der Decke, nie bis auf den Boden', () => {
    const g = (height: number) => ({ baseY: 1, height });
    expect(wallLevels({ wallHeights: [2, 1, 3] }, 1, g(5))).toEqual([3, 2, 4]);
    expect(wallLevels({ wallHeights: [-1, 2] }, 1, g(5))).toEqual([5, 3]);
    expect(wallLevels({ wallHeights: [-1, 2] }, 1, g(3))).toEqual([3]);
    expect(wallLevels({ wallHeights: [2, -1, 1] }, 2, g(2))).toEqual([3, 2]); // −1 läge bei Höhe 2 auf dem Boden → entfällt
    expect(wallLevels({ wallHeight: 2 }, 1, g(5))).toEqual([3]);
    expect(wallLevels({}, 1, g(5))).toEqual([2]);
  });

  it('Wandobjekt über höheren Möbeln nur mit Luft dazwischen; über 1 hohen Möbeln wie bisher direkt darüber', () => {
    const shelf = def({ id: 't/shelf', mount: 'wall', wallHeights: [1, 2, 3], layers: [['S']], legend: { S: SLAB } });
    const two = def({ id: 't/two', layers: [['X'], ['X']], legend: { X: PLANKS } });
    const g = shellRoom(9, 7, { height: 5, inner: ['north'] });
    const planner = new RoomPlanner(g, [placeComponent(expandComponent(two), pose([3, g.baseY, 0], 0))]);
    const levels = planner.poses(shelf).filter((p) => p.pose.pos[0] === 3 && p.pose.pos[2] === 0).map((p) => p.pose.pos[1] - g.baseY);
    expect(levels).toEqual([3]); // 2 läge direkt auf dem 2 hohen Möbel
  });

  it('Solver hängt Werkzeug bevorzugt über niedrige Möbel (Werkbank) statt auf freie Wand, Borde über Kopfhöhe', () => {
    // 3 Werkbänke an ~24 festen Wandzellen: zufällig lägen ≈ 12 % der Werkzeugrahmen über einer Werkbank
    const cat = Catalog.of([catalog.get('work/crafting_table'), catalog.get('decor/frame_tools'), catalog.get('decor/wall_shelf')]);
    const rt = roomType('w', [{ tags: ['crafting'], count: [3, 3], placement: { zones: ['edge'] } }, { tags: ['wall_tools'], count: [3, 3] }], [{ tags: ['wall_shelf'], count: [2, 2] }]);
    let over = 0, total = 0, high = 0, shelves = 0;
    for (let seed = 0; seed < 16; seed++) {
      const g = shellRoom(10, 8, { height: 4, inner: ['north', 'east'] });
      const r = furnishRoom(g, rt, cat, { seed, dataVersion: DV });
      assertHardGuarantees(g, r, `seed ${seed}`);
      const floor = new Set(r.placed.filter((p) => p.expanded.mount === 'floor').flatMap((p) => p.cells.map((c) => cellKey(c.pos[0], c.pos[2]))));
      for (const p of r.placed.filter((x) => x.expanded.defId === 'decor/frame_tools')) {
        total++;
        if (p.cells.some((c) => floor.has(cellKey(c.pos[0], c.pos[2])))) over++;
      }
      for (const p of r.placed.filter((x) => x.expanded.defId === 'decor/wall_shelf')) {
        shelves++;
        if (p.pose.pos[1] - g.baseY >= 2) high++;
      }
    }
    expect(over / total, `${over}/${total} über Werkbänken`).toBeGreaterThan(0.5);
    expect(high / shelves, `${high}/${shelves} über Kopfhöhe`).toBeGreaterThan(0.6);
  });
});

describe('Decke: hang-Sockets über Tischen, Verteilung nach Zonen', () => {
  it('Taverne: Laternen hängen über Tischen/Theke (dort auch tiefer), nie tiefer als Boden + 2 über dem Laufweg', () => {
    let lamps = 0;
    for (let seed = 0; seed < 10; seed++) {
      for (const H of [3, 4, 6]) {
        const g = shellRoom(12, 10, { height: H });
        const r = furnishRoom(g, catalog.roomType('tavern'), catalog, { seed, dataVersion: DV });
        assertHardGuarantees(g, r, `H${H} seed ${seed}`);
        assertVertical(g, r, `H${H} seed ${seed}`);
        lamps += r.placements.filter((p) => p.socketId?.startsWith('lamp')).length;
      }
    }
    expect(lamps).toBeGreaterThan(10);
  });

  it('große Räume: Deckenobjekte verteilen sich über mehrere Zonen', () => {
    let spread = 0;
    for (let seed = 0; seed < 6; seed++) {
      // W3 (27.09.2026): Licht-Budget (I7) – die Taverne hängt ihr Licht jetzt über die Tische (Andockpunkte) statt bis zu
      // sechs freier Deckenlaternen; geprüft wird die Verteilung am Speisesaal (Kronleuchter je Fläche)
      const r = furnishRoom(shellRoom(20, 14, { height: 5 }), catalog.roomType('dining_hall'), catalog, { seed, dataVersion: DV });
      const ceil = r.placed.filter((p, i) => p.expanded.mount === 'ceiling' && r.placements[i]!.parentKey === undefined);
      const zones = new Set(ceil.map((p) => r.zones.findIndex((z) => z.cells.has(p.pose.pos[0], p.pose.pos[2]))));
      if (zones.size >= 2) spread++;
    }
    expect(spread).toBeGreaterThanOrEqual(5);
  });
});

/**
 * Stand vor V3 (Solver v2 + Katalog K2, gemessen am 23.09.2026 mit genau diesem Raumsatz): Blöcke oberhalb von
 * Boden + 1 je Raum, gemittelt über alle Raumtypen × 3 Größen × mit/ohne Innenwand × 3 Seeds.
 */
const BEFORE_V3: Readonly<Record<number, number>> = { 3: 8.98, 4: 15.06, 5: 16.91, 6: 16.91 };

describe('Fuzz lichte Höhe 3–6: Vertikalität, harte Garantien, Pflichtobjekte', () => {
  const sizes = [[8, 7], [10, 8], [12, 9]] as const;
  const stats = new Map<number, { above: number; rooms: number; levels: number }>();
  for (const H of [3, 4, 5, 6]) {
    it(`lichte Höhe ${H}: 0 Kollisionen, 0 Taschen, Pflicht erfüllt, Kopffreiheit, Truhen öffnen`, { timeout: HEAVY_TIMEOUT }, () => {
      const st = { above: 0, rooms: 0, levels: 0 };
      for (const type of catalog.roomTypeIds()) {
        for (const [w, d] of sizes) {
          for (const inner of [[], ['north']] as const) {
            const g = shellRoom(w, d, { height: H, inner: [...inner], windowSpacing: 4 });
            if (g.interior.size < catalog.roomType(type).minArea) continue;
            for (let seed = 0; seed < 3; seed++) {
              const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
              const where = `${type} ${w}×${d}${inner.join('')} H${H} seed ${seed}`;
              expect(r.warnings, `${where}\n${ascii(r)}`).toEqual([]);
              assertHardGuarantees(g, r, where);
              assertVertical(g, r, where);
              const v = verticality(r.placed, g);
              const part = r.quality.parts.find((p) => p.id === 'vertical')!;
              expect(part.value).toBeCloseTo(v.ratio, 10);
              st.above += v.above;
              st.levels += v.ratio;
              st.rooms++;
            }
          }
        }
      }
      stats.set(H, st);
      // „deutlich mehr Blöcke oberhalb Boden + 1 als vor V3“ (V3-Bericht: H3 +45 %, H4 +78 %, H5 +88 %, H6 +95 %)
      const perRoom = st.above / st.rooms;
      // W2 (26.09.2026): Regel I6 („Funktion vor Menge“, Deko-Budget je Fläche) nimmt bewusst Wand- und Deckendeko weg –
      // die Schwelle sinkt von +25 %/+50 % auf +15 %/+30 % gegenüber dem Stand vor V3 (Raumhöhe bleibt genutzt).
      expect(perRoom, `H${H}: ${perRoom.toFixed(1)} Blöcke über Kopfhöhe je Raum (vorher ${BEFORE_V3[H]})`).toBeGreaterThan(BEFORE_V3[H]! * (H === 3 ? 1.15 : 1.3));
      expect(st.levels / st.rooms, `H${H}: Anteil genutzter Höhenebenen`).toBeGreaterThan(0.95);
    });
  }

  // alle Raumtypen × L-Raum: unter Volllast (viele Agenten/Worker) > 5 s, einzeln ~2 s
  it('L-Raum und lichte Höhe 2: weiterhin gültig (Stapel enden an der Decke)', { timeout: HEAVY_TIMEOUT }, () => {
    for (const type of catalog.roomTypeIds()) {
      for (const g of [lShellRoom(4), shellRoom(9, 8, { height: 2 })]) {
        if (g.interior.size < catalog.roomType(type).minArea) continue;
        for (let seed = 0; seed < 3; seed++) {
          const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
          expect(r.warnings, `${type} ${g.roomId} seed ${seed}`).toEqual([]);
          assertHardGuarantees(g, r, `${type} ${g.roomId}`);
          assertVertical(g, r, `${type} ${g.roomId}`);
        }
      }
    }
  });

  it('Determinismus mit Stapeln, Dehnung und Wandhöhen', () => {
    for (const [type, H] of [['storage', 5], ['library', 7], ['smithy', 4]] as const) {
      const g = shellRoom(12, 9, { height: H });
      const a = furnishRoom(g, catalog.roomType(type), catalog, { seed: 5, dataVersion: DV });
      const b = furnishRoom(g, catalog.roomType(type), catalog, { seed: 5, dataVersion: DV });
      expect(a.placements).toEqual(b.placements);
      expect(a.quality).toEqual(b.quality);
    }
  });

  it('gedehnte Formen im Ergebnis sind mit ihrer Varianten-ID reproduzierbar (wie placedFor in der Pipeline)', () => {
    const g = shellRoom(12, 9, { height: 9 });
    let stretched = 0;
    for (const type of ['library', 'tavern', 'bedroom', 'storage']) {
      const r = furnishRoom(g, catalog.roomType(type), catalog, { seed: 3, dataVersion: DV });
      r.placements.forEach((p, i) => {
        const again = placeComponent(expandComponent(catalog.get(p.componentId), p.variantId), p.pose);
        expect(again.cells.map((c) => key3(c.pos))).toEqual(r.placed[i]!.cells.map((c) => key3(c.pos)));
        if (p.variantId?.includes('~') === true) stretched++;
      });
    }
    expect(stretched).toBeGreaterThan(2);
  });

  it('Kopffreiheit in hohen Räumen: hängende Objekte enden nicht unter Boden + 2 (auch bei lichter Höhe 16)', () => {
    const g = shellRoom(12, 10, { height: 16 });
    const r = furnishRoom(g, catalog.roomType('tavern'), catalog, { seed: 1, dataVersion: DV });
    assertHardGuarantees(g, r, 'H16');
    assertVertical(g, r, 'H16');
    const v = verticality(r.placed, g);
    expect(v.levels, `${v.levels} von 16 Ebenen`).toBeGreaterThanOrEqual(8);
    void CellSet;
  });
});

describe('Qualitätsmaß „Vertikalität“', () => {
  it('Anteil genutzter Höhenebenen und Blöcke über Kopfhöhe', () => {
    const lamp = placeComponent(expandComponent(catalog.get('light/ceiling_lantern')), pose([2, 5, 2] as Vec3, 0));
    const chest = placeComponent(expandComponent(catalog.get('storage/chest')), pose([1, 1, 0] as Vec3, 0));
    const v = verticality([lamp, chest], { baseY: 1, height: 5 });
    expect(v).toEqual({ height: 5, levels: 2, ratio: 0.4, above: 1, blocks: 2 });
    const r = furnishRoom(shellRoom(10, 8, { height: 4 }), catalog.roomType('kitchen'), catalog, { seed: 2, dataVersion: DV });
    const part = r.quality.parts.find((p) => p.id === 'vertical')!;
    expect(part.label).toBe('Vertikalität');
    expect(part.detail).toMatch(/von 4 Höhenebenen/);
  });
});
