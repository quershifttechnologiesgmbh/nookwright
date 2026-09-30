/**
 * Test-Orakel (aus spikes/algorithms/src/roof/skeleton.ts, nicht produktiv):
 * Straight-Skeleton-Höhen für rektilineare Polygone (auch mit Löchern) per exakter Wellenfront-Simulation
 * mit Gehrung – OHNE Distanztransformation. Rechnet in halben Blockeinheiten in Schritten Δt = ½, an jeder
 * Schrittgrenze Rasterisierung per Umlaufzahl und neue Konturverfolgung (Einschnürungen trennen sich).
 * Die Chebyshev-Herleitung im Produktivcode muss an jeder Zellmitte d − ½ ergeben.
 */
import { at, type Mask } from './masks.js';

type Pt = [number, number];
interface Loop {
  pts: Pt[];
}

function upsample(g: Mask): Mask {
  const w = g.w * 2;
  const d = g.d * 2;
  const m = new Uint8Array(w * d);
  for (let z = 0; z < g.d; z++)
    for (let x = 0; x < g.w; x++) {
      if (!g.m[z * g.w + x]) continue;
      m[2 * z * w + 2 * x] = 1;
      m[2 * z * w + 2 * x + 1] = 1;
      m[(2 * z + 1) * w + 2 * x] = 1;
      m[(2 * z + 1) * w + 2 * x + 1] = 1;
    }
  return { w, d, m };
}

/** Konturverfolgung: gerichtete Einheitskanten, Inneres rechts; an Einschnürungen Rechtsabbiegen bevorzugen. */
export function traceLoops(r: Mask): Loop[] {
  const edges: Array<{ x: number; z: number; dx: number; dz: number }> = [];
  const outAt = new Map<string, number[]>();
  const add = (x: number, z: number, dx: number, dz: number) => {
    const k = `${x},${z}`;
    (outAt.get(k) ?? outAt.set(k, []).get(k)!).push(edges.length);
    edges.push({ x, z, dx, dz });
  };
  for (let j = 0; j < r.d; j++)
    for (let i = 0; i < r.w; i++) {
      if (!r.m[j * r.w + i]) continue;
      if (!at(r, i, j - 1)) add(i, j, 1, 0);
      if (!at(r, i + 1, j)) add(i + 1, j, 0, 1);
      if (!at(r, i, j + 1)) add(i + 1, j + 1, -1, 0);
      if (!at(r, i - 1, j)) add(i, j + 1, 0, -1);
    }
  const succ = edges.map((e) => {
    const cand = outAt.get(`${e.x + e.dx},${e.z + e.dz}`) ?? [];
    const pref: Array<[number, number]> = [
      [-e.dz, e.dx],
      [e.dx, e.dz],
      [e.dz, -e.dx],
    ];
    for (const [px, pz] of pref) {
      const hit = cand.find((c) => edges[c]!.dx === px && edges[c]!.dz === pz);
      if (hit !== undefined) return hit;
    }
    throw new Error('open contour');
  });
  const used = new Uint8Array(edges.length);
  const loops: Loop[] = [];
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    const unit: Pt[] = [];
    for (let e = s; !used[e]; e = succ[e]!) {
      used[e] = 1;
      unit.push([edges[e]!.x, edges[e]!.z]);
    }
    loops.push({ pts: compress(unit) });
  }
  return loops;
}

function compress(pts: Pt[]): Pt[] {
  const n = pts.length;
  const res: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n]!;
    const b = pts[i]!;
    const c = pts[(i + 1) % n]!;
    if (Math.sign(b[0] - a[0]) !== Math.sign(c[0] - b[0]) || Math.sign(b[1] - a[1]) !== Math.sign(c[1] - b[1])) res.push(b);
  }
  return res;
}

function inwardNormal(a: Pt, b: Pt): Pt {
  return [-Math.sign(b[1] - a[1]), Math.sign(b[0] - a[0])];
}

