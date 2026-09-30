/**
 * Zinnenkranz aus dem Tiled-WFC (feat/tiled-wfc, Bericht plan/spikes/F_tiled_wfc.md §3). Nur mit
 * `StructureOptions.tiled`; ohne bleibt jeder Zinnenkranz bitgleich (fester Takt in tower/ring/wall).
 *
 * Kacheln entlang des Rands (Kette bzw. Ring, Richtung 0 = weiter, 1 = zurück):
 *  - `C` Scharte (Lücke, 1 breit – zwei Scharten nebeneinander verbieten die Randcodes),
 *  - `M` Zinne 1 breit, `Mc` Zinne 1 breit mit Deckplatte (Gesims-Stufe),
 *  - `Ma Mb` Zinne 2 breit, `M3a M3m M3b` Zinne 3 breit.
 * Randcodes: `x` = Zinnen-Ende → Scharte, `y` = Scharte → Zinnen-Anfang, `m2`/`m3a`/`m3b` innerhalb einer Zinne.
 *
 * Symmetrie (Projektregel gegen Windräder): jede gerade Seite ist ein Palindrom (Bindung Zelle i ↔ n−1−i mit dem
 * Spiegelbild der Kachel), Turmringe sind an beiden Achsen gespiegelt. Ecken sind immer Zinnen. Vorbilder: Zinnen
 * 1–3 Blöcke breit, Scharten schmaler als Zinnen (Burgen-Glossar, Quellen im Bericht).
 */
import { CHAIN_NEXT, Rng, chainGrid, hashSeed, mirrorMap, socketModel, solveWfc, type SocketTile, type WfcTie } from '@mcda/core';

export type CrenelTile = 'C' | 'M' | 'Mc' | 'Ma' | 'Mb' | 'M3a' | 'M3m' | 'M3b';

/** Zinne (Block in Zinnenhöhe)? */
export const isMerlon = (t: CrenelTile): boolean => t !== 'C';
/** Deckplatte über der Zinne? */
export const isCapped = (t: CrenelTile): boolean => t === 'Mc';

/** Gewichte je Breite und Stil; der Kachelsatz selbst ist für alle Themes gleich. */
export interface CrenelWeights {
  readonly crenel: number;
  readonly w1: number;
  readonly w2: number;
  readonly w3: number;
  readonly capped: number;
}

const DEFAULT: CrenelWeights = { crenel: 1, w1: 0.7, w2: 1, w3: 0.3, capped: 0.08 };

/**
 * Gewichte je Theme (Stimmung des Themes, Vorbilder im Bericht): Stein-Burgen (medieval, winter, harbor) breite
 * Zinnen, Holz-Themes (rustic, timber, farmstead, nordic) schmale Palisaden-Zinnen, Zwerge massig, Elben schlank mit
 * Deckplatten, Wüste breit mit Deckplatten, Ruine mit mehr Lücken.
 */
export const CRENEL_WEIGHTS: Readonly<Record<string, CrenelWeights>> = {
  medieval: DEFAULT,
  winter: DEFAULT,
  harbor: { crenel: 1, w1: 0.8, w2: 1, w3: 0.2, capped: 0.05 },
  rustic: { crenel: 1, w1: 1.4, w2: 0.5, w3: 0.05, capped: 0 },
  timber: { crenel: 1, w1: 1.4, w2: 0.5, w3: 0.05, capped: 0 },
  farmstead: { crenel: 1, w1: 1.4, w2: 0.4, w3: 0, capped: 0 },
  nordic: { crenel: 1, w1: 1.2, w2: 0.6, w3: 0.1, capped: 0.05 },
  nordic_falu: { crenel: 1, w1: 1.2, w2: 0.6, w3: 0.1, capped: 0.05 },
  // FN-Themes: Gotik schlank mit Deckplatten (Zinnenkappen als Fialen-Ansatz), Asien schmal und flach, Steampunk breit
  gothic: { crenel: 1, w1: 0.9, w2: 0.8, w3: 0.2, capped: 0.3 },
  asian: { crenel: 1, w1: 1.2, w2: 0.5, w3: 0.05, capped: 0.2 },
  steampunk: { crenel: 1, w1: 0.6, w2: 1, w3: 0.4, capped: 0.05 },
  dwarven: { crenel: 0.8, w1: 0.2, w2: 0.8, w3: 1, capped: 0.15 },
  elven: { crenel: 1, w1: 1.2, w2: 0.4, w3: 0.05, capped: 0.5 },
  desert: { crenel: 1, w1: 0.5, w2: 1, w3: 0.4, capped: 0.4 },
  tropical: { crenel: 1, w1: 1, w2: 0.8, w3: 0.1, capped: 0.2 },
  ruin: { crenel: 1.6, w1: 1, w2: 0.6, w3: 0.1, capped: 0 },
};

