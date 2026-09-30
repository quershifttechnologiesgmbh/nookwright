import { CellSet, hashSeed } from '@mcda/core';
import type { BuildingInfo } from './building.js';
import type { SiteEvent } from './events.js';
import {
  ENCLOSABLE_KINDS, PLOT_LIMITS, SCULPT_LIMIT, SITE_LIGHTINGS, VEGETATION_LIMIT, ZONE_EDGES, ZONE_KINDS, inPlot, plotSize,
  type Plot, type SiteLighting, type SiteState, type VegetationDensity, type Zone, type ZoneEdge, type ZoneId, type ZoneKind,
} from './model.js';
import { applySiteEvent } from './reducer.js';
import { planTemplate, type SiteTemplateId, type TemplateOptions } from './template.js';

export class SiteError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SiteError';
  }
}

export interface CreateSite {
  readonly id: string;
  readonly projectId: string;
  readonly seed: number;
  readonly styleId: string;
  readonly plot: Plot;
}

/**
 * Aggregat-Wurzel „Gelände“ (Site). Befehle prüfen die Invarianten, erzeugen Domain Events und wenden sie an;
 * der Zustand folgt allein aus der Event-Historie (Undo = Historie kürzen und neu abspielen).
 *
 * Invarianten:
 *  1. Das Grundstück ist ein Rechteck mit 4 … 512 Blöcken je Achse.
 *  2. Zonen-Zellen liegen im Grundstück; eine Zelle gehört zu höchstens einer Zone (neues Malen übermalt).
 *  3. Eine Zone ohne Zellen wird entfernt.
 *  4. Terraforming liegt im Grundstück und bleibt innerhalb ±SCULPT_LIMIT.
 *  5. `rerollCount` steigt nur; `generatorSeed = hash(seed, rerollCount)`.
 *  6. Ein Zonenrand gibt es nur für Feld, Garten, Obstgarten und Koppel.
 */
export class Site {
  private constructor(
    private current: SiteState,
    private readonly log: SiteEvent[],
  ) {}

  static create(cmd: CreateSite): Site {
    checkPlot(cmd.plot);
    if (cmd.styleId.length === 0) throw new SiteError('style.empty', 'Geländestil fehlt');
    const e: SiteEvent = { type: 'SiteCreated', id: cmd.id, projectId: cmd.projectId, seed: cmd.seed >>> 0, styleId: cmd.styleId, plot: { ...cmd.plot } };
    return new Site(applySiteEvent(undefined, e), [e]);
  }

  static fromHistory(events: readonly SiteEvent[]): Site {
    if (events.length === 0 || events[0]!.type !== 'SiteCreated') throw new SiteError('history', 'Historie muss mit SiteCreated beginnen');
    let s: SiteState | undefined;
    for (const e of events) s = applySiteEvent(s, e);
    return new Site(s!, [...events]);
  }

  get state(): SiteState {
    return this.current;
  }

  get history(): readonly SiteEvent[] {
    return this.log;
  }

  /** Seed des Generators: ändert sich nur durch Neu-Würfeln. */
  get generatorSeed(): number {
    return siteSeed(this.current);
  }

  undo(n = 1): Site {
    if (this.log.length - n < 1) throw new SiteError('undo', 'Nichts mehr rückgängig zu machen');
    return Site.fromHistory(this.log.slice(0, this.log.length - n));
  }

  zone(id: ZoneId): Zone {
    const z = this.current.zones.find((x) => x.id === id);
    if (z === undefined) throw new SiteError('zone.unknown', `Unbekannte Zone ${id}`);
    return z;
  }

  // ------------------------------------------------------------------ Befehle

  resizePlot(plot: Plot): SiteEvent[] {
    checkPlot(plot);
    const outside = (cells: CellSet): CellSet => CellSet.of([...cells].filter(([x, z]) => !inPlot(plot, x, z)));
    const events: SiteEvent[] = [];
    for (const z of this.current.zones) events.push(...this.loseCells(z, outside(z.cells)));
    events.push({ type: 'PlotResized', plot: { ...plot } });
    return this.commit(events);
  }

  setStyle(styleId: string): SiteEvent[] {
    if (styleId.length === 0) throw new SiteError('style.empty', 'Geländestil fehlt');
    if (styleId === this.current.styleId) return [];
    return this.commit([{ type: 'TerrainStyleChanged', styleId }]);
  }

  reroll(): SiteEvent[] {
    return this.commit([{ type: 'SiteRerolled', rerollCount: this.current.rerollCount + 1 }]);
  }

