/**
 * Gelände-Generator (rein, deterministisch): Site + Geländestil + Gebäude → ShellCell[] (kind terrain/plant).
 *
 * Ablauf:
 *  1. Klassen je Spalte: Gebäude, Planierring (pad), Außenbereiche (Stücke je Zone), Wiese.
 *  2. Höhen: fBm → Überblendung zum Planierring → Terraforming → Außenbereiche ebnen → Talus ≤ 1.
 *  3. Wege: Haustüren → Feldtore, Gartenwege, Hof, Teichufer, Grundstücksrand (Dijkstra, gebündelt).
 *  4. Außenbereiche anlegen: Feld (Ackerland, Wasser ≤ 4, Früchte, Zaun + Tor, Laternen), Garten, Hof, Teich.
 *  5. Vegetation: Bäume, Büsche (auch am Fundament), Blumen/Gras (Poisson-Disk), Uferpflanzen.
 *  6. Bodensäulen: Oberfläche, Erde, Stein; Fundament unter dem Gebäude lückenlos bis zur Bodenplatte.
 * Materialisiert wird über `buildWorld(project, ctx, shell, result.cells)` bzw. `generateBase` (Pipeline).
 *
 * Bauwerke (Kontext Bauwerke, optional `structures`): ihre Bodenspalten sind Sperrfläche – keine Außenbereiche,
 * keine Wege, keine Pflanzen, Bäume halten Abstand. Wege queren sie nur über die Durchgänge (Tore, Vortreppen).
 * Die Höhen bleiben natürlich; die Bauwerke folgen dem Gelände (Port `HeightField` = `top`).
 *
 * Gelände-Feinschliff (T2, research/18 §9–§13, research/16 U5/L3/V1–V6) – nur mit den neuen Optionen des Stils
 * (`paths.profile`, `fences`, `lighting`, `decor`), Zonenrändern, Beleuchtung am Grundstück oder den neuen Zonen
 * (Platz, Obstgarten, Koppel); ohne sie ist das Ergebnis bitgleich zum Stand davor (Test compat):
 *  - Anker vor der Wegführung: Brunnen (Hof/Platz, neben der Türachse), Platz-Ecklaternen, Obstbaum-Raster.
 *  - Wegrang: Hauptweg (Tür → Zufahrt in Türrichtung), Nebenwege, Pfade; Breite, Material, Rand, Grasnarbe,
 *    Rinne, Trittsteine je Rang.
 *  - Zonenringe mit Pfosten im Takt, Hecken, Toren (Z1/Z3/Z4); Koppel, Obstgarten, Platz.
 *  - Ausstattung (Beete, Kübel, Holzstapel, Fässer, Bienenstock, Vogelscheuche, Spalier, Hausbäume, Streudeko).
 *  - Beleuchtung (Laternenpfähle im Takt; spawnsicher gierig nachgesetzt, Licht im Laub).
 */
