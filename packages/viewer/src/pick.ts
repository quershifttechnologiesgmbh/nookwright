/**
 * Auswahl per Klick als reine Mathematik (ohne DOM, testbar in Node):
 * Bildschirmpunkt → Strahl der Orbit-Kamera (gleiche Projektion wie die Renderer, `FOV_Y`) → erste belegte Zelle
 * (Voxel-DDA nach Amanatides & Woo). Dazu der Auswahlrahmen als Liniengeometrie.
 * Koordinaten: Strukturkoordinaten des Renderers (0 … size, also Welt minus `origin` des Volumens).
 */
import { FOV_Y, orbitAxes, orbitEye, type Orbit } from './camera.js';
import type { Vec3 } from './port.js';

export interface Ray {
  readonly origin: Vec3;
  /** Einheitsvektor */
  readonly dir: Vec3;
}

/** Pixel im Element (links oben = 0,0) → normierte Gerätekoordinaten (−1 … 1, y nach oben). */
export function toNdc(px: number, py: number, width: number, height: number): readonly [number, number] {
  return [(px / Math.max(1, width)) * 2 - 1, 1 - (py / Math.max(1, height)) * 2];
}

/** Strahl durch den Bildpunkt (NDC) für eine Orbit-Kamera; `aspect` = Breite / Höhe. */
export function orbitRay(o: Orbit, ndcX: number, ndcY: number, aspect: number): Ray {
  const { right, up, back } = orbitAxes(o);
  const t = Math.tan(FOV_Y / 2);
  const sx = ndcX * t * aspect;
  const sy = ndcY * t;
  const d: Vec3 = [
    -back[0] + right[0] * sx + up[0] * sy,
    -back[1] + right[1] * sx + up[1] * sy,
    -back[2] + right[2] * sx + up[2] * sy,
  ];
  const len = Math.hypot(d[0], d[1], d[2]);
  return { origin: orbitEye(o), dir: [d[0] / len, d[1] / len, d[2] / len] };
}

export interface GridHit {
  /** Getroffene Zelle (ganzzahlig, Strukturkoordinaten) */
  readonly cell: Vec3;
  /** Abstand vom Strahlursprung bis zum Eintritt in die Zelle */
  readonly distance: number;
}

/**
 * Erste Zelle im Gitter [0, size), für die `solid` wahr ist, entlang des Strahls (DDA). Startet der Strahl außerhalb,
 * beginnt die Suche am Eintritt in den Quader. `undefined`, wenn nichts getroffen wird.
 */
export function raycastGrid(ray: Ray, size: Vec3, solid: (x: number, y: number, z: number) => boolean): GridHit | undefined {
  // Eintritt/Austritt aus dem Quader (Slab-Verfahren)
  let tEnter = 0;
  let tExit = Infinity;
  for (let k = 0; k < 3; k++) {
    const o = ray.origin[k]!, d = ray.dir[k]!, max = size[k]!;
    if (Math.abs(d) < 1e-12) {
      if (o < 0 || o >= max) return undefined;
      continue;
    }
    let t0 = (0 - o) / d, t1 = (max - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tEnter = Math.max(tEnter, t0);
    tExit = Math.min(tExit, t1);
  }
  if (tEnter > tExit) return undefined;

  const start = tEnter + 1e-7;
  const p = [ray.origin[0] + ray.dir[0] * start, ray.origin[1] + ray.dir[1] * start, ray.origin[2] + ray.dir[2] * start];
  const cell = [0, 1, 2].map((k) => Math.min(size[k]! - 1, Math.max(0, Math.floor(p[k]!)))) as [number, number, number];
  const stepDir = [0, 1, 2].map((k) => (ray.dir[k]! > 0 ? 1 : ray.dir[k]! < 0 ? -1 : 0));
  const tDelta = [0, 1, 2].map((k) => (stepDir[k] === 0 ? Infinity : Math.abs(1 / ray.dir[k]!)));
  const tMax = [0, 1, 2].map((k) => {
    if (stepDir[k] === 0) return Infinity;
    const boundary = stepDir[k]! > 0 ? cell[k]! + 1 : cell[k]!;
    return start + (boundary - p[k]!) / ray.dir[k]!;
  });
  let t = start;
  const limit = size[0] + size[1] + size[2] + 3;
  for (let n = 0; n < limit; n++) {
    if (solid(cell[0], cell[1], cell[2])) return { cell: [cell[0], cell[1], cell[2]], distance: Math.max(0, t) };
    const k = tMax[0]! < tMax[1]! ? (tMax[0]! < tMax[2]! ? 0 : 2) : tMax[1]! < tMax[2]! ? 1 : 2;
    cell[k] = cell[k]! + stepDir[k]!;
    if (cell[k]! < 0 || cell[k]! >= size[k]!) return undefined;
    t = tMax[k]!;
    tMax[k] = tMax[k]! + tDelta[k]!;
  }
  return undefined;
}

/** Achsenparalleler Quader aus Zellen (inklusive `min` … `max`). */
export interface CellBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * Die 12 Kanten eines Zellquaders als Linien (je Punkt x, y, z, r, g, b – Format der Rasterlinien des
 * beleuchteten Renderers), um `pad` nach außen versetzt, damit der Rahmen nicht in den Flächen flimmert.
 */
export function boxLines(box: CellBox, color: readonly [number, number, number], pad = 0.03): Float32Array {
  const a = [box.min[0] - pad, box.min[1] - pad, box.min[2] - pad];
  const b = [box.max[0] + 1 + pad, box.max[1] + 1 + pad, box.max[2] + 1 + pad];
  const corner = (i: number): number[] => [(i & 1) === 0 ? a[0]! : b[0]!, (i & 2) === 0 ? a[1]! : b[1]!, (i & 4) === 0 ? a[2]! : b[2]!];
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if ((i & bit) !== 0) continue;
      out.push(...corner(i), ...color, ...corner(i | bit), ...color);
    }
  }
  return new Float32Array(out);
}
