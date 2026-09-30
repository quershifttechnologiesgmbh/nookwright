import type { ComponentDef } from '@mcda/catalog';
import { isFullBlock } from '@mcda/catalog';
import { cellKey, key3, pose, resolveRelDir, rotateDir, transformLocal, type Cell, type CellSet, type HorizontalDir, type Quarter } from '@mcda/core';
import type { RoomAnalysis } from './analyze.js';
import { allowedRotations, type ExpandedComponent } from './expand.js';
import { neighbor, type RoomGeometry } from './geometry.js';
import {
  HANGING_ENTITIES, MECH_CHEST, MECH_CONDUCTOR, SMOKE_BLOCKER, SMOKE_SOURCE, T_BED, T_HAZARD, T_HEAD, T_JOB, T_NOTE, T_PORTAL, isJobStation, mechanicsOf, smokeOf, tallOf, traitsOf,
} from './mechanics.js';
import type { AislePlan } from './layout.js';
import { placeComponent, type PlacedCell, type PlacedComponent } from './place.js';
import { accessGroups, groupAccessOK, walkNet } from './walkways.js';

/**
 * Harte Regeln des Solvers (research/02 §7.6 hardValid, §7.8 Konnektivität): Kollision, Raumgrenzen, Türzone,
 * gesperrte Zellen, Kopffreiheit, Rücken zur Wand, Wand-Montage, Nutzungsfelder, zusammenhängende Lauffläche,
 * Truhe öffnet (`containerOpen`: kein Redstone-Leiter und nicht die Decke direkt über einer Truhe, V3).
 * K3c (research/17 §7.4): `bedObstructed` (kein Vollblock und nicht die Decke über einem Bett, ein Nachbarfeld
 * bleibt als Aufwachposition frei), `noteBlockAirAbove`, `noHazardOnPath` (Lagerfeuer, Honig, Wasser … auf
 * Laufhöhe nur abgedeckt oder ohne freies Nachbarfeld), `jobSiteReachable` (Arbeitsblock einer Station behält ein
 * freies Nachbarfeld), `portalClearance` (harte Freifläche vor Portalen) sowie Mittelgang und Freifläche des
 * Raumtyp-Layouts (`aisle`, `reserve`).
 */

/** Belegungszustand während des Lösens. */
export class Occupancy {
  readonly blocks = new Set<string>();
  /** Nur echte Blöcke (ohne reservierte Luft): Träger für `face`/`hang`-Sockets. */
  readonly solid = new Set<string>();
  /** Bodenzellen, auf denen etwas steht (nicht mehr begehbar). */
  readonly floor = new Set<string>();
  /** Nutzungsfelder je Komponente: mindestens eine Zelle jeder Gruppe muss frei bleiben. */
  readonly useGroups: Cell[][] = [];
  /** Truhen-Zellen (darüber kein Leiter) und Redstone-Leiter (nie über einer Truhe) – Regel `containerOpen`. */
  readonly chests = new Set<string>();
  readonly conductors = new Set<string>();
  /** Zellen hängender Entities (Rahmen) und Blöcke, die ½ Block in die Zelle darüber ragen (Zaun, Mauer). */
  readonly frames = new Set<string>();
  readonly tall = new Set<string>();
  /** Bett-, Notenblock- und Kopf-Zellen (`bedObstructed`, `noteBlockAirAbove`). */
  readonly beds = new Set<string>();
  readonly notes = new Set<string>();
  readonly heads = new Set<string>();
  /** Bodenzellen, die frei bleiben müssen (harte Freifläche vor Portalen, `portalClearance`). */
  readonly keepFree = new Set<string>();
  /** Lagerfeuer und Falltüren (Regel `smokeFree`: keine Falltür direkt über einem Lagerfeuer). */
  readonly smokes = new Set<string>();
  readonly trapdoors = new Set<string>();

  constructor(private readonly baseY: number) {}

  add(p: PlacedComponent, useCells: readonly Cell[]): void {
    const mech = mechanicsOf(p.expanded);
    const tall = tallOf(p.expanded);
    const smoke = smokeOf(p.expanded);
    for (const e of p.entities) if (HANGING_ENTITIES.has(e.spec.type)) this.frames.add(key3(e.pos));
    p.cells.forEach((c, i) => {
      this.blocks.add(key3(c.pos));
      this.solid.add(key3(c.pos));
      if (tall[i] === 1) this.tall.add(key3(c.pos));
      if (mech[i] === MECH_CHEST) this.chests.add(key3(c.pos));
      else if (mech[i] === MECH_CONDUCTOR) this.conductors.add(key3(c.pos));
      if (smoke[i] === SMOKE_SOURCE) this.smokes.add(key3(c.pos));
      else if (smoke[i] === SMOKE_BLOCKER) this.trapdoors.add(key3(c.pos));
      // Durchlaufbare Komponenten (Wandfackel, Teppich) lassen die Bodenzelle begehbar
      if (c.pos[1] <= this.baseY + 1 && !p.expanded.walkable) this.floor.add(cellKey(c.pos[0], c.pos[2]));
    });
    for (const a of p.air) this.blocks.add(key3(a));
    if (useCells.length > 0) this.useGroups.push([...useCells]);
    const tr = traitsOf(p.expanded);
    if (tr.any === 0) return;
    p.cells.forEach((c, i) => {
      const t = tr.cells[i]!;
      if ((t & T_BED) !== 0) this.beds.add(key3(c.pos));
      if ((t & T_NOTE) !== 0) this.notes.add(key3(c.pos));
      if ((t & T_HEAD) !== 0) this.heads.add(key3(c.pos));
    });
    this.useGroups.push(...ruleUseGroups(p, this.baseY));
    for (const c of portalClearance(p, this.baseY)) this.keepFree.add(cellKey(c[0], c[1]));
  }

