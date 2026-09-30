/**
 * Spike M2 (Vanilla-Parität): Update-Regeln, die das Spiel beim Platzieren mit Updates nachrechnet, und die
 * Stützprüfung hängender Entities. Fälle aus dem In-Game-Round-Trip der Beispiel-Base (1.21.11) und der
 * Katalog-Parität (Gruppe P, spikes/ingame/ingame_tests_p.py).
 */
import type { Vec3 } from '@mcda/core';
import { nbt } from '@mcda/export';
import { Layer, VoxelVolume, blockState } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import {
  WorldView, checkHangingEntities, checkPairs, checkSupport, coverOfAbove, instrumentOf, isSolid, noteBlockInstrument,
  resolveBells, resolveCampfires, resolveConnections, resolveHugeMushrooms, resolveLeaves, resolveNoteBlocks, resolveSoil,
  resolveVanillaUpdates, resolveVines,
} from '../src/index.js';
import { platformView } from './fixtures.js';

type B = readonly [Vec3, string, Record<string, string>?];

function world(blocks: readonly B[], version = '1.21.11', size: Vec3 = [13, 8, 13], origin: Vec3 = [-6, -2, -6]): WorldView {
  const platform = platformView(version);
  const vol = VoxelVolume.create(size, origin);
  for (const [pos, name, props] of blocks) {
    const s = platform.registry.resolveState(name, props ?? {});
    vol.place(pos, { state: blockState(s.name, s.properties), owner: 't', layer: Layer.Furniture });
  }
  return new WorldView(vol, platform);
}

const at = (w: WorldView, p: Vec3): Record<string, string> => ({ ...w.state(p).properties });
const info = (name: string, props: Record<string, string> = {}, version = '1.21.11') => {
  const w = world([[[0, 0, 0], name, props]], version);
  return w.info([0, 0, 0]);
};

const FACING: Readonly<Record<string, number>> = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };
function frame(w: WorldView, blockPos: Vec3, facing: string, owner = 'f'): void {
  w.volume.addEntity({
    pos: [blockPos[0] + 0.5, blockPos[1] + 0.5, blockPos[2] + 0.5], blockPos,
    nbt: nbt.compound({ id: nbt.string('minecraft:item_frame'), Facing: nbt.byte(FACING[facing]!) }), owner, layer: Layer.Attachment,
  });
}
function painting(w: WorldView, blockPos: Vec3, facing: number, variant: string): void {
  w.volume.addEntity({
    pos: [blockPos[0] + 0.5, blockPos[1] + 0.5, blockPos[2] + 0.5], blockPos,
    nbt: nbt.compound({ id: nbt.string('minecraft:painting'), facing: nbt.byte(facing), variant: nbt.string(`minecraft:${variant}`) }), owner: 'p', layer: Layer.Attachment,
  });
}

describe('isSolid (T5-Regel: mittlere AABB-Kante ≥ 35/48, Höhe ≥ 1 oder forceSolidOn)', () => {
  it('im Spiel bestätigt (T5): Truhe, Fass, Zaun, Mauer, Falltür zu, Gitter, Scheibe, Kette senkrecht, Laterne sind fest', () => {
    for (const [n, p] of [['chest', {}], ['barrel', {}], ['oak_fence', {}], ['cobblestone_wall', { up: 'true' }], ['oak_trapdoor', { half: 'bottom' }],
      ['iron_bars', {}], ['glass_pane', {}], ['iron_chain', { axis: 'y' }], ['lantern', {}], ['lantern', { hanging: 'true' }], ['stone', {}],
      ['oak_slab', {}], ['red_bed', { part: 'foot' }], ['campfire', {}], ['oak_sign', {}], ['oak_pressure_plate', {}], ['white_banner', {}]] as const) {
      expect(isSolid(info(n, p as Record<string, string>)), n).toBe(true);
    }
  });
  it('nicht fest: Teppich, Blumentopf (auch bepflanzt), Kerze, Kopf, Fackel, Luft, Schnee 1–2, Verstärker, Leiter', () => {
    for (const [n, p] of [['white_carpet', {}], ['flower_pot', {}], ['potted_fern', {}], ['candle', {}], ['zombie_head', {}], ['skeleton_wall_skull', {}],
      ['torch', {}], ['air', {}], ['snow', { layers: '1' }], ['snow', { layers: '8' }], ['repeater', {}], ['ladder', {}], ['end_rod', { facing: 'up' }],
      ['big_dripleaf', {}], ['moss_carpet', {}]] as const) {
      expect(isSolid(info(n, p as Record<string, string>)), n).toBe(false);
    }
  });
  it('im Spiel gemessen (Gruppe P): forceSolidOn bei Kuchen, offenem Zauntor, Schildkrötenei, Blitzableiter quer, Tropfsteinspitze', () => {
    for (const [n, p] of [['cake', { bites: '2' }], ['oak_fence_gate', { open: 'true' }], ['turtle_egg', {}], ['lightning_rod', { facing: 'east' }],
      ['pointed_dripstone', { thickness: 'tip' }], ['conduit', {}]] as const) {
      expect(isSolid(info(n, p as Record<string, string>)), n).toBe(true);
    }
  });
});

