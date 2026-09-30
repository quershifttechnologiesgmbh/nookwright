/**
 * Unterbau (feat/underground, plan/spikes/F_underground.md, DungeonGenerator_lernen.md §4.1 Vorschlag A1): Keller- bzw.
 * Dungeon-Ebene unter und um das Haus. Rein und deterministisch; Eingang ist ein fertiger, geprüfter Bauplan.
 *
 *  1. Ebenen: der Hauskeller (Etage −1) bleibt bzw. entsteht als ein Raum unter dem Grundriss; darunter liegt die
 *     Unterbau-Etage. Nur so liegt ihre Decke außerhalb des Hauses unter dem Gelände (Erdlagen darüber) statt als
 *     Steinplatte auf der Wiese.
 *  2. Treppe: je fehlende Etage ein gerader Lauf nach der Kern-Regel des Treppenkerns (`stairs.ts`: Stufen samt
 *     8er-Nachbarschaft in EINEM Raum, keine Überschneidung mit vorhandenen Läufen) möglichst nah am vorhandenen Kern –
 *     die Treppe ist immer Kern-Anschluss, nie ein Nebenprodukt der Wegsuche (vazgriz-Mangel, §2).
 *  3. Räume: Raumtypen aus einem Programm je Bautyp (Weinkeller, Lager, Kerker, Schatzkammer …), Größe aus der
 *     Mindestfläche des Katalogs; Startlage auf einem Ring um den Treppenraum, dann Separation (TinyKeep: überlappende
 *     Rechtecke schieben sich entlang der kleineren Eindringtiefe auseinander) und Reparatur (nächste freie Lage).
 *  4. Graph: Gabriel-Graph der Raummitten (Teilgraph der Delaunay-Triangulierung, enthält den minimalen Spannbaum) →
 *     Kruskal-MST → jede übrige Kante mit `loops` (Standard 0,125 wie vazgriz) zurück, mindestens eine, wo es geht.
 *  5. Gänge: A* mit Richtungszustand über 2×2-Pinsel (lichte Breite 2), Kosten wie `terrain/paths.ts` (leer 1,
 *     vorhandener Gang 0,4, Abbiegen +0,6), Heuristik getrennt von den Kantenkosten (vazgriz summiert sie auf), Start
 *     und Ziel an einer Wand (nie die Raummitte). Gemalt wird Pinsel + 1 Wandring; zusammenhängende Gänge sind ein Raum
 *     mit Flur-Rolle (Türen zu allen Nachbarn, `doors.ts`).
 *  6. Prüfen wie jeder Plan (`checkPlan`: gemalt, Treppen gesetzt, Hülle ohne Warnung, alles erreichbar,
 *     Mindestflächen); sonst nächster Unter-Seed, zuletzt ohne Unterbau mit Hinweis.
 */
import { DEFAULT_VOLUME, stairLayout, type StairLayout } from '@mcda/blueprint';
import { CellSet, Rng, hashSeed, type Cell, type HorizontalDir } from '@mcda/core';
import { checkPlan } from './check.js';
import { dilate } from './frame.js';
import type { BuildingPlan, PlanRoom, PlanStairs } from './plan.js';

/**
 * Standard des Schalters je Bautyp (fehlt `BuildingParams.underground`): hier kann der Unterbau später für einzelne
 * Bautypen als Standard eingeschaltet werden (Kandidaten laut F_underground.md §6: Burg, Wachturm, Taverne). Ein
 * ausdrückliches `underground: false` schaltet ihn immer ab. Auf `feat/underground` sind alle Einträge aus.
 */
export const UNDERGROUND_DEFAULTS: Readonly<Record<string, boolean>> = {
  castle_compact: false,
  watchtower: false,
  tavern: false,
};

/** Standard des Unterbaus für einen Bautyp (ohne Eintrag: aus). */
export const undergroundDefault = (typeId: string): boolean => UNDERGROUND_DEFAULTS[typeId] === true;

/**
 * Wahrscheinlichkeit der Zusatztüren für Rundgänge, wenn sie eingeschaltet sind (`BuildingParams.loopDoors: true`,
 * App-Schalter „Rundgänge“). Eigener Schalter, unabhängig vom Unterbau (Review A3).
 */
export const DEFAULT_LOOP_DOORS = 0.15;

/** Schalter samt Feineinstellung; `true` = Standardwerte. */
export interface UndergroundParams {
  /** Räume ohne Treppenraum (Standard nach Größe: S 2, M 3, L 4, fest 3). */
  readonly rooms?: number;
  /** Wahrscheinlichkeit je Nicht-Baum-Kante (Standard 0,125). */
  readonly loops?: number;
  /** Rand um den Hausgrundriss, in dem der Unterbau liegen darf (Standard 7). */
  readonly margin?: number;
}

