/**
 * Vegetation: Poisson-Disk-Streuung (Dart-Throwing in gemischter Reihenfolge, deterministisch) und prozedurale
 * Bäume (Eiche, Birke, Fichte). Liefert nur Positionen + Rollen; das Setzen (Belegung, Stütze) macht der Generator.
 */
import { Rng, type Vec3 } from '@mcda/core';
import type { TreeSpecies } from './style.js';

/**
 * Streuungsregeln (research/30 K6, Vorbild Blender `Density` / `Distance Min` / `Threshold`):
 *  - `threshold` + `min`: **harte** Vorprüfung (Wert an der Stelle ≥ `min`) – läuft VOR `accept`, verbraucht
 *    also keine Zufallszahl; ein hoher Wert macht die Fläche gezielt dünner statt zufällig dünn.
 *  - `keepFree`: **garantiert freie** Stellen (Wege, Türvorfelder) – ebenfalls ohne Zufallszug.
 *  - `accept`: die weiche Dichte (würfelt) – wie bisher.
 *  Die Mindestabstände prüft die Funktion selbst (Buckets unten).
 */
export interface PoissonOptions {
  /** Wert an der Stelle (z. B. Feuchte, Licht, Zonengewicht). */
  readonly threshold?: (x: number, z: number) => number;
  /** Schwelle dazu; `0` (Standard) heißt: keine Wirkung. */
  readonly min?: number;
  /** `true` = Stelle bleibt frei (Weg, Türvorfeld); Standard: nichts bleibt frei. */
  readonly keepFree?: (x: number, z: number) => boolean;
}

/**
 * Poisson-Disk auf ganzzahligen Zellen: Kandidaten in zufälliger (Seed-)Reihenfolge, angenommen wird, was
 * mindestens `r` (euklidisch) von allen bisher Angenommenen entfernt ist und `accept` besteht.
 * `taken` = schon vorhandene Punkte, die ebenfalls Abstand verlangen.
 * Ohne `options` ist das Verhalten **bitgleich** zu vorher (keine zusätzliche Zufallszahl).
 */
export function poissonDisk(
  candidates: readonly (readonly [number, number])[],
  r: number,
  rng: Rng,
  accept: (x: number, z: number) => boolean = () => true,
  taken: readonly (readonly [number, number])[] = [],
  options: PoissonOptions = {},
): Array<readonly [number, number]> {
  const cs = Math.max(1, r);
  const buckets = new Map<string, Array<readonly [number, number]>>();
  const key = (bx: number, bz: number): string => `${bx},${bz}`;
  const add = (p: readonly [number, number]): void => {
    const k = key(Math.floor(p[0] / cs), Math.floor(p[1] / cs));
    const list = buckets.get(k);
    if (list === undefined) buckets.set(k, [p]);
    else list.push(p);
  };
  const free = (x: number, z: number): boolean => {
    const bx = Math.floor(x / cs);
    const bz = Math.floor(z / cs);
    for (let i = bx - 1; i <= bx + 1; i++) {
      for (let j = bz - 1; j <= bz + 1; j++) {
        for (const [px, pz] of buckets.get(key(i, j)) ?? []) {
          const dx = px - x;
          const dz = pz - z;
          if (dx * dx + dz * dz < r * r) return false;
        }
      }
    }
    return true;
  };
  taken.forEach(add);
  const out: Array<readonly [number, number]> = [];
  const min = options.min ?? 0;
  const thr = options.threshold;
  const keepFree = options.keepFree;
  for (const [x, z] of rng.shuffle(candidates)) {
    if (!free(x, z)) continue;
    // Harte Regeln zuerst (kein Zufallszug), dann die weiche Dichte
    if (keepFree !== undefined && keepFree(x, z)) continue;
    if (thr !== undefined && min > 0 && thr(x, z) < min) continue;
    if (!accept(x, z)) continue;
    add([x, z]);
    out.push([x, z]);
  }
  return out;
}