describe('Blätter distance (LeavesBlock#updateDistance)', () => {
  it('Taxicab-BFS über Blätter ab dem Stamm, getrennte Blätter 7', () => {
    const line: B[] = [[[-5, 0, 0], 'oak_log', { axis: 'y' }]];
    for (let x = -4; x <= 4; x++) line.push([[x, 0, 0], 'oak_leaves']);
    line.push([[0, 3, 3], 'birch_leaves']);
    const w = world(line);
    resolveLeaves(w);
    const d = (x: number): string => at(w, [x, 0, 0])['distance']!;
    expect([-4, -3, -2, -1, 0, 1, 2, 3, 4].map(d)).toEqual(['1', '2', '3', '4', '5', '6', '7', '7', '7']);
    expect(at(w, [0, 3, 3])['distance']).toBe('7');
  });
  it('gemischte Arten, Stamm auch diagonal NICHT (nur 6 Nachbarn), 26.3 über #prevents_nearby_leaf_decay', () => {
    for (const v of ['1.21.11', '26.3']) {
      const w = world([[[0, 0, 0], 'spruce_log', { axis: 'y' }], [[0, 1, 0], 'azalea_leaves'], [[1, 1, 0], 'oak_leaves'], [[1, 1, 1], 'oak_leaves'], [[1, 0, 1], 'birch_leaves']], v);
      resolveLeaves(w);
      const probes: Vec3[] = [[0, 1, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]];
      expect(probes.map((p) => at(w, p)['distance'])).toEqual(['1', '2', '3', '4']);
    }
  });
});

describe('Riesenpilz-Flächen (HugeMushroomBlock#updateShape)', () => {
  it('Flächen zu gleicher Art false, zu anderer Art unverändert', () => {
    const w = world([[[0, 0, 0], 'mushroom_stem'], [[1, 0, 0], 'mushroom_stem'], [[0, 1, 0], 'mushroom_stem'], [[-1, 0, 0], 'red_mushroom_block'], [[0, 0, 1], 'stone']]);
    resolveHugeMushrooms(w);
    expect(at(w, [0, 0, 0])).toMatchObject({ east: 'false', up: 'false', west: 'true', south: 'true', north: 'true', down: 'true' });
    expect(at(w, [1, 0, 0])).toMatchObject({ west: 'false', east: 'true' });
    expect(at(w, [-1, 0, 0])['east']).toBe('true');
  });
});

describe('Notenblock instrument (NoteBlock#setInstrument)', () => {
  it('Unterlage bestimmt das Instrument, Kopf darüber gewinnt', () => {
    const cases: [string, string][] = [
      ['dark_oak_log', 'bass'], ['spruce_planks', 'bass'], ['oak_slab', 'bass'], ['mushroom_stem', 'bass'], ['chest', 'bass'],
      ['stone', 'basedrum'], ['stone_bricks', 'basedrum'], ['cobblestone_wall', 'basedrum'], ['deepslate_tiles', 'basedrum'], ['white_terracotta', 'basedrum'],
      ['sand', 'snare'], ['gravel', 'snare'], ['white_concrete_powder', 'snare'], ['glass', 'hat'], ['glass_pane', 'hat'],
      ['white_wool', 'guitar'], ['clay', 'flute'], ['gold_block', 'bell'], ['hay_block', 'banjo'], ['glowstone', 'pling'],
      ['dirt', 'harp'], ['grass_block', 'harp'], ['stone_button', 'harp'], ['white_carpet', 'harp'], ['crimson_nylium', 'basedrum'], ['crimson_stem', 'bass'],
    ];
    for (const [below, want] of cases) expect(instrumentOf(below), below).toBe(want);
    expect(noteBlockInstrument(blockState('stone', {}), blockState('zombie_head', {}))).toBe('zombie');
    expect(noteBlockInstrument(blockState('player_head', {}), blockState('air', {}))).toBe('harp');
  });
  it('Pass setzt instrument an Ort und Stelle (Beispiel-Base: Notenblock auf dunklem Eichenstamm → bass)', () => {
    const w = world([[[0, 0, 0], 'note_block'], [[0, -1, 0], 'dark_oak_log', { axis: 'y' }], [[2, 0, 0], 'note_block'], [[2, -1, 0], 'stone'], [[2, 1, 0], 'skeleton_skull']]);
    resolveNoteBlocks(w);
    expect(at(w, [0, 0, 0])['instrument']).toBe('bass');
    expect(at(w, [2, 0, 0])['instrument']).toBe('skeleton');
  });
});

