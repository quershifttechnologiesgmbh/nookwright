import { describe, expect, it } from 'vitest';
import {
  buildLitematicTagMulti, buildSpongeTag, buildStructureTag, DV, EXPORT_FORMATS, ExportValidationError, nbt,
  parseLitematicTag, parseSpongeTag, placeTilesFunction, prepareVolume, tileVolume, toNbtCompound,
  type ExportBlock, type ExportEntity, type ExportVolume, type NbtCompound,
} from '../src/index.js';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { exportFile, importFile } from '../src/node.js';
import { buildStressVolume } from './fixtures/stress.js';
import { buildTestVolume } from './fixtures/testset.js';
import { normalized, readNbt, writeNbt } from './util.js';

describe('Paletten-Grenzfälle (Stress, 26.3-Registry)', () => {
  // Nicht-Luft-States; Palette inkl. Luft ist jeweils +1
  for (const p of [1, 3, 4, 15, 16, 31, 127, 128, 300, 1100]) {
    it(`Palette ${p}+Luft, ungerade Größe`, () => {
      const v = buildStressVolume(DV.MC_26_3, [13, 11, 9], p, p);
      for (const fmt of EXPORT_FORMATS) {
        const back = importFile(fmt, exportFile(fmt, v, { date: 0 }));
        expect(normalized(back), fmt).toEqual(normalized(v));
      }
      const lit = parseLitematicTag(readNbt(exportFile('litematic', v)).root).regions[0]!;
      expect(lit.paletteSize).toBe(p + 1);
      expect(lit.bits).toBe(Math.max(2, Math.ceil(Math.log2(p + 1))));
      const sp = parseSpongeTag(readNbt(exportFile('schem', v)).root);
      expect(sp.paletteSize).toBe(p + 1);
    });
  }

  it('großes Volumen 128×64×128 (1 Mio. Blöcke) in vertretbarer Zeit', { timeout: HEAVY_TIMEOUT }, () => {
    const v = buildStressVolume(DV.MC_26_3, [128, 64, 128], 200, 99);
    const lit = exportFile('litematic', v, { date: 0 });
    const schem = exportFile('schem', v, { date: 0 });
    expect(importFile('litematic', lit).blocks.length).toBe(v.blocks.length);
    expect(importFile('schem', schem).blocks.length).toBe(v.blocks.length);
  });
});

describe('Litematica: mehrere Regionen und negative Größen', () => {
  it('zwei Regionen mit Versatz', () => {
    const a = buildTestVolume(DV.MC_1_21_11);
    const b: ExportVolume = { ...buildStressVolume(DV.MC_1_21_11, [4, 3, 5], 10, 3), name: 'b' };
    const tag = buildLitematicTagMulti(
      [{ name: 'raum_a', position: [0, 0, 0], volume: a }, { name: 'raum_b', position: [25, 2, -3], volume: b }],
      { name: 'multi', dataVersion: DV.MC_1_21_11 },
    );
    const r = parseLitematicTag(readNbt(writeNbt(tag)).root);
    expect(r.regions.map((x) => x.name)).toEqual(['raum_a', 'raum_b']);
    expect(r.regions[1]!.position).toEqual([25, 2, -3]);
    expect(normalized(r.regions[1]!.volume)).toEqual(normalized({ ...b, name: 'multi' }));
    const enc = tag.value['Metadata'];
    expect(enc?.type === 'compound' && enc.value['EnclosingSize']).toEqual(nbt.compound({ x: nbt.int(29), y: nbt.int(5), z: nbt.int(15) }));
  });

  it('negative Region-Größe (Region erstreckt sich in negative Richtung)', () => {
    const b = buildStressVolume(DV.MC_1_21_11, [4, 3, 5], 10, 3);
    const tag = buildLitematicTagMulti([{ name: 'r', position: [7, 0, 0], volume: b }], { name: 'neg', dataVersion: DV.MC_1_21_11 });
    // wie Litematica es bei „von rechts nach links“ gezogenen Boxen speichert: Position = Ecke, Size negativ
    const regions = tag.value['Regions'] as NbtCompound;
    const r = regions.value['r'] as NbtCompound;
    const patched = nbt.compound({ ...tag.value, Regions: nbt.compound({ r: nbt.compound({
      ...r.value,
      Position: nbt.compound({ x: nbt.int(10), y: nbt.int(2), z: nbt.int(0) }),
      Size: nbt.compound({ x: nbt.int(-4), y: nbt.int(-3), z: nbt.int(5) }),
    }) }) });
    const read = parseLitematicTag(patched).regions[0]!;
    expect(read.position).toEqual([7, 0, 0]);
    expect(normalized(read.volume)).toEqual(normalized({ ...b, name: 'neg' }));
  });
});

describe('48³-Kacheln für Vanilla-.nbt', () => {
  it('Kacheln setzen sich exakt zum Original zusammen', () => {
    const base = buildStressVolume(DV.MC_1_21_11, [100, 20, 60], 50, 5);
    const v: ExportVolume = {
      ...base,
      entities: [{ pos: [60.5, 1, 50.5], blockPos: [60, 1, 50], nbt: nbt.compound({ id: nbt.string('minecraft:armor_stand') }) }],
    };
    const tiles = tileVolume(v, 48);
    expect(tiles.length).toBe(3 * 1 * 2);
    expect(tiles.every((t) => t.volume.size.every((s) => s <= 48))).toBe(true);
    // wieder zusammensetzen
    const blocks: ExportBlock[] = [];
    const entities: ExportEntity[] = [];
    for (const t of tiles) {
      const o = t.origin;
      const back = importFile('nbt', exportFile('nbt', t.volume));
      for (const b of back.blocks) blocks.push({ ...b, pos: [b.pos[0] + o[0], b.pos[1] + o[1], b.pos[2] + o[2]] });
      for (const e of back.entities) {
        entities.push({
          ...e,
          pos: [e.pos[0] + o[0], e.pos[1] + o[1], e.pos[2] + o[2]],
          blockPos: [e.blockPos[0] + o[0], e.blockPos[1] + o[1], e.blockPos[2] + o[2]],
        });
      }
    }
    expect(normalized({ ...v, blocks, entities })).toEqual(normalized(v));
    const fn = placeTilesFunction(tiles, 'da');
    expect(fn.split('\n')[1]).toBe('place template da:stress_p50_1_0_0 ~48 ~0 ~0 none none 1 0 strict');
  });
});

