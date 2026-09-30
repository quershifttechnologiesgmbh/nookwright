/**
 * Geländeform (feat/gelaende, Bericht plan/spikes/GEL_gelaende.md): das Grundstück als Landschaft statt als flache
 * Grasplatte. Additive Option `landform` des Gelände-Generators; ohne Angabe bzw. mit 'flat' bleibt jedes Ergebnis
 * bitgleich. Rein und deterministisch (nur Seeds, kein I/O).
 *
 * Bausteine (alle hier, `generate.ts` ruft nur auf):
 *  - `landformRelief`: kräftigeres Relief außerhalb des Planierrings (Hügel, Mulden).
 *  - `hillside`: Hang hinter dem Haus – das Gebäude sitzt „im Berg“. Zwischen Planierring und Hang steht eine
 *    Stützmauer (Höhensprung 2 … 3, nach den Seiten auslaufend), dahinter steigt der Hang; alles andere bleibt begehbar.
 *  - `pondCells`: kleiner Teich abseits von Tür und Weg.
 *  - `boulderSpots`, `mossPatch`: Findlinge und Moosflecken.
 */
import { Rng, hash01, hashSeed, valueNoise2 } from '@mcda/core';
import type { PlotGrid } from './grid.js';
import type { TerrainStyleDef } from './style.js';

/** Geländeform: 'flat' = wie bisher (Standard), 'natural' = sanfter Hang, Teich, Findlinge; 'dramatic' = hoher Hang mit zwei Terrassen. */
export type Landform = 'flat' | 'natural' | 'dramatic';
export const LANDFORMS: readonly Landform[] = ['flat', 'natural', 'dramatic'];

export interface LandformSpec {
  /** Faktor auf die Reliefamplitude des Stils und Mindestamplitude (Blöcke). */
  readonly reliefMul: number;
  readonly reliefMin: number;
  /** Höhensprung der Stützmauer am Hangfuß (Blöcke, ≤ 3) und Steigung dahinter (Blöcke je Zelle). */
  readonly jump: number;
  readonly slope: number;
  /** Höhe des Hangs über der Grundhöhe (Blöcke). */
  readonly hill: number;
  /** Breite (Zellen), auf der die Stützmauer seitlich am Haus vorbei ausläuft. */
  readonly wrap: number;
  /** Zweite Terrasse (Sprung in Blöcken, 0 = keine) in dieser Tiefe hinter der ersten Mauer. */
  readonly jump2: number;
  readonly terraceAt: number;
  /** Teich (Zellen, ungefährer Radius) – 0 = keiner. */
  readonly pond: number;
  /** Findlinge je 100 freie Wiesenzellen. */
  readonly boulders: number;
  /** Anteil Moosflecken (0 … 1) auf der Wiese und am Sockel. */
  readonly moss: number;
  /** Faktor auf Bäume und Bodenpflanzen des Stils, wenn das Grundstück keinen eigenen Regler hat. */
  readonly trees: number;
  readonly ground: number;
}

const SPECS: Readonly<Record<Exclude<Landform, 'flat'>, LandformSpec>> = {
  natural: {
    reliefMul: 1.6, reliefMin: 3, jump: 2, slope: 0.6, hill: 5, wrap: 5, jump2: 0, terraceAt: 0,
    pond: 3, boulders: 1.4, moss: 0.22, trees: 1.5, ground: 1.15,
  },
  dramatic: {
    reliefMul: 2.2, reliefMin: 5, jump: 3, slope: 0.85, hill: 10, wrap: 8, jump2: 2, terraceAt: 7,
    pond: 4, boulders: 2.4, moss: 0.35, trees: 1.7, ground: 1.2,
  },
};

/** Regeln der Form; `undefined` für 'flat' bzw. keine Angabe. */
export function landformSpec(l: Landform | undefined): LandformSpec | undefined {
  return l === undefined || l === 'flat' ? undefined : SPECS[l];
}

