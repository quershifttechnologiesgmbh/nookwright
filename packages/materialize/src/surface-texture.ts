/**
 * Oberflächen-Textur (TX-B „Blockmischung, Verläufe, Musterbruch“, Schalter `surfaceTexture`).
 *
 * Ein reiner **Blocktausch-Pass** (keine Geometrie, keine Rollen, keine Physik): Wände, Sockel und Dachhaut bekommen
 * räumlich zusammenhängende Mischungen aus Nachbarblöcken (Schwesterfamilien) statt eines flächigen Grundblocks.
 * Jede Änderung hat eine benannte **Regel** (`TextureRule`), die Kennzahl „Blöcke je Regel“ steht in den Stats.
 *
 * Schwesterblöcke kommen aus den Familien-Daten (Texturfarbe): gleiche Art (Stein/Holz/Terrakotta), gleiche Form
 * (Treppe bleibt Treppe, Stamm bleibt Stamm; `resolveState` ergänzt Pflicht-Eigenschaften wie `axis`), Farbrichtung nah,
 * Helligkeit in Klassen `near`/`dark`/`light`. Unruhige Blöcke (`BLOCK_BUSYNESS`) füllen nie, höchstens eine unruhige
 * Sorte je Fleck (Rauschbudget).
 *
 * Ablauf je Wandebene (Reihenfolge wie im Short „Texture like a pro“, plan/spikes/LV_yt_texturieren_profi.md):
 *   1. Wunschklasse je Zelle aus Rauschfeld + Regeln (Flecken 60/25/15, Rücksprung dunkler, Sockel, Band unter Traufe).
 *   2. **Verlaufskette per WFC** (`GRADIENT_MODEL`): Grundblock, Akzent dunkel und Akzent hell grenzen nie direkt
 *      aneinander, nur über den nahen Ton – so entsteht an jeder Fleckgrenze ein 3-Block-Verlauf (Regel `gradient`).
 *   3. Kanten: Ecksteine, Laibungen, Highlights auf vorstehenden Trägern/Kanten (`surface-relief.ts`).
 *   4. Musterbruch (Streublock) in gleichblockigen Flächen.
 *
 * **Rein und deterministisch**: Zufall nur aus dem Projekt-Seed (`hashSeed`, `hash01`, `clusterU`, `solveWfc`). Läuft nach
 * dem Merge und vor der Verwitterung (`narrative-weathering.ts` baut darauf auf), Autotiling, Bans und Physik.
 */
import type { Shell, ShellKind } from '@mcda/blueprint';
import { clusterU, grid2d, hash01, hashSeed, key3, solveWfc, type NoiseParams, type Vec3, type WfcModel } from '@mcda/core';
import type { FamilyData } from '@mcda/platform';
import { blockState, isAir, type VoxelVolume } from '@mcda/voxel';
import type { CellContext } from './context.js';
import { wallRelief } from './surface-relief.js';

/** Stufen des Schalters `surfaceTexture` (aus = kein Pass). */
export type SurfaceTextureLevel = 'subtle' | 'rich';
/** Schalter in Pipeline/Engine/App: `off` = kein Pass (bitgleich). */
export type SurfaceTextureSwitch = 'off' | SurfaceTextureLevel;

/** Benannte Regeln – jede geänderte Zelle gehört zu genau einer. */
export const TEXTURE_RULES = [
  'patch', 'socle', 'band', 'corner', 'reveal', 'scatter', 'roof_patch', 'roof_gradient', 'roof_stripe', 'gradient', 'recess', 'highlight', 'roof_slope',
] as const;
export type TextureRule = (typeof TEXTURE_RULES)[number];

/** Helligkeitsklasse des Ersatzblocks relativ zum Ausgangsblock. */
export type TextureTone = 'near' | 'dark' | 'light';

/**
 * Regressionskennzahlen einer Blockfläche (DR3 B6), über alle Nachbarpaare (4er-Nachbarschaft) der Wandebenen:
 * `sameShare` Anteil gleicher Nachbarn (Autokorrelation; hoch = Flecken, niedrig = Splitter), `stripeIndex` = gleiche
 * waagerechte minus gleiche senkrechte Paare (≠ 0 = Streifen), `meanDeltaL`/`p90DeltaL` Helligkeitssprung (CIE L*) zwischen
 * Nachbarn, `jumpShare` Anteil der Paare mit |ΔL*| > 20 (harte Sprünge).
 */
export interface TextureMetrics {
  readonly pairs: number;
  readonly sameShare: number;
  readonly stripeIndex: number;
  readonly meanDeltaL: number;
  readonly p90DeltaL: number;
  readonly jumpShare: number;
}

/** Kontrast Hauptwand/Hauptdach (DR3 B3): nur Warnung, nie Zwang. */
export interface WallRoofContrast {
  readonly wall: string;
  readonly roof: string;
  /** |ΔL*| (CIE L*, 0–100). */
  readonly dL: number;
  /** Farbabstand in a*b* (Buntton + Sättigung). */
  readonly dChroma: number;
  /** Wand und Dach verschwimmen (ΔL* < 10 und Δa*b* < 12). */
  readonly warning: boolean;
}

export interface SurfaceTextureStats {
  readonly level: SurfaceTextureLevel;
  readonly strength: number;
  /** Berücksichtigte Außenzellen (Wandflächen, Sockel, Dachhaut). */
  readonly wallCells: number;
  readonly roofCells: number;
  readonly changed: number;
  /** Blöcke je Regel (Summe = `changed`). */
  readonly byRule: Readonly<Record<TextureRule, number>>;
  readonly byTone: Readonly<Record<TextureTone, number>>;
  /** Anteil geänderter Zellen an den berücksichtigten Zellen (0–1). */
  readonly changedShare: number;
  /** Gleichblockige, nicht überlappende 4×3-Fenster in den Wandflächen vor/nach dem Pass. */
  readonly uniformWindowsBefore: number;
  readonly uniformWindowsAfter: number;
  /** Shannon-Entropie (Bit) der Blockverteilung der Wandzellen vor/nach dem Pass. */
  readonly entropyBefore: number;
  readonly entropyAfter: number;
  /** Streu-Anteil: Anteil der getauschten Wandzellen ohne getauschten Nachbarn (4er-Nachbarschaft in der Wandebene). Klein = Flecken statt Splitter. */
  readonly isolatedShare: number;
  /** B6: Kennzahlen der Wandflächen vor/nach dem Pass. */
  readonly metricsBefore: TextureMetrics;
  readonly metricsAfter: TextureMetrics;
  /** B1: unruhige Blöcke, die das Rauschbudget (eine unruhige Sorte je Fleck) durch ruhige ersetzt hat. */
  readonly busyReplaced: number;
  /** Verlaufskette: gelöste Ebenen (Wand + Dach), davon per Rückfall (Reparatur statt WFC). */
  readonly gradientPlanes: number;
  readonly gradientFallbacks: number;
  /** B3: Kontrast Hauptwand/Hauptdach (fehlt, wenn einer der Blöcke keine Farbdaten hat). */
  readonly contrast?: WallRoofContrast;
}

