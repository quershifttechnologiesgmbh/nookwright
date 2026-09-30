/**
 * Grundriss-Generator v1 (research/19 §7.3): Bautyp + Parameter + Seed → Bauplan. Rein und deterministisch.
 *
 *  1. Größe wählen: Außenmaß (Seitenverhältnis `ratio`, ungerade Maße bevorzugt), Etagen, Höhen, Keller, Flügel.
 *  2. Massing: Baukörper-Rechtecke (`rect`, `hall`, `tower`, `wings` L/T/U, `row`; `fixed` = fester Grundriss).
 *  3. Treppenkern zuerst (stairs.ts).
 *  4. Programm je Etage: Raumwünsche aus dem Programm, Treppenraum, gewichtete Streifenteilung (layout.ts), Flur ab
 *     Tiefe `minDepth`; Nähe (`near`, `adjacent`) als Kosten über mehrere Kandidaten; passt es nicht, entfallen
 *     Wunschräume (nie Pflichträume).
 *  5. Stil: Hülle, Außen, Gelände, Bauwerke aus der Definition (Parameter überschreiben).
 *  6. Prüfen (check.ts), sonst nächster Unter-Seed; spätere Versuche lockern das Programm (Anzahl minimal, dann
 *     ohne Wunschräume). Kein Versuch ohne Befund → der beste Plan mit Warnungen.
 */
import { DEFAULT_FACADE_BAY, DEFAULT_VOLUME, FACADE_QUALITY_RULES, type BuildingSetting, type Shell, type FacadeStyle, type RoofDetail, type RoofStyle, type Volume, type VolumeExterior, type VolumeId } from '@mcda/blueprint';
import {
  BUILDING_SIZES, rangeOf, type BuildingFeaturesDef, type BuildingFloorSel, type BuildingFunctionEntry, type BuildingRange, type BuildingSizeClass, type BuildingTypeDef,
} from '@mcda/catalog';
import { CellSet, Rng, bays, hashSeed, type Cell, type HorizontalDir } from '@mcda/core';
import { WINDOW_OPTIONAL, checkPlan, massingGrid, silhouette, windowlessRooms, type ArchetypeFurnishable } from './check.js';
import { axesOf, boxCells, boxD, boxW, contact, quarterTurns, rotateCell, rotateFacing, uvToXZ, type Axes, type Box } from './frame.js';
import { applyFeatures, chooseCross, type CrossChoice } from './features.js';
import { supportsFunctions, withFunctions } from './functions.js';
import { withSilhouette } from './silhouette.js';
import { edgeAxes, gridFromLines, layoutGrid, lineAxes, mayHaveWindow, snapWidths, type LayoutGrid } from './grid.js';
import { layoutFloor, type Req } from './layout.js';
import type {
  BuildingParams, BuildingPlan, PlanExterior, PlanPart, PlanRing, PlanRoom, PlanShell, PlanSilo, PlanSite, PlanStairs, PlanTowerStyle, PlanWindmill,
} from './plan.js';
import { ladders, switchback, type CoreFloor, type StairCore } from './stairs.js';
import { planUnderground, undergroundDefault, type UndergroundParams } from './underground.js';

/** Katalog-Sicht des Generators. */
export interface ArchetypeContext {
  /** Mindest-Innenfläche eines Raumtyps (Katalog `minArea`). */
  minArea(roomTypeId: string): number;
  /** Protokoll verworfener Unter-Seeds (Diagnose, Berichte). */
  readonly trace?: (line: string, plan?: BuildingPlan) => void;
  /**
   * W6: Feldbreite des Fassadenrasters eines Themes (Katalog `facade.bay`, `undefined` = keine Vorgabe → Standard der
   * Hülle). Mit ihr legt der Planer Trennwände aufs Raster und zählt Räume ohne Fenster an der echten Hülle; fehlt die
   * Funktion, plant er ohne Rasterbezug wie bisher (bitgleich). App und Engine geben dieselbe Quelle
   * (`archetypeContext` in `@mcda/pipeline`).
   */
  readonly facadeBay?: (themeId: string) => number | undefined;
  /**
   * W8-E: Pflichtobjekte ohne Platz im leeren Raum (Einrichtungs-Solver, `requiredWithoutPose`). Ein Versuch mit so
   * einem Raum zählt als Problem, der Planer würfelt weiter wie bei zu kleiner Fläche. Fehlt die Funktion, plant er wie
   * bisher (bitgleich). Feste Grundrisse prüft er damit nicht (sie haben keinen zweiten Versuch).
   */
  readonly furnishable?: ArchetypeFurnishable;
  /**
   * Additiv (Erklärvideo, 27.09.2026): Beobachter der Grundriss-Kandidaten – je Kandidat die Räume und die Kosten je
   * Term, je Etage die Wahl. Nur lesend; fehlt die Option, ist alles wie vorher, mit ihr ist der Plan gleich (Test).
   */
  readonly traceLayout?: (event: LayoutTraceEvent) => void;
}

/** Kosten-Terme eines Grundriss-Kandidaten (Summe = `cost`). */
export interface LayoutCostTerms {
  /** +3 je fehlender Pflicht-Nachbarschaft (`adjacent`, z. B. Küche am Schankraum). */
  adjacent: number;
  /** Gewichtete Nachbarschaft (`adjacencyWeights`): Belohnung (negativ) oder Strafe. */
  adjacencyWeights: number;
  /** +2 je Raum mit `near: entrance/front`, der die Front nicht berührt. */
  nearFront: number;
  /** +1 je Raum mit `near: back`, der die Rückseite nicht berührt. */
  nearBack: number;
  /** +1 je Raum mit `near: stairs` ohne Kontakt zum Treppenraum. */
  nearStairs: number;
  /** Summe |Fläche − Wunschfläche| / Etagenfläche. */
  area: number;
  /** W6: 4 je Raum mit Licht-Bedarf ohne mögliche Fensterachse. */
  dark: number;
  /** W6: 0,5 je Fensterachse am Rand eines Raums. */
  edgeAxis: number;
}

/** Ereignisse für `ArchetypeContext.traceLayout`. Zellen in der kanonischen Lage (Front Süden, vor `orient`). */
export type LayoutTraceEvent =
  | {
    readonly type: 'candidate'; readonly attempt: number; readonly volumeId: string; readonly wing?: string; readonly floor: number;
    /** Nummer der Suche auf dieser Etage (0; weitere, wenn ein Wunschraum ohne Fenster entfällt). */
    readonly search: number; readonly k: number;
    /** Räume des Kandidaten; fehlt, wenn die Streifenteilung scheiterte. */
    readonly rooms?: ReadonlyArray<{ readonly roomTypeId: string; readonly required: boolean; readonly hub: boolean; readonly weight: number; readonly cells: CellSet }>;
    readonly cost?: number; readonly terms?: LayoutCostTerms;
  }
  | { readonly type: 'floor'; readonly attempt: number; readonly volumeId: string; readonly wing?: string; readonly floor: number; readonly search: number; readonly k: number; readonly cost: number; readonly dropped: readonly string[] }
  | { readonly type: 'attempt'; readonly attempt: number; readonly failed?: string; readonly problems: readonly string[]; readonly score?: number };

/**
 * W6: Feldbreite, mit der die Hülle diesen Plan rastern wird – wie `facadeForTheme` (`@mcda/pipeline`): die der Regeln,
 * sonst die des Themes, sonst der Standard der Hülle. `undefined` ohne Raster-Regel oder ohne `ctx.facadeBay`.
 */
export function planFacadeBay(def: BuildingTypeDef, params: BuildingParams, ctx: Pick<ArchetypeContext, 'facadeBay'>): number | undefined {
  if (ctx.facadeBay === undefined) return undefined;
  const shell = resolveShellFull(def, params);
  const rules = shell.facade?.rules;
  if (rules?.grid !== true) return undefined;
  const bay = rules.bay ?? ctx.facadeBay(params.themeId ?? def.themes?.[0] ?? 'medieval') ?? DEFAULT_FACADE_BAY;
  // wie `deriveShell`: ein größerer Fensterabstand verbreitert die Felder (Feld ≥ Abstand − 1), Feld 2 … 8
  const spacing = shell.windows.spacing;
  return Math.max(2, Math.min(8, Math.max(spacing === undefined ? 0 : Math.floor(spacing) - 1, Math.floor(bay))));
}

/** W6: Braucht ein Raumtyp ein Fenster? Nicht Lager, Bad, Keller-, Flur- und Eingangsräume (wie `windowlessRooms`). */
const needsLight = (def: BuildingTypeDef, type: string): boolean => !WINDOW_OPTIONAL.has(type) && type !== def.entrance && type !== def.corridor?.room;

/** W6: Lagen, deren Seiten in der Erde liegen – dort zählt das Raster für Räume ohne Fenster nicht (Erdhaus). */
const EARTH_SETTINGS: ReadonlySet<string> = new Set(['buried', 'carved']);

/** Unter-Seeds je Plan. */
export const MAX_ATTEMPTS = 12;
/** Kandidaten je Etage (Nähe-Kosten). */
const CANDIDATES = 10;
/** Unter-Seeds, die nur wegen der Silhouette verworfen werden. */
const SILHOUETTE_TRIES = 4;

/**
 * Hüllen-Stil neuer Projekte (wie die App: Satteldach, Überstand 1, Details und Außenprofil an); die Definition
 * ersetzt je Feld. Q2: die Fassaden-Pflichtregeln (`FACADE_QUALITY_RULES`) sind Vorgabe jedes Bautyps – ein Bautyp
 * kann sie über `shell.facade.rules` bewusst abschalten.
 */
export const TYPE_SHELL: PlanShell = {
  roof: 'gable',
  overhang: 1,
  windows: { spacing: 4 },
  roofDetail: { pitch: 'normal', gableWindows: true, trim: true, verge: 'closed' },
  facade: { plinthProfile: true, cornice: true, quoins: true, rules: FACADE_QUALITY_RULES },
};

/** Objekt ohne `undefined`-Felder (zod liefert optionale Felder als `T | undefined`). */
function compact<T>(o: object): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Außenprofil der Bautyp-Definition: Q2-Pflichtregeln als Vorgabe, sofern die Definition sie nicht selbst setzt. */
function facadeOf(f: NonNullable<NonNullable<BuildingTypeDef['shell']>['facade']>): FacadeStyle {
  const own = compact<FacadeStyle>(f);
  return own.rules !== undefined ? own : { ...own, rules: FACADE_QUALITY_RULES };
}

/**
 * W4-B: Dachluke und Turmschaft (`RoofDetail.hatch`/`plainShaft`) gehören zum Baukörper, nicht zum Stil der Sitzung –
 * der Stil (`resolveShell`) lässt sie weg, der Hauptbaukörper trägt die vollständigen Dach-Details in `Volume.roofDetail`
 * (Projektzustand: App und Engine leiten dieselbe Hülle ab, ohne neue App-Einstellung). Ohne die Felder bitgleich.
 */
function mainRoofDetail(def: BuildingTypeDef, params: BuildingParams): RoofDetail | undefined {
  const d = def.shell?.roofDetail;
  if (d?.hatch !== true && d?.plainShaft !== true) return undefined;
  return { ...resolveShellFull(def, params).roofDetail, ...(d.hatch === true ? { hatch: true } : {}), ...(d.plainShaft === true ? { plainShaft: true } : {}) };
}