describe('Boden: Trampelpfad/Ackerland, snowy, moisture', () => {
  it('Trampelpfad unter festem Block → Erde; unter Zauntor, Teppich, Blume bleibt er; Laterne ist fest', () => {
    const w = world([
      [[0, 0, 0], 'dirt_path'], [[0, 1, 0], 'cobblestone'],
      [[1, 0, 0], 'dirt_path'], [[1, 1, 0], 'oak_fence_gate'],
      [[2, 0, 0], 'dirt_path'], [[2, 1, 0], 'white_carpet'],
      [[3, 0, 0], 'dirt_path'], [[3, 1, 0], 'poppy'],
      [[4, 0, 0], 'dirt_path'], [[4, 1, 0], 'lantern'],
      [[-1, 0, 0], 'farmland'], [[-1, 1, 0], 'oak_slab'],
    ]);
    resolveSoil(w);
    expect([0, 1, 2, 3, 4, -1].map((x) => w.state([x, 0, 0]).name)).toEqual(['dirt', 'dirt_path', 'dirt_path', 'dirt_path', 'dirt', 'dirt']);
  });
  it('Ackerland neben Wasser (≤ 4, gleiche Höhe oder +1) → moisture 7; weiter weg bleibt es', () => {
    const w = world([[[0, 0, 0], 'farmland'], [[4, 1, 4], 'oak_slab', { waterlogged: 'true' }], [[-5, 0, 0], 'farmland'], [[5, 0, 5], 'farmland']]);
    resolveSoil(w);
    expect(at(w, [0, 0, 0])['moisture']).toBe('7');
    expect(at(w, [-5, 0, 0])['moisture']).toBe('0');
    expect(at(w, [5, 0, 5])['moisture']).toBe('7');
  });
  it('Gras/Podsol/Myzel: snowy nach Schnee darüber', () => {
    const w = world([[[0, 0, 0], 'grass_block', { snowy: 'true' }], [[1, 0, 0], 'podzol'], [[1, 1, 0], 'snow', { layers: '1' }]]);
    resolveSoil(w);
    expect(at(w, [0, 0, 0])['snowy']).toBe('false');
    expect(at(w, [1, 0, 0])['snowy']).toBe('true');
  });
});

