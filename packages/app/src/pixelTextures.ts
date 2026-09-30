/**
 * Eigene 16×16-Pixeltexturen im Blockstil für „Vorschau: Blöcke“ – prozedural aus Blockname und Flächenfarbe
 * (blockColors.ts). KEINE Mojang-Texturen oder -Assets (research/08 §5): jede Kachel ist eigenes, per Seed
 * deterministisches Material. Rein und ohne DOM, damit es in Node testbar ist; der Viewer macht aus den Pixeln
 * eine `DataTexture`.
 *
 * Aufbau: `classifyTexture` ordnet einen Block einer Materialfamilie zu (Bretter, Stamm, Pflaster, Ziegel, Gras …),
 * `paintTile` zeichnet eine Kachel, `buildPixelAtlas` legt alle benötigten Kacheln mit Rand (gegen Farbbluten in
 * den Mipmaps) in einen quadratischen Atlas und liefert die UV-Rechtecke.
 */
import type { Rgb } from './colors.js';

export const TILE = 16;
/** Rand je Seite (wiederholter Kachelinhalt), damit Mipmaps nicht in Nachbarkacheln bluten. */
const PAD = 8;
const STRIDE = TILE + PAD * 2;

export type TileFace = 'top' | 'side' | 'bottom';

export type TextureFamily =
  | 'planks' | 'trapdoor' | 'door' | 'log' | 'bark' | 'stripped' | 'leaves' | 'glass' | 'bars'
  | 'grass' | 'podzol' | 'farmland' | 'path' | 'dirt' | 'gravel' | 'cobble' | 'cobble_moss'
  | 'stonebricks' | 'stonebricks_moss' | 'stonebricks_cracked' | 'bricks' | 'tiles' | 'deepslate' | 'polished' | 'stone'
  | 'wool' | 'terracotta' | 'bookshelf' | 'chest' | 'barrel' | 'furnace' | 'table' | 'hay' | 'ribbed' | 'water'
  | 'moss' | 'glow' | 'metal' | 'crop' | 'blades' | 'flower' | 'noise';

export interface TextureInfo {
  readonly fam: TextureFamily;
  /** Grundfarbe der Kachel */
  readonly color: Rgb;
  /** Bretterfarbe der Holzart (Stirnseite von Stämmen, entrindete Stämme) */
  readonly plank?: Rgb;
}

/** Pflanzen, die in Minecraft gekreuzte Sprites sind (hier: Kachel mit Halmen auf transparentem Grund). */
export const PLANT = /(wheat|carrots|potatoes|beetroots|short_grass|tall_grass|fern|bush|sapling|sugar_cane|hanging_roots|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|torchflower|mushroom$|rose|peony|lilac)/;