/** Stil (Schritt 5): Definition über dem Standard, Parameter darüber (je Feld ganz ersetzt). */
export function resolveShell(def: BuildingTypeDef, params: BuildingParams = {}): PlanShell {
  const out = resolveShellFull(def, params);
  if (out.roofDetail?.hatch === undefined && out.roofDetail?.plainShaft === undefined) return out;
  const { hatch: _h, plainShaft: _p, ...roofDetail } = out.roofDetail;
  return { ...out, roofDetail };
}

function resolveShellFull(def: BuildingTypeDef, params: BuildingParams): PlanShell {
  const d = def.shell ?? {};
  const windows = d.windows?.enabled === false ? { enabled: false } : { spacing: d.windows?.spacing ?? 4 };
  const s: PlanShell = {
    ...TYPE_SHELL,
    ...(d.roof !== undefined ? { roof: d.roof as RoofStyle } : {}),
    ...(d.overhang !== undefined ? { overhang: d.overhang } : {}),
    windows,
    ...(d.roofDetail !== undefined ? { roofDetail: compact<RoofDetail>(d.roofDetail) } : {}),
    ...(d.dormers !== undefined ? { dormers: compact(d.dormers) } : {}),
    // Q2: die Definition ersetzt das Außenprofil wie bisher, die Fassaden-Pflichtregeln bleiben aber Vorgabe –
    // nur ein ausdrückliches `rules` der Definition kann sie abschalten.
    ...(d.facade !== undefined ? { facade: facadeOf(d.facade) } : {}),
    ...params.shell,
  };
  // wie die App: Flachdach ohne Gauben, „Fenster aus“ auch ohne Giebelfenster
  const { dormers, ...rest } = s;
  const out: PlanShell = s.roof === 'flat' || dormers === undefined ? rest : s;
  return out.windows.enabled === false && out.roofDetail?.gableWindows === true ? { ...out, roofDetail: { ...out.roofDetail, gableWindows: false } } : out;
}

// ---------------------------------------------------------------------------------------------- 1. Größe

interface Sized {
  readonly size?: BuildingSizeClass;
  readonly W: number;
  readonly D: number;
  readonly floors: number;
  readonly ground: number;
  readonly upper: number;
  readonly cellar: boolean;
  readonly wings: readonly string[];
  readonly units: number;
  /** Ensemble-Teile dieser Größe (Maße und Etagen aufgelöst). */
  readonly parts: readonly SizedPart[];
}

interface SizedPart {
  readonly id: string;
  readonly W: number;
  readonly D: number;
  readonly floors: number;
  readonly cellar: boolean;
  /** Eigene lichte Höhe aller Etagen. */
  readonly height?: number;
}

/** Ensemble-Teile einer Größe (research/19 §7.4): Wahrscheinlichkeit, Maße (Turm quadratisch), Etagen absolut oder über dem Hauptbaukörper. */
function chooseParts(def: BuildingTypeDef, size: BuildingSizeClass, mainFloors: number, rng: Rng): SizedPart[] {
  return (def.sizes![size]!.parts ?? []).flatMap((id) => {
    const p = def.parts![id]!;
    const pr = rng.fork(id);
    if (!pr.chance(p.prob ?? 1)) return [];
    const ps = { ...p, ...p.sizes?.[size] };
    const [[w1, d1], [w2, d2]] = ps.footprint!;
    const W = odd(pr.int(w1, w2), w1, w2);
    const D = p.massing === 'tower' ? Math.min(d2, Math.max(d1, W)) : odd(pr.int(d1, d2), d1, d2);
    const floors = ps.above !== undefined ? mainFloors + pickRange(pr, ps.above, 1) : pickRange(pr, ps.floors, 1);
    const cellar = p.cellar === true || (typeof p.cellar === 'number' && pr.chance(p.cellar));
    return [{ id, W, D, floors, cellar, ...(ps.floorHeight !== undefined ? { height: pickRange(pr, ps.floorHeight, 3) } : {}) }];
  });
}

const pickRange = (rng: Rng, r: BuildingRange | undefined, fallback: number): number => {
  if (r === undefined) return fallback;
  const [a, b] = rangeOf(r);
  return rng.int(a, b);
};

/**
 * W2 (Baustandard D5, I5): lichte Höhe eingeschossiger Häuser mit geneigtem Dach mindestens 4 – Traufhöhe ≥ 5, damit
 * das Dach (Budget: höchstens so hoch wie die Traufe) nicht über 50 % der Gebäudehöhe einnimmt. Säle und Schankräume
 * setzen ihre Höhe im Bautyp (`groundHeight`).
 */
export const SINGLE_STOREY_MIN_HEIGHT = 4;

/** Ungerade Maße bevorzugt (symmetrischer First, Tür in der Mitte). */
const odd = (v: number, lo: number, hi: number): number => (v % 2 === 1 ? v : v + 1 <= hi ? v + 1 : v - 1 >= lo ? v - 1 : v);
/**
 * W5 (27.09.2026, Review N8): gerade Frontlänge – nur eine gerade Linie hat ein gerades Mittelfeld (Doppeltür
 * spiegelgleich auf der Frontmitte). Eine gerade Linie hat immer eine ungerade Feldzahl (`bays`); bei manchen Längen
 * fällt dadurch ein Feld weg und die Felder werden 5–7 breit – schmale Räume im Obergeschoss (Gästezimmer) bekämen
 * dann keine Feldachse und kein Fenster (F2: Fenster nur auf der Achse). Darum unter den geraden Längen im Bereich
 * höchstens 2 neben dem gewürfelten Wert (die Größen bleiben vielfältig) die mit den schmalsten Feldern für die üblichen
 * Feldbreiten 3 und 4 (`FRONT_BAYS`), bei Gleichstand die nächste zum gewürfelten Wert (kleinere zuerst).
 */
const FRONT_BAYS: readonly number[] = [3, 4];
const fieldExcess = (len: number, fronts: readonly number[]): number => Math.max(...fronts.map((f) => Math.max(...bays(len, f).fields.map(([a, e]) => e - a + 1)) - f));
/** W6: mit bekannter Feldbreite (`planFacadeBay`) zählt nur sie, sonst die üblichen 3 und 4. */
const evenFront = (fronts: readonly number[]) => (v: number, lo: number, hi: number): number => {
  const evens = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((x) => x % 2 === 0 && Math.abs(x - v) <= 2);
  if (evens.length === 0) return v;
  return evens.reduce((b, x) => {
    const d = fieldExcess(x, fronts) - fieldExcess(b, fronts);
    return d < 0 || (d === 0 && (Math.abs(x - v) < Math.abs(b - v) || (Math.abs(x - v) === Math.abs(b - v) && x < b))) ? x : b;
  });
};

/**
 * W8-D: Größe ohne eigene Angabe. Standard ist M (sonst die erste vorhandene); verlangt `floors` eine Etagenzahl, die
 * diese Größe nicht hat, gilt die nächste Größe (M, S, L), die sie hat („Wachturm, 3 Etagen“ → S statt M mit 4).
 * Passt keine, bleibt der Standard (die Etagen werden dann wie bisher auf seinen Bereich begrenzt).
 */
export function defaultSize(def: BuildingTypeDef, floors?: number): BuildingSizeClass | undefined {
  const avail = BUILDING_SIZES.filter((s) => def.sizes?.[s] !== undefined);
  const standard = avail.includes('M') ? 'M' : avail[0];
  if (floors === undefined || standard === undefined) return standard;
  const has = (s: BuildingSizeClass): boolean => { const [a, b] = rangeOf(def.sizes![s]!.floors); return floors >= a && floors <= b; };
  return has(standard) ? standard : (['M', 'S', 'L'] as const).find((s) => avail.includes(s) && has(s)) ?? standard;
}

function chooseSize(def: BuildingTypeDef, params: BuildingParams, rng: Rng, pitched: boolean, bay?: number): Sized {
  const m = def.massing;
  const avail = BUILDING_SIZES.filter((s) => def.sizes?.[s] !== undefined);
  const size = params.size !== undefined && avail.includes(params.size) ? params.size : defaultSize(def, params.floors)!;
  const sd = def.sizes![size]!;
  const [[w1, d1], [w2, d2]] = sd.footprint;
  const ratio = 'ratio' in m ? m.ratio : undefined;
  let W = w1;
  let D = d1;
  // W5 (Review N8): `evenFront` – gerade Frontlänge (gerades Mittelfeld für die Doppeltür); gleiche Zufallsfolge
  const front = 'evenFront' in m && m.evenFront === true ? evenFront(bay !== undefined ? [bay] : FRONT_BAYS) : odd;
  for (let i = 0; i < 16; i++) {
    W = front(rng.int(w1, w2), w1, w2);
    D = m.generator === 'tower' ? Math.min(d2, Math.max(d1, W)) : odd(rng.int(d1, d2), d1, d2);
    const r = Math.max(W, D) / Math.min(W, D);
    if (ratio === undefined || (r >= ratio[0] && r <= ratio[1])) break;
  }
  const [f1, f2] = rangeOf(sd.floors);
  const floors = params.floors !== undefined ? Math.min(f2, Math.max(f1, params.floors)) : rng.int(f1, f2);
  const upper = pickRange(rng, sd.floorHeight, 3);
  const picked = pickRange(rng, sd.groundHeight, upper);
  // W2 (D5): eingeschossig mit geneigtem Dach → lichte Höhe ≥ 4 (nach dem Würfeln: gleiche Zufallsfolge)
  const ground = floors === 1 && pitched ? Math.max(SINGLE_STOREY_MIN_HEIGHT, picked) : picked;
  const cellar = sd.cellar === true || (typeof sd.cellar === 'number' && rng.chance(sd.cellar));
  const wingDefs = m.generator === 'wings' ? m.wings : {};
  const wings = (sd.wings ?? []).filter((id) => rng.chance(wingDefs[id]?.prob ?? 1));
  const units = pickRange(rng, sd.units, 1);
  return { size, W, D, floors, ground, upper, cellar, wings, units, parts: chooseParts(def, size, floors, rng.fork('parts')) };
}

// ---------------------------------------------------------------------------------------------- 2. Massing

interface Shape {
  readonly id: VolumeId;
  readonly role: 'main' | 'unit' | 'wing' | 'part';
  readonly wingId?: string;
  /** Ensemble-Teil: eigene Grammatik, eigene Treppenart, Wehrplatte. */
  readonly partId?: string;
  readonly gen?: 'tower' | 'rect' | 'hall';
  readonly ladder?: boolean;
  readonly parapet?: 'crenel' | 'lookout';
  readonly parapetDeck?: boolean;
  /** Eigene lichte Höhe aller Etagen (`Volume.floorHeights`). */
  readonly height?: number;
  /** Angebauter Teil: übernimmt die Wandspalte des Hauptbaukörpers unter seinem Grundriss. */
  readonly attached?: boolean;
  readonly name?: string;
  readonly roof?: RoofStyle;
  readonly roofDetail?: RoofDetail;
  /** W12-C: Außengestaltung des Teils (`Volume.exterior`: Kantenrolle, abgeschaltete Deko, Scheunentor). */
  readonly exterior?: VolumeExterior;
  readonly main: Box;
  /** Angebaute Flügel desselben Baukörpers. */
  readonly wings: { readonly id: string; readonly box: Box; readonly floors: number }[];
  readonly floors: number;
  readonly cellar: boolean;
}

