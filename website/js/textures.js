// Eigene 16×16-Pixeltexturen im Blockstil, prozedural aus Blockname und Flächenfarbe erzeugt.
// KEINE Mojang-Texturen oder -Assets (research/08 §5): alles hier ist eigenes Material, deterministisch per Seed.
import * as THREE from 'three';

const T = 16;          // Texel je Kachel
const PAD = 8;         // Rand je Seite (wiederholter Inhalt) gegen Farbbluten in den Mipmaps
const STRIDE = T + PAD * 2;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const rgbOf = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const shade = (c, f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
const mixc = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// Grasfarbe (Oberseite). Foto-Look (W10-D): wie die Landfarbe des Golden-Renderers (presentation.ts MOODS.tag.land,
// linear 0,1/0,24/0,05) – gedämpfteres Grün statt Hellgrün; Studio unverändert.
const GRASS = [95, 159, 53];
// W16-A: etwas gelblicher und matter (Prüfer: „Wiese giftgrün“, Ebenen-Gras im Spiel um #79c05a … #8db360 vor Licht)
const GRASS_PHOTO = [98, 134, 60];

/** Pflanzen, die als gekreuzte Sprites gezeichnet werden. */
export const PLANT = /(wheat|carrots|potatoes|beetroots|short_grass|tall_grass|fern|bush|sapling|sugar_cane|hanging_roots|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily_of_the_valley|torchflower|mushroom$|rose|peony|lilac)/;

// Reife Feldfrüchte (eigene Werte nach dem Bild im Spiel: Weizen goldgelb, Karotten grünes Kraut mit Orange, Kartoffeln
// hellgrün, Rote Bete Kraut mit roten Stielen). Die Palettenfarbe der Szene taugt dafür nicht (grau-violetter Mittelwert).
const CROP = {
  wheat: { tip: [222, 190, 92], stem: [176, 168, 72] },
  carrots: { tip: [236, 132, 38], stem: [86, 158, 50] },
  potatoes: { tip: [196, 206, 96], stem: [84, 150, 52] },
  beetroots: { tip: [168, 42, 52], stem: [92, 146, 56] },
};

const WOODS = ['dark_oak', 'pale_oak', 'oak', 'spruce', 'birch', 'jungle', 'acacia', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped'];
const WOOD_PLANK = { oak: 0xa4834f, spruce: 0x755633, birch: 0xc4b27c, jungle: 0xa3754e, acacia: 0xab5c33, dark_oak: 0x45301c, mangrove: 0x783838, cherry: 0xe1b4ad, pale_oak: 0xe3d9cf, bamboo: 0xc9b25a, crimson: 0x6b344a, warped: 0x2b6963 };

/** Materialfamilie und Grundfarbe aus dem Blocknamen (Formen wie _stairs/_slab teilen die Textur des Vollblocks). */
function classify(name, color) {
  let n = name.replace(/^minecraft:/, '');
  const species = WOODS.find((w) => n.startsWith(`${w}_`) || n.startsWith(`stripped_${w}_`));
  if (species) {
    if (/_(log|wood|stem|hyphae)$/.test(n)) return { fam: n.startsWith('stripped_') ? 'stripped' : (n.endsWith('_wood') ? 'bark' : 'log'), color, plank: WOOD_PLANK[species] };
    if (/_leaves$/.test(n)) return { fam: 'leaves', color };
    return { fam: /_trapdoor$/.test(n) ? 'trapdoor' : /_door$/.test(n) ? 'door' : 'planks', color: WOOD_PLANK[species] ?? color };
  }
  n = n.replace(/_(stairs|slab|wall|pressure_plate|button)$/, '');
  const crop = /wheat|carrots|potatoes|beetroots/.exec(n);
  if (crop && PLANT.test(n)) return { fam: 'crop', color: (CROP[crop[0]].tip[0] << 16) | (CROP[crop[0]].tip[1] << 8) | CROP[crop[0]].tip[2], stem: CROP[crop[0]].stem };
  if (PLANT.test(n)) return { fam: /grass|fern|bush|roots|sapling|cane/.test(n) ? 'blades' : 'flower', color };
  if (/leaves$/.test(n)) return { fam: 'leaves', color };
  // W10-C: Laterne (dunkler Rahmen, leuchtendes Glas) und Lagerfeuer (Holzscheite, Glut oben) mit eigener Kachel
  if (/lantern$/.test(n) && !/jack_o/.test(n)) return { fam: 'lantern', color };
  if (/campfire/.test(n)) return { fam: 'campfire', color };
  if (/lantern|torch|glowstone|shroomlight|campfire/.test(n)) return { fam: 'glow', color };
  if (/glass/.test(n)) return { fam: 'glass', color };
  if (n === 'iron_bars' || /copper_bars/.test(n)) return { fam: 'bars', color };
  if (n === 'grass_block') return { fam: 'grass', color };
  if (n === 'podzol' || n === 'mycelium') return { fam: 'podzol', color };
  if (n === 'farmland') return { fam: 'farmland', color };
  if (n === 'dirt_path') return { fam: 'path', color };
  if (/dirt|mud$|packed_mud/.test(n) && !/bricks/.test(n)) return { fam: 'dirt', color };
  if (n === 'gravel') return { fam: 'gravel', color };
  if (/^(cobblestone|mossy_cobblestone|cobbled_deepslate)$/.test(n)) return { fam: n.startsWith('mossy') ? 'cobble_moss' : 'cobble', color };
  if (/deepslate_tiles|tiles$/.test(n)) return { fam: 'tiles', color };
  if (n === 'bricks' || n === 'brick') return { fam: 'bricks', color };
  if (/bricks?$/.test(n) || /chiseled_stone_bricks|stone_brick/.test(n)) return { fam: n.startsWith('mossy') ? 'stonebricks_moss' : n.startsWith('cracked') ? 'stonebricks_cracked' : 'stonebricks', color };
  if (/deepslate|tuff/.test(n)) return { fam: 'deepslate', color };
  if (/^polished_|smooth_stone/.test(n)) return { fam: 'polished', color };
  if (/stone|andesite|diorite|granite|calcite|blackstone/.test(n) && n !== 'grindstone') return { fam: 'stone', color };
  if (/wool|carpet|_bed$|banner/.test(n)) return { fam: 'wool', color };
  if (/terracotta|concrete/.test(n)) return { fam: 'terracotta', color };
  if (n === 'bookshelf' || n === 'chiseled_bookshelf') return { fam: 'bookshelf', color: WOOD_PLANK.oak };
  if (/chest$/.test(n)) return { fam: 'chest', color };
  if (n === 'barrel') return { fam: 'barrel', color: WOOD_PLANK.spruce };
  if (/furnace|smoker/.test(n)) return { fam: 'furnace', color };
  if (/crafting_table|smithing_table|fletching|cartography/.test(n)) return { fam: 'table', color: WOOD_PLANK.oak };
  if (n === 'hay_block') return { fam: 'hay', color };
  if (n === 'pumpkin' || n === 'melon') return { fam: 'ribbed', color };
  if (n === 'water' || n === 'water_cauldron') return { fam: 'water', color };
  if (n === 'moss_block' || n === 'moss_carpet') return { fam: 'moss', color };
  if (/lantern|torch|glowstone|shroomlight|campfire/.test(n)) return { fam: 'glow', color };
  if (/gold|copper|iron|block$/.test(n)) return { fam: 'metal', color };
  return { fam: 'noise', color };
}

/** Zeichnet eine 16×16-Kachel in `px` (Uint8ClampedArray, RGBA). face: 'top' | 'side' | 'bottom'. */
function paint(px, info, face, seed, opts = {}) {
  const r = rng(seed);
  const base = rgbOf(info.color);
  const set = (x, y, c, a = 255) => { const i = (y * T + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a; };
  const noiseFill = (c, amp = 0.12) => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade(c, 1 - amp + r() * amp * 2)); };
  const fam = info.fam;

  const planks = (c) => {
    for (let y = 0; y < T; y++) {
      const board = y >> 2, seam = (y & 3) === 3;
      const off = [3, 11, 6, 13][board];
      for (let x = 0; x < T; x++) {
        let f = 0.95 + r() * 0.1 + (((x * 7 + board * 13) % 5) === 0 ? -0.05 : 0);
        if (seam) f = 0.62;
        else if (x === off) f = 0.72;
        set(x, y, shade(c, f));
      }
    }
  };
  const stones = (c, gap, moss) => {
    // unregelmäßige Steine: Voronoi aus 7 Punkten, dunkle Fugen
    const pts = Array.from({ length: 7 }, () => [r() * T, r() * T, 0.85 + r() * 0.3]);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      let d1 = 1e9, d2 = 1e9, k = 0;
      for (let p = 0; p < pts.length; p++) for (const [ox, oy] of [[0, 0], [T, 0], [-T, 0], [0, T], [0, -T]]) {
        const d = Math.hypot(x - pts[p][0] - ox, y - pts[p][1] - oy);
        if (d < d1) { d2 = d1; d1 = d; k = p; } else if (d < d2) d2 = d;
      }
      let col = d2 - d1 < 1.2 ? shade(c, gap) : shade(c, pts[k][2] + (r() - 0.5) * 0.1 - d1 * 0.015);
      if (moss && r() < 0.35 && d2 - d1 >= 1.2) col = mixc(col, [74, 110, 44], 0.7);
      set(x, y, col);
    }
  };
  const bricks = (c, mortar, rows, moss, cracked) => {
    const h = T / rows;
    for (let y = 0; y < T; y++) {
      const row = Math.floor(y / h);
      const off = row % 2 ? T / (rows === 2 ? 2 : 4) : 0;
      const bw = rows === 2 ? T : T / 2;
      for (let x = 0; x < T; x++) {
        const bx = (x + off) % bw;
        const isMortar = y % h === h - 1 || bx === bw - 1;
        let col = isMortar ? mortar : shade(c, 0.92 + r() * 0.14 - (y % h === 0 ? -0.05 : 0));
        // W16-A (Galerie): Steine mit Fase wie im Spiel – Kante oben/links heller, unten/rechts dunkler (vorher flache
        // Rechtecke mit dünnen Fugen); die Zufallsfolge bleibt gleich, ohne die Option bitgleich
        if (!isMortar && opts.readable) col = shade(col, bx === 0 || y % h === 0 ? 1.1 : bx === bw - 2 || y % h === h - 2 ? 0.84 : 1);
        if (!isMortar && moss && r() < 0.18) col = mixc(col, [74, 110, 44], 0.75);
        set(x, y, col);
      }
    }
    if (cracked) { let x = 3 + Math.floor(r() * 8), y = 1; while (y < T - 1) { set(x, y, shade(c, 0.45)); x = Math.max(0, Math.min(T - 1, x + Math.round(r() * 2 - 1))); y++; } }
  };

  switch (fam) {
    case 'planks': planks(base); break;
    case 'trapdoor': {
      // W10-C: senkrechte Bretter mit zwei dunklen Querbändern und Rahmen (Fensterläden, Rundtür, Schornsteinkappe)
      planks(base);
      const t = px.slice();
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) for (let k = 0; k < 4; k++) px[(y * T + x) * 4 + k] = t[(x * T + y) * 4 + k];
      for (let i = 0; i < T; i++) { set(i, 0, shade(base, 0.6)); set(i, T - 1, shade(base, 0.6)); set(0, i, shade(base, 0.6)); set(T - 1, i, shade(base, 0.6)); }
      for (const y of [3, 12]) for (let x = 1; x < T - 1; x++) set(x, y, shade(base, 0.5));
      break;
    }
    case 'door':
      planks(base);
      for (let y = 2; y < 7; y++) for (let x = 3; x < 13; x++) set(x, y, mixc(shade(base, 0.8), [190, 215, 230], 0.25));
      set(12, 9, [60, 60, 60]); set(12, 10, [60, 60, 60]);
      break;
    case 'log': case 'bark': case 'stripped': {
      const bark = fam === 'stripped' ? shade(rgbOf(info.plank ?? info.color), 1.05) : base;
      if (face === 'top' && fam !== 'bark') {
        const inner = rgbOf(info.plank ?? info.color);
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
          const edge = d > 6.5;
          set(x, y, edge ? shade(bark, 0.9 + r() * 0.15) : shade(inner, (Math.floor(d) % 2 ? 0.88 : 1.02) + r() * 0.06));
        }
      } else {
        for (let x = 0; x < T; x++) { const col = 0.85 + ((x * 5) % 3) * 0.08 + r() * 0.05; for (let y = 0; y < T; y++) set(x, y, shade(bark, col + (r() < 0.12 ? -0.18 : r() * 0.06))); }
      }
      break;
    }
    case 'leaves':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const v = r();
        if (v < 0.16) set(x, y, shade(base, 0.35), 0);
        else set(x, y, shade(base, 0.75 + v * 0.45));
      }
      break;
    case 'glass': {
      const frame = mixc(base, [255, 255, 255], 0.35);
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const edge = x === 0 || y === 0 || x === T - 1 || y === T - 1;
        const streak = (x + y === 5 || x + y === 6 || x + y === 11) && x > 1 && y > 1 && x < T - 2 && y < T - 2;
        if (edge) set(x, y, shade(frame, 0.95 + r() * 0.1));
        else if (streak) set(x, y, mixc(frame, [255, 255, 255], 0.6), 190);
        else set(x, y, mixc(base, [200, 230, 255], 0.5), 0);
      }
      break;
    }
    case 'bars':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade(base, 0.8 + r() * 0.2), (x % 5 === 1 || x % 5 === 2 || y === 0 || y === T - 1) ? 255 : 0);
      break;
    case 'grass':
      if (face === 'top') { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade(info.grass ?? GRASS, 0.8 + r() * 0.35)); }
      else if (face === 'bottom') { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade([134, 96, 67], 0.8 + r() * 0.35)); }
      else {
        const edge = Array.from({ length: T }, () => 3 + Math.floor(r() * 3));
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, y < edge[x] ? shade(info.grass ?? GRASS, 0.78 + r() * 0.3) : shade([134, 96, 67], 0.78 + r() * 0.35));
      }
      break;
    case 'podzol':
      if (face === 'top') { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade(mixc(base, [110, 70, 30], 0.3), 0.75 + r() * 0.45)); }
      else { const edge = Array.from({ length: T }, () => 2 + Math.floor(r() * 2)); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, y < edge[x] ? shade(base, 0.8 + r() * 0.3) : shade([134, 96, 67], 0.78 + r() * 0.35)); }
      break;
    case 'farmland':
      if (face === 'top') { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade([82, 52, 30], (y % 4 === 0 ? 0.7 : 1) * (0.85 + r() * 0.3))); }
      else { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade([134, 96, 67], 0.78 + r() * 0.35)); }
      break;
    case 'path':
      if (face === 'top') { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade([148, 122, 72], 0.8 + r() * 0.35)); }
      else { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, y < 2 ? shade([148, 122, 72], 0.9) : shade([134, 96, 67], 0.78 + r() * 0.35)); }
      break;
    case 'dirt':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const v = r(); set(x, y, shade(base, v < 0.1 ? 0.65 : v > 0.93 ? 1.25 : 0.85 + r() * 0.25)); }
      break;
    case 'gravel':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const v = r(); set(x, y, shade(base, v < 0.25 ? 0.62 : v > 0.8 ? 1.3 : 0.95)); }
      break;
    case 'cobble': stones(base, 0.5, false); break;
    case 'cobble_moss': stones(base, 0.5, true); break;
    case 'stonebricks': bricks(base, shade(base, opts.readable ? 0.74 : 0.62), 2, false, false); break;
    case 'stonebricks_moss': bricks(base, shade(base, opts.readable ? 0.74 : 0.62), 2, true, false); break;
    case 'stonebricks_cracked': bricks(base, shade(base, opts.readable ? 0.74 : 0.62), 2, false, true); break;
    case 'bricks': bricks(base, [196, 186, 172], 4, false, false); break;
    case 'tiles':
      if (opts.readable) {
        // W13-D: kleinere Platten (4 × 4 Texel, Reihen versetzt) mit eigener Helligkeit, heller Oberkante und dunkler Fuge –
        // dunkle Dachziegel (Tiefenschiefer) bleiben auch im Schatten als Ziegel lesbar
        const tone = Array.from({ length: 16 }, () => 0.84 + r() * 0.3);
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const row = y >> 2, xx = (x + (row % 2) * 2) % T, ty = y & 3, tx = xx & 3;
          const f = tone[row * 4 + (xx >> 2)];
          set(x, y, ty === 3 || tx === 3 ? shade(base, 0.5) : shade(base, f * (ty === 0 ? 1.18 : 1) + (r() - 0.5) * 0.06));
        }
      } else for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, (x % 8 === 7 || y % 8 === 7) ? shade(base, 0.55) : shade(base, 0.9 + r() * 0.16));
      break;
    case 'deepslate':
      for (let y = 0; y < T; y++) { const row = 0.85 + r() * 0.2; for (let x = 0; x < T; x++) set(x, y, shade(base, row + (r() - 0.5) * 0.12)); }
      break;
    case 'polished':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const edge = x === 0 || y === 0 || x === T - 1 || y === T - 1; set(x, y, shade(base, edge ? 0.78 : 1.0 + (r() - 0.5) * 0.06)); }
      break;
    case 'stone':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const v = r(); set(x, y, shade(base, v < 0.08 ? 0.72 : v > 0.94 ? 1.18 : 0.92 + r() * 0.12)); }
      break;
    case 'wool':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade(base, ((x + y) % 2 ? 0.94 : 1.03) + (r() - 0.5) * 0.08));
      break;
    case 'terracotta': noiseFill(base, 0.05); break;
    case 'crop': case 'blades': case 'flower': {
      // Halme auf transparentem Grund; Feldfrüchte mit farbigen Spitzen, Blumen mit Blüte
      const stem = [74, 128, 44];
      for (let i = 0; i < T * T; i++) px[i * 4 + 3] = 0;
      const n = fam === 'flower' ? 1 : 5;
      for (let k = 0; k < n; k++) {
        let x = fam === 'flower' ? 7 : 1 + Math.floor(r() * 14);
        const top = fam === 'flower' ? 6 : 2 + Math.floor(r() * 5);
        for (let y = T - 1; y >= top; y--) {
          set(x, y, shade(fam === 'crop' ? info.stem : stem, 0.8 + r() * 0.35));
          if (fam !== 'flower' && r() < 0.25) x = Math.max(0, Math.min(T - 1, x + (r() < 0.5 ? -1 : 1)));
        }
        if (fam === 'crop') for (let dy = 0; dy < 3; dy++) for (let dx = -1; dx <= 1; dx++) if (r() < 0.7) set(Math.max(0, Math.min(T - 1, x + dx)), top + dy, shade(base, 0.85 + r() * 0.3));
        if (fam === 'flower') {
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) set(x + dx, top - 2 + dy, shade(base, dx === 0 && dy === 0 ? 1.25 : 0.9 + r() * 0.2));
          set(x - 2, 11, shade(stem, 0.9)); set(x - 1, 10, shade(stem, 0.9)); set(x + 2, 12, shade(stem, 0.9)); set(x + 1, 11, shade(stem, 0.9));
        }
      }
      break;
    }
    case 'bookshelf':
      if (face !== 'side') { planks(base); break; }
      planks(base);
      for (const row of [1, 9]) {
        let x = 1;
        while (x < T - 1) {
          const w = 1 + Math.floor(r() * 2), hgt = 5 + Math.floor(r() * 2);
          const bookC = [[150, 40, 40], [45, 80, 140], [60, 110, 50], [170, 140, 60], [100, 60, 120]][Math.floor(r() * 5)];
          for (let dx = 0; dx < w && x + dx < T - 1; dx++) for (let dy = 0; dy < hgt; dy++) set(x + dx, row + (6 - hgt) + dy, shade(bookC, 0.85 + r() * 0.2));
          x += w;
        }
      }
      break;
    case 'chest': {
      planks(base);
      const dark = shade(base, 0.45);
      for (let i = 0; i < T; i++) { set(i, 0, dark); set(i, T - 1, dark); set(0, i, dark); set(T - 1, i, dark); }
      if (face === 'side') { for (let x = 0; x < T; x++) set(x, 5, dark); for (let y = 4; y < 8; y++) for (let x = 7; x < 9; x++) set(x, y, [200, 200, 205]); }
      break;
    }
    case 'barrel':
      if (face === 'top') { planks(base); for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) set(x, y, shade(base, 0.55)); }
      else { for (let x = 0; x < T; x++) for (let y = 0; y < T; y++) set(x, y, (y === 2 || y === 13) ? [70, 70, 75] : shade(base, (x % 4 === 3 ? 0.7 : 0.95) + r() * 0.1)); }
      break;
    case 'furnace':
      bricks([128, 128, 128], [80, 80, 80], 4, false, false);
      if (face === 'side') for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) set(x, y, y > 11 ? [255, 150, 60] : [30, 30, 32]);
      break;
    case 'table':
      planks(base);
      if (face === 'top') for (let i = 1; i < T - 1; i++) { set(i, 5, shade(base, 0.55)); set(i, 10, shade(base, 0.55)); set(5, i, shade(base, 0.55)); set(10, i, shade(base, 0.55)); }
      break;
    case 'hay':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, (face === 'side' && (y === 3 || y === 12)) ? shade(base, 0.55) : shade(base, 0.85 + r() * 0.3));
      break;
    case 'ribbed':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade(base, (x % 4 === 0 ? 0.72 : 1) * (0.9 + r() * 0.15)));
      break;
    case 'water':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade([52, 96, 190], (Math.sin((x + y * 0.5) * 0.9) > 0.7 ? 1.25 : 0.95) + (r() - 0.5) * 0.08));
      break;
    case 'moss':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade(base, 0.8 + r() * 0.4));
      break;
    case 'glow':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade(base, 0.9 + r() * 0.3));
      break;
    case 'lantern': {
      // Rahmen aus dunklem Eisen; Glas in der Mitte (Seiten: Spalten 6–9, Zeilen 8–14 = Körper stehend und hängend)
      const frame = [52, 56, 64], glass = mixc(base, [255, 236, 170], 0.35);
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade(frame, 0.85 + r() * 0.3));
      if (face === 'side') for (let y = 9; y < 14; y++) for (let x = 6; x < 10; x++) set(x, y, shade(glass, (x === 7 || x === 8) && y > 9 && y < 13 ? 1.12 : 0.92));
      break;
    }
    case 'campfire': {
      // Holzscheite (Seiten) und oben Glut in der Mitte
      const log = [92, 64, 38], ember = [255, 150, 60];
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) set(x, y, shade(log, (y % 5 === 4 ? 0.6 : 0.9) + r() * 0.2));
      if (face === 'top') for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) set(x, y, shade(ember, 0.85 + r() * 0.3));
      break;
    }
    case 'metal':
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const edge = x === 0 || y === 0; const edge2 = x === T - 1 || y === T - 1; set(x, y, shade(base, edge ? 1.2 : edge2 ? 0.75 : 1 + (r() - 0.5) * 0.05)); }
      break;
    default: noiseFill(base, 0.1);
  }
}

