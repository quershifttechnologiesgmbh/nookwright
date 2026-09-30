/**
 * Funktionsgrad (W2-1): Funktionsräume (Farmen, Lager, Schmelzen, Tresore …) ins Raumprogramm eines Bautyps hängen.
 * Rein und deterministisch. Die Zuordnung Gebäudetyp → Räume steht im Katalog (`BuildingTypeDef.functions`), hier nur
 * die Auswahl: je Größe ein Budget, gewichtete Ziehung ohne Zurücklegen aus einer vom Seed abhängigen Reihenfolge
 * (gleiche Reihenfolge für `some` und `rich`, damit `rich` mehr Räume hat, nicht andere).
 *
 * Bestand bleibt bitgleich: ohne `functionLevel` (oder `off`) wird dieses Modul nicht aufgerufen; mit Stufe bekommt der
 * Planer eine Definition, deren Programm um Einträge AM ENDE erweitert ist (Indizes des Bestands bleiben), und der
 * Zufallsstrom der Auswahl ist ein eigener Hash-Seed – nichts im Bestand zieht daraus.
 */
import {
  rangeOf, type BuildingFloorSel, type BuildingFunctionEntry, type BuildingProgramEntry, type BuildingSizeClass, type BuildingTypeDef,
  type FunctionLevel,
} from '@mcda/catalog';
import { Rng, hashSeed } from '@mcda/core';

/** Anteil einer Funktionsanlage an der Etagenfläche, wenn der Eintrag keinen `share` nennt. */
export const DEFAULT_FUNCTION_SHARE = 0.3;
/** Faktor auf `share` bei `rich`, wenn der Eintrag kein `richShare` nennt (größere Anlagen). */
export const RICH_SHARE_FACTOR = 1.3;

/** Anzahl Funktionsräume je Stufe und Größenklasse [min, max] (Katalog kann nur wählen, nicht die Zahl ändern). */
export const FUNCTION_BUDGET: Readonly<Record<Exclude<FunctionLevel, 'off'>, Readonly<Record<BuildingSizeClass, readonly [number, number]>>>> = {
  some: { S: [1, 1], M: [1, 2], L: [2, 2] },
  rich: { S: [2, 2], M: [2, 3], L: [3, 4] },
};

export interface FunctionSelection {
  /** Bautyp mit erweitertem Programm (gleiche Referenz, wenn nichts gewählt wurde). */
  readonly def: BuildingTypeDef;
  /** Gewählte Katalogeinträge, in Programm-Reihenfolge. */
  readonly chosen: readonly BuildingFunctionEntry[];
}

/** Hat der Bautyp eine Funktionstabelle und ein Raumprogramm, das sie aufnehmen kann? */
export function supportsFunctions(def: BuildingTypeDef): boolean {
  return def.massing.generator !== 'fixed' && (def.functions ?? []).length > 0;
}

function floorFits(sel: BuildingFloorSel | undefined, storeys: number, cellar: boolean): boolean {
  const s = sel ?? 'ground';
  if (typeof s === 'number') return s < 0 ? cellar : s < storeys;
  if (Array.isArray(s)) return s[0] < storeys;
  switch (s) {
    case 'upper': return storeys > 1;
    case 'cellar': return cellar;
    default: return true;
  }
}

/** Programm-Eintrag zu einem Katalogeintrag (Anteil je Stufe). */
export function functionProgramEntry(e: BuildingFunctionEntry, level: Exclude<FunctionLevel, 'off'>): BuildingProgramEntry {
  const base = e.share ?? DEFAULT_FUNCTION_SHARE;
  const share = level === 'rich' ? Math.min(1, e.richShare ?? base * RICH_SHARE_FACTOR) : base;
  return {
    room: e.room,
    ...(e.wing === undefined ? { floor: e.floor ?? 'ground' } : {}),
    ...(e.wing !== undefined ? { wing: e.wing } : {}),
    ...(e.part !== undefined ? { part: e.part } : {}),
    share,
    ...(e.minArea !== undefined ? { minArea: e.minArea } : {}),
    ...(e.minFloor !== undefined ? { minFloor: e.minFloor } : {}),
    ...(e.replaces !== undefined ? { replaces: e.replaces } : {}),
    ...(e.near !== undefined ? { near: e.near } : {}),
    ...(e.adjacent !== undefined ? { adjacent: e.adjacent } : {}),
    ...(e.adjacencyWeights !== undefined ? { adjacencyWeights: e.adjacencyWeights } : {}),
  };
}

