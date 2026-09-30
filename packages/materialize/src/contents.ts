/**
 * Inhalte (plan/01 §4.7): Block-Entities (Loot-Table, Items, Schildtext) und hängende Entities (Rahmen).
 * Items werden pro Zielversion serialisiert (ab 1.20.5 `{id, count, components}`, über @mcda/export).
 */
import type { Contents, EntitySpec, ItemRef } from '@mcda/catalog';
import { Rng, hashSeed, type Dir, type Vec3 } from '@mcda/core';
import { attachedPos, itemStack, nbt, signSide, slotItem, type NbtCompound, type NbtTag } from '@mcda/export';
import { normalizeId, type Registry } from '@mcda/platform';
import type { ThemeResolver } from './theme-resolve.js';

/**
 * Block-Entity-ID eines Blocks (≠ Block-ID, z. B. `spruce_wall_sign` → `sign`).
 * Adapter-Tabelle: die Plattform-Registry liefert (noch) keine Block-Entity-Typen.
 */
export function blockEntityId(name: string): string | undefined {
  if (['chest', 'trapped_chest', 'barrel', 'furnace', 'smoker', 'blast_furnace', 'dispenser', 'dropper', 'hopper',
    'lectern', 'brewing_stand', 'chiseled_bookshelf', 'decorated_pot', 'jukebox'].includes(name)) return name;
  if (name.endsWith('shulker_box')) return 'shulker_box';
  if (name.endsWith('_hanging_sign')) return 'hanging_sign';
  if (name.endsWith('_sign')) return 'sign';
  if (name.endsWith('_shelf')) return 'shelf';
  if (name === 'campfire' || name === 'soul_campfire') return 'campfire';
  return undefined;
}

/**
 * Behälter, die `contents.items` aufnehmen: Truhe/Fass/Shulkerkiste 27 Plätze; Spender/Werfer 9 (FN Tierfarmen:
 * Schere bzw. Glasflaschen vorgeladen), Trichter 5. Additiv: vorher warfen diese Blockarten einen Fehler.
 */
function containerSlots(name: string): number | undefined {
  if (name === 'dispenser' || name === 'dropper') return 9;
  if (name === 'hopper') return 5;
  return name === 'chest' || name === 'trapped_chest' || name === 'barrel' || name.endsWith('shulker_box') ? 27 : undefined;
}

export interface ContentsContext {
  readonly registry: Registry;
  readonly resolver: ThemeResolver;
  /** Seed der Platzierung (einzige Zufallsquelle neben der Lage). */
  readonly seed: number;
  /**
   * Herkunft (ID der Platzierung). Determinismus-Fix: fließt nicht in den Zufall ein – die ID hängt an der
   * Ereignisfolge des Projekts, nicht am Inhalt (plan/spikes/F_determinismus.md).
   */
  readonly owner: string;
  readonly pos: Vec3;
}

function itemId(ref: ItemRef, ctx: ContentsContext, rng: Rng): string {
  if (ref.item !== undefined) {
    const id = normalizeId(ref.item);
    if (!ctx.registry.hasItem(id)) throw new Error(`Item '${ref.item}' existiert in ${ctx.registry.version} nicht`);
    return id;
  }
  return ctx.resolver.resolveItem(ref.role!, rng);
}

function itemCount(ref: ItemRef, rng: Rng): number {
  const c = ref.count ?? 1;
  return Array.isArray(c) ? rng.int(Math.min(c[0], c[1]), Math.max(c[0], c[1])) : c;
}

