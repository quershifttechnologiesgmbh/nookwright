/**
 * Umgebung eines Projekts in der Projektdatei (`surroundings`): Gelände als Event-Historie des Aggregats `Site`,
 * Bauwerke mit stabilen IDs, Rand und Schalter. Dazu das tolerante Lesen (`readSurroundings`) und die Abbildung auf die
 * Eingaben des Anwendungsdienstes (`structuresInput`, `attachedTowersOf`). Früher in `packages/app/src/surroundings.ts`;
 * hier, damit App und Engine-API dieselbe Datei lesen und schreiben (C1). Rein bis auf einen Zwischenspeicher.
 */
import { DomainError, type ShellAnnexOpening } from '@mcda/blueprint';
import { HORIZONTAL, type Cell } from '@mcda/core';
import { ENSEMBLE_DEFAULT, type AttachedTower, type EnsembleOptions, type SurfaceTextureSwitch, type WeatheringSwitch } from '@mcda/pipeline';
import type {
  AnnexKind, GateSpec, ParapetCrown, ParapetSpec, RoofShape, StructuresInput, TowerFinial, TowerShape, TowerSpec, TowerStyle, TowerTop, TowerTopStyle, WallPlan,
  SiloSpec, WindmillSpec,
} from '@mcda/structures';
import { LANDFORMS, Site, VEGETATION_LIMIT, type Landform, type SiteDecorLevel, type SiteEvent, type SiteEventType, type SiteState, type VegetationDensity } from '@mcda/terrain';

// ---------------------------------------------------------------------------------------------- Zustand

/** Angedockter Turm (C4, research/18 T1/T3): Turm-Plan des Anwendungsdienstes ohne ID (die ID ist die des Bauwerks). */
export type AnnexSpec = Omit<AttachedTower, 'id'>;

export type StructureItem =
  | { readonly kind: 'wall'; readonly id: string; readonly plan: WallPlan }
  | { readonly kind: 'tower'; readonly id: string; readonly spec: TowerSpec }
  | { readonly kind: 'windmill'; readonly id: string; readonly spec: WindmillSpec }
  /** Additiv (W12-C): Hochsilo (Bauernhof). */
  | { readonly kind: 'silo'; readonly id: string; readonly spec: Omit<SiloSpec, 'id'> }
  | { readonly kind: 'annex'; readonly id: string; readonly spec: AnnexSpec }
  /**
   * Wehrplatte (BT01): **an einen Baukörper gebunden** (`volumeId`) – Zellen und Höhe werden beim Bauen aus der Hülle
   * abgeleitet (`parapetSpecsFor`), nicht gespeichert. `cells`/`y` gibt es nur noch, um alte Dateien (und ältere
   * Engine-Sitzungen) zu lesen, in denen die Platte als feste Kopie stand – sie wäre sonst nach dem Löschen einer
   * Etage in der Luft hängen geblieben.
   */
  | {
      readonly kind: 'parapet';
      readonly id: string;
      /**
       * Baukörper-Bindung. **Fehlt sie** (Dateien aus 82b58ad), wird die Platte als **feste Kopie** aus `cells`/`y`
       * gebaut – nicht auf den Hauptbaukörper umgebogen (Review e5108a5, Befund 2).
       */
      readonly volumeId?: string;
      readonly merlon?: { readonly width?: number; readonly gap?: number };
      /** Additiv (W3-CA): Abschluss (Zinnen oder Ausguck) und Belag, siehe `ParapetSpec`. */
      readonly crown?: ParapetCrown;
      readonly deck?: boolean;
      readonly cells?: readonly Cell[];
      readonly y?: number;
    };

export type StructureKind = StructureItem['kind'];

