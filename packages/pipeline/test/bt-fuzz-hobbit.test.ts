// Fuzz Bautyp hobbit (BT16, Lage buried) – siehe buildingtype-fuzz.ts. Dazu je Welt: Hügel dicht über dem Dach, keine
// Erde und keine Pflanzen im Innenraum, Front frei (Türen und Fenster nur vorn, davor Luft, Vorplatz nicht überdeckt),
// Gras nur unter Luft oder Pflanzen, keine schwebende Erde.
import { expect } from 'vitest';
import type { ShellCell } from '@mcda/blueprint';
import { key3, type HorizontalDir, type Vec3 } from '@mcda/core';
import { fuzzType } from './buildingtype-fuzz.js';

const STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const at = (p: Vec3, d: HorizontalDir, dy = 0): Vec3 => [p[0] + STEP[d][0], p[1] + dy, p[2] + STEP[d][1]];

fuzzType('hobbit', (world, _res, where) => {
  // world.shell enthält die Zusatz-Zellen (Gelände, Pflanzen) – die Hülle allein ohne sie
  const shell = { ...world.shell, cells: world.shell.cells.filter((c) => c.kind !== 'terrain' && c.kind !== 'plant' && c.kind !== 'fort') };
  const setting = shell.settings?.find((s) => s.kind === 'buried');
  expect(setting, `${where}: Lage buried fehlt in der Hülle`).toBeDefined();
  const front = setting!.front!;
  const cover = setting!.cover!;
  const hull = new Map(shell.cells.map((c) => [key3(c.pos), c] as const));
  const around = new Map(world.surroundings.cells.map((c) => [key3(c.pos), c] as const));
  const terrain = (p: Vec3): ShellCell | undefined => {
    const c = around.get(key3(p));
    return c?.kind === 'terrain' ? c : undefined;
  };
  // Bodenplatte des Erdgeschosses (ein Unterbau, feat/underground, liegt tiefer und zählt nicht zum Vorplatz)
  const y0 = Math.min(...[...shell.rooms.values()].filter((r) => r.floorIndex >= 0).map((r) => r.baseY - 1));

  // 1 Hügel dicht: auf der obersten Hüllzelle jeder Spalte liegen `cover` Erdlagen (keine Löcher ins Innere)
  const colTop = new Map<string, number>();
  for (const c of shell.cells) colTop.set(`${c.pos[0]},${c.pos[2]}`, Math.max(colTop.get(`${c.pos[0]},${c.pos[2]}`) ?? -Infinity, c.pos[1]));
  const holes: string[] = [];
  for (const [x, z] of setting!.footprint) {
    const t = colTop.get(`${x},${z}`)!;
    for (let k = 1; k <= cover; k++) if (terrain([x, t + k, z]) === undefined) holes.push(`${x},${t + k},${z}`);
  }
  expect(holes, `${where}: Löcher im Hügel`).toEqual([]);

  // 2 keine Erde, keine Pflanzen im Innenraum
  const inside: string[] = [];
  for (const r of shell.rooms.values()) {
    for (const [x, z] of r.interior) for (let y = r.baseY; y < r.baseY + r.height; y++) if (around.has(key3([x, y, z]))) inside.push(`${r.roomId} ${x},${y},${z}`);
  }
  expect(inside, `${where}: Gelände im Innenraum`).toEqual([]);

  // 3 Front frei: Außentüren nur vorn mit 2 hoch Luft davor, Fenster nur in der Front mit Luft davor, Vorplatz auf y0
  const blocked = (p: Vec3): boolean => hull.has(key3(p)) || around.has(key3(p));
  for (const c of shell.cells) {
    if (c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower') {
      expect(c.orient.facing, `${where}: Außentür ${c.pos} nicht in der Front`).toBe(front);
      expect([blocked(at(c.pos, front)), blocked(at(c.pos, front, 1))], `${where}: vor der Tür ${c.pos}`).toEqual([false, false]);
    }
    if (c.kind === 'window') {
      const ahead = at(c.pos, front);
      expect(setting!.footprint.has(ahead[0], ahead[2]) || blocked(ahead), `${where}: Fenster ${c.pos} nicht frei in der Front`).toBe(false);
    }
  }
  const plane = Math.max(...setting!.footprint.toArray().map(([x, z]) => x * STEP[front][0] + z * STEP[front][1]));
  const yard: string[] = [];
  for (const [x, z] of setting!.footprint) {
    if (x * STEP[front][0] + z * STEP[front][1] !== plane) continue;
    // W16-C (2026-09-28, plan/spikes/W16C_erdhaus.md): die Moosnarbe auf dem Bogenband liegt über Hüllzellen derselben
    // Spalte (auf dem Band, nicht im Vorplatz) – sie zählt nicht
    const px = x + STEP[front][0], pz = z + STEP[front][1];
    for (let y = y0 + 1; y <= y0 + 6; y++) {
      const onBand = Array.from({ length: y - y0 - 1 }, (_, k) => y0 + 1 + k).some((yy) => hull.has(key3([px, yy, pz])));
      if (terrain([px, y, pz]) !== undefined && !onBand) yard.push(`${x},${y},${z}`);
    }
  }
  expect(yard, `${where}: Vorplatz überdeckt`).toEqual([]);

  // 4 Gras nur unter Luft oder Pflanzen; 5 keine schwebende Erde (unter jeder Geländezelle Gelände oder Hülle)
  const bottom = world.surroundings.site!.bottom;
  const bad: string[] = [];
  for (const c of world.surroundings.cells) {
    if (c.kind !== 'terrain') continue;
    const up: Vec3 = [c.pos[0], c.pos[1] + 1, c.pos[2]];
    const down: Vec3 = [c.pos[0], c.pos[1] - 1, c.pos[2]];
    if (c.role === 'ground_grass' && (terrain(up) !== undefined || hull.has(key3(up)))) bad.push(`Gras bedeckt ${c.pos}`);
    if (c.pos[1] > bottom && terrain(down) === undefined && !hull.has(key3(down))) bad.push(`schwebt ${c.role} ${c.pos}`);
  }
  expect(bad.slice(0, 5), where).toEqual([]);
});
