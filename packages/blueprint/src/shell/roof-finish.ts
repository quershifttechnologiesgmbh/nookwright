/**
 * Nacharbeiten am fertigen Dach (nach dem Zusammenführen aller Etagen):
 *
 * - `placeGableWindows` (research/18 W7): Fenster auf der Achse jedes Giebeldreiecks ab 5 Breite × 3 Höhe (1×1, ab
 *   Höhe 5 1×2, bei gerader Plateaubreite 2×1), ab 7 Breite ein Drillingsfenster 3×2 (W13-E; vorher Okulus 3×3 mit Glas
 *   im Plus, das sich als Kreuz las). Merrell-Regel: kein Fenster, dessen Scheibe außen verdeckt ist (anderes Dach, Wand) oder innen
 *   nicht an Luft grenzt. Die Zeile liegt mittig im gültigen Bereich (bei zwei Zeilen die obere).
 * - `placeDormerWindows` (research/18 D4): Scheiben, Rähm und – bei Blindgauben – Vollblock dahinter in die Frontwand
 *   jeder Gaube (Merrell: vor der Scheibe Luft, sonst bleibt die Front geschlossen).
 * - `settleRoofStairs`: Soll-Form (`stairShape`) jeder Dachtreppe = Ergebnis der Vanilla-Regel (StairBlock#getStairsShape)
 *   über alle Treppen der Hülle. Die Dachplanung wählt `facing` so, dass Vanilla fast überall die Viertelpunkt-Form
 *   ergibt; wo das nicht geht (Kehle am Dachrand) oder Dächer zweier Etagen auf gleicher Höhe aneinanderstoßen, gilt
 *   Vanilla – der Hinweis stimmt dann mit dem gebauten Block überein (keine `stair_shape`-Warnung).
 */
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { CCW, CW, OPP, STEP, axisOf } from './grid.js';
import type { DormerFront, GableColumn } from './roof-shapes.js';
import type { ShellCell, StairShape } from './types.js';

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Treppenform nach der Vanilla-Regel: erst hinten → outer, dann vorn → inner, sonst straight. */
export function vanillaShapeAt(stairs: ReadonlyMap<string, { readonly facing: HorizontalDir; readonly half: string }>, p: Vec3): StairShape {
  const self = stairs.get(key(p[0], p[1], p[2]))!;
  const at = (dir: HorizontalDir): { readonly facing: HorizontalDir; readonly half: string } | undefined =>
    stairs.get(key(p[0] + STEP[dir][0], p[1], p[2] + STEP[dir][1]));
  const f = self.facing;
  const canTakeShape = (side: HorizontalDir): boolean => {
    const n = at(side);
    return n === undefined || n.facing !== f || n.half !== self.half;
  };
  const behind = at(f);
  if (behind !== undefined && behind.half === self.half && axisOf(behind.facing) !== axisOf(f) && canTakeShape(OPP[behind.facing])) {
    return behind.facing === CCW[f] ? 'outer_left' : 'outer_right';
  }
  const front = at(OPP[f]);
  if (front !== undefined && front.half === self.half && axisOf(front.facing) !== axisOf(f) && canTakeShape(front.facing)) {
    return front.facing === CCW[f] ? 'inner_left' : 'inner_right';
  }
  return 'straight';
}

/** Setzt `stairShape` jeder Dachtreppe (half bottom) auf das Vanilla-Ergebnis über alle Treppen in `cells` (in place). */
export function settleRoofStairs(cells: ShellCell[]): void {
  const stairs = new Map<string, { facing: HorizontalDir; half: string }>();
  for (const c of cells) {
    if (c.shape === 'stairs' && c.orient?.facing !== undefined) stairs.set(key(c.pos[0], c.pos[1], c.pos[2]), { facing: c.orient.facing, half: c.orient.half ?? 'bottom' });
  }
  cells.forEach((c, k) => {
    if (c.kind !== 'roof' || c.shape !== 'stairs' || c.orient?.facing === undefined || (c.orient.half ?? 'bottom') !== 'bottom') return;
    const shape = vanillaShapeAt(stairs, c.pos);
    if (c.orient.stairShape !== shape) cells[k] = { ...c, orient: { ...c.orient, stairShape: shape } };
  });
}

