/**
 * Anwendungsdienst „Projekt aus Bautyp“ (research/19 §7.3, §7.7): Bautyp + Parameter + Seed → Bauplan (@mcda/archetype)
 * → Projekt in EINEM Schritt (`Project.applyBuildingType`, ein Undo, `origin` am Projekt und `origin: 'type'` an den
 * Räumen) → Stil (`build`) und Umgebung (`surroundings`: Gelände mit Vorlage und Zonen, Bauwerke). Damit wird jeder
 * Bautyp headless zu einer Welt: `generateBase(project, ctx, { ...build, ...surroundings })`.
 */
import { planBuilding, planDraft, type BuildingParams, type BuildingPlan, type PlanShell, type PlanSiteZone } from '@mcda/archetype';
import { DEFAULT_VOLUME, Project, TARGET_VERSIONS, type BuildingTypeOrigin, type FacadeRhythm, type InteriorDecor, type ProjectState, type Shell, type StoryState, type TargetVersion } from '@mcda/blueprint';
import { roomTypeFitsStyles, type BuildingTypeDef } from '@mcda/catalog';
import { CellSet, type Cell, type HorizontalDir, type MoodVector, type PaletteOverrides } from '@mcda/core';
import type { ExteriorStyle } from '@mcda/exterior';
import {
  buildStructures, flatGround, ringAround, type ParapetBinding, type ParapetSpec, type RingLayout, type StructuresInput, type StructuresResult,
} from '@mcda/structures';
import { SITE_TEMPLATES, Site, plotAround, type BuildingInfo, type Landform, type Plot, type SiteTemplateId, type ZoneKind } from '@mcda/terrain';
import { buildingOf, type BaseOptions, type SurroundingsInput } from './base.js';
import { shellFor } from './house.js';
import { archetypeContext, catalogMinArea, settingBuildable, withFacadeRhythm } from './rules.js';
import { paletteOverrideProblems } from './paletteEditor.js';
import { themeFor, themeWith, type PipelineContext } from './world.js';
import { applyNewProjectMood } from './mood.js';

/**
 * Theme ohne Angabe, wenn der Bautyp keines nennt (Beispielhaus, Halle, Zweistöckig) – wie ein neues Projekt der App
 * (`DEFAULT_THEME`). W7-E: vorher das erste des Katalogs in Sortierreihenfolge, also `desert` – die Engine baute
 * „ein gemütliches Haus“ aus Sandstein.
 */
export const FALLBACK_THEME_ID = 'medieval';

/** Anzeigenamen der Lagen für Hinweise (W7-E). */
const SETTING_NAMES: Readonly<Record<string, string>> = {
  cliff: 'am Hang', carved: 'in den Fels gehauen', stilts: 'auf Stelzen', tree: 'im Baum', water: 'am Wasser', underwater: 'unter Wasser',
};

/**
 * Hinweis, wenn eine verlangte Lage noch nicht gebaut wird (W7-E, W1-G offener Punkt 1): Die Domäne baut nur
 * `BUILDABLE_SETTINGS` (`settingBuildable`, rules.ts); alles andere entsteht ebenerdig – das steht dann im Ergebnis
 * statt still. `undefined` = baubar oder keine Lage.
 */
export function settingNote(kind: string | undefined): string | undefined {
  if (kind === undefined || settingBuildable(kind)) return undefined;
  return `Lage „${SETTING_NAMES[kind] ?? kind}“ (${kind}) ist noch nicht baubar – ebenerdig gebaut`;
}