import type { ShellCell } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import { CellSet, HORIZONTAL, Rng, hash01, hashSeed, key3, valueNoise2, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import {
  LOOP_MIN_GAIN, LOOP_MIN_NEW, NO_BUILDING, NO_STRUCTURES, type BuildingDoor, type BuildingInfo, type SiteLinkEnd, type SiteLinkResult, type SiteStructures,
} from './building.js';
import { beehive, houseDecor, houseTrees, scatter, type DecorCount } from './decor.js';
import { buildRing, type RingOptions } from './fences.js';
import { C, ZONE_CLASS, type Emit, type Gen } from './gen.js';
import { DIR_OFFSET, N4, PlotGrid } from './grid.js';
import { blendFactor, enforceTalus, levelRange, naturalOffset } from './heightfield.js';
import { hillside, landformRelief, landformSpec, mossPatch, pondCells, type Landform } from './landform.js';
import { lightSite, type LightingReport, type SiteRoute } from './lighting.js';
import { NO_MOUND, bandLip, crownMound, frontGarden, hangEaves, moundField, placeEarthPortals, plantMound } from './mound.js';
import { auditPaths, type PathAudit } from './path-audit.js';
import { borderDist, buildStreetFence, facadeBands, planTreeGroups, type PlannedTree, type StreetFence } from './modules.js';
import { zoneEdge, type SiteState, type ZoneEdge, type ZoneKind } from './model.js';
import { route } from './paths.js';
import { ZONE_KITS, placeOutdoorProps, type OutdoorPlacement, type PropZone } from './props.js';
import { placeSiteDecor, type SiteDecorHint, type SiteDecorLevel } from './siteDecor.js';
import { CROP_ROLES, type TerrainRole } from './roles.js';
import { siteSeed } from './site.js';
import { fieldCrops, gardenPlan, mirrorCanon, pavingPattern, type GardenPlan, type TiledEntry, type TiledTerrain } from './tiled.js';
import { TREE_SPECIES, type TerrainStyleDef, type TreeSpecies } from './style.js';
import { bushCells, clusterSpots, growTree, poissonDisk } from './vegetation.js';
import { buildWell, doorAxis, layoutOrchard, layoutPaddock, layoutPlaza, planOrchard, planPlaza, reserveWell, square, wellSite } from './zones.js';

export interface FieldLayout {
  readonly zoneId: string;
  /** Y von Ackerland und Wasser. */
  readonly level: number;
  readonly farmland: readonly Cell[];
  readonly water: readonly Cell[];
  readonly crops: readonly { readonly cell: Cell; readonly role: string }[];
  readonly fence: readonly Cell[];
  readonly gate?: { readonly cell: Cell; readonly facing: HorizontalDir };
  /** Laternen auf Zaunpfosten. */
  readonly lights: readonly Vec3[];
  /** Z1-Stammpfosten im Zaunring (nur mit `fences.postEvery`). */
  readonly posts?: readonly Cell[];
  /** W4-A: schlanke Zaunpfosten (Zaun 2 hoch) der schlanken Zaunlinie (`fences.logEvery`); fehlt sonst. */
  readonly slimPosts?: readonly Cell[];
  /** Heckenzellen (Zonenrand 'hedge'). */
  readonly hedge?: readonly Cell[];
  /** Vogelscheuche (A6). */
  readonly scarecrow?: Cell;
}

/** Tor eines Zonenrings (Feld, Koppel, Garten, Obstgarten). */
export interface ZoneGate {
  readonly zoneId: string;
  readonly kind: ZoneKind;
  readonly cell: Cell;
  readonly facing: HorizontalDir;
}

/** Ausstattung und Beleuchtung des Gelände-Feinschliffs (T2); nur vorhanden, wenn eine neue Option wirkt. */
export interface SiteFeatures {
  /** Brunnenmitten (x, Wasserspiegel, z). */
  readonly wells: readonly Vec3[];
  /** Tore aller Zonenringe. */
  readonly gates: readonly ZoneGate[];
  /** Wege mit Rang (3 Haupt-, 2 Neben-, 1 Pfad) in Reihenfolge der Führung. */
  readonly routes: ReadonlyArray<{ readonly rank: number; readonly width: number; readonly cells: readonly Cell[] }>;
  readonly decor: DecorCount & { readonly scatter: number; readonly houseTrees: number };
  readonly lighting?: LightingReport;
}

export interface SiteResult {
  readonly cells: readonly ShellCell[];
  readonly grid: PlotGrid;
  /** Oberste Geländezelle je Spalte (Wasser: Wasserspiegel; Gebäude: Bodenplatte y0). */
  readonly top: Int32Array;
  /** Oberflächen-Rolle je Spalte (Gebäude: 'building'). */
  readonly surface: readonly string[];
  readonly bottom: number;
  readonly paths: CellSet;
  readonly doorExits: readonly Cell[];
  readonly fields: readonly FieldLayout[];
  readonly trees: readonly { readonly base: Vec3; readonly species: TreeSpecies }[];
  readonly bushes: number;
  readonly groundPlants: number;
  readonly warnings: readonly string[];
  /** Gelände-Feinschliff (T2); fehlt ohne neue Optionen. */
  readonly features?: SiteFeatures;
  /** Wege-Bericht (research/38 P1): Türen ohne Weg, Sackgassen, Inseln – ändert nichts, prüft nur. */
  readonly pathAudit: PathAudit;
  /**
   * Plan-Karte je Spalte (Index wie `grid.idx`): Zonen-ID (null = keine, auch unter dem Gebäude) und Wegrang
   * (0 kein Weg, 1 Pfad, 2 Nebenweg, 3 Hauptweg; ohne Wegprofil haben Wegzellen mindestens Rang 1).
   */
  readonly plan: { readonly zone: readonly (string | null)[]; readonly path: Uint8Array };
  /**
   * Katalog-Objekte der Außenzonen (Q3, `placeOutdoorProps`): Platzierungen für die Materialisierung. Fehlt der
   * Katalog (Optionsparameter), ist die Liste leer und das Gelände bitgleich zum Stand davor.
   */
  readonly outdoor: readonly OutdoorPlacement[];
  /** Additiv (F-Ensemble): je `SiteStructures.links` ein Ergebnis (`undefined` = kein Weg); fehlt ohne Zusatzwege. */
  readonly links?: readonly (SiteLinkResult | undefined)[];
  /** feat/tiled-wfc: Bericht je Muster (nur mit `SiteGenerateOptions.tiled`). */
  readonly tiled?: readonly TiledEntry[];
}

/** Zusatz-Eingaben des Gelände-Generators (additiv, Q3): ohne sie bleibt das Ergebnis bitgleich. */
export interface SiteGenerateOptions {
  /** Komponenten-Katalog für Gelände-Objekte (research/56 §4). Fehlt er, werden keine Objekte gesetzt. */
  readonly catalog?: Catalog | undefined;
  /** Zielversion als DataVersion für `Catalog.byTags` (`availableIn`); fehlt sie, wird nicht gefiltert. */
  readonly dataVersion?: number | undefined;
  /**
   * Feature-Schalter (feat/tiled-wfc, Standard aus): Pflaster für Platz und Hof, Beete im Garten und Feldbänder aus
   * dem Tiled-WFC (`tiled.ts`, Gewichte je Theme). Ohne Angabe bitgleich.
   */
  readonly tiled?: TiledTerrain | undefined;
  /**
   * Grundstücks-Deko (feat/site-decor, Standard aus): Beiwerk am Haus und am Weg (`siteDecor.ts`). Ohne Angabe oder mit
   * Stufe `off` bitgleich; braucht den Katalog.
   */
  readonly siteDecor?: { readonly level: SiteDecorLevel; readonly themeId?: string | undefined; readonly hints?: readonly SiteDecorHint[] | undefined } | undefined;
  /**
   * Geländeform (feat/gelaende): 'natural' und 'dramatic' formen Hang hinter dem Haus mit Stützmauer, kräftigeres Relief,
   * Teich, Findlinge, Moos am Sockel und dichtere Bepflanzung (`landform.ts`). Fehlt sie oder 'flat': bitgleich.
   */
  readonly landform?: Landform | undefined;
}

interface Part {
  readonly zoneId: string;
  readonly kind: ZoneKind;
  readonly cells: number[];
  readonly edge: ZoneEdge;
}

/** Querversatz der Wegzellen je Breite (0 = Mittellinie der Route). */
const LATERAL: Readonly<Record<number, readonly number[]>> = { 1: [], 2: [1], 3: [-1, 1], 4: [-1, 1, 2], 5: [-2, -1, 1, 2] };

const between = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Nicht feste Außen-Rollen (Vanilla `isSolid` = false): auf Trampelpfad/Ackerland erlaubt (M2). */
const NON_SOLID_ROLES: ReadonlySet<string> = new Set(['flower_wild', 'flower_warm', 'flower_cool', 'grass_tuft', 'ground_cover', 'pond_plant', ...CROP_ROLES]);

/** Darf Trampelpfad bzw. Ackerland unter dieser Zelle bleiben? (Zauntor ist die Vanilla-Ausnahme.) */
export function soilKeepsUnder(above: Pick<ShellCell, 'role' | 'shape'>): boolean {
  return NON_SOLID_ROLES.has(above.role) || above.shape === 'fence_gate';
}

export function generateSite(
  site: SiteState, style: TerrainStyleDef, building: BuildingInfo = NO_BUILDING, structures: SiteStructures = NO_STRUCTURES,
  options: SiteGenerateOptions = {},
): SiteResult {
  // Vegetationsdichte des Grundstücks (`Site.setVegetation`, Faktor 0 … 2): wirkt nach den Pässen des Stils – Boden seit
  // W4-D (`thinGround`/`addGround`), Bäume und Büsche seit W7-I (`thinTrees`/`thinBushes`/`addInOrder`), jeweils monoton
  const grid = new PlotGrid(site.plot);
  const n = grid.size;
  const seed = siteSeed(site);
  const y0 = building.y0;
  const padWidth = style.foundation?.pad ?? 1;
  const blend = style.foundation?.blend ?? 6;
  const soilDepth = style.soil?.depth ?? 3;
  const warnings: string[] = [];
  // feat/gelaende: Geländeform (Hang, Teich, Findlinge, Moos); ohne Form alles wie bisher
  const lf = landformSpec(options.landform);
  const relief = landformRelief(style.relief, lf);
  // T2-Optionen: fehlen alle, bleibt das Ergebnis bitgleich (Test compat)
  const prof = style.paths?.profile;
  const decor = style.decor ?? {};
  const lighting = site.lighting ?? style.lighting?.mode ?? 'none';
  const postEvery = style.fences?.postEvery;
  // W4-A schlanke Zaunlinie: Stammpfosten nur an Ecken, Enden und im großen Takt
  const logEvery = style.fences?.logEvery;
  const props = decor.props ?? 0;
  // feat/tiled-wfc: Muster aus dem Tiled-WFC (nur mit Schalter); Bericht je Zone
  const tiled = options.tiled;
  const tiledLog: TiledEntry[] = [];
  const logTiled = (e: TiledEntry): void => {
    tiledLog.push(e);
  };
  const gardenPlans = new Map<Part, GardenPlan>();
  /** Kanonische Spiegelzelle je Spalte (−1 = keine): Muster-Zellen wählen ihr Material dort (`ShellCell.pickAt`). */
  const pickAt = tiled === undefined ? undefined : new Int32Array(grid.size).fill(-1);
  const mirrorPick = (cells: readonly number[]): void => {
    if (pickAt !== undefined) mirrorCanon(grid, cells).forEach((c, i) => (pickAt[i] = c));
  };

  // ------------------------------------------------------------------ 1 Klassen
  const cls = new Uint8Array(n);
  const covered = new Uint8Array(n);
  const footIdx: number[] = [];
  let outsideFoot = 0;
  for (const [x, z] of building.footprint) {
    const i = grid.at(x, z);
    if (i < 0) outsideFoot++;
    else {
      cls[i] = C.building;
      footIdx.push(i);
    }
  }
  if (outsideFoot > 0) warnings.push(`Gebäude ragt mit ${outsideFoot} Spalten aus dem Grundstück`);
  for (const [x, z] of building.covered) {
    const i = grid.at(x, z);
    if (i >= 0) covered[i] = 1;
  }
  // Bauwerke: 1 = Sperrfläche, 2 = Durchgang (Weg erlaubt, keine Pflanzen)
  const struct = new Uint8Array(n);
  for (const [x, z] of structures.footprint) {
    const i = grid.at(x, z);
    if (i >= 0 && cls[i] !== C.building) struct[i] = 1;
  }
  for (const [x, z] of structures.passages ?? []) {
    const i = grid.at(x, z);
    if (i >= 0 && cls[i] !== C.building) struct[i] = 2;
  }
  const coreIdx = [...footIdx, ...[...covered.keys()].filter((i) => covered[i] === 1)];
  const padDist = grid.distance(coreIdx, 8);
  const footDist = grid.distance(footIdx, 8);
  for (let i = 0; i < n; i++) if (cls[i] !== C.building && padDist[i]! <= padWidth && coreIdx.length > 0) cls[i] = C.pad;
  // Lage buried (BT16, mound.ts): Hügel über eingegrabenen Baukörpern; seine Spalten neben dem Gebäude sind Klasse `mound`
  // (keine Zonen, Wege, Bäume; eigene Bepflanzung). Ohne Lage `buried` unverändert.
  const hill = moundField(grid, building, (i) => covered[i] === 1 || cls[i] === C.building, seed);
  // W13-C: Frontebene je eingegrabenem Baukörper (Vorwärtsrichtung und größte Vorwärts-Koordinate des Grundrisses)
  const buriedFronts = (building.buried ?? []).map((m) => {
    const [fx, fz] = DIR_OFFSET[m.front];
    let plane = -Infinity;
    for (const k of m.tops.keys()) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      plane = Math.max(plane, x * fx + z * fz);
    }
    return { fx, fz, plane };
  });
  const beforeFront = (i: number): boolean => buriedFronts.some((f) => grid.x(i) * f.fx + grid.z(i) * f.fz > f.plane);
  if (hill !== undefined) for (let i = 0; i < n; i++) if (cls[i] !== C.building && hill.top[i] !== NO_MOUND) cls[i] = C.mound;

  // Außenprofil (FA): Profilspalten sperren Pflanzen; vor dem Sockel liegt das Gelände eine Reihe tiefer (y0 − 1),
  // damit die Sockeltreppe sichtbar ist (research/18 F2) – als Traufstreifen (research/16 U5). Vor Außentüren
  // bleibt das Pad auf y0 (Podest). Ohne Profil ändert sich nichts.
  const profile = new Uint8Array(n);
  for (const [x, z] of building.profile ?? []) {
    const i = grid.at(x, z);
    if (i >= 0 && cls[i] !== C.building) profile[i] = 1;
  }
  const plinthCol = new Uint8Array(n);
  const plinthIdx: number[] = [];
  for (const [x, z] of building.plinth ?? []) {
    const i = grid.at(x, z);
    if (i >= 0 && cls[i] !== C.building) {
      plinthCol[i] = 1;
      plinthIdx.push(i);
    }
  }
  const exits: number[] = [];
  for (const d of building.doors) {
    const [dx, dz] = DIR_OFFSET[d.outward];
    const i = grid.at(d.cell[0] + dx, d.cell[1] + dz);
    if (i >= 0 && !exits.includes(i)) exits.push(i);
  }
  const lowered = new Uint8Array(n); // Sockelspalte oder Traufstreifen davor: Oberkante y0 − 1
  const landing = new Uint8Array(n); // Laufweg vor der Tür im Traufstreifen: auf y0, gepflastert wie der Streifen
  if (plinthIdx.length > 0) {
    const fromPlinth = grid.distance(plinthIdx, 8);
    // W3 (27.09.2026, Übergabe W3-EN): der ganze Laufweg vor jeder Außentür (3 breit, bis padWidth + 1 vor der Tür)
    // bleibt auf Höhe der Bodenplatte – sonst liegt vor der Stufe eine Mulde (Wachturm, Planierring 2)
    const approach = new Uint8Array(n);
    for (const d of building.doors) {
      const [dx, dz] = DIR_OFFSET[d.outward];
      // je Spur: vor einer Sockelspalte endet der Laufweg (die Sockeltreppe bleibt sichtbar)
      for (let k = -1; k <= 1; k++) {
        for (let s = 1; s <= padWidth + 1; s++) {
          const j = grid.at(d.cell[0] + dx * s - dz * k, d.cell[1] + dz * s + dx * k);
          if (j < 0 || plinthCol[j] === 1) break;
          approach[j] = 1;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (cls[i] !== C.pad || fromPlinth[i]! > padWidth || exits.includes(i)) continue;
      if (approach[i] === 0) lowered[i] = 1;
      else landing[i] = 1;
    }
  }

  // feat/gelaende: Rückseite des Hauses (dem Eingang gegenüber) – dort steigt der Hang, davor bleibt alles begehbar
  const back: readonly [number, number] = (() => {
    let sx = 0;
    let sz = 0;
    for (const d of building.doors) {
      sx += DIR_OFFSET[d.outward][0];
      sz += DIR_OFFSET[d.outward][1];
    }
    if (sx === 0 && sz === 0) {
      const o = building.doors[0] === undefined ? undefined : DIR_OFFSET[building.doors[0].outward];
      if (o === undefined) return [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(hash01(hashSeed(seed, 'landform-back'), 0, 0) * 4)] as [number, number];
      sx = o[0];
      sz = o[1];
    }
    return Math.abs(sx) >= Math.abs(sz) ? [-Math.sign(sx), 0] : [0, -Math.sign(sz)];
  })();
  const parts: Part[] = [];
  const zoneOf: (string | null)[] = new Array<string | null>(n).fill(null);
  for (const zone of site.zones) {
    const members = new Set<number>();
    let dropped = 0;
    for (const [x, z] of zone.cells) {
      const i = grid.at(x, z);
      if (i < 0) continue;
      if (cls[i] !== C.meadow || struct[i] !== 0 || (zone.kind === 'pond' && grid.onBorder(i))) dropped++;
      else members.add(i);
    }
    if (dropped > 0) warnings.push(`Zone ${zone.id} (${zone.kind}): ${dropped} Zellen am Gebäude/Bauwerk/Rand ausgelassen`);
    for (const comp of grid.components(members)) {
      for (const i of comp) {
        cls[i] = ZONE_CLASS[zone.kind];
        zoneOf[i] = zone.id;
      }
      parts.push({ zoneId: zone.id, kind: zone.kind, cells: comp, edge: zoneEdge(zone) });
    }
  }
  // feat/gelaende: Teich auf freier Wiese, abseits von Tür, Türachse und Hang (nur ohne eigenen Teich im Grundstück)
  if (lf !== undefined && lf.pond > 0 && coreIdx.length > 0 && !parts.some((p) => p.kind === 'pond')) {
    const exitFar = grid.distance(exits, 8);
    const c0 = (i: number): number => grid.x(i) * back[0] + grid.z(i) * back[1];
    const l0 = (i: number): number => grid.x(i) * Math.abs(back[1]) + grid.z(i) * Math.abs(back[0]);
    const doorAt = exits[0];
    const backEdge = Math.max(...footIdx.map(c0));
    const cells = pondCells(grid, hashSeed(seed, 'landform'), lf.pond, (i) => {
      if (cls[i] !== C.meadow || struct[i] !== 0 || padDist[i]! < padWidth + 5 || distToBorder(grid, i) < 3 || exitFar[i]! < 6) return false;
      if (site.sculpt.has(`${grid.x(i)},${grid.z(i)}`)) return false;
      // nicht auf die Türachse und nicht hinter das Haus
      if (doorAt !== undefined && Math.abs(l0(i) - l0(doorAt)) <= 3 && c0(i) < c0(doorAt)) return false;
      return c0(i) < backEdge - 1;
    }, (i) => -Math.abs(padDist[i]! - 9) * 0.12 - (c0(i) < c0(doorAt ?? footIdx[0]!) ? 0 : 0.6));
    if (cells.length > 0) {
      for (const i of cells) {
        cls[i] = C.pond;
        zoneOf[i] = 'landform:pond';
      }
      parts.push({ zoneId: 'landform:pond', kind: 'pond', cells, edge: 'none' });
    }
  }

  // ------------------------------------------------------------------ 2 Höhen
  const h = new Int32Array(n); // natürliches Gelände, zum Planierring übergeblendet
  const want = new Int32Array(n); // mit Terraforming
  const targets = new Map<number, number>();
  const pinned = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = grid.x(i);
    const z = grid.z(i);
    if (cls[i] === C.building || cls[i] === C.pad) {
      h[i] = lowered[i] === 1 ? y0 - 1 : y0;
      want[i] = h[i]!;
      pinned[i] = 1;
      continue;
    }
    const nat = naturalOffset(seed, x, z, relief);
    const f = coreIdx.length > 0 ? blendFactor(padDist[i]! - padWidth, blend) : 1;
    h[i] = y0 + Math.round(nat * f);
    want[i] = h[i]!;
    const s = site.sculpt.get(`${x},${z}`);
    if (s !== undefined) {
      want[i] = (s.level !== undefined ? y0 + s.level : h[i]!) + s.delta;
      targets.set(i, want[i]!);
    }
  }
  // T2 Glätten: Mittelwert der Wunschhöhen im Umkreis 2, danach Anheben/Senken der Zelle
  const smoothed: Array<[number, number]> = [];
  for (const [k, sc] of site.sculpt) {
    if (sc.smooth !== true) continue;
    const [x, z] = k.split(',').map(Number) as [number, number];
    const i = grid.at(x, z);
    if (i < 0 || pinned[i] === 1) continue;
    let sum = 0;
    let cnt = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const j = grid.at(x + dx, z + dz);
        if (j < 0) continue;
        sum += want[j]!;
        cnt++;
      }
    }
    smoothed.push([i, Math.round(sum / cnt) + (sc.level === undefined ? sc.delta : 0)]);
  }
  for (const [i, v] of smoothed) {
    want[i] = v;
    targets.set(i, v);
  }
  const levels = new Map<Part, number>();
  const ordered = [...parts.filter((p) => p.kind !== 'pond' && p.kind !== 'meadow' && p.kind !== 'path'), ...parts.filter((p) => p.kind === 'pond')];
  for (const p of ordered) {
    const vals = p.cells.map((i) => want[i]!);
    let target = p.kind === 'pond' ? Math.min(...vals) : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    const range = levelRange(grid, p.cells, h, pinned);
    if (range !== undefined) {
      if (range.lo <= range.hi) target = between(target, range.lo, range.hi);
      else {
        target = Math.round((range.lo + range.hi) / 2);
        warnings.push(`Zone ${p.zoneId}: keine Höhe passt zu allen Nachbarn (Talus) – Kompromiss ${target}`);
      }
    }
    const set = new Set(p.cells);
    const rim = p.kind === 'pond' ? [...new Set(p.cells.flatMap((i) => grid.n4(i)).filter((j) => !set.has(j)))] : [];
    if (p.kind === 'pond') {
      const low = Math.min(target, ...rim.filter((j) => pinned[j] === 1).map((j) => h[j]!));
      target = low;
    }
    for (const i of p.cells) {
      h[i] = target;
      pinned[i] = 1;
    }
    for (const j of rim) {
      if (pinned[j] === 1) continue;
      h[j] = target;
      pinned[j] = 1;
    }
    levels.set(p, target);
  }
  // Additiv (feat/underground): über einem Unterbau bleibt mindestens eine Geländelage auf der Decke (gepinnt, der
  // Talus gleicht ringsum an)
  for (const [k, y] of building.minTop ?? []) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    const i = grid.at(x, z);
    // auch schon hohe Spalten pinnen: sonst senkt die Talus-Glättung sie danach unter die Decke (Review A1)
    if (i < 0 || cls[i] === C.building) continue;
    h[i] = Math.max(h[i]!, y);
    pinned[i] = 1;
  }
  const talus = enforceTalus(grid, h, pinned, targets);
  const top = talus.heights;
  if (hill !== undefined) {
    const natural = Int32Array.from(top);
    for (let i = 0; i < n; i++) if (cls[i] === C.mound) top[i] = Math.max(top[i]!, hill.top[i]!);
    // W7-I: der Fuß des Hügels schließt an Gelände unter der Grundhöhe an (Relief-Mulde): dort sinkt er bis auf Talus 1,
    // nie unter das natürliche Gelände. Der Anschnitt an der Front (Vorplatz auf y0) bleibt, wie er ist.
    const sunk = new Uint8Array(n);
    const flanked = (building.buried ?? []).some((m) => m.wing > 0);
    // W13-C: neben dem Grundriss (bis zur Frontebene) deckt der Hügel die Seitenwand – dort sinkt er nicht
    const sideCover = new Uint8Array(n);
    if (flanked) {
      for (let i = 0; i < n; i++) {
        if (cls[i] === C.mound && grid.n4(i).some((j) => cls[j] === C.building) && !beforeFront(i)) sideCover[i] = 1;
      }
    }
    for (let changed = true; changed; ) {
      changed = false;
      for (let i = 0; i < n; i++) {
        if (cls[i] !== C.mound || sideCover[i] === 1) continue;
        let lim = Infinity;
        // W13-C (28.09.2026): der Traufstreifen vor der Front (y0 − 1) zieht die Flanken nicht herab – dort endet der
        // Hügel am Anschnitt (Stützmauer), statt neben der Front eine Rinne zu bilden (nur mit Flanken)
        for (const j of grid.n4(i)) if (cls[j] !== C.building && (top[j]! < y0 || sunk[j] === 1) && !(flanked && lowered[j] === 1)) lim = Math.min(lim, top[j]! + 1);
        const v = Math.max(natural[i]!, Math.min(top[i]!, lim));
        if (v >= top[i]!) continue;
        top[i] = v;
        sunk[i] = 1;
        changed = true;
      }
    }
  }
  // feat/gelaende: Hang hinter dem Haus mit Stützmauer (Höhensprung nur hier, Rest bleibt Talus ≤ 1)
  if (lf !== undefined && hill === undefined && coreIdx.length > 0) {
    const exitNear = grid.distance(exits, 8);
    const free = new Uint8Array(n);
    const houseCols = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (cls[i] === C.building) houseCols[i] = 1;
      else if (cls[i] === C.pad) houseCols[i] = 2;
      else if (cls[i] === C.meadow && struct[i] === 0 && profile[i] === 0 && exitNear[i]! >= 5 && !site.sculpt.has(`${grid.x(i)},${grid.z(i)}`)
        && !(building.minTop?.has(`${grid.x(i)},${grid.z(i)}`) ?? false)) free[i] = 1;
    }
    top.set(hillside({ grid, seed, spec: lf, y0, top, free, house: houseCols, foot: coreIdx, padWidth, back }).top);
  }
  if (talus.conflicts > 0) warnings.push(`Talus: ${talus.conflicts} gepinnte Spalten mit Höhensprung > 1 (Terraforming zu steil)`);

  // ------------------------------------------------------------------ Hilfsstrukturen
  const surface: string[] = new Array<string>(n).fill('ground_grass');
  for (const i of footIdx) surface[i] = 'building';
  // unter der Sockeltreppe Erde (Gras würde unter ihr zu Erde), davor der Traufstreifen (Hofpflaster)
  for (let i = 0; i < n; i++) if (lowered[i] === 1) surface[i] = plinthCol[i] === 1 ? 'ground_dirt' : 'ground_yard';
  for (let i = 0; i < n; i++) if (landing[i] === 1) surface[i] = 'ground_yard';
  // Außenprofil direkt auf dem Gelände (Rundtür-/Rundfensterrahmen, BT16): darunter Erde – Gras würde unter dem Block zu Erde
  for (let i = 0; i < n; i++) {
    if (profile[i] === 1 && surface[i] === 'ground_grass' && building.occupied.has(key3([grid.x(i), top[i]! + 1, grid.z(i)]))) surface[i] = 'ground_dirt';
  }
  const water = new Uint8Array(n);
  const bed: string[] = new Array<string>(n).fill('ground_dirt');
  const path = new Uint8Array(n);
  const blocked = new Uint8Array(n); // Laternenpfosten, Stämme, Büsche: kein Weg, keine Pflanze
  const out = new Map<string, ShellCell>();
  const emit: Emit = (pos, kind, role, shape, orient) => {
    const k = key3(pos);
    if (out.has(k) || building.occupied.has(k)) return false;
    out.set(k, { pos, kind, role, shape, ...(orient !== undefined ? { orient } : {}) });
    return true;
  };
  const doorDist = grid.distance(exits, 8);
  const onRoute = new Uint8Array(n); // T2: Zellen auf einer Route (auch Hof, Platz, Obstgarten)
  const plantCol = new Uint8Array(n); // Spalte hat schon eine Pflanze auf dem Boden
  const ring = new Uint8Array(n); // T2: Zaun-/Heckenring
  const propCol = new Uint8Array(n); // Q3: Spalte trägt ein Katalog-Objekt
  const propCells = new Map<string, { op: 0 | 1 | 2; light: number }>(); // Q3: Zellen für den Licht-Pass
  const gen: Gen = {
    grid, seed, style, building, cls, covered, struct, profile, lowered, padDist, footDist, doorDist, padWidth, exits, top, surface, water, bed, path,
    route: onRoute, blocked, plantCol, ring, propCol, propCells, out, emit, warnings,
  };
  // W7-I Erdhaus-Portal (Lage buried): Türblatt und Laternen an der Rundtür, vor der Wegführung (die Spalten sind gesperrt)
  const portals = hill !== undefined && options.catalog !== undefined ? placeEarthPortals(gen, options.catalog, options.dataVersion) : [];
  // W12-B: Laub über der Traufe (nur mit Flanken; nach dem Portal, dessen Laternen auf derselben Reihe stehen)
  // W16-C: Grasnarbe über dem Bogenband der Front (nur mit Flanken)
  const lip = hill !== undefined ? bandLip(grid, building, hill, (j) => (cls[j] === C.mound ? top[j]! : undefined)) : new Map<number, never>();
  if (hill !== undefined) hangEaves(gen, lip);
  // W16-C: Schornstein und Baum auf dem Hügel (nur mit Flanken), vor der Bepflanzung
  if (hill !== undefined) portals.push(...crownMound(gen, hill, options.catalog, options.dataVersion));

  // ------------------------------------------------------------------ 3 Wege (Ziele je Außenbereich)
  const fieldGeo = new Map<Part, FieldGeometry>();
  const gardenPaths = new Map<Part, Set<number>>();
  const extraWalk = new Uint8Array(n); // T2: Platz und offener Obstgarten sind begehbar
  const walkable = (i: number): boolean => (cls[i] === C.meadow || cls[i] === C.pad || cls[i] === C.yard || cls[i] === C.meadowZone || extraWalk[i] === 1)
    && blocked[i] === 0 && struct[i] !== 1
    && plinthCol[i] === 0; // über die Sockeltreppe führt kein Weg (Profil sonst frei für Wege)
  // T2: Ringe (Koppel, Garten/Obstgarten mit Rand), Brunnen, Platz, Obstbäume – vor der Wegführung reserviert
  const enclosed = new Map<Part, FieldGeometry>();
  const wells = new Map<Part, number>();
  const plazas = new Map<Part, ReturnType<typeof planPlaza>>();
  const trunks = new Map<Part, number[]>();
  for (const p of parts) if (p.kind === 'plaza' || p.kind === 'path' || (p.kind === 'orchard' && p.edge === 'none')) for (const i of p.cells) extraWalk[i] = 1;
  const axis = decor.well !== undefined ? doorAxis(gen) : undefined;
  for (const p of parts) {
    if (p.kind === 'field') fieldGeo.set(p, fieldGeometry(grid, p.cells, walkable, p.edge !== 'none'));
    if (p.kind === 'garden') {
      const geo = p.edge !== 'none' ? fieldGeometry(grid, p.cells, walkable, true) : undefined;
      if (geo !== undefined) enclosed.set(p, geo);
      const gp = tiled === undefined ? undefined : gardenPlan(grid, geo?.interior ?? p.cells, p.zoneId, seed, tiled.themeId, logTiled);
      if (gp !== undefined) {
        gardenPlans.set(p, gp);
        mirrorPick(geo?.interior ?? p.cells);
      }
      gardenPaths.set(p, gp?.paths !== undefined ? new Set(gp.paths) : gardenPathCells(grid, geo?.interior ?? p.cells));
    }
    if (p.kind === 'paddock' || (p.kind === 'orchard' && p.edge !== 'none')) enclosed.set(p, fieldGeometry(grid, p.cells, walkable, true));
    if (p.kind === 'orchard') trunks.set(p, planOrchard(gen, enclosed.get(p)?.interior ?? p.cells, style.vegetation?.orchard?.spacing ?? 5));
    if (p.kind === 'plaza') plazas.set(p, planPlaza(gen, p.cells, decor.kits === true));
    if (p.kind === 'yard') {
      const w = decor.well !== undefined ? wellSite(gen, p.cells, axis) : undefined;
      if (w !== undefined) {
        reserveWell(gen, w);
        wells.set(p, w);
      } else yardLamp(grid, p.cells, blocked);
    }
  }
  const targetsOf = (p: Part): Set<number> => {
    switch (p.kind) {
      case 'field': return new Set(fieldGeo.get(p)!.gates.keys());
      case 'garden': {
        const geo = enclosed.get(p);
        if (geo !== undefined) return new Set(geo.gates.keys());
        const gp = gardenPaths.get(p)!;
        return gp.size > 0 ? gp : new Set(p.cells);
      }
      case 'yard': return new Set(p.cells.filter((i) => blocked[i] === 0));
      case 'pond': {
        const set = new Set(p.cells);
        return new Set(p.cells.flatMap((i) => grid.n4(i)).filter((j) => !set.has(j) && walkable(j)));
      }
      case 'meadow': return new Set();
      case 'plaza': return new Set(p.cells.filter((i) => blocked[i] === 0));
      case 'orchard': {
        const geo = enclosed.get(p);
        return geo !== undefined ? new Set(geo.gates.keys()) : new Set(p.cells.filter((i) => blocked[i] === 0));
      }
      case 'paddock': return new Set(enclosed.get(p)!.gates.keys());
      case 'path': return new Set(p.cells.filter((i) => blocked[i] === 0));
    }
  };
  /** Gemalter Weg (Zone `path`): alle Zellen werden Weg (Nebenweg), sobald er angeschlossen ist. */
  const paintPath = (p: Part): void => {
    for (const i of p.cells) {
      if (blocked[i] === 1) continue;
      path[i] = 1;
      onRoute[i] = 1;
      rank[i] = Math.max(rank[i]!, 2);
    }
  };
  const costs = { passable: walkable, heights: top, onPath: (i: number) => path[i] === 1 };
  const markPath = (cells: readonly number[]): void => {
    for (const i of cells) if (cls[i] === C.meadow || cls[i] === C.pad || cls[i] === C.meadowZone) path[i] = 1;
  };
  // T2: Wegrang (3 Haupt-, 2 Neben-, 1 Pfad) mit Breite laut Profil
  const rank = new Uint8Array(n);
  const routes: SiteRoute[] = [];
  const widthOf = (rk: number): number => (prof === undefined ? style.paths?.width ?? 1 : rk === 3 ? prof.main ?? 3 : rk === 2 ? prof.side ?? 2 : 1);
  const layRoute = (r: readonly number[], rk: number, width = widthOf(rk)): void => {
    for (const i of r) onRoute[i] = 1;
    routes.push({ cells: r, rank: rk, width });
    const mark = (i: number): void => {
      if (path[i] === 1) rank[i] = Math.max(rank[i]!, rk);
    };
    r.forEach(mark);
    if (prof === undefined) return;
    const ok = (i: number): boolean => walkable(i) && cls[i] !== C.yard && extraWalk[i] === 0;
    const offs = LATERAL[width] ?? [];
    for (let k = 1; k < r.length; k++) {
      const a = r[k - 1]!;
      const b = r[k]!;
      const dx = grid.x(b) - grid.x(a);
      const dz = grid.z(b) - grid.z(a);
      for (const c of [a, b]) {
        for (const o of offs) {
          const j = grid.at(grid.x(c) - dz * o, grid.z(c) + dx * o);
          if (j >= 0 && ok(j)) {
            path[j] = 1;
            mark(j);
          }
        }
      }
    }
  };
  const routeEnds = new Map<Part, number>();
  const network = (): number[] => [...exits, ...[...path.keys()].filter((i) => path[i] === 1)];
  const distToDoor = (p: Part): number => Math.min(...[...targetsOf(p)].map((i) => doorDist[i]!), Infinity);
  const routed = parts.filter((p) => p.kind !== 'meadow').sort((a, b) => distToDoor(a) - distToDoor(b) || a.cells[0]! - b.cells[0]!);
  const pathWidth = style.paths?.width ?? 1;
  for (const p of routed) {
    const targets = targetsOf(p);
    if (targets.size === 0) {
      if (p.kind === 'field') warnings.push(`Feld ${p.zoneId}: kein Platz für ein Tor`);
      continue;
    }
    if (exits.length === 0) continue;
    const r = route(grid, network(), targets, costs);
    if (p.kind === 'path') paintPath(p);
    if (r === undefined) {
      warnings.push(`Zone ${p.zoneId} (${p.kind}): kein Weg von der Haustür`);
      continue;
    }
    routeEnds.set(p, r[r.length - 1]!);
    markPath(r);
    if (p.kind === 'garden') path[r[r.length - 1]!] = 1;
    if (prof === undefined && pathWidth > 1) widen(grid, r, (i) => walkable(i) && cls[i] !== C.yard, path);
    layRoute(r, p.kind === 'pond' || p.kind === 'orchard' ? 1 : 2);
  }
  for (const p of parts) if (p.kind === 'path') paintPath(p); // auch ohne Anschluss (ohne Haustür) bleibt es Weg
  // Zufahrt: Haupttür → Grundstücksrand (mit Wegprofil: von der Haupttür in Türrichtung, research/18 S1 Regel 7)
  let mainRoute: { readonly cells: readonly number[]; readonly side: HorizontalDir } | undefined;
  if (exits.length > 0) {
    const border = new Set([...Array(n).keys()].filter((i) => grid.onBorder(i) && walkable(i) && cls[i] !== C.yard));
    const first = building.doors.find((d) => d.outward === 'south') ?? building.doors[0]!;
    // W4-C Doppeltür: der Weg beginnt am Flügel, dessen Partner quer zur Laufrichtung auf der Seite +1 liegt – so deckt
    // ein gerade breiter Weg (Profil 2, bei Doppeltür 4 statt 3) beide Flügel spiegelgleich
    const [fx, fz] = DIR_OFFSET[first.outward];
    const partnerAt = (d: BuildingDoor, s: number): BuildingDoor | undefined =>
      building.doors.find((o) => o.outward === d.outward && o.cell[0] === d.cell[0] - fz * s && o.cell[1] === d.cell[1] + fx * s);
    const main = partnerAt(first, 1) !== undefined ? first : partnerAt(first, -1) ?? first;
    const double = partnerAt(main, 1) !== undefined;
    const mainExit = grid.at(main.cell[0] + DIR_OFFSET[main.outward][0], main.cell[1] + DIR_OFFSET[main.outward][1]);
    const ahead = new Set([...border].filter((i) => onSide(grid, i, main.outward)));
    const r = prof === undefined || mainExit < 0 ? route(grid, [exits[0]!, ...network()], border, costs) : route(grid, [mainExit], ahead.size > 0 ? ahead : border, costs);
    if (r !== undefined) {
      markPath(r);
      if (prof === undefined && pathWidth > 1) widen(grid, r, (i) => walkable(i) && cls[i] !== C.yard, path);
      const w = widthOf(3);
      layRoute(r, 3, double && w % 2 === 1 && LATERAL[w + 1] !== undefined ? w + 1 : w);
      mainRoute = { cells: r, side: main.outward };
    }
  }
  // F-Ensemble: Zusatzwege des Verbindungsgraphen (Anschlüsse bündeln, Rundwege nicht) – nach Zonen- und Hauptweg,
  // ohne `links` entfällt der Schritt (bitgleich)
  const linkResults: (SiteLinkResult | undefined)[] | undefined = structures.links === undefined ? undefined : [];
  /** Schritte über das vorhandene Wegnetz von `from` zu einem Ziel (Breitensuche), Infinity ohne Verbindung. */
  const networkSteps = (from: readonly number[], to: ReadonlySet<number>): number => {
    const dist = new Map<number, number>(from.map((i) => [i, 0]));
    const queue = [...from];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!;
      if (to.has(i)) return dist.get(i)!;
      for (const j of grid.n4(i)) {
        if (dist.has(j) || !(path[j] === 1 || to.has(j) || exits.includes(j))) continue;
        dist.set(j, dist.get(i)! + 1);
        queue.push(j);
      }
    }
    return Infinity;
  };
  let loopsLeft = structures.maxLoops ?? Infinity;
  for (const link of structures.links ?? []) {
    const endOf = (e: SiteLinkEnd): number[] => {
      if ('zoneId' in e) {
        const p = parts.find((q) => q.zoneId === e.zoneId);
        return p === undefined ? [] : [...targetsOf(p)].sort((a, b) => a - b);
      }
      return [...new Set(e.cells.map(([x, z]) => grid.at(x, z)).filter((i) => i >= 0))].sort((a, b) => a - b);
    };
    const from = endOf(link.from);
    const to = new Set(endOf(link.to));
    const r = from.length === 0 || to.size === 0 ? undefined : route(grid, from, to, link.loop === true ? { ...costs, onPath: () => false } : costs);
    if (r === undefined) {
      linkResults!.push(undefined);
      continue;
    }
    const before = r.filter((i) => path[i] === 1).length;
    if (link.loop === true && (loopsLeft <= 0 || r.length - before < LOOP_MIN_NEW || networkSteps(from, to) < LOOP_MIN_GAIN * r.length)) {
      linkResults!.push({ cells: r.map((i) => grid.cell(i)), added: 0, skipped: true });
      continue;
    }
    if (link.loop === true) loopsLeft--;
    markPath(r);
    if (prof === undefined && pathWidth > 1) widen(grid, r, (i) => walkable(i) && cls[i] !== C.yard, path);
    layRoute(r, link.rank ?? 1);
    linkResults!.push({ cells: r.map((i) => grid.cell(i)), added: r.filter((i) => path[i] === 1).length - before });
  }
  // W3 (27.09.2026): Verbreiterungs-Stummel entfernen – eine Seitenzelle eines breiten Wegs (nicht auf der Mittellinie),
  // die nur einen Weg-Nachbarn hat, entsteht, wo der Nachbarstreifen am Sockel/Haus endet; sie wäre eine Sackgasse
  if (prof !== undefined) {
    for (let i = 0; i < n; i++) {
      if (path[i] !== 1 || onRoute[i] === 1 || exits.includes(i)) continue;
      if (grid.n4(i).filter((j) => path[j] === 1).length <= 1) {
        path[i] = 0;
        rank[i] = 0;
      }
    }
  }
  for (const i of exits) if (cls[i] === C.pad || cls[i] === C.meadow) path[i] = 1;
  // W3-GA Straßenzaun: Zaun an der Straßenseite, Tor über dem Hauptweg (nicht hinter einer Mauer mit Tordurchgang: Burg)
  const street: StreetFence | undefined = style.fences?.street === true && mainRoute !== undefined && (structures.passages?.isEmpty ?? true)
    ? buildStreetFence(gen, mainRoute.cells, mainRoute.side, postEvery ?? 4, {
      ...(logEvery !== undefined ? { logEvery } : {}), ...(style.fences?.streetSpan !== undefined ? { span: style.fences.streetSpan } : {}),
    }) : undefined;

  /** T2: Tor eines Rings am Ende der Route (sonst nächst der Haustür) und die Innenzelle dahinter. */
  const chooseGate = (p: Part, geo: FieldGeometry): { gate: number; facing: HorizontalDir; entry: number } | undefined => {
    const end = routeEnds.get(p);
    const key = end !== undefined && geo.gates.has(end) ? end : nearestGate(geo, doorDist);
    const info = key !== undefined ? geo.gates.get(key) : undefined;
    if (info === undefined || info.gate < 0) return undefined;
    const [dx, dz] = DIR_OFFSET[info.facing];
    return { ...info, entry: grid.idx(grid.x(info.gate) - dx, grid.z(info.gate) - dz) };
  };

  // ------------------------------------------------------- 3a Baumgruppen planen (W3-GA, Modul „Baumgruppe“)
  // Vor den Katalog-Objekten: die Stämme sind reserviert (Findlinge am Gehölz beziehen sich auf sie), gewachsen wird
  // erst in Schritt 5. Ohne `trees.groups` entfällt der Schritt (bitgleich).
  const groupOpts = style.vegetation?.trees?.groups;
  // Sichtfelder: 1 = vor einer Fassade (frei von Gehölz und Findlingen), 2 = hinter dem Haus, 0 = an den Ecken
  const front = groupOpts !== undefined || style.landscape?.near !== undefined ? facadeBands(gen, 4, groupOpts?.sight) : undefined;
  let planned: PlannedTree[] = [];
  if (groupOpts !== undefined && (style.vegetation?.trees?.density ?? 0) > 0) {
    const t = style.vegetation!.trees!;
    const busy: number[] = [];
    for (let i = 0; i < n; i++) {
      if (cls[i] !== C.meadow || path[i] === 1 || onRoute[i] === 1 || blocked[i] === 1 || struct[i] !== 0 || profile[i] === 1 || lowered[i] === 1) busy.push(i);
    }
    const room = grid.distance(busy, 8);
    planned = planTreeGroups(gen, {
      size: groupOpts.size ?? [2, 3], every: groupOpts.every ?? 40, rim: groupOpts.rim ?? [2, 6], spacing: Math.min(t.spacing, 6), species: t.species,
      ...(groupOpts.max !== undefined ? { max: groupOpts.max } : {}),
    }, (i) => room[i]! >= 3 && padDist[i]! >= padWidth + 3 && front![i] !== 1);
    for (const tr of planned) blocked[tr.cell] = 1;
  }

  // ------------------------------------------------------- 3b Katalog-Objekte in den Außenzonen (Q3, research/56 §4)
  // Nach der Wegführung (Wege bleiben frei) und vor dem Anlegen der Außenbereiche (Ackerland, Beete, Obstbäume
  // und Vegetation lassen die gesperrten Spalten aus). Ohne Katalog kostet das nichts und ändert nichts.
  const propZones: PropZone[] = [];
  for (const p of parts) {
    const geo = fieldGeo.get(p) ?? enclosed.get(p);
    const keep = new Set<number>();
    // Zaun-/Heckenring mit Pfosten und Tor sowie die Tordurchfahrt bleiben frei (kein zugebautes Tor).
    if (geo !== undefined) {
      for (const r of geo.ring) keep.add(r);
      const gt = chooseGate(p, geo);
      if (gt !== undefined) keep.add(gt.entry);
    }
    // Gartenwege sind schon bekannt (sie werden in Schritt 4 nur noch gemalt).
    for (const i of gardenPaths.get(p) ?? []) keep.add(i);
    // Kronen bereits reservierter Bäume (Obstgarten, Platzbaum) reichen 2 Zellen über den Stamm hinaus: dort
    // bleibt das Gelände frei, sonst überlappen KronenZellen und Katalog-Objekt beim Materialisieren.
    for (const t of trunks.get(p) ?? []) for (const j of square(gen, t, 2)) keep.add(j);
    const plaza = plazas.get(p);
    if (plaza !== undefined) {
      for (const i of [...plaza.lamps, ...(plaza.tree !== undefined ? [plaza.tree] : []), ...(plaza.well !== undefined ? [plaza.well] : [])]) {
        for (const j of square(gen, i, 2)) keep.add(j);
      }
    }
    propZones.push({
      zoneId: p.zoneId, kind: p.kind, cells: p.cells, keepOut: [...keep],
      // W3-GA: feste Zonen-Module (Hofecke, Gartenecke, Bank am Platz …) statt Dichte
      ...(decor.kits === true ? { kit: ZONE_KITS[p.kind] } : {}),
      // Teich: Uferstücke, Steg und Findling stehen am **Landrand**; auf dem Wasser würde Sand fallen bzw.
      // Stein schweben (X1), deshalb bleibt die Wasserfläche frei.
      ...(p.kind === 'pond' ? { only: ['outdoor/pond_edge', 'outdoor/rock_small', 'outdoor/dock', 'outdoor/footbridge', 'outdoor/rock_medium'], prefer: ['pond_edge'] } : {}),
    });
  }
  // Freie Landschaft (ungezonte Wiese, Q3 Stufe D): der Stil bestimmt Pool und Dichte – der Hebel, mit dem sich
  // die fünf Geländestile in Fels/Baum/Blume unterscheiden. Objekte hier gehören zu keiner Zone (nicht in L2).
  const landscape = style.landscape;
  if (landscape !== undefined && landscape.density > 0) {
    const meadowCells: number[] = [];
    // W3-GA: nur in Bezug – am Gehölz (außerhalb der Krone) bzw. am Grundstücksrand, nie im Vorderband
    const near = landscape.near;
    const byTree = near?.anchors.includes('trees') === true && planned.length > 0
      ? grid.distance(planned.map((tr) => tr.cell), 8) : undefined;
    const related = (i: number): boolean => near === undefined || (front![i] !== 1
      && ((byTree !== undefined && byTree[i]! >= 3 && byTree[i]! <= 2 + near.distance) || (near.anchors.includes('rim') && borderDist(gen, i) < near.distance)));
    for (let i = 0; i < n; i++) if (cls[i] === C.meadow && related(i)) meadowCells.push(i);
    if (meadowCells.length > 0) {
      propZones.push({
        zoneId: 'q3:landschaft',
        kind: 'meadow',
        cells: meadowCells,
        direct: true,
        factor: landscape.density,
        ...(landscape.tags !== undefined ? { tags: landscape.tags } : {}),
        ...(landscape.only !== undefined ? { only: landscape.only } : {}),
        ...(landscape.prefer !== undefined ? { prefer: landscape.prefer } : {}),
      });
    }
  }
  const outdoorBase = options.catalog === undefined
    ? []
    : portals.length > 0 ? [...portals, ...placeOutdoorProps(gen, propZones, { catalog: options.catalog, ...(options.dataVersion !== undefined ? { dataVersion: options.dataVersion } : {}) })] : placeOutdoorProps(gen, propZones, { catalog: options.catalog, ...(options.dataVersion !== undefined ? { dataVersion: options.dataVersion } : {}) });
  // feat/site-decor: Beiwerk nach den Zonen-Objekten (die haben Vorrang); ohne Schalter kein Aufruf, bitgleich
  const sd = options.siteDecor;
  const outdoor = options.catalog === undefined || sd === undefined || sd.level === 'off'
    ? outdoorBase
    : [...outdoorBase, ...placeSiteDecor(gen, {
      level: sd.level, catalog: options.catalog, dataVersion: options.dataVersion, themeId: sd.themeId, hints: sd.hints,
      existing: outdoorBase, ponds: propZones.filter((z) => z.kind === 'pond'),
    })];

  // ------------------------------------------------------------------ 4 Außenbereiche
  const fields: FieldLayout[] = [];
  const sky = (i: number): boolean => covered[i] === 0;
  const gates: ZoneGate[] = [];
  const wellsAt: Vec3[] = [];
  const zoneTrees: { base: Vec3; species: TreeSpecies }[] = [];
  const gateOf = (p: Part, geo: FieldGeometry): { gate: number; facing: HorizontalDir; entry: number } | undefined => {
    const gt = chooseGate(p, geo);
    if (gt !== undefined) gates.push({ zoneId: p.zoneId, kind: p.kind, cell: grid.cell(gt.gate), facing: gt.facing });
    return gt;
  };
  const openEntry = (e: number | undefined): void => {
    if (e === undefined) return;
    surface[e] = 'ground_path';
    path[e] = 1;
  };
  const ringOpts = (p: Part, extra: Partial<RingOptions> = {}): RingOptions => ({
    edge: p.edge === 'hedge' ? 'hedge' : 'fence', ...(postEvery !== undefined ? { postEvery } : {}), lanterns: true,
    ...(style.fences?.lanterns === 'gate' ? { lanternsAt: 'gate' as const } : {}), ...(logEvery !== undefined ? { logEvery } : {}), ...extra,
  });
  for (const p of parts) {
    const level = levels.get(p) ?? top[p.cells[0]!]!;
    const rng = new Rng(hashSeed(seed, 'zone', p.zoneId, p.cells[0]!));
    switch (p.kind) {
      case 'field': {
        const geo = fieldGeo.get(p)!;
        const end = routeEnds.get(p);
        const gateKey = end !== undefined && geo.gates.has(end) ? end : nearestGate(geo, doorDist);
        const fine = p.edge !== 'fence' || postEvery !== undefined || props > 0;
        const f = layoutField(grid, p, geo, gateKey, level, rng, { surface, water, path, blocked, emit, sky, warnings, gateLanterns: style.fences?.lanterns === 'gate' },
          fine ? { g: gen, ring: ringOpts(p), scarecrow: props } : undefined, tiled === undefined ? undefined : (nb) => fieldCrops(nb, p.zoneId, seed, logTiled));
        fields.push(f);
        if (f.gate !== undefined) gates.push({ zoneId: p.zoneId, kind: p.kind, cell: f.gate.cell, facing: f.gate.facing });
        break;
      }
      case 'garden': {
        const geo = enclosed.get(p);
        if (geo === undefined) {
          layoutGarden(grid, p, gardenPaths.get(p)!, level, rng, { surface, path, blocked, emit }, decor.kits === true, false, gardenPlans.get(p));
          break;
        }
        const gt = gateOf(p, geo);
        const inner = geo.interior.filter((i) => i !== gt?.entry);
        layoutGarden(grid, { ...p, cells: inner.length > 0 ? inner : [...geo.interior] }, gardenPaths.get(p)!, level, rng, { surface, path, blocked, emit }, decor.kits === true, true, gardenPlans.get(p));
        openEntry(gt?.entry);
        buildRing(gen, geo.ring, gt, level, ringOpts(p, { lanterns: false, arch: p.edge === 'hedge', tall: true }), p.zoneId);
        break;
      }
      case 'paddock': {
        const geo = enclosed.get(p)!;
        const gt = gateOf(p, geo);
        layoutPaddock(gen, geo.interior, gt?.entry ?? -1, level, p.zoneId);
        openEntry(gt?.entry);
        buildRing(gen, geo.ring, gt, level, ringOpts(p, { postEvery: postEvery ?? 4 }), p.zoneId);
        break;
      }
      case 'orchard': {
        for (const base of layoutOrchard(gen, trunks.get(p)!, level)) zoneTrees.push({ base, species: 'oak' });
        const geo = enclosed.get(p);
        if (geo !== undefined) {
          const gt = gateOf(p, geo);
          openEntry(gt?.entry);
          buildRing(gen, geo.ring, gt, level, ringOpts(p, { lanterns: false }), p.zoneId);
        }
        break;
      }
      case 'plaza': {
        const planned0 = plazas.get(p)!;
        // W4-A Vorgartenzaun: die Torlaternen übernehmen das Licht am Platzeingang – ein Eckpfahl des Platzes im
        // Umkreis 3 einer Torlaterne entfällt (vorher vier Laternen auf 4 × 3 Feldern)
        const gateLights = style.fences?.streetSpan === 'front' ? street?.lights ?? [] : [];
        const plan = gateLights.length === 0 ? planned0 : {
          ...planned0,
          lamps: planned0.lamps.filter((j) => !gateLights.some((l) => Math.max(Math.abs(l[0] - grid.x(j)), Math.abs(l[2] - grid.z(j))) <= 3)),
        };
        const paving = tiled === undefined ? undefined : pavingPattern(grid, p.cells, p.zoneId, seed, tiled.themeId, logTiled);
        if (paving !== undefined) mirrorPick(p.cells);
        layoutPlaza(gen, p.cells, level, plan, decor.well ?? 'roofed', paving);
        if (plan.well !== undefined) wellsAt.push([grid.x(plan.well), level, grid.z(plan.well)]);
        if (plan.tree !== undefined) zoneTrees.push({ base: [grid.x(plan.tree), level, grid.z(plan.tree)], species: 'oak' });
        break;
      }
      case 'yard': {
        const w = wells.get(p);
        const paving = tiled === undefined ? undefined : pavingPattern(grid, p.cells, p.zoneId, seed, tiled.themeId, logTiled);
        if (paving !== undefined) mirrorPick(p.cells);
        for (const i of p.cells) {
          surface[i] = paving?.get(i) ?? 'ground_yard';
          if (blocked[i] === 1 && propCol[i] === 0 && w === undefined) {
            emit([grid.x(i), level + 1, grid.z(i)], 'plant', 'fence_outdoor', 'fence');
            emit([grid.x(i), level + 2, grid.z(i)], 'plant', 'light_outdoor', 'lantern');
          }
        }
        if (w !== undefined) {
          buildWell(gen, w, level, decor.well ?? 'roofed');
          wellsAt.push([grid.x(w), level, grid.z(w)]);
        }
        break;
      }
      case 'pond': {
        const set = new Set(p.cells);
        const edge = grid.distance(p.cells.filter((i) => grid.n4(i).some((j) => !set.has(j))), 4);
        for (const i of p.cells) {
          water[i] = edge[i]! >= 1 ? 2 : 1;
          bed[i] = 'pond_bed';
          surface[i] = 'water';
        }
        break;
      }
      case 'meadow':
      case 'path':
        break;
    }
  }
  // Trampelpfad nur, wo kein Bauwerk steht: Auf Tordurchgängen und Vortreppen setzt das Bauwerk feste Blöcke direkt
  // auf den Boden – Vanilla macht Trampelpfad unter festem Block sofort zu Erde (M2), also gleich Erde verwenden.
  if (prof === undefined) {
    for (let i = 0; i < n; i++) if (path[i] === 1 && surface[i] === 'ground_grass') surface[i] = struct[i] !== 0 ? 'ground_dirt' : 'ground_path';
  } else {
    // T2 Wegprofil (research/18 G1/G4, research/16 U5): Material je Rang, Grasnarbe, Rinne, Trittsteine, weicher Rand
    const skip = new Set<number>();
    const median = new Set<number>();
    const gutter = new Set<number>();
    for (const r of routes) {
      const c = r.cells;
      if (r.rank === 1 && prof.stepping === true) c.forEach((i, k) => k % 2 === 1 && rank[i] === 1 && skip.add(i));
      if (r.width === 3 && r.rank >= 2 && prof.median === true) for (let k = 3; k < c.length - 3; k++) if (rank[c[k]!] === r.rank) median.add(c[k]!);
      if (r.rank === 3 && r.width >= 5 && prof.gutter === true) for (let k = 2; k < c.length - 2; k++) if (cls[c[k]!] !== C.pad) gutter.add(c[k]!);
    }
    for (let i = 0; i < n; i++) {
      if (path[i] !== 1 || surface[i] !== 'ground_grass') continue;
      if (struct[i] !== 0) surface[i] = 'ground_dirt';
      else if (median.has(i) || skip.has(i)) continue;
      // W4-A Trittstein-Weg: Schachbrett (entlang jeder 4er-Route wechselt die Parität – jede zweite Zelle ein Stein)
      else if (prof.steppingAll === true) {
        if (((grid.x(i) + grid.z(i)) & 1) === 0) surface[i] = 'path_stone';
      }
      else if (gutter.has(i)) surface[i] = 'path_gutter';
      else surface[i] = rank[i] === 3 ? 'path_main' : rank[i] === 1 && prof.stepping === true ? 'path_stone' : 'ground_path';
    }
    // W3-GA Ausfransen: Randzellen bekommen in zusammenhängenden Stücken das Material des Nachbarwegs (±1)
    const bulge = prof.bulge ?? 0;
    if (bulge > 0) {
      const bnoise = hashSeed(seed, 'path-bulge');
      const grow: Array<[number, number]> = [];
      for (let i = 0; i < n; i++) {
        if (path[i] === 1 || surface[i] !== 'ground_grass' || blocked[i] === 1 || plantCol[i] === 1 || struct[i] !== 0 || profile[i] === 1 || lowered[i] === 1
          || onRoute[i] === 1 || ring[i] === 1 || doorDist[i]! < 2) continue;
        if (cls[i] !== C.meadow && cls[i] !== C.meadowZone && cls[i] !== C.pad) continue;
        const next = grid.n4(i).filter((j) => path[j] === 1 && rank[j]! >= 2 && (surface[j] === 'path_main' || surface[j] === 'ground_path'));
        if (next.length === 0 || valueNoise2(bnoise, grid.x(i), grid.z(i), 3) >= bulge) continue;
        grow.push([i, Math.max(...next.map((j) => rank[j]!))]);
      }
      // nur Oberfläche: kein Wegrang (sonst zählte der Wege-Bericht jede Ausbuchtung als Sackgasse), aber frei von Pflanzen
      for (const [i, rk] of grow) {
        surface[i] = rk === 3 ? 'path_main' : 'ground_path';
        plantCol[i] = 1;
      }
    }
    const share = prof.edge ?? 0.6;
    const noise = hashSeed(seed, 'path-edge');
    for (let i = 0; i < n; i++) {
      if (share <= 0) break;
      if (path[i] === 1 || surface[i] !== 'ground_grass' || blocked[i] === 1 || struct[i] !== 0 || profile[i] === 1 || lowered[i] === 1 || onRoute[i] === 1) continue;
      if (cls[i] !== C.meadow && cls[i] !== C.meadowZone && cls[i] !== C.pad) continue;
      if (!grid.n4(i).some((j) => path[j] === 1 && rank[j]! >= 2)) continue;
      if (valueNoise2(noise, grid.x(i), grid.z(i), 2) < share) surface[i] = 'path_edge';
    }
    // W4-A Vorplatz (Review M3): vor jeder Außentür 3 breit und `forecourt` tief ein Pflaster aus einer Rolle
    // (`path_stone`, in allen Themes ≤ 3 Blockarten) statt Hof-, Weg- und Randmischung nebeneinander. Gepflastert
    // werden Weg, Laufweg, Ausfransung, Planierring, Hof und freier Rasen im Streifen; Beete, Felder, der Platz
    // (eigenes Muster), Zaunringe, Objekte und Wasser bleiben, wie sie sind.
    const fore = prof.forecourt ?? 0;
    for (const d of fore > 0 ? building.doors : []) {
      const [dx, dz] = DIR_OFFSET[d.outward];
      for (let k = -1; k <= 1; k++) {
        for (let s = 1; s <= fore; s++) {
          const j = grid.at(d.cell[0] + dx * s - dz * k, d.cell[1] + dz * s + dx * k);
          if (j < 0 || cls[j] === C.building) break;
          if (struct[j] !== 0 || plinthCol[j] === 1 || lowered[j] === 1 || water[j] !== 0) continue;
          // W5 (27.09.2026, Review M3-Rest): auch über den Platz (Stadthaus, Häuserzeile) – vorher blieb dort dessen
          // Muster (Hofpflaster mit Ringen, 4–5 Blockarten) vor der Tür liegen; Brunnen, Laternen und Baum (gesperrt) bleiben
          const open = blocked[j] === 0 && (cls[j] === C.pad || cls[j] === C.meadow || cls[j] === C.meadowZone || cls[j] === C.yard || cls[j] === C.plaza);
          const paved = path[j] === 1 || landing[j] === 1 || surface[j] === 'path_main' || surface[j] === 'ground_path' || surface[j] === 'path_edge' || open;
          if (!paved || ring[j] === 1 || (cls[j] === C.plaza && blocked[j] === 1)) continue;
          surface[j] = 'path_stone';
          plantCol[j] = 1;
        }
      }
    }
  }

  // W3-GA Straßenzaun: unter dem Tor liegt das Material des Hauptwegs (das Tor selbst ist keine Wegzelle)
  for (const i of street?.gates ?? []) if (surface[i] === 'ground_grass') surface[i] = prof === undefined ? 'ground_path' : prof.steppingAll === true ? 'path_stone' : 'path_main';

  // ------------------------------------------------------------------ 4b Ausstattung (T2)
  const decorCount: DecorCount = decor.beds === true || decor.eaves === true || decor.planters === true || props > 0 || decor.espalier === true
    ? houseDecor(gen, { ...decor, ...(decor.kits === true ? { front: (building.doors.find((d) => d.outward === 'south') ?? building.doors[0])?.outward } : {}) })
    : { beds: 0, planters: 0, woodpiles: 0, barrels: 0, espaliers: 0, beehives: 0 };
  // W3-GA: mit Zonen-Modulen steht der Bienenstock in der Gartenecke (`ZONE_KITS.garden`), nicht zusätzlich davor
  if (props > 0 && decor.kits !== true) for (const p of parts) if (p.kind === 'garden' && beehive(gen, p.cells, props, p.zoneId)) decorCount.beehives++;
  // W4-A: mit `groups.max` bekommen die Hausbäume nur, was die Gruppen übrig lassen (Obstgarten zählt nicht mit)
  const treeMax = style.vegetation?.trees?.groups?.max;
  const framing = houseTrees(gen, treeMax === undefined ? decor.houseTrees ?? 0 : Math.min(decor.houseTrees ?? 0, Math.max(0, treeMax - planned.length)), front);
  for (const t of framing) zoneTrees.push({ base: t.base, species: 'oak' });

  // ------------------------------------------------------------------ 5 Vegetation
  const veg = style.vegetation ?? {};
  const vrng = (label: string): Rng => new Rng(hashSeed(seed, 'veg', label));
  // Q3: Katalog-Objekte (propCol) zählen hier **nicht** als Sperrfläche – Bäume dürfen an sie heranrücken,
  // weil die genaue Zell-Kollisionsprüfung (`treeBlocksFree`) sie ohnehin meidet. Wege, Zonen, Bauwerke,
  // Profile und Traufstreifen behalten dagegen ihren Abstand.
  const nonFree: number[] = [];
  for (let i = 0; i < n; i++) {
    if (cls[i] !== C.meadow || path[i] === 1 || (blocked[i] === 1 && propCol[i] === 0) || struct[i] !== 0 || profile[i] === 1 || lowered[i] === 1) nonFree.push(i);
  }
  const clear = grid.distance(nonFree, 8);
  const forest = (x: number, z: number): number => {
    const v = valueNoise2(hashSeed(seed, 'forest'), x, z, 16);
    return between((v - 0.3) / 0.4, 0, 1);
  };
  const cellsWhere = (f: (i: number) => boolean): Array<readonly [number, number]> => {
    const res: Array<readonly [number, number]> = [];
    for (let i = 0; i < n; i++) if (f(i)) res.push(grid.cell(i));
    return res;
  };

  // Garantiert freie Stellen (research/30 K6, Nutzerreview „die Wege verbinden alles"): Wege und Türvorfelder
  // bleiben frei, egal wie hoch die Dichte ist. Ohne `keepFree` kostet das nichts und ändert nichts.
  const keepFreeRules = veg.keepFree ?? [];
  const pathFree = keepFreeRules.some((r) => 'along' in r && r.along === 'path') ? grid.distance(cellsWhere((i) => path[i] === 1).map(([x, z]) => grid.idx(x, z)), 4) : undefined;
  const keepFree = keepFreeRules.length === 0 ? undefined : (x: number, z: number): boolean => {
    const i = grid.at(x, z);
    if (i < 0) return false;
    for (const r of keepFreeRules) {
      if ('along' in r) {
        if (r.along === 'path' && pathFree !== undefined && pathFree[i]! <= r.distance) return true;
      } else if (r.around === 'door' ? doorDist[i]! <= r.distance : padDist[i]! <= r.distance) return true;
    }
    return false;
  };
  /** Feld für die harte Schwelle der Bodenpflanzen: Flecken statt Einzelblumen (research/30 K6). */
  const plantField = (x: number, z: number): number => valueNoise2(hashSeed(seed, 'veg-threshold'), x, z, 7);

  /** Kein Baumblock trifft eine bestehende Zelle (Laub in Laub ist erlaubt, alles andere nicht). */
  const treeBlocksFree = (blocks: ReturnType<typeof growTree>['blocks']): boolean => {
    for (const b of blocks) {
      const k = key3(b.pos);
      if (building.occupied.has(k)) return false;
      const existing = out.get(k);
      if (existing !== undefined) {
        if (b.part === 'leaves' && existing.role.startsWith('leaves')) continue;
        return false;
      }
      // Q3: Katalog-Objekte sind keine `out`-Zellen – ihre belegten Zellen stehen in `propCells`.
      const prop = propCells.get(k);
      if (prop !== undefined) {
        if (b.part === 'leaves' && prop.op === 2) continue;
        return false;
      }
    }
    return true;
  };

  // Bäume
  const t = veg.trees;
  /** Gewachsene Bäume des Stils (W7-I: der Faktor des Grundstücks dünnt bzw. ergänzt danach, `treeDensity`). */
  const grown: GrownTree[] = [];
  /** Baum wachsen lassen, wenn keine Zelle kollidiert (Laub in Laub erlaubt); Stamm auf Erde. */
  const plantTree = (i: number, sp: TreeSpecies, group?: number): boolean => {
    const x = grid.x(i);
    const z = grid.z(i);
    const tree = growTree(sp, [x, top[i]!, z], new Rng(hashSeed(seed, 'tree', x, z)));
    if (!treeBlocksFree(tree.blocks)) return false;
    for (const b of tree.blocks) {
      if (b.part === 'log') emit(b.pos, 'plant', `log_${sp}`, 'log', { axis: 'y' });
      else emit(b.pos, 'plant', `leaves_${sp}`, 'leaves');
    }
    grown.push({ i, base: [x, top[i]!, z], species: sp, keys: tree.blocks.map((b) => key3(b.pos)), surface: surface[i]!, ...(group !== undefined ? { group } : {}) });
    surface[i] = 'ground_dirt';
    blocked[i] = 1;
    plantCol[i] = 1;
    return true;
  };
  if (groupOpts !== undefined) {
    // W3-GA Baumgruppe: die in 3a geplanten Stämme wachsen jetzt (Kollisionsprüfung wie bei der Streuung)
    for (const tr of planned) {
      blocked[tr.cell] = 0;
      plantTree(tr.cell, tr.species, tr.group);
    }
  } else if (t !== undefined && t.density > 0) {
    const species = TREE_SPECIES.filter((s) => (t.species[s] ?? 0) > 0);
    const rng = vrng('trees');
    // Q3: Baumkronen dürfen an Katalog-Objekte heran (research/51 §1.3 „Natur wächst an den Bau heran“); die
    // genaue Kollisionsprüfung `treeBlocksFree` meidet ihre Zellen. Zu Wegen, Zonen und Bauwerken halten Bäume
    // weiter den bisherigen Abstand (`clear ≥ 3`, ohne die Katalog-Objekte in `nonFree`).
    const cands = cellsWhere((i) => cls[i] === C.meadow && clear[i]! >= 3 && padDist[i]! >= padWidth + 3 && distToBorder(grid, i) >= 2);
    const spots = poissonDisk(cands, t.spacing, rng, (x, z) => rng.chance(t.density * (0.25 + 0.75 * forest(x, z))), [], { threshold: forest, ...(t.threshold !== undefined ? { min: t.threshold } : {}), ...(keepFree !== undefined ? { keepFree } : {}) });
    for (const [x, z] of spots) {
      const sp = new Rng(hashSeed(seed, 'species', x, z)).weighted(species, (s) => t.species[s] ?? 0);
      plantTree(grid.idx(x, z), sp);
    }
  }
  // W7-I: Baumdichte des Grundstücks (Faktor 0 … 2) nach dem Pass des Stils – monoton wie die Bodenpflanzen (W4-D)
  const treeFactor = site.vegetation?.trees ?? lf?.trees;
  if (t !== undefined && treeFactor !== undefined && treeFactor !== 1) {
    if (treeFactor < 1) {
      const kept = thinTrees(gen, grown, treeFactor);
      grown.length = 0;
      grown.push(...kept);
    }
    if (treeFactor > 1 && t.density > 0) {
      const species = TREE_SPECIES.filter((s) => (t.species[s] ?? 0) > 0);
      // dichter heißt auch enger: ergänzte Bäume halten 3/4 des Stil-Abstands (fest je Stil, sonst nicht monoton)
      const spacing = Math.max(3, 0.75 * (groupOpts !== undefined ? Math.min(t.spacing, 6) : t.spacing));
      const ok = (i: number): boolean => cls[i] === C.meadow && clear[i]! >= 3 && padDist[i]! >= padWidth + 3 && distToBorder(grid, i) >= 2
        && blocked[i] === 0 && plantCol[i] === 0
        // Baumgruppen-Stile (G1 „wenige Bäume am Rand“): auch ergänzte Bäume nur im Randstreifen, nie vor einer Fassade
        && (groupOpts === undefined || (front![i] !== 1 && borderDist(gen, i) >= (groupOpts.rim ?? [2, 6])[0] && borderDist(gen, i) <= (groupOpts.rim ?? [2, 6])[1]))
        && (t.threshold === undefined || forest(grid.x(i), grid.z(i)) >= t.threshold) && (keepFree === undefined || !keepFree(grid.x(i), grid.z(i)));
      const others = [...zoneTrees.map((z) => z.base), ...grown.map((g) => g.base)];
      const order = hashSeed(seed, 'tree-more');
      addInOrder(gen, (i) => (ok(i) ? hash01(order, grid.x(i), grid.z(i)) : undefined), Math.ceil((treeFactor - 1) * Math.max(1, grown.length)), (i) => {
        const x = grid.x(i);
        const z = grid.z(i);
        if (!ok(i)) return false;
        if (others.some((p) => Math.hypot(p[0] - x, p[2] - z) < spacing)) return false;
        const sp = new Rng(hashSeed(seed, 'species', x, z)).weighted(species, (s) => t.species[s] ?? 0);
        if (!plantTree(i, sp)) return false;
        others.push(grown.at(-1)!.base);
        return true;
      });
    }
  }
  const trees: { base: Vec3; species: TreeSpecies }[] = grown.map((g) => ({ base: g.base, species: g.species }));
  const understory: number[][] = [];
  if (groupOpts !== undefined) {
    const byGroup = new Map<number, number[]>();
    for (const g of grown) if (g.group !== undefined) byGroup.set(g.group, [...(byGroup.get(g.group) ?? []), g.i]);
    understory.push(...[...byGroup.keys()].sort((a, b) => a - b).map((k) => byGroup.get(k)!));
  }

  // Büsche am Fundament (research/12 §6.3) und auf der Wiese
  let bushes = 0;
  const b = veg.bushes;
  /** W7-I: Buschgruppen des Stils (Fundament und Wiese) – der Faktor des Grundstücks dünnt bzw. ergänzt danach. */
  const clumps: BushClump[] = [];
  const bushAt = (cells: ReadonlyArray<readonly [number, number]>, upper: boolean, record = false): void => {
    const clump: BushClump = { at: cells[0] ?? [0, 0], keys: [], cols: [] };
    for (const [x, z] of cells) {
      const i = grid.idx(x, z);
      if (emit([x, top[i]! + 1, z], 'plant', 'leaves_bush', 'block')) {
        plantCol[i] = 1;
        blocked[i] = 1;
        clump.keys.push(key3([x, top[i]! + 1, z]));
        clump.cols.push(i);
      }
    }
    if (upper && cells.length > 0) {
      const [x, z] = cells[0]!;
      const pos: Vec3 = [x, top[grid.idx(x, z)]! + 2, z];
      if (emit(pos, 'plant', 'leaves_bush', 'block')) clump.keys.push(key3(pos));
    }
    if (record) clumps.push(clump);
    bushes++;
  };
  if (b !== undefined && b.density + (b.foundation ?? 0) > 0) {
    const rng = vrng('bushes');
    const okFoot = (x: number, z: number): boolean => {
      const i = grid.at(x, z);
      return i >= 0 && footDist[i] === 1 && cls[i] === C.pad && path[i] === 0 && doorDist[i]! >= 3 && plantCol[i] === 0 && struct[i] === 0
        && profile[i] === 0 && lowered[i] === 0;
    };
    const foot = cellsWhere((i) => okFoot(grid.x(i), grid.z(i)));
    for (const [x, z] of poissonDisk(foot, 4, rng, () => rng.chance(b.foundation ?? 0.5), [], { threshold: forest, ...(b.foundationThreshold !== undefined ? { min: b.foundationThreshold } : {}), ...(keepFree !== undefined ? { keepFree } : {}) })) bushAt(bushCells(x, z, rng, rng.int(1, 3), okFoot), false, true);
    const okMeadow = (x: number, z: number): boolean => {
      const i = grid.at(x, z);
      return i >= 0 && cls[i] === C.meadow && clear[i]! >= 2 && plantCol[i] === 0 && blocked[i] === 0 && struct[i] === 0 && profile[i] === 0;
    };
    const cands = cellsWhere((i) => okMeadow(grid.x(i), grid.z(i)));
    const taken = trees.map((tr) => [tr.base[0], tr.base[2]] as const);
    for (const [x, z] of poissonDisk(cands, b.spacing, rng, (px, pz) => rng.chance(b.density * (0.4 + 0.6 * forest(px, pz))), taken, { threshold: forest, ...(b.threshold !== undefined ? { min: b.threshold } : {}), ...(keepFree !== undefined ? { keepFree } : {}) })) {
      bushAt(bushCells(x, z, rng, rng.int(1, 4), okMeadow), rng.chance(0.3), true);
    }
  }

  // W3-GA Unterholz der Baumgruppen: 1–2 Büsche am Kronenrand (Abstand 2–3 zum Stamm), nie im Vorderband
  const under = groupOpts?.understory ?? 1;
  if (under > 0 && understory.length > 0) {
    const rng = vrng('understory');
    const okUnder = (x: number, z: number): boolean => {
      const i = grid.at(x, z);
      return i >= 0 && cls[i] === C.meadow && path[i] === 0 && onRoute[i] === 0 && blocked[i] === 0 && plantCol[i] === 0 && struct[i] === 0
        && profile[i] === 0 && lowered[i] === 0 && front![i] !== 1 && clear[i]! >= 1;
    };
    for (const group of understory) {
      const ring: Array<readonly [number, number]> = [];
      for (const c of group) {
        for (let dx = -3; dx <= 3; dx++) {
          for (let dz = -3; dz <= 3; dz++) {
            const d = Math.max(Math.abs(dx), Math.abs(dz));
            if (d < 2) continue;
            const x = grid.x(c) + dx;
            const z = grid.z(c) + dz;
            if (okUnder(x, z) && !ring.some(([a, b]) => a === x && b === z)) ring.push([x, z]);
          }
        }
      }
      let placed = 0;
      for (const [x, z] of rng.shuffle(ring.sort((a, b) => a[0] - b[0] || a[1] - b[1]))) {
        if (placed >= under) break;
        if (!okUnder(x, z)) continue;
        bushAt(bushCells(x, z, rng, rng.int(1, 2), okUnder), false);
        placed++;
      }
    }
  }

  // W7-I: Buschdichte des Grundstücks (Faktor 0 … 2) nach dem Pass des Stils – ganze Gruppen fallen weg bzw. kommen
  // hinzu (Unterholz der Baumgruppen hängt an den Bäumen, nicht am Busch-Regler)
  const bushFactor = site.vegetation?.bushes;
  if (b !== undefined && bushFactor !== undefined && bushFactor !== 1) {
    if (bushFactor < 1) bushes -= thinBushes(gen, clumps, bushFactor);
    else {
      // erst am Fundament (Takt 4 wie der Pass), dann auf der Wiese (Abstand des Stils) – eine feste Reihenfolge
      const okFoot = (x: number, z: number): boolean => {
        const i = grid.at(x, z);
        return i >= 0 && footDist[i] === 1 && cls[i] === C.pad && path[i] === 0 && doorDist[i]! >= 3 && plantCol[i] === 0 && blocked[i] === 0
          && struct[i] === 0 && profile[i] === 0 && lowered[i] === 0 && (keepFree === undefined || !keepFree(x, z));
      };
      const okMeadow = (x: number, z: number): boolean => {
        const i = grid.at(x, z);
        return i >= 0 && cls[i] === C.meadow && clear[i]! >= 2 && plantCol[i] === 0 && blocked[i] === 0 && struct[i] === 0 && profile[i] === 0
          && (keepFree === undefined || !keepFree(x, z)) && (b.threshold === undefined || forest(x, z) >= b.threshold);
      };
      const feet = clumps.filter((c) => footDist[grid.idx(c.at[0], c.at[1])] === 1).map((c) => c.at);
      const centers = [...clumps.map((c) => c.at), ...trees.map((tr) => [tr.base[0], tr.base[2]] as const)];
      const order = hashSeed(seed, 'bush-more-order');
      const rank = (i: number): number | undefined => {
        const h = hash01(order, grid.x(i), grid.z(i));
        return (b.foundation ?? 0) > 0 && okFoot(grid.x(i), grid.z(i)) ? h : okMeadow(grid.x(i), grid.z(i)) ? 1 + h : undefined;
      };
      addInOrder(gen, rank, Math.ceil((bushFactor - 1) * Math.max(1, clumps.length)), (i, r) => {
        const x = grid.x(i);
        const z = grid.z(i);
        const foot = r < 1;
        if (!(foot ? okFoot(x, z) : okMeadow(x, z))) return false;
        if (foot ? feet.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 4) : centers.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < Math.max(3, 0.75 * b.spacing))) return false;
        const rr = new Rng(hashSeed(seed, 'bush-more', x, z));
        bushAt(bushCells(x, z, rr, foot ? rr.int(1, 3) : rr.int(1, 4), foot ? okFoot : okMeadow), !foot && rr.chance(0.3));
        (foot ? feet : centers).push([x, z]);
        return true;
      });
    }
  }

  // Bodenpflanzen: Blumen in Flecken, Gras, Blütenteppich
  let groundPlants = 0;
  const g = veg.ground;
  // W4-D: Die Dichte des Grundstücks (`Site.setVegetation`, Faktor 0 … 2) wirkt nicht mehr auf die Dichte des Stils,
  // sondern erst nach allen anderen Pässen auf die hier gesetzten Pflanzen (`groundFactor` unten): Faktor < 1 dünnt
  // ganze Flecken aus, Faktor > 1 ergänzt freie Zellen. Vorher sättigte der Regler (Stil-Dichte × Faktor ≤ 1, Wiese
  // 0,95 → 1) und die geänderte Zufallsfolge ließ „mehr“ oft weniger ergeben (Wiese 727 statt 759).
  const baseGround: Array<{ readonly i: number; readonly key: string; readonly cell: ShellCell; readonly group: string }> = [];
  const noteGround = (i: number, pos: Vec3, group: string): void => {
    const key = key3(pos);
    baseGround.push({ i, key, cell: out.get(key)!, group });
  };
  let groundOk: ((i: number) => boolean) | undefined;
  let groundNear: ArrayLike<number> | undefined;
  if (g !== undefined && g.density > 0) {
    const rng = vrng('ground');
    const ok = (i: number): boolean =>
      (cls[i] === C.meadow || cls[i] === C.meadowZone || (cls[i] === C.pad && covered[i] === 0) || (cls[i] === C.orchard && ring[i] === 0 && onRoute[i] === 0))
      && path[i] === 0 && blocked[i] === 0 && plantCol[i] === 0 && doorDist[i]! >= 2 && surface[i] === 'ground_grass' && struct[i] === 0
      && profile[i] === 0 && lowered[i] === 0;
    groundOk = ok;
    const cands = cellsWhere(ok);
    const flowers = g.flowers ?? 0.3;
    const carpet = g.carpet ?? 0.1;
    const baseRoll = (x: number, z: number): boolean => rng.chance(cls[grid.idx(x, z)] === C.meadowZone ? Math.min(1, g.density * 1.6) : g.density);
    // W3-GA Blumen in Bezug: Saum an Weg, Zaun/Hecke, Gehölz, Haus und Zonen voll, offener Rasen nur Anteil `open`
    const nearField = g.near === undefined ? undefined : grid.distance(cellsWhere((i) => path[i] === 1 || ring[i] === 1 || blocked[i] === 1 || cls[i] === C.pad
      || (cls[i] !== C.meadow && cls[i] !== C.meadowZone && cls[i] !== C.building)).map(([x, z]) => grid.idx(x, z)), 8);
    groundNear = nearField;
    const densityRoll = nearField === undefined ? baseRoll
      : (x: number, z: number): boolean => (nearField[grid.idx(x, z)]! <= g.near!.distance || rng.chance(g.near!.open)) && baseRoll(x, z);
    const poissonOpts = { threshold: plantField, ...(g.threshold !== undefined ? { min: g.threshold } : {}), ...(keepFree !== undefined ? { keepFree } : {}) };
    const cl = g.clusters;
    if (cl === undefined) {
      const spots = poissonDisk(cands, g.spacing, rng, densityRoll, [], poissonOpts);
      for (const [x, z] of spots) {
        const i = grid.idx(x, z);
        const patch = valueNoise2(hashSeed(seed, 'flowers'), x, z, 5);
        const share = cls[i] === C.meadowZone ? Math.min(1, flowers + 0.25) : flowers;
        const pos: Vec3 = [x, top[i]! + 1, z];
        const placed = patch < share
          ? emit(pos, 'plant', 'flower_wild', 'block')
          : rng.chance(carpet)
            ? emit(pos, 'plant', 'ground_cover', 'block', { facing: rng.pick(HORIZONTAL) })
            : emit(pos, 'plant', 'grass_tuft', 'block');
        if (placed) {
          plantCol[i] = 1;
          groundPlants++;
          noteGround(i, pos, `${x},${z}`);
        }
      }
    } else {
      // Q3 Cluster statt Konfetti (research/51 §4 V-C1): dichte Kerne, ausgedünnter Rand. Die **Art gilt je
      // Fleck** (nicht je Zelle), damit ein Blumenfleck einfarbig blüht; Blütenart und Gras entstehen aus dem
      // Flecken-Rauschen am Zentrum.
      // Die Dichte des Grundstücks wirkt seit W4-D nach allen Pässen (`groundFactor`), hier gilt der Stil.
      const spots = clusterSpots(cands, cl.spacing, rng, { radius: cl.radius, core: Math.min(1, cl.core), edge: Math.min(1, cl.edge) }, densityRoll, [], poissonOpts);
      const roleOf = new Map<string, TerrainRole>();
      for (const s of spots) {
        const i = grid.idx(s.x, s.z);
        const ck = `${s.centerX},${s.centerZ}`;
        let role = roleOf.get(ck);
        if (role === undefined) {
          const patch = valueNoise2(hashSeed(seed, 'flowers'), s.centerX, s.centerZ, 5);
          const share = cls[i] === C.meadowZone ? Math.min(1, flowers + 0.25) : flowers;
          const r = rng.next();
          role = patch < share
            ? r < 0.6 ? 'flower_wild' : r < 0.8 ? 'flower_warm' : 'flower_cool'
            : rng.chance(carpet) ? 'ground_cover' : 'grass_tuft';
          roleOf.set(ck, role);
        }
        const pos: Vec3 = [s.x, top[i]! + 1, s.z];
        const placed = role === 'ground_cover' ? emit(pos, 'plant', role, 'block', { facing: rng.pick(HORIZONTAL) }) : emit(pos, 'plant', role, 'block');
        if (placed) {
          plantCol[i] = 1;
          groundPlants++;
          noteGround(i, pos, ck);
        }
      }
    }
  }

  // Hügel (BT16): Gras, Blumen und Büsche auf Böschung und Dach
  if (hill !== undefined) {
    const planted = plantMound(gen, hill);
    groundPlants += planted.ground;
    bushes += planted.bushes;
  }

  // Uferpflanzen
  for (const p of parts) {
    if (p.kind !== 'pond') continue;
    const set = new Set(p.cells);
    const rng = new Rng(hashSeed(seed, 'shore', p.zoneId));
    const rim = [...new Set(p.cells.flatMap((i) => grid.n4(i)))].filter((j) => !set.has(j)).sort((a, c) => a - c);
    for (const j of rim) {
      if (path[j] === 1 || blocked[j] === 1 || plantCol[j] === 1 || surface[j] !== 'ground_grass' || cls[j] === C.building || struct[j] !== 0) continue;
      if (!rng.chance(0.35)) continue;
      if (emit([grid.x(j), top[j]! + 1, grid.z(j)], 'plant', 'pond_plant', 'block')) plantCol[j] = 1;
    }
  }

  // W13-C Runde 2: Vorgarten des Erdhauses (Mittelweg, Zaun, Laternenpfosten), nur mit Flanken
  if (hill !== undefined) frontGarden(gen, parts.filter((p) => p.kind === 'garden').flatMap((p) => p.cells));

  // feat/gelaende: Moosflecken (Sockel dichter), Farn am Sockel, Findlinge – nach allen Pflanzen, Moos trägt Blumen und Gras
  if (lf !== undefined) {
    const fernRng = new Rng(hashSeed(seed, 'landform-fern'));
    for (let i = 0; i < n; i++) {
      if (cls[i] !== C.meadow || surface[i] !== 'ground_grass' || path[i] === 1 || struct[i] !== 0 || profile[i] === 1) continue;
      const near = padDist[i]! <= padWidth + 2;
      if (mossPatch(seed, grid.x(i), grid.z(i), near ? Math.min(0.7, lf.moss * 2.4) : lf.moss)) surface[i] = 'ground_moss';
    }
    for (let i = 0; i < n; i++) {
      if (cls[i] !== C.meadow || padDist[i] !== padWidth + 1 || path[i] === 1 || plantCol[i] === 1 || blocked[i] === 1 || struct[i] !== 0 || doorDist[i]! < 3) continue;
      if (fernRng.chance(0.45) && emit([grid.x(i), top[i]! + 1, grid.z(i)], 'plant', 'grass_tuft', 'block')) {
        plantCol[i] = 1;
        groundPlants++;
      }
    }
    boulders(gen, lf.boulders);
  }

  // T2: Streudeko (V3) und Beleuchtung (L1/L3) zuletzt – sie sehen alle Pflanzen
  let scattered = 0;
  if ((decor.scatter ?? 0) > 0) {
    scattered = scatter(gen, decor.scatter ?? 0);
    groundPlants += scattered;
  }
  let lightReport: LightingReport | undefined;
  if (lighting !== 'none') {
    // Wegmündung: hat der Straßenzaun Torlaternen, braucht der Weg dort keinen eigenen Pfahl
    lightReport = lightSite(gen, lighting, routes, style.lighting?.every ?? 10, style.lighting?.leaves === true, {
      entry: style.lighting?.entry === true && (street?.lights.length ?? 0) === 0, litSpacing: style.lighting?.entry === true,
      forecourt: style.lighting?.entry === true,
    });
    groundPlants -= lightReport.removedPlants;
  }

  // W4-D: Dichte der Bodenpflanzen (Faktor des Grundstücks) nach allen Pässen – Laternen, Streudeko und Ufer sehen
  // immer die Stil-Dichte, deshalb ändert der Regler nur die Bodenpflanzen selbst. Beide Richtungen sind monoton:
  // gleiche Zellen, gleiche Würfe (`hash01` je Zelle bzw. Fleck), nur die Schwelle wächst mit dem Faktor.
  const groundFactor = site.vegetation?.ground ?? lf?.ground;
  if (g !== undefined && groundFactor !== undefined && groundFactor !== 1) {
    groundPlants += groundFactor < 1
      ? -thinGround(out, plantCol, baseGround, hashSeed(seed, 'ground-thin'), groundFactor)
      : g.density > 0 && groundOk !== undefined
        ? addGround(gen, g, baseGround, groundOk, groundNear, keepFree, plantField, groundFactor - 1)
        : 0;
  }

  // Sicherheitsnetz (M2): Trampelpfad/Ackerland/Beet nie unter einem festen Block des Geländes (Zaun, Laterne,
  // Stamm, Laub). Erlaubt sind nur Luft, nicht feste Pflanzen und Zauntore (FarmBlock/DirtPathBlock#canSurvive).
  for (let i = 0; i < n; i++) {
    if (surface[i] !== 'ground_path' && surface[i] !== 'farmland') continue;
    const above = out.get(key3([grid.x(i), top[i]! + 1, grid.z(i)]));
    if (above !== undefined && !soilKeepsUnder(above)) surface[i] = 'ground_dirt';
  }

  // ------------------------------------------------------------------ 6 Bodensäulen
  let bottom = Infinity;
  for (let i = 0; i < n; i++) bottom = Math.min(bottom, cls[i] === C.building ? y0 - 1 : top[i]! - water[i]!);
  bottom -= soilDepth - 1;
  const terrain: Array<[Vec3, TerrainRole]> = [];
  // W9-G4 Erdhügel mit Flanken (Hülle seit W9-G4, `wing` > 0): Zellen über der Grundhöhe, deren Seite offen liegt
  // (Nachbarspalte tiefer), zeigen keine Erde – oben Moos (grün auch an der Seite), darunter Stützmauer. Ohne Flanken
  // bitgleich.
  const faced = hill !== undefined && (building.buried ?? []).some((m) => m.wing > 0);
  const colTop = (j: number): number => (cls[j] === C.building ? (hill?.roof[j] !== NO_MOUND ? hill!.top[j]! : Infinity) : top[j]!);
  const openSide = (i: number, y: number): boolean => {
    for (const j of grid.n4(i)) if (colTop(j) < y) return true;
    return false;
  };
  // Moosflecken auch auf den Stufenflächen (Rauschen, Maßstab 4): die Kanten laufen nicht als gleichmäßige Moosringe um
  // den Hügel, Gras und Moos wechseln sich in Flecken ab (Vorbilder: Moos und Blätter verdecken die Stufen)
  const mossy = hashSeed(seed, 'mound-moss');
  // Über der Front (Erdlage über der Decke) ganz Moos: der Steinring der Rundtür hebt sich vom Grün ab; Stützmauer nur
  // an den Anschnitten der Flanken
  // W13-C (28.09.2026, plan/spikes/W13C_erdhaus_huegel.md, Blindvergleich: „flache, gerasterte Grünfläche“): der Hügel
  // zeigt Terrassen wie die Vorbilder – Grasnarbe mit Erdkante, Moos nur in Flecken; Stützmauer nur noch am Anschnitt
  // der Flanken vor der Frontebene (dort steht die Erde senkrecht neben der Front)
  const moundRole = (i: number, y: number, tp: number, role: TerrainRole, overHouse = false): TerrainRole => {
    if (!faced || y <= y0) return role;
    const patch = valueNoise2(mossy, grid.x(i), grid.z(i), 4) > 0.58;
    if (!openSide(i, y)) return y === tp && role === 'ground_grass' && patch ? 'ground_moss' : role;
    if (y < tp) return (role === 'ground_dirt' || role === 'ground_stone') && !overHouse && beforeFront(i) && openSide(i, y + 1) ? 'mound_wall' : role;
    return role === 'ground_grass' && patch ? 'ground_moss' : role;
  };
  const retaining = (i: number, y: number, tp: number): TerrainRole | undefined => {
    let low = Infinity;
    let atHouse = false;
    for (const j of grid.n4(i)) {
      if (cls[j] === C.building) continue;
      if (top[j]! < y && tp - top[j]! >= 2) {
        low = Math.min(low, top[j]!);
        if (cls[j] === C.pad) atHouse = true;
      }
    }
    return low === Infinity ? undefined : atHouse ? 'foundation' : 'mound_wall';
  };
  for (let i = 0; i < n; i++) {
    const x = grid.x(i);
    const z = grid.z(i);
    if (cls[i] === C.building) {
      for (let y = bottom; y < y0; y++) terrain.push([[x, y, z], 'foundation']);
      // Lage buried: Erdlagen über der obersten Hüllzelle, oben Gras
      const r = hill?.roof[i] ?? NO_MOUND;
      const ht = hill?.top[i] ?? NO_MOUND;
      if (r !== NO_MOUND) for (let y = r + 1; y <= ht; y++) terrain.push([[x, y, z], moundRole(i, y, ht, y === ht ? 'ground_grass' : 'ground_dirt', true)]);
      continue;
    }
    const tp = top[i]!;
    const wd = water[i]!;
    for (let y = bottom; y <= tp; y++) {
      const k = tp - y;
      // W7-I: der Hügel eines Erdhauses ist aufgeschüttete Erde – über dem Untergrund des Grundstücks kein Stein im Anschnitt
      const role = k < wd ? 'water' : k === wd ? (wd > 0 ? bed[i]! : surface[i]!)
        : k - wd < soilDepth || (cls[i] === C.mound && y > y0 - soilDepth) ? 'ground_dirt' : 'ground_stone';
      // feat/gelaende: sichtbare Wand (Nachbar ≥ 2 tiefer) als Stützmauer – am Haus im Stein des Hauses, sonst Bruchstein
      const wall = lf !== undefined && wd === 0 && k > 0 && (role === 'ground_dirt' || role === 'ground_stone') ? retaining(i, y, tp) : undefined;
      terrain.push([[x, y, z], wall ?? (cls[i] === C.mound && wd === 0 ? moundRole(i, y, tp, role as TerrainRole) : role as TerrainRole)]);
    }
    const l = lip.get(i);
    if (l !== undefined) for (let y = l.from; y <= l.top; y++) terrain.push([[x, y, z], y === l.top ? 'ground_moss' : 'ground_dirt']);
  }
  const cells: ShellCell[] = [];
  // feat/tiled-wfc: Spiegelpartner eines Musters werten die Materialmischung am selben Ort aus
  const picked = (c: ShellCell): ShellCell => {
    const j = pickAt?.[grid.at(c.pos[0], c.pos[2])] ?? -1;
    return j < 0 ? c : { ...c, pickAt: grid.cell(j) };
  };
  for (const [pos, role] of terrain) {
    const k = key3(pos);
    if (building.occupied.has(k)) continue;
    // Rinne (G1): untere Stufe, eine halbe Stufe tiefer als der Weg
    cells.push(picked(role === 'path_gutter' ? { pos, kind: 'terrain', role, shape: 'slab', orient: { half: 'bottom' } } : { pos, kind: 'terrain', role, shape: 'block' }));
  }
  for (const c of out.values()) cells.push(pickAt === undefined ? c : picked(c));

  const fine = prof !== undefined || postEvery !== undefined || lighting !== 'none' || style.decor !== undefined
    || parts.some((p) => p.kind === 'plaza' || p.kind === 'orchard' || p.kind === 'paddock' || p.kind === 'path' || enclosed.has(p) || p.edge !== (p.kind === 'field' ? 'fence' : 'none'));
  const features: SiteFeatures = {
    wells: wellsAt, gates,
    routes: routes.map((r) => ({ rank: r.rank, width: r.width, cells: r.cells.map((i) => grid.cell(i)) })),
    decor: { ...decorCount, scatter: scattered, houseTrees: framing.length },
    ...(lightReport !== undefined ? { lighting: lightReport } : {}),
  };
  const planPath = Uint8Array.from(path, (v, i) => (v === 1 ? Math.max(1, rank[i]!) : 0));
  return {
    cells, grid, top, surface, bottom,
    paths: CellSet.of([...path.keys()].filter((i) => path[i] === 1).map((i) => grid.cell(i))),
    doorExits: exits.map((i) => grid.cell(i)),
    fields, trees: zoneTrees.length > 0 ? [...trees, ...zoneTrees] : trees, bushes, groundPlants, warnings,
    ...(fine ? { features } : {}),
    plan: { zone: zoneOf, path: planPath },
    outdoor,
    ...(linkResults !== undefined ? { links: linkResults } : {}),
    ...(tiled !== undefined ? { tiled: tiledLog } : {}),
    pathAudit: auditPaths(grid, planPath, exits.map((i) => grid.cell(i)), [
      ...gates.map((gg) => gg.cell), ...wellsAt.map((w) => [w[0], w[2]] as Cell),
      // Straßentor: die Wegzellen beidseits des Tores sind Ziel (dort endet der Weg bewusst)
      ...(street?.gates ?? []).flatMap((i) => grid.n4(i).filter((j) => path[j] === 1)).map((j) => grid.cell(j)),
    ], zoneOf, cells.filter((c) => c.role === 'light_outdoor').map((c) => [c.pos[0], c.pos[2]] as Cell)),
  };
}

