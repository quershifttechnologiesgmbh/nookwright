import { parseJson5Text } from './json5Text.js';
import { z } from 'zod';
import type { ValidationResult } from './validate.js';

/**
 * Raumtyp = Programm: was in einen Raum gehört (plan/01 §7.3, research/02 §7.16).
 * MVP-Umfang: Pflicht-/Optional-Einträge über Tags, Mengen pro Fläche, Platzierungspräferenzen, Dichte.
 */

const CountSchema = z.union([
  z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  z.object({ perArea: z.number().positive(), min: z.number().int().min(0), max: z.number().int().min(0) }).strict(),
]);

const PlacementPrefSchema = z
  .object({
    zones: z.array(z.enum(['center', 'edge', 'corner', 'corridor', 'niche'])).min(1).optional(),
    doorAffinity: z.enum(['near', 'far', 'neutral']).optional(),
    windowAffinity: z.enum(['near', 'far', 'neutral']).optional(),
  })
  .strict();

/**
 * Anordnungsmuster für mehrere Stück eines Eintrags (research/07 §4 Nr. 7): `row` = Reihe entlang einer Wand,
 * gleiche Drehung, fester Rhythmus mit `gap` Zellen Abstand (Standard 1 – Platz für den Nachttisch dazwischen).
 */
const PatternSchema = z
  .object({ kind: z.literal('row'), gap: z.number().int().min(0).max(4).optional() })
  .strict();

/**
 * Signatur-Anordnung (W3-IN, `plan/spikes/W3IN_raeume.md`): Bezug eines Eintrags auf ein schon gesetztes Möbel mit
 * einem der `tags` – so entstehen die wiedererkennbaren Gruppen echter Bauten: die Arbeitszeile, die am Herd beginnt
 * (Arbeitsplatte neben Herd oder neben Arbeitsplatte, an derselben Wand), der Amboss neben der Esse, das Löschwasser in
 * Reichweite, die Sitzgruppe mit Blick zum Kamin, die Truhe am Fußende des Betts. `maxGap` = freie Zellen zwischen
 * den Grundflächen (0 = anliegend, Standard), `sameWall` = Rücken an derselben Wand wie das Bezugsmöbel, `facing` =
 * Front zum Bezugsmöbel. Weiche Vorgabe mit hohem Gewicht (keine harte Regel: passt es nicht, steht das Möbel
 * trotzdem); Bezugsmöbel setzt der Solver vorher (Signatur zuerst).
 */
const NearSchema = z
  .object({
    tags: z.array(z.string()).min(1),
    maxGap: z.number().int().min(0).max(8).optional(),
    sameWall: z.boolean().optional(),
    facing: z.boolean().optional(),
  })
  .strict();

const EntrySchema = z
  .object({
    tags: z.array(z.string()).min(1),
    count: CountSchema,
    weight: z.number().positive().optional(),
    placement: PlacementPrefSchema.optional(),
    near: NearSchema.optional(),
    /**
     * Signatur-Möbel des Raumtyps (Solver v2): wird zuerst platziert, große Formen haben Vorrang, die
     * Kompaktform ist Rückfall. Fehlt das Feld überall, gilt der erste Pflicht-Eintrag als Signatur.
     */
    signature: z.boolean().optional(),
    /** Funktionszone großer Räume (Id aus `zones` des Raumtyps). */
    zone: z.string().optional(),
    pattern: PatternSchema.optional(),
    /**
     * Insel (W7, 27.09.2026, `plan/spikes/W7F_innen.md`): das Möbel steht frei in der Raummitte (Küchentisch, Vorbilder
     * 10/17), der Hauptweg führt um die Insel herum statt durch die Mitte. Der Solver hält dafür eine mittige Fläche in
     * der Größe der passenden Form frei (auf Bodenhöhe nur für diesen Eintrag) und plant den Weg außen herum; er nimmt
     * das Ergebnis nur, wenn dabei kein Pflichtobjekt fehlt, die Signatur-Kette nicht kürzer wird und der Weg 2 breit
     * bleibt. Nur für Einträge mit höchstens einem Stück sinnvoll. Fehlt es, wie bisher.
     */
    island: z.boolean().optional(),
  })
  .strict();