/** 4er-Nachbarn der Fleckenform. */
const N4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Cluster-Streuung (Q3, research/51 §4 V-C1): Poisson-Zentren mit Mindestabstand `spacing`, dann ein Cluster mit
 * **dichtem Kern** und **ausgedünntem Rand**. Der Rand wächst per Zufall über die Nachbarzellen (Fleckenform statt
 * Kreis), die Dichte fällt mit dem Abstand: Radius ≤ `coreRadius` mit `core`, darüber mit `edge`.
 *
 * Nur Zellen aus `cells` (die Kandidatenliste) werden belegt; jede Zelle höchstens einmal. Deterministisch aus
 * `rng`. Liefert die belegten Zellen mit dem Zentrum, aus dem sie stammen (für die Art-Wahl je Fleck).
 */
export function clusterSpots(
  cells: readonly (readonly [number, number])[],
  spacing: number,
  rng: Rng,
  options: { readonly radius: readonly [number, number]; readonly core: number; readonly edge: number; readonly coreRadius?: number },
  accept: (x: number, z: number) => boolean = () => true,
  taken: readonly (readonly [number, number])[] = [],
  poisson: PoissonOptions = {},
): Array<{ readonly x: number; readonly z: number; readonly centerX: number; readonly centerZ: number }> {
  const valid = new Set(cells.map(([x, z]) => `${x},${z}`));
  const used = new Set<string>(taken.map(([x, z]) => `${x},${z}`));
  const centers = poissonDisk(cells, spacing, rng, accept, taken, poisson);
  const coreR = options.coreRadius ?? 1;
  const out: Array<{ x: number; z: number; centerX: number; centerZ: number }> = [];
  for (const [cx, cz] of centers) {
    const r = rng.int(options.radius[0], options.radius[1]);
    const add = (x: number, z: number): void => {
      const k = `${x},${z}`;
      if (!valid.has(k) || used.has(k)) return;
      const d = Math.max(Math.abs(x - cx), Math.abs(z - cz));
      if (rng.chance(d <= coreR ? options.core : options.edge)) {
        used.add(k);
        out.push({ x, z, centerX: cx, centerZ: cz });
      }
    };
    add(cx, cz);
    // Fleckenform: ab dem Kern wächst der Rand zufällig in die Nachbarzellen (kein harter Kreis).
    let frontier: Array<readonly [number, number]> = [[cx, cz]];
    for (let d = 1; d <= r; d++) {
      const next: Array<readonly [number, number]> = [];
      for (const [x, z] of frontier) {
        for (const [dx, dz] of N4) {
          const nx = x + dx;
          const nz = z + dz;
          const k = `${nx},${nz}`;
          if (!valid.has(k) || used.has(k) || next.some(([a, b]) => a === nx && b === nz)) continue;
          add(nx, nz);
          if (used.has(k)) next.push([nx, nz]);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
  }
  return out;
}

export interface TreeBlock {
  readonly pos: Vec3;
  readonly part: 'log' | 'leaves';
}
export interface TreeShape {
  readonly species: TreeSpecies;
  readonly trunkHeight: number;
  /** Stamm zuerst (von unten), dann Laub. */
  readonly blocks: readonly TreeBlock[];
  /** Größter Kronenradius (Chebyshev) um den Stamm. */
  readonly radius: number;
}

/**
 * Prozeduraler Baum auf der Geländezelle `ground` (Stamm beginnt darüber). Eiche/Birke: zwei Lagen Radius 2
 * mit zufällig fehlenden Ecken, eine Lage Radius 1, Kreuz oben (wie Vanilla). Fichte: Kegel aus Rauten, die
 * nach unten zwischen Radius 1 und 2 wechseln, Spitze aus einem Blatt.
 */
export function growTree(species: TreeSpecies, ground: Vec3, rng: Rng): TreeShape {
  const [x0, y0, z0] = ground;
  const blocks: TreeBlock[] = [];
  const logs = new Set<string>();
  const put = (x: number, y: number, z: number, part: TreeBlock['part']): void => {
    const k = `${x},${y},${z}`;
    if (part === 'leaves' && logs.has(k)) return;
    if (part === 'log') logs.add(k);
    blocks.push({ pos: [x, y, z], part });
  };
  const H = species === 'spruce' ? rng.int(6, 8) : species === 'birch' ? rng.int(5, 6) : rng.int(4, 5);
  for (let y = 1; y <= H; y++) put(x0, y0 + y, z0, 'log');
  if (species === 'spruce') {
    const top = y0 + H + 1;
    put(x0, top, z0, 'leaves');
    const radii = [1, 1, 2, 1, 2, 1, 2];
    for (let k = 0; k < radii.length; k++) {
      const y = top - 1 - k;
      if (y < y0 + 3) break;
      const r = radii[k]!;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > r) continue;
          if (r === 2 && Math.abs(dx) + Math.abs(dz) === 2 && dx !== 0 && dz !== 0 && rng.chance(0.3)) continue;
          put(x0 + dx, y, z0 + dz, 'leaves');
        }
      }
    }
    return { species, trunkHeight: H, blocks, radius: 2 };
  }
  // Eiche / Birke
  const layers: ReadonlyArray<readonly [dy: number, r: number]> = [[H - 1, 2], [H, 2], [H + 1, 1], [H + 2, 0]];
  for (const [dy, r] of layers) {
    const y = y0 + dy;
    if (r === 0) {
      put(x0, y, z0, 'leaves');
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) put(x0 + dx, y, z0 + dz, 'leaves');
      continue;
    }
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (dy >= H || rng.chance(0.5))) continue;
        put(x0 + dx, y, z0 + dz, 'leaves');
      }
    }
  }
  return { species, trunkHeight: H, blocks, radius: 2 };
}

