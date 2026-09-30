/**
 * Kleiner Tiled-WFC-Solver (feat/tiled-wfc, Bericht plan/spikes/F_tiled_wfc.md; Vorbild „Simple Tiled Model“ von
 * mxgmn/WaveFunctionCollapse, Propagation wie DeBroglie/AC-3). Rein und deterministisch: Zufall nur aus dem Seed.
 *
 * Bausteine:
 *  - **Raster** (`WfcGrid`): N Zellen, D Richtungen, Nachbar je (Zelle, Richtung) oder -1. Fertige Raster: Kette
 *    (offen/ring), 2D (optional mit Maske) und 3D.
 *  - **Modell** (`WfcModel`): Kacheln mit Gewicht und Verträglichkeit je Richtung (`compat[d][a]` = erlaubte
 *    Nachbarn b in Richtung d von a). `socketModel` baut es aus Randcodes.
 *  - **Vorgaben**: feste Zellen (Domäne eingeschränkt oder vorab gesetzt) und **Bindungen** (`ties`): Zelle b trägt
 *    immer `map[Kachel von a]`. Mit einer Spiegel-Abbildung erzwingen Bindungen Spiegelsymmetrie – die Projektregel
 *    gegen Windrad-Formen (HANDOFF §1) steckt damit im Constraint-Netz, nicht in einer Nachkontrolle.
 *
 * Ablauf: AC-3 über alle Kanten → Zelle mit kleinster gewichteter Entropie H = log Σw − Σ w·log w / Σw (Gleichstand:
 * winziges Rauschen aus dem Seed) → Kachel gewichtet wählen → propagieren. Widerspruch → Rücksprung zur letzten
 * Entscheidung, gewählte Kachel dort verbieten (begrenztes Backtracking); Budget erschöpft → Neustart mit Teil-Strom
 * des Seeds (begrenzt). Ergebnis ist entweder vollständig und widerspruchsfrei oder `ok: false`.
 */
import { Rng } from './rng.js';

// ------------------------------------------------------------------ Raster

export interface WfcGrid {
  /** Zahl der Zellen. */
  readonly size: number;
  /** Zahl der Richtungen. */
  readonly dirs: number;
  /** Gegenrichtung je Richtung. */
  readonly opposite: readonly number[];
  /** Nachbar von Zelle i in Richtung d: `adj[i * dirs + d]`, -1 = keiner. */
  readonly adj: Int32Array;
}

/** Richtungen der Kette: 0 = weiter, 1 = zurück. */
export const CHAIN_NEXT = 0;
export const CHAIN_PREV = 1;

/** Kette aus n Zellen (0 → n-1); `ring` schließt sie zum Kreis. */
export function chainGrid(n: number, ring = false): WfcGrid {
  const adj = new Int32Array(n * 2).fill(-1);
  for (let i = 0; i < n; i++) {
    if (i + 1 < n) adj[i * 2] = i + 1;
    else if (ring && n > 1) adj[i * 2] = 0;
    if (i > 0) adj[i * 2 + 1] = i - 1;
    else if (ring && n > 1) adj[i * 2 + 1] = n - 1;
  }
  return { size: n, dirs: 2, opposite: [1, 0], adj };
}

/** Richtungen im Raster: +x, −x, +z, −z (2D) und +y, −y (3D). */
export const DIR_PX = 0;
export const DIR_NX = 1;
export const DIR_PZ = 2;
export const DIR_NZ = 3;
export const DIR_PY = 4;
export const DIR_NY = 5;

/**
 * 2D-Raster w × d, Index = z·w + x. `inside(x, z)` = false nimmt eine Zelle aus dem Netz (sie hat keine Nachbarn und
 * kein Nachbar zeigt auf sie; ihre Domäne ist beliebig und wird im Ergebnis mit -1 markiert).
 */
export function grid2d(w: number, d: number, inside?: (x: number, z: number) => boolean): WfcGrid & { readonly active: Uint8Array } {
  return grid3d(w, 1, d, inside === undefined ? undefined : (x, _y, z) => inside(x, z), 4);
}