export interface SurroundingsState {
  /** Event-Historie des Gelände-Aggregats; fehlt = noch nie angelegt. */
  readonly site?: readonly SiteEvent[] | undefined;
  /** Gelände an/aus. Aus: Historie bleibt (Zonen, Terraforming), Vorschau und Export ohne Gelände. */
  readonly terrain: boolean;
  /** Rand des Grundstücks um das Haus (Blöcke), für „an Haus anpassen“. */
  readonly margin: number;
  readonly structures: readonly StructureItem[];
  /** Zähler für Bauwerks-IDs (w1, t2, m3 …). */
  readonly seq: number;
  /**
   * Additiv (F-Ensemble): Verbindungsgraph der Base (Brücken aus Obergeschossen, Anschluss- und Rundwege) an/aus;
   * fehlt = Standard des Anwendungsdienstes (`ENSEMBLE_DEFAULT`).
   */
  readonly ensemble?: boolean;
  /**
   * Additiv (feat/site-decor): Grundstücks-Deko (Bänke, Beete, Bannermasten, Pferch … am Haus und Weg) aus/wenig/dicht;
   * fehlt = aus (bitgleich zu Dateien ohne das Feld).
   */
  readonly siteDecor?: SiteDecorLevel;
  /**
   * Additiv (feat/gelaende): Geländeform ('natural' | 'dramatic' = Hang hinter dem Haus mit Stützmauer, Teich, Findlinge,
   * Moos am Sockel); fehlt oder 'flat' = wie bisher (bitgleich).
   */
  readonly landform?: Landform;
  /**
   * Additiv (WS-Verwitterung): erzählende Verwitterung der Fassaden, Dächer und Sockel ('some' | 'rich'); fehlt = aus
   * (bitgleich zu Dateien ohne das Feld). Wirkt auch ohne Gelände.
   */
  readonly weathering?: WeatheringLevel;
  /**
   * Additiv (TX-B): Oberflächen-Textur (Blockmischung aus Schwesterblöcken, Sockel-/Traufverlauf, Dachverlauf, Kontrast an
   * Ecken und Öffnungen, Musterbruch) 'subtle' | 'rich'; fehlt = aus (bitgleich zu Dateien ohne das Feld). Wirkt auch ohne Gelände.
   */
  readonly surfaceTexture?: SurfaceTextureLevel;
}

/** Stufen der Oberflächen-Textur in der Datei (`off` = Feld fehlt). */
export type SurfaceTextureLevel = Exclude<SurfaceTextureSwitch, 'off'>;

/** Stufen der erzählenden Verwitterung in der Datei (`off` = Feld fehlt). */
export type WeatheringLevel = Exclude<WeatheringSwitch, 'off'>;

export const MARGIN_RANGE = { min: 4, max: 48, standard: 12 } as const;
export const EMPTY_SURROUNDINGS: SurroundingsState = { terrain: false, margin: MARGIN_RANGE.standard, structures: [], seq: 1 };
export const TOWER_LEVELS = { min: 1, max: 8 } as const;
export const SAIL_RANGE = { min: 3, max: 12 } as const;
export const TOWER_SPACING_RANGE = { min: 0, max: 48 } as const;

/** Gibt es etwas zu bauen (Gelände an oder mindestens ein Bauwerk)? */
export function hasSurroundings(sur: SurroundingsState | undefined): sur is SurroundingsState {
  return sur !== undefined && ((sur.terrain && sur.site !== undefined) || sur.structures.length > 0 || sur.weathering !== undefined || sur.surfaceTexture !== undefined);
}

/** Werte der Turmgestalt, erschöpfend je Domänen-Union (neuer Wert = Typfehler hier). */
const idsOf = <T extends string>(r: Readonly<Record<T, true>>): readonly T[] => Object.keys(r) as T[];
export const TOWER_SHAPE_IDS = idsOf<TowerShape>({ round: true, square: true });
export const TOWER_TOP_IDS = idsOf<TowerTop>({ roof: true, battlements: true, lookout: true, belfry: true, platform: true });
export const TOWER_ROOF_IDS = idsOf<RoofShape>({ cone: true, tent: true, helm: true, spire: true, bell: true });
export const TOWER_FINIAL_IDS = idsOf<TowerFinial>({ none: true, pole: true, lantern: true, spike: true, rod: true, end_rod: true });
export const ANNEX_KIND_IDS = idsOf<AnnexKind>({ stair: true, corner: true });

const siteStates = new WeakMap<readonly SiteEvent[], SiteState>();

/** Zustand des Geländes aus der Historie (zwischengespeichert je Historie). */
export function siteStateOf(events: readonly SiteEvent[]): SiteState {
  let st = siteStates.get(events);
  if (st === undefined) {
    st = Site.fromHistory(events).state;
    siteStates.set(events, st);
  }
  return st;
}