/** Relief mit den Vorgaben der Form (ohne Form dasselbe Objekt → bitgleich). */
export function landformRelief(relief: TerrainStyleDef['relief'], spec: LandformSpec | undefined): TerrainStyleDef['relief'] {
  if (spec === undefined || relief.amplitude < 0) return relief;
  return { ...relief, amplitude: Math.max(spec.reliefMin, Math.round(relief.amplitude * spec.reliefMul)) };
}

const BIG = 1 << 20;

/** Kegel aus Quellen: out[i] = min über Quellen e (val[e] + Manhattan-Abstand), zwei Durchläufe. */
function cone(grid: PlotGrid, val: Int32Array, source: Uint8Array): Int32Array {
  const out = new Int32Array(grid.size).fill(BIG);
  for (let i = 0; i < grid.size; i++) if (source[i] === 1) out[i] = val[i]!;
  const { w, d } = grid;
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const i = x + z * w;
      if (x > 0) out[i] = Math.min(out[i]!, out[i - 1]! + 1);
      if (z > 0) out[i] = Math.min(out[i]!, out[i - w]! + 1);
    }
  }
  for (let z = d - 1; z >= 0; z--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = x + z * w;
      if (x < w - 1) out[i] = Math.min(out[i]!, out[i + 1]! + 1);
      if (z < d - 1) out[i] = Math.min(out[i]!, out[i + w]! + 1);
    }
  }
  return out;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (t: number): number => t * t * (3 - 2 * t);

export interface HillInput {
  readonly grid: PlotGrid;
  readonly seed: number;
  readonly spec: LandformSpec;
  readonly y0: number;
  /** Höhen nach dem Talus-Pass (werden nicht verändert). */
  readonly top: Int32Array;
  /** 1 = Spalte darf angehoben werden (freie Wiese ohne Zone, Bauwerk, Tür, Sculpt). */
  readonly free: Uint8Array;
  /** Spalten, die zum Gebäude oder zum Planierring gehören (1 = Gebäude, 2 = Planierring). */
  readonly house: Uint8Array;
  /** Grundriss-Spalten des Gebäudes. */
  readonly foot: readonly number[];
  readonly padWidth: number;
  /** Richtung „nach hinten“ (Achse, hinter dem Haus liegt der Hang). */
  readonly back: readonly [number, number];
}

export interface HillResult {
  readonly top: Int32Array;
  /** 1 = Spalte ist höher als ihr Nachbar Richtung Haus um ≥ 2 (sichtbare Mauerwand). */
  readonly raised: number;
}

/**
 * Hang hinter dem Haus. Modell (Höhen relativ zu y0): hinter dem Planierring springt das Gelände um `jump · L` hoch
 * (L = seitlicher Auslauf, 1 am Haus, 0 bei `wrap` Zellen Abstand), dahinter steigt es um `slope` je Zelle bis zur
 * Hanghöhe (Rauschen ±30 %); optional eine zweite Terrasse. Ein Kegel von allen nicht freien Spalten aus (Tür, Weg,
 * Zonen, Bauwerke, Planierring seitlich/vorn) hält den Rest begehbar (Höhe ≤ Nachbar + 1). Nur die Mauerfronten
 * (Sprung ≥ 2) sind steiler.
 */
