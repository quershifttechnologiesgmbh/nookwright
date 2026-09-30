/**
 * P04-Abnahme als Test (nicht nur als Mess-Skript): Beet-/Nutzpflanzen-Komponenten in `farm_room` und
 * `greenhouse` liegen **auf** (kein Schweben) und haben eine **begehbare Kante** (Bedienzugang);
 * dazu 0 dunkle Zellen. Gemessen an der fertigen Welt (`WorldView`).
 *
 * Beet-Teile über ihre Tags: `crop_plot`/`farm_bed` (Acker, im kleinen Raum durch die Kompaktform
 * `functional/berry_trellis`), `garden_bed` (Gewächshaus).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { WorldView } from '@mcda/materialize';
import { generate, placedFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const BEET = new Set(['crop_plot', 'farm_bed', 'garden_bed']);
/** Waagerechte Nachbarn (typisiert, damit `noUncheckedIndexedAccess` sauber bleibt). */
const NACHBARN: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function pruefe(type: string, w: number, d: number, seed: number, version: '1.21.11' | '26.3') {
  const p = Project.create({ id: 'p04', name: 'P04', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  const world = generate(p, ctx);
  const geom = world.shell.rooms.get(p.state.rooms[0]!.id)!;
  const view = new WorldView(world.materialized.volume, ctx.platform(p.state.targetVersion.name));
  const begehbar = (x: number, z: number): boolean =>
    geom.interior.has(x, z) &&
    view.info([x, geom.baseY, z]).phys.cls === 'air' &&
    view.info([x, geom.baseY + 1, z]).phys.cls === 'air' &&
    view.info([x, geom.baseY - 1, z]).phys.cls !== 'air';
  const beete = p.state.placements.filter((pl) => ctx.catalog.get(pl.componentId).tags.some((t) => BEET.has(t)));
  const ohneAuflage: string[] = [];
  const ohneKante: string[] = [];
  for (const pl of beete) {
    const cells = placedFor(pl, ctx.catalog).cells.map((c) => c.pos);
    const lowest = Math.min(...cells.map((c) => c[1]));
    if (!cells.filter((c) => c[1] === lowest).every((c) => view.info([c[0], c[1] - 1, c[2]]).phys.cls !== 'air')) ohneAuflage.push(pl.componentId);
    if (!cells.some((c) => NACHBARN.some(([dx, dz]) => begehbar(c[0] + dx, c[2] + dz)))) ohneKante.push(pl.componentId);
  }
  return { beete: beete.length, ohneAuflage, ohneKante, dunkel: world.materialized.light.darkCells.length, warnungen: world.warnings.length };
}

describe('P04: Beet liegt auf und hat eine begehbare Kante', () => {
  for (const type of ['farm_room', 'greenhouse']) {
    for (const [w, d] of [[9, 8], [16, 12]] as const) {
      it(`${type} ${w}×${d}: kein Schweben, Bedienzugang, 0 dunkle Zellen (beide Versionen)`, () => {
        for (const seed of [1, 7]) {
          for (const version of ['1.21.11', '26.3'] as const) {
            const r = pruefe(type, w, d, seed, version);
            const where = `${type} ${w}×${d} seed ${seed} ${version}`;
            expect(r.beete, `${where}: kein Beet-Teil gefunden`).toBeGreaterThan(0);
            expect(r.ohneAuflage, `${where}: Beet ohne Auflage`).toEqual([]);
            expect(r.ohneKante, `${where}: Beet ohne begehbare Kante`).toEqual([]);
            expect(r.dunkel, where).toBe(0);
            expect(r.warnungen, where).toBe(0);
          }
        }
      });
    }
  }
});