function massing(def: BuildingTypeDef, sz: Sized, params: BuildingParams, rng: Rng, bay?: number): Shape[] {
  const m = def.massing;
  if (m.generator === 'row') {
    const sd = def.sizes![sz.size!]!;
    const [[w1, d1], [w2, d2]] = sd.footprint;
    const [f1, f2] = rangeOf(sd.floors);
    const dims = Array.from({ length: Math.max(1, sz.units) }, (_, i) => ({
      w: i === 0 ? sz.W : rng.int(w1, w2),
      d: i === 0 ? sz.D : odd(rng.int(d1, d2), d1, d2),
      floors: i === 0 ? sz.floors : params.floors !== undefined ? sz.floors : rng.int(f1, f2),
    }));
    if (bay !== undefined && dims.length > 1) {
      // W6: Brandwände der Zeile nicht auf eine Achse der gemeinsamen Rückseite (hinten bündig, eine Linie über alle
      // Häuser) – Breiten im Bereich des Bautyps, Gesamtlänge gleich
      const ws = dims.map((u) => u.w);
      const total = ws.reduce((a, b) => a + b, 0);
      const snapped = snapWidths(0, ws, ws.map(() => Math.min(w1, ...ws)), ws.map(() => false), lineAxes(total, bay), () => false, 2, ws.map(() => Math.max(w2, ...ws)));
      snapped.forEach((w, i) => (dims[i] = { ...dims[i]!, w }));
    }
    const maxD = Math.max(...dims.map((u) => u.d));
    let x = 0;
    return dims.map((u, i) => {
      const main: Box = { x0: x, z0: maxD - u.d, x1: x + u.w - 1, z1: maxD - 1 };
      x += u.w;
      return { id: i === 0 ? DEFAULT_VOLUME : `v${i}`, role: 'unit', name: `Haus ${i + 1}`, main, wings: [], floors: u.floors, cellar: sz.cellar };
    });
  }
  const main: Box = { x0: 0, z0: 0, x1: sz.W - 1, z1: sz.D - 1 };
  const out: Shape[] = [{ id: DEFAULT_VOLUME, role: 'main', main, wings: [], floors: sz.floors, cellar: sz.cellar }];
  for (const id of m.generator === 'wings' ? sz.wings : []) {
    if (m.generator !== 'wings') break;
    const w = m.wings[id]!;
    const depth = pickRange(rng, w.depth, 5);
    const sideLen = w.side === 'back' ? sz.W : sz.D;
    const len = Math.min(sideLen, pickRange(rng, w.length, sideLen));
    const align = w.align ?? 'any';
    const off = align === 'start' ? 0 : align === 'end' ? sideLen - len : align === 'center' ? Math.floor((sideLen - len) / 2) : rng.int(0, sideLen - len);
    const gap = w.volume === true ? (w.gap ?? 0) : 0;
    const box: Box =
      w.side === 'back' ? { x0: off, z0: -gap - depth, x1: off + len - 1, z1: -gap - 1 }
        : w.side === 'left' ? { x0: -gap - depth, z0: off, x1: -gap - 1, z1: off + len - 1 }
          : { x0: sz.W + gap, z0: off, x1: sz.W + gap + depth - 1, z1: off + len - 1 };
    const floors = Math.min(sz.floors, pickRange(rng, w.floors, 1));
    if (w.volume === true) {
      out.push({ id: `v${out.length}`, role: 'wing', wingId: id, name: id, ...(w.roof !== undefined ? { roof: w.roof as RoofStyle } : {}), main: box, wings: [], floors, cellar: false });
    } else {
      out[0]!.wings.push({ id, box, floors });
    }
  }
  // W13-A: Oberkante (Boden bis über die letzte Decke) von Hauptbaukörper und Teil – ein niedrigerer Anbau schließt außen an
  const mainTop = sz.ground + (sz.floors - 1) * sz.upper + sz.floors;
  const topOf = (sp: SizedPart): number => (sp.height ?? sz.ground) + (sp.floors - 1) * (sp.height ?? sz.upper) + sp.floors;
  for (const sp of sz.parts) out.push(partShape(def, sp, main, `v${out.length}`, rng.fork(`part${sp.id}`), topOf(sp) < mainTop));
  return out;
}

/**
 * Ensemble-Teil am Hauptbaukörper (research/19 §7.4, Ensemble-Anker): Seite, Lage entlang der Seite (Ecke =
 * start/end, mit `shift` über die Ecke vorspringend), Abstand (0 = angebaut mit Brandwand). Kanonisch, Front Süden.
 */
function partShape(def: BuildingTypeDef, sp: SizedPart, main: Box, id: VolumeId, rng: Rng, lower = false): Shape {
  const p = def.parts![sp.id]!;
  const a = p.anchor;
  const side = typeof a.side === 'string' ? a.side : rng.pick(a.side);
  const align = a.align === undefined ? 'start' : typeof a.align === 'string' ? a.align : rng.pick(a.align);
  const gap = pickRange(rng, a.gap, 0);
  const shift = pickRange(rng, a.shift, 0);
  const along = side === 'back' ? sp.W : sp.D;
  const sideLen = side === 'back' ? boxW(main) : boxD(main);
  const free = Math.max(0, sideLen - along);
  const off = align === 'start' ? -shift : align === 'end' ? free + shift : align === 'center' ? Math.floor(free / 2) : rng.int(0, free);
  // angebaut: der Teil übernimmt die Wandspalte des Hauptbaukörpers (der höhere Baukörper trägt die Brandwand) – so
  // bleibt die Innenfläche des Hauptbaukörpers rechteckig, statt an der Brandwand um eine Spalte vorzuspringen
  // W13-A: ein niedrigerer Anbau (Oberkante unter der des Hauptbaukörpers) schließt außen an dessen Wand an – der
  // Hauptbaukörper trägt dann die Brandwand selbst, seine Obergeschosse bleiben über dem Anbau bündig
  const flush = gap === 0 && lower;
  const g = gap - (gap === 0 && !flush ? 1 : 0);
  const box: Box =
    side === 'back' ? { x0: off, z0: main.z0 - g - sp.D, x1: off + sp.W - 1, z1: main.z0 - g - 1 }
      : side === 'left' ? { x0: main.x0 - g - sp.W, z0: off, x1: main.x0 - g - 1, z1: off + sp.D - 1 }
        : { x0: main.x1 + 1 + g, z0: off, x1: main.x1 + g + sp.W, z1: off + sp.D - 1 };
  return {
    id, role: 'part', partId: sp.id, gen: p.massing, name: p.name ?? sp.id, ...(gap === 0 && !flush ? { attached: true } : {}),
    ladder: (p.stairs?.type ?? (p.massing === 'tower' ? 'ladder' : 'straight')) === 'ladder',
    ...(p.parapet !== undefined ? { parapet: p.parapet } : {}),
    ...(p.parapetDeck !== undefined ? { parapetDeck: p.parapetDeck } : {}),
    ...(sp.height !== undefined ? { height: sp.height } : {}),
    ...(p.roof !== undefined ? { roof: p.roof as RoofStyle } : {}),
    ...(p.roofDetail !== undefined ? { roofDetail: compact<RoofDetail>(p.roofDetail) } : {}),
    ...(p.exterior !== undefined ? { exterior: compact<VolumeExterior>(p.exterior) } : {}),
    main: box, wings: [], floors: sp.floors, cellar: sp.cellar,
  };
}

// ---------------------------------------------------------------------------------------------- 4. Programm

function matches(sel: BuildingFloorSel, f: number, hi: number): boolean {
  if (typeof sel === 'number') return f === sel;
  if (Array.isArray(sel)) return f >= sel[0] && f <= sel[1];
  switch (sel) {
    case 'ground': return f === 0;
    case 'upper': return f >= 1;
    case 'top': return f === hi && f >= 0;
    case 'cellar': return f === -1;
    case 'all': return f >= 0;
  }
  return false;
}

/** Außenfläche eines etwa quadratischen Raums mit dieser Innenfläche. */
const outerOf = (inner: number): number => (Math.ceil(Math.sqrt(inner)) + 2) ** 2;

/** Raumwünsche einer Etage (`wing`/`part`: nur Einträge dieses Flügels bzw. Ensemble-Teils). */
function requests(
  def: BuildingTypeDef, f: number, hi: number, wing: string | undefined, area: number, rng: Rng, relax: number, ctx: ArchetypeContext, part?: string,
): Req[] {
  const out: Req[] = [];
  // Funktionsgrad: Räume, die ein Funktionsraum dieser Etage (mit genug Fläche) verdrängt; ohne `replaces` leer (bitgleich)
  const replaced = new Set<string>();
  for (const e of def.program ?? []) {
    if (e.replaces === undefined || e.wing !== wing || e.part !== part || (e.minFloor !== undefined && area < e.minFloor)) continue;
    if (wing === undefined && !matches(e.floor ?? 'ground', f, hi)) continue;
    for (const r of e.replaces) replaced.add(r);
  }
  for (const [i, e] of (def.program ?? []).entries()) {
    if (e.wing !== wing || e.part !== part) continue;
    if (wing === undefined && !matches(e.floor ?? 'ground', f, hi)) continue;
    if (e.minFloor !== undefined && area < e.minFloor) continue;
    const er = rng.fork(i);
    const type = typeof e.room === 'string' ? e.room : er.pick(e.room);
    if (e.replaces === undefined && e.required !== true && replaced.has(type)) continue;
    const required = e.required === true;
    if (!required && relax >= 2 && e.fill !== true) continue;
    if (!required && e.prob !== undefined && !er.chance(relax >= 1 ? e.prob / 2 : e.prob)) continue;
    const [c0, c1] = e.count !== undefined ? rangeOf(e.count) : [1, 1];
    const minArea = e.minArea ?? ctx.minArea(type);
    // Anzahl nach Fläche (etwa die Hälfte der Etage), ±1 per Seed, im Bereich des Eintrags
    const byArea = Math.floor((area * 0.5) / outerOf(minArea)) + er.int(-1, 1);
    const n = Math.max(required ? 1 : 0, relax >= 1 ? c0 : Math.min(c1, Math.max(c0, byArea)));
    for (let k = 0; k < n; k++) {
      // Pflicht ist nur die Mindestzahl; weitere Stück sind Wunschräume
      out.push({
        entry: i, roomTypeId: type, weight: e.share !== undefined ? e.share * area : outerOf(minArea), minArea, required: required && k < Math.max(1, c0), fill: e.fill === true,
        lit: e.lit ?? needsLight(def, type),
        ...(e.near !== undefined ? { near: e.near } : {}), ...(e.adjacent !== undefined ? { adjacent: e.adjacent } : {}),
        ...(e.adjacencyWeights !== undefined ? { adjacencyWeights: e.adjacencyWeights } : {}),
      });
    }
  }
  const taken = out.filter((r) => !r.fill).reduce((s, r) => s + r.weight, 0);
  for (const r of out) if (r.fill) r.weight = Math.max(outerOf(r.minArea), area - taken);
  // Füllräume nur, wenn Platz bleibt (oder sonst nichts auf der Etage steht); leere Etagen bekommen einen Füllraum
  const kept = out.filter((r) => !r.fill || r.required || area - taken >= outerOf(r.minArea) || out.every((o) => o.fill));
  return kept.length > 0 ? kept : [fillReq(def, ctx, part)];
}

