/**
 * Anwendungsdienst „komplette Base“ (I2): Haus (Hülle, Einrichtung, Licht-Pass) + Gelände (@mcda/terrain) +
 * Bauwerke (@mcda/structures) → EINE Welt über `extraCells`. Die Kontexte bleiben unabhängig voneinander;
 * verbunden werden sie nur hier:
 *  - Gebäude → Gelände: `buildingFromShell` (Grundfläche der untersten Etage, Außentüren, Überstände aller Etagen).
 *  - Bauwerke → Gelände: Grundfläche als Sperrfläche, Tor-Durchgänge und Vortreppen als Durchlass für Wege.
 *  - Gelände → Bauwerke: Höhenfeld `top` als Port `HeightField`; der Fuß jeder Mauerspalte folgt dem Boden.
 * Reihenfolge: Bauwerke auf ebenem Boden (nur für die Grundfläche) → Gelände → Bauwerke auf dem Gelände. Ragt die
 * neue Grundfläche über die erste hinaus (längere Vortreppen am Hang), wird das Gelände einmal neu erzeugt.
 * Gelände-Zellen an Positionen von Bauwerken und Pflanzen auf Bauwerksspalten entfallen (das Bauwerk gewinnt);
 * Bauwerkszellen in der Hülle des Hauses entfallen mit Hinweis.
 *
 * Angedockte Türme (C4, research/18 T1/T3, `attachedTowers`): EIN Plan für drei Kontexte –
 *  - Hülle: `towerAnnexes` macht daraus Anbauten (`ShellAnnex`: Grundriss, Oberkante, Öffnungen je Etage); die Hülle
 *    setzt Türen in die Hauswand und spart das Dach aus (`shellWithTowers`).
 *  - Bauwerk: `attachedTowerSpecs` liest Türen und Oberkante aus `Shell.annexes` → `StructuresInput.annexTowers`.
 *  - Gelände: der Turm-Grundriss zählt zum Gebäude (planiert wie das Haus, keine Pflanzen), die Türen ins Turminnere
 *    sind keine Hausausgänge (keine Wege dorthin).
 */
