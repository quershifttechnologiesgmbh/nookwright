import { CellSet, HORIZONTAL, cellKey, type Cell, type HorizontalDir } from '@mcda/core';
import { neighbor, type RoomGeometry } from './geometry.js';
import type { RoomLayout } from './layout.js';

export type CellClass = 'center' | 'edge' | 'corner' | 'corridor' | 'niche';

export interface CellInfo {
  readonly cell: Cell;
  readonly cls: CellClass;
  /** Richtungen, in denen eine feste Grenze (Wand, Fenster, Tür) liegt. */
  readonly walls: readonly HorizontalDir[];
  /** Grenzen ohne Tür/Fenster – hier kann etwas mit dem Rücken anlehnen. */
  readonly solidWalls: readonly HorizontalDir[];
  /**
   * W3-IN: Grenzen, die in Bodenhöhe fest sind – feste Wände und Fenster (Scheiben beginnen frühestens eine Reihe über
   * dem Boden; die Brüstung ist Wand), ohne Türen und ohne offene Kanten zu gesperrten Zellen (Treppe). Hier lehnt ein
   * Möbel an, dessen Rückseite nur eine Reihe hoch ist (Arbeitsplatte, Spüle, Truhe unter dem Fenster).
   */
  readonly lowWalls?: readonly HorizontalDir[];
  readonly nearWindow: boolean;
  readonly nearDoor: boolean;
}

export interface WallSegment {
  /** Richtung der Wand, von den Zellen aus gesehen. */
  readonly wall: HorizontalDir;
  /** Zusammenhängende Zellen entlang der Wand (sortiert). */
  readonly cells: readonly Cell[];
}

export interface RoomAnalysis {
  readonly geometry: RoomGeometry;
  readonly info: ReadonlyMap<string, CellInfo>;
  /** BFS-Abstand (4er-Nachbarschaft, im Raum) zur nächsten Wandzelle; Wandzellen = 0. */
  readonly dWall: ReadonlyMap<string, number>;
  /** BFS-Abstand zur nächsten Türinnenzelle (Infinity ohne Türen). */
  readonly dDoor: ReadonlyMap<string, number>;
  /** Türinnenzellen + ihre Nachbarn: hier darf nichts stehen. */
  readonly doorZone: CellSet;
  /** Gesperrte Spalten (`RoomGeometry.blocked`, z. B. Treppe, Geländer): in keiner Höhe belegbar, auch nicht für Luft/Entities. */
  readonly blocked: CellSet;
  readonly wallSegments: readonly WallSegment[];
  /** Raumtyp-Layout (Mittelgang, Freifläche; research/17 Y1/Y2): vom Solver ergänzt, fehlt ohne `aisle`/`reserve`. */
  readonly layout?: RoomLayout;
  /** Hauptweg (W2, I6): Zellen, auf denen in Laufhöhe nur Durchlaufbares steht (`planPath`); vom Solver ergänzt. */
  readonly path?: CellSet;
  /**
   * W2 (26.09.2026, freie Sicht durchs Fenster): Sichtachse jedes Fensters – die Innenzellen 1 … `WINDOW_VIEW_DEPTH`
   * hinter der Scheibe (bis zur ersten Nicht-Innenzelle). Dort steht in Blickhöhe direkt hinter der Scheibe nur
   * Niedriges/Durchsichtiges, dahinter kein Stauraum-Möbel (`cheapValid`). Fehlt = keine Sichtachsen (Licht-Pass).
   */
  readonly windowView?: CellSet;
  /**
   * W7 (27.09.2026): Insel in der Raummitte (Raumtyp-Eintrag `island`, `planIsland`): auf Bodenhöhe steht dort nur ein
   * Möbel mit einem der `tags` (oder Durchlaufbares); der Hauptweg führt außen herum. Vom Solver ergänzt.
   */
  readonly island?: IslandPlan;
}

/** W7: Insel eines Raums – Zellen in der Mitte und die Tags des Eintrags, der dort stehen darf. */
export interface IslandPlan {
  readonly cells: CellSet;
  readonly tags: readonly string[];
  /** Programm-Eintrag (Index wie `ProgramItem.entry`). */
  readonly entry: number;
}

/** W2 (freie Sicht): Tiefe der Sichtachse hinter einer Fensterscheibe. */
export const WINDOW_VIEW_DEPTH = 3;
const OPPOSITE: Readonly<Record<HorizontalDir, HorizontalDir>> = { north: 'south', south: 'north', east: 'west', west: 'east' };

