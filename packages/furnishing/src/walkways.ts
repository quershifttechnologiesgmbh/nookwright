import { cellKey, type Cell } from '@mcda/core';
import type { RoomAnalysis } from './analyze.js';
import type { PlacedComponent } from './place.js';

/**
 * W8-B „Wege im Raum“ (plan/spikes/W8B_wege_im_raum.md, Vorbild DungeonGenerator_lernen §4.3 Ebene C):
 * das begehbare Netz eines Raums zwischen den Möbeln und die harte Regel `useAccess`.
 *
 * Netz = freie Bodenzellen (wie `connectivityOK`: Innenfläche ohne Möbel in Laufhöhe). Daraus:
 *  - **Taschen:** Blätter (≤ 1 freier Nachbar) werden wiederholt abgeschält; Türinnenzellen und gesperrte Zellen
 *    (Treppe) sind Ausgänge und bleiben stehen. Was abfällt, sind 1 breite Sackgassen („Taschen“); je Zelle zählt
 *    ihre Tiefe = Schritte vom Kern in die Tasche hinein.
 *  - **Kern:** der Rest. Eine Kernzelle, deren Wegfall den Kern zerteilt (Artikulationspunkt), ist der **einzige
 *    Durchgang** zwischen zwei Bereichen (oder zu einer Tür) – wer dort an der Truhe steht, versperrt den Weg.
 *  - **breit:** Zelle eines freien 2 × 2-Felds (dort gehen zwei aneinander vorbei).
 *
 * Regel `useAccess`: Jede Nutzungsgruppe (Maske `use`, Bett-Aufwachfeld, Arbeitsblock-Feld – dieselben Gruppen wie
 * „mindestens eine Nutzungszelle frei“) behält mindestens eine freie Zelle, die weder tiefer als `POCKET_MAX` in
 * einer Tasche liegt noch einziger Durchgang ist. Gruppen, die das schon vor einer Platzierung nicht erfüllten
 * (feste Möbel, Rückfall für Pflichtobjekte), bleiben geduldet – eine neue Platzierung darf nur nichts verschlechtern.
 */

/**
 * Tiefste geduldete Nutzungszelle in einer 1 breiten Sackgasse (Schritte vom 2 breiten bzw. verzweigten Netz):
 * 1 = eine Nische direkt am Netz (Bankreihe am Mittelgang, Truhe zwischen zwei Möbeln); tiefer muss man sich
 * durch einen 1 breiten Gang zwängen.
 */
export const POCKET_MAX = 1;
const UNREACHED = 1 << 20;

/** Begehbares Netz eines Raums (Raster über der Bounding-Box der Innenfläche). */
export interface WalkNet {
  readonly minX: number;
  readonly minZ: number;
  readonly w: number;
  readonly d: number;
  /** 1 = freie Bodenzelle. */
  readonly free: Uint8Array;
  /** Tiefe der Zelle in einer Tasche (1 breite Sackgasse): Schritte vom Kern; 0 = Kern. */
  readonly pocket: Int32Array;
  /** 1 = Kernzelle, die einziger Durchgang ist (Artikulationspunkt des Kerns). */
  readonly cut: Uint8Array;
  /** 1 = Zelle eines freien 2 × 2-Felds. */
  readonly wide: Uint8Array;
}

const DX = [1, -1, 0, 0] as const;
const DZ = [0, 0, 1, -1] as const;

interface Frame {
  readonly minX: number;
  readonly minZ: number;
  readonly w: number;
  readonly d: number;
  readonly cells: Int32Array;
  readonly anchors: Int32Array;
}
const frameCache = new WeakMap<RoomAnalysis, Frame>();

function frameOf(a: RoomAnalysis): Frame {
  let f = frameCache.get(a);
  if (f === undefined) {
    const g = a.geometry;
    const b = g.interior.bounds() ?? { minX: 0, minZ: 0, maxX: -1, maxZ: -1 };
    const w = b.maxX - b.minX + 1;
    const d = b.maxZ - b.minZ + 1;
    const idx = (x: number, z: number): number => (x < b.minX || z < b.minZ || x > b.maxX || z > b.maxZ ? -1 : (z - b.minZ) * w + (x - b.minX));
    const cells = Int32Array.from(g.interior.toArray().map(([x, z]) => idx(x, z)));
    const anchors = new Set<number>();
    for (const door of g.doors) for (const c of [door.inside, door.partner]) if (c !== undefined && g.interior.has(c[0], c[1])) anchors.add(idx(c[0], c[1]));
    for (const [x, z] of a.blocked) if (g.interior.has(x, z)) anchors.add(idx(x, z));
    frameCache.set(a, (f = { minX: b.minX, minZ: b.minZ, w: Math.max(0, w), d: Math.max(0, d), cells, anchors: Int32Array.from(anchors) }));
  }
  return f;
}

