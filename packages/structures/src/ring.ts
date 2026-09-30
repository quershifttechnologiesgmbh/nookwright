/**
 * Burg-Ensemble (BT01, research/19 §3): Ringmauer um eine Kernfläche und Zinnenkranz auf Flachdächern. Rein und
 * deterministisch; die Lage der Kernfläche und der Haustür kommt vom Aufrufer (Anwendungsdienst, aus der Hülle).
 *
 *  - `ringAround`: Rechteck im Abstand `offset` um die Kernfläche, **spiegelsymmetrisch zur Achse der Haustür**
 *    (das Tor liegt genau in dieser Achse); nie quadratisch (kein 4-fach drehsymmetrischer Grundriss). Die Torseite
 *    ist lang genug, dass Torhaus und Ecktürme sich nicht verdrängen. Optional Zwinger (zweiter Ring ohne Türme,
 *    niedriger, Tor in derselben Achse) und Graben (Band außen, Damm vor dem Tor).
 *  - `buildParapet` (Wehrplatte): Brüstung auf dem Außenrand eines rechteckigen Flachdachs, Zinnen im Takt je Seite von
 *    beiden Ecken aus gezählt – jede Seite ist in sich spiegelsymmetrisch, es entsteht kein Windrad-Muster.
 */
import { hashSeed, type Cell, type HorizontalDir } from '@mcda/core';
import { B, PRIO, trapdoor, type Block, type Site } from './canvas.js';
import { isCapped, isMerlon, solveAndLog, type CrenelProblem, type CrenelTile } from './crenel.js';
import { pseudoAngle } from './geometry.js';
import { towerRoof } from './roof.js';
import type { GateSpec, ParapetSpec, TowerStyle, WallPlan } from './types.js';

export interface Rect {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export interface RingSpec {
  readonly id?: string;
  /** Kernfläche (Baukörper samt Überstand und Außenprofil). */
  readonly core: Rect;
  /** Haustür: Türspalte und Blick hinaus – das Tor liegt in ihrer Achse auf der Seite `out`. */
  readonly door: { readonly cell: Cell; readonly out: HorizontalDir };
  /** Freier Abstand Kernfläche → Innenkante der Mauertürme (die Mauerlinie liegt einen Turmradius weiter außen). */
  readonly offset: number;
  readonly height?: number;
  readonly thickness?: number;
  readonly towerSpacing?: number;
  readonly towerStyle?: TowerStyle;
  readonly merlon?: WallPlan['merlon'];
  readonly gate?: Omit<GateSpec, 'at'>;
  /** Zwinger: Abstand vor der äußersten Turmkante und Höhe. */
  readonly outer?: { readonly gap: number; readonly height: number };
  /** Graben: Breite und Abstand vor der äußersten Mauer (bzw. Turmkante). */
  readonly moat?: { readonly width: number; readonly gap: number };
  /** Additiv (W9-G5): Materialakzente des Hauptrings (`WallPlan.accents`); der Zwinger bleibt schlicht. */
  readonly accents?: boolean;
}

export interface RingLayout {
  readonly walls: WallPlan[];
  /** Mauerlinie des Hauptrings. */
  readonly line: Rect;
  /** Innenfläche des Hauptrings (innerhalb der Mauer, samt Turm-Grundrissen). */
  readonly inner: Rect;
  /** Graben-Zellen (ohne Damm). */
  readonly moat: Cell[];
  /** Äußerste belegte Grenze (Mauer, Türme, Graben). */
  readonly outer: Rect;
}

const grow = (r: Rect, d: number): Rect => ({ minX: r.minX - d, minZ: r.minZ - d, maxX: r.maxX + d, maxZ: r.maxZ + d });
const corners = (r: Rect): Cell[] => [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]];

/** Turmradius wie `resolveStyle` (rund ≥ 9, eckig ≥ 7, ungerade). */
function towerRadius(style: TowerStyle | undefined): number {
  const min = (style?.shape ?? 'round') === 'round' ? 9 : 7;
  const size = Math.max(min, style?.size ?? min);
  return (size + (size % 2 === 0 ? 1 : 0) - 1) / 2;
}

/** Tor auf der Seite `out` des Rechtecks in der Achse `a`. */
function gateAt(r: Rect, out: HorizontalDir, a: number): Cell {
  return out === 'south' ? [a, r.maxZ] : out === 'north' ? [a, r.minZ] : out === 'east' ? [r.maxX, a] : [r.minX, a];
}

/**
 * Zwischentürme der drei Seiten ohne Tor (die Torseite trägt Ecktürme und Torhaus): gleichmäßig im Takt `spacing`,
 * aber so wenige, dass zwischen zwei Türmen ein Treppenaufgang (Höhe + 2 Zellen) Platz hat. Gegenüberliegende Seiten
 * gleich lang → gleich viele Türme (spiegelsymmetrisch zur Torachse). Der Aufgang liegt auf der linken Nachbarseite
 * des Tores im ersten Feld hinter dem Eckturm.
 */
