import type { CellList, Plot, SiteLighting, VegetationDensity, ZoneEdge, ZoneId, ZoneKind } from './model.js';

/** Domain Events des Gelände-Aggregats. Rein serialisierbar (Undo, Speichern). */
export type SiteEvent =
  | {
      readonly type: 'SiteCreated';
      readonly id: string;
      readonly projectId: string;
      readonly seed: number;
      readonly styleId: string;
      readonly plot: Plot;
    }
  /** Neues Grundstück; Zonen-Zellen außerhalb sind vorher per `ZoneCellsLost`/`ZoneRemoved` entfernt, Terraforming außerhalb entfällt. */
  | { readonly type: 'PlotResized'; readonly plot: Plot }
  | { readonly type: 'TerrainStyleChanged'; readonly styleId: string }
  | { readonly type: 'SiteRerolled'; readonly rerollCount: number }
  | { readonly type: 'ZonePainted'; readonly zoneId: ZoneId; readonly kind: ZoneKind; readonly cells: CellList }
  | { readonly type: 'ZoneCellsLost'; readonly zoneId: ZoneId; readonly cells: CellList }
  | { readonly type: 'ZoneRemoved'; readonly zoneId: ZoneId }
  | { readonly type: 'ZoneKindChanged'; readonly zoneId: ZoneId; readonly kind: ZoneKind }
  /** Anheben (+) bzw. Senken (−): `amount` wird auf das Delta jeder Zelle addiert (begrenzt auf ±SCULPT_LIMIT). */
  | { readonly type: 'TerrainSculpted'; readonly cells: CellList; readonly amount: number }
  /** Ebnen: feste Höhe `level` (relativ), Delta der Zellen zurück auf 0. */
  | { readonly type: 'TerrainFlattened'; readonly cells: CellList; readonly level: number }
  /** Terraforming der Zellen verwerfen (natürliches Gelände). */
  | { readonly type: 'TerrainReset'; readonly cells: CellList }
  /** Zonenrand (Zaun, Hecke, offen) – additiv (T2). */
  | { readonly type: 'ZoneEdgeChanged'; readonly zoneId: ZoneId; readonly edge: ZoneEdge }
  /** Außenbeleuchtung des Grundstücks – additiv (T2). */
  | { readonly type: 'SiteLightingChanged'; readonly lighting: SiteLighting }
  /** Vegetationsdichte (Faktoren auf den Geländestil) – additiv (T2). */
  | { readonly type: 'VegetationChanged'; readonly vegetation: VegetationDensity }
  /** Glätten: die Zellen bekommen den Mittelwert ihrer Umgebung (Radius 2) – additiv (T2). */
  | { readonly type: 'TerrainSmoothed'; readonly cells: CellList };

export type SiteEventType = SiteEvent['type'];
