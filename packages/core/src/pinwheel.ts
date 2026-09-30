/**
 * Wächter gegen Windrad- und hakenkreuzähnliche Motive (HANDOFF §1, feat/tiled-wfc). Ein Motiv ist verdächtig, wenn
 * ein quadratisches Fenster um 90° gedreht gleich bleibt, aber an **keiner** der vier Spiegelachsen (waagerecht,
 * senkrecht, zwei Diagonalen) – also eine 4-zählige Figur mit Drehsinn („chiral C4“). Genau diese Klasse enthält
 * Windrad und „Plus mit Haken“; jedes spiegelsymmetrische Muster (Kreuz, Ring, Raute, Schachbrett) fällt nicht darunter.
 *
 * Geprüft werden Fenster der Kantenlänge 3 … 15 um jede Zelle (ungerade Größen) und um jeden Gitterpunkt (gerade
 * Größen), damit auch Figuren mit Drehpunkt zwischen vier Zellen auffallen. Zellen außerhalb zählen als eigene Marke.
 * Einfarbige Fenster sind nie verdächtig. W8-G (2026-09-27): Standard bis 15 (Review F_tiled_wfc: 11 × 11 übersehen).
 *
 * `findPinwheels`/`findPinwheelFigures` prüfen Marken **exakt**. Für die fertige Welt – Materialmischungen, Störblöcke,
 * Figuren aus zwei Materialien, fast-Hakenkreuze, große Figuren – gibt es unten den toleranten Masken-Detektor
 * `findChiralFigures` / `scanLabelGrid` (W8-G); der Wächter der Materialisierung (`guardPinwheels`) nutzt ihn.
 */

export interface PinwheelHit {
  /** Linke obere Ecke des Fensters. */
  readonly x: number;
  readonly z: number;
  readonly size: number;
}

/**
 * Sucht chirale 4-zählige Fenster. `label(x, z)` liefert eine Marke (Material, Höhe …) oder `undefined` (außerhalb).
 * `bounds` = kleinstes Rechteck, das alle Marken enthält (inklusive).
 */
export function findPinwheels(
  label: (x: number, z: number) => number | undefined,
  bounds: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number },
  sizes: readonly number[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
): PinwheelHit[] {
  const hits: PinwheelHit[] = [];
  const OUT = -1;
  const pad = Math.max(0, ...sizes);
  // dichtes Raster mit Rand `pad` (außerhalb = OUT), damit Fenster ohne Rückruf gelesen werden
  const w = bounds.maxX - bounds.minX + 1 + 2 * pad;
  const d = bounds.maxZ - bounds.minZ + 1 + 2 * pad;
  const grid = new Int32Array(w * d).fill(OUT);
  const inside = new Uint8Array(w * d);
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const l = label(x, z);
      if (l === undefined) continue;
      const i = (z - bounds.minZ + pad) * w + (x - bounds.minX + pad);
      grid[i] = l === OUT ? OUT - 1 : l;
      inside[i] = 1;
    }
  }
  for (const k of sizes) {
    const win = new Int32Array(k * k);
    const m = k - 1;
    for (let v0 = pad - k + 1; v0 < d - pad; v0++) {
      for (let u0 = pad - k + 1; u0 < w - pad; u0++) {
        const at = (u: number, v: number): number => grid[(v0 + v) * w + u0 + u]!;
        // schneller Ausschluss: 4-zählig heißt gleiche Ecken und gleiche Randmitten
        const c = at(0, 0);
        if (at(m, 0) !== c || at(m, m) !== c || at(0, m) !== c) continue;
        if (at(1, 0) !== at(m, 1) || at(1, 0) !== at(m - 1, m) || at(1, 0) !== at(0, m - 1)) continue;
        let first: number | undefined;
        let mixed = false;
        let count = 0;
        for (let v = 0; v < k; v++) {
          for (let u = 0; u < k; u++) {
            const l = at(u, v);
            win[v * k + u] = l;
            if (inside[(v0 + v) * w + u0 + u] === 1) count++;
            if (first === undefined) first = l;
            else if (l !== first) mixed = true;
          }
        }
        if (!mixed || count < 4) continue;
        if (isChiralC4(win, k)) hits.push({ x: bounds.minX + u0 - pad, z: bounds.minZ + v0 - pad, size: k });
      }
    }
  }
  return hits;
}

