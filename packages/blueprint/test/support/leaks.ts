/** Dichtheit einer Hülle in Halbblöcken (Tests Dach-Paket RF und Gauben B2). */
import type { Shell } from '../../src/shell/types.js';

const key = (p: readonly number[]): string => p.join(',');

/**
 * Lichtdichte in Halbzellen: jede Zelle = untere und obere Hälfte. Stufe unten füllt die untere, Stufe oben die obere,
 * Treppen (half bottom) gelten als unten voll + oben voll (Rückseite und Unterseite sind volle Flächen), umgedrehte
 * Treppen ebenso; alles andere füllt beide. Luft-Hälften verbinden sich waagerecht (gleiche Hälfte) und senkrecht.
 * Ergebnis: Positionen über Decken, deren untere Hälfte von außen (Rand der Box) erreichbar ist.
 */
export function halfLeaks(shell: Shell): string[] {
  const lo = [0, 1, 2].map((k) => Math.min(...shell.cells.map((c) => c.pos[k]!)) - 1) as [number, number, number];
  const size = [0, 1, 2].map((k) => Math.max(...shell.cells.map((c) => c.pos[k]!)) + 2 - lo[k]!) as [number, number, number];
  const [W, H, D] = size;
  /** Halbzelle (x, y, z, h) → Index; h = 0 untere, 1 obere Hälfte. */
  const at = (x: number, y: number, z: number, h: number): number => (((y - lo[1]) * D + (z - lo[2])) * W + (x - lo[0])) * 2 + h;
  const solid = new Uint8Array(W * H * D * 2);
  for (const c of shell.cells) {
    const [x, y, z] = c.pos;
    if (!(c.shape === 'slab' && c.orient?.half === 'top')) solid[at(x, y, z, 0)] = 1;
    if (!(c.shape === 'slab' && c.orient?.half !== 'top')) solid[at(x, y, z, 1)] = 1;
  }
  const inBox = (x: number, y: number, z: number): boolean => x >= lo[0] && y >= lo[1] && z >= lo[2] && x < lo[0] + W && y < lo[1] + H && z < lo[2] + D;
  const seen = new Uint8Array(solid.length);
  const queue: number[] = [at(lo[0], lo[1], lo[2], 0)];
  seen[queue[0]!] = 1;
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q]!;
    const h = v & 1;
    const cell = v >> 1;
    const x = (cell % W) + lo[0];
    const z = (Math.floor(cell / W) % D) + lo[2];
    const y = Math.floor(cell / (W * D)) + lo[1];
    const next: ReadonlyArray<readonly [number, number, number, number]> = [
      [x + 1, y, z, h], [x - 1, y, z, h], [x, y, z + 1, h], [x, y, z - 1, h],
      h === 0 ? [x, y, z, 1] : [x, y + 1, z, 0], h === 0 ? [x, y - 1, z, 1] : [x, y, z, 0],
    ];
    for (const [nx, ny, nz, nh] of next) {
      if (!inBox(nx, ny, nz)) continue;
      const k = at(nx, ny, nz, nh);
      if (solid[k] === 1 || seen[k] === 1) continue;
      seen[k] = 1;
      queue.push(k);
    }
  }
  return shell.cells.filter((c) => c.kind === 'ceiling' && inBox(c.pos[0], c.pos[1] + 1, c.pos[2]) && seen[at(c.pos[0], c.pos[1] + 1, c.pos[2], 0)] === 1).map((c) => key(c.pos));
}