/** 3D-Raster w × h × d, Index = (y·d + z)·w + x. */
export function grid3d(
  w: number, h: number, d: number, inside?: (x: number, y: number, z: number) => boolean, dirs: 4 | 6 = 6,
): WfcGrid & { readonly active: Uint8Array } {
  const size = w * h * d;
  const active = new Uint8Array(size);
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) active[(y * d + z) * w + x] = inside === undefined || inside(x, y, z) ? 1 : 0;
  const adj = new Int32Array(size * dirs).fill(-1);
  const at = (x: number, y: number, z: number): number => (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d ? -1 : (y * d + z) * w + x);
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        const i = at(x, y, z);
        if (active[i] === 0) continue;
        const nb = [at(x + 1, y, z), at(x - 1, y, z), at(x, y, z + 1), at(x, y, z - 1), at(x, y + 1, z), at(x, y - 1, z)];
        for (let k = 0; k < dirs; k++) {
          const j = nb[k]!;
          adj[i * dirs + k] = j >= 0 && active[j] === 1 ? j : -1;
        }
      }
    }
  }
  return { size, dirs, opposite: dirs === 4 ? [1, 0, 3, 2] : [1, 0, 3, 2, 5, 4], adj, active };
}

// ------------------------------------------------------------------ Modell

export interface WfcTile {
  readonly id: string;
  /** Gewicht der Wahl (> 0; 0 = nie wählen, aber als Vorgabe erlaubt). */
  readonly weight: number;
}

export interface WfcModel {
  readonly tiles: readonly WfcTile[];
  readonly dirs: number;
  /** `compat[d][a]` = Kacheln b, die in Richtung d neben a liegen dürfen (symmetrisch: b erlaubt a in Gegenrichtung). */
  readonly compat: readonly (readonly (readonly number[])[])[];
}

export interface SocketTile extends WfcTile {
  /** Randcode je Richtung (Reihenfolge wie im Raster). */
  readonly sockets: readonly string[];
}

/**
 * Modell aus Randcodes: a und b passen in Richtung d, wenn `match(a.sockets[d], b.sockets[opposite[d]])` (Standard:
 * gleiche Codes). `match` muss symmetrisch sein.
 */
export function socketModel(
  tiles: readonly SocketTile[], opposite: readonly number[], match: (a: string, b: string) => boolean = (a, b) => a === b,
): WfcModel {
  const dirs = opposite.length;
  for (const t of tiles) if (t.sockets.length !== dirs) throw new RangeError(`Kachel ${t.id}: ${t.sockets.length} Randcodes, erwartet ${dirs}`);
  const compat = Array.from({ length: dirs }, (_, d) =>
    tiles.map((a) => tiles.flatMap((b, bi) => (match(a.sockets[d]!, b.sockets[opposite[d]!]!) ? [bi] : []))));
  return { tiles: tiles.map(({ id, weight }) => ({ id, weight })), dirs, compat };
}

export const tileIndex = (model: WfcModel, id: string): number => {
  const i = model.tiles.findIndex((t) => t.id === id);
  if (i < 0) throw new RangeError(`Kachel ${id} unbekannt`);
  return i;
};

// ------------------------------------------------------------------ Lösen

export interface WfcTie {
  readonly a: number;
  readonly b: number;
  /** Kachel von b = map[Kachel von a]; muss eine Involution sein (Spiegel), sonst Fehler. */
  readonly map: readonly number[];
}

export interface WfcOptions {
  readonly seed: number;
  /** Erlaubte Kacheln je Zelle (Vorgabe; eine Kachel = vorab gesetzt). */
  readonly fixed?: ReadonlyMap<number, readonly number[]>;
  /** Bindungen (Spiegelsymmetrie). */
  readonly ties?: readonly WfcTie[];
  /** Gewicht je Kachel überschreiben (z. B. aus dem Theme). */
  readonly weights?: readonly number[];
  /** Rücksprünge je Versuch (Standard 64). */
  readonly maxBacktracks?: number;
  /** Neustarts nach erschöpftem Budget (Standard 4). */
  readonly restarts?: number;
}

export interface WfcResult {
  readonly ok: boolean;
  /** Kachel je Zelle (-1 = Zelle nicht im Netz bzw. ohne Lösung). */
  readonly tiles: Int32Array;
  readonly backtracks: number;
  readonly restarts: number;
  readonly decisions: number;
  readonly reason?: string;
}

class Contradiction {
  constructor(readonly cell: number) {}
}