import type { Project, Shell, ShellAnnex, ShellAnnexOpening, ShellCell } from '@mcda/blueprint';
import type { Catalog, ResolvedTheme } from '@mcda/catalog';
import { CellSet, key3, opposite, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import {
  annexFootprint, annexWallTop, buildStructures, flatGround, type AnnexTowerSpec, type HeightField, type StructuresInput, type StructuresResult,
} from '@mcda/structures';
import {
  NO_STRUCTURES, buildingFromShell, generateSite, type BuildingInfo, type SiteDecorHint, type SiteDecorLevel, type OutdoorPlacement, type SiteLink, type SiteResult, type SiteState, type SiteStructures,
  type Landform, type TerrainStyleDef,
} from '@mcda/terrain';
import type { ExteriorPlacement } from '@mcda/exterior';
import { expandComponent, placeComponent } from '@mcda/furnishing';
import { BRIDGE_MAX_RISE, ENSEMBLE_DEFAULT, bridgeAnnexes, bridgeSpecs, planEnsemble, selectBridges, type EnsembleEdge, type EnsembleOptions, type PlannedBridge } from './ensemble.js';
import { exteriorBuilding, exteriorFor } from './exterior.js';
import { generateWith, shellFor, type BuildOptions, type GeneratedWorld } from './house.js';
import { blockRulesContext } from './blockRules.js';
import { siteDecorContext } from './rules.js';
import { moodOf, themeFor, type PipelineContext } from './world.js';

/**
 * Angedockter Turm (C4, T1 Eckturm / T3 Treppenturm): Gestalt und Hausseite wie `AnnexTowerSpec`, dazu die Öffnungen
 * in der Hauswand je Etage (`ShellAnnexOpening`). Türhöhen, Bodenplatte und Oberkante leitet die Pipeline aus der Hülle ab.
 */
export interface AttachedTower extends Omit<AnnexTowerSpec, 'passages' | 'baseY' | 'contactTop' | 'clearTop' | 'wallTop'> {
  readonly id: string;
  readonly openings?: readonly ShellAnnexOpening[];
}

/** Umgebung des Hauses: Gelände und Bauwerke (beide optional). */
export interface SurroundingsInput {
  /** Gelände (Zustand des Aggregats `Site` aus @mcda/terrain). */
  readonly site?: SiteState;
  /** Geländestil; Standard: `PipelineContext.terrainStyles.get(site.styleId)`. */
  readonly terrainStyle?: TerrainStyleDef;
  /** Bauwerke: Mauerzüge (mit Türmen und Toren) und freistehende Türme. */
  readonly structures?: StructuresInput;
  /** Seed der Bauwerke (Turmhöhe, Turmspitze); Standard: Projekt-Seed. */
  readonly structureSeed?: number;
  /**
   * Additiv (C4): angedockte Türme. `generateBase` leitet die Hülle damit ab (`shellWithTowers`); wer `surroundings`
   * selbst aufruft, übergibt eine so abgeleitete Hülle.
   */
  readonly attachedTowers?: readonly AttachedTower[];
  /**
   * Additiv (F-Ensemble, Feature-Branch): Verbindungsgraph der Base – Brücken aus Obergeschossen zum Wehrgang bzw.
   * Nachbargebäude, Anschlusswege und Rundwege (`plan/spikes/F_ensemble_walkways.md`). Fehlt = `ENSEMBLE_DEFAULT`
   * (aus: bitgleich); `false` = ausdrücklich aus (auch wenn der Standard einmal an ist). Wirkt nur über `generateBase`.
   */
  readonly ensemble?: EnsembleOptions | false;
  /**
   * Feature-Schalter (feat/tiled-wfc, Bericht plan/spikes/F_tiled_wfc.md): Zinnen, Pflaster (Platz, Hof), Beete und
   * Feldbänder aus dem Tiled-WFC mit Gewichten je Theme. Standard {@link TILED_WFC_DEFAULT}; aus = bitgleich.
   */
  readonly tiledWfc?: boolean;
  /**
   * Feature-Schalter (feat/site-decor, Bericht plan/spikes/LV_tiefe_detail.md Hebel 8): Grundstücks-Deko – Holzplatz,
   * Kräuter- und Kürbisbeet, Bank am Weg, Bannermasten am Eingang, Torbogen, Standbilder je Theme, Pferch, Gräber,
   * Bienenhof u. a. (`@mcda/terrain` `siteDecor.ts`). `off` (Standard {@link SITE_DECOR_DEFAULT}) = bitgleich, `some` =
   * wenige Stücke, `rich` = dichter. Wirkt nur mit Gelände (`site`) und Katalog.
   */
  readonly siteDecor?: SiteDecorLevel;
  /**
   * Geländeform (feat/gelaende, Bericht plan/spikes/GEL_gelaende.md): 'natural' | 'dramatic' formen Hang hinter dem Haus
   * mit Stützmauer, Teich, Findlinge, Moos am Sockel. Fehlt sie oder 'flat': bitgleich. Wirkt nur mit `site`.
   */
  readonly landform?: Landform;
}

/** Standard des Schalters `siteDecor` (feat/site-decor): aus, bis das Review es freigibt. */
export const SITE_DECOR_DEFAULT: SiteDecorLevel = 'off';

/** Standard des Schalters `tiledWfc` (feat/tiled-wfc). Einschalten ist ein eigener Schritt nach dem Review. */
const TILED_WFC_DEFAULT = false;

export interface BaseOptions extends BuildOptions, SurroundingsInput {}

export interface Surroundings {
  /** Zusatz-Zellen für `buildWorld(…, extraCells)`: Gelände, Vegetation, Bauwerke (ohne Überschneidungen). */
  readonly cells: readonly ShellCell[];
  /** Katalog-Objekte des Geländes (Q3, `SiteResult.outdoor`): Platzierungen für die Materialisierung. */
  readonly outdoor: readonly OutdoorPlacement[];
  readonly site?: SiteResult;
  readonly structures?: StructuresResult;
  /** Höhenfeld, auf dem die Bauwerke stehen (Gelände `top`, ohne Gelände eben unter der Bodenplatte). */
  readonly ground: HeightField;
  readonly warnings: readonly string[];
  /** Additiv (F-Ensemble): Bericht des Verbindungsgraphen; fehlt, solange der Schalter aus ist. */
  readonly ensemble?: EnsembleReport;
}

/** Bericht des Verbindungsgraphen (F-Ensemble). */
export interface EnsembleReport {
  /** Orte (Knoten). */
  readonly places: number;
  /** Umgesetzte Kanten (vorhandene Wege, Anschlüsse, Rundwege, Brücken). */
  readonly edges: readonly EnsembleEdge[];
  /** Unabhängige Rundwege im umgesetzten Graphen (Kanten − Knoten + Komponenten). */
  readonly loops: number;
  /** Gebaute Brücken: Art, Länge (Zellen), Höhenwechsel (Stufen), Stützen (Spalten). */
  readonly bridges: readonly { readonly id: string; readonly kind: PlannedBridge['kind']; readonly length: number; readonly rise: number; readonly supports: number }[];
  /** Verworfene Brücken mit Grund (Tür nicht möglich, Kollision, Gelände …). */
  readonly dropped: readonly string[];
  /** Zusatzwege: gelegt, neue Wegspalten, ohne Weg. */
  readonly paths: { readonly laid: number; readonly added: number; readonly failed: number };
  /** Anteil der Zusatzkanten (aus dem Seed). */
  readonly loopRatio: number;
  /** Ableitungen (Hülle + Umgebung) bis zum gültigen Stand. */
  readonly rounds: number;
}

export type BaseWorld = GeneratedWorld & { readonly surroundings: Surroundings };

/** Sperrfläche und Durchlässe eines Bauwerks-Ergebnisses für den Gelände-Generator. */
export function structureKeepOut(fort: StructuresResult | undefined): SiteStructures {
  if (fort === undefined) return NO_STRUCTURES;
  const passages: Cell[] = [];
  for (const w of fort.walls) {
    for (const g of w.gates) {
      for (const p of g.passage) passages.push([p[0], p[2]]);
      passages.push(...g.approach);
    }
  }
  return { footprint: CellSet.of(fort.footprint), passages: CellSet.of(passages) };
}

/**
 * Gebäude-Sicht des Geländes, auch mit Keller (BT01, Kerker im Palas): `buildingFromShell` nimmt die unterste
 * Bodenplatte – mit Keller läge das Gelände auf Kellerhöhe und das Haus stünde frei darüber. Hier zählt die Bodenplatte
 * des Erdgeschosses (Etage ≥ 0); die Kellerräume samt Luft gelten als belegt, das Fundament spart sie aus.
 */
export function buildingOf(shell: Shell): BuildingInfo {
  const rooms = [...shell.rooms.values()];
  const cellars = rooms.filter((r) => r.floorIndex < 0);
  const upper = rooms.filter((r) => r.floorIndex >= 0);
  if (cellars.length === 0 || upper.length === 0) return buildingFromShell(shell);
  const ground = Math.min(...upper.map((r) => r.baseY - 1));
  // Zellen der Kellerräume zählen nicht zur Gebäude-Sicht (Überstand, Öffnungen): ein Unterbau über den Hausgrundriss
  // hinaus (feat/underground) verschiebt weder Grundstück noch Zonen und sperrt keine Pflanzen über sich. Heute liegen
  // alle Kellerzellen unter dem Grundriss des Erdgeschosses – dort zählten sie nie als Überstand: bitgleich.
  const below = new Set(cellars.map((r) => r.roomId));
  const b = buildingFromShell({ ...shell, cells: shell.cells.filter((c) => !(c.kind === 'floor' && c.pos[1] < ground) && !(c.roomId !== undefined && below.has(c.roomId) && c.pos[1] < ground)) });
  const occupied = new Set([...b.occupied, ...shell.cells.map((c) => key3(c.pos))]);
  // Bodenplatte eines Kellers mit: dort fehlen Zellen nur, wo eine Treppe von tiefer heraufkommt (Unterbau,
  // feat/underground) – das Fundament darf die Treppenöffnung nicht füllen. Ohne tiefere Etage bitgleich.
  for (const r of cellars) for (const [x, z] of r.interior) for (let y = r.baseY - 1; y < Math.min(ground, r.baseY + r.height); y++) occupied.add(key3([x, y, z]));
  // Treppenöffnungen in der Erdgeschoss-Platte gehören zur Grundfläche (sonst füllt das Gelände sie)
  const footprint = upper.filter((r) => r.baseY - 1 === ground).reduce((f, r) => f.union(r.interior), b.footprint);
  // Unterbau außerhalb der Grundfläche (feat/underground): das Gelände bleibt über seiner Decke (Hanglage)
  const minTop = new Map<string, number>();
  for (const c of shell.cells) {
    if (c.roomId === undefined || !below.has(c.roomId) || c.pos[1] >= ground || footprint.has(c.pos[0], c.pos[2])) continue;
    const k = `${c.pos[0]},${c.pos[2]}`;
    minTop.set(k, Math.max(minTop.get(k) ?? -Infinity, c.pos[1] + 1));
  }
  return { ...b, footprint, covered: b.covered.difference(footprint), occupied, ...(minTop.size > 0 ? { minTop } : {}) };
}

/** Höhenfeld aus dem Gelände: oberste Geländezelle je Spalte, außerhalb des Grundstücks `fallback`. */
export function siteHeightField(site: SiteResult, fallback: number): HeightField {
  return {
    groundY: (x, z) => {
      const i = site.grid.at(x, z);
      return i < 0 ? fallback : site.top[i]!;
    },
  };
}

// ---------------------------------------------------------------------------------------------- angedockte Türme

/** Y der Bodenplatte je Etage (aus der Raumsicht der Hülle). */
function floorLevels(shell: Shell): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of shell.rooms.values()) out.set(r.floorIndex, Math.min(out.get(r.floorIndex) ?? Infinity, r.baseY - 1));
  return out;
}