type BaseGround = ReadonlyArray<{ readonly i: number; readonly key: string; readonly cell: ShellCell; readonly group: string }>;

/**
 * W4-D: Faktor < 1 – ganze Flecken (bzw. Einzelpflanzen ohne Cluster) bleiben, wenn ihr Wurf je Fleck unter dem
 * Faktor liegt. Gleicher Wurf für jeden Faktor ⇒ ein höherer Faktor behält eine Obermenge. Liefert die Zahl der
 * entfernten Pflanzen (von Laternen schon ersetzte zählen nicht).
 */
function thinGround(out: Map<string, ShellCell>, plantCol: Uint8Array, base: BaseGround, seed: number, factor: number): number {
  let removed = 0;
  for (const p of base) {
    if (out.get(p.key) !== p.cell) continue;
    const [cx, cz] = p.group.split(',').map(Number) as [number, number];
    if (hash01(seed, cx, cz) < factor) continue;
    out.delete(p.key);
    plantCol[p.i] = 0;
    removed++;
  }
  return removed;
}

/**
 * W4-D: Faktor > 1 – zusätzliche Bodenpflanzen auf freien Kandidaten (gleiche Regeln wie der Stil: Fläche, Weg- und
 * Türabstand, Schwelle, freie Stellen). Neben einer Pflanze des Stils wächst der Fleck in derselben Art (Anteil 0,8 ×
 * `more`), im übrigen Rasen Gras/Blumen (0,2 × `more`, auf offenem Rasen fern von Rändern zusätzlich × `near.open`).
 * Wurf je Zelle aus dem Seed ⇒ ein höherer Faktor ergänzt eine Obermenge. Liefert die Zahl der neuen Pflanzen.
 */
