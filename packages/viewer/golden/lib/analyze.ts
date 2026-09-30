/**
 * Goldene Galerie (P0-A): Analyse einer Welt allein aus den Blöcken (rein, deterministisch).
 *
 * Warum nur aus Blöcken? Die Welten alter Commits kommen als `.nbt` ohne Projekt, Hülle oder Anker. Damit Bilder
 * aus `.nbt` und aus dem Generator bei gleicher Welt identisch sind, leiten beide Wege Kameras aus demselben Raster
 * ab. Heuristiken (alle in diesem Modul, mit Tests):
 *
 * - **Bau-Spalten:** Spalten mit ≥ `BUILT_MIN` Blöcken, die weder Gelände noch Bewuchs sind (Stämme unter Blättern
 *   zählen als Bewuchs; Naturgestein unter Erde derselben Spalte ist Untergrund). 4er-zusammenhängende
 *   Gruppen ab `MIN_COMPONENT` Spalten (und ≥ 10 % der größten) sind Bauten; die größte ist der Hauptbau. Zäune,
 *   Laternenpfähle, Beete, Brunnen und Bäume fallen so heraus.
 * - **Boden:** höchster Gelände-Vollblock je Spalte (ohne Blätter); Bauhöhe = Median über den Ring um den Bau.
 * - **Sockel (W7-J):** Boden am Haus für Kameras und Schnitte = Gelände-Boden, außer die Haupttür steht tiefer (Erdhaus
 *   im Hügel, Haus am Hang mit Eingang talseitig): dann der Block unter der Tür. Nicht die tiefste Etage – Keller
 *   (Taverne) lägen sonst im Sockel.
 * - **Etagen:** Innen-Stehflächen (fester Block darunter, zwei freie Zellen, gebaut überdacht, kein Nachbar unter
 *   offenem Himmel – Dachüberstände zählen nicht) in der Bau-Box, je Höhe gezählt; Höhen mit den meisten Flächen und
 *   Licht (bewohnt), mindestens 3 Blöcke auseinander.
 * - **Türen:** untere Türhälften; außen, wenn genau eine Seite in ≤ 4 Schritten Himmel sieht. Haupttür: unterste
 *   Außentür des Hauptbaus, dann Richtung Süd, Ost, West, Nord.
 * - **Ecken:** Bau-Spalte des Hauptbaus nächst der Südost- bzw. Südwest-Ecke seiner Box, Traufe = oberster Bau-Block
 *   dort.
 * - **Innenblick je Etage:** größte zusammenhängende Innenfläche der Etage mit Licht (sonst die größte);
 *   Standort und Richtung mit der größten sichtbaren Fläche (Strahlen auf Augenhöhe).
 */
import { gridIndex, type Grid, type PhysClass, type Vec3 } from './grid.js';

export const BUILT_MIN = 4;
export const MIN_COMPONENT = 12;
export const MAX_FLOORS = 8;

export type Dir = 'north' | 'east' | 'south' | 'west';
export const DIR_STEP: Readonly<Record<Dir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const DIR_ORDER: readonly Dir[] = ['south', 'east', 'west', 'north'];

export interface Box {
  readonly min: Vec3;
  /** inklusive */
  readonly max: Vec3;
}

export interface BuiltComponent {
  readonly columns: number;
  /** x/z der Spalten; y vom Boden bis zum höchsten Block dieser Spalten */
  readonly box: Box;
}

export interface Door {
  /** untere Hälfte */
  readonly pos: Vec3;
  readonly name: string;
  /** Richtung nach außen (fehlt: Innentür oder unklar) */
  readonly outward?: Dir;
}

export interface Corner {
  /** Bau-Spalte an der Ecke (x, z) */
  readonly x: number;
  readonly z: number;
  /** Richtung nach außen (diagonal, je ±1) */
  readonly out: readonly [number, number];
  readonly groundY: number;
  /** oberster Bau-Block der Eckspalte */
  readonly eaveY: number;
}

