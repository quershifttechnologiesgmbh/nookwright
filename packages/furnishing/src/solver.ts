import { isLightFixture, lightBudget, roomTypeFitsHeight, roomTypeFitsStyles, type Catalog, type ComponentDef, type RoomTypeDef, type RoomTypeEntry } from '@mcda/catalog';
import { CellSet, Rng, cellKey, hashSeed, resolveRelDir, type Cell, type HorizontalDir, type Pose } from '@mcda/core';
import { analyzeRoom, type IslandPlan, type RoomAnalysis } from './analyze.js';
import { adaptVariant, expandComponent, fitsRoomHeight, pickFittingVariant, pickVariant, type ExpandedComponent } from './expand.js';
import type { RoomGeometry } from './geometry.js';
import { LAYOUT_RELAX_LEVELS, acrossOf, alongOf, planLayout, type AislePlan, type RoomLayout } from './layout.js';
import { T_WATER, isJobStation, jobBlocksOf, traitsOf } from './mechanics.js';
import type { PlacedComponent } from './place.js';
import { buildProgram, orderProgram, type EntryStats, type ProgramItem } from './program.js';
import { baseInfos, prefSatisfaction, roomQuality, roomWalkways, verticality, walkwayPart, zoneWeight, type QualityPart, type RoomQuality } from './quality.js';
import { Occupancy, cheapValid, connectivityOK, countPoses, enumeratePoses, firstPose, useCellsOf, wallLevels } from './rules.js';
import { consistencyKey, mountFits, socketGroups, socketPlacement, socketValid } from './sockets.js';
import { assignZones, planZones, type FunctionZone } from './zones.js';
import { mirrorShare, moodWeights, solverMood, type SolverMood } from './mood.js';
import type { MoodVector } from '@mcda/core';
import { planIsland, planPath, type IslandForm } from './path.js';

/**
 * Solver v2 – RGHP-A ohne Annealing (research/02 §7): Raum analysieren → Programm → Funktionszonen (große
 * Räume) → Reihenfolge „Most Constrained First“ (Pflicht, Signatur, kleinste Domäne, größte Grundfläche) →
 * je Objekt alle Formen × Posen aufzählen → harte Regeln → weiche Bewertung → rang-gewichtet aus den besten k →
 * Sockets (adjacent, surface, face, hang; Blickrichtung, Paare, Konsistenz) → Konnektivität. Scheitert ein
 * Pflichtobjekt, stellt begrenztes Backtracking die zuletzt platzierten Objekte um (§7.6). Signatur-Möbel
 * versuchen große Formen zuerst, die Kompaktform ist Rückfall. Ergebnis mit Qualitätswert (§7.9).
 * Nachträgliches Ergänzen (Licht-Pass im Anwendungsdienst): `RoomPlanner` mit denselben harten Regeln.
 * V3 (Raumhöhe nutzen): Stapel-Sockets `above`/`below` (Truhe auf Truhe, Aufsatzregal auf Kommode) mit
 * Stapelketten, Wand-Montage in mehreren Höhen (`wallHeights`, bevorzugt über niedrigen Möbeln), Formen nach
 * lichter Höhe (`minRoomHeight`/`maxRoomHeight`) und gedehnte Formen (`stretch`: Kettenlänge, Regal bis zur
 * Decke), Deckenobjekte verteilt über die Zonen, Regel `containerOpen`, Qualitätsmaß „Vertikalität“.
 * K3c (research/17 §7.3/§7.4): Raumtyp-Layout `aisle` (Mittelgang, Reihen als gespiegelte Doppelreihe) und
 * `reserve` (freie Mitte) mit Lockerung, wenn ein Pflichtobjekt nicht passt; Stil-Filter (`styleTags`) und
 * Signatur-Tausch je Theme (`styles`); `distinctJobBlocks` (Villager-Stände); Nachweis `infiniteWater` als Teilwert;
 * Mindesthöhe (`minHeight`) als Qualitäts-Notiz.
 * Noch nicht enthalten: Annealing (Politur), Relationen zwischen Einträgen, Sockets `inside`/`overlay`.
 */

/** Ergebnis-Eintrag; strukturgleich mit `PlacementDraft` aus dem Bauplan-Kontext. */
export interface FurnishedPlacement {
  readonly key: string;
  readonly componentId: string;
  readonly variantId?: string;
  readonly pose: PlacedComponent['pose'];
  readonly seed: number;
  readonly parentKey?: string;
  readonly socketId?: string;
}

export interface FurnishOptions {
  readonly seed: number;
  readonly dataVersion: number;
  /** Bereits feste Komponenten (gesperrt/manuell) – Hindernisse, die respektiert werden. */
  readonly fixed?: readonly PlacedComponent[];
  /** Dichte-Regler 0–2 (1 = Raumtyp-Standard). */
  readonly density?: number;
  /** Aus wie vielen besten Kandidaten gewürfelt wird. */
  readonly topK?: number;
  /**
   * Stile des Themes, spezifisch zuerst (Theme-Kette rückwärts, z. B. [nordic, medieval]); Y9: die Signatur nimmt
   * nur Formen des spezifischsten Stils, zu dem es Formen gibt (Signatur-Tausch), und der Raumtyp-Filter
   * `styleTags` meldet unpassende Raumtypen. Fehlt es, ist alles wie vorher.
   */
  readonly styles?: readonly string[];
  /**
   * P07 (Auftrag `PO_qualitaet_abschluss.md`): Mittelgang des Raumtyps ist **verbindlich**. Ohne die Option darf
   * der Solver bei Platzmangel wie bisher auf `minWidth` lockern und das Layout danach ganz aufgeben; mit der
   * Option bleibt der Gang mindestens auf `aisle.minWidth` stehen. Passt ein Pflichtobjekt dann nicht mehr in den
   * Raum, meldet das Ergebnis das ausdrücklich („Mittelgang verbindlich …"), statt den Gang still zu opfern.
   * Fehlt die Option, ist das Ergebnis bitgleich zu vorher (Standard `false`).
   */
  readonly minAisle?: boolean;
  /**
   * W7-G (U7, „Nachbarn behalten Möbel“): die bisherige Einrichtung des Raums als Vorgabe. Jedes Programm-Objekt nimmt
   * zuerst eine bisherige Lage derselben Form (Komponente + Variante), wenn sie mit allen harten Regeln noch gilt
   * (Programm-Reihenfolge, Vorgaben in ihrer Reihenfolge); aufgesetzte Teile bleiben an ihrem Andockpunkt. Was nicht mehr
   * passt oder neu ins Programm kommt, setzt der Solver danach wie gewohnt. Fehlt die Option oder ist sie leer, ist
   * das Ergebnis bitgleich zu vorher.
   */
  readonly keep?: readonly KeepHint[];
  /**
   * W7-G (U7): Schlüssel der festen Komponenten (gleiche Reihenfolge wie `fixed`, z. B. Platzierungs-IDs). Nur mit
   * `keep`: Vorgaben, deren `parentKey` auf ein festes Möbel zeigt (Hocker am gesperrten Tisch), bleiben an ihrem
   * Andockpunkt; das Ergebnis verweist dann mit `parentKey` auf diesen Schlüssel.
   */
  readonly fixedKeys?: readonly string[];
  /**
   * W8-A (plan/spikes/W8A_forward_check.md): Forward Checking – nach jeder Wahl eines Kandidaten prüft der Solver, ob
   * jedes noch offene Pflichtobjekt, das vorher eine gültige Pose hatte, weiterhin mindestens eine hat. Nimmt der
   * Kandidat einem die letzte, wird er verworfen und der nächste aus dem Auswahlfenster gewürfelt. Ohne Verwerfung ist
   * der Lauf bitgleich zu vorher (gleiche Würfe). Standard an; `false` = Stand vor W8-A.
   */
  readonly forwardCheck?: boolean;
  /**
   * W8-A (Experiment, Standard `static`): Reihenfolge der Programm-Objekte. `static` = kleinste Domäne im leeren Raum
   * (wie bisher); `dynamic` = nach jeder Platzierung neu nach der aktuellen Domäne (dynamisches MRV); `entropy` bzw.
   * `dynamic-entropy` = statt der Posenzahl die Entropie über Pose × Variantengewicht (WFC_ausschoepfung §3.4).
   */
  readonly order?: 'static' | 'dynamic' | 'entropy' | 'dynamic-entropy';
  /**
   * feat/theme-moods: Stimmungsvektor (`@mcda/core` `MoodVector`, Modul `mood.ts`) – multipliziert nur weiche Größen
   * (Gewichte `W`, Variantengewichte, Stil-Vorliebe, Deko-Budget, Dichte). Harte Regeln bleiben unberührt. Fehlt die
   * Option, ist das Ergebnis bitgleich zu vorher.
   */
  readonly mood?: MoodVector;
  /**
   * Additiv (Erklärvideo, 27.09.2026): Beobachter der Zwischenstände (Reihenfolge, Posen mit Wertung, Auswahl, Setzen,
   * Entfernen, Backtracking). Nur lesend und synchron – die Objekte im Ereignis (`occ`, `analysis`) sind der laufende
   * Zustand. Fehlt die Option, ist alles wie vorher; mit ihr ist das Ergebnis bitgleich (Test `trace.test.ts`).
   */
  readonly trace?: (event: FurnishTraceEvent) => void;
}

/** Ein bewerteter Kandidat im Ereignis `candidates` (Wertung = soft + bonus + jitter, absteigend sortiert). */
export interface TraceCandidate {
  readonly componentId: string;
  readonly variantId?: string;
  readonly placed: PlacedComponent;
  readonly score: number;
  /** Weiche Bewertung der Pose (`scorer`). */
  readonly soft: number;
  /** Form-Bonus (Signatur: Größe, Vielfalt, Reihen-Form), sonst 0. */
  readonly bonus: number;
  /** Seed-Rauschen 0 … 0,05 (bricht Gleichstände). */
  readonly jitter: number;
}

/** Ereignisse für `FurnishOptions.trace` (Reihenfolge wie im Lauf). */
export type FurnishTraceEvent =
  | { readonly type: 'run-start'; readonly analysis: RoomAnalysis; readonly layout?: RoomLayout; readonly notes: readonly string[] }
  | {
    readonly type: 'order'; readonly program: readonly ProgramItem[]; readonly order: readonly number[]; readonly stats: readonly EntryStats[];
    readonly zones: readonly FunctionZone[];
  }
  | { readonly type: 'item'; readonly idx: number; readonly compactOnly: boolean }
  | { readonly type: 'item-end'; readonly idx: number; readonly ok: boolean }
  | {
    readonly type: 'candidates'; readonly idx: number; readonly candidates: readonly TraceCandidate[]; readonly top: readonly number[];
    readonly disconnected: readonly number[]; readonly analysis: RoomAnalysis; readonly occ: Occupancy;
  }
  | { readonly type: 'try'; readonly idx: number; readonly candidate: number; readonly key: string; readonly ok: boolean }
  | {
    readonly type: 'commit'; readonly key: string; readonly componentId: string; readonly variantId?: string; readonly placed: PlacedComponent;
    readonly item?: number; readonly parentKey?: string; readonly socketId?: string; readonly occ: Occupancy;
  }
  | { readonly type: 'remove'; readonly keys: readonly string[] }
  | { readonly type: 'restore'; readonly keys: readonly string[] }
  | { readonly type: 'repair'; readonly idx: number; readonly victims: readonly string[] }
  | { readonly type: 'repair-try'; readonly idx: number; readonly victim: string; readonly how: string; readonly ok: boolean }
  | { readonly type: 'run-end'; readonly result: FurnishResult }
  | { readonly type: 'chosen'; readonly result: FurnishResult };

/**
 * W8-A: Zähler für Messungen (`spikes/w8/w8a/measure.mts`) – Lösungsläufe, Backtracking-Aufrufe und -Versuche,
 * vom Forward Checking verworfene Kandidaten und Rückfälle ohne Forward Checking. Ohne Einfluss auf das Ergebnis.
 */
export const SOLVER_COUNTERS = { runs: 0, repairs: 0, repairTries: 0, fcRejects: 0, fcFallbacks: 0 };

/** Bisherige Platzierung als Vorgabe (`FurnishOptions.keep`); `key`/`parentKey` verbinden aufgesetzte Teile. */
export interface KeepHint {
  readonly key: string;
  readonly componentId: string;
  readonly variantId?: string;
  readonly pose: Pose;
  readonly parentKey?: string;
  readonly socketId?: string;
}

export interface FurnishResult {
  readonly placements: readonly FurnishedPlacement[];
  readonly placed: readonly PlacedComponent[];
  readonly warnings: readonly string[];
  readonly analysis: RoomAnalysis;
  /** Qualitätswert 0–1 (0,65 · Mittel + 0,35 · Minimum der Teilwerte) mit Begründungen für die UI. */
  readonly quality: RoomQuality;
  /** Funktionszonen (genau eine: Raum nicht zerlegt). */
  readonly zones: readonly FunctionZone[];
  /** Raumtyp-Layout (Mittelgang, Freifläche), wie es angewendet wurde (evtl. gelockert); fehlt ohne `aisle`/`reserve`. */
  readonly layout?: RoomLayout;
}

/** Gewichte der weichen Bewertung (Einheiten wie im Solver v1: Zonenklasse 2, Tür 1,5, Wand 1). */
const W_BASE = {
  /**
   * Signatur: Größe relativ zur größten Form der Familie (Grundfläche, etwas Höhe) → große Formen gewinnen;
   * `variety` würfelt je Form einen Bonus, damit ähnlich große Formen abwechseln.
   */
  size: 6,
  variety: 1.2,
  /** Funktionszone: Anteil der Grundzellen in der zugewiesenen Zone. */
  zone: 1.5,
  /** Nähe zum Anker der Zone (Gruppe statt Raster). */
  anchor: 1,
  /** Reihe: gleiche Linie und genau der Rhythmus-Abstand. */
  row: 3,
  rowLine: 1,
  /** Freie Andockpunkte (Nachttische, Hocker) rund um ein Elternteil. */
  sockets: 0.5,
  /** Wandobjekt über einem niedrigen Möbel (Bord über der Kommode, Werkzeug über der Werkbank), V3: halb schon bei
   * teilweiser Überdeckung, voll, wenn die ganze Unterkante über Möbeln liegt. */
  overFurniture: 2,
  /** Wunsch-Reihenfolge der Wandhöhen (`wallHeights`: die erste bekommt den vollen Bonus), V3. */
  wallLevel: 1,
  /** Mittelgang (K3c): Reihen-Stück auf der zugeteilten Seite, Blick (Bank zur Stirnseite, Bett zum Gang), Start an der Stirnseite. */
  aisleSide: 2,
  aisleFacing: 1.5,
  aisleHead: 1,
  /** Signatur-Reihe am Gang: gleiche Form wie das letzte Stück (größer als der Vielfalts-Wurf, kleiner als die Größe). */
  aisleForm: 2,
  /** Blickpunkt auf der Gang-Achse (Altar), Läufer im Gang, Zentralstück in der Freifläche. */
  focal: 2,
  /** Villager-Stände: gleicher Arbeitsblock wie ein schon gesetzter Stand (`distinctJobBlocks`). */
  distinctJob: 3,
  /** Deckenobjekte nicht zusammenklumpen (Abstand < 4 zu einem anderen Deckenobjekt), V3. */
  ceilingSpread: 0.4,
  /** Formwahl: höhere Formen (Anteil an der lichten Höhe) werden öfter zuerst probiert, V3. */
  vertical: 0.6,
  /**
   * Signatur-Anordnung (W3-IN, `near`): am Bezugsmöbel (voll bei anliegend, linear weniger bis `maxGap`), an derselben
   * Wand (Arbeitszeile), mit Blick zum Bezugsmöbel (Sitzgruppe zum Kamin). Größer als Reihe und Zone: die Gruppe ist
   * das, woran man den Raum erkennt.
   */
  near: 4,
  nearWall: 1.5,
  nearFacing: 1.5,
  /** Kopf einer Zeile (Herd, Theke): Wandstück, auf dem die anschließende Zeile Platz hat. */
  lineRun: 3,
  /** W7: Insel-Möbel (Küchentisch) auf der mittigen Insel – Anteil der Inselzellen, die es deckt. */
  island: 8,
} as const;