function addGround(
  g: Gen, ground: NonNullable<NonNullable<TerrainStyleDef['vegetation']>['ground']>, base: BaseGround, ok: (i: number) => boolean,
  near: ArrayLike<number> | undefined, keepFree: ((x: number, z: number) => boolean) | undefined, field: (x: number, z: number) => number, more: number,
): number {
  const { grid, out, plantCol, top, seed } = g;
  const roleAt = new Map<number, string>();
  for (const p of base) if (out.get(p.key) === p.cell) roleAt.set(p.i, p.cell.role);
  const roll = hashSeed(seed, 'ground-more');
  const kind = hashSeed(seed, 'ground-more-kind');
  const flowers = ground.flowers ?? 0.3;
  const carpet = ground.carpet ?? 0.1;
  let added = 0;
  for (let i = 0; i < grid.w * grid.d; i++) {
    if (!ok(i)) continue;
    const x = grid.x(i);
    const z = grid.z(i);
    if (keepFree !== undefined && keepFree(x, z)) continue;
    if (ground.threshold !== undefined && ground.threshold > 0 && field(x, z) < ground.threshold) continue;
    let role: string | undefined;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const r = roleAt.get(grid.at(x + dx, z + dz));
        if (r !== undefined && (role === undefined || r < role)) role = r;
      }
    }
    const open = near !== undefined && ground.near !== undefined && near[i]! > ground.near.distance ? ground.near.open : 1;
    const p = role !== undefined ? 0.8 * more : 0.2 * more * open;
    if (hash01(roll, x, z) >= p) continue;
    if (role === undefined) {
      const u = hash01(kind, x, z);
      role = valueNoise2(hashSeed(seed, 'flowers'), x, z, 5) < flowers ? 'flower_wild' : u < carpet ? 'ground_cover' : 'grass_tuft';
    }
    const pos: Vec3 = [x, top[i]! + 1, z];
    const facing = HORIZONTAL[Math.floor(hash01(kind, z, x) * HORIZONTAL.length)]!;
    if (!g.emit(pos, 'plant', role as TerrainRole, 'block', role === 'ground_cover' ? { facing } : undefined)) continue;
    plantCol[i] = 1;
    added++;
  }
  return added;
}