export interface InteriorSpot {
  /** Standzelle (Füße) */
  readonly pos: Vec3;
  readonly dir: Dir | 'northeast' | 'southeast' | 'southwest' | 'northwest';
  /** sichtbare Stehzellen (Bewertung) */
  readonly score: number;
  /** Größe der Fläche (zusammenhängende Stehzellen) */
  readonly area: number;
}

export interface Floor {
  /** 1 … n von unten */
  readonly index: number;
  /** Fußhöhe (y der Zelle über dem Boden) */
  readonly feetY: number;
  /** Stehzellen unter Dach auf dieser Höhe */
  readonly cells: number;
  /** Schnitt (inklusive) für die Draufsicht */
  readonly cutY: number;
  readonly spot?: InteriorSpot;
}

export interface Analysis {
  readonly size: Vec3;
  /** Gelände: Median des Rings um den Bau */
  readonly groundY: number;
  /** Boden am Haus (Sockel): `groundY`, oder der Block unter der Haupttür, wenn die tiefer steht */
  readonly baseY: number;
  readonly components: readonly BuiltComponent[];
  /** Vereinigung aller Bauten */
  readonly building: Box;
  /** größter Bau */
  readonly main: Box;
  readonly floors: readonly Floor[];
  readonly doors: readonly Door[];
  readonly mainDoor?: Door;
  readonly corners: { readonly se?: Corner; readonly sw?: Corner };
  /** höchster bzw. tiefster Block je Spalte (Index x + sx·z, −1: leer) – für die Bildausschnitte */
  readonly columnTop: Int16Array;
  readonly columnBottom: Int16Array;
}

// ---------------------------------------------------------------------------------------------- Zellen

interface Cells {
  readonly g: Grid;
  readonly cls: (x: number, y: number, z: number) => PhysClass;
  readonly natural: (x: number, y: number, z: number) => boolean;
  readonly emits: (x: number, y: number, z: number) => boolean;
  readonly mineral: (x: number, y: number, z: number) => boolean;
  readonly occupied: (x: number, y: number, z: number) => boolean;
  readonly name: (x: number, y: number, z: number) => string;
  readonly inside: (x: number, y: number, z: number) => boolean;
}

function cellsOf(g: Grid): Cells {
  const [sx, sy, sz] = g.size;
  const inside = (x: number, y: number, z: number): boolean => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;
  const p = (x: number, y: number, z: number): number => (inside(x, y, z) ? g.cells[gridIndex(g.size, x, y, z)]! : 0);
  return {
    g,
    inside,
    cls: (x, y, z) => g.traits[p(x, y, z)]!.cls,
    natural: (x, y, z) => g.traits[p(x, y, z)]!.natural,
    emits: (x, y, z) => g.traits[p(x, y, z)]!.emits,
    mineral: (x, y, z) => g.traits[p(x, y, z)]!.mineral,
    occupied: (x, y, z) => p(x, y, z) !== 0,
    name: (x, y, z) => g.palette[p(x, y, z)]!.name,
  };
}

/** Frei für Beine/Kopf: Luft, dünn (Fackel, Blume) oder flach (Teppich). */
const passable = (c: PhysClass): boolean => c === 'air' || c === 'thin' || c === 'flat';
/** Trägt: fester Block, Stufe, Treppe … (nicht Luft, dünn, flach). */
const supports = (c: PhysClass): boolean => c === 'full' || c === 'half' || c === 'tall';

const isLog = (name: string): boolean => /(_log|_wood|_stem|_hyphae)$/.test(name) && !name.startsWith('stripped_');
const isLeaves = (name: string): boolean => name.endsWith('_leaves');

// ---------------------------------------------------------------------------------------------- Spalten

interface Columns {
  /** Anzahl Bau-Blöcke je Spalte */
  readonly built: Uint16Array;
  /** höchster Block je Spalte (−1: leer) */
  readonly top: Int16Array;
  /** tiefster Block je Spalte (−1: leer) */
  readonly bottom: Int16Array;
  /** höchster Gelände-Vollblock je Spalte (−1: keiner) */
  readonly ground: Int16Array;
  /** tiefster Bau-Block je Spalte (−1: keiner) */
  readonly builtLow: Int16Array;
  /** höchster Bau-Block je Spalte (−1: keiner) */
  readonly builtTop: Int16Array;
}