export interface BuildingTypeParams extends BuildingParams {
  /** Standard: erstes passendes Theme des Bautyps, sonst {@link FALLBACK_THEME_ID}, sonst das erste des Katalogs. */
  readonly themeId?: string;
  /** Farbpalette (Q4, research/54 §3.3); unbekannt oder fehlend = Theme unverändert. */
  readonly paletteId?: string;
  /**
   * W13-G: Paletten-Überschreibungen vor dem Generieren (Familie je Rollengruppe, Familien-Tausch); fehlend = Theme bzw.
   * Palette unverändert (bitgleich).
   */
  readonly paletteOverrides?: PaletteOverrides;
  /** Nutzungszustand (Q5/P15, research/55 §2); fehlend = keine Story-Spuren (bitgleich). */
  readonly storyState?: StoryState;
  /** feat/theme-moods: Stimmung (Schalter + Werte, `{}` = Theme-Vorgabe); fehlend = keine (bitgleich). */
  readonly mood?: MoodVector;
  /** feat/int-decor: Innen-Deko-Stufe (`some` | `rich`); fehlend = keine Zusatz-Deko (bitgleich). */
  readonly interiorDecor?: InteriorDecor;
  readonly targetVersion?: TargetVersion;
  readonly projectId?: string;
  /** Gelände und Bauwerke anlegen (Standard true). */
  readonly surroundings?: boolean;
  /**
   * Geländeform (feat/gelaende): 'natural' | 'dramatic' = Hang hinter dem Haus mit Stützmauer, Teich, Findlinge, Moos am
   * Sockel, dichtere Bepflanzung; Bautypen ohne eigenes Grundstück bekommen dafür eines. Fehlend oder 'flat': bitgleich.
   */
  readonly landform?: Landform;
  /**
   * Fassadenrhythmus (WS-Fassade): 'on' = Fensterachsen im Takt auf flachen Wänden (Mittelachse bzw. Tür als Hauptachse,
   * spiegelsymmetrisch) und Gauben auf leeren Dachflächen. Fehlend oder 'off': bitgleich.
   */
  readonly facadeRhythm?: FacadeRhythm;
  /** Neu würfeln: Zähler in `origin` (anderer Grundriss, gleicher Projekt-Seed). */
  readonly rerollCount?: number;
}

export interface BuildingTypeResult {
  readonly project: Project;
  readonly plan: BuildingPlan;
  /** Stil für `shellFor`/`generateBase`: Dach, Details, Gauben, Außenprofil, Fenster, Flur-Rollen, Außengestaltung. */
  readonly build: BaseOptions;
  /** Gelände (Zustand des Aggregats) und Bauwerke; leer ohne `site`/`structures` im Bautyp. */
  readonly surroundings: SurroundingsInput;
  /** Gelände-Aggregat (für den Umgebungsmodus der App), falls angelegt. */
  readonly site?: Site;
  /** Hinweise (Stil passt nicht zum Theme, Silhouette, weggelassene Wunschräume). */
  readonly notes: readonly string[];
}

/** Mindestfläche je Raumtyp aus dem Katalog (W6: Regel in `rules.ts`, hier weiter exportiert). */
export { catalogMinArea };

const DIR_OFFSET: Readonly<Record<HorizontalDir, Cell>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Stil des Plans → Optionen des Anwendungsdienstes (wie `shellOptions` + `exteriorOptions` der App). */
export function planBuildOptions(plan: BuildingPlan): BaseOptions {
  const s = plan.shell;
  const exterior: ExteriorStyle | undefined = plan.exterior === undefined ? undefined
    : {
      density: plan.exterior.density, ...Object.fromEntries(plan.exterior.off.map((g) => [g, false])),
      ...(plan.exterior.windowModule !== undefined ? { windowModule: plan.exterior.windowModule } : {}),
      ...(plan.exterior.entranceModule !== undefined ? { entranceModule: plan.exterior.entranceModule } : {}),
      ...(plan.exterior.themeMaterial !== undefined ? { themeMaterial: plan.exterior.themeMaterial } : {}),
    };
  return {
    roof: s.roof,
    overhang: s.overhang,
    windows: s.windows,
    ...(s.roofDetail !== undefined ? { roofDetail: s.roofDetail } : {}),
    ...(s.dormers !== undefined ? { dormers: s.dormers } : {}),
    ...(s.facade !== undefined ? { facade: s.facade } : {}),
    ...(plan.corridorTypes !== undefined ? { corridorTypes: plan.corridorTypes } : {}),
    ...(plan.loopDoors !== undefined ? { loopDoors: plan.loopDoors } : {}),
    ...(exterior !== undefined ? { exterior } : {}),
  };
}

