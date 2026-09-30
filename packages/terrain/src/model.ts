import type { Cell, CellSet } from '@mcda/core';

/**
 * Kontext „Gelände“ (Site): das Grundstück um die Base. Eigenes Aggregat, getrennt vom Projekt-Aggregat;
 * es verweist nur über `projectId` auf das Projekt und sieht das Gebäude über `BuildingInfo` (aus der Hülle).
 *
 * Höhen sind im Aggregat RELATIV zur Geländegrundhöhe (0 = Oberkante der Bodenplatte des Gebäudes, y0).
 * So bleibt das Grundstück gültig, wenn das Gebäude seine Etagenhöhe ändert.
 */

export type ZoneId = string;

/**
 * Außenbereich (Glossar): Wiese, Garten, Feld, Weg/Hof, Teich; dazu (research/18 G2, V4, A3) Platz/Anger,
 * Obstgarten, Koppel und gemalter Weg (`path`: folgt dem Gelände, wird ans Wegenetz angeschlossen).
 */
export type ZoneKind = 'meadow' | 'garden' | 'field' | 'yard' | 'pond' | 'plaza' | 'orchard' | 'paddock' | 'path';
export const ZONE_KINDS: readonly ZoneKind[] = ['meadow', 'garden', 'field', 'yard', 'pond', 'plaza', 'orchard', 'paddock', 'path'];

/** Zonenrand (research/18 Z1/Z3): Zaun (mit Pfosten im Takt), Hecke oder offen. Tore liegen immer am Weg (Z4). */
export type ZoneEdge = 'none' | 'fence' | 'hedge';
export const ZONE_EDGES: readonly ZoneEdge[] = ['none', 'fence', 'hedge'];
/** Zonenarten, die einen Rand haben können (Ring aus Zaun oder Hecke mit Tor). */
export const ENCLOSABLE_KINDS: readonly ZoneKind[] = ['field', 'garden', 'orchard', 'paddock'];

/** Rand einer Zonenart ohne ausdrückliche Wahl: Feld und Koppel eingezäunt, sonst offen. */
export function defaultZoneEdge(kind: ZoneKind): ZoneEdge {
  return kind === 'field' || kind === 'paddock' ? 'fence' : 'none';
}

/** Wirksamer Rand einer Zone (Zonenarten ohne Rand: immer 'none'). */
export function zoneEdge(z: Pick<Zone, 'kind' | 'edge'>): ZoneEdge {
  return ENCLOSABLE_KINDS.includes(z.kind) ? (z.edge ?? defaultZoneEdge(z.kind)) : 'none';
}

/**
 * Außenbeleuchtung (research/18 L1): 'none' = nur Laternen der Zonen (Feld-, Hofpfosten), 'paths' = zusätzlich
 * Laternenpfähle an Kreuzungen und im Takt entlang der Wege, 'spawnproof' = außerdem gierig nachsetzen, bis jede
 * spawnfähige Geländezelle Blocklicht ≥ 1 hat.
 */
export type SiteLighting = 'none' | 'paths' | 'spawnproof';
export const SITE_LIGHTINGS: readonly SiteLighting[] = ['none', 'paths', 'spawnproof'];

/** Vegetationsdichte je Ebene als Faktor auf die Dichten des Geländestils (0 … 2, 1 = wie der Stil). */
export interface VegetationDensity {
  readonly trees: number;
  readonly bushes: number;
  readonly ground: number;
}
export const VEGETATION_LIMIT = 2;

/** Grundstück: Rechteck inklusive beider Ecken (Blockspalten x, z). */
export interface Plot {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** Gemalter Außenbereich: Zellmenge + Art. Zellen dürfen in mehrere Stücke zerfallen (jedes Stück wird einzeln angelegt). */
export interface Zone {
  readonly id: ZoneId;
  readonly kind: ZoneKind;
  readonly cells: CellSet;
  /** Rand (nur `ENCLOSABLE_KINDS`); fehlt = Standard der Zonenart (`defaultZoneEdge`). */
  readonly edge?: ZoneEdge;
}

/** Terraforming einer Spalte: `level` (ebnen, feste Höhe) ersetzt das natürliche Gelände, `delta` (anheben/senken) kommt dazu. */
export interface SculptCell {
  readonly delta: number;
  readonly level?: number;
  /** Glätten: Höhe = Mittelwert der Umgebung (Radius 2) – vor Anheben/Senken (additiv, T2). */
  readonly smooth?: boolean;
}

export type SculptOp = 'raise' | 'lower' | 'flatten' | 'smooth';

export interface SiteState {
  readonly id: string;
  readonly projectId: string;
  readonly seed: number;
  /** Geländestil (catalog/terrain): Relief, Fundament-Überblendung, Vegetation. */
  readonly styleId: string;
  readonly plot: Plot;
  /** Neu-Würfeln: steigt nur; Seed des Generators = hash(seed, rerollCount). */
  readonly rerollCount: number;
  readonly zones: readonly Zone[];
  /** Terraforming je Spalte, Schlüssel `cellKey(x, z)`. */
  readonly sculpt: ReadonlyMap<string, SculptCell>;
  /** Zähler für deterministische Zonen-IDs (z1, z2 …). */
  readonly seq: number;
  /** Außenbeleuchtung; fehlt = wie der Geländestil (`TerrainStyleDef.lighting`, sonst 'none'). */
  readonly lighting?: SiteLighting;
  /** Vegetationsdichte; fehlt = wie der Geländestil. */
  readonly vegetation?: VegetationDensity;
}

/** Grenzen: Grundstück 4 … 512 Blöcke je Achse, Terraforming ±24 Blöcke um die Grundhöhe. */
export const PLOT_LIMITS = { min: 4, max: 512 } as const;
export const SCULPT_LIMIT = 24;

/** Serialisierbare Zellenliste für Events. */
export type CellList = readonly Cell[];

export function plotSize(p: Plot): { readonly w: number; readonly d: number } {
  return { w: p.maxX - p.minX + 1, d: p.maxZ - p.minZ + 1 };
}

export function inPlot(p: Plot, x: number, z: number): boolean {
  return x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ;
}
