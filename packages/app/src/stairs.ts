/**
 * Treppen-Werkzeug (rein): Vorschau („Geist“) mit Gültigkeit und Begründung aus der Domäne, Trefferprüfung im
 * Grundriss, Geometrie zum Zeichnen. Die Geometrie selbst kommt aus `stairLayout`, die Prüfung aus `checkLink`
 * (@mcda/blueprint) – die App erfindet keine eigenen Treppenregeln, sie ergänzt nur „gesperrte Möbel im Weg“.
 */
import { checkLink, stairLayout, type LinkId, type ProjectState, type StairBlock, type StairLayout, type VerticalLink } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import { HORIZONTAL, type Cell, type HorizontalDir } from '@mcda/core';
import { floorLabel, specLink, stairsBlockedByFixed, type StairSpec } from './usecases.js';

/** Werkzeug-Einstellungen der Treppe (ohne Position). */
export type StairTool = Omit<StairSpec, 'floor' | 'origin'>;

export const DEFAULT_STAIR_TOOL: StairTool = { type: 'straight', facing: 'east', turn: 'right' };

/** Drehen im Uhrzeigersinn (Taste R): Nord → Ost → Süd → West. */
export function rotateFacing(f: HorizontalDir): HorizontalDir {
  return HORIZONTAL[(HORIZONTAL.indexOf(f) + 1) % 4]!;
}

export const FACING_LABEL: Readonly<Record<HorizontalDir, string>> = { north: 'Nord ↑', east: 'Ost →', south: 'Süd ↓', west: 'West ←' };

/** Etagenabstand zwischen `floor` und der Etage darüber (oder, ohne obere Etage, wie eine gleich hohe darüber). */
function riseOf(state: ProjectState, floor: number): number | undefined {
  const lo = state.floors.find((f) => f.index === floor);
  if (lo === undefined) return undefined;
  const up = state.floors.find((f) => f.index === floor + 1);
  return up === undefined ? lo.height + 1 : up.y0 - lo.y0;
}

/** Geometrie einer Treppe im aktuellen Zustand; `undefined`, wenn die Art den Etagenabstand nicht kann. */
export function linkLayout(state: ProjectState, link: Pick<VerticalLink, 'type' | 'origin' | 'facing' | 'turn' | 'floorIndex'>): StairLayout | undefined {
  const rise = riseOf(state, link.floorIndex);
  if (rise === undefined) return undefined;
  try {
    return stairLayout(link, rise);
  } catch {
    return undefined;
  }
}

export interface StairPreview {
  readonly valid: boolean;
  /** Begründung, wenn ungültig (Text der Domäne bzw. der App). */
  readonly reason?: string;
  /** Oberste Blöcke je Spalte der unteren Etage (Stufen, Podest, Pfosten, Leiter) – zum Zeichnen mit Laufrichtung. */
  readonly steps: readonly StairBlock[];
  /** Reserviert auf der unteren Etage: Grundfläche + Antritt (+ Leiter-Träger). */
  readonly lower: readonly Cell[];
  /** Reserviert auf der oberen Etage: Öffnung + oberste Stufe + Austritt. */
  readonly upper: readonly Cell[];
  /** Antritt (unten) und Austritt (oben). */
  readonly entry?: Cell;
  readonly exit?: Cell;
}

/** Je Spalte der oberste Block (für Pfeile und Höhenschattierung). */
function topBlocks(layout: StairLayout): StairBlock[] {
  const top = new Map<string, StairBlock>();
  for (const b of layout.blocks) {
    const k = `${b.cell[0]},${b.cell[1]}`;
    const old = top.get(k);
    if (old === undefined || b.dy > old.dy || (b.dy === old.dy && b.part !== 'fill')) top.set(k, b);
  }
  return [...top.values()];
}

/**
 * Vorschau der Treppe an `origin` auf Etage `spec.floor`: Zellen beider Etagen und Gültigkeit mit Begründung.
 * Gültig heißt: `placeStairs` würde gelingen (Domäne: Kern eines Raums, keine Überschneidung; App: keine gesperrten
 * oder von Hand gesetzten Möbel im Weg).
 */
export function stairsPreview(state: ProjectState, catalog: Catalog | undefined, spec: StairSpec): StairPreview {
  const link = specLink(state, spec);
  const layout = linkLayout(state, link);
  const shape = layout === undefined
    ? { steps: [], lower: [spec.origin], upper: [] }
    : {
        steps: topBlocks(layout),
        lower: [...layout.footprint, layout.bottom.inside, ...(layout.support !== undefined ? [layout.support] : [])],
        upper: [...layout.holes, ...layout.top.filter((c) => !layout.holes.some((h) => h[0] === c[0] && h[1] === c[1])), layout.arrival.inside],
        entry: layout.bottom.inside,
        exit: layout.arrival.inside,
      };
  if (!state.floors.some((f) => f.index === spec.floor + 1)) {
    return { ...shape, valid: false, reason: `Keine Etage über ${floorLabel(spec.floor)} – erst eine Etage hinzufügen (+), dann die Treppe von hier nach oben setzen` };
  }
  const res = checkLink(state, link);
  if (typeof res === 'string') return { ...shape, valid: false, reason: res };
  const blocker = catalog === undefined ? undefined : stairsBlockedByFixed(state, catalog, spec);
  if (blocker !== undefined) return { ...shape, valid: false, reason: blocker };
  return { ...shape, valid: true };
}

/**
 * Treppe unter einer Zelle der angezeigten Etage: Grundfläche auf der unteren Etage, Öffnung und oberste Stufe auf
 * der oberen. Zugangszellen (Antritt, Austritt) gehören zum Raum, nicht zur Treppe.
 */
export function stairsAt(state: ProjectState, floor: number, cell: Cell): VerticalLink | undefined {
  const same = (c: Cell) => c[0] === cell[0] && c[1] === cell[1];
  for (const link of state.links) {
    const layout = linkLayout(state, link);
    if (layout === undefined) continue;
    if (link.floorIndex === floor && (layout.footprint.some(same) || (layout.support !== undefined && same(layout.support)))) return link;
    if (link.floorIndex + 1 === floor && (layout.holes.some(same) || layout.top.some(same))) return link;
  }
  return undefined;
}

/** Beschreibung einer Treppe für die UI, z. B. „Gerade Treppe EG → 1. OG, Laufrichtung Ost“. */
export function stairsLabel(link: VerticalLink, typeLabel: (t: VerticalLink['type']) => string): string {
  return `${typeLabel(link.type)} ${floorLabel(link.floorIndex)} → ${floorLabel(link.floorIndex + 1)}, Laufrichtung ${FACING_LABEL[link.facing]}`;
}

export type { LinkId };