/** Holzarten, längste zuerst (dark_oak/pale_oak vor oak). */
const WOODS = ['dark_oak', 'pale_oak', 'oak', 'spruce', 'birch', 'jungle', 'acacia', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped'];
/** Bretterfarben wie in blockColors.ts (eigene Werte). */
const WOOD_PLANK: Readonly<Record<string, Rgb>> = {
  oak: 0xa4834f, spruce: 0x755633, birch: 0xc4b27c, jungle: 0xa3754e, acacia: 0xab5c33, dark_oak: 0x45301c,
  mangrove: 0x783838, cherry: 0xe1b4ad, pale_oak: 0xe3d9cf, bamboo: 0xc9b25a, crimson: 0x6b344a, warped: 0x2b6963,
};

/** Materialfamilie aus dem Blocknamen (Formen wie `_stairs`/`_slab` teilen die Textur des Vollblocks). */
export function classifyTexture(blockId: string, color: Rgb): TextureInfo {
  let n = blockId.replace(/^minecraft:/, '');
  const species = WOODS.find((w) => n.startsWith(`${w}_`) || n.startsWith(`stripped_${w}_`));
  if (species !== undefined) {
    const plank = WOOD_PLANK[species] ?? color;
    if (/_(log|wood|stem|hyphae)$/.test(n)) return { fam: n.startsWith('stripped_') ? 'stripped' : n.endsWith('_wood') ? 'bark' : 'log', color, plank };
    if (n.endsWith('_leaves')) return { fam: 'leaves', color };
    return { fam: n.endsWith('_trapdoor') ? 'trapdoor' : n.endsWith('_door') ? 'door' : 'planks', color: plank };
  }
  n = n.replace(/_(stairs|slab|wall|pressure_plate|button)$/, '');
  if (PLANT.test(n)) return { fam: /wheat|carrots|potatoes|beetroots/.test(n) ? 'crop' : /grass|fern|bush|roots|sapling|cane/.test(n) ? 'blades' : 'flower', color };
  if (n.endsWith('leaves')) return { fam: 'leaves', color };
  if (/lantern|torch|glowstone|shroomlight|campfire/.test(n)) return { fam: 'glow', color };
  if (n.includes('glass')) return { fam: 'glass', color };
  if (n === 'iron_bars' || n.endsWith('copper_bars')) return { fam: 'bars', color };
  if (n === 'grass_block') return { fam: 'grass', color };
  if (n === 'podzol' || n === 'mycelium') return { fam: 'podzol', color };
  if (n === 'farmland') return { fam: 'farmland', color };
  if (n === 'dirt_path') return { fam: 'path', color };
  if (/dirt|mud$/.test(n) && !n.endsWith('bricks')) return { fam: 'dirt', color };
  if (n === 'gravel') return { fam: 'gravel', color };
  if (/^(cobblestone|mossy_cobblestone|cobbled_deepslate)$/.test(n)) return { fam: n.startsWith('mossy') ? 'cobble_moss' : 'cobble', color };
  if (n.endsWith('tiles')) return { fam: 'tiles', color };
  if (n === 'bricks' || n === 'brick') return { fam: 'bricks', color };
  if (/bricks?$/.test(n)) return { fam: n.startsWith('mossy') ? 'stonebricks_moss' : n.startsWith('cracked') ? 'stonebricks_cracked' : 'stonebricks', color };
  if (/deepslate|tuff/.test(n)) return { fam: 'deepslate', color };
  if (/^polished_|smooth_stone/.test(n)) return { fam: 'polished', color };
  if (/stone|andesite|diorite|granite|calcite|blackstone/.test(n) && n !== 'grindstone') return { fam: 'stone', color };
  if (/wool|carpet|_bed$|banner/.test(n)) return { fam: 'wool', color };
  if (/terracotta|concrete/.test(n)) return { fam: 'terracotta', color };
  if (n === 'bookshelf' || n === 'chiseled_bookshelf') return { fam: 'bookshelf', color: WOOD_PLANK['oak']! };
  if (n.endsWith('chest')) return { fam: 'chest', color };
  if (n === 'barrel') return { fam: 'barrel', color: WOOD_PLANK['spruce']! };
  if (/furnace|smoker/.test(n)) return { fam: 'furnace', color };
  if (/crafting_table|smithing_table|fletching_table|cartography_table/.test(n)) return { fam: 'table', color: WOOD_PLANK['oak']! };
  if (n === 'hay_block') return { fam: 'hay', color };
  if (n === 'pumpkin' || n === 'melon') return { fam: 'ribbed', color };
  if (n === 'water' || n === 'water_cauldron') return { fam: 'water', color };
  if (n === 'moss_block' || n === 'moss_carpet') return { fam: 'moss', color };
  if (/gold|copper|iron|_block$/.test(n)) return { fam: 'metal', color };
  return { fam: 'noise', color };
}

/** Familien mit Löchern in der Textur (Glas, Laub, Gitter, Pflanzen) → Alpha-Test im Material. */
export function isCutout(fam: TextureFamily): boolean {
  return fam === 'glass' || fam === 'leaves' || fam === 'bars' || fam === 'crop' || fam === 'blades' || fam === 'flower';
}

// ---------------------------------------------------------------------------------------------- Zeichnen

type Rgb3 = readonly [number, number, number];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const rgb3 = (hex: Rgb): Rgb3 => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const shade = (c: Rgb3, f: number): Rgb3 => [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];
const mix = (a: Rgb3, b: Rgb3, t: number): Rgb3 => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

const GRASS: Rgb3 = [95, 159, 53];
const SOIL: Rgb3 = [134, 96, 67];
const MOSS: Rgb3 = [74, 110, 44];
const STEM: Rgb3 = [74, 128, 44];

/** Zeichnet eine Kachel (RGBA, 16×16) für eine Fläche des Blocks. Deterministisch über `seed`. */
export function paintTile(info: TextureInfo, face: TileFace, seed: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(TILE * TILE * 4);
  const r = rng(seed);
  const base = rgb3(info.color);
  const set = (x: number, y: number, c: Rgb3, a = 255): void => {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = (y * TILE + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
  };
  const fill = (fn: (x: number, y: number) => Rgb3): void => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) set(x, y, fn(x, y));
  };
  const border = (c: Rgb3): void => {
    for (let i = 0; i < TILE; i++) { set(i, 0, c); set(i, TILE - 1, c); set(0, i, c); set(TILE - 1, i, c); }
  };
  const planks = (c: Rgb3): void => {
    const offsets = [3, 11, 6, 13];
    fill((x, y) => {
      const board = y >> 2;
      if ((y & 3) === 3) return shade(c, 0.62);
      if (x === offsets[board]) return shade(c, 0.72);
      return shade(c, 0.95 + r() * 0.1 - ((x * 7 + board * 13) % 5 === 0 ? 0.05 : 0));
    });
  };
  const stones = (c: Rgb3, moss: boolean): void => {
    // unregelmäßige Steine: Voronoi aus 7 Punkten (kachelbar), dunkle Fugen
    const pts = Array.from({ length: 7 }, () => [r() * TILE, r() * TILE, 0.85 + r() * 0.3] as const);
    fill((x, y) => {
      let d1 = Infinity, d2 = Infinity, k = 0;
      pts.forEach((p, i) => {
        for (const [ox, oy] of [[0, 0], [TILE, 0], [-TILE, 0], [0, TILE], [0, -TILE]] as const) {
          const d = Math.hypot(x - p[0] - ox, y - p[1] - oy);
          if (d < d1) { d2 = d1; d1 = d; k = i; } else if (d < d2) d2 = d;
        }
      });
      if (d2 - d1 < 1.2) return shade(c, 0.5);
      const col = shade(c, pts[k]![2] + (r() - 0.5) * 0.1 - d1 * 0.015);
      return moss && r() < 0.35 ? mix(col, MOSS, 0.7) : col;
    });
  };
  const bricks = (c: Rgb3, mortar: Rgb3, rows: 2 | 4, moss = false, cracked = false): void => {
    const h = TILE / rows;
    const bw = rows === 2 ? TILE : TILE / 2;
    fill((x, y) => {
      const row = Math.floor(y / h);
      const off = row % 2 ? (rows === 2 ? TILE / 2 : TILE / 4) : 0;
      const bx = (x + off) % bw;
      if (y % h === h - 1 || bx === bw - 1) return mortar;
      const col = shade(c, 0.92 + r() * 0.14 + (y % h === 0 ? 0.05 : 0));
      return moss && r() < 0.18 ? mix(col, MOSS, 0.75) : col;
    });
    if (cracked) {
      let x = 3 + Math.floor(r() * 8);
      for (let y = 1; y < TILE - 1; y++) { set(x, y, shade(c, 0.45)); x = Math.max(0, Math.min(TILE - 1, x + Math.round(r() * 2 - 1))); }
    }
  };
  const soilSide = (top: Rgb3, depth: () => number): void => {
    const edge = Array.from({ length: TILE }, depth);
    fill((x, y) => (y < edge[x]! ? shade(top, 0.78 + r() * 0.3) : shade(SOIL, 0.78 + r() * 0.35)));
  };

  switch (info.fam) {
    case 'planks': planks(base); break;
    case 'trapdoor': planks(base); border(shade(base, 0.6)); break;
    case 'door':
      planks(base);
      for (let y = 2; y < 7; y++) for (let x = 3; x < 13; x++) set(x, y, mix(shade(base, 0.8), [190, 215, 230], 0.25));
      set(12, 9, [60, 60, 60]); set(12, 10, [60, 60, 60]);
      break;
    case 'log': case 'bark': case 'stripped': {
      const inner = rgb3(info.plank ?? info.color);
      const bark = info.fam === 'stripped' ? shade(inner, 1.05) : base;
      if (face === 'top' && info.fam !== 'bark') {
        fill((x, y) => {
          const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
          return d > 6.5 ? shade(bark, 0.9 + r() * 0.15) : shade(inner, (Math.floor(d) % 2 ? 0.88 : 1.02) + r() * 0.06);
        });
      } else {
        for (let x = 0; x < TILE; x++) {
          const col = 0.85 + ((x * 5) % 3) * 0.08 + r() * 0.05;
          for (let y = 0; y < TILE; y++) set(x, y, shade(bark, col + (r() < 0.12 ? -0.18 : r() * 0.06)));
        }
      }
      break;
    }
    case 'leaves':
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const v = r();
        if (v < 0.16) set(x, y, shade(base, 0.35), 0);
        else set(x, y, shade(base, 0.75 + v * 0.45));
      }
      break;
    case 'glass': {
      const frame = mix(base, [255, 255, 255], 0.35);
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
        const streak = (x + y === 5 || x + y === 6 || x + y === 11) && x > 1 && y > 1 && x < TILE - 2 && y < TILE - 2;
        if (edge) set(x, y, shade(frame, 0.95 + r() * 0.1));
        else if (streak) set(x, y, mix(frame, [255, 255, 255], 0.6), 190);
        else set(x, y, mix(base, [200, 230, 255], 0.5), 0);
      }
      break;
    }
    case 'bars':
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) set(x, y, shade(base, 0.8 + r() * 0.2), x % 5 === 1 || x % 5 === 2 || y === 0 || y === TILE - 1 ? 255 : 0);
      break;
    case 'grass':
      if (face === 'top') fill(() => shade(GRASS, 0.8 + r() * 0.35));
      else if (face === 'bottom') fill(() => shade(SOIL, 0.8 + r() * 0.35));
      else soilSide(GRASS, () => 3 + Math.floor(r() * 3));
      break;
    case 'podzol':
      if (face === 'top') fill(() => shade(mix(base, [110, 70, 30], 0.3), 0.75 + r() * 0.45));
      else if (face === 'bottom') fill(() => shade(SOIL, 0.8 + r() * 0.35));
      else soilSide(base, () => 2 + Math.floor(r() * 2));
      break;
    case 'farmland':
      if (face === 'top') fill((_, y) => shade([82, 52, 30], (y % 4 === 0 ? 0.7 : 1) * (0.85 + r() * 0.3)));
      else fill(() => shade(SOIL, 0.78 + r() * 0.35));
      break;
    case 'path':
      if (face === 'top') fill(() => shade([148, 122, 72], 0.8 + r() * 0.35));
      else fill((_, y) => (y < 2 ? shade([148, 122, 72], 0.9) : shade(SOIL, 0.78 + r() * 0.35)));
      break;
    case 'dirt':
      fill(() => { const v = r(); return shade(base, v < 0.1 ? 0.65 : v > 0.93 ? 1.25 : 0.85 + r() * 0.25); });
      break;
    case 'gravel':
      fill(() => { const v = r(); return shade(base, v < 0.25 ? 0.62 : v > 0.8 ? 1.3 : 0.95); });
      break;
    case 'cobble': stones(base, false); break;
    case 'cobble_moss': stones(base, true); break;
    case 'stonebricks': bricks(base, shade(base, 0.62), 2); break;
    case 'stonebricks_moss': bricks(base, shade(base, 0.62), 2, true); break;
    case 'stonebricks_cracked': bricks(base, shade(base, 0.62), 2, false, true); break;
    case 'bricks': bricks(base, [196, 186, 172], 4); break;
    case 'tiles': fill((x, y) => (x % 8 === 7 || y % 8 === 7 ? shade(base, 0.55) : shade(base, 0.9 + r() * 0.16))); break;
    case 'deepslate':
      for (let y = 0; y < TILE; y++) { const row = 0.85 + r() * 0.2; for (let x = 0; x < TILE; x++) set(x, y, shade(base, row + (r() - 0.5) * 0.12)); }
      break;
    case 'polished': fill((x, y) => shade(base, x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1 ? 0.78 : 1 + (r() - 0.5) * 0.06)); break;
    case 'stone': fill(() => { const v = r(); return shade(base, v < 0.08 ? 0.72 : v > 0.94 ? 1.18 : 0.92 + r() * 0.12); }); break;
    case 'wool': fill((x, y) => shade(base, ((x + y) % 2 ? 0.94 : 1.03) + (r() - 0.5) * 0.08)); break;
    case 'terracotta': fill(() => shade(base, 0.95 + r() * 0.1)); break;
    case 'bookshelf':
      planks(base);
      if (face !== 'side') break;
      for (const row of [1, 9]) {
        let x = 1;
        while (x < TILE - 1) {
          const w = 1 + Math.floor(r() * 2), hgt = 5 + Math.floor(r() * 2);
          const books: readonly Rgb3[] = [[150, 40, 40], [45, 80, 140], [60, 110, 50], [170, 140, 60], [100, 60, 120]];
          const c = books[Math.floor(r() * books.length)]!;
          for (let dx = 0; dx < w && x + dx < TILE - 1; dx++) for (let dy = 0; dy < hgt; dy++) set(x + dx, row + (6 - hgt) + dy, shade(c, 0.85 + r() * 0.2));
          x += w;
        }
      }
      break;
    case 'chest': {
      planks(base);
      const dark = shade(base, 0.45);
      border(dark);
      if (face === 'side') {
        for (let x = 0; x < TILE; x++) set(x, 5, dark);
        for (let y = 4; y < 8; y++) for (let x = 7; x < 9; x++) set(x, y, [200, 200, 205]);
      }
      break;
    }
    case 'barrel':
      if (face === 'top') { planks(base); for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) set(x, y, shade(base, 0.55)); }
      else fill((x, y) => (y === 2 || y === 13 ? [70, 70, 75] : shade(base, (x % 4 === 3 ? 0.7 : 0.95) + r() * 0.1)));
      break;
    case 'furnace':
      bricks([128, 128, 128], [80, 80, 80], 4);
      if (face === 'side') for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) set(x, y, y > 11 ? [255, 150, 60] : [30, 30, 32]);
      break;
    case 'table':
      planks(base);
      if (face === 'top') for (let i = 1; i < TILE - 1; i++) { const c = shade(base, 0.55); set(i, 5, c); set(i, 10, c); set(5, i, c); set(10, i, c); }
      break;
    case 'hay': fill((_, y) => (face === 'side' && (y === 3 || y === 12) ? shade(base, 0.55) : shade(base, 0.85 + r() * 0.3))); break;
    case 'ribbed': fill((x) => shade(base, (x % 4 === 0 ? 0.72 : 1) * (0.9 + r() * 0.15))); break;
    case 'water': fill((x, y) => shade([52, 96, 190], (Math.sin((x + y * 0.5) * 0.9) > 0.7 ? 1.25 : 0.95) + (r() - 0.5) * 0.08)); break;
    case 'moss': fill(() => shade(base, 0.8 + r() * 0.4)); break;
    case 'glow': fill(() => shade(base, 0.9 + r() * 0.3)); break;
    case 'metal': fill((x, y) => shade(base, x === 0 || y === 0 ? 1.2 : x === TILE - 1 || y === TILE - 1 ? 0.75 : 1 + (r() - 0.5) * 0.05)); break;
    case 'crop': case 'blades': case 'flower': {
      // Halme auf transparentem Grund; Feldfrüchte mit farbigen Spitzen, Blumen mit Blüte
      const flower = info.fam === 'flower';
      for (let k = 0; k < (flower ? 1 : 5); k++) {
        let x = flower ? 7 : 1 + Math.floor(r() * 14);
        const top = flower ? 6 : 2 + Math.floor(r() * 5);
        for (let y = TILE - 1; y >= top; y--) {
          set(x, y, shade(info.fam === 'crop' ? mix(STEM, base, 0.25) : STEM, 0.8 + r() * 0.35));
          if (!flower && r() < 0.25) x = Math.max(0, Math.min(TILE - 1, x + (r() < 0.5 ? -1 : 1)));
        }
        if (info.fam === 'crop') {
          for (let dy = 0; dy < 3; dy++) for (let dx = -1; dx <= 1; dx++) if (r() < 0.7) set(x + dx, top + dy, shade(base, 0.85 + r() * 0.3));
        }
        if (flower) {
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) set(x + dx, top - 2 + dy, shade(base, dx === 0 && dy === 0 ? 1.25 : 0.9 + r() * 0.2));
          for (const [lx, ly] of [[-2, 11], [-1, 10], [2, 12], [1, 11]] as const) set(x + lx, ly, shade(STEM, 0.9));
        }
      }
      break;
    }
    default: fill(() => shade(base, 0.9 + r() * 0.2));
  }
  return px;
}