function bfs(interior: CellSet, sources: readonly Cell[]): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: Cell[] = [];
  for (const s of sources) {
    const k = cellKey(s[0], s[1]);
    if (interior.has(s[0], s[1]) && !dist.has(k)) {
      dist.set(k, 0);
      queue.push(s);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!;
    const d = dist.get(cellKey(c[0], c[1]))!;
    for (const dir of HORIZONTAL) {
      const n = neighbor(c, dir);
      const nk = cellKey(n[0], n[1]);
      if (interior.has(n[0], n[1]) && !dist.has(nk)) {
        dist.set(nk, d + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

function classify(walls: readonly HorizontalDir[]): CellClass {
  switch (walls.length) {
    case 0:
      return 'center';
    case 1:
      return 'edge';
    case 2: {
      const [a, b] = walls as [HorizontalDir, HorizontalDir];
      const opposite = (a === 'north' && b === 'south') || (a === 'south' && b === 'north') || (a === 'east' && b === 'west') || (a === 'west' && b === 'east');
      return opposite ? 'corridor' : 'corner';
    }
    default:
      return 'niche';
  }
}

/** Phase 1 des Solvers (RGHP-A): Raum verstehen. Reine Funktion, O(Zellen). */
export function analyzeRoom(geom: RoomGeometry): RoomAnalysis {
  const { interior } = geom;
  const doorAt = new Set(geom.doors.map((d) => `${cellKey(d.inside[0], d.inside[1])}>${d.toward}`));
  const windowAt = new Set(geom.windows.map((w) => `${cellKey(w.inside[0], w.inside[1])}>${w.toward}`));

  const info = new Map<string, CellInfo>();
  for (const c of interior.toArray()) {
    const k = cellKey(c[0], c[1]);
    const walls = HORIZONTAL.filter((d) => {
      const n = neighbor(c, d);
      return !interior.has(n[0], n[1]);
    });
    const solidWalls = walls.filter((d) => !doorAt.has(`${k}>${d}`) && !windowAt.has(`${k}>${d}`));
    const lowWalls = walls.filter((d) => {
      const n = neighbor(c, d);
      return !doorAt.has(`${k}>${d}`) && geom.blocked?.has(n[0], n[1]) !== true;
    });
    info.set(k, {
      cell: c,
      cls: classify(walls),
      walls,
      solidWalls,
      lowWalls,
      nearWindow: walls.some((d) => windowAt.has(`${k}>${d}`)),
      nearDoor: false,
    });
  }

  // Türzone: Innenzelle jeder Tür + deren Nachbarn im Raum.
  const zone: Cell[] = [];
  for (const d of geom.doors) {
    zone.push(d.inside);
    for (const dir of HORIZONTAL) {
      const n = neighbor(d.inside, dir);
      if (interior.has(n[0], n[1])) zone.push(n);
    }
  }
  const doorZone = CellSet.of(zone);
  for (const c of doorZone) {
    const k = cellKey(c[0], c[1]);
    const i = info.get(k);
    if (i !== undefined) info.set(k, { ...i, nearDoor: true });
  }

  const wallCells = [...info.values()].filter((i) => i.walls.length > 0).map((i) => i.cell);
  const dWall = bfs(interior, wallCells);
  const dDoor = bfs(interior, geom.doors.map((d) => d.inside));
  for (const c of interior) {
    const k = cellKey(c[0], c[1]);
    if (!dDoor.has(k)) dDoor.set(k, Infinity);
  }

  // Gesperrte Spalten dürfen auch AUSSERHALB von `interior` liegen (Pipeline: Treppe/Geländer aus der Fläche
  // genommen) – sie sperren dann Luftmasken und Entities, die in den Raum hineinragen würden.
  const blocked = geom.blocked ?? CellSet.empty();
  // W2 (freie Sicht): Sichtachse je Fenster, von der Innenzelle vor der Scheibe in den Raum hinein
  const view: Cell[] = [];
  for (const w of geom.windows) {
    let c: Cell = w.inside;
    for (let d = 0; d < WINDOW_VIEW_DEPTH && interior.has(c[0], c[1]); d++) {
      view.push(c);
      c = neighbor(c, OPPOSITE[w.toward]);
    }
  }
  return { geometry: geom, info, dWall, dDoor, doorZone, blocked, wallSegments: wallSegments(info, doorZone, blocked), windowView: CellSet.of(view) };
}

/**
 * Maximale gerade Läufe von Zellen mit fester Wand in derselben Richtung.
 * Unterbrochen an Türzonen und gesperrten Zellen – dort wird nichts an die Wand gestellt.
 */
function wallSegments(info: ReadonlyMap<string, CellInfo>, doorZone: CellSet, blocked: CellSet): WallSegment[] {
  const out: WallSegment[] = [];
  for (const wall of HORIZONTAL) {
    const alongX = wall === 'north' || wall === 'south';
    const cells = [...info.values()]
      .filter((i) => i.solidWalls.includes(wall) && !doorZone.has(i.cell[0], i.cell[1]) && !blocked.has(i.cell[0], i.cell[1]))
      .map((i) => i.cell)
      .sort((a, b) => (alongX ? a[1] - b[1] || a[0] - b[0] : a[0] - b[0] || a[1] - b[1]));
    let run: Cell[] = [];
    const flush = () => {
      if (run.length > 0) out.push({ wall, cells: run });
      run = [];
    };
    for (const c of cells) {
      const prev = run[run.length - 1];
      const contiguous = prev !== undefined && (alongX ? prev[1] === c[1] && c[0] === prev[0] + 1 : prev[0] === c[0] && c[1] === prev[1] + 1);
      if (!contiguous) flush();
      run.push(c);
    }
    flush();
  }
  return out;
}
