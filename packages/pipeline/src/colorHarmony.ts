/**
 * Farbharmonie (Welle WS, Schritt 3 „Farben“ des Bauprozess-Tutorials, plan/spikes/LV_yt_bauprozess_7schritte.md):
 * Schalter `colorHarmony` (`PaletteOverrides.colorHarmony`, Standard aus = bitgleich).
 *
 * Die Regeln des Tutorials werden als Rollen-/Gewichtslogik auf das **aufgelöste Theme** angewendet (Theme → Palette →
 * Überschreibungen → Harmonie), ohne WFC und ohne neue Bausteine im Materialisierer:
 *
 *  1. **Kontrast** – Helligkeitsabstand (OKLab-L) zwischen den Bauteil-Gruppen Sockel ↔ Wand, Wand ↔ Dach,
 *     Zierholz ↔ Wand und Dachkante ↔ Dach. Wird ein Mindestabstand unterschritten, rückt die **nachgiebige** Gruppe
 *     (Reihenfolge: Wand bleibt, dann Dach, Sockel, Zierholz, Dachkante) auf die Seite mit Abstand. Jeder Eintrag
 *     der Rolle wandert einzeln zur nächsten passenden Familie (Gewichte, Verläufe, Rauschen bleiben – der Verlauf
 *     „läuft aus“ weiter, nur die Töne liegen woanders). Verletzt nichts die Regel, bleibt das Theme **dasselbe Objekt**.
 *  2. **Sättigung passend zum Stil** – `saturation`: muted (realistisch) | natural | vivid (Fantasy). Sie begrenzt bzw.
 *     bevorzugt die Buntheit der Ersatzfamilien; `auto` wählt nach Theme (Fantasy-Themes vivid, sonst muted).
 *  3. **Hauptfarbe ~80 % / Akzent ~20 %, nie 50/50** – geprüft am Flächenanteil der Farbklassen ({@link harmonyReport});
 *     Korrektur: ist das Verhältnis „fast gleich“ (Hauptklasse < 60 %), wird das Zierholz (kleinste Fläche) in die
 *     Hauptklasse gezogen, sofern der Kontrast (1) erhalten bleibt.
 *  4. **Verlauf je Bauteil** – Sockel/Dach mit nur einem Ton bekommen einen zweiten (dunkler zum Fuß bzw. zur Traufe),
 *     damit jedes Bauteil eine kleine Blockfolge trägt, die ausläuft.
 *
 * Rein und deterministisch: keine Zufallsquelle, kein I/O. Ergebnis je (Theme-Objekt, Einstellung) zwischengespeichert.
 */
import {
  FAMILY_SHAPES, PALETTE_GROUP_DEFS, familyFitsRole, familyKind,
  type ResolvedTheme, type ThemeGradientStop, type ThemeMixEntry, type ThemeRoleSpec,
} from '@mcda/catalog';
import type { PaletteOverrides } from '@mcda/core';
import { blockChroma, colorClassOf } from './colorMetrics.js';

/** Wirkungsstärke des Kontrast-Mindestabstands. */
export type HarmonyContrast = 'soft' | 'normal' | 'strong';
/** Sättigung: `auto` = nach Theme (Fantasy vivid, sonst muted). */
export type HarmonySaturation = 'auto' | 'muted' | 'natural' | 'vivid';

export interface HarmonyTuning {
  readonly contrast?: HarmonyContrast;
  readonly saturation?: HarmonySaturation;
}

/** Themes mit Fantasy-Charakter (hohe Sättigung erlaubt); alle anderen gelten als realistisch. */
export const FANTASY_THEMES: readonly string[] = ['elven', 'steampunk', 'tropical', 'asian', 'dwarven'];