// W10-D: Die Palettenfarbe einer Szene ist der Mittelwert der Spieltextur. Fugen, Maserung und Brettkanten der eigenen
// Kacheln dunkeln aber zusätzlich ab: Bruchstein lag im Mittel bei 58 %, Bretter bei 81 %, Steinziegel bei 89 % der
// Palettenhelligkeit (linear). Mit `trueAlbedo` wird jede Kachel dieser Familien so skaliert, dass ihr linearer
// Mittelwert der Palettenfarbe entspricht (Muster bleibt, nur die Helligkeit stimmt) – wie die echten Texturen im
// Golden-Renderer. Eigene Motive (Truhe, Regal, Ofen …), Pflanzen, Glas und Gras bleiben unverändert.
const TRUE_ALBEDO = new Set(['planks', 'trapdoor', 'door', 'log', 'bark', 'stripped', 'cobble', 'cobble_moss', 'stonebricks',
  'stonebricks_moss', 'stonebricks_cracked', 'bricks', 'tiles', 'deepslate', 'polished', 'stone', 'wool', 'terracotta', 'dirt',
  'gravel', 'hay', 'ribbed', 'moss', 'metal', 'noise']);
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const unlin = (c) => Math.round(255 * Math.min(1, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
const lumLin = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function toTrueAlbedo(px, info, face) {
  // Stirnseite von Stämmen: Bezug ist die Brettfarbe (Jahresringe), sonst die Palettenfarbe
  const ref = rgbOf((info.fam === 'log' || info.fam === 'stripped') && face === 'top' ? (info.plank ?? info.color) : info.color);
  let s = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) { s += lumLin(px[i], px[i + 1], px[i + 2]); n++; }
  if (!n || s === 0) return;
  const k = Math.min(2.5, lumLin(ref[0], ref[1], ref[2]) / (s / n));
  for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) px[i + c] = unlin(lin(px[i + c]) * k);
}

