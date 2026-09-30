/** Test-Grundrisse als Binärmasken (übernommen aus spikes/algorithms/src/shapes.ts, auf Uint8Array umgestellt). */

export interface Mask {
  readonly w: number;
  readonly d: number;
  readonly m: Uint8Array;
}

export const at = (g: Mask, x: number, z: number): number => (x < 0 || z < 0 || x >= g.w || z >= g.d ? 0 : g.m[z * g.w + x]!);

export function rectMask(w: number, d: number): Mask {
  return { w, d, m: new Uint8Array(w * d).fill(1) };
}

/** '#' (bzw. jedes Nicht-'.'-Zeichen) = drin. Einrückung wird entfernt. */
export function parseMask(ascii: string): Mask {
  const lines = ascii
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);
  const indent = Math.min(...lines.map((l) => /^\s*/.exec(l)![0].length));
  const rows = lines.map((l) => l.slice(indent));
  const w = Math.max(...rows.map((r) => r.length));
  const m = new Uint8Array(w * rows.length);
  rows.forEach((r, z) => {
    for (let x = 0; x < r.length; x++) if (r[x] !== '.' && r[x] !== ' ') m[z * w + x] = 1;
  });
  return { w, d: rows.length, m };
}

/** Legt die Maske mit Rand `p` in ein größeres Raster. */
export function pad(g: Mask, p: number): Mask {
  const w = g.w + 2 * p;
  const d = g.d + 2 * p;
  const m = new Uint8Array(w * d);
  for (let z = 0; z < g.d; z++) for (let x = 0; x < g.w; x++) m[(z + p) * w + x + p] = g.m[z * g.w + x]!;
  return { w, d, m };
}

export function fromRects(w: number, d: number, rects: Array<[number, number, number, number]>, holes: Array<[number, number, number, number]> = []): Mask {
  const m = new Uint8Array(w * d);
  for (const [x0, z0, rw, rd] of rects) for (let z = z0; z < z0 + rd; z++) for (let x = x0; x < x0 + rw; x++) m[z * w + x] = 1;
  for (const [x0, z0, rw, rd] of holes) for (let z = z0; z < z0 + rd; z++) for (let x = x0; x < x0 + rw; x++) m[z * w + x] = 0;
  return { w, d, m };
}

/** Deterministischer Zufallsgenerator (LCG) für Property-Tests. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Zufälliger rektilinearer Grundriss aus 1–4 Rechtecken, in 40 % der Fälle mit Innenhof. */
export function randomFootprint(rnd: () => number, w = 18, d = 14): Mask {
  const rects: Array<[number, number, number, number]> = [];
  const n = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const rw = 2 + Math.floor(rnd() * (w - 4));
    const rd = 2 + Math.floor(rnd() * (d - 4));
    rects.push([1 + Math.floor(rnd() * (w - rw - 1)), 1 + Math.floor(rnd() * (d - rd - 1)), rw, rd]);
  }
  const holes: Array<[number, number, number, number]> = [];
  if (rnd() < 0.4) {
    const hw = 1 + Math.floor(rnd() * 4);
    const hd = 1 + Math.floor(rnd() * 4);
    holes.push([2 + Math.floor(rnd() * (w - hw - 4)), 2 + Math.floor(rnd() * (d - hd - 4)), hw, hd]);
  }
  return fromRects(w, d, rects, holes);
}

export const SHAPES: Record<string, Mask> = {
  rect_9x5: rectMask(9, 5),
  rect_8x6: rectMask(8, 6),
  L: parseMask(`
    #####.....
    #####.....
    #####.....
    ##########
    ##########
    ##########
    ##########
  `),
  T: parseMask(`
    ###########
    ###########
    ###########
    ###########
    ....###....
    ....###....
    ....###....
    ....###....
  `),
  U: parseMask(`
    ####...####
    ####...####
    ####...####
    ####...####
    ###########
    ###########
    ###########
  `),
  U_narrow_gap: parseMask(`
    #####.#####
    #####.#####
    #####.#####
    ###########
    ###########
  `),
  plus: parseMask(`
    ....###....
    ....###....
    ....###....
    ###########
    ###########
    ###########
    ....###....
    ....###....
    ....###....
  `),
  ring: parseMask(`
    ###########
    ###########
    ###########
    ###.....###
    ###.....###
    ###.....###
    ###########
    ###########
    ###########
  `),
  ring_thick_small_court: parseMask(`
    #############
    #############
    #############
    #############
    #####...#####
    #####...#####
    #####...#####
    #############
    #############
    #############
    #############
  `),
  staircase: parseMask(`
    ###.......
    ###.......
    #####.....
    #####.....
    #######...
    #######...
    ##########
    ##########
  `),
  staircase_1: parseMask(`
    ##......
    ###.....
    ####....
    #####...
    ######..
    #######.
    ########
  `),
  H: parseMask(`
    ###...###
    ###...###
    #########
    #########
    ###...###
    ###...###
  `),
};