/** Haustür der Hülle: Wandzelle und Blickrichtung hinaus (ohne Haustür: Süden, Mitte der Südseite). */
function mainDoor(shell: Shell, building: BuildingInfo): { cell: Cell; out: HorizontalDir } {
  for (const r of shell.rooms.values()) {
    const d = r.doors.find((x) => x.isMain);
    if (d !== undefined) return { cell: [d.inside[0] + DIR_OFFSET[d.toward][0], d.inside[1] + DIR_OFFSET[d.toward][1]], out: d.toward };
  }
  const b = building.footprint.bounds() ?? { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  return { cell: [Math.round((b.minX + b.maxX) / 2), b.maxZ], out: 'south' };
}

/**
 * Zone relativ zur Haustür (vorn = hinaus, links = vom Eingang aus gesehen) neben dem Haus samt Überstand. W16-B: mit
 * `part` (Grundfläche des Ensemble-Teils samt Wand, `partCells`) relativ zu diesem Teil; `align: 'inner'` legt die
 * Breite bündig an das Ende zum übrigen Gebäude.
 */
function zoneCells(z: PlanSiteZone, building: BuildingInfo, door: { cell: Cell; out: HorizontalDir }, partCells?: CellSet): CellSet {
  const F = DIR_OFFSET[door.out];
  const U: Cell = [-F[1], F[0]];
  const local = ([x, z0]: Cell): Cell => [(x - door.cell[0]) * U[0] + (z0 - door.cell[1]) * U[1], (x - door.cell[0]) * F[0] + (z0 - door.cell[1]) * F[1]];
  const whole = building.footprint.union(building.covered);
  const lc = (partCells ?? whole).toArray().map(local);
  const uMin = Math.min(...lc.map((c) => c[0]));
  const uMax = Math.max(...lc.map((c) => c[0]));
  const vMin = Math.min(...lc.map((c) => c[1]));
  const vMax = Math.max(...lc.map((c) => c[1]));
  const gap = z.gap ?? 3;
  // W16-B: Mitte des übrigen Gebäudes quer zur Seite (für `align: 'inner'`)
  const rest = partCells === undefined ? [] : whole.difference(partCells).toArray().map(local);
  const restMid = rest.length === 0 ? 0 : rest.reduce((s, c) => s + c[0], 0) / rest.length;
  const across = (lo: number, hi: number): [number, number] => {
    if (z.width === undefined) return [lo, hi];
    if (z.align === 'inner' && partCells !== undefined) {
      return Math.abs(lo - restMid) <= Math.abs(hi - restMid) ? [lo, lo + z.width - 1] : [hi - z.width + 1, hi];
    }
    const mid = Math.round((lo + hi) / 2);
    return [mid - Math.floor(z.width / 2), mid - Math.floor(z.width / 2) + z.width - 1];
  };
  const [u0, u1, v0, v1] =
    z.at === 'front' ? [...across(uMin, uMax), vMax + gap, vMax + gap + z.depth - 1]
      : z.at === 'back' ? [...across(uMin, uMax), vMin - gap - z.depth + 1, vMin - gap]
        : z.at === 'left' ? [uMax + gap, uMax + gap + z.depth - 1, ...across(vMin, vMax)]
          : [uMin - gap - z.depth + 1, uMin - gap, ...across(vMin, vMax)];
  const out: Cell[] = [];
  for (let u = u0!; u <= u1!; u++) for (let v = v0!; v <= v1!; v++) out.push([door.cell[0] + u * U[0] + v * F[0], door.cell[1] + u * U[1] + v * F[1]]);
  return CellSet.of(out);
}

/** W16-B: Grundfläche eines Ensemble-Teils (Räume seines Baukörpers samt Wandring); unbekannt oder leer: undefined. */
function partFootprint(plan: BuildingPlan, project: Project, partId: string): CellSet | undefined {
  const vid = plan.parts?.find((p) => p.id === partId)?.volumeId;
  if (vid === undefined) return undefined;
  const out: Cell[] = [];
  for (const r of project.state.rooms) {
    if ((r.volumeId ?? 'v0') !== vid) continue;
    for (const [x, z] of r.cells) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) out.push([x + dx, z + dz]);
  }
  return out.length === 0 ? undefined : CellSet.of(out);
}

/** Grundstück, das zusätzlich `cells` mit Rand `margin` umfasst. */
function growPlot(p: Plot, cells: readonly Cell[], margin: number): Plot {
  if (cells.length === 0) return p;
  return {
    minX: Math.min(p.minX, ...cells.map((c) => c[0] - margin)), minZ: Math.min(p.minZ, ...cells.map((c) => c[1] - margin)),
    maxX: Math.max(p.maxX, ...cells.map((c) => c[0] + margin)), maxZ: Math.max(p.maxZ, ...cells.map((c) => c[1] + margin)),
  };
}