/** Füllraum für Etagen ohne Programm: der erste `fill`-Eintrag ohne Flügel (im Teil: des Teils), sonst Lager. */
function fillReq(def: BuildingTypeDef, ctx: ArchetypeContext, part?: string): Req {
  const fills = (def.program ?? []).filter((x) => x.fill === true && x.wing === undefined && typeof x.room === 'string');
  const e = fills.find((x) => x.part === part) ?? fills[0];
  const type = typeof e?.room === 'string' ? e.room : 'storage';
  return { entry: -1, roomTypeId: type, weight: 1, minArea: Math.min(4, ctx.minArea(type)), required: false, fill: true };
}

/** Treppenraum: Eingangs- bzw. Flurraum oder `stairs.room`, sonst der größte Raum. */
function chooseHub(def: BuildingTypeDef, f: number, reqs: readonly Req[], corridor: boolean): Req | undefined {
  const prefs = f === 0 ? [def.entrance, def.stairs?.room] : f > 0 ? [corridor ? def.corridor?.room : undefined, def.stairs?.room] : [def.stairs?.room];
  for (const p of prefs) {
    const r = p === undefined ? undefined : reqs.find((x) => x.roomTypeId === p);
    if (r !== undefined) return r;
  }
  return reqs.reduce<Req | undefined>((best, r) => (best === undefined || r.weight > best.weight ? r : best), undefined);
}

/**
 * W6: Kosten je Raum mit Licht-Bedarf ohne mögliche Feldachse und je Achse am Rand eines Raums (Trennwand womöglich auf
 * der Achse, Feld blind) – Auswahl unter den Kandidaten einer Etage.
 */
const DARK_ROOM_COST = 4;
const EDGE_AXIS_COST = 0.5;

/** Nähe als Kosten (research/19 §7.3): Nachbarschaft, Front/Rückseite, Treppennähe, Flächenabweichung. */
function cost(rooms: ReadonlyMap<Req, CellSet>, box: Box, hub: Req | undefined, terms?: LayoutCostTerms): number {
  let c = 0;
  const area = boxW(box) * boxD(box);
  // Vorschau der gesetzten Räume: Typ → Zellen (ein Durchlauf statt einer Suche je Nachbarschaft)
  const byType = new Map<string, CellSet[]>();
  for (const [r, cells] of rooms) {
    const list = byType.get(r.roomTypeId);
    if (list === undefined) byType.set(r.roomTypeId, [cells]);
    else list.push(cells);
  }
  const touches = (cells: CellSet, type: string, self: Req): boolean =>
    (byType.get(type) ?? []).some((oc) => (oc !== cells || type !== self.roomTypeId) && contact(cells, oc) >= 3);
  for (const [r, cells] of rooms) {
    for (const t of r.adjacent ?? []) {
      if (!touches(cells, t, r)) {
        c += 3;
        if (terms !== undefined) terms.adjacent += 3;
      }
    }
    // Gewichtete Nachbarschaft (research/22 §0.1): Kontakt zwischen zwei Raumtypen wird belohnt oder gemieden
    for (const [target, weight] of Object.entries(r.adjacencyWeights ?? {})) {
      if (weight === 0) continue;
      const touching = touches(cells, target, r);
      const w = weight > 0 ? (touching ? -2 * weight : 2 * weight) : (touching ? -2 * weight : 0);
      c += w;
      if (terms !== undefined) terms.adjacencyWeights += w;
    }
    const b = cells.bounds()!;
    if ((r.near === 'entrance' || r.near === 'front') && b.maxZ !== box.z1) {
      c += 2;
      if (terms !== undefined) terms.nearFront += 2;
    }
    if (r.near === 'back' && b.minZ !== box.z0) {
      c += 1;
      if (terms !== undefined) terms.nearBack += 1;
    }
    if (r.near === 'stairs' && r !== hub && (hub === undefined || contact(cells, rooms.get(hub) ?? CellSet.empty()) < 3)) {
      c += 1;
      if (terms !== undefined) terms.nearStairs += 1;
    }
    c += Math.abs(cells.size - r.weight) / area;
    if (terms !== undefined) terms.area += Math.abs(cells.size - r.weight) / area;
  }
  return c;
}

interface FloorRoom {
  readonly req: Req;
  readonly cells: CellSet;
}

/** Bester Kandidat für ein Rechteck; passt nichts, entfällt der leichteste Wunschraum (nie Pflicht- oder Treppenraum). */
/** Beobachter einer Etage (`traceLayout` mit Versuch, Baukörper und Etage vorbelegt). */
type FloorTrace = (e: { search: number; k: number; rooms?: Map<Req, CellSet>; hub: Req | undefined; cost?: number; terms?: LayoutCostTerms } | { chosen: true; search: number; k: number; cost: number; dropped: readonly string[] }) => void;

function bestLayout(
  axes: Axes, reqs: Req[], hub: Req | undefined, zone: CellSet | undefined, corridor: boolean, rows: boolean, rng: Rng, dropped: string[], grid?: LayoutGrid,
  center?: boolean,
  trace?: FloorTrace,
): FloorRoom[] | undefined {
  let searches = 0;
  const search = (list: readonly Req[]): { rooms: Map<Req, CellSet>; cost: number; dark: number; k: number; search: number } | undefined => {
    let best: { rooms: Map<Req, CellSet>; cost: number; dark: number; k: number; search: number } | undefined;
    const n = searches++;
    for (let k = 0; k < CANDIDATES; k++) {
      const res = layoutFloor({
        L: axes.L, S: axes.S, reqs: list, ...(hub !== undefined ? { hub } : {}), ...(zone !== undefined ? { zone } : {}), corridor, rows, ...(grid !== undefined ? { grid } : {}),
        ...(center === true ? { center } : {}),
        // W13-C (28.09.2026): Erdhaus mit schmaler Front – die lange Achse läuft zur Front (kanonisch Süden = z)
        ...(center === true && !axes.alongX ? { spine: true } : {}),
      }, rng.fork(k));
      if (res === undefined) {
        trace?.({ search: n, k, hub });
        continue;
      }
      const xz = new Map([...res].map(([r, c]) => [r, uvToXZ(axes, c)] as const));
      // W6: Räume mit Licht-Bedarf ohne Feldachse (Näherung in u, v; gezählt wird an der Hülle in `finish`)
      const dark = grid === undefined ? 0 : [...res].filter(([r, c]) => r.lit === true && !mayHaveWindow(c, grid)).length;
      const edge = grid === undefined ? 0 : [...res.values()].reduce((n, c) => n + edgeAxes(c, grid), 0);
      const terms: LayoutCostTerms | undefined = trace === undefined ? undefined
        : { adjacent: 0, adjacencyWeights: 0, nearFront: 0, nearBack: 0, nearStairs: 0, area: 0, dark: 0, edgeAxis: 0 };
      const c = cost(xz, axes.box, hub, terms) + DARK_ROOM_COST * dark + EDGE_AXIS_COST * edge;
      if (terms !== undefined) {
        terms.dark = DARK_ROOM_COST * dark;
        terms.edgeAxis = EDGE_AXIS_COST * edge;
        trace?.({ search: n, k, rooms: xz, hub, cost: c, terms });
      }
      if (best === undefined || c < best.cost) best = { rooms: xz, cost: c, dark, k, search: n };
    }
    return best;
  };
  for (;;) {
    let best = search(reqs);
    if (best !== undefined) {
      // W6: mehr Räume mit Licht-Bedarf als Felder – der leichteste Wunschraum mit Licht-Bedarf entfällt, solange das
      // Räume ohne Fenster spart (Pflichträume nie)
      while (best.dark > 0) {
        const opt = reqs.filter((r) => !r.required && r !== hub && r.lit === true).sort((a, b) => a.weight - b.weight)[0];
        if (opt === undefined) break;
        const fewer = reqs.filter((r) => r !== opt);
        const alt = search(fewer);
        if (alt === undefined || alt.dark >= best.dark) break;
        dropped.push(opt.roomTypeId);
        reqs = fewer;
        best = alt;
      }
      const order = [...best.rooms].sort(([a], [b]) => (a === hub ? -1 : b === hub ? 1 : 0));
      trace?.({ chosen: true, search: best.search, k: best.k, cost: best.cost, dropped: [...dropped] });
      return order.map(([req, cells]) => ({ req, cells }));
    }
    const optional = reqs.filter((r) => !r.required && r !== hub).sort((a, b) => a.weight - b.weight);
    if (optional.length === 0) return undefined;
    dropped.push(optional[0]!.roomTypeId);
    reqs = reqs.filter((r) => r !== optional[0]);
  }
}

interface VolumePlan {
  readonly rooms: PlanRoom[];
  readonly stairs: PlanStairs[];
}