export const crenelWeights = (themeId: string | undefined): CrenelWeights => CRENEL_WEIGHTS[themeId ?? ''] ?? DEFAULT;

const TILES: readonly (Omit<SocketTile, 'weight'> & { readonly id: CrenelTile })[] = [
  { id: 'C', sockets: ['y', 'x'] },
  { id: 'M', sockets: ['x', 'y'] },
  { id: 'Mc', sockets: ['x', 'y'] },
  { id: 'Ma', sockets: ['m2', 'y'] },
  { id: 'Mb', sockets: ['x', 'm2'] },
  { id: 'M3a', sockets: ['m3a', 'y'] },
  { id: 'M3m', sockets: ['m3b', 'm3a'] },
  { id: 'M3b', sockets: ['x', 'm3b'] },
];
const MODEL = socketModel(TILES.map((t) => ({ ...t, weight: 1 })), [1, 0]);
const MIRROR = mirrorMap(MODEL, { Ma: 'Mb', Mb: 'Ma', M3a: 'M3b', M3b: 'M3a' });
const MERLONS = TILES.flatMap((t, i) => (isMerlon(t.id) ? [i] : []));
const SELF_SYMMETRIC = TILES.flatMap((t, i) => (MIRROR[i] === i ? [i] : []));

function weightsOf(w: CrenelWeights, preferWidth?: number): number[] {
  const boost = (width: number): number => (preferWidth === width ? 2 : 1);
  return TILES.map((t) => {
    switch (t.id) {
      case 'C': return w.crenel;
      case 'M': return w.w1 * boost(1);
      case 'Mc': return w.capped;
      case 'Ma': case 'Mb': return w.w2 * boost(2);
      default: return w.w3 * boost(3);
    }
  });
}

export interface CrenelProblem {
  /** Zahl der Randzellen in Reihenfolge. */
  readonly n: number;
  /** Ring (Turm) oder Kette (Mauerzug, Seite). */
  readonly ring: boolean;
  /** Paare (i, j), die Spiegelbilder tragen (i = j: Zelle auf der Achse, nur selbstsymmetrische Kacheln). */
  readonly mirror: ReadonlyArray<readonly [number, number]>;
  /** Zellen, die Zinnen sein müssen (Ecken). */
  readonly merlons?: readonly number[];
  readonly themeId?: string;
  /** Wunschbreite aus dem Plan (`merlon.width`): doppeltes Gewicht. */
  readonly preferWidth?: number;
  readonly seed: number;
}

/**
 * Löst einen Zinnenkranz. Liefert je Zelle die Kachel oder `undefined`, wenn das Netz unlösbar ist (der Aufrufer
 * behält dann den festen Takt).
 */
export function solveCrenels(p: CrenelProblem): CrenelTile[] | undefined {
  if (p.n === 0) return [];
  const grid = chainGrid(p.n, p.ring);
  const fixed = new Map<number, number[]>();
  for (const i of p.merlons ?? []) fixed.set(i, MERLONS);
  const ties: WfcTie[] = [];
  for (const [a, b] of p.mirror) {
    if (a === b) fixed.set(a, (fixed.get(a) ?? SELF_SYMMETRIC).filter((t) => SELF_SYMMETRIC.includes(t)));
    else ties.push({ a, b, map: MIRROR });
  }
  // Review F (A3): gleichmäßiger Takt – je Kranz eine Zinnenbreite (Wahl nach Theme-Gewicht); eine Nachbarbreite nur
  // als seltener Ausgleich, wo die Seitenlänge den Takt nicht aufgehen lässt
  const base = weightsOf(crenelWeights(p.themeId), p.preferWidth);
  const byWidth = [1, 2, 3].map((w) => TILES.reduce((s, t, i) => (widthOf(t.id) === w && isMerlon(t.id) ? s + base[i]! : s), 0));
  const rng = new Rng(hashSeed(p.seed, 'crenel-width', p.n));
  const width = byWidth.some((x) => x > 0) ? rng.weighted([1, 2, 3], (w) => byWidth[w - 1]!) : 1;
  const filler = width === 1 ? 2 : width - 1;
  const weights = TILES.map((t, i) => (t.id === 'C' ? base[i]! : widthOf(t.id) === width ? Math.max(base[i]!, t.id === 'Mc' ? 0 : 1e-3) : widthOf(t.id) === filler && t.id !== 'Mc' ? 1e-3 : 0));
  const allowed = TILES.flatMap((t, i) => (t.id === 'C' || widthOf(t.id) === width || (widthOf(t.id) === filler && t.id !== 'Mc') ? [i] : []));
  for (let i = 0; i < p.n; i++) fixed.set(i, (fixed.get(i) ?? allowed).filter((t) => allowed.includes(t)));
  const r = solveWfc(MODEL, grid, { seed: hashSeed(p.seed, 'crenel', p.n), fixed, ties, weights, maxBacktracks: 96, restarts: 6 });
  // Kein Takt möglich (sehr kurze Seiten): alle Breiten wie zuvor
  const res = r.ok ? r : solveWfc(MODEL, grid, {
    seed: hashSeed(p.seed, 'crenel', p.n), fixed: freeFixed(p), ties, weights: base, maxBacktracks: 96, restarts: 6,
  });
  if (!res.ok) return undefined;
  return [...res.tiles].map((t) => TILES[t]!.id);
}

