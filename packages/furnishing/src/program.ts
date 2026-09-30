import { evalCount, type PlacementPref, type RoomTypeDef, type RoomTypeEntry, type RoomTypeNear, type RoomTypePattern } from '@mcda/catalog';
import type { Rng } from '@mcda/core';

/** Ein Objekt des Raumprogramms (research/02 §7.5). */
export interface ProgramItem {
  readonly tags: readonly string[];
  readonly required: boolean;
  readonly pref: PlacementPref;
  /** Index des Raumtyp-Eintrags: Pflicht `required[i]` → i, optional `optional[j]` → required.length + j. */
  readonly entry: number;
  /** Signatur-Möbel: zuerst platzieren, große Formen vor der Kompaktform. */
  readonly signature: boolean;
  /** Benannte Funktionszone (Raumtyp `zones`). */
  readonly zone?: string;
  readonly pattern?: RoomTypePattern;
  /** Signatur-Anordnung (W3-IN): Bezug auf ein schon gesetztes Möbel (Arbeitszeile am Herd, Amboss an der Esse). */
  readonly near?: RoomTypeNear;
  /** Optionales Objekt über dem Mindestbestand (vom Flächenbudget gewürfelt): kommt nach den Mindestmengen. */
  readonly extra?: boolean;
  /**
   * W8-E: Pflicht-Stück über der Mindestzahl seines Eintrags (`count[0]` bzw. `count.min`; bei `perArea` ist die
   * Flächenzahl der Wunsch, nicht die Pflicht). Der Solver versucht es wie jedes Pflicht-Stück; passt es am Ende nicht,
   * ist das ein Hinweis, kein fehlendes Pflichtobjekt.
   */
  readonly aboveMin?: boolean;
}

/**
 * Signatur-Einträge: explizit über `signature: true`; fehlt das Feld überall, gilt der erste Pflicht-Eintrag
 * (Konvention der Katalog-Raumtypen: die Signatur steht vorn).
 */
export function signatureEntries(rt: RoomTypeDef): ReadonlySet<number> {
  const all = [...rt.required, ...rt.optional];
  if (all.some((e) => e.signature !== undefined)) return new Set(all.flatMap((e, i) => (e.signature === true ? [i] : [])));
  return new Set(rt.required.length > 0 ? [0] : []);
}

/**
 * Deko-Budget eines Raums (W2, Baustandard I6 „Funktion vor Menge“): höchstens `max` Programm-Objekte aus reinen
 * Deko-Einträgen (`isDecor`), Mindestmengen eingeschlossen. Fehlt es, gilt kein Budget.
 */
export interface DecorBudget {
  readonly max: number;
  readonly isDecor: (e: RoomTypeEntry) => boolean;
}

/**
 * Raumprogramm würfeln. `costOf` (V3, optional): Anteil eines Eintrags am Flächenbudget – Wand- und
 * Deckenobjekte belegen keinen Boden und zählen nur halb, damit Wand und Decke gefüllt werden, ohne dass der
 * Boden leer bleibt (Standard: jeder Eintrag zählt 1).
 */
export function buildProgram(
  rt: RoomTypeDef, area: number, rng: Rng, density: number, costOf: (e: RoomTypeEntry) => number = () => 1, decor?: DecorBudget,
): ProgramItem[] {
  const signature = signatureEntries(rt);
  const nReq = rt.required.length;
  const item = (e: RoomTypeEntry, entry: number, required: boolean, extra = false, aboveMin = false): ProgramItem => ({
    tags: e.tags,
    required,
    pref: e.placement ?? {},
    entry,
    signature: signature.has(entry),
    ...(e.zone !== undefined ? { zone: e.zone } : {}),
    ...(e.pattern !== undefined ? { pattern: e.pattern } : {}),
    ...(e.near !== undefined ? { near: e.near } : {}),
    ...(extra ? { extra } : {}),
    ...(aboveMin ? { aboveMin } : {}),
  });
  const items: ProgramItem[] = [];
  rt.required.forEach((e, i) => {
    const [min, max] = evalCount(e.count, area);
    const n = rng.int(min, max);
    const least = Array.isArray(e.count) ? e.count[0] : e.count.min;
    for (let k = 0; k < n; k++) items.push(item(e, i, true, false, k >= least));
  });
  // Optionale: jeweils min Stück, dann gewichtet bis zum Flächenbudget (grob: 2 Zellen pro Objekt).
  const budget = Math.round(rt.coverage.target * density * area * 0.5);
  const counts = new Map<number, number>();
  let used = rt.required.reduce((t, e) => t + costOf(e) * items.filter((it) => it.tags === e.tags).length, 0);
  // W2 (I6): Deko-Budget – reine Deko-Einträge (Bilder, Banner, Topfpflanzen …) nur bis `decor.max`, auch die
  // Mindestmengen; Funktionsmöbel und Licht zählen nicht dagegen
  let decorLeft = decor?.max ?? Infinity;
  const isDecor = (e: RoomTypeEntry): boolean => decor?.isDecor(e) === true;
  rt.optional.forEach((e, i) => {
    let [min] = evalCount(e.count, area);
    if (isDecor(e)) {
      min = Math.min(min, Math.max(0, decorLeft));
      decorLeft -= min;
    }
    for (let k = 0; k < min; k++) items.push(item(e, nReq + i, false));
    used += min * costOf(e);
    counts.set(i, min);
  });
  let guard = 0;
  while (used < budget && guard++ < 200) {
    const open = rt.optional.map((e, i) => ({ e, i }))
      .filter(({ e, i }) => (counts.get(i) ?? 0) < evalCount(e.count, area)[1] && (!isDecor(e) || decorLeft > 0));
    if (open.length === 0) break;
    const { e, i } = rng.weighted(open, (x) => x.e.weight ?? 1);
    if (isDecor(e)) decorLeft--;
    counts.set(i, (counts.get(i) ?? 0) + 1);
    used += costOf(e);
    items.push(item(e, nReq + i, false, true));
  }
  // Pflicht zuerst, sonst stabile Reihenfolge (die Platzier-Reihenfolge legt `orderProgram` fest)
  return [...items.filter((i) => i.required), ...items.filter((i) => !i.required)];
}

/** Kennzahlen eines Programm-Eintrags für die Reihenfolge. */
export interface EntryStats {
  /** Gültige Posen aller Formen im leeren Raum (Domäne im CSP-Sinn; klein = stark eingeschränkt). */
  readonly domain: number;
  /** Größte Grundfläche (Zellen) über alle Formen. */
  readonly footprint: number;
}

/**
 * „Most Constrained First“ (research/02 §7.5): Pflicht vor Optional (Mindestmengen vor dem Rest); Signatur
 * zuerst; dann kleinste Domäne, dann größte Grundfläche; sonst Programm-Reihenfolge. Liefert Indizes in `program`.
 */
export function orderProgram(program: readonly ProgramItem[], stats: (entry: number) => EntryStats): number[] {
  const rank = (i: number): number[] => {
    const it = program[i]!;
    const s = stats(it.entry);
    return [it.required ? 0 : 1, it.extra === true ? 1 : 0, it.signature ? 0 : 1, s.domain === 0 ? Infinity : s.domain, -s.footprint, i];
  };
  return program
    .map((_, i) => ({ i, r: rank(i) }))
    .sort((a, b) => {
      for (let k = 0; k < a.r.length; k++) if (a.r[k] !== b.r[k]) return a.r[k]! - b.r[k]!;
      return 0;
    })
    .map((x) => x.i);
}
