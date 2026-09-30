import { parseJson5Text } from './json5Text.js';
import { z } from 'zod';
import { PALETTE_MOODS, PALETTE_ROLES, type PaletteMood, type PaletteRole } from './paletteRoles.js';
import type { ValidationResult } from './validate.js';
import { SHELL_ROLE_SHAPES } from './roleShapes.js';
import { FAMILY_SHAPES } from './familyShapes.js';
import {
  TERRAIN_CROP_ROLES, TERRAIN_PLANT_ROLES, plantNeedsSoil, terrainRequirement, type TerrainNeeds,
} from './terrainContract.js';
import { resolveTheme, type ResolvedTheme, type ThemeDef, type ThemeMixEntry, type ThemePaletteRoleMap, type ThemeRoleSpec } from './theme.js';

export { PALETTE_MOODS, PALETTE_ROLES, type PaletteMood, type PaletteRole };

/**
 * Farbpalette als eigenes Konzept neben dem Theme (research/54 §2–3): Ein Theme beschreibt **Bauweise**
 * (Flächen-Muster, Fachwerk, Deckenbalken, Verwitterung), eine Palette beschreibt die **Farbwelt** (welche Blöcke
 * welche Oberflächenklasse tragen). Beide sind unabhängig kombinierbar: `applyPalette(theme, palette)` färbt ein
 * Theme um und liefert wieder ein ganz normales `ThemeDef`, das durch dieselbe Auflösung und Validierung läuft.
 *
 * Konventionen:
 *  - Elf **Paletten-Rollen** sind bewusst gröber als die Theme-Rollen: sie kennen nur Oberflächenklassen
 *    (Wandfläche, Dach, Rahmen, Holz, Boden, Akzent, Glas, Licht, Bewuchs), keine Bauteil-Semantik.
 *  - Jede Rolle trägt eine gewichtete Blockliste, **HELL → DUNKEL** geordnet – dieselbe Konvention wie
 *    `ThemeMixEntry` (Cluster-Rauschen stößt so nur Nachbarn aneinander).
 *  - Einträge nennen entweder eine **Familie** (optional mit `variant`, z. B. `stone_bricks` + `mossy`) oder
 *    einen festen **Block** für Dinge ohne Plattform-Familie (z. B. `minecraft:lantern`).
 *  - `values` ist die palettenweite Wertleiter (hell → dunkel) für Brückenblöcke und Verläufe; sie ist rein
 *    informativ und keine Bau-Logik.
 *  - Die Zuordnung Palette → Theme steht **im Theme** (`ThemeDef.paletteRoleMap`), damit die Palette selbst
 *    Theme-unabhängig bleibt.
 */

const ID = /^[a-z0-9_]+$/;
const FAMILY_ID = /^[a-z0-9_]+(:[a-z0-9_]+)?$/;
const BLOCK_ID = /^[a-z0-9_.-]+:[a-z0-9_/.-]+$/;
const SHAPE = /^[a-z0-9_]+$/;

const BlockIdSchema = z.string().regex(BLOCK_ID, 'Block-ID im Format namespace:name');

const exactlyOne = (...vals: unknown[]): boolean => vals.filter((v) => v !== undefined).length === 1;

/** Ein Eintrag einer Paletten-Rolle: Familie (+ Form/Variante) ODER fester Block, gewichtet. */
export const PaletteMixEntrySchema = z
  .object({
    family: z.string().regex(FAMILY_ID, 'Familien-ID: klein, optional mit Präfix (z. B. spruce, color:red)').optional(),
    /**
     * Form der Familie (research/54 §2.3): Die Palette nennt den Block so, wie er im Entwurf stand
     * (`<familie>_log`, `<familie>_bars`), damit Verlaufs-/Formauflösung nichts verliert. Fehlt sie, gilt die
     * Standardform der Familie (`block`/`planks`).
     */
    shape: z.string().regex(SHAPE, 'Form: klein, z. B. log, bars, lantern').optional(),
    variant: z.string().regex(SHAPE, 'Form-Variante: klein, z. B. mossy').optional(),
    block: BlockIdSchema.optional(),
    weight: z.number().positive().describe('Gewicht der Mischung (Summe je Rolle = 100)'),
  })
  .strict()
  .refine((m) => exactlyOne(m.family, m.block), { message: 'Paletten-Eintrag braucht genau eins von family oder block' })
  .refine((m) => m.variant === undefined || m.family !== undefined, { message: 'variant gilt nur zusammen mit family' })
  .refine((m) => m.shape === undefined || m.family !== undefined, { message: 'shape gilt nur zusammen mit family' });

