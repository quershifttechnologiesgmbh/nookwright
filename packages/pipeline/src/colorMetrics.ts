/**
 * Farbkennzahlen eines fertigen Baus (Welle WS, Schritt 3 „Farben“ des Bauprozess-Tutorials,
 * plan/spikes/LV_yt_bauprozess_7schritte.md). Sie machen die vier Regeln messbar, damit Baseline und Variante
 * (`colorHarmony`) vergleichbar sind:
 *
 *  1. **Kontrast** – Helligkeitsabstand (OKLab-L): Sockel ↔ Wand, Wand ↔ Dach, Zierholz ↔ Wand, Dachkante ↔ Dach.
 *  2. **Hauptfarbe/Akzent** – Anteil der häufigsten Farbklasse an den Außenblöcken und Akzentverhältnis
 *     `accent / (main + accent)` (Soll etwa 0,2; nie um 0,5).
 *  3. **Sättigung** – mittlere OKLab-Buntheit (Chroma), gewichtet nach Blockzahl.
 *  4. **Verlauf je Bauteil** – Zahl verschiedener Blöcke (Töne) je Gruppe.
 *
 * Grundlage ist das Rollenprotokoll der Materialisierung (`MaterializeResult.palette`: Block, Rolle, Anzahl) und die
 * Blockfarbe aus `blockLook` (Heuristik, keine Mojang-Assets). Rein und deterministisch.
 */
import { blockLook } from './blockColors.js';

/** Bauteil-Gruppen der Außenhülle mit ihren Theme-Rollen. */
export const COLOR_PARTS = {
  base: ['foundation', 'wall_plinth', 'cellar_stone'],
  wall: ['wall_primary', 'wall_plaster', 'wall_secondary'],
  roof: ['roof_main'],
  trim: ['beam', 'window_frame', 'shutter', 'pillar', 'wall_cornice', 'wall_quoin'],
  edge: ['roof_trim'],
} as const;
export type ColorPart = keyof typeof COLOR_PARTS;
export const COLOR_PART_IDS = Object.keys(COLOR_PARTS) as ColorPart[];

/** Ein Eintrag des Rollenprotokolls (Form von `PaletteEntry` der Materialisierung). */
export interface ColorEntry {
  readonly block: string;
  readonly role?: string | undefined;
  readonly count: number;
}