/**
 * Aktive Gewichte: `W_BASE`, mit Stimmung (feat/theme-moods) für die Dauer eines `furnishRoom`-Aufrufs skaliert. Der
 * Solver ist synchron; `furnishRoom` setzt beides und stellt es im `finally` zurück (ohne Stimmung: dasselbe Objekt).
 */
let W: { readonly [K in keyof typeof W_BASE]: number } = W_BASE;
let MOOD: SolverMood | undefined;

/** Katalog-Gewicht einer Variante (ohne Variante 1). */
const variantWeight = (def: ComponentDef, base: string | undefined): number => (base === undefined ? 1 : (def.variants?.find((v) => v.id === base)?.weight ?? 1));

/** Top-k-Auswahl: nur Kandidaten, deren Wertung höchstens so weit unter dem besten gültigen liegt. */
const SCORE_WINDOW = 1;
/** Backtracking: so viele zuletzt platzierte Objekte werden als Opfer probiert (research/02 §7.6). */
const BACKTRACK_VICTIMS = 6;
/**
 * Tiefe der Socket-Füllung: nur Kinder. Abstellflächen der Kinder (Nachttisch) bleiben frei für den Licht-Pass
 * (Kerzen, `supplementFurnishing`); Enkel wären eine Stufe tiefer möglich (SOCKET_DEPTH = 2).
 */
const SOCKET_DEPTH = 1;
/** Anteil eines reinen Wand-/Deckenobjekts am Flächenbudget des Raumprogramms (Bodenobjekt = 1), V3. */
const VERTICAL_COST = 0.5;
/** Stapelketten (`above`/`below`, Truhe auf Truhe auf Truhe): höchstens so viele Ebenen über dem Programm-Objekt. */
const MAX_STACK = 6;
/**
 * Deko-Budget (W2, Baustandard I6 „Funktion vor Menge“, Nutzer: „sehr wild“): reine Deko-Objekte des Programms
 * `1 + Fläche / DECOR_CELLS`, insgesamt – mit Deko-Kindern auf Tischen, Borden, Theken – `2 + Fläche /
 * DECOR_TOTAL_CELLS` (40 Zellen: 3 bzw. 5; 150 Zellen: 8 bzw. 12). Große Säle bekommen so nicht linear mehr Kleinkram. Gemessen vorher: 1,3 Deko-Objekte je 10 Zellen, 57 % der
 * Platzierungen Deko/Licht, Kleinkram-Häufungen in 133 von 152 Räumen.
 */
const DECOR_CELLS = 20;
const DECOR_TOTAL_CELLS = 14;
/** Deko-Kinder: dieselbe Komponente höchstens so oft je Raum; Essen (Kuchen) höchstens einmal. */
const DECOR_CHILD_REPEAT = 3;
const FOOD_CHILD_REPEAT = 1;

/** Reine Deko: Katalog-Kategorie `decor` oder `attachment` (Bilder, Banner, Borde, Topfpflanzen, Kerzen …). */
export const isDecorDef = (def: Pick<ComponentDef, 'category'>): boolean => def.category === 'decor' || def.category === 'attachment';

interface Option {
  readonly def: ComponentDef;
  /** Varianten-ID der Platzierung (bei gedehnten Formen mit Länge, zur lichten Höhe passend). */
  readonly variantId: string | undefined;
  /** Varianten-ID aus dem Katalog (ohne Dehnung). */
  readonly base: string | undefined;
  readonly exp: ExpandedComponent;
  /** Grundfläche der Bounding-Box (Zellen). */
  readonly footprint: number;
}

interface Entry {
  readonly key: string;
  readonly def: ComponentDef;
  readonly variantId: string | undefined;
  readonly placed: PlacedComponent;
  readonly parentKey?: string;
  readonly socketId?: string;
  /** Programm-Index (nur Objekte aus dem Programm, nicht Kinder). */
  readonly item?: number;
}

interface Candidate {
  readonly opt: Option;
  readonly placed: PlacedComponent;
  readonly score: number;
  /** Nur mit `trace`: Teile der Wertung. */
  readonly parts?: { readonly soft: number; readonly bonus: number; readonly jitter: number };
}

export function furnishRoom(geom: RoomGeometry, rt: RoomTypeDef, catalog: Catalog, opts: FurnishOptions): FurnishResult {
  const res = furnishMooded(geom, rt, catalog, opts);
  opts.trace?.({ type: 'chosen', result: res });
  return res;
}

function furnishMooded(geom: RoomGeometry, rt: RoomTypeDef, catalog: Catalog, opts: FurnishOptions): FurnishResult {
  if (opts.mood === undefined) return furnishPlain(geom, rt, catalog, opts);
  // Nicht re-entrant: `W`/`MOOD` sind Modulzustand für die Dauer dieses (synchronen) Aufrufs. Katalog-Callbacks dürfen
  // deshalb nicht selbst einrichten (ein innerer `furnishRoom` erbte bzw. löschte die Stimmung). Später: Feld von `Solve`.
  try {
    MOOD = solverMood(opts.mood);
    W = moodWeights(W_BASE, MOOD);
    return furnishPlain(geom, rt, catalog, opts);
  } finally {
    W = W_BASE;
    MOOD = undefined;
  }
}

function furnishPlain(geom: RoomGeometry, rt: RoomTypeDef, catalog: Catalog, opts: FurnishOptions): FurnishResult {
  const analysed = analyzeRoom(geom);
  // W2 (26.09.2026, freie Sicht durchs Fenster): erst mit ganzer Sichtachse (Tiefe 1…3); passt ein Pflichtobjekt so
  // nicht (auch nicht mit gelockertem Weg/Layout), nur die Zelle direkt hinter der Scheibe, dann ohne (Pflicht vor Sicht)
  if ((analysed.windowView?.size ?? 0) === 0) return soften(furnishAnalysed(analysed, rt, catalog, opts, []));
  const levels: ReadonlyArray<readonly [CellSet, readonly string[]]> = [
    [analysed.windowView!, []],
    [CellSet.of(geom.windows.map((w) => w.inside)), ['Fenstersicht nur direkt hinter der Scheibe frei: Pflichtobjekt passte sonst nicht']],
    [CellSet.empty(), ['ohne freie Fenstersicht eingerichtet: Pflichtobjekt passte sonst nicht']],
  ];
  let best: FurnishResult | undefined;
  for (const [view, notes] of levels) {
    const r = furnishAnalysed({ ...analysed, windowView: view }, rt, catalog, opts, notes);
    if (best === undefined || misfits(r) < misfits(best)) best = r;
    if (misfits(best) === 0) break;
  }
  return soften(best!);
}

/** Ein Raum mit fester Analyse (Sichtachsen): Hauptweg, dann Layout-Lockerung bei Pflicht-Fehlschlägen. */
function furnishAnalysed(plain: RoomAnalysis, rt: RoomTypeDef, catalog: Catalog, opts: FurnishOptions, extra: readonly string[]): FurnishResult {
  const depth = rt.aisle === undefined ? 1 : rowSideDepth(rt, catalog, opts.dataVersion);
  const layout = planLayout(plain, rt, 0, depth);
  // W2 (I6): Hauptweg 2 breit freihalten; passt ein Pflichtobjekt mit Weg nicht, ohne Weg einrichten (Pflicht vor Weg)
  // Räume mit Mittelgang (`aisle`) haben ihren Hauptweg schon im Layout. W5 (27.09.2026, Review N6): mit
  // `aisle.doorPath` zusätzlich den Weg von Tür zu Tür bzw. Treppe – der Gang allein verbindet die Türen nicht (Lager:
  // Ware am Treppenloch machte den Zugang 1 breit)
  const path = rt.aisle === undefined || rt.aisle.doorPath === true ? planPath(plain) : undefined;
  let base = path === undefined ? plain : { ...plain, path };
  let first = solveRoom(base, layout, rt, catalog, opts, extra);
  if (path !== undefined && misfits(first) > 0) {
    const open = solveRoom(plain, layout, rt, catalog, opts, [...extra, 'ohne freien Hauptweg eingerichtet: Pflichtobjekt passte sonst nicht']);
    // W5 (27.09.2026, Review N6): vor dem Verzicht auf den Weg einer, der die festen Wände schont (an der Treppe entlang,
    // `spare`) – er gilt, wenn damit alle Pflicht-Mindestzahlen stehen und die Signatur-Kette (`anchorChain`) nicht
    // kürzer ist als ganz ohne Weg (Pflicht und Signatur vor Weg, Weg vor Stücken über der Mindestzahl)
    const spare = planPath(plain, 'spare');
    const alt = spare === undefined || sameCells(spare, path) ? undefined : solveRoom({ ...plain, path: spare }, layout, rt, catalog, opts, extra, true);
    if (alt !== undefined && misfits(alt) < misfits(first) && misfits(alt) <= misfits(open) && chain(alt) >= chain(open)) {
      first = alt;
      base = { ...plain, path: spare! };
    } else if (misfits(open) < misfits(first)) {
      first = open;
      base = plain;
    }
  } else if (path !== undefined && !squareConnected(path, plain.geometry.doors.map((d) => d.inside))) {
    // W5 (Review N6): liegt der Weg nur versetzt 2 breit (an Knicken kein ganzes 2 × 2-Feld), den schonenden Weg
    // versuchen – nur, wenn dabei nichts fehlt und die Signatur-Kette nicht kürzer wird
    const spare = planPath(plain, 'spare');
    const alt = spare === undefined || sameCells(spare, path) || !squareConnected(spare, plain.geometry.doors.map((d) => d.inside))
      ? undefined : solveRoom({ ...plain, path: spare }, layout, rt, catalog, opts, extra);
    if (alt !== undefined && misfits(alt) <= misfits(first) && chain(alt) >= chain(first)) {
      first = alt;
      base = { ...plain, path: spare! };
    }
  }
  // W7 (27.09.2026): Insel (Küchentisch in der Mitte, Vorbilder 10/17) – eine mittige Fläche nur für den Insel-Eintrag,
  // der Hauptweg führt außen herum. Das Ergebnis gilt nur, wenn das Insel-Möbel dort steht, kein Pflichtobjekt mehr fehlt,
  // die Signatur-Kette nicht kürzer wird und der Weg 2 breit bleibt, wo er es vorher war (sonst wie bisher)
  const island = rt.aisle === undefined && rt.reserve === undefined && path !== undefined ? islandFor(plain, rt, catalog, opts.dataVersion) : undefined;
  if (island !== undefined) {
    const doors = plain.geometry.doors.map((d) => d.inside);
    const wide = base.path !== undefined && squareConnected(base.path, doors);
    const withIsland: RoomAnalysis = { ...plain, island };
    for (const lane of ['open', 'spare'] as const) {
      const ipath = planPath(withIsland, lane);
      if (ipath === undefined || (wide && !squareConnected(ipath, doors))) continue;
      const alt = solveRoom({ ...withIsland, path: ipath }, layout, rt, catalog, opts, extra);
      if (ISLAND_HIT.get(alt) === true && misfits(alt) <= misfits(first) && chain(alt) >= chain(first)) {
        first = alt;
        base = { ...withIsland, path: ipath };
        break;
      }
    }
  }
  if (layout === undefined || misfits(first) === 0) return first;
  // P07: Der verbindliche Mittelgang erlaubt nur die Lockerung auf `minWidth` (relax = 1), nie das Aufgeben des
  // Layouts. Ohne die Option bleibt die bisherige Stufenfolge (… dann ohne) unverändert.
  const hardAisle = opts.minAisle === true && rt.aisle !== undefined;
  // Raumtyp-Layout lockern, wenn ein Pflichtobjekt nicht passt: Gang auf minWidth (Freifläche kleiner), dann ohne
  let best = first;
  let prev: RoomLayout | undefined = layout;
  for (let relax = 1; relax <= (hardAisle ? LAYOUT_RELAX_LEVELS - 1 : LAYOUT_RELAX_LEVELS); relax++) {
    const lay = planLayout(base, rt, relax, depth);
    if (lay !== undefined && sameLayout(lay, prev)) continue;
    prev = lay;
    const note = lay === undefined ? 'ohne Mittelgang/Freifläche eingerichtet: Pflichtobjekt passte sonst nicht' : `Layout gelockert (${layoutLabel(lay)}): Pflichtobjekt passte sonst nicht`;
    const next = solveRoom(base, lay, rt, catalog, opts, [...extra, note]);
    if (misfits(next) < misfits(best)) best = next;
    if (misfits(best) === 0) break;
  }
  // P07: Klarer Befund, wenn die verbindliche Mindestbreite und die Pflichtmöbel zusammen nicht in den Raum passen.
  if (hardAisle && misfits(best) > 0) {
    const minW = Math.min(rt.aisle?.minWidth ?? 1, rt.aisle?.width ?? 1);
    const soft = SOFT.get(best);
    best = { ...best, warnings: [...best.warnings, `Mittelgang verbindlich (Mindestbreite ${minW}): Pflichtobjekt passt nicht – Raum zu klein für Gang und Pflichtmöbel`] };
    if (soft !== undefined) SOFT.set(best, soft);
  }
  return best;
}

/**
 * Seitentiefe, die die Reihen eines Raumtyps am Mittelgang brauchen: je Reihen-Eintrag die kleinste Form (Möbel mit
 * `backToWall` stehen mit dem Rücken zur Seitenwand → Tiefe; frei drehbare stehen quer mit Blick zur Stirnseite →
 * Breite), über alle Reihen das Maximum.
 */
export function rowSideDepth(rt: Pick<RoomTypeDef, 'required' | 'optional'>, catalog: Catalog, dataVersion: number): number {
  let need = 1;
  for (const e of [...rt.required, ...rt.optional]) {
    if (e.pattern?.kind !== 'row') continue;
    const sizes = catalog.byTags(e.tags, dataVersion).flatMap((d) =>
      (d.variants?.map((v) => v.id) ?? [undefined]).map((v) => {
        const x = expandComponent(d, v);
        return d.mount === 'floor' && d.rotations !== 'backToWall' ? x.size[0] : x.size[2];
      }),
    );
    if (sizes.length > 0) need = Math.max(need, Math.min(...sizes));
  }
  return need;
}

