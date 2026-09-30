/**
 * Treppen und Leitern zwischen zwei Etagen (research/03 §C8). Reine Geometrie, geteilt vom Aggregat
 * (Invariante: reservierte Zellen auf beiden Etagen) und der Hülle (Blöcke, Deckenöffnung, Geländer).
 *
 * Höhenmodell: `rise` = Etagenabstand Δ = y0(oben) − y0(unten) = lichte Höhe + 1. Jede Stufe hebt um 1,
 * `dy` zählt ab der unteren Bodenplatte. Die oberste Stufe liegt IN der oberen Bodenplatte (dy = Δ): nur so
 * kommt man ohne Sprung oben an (Stufe unter der Platte → 1 voller Block Höhenunterschied).
 * Kopffreiheit: wer auf einer Stufe mit dy steht, braucht dy+1 und dy+2 frei. Über allen Trittflächen mit
 * dy ∈ [Δ−2, Δ−1] fehlt deshalb die obere Bodenplatte („Deckenöffnung über den letzten 2 Stufen“).
 * Unter jeder Trittfläche ist die Spalte gefüllt (keine dunklen Hohlräume, in denen Monster spawnen).
 */
import { CellSet, cellKey, type Cell, type HorizontalDir } from '@mcda/core';
import type { Floor, ProjectState, Room, VerticalLink } from './model.js';
import { CCW, CW, OPP, STEP } from './shell/grid.js';
import { volumeFloors, volumeOf } from './volumes.js';

export type StairPart = 'tread' | 'landing' | 'fill' | 'post' | 'ladder' | 'support';

export interface StairBlock {
  readonly cell: Cell;
  /** Höhe über der unteren Bodenplatte (1 = erste Luftschicht, `rise` = obere Bodenplatte). */
  readonly dy: number;
  readonly part: StairPart;
  /** Stufe: Laufrichtung bergauf (= Minecraft `facing`, hohe Rückseite); Leiter: Blickrichtung weg von der Wand. */
  readonly facing?: HorizontalDir;
}

export interface StairAccess {
  /** Begehbare Zelle vor dem Antritt (untere Etage) bzw. nach dem Austritt (obere Etage). */
  readonly inside: Cell;
  /** Richtung von dieser Zelle zur Treppe. */
  readonly toward: HorizontalDir;
}

export interface StairLayout {
  /** Alle Blöcke der Treppe (die mit dy = rise liegen in der oberen Bodenplatte). */
  readonly blocks: readonly StairBlock[];
  /** Spalten der unteren Etage, die die Treppe belegt (Stufen, Unterbau, Pfosten; ohne Leiter-Träger). */
  readonly footprint: readonly Cell[];
  /** Zellen der oberen Etage ohne Bodenplatte, in die man fallen kann (Geländer ringsum). */
  readonly holes: readonly Cell[];
  /** Zellen der oberen Etage, in denen die Treppe die Bodenplatte ersetzt (oberste Stufe, Leiter). */
  readonly top: readonly Cell[];
  readonly bottom: StairAccess;
  readonly arrival: StairAccess;
  /** Nur Leiter: tragende Zelle hinter der Leiter (Wand, sonst setzt die Hülle einen Pfosten). */
  readonly support?: Cell;
}

export const STAIR_LIMITS = {
  /** Kleinster Etagenabstand (lichte Höhe 2). */
  minRise: 3,
  /** Wendeltreppe 3×3: höchstens 7 Stufen, damit Antritt und Austritt nicht zusammenfallen. */
  spiralMaxRise: 7,
} as const;

export class StairError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StairError';
  }
}

const at = (c: Cell, d: HorizontalDir, n = 1): Cell => [c[0] + STEP[d][0] * n, c[1] + STEP[d][1] * n];

function dirBetween(a: Cell, b: Cell): HorizontalDir {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  return dx > 0 ? 'east' : dx < 0 ? 'west' : dz > 0 ? 'south' : 'north';
}

