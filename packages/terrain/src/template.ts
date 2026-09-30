/**
 * Grundstücks-Vorlagen (research/18 §13.1 S1, §13.2): aus dem Gebäude (Leseport `BuildingInfo`) ein Satz Zonen,
 * Ränder, Beleuchtung und Geländestil – „ein Klick zur schönen Umgebung“. Rein; angewendet wird der Plan über
 * `Site.applyTemplate` (Events wie beim Malen, also Undo-fähig).
 *
 * S1 „Gehöft“ (Einzelgehöft), relativ zur Haustür (Richtung nach draußen = vorn):
 *  - Hof vor der Haustür (13 × 9), die Achse der Haustür bleibt frei (Zufahrt/Tor in der Achse, Regel 7);
 *    der Brunnen kommt aus dem Geländestil (`decor.well`) und steht neben der Achse (Regel 5).
 *  - Garten an der Küchenseite (Regel 3; Küche aus `opts.kitchen`, sonst links vom Eingang gesehen), mit Hecke.
 *  - Feld hinter dem Haus (Regel 3), Zaun mit Pfosten und Tor zum Weg.
 *  - Koppel auf der anderen Seite, vorn (Regel 4), Obstgarten hinter dem Garten.
 *  - Zwischen den Zonen und um das Haus bleiben ≥ 2 bzw. 3 Blöcke für Wege (Regel 6); das Grundstück wächst bei
 *    Bedarf, schrumpft aber nie.
 */
import { CellSet, type Cell, type HorizontalDir } from '@mcda/core';
import type { BuildingInfo } from './building.js';
import { DIR_OFFSET } from './grid.js';
import { PLOT_LIMITS, type Plot, type SiteLighting, type ZoneEdge, type ZoneKind } from './model.js';

export type SiteTemplateId = 'homestead';
export const SITE_TEMPLATES: readonly SiteTemplateId[] = ['homestead'];

export interface TemplateZone {
  readonly kind: ZoneKind;
  readonly cells: CellSet;
  /** Rand nur, wenn er vom Standard der Zonenart abweicht. */
  readonly edge?: ZoneEdge;
}

export interface SiteTemplatePlan {
  readonly template: SiteTemplateId;
  /** Grundstück nach der Vorlage (umfasst das alte). */
  readonly plot: Plot;
  readonly zones: readonly TemplateZone[];
  readonly lighting: SiteLighting;
  readonly styleId: string;
  /** Blickrichtung der Haustür (vorn). */
  readonly front: HorizontalDir;
}

export interface TemplateOptions {
  /** Grundfläche der Küche (Raumtyp `kitchen`) – der Garten liegt auf ihrer Seite. */
  readonly kitchen?: CellSet;
  /** Beleuchtung (Standard 'paths'). */
  readonly lighting?: SiteLighting;
  /** Geländestil (Standard 'homestead'); den bisherigen Stil übergeben, um ihn zu behalten. */
  readonly styleId?: string;
}

/** Abstand der Zonen zum Haus (Grundfläche + Überstand) bzw. untereinander. */
const HOUSE_GAP = 3;
const ZONE_GAP = 2;
const MIN_CELLS = 20;

interface Rect {
  readonly kind: ZoneKind;
  readonly u: readonly [number, number];
  readonly v: readonly [number, number];
  readonly edge?: ZoneEdge;
}