  /** Malt einen Außenbereich. Zellen außerhalb des Grundstücks werden abgeschnitten; andere Zonen verlieren die Zellen. */
  paintZone(kind: ZoneKind, cells: CellSet): SiteEvent[] {
    if (!ZONE_KINDS.includes(kind)) throw new SiteError('zone.kind', `Unbekannte Zonenart ${kind}`);
    const inside = this.clip(cells);
    if (inside.isEmpty) throw new SiteError('zone.empty', 'Keine Zelle im Grundstück');
    const events = this.takeCells(inside);
    events.push({ type: 'ZonePainted', zoneId: `z${this.current.seq}`, kind, cells: inside.toArray() });
    return this.commit(events);
  }

  eraseZones(cells: CellSet): SiteEvent[] {
    return this.commit(this.takeCells(cells));
  }

  setZoneKind(id: ZoneId, kind: ZoneKind): SiteEvent[] {
    if (!ZONE_KINDS.includes(kind)) throw new SiteError('zone.kind', `Unbekannte Zonenart ${kind}`);
    if (this.zone(id).kind === kind) return [];
    return this.commit([{ type: 'ZoneKindChanged', zoneId: id, kind }]);
  }

  /** Terraforming-Pinsel: anheben (+amount) bzw. senken (−amount) als Höhen-Delta. */
  sculpt(op: 'raise' | 'lower', cells: CellSet, amount = 1): SiteEvent[] {
    if (!Number.isInteger(amount) || amount <= 0) throw new SiteError('sculpt.amount', 'Pinselstärke muss eine positive ganze Zahl sein');
    const inside = this.clip(cells);
    if (inside.isEmpty) return [];
    return this.commit([{ type: 'TerrainSculpted', cells: inside.toArray(), amount: op === 'raise' ? amount : -amount }]);
  }

  /** Terraforming-Pinsel „ebnen“: feste Höhe relativ zur Grundhöhe (0 = Bodenplatte des Gebäudes). */
  flatten(cells: CellSet, level: number): SiteEvent[] {
    if (!Number.isInteger(level) || Math.abs(level) > SCULPT_LIMIT) throw new SiteError('sculpt.level', `Höhe muss ganzzahlig in ±${SCULPT_LIMIT} liegen`);
    const inside = this.clip(cells);
    if (inside.isEmpty) return [];
    return this.commit([{ type: 'TerrainFlattened', cells: inside.toArray(), level }]);
  }

  resetTerrain(cells: CellSet): SiteEvent[] {
    const touched = [...cells].filter(([x, z]) => this.current.sculpt.has(`${x},${z}`));
    if (touched.length === 0) return [];
    return this.commit([{ type: 'TerrainReset', cells: CellSet.of(touched).toArray() }]);
  }

  /** Zonenrand (Zaun, Hecke, offen) – nur für Feld, Garten, Obstgarten, Koppel (`ENCLOSABLE_KINDS`). */
  setZoneEdge(id: ZoneId, edge: ZoneEdge): SiteEvent[] {
    if (!ZONE_EDGES.includes(edge)) throw new SiteError('zone.edge', `Unbekannter Zonenrand ${edge}`);
    const z = this.zone(id);
    if (!ENCLOSABLE_KINDS.includes(z.kind)) throw new SiteError('zone.edge', `Zone ${id} (${z.kind}) hat keinen Rand`);
    if (z.edge === edge) return [];
    return this.commit([{ type: 'ZoneEdgeChanged', zoneId: id, edge }]);
  }

  /** Außenbeleuchtung des Grundstücks ('none' | 'paths' | 'spawnproof'). */
  setLighting(lighting: SiteLighting): SiteEvent[] {
    if (!SITE_LIGHTINGS.includes(lighting)) throw new SiteError('lighting', `Unbekannte Beleuchtung ${lighting}`);
    if (this.current.lighting === lighting) return [];
    return this.commit([{ type: 'SiteLightingChanged', lighting }]);
  }

  /** Vegetationsdichte je Ebene (Faktor 0 … 2 auf die Dichten des Geländestils). */
  setVegetation(v: VegetationDensity): SiteEvent[] {
    const vals = [v.trees, v.bushes, v.ground];
    if (!vals.every((x) => Number.isFinite(x) && x >= 0 && x <= VEGETATION_LIMIT)) throw new SiteError('vegetation', `Vegetationsdichte muss in 0 … ${VEGETATION_LIMIT} liegen`);
    const cur = this.current.vegetation;
    if (cur !== undefined && cur.trees === v.trees && cur.bushes === v.bushes && cur.ground === v.ground) return [];
    return this.commit([{ type: 'VegetationChanged', vegetation: { trees: v.trees, bushes: v.bushes, ground: v.ground } }]);
  }