function columnsOf(c: Cells): Columns {
  const [sx, sy, sz] = c.g.size;
  const n = sx * sz;
  const built = new Uint16Array(n), top = new Int16Array(n).fill(-1), bottom = new Int16Array(n).fill(-1), ground = new Int16Array(n).fill(-1);
  const builtLow = new Int16Array(n).fill(-1), builtTop = new Int16Array(n).fill(-1);
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const k = x + sx * z;
      // Untergrund: Naturgestein unter einem Gelände-Block derselben Spalte (Stein-Schichten unter der Erde) zählt
      // nicht als Bau. Ein Haus im Hügel bleibt Bau (Baustoffe), die Erde darüber ist Gelände.
      let topNatural = -1;
      for (let y = sy - 1; y >= 0; y--) {
        if (c.occupied(x, y, z) && c.natural(x, y, z) && c.cls(x, y, z) === 'full' && !isLeaves(c.name(x, y, z))) { topNatural = y; break; }
      }
      let leavesAbove = false;
      for (let y = sy - 1; y >= 0; y--) {
        if (!c.occupied(x, y, z)) continue;
        if (top[k] === -1) top[k] = y;
        bottom[k] = y;
        const name = c.name(x, y, z);
        if (isLeaves(name)) leavesAbove = true;
        const natural = c.natural(x, y, z) || (leavesAbove && isLog(name));
        if (natural) {
          if (ground[k] === -1 && c.cls(x, y, z) === 'full' && !isLeaves(name)) ground[k] = y;
          continue;
        }
        if (y < topNatural && c.mineral(x, y, z)) continue;
        built[k]!++;
        if (builtTop[k] === -1) builtTop[k] = y;
        builtLow[k] = y;
      }
    }
  }
  return { built, top, bottom, ground, builtLow, builtTop };
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}

/** 4er-Komponenten der Bau-Spalten (Reihenfolge: nach erster Zelle in x-z-Ordnung). */
function components(size: Vec3, col: Columns): Array<{ cells: number[] }> {
  const [sx, , sz] = size;
  const seen = new Uint8Array(sx * sz);
  const out: Array<{ cells: number[] }> = [];
  for (let k = 0; k < sx * sz; k++) {
    if (seen[k] || col.built[k]! < BUILT_MIN) continue;
    const cells: number[] = [];
    const stack = [k];
    seen[k] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      cells.push(i);
      const x = i % sx, z = Math.floor(i / sx);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= sx || nz >= sz) continue;
        const j = nx + sx * nz;
        if (seen[j] || col.built[j]! < BUILT_MIN) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    out.push({ cells: cells.sort((a, b) => a - b) });
  }
  return out;
}

const unionBox = (boxes: readonly Box[]): Box => ({
  min: [Math.min(...boxes.map((b) => b.min[0])), Math.min(...boxes.map((b) => b.min[1])), Math.min(...boxes.map((b) => b.min[2]))],
  max: [Math.max(...boxes.map((b) => b.max[0])), Math.max(...boxes.map((b) => b.max[1])), Math.max(...boxes.map((b) => b.max[2]))],
});

// ---------------------------------------------------------------------------------------------- Analyse