/**
 * Wehrplatten (BT01) zu Bindungen auflösen: Zinnenkranz auf dem Flachdach über der **obersten Etage des Baukörpers** –
 * Spalten aus dessen Räumen (der Hülle, nicht einer Kopie), Höhe = oberste Hüllzelle darüber (Dachplatte). Damit
 * wandert die Wehrplatte mit, wenn eine Etage radiert oder der Grundriss verkleinert wird; `cells`/`y` in der
 * Projektdatei sind nur noch Altbestand. Rein und für App und Engine dieselbe Regel.
 */
export function parapetSpecsFor(
  shell: Shell,
  bindings: readonly ParapetBinding[],
  volumeOfRoom?: (roomId: string) => string | undefined,
  cellsOfRoom?: (roomId: string) => CellSet | undefined,
): ParapetSpec[] {
  const rooms = [...shell.rooms.values()];
  const volumeOf = volumeOfRoom ?? ((): string => DEFAULT_VOLUME);
  return bindings.flatMap((b) => {
    const own = rooms.filter((r) => (volumeOf(r.roomId) ?? DEFAULT_VOLUME) === b.volumeId);
    if (own.length === 0) return [];
    const top = Math.max(...own.map((r) => r.floorIndex));
    // Spalten = **Raumzellen** der obersten Etage (nicht `interior`, das den Wandring ausspart): der Zinnenkranz
    // soll bündig auf der Außenkante der Dachplatte sitzen (Review e5108a5, Befund 1). Fehlt der Zugriff auf die
    // Raumzellen (z. B. Aufrufer ohne Projekt), bleibt `interior` der Rückfall – dann steht der Kranz 1 Block innen.
    const cells = own
      .filter((r) => r.floorIndex === top)
      .reduce((u, r) => u.union(cellsOfRoom?.(r.roomId) ?? r.interior), CellSet.empty());
    // Nur Spalten mit Hüllzellen (Dachplatte): der Grundriss kann über die oberste Etage hinausragen
    const y = shell.cells.reduce((m, c) => (cells.has(c.pos[0], c.pos[2]) ? Math.max(m, c.pos[1]) : m), -Infinity);
    if (!Number.isFinite(y)) return [];
    // W4-B: Dachluke der Hülle (`RoofDetail.hatch`) – Leiter bis in die Dachplatte; die Falltür darüber legt die Wehrplatte
    const ladder = shell.cells.find((c) => c.shape === 'ladder' && c.pos[1] === y && c.orient?.facing !== undefined && cells.has(c.pos[0], c.pos[2]));
    return [{
      ...(b.id !== undefined ? { id: b.id } : {}), volumeId: b.volumeId, cells: cells.toArray(), y, ...(b.merlon !== undefined ? { merlon: b.merlon } : {}),
      ...(b.crown !== undefined ? { crown: b.crown } : {}), ...(b.deck !== undefined ? { deck: b.deck } : {}),
      ...(ladder !== undefined ? { hatch: { cell: [ladder.pos[0], ladder.pos[2]] as Cell, facing: ladder.orient!.facing! } } : {}),
    }];
  });
}

/**
 * Wehrplatten der Ensemble-Teile (BT01) aus dem Plan – Bindungen aus den Teilen, dann `parapetSpecsFor`. W3-CA: dazu die
 * des Hauptbaukörpers (Ausguck des Wachturms) sowie Abschluss und Belag (nur gesetzt, wenn gewählt: sonst bitgleich).
 */
function partParapets(plan: BuildingPlan, project: Project, shell: Shell): ParapetSpec[] {
  const bindings: ParapetBinding[] = [
    ...(plan.parapet !== undefined ? [{
      id: 'main-parapet', volumeId: DEFAULT_VOLUME,
      ...(plan.parapet.crown !== 'crenel' ? { crown: plan.parapet.crown } : {}), ...(plan.parapet.deck ? { deck: true } : {}),
    }] : []),
    ...(plan.parts ?? [])
      .filter((p) => p.parapet !== undefined)
      .map((p) => ({
        id: `${p.id}-parapet`, volumeId: p.volumeId,
        ...(p.parapet !== 'crenel' ? { crown: p.parapet! } : {}), ...(p.parapetDeck === true ? { deck: true } : {}),
      })),
  ];
  return parapetSpecsFor(shell, bindings, roomVolumeOf(project.state), roomCellsOf(project.state));
}

