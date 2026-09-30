/**
 * Use Case „Umgebung berechnen“: Gelände + Bauwerke um das Haus über den Anwendungsdienst (`surroundings` aus
 * @mcda/pipeline) und die gemeinsame Welt aus Haus und Umgebung für Vorschau „Blöcke“/„Texturen“ und Export
 * (`buildWorld(project, ctx, shell, extraCells)` – dieselbe Kette wie `generateBase`, nur ohne neu einzurichten,
 * denn die Einrichtung steht schon im Projekt). Rein bis auf kleine Zwischenspeicher.
 *
 * Leistung: Die Umgebung hängt nur an (a) ihrem eigenen Zustand und (b) der Sicht des Geländes auf das Gebäude
 * (`buildingFromShell`: Grundfläche, Türen, Überstände, belegte Zellen, dazu die bodennahen Teile der Außen-Deko).
 * (b) ist ein Hash über die Hüllzellen des Hauses und die Zellen der Außen-Deko ohne Dachteile – Möbel-, Licht-,
 * Theme- und Versions-Aktionen ändern ihn nicht (Schornsteine folgen der Einrichtung, liegen aber auf dem Dach),
 * dann wird nichts neu berechnet.
 */
import { DomainError, type Project, type ProjectState, type Shell, type ShellCell } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import type { CellSet } from '@mcda/core';
import {
  blockRulesContext, buildWorld, fitExterior, parapetSpecsFor, roomCellsOf, siteDecorContext, surroundings, type ExteriorPlacement, type PipelineContext, type Surroundings, type SurroundingsInput, type SurfaceTextureSwitch, type WeatheringSwitch, type World,
} from '@mcda/pipeline';
import { structuresInput } from '@mcda/projectfile';
import type { TerrainStyleDef } from '@mcda/terrain';
import { roleColor, type Rgb } from './colors.js';
import { worldOf } from './exporting.js';
import { hasSurroundings, siteOf, type SurroundingsState } from './surroundings.js';
import { attachedTowersOf, configureEnsemble, ensembleOfSession, exteriorOf, groundExterior, selectionCatalog, shellOf, shellThemeOf, styleKey, type ShellStyle } from './usecases.js';
import { FULL, SHELL_LAYER, box, centered, voxel, type PreviewVoxel, type UnitBox } from './viewer/voxels.js';

/** Bauwerke der Sitzung als Eingabe des Kontexts Bauwerke: gemeinsam mit der Engine-API (@mcda/projectfile). */
export { structuresInput };

/**
 * Eingabe des Anwendungsdienstes; `undefined`, wenn nichts zu bauen ist (Gelände aus, keine Bauwerke). Der Stil geht
 * unverändert hinein – Vegetationsdichte und Beleuchtung stehen im Gelände-Zustand und wirken im Generator.
 */
export function surroundingsInput(
  sur: SurroundingsState | undefined,
  styles: ReadonlyMap<string, TerrainStyleDef>,
  shell?: Shell,
  volumeOfRoom?: (roomId: string) => string | undefined,
  /** Raumzellen je Raum (BT01): die Wehrplatte sitzt bündig auf der Außenkante der Dachplatte. */
  cellsOfRoom?: (roomId: string) => CellSet | undefined,
): SurroundingsInput | undefined {
  if (!hasSurroundings(sur)) return undefined;
  const site = sur.terrain ? siteOf(sur) : undefined;
  // BT01: Wehrplatten sind an einen Baukörper gebunden – Spalten und Höhe kommen **jetzt** aus der Hülle, damit die
  // Zinnen mitwandern, wenn Etagen radiert oder Grundrisse verkleinert werden (Auftrag BT01). Welcher Raum zu welchem
  // Baukörper gehört, weiß das Projekt (nicht die Hülle).
  const structures = structuresInput(sur, shell === undefined ? undefined : (item) =>
    item.volumeId === undefined ? undefined : parapetSpecsFor(shell, [item as { volumeId: string }], volumeOfRoom, cellsOfRoom)[0]);
  const attachedTowers = attachedTowersOf(sur);
  let terrain: Pick<SurroundingsInput, 'site' | 'terrainStyle'> = {};
  if (site !== undefined) {
    const style = styles.get(site.styleId);
    if (style === undefined) throw new DomainError('site.style', `Geländestil „${site.styleId}“ unbekannt (catalog/terrain) – bitte einen anderen wählen`);
    terrain = { site, terrainStyle: style };
  }
  // feat/gelaende: Geländeform der Umgebung (fehlt oder 'flat' = wie bisher); wirkt nur mit Gelände
  const landform = site !== undefined && sur.landform !== undefined && sur.landform !== 'flat' ? sur.landform : undefined;
  return {
    ...terrain, ...(structures !== undefined ? { structures } : {}), ...(attachedTowers.length > 0 ? { attachedTowers } : {}),
    ...(landform !== undefined ? { landform } : {}),
    // feat/site-decor: Grundstücks-Deko (fehlt = aus, bitgleich)
    ...(sur.siteDecor !== undefined ? { siteDecor: sur.siteDecor } : {}),
    // WS-Verwitterung: erzählende Verwitterung (fehlt = aus, bitgleich)
    ...(sur.weathering !== undefined ? { weathering: sur.weathering } : {}),
    // TX-B: Oberflächen-Textur (fehlt = aus, bitgleich)
    ...(sur.surfaceTexture !== undefined ? { surfaceTexture: sur.surfaceTexture } : {}),
  };
}