function sideTowers(line: Rect, out: HorizontalDir, spacing: number, r: number, H: number): { towers: Cell[]; stair: Cell } {
  const c = corners(line); // NW, NE, SE, SW
  // Seiten als [von, nach] – die erste und die letzte grenzen an die Torseite (von dort aus gezählt)
  const order: Record<HorizontalDir, [Cell, Cell][]> = {
    south: [[c[3]!, c[0]!], [c[0]!, c[1]!], [c[2]!, c[1]!]],
    north: [[c[1]!, c[2]!], [c[2]!, c[3]!], [c[0]!, c[3]!]],
    east: [[c[2]!, c[3]!], [c[3]!, c[0]!], [c[1]!, c[0]!]],
    west: [[c[0]!, c[1]!], [c[1]!, c[2]!], [c[3]!, c[2]!]],
  };
  const towers: Cell[] = [];
  let stair: Cell = c[0]!;
  order[out].forEach(([p, q], i) => {
    const len = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
    let n = Math.max(0, Math.ceil(len / Math.max(1, spacing)) - 1);
    while (n > 0 && len / (n + 1) - (2 * r + 1) < H + 2) n--;
    const at = (t: number): Cell => [Math.round(p[0] + ((q[0] - p[0]) * t) / len), Math.round(p[1] + ((q[1] - p[1]) * t) / len)];
    for (let j = 1; j <= n; j++) towers.push(at((len * j) / (n + 1)));
    if (i === 0) stair = at(len / (n + 1) / 2);
  });
  return { towers, stair };
}

export function ringAround(spec: RingSpec): RingLayout {
  const id = spec.id ?? 'ring';
  const T = spec.thickness ?? 3;
  const r = towerRadius(spec.towerStyle);
  const gw = spec.gate?.width ?? 3;
  const hiW = Math.floor((gw - 1) / 2);
  // Torseite: Torhaus (Türme bei s ± (hi + 2 + r)) und Ecktürme brauchen ≥ 2r + 2 Abstand; ohne Torhaus nur Tor + Eckturm
  const minHalf = spec.gate?.gatehouse === true ? hiW + 3 * r + 5 : hiW + r + 4;
  const ns = spec.door.out === 'north' || spec.door.out === 'south';
  const a = ns ? spec.door.cell[0] : spec.door.cell[1];
  // `offset` = freier Abstand bis zur Innenkante der Türme (Turmmitte auf der Mauerlinie)
  let line = grow(spec.core, spec.offset + r);
  const [lo, hi] = ns ? [line.minX, line.maxX] : [line.minZ, line.maxZ];
  const half = Math.max(a - lo, hi - a, minHalf);
  line = ns ? { ...line, minX: a - half, maxX: a + half } : { ...line, minZ: a - half, maxZ: a + half };
  // nie quadratisch: die Rückseite (gegenüber dem Tor) rückt eine Reihe hinaus
  if (line.maxX - line.minX === line.maxZ - line.minZ) {
    line = spec.door.out === 'south' ? { ...line, minZ: line.minZ - 1 } : spec.door.out === 'north' ? { ...line, maxZ: line.maxZ + 1 }
      : spec.door.out === 'east' ? { ...line, minX: line.minX - 1 } : { ...line, maxX: line.maxX + 1 };
  }
  const gate = (rect: Rect): GateSpec => ({ ...spec.gate, at: gateAt(rect, spec.door.out, a) });
  const H = spec.height ?? 6;
  const { towers, stair } = sideTowers(line, spec.door.out, spec.towerSpacing ?? 24, r, H);
  const walls: WallPlan[] = [{
    id, points: corners(line), closed: true, thickness: T, height: H,
    towerSpacing: 0, extraTowers: towers, stairs: [stair], ...(spec.towerStyle !== undefined ? { towerStyle: spec.towerStyle } : {}),
    ...(spec.merlon !== undefined ? { merlon: spec.merlon } : {}), gates: [gate(line)],
    ...(spec.accents === true ? { accents: true } : {}),
  }];
  // Ausladung der äußersten Mauer über ihre Linie: Turmradius bzw. halbe Dicke, dazu der Anlauf am Fuß
  let last = line;
  let reach = r + 1;
  if (spec.outer !== undefined) {
    last = grow(line, r + spec.outer.gap + Math.ceil(T / 2));
    walls.push({
      id: `${id}-outer`, points: corners(last), closed: true, thickness: T, height: spec.outer.height, towers: 'none',
      ...(spec.merlon !== undefined ? { merlon: spec.merlon } : {}), gates: [{ ...gate(last), gatehouse: false }],
    });
    reach = Math.ceil(T / 2) + 1;
  }
  const moat: Cell[] = [];
  let outer = grow(last, reach);
  if (spec.moat !== undefined) {
    const from = reach + spec.moat.gap + 1;
    const to = from + spec.moat.width - 1;
    const dam = hiW + 2;
    for (let d = from; d <= to; d++) {
      const b = grow(last, d);
      for (let x = b.minX; x <= b.maxX; x++) for (let z = b.minZ; z <= b.maxZ; z++) {
        if (x !== b.minX && x !== b.maxX && z !== b.minZ && z !== b.maxZ) continue;
        const onGateSide = spec.door.out === 'south' ? z > last.maxZ : spec.door.out === 'north' ? z < last.minZ : spec.door.out === 'east' ? x > last.maxX : x < last.minX;
        if (onGateSide && Math.abs((ns ? x : z) - a) <= dam) continue;
        moat.push([x, z]);
      }
    }
    outer = grow(last, to);
  }
  return { walls, line, inner: grow(line, -(Math.floor(T / 2) + 1)), moat, outer };
}