describe('Lagerfeuer, Glocke, Ranken, Mauer-Abdeckung', () => {
  it('Lagerfeuer auf Heuballen = Signalfeuer', () => {
    const w = world([[[0, 0, 0], 'campfire'], [[0, -1, 0], 'hay_block'], [[2, 0, 0], 'campfire', { signal_fire: 'true' }], [[2, -1, 0], 'stone']]);
    resolveCampfires(w);
    expect(at(w, [0, 0, 0])['signal_fire']).toBe('true');
    expect(at(w, [2, 0, 0])['signal_fire']).toBe('false');
  });
  it('Glocke: single_wall mit Wand gegenüber → double_wall, double_wall ohne Gegenwand → single_wall', () => {
    const w = world([[[0, 0, 0], 'bell', { attachment: 'single_wall', facing: 'north' }], [[0, 0, -1], 'stone'], [[0, 0, 1], 'stone'],
      [[3, 0, 0], 'bell', { attachment: 'double_wall', facing: 'north' }], [[3, 0, -1], 'stone']]);
    resolveBells(w);
    expect(at(w, [0, 0, 0])['attachment']).toBe('double_wall');
    expect(at(w, [3, 0, 0])).toMatchObject({ attachment: 'single_wall', facing: 'north' });
  });
  it('Ranke: Fläche ohne Wand fällt weg, bleibt unter Ranke mit derselben Fläche; ohne Fläche = Stützverstoß', () => {
    const w = world([[[0, 1, 0], 'vine', { north: 'true' }], [[0, 1, -1], 'stone'], [[0, 0, 0], 'vine', { north: 'true', east: 'true' }], [[3, 0, 0], 'vine', { up: 'true' }]]);
    resolveVines(w);
    expect(at(w, [0, 0, 0])).toMatchObject({ north: 'true', east: 'false' });
    expect(at(w, [3, 0, 0])['up']).toBe('false');
    expect(checkSupport(w).filter((v) => v.block === 'vine').map((v) => v.pos)).toEqual([[3, 0, 0]]);
  });
  it('Mauer: stehende Laterne, Kerze, Blumentopf heben den Pfosten; Teppich macht die Seiten hoch (T3)', () => {
    for (const top of ['lantern', 'candle', 'flower_pot', 'chest']) {
      const w = world([[[-1, 0, 0], 'cobblestone_wall'], [[0, 0, 0], 'cobblestone_wall'], [[1, 0, 0], 'cobblestone_wall'], [[0, 1, 0], top]]);
      resolveConnections(w);
      expect(at(w, [0, 0, 0]), top).toMatchObject({ up: 'true', east: 'low', west: 'low' });
    }
    const w = world([[[-1, 0, 0], 'cobblestone_wall'], [[0, 0, 0], 'cobblestone_wall'], [[1, 0, 0], 'cobblestone_wall'], [[0, 1, 0], 'red_carpet']]);
    resolveConnections(w);
    expect(at(w, [0, 0, 0])).toMatchObject({ up: 'false', east: 'tall', west: 'tall' });
    expect(coverOfAbove(w.info([0, 5, 0])).post).toBe(false);
  });
});

describe('Hängende Entities (ItemFrame/HangingEntity#survives) → entity_support', () => {
  const wall: B[] = [];
  for (let x = -3; x <= 3; x++) for (let y = 0; y <= 3; y++) wall.push([[x, y, -1], 'stone_bricks']);

  it('Rahmen an Stein, Truhe, Laterne, Zaun halten; an Teppich und Blumentopf nicht', () => {
    const w = world([[[0, 0, 0], 'chest', { facing: 'south' }], [[2, 0, 0], 'white_carpet'], [[-2, 0, 0], 'flower_pot'], [[-4, 0, 0], 'lantern'], [[4, 0, 0], 'oak_fence']]);
    frame(w, [0, 0, 1], 'south'); // an der Truhenfront
    frame(w, [2, 1, 0], 'up'); //   liegend auf Teppich
    frame(w, [-2, 0, 1], 'south'); // am Blumentopf
    frame(w, [-4, 0, 1], 'south'); // an der Laterne
    frame(w, [4, 0, 1], 'south'); // an der Zaunseite
    const v = checkHangingEntities(w);
    expect(v.map((x) => x.pos)).toEqual([[2, 1, 0], [-2, 0, 1]]);
    expect(v.every((x) => x.kind === 'entity_support' && x.severity === 'error')).toBe(true);
  });

  it('Beispiel-Base (weapon_rack#low alt): Zaunarm zur Wand ragt in die Rahmenzelle → Rahmen fällt; ohne Arm zur Wand hält er', () => {
    const w = world([...wall, [[0, 0, 0], 'spruce_fence'], [[1, 0, 0], 'spruce_fence'], [[3, 0, 1], 'spruce_fence']]);
    resolveConnections(w); // Zäune verbinden sich mit der Wand (Norden) und untereinander
    expect(at(w, [0, 0, 0])['north']).toBe('true');
    frame(w, [0, 1, 0], 'south');
    frame(w, [1, 1, 0], 'south');
    frame(w, [0, 2, 0], 'south'); // eine Zelle höher: frei
    frame(w, [3, 1, 1], 'up'); //    liegend auf einem Zaun: kein Platz
    const v = checkHangingEntities(w);
    expect(v.map((x) => x.pos)).toEqual([[0, 1, 0], [1, 1, 0], [3, 1, 1]]);
    expect(v[0]!.message).toMatch(/Kollision mit spruce_fence/);
  });

  it('Verstärker trägt seitliche Rahmen, aber keinen liegenden; überlappende Rahmen melden', () => {
    const w = world([[[0, 0, 0], 'stone'], [[0, 1, 0], 'repeater', { facing: 'north' }], [[2, 0, 0], 'stone'], [[2, 1, 0], 'comparator', { facing: 'north' }]]);
    frame(w, [0, 1, 1], 'south');
    frame(w, [2, 2, 0], 'up');
    frame(w, [0, 1, 1], 'south', 'g');
    const v = checkHangingEntities(w);
    expect(v.map((x) => x.pos)).toEqual([[2, 2, 0], [0, 1, 1]]);
    expect(v[1]!.message).toMatch(/überlappt/);
  });

  it('Gemälde: ganze Rückfläche fest; 2×2 an der Wand hält, mit Teppich-Lücke nicht', () => {
    const w = world(wall);
    painting(w, [0, 1, 0], 0, 'bust'); // facing Süd (0), 2×2: gerade Größe → +½ Richtung CCW(Süd) = Ost und nach oben: x 0..1, y 1..2
    expect(checkHangingEntities(w)).toEqual([]);
    const w2 = world([...wall.filter(([p]) => !(p[0] === 1 && p[1] === 2)), [[1, 2, -1], 'white_carpet']]);
    painting(w2, [0, 1, 0], 0, 'bust');
    expect(checkHangingEntities(w2).map((x) => x.message)).toEqual([expect.stringMatching(/white_carpet .* nicht „fest“/)]);
  });
});

