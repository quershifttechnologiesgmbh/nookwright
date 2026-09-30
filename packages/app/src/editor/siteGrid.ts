/**
 * Reine Hilfen für den Plan „Umgebung“: Sichtfenster (Zoom/Verschieben), Werkzeuge und Gesten, Mauerzug zeichnen
 * wie in Tiny Glade (Punkte klicken, Doppelklick beendet, Klick auf den ersten Punkt schließt den Ring).
 */
import type { Bounds2, Cell } from '@mcda/core';
import { brushCells, type Plot, type ZoneKind } from '@mcda/terrain';
import { BRUSH_SCULPTS, BRUSH_ZONES, towerSize, type SculptTool, type StructureItem } from '../surroundings.js';
import type { Command } from '../ui/shortcuts.js';
import { GRID, type Rect } from '../usecases.js';

/** Werkzeuge im Modus Umgebung. */
export type SiteTool = 'select' | 'zone' | 'sculpt' | 'plot' | 'wall' | 'gate' | 'tower' | 'windmill' | 'annex';

/**
 * Befehl (Taste, Tabelle `SITE_SHORTCUTS` in ui/shortcuts.ts) → Werkzeug im Modus Umgebung: die Haus-Tasten in neuer
 * Bedeutung (S Auswählen, M Zone, E Formen, T Turm) und eigene Tasten (W Mauer, O Tor, U Windmühle).
 */
export const SITE_TOOL_FOR_COMMAND: Partial<Readonly<Record<Command, SiteTool>>> = {
  'tool.select': 'select', 'tool.paint': 'zone', 'tool.erase': 'sculpt', 'tool.stairs': 'tower', 'site.wall': 'wall', 'site.gate': 'gate', 'site.windmill': 'windmill',
};

/** Einstellung des Werkzeugs „Formen“. */
export interface SculptChoice {
  readonly tool: SculptTool;
  readonly amount: number;
  readonly level: number;
  /** Pinsel-Radius (Glätten). */
  readonly radius: number;
}

// ---------------------------------------------------------------------------------------------- Pinsel

/** Pinsel-Radius, wenn das Werkzeug mit dem runden Pinsel malt (Weg, Glätten), sonst `undefined` (Rechteck). */
export function brushRadius(tool: SiteTool, zoneKind: ZoneKind, sculpt: SculptChoice, pathRadius: number): number | undefined {
  if (tool === 'zone' && BRUSH_ZONES.has(zoneKind)) return pathRadius;
  if (tool === 'sculpt' && BRUSH_SCULPTS.has(sculpt.tool)) return sculpt.radius;
  return undefined;
}

/**
 * Zellen, die der runde Pinsel (`brushCells` der Domäne) auf dem Weg von `from` nach `to` überstreicht – in Schritten
 * von höchstens einer Zelle, damit schnelle Mausbewegungen keine Lücken lassen.
 */