function planVolume(
  def: BuildingTypeDef, shape: Shape, heights: ReadonlyMap<number, number>, rng: Rng, relax: number, ctx: ArchetypeContext, dropped: string[],
  gridAt?: (axes: Axes, floor: number) => LayoutGrid, claim?: CellSet, attempt = 0,
): VolumePlan | string {
  const tl = ctx.traceLayout;
  const floorTrace = (floor: number, wing?: string): FloorTrace | undefined => (tl === undefined ? undefined : (e) => {
    const at = { attempt, volumeId: shape.id, ...(wing !== undefined ? { wing } : {}), floor };
    if ('chosen' in e) tl({ type: 'floor', ...at, search: e.search, k: e.k, cost: e.cost, dropped: e.dropped });
    else {
      tl({
        type: 'candidate', ...at, search: e.search, k: e.k,
        ...(e.rooms !== undefined ? {
          rooms: [...e.rooms].map(([r, cells]) => ({ roomTypeId: r.roomTypeId, required: r.required, hub: r === e.hub, weight: r.weight, cells })),
        } : {}),
        ...(e.cost !== undefined ? { cost: e.cost } : {}), ...(e.terms !== undefined ? { terms: e.terms } : {}),
      });
    }
  });
  const gen = shape.gen ?? def.massing.generator;
  const lo = shape.cellar ? -1 : 0;
  const hi = shape.floors - 1;
  const floors: CoreFloor[] = [];
  for (let f = lo; f <= hi; f++) floors.push({ index: f, height: shape.height ?? heights.get(f) ?? 3 });
  const axes = axesOf(shape.main, rng.chance(0.5) ? 'low' : 'high');
  let core: StairCore | undefined = { links: [], zone: new Map() };
  if (floors.length > 1) {
    const ladder = shape.ladder ?? (def.stairs?.type ?? (gen === 'tower' ? 'ladder' : 'straight')) === 'ladder';
    const at = shape.role === 'part' ? 'end' : def.stairs?.at ?? 'end';
    // W7-B: Leitern nicht auf Fensterachsen (Raster der echten Hülle, wo bekannt)
    const wallAxes = gridAt === undefined ? undefined : (f: number, side: 'back' | 'front') => (f < 0 ? [] : gridAt(axes, f)[side]);
    if (ladder) core = ladders(axes, floors, wallAxes);
    else {
      let picked: [number, number, number] | undefined;
      core = switchback(axes, floors, at, (a, b) => {
        const v = rng.int(a, b);
        picked = [a, b, v];
        return v;
      });
      // W7-B (Burg): ein angebauter Teil (Bergfried) nimmt dem Hauptbaukörper die Wandspalte an seiner Ecke – liegt die
      // Wechselstiege am Ende mit dem Anbau, passt sie nach der Wegnahme nicht mehr (neuer Versuch). Dann das andere Ende
      // (ohne weiteren Zufall; ohne Anbau bitgleich)
      const hits = (c: StairCore): boolean => [...c.zone.values()].some((z) => uvToXZ(axes, z).toArray().some(([x, zz]) => claim!.has(x, zz)));
      if (core !== undefined && claim !== undefined && !claim.isEmpty && at === 'end' && picked !== undefined && hits(core)) {
        const [a, b, v] = picked;
        const alt = switchback(axes, floors, at, () => (v === a ? b : a));
        if (alt !== undefined && !hits(alt)) core = alt;
      }
    }
    if (core === undefined) return `Treppenkern passt nicht in ${axes.L} × ${axes.S}`;
  }
  const rooms: PlanRoom[] = [];
  const push = (floor: number, fr: readonly FloorRoom[]): void => {
    for (const { req, cells } of fr) rooms.push({ volumeId: shape.id, floor, cells, roomTypeId: req.roomTypeId, entry: req.entry, required: req.required });
  };
  const area = axes.L * axes.S;
  const minDepth = def.corridor?.minDepth ?? 9;
  for (const { index: f } of floors) {
    const fr = rng.fork(`floor${f}`);
    let reqs = requests(def, f, hi, shape.role === 'wing' ? shape.wingId : undefined, area, fr.fork('req'), relax, ctx, shape.partId);
    const corridorReq = def.corridor === undefined ? undefined : reqs.find((r) => r.roomTypeId === def.corridor!.room);
    const corridor = corridorReq !== undefined && f > 0 && axes.S >= minDepth && reqs.length >= 3;
    if (corridorReq !== undefined && !corridor && !corridorReq.required && reqs.length > 1) reqs = reqs.filter((r) => r !== corridorReq);
    // Turm: ein Raum je Etage (die übrigen Wünsche sind Alternativen, kein Platzmangel)
    if (gen === 'tower') reqs = [chooseHub(def, f, reqs, false)!];
    const hub = chooseHub(def, f, reqs, corridor);
    const zone = core.zone.get(f);
    const zb = zone?.bounds();
    if (hub !== undefined && zb !== undefined) hub.weight = Math.max(hub.weight, (zb.maxX - zb.minX + 1) * axes.S * 1.2);
    // W6: Raster dieser Etage (Pfosten und Achsen der echten Hülle) – Trennwände auf Pfosten, jeder Raum mit Licht ein Feld
    // W12-B (28.09.2026): `centerHub` – Diele als mittiges Querband, Seiten gespiegelt (nur Erdgeschoss eines Rechtecks
    // ohne Treppenkern; Erdhaus: Tür mittig, Fenster paarweise)
    const center = f === 0 && gen === 'rect' && shape.role === 'main' && 'centerHub' in def.massing && def.massing.centerHub === true && zone === undefined && !corridor;
    const laid = bestLayout(axes, reqs, hub, zone, corridor, gen !== 'hall' && gen !== 'tower', fr.fork('layout'), dropped, f >= 0 ? gridAt?.(axes, f) : undefined, center, floorTrace(f));
    if (laid === undefined) return `Etage ${f}: Pflichträume passen nicht`;
    push(f, laid);
    // angebaute Flügel: eigene Streifen entlang ihrer langen Achse
    if (f < 0) continue;
    for (const w of shape.wings) {
      if (f >= w.floors) continue;
      const wa = axesOf(w.box);
      const wreqs = requests(def, f, hi, w.id, wa.L * wa.S, fr.fork(`wing${w.id}`), relax, ctx);
      const wl = bestLayout(wa, wreqs, undefined, undefined, false, false, fr.fork(`wl${w.id}`), dropped, gridAt?.(wa, f), undefined, floorTrace(f, w.id));
      if (wl === undefined) return `Flügel ${w.id}: Räume passen nicht`;
      push(f, wl);
    }
  }
  const stairs = core.links.map((l): PlanStairs => ({ volumeId: shape.id, floor: l.floor, origin: axes.toXZ(l.origin[0], l.origin[1]), facing: l.facing, type: l.type }));
  return { rooms, stairs };
}

// ---------------------------------------------------------------------------------------------- 5. Stil, Zusammenbau

function planExterior(def: BuildingTypeDef): PlanExterior | undefined {
  if (def.exterior === false) return undefined;
  return {
    density: def.exterior?.density ?? 1, off: def.exterior?.off ?? [], ...(def.exterior?.windowModule !== undefined ? { windowModule: def.exterior.windowModule } : {}),
    ...(def.exterior?.entranceModule !== undefined ? { entranceModule: def.exterior.entranceModule } : {}),
    ...(def.exterior?.themeMaterial !== undefined ? { themeMaterial: def.exterior.themeMaterial } : {}),
  };
}

function planSite(def: BuildingTypeDef): PlanSite | undefined {
  const s = def.site;
  if (s === undefined) return undefined;
  return {
    ...(s.template !== undefined ? { template: s.template } : {}),
    ...(s.style !== undefined ? { style: s.style } : {}),
    ...(s.lighting !== undefined ? { lighting: s.lighting } : {}),
    margin: s.margin ?? 12,
    zones: (s.zones ?? []).map((z) => compact(z)),
  };
}

function planWindmill(def: BuildingTypeDef, main: Box, rng: Rng): PlanWindmill | undefined {
  const w = def.structures?.windmill;
  if (w === undefined || !rng.chance(w.prob ?? 1)) return undefined;
  const side = w.side ?? 'back';
  const dist = w.distance ?? 14;
  const cx = Math.floor((main.x0 + main.x1) / 2);
  const cz = Math.floor((main.z0 + main.z1) / 2);
  const center: Cell = side === 'back' ? [cx, main.z0 - dist] : side === 'left' ? [main.x0 - dist, cz] : [main.x1 + dist, cz];
  return { center, levels: w.levels ?? 3, facing: side === 'back' ? 'north' : side === 'left' ? 'west' : 'east' };
}

/**
 * W12-C: Hochsilo am Ensemble-Teil `silo.part` (Standard der erste Teil) – hinter dessen Rückwand (Plan-Rückseite, −z)
 * mit `gap` Abstand, die Mitte auf der Flucht des Außengiebels (weg vom Hauptbaukörper): halb neben dem Giebel sichtbar,
 * Tor und Laufweg davor bleiben frei. Nur in `sizes` (Standard L) und mit `prob`.
 */
function planSilo(def: BuildingTypeDef, size: BuildingSizeClass | undefined, shapes: readonly Shape[], rng: Rng): PlanSilo | undefined {
  const s = def.structures?.silo;
  if (s === undefined || size === undefined || !(s.sizes ?? ['L']).includes(size) || !rng.chance(s.prob ?? 1)) return undefined;
  const part = shapes.find((x) => x.partId !== undefined && (s.part === undefined || x.partId === s.part));
  if (part === undefined) return undefined;
  const main = shapes[0]!.main;
  const b = part.main;
  const r = s.radius ?? 3;
  const mx = (main.x0 + main.x1) / 2;
  // Außengiebel: das Ende des Teils weiter weg vom Hauptbaukörper (First entlang der Langseite in x)
  const x = Math.abs(b.x1 - mx) >= Math.abs(b.x0 - mx) ? b.x1 : b.x0;
  // W16-B: `front` – vor der Vorderwand (Plan-Vorderseite, +z), sonst dahinter
  const z = s.side === 'front' ? b.z1 + (s.gap ?? 2) + r + 1 : b.z0 - (s.gap ?? 2) - r - 1;
  return { center: [x, z], radius: r, height: s.height ?? 16 };
}

interface Draft {
  readonly volumes: Volume[];
  readonly wings: BuildingPlan['wings'];
  readonly floors: { index: number; height: number }[];
  readonly rooms: PlanRoom[];
  readonly stairs: PlanStairs[];
  readonly windmill?: PlanWindmill;
  readonly silo?: PlanSilo;
  readonly parts?: readonly PlanPart[];
  readonly ring?: PlanRing;
}

/** Ringmauer (BT01): Werte aus der Definition, Bereiche und Auswahlen per Seed (Lage erst im Anwendungsdienst). */
function planRing(def: BuildingTypeDef, rng: Rng): PlanRing | undefined {
  const r = def.structures?.ring;
  if (r === undefined) return undefined;
  const gh = r.gate?.gatehouse;
  const towerStyle = r.towers === undefined ? {} : compact<PlanTowerStyle>(rng.pick(r.towers));
  const outer = r.outer !== undefined && rng.chance(r.outer.prob ?? 1) ? { gap: r.outer.gap ?? 6, height: r.outer.height ?? 4 } : undefined;
  const moat = r.moat !== undefined && rng.chance(r.moat.prob ?? 1) ? { width: r.moat.width ?? 3, gap: r.moat.gap ?? 2 } : undefined;
  const yard = r.yard === false ? undefined : r.yard ?? 'yard';
  return {
    offset: pickRange(rng, r.offset, 8),
    height: pickRange(rng, r.height, 6),
    thickness: r.thickness ?? 3,
    towerSpacing: pickRange(rng, r.towerSpacing, 24),
    towerStyle,
    merlon: { width: r.merlon?.width ?? 1, gap: r.merlon?.gap ?? 1 },
    gate: {
      width: r.gate?.width ?? 3, height: r.gate?.height ?? 4, gatehouse: gh === true || (typeof gh === 'number' && rng.chance(gh)),
      ...(r.gate?.gateBlock === true ? { gateBlock: true } : {}),
    },
    ...(outer !== undefined ? { outer } : {}),
    ...(moat !== undefined ? { moat } : {}),
    ...(yard !== undefined ? { yard } : {}),
    ...(r.accents === true ? { accents: true } : {}),
  };
}

/** Dreht den kanonischen Plan (Front Süden) zur Front und schiebt seine linke obere Ecke nach `at` (ohne `normalize`: Ursprung + `at`). */
function orient(d: Draft, front: HorizontalDir, normalize: boolean, at: Cell = [0, 0]): Draft {
  const q = quarterTurns(front);
  const rot = (c: Cell): Cell => rotateCell(c, q);
  let dx = at[0];
  let dz = at[1];
  if (normalize || q !== 0) {
    const all = d.rooms.flatMap((r) => r.cells.toArray().map(rot));
    dx -= Math.min(...all.map((c) => c[0]));
    dz -= Math.min(...all.map((c) => c[1]));
  }
  if (dx === 0 && dz === 0 && q === 0) return d;
  const t = (c: Cell): Cell => {
    const [x, z] = rot(c);
    return [x + dx, z + dz];
  };
  return {
    ...d,
    rooms: d.rooms.map((r) => ({ ...r, cells: CellSet.of(r.cells.toArray().map(t)) })),
    stairs: d.stairs.map((s) => ({ ...s, origin: t(s.origin), facing: rotateFacing(s.facing, q) })),
    ...(d.windmill !== undefined ? { windmill: { ...d.windmill, center: t(d.windmill.center), facing: rotateFacing(d.windmill.facing, q) } } : {}),
    ...(d.silo !== undefined ? { silo: { ...d.silo, center: t(d.silo.center) } } : {}),
  };
}