/** Bodenplatte des Turms: Boden der untersten Öffnung, ohne Öffnungen der des Erdgeschosses. */
function towerBase(t: AttachedTower, floors: ReadonlyMap<number, number>): number | undefined {
  const ys = (t.openings ?? []).flatMap((o) => floors.get(o.floorIndex) ?? []);
  return ys.length > 0 ? Math.min(...ys) : floors.get(0);
}

const N4: readonly Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Anbauten der Hülle für angedockte Türme, gemessen an der Hülle OHNE diese Anbauten (`plain`): Grundriss, Öffnungen und
 * Oberkante (`annexWallTop`: Geschosse, oberste Tür + 1 Geschoss, Wand bis zur höchsten Hauszelle neben dem Grundriss,
 * Auskragendes über der höchsten Hauszelle im Ring r + 2). Die Hülle mit Anbau hat dort höchstens dieselben Zellen
 * (Aussparung und gesperrte Wände nehmen nur weg) – der Turm passt deshalb auch zu ihr.
 */
export function towerAnnexes(plain: Shell, towers: readonly AttachedTower[]): ShellAnnex[] {
  const floors = floorLevels(plain);
  return towers.map((t) => {
    const cells = annexFootprint(t);
    const foot = CellSet.of(cells);
    const reach = Math.max(...cells.map(([x, z]) => Math.max(Math.abs(x - t.center[0]), Math.abs(z - t.center[1])))) + 2;
    let contactTop = -Infinity;
    let clearTop = -Infinity;
    for (const { pos: [x, y, z] } of plain.cells) {
      if (foot.has(x, z)) continue;
      if (Math.max(Math.abs(x - t.center[0]), Math.abs(z - t.center[1])) <= reach) clearTop = Math.max(clearTop, y);
      if (N4.some(([dx, dz]) => foot.has(x + dx, z + dz))) contactTop = Math.max(contactTop, y);
    }
    const baseY = towerBase(t, floors);
    const facing = opposite(t.side) as HorizontalDir;
    const passages = (t.openings ?? []).flatMap((o) => {
      const y0 = floors.get(o.floorIndex);
      return y0 === undefined ? [] : [{ pos: [o.at[0], y0 + 1, o.at[1]] as Vec3, facing }];
    });
    const top = annexWallTop({ ...t, ...(baseY !== undefined ? { baseY } : {}), passages, contactTop, clearTop });
    return { id: t.id, footprint: foot, top, ...(t.openings !== undefined ? { openings: t.openings } : {}) };
  });
}