/** Netz für die Belegung `taken` (Bodenzellen mit Möbeln in Laufhöhe, Schlüssel `cellKey`). */
export function walkNet(a: RoomAnalysis, taken: ReadonlySet<string>): WalkNet {
  const f = frameOf(a);
  const { w, d, minX, minZ } = f;
  const n = w * d;
  const free = new Uint8Array(n);
  for (let j = 0; j < f.cells.length; j++) {
    const i = f.cells[j]!;
    if (!taken.has(cellKey(minX + (i % w), minZ + Math.floor(i / w)))) free[i] = 1;
  }
  const nb = (i: number, k: number): number => {
    const x = (i % w) + DX[k]!;
    const z = Math.floor(i / w) + DZ[k]!;
    return x < 0 || z < 0 || x >= w || z >= d ? -1 : z * w + x;
  };
  // 1) Taschen abschälen
  const anchor = new Uint8Array(n);
  for (const i of f.anchors) anchor[i] = 1;
  const deg = new Uint8Array(n);
  const peeled = new Uint8Array(n);
  const queue: number[] = [];
  for (let j = 0; j < f.cells.length; j++) {
    const i = f.cells[j]!;
    if (free[i] === 0) continue;
    let c = 0;
    for (let k = 0; k < 4; k++) {
      const m = nb(i, k);
      if (m >= 0 && free[m] === 1) c++;
    }
    deg[i] = c;
    if (c <= 1 && anchor[i] === 0) {
      peeled[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    for (let k = 0; k < 4; k++) {
      const m = nb(i, k);
      if (m < 0 || free[m] === 0 || peeled[m] === 1) continue;
      deg[m]!--;
      if (deg[m]! <= 1 && anchor[m] === 0) {
        peeled[m] = 1;
        queue.push(m);
      }
    }
  }
  // Tiefe in der Tasche: Schritte vom Kern (oder Ausgang) in die Sackgasse hinein; Stücke ohne Kern bleiben „unendlich“
  const pocket = new Int32Array(n);
  const deep: number[] = [];
  for (const i of queue) {
    for (let k = 0; k < 4; k++) {
      const m = nb(i, k);
      if (m >= 0 && free[m] === 1 && peeled[m] === 0 && pocket[i] === 0) {
        pocket[i] = 1;
        deep.push(i);
      }
    }
  }
  for (let q = 0; q < deep.length; q++) {
    const i = deep[q]!;
    for (let k = 0; k < 4; k++) {
      const m = nb(i, k);
      if (m >= 0 && peeled[m] === 1 && pocket[m] === 0) {
        pocket[m] = pocket[i]! + 1;
        deep.push(m);
      }
    }
  }
  for (const i of queue) if (pocket[i] === 0) pocket[i] = UNREACHED;
  // 2) Artikulationspunkte des Kerns (iterative Tiefensuche nach Tarjan)
  const core = (i: number): boolean => i >= 0 && free[i] === 1 && peeled[i] === 0;
  const cut = new Uint8Array(n);
  const disc = new Int32Array(n);
  const low = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1);
  const next = new Uint8Array(n);
  let time = 0;
  for (let j = 0; j < f.cells.length; j++) {
    const root = f.cells[j]!;
    if (!core(root) || disc[root] !== 0) continue;
    disc[root] = low[root] = ++time;
    let rootChildren = 0;
    const stack = [root];
    while (stack.length > 0) {
      const v = stack[stack.length - 1]!;
      if (next[v]! < 4) {
        const u = nb(v, next[v]!++);
        if (!core(u)) continue;
        if (disc[u] === 0) {
          parent[u] = v;
          disc[u] = low[u] = ++time;
          if (v === root) rootChildren++;
          stack.push(u);
        } else if (u !== parent[v]) low[v] = Math.min(low[v]!, disc[u]!);
      } else {
        stack.pop();
        const p = parent[v]!;
        if (p >= 0) {
          low[p] = Math.min(low[p]!, low[v]!);
          if (p !== root && low[v]! >= disc[p]!) cut[p] = 1;
        }
      }
    }
    if (rootChildren > 1) cut[root] = 1;
  }
  // 3) breite Zellen (freies 2 × 2-Feld)
  const wide = new Uint8Array(n);
  for (let z = 0; z + 1 < d; z++) {
    for (let x = 0; x + 1 < w; x++) {
      const i = z * w + x;
      if (free[i] === 1 && free[i + 1] === 1 && free[i + w] === 1 && free[i + w + 1] === 1) wide[i] = wide[i + 1] = wide[i + w] = wide[i + w + 1] = 1;
    }
  }
  return { minX, minZ, w, d, free, pocket, cut, wide };
}

/** Rasterindex einer Zelle (−1 außerhalb). */
export function netIndex(net: Pick<WalkNet, 'minX' | 'minZ' | 'w' | 'd'>, c: Cell): number {
  const x = c[0] - net.minX;
  const z = c[1] - net.minZ;
  return x < 0 || z < 0 || x >= net.w || z >= net.d ? -1 : z * net.w + x;
}

/** Taugt die Zelle als Nutzungszelle (frei, in keiner langen Tasche, nicht einziger Durchgang)? */
export function accessCellOK(net: WalkNet, c: Cell): boolean {
  const i = netIndex(net, c);
  return i >= 0 && net.free[i] === 1 && net.pocket[i]! <= POCKET_MAX && net.cut[i] === 0;
}

/** Regel `useAccess` für eine Gruppe: mindestens eine Zelle taugt. */
export function groupAccessOK(net: WalkNet, group: readonly Cell[]): boolean {
  return group.some((c) => accessCellOK(net, c));
}

/**
 * Nutzungsgruppen einer platzierten Komponente, wie sie die Belegung führt: die `use`-Maske als eine Gruppe (nur
 * mit Zelle am Boden, gestapelte Kinder nutzt man über das Elternteil) und die Gruppen der Block-Regeln.
 */
export function accessGroups(p: PlacedComponent, useCells: readonly Cell[], ruleGroups: readonly Cell[][], baseY: number): Cell[][] {
  const out: Cell[][] = [];
  if ((p.expanded.masks.use?.length ?? 0) > 0 && useCells.length > 0 && p.cells.some((c) => c.pos[1] === baseY)) out.push([...useCells]);
  out.push(...ruleGroups);
  return out;
}

/** Kennzahlen „Wege im Raum“ für den Qualitätswert (`quality.ts`). */
export interface WalkwayMetrics {
  /** Nutzungsgruppen mit mindestens einer freien Zelle. */
  readonly groups: number;
  /** Davon ohne taugliche Zelle (Regel `useAccess` verletzt). */
  readonly violations: number;
  /** Umwegfaktor: Summe Laufweg Tür → nächste Nutzungszelle / Summe Manhattan-Abstand (≥ 1; 1 ohne Messwert). */
  readonly detour: number;
  /** Engstellen: zusammenhängende Stücke „einziger Durchgang“ im Kern. */
  readonly bottlenecks: number;
  /** Anteil der Gruppen mit einer Nutzungszelle am 2 breiten Netz (breit oder direkt daneben). */
  readonly wideShare: number;
}

/**
 * Kennzahlen des fertigen Raums: `taken` wie im Netz, `groups` alle Nutzungsgruppen der Möbel. Laufweg über das
 * freie Netz ab allen Türinnenzellen (Mehrquellen-BFS), Manhattan zur nächsten Türinnenzelle.
 */
export function walkwayMetrics(a: RoomAnalysis, taken: ReadonlySet<string>, groups: readonly (readonly Cell[])[]): WalkwayMetrics {
  const net = walkNet(a, taken);
  const { w, d } = net;
  const doors = a.geometry.doors.map((x) => x.inside);
  const dist = new Int32Array(w * d).fill(-1);
  const queue: number[] = [];
  for (const c of doors) {
    const i = netIndex(net, c);
    if (i >= 0 && net.free[i] === 1 && dist[i] === -1) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % w;
    const z = Math.floor(i / w);
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k]!;
      const nz = z + DZ[k]!;
      if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
      const m = nz * w + nx;
      if (net.free[m] === 1 && dist[m] === -1) {
        dist[m] = dist[i]! + 1;
        queue.push(m);
      }
    }
  }
  let counted = 0;
  let violations = 0;
  let walk = 0;
  let manhattan = 0;
  let wideOK = 0;
  const nearWide = (i: number): boolean => {
    if (net.wide[i] === 1) return true;
    const x = i % w;
    const z = Math.floor(i / w);
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k]!;
      const nz = z + DZ[k]!;
      if (nx >= 0 && nz >= 0 && nx < w && nz < d && net.wide[nz * w + nx] === 1) return true;
    }
    return false;
  };
  for (const group of groups) {
    const cells = group.map((c) => ({ c, i: netIndex(net, c) })).filter(({ i }) => i >= 0 && net.free[i] === 1);
    if (cells.length === 0) continue;
    counted++;
    if (!cells.some(({ c }) => accessCellOK(net, c))) violations++;
    if (cells.some(({ i }) => nearWide(i))) wideOK++;
    let best: { c: Cell; i: number } | undefined;
    for (const x of cells) if (dist[x.i]! >= 0 && (best === undefined || dist[x.i]! < dist[best.i]!)) best = x;
    if (best === undefined || doors.length === 0) continue;
    const m = Math.min(...doors.map((o) => Math.abs(o[0] - best!.c[0]) + Math.abs(o[1] - best!.c[1])));
    if (m === 0) continue;
    walk += dist[best.i]!;
    manhattan += m;
  }
  // Engstellen: Stücke zusammenhängender Durchgangszellen
  let bottlenecks = 0;
  const seen = new Uint8Array(w * d);
  for (let s = 0; s < w * d; s++) {
    if (net.cut[s] === 0 || seen[s] === 1) continue;
    bottlenecks++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % w;
      const z = Math.floor(i / w);
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]!;
        const nz = z + DZ[k]!;
        const m = nz * w + nx;
        if (nx >= 0 && nz >= 0 && nx < w && nz < d && net.cut[m] === 1 && seen[m] === 0) {
          seen[m] = 1;
          stack.push(m);
        }
      }
    }
  }
  return { groups: counted, violations, detour: manhattan === 0 ? 1 : walk / manhattan, bottlenecks, wideShare: counted === 0 ? 1 : wideOK / counted };
}
