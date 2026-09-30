/**
 * Fachwerk (research/18 F1, research/12 §3.3/§3.5, research/16 R1/R6/U3): Muster für Wandzellen einer Wandregel mit
 * `timber`. Rein und deterministisch (Seed + Wandlinie aus dem Kontext), gesteuert vom Theme.
 *
 * Obergeschoss der Vorlage „Fachwerkhaus“ von außen (lichte Höhe 3; Ecken 0/16, T-Stoß 8, Fenster 4/12). Seit W4
 * (27.09.2026, Review S5) ohne Streben: Felder unter 3 × 4 bleiben leeres Gefach (Vorbilder: Diagonalen nur in großen
 * Feldern), ein Füllmaterial je Gefach, kein Doppelständer.
 *
 *   x-------x-------x   Rähm: Deckenrähm bzw. Schwelle der Etage darüber (Ecken `wood`)
 *   |..|g|..|..|g|..|   | Ständer (Stamm senkrecht)   g Fenster   . Gefach
 *   |..|g|..|..|g|..|
 *   |..|-|..|..|-|..|   - Brüstungsriegel unter dem Fenster
 *   x-------x-------x   Schwelle: Bodenplatte (Wandfuß-Regel `along`) bzw. unterste Wandreihe (`sill`)
 *
 * Streben „/“ links, „\“ rechts der Fassadenmitte stehen nur in Feldern ab `TIMBER_BRACE_MIN` (3 breit, 4 hoch), z. B.
 * im Kniestock oder in hohen Sälen.
 *
 * Ständer: an Ecken/T-Stößen (Pfeilerspalten), mit Fassadenraster (W2) auf dessen Pfosten, direkt neben jeder
 * Tür/jedem Fenster (außer direkt am Rasterpfosten; W4: kein Ständer direkt neben einem ranghöheren) und dazwischen im Feldrhythmus
 * `bay` (Standard 3), je freiem Stück spiegelsymmetrisch verteilt (research/12 §3.5). W7: mit Raster nie ein Gefach
 * von 1 Spalte zwischen zwei Ständern – Feld zusammenlegen oder Fenster frei ins Gefach (`mergeStrips`). Motiv je Feld per
 * Hash(Seed, Wandlinie, min(k, n−1−k)): gespiegelte Felder bekommen dasselbe Motiv, links „/“, rechts „\“, das
 * Mittelfeld nur symmetrische. Felder mit Öffnung: Brüstungs- und Sturzriegel direkt unter/über dem Fenster.
 * Streben sind Vollblöcke (`wood`) in der Wandebene – Treppen ließen in 1 Block dicken Wänden Löcher (research/12 §3.3).
 * Über dem Rähm: Kniestock/Gaubenfront setzen die Ständer fort, das Giebeldreieck bekommt einen eigenen Rhythmus;
 * Riegel alle 4 Reihen, Fenster gerahmt.
 */
import type { ShellCell } from '@mcda/blueprint';
import type { SurfaceRule, TimberMotif, WallTimber } from '@mcda/catalog';
import { hashSeed } from '@mcda/core';
import type { CellContext, WallLine } from './context.js';
import type { SurfaceOut } from './surfaces.js';

/** Bauteil einer Fachwerkzelle: Ständer, liegender Stamm (Schwelle/Riegel), Strebe, Gefach. */
export type TimberPart = 'post' | 'rail' | 'brace' | 'infill';

export const TIMBER_DEFAULTS = { role: 'beam', bay: 3, motifs: ['cross', 'brace', 'k', 'none'] as readonly TimberMotif[] } as const;
/** Giebel: Riegel alle n Reihen über der Decke (3 Reihen Gefach dazwischen). */
export const GABLE_RAIL = 4;

// ---------------------------------------------------------------- Feldrhythmus (research/12 §3.5)

/** n Breiten ≥ 1 mit Summe `total`, spiegelsymmetrisch, Rest von der Mitte aus verteilt; sonst undefined. */
function symmetricWidths(total: number, n: number): number[] | undefined {
  if (n < 1 || total < n) return undefined;
  const base = Math.floor(total / n);
  let rem = total - base * n;
  if (n % 2 === 0 && rem % 2 === 1) return undefined;
  const w = new Array<number>(n).fill(base);
  const odd = n % 2 === 1;
  if (odd && rem % 2 === 1) {
    w[(n - 1) / 2]!++;
    rem--;
  }
  for (let d = odd ? 1 : 0; rem > 0; d++, rem -= 2) {
    const i = odd ? (n - 1) / 2 - d : n / 2 - 1 - d;
    w[i]!++;
    w[n - 1 - i]!++;
  }
  return w;
}