/**
 * W7: Insel eines Raumtyps (Eintrag mit `island`) für diesen Raum – Formen des Eintrags in Wunsch-Reihenfolge (Tag-Rang im
 * Eintrag, dann große Grundfläche, dann lange Seite entlang der langen Raumachse); nur frei stehende Bodenmöbel.
 */
function islandFor(a: RoomAnalysis, rt: RoomTypeDef, catalog: Catalog, dataVersion: number): IslandPlan | undefined {
  const all = [...rt.required, ...rt.optional];
  const entry = all.findIndex((e) => e.island === true);
  if (entry < 0) return undefined;
  const e = all[entry]!;
  const H = a.geometry.height;
  const b = a.geometry.interior.bounds();
  const longX = b === undefined || b.maxX - b.minX >= b.maxZ - b.minZ;
  const forms: (IslandForm & { rank: number; along: number })[] = [];
  for (const def of catalog.byTags(e.tags, dataVersion)) {
    if (def.mount !== 'floor' || def.rotations === 'backToWall') continue;
    const rank = e.tags.findIndex((t) => def.tags.includes(t));
    const turns = def.rotations === 'all' || (Array.isArray(def.rotations) && def.rotations.some((r) => r % 2 === 1));
    for (const base of def.variants?.map((v) => v.id) ?? [undefined]) {
      if (!fitsRoomHeight(def, base, H)) continue;
      const size = expandComponent(def, adaptVariant(def, base, H)).size;
      for (const [sx, sz] of turns ? [[size[0], size[2]], [size[2], size[0]]] : [[size[0], size[2]]]) {
        forms.push({ sx: sx!, sz: sz!, rank, along: (sx! >= sz!) === longX ? 0 : 1 });
      }
    }
  }
  forms.sort((p, q) => p.rank - q.rank || q.sx * q.sz - p.sx * p.sz || p.along - q.along);
  const cells = planIsland(a, forms);
  return cells === undefined ? undefined : { cells, tags: e.tags, entry };
}
/** W7: Steht das Insel-Möbel auf der Insel (je Lösungslauf, nur für die Wahl der Insel)? */
const ISLAND_HIT = new WeakMap<FurnishResult, boolean>();

/** W8-E: nicht gesetzte Pflicht-Stücke über der Mindestzahl je Lösungslauf (Warnungstext, Tags, Anzahl). */
interface SoftMiss {
  readonly text: string;
  readonly tags: readonly string[];
  readonly n: number;
}
const SOFT = new WeakMap<FurnishResult, readonly SoftMiss[]>();

/**
 * W8-E (27.09.2026): Endergebnis – Stücke über der Mindestzahl, die nach allen Lockerungen nicht passen, sind ein Hinweis
 * statt „Pflichtobjekt … passt nicht“ (wie der Weg-Versuch `spare` seit W5). Die Suche selbst zählt sie weiter als
 * Fehlschlag (gleiche Lockerungen, gleiche Platzierungen); ohne solche Stücke ist das Ergebnis unverändert.
 */
function soften(r: FurnishResult): FurnishResult {
  const soft = SOFT.get(r);
  if (soft === undefined) return r;
  const warnings = [...r.warnings];
  const notes: string[] = [];
  for (const m of soft) {
    let k = 0;
    for (; k < m.n; k++) {
      const at = warnings.indexOf(m.text);
      if (at < 0) break;
      warnings.splice(at, 1);
    }
    if (k > 0) notes.push(`${k} × ${m.tags.join('|')} über der Mindestzahl entfällt: kein Platz im Raum`);
  }
  return { ...r, warnings, quality: { ...r.quality, notes: [...r.quality.notes, ...notes] } };
}

/** Warnungen „Pflichtobjekt passt nicht“ (Maß für die Layout-Lockerung). */
const misfits = (r: FurnishResult): number => r.warnings.filter((w) => w.startsWith('Pflichtobjekt') && w.endsWith('passt nicht in den Raum')).length;
/** W5: Länge der Signatur-Kette je Lösungslauf (`Solve.anchorChain`), nur für die Wahl des Wegs. */
const CHAIN = new WeakMap<FurnishResult, number>();
const chain = (r: FurnishResult): number => CHAIN.get(r) ?? 0;
/**
 * W5 (Review N6): hängt der Weg über ganze 2 × 2-Felder von der ersten Tür zu allen übrigen zusammen (wie die Kennzahl
 * „Hauptweg 2 breit“: Zellen in einem 2 × 2-Feld des Wegs, Türzellen dürfen einzeln liegen)?
 */
function squareConnected(path: CellSet, doors: readonly Cell[]): boolean {
  const on = doors.filter(([x, z]) => path.has(x, z));
  if (on.length === 0) return true;
  const wide = (x: number, z: number): boolean => [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oz]) =>
    path.has(x + ox!, z + oz!) && path.has(x + ox! + 1, z + oz!) && path.has(x + ox!, z + oz! + 1) && path.has(x + ox! + 1, z + oz! + 1));
  const door = new Set(on.map(([x, z]) => cellKey(x, z)));
  const seen = new Set<string>([cellKey(on[0]![0], on[0]![1])]);
  const queue: Cell[] = [on[0]!];
  while (queue.length > 0) {
    const [x, z] = queue.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n: Cell = [x + dx, z + dz];
      const k = cellKey(n[0], n[1]);
      if (seen.has(k) || !path.has(n[0], n[1]) || !(wide(n[0], n[1]) || door.has(k))) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return [...door].every((k) => seen.has(k));
}
const samePose = (p: Pose, q: Pose): boolean =>
  p.rot === q.rot && p.mirror === q.mirror && p.pos[0] === q.pos[0] && p.pos[1] === q.pos[1] && p.pos[2] === q.pos[2];
const sameCells = (p: CellSet, q: CellSet): boolean => p.size === q.size && p.difference(q).size === 0;
const sameLayout = (p: RoomLayout, q: RoomLayout | undefined): boolean =>
  q !== undefined && p.aisle?.width === q.aisle?.width && p.aisle?.from === q.aisle?.from && p.reserve?.cells.size === q.reserve?.cells.size;
const layoutLabel = (l: RoomLayout): string =>
  [l.aisle !== undefined ? `Mittelgang ${l.aisle.width} breit` : '', l.reserve !== undefined ? `Freifläche ${l.reserve.cells.size} Zellen` : ''].filter((x) => x !== '').join(', ');

/**
 * Ein Lösungslauf mit festem Layout (deterministisch: Zufall nur aus dem Seed).
 * W5 (27.09.2026, Review N6) `aboveMinSoft`: Pflicht-Stücke über der Mindestzahl ihres Eintrags (`count.min` bzw.
 * `perArea`-Untergrenze), die nicht passen, sind dann keine Warnung „Pflichtobjekt … passt nicht“, sondern ein Hinweis –
 * nur für den Weg-Versuch `spare` (der Hauptweg hat Vorrang vor einer dritten Arbeitsplatte, nie vor der Mindestzahl).
 */
function solveRoom(
  base: RoomAnalysis, layout: RoomLayout | undefined, rt: RoomTypeDef, catalog: Catalog, opts: FurnishOptions, notes: readonly string[], aboveMinSoft = false,
): FurnishResult {
  const analysis: RoomAnalysis = layout === undefined ? base : { ...base, layout };
  const geom = analysis.geometry;
  opts.trace?.({ type: 'run-start', analysis, ...(layout !== undefined ? { layout } : {}), notes });
  const rng = new Rng(hashSeed(opts.seed, 'furnish', rt.id));
  const warnings: string[] = [];
  // `blocked` kann in `interior` liegen (Fixtures) oder schon herausgenommen sein (Pipeline) – nie doppelt abziehen
  const area = geom.interior.difference(analysis.blocked).size;
  if (area < rt.minArea) warnings.push(`Raum ist mit ${area} Zellen kleiner als das Minimum ${rt.minArea} für „${rt.name}“`);

  // V3: Wand- und Deckenobjekte belegen keinen Boden → halber Anteil am Flächenbudget
  const vertical = (tags: readonly string[]): boolean => {
    const defs = catalog.byTags(tags, opts.dataVersion);
    return defs.length > 0 && defs.every((d) => d.mount === 'wall' || d.mount === 'ceiling');
  };
  // W2 (I6): Deko-Budget je Fläche – reine Deko-Einträge im Programm und Deko-Kinder auf Andockpunkten
  const decorEntry = (e: RoomTypeEntry): boolean => {
    const defs = catalog.byTags(e.tags, opts.dataVersion);
    return defs.length > 0 && defs.every(isDecorDef);
  };
  const decorProgram = Math.max(1, Math.floor((1 + area / DECOR_CELLS) * (MOOD?.decor ?? 1)));
  const density = MOOD === undefined ? (opts.density ?? 1) : Math.min(2, (opts.density ?? 1) * MOOD.density);
  const program = buildProgram(rt, area, rng.fork('program'), density, (e) => (vertical(e.tags) ? VERTICAL_COST : 1), { max: decorProgram, isDecor: decorEntry });
  SOLVER_COUNTERS.runs++;
  const s = new Solve(analysis, catalog, opts, program);
  s.decorMax = Math.max(2, Math.round((2 + area / DECOR_TOTAL_CELLS) * (MOOD?.decor ?? 1)));
  // W3-IN (I7): Licht-Budget und bevorzugte Lichtpunkte des Raumtyps
  s.lightMax = lightBudget(rt.lighting, area);
  if (rt.lighting?.anchors !== undefined) s.lightAnchors = rt.lighting.anchors;
  s.notes.push(...notes);
  // Mindesthöhe (K3c): keine Warnung – die Kompaktform ist ein gültiges Ergebnis –, aber ein Hinweis für die UI
  // Stil (Y9): ebenfalls nur Hinweis – der Nutzer darf jeden Raumtyp in jedem Theme bauen
  if (!roomTypeFitsStyles(rt, opts.styles)) s.notes.push(`Raumtyp „${rt.name}“ passt nicht zum Stil ${opts.styles!.join('/')} (styleTags)`);
  if (!roomTypeFitsHeight(rt, geom.height)) s.notes.push(`lichte Höhe ${geom.height} unter der Mindesthöhe ${rt.minHeight} für „${rt.name}“: Signatur in Kompaktform`);
  const entropy = opts.order === 'entropy' || opts.order === 'dynamic-entropy';
  const order = orderProgram(program, (e) => (entropy ? s.liveStats(e, true) : s.entryStats(e)));
  const zones = planZones(analysis);
  s.zones = zones;
  s.zoneOf = assignZones(program, order, zones, rt, (i) => s.isFloorItem(i), (i) => s.isCeilingItem(i));
  opts.trace?.({ type: 'order', program, order, stats: order.map((i) => s.entryStats(program[i]!.entry)), zones });

  const missed = new Map<number, number>();
  // W7-G (U7): erst die noch gültigen bisherigen Lagen, dann der Rest wie gewohnt (ohne Vorgaben: leer, bitgleich)
  const kept = s.keepAll(order);
  // W8-A: offene Programm-Objekte; mit dynamischem MRV (`order: dynamic…`) nach jeder Platzierung neu sortiert
  const queue = order.filter((i) => !kept.has(i));
  const dynamic = opts.order === 'dynamic' || opts.order === 'dynamic-entropy';
  const fc = opts.forwardCheck !== false;
  while (queue.length > 0) {
    const idx = dynamic ? s.nextDynamic(queue, entropy) : queue.shift()!;
    const item = program[idx]!;
    let itemRng = rng.fork(`item${idx}`);
    if (catalog.byTags(item.tags, opts.dataVersion).length === 0) {
      if (item.required) warnings.push(`Keine Komponente mit Tags ${item.tags.join('|')} im Katalog`);
      continue;
    }
    // Forward Checking (W8-A): geschützt sind die offenen Pflichtobjekte, die jetzt noch eine gültige Pose haben
    const placed = fc ? s.placeGuarded(idx, queue.filter((i) => program[i]!.required), itemRng, () => (itemRng = rng.fork(`item${idx}`))) : s.placeItem(idx, itemRng);
    opts.trace?.({ type: 'item-end', idx, ok: placed });
    if (placed || !item.required) continue;
    // Reparatur statt Warnung: begrenztes Backtracking
    const note = s.repair(idx, itemRng.fork('repair')) ?? s.placeWithoutAccess(idx, itemRng.fork('access'));
    if (note !== undefined) s.notes.push(note);
    else {
      warnings.push(`Pflichtobjekt ${item.tags.join('|')} passt nicht in den Raum`);
      missed.set(item.entry, (missed.get(item.entry) ?? 0) + 1);
    }
  }
  if (aboveMinSoft) {
    for (const [entry, n] of missed) {
      const e = rt.required[entry];
      if (e === undefined) continue;
      const asked = program.filter((it) => it.required && it.entry === entry).length;
      // Mindestzahl: `count[0]` bzw. `count.min` (bei `perArea` ist die Flächenzahl der Wunsch, nicht die Pflicht)
      if (asked - n < (Array.isArray(e.count) ? e.count[0] : e.count.min)) continue;
      const text = `Pflichtobjekt ${e.tags.join('|')} passt nicht in den Raum`;
      for (let k = 0; k < n; k++) warnings.splice(warnings.indexOf(text), 1);
      s.notes.push(`${n} × ${e.tags.join('|')} über der Mindestzahl entfällt: Hauptweg hat Vorrang`);
    }
  }

  // W8-E: fehlende Stücke über der Mindestzahl – bleiben während der Suche Warnungen (Lockerungen versuchen sie weiter
  // zu setzen, Ergebnis bitgleich), `furnishRoom` macht am Ende Hinweise daraus
  const soft: SoftMiss[] = [];
  for (const [entry, n] of missed) {
    const e = rt.required[entry];
    if (e === undefined) continue;
    const asked = program.filter((it) => it.required && it.entry === entry);
    if (aboveMinSoft && asked.length - n >= (Array.isArray(e.count) ? e.count[0] : e.count.min)) continue; // schon Hinweis
    const k = Math.min(n, asked.filter((it) => it.aboveMin === true).length);
    if (k > 0) soft.push({ text: `Pflichtobjekt ${e.tags.join('|')} passt nicht in den Raum`, tags: e.tags, n: k });
  }

  const result: FurnishResult = {
    placements: s.entries.map((e) => ({
      key: e.key,
      componentId: e.def.id,
      ...(e.variantId !== undefined ? { variantId: e.variantId } : {}),
      pose: e.placed.pose,
      seed: hashSeed(opts.seed, e.key),
      ...(e.parentKey !== undefined ? { parentKey: e.parentKey } : {}),
      ...(e.socketId !== undefined ? { socketId: e.socketId } : {}),
    })),
    placed: [...(opts.fixed ?? []), ...s.entries.map((e) => e.placed)],
    warnings,
    analysis,
    quality: s.quality(),
    zones,
    ...(layout !== undefined ? { layout } : {}),
  };
  CHAIN.set(result, s.anchorChain());
  if (soft.length > 0) SOFT.set(result, soft);
  opts.trace?.({ type: 'run-end', result });
  const isl = analysis.island;
  if (isl !== undefined) {
    ISLAND_HIT.set(result, s.entries.some((e) => e.item !== undefined && program[e.item]!.entry === isl.entry
      && e.placed.cells.some((c) => c.pos[1] === geom.baseY && isl.cells.has(c.pos[0], c.pos[2]))));
  }
  return result;
}

