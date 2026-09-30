/**
 * K3c (research/17 §7.4): harte Regeln im Solver – `bedObstructed`, `noteBlockAirAbove`, `noHazardOnPath`,
 * `jobSiteReachable`, `portalClearance` – je positiv/negativ über den `RoomPlanner` (dieselben harten Regeln wie
 * `furnishRoom`), dazu die weiche Regel `distinctJobBlocks` und der Nachweis `infiniteWater`.
 */
import { describe, expect, it } from 'vitest';
import { Catalog, ComponentDefSchema, RoomTypeSchema, type ComponentDef } from '@mcda/catalog';
import { pose, type Quarter } from '@mcda/core';
import { RoomPlanner, expandComponent, furnishRoom, infiniteWater, placeComponent, type PlacedComponent, type RoomGeometry } from '../src/index.js';
import { DV, assertHardGuarantees, shellRoom } from './fixtures.js';

const P = { block: 'minecraft:oak_planks' };
const S = { block: 'minecraft:oak_slab' };
const BED = { H: { block: 'minecraft:red_bed', orient: { part: 'head' } }, F: { block: 'minecraft:red_bed', orient: { part: 'foot' } } };
let n = 0;
const comp = (o: Record<string, unknown>): ComponentDef =>
  ComponentDefSchema.parse({ id: `r/c${n++}`, kind: 'static', category: 'furniture', tags: ['x'], obtainability: 'survival', mount: 'floor', rotations: 'all', ...o });
const at = (def: ComponentDef, g: RoomGeometry, x: number, z: number, rot: Quarter = 0, y = g.baseY): PlacedComponent => placeComponent(expandComponent(def), pose([x, y, z], rot));
const cellsAt = (ps: readonly PlacedComponent[], x: number, z: number): boolean => ps.some((p) => p.cells.some((c) => c.pos[0] === x && c.pos[2] === z));
const box = comp({ layers: [['X']], legend: { X: P } });

describe('bedObstructed', () => {
  const g = shellRoom(8, 7, { inner: ['north'] });

  it('Vollblock über dem Bett (in der Komponente) → keine Pose; Stufe oder zweites Bett darüber erlaubt', () => {
    const planner = new RoomPlanner(g);
    expect(planner.candidates(comp({ layers: [['HF'], ['PP']], legend: { ...BED, P } }))).toHaveLength(0);
    expect(planner.candidates(comp({ layers: [['HF'], ['SS']], legend: { ...BED, S } })).length).toBeGreaterThan(0);
  });

  it('Etagenbett: das obere Bett nicht direkt unter der Decke (lichte Höhe 2 nein, 3 ja)', () => {
    const bunk = comp({ layers: [['HF'], ['HF']], legend: BED });
    expect(new RoomPlanner(shellRoom(8, 7, { height: 2 })).candidates(bunk)).toHaveLength(0);
    expect(new RoomPlanner(shellRoom(8, 7, { height: 3 })).candidates(bunk).length).toBeGreaterThan(0);
  });

  it('kein Vollblock auf ein vorhandenes Bett (Wandbord aus Planken nein, aus Stufen ja)', () => {
    const bed = comp({ rotations: 'backToWall', layers: [['H', 'F']], legend: BED });
    const planner = new RoomPlanner(g, [at(bed, g, 2, 0)]);
    const wall = (mat: object) => comp({ mount: 'wall', rotations: 'backToWall', wallHeight: 1, layers: [['X']], legend: { X: mat } });
    expect(planner.candidates(wall(P)).some((p) => cellsAt([p], 2, 0))).toBe(false);
    expect(planner.candidates(wall(S)).some((p) => cellsAt([p], 2, 0))).toBe(true);
  });

  it('Aufwachposition: ein Nachbarfeld des Betts bleibt frei', () => {
    const bed = comp({ rotations: 'backToWall', layers: [['H', 'F']], legend: BED });
    const planner = new RoomPlanner(g, [at(bed, g, 0, 0), at(box, g, 1, 0), at(box, g, 1, 1)]);
    const poses = planner.candidates(box);
    expect(poses.some((p) => cellsAt([p], 0, 2))).toBe(false); // letztes freies Nachbarfeld
    expect(poses.some((p) => cellsAt([p], 2, 2))).toBe(true);
  });
});