/** Schon berechneten Zustand zu einer Historie merken (spart ein Abspielen). */
export function rememberSiteState(events: readonly SiteEvent[], state: SiteState): void {
  siteStates.set(events, state);
}

/** Gelände der Sitzung (auch wenn abgeschaltet); `undefined`, wenn nie angelegt. */
export function siteOf(sur: SurroundingsState | undefined): SiteState | undefined {
  return sur?.site === undefined ? undefined : siteStateOf(sur.site);
}

const MAX_COORD = 30_000;

export function checkCell(c: Cell, what: string): Cell {
  if (!Number.isInteger(c[0]) || !Number.isInteger(c[1]) || Math.abs(c[0]) > MAX_COORD || Math.abs(c[1]) > MAX_COORD) {
    throw new DomainError('structure.cell', `${what}: ungültige Zelle ${c[0]}, ${c[1]}`);
  }
  return [c[0], c[1]];
}

/** Stützpunkte bereinigen: aufeinanderfolgende Doppelte weg, Ring ohne wiederholten Anfangspunkt; prüft die Mindestzahl. */
export function cleanPoints(points: readonly Cell[], closed: boolean): Cell[] {
  const out: Cell[] = [];
  for (const p of points) {
    const c = checkCell(p, 'Mauerzug');
    const last = out[out.length - 1];
    if (last === undefined || last[0] !== c[0] || last[1] !== c[1]) out.push(c);
  }
  if (closed && out.length > 1 && out[0]![0] === out[out.length - 1]![0] && out[0]![1] === out[out.length - 1]![1]) out.pop();
  const min = closed ? 3 : 2;
  if (out.length < min) throw new DomainError('wall.points', closed ? 'Ein Mauerring braucht mindestens 3 Punkte' : 'Ein Mauerzug braucht mindestens 2 Punkte');
  return out;
}

// ---------------------------------------------------------------------------------------------- Laden (tolerant)

/** Alle Event-Arten des Gelände-Aggregats – als Record, damit der Compiler neue Arten der Domäne hier einfordert. */
const SITE_EVENT_TYPES: Readonly<Record<SiteEventType, true>> = {
  SiteCreated: true, PlotResized: true, TerrainStyleChanged: true, SiteRerolled: true, ZonePainted: true, ZoneCellsLost: true, ZoneRemoved: true,
  ZoneKindChanged: true, TerrainSculpted: true, TerrainFlattened: true, TerrainReset: true, ZoneEdgeChanged: true, SiteLightingChanged: true,
  VegetationChanged: true, TerrainSmoothed: true,
};
const isSiteEventType = (t: unknown): t is SiteEventType => typeof t === 'string' && Object.hasOwn(SITE_EVENT_TYPES, t);
const isFactor = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= VEGETATION_LIMIT;
/** Werte, die beim Abspielen nicht auffallen würden (Faktoren gehen ungeprüft in den Generator), vorab prüfen. */
const isSiteEvent = (e: unknown): e is SiteEvent =>
  isObject(e) && isSiteEventType(e['type']) && (e['type'] !== 'VegetationChanged' || (isObject(e['vegetation']) && isFactor(e['vegetation']['trees']) && isFactor(e['vegetation']['bushes']) && isFactor(e['vegetation']['ground'])));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCell = (v: unknown): v is Cell => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && Math.abs(n as number) <= MAX_COORD);
const oneOf = <T extends string>(v: unknown, ids: readonly T[]): T | undefined => (typeof v === 'string' && (ids as readonly string[]).includes(v) ? (v as T) : undefined);
const intIn = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);

// Feldweise Leser je Domänen-Typ. `FieldReaders<T>` verlangt für JEDES Feld von T einen Leser (ein neues Feld in
// @mcda/structures bricht hier den Typecheck, bis es gelesen oder begründet ausgenommen ist); Zusatzfelder sind
// ebenfalls Typfehler. Ungültige Werte fallen einzeln heraus (tolerant), der Rest des Bauwerks bleibt. Grenzen: die
// weiteste der Engine-API (`packages/engine/src/structures.ts`), des Bautyp-Katalogs und älterer Dateien.

