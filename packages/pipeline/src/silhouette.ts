/**
 * Silhouetten-Kennwert (WS „7 Schritte“, Schritt 2 „Grundform und Silhouette“; Bericht plan/spikes/WS_silhouette.md).
 *
 * Reines Messen aus den Hüllenzellen, ändert nichts: Firsthöhen-Klassen, Traufhöhen-Streuung und Umrisswechsel je
 * Himmelsrichtung ergeben das „Silhouetten-Interesse“ (0 … 1). Der Schalter `silhouette` (`off` | `varied`) selbst
 * lebt im Planer (`@mcda/archetype` `silhouette.ts`); die Pipeline reicht ihn über `BuildingTypeParams` durch.
 * Rein: kein I/O, kein Zufall.
 */

/** Zelle für die Messung: Lage und Art (`ShellCell` reicht). */
export interface SilhouetteCell {
  readonly pos: readonly [number, number, number];
  readonly kind: string;
}

/** Zellarten, die zum Baukörper gehören (Gelände, Pflanzen, Außenprofil, Treppen und Geländer zählen nicht). */
const BODY_KINDS: ReadonlySet<string> = new Set(['wall', 'pillar', 'door', 'lintel', 'window', 'ceiling', 'roof', 'fort']);

export interface SilhouetteMetrics {
  /** Zahl der Gipfel (Firstlinien und Turmdecks, mindestens 3 Zellen): Firste, Turmspitzen. */
  readonly peaks: number;
  /** Zahl der verschiedenen Gipfelhöhen (Firsthöhen-Klassen). */
  readonly distinctPeakHeights: number;
  /** Standardabweichung der Höhe entlang des Grundriss-Umrisses (Traufhöhen-Streuung, Giebel eingerechnet). */
  readonly outlineHeightStd: number;
  /** Umrisswechsel je Ansicht (Nord, Ost, Süd, West): Ecken der Himmelslinie, an denen die Steigung wechselt. */
  readonly cornersPerView: readonly [number, number, number, number];
  /** Mittel der vier Ansichten. */
  readonly meanCorners: number;
  /** Höhenspanne der Himmelslinie (höchster minus niedrigster Punkt des Baukörpers), Mittel der vier Ansichten. */
  readonly skylineRange: number;
  /** Zusammengefasst 0 … 1: Mittel aus Firsthöhen-Klassen, Umrisswechseln und Traufhöhen-Streuung. */
  readonly interest: number;
}

/**
 * Silhouetten-Interesse aus den Zellen der Hülle (und ggf. angedockter Türme als `fort`-Zellen).
 * Höhenfeld H(x, z) = oberste Zelle + 1; Gipfel = Firstlinie oder Plateau ohne höheren Nachbarn. Himmelslinie je
 * Ansicht = Maximum der Höhe entlang der Blickachse; Umrisswechsel = Positionen, an denen sich die Steigung ändert.
 * Der Kennwert ist normiert: 5 verschiedene Gipfelhöhen, 16 Umrisswechsel und 4 Blöcke Streuung ergeben je 1.
 */