/**
 * Feldbreiten eines freien Stücks von `r` Spalten zwischen zwei festen Ständern: n = round((r + 1) / (bay + 1)) Felder
 * (bzw. n ± 1, wenn nur so eine spiegelsymmetrische Teilung aufgeht), die größte Abweichung von `bay` so klein wie möglich.
 */
export function fieldWidths(r: number, bay: number): number[] {
  if (r <= 0) return [];
  const n0 = Math.max(1, Math.round((r + 1) / (bay + 1)));
  let best: number[] | undefined;
  let score = Infinity;
  for (const n of [n0, n0 - 1, n0 + 1]) {
    const w = symmetricWidths(r - (n - 1), n);
    if (w === undefined) continue;
    const s = Math.max(...w.map((x) => Math.abs(x - bay)));
    if (s < score) [best, score] = [w, s];
  }
  return best ?? [r];
}

/** Ständer und Felder einer Wandlinie (research/12 §3.0: `post`, `bay`, `bayPos`, `bayW`, `nearOpening`). */
export interface BayLayout {
  readonly post: readonly boolean[];
  /** Feld je Spalte, von links gezählt (−1 = Ständer). */
  readonly bay: readonly number[];
  readonly bayPos: readonly number[];
  readonly bayW: readonly number[];
  readonly nBays: number;
  /** Feld enthält eine Tür/ein Fenster (je Feld). */
  readonly openBay: readonly boolean[];
  /** Spalten bis zur nächsten Öffnungsspalte (0 = Öffnung, Infinity = keine). */
  readonly nearOpening: readonly number[];
}

/**
 * W7 (27.09.2026, Review W4-R Runde 4 „Putzstreifen“, Baustandard W1): Ein Gefach ist nie nur 1 Spalte breit zwischen
 * zwei Ständern. Solche Streifen entstanden, wo ein Laibungsständer 2 Spalten neben einem Rasterpfosten oder einem
 * Eckständer stand – seit W6 stehen die Trennwände auf den Rasterpfosten, der Streifen markierte damit zugleich die
 * Innenwand. Vorbilder (plan/spikes/W7C_fachwerk.md §2): Ständer im gleichmäßigen Rhythmus, Fenster zwischen zwei
 * Ständern oder mittig im Gefach, Gefache 2–3 breit; enge 1er-Streifen nur als durchgehendes Ständerwerk.
 *
 * Alle Streifen einer Runde zugleich (spiegelgleich), Runden bis nichts mehr passt; je Runde die erste Stufe, die greift:
 * 1. Fenster frei ins Gefach: lässt sich am Streifen kein Feld zusammenlegen (auf beiden Seiten Pfeiler oder Laibung,
 *    z. B. Eckständer – Streifen – Laibung), entfallen **beide** Laibungsständer dieser Öffnung; sie steht dann mittig
 *    im Putzfeld zwischen Brüstungs- und Sturzriegel (`|.|g|.|` → `|..g..|`).
 * 2. Feld zusammenlegen: ein Rasterpfosten bzw. Rhythmusständer am Streifen (kein Pfeiler, nicht neben einer Öffnung)
 *    entfällt, wenn das Feld dahinter keine Öffnung hat und das neue Gefach höchstens `2 · bay − 1` breit wird
 *    (`|g|.|.|g|` → `|g|...|g|`).
 * 3. Sonst entfällt der Laibungsständer am Streifen (der Streifen gehört zum Fensterfeld).
 * Pfeiler (Ecke, Wandende) und Pfosten zwischen zwei Öffnungen bleiben immer.
 */