type Reader<T> = (v: unknown) => T | undefined;
/** Leser je Feld von `T` ohne `Skip` (Compile-Zeit-Zwang wie `AssertCovered` in der Engine, ohne Abhängigkeit dorthin). */
type FieldReaders<T, Skip extends keyof T = never> = { readonly [K in Exclude<keyof T, Skip>]-?: Reader<Exclude<T[K], undefined>> };

/** Nur Felder mit gültigen Werten übernehmen. */
function readFields<T, Skip extends keyof T = never>(v: Record<string, unknown>, readers: FieldReaders<T, Skip>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, read] of Object.entries(readers) as [string, Reader<unknown>][]) {
    const x = read(v[k]);
    if (x !== undefined) out[k] = x;
  }
  return out as Partial<T>;
}

const bool: Reader<boolean> = (v) => (typeof v === 'boolean' ? v : undefined);
const int = (min: number, max: number): Reader<number> => (v) => intIn(v, min, max);
const pick = <T extends string>(ids: readonly T[]): Reader<T> => (v) => oneOf(v, ids);
const cell: Reader<Cell> = (v) => (isCell(v) ? [v[0], v[1]] : undefined);
/** Liste: ungültige Einträge fallen heraus, höchstens `max`. */
const listOf = <T>(read: Reader<T>, max: number): Reader<T[]> => (v) =>
  Array.isArray(v) ? v.flatMap((x) => { const r = read(x); return r === undefined ? [] : [r]; }).slice(0, max) : undefined;
/** Verschachteltes Objekt; leer = fehlt. */
const objectOf = <T>(readers: FieldReaders<T>): Reader<T> => (v) => {
  if (!isObject(v)) return undefined;
  const r = readFields(v, readers);
  return Object.keys(r).length > 0 ? (r as T) : undefined;
};
/** Objekt mit Pflichtfeldern: fehlt eines, ist das ganze Objekt ungültig. */
const requiring = <T>(read: (v: Record<string, unknown>) => Partial<T>, required: readonly (keyof T)[]): Reader<T> => (v) => {
  if (!isObject(v)) return undefined;
  const r = read(v);
  return required.every((k) => r[k] !== undefined) ? (r as T) : undefined;
};

const MERLON: FieldReaders<NonNullable<WallPlan['merlon']>> = { width: int(1, 8), gap: int(1, 8) };

/** W3-CA: Abschluss je Rolle der Mauertürme (Ecke, Torhaus). */
const TOWER_TOP: FieldReaders<TowerTopStyle> = {
  top: pick(TOWER_TOP_IDS),
  roofShape: pick(TOWER_ROOF_IDS),
  roofPitch: int(1, 4) as Reader<1 | 2 | 3 | 4>,
  flare: bool,
  finial: pick(TOWER_FINIAL_IDS),
  corbels: bool,
  hangingLanterns: bool,
};

const TOWER_STYLE: FieldReaders<TowerStyle> = {
  ...TOWER_TOP,
  shape: pick(TOWER_SHAPE_IDS),
  size: int(3, 31),
  levelHeight: int(3, 8),
  bell: pick(['floor', 'hanging'] as const),
  lit: bool,
  corner: objectOf(TOWER_TOP),
  gate: objectOf(TOWER_TOP),
};

const GATE: FieldReaders<GateSpec> = { at: cell, width: int(1, 7), height: int(2, 8), gatehouse: bool, gateBlock: bool };

/** `points` bereinigt erst `readItem` (braucht `closed`). */
const WALL: FieldReaders<WallPlan, 'id'> = {
  points: (v) => (Array.isArray(v) && v.every(isCell) ? (v as Cell[]).map((c): Cell => [c[0], c[1]]) : undefined),
  closed: bool,
  profile: pick(['fortress', 'garden'] as const),
  garden: objectOf<NonNullable<WallPlan['garden']>>({ pillarEvery: int(2, 12), lanterns: bool, hedge: bool }),
  thickness: int(1, 5),
  height: int(2, 16),
  outside: pick(['left', 'right'] as const),
  merlon: objectOf(MERLON),
  plinth: objectOf<NonNullable<WallPlan['plinth']>>({ rows: int(0, 4), batter: bool }),
  towers: pick(['auto', 'none'] as const),
  towerStyle: objectOf(TOWER_STYLE),
  towerRise: int(2, 12),
  cornerAngle: int(5, 90),
  towerSpacing: int(TOWER_SPACING_RANGE.min, 64), // Engine-API erlaubt bis 64 (UI-Regler bis 48)
  extraTowers: listOf(cell, 64),
  gates: listOf(requiring<GateSpec>((g) => readFields(g, GATE), ['at']), 16),
  stairs: (v) => oneOf(v, ['auto', 'none'] as const) ?? listOf(cell, 16)(v),
  accents: bool,
};

