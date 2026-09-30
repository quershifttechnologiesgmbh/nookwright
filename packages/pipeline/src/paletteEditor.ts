/**
 * Paletten-Editor (W13-G, plan/spikes/W13G_paletten_editor.md): Ansicht, Vorschläge und „neu würfeln“ für die
 * Paletten-Überschreibungen eines Projekts – gemeinsame Regel für App (Material-Panel, Assistent) und Engine
 * (`palette_suggest`, `building_generate.palette`). Rein und deterministisch; Farben aus `blockLook` (eigene Werte,
 * keine Mojang-Texturen), Verfügbarkeit aus den Plattform-Daten der Zielversion.
 *
 * Harmonie (research/54 §1.2 Wertkontrast, Vorbild Block-Paletten-Generatoren): Paare von Gruppen mit Regel auf der
 * Helligkeit – Dach dunkler als die Wand, Sockel nicht heller als die Wand, Fachwerk hebt sich von der Wand ab, Boden
 * und Innenholz unterscheiden sich, Stoffe heben sich von der Wand ab. Eine Option „passt“, wenn sie alle Regeln
 * ihrer Gruppe gegen den aktuellen Stand der anderen Gruppen erfüllt.
 */
import {
  PALETTE_GROUPS, PALETTE_GROUP_LABELS, Rng, hashSeed, normalizePaletteOverrides, type PaletteGroup, type PaletteOverrides,
} from '@mcda/core';
import {
  FAMILY_SHAPES, PALETTE_GROUP_DEFS, dominantFamily, familyFitsRole, familyKind, groupFamilyProblem, groupRolesIn, swapProblem,
  type ResolvedTheme,
} from '@mcda/catalog';
import { resolveMaterial, type FamilyData } from '@mcda/platform';
import { blockLook } from './blockColors.js';
import type { Rgb } from './blockColorsUtil.js';
import { themeWith, type PipelineContext } from './world.js';

export interface PaletteSwatch {
  readonly family: string;
  /** Block, der die Familie in der Vorschau vertritt (Bretter bzw. Grundblock, Wolle für Farben). */
  readonly block: string;
  /** Vorschaufarbe (24-Bit-RGB aus `blockLook`). */
  readonly color: Rgb;
}

export interface PaletteOptionView extends PaletteSwatch {
  /** Harmonie 0–1 gegen die anderen Gruppen (1 = alle Regeln erfüllt). */
  readonly score: number;
  readonly fits: boolean;
}

export interface PaletteGroupView {
  readonly group: PaletteGroup;
  readonly label: string;
  /** Theme-Rollen, die die Gruppe in diesem Theme färbt. */
  readonly roles: readonly string[];
  /** Tragende Familie von Theme (+ Farbpalette) ohne Überschreibung. */
  readonly theme?: PaletteSwatch | undefined;
  /** Überschreibung des Nutzers (fehlt = Theme). */
  readonly current?: string | undefined;
  /** Tragende Familie nach allen Überschreibungen (inkl. Tausch). */
  readonly effective?: PaletteSwatch | undefined;
  /** Wählbare Familien (gültig für die Rolle, in der Zielversion vorhanden), hell → dunkel. */
  readonly options: readonly PaletteOptionView[];
}

export interface PaletteSwapView {
  readonly from: PaletteSwatch;
  readonly to: PaletteSwatch;
}

export interface PaletteEditorView {
  readonly groups: readonly PaletteGroupView[];
  readonly swaps: readonly PaletteSwapView[];
  /** Familien, die das Theme benutzt und die sich tauschen lassen (Holz, Mauerwerk, Farbe), mit Rollenzahl. */
  readonly swapSources: ReadonlyArray<PaletteSwatch & { readonly roles: number }>;
}

type Relation = { readonly other: PaletteGroup; readonly mode: 'darker' | 'lighter' | 'contrast'; readonly min: number };

