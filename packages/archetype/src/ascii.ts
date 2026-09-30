/** ASCII-Ansicht eines Bauplans je Etage (Berichte, Tests): Buchstabe je Raum, `^`/`v` Treppe hinauf/hinab, Norden oben. */
import type { BuildingPlan } from './plan.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const STEP = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;

export function renderPlan(plan: BuildingPlan): string {
  const all = plan.rooms.flatMap((r) => r.cells.toArray());
  const x0 = Math.min(...all.map((c) => c[0]));
  const z0 = Math.min(...all.map((c) => c[1]));
  const x1 = Math.max(...all.map((c) => c[0]));
  const z1 = Math.max(...all.map((c) => c[1]));
  const out: string[] = [];
  for (const f of [...plan.floors].reverse()) {
    const rooms = plan.rooms.filter((r) => r.floor === f.index);
    if (rooms.length === 0) continue;
    const grid = Array.from({ length: z1 - z0 + 1 }, () => Array.from({ length: x1 - x0 + 1 }, () => ' '));
    rooms.forEach((r, i) => {
      for (const [x, z] of r.cells) grid[z - z0]![x - x0] = LETTERS[i % LETTERS.length]!;
    });
    for (const s of plan.stairs) {
      const rise = s.type === 'ladder' ? 1 : (plan.floors.find((x) => x.index === s.floor)?.height ?? 3) + 1;
      const mark = s.floor === f.index ? '^' : s.floor + 1 === f.index ? 'v' : undefined;
      if (mark === undefined) continue;
      for (let k = 0; k < rise; k++) {
        const x = s.origin[0] + STEP[s.facing][0] * (s.type === 'ladder' ? 0 : k);
        const z = s.origin[1] + STEP[s.facing][1] * (s.type === 'ladder' ? 0 : k);
        if (grid[z - z0]?.[x - x0] !== undefined) grid[z - z0]![x - x0] = mark;
      }
    }
    const legend = rooms.map((r, i) => `${LETTERS[i % LETTERS.length]}=${r.roomTypeId}${r.volumeId !== 'v0' ? `@${r.volumeId}` : ''}`).join(' ');
    out.push(`Etage ${f.index} (lichte Höhe ${f.height}): ${legend}`, ...grid.map((row) => `  ${row.join('')}`));
  }
  return out.join('\n');
}