const TOWER: FieldReaders<TowerSpec, 'id'> = {
  ...TOWER_STYLE, center: cell, levels: int(TOWER_LEVELS.min, TOWER_LEVELS.max), door: pick(HORIZONTAL),
};

const WINDMILL: FieldReaders<WindmillSpec, 'id'> = {
  ...TOWER_STYLE,
  center: cell,
  levels: int(TOWER_LEVELS.min, TOWER_LEVELS.max),
  facing: pick(HORIZONTAL),
  sailLength: int(SAIL_RANGE.min, SAIL_RANGE.max),
  sailWidth: int(1, 3),
  door: pick(HORIZONTAL),
};

const SILO: FieldReaders<SiloSpec, 'id'> = { center: cell, radius: int(2, 4), height: int(8, 24) };

const ANNEX: FieldReaders<AnnexSpec> = {
  ...TOWER_STYLE,
  center: cell,
  side: pick(HORIZONTAL),
  kind: pick(ANNEX_KIND_IDS),
  levels: int(TOWER_LEVELS.min, TOWER_LEVELS.max),
  entrance: bool,
  openings: listOf(requiring<ShellAnnexOpening>((o) => readFields(o, { floorIndex: int(-4, 64), at: cell }), ['floorIndex', 'at']), 16),
};

const shortText = (max: number): Reader<string> => (v) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);

const PARAPET: FieldReaders<Extract<StructureItem, { kind: 'parapet' }>, 'id' | 'kind'> = {
  volumeId: shortText(16), merlon: objectOf(MERLON), crown: pick(['crenel', 'lookout'] as const), deck: bool,
  cells: listOf(cell, 65_536), y: int(-64, 320),
};

/** Jede Liste des Anwendungsdienstes hat eine Bauwerks-Art (neue Liste in `StructuresInput` = Typfehler hier). */
// `bridges` (F-Ensemble) leitet `generateBase` aus dem Verbindungsgraphen ab – keine gespeicherte Liste
const INPUT_KIND: Readonly<Record<Exclude<keyof StructuresInput, 'annexTowers' | 'bridges'>, StructureKind>> = {
  walls: 'wall', towers: 'tower', windmills: 'windmill', parapets: 'parapet', silos: 'silo',
};
void INPUT_KIND;

const STRUCTURE_ID = /^[a-z][a-z0-9_-]*$/;