  /** Verwirft Nutzungsfelder, die schon ganz belegt sind (z. B. durch manuelle Möbel) – sonst wäre nichts mehr gültig. */
  dropBlockedUseGroups(interior: CellSet): void {
    const free = (c: Cell): boolean => interior.has(c[0], c[1]) && !this.floor.has(cellKey(c[0], c[1]));
    for (let i = this.useGroups.length - 1; i >= 0; i--) if (!this.useGroups[i]!.some(free)) this.useGroups.splice(i, 1);
  }
}

/** Zell-Flags als Raster über der Bounding-Box (schneller als Zeichenketten-Schlüssel in der heißen Schleife). */
interface Grid {
  readonly minX: number;
  readonly minZ: number;
  readonly w: number;
  readonly d: number;
  readonly flags: Uint16Array;
}
const INTERIOR = 1;
const DOOR_ZONE = 2;
const BLOCKED = 4;
/** Raumtyp-Layout: Mittelgang, Freifläche auf Laufhöhe (`focal`), Treppenschacht in jeder Höhe (`stairwell`). */
const AISLE = 8;
const RESERVE = 16;
const SHAFT = 32;
/** Hauptweg (W2, I6): in Laufhöhe nur Durchlaufbares. */
const PATH = 64;
/** W2 (freie Sicht): Sichtachse hinter einer Fensterscheibe (`RoomAnalysis.windowView`). */
const VIEW = 128;
/** W7: Insel in der Raummitte (`RoomAnalysis.island`): auf Bodenhöhe nur das Insel-Möbel oder Durchlaufbares. */
const ISLAND = 256;

/**
 * W2 (26.09.2026, freie Sicht durchs Fenster): was in der Sichtachse eines Fensters in Blickhöhe stehen darf – kleine,
 * durchsichtige oder flache Dinge (Laterne, Kerze, Blumentopf, Teppich, Druckplatte, Kette, Fackel). Alles andere
 * (Truhe, Schrank, Regal, Fass, Stuhl-Lehne, Banner …) sähe man von außen „im Glas“.
 */
const VIEW_OK_SHAPES: ReadonlySet<string> = new Set(['lantern', 'candle', 'carpet', 'pressure_plate', 'chain', 'torch', 'flower_pot', 'button']);
const VIEW_OK_BLOCK = /^minecraft:(.*lantern|.*candle.*|flower_pot|potted_.*|.*carpet|.*pressure_plate|.*chain|torch|wall_torch|soul_torch|.*button|lever)$/;
function viewOK(mat: PlacedCell['mat']): boolean {
  return mat.block !== undefined ? VIEW_OK_BLOCK.test(mat.block) : VIEW_OK_SHAPES.has(mat.shape ?? '');
}
const gridCache = new WeakMap<RoomAnalysis, Grid>();

function gridOf(a: RoomAnalysis): Grid {
  let gr = gridCache.get(a);
  if (gr === undefined) {
    // Rahmen über Innenfläche UND gesperrten Spalten (die können außerhalb von `interior` liegen, siehe analyze)
    const b = (a.blocked.isEmpty ? a.geometry.interior : a.geometry.interior.union(a.blocked)).bounds() ?? { minX: 0, minZ: 0, maxX: -1, maxZ: -1 };
    const w = b.maxX - b.minX + 1;
    const d = b.maxZ - b.minZ + 1;
    const flags = new Uint16Array(Math.max(0, w * d));
    const mark = (cells: Iterable<Cell>, bit: number): void => {
      for (const [x, z] of cells) {
        const i = x - b.minX;
        const k = z - b.minZ;
        if (i >= 0 && k >= 0 && i < w && k < d) flags[k * w + i]! |= bit;
      }
    };
    mark(a.geometry.interior, INTERIOR);
    mark(a.doorZone, DOOR_ZONE);
    mark(a.blocked, BLOCKED);
    if (a.layout?.aisle !== undefined) mark(a.layout.aisle.cells, AISLE);
    if (a.layout?.reserve !== undefined) mark(a.layout.reserve.cells, a.layout.reserve.reason === 'stairwell' ? SHAFT : RESERVE);
    if (a.path !== undefined) mark(a.path, PATH);
    if (a.windowView !== undefined) mark(a.windowView, VIEW);
    if (a.island !== undefined) mark(a.island.cells, ISLAND);
    gridCache.set(a, (gr = { minX: b.minX, minZ: b.minZ, w, d, flags }));
  }
  return gr;
}

function flagAt(gr: Grid, x: number, z: number): number {
  const i = x - gr.minX;
  const k = z - gr.minZ;
  return i < 0 || k < 0 || i >= gr.w || k >= gr.d ? 0 : gr.flags[k * gr.w + i]!;
}

const layerCache = new WeakMap<ExpandedComponent, number>();

/** Unterste lokale Lage mit Blockzellen. */
function lowestLayer(exp: ExpandedComponent): number {
  let y = layerCache.get(exp);
  if (y === undefined) layerCache.set(exp, (y = exp.cells.length === 0 ? 0 : Math.min(...exp.cells.map((c) => c.at[1]))));
  return y;
}

/** Nutzungsfelder (Maske `use`) als Weltzellen. */
export function useCellsOf(p: PlacedComponent, geom: RoomGeometry): Cell[] {
  const out: Cell[] = [];
  for (const u of p.expanded.masks.use ?? []) {
    const d = resolveRelDir(u.side, p.pose);
    if (d === 'up' || d === 'down') continue;
    for (const c of p.cells) {
      if (c.pos[1] !== geom.baseY) continue;
      const n = neighbor([c.pos[0], c.pos[2]], d);
      if (!p.cells.some((o) => o.pos[0] === n[0] && o.pos[2] === n[1])) out.push(n);
    }
  }
  return out;
}

