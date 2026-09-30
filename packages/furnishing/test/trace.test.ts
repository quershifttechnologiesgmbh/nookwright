/**
 * Beobachter `FurnishOptions.trace` (Erklärvideo, 27.09.2026) ist rein lesend: Mit und ohne `trace` richtet der Solver
 * jeden Raum einer echten Taverne bitgleich ein (Platzierungen, Warnungen, Qualität). Dazu: `cheapReason` ist genau
 * `cheapValid`, und `explainPoses` enthält als gültige Posen genau die von `enumeratePoses`.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { furnishingGeometry, projectFromBuildingType, shellFor, styleChainOf, themeFor } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { expandComponent, explainPoses, furnishRoom, type FurnishResult, type FurnishTraceEvent } from '../src/index.js';
import { enumeratePoses } from '../src/rules.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

/** Taverne (Seed 83): Schankraum, Küche, Gästezimmer – in einem Gästezimmer platziert der Solver ein Bett per Backtracking. */
function tavern() {
  const res = projectFromBuildingType(ctx.buildingTypes.get('tavern'), {
    themeId: 'nordic', targetVersion: TARGET_VERSIONS['1.21.11'], surroundings: false, rerollCount: 0,
  }, 83, ctx);
  return { project: res.project, shell: shellFor(res.project, res.build, themeFor(res.project, ctx)) };
}

const view = (r: FurnishResult): string => JSON.stringify({ placements: r.placements, warnings: r.warnings, quality: r.quality });

describe('trace (Beobachter des Solvers)', () => {
  it('mit und ohne trace bitgleich, jeder Raum; Ereignisse kommen an', () => {
    const { project, shell } = tavern();
    const styles = styleChainOf(project, ctx);
    const seen = new Set<FurnishTraceEvent['type']>();
    for (const room of project.state.rooms) {
      const info = shell.rooms.get(room.id);
      if (info === undefined) continue;
      const rt = ctx.catalog.roomType(room.roomTypeId);
      const opts = { seed: project.roomSeed(room.id), dataVersion: project.state.targetVersion.dataVersion, styles };
      const plain = furnishRoom(furnishingGeometry(info), rt, ctx.catalog, opts);
      let chosen: FurnishResult | undefined;
      const traced = furnishRoom(furnishingGeometry(info), rt, ctx.catalog, {
        ...opts,
        trace: (e) => {
          seen.add(e.type);
          if (e.type === 'chosen') chosen = e.result;
        },
      });
      expect(view(traced)).toBe(view(plain));
      expect(chosen).toBe(traced);
    }
    for (const t of ['run-start', 'order', 'item', 'candidates', 'try', 'commit', 'run-end', 'chosen'] as const) expect(seen.has(t)).toBe(true);
  }, HEAVY_TIMEOUT);

  it('explainPoses: gültig sind genau die Posen von enumeratePoses (gleiche Reihenfolge), sonst mit Grund', () => {
    const { project, shell } = tavern();
    const room = project.state.rooms.find((r) => r.roomTypeId === 'guest_room')!;
    const info = shell.rooms.get(room.id)!;
    let checked = 0;
    furnishRoom(furnishingGeometry(info), ctx.catalog.roomType(room.roomTypeId), ctx.catalog, {
      seed: project.roomSeed(room.id), dataVersion: project.state.targetVersion.dataVersion, styles: styleChainOf(project, ctx),
      trace: (e) => {
        if (e.type !== 'candidates' || checked >= 3) return;
        const byDef = new Map(e.candidates.map((c) => [c.componentId + '#' + (c.variantId ?? ''), c]));
        for (const c of byDef.values()) {
          const def = ctx.catalog.get(c.componentId);
          const exp = expandComponent(def, c.variantId);
          const all = explainPoses(def, exp, e.analysis, e.occ);
          const valid = all.filter((v) => v.reason === undefined).map((v) => JSON.stringify(v.placed.pose));
          expect(valid).toEqual(enumeratePoses(def, exp, e.analysis, e.occ).map((p) => JSON.stringify(p.pose)));
          expect(all.filter((v) => v.reason !== undefined).length + valid.length).toBe(all.length);
        }
        checked++;
      },
    });
    expect(checked).toBeGreaterThan(0);
  }, HEAVY_TIMEOUT);
});