// ---------------------------------------------------------------------------------------------- Atlas

/** UV-Rechteck einer Kachel im Atlas: [u0, v0, u1, v1], v0 = obere Kante (Bildzeile 0, `flipY = false`). */
export type TileRect = readonly [number, number, number, number];

export interface PixelAtlas {
  /** Kantenlänge in Pixeln (Zweierpotenz) */
  readonly size: number;
  /** RGBA-Pixel, Zeile 0 oben */
  readonly pixels: Uint8ClampedArray;
  /** Anzahl verschiedener Kacheln */
  readonly tileCount: number;
  /** Rechteck für Block + Fläche; `undefined`, wenn der Block beim Aufbau nicht dabei war. */
  rect(blockId: string, color: Rgb, face: TileFace): TileRect | undefined;
}

/** Welche Familien oben/seitlich/unten verschiedene Kacheln haben (alle anderen: eine Kachel für alle Flächen). */
const FACED: ReadonlySet<TextureFamily> = new Set(['log', 'stripped', 'grass', 'podzol', 'farmland', 'path', 'bookshelf', 'chest', 'barrel', 'furnace', 'table', 'hay']);

function tileKey(info: TextureInfo, face: TileFace): string {
  const f = !FACED.has(info.fam) ? 'all' : face === 'bottom' && info.fam !== 'grass' && info.fam !== 'podzol' ? 'top' : face;
  return `${info.fam}|${info.color}|${info.plank ?? ''}|${f}`;
}