/**
 * Atlas aller Kacheln, die eine Szene braucht. Aufruf mit den Paletteneinträgen; liefert
 * { texture, tile(name, color, face) → [u0, v0, u1, v1], alpha(name) → bool }.
 * opts.trueAlbedo (W10-D, Foto-Look): Kachelmittel = Palettenfarbe (siehe toTrueAlbedo); ohne die Option bitgleich.
 * opts.readable (W13-D, Galerie): lesbarere Muster für dunkle Dachmaterialien (Ziegelplatten); ohne die Option bitgleich.
 */
export function buildAtlas(entries, opts = {}) {
  const keys = new Map();
  const tiles = [];
  const faceKey = (fam, face) => (['log', 'stripped', 'grass', 'podzol', 'farmland', 'path', 'bookshelf', 'chest', 'barrel', 'furnace', 'table', 'hay', 'lantern', 'campfire'].includes(fam) ? face : fam === 'door' ? 'side' : 'all');
  for (const [name, color] of entries) {
    const info = classify(name, color);
    for (const face of ['top', 'side', 'bottom']) {
      const fk = faceKey(info.fam, face === 'bottom' && info.fam !== 'grass' && info.fam !== 'podzol' ? 'top' : face);
      const key = `${info.fam}|${info.color}|${info.plank ?? ''}|${fk}`;
      if (!keys.has(key)) { keys.set(key, tiles.length); tiles.push({ info, face: fk === 'all' ? 'side' : fk, seed: hashStr(key) }); }
    }
  }
  const per = Math.ceil(Math.sqrt(tiles.length));
  let size = 1;
  while (size < per * STRIDE) size *= 2;
  const cols = Math.floor(size / STRIDE);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const img = g.createImageData(size, size);
  const px = new Uint8ClampedArray(T * T * 4);
  tiles.forEach((tile, i) => {
    px.fill(0);
    paint(px, opts.trueAlbedo && tile.info.fam === 'grass' ? { ...tile.info, grass: GRASS_PHOTO } : tile.info, tile.face, tile.seed, opts);
    if (opts.trueAlbedo && TRUE_ALBEDO.has(tile.info.fam)) toTrueAlbedo(px, tile.info, tile.face);
    const ox = (i % cols) * STRIDE, oy = Math.floor(i / cols) * STRIDE;
    // Kachel plus wiederholter Rand
    for (let y = -PAD; y < T + PAD; y++) for (let x = -PAD; x < T + PAD; x++) {
      const sx = ((x % T) + T) % T, sy = ((y % T) + T) % T;
      const si = (sy * T + sx) * 4, di = ((oy + PAD + y) * size + (ox + PAD + x)) * 4;
      img.data[di] = px[si]; img.data[di + 1] = px[si + 1]; img.data[di + 2] = px[si + 2]; img.data[di + 3] = px[si + 3];
    }
  });
  g.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.flipY = false;
  texture.anisotropy = 4;
  const uvOf = new Map();
  tiles.forEach((_, i) => {
    const ox = (i % cols) * STRIDE + PAD, oy = Math.floor(i / cols) * STRIDE + PAD;
    uvOf.set(i, [ox / size, oy / size, (ox + T) / size, (oy + T) / size]);
  });
  return {
    texture,
    tile(name, color, face) {
      const info = classify(name, color);
      const fk = faceKey(info.fam, face === 'bottom' && info.fam !== 'grass' && info.fam !== 'podzol' ? 'top' : face);
      return uvOf.get(keys.get(`${info.fam}|${info.color}|${info.plank ?? ''}|${fk}`));
    },
    /** Hat die Textur Löcher (Glas, Laub, Gitter)? */
    cutout(name) { const f = classify(name, 0).fam; return f === 'glass' || f === 'leaves' || f === 'bars' || f === 'crop' || f === 'blades' || f === 'flower'; },
  };
}

/**
 * W10-D: Grasoberseite als eigene, kachelnde Textur für den Boden bis zum Horizont (stage.js, Foto-Look). Gleiches Muster
 * und gleiche Farbe wie die Grasblöcke der Szene (trueAlbedo): Die Kante zwischen Geländestück und Boden verschwindet.
 * Fester Seed, deterministisch.
 */
export function grassTopTexture() {
  const px = new Uint8ClampedArray(T * T * 4);
  paint(px, { fam: 'grass', color: 0, grass: GRASS_PHOTO }, 'top', hashStr('grass|land|top'));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = T;
  const g = canvas.getContext('2d');
  const img = g.createImageData(T, T);
  img.data.set(px);
  g.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  return texture;
}