/** Kennzahlen des Unterbaus (Bericht, Messung). */
export interface UndergroundReport {
  /** Etage der Unterbau-Ebene. */
  readonly floor: number;
  /** Räume samt Treppenraum (ohne Gänge). */
  readonly rooms: number;
  /** Gang-Räume (zusammenhängende Gangnetze). */
  readonly corridors: number;
  /** Kanten des Graphen mit verlegtem Gang und davon im Spannbaum. */
  readonly edges: number;
  readonly treeEdges: number;
  /** Schleifen = Kanten − (Knoten − 1). */
  readonly loops: number;
  /** Mittellinie aller Gänge (Pinsel-Schritte, ≈ Blöcke). */
  readonly corridorLength: number;
  /** Neue Treppenläufe (Hauskeller und Unterbau). */
  readonly stairs: number;
  /** Unter-Seed des Unterbaus. */
  readonly attempt: number;
}

/** Keller-Programme je Bautyp (Online-Vorbilder im Bericht: Undercroft, Burgkeller, Zwergenhallen, Stollen). */
const PROGRAMS: Readonly<Record<string, readonly string[]>> = {
  // der Treppenraum ist schon ein Lager – kein zweites (Review)
  castle_compact: ['dungeon', 'treasury', 'armory', 'wine_cellar', 'chapel'],
  watchtower: ['armory', 'dungeon', 'treasury', 'wine_cellar'],
  tavern: ['wine_cellar', 'brewhouse', 'storage', 'game_room'],
  longhouse: ['storage', 'brewhouse', 'armory', 'treasury'],
  farmhouse: ['storage', 'wine_cellar', 'brewhouse', 'workshop_redstone'],
  hobbit: ['wine_cellar', 'storage', 'study', 'treasury'],
};
const DEFAULT_PROGRAM: readonly string[] = ['storage', 'wine_cellar', 'treasury', 'alchemy'];
const ROOMS_BY_SIZE: Readonly<Record<string, number>> = { S: 2, M: 3, L: 4 };

/** Raumtyp der Gänge (Flur-Rolle über `corridorTypes`) und des Treppenraums. */
export const UNDERGROUND_CORRIDOR = 'gallery';
const HUB_TYPE = 'storage';
/** Lichte Höhe der Unterbau-Etage und eines neuen Hauskellers. */
const LEVEL_HEIGHT = 3;
/** Unter-Seeds, bevor der Unterbau entfällt. */
const ATTEMPTS = 6;
/** Lichte Breite der Gänge im Spannbaum (Hauptwege; Pilaster an einer Seite lassen 2 frei), Zusatzkanten 2. */
const MAIN_WIDTH = 3;
/** Abstand zwischen Raum-Rechtecken (Platz für einen Gang mit eigenen Wänden). */
const GAP = 5;
/** Kosten wie `terrain/paths.ts`. */
const COST_FREE = 1;
const COST_REUSE = 0.4;
const COST_TURN = 0.6;
/** Gang streift einen fremden Raum (dort entstünde eine ungeplante Tür). */
const COST_BRUSH = 2;

const DIRS4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const FACINGS: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];

interface Rect {
  x0: number;
  z0: number;
  readonly w: number;
  readonly d: number;
}

const rectCells = (r: Rect): CellSet => CellSet.rect(r.x0, r.z0, r.x0 + r.w - 1, r.z0 + r.d - 1);
const centerOf = (r: Rect): [number, number] => [r.x0 + (r.w - 1) / 2, r.z0 + (r.d - 1) / 2];

interface Flight {
  readonly stairs: PlanStairs;
  readonly layout: StairLayout;
}

const layoutOf = (s: PlanStairs, rise: number): StairLayout =>
  stairLayout({ type: s.type, origin: s.origin, facing: s.facing, ...(s.turn !== undefined ? { turn: s.turn } : {}) }, rise);

/** Reservierte Zellen je Etage (unten: Stufen + Antritt + Träger, oben: Öffnung + oberste Stufe + Austritt). */
function reserved(stairs: readonly PlanStairs[], riseOf: (floor: number) => number, floor: number): CellSet {
  let out = CellSet.empty();
  for (const s of stairs) {
    if (s.volumeId !== DEFAULT_VOLUME || (s.floor !== floor && s.floor + 1 !== floor)) continue;
    const l = layoutOf(s, riseOf(s.floor));
    const cells = s.floor === floor ? [...l.footprint, l.bottom.inside, ...(l.support !== undefined ? [l.support] : [])] : [...l.holes, ...l.top, l.arrival.inside];
    out = out.union(CellSet.of(cells));
  }
  return out;
}

/** Nicht begehbare Zellen je Etage: Stufen und Träger unten, Öffnung samt Geländer-Ring und oberste Stufe oben. */
function blockedBy(l: StairLayout, upper: boolean): CellSet {
  // oben: Geländer um die Öffnung (nicht auf dem Austritt, der ist reserviert – Leiter: direkt neben der Öffnung)
  return upper
    ? dilate(CellSet.of(l.holes)).union(CellSet.of(l.top)).difference(CellSet.of([l.arrival.inside]))
    : CellSet.of([...l.footprint, ...(l.support !== undefined ? [l.support] : [])]);
}