/** W7-I: ein gewachsener Baum des Stils bzw. des Reglers (Zellen seiner Blöcke, Oberfläche vor dem Stamm). */
interface GrownTree {
  readonly i: number;
  readonly base: Vec3;
  readonly species: TreeSpecies;
  readonly keys: readonly string[];
  readonly surface: string;
  readonly group?: number;
}

/** W7-I: eine Buschgruppe (erste Spalte, gesetzte Zellen und ihre Spalten). */
interface BushClump {
  readonly at: readonly [number, number];
  readonly keys: string[];
  readonly cols: number[];
}

/**
 * W7-I: Faktor < 1 – ein Baum bleibt, wenn sein Wurf (`hash01` je Stamm) unter dem Faktor liegt. Gleicher Wurf für jeden
 * Faktor ⇒ ein höherer Faktor behält eine Obermenge. Laub, das ein verbleibender Baum mitbenutzt, bleibt stehen.
 */
function thinTrees(g: Gen, grown: readonly GrownTree[], factor: number): GrownTree[] {
  const roll = hashSeed(g.seed, 'tree-thin');
  const kept = grown.filter((t) => hash01(roll, g.grid.x(t.i), g.grid.z(t.i)) < factor);
  const keep = new Set(kept.flatMap((t) => t.keys));
  for (const t of grown) {
    if (kept.includes(t)) continue;
    for (const k of t.keys) {
      const c = g.out.get(k);
      if (!keep.has(k) && c !== undefined && c.kind === 'plant' && (c.role.startsWith('log_') || c.role.startsWith('leaves_'))) g.out.delete(k);
    }
    g.surface[t.i] = t.surface;
    g.blocked[t.i] = 0;
    g.plantCol[t.i] = 0;
  }
  return kept;
}