export function analyze(g: Grid): Analysis {
  const c = cellsOf(g);
  const [sx, sy, sz] = g.size;
  const col = columnsOf(c);
  const all = components(g.size, col);
  const largest = Math.max(0, ...all.map((a) => a.cells.length));
  const kept = all.filter((a) => a.cells.length >= MIN_COMPONENT && a.cells.length >= 0.1 * largest);
  // Ohne erkennbaren Bau (leere Welt, nur Gelände): ganze Welt
  const volumeBox: Box = { min: [0, 0, 0], max: [sx - 1, sy - 1, sz - 1] };
  const colBox = (cells: readonly number[]): { x0: number; x1: number; z0: number; z1: number } => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const k of cells) {
      const x = k % sx, z = Math.floor(k / sx);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    return { x0, x1, z0, z1 };
  };

  // Boden: Median der Gelände-Höhe im Ring um die Bauten (ohne Gelände: unter dem tiefsten Bau-Block)
  const keptCells = kept.flatMap((k) => k.cells);
  const all2 = keptCells.length > 0 ? colBox(keptCells) : { x0: 0, x1: sx - 1, z0: 0, z1: sz - 1 };
  const ring: number[] = [];
  for (let x = all2.x0 - 2; x <= all2.x1 + 2; x++) {
    for (let z = all2.z0 - 2; z <= all2.z1 + 2; z++) {
      if (x >= all2.x0 - 1 && x <= all2.x1 + 1 && z >= all2.z0 - 1 && z <= all2.z1 + 1) continue; // nur äußerer Ring (Abstand 2)
      if (x < 0 || z < 0 || x >= sx || z >= sz) continue;
      const gy = col.ground[x + sx * z]!;
      if (gy >= 0) ring.push(gy);
    }
  }
  const lowestBuilt = Math.min(...keptCells.map((k) => col.builtLow[k]!).filter((y) => y >= 0), sy);
  const groundY = median(ring) ?? (keptCells.length > 0 ? lowestBuilt - 1 : -1);

  const comps: BuiltComponent[] = kept.map((k) => {
    const b = colBox(k.cells);
    const topY = Math.max(...k.cells.map((i) => col.top[i]!));
    return { columns: k.cells.length, box: { min: [b.x0, Math.max(0, Math.min(groundY, lowestBuilt)), b.z0], max: [b.x1, topY, b.z1] } };
  });
  // Hauptbau zuerst, dann nach Größe/Lage (stabil)
  const order = comps.map((cmp, i) => ({ cmp, i })).sort((a, b) => b.cmp.columns - a.cmp.columns || a.i - b.i);
  const sorted = order.map((o) => o.cmp);
  const mainCells = order.length > 0 ? kept[order[0]!.i]!.cells : [];
  const building = sorted.length > 0 ? unionBox(sorted.map((s) => s.box)) : volumeBox;
  const main = sorted[0]?.box ?? volumeBox;

  const floors = findFloors(c, col, building);
  const doors = findDoors(c);
  const mainDoor = pickMainDoor(doors, main, sorted.slice(1).filter((s) => s.columns >= YARD_NEIGHBOUR_COLUMNS).map((s) => s.box));
  const corner = (wantX: 1 | -1): Corner | undefined => {
    if (mainCells.length === 0) return undefined;
    let best = -1, bestD = Infinity;
    for (const k of mainCells) {
      const x = k % sx, z = Math.floor(k / sx);
      const d = (wantX === 1 ? main.max[0] - x : x - main.min[0]) + (main.max[2] - z);
      if (d < bestD) { bestD = d; best = k; }
    }
    const x = best % sx, z = Math.floor(best / sx);
    const ox = x + wantX, oz = z + 1;
    const gOut = ox >= 0 && oz >= 0 && ox < sx && oz < sz ? col.ground[ox + sx * oz]! : -1;
    return { x, z, out: [wantX, 1], groundY: gOut >= 0 ? gOut : groundY, eaveY: col.builtTop[best]! };
  };
  const se = corner(1), sw = corner(-1);
  // Erdhaus: der Ring liegt auf dem Hügel, die Tür darunter – Kameras richten sich nach dem Eingang, nicht nach dem Hügel
  const baseY = mainDoor !== undefined ? Math.min(groundY, mainDoor.pos[1] - 1) : groundY;
  return {
    size: g.size, groundY, baseY, components: sorted, building, main, floors, doors, columnTop: col.top, columnBottom: col.bottom,
    ...(mainDoor !== undefined ? { mainDoor } : {}),
    corners: { ...(se !== undefined ? { se } : {}), ...(sw !== undefined ? { sw } : {}) },
  };
}

// ---------------------------------------------------------------------------------------------- Etagen

function standable(c: Cells, x: number, y: number, z: number): boolean {
  return supports(c.cls(x, y - 1, z)) && passable(c.cls(x, y, z)) && passable(c.cls(x, y + 1, z)) && c.occupied(x, y - 1, z);
}