export interface SurfaceTextureInput {
  readonly volume: VoxelVolume;
  readonly shell: Shell;
  /** Kontext je Hüllzelle (gleiche Reihenfolge wie `shell.cells`). */
  readonly contexts: readonly CellContext[];
  /** Rolle je Position (`key3`), wie im Merge gesetzt. */
  readonly roleAt: ReadonlyMap<string, string>;
  readonly families: FamilyData;
  /** Gibt es den Block in der Zielversion (und ist er nicht gesperrt)? */
  readonly hasBlock: (name: string) => boolean;
  /** Ergänzt Pflicht-Eigenschaften des Ziel-Blocks (z. B. `axis` bei Tiefenschiefer). */
  readonly resolveState?: (name: string, props: Readonly<Record<string, string>>) => { readonly name: string; readonly properties: Readonly<Record<string, string>> };
  readonly seed: number;
  readonly level: SurfaceTextureLevel;
  /** Stärke ≥ 0 (Stufe × Story-Profil); ≤ 0 = nichts. 1 = Regel 60/25/15. */
  readonly strength: number;
  /** Richtung des Dachverlaufs: `eave_dark` (Standard: Traufe dunkel, First hell) oder `ridge_dark`. */
  readonly roofGradient?: 'eave_dark' | 'ridge_dark';
}

// ------------------------------------------------------------------ Farbe

const stripNs = (n: string): string => (n.startsWith('minecraft:') ? n.slice(10) : n);