/**
 * Wehrplatte: Brüstung (1 hoch) auf dem Außenrand des Flachdachs bei `y + 1`, Zinnen darüber (research/19 BT01).
 * Additiv (W3-CA): mit `deck` liegt innerhalb der Brüstung ein Belag (Rolle `walkway`) auf Brüstungshöhe – Brüstung
 * und Zinnen bleiben, wo sie waren (ein Schornstein in der Mauerkrone trifft sie nicht öfter als vorher); mit
 * `crown: 'lookout'` liegt der Belag auf dem ganzen Dach und darauf statt der Zinnen ein Ausguck (`lookoutCrown`).
 */
export function buildParapet(site: Site, spec: ParapetSpec, index: number): void {
  const owner = `${site.prefix}:${spec.id ?? `p${index}`}`;
  const set = new Set(spec.cells.map(([x, z]) => `${x},${z}`));
  if (set.size === 0) return;
  const xs = spec.cells.map((c) => c[0]);
  const zs = spec.cells.map((c) => c[1]);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const rimOf = (x: number, z: number): boolean => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !set.has(`${x + dx!},${z + dz!}`));
  const deck = spec.deck === true ? 1 : 0;
  const lookout = spec.crown === 'lookout';
  if (deck === 1) for (const [x, z] of spec.cells) if (lookout || !rimOf(x, z)) site.canvas.put([x, spec.y + 1, z], B.walkway, owner, PRIO.feature);
  // W4-B: Luke über der Leiter der Hülle – Falltür mit dem `facing` der Leiter (geöffnet kletterbar), mit Belag bündig
  // (obere Hälfte), ohne Belag auf der Dachplatte (untere Hälfte); nie auf dem Rand (dort stehen Brüstung bzw. Pfosten)
  const hatch = spec.hatch;
  if (hatch !== undefined && set.has(`${hatch.cell[0]},${hatch.cell[1]}`) && !rimOf(hatch.cell[0], hatch.cell[1])) {
    site.canvas.put([hatch.cell[0], spec.y + 1, hatch.cell[1]], trapdoor(hatch.facing, deck === 1 ? 'top' : 'bottom'), owner, PRIO.door);
  } else if (hatch !== undefined) site.warnings.push(`${owner}: Luke ${hatch.cell.join(',')} liegt nicht im Inneren der Wehrplatte – ohne Falltür`);
  if (lookout) {
    const side = maxX - minX + 1;
    if (side === maxZ - minZ + 1 && side % 2 === 1 && side >= 5 && set.size === side * side) {
      lookoutCrown(site, owner, [minX + (side - 1) / 2, minZ + (side - 1) / 2], (side - 1) / 2, spec.y + deck);
      return;
    }
    site.warnings.push(`${owner}: Ausguck nur auf quadratischem Flachdach mit ungerader Seite – stattdessen Zinnen`);
  }
  const mw = Math.max(1, spec.merlon?.width ?? 2);
  const period = mw + Math.max(1, spec.merlon?.gap ?? 1);
  // feat/tiled-wfc: auf einem vollen Rechteck Zinnen aus dem Tiled-WFC (Seiten gespiegelt, Ecken Zinnen)
  const tiled = site.tiled !== undefined && set.size === (maxX - minX + 1) * (maxZ - minZ + 1)
    ? parapetCrenels(spec.cells.filter(([x, z]) => rimOf(x, z)), [minX, minZ, maxX, maxZ], mw, hashSeed(site.seed, owner, 'parapet-crenel'), site.tiled.themeId, (tiles) => solveAndLog(tiles, owner, 'parapet', (e) => site.tiledLog.push(e)))
    : undefined;
  if (tiled !== undefined) {
    for (const [x, z, t] of tiled) {
      site.canvas.put([x, spec.y + 1, z], B.parapet, owner, PRIO.feature);
      if (isMerlon(t)) site.canvas.put([x, spec.y + 2, z], B.parapet, owner, PRIO.feature);
      if (isCapped(t)) site.canvas.put([x, spec.y + 3, z], B.cap, owner, PRIO.feature);
    }
    return;
  }
  for (const [x, z] of spec.cells) {
    if (!rimOf(x, z)) continue;
    site.canvas.put([x, spec.y + 1, z], B.parapet, owner, PRIO.feature);
    // Abstand zur nächsten Ecke entlang der Seite: an beiden Enden gleich gezählt → jede Seite spiegelsymmetrisch
    const d = x === minX || x === maxX ? Math.min(z - minZ, maxZ - z) : Math.min(x - minX, maxX - x);
    if (d % period < mw) site.canvas.put([x, spec.y + 2, z], B.parapet, owner, PRIO.feature);
  }
}

