/**
 * Farbzuordnung für 2D-Editor und 3D-Vorschau. Reine Daten + Funktionen.
 * Bewusst nur Flächenfarben – keine Texturen, nichts aus Mojang-Assets (research/08 §5).
 * Farben sind 24-Bit-RGB-Zahlen (0xRRGGBB); `css()` wandelt für Canvas/CSS um.
 */
import type { ComponentDef, MaterialSpec } from '@mcda/catalog';

export type Rgb = number;

/**
 * Flächen von Grundriss, Umgebungsplan und 3D-Vorschau in der Farbwelt der Oberfläche (W1, A7: Nachtblau wie die
 * Website, `styles.css` `--viewer-bg`). Das Raster ist bewusst sichtbarer als früher (Leerzustand: „kaum sichtbar“).
 * Raum-, Rollen- und Blockfarben unten sind semantisch und bleiben unverändert.
 */
export const SURFACE = {
  /** Hintergrund der 2D-Pläne. */
  plan: '#0f1329',
  /** Rasterlinie je Block bzw. alle 5 Blöcke. */
  gridMinor: '#28305a',
  gridMajor: '#414c8a',
  /** Hintergrund der 3D-Vorschau (auch Texturen-Renderer). */
  viewer: 0x121631,
  /** Bodenplatte und Rasterlinien der 3D-Vorschau. */
  ground: 0x1d2345,
  gridLine: 0x46518f,
} as const;

/** Raumtyp → Farbe im 2D-Editor. Unbekannte Typen bekommen eine stabile Farbe aus dem Namen. */
const ROOM_TYPE_COLORS: Readonly<Record<string, Rgb>> = {
  bedroom: 0x6c8ebf,
  kitchen: 0xd9a441,
  smithy: 0xb85c4b,
  storage: 0x8f7a5a,
  tavern: 0xc0763a,
  library: 0x6f5aa8,
  alchemy: 0x3fa38a,
  farm_room: 0x7aa843,
  stable: 0xa88a52,
  barn_farm: 0x94a05a,
  chicken_house: 0xc9b26a,
  apiary: 0xe0b83c,
  workshop_redstone: 0xc0443f,
  production_hall: 0xb5533c,
  brew_works: 0x4f9a8a,
  bakery_line: 0xd9a05b,
  arcane_study: 0x7d5fb5,
  artisan_workshop: 0xa3654a,
  crop_hall: 0x6fb04f,
  mushroom_cellar: 0x8a6a7d,
  herb_garden: 0x5fa06a,
  fn_villager_hall: 0xc48b4a,
  fn_villager_quarters: 0x7d9bc4,
  fn_cure_room: 0xd9d3a0,
  fn_spawner_chamber: 0x4a5a7a,
};

/** Material-Rolle → Farbe (Hülle und Möbel). */
const ROLE_COLORS: Readonly<Record<string, Rgb>> = {
  floor_primary: 0x9c7a54,
  wall_primary: 0xd8cfc0,
  beam: 0x5b4331,
  door: 0x7a5534,
  window: 0xa8d0e6,
  ceiling: 0x8a6b4a,
  roof_main: 0x7a3b2e,
  // Dachkante und Außenprofil (U4: sonst Namens-Farben, in den Vorschaubildern des Assistenten bunte Streifen)
  roof_trim: 0x5a2a22,
  wall_plinth: 0x8d8a84,
  portal_stone: 0x9a9791,
  wall_cornice: 0x6b5240,
  wall_quoin: 0xb9b3a8,
  furniture_wood: 0xa0703f,
  textile_primary: 0xb0413e,
  metal: 0x5a5f66,
  light_hanging: 0xffd27a,
};

/** Blockfamilie (Name ohne Namensraum) → Farbe, für Katalog-Materialien mit festem `block`. */
const FAMILY_COLORS: Readonly<Record<string, Rgb>> = {
  chest: 0xa66f2c,
  barrel: 0x8b5a2b,
  furnace: 0x7d7d7d,
  smoker: 0x6b5a4a,
  blast_furnace: 0x5d6068,
  crafting_table: 0xa0763f,
  anvil: 0x44474d,
  grindstone: 0x8e8e8e,
  smithing_table: 0x3b3f4a,
  water_cauldron: 0x4f6f9f,
  cauldron: 0x4a4a4f,
  cake: 0xf1e6d8,
  candle: 0xf5e6b0,
  wall_torch: 0xffc94d,
  torch: 0xffc94d,
  lantern: 0xffd27a,
};

const POTTED_COLOR: Rgb = 0x9b5a3c;

/** Kategorie → Farbe (Fallback und 2D-Möbelsymbole). */
const CATEGORY_COLORS: Readonly<Record<ComponentDef['category'], Rgb>> = {
  furniture: 0xa0703f,
  decor: 0xc58fd6,
  attachment: 0x9a9a9a,
  light: 0xffd27a,
  storage: 0x8b5a2b,
  work: 0x6f7780,
  architecture: 0xbdbdbd,
  overlay: 0xcfcfcf,
};

/** Stabile Farbe aus einem Namen (FNV-1a → Farbton), für unbekannte Rollen/Raumtypen. */
export function hashColor(name: string, saturation = 0.45, lightness = 0.55): Rgb {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hsl(((h >>> 0) % 360) / 360, saturation, lightness);
}

function hsl(h: number, s: number, l: number): Rgb {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

export const css = (c: Rgb): string => `#${c.toString(16).padStart(6, '0')}`;

export function roomTypeColor(roomTypeId: string): Rgb {
  return ROOM_TYPE_COLORS[roomTypeId] ?? hashColor(`room:${roomTypeId}`);
}

export function roleColor(role: string): Rgb {
  return ROLE_COLORS[role] ?? hashColor(`role:${role}`);
}

export function categoryColor(category: ComponentDef['category']): Rgb {
  return CATEGORY_COLORS[category];
}

/** Blockfamilie aus einer Block-ID: „minecraft:blast_furnace“ → „blast_furnace“. */
export function blockFamily(blockId: string): string {
  const i = blockId.indexOf(':');
  return i >= 0 ? blockId.slice(i + 1) : blockId;
}

/** Farbe eines Katalog-Materials: Rolle, sonst Blockfamilie, sonst Kategorie der Komponente. */
export function materialColor(mat: MaterialSpec, category: ComponentDef['category']): Rgb {
  if (mat.role !== undefined) return roleColor(mat.role);
  if (mat.block !== undefined) {
    const fam = blockFamily(mat.block);
    const c = FAMILY_COLORS[fam];
    if (c !== undefined) return c;
    if (fam.startsWith('potted_')) return POTTED_COLOR;
  }
  return categoryColor(category);
}

/** Leuchtet das Material (Laterne, Fackel, Kerze)? Leuchtende Zellen werden in 3D unbeleuchtet hell gezeichnet. */
export function isLightMaterial(mat: MaterialSpec): boolean {
  if (mat.role !== undefined && mat.role.startsWith('light')) return true;
  const name = mat.shape ?? (mat.block !== undefined ? blockFamily(mat.block) : '');
  return /torch|lantern|candle|glowstone|lamp|campfire/.test(name);
}