/** Harmonie-Regeln je Gruppe (Helligkeitsabstand 0–1). */
export const PALETTE_HARMONY: Readonly<Record<PaletteGroup, readonly Relation[]>> = {
  wall: [{ other: 'roof', mode: 'lighter', min: 0.12 }, { other: 'frame', mode: 'contrast', min: 0.15 }, { other: 'base', mode: 'lighter', min: 0.03 }],
  frame: [{ other: 'wall', mode: 'contrast', min: 0.15 }],
  roof: [{ other: 'wall', mode: 'darker', min: 0.12 }],
  base: [{ other: 'wall', mode: 'darker', min: 0.03 }],
  floor: [{ other: 'interior_wood', mode: 'contrast', min: 0.06 }],
  accent: [{ other: 'wall', mode: 'contrast', min: 0.15 }],
  interior_wood: [{ other: 'floor', mode: 'contrast', min: 0.06 }],
};

/** Relative Helligkeit 0–1 (sRGB-Näherung, wie Wertleitern der Paletten). */
export function luminance(c: Rgb): number {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Vorschau-Block und Farbe einer Familie in einer Version (`undefined` = dort nicht vorhanden). */
export function familySwatch(family: string, data?: FamilyData): PaletteSwatch | undefined {
  if (family.startsWith('color:')) {
    const block = `minecraft:${family.slice(6)}_wool`;
    return { family, block, color: blockLook(block).color };
  }
  let block: string | undefined;
  if (data !== undefined) {
    if (!Object.hasOwn(data.families, family)) return undefined;
    block = (resolveMaterial(data, family, 'planks') ?? resolveMaterial(data, family, 'block'))?.block;
  }
  // Ohne Versionsdaten (Assistent vor dem Laden der Plattform): Bretter bei Holz, sonst der Grundblock
  block ??= familyKind(family) === 'wood' ? `minecraft:${family}_planks` : `minecraft:${family}`;
  return { family, block, color: blockLook(block).color };
}

/** Familie in der Version vorhanden (ohne Versions-Ersatz)? Ohne Daten: bekannt aus der Formtabelle. */
function available(family: string, data: FamilyData | undefined): boolean {
  if (family.startsWith('color:')) return familyKind(family) === 'color';
  return data !== undefined ? Object.hasOwn(data.families, family) : Object.hasOwn(FAMILY_SHAPES, family);
}

function relationScore(rel: Relation, own: number, other: number): number {
  const d = rel.mode === 'darker' ? other - own : rel.mode === 'lighter' ? own - other : Math.abs(own - other);
  return Math.max(0, Math.min(1, d / rel.min));
}

/** Harmonie einer Farbe für eine Gruppe gegen die Farben der anderen Gruppen (fehlende Gruppe zählt als erfüllt). */
export function harmonyScore(group: PaletteGroup, color: Rgb, others: Partial<Record<PaletteGroup, Rgb>>): number {
  const rels = PALETTE_HARMONY[group].filter((r) => others[r.other] !== undefined);
  if (rels.length === 0) return 1;
  const own = luminance(color);
  return Math.min(...rels.map((r) => relationScore(r, own, luminance(others[r.other]!))));
}

/** Kontext des Editors: Themes und Paletten (Blöcke braucht er nicht). */
export type PaletteEditorContext = Pick<PipelineContext, 'themes' | 'palettes'>;

/** Aufgelöstes Theme ohne bzw. mit Überschreibungen. */
function themes(ctx: PaletteEditorContext, themeId: string, paletteId: string | undefined, overrides: PaletteOverrides | undefined) {
  const c = ctx as PipelineContext; // themeWith liest nur themes und palettes
  return { base: themeWith(c, themeId, paletteId), eff: themeWith(c, themeId, paletteId, overrides) };
}

function leadFamily(theme: ResolvedTheme, group: PaletteGroup): string | undefined {
  const lead = groupRolesIn(theme, group)[0];
  return lead === undefined ? undefined : dominantFamily(theme.roles[lead]);
}

/**
 * Ansicht des Editors für ein Theme (+ Palette) mit den Überschreibungen des Projekts. `data`: Familien der Zielversion
 * (`ctx.platform(version).families`); fehlt sie (Assistent vor dem Laden), gilt die Formtabelle der neuesten Version.
 * Gruppen, für die das Theme keine Rolle hat, fehlen.
 */
export function paletteEditorView(
  ctx: PaletteEditorContext, themeId: string, paletteId: string | undefined, overrides: PaletteOverrides | undefined, data?: FamilyData,
): PaletteEditorView {
  const o = normalizePaletteOverrides(overrides);
  const { base, eff } = themes(ctx, themeId, paletteId, o);
  const swatch = (f: string | undefined): PaletteSwatch | undefined => (f === undefined ? undefined : familySwatch(f, data) ?? familySwatch(f));
  const effective = new Map<PaletteGroup, PaletteSwatch | undefined>(PALETTE_GROUPS.map((g) => [g, swatch(leadFamily(eff, g))]));
  const colors: Partial<Record<PaletteGroup, Rgb>> = {};
  for (const [g, s] of effective) if (s !== undefined) colors[g] = s.color;
  const groups: PaletteGroupView[] = [];
  for (const g of PALETTE_GROUPS) {
    const roles = groupRolesIn(base, g);
    if (roles.length === 0) continue;
    const lead = roles[0]!;
    const { [g]: _self, ...others } = colors;
    const options = PALETTE_GROUP_DEFS[g].families
      .filter((f) => available(f, data) && familyFitsRole(f, lead))
      .map((f) => familySwatch(f, data) ?? familySwatch(f)!)
      .map((s) => {
        const score = harmonyScore(g, s.color, others);
        return { ...s, score, fits: score >= 0.999 };
      })
      .sort((a, b) => luminance(b.color) - luminance(a.color) || a.family.localeCompare(b.family));
    groups.push({
      group: g, label: PALETTE_GROUP_LABELS[g], roles, theme: swatch(leadFamily(base, g)), current: o?.groups?.[g], effective: effective.get(g), options,
    });
  }
  const swaps = (o?.swaps ?? []).map((s) => ({ from: swatch(s.from)!, to: swatch(s.to)! })).filter((s) => s.from !== undefined && s.to !== undefined);
  return { groups, swaps, swapSources: swapSources(base, data) };
}

/** Tauschbare Familien des Themes (Holz, Mauerwerk, Farbe) mit Zahl der Rollen, häufigste zuerst. */
function swapSources(theme: ResolvedTheme, data: FamilyData | undefined): Array<PaletteSwatch & { readonly roles: number }> {
  const count = new Map<string, number>();
  for (const spec of Object.values(theme.roles)) {
    const fams = new Set<string>();
    const add = (f: string | undefined, c: string | undefined): void => {
      const id = f ?? (c !== undefined ? `color:${c}` : undefined);
      if (id !== undefined) fams.add(id);
    };
    add(spec.family, spec.color);
    for (const e of spec.mix ?? []) add(e.family, e.color);
    for (const st of spec.gradient?.stops ?? []) for (const e of st.mix) add(e.family, e.color);
    for (const f of fams) count.set(f, (count.get(f) ?? 0) + 1);
  }
  return [...count.entries()]
    .filter(([f]) => { const k = familyKind(f); return k === 'wood' || k === 'masonry' || k === 'color'; })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([f, roles]) => ({ ...(familySwatch(f, data) ?? familySwatch(f)!), roles }));
}