/**
 * Funktionszone großer Räume (research/02 §7.16): der Solver zerlegt große Räume in Teilflächen und ordnet
 * jede benannte Zone einer Teilfläche zu (`doorAffinity`: nah an / fern von der Haupttür).
 */
const ZoneSchema = z
  .object({ id: z.string().regex(/^[a-z0-9_]+$/), doorAffinity: z.enum(['near', 'far', 'neutral']).optional() })
  .strict();

/**
 * Stimmungs-Ziel für den Licht-Pass (research/02 §7.12): jede begehbare Zelle soll mindestens `minLevel`
 * Blocklicht haben (1 genügt gegen Monster, 7–10 wirkt wohnlich). `prefer` = Tags der Lichtquellen in
 * Wunsch-Reihenfolge (z. B. `candles`, `light_ceiling`, `light_wall`, `light_floor`).
 */
export const RoomLightingSchema = z
  .object({
    minLevel: z.number().int().min(1).max(15).optional(),
    prefer: z.array(z.string()).min(1).optional(),
    /**
     * Licht-Budget (W3-IN, Baustandard I7 „Licht integriert“): höchstens `round(Fläche / cellsPer)` Leuchten im Raum
     * (mindestens `min`, Standard 1; höchstens `max`). Leuchte = Komponente, die nur Licht ist (Laterne, Kerzen,
     * Kronleuchter – `isLightFixture`); Herd, Esse, Kamin zählen nicht. Die Einrichtung setzt Programm- und
     * Andock-Lichter nur im Budget, der Licht-Pass ergänzt Stimmungslicht nur im Budget – Spawn-Schutz
     * (Blocklicht ≥ 1) geht immer vor. Fehlt es, gibt es kein Budget (wie vorher).
     */
    budget: z
      .object({ cellsPer: z.number().positive(), min: z.number().int().min(0).optional(), max: z.number().int().min(1).optional() })
      .strict()
      .optional(),
    /**
     * Bevorzugte Lichtpunkte (W3-IN): Tags der Möbel, auf bzw. über denen Licht steht (Kerzen auf dem Tisch,
     * Hängelaterne über der Tafel). Mit `anchors` stehen Abstell-Lichter nur noch auf diesen Möbeln und höchstens
     * eines je Möbel (keine Laterne auf Theke, Fass oder Truhe); der Licht-Pass wertet Posen an Ankern höher.
     */
    anchors: z.array(z.string()).min(1).optional(),
  })
  .strict();

/**
 * Mittelgang (research/17 §3.1 „Doppelreihe mit Mittelgang“, Y1): ein freier Streifen von der Tür-Seite zur
 * Stirnseite, `width` Zellen breit, mittig im Raum. Auf Laufhöhe steht darin nichts außer Durchlaufbarem (Läufer)
 * und dem Blickpunkt (Signatur ohne `pattern`, Rücken zur Stirnwand, z. B. Altar). Reihen (`pattern: row`) werden
 * zur Doppelreihe links/rechts gespiegelt: Möbel mit `backToWall` an den Seitenwänden (Betten, Stände), frei
 * drehbare quer zur Achse mit Blick zur Stirnseite (Kirchenbänke). `axis`: `auto` (Standard) = lange Raumachse
 * (nahezu quadratisch: Achse der Haupttür), `door` = immer von der Haupttür zur Gegenwand (Kapelle, Thronsaal),
 * `x`/`z` fest. Die Breite wird für gleich breite Seiten um 1 erweitert; passt das nicht, wird bis `minWidth`
 * verengt, in zu schmalen Räumen (Flur Breite 2) ist der ganze Raum Gang.
 */
const AisleSchema = z
  .object({
    axis: z.enum(['x', 'z', 'auto', 'door']).optional(),
    width: z.number().int().min(1).max(8),
    minWidth: z.number().int().min(1).max(8).optional(),
    /**
     * W5 (27.09.2026, Review N6): zusätzlich den Hauptweg von Tür zu Tür bzw. Treppe freihalten (wie Räume ohne Gang,
     * `planPath`) – für Räume, deren Ware an den Wänden steht (Lager); Reihen-Räume (Kaserne, Kapelle) bleiben ohne.
     */
    doorPath: z.boolean().optional(),
  })
  .strict();