/** Zustand eines Lösungslaufs: platzierte Einträge + Belegung (neu aufgebaut nach Entfernen/Zurücksetzen). */
class Solve {
  entries: Entry[] = [];
  occ: Occupancy;
  zones: readonly FunctionZone[] = [];
  zoneOf: ReadonlyMap<number, number> = new Map();
  readonly notes: string[] = [];
  /** Deko-Budget des Raums (Programm + Kinder, W2 I6); unendlich = kein Budget. */
  decorMax = Infinity;
  /** Licht-Budget des Raums (W3-IN, `lighting.budget`): Leuchten aus Programm und Andockpunkten; unendlich = keins. */
  lightMax = Infinity;
  /** Bevorzugte Lichtpunkte (W3-IN, `lighting.anchors`): Abstell-/Hängelichter nur an diesen Möbeln, eines je Möbel. */
  lightAnchors: readonly string[] | undefined;
  private n = 0;
  private readonly dDoorMax: number;
  private readonly expCache = new Map<string, ExpandedComponent>();
  private readonly optCache = new Map<string, Option[]>();
  private readonly statsCache = new Map<string, EntryStats>();
  private runs: Map<string, number> | undefined;
  /** W8-A: Forward Checking – geschützte Pflichtobjekte (Programm-Indizes) beim aktuellen `placeItem`; leer = aus. */
  private guard: readonly number[] = [];
  /** W8-A: vom Forward Checking verworfene Kandidaten im aktuellen `placeGuarded`. */
  private rejected = 0;
  /** W8-A: Zeuge je Form (erste gültige Pose) bzw. `null` = keine Pose beim Belegungsstand `witnessAt`. */
  private readonly witness = new Map<string, PlacedComponent | null>();
  private readonly witnessAt = new Map<string, number>();
  /** W8-A: Belegungsstand (zählt bei jedem `commit`/`rebuild` hoch). */
  private version = 0;
  private readonly liveCache = new Map<string, EntryStats>();

  constructor(
    readonly a: RoomAnalysis,
    readonly catalog: Catalog,
    readonly opts: FurnishOptions,
    readonly program: readonly ProgramItem[],
  ) {
    this.occ = this.rebuild();
    this.dDoorMax = Math.max(1, ...[...a.dDoor.values()].filter(Number.isFinite));
  }

  private get geom(): RoomGeometry {
    return this.a.geometry;
  }

  private rebuild(): Occupancy {
    const occ = new Occupancy(this.geom.baseY);
    for (const f of this.opts.fixed ?? []) occ.add(f, useCellsOf(f, this.geom));
    for (const e of this.entries) occ.add(e.placed, useCellsOf(e.placed, this.geom));
    this.version++;
    return (this.occ = occ);
  }

  private expand(def: ComponentDef, variantId: string | undefined): ExpandedComponent {
    const k = `${def.id}#${variantId ?? ''}`;
    let e = this.expCache.get(k);
    if (e === undefined) this.expCache.set(k, (e = expandComponent(def, variantId)));
    return e;
  }

  /**
   * Alle Formen (Komponente × Variante) für Tags, passend zur lichten Höhe (V3): Varianten außerhalb von
   * `minRoomHeight`/`maxRoomHeight` fallen weg (passt keine, bleiben alle – die Höhe ist Auswahl, keine
   * harte Regel), gedehnte Formen bekommen die Länge für diesen Raum.
   */
  private options(tags: readonly string[], signature = false): Option[] {
    const styled = signature && this.opts.styles !== undefined;
    const k = `${styled ? 'S|' : ''}${tags.join('|')}`;
    let out = this.optCache.get(k);
    if (out === undefined) {
      const H = this.geom.height;
      const all = this.defsFor(tags, styled).flatMap((def) => (def.variants?.map((v) => v.id) ?? [undefined]).map((base) => ({ def, base })));
      const fitting = all.filter(({ def, base }) => fitsRoomHeight(def, base, H));
      out = (fitting.length > 0 ? fitting : all).map(({ def, base }) => {
        const variantId = adaptVariant(def, base, H);
        const exp = this.expand(def, variantId);
        return { def, variantId, base, exp, footprint: exp.size[0] * exp.size[2] };
      });
      this.optCache.set(k, out);
    }
    return out;
  }

  /**
   * Komponenten zu Tags. Signatur-Tausch je Theme (Y9, `styled`): nur die Komponenten des spezifischsten Stils aus
   * `opts.styles`, zu dem es welche gibt (Nordic: Langfeuer statt Kamin); sonst alle.
   */
  private defsFor(tags: readonly string[], styled: boolean): ComponentDef[] {
    const all = this.catalog.byTags(tags, this.opts.dataVersion);
    if (!styled) return all;
    for (const st of this.opts.styles!) {
      const match = all.filter((d) => d.styleTags?.includes(st) === true);
      if (match.length > 0) return match;
    }
    return all;
  }

  /**
   * Formen in Probier-Reihenfolge für Nicht-Signatur-Objekte: Komponenten gemischt, je Komponente zuerst die
   * gewürfelte Variante, dann die übrigen als Rückfall (v1 verwarf die ganze Komponente).
   */
  private orderedOptions(item: ProgramItem, rng: Rng): Option[] {
    const all = this.options(item.tags);
    const H = this.geom.height;
    const out: Option[] = [];
    // V3 „mehr in die Höhe denken“: Komponenten mit höheren Formen kommen öfter zuerst (Zufall + Höhenanteil)
    const tallest = (def: ComponentDef): number => Math.max(0, ...all.filter((o) => o.def === def && o.exp.size[1] <= H).map((o) => o.exp.size[1]));
    const defs = this.catalog.byTags(item.tags, this.opts.dataVersion).map((def) => ({ def, key: rng.next() + (W.vertical * tallest(def)) / H + (MOOD?.style(def) ?? 0) }));
    for (const { def } of defs.sort((p, q) => q.key - p.key)) {
      const mine = all.filter((o) => o.def === def);
      // gewürfelte Variante zuerst, gewichtet nach Katalog-Gewicht und (V3) Höhe der Form
      const first = mine.length === 0 ? undefined : rng.weighted(mine, (o) => (variantWeight(def, o.base) * (MOOD?.variant(o.base) ?? 1) * (1 + (W.vertical * o.exp.size[1]) / H)) || 1e-9).base;
      out.push(...mine.filter((o) => o.base === first), ...mine.filter((o) => o.base !== first));
    }
    // Doppelreihe am Mittelgang (K3c): die Form des zuletzt gesetzten Reihen-Stücks zuerst (gespiegelte Paare)
    const last = this.rowForm(item);
    const formed = last === undefined ? out : [...out.filter((o) => sameForm(o, last)), ...out.filter((o) => !sameForm(o, last))];
    // Villager-Stände (`distinctJobBlocks`): Formen mit noch nicht vergebenem Arbeitsblock zuerst – die erste Form mit
    // gültiger Pose gewinnt, also praktisch hart, solange es freie Berufe gibt (13 Arbeitsblöcke)
    if (!formed.some((o) => isJobStation(o.exp))) return formed;
    const used = this.usedJobs();
    const fresh = (o: Option): boolean => !jobBlocksOf(o.exp).some((j) => used.has(j));
    return [...formed.filter(fresh), ...formed.filter((o) => !fresh(o))];
  }

  /** Arbeitsblöcke der schon gesetzten Handels-Stationen. */
  private usedJobs(): Set<string> {
    return new Set(this.entries.filter((e) => isJobStation(e.placed.expanded)).flatMap((e) => jobBlocksOf(e.placed.expanded)));
  }

  /** Form (Komponente + Variante) des zuletzt gesetzten Stücks derselben Reihe – nur bei Reihen am Mittelgang. */
  private rowForm(item: ProgramItem): { readonly def: ComponentDef; readonly variantId: string | undefined } | undefined {
    if (this.a.layout?.aisle === undefined || item.pattern?.kind !== 'row') return undefined;
    const mates = this.entries.filter((e) => e.item !== undefined && this.program[e.item]!.entry === item.entry);
    return mates[mates.length - 1];
  }

  /** Größenmaß einer Form: Grundfläche, bei gleicher Grundfläche leicht mehr für die höhere (bis zur lichten Höhe). */
  private sizeOf(options: readonly Option[]): (o: Option) => number {
    const g = this.geom;
    const maxH = Math.max(1, ...options.filter((o) => o.exp.size[1] <= g.height).map((o) => o.exp.size[1]));
    return (o) => (o.exp.size[1] > g.height ? 0 : o.footprint * (0.8 + (0.2 * o.exp.size[1]) / maxH));
  }

  /**
   * Domäne (Posen nach dem Vorfilter) und Grundfläche eines Eintrags im leeren Raum (nur feste Objekte) – für
   * „Most Constrained First“. Formen gleicher Gestalt (nur das Material anders) werden einmal aufgezählt.
   */
  entryStats(entry: number): EntryStats {
    const item = this.program.find((i) => i.entry === entry)!;
    const key = `${item.signature && this.opts.styles !== undefined ? 'S|' : ''}${item.tags.join('|')}`;
    let st = this.statsCache.get(key);
    if (st === undefined) {
      // Wand- und Deckenobjekte belegen keinen Laufraum: sie kommen ohne Aufzählung ans Ende
      const options = this.options(item.tags, item.signature);
      const floor = options.some((o) => o.def.mount === 'floor');
      let domain = floor ? 0 : Number.MAX_SAFE_INTEGER;
      const shapes = new Map<string, number>();
      for (const o of floor ? options : []) {
        const shape = JSON.stringify([o.def.mount, o.def.rotations, o.exp.size, o.exp.cells.map((c) => c.at), o.exp.air, o.exp.masks.use, o.exp.walkable]);
        let n = shapes.get(shape);
        if (n === undefined) shapes.set(shape, (n = countPoses(o.def, o.exp, this.a, this.occ)));
        domain += n;
      }
      const footprint = Math.max(0, ...options.map((o) => o.footprint));
      this.statsCache.set(key, (st = { domain, footprint }));
    }
    return st;
  }

  /**
   * W8-A (Experiment): Domäne wie `entryStats`, aber beim aktuellen Belegungsstand (dynamisches MRV) und wahlweise als
   * Entropie über Pose × Variantengewicht (H = ln Σw − Σ w·ln w / Σw, verschoben um 1, damit eine einzige Pose nicht
   * als „keine“ gilt). Zwischengespeichert je Belegungsstand.
   */
  liveStats(entry: number, entropy: boolean): EntryStats {
    const item = this.program.find((i) => i.entry === entry)!;
    const key = `${this.version}|${entropy ? 'H' : 'N'}|${item.signature && this.opts.styles !== undefined ? 'S|' : ''}${item.tags.join('|')}`;
    let st = this.liveCache.get(key);
    if (st === undefined) {
      const options = this.options(item.tags, item.signature);
      const floor = options.some((o) => o.def.mount === 'floor');
      let n = 0;
      let sw = 0;
      let swl = 0;
      const shapes = new Map<string, number>();
      for (const o of floor ? options : []) {
        const shape = JSON.stringify([o.def.mount, o.def.rotations, o.exp.size, o.exp.cells.map((c) => c.at), o.exp.air, o.exp.masks.use, o.exp.walkable]);
        let k = shapes.get(shape);
        if (k === undefined) shapes.set(shape, (k = countPoses(o.def, o.exp, this.a, this.occ)));
        const w = variantWeight(o.def, o.base);
        n += k;
        sw += k * w;
        swl += w > 0 ? k * w * Math.log(w) : 0;
      }
      const domain = !floor ? Number.MAX_SAFE_INTEGER : !entropy ? n : sw <= 0 ? 0 : 1 + Math.log(sw) - swl / sw;
      this.liveCache.set(key, (st = { domain, footprint: Math.max(0, ...options.map((o) => o.footprint)) }));
    }
    return st;
  }

  /** W8-A (Experiment, dynamisches MRV): nächstes Objekt aus `queue` nach der Reihenfolge beim aktuellen Belegungsstand. */
  nextDynamic(queue: number[], entropy: boolean): number {
    const open = new Set(queue);
    const idx = orderProgram(this.program, (e) => this.liveStats(e, entropy)).find((i) => open.has(i))!;
    queue.splice(queue.indexOf(idx), 1);
    return idx;
  }

  /** Steht das Objekt auf dem Boden (mindestens eine Form mit Montage `floor`)? */
  isFloorItem(idx: number): boolean {
    const it = this.program[idx]!;
    return this.options(it.tags, it.signature).some((o) => o.def.mount === 'floor');
  }

  /** Hängt das Objekt an der Decke (alle Formen mit Montage `ceiling`)? */
  isCeilingItem(idx: number): boolean {
    const it = this.program[idx]!;
    const options = this.options(it.tags, it.signature);
    return options.length > 0 && options.every((o) => o.def.mount === 'ceiling');
  }

  /**
   * feat/theme-moods: Spiegelpaar-Wertung (`mirrorShare`) – Grundzellen gleich einer schon gesetzten gleichen Komponente
   * an der Raummitte gespiegelt. Ohne Stimmung bzw. mit `organic` = 0 genau 0 (bitgleich); nur weich.
   */
  private moodMirror(p: PlacedComponent, def: ComponentDef): number {
    if (MOOD === undefined || MOOD.mirror === 0) return 0;
    const partners = new Set<string>();
    for (const e of this.entries) if (e.def.id === def.id) for (const c of e.placed.cells) if (c.pos[1] === this.geom.baseY) partners.add(cellKey(c.pos[0], c.pos[2]));
    if (partners.size === 0) return 0;
    const b = this.geom.interior.bounds()!;
    const own = p.cells.filter((c) => c.pos[1] === this.geom.baseY).map((c) => [c.pos[0], c.pos[2]] as const);
    return MOOD.mirror * mirrorShare(own, partners, b);
  }