function blockedOn(stairs: readonly PlanStairs[], riseOf: (floor: number) => number, floor: number): CellSet {
  let out = CellSet.empty();
  for (const s of stairs) {
    if (s.volumeId !== DEFAULT_VOLUME || (s.floor !== floor && s.floor + 1 !== floor)) continue;
    out = out.union(blockedBy(layoutOf(s, riseOf(s.floor)), s.floor + 1 === floor));
  }
  return out;
}

/** Begehbare Fläche eines gemalten Raums (Näherung: Zellen, deren 8 Nachbarn im Raum liegen – der Wandring fällt weg). */
function inner(room: CellSet): CellSet {
  return CellSet.of(room.toArray().filter(([x, z]) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!room.has(x + dx, z + dz)) return false;
    return true;
  }));
}

const cheb = (a: CellSet, b: CellSet): number => {
  let best = Infinity;
  for (const [x, z] of a) for (const [u, v] of b) best = Math.min(best, Math.max(Math.abs(x - u), Math.abs(z - v)));
  return best;
};

/** Untere Etage eines Laufs: vorhandene Räume (Kern-Regel und Begehbarkeit) oder frei (Unterbau, `free`). */
type LowSide = { readonly rooms: readonly CellSet[]; readonly reserved: CellSet; readonly blocked: CellSet } | { readonly free: (zone: CellSet) => boolean };

/**
 * Lauf von Etage `lower` nach `lower + 1` nach der Kern-Regel: oben (Öffnung, oberste Stufe, Austritt) samt Nachbarn in
 * EINEM Raum und frei von vorhandenen Treppenzellen, die begehbare Fläche bleibt zusammenhängend; unten ebenso bzw.
 * `free`. Gerade Läufe zuerst, Leiter nur, wenn keiner passt (Turm). Bevorzugt dicht am vorhandenen Kern (`near`),
 * Gleichstand per Seed-Hash.
 */
/** Raum der oberen Etage eines Laufs: Zellen, verlangte Innenfläche, Vorrang (0 = Treppenraum des Kerns, 1 = Lager/Flur, 3 = sonst). */
interface UpRoom {
  readonly cells: CellSet;
  readonly min: number;
  readonly rank: number;
}

/** Räume, in die ein neuer Lauf gern mündet (Lager, Flur, Diele) – Küche und Stube behalten ihre Stellfläche. */
const STAIR_FRIENDLY: ReadonlySet<string> = new Set(['storage', 'wine_cellar', 'hallway', 'corridor', 'gallery', 'entrance_hall', 'dungeon', 'armory']);

function placeFlight(
  ups: readonly UpRoom[], upReserved: CellSet, upBlocked: CellSet, low: LowSide, lower: number, rise: number, seed: number,
): Flight | undefined {
  const innerOf = new Map<CellSet, CellSet>();
  const innerCached = (room: CellSet): CellSet => innerOf.get(room) ?? innerOf.set(room, inner(room)).get(room)!;
  const walkable = (room: CellSet, blocked: CellSet, access: Cell, min = 0): boolean => {
    const walk = innerCached(room).difference(blocked);
    return walk.size >= min && walk.has(access[0], access[1]) && walk.isConnected();
  };
  for (const type of ['straight', 'ladder'] as const) {
    let best: { f: Flight; score: number; tie: number } | undefined;
    for (const { cells: room, min, rank } of ups) {
      for (const origin of room.toArray()) {
        for (const facing of FACINGS) {
          const layout = stairLayout({ type, origin, facing }, rise);
          const upZone = dilate(CellSet.of([...layout.holes, ...layout.top, layout.arrival.inside]));
          if (upZone.difference(room).size > 0 || upZone.intersects(upReserved)) continue;
          // Leiter: der Träger ist eine Wandzelle des Raums (sonst stünde ein Pfosten mitten im Raum)
          if (layout.support !== undefined && innerCached(room).has(layout.support[0], layout.support[1])) continue;
          const score = rank * 1000 + (upReserved.isEmpty ? 0 : cheb(upZone, upReserved));
          const tie = hashSeed(seed, 'flight', origin[0], origin[1], facing);
          if (best !== undefined && (score > best.score || (score === best.score && tie >= best.tie))) continue;
          const lowZone = dilate(CellSet.of([...layout.footprint, layout.bottom.inside]));
          if ('free' in low) {
            if (!low.free(lowZone.union(CellSet.of(layout.support !== undefined ? [layout.support] : [])))) continue;
          } else {
            const home = low.rooms.find((r) => lowZone.difference(r).size === 0);
            if (home === undefined || lowZone.intersects(low.reserved)) continue;
            if (!walkable(home, low.blocked.union(blockedBy(layout, false)), layout.bottom.inside)) continue;
          }
          if (!walkable(room, upBlocked.union(blockedBy(layout, true)), layout.arrival.inside, min)) continue;
          best = { f: { stairs: { volumeId: DEFAULT_VOLUME, floor: lower, origin, facing, type }, layout }, score, tie };
        }
      }
    }
    if (best !== undefined) return best.f;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------- Separation

function overlapGap(a: Rect, b: Rect, gap: number): [number, number] | undefined {
  const ox = Math.min(a.x0 + a.w + gap - b.x0, b.x0 + b.w + gap - a.x0);
  const oz = Math.min(a.z0 + a.d + gap - b.z0, b.z0 + b.d + gap - a.z0);
  return ox > 0 && oz > 0 ? [ox, oz] : undefined;
}

/** TinyKeep-Separation: Paare mit Überlappung (samt Abstand) weichen entlang der kleineren Eindringtiefe aus. */
function separate(rects: Rect[], fixed: number, gap: number): void {
  for (let it = 0; it < 80; it++) {
    let moved = false;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const o = overlapGap(a, b, gap);
        if (o === undefined) continue;
        const [ca, cb] = [centerOf(a), centerOf(b)];
        const alongX = o[0] <= o[1];
        const sign = alongX ? (cb[0] >= ca[0] ? 1 : -1) : (cb[1] >= ca[1] ? 1 : -1);
        const need = alongX ? o[0] : o[1];
        const aFixed = i < fixed;
        const bFixed = j < fixed;
        if (aFixed && bFixed) continue;
        const mb = aFixed ? need : Math.ceil(need / 2);
        const ma = bFixed ? need : need - mb;
        if (alongX) {
          if (!aFixed) a.x0 -= sign * ma;
          if (!bFixed) b.x0 += sign * mb;
        } else {
          if (!aFixed) a.z0 -= sign * ma;
          if (!bFixed) b.z0 += sign * mb;
        }
        moved = true;
      }
    }
    if (!moved) return;
  }
}