/**
 * Freifläche (Y2, research/17 §3.1 „Umlauf mit freier Mitte“): `size` = [entlang der langen Achse, quer] Zellen
 * in der Raummitte (verkleinert, bis ringsum 1 Zelle bleibt). `stairwell`: in keiner Höhe belegt (wie gesperrte
 * Zellen; Wendeltreppe F1), `focal`: nur auf Laufhöhe frei, Deckenleuchten darüber erlaubt. `allow` = Tags, die
 * darin stehen dürfen (Zentralstück: Kristall, Teleskop); Durchlaufbares (Teppich) nur bei `focal`.
 */
const ReserveSchema = z
  .object({
    zone: z.enum(['center']),
    size: z.tuple([z.number().int().min(1).max(16), z.number().int().min(1).max(16)]),
    reason: z.enum(['stairwell', 'focal']),
    allow: z.array(z.string()).min(1).optional(),
  })
  .strict();

/**
 * Stil-Filter (Y9, research/17 §6.2): zu welchen Stilen (Theme-Kette, z. B. `rustic` → [rustic, medieval]) der
 * Raumtyp passt. `require`: mindestens einer davon, `exclude`: keiner davon (Kaserne passt nicht zu Rustic).
 */
const StyleFilterSchema = z
  .object({ require: z.array(z.string()).min(1).optional(), exclude: z.array(z.string()).min(1).optional() })
  .strict();

export const RoomTypeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string(),
    minArea: z.number().int().min(1),
    /**
     * Mindest-Lichthöhe (K3c, Wunsch K3b): darunter passt die Signatur nur in der Kompaktform (Portalraum < 5 →
     * Portal-Schrein). Editor-Hinweis über `roomTypeFitsHeight`; der Solver notiert es in der Qualität.
     */
    minHeight: z.number().int().min(1).max(32).optional(),
    /** Ziel-Anteil belegter Bodenzellen (0–1); steuert, wie viele optionale Objekte kommen. */
    coverage: z.object({ target: z.number().min(0).max(1) }).strict(),
    required: z.array(EntrySchema),
    optional: z.array(EntrySchema),
    lighting: RoomLightingSchema.optional(),
    zones: z.array(ZoneSchema).min(1).optional(),
    aisle: AisleSchema.optional(),
    reserve: ReserveSchema.optional(),
    styleTags: StyleFilterSchema.optional(),
  })
  .strict();

export type RoomTypeCount = z.infer<typeof CountSchema>;
export type RoomTypePattern = z.infer<typeof PatternSchema>;
export type RoomZoneDef = z.infer<typeof ZoneSchema>;
export type PlacementPref = z.infer<typeof PlacementPrefSchema>;
export type RoomTypeEntry = z.infer<typeof EntrySchema>;
export type RoomTypeNear = z.infer<typeof NearSchema>;
export type RoomLighting = z.infer<typeof RoomLightingSchema>;
export type RoomLightBudget = NonNullable<RoomLighting['budget']>;

/**
 * Leuchten, die ein Raum der Fläche `area` laut Licht-Budget haben darf (`Infinity` ohne Budget). Einrichtung und
 * Licht-Pass rechnen mit derselben Zahl.
 */
export function lightBudget(lighting: RoomLighting | undefined, area: number): number {
  const b = lighting?.budget;
  if (b === undefined) return Infinity;
  const n = Math.round(area / b.cellsPer);
  return Math.min(b.max ?? Infinity, Math.max(b.min ?? 1, n));
}

/**
 * Leuchte im Sinne des Licht-Budgets: eine Komponente, die nur Licht ist – Kategorie `light` oder Deko mit Funktion
 * `light` (Kerzen). Möbel mit eingebautem Feuer (Herd, Esse, Kamin) sind keine Leuchten.
 */
export function isLightFixture(def: { readonly category: string; readonly functionTags?: readonly string[] | undefined }): boolean {
  return def.category === 'light' || ((def.category === 'decor' || def.category === 'attachment') && def.functionTags?.includes('light') === true);
}
export type RoomAisleDef = z.infer<typeof AisleSchema>;
export type RoomReserveDef = z.infer<typeof ReserveSchema>;
export type RoomStyleFilter = z.infer<typeof StyleFilterSchema>;
export type RoomTypeDef = z.infer<typeof RoomTypeSchema>;

/**
 * Passt der Raumtyp zu den Stilen eines Themes (`styles` = Theme-Kette, spezifisch zuerst)? Ohne Filter oder
 * ohne Stile immer. Für die Raumtyp-Auswahl im Editor und als Solver-Warnung.
 */
