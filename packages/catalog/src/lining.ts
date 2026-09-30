import { z } from 'zod';

/**
 * Innenhaut (W2, Baustandard I1/I4, Prüfbericht X4 §7): ein Innenprofil in der Innenluft vor **allen** Wänden eines
 * Raums – Sockelleiste, Paneele (offene Falltüren an der Wand), Deckenleiste (umgedrehte Treppe, Rücken zur Wand),
 * Eckständer (Stamm) in freien Innenecken und Türrahmen neben Innentüren. So zeigen Außenwand-Innenseite und
 * Trennwand dasselbe Wandsystem; Fassadenmauerwerk, Moos und Eckquader verschwinden aus der Innensicht.
 *
 * Eigene, abgegrenzte Schema-Stelle (`ThemeDef.lining`): Regeln je Raumtyp/Geschoss/Höhe, erste passende gewinnt.
 * **Ohne das Feld gibt es keine Innenhaut** – Themes und Test-Themes ohne `lining` bleiben bitgleich. Die
 * mitgelieferten Themes erben das Rezept von `medieval`.
 *
 * Material: `panel` (Standardrolle `lining_panel`, Form Falltür) und `trim` (Standardrolle `lining_trim`: Falltür für
 * Sockel und Türrahmen, Treppe für die Deckenleiste, Stamm für den Eckständer). Zwei Materialien je Raum –
 * ruhig und lesbar (Baustandard: ≤ 3 Materialien je Raum).
 */

const ID = /^[a-z0-9_]+$/;
const RoleRefSchema = z.string().regex(ID, 'Rollenname: klein, z. B. lining_panel');
const IntRangeSchema = z.union([z.number().int(), z.tuple([z.number().int(), z.number().int()])]);

/** Standardrollen der Innenhaut (im Theme `medieval` definiert, von allen mitgelieferten Themes geerbt). */
export const LINING_PANEL_ROLE = 'lining_panel';
export const LINING_TRIM_ROLE = 'lining_trim';

export const LiningWhenSchema = z
  .object({
    /** Raumtypen (Raum der Innenhaut). */
    roomTypes: z.array(z.string().regex(ID)).min(1).optional().describe('Raumtypen, für die die Regel gilt'),
    /** Geschoss (0 = Erdgeschoss, negativ = Keller), Zahl oder [min, max]. */
    storey: IntRangeSchema.optional().describe('Geschoss (0 = Erdgeschoss), Zahl oder [min, max]'),
    /** Lichte Höhe des Raums ≥ / ≤. */
    minHeight: z.number().int().min(1).optional().describe('lichte Höhe mindestens'),
    maxHeight: z.number().int().min(1).optional().describe('lichte Höhe höchstens'),
  })
  .strict();

export const LiningPartSchema = z
  .object({
    role: RoleRefSchema.describe('Theme-Rolle des Bauteils'),
  })
  .strict();

export const LiningRuleSchema = z
  .object({
    when: LiningWhenSchema.optional().describe('Bedingung; ohne = jeder Raum'),
    /** Paneele (offene Falltüren vor der Wand) über der Sockelleiste bis unter die Deckenleiste; `false` = keine. */
    panel: z.union([LiningPartSchema, z.literal(false)]).optional().describe('Paneele: Rolle (Standard lining_panel) oder false = keine Paneele (Tragwerk bleibt sichtbar)'),
    /** Leisten, Ständer und Türrahmen (Standard `lining_trim`). */
    trim: LiningPartSchema.optional().describe('Sockel, Deckenleiste, Eckständer und Türrahmen: Rolle (Standard lining_trim)'),
    skirting: z.boolean().optional().describe('Sockelleiste in der untersten Reihe (Standard true)'),
    crown: z.boolean().optional().describe('Deckenleiste in der obersten Reihe ab lichter Höhe 3 (Standard true)'),
    posts: z.boolean().optional().describe('Eckständer in freien Innenecken (Standard true)'),
    jambs: z.boolean().optional().describe('Türrahmen neben Innentüren im Leisten-Material (Standard true)'),
    /** `true` = in diesem Raum keine Innenhaut (z. B. Rohbau-Keller). */
    off: z.boolean().optional().describe('true = keine Innenhaut in diesen Räumen'),
  })
  .strict();