/** Löst das Raster. Deterministisch je (Modell, Raster, Optionen). */
export function solveWfc(model: WfcModel, grid: WfcGrid, opts: WfcOptions): WfcResult {
  if (model.dirs !== grid.dirs) throw new RangeError(`Modell hat ${model.dirs} Richtungen, Raster ${grid.dirs}`);
  const T = model.tiles.length;
  const N = grid.size;
  const weights = opts.weights ?? model.tiles.map((t) => t.weight);
  if (weights.length !== T) throw new RangeError('weights: Länge passt nicht zur Kachelzahl');
  const ties = opts.ties ?? [];
  for (const t of ties) {
    if (t.map.length !== T) throw new RangeError('Bindung: map passt nicht zur Kachelzahl');
    t.map.forEach((m, k) => {
      if (t.map[m] !== k) throw new RangeError(`Bindung ${t.a}→${t.b}: map ist keine Involution (${k}→${m}→${t.map[m]})`);
    });
  }
  // Bindungen je Zelle (beide Richtungen, da Involution)
  const tieOf: { other: number; map: readonly number[] }[][] = Array.from({ length: N }, () => []);
  for (const t of ties) {
    tieOf[t.a]!.push({ other: t.b, map: t.map });
    if (t.a !== t.b) tieOf[t.b]!.push({ other: t.a, map: t.map });
  }
  const active = (grid as { active?: Uint8Array }).active;
  // Review F (A4): ohne Kacheln ist jede Zelle im Netz ein Widerspruch – nie `ok` mit leeren Zellen
  if (T === 0 && (active === undefined ? N > 0 : active.some((a) => a === 1))) {
    return { ok: false, tiles: new Int32Array(N).fill(-1), backtracks: 0, restarts: 0, decisions: 0, reason: 'Modell ohne Kacheln' };
  }
  const maxBack = opts.maxBacktracks ?? 64;
  const maxRestarts = opts.restarts ?? 4;
  const root = new Rng(opts.seed);
  let backtracks = 0;
  let decisions = 0;

  for (let attempt = 0; attempt <= maxRestarts; attempt++) {
    const rng = attempt === 0 ? root : root.fork(`restart-${attempt}`);
    const dom = new Uint8Array(N * T).fill(1);
    const count = new Int32Array(N).fill(T);
    let fail: string | undefined;
    const ban = (i: number, t: number): boolean => {
      if (dom[i * T + t] === 0) return false;
      dom[i * T + t] = 0;
      count[i]!--;
      if (count[i] === 0) throw new Contradiction(i);
      return true;
    };
    const propagate = (start: readonly number[]): void => {
      const queue = [...start];
      const queued = new Uint8Array(N);
      for (const i of start) queued[i] = 1;
      const allowed = new Uint8Array(T);
      for (let head = 0; head < queue.length; head++) {
        const c = queue[head]!;
        queued[c] = 0;
        const touch = (n: number): void => {
          if (queued[n] === 0) {
            queued[n] = 1;
            queue.push(n);
          }
        };
        for (let d = 0; d < grid.dirs; d++) {
          const n = grid.adj[c * grid.dirs + d]!;
          if (n < 0) continue;
          allowed.fill(0);
          for (let a = 0; a < T; a++) if (dom[c * T + a] === 1) for (const b of model.compat[d]![a]!) allowed[b] = 1;
          let changed = false;
          for (let b = 0; b < T; b++) if (allowed[b] === 0 && ban(n, b)) changed = true;
          if (changed) touch(n);
        }
        for (const { other, map } of tieOf[c]!) {
          allowed.fill(0);
          for (let a = 0; a < T; a++) if (dom[c * T + a] === 1) allowed[map[a]!] = 1;
          let changed = false;
          for (let b = 0; b < T; b++) if (allowed[b] === 0 && ban(other, b)) changed = true;
          if (changed) touch(other);
        }
      }
    };
    const cells: number[] = [];
    for (let i = 0; i < N; i++) if (active === undefined || active[i] === 1) cells.push(i);
    try {
      for (const [i, list] of opts.fixed ?? []) {
        const keep = new Set(list);
        for (let t = 0; t < T; t++) if (!keep.has(t)) ban(i, t);
      }
      propagate(cells);
    } catch (e) {
      if (!(e instanceof Contradiction)) throw e;
      return { ok: false, tiles: new Int32Array(N).fill(-1), backtracks, restarts: attempt, decisions, reason: `Vorgaben widersprüchlich (Zelle ${e.cell})` };
    }
    const noise = new Float64Array(N);
    for (const i of cells) noise[i] = rng.next() * 1e-6;
    const stack: { snapshot: Uint8Array; counts: Int32Array; cell: number; tile: number }[] = [];
    let localBack = 0;
    for (;;) {
      // Zelle mit kleinster gewichteter Entropie
      let best = -1;
      let bestH = Infinity;
      for (const i of cells) {
        if (count[i]! <= 1) continue;
        let sw = 0;
        let swl = 0;
        for (let t = 0; t < T; t++) {
          if (dom[i * T + t] === 0) continue;
          const w = Math.max(weights[t]!, 1e-9);
          sw += w;
          swl += w * Math.log(w);
        }
        const h = Math.log(sw) - swl / sw + noise[i]!;
        if (h < bestH) {
          bestH = h;
          best = i;
        }
      }
      if (best < 0) break; // alles entschieden
      const options: number[] = [];
      for (let t = 0; t < T; t++) if (dom[best * T + t] === 1) options.push(t);
      const positive = options.filter((t) => weights[t]! > 0);
      const tile = positive.length > 0 ? rng.weighted(positive, (t) => weights[t]!) : options[0]!;
      decisions++;
      stack.push({ snapshot: dom.slice(), counts: count.slice(), cell: best, tile });
      if (stack.length > maxBack + 1) stack.shift(); // tiefer als das Budget springt nie jemand zurück
      let pending: { cell: number; tile: number } | undefined = { cell: best, tile };
      let banning = false;
      // Entscheidung anwenden; bei Widerspruch zurückspringen und die Kachel dort verbieten
      while (pending !== undefined) {
        const { cell, tile: t } = pending;
        pending = undefined;
        try {
          if (banning) ban(cell, t);
          else for (let o = 0; o < T; o++) if (o !== t) ban(cell, o);
          propagate([cell]);
        } catch (e) {
          if (!(e instanceof Contradiction)) throw e;
          backtracks++;
          localBack++;
          if (localBack > maxBack) {
            fail = `Backtracking-Budget ${maxBack} erschöpft`;
            break;
          }
          const top = stack.pop();
          if (top === undefined) {
            fail = 'kein Rücksprung mehr möglich';
            break;
          }
          dom.set(top.snapshot);
          count.set(top.counts);
          // Die gewählte Kachel an dieser Zelle verbieten; die Entscheidung davor bleibt auf dem Stapel
          banning = true;
          pending = { cell: top.cell, tile: top.tile };
        }
      }
      if (fail !== undefined) break;
    }
    if (fail !== undefined) {
      if (attempt === maxRestarts) return { ok: false, tiles: new Int32Array(N).fill(-1), backtracks, restarts: attempt, decisions, reason: fail };
      continue;
    }
    const tiles = new Int32Array(N).fill(-1);
    for (const i of cells) {
      for (let t = 0; t < T; t++) {
        if (dom[i * T + t] === 1) {
          tiles[i] = t;
          break;
        }
      }
    }
    return { ok: true, tiles, backtracks, restarts: attempt, decisions };
  }
  /* c8 ignore next */
  return { ok: false, tiles: new Int32Array(N).fill(-1), backtracks, restarts: maxRestarts, decisions, reason: 'unerreichbar' };
}

