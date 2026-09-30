/**
 * Farb-Grundlagen für die Block-Vorschau und die Kennzahl P1: 24-Bit-RGB, stabile Namensfarbe und die
 * Blockfamilie aus einer Block-ID. Reine Daten und Funktionen, ohne Abhängigkeit auf Katalog oder UI
 * (bewusst getrennt von der Rollen-/Raumtyp-Farbwelt der App in `packages/app/src/colors.ts`; die Formeln
 * sind dort und hier identisch, damit die Vorschau und P1 dieselbe Farbe sehen).
 */
export type Rgb = number;

/** Blockfamilie aus einer Block-ID: „minecraft:blast_furnace“ → „blast_furnace“. */
export function blockFamily(blockId: string): string {
  const i = blockId.indexOf(':');
  return i >= 0 ? blockId.slice(i + 1) : blockId;
}

function hsl(h: number, s: number, l: number): Rgb {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** Stabile Farbe aus einem Namen (FNV-1a → Farbton), für Blöcke ohne eigene Regel. */
export function hashColor(name: string, saturation = 0.45, lightness = 0.55): Rgb {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hsl(((h >>> 0) % 360) / 360, saturation, lightness);
}
