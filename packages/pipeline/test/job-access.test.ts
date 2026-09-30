/**
 * P05-Abnahme als Test: In Küche, Redstone-Werkstatt und Schmiede hat **jede** Arbeits-/Automatikstation einen
 * **begehbaren Bedienpunkt** (Nachbarzelle auf Bodenhöhe), die Station liegt **auf** (kein Schweben) und es gibt
 * **0 dunkle Zellen**. Kleine/große Räume, zwei Seeds, beide Zielversionen.
 *
 * Nicht geprüft wird hier die **Gruppierung** (Abstand Station ↔ Lager): die ist gemessen und als offener Hebel
 * dokumentiert (`plan/spikes/P05_taetigkeitsgruppe_ausgangsmessung.md`) – sie wird mit Absicht **nicht** still
 * schöngeredet.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { WorldView } from '@mcda/materialize';
import { generate, placedFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const STATION = new Set(['hearth', 'forge', 'workbench', 'crafting', 'auto_smelter', 'item_sorter', 'hopper_line']);
const NACHBARN: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function pruefe(type: string, w: number, d: number, seed: number, version: '1.21.11' | '26.3') {
  const p = Project.create({ id: 'p05', name: 'P05', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  const world = generate(p, ctx);
  const geom = world.shell.rooms.get(p.state.rooms[0]!.id)!;
  const view = new WorldView(world.materialized.volume, ctx.platform(p.state.targetVersion.name));
  const begehbar = (x: number, z: number): boolean =>
    geom.interior.has(x, z) &&
    view.info([x, geom.baseY, z]).phys.cls === 'air' &&
    view.info([x, geom.baseY + 1, z]).phys.cls === 'air' &&
    view.info([x, geom.baseY - 1, z]).phys.cls !== 'air';
  const stationen = p.state.placements.filter((pl) => ctx.catalog.get(pl.componentId).tags.some((t) => STATION.has(t)));
  const ohneBedienpunkt: string[] = [];
  const ohneAuflage: string[] = [];
  for (const pl of stationen) {
    const cells = placedFor(pl, ctx.catalog).cells.map((c) => c.pos);
    const lowest = Math.min(...cells.map((c) => c[1]));
    if (!cells.filter((c) => c[1] === lowest).every((c) => view.info([c[0], c[1] - 1, c[2]]).phys.cls !== 'air')) ohneAuflage.push(pl.componentId);
    if (!cells.some((c) => NACHBARN.some(([dx, dz]) => begehbar(c[0] + dx, c[2] + dz)))) ohneBedienpunkt.push(pl.componentId);
  }
  return { stationen: stationen.length, ohneBedienpunkt, ohneAuflage, dunkel: world.materialized.light.darkCells.length, warnungen: world.warnings.length };
}

describe('P05: jede Arbeitsstation hat einen begehbaren Bedienpunkt', () => {
  for (const type of ['kitchen', 'workshop_redstone', 'smithy']) {
    for (const [w, d] of [[9, 8], [16, 12]] as const) {
      it(`${type} ${w}×${d}: Bedienpunkte erreichbar, keine schwebende Station, 0 dunkle Zellen`, () => {
        for (const seed of [1, 7]) {
          for (const version of ['1.21.11', '26.3'] as const) {
            const r = pruefe(type, w, d, seed, version);
            const where = `${type} ${w}×${d} seed ${seed} ${version}`;
            expect(r.stationen, `${where}: keine Arbeitsstation gefunden`).toBeGreaterThan(0);
            expect(r.ohneBedienpunkt, `${where}: Station ohne begehbaren Bedienpunkt`).toEqual([]);
            expect(r.ohneAuflage, `${where}: Station ohne Auflage`).toEqual([]);
            expect(r.dunkel, where).toBe(0);
            expect(r.warnungen, where).toBe(0);
          }
        }
      });
    }
  }
});