export interface HardOptions {
  /** Kinder auf Sockets: der Rücken muss nicht an einer Raumwand liegen. */
  readonly skipBackToWall?: boolean;
  /** Socket `hang`: Deckenobjekt darf tiefer als die Kopffreiheit hängen, wenn darunter kein Laufweg ist. */
  readonly lowOverFurniture?: boolean;
}

/** Alle harten Regeln (billige + Konnektivität). */
export function hardValid(p: PlacedComponent, def: ComponentDef, a: RoomAnalysis, occ: Occupancy, o: HardOptions = {}): boolean {
  return cheapValid(p, def, a, occ, o) && connectivityOK(p, a, occ);
}

/**
 * Harte Regeln ohne die teure Konnektivitätsprüfung. Die Kandidatensuche filtert damit alle Posen,
 * die BFS läuft danach nur für die besten Kandidaten – das macht große Räume schnell.
 */
export function cheapValid(p: PlacedComponent, def: ComponentDef, a: RoomAnalysis, occ: Occupancy, o: HardOptions = {}): boolean {
  return cheapReason(p, def, a, occ, o) === undefined;
}

/**
 * Additiv (Erklärvideo, 27.09.2026): Grund, aus dem `cheapValid` eine Pose verwirft (erste verletzte Regel in derselben
 * Reihenfolge), `undefined` = gültig. `cheapValid` ist genau `cheapReason(…) === undefined` – eine Quelle der Regeln.
 */
export type RejectReason =
  | 'outside' | 'blocked' | 'height' | 'door_zone' | 'main_path' | 'island' | 'collision' | 'headroom' | 'wall_mount' | 'window'
  | 'window_view' | 'air_space' | 'entity_blocked' | 'back_to_wall' | 'container_open' | 'frame_clear' | 'smoke_free' | 'layout'
  | 'keep_free' | 'block_rules' | 'use_field' | 'blocks_use_field' | 'rule_use_field' | 'portal_clearance';

export function cheapReason(p: PlacedComponent, def: ComponentDef, a: RoomAnalysis, occ: Occupancy, o: HardOptions = {}): RejectReason | undefined {
  const g = a.geometry;
  const top = g.baseY + g.height - 1;
  const wall = def.mount === 'wall';
  const gr = gridOf(a);
  for (const c of p.cells) {
    const [x, y, z] = c.pos;
    const f = flagAt(gr, x, z);
    if ((f & INTERIOR) === 0) return 'outside';
    if ((f & BLOCKED) !== 0) return 'blocked';
    if (y < g.baseY || y > top) return 'height';
    if (y <= g.baseY + 1 && (f & DOOR_ZONE) !== 0) return 'door_zone';
    // Hauptweg 2 breit (W2, I6): in Laufhöhe nur Durchlaufbares (Teppich, Wandfackel); Wandobjekte hängen nicht im Weg
    if (y <= g.baseY + 1 && (f & PATH) !== 0 && !p.expanded.walkable) return 'main_path';
    // W7: Insel – auf Bodenhöhe nur das Möbel des Insel-Eintrags (Kinder obendrauf und Deckenlampen darüber bleiben frei)
    if (y === g.baseY && (f & ISLAND) !== 0 && !p.expanded.walkable && !a.island!.tags.some((t) => def.tags.includes(t))) return 'island';
    if (occ.blocks.has(key3(c.pos))) return 'collision';
    // Kopffreiheit: Deckenobjekte nicht in den Laufraum (2 Blöcke über dem Boden)
    if (def.mount === 'ceiling' && y < g.baseY + 2 && !(o.lowOverFurniture === true && occ.floor.has(cellKey(x, z)))) return 'headroom';
    if (wall && !wallCellOK(c, a, occ)) return 'wall_mount';
    // Q1a: Fenster freihalten. Ein voller Block über Bodenhöhe in einer Spalte mit Fenster nimmt dem
    // Außenlicht (C4) und dem Blick den Weg – die Wand-Montage prüft das schon (`wallCellOK`), hier auch für
    // Bodenmöbel (Truhenstapel, Regale, hohe Pflanzen). Dünne Formen (Stufe, Zaun, Teppich) bleiben erlaubt.
    if (y > g.baseY && isFullBlock(c.mat) && a.info.get(cellKey(x, z))?.nearWindow === true) return 'window';
    // W2 (26.09.2026, freie Sicht): in Blickhöhe (Boden+1, Boden+2) direkt hinter der Scheibe nur Niedriges/
    // Durchsichtiges; in der übrigen Sichtachse (Tiefe 2…3) keine Stauraum-Möbel (Truhe, Schrank, Regal, Fass), die man
    // von außen „im Glas“ sähe. Bodenhohe Möbel (Tisch, Bett, einzelne Truhe) bleiben überall erlaubt.
    if (y > g.baseY && y <= g.baseY + 2 && (f & VIEW) !== 0 && !viewOK(c.mat)
      && (def.category === 'storage' || a.info.get(cellKey(x, z))?.nearWindow === true)) return 'window_view';
  }
  for (const air of p.air) {
    if ((flagAt(gr, air[0], air[2]) & BLOCKED) !== 0 || occ.blocks.has(key3(air))) return 'air_space';
  }
  // Entities (Rahmen, Gemälde) nie über gesperrten Spalten: dort stehen Geländer (Zaun ragt ½ Block hoch) oder Loch
  for (const e of p.entities) if ((flagAt(gr, Math.floor(e.pos[0]), Math.floor(e.pos[2])) & BLOCKED) !== 0) return 'entity_blocked';
  // Rücken zur Wand: jede Zelle der hinteren Reihe (unterste belegte Lage) braucht eine feste Wand dahinter.
  // Wand-Montage verlangt das immer, unabhängig von `rotations`. (Unterste *belegte* Lage: ein Wandbanner mit
  // Luft darunter hat in Lage 0 keine Zelle – sonst wäre die Prüfung leer.)
  if ((def.rotations === 'backToWall' || wall) && o.skipBackToWall !== true) {
    const back = resolveRelDir('back', p.pose);
    const bottom = lowestLayer(p.expanded);
    // W3-IN: eine nur eine Reihe hohe Rückseite am Boden (Arbeitsplatte, Spüle, Truhe) lehnt auch unter einem Fenster an
    const low = !wall && p.entities.length === 0 && p.cells.every((c) => c.local[2] !== 0 || c.pos[1] === g.baseY);
    for (const c of p.cells) {
      if (c.local[2] !== 0 || c.local[1] !== bottom) continue; // kanonisch: hintere Reihe hat lokales z = 0
      const info = a.info.get(cellKey(c.pos[0], c.pos[2]));
      if (info === undefined) return 'back_to_wall';
      if (!info.solidWalls.includes(back as HorizontalDir) && !(low && info.lowWalls?.includes(back as HorizontalDir) === true)) return 'back_to_wall';
    }
  }
  if (!containerOpenOK(p, top, occ)) return 'container_open';
  if (!frameClearOK(p, occ)) return 'frame_clear';
  if (!smokeFreeOK(p, occ)) return 'smoke_free';
  if (a.layout !== undefined && !layoutOK(p, def, a, gr)) return 'layout';
  // Nutzungsfelder: von der neuen Komponente und von allen bisherigen bleibt je mindestens eines frei.
  const newFloor = new Set(p.expanded.walkable ? [] : p.cells.filter((c) => c.pos[1] <= g.baseY + 1).map((c) => cellKey(c.pos[0], c.pos[2])));
  if (occ.keepFree.size > 0) for (const k of newFloor) if (occ.keepFree.has(k)) return 'keep_free';
  const isFree = (c: Cell) => (flagAt(gr, c[0], c[1]) & INTERIOR) !== 0 && !occ.floor.has(cellKey(c[0], c[1])) && !newFloor.has(cellKey(c[0], c[1]));
  if (!blockRulesOK(p, a, occ, top, newFloor, gr)) return 'block_rules';
  const own = useCellsOf(p, g);
  // Gestapelte Kinder (keine Zelle am Boden) nutzt man über das Nutzungsfeld des Elternteils
  const grounded = p.cells.some((c) => c.pos[1] === g.baseY);
  if ((p.expanded.masks.use?.length ?? 0) > 0 && grounded && !own.some(isFree)) return 'use_field';
  for (const group of occ.useGroups) if (!group.some(isFree)) return 'blocks_use_field';
  if (traitsOf(p.expanded).any !== 0) {
    for (const group of ruleUseGroups(p, g.baseY)) if (!group.some(isFree)) return 'rule_use_field';
    for (const c of portalClearance(p, g.baseY)) if ((flagAt(gr, c[0], c[1]) & BLOCKED) !== 0 || !isFree(c)) return 'portal_clearance';
  }
  return undefined;
}