export function roomTypeFitsStyles(rt: Pick<RoomTypeDef, 'styleTags'>, styles: readonly string[] | undefined): boolean {
  const f = rt.styleTags;
  if (f === undefined || styles === undefined || styles.length === 0) return true;
  if (f.require !== undefined && !f.require.some((s) => styles.includes(s))) return false;
  return f.exclude === undefined || !f.exclude.some((s) => styles.includes(s));
}

/** Reicht die lichte Höhe für den Raumtyp (`minHeight`)? Ohne Angabe immer. */
export function roomTypeFitsHeight(rt: Pick<RoomTypeDef, 'minHeight'>, height: number): boolean {
  return rt.minHeight === undefined || height >= rt.minHeight;
}

/** Wertet eine Mengenangabe für eine Raumfläche aus → [min, max]. */
export function evalCount(count: RoomTypeCount, area: number): [number, number] {
  if (Array.isArray(count)) return [count[0], count[1]];
  const n = Math.min(count.max, Math.max(count.min, Math.round(area / count.perArea)));
  return [n, n];
}

export function validateRoomTypeDef(input: unknown): ValidationResult<RoomTypeDef> {
  const parsed = RoomTypeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(wurzel)'}: ${i.message}`), warnings: [] };
  }
  const errors: string[] = [];
  for (const [i, e] of [...parsed.data.required, ...parsed.data.optional].entries()) {
    if (Array.isArray(e.count) && e.count[0] > e.count[1]) errors.push(`Eintrag ${i}: count min > max`);
    if (!Array.isArray(e.count) && e.count.min > e.count.max) errors.push(`Eintrag ${i}: count.min > count.max`);
    if (e.zone !== undefined && !(parsed.data.zones ?? []).some((z) => z.id === e.zone)) errors.push(`Eintrag ${i}: unbekannte Zone '${e.zone}'`);
    // W3-IN: das Bezugsmöbel einer Signatur-Anordnung muss im Programm vorkommen (sonst wirkt der Bezug nie)
    if (e.near !== undefined && !e.near.tags.some((t) => [...parsed.data.required, ...parsed.data.optional].some((o) => o.tags.includes(t)))) {
      errors.push(`Eintrag ${i}: near.tags ${e.near.tags.join('|')} stehen in keinem Eintrag`);
    }
  }
  // W7: höchstens eine Insel je Raumtyp, mit höchstens einem Stück (die Mitte gibt es einmal)
  const islands = [...parsed.data.required, ...parsed.data.optional].filter((e) => e.island === true);
  if (islands.length > 1) errors.push(`${parsed.data.id}: mehr als ein Eintrag mit island`);
  for (const e of islands) if ((Array.isArray(e.count) ? e.count[1] : e.count.max) > 1) errors.push(`${parsed.data.id}: island-Eintrag ${e.tags.join('|')} mit mehr als einem Stück`);
  const { aisle, reserve } = parsed.data;
  if (aisle?.minWidth !== undefined && aisle.minWidth > aisle.width) errors.push(`aisle: minWidth ${aisle.minWidth} > width ${aisle.width}`);
  if (reserve?.allow !== undefined) {
    for (const t of reserve.allow) if (![...parsed.data.required, ...parsed.data.optional].some((e) => e.tags.includes(t))) errors.push(`reserve.allow: Tag '${t}' steht in keinem Eintrag`);
  }
  if (parsed.data.required.length === 0) errors.push(`${parsed.data.id}: Raumtyp ohne Pflichtobjekt – genau das kritisieren DA-Nutzer („Schlafzimmer ohne Bett“)`);
  return errors.length > 0 ? { ok: false, errors, warnings: [] } : { ok: true, value: parsed.data, warnings: [] };
}

export function parseRoomTypeDef(text: string, source = '<text>'): ValidationResult<RoomTypeDef> {
  let raw: unknown;
  try {
    raw = parseJson5Text(text);
  } catch (e) {
    return { ok: false, errors: [`${source}: JSON5-Fehler: ${(e as Error).message}`], warnings: [] };
  }
  const r = validateRoomTypeDef(raw);
  return r.ok ? r : { ...r, errors: r.errors.map((m) => `${source}: ${m}`) };
}