/**
 * Ausguck (W3-CA, Vorbilder: 6 von 8 Wachturm-Anleitungen): auf dem quadratischen Dach (Mitte `c`, Radius `r`, Boden bei
 * `y`) Pfosten an den Ecken und Seitenmitten 3 hoch, dazwischen eine Zaun-Brüstung, darüber 2 Reihen offen; ein Zeltdach
 * (Neigung 2, Stange) deckt den Radius r + 1, an seinen vier Ecken hängt je eine Laterne unter dem Überstand.
 * W4-B (Review M1 „Zeltdach so hoch wie der Schaft“): mit Glockenfuß – der Überstand ist eine Stufe, das Dach eine
 * Neigungsstufe (2 Blöcke) niedriger und läuft flacher aus.
 */
function lookoutCrown(site: Site, owner: string, c: Cell, r: number, y: number): void {
  const put = (dx: number, yy: number, dz: number, b: Block): boolean => site.canvas.put([c[0] + dx, yy, c[1] + dz], b, owner, PRIO.feature);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
      const post = (Math.abs(dx) === r || dx === 0) && (Math.abs(dz) === r || dz === 0);
      if (post) for (let k = 1; k <= 3; k++) put(dx, y + k, dz, B.post);
      else put(dx, y + 1, dz, B.fence);
    }
  }
  const yR = y + 4;
  for (const b of towerRoof({ shape: 'square', r, roofShape: 'tent', pitch: 2, flare: true, finial: 'pole' })) put(b.dx, yR + b.dy, b.dz, b.block);
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
    put(sx * (r + 1), yR - 1, sz * (r + 1), B.hangingLantern);
  }
}

/** Zinnenfolge auf dem Rand eines vollen Rechtecks (Ring um die Mitte, Spiegel an beiden Achsen, Ecken Zinnen). */
function parapetCrenels(
  rim: readonly Cell[], [minX, minZ, maxX, maxZ]: readonly [number, number, number, number], width: number, seed: number, themeId: string | undefined,
  solve: (p: CrenelProblem) => CrenelTile[] | undefined,
): [number, number, CrenelTile][] | undefined {
  // doppelte Koordinaten um die Mitte (gerade Seiten haben ihre Mitte zwischen zwei Zellen)
  const rel = (x: number, z: number): [number, number] => [2 * x - minX - maxX, 2 * z - minZ - maxZ];
  const sorted = [...rim].sort((a, b) => pseudoAngle(...rel(a[0], a[1])) - pseudoAngle(...rel(b[0], b[1])));
  const at = new Map(sorted.map(([x, z], i) => [`${x},${z}`, i] as const));
  const mirror: [number, number][] = [];
  const seen = new Set<string>();
  sorted.forEach(([x, z], i) => {
    for (const [mx, mz] of [[minX + maxX - x, z], [x, minZ + maxZ - z]] as const) {
      const j = at.get(`${mx},${mz}`);
      if (j === undefined || seen.has(`${Math.min(i, j)},${Math.max(i, j)}`)) continue;
      seen.add(`${Math.min(i, j)},${Math.max(i, j)}`);
      mirror.push([Math.min(i, j), Math.max(i, j)]);
    }
  });
  const merlons = sorted.flatMap(([x, z], i) => ((x === minX || x === maxX) && (z === minZ || z === maxZ) ? [i] : []));
  const tiles = solve({ n: sorted.length, ring: true, mirror, merlons, preferWidth: width, seed, ...(themeId !== undefined ? { themeId } : {}) });
  return tiles?.map((t, i) => [sorted[i]![0], sorted[i]![1], t]);
}
