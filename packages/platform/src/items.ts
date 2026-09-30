/**
 * Block → Gegenstand für Materiallisten (W3-BL): Welcher Gegenstand wird für einen gesetzten Block verbraucht und wie
 * viele? Wandvarianten zählen als ihr Gegenstand (`wall_torch` → `torch`), zweiteilige Blöcke einmal (obere Türhälfte,
 * Bettkopf), Kerzen und Stufen nach Anzahl. Luft, Flüssigkeiten und technische Blöcke ohne Gegenstand → `undefined`.
 * Rein; nur dieser Kontext kennt Minecraft-Namen.
 */
import type { PropertyMap } from './types.js';

/** Blöcke ohne eigenen Gegenstand (werden nicht gezählt). */
const NO_ITEM: ReadonlySet<string> = new Set([
  'air', 'cave_air', 'void_air', 'water', 'lava', 'bubble_column', 'fire', 'soul_fire', 'moving_piston', 'piston_head',
  'structure_void', 'light', 'barrier', 'end_portal', 'nether_portal', 'end_gateway', 'frosted_ice',
]);

/** Stapelgröße eines Gegenstands (Standard 64). */
export function stackSize(item: string): number {
  if (item.endsWith('_bed') || item === 'cake' || item.endsWith('_shulker_box') || item === 'shulker_box') return 1;
  if (item.endsWith('_sign') || item.endsWith('_banner') || item === 'snowball' || item === 'armor_stand') return 16;
  return 64;
}

/**
 * Gegenstand und Anzahl für einen Blockzustand; `undefined` = zählt nicht (obere Hälfte, Luft, Flüssigkeit).
 */
export function blockItem(name: string, props: PropertyMap = {}): { readonly item: string; readonly count: number } | undefined {
  if (NO_ITEM.has(name)) return undefined;
  // zweiteilige Blöcke einmal zählen
  if (props['half'] === 'upper') return undefined;
  if (name.endsWith('_bed') && props['part'] === 'head') return undefined;
  let item = name;
  if (name === 'wall_torch') item = 'torch';
  else if (/_wall_(torch|sign|hanging_sign|banner|skull|head|fan)$/.test(name)) item = name.replace(/_wall_/, '_');
  else if (name.startsWith('potted_')) item = 'flower_pot';
  else if (name === 'redstone_wire') item = 'redstone';
  else if (name === 'tripwire') item = 'string';
  else if (name.endsWith('_candle_cake') || name === 'candle_cake') item = 'cake';
  else if (name === 'water_cauldron' || name === 'lava_cauldron' || name === 'powder_snow_cauldron') item = 'cauldron';
  let count = 1;
  if (props['type'] === 'double' && name.endsWith('_slab')) count = 2;
  const n = Number(props['candles'] ?? props['pickles'] ?? props['eggs'] ?? props['flower_amount'] ?? props['segment_amount'] ?? props['layers'] ?? 1);
  if (Number.isInteger(n) && n > 1 && name !== 'snow') count = n;
  return { item, count };
}

/**
 * Blöcke, die derselbe Gegenstand an der Wand setzt (`torch` → `wall_torch`, `oak_sign` → `oak_wall_sign`,
 * `skeleton_skull` → `skeleton_wall_skull`). Wer einen Gegenstand sperrt, sperrt so auch seine Wandform (W3-BL).
 */
export function wallVariants(item: string): string[] {
  if (item === 'torch') return ['wall_torch'];
  const m = /^(.+?)_(hanging_sign|torch|sign|banner|skull|head|fan)$/.exec(item);
  return m === null || m[1]!.endsWith('_wall') ? [] : [`${m[1]}_wall_${m[2]}`];
}