  /** Platziert ein Programm-Objekt samt Sockets; false, wenn keine Form eine gültige Pose hat. */
  placeItem(idx: number, rng: Rng, compactOnly = false): boolean {
    const item = this.program[idx]!;
    const trace = this.opts.trace;
    trace?.({ type: 'item', idx, compactOnly });
    const score = this.scorer(item, idx);
    const scored = (o: Option, bonus: number): Candidate[] =>
      enumeratePoses(o.def, o.exp, this.a, this.occ).map((p) => {
        // gleiche Reihenfolge der Rechnung wie vorher (Wertung, Seed-Rauschen, Stimmungs-Spiegelung); die Teile nur mit `trace`
        const soft = score(p, o.def);
        const jitter = rng.next() * 0.05;
        return { opt: o, placed: p, score: soft + bonus + jitter + this.moodMirror(p, o.def), ...(trace !== undefined ? { parts: { soft, bonus, jitter } } : {}) };
      });
    if (item.signature) {
      // Signatur: erst alle großen Formen gemeinsam bewerten (größere mit Vorrang), die Kompaktform (kleinste
      // Grundfläche der Familie) nur als Rückfall, wenn keine große Form eine gültige Pose hat
      const last = this.rowForm(item);
      const form = (o: Option): number => (last !== undefined && sameForm(o, last) ? W.aisleForm : 0);
      const tiersOf = (options: readonly Option[]): Array<() => Candidate[]> => {
        if (options.length === 0) return [];
        const size = this.sizeOf(options);
        const max = Math.max(1e-9, ...options.map(size));
        const compact = Math.min(...options.map((o) => o.footprint));
        const bonus = (o: Option): number => (W.size * size(o)) / max + W.variety * rng.next() + form(o) + (MOOD?.style(o.def) ?? 0);
        return [options.filter((o) => o.footprint > compact && !compactOnly), options.filter((o) => o.footprint === compact)]
          .map((tier) => () => tier.flatMap((o) => scored(o, bonus(o))));
      };
      const styled = this.options(item.tags, true);
      const tiers = tiersOf(styled);
      // Signatur-Tausch (Y9): passt keine Form des Stils, bleiben die übrigen Formen der Familie als Rückfall
      // (z. B. Kompaktform ohne Stil-Tag in kleinen/niedrigen Räumen). Ohne `styles` identisch zu vorher.
      if (this.opts.styles !== undefined) {
        const own = new Set(styled.map((o) => o.def.id));
        tiers.push(...tiersOf(this.options(item.tags).filter((o) => !own.has(o.def.id))));
      }
      return tiers.some((tier) => this.commitBest(tier(), idx, rng));
    }
    // Deko-Budget (W2, I6): ist es erschöpft, nimmt ein Wunschobjekt nur noch Formen, die keine reine Deko sind
    // (Einträge wie „Waren/Fass/Vase“ mischen Deko und Funktion)
    const overDecor = !item.required && this.entries.filter((e) => isDecorDef(e.def)).length >= this.decorMax;
    // Licht-Budget (W3-IN, I7): ist es erschöpft, setzt ein Wunschobjekt keine Leuchte mehr
    const overLight = !item.required && this.lightCount() >= this.lightMax;
    // Nebenmöbel an die Wand (W2, I6): Wunschobjekte ohne Zone „center“ stehen zuerst an einer Wand (eine Grundzelle mit
    // Wand); nur wenn keine Form dort Platz hat, frei im Raum. Die Mitte bleibt dem Zentrum und dem Weg.
    const isle = this.islandOf(item);
    const atWall = !item.required && !(item.pref.zones ?? []).includes('center') && this.a.layout === undefined && isle === undefined;
    const touches = (c: Candidate): boolean => c.placed.cells.some((x) => x.pos[1] === this.geom.baseY && (this.a.info.get(cellKey(x.pos[0], x.pos[2]))?.walls.length ?? 0) > 0);
    for (const pass of atWall ? [true, false] : [false]) {
      const ordered = this.orderedOptions(item, rng);
      // W7: das Insel-Möbel nimmt zuerst die Formen, die die Insel genau füllen (der lange Küchentisch statt des Hockers)
      const fills = (o: Option): boolean => isle !== undefined && o.exp.size[0] * o.exp.size[2] === isle.cells.size;
      for (const o of isle === undefined ? ordered : [...ordered.filter(fills), ...ordered.filter((o) => !fills(o))]) {
        if (overDecor && isDecorDef(o.def)) continue;
        if (overLight && isLightFixture(o.def)) continue;
        if (o.def.mount !== 'floor' && pass) continue;
        const cands = scored(o, 0);
        if (this.commitBest(pass ? cands.filter(touches) : cands, idx, rng)) return true;
      }
    }
    return false;
  }

  /**
   * Die k besten Kandidaten, die auch die Konnektivität bestehen; daraus rang-gewichtet per Seed (der Beste am
   * wahrscheinlichsten). Lässt sich ein Pflicht-Socket nicht füllen, fällt die Gruppe weg und der nächste kommt dran.
   */
  private commitBest(cands: readonly Candidate[], idx: number, rng: Rng): boolean {
    if (cands.length === 0) return false;
    const sorted = [...cands].sort((a, b) => b.score - a.score);
    const k = Math.max(1, this.opts.topK ?? 3);
    const top: Candidate[] = [];
    const trace = this.opts.trace;
    const disconnected: number[] = [];
    for (const c of sorted) {
      // nur Kandidaten nahe am Besten: klare Vorlieben (Reihe, große Form) setzen sich durch, Gleichwertiges wird gewürfelt
      if (top.length > 0 && c.score < top[0]!.score - SCORE_WINDOW * (MOOD?.window ?? 1)) break;
      if (connectivityOK(c.placed, this.a, this.occ, this.access)) top.push(c);
      else if (trace !== undefined) disconnected.push(sorted.indexOf(c));
      if (top.length >= k) break;
    }
    if (trace !== undefined) {
      trace({
        type: 'candidates', idx, analysis: this.a, occ: this.occ, top: top.map((c) => sorted.indexOf(c)), disconnected,
        candidates: sorted.map((c) => ({
          componentId: c.opt.def.id, ...(c.opt.variantId !== undefined ? { variantId: c.opt.variantId } : {}), placed: c.placed, score: c.score,
          soft: c.parts?.soft ?? c.score, bonus: c.parts?.bonus ?? 0, jitter: c.parts?.jitter ?? 0,
        })),
      });
    }
    while (top.length > 0) {
      const i = rng.weighted(top.map((_, j) => j), (j) => top.length - j);
      const c = top.splice(i, 1)[0]!;
      const e = this.commit(c.opt.def, c.opt.variantId, c.placed, { item: idx });
      const ok = this.fillSockets(e, rng.fork('sockets'), 1, false);
      const kept = ok && this.guard.every((g) => this.alive(g));
      trace?.({ type: 'try', idx, candidate: sorted.indexOf(c), key: e.key, ok: kept });
      if (kept) return true;
      if (ok) {
        // W8-A: der Kandidat nimmt einem offenen Pflichtobjekt die letzte gültige Pose → verwerfen, nächster Wurf
        this.rejected++;
        SOLVER_COUNTERS.fcRejects++;
      }
      this.remove(e.key);
    }
    return false;
  }

  /**
   * W8-A: `placeItem` mit Forward Checking. `open` sind die noch offenen Pflichtobjekte; geschützt sind die, die jetzt
   * eine gültige Pose haben (die übrigen scheitern ohnehin). Lässt sich das Objekt nur setzen, indem es einem von ihnen
   * die letzte Pose nimmt, setzt es sich wie ohne Forward Checking (Zähler und Würfel zurück, `fresh` liefert den Strom
   * neu) – dann ist das Ergebnis bitgleich zu vorher, und das Backtracking des späteren Objekts greift wie bisher.
   */
  placeGuarded(idx: number, open: readonly number[], rng: Rng, fresh: () => Rng): boolean {
    const n0 = this.n;
    this.guard = open.filter((g) => this.alive(g));
    this.rejected = 0;
    let ok = this.placeItem(idx, rng);
    this.guard = [];
    if (!ok && this.rejected > 0) {
      SOLVER_COUNTERS.fcFallbacks++;
      this.n = n0;
      ok = this.placeItem(idx, fresh());
    }
    return ok;
  }

  /** W8-A: Hat das Programm-Objekt beim aktuellen Belegungsstand noch mindestens eine gültige Pose (irgendeine Form)? */
  private alive(idx: number): boolean {
    const it = this.program[idx]!;
    const forms = it.signature && this.opts.styles !== undefined ? [...this.options(it.tags, true), ...this.options(it.tags)] : this.options(it.tags);
    for (const o of forms) {
      const k = `${o.def.id}#${o.variantId ?? ''}`;
      const w = this.witness.get(k);
      if (w !== undefined && w !== null && cheapValid(w, o.def, this.a, this.occ)) return true;
      if (w === null && this.witnessAt.get(k) === this.version) continue;
      const p = firstPose(o.def, o.exp, this.a, this.occ);
      this.witness.set(k, p ?? null);
      this.witnessAt.set(k, this.version);
      if (p !== undefined) return true;
    }
    return false;
  }

  /** W8-B: Regel `useAccess` (Nutzungsseite am begehbaren Netz) in `commitBest`; aus nur im Rückfall `placeWithoutAccess`. */
  private access = true;

  /**
   * W8-B (27.09.2026): Rückfall für ein Pflichtobjekt, das auch per Backtracking nicht mit der Regel `useAccess` passt –
   * einmal ohne sie setzen (Pflicht vor Weg), mit Hinweis für die Qualitätsanzeige. Die Regel für die übrigen Möbel
   * bleibt an; die so entstandene Engstelle dulden spätere Platzierungen (`useAccessOK`).
   */
  placeWithoutAccess(idx: number, rng: Rng): string | undefined {
    this.access = false;
    try {
      return this.placeItem(idx, rng) ? `Nutzungsseite von ${this.program[idx]!.tags.join('|')} in Engstelle oder Sackgasse: Pflichtobjekt passte sonst nicht` : undefined;
    } finally {
      this.access = true;
    }
  }

  /** W7-G (U7): schon vergebene Vorgaben (`FurnishOptions.keep`). */
  private readonly keepUsed = new Set<string>();

  /**
   * W7-G (U7): setzt jedes Programm-Objekt (in `order`) an eine noch gültige bisherige Lage, samt aufgesetzter Teile.
   * Liefert die so gesetzten Programm-Indizes; ohne Vorgaben leer und ohne Wirkung.
   */
  keepAll(order: readonly number[]): Set<number> {
    const out = new Set<number>();
    const keep = this.opts.keep ?? [];
    if (keep.length === 0) return out;
    // aufgesetzte Teile fester Möbel zuerst (sie stehen, wo das feste Möbel steht), dann die Programm-Objekte
    const fixed = this.opts.fixed ?? [];
    this.opts.fixedKeys?.forEach((key, i) => {
      if (fixed[i] !== undefined) this.keepSockets({ key, placed: fixed[i]! }, key);
    });
    // feste Möbel erfüllen ihr Programm-Objekt – sonst stellte der Solver neben den gesperrten Tresen einen zweiten
    for (const f of fixed) {
      const idx = order.find((i) => !out.has(i) && this.options(this.program[i]!.tags).some((o) => o.def.id === f.expanded.defId));
      if (idx !== undefined) out.add(idx);
    }
    const tops = keep.filter((h) => h.parentKey === undefined);
    for (const idx of order) if (!out.has(idx) && this.keepItem(idx, tops)) out.add(idx);
    return out;
  }

  /** Erste freie Vorgabe derselben Form, deren Lage alle harten Regeln (wie `enumeratePoses` + Konnektivität) erfüllt. */
  private keepItem(idx: number, tops: readonly KeepHint[]): boolean {
    const item = this.program[idx]!;
    // Budgets wie in `placeItem` (die Vorgabe hielt sie schon ein; die Reihenfolge kann sich verschoben haben)
    const overDecor = !item.required && this.entries.filter((e) => isDecorDef(e.def)).length >= this.decorMax;
    const overLight = !item.required && this.lightCount() >= this.lightMax;
    const options = this.options(item.tags);
    for (const h of tops) {
      if (this.keepUsed.has(h.key)) continue;
      const o = options.find((x) => x.def.id === h.componentId && x.variantId === h.variantId);
      if (o === undefined || (overDecor && isDecorDef(o.def)) || (overLight && isLightFixture(o.def))) continue;
      const p = enumeratePoses(o.def, o.exp, this.a, this.occ).find((c) => samePose(c.pose, h.pose));
      if (p === undefined || !connectivityOK(p, this.a, this.occ)) continue;
      const e = this.commit(o.def, o.variantId, p, { item: idx });
      if (this.keepSockets(e, h.key)) {
        this.keepUsed.add(h.key);
        return true;
      }
      this.remove(e.key);
    }
    return false;
  }

  /**
   * Aufgesetzte Teile der Vorgabe an ihrem bisherigen Andockpunkt (gleiche Lage, `socketValid`), rekursiv (Stapel).
   * false = ein Pflicht-Andockpunkt bleibt leer (dann gilt die Vorgabe nicht).
   */
  private keepSockets(parent: Pick<Entry, 'key' | 'placed'>, hintKey: string): boolean {
    for (const h of this.opts.keep ?? []) {
      if (h.parentKey !== hintKey || this.keepUsed.has(h.key)) continue;
      const sock = parent.placed.sockets.find((x) => x.def.id === h.socketId && x.pos !== undefined);
      // wie `fillSockets`: nur, was der Andockpunkt in dieser Katalog-Sicht annimmt (Zielversion, Block-Regeln)
      const def = sock === undefined ? undefined : this.catalog.byTags(sock.def.accepts, this.opts.dataVersion).find((d) => d.id === h.componentId);
      if (sock === undefined || def === undefined || !mountFits(def, sock.def)) continue;
      let exp: ExpandedComponent;
      try {
        exp = this.expand(def, h.variantId);
      } catch {
        continue; // Variante in dieser Sicht ausgeblendet (gesperrter Block) oder nicht mehr im Katalog
      }
      const p = socketPlacement(sock, parent.placed, exp, this.a);
      if (p === undefined || !samePose(p.pose, h.pose) || !socketValid(p, def, sock, this.a, this.occ)) continue;
      const child = this.commit(def, h.variantId, p, { parentKey: parent.key, socketId: sock.def.id });
      this.keepUsed.add(h.key);
      this.keepSockets(child, h.key);
    }
    return parent.placed.sockets.every((x) => x.def.required !== true || x.pos === undefined || this.entries.some((e) => e.parentKey === parent.key && e.socketId === x.def.id));
  }

  /**
   * Zellen, die eine anschließende Zeile neben diesem Objekt braucht (W3-IN): Anzahl der Programm-Objekte, deren
   * `near` mit `sameWall` auf seine Tags zeigt, höchstens 3; 0 = kein Kopf einer Zeile.
   */
  private lineAfter(item: ProgramItem): number {
    const n = this.program.filter((o) => o !== item && o.near?.sameWall === true && o.near.tags.some((t) => item.tags.includes(t))).length;
    return Math.min(3, n);
  }

  /** W7: die Insel des Raums, wenn das Programm-Objekt ihr Eintrag ist. */
  private islandOf(item: ProgramItem): IslandPlan | undefined {
    const isl = this.a.island;
    return isl !== undefined && item.entry === isl.entry ? isl : undefined;
  }

  /** Gesetzte Leuchten (W3-IN, Licht-Budget). */
  private lightCount(): number {
    return this.entries.filter((e) => isLightFixture(e.def)).length;
  }

