/**
 * Versionsabhängige NBT-Bausteine für Block-Entities und Entities:
 * Item-Stacks, Textkomponenten, Ausrüstung, Banner-Muster.
 *
 * Item-Format:
 * - ab 1.20.5 (DataVersion 3837): {id: string, count: int, components?: {"minecraft:…": …}}
 * - bis 1.20.4 (z. B. 1.20.1):     {id: string, Count: byte, tag?: {…}}   (Legacy)
 * In Containern kommt jeweils `Slot: byte` hinzu.
 */
import { nbt, type NbtCompound, type NbtTag } from './nbt/tag.js';
import { features } from './versions.js';

export interface ItemOptions {
  /** Data Components (1.20.5+), Schlüssel inkl. Namespace, z. B. "minecraft:damage". */
  readonly components?: Readonly<Record<string, NbtTag>>;
  /** Legacy-`tag` (bis 1.20.4). Wird bei neuen Versionen ignoriert. */
  readonly legacyTag?: NbtCompound;
}

export function itemStack(dataVersion: number, id: string, count = 1, opts: ItemOptions = {}): NbtCompound {
  const fullId = id.includes(':') ? id : `minecraft:${id}`;
  if (features(dataVersion).itemComponents) {
    const comps = opts.components && Object.keys(opts.components).length > 0 ? nbt.compound(opts.components) : undefined;
    return nbt.compound({ id: nbt.string(fullId), count: nbt.int(count), components: comps });
  }
  if (count > 127) throw new RangeError('Legacy-Items: Count ist ein Byte (max. 127)');
  return nbt.compound({ id: nbt.string(fullId), Count: nbt.byte(count), tag: opts.legacyTag });
}

export function slotItem(dataVersion: number, slot: number, id: string, count = 1, opts: ItemOptions = {}): NbtCompound {
  const item = itemStack(dataVersion, id, count, opts);
  return nbt.compound({ Slot: nbt.byte(slot), ...item.value });
}

/** Leerer Stack für Legacy-Listen wie ArmorItems/HandItems. */
export const EMPTY_ITEM: NbtCompound = nbt.compound({});

/**
 * Einfache Textkomponente (reiner Text).
 * - bis 1.21.4: JSON-String, z. B. `"\"Hallo\""`
 * - ab 1.21.5 (25w02a): Textkomponente direkt als NBT (reiner String = Literal-Text)
 */
export function textComponent(dataVersion: number, text: string): NbtTag {
  return features(dataVersion).textAsNbt ? nbt.string(text) : nbt.string(JSON.stringify(text));
}

/** Schild-Seite (seit 1.20 zweiseitig): {messages[4], color, has_glowing_text}. */
export function signSide(dataVersion: number, lines: readonly string[], color = 'black', glowing = false): NbtCompound {
  const four = [0, 1, 2, 3].map((i) => lines[i] ?? '');
  const msgs = four.map((l) => textComponent(dataVersion, l));
  return nbt.compound({
    messages: { type: 'list', itemType: 'string', value: msgs },
    color: nbt.string(color),
    has_glowing_text: nbt.byte(glowing),
  });
}

/** Buch und Feder (writable_book) – Seiten sind in allen Versionen reine Strings (kein JSON). */
export function writableBook(dataVersion: number, pages: readonly string[]): NbtCompound {
  return itemStack(dataVersion, 'minecraft:writable_book', 1, {
    components: {
      'minecraft:writable_book_content': nbt.compound({
        pages: nbt.compounds(pages.map((p) => nbt.compound({ raw: nbt.string(p) }))),
      }),
    },
    legacyTag: nbt.compound({ pages: nbt.strings(pages) }),
  });
}

export type EquipmentSlot = 'head' | 'chest' | 'legs' | 'feet' | 'mainhand' | 'offhand';

/**
 * Ausrüstung von Mobs/Rüstungsständern.
 * - ab 1.21.5: `equipment: {head: item, …}`
 * - davor:     `ArmorItems: [feet, legs, chest, head]`, `HandItems: [mainhand, offhand]` (leere Slots = {})
 */
export function equipmentFields(dataVersion: number, eq: Partial<Record<EquipmentSlot, NbtCompound>>): Record<string, NbtTag> {
  if (features(dataVersion).equipmentCompound) {
    return { equipment: nbt.compound(eq) };
  }
  const pick = (s: EquipmentSlot) => eq[s] ?? EMPTY_ITEM;
  return {
    ArmorItems: nbt.compounds([pick('feet'), pick('legs'), pick('chest'), pick('head')]),
    HandItems: nbt.compounds([pick('mainhand'), pick('offhand')]),
  };
}

const DYE_IDS: Readonly<Record<string, number>> = {
  white: 0, orange: 1, magenta: 2, light_blue: 3, yellow: 4, lime: 5, pink: 6, gray: 7,
  light_gray: 8, cyan: 9, purple: 10, blue: 11, brown: 12, green: 13, red: 14, black: 15,
};
/** Auszug der Legacy-Musterkürzel (bis 1.20.4). */
const LEGACY_PATTERN_CODES: Readonly<Record<string, string>> = {
  'minecraft:stripe_center': 'cs', 'minecraft:stripe_middle': 'ms', 'minecraft:border': 'bo',
  'minecraft:cross': 'cr', 'minecraft:straight_cross': 'sc', 'minecraft:circle': 'mc',
  'minecraft:rhombus': 'mr', 'minecraft:gradient': 'gra', 'minecraft:bricks': 'bri',
};

export interface BannerPattern { color: string; pattern: string }

/**
 * Banner-Block-Entity-Felder.
 * - ab 1.20.5: `patterns: [{color: "red", pattern: "minecraft:stripe_center"}]`
 * - davor:     `Patterns: [{Color: 14 (int), Pattern: "cs"}]`
 */
export function bannerFields(dataVersion: number, patterns: readonly BannerPattern[]): Record<string, NbtTag> {
  if (features(dataVersion).itemComponents) {
    return {
      patterns: nbt.compounds(patterns.map((p) => nbt.compound({ color: nbt.string(p.color), pattern: nbt.string(p.pattern) }))),
    };
  }
  return {
    Patterns: nbt.compounds(patterns.map((p) => {
      const code = LEGACY_PATTERN_CODES[p.pattern];
      const color = DYE_IDS[p.color];
      if (code === undefined || color === undefined) throw new Error(`Legacy-Banner: ${p.pattern}/${p.color} nicht gemappt`);
      return nbt.compound({ Color: nbt.int(color), Pattern: nbt.string(code) });
    })),
  };
}
