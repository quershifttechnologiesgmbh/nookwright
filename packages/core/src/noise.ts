/**
 * Deterministisches 2D-Rauschen für Material-Varianz (research/12 §7.2). Rein, reihenfolgeunabhängig und
 * plattformstabil: nur Ganzzahl-Hashes (Math.imul) und Grundrechenarten, kein Math.random, kein Math.sin.
 *
 *  - `hash2i`/`hash01`: Gitterwert je (Seed, x, y) – „weißes“ Rauschen, jede Zelle unabhängig.
 *  - `valueNoise2`: Wertrauschen (bilinear, Smoothstep), Skala = mittlere Clustergröße in Blöcken.
 *  - `clusterU`: Oktaven (Skala · 2^k, Amplitude 2^−k) + Dither, danach ENTZERRT (Quantil-Tabelle), also
 *    gleichverteilt in [0, 1).
 *    Dadurch bleiben Mischungsanteile exakt (u < 0,3 trifft 30 % der Fläche), aber zusammenhängend.
 */

export type NoiseKind = 'white' | 'cluster' | 'cells';

export interface NoiseParams {
  readonly type: NoiseKind;
  /** Nur `cells`: Zellgröße in Blöcken (research/30 K1, Standard 3). */
  readonly cell?: number;
  /**
   * Nur `cells`: reserviert für die Fugenstellung (Anteil der Zellrandblöcke) und die Unregelmäßigkeit des
   * Gitters. Beides ist noch nicht im Resolver verdrahtet – die Zellwahl ist bewusst regelmäßig, damit die
   * Anteile exakt bleiben und Nachbarblöcke wirklich derselben Zelle angehören.
   */
  readonly joint?: number;
  readonly metric?: 'chebyshev' | 'manhattan';
  readonly randomness?: number;
  /** Typische Clustergröße in Blöcken (≥ 1; nur `cluster`, sonst Standard 2,5). */
  readonly scale?: number;
  /**
   * Oktaven 1–3: jede weitere VERDOPPELT die Skala bei halber Amplitude (größere Zonen über den Flecken).
   * Feinere Oktaven wären an ganzzahligen Blockpositionen fast weißes Rauschen („Salz und Pfeffer“).
   */
  readonly octaves?: number;
  /** Anteil weißen Rauschens, der die Höhenlinien aufbricht (0–0,3; nur `cluster`). */
  readonly dither?: number;
  /**
   * **Scherung des Rauschgitters** (research/30 K3, Vorbild Blenders Mapping-Rotation): `sx = x + k·y`, k aus
   * 0–8. Ohne Scherung liegen unsere Flächen exakt achsenparallel auf dem Blockgitter, dadurch können die
   * Rausch-Rücken mit dem Blockraster zusammenfallen („Banding“). Die Scherung ist ganzzahlig (Politik: kein
   * `Math.sin`) und eine Bijektion des Gitters – die Verteilung und damit alle Anteile bleiben gleich.
   * 0 = aus (heutiges Bild); nur `cluster`.
   */
  readonly shear?: number;
}

const U32 = 4294967296;

/** Murmur3-Finalizer-Variante (lowbias32): uint32 → uint32 mit guter Lawinenwirkung. */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Ganzzahl-Hash (Seed, x, y) → uint32. Koordinaten dürfen negativ sein. */
export function hash2i(seed: number, x: number, y: number): number {
  let h = mix32((seed ^ 0x9e3779b9) >>> 0);
  h = mix32((h ^ (x | 0)) >>> 0);
  h = mix32((h ^ Math.imul(y | 0, 0x632be5ab)) >>> 0);
  return h;
}