/** Fenster (k × k, zeilenweise) um 90° drehsymmetrisch und an keiner Achse spiegelsymmetrisch? */
export function isChiralC4(win: ArrayLike<number>, k: number): boolean {
  const at = (u: number, v: number): number => win[v * k + u]!;
  const same = (f: (u: number, v: number) => number): boolean => {
    for (let v = 0; v < k; v++) for (let u = 0; u < k; u++) if (at(u, v) !== f(u, v)) return false;
    return true;
  };
  const m = k - 1;
  if (!same((u, v) => at(v, m - u))) return false; // nicht 4-zählig
  if (same((u, v) => at(m - u, v))) return false; // senkrechte Achse
  if (same((u, v) => at(u, m - v))) return false; // waagerechte Achse
  if (same((u, v) => at(v, u))) return false; // Hauptdiagonale
  if (same((u, v) => at(m - v, m - u))) return false; // Nebendiagonale
  return true;
}

/**
 * Figuren-Variante (Review F, A1): jede 4er-zusammenhängende Figur einer Marke bzw. einer Markengruppe (`groups`, z. B.
 * „alle Steine“) wird **allein** in ihrem Hüllquadrat geprüft – Fremdblöcke im Hüllrechteck und beliebige Größen stören
 * nicht. Figuren unter `minCells` Zellen zählen nicht. Treffer = linke obere Ecke und Kantenlänge des Hüllquadrats.
 */
export function findPinwheelFigures(
  label: (x: number, z: number) => number | undefined,
  bounds: { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number },
  groups: ReadonlyArray<readonly number[]> = [],
  minCells = 5,
): PinwheelHit[] {
  const w = bounds.maxX - bounds.minX + 1;
  const d = bounds.maxZ - bounds.minZ + 1;
  const lab = new Array<number | undefined>(w * d);
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) lab[z * w + x] = label(bounds.minX + x, bounds.minZ + z);
  const masks: ((l: number | undefined) => boolean)[] = [...new Set(lab.filter((l): l is number => l !== undefined))].map((v) => (l) => l === v);
  for (const g of groups) {
    const set = new Set(g);
    masks.push((l) => l !== undefined && set.has(l));
  }
  const hits: PinwheelHit[] = [];
  for (const inMask of masks) {
    const seen = new Uint8Array(w * d);
    for (let s = 0; s < w * d; s++) {
      if (seen[s] === 1 || !inMask(lab[s])) continue;
      const comp: number[] = [];
      const stack = [s];
      seen[s] = 1;
      while (stack.length > 0) {
        const c = stack.pop()!;
        comp.push(c);
        const cx = c % w;
        const cz = Math.floor(c / w);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
          const j = nz * w + nx;
          if (seen[j] === 0 && inMask(lab[j])) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
      if (comp.length < minCells) continue;
      const xs = comp.map((c) => c % w);
      const zs = comp.map((c) => Math.floor(c / w));
      const x0 = Math.min(...xs);
      const z0 = Math.min(...zs);
      const k = Math.max(Math.max(...xs) - x0, Math.max(...zs) - z0) + 1;
      if (Math.max(...xs) - x0 !== Math.max(...zs) - z0) continue; // 4-zählig heißt quadratische Hülle
      const win = new Int32Array(k * k);
      for (const c of comp) win[(Math.floor(c / w) - z0) * k + (c % w) - x0] = 1;
      if (isChiralC4(win, k)) hits.push({ x: bounds.minX + x0, z: bounds.minZ + z0, size: k });
    }
  }
  return hits;
}

// ------------------------------------------------------------------------------------------------ W8-G Masken-Detektor

/**
 * Sichtbarkeitsschwelle des Masken-Detektors (W8-G, begründet in plan/spikes/W8G_windrad_waechter.md):
 *  - eine Figur besteht aus Blöcken **einer** Klasse (Maske: genauer Block, grobe Sichtklasse oder „Figur vor Boden“);
 *  - **Arme hängen zusammen:** 8er-Komponenten der Maske mit weniger als `minArm` (3) Blöcken sind Streu (einzelne
 *    Blumen, Blockpaare einer Zufallsmischung) und zählen nicht – vier verstreute Einzelblöcke sind kein Motiv;
 *  - mindestens `minCells` (8) Blöcke – das kleinste echte Windrad (Tetromino-Windrad 4 × 4) hat genau 8;
 *  - **tolerant** (ab 16 Blöcken; kleinere Figuren müssen exakt 4-zählig sein): um 90° gedreht höchstens 2
 *    abweichende Zellen (= 1 Stör- oder Fehlblock), aber an jeder der vier
 *    Spiegelachsen mindestens 6 (eine exakt chirale C4-Figur weicht an jeder Achse um ≥ 8 ab, eine spiegelsymmetrische
 *    Figur mit einem Störblock um ≤ 2 – dazwischen liegt eine klare Lücke).
 * Geprüft werden Fenster `minSize` … `maxSize` (4 … 15; 3 × 3 kann nicht chiral sein) und jede Komponente bis
 * `maxComponent` für größere Figuren (skaliert, diagonal gedreht).
 */