/**
 * Raumtyp-Layout (research/17 Y1/Y2): im Mittelgang auf Laufhöhe nur Durchlaufbares und der Blickpunkt (Signatur
 * ohne Reihe, Rücken zur Stirnwand); in der Freifläche (`focal`) auf Laufhöhe nur erlaubte Tags und Durchlaufbares;
 * im Treppenschacht (`stairwell`) in keiner Höhe etwas außer erlaubten Tags (auch keine Luft-Masken).
 */
function layoutOK(p: PlacedComponent, def: ComponentDef, a: RoomAnalysis, gr: Grid): boolean {
  const lay = a.layout!;
  const low = a.geometry.baseY + 1;
  const allowed = lay.reserve !== undefined && lay.reserve.allow.some((t) => def.tags.includes(t));
  let focal: boolean | undefined;
  for (const c of p.cells) {
    const f = flagAt(gr, c.pos[0], c.pos[2]);
    if ((f & SHAFT) !== 0 && !allowed) return false;
    if (c.pos[1] > low || p.expanded.walkable) continue;
    if ((f & RESERVE) !== 0 && !allowed) return false;
    if ((f & AISLE) !== 0) {
      focal ??= lay.focalTags.some((t) => def.tags.includes(t)) && atHead(p, lay.aisle!);
      if (!focal) return false;
    }
  }
  if (!allowed) for (const air of p.air) if ((flagAt(gr, air[0], air[2]) & SHAFT) !== 0) return false;
  return true;
}

/** Blickpunkt an der Stirnseite: Rücken zur Stirnwand und bis an das Gang-Ende reichend. */
function atHead(p: PlacedComponent, aisle: AislePlan): boolean {
  if (resolveRelDir('back', p.pose) !== aisle.head) return false;
  const along = aisle.axis === 'x' ? 0 : 2;
  const l0 = p.pose.pos[along];
  const l1 = l0 + p.size[along] - 1;
  return aisle.head === 'north' || aisle.head === 'west' ? l0 === aisle.start : l1 === aisle.end;
}

/**
 * Nutzungsgruppen aus Block-Regeln (je Gruppe muss eine Bodenzelle frei bleiben): `bedObstructed` – ein
 * Nachbarfeld des Betts als Aufwachposition (Faktencheck #8, Respawn prüft die Felder neben dem Bett);
 * `jobSiteReachable` – ein Feld der 8er-Nachbarschaft je Arbeitsblock auf Laufhöhe, nur bei Handels-Stationen
 * (`trade`, `isJobStation`; Wiki: Arbeitsblock im Nachbarfeld auf Fußhöhe oder darunter).
 */
