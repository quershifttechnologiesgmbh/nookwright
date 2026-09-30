/**
 * Gemeinsamer Arbeitszustand des Gelände-Generators (intern): Spaltenklassen, Masken und Zellenausgabe, die
 * `generateSite` aufbaut und die Bausteine (Zäune, Ausstattung, Licht) lesen bzw. ergänzen. Alle Arrays sind
 * nach `PlotGrid` indiziert.
 */
import type { ShellCell, ShellOrient } from '@mcda/blueprint';
import type { Vec3 } from '@mcda/core';
import type { BuildingInfo } from './building.js';
import type { PlotGrid } from './grid.js';
import type { ZoneKind } from './model.js';
import type { TerrainRole } from './roles.js';
import type { TerrainStyleDef } from './style.js';

/** Spaltenklassen (`mound` = Hügel über einem eingegrabenen Baukörper neben dem Grundriss, BT16). */
export const C = { meadow: 0, building: 1, pad: 2, field: 3, garden: 4, yard: 5, pond: 6, meadowZone: 7, plaza: 8, orchard: 9, paddock: 10, trail: 11, mound: 12 } as const;
export const ZONE_CLASS: Readonly<Record<ZoneKind, number>> = {
  meadow: C.meadowZone, garden: C.garden, field: C.field, yard: C.yard, pond: C.pond, plaza: C.plaza, orchard: C.orchard, paddock: C.paddock, path: C.trail,
};

export type Emit = (pos: Vec3, kind: 'terrain' | 'plant', role: TerrainRole, shape: string, orient?: ShellOrient) => boolean;

/** Nicht feste Pflanzen (keine Kollision, lassen Licht durch, Monster können darin spawnen). */
export const GROUND_PLANT_ROLES: ReadonlySet<string> = new Set([
  'flower_wild', 'flower_warm', 'flower_cool', 'grass_tuft', 'ground_cover', 'pond_plant', 'crop_wheat', 'crop_carrot', 'crop_potato', 'crop_beetroot',
]);

export interface Gen {
  readonly grid: PlotGrid;
  readonly seed: number;
  readonly style: TerrainStyleDef;
  readonly building: BuildingInfo;
  readonly cls: Uint8Array;
  readonly covered: Uint8Array;
  /** Bauwerke: 1 = Sperrfläche, 2 = Durchgang. */
  readonly struct: Uint8Array;
  readonly profile: Uint8Array;
  readonly lowered: Uint8Array;
  readonly padDist: Int32Array;
  readonly footDist: Int32Array;
  readonly doorDist: Int32Array;
  readonly padWidth: number;
  readonly exits: readonly number[];
  readonly top: Int32Array;
  readonly surface: string[];
  readonly water: Uint8Array;
  readonly bed: string[];
  readonly path: Uint8Array;
  /** Zellen, über die ein Weg führt (auch über Hof, Platz, Obstgarten); dort bleibt alles frei. */
  readonly route: Uint8Array;
  readonly blocked: Uint8Array;
  readonly plantCol: Uint8Array;
  /** Spalten mit einem Katalog-Objekt (Q3): Hof-Laternen und Ackerland lassen sie aus. */
  readonly propCol: Uint8Array;
  /**
   * Zellen der Katalog-Objekte für den Licht-Pass (Q3): `op` 0 = durchsichtig, 1 = undurchsichtig,
   * 2 = Laub (dämpft); `light` = eigene Lichtabgabe (Laternenpfahl, Standlaterne).
   */
  readonly propCells: Map<string, { readonly op: 0 | 1 | 2; readonly light: number }>;
  /** Spalten mit Zaun/Hecke/Tor eines Zonenrings. */
  readonly ring: Uint8Array;
  readonly out: Map<string, ShellCell>;
  readonly emit: Emit;
  readonly warnings: string[];
}