/** Ziele für einen Tausch: gleiche Art, in der Version vorhanden, hell → dunkel. */
export function swapTargets(from: string, versionData?: FamilyData): readonly PaletteSwatch[] {
  const kind = familyKind(from);
  if (kind === undefined) return [];
  const fams = kind === 'color'
    ? PALETTE_GROUP_DEFS.accent.families
    : Object.keys(FAMILY_SHAPES).filter((f) => !f.startsWith('color:') && familyKind(f) === kind);
  return fams
    .filter((f) => f !== from && available(f, versionData))
    .map((f) => familySwatch(f, versionData) ?? familySwatch(f)!)
    .sort((a, b) => luminance(b.color) - luminance(a.color) || a.family.localeCompare(b.family));
}

/**
 * Prüfung der Überschreibungen für Theme und Zielversion: nur handverlesene Familien der Gruppe mit passender Form,
 * nur Familien der Zielversion, Tausch nur innerhalb einer Art. Leere Liste = gültig.
 */
export function paletteOverrideProblems(overrides: PaletteOverrides | undefined, versionData?: FamilyData): readonly string[] {
  const o = normalizePaletteOverrides(overrides);
  if (o === undefined) return [];
  const out: string[] = [];
  const version = versionData !== undefined ? ` in Version ${versionData.version}` : '';
  for (const g of PALETTE_GROUPS) {
    const f = o.groups?.[g];
    if (f === undefined) continue;
    const why = groupFamilyProblem(g, f);
    if (why !== undefined) out.push(`${g}: ${why}`);
    else if (!available(f, versionData)) out.push(`${g}: ${f} gibt es${version} nicht`);
  }
  for (const s of o.swaps ?? []) {
    const why = swapProblem(s.from, s.to);
    if (why !== undefined) out.push(`Tausch ${s.from} → ${s.to}: ${why}`);
    else if (!available(s.to, versionData)) out.push(`Tausch ${s.from} → ${s.to}: ${s.to} gibt es${version} nicht`);
  }
  return out;
}