/** Ring um eine Mittelzelle im Uhrzeigersinn (von oben, Norden oben): N, NE, E, SE, S, SW, W, NW. */
const RING: readonly Cell[] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

interface Column {
  readonly cell: Cell;
  readonly dy: number;
  readonly part: 'tread' | 'landing';
  readonly facing?: HorizontalDir;
}

/** Säulen mit Trittfläche → Blöcke (mit Unterbau), Deckenöffnung und oberste Zellen. */
function fromColumns(cols: readonly Column[], rise: number, extra: readonly StairBlock[], bottom: StairAccess, arrival: StairAccess): StairLayout {
  const blocks: StairBlock[] = [...extra];
  for (const c of cols) {
    for (let dy = 1; dy < c.dy; dy++) blocks.push({ cell: c.cell, dy, part: 'fill' });
    blocks.push({ cell: c.cell, dy: c.dy, part: c.part, ...(c.facing !== undefined ? { facing: c.facing } : {}) });
  }
  const footprint = CellSet.of([...cols.map((c) => c.cell), ...extra.map((b) => b.cell)]).toArray();
  return {
    blocks,
    footprint,
    holes: cols.filter((c) => c.dy >= rise - 2 && c.dy <= rise - 1).map((c) => c.cell),
    top: cols.filter((c) => c.dy === rise).map((c) => c.cell),
    bottom,
    arrival,
  };
}

/**
 * Geometrie einer Treppe für den Etagenabstand `rise`. Wirft `StairError`, wenn die Art den Abstand nicht kann.
 *
 * - straight: Δ Stufen in `facing`.
 * - l: ⌊Δ/2⌋ Stufen, Podest (Vollblock auf gleicher Höhe), dann der Rest nach rechts/links gedreht.
 * - u: ⌊Δ/2⌋ Stufen, Podest aus 2 Zellen quer, Rest gegenläufig daneben.
 * - spiral: 3×3 um einen Pfosten; die erste Stufe ist `origin`, die Mitte liegt rechts (bzw. links) davon.
 * - ladder: Leiter in `origin` an der Zelle `origin + facing`; oben durch ein Loch in der Bodenplatte.
 */