function finish(
  def: BuildingTypeDef, params: BuildingParams, seed: number, attempt: number, d: Draft, size: BuildingSizeClass | undefined, hints: string[], ctxMin: (i: number) => number,
  bay?: number, furnishable?: ArchetypeFurnishable, body?: Pick<BuildingPlan, 'rooms'>,
): { plan: BuildingPlan; problems: string[]; misses: number; shell?: Shell } {
  const front = params.front ?? 'south';
  const setting = params.setting ?? typeSetting(def, front);
  const corridorTypes = def.entrance === undefined && def.corridor === undefined ? undefined
    : ['hallway', 'corridor', ...(def.entrance !== undefined ? [def.entrance] : []), ...(def.corridor !== undefined ? [def.corridor.room] : [])];
  const exterior = planExterior(def);
  const site = planSite(def);
  const base: BuildingPlan = {
    typeId: def.id,
    name: def.name,
    seed,
    params: { ...(size !== undefined ? { size } : {}), front, floors: d.floors.filter((f) => f.index >= 0).length, ...(setting !== undefined ? { setting } : {}) },
    attempt,
    volumes: d.volumes.map((v) => {
      if (v.id !== DEFAULT_VOLUME) return v;
      const own = mainRoofDetail(def, params);
      return { ...v, ...(setting !== undefined && setting.kind !== 'ground' ? { setting } : {}), ...(own !== undefined && v.roofDetail === undefined ? { roofDetail: own } : {}) };
    }),
    wings: d.wings,
    floors: d.floors,
    rooms: d.rooms,
    stairs: d.stairs,
    shell: resolveShell(def, params),
    ...(corridorTypes !== undefined ? { corridorTypes } : {}),
    ...(exterior !== undefined ? { exterior } : {}),
    ...(site !== undefined ? { site } : {}),
    ...(d.windmill !== undefined ? { windmill: d.windmill } : {}),
    ...(d.silo !== undefined ? { silo: d.silo } : {}),
    ...(d.parts !== undefined && d.parts.length > 0 ? { parts: d.parts } : {}),
    ...(d.ring !== undefined ? { ring: d.ring } : {}),
    ...(def.parapet !== undefined ? { parapet: { crown: def.parapet.crown ?? 'crenel', deck: def.parapet.deck ?? false } } : {}),
    quality: [],
    warnings: [],
    hints: [],
  };
  // W6: mit bekannter Feldbreite prüft der Planer die Hülle mit genau dem Raster der echten Hülle (Tür, Fenster)
  const { problems, shell, windowless } = checkPlan(base, ctxMin, bay, furnishable);
  const quality = silhouette(base, shell, def.checks, body);
  const misses = quality.filter((q) => !q.ok);
  const soft = [...new Set(hints)].map((t) => `Wunschraum „${t}“ entfiel (zu wenig Platz)`);
  soft.push(...misses.map((q) => `Silhouette: ${q.id} ${q.value} außerhalb ${q.range[0]}–${q.range[1]} (research/19 §9.1)`));
  // W5 (Review N8): gerade Front – Räume ohne Fenster (Feldbreiten 3 und 4) zählen wie verfehlte Silhouette-Werte, eine
  // fehlende Doppeltür (Eingangsraum erreicht das Mittelfeld nicht) doppelt
  const even = problems.length === 0 && 'evenFront' in def.massing && def.massing.evenFront === true;
  const double = shell !== undefined && [...shell.rooms.values()].some((r) => r.doors.some((d) => d.isMain && d.partner !== undefined));
  // W6: mit bekannter Feldbreite zählen Räume ohne Fenster an der geprüften Hülle bei jedem Bautyp (nicht im Erdhaus)
  const earth = EARTH_SETTINGS.has(base.params.setting?.kind ?? 'ground');
  const lit = bay === undefined || problems.length > 0 || earth ? 0 : windowless ?? 0;
  const dark = bay !== undefined ? lit + (even && !double ? 2 : 0)
    : even ? Math.max(...FRONT_BAYS.map((b) => windowlessRooms(base, b))) + (double ? 0 : 2) : 0;
  return { plan: { ...base, quality, warnings: problems, hints: soft }, problems, misses: misses.length + dark, ...(shell !== undefined ? { shell } : {}) };
}

/**
 * Lage aus der Definition (BT16): `front` von buried/cliff/carved gilt relativ zur Hausfront (kanonisch Süden) und dreht mit
 * dem Grundriss; ohne Angabe ist es die Hausfront.
 */
function typeSetting(def: BuildingTypeDef, front: HorizontalDir): BuildingSetting | undefined {
  if (def.setting === undefined) return undefined;
  const s = compact<BuildingSetting>(def.setting);
  return s.kind === 'buried' || s.kind === 'cliff' || s.kind === 'carved' ? { ...s, front: rotateFacing(s.front ?? 'south', quarterTurns(front)) } : s;
}

/**
 * Geneigtes Dach über dem Hauptbaukörper? Nein bei Flachdach (auch per Parameter) und eingegrabener Lage (Erddach);
 * feste Vorlagen ohne eigenen Stil übernehmen den Stil des Projekts – ohne Angabe gilt der Standard (Satteldach).
 */
function pitchedRoof(def: BuildingTypeDef, params: BuildingParams): boolean {
  const setting = params.setting ?? def.setting;
  return resolveShell(def, params).roof !== 'flat' && setting?.kind !== 'buried';
}

/** Fester Grundriss (`massing.generator: 'fixed'`): die Räume und Treppen der Definition, keine Unter-Seeds. */
function fixedPlan(def: BuildingTypeDef, params: BuildingParams, seed: number, ctx: ArchetypeContext): BuildingPlan {
  const m0 = def.massing;
  if (m0.generator !== 'fixed') throw new Error('kein fester Grundriss');
  // W12-A (Review R6-3): Variante mit Obergeschoss – Größe S nie, L immer, sonst per Seed (eigener Zufallsstrom); hat
  // sie einen Befund, gilt die eingeschossige Vorlage
  const st = m0.storeys;
  const upper = st !== undefined && params.size !== 'S'
    && (params.size === 'L' || new Rng(hashSeed(seed, def.id, 'storeys', params.reroll ?? 0)).chance(st.prob ?? 0.5));
  if (st !== undefined && upper) {
    const res = fixedVariant(def, { ...m0, upperFloors: st.upperFloors, rooms: st.rooms, stairs: st.stairs }, params, seed, ctx);
    if (res.problems.length === 0) return res.plan;
    ctx.trace?.(`${def.id} Obergeschoss verworfen: ${res.problems.join(' | ')}`, res.plan);
  }
  return fixedVariant(def, m0, params, seed, ctx).plan;
}

type FixedMassing = Extract<BuildingTypeDef['massing'], { generator: 'fixed' }>;

function fixedVariant(def: BuildingTypeDef, m: FixedMassing, params: BuildingParams, seed: number, ctx: ArchetypeContext): { plan: BuildingPlan; problems: string[] } {
  // W2 (D5): eingeschossige feste Vorlagen (Beispielhaus, Große Halle) mit lichter Höhe ≥ 4 – ihr Dach kommt aus dem
  // Stil des Projekts, das Budget der Hülle hält es dann bei ≤ 50 % der Gebäudehöhe
  const single = (m.upperFloors ?? 0) === 0 && pitchedRoof(def, params);
  const height = single ? Math.max(SINGLE_STOREY_MIN_HEIGHT, m.floorHeight ?? 3) : m.floorHeight ?? 3;
  // W13-A (Runde 2): ein Nebenbaukörper (Eckturm) kann höher sein als der Hauptbau – die Projekt-Etagen reichen bis zu
  // seinem obersten Raum (ohne Turm bitgleich)
  const top = Math.max(m.upperFloors ?? 0, ...m.rooms.map((r) => r.floor ?? 0));
  const floors = Array.from({ length: top + 1 }, (_, i) => ({ index: i, height }));
  // W13-A: Nebenbaukörper (`massing.volumes`, Anbau/Flügel mit eigenem Dach und eigener lichter Höhe) – IDs v1, v2 … in
  // der Reihenfolge der Definition; ohne `volumes` ein Baukörper (bitgleich)
  const extra = Object.entries(m.volumes ?? {});
  const volumeIdOf = (key: string | undefined): VolumeId => (key === undefined ? DEFAULT_VOLUME : `v${extra.findIndex(([k]) => k === key) + 1}`);
  const rooms: PlanRoom[] = m.rooms.map((r) => ({
    volumeId: volumeIdOf(r.volume), floor: r.floor ?? 0, cells: CellSet.rect(r.rect[0], r.rect[1], r.rect[2], r.rect[3]), roomTypeId: r.room, entry: -1, required: true,
  }));
  const volumes: Volume[] = [{ id: DEFAULT_VOLUME }, ...extra.map(([key, v], i): Volume => {
    const own = [...new Set(rooms.filter((r) => r.volumeId === `v${i + 1}`).map((r) => r.floor))].sort((a, b) => a - b);
    return {
      id: `v${i + 1}`, ...(v.name !== undefined ? { name: v.name } : { name: key }), ...(v.roof !== undefined ? { roof: v.roof as RoofStyle } : {}),
      ...(v.pitch !== undefined ? { roofDetail: { ...resolveShell(def, params).roofDetail, pitch: v.pitch } } : {}),
      ...(v.floorHeight !== undefined && v.floorHeight !== height ? { floorHeights: Object.fromEntries(own.map((f) => [f, v.floorHeight!])) } : {}),
    };
  })];
  const stairs: PlanStairs[] = (m.stairs ?? []).map((s) => ({
    volumeId: volumeIdOf(s.volume), floor: s.floor, origin: [s.origin[0], s.origin[1]], facing: s.facing, type: s.type, ...(s.turn !== undefined ? { turn: s.turn } : {}),
  }));
  const bay = planFacadeBay(def, params, ctx);
  const build = (list: PlanRoom[], furnishable?: ArchetypeFurnishable): { plan: BuildingPlan; problems: string[]; shell?: Shell } => {
    const d = orient({ volumes, wings: [], floors, rooms: list, stairs }, params.front ?? 'south', false, params.at);
    return finish(def, params, seed, 0, d, undefined, [], (i) => Math.min(4, ctx.minArea(d.rooms[i]!.roomTypeId)), bay, furnishable);
  };
  // W9-G1: Akzente am festen Grundriss (Zufall aus Seed und „neu würfeln“); verursachen sie einen Befund, gilt der
  // Grundriss ohne sie
  const features = m.features;
  if (features !== undefined) {
    const ground = rooms.filter((r) => r.floor === 0 && r.volumeId === DEFAULT_VOLUME).map((r) => r.cells.bounds()!);
    const main = { x0: Math.min(...ground.map((b) => b.minX)), z0: Math.min(...ground.map((b) => b.minZ)), x1: Math.max(...ground.map((b) => b.maxX)), z1: Math.max(...ground.map((b) => b.maxZ)) };
    const grow = (f: BuildingFeaturesDef, furnishable?: ArchetypeFurnishable): { plan: BuildingPlan; problems: string[]; shell?: Shell } =>
      build(applyFeatures(f, rooms, main, DEFAULT_VOLUME, m.upperFloors ?? 0, new Rng(hashSeed(seed, def.id, 'features', params.reroll ?? 0))).rooms, furnishable);
    const hallType = features.cross?.room;
    if (hallType === undefined) {
      const grown = grow(features);
      if (grown.problems.length === 0) return grown;
      ctx.trace?.(`${def.id} Akzente verworfen: ${grown.problems.join(' | ')}`, grown.plan);
      return build(rooms);
    }
    // W12-A: Diele im Vorsprung. Der Planer prüft ihre Einrichtbarkeit (W8-E; die übrigen Räume der Vorlage bleiben
    // ungeprüft wie bisher) und an der Probe-Hülle die Haustür: in der Front (nicht in einer Seitenwand des Vorsprungs)
    // und nicht Blatt an Blatt mit der Innentür (Windfang, `circulation`). Passt der gewürfelte Vorsprung nicht, die
    // übrigen Tiefen, Ecken und Breiten der Definition (feste Reihenfolge, flach zuerst), dann derselbe Vorsprung ohne Diele, dann nur die
    // Auskragung, dann die Kiste.
    const fits = ctx.furnishable;
    const furnish: ArchetypeFurnishable | undefined = fits === undefined ? undefined : (t, info) => (t === hallType ? fits(t, info) : []);
    const cross = features.cross!;
    const front = params.front ?? 'south';
    const doorProblem = (shell: Shell | undefined): string | undefined => {
      const room = shell === undefined ? undefined : [...shell.rooms.values()].find((r) => r.doors.some((d) => d.isMain));
      const main = room?.doors.find((d) => d.isMain);
      if (room === undefined || main === undefined) return 'keine Haustür';
      if (main.toward !== front) return `Haustür nach ${main.toward}, Front ${front}`;
      const axis = (d: HorizontalDir): string => (d === 'north' || d === 'south' ? 'z' : 'x');
      const clash = room.doors.some((d) => d !== main && d.partner === undefined && axis(d.toward) === axis(main.toward)
        && Math.abs(d.inside[0] - main.inside[0]) + Math.abs(d.inside[1] - main.inside[1]) <= 1);
      return clash ? 'Haustür und Innentür schlagen ineinander' : undefined;
    };
    const [w1, w2] = rangeOf(cross.width);
    const [d1, d2] = rangeOf(cross.depth);
    const aligns = cross.align === 'corner' || cross.align === 'any' ? (['start', 'end'] as const) : [cross.align ?? 'center'];
    const variants: BuildingFeaturesDef[] = [features];
    for (let depth = d1; depth <= d2; depth++) {
      for (const align of aligns) {
        for (let w = w2; w >= w1 && variants.length <= HALL_VARIANTS; w--) variants.push({ ...features, cross: { ...cross, width: w, depth, align } });
      }
    }
    for (const f of variants) {
      const r = grow(f, furnish);
      const why = r.problems.length > 0 ? r.problems.join(' | ') : doorProblem(r.shell);
      if (why === undefined) return r;
      ctx.trace?.(`${def.id} Diele verworfen: ${why}`, r.plan);
    }
    const { room: _room, ...plainCross } = cross;
    const plain = grow({ ...features, cross: plainCross });
    if (plain.problems.length === 0) return plain;
    if (features.jetty !== undefined) {
      const jetty = grow({ jetty: features.jetty });
      if (jetty.problems.length === 0) return jetty;
    }
  }
  return build(rooms);
}

