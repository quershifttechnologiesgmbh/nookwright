/**
 * Paletten-Überschreibungen (W13-G „Blockpalette vor dem Generieren anpassen“): der Nutzer legt **vor** dem Generieren
 * fest, welche Materialfamilie eine Rollengruppe trägt (Wand, Rahmen, Dach, Sockel, Boden, Akzent, Innenholz), und
 * kann eine Familie überall gegen eine andere tauschen („Eiche → Fichte“). Reiner Domänen-Wert, hier in `@mcda/core`,
 * weil der Projektzustand (`@mcda/blueprint`) ihn speichert und `@mcda/catalog` ihn auf das Theme anwendet – beide
 * hängen nur an `@mcda/core`.
 *
 * Vorbilder (plan/spikes/W13G_paletten_editor.md §1): Dungeon Alchemist „Change All Walls“ (eine Wahl färbt alle Wände
 * eines Raums), Block-Paletten-Generatoren (blockpalette.xyz, deltacalculator: Block sperren, Rest neu würfeln),
 * Townscaper (kleine, handverlesene Farbauswahl statt aller Blöcke), Axiom (Palette ersetzt Blöcke).
 *
 * Fehlt der Wert (oder ist er leer), bleibt jede Ausgabe bitgleich.
 */

/** Rollengruppen des Paletten-Editors in Anzeige-Reihenfolge (außen → innen). */
export const PALETTE_GROUPS = ['wall', 'frame', 'roof', 'base', 'floor', 'accent', 'interior_wood'] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/** Deutsche Namen der Gruppen (UI, Engine-Beschreibung, Bericht). */
export const PALETTE_GROUP_LABELS: Readonly<Record<PaletteGroup, string>> = {
  wall: 'Wand',
  frame: 'Rahmen & Fachwerk',
  roof: 'Dach',
  base: 'Sockel',
  floor: 'Boden',
  accent: 'Akzent (Stoffe)',
  interior_wood: 'Innenholz',
};

/** Tausch einer Materialfamilie gegen eine andere in allen Rollen des Themes (Verläufe und Mischungen bleiben). */
export interface FamilySwap {
  readonly from: string;
  readonly to: string;
}

/** WS-Farbe: Kontrast-Mindestabstand der Farbharmonie (`soft` schwächer, `strong` stärker als der Standard). */
export const HARMONY_CONTRASTS = ['soft', 'normal', 'strong'] as const;
export type HarmonyContrastLevel = (typeof HARMONY_CONTRASTS)[number];
/** WS-Farbe: Sättigung der Farbharmonie; `auto` = nach Theme (Fantasy-Themes vivid, sonst muted). */
export const HARMONY_SATURATIONS = ['auto', 'muted', 'natural', 'vivid'] as const;
export type HarmonySaturationLevel = (typeof HARMONY_SATURATIONS)[number];

export interface PaletteOverrides {
  /** Gruppe → Materialfamilie (`spruce`, `bricks`, `color:red`); fehlt eine Gruppe, gilt das Theme. */
  readonly groups?: { readonly [G in PaletteGroup]?: string | undefined };
  /** Familien-Tausch in Reihenfolge; wirkt nach den Gruppen nicht auf überschriebene Gruppen. */
  readonly swaps?: readonly FamilySwap[];
  /**
   * Additiv (WS-Farbe, Bauprozess-Tutorial Schritt 3): `on` schaltet die Farbharmonie ein (Kontrast zwischen Sockel, Wand,
   * Dach und Zierholz, Sättigung passend zum Stil; `colorHarmony` in `@mcda/pipeline`). Fehlt das Feld (oder `off`),
   * ist jede Ausgabe bitgleich.
   */
  readonly colorHarmony?: 'on';
  /** Nur mit `colorHarmony`: Stärke des Kontrast-Mindestabstands (Standard `normal`). */
  readonly harmonyContrast?: HarmonyContrastLevel;
  /** Nur mit `colorHarmony`: Sättigung (Standard `auto`). */
  readonly harmonySaturation?: HarmonySaturationLevel;
}

const FAMILY = /^[a-z0-9_]+(:[a-z0-9_]+)?$/;

/**
 * Normalform: nur bekannte Gruppen in fester Reihenfolge, nur gültige Familien-IDs, Tausch ohne Leerlauf (`from ≠ to`)
 * und ohne doppelte Quelle (die erste gewinnt). Leer → `undefined` (so bleibt „keine Überschreibung“ feldgleich).
 */
export function normalizePaletteOverrides(o: PaletteOverrides | undefined): PaletteOverrides | undefined {
  if (o === undefined) return undefined;
  const groups: Partial<Record<PaletteGroup, string>> = {};
  for (const g of PALETTE_GROUPS) {
    const f = o.groups?.[g];
    if (typeof f === 'string' && FAMILY.test(f)) groups[g] = f;
  }
  const seen = new Set<string>();
  const swaps: FamilySwap[] = [];
  for (const s of o.swaps ?? []) {
    if (!FAMILY.test(s.from) || !FAMILY.test(s.to) || s.from === s.to || seen.has(s.from)) continue;
    seen.add(s.from);
    swaps.push({ from: s.from, to: s.to });
  }
  const hasGroups = Object.keys(groups).length > 0;
  const harmony = o.colorHarmony === 'on';
  if (!hasGroups && swaps.length === 0 && !harmony) return undefined;
  return {
    ...(hasGroups ? { groups } : {}), ...(swaps.length > 0 ? { swaps } : {}),
    ...(harmony ? {
      colorHarmony: 'on' as const,
      ...(o.harmonyContrast !== undefined && o.harmonyContrast !== 'normal' && HARMONY_CONTRASTS.includes(o.harmonyContrast) ? { harmonyContrast: o.harmonyContrast } : {}),
      ...(o.harmonySaturation !== undefined && o.harmonySaturation !== 'auto' && HARMONY_SATURATIONS.includes(o.harmonySaturation) ? { harmonySaturation: o.harmonySaturation } : {}),
    } : {}),
  };
}

/** Vergleichsschlüssel (Caches); `''` = keine Überschreibung. */
export function paletteOverridesKey(o: PaletteOverrides | undefined): string {
  const n = normalizePaletteOverrides(o);
  if (n === undefined) return '';
  const g = PALETTE_GROUPS.filter((k) => n.groups?.[k] !== undefined).map((k) => `${k}=${n.groups![k]}`).join(',');
  const s = (n.swaps ?? []).map((x) => `${x.from}>${x.to}`).join(',');
  const h = n.colorHarmony === 'on' ? `|h:${n.harmonyContrast ?? 'normal'}:${n.harmonySaturation ?? 'auto'}` : '';
  return `${g}|${s}${h}`;
}

/** Zwei Überschreibungen gleich (Normalform)? */
export const samePaletteOverrides = (a: PaletteOverrides | undefined, b: PaletteOverrides | undefined): boolean =>
  paletteOverridesKey(a) === paletteOverridesKey(b);
