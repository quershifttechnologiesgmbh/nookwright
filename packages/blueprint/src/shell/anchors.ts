/**
 * Anker (research/18 §1.1, §14; research/15 §5): Andockstellen außen am Gebäude für Außen-Komponenten und den
 * Außenprofil-Pass (facade.ts). Abgeleitet NACH Wänden und Dach allein aus den fertigen Hüllzellen und der
 * Raumsicht – unabhängig vom Dach-Algorithmus (Walm, Sattel, Pult oder künftige Formen).
 *
 * Außenmodell: Grundriss je Etage = Innenzellen ∪ Wandspalten (Wandreihen baseY…topY). Eine Position ist
 * „Außenluft“, wenn dort keine Hüllzelle liegt und ihre Spalte nicht zum Gebäudeinneren gehört – innen ist eine
 * Spalte eines Grundrisses von der tiefsten Bodenplatte bis zur obersten Hüllzelle der Spalte (Dachraum unter
 * einem Pultdach zählt also mit, Luft unter einem Überstand oder unter einer Auskragung nicht); Spalten angedockter
 * Bauwerke (`Shell.annexes`) sind ganz belegt. Keller (Etagenindex < 0) liegen im Erdreich und bekommen keine
 * Außenanker. Baukörper (V0): eine Etage ist hier (Index, Boden, lichte Höhe) – Räume gleicher Etage verschiedener
 * Baukörper mit anderem Boden oder anderer Höhe bilden eigene Etagen; Erdgeschosse sind alle Etagen mit dem kleinsten
 * Index ≥ 0 (Sockel je Baukörper).
 *
 * Ankerarten (pos = Außenluftzelle, span läuft ab pos in +x bzw. +z):
 *  - door        vor der unteren Türhälfte einer Außentür, facing = hinaus
 *  - window      vor der untersten Scheibe; nebeneinanderliegende Fenster gleicher Höhe = 1 Anker, span = Breite
 *                (Gaubenfenster setzt `deriveShell` dazu, je Gaube ein Anker über alle Scheibenspalten)
 *  - corner      Diagonalzelle vor einer Außenecke auf baseY; facing und CW(facing) zeigen nach außen, span = Wandreihen
 *  - plinth      Sockellauf je Außenwand der untersten Etage auf Bodenplattenhöhe
 *  - storey_line Etagengrenze außen (vor der Bodenplatte der oberen Etage, nur wo sie auf der unteren Wand steht)
 *  - eave        Traufe: Luft direkt unter der Dachzelle jenseits der Wandflucht, an der Wand (Konsolen-Platz)
 *  - gable       Giebeldreieck (Wandzellen über der Decke): vor dem Anfang der untersten Reihe, span = Basisbreite
 *  - verge       Ortgang: Luft seitlich neben der untersten Treppe einer Dachkante ohne Dach daneben, span = Länge
 *  - ridge       First: Luft über dem ersten Firstblock, facing = Fallrichtung zur +Seite (south bzw. east)
 *  - ridge_end   Firstende: Luft über dem Endblock, facing = entlang des Firsts nach außen
 *  - roof_face   Dachfläche (≥ 4 Treppen gleicher Richtung): Luft über der mittleren Zelle, facing = Fallrichtung
 */