/** Raum → Baukörper und Raum → Raumzellen (BT01): beides steht im Projekt, nicht in der Hülle. */
export const roomVolumeOf = (state: ProjectState): ((roomId: string) => string | undefined) => {
  const byId = new Map(state.rooms.map((r) => [r.id, r.volumeId] as const));
  return (roomId) => byId.get(roomId);
};
export const roomCellsOf = (state: ProjectState): ((roomId: string) => CellSet | undefined) => {
  const byId = new Map(state.rooms.map((r) => [r.id, r.cells] as const));
  return (roomId) => byId.get(roomId);
};

/** Ringmauer (BT01) um alle Baukörper, Tor in der Achse der Haustür; dazu Hof- und Graben-Zellen. */
function planRingWalls(plan: BuildingPlan, building: BuildingInfo, door: { cell: Cell; out: HorizontalDir }): RingLayout | undefined {
  const r = plan.ring;
  if (r === undefined) return undefined;
  const core = building.footprint.union(building.covered).union(building.profile ?? CellSet.empty()).bounds();
  if (core === undefined) return undefined;
  return ringAround({
    id: 'ring', core, door, offset: r.offset, height: r.height, thickness: r.thickness, towerSpacing: r.towerSpacing,
    towerStyle: r.towerStyle, merlon: r.merlon, gate: r.gate,
    ...(r.outer !== undefined ? { outer: r.outer } : {}), ...(r.moat !== undefined ? { moat: r.moat } : {}),
    ...(r.accents === true ? { accents: true } : {}),
  });
}

/**
 * Hof (BT01): Innenfläche des Rings ohne Bauwerks-Grundriss (auf ebenem Boden gerechnet) und ohne den Planierring samt
 * Außen-Deko-Streifen ums Gebäude (Planierbreite + 2) – dort entscheidet das Gelände selbst.
 */
function yardCells(ring: RingLayout, building: BuildingInfo, fort: StructuresResult, pad: number): CellSet {
  const foot = CellSet.of(fort.footprint);
  const core = building.footprint.union(building.covered).union(building.profile ?? CellSet.empty()).toArray();
  const near = new Set<string>();
  const d = pad + 2;
  for (const [x, z] of core) for (let dx = -d; dx <= d; dx++) for (let dz = -d; dz <= d; dz++) near.add(`${x + dx},${z + dz}`);
  const out: Cell[] = [];
  const b = ring.inner;
  for (let x = b.minX; x <= b.maxX; x++) for (let z = b.minZ; z <= b.maxZ; z++) if (!foot.has(x, z) && !near.has(`${x},${z}`)) out.push([x, z]);
  // Zwickel zwischen Türmen und Mauer (keine Fläche für einen Hof, kein Weg dorthin) entfallen
  return CellSet.of(out).components().filter((c) => c.size >= 12).reduce((u, c) => u.union(c), CellSet.empty());
}