function readItem(v: unknown): StructureItem | undefined {
  if (!isObject(v) || typeof v['id'] !== 'string' || !STRUCTURE_ID.test(v['id'])) return undefined;
  const id = v['id'];
  if (v['kind'] === 'wall' && isObject(v['plan'])) {
    const { points: raw, ...rest } = readFields(v['plan'], WALL);
    if (raw === undefined) return undefined;
    const closed = rest.closed === true;
    let points: Cell[];
    try {
      points = cleanPoints(raw, closed);
    } catch {
      return undefined;
    }
    return { kind: 'wall', id, plan: { ...rest, points, closed } };
  }
  if (v['kind'] === 'parapet') {
    // Neu: flache Bindung { volumeId, merlon? }; Altbestand: feste Kopie flach oder in `spec` (cells + y)
    const wrapped = isObject(v['spec']);
    const legacy = wrapped ? v['spec'] : v;
    const spec = readFields(legacy as Record<string, unknown>, PARAPET);
    // Altbestand in `spec` **ohne** Zellen war schon früher unbrauchbar; ein flacher Bindungseintrag ohne Zellen ist
    // dagegen das neue Format (Spalten kommen aus der Hülle).
    if (wrapped && (spec.cells === undefined || spec.cells.length === 0)) return undefined;
    // Kein erfundener Baukörper: ohne `volumeId` bleibt der Eintrag ungebunden (feste Kopie aus cells/y)
    const volumeId = spec.volumeId;
    const cells = spec.cells;
    return {
      kind: 'parapet', id, ...(volumeId !== undefined ? { volumeId } : {}),
      ...(spec.merlon !== undefined ? { merlon: spec.merlon } : {}),
      ...(spec.crown !== undefined ? { crown: spec.crown } : {}),
      ...(spec.deck !== undefined ? { deck: spec.deck } : {}),
      ...(cells !== undefined && cells.length > 0 ? { cells } : {}),
      ...(spec.y !== undefined ? { y: spec.y } : {}),
    };
  }
  if (!isObject(v['spec'])) return undefined;
  const sp = v['spec'];
  if (v['kind'] === 'annex') {
    const spec = readFields(sp, ANNEX);
    return spec.center === undefined || spec.side === undefined ? undefined : { kind: 'annex', id, spec: { ...spec, center: spec.center, side: spec.side } };
  }
  if (v['kind'] === 'tower') {
    const spec = readFields(sp, TOWER);
    return spec.center === undefined ? undefined : { kind: 'tower', id, spec: { ...spec, center: spec.center } };
  }
  if (v['kind'] === 'windmill') {
    const spec = readFields(sp, WINDMILL);
    return spec.center === undefined ? undefined : { kind: 'windmill', id, spec: { ...spec, center: spec.center } };
  }
  if (v['kind'] === 'silo') {
    const spec = readFields(sp, SILO);
    return spec.center === undefined ? undefined : { kind: 'silo', id, spec: { ...spec, center: spec.center } };
  }
  return undefined;
}

/**
 * Vegetationsdichte älterer Dateien (App-Einstellung `surroundings.vegetation` { trees, bushes, flowers }, vor T2) als
 * Domain Event übernehmen: Die Dichte gehört jetzt dem Aggregat (`Site.setVegetation`), nur so gilt sie auch für
 * Undo, Export und jeden anderen Leser der Historie. Nur wenn sie vom Stil abweicht und die Historie noch keine hat.
 */
function migrateVegetation(site: Site, v: unknown): void {
  if (!isObject(v) || site.history.some((e) => e.type === 'VegetationChanged')) return;
  const factor = (x: unknown): number => (isFactor(x) ? x : 1);
  const density: VegetationDensity = { trees: factor(v['trees']), bushes: factor(v['bushes']), ground: factor(v['flowers']) };
  if (density.trees !== 1 || density.bushes !== 1 || density.ground !== 1) site.setVegetation(density);
}

/**
 * Umgebung aus einer Projektdatei lesen – tolerant: Fehlt sie (ältere Dateien), gibt es keine. Beschädigtes Gelände
 * oder unbekannte Bauwerke fallen mit Hinweis heraus, das Projekt lädt trotzdem. Die alte App-Einstellung
 * `vegetation` wird zum Domain Event (`migrateVegetation`).
 */