/** Reihenfolge beim Würfeln: tragende Flächen zuerst, dann die, die sich an ihnen ausrichten. */
const ROLL_ORDER: readonly PaletteGroup[] = ['wall', 'roof', 'base', 'frame', 'floor', 'interior_wood', 'accent'];

/**
 * „Neu würfeln“ (Vorbild blockpalette.xyz/deltacalculator: gesperrte Blöcke bleiben, der Rest wird neu gezogen):
 * Für jede nicht gesperrte Gruppe eine Familie, die zu den schon feststehenden passt (Harmonie-Regeln), sonst eine
 * beliebige der Gruppe. Gesperrte Gruppen behalten ihren Wert (Überschreibung bzw. Theme), der Tausch bleibt.
 * Deterministisch aus `seed`.
 */
export function rollPaletteOverrides(
  ctx: PaletteEditorContext, themeId: string, paletteId: string | undefined, overrides: PaletteOverrides | undefined, data: FamilyData | undefined,
  seed: number, locked: readonly PaletteGroup[] = [],
): PaletteOverrides | undefined {
  const o = normalizePaletteOverrides(overrides);
  const view = paletteEditorView(ctx, themeId, paletteId, o, data);
  const byGroup = new Map(view.groups.map((g) => [g.group, g]));
  const rng = new Rng(hashSeed('palette-roll', themeId, paletteId ?? '', seed));
  const colors: Partial<Record<PaletteGroup, Rgb>> = {};
  const groups: Partial<Record<PaletteGroup, string>> = {};
  // Gesperrte Gruppen stehen fest und zählen für die Harmonie der anderen
  for (const g of locked) {
    const v = byGroup.get(g);
    if (v?.effective !== undefined) colors[g] = v.effective.color;
    if (o?.groups?.[g] !== undefined) groups[g] = o.groups[g];
  }
  for (const g of ROLL_ORDER) {
    const v = byGroup.get(g);
    if (v === undefined || locked.includes(g) || v.options.length === 0) continue;
    const fitting = v.options.filter((opt) => harmonyScore(g, opt.color, colors) >= 0.999);
    const pick = rng.pick(fitting.length > 0 ? fitting : v.options);
    groups[g] = pick.family;
    colors[g] = pick.color;
  }
  return normalizePaletteOverrides({
    groups, ...(o?.swaps !== undefined ? { swaps: o.swaps } : {}),
    // WS-Farbe: die Farbharmonie bleibt beim Würfeln erhalten
    ...(o?.colorHarmony !== undefined ? { colorHarmony: o.colorHarmony } : {}),
    ...(o?.harmonyContrast !== undefined ? { harmonyContrast: o.harmonyContrast } : {}),
    ...(o?.harmonySaturation !== undefined ? { harmonySaturation: o.harmonySaturation } : {}),
  });
}