/** Umgebung des Plans: Gelände (Vorlage, Stil, Beleuchtung, Zonen) und Bauwerke (Windmühle; BT01: Ringmauer, Wehrplatte). */
function planSurroundings(plan: BuildingPlan, project: Project, build: BaseOptions, ctx: PipelineContext, notes: string[], landform?: Landform): { site?: Site; structures?: StructuresInput } {
  const windmills = plan.windmill === undefined ? [] : [{ id: 'windmill', center: plan.windmill.center, levels: plan.windmill.levels, facing: plan.windmill.facing }];
  const fortified = plan.ring !== undefined || plan.parapet !== undefined || (plan.parts ?? []).some((p) => p.parapet !== undefined);
  // F1-Deko des Themes gehört in die Hülle, aus der die Bauwerke gemessen werden (Grundriss bleibt gleich, die
  // Außenprofil-Zellen liegen außerhalb)
  const wantsLand = landform !== undefined && landform !== 'flat';
  const shell = plan.site !== undefined || fortified || wantsLand ? shellFor(project, build, themeFor(project, ctx)) : undefined;
  const building = shell === undefined ? undefined : buildingOf(shell);
  const door = shell === undefined || building === undefined ? undefined : mainDoor(shell, building);
  const ring = building === undefined || door === undefined ? undefined : planRingWalls(plan, building, door);
  const parapets = shell === undefined ? [] : partParapets(plan, project, shell);
  // W12-C: Hochsilo neben der Scheune (Bauernhof L)
  const silos = plan.silo === undefined ? [] : [{ id: 'silo', center: plan.silo.center, radius: plan.silo.radius, height: plan.silo.height }];
  const structures: StructuresInput | undefined = windmills.length === 0 && silos.length === 0 && ring === undefined && parapets.length === 0 ? undefined : {
    ...(windmills.length > 0 ? { windmills } : {}), ...(silos.length > 0 ? { silos } : {}), ...(ring !== undefined ? { walls: ring.walls } : {}),
    ...(parapets.length > 0 ? { parapets } : {}),
  };
  if (shell === undefined || building === undefined || door === undefined || (plan.site === undefined && !wantsLand)) return structures !== undefined ? { structures } : {};
  // feat/gelaende: Bautypen ohne eigenes Grundstück bekommen mit Geländeform eine Wiese rundum
  const planSite = plan.site ?? { margin: 12, zones: [] as NonNullable<BuildingPlan['site']>['zones'] };
  const styles = ctx.terrainStyles ?? new Map();
  let styleId = planSite.style ?? (planSite.template === 'homestead' ? 'homestead' : 'meadow');
  if (!styles.has(styleId)) {
    notes.push(`Geländestil „${styleId}“ fehlt im Katalog – ${[...styles.keys()][0] ?? 'meadow'} statt dessen`);
    styleId = [...styles.keys()][0] ?? 'meadow';
  }
  const site = Site.create({ id: `${project.state.id}-site`, projectId: project.state.id, seed: project.state.seed, styleId, plot: plotAround(building, planSite.margin) });
  if (planSite.template !== undefined && SITE_TEMPLATES.includes(planSite.template as SiteTemplateId)) {
    const kitchen = project.state.rooms.filter((r) => r.floorIndex === 0 && r.roomTypeId === 'kitchen').reduce((acc, r) => acc.union(r.cells), CellSet.empty());
    site.applyTemplate(planSite.template as SiteTemplateId, building, { kitchen, styleId, ...(planSite.lighting !== undefined ? { lighting: planSite.lighting } : {}) });
  } else if (planSite.lighting !== undefined) {
    site.setLighting(planSite.lighting);
  }
  const zones = planSite.zones.map((z) => ({ kind: z.kind as ZoneKind, cells: zoneCells(z, building, door, z.part === undefined ? undefined : partFootprint(plan, project, z.part)) }));
  const mill = plan.windmill === undefined ? [] : [[plan.windmill.center[0] - 6, plan.windmill.center[1] - 6], [plan.windmill.center[0] + 6, plan.windmill.center[1] + 6]] as Cell[];
  if (plan.silo !== undefined) {
    const [sx, sz] = plan.silo.center;
    const e = plan.silo.radius + 3;
    mill.push([sx - e, sz - e], [sx + e, sz + e]);
  }
  let fortArea: Cell[] = [];
  if (ring !== undefined) {
    // Hof und Graben (Teich-Band; eine eigene Zonenart `moat` fehlt dem Gelände noch)
    const pad = ctx.terrainStyles?.get(styleId)?.foundation?.pad ?? 1;
    const fort = buildStructures(structures!, { ground: flatGround(building.y0 - 1), seed: project.state.seed });
    const yard = plan.ring?.yard === undefined ? CellSet.empty() : yardCells(ring, building, fort, pad);
    if (!yard.isEmpty) zones.push({ kind: plan.ring!.yard as ZoneKind, cells: yard });
    if (ring.moat.length > 0) zones.push({ kind: 'pond', cells: CellSet.of(ring.moat) });
    fortArea = [[ring.outer.minX, ring.outer.minZ], [ring.outer.maxX, ring.outer.maxZ]];
  }
  const plot = growPlot(site.state.plot, [...zones.flatMap((z) => z.cells.toArray()), ...mill, ...fortArea], 4);
  if (JSON.stringify(plot) !== JSON.stringify(site.state.plot)) site.resizePlot(plot);
  for (const z of zones) site.paintZone(z.kind, z.cells);
  return { site, ...(structures !== undefined ? { structures } : {}) };
}