/** Hülle mit angedockten Türmen (zwei Ableitungen: ohne sie messen, mit ihnen bauen); ohne Türme = `shellFor`. */
export function shellWithTowers(project: Project, opts: BuildOptions, towers: readonly AttachedTower[] = [], theme?: ResolvedTheme): Shell {
  const plain = shellFor(project, opts, theme);
  if (towers.length === 0) return plain;
  return shellFor(project, { ...opts, annexes: [...(opts.annexes ?? []), ...towerAnnexes(plain, towers)] }, theme);
}

/**
 * Bauwerks-Vorgaben der angedockten Türme aus der fertigen Hülle: Türen (Höhe, Blick hinein) und Oberkante aus
 * `Shell.annexes`, Bodenplatte aus den Etagen. Türme ohne gültigen Anbau (Hülle hat ihn verworfen) entfallen mit Hinweis.
 */
export function attachedTowerSpecs(shell: Shell, towers: readonly AttachedTower[]): { readonly specs: AnnexTowerSpec[]; readonly warnings: string[] } {
  const floors = floorLevels(shell);
  const specs: AnnexTowerSpec[] = [];
  const warnings: string[] = [];
  for (const t of towers) {
    const info = shell.annexes?.find((a) => a.id === t.id);
    if (info === undefined) {
      warnings.push(`Turm ${t.id}: kein gültiger Anbau am Haus (Grundriss über Räumen oder ohne Kontakt) – nicht gebaut`);
      continue;
    }
    const { openings: _, ...style } = t;
    const baseY = towerBase(t, floors);
    specs.push({
      ...style, ...(baseY !== undefined ? { baseY } : {}), wallTop: info.top,
      passages: info.doors.map((d) => ({ pos: [d.at[0], d.y, d.at[1]] as Vec3, facing: d.facing })),
    });
  }
  return { specs, warnings };
}

/**
 * F-Ensemble: Brückentüren (Anbauten `ens-…`) liegen im Obergeschoss – sie sind keine Ausgänge für das Gelände (sonst
 * begänne unter der Brücke ein Weg). Ohne solche Anbauten unverändert.
 */
function withoutBridgeDoors(building: BuildingInfo, shell: Shell): BuildingInfo {
  const bridges = (shell.annexes ?? []).filter((a) => a.id.startsWith('ens-'));
  if (bridges.length === 0) return building;
  const upper = new Set(bridges.flatMap((a) => a.doors.map((d) => `${d.at[0]},${d.at[1]}`)));
  return { ...building, doors: building.doors.filter((d) => !upper.has(`${d.cell[0]},${d.cell[1]}`)) };
}

/** Gebäude-Sicht des Geländes mit angedockten Türmen: Grundriss gehört zum Gebäude, Turmtüren sind keine Ausgänge. */
function withTowers(building: BuildingInfo, shell: Shell, specs: readonly AnnexTowerSpec[]): BuildingInfo {
  const annexes = (shell.annexes ?? []).filter((a) => specs.some((s) => s.id === a.id));
  if (annexes.length === 0) return building;
  const inner = new Set(annexes.flatMap((a) => a.doors.map((d) => `${d.at[0]},${d.at[1]}`)));
  return {
    ...building,
    footprint: annexes.reduce((f, a) => f.union(a.footprint), building.footprint),
    doors: building.doors.filter((d) => !inner.has(`${d.cell[0]},${d.cell[1]}`)),
  };
}

/**
 * Gelände und Bauwerke um ein Haus (rein, deterministisch). Ohne Gelände stehen Bauwerke eben unter der
 * Bodenplatte des Hauses (wie `flatGround()` bei y0 = 0).
 * `opts.exterior` (additiv, X1): Außen-Komponenten gelten als belegt (Gelände und Bauwerke setzen dort nichts),
 * ihre bodennahen Spalten tragen keine Pflanzen, Hindernisse in Laufhöhe keine Wege (`exteriorBuilding`).
 */
