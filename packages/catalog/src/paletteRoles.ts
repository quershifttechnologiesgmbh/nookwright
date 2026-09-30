/**
 * Die elf Paletten-Rollen (research/54 §2.2) – eigene Datei ohne Abhängigkeiten, damit `theme.ts` sie für
 * `paletteRoleMap` und `palette.ts` sie für das Palette-Schema nutzen können, ohne sich gegenseitig zu importieren.
 *
 * Die Rollen sind bewusst gröber als die ~90 Theme-Rollen: Eine Palette kennt nur **Oberflächenklassen**
 * (Wandfläche, Dach, Rahmen, Holz, Boden, Akzent, Glas, Licht, Bewuchs), keine Bauteil-Semantik.
 */
export const PALETTE_ROLES = [
  'wall_primary', 'wall_secondary', 'trim', 'roof', 'roof_accent',
  'wood_frame', 'floor', 'accent', 'glass', 'light', 'foliage',
] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];

/** Stimmungen (research/54 §1.4) – Achsen-Kombinationen aus Wertspanne, Sättigung und Temperatur. */
export const PALETTE_MOODS = ['gemuetlich', 'duester', 'festlich', 'verfallen', 'winterlich', 'magisch'] as const;
export type PaletteMood = (typeof PALETTE_MOODS)[number];