  /** Terraforming-Pinsel „glätten“: Höhe = Mittelwert der Umgebung (Radius 2); Anheben/Senken wirken danach weiter. */
  smooth(cells: CellSet): SiteEvent[] {
    const inside = this.clip(cells);
    if (inside.isEmpty) return [];
    return this.commit([{ type: 'TerrainSmoothed', cells: inside.toArray() }]);
  }

  /**
   * Vorlage anwenden (research/18 S1 „Gehöft“): ersetzt alle Zonen durch den Plan der Vorlage, vergrößert das
   * Grundstück bei Bedarf und setzt Beleuchtung und Geländestil. Undo wie gewohnt über die zurückgegebenen Events.
   */
  applyTemplate(template: SiteTemplateId, building: BuildingInfo, opts: TemplateOptions = {}): SiteEvent[] {
    const plan = planTemplate(template, building, this.current.plot, opts);
    const p = this.current.plot;
    const events: SiteEvent[] = [];
    if (plan.plot.minX !== p.minX || plan.plot.minZ !== p.minZ || plan.plot.maxX !== p.maxX || plan.plot.maxZ !== p.maxZ) {
      checkPlot(plan.plot);
      events.push({ type: 'PlotResized', plot: { ...plan.plot } });
    }
    for (const z of this.current.zones) events.push({ type: 'ZoneRemoved', zoneId: z.id });
    let seq = this.current.seq;
    for (const z of plan.zones) {
      const zoneId = `z${seq++}`;
      events.push({ type: 'ZonePainted', zoneId, kind: z.kind, cells: z.cells.toArray() });
      if (z.edge !== undefined) events.push({ type: 'ZoneEdgeChanged', zoneId, edge: z.edge });
    }
    if (this.current.lighting !== plan.lighting) events.push({ type: 'SiteLightingChanged', lighting: plan.lighting });
    if (this.current.styleId !== plan.styleId) events.push({ type: 'TerrainStyleChanged', styleId: plan.styleId });
    return this.commit(events);
  }

  // ------------------------------------------------------------------ intern

  private clip(cells: CellSet): CellSet {
    const p = this.current.plot;
    return CellSet.of([...cells].filter(([x, z]) => inPlot(p, x, z)));
  }

  private loseCells(z: Zone, lost: CellSet): SiteEvent[] {
    const hit = z.cells.intersection(lost);
    if (hit.isEmpty) return [];
    if (hit.size === z.cells.size) return [{ type: 'ZoneRemoved', zoneId: z.id }];
    return [{ type: 'ZoneCellsLost', zoneId: z.id, cells: hit.toArray() }];
  }

  private takeCells(cells: CellSet): SiteEvent[] {
    return this.current.zones.flatMap((z) => this.loseCells(z, cells));
  }

  private commit(events: SiteEvent[]): SiteEvent[] {
    for (const e of events) {
      this.current = applySiteEvent(this.current, e);
      this.log.push(e);
    }
    return events;
  }
}

/** Seed des Generators für einen Zustand (auch ohne Aggregat, z. B. nach dem Laden). */
export function siteSeed(s: SiteState): number {
  return hashSeed(s.seed, 'site', s.rerollCount);
}

function checkPlot(p: Plot): void {
  const { w, d } = plotSize(p);
  if (![p.minX, p.minZ, p.maxX, p.maxZ].every(Number.isInteger)) throw new SiteError('plot.int', 'Grundstücksgrenzen müssen ganzzahlig sein');
  if (w < PLOT_LIMITS.min || d < PLOT_LIMITS.min || w > PLOT_LIMITS.max || d > PLOT_LIMITS.max) {
    throw new SiteError('plot.size', `Grundstück ${w} × ${d} außerhalb ${PLOT_LIMITS.min} … ${PLOT_LIMITS.max}`);
  }
}

/** Runder Pinsel (Zonen, Wege, Terraforming): Zellen mit Abstand ≤ radius (euklidisch) um die Mitte. */
export function brushCells(center: readonly [number, number], radius: number): CellSet {
  const r = Math.max(0, Math.floor(radius));
  const out: Array<readonly [number, number]> = [];
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (dx * dx + dz * dz <= radius * radius + 0.25) out.push([center[0] + dx, center[1] + dz]);
  return CellSet.of(out);
}