export function ruleUseGroups(p: PlacedComponent, baseY: number): Cell[][] {
  const tr = traitsOf(p.expanded);
  const job = (tr.any & T_JOB) !== 0 && isJobStation(p.expanded);
  if ((tr.any & T_BED) === 0 && !job) return [];
  const own = new Set(p.expanded.walkable ? [] : p.cells.filter((c) => c.pos[1] <= baseY + 1).map((c) => cellKey(c.pos[0], c.pos[2])));
  const ring = (cols: readonly (readonly [number, number])[], diag: boolean): Cell[] => {
    const seen = new Set<string>();
    const out: Cell[] = [];
    for (const [x, z] of cols) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if ((dx === 0 && dz === 0) || (!diag && dx !== 0 && dz !== 0)) continue;
          const k = cellKey(x + dx, z + dz);
          if (own.has(k) || seen.has(k)) continue;
          seen.add(k);
          out.push([x + dx, z + dz]);
        }
      }
    }
    return out;
  };
  const cols = (bit: number, floorOnly: boolean): (readonly [number, number])[] =>
    p.cells.filter((c, i) => (tr.cells[i]! & bit) !== 0 && (!floorOnly || c.pos[1] === baseY)).map((c) => [c.pos[0], c.pos[2]] as const);
  const out: Cell[][] = [];
  if ((tr.any & T_BED) !== 0) out.push(ring(cols(T_BED, false), false));
  if (job) for (const c of cols(T_JOB, true)) out.push(ring([c], true));
  return out.filter((grp) => grp.length > 0);
}

/**
 * `portalClearance` (research/17 §4.25): Komponenten mit Portal-Rahmen (Obsidian/Portalblöcke) halten ihre harten
 * Freiflächen (`masks.clearance`, hard) als freie Bodenzellen: bei der Platzierung frei, danach für alle gesperrt.
 * Andere Komponenten: Freiflächen-Masken wertet der Solver (noch) nicht aus.
 */
export function portalClearance(p: PlacedComponent, baseY: number): Cell[] {
  if ((traitsOf(p.expanded).any & T_PORTAL) === 0) return [];
  const hard = (p.expanded.masks.clearance ?? []).filter((c) => c.hard);
  if (hard.length === 0) return [];
  const own = new Map<string, Cell>();
  for (const c of p.cells) if (c.pos[1] <= baseY + 1) own.set(cellKey(c.pos[0], c.pos[2]), [c.pos[0], c.pos[2]]);
  const out = new Map<string, Cell>();
  for (const cl of hard) {
    const dirs: HorizontalDir[] = cl.side === 'all' ? ['north', 'east', 'south', 'west'] : [resolveRelDir(cl.side, p.pose)].filter((d): d is HorizontalDir => d !== 'up' && d !== 'down');
    for (const d of dirs) {
      const [sx, sz] = STEP2[d];
      for (const [x, z] of own.values()) {
        for (let i = 1; i <= cl.depth; i++) {
          const k = cellKey(x + sx * i, z + sz * i);
          if (!own.has(k)) out.set(k, [x + sx * i, z + sz * i]);
        }
      }
    }
  }
  return [...out.values()];
}

const STEP2: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/**
 * Block-Regeln zwischen Zellen (research/17 §7.4), gegen die Belegung und innerhalb der neuen Komponente:
 *  - `bedObstructed`: über einem Bett kein Vollblock und nicht die Decke; kein Vollblock auf ein vorhandenes Bett.
 *  - `noteBlockAirAbove`: über einem Notenblock nur Luft oder ein Kopf, nicht die Decke; nichts anderes darauf.
 *  - `noHazardOnPath`: Gefahr auf Laufhöhe (y = Boden) nur, wenn darüber ein Block liegt (niemand tritt darauf,
 *    Braukessel über dem Feuer) oder kein Nachbarfeld frei begehbar ist (Feuer hinter Gitter, in der Rinne).
 *    Später gesetzte Möbel machen es nur sicherer (Nachbarn belegt, Deckel darüber) – die Prüfung beim Setzen reicht.
 */
function blockRulesOK(p: PlacedComponent, a: RoomAnalysis, occ: Occupancy, top: number, newFloor: ReadonlySet<string>, gr: Grid): boolean {
  const mech = mechanicsOf(p.expanded);
  const tr = traitsOf(p.expanded);
  if (occ.beds.size > 0 || occ.notes.size > 0) {
    for (let i = 0; i < p.cells.length; i++) {
      const [x, y, z] = p.cells[i]!.pos;
      const below = key3([x, y - 1, z]);
      if (mech[i] === MECH_CONDUCTOR && occ.beds.has(below)) return false;
      if (occ.notes.has(below) && (tr.cells[i]! & T_HEAD) === 0) return false;
    }
  }
  if ((tr.any & (T_BED | T_NOTE | T_HAZARD)) === 0) return true;
  const own = new Map(p.cells.map((c, i) => [key3(c.pos), i]));
  const baseY = a.geometry.baseY;
  for (let i = 0; i < p.cells.length; i++) {
    const t = tr.cells[i]!;
    if ((t & (T_BED | T_NOTE | T_HAZARD)) === 0) continue;
    const [x, y, z] = p.cells[i]!.pos;
    const above = key3([x, y + 1, z]);
    const j = own.get(above);
    if ((t & T_BED) !== 0 && (y >= top || occ.conductors.has(above) || (j !== undefined && mech[j] === MECH_CONDUCTOR))) return false;
    if ((t & T_NOTE) !== 0 && (y >= top || (occ.solid.has(above) && !occ.heads.has(above)) || (j !== undefined && (tr.cells[j]! & T_HEAD) === 0))) return false;
    if ((t & T_HAZARD) !== 0 && y === baseY) {
      if (y < top && (occ.solid.has(above) || j !== undefined)) continue; // abgedeckt: niemand tritt darauf
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const f = flagAt(gr, x + dx, z + dz);
        const k = cellKey(x + dx, z + dz);
        if ((f & INTERIOR) !== 0 && (f & BLOCKED) === 0 && !occ.floor.has(k) && !newFloor.has(k)) return false;
      }
    }
  }
  return true;
}