/**
 * Harte Verstöße einer Belegung: unverträgliche Nachbarn, verletzte Bindungen, Vorgaben und leere Zellen im Netz.
 * Unabhängig vom Solver – für Tests und Messung.
 */
export function wfcViolations(model: WfcModel, grid: WfcGrid, tiles: Int32Array, opts: Pick<WfcOptions, 'fixed' | 'ties'> = {}): string[] {
  const out: string[] = [];
  const active = (grid as { active?: Uint8Array }).active;
  const allowed = model.compat.map((byA) => byA.map((list) => new Set(list)));
  for (let i = 0; i < grid.size; i++) {
    if (active !== undefined && active[i] === 0) continue;
    const a = tiles[i]!;
    if (a < 0) {
      out.push(`Zelle ${i}: leer`);
      continue;
    }
    for (let d = 0; d < grid.dirs; d++) {
      const n = grid.adj[i * grid.dirs + d]!;
      if (n < 0 || tiles[n]! < 0) continue;
      if (!allowed[d]![a]!.has(tiles[n]!)) out.push(`Zelle ${i} (${model.tiles[a]!.id}) → ${d} → Zelle ${n} (${model.tiles[tiles[n]!]!.id})`);
    }
  }
  for (const t of opts.ties ?? []) if (tiles[t.b] !== t.map[tiles[t.a]!]) out.push(`Bindung ${t.a}→${t.b} verletzt`);
  for (const [i, list] of opts.fixed ?? []) if (!list.includes(tiles[i]!)) out.push(`Vorgabe an Zelle ${i} verletzt`);
  return out;
}

