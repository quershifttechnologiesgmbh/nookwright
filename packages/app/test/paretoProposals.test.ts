/**
 * feat/pareto-proposals im App-Assistenten: Schalter-Standard, Kandidaten-Seeds (die ersten drei = bisherige Vorschläge)
 * und Gleichheit mit der Engine-Regel – derselbe Kandidat hat in App und `evaluateCandidate` (wie `building_propose` mit
 * pareto) denselben Zielvektor und dieselbe Wahl.
 */
import { describe, expect, it } from 'vitest';
import { REPO_CATALOG } from '@mcda/engine/node';
import { PARETO_POOL, evaluateCandidate, pickProposals } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const types = load.buildingTypes;
const ctx = { catalog: load.catalog!, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });
const node = nodeContext(REPO_CATALOG);

describe('Assistent: bewertete Vorschläge', () => {
  it('Schalter-Standard und Kandidaten: Pool beginnt mit den bisherigen drei Seeds', () => {
    expect(typeof bt.PARETO_DEFAULT).toBe('boolean');
    const seeds = bt.paretoSeeds(11);
    expect(seeds).toHaveLength(PARETO_POOL);
    expect(seeds.slice(0, 3)).toEqual(bt.proposalSeeds(11));
  });

  it('gleicher Kandidat → gleicher Zielvektor und gleiche Wahl wie die Engine-Regel (Node-Katalog, gleiche Lage)', () => {
    // Die App baut an ihrer Rasterlage (`placementOf`); die Einrichtungs-Seeds hängen an der Lage, darum vergleicht der
    // Test mit derselben Lage. Ohne Lage (Engine-API) ist es derselbe Ablauf an einer anderen Stelle der Welt.
    const def = types.get('tavern');
    const params = { ...bt.defaultParams(def, ctx.themes.ids(), 'medieval', NEW), size: 'M' as const };
    const seeds = bt.paretoSeeds(9, 4);
    const app = seeds.map((s) => bt.paretoCandidate(def, params, s, ctx));
    const nodeParams = { size: 'M' as const, front: params.front, themeId: params.themeId, at: bt.placementOf(def, params), surroundings: false };
    const eng = seeds.map((s) => evaluateCandidate(node.buildingTypes.get('tavern'), nodeParams, s, node));
    expect(app.map((c) => c.scores)).toEqual(eng.map((c) => c.scores));
    expect(app.map((c) => c.issues)).toEqual(eng.map((c) => c.issues));
    expect(pickProposals(app).picks).toEqual(pickProposals(eng).picks);
    expect(pickProposals(app).picks.map((p) => p.label)).toEqual(['beautiful', 'practical', 'balanced']);
  }, HEAVY_TIMEOUT);

  it('Review A6: „Übernehmen“ baut genau das bewertete Haus (gleiche Räume, gleiche Möbel, spielbar bleibt spielbar)', () => {
    const def = types.get('tavern');
    const params = { ...bt.defaultParams(def, ctx.themes.ids(), 'medieval', NEW), size: 'M' as const };
    const cands = bt.paretoSeeds(9, 4).map((s) => bt.paretoCandidate(def, params, s, ctx));
    const { picks } = pickProposals(cands);
    expect(picks).toHaveLength(3);
    const key = (ps: readonly { roomId: string; componentId: string; variantId?: string | undefined; pose: unknown }[]): string[] =>
      ps.map((p) => `${p.roomId}|${p.componentId}|${p.variantId ?? ''}|${JSON.stringify(p.pose)}`).sort();
    for (const pk of picks) {
      const c = cands[pk.index]!;
      expect(c.issues).toEqual([]);
      const { session } = bt.typeSession(def, params, c.seed, ctx, NEW);
      const rooms = (p: typeof session.project) => p.state.rooms.map((r) => `${r.floorIndex}|${r.roomTypeId}|${r.cells.size}`).sort();
      expect(rooms(session.project)).toEqual(rooms(c.project));
      expect(key(session.project.state.placements)).toEqual(key(c.project.state.placements));
    }
  }, HEAVY_TIMEOUT);
});