/** Über Kopf gebaut (Decke/Dach, keine Baumkrone). */
const roofed = (c: Cells, col: Columns, x: number, y: number, z: number): boolean => c.inside(x, y, z) && col.builtTop[x + c.g.size[0] * z]! > y + 1;

/**
 * Innen: stehbar, überdacht, und kein Nachbar auf Fußhöhe ist offener Himmel (sonst Dachüberstand oder Vordach:
 * die Zellen unter der Traufe zählen nicht als Raum).
 */
function indoor(c: Cells, col: Columns, x: number, y: number, z: number): boolean {
  if (!standable(c, x, y, z) || !roofed(c, col, x, y, z)) return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = x + dx, nz = z + dz;
    if (!c.inside(nx, y, nz)) return false;
    if (passable(c.cls(nx, y, nz)) && !roofed(c, col, nx, y, nz)) return false;
  }
  return true;
}

function findFloors(c: Cells, col: Columns, box: Box): Floor[] {
  const [sx, sy] = c.g.size;
  const counts = new Map<number, number>();
  // Lichtquellen je Höhe unter Dach: bewohnte Etagen haben Licht (der Licht-Pass sorgt dafür), leere Dachböden nicht
  const lightsAt = new Uint32Array(sy);
  for (let y = 0; y < sy; y++) {
    for (let z = box.min[2]; z <= box.max[2]; z++) for (let x = box.min[0]; x <= box.max[0]; x++) {
      if (c.emits(x, y, z) && col.builtTop[x + sx * z]! > y) lightsAt[y]!++;
    }
  }
  const lit = (feetY: number): boolean => {
    for (let y = feetY; y <= feetY + 3 && y < sy; y++) if (lightsAt[y]! > 0) return true;
    return false;
  };
  for (let y = Math.max(1, box.min[1]); y <= Math.min(sy - 2, box.max[1]); y++) {
    let n = 0;
    for (let z = box.min[2]; z <= box.max[2]; z++) for (let x = box.min[0]; x <= box.max[0]; x++) if (indoor(c, col, x, y, z)) n++;
    if (n > 0) counts.set(y, n);
  }
  const maxCount = Math.max(0, ...counts.values());
  const minCount = Math.max(8, Math.ceil(0.12 * maxCount));
  // Ohne jedes Licht (dunkle Welt) zählt nur die Fläche
  const anyLit = [...counts.keys()].some(lit);
  const picked: number[] = [];
  for (const [y, n] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    if (n < minCount || picked.length >= MAX_FLOORS) break;
    if (anyLit && !lit(y)) continue;
    if (picked.every((p) => Math.abs(p - y) >= 3)) picked.push(y);
  }
  picked.sort((a, b) => a - b);
  return picked.map((feetY, i) => {
    const next = picked[i + 1];
    const cutY = Math.max(feetY + 1, Math.min(feetY + 2, next === undefined ? Infinity : next - 2));
    const spot = interiorSpot(c, col, box, feetY);
    return { index: i + 1, feetY, cells: counts.get(feetY)!, cutY, ...(spot !== undefined ? { spot } : {}) };
  });
}

const SPOT_DIRS: ReadonlyArray<readonly [InteriorSpot['dir'], number, number]> = [
  ['north', 0, -1], ['northeast', 1, -1], ['east', 1, 0], ['southeast', 1, 1],
  ['south', 0, 1], ['southwest', -1, 1], ['west', -1, 0], ['northwest', -1, -1],
];

/**
 * Standort und Blickrichtung mit der größten sichtbaren Stehfläche in der größten Fläche der Etage. Mit `lit`: die
 * größte Fläche, in der mindestens eine Spalte Licht hat (bewohnter Raum statt dunkler Dachboden); ohne solche die
 * größte überhaupt.
 */
