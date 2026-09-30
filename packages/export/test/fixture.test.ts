import { describe, expect, it } from 'vitest';
import { canonicalState, DV, prepareVolume, type ExportBlock } from '../src/index.js';
import { validateAgainstRegistry } from './fixtures/registry-check.js';
import { loadRegistry } from './fixtures/stress.js';
import { buildTestEntries, buildTestVolume } from './fixtures/testset.js';

const TEST_VERSIONS = [DV.MC_1_21_1, DV.MC_1_21_11, DV.MC_26_3] as const;
const ALL_VERSIONS = [DV.MC_1_20_1, ...TEST_VERSIONS] as const;

type Dir = 'north' | 'east' | 'south' | 'west';
const VEC: Readonly<Record<Dir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const CCW: Record<Dir, Dir> = { north: 'west', west: 'south', south: 'east', east: 'north' };
const OPP: Record<Dir, Dir> = { north: 'south', south: 'north', east: 'west', west: 'east' };
const axis = (d: Dir) => (d === 'north' || d === 'south' ? 'z' : 'x');

/** Port von StairBlock#getStairsShape (Vanilla), um die Fixture-Shapes gegenzuprüfen. */
function vanillaStairShape(get: (x: number, y: number, z: number) => ExportBlock | undefined, b: ExportBlock): string {
  const isStair = (s?: ExportBlock) => !!s && s.name.endsWith('_stairs');
  const p = b.properties!;
  const facing = p['facing'] as Dir;
  const half = p['half'];
  const at = (d: Dir) => get(b.pos[0] + VEC[d][0], b.pos[1], b.pos[2] + VEC[d][1]);
  const canTakeShape = (face: Dir) => {
    const n = at(face);
    return !isStair(n) || n!.properties!['facing'] !== facing || n!.properties!['half'] !== half;
  };
  const front = at(facing);
  if (isStair(front) && front!.properties!['half'] === half) {
    const d2 = front!.properties!['facing'] as Dir;
    if (axis(d2) !== axis(facing) && canTakeShape(OPP[d2])) return d2 === CCW[facing] ? 'outer_left' : 'outer_right';
  }
  const back = at(OPP[facing]);
  if (isStair(back) && back!.properties!['half'] === half) {
    const d3 = back!.properties!['facing'] as Dir;
    if (axis(d3) !== axis(facing) && canTakeShape(d3)) return d3 === CCW[facing] ? 'inner_left' : 'inner_right';
  }
  return 'straight';
}