export const ThemeLiningSchema = z.array(LiningRuleSchema);

export type LiningWhen = z.infer<typeof LiningWhenSchema>;
export type LiningRule = z.infer<typeof LiningRuleSchema>;

/** Rolle + Form eines Bauteils der Innenhaut. */
export interface LiningMaterial {
  readonly role: string;
  readonly shape: string;
}

/** Aufgelöstes Rezept eines Raums: fehlt ein Bauteil, wird es nicht gesetzt. */
export interface LiningRecipe {
  readonly panel?: LiningMaterial;
  readonly skirting?: LiningMaterial;
  readonly crown?: LiningMaterial;
  readonly post?: LiningMaterial;
  readonly jamb?: LiningMaterial;
}

export interface LiningRoom {
  readonly roomType?: string | undefined;
  readonly storey: number;
  readonly height: number;
}

const inRange = (v: number, r: number | readonly [number, number]): boolean => (typeof r === 'number' ? v === r : v >= r[0] && v <= r[1]);

export function liningMatches(when: LiningWhen | undefined, room: LiningRoom): boolean {
  if (when === undefined) return true;
  if (when.roomTypes !== undefined && (room.roomType === undefined || !when.roomTypes.includes(room.roomType))) return false;
  if (when.storey !== undefined && !inRange(room.storey, when.storey)) return false;
  if (when.minHeight !== undefined && room.height < when.minHeight) return false;
  if (when.maxHeight !== undefined && room.height > when.maxHeight) return false;
  return true;
}

/**
 * Rezept eines Raums aus den Regeln des Themes (erste passende Regel gewinnt). `undefined` = keine Innenhaut
 * (Theme ohne `lining`, keine passende Regel oder `off`). Rein.
 */
export function liningRecipeFor(rules: readonly LiningRule[] | undefined, room: LiningRoom): LiningRecipe | undefined {
  const rule = rules?.find((r) => liningMatches(r.when, room));
  if (rule === undefined || rule.off === true) return undefined;
  const trim = rule.trim?.role ?? LINING_TRIM_ROLE;
  const panel = rule.panel === false ? undefined : (rule.panel?.role ?? LINING_PANEL_ROLE);
  const on = (v: boolean | undefined): boolean => v !== false;
  return {
    ...(panel !== undefined ? { panel: { role: panel, shape: 'trapdoor' } } : {}),
    // Sockelleiste nur mit Paneelen: ohne Paneele bleibt die Wand (Tragwerk) ganz sichtbar
    ...(panel !== undefined && on(rule.skirting) ? { skirting: { role: trim, shape: 'trapdoor' } } : {}),
    ...(on(rule.crown) ? { crown: { role: trim, shape: 'stairs' } } : {}),
    ...(on(rule.posts) ? { post: { role: trim, shape: 'log' } } : {}),
    ...(on(rule.jambs) ? { jamb: { role: trim, shape: 'trapdoor' } } : {}),
  };
}

/** Alle Rollen, auf die die Regeln verweisen (mit Fundstelle) – für die Prüfung „Rolle existiert“. */
export function liningRoles(rules: readonly LiningRule[] | undefined): Array<readonly [where: string, role: string]> {
  const out: Array<readonly [string, string]> = [];
  rules?.forEach((r, i) => {
    if (r.off === true) return;
    if (r.panel !== false) out.push([`lining[${i}].panel.role`, r.panel?.role ?? LINING_PANEL_ROLE]);
    out.push([`lining[${i}].trim.role`, r.trim?.role ?? LINING_TRIM_ROLE]);
  });
  return out;
}

/** (Rolle, Form)-Paare, die die Innenhaut eines Themes abfragen kann (Vertragstest: in jeder Zielversion auflösbar). */
export function liningRoleShapes(rules: readonly LiningRule[] | undefined): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (role: string, shape: string): void => {
    m.set(role, (m.get(role) ?? new Set()).add(shape));
  };
  for (const r of rules ?? []) {
    if (r.off === true) continue;
    if (r.panel !== false) add(r.panel?.role ?? LINING_PANEL_ROLE, 'trapdoor');
    const trim = r.trim?.role ?? LINING_TRIM_ROLE;
    for (const s of ['trapdoor', 'stairs', 'log']) add(trim, s);
  }
  return m;
}
