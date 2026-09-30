/**
 * K1 (Katalog Medieval): Fuzz über typische Raumgrößen (Außenmaß 7×6 … 12×9), Seeds, lichte Höhe 3 und 2,
 * alle Raumtypen. Je Raum: Pflichtobjekte (inkl. Signatur-Möbel) platziert, keine Warnung, 0 harte
 * Verstöße, 0 Spawn-Zellen nach dem Licht-Pass – plus Mechanik-Regeln aus research/10 §11 und Faktencheck.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { evalCount } from '@mcda/catalog';
import { CellSet, type Vec3 } from '@mcda/core';
import { renderAscii } from '@mcda/furnishing';
import { WorldView } from '@mcda/materialize';
import { generate, placedFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { lavaProblems } from './lava-rule.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

/** Signatur-Tags je Raumtyp (research/10 §0 Nr. 1, research/11). */
const SIGNATURE: Readonly<Record<string, readonly string[]>> = {
  bedroom: ['canopy_bed'],
  kitchen: ['hearth'],
  storage: ['storage_wall'],
  smithy: ['forge'],
  library: ['bookshelf_wall', 'lectern'],
  alchemy: ['brewing_counter'],
  tavern: ['bar_counter', 'tavern_table'],
};

/** Außenmaße (Wände inklusive). */
const SIZES: readonly (readonly [number, number])[] = [[7, 6], [8, 7], [9, 8], [10, 8], [12, 9]];

function singleRoom(version: keyof typeof TARGET_VERSIONS, type: string, w: number, d: number, seed: number, height = 3, themeId = 'medieval'): Project {
  const p = Project.create({ id: 'k1', name: 'K1', seed, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  return p;
}

const up = (p: Vec3, n = 1): Vec3 => [p[0], p[1] + n, p[2]];

/** Mechanik-Regeln auf der fertigen Welt (Faktencheck #1, #2, #8, #17; research/10 §11 #5). */
function assertMechanics(view: WorldView, where: string): void {
  const v = view.volume;
  for (const c of v.cells()) {
    const n = c.state.name;
    // Truhe öffnet nur ohne redstone-leitenden (vollen) Block darüber (Faktencheck #2)
    if (n === 'chest') expect(view.info(up(c.pos)).phys.cls, `${where}: Block über Truhe bei ${c.pos.join(',')}`).not.toBe('full');
    // kein erstickender Block direkt über dem Bett (Faktencheck #8)
    if (n.endsWith('_bed')) expect(view.info(up(c.pos)).phys.cls, `${where}: Block über Bett bei ${c.pos.join(',')}`).not.toBe('full');
    if (n.endsWith('_leaves')) expect(c.state.properties['persistent'], `${where}: Blätter nicht persistent`).toBe('true');
    expect(lavaProblems(v, c.pos as Vec3, n), `${where}: Lava nur versiegelt (research/10 §11 #5)`).toEqual([]);
    if (n === 'enchanting_table') {
      // Faktencheck #1: ≥ 15 Regale im 5×5-Ring (dy 0/+1), Zwischenzellen Luft
      let shelves = 0;
      for (const dy of [0, 1]) {
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
            const q: Vec3 = [c.pos[0] + dx, c.pos[1] + dy, c.pos[2] + dz];
            if (view.state(q).name !== 'bookshelf') continue;
            const between: Vec3 = [c.pos[0] + Math.trunc(dx / 2), c.pos[1] + dy, c.pos[2] + Math.trunc(dz / 2)];
            if (view.state(between).name === 'air') shelves++;
          }
        }
      }
      expect(shelves, `${where}: Zaubertisch mit ${shelves} wirksamen Regalen`).toBeGreaterThanOrEqual(15);
    }
  }
}

function check(p: Project, label: string): void {
  const world = generate(p, ctx);
  const room = p.state.rooms[0]!;
  const info = world.shell.rooms.get(room.id)!;
  const placements = p.state.placements.filter((x) => x.roomId === room.id);
  const ascii = renderAscii(info, placements.map((x) => placedFor(x, ctx.catalog)), (id) => ctx.catalog.get(id).tags);
  const where = `${label}\n${ascii}`;
  expect(world.warnings, where).toEqual([]);
  const tags = new Set(placements.flatMap((x) => ctx.catalog.get(x.componentId).tags));
  const rt = ctx.catalog.roomType(room.roomTypeId);
  for (const req of rt.required) {
    const [min] = evalCount(req.count, info.interior.size);
    if (min > 0) expect(req.tags.some((t) => tags.has(t)), `${where}\nPflicht ${req.tags.join('|')} fehlt`).toBe(true);
  }
  for (const t of SIGNATURE[room.roomTypeId] ?? []) expect(tags.has(t), `${where}\nSignatur ${t} fehlt`).toBe(true);
  const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
  expect(hard, `${where}\n${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
  expect(world.materialized.light.darkCells, where).toEqual([]);
  assertMechanics(new WorldView(world.materialized.volume, ctx.platform(p.state.targetVersion.name)), label);
}

const fits = (type: string, w: number, d: number): boolean => (w - 2) * (d - 2) >= ctx.catalog.roomType(type).minArea;

describe('K1-Fuzz: Signatur-Möbel in typischen Räumen (1.21.11, lichte Höhe 3)', () => {
  for (const type of Object.keys(SIGNATURE)) {
    it(`${type}: ${SIZES.map(([w, d]) => `${w}×${d}`).join(', ')} × 4 Seeds`, () => {
      for (const [w, d] of SIZES) {
        if (!fits(type, w, d)) continue;
        for (let seed = 0; seed < 4; seed++) check(singleRoom('1.21.11', type, w, d, seed), `${type} ${w}×${d} seed ${seed}`);
      }
    });
  }
});

describe('K1-Fuzz: niedrige Räume (lichte Höhe 2) und 26.3', () => {
  for (const type of Object.keys(SIGNATURE)) {
    it(`${type}: lichte Höhe 2 (1.21.11) und Höhe 3 (26.3, alle Themes)`, () => {
      for (const [w, d] of [[8, 7], [10, 8]] as const) {
        if (!fits(type, w, d)) continue;
        for (let seed = 0; seed < 3; seed++) check(singleRoom('1.21.11', type, w, d, seed, 2), `${type} ${w}×${d} h2 seed ${seed}`);
        for (const theme of ctx.themes.ids()) check(singleRoom('26.3', type, w, d, 5, 3, theme), `${type} ${w}×${d} 26.3 ${theme}`);
      }
    });
  }
});