export interface FigureOptions {
  readonly minSize?: number;
  readonly maxSize?: number;
  readonly minCells?: number;
  readonly minArm?: number;
  readonly maxComponent?: number;
}

export interface FigureHit {
  /** Linke obere Ecke des (quadratischen) Prüffensters in Rasterkoordinaten. */
  readonly x: number;
  readonly z: number;
  readonly size: number;
  readonly via: 'window' | 'component';
  /** Abweichende Zellen bei 90°-Drehung (0 = exakt 4-zählig, ≤ 2 = ein Störblock). */
  readonly rotDiff: number;
  /** Kleinste Abweichung an einer Spiegelachse (≥ 6 = eindeutig mit Drehsinn). */
  readonly mirrorDiff: number;
  /** Blöcke der Figur (Rasterkoordinaten). */
  readonly cells: ReadonlyArray<readonly [number, number]>;
}

export interface LabelFigureHit extends FigureHit {
  readonly label: number;
}

const ROT_TOLERANCE = 2;
const MIRROR_MIN = 6;
/** Toleranz erst ab 16 Blöcken: bei kleineren Figuren ist 1 Störblock schon ein Achtel – das ist ein Klecks, kein Motiv. */
const TOLERANT_FROM = 16;
/** Höchstens so viele Randzellen einer Fenster-Figur dürfen außerhalb weiterlaufen (Wege an den Armen). */
const MAX_OUTFLOW = 4;

/**
 * Chirale 4-zählige Figuren in einer Binärmaske (`mask[z * w + x]` ≠ 0 = Block der Klasse). Rein, deterministisch,
 * Reihenfolge: Fenstergröße, dann Zeile, dann Spalte; danach Komponenten in Scan-Reihenfolge.
 */