/**
 * Gaubenfenster (D4): Scheiben in die Frontwand jeder Gaube (ersetzt Wandzellen in place), darüber ein Rähm (Balken
 * quer zur Front), wo die Wand weitergeht. Merrell: vor jeder Scheibe Luft, sonst bleibt die Front geschlossen (ganz
 * oder gar nicht). Blindgaube: hinter jede Scheibe ein Vollblock (Glas vor Vollblock); sonst Dachraum-Luft dahinter.
 */
export function placeDormerWindows<F extends DormerFront>(cells: ShellCell[], fronts: readonly F[]): F[] {
  const placed: F[] = [];
  const index = new Map<string, number>();
  cells.forEach((c, k) => index.set(key(c.pos[0], c.pos[1], c.pos[2]), k));
  const at = (p: Vec3): ShellCell | undefined => {
    const k = index.get(key(p[0], p[1], p[2]));
    return k === undefined ? undefined : cells[k];
  };
  const put = (p: Vec3, c: Omit<ShellCell, 'pos' | 'roomId' | 'exterior'>): void => {
    const k = index.get(key(p[0], p[1], p[2]))!;
    const old = cells[k]!;
    cells[k] = { pos: p, ...c, ...(old.roomId !== undefined ? { roomId: old.roomId } : {}), exterior: true };
  };
  for (const f of fronts) {
    const [ox, oz] = STEP[f.dir];
    // W3 (Glasgiebel): je Spalte eigene oberste Reihe (`tops`)
    const topOf = (j: number): number => f.tops?.[j] ?? f.y1;
    const spots: Vec3[] = f.panes.flatMap(([x, z], k) => Array.from({ length: topOf(k) - f.y0 + 1 }, (_, j): Vec3 => [x, f.y0 + j, z]));
    if (!spots.every((p) => at(p)?.kind === 'wall' && at([p[0] + ox, p[1], p[2] + oz]) === undefined)) continue;
    placed.push(f);
    for (const p of spots) put(p, { kind: 'window', role: 'window', shape: 'pane' });
    for (const [k, [x, z]] of f.panes.entries()) {
      const p: Vec3 = [x, topOf(k) + 1, z];
      if (at(p)?.kind === 'wall') put(p, { kind: 'lintel', role: 'beam', shape: 'log', orient: { axis: axisOf(CW[f.dir]) } });
    }
    if (f.kind !== 'blind') continue;
    for (const p of spots) {
      const back: Vec3 = [p[0] - ox, p[1], p[2] - oz];
      if (at(back) !== undefined) continue;
      const roomId = at(p)!.roomId;
      index.set(key(back[0], back[1], back[2]), cells.length);
      cells.push({ pos: back, kind: 'wall', role: 'wall_primary', shape: 'block', ...(roomId !== undefined ? { roomId } : {}), exterior: false });
    }
  }
  return placed;
}

type Part = readonly [du: number, dy: number];
interface Opening {
  readonly panes: readonly Part[];
  /** Ecken des Okulus: Treppe (half) mit Rücken zur Seite `side` (−1 = kleinere Laufkoordinate). */
  readonly frames: ReadonlyArray<readonly [du: number, dy: number, half: 'bottom' | 'top', side: -1 | 1]>;
  /** Zellen, die Giebelwand bleiben müssen (Rahmung). */
  readonly walls: readonly Part[];
}

/**
 * Breites Giebelfenster 3 × 2 (Drillingsfenster). W13-E (28.09.2026): ersetzt den Okulus 3 × 3 als Pixelkreis (Glas im
 * Plus, W4) – den lasen alle Prüfer des blinden A/B-Tests als Kreuz (Projektregel: keine Kreuz- und Windradformen).
 * Ein Rechteck ohne Kreuz; jede Scheibe grenzt seitlich an Scheibe oder Wand, Wand rundum als Rahmen.
 */