/** W7-I: Faktor < 1 – ganze Buschgruppen fallen weg (Wurf je Gruppe, Obermenge je höherem Faktor). Liefert die Zahl. */
function thinBushes(g: Gen, clumps: readonly BushClump[], factor: number): number {
  const roll = hashSeed(g.seed, 'bush-thin');
  let removed = 0;
  for (const c of clumps) {
    if (hash01(roll, c.at[0], c.at[1]) < factor) continue;
    for (const k of c.keys) g.out.delete(k);
    for (const i of c.cols) {
      g.plantCol[i] = 0;
      g.blocked[i] = 0;
    }
    removed++;
  }
  return removed;
}

/**
 * W7-I: Faktor > 1 – Kandidaten in fester Reihenfolge (`hash01` je Zelle), jeder wird versucht, bis `target` gesetzt
 * sind. Die Entscheidung über einen Kandidaten hängt nur an den früher gesetzten ⇒ ein höheres Ziel setzt eine
 * Obermenge (monoton), auch wenn Abstände Kandidaten sperren.
 */
function addInOrder(g: Gen, rank: (i: number) => number | undefined, target: number, place: (i: number, rank: number) => boolean): number {
  if (target <= 0) return 0;
  const cands: Array<[number, number]> = [];
  for (let i = 0; i < g.grid.size; i++) {
    const r = rank(i);
    if (r !== undefined) cands.push([r, i]);
  }
  cands.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let added = 0;
  for (const [r, i] of cands) {
    if (added >= target) break;
    if (place(i, r)) added++;
  }
  return added;
}