export function surroundings(
  shell: Shell,
  input: SurroundingsInput,
  opts: {
    readonly seed: number;
    readonly terrainStyles?: ReadonlyMap<string, TerrainStyleDef>;
    readonly exterior?: readonly ExteriorPlacement[];
    /** Q3: Komponenten-Katalog der Gelände-Objekte (fehlt er, bleibt das Gelände ohne Katalog-Objekte). */
    readonly catalog?: Catalog;
    /** Q3: Zielversion als DataVersion für die Verfügbarkeitsprüfung der Komponenten. */
    readonly dataVersion?: number;
    /** F-Ensemble: Zusatzwege des Verbindungsgraphen für das Gelände (fehlt = keine) und Höchstzahl der Rundwege. */
    readonly links?: readonly SiteLink[];
    readonly maxLoops?: number;
    /** feat/tiled-wfc: Theme für die Kachelgewichte (nur mit `tiledWfc`). */
    readonly themeId?: string;
    /** feat/site-decor: Theme und Hinweise aus dem Raumprogramm für die Grundstücks-Deko (nur mit `siteDecor`). */
    readonly decor?: { readonly themeId?: string | undefined; readonly hints?: readonly SiteDecorHint[] | undefined };
  },
): Surroundings {
  const warnings: string[] = [];
  const tiled = (input.tiledWfc ?? TILED_WFC_DEFAULT) ? { ...(opts.themeId !== undefined ? { themeId: opts.themeId } : {}) } : undefined;
  // Angedockte Türme (C4): Vorgaben aus der Hülle, zuerst gebaut; ihr Grundriss gehört fürs Gelände zum Gebäude
  const attached = attachedTowerSpecs(shell, input.attachedTowers ?? []);
  warnings.push(...attached.warnings.map((w) => `Bauwerke: ${w}`));
  const structures: StructuresInput | undefined = attached.specs.length === 0 ? input.structures
    : { ...(input.structures ?? {}), annexTowers: [...attached.specs, ...(input.structures?.annexTowers ?? [])] };
  const plainHouse = withoutBridgeDoors(buildingOf(shell), shell);
  const house = attached.specs.length === 0 ? plainHouse : withTowers(plainHouse, shell, attached.specs);
  const { building, obstacles } = exteriorBuilding(house, opts.exterior ?? []);
  const withObstacles = (k: SiteStructures): SiteStructures => {
    const o = obstacles.isEmpty ? k : { ...k, footprint: k.footprint.union(obstacles) };
    return opts.links === undefined ? o : { ...o, links: opts.links, ...(opts.maxLoops !== undefined ? { maxLoops: opts.maxLoops } : {}) };
  };
  const seed = input.structureSeed ?? opts.seed;
  // Turm-Grundrisse zählen fürs Gelände zum Gebäude: dort endet das Gelände (Fundament) unter der Bodenplatte, die
  // Platte selbst setzt der Turm – sein Höhenfeld liegt deshalb dort höchstens eine Ebene unter dem Hausboden
  const towerCols = attached.specs.length === 0 ? CellSet.empty() : house.footprint.difference(plainHouse.footprint);
  const onGround = (g: HeightField): HeightField =>
    towerCols.isEmpty ? g : { groundY: (x, z) => (towerCols.has(x, z) ? Math.min(g.groundY(x, z), building.y0 - 1) : g.groundY(x, z)) };
  const build = (ground: HeightField): StructuresResult | undefined =>
    structures !== undefined ? buildStructures(structures, { ground: onGround(ground), seed, ...(tiled !== undefined ? { tiled } : {}) }) : undefined;

  let site: SiteResult | undefined;
  let ground: HeightField;
  let fort: StructuresResult | undefined;
  if (input.site === undefined) {
    ground = flatGround(building.y0 - 1);
    fort = build(ground);
  } else {
    const style = input.terrainStyle ?? opts.terrainStyles?.get(input.site.styleId);
    if (style === undefined) throw new Error(`Geländestil '${input.site.styleId}' unbekannt (PipelineContext.terrainStyles oder terrainStyle angeben)`);
    // 1. Grundfläche der Bauwerke auf ebenem Boden (Gelände in Höhe der Bodenplatte), 2. Gelände, 3. Bauwerke darauf
    const propOptions = {
      ...(opts.catalog === undefined ? {} : { catalog: opts.catalog, ...(opts.dataVersion !== undefined ? { dataVersion: opts.dataVersion } : {}) }),
      ...(tiled !== undefined ? { tiled } : {}),
      ...((input.siteDecor ?? SITE_DECOR_DEFAULT) !== 'off'
        ? { siteDecor: { level: input.siteDecor ?? SITE_DECOR_DEFAULT, themeId: opts.decor?.themeId, hints: opts.decor?.hints } } : {}),
      ...(input.landform !== undefined && input.landform !== 'flat' ? { landform: input.landform } : {}),
    };
    const flatFort = build(flatGround(building.y0));
    let keep = withObstacles(structureKeepOut(flatFort));
    // F-Ensemble: Stützen einer Brücke stehen in einer Zone (Hof) – ihre Spalten gehören nicht zur Zone (kein Hinweis
    // „Zellen ausgelassen“); ohne Brücken unverändert
    const posts = CellSet.of((flatFort?.bridges ?? []).flatMap((b) => b.supports));
    const siteState = posts.isEmpty || !input.site.zones.some((z) => z.cells.intersects(posts)) ? input.site
      : { ...input.site, zones: input.site.zones.map((z) => (z.cells.intersects(posts) ? { ...z, cells: z.cells.difference(posts) } : z)) };
    site = generateSite(siteState, style, building, keep, propOptions);
    ground = siteHeightField(site, building.y0);
    fort = build(ground);
    if (fort !== undefined && fort.footprint.some(([x, z]) => !keep.footprint.has(x, z))) {
      const next = structureKeepOut(fort);
      keep = {
        footprint: keep.footprint.union(next.footprint), passages: (keep.passages ?? CellSet.empty()).union(next.passages ?? CellSet.empty()),
        ...(keep.links !== undefined ? { links: keep.links } : {}), ...(keep.maxLoops !== undefined ? { maxLoops: keep.maxLoops } : {}),
      };
      site = generateSite(siteState, style, building, keep, propOptions);
      ground = siteHeightField(site, building.y0);
      fort = build(ground);
    }
    warnings.push(...site.warnings.map((w) => `Gelände: ${w}`));
  }

  let fortCells: readonly ShellCell[] = [];
  if (fort !== undefined) {
    warnings.push(...fort.warnings.map((w) => `Bauwerke: ${w}`));
    fortCells = fort.cells.filter((c) => !building.occupied.has(key3(c.pos)));
    const lost = fort.cells.length - fortCells.length;
    if (lost > 0) warnings.push(`Bauwerke: ${lost} Blöcke überschneiden das Haus und entfallen`);
  }
  const fortPos = new Set(fortCells.map((c) => key3(c.pos)));
  const fortCols = CellSet.of(fort?.footprint ?? []);
  const siteCells = (site?.cells ?? []).filter((c) => !fortPos.has(key3(c.pos)) && !(c.kind === 'plant' && fortCols.has(c.pos[0], c.pos[2])));
  // Q3: Bauwerke gewinnen auch gegen Gelände-Objekte. Der Grundriss ist schon Sperrfläche, aber Auskragungen
  // (Wehrgang, Zinnen, Vortreppen) reichen darüber hinaus – solche Objekte entfallen ganz (kein halbes Objekt).
  const catalog = opts.catalog;
  const outdoor = (site?.outdoor ?? []).filter((p) => {
    if (fortPos.size === 0) return true;
    if (catalog === undefined) return !fortCols.has(p.cell[0], p.cell[1]);
    const placed = placeComponent(expandComponent(catalog.get(p.componentId), p.variantId), p.pose);
    return !placed.cells.some((c) => fortPos.has(key3(c.pos)));
  });
  return {
    cells: [...siteCells, ...fortCells],
    outdoor,
    ...(site !== undefined ? { site } : {}),
    ...(fort !== undefined ? { structures: fort } : {}),
    ground: onGround(ground),
    warnings,
  };
}