import { HORIZONTAL, cellKey, key3, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import type { RoomId } from '../model.js';
import { CCW, CW, OPP, STEP, axisOf } from './grid.js';
import type { Shell, ShellAnchor, ShellAnchorKind, ShellCell } from './types.js';

export type ShellView = Pick<Shell, 'cells' | 'rooms' | 'annexes'>;

const WALLISH: ReadonlySet<ShellCell['kind']> = new Set(['wall', 'pillar', 'door', 'window', 'lintel']);

/** Richtung, in der eine Wandlinie mit Außenseite `out` läuft (aufsteigende Koordinate). */
export const alongOf = (out: HorizontalDir): HorizontalDir => (axisOf(out) === 'z' ? 'east' : 'south');

export const stepV = (p: Vec3, d: HorizontalDir, k = 1): Vec3 => [p[0] + STEP[d][0] * k, p[1], p[2] + STEP[d][1] * k];
const stepC = (c: Cell, d: HorizontalDir, k = 1): Cell => [c[0] + STEP[d][0] * k, c[1] + STEP[d][1] * k];

/** Gerade Außenwandlinie einer Etage: Spalten in Laufrichtung `alongOf(out)`, Außenseite `out`. */
export interface WallLine {
  readonly out: HorizontalDir;
  readonly cols: readonly Cell[];
}

export interface ExtLevel {
  readonly index: number;
  /** Bodenplatte. */
  readonly y0: number;
  readonly baseY: number;
  /** Oberste Wandreihe (= y0 + lichte Höhe). */
  readonly topY: number;
  readonly footprint: ReadonlySet<string>;
  readonly lines: readonly WallLine[];
  /** Außenecken: Eckspalte und erste Außenrichtung (die zweite ist CW). */
  readonly corners: readonly { readonly col: Cell; readonly out: HorizontalDir }[];
}

export interface ExteriorModel {
  /** Oberirdische Etagen (Index ≥ 0), aufsteigend nach Index, dann Boden. */
  readonly levels: readonly ExtLevel[];
  /** Erdgeschoss (Sockel): ohne Baukörper genau `levels[0]`. */
  readonly isGround: (l: ExtLevel) => boolean;
  readonly at: (p: Vec3) => ShellCell | undefined;
  /** Frei (keine Hüllzelle) und außerhalb des Gebäudes. */
  readonly isAir: (p: Vec3) => boolean;
  readonly levelOfRoom: (roomId: RoomId | undefined) => ExtLevel | undefined;
  /** Oberste Hüllzelle je Spalte (cellKey). */
  readonly colTop: ReadonlyMap<string, number>;
  /** Dachzellen je Spalte (cellKey), aufsteigend nach y. */
  readonly roofCols: ReadonlyMap<string, readonly ShellCell[]>;
}

export function exteriorModel(shell: ShellView): ExteriorModel {
  const byPos = new Map<string, ShellCell>();
  const colTop = new Map<string, number>();
  const roofCols = new Map<string, ShellCell[]>();
  for (const c of shell.cells) {
    const k = key3(c.pos);
    if (!byPos.has(k)) byPos.set(k, c);
    const ck = cellKey(c.pos[0], c.pos[2]);
    colTop.set(ck, Math.max(colTop.get(ck) ?? -Infinity, c.pos[1]));
    if (c.kind === 'roof') (roofCols.get(ck) ?? roofCols.set(ck, []).get(ck)!).push(c);
  }
  for (const list of roofCols.values()) list.sort((a, b) => a.pos[1] - b.pos[1]);

  // Etagen aus der Raumsicht: Räume mit gleichem Index, Boden und lichter Höhe (ohne Baukörper: je Index eine)
  const keyOfRoom = new Map<RoomId, string>();
  const spec = new Map<string, { index: number; y0: number; height: number; foot: Set<string> }>();
  for (const r of shell.rooms.values()) {
    const key = `${r.floorIndex}|${r.baseY}|${r.height}`;
    keyOfRoom.set(r.roomId, key);
    let s = spec.get(key);
    if (s === undefined) spec.set(key, (s = { index: r.floorIndex, y0: r.baseY - 1, height: r.height, foot: new Set() }));
    for (const [x, z] of r.interior) s.foot.add(cellKey(x, z));
  }
  const wallCols = new Map<string, Map<string, Cell>>();
  for (const c of shell.cells) {
    if (!WALLISH.has(c.kind) || c.roomId === undefined) continue;
    const f = keyOfRoom.get(c.roomId);
    const s = f !== undefined ? spec.get(f) : undefined;
    if (s === undefined || c.pos[1] <= s.y0 || c.pos[1] > s.y0 + s.height) continue;
    const k = cellKey(c.pos[0], c.pos[2]);
    s.foot.add(k);
    (wallCols.get(f!) ?? wallCols.set(f!, new Map()).get(f!)!).set(k, [c.pos[0], c.pos[2]]);
  }

  // Innen: Spalte eines Grundrisses von der tiefsten Bodenplatte bis zur obersten Hüllzelle
  // Kellergeschosse zählen nur unter dem Grundriss darüber (feat/underground: ein Unterbau neben dem Haus liegt im
  // Erdreich, die Luft vor Türen und Fenstern darüber ist außen). Heute liegt jeder Keller unter dem Erdgeschoss: bitgleich.
  // Maßgeblich ist das Erdgeschoss (tiefste Etage ≥ 0), nicht jedes Obergeschoss: unter einer Auskragung (W9-G1) liegt
  // Außenluft; ein Unterbau darunter machte sonst die Luft vor den Erdgeschoss-Fenstern zu „innen“ (W9-Integration).
  const lowest = Math.min(...[...spec.values()].filter((s) => s.index >= 0).map((s) => s.index));
  const upper = new Set([...spec.values()].filter((s) => s.index === lowest).flatMap((s) => [...s.foot]));
  const bottom = new Map<string, number>();
  for (const s of spec.values()) for (const k of s.foot) if (s.index >= 0 || upper.has(k)) bottom.set(k, Math.min(bottom.get(k) ?? Infinity, s.y0));
  const inside = (x: number, y: number, z: number): boolean => {
    const k = cellKey(x, z);
    const b = bottom.get(k);
    return b !== undefined && y >= b && y <= colTop.get(k)!;
  };

  const levels: ExtLevel[] = [];
  const levelAt = new Map<string, ExtLevel>();
  for (const [key, s] of [...spec.entries()].sort((a, b) => a[1].index - b[1].index || a[1].y0 - b[1].y0 || a[1].height - b[1].height)) {
    const index = s.index;
    if (index < 0) continue;
    const walls = [...(wallCols.get(key)?.values() ?? [])].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const outside = (c: Cell, d: HorizontalDir): boolean => !s.foot.has(cellKey(...stepC(c, d)));
    // Linien: je Außenrichtung zusammenhängende Spalten entlang der Wand
    const lines: WallLine[] = HORIZONTAL.flatMap((out) => {
      const along = alongOf(out);
      const cols = walls.filter((c) => outside(c, out)).sort((a, b) => (along === 'east' ? a[1] - b[1] || a[0] - b[0] : a[0] - b[0] || a[1] - b[1]));
      return chunks(cols, (a, b) => a[0] + STEP[along][0] === b[0] && a[1] + STEP[along][1] === b[1]).map((run) => ({ out, cols: run }));
    });
    const corners = walls.flatMap((c) => HORIZONTAL.filter((d) => outside(c, d) && outside(c, CW[d]) && outside(stepC(c, d), CW[d])).map((out) => ({ col: c, out })));
    const level: ExtLevel = { index, y0: s.y0, baseY: s.y0 + 1, topY: s.y0 + s.height, footprint: s.foot, lines, corners };
    levels.push(level);
    levelAt.set(key, level);
  }
  const groundIndex = levels[0]?.index;
  // Angedockte Bauwerke (B2): ihre Spalten sind in jeder Höhe belegt
  const annexCol = new Set((shell.annexes ?? []).flatMap((a) => [...a.footprint].map(([x, z]) => cellKey(x, z))));

  return {
    levels,
    isGround: (l) => l.index === groundIndex,
    at: (p) => byPos.get(key3(p)),
    isAir: (p) => !byPos.has(key3(p)) && !inside(p[0], p[1], p[2]) && !annexCol.has(cellKey(p[0], p[2])),
    levelOfRoom: (id) => (id === undefined ? undefined : levelAt.get(keyOfRoom.get(id) ?? '')),
    colTop,
    roofCols,
  };
}

/** Aufeinanderfolgende Indizes, für die `ok` gilt, als Läufe [Start, Länge]. */
export function runsOf(n: number, ok: (i: number) => boolean): Array<readonly [number, number]> {
  return chunks([...Array(n).keys()].filter(ok), (a, b) => b === a + 1).map((r) => [r[0]!, r.length] as const);
}

/** Zerlegt eine Folge in maximale Stücke, in denen je zwei Nachbarn `same` erfüllen. */
export function chunks<T>(xs: readonly T[], same: (a: T, b: T) => boolean): T[][] {
  const out: T[][] = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last !== undefined && same(last[last.length - 1]!, x)) last.push(x);
    else out.push([x]);
  }
  return out;
}