function mergeStrips(post: boolean[], pillar: readonly boolean[], opening: readonly boolean[], bay: number): void {
  const len = post.length;
  const at = (k: number, a: readonly boolean[]): boolean => k >= 0 && k < len && a[k] === true;
  const jamb = (k: number): boolean => at(k - 1, opening) || at(k + 1, opening);
  const strips = (): number[] => {
    const s: number[] = [];
    for (let i = 1; i + 1 < len; i++) if (!post[i] && !opening[i] && post[i - 1] && post[i + 1]) s.push(i);
    return s;
  };
  const maxW = 2 * bay - 1;
  /** Ständer j am Streifen i darf weg: kein Pfeiler, keine Laibung, Feld dahinter ohne Öffnung und nicht zu breit. */
  const mergeable = (i: number, j: number): boolean => {
    if (pillar[j] || jamb(j)) return false;
    const d = j - i;
    let w = 0;
    for (let e = j + d; e >= 0 && e < len && !post[e]; e += d, w++) if (opening[e]) return false;
    return w > 0 && w + 2 <= maxW;
  };
  /** Laibungsständer einer Öffnungsgruppe neben Spalte k (ohne Pfeiler und ohne Pfosten zwischen zwei Öffnungen). */
  const groupJambs = (k: number): number[] => {
    let s = k;
    let e = k;
    while (at(s - 1, opening)) s--;
    while (at(e + 1, opening)) e++;
    return [s - 1, e + 1].filter((j) => at(j, post) && !pillar[j] && !(at(j - 1, opening) && at(j + 1, opening)));
  };
  for (let round = 0; round < len; round++) {
    const s = strips();
    const drop = new Set<number>();
    // Fenster frei ins Gefach: am Streifen lässt sich kein Feld zusammenlegen (Pfeiler bzw. Laibung auf beiden Seiten)
    // – dann entfallen beide Laibungsständer der Öffnung, sie steht mittig im Gefach (Vorbilder: Fenster im Putzfeld)
    for (const i of s) {
      if (mergeable(i, i - 1) || mergeable(i, i + 1)) continue;
      for (const j of [i - 1, i + 1]) {
        if (pillar[j] || !jamb(j)) continue;
        for (const k of [j - 1, j + 1]) if (at(k, opening)) for (const q of groupJambs(k)) drop.add(q);
      }
    }
    // Feld zusammenlegen
    if (drop.size === 0) for (const i of s) for (const j of [i - 1, i + 1]) if (mergeable(i, j)) drop.add(j);
    // Rest: Laibung am Streifen entfällt
    if (drop.size === 0) for (const i of s) for (const j of [i - 1, i + 1]) if (!pillar[j] && jamb(j)) drop.add(j);
    if (drop.size === 0) return;
    for (const j of drop) post[j] = false;
  }
}

/**
 * @param grid W2 (Baustandard W2/F1): Pfostenspalten des Fassadenrasters. Sie sind feste Ständer (Fachwerk fluchtet mit
 *   Wandvorlagen und Fenstermodulen); ein Laibungsständer entfällt, wenn direkt daneben schon ein Rasterpfosten steht
 *   (kein Doppelständer). Ohne Raster unverändert.
 */
export function bayLayout(pillar: readonly boolean[], opening: readonly boolean[], bay: number = TIMBER_DEFAULTS.bay, grid?: readonly boolean[]): BayLayout {
  const len = pillar.length;
  const post = grid === undefined ? [...pillar] : pillar.map((p, i) => p || (grid[i] === true && !opening[i]));
  const fixed = [...post];
  // Laibungsständer direkt neben jeder Öffnung
  for (let i = 0; i < len; i++) {
    if (!opening[i] || pillar[i]) continue;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= len || opening[j]) continue;
      // W2: am Rasterpfosten braucht die Öffnung keinen zweiten Ständer daneben
      if (grid !== undefined && (fixed[j - 1] === true || fixed[j + 1] === true)) continue;
      post[j] = true;
    }
  }
  // Freie Stücke im Rhythmus teilen
  for (let i = 0; i < len;) {
    if (post[i] || opening[i]) {
      i++;
      continue;
    }
    let e = i;
    while (e + 1 < len && !post[e + 1] && !opening[e + 1]) e++;
    let at = i;
    for (const w of fieldWidths(e - i + 1, bay).slice(0, -1)) {
      at += w;
      post[at] = true;
      at++;
    }
    i = e + 1;
  }
  // W4 (27.09.2026, Review S5, Baustandard W2 „0 Doppelpfosten“): nebeneinanderstehende Ständer lesen sich als dunkle
  // Holzwand. Ein Ständer entfällt, wenn direkt daneben ein ranghöherer steht (Pfeiler/Wandende > Rasterpfosten >
  // Laibungs-/Rhythmusständer); gleichrangige Laibungs- und Rhythmusständer bleiben (Fenster brauchen ihren Rahmen).
  if (grid !== undefined) {
    const rank = (k: number): number => (pillar[k] ? 3 : fixed[k] ? 2 : post[k] ? 1 : 0);
    const drop: number[] = [];
    for (let k = 0; k < len; k++) {
      if (!post[k] || pillar[k]) continue;
      const r = rank(k);
      if ((k > 0 && rank(k - 1) > r) || (k + 1 < len && rank(k + 1) > r)) drop.push(k);
    }
    for (const k of drop) post[k] = false;
    mergeStrips(post, pillar, opening, bay);
  }
  const bayOf = new Array<number>(len).fill(-1);
  const bayPos = new Array<number>(len).fill(0);
  const bayW = new Array<number>(len).fill(0);
  const openBay: boolean[] = [];
  for (let i = 0; i < len;) {
    if (post[i]) {
      i++;
      continue;
    }
    let e = i;
    while (e + 1 < len && !post[e + 1]) e++;
    const k = openBay.length;
    openBay.push(opening.slice(i, e + 1).some(Boolean));
    for (let j = i; j <= e; j++) {
      bayOf[j] = k;
      bayPos[j] = j - i;
      bayW[j] = e - i + 1;
    }
    i = e + 1;
  }
  const near = new Array<number>(len).fill(Infinity);
  for (let i = 0, d = Infinity; i < len; i++) near[i] = d = opening[i] ? 0 : d + 1;
  for (let i = len - 1, d = Infinity; i >= 0; i--) near[i] = Math.min(near[i]!, (d = opening[i] ? 0 : d + 1));
  return { post, bay: bayOf, bayPos, bayW, nBays: openBay.length, openBay, nearOpening: near };
}