export function interiorSpotFromMask(
  mask: (x: number, z: number) => boolean, eyeFree: (x: number, z: number) => boolean, box: { x0: number; x1: number; z0: number; z1: number }, feetY: number,
  lit?: (x: number, z: number) => boolean,
): InteriorSpot | undefined {
  // größte 4er-Komponente
  const w = box.x1 - box.x0 + 1, d = box.z1 - box.z0 + 1;
  const comp = new Int32Array(w * d).fill(-1);
  let bestComp = -1, bestSize = 0, bestLit = false, id = 0;
  const cellsOfComp: number[][] = [];
  for (let z = 0; z < d; z++) {
    for (let x = 0; x < w; x++) {
      const k = x + w * z;
      if (comp[k] !== -1 || !mask(box.x0 + x, box.z0 + z)) continue;
      const cells: number[] = [];
      const stack = [k];
      comp[k] = id;
      while (stack.length > 0) {
        const i = stack.pop()!;
        cells.push(i);
        const cx = i % w, cz = Math.floor(i / w);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
          const j = nx + w * nz;
          if (comp[j] !== -1 || !mask(box.x0 + nx, box.z0 + nz)) continue;
          comp[j] = id;
          stack.push(j);
        }
      }
      cellsOfComp.push(cells.sort((a, b) => a - b));
      const hasLight = lit !== undefined && cells.some((i) => lit(box.x0 + (i % w), box.z0 + Math.floor(i / w)));
      if ((hasLight && !bestLit) || (hasLight === bestLit && cells.length > bestSize)) { bestSize = cells.length; bestComp = id; bestLit = hasLight; }
      id++;
    }
  }
  if (bestComp < 0 || bestSize < 4) return undefined;
  const cells = cellsOfComp[bestComp]!;
  const inComp = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < w && z < d && comp[x + w * z] === bestComp;
  // Kandidaten: alle Zellen (bei großen Flächen jede zweite), Richtung aus 8
  const step = cells.length > 400 ? 2 : 1;
  let best: InteriorSpot | undefined;
  let stamp = 0;
  const marks = new Uint32Array(w * d);
  for (let ci = 0; ci < cells.length; ci += step) {
    const k = cells[ci]!;
    const cx = k % w, cz = Math.floor(k / w);
    for (const [dir, dx, dz] of SPOT_DIRS) {
      stamp++;
      let score = 0;
      const base = Math.atan2(dz, dx);
      for (let r = -6; r <= 6; r++) {
        const a = base + (r / 6) * (35 * Math.PI / 180);
        const vx = Math.cos(a), vz = Math.sin(a);
        for (let t = 0.5; t <= 24; t += 0.35) {
          const fx = Math.floor(cx + 0.5 + vx * t), fz = Math.floor(cz + 0.5 + vz * t);
          if (!eyeFree(box.x0 + fx, box.z0 + fz)) break;
          if (fx < 0 || fz < 0 || fx >= w || fz >= d) break;
          const j = fx + w * fz;
          if (inComp(fx, fz) && marks[j] !== stamp) {
            marks[j] = stamp;
            score++;
          }
        }
      }
      // Gleichstand: erste Zelle, erste Richtung (stabil)
      if (best === undefined || score > best.score) best = { pos: [box.x0 + cx, feetY, box.z0 + cz], dir, score, area: cells.length };
    }
  }
  return best;
}

function interiorSpot(c: Cells, col: Columns, box: Box, feetY: number): InteriorSpot | undefined {
  const mask = (x: number, z: number): boolean => indoor(c, col, x, feetY, z);
  const eyeFree = (x: number, z: number): boolean => c.inside(x, feetY + 1, z) && passable(c.cls(x, feetY + 1, z)) && roofed(c, col, x, feetY, z);
  // Licht in der Spalte zwischen Boden und Decke (erster Vollblock): Laternen an hohen Balken, Kerzen auf Tischen;
  // auch in den Nachbarspalten (Laterne über dem Tisch, Feuerstelle – dort steht man nicht)
  const litColumn = (x: number, z: number): boolean => {
    for (let y = feetY; y <= feetY + 12 && c.inside(x, y, z); y++) {
      if (c.emits(x, y, z)) return true;
      if (y > feetY && c.cls(x, y, z) === 'full') return false;
    }
    return false;
  };
  const lit = (x: number, z: number): boolean => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (litColumn(x + dx, z + dz)) return true;
    return false;
  };
  return interiorSpotFromMask(mask, eyeFree, { x0: box.min[0], x1: box.max[0], z0: box.min[2], z1: box.max[2] }, feetY, lit);
}