/** Plan einer Vorlage für Gebäude und Grundstück (rein, deterministisch). */
export function planTemplate(template: SiteTemplateId, building: BuildingInfo, plot: Plot, opts: TemplateOptions = {}): SiteTemplatePlan {
  if (!SITE_TEMPLATES.includes(template)) throw new Error(`Unbekannte Vorlage ${template}`);
  const core = building.footprint.union(building.covered);
  const b = core.bounds() ?? { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
  const door = building.doors.find((d) => d.outward === 'south') ?? building.doors[0];
  const front: HorizontalDir = door?.outward ?? 'south';
  const origin: Cell = door?.cell ?? [Math.round((b.minX + b.maxX) / 2), b.maxZ];
  // lokales Raster: v = nach vorn (Türrichtung), u = quer (F um 90° gedreht)
  const F = DIR_OFFSET[front];
  const U: readonly [number, number] = [-F[1], F[0]];
  const local = ([x, z]: Cell): [number, number] => {
    const dx = x - origin[0];
    const dz = z - origin[1];
    return [dx * U[0] + dz * U[1], dx * F[0] + dz * F[1]];
  };
  const world = (u: number, v: number): Cell => [origin[0] + u * U[0] + v * F[0], origin[1] + u * U[1] + v * F[1]];
  const lc = core.toArray().map(local);
  const uMin = Math.min(...lc.map((c) => c[0]));
  const uMax = Math.max(...lc.map((c) => c[0]));
  const vBack = Math.min(...lc.map((c) => c[1]));
  const vFront = Math.max(...lc.map((c) => c[1]));
  // Küchenseite: +u oder −u (Standard +u = links vom Eingang aus gesehen, wie in der S1-Skizze)
  let side = 1;
  if (opts.kitchen !== undefined && !opts.kitchen.isEmpty) {
    const ku = opts.kitchen.toArray().map((c) => local(c)[0]);
    side = ku.reduce((s, u) => s + u, 0) / ku.length >= (uMin + uMax) / 2 ? 1 : -1;
  }
  const g = HOUSE_GAP;
  const beside = (s: number, width: number): readonly [number, number] => (s > 0 ? [uMax + g, uMax + g + width - 1] : [uMin - g - width + 1, uMin - g]);
  const rects: Rect[] = [
    { kind: 'yard', u: [-6, 6], v: [vFront + g, vFront + g + 8] },
    { kind: 'field', u: [uMin - 2, uMax + 2], v: [vBack - g - 12, vBack - g] },
    { kind: 'garden', u: beside(side, 10), v: [Math.min(vBack, vFront - 6), vFront], edge: 'hedge' },
    { kind: 'paddock', u: beside(-side, 11), v: [vFront - 2, vFront + g + 6] },
    { kind: 'orchard', u: beside(side, 10), v: [vBack - g - 12, vBack - g - 1] },
  ];
  const toCells = (r: Rect): Cell[] => {
    const out: Cell[] = [];
    for (let u = r.u[0]; u <= r.u[1]; u++) for (let v = r.v[0]; v <= r.v[1]; v++) out.push(world(u, v));
    return out;
  };
  // Grundstück: alles Geplante + 4 Rand (Wege außen herum), nie kleiner als bisher, höchstens PLOT_LIMITS.max
  const all = CellSet.of([...rects.flatMap(toCells), ...core.toArray()]).bounds()!;
  const grown = clampPlot({
    minX: Math.min(plot.minX, all.minX - 4), minZ: Math.min(plot.minZ, all.minZ - 4),
    maxX: Math.max(plot.maxX, all.maxX + 4), maxZ: Math.max(plot.maxZ, all.maxZ + 4),
  }, plot);
  const inside = (c: Cell): boolean => c[0] >= grown.minX && c[0] <= grown.maxX && c[1] >= grown.minZ && c[1] <= grown.maxZ;
  const zones: TemplateZone[] = [];
  let taken = CellSet.empty();
  const nearCore = dilate(core, g - 1);
  for (const r of rects) {
    const cells = CellSet.of(toCells(r).filter(inside)).difference(taken).difference(nearCore);
    const bb = cells.bounds();
    if (cells.size < MIN_CELLS || bb === undefined || Math.min(bb.maxX - bb.minX, bb.maxZ - bb.minZ) < 3) continue;
    zones.push({ kind: r.kind, cells, ...(r.edge !== undefined ? { edge: r.edge } : {}) });
    taken = taken.union(dilate(cells, ZONE_GAP));
  }
  return { template, plot: grown, zones, lighting: opts.lighting ?? 'paths', styleId: opts.styleId ?? 'homestead', front };
}

/** Zellen im Chebyshev-Abstand ≤ r. */
function dilate(cells: CellSet, r: number): CellSet {
  const out: Cell[] = [];
  for (const [x, z] of cells) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) out.push([x + dx, z + dz]);
  return CellSet.of(out);
}

/** Grundstück auf PLOT_LIMITS.max je Achse begrenzen (das alte Grundstück bleibt enthalten). */
function clampPlot(p: Plot, old: Plot): Plot {
  const fit = (lo: number, hi: number, oLo: number, oHi: number): [number, number] => {
    if (hi - lo + 1 <= PLOT_LIMITS.max) return [lo, hi];
    const mid = Math.round((oLo + oHi) / 2);
    const a = Math.max(lo, Math.min(oLo, mid - Math.floor(PLOT_LIMITS.max / 2)));
    return [a, a + PLOT_LIMITS.max - 1];
  };
  const [minX, maxX] = fit(p.minX, p.maxX, old.minX, old.maxX);
  const [minZ, maxZ] = fit(p.minZ, p.maxZ, old.minZ, old.maxZ);
  return { minX, minZ, maxX, maxZ };
}