export function findChiralFigures(mask: ArrayLike<number>, w: number, d: number, options: FigureOptions = {}): FigureHit[] {
  const minSize = Math.max(4, options.minSize ?? 4);
  const maxSize = options.maxSize ?? 15;
  const minCells = options.minCells ?? 8;
  const minArm = options.minArm ?? 3;
  const maxComponent = options.maxComponent ?? 63;
  const n = w * d;
  const hits: FigureHit[] = [];
  if (n === 0) return hits;
  // 1. 8er-Komponenten, Streu (< minArm) entfernen
  const comp = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const sizes: number[] = [];
  const box: number[] = []; // je Komponente minX, minZ, maxX, maxZ
  for (let s = 0; s < n; s++) {
    if (!mask[s] || comp[s] !== -1) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    comp[s] = id;
    let x0 = w, z0 = d, x1 = -1, z1 = -1;
    while (head < tail) {
      const i = queue[head++]!;
      const x = i % w;
      const z = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
      for (let dz = -1; dz <= 1; dz++) {
        const nz = z + dz;
        if (nz < 0 || nz >= d) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = nz * w + nx;
          if (!mask[j] || comp[j] !== -1) continue;
          comp[j] = id;
          queue[tail++] = j;
        }
      }
    }
    sizes.push(tail);
    box.push(x0, z0, x1, z1);
  }
  const m = new Uint8Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (comp[i]! >= 0 && sizes[comp[i]!]! >= minArm) {
      m[i] = 1;
      total++;
    }
  }
  if (total < minCells) return hits;

  // Prüfung eines k × k-Fensters; `on(u, v)` liefert 0/1
  const judge = (on: (u: number, v: number) => number, k: number, cells: number): { rot: number; mir: number } | undefined => {
    const mm = k - 1;
    const tolerance = cells >= TOLERANT_FROM ? ROT_TOLERANCE : 0;
    let rot = 0;
    for (let v = 0; v < k; v++) {
      for (let u = 0; u < k; u++) {
        if (on(u, v) !== on(v, mm - u) && ++rot > tolerance) return undefined;
      }
    }
    let a = 0, b = 0, c = 0, e = 0;
    for (let v = 0; v < k; v++) {
      for (let u = 0; u < k; u++) {
        const here = on(u, v);
        if (here !== on(mm - u, v)) a++;
        if (here !== on(u, mm - v)) b++;
        if (here !== on(v, u)) c++;
        if (here !== on(mm - v, mm - u)) e++;
      }
    }
    const mir = Math.min(a, b, c, e);
    return mir >= MIRROR_MIN ? { rot, mir } : undefined;
  };

  // Komponente mit gefüllten Löchern (4er-Flutung von außen) nicht mehr chiral → der Drehsinn kam nur aus den Löchern
  const holesOnly = (on: (u: number, v: number) => number, k: number, cells: number): boolean => {
    const K = k + 2;
    const outside = new Uint8Array(K * K);
    const stack: number[] = [0];
    outside[0] = 1;
    let holes = 0;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const u = (i % K) - 1;
      const v = Math.floor(i / K) - 1;
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nu = u + du;
        const nv = v + dv;
        if (nu < -1 || nv < -1 || nu > k || nv > k) continue;
        const j = (nv + 1) * K + nu + 1;
        if (outside[j] || (nu >= 0 && nv >= 0 && nu < k && nv < k && on(nu, nv))) continue;
        outside[j] = 1;
        stack.push(j);
      }
    }
    for (let v = 0; v < k; v++) for (let u = 0; u < k; u++) if (!on(u, v) && !outside[(v + 1) * K + u + 1]) holes++;
    if (holes === 0) return false;
    const filled = (u: number, v: number): number => (on(u, v) || !outside[(v + 1) * K + u + 1] ? 1 : 0);
    return judge(filled, k, cells + holes) === undefined;
  };

  // 2. Fenster über Summentabelle vorfiltern (Anzahl, Rand belegt, vier Drehviertel gleich voll)
  const W1 = w + 1;
  const S = new Int32Array(W1 * (d + 1));
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) S[(z + 1) * W1 + x + 1] = m[z * w + x]! + S[z * W1 + x + 1]! + S[(z + 1) * W1 + x]! - S[z * W1 + x]!;
  }
  // Ausläufer: Randzellen der Maske (val = 1) bzw. des Rests (val = 0) im Fenster, die außerhalb des Fensters
  // weiterlaufen. Eine freistehende Figur hat keine (höchstens Wege, die an den Armen weiterlaufen), der Grund um sie
  // läuft ringsum weiter. Läuft die Maske stärker aus als der Rest, ist der Rest die Figur (in seiner eigenen Maske) –
  // der Grund um ein figurförmiges Loch meldet sich so nicht als zweite Figur.
  const outflow = (x0: number, z0: number, k: number, val: number): number => {
    let out = 0;
    const x1 = x0 + k - 1;
    const z1 = z0 + k - 1;
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (z !== z0 && z !== z1 && x !== x0 && x !== x1) continue;
        if (m[z * w + x] !== val) continue;
        let leaks = false;
        for (let dz = -1; dz <= 1 && !leaks; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx >= x0 && nx <= x1 && nz >= z0 && nz <= z1) continue;
            if (nx < 0 || nz < 0 || nx >= w || nz >= d || m[nz * w + nx] !== val) continue;
            leaks = true;
            break;
          }
        }
        if (leaks) out++;
      }
    }
    return out;
  };
  const rowCount = (z: number, rd: number): number => S[(z + rd) * W1 + w]! - S[z * W1 + w]!;
  for (let k = minSize; k <= Math.min(maxSize, w, d); k++) {
    const kk = k * k;
    const h = k >> 1;
    const odd = (k & 1) === 1;
    for (let z0 = 0; z0 + k <= d; z0++) {
      // ganzes Band zu leer: kein Fenster darin kann reichen
      if (rowCount(z0, k) < minCells) continue;
      const t = z0 * W1;
      const b = (z0 + k) * W1;
      const ti = (z0 + 1) * W1;
      const bi = (z0 + k - 1) * W1;
      const zh = (z0 + h) * W1;
      const zh1 = (z0 + h + 1) * W1;
      for (let x0 = 0; x0 + k <= w; x0++) {
        const x1 = x0 + k;
        const cnt = S[b + x1]! - S[t + x1]! - S[b + x0]! + S[t + x0]!;
        if (cnt < minCells || cnt === kk) continue;
        // Rand leer: kleineres Fenster gleicher Mitte
        if (cnt === S[bi + x1 - 1]! - S[ti + x1 - 1]! - S[bi + x0 + 1]! + S[ti + x0 + 1]!) continue;
        let q0: number, q1: number, q2: number, q3: number;
        const xh = x0 + h;
        if (odd) {
          q0 = S[zh1 + xh]! - S[t + xh]! - S[zh1 + x0]! + S[t + x0]!; // u 0..h-1, v 0..h
          q1 = S[zh + x1]! - S[t + x1]! - S[zh + xh]! + S[t + xh]!; // u h..2h, v 0..h-1
          q2 = S[b + x1]! - S[zh + x1]! - S[b + xh + 1]! + S[zh + xh + 1]!; // u h+1..2h, v h..2h
          q3 = S[b + xh + 1]! - S[zh1 + xh + 1]! - S[b + x0]! + S[zh1 + x0]!; // u 0..h, v h+1..2h
        } else {
          q0 = S[zh + xh]! - S[t + xh]! - S[zh + x0]! + S[t + x0]!;
          q1 = S[zh + x1]! - S[t + x1]! - S[zh + xh]! + S[t + xh]!;
          q2 = S[b + x1]! - S[zh + x1]! - S[b + xh]! + S[zh + xh]!;
          q3 = S[b + xh]! - S[zh + xh]! - S[b + x0]! + S[zh + x0]!;
        }
        if (Math.max(q0, q1, q2, q3) - Math.min(q0, q1, q2, q3) > 1) continue;
        const r = judge((u, v) => m[(z0 + v) * w + x0 + u]!, k, cnt);
        if (r === undefined) continue;
        const leak = outflow(x0, z0, k, 1);
        if (leak > MAX_OUTFLOW || leak > outflow(x0, z0, k, 0)) continue;
        if (holesOnly((u, v) => m[(z0 + v) * w + x0 + u]!, k, cnt)) continue;
        const cells: Array<readonly [number, number]> = [];
        for (let v = 0; v < k; v++) for (let u = 0; u < k; u++) if (m[(z0 + v) * w + x0 + u]) cells.push([x0 + u, z0 + v]);
        hits.push({ x: x0, z: z0, size: k, via: 'window', rotDiff: r.rot, mirrorDiff: r.mir, cells });
      }
    }
  }

  // 3. Komponenten (auch größer als die Fenster; Fremdblöcke im Hüllrechteck zählen nicht)
  for (let id = 0; id < sizes.length; id++) {
    if (sizes[id]! < Math.max(minArm, minCells)) continue;
    const bx0 = box[4 * id]!, bz0 = box[4 * id + 1]!, bx1 = box[4 * id + 2]!, bz1 = box[4 * id + 3]!;
    const bw = bx1 - bx0 + 1;
    const bd = bz1 - bz0 + 1;
    const k = Math.max(bw, bd);
    if (k < minSize || k > maxComponent || Math.abs(bw - bd) > 1) continue;
    const xs = bw === k ? [bx0] : [bx0 - 1, bx0];
    const zs = bd === k ? [bz0] : [bz0 - 1, bz0];
    let found = false;
    for (const x0 of xs) {
      for (const z0 of zs) {
        if (found) continue;
        const on = (u: number, v: number): number => {
          const x = x0 + u;
          const z = z0 + v;
          return x >= 0 && z >= 0 && x < w && z < d && comp[z * w + x] === id ? 1 : 0;
        };
        const r = judge(on, k, sizes[id]!);
        if (r === undefined) continue;
        // Drehsinn nur aus Löchern (Grund um eine figurförmige Lücke)? Dann ist die Lücke die Figur, nicht der Grund.
        if (holesOnly(on, k, sizes[id]!)) continue;
        found = true;
        const cells: Array<readonly [number, number]> = [];
        for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) if (comp[z * w + x] === id) cells.push([x, z]);
        hits.push({ x: x0, z: z0, size: k, via: 'component', rotDiff: r.rot, mirrorDiff: r.mir, cells });
      }
    }
  }
  return hits;
}