/** Spiegel-Abbildung der Kacheln über ihre IDs (`mirror[id]` = Spiegelbild; fehlt = selbstsymmetrisch). */
export function mirrorMap(model: WfcModel, mirror: Readonly<Record<string, string>>): number[] {
  return model.tiles.map((t) => tileIndex(model, mirror[t.id] ?? t.id));
}

// ------------------------------------------------------------------ Lauflängen-Ketten

/** Art eines Laufs in einer Kette (z. B. Beet, Weg) mit erlaubten Breiten und Gewichten `[Breite, Gewicht]`. */
export interface RunKind {
  readonly id: string;
  readonly widths: ReadonlyArray<readonly [number, number]>;
}

export interface RunChain {
  readonly model: WfcModel;
  /** Spiegelbild je Kachel (Position im Lauf umgekehrt). */
  readonly mirror: readonly number[];
  readonly kindOf: readonly string[];
  readonly widthOf: readonly number[];
  readonly posOf: readonly number[];
  /** Alle Kacheln einer Art. */
  tilesOf(kind: string): number[];
  /** Kacheln, mit denen ein Lauf der Art beginnt bzw. endet (für Vorgaben am Kettenende). */
  startsOf(kind: string): number[];
  endsOf(kind: string): number[];
}

/**
 * Kachelsatz für Ketten aus Läufen (DeBroglie „max consecutive“ als Kacheln): Kachel = (Art, Breite, Position im
 * Lauf). Auf einen Lauf folgt immer ein Lauf **anderer** Art; die Breite ist genau eine der erlaubten. Das Spiegelbild
 * kehrt die Position um – mit `WfcTie` entstehen so palindromische (spiegelsymmetrische) Ketten.
 */
export function runChainModel(kinds: readonly RunKind[]): RunChain {
  const tiles: SocketTile[] = [];
  const kindOf: string[] = [];
  const widthOf: number[] = [];
  const posOf: number[] = [];
  for (const k of kinds) {
    for (const [w, weight] of k.widths) {
      if (w < 1 || !Number.isInteger(w)) throw new RangeError(`Lauf ${k.id}: Breite ${w} ungültig`);
      for (let p = 0; p < w; p++) {
        const next = p < w - 1 ? `${k.id}${w}.${p}` : `>${k.id}`;
        const prev = p > 0 ? `${k.id}${w}.${p - 1}` : `<${k.id}`;
        tiles.push({ id: `${k.id}${w}.${p}`, weight, sockets: [next, prev] });
        kindOf.push(k.id);
        widthOf.push(w);
        posOf.push(p);
      }
    }
  }
  const boundary = (s: string): boolean => s[0] === '>' || s[0] === '<';
  const model = socketModel(tiles, [1, 0], (a, b) => {
    if (!boundary(a) && !boundary(b)) return a === b;
    if (boundary(a) && boundary(b)) return a[0] !== b[0] && a.slice(1) !== b.slice(1);
    return false;
  });
  const mirror = tiles.map((_, i) => tiles.findIndex((_, j) => kindOf[j] === kindOf[i] && widthOf[j] === widthOf[i] && posOf[j] === widthOf[i]! - 1 - posOf[i]!));
  const pick = (f: (i: number) => boolean): number[] => tiles.flatMap((_, i) => (f(i) ? [i] : []));
  return {
    model, mirror, kindOf, widthOf, posOf,
    tilesOf: (kind) => pick((i) => kindOf[i] === kind),
    startsOf: (kind) => pick((i) => kindOf[i] === kind && posOf[i] === 0),
    endsOf: (kind) => pick((i) => kindOf[i] === kind && posOf[i] === widthOf[i]! - 1),
  };
}

/** Palindrom-Bindungen einer Kette der Länge n mit Spiegel-Abbildung `map`. */
export function palindromeTies(n: number, map: readonly number[], offset = 0): WfcTie[] {
  const out: WfcTie[] = [];
  for (let i = 0; i < Math.ceil(n / 2); i++) out.push({ a: offset + i, b: offset + n - 1 - i, map });
  return out;
}