const LAYOUTS = new WeakMap<WallLine, Map<number, BayLayout>>();

/** Feldrhythmus einer Wandlinie (je Linie, Feldbreite und Art einmal berechnet); `gable` = ohne Öffnungen des Geschosses. */
export function lineLayout(line: WallLine, bay: number, gable = false): BayLayout {
  let m = LAYOUTS.get(line);
  if (m === undefined) LAYOUTS.set(line, (m = new Map()));
  const k = gable ? -bay : bay;
  let l = m.get(k);
  if (l === undefined) m.set(k, (l = bayLayout(line.pillar, gable ? line.opening.map(() => false) : line.opening, bay, line.grid)));
  return l;
}

// ---------------------------------------------------------------- Motive (research/18 F1)

/** Ersatz eines Motivs, das nicht passt (Raute → Kreuz → Strebe → leer; K → Strebe). */
const MOTIF_FALLBACK: Readonly<Record<TimberMotif, TimberMotif>> = {
  rhombus: 'cross', cross: 'brace', k: 'brace', brace: 'none', feet: 'none', rail: 'none', none: 'none',
};

/**
 * W4 (27.09.2026, Review S5): Mindestfeld für Streben. In 31 Fachwerk-Vorbildern (plan/spikes/W4G_material2.md §2)
 * stehen Diagonalen nur in Feldern ab 3 breit und 4 hoch (4 von 31 Bauten), kleine Felder (≤ 2 breit oder ≤ 3 hoch)
 * haben nie eine – dort bleibt das Gefach leer (Ständer und Riegel).
 */
export const TIMBER_BRACE_MIN = { bw: 3, h: 4 } as const;

/** Größenregel je Motiv (Mindestmaße des Feldes). */
function fitsSize(motif: TimberMotif, bw: number, h: number): boolean {
  const big = bw >= TIMBER_BRACE_MIN.bw && h >= TIMBER_BRACE_MIN.h;
  switch (motif) {
    case 'rhombus': return big && bw % 2 === 1 && h % 2 === 1;
    case 'cross': return big;
    case 'k': return big;
    case 'brace': return big;
    case 'feet': return big;
    case 'rail': return h >= 3;
    case 'none': return true;
  }
}

/**
 * W4 (27.09.2026, Review S5 „Schachbrett“): Gefach-Einzelzelle – eine Füllzelle, deren vier Nachbarn im Feld alle Holz
 * sind (Rand des Feldes = Ständer, Schwelle, Rähm). Kreuz und Raute im 3 × 3-Feld, K im 3 hohen Feld und die Strebe im
 * 2 breiten Feld bestehen fast nur aus solchen Zellen und lesen sich als Hell/Dunkel-Schachbrett statt als Strebe.
 */
