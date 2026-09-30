import { CellSet, cellKey } from '@mcda/core';
import type { SiteEvent } from './events.js';
import { SCULPT_LIMIT, inPlot, type SculptCell, type SiteState, type Zone } from './model.js';

const clampSculpt = (v: number): number => Math.max(-SCULPT_LIMIT, Math.min(SCULPT_LIMIT, v));

function idNum(id: string): number {
  const n = Number(id.slice(1));
  return Number.isFinite(n) ? n : 0;
}

function mapZone(s: SiteState, id: string, f: (z: Zone) => Zone): readonly Zone[] {
  return s.zones.map((z) => (z.id === id ? f(z) : z));
}

function updateSculpt(s: SiteState, cells: readonly (readonly [number, number])[], f: (old: SculptCell | undefined) => SculptCell | undefined): SiteState['sculpt'] {
  const next = new Map(s.sculpt);
  for (const [x, z] of cells) {
    const k = cellKey(x, z);
    const v = f(next.get(k));
    if (v === undefined || (v.delta === 0 && v.level === undefined && v.smooth !== true)) next.delete(k);
    else next.set(k, v);
  }
  return next;
}

/**
 * Reiner Reducer (wie beim Projekt-Aggregat): keine Validierung, die macht das Aggregat vor dem Erzeugen der
 * Events. So bleibt Replay (Undo, Laden) immer möglich.
 */
export function applySiteEvent(state: SiteState | undefined, e: SiteEvent): SiteState {
  if (e.type === 'SiteCreated') {
    return {
      id: e.id, projectId: e.projectId, seed: e.seed, styleId: e.styleId, plot: e.plot,
      rerollCount: 0, zones: [], sculpt: new Map(), seq: 1,
    };
  }
  if (state === undefined) throw new Error(`Event ${e.type} vor SiteCreated`);
  const s = state;
  switch (e.type) {
    case 'PlotResized': {
      const sculpt = new Map([...s.sculpt].filter(([k]) => {
        const [x, z] = k.split(',').map(Number) as [number, number];
        return inPlot(e.plot, x, z);
      }));
      return { ...s, plot: e.plot, sculpt };
    }
    case 'TerrainStyleChanged':
      return { ...s, styleId: e.styleId };
    case 'SiteRerolled':
      return { ...s, rerollCount: e.rerollCount };
    case 'ZonePainted':
      return {
        ...s,
        zones: [...s.zones, { id: e.zoneId, kind: e.kind, cells: CellSet.of(e.cells) }],
        seq: Math.max(s.seq, idNum(e.zoneId) + 1),
      };
    case 'ZoneCellsLost':
      return { ...s, zones: mapZone(s, e.zoneId, (z) => ({ ...z, cells: z.cells.difference(CellSet.of(e.cells)) })) };
    case 'ZoneRemoved':
      return { ...s, zones: s.zones.filter((z) => z.id !== e.zoneId) };
    case 'ZoneKindChanged':
      return { ...s, zones: mapZone(s, e.zoneId, (z) => ({ ...z, kind: e.kind })) };
    case 'TerrainSculpted':
      return {
        ...s,
        sculpt: updateSculpt(s, e.cells, (o) => ({ ...(o ?? {}), delta: clampSculpt((o?.delta ?? 0) + e.amount) })),
      };
    case 'TerrainFlattened':
      return { ...s, sculpt: updateSculpt(s, e.cells, () => ({ delta: 0, level: clampSculpt(e.level) })) };
    case 'TerrainReset':
      return { ...s, sculpt: updateSculpt(s, e.cells, () => undefined) };
    case 'ZoneEdgeChanged':
      return { ...s, zones: mapZone(s, e.zoneId, (z) => ({ ...z, edge: e.edge })) };
    case 'SiteLightingChanged':
      return { ...s, lighting: e.lighting };
    case 'VegetationChanged':
      return { ...s, vegetation: e.vegetation };
    case 'TerrainSmoothed':
      return { ...s, sculpt: updateSculpt(s, e.cells, (o) => ({ ...(o ?? { delta: 0 }), smooth: true })) };
  }
}