  /**
   * Licht an einem Andockpunkt (W3-IN, I7): Leuchten nur im Budget; mit `lighting.anchors` nur an Anker-Möbeln (Kerzen
   * auf dem Tisch, Hängelaterne über der Tafel – keine Laterne auf Theke, Fass oder Truhe) und je Möbel höchstens ein
   * stehendes und ein hängendes Licht (Kerzen auf dem Tisch und eine Laterne darüber, wie in den Vorbildern). Ein Anker
   * ohne Licht dieser Art nimmt bevorzugt eine Leuchte, wenn der Andockpunkt eine aufnimmt. Pflicht-Andockpunkte bleiben
   * unberührt. Ohne Budget und Anker unverändert.
   */
  private socketLights(parent: Entry, defs: readonly ComponentDef[], hang: boolean): readonly ComponentDef[] {
    if (this.lightMax === Infinity && this.lightAnchors === undefined) return defs;
    const anchors = this.lightAnchors;
    const anchored = anchors === undefined || parent.def.tags.some((t) => anchors.includes(t));
    const lit = anchors !== undefined && this.entries.some((e) => e.parentKey === parent.key && isLightFixture(e.def) && (e.def.mount === 'ceiling') === hang);
    const allowed = anchored && !lit && this.lightCount() < this.lightMax;
    const out = defs.filter((d) => !isLightFixture(d) || allowed);
    if (anchors !== undefined && allowed) {
      const lights = out.filter(isLightFixture);
      // stehend: Kerzen vor der Tischlaterne (Vorbilder: Kerzen auf dem Tisch, die Laterne hängt darüber)
      const candles = hang ? [] : lights.filter((d) => d.tags.includes('candles'));
      if (candles.length > 0) return candles;
      if (lights.length > 0) return lights;
    }
    return out;
  }

  private commit(def: ComponentDef, variantId: string | undefined, placed: PlacedComponent, link: Pick<Entry, 'item' | 'parentKey' | 'socketId'>): Entry {
    const e: Entry = { key: `k${this.n++}`, def, variantId, placed, ...link };
    this.entries.push(e);
    this.occ.add(placed, useCellsOf(placed, this.geom));
    this.version++;
    this.opts.trace?.({
      type: 'commit', key: e.key, componentId: def.id, ...(variantId !== undefined ? { variantId } : {}), placed, occ: this.occ,
      ...(link.item !== undefined ? { item: link.item } : {}), ...(link.parentKey !== undefined ? { parentKey: link.parentKey } : {}),
      ...(link.socketId !== undefined ? { socketId: link.socketId } : {}),
    });
    return e;
  }

  /** Entfernt einen Eintrag samt Nachfahren. */
  private remove(key: string): void {
    const gone = new Set([key]);
    for (const e of this.entries) if (e.parentKey !== undefined && gone.has(e.parentKey)) gone.add(e.key); // Eltern stehen vor Kindern
    this.entries = this.entries.filter((e) => !gone.has(e.key));
    this.rebuild();
    this.opts.trace?.({ type: 'remove', keys: [...gone] });
  }

  /**
   * Kinder an den Sockets: Paare (`pairWith`) gemeinsam gewürfelt, Konsistenzgruppen mit gleicher Form,
   * Blickrichtung nach `facing`, Formen passend zur lichten Höhe. Stapel-Kinder (`above`/`below`) füllen ihre
   * eigenen Stapel-Sockets weiter (Truhe auf Truhe auf Truhe, bis die Regeln – Decke, `containerOpen` – enden);
   * `stackOnly` = nur noch Stapel-Sockets. false = ein Pflicht-Socket (`required`) ließ sich nicht füllen.
   */
  private fillSockets(parent: Entry, rng: Rng, depth: number, stackOnly: boolean): boolean {
    const H = this.geom.height;
    const chosen = new Map<string, { def: ComponentDef; variantId: string | undefined }>();
    /** Gewürfelte, zur Höhe passende Variante (gedehnt); null = keine Variante passt. */
    const fitting = (def: ComponentDef): string | undefined | null => {
      const v = pickFittingVariant(def, rng, H);
      return v === undefined ? null : adaptVariant(def, v.id, H);
    };
    for (const group of socketGroups(parent.placed.sockets)) {
      const lead = group[0]!;
      const stack = lead.def.type === 'above' || lead.def.type === 'below';
      if (stackOnly && !stack) continue;
      const required = group.some((x) => x.def.required === true);
      if (lead.pos === undefined) continue;
      if (!required && !rng.chance(Math.max(...group.map((x) => x.def.prob ?? 1)))) continue;
      const fits = this.catalog
        .byTags(lead.def.accepts, this.opts.dataVersion)
        .filter((d) => mountFits(d, lead.def) && (d.variants?.some((v) => fitsRoomHeight(d, v.id, H)) ?? fitsRoomHeight(d, undefined, H)));
      const defs = required ? fits : this.socketLights(parent, fits, lead.def.type === 'hang');
      if (defs.length === 0) {
        if (required) return false;
        continue;
      }
      // Deko-Kinder (Kerzen, Topfpflanzen, Kuchen) nur im Deko-Budget; Pflicht-Andockpunkte (Hocker, Nachttisch) immer
      if (!required && defs.every(isDecorDef) && this.entries.filter((e) => isDecorDef(e.def)).length >= this.decorMax) continue;
      const ck = consistencyKey(lead.def, group.length > 1);
      const prev = ck === undefined ? undefined : chosen.get(ck.key);
      let def: ComponentDef;
      let variantId: string | undefined;
      if (prev !== undefined) {
        def = prev.def;
        variantId = ck!.sameVariant ? prev.variantId : (fitting(def) ?? prev.variantId);
      } else {
        // feat/theme-moods: mit Stimmung nach Stil-Vorliebe gewichtet (ohne: unverändert gleichverteilt)
        def = MOOD === undefined ? rng.pick(defs) : rng.weighted(defs, (d) => 2 ** MOOD!.style(d));
        variantId = fitting(def) ?? undefined;
        if (ck !== undefined) chosen.set(ck.key, { def, variantId });
      }
      // Wiederholung begrenzen (Kuchen auf jedem Tisch wirkt wild): Deko-Kind derselben Komponente nur `…_REPEAT` mal
      if (!required && isDecorDef(def)) {
        const same = this.entries.filter((e) => e.def.id === def.id).length;
        if (same >= (def.tags.includes('food') ? FOOD_CHILD_REPEAT : DECOR_CHILD_REPEAT)) continue;
      }
      const exp = this.expand(def, variantId);
      for (const sock of group) {
        const p = mountFits(def, sock.def) ? socketPlacement(sock, parent.placed, exp, this.a) : undefined;
        if (p === undefined || !socketValid(p, def, sock, this.a, this.occ)) {
          if (sock.def.required === true) return false;
          continue;
        }
        const child = this.commit(def, variantId, p, { parentKey: parent.key, socketId: sock.def.id });
        const childRng = rng.fork(`s.${sock.def.id}`);
        if (stack && depth < MAX_STACK) this.fillSockets(child, childRng, depth + 1, true);
        else if (!stack && !stackOnly && depth < SOCKET_DEPTH) this.fillSockets(child, childRng, depth + 1, false);
      }
    }
    return true;
  }

  /**
   * Begrenztes Backtracking für ein Pflichtobjekt (research/02 §7.6): nacheinander eines der zuletzt platzierten
   * Objekte (die die meisten Posen blockieren zuerst) entfernen, das Pflichtobjekt setzen, das Opfer neu setzen.
   * Ist das Opfer ein Signatur-Möbel, gibt es als zweiten Versuch seine Kompaktform vorab (Reparatur statt Warnung).
   * Gelingt beides, bleibt es; sonst zurück. Liefert eine Notiz für die Qualitätsanzeige.
   */
  repair(idx: number, rng: Rng): string | undefined {
    const item = this.program[idx]!;
    const want = this.wantedCells(item);
    const recent = this.entries.filter((e) => e.item !== undefined).slice(-BACKTRACK_VICTIMS).reverse();
    const impact = (e: Entry): number => e.placed.cells.filter((c) => c.pos[1] === this.geom.baseY && want.has(cellKey(c.pos[0], c.pos[2]))).length;
    const victims = recent.map((e, r) => ({ e, r, i: impact(e) })).sort((p, q) => q.i - p.i || p.r - q.r).map((x) => x.e);
    const what = item.tags.join('|');
    SOLVER_COUNTERS.repairs++;
    this.opts.trace?.({ type: 'repair', idx, victims: victims.map((v) => v.key) });
    for (const v of victims) {
      const attempts: [string, () => boolean][] = [
        [`${v.def.id} umgestellt`, () => this.placeItem(idx, rng.fork(`place.${v.key}`)) && this.placeItem(v.item!, rng.fork(`again.${v.key}`))],
      ];
      if (this.program[v.item!]!.signature) {
        attempts.push([`${v.def.id} in Kompaktform`, () => this.placeItem(v.item!, rng.fork(`compact.${v.key}`), true) && this.placeItem(idx, rng.fork(`after.${v.key}`))]);
      }
      for (const [how, attempt] of attempts) {
        const snapshot = this.entries;
        SOLVER_COUNTERS.repairTries++;
        this.remove(v.key);
        const ok = attempt();
        this.opts.trace?.({ type: 'repair-try', idx, victim: v.key, how, ok });
        if (ok) return `Pflichtobjekt ${what} per Backtracking platziert (${how})`;
        this.entries = snapshot;
        this.rebuild();
        this.opts.trace?.({ type: 'restore', keys: snapshot.map((e) => e.key) });
      }
    }
    return undefined;
  }

  /** Bodenzellen aller Posen eines Objekts im leeren Raum (Maß für „blockiert am meisten“). */
  private wantedCells(item: ProgramItem): Set<string> {
    const empty = new Occupancy(this.geom.baseY);
    for (const f of this.opts.fixed ?? []) empty.add(f, useCellsOf(f, this.geom));
    const out = new Set<string>();
    for (const o of this.options(item.tags, item.signature)) {
      for (const p of enumeratePoses(o.def, o.exp, this.a, empty)) for (const c of p.cells) out.add(cellKey(c.pos[0], c.pos[2]));
    }
    return out;
  }

  /** Weiche Bewertung für ein Objekt (Vorberechnung je Objekt, dann je Pose). */
  private scorer(item: ProgramItem, idx: number): (p: PlacedComponent, def: ComponentDef) => number {
    const a = this.a;
    const g = this.geom;
    const pref = item.pref;
    const others = this.entries;
    const sameRow = (e: Entry): boolean => item.pattern?.kind === 'row' && e.item !== undefined && this.program[e.item]!.entry === item.entry;
    const zi = this.zoneOf.get(idx);
    const zone = zi === undefined ? undefined : this.zones[zi];
    const anchor = zi === undefined ? undefined : this.entries.find((e) => e.item !== undefined && this.zoneOf.get(e.item) === zi && e.def.mount === 'floor');
    const rowMates = item.pattern?.kind === 'row' ? this.entries.filter(sameRow) : [];
    const gap = item.pattern?.gap ?? 1;
    // erstes Stück einer Reihe: an einem Wandstück, das für alle Stück reicht (nicht am Mittelgang: Doppelreihe)
    const rowCount = item.pattern?.kind === 'row' && rowMates.length === 0 && this.a.layout?.aisle === undefined ? this.program.filter((i) => i.entry === item.entry).length : 0;
    const ceilingOthers = this.entries.filter((e) => e.def.mount === 'ceiling');
    const layout = this.layoutScorer(item, rowMates, gap);
    const usedJobs = this.usedJobs();
    const near = item.near;
    const nearRefs = near === undefined ? [] : this.entries.filter((e) => e.def.mount === 'floor' && e.def.tags.some((t) => near.tags.includes(t)));
    // Kopf einer Zeile (W3-IN): schließen andere Einträge mit `near.sameWall` an dieses Objekt an (Arbeitszeile am
    // Herd), sucht es ein Wandstück, auf dem die Zeile Platz hat (eigene Breite + bis zu 3 Stück daneben)
    const line = item.near === undefined ? this.lineAfter(item) : 0;
    const isle = this.islandOf(item);
    return (p, def) => {
      const infos = baseInfos(p, a);
      if (infos.length === 0) return 0;
      let s = 0;
      // Q1b (research/52 §6 Hebel 1): Reihenfolge der Wunschzonen = Priorität (`zoneWeight`, halbiert je Rang).
      // Die erste Zone bekommt volle Punktzahl; `["corner","edge"]` zieht damit eine freie Ecke der Wandkante vor.
      if (pref.zones !== undefined) s += (infos.reduce((t, i) => t + zoneWeight(i.cls, pref.zones!), 0) / infos.length) * 2;
      if (def.rotations === 'backToWall' || def.mount === 'wall') s += 1; // gültig heißt hier schon: an der Wand
      const avg = (f: (k: string) => number): number => infos.reduce((t, i) => t + f(cellKey(i.cell[0], i.cell[1])), 0) / infos.length;
      const dDoor = avg((k) => a.dDoor.get(k) ?? 0);
      if (Number.isFinite(dDoor)) {
        if (pref.doorAffinity === 'far') s += (dDoor / this.dDoorMax) * 1.5;
        if (pref.doorAffinity === 'near') s += (1 - dDoor / this.dDoorMax) * 1.5;
      }
      if (pref.windowAffinity === 'near') s += infos.some((i) => i.nearWindow) ? 1 : 0;
      // Gleiche Objekte nicht zusammenklumpen (außer Reihen desselben Eintrags)
      for (const e of others) {
        if (sameRow(e)) continue;
        const shared = e.def.tags.filter((t) => def.tags.includes(t)).length;
        if (shared === 0) continue;
        const d = Math.abs(e.placed.pose.pos[0] - p.pose.pos[0]) + Math.abs(e.placed.pose.pos[2] - p.pose.pos[2]);
        if (d < 3) s -= (3 - d) * 0.3 * shared;
      }
      // Deckenlampen: möglichst weit weg von Wänden, nicht neben anderen Deckenobjekten (verteilt, V3)
      if (def.mount === 'ceiling') {
        s += avg((k) => a.dWall.get(k) ?? 0) * 0.5;
        for (const e of ceilingOthers) {
          const d = centerDist(p, e.placed);
          if (d < 4) s -= (4 - d) * W.ceilingSpread;
        }
      }
      // Wand in der Höhe (V3): Wunsch-Höhe zuerst, bevorzugt über niedrigen Möbeln statt auf freier Wand
      if (def.mount === 'wall') {
        const levels = wallLevels(def, p.expanded.size[1], g);
        const li = levels.indexOf(p.pose.pos[1]);
        if (levels.length > 1 && li >= 0) s += W.wallLevel * (1 - li / levels.length);
        const bottom = Math.min(...p.cells.map((c) => c.pos[1]));
        const base = p.cells.filter((c) => c.pos[1] === bottom);
        const over = base.filter((c) => this.occ.floor.has(cellKey(c.pos[0], c.pos[2]))).length;
        if (over > 0) s += W.overFurniture * (0.5 + (0.5 * over) / base.length);
      }
      // Platz für die Kinder an `adjacent`-Sockets (symmetrische Nachttische, Hocker rundum)
      const adj = p.sockets.filter((x) => x.def.type === 'adjacent' && x.pos !== undefined);
      if (adj.length > 0) {
        const own = new Set(p.cells.map((c) => cellKey(c.pos[0], c.pos[2])));
        const free = adj.filter(({ pos }) => {
          const [x, , z] = pos!;
          const k = cellKey(x, z);
          return g.interior.has(x, z) && !a.blocked.has(x, z) && !a.doorZone.has(x, z) && !this.occ.floor.has(k) && !own.has(k);
        }).length;
        s += (W.sockets * free) / adj.length;
      }
      // Funktionszone: in der eigenen Teilfläche, nahe am Anker der Zone
      if (zone !== undefined) {
        s += (W.zone * infos.filter((i) => zone.cells.has(i.cell[0], i.cell[1])).length) / infos.length;
        if (anchor !== undefined) s += W.anchor * Math.max(0, 1 - centerDist(p, anchor.placed) / 8);
      }
      // W7: Insel-Möbel auf der Insel (Anteil der gedeckten Inselzellen)
      if (isle !== undefined) s += (W.island * p.cells.filter((c) => c.pos[1] === g.baseY && isle.cells.has(c.pos[0], c.pos[2])).length) / isle.cells.size;
      // Signatur-Anordnung (W3-IN): Nähe, gleiche Wand und Blick zum Bezugsmöbel
      if (nearRefs.length > 0) s += nearScore(p, def, nearRefs.map((e) => e.placed), near!);
      if (line > 0 && def.rotations === 'backToWall') {
        const width = p.pose.rot % 2 === 0 ? p.size[0] : p.size[2];
        const run = this.lowRun(p);
        s += W.lineRun * Math.min(1, run / (width + line));
        // W7 (27.09.2026): füllt das Stück sein Wandstück ganz aus, schließt dort nichts an (Alchemie: die lange
        // Apotheker-Theke über die ganze Wand ließ Kessel und Bord keinen Platz) – dann zählt die Größe nicht mehr vor
        if (run <= width) s -= W.lineRun;
      }
      // Villager-Stände: jeder Stand ein anderer Arbeitsblock (`distinctJobBlocks`; Signatur-Formen werden gemeinsam
      // gewertet, der Abzug liegt über Vielfalts-Wurf + Auswahlfenster)
      if (usedJobs.size > 0 && isJobStation(p.expanded)) s -= W.distinctJob * jobBlocksOf(p.expanded).filter((j) => usedJobs.has(j)).length;
      // Raumtyp-Layout: Doppelreihe am Mittelgang statt Reihe an einer Wand (K3c)
      if (layout !== undefined) {
        s += layout.bonus(p, def);
        if (layout.rows) return s;
      }
      // Reihe: gleiche Drehung, gleiche Linie, fester Rhythmus (Breite + Abstand)
      let row = 0;
      if (rowCount > 1) {
        const even = p.pose.rot % 2 === 0;
        const need = rowCount * ((even ? p.size[0] : p.size[2]) + gap) - gap;
        row = W.row * Math.min(1, this.wallRun(p) / need);
      }
      for (const m of rowMates) {
        const q = m.placed;
        if (q.pose.rot !== p.pose.rot) continue;
        const even = p.pose.rot % 2 === 0;
        if ((even ? q.pose.pos[2] : q.pose.pos[0]) !== (even ? p.pose.pos[2] : p.pose.pos[0])) continue;
        const along = Math.abs(even ? q.pose.pos[0] - p.pose.pos[0] : q.pose.pos[2] - p.pose.pos[2]);
        row = Math.max(row, along === (even ? p.size[0] : p.size[2]) + gap ? W.row : W.rowLine);
      }
      return s + row;
    };
  }