/** OKLab (L, a, b) einer 24-Bit-Farbe, nach Björn Ottosson. */
export function oklab(rgb: number): { L: number; a: number; b: number } {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const r = lin(((rgb >> 16) & 0xff) / 255);
  const g = lin(((rgb >> 8) & 0xff) / 255);
  const bl = lin((rgb & 0xff) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Buntheit (OKLab-Chroma, 0 = grau, ~0,3 = sehr bunt) und Farbwinkel in Grad (0–360) eines Blocks. */
export function blockChroma(blockId: string): { L: number; C: number; hue: number } {
  const { L, a, b } = oklab(blockLook(blockId).color);
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return { L, C: Math.hypot(a, b), hue: hue < 0 ? hue + 360 : hue };
}

/**
 * Farbklassen für „Hauptfarbe/Akzent“: unbunte Blöcke nach Helligkeit (hell, mittel, dunkel), bunte nach Farbwinkel
 * (warm = rot bis gelb, grün, kühl = blau bis violett). Grenze „unbunt“: Chroma unter {@link NEUTRAL_CHROMA}.
 */
export const NEUTRAL_CHROMA = 0.06;
export type ColorClass = 'light' | 'mid' | 'dark' | 'warm' | 'green' | 'cool';
export const COLOR_CLASSES: readonly ColorClass[] = ['light', 'mid', 'dark', 'warm', 'green', 'cool'];

export function colorClassOf(blockId: string): ColorClass {
  const { L, C, hue } = blockChroma(blockId);
  if (C < NEUTRAL_CHROMA) return L > 0.75 ? 'light' : L > 0.45 ? 'mid' : 'dark';
  // OKLab-Winkel: rot ≈ 30°, orange ≈ 55°, gelb ≈ 100°, grün ≈ 140°, cyan ≈ 200°, blau ≈ 265°, violett ≈ 310°
  if (hue < 118 || hue >= 335) return 'warm';
  if (hue < 175) return 'green';
  return 'cool';
}

export interface PartMetric {
  /** Anzahl Blöcke der Gruppe. */
  readonly count: number;
  /** Gewichtete mittlere Helligkeit (OKLab-L), `undefined` ohne Blöcke. */
  readonly lightness: number | undefined;
  /** Verschiedene Blöcke (ohne Formen: Familie zählt einmal) – Töne des Verlaufs. */
  readonly tones: number;
  /** Streuung der Helligkeit innerhalb der Gruppe (Standardabweichung OKLab-L) – „Verlauf“. */
  readonly spread: number;
}

export interface ColorMetrics {
  readonly parts: Readonly<Record<ColorPart, PartMetric>>;
  /** Helligkeitsabstände (OKLab-L, Betrag) zwischen den Gruppen; `undefined`, wenn eine Gruppe fehlt. */
  readonly contrast: {
    readonly baseWall: number | undefined;
    readonly wallRoof: number | undefined;
    readonly trimWall: number | undefined;
    readonly edgeRoof: number | undefined;
    /** Kleinster der vier Abstände (die schwächste Stelle). */
    readonly min: number | undefined;
    /** Spanne hellste bis dunkelste Gruppe. */
    readonly range: number | undefined;
  };
  /** Anteile der Farbklassen an allen Außenblöcken (Summe 1). */
  readonly classShare: Readonly<Record<ColorClass, number>>;
  /** Anteil der häufigsten Farbklasse (Hauptfarbe), der zweithäufigsten (Akzent). */
  readonly main: { readonly cls: ColorClass; readonly share: number };
  readonly accent: { readonly cls: ColorClass; readonly share: number };
  /** Akzentverhältnis `accent / (main + accent)`: Soll um 0,2, Warnung um 0,5 (nie 50/50). */
  readonly accentRatio: number;
  /** Mittlere Buntheit (OKLab-Chroma) über alle Außenblöcke. */
  readonly saturation: number;
  /** Anzahl Außenblöcke insgesamt. */
  readonly blocks: number;
}

const ROLE_PART: Readonly<Record<string, ColorPart>> = Object.fromEntries(
  COLOR_PART_IDS.flatMap((p) => COLOR_PARTS[p].map((r) => [r, p] as const)),
);

/** Basisname eines Blocks ohne Form (`cobblestone_stairs` → `cobblestone`), für die Zählung der Töne. */
function toneOf(block: string): string {
  return block.replace(/^minecraft:/, '').replace(/_(stairs|slab|wall|fence|fence_gate|trapdoor|button|door|planks|log|wood|hanging_sign|sign)$/, '');
}

/** Kennzahlen aus dem Rollenprotokoll der Materialisierung. Nur Rollen der Außenhülle zählen. */
export function colorMetrics(entries: readonly ColorEntry[]): ColorMetrics {
  const groups: Record<ColorPart, { L: number; n: number; L2: number; tones: Set<string> }> = {
    base: { L: 0, n: 0, L2: 0, tones: new Set() },
    wall: { L: 0, n: 0, L2: 0, tones: new Set() },
    roof: { L: 0, n: 0, L2: 0, tones: new Set() },
    trim: { L: 0, n: 0, L2: 0, tones: new Set() },
    edge: { L: 0, n: 0, L2: 0, tones: new Set() },
  };
  const cls: Record<ColorClass, number> = { light: 0, mid: 0, dark: 0, warm: 0, green: 0, cool: 0 };
  let chroma = 0;
  let total = 0;
  for (const e of entries) {
    const part = e.role === undefined ? undefined : ROLE_PART[e.role];
    if (part === undefined || e.count <= 0) continue;
    const { L, C } = blockChroma(e.block);
    const g = groups[part];
    g.L += L * e.count;
    g.L2 += L * L * e.count;
    g.n += e.count;
    g.tones.add(toneOf(e.block));
    cls[colorClassOf(e.block)] += e.count;
    chroma += C * e.count;
    total += e.count;
  }
  const parts = Object.fromEntries(COLOR_PART_IDS.map((p) => {
    const g = groups[p];
    const mean = g.n === 0 ? undefined : g.L / g.n;
    const variance = g.n === 0 ? 0 : Math.max(0, g.L2 / g.n - (mean ?? 0) ** 2);
    return [p, { count: g.n, lightness: mean, tones: g.tones.size, spread: Math.sqrt(variance) } satisfies PartMetric];
  })) as Record<ColorPart, PartMetric>;
  const d = (a: ColorPart, b: ColorPart): number | undefined => {
    const x = parts[a].lightness;
    const y = parts[b].lightness;
    return x === undefined || y === undefined ? undefined : Math.abs(x - y);
  };
  const c4 = [d('base', 'wall'), d('wall', 'roof'), d('trim', 'wall'), d('edge', 'roof')];
  const known = c4.filter((x): x is number => x !== undefined);
  const ls = COLOR_PART_IDS.map((p) => parts[p].lightness).filter((x): x is number => x !== undefined);
  const share = Object.fromEntries(COLOR_CLASSES.map((c) => [c, total === 0 ? 0 : cls[c] / total])) as Record<ColorClass, number>;
  const ranked = [...COLOR_CLASSES].sort((a, b) => share[b] - share[a] || COLOR_CLASSES.indexOf(a) - COLOR_CLASSES.indexOf(b));
  return {
    parts,
    contrast: {
      baseWall: c4[0], wallRoof: c4[1], trimWall: c4[2], edgeRoof: c4[3],
      min: known.length === 0 ? undefined : Math.min(...known),
      range: ls.length < 2 ? undefined : Math.max(...ls) - Math.min(...ls),
    },
    classShare: share,
    main: { cls: ranked[0]!, share: share[ranked[0]!] },
    accent: { cls: ranked[1]!, share: share[ranked[1]!] },
    accentRatio: share[ranked[0]!] + share[ranked[1]!] === 0 ? 0 : share[ranked[1]!] / (share[ranked[0]!] + share[ranked[1]!]),
    saturation: total === 0 ? 0 : chroma / total,
    blocks: total,
  };
}