/** Mindestabstände (OKLab-L) bei `normal`; `soft` ×0,7, `strong` ×1,4. */
export const HARMONY_GAPS = { baseWall: 0.1, wallRoof: 0.16, frameWall: 0.16, edgeRoof: 0.1 } as const;
const CONTRAST_SCALE: Readonly<Record<HarmonyContrast, number>> = { soft: 0.7, normal: 1, strong: 1.4 };
/** Höchste Buntheit (OKLab-Chroma) einer Ersatzfamilie. */
const CHROMA_CAP: Readonly<Record<Exclude<HarmonySaturation, 'auto'>, number>> = { muted: 0.075, natural: 0.11, vivid: 0.2 };

/** Bauteil-Gruppen der Harmonie und ihre Theme-Rollen. */
export const HARMONY_PARTS = {
  base: ['foundation', 'wall_plinth'],
  wall: ['wall_primary'],
  roof: ['roof_main'],
  frame: ['beam', 'pillar', 'window_frame', 'shutter', 'wall_cornice', 'wall_quoin'],
  edge: ['roof_trim'],
} as const;
export type HarmonyPart = keyof typeof HARMONY_PARTS;

// ---------------------------------------------------------------- Farbe eines Eintrags

interface Look { readonly L: number; readonly C: number }
const lookCache = new Map<string, Look>();

/** Messblock einer Familie (Holz: Bretter, sonst der Block selbst). */
function familyBlock(family: string, variant?: string): string {
  if (family.startsWith('color:')) return `minecraft:${family.slice(6)}_wool`;
  const wood = familyKind(family) === 'wood';
  if (variant !== undefined && /^(stripped_)?(log|wood)$/.test(variant)) return `minecraft:${/^stripped/.test(variant) ? 'stripped_' : ''}${family}_${variant.replace(/^stripped_/, '')}`;
  if (variant !== undefined) return `minecraft:${variant}_${family}`;
  return wood ? `minecraft:${family}_planks` : `minecraft:${family}`;
}

function lookOf(block: string): Look {
  let l = lookCache.get(block);
  if (l === undefined) {
    const { L, C } = blockChroma(block);
    l = { L, C };
    lookCache.set(block, l);
  }
  return l;
}

function entryBlock(e: ThemeMixEntry): string {
  if (e.block !== undefined) return e.block;
  if (e.color !== undefined) return `minecraft:${e.color}_wool`;
  return familyBlock(e.family!, e.variant);
}

/** Alle Einträge einer Rolle (Familie/Farbe, Mischung, Verlaufsstopps) als Liste mit Gewicht. */
function entriesOf(spec: ThemeRoleSpec): { block: string; weight: number }[] {
  const out: { block: string; weight: number }[] = [];
  if (spec.family !== undefined) out.push({ block: familyBlock(spec.family), weight: 1 });
  else if (spec.color !== undefined) out.push({ block: `minecraft:${spec.color}_wool`, weight: 1 });
  for (const e of spec.mix ?? []) out.push({ block: entryBlock(e), weight: e.weight });
  const stops = spec.gradient?.stops ?? [];
  for (const st of stops) {
    const total = st.mix.reduce((s, e) => s + e.weight, 0) || 1;
    for (const e of st.mix) out.push({ block: entryBlock(e), weight: (e.weight / total) / stops.length });
  }
  return out;
}

function roleLightness(spec: ThemeRoleSpec | undefined): number | undefined {
  if (spec === undefined) return undefined;
  const es = entriesOf(spec);
  const total = es.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return undefined;
  return es.reduce((s, e) => s + lookOf(e.block).L * e.weight, 0) / total;
}

/** Mittlere Helligkeit einer Gruppe (Rollen gleich gewichtet); `undefined`, wenn das Theme keine der Rollen kennt. */
export function partLightness(theme: Pick<ResolvedTheme, 'roles'>, part: HarmonyPart): number | undefined {
  const ls = HARMONY_PARTS[part].map((r) => roleLightness(theme.roles[r])).filter((x): x is number => x !== undefined);
  return ls.length === 0 ? undefined : ls.reduce((a, b) => a + b, 0) / ls.length;
}

// ---------------------------------------------------------------- Bericht