/**
 * Regel `smokeFree` (Faktencheck #13): direkt über einem Lagerfeuer liegt keine Falltür (der Rauch – und damit
 * Deko-Effekt und Rauchsignal – bliebe stecken); gegen die Belegung und innerhalb der neuen Komponente.
 */
function smokeFreeOK(p: PlacedComponent, occ: Occupancy): boolean {
  const smoke = smokeOf(p.expanded);
  if (!smoke.includes(SMOKE_SOURCE) && (occ.smokes.size === 0 || !smoke.includes(SMOKE_BLOCKER))) return true;
  const own = new Map(p.cells.map((c, i) => [key3(c.pos), smoke[i]!]));
  for (let i = 0; i < p.cells.length; i++) {
    const [x, y, z] = p.cells[i]!.pos;
    if (smoke[i] === SMOKE_SOURCE) {
      const above = key3([x, y + 1, z]);
      if (occ.trapdoors.has(above) || own.get(above) === SMOKE_BLOCKER) return false;
    } else if (smoke[i] === SMOKE_BLOCKER && occ.smokes.has(key3([x, y - 1, z]))) return false;
  }
  return true;
}

/**
 * Regel `containerOpen` (Faktencheck #2, T5 #6/T4): direkt über jeder Truhe liegt weder ein Redstone-Leiter
 * (Fass, Planken, Bücherregal …) noch die Decke; umgekehrt kommt kein Leiter auf eine vorhandene Truhe.
 * Geprüft gegen die Belegung UND innerhalb der neuen Komponente. Truhe über Truhe ist erlaubt.
 */
function containerOpenOK(p: PlacedComponent, top: number, occ: Occupancy): boolean {
  const mech = mechanicsOf(p.expanded);
  let own: Map<string, number> | undefined;
  for (let i = 0; i < p.cells.length; i++) {
    const m = mech[i]!;
    if (m === 0) continue;
    const [x, y, z] = p.cells[i]!.pos;
    if (m === MECH_CHEST) {
      if (y >= top) return false; // Decke direkt darüber (voller Block)
      const above = key3([x, y + 1, z]);
      if (occ.conductors.has(above)) return false;
      own ??= new Map(p.cells.map((c, j) => [key3(c.pos), mech[j]!]));
      if (own.get(above) === MECH_CONDUCTOR) return false;
    } else if (occ.chests.has(key3([x, y - 1, z]))) {
      return false;
    }
  }
  return true;
}

/**
 * Rahmen-Freiraum (Vanilla `ItemFrame#survives`, Prüfung `entity_support` der Materialisierung): kein Rahmen
 * direkt über einem Zaun, einer Mauer oder einem Zauntor (ragen ½ Block hoch in die Zelle) – weder über eigenen
 * noch über vorhandenen Blöcken; umgekehrt kommt kein solcher Block unter einen vorhandenen Rahmen.
 */
function frameClearOK(p: PlacedComponent, occ: Occupancy): boolean {
  const tall = tallOf(p.expanded);
  const hasTall = tall.includes(1);
  const frames = p.entities.filter((e) => HANGING_ENTITIES.has(e.spec.type));
  if (frames.length === 0 && !hasTall) return true;
  const ownTall = new Set<string>();
  p.cells.forEach((c, i) => {
    if (tall[i] === 1) ownTall.add(key3(c.pos));
  });
  for (const e of frames) {
    const below = key3([e.pos[0], e.pos[1] - 1, e.pos[2]]);
    if (occ.tall.has(below) || ownTall.has(below)) return false;
  }
  for (const c of p.cells) {
    if (ownTall.has(key3(c.pos)) && occ.frames.has(key3([c.pos[0], c.pos[1] + 1, c.pos[2]]))) return false;
  }
  return true;
}

/**
 * Wand-Montage je Zelle: nie in einer Türzone oder vor einem Fenster. Über Möbeln nur so: Ist die Spalte
 * zwischen Boden+1 und der Zelle frei, darf das Möbel darunter 1 Block hoch sein (Rahmen über der Werkbank);
 * über höheren Möbeln braucht es eine freie Zelle direkt darunter (Bord mit Luft über dem Schrank, V3).
 */
function wallCellOK(c: PlacedCell, a: RoomAnalysis, occ: Occupancy): boolean {
  const [x, y, z] = c.pos;
  const g = a.geometry;
  if (a.doorZone.has(x, z) || a.info.get(cellKey(x, z))?.nearWindow === true) return false;
  return y - 1 <= g.baseY || !occ.blocks.has(key3([x, y - 1, z]));
}

/**
 * Alle freien Bodenzellen hängen zusammen und erreichen jede Tür (keine abgeschnittenen Taschen).
 * Gesperrte Zellen (Treppe) sind nie belegt und zählen damit als begehbar: sie bleiben erreichbar.
 * W8-B (27.09.2026): dazu die Regel `useAccess` (`walkways.ts`) – jede Nutzungsseite liegt am begehbaren Netz,
 * nicht in einer langen 1 breiten Sackgasse und nicht als einziger Durchgang. `access = false` nur für den
 * Rückfall eines Pflichtobjekts (Solver), dann gilt allein die Zusammenhangsprüfung wie vorher.
 */