/**
 * Angeforderte (nicht aufgelöste) Plan-Parameter in `origin.params.requested` (W2-ED U1, von der App geschrieben):
 * Etagen „Zufall“, Lage, Stil-Vorgaben. Mit den aufgelösten Werten zu planen zöge andere Zufallszahlen.
 */
export interface RequestedPlanParams {
  readonly floors?: number;
  readonly setting?: BuildingParams['setting'];
  readonly shell?: Partial<PlanShell>;
}

/** Herkunft am Projekt: Bautyp, aufgelöste Parameter (samt Lage), Seed, Zähler „neu gewürfelt“; `requested` bleibt. */
function originOf(def: BuildingTypeDef, plan: BuildingPlan, params: BuildingTypeParams, requested?: RequestedPlanParams): BuildingTypeOrigin {
  return {
    buildingTypeId: def.id,
    params: { ...plan.params, ...(params.at !== undefined ? { at: params.at } : {}), ...(requested !== undefined ? { requested } : {}) },
    seed: plan.seed,
    rerollCount: params.rerollCount ?? 0,
  };
}

/**
 * „Grundriss neu würfeln“ (research/19 §7.6) am bestehenden Projekt: nächster Zähler, gleiche Parameter und gleicher
 * Seed; `Project.rerollBuildingType` ersetzt nur unveränderte Bautyp-Räume (Nutzer-Räume bleiben). Liefert den Plan.
 *
 * W3-BL (W2-ED offener Punkt 2): Stehen in der Herkunft die **angeforderten** Parameter (`requested`, App), plant der
 * Neu-Wurf mit ihnen statt mit den aufgelösten – genau wie „Bautyp anpassen“ mit unveränderten Parametern – und die
 * neue Herkunft behält sie. Ohne `requested` (Engine, ältere Projekte) unverändert.
 */
export function rerollBuildingType(project: Project, def: BuildingTypeDef, ctx: PipelineContext): BuildingPlan {
  const o = project.state.origin;
  if (o === undefined || o.buildingTypeId !== def.id) throw new Error(`Projekt stammt nicht aus Bautyp ${def.id}`);
  const { requested, ...stored } = o.params as BuildingTypeParams & { readonly requested?: RequestedPlanParams };
  const resolved: BuildingTypeParams = requested === undefined ? stored : (() => {
    const { floors: _f, setting: _s, shell: _sh, ...rest } = stored;
    return {
      ...rest,
      ...(requested.floors !== undefined ? { floors: requested.floors } : {}),
      ...(requested.setting !== undefined ? { setting: requested.setting } : {}),
      ...(requested.shell !== undefined ? { shell: requested.shell } : {}),
    };
  })();
  const params = { ...resolved, themeId: project.state.themeId, rerollCount: o.rerollCount + 1 };
  const plan = planBuilding(def, { ...params, reroll: params.rerollCount }, project.state.seed, archetypeContext(ctx.catalog, ctx.themes));
  project.rerollBuildingType(planDraft(plan, originOf(def, plan, params, requested)));
  return plan;
}

/**
 * Bautyp auf ein BESTEHENDES Projekt anwenden (`Project.applyBuildingType`, ein Undo): Bautyp-Räume werden ersetzt,
 * Nutzer-Räume bleiben. Seed und Theme kommen aus dem Projekt. Stil (`planBuildOptions(plan)`) setzt der Aufrufer.
 */
export function applyBuildingType(project: Project, def: BuildingTypeDef, params: BuildingTypeParams, ctx: PipelineContext): BuildingPlan {
  const p = { ...params, themeId: project.state.themeId };
  const plan = planBuilding(def, { ...p, reroll: p.rerollCount ?? 0 }, project.state.seed, archetypeContext(ctx.catalog, ctx.themes));
  project.applyBuildingType(planDraft(plan, originOf(def, plan, p)));
  return plan;
}

/**
 * Familien der Zielversion für die Prüfung der Paletten-Überschreibungen. Der Bautyp-Assistent der App plant ohne
 * Plattform-Daten (sein Kontext wirft beim Zugriff): dann prüft `paletteOverrideProblems` Gruppe, Form und Art ohne
 * Version – die Auswahl der App bietet ohnehin nur Familien der Zielversion an.
 */
