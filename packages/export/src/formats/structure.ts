/**
 * Vanilla Structure Template (`.nbt`), wie `StructureTemplate.save()` es schreibt:
 *
 *   { DataVersion:int, size:list<int>[3],
 *     palette:list<{Name:string, Properties?:{k:string}}>,
 *     blocks:list<{pos:list<int>[3], state:int, nbt?:compound}>,
 *     entities:list<{pos:list<double>[3], blockPos:list<int>[3], nbt:compound}> }
 *
 * ACHTUNG: `size`, `pos`, `blockPos` sind LISTEN von Int-Tags, keine Int-Arrays
 * (Minecraft liest mit getList(…, TAG_INT) – ein IntArray ergäbe Größe 0,0,0).
 *
 * Sparse-Format: Positionen ohne Eintrag sind „Structure Void“ (Welt bleibt unverändert).
 * Weil unser Modell „fehlend = Luft“ bedeutet, schreiben wir Luft standardmäßig explizit
 * (`air: 'explicit'`). Mit `air: 'void'` entfällt Luft (nur Möbel in bestehenden Raum setzen).
 * `minecraft:structure_void` im Modell wird nie geschrieben (wie Vanilla).
 *
 * Die Reihenfolge der Blöcke ist egal: Vanilla sortiert beim Laden selbst
 * (loadPalette → addToLists/buildInfoList: volle Blöcke, dann mit NBT, dann Rest).
 *
 * `ExportVolume.disclaimer` wird hier bewusst NICHT geschrieben: Das Format hat kein Text- oder Metadatenfeld
 * (Wurzel laut minecraft.wiki „Structure file“: DataVersion, size, palette/palettes, blocks, entities; `author` gab es
 * nur in Dateien vor 1.13). Dass Strukturblock und `/place template` ein zusätzliches Wurzel-Tag ignorieren, ist
 * plausibel (Litematica liest ein altes `author` sogar mit), für 1.21.11/26.3 aber weder im Spiel noch am Code
 * belegt – und der Strukturblock ist der einzige offizielle Leser. Offene Ingame-Prüfung:
 * plan/spikes/W1H_export_disclaimer.md.
 */
import { AIR, StatePalette, STRUCTURE_VOID, stateFromNbt, stateToNbt, type ExportState } from '../blockstate.js';
import { entityNbtWithPosition, stripEntityPosition } from '../entities.js';
import type { ExportBlock, ExportEntity, ExportVolume, Vec3 } from '../model.js';
import { nbt, reqList, reqTag, type NbtCompound } from '../nbt/tag.js';
import { blockIndex, indexToPos, prepareVolume, type PreparedBlock } from '../volume.js';

export interface StructureWriteOptions {
  /** 'explicit' (Default): Luft wird geschrieben und überschreibt die Welt. 'void': Luft entfällt. */
  readonly air?: 'explicit' | 'void';
}

export function buildStructureTag(v: ExportVolume, opts: StructureWriteOptions = {}): NbtCompound {
  const p = prepareVolume(v);
  const palette = new StatePalette();
  const airState: ExportState = { name: AIR, properties: {} };
  const byIndex = new Map<number, PreparedBlock>();
  for (const b of p.blocks) byIndex.set(blockIndex(p.size, ...b.pos), b);

  const blocks: NbtCompound[] = [];
  const volume = p.size[0] * p.size[1] * p.size[2];
  const explicitAir = (opts.air ?? 'explicit') === 'explicit';
  for (let i = 0; i < volume; i++) {
    const b = byIndex.get(i);
    if (!b) {
      if (!explicitAir) continue;
      blocks.push(nbt.compound({ pos: nbt.ints(indexToPos(p.size, i)), state: nbt.int(palette.idFor(airState)) }));
      continue;
    }
    if (b.state.name === STRUCTURE_VOID) continue;
    blocks.push(nbt.compound({
      pos: nbt.ints(b.pos),
      state: nbt.int(palette.idFor(b.state)),
      nbt: b.blockEntity,
    }));
  }

  const entities = p.entities.map((e) => nbt.compound({
    pos: nbt.doubles(e.pos),
    blockPos: nbt.ints(e.blockPos),
    nbt: entityNbtWithPosition(e, p.dataVersion),
  }));

  return nbt.compound({
    size: nbt.ints(p.size),
    entities: nbt.compounds(entities),
    blocks: nbt.compounds(blocks),
    palette: nbt.compounds(palette.states.map(stateToNbt)),
    DataVersion: nbt.int(p.dataVersion),
  });
}

function intList3(c: NbtCompound, key: string): Vec3 {
  const l = reqList(c, key, 'int');
  if (l.length !== 3) throw new TypeError(`${key}: 3 Ints erwartet, ${l.length} erhalten`);
  return [l[0]!.value, l[1]!.value, l[2]!.value];
}

function doubleList3(c: NbtCompound, key: string): Vec3 {
  const l = reqList(c, key, 'double');
  if (l.length !== 3) throw new TypeError(`${key}: 3 Doubles erwartet`);
  return [l[0]!.value, l[1]!.value, l[2]!.value];
}

export interface StructureReadResult {
  readonly volume: ExportVolume;
  /** Anzahl explizit gespeicherter Luftblöcke */
  readonly explicitAir: number;
}

/** Reader (für Tests/Import). Unterstützt nur `palette`, nicht `palettes`. Das Format kennt keinen Namen. */
export function parseStructureTag(root: NbtCompound, name = ''): StructureReadResult {
  if (root.value['palettes'] !== undefined) throw new Error('Mehrfach-Paletten (palettes) nicht unterstützt');
  const dataVersion = reqTag(root, 'DataVersion', 'int').value;
  const size = intList3(root, 'size');
  const palette = reqList(root, 'palette', 'compound').map(stateFromNbt);
  const blocks: ExportBlock[] = [];
  let explicitAir = 0;
  for (const b of reqList(root, 'blocks', 'compound')) {
    const state = palette[reqTag(b, 'state', 'int').value];
    if (!state) throw new RangeError('blocks[].state außerhalb der Palette');
    if (state.name === AIR) { explicitAir++; continue; }
    const be = b.value['nbt'];
    if (be !== undefined && be.type !== 'compound') throw new TypeError('blocks[].nbt ist kein Compound');
    blocks.push({
      pos: intList3(b, 'pos'),
      name: state.name,
      ...(Object.keys(state.properties).length > 0 ? { properties: { ...state.properties } } : {}),
      ...(be ? { blockEntity: be } : {}),
    });
  }
  const entities: ExportEntity[] = reqList(root, 'entities', 'compound').map((e) => ({
    pos: doubleList3(e, 'pos'),
    blockPos: intList3(e, 'blockPos'),
    nbt: stripEntityPosition(reqTag(e, 'nbt', 'compound')),
  }));
  return { volume: { name, dataVersion, size, blocks, entities }, explicitAir };
}