// ---------------------------------------------------------------------------------------------- Graph

interface Edge {
  readonly a: number;
  readonly b: number;
  readonly len: number;
}

/** Gabriel-Graph: Kante a–b, wenn kein dritter Punkt im Kreis mit Durchmesser ab liegt (⊆ Delaunay, ⊇ EMST). */
function gabriel(pts: readonly (readonly [number, number])[]): Edge[] {
  const out: Edge[] = [];
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      const [ax, az] = pts[a]!;
      const [bx, bz] = pts[b]!;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const r2 = ((ax - bx) ** 2 + (az - bz) ** 2) / 4;
      const blocked = pts.some((p, k) => k !== a && k !== b && (p[0] - mx) ** 2 + (p[1] - mz) ** 2 < r2 - 1e-9);
      if (!blocked) out.push({ a, b, len: Math.sqrt(r2) * 2 });
    }
  }
  return out.sort((x, y) => x.len - y.len || x.a - y.a || x.b - y.b);
}

/** Kruskal: Spannbaum und Rest. */
function kruskal(n: number, edges: readonly Edge[]): { tree: Edge[]; rest: Edge[] } {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const tree: Edge[] = [];
  const rest: Edge[] = [];
  for (const e of edges) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra === rb) rest.push(e);
    else {
      parent[ra] = rb;
      tree.push(e);
    }
  }
  return { tree, rest };
}

// ---------------------------------------------------------------------------------------------- A*