  /**
   * Weiche Wertung des Raumtyp-Layouts (K3c). Reihen am Mittelgang (`rows`): Stücke abwechselnd links/rechts (die
   * Seite mit weniger Stücken), gespiegelt zum offenen Gegenstück auf der anderen Seite, im Rhythmus (Tiefe + gap)
   * zum Nachbarn derselben Seite; Möbel mit `backToWall` mit dem Rücken zur Seitenwand, frei drehbare mit Blick zur
   * Stirnseite (Bankreihen quer zur Achse); das erste Stück nahe der Stirnseite. Dazu: Blickpunkt-Signatur mittig auf
   * der Achse, Läufer im Gang, erlaubte Zentralstücke in der Freifläche. undefined = kein Layout betrifft das Objekt.
   */
  private layoutScorer(item: ProgramItem, rowMates: readonly Entry[], gap: number): { rows: boolean; bonus: (p: PlacedComponent, def: ComponentDef) => number } | undefined {
    const lay = this.a.layout;
    if (lay === undefined) return undefined;
    const aisle = lay.aisle;
    const focal = aisle !== undefined && item.signature && item.pattern === undefined;
    const reserve = lay.reserve;
    const inReserve = (p: PlacedComponent): number => {
      const base = p.cells.filter((c) => c.pos[1] === this.geom.baseY);
      return base.length === 0 ? 0 : base.filter((c) => reserve!.cells.has(c.pos[0], c.pos[2])).length / base.length;
    };
    const extras = (p: PlacedComponent, def: ComponentDef): number => {
      let s = 0;
      if (focal && resolveRelDir('back', p.pose) === aisle.head) {
        const b = boxOf(p, aisle);
        const off = Math.abs((b.a0 + b.a1) / 2 - (aisle.from + aisle.to) / 2);
        if (off <= 0.5) s += W.focal;
      }
      if (aisle !== undefined && p.expanded.walkable) s += (W.focal * p.cells.filter((c) => aisle.cells.has(c.pos[0], c.pos[2])).length) / Math.max(1, p.cells.length);
      if (reserve !== undefined && reserve.allow.some((t) => def.tags.includes(t))) s += W.focal * inReserve(p);
      return s;
    };
    if (aisle === undefined || item.pattern?.kind !== 'row') return { rows: false, bonus: extras };
    const mates = rowMates.map((m) => ({ b: boxOf(m.placed, aisle), side: sideOf(boxOf(m.placed, aisle), aisle) }));
    const capL = aisle.from - aisle.lo;
    const capR = aisle.hi - aisle.to;
    const nL = mates.filter((m) => m.side < 0).length;
    const nR = mates.filter((m) => m.side > 0).length;
    const target = capL <= 0 ? 1 : capR <= 0 ? -1 : nL <= nR ? -1 : 1;
    const mirror = (b: Box): Box => ({ a0: aisle.from + aisle.to - b.a1, a1: aisle.from + aisle.to - b.a0, l0: b.l0, l1: b.l1 });
    const same = (b: Box, c: Box): boolean => b.a0 === c.a0 && b.a1 === c.a1 && b.l0 === c.l0 && b.l1 === c.l1;
    const open = mates.filter((m) => m.side === -target && !mates.some((o) => o.side === target && same(o.b, mirror(m.b)))).map((m) => mirror(m.b));
    const ownSide = mates.filter((m) => m.side === target).map((m) => m.b);
    const len = Math.max(1, aisle.end - aisle.start);
    const headAtStart = aisle.head === 'north' || aisle.head === 'west';
    return {
      rows: true,
      bonus: (p, def) => {
        const b = boxOf(p, aisle);
        const side = sideOf(b, aisle);
        let s = extras(p, def) + (side === target ? W.aisleSide : 0);
        const headFacing = def.mount === 'floor' && def.rotations !== 'backToWall';
        if (headFacing ? resolveRelDir('front', p.pose) === aisle.head : side !== 0 && resolveRelDir('back', p.pose) === sideWall(side, aisle)) s += W.aisleFacing;
        let pair = 0;
        for (const m of open) pair = Math.max(pair, same(b, m) ? W.row : b.l0 === m.l0 && b.l1 === m.l1 ? W.rowLine : 0);
        for (const m of ownSide) {
          if (m.a0 !== b.a0 || m.a1 !== b.a1) continue;
          pair = Math.max(pair, Math.abs(m.l0 - b.l0) === b.l1 - b.l0 + 1 + gap ? W.row : W.rowLine);
        }
        if (mates.length === 0) s += W.aisleHead * (1 - (headAtStart ? b.l0 - aisle.start : aisle.end - b.l1) / len);
        return s + pair;
      },
    };
  }

  /** Länge des festen Wandstücks hinter der Pose (0 ohne Wand im Rücken). */
  private wallRun(p: PlacedComponent): number {
    if (this.runs === undefined) {
      this.runs = new Map();
      for (const seg of this.a.wallSegments) for (const c of seg.cells) this.runs.set(`${cellKey(c[0], c[1])}>${seg.wall}`, seg.cells.length);
    }
    const back = resolveRelDir('back', p.pose);
    const rear = p.cells.find((c) => c.local[2] === 0);
    return rear === undefined ? 0 : this.runs.get(`${cellKey(rear.pos[0], rear.pos[2])}>${back}`) ?? 0;
  }

  /**
   * Wandlauf für eine Zeile (W3-IN): zusammenhängende Zellen entlang der Wand hinter der Pose, an denen niedrige Möbel
   * anlehnen können (feste Wand oder Fenster mit Brüstung, keine Tür, keine Türzone, nichts gesperrt) – inklusive der
   * eigenen Rückseite.
   */
  private lowRun(p: PlacedComponent): number {
    const back = resolveRelDir('back', p.pose) as HorizontalDir;
    const ok = (x: number, z: number): boolean =>
      this.geom.interior.has(x, z) && !this.a.doorZone.has(x, z) && !this.a.blocked.has(x, z) && this.a.info.get(cellKey(x, z))?.lowWalls?.includes(back) === true;
    const rear = p.cells.filter((c) => c.local[2] === 0 && c.pos[1] === this.geom.baseY).map((c) => [c.pos[0], c.pos[2]] as const);
    if (rear.length === 0) return 0;
    const [dx, dz] = back === 'north' || back === 'south' ? [1, 0] : [0, 1];
    const xs = rear.map(([x, z]) => (dx === 1 ? x : z));
    const [x0, z0] = rear[0]!;
    let lo = Math.min(...xs);
    let hi = Math.max(...xs);
    const at = (t: number): [number, number] => (dx === 1 ? [t, z0] : [x0, t]);
    while (ok(...at(lo - 1))) lo--;
    while (ok(...at(hi + 1))) hi++;
    return hi - lo + 1;
  }

  /** Qualitätswert und Begründungen (research/02 §7.9). */
  /**
   * W5 (27.09.2026, Review N6): Kette der Signatur-Anordnung – Möbel mit `near`, die (auch über andere solche Möbel)
   * an einem Stück ihres ersten Bezugs-Tags hängen (Küche: Arbeitsmöbel in der Zeile am Herd). Maß für den Weg-Versuch
   * `spare`: er darf die Kette nicht kürzen.
   */
  anchorChain(): number {
    const related = this.entries.filter((e) => e.item !== undefined && this.program[e.item]!.near !== undefined);
    const reached = new Set<Entry>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of related) {
        if (reached.has(e)) continue;
        const n = this.program[e.item!]!.near!;
        const hit = this.entries.some((r) => r !== e && r.def.mount === 'floor' && footprintGap(e.placed, r.placed) <= (n.maxGap ?? 0)
          && (r.def.tags.includes(n.tags[0]!) || reached.has(r)));
        if (hit) {
          reached.add(e);
          grew = true;
        }
      }
    }
    return reached.size;
  }

  quality(): RoomQuality {
    const g = this.geom;
    const byItem = new Map<number, Entry>();
    for (const e of this.entries) if (e.item !== undefined) byItem.set(e.item, e);
    const parts: QualityPart[] = [];
    const req = this.program.map((it, i) => ({ it, i })).filter((x) => x.it.required);
    const reqOk = req.filter((x) => byItem.has(x.i)).length;
    if (reqOk === req.length) parts.push({ id: 'required', label: 'Pflichtobjekte', value: 1, detail: `${reqOk} von ${req.length}` });
    else {
      // W8-E: Pflicht heißt die Mindestzahl je Eintrag; Stücke darüber (`aboveMin`, Flächenzahl) sind Wunsch und zählen im
      // Teilwert „Raumprogramm“. Je Eintrag zählen gesetzte Stücke bis zur Mindestzahl.
      let need = 0;
      let ok = 0;
      for (const entry of new Set(req.map((x) => x.it.entry))) {
        const mine = req.filter((x) => x.it.entry === entry);
        const least = mine.filter((x) => x.it.aboveMin !== true).length;
        need += least;
        ok += Math.min(least, mine.filter((x) => byItem.has(x.i)).length);
      }
      const detail = need === req.length ? `${ok} von ${need}` : `${ok} von ${need} (Mindestzahl; gesetzt ${reqOk} von ${req.length} gewünschten)`;
      parts.push({ id: 'required', label: 'Pflichtobjekte', value: need === 0 ? 1 : ok / need, detail });
    }
    const sig = this.program.map((it, i) => ({ it, i })).filter((x) => x.it.signature);
    if (sig.length > 0) {
      const ratios = sig.map(({ it, i }) => {
        const options = this.options(it.tags, true);
        const size = this.sizeOf(options);
        const max = Math.max(1e-9, ...options.map(size));
        const minFp = Math.min(...options.map((x) => x.footprint));
        const e = byItem.get(i);
        const o = e === undefined ? undefined : options.find((x) => x.def === e.def && x.variantId === e.variantId);
        // Rückfall beim Signatur-Tausch (Form ohne passenden Stil): zählt wie eine Kompaktform zur Hälfte
        if (o === undefined && e !== undefined && this.opts.styles !== undefined) return { e, r: 0.5, compact: true };
        return { e, r: o === undefined ? 0 : size(o) / max, compact: o !== undefined && o.footprint === minFp && options.some((x) => x.footprint > minFp) };
      });
      const forms = ratios.map((x) => x.e?.def.id ?? 'fehlt').join(', ');
      const value = ratios.reduce((t, x) => t + x.r, 0) / ratios.length;
      const detail = ratios.some((x) => x.compact) ? `Kompaktform (${forms}): keine gültige Pose für eine größere Form` : forms;
      parts.push({ id: 'signature', label: 'Signatur-Möbel', value, detail });
    }
    parts.push({ id: 'program', label: 'Raumprogramm', value: this.program.length === 0 ? 1 : byItem.size / this.program.length, detail: `${byItem.size} von ${this.program.length} Objekten` });
    const prefs = [...byItem].map(([i, e]) => prefSatisfaction(e.placed, this.a, this.program[i]!.pref, this.dDoorMax));
    parts.push({ id: 'preferences', label: 'Wunschlage', value: prefs.length === 0 ? 1 : prefs.reduce((t, v) => t + v, 0) / prefs.length });
    const walk = [...g.interior].filter(([x, z]) => !this.occ.floor.has(cellKey(x, z))).length / Math.max(1, g.interior.size);
    parts.push({ id: 'space', label: 'Laufraum', value: walk / 0.4, detail: `${Math.round(walk * 100)} % der Bodenfläche frei` });
    if (this.zones.length > 1) {
      const zoned = [...byItem].filter(([i]) => this.zoneOf.has(i));
      const inZone = zoned.filter(([i, e]) => {
        const c = centerCell(e.placed);
        return this.zones[this.zoneOf.get(i)!]!.cells.has(c[0], c[1]);
      }).length;
      parts.push({ id: 'zones', label: 'Funktionszonen', value: zoned.length === 0 ? 1 : inZone / zoned.length, detail: `${this.zones.length} Zonen, ${inZone} von ${zoned.length} Objekten in ihrer Zone` });
    }
    // Signatur-Anordnung (W3-IN, `near`): Anteil der Möbel, die an ihrem Bezugsmöbel stehen
    const related = [...byItem].filter(([i]) => this.program[i]!.near !== undefined);
    if (related.length > 0) {
      const ok = related.filter(([i, e]) => {
        const n = this.program[i]!.near!;
        return this.entries.some((r) => r !== e && r.def.mount === 'floor' && r.def.tags.some((t) => n.tags.includes(t)) && footprintGap(e.placed, r.placed) <= (n.maxGap ?? 0));
      }).length;
      parts.push({ id: 'arrangement', label: 'Signatur-Anordnung', value: ok / related.length, detail: `${ok} von ${related.length} Möbeln an ihrem Bezugsmöbel` });
    }
    const v = verticality(this.entries.map((e) => e.placed), g);
    parts.push({ id: 'vertical', label: 'Vertikalität', value: v.ratio, detail: `${v.levels} von ${v.height} Höhenebenen genutzt, ${v.above} Blöcke über Kopfhöhe` });
    const aisle = this.a.layout?.aisle;
    if (aisle !== undefined) {
      // Doppelreihe: Anteil der Pflicht-Reihen-Stücke mit gespiegeltem Gegenstück (erreichbar: 2 · ⌊n/2⌋ je Reihe);
      // optionale Reihen (Wandpfeiler als Schmuck) zählen nicht
      let paired = 0;
      let possible = 0;
      for (const entry of new Set(this.program.filter((it) => it.pattern?.kind === 'row' && it.required).map((it) => it.entry))) {
        const boxes = [...byItem].filter(([i]) => this.program[i]!.entry === entry).map(([, e]) => boxOf(e.placed, aisle));
        const m = (b: Box): Box => ({ a0: aisle.from + aisle.to - b.a1, a1: aisle.from + aisle.to - b.a0, l0: b.l0, l1: b.l1 });
        paired += boxes.filter((b) => boxes.some((c) => c.a0 === m(b).a0 && c.a1 === m(b).a1 && c.l0 === b.l0 && c.l1 === b.l1 && c !== b)).length;
        possible += 2 * Math.floor(boxes.length / 2);
      }
      const detail = `Mittelgang ${aisle.width} breit${possible > 0 ? `, ${paired} von ${possible} Reihen-Stücken gespiegelt` : ''}`;
      // halbes Gewicht: Fenster und Türen verhindern oft das exakte Spiegelbild, der freie Gang zählt schon für sich
      parts.push({ id: 'aisle', label: 'Mittelgang', value: possible === 0 ? 1 : 0.5 + (0.5 * paired) / possible, detail });
    }
    // Nachweis unendliche Wasserquelle (`infiniteWater`): wenn eine Wasser-Quelle mit Quellblöcken Pflicht ist oder steht
    const source = (def: ComponentDef, exp: ExpandedComponent): boolean => def.functionTags?.includes('water_source') === true && (traitsOf(exp).any & T_WATER) !== 0;
    const wanted = this.program.some((it) => it.required && this.options(it.tags, it.signature).some((o) => source(o.def, o.exp)));
    if (wanted || this.entries.some((e) => source(e.def, e.placed.expanded))) {
      const n = infiniteWater(this.entries.map((e) => e.placed), g.baseY);
      parts.push({ id: 'water', label: 'Wasserquelle', value: n > 0 ? 1 : 0, detail: n > 0 ? `${n} unendliche Quelle(n) (2×2 oder 1×3)` : 'keine unendliche Quelle (2×2 oder 1×3 fehlt)' });
    }
    // W8-B (27.09.2026): Wege im Raum – Umweg, Engstellen, Nutzungsseiten am 2 breiten Weg (schwach gewichtet)
    parts.push(walkwayPart(roomWalkways([...(this.opts.fixed ?? []), ...this.entries.map((e) => e.placed)], this.a)));
    return roomQuality(parts, this.notes);
  }
}