export function readSurroundings(v: unknown): { readonly state: SurroundingsState | undefined; readonly warnings: readonly string[] } {
  if (v === undefined || v === null) return { state: undefined, warnings: [] };
  if (!isObject(v)) return { state: undefined, warnings: ['Umgebung unlesbar – ohne Umgebung geladen'] };
  const warnings: string[] = [];
  let site: readonly SiteEvent[] | undefined;
  if (v['site'] !== undefined) {
    const raw = v['site'];
    try {
      if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isSiteEvent)) throw new Error('unbekannte Events');
      const agg = Site.fromHistory(raw);
      migrateVegetation(agg, v['vegetation']);
      const st = agg.state;
      void st.zones.map((z) => z.cells.size);
      site = agg.history.length === raw.length ? raw : [...agg.history];
      siteStates.set(site, st);
    } catch {
      warnings.push('Gelände beschädigt – ohne Gelände geladen');
    }
  }
  const structures: StructureItem[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of Array.isArray(v['structures']) ? v['structures'] : []) {
    const item = readItem(raw);
    if (item === undefined || seen.has(item.id)) dropped++;
    else {
      seen.add(item.id);
      structures.push(item);
    }
  }
  if (dropped > 0) warnings.push(`${dropped} Bauwerk${dropped === 1 ? '' : 'e'} unlesbar – ausgelassen`);
  const maxId = Math.max(0, ...structures.map((i) => Number(i.id.slice(1)) || 0));
  const seq = Math.max(intIn(v['seq'], 1, 1_000_000) ?? 1, maxId + 1);
  return {
    state: {
      ...(site !== undefined ? { site } : {}),
      terrain: site !== undefined && v['terrain'] !== false,
      margin: intIn(v['margin'], MARGIN_RANGE.min, MARGIN_RANGE.max) ?? MARGIN_RANGE.standard,
      structures,
      seq,
      ...(typeof v['ensemble'] === 'boolean' ? { ensemble: v['ensemble'] } : {}),
      ...(v['siteDecor'] === 'some' || v['siteDecor'] === 'rich' ? { siteDecor: v['siteDecor'] } : {}),
      ...(v['weathering'] === 'some' || v['weathering'] === 'rich' ? { weathering: v['weathering'] } : {}),
      ...(v['surfaceTexture'] === 'subtle' || v['surfaceTexture'] === 'rich' ? { surfaceTexture: v['surfaceTexture'] } : {}),
      ...(typeof v['landform'] === 'string' && v['landform'] !== 'flat' && (LANDFORMS as readonly string[]).includes(v['landform']) ? { landform: v['landform'] as Landform } : {}),
    },
    warnings,
  };
}


// ---------------------------------------------------------------------------------------------- Anwendungsdienst

/**
 * F-Ensemble: Schalter der Umgebung als Option von `generateBase` – `true` = an (`{}`), `false` = aus, fehlt =
 * Standard (`undefined`, dann gilt `ENSEMBLE_DEFAULT`). App und Engine lesen ihn gleich.
 */
export function ensembleOf(sur: SurroundingsState | undefined): EnsembleOptions | false | undefined {
  return sur?.ensemble === undefined ? undefined : sur.ensemble ? {} : false;
}

/** Wirkt der Verbindungsgraph für diese Umgebung (Schalter bzw. Standard, und es gibt etwas zu bauen)? */
export function ensembleActive(sur: SurroundingsState | undefined): boolean {
  if (!hasSurroundings(sur)) return false;
  const e = ensembleOf(sur);
  return e === false ? false : (e ?? ENSEMBLE_DEFAULT) !== undefined;
}

/** Angedockte Türme der Umgebung (C4) als Plan des Anwendungsdienstes (ID = Bauwerks-ID). */
export function attachedTowersOf(sur: SurroundingsState | undefined): readonly AttachedTower[] {
  return (sur?.structures ?? []).flatMap((i) => (i.kind === 'annex' ? [{ ...i.spec, id: i.id }] : []));
}

/**
 * Bauwerke als Eingabe des Kontexts Bauwerke (IDs werden zur Herkunft `fort:<id>`); angedockte Türme: `attachedTowersOf`.
 *
 * `deriveParapet` löst eine **an einen Baukörper gebundene** Wehrplatte in Spalten und Höhe auf (App/Engine reichen
 * `parapetSpecsFor(shell, [item])` durch). Fehlt der Resolver oder findet er keinen Baukörper, gilt der Altbestand
 * (`cells`/`y` aus der Datei) – so bleibt eine alte Datei lesbar und sichtbar, statt still zu verschwinden.
 */