export interface HarmonyReport {
  /** Helligkeit je Gruppe (OKLab-L). */
  readonly lightness: Readonly<Partial<Record<HarmonyPart, number>>>;
  /** Abstände und geforderte Mindestabstände. */
  readonly gaps: readonly { readonly pair: 'baseWall' | 'wallRoof' | 'frameWall' | 'edgeRoof'; readonly gap: number; readonly min: number; readonly ok: boolean }[];
  readonly ok: boolean;
}

const PAIRS: readonly { pair: 'baseWall' | 'wallRoof' | 'frameWall' | 'edgeRoof'; a: HarmonyPart; b: HarmonyPart }[] = [
  { pair: 'baseWall', a: 'base', b: 'wall' },
  { pair: 'wallRoof', a: 'wall', b: 'roof' },
  { pair: 'frameWall', a: 'frame', b: 'wall' },
  { pair: 'edgeRoof', a: 'edge', b: 'roof' },
];

/** Prüfbericht des Kontrasts eines Themes (ohne es zu ändern). */
export function harmonyReport(theme: Pick<ResolvedTheme, 'roles'>, contrast: HarmonyContrast = 'normal'): HarmonyReport {
  const lightness: Partial<Record<HarmonyPart, number>> = {};
  for (const p of Object.keys(HARMONY_PARTS) as HarmonyPart[]) {
    const l = partLightness(theme, p);
    if (l !== undefined) lightness[p] = l;
  }
  const gaps = PAIRS.flatMap(({ pair, a, b }) => {
    const x = lightness[a];
    const y = lightness[b];
    if (x === undefined || y === undefined) return [];
    const min = HARMONY_GAPS[pair] * CONTRAST_SCALE[contrast];
    const gap = Math.abs(x - y);
    return [{ pair, gap, min, ok: gap >= min - 1e-9 }];
  });
  return { lightness, gaps, ok: gaps.every((g) => g.ok) };
}

// ---------------------------------------------------------------- Umsetzung

const GROUP_OF: Readonly<Record<HarmonyPart, keyof typeof PALETTE_GROUP_DEFS>> = {
  base: 'base', wall: 'wall', roof: 'roof', frame: 'frame', edge: 'frame',
};
/** Zusätzliche Kandidaten für Zierholz/Dachkante: neben Holz auch dunkle Steine (Zierholz-Ersatz bei Steinbauten). */
const kindsAlike = (a: string, b: string): boolean => {
  const ka = familyKind(a);
  const kb = familyKind(b);
  if (ka === undefined || kb === undefined) return false;
  if (ka === 'wood' || kb === 'wood') return ka === kb;
  return ka !== 'color' && kb !== 'color';
};

function saturationOf(theme: Pick<ResolvedTheme, 'id' | 'chain'>, s: HarmonySaturation): Exclude<HarmonySaturation, 'auto'> {
  if (s !== 'auto') return s;
  return theme.chain.some((id) => FANTASY_THEMES.includes(id)) ? 'vivid' : 'muted';
}

/** Ersatzfamilie zu `family` (gleiche Art, passt zur Rolle) mit Helligkeit möglichst nahe `target`. */
function nearestFamily(
  family: string, variant: string | undefined, target: number, role: string, part: HarmonyPart,
  sat: Exclude<HarmonySaturation, 'auto'>, taken: ReadonlySet<string>,
): { family: string; variant: string | undefined } {
  const cur = lookOf(familyBlock(family, variant));
  const cap = Math.max(CHROMA_CAP[sat], cur.C);
  let best = { family, variant };
  let bestScore = Infinity;
  const pool = new Set<string>([family, ...PALETTE_GROUP_DEFS[GROUP_OF[part]].families]);
  for (const cand of pool) {
    if (cand.startsWith('color:') || !kindsAlike(family, cand) || !familyFitsRole(cand, role)) continue;
    const v = cand === family ? variant : (variant !== undefined && /^(stripped_)?(log|wood)$/.test(variant) && familyKind(cand) === 'wood' ? variant : undefined);
    if (v !== undefined && !FAMILY_SHAPES[cand]?.some((s) => s === v)) continue;
    const look = lookOf(familyBlock(cand, v));
    if (look.C > cap + 1e-9) continue;
    if (taken.has(`${cand}/${v ?? ''}`) && cand !== family) continue;
    // Abstand zum Ziel; Buntheit nach Sättigungswunsch; das Bestehende behalten, wenn es gleich gut ist
    let score = Math.abs(look.L - target);
    score += sat === 'muted' ? 0.6 * Math.max(0, look.C - cur.C) : sat === 'vivid' ? -0.25 * (look.C - cur.C) : 0;
    if (cand === family) score -= 0.015;
    if (score < bestScore - 1e-12) {
      bestScore = score;
      best = { family: cand, variant: v };
    }
  }
  return best;
}