/** Ein Zeitschritt Δt = ½: jede Ecke um n_in + n_out. */
export function stepLoop(loop: Loop): Loop {
  const n = loop.pts.length;
  return {
    pts: loop.pts.map((p, i) => {
      const n1 = inwardNormal(loop.pts[(i + n - 1) % n]!, p);
      const n2 = inwardNormal(p, loop.pts[(i + 1) % n]!);
      return [p[0] + n1[0] + n2[0], p[1] + n1[1] + n2[1]] as Pt;
    }),
  };
}

/** Rasterisierung per Umlaufzahl (nonzero) auf das Halbzellen-Raster. */
export function rasterize(loops: Loop[], w: number, d: number): Mask {
  const rows: Array<Array<[number, number]>> = Array.from({ length: d }, () => []);
  for (const loop of loops) {
    const n = loop.pts.length;
    for (let i = 0; i < n; i++) {
      const a = loop.pts[i]!;
      const b = loop.pts[(i + 1) % n]!;
      if (a[0] !== b[0] || a[1] === b[1]) continue;
      const sign = b[1] > a[1] ? -1 : 1;
      for (let j = Math.max(0, Math.min(a[1], b[1])); j < Math.min(d, Math.max(a[1], b[1])); j++) rows[j]!.push([a[0], sign]);
    }
  }
  const m = new Uint8Array(w * d);
  for (let j = 0; j < d; j++) {
    const edges = rows[j]!.sort((p, q) => p[0] - q[0]);
    let wind = 0;
    let k = edges.length - 1;
    for (let i = w - 1; i >= 0; i--) {
      while (k >= 0 && edges[k]![0] > i) {
        wind += edges[k]![1];
        k--;
      }
      if (wind !== 0) m[j * w + i] = 1;
    }
  }
  return { w, d, m };
}

/** Straight-Skeleton-Höhe (Blöcke) an jeder Zellmitte der Maske; NaN außerhalb. */
export function skeletonHeights(mask: Mask): Float64Array {
  let raster = upsample(mask);
  const lastInside = new Int32Array(mask.w * mask.d).fill(-1);
  let k = 0;
  for (;;) {
    let any = false;
    for (let z = 0; z < mask.d; z++)
      for (let x = 0; x < mask.w; x++) {
        if (!mask.m[z * mask.w + x]) continue;
        const i = 2 * x;
        const j = 2 * z;
        if (at(raster, i, j) && at(raster, i + 1, j) && at(raster, i, j + 1) && at(raster, i + 1, j + 1)) {
          lastInside[z * mask.w + x] = k;
          any = true;
        }
      }
    if (!any && !raster.m.some((v) => v !== 0)) break;
    raster = rasterize(traceLoops(raster).map(stepLoop), raster.w, raster.d);
    k++;
    if (k > 4 * (raster.w + raster.d)) throw new Error('skeleton simulation did not terminate');
  }
  const h = new Float64Array(mask.w * mask.d).fill(Number.NaN);
  for (let i = 0; i < h.length; i++) if (mask.m[i]) h[i] = (lastInside[i]! + 1) / 2;
  return h;
}

/** Euklidische Distanz vom Zellmittelpunkt zum Komplement (Kontrolle: rundet Innenecken ab). */
export function euclideanHeights(mask: Mask): Float64Array {
  const out = new Float64Array(mask.w * mask.d).fill(Number.NaN);
  for (let z = 0; z < mask.d; z++)
    for (let x = 0; x < mask.w; x++) {
      if (!mask.m[z * mask.w + x]) continue;
      const cx = x + 0.5;
      const cz = z + 0.5;
      let best = Infinity;
      for (let oz = -1; oz <= mask.d; oz++)
        for (let ox = -1; ox <= mask.w; ox++) {
          if (at(mask, ox, oz)) continue;
          const dx = Math.max(ox - cx, 0, cx - (ox + 1));
          const dz = Math.max(oz - cz, 0, cz - (oz + 1));
          best = Math.min(best, Math.hypot(dx, dz));
        }
      out[z * mask.w + x] = best;
    }
  return out;
}