const PaletteGradientStopSchema = z.object({
  at: z.number().min(0).max(1).describe('Position auf der vorhandenen Theme-Verlaufsachse (0–1)'),
  blocks: z.array(PaletteMixEntrySchema).min(1).describe('Materialmischung an dieser Position'),
}).strict();

export const PaletteRoleSchema = z
  .object({
    blocks: z.array(PaletteMixEntrySchema).min(1, 'Eine Paletten-Rolle braucht mindestens einen Block'),
    gradientStops: z.array(PaletteGradientStopSchema).min(2)
      .refine(stops => stops[0]?.at === 0 && stops[stops.length - 1]?.at === 1,
        'Verlaufsstopps müssen bei 0 beginnen und bei 1 enden')
      .refine(stops => stops.every((stop, i) => i === 0 || stop.at > stops[i - 1]!.at),
        'Verlaufsstopps müssen streng aufsteigen')
      .optional().describe('Explizite Materialverläufe für Theme-Rollen mit Gradient; ohne Angabe bisherige einheitliche Mischung'),
  })
  .strict();

export const PaletteDefSchema = z
  .object({
    id: z.string().regex(ID, 'id: klein, z. B. steinburg_grau'),
    name: z.string().min(1),
    description: z.string().optional(),
    mood: z.enum(PALETTE_MOODS),
    biomes: z.array(z.string().regex(ID)).min(1),
    styles: z.array(z.string().regex(ID)).min(1),
    /** Wertleiter HELL → DUNKEL (Brückenblöcke, Verläufe); rein informativ, keine Bau-Logik. */
    values: z.array(BlockIdSchema).min(2),
    roles: z.partialRecord(z.enum(PALETTE_ROLES), PaletteRoleSchema),
  })
  .strict();

export type PaletteMixEntry = z.infer<typeof PaletteMixEntrySchema>;
export type PaletteRoleSpec = z.infer<typeof PaletteRoleSchema>;
export type PaletteDef = z.infer<typeof PaletteDefSchema>;

/** Anteil der schwersten Zutat einer Paletten-Rolle (0–1); `undefined` ohne Einträge. */
export function paletteDominance(spec: PaletteRoleSpec): number | undefined {
  const total = spec.blocks.reduce((s, b) => s + b.weight, 0);
  return total <= 0 ? undefined : Math.max(...spec.blocks.map((b) => b.weight)) / total;
}

/**
 * Palette-Eintrag → Theme-Mischungs-Eintrag (research/54 §2.3). Reine Übersetzung, keine Auflösung: Die Familie
 * kommt erst im Materialisierer (mit Version, Form und Fallbacks). Hat der Eintrag eine Form, die nicht
 * `block`/`planks` ist, bleibt sie als `variant` erhalten – `shape` und `variant` liegen dort auf derselben
 * Achse (bei `block`-artigen Formen ist die Variante die Form der Familie).
 */
/**
 * Kann dieser Paletten-Eintrag eine der geforderten Formen auflösen? Feste Blöcke gelten als „block" (ihre
 * Zustandsform ist Sache des Komponenten-Bauplans), Familien über ihre Formtabelle, Varianten als eigene Familie
 * (`mossy_stone_bricks`).
 */