/** Theme und Raumhinweise der Grundstücks-Deko (nur bei eingeschaltetem `siteDecor`; sonst `undefined`, bitgleich). */
function decorOf(project: Project, opts: SurroundingsInput): { readonly themeId?: string; readonly hints: readonly SiteDecorHint[] } | undefined {
  if ((opts.siteDecor ?? SITE_DECOR_DEFAULT) === 'off') return undefined;
  return siteDecorContext(project.state);
}

/**
 * Komplette Base in einem Schritt: Hülle ableiten, alle Räume auf allen Etagen einrichten, Licht-Pass (auf dem
 * Haus), Gelände + Bauwerke erzeugen und alles zusammen materialisieren. Warnungen aller Kontexte stehen in
 * `warnings` (Gelände/Bauwerke mit Präfix), Details in `lighting` und `surroundings`.
 */
export function generateBase(project: Project, base: PipelineContext, opts: BaseOptions = {}): BaseWorld {
  // W3-BL: Block-Regeln gelten auch für Außen-Deko und Gelände-Objekte (Auswahl) – bitgleich ohne Regeln
  const ctx = blockRulesContext(base, opts.blockRules);
  // F-Ensemble (Feature-Branch): mit Schalter eigener Weg, ohne Schalter unverändert (bitgleich)
  const ensemble = opts.ensemble === false ? undefined : opts.ensemble ?? ENSEMBLE_DEFAULT;
  if (ensemble !== undefined) return ensembleBase(project, ctx, opts, ensemble);
  const shell = shellWithTowers(project, opts, opts.attachedTowers, themeFor(project, ctx));
  // X1: Außen-Komponenten vor dem Gelände planen – das Gelände muss sie als belegt kennen. Die Schornsteine (nach der
  // Einrichtung in `generateWith`) liegen auf dem Dach; alles Bodennahe ist in beiden Plänen zellgleich.
  const early = opts.exterior !== undefined ? exteriorFor(project, shell, ctx.catalog, opts.exterior, moodOf(project, ctx)).placements : undefined;
  const around = surroundings(shell, opts, {
    seed: project.state.seed,
    ...(ctx.terrainStyles !== undefined ? { terrainStyles: ctx.terrainStyles } : {}),
    ...(early !== undefined ? { exterior: early } : {}),
    // Q3: Gelände-Objekte aus dem Katalog (Zonen fordern Tags an, research/56 §4)
    catalog: ctx.catalog,
    dataVersion: project.state.targetVersion.dataVersion,
    themeId: project.state.themeId,
    ...(decorOf(project, opts) !== undefined ? { decor: decorOf(project, opts)! } : {}),
  });
  const world = generateWith(project, ctx, shell, opts, [...around.cells, ...(opts.extraCells ?? [])], around.outdoor);
  return { ...world, warnings: [...world.warnings, ...around.warnings], surroundings: around };
}