describe('Paare und Stützen (M2-Ergänzungen)', () => {
  it('Tür-Hälften: open/powered müssen gleich sein; Bett: occupied', () => {
    const w = world([[[0, 0, 0], 'oak_door', { half: 'lower', facing: 'south', open: 'true' }], [[0, 1, 0], 'oak_door', { half: 'upper', facing: 'south', open: 'false' }],
      [[2, 0, 0], 'red_bed', { part: 'foot', facing: 'south', occupied: 'true' }], [[2, 0, 1], 'red_bed', { part: 'head', facing: 'south' }]]);
    const kinds = checkPairs(w).map((v) => v.kind);
    expect(kinds.filter((k) => k === 'door_half')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'bed_half')).toHaveLength(2);
  });
  it('Kuchen braucht festen Block (nicht Teppich), Hängewurzeln volle Unterseite, Zuckerrohr Wasser, Doppelpflanze beide Hälften', () => {
    const w = world([
      [[0, 0, 0], 'cake'], [[0, -1, 0], 'white_carpet'], [[0, -2, 0], 'stone'],
      [[2, 0, 0], 'cake'], [[2, -1, 0], 'oak_slab', { type: 'top' }],
      [[4, 0, 0], 'hanging_roots'], [[4, 1, 0], 'oak_leaves'],
      [[-2, 0, 0], 'sugar_cane'], [[-2, -1, 0], 'dirt'],
      [[-4, 0, 0], 'tall_grass', { half: 'lower' }], [[-4, -1, 0], 'grass_block'],
    ]);
    const bad = checkSupport(w).map((v) => `${v.block}@${v.pos!.join(',')}`).sort();
    expect(bad).toEqual(['cake@0,0,0', 'hanging_roots@4,0,0', 'sugar_cane@-2,0,0', 'tall_grass@-4,0,0'].sort());
  });
});

describe('alle Pässe zusammen sind idempotent und deterministisch', () => {
  it('zweiter Lauf ändert nichts', () => {
    const blocks: B[] = [[[0, 0, 0], 'oak_log', { axis: 'y' }], [[0, 1, 0], 'oak_leaves'], [[1, 1, 0], 'oak_leaves'], [[3, 0, 0], 'note_block'], [[3, -1, 0], 'sand'],
      [[-2, 0, 0], 'mushroom_stem'], [[-2, 1, 0], 'mushroom_stem'], [[-4, 0, 0], 'dirt_path'], [[-4, 1, 0], 'stone']];
    const a = world(blocks);
    resolveVanillaUpdates(a);
    const snap = [...a.volume.cells()].map((c) => `${c.pos}|${c.state.name}|${JSON.stringify(c.state.properties)}`);
    resolveVanillaUpdates(a);
    expect([...a.volume.cells()].map((c) => `${c.pos}|${c.state.name}|${JSON.stringify(c.state.properties)}`)).toEqual(snap);
    const b = world(blocks);
    resolveVanillaUpdates(b);
    expect([...b.volume.cells()].map((c) => `${c.pos}|${c.state.name}|${JSON.stringify(c.state.properties)}`)).toEqual(snap);
  });
});