export function stairLayout(spec: Pick<VerticalLink, 'type' | 'origin' | 'facing' | 'turn'>, rise: number): StairLayout {
  const { type, origin: o, facing: f } = spec;
  if (!Number.isInteger(rise) || rise < STAIR_LIMITS.minRise) {
    throw new StairError('stairs.rise', `Etagenabstand ${rise} zu klein für eine Treppe (mindestens ${STAIR_LIMITS.minRise}, also lichte Höhe 2)`);
  }
  const right = (spec.turn ?? 'right') === 'right';
  const side = right ? CW[f] : CCW[f];
  const a = Math.floor(rise / 2);
  const b = rise - a;
  switch (type) {
    case 'straight': {
      const cols: Column[] = [];
      for (let k = 1; k <= rise; k++) cols.push({ cell: at(o, f, k - 1), dy: k, part: 'tread', facing: f });
      return fromColumns(cols, rise, [], { inside: at(o, f, -1), toward: f }, { inside: at(o, f, rise), toward: OPP[f] });
    }
    case 'l': {
      const cols: Column[] = [];
      for (let k = 1; k <= a; k++) cols.push({ cell: at(o, f, k - 1), dy: k, part: 'tread', facing: f });
      const corner = at(o, f, a);
      cols.push({ cell: corner, dy: a, part: 'landing' });
      for (let j = 1; j <= b; j++) cols.push({ cell: at(corner, side, j), dy: a + j, part: 'tread', facing: side });
      return fromColumns(cols, rise, [], { inside: at(o, f, -1), toward: f }, { inside: at(corner, side, b + 1), toward: OPP[side] });
    }
    case 'u': {
      const cols: Column[] = [];
      for (let k = 1; k <= a; k++) cols.push({ cell: at(o, f, k - 1), dy: k, part: 'tread', facing: f });
      const l1 = at(o, f, a);
      const l2 = at(l1, side);
      cols.push({ cell: l1, dy: a, part: 'landing' }, { cell: l2, dy: a, part: 'landing' });
      const back = OPP[f];
      for (let j = 1; j <= b; j++) cols.push({ cell: at(l2, back, j), dy: a + j, part: 'tread', facing: back });
      return fromColumns(cols, rise, [], { inside: at(o, f, -1), toward: f }, { inside: at(l2, back, b + 1), toward: f });
    }
    case 'spiral': {
      if (rise > STAIR_LIMITS.spiralMaxRise) {
        throw new StairError('stairs.rise', `Wendeltreppe 3×3 schafft höchstens ${STAIR_LIMITS.spiralMaxRise} Stufen (Etagenabstand ${rise}); gerade oder U-Treppe wählen`);
      }
      const center = at(o, side);
      const start = RING.findIndex(([dx, dz]) => center[0] + dx === o[0] && center[1] + dz === o[1]);
      const ring: Cell[] = Array.from({ length: 8 }, (_, i) => {
        const [dx, dz] = RING[(start + (right ? i : 8 - i)) % 8]!;
        return [center[0] + dx, center[1] + dz];
      });
      const cols: Column[] = [];
      for (let i = 0; i < rise; i++) cols.push({ cell: ring[i]!, dy: i + 1, part: 'tread', facing: dirBetween(ring[i]!, ring[i + 1]!) });
      const post: StairBlock[] = [];
      for (let dy = 1; dy < rise; dy++) post.push({ cell: center, dy, part: 'post' });
      return fromColumns(
        cols, rise, post,
        { inside: ring[7]!, toward: dirBetween(ring[7]!, ring[0]!) },
        { inside: ring[rise]!, toward: dirBetween(ring[rise]!, ring[rise - 1]!) },
      );
    }
    case 'ladder': {
      const blocks: StairBlock[] = [];
      for (let dy = 1; dy <= rise; dy++) blocks.push({ cell: o, dy, part: 'ladder', facing: OPP[f] });
      const support = at(o, f);
      for (let dy = 1; dy < rise; dy++) blocks.push({ cell: support, dy, part: 'support' });
      const access: StairAccess = { inside: at(o, f, -1), toward: f };
      return { blocks, footprint: [o], holes: [o], top: [o], bottom: access, arrival: access, support };
    }
  }
}

// ------------------------------------------------------------------ Invarianten (Aggregat)

/** Zelle samt 8er-Nachbarschaft im Raum: nach der Außenmaß-Regel sicher Boden, nie Wand. */
export function isCoreCell(cells: CellSet, c: Cell): boolean {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!cells.has(c[0] + dx, c[1] + dz)) return false;
  return true;
}

export interface LinkRooms {
  readonly layout: StairLayout;
  readonly lower: Room;
  readonly upper: Room;
  /** Reserviert auf der unteren Etage: Grundfläche + Antritt (+ Leiter-Träger). */
  readonly lowerCells: CellSet;
  /** Reserviert auf der oberen Etage: Öffnung + oberste Stufe + Austritt. */
  readonly upperCells: CellSet;
}

function roomAt(state: ProjectState, floorIndex: number, c: Cell): Room | undefined {
  return state.rooms.find((r) => r.floorIndex === floorIndex && r.cells.has(c[0], c[1]));
}

/**
 * Etagen, zwischen denen eine Treppe läuft: die effektiven Etagen des Baukörpers, in dem sie beginnt (Raum an
 * `origin` auf der unteren Etage; ohne Raum die Projekt-Etagen). Ohne Baukörper = `state.floors`.
 */
function linkFloors(state: ProjectState, link: VerticalLink): readonly Floor[] {
  const r = roomAt(state, link.floorIndex, link.origin);
  return r === undefined ? state.floors : volumeFloors(state, volumeOf(r));
}