describe('noteBlockAirAbove', () => {
  const g = shellRoom(8, 7);
  const note = comp({ layers: [['N']], legend: { N: { block: 'minecraft:note_block' } } });
  const floating = (mat: object) => comp({ layers: [['.'], ['X']], legend: { X: mat } });

  it('über einem vorhandenen Notenblock nur Luft oder ein Kopf', () => {
    const planner = new RoomPlanner(g, [at(note, g, 3, 2)]);
    expect(planner.candidates(floating(P)).some((p) => cellsAt([p], 3, 2))).toBe(false);
    expect(planner.candidates(floating({ block: 'minecraft:creeper_head' })).some((p) => cellsAt([p], 3, 2))).toBe(true);
  });

  it('nicht direkt unter der Decke', () => {
    const onTop = comp({ layers: [['X'], ['N']], legend: { X: P, N: { block: 'minecraft:note_block' } } });
    expect(new RoomPlanner(shellRoom(8, 7, { height: 2 })).candidates(onTop)).toHaveLength(0);
    expect(new RoomPlanner(shellRoom(8, 7, { height: 3 })).candidates(onTop).length).toBeGreaterThan(0);
  });
});

describe('noHazardOnPath', () => {
  const g = shellRoom(8, 7);
  const fire = { block: 'minecraft:campfire' };

  it('frei stehendes Lagerfeuer, Wasser, Honig → keine Pose (man tritt hinein)', () => {
    const planner = new RoomPlanner(g);
    for (const mat of [fire, { block: 'minecraft:water' }, { block: 'minecraft:honey_block' }]) expect(planner.candidates(comp({ layers: [['X']], legend: { X: mat } }))).toHaveLength(0);
  });

  it('abgedeckt (Kessel darüber) oder eingefasst (Rinne) → erlaubt; offene Nische davor → nicht', () => {
    const planner = new RoomPlanner(shellRoom(8, 7, { inner: ['north'] }));
    expect(planner.candidates(comp({ layers: [['C'], ['K']], legend: { C: fire, K: { block: 'minecraft:cauldron' } } })).length).toBeGreaterThan(0);
    expect(planner.candidates(comp({ layers: [['sss', 'sCs', 'sss']], legend: { s: S, C: fire } })).length).toBeGreaterThan(0);
    const niche = (top: string) => comp({ rotations: 'backToWall', layers: [['MCM', 'S_S'], [top, '...']], legend: { M: P, S, C: fire, K: { block: 'minecraft:cauldron' } } });
    expect(planner.candidates(niche('M.M'))).toHaveLength(0);
    expect(planner.candidates(niche('MKM')).length).toBeGreaterThan(0);
  });

  it('Nachbarn schon belegt → das Feuer ist nicht auf dem Laufweg', () => {
    const planner = new RoomPlanner(g, [at(box, g, 2, 1), at(box, g, 4, 1), at(box, g, 3, 0), at(box, g, 3, 2)]);
    expect([...new Set(planner.candidates(comp({ layers: [['C']], legend: { C: fire } })).map((p) => p.pose.pos.join(',')))]).toEqual(['3,1,1']);
  });
});

describe('jobSiteReachable (Handels-Stationen)', () => {
  const g = shellRoom(8, 7, { inner: ['north'] });
  const station = (functionTags: string[]) => comp({ rotations: 'backToWall', functionTags, layers: [['J']], legend: { J: { block: 'minecraft:lectern' } } });

  it('der Arbeitsblock eines Stands behält ein freies Nachbarfeld (8er-Nachbarschaft)', () => {
    const blockers = [at(box, g, 1, 0), at(box, g, 3, 0), at(box, g, 1, 1), at(box, g, 3, 1)];
    const trade = new RoomPlanner(g, [at(station(['trade']), g, 2, 0), ...blockers]);
    expect(trade.candidates(box).some((p) => cellsAt([p], 2, 1))).toBe(false);
    // Werkstatt-Stationen (work:*) sind bewusst ausgenommen (Bestand bitgleich)
    const work = new RoomPlanner(g, [at(station(['work:librarian']), g, 2, 0), ...blockers]);
    expect(work.candidates(box).some((p) => cellsAt([p], 2, 1))).toBe(true);
  });
});