// ---------------------------------------------------------------------------------------------- Türen

/** Sieht die Zelle (oder bis zu 3 weitere in Richtung `d`) den Himmel? Blätter und Bewuchs zählen als offen. */
function seesSky(c: Cells, x: number, y: number, z: number, d: readonly [number, number]): boolean {
  const sy = c.g.size[1];
  for (let s = 0; s < 4; s++) {
    const cx = x + d[0] * s, cz = z + d[1] * s;
    if (!c.inside(cx, y, cz)) return true; // Rand der Welt = draußen
    if (!passable(c.cls(cx, y, cz)) && c.cls(cx, y, cz) !== 'tall') return false; // Wand im Weg
    let open = true;
    for (let yy = y + 2; yy < sy; yy++) {
      if (c.occupied(cx, yy, cz) && !c.natural(cx, yy, cz)) { open = false; break; }
    }
    if (open) return true;
  }
  return false;
}

function findDoors(c: Cells): Door[] {
  const g = c.g;
  const [sx, sy, sz] = g.size;
  const doorStates = new Set<number>();
  g.palette.forEach((s, i) => {
    if (s.name.endsWith('_door') && s.properties['half'] !== 'upper') doorStates.add(i);
  });
  if (doorStates.size === 0) return [];
  const out: Door[] = [];
  for (let y = 0; y < sy; y++) {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) {
        const p = g.cells[gridIndex(g.size, x, y, z)]!;
        if (!doorStates.has(p)) continue;
        const s = g.palette[p]!;
        const facing = (s.properties['facing'] ?? 'north') as Dir;
        const step = DIR_STEP[facing] ?? DIR_STEP.north;
        const front = seesSky(c, x + step[0], y, z + step[1], step);
        const back = seesSky(c, x - step[0], y, z - step[1], [-step[0], -step[1]]);
        const outward: Dir | undefined = front === back ? undefined : front ? facing : opposite(facing);
        out.push({ pos: [x, y, z], name: s.name, ...(outward !== undefined ? { outward } : {}) });
      }
    }
  }
  return out;
}

const opposite = (d: Dir): Dir => (d === 'north' ? 'south' : d === 'south' ? 'north' : d === 'east' ? 'west' : 'east');

/**
 * W13-A (Runde 2): Nebenbauten ab dieser Größe (Spalten, z. B. die Scheune des Gehöfts). Eine Tür des Hauptbaus, die
 * auf so einen Nebenbau zeigt (Hoftür zwischen Haus und Scheune), ist nicht die Haustür – sonst stand die Augenhöhe im
 * Hof und zeigte vor allem die Scheune.
 */
const YARD_NEIGHBOUR_COLUMNS = 60;
/** Reichweite (Blöcke), in der ein Nebenbau vor der Tür als „gegenüber“ zählt. */
const YARD_REACH = 12;

function pickMainDoor(doors: readonly Door[], main: Box, neighbours: readonly Box[] = []): Door | undefined {
  const inMain = (d: Door): boolean => d.pos[0] >= main.min[0] - 1 && d.pos[0] <= main.max[0] + 1 && d.pos[2] >= main.min[2] - 1 && d.pos[2] <= main.max[2] + 1;
  const ext = doors.filter((d) => d.outward !== undefined);
  const inMainPool = ext.some(inMain) ? ext.filter(inMain) : ext;
  const facesNeighbour = (d: Door): boolean => {
    const [dx, dz] = DIR_STEP[d.outward!];
    for (let s = 1; s <= YARD_REACH; s++) {
      const x = d.pos[0] + dx * s, z = d.pos[2] + dz * s;
      if (neighbours.some((b) => x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2])) return true;
    }
    return false;
  };
  const pool = inMainPool.some((d) => !facesNeighbour(d)) ? inMainPool.filter((d) => !facesNeighbour(d)) : inMainPool;
  return [...pool].sort((a, b) => a.pos[1] - b.pos[1] || DIR_ORDER.indexOf(a.outward!) - DIR_ORDER.indexOf(b.outward!) || a.pos[0] - b.pos[0] || a.pos[2] - b.pos[2])[0];
}