/**
 * Alle Marken eines Rasters (`labels[z * w + x]`, < 0 = leer) einzeln als Maske prüfen – je Marke nur im Hüllrechteck
 * ihrer Zellen. Marken mit weniger als `minCells` Zellen entfallen ohne Prüfung, ebenso Marken, die `only` ablehnt
 * (z. B. weil dieselbe Maske schon unter einer anderen Gruppierung geprüft wurde).
 *
 * Streu anderer Marken (8er-Komponente derselben Marke mit weniger als `minArm` Zellen, ringsum nur von einer Marke
 * umgeben – z. B. eine einzelne Blume im Rasen) zählt für die Maske der umgebenden Marke als **belegt**: Punkte stanzen
 * keine Löcher in den Grund – sonst wäre der Rasen um vier verstreute Blumen in Windrad-Stellung selbst eine „Figur“.
 */
export function scanLabelGrid(
  labels: ArrayLike<number>, w: number, d: number, options: FigureOptions = {}, only?: (label: number, count: number) => boolean,
): LabelFigureHit[] {
  const minCells = options.minCells ?? 8;
  const minArm = options.minArm ?? 3;
  const speck = speckCells(labels, w, d, minArm);
  const stats = new Map<number, { count: number; x0: number; z0: number; x1: number; z1: number }>();
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const l = labels[z * w + x]!;
      if (l < 0) continue;
      const s = stats.get(l);
      if (s === undefined) stats.set(l, { count: 1, x0: x, z0: z, x1: x, z1: z });
      else {
        s.count++;
        if (x < s.x0) s.x0 = x;
        if (x > s.x1) s.x1 = x;
        s.z1 = z;
      }
    }
  }
  const out: LabelFigureHit[] = [];
  for (const [label, s] of [...stats].sort((a, b) => a[0] - b[0])) {
    if (s.count < minCells || (only !== undefined && !only(label, s.count))) continue;
    const cw = s.x1 - s.x0 + 1;
    const cd = s.z1 - s.z0 + 1;
    if (cw < 4 || cd < 4) continue;
    const mask = new Uint8Array(cw * cd);
    for (let z = 0; z < cd; z++) {
      for (let x = 0; x < cw; x++) {
        const i = (z + s.z0) * w + x + s.x0;
        if (labels[i] === label || speck[i] === label) mask[z * cw + x] = 1;
      }
    }
    for (const h of findChiralFigures(mask, cw, cd, options)) {
      out.push({ ...h, label, x: h.x + s.x0, z: h.z + s.z0, cells: h.cells.map(([x, z]) => [x + s.x0, z + s.z0] as const) });
    }
  }
  return out;
}