/** Randzelle auf der Grundstücksseite in Richtung `dir`. */
function onSide(grid: PlotGrid, i: number, dir: HorizontalDir): boolean {
  switch (dir) {
    case 'north': return grid.z(i) === grid.minZ;
    case 'south': return grid.z(i) === grid.minZ + grid.d - 1;
    case 'west': return grid.x(i) === grid.minX;
    case 'east': return grid.x(i) === grid.minX + grid.w - 1;
  }
}

// ==================================================================== Felder

interface FieldGeometry {
  readonly ring: readonly number[];
  readonly interior: readonly number[];
  /** Zugangszelle außen → Torzelle im Zaunring + Blickrichtung nach außen. */
  readonly gates: ReadonlyMap<number, { readonly gate: number; readonly facing: HorizontalDir }>;
}

function fieldGeometry(grid: PlotGrid, cells: readonly number[], walkable: (i: number) => boolean, enclosed = true): FieldGeometry {
  const set = new Set(cells);
  const isRing = (i: number): boolean => grid.n4(i).length < 4 || grid.n4(i).some((j) => !set.has(j));
  let ring = enclosed ? cells.filter(isRing) : [];
  let interior = enclosed ? cells.filter((i) => !isRing(i)) : [...cells];
  if (interior.length < 2) {
    ring = [];
    interior = [...cells];
  }
  const ringSet = new Set(ring);
  const gates = new Map<number, { gate: number; facing: HorizontalDir }>();
  for (const r of ring) {
    const x = grid.x(r);
    const z = grid.z(r);
    for (const [dx, dz, dir] of N4) {
      const o = grid.at(x + dx, z + dz);
      const inner = grid.at(x - dx, z - dz);
      const side1 = grid.at(x + dz, z + dx);
      const side2 = grid.at(x - dz, z - dx);
      if (o < 0 || set.has(o) || !walkable(o)) continue;
      if (inner < 0 || !set.has(inner) || ringSet.has(inner)) continue;
      if (side1 < 0 || side2 < 0 || !ringSet.has(side1) || !ringSet.has(side2)) continue;
      if (!gates.has(o)) gates.set(o, { gate: r, facing: dir });
    }
  }
  if (ring.length === 0) {
    // ohne Zaun: Zugang von jeder freien Nachbarzelle
    for (const i of cells) {
      for (const j of grid.n4(i)) if (!set.has(j) && walkable(j) && !gates.has(j)) gates.set(j, { gate: -1, facing: 'north' });
    }
  }
  return { ring, interior, gates };
}

function nearestGate(geo: FieldGeometry, doorDist: Int32Array): number | undefined {
  let best: number | undefined;
  for (const o of geo.gates.keys()) if (best === undefined || doorDist[o]! < doorDist[best]! || (doorDist[o] === doorDist[best] && o < best)) best = o;
  return best;
}

interface FieldCtx {
  readonly surface: string[];
  readonly water: Uint8Array;
  readonly path: Uint8Array;
  /** Q3: Spalten mit Katalog-Objekt (kein Ackerland, keine Früchte, keine Wasserrinne, keine Vogelscheuche). */
  readonly blocked: Uint8Array;
  readonly emit: Emit;
  readonly sky: (i: number) => boolean;
  readonly warnings: string[];
  /** W3-GA (`fences.lanterns: 'gate'`): Laternen nur am Tor, nicht an den Ecken. */
  readonly gateLanterns?: boolean;
}

/**
 * Feld (research/11, Faktencheck Ackerland): Ackerland auf einer Höhe, Wasserrinnen entlang der langen Achse
 * (jede Ackerzelle ≤ 4 Blöcke Chebyshev vom Wasser, gleiche Höhe), Früchte in Bändern zu 3 Reihen,
 * Zaunring mit Tor zum Weg, Laternen auf Eck- und Torpfosten. Unter Dach (kein Himmel) wird nicht gepflanzt.
 */