/**
 * W14: zuletzt gebaute Atlanten nach Inhalt (Blöcke und Farben in Reihenfolge). Etage wechseln, Schnitt, Rückgängig
 * zeigen meist dieselben Blöcke – dann derselbe Atlas (dieselben Pixel), keine neue Textur. Klein gehalten.
 */
const recentAtlases: { readonly key: string; readonly atlas: PixelAtlas }[] = [];
const RECENT_ATLASES = 4;

/** Legt alle Kacheln für die Blöcke `(Name, Farbe)` in einen Atlas; gleiche Kacheln werden nur einmal gezeichnet. */
export function buildPixelAtlas(blocks: Iterable<readonly [string, Rgb]>): PixelAtlas {
  const list = [...blocks];
  const key = list.map(([id, color]) => `${id}=${color}`).join(';');
  const i = recentAtlases.findIndex((e) => e.key === key);
  if (i >= 0) {
    const [hit] = recentAtlases.splice(i, 1);
    recentAtlases.unshift(hit!);
    return hit!.atlas;
  }
  const atlas = paintAtlas(list);
  recentAtlases.unshift({ key, atlas });
  recentAtlases.length = Math.min(recentAtlases.length, RECENT_ATLASES);
  return atlas;
}

function paintAtlas(blocks: ReadonlyArray<readonly [string, Rgb]>): PixelAtlas {
  const index = new Map<string, number>();
  const tiles: { info: TextureInfo; face: TileFace; seed: number }[] = [];
  for (const [id, color] of blocks) {
    const info = classifyTexture(id, color);
    for (const face of ['top', 'side', 'bottom'] as const) {
      const key = tileKey(info, face);
      if (index.has(key)) continue;
      index.set(key, tiles.length);
      tiles.push({ info, face: key.endsWith('|all') ? 'side' : face === 'bottom' && !key.endsWith('|bottom') ? 'top' : face, seed: hashString(key) });
    }
  }
  const perRow = Math.max(1, Math.ceil(Math.sqrt(tiles.length)));
  let size = 64;
  while (size < perRow * STRIDE) size *= 2;
  const cols = Math.floor(size / STRIDE);
  const pixels = new Uint8ClampedArray(size * size * 4);
  tiles.forEach((t, i) => {
    const src = paintTile(t.info, t.face, t.seed);
    const ox = (i % cols) * STRIDE, oy = Math.floor(i / cols) * STRIDE;
    for (let y = -PAD; y < TILE + PAD; y++) for (let x = -PAD; x < TILE + PAD; x++) {
      const si = ((((y % TILE) + TILE) % TILE) * TILE + (((x % TILE) + TILE) % TILE)) * 4;
      const di = ((oy + PAD + y) * size + (ox + PAD + x)) * 4;
      pixels[di] = src[si]!; pixels[di + 1] = src[si + 1]!; pixels[di + 2] = src[si + 2]!; pixels[di + 3] = src[si + 3]!;
    }
  });
  const rects = new Map<string, TileRect | undefined>();
  const rectOf = (i: number): TileRect => {
    const ox = (i % cols) * STRIDE + PAD, oy = Math.floor(i / cols) * STRIDE + PAD;
    return [ox / size, oy / size, (ox + TILE) / size, (oy + TILE) / size];
  };
  return {
    size,
    pixels,
    tileCount: tiles.length,
    rect(blockId, color, face) {
      // W14: je Block, Farbe und Fläche einmal klassifizieren (sonst je Quader drei Regex-Ketten)
      const k = `${blockId}|${color}|${face}`;
      if (rects.has(k)) return rects.get(k);
      const i = index.get(tileKey(classifyTexture(blockId, color), face));
      const r = i === undefined ? undefined : rectOf(i);
      rects.set(k, r);
      return r;
    },
  };
}