export function hillside(input: HillInput): HillResult {
  const { grid, seed, spec, y0, top, free, house, foot, padWidth, back } = input;
  const [bx, bz] = back;
  const cOf = (i: number): number => grid.x(i) * bx + grid.z(i) * bz;
  const lOf = (i: number): number => grid.x(i) * Math.abs(bz) + grid.z(i) * Math.abs(bx);
  let backEdge = -BIG;
  let latMin = BIG;
  let latMax = -BIG;
  for (const i of foot) {
    backEdge = Math.max(backEdge, cOf(i));
    latMin = Math.min(latMin, lOf(i));
    latMax = Math.max(latMax, lOf(i));
  }
  // Quellen des Kegels: alles, was nicht angehoben wird – außer Gebäude und Planierring an der Rückseite (dort steht die Mauer)
  const source = new Uint8Array(grid.size);
  for (let i = 0; i < grid.size; i++) {
    if (free[i] === 1) continue;
    if (house[i] !== 0 && cOf(i) >= backEdge) continue;
    source[i] = 1;
  }
  const limit = cone(grid, top, source);
  const wob = hashSeed(seed, 'hill-wobble');
  const shape = hashSeed(seed, 'hill-shape');
  const out = Int32Array.from(top);
  let raised = 0;
  for (let i = 0; i < grid.size; i++) {
    if (free[i] !== 1) continue;
    const x = grid.x(i);
    const z = grid.z(i);
    const lat = lOf(i);
    const dv = Math.max(0, latMin - lat, lat - latMax);
    // die Mauerlinie verspringt seitlich um bis zu zwei Zellen (keine Lineal-Kante), am Haus liegt sie direkt am Planierring
    const wobble = dv === 0 ? 0 : Math.floor(valueNoise2(wob, lat, 0, 4) * 3);
    const u = cOf(i) - backEdge - padWidth - wobble;
    if (u < 1) continue;
    const wrapL = smooth(clamp01(1 - dv / spec.wrap));
    const n = valueNoise2(shape, x, z, 11);
    const cap = spec.hill * (0.7 + 0.6 * n);
    let rel = spec.jump * wrapL + spec.slope * (u - 1);
    if (spec.jump2 > 0 && u >= spec.terraceAt) rel += spec.jump2 * smooth(clamp01(1 - dv / (spec.wrap * 1.4)));
    rel = Math.min(rel, cap);
    const abs = Math.min(y0 + rel, limit[i]!);
    const v = Math.max(top[i]!, Math.floor(abs));
    if (v > out[i]!) {
      out[i] = v;
      raised++;
    }
  }
  return { top: out, raised };
}

/**
 * Teichfläche (Spalten) für ein Grundstück ohne eigenen Teich: eine unregelmäßige Ellipse auf freier Wiese, weit weg von
 * Tür, Haus, Rand und Hang. `ok` liefert je Spalte, ob sie frei ist; leer, wenn nichts passt.
 */
export function pondCells(
  grid: PlotGrid, seed: number, radius: number, ok: (i: number) => boolean, score: (i: number) => number,
): number[] {
  if (radius <= 0) return [];
  const rng = new Rng(hashSeed(seed, 'landform-pond'));
  const rx = radius + rng.int(0, 1);
  const rz = Math.max(2, radius - rng.int(0, 1));
  const cand: Array<{ i: number; s: number }> = [];
  for (let i = 0; i < grid.size; i++) {
    if (!ok(i)) continue;
    cand.push({ i, s: score(i) + hash01(seed, grid.x(i), grid.z(i)) * 0.5 });
  }
  cand.sort((a, b) => b.s - a.s || a.i - b.i);
  const wob = hashSeed(seed, 'pond-wobble');
  for (const { i: c } of cand.slice(0, 24)) {
    const cells: number[] = [];
    let all = true;
    for (let dx = -rx - 1; dx <= rx + 1 && all; dx++) {
      for (let dz = -rz - 1; dz <= rz + 1; dz++) {
        const j = grid.at(grid.x(c) + dx, grid.z(c) + dz);
        const r = (dx * dx) / (rx * rx) + (dz * dz) / (rz * rz);
        const edge = 0.85 + 0.5 * valueNoise2(wob, grid.x(c) + dx, grid.z(c) + dz, 3);
        if (r > edge) continue;
        if (j < 0 || !ok(j)) {
          all = false;
          break;
        }
        cells.push(j);
      }
    }
    if (all && cells.length >= 6) return cells;
  }
  return [];
}

/** Moosfleck an dieser Spalte? (Rauschen in Flecken, Anteil ≈ `share`). */
export function mossPatch(seed: number, x: number, z: number, share: number): boolean {
  return valueNoise2(hashSeed(seed, 'landform-moss'), x, z, 4) > 1 - share * 1.6 && hash01(hashSeed(seed, 'moss-dot'), x, z) < 0.85;
}