/** Zinnenbreite einer Kachel (Scharte 0). */
const widthOf = (t: CrenelTile): number => (t === 'C' ? 0 : t === 'M' || t === 'Mc' ? 1 : t === 'Ma' || t === 'Mb' ? 2 : 3);

/** Vorgaben ohne Takt (Ecken, Achsenzellen). */
function freeFixed(p: CrenelProblem): Map<number, number[]> {
  const fixed = new Map<number, number[]>();
  for (const i of p.merlons ?? []) fixed.set(i, MERLONS);
  for (const [a, b] of p.mirror) if (a === b) fixed.set(a, (fixed.get(a) ?? SELF_SYMMETRIC).filter((t) => SELF_SYMMETRIC.includes(t)));
  return fixed;
}

/** Löst und trägt das Ergebnis in den Bericht ein (`log`); `undefined` = Rückfall auf den festen Takt. */
export function solveAndLog(
  p: CrenelProblem, id: string, kind: 'tower' | 'parapet' | 'wall', log: (e: { id: string; kind: 'tower' | 'parapet' | 'wall'; ok: boolean; pattern: string; violations: number }) => void,
): CrenelTile[] | undefined {
  const tiles = solveCrenels(p);
  log({ id, kind, ok: tiles !== undefined, pattern: tiles?.map(short).join('') ?? '', violations: tiles === undefined ? 0 : crenelViolations(tiles, p).length });
  return tiles;
}

const SHORT: Readonly<Record<CrenelTile, string>> = { C: '.', M: 'm', Mc: '^', Ma: '[', Mb: ']', M3a: '{', M3m: '=', M3b: '}' };
const short = (t: CrenelTile): string => SHORT[t];

/** Kette eines Mauerzugs: Palindrom je Abschnitt [lo, hi] (Indizes der Kette). */
export function palindromePairs(ranges: ReadonlyArray<readonly [number, number]>): [number, number][] {
  const out: [number, number][] = [];
  for (const [lo, hi] of ranges) for (let i = lo; i <= lo + Math.floor((hi - lo) / 2); i++) out.push([i, hi - (i - lo)]);
  return out;
}

/** Prüft eine Folge unabhängig vom Solver: Randcodes, Palindrome, Ecken. Liste der Verstöße (leer = gut). */
export function crenelViolations(tiles: readonly CrenelTile[], p: Pick<CrenelProblem, 'ring' | 'mirror' | 'merlons'>): string[] {
  const out: string[] = [];
  const idx = (t: CrenelTile): number => TILES.findIndex((x) => x.id === t);
  const n = tiles.length;
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : p.ring && n > 1 ? 0 : -1;
    if (j < 0) continue;
    if (!MODEL.compat[CHAIN_NEXT]![idx(tiles[i]!)]!.includes(idx(tiles[j]!))) out.push(`${i}:${tiles[i]}→${tiles[j]}`);
  }
  for (const [a, b] of p.mirror) if (MIRROR[idx(tiles[a]!)] !== idx(tiles[b]!)) out.push(`Spiegel ${a}↔${b}: ${tiles[a]}/${tiles[b]}`);
  for (const i of p.merlons ?? []) if (!isMerlon(tiles[i]!)) out.push(`Ecke ${i} ohne Zinne`);
  return out;
}