/**
 * Streu: Zellen, deren 8er-Komponente gleicher Marke kleiner als `minArm` ist und die ringsum (8er-Nachbarn im Raster)
 * nur von **einer** anderen Marke umgeben ist. Ergebnis je Zelle: diese umgebende Marke, sonst -1.
 */
function speckCells(labels: ArrayLike<number>, w: number, d: number, minArm: number): Int32Array {
  const n = w * d;
  const out = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n); // Zelle gehört zu einer vollständig bestimmten Komponente
  const stamp = new Int32Array(n); // Besuchsmarke je Start (s + 1)
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    const l = labels[s]!;
    if (l < 0 || done[s]) continue;
    const mark = s + 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    stamp[s] = mark;
    while (head < tail && tail < minArm) {
      const i = queue[head++]!;
      const x = i % w;
      const z = (i - x) / w;
      for (let dz = -1; dz <= 1; dz++) {
        const nz = z + dz;
        if (nz < 0 || nz >= d) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = nz * w + nx;
          if (stamp[j] === mark || labels[j] !== l) continue;
          stamp[j] = mark;
          queue[tail++] = j;
        }
      }
    }
    if (tail >= minArm) continue; // groß genug: keine Streu
    // vollständig (Komponente < minArm): umgebende Marke bestimmen
    let around = -2;
    for (let q = 0; q < tail; q++) {
      const i = queue[q]!;
      done[i] = 1;
      const x = i % w;
      const z = (i - x) / w;
      for (let dz = -1; dz <= 1; dz++) {
        const nz = z + dz;
        if (nz < 0 || nz >= d) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const lj = labels[nz * w + nx]!;
          if (lj === l) continue;
          if (around === -2) around = lj;
          else if (around !== lj) around = -3;
        }
      }
    }
    if (around >= 0) for (let q = 0; q < tail; q++) out[queue[q]!] = around;
  }
  return out;
}