/** Alle Familien-Einträge einer Rolle um `delta` (OKLab-L) verschieben. Feste Blöcke und Farben bleiben. */
function shiftRole(
  role: string, part: HarmonyPart, spec: ThemeRoleSpec, delta: number, sat: Exclude<HarmonySaturation, 'auto'>,
): ThemeRoleSpec {
  const mapMix = (mix: readonly ThemeMixEntry[]): ThemeMixEntry[] => {
    const taken = new Set<string>();
    // schwere Einträge zuerst, damit die Hauptfamilie die beste Ersatzfamilie bekommt
    const order = mix.map((e, i) => ({ e, i })).sort((a, b) => b.e.weight - a.e.weight || a.i - b.i);
    const out: ThemeMixEntry[] = new Array(mix.length);
    for (const { e, i } of order) {
      if (e.family === undefined) { out[i] = e; continue; }
      const L = lookOf(entryBlock(e)).L;
      const next = nearestFamily(e.family, e.variant, Math.min(0.96, Math.max(0.12, L + delta)), role, part, sat, taken);
      taken.add(`${next.family}/${next.variant ?? ''}`);
      const { variant: _v, ...rest } = e;
      out[i] = { ...rest, family: next.family, ...(next.variant !== undefined ? { variant: next.variant } : {}) };
    }
    return out;
  };
  let out: ThemeRoleSpec = spec;
  if (spec.family !== undefined) {
    const L = lookOf(familyBlock(spec.family)).L;
    const next = nearestFamily(spec.family, undefined, Math.min(0.96, Math.max(0.12, L + delta)), role, part, sat, new Set());
    if (next.family !== spec.family) {
      const fallback = [...new Set([spec.family, ...(spec.fallback ?? [])])].filter((f) => f !== next.family);
      out = { ...spec, family: next.family, fallback };
    }
  }
  if (spec.mix !== undefined) out = { ...out, mix: mapMix(spec.mix) };
  if (spec.gradient !== undefined) {
    const stops: ThemeGradientStop[] = spec.gradient.stops.map((st) => ({ ...st, mix: mapMix(st.mix) }));
    out = { ...out, gradient: { ...spec.gradient, stops } };
  }
  return out;
}

/** Seite wählen: dieselbe wie bisher (Dach dunkler als Wand bleibt dunkler), sonst die andere, wenn der Bereich fehlt. */
function targetAway(anchor: number, current: number, gap: number, prefer?: 'dark' | 'light'): number {
  const lo = anchor - gap;
  const hi = anchor + gap;
  const side = prefer ?? (current <= anchor ? 'dark' : 'light');
  const okLo = lo >= 0.18;
  const okHi = hi <= 0.95;
  if (side === 'dark') return okLo ? lo : hi;
  return okHi ? hi : lo;
}


// ---------------------------------------------------------------- Regel 3: Hauptfarbe ~80 %, Akzent ~20 %

/**
 * Mischung mit zwei (oder mehr) **verschiedenen** Farbklassen, deren größte unter {@link EVEN_SHARE} liegt („fast
 * 50/50“): die Nebenklassen werden so herunterskaliert, dass die Hauptklasse {@link MAIN_SHARE} bekommt.
 * Ähnliche Töne derselben Klasse bleiben unangetastet. Gibt dieselbe Liste zurück, wenn nichts zu tun ist.
 */