/** Block-Entity für die Inhalte einer Zelle; `undefined`, wenn es keine Inhalte gibt. */
export function blockEntityFor(name: string, contents: Contents | undefined, ctx: ContentsContext): NbtCompound | undefined {
  if (contents === undefined) return undefined;
  const beId = blockEntityId(name);
  if (beId === undefined) throw new Error(`${name} hat keine Block-Entity – contents nicht möglich`);
  const dv = ctx.registry.dataVersion;
  const rng = new Rng(hashSeed(ctx.seed, 'contents', ...ctx.pos));
  const fields: Record<string, NbtTag> = { id: nbt.string(`minecraft:${beId}`) };

  if (contents.lootTable !== undefined && contents.items !== undefined) throw new Error(`${name}: contents braucht lootTable ODER items, nicht beides`);
  if (contents.lootTable !== undefined) {
    const lt = normalizeId(contents.lootTable);
    if (!ctx.registry.hasLootTable(lt)) throw new Error(`Loot-Table '${contents.lootTable}' existiert in ${ctx.registry.version} nicht`);
    if (containerSlots(name) === undefined) throw new Error(`${name}: Loot-Table nur für Truhe/Fass/Shulkerkiste/Spender/Trichter`);
    fields['LootTable'] = nbt.string(`minecraft:${lt}`);
    fields['LootTableSeed'] = nbt.long(hashSeed(ctx.seed, 'loot', ...ctx.pos));
  }
  if (contents.items !== undefined) {
    const slots = containerSlots(name);
    if (slots === undefined) throw new Error(`${name}: contents.items wird für diese Blockart noch nicht unterstützt`);
    const refs = contents.items;
    if (refs.length === 0) throw new Error(`${name}: contents.items ist leer`);
    let n = refs.length;
    if (contents.fill !== undefined) {
      const [a, b] = contents.fill;
      n = Math.max(1, Math.min(slots, Math.round((Math.min(a, b) + rng.next() * Math.abs(b - a)) * slots)));
    }
    if (n > slots) throw new Error(`${name}: ${n} Items passen nicht in ${slots} Plätze`);
    const positions = (contents.fill !== undefined ? rng.shuffle([...Array(slots).keys()]).slice(0, n) : [...Array(n).keys()]).sort((x, y) => x - y);
    fields['Items'] = nbt.compounds(positions.map((slot, i) => {
      const ref = refs[i % refs.length]!;
      return slotItem(dv, slot, itemId(ref, ctx, rng), itemCount(ref, rng));
    }));
  }
  if (contents.text !== undefined) {
    if (beId !== 'sign' && beId !== 'hanging_sign') throw new Error(`${name}: contents.text nur für Schilder`);
    fields['front_text'] = signSide(dv, contents.text);
    fields['back_text'] = signSide(dv, []);
    fields['is_waxed'] = nbt.byte(0);
  }
  return nbt.compound(fields);
}

const FRAME_FACING: Readonly<Record<Dir, number>> = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };

/** Hängende Entity (Rahmen) → Position + NBT. Andere Entity-Typen: Fehler (noch nicht unterstützt). */
export function entityFor(spec: EntitySpec, at: Vec3, face: Dir | undefined, ctx: ContentsContext): { pos: Vec3; blockPos: Vec3; nbt: NbtCompound } {
  const type = normalizeId(spec.type);
  if (type !== 'item_frame' && type !== 'glow_item_frame') throw new Error(`Entity-Typ '${spec.type}' wird noch nicht unterstützt`);
  if (face === undefined) throw new Error(`${type} bei ${at.join(',')} braucht face (Blickrichtung weg von der Fläche)`);
  const rng = new Rng(hashSeed(ctx.seed, 'entity', ...at));
  const fields: Record<string, NbtTag> = {
    id: nbt.string(`minecraft:${type}`),
    Facing: nbt.byte(FRAME_FACING[face]),
    ItemRotation: nbt.byte(0),
  };
  if (spec.item !== undefined) fields['Item'] = itemStack(ctx.registry.dataVersion, itemId(spec.item, ctx, rng), itemCount(spec.item, rng));
  if (spec.invisible === true) fields['Invisible'] = nbt.byte(1);
  return { pos: attachedPos(at, face), blockPos: at, nbt: nbt.compound(fields) };
}