const WIDE: Opening = {
  panes: [[-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
  frames: [],
  walls: [[-2, 0], [2, 0], [-2, 1], [2, 1], [-1, 2], [0, 2], [1, 2], [-1, -1], [0, -1], [1, -1]],
};
/**
 * W13-E: liegendes Band 3 × 1 im Platz des alten Okulus (Mittelreihe 5 breit, darüber und darunter 3 breit) – passt
 * überall dort, wo der Okulus passte, wenn das Drillingsfenster 3 × 2 zu hoch ist. Rechteck, kein Kreuz.
 */
const BAND: Opening = {
  panes: [[-1, 0], [0, 0], [1, 0]],
  frames: [],
  walls: [[-2, 0], [2, 0], [-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]],
};
const TALL: Opening = { panes: [[0, 0], [0, 1]], frames: [], walls: [[-1, 0], [1, 0], [-1, 1], [1, 1], [0, 2]] };
const SINGLE: Opening = { panes: [[0, 0]], frames: [], walls: [[-1, 0], [1, 0], [0, 1]] };
const PAIR: Opening = { panes: [[0, 0], [1, 0]], frames: [], walls: [[-1, 0], [2, 0], [0, 1], [1, 1]] };

/**
 * Giebelfenster in die Wandspalten `columns` setzen (ersetzt Wandzellen in place). Spalten gleicher Gruppe, Richtung
 * und Wandebene bilden zusammenhängende Läufe; die Achse ist die Mitte des höchsten Plateaus. `occupied`: Spalten, die
 * außerhalb der Hülle belegt sind (angedockte Bauwerke) – dort gilt die Scheibe als verdeckt. Additiv (Baukörper): mit
 * `y` fragt es eine Position (Dachraum eines Nachbar-Baukörpers).
 */
export function placeGableWindows(cells: ShellCell[], columns: readonly GableColumn[], occupied?: (x: number, z: number, y: number) => boolean): void {
  const index = new Map<string, number>();
  cells.forEach((c, k) => index.set(key(c.pos[0], c.pos[1], c.pos[2]), k));
  const gableWall = new Set<string>();
  for (const g of columns) for (let y = g.y0; y <= g.y1; y++) gableWall.add(key(g.x, y, g.z));
  const faces = new Map<string, GableColumn[]>();
  for (const g of columns) {
    const k = `${g.group}|${g.dir}|${axisOf(g.dir) === 'x' ? g.x : g.z}`;
    (faces.get(k) ?? faces.set(k, []).get(k)!).push(g);
  }
  for (const list of faces.values()) {
    const along = (g: GableColumn): number => (axisOf(list[0]!.dir) === 'x' ? g.z : g.x);
    list.sort((a, b) => along(a) - along(b));
    let s = 0;
    for (let e = 1; e <= list.length; e++) {
      if (e < list.length && along(list[e]!) === along(list[e - 1]!) + 1) continue;
      placeInRun(cells, index, gableWall, list.slice(s, e), occupied);
      s = e;
    }
  }
}

function placeInRun(cells: ShellCell[], index: Map<string, number>, gableWall: ReadonlySet<string>, run: readonly GableColumn[], occupied?: (x: number, z: number, y: number) => boolean): void {
  const W = run.length;
  if (W < 5) return;
  const dir = run[0]!.dir;
  const alongX = axisOf(dir) === 'z'; // Wandebene entlang x
  const maxTop = Math.max(...run.map((g) => g.y1));
  // längstes Plateau mit maximaler Oberkante
  let best: [number, number] = [0, -1];
  for (let a = 0; a < W; a++) {
    if (run[a]!.y1 !== maxTop) continue;
    let b = a;
    while (b + 1 < W && run[b + 1]!.y1 === maxTop) b++;
    if (b - a > best[1] - best[0]) best = [a, b];
    a = b;
  }
  const [pa, pb] = best;
  const single = (pb - pa) % 2 === 0;
  const axis = single ? (pa + pb) / 2 : (pa + pb - 1) / 2;
  const height = run[axis]!.y1 - run[axis]!.y0 + 1;
  if (height < 3) return;
  const posOf = (du: number, y: number): Vec3 | undefined => {
    const g = run[axis + du];
    if (g === undefined) return undefined;
    return [g.x, y, g.z];
  };
  const isWall = (p: Vec3 | undefined): boolean => p !== undefined && gableWall.has(key(p[0], p[1], p[2])) && index.has(key(p[0], p[1], p[2])) && cells[index.get(key(p[0], p[1], p[2]))!]!.kind === 'wall';
  const free = (p: Vec3, dx: number, dz: number): boolean => !index.has(key(p[0] + dx, p[1], p[2] + dz)) && occupied?.(p[0] + dx, p[2] + dz, p[1]) !== true;
  const [ox, oz] = STEP[dir];
  const fits = (o: Opening, y: number): boolean => {
    for (const [du, dy] of o.panes) {
      const p = posOf(du, y + dy);
      if (!isWall(p) || !free(p!, ox, oz) || !free(p!, -ox, -oz)) return false;
    }
    for (const [du, dy] of o.frames) if (!isWall(posOf(du, y + dy))) return false;
    for (const [du, dy] of o.walls) if (!isWall(posOf(du, y + dy))) return false;
    return true;
  };
  const options = single ? [...(W >= 7 && height >= 4 ? [WIDE, BAND] : []), ...(height >= 5 ? [TALL] : []), SINGLE] : [PAIR];
  const y0 = Math.min(...run.map((g) => g.y0));
  for (const o of options) {
    const valid: number[] = [];
    for (let y = y0; y <= maxTop; y++) if (fits(o, y)) valid.push(y);
    if (valid.length === 0) continue;
    // Mitte des gültigen Bereichs; bei zwei Zeilen die obere (Fenster nicht direkt auf der Decke)
    const y = valid[Math.floor(valid.length / 2)]!;
    const lowSide: HorizontalDir = alongX ? 'west' : 'north';
    const put = (p: Vec3, c: Omit<ShellCell, 'pos' | 'roomId' | 'exterior'>): void => {
      const k = index.get(key(p[0], p[1], p[2]))!;
      const old = cells[k]!;
      cells[k] = { pos: p, ...c, ...(old.roomId !== undefined ? { roomId: old.roomId } : {}), exterior: true };
    };
    for (const [du, dy] of o.panes) put(posOf(du, y + dy)!, { kind: 'window', role: 'window', shape: 'pane' });
    for (const [du, dy, half, side] of o.frames) {
      put(posOf(du, y + dy)!, { kind: 'window', role: 'window_frame', shape: 'stairs', orient: { facing: side < 0 ? lowSide : OPP[lowSide], half } });
    }
    return;
  }
}

// ---------------------------------------------------------------------------------------------- Dachraum-Licht

/**
 * Eine Spalte unter einem geneigten Dach: `floorY` = Decke der obersten Etage in dieser Spalte (Boden des Dachraums),
 * `top` = oberste Dachzelle. Luft dazwischen ist Dachraum (auch das Innere der Gauben).
 */
export interface AtticColumn {
  readonly x: number;
  readonly z: number;
  readonly floorY: number;
  readonly top: number;
}

/** Reichweite einer Laterne (Blocklicht 15) bis Licht 1: 14 Schritte (Faktencheck 5: Spawn nur bei Blocklicht 0). */
export const ATTIC_LIGHT_REACH = 14;

const SIX: readonly (readonly [number, number, number])[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Volle Oberseite einer Hüllzelle: Spawn-Untergrund und Standfläche einer stehenden Laterne (Faktencheck #3, 5). */
function fullTop(c: ShellCell): boolean {
  if (c.kind === 'window' || c.kind === 'door') return false;
  if (c.shape === 'block' || c.shape === 'planks' || c.shape === 'log' || c.shape === 'wood') return true;
  return (c.shape === 'slab' || c.shape === 'stairs') && c.orient?.half === 'top';
}

/** Laterne des Dachraum-Lichts (`placeAtticLights`): Ausstattung des Dachbodens, keine Deckenplatte. */
export function isAtticLight(c: ShellCell): boolean {
  return c.kind === 'ceiling' && c.shape === 'lantern';
}

/**
 * W4 (27.09.2026, plan/spikes/W4E_feinschliff.md): **Dachraum spawnsicher.** Der geschlossene Raum unter jedem geneigten
 * Dach (Satteldach, Palas …) ist kein Raum und bekam kein Licht – auf der Decke darunter konnten Monster spawnen
 * (Blocklicht 0, voller Untergrund). Hier stehen gezielt Laternen (`light_hanging`, stehend) auf dem Dachboden, bis jede
 * Dachraum-Zelle mit tragfähigem Boden höchstens `ATTIC_LIGHT_REACH` Schritte **durch Dachraum-Luft** von einer Laterne
 * entfernt liegt (konservativ: Licht, das seitlich durch Treppen/Stufen der Dachhaut dringt, zählt nicht mit).
 *
 * Gierig und deterministisch: erste unbeleuchtete Zelle nach (y, x, z); Standplätze in ihrer Reichweite nur unter dem
 * First (größte Kopfhöhe − 1). Es gewinnt der Platz mit den meisten neu beleuchteten Zellen, dann der mittigste (kleinste
 * Schrittsumme zu ihnen), dann Kopfhöhe, Decke vor anderem Boden, Lage. Die Laternen sind `kind: 'ceiling'`
 * (Ausstattung des Dachbodens: keine Flächen-Regel, im Viewer mit der Decke verdeckt; `isAtticLight`) und tragen den
 * Raum der Zelle darunter. Hängt die Zellen an `cells` an und liefert ihre Zahl.
 */
export function placeAtticLights(cells: ShellCell[], columns: readonly AtticColumn[]): number {
  const index = new Map<string, ShellCell>();
  for (const c of cells) {
    const k = key(c.pos[0], c.pos[1], c.pos[2]);
    if (!index.has(k)) index.set(k, c);
  }
  // Dachraum-Luft je Spalte zwischen Dachboden und oberster Dachzelle
  const at = new Map<string, number>();
  const pos: Vec3[] = [];
  const headroom: number[] = [];
  const seen = new Set<string>();
  for (const col of columns) {
    const ck = `${col.x},${col.z}`;
    if (seen.has(ck)) continue;
    seen.add(ck);
    for (let y = col.floorY + 1; y < col.top; y++) {
      const k = key(col.x, y, col.z);
      if (index.has(k)) continue;
      at.set(k, pos.length);
      pos.push([col.x, y, col.z]);
      headroom.push(col.top - y);
    }
  }
  if (pos.length === 0) return 0;
  // Zellen mit tragfähigem Boden: dort könnte ein Monster spawnen – und dort kann eine Laterne stehen
  const below = pos.map(([x, y, z]) => index.get(key(x, y - 1, z)));
  const need = below.map((b) => b !== undefined && fullTop(b));
  const nb = pos.map(([x, y, z]) => SIX.map(([dx, dy, dz]) => at.get(key(x + dx, y + dy, z + dz))).filter((j): j is number => j !== undefined));
  const dist = new Int32Array(pos.length).fill(-1);
  /** Zellen in Reichweite samt Schrittzahl (Schritte durch Dachraum-Luft). */
  const ball = (s: number): { readonly cells: number[]; readonly steps: number[] } => {
    const out = [s];
    const steps = [0];
    dist[s] = 0;
    for (let q = 0; q < out.length; q++) {
      const i = out[q]!;
      if (dist[i]! >= ATTIC_LIGHT_REACH) continue;
      for (const j of nb[i]!) {
        if (dist[j]! >= 0) continue;
        dist[j] = dist[i]! + 1;
        out.push(j);
        steps.push(dist[j]!);
      }
    }
    for (const i of out) dist[i] = -1;
    return { cells: out, steps };
  };
  const onCeiling = (i: number): number => (below[i]!.kind === 'ceiling' ? 1 : 0);
  const byPos = (a: number, b: number): number => pos[a]![1] - pos[b]![1] || pos[a]![0] - pos[b]![0] || pos[a]![2] - pos[b]![2];
  const order = pos.map((_, i) => i).filter((i) => need[i]).sort(byPos);
  const lit = new Uint8Array(pos.length);
  let placed = 0;
  for (const u of order) {
    if (lit[u] === 1) continue;
    const around = ball(u);
    // Standplätze nur unter dem First (größte Kopfhöhe in Reichweite, −1): mittig und schnell (wenige Kandidaten)
    const stands = around.cells.filter((c) => need[c]);
    const high = Math.max(...stands.map((c) => headroom[c]!)) - 1;
    let best: { readonly c: number; readonly cells: readonly number[]; readonly score: number; readonly spread: number } | undefined;
    for (const c of stands) {
      if (headroom[c]! < high) continue;
      const b = c === u ? around : ball(c);
      let score = 0;
      let spread = 0;
      b.cells.forEach((i, k) => {
        if (!need[i] || lit[i] === 1) return;
        score++;
        spread += b.steps[k]!;
      });
      const rank = best === undefined ? 1
        : score - best.score || best.spread - spread || headroom[c]! - headroom[best.c]! || onCeiling(c) - onCeiling(best.c) || byPos(best.c, c);
      if (rank > 0) best = { c, cells: b.cells, score, spread };
    }
    const chosen = best!;
    for (const i of chosen.cells) lit[i] = 1;
    const floor = below[chosen.c]!;
    cells.push({ pos: pos[chosen.c]!, kind: 'ceiling', role: 'light_hanging', shape: 'lantern', ...(floor.roomId !== undefined ? { roomId: floor.roomId } : {}), exterior: false });
    placed++;
  }
  return placed;
}