/**
 * Wählt Funktionsräume und hängt sie an das Programm. `size` ist die gewählte Größenklasse (gleiche Regel wie der
 * Planer), `floors` die verlangte Etagenzahl (falls angegeben).
 */
export function withFunctions(
  def: BuildingTypeDef, level: FunctionLevel, size: BuildingSizeClass | undefined, floors: number | undefined, seed: number, reroll: number,
): FunctionSelection {
  if (level === 'off' || !supportsFunctions(def) || size === undefined || def.sizes?.[size] === undefined) return { def, chosen: [] };
  const sd = def.sizes[size]!;
  const [f1, f2] = rangeOf(sd.floors);
  const storeys = floors !== undefined ? Math.min(f2, Math.max(f1, floors)) : f2;
  const cellar = sd.cellar === true || typeof sd.cellar === 'number';
  const wings = sd.wings ?? [];
  const parts = sd.parts ?? [];
  const [maxW, maxD] = sd.footprint[1];
  const outer = maxW * maxD;
  const inMain = (e: BuildingFunctionEntry): boolean => e.part === undefined && e.wing === undefined;
  const eligible = (e: BuildingFunctionEntry): boolean =>
    (e.sizes === undefined || e.sizes.includes(size))
    && (e.part === undefined || parts.includes(e.part))
    && (e.wing === undefined || wings.includes(e.wing))
    // Hauptbaukörper: Etage und Fläche der Größenklasse; Flügel und Teile prüft der Planer an der echten Fläche
    && (!inMain(e) || (floorFits(e.floor, storeys, cellar) && (e.minFloor === undefined || outer >= e.minFloor)));
  // vom Seed abhängige Reihenfolge aller Kandidaten (gewichtet, ohne Zurücklegen) – unabhängig von der Stufe
  const rng = new Rng(hashSeed(seed, def.id, 'functions', reroll));
  const pool = (def.functions ?? []).filter((e) => eligible(e));
  const order: BuildingFunctionEntry[] = [];
  const rest = [...pool];
  while (rest.length > 0) {
    const e = rng.weighted(rest, (x) => x.weight ?? 1);
    order.push(e);
    rest.splice(rest.indexOf(e), 1);
  }
  const [lo, hi] = FUNCTION_BUDGET[level][size];
  // Budget: Zufall in [lo, hi], aber immer aus demselben Strom (Stufen ziehen gleich viele Zufallszahlen)
  const spread = rng.next();
  const budget = lo + Math.floor(spread * (hi - lo + 1));
  const perPlace = level === 'rich' ? 2 : 1;
  const chosen: BuildingFunctionEntry[] = [];
  const groups = new Set<string>();
  const places = new Map<string, number>();
  for (const e of order) {
    if (chosen.length >= budget) break;
    if ((e.level ?? 'some') === 'rich' && level !== 'rich') continue;
    if (e.group !== undefined && groups.has(e.group)) continue;
    const place = `${e.part ?? ''}|${e.wing ?? ''}|${JSON.stringify(e.floor ?? 'ground')}`;
    if ((places.get(place) ?? 0) >= perPlace) continue;
    chosen.push(e);
    if (e.group !== undefined) groups.add(e.group);
    places.set(place, (places.get(place) ?? 0) + 1);
  }
  if (chosen.length === 0) return { def, chosen };
  const extra = chosen.map((e) => functionProgramEntry(e, level));
  return { def: { ...def, program: [...(def.program ?? []), ...extra] }, chosen };
}