export function tiltMix(mix: readonly ThemeMixEntry[]): readonly ThemeMixEntry[] {
  const total = mix.reduce((s, e) => s + e.weight, 0);
  const byClass = new Map<string, number>();
  const cls = mix.map((e) => colorClassOf(entryBlock(e)));
  mix.forEach((e, i) => byClass.set(cls[i]!, (byClass.get(cls[i]!) ?? 0) + e.weight));
  if (byClass.size < 2 || total <= 0) return mix;
  let top = '';
  let topW = -1;
  for (const [c, w] of byClass) if (w > topW + 1e-12) { top = c; topW = w; }
  if (topW / total >= EVEN_SHARE) return mix;
  const others = total - topW;
  const f = ((1 - MAIN_SHARE) / MAIN_SHARE) * (topW / others);
  return mix.map((e, i) => (cls[i] === top ? e : { ...e, weight: Math.round(e.weight * f * 100) / 100 || 0.01 }));
}

function tiltRole(spec: ThemeRoleSpec): ThemeRoleSpec {
  let out = spec;
  if (spec.mix !== undefined) {
    const m = tiltMix(spec.mix);
    if (m !== spec.mix) out = { ...out, mix: [...m] };
  }
  if (spec.gradient !== undefined) {
    let any = false;
    const stops = spec.gradient.stops.map((st) => {
      const m = tiltMix(st.mix);
      if (m === st.mix) return st;
      any = true;
      return { ...st, mix: [...m] };
    });
    if (any) out = { ...out, gradient: { ...spec.gradient, stops } };
  }
  return out;
}

// ---------------------------------------------------------------- Regel 4: Verlauf je Bauteil (zweiter Ton)

/** Dunklerer Nachbarton derselben Art (Sockel/Dach), nah an L − 0,09 und höchstens so bunt wie die Sättigung erlaubt. */
function darkerSibling(family: string, role: string, part: HarmonyPart, sat: Exclude<HarmonySaturation, 'auto'>): string | undefined {
  const cur = lookOf(familyBlock(family));
  const cap = Math.max(CHROMA_CAP[sat], cur.C);
  let best: string | undefined;
  let bestScore = Infinity;
  for (const cand of PALETTE_GROUP_DEFS[GROUP_OF[part]].families) {
    if (cand === family || cand.startsWith('color:') || !kindsAlike(family, cand) || !familyFitsRole(cand, role)) continue;
    const look = lookOf(familyBlock(cand));
    const d = cur.L - look.L;
    if (d < 0.03 || d > 0.2 || look.C > cap + 1e-9) continue;
    const score = Math.abs(d - 0.09);
    if (score < bestScore - 1e-12) { bestScore = score; best = cand; }
  }
  return best;
}

/**
 * Sockel (`foundation`, `wall_plinth`) und Dach (`roof_main`) mit **nur einem** Ton bekommen einen zweiten: der Sockel
 * ein dunkleres Cluster (80/20), das Dach einen Verlauf von der Traufe (dunkler) zum First. Sonst unverändert.
 */
function withSecondTone(role: string, part: HarmonyPart, spec: ThemeRoleSpec, sat: Exclude<HarmonySaturation, 'auto'>): ThemeRoleSpec {
  if (spec.family === undefined || spec.mix !== undefined || spec.gradient !== undefined) return spec;
  if (familyKind(spec.family) === 'wood' || familyKind(spec.family) === 'color') return spec;
  const sib = darkerSibling(spec.family, role, part, sat);
  if (sib === undefined) return spec;
  const { family, ...rest } = spec;
  if (part === 'roof') {
    return { ...rest, gradient: { along: 'roof_t', quantize: 'ring', stops: [{ at: 0, mix: [{ family: sib, weight: 1 }] }, { at: 1, mix: [{ family, weight: 1 }] }] } };
  }
  return {
    ...rest, mix: [{ family, weight: 80 }, { family: sib, weight: 20 }],
    noise: spec.noise ?? { type: 'cluster', scale: 2.5, octaves: 2 },
  };
}

