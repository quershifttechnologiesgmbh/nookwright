/**
 * Türkandidaten + automatische Verbindungen (research/03 §C5, übernommen aus Spike T4, spikes/algorithms/src/doors.ts).
 *
 * Kandidat = STRAIGHT-Wandzelle, deren beide Querseiten begehbar sind (Boden eines Raums oder außen)
 * und zu zwei verschiedenen Räumen (oder Raum + außen) gehören.
 * Reihenfolge: Haustür (Raum per Seed, bevorzugt Außenwandlauf ≥ 3) → Flure zu allen Nachbarn →
 * BFS-Reparatur (günstigste Kante zwischen erreichtem und unerreichtem Raum) → Nebeneingänge für
 * abgetrennte Gebäudeteile.
 *
 * Abweichungen vom Spike: Gleichstände entscheidet ein Seed-Hash der Weltposition (stabil beim Anbauen),
 * direkt benachbarte Türen sind verboten (jede Tür hat links/rechts Wand), Innenhöfe zählen nicht als Eingang.
 *
 * W4-C (plan/spikes/W4C_tueren.md): mit `middleCols` nimmt die Haustür nur Zellen im Mittelfeld einer Fassadenlinie,
 * wo der Haustür-Pool welche hat (Baustandard F3); mit `doubleMain` wird die Haustür eines passenden Raums eine
 * **Doppeltür** – zwei Flügel nebeneinander auf einem symmetrischen Zellpaar (gerades Mittelfeld), die einzige
 * erlaubte Ausnahme von „Tür braucht Wand links und rechts“.
 */
import { hashSeed } from '@mcda/core';
import { chebIdx } from './grid.js';
import { FLOOR, type WallPlan } from './walls.js';

export type RoomRole = 'corridor' | 'public';
export type DoorReason = 'entrance' | 'side' | 'corridor' | 'reachability' | 'loop';

export interface DoorCandidate {
  readonly cell: number;
  readonly run: number;
  readonly pos: number;
  readonly runLength: number;
  /** Achse des Wandlaufs; man geht quer dazu durch die Tür. */
  readonly axis: 'x' | 'z';
  /** Zellen vor und hinter der Tür: [negative Seite (Nord/West), positive Seite (Süd/Ost)]. */
  readonly side: readonly [number, number];
  /** Raum je Seite (0 = außen). */
  readonly room: readonly [number, number];
  readonly a: number;
  readonly b: number;
  /** Basis-Score ohne Wechselwirkung mit anderen Türen. */
  readonly score: number;
  /** Seed-Hash der Weltposition für Gleichstände. */
  readonly tie: number;
  /** Außentür zum offenen Außenraum (nicht in einen Innenhof). */
  readonly open: boolean;
}

export interface PlacedDoor extends DoorCandidate {
  readonly reason: DoorReason;
  readonly isMain: boolean;
  /** Additiv (W4-C): Flügel einer Doppeltür – Wandzelle des anderen Flügels (im selben Wandlauf direkt daneben). */
  readonly pair?: number;
}