export function hasLoneInfill(grid: readonly (readonly TimberPart[])[]): boolean {
  const h = grid.length;
  const at = (x: number, y: number): boolean => grid[y]?.[x] === 'infill';
  for (let y = 0; y < h; y++) {
    const row = grid[y]!;
    for (let x = 0; x < row.length; x++) {
      if (!at(x, y)) continue;
      if (!at(x - 1, y) && !at(x + 1, y) && !at(x, y - 1) && !at(x, y + 1)) return true;
    }
  }
  return false;
}

/**
 * Motiv, das in ein Feld bw × h passt (Ersatzkette Raute → Kreuz → Strebe → leer; K → Strebe). W4 (27.09.2026, S5):
 * Ein Motiv passt nur, wenn jedes Gefachstück mindestens zwei zusammenhängende Zellen hat (`hasLoneInfill`) – sonst
 * gilt der Ersatz, zuletzt das leere Gefach (research/12 §3.3; Vorbilder in plan/spikes/W4G_material2.md §2).
 */
export function fitMotif(motif: TimberMotif, bw: number, h: number): TimberMotif {
  if (motif === 'none') return motif;
  if (fitsSize(motif, bw, h) && !hasLoneInfill(motifGrid(motif, bw, h))) return motif;
  return fitMotif(MOTIF_FALLBACK[motif], bw, h);
}

/**
 * Strebe „/“ ab dem Fuß (0, 0), 8er-zusammenhängend: im breiten Feld bis (bw−1, h−1), je Spalte ein Block; im hohen
 * Feld unter 45° bis an den anderen Ständer (Fußstrebe, darüber Gefach) – ein senkrechter Knick läse sich als Ständer.
 */
function braceCells(bw: number, h: number): Array<readonly [number, number]> {
  if (bw >= h) return Array.from({ length: bw }, (_, x) => [x, Math.round((x * (h - 1)) / (bw - 1))] as const);
  return Array.from({ length: bw }, (_, x) => [x, x] as const);
}

/**
 * Motiv als Raster [y][x] (y = 0 unten) der Feldgröße bw × h, linke Fassadenhälfte („/“); `mirror` spiegelt („\“).
 * Das Motiv muss passen (`fitMotif`).
 */
export function motifGrid(motif: TimberMotif, bw: number, h: number, mirror = false): TimberPart[][] {
  const g: TimberPart[][] = Array.from({ length: h }, () => new Array<TimberPart>(bw).fill('infill'));
  const set = (x: number, y: number, p: TimberPart = 'brace'): void => {
    g[y]![mirror ? bw - 1 - x : x] = p;
  };
  switch (motif) {
    case 'brace':
      for (const [x, y] of braceCells(bw, h)) set(x, y);
      break;
    case 'cross':
      for (const [x, y] of braceCells(bw, h)) {
        set(x, y);
        set(bw - 1 - x, y);
      }
      break;
    case 'k':
      for (let y = 0; y < h; y++) set(Math.min(y, h - 1 - y, bw - 1), y);
      break;
    case 'rhombus': {
      const cx = (bw - 1) / 2;
      const cy = (h - 1) / 2;
      const r = Math.min(cx, cy);
      for (let y = 0; y < h; y++) for (let x = 0; x < bw; x++) if (Math.abs(x - cx) + Math.abs(y - cy) === r) set(x, y);
      break;
    }
    case 'feet':
      set(0, 0);
      set(bw - 1, 0);
      break;
    case 'rail':
      for (let x = 0; x < bw; x++) set(x, Math.floor((h - 1) / 2), 'rail');
      break;
    case 'none':
      break;
  }
  return g;
}

/**
 * Motiv des Feldes k von n: Hash über (Seed, Linie, min(k, n−1−k)) → Spiegelpaare gleich, rechte Hälfte gespiegelt;
 * im Mittelfeld werden gerichtete Motive (Strebe, K) zum Kreuz bzw. leer.
 */
export function pickMotif(motifs: readonly TimberMotif[], seed: number, lineKey: number, k: number, n: number, bw: number, h: number): { readonly motif: TimberMotif; readonly mirror: boolean } {
  const sym = Math.min(k, n - 1 - k);
  const center = k === n - 1 - k;
  let motif = fitMotif(motifs[hashSeed(seed, 'fachwerk', lineKey, sym) % motifs.length]!, bw, h);
  if (center && (motif === 'brace' || motif === 'k')) motif = fitMotif('cross', bw, h) === 'cross' ? 'cross' : 'none';
  return { motif, mirror: k > n - 1 - k };
}