const TOLERANCE = 0.8;

/** Zielanteil der Hauptfarbklasse innerhalb einer Mischung (Komplementär-Regel 80/20) und Schwelle „fast gleich“. */
export const MAIN_SHARE = 0.8;
export const EVEN_SHARE = 0.6;

const cache = new WeakMap<object, Map<string, ResolvedTheme>>();

/**
 * Wendet die Farbharmonie auf ein aufgelöstes Theme an (siehe Dateikopf). Dasselbe Objekt, wenn keine Regel
 * verletzt ist und nichts zu ergänzen bleibt.
 */
export function harmonizeTheme(theme: ResolvedTheme, tuning: HarmonyTuning = {}): ResolvedTheme {
  const contrast = tuning.contrast ?? 'normal';
  const key = `${contrast}|${tuning.saturation ?? 'auto'}`;
  let byKey = cache.get(theme);
  const hit = byKey?.get(key);
  if (hit !== undefined) return hit;
  const sat = saturationOf(theme, tuning.saturation ?? 'auto');
  const scale = CONTRAST_SCALE[contrast];
  const roles: Record<string, ThemeRoleSpec> = { ...theme.roles };
  const view = { roles };
  const L = (p: HarmonyPart): number | undefined => partLightness(view, p);
  const shiftPart = (part: HarmonyPart, delta: number): void => {
    for (const role of HARMONY_PARTS[part]) {
      const spec = roles[role];
      if (spec !== undefined) roles[role] = shiftRole(role, part, spec, delta, sat);
    }
  };
  const settle = (part: HarmonyPart, anchor: HarmonyPart, gap: number, prefer?: 'dark' | 'light'): void => {
    const a = L(anchor);
    const c = L(part);
    // Nachsicht: erst unterhalb von 80 % des Mindestabstands eingreifen (kleine Abweichungen sind keine Kontrast-Fehler)
    if (a === undefined || c === undefined || Math.abs(c - a) >= gap * TOLERANCE) return;
    shiftPart(part, targetAway(a, c, gap, prefer) - c);
  };
  // 1. Kontrast, von den festen zu den nachgiebigen Gruppen
  settle('roof', 'wall', HARMONY_GAPS.wallRoof * scale);
  settle('base', 'wall', HARMONY_GAPS.baseWall * scale);
  settle('frame', 'wall', HARMONY_GAPS.frameWall * scale);
  settle('edge', 'roof', HARMONY_GAPS.edgeRoof * scale);
  // 3./4. Hauptfarbe/Akzent-Verhältnis und zweiter Ton je Bauteil (nach dem Kontrast, damit dessen Wahl mitzieht)
  for (const part of ['base', 'wall', 'roof'] as const) {
    for (const role of HARMONY_PARTS[part]) {
      const spec = roles[role];
      if (spec === undefined) continue;
      roles[role] = withSecondTone(role, part, tiltRole(spec), sat);
    }
  }
  const changed = (Object.keys(roles) as string[]).some((r) => roles[r] !== theme.roles[r]);
  const out: ResolvedTheme = changed ? { ...theme, roles } : theme;
  if (byKey === undefined) {
    byKey = new Map();
    cache.set(theme, byKey);
  }
  byKey.set(key, out);
  return out;
}

/**
 * Schalter-Einstieg für App und Engine (`themeWith`/`shellThemeOf`): wendet {@link harmonizeTheme} nur an, wenn die
 * Paletten-Überschreibung `colorHarmony: 'on'` trägt; sonst dasselbe Theme-Objekt (bitgleich).
 */
export function harmonyOf(theme: ResolvedTheme, overrides: PaletteOverrides | undefined): ResolvedTheme {
  if (overrides?.colorHarmony !== 'on') return theme;
  return harmonizeTheme(theme, {
    ...(overrides.harmonyContrast !== undefined ? { contrast: overrides.harmonyContrast } : {}),
    ...(overrides.harmonySaturation !== undefined ? { saturation: overrides.harmonySaturation } : {}),
  });
}