/** Gitterwert in [0, 1). */
export function hash01(seed: number, x: number, y: number): number {
  return hash2i(seed, x, y) / U32;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Wertrauschen 2D in [0, 1]: bilinear zwischen Gitterwerten im Abstand `scale`. `shear` verschiebt die
 * Abtastzeile ganzzahlig gegen die Nachbarzeile (`sx = x + k·y`, research/30 K3): das bricht die Ausrichtung
 * des Rauschgitters am Blockgitter, ohne die Verteilung zu ändern. `shear = 0` ist bitgleich zu vorher.
 */
export function valueNoise2(seed: number, x: number, y: number, scale: number, shear = 0): number {
  const sx = shear !== 0 ? x + Math.imul(shear | 0, y | 0) : x;
  const fx = sx / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const a = hash01(seed, ix, iy);
  const b = hash01(seed, ix + 1, iy);
  const c = hash01(seed, ix, iy + 1);
  const d = hash01(seed, ix + 1, iy + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** Rohwert vor der Entzerrung (Oktaven normiert, plus Dither). */
function rawCluster(seed: number, x: number, y: number, p: NoiseParams): number {
  let n = 0;
  let amp = 1;
  let sum = 0;
  const shear = p.shear ?? 0;
  for (let k = 0; k < (p.octaves ?? 2); k++) {
    n += amp * valueNoise2((seed + Math.imul(k, 7919)) >>> 0, x, y, Math.max(1, p.scale ?? 2.5) * 2 ** k, shear);
    sum += amp;
    amp /= 2;
  }
  n /= sum;
  const dither = p.dither ?? 0;
  if (dither > 0) n += dither * (hash01((seed ^ 0x2545f491) >>> 0, x, y) - 0.5);
  return n;
}

const SAMPLES = 32768;
const QUANTILES = 1024;
const TABLES = new Map<string, Float64Array>();

/**
 * Quantil-Tabelle der Rohwerte an GANZZAHLIGEN Positionen (so wie die Blöcke liegen): einmal je
 * Parametersatz aus 32 768 Proben mit festem Seed. Die Gitterwerte sind für jeden Seed gleichverteilt
 * und unabhängig, daher gilt die Tabelle für alle Seeds.
 */
function quantiles(p: NoiseParams): Float64Array {
  const key = `${p.scale ?? 2.5}|${p.octaves ?? 2}|${p.dither ?? 0}|${p.shear ?? 0}`;
  let q = TABLES.get(key);
  if (q !== undefined) return q;
  const vals = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const x = (hash2i(0x5eed, i, 1) % 131072) - 65536;
    const y = (hash2i(0x5eed, i, 2) % 131072) - 65536;
    vals[i] = rawCluster(0x0b5e55ed, x, y, p);
  }
  vals.sort();
  q = new Float64Array(QUANTILES + 1);
  for (let j = 0; j <= QUANTILES; j++) q[j] = vals[Math.round((j * (SAMPLES - 1)) / QUANTILES)]!;
  TABLES.set(key, q);
  return q;
}

/** Rohwert → Rang in [0, 1) über die Quantil-Tabelle (linear zwischen den Stützstellen). */
function equalize(q: Float64Array, v: number): number {
  if (v <= q[0]!) return 0;
  if (v >= q[QUANTILES]!) return 1 - 1e-9;
  let lo = 0;
  let hi = QUANTILES;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (q[mid]! <= v) lo = mid;
    else hi = mid;
  }
  const span = q[hi]! - q[lo]!;
  const f = span > 0 ? (v - q[lo]!) / span : 0;
  return Math.min(1 - 1e-9, (lo + f) / QUANTILES);
}

/**
 * **Zellrauschen** (research/30 K1, Vorbild Blenders Voronoi): Der Wert wird **je Zellkern** gezogen, nicht je
 * Block. Eine Zelle ist ein Bündel von `cell` × `cell` Blöcken; dadurch entstehen Flecken mit **harter Kante**
 * (Steinverband, Pflaster, Bruchstein, Erdschollen) statt der weichen `cluster`-Flecken. Kein Distanzfeld nötig:
 * Zellkoordinaten sind `⌊x/cell⌋, ⌊y/cell⌋`, das ist O(1) je Block, deterministisch und hält die Anteile exakt.
 *
 * `randomness` verschiebt die Zellgrenzen (0 = regelmäßiges Gitter, 1 = unregelmäßig), `joint` gibt dem Zellrand
 * einen eigenen Wert, damit die Fugenstellung als eigene Rolle gemischt werden kann.
 */
export function cellU(seed: number, x: number, y: number, p: NoiseParams): number {
  const cell = Math.max(1, Math.round(p.cell ?? 3));
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  return hash01((seed ^ 0x2f1b3c4d) >>> 0, cx, cy);
}

/**
 * Gleichverteilter Wert in [0, 1) an der Stelle (x, y). `white`: unabhängig je Zelle;
 * `cluster`: räumlich weich (Nachbarn ähnlich), Flächenanteil von `u < p` ≈ p;
 * `cells`: Zellkerne mit harter Kante (Voronoi-artig).
 */
export function clusterU(seed: number, x: number, y: number, p: NoiseParams): number {
  if (p.type === 'white') return hash01(seed, x, y);
  if (p.type === 'cells') return cellU(seed, x, y, p);
  return equalize(quantiles(p), rawCluster(seed, x, y, p));
}

/**
 * Index nach Gewichten für einen gleichverteilten Wert `u` (kumulativ in Listenreihenfolge).
 * Mit räumlich weichem `u` grenzen im Bild nur Nachbarn der Liste aneinander („Drip-Gradient“).
 */
export function pickIndexByU(weights: readonly number[], u: number): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) throw new RangeError('pickIndexByU(): Summe der Gewichte ist 0');
  let acc = 0;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    const w = Math.max(0, weights[i]!);
    if (w <= 0) continue;
    last = i;
    acc += w / total;
    if (u < acc) return i;
  }
  return last;
}