export interface DoorPlanInput {
  readonly plan: WallPlan;
  readonly roomCount: number;
  readonly role: (label: number) => RoomRole;
  /** Stabiler Schlüssel je Raum (RoomId) für die Seed-Auswahl. */
  readonly roomKey: (label: number) => string;
  readonly seed: number;
  readonly openOutside: Uint8Array;
  /** Mindestabstand (Chebyshev) zwischen zwei Türen, sonst Strafe. Standard 3. */
  readonly minDoorSpacing?: number;
  /** Außentüren erlaubt (Standard true). Obere Etagen: false – dort führt keine Tür ins Freie. */
  readonly exterior?: boolean;
  /** Räume, die schon erreichbar sind (z. B. über eine Treppe); Wurzeln der Erreichbarkeit. */
  readonly roots?: readonly number[];
  /** Bodenzellen, auf die keine Tür führen darf (Treppe, Deckenöffnung, Geländer). */
  readonly blocked?: Uint8Array;
  /** Wandzellen, die Wand bleiben müssen (Leiter-Träger). */
  readonly noDoor?: Uint8Array;
  /**
   * Additiv (Baukörper): Räume, die eine Außentür bekommen dürfen (Standard alle, wenn `exterior`). In einem Geschoss
   * mit dem Erdgeschoss eines Baukörpers und dem Obergeschoss eines anderen führt nur das Erdgeschoss ins Freie.
   */
  readonly exteriorRooms?: (label: number) => boolean;
  /**
   * Additiv (W2, Baustandard F3): Vorzug je Wandzelle für **Außentüren** (Bonus auf den Score, 0 = keiner) – mit dem
   * Fassadenraster die Feldachsen, das Mittelfeld der Linie am stärksten (`doorPreference`). Fehlt = wie bisher.
   */
  readonly preferCols?: (cell: number) => number;
  /**
   * Additiv (W4-C, Baustandard F3): Rang der Zellen im **Mittelfeld** einer Fassadenlinie (0 = keins; höher = besser,
   * `middleBayCells`). Hat der Haustür-Pool Mittelfeld-Zellen, wählt die Haustür Raum und Zelle nur unter denen mit dem
   * höchsten Rang, eine Doppeltür nur auf diesem Rang – sonst wie bisher. Fehlt = wie bisher.
   */
  readonly middleRank?: (cell: number) => number;
  /**
   * Additiv (W4-C): Doppeltür an der Haustür. `rooms` = Räume, deren Haustür zwei Flügel bekommt; `pairs` =
   * symmetrische Zellpaare (linke → rechte Wandzelle in Laufrichtung), z. B. die Doppelachse des geraden Mittelfelds.
   * Haben passende Räume des Haustür-Pools ein Paar, wird die Haustür dort doppelt; sonst wie bisher. Fehlt = wie bisher.
   */
  readonly doubleMain?: { readonly rooms: (label: number) => boolean; readonly pairs: ReadonlyMap<number, number> };
  /**
   * Additiv (feat/underground, DungeonGenerator_lernen.md §4.1 A2): Zusatztüren für Rundgänge. Nach der Reparatur
   * bekommt jedes benachbarte, noch nicht verbundene Raumpaar (beide erreichbar, beide in `rooms`) mit `chance` eine
   * Tür – der Türgraph ist dann kein Baum mehr. Würfel = Seed-Hash der beiden Raum-Schlüssel (stabil beim Anbauen).
   * Fehlt = wie bisher.
   */
  readonly loops?: { readonly chance: number; readonly rooms: (label: number) => boolean };
  /**
   * Additiv (W12-C, Scheunentor): Rang der Wandzellen für **Nebeneingänge** (0 = keiner, höher = besser). Hat der Pool
   * eines noch nicht verbundenen Gebäudeteils Zellen mit Rang > 0, wählt der Nebeneingang Raum und Zelle nur unter denen
   * mit dem höchsten Rang (Tür mittig in der Giebelwand der Scheune). Fehlt = wie bisher.
   */
  readonly sideRank?: (cell: number) => number;
}

export interface DoorPlan {
  readonly doors: readonly PlacedDoor[];
  readonly mainRoom: number | undefined;
  /** Räume, die vom Haupteingang (bzw. ohne Haustür vom ersten Raum) über Innentüren erreichbar sind. */
  readonly reachableFromMain: ReadonlySet<number>;
  /** Räume, die nur über einen Nebeneingang erreichbar sind. */
  readonly viaSideEntrance: readonly number[];
  /** Räume ohne jede Tür-Verbindung. */
  readonly unreachable: readonly number[];
}

const EPS = 1e-9;