/** Zusammenhangskomponenten (Tiefensuche) in Eingabe-Reihenfolge der Startelemente. */
function components<T>(items: readonly T[], keyOf: (t: T) => string, neighborKeys: (t: T) => readonly string[], joins: (a: T, b: T) => boolean = () => true): T[][] {
  const byKey = new Map(items.map((t) => [keyOf(t), t] as const));
  const done = new Set<string>();
  const out: T[][] = [];
  for (const start of items) {
    if (done.has(keyOf(start))) continue;
    done.add(keyOf(start));
    const comp: T[] = [];
    for (const stack = [start]; stack.length > 0; ) {
      const t = stack.pop()!;
      comp.push(t);
      for (const k of neighborKeys(t)) {
        const n = byKey.get(k);
        if (n !== undefined && !done.has(k) && joins(t, n)) {
          done.add(k);
          stack.push(n);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

const KIND_ORDER: readonly ShellAnchorKind[] = ['door', 'window', 'corner', 'plinth', 'storey_line', 'eave', 'gable', 'verge', 'ridge', 'ridge_end', 'roof_face'];

export function deriveAnchors(shell: ShellView, model: ExteriorModel = exteriorModel(shell)): ShellAnchor[] {
  const { levels, isGround, at, isAir, levelOfRoom, colTop, roofCols } = model;
  const out: ShellAnchor[] = [];
  const push = (kind: ShellAnchorKind, pos: Vec3, facing: HorizontalDir, floorIndex: number, span?: number, roomId?: RoomId): void => {
    out.push({ kind, pos, facing, ...(span !== undefined ? { span } : {}), floorIndex, ...(roomId !== undefined ? { roomId } : {}) });
  };
  /** Nach außen offene Richtung einer Wandzelle der Etage mit Außenluft davor. */
  const outward = (c: ShellCell, lvl: ExtLevel): HorizontalDir | undefined =>
    HORIZONTAL.find((d) => !lvl.footprint.has(cellKey(c.pos[0] + STEP[d][0], c.pos[2] + STEP[d][1])) && isAir(stepV(c.pos, d)));
  const levelBelow = (y: number): ExtLevel | undefined => [...levels].reverse().find((l) => l.y0 < y);
  const roomAt = (col: Cell, y: number): RoomId | undefined => at([col[0], y, col[1]])?.roomId;

  // ---------------------------------------------------------------- Türen, Fenster, Giebel (aus den Zellen)
  const openings = new Map<string, { lvl: ExtLevel; d: HorizontalDir; col: Cell; y: number; h: number; roomId?: RoomId }>();
  const gableCells = new Map<string, { lvl: ExtLevel; d: HorizontalDir; cells: ShellCell[] }>();
  for (const c of shell.cells) {
    const lvl = levelOfRoom(c.roomId);
    if (lvl === undefined) continue;
    if (c.kind === 'door' && c.orient?.half === 'lower' && c.orient.facing !== undefined) {
      const d = c.orient.facing;
      const front = stepV(c.pos, d);
      if (!lvl.footprint.has(cellKey(front[0], front[2])) && isAir(front)) push('door', front, d, lvl.index, 1, c.roomId);
      continue;
    }
    if (c.kind === 'window' && at([c.pos[0], c.pos[1] - 1, c.pos[2]])?.kind !== 'window') {
      const d = outward(c, lvl);
      if (d === undefined) continue;
      let h = 1;
      while (at([c.pos[0], c.pos[1] + h, c.pos[2]])?.kind === 'window') h++;
      openings.set(key3(c.pos), { lvl, d, col: [c.pos[0], c.pos[2]], y: c.pos[1], h, ...(c.roomId !== undefined ? { roomId: c.roomId } : {}) });
    }
    if ((c.kind === 'wall' || c.kind === 'window') && c.pos[1] > lvl.topY) {
      const d = outward(c, lvl);
      if (d === undefined) continue;
      const plane = axisOf(d) === 'z' ? c.pos[2] : c.pos[0];
      const k = `${lvl.index}|${d}|${plane}`;
      (gableCells.get(k) ?? gableCells.set(k, { lvl, d, cells: [] }).get(k)!).cells.push(c);
    }
  }
  // Fenster: nebeneinanderliegende Öffnungen gleicher Höhe zusammenfassen
  const seen = new Set<string>();
  for (const o of [...openings.values()].sort((a, b) => a.col[1] - b.col[1] || a.col[0] - b.col[0] || a.y - b.y)) {
    const k = key3([o.col[0], o.y, o.col[1]]);
    if (seen.has(k)) continue;
    const along = alongOf(o.d);
    let span = 0;
    for (let c = o.col; ; c = stepC(c, along)) {
      const n = openings.get(key3([c[0], o.y, c[1]]));
      if (n === undefined || n.d !== o.d || n.h !== o.h) break;
      seen.add(key3([c[0], o.y, c[1]]));
      span++;
    }
    push('window', stepV([o.col[0], o.y, o.col[1]], o.d), o.d, o.lvl.index, span, o.roomId);
  }
  // Giebeldreiecke: zusammenhängende Wandzellen über der Decke je Wandebene
  for (const g of gableCells.values()) {
    const along = alongOf(g.d);
    const a = (c: ShellCell): number => (along === 'east' ? c.pos[0] : c.pos[2]);
    const keyOf = (c: ShellCell): string => `${a(c)},${c.pos[1]}`;
    const near = (c: ShellCell): string[] => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([da, dy]) => `${a(c) + da!},${c.pos[1] + dy!}`);
    for (const comp of components([...g.cells].sort((p, q) => p.pos[1] - q.pos[1] || a(p) - a(q)), keyOf, near)) {
      const yb = Math.min(...comp.map((c) => c.pos[1]));
      const row = comp.filter((c) => c.pos[1] === yb).sort((p, q) => a(p) - a(q));
      const first = row[0]!;
      push('gable', stepV(first.pos, g.d), g.d, g.lvl.index, a(row[row.length - 1]!) - a(first) + 1, first.roomId);
    }
  }

  // ---------------------------------------------------------------- Ecken, Sockel, Etagengrenzen, Traufen (aus den Linien)
  for (const lvl of levels) {
    for (const { col, out: d } of lvl.corners) {
      const pos = stepV(stepV([col[0], lvl.baseY, col[1]], d), CW[d]);
      if (isAir(pos)) push('corner', pos, d, lvl.index, lvl.topY - lvl.baseY + 1, roomAt(col, lvl.baseY));
    }
    const below = levels.find((l) => l.index === lvl.index - 1 && l.topY + 1 === lvl.y0);
    for (const line of lvl.lines) {
      const d = line.out;
      const front = (i: number, y: number): Vec3 => stepV([line.cols[i]![0], y, line.cols[i]![1]], d);
      const emitRuns = (kind: ShellAnchorKind, y: number, ok: (i: number) => boolean): void => {
        for (const [s, len] of runsOf(line.cols.length, (i) => ok(i) && isAir(front(i, y)))) push(kind, front(s, y), d, lvl.index, len, roomAt(line.cols[s]!, lvl.baseY));
      };
      if (isGround(lvl)) emitRuns('plinth', lvl.y0, () => true);
      // W4-B (Turmschaft, `RoofDetail.plainShaft`): liegt die Bodenplatte in der Wand in der Wandrolle, gibt es dort keine
      // Etagengrenze nach außen (kein Gesims, nichts, was daran hängt)
      const plainPlate = (i: number): boolean => at([line.cols[i]![0], lvl.y0, line.cols[i]![1]])?.role === 'wall_primary';
      if (below !== undefined) emitRuns('storey_line', lvl.y0, (i) => below.footprint.has(cellKey(...line.cols[i]!)) && !plainPlate(i));
      // Traufe: unterste Dachzelle vor der Wand (über baseY bis Deckenhöhe + 1) mit Luft darunter, an der Wand
      const lowestRoof = (i: number): ShellCell | undefined =>
        (roofCols.get(cellKey(...stepC(line.cols[i]!, d))) ?? []).find((c) => c.pos[1] > lvl.baseY && c.pos[1] <= lvl.topY + 2);
      const eaves: Array<{ readonly i: number; readonly y: number }> = [];
      line.cols.forEach((col, i) => {
        const r = lowestRoof(i);
        if (r === undefined) return;
        // Treppe steigt zur Wand an; Stufe/Block nur in einer waagerechten Reihe (sonst First- oder Ortgangende)
        const eaveLike = r.shape === 'stairs'
          ? r.orient?.facing === OPP[d] && r.orient.half !== 'top'
          : [i - 1, i + 1].some((j) => j >= 0 && j < line.cols.length && lowestRoof(j)?.pos[1] === r.pos[1]);
        const y = r.pos[1] - 1;
        if (eaveLike && isAir(front(i, y)) && at([col[0], y, col[1]]) !== undefined) eaves.push({ i, y });
      });
      for (const run of chunks(eaves, (a, b) => b.i === a.i + 1 && b.y === a.y)) {
        push('eave', front(run[0]!.i, run[0]!.y), d, lvl.index, run.length, roomAt(line.cols[run[0]!.i]!, lvl.baseY));
      }
    }
  }

  // ---------------------------------------------------------------- Dach: Ortgang, First, Flächen (aus den Dachzellen)
  const roofs = [...roofCols.values()].flat();
  const floorOf = (c: ShellCell): number => (levelOfRoom(c.roomId) ?? levelBelow(c.pos[1]))?.index ?? 0;
  const hasRoof = (x: number, z: number): boolean => roofCols.has(cellKey(x, z));
  const stairs = roofs.filter((c) => c.shape === 'stairs' && c.orient?.facing !== undefined && c.orient.half !== 'top');
  // Ortgang: Treppe, neben der (quer zur Fallrichtung) kein Dach mehr ist; Läufe entlang der Fallrichtung
  const verge = new Map<string, ShellCell[]>();
  for (const c of stairs) {
    const f = c.orient!.facing!;
    for (const s of [CCW[f], CW[f]]) {
      const side = stepV(c.pos, s);
      if (hasRoof(side[0], side[2]) || !isAir(side)) continue;
      const k = `${s}|${axisOf(s) === 'x' ? c.pos[0] : c.pos[2]}|${f}`;
      (verge.get(k) ?? verge.set(k, []).get(k)!).push(c);
    }
  }
  for (const [k, list] of verge) {
    const s = k.split('|')[0] as HorizontalDir;
    const a = (c: ShellCell): number => (axisOf(s) === 'x' ? c.pos[2] : c.pos[0]);
    const sorted = [...new Map(list.map((c) => [a(c), c] as const)).values()].sort((p, q) => a(p) - a(q));
    for (const run of chunks(sorted, (p, q) => a(q) === a(p) + 1)) {
      if (run.length < 2) continue; // einzelne Treppen ohne Nachbarn: Walm-Ecken, kein Ortgang
      const low = run.reduce((m, c) => (c.pos[1] < m.pos[1] ? c : m));
      push('verge', stepV(low.pos, s), s, floorOf(low), run.length, low.roomId);
    }
  }
  // First: Plateau aus Dachzellen, die keine Nachbarspalte überragt und um das herum alles tiefer liegt
  // (Walmgrate haben gleich hohe Nachbarn außerhalb des Plateaus und fallen so heraus)
  const topOf = (x: number, z: number): number => colTop.get(cellKey(x, z)) ?? -Infinity;
  const ridgeCells = roofs.filter((c) => c.pos[1] === topOf(c.pos[0], c.pos[2]) && HORIZONTAL.every((d) => topOf(c.pos[0] + STEP[d][0], c.pos[2] + STEP[d][1]) <= c.pos[1]));
  const around = (c: ShellCell): string[] => HORIZONTAL.map((d) => key3(stepV(c.pos, d)));
  for (const comp of components(ridgeCells, (c) => key3(c.pos), around)) {
    const inComp = new Set(comp.map((c) => key3(c.pos)));
    if (!comp.every((c) => HORIZONTAL.every((d) => inComp.has(key3(stepV(c.pos, d))) || topOf(c.pos[0] + STEP[d][0], c.pos[2] + STEP[d][1]) < c.pos[1]))) continue;
    const xs = comp.map((c) => c.pos[0]);
    const zs = comp.map((c) => c.pos[2]);
    const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
    const a = (c: ShellCell): number => (alongX ? c.pos[0] : c.pos[2]);
    const b = (c: ShellCell): number => (alongX ? c.pos[2] : c.pos[0]);
    const ordered = comp.sort((p, q) => a(p) - a(q) || b(p) - b(q));
    const first = ordered[0]!;
    const last = [...ordered].sort((p, q) => a(q) - a(p) || b(p) - b(q))[0]!;
    const up = (c: ShellCell): Vec3 => [c.pos[0], c.pos[1] + 1, c.pos[2]];
    const span = a(last) - a(first) + 1;
    push('ridge', up(first), alongX ? 'south' : 'east', floorOf(first), span, first.roomId);
    if (span >= 2) {
      push('ridge_end', up(first), alongX ? 'west' : 'north', floorOf(first), 1, first.roomId);
      push('ridge_end', up(last), alongX ? 'east' : 'south', floorOf(last), 1, last.roomId);
    }
  }
  // Dachflächen: zusammenhängende Treppen gleicher Richtung
  const colOf = (c: ShellCell): string => cellKey(c.pos[0], c.pos[2]);
  const nearCols = (c: ShellCell): string[] => HORIZONTAL.map((d) => cellKey(c.pos[0] + STEP[d][0], c.pos[2] + STEP[d][1]));
  for (const comp of components(stairs, colOf, nearCols, (p, q) => p.orient!.facing === q.orient!.facing)) {
    if (comp.length < 4) continue;
    const f = comp[0]!.orient!.facing!;
    const mx = comp.reduce((s, c) => s + c.pos[0], 0) / comp.length;
    const mz = comp.reduce((s, c) => s + c.pos[2], 0) / comp.length;
    const dist = (c: ShellCell): number => (c.pos[0] - mx) ** 2 + (c.pos[2] - mz) ** 2;
    const mid = comp.reduce((m, c) => (dist(c) < dist(m) - 1e-9 || (Math.abs(dist(c) - dist(m)) <= 1e-9 && (c.pos[2] - m.pos[2] || c.pos[0] - m.pos[0]) < 0) ? c : m));
    const across = axisOf(f) === 'z' ? comp.map((c) => c.pos[0]) : comp.map((c) => c.pos[2]);
    const pos: Vec3 = [mid.pos[0], mid.pos[1] + 1, mid.pos[2]];
    if (isAir(pos)) push('roof_face', pos, OPP[f], floorOf(mid), Math.max(...across) - Math.min(...across) + 1, mid.roomId);
  }

  return sortAnchors(out);
}

/** Feste Reihenfolge der Anker (Art, Etage, y, z, x, Richtung). */
export function sortAnchors(anchors: ShellAnchor[]): ShellAnchor[] {
  return anchors.sort((p, q) =>
    KIND_ORDER.indexOf(p.kind) - KIND_ORDER.indexOf(q.kind) || p.floorIndex - q.floorIndex
    || p.pos[1] - q.pos[1] || p.pos[2] - q.pos[2] || p.pos[0] - q.pos[0] || HORIZONTAL.indexOf(p.facing) - HORIZONTAL.indexOf(q.facing));
}