/** W9-G1: Baumasse-Akzente der Definition (nicht bei Zeile und Turm). */
function featuresOf(def: BuildingTypeDef): BuildingFeaturesDef | undefined {
  const m = def.massing;
  return 'features' in m ? m.features : undefined;
}

/** W12-A: höchstens so viele Ersatz-Vorsprünge (Tiefe × Ecke × Breite) für die Diele, bevor der Planer auf den Vorsprung ohne Diele zurückfällt. */
const HALL_VARIANTS = 8;

/** W9-G1: Versuche mit Akzenten; danach (Rückfall) ohne. */
const FEATURE_ATTEMPTS = 8;

/**
 * Bauplan für einen Bautyp (research/19 §7.3). `seed` ist zugleich der Projekt-Seed (Türen und Wände der Hülle
 * hängen daran – die Prüfung rechnet mit genau diesem Projekt); neu gewürfelt wird über `params.reroll`.
 */
/**
 * Pflichträume, die im Plan fehlen (Test und Anzeige): Jeder Pflicht-Eintrag braucht auf jeder passenden Etage jedes
 * Baukörpers (Flügel-Einträge: jeder Etage des gebauten Flügels) mindestens einen Raum.
 */
export function requiredMissing(def: BuildingTypeDef, plan: BuildingPlan): string[] {
  const out: string[] = [];
  const role = (v: VolumeId): 'wing' | 'main' | 'part' => (plan.parts?.some((p) => p.volumeId === v) === true ? 'part'
    : plan.wings.some((w) => w.volumeId === v && def.massing.generator === 'wings' && def.massing.wings[w.id]?.volume === true) ? 'wing' : 'main');
  for (const [i, e] of (def.program ?? []).entries()) {
    if (e.required !== true) continue;
    for (const v of plan.volumes) {
      const own = plan.rooms.filter((r) => r.volumeId === v.id);
      if (own.length === 0) continue;
      const floors = [...new Set(own.map((r) => r.floor))];
      const hi = Math.max(...floors);
      const wing = e.wing === undefined ? undefined : plan.wings.find((w) => w.id === e.wing && w.volumeId === v.id);
      const part = plan.parts?.find((p) => p.volumeId === v.id);
      const need = e.wing !== undefined
        ? (wing === undefined ? [] : floors.filter((f) => f >= 0 && f < wing.floors))
        : e.part !== undefined ? (part?.id !== e.part ? [] : floors.filter((f) => matches(e.floor ?? 'ground', f, hi)))
          : role(v.id) !== 'main' ? [] : floors.filter((f) => matches(e.floor ?? 'ground', f, hi));
      for (const f of need) if (!own.some((r) => r.floor === f && r.entry === i)) out.push(`${typeof e.room === 'string' ? e.room : e.room.join('|')} fehlt auf Etage ${f} (${v.id})`);
    }
  }
  return out;
}

/** Größenklasse, die `chooseSize` für diese Parameter wählt (ohne Zufall: sie hängt nur von `size`/`floors` ab). */
function sizeClassOf(def: BuildingTypeDef, params: BuildingParams): BuildingSizeClass | undefined {
  const avail = BUILDING_SIZES.filter((s) => def.sizes?.[s] !== undefined);
  return params.size !== undefined && avail.includes(params.size) ? params.size : defaultSize(def, params.floors);
}

export function planBuilding(def: BuildingTypeDef, params: BuildingParams, seed: number, ctx: ArchetypeContext): BuildingPlan {
  // Funktionsgrad (W2-1): erweitertes Programm nur mit Stufe ≠ off; sonst läuft alles bitgleich wie bisher
  const level = params.functionLevel ?? 'off';
  const fn = level === 'off' ? undefined : withFunctions(def, level, sizeClassOf(def, params), params.floors, seed, params.reroll ?? 0);
  // Silhouette (WS 7 Schritte): nach den Funktionsräumen, denn der Anbau hängt sein Raumprogramm ans Ende (Indizes bleiben)
  const shaped = withSilhouette(fn === undefined ? def : fn.def, params.silhouette, sizeClassOf(def, params), seed, params.reroll ?? 0);
  const built0 = planWithUnderground(shaped, params, seed, ctx);
  const built = params.silhouette !== 'varied' ? built0 : { ...built0, params: { ...built0.params, silhouette: 'varied' as const } };
  const base = def.program?.length ?? 0;
  const label = (e: BuildingFunctionEntry): string => (typeof e.room === 'string' ? e.room : e.room.join('|'));
  // Hinweis nennt nur, was der Plan wirklich enthält (Wunschräume können am Platz scheitern)
  const realized = fn === undefined ? [] : fn.chosen.filter((_, i) => built.rooms.some((r) => r.entry === base + i));
  const plan = fn === undefined ? built : {
    ...built,
    params: { ...built.params, functionLevel: level },
    hints: [
      ...built.hints,
      realized.length > 0
        ? `Funktionsgrad ${level}: ${realized.map(label).join(', ')}`
        : `Funktionsgrad ${level}: ${supportsFunctions(def) ? (fn.chosen.length > 0 ? 'Anlage passte nicht in den Grundriss' : 'keine passende Anlage für diese Größe') : 'dieser Bautyp hat keine Funktionsräume'}`,
    ],
  };
  // Zusatztüren für Rundgänge: eigener Schalter (Review A3); fehlt oder 0 = bitgleich
  return params.loopDoors === undefined || params.loopDoors <= 0 ? plan : { ...plan, loopDoors: Math.min(1, params.loopDoors) };
}

function planWithUnderground(def: BuildingTypeDef, params: BuildingParams, seed: number, ctx: ArchetypeContext): BuildingPlan {
  const house = planHouse(def, params, seed, ctx);
  // Feature-Schalter Unterbau (feat/underground): ohne ihn (und mit Standard „aus“ des Bautyps) bitgleich
  const u = params.underground ?? undergroundDefault(def.id);
  // abgewählt, obwohl der Bautyp ihn als Standard hat: in der Herkunft festhalten (sonst gälte wieder der Standard)
  if (u === false) return undergroundDefault(def.id) ? { ...house, params: { ...house.params, underground: false } } : house;
  return withUnderground(def, house, u === true ? {} : u, ctx, planFacadeBay(def, params, ctx));
}

/** Unterbau zum geprüften Hausplan; passt keiner, bleibt der Hausplan mit Hinweis. */
function withUnderground(def: BuildingTypeDef, house: BuildingPlan, u: UndergroundParams, ctx: ArchetypeContext, bay?: number): BuildingPlan {
  const flagged: BuildingPlan = { ...house, params: { ...house.params, underground: Object.keys(u).length === 0 ? true : u } };
  if (house.warnings.length > 0) return { ...flagged, hints: [...house.hints, 'Unterbau entfiel: der Hausplan hat Warnungen'] };
  const minOf = (i: number): number => {
    const r = house.rooms[i]!;
    return r.entry >= 0 ? (def.program![r.entry]!.minArea ?? ctx.minArea(r.roomTypeId)) : Math.min(4, ctx.minArea(r.roomTypeId));
  };
  // ein neuer Hauskeller nimmt den Pflichtraum des Programms für den Keller auf (Taverne: Weinkeller), sonst fehlte er
  const ci = (def.program ?? []).findIndex((e) => e.required === true && e.wing === undefined && e.part === undefined && e.floor !== undefined && matches(e.floor, -1, 0));
  const ce = ci >= 0 ? def.program![ci]! : undefined;
  const cellar = ce === undefined ? undefined : { roomTypeId: typeof ce.room === 'string' ? ce.room : ce.room[0]!, entry: ci };
  const res = planUnderground({
    plan: flagged, params: u, minArea: (t) => ctx.minArea(t), planMinArea: minOf, ...(bay !== undefined ? { bay } : {}), ...(cellar !== undefined ? { cellar } : {}),
  });
  if (!res.ok) return { ...flagged, hints: [...house.hints, `Unterbau entfiel: ${res.reason}`] };
  return res.plan;
}