// ------------------------------------------------------------------------------------------------ F-Ensemble

/** Positionen aller Zellen einer Brücke samt Laufraum (Füße bis Kopffreiheit) aus dem Bauwerks-Ergebnis. */
function bridgeSpace(fort: StructuresResult, id: string): { readonly blocks: Vec3[]; readonly walk: Vec3[] } {
  const owner = `fort:${id}`;
  const info = fort.bridges?.find((b) => b.id === owner);
  return {
    blocks: fort.cells.filter((c) => c.roomId === owner).map((c) => c.pos),
    walk: (info?.path ?? []).flatMap(([x, y, z]) => [[x, y, z], [x, y + 1, z], [x, y + 2, z]] as Vec3[]),
  };
}

/**
 * `generateBase` mit Verbindungsgraph: Plan auf der Hülle ohne Brücken und den Bauwerken auf ebenem Boden, dann
 * Hülle mit Brückentüren (Anbauten) → Umgebung mit Brücken und Zusatzwegen → Prüfung. Eine Brücke, deren Tür die Hülle
 * nicht setzt, die das Bauwerk nicht bauen kann oder die mit Haus, Außen-Deko oder Gelände kollidiert, entfällt; dann
 * wird neu abgeleitet (jede Runde entfällt mindestens eine, also endet die Schleife).
 */
function ensembleBase(project: Project, ctx: PipelineContext, opts: BaseOptions, options: EnsembleOptions): BaseWorld {
  const r = resolveEnsemble(project, ctx, opts, options);
  const world = generateWith(project, ctx, r.shell, opts, [...r.around.cells, ...(opts.extraCells ?? [])], r.around.outdoor);
  return { ...world, warnings: [...world.warnings, ...r.around.warnings], surroundings: r.around };
}

/** Ergebnis des Verbindungsgraphen vor der Einrichtung: Hülle mit Brückentüren und Umgebung samt Bericht. */
export interface EnsembleResolution {
  readonly shell: Shell;
  readonly around: Surroundings & { readonly ensemble: EnsembleReport };
}

/**
 * Verbindungsgraph auflösen (F-Ensemble): Hülle mit den Brückentüren und Umgebung mit Brücken und Zusatzwegen, geprüft
 * (siehe `ensembleBase`). Ohne Einrichtung – `generateBase` richtet danach auf `shell` ein; die App (`shellOf`,
 * `baseWorldOf`) nutzt dieselbe Auflösung, damit App und Engine gleich bauen. `ctx` wie in `generateBase` (mit den
 * Block-Regeln aus `opts.blockRules`).
 */