function layoutField(
  grid: PlotGrid, p: Part, geo: FieldGeometry, gateKey: number | undefined, level: number, rng: Rng, ctx: FieldCtx,
  fine?: { readonly g: Gen; readonly ring: RingOptions; readonly scarecrow: number },
  tiledCrops?: (bands: number) => readonly string[] | undefined,
): FieldLayout {
  const gateInfo = gateKey !== undefined ? geo.gates.get(gateKey) : undefined;
  const gate = gateInfo !== undefined && gateInfo.gate >= 0 ? gateInfo : undefined;
  let entry = -1;
  if (gate !== undefined) {
    const [dx, dz] = DIR_OFFSET[gate.facing];
    entry = grid.idx(grid.x(gate.gate) - dx, grid.z(gate.gate) - dz);
  }
  const farm = geo.interior.filter((i) => i !== entry && ctx.blocked[i] === 0);
  // Q3: Spalten mit Katalog-Objekt bleiben Nutzfläche ohne Frucht (Erde statt Ackerland, keine Rinne).
  for (const i of geo.interior) if (ctx.blocked[i] === 1) ctx.surface[i] = 'ground_dirt';
  // Rinnen quer zur kurzen Achse
  const xs = farm.map((i) => grid.x(i));
  const zs = farm.map((i) => grid.z(i));
  const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
  const vOf = (i: number): number => (alongX ? grid.z(i) : grid.x(i));
  const vs = farm.map(vOf);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const span = vmax - vmin + 1;
  // Wasser nur, wo es eingefasst ist: im Zaunring immer, ohne Zaun nur abseits des Feldrands
  const partSet = new Set(p.cells);
  const contained = (i: number): boolean => geo.ring.length > 0 || grid.n4(i).filter((j) => partSet.has(j)).length === 4;
  const rows = new Set<number>();
  if (span >= 3 && span <= 9) rows.add(vmin + Math.floor((span - 1) / 2));
  else if (span > 9) for (let k = 0; k < Math.ceil(span / 9); k++) rows.add(Math.min(vmin + 4 + 9 * k, vmax));
  const water = new Set(farm.filter((i) => rows.has(vOf(i)) && contained(i)));
  const near = (a: number, b: number): boolean => Math.abs(grid.x(a) - grid.x(b)) <= 4 && Math.abs(grid.z(a) - grid.z(b)) <= 4;
  const hydrated = (i: number): boolean => {
    for (const w of water) if (near(w, i)) return true;
    return false;
  };
  // unregelmäßige Formen: gierig Wasser ergänzen, bis alles bewässert ist (oder kein Platz mehr)
  const hopeless = new Set<number>();
  for (;;) {
    const dry = farm.filter((i) => !water.has(i) && !hopeless.has(i) && !hydrated(i));
    if (dry.length === 0) break;
    const d0 = dry[0]!;
    let best = -1;
    let bestHits = -1;
    for (const c of farm) {
      if (water.has(c) || !contained(c) || !near(c, d0)) continue;
      const hits = dry.filter((i) => i !== c && near(c, i)).length;
      if (hits > bestHits) {
        best = c;
        bestHits = hits;
      }
    }
    if (best < 0) hopeless.add(d0);
    else water.add(best);
  }
  if (hopeless.size > 0) ctx.warnings.push(`Feld ${p.zoneId}: ${hopeless.size} Ackerzellen ohne Wasser in Reichweite (Feld zu schmal – mit Zaunring ab 3 Blöcken Breite)`);
  const bandRole = new Map<number, string>();
  // feat/tiled-wfc: Frucht je Band aus dem Tiled-WFC (Nachbarbänder verschieden, Folge gespiegelt)
  const planned = tiledCrops?.(Math.ceil(span / 3));
  planned?.forEach((r, b) => bandRole.set(b, r));
  const roleFor = (i: number): string => {
    const band = Math.floor((vOf(i) - vmin) / 3);
    let r = bandRole.get(band);
    if (r === undefined) {
      r = rng.pick(CROP_ROLES);
      bandRole.set(band, r);
    }
    return r;
  };
  const farmland: Cell[] = [];
  const crops: { cell: Cell; role: string }[] = [];
  // T2 Vogelscheuche (A6): Zaun + Heuballen + geschnitzter Kürbis nahe der Feldmitte, Blick zum Tor
  let crow = -1;
  if (fine !== undefined && fine.scarecrow > 0 && farm.length >= 25 && new Rng(hashSeed(fine.g.seed, 'decor', 'scarecrow', p.zoneId)).chance(fine.scarecrow)) {
    const cx = farm.reduce((sum, i) => sum + grid.x(i), 0) / farm.length;
    const cz = farm.reduce((sum, i) => sum + grid.z(i), 0) / farm.length;
    const d = (i: number): number => (grid.x(i) - cx) ** 2 + (grid.z(i) - cz) ** 2;
    crow = farm.filter((i) => !water.has(i) && ctx.sky(i)).sort((a, b) => d(a) - d(b) || a - b)[0] ?? -1;
  }
  for (const i of farm) {
    const x = grid.x(i);
    const z = grid.z(i);
    if (water.has(i)) {
      ctx.surface[i] = 'water';
      ctx.water[i] = 1;
      continue;
    }
    if (i === crow) {
      ctx.surface[i] = 'ground_dirt';
      ctx.emit([x, level + 1, z], 'plant', 'fence_outdoor', 'fence');
      ctx.emit([x, level + 2, z], 'plant', 'hay', 'block');
      ctx.emit([x, level + 3, z], 'plant', 'scarecrow_head', 'block', { facing: gate?.facing ?? 'south' });
      continue;
    }
    ctx.surface[i] = 'farmland';
    farmland.push([x, z]);
    if (!ctx.sky(i)) continue;
    const role = roleFor(i);
    if (ctx.emit([x, level + 1, z], 'plant', role as TerrainRole, 'block')) crops.push({ cell: [x, z], role });
  }
  if (entry >= 0) {
    ctx.surface[entry] = 'ground_path';
    ctx.path[entry] = 1;
  }
  const scarecrow = crow >= 0 ? { scarecrow: grid.cell(crow) } : {};
  if (fine !== undefined) {
    // T2: Ring mit Pfosten im Takt bzw. Hecke (Z1/Z3), Tor am Weg (Z4)
    const rr = buildRing(fine.g, geo.ring, gate, level, fine.ring, p.zoneId);
    return {
      zoneId: p.zoneId, level, farmland, crops, fence: rr.fence, lights: rr.lights, posts: rr.posts, ...(rr.slim.length > 0 ? { slimPosts: rr.slim } : {}), hedge: rr.hedge, ...scarecrow,
      water: [...water].sort((a, b) => a - b).map((i) => grid.cell(i)),
      ...(gate !== undefined ? { gate: { cell: grid.cell(gate.gate), facing: gate.facing } } : {}),
    };
  }
  // Zaun, Tor, Laternen
  const ringSet = new Set(geo.ring);
  const fence: Cell[] = [];
  const lights: Vec3[] = [];
  const gateNeighbor = gate !== undefined ? grid.n4(gate.gate).find((j) => ringSet.has(j)) : undefined;
  for (const r of geo.ring) {
    const x = grid.x(r);
    const z = grid.z(r);
    ctx.surface[r] = 'ground_grass';
    if (gate !== undefined && r === gate.gate) {
      ctx.emit([x, level + 1, z], 'plant', 'fence_outdoor', 'fence_gate', { facing: gate.facing });
      continue;
    }
    ctx.emit([x, level + 1, z], 'plant', 'fence_outdoor', 'fence');
    fence.push([x, z]);
    const nb = grid.n4(r).filter((j) => ringSet.has(j));
    const straight = nb.length === 2 && (grid.x(nb[0]!) === grid.x(nb[1]!) || grid.z(nb[0]!) === grid.z(nb[1]!));
    if (ctx.gateLanterns === true ? gate !== undefined && grid.n4(gate.gate).includes(r) : !straight || r === gateNeighbor) {
      if (ctx.emit([x, level + 2, z], 'plant', 'light_outdoor', 'lantern')) lights.push([x, level + 2, z]);
    }
  }
  return {
    zoneId: p.zoneId, level, farmland, crops, fence, lights,
    water: [...water].sort((a, b) => a - b).map((i) => grid.cell(i)),
    ...(gate !== undefined ? { gate: { cell: grid.cell(gate.gate), facing: gate.facing } } : {}),
  };
}

// ==================================================================== Garten, Hof

/** Gartenwege: jede dritte Reihe entlang der langen Achse plus ein Querweg am Anfang (nur ab 3 Reihen Breite). */
function gardenPathCells(grid: PlotGrid, cells: readonly number[]): Set<number> {
  const xs = cells.map((i) => grid.x(i));
  const zs = cells.map((i) => grid.z(i));
  const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
  const uOf = (i: number): number => (alongX ? grid.x(i) : grid.z(i));
  const vOf = (i: number): number => (alongX ? grid.z(i) : grid.x(i));
  const vmin = Math.min(...cells.map(vOf));
  const umin = Math.min(...cells.map(uOf));
  const span = Math.max(...cells.map(vOf)) - vmin + 1;
  if (span < 3) return new Set();
  return new Set(cells.filter((i) => (vOf(i) - vmin) % 3 === 2 || uOf(i) === umin));
}

/**
 * Garten: Beete in Reihen (je Reihe eine Blütenfarbe), Wege dazwischen. Mit `rows` (W3-GA, Modul „Beet-Reihe mit
 * Einfassung“) ohne Zufall: an beiden Enden jeder Reihe ein Kopfbusch, keine Grasbüschel dazwischen; ein Garten ohne
 * Hecke/Zaun (`enclosed` = false) bekommt eine bündige Steinkante (`bed_edge`) als Einfassung.
 */
function layoutGarden(
  grid: PlotGrid, p: Part, paths: ReadonlySet<number>, level: number, rng: Rng,
  ctx: { readonly surface: string[]; readonly path: Uint8Array; readonly blocked: Uint8Array; readonly emit: Emit },
  rows = false, enclosed = false, plan?: GardenPlan,
): void {
  const xs = p.cells.map((i) => grid.x(i));
  const zs = p.cells.map((i) => grid.z(i));
  const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
  const uOf = (i: number): number => (alongX ? grid.x(i) : grid.z(i));
  const vOf = (i: number): number => (alongX ? grid.z(i) : grid.x(i));
  const vmin = Math.min(...p.cells.map(vOf));
  const umin = Math.min(...p.cells.map(uOf));
  const umax = Math.max(...p.cells.map(uOf));
  const warmFirst = rng.chance(0.5);
  const set = new Set(p.cells);
  const isEdge = (i: number): boolean => rows && !enclosed && !paths.has(i) && ctx.path[i] === 0 && ctx.blocked[i] === 0
    && grid.n4(i).length === 4 && grid.n4(i).some((j) => !set.has(j));
  for (const i of p.cells) {
    if (paths.has(i) || ctx.path[i] === 1) {
      ctx.surface[i] = 'ground_path';
      ctx.path[i] = 1;
      continue;
    }
    if (isEdge(i)) {
      ctx.surface[i] = 'bed_edge'; // Einfassung am Gartenrand (bündig, ohne Pflanze)
      continue;
    }
    ctx.surface[i] = 'garden_soil';
    if (ctx.blocked[i] === 1) continue; // Q3: Katalog-Objekt im Beet (keine zweite Pflanze darüber)
    const pos: Vec3 = [grid.x(i), level + 1, grid.z(i)];
    const bedNo = Math.floor((vOf(i) - vmin) / 3);
    const endOfBed = uOf(i) === umin || uOf(i) === umax;
    const flower = plan?.plant.get(i) ?? ((bedNo % 2 === 0) === warmFirst ? 'flower_warm' : 'flower_cool');
    if (rows || plan !== undefined) {
      // Reihe: Kopfbusch an beiden Enden (auch an der Einfassung), sonst die Blume der Reihe
      // Kopf = Ende eines Reihenstücks: in Reihenrichtung liegt Weg, Kante oder Zonenrand daneben
      const bed = (x: number, z: number): boolean => {
        const j = grid.at(x, z);
        return j >= 0 && set.has(j) && !paths.has(j) && ctx.path[j] === 0 && !isEdge(j);
      };
      const [ux, uz] = (plan?.alongX ?? alongX) ? [1, 0] : [0, 1];
      // feat/tiled-wfc: mit Beet-Plan Kopfbusch nur am Zonenrand (nicht an jedem Querweg), sonst die Pflanze des Beets
      const outside = (x: number, z: number): boolean => grid.at(x, z) < 0 || !set.has(grid.at(x, z));
      const head = plan === undefined
        ? !bed(grid.x(i) + ux, grid.z(i) + uz) || !bed(grid.x(i) - ux, grid.z(i) - uz)
        : rows && (outside(grid.x(i) + ux, grid.z(i) + uz) || outside(grid.x(i) - ux, grid.z(i) - uz));
      ctx.emit(pos, 'plant', head ? 'leaves_bush' : flower, 'block');
      continue;
    }
    if (endOfBed && rng.chance(0.5)) ctx.emit(pos, 'plant', 'leaves_bush', 'block');
    else if (rng.chance(0.12)) ctx.emit(pos, 'plant', 'grass_tuft', 'block');
    else ctx.emit(pos, 'plant', flower, 'block');
  }
}

/** Hof ab 20 Zellen: Laternenpfosten in der Zelle nächst dem Schwerpunkt (für Wege gesperrt). */
function yardLamp(grid: PlotGrid, cells: readonly number[], blocked: Uint8Array): void {
  if (cells.length < 20) return;
  const cx = cells.reduce((s, i) => s + grid.x(i), 0) / cells.length;
  const cz = cells.reduce((s, i) => s + grid.z(i), 0) / cells.length;
  let best = cells[0]!;
  let bd = Infinity;
  for (const i of cells) {
    const d = (grid.x(i) - cx) ** 2 + (grid.z(i) - cz) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  blocked[best] = 1;
}

// ==================================================================== Hilfen

function distToBorder(grid: PlotGrid, i: number): number {
  const x = grid.x(i) - grid.minX;
  const z = grid.z(i) - grid.minZ;
  return Math.min(x, z, grid.w - 1 - x, grid.d - 1 - z);
}

/** Weg auf 2 Blöcke verbreitern: je Wegzelle die Nachbarzelle rechts der Laufrichtung (falls frei). */
function widen(grid: PlotGrid, r: readonly number[], ok: (i: number) => boolean, path: Uint8Array): void {
  for (let k = 1; k < r.length; k++) {
    const a = r[k - 1]!;
    const b = r[k]!;
    const dx = grid.x(b) - grid.x(a);
    const dz = grid.z(b) - grid.z(a);
    for (const c of [a, b]) {
      const j = grid.at(grid.x(c) - dz, grid.z(c) + dx);
      if (j >= 0 && ok(j)) path[j] = 1;
    }
  }
}

/**
 * feat/gelaende: Findlinge (Cluster aus Stein und Bruchstein) auf freier Wiese, bevorzugt auf dem Hang; `per100` je 100
 * freie Zellen. Kollidiert nichts (Wege, Pflanzen, Bäume, Zonen, Türen bleiben frei), setzt der Findling bündig auf das Gelände.
 */
function boulders(g: Gen, per100: number): void {
  const { grid, seed, cls, path, struct, profile, plantCol, blocked, surface, top, padDist, doorDist, padWidth, emit } = g;
  const cand: Array<{ i: number; s: number }> = [];
  for (let i = 0; i < grid.size; i++) {
    if (cls[i] !== C.meadow || path[i] === 1 || struct[i] !== 0 || profile[i] === 1 || plantCol[i] === 1 || blocked[i] === 1) continue;
    if (surface[i] !== 'ground_grass' && surface[i] !== 'ground_moss') continue;
    if (padDist[i]! < padWidth + 3 || doorDist[i]! < 4 || distToBorder(grid, i) < 1) continue;
    cand.push({ i, s: hash01(hashSeed(seed, 'boulder'), grid.x(i), grid.z(i)) + 0.05 * (top[i]! - g.building.y0) });
  }
  cand.sort((a, b) => b.s - a.s || a.i - b.i);
  const want = Math.round((per100 * cand.length) / 100);
  const placed: number[] = [];
  const freeCol = (j: number): boolean => j >= 0 && cls[j] === C.meadow && path[j] === 0 && struct[j] === 0 && profile[j] === 0 && plantCol[j] === 0 && blocked[j] === 0;
  for (const { i } of cand) {
    if (placed.length >= want) break;
    if (!freeCol(i) || placed.some((p) => Math.hypot(grid.x(p) - grid.x(i), grid.z(p) - grid.z(i)) < 7)) continue;
    const rng = new Rng(hashSeed(seed, 'boulder-shape', grid.x(i), grid.z(i)));
    const r = rng.chance(0.4) ? 2 : 1;
    const cells: Array<{ j: number; h: number }> = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > r + 0.3 || (d > r - 0.3 && rng.chance(0.4))) continue;
        const j = grid.at(grid.x(i) + dx, grid.z(i) + dz);
        if (!freeCol(j)) continue;
        cells.push({ j, h: d < 0.5 ? 1 + rng.int(1, r) : d <= 1.1 ? 1 + (rng.chance(0.5) ? 1 : 0) : 1 });
      }
    }
    if (cells.length < 2 || !cells.some((c) => c.j === i)) continue;
    const base = Math.max(...cells.map((c) => top[c.j]!));
    for (const { j, h } of cells) {
      for (let y = top[j]! + 1; y <= base + h; y++) {
        const role = rng.chance(0.62) ? 'ground_stone' : 'mound_wall';
        emit([grid.x(j), y, grid.z(j)], 'terrain', role, 'block');
      }
      blocked[j] = 1;
      plantCol[j] = 1;
    }
    placed.push(i);
  }
}