function planHouse(def: BuildingTypeDef, params: BuildingParams, seed: number, ctx: ArchetypeContext): BuildingPlan {
  if (def.massing.generator === 'fixed') return fixedPlan(def, params, seed, ctx);
  let best: { plan: BuildingPlan; score: number; alts: ReadonlyArray<() => { plan: BuildingPlan; problems: string[]; misses: number }> } | undefined;
  let reason = '';
  const bay = planFacadeBay(def, params, ctx);
  // Raster für die Teilung nur, wo die Seiten Fassade sind (Erdhaus: nur die Front)
  const layoutBay = EARTH_SETTINGS.has(params.setting?.kind ?? def.setting?.kind ?? 'ground') ? undefined : bay;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = new Rng(hashSeed(seed, def.id, 'plan', params.reroll ?? 0, attempt));
    const relax = attempt >= 8 ? 2 : attempt >= 4 ? 1 : 0;
    const sz = chooseSize(def, params, rng.fork('size'), pitchedRoof(def, params), bay);
    const shapes = normalize(massing(def, sz, params, rng.fork('massing'), layoutBay));
    const heights = new Map<number, number>([[-1, sz.upper], [0, sz.ground]]);
    const top = Math.max(...shapes.map((s) => s.floors));
    for (let f = 1; f < top; f++) heights.set(f, sz.upper);
    const hints: string[] = [];
    const rooms: PlanRoom[] = [];
    const stairs: PlanStairs[] = [];
    let failed: string | undefined;
    const lo = shapes.some((s) => s.cellar) ? -1 : 0;
    const floors: { index: number; height: number }[] = [];
    for (let f = lo; f < top; f++) floors.push({ index: f, height: heights.get(f)! });
    const volumes: Volume[] = shapes.map((s) => ({
      id: s.id, ...(s.name !== undefined && s.role !== 'main' ? { name: s.name } : {}), ...(s.roof !== undefined ? { roof: s.roof } : {}),
      ...(s.roofDetail !== undefined ? { roofDetail: s.roofDetail } : {}),
      ...(s.exterior !== undefined ? { exterior: s.exterior } : {}),
      ...(s.height !== undefined ? { floorHeights: Object.fromEntries(Array.from({ length: s.floors + (s.cellar ? 1 : 0) }, (_, i) => [i - (s.cellar ? 1 : 0), s.height!])) } : {}),
    }));
    // W9-G1: Baumasse-Akzente. Mit gebautem Flügel (Stall, Scheune) hat das Haus schon seinen zweiten First: dann nur die
    // Auskragung. Die Lage des Quergiebels steht vor der Teilung fest, damit das Raster die echten Außenlinien kennt.
    const winged = shapes[0]!.wings.length > 0 || shapes.some((s) => s.role === 'wing');
    const all = attempt < FEATURE_ATTEMPTS && shapes[0]!.role === 'main' ? featuresOf(def) : undefined;
    const features = all === undefined || !winged || all.cross === undefined ? all : all.jetty === undefined ? undefined : { jetty: all.jetty };
    const cross = chooseCross(features, shapes[0]!.main, shapes[0]!.floors - 1, rng.fork('features'));
    const gridAt = layoutBay === undefined ? undefined : massingGridAt(def, shapes, floors, volumes, seed, layoutBay, resolveShell(def, params).windows.spacing, cross);
    for (const s of shapes) {
      // angebaute Teile nehmen dem Hauptbaukörper die Wandspalte unter ihrem Grundriss (auf allen Etagen)
      const claim = s.role === 'main' ? shapes.filter((p) => p.attached === true).reduce((u, p) => u.union(boxCells(p.main)), CellSet.empty()) : CellSet.empty();
      const vp = planVolume(def, s, heights, rng.fork(`volume${s.id}`), relax, ctx, hints, gridAt, claim, attempt);
      if (typeof vp === 'string') {
        failed = `${s.id}: ${vp}`;
        break;
      }
      rooms.push(...(claim.isEmpty ? vp.rooms : vp.rooms.map((r) => ({ ...r, cells: r.cells.difference(claim) }))));
      stairs.push(...vp.stairs);
    }
    if (failed !== undefined) {
      reason = failed;
      ctx.trace?.(`${def.id} Versuch ${attempt}: ${failed}`);
      ctx.traceLayout?.({ type: 'attempt', attempt, failed, problems: [] });
      continue;
    }
    // W9-G1: Baumasse-Akzente (Auskragung, Quergiebel/Vorbau) am Hauptbaukörper; die letzten Versuche ohne (Rückfall)
    let body: PlanRoom[] | undefined;
    /** Rückfall-Stufe „nur Auskragung“ (sie verkürzt keine Wandlinie, das Fassadenraster bleibt). */
    let jettyOnly: PlanRoom[] | undefined;
    if (features !== undefined) {
      const grow = (f: BuildingFeaturesDef): PlanRoom[] => applyFeatures(f, rooms, shapes[0]!.main, shapes[0]!.id, shapes[0]!.floors - 1, rng.fork('features')).rooms;
      const grown = grow(features);
      if (features.jetty !== undefined && features.cross !== undefined) jettyOnly = grow({ jetty: features.jetty });
      body = [...rooms];
      rooms.splice(0, rooms.length, ...grown);
    }
    const windmill = planWindmill(def, shapes[0]!.main, rng.fork('windmill'));
    const silo = planSilo(def, sz.size, shapes, rng.fork('silo'));
    const wings = shapes.flatMap((s) => [
      ...(s.wingId !== undefined ? [{ id: s.wingId, volumeId: s.id, floors: s.floors }] : []),
      ...s.wings.map((w) => ({ id: w.id, volumeId: s.id, floors: w.floors })),
    ]);
    const parts = shapes.flatMap((s): PlanPart[] => (s.partId === undefined ? [] : [{
      id: s.partId, volumeId: s.id, floors: s.floors, ...(s.parapet !== undefined ? { parapet: s.parapet } : {}),
      ...(s.parapetDeck !== undefined ? { parapetDeck: s.parapetDeck } : {}),
    }]));
    const ring = planRing(def, rng.fork('ring'));
    const d = orient({
      volumes, wings, floors, rooms, stairs, ...(windmill !== undefined ? { windmill } : {}), ...(silo !== undefined ? { silo } : {}), parts, ...(ring !== undefined ? { ring } : {}),
    }, params.front ?? 'south', true, params.at);
    const minOf = (i: number): number => {
      const r = d.rooms[i]!;
      return r.entry >= 0 ? (def.program![r.entry]!.minArea ?? ctx.minArea(r.roomTypeId)) : Math.min(4, ctx.minArea(r.roomTypeId));
    };
    // W9-G1: Silhouette am Baukörper ohne Akzente (gleiche Drehung und Lage wie der Plan)
    const draftOf = (list: PlanRoom[]): Draft => orient({
      volumes, wings, floors, rooms: list, stairs, ...(windmill !== undefined ? { windmill } : {}), ...(silo !== undefined ? { silo } : {}), parts, ...(ring !== undefined ? { ring } : {}),
    }, params.front ?? 'south', true, params.at);
    const bodyD = body === undefined ? undefined : draftOf(body);
    let res = finish(def, params, seed, attempt, d, sz.size, hints, minOf, bay, ctx.furnishable, bodyD);
    // W9-G1: kosten die Akzente einen harten Befund, zählt derselbe Versuch nur mit Auskragung bzw. ohne Akzente mit
    // (der bessere gilt, bei Gleichstand der mit mehr Akzenten). Nur weiche Fehlwerte (Raum ohne Fensterachse,
    // Silhouette, nur mit Fassadenraster `bay` wie in App und Engine): erst nach der Suche und nur für den besten Versuch
    // „nur Auskragung“, dann „ohne“ – so bleibt die Planzeit im Rahmen (höchstens zwei Prüfungen mehr je Plan)
    const scoreOf = (r: { problems: string[]; misses: number }): number => r.problems.length * 1000 + r.misses;
    const retry = (alt: PlanRoom[]) => finish(def, params, seed, attempt, draftOf(alt), sz.size, hints, minOf, bay, ctx.furnishable, bodyD);
    if (bodyD !== undefined && res.problems.length > 0) {
      for (const alt of [jettyOnly, body]) {
        if (alt === undefined || res.problems.length === 0) continue;
        const next = retry(alt);
        if (scoreOf(next) < scoreOf(res)) res = next;
      }
    }
    if (res.problems.length > 0) ctx.trace?.(`${def.id} Versuch ${attempt}: ${res.problems.join(' | ')}`, res.plan);
    const score = scoreOf(res);
    ctx.traceLayout?.({ type: 'attempt', attempt, problems: res.problems, score });
    const alts = res.problems.length === 0 && score > 0 && body !== undefined && bay !== undefined ? [jettyOnly, body].filter((a) => a !== undefined) : [];
    if (best === undefined || score < best.score) best = { plan: res.plan, score, alts: alts.map((a) => () => retry(a)) };
    if (score === 0 || (res.problems.length === 0 && attempt + 1 >= SILHOUETTE_TRIES)) break;
  }
  for (const alt of best?.alts ?? []) {
    const next = alt();
    const score = next.problems.length * 1000 + next.misses;
    if (score < best!.score) best = { plan: next.plan, score, alts: [] };
  }
  if (best === undefined) throw new Error(`Bautyp ${def.id}: kein Grundriss (${reason})`);
  return best.plan;
}

/**
 * W6: Raster je Rechteck und Etage aus der Hülle der Baukörper (`massingGrid`, kanonische Lage – `bays` ist
 * spiegelsymmetrisch, die Drehung zur Front ändert Pfosten und Achsen nicht). Je Baukörper und Etage ein Raum: Rechteck
 * samt angebauter Flügel, ohne die Wandspalte angebauter Teile. Liefert die Hülle keine Linien, gilt das Raster des
 * freien Rechtecks.
 */
function massingGridAt(
  def: BuildingTypeDef, shapes: readonly Shape[], floors: readonly { index: number; height: number }[], volumes: readonly Volume[], seed: number, bay: number,
  spacing: number | undefined, cross?: CrossChoice,
): (axes: Axes, floor: number) => LayoutGrid {
  const claim = shapes.filter((p) => p.attached === true).reduce((u, p) => u.union(boxCells(p.main)), CellSet.empty());
  const rooms: PlanRoom[] = shapes.flatMap((s) => Array.from({ length: s.floors }, (_, f): PlanRoom => {
    let cells = s.wings.filter((w) => f < w.floors).reduce((u, w) => u.union(boxCells(w.box)), boxCells(s.main));
    if (s.role === 'main') cells = cells.difference(claim);
    // W9-G1: Quergiebel vor der Front – die Frontlinie dahinter ist kürzer, ihr Raster ein anderes
    if (s.role === 'main' && cross !== undefined && cross.floors.includes(f)) {
      cells = cells.union(boxCells({ x0: cross.x0, z0: s.main.z1 + 1, x1: cross.x1, z1: s.main.z1 + cross.depth }));
    }
    return { volumeId: s.id, floor: f, cells, roomTypeId: 'storage', entry: -1, required: false };
  }));
  const lines = massingGrid({ typeId: def.id, name: def.name, seed, floors, volumes, rooms }, bay, spacing);
  return (axes, floor) => (lines.length === 0 ? layoutGrid(axes.L, axes.S, bay) : gridFromLines(axes, lines.filter((l) => l.floorIndex === floor), bay));
}

/** Verschiebt alle Rechtecke an den Ursprung (Flügel links bzw. hinten haben negative Koordinaten). */
function normalize(shapes: Shape[]): Shape[] {
  const boxes = shapes.flatMap((s) => [s.main, ...s.wings.map((w) => w.box)]);
  const dx = -Math.min(...boxes.map((b) => b.x0));
  const dz = -Math.min(...boxes.map((b) => b.z0));
  const mv = (b: Box): Box => ({ x0: b.x0 + dx, z0: b.z0 + dz, x1: b.x1 + dx, z1: b.z1 + dz });
  return shapes.map((s) => ({ ...s, main: mv(s.main), wings: s.wings.map((w) => ({ ...w, box: mv(w.box) })) }));
}