export function connectivityOK(p: PlacedComponent, a: RoomAnalysis, occ: Occupancy, access = true): boolean {
  const g = a.geometry;
  // Nichts in Laufhöhe (z. B. Deckenlampen) oder durchlaufbar (Wandfackel) → die Begehbarkeit ändert sich nicht.
  if (p.expanded.walkable || !p.cells.some((c) => c.pos[1] <= g.baseY + 1)) return !access || useAccessOK(p, a, occ, occ.floor);
  const blocked = new Set(occ.floor);
  for (const c of p.cells) if (c.pos[1] <= g.baseY + 1) blocked.add(cellKey(c.pos[0], c.pos[2]));
  // Eine BFS über die freien Zellen (Schlüssel statt CellSet-Komponenten – das ist die heißeste Schleife)
  const gr = gridOf(a);
  const isFree = (x: number, z: number): boolean => (flagAt(gr, x, z) & INTERIOR) !== 0 && !blocked.has(cellKey(x, z));
  let start: Cell | undefined;
  let freeCount = 0;
  for (const [x, z] of interiorCells(a)) {
    if (!isFree(x, z)) continue;
    freeCount++;
    start ??= [x, z];
  }
  if (start === undefined) return false;
  const reached = new Set<string>([cellKey(start[0], start[1])]);
  const queue: Cell[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i]!;
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]] as const) {
      const k = cellKey(nx, nz);
      if (reached.has(k) || !isFree(nx, nz)) continue;
      reached.add(k);
      queue.push([nx, nz]);
    }
  }
  // genau eine zusammenhängende freie Fläche, und jede Türinnenzelle liegt darin
  if (reached.size !== freeCount || !g.doors.every((d) => reached.has(cellKey(d.inside[0], d.inside[1])))) return false;
  return !access || useAccessOK(p, a, occ, blocked);
}

/** W8-B: Nutzungsgruppen, die in der aktuellen Belegung schon keine taugliche Zelle haben (geduldet, siehe `walkways.ts`). */
const accessBefore = new WeakMap<Occupancy, { readonly version: string; readonly bad: Uint8Array }>();

/**
 * Regel `useAccess` (W8-B, `walkways.ts`): die neuen Nutzungsgruppen der Komponente und alle vorhandenen behalten je
 * eine Zelle am begehbaren Netz (keine Tasche länger als `POCKET_MAX`, nicht einziger Durchgang). Vorhandene Gruppen,
 * die das schon vorher nicht erfüllten, bleiben geduldet – die Platzierung darf nur nichts verschlechtern.
 */
function useAccessOK(p: PlacedComponent, a: RoomAnalysis, occ: Occupancy, taken: ReadonlySet<string>): boolean {
  const baseY = a.geometry.baseY;
  const own = accessGroups(p, useCellsOf(p, a.geometry), ruleUseGroups(p, baseY), baseY);
  if (own.length === 0 && occ.useGroups.length === 0) return true;
  const net = walkNet(a, taken);
  for (const group of own) if (!groupAccessOK(net, group)) return false;
  let before: Uint8Array | undefined;
  for (let i = 0; i < occ.useGroups.length; i++) {
    if (groupAccessOK(net, occ.useGroups[i]!)) continue;
    before ??= accessBadBefore(a, occ);
    if (before[i] === 0) return false;
  }
  return true;
}

function accessBadBefore(a: RoomAnalysis, occ: Occupancy): Uint8Array {
  const version = `${occ.floor.size}/${occ.useGroups.length}/${occ.blocks.size}`;
  const hit = accessBefore.get(occ);
  if (hit !== undefined && hit.version === version) return hit.bad;
  const net = walkNet(a, occ.floor);
  const bad = Uint8Array.from(occ.useGroups, (grp) => (groupAccessOK(net, grp) ? 0 : 1));
  accessBefore.set(occ, { version, bad });
  return bad;
}

const interiorCache = new WeakMap<RoomAnalysis, readonly Cell[]>();

/** Innenzellen eines Raums (einmal je Analyse ausgepackt). */
export function interiorCells(a: RoomAnalysis): readonly Cell[] {
  let cells = interiorCache.get(a);
  if (cells === undefined) interiorCache.set(a, (cells = a.geometry.interior.toArray()));
  return cells;
}

/**
 * Höhen der Wand-Montage (Weltkoordinate der untersten Lage) in Wunsch-Reihenfolge, ohne Dubletten:
 * `wallHeights` (≥ 0 über dem Boden, < 0 von der Decke: −1 = oberste Zelle unter der Decke), sonst `wallHeight`.
 */
export function wallLevels(def: Pick<ComponentDef, 'wallHeight' | 'wallHeights'>, sizeY: number, g: Pick<RoomGeometry, 'baseY' | 'height'>): number[] {
  const out: number[] = [];
  for (const h of def.wallHeights ?? [def.wallHeight ?? 1]) {
    const y = h >= 0 ? g.baseY + h : g.baseY + g.height + h - (sizeY - 1);
    // von der Decke gezählt, aber in niedrigen Räumen nie bis auf den Boden (Wandobjekt, kein Bodenmöbel)
    if (h < 0 && y < g.baseY + 1) continue;
    if (!out.includes(y)) out.push(y);
  }
  return out;
}

/** Höhen der untersten Lage einer Komponente je Montage (surface/inset/free: keine eigene Aufzählung). */
function anchorYs(def: ComponentDef, exp: ExpandedComponent, g: RoomGeometry): number[] {
  switch (def.mount) {
    case 'floor':
      return [g.baseY];
    case 'ceiling':
      return [g.baseY + g.height - exp.size[1]];
    case 'wall':
      return wallLevels(def, exp.size[1], g);
    default:
      return []; // surface: über Sockets; *_inset/free: später
  }
}

/**
 * Posen, die die notwendigen Bedingungen der untersten belegten Lage erfüllen – ohne die Komponente zu platzieren:
 * jede Zelle liegt im Raum, nicht gesperrt, nicht in der Türzone, nicht belegt; mit `backToWall` hat die
 * hintere Reihe eine feste Wand dahinter. Reihenfolge: Zellen sortiert, dann Drehungen.
 */