describe('structure_void', () => {
  it('.nbt lässt structure_void weg (Welt bleibt dort unverändert), .schem/.litematic behalten ihn', () => {
    const v: ExportVolume = {
      name: 'void', dataVersion: DV.MC_1_21_11, size: [2, 1, 1], entities: [],
      blocks: [{ pos: [0, 0, 0], name: 'minecraft:structure_void' }, { pos: [1, 0, 0], name: 'minecraft:stone' }],
    };
    expect(importFile('nbt', exportFile('nbt', v)).blocks.map((b) => b.name)).toEqual(['minecraft:stone']);
    for (const fmt of ['schem', 'litematic'] as const) {
      expect(importFile(fmt, exportFile(fmt, v)).blocks.map((b) => b.name)).toEqual(['minecraft:structure_void', 'minecraft:stone']);
    }
    // Default: fehlende Position wird explizite Luft; Modus 'void': Luft entfällt (sparse)
    const onlyStone: ExportVolume = { ...v, blocks: [v.blocks[1]!] };
    const count = (t: NbtCompound) => (t.value['blocks']?.type === 'list' ? t.value['blocks'].value.length : -1);
    expect(count(buildStructureTag(onlyStone))).toBe(2);
    expect(count(buildStructureTag(onlyStone, { air: 'void' }))).toBe(1);
    expect(importFile('nbt', exportFile('nbt', onlyStone, { air: 'void' })).blocks).toHaveLength(1);
  });
});

describe('Validierung', () => {
  const base = (blocks: ExportBlock[], entities: ExportEntity[] = []): ExportVolume => ({
    name: 't', dataVersion: DV.MC_1_21_11, size: [2, 2, 2], blocks, entities,
  });

  it('Fehler: außerhalb, doppelt, fehlende id, Luft mit BE, kein Compound', () => {
    const v = base([
      { pos: [2, 0, 0], name: 'stone' },
      { pos: [0, 0, 0], name: 'stone' }, { pos: [0, 0, 0], name: 'dirt' },
      { pos: [1, 0, 0], name: 'chest', blockEntity: toNbtCompound({ Items: [] }) },
      { pos: [1, 1, 0], name: 'air', blockEntity: toNbtCompound({ id: 'minecraft:chest' }) },
      { pos: [0, 1, 1], name: 'chest', blockEntity: { id: 'minecraft:chest' } as unknown as NbtCompound },
    ], [{ pos: [0.5, 0, 0.5], blockPos: [0, 0, 0], nbt: nbt.compound({}) }]);
    expect(() => prepareVolume(v)).toThrow(ExportValidationError);
    try { prepareVolume(v); } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/außerhalb/);
      expect(msg).toMatch(/doppelt/);
      expect(msg).toMatch(/blockEntity.id/);
      expect(msg).toMatch(/Luft mit Block-Entity/);
      expect(msg).toMatch(/kein NBT-Compound/);
      expect(msg).toMatch(/nbt.id/);
    }
  });

  it('Warnungen: Positionsfelder im NBT, floor(pos) ≠ blockPos', () => {
    const v = base(
      [{ pos: [0, 0, 0], name: 'chest', blockEntity: toNbtCompound({ id: 'chest', x: 5 }) }],
      [{ pos: [0.5, 0.5, 1.5], blockPos: [0, 0, 0], nbt: toNbtCompound({ id: 'item_frame', Pos: [1, 2, 3], UUID: nbt.intArray([1, 2, 3, 4]) }) }],
    );
    const p = prepareVolume(v);
    expect(p.warnings.join('\n')).toMatch(/x – wird ignoriert/);
    expect(p.warnings.join('\n')).toMatch(/Pos\/UUID/);
    expect(p.warnings.join('\n')).toMatch(/MC-102223/);
    expect(p.blocks[0]!.state.name).toBe('minecraft:chest');
    expect(p.blocks[0]!.blockEntity).toEqual(nbt.compound({ id: nbt.string('minecraft:chest') }));
    expect(p.entities[0]!.id).toBe('minecraft:item_frame');
  });

  it('Sponge: Entity-Data bekommt Rotation [0,0], falls sie fehlt (WorldEdit liest sie zwingend)', () => {
    const v = base([], [{ pos: [0.5, 0, 0.5], blockPos: [0, 0, 0], nbt: nbt.compound({ id: nbt.string('minecraft:armor_stand') }) }]);
    const s = buildSpongeTag(v).value['Schematic'] as NbtCompound;
    const ents = s.value['Entities'];
    const data = ents?.type === 'list' && ents.value[0]?.type === 'compound' ? ents.value[0].value['Data'] : undefined;
    expect(data).toEqual(nbt.compound({ Rotation: nbt.floats([0, 0]) }));
  });

  it('Sponge: Achsen > 65535 werden abgelehnt', () => {
    const v: ExportVolume = { ...base([]), size: [70000, 1, 1] };
    expect(() => exportFile('schem', v)).toThrow(/unsigned short/);
  });
});