export function resolveEnsemble(project: Project, ctx: PipelineContext, opts: BaseOptions, options: EnsembleOptions): EnsembleResolution {
  const theme = themeFor(project, ctx);
  const towers = opts.attachedTowers ?? [];
  const bare = shellFor(project, opts, theme);
  const towerAnn = towers.length === 0 ? [] : towerAnnexes(bare, towers);
  const shellWith = (extra: readonly ShellAnnex[]): Shell => (towerAnn.length + extra.length === 0 ? bare
    : shellFor(project, { ...opts, annexes: [...(opts.annexes ?? []), ...towerAnn, ...extra] }, theme));
  const plain = shellWith([]);
  const seed = opts.structureSeed ?? project.state.seed;
  const building0 = buildingOf(plain);
  const flatFort = opts.structures !== undefined ? buildStructures(opts.structures, { ground: flatGround(building0.y0 - 1), seed }) : undefined;
  const plan = planEnsemble({
    project, shell: plain, building: building0, ...(flatFort !== undefined ? { fort: flatFort } : {}), ...(opts.site !== undefined ? { site: opts.site } : {}),
    seed: project.state.seed, options,
  });
  let bridges = [...plan.bridges];
  const dropped: string[] = [];
  // Verworfene Kandidaten; je Paar höchstens MAX_TRIES Versuche, dann entfällt die Brücke dieses Paars
  const MAX_TRIES = 3;
  const excluded = new Set<string>();
  const tries = new Map<string, number>();
  const reject = (failed: readonly PlannedBridge[]): void => {
    for (const b of failed) {
      excluded.add(b.key);
      tries.set(b.pair, (tries.get(b.pair) ?? 0) + 1);
      if ((tries.get(b.pair) ?? 0) >= MAX_TRIES) for (const c of plan.bridgeCandidates) if (c.pair === b.pair) excluded.add(c.key);
    }
    bridges = selectBridges(plan.bridgeCandidates, excluded);
  };
  for (let round = 1; ; round++) {
    const shell = shellWith(bridgeAnnexes(bridges));
    // 1. Türen: jede Öffnung muss in der Hülle eine Tür geworden sein
    const noDoor = bridges.filter((b) => [`${b.id}-a`, ...(b.end !== undefined ? [`${b.id}-b`] : [])]
      .some((id) => (shell.annexes?.find((a) => a.id === id)?.doors.length ?? 0) === 0));
    if (noDoor.length > 0) {
      dropped.push(...noDoor.map((b) => `${b.key}: keine Tür in der Hülle`));
      reject(noDoor);
      continue;
    }
    // 2. Umgebung mit Brücken und Zusatzwegen
    const early = opts.exterior !== undefined ? exteriorFor(project, shell, ctx.catalog, opts.exterior).placements : undefined;
    const structures: StructuresInput | undefined = bridges.length === 0 ? opts.structures
      : { ...(opts.structures ?? {}), bridges: bridgeSpecs(bridges, options) };
    const around = surroundings(shell, { ...opts, ...(structures !== undefined ? { structures } : {}) }, {
      seed: project.state.seed,
      ...(ctx.terrainStyles !== undefined ? { terrainStyles: ctx.terrainStyles } : {}),
      ...(early !== undefined ? { exterior: early } : {}),
      catalog: ctx.catalog,
      dataVersion: project.state.targetVersion.dataVersion,
      ...(decorOf(project, opts) !== undefined ? { decor: decorOf(project, opts)! } : {}),
      ...(plan.links.length > 0 && opts.site !== undefined ? { links: plan.links, maxLoops: plan.maxLoops } : {}),
    });
    // 3. Prüfung: gebaut, keine Überschneidung mit Haus oder Außen-Deko, Laufraum frei von Gelände und Pflanzen
    const fort = around.structures;
    const house = new Set(shell.cells.map((c) => key3(c.pos)));
    const deco = new Set((early ?? []).flatMap((p) => p.cells.map(key3)));
    const site = new Set((around.site?.cells ?? []).map((c) => key3(c.pos)));
    const bad: string[] = [];
    for (const b of bridges) {
      const info = fort?.bridges?.find((x) => x.id === `fort:${b.id}`);
      if (info === undefined || !info.built) {
        bad.push(`${b.key}: ${info?.reason ?? 'nicht gebaut'}`);
        continue;
      }
      // Höhenwechsel auf dem echten Gelände (der Plan rechnet auf ebenem Boden)
      const rise = info.path[info.path.length - 1]![1] - info.path[0]![1];
      if (Math.abs(rise) > (options.maxRise ?? BRIDGE_MAX_RISE)) {
        bad.push(`${b.key}: ${Math.abs(rise)} Stufen auf dem Gelände (höchstens ${options.maxRise ?? BRIDGE_MAX_RISE})`);
        continue;
      }
      const { blocks, walk } = bridgeSpace(fort!, b.id);
      const hit = [...blocks, ...walk].find((p) => house.has(key3(p)) || deco.has(key3(p)));
      if (hit !== undefined) bad.push(`${b.key}: Kollision mit dem Haus bei ${hit.join(',')}`);
      else if (walk.some((p) => site.has(key3(p)))) bad.push(`${b.key}: Gelände/Pflanzen im Laufraum`);
    }
    if (bad.length > 0) {
      dropped.push(...bad);
      reject(bridges.filter((b) => bad.some((m) => m.startsWith(`${b.key}:`))));
      continue;
    }
    // 4. Bericht
    const linkResults = around.site?.links ?? [];
    const realized: EnsembleEdge[] = [
      ...plan.edges.filter((e) => e.kind === 'existing'),
      ...plan.linkEdges.filter((_, i) => linkResults[i] !== undefined && linkResults[i]!.skipped !== true),
      ...bridges.map((b): EnsembleEdge => ({ a: b.from, b: b.to, kind: b.kind, length: b.length })),
    ];
    const nodes = new Set(realized.flatMap((e) => [e.a, e.b]));
    const parent = new Map([...nodes].map((n) => [n, n] as const));
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
    let comps = nodes.size;
    for (const e of realized) {
      const ra = find(e.a);
      const rb = find(e.b);
      if (ra !== rb) {
        parent.set(ra, rb);
        comps--;
      }
    }
    const report: EnsembleReport = {
      places: plan.places.length,
      edges: realized,
      loops: realized.length - nodes.size + comps,
      bridges: bridges.map((b) => {
        const info = fort!.bridges!.find((x) => x.id === `fort:${b.id}`)!;
        return { id: b.id, kind: b.kind, length: info.path.length, rise: info.path[info.path.length - 1]![1] - info.path[0]![1], supports: info.supports.length / 2 };
      }),
      dropped,
      paths: {
        laid: linkResults.filter((r) => r !== undefined && r.skipped !== true).length,
        added: linkResults.reduce((n, r) => n + (r?.added ?? 0), 0),
        failed: linkResults.filter((r, i) => r === undefined && plan.links[i]?.loop !== true).length,
      },
      loopRatio: plan.loopRatio,
      rounds: round,
    };
    return { shell, around: { ...around, ensemble: report } };
  }
}