/** Busch aus 1–4 Zellen: Keim + zufällige 4er-Nachbarn (L-Formen), die `ok` bestehen. */
export function bushCells(x: number, z: number, rng: Rng, size: number, ok: (x: number, z: number) => boolean): Array<readonly [number, number]> {
  const cells: Array<readonly [number, number]> = [[x, z]];
  const dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]] as const);
  for (const [dx, dz] of dirs) {
    if (cells.length >= size) break;
    const base = cells[cells.length - 1]!;
    const nx = base[0] + dx;
    const nz = base[1] + dz;
    if (cells.some(([cx, cz]) => cx === nx && cz === nz) || !ok(nx, nz)) continue;
    cells.push([nx, nz]);
  }
  return cells;
}

/**
 * Obstbaum (research/18 V4, Obstgarten/Spalier): kurzer Stamm (3), runde Krone mit Radius 1–2 aus Obst-Laub
 * (blühende Azalee). Deterministisch aus `rng`; Stamm zuerst.
 */
export function growFruitTree(ground: Vec3, rng: Rng): TreeShape {
  const [x0, y0, z0] = ground;
  const H = 3; // Krone ab 3 über dem Boden: darunter bleibt Kopffreiheit zum Durchgehen
  const blocks: TreeBlock[] = [];
  for (let y = 1; y <= H; y++) blocks.push({ pos: [x0, y0 + y, z0], part: 'log' });
  const layers: ReadonlyArray<readonly [dy: number, r: number]> = [[H, 1], [H + 1, 2], [H + 2, 1]];
  for (const [dy, r] of layers) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0 && dy === H) continue;
        if (r === 2 && Math.abs(dx) + Math.abs(dz) > 2 + (rng.chance(0.3) ? 1 : 0)) continue;
        if (r === 1 && dy === H + 2 && Math.abs(dx) + Math.abs(dz) === 2 && rng.chance(0.5)) continue;
        blocks.push({ pos: [x0 + dx, y0 + dy, z0 + dz], part: 'leaves' });
      }
    }
  }
  return { species: 'oak', trunkHeight: H, blocks, radius: 2 };
}