// ---------------------------------------------------------------- Zelle

/**
 * W13-E (28.09.2026, blinder A/B-Test): Ein Giebel mit genau **einem** inneren Ständer (Mitte) kreuzt ihn mit dem
 * Giebelriegel – Ständer und Riegel ergaben ein „+“ bzw. ein lateinisches Kreuz im Giebeldreieck (Projektregel: keine
 * symbolähnlichen Formen). Dann entfällt der Ständer über dem Rähm. Nur mit `upperFrame` (sonst bitgleich).
 */
function lonePost(L: BayLayout, line: WallLine): boolean {
  let n = 0;
  for (let k = 1; k + 1 < L.post.length; k++) if (L.post[k] && !line.pillar[k]) n++;
  return n === 1;
}

/** Bauteil einer Wandzelle im Fachwerk (Pfeiler und Spalten ohne Laufrichtung sind Ständer). */
export function timberPart(t: WallTimber, cell: Pick<ShellCell, 'kind'>, ctx: CellContext, seed: number): TimberPart {
  if (cell.kind === 'pillar' || ctx.line === undefined || ctx.along === undefined || ctx.wallAxis === undefined) return 'post';
  const bay = t.bay ?? TIMBER_DEFAULTS.bay;
  const i = ctx.along;
  const r = ctx.hRel;
  if (r >= ctx.H) {
    // Über dem Rähm: Fenster rahmen, Riegel alle GABLE_RAIL Reihen. Giebeldreieck = eigenes Stockwerk mit Ständern im
    // Rhythmus 1 + bay (ohne die Fensterständer darunter); Kniestock und Gaubenfront setzen die Ständer darunter fort.
    if (ctx.openingSide === 'beside') return 'post';
    if (ctx.openingSide !== undefined) return 'rail';
    const G = lineLayout(ctx.line, bay, ctx.line.gable);
    // W13-E: am Wandkleid der Obergeschosse (`upperFrame`) kein einzelner Mittelständer und nur der Sohlriegel am
    // Giebelfuß – weitere Riegel kreuzten einzelne sichtbare Ständer und Fensterwangen zu „+“- bzw. Kreuzformen (blinder
    // A/B-Test; Projektregel: keine Symbolformen). Der Giebel gliedert sich dann nur senkrecht; größere Putzfelder sind
    // der Preis. Ohne `upperFrame` bitgleich wie bisher.
    if (ctx.upperFrame === true) {
      if (G.post[i] && !lonePost(G, ctx.line)) return 'post';
      return r === ctx.H ? 'rail' : 'infill';
    }
    if (G.post[i]) return 'post';
    return (r - ctx.H) % GABLE_RAIL === 0 ? 'rail' : 'infill';
  }
  const L = lineLayout(ctx.line, bay);
  const from = t.sill === true ? 1 : 0;
  if (r < from) return ctx.openingSide === 'beside' ? 'post' : 'rail'; // Schwelle, neben Türen Türständer
  if (L.post[i]) return 'post';
  const k = L.bay[i]!;
  if (L.openBay[k]) return ctx.openingSide === 'below' || ctx.openingSide === 'above' ? 'rail' : 'infill';
  const bw = L.bayW[i]!;
  const h = ctx.H - from;
  const { motif, mirror } = pickMotif(t.motifs ?? TIMBER_DEFAULTS.motifs, seed, ctx.line.key, k, L.nBays, bw, h);
  return motifGrid(motif, bw, h, mirror)[r - from]![L.bayPos[i]!]!;
}

/** Fachwerk-Ausgabe: Holz als Stamm (Ständer senkrecht, Riegel entlang der Wand) bzw. `wood` (Strebe), sonst Gefach. */
export function timberOut(rule: SurfaceRule, t: WallTimber, cell: ShellCell, ctx: CellContext, seed: number): SurfaceOut {
  const wood = t.role ?? TIMBER_DEFAULTS.role;
  const part = timberPart(t, cell, ctx, seed);
  if (part === 'rail' && ctx.wallAxis !== undefined) return { role: wood, shape: 'log', axis: ctx.wallAxis };
  if (part === 'rail' || part === 'post') return { role: wood, shape: 'log', axis: 'y' };
  if (part === 'brace') return { role: wood, shape: 'wood' };
  return { role: rule.role, shape: rule.shape ?? cell.shape };
}