class Heap {
  private readonly items: { k: number; f: number }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(k: number, f: number): void {
    const a = this.items;
    a.push({ k, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.f < a[i]!.f || (a[p]!.f === a[i]!.f && a[p]!.k <= a[i]!.k)) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): { k: number; f: number } {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        const less = (x: number, y: number): boolean => a[x]!.f < a[y]!.f || (a[x]!.f === a[y]!.f && a[x]!.k < a[y]!.k);
        if (l < a.length && less(l, m)) m = l;
        if (r < a.length && less(r, m)) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

interface Grid {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly d: number;
  /** Raum-Index + 1 je Zelle (0 = frei), −1 = gesperrt. */
  readonly owner: Int32Array;
  /** Lichte Gangzelle. */
  readonly clear: Uint8Array;
}

const gi = (g: Grid, x: number, z: number): number => (x < g.x0 || z < g.z0 || x >= g.x0 + g.w || z >= g.z0 + g.d ? -1 : (z - g.z0) * g.w + x - g.x0);

/** 2×2-Pinsel mit linker oberer Ecke (x, z) ist frei (keine Raum-, keine Sperrzelle, im Rahmen; Ring im Rahmen und nicht gesperrt). */
function brushFree(g: Grid, x: number, z: number, s: number): boolean {
  if (x - 1 < g.x0 || z - 1 < g.z0 || x + s >= g.x0 + g.w || z + s >= g.z0 + g.d) return false;
  for (let dz = 0; dz < s; dz++) for (let dx = 0; dx < s; dx++) if (g.owner[gi(g, x + dx, z + dz)] !== 0) return false;
  // der Wandring bleibt von fremden Baukörpern weg (gesperrte Zellen)
  for (let dz = -1; dz <= s; dz++) for (let dx = -1; dx <= s; dx++) if (g.owner[gi(g, x + dx, z + dz)] === -1) return false;
  return true;
}

/**
 * Abstand zu fremden Gängen: ein Pinsel berührt vorhandene Gänge (verschmilzt, Abstand ≤ 1) oder hält ≥ 3 Abstand.
 * Bei genau 2 teilten sich zwei Gänge eine Ringzelle – der Raum mit Vorrang nähme dem anderen dort eine Spur.
 */
function spaced(g: Grid, x: number, z: number, s: number): boolean {
  let near = false;
  let two = false;
  for (let dz = -2; dz <= s + 1; dz++) {
    for (let dx = -2; dx <= s + 1; dx++) {
      if (g.clear[gi(g, x + dx, z + dz)] !== 1) continue;
      if (dx >= -1 && dx <= s && dz >= -1 && dz <= s) near = true;
      else two = true;
    }
  }
  return near || !two;
}

/** Zellen, die der Pinsel mit einer Wand von `r` teilt (Tür möglich: gerade Wandzelle, dahinter Boden). */
function touches(x: number, z: number, r: Rect, s: number): boolean {
  for (let dz = 0; dz < s; dz++) {
    for (let dx = 0; dx < s; dx++) {
      const cx = x + dx;
      const cz = z + dz;
      if ((cz === r.z0 - 1 || cz === r.z0 + r.d) && cx > r.x0 && cx < r.x0 + r.w - 1) return true;
      if ((cx === r.x0 - 1 || cx === r.x0 + r.w) && cz > r.z0 && cz < r.z0 + r.d - 1) return true;
    }
  }
  return false;
}

/** Streift der Ring des Pinsels einen Raum außer `a`, `b`? */
function brushes(g: Grid, x: number, z: number, a: number, b: number, s: number): boolean {
  for (let dz = -1; dz <= s; dz++) {
    for (let dx = -1; dx <= s; dx++) {
      const o = g.owner[gi(g, x + dx, z + dz)]!;
      if (o > 0 && o - 1 !== a && o - 1 !== b) return true;
    }
  }
  return false;
}

/** A* von Raum `a` zu Raum `b` (Pinsel-Positionen); Heuristik = Manhattan-Abstand zum Ziel-Rechteck × kleinste Kosten. */
function route(g: Grid, rooms: readonly Rect[], a: number, b: number, s: number): Cell[] | undefined {
  const target = rooms[b]!;
  const h = (x: number, z: number): number => {
    const dx = Math.max(target.x0 - s - x, 0, x - (target.x0 + target.w));
    const dz = Math.max(target.z0 - s - z, 0, z - (target.z0 + target.d));
    return (dx + dz) * COST_REUSE;
  };
  const n = g.w * g.d;
  // Zustand = Zelle × 5 (Richtung 0–3, 4 = Start)
  const gScore = new Float64Array(n * 5).fill(Infinity);
  const from = new Int32Array(n * 5).fill(-1);
  const heap = new Heap();
  const src = rooms[a]!;
  for (let z = src.z0 - s - 1; z <= src.z0 + src.d + 1; z++) {
    for (let x = src.x0 - s - 1; x <= src.x0 + src.w + 1; x++) {
      if (!brushFree(g, x, z, s) || !spaced(g, x, z, s) || !touches(x, z, src, s)) continue;
      const st = gi(g, x, z) * 5 + 4;
      gScore[st] = 0;
      heap.push(st, h(x, z));
    }
  }
  while (heap.size > 0) {
    const { k, f } = heap.pop();
    const cell = Math.floor(k / 5);
    const dir = k % 5;
    const x = g.x0 + (cell % g.w);
    const z = g.z0 + Math.floor(cell / g.w);
    if (f > gScore[k]! + h(x, z) + 1e-9) continue;
    if (touches(x, z, target, s)) {
      const path: Cell[] = [];
      for (let st = k; st >= 0; st = from[st]!) {
        const c = Math.floor(st / 5);
        path.push([g.x0 + (c % g.w), g.z0 + Math.floor(c / g.w)]);
      }
      return path.reverse();
    }
    for (let nd = 0; nd < 4; nd++) {
      const [ddx, ddz] = DIRS4[nd]!;
      const nx = x + ddx;
      const nz = z + ddz;
      if (!brushFree(g, nx, nz, s) || !spaced(g, nx, nz, s)) continue;
      let reuse = true;
      for (let dz = 0; dz < s && reuse; dz++) for (let dx = 0; dx < s; dx++) if (g.clear[gi(g, nx + dx, nz + dz)] !== 1) reuse = false;
      const step = (reuse ? COST_REUSE : COST_FREE) + (dir !== 4 && dir !== nd ? COST_TURN : 0) + (brushes(g, nx, nz, a, b, s) ? COST_BRUSH : 0);
      const nk = gi(g, nx, nz) * 5 + nd;
      const ng = gScore[k]! + step;
      if (ng < gScore[nk]! - 1e-9) {
        gScore[nk] = ng;
        from[nk] = k;
        heap.push(nk, ng + h(nx, nz));
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------- Plan

export interface UndergroundInput {
  readonly plan: BuildingPlan;
  readonly params: UndergroundParams;
  /** Mindestfläche je Raumtyp (Katalog). */
  readonly minArea: (roomTypeId: string) => number;
  /** Verlangte Innenfläche der vorhandenen Plan-Räume (wie beim Hausplan). */
  readonly planMinArea: (roomIndex: number) => number;
  /** Feldbreite der Prüfung (wie beim Hausplan). */
  readonly bay?: number;
  /** Raum eines neuen Hauskellers: Pflicht-Eintrag des Programms für den Keller (sonst Lager, Eintrag −1). */
  readonly cellar?: { readonly roomTypeId: string; readonly entry: number };
}

export type UndergroundResult =
  | { readonly ok: true; readonly plan: BuildingPlan; readonly report: UndergroundReport; readonly tries: readonly string[] }
  | { readonly ok: false; readonly reason: string; readonly tries: readonly string[] };

/** Unterbau zum fertigen Plan; `ok: false` samt Grund, wenn kein Unter-Seed einen geprüften Plan ergibt. */
export function planUnderground(input: UndergroundInput): UndergroundResult {
  const tries: string[] = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const res = tryUnderground(input, attempt);
    if (typeof res === 'string') {
      tries.push(res);
      continue;
    }
    const check = checkPlan(res.plan, (i) => (i < input.plan.rooms.length ? input.planMinArea(i) : Math.min(4, input.minArea(res.plan.rooms[i]!.roomTypeId))), input.bay);
    if (check.problems.length === 0) return { ok: true, plan: res.plan, report: { ...res.report, attempt }, tries };
    tries.push(check.problems.slice(0, 2).join(' | '));
  }
  return { ok: false, reason: tries[tries.length - 1] ?? '', tries };
}

export function tryUnderground(input: UndergroundInput, attempt: number): { plan: BuildingPlan; report: UndergroundReport } | string {
  const { plan, params } = input;
  const rng = new Rng(hashSeed(plan.seed, plan.typeId, 'underground', attempt));
  const main = plan.rooms.filter((r) => r.volumeId === DEFAULT_VOLUME);
  const lo = Math.min(...main.map((r) => r.floor));
  if (lo < -1) return 'Bautyp hat schon eine zweite Kelleretage';
  const heightOf = new Map(plan.floors.map((f) => [f.index, f.height] as const));
  const floors = [...plan.floors];
  const rooms: PlanRoom[] = [...plan.rooms];
  const stairs: PlanStairs[] = [...plan.stairs];
  const newStairs: PlanStairs[] = [];
  const riseOf = (f: number): number => (heightOf.get(f) ?? LEVEL_HEIGHT) + 1;
  const ground = CellSet.of(main.filter((r) => r.floor === 0).flatMap((r) => r.cells.toArray()));
  // Spalten fremder Baukörper (Invariante: ein Baukörper je Spalte) samt 2 Zellen Abstand. W13-A (Runde 2): außerhalb des
  // Hausgrundrisses (samt 1 Zelle) 3 Zellen – lag der Unterbau im Hof zwischen Haus und frei stehendem Nebenbau (Scheune
  // links vom Wohnhaus), kürzte die Hülle dessen Dachüberstand (Überstand nur bis zur Mitte zwischen den Baukörpern), und die
  // Oberfläche änderte sich mit dem Unterbau (Ortgang-Anker). Angebaute Baukörper (Häuserzeile) bleiben bei 2.
  const near = dilate(dilate(CellSet.of(plan.rooms.filter((r) => r.volumeId !== DEFAULT_VOLUME).flatMap((r) => r.cells.toArray()))));
  const foreign = near.union(dilate(near).difference(dilate(ground)));
  const roomsOn = (f: number): PlanRoom[] => rooms.filter((r) => r.volumeId === DEFAULT_VOLUME && r.floor === f);
  const minOf = (r: PlanRoom): number => {
    const i = plan.rooms.indexOf(r);
    return i >= 0 ? input.planMinArea(i) : 0;
  };
  const upRooms = (f: number): UpRoom[] => {
    const core = reserved(stairs, riseOf, f);
    return roomsOn(f).map((r) => ({
      cells: r.cells, min: minOf(r), rank: r.cells.intersects(core) ? 0 : STAIR_FRIENDLY.has(r.roomTypeId) ? 1 : 3,
    }));
  };
  const seed = hashSeed(plan.seed, 'underground', attempt);

  // 1) Hauskeller: fehlt er, ein Raum unter dem ganzen Erdgeschoss des Hauptbaukörpers, samt Lauf ins Erdgeschoss
  if (lo === 0) {
    floors.unshift({ index: -1, height: LEVEL_HEIGHT });
    heightOf.set(-1, LEVEL_HEIGHT);
    const cellar = ground;
    rooms.push({
      volumeId: DEFAULT_VOLUME, floor: -1, cells: cellar, roomTypeId: input.cellar?.roomTypeId ?? HUB_TYPE, entry: input.cellar?.entry ?? -1,
      required: input.cellar !== undefined,
    });
    const f = placeFlight(
      upRooms(0), reserved(stairs, riseOf, 0), blockedOn(stairs, riseOf, 0),
      { rooms: [cellar], reserved: CellSet.empty(), blocked: CellSet.empty() }, -1, riseOf(-1), hashSeed(seed, 'cellar'),
    );
    if (f === undefined) return 'kein Platz für die Kellertreppe im Erdgeschoss';
    stairs.push(f.stairs);
    newStairs.push(f.stairs);
  }

  // 2) Unterbau-Etage U und Lauf in den Hauskeller
  const U = -2;
  floors.unshift({ index: U, height: LEVEL_HEIGHT });
  heightOf.set(U, LEVEL_HEIGHT);
  const b = ground.bounds()!;
  // schmale Grundrisse (Turm) bekommen mehr Rand, damit Treppenraum und Räume nebeneinander passen
  // spätere Unter-Seeds dürfen weiter hinaus (passt kein Raum neben den Treppenraum)
  const margin = Math.max(2, params.margin ?? Math.max(7, Math.ceil((26 - Math.min(b.maxX - b.minX, b.maxZ - b.minZ) - 1) / 2)) + 3 * attempt);
  const region = { x0: b.minX - margin, z0: b.minZ - margin, x1: b.maxX + margin, z1: b.maxZ + margin };
  const inRegion = (c: CellSet): boolean => c.toArray().every(([x, z]) => x >= region.x0 && z >= region.z0 && x <= region.x1 && z <= region.z1);
  const flight = placeFlight(
    upRooms(-1), reserved(stairs, riseOf, -1), blockedOn(stairs, riseOf, -1),
    { free: (zone) => !zone.intersects(foreign) && inRegion(zone) }, U, riseOf(U), hashSeed(seed, 'deep'),
  );
  if (flight === undefined) return 'kein Platz für die Treppe in den Unterbau';
  stairs.push(flight.stairs);
  newStairs.push(flight.stairs);

  // 3) Treppenraum: Kernzone + 1 längs, + 2 quer (Laufbreite neben der Treppe)
  const zone = dilate(CellSet.of([...flight.layout.footprint, flight.layout.bottom.inside, ...(flight.layout.support !== undefined ? [flight.layout.support] : [])])).bounds()!;
  const alongX = flight.stairs.facing === 'east' || flight.stairs.facing === 'west';
  const hub: Rect = alongX
    ? { x0: zone.minX - 1, z0: zone.minZ - 2, w: zone.maxX - zone.minX + 3, d: zone.maxZ - zone.minZ + 5 }
    : { x0: zone.minX - 2, z0: zone.minZ - 1, w: zone.maxX - zone.minX + 5, d: zone.maxZ - zone.minZ + 3 };
  if (rectCells(hub).intersects(foreign) || !inRegion(rectCells(hub))) return 'Treppenraum stößt an einen fremden Baukörper';

  // 4) Raumprogramm und Separation
  const program = PROGRAMS[plan.typeId] ?? DEFAULT_PROGRAM;
  const bySize = (plan.params.size !== undefined ? ROOMS_BY_SIZE[plan.params.size] ?? 3 : 3) + (plan.typeId === 'castle_compact' ? 1 : 0);
  const count = Math.max(1, Math.min(program.length, params.rooms ?? bySize));
  const types = program.slice(0, count);
  const rects: Rect[] = [hub];
  const hc = centerOf(hub);
  types.forEach((t, k) => {
    const area = input.minArea(t) * (1.3 + rng.next() * 0.7);
    const aspect = 1 + rng.next() * 0.6;
    let iw = Math.max(3, Math.round(Math.sqrt(area * aspect)));
    let id = Math.max(3, Math.ceil(area / iw));
    if (rng.chance(0.5)) [iw, id] = [id, iw];
    const angle = (2 * Math.PI * (k + rng.next() * 0.6)) / types.length;
    const r = (Math.max(hub.w, hub.d) + Math.max(iw, id)) / 2 + GAP + rng.int(0, 3);
    rects.push({ x0: Math.round(hc[0] + Math.cos(angle) * r - (iw + 1) / 2), z0: Math.round(hc[1] + Math.sin(angle) * r - (id + 1) / 2), w: iw + 2, d: id + 2 });
  });
  separate(rects, 1, GAP);
  // Reparatur: Räume außerhalb des Rahmens, auf fremden Spalten oder noch überlappend → nächste freie Lage (Spirale)
  const alone = (r: Rect): boolean => {
    if (r.x0 - 1 < region.x0 || r.z0 - 1 < region.z0 || r.x0 + r.w > region.x1 || r.z0 + r.d > region.z1) return false;
    for (let z = r.z0; z < r.z0 + r.d; z++) for (let x = r.x0; x < r.x0 + r.w; x++) if (foreign.has(x, z)) return false;
    return true;
  };
  const kept: number[] = [0];
  for (let k = 1; k < rects.length; k++) {
    const r = rects[k]!;
    const valid = (c: Rect): boolean => alone(c) && kept.every((j) => overlapGap(c, rects[j]!, GAP) === undefined);
    if (!valid(r)) {
      let found: Rect | undefined;
      for (let rad = 1; rad <= 24 && found === undefined; rad++) {
        for (let dz = -rad; dz <= rad && found === undefined; dz++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
            const c = { ...r, x0: r.x0 + dx, z0: r.z0 + dz };
            if (valid(c)) {
              found = c;
              break;
            }
          }
        }
      }
      if (found === undefined) continue;
      r.x0 = found.x0;
      r.z0 = found.z0;
    }
    kept.push(k);
  }
  const placed = kept.map((k) => rects[k]!);
  const placedTypes = [HUB_TYPE, ...kept.slice(1).map((k) => types[k - 1]!)];
  if (placed.length < 2) return 'kein Unterbau-Raum passt';

  // 5) Graph: Gabriel → MST → Zusatzkanten
  const pts = placed.map(centerOf);
  const { tree, rest } = kruskal(placed.length, gabriel(pts));
  const p = params.loops ?? 0.125;
  const extra = rest.filter(() => rng.chance(p));
  if (extra.length === 0 && rest.length > 0 && placed.length >= 3) extra.push(rest[0]!);

  // 6) Gänge: A* je Kante (Baum zuerst, kurze zuerst), vorhandene Gänge bevorzugt
  const g: Grid = (() => {
    const w = region.x1 - region.x0 + 1;
    const d = region.z1 - region.z0 + 1;
    const owner = new Int32Array(w * d);
    const grid: Grid = { x0: region.x0, z0: region.z0, w, d, owner, clear: new Uint8Array(w * d) };
    for (const [x, z] of foreign) {
      const i = gi(grid, x, z);
      if (i >= 0) owner[i] = -1;
    }
    placed.forEach((r, k) => {
      for (const [x, z] of rectCells(r)) owner[gi(grid, x, z)] = k + 1;
    });
    return grid;
  })();
  let length = 0;
  let realized = 0;
  for (const [ei, e] of [...tree, ...extra].entries()) {
    const w = ei < tree.length ? MAIN_WIDTH : 2;
    const path = route(g, placed, e.a, e.b, w);
    if (path === undefined) {
      if (ei < tree.length) return `kein Gang zwischen ${placedTypes[e.a]} und ${placedTypes[e.b]}`;
      continue;
    }
    realized++;
    for (const [x, z] of path) {
      let fresh = false;
      for (let dz = 0; dz < w; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const i = gi(g, x + dx, z + dz);
          if (g.clear[i] !== 1) fresh = true;
          g.clear[i] = 1;
        }
      }
      if (fresh) length++;
    }
  }

  // 7) Malen: Gangzellen + Wandring ohne Raumzellen; zusammenhängende Gänge = ein Flur-Raum. Diagonale Berührung zweier
  //    Gangzellen wird zur Kante (eine Querzelle dazu), sonst zerfiele der Boden nach Wandabzug.
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < g.w * g.d; i++) {
      if (g.clear[i] !== 1) continue;
      const x = g.x0 + (i % g.w);
      const z = g.z0 + Math.floor(i / g.w);
      for (const [dx, dz] of [[1, 1], [1, -1]] as const) {
        if (g.clear[gi(g, x + dx, z + dz)] !== 1) continue;
        const a = gi(g, x + dx, z);
        const c = gi(g, x, z + dz);
        if (g.clear[a] === 1 || g.clear[c] === 1) continue;
        const pick = g.owner[a] === 0 ? a : g.owner[c] === 0 ? c : -1;
        if (pick < 0) return 'Gänge berühren sich nur über Eck';
        g.clear[pick] = 1;
        changed = true;
      }
    }
  }
  const clear: Cell[] = [];
  for (let i = 0; i < g.w * g.d; i++) if (g.clear[i] === 1) clear.push([g.x0 + (i % g.w), g.z0 + Math.floor(i / g.w)]);
  const roomCells = placed.reduce((u, r) => u.union(rectCells(r)), CellSet.empty());
  const clearSet = CellSet.of(clear);
  if (dilate(clearSet).intersects(foreign)) return 'Gang auf fremden Spalten';
  // je Gangnetz (4-zusammenhängende Gangzellen) ein Flur-Raum mit seinem Wandring; ein Ring zwischen zwei Netzen gehört
  // dem größeren (der trägt nach der Vorrang-Regel die Wand, das kleinere behält seine lichte Breite)
  let taken = roomCells.union(clearSet);
  const corridors = clearSet.components().map((comp) => {
    const ring = dilate(comp).difference(taken);
    taken = taken.union(ring);
    return comp.union(ring);
  });
  placed.forEach((r, k) => rooms.push({ volumeId: DEFAULT_VOLUME, floor: U, cells: rectCells(r), roomTypeId: placedTypes[k]!, entry: -1, required: false }));
  for (const c of corridors) rooms.push({ volumeId: DEFAULT_VOLUME, floor: U, cells: c, roomTypeId: UNDERGROUND_CORRIDOR, entry: -1, required: false });

  const corridorTypes = [...new Set([...(plan.corridorTypes ?? ['hallway', 'corridor']), UNDERGROUND_CORRIDOR])];
  const report: UndergroundReport = {
    floor: U, rooms: placed.length, corridors: corridors.length, edges: realized, treeEdges: tree.length,
    loops: realized - (placed.length - 1), corridorLength: length, stairs: newStairs.length, attempt,
  };
  return {
    plan: { ...plan, floors, rooms, stairs, corridorTypes, underground: report },
    report,
  };
}