function prefiltered(
  def: ComponentDef, exp: ExpandedComponent, a: RoomAnalysis, occ: Occupancy, visit: (x: number, y: number, z: number, rot: Quarter, ok: boolean) => boolean | void, all = false,
): void {
  const g = a.geometry;
  if (exp.size[1] > g.height) return;
  const rots = allowedRotations(def);
  const gr = gridOf(a);
  const bottom = lowestLayer(exp);
  const wallBacked = def.rotations === 'backToWall' || def.mount === 'wall';
  // W3-IN: eine Reihe hohe Rückseite lehnt auch unter dem Fenster an (wie `cheapValid`)
  const lowBack = def.mount !== 'wall' && exp.entities.length === 0 && exp.cells.every((c) => c.at[2] !== 0 || c.at[1] === bottom);
  const base = new Map(
    rots.map((r) => [r, exp.cells.filter((c) => c.at[1] === bottom).map((c) => ({ at: transformLocal(c.at, exp.size, r, 'none'), rear: c.at[2] === 0 }))]),
  );
  for (const y of anchorYs(def, exp, g)) {
    if (y + bottom < g.baseY || y + exp.size[1] > g.baseY + g.height) continue; // Höhe passt nicht in den Raum
    const by = y + bottom;
    const low = by <= g.baseY + 1;
    for (const [x, z] of interiorCells(a)) {
      for (const rot of rots) {
        const back = rotateDir('north', rot) as HorizontalDir;
        const ok = base.get(rot)!.every(({ at: [dx, , dz], rear }) => {
          const cx = x + dx;
          const cz = z + dz;
          const f = flagAt(gr, cx, cz);
          if ((f & INTERIOR) === 0 || (f & BLOCKED) !== 0 || (low && (f & DOOR_ZONE) !== 0) || occ.blocks.has(key3([cx, by, cz]))) return false;
          if (!(wallBacked && rear)) return true;
          const info = a.info.get(cellKey(cx, cz))!;
          return info.solidWalls.includes(back) || (lowBack && by === g.baseY && info.lowWalls?.includes(back) === true);
        });
        // W8-A: `true` aus `visit` bricht ab (Forward Checking braucht nur die erste gültige Pose)
        if ((ok || all) && visit(x, y, z, rot, ok) === true) return;
      }
    }
  }
}

/** Alle Posen, die die billigen harten Regeln erfüllen (Reihenfolge: Zellen sortiert, dann Drehungen). */
export function enumeratePoses(def: ComponentDef, exp: ExpandedComponent, a: RoomAnalysis, occ: Occupancy): PlacedComponent[] {
  const out: PlacedComponent[] = [];
  prefiltered(def, exp, a, occ, (x, y, z, rot) => {
    const p = placeComponent(exp, pose([x, y, z], rot));
    if (cheapValid(p, def, a, occ)) out.push(p);
  });
  return out;
}

/**
 * W8-A (Forward Checking): die erste Pose, die `enumeratePoses` liefern würde (Vorfilter + billige harte Regeln), ohne
 * die übrigen aufzuzählen – für „hat das Objekt noch mindestens eine gültige Pose?“. Die Pose dient als Zeuge: sie bleibt
 * gültig, solange `cheapValid` für sie gilt (die Regeln hängen nur an der Belegung, der Vorfilter ist ein Teil davon).
 */
export function firstPose(def: ComponentDef, exp: ExpandedComponent, a: RoomAnalysis, occ: Occupancy): PlacedComponent | undefined {
  let out: PlacedComponent | undefined;
  prefiltered(def, exp, a, occ, (x, y, z, rot) => {
    const p = placeComponent(exp, pose([x, y, z], rot));
    if (!cheapValid(p, def, a, occ)) return false;
    out = p;
    return true;
  });
  return out;
}

/** Eine Pose der vollen Domäne mit dem Urteil der billigen harten Regeln (`explainPoses`). */
export interface PoseVerdict {
  readonly placed: PlacedComponent;
  /** Besteht die Pose den Vorfilter (`countPoses` zählt genau diese)? */
  readonly prefilter: boolean;
  /** Erste verletzte Regel (`cheapReason`); fehlt = gültig (genau die Posen aus `enumeratePoses`). */
  readonly reason?: RejectReason;
}

/**
 * Additiv (Erklärvideo, 27.09.2026), nur Diagnose: die VOLLE Domäne einer Form – jede Innenzelle × erlaubte Drehung ×
 * Montagehöhe, wie der Vorfilter sie durchläuft – mit Urteil je Pose. Gültig sind genau die Posen von `enumeratePoses`
 * (gleiche Reihenfolge); eine Pose, die nur der Vorfilter verwirft, trägt den Grund `back_to_wall` bzw. den ersten Grund
 * aus `cheapReason`. Der Solver ruft das nicht auf.
 */
export function explainPoses(def: ComponentDef, exp: ExpandedComponent, a: RoomAnalysis, occ: Occupancy): PoseVerdict[] {
  const out: PoseVerdict[] = [];
  prefiltered(def, exp, a, occ, (x, y, z, rot, ok) => {
    const p = placeComponent(exp, pose([x, y, z], rot));
    const reason = cheapReason(p, def, a, occ);
    if (ok) out.push({ placed: p, prefilter: true, ...(reason !== undefined ? { reason } : {}) });
    else out.push({ placed: p, prefilter: false, reason: reason ?? 'back_to_wall' });
  }, true);
  return out;
}

/** Größe der Domäne (Posen nach dem Vorfilter) – billiges Maß für „Most Constrained First“. */
export function countPoses(def: ComponentDef, exp: ExpandedComponent, a: RoomAnalysis, occ: Occupancy): number {
  let n = 0;
  prefiltered(def, exp, a, occ, () => {
    n++;
  });
  return n;
}