/** Gleiche Form wie ein Reihen-Stück; bei Villager-Ständen genügt die Komponente (Varianten = Berufe, gleiche Gestalt). */
const sameForm = (o: Pick<Option, 'def' | 'variantId' | 'exp'>, e: { readonly def: ComponentDef; readonly variantId: string | undefined }): boolean =>
  o.def === e.def && (o.variantId === e.variantId || isJobStation(o.exp));

/** Ausdehnung einer Pose quer (a) und längs (l) zur Gang-Achse. */
interface Box {
  readonly a0: number;
  readonly a1: number;
  readonly l0: number;
  readonly l1: number;
}

function boxOf(p: PlacedComponent, aisle: AislePlan): Box {
  const [x, , z] = p.pose.pos;
  const x1 = x + p.size[0] - 1;
  const z1 = z + p.size[2] - 1;
  return { a0: acrossOf(aisle.axis, x, z), a1: acrossOf(aisle.axis, x1, z1), l0: alongOf(aisle.axis, x, z), l1: alongOf(aisle.axis, x1, z1) };
}

/** Seite am Gang: −1 links (kleinere Quer-Koordinate), 1 rechts, 0 im Gang. */
const sideOf = (b: Box, aisle: AislePlan): -1 | 0 | 1 => (b.a1 < aisle.from ? -1 : b.a0 > aisle.to ? 1 : 0);
const sideWall = (side: -1 | 1, aisle: AislePlan): HorizontalDir => (aisle.axis === 'z' ? (side < 0 ? 'west' : 'east') : side < 0 ? 'north' : 'south');

/**
 * Unendliche Wasserquellen (`infiniteWater`, research/17 §7.4): Wasser-Quellblöcke mit ≥ 2 waagrechten
 * Quell-Nachbarn und festem Grund (Boden oder Block darunter) – so füllt sich ein geschöpfter Block nach (2×2, 1×3).
 */
export function infiniteWater(placed: readonly PlacedComponent[], baseY: number): number {
  const water = new Set<string>();
  const solid = new Set<string>();
  for (const p of placed) {
    const tr = traitsOf(p.expanded);
    p.cells.forEach((c, i) => {
      const k = `${c.pos[0]},${c.pos[1]},${c.pos[2]}`;
      if ((tr.cells[i]! & T_WATER) !== 0) water.add(k);
      else solid.add(k);
    });
  }
  let n = 0;
  for (const k of water) {
    const [x, y, z] = k.split(',').map(Number) as [number, number, number];
    const below = `${x},${y - 1},${z}`;
    if (y !== baseY && !solid.has(below) && !water.has(below)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => water.has(`${x + dx!},${y},${z + dz!}`)).length >= 2) n++;
  }
  return n;
}

const centerCell = (p: PlacedComponent): Cell => [Math.floor(p.pose.pos[0] + (p.size[0] - 1) / 2), Math.floor(p.pose.pos[2] + (p.size[2] - 1) / 2)];
const centerDist = (p: PlacedComponent, q: PlacedComponent): number =>
  Math.abs(p.pose.pos[0] + p.size[0] / 2 - q.pose.pos[0] - q.size[0] / 2) + Math.abs(p.pose.pos[2] + p.size[2] / 2 - q.pose.pos[2] - q.size[2] / 2);

/** Freie Zellen zwischen den Grundflächen zweier Posen (Chebyshev − 1; 0 = anliegend, auch über Eck; −1 = überlappend). */
export function footprintGap(p: PlacedComponent, q: PlacedComponent): number {
  const ax1 = p.pose.pos[0] + p.size[0] - 1;
  const az1 = p.pose.pos[2] + p.size[2] - 1;
  const bx1 = q.pose.pos[0] + q.size[0] - 1;
  const bz1 = q.pose.pos[2] + q.size[2] - 1;
  const dx = Math.max(0, q.pose.pos[0] - ax1, p.pose.pos[0] - bx1);
  const dz = Math.max(0, q.pose.pos[2] - az1, p.pose.pos[2] - bz1);
  return Math.max(dx, dz) - 1;
}

/**
 * Gegenüber: zeigt die Front der Pose auf die Box von `q` (Blickrichtung trifft die Box in ihrer Breite) und steht sie
 * vor dessen Front (Blickrichtungen entgegengesetzt – der Sessel schaut ins Feuer, nicht von der Seite auf den Kamin)?
 */
function facesBox(p: PlacedComponent, q: PlacedComponent): boolean {
  const front = resolveRelDir('front', p.pose);
  if (resolveRelDir('back', q.pose) !== front) return false;
  const cx = p.pose.pos[0] + (p.size[0] - 1) / 2;
  const cz = p.pose.pos[2] + (p.size[2] - 1) / 2;
  const [qx0, qz0] = [q.pose.pos[0], q.pose.pos[2]];
  const [qx1, qz1] = [qx0 + q.size[0] - 1, qz0 + q.size[2] - 1];
  switch (front) {
    case 'north': return qz1 < p.pose.pos[2] && cx >= qx0 - 1 && cx <= qx1 + 1;
    case 'south': return qz0 > p.pose.pos[2] + p.size[2] - 1 && cx >= qx0 - 1 && cx <= qx1 + 1;
    case 'west': return qx1 < p.pose.pos[0] && cz >= qz0 - 1 && cz <= qz1 + 1;
    case 'east': return qx0 > p.pose.pos[0] + p.size[0] - 1 && cz >= qz0 - 1 && cz <= qz1 + 1;
    default: return false;
  }
}

/**
 * Wertung der Signatur-Anordnung (W3-IN, Raumtyp `near`): bestes Bezugsmöbel – voll bei anliegend, linear weniger bis
 * `maxGap`; dazu gleiche Wand (beide mit dem Rücken zur selben Wandrichtung) und Blick zum Bezugsmöbel.
 */
export function nearScore(p: PlacedComponent, def: ComponentDef, refs: readonly PlacedComponent[], near: NonNullable<ProgramItem['near']>): number {
  const maxGap = near.maxGap ?? 0;
  let best = 0;
  for (const r of refs) {
    // überlappende Grundfläche (Bord über der Theke, Kind über dem Möbel) zählt wie anliegend
    const g = Math.max(0, footprintGap(p, r));
    if (g > maxGap) continue;
    let b = W.near * (1 - g / (maxGap + 1));
    if (near.sameWall === true && (def.rotations === 'backToWall' || def.mount === 'wall') && resolveRelDir('back', p.pose) === resolveRelDir('back', r.pose)) b += W.nearWall;
    if (near.facing === true && facesBox(p, r)) b += W.nearFacing;
    best = Math.max(best, b);
  }
  return best;
}

/** Kind-Komponente auf einem freien Andockpunkt einer vorhandenen Komponente (`RoomPlanner.socketPoses`). */
export interface SocketPose {
  readonly parentKey: string;
  readonly socketId: string;
  readonly placed: PlacedComponent;
}

/**
 * Nachträgliches Ergänzen in einem schon eingerichteten Raum (Licht-Pass, später manuelles Platzieren):
 * dieselben harten Regeln wie `furnishRoom`, alle vorhandenen Komponenten sind Hindernisse.
 * Rein und deterministisch; die Auswahl unter den Posen trifft der Aufrufer.
 */
export class RoomPlanner {
  readonly analysis: RoomAnalysis;
  private readonly occ: Occupancy;

  /** `layout` (optional, `FurnishResult.layout`): Mittelgang und Freifläche bleiben auch beim Ergänzen frei. */
  constructor(
    readonly geometry: RoomGeometry,
    existing: readonly PlacedComponent[] = [],
    layout?: RoomLayout,
  ) {
    // W2 (freie Sicht): der Planer ergänzt Licht (Licht-Pass) – für ihn gilt nur die Zelle direkt hinter der Scheibe
    // (Laterne, Kerze, Kette bleiben dort erlaubt), nicht die ganze Sichtachse
    const plain = analyzeRoom(geometry);
    const base: RoomAnalysis = { ...plain, windowView: CellSet.of(geometry.windows.map((w) => w.inside)) };
    this.analysis = layout === undefined ? base : { ...base, layout };
    this.occ = new Occupancy(geometry.baseY);
    for (const p of existing) this.add(p);
    this.occ.dropBlockedUseGroups(geometry.interior);
  }

  /** Alle gültigen Posen (Montage floor, ceiling oder wall) – alle harten Regeln inkl. Konnektivität. */
  poses(def: ComponentDef, variantId?: string): PlacedComponent[] {
    return this.candidates(def, variantId).filter((p) => this.connected(p));
  }

  /**
   * Posen, die alle harten Regeln AUSSER der Konnektivität erfüllen (billig). Wer viele Kandidaten bewertet,
   * prüft `connected` nur für die besten (wie der Solver).
   */
  candidates(def: ComponentDef, variantId?: string): PlacedComponent[] {
    return enumeratePoses(def, expandComponent(def, variantId), this.analysis, this.occ);
  }

  /** Teure Regel: die freie Bodenfläche bleibt zusammenhängend und erreicht jede Tür. */
  connected(p: PlacedComponent): boolean {
    return connectivityOK(p, this.analysis, this.occ);
  }

  /**
   * Passt die Form zur lichten Höhe (`minRoomHeight`/`maxRoomHeight`, V3)? `poses`/`candidates` prüfen das
   * bewusst nicht (Auswahl, keine harte Regel) – wer wie der Solver wählt, filtert damit.
   */
  fitsRoom(def: ComponentDef, variantId?: string): boolean {
    return fitsRoomHeight(def, variantId, this.geometry.height);
  }

  /** Varianten-ID mit der Dehnung für diesen Raum (Kettenlänge, Regal bis zur Decke; ohne `stretch` unverändert). */
  adapt(def: ComponentDef, variantId?: string): string | undefined {
    return adaptVariant(def, variantId, this.geometry.height);
  }

  /** Freie Andockpunkte der Eltern, die die Komponente aufnehmen (Tags, Montage, harte Regeln inkl. Träger). */
  socketPoses(def: ComponentDef, variantId: string | undefined, parents: readonly { readonly key: string; readonly placed: PlacedComponent }[]): SocketPose[] {
    const exp = expandComponent(def, variantId);
    const out: SocketPose[] = [];
    for (const parent of parents) {
      for (const s of parent.placed.sockets) {
        if (!mountFits(def, s.def) || !def.tags.some((t) => s.def.accepts.includes(t))) continue;
        const p = socketPlacement(s, parent.placed, exp, this.analysis);
        if (p !== undefined && socketValid(p, def, s, this.analysis, this.occ)) out.push({ parentKey: parent.key, socketId: s.def.id, placed: p });
      }
    }
    return out;
  }

  /** Bodenzelle im Raum, auf der nichts Nicht-Begehbares in Laufhöhe steht. */
  floorFree(x: number, z: number): boolean {
    return this.geometry.interior.has(x, z) && !this.occ.floor.has(cellKey(x, z));
  }

  /** Übernimmt eine (neue) Komponente als Hindernis. */
  add(p: PlacedComponent): void {
    this.occ.add(p, useCellsOf(p, this.geometry));
  }
}