export function silhouetteMetrics(cells: Iterable<SilhouetteCell>): SilhouetteMetrics {
  const top = new Map<string, number>();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const c of cells) {
    if (!BODY_KINDS.has(c.kind)) continue;
    const [x, y, z] = c.pos;
    const k = `${x},${z}`;
    top.set(k, Math.max(top.get(k) ?? -Infinity, y + 1));
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  if (top.size === 0) return { peaks: 0, distinctPeakHeights: 0, outlineHeightStd: 0, cornersPerView: [0, 0, 0, 0], meanCorners: 0, skylineRange: 0, interest: 0 };
  const W = x1 - x0 + 1, D = z1 - z0 + 1;
  const H = new Float64Array(W * D); // 0 = kein Baukörper
  for (const [k, h] of top) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    H[(z - z0) * W + (x - x0)] = h;
  }
  const at = (x: number, z: number): number => (x < 0 || z < 0 || x >= W || z >= D ? 0 : H[z * W + x]!);
  // Firste: Höhenläufe (gleiche Höhe entlang x bzw. z) von höchstens 3 Zellen, deren beide Nachbarn tiefer liegen (Satteldach-
  // First, Walm), dazu Plateaus ohne höheren Nachbarn (Turmdeck, Flachdach). Zusammenhängende Firstzellen gleicher Höhe (4er)
  // mit mindestens 3 Zellen sind ein Gipfel – einzelne Zinnen, Schornsteine und Stufen zählen nicht.
  const crest = new Uint8Array(W * D);
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const h = at(x, z);
    if (h === 0) continue;
    for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
      if (at(x - dx, z - dz) === h) continue; // Lauf beginnt hier
      let n = 0;
      while (at(x + dx * n, z + dz * n) === h) n++;
      if (n <= 3 && at(x - dx, z - dz) < h && at(x + dx * n, z + dz * n) < h) for (let i = 0; i < n; i++) crest[(z + dz * i) * W + x + dx * i] = 1;
    }
  }
  const seen = new Uint8Array(W * D);
  const peakHeights: number[] = [];
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const h = at(x, z);
    if (h === 0 || seen[z * W + x]) continue;
    const stack: [number, number][] = [[x, z]];
    seen[z * W + x] = 1;
    let higher = false, count = 0, crestCells = 0;
    while (stack.length > 0) {
      const [cx, cz] = stack.pop()!;
      count++;
      crestCells += crest[cz * W + cx]!;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx, nz = cz + dz;
        const nh = at(nx, nz);
        if (nh > h) higher = true;
        if (nh === h && (dx === 0 || dz === 0) && !seen[nz * W + nx]) { seen[nz * W + nx] = 1; stack.push([nx, nz]); }
      }
    }
    if (count >= 3 && (!higher || crestCells >= 3)) peakHeights.push(h);
  }
  // Umriss: Spalten mit einem freien 4er-Nachbarn
  const rim: number[] = [];
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    if (at(x, z) === 0) continue;
    if (at(x + 1, z) === 0 || at(x - 1, z) === 0 || at(x, z + 1) === 0 || at(x, z - 1) === 0) rim.push(at(x, z));
  }
  const mean = rim.reduce((a, b) => a + b, 0) / rim.length;
  const std = Math.sqrt(rim.reduce((a, b) => a + (b - mean) ** 2, 0) / rim.length);
  // Himmelslinien
  const profile = (along: 'x' | 'z'): number[] => {
    const n = along === 'x' ? W : D;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = 0; j < (along === 'x' ? D : W); j++) m = Math.max(m, along === 'x' ? at(i, j) : at(j, i));
      out.push(m);
    }
    return out;
  };
  const corners = (p: number[]): number => {
    let c = 0;
    for (let i = 1; i < p.length - 1; i++) if (p[i + 1]! - p[i]! !== p[i]! - p[i - 1]!) c++;
    return c;
  };
  const range = (p: number[]): number => Math.max(...p) - Math.min(...p.filter((h) => h > 0));
  const px = profile('x'); // Ansicht von Nord/Süd: Linie über x
  const pz = profile('z'); // Ansicht von Ost/West: Linie über z
  const cornersPerView: [number, number, number, number] = [corners(px), corners(pz), corners(px), corners(pz)];
  const meanCorners = cornersPerView.reduce((a, b) => a + b, 0) / 4;
  const skylineRange = (range(px) + range(pz)) / 2;
  const distinct = new Set(peakHeights).size;
  const interest = (Math.min(1, distinct / 5) + Math.min(1, meanCorners / 16) + Math.min(1, std / 4)) / 3;
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  return {
    peaks: peakHeights.length, distinctPeakHeights: distinct, outlineHeightStd: r2(std), cornersPerView, meanCorners: r2(meanCorners),
    skylineRange: r2(skylineRange), interest: r2(interest),
  };
}