describe('portalClearance', () => {
  const frame = ['POOOOP', 'PO__OP', 'PO__OP', 'PO__OP', 'POOOOP'].reverse().map((r) => [r]);
  const portal = comp({ rotations: 'backToWall', tags: ['nether_portal'], layers: frame, legend: { P, O: { block: 'minecraft:obsidian' } }, masks: { clearance: [{ side: 'front', depth: 2, hard: true }] } });

  it('2 Zellen vor dem Portal bleiben frei – beim Setzen und danach', () => {
    const g = shellRoom(10, 7, { height: 5, inner: ['north'] });
    const planner = new RoomPlanner(g, [at(portal, g, 1, 0)]);
    const poses = planner.candidates(box);
    for (const x of [1, 2, 3, 4, 5, 6]) for (const z of [1, 2]) expect(poses.some((p) => cellsAt([p], x, z)), `${x},${z}`).toBe(false);
    expect(poses.some((p) => cellsAt([p], 1, 3))).toBe(true);
    // nur 1 Zelle Platz vor der Wand → kein Portal
    expect(new RoomPlanner(shellRoom(10, 4, { height: 5, inner: ['north'] })).candidates(portal)).toHaveLength(0);
    expect(new RoomPlanner(shellRoom(10, 5, { height: 5, inner: ['north'] })).candidates(portal).length).toBeGreaterThan(0);
  });
});

describe('distinctJobBlocks (weich) und infiniteWater (Nachweis)', () => {
  const stall = comp({
    id: 'r/stall', tags: ['stall'], rotations: 'backToWall', functionTags: ['trade'],
    // Fackel auf dem Villager-Platz (wie trade/villager_stall): eine reine Luftzelle wäre eine abgeschlossene Tasche
    variants: ['lectern', 'loom', 'smithing_table'].map((j) => ({ id: j, layers: [['PTP', 'PJP'], ['P_P', 'P_P'], ['PSP', 'PSP']], legend: { P, S, T: { block: 'minecraft:torch' }, J: { block: `minecraft:${j}` } } })),
  });

  it('Villager-Stände bekommen verschiedene Arbeitsblöcke (Signatur-Reihe und optionale Reihe)', () => {
    const rt = RoomTypeSchema.parse({ id: 'hall', name: 'Halle', minArea: 1, coverage: { target: 0 }, required: [{ tags: ['stall'], count: [1, 1], signature: true }], optional: [{ tags: ['stall'], count: [2, 2], pattern: { kind: 'row', gap: 0 } }] });
    let distinct = 0;
    for (let seed = 0; seed < 10; seed++) {
      const g = shellRoom(14, 8, { inner: ['north'] });
      const r = furnishRoom(g, rt, Catalog.of([stall]), { seed, dataVersion: DV });
      assertHardGuarantees(g, r);
      expect(r.warnings).toEqual([]);
      if (new Set(r.placements.map((p) => p.variantId)).size === 3) distinct++;
    }
    expect(distinct).toBe(10);
  });

  it('unendliche Quelle: 2×2 und 1×3 ja, 1×2 nein; Teilwert „Wasserquelle“ nur bei Wasser-Quellen im Raumtyp', () => {
    const W = { block: 'minecraft:water' };
    const pool = (rows: string[]) => comp({ tags: ['pool'], functionTags: ['water_source'], layers: [rows], legend: { W, T: { role: 'beam', shape: 'trapdoor' } } });
    const g = shellRoom(10, 8);
    expect(infiniteWater([at(pool(['TTTT', 'TWWT', 'TWWT', 'TTTT']), g, 1, 1)], g.baseY)).toBe(4);
    expect(infiniteWater([at(pool(['TTTTT', 'TWWWT', 'TTTTT']), g, 1, 1)], g.baseY)).toBe(1);
    expect(infiniteWater([at(pool(['TTTT', 'TWWT', 'TTTT']), g, 1, 1)], g.baseY)).toBe(0);
    const tub = pool(['TTTT', 'TWWT', 'TWWT', 'TTTT']);
    const bath = RoomTypeSchema.parse({ id: 'bath', name: 'Bad', minArea: 1, coverage: { target: 0 }, required: [{ tags: ['pool'], count: [1, 1] }], optional: [] });
    const r = furnishRoom(g, bath, Catalog.of([tub, box]), { seed: 0, dataVersion: DV });
    expect(r.quality.parts.find((q) => q.id === 'water')).toMatchObject({ value: 1 });
    const store = RoomTypeSchema.parse({ id: 's', name: 'Lager', minArea: 1, coverage: { target: 0 }, required: [{ tags: ['x'], count: [1, 1] }], optional: [] });
    expect(furnishRoom(g, store, Catalog.of([box]), { seed: 0, dataVersion: DV }).quality.parts.some((q) => q.id === 'water')).toBe(false);
  });
});