function familiesOrUndefined(ctx: PipelineContext, version: string) {
  try {
    return ctx.platform(version).families;
  } catch {
    return undefined;
  }
}

/**
 * Projekt aus einem Bautyp (research/19 §7.3): Plan erzeugen und in einem Schritt übernehmen. `seed` ist Projekt- und
 * Plan-Seed (Türen und Wände hängen am Projekt-Seed; der Generator prüft genau dieses Projekt).
 */
export function projectFromBuildingType(def: BuildingTypeDef, params: BuildingTypeParams, seed: number, ctx: PipelineContext): BuildingTypeResult {
  const themes = ctx.themes.ids();
  const themeId = [params.themeId, ...(def.themes ?? []), FALLBACK_THEME_ID].find((t) => t !== undefined && themes.includes(t)) ?? themes[0] ?? FALLBACK_THEME_ID;
  // Farbpalette (Q4, research/54 §3.3): gehört zum Projekt, nicht zum Plan; der Bautyp-Schatten nutzt sie nur,
  // damit die Vorschau (Stil-Ableitung, Umgebung) schon dieselbe Farbwelt zeigt.
  const paletteId = ctx.palettes?.find(params.paletteId)?.id;
  const plan = planBuilding(def, { ...params, themeId, reroll: params.rerollCount ?? 0 }, seed, archetypeContext(ctx.catalog, ctx.themes));
  const project = Project.create({
    id: params.projectId ?? def.id, name: plan.name, seed, themeId, targetVersion: params.targetVersion ?? TARGET_VERSIONS['1.21.11'],
    floor: { y0: 0, height: plan.floors.find((f) => f.index === 0)?.height ?? 3 },
  });
  if (paletteId !== undefined) project.setPalette(paletteId);
  // W13-G: Überschreibungen gehören wie die Palette zum Projekt (Normalform; leer = kein Event)
  if (params.paletteOverrides !== undefined) {
    // Gleiche Prüfung wie Engine-Befehl `setPaletteOverrides` und App-Auswahl: Familie passt zur Gruppe und Zielversion
    const problems = paletteOverrideProblems(params.paletteOverrides, familiesOrUndefined(ctx, project.state.targetVersion.name));
    if (problems.length > 0) throw new Error(`Paletten-Überschreibung ungültig: ${problems.join('; ')}`);
    project.setPaletteOverrides(params.paletteOverrides);
  }
  // Nutzungszustand (Q5/P15): gehört zum Projekt wie die Palette; die Materialisierung liest ihn vom Projektzustand.
  if (params.storyState !== undefined) project.setStoryState(params.storyState);
  // B4: neue Projekte mit der Stimmung des Themes (ausdrückliches `mood` hat Vorrang)
  applyNewProjectMood(project, params.mood);
  if (params.interiorDecor !== undefined) project.setInteriorDecor(params.interiorDecor);
  project.applyBuildingType(planDraft(plan, originOf(def, plan, params)));
  const notes = [...plan.warnings.map((w) => `Plan: ${w}`), ...plan.hints];
  const unbuildable = settingNote(params.setting?.kind ?? plan.params.setting?.kind);
  if (unbuildable !== undefined) notes.push(unbuildable);
  const chain = themeWith(ctx, themeId, paletteId, project.state.paletteOverrides).chain;
  if (def.styleTags !== undefined && !roomTypeFitsStyles(def, [...chain].reverse())) notes.push(`Bautyp „${def.name}“ passt nicht zum Theme ${themeId} (styleTags)`);
  const build = withFacadeRhythm(planBuildOptions(plan), params.facadeRhythm);
  const around = params.surroundings === false ? {} : planSurroundings(plan, project, build, ctx, notes, params.landform);
  const surroundings: SurroundingsInput = {
    ...(around.site !== undefined ? { site: around.site.state } : {}),
    ...(around.structures !== undefined ? { structures: around.structures } : {}),
    ...(params.landform !== undefined && params.landform !== 'flat' && around.site !== undefined ? { landform: params.landform } : {}),
  };
  return { project, plan, build, surroundings, ...(around.site !== undefined ? { site: around.site } : {}), notes };
}