describe('Fixture T1-Testset', () => {
  for (const dv of ALL_VERSIONS) {
    it(`ist gültig gegen die Registry von DataVersion ${dv} (IDs, vollständige Properties, Items, Components)`, () => {
      const v = buildTestVolume(dv);
      expect(validateAgainstRegistry(v, loadRegistry(dv))).toEqual([]);
      expect(prepareVolume(v).warnings).toEqual([]);
    });
  }

  it('hat ~40 Einträge und alle 5 Treppenformen', () => {
    const entries = buildTestEntries(DV.MC_1_21_11);
    expect(entries.length).toBeGreaterThanOrEqual(40);
    const shapes = new Set(entries.flatMap((e) => (e.block?.name.endsWith('_stairs') ? [e.block.properties!['shape']] : [])));
    expect([...shapes].sort()).toEqual(['inner_left', 'inner_right', 'outer_left', 'outer_right', 'straight']);
  });

  it('Treppen-Shapes entsprechen der Vanilla-Nachbarlogik', () => {
    const v = buildTestVolume(DV.MC_1_21_11);
    const map = new Map(v.blocks.map((b) => [b.pos.join(','), b]));
    const get = (x: number, y: number, z: number) => map.get(`${x},${y},${z}`);
    for (const b of v.blocks.filter((x) => x.name.endsWith('_stairs'))) {
      expect(vanillaStairShape(get, b), `${b.pos}`).toBe(b.properties!['shape']);
    }
  });

  it('Zaun-/Scheiben-/Mauerverbindungen sind symmetrisch und nur zwischen Nachbarn gesetzt', () => {
    const v = buildTestVolume(DV.MC_1_21_11);
    const map = new Map(v.blocks.map((b) => [b.pos.join(','), b]));
    const connectable = (b: ExportBlock) => /_fence$|glass_pane$|_wall$/.test(b.name);
    for (const b of v.blocks.filter(connectable)) {
      for (const d of ['north', 'east', 'south', 'west'] as Dir[]) {
        const val = b.properties![d]!;
        const connected = val === 'true' || val === 'low' || val === 'tall';
        const n = map.get(`${b.pos[0] + VEC[d][0]},${b.pos[1]},${b.pos[2] + VEC[d][1]}`);
        const nConnected = !!n && connectable(n) && ['true', 'low', 'tall'].includes(n.properties![OPP[d]]!);
        expect(connected, `${b.name}@${b.pos} ${d}`).toBe(nConnected);
      }
    }
  });

  it('Doppeltruhe: gleiches facing, left hat Partner im Uhrzeigersinn; Bücherregal-States passen zu Items', () => {
    const v = buildTestVolume(DV.MC_1_21_11);
    const chests = v.blocks.filter((b) => b.name === 'minecraft:chest');
    const left = chests.find((c) => c.properties!['type'] === 'left')!;
    const right = chests.find((c) => c.properties!['type'] === 'right')!;
    expect(left.properties!['facing']).toBe('north');
    expect(right.properties!['facing']).toBe('north');
    expect(right.pos).toEqual([left.pos[0] + 1, left.pos[1], left.pos[2]]); // north → Partner im Osten
    const shelf = v.blocks.find((b) => b.name === 'minecraft:chiseled_bookshelf')!;
    const items = shelf.blockEntity!.value['Items'];
    const slots = items?.type === 'list'
      ? items.value.map((i) => (i.type === 'compound' && i.value['Slot']?.type === 'byte' ? i.value['Slot'].value : -1)) : [];
    for (let s = 0; s < 6; s++) expect(shelf.properties![`slot_${s}_occupied`]).toBe(String(slots.includes(s)));
  });

  it('versionsabhängige Unterschiede', () => {
    const names = (dv: number) => new Set(buildTestVolume(dv).blocks.map((b) => b.name));
    expect(names(DV.MC_1_21_1).has('minecraft:chain')).toBe(true);
    expect(names(DV.MC_1_21_11).has('minecraft:iron_chain')).toBe(true);
    const stand = (dv: number) => buildTestVolume(dv).entities.find((e) => {
      const id = e.nbt.value['id'];
      return id?.type === 'string' && id.value === 'minecraft:armor_stand';
    })!.nbt.value;
    expect(Object.keys(stand(DV.MC_1_21_1))).toContain('ArmorItems');
    expect(Object.keys(stand(DV.MC_1_21_11))).toContain('equipment');
    const sign = (dv: number) => buildTestVolume(dv).blocks.find((b) => b.name === 'minecraft:oak_sign')!;
    const line0 = (dv: number) => {
      const ft = sign(dv).blockEntity!.value['front_text'];
      const msgs = ft?.type === 'compound' ? ft.value['messages'] : undefined;
      const first = msgs?.type === 'list' ? msgs.value[0] : undefined;
      return first?.type === 'string' ? first.value : undefined;
    };
    expect(line0(DV.MC_1_21_1)).toBe('"Dungeon"'); // JSON-String bis 1.21.4
    expect(line0(DV.MC_1_21_11)).toBe('Dungeon'); // NBT-Text ab 1.21.5
    // rotation immer explizit (26.1+ Default 8 statt 0)
    expect(canonicalState('oak_sign', sign(DV.MC_26_3).properties).properties['rotation']).toBe('4');
  });
});