function mixEntryHasShape(e: ThemeMixEntry, need: readonly string[]): boolean {
  // Fester Block: kennt keine Formen. Er passt nur, wenn die Rolle **ausschließlich** die Vollblock-Form
  // braucht (`parapet`, `wall_quoin`, `textile_neutral`); sonst bliebe das Dach ohne Treppe.
  if (e.block !== undefined) return need.length === 1 && need[0] === 'block';
  const fam = e.variant !== undefined ? `${e.variant}_${e.family}` : e.family!;
  const shapes = Object.hasOwn(FAMILY_SHAPES, fam) ? FAMILY_SHAPES[fam] : undefined;
  return shapes !== undefined && shapes.some((s) => need.includes(s));
}

/** Zusatzformen, die im Theme über `variant` laufen (`<variante>_<familie>`), keine `variant: "block"`-Formen. */
const VARIANT_SHAPES = new Set(['stained_glass', 'glazed', 'glazed_terracotta', 'mossy', 'cracked', 'chiseled']);

export function paletteMixEntry(e: PaletteMixEntry): ThemeMixEntry {
  if (e.family === undefined) return { block: e.block!, weight: e.weight };
  // Der Theme-Materialisierer fragt die **Form der Rolle** ab (Treppe im Dach, Scheibe im Fenster). Deshalb darf
  // hier nur eine echte Variante (`mossy`, `stained_glass`) durchgereicht werden – die Form der Palette bleibt
  // Katalog-Aussage. Siehe `resolvePalettedTheme`: Einträge ohne die geforderte Form fallen dort heraus.
  const variant = e.variant !== undefined && VARIANT_SHAPES.has(e.variant) ? e.variant
    : e.shape !== undefined && VARIANT_SHAPES.has(e.shape) ? e.shape
      : undefined;
  return { family: e.family, ...(variant !== undefined ? { variant } : {}), weight: e.weight };
}

/**
 * Farbwelt eines Themes anwenden (research/54 §3.2): überschreibt die **Material-Felder** der im
 * `paletteRoleMap` genannten Theme-Rollen, lässt `surfaces`, `decor`, `items` und `versionFallbacks`
 * unverändert – Stil bleibt, Farbe wechselt. Rein und deterministisch.
 *
 * - Rollen mit `gradient` behalten ihre **Stopp-Struktur** (Verlauf ist Geometrie): nur die Mischung jedes
 *   Stopps wird durch die Paletten-Rolle ersetzt. Explizite `gradientStops` ersetzen die Stopp-Liste mit
 *   individuellen Mischungen, ohne Achse/Interpolation/Jitter zu ändern.
 * - Rollen mit `mix`/`family`/`color` werden vollständig ersetzt; `family`/`color` entfallen, `noise`,
 *   `perCell`, `shapes` und `fallback` der Rolle bleiben (sie beschreiben die Bauweise, nicht die Farbe).
 * - Ohne `paletteRoleMap` und ohne passende Paletten-Rolle ist das Ergebnis **feldgleich** zum Eingabe-Theme.
 */
export function applyPalette(theme: ThemeDef, palette: PaletteDef, inheritedMap?: ThemePaletteRoleMap): ThemeDef {
  const map = theme.paletteRoleMap ?? inheritedMap;
  if (map === undefined) return theme;
  const roles: Record<string, ThemeRoleSpec> = { ...theme.roles };
  for (const [key, targets] of Object.entries(map)) {
    const spec = palette.roles[key as PaletteRole];
    if (spec === undefined) continue;
    const mix: ThemeMixEntry[] = spec.blocks.map(paletteMixEntry);
    for (const target of targets ?? []) {
      const existing = roles[target];
      if (existing === undefined) continue;
      const { family: _f, color: _c, mix: _m, gradient, ...rest } = existing;
      roles[target] = gradient !== undefined
        ? { ...rest, gradient: { ...gradient, stops: spec.gradientStops?.map(s => ({ at: s.at, mix: s.blocks.map(paletteMixEntry) }))
          ?? gradient.stops.map((s) => ({ ...s, mix })) } }
        : { ...rest, mix };
    }
  }
  return { ...theme, roles };
}