/**
 * Prüft eine Treppe gegen den Projektzustand. Ergebnis: die betroffenen Räume oder eine fachliche Begründung.
 * Regeln: beide Etagen existieren; alle reservierten Zellen einer Etage liegen im Kern EINES Raums
 * (Zelle + 8 Nachbarn im Raum, also nie Wand); der Leiter-Träger liegt im Raum; keine Überschneidung mit
 * anderen Treppen auf derselben Etage. Additiv (Baukörper): beide Räume gehören zum selben Baukörper; der
 * Etagenabstand ist der dieses Baukörpers.
 */
export function checkLink(state: ProjectState, link: VerticalLink, others: readonly VerticalLink[] = state.links): LinkRooms | string {
  const floors = linkFloors(state, link);
  const lowerFloor = floors.find((f) => f.index === link.floorIndex);
  const upperFloor = floors.find((f) => f.index === link.floorIndex + 1);
  if (lowerFloor === undefined || upperFloor === undefined) return `Treppe braucht die Etagen ${link.floorIndex} und ${link.floorIndex + 1}`;
  let layout: StairLayout;
  try {
    layout = stairLayout(link, upperFloor.y0 - lowerFloor.y0);
  } catch (e) {
    return (e as Error).message;
  }
  const lowerCore = CellSet.of([...layout.footprint, layout.bottom.inside]);
  const lowerCells = layout.support === undefined ? lowerCore : lowerCore.union(CellSet.of([layout.support]));
  const upperCells = CellSet.of([...layout.holes, ...layout.top, layout.arrival.inside]);
  const lower = roomAt(state, lowerFloor.index, layout.footprint[0]!);
  const upper = roomAt(state, upperFloor.index, layout.arrival.inside);
  if (lower === undefined) return `Treppe unten (Etage ${lowerFloor.index}) liegt in keinem Raum`;
  if (upper === undefined) return `Treppe oben (Etage ${upperFloor.index}) liegt in keinem Raum`;
  if (volumeOf(lower) !== volumeOf(upper)) return `Treppe verbindet zwei Baukörper (${volumeOf(lower)} → ${volumeOf(upper)})`;
  for (const c of lowerCore) if (!isCoreCell(lower.cells, c)) return `Treppe unten braucht Platz im Raum ${lower.id}: Zelle ${cellKey(c[0], c[1])} liegt an der Wand oder außerhalb`;
  for (const c of upperCells) if (!isCoreCell(upper.cells, c)) return `Treppe oben braucht Platz im Raum ${upper.id}: Zelle ${cellKey(c[0], c[1])} liegt an der Wand oder außerhalb`;
  if (layout.support !== undefined && !lower.cells.has(layout.support[0], layout.support[1])) return `Leiter braucht eine tragende Zelle im Raum ${lower.id}`;
  for (const o of others) {
    if (o.id === link.id) continue;
    const other = reservedCells(state, o);
    if (other === undefined) continue;
    const mine = new Map<number, CellSet>([[link.floorIndex, lowerCells], [link.floorIndex + 1, upperCells]]);
    for (const [floor, cells] of other) if (mine.get(floor)?.intersects(cells) === true) return `Treppe überschneidet sich mit Treppe ${o.id} auf Etage ${floor}`;
  }
  return { layout, lower, upper, lowerCells, upperCells };
}

/** Reservierte Zellen einer Treppe je Etage (ohne Prüfung); `undefined`, wenn die Geometrie nicht ableitbar ist. */
export function reservedCells(state: ProjectState, link: VerticalLink): Map<number, CellSet> | undefined {
  const floors = linkFloors(state, link);
  const lo = floors.find((f) => f.index === link.floorIndex);
  const up = floors.find((f) => f.index === link.floorIndex + 1);
  if (lo === undefined || up === undefined) return undefined;
  try {
    const l = stairLayout(link, up.y0 - lo.y0);
    return new Map([
      [lo.index, CellSet.of([...l.footprint, l.bottom.inside, ...(l.support !== undefined ? [l.support] : [])])],
      [up.index, CellSet.of([...l.holes, ...l.top, l.arrival.inside])],
    ]);
  } catch {
    return undefined;
  }
}