export function doorCandidates(plan: WallPlan, seed: number, openOutside: Uint8Array, blocked?: Uint8Array, noDoor?: Uint8Array): DoorCandidate[] {
  const { frame, labels, kind } = plan;
  const walkable = (i: number): number | null => {
    const l = labels[i]!;
    if (l === 0) return 0;
    return kind[i] === FLOOR && blocked?.[i] !== 1 ? l : null;
  };
  const out: DoorCandidate[] = [];
  plan.runs.forEach((run, ri) => {
    const L = run.cells.length;
    const across = run.axis === 'x' ? frame.w : 1;
    run.cells.forEach((cell, pos) => {
      if (noDoor?.[cell] === 1) return;
      const p = cell - across;
      const q = cell + across;
      const rp = walkable(p);
      const rq = walkable(q);
      if (rp === null || rq === null || rp === rq) return;
      const half = (L - 1) / 2;
      const centerness = half > 0 ? 1 - Math.abs(pos - half) / half : 1;
      const cornerDist = Math.min(pos + 1, L - pos); // 1 = direkt neben Pfeiler/Ecke
      const score = centerness - (cornerDist < 2 ? 0.5 : 0) + 0.01 * L;
      const outside = rp === 0 ? p : rq === 0 ? q : -1;
      out.push({
        cell,
        run: ri,
        pos,
        runLength: L,
        axis: run.axis,
        side: [p, q],
        room: [rp, rq],
        a: Math.min(rp, rq),
        b: Math.max(rp, rq),
        score,
        tie: hashSeed(seed, 'door', frame.x0 + (cell % frame.w), frame.z0 + Math.floor(cell / frame.w)),
        open: outside >= 0 && openOutside[outside] === 1,
      });
    });
  });
  return out;
}