/** Fachliche Prüfungen über das Schema hinaus (Dominanzband, Wertleiter, doppelte Einträge). */
export function validatePaletteDef(input: unknown): ValidationResult<PaletteDef> {
  const parsed = PaletteDefSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.length > 0 ? i.path.join('.') : '(wurzel)'}: ${i.message}`), warnings: [] };
  }
  const p = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  // Alle elf Rollen sind Pflicht (research/54 §2.2): Eine fehlende Rolle hieße „dieses Theme behält hier seine
  // Farbe" und wäre nicht mehr erklärbar – das Schema lässt sie einzeln weg, damit die Fehlermeldung sie nennt.
  for (const role of PALETTE_ROLES) {
    if (p.roles[role] === undefined) errors.push(`${p.id}.roles.${role}: Paletten-Rolle fehlt`);
  }
  for (const [role, spec] of Object.entries(p.roles)) {
    const where = `${p.id}.${role}`;
    const seen = new Set<string>();
    for (const b of spec.blocks) {
      const key = b.family !== undefined
        ? `${b.family}${b.variant !== undefined ? `.${b.variant}` : ''}${b.shape !== undefined ? `#${b.shape}` : ''}`
        : `block:${b.block}`;
      if (seen.has(key)) warnings.push(`${where}: Eintrag ${key} doppelt`);
      seen.add(key);
    }
    // Dominanzband 45–95 % wie in theme.ts (`dominance`): eine **tragende** Fläche lebt von einem Material.
    // Für Nebenrollen (Akzent, Bewuchs, Rahmen) ist eine gleichmäßige Mischung Absicht und wird nicht gewarnt.
    if (spec.blocks.length > 1 && (role === 'wall_primary' || role === 'floor')) {
      const share = paletteDominance(spec)!;
      if (share < 0.45) warnings.push(`${where}: kein tragendes Material (größter Anteil ${Math.round(share * 100)} %, empfohlen 50–80 %; research/20 §0.3)`);
      else if (share > 0.95) warnings.push(`${where}: nur ein Material (${Math.round(share * 100)} %; research/20 §0.3)`);
    }
    const total = spec.blocks.reduce((s, b) => s + b.weight, 0);
    if (Math.abs(total - 100) > 0.01) warnings.push(`${where}: Gewichtssumme ${total} statt 100`);
  }
  if (new Set(p.values).size !== p.values.length) warnings.push(`${p.id}.values: Block doppelt in der Wertleiter`);
  if (p.values.length < 3) warnings.push(`${p.id}.values: Wertleiter mit ${p.values.length} Stufen ist sehr kurz`);
  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, value: p, warnings };
}

/** Liest eine Palette aus JSON5-Text (Katalog-Dateien erlauben Kommentare). */
export function parsePaletteDef(text: string, source = '<text>'): ValidationResult<PaletteDef> {
  let raw: unknown;
  try {
    raw = parseJson5Text(text);
  } catch (e) {
    return { ok: false, errors: [`${source}: JSON5-Fehler: ${(e as Error).message}`], warnings: [] };
  }
  const r = validatePaletteDef(raw);
  return r.ok ? r : { ...r, errors: r.errors.map((m) => `${source}: ${m}`) };
}

// ---------------------------------------------------------------- Theme × Palette

/**
 * Ein Theme mit angewandter Palette als **aufgelöstes** Theme. Gearbeitet wird auf den Rollen der
 * **aufgelösten** Kette (`resolveTheme`), damit eine Palette auch geerbte Rollen umfärbt (z. B. `timber` erbt
 * Wand, Boden und Dach von `medieval` und nennt selbst nur `wall_infill`). Rollen, die Palette oder Theme nicht
 * nennen, bleiben unverändert. `palette === undefined` liefert das unveränderte Theme (wichtig für die
 * Prüfsummen: ohne Auswahl ändert sich nichts).
 */
export function resolvePalettedTheme(
  defs: ReadonlyMap<string, ThemeDef>,
  themeId: string,
  palette: PaletteDef | undefined,
): ValidationResult<ResolvedTheme> {
  const base = resolveTheme(defs, themeId);
  if (!base.ok || palette === undefined) return base;
  const roles: Record<string, ThemeRoleSpec> = { ...base.value.roles };
  // W8-C (2026-09-27): Geländevertrag – was die Pflanzen des umgefärbten Themes vom Untergrund verlangen.
  const needs = terrainNeeds(base.value, palette);
  for (const [key, targets] of Object.entries(base.value.paletteRoleMap)) {
    const spec = palette.roles[key as PaletteRole];
    if (spec === undefined) continue;
    const all: ThemeMixEntry[] = spec.blocks.map(paletteMixEntry);
    for (const target of targets ?? []) {
      const existing = roles[target];
      if (existing === undefined) continue;
      // Formvertrag (SHELL_ROLE_SHAPES): nur Einträge, die eine von der Theme-Rolle geforderte Form auflösen.
      // W8-C (2026-09-27): Geländerollen zusätzlich nur mit tragfähigen Einträgen (`terrainRequirement`): kein Teppich
      // oder Kies als Untergrund, Erde unter Blumen, keine frei stehenden Ranken. Erfüllt jeder Eintrag den Vertrag,
      // bleibt die Rolle wie bisher (bitgleich).
      const need = SHELL_ROLE_SHAPES[target];
      const ground = terrainRequirement(target, needs);
      const fits = (e: ThemeMixEntry): boolean => (need === undefined || mixEntryHasShape(e, need)) && ground(e);
      const mix = all.filter(fits);
      const { family: _f, color: _c, mix: _m, gradient, ...rest } = existing;
      // Jeden expliziten Stopp am selben Formvertrag prüfen. Ein unbaubarer Stopp darf weder
      // verschwinden noch einen halben Verlauf hinterlassen: die ganze Theme-Rolle bleibt erhalten.
      const explicitStops = gradient === undefined ? undefined : spec.gradientStops?.map(s => ({
        at: s.at,
        mix: s.blocks.map(paletteMixEntry).filter(fits),
      }));
      if (explicitStops !== undefined ? explicitStops.some(s => s.mix.length === 0) : mix.length === 0) continue;
      // W7 (2026-09-27): Rollen ohne Formvertrag (`hearth`, `leaves_*` …) fragen Komponenten und Außen-Deko mit
      // eigenen Formen ab (Feuerschale: `hearth` als Mauer, Baum: `leaves_oak` als Laub). Hat keine Farbe der Palette
      // diese Form, fällt die Auflösung auf die Familien des Themes zurück statt `MaterializeError` zu werfen
      // (Burg medieval + Farbwelt, rustic + piratenbucht_holz). Nur der letzte Weg vor dem Plattform-Rückfall: wo die
      // Palette die Form hat, bleibt das Ergebnis gleich.
      const fallback = paletteFallback(rest.fallback, existing);
      roles[target] = gradient !== undefined
        ? { ...rest, ...fallback, gradient: { ...gradient, stops: explicitStops ?? gradient.stops.map((s) => ({ ...s, mix })) } }
        : { ...rest, ...fallback, mix };
    }
  }
  return { ok: true, value: { ...base.value, roles }, warnings: base.warnings };
}

/**
 * W8-C (2026-09-27): Was die Pflanzen-Rollen des umgefärbten Themes vom Untergrund verlangen. Eine Pflanzen-Rolle,
 * die die Palette nicht (oder nur mit Ranken) umfärbt, behält die Pflanzen des Themes – die brauchen Erde bzw.
 * Ackerland. Umgefärbte Rollen brauchen Erde nur, wenn die Palette dort Bodenpflanzen nennt (Gras, toter Busch);
 * Laub, Blöcke und Pilze stehen auf jedem Untergrund. Gleiche Reihenfolge wie die Umfärbung: der letzte
 * Paletten-Schlüssel mit passenden Einträgen gewinnt.
 */
function terrainNeeds(base: ResolvedTheme, palette: PaletteDef): TerrainNeeds {
  const recoloured = (role: string): ThemeMixEntry[] | undefined => {
    if (base.roles[role] === undefined) return undefined;
    const plant = terrainRequirement(role, { soil: false, farmland: false, cropSoil: false });
    let out: ThemeMixEntry[] | undefined;
    for (const [key, targets] of Object.entries(base.paletteRoleMap)) {
      const spec = palette.roles[key as PaletteRole];
      if (spec === undefined || !(targets ?? []).includes(role)) continue;
      const mix = spec.blocks.map(paletteMixEntry).filter(plant);
      if (mix.length > 0) out = mix;
    }
    return out;
  };
  const own = (role: string): boolean => base.roles[role] !== undefined && recoloured(role) === undefined;
  return {
    soil: TERRAIN_PLANT_ROLES.some((r) => own(r) || (recoloured(r)?.some(plantNeedsSoil) ?? false)),
    farmland: TERRAIN_CROP_ROLES.some(own),
    cropSoil: TERRAIN_CROP_ROLES.some((r) => recoloured(r)?.some(plantNeedsSoil) ?? false),
  };
}

/**
 * Ersatzfamilien einer umgefärbten Rolle: die eigenen `fallback` der Rolle, danach die Familien, die das Theme vor der
 * Palette dort hatte (`family`, `color`, Mischung, Verlaufsstopps; feste Blöcke kennen keine Formen und entfallen).
 */
function paletteFallback(own: readonly string[] | undefined, original: ThemeRoleSpec): { fallback?: string[] } {
  const fams: string[] = [...(own ?? [])];
  const add = (f: string | undefined): void => { if (f !== undefined && !fams.includes(f)) fams.push(f); };
  const addEntry = (e: ThemeMixEntry): void => {
    add(e.family);
    if (e.color !== undefined) { add(`${e.color}_wool`); add(`color:${e.color}`); }
  };
  add(original.family);
  if (original.color !== undefined) { add(`${original.color}_wool`); add(`color:${original.color}`); }
  for (const e of original.mix ?? []) addEntry(e);
  for (const st of original.gradient?.stops ?? []) for (const e of st.mix) addEntry(e);
  return fams.length > 0 ? { fallback: fams } : {};
}

/** Unveränderliche Palettensammlung (analog `ThemeCatalog`). Prüft alle Paletten beim Anlegen. */
export class PaletteCatalog {
  private readonly defs: ReadonlyMap<string, PaletteDef>;

  private constructor(defs: ReadonlyMap<string, PaletteDef>) {
    this.defs = defs;
  }

  static of(palettes: readonly PaletteDef[]): PaletteCatalog {
    const defs = new Map<string, PaletteDef>();
    const errors: string[] = [];
    for (const p of palettes) {
      if (defs.has(p.id)) errors.push(`Palette '${p.id}' ist doppelt`);
      else defs.set(p.id, p);
    }
    if (errors.length > 0) throw new Error(`Paletten ungültig:\n${errors.join('\n')}`);
    return new PaletteCatalog(defs);
  }

  ids(): string[] {
    return [...this.defs.keys()].sort();
  }

  get(id: string): PaletteDef {
    const p = this.defs.get(id);
    if (p === undefined) throw new Error(`Unbekannte Palette '${id}' (vorhanden: ${this.ids().join(', ')})`);
    return p;
  }

  find(id: string | undefined): PaletteDef | undefined {
    return id === undefined ? undefined : this.defs.get(id);
  }

  get size(): number {
    return this.defs.size;
  }

  [Symbol.iterator](): IterableIterator<PaletteDef> {
    return this.defs.values();
  }
}

/** Alle Paletten, deren `styles` das Theme nennen (Reihenfolge der Eingabe; rein informativ für die Auswahl). */
export function palettesForTheme(catalog: PaletteCatalog, themeId: string): PaletteDef[] {
  return [...catalog].filter((p) => p.styles.includes(themeId));
}