export function strokeCells(from: Cell, to: Cell, radius: number): Cell[] {
  const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  const seen = new Set<string>();
  const out: Cell[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const c: Cell = [Math.round(from[0] + (to[0] - from[0]) * t), Math.round(from[1] + (to[1] - from[1]) * t)];
    for (const cell of brushCells(c, radius)) {
      const k = `${cell[0]},${cell[1]}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push([cell[0], cell[1]]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- Plan-Karte

/** Wegrang der Plan-Karte (`SiteResult.plan.path`): 3 Hauptweg, 2 Nebenweg, 1 Pfad. */
export const PATH_RANKS: ReadonlyArray<{ readonly rank: 1 | 2 | 3; readonly label: string; readonly color: number }> = [
  { rank: 3, label: 'Hauptweg', color: 0xd9c8a0 },
  { rank: 2, label: 'Nebenweg', color: 0xc2a46a },
  { rank: 1, label: 'Pfad', color: 0x9c8a60 },
];

const mix = (a: number, b: number, t: number): number => {
  const ch = (s: number): number => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/**
 * Farbe einer Spalte der Plan-Karte: Wege nach Rang (deckend), sonst die Draufsicht (`base`) mit der Farbe der Zone
 * getönt. So sind Wegenetz und Zonen der Berechnung auch unter Bäumen und auf gleichfarbigem Boden lesbar.
 */
export function planColor(base: number, zoneColor: number | undefined, pathRank: number): number {
  const path = PATH_RANKS.find((p) => p.rank === pathRank);
  if (path !== undefined) return path.color;
  return zoneColor === undefined ? base : mix(base, zoneColor, 0.35);
}

/** Auswahl im Modus Umgebung: ein Bauwerk oder eine Zone. */
export type SiteSelection = { readonly kind: 'structure'; readonly id: string } | { readonly kind: 'zone'; readonly id: string };

/** Sichtfenster: Weltkoordinate der linken oberen Ecke und Pixel je Zelle (CSS-Pixel). */
export interface SiteView {
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
}

export const VIEW_CELL = { min: 2, max: 40 } as const;

/** Bereich, den der Plan beim Einpassen zeigt: Raster des Hauses, Grundstück, alle Bauwerke. */
export function planBounds(plot: Plot | undefined, structures: readonly StructureItem[], pad = 3): Bounds2 {
  let minX = 0;
  let minZ = 0;
  let maxX = GRID.width - 1;
  let maxZ = GRID.depth - 1;
  const add = (x: number, z: number, r = 0): void => {
    minX = Math.min(minX, x - r);
    minZ = Math.min(minZ, z - r);
    maxX = Math.max(maxX, x + r);
    maxZ = Math.max(maxZ, z + r);
  };
  if (plot !== undefined) {
    add(plot.minX, plot.minZ);
    add(plot.maxX, plot.maxZ);
  }
  for (const item of structures) {
    if (item.kind === 'wall') for (const [x, z] of item.plan.points) add(x, z, 3);
    else if (item.kind !== 'parapet') add(item.spec.center[0], item.spec.center[1], (towerSize(item.spec) + 1) / 2 + (item.kind === 'windmill' ? 8 : 0));
  }
  return { minX: minX - pad, minZ: minZ - pad, maxX: maxX + pad, maxZ: maxZ + pad };
}

/** Sichtfenster, das `b` ganz zeigt und in der Fläche zentriert. */
export function fitView(b: Bounds2, widthPx: number, heightPx: number): SiteView {
  const w = b.maxX - b.minX + 1;
  const d = b.maxZ - b.minZ + 1;
  const cell = Math.max(VIEW_CELL.min, Math.min(VIEW_CELL.max, Math.min(widthPx / w, heightPx / d)));
  return { x0: b.minX - (widthPx / cell - w) / 2, z0: b.minZ - (heightPx / cell - d) / 2, cell };
}

/** Zelle unter einem Punkt (CSS-Pixel relativ zur Zeichenfläche). */
export function viewCell(v: SiteView, px: number, py: number): Cell {
  return [Math.floor(v.x0 + px / v.cell), Math.floor(v.z0 + py / v.cell)];
}

/** Zoomen um einen Punkt: die Weltstelle unter dem Mauszeiger bleibt stehen. */
export function zoomView(v: SiteView, factor: number, px: number, py: number): SiteView {
  const cell = Math.max(VIEW_CELL.min, Math.min(VIEW_CELL.max, v.cell * factor));
  const wx = v.x0 + px / v.cell;
  const wz = v.z0 + py / v.cell;
  return { x0: wx - px / cell, z0: wz - py / cell, cell };
}

export function panView(v: SiteView, dxPx: number, dyPx: number): SiteView {
  return { ...v, x0: v.x0 - dxPx / v.cell, z0: v.z0 - dyPx / v.cell };
}

// ---------------------------------------------------------------------------------------------- Mauerzug

/** Umschalt: auf 0°, 45°, 90° … zum vorigen Punkt einrasten (gerade Mauern sehen im Raster am besten aus). */
export function snapPoint(prev: Cell | undefined, cell: Cell, snap: boolean): Cell {
  if (!snap || prev === undefined) return cell;
  const dx = cell[0] - prev[0];
  const dz = cell[1] - prev[1];
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  if (ax >= 2 * az) return [cell[0], prev[1]];
  if (az >= 2 * ax) return [prev[0], cell[1]];
  const m = Math.round((ax + az) / 2);
  return [prev[0] + Math.sign(dx) * m, prev[1] + Math.sign(dz) * m];
}

/** Ergebnis eines Klicks im Mauer-Werkzeug. */
export type DraftStep = { readonly points: readonly Cell[]; readonly done?: undefined } | { readonly points: readonly Cell[]; readonly done: 'ring' };

/** Wie nah (Zellen, Tschebyschow) ein Klick am ersten Punkt liegen muss, um den Ring zu schließen. */
export const CLOSE_SNAP = 1;

/**
 * Klick im Mauer-Werkzeug: Punkt anhängen (gleiche Zelle wie der letzte Punkt zählt nicht – so setzt ein Doppelklick
 * keinen Doppelpunkt). Klick auf den ersten Punkt (ab 3 Punkten) schließt den Ring.
 */
export function draftClick(points: readonly Cell[], cell: Cell): DraftStep {
  const first = points[0];
  if (first !== undefined && points.length >= 3 && Math.max(Math.abs(cell[0] - first[0]), Math.abs(cell[1] - first[1])) <= CLOSE_SNAP) {
    return { points, done: 'ring' };
  }
  const last = points[points.length - 1];
  if (last !== undefined && last[0] === cell[0] && last[1] === cell[1]) return { points };
  return { points: [...points, cell] };
}

/** Doppelklick/Enter: offenen Zug beenden (ab 2 Punkten), sonst `undefined`. */
export function draftFinish(points: readonly Cell[]): readonly Cell[] | undefined {
  return points.length >= 2 ? points : undefined;
}

// ---------------------------------------------------------------------------------------------- Gesten

export type SiteGesture =
  | { readonly kind: 'select'; readonly cell: Cell }
  | { readonly kind: 'drag'; readonly start: Cell; readonly end: Cell }
  | { readonly kind: 'zone'; readonly rect: Rect }
  | { readonly kind: 'eraseZone'; readonly rect: Rect }
  | { readonly kind: 'sculpt'; readonly rect: Rect }
  | { readonly kind: 'resetSculpt'; readonly rect: Rect }
  | { readonly kind: 'plot'; readonly rect: Rect }
  | { readonly kind: 'wallPoint'; readonly cell: Cell }
  | { readonly kind: 'wallUndoPoint' }
  | { readonly kind: 'gate'; readonly cell: Cell }
  | { readonly kind: 'removeGate'; readonly cell: Cell }
  | { readonly kind: 'place'; readonly cell: Cell }
  | { readonly kind: 'remove'; readonly cell: Cell }
  /** Pinselstrich (Weg, Glätten): links malt bzw. glättet, rechts radiert Zonen bzw. setzt auf natürlich. */
  | { readonly kind: 'brush'; readonly button: 'left' | 'right'; readonly cells: readonly Cell[] };

/**
 * Was eine abgeschlossene Geste bedeutet (wie im Grundriss: Klick wählt, Ziehen malt, rechts radiert):
 *  - Zone: Ziehen malt die Zone, Klick wählt, rechts radiert Zonen.
 *  - Formen: Ziehen/Klick formt, rechts setzt auf natürlich zurück.
 *  - Grundstück: Ziehen setzt das Grundstück, Klick wählt.
 *  - Mauer: Klick setzt einen Punkt, rechts nimmt den letzten zurück (Doppelklick beendet – eigenes Ereignis).
 *  - Tor: Klick auf eine Mauer setzt ein Tor, rechts entfernt es.
 *  - Turm/Windmühle/Anbau-Turm: Klick setzt (Anbau-Turm: an die Außenwand), rechts entfernt das Bauwerk unter dem Zeiger.
 *  - Auswählen: Klick wählt, Ziehen verschiebt (ein Bauwerk unter dem Startpunkt), rechts radiert Zonen.
 */
export function interpretSiteGesture(tool: SiteTool, button: 'left' | 'right', start: Cell, end: Cell): SiteGesture {
  const rect: Rect = { x1: start[0], z1: start[1], x2: end[0], z2: end[1] };
  const click = start[0] === end[0] && start[1] === end[1];
  switch (tool) {
    case 'wall':
      return button === 'right' ? { kind: 'wallUndoPoint' } : { kind: 'wallPoint', cell: end };
    case 'gate':
      return button === 'right' ? { kind: 'removeGate', cell: end } : { kind: 'gate', cell: end };
    case 'tower':
    case 'windmill':
    case 'annex':
      return button === 'right' ? { kind: 'remove', cell: end } : { kind: 'place', cell: end };
    case 'sculpt':
      return button === 'right' ? { kind: 'resetSculpt', rect } : { kind: 'sculpt', rect };
    case 'plot':
      if (button === 'right') return { kind: 'eraseZone', rect };
      return click ? { kind: 'select', cell: end } : { kind: 'plot', rect };
    case 'zone':
      if (button === 'right') return { kind: 'eraseZone', rect };
      return click ? { kind: 'select', cell: end } : { kind: 'zone', rect };
    case 'select':
      if (button === 'right') return { kind: 'eraseZone', rect };
      return click ? { kind: 'select', cell: end } : { kind: 'drag', start, end };
  }
}

/** Werkzeuge, bei denen Ziehen ein Rechteck aufzieht (Vorschau im Plan). */
export const RECT_TOOLS: ReadonlySet<SiteTool> = new Set<SiteTool>(['zone', 'sculpt', 'plot']);