// ---------------------------------------------------------------------------------------------- Zwischenspeicher

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;
function idOf(o: object): number {
  let id = objectIds.get(o);
  if (id === undefined) objectIds.set(o, (id = nextObjectId++));
  return id;
}

/** Doppelter FNV-artiger Hash über Textstücke → kurzer Schlüssel `n:h1:h2`. */
function hashKey(parts: Iterable<string>): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  let n = 0;
  for (const s of parts) {
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 0x01000193);
      h2 = Math.imul(h2 ^ ch, 0x5bd1e995);
      h2 ^= h2 >>> 13;
    }
    n++;
  }
  return `${n}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

const buildingKeys = new WeakMap<Shell, string>();

/** Schlüssel der Gebäude-Sicht: Hash über alle Hüllzellen des Hauses (Lage, Art, Außen, Tür-Ausrichtung). */
export function buildingKey(shell: Shell): string {
  let key = buildingKeys.get(shell);
  if (key === undefined) {
    key = hashKey(
      (function* () {
        for (const c of shell.cells) {
          if (c.kind === 'terrain' || c.kind === 'plant' || c.kind === 'fort') continue;
          yield `${c.pos[0]},${c.pos[1]},${c.pos[2]},${c.kind},${c.exterior === true ? 1 : 0},${c.orient?.facing ?? ''},${c.orient?.half ?? ''};`;
        }
      })(),
    );
    buildingKeys.set(shell, key);
  }
  return key;
}

/** Schlüssel der Außen-Deko für das Gelände: Hash über die belegten Zellen (leer = „-“). */
export function exteriorKey(exterior: readonly ExteriorPlacement[]): string {
  return exterior.length === 0 ? '-' : hashKey(exterior.flatMap((p) => p.cells.map((c) => `${c[0]},${c[1]},${c[2]};`)));
}

interface AroundEntry {
  readonly key: string;
  readonly result: Surroundings;
}
/** Raum → Baukörper (BT01 Wehrplatten): die Hülle kennt keine Baukörper, das Projekt schon. */
export const volumeOf = (state: ProjectState): ((roomId: string) => string | undefined) => {
  const byId = new Map(state.rooms.map((r) => [r.id, r.volumeId] as const));
  return (roomId) => byId.get(roomId);
};

/** Zuletzt berechnete Umgebungen (klein: Undo/Redo und Wechsel zwischen Ansichten treffen). */
const recentAround: AroundEntry[] = [];
const RECENT_AROUND = 6;

/** feat/site-decor: Theme und Raumhinweise der Grundstücks-Deko (wie die Engine: `siteDecorContext` aus @mcda/pipeline). */
export type SiteDecorContext = ReturnType<typeof siteDecorContext>;

/** Hinweise der Deko für den Zwischenspeicher – nur mit eingeschalteter Deko, sonst `-` (Schlüssel wie bisher). */
const decorKey = (sur: SurroundingsState, decor: SiteDecorContext | undefined): string =>
  sur.siteDecor === undefined || decor === undefined ? '-' : `${sur.siteDecor}:${decor.hints.join(',')}`;

const aroundKey = (
  shell: Shell, sur: SurroundingsState, styles: ReadonlyMap<string, TerrainStyleDef>, seed: number, exterior: readonly ExteriorPlacement[],
  catalog?: Catalog, dataVersion?: number, themeId?: string, decor?: SiteDecorContext,
): string =>
  `${idOf(sur)}|${idOf(styles)}|${seed}|${buildingKey(shell)}|${exteriorKey(exterior)}|${catalog === undefined ? '-' : idOf(catalog)}|${dataVersion ?? 0}|${themeId ?? '-'}|${decorKey(sur, decor)}`;

/** Schon berechnete Umgebung (ohne zu rechnen) – für die Anzeige ohne Flackern nach Undo/Redo. */
export function cachedSurroundings(
  shell: Shell, sur: SurroundingsState | undefined, styles: ReadonlyMap<string, TerrainStyleDef>, seed: number, exterior: readonly ExteriorPlacement[] = [],
  catalog?: Catalog, dataVersion?: number, themeId?: string, decor?: SiteDecorContext,
): Surroundings | undefined {
  if (!hasSurroundings(sur)) return undefined;
  const key = aroundKey(shell, sur, styles, seed, exterior, catalog, dataVersion, themeId, decor);
  return recentAround.find((e) => e.key === key)?.result;
}

/**
 * Gelände + Bauwerke um das Haus (Anwendungsdienst `surroundings`), zwischengespeichert je Umgebungszustand,
 * Gebäude-Sicht, Seed, Stil-Katalog, Außen-Deko und Komponenten-Katalog. `exterior`: bodennahe Außen-Teile
 * (`groundExterior`) – das Gelände setzt dort nichts, davor keine Pflanzen und Wege. `catalog`/`dataVersion` (Q3):
 * Quelle und Zielversion der Katalog-Objekte des Geländes. `undefined`, wenn nichts zu bauen ist. Wirft bei
 * unbekanntem Geländestil.
 */
export function surroundingsOf(
  shell: Shell, sur: SurroundingsState | undefined, styles: ReadonlyMap<string, TerrainStyleDef>, seed: number, exterior: readonly ExteriorPlacement[] = [],
  volumeOfRoom?: (roomId: string) => string | undefined,
  cellsOfRoom?: (roomId: string) => CellSet | undefined,
  catalog?: Catalog,
  dataVersion?: number,
  /** feat/tiled-wfc: Theme für die Kachelgewichte (wie `generateBase`: Projekt-Theme). */
  themeId?: string,
  /** feat/site-decor: Theme und Raumhinweise (`siteDecorContext(project.state)`), nur mit `sur.siteDecor` wirksam. */
  decor?: SiteDecorContext,
): Surroundings | undefined {
  if (!hasSurroundings(sur)) return undefined;
  const key = aroundKey(shell, sur, styles, seed, exterior, catalog, dataVersion, themeId, decor);
  const i = recentAround.findIndex((e) => e.key === key);
  if (i >= 0) {
    const [hit] = recentAround.splice(i, 1);
    recentAround.unshift(hit!);
    return hit!.result;
  }
  const result = surroundings(shell, surroundingsInput(sur, styles, shell, volumeOfRoom, cellsOfRoom)!, {
    seed, terrainStyles: styles, ...(exterior.length > 0 ? { exterior } : {}),
    ...(catalog !== undefined ? { catalog } : {}), ...(dataVersion !== undefined ? { dataVersion } : {}),
    ...(themeId !== undefined ? { themeId } : {}),
    ...(sur.siteDecor !== undefined && sur.siteDecor !== 'off' && decor !== undefined ? { decor } : {}),
  });
  recentAround.unshift({ key, result });
  recentAround.length = Math.min(recentAround.length, RECENT_AROUND);
  return result;
}

interface WorldEntry {
  readonly ctx: PipelineContext;
  readonly state: ProjectState;
  readonly style: string;
  readonly around: Surroundings;
  /** WS-Verwitterung: Stufe (die Umgebung selbst ändert sich mit ihr nicht). */
  readonly weathering: string;
  readonly world: World;
}
const recentWorlds: WorldEntry[] = [];
const RECENT_WORLDS = 2;

/** WS-Verwitterung: Kontext mit dem Schalter (ohne Schalter derselbe Kontext, bitgleich). */
const weatheredCtx = (ctx: PipelineContext, level: WeatheringSwitch | undefined, texture?: SurfaceTextureSwitch): PipelineContext => {
  const w = level === undefined || level === 'off' ? ctx : { ...ctx, weathering: level };
  // TX-B: Oberflächen-Textur im Kontext (ohne Schalter derselbe Kontext, bitgleich)
  return texture === undefined || texture === 'off' ? w : { ...w, surfaceTexture: texture };
};
/** Zwischenspeicher-Schlüssel der Schalter Verwitterung + Oberflächen-Textur. */
const switchKey = (sur: SurroundingsState | undefined): string => `${sur?.weathering ?? '-'}|${sur?.surfaceTexture ?? '-'}`;

interface HouseEntry { readonly ctx: PipelineContext; readonly state: Project['state']; readonly style: string; readonly level: string; readonly world: World }
const recentHouses: HouseEntry[] = [];

/** Haus allein mit erzählender Verwitterung (Umgebung leer, Schalter an): wie `worldOf`, nur mit dem Schalter im Kontext. */
function weatheredHouseOf(project: Project, ctx: PipelineContext, style: ShellStyle, sur: SurroundingsState): World {
  const level = switchKey(sur);
  const key = styleKey(style);
  const hit = recentHouses.find((w) => w.ctx === ctx && w.state === project.state && w.style === key && w.level === level);
  if (hit !== undefined) return hit.world;
  const ruled = weatheredCtx(blockRulesContext(ctx, style.blockRules), sur.weathering, sur.surfaceTexture);
  const world = buildWorld(project, ruled, shellOf(project, style, shellThemeOf(ctx.catalog, project.state.themeId)), [], exteriorOf(project, ctx.catalog, style)?.placements ?? []);
  recentHouses.unshift({ ctx, state: project.state, style: key, level, world });
  recentHouses.length = Math.min(recentHouses.length, RECENT_WORLDS);
  return world;
}

/**
 * Blöcke von Haus + Umgebung als EINE Welt (Vorschau „Blöcke“/„Texturen“, Export). Ohne Umgebung dieselbe Welt wie
 * `worldOf` (Haus allein, auch dessen Zwischenspeicher). Die Außen-Deko (`exteriorOf`) kennt das Gelände als belegt
 * (ohne Dachteile, wie `generateBase`); was dennoch mit Gelände oder Bauwerken zusammenfiele, entfällt (`fitExterior`).
 * Die Platform-Daten der Zielversion müssen geladen sein.
 */
export function baseWorldOf(
  project: Project, ctx: PipelineContext, style: ShellStyle, sur: SurroundingsState | undefined, styles: ReadonlyMap<string, TerrainStyleDef>,
): World & { readonly surroundings?: Surroundings } {
  // F-Ensemble: mit Verbindungsgraph Hülle und Umgebung aus derselben Auflösung wie `generateBase` (Brücken, Wege)
  configureEnsemble(ctx, styles);
  // ohne Umgebung (Vorschau „Haus allein“) auch ohne Auflösung – dann gilt die Hülle aus `shellOf` (mit Brückentüren)
  const ensemble = hasSurroundings(sur) ? ensembleOfSession(project, style) : undefined;
  const shell = ensemble?.shell ?? shellOf(project, style);
  const plan = exteriorOf(project, ctx.catalog, style);
  // W3-BL: Gelände-Objekte aus der Sicht der Block-Regeln, Materialisierung mit Ersatz (wie `generateBase`)
  const around = ensemble !== undefined ? ensemble.around : surroundingsOf(shell, sur, styles, project.state.seed, groundExterior(plan), volumeOf(project.state), roomCellsOf(project.state), selectionCatalog(ctx.catalog, style), project.state.targetVersion.dataVersion, project.state.themeId, siteDecorContext(project.state));
  if (around === undefined || around.cells.length === 0) return sur?.weathering === undefined && sur?.surfaceTexture === undefined ? worldOf(project, ctx, style) : weatheredHouseOf(project, ctx, style, sur!);
  const key = styleKey(style);
  const hit = recentWorlds.find((w) => w.ctx === ctx && w.state === project.state && w.style === key && w.around === around && w.weathering === switchKey(sur));
  if (hit !== undefined) return hit.world;
  // Umgebung mitgeben (W3-BL): die Materialliste weist Haus und Gelände getrennt aus (`materialList`)
  const world = {
    ...buildWorld(project, weatheredCtx(blockRulesContext(ctx, style.blockRules), sur?.weathering, sur?.surfaceTexture), shell, around.cells, fitExterior(plan?.placements ?? [], around.cells).placements, around.outdoor),
    surroundings: around,
  };
  recentWorlds.unshift({ ctx, state: project.state, style: key, around, weathering: switchKey(sur), world });
  recentWorlds.length = Math.min(recentWorlds.length, RECENT_WORLDS);
  return world;
}

// ---------------------------------------------------------------------------------------------- Vorschau „Rollen“

/** Flächenfarben der Außen-Rollen (Gelände inkl. T2-Feinschliff, Pflanzen, Bauwerke) für 2D-Plan und Rollen-Vorschau. */
export const OUTDOOR_COLORS: Readonly<Record<string, Rgb>> = {
  ground_grass: 0x6d9b43,
  ground_dirt: 0x8a6240,
  ground_stone: 0x7d7d7d,
  ground_moss: 0x59752c,
  mound_wall: 0x77776f,
  ground_path: 0xb09a64,
  ground_yard: 0x9c9a92,
  garden_soil: 0x5c3f28,
  farmland: 0x70492a,
  water: 0x3f76e4,
  pond_bed: 0x8a7a5a,
  foundation: 0x8c8c8c,
  fence_outdoor: 0x8a6a40,
  light_outdoor: 0xffd27a,
  log_oak: 0x6b5233,
  log_birch: 0xd8d3c4,
  log_spruce: 0x4a3622,
  leaves_oak: 0x4f7a28,
  leaves_birch: 0x6f9a3a,
  leaves_spruce: 0x3a5a34,
  leaves_bush: 0x46702a,
  flower_wild: 0xe8c840,
  flower_warm: 0xe0603c,
  flower_cool: 0x8a78e8,
  grass_tuft: 0x74a444,
  ground_cover: 0xe8a8c8,
  pond_plant: 0x4a8a3a,
  crop_wheat: 0xd0b848,
  crop_carrot: 0xe08a30,
  crop_potato: 0xa8a040,
  crop_beetroot: 0xa03040,
  path_main: 0x8f8a80,
  path_edge: 0x9c8c62,
  path_stone: 0xa2a2a2,
  path_gutter: 0x77777a,
  plaza_accent: 0xb0a080,
  paddock_ground: 0x7f6a48,
  bed_edge: 0x8a8378,
  fence_post: 0x6b5233,
  hedge: 0x3f6a26,
  leaves_fruit: 0x5a8a30,
  light_hidden: 0xffe08a,
  well_stone: 0x8c8c8c,
  well_roof: 0x7a5534,
  woodpile: 0x7a5a36,
  barrel_outdoor: 0x8b5a2b,
  beehive: 0xd8b060,
  hay: 0xd8c040,
  scarecrow_head: 0xe08a30,
  planter: 0x7a5534,
  trough: 0x6b5233,
  parapet: 0xa9a49b,
  walkway: 0x8f8a82,
  fort_base: 0x8d8a84, // Sockelgeschoss der Mauertürme (W7-B), grau wie wall_plinth
  // W9-G5 (Materialspiel): Holzdach der Mauertürme, Hurde am Torbau, Zinnenkappen – Fichte
  roof_tower: 0x6b4a2b,
  hoarding: 0x7a5534,
  crown_cap: 0x7a5534,
  tower_floor: 0xa0703f,
  arrow_slit: 0x3a3a3a,
  sail: 0xece4d4,
  bell: 0xe0b030,
};

export function outdoorColor(role: string): Rgb {
  return OUTDOOR_COLORS[role] ?? roleColor(role);
}

const LOW_PLANT = /^(flower_|grass_tuft|crop_|pond_plant)/;

function outdoorBox(c: ShellCell): UnitBox {
  if (c.role === 'ground_cover') return box(0, 0, 0, 1, 0.07, 1);
  if (c.kind === 'plant' && LOW_PLANT.test(c.role)) return centered(0.5, 0, 0.6);
  switch (c.shape) {
    case 'fence':
    case 'fence_gate':
      return centered(0.25, 0, 1);
    case 'slab':
      return c.orient?.half === 'top' || c.orient?.half === 'upper' ? box(0, 0.5, 0, 1, 1, 1) : box(0, 0, 0, 1, 0.5, 1);
    case 'lantern':
      return centered(0.375, 0, 0.5625);
    case 'wall':
      return centered(0.5, 0, 1); // Mauerkranz des Brunnens (well_stone)
    default:
      return FULL;
  }
}

/**
 * Quader der Rollen-Vorschau für die Umgebung. Vom Gelände nur die Oberfläche (unter `top` sieht man nichts),
 * Pflanzen und Bauwerke ganz. Herkunft: Bauwerke `fort:<id>` (Klick wählt das Bauwerk), Gelände ohne.
 */
export function surroundingsVoxels(around: Surroundings): PreviewVoxel[] {
  const site = around.site;
  const out: PreviewVoxel[] = [];
  for (const c of around.cells) {
    if (c.kind === 'terrain' && site !== undefined) {
      const i = site.grid.at(c.pos[0], c.pos[2]);
      if (i >= 0 && c.pos[1] < site.top[i]!) continue;
    }
    out.push(voxel(c.pos, outdoorBox(c), outdoorColor(c.role), SHELL_LAYER[c.kind], c.kind === 'fort' ? c.roomId : undefined));
  }
  return out;
}
