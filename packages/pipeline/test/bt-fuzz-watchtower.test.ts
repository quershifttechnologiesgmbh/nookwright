// Fuzz Bautyp watchtower (research/19 §7.8) – siehe buildingtype-fuzz.ts
// W4-B (27.09.2026, Review S6): dazu je Welt – der Ausguck ist von der Haustür zu Fuß erreichbar (Walker mit Leitern:
// Leitern je Geschoss, Leiter + Luke aus dem Turmzimmer), jede Leiter trägt eine Wand, keine Truhe unter einer Leiter.
import { expect } from 'vitest';
import type { Cell, HorizontalDir, Vec3 } from '@mcda/core';
import { fuzzType, ctx } from './buildingtype-fuzz.js';
import { Walker, standKey } from './walk.js';

const STEP: Readonly<Record<HorizontalDir, Cell>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

fuzzType('watchtower', (world, res, where) => {
  const vol = world.materialized.volume;
  let start: Vec3 | undefined;
  for (const r of world.shell.rooms.values()) {
    const d = r.doors.find((x) => x.isMain);
    if (d !== undefined) start = [d.inside[0] + 2 * STEP[d.toward][0], r.baseY, d.inside[1] + 2 * STEP[d.toward][1]];
  }
  expect(start, `${where}: Haustür`).toBeDefined();
  const walker = new Walker(vol, ctx.platform(res.project.state.targetVersion.name), { climb: true });
  const seen = walker.reach([start!]);
  const crown = world.surroundings.cells.filter((c) => c.roomId === 'fort:main-parapet');
  expect(crown.filter((c) => c.shape === 'trapdoor'), `${where}: Luke`).toHaveLength(1);
  const deck = crown.filter((c) => c.role === 'walkway').map((c): Vec3 => [c.pos[0], c.pos[1] + 1, c.pos[2]]).filter((p) => walker.canStand(p));
  expect(deck.length, `${where}: Ausguck begehbar`).toBeGreaterThan(8);
  expect(deck.filter((p) => !seen.has(standKey(p))).length, `${where}: Ausguck erreichbar`).toBe(0);
  for (const [id, r] of world.shell.rooms) {
    expect(r.interior.toArray().some(([x, z]) => seen.has(standKey([x, r.baseY, z]))), `${where}: Raum ${id}`).toBe(true);
  }
  const chest = world.shell.cells.filter((c) => c.shape === 'ladder').filter((c) => {
    const b: Vec3 = [c.pos[0], c.pos[1] - 1, c.pos[2]];
    return vol.contains(b) && /chest$/.test(vol.stateAt(b).name);
  });
  expect(chest.map((c) => c.pos.join(',')), `${where}: Truhe unter Leiter`).toEqual([]);
});