function rgb(hex: string | undefined): readonly [number, number, number] | undefined {
  if (hex === undefined || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
const lum = (c: readonly [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function chromaDist(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const sa = Math.max(1, a[0] + a[1] + a[2]);
  const sb = Math.max(1, b[0] + b[1] + b[2]);
  return Math.hypot(a[0] / sa - b[0] / sb, a[1] / sa - b[1] / sb, a[2] / sa - b[2] / sb);
}

/** CIE L*a*b* (D65) aus sRGB-Hex; `undefined` ohne gültige Farbe. */
export function cieLab(hex: string | undefined): readonly [number, number, number] | undefined {
  const c = rgb(hex);
  if (c === undefined) return undefined;
  const lin = c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  const X = (0.4124 * lin[0]! + 0.3576 * lin[1]! + 0.1805 * lin[2]!) / 0.95047;
  const Y = 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  const Z = (0.0193 * lin[0]! + 0.1192 * lin[1]! + 0.9505 * lin[2]!) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** B3: Kontrast zweier Blöcke über ihre Familienfarbe (Blockname → Familie aus `families`). */
export function wallRoofContrast(families: FamilyData, wall: string, roof: string): WallRoofContrast | undefined {
  const colorOf = (name: string): string | undefined => {
    const n = stripNs(name);
    for (const f of Object.values(families.families)) for (const b of Object.values(f.shapes)) if (stripNs(b) === n) return f.color;
    return undefined;
  };
  const a = cieLab(colorOf(wall));
  const b = cieLab(colorOf(roof));
  if (a === undefined || b === undefined) return undefined;
  const dL = Math.abs(a[0] - b[0]);
  const dChroma = Math.hypot(a[1] - b[1], a[2] - b[2]);
  return { wall: stripNs(wall), roof: stripNs(roof), dL, dChroma, warning: dL < 10 && dChroma < 12 };
}

// ------------------------------------------------------------------ Unruhe (B1)

/** Unruhe der Textur: 0 ruhig (glatt, poliert, Putz, Bretter), 1 mittel (Mauerwerk, Ziegel), 2 unruhig (Bruchstein, Sprenkel). */
export type Busyness = 0 | 1 | 2;

/**
 * Handklassifikation der Stein-/Terrakotta-Familien nach Texturunruhe (DR3 B1, Vorbild SchemaLook/HueBlocks). Fehlende
 * Familien gelten als mittel; Holzbretter und Terrakotta sind ruhig, Stämme mittel.
 */
export const BLOCK_BUSYNESS: Readonly<Record<string, Busyness>> = {
  smooth_stone: 0, smooth_sandstone: 0, smooth_red_sandstone: 0, smooth_quartz: 0, smooth_basalt: 0, calcite: 0, quartz: 0, quartz_bricks: 0,
  polished_andesite: 0, polished_diorite: 0, polished_granite: 0, polished_deepslate: 0, polished_blackstone: 0, polished_tuff: 0, polished_basalt: 0,
  cut_sandstone: 0, cut_red_sandstone: 0, packed_mud: 0,
  stone: 1, andesite: 1, stone_bricks: 1, bricks: 1, mud_bricks: 1, deepslate: 1, deepslate_bricks: 1, deepslate_tiles: 1, tuff: 1, tuff_bricks: 1,
  sandstone: 1, red_sandstone: 1, polished_blackstone_bricks: 1, nether_bricks: 1, end_stone_bricks: 1, basalt: 1,
  cobblestone: 2, mossy_cobblestone: 2, cobbled_deepslate: 2, mossy_stone_bricks: 2, granite: 2, diorite: 2, blackstone: 2, gilded_blackstone: 2,
  dripstone: 2, netherrack: 2, end_stone: 2, prismarine: 2,
};

export function busynessOf(families: FamilyData, family: string, shape: string): Busyness {
  const kind = families.families[family]?.kind;
  if (kind === 'terracotta') return 0;
  if (kind === 'wood') return shape === 'planks' || shape === 'stairs' || shape === 'slab' ? 0 : 1;
  return BLOCK_BUSYNESS[family] ?? 1;
}

// ------------------------------------------------------------------ Schwesterblöcke (Familie → Block)

const TONE_SHAPES: ReadonlySet<string> = new Set(['block', 'planks', 'stairs', 'slab', 'wall', 'log', 'stripped_log', 'wood', 'stripped_wood']);
const TONE_KINDS: ReadonlySet<string> = new Set(['stone', 'wood', 'terracotta']);
const NOT_A_SIBLING = /^(mossy_|cracked_|chiseled|infested|waxed|cut_|smooth_red|crying_|gilded_|exposed_|weathered_|oxidized_)|(amethyst|obsidian|prismarine|purpur|end_stone|nether|resin|crimson|warped|cherry|bamboo|copper|sculk|reinforced|_ore$|^raw_)/;
/** Eigenwillige Töne (Purpurstich, Glanz; Tuff ist über den a*b*-Abstand zugelassen): nur Schwesterblock, wenn der Ausgangsblock selbst so einer ist. */
const ODD_TONE = /blackstone|basalt|quartz|smooth_/;

interface FamShape { readonly family: string; readonly shape: string }
type SisterSet = Readonly<Record<TextureTone, readonly string[]>>;

/** Klassengrenzen der Helligkeit (Verhältnis zur Ausgangsfamilie) und Farbrichtungs-Toleranz. */
const NEAR_RATIO: readonly [number, number] = [0.88, 1.14];
const DARK_RATIO: readonly [number, number] = [0.66, 0.89];
const LIGHT_RATIO: readonly [number, number] = [1.14, 1.4];
const NEAR_HUE = 0.05;
const ACCENT_HUE = 0.09;
const PER_CLASS = 3;
/** Größter Abstand in a*b* (CIE) zum Ausgangsblock: nah bzw. Akzent. */
const NEAR_AB = 6;
const ACCENT_AB = 9;

/** Familien-Sicht: Block → (Familie, Form) und Schwesterblöcke je Klasse. Rein, mit Zwischenspeicher. */
export class SisterIndex {
  private readonly byBlock = new Map<string, FamShape>();
  private readonly cache = new Map<string, SisterSet>();

  constructor(private readonly data: FamilyData, private readonly hasBlock: (name: string) => boolean) {
    for (const [id, f] of Object.entries(data.families)) {
      for (const [shape, b] of Object.entries(f.shapes)) {
        if (!TONE_SHAPES.has(shape)) continue;
        const key = stripNs(b);
        if (!this.byBlock.has(key)) this.byBlock.set(key, { family: id, shape });
      }
    }
  }

  lookup(name: string): FamShape | undefined {
    const fs = this.byBlock.get(stripNs(name));
    if (fs === undefined) return undefined;
    const f = this.data.families[fs.family];
    return f !== undefined && TONE_KINDS.has(f.kind) ? fs : undefined;
  }

  /** Helligkeit (0–255) der Familie; `undefined` ohne Farbdaten. */
  lightness(family: string): number | undefined {
    const c = rgb(this.data.families[family]?.color);
    return c === undefined ? undefined : lum(c);
  }

  /** CIE L* eines Blocks über seine Familie (`undefined` ohne Farbdaten). */
  lstar(name: string): number | undefined {
    const fs = this.byBlock.get(stripNs(name));
    return fs === undefined ? undefined : cieLab(this.data.families[fs.family]?.color)?.[0];
  }

  /** Unruhe eines Blocks (unbekannt = mittel). */
  busy(name: string): Busyness {
    const fs = this.byBlock.get(stripNs(name));
    return fs === undefined ? 1 : busynessOf(this.data, fs.family, fs.shape);
  }

  private block(family: string, shape: string): string | undefined {
    const f = Object.hasOwn(this.data.families, family) ? this.data.families[family] : undefined;
    const b = f?.shapes[shape];
    if (b === undefined) return undefined;
    const n = stripNs(b);
    return this.hasBlock(n) ? n : undefined;
  }

  /**
   * Schwesterblöcke derselben Art und Form in drei Helligkeitsklassen, je Klasse nach Nähe sortiert. B1: der nahe Ton
   * (Flächenfüller) ist nie unruhiger als der Ausgangsblock.
   */
  sisters(family: string, shape: string): SisterSet {
    const key = `${family}|${shape}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const out: Record<TextureTone, string[]> = { near: [], dark: [], light: [] };
    const own = this.data.families[family];
    const base = rgb(own?.color);
    const ownBusy = busynessOf(this.data, family, shape);
    if (own !== undefined && base !== undefined && !NOT_A_SIBLING.test(family)) {
      const scored: Record<TextureTone, { score: number; block: string }[]> = { near: [], dark: [], light: [] };
      const b0 = Math.max(1, lum(base));
      for (const [id, g] of Object.entries(this.data.families)) {
        if (id === family || g.kind !== own.kind || NOT_A_SIBLING.test(id)) continue;
        if (ODD_TONE.test(id) && !ODD_TONE.test(family)) continue;
        const c = rgb(g.color);
        if (c === undefined) continue;
        const ratio = lum(c) / b0;
        const hue = chromaDist(c, base);
        let tone: TextureTone | undefined;
        let ideal = 1;
        if (ratio >= NEAR_RATIO[0] && ratio <= NEAR_RATIO[1] && hue <= NEAR_HUE) tone = 'near';
        else if (ratio >= DARK_RATIO[0] && ratio < DARK_RATIO[1] && hue <= ACCENT_HUE) { tone = 'dark'; ideal = 0.8; }
        else if (ratio > LIGHT_RATIO[0] && ratio <= LIGHT_RATIO[1] && hue <= ACCENT_HUE) { tone = 'light'; ideal = 1.2; }
        if (tone === undefined) continue;
        // Buntheit in CIE a*b*: ein brauner Block ist kein dunkler Bruchstein, auch wenn das Verhältnis passt
        const labA = cieLab(g.color);
        const labB = cieLab(own.color);
        if (labA !== undefined && labB !== undefined && Math.hypot(labA[1] - labB[1], labA[2] - labB[2]) > (tone === 'near' ? NEAR_AB : ACCENT_AB)) continue;
        // B1: Füller nie unruhiger als der Ausgangsblock, Akzent höchstens eine Stufe unruhiger
        const busy = busynessOf(this.data, id, shape);
        if (busy > ownBusy + (tone === 'near' ? 0 : 1)) continue;
        const b = this.block(id, shape);
        if (b === undefined) continue;
        scored[tone].push({ score: Math.abs(Math.log(ratio / ideal)) + 4 * hue, block: b });
      }
      for (const t of ['near', 'dark', 'light'] as const) {
        scored[t].sort((l, r) => l.score - r.score || (l.block < r.block ? -1 : 1));
        out[t] = scored[t].slice(0, PER_CLASS).map((s) => s.block);
      }
    }
    this.cache.set(key, out);
    return out;
  }
}

// ------------------------------------------------------------------ Verlaufskette (WFC)

/** Kacheln der Verlaufskette: 0 Grundblock, 1 nah, 2 dunkel, 3 hell. */
const B = 0;
const N = 1;
const D = 2;
const L = 3;

/**
 * Kachelmodell der Verlaufskette (4er-Nachbarschaft): Grund–nah, nah–alles, dunkel–dunkel/nah, hell–hell/nah. Grundblock
 * und Akzent grenzen also nie direkt aneinander, dunkel und hell auch nicht: jede Fleckgrenze läuft über den nahen Ton
 * (3-Block-Verlauf, „Texture like a pro“). Immer lösbar (alles nah ist gültig).
 */
export const GRADIENT_MODEL: WfcModel = (() => {
  const allowed: readonly (readonly number[])[] = [[B, N], [B, N, D, L], [N, D], [N, L]];
  return {
    tiles: [{ id: 'base', weight: 6 }, { id: 'near', weight: 1.5 }, { id: 'dark', weight: 4 }, { id: 'light', weight: 4 }],
    dirs: 4,
    compat: [0, 1, 2, 3].map(() => allowed),
  };
})();

/**
 * Löst die Verlaufskette auf einem Raster w × h (`want` = Wunschklasse je Zelle, `active` = Maske). Nur Zellen an einem
 * verbotenen Übergang dürfen auf den nahen Ton ausweichen, alle anderen behalten ihren Wunsch – der Solver entscheidet,
 * auf welcher Seite der Grenze der Verlaufsschritt liegt. Ergebnis je Zelle 0–3; `ok` = false heißt Rückfall:
 * Akzentzellen an einem Grundblock oder am Gegenakzent werden nah (gleiches Verbot).
 */
export function solveGradient(w: number, h: number, active: Uint8Array, want: Uint8Array, seed: number): { readonly cls: Uint8Array; readonly ok: boolean } {
  const size = w * h;
  const cls = new Uint8Array(size);
  const grid = grid2d(w, h, (x, z) => active[z * w + x] === 1);
  const fixed = new Map<number, readonly number[]>();
  const conflict = (a: number, b: number): boolean => !GRADIENT_MODEL.compat[0]![a]!.includes(b);
  for (let i = 0; i < size; i++) {
    if (active[i] === 0) continue;
    const x = i % w;
    const nb = [x + 1 < w ? i + 1 : -1, x > 0 ? i - 1 : -1, i + w < size ? i + w : -1, i - w >= 0 ? i - w : -1];
    const edge = nb.some((j) => j >= 0 && active[j] === 1 && conflict(want[i]!, want[j]!));
    fixed.set(i, edge && want[i] !== N ? [want[i]!, N] : [want[i]!]);
  }
  const res = solveWfc(GRADIENT_MODEL, grid, { seed, fixed, maxBacktracks: 64, restarts: 2 });
  if (res.ok) {
    for (let i = 0; i < size; i++) if (active[i] === 1) cls[i] = res.tiles[i]!;
    return { cls, ok: true };
  }
  for (let i = 0; i < size; i++) cls[i] = want[i]!;
  const bad = (a: number, b: number): boolean => !GRADIENT_MODEL.compat[0]![a]!.includes(b);
  for (let i = 0; i < size; i++) {
    if (active[i] === 0 || (cls[i] !== D && cls[i] !== L)) continue;
    const x = i % w;
    const nb = [x + 1 < w ? i + 1 : -1, x > 0 ? i - 1 : -1, i + w < size ? i + w : -1, i - w >= 0 ? i - w : -1];
    if (nb.some((j) => j >= 0 && active[j] === 1 && bad(cls[i]!, cls[j]!))) cls[i] = N;
  }
  return { cls, ok: false };
}

// ------------------------------------------------------------------ Hilfen

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * B5 „Rauschen nur an Grenzen“: Zugehörigkeit zu einer Zone aus dem Abstand `d` zur Zonengrenze (positiv = innen) und
 * der Übergangstiefe `fade` (0 = scharfe Kante). Innen jenseits von `fade` sicher 1, außen sicher 0, dazwischen linear.
 */
export function boundaryBlend(d: number, fade: number): number {
  if (fade <= 0) return d > 0 ? 1 : 0;
  return clamp(0.5 + d / (2 * fade), 0, 1);
}

const PATCH_NOISE: NoiseParams = { type: 'cluster', scale: 3.4, octaves: 2, dither: 0.04 };
const TONE_NOISE: NoiseParams = { type: 'cluster', scale: 5, octaves: 1 };
const ROOF_NOISE: NoiseParams = { type: 'cluster', scale: 3, octaves: 2, dither: 0.04 };
const BAND_NOISE: NoiseParams = { type: 'cluster', scale: 6, octaves: 1 };
const PICK_NOISE: NoiseParams = { type: 'cluster', scale: 2.5, octaves: 1 };
const EDGE_NOISE: NoiseParams = { type: 'cluster', scale: 2, octaves: 1 };

const WALLISH: ReadonlySet<ShellKind> = new Set<ShellKind>(['wall', 'pillar', 'lintel', 'fort']);
/** Wandrichtungen (nach außen): +x, −x, +z, −z. */
const NORMALS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Rollen der Wandfläche und des Sockels, die gemischt werden (Balken, Rahmen, Gesims, Eckquader bleiben). */
const WALL_ROLE = /^(wall_(primary|secondary|plaster|gable|infill)|wall|silo|fort_base|mound_wall|foundation|wall_plinth)$/;
const SOCLE_ROLE = /^(foundation|wall_plinth|fort_base)$/;
/** Träger und Kanten: werden nicht gemischt, bekommen aber Highlights, wo sie vorstehen. */
const FRAME_ROLE = /^(beam|pillar|timber|wall_quoin|wall_cornice)$/;
const ROOF_ROLE = /^roof(_main|_barn|_tower)?$/;

/** Klassencode: 0 Grundblock, 1 nah, 2 dunkel, 3 hell. */
const TONE_OF: readonly (TextureTone | undefined)[] = [undefined, 'near', 'dark', 'light'];

/** Verschiebung einer Regel: Akzentanteil und Dunkel-Neigung (positiv = dunkler). */
interface Term { readonly rule: TextureRule; readonly accent: number; readonly dark: number }

/**
 * Klasse einer Zelle aus dem gleichverteilten Feld `u` (Klasse) und `v` (Ton). Der Akzent belegt das obere Ende von `u`,
 * `near` das Stück darunter – wächst der Akzent durch eine Regel, dehnen sich die vorhandenen Flecken aus.
 */
function decide(u: number, v: number, pNear: number, pAccent: number, darkBias: number): number {
  const accStart = 1 - clamp(pAccent, 0, 0.65);
  const nearStart = accStart - clamp(pNear, 0, 0.5);
  if (u >= accStart) return v < 0.5 + clamp(darkBias, -0.45, 0.45) ? 2 : 3;
  if (u >= nearStart) return 1;
  return 0;
}

/** Ersatzblock der Klasse; fehlt die Klasse, weicht er auf die verwandte aus (Akzent → nah). */
function pickBlock(sis: SisterSet, tone: TextureTone, current: string, pick: number): { readonly block: string; readonly tone: TextureTone } | undefined {
  const order: readonly TextureTone[] = tone === 'near' ? ['near'] : tone === 'dark' ? ['dark', 'near'] : ['light', 'near'];
  for (const t of order) {
    const list = sis[t].filter((b) => b !== current);
    if (list.length > 0) return { block: list[Math.floor(pick * list.length) % list.length]!, tone: t };
  }
  return undefined;
}

interface Plan { target: string; rule: TextureRule; tone: TextureTone }

interface WallCell {
  readonly pos: Vec3;
  readonly a: number;
  readonly y: number;
  readonly ground: number;
  readonly role: string;
  readonly ctx: CellContext | undefined;
  readonly name: string;
  readonly fs: FamShape;
}

/** Schlüssel einer Zelle in der Wandebene (a, y). */
const ak = (a: number, y: number): number => (a + 4096) * 8192 + (y + 2048);

/** Gleichblockige 4×3-Fenster (nicht überlappend, Zeilenweise) einer Ebene; `nameAt` liefert den (geplanten) Block. */
function countUniform(cells: ReadonlyMap<number, WallCell>, nameAt: (c: WallCell) => string): number {
  const used = new Set<number>();
  let n = 0;
  const list = [...cells.values()].sort((l, r) => l.y - r.y || l.a - r.a);
  for (const c of list) {
    const first = nameAt(c);
    let ok = true;
    for (let dy = 0; dy < 3 && ok; dy++) for (let da = 0; da < 4 && ok; da++) {
      const k = ak(c.a + da, c.y + dy);
      const o = cells.get(k);
      ok = o !== undefined && !used.has(k) && nameAt(o) === first;
    }
    if (!ok) continue;
    n++;
    for (let dy = 0; dy < 3; dy++) for (let da = 0; da < 4; da++) used.add(ak(c.a + da, c.y + dy));
  }
  return n;
}

function entropy(counts: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const v of counts.values()) total += v;
  if (total === 0) return 0;
  let h = 0;
  for (const v of counts.values()) h -= (v / total) * Math.log2(v / total);
  return h;
}

/** Sammler der B6-Kennzahlen über mehrere Ebenen. */
class MetricsAcc {
  private pairs = 0;
  private same = 0;
  private sameH = 0;
  private sameV = 0;
  private pairsH = 0;
  private pairsV = 0;
  private readonly dls: number[] = [];

  add(cells: ReadonlyMap<number, WallCell>, nameAt: (c: WallCell) => string, lstar: (name: string) => number | undefined): void {
    for (const c of cells.values()) {
      const n0 = nameAt(c);
      for (const [da, dy] of [[1, 0], [0, 1]] as const) {
        const o = cells.get(ak(c.a + da, c.y + dy));
        if (o === undefined) continue;
        const n1 = nameAt(o);
        const eq = n0 === n1 ? 1 : 0;
        this.pairs++;
        this.same += eq;
        if (da === 1) { this.pairsH++; this.sameH += eq; } else { this.pairsV++; this.sameV += eq; }
        const l0 = lstar(n0);
        const l1 = lstar(n1);
        this.dls.push(l0 !== undefined && l1 !== undefined ? Math.abs(l0 - l1) : 0);
      }
    }
  }

  result(): TextureMetrics {
    const r = (v: number): number => Math.round(v * 1000) / 1000;
    const sorted = [...this.dls].sort((a, b) => a - b);
    const mean = sorted.length > 0 ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
    return {
      pairs: this.pairs,
      sameShare: r(this.pairs > 0 ? this.same / this.pairs : 1),
      stripeIndex: r((this.pairsH > 0 ? this.sameH / this.pairsH : 1) - (this.pairsV > 0 ? this.sameV / this.pairsV : 1)),
      meanDeltaL: r(mean),
      p90DeltaL: r(sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]! : 0),
      jumpShare: r(sorted.length > 0 ? sorted.filter((v) => v > 20).length / sorted.length : 0),
    };
  }
}

const mostCommon = (counts: ReadonlyMap<string, number>): string | undefined =>
  [...counts.entries()].sort((l, r) => r[1] - l[1] || (l[0] < r[0] ? -1 : 1))[0]?.[0];

// ------------------------------------------------------------------ Hauptpass

export function applySurfaceTexture(input: SurfaceTextureInput): SurfaceTextureStats {
  const { volume, shell, contexts, roleAt, seed, level } = input;
  const k = Math.max(0, input.strength);
  const roofDir = input.roofGradient ?? 'eave_dark';
  const sis = new SisterIndex(input.families, input.hasBlock);
  const lstar = (n: string): number | undefined => sis.lstar(n);

  const byRule = Object.fromEntries(TEXTURE_RULES.map((r) => [r, 0])) as Record<TextureRule, number>;
  const byTone: Record<TextureTone, number> = { near: 0, dark: 0, light: 0 };
  const stats = {
    wallCells: 0, roofCells: 0, changed: 0, uniformWindowsBefore: 0, uniformWindowsAfter: 0, entropyBefore: 0, entropyAfter: 0,
    busyReplaced: 0, gradientPlanes: 0, gradientFallbacks: 0,
  };
  let wallChanged = 0;
  let wallIsolated = 0;
  const mBefore = new MetricsAcc();
  const mAfter = new MetricsAcc();
  let contrast: WallRoofContrast | undefined;
  const done = (): SurfaceTextureStats => ({
    level, strength: k, ...stats, byRule, byTone, isolatedShare: wallChanged > 0 ? wallIsolated / wallChanged : 0,
    changedShare: stats.wallCells + stats.roofCells > 0 ? stats.changed / (stats.wallCells + stats.roofCells) : 0,
    metricsBefore: mBefore.result(), metricsAfter: mAfter.result(),
    ...(contrast !== undefined ? { contrast } : {}),
  });
  if (k <= 0) return done();

  const [ox, oy, oz] = volume.origin;
  const [sx, sy, sz] = volume.size;
  const idx = (x: number, y: number, z: number): number => ((x - ox) * sy + (y - oy)) * sz + (z - oz);
  const inside = (x: number, y: number, z: number): boolean => x >= ox && y >= oy && z >= oz && x < ox + sx && y < oy + sy && z < oz + sz;

  const kindAt = new Map<string, ShellKind>();
  const ctxAt = new Map<string, CellContext>();
  shell.cells.forEach((c, i) => {
    const key = key3(c.pos);
    kindAt.set(key, c.kind);
    const cx = contexts[i];
    if (cx !== undefined) ctxAt.set(key, cx);
  });
  const solid = new Uint8Array(sx * sy * sz);
  for (let x = ox; x < ox + sx; x++) for (let y = oy; y < oy + sy; y++) for (let z = oz; z < oz + sz; z++) {
    if (!isAir(volume.stateAt([x, y, z]))) solid[idx(x, y, z)] = 1;
  }
  const isSolid = (x: number, y: number, z: number): boolean => inside(x, y, z) && solid[idx(x, y, z)] === 1;

  // Außenluft: vom Rand des Volumens erreichbar (Höfe außen, Räume innen)
  const outdoor = new Uint8Array(sx * sy * sz);
  const stack: number[] = [];
  const push = (x: number, y: number, z: number): void => {
    if (!inside(x, y, z)) return;
    const i = idx(x, y, z);
    if (solid[i] === 1 || outdoor[i] === 1) return;
    outdoor[i] = 1;
    stack.push(i);
  };
  for (let x = ox; x < ox + sx; x++) for (let y = oy; y < oy + sy; y++) for (let z = oz; z < oz + sz; z++) {
    if (x === ox || x === ox + sx - 1 || y === oy + sy - 1 || z === oz || z === oz + sz - 1) push(x, y, z);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const z = oz + (i % sz);
    const y = oy + (Math.floor(i / sz) % sy);
    const x = ox + Math.floor(i / (sz * sy));
    push(x + 1, y, z); push(x - 1, y, z); push(x, y + 1, z); push(x, y - 1, z); push(x, y, z + 1); push(x, y, z - 1);
  }
  const isOut = (x: number, y: number, z: number): boolean => !inside(x, y, z) || outdoor[idx(x, y, z)] === 1;

  // ---------------------------------------------------------------- Wandzellen je Ebene einsammeln
  interface Plane {
    readonly di: number;
    readonly p: number;
    readonly cells: Map<number, WallCell>;
    /** Träger/Kanten (Balken, Pfeiler, Eckquader, Gesims) der Ebene – nur für Highlights. */
    readonly frame: Map<number, WallCell>;
    /** Alle sichtbaren Wandzellen jeder Rolle (auch nicht gemischte) – für Kantenerkennung. */
    readonly any: Set<number>;
    readonly openings: Set<number>;
  }
  const planes = new Map<string, Plane>();
  const planeOf = (di: number, p: number): Plane => {
    const key = `${di}|${p}`;
    let e = planes.get(key);
    if (e === undefined) { e = { di, p, cells: new Map(), frame: new Map(), any: new Set(), openings: new Set() }; planes.set(key, e); }
    return e;
  };
  const claimed = new Set<string>();
  const roofTops: { pos: Vec3; ctx: CellContext | undefined; role: string; name: string; fs: FamShape }[] = [];
  for (let x = ox; x < ox + sx; x++) for (let y = oy; y < oy + sy; y++) for (let z = oz; z < oz + sz; z++) {
    if (solid[idx(x, y, z)] === 0) continue;
    const pos: Vec3 = [x, y, z];
    const key = key3(pos);
    const kind = kindAt.get(key);
    if (kind === undefined) continue;
    if (kind === 'roof') {
      const role = roleAt.get(key) ?? '';
      if (!ROOF_ROLE.test(role) || !isOut(x, y + 1, z)) continue;
      const name = stripNs(volume.stateAt(pos).name);
      const fs = sis.lookup(name);
      if (fs !== undefined) roofTops.push({ pos, ctx: ctxAt.get(key), role, name, fs });
      continue;
    }
    const isOpening = kind === 'window' || kind === 'door';
    if (!WALLISH.has(kind) && !isOpening) continue;
    for (let di = 0; di < NORMALS.length; di++) {
      const [nx, nz] = NORMALS[di]!;
      if (!isOut(x + nx, y, z + nz)) continue;
      const alongX = nx === 0;
      const p = alongX ? z : x;
      const a = alongX ? x : z;
      const pl = planeOf(di, p);
      if (isOpening) { pl.openings.add(ak(a, y)); continue; }
      pl.any.add(ak(a, y));
      if (claimed.has(key)) continue;
      const role = roleAt.get(key) ?? '';
      const isWall = WALL_ROLE.test(role);
      if (!isWall && !FRAME_ROLE.test(role)) continue;
      const name = stripNs(volume.stateAt(pos).name);
      const fs = sis.lookup(name);
      if (fs === undefined) continue;
      // Bodenabstand vor der Wand (Luftzellen bis zum Vorgelände, max. 3; Volumenrand zählt als Boden)
      let ground = 0;
      for (; ground < 3; ground++) {
        const gy = y - ground - 1;
        if (!inside(x + nx, gy, z + nz) || isSolid(x + nx, gy, z + nz)) break;
        if (!isOut(x + nx, gy, z + nz)) { ground = 9; break; }
      }
      claimed.add(key);
      (isWall ? pl.cells : pl.frame).set(ak(a, y), { pos, a, y, ground, role, ctx: ctxAt.get(key), name, fs });
    }
  }

  const pKind = clamp(k, 0.15, 1.3);
  const pNear = 0.25 * pKind;
  const pAccent = 0.15 * pKind;
  const planned = new Map<string, Plan>();
  const setPlan = (cell: { pos: Vec3; name: string }, pick: { readonly block: string; readonly tone: TextureTone } | undefined, rule: TextureRule): boolean => {
    if (pick === undefined || pick.block === cell.name) return false;
    planned.set(key3(cell.pos), { target: pick.block, rule, tone: pick.tone });
    return true;
  };
  const pickAt = (pos: Vec3, salt: string): number => hash01(hashSeed(seed, 'txp', salt, pos[0], pos[1], pos[2]), pos[0] + pos[2], pos[1]);
  // Sockel (B5): Zone = unterste Reihen über dem Vorgelände, Rauschen nur im Übergang
  const socleRows = level === 'rich' ? 2 : 1;
  const socleFade = level === 'rich' ? 1 : 0.6;

  const nameAtWall = (c: WallCell): string => planned.get(key3(c.pos))?.target ?? c.name;
  const baseEntropy = new Map<string, number>();
  const finalEntropy = new Map<string, number>();
  const sortedPlanes = [...planes.values()].sort((l, r) => l.di - r.di || l.p - r.p);

  for (const pl of sortedPlanes) {
    if (pl.cells.size === 0 && pl.frame.size === 0) continue;
    const [nx, nz] = NORMALS[pl.di]!;
    const fseed = hashSeed(seed, 'tx', pl.di, pl.p);
    const cells = [...pl.cells.values()].sort((l, r) => l.y - r.y || l.a - r.a);
    stats.wallCells += cells.length;
    stats.uniformWindowsBefore += countUniform(pl.cells, (c) => c.name);
    mBefore.add(pl.cells, (c) => c.name, lstar);
    for (const c of cells) baseEntropy.set(c.name, (baseEntropy.get(c.name) ?? 0) + 1);

    // ---- 1. Wunschklasse: Flecken, Rücksprung, Sockel, Geschossgrenze
    if (cells.length > 0) {
      let aMin = Infinity; let aMax = -Infinity; let yMin = Infinity; let yMax = -Infinity;
      for (const c of cells) { aMin = Math.min(aMin, c.a); aMax = Math.max(aMax, c.a); yMin = Math.min(yMin, c.y); yMax = Math.max(yMax, c.y); }
      const w = aMax - aMin + 1;
      const h = yMax - yMin + 1;
      const at = (c: WallCell): number => (c.y - yMin) * w + (c.a - aMin);
      const active = new Uint8Array(w * h);
      const want = new Uint8Array(w * h);
      const cause = new Map<number, TextureRule>();
      for (const c of cells) {
        const [x, y, z] = c.pos;
        const i = at(c);
        active[i] = 1;
        const u = clusterU(hashSeed(fseed, 'u'), c.a, c.y, PATCH_NOISE);
        const v = clusterU(hashSeed(fseed, 'v'), c.a, c.y, TONE_NOISE);
        const terms: Term[] = [];
        const rel = wallRelief(isSolid, isOut, c.pos, nx, nz);
        // Füllfeld zwischen vorstehenden Trägern: dunkler, je tiefer (Short: „inside darker than the exposed part“)
        if (rel.recess > 0) terms.push({ rule: 'recess', accent: 0.18 * pKind * Math.min(2, rel.recess), dark: 0.45 });
        const above = kindAt.get(key3([x, y + 1, z]));
        const underEave = above === 'roof' || above === 'ceiling' || above === 'facade' || isSolid(x + nx, y + 1, z + nz);
        if (underEave || (c.ctx !== undefined && c.ctx.hRel === c.ctx.H - 1 && c.ctx.H > 2)) terms.push({ rule: 'band', accent: 0.16 * pKind, dark: 0.35 });
        const sumA = terms.reduce((s, t) => s + t.accent, 0);
        const sumD = terms.reduce((s, t) => s + t.dark * (t.accent > 0 ? 1 : 0), 0);
        const cls0 = decide(u, v, pNear, pAccent, 0);
        let cls1 = decide(u, v, pNear, pAccent + sumA, clamp(sumD, 0, 0.45));
        let rule: TextureRule = 'patch';
        if (cls1 !== cls0 && terms.length > 0) rule = terms.reduce((b, t) => (t.accent > b.accent ? t : b)).rule;
        // Sockelzone: sicher dunkel innen, Rauschen nur an der Oberkante (B5)
        if (c.ground <= 2) {
          const pIn = boundaryBlend(socleRows - 0.5 - c.ground, socleFade) * clamp(0.55 + 0.45 * k, 0.5, 1);
          if (clusterU(hashSeed(fseed, 'socle'), c.a, c.y, EDGE_NOISE) < pIn && cls1 !== D) { cls1 = D; rule = 'socle'; }
        } else if (SOCLE_ROLE.test(c.role) && cls1 === B && u > 0.7) { cls1 = N; rule = 'socle'; }
        want[i] = cls1;
        cause.set(i, rule);
      }
      // ---- 2. Verlaufskette (WFC): keine Sprünge Grund↔Akzent, dunkel↔hell
      const sol = solveGradient(w, h, active, want, hashSeed(fseed, 'grad'));
      stats.gradientPlanes++;
      if (!sol.ok) stats.gradientFallbacks++;
      for (const c of cells) {
        const i = at(c);
        const cls = sol.cls[i]!;
        if (cls === B) continue;
        const rule: TextureRule = cls === N && want[i] !== N ? 'gradient' : cause.get(i)!;
        const pick = clusterU(hashSeed(fseed, 'pick', cls), c.a, c.y, PICK_NOISE);
        setPlan(c, pickBlock(sis.sisters(c.fs.family, c.fs.shape), TONE_OF[cls]!, c.name, pick), rule);
      }
    }

    // ---- 3. Kanten: Eckquader, Laibungen, Highlights auf vorstehenden Trägern/Kanten
    const contrastPick = (c: WallCell, salt: string): { readonly block: string; readonly tone: TextureTone } | undefined => {
      const s = sis.sisters(c.fs.family, c.fs.shape);
      const preferLight = (sis.lightness(c.fs.family) ?? 128) < 170;
      const tone: TextureTone = (preferLight ? s.light.length > 0 : s.dark.length === 0) ? 'light' : 'dark';
      return pickBlock(s, tone, c.name, pickAt(c.pos, salt));
    };
    const pCorner = clamp(0.25 + 0.6 * k, 0.4, 0.95);
    const pReveal = clamp(0.35 + 0.4 * k, 0.3, 0.9);
    const pHigh = clamp(0.1 + 0.35 * k, 0.15, 0.55);
    const missing = (kk: number): boolean => !pl.any.has(kk) && !pl.openings.has(kk);
    for (const c of cells) {
      const kindF = input.families.families[c.fs.family]?.kind;
      const isStone = kindF === 'stone' || kindF === 'terracotta';
      const left = ak(c.a - 1, c.y);
      const right = ak(c.a + 1, c.y);
      if (isStone && (missing(left) || missing(right)) && (c.y & 1) === 0 && hash01(hashSeed(seed, 'txc', c.pos[0], c.pos[1], c.pos[2]), c.a, c.y) < pCorner) {
        if (setPlan(c, contrastPick(c, 'corner'), 'corner')) continue;
      }
      // Laibung: Zelle neben/unter/über einer Öffnung
      const sill = pl.openings.has(ak(c.a, c.y + 1));
      const jamb = pl.openings.has(left) || pl.openings.has(right);
      if ((sill || jamb) && hash01(hashSeed(seed, 'txr', c.pos[0], c.pos[1], c.pos[2]), c.a, c.y) < (sill ? pReveal : pReveal * 0.6)) {
        if (setPlan(c, contrastPick(c, 'reveal'), 'reveal')) continue;
      }
      // vorstehende Wandteile (zwei freie Kanten und mehr): heller
      const rel = wallRelief(isSolid, isOut, c.pos, nx, nz);
      if (rel.convex >= 2 && clusterU(hashSeed(fseed, 'hi'), c.a, c.y, EDGE_NOISE) < pHigh) {
        setPlan(c, pickBlock(sis.sisters(c.fs.family, c.fs.shape), 'light', c.name, pickAt(c.pos, 'hi')), 'highlight');
      }
    }
    // Träger: Highlights in kurzen Läufen, wo der Träger eine freie Kante hat (Short: „highlights to the outer support“)
    for (const c of [...pl.frame.values()].sort((l, r) => l.y - r.y || l.a - r.a)) {
      const rel = wallRelief(isSolid, isOut, c.pos, nx, nz);
      if (rel.convex < 1 || (sis.lightness(c.fs.family) ?? 128) > 200) continue;
      if (clusterU(hashSeed(fseed, 'frame'), c.a, c.y, EDGE_NOISE) >= pHigh) continue;
      setPlan(c, pickBlock(sis.sisters(c.fs.family, c.fs.shape), 'light', c.name, pickAt(c.pos, 'frame')), 'highlight');
    }

    // ---- B1 Rauschbudget: höchstens eine unruhige Sorte je Fleck (zusammenhängende getauschte Zellen)
    const seen = new Set<number>();
    for (const c of cells) {
      const k0 = ak(c.a, c.y);
      if (seen.has(k0) || !planned.has(key3(c.pos))) continue;
      const comp: WallCell[] = [];
      const q = [c];
      seen.add(k0);
      while (q.length > 0) {
        const cur = q.pop()!;
        comp.push(cur);
        for (const [da, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const kk = ak(cur.a + da, cur.y + dy);
          const o = pl.cells.get(kk);
          if (o === undefined || seen.has(kk) || !planned.has(key3(o.pos))) continue;
          seen.add(kk);
          q.push(o);
        }
      }
      comp.sort((l, r) => l.y - r.y || l.a - r.a);
      let keep: string | undefined;
      for (const m of comp) {
        const plan = planned.get(key3(m.pos))!;
        if (sis.busy(plan.target) < 2 || sis.busy(plan.target) <= sis.busy(m.name)) continue;
        if (keep === undefined) { keep = plan.target; continue; }
        if (plan.target === keep) continue;
        const s = sis.sisters(m.fs.family, m.fs.shape);
        const calm = [...s[plan.tone], ...s.near].find((b) => b !== m.name && sis.busy(b) < 2);
        if (calm !== undefined) planned.set(key3(m.pos), { ...plan, target: calm });
        else planned.delete(key3(m.pos));
        stats.busyReplaced++;
      }
    }

    // ---- 4. Musterbruch: gleichblockiges 4×3-Fenster bekommt einen Streublock
    const used = new Set<number>();
    for (const c of cells) {
      const first = nameAtWall(c);
      let ok = true;
      for (let dy = 0; dy < 3 && ok; dy++) for (let da = 0; da < 4 && ok; da++) {
        const kk = ak(c.a + da, c.y + dy);
        const o = pl.cells.get(kk);
        ok = o !== undefined && !used.has(kk) && !planned.has(key3(o.pos)) && o.name === first;
      }
      if (!ok) continue;
      for (let dy = 0; dy < 3; dy++) for (let da = 0; da < 4; da++) used.add(ak(c.a + da, c.y + dy));
      const slot = Math.floor(hash01(hashSeed(seed, 'txs', pl.di, pl.p, c.a, c.y), c.a, c.y) * 12);
      const victim = pl.cells.get(ak(c.a + (slot % 4), c.y + Math.floor(slot / 4)))!;
      // nur der nahe Ton: ein Streublock bleibt in der Verlaufskette neben dem Grundblock
      setPlan(victim, pickBlock(sis.sisters(victim.fs.family, victim.fs.shape), 'near', victim.name, pickAt(victim.pos, 'scatter')), 'scatter');
    }

    stats.uniformWindowsAfter += countUniform(pl.cells, nameAtWall);
    mAfter.add(pl.cells, nameAtWall, lstar);
    for (const c of cells) {
      if (!planned.has(key3(c.pos))) continue;
      wallChanged++;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([da, dy]) => {
        const n = pl.cells.get(ak(c.a + da!, c.y + dy!));
        return n !== undefined && planned.has(key3(n.pos));
      });
      if (!near) wallIsolated++;
    }
    for (const c of cells) finalEntropy.set(nameAtWall(c), (finalEntropy.get(nameAtWall(c)) ?? 0) + 1);
  }
  stats.entropyBefore = entropy(baseEntropy);
  stats.entropyAfter = entropy(finalEntropy);

  // ---------------------------------------------------------------- Dachhaut
  const rseed = hashSeed(seed, 'tx', 'roof');
  const roofRows = new Map<number, number>();
  // Höhenkarte der obersten Dachzellen je (x, z) für Neigung (B2) und das Verlaufsraster
  const topAt = new Map<string, number>();
  for (const r of roofTops) {
    const kk = `${r.pos[0]},${r.pos[2]}`;
    if ((topAt.get(kk) ?? -Infinity) < r.pos[1]) topAt.set(kk, r.pos[1]);
  }
  const slopeAt = (x: number, z: number): number | undefined => {
    const h = (dx: number, dz: number): number | undefined => topAt.get(`${x + dx},${z + dz}`);
    const sxv = h(1, 0) !== undefined && h(-1, 0) !== undefined ? Math.abs(h(1, 0)! - h(-1, 0)!) / 2 : undefined;
    const szv = h(0, 1) !== undefined && h(0, -1) !== undefined ? Math.abs(h(0, 1)! - h(0, -1)!) / 2 : undefined;
    if (sxv === undefined && szv === undefined) return undefined;
    return Math.max(sxv ?? 0, szv ?? 0);
  };
  const tops = roofTops.filter((r) => topAt.get(`${r.pos[0]},${r.pos[2]}`) === r.pos[1]);
  if (tops.length > 0) {
    let xMin = Infinity; let xMax = -Infinity; let zMin = Infinity; let zMax = -Infinity;
    for (const r of tops) { xMin = Math.min(xMin, r.pos[0]); xMax = Math.max(xMax, r.pos[0]); zMin = Math.min(zMin, r.pos[2]); zMax = Math.max(zMax, r.pos[2]); }
    const w = xMax - xMin + 1;
    const h = zMax - zMin + 1;
    const at = (p: Vec3): number => (p[2] - zMin) * w + (p[0] - xMin);
    const active = new Uint8Array(w * h);
    const want = new Uint8Array(w * h);
    const cause = new Map<number, TextureRule>();
    for (const r of tops) {
      const [x, y, z] = r.pos;
      stats.roofCells++;
      const u = clusterU(hashSeed(rseed, 'u'), x, z, ROOF_NOISE);
      const v = clusterU(hashSeed(rseed, 'v'), x, z, TONE_NOISE);
      const t = r.ctx?.t.roof_t ?? 0.5;
      const terms: Term[] = [];
      // Verlauf Traufe → First: Traufe dunkel (Feuchte), First hell (Sonne); `ridge_dark` kehrt es um
      const sgn = roofDir === 'eave_dark' ? 1 : -1;
      if (t < 0.3) terms.push({ rule: 'roof_gradient', accent: 0.26 * pKind * (1 - t / 0.3), dark: 0.45 * sgn });
      else if (t > 0.75) terms.push({ rule: 'roof_gradient', accent: 0.16 * pKind * ((t - 0.75) / 0.25), dark: -0.45 * sgn });
      // B2 Neigung: flache Stellen (Wasser steht) dunkler
      const slope = slopeAt(x, z);
      if (slope === 0 && t >= 0.05 && t <= 0.75) terms.push({ rule: 'roof_slope', accent: 0.14 * pKind, dark: 0.4 });
      // Streifen: einzelne Reihen (y) werden lang gezogen
      let rowBand = roofRows.get(y);
      if (rowBand === undefined) { rowBand = hash01(hashSeed(rseed, 'row'), y, 7) < 0.2 * pKind ? 1 : 0; roofRows.set(y, rowBand); }
      if (rowBand === 1) {
        const bw = clusterU(hashSeed(rseed, 'band'), x + z, y, BAND_NOISE);
        if (bw < 0.7) terms.push({ rule: 'roof_stripe', accent: 0.45, dark: 0.1 });
      }
      const sumA = terms.reduce((s, tt) => s + tt.accent, 0);
      const sumD = terms.reduce((s, tt) => s + tt.dark, 0);
      const pn = 0.2 * pKind;
      const pa = 0.1 * pKind;
      const cls0 = decide(u, v, pn, pa, 0.1);
      const cls1 = decide(u, v, pn, pa + sumA, 0.1 + sumD);
      const i = at(r.pos);
      active[i] = 1;
      want[i] = cls1;
      cause.set(i, cls1 !== cls0 && terms.length > 0 ? terms.reduce((b, tt) => (tt.accent > b.accent ? tt : b)).rule : 'roof_patch');
    }
    const sol = solveGradient(w, h, active, want, hashSeed(rseed, 'grad'));
    stats.gradientPlanes++;
    if (!sol.ok) stats.gradientFallbacks++;
    for (const r of tops) {
      const i = at(r.pos);
      const cls = sol.cls[i]!;
      if (cls === B) continue;
      const rule: TextureRule = cls === N && want[i] !== N ? 'gradient' : cause.get(i)!;
      const pick = clusterU(hashSeed(rseed, 'pick', cls), r.pos[0], r.pos[2], PICK_NOISE);
      setPlan(r, pickBlock(sis.sisters(r.fs.family, r.fs.shape), TONE_OF[cls]!, r.name, pick), rule);
    }
  }

  // ---------------------------------------------------------------- B3: Kontrast Hauptwand/Hauptdach (nur Warnung)
  const roofCounts = new Map<string, number>();
  for (const r of roofTops) roofCounts.set(r.name, (roofCounts.get(r.name) ?? 0) + 1);
  const wallMain = mostCommon(baseEntropy);
  const roofMain = mostCommon(roofCounts);
  if (wallMain !== undefined && roofMain !== undefined) contrast = wallRoofContrast(input.families, wallMain, roofMain);

  // ---------------------------------------------------------------- Blöcke setzen (Reihenfolge = key3-sortiert, damit stabil)
  for (const key of [...planned.keys()].sort()) {
    const plan = planned.get(key)!;
    const pos = key.split(',').map(Number) as unknown as Vec3;
    const state = volume.stateAt(pos);
    const next = input.resolveState?.(plan.target, state.properties);
    volume.replaceState(pos, next !== undefined ? blockState(next.name, next.properties) : blockState(plan.target, state.properties));
    stats.changed++;
    byRule[plan.rule]++;
    byTone[plan.tone]++;
  }
  return done();
}