export function structuresInput(
  sur: SurroundingsState,
  deriveParapet?: (item: Extract<StructureItem, { kind: 'parapet' }>) => ParapetSpec | undefined,
): StructuresInput | undefined {
  const walls: WallPlan[] = [];
  const towers: TowerSpec[] = [];
  const windmills: WindmillSpec[] = [];
  const silos: SiloSpec[] = [];
  const parapets: ParapetSpec[] = [];
  for (const item of sur.structures) {
    if (item.kind === 'wall') walls.push({ ...item.plan, id: item.id });
    else if (item.kind === 'tower') towers.push({ ...item.spec, id: item.id });
    else if (item.kind === 'windmill') windmills.push({ ...item.spec, id: item.id });
    else if (item.kind === 'silo') silos.push({ ...item.spec, id: item.id });
    else if (item.kind === 'parapet') {
      const derived = item.volumeId === undefined ? undefined : deriveParapet?.(item);
      if (derived !== undefined) parapets.push(derived);
      else if (item.cells !== undefined && item.y !== undefined) {
        // Altbestand ohne Bindung: genau die gespeicherten Zellen und die gespeicherte Höhe bauen
        parapets.push({
          id: item.id, ...(item.volumeId !== undefined ? { volumeId: item.volumeId } : {}), cells: item.cells, y: item.y, ...(item.merlon !== undefined ? { merlon: item.merlon } : {}),
          ...(item.crown !== undefined ? { crown: item.crown } : {}), ...(item.deck !== undefined ? { deck: item.deck } : {}),
        });
      }
    }
  }
  const n = walls.length + towers.length + windmills.length + silos.length + parapets.length;
  if (n === 0) return undefined;
  return {
    ...(walls.length > 0 ? { walls } : {}), ...(towers.length > 0 ? { towers } : {}),
    ...(windmills.length > 0 ? { windmills } : {}), ...(silos.length > 0 ? { silos } : {}), ...(parapets.length > 0 ? { parapets } : {}),
  };
}

const ID_PREFIX: Readonly<Record<StructureItem['kind'], string>> = { wall: 'w', tower: 't', windmill: 'm', annex: 'a', parapet: 'p', silo: 's' };

/**
 * Umkehrung von `structuresInput` + `attachedTowersOf`: Bauwerke des Anwendungsdienstes → Einträge mit IDs (vorhandene
 * `id` bleibt, sonst `w1`, `t2` …). Für Projekte, die nicht aus einer App-Datei stammen (Engine-Sessions).
 */
export function structureItemsOf(input: StructuresInput | undefined, attached: readonly AttachedTower[] = []): { readonly structures: readonly StructureItem[]; readonly seq: number } {
  const raw: Array<Omit<StructureItem, 'id'> & { readonly id?: string | undefined }> = [
    ...(input?.walls ?? []).map(({ id, ...plan }) => ({ kind: 'wall' as const, id, plan })),
    ...(input?.towers ?? []).map(({ id, ...spec }) => ({ kind: 'tower' as const, id, spec })),
    ...(input?.windmills ?? []).map(({ id, ...spec }) => ({ kind: 'windmill' as const, id, spec })),
    ...(input?.silos ?? []).map(({ id, ...spec }) => ({ kind: 'silo' as const, id, spec })),
    ...attached.map(({ id, ...spec }) => ({ kind: 'annex' as const, id, spec })),
    // Wehrplatten kommen als Baukörper-Bindung zurück (Zellen/Höhe leitet der Leser aus der Hülle ab)
    ...(input?.parapets ?? []).map(({ id, ...spec }): Omit<Extract<StructureItem, { kind: 'parapet' }>, 'id'> & { readonly id?: string } => {
      // Bindung bleibt Bindung; ein Spec ohne Baukörper (Altbestand/Engine-Sitzung) wird als feste Kopie geschrieben
      const { cells, y, volumeId, merlon, crown, deck } = spec;
      // Die Herkunfts-ID steuert auch das Aussehen der Ausguckkrone. Umbenennen verändert den Bau nach dem Laden.
      const look = { ...(id !== undefined ? { id } : {}), ...(crown !== undefined ? { crown } : {}), ...(deck !== undefined ? { deck } : {}) };
      return volumeId !== undefined
        ? { kind: 'parapet', volumeId, ...(merlon !== undefined ? { merlon } : {}), ...look }
        : { kind: 'parapet', cells, y, ...(merlon !== undefined ? { merlon } : {}), ...look };
    }),
  ];
  const used = new Set<string>();
  let seq = 1;
  const structures = raw.map((r) => {
    let id = r.id !== undefined && STRUCTURE_ID.test(r.id) && !used.has(r.id) ? r.id : undefined;
    while (id === undefined || used.has(id)) id = `${ID_PREFIX[r.kind]}${seq++}`;
    used.add(id);
    return { ...r, id } as StructureItem;
  });
  const maxId = Math.max(0, ...structures.map((i) => Number(i.id.slice(1)) || 0));
  return { structures, seq: Math.max(seq, maxId + 1) };
}