export function planDoors(input: DoorPlanInput): DoorPlan {
  const { plan, roomCount, role, roomKey, seed } = input;
  const spacing = input.minDoorSpacing ?? 3;
  const frame = plan.frame;
  const prefer = input.preferCols;
  const cands = doorCandidates(plan, seed, input.openOutside, input.blocked, input.noDoor)
    .map((c) => (prefer === undefined || c.a !== 0 ? c : { ...c, score: c.score + prefer(c.cell) }));
  const exterior = input.exterior ?? true;
  const pairKey = (a: number, b: number): number => (a < b ? a * (roomCount + 1) + b : b * (roomCount + 1) + a);

  const byPair = new Map<number, DoorCandidate[]>();
  const adjacent: Array<Set<number>> = Array.from({ length: roomCount + 1 }, () => new Set<number>());
  for (const c of cands) {
    const k = pairKey(c.a, c.b);
    let list = byPair.get(k);
    if (list === undefined) byPair.set(k, (list = []));
    list.push(c);
    if (c.a !== 0) {
      adjacent[c.a]!.add(c.b);
      adjacent[c.b]!.add(c.a);
    }
  }
  const neighbors = (r: number): number[] => [...adjacent[r]!].sort((x, y) => x - y);

  const doors: PlacedDoor[] = [];
  const connected = new Set<number>();

  const scoreWithOthers = (c: DoorCandidate): number => {
    let s = c.score;
    for (const d of doors) {
      const cheb = chebIdx(frame, d.cell, c.cell);
      if (cheb <= 1) return -Infinity; // Tür braucht Wand links und rechts
      if (cheb < spacing) s -= 2;
    }
    return s;
  };
  const bestOf = (list: readonly DoorCandidate[]): { c: DoorCandidate; s: number } | undefined => {
    let best: { c: DoorCandidate; s: number } | undefined;
    for (const c of list) {
      const s = scoreWithOthers(c);
      if (s === -Infinity) continue;
      if (best === undefined || s > best.s + EPS || (Math.abs(s - best.s) <= EPS && (c.tie < best.c.tie || (c.tie === best.c.tie && c.cell < best.c.cell)))) {
        best = { c, s };
      }
    }
    return best;
  };
  const place = (c: DoorCandidate, reason: DoorReason, isMain: boolean): void => {
    doors.push({ ...c, reason, isMain });
    connected.add(pairKey(c.a, c.b));
  };
  const placePair = (a: number, b: number, reason: DoorReason): boolean => {
    if (connected.has(pairKey(a, b))) return true;
    const best = bestOf(byPair.get(pairKey(a, b)) ?? []);
    if (best === undefined) return false;
    place(best.c, reason, false);
    return true;
  };
  /** Rendezvous-Hashing: stabil, wenn Räume dazukommen oder wegfallen. */
  const pickRoom = (rooms: Iterable<number>, salt: string): number | undefined => {
    let best: number | undefined;
    let bestH = Infinity;
    for (const r of rooms) {
      const h = hashSeed(seed, salt, roomKey(r));
      if (h < bestH || (h === bestH && best !== undefined && r < best)) {
        best = r;
        bestH = h;
      }
    }
    return best;
  };
  const bfs = (roots: Iterable<number>): Set<number> => {
    const adj = new Map<number, number[]>();
    for (const d of doors) {
      if (d.a === 0) continue;
      (adj.get(d.a) ?? adj.set(d.a, []).get(d.a)!).push(d.b);
      (adj.get(d.b) ?? adj.set(d.b, []).get(d.b)!).push(d.a);
    }
    const seen = new Set<number>(roots);
    const queue = [...seen];
    for (let qi = 0; qi < queue.length; qi++) {
      for (const n of adj.get(queue[qi]!) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen;
  };
  const roleCost = (r: number): number => (role(r) === 'corridor' ? 0 : 1);
  const exteriorPool = (rooms: ReadonlySet<number> | undefined): DoorCandidate[] => {
    const ext = cands.filter((c) => c.a === 0 && c.open && (rooms === undefined || rooms.has(c.b)) && input.exteriorRooms?.(c.b) !== false);
    const long = ext.filter((c) => c.runLength >= 3);
    const pool = long.length > 0 ? long : ext;
    const corridor = pool.filter((c) => role(c.b) === 'corridor');
    return corridor.length > 0 ? corridor : pool;
  };

  // 1) Haustür: Raum per Seed, bevorzugt mit Außenwandlauf ≥ 3 und Flur; W4-C: im Mittelfeld, wo möglich, und als
  //    Doppeltür in passenden Räumen mit symmetrischem Zellpaar
  const fullPool = exterior ? exteriorPool(undefined) : [];
  const middle = input.middleRank;
  const topRank = middle === undefined ? 0 : Math.max(0, ...fullPool.map((c) => middle(c.cell)));
  const midPool = topRank === 0 ? [] : fullPool.filter((c) => middle!(c.cell) === topRank);
  const mainPool = midPool.length > 0 ? midPool : fullPool;
  let mainRoom: number | undefined;
  const dbl = input.doubleMain;
  if (dbl !== undefined) {
    const byCell = new Map(fullPool.map((c) => [c.cell, c] as const));
    const pairs: Array<readonly [DoorCandidate, DoorCandidate]> = [];
    for (const [l, r] of dbl.pairs) {
      const a = byCell.get(l);
      const b = byCell.get(r);
      if (a === undefined || b === undefined || a.b !== b.b || a.run !== b.run || Math.abs(a.pos - b.pos) !== 1 || !dbl.rooms(a.b)) continue;
      // mit Mittelfeld-Regel nur auf der besten Mittelfeld-Stufe des Pools (sonst stünde die Doppeltür an einer Schmalseite)
      if (topRank > 0 && (middle!(a.cell) !== topRank || middle!(b.cell) !== topRank)) continue;
      pairs.push(a.pos < b.pos ? [a, b] : [b, a]);
    }
    const room = pickRoom(new Set(pairs.map(([a]) => a.b)), 'entrance');
    let best: { p: readonly [DoorCandidate, DoorCandidate]; s: number } | undefined;
    for (const p of pairs) {
      if (p[0].b !== room) continue;
      const s = (scoreWithOthers(p[0]) + scoreWithOthers(p[1])) / 2;
      if (best === undefined || s > best.s + EPS || (Math.abs(s - best.s) <= EPS && p[0].tie < best.p[0].tie)) best = { p, s };
    }
    if (best !== undefined) {
      const [a, b] = best.p;
      doors.push({ ...a, reason: 'entrance', isMain: true, pair: b.cell }, { ...b, reason: 'entrance', isMain: true, pair: a.cell });
      connected.add(pairKey(a.a, a.b));
      mainRoom = room;
    }
  }
  if (mainRoom === undefined) {
    mainRoom = pickRoom(new Set(mainPool.map((c) => c.b)), 'entrance');
    if (mainRoom !== undefined) {
      const best = bestOf(mainPool.filter((c) => c.b === mainRoom));
      if (best !== undefined) place(best.c, 'entrance', true);
    }
  }

  // 2) Flure: Türen zu allen angrenzenden Räumen
  for (let r = 1; r <= roomCount; r++) {
    if (role(r) !== 'corridor') continue;
    for (const n of neighbors(r)) placePair(r, n, 'corridor');
  }

  // 3) Erreichbarkeit: günstigste Kante zwischen erreichtem und unerreichtem Raum, bis nichts mehr geht
  const roots = new Set<number>(input.roots ?? []);
  if (mainRoom !== undefined) roots.add(mainRoom);
  if (roots.size === 0 && roomCount > 0) roots.add(1);
  const repair = (): void => {
    for (;;) {
      const reach = bfs(roots);
      let pending: { from: number; to: number; cost: number } | undefined;
      for (const r of [...reach].sort((x, y) => x - y)) {
        for (const n of neighbors(r)) {
          if (reach.has(n)) continue;
          const b = bestOf(byPair.get(pairKey(r, n)) ?? []);
          if (b === undefined) continue;
          // Flure vor öffentlichen Räumen durchqueren; Kandidatenqualität als Feinkriterium
          const cost = roleCost(r) * 10 + roleCost(n) * 5 - b.s;
          if (pending === undefined || cost < pending.cost - EPS) pending = { from: r, to: n, cost };
        }
      }
      if (pending === undefined) return;
      placePair(pending.from, pending.to, 'reachability');
    }
  };
  repair();
  const reachableFromMain = bfs(roots);

  // 4) Nebeneingänge für Gebäudeteile ohne Verbindung zum Haupteingang (begehbar bleibt alles)
  const allRooms = Array.from({ length: roomCount }, (_, i) => i + 1);
  while (exterior) {
    const reach = bfs(roots);
    const missing = new Set(allRooms.filter((r) => !reach.has(r)));
    if (missing.size === 0) break;
    const pool0 = exteriorPool(missing);
    // W12-C: Scheunentor – nur die Zellen mit dem höchsten Nebeneingangs-Rang, wo der Pool welche hat
    const sideRank = input.sideRank;
    const topSide = sideRank === undefined ? 0 : Math.max(0, ...pool0.map((c) => sideRank(c.cell)));
    const pool = topSide > 0 ? pool0.filter((c) => sideRank!(c.cell) === topSide) : pool0;
    const r = pickRoom(new Set(pool.map((c) => c.b)), 'side');
    if (r === undefined) break;
    const best = bestOf(pool.filter((c) => c.b === r));
    if (best === undefined) break;
    place(best.c, 'side', false);
    roots.add(r);
    repair();
  }
  // 5) Rundgänge (Zusatztüren, nur mit `loops`)
  if (input.loops !== undefined && input.loops.chance > 0) {
    const reached = bfs(roots);
    for (const k of [...byPair.keys()].sort((x, y) => x - y)) {
      if (connected.has(k)) continue;
      const { a, b } = byPair.get(k)![0]!;
      if (a === 0 || !reached.has(a) || !reached.has(b) || !input.loops.rooms(a) || !input.loops.rooms(b)) continue;
      if (hashSeed(seed, 'loop', roomKey(a), roomKey(b)) / 4294967296 >= input.loops.chance) continue;
      placePair(a, b, 'loop');
    }
  }
  const reach = bfs(roots);
  return {
    doors,
    mainRoom: doors.some((d) => d.isMain) ? mainRoom : undefined,
    reachableFromMain,
    viaSideEntrance: allRooms.filter((r) => reach.has(r) && !reachableFromMain.has(r)),
    unreachable: allRooms.filter((r) => !reach.has(r)),
  };
}

/**
 * W4-C Doppeltür ohne Fassadenraster: das mittlere Zellpaar jedes geraden Wandlaufs (≥ 4 Zellen, Wand links und rechts
 * des Paars). Schlüssel = Zelle mit der kleineren Laufposition.
 */
export function runPairs(plan: WallPlan): Map<number, number> {
  const out = new Map<number, number>();
  for (const run of plan.runs) {
    const L = run.cells.length;
    if (L < 4 || L % 2 !== 0) continue;
    out.set(run.cells[L / 2 - 1]!, run.cells[L / 2]!);
  }
  return out;
}
