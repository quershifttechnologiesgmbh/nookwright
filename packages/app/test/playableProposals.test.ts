/**
 * W8-E „Spielbare Vorschläge“ im Assistenten: `proposalRound` (derselbe Ablauf wie `useProposals`, am Stück) überspringt
 * unspielbare Kandidaten wie Doppel – mit derselben Regel und derselben Prüfung wie `building_propose`
 * (`playablePicks`/`playabilityIssues`, @mcda/pipeline). Reicht die Reserve nicht, trägt der Vorschlag seine Befunde und
 * die Karte zeigt „Pflichtobjekt fehlt: …“.
 *
 * Test-Katalog wie engine/test/playable.test.ts: im Turmzimmer 4 Eckregale als Mindestzahl (Wachturm M je nach Seed
 * unspielbar).
 */
import { describe, expect, it } from 'vitest';
import { Catalog } from '@mcda/catalog';
import { createEngine } from '@mcda/engine';
import { REPO_CATALOG } from '@mcda/engine/node';
import { distinctPicks, planLayoutKey } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import * as bt from '../src/buildingTypes.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const types = load.buildingTypes;
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });
const strictOf = (c: Catalog): Catalog => {
  const tower = c.roomType('tower_room');
  const strict = { ...tower, required: [{ ...tower.required[0]!, count: { perArea: 12, min: 4, max: 4 } }] };
  return Catalog.of(c.all(), c.roomTypeIds().map((id) => (id === 'tower_room' ? strict : c.roomType(id))));
};
const ctx = { catalog: load.catalog!, themes: load.themeCatalog!, types };
const strictCtx = { ...ctx, catalog: strictOf(load.catalog!) };
const params = (id: string, patch: Partial<bt.TypeParams> = {}): bt.TypeParams => ({ ...bt.defaultParams(types.get(id), ctx.themes.ids(), 'medieval', NEW), ...patch });

describe('Assistent: spielbare Vorschläge (W8-E)', () => {
  it('Standard-Katalog: Burg S und Wachturm L zeigen spielbare Vorschläge, dieselben wie ohne Prüfung', () => {
    for (const [id, size] of [['castle_compact', 'S'], ['watchtower', 'L']] as const) {
      const def = types.get(id);
      const p = params(id, { size });
      const round = bt.proposalRound(def, p, 101, ctx, NEW);
      expect(round.map((x) => x.issues), id).toEqual([[], [], []]);
      // alle spielbar → dieselbe Wahl wie ohne Prüfung (nur Doppel übersprungen, `distinctPicks`)
      const seeds = bt.proposalCandidates(def, 101);
      const keys = seeds.map((s) => planLayoutKey(bt.proposal(def, p, s, ctx, NEW).plan));
      expect(round.map((x) => x.seed)).toEqual(distinctPicks(keys, 3).map((i) => seeds[i]));
    }
  }, HEAVY_TIMEOUT);

  it('unspielbare Kandidaten werden übersprungen; reicht die Reserve nicht, mit Befund und Hinweis', () => {
    const def = types.get('watchtower');
    const p = params('watchtower', { size: 'M' });
    const seeds = bt.proposalCandidates(def, 2);
    const playable = seeds.map((s) => bt.proposalPlayability(def, p, s, strictCtx).length === 0);
    const round = bt.proposalRound(def, p, 2, strictCtx, NEW);
    expect(round).toHaveLength(3);
    // jeder gezeigte Vorschlag ist spielbar, solange die Reserve spielbare hergibt
    const shownPlayable = round.filter((r) => r.issues.length === 0).length;
    expect(shownPlayable).toBe(Math.min(3, playable.filter(Boolean).length));
    for (const r of round) expect(r.issues.length === 0).toBe(playable[seeds.indexOf(r.seed)]);
    // übersprungen wurde nur, wer unspielbar oder ein Doppel ist: jeder spielbare Kandidat mit neuem Grundriss vor dem
    // letzten gezeigten ist dabei
    const last = Math.max(...round.map((r) => seeds.indexOf(r.seed)));
    const shown = new Set(round.map((r) => planLayoutKey(r.plan)));
    const keyOf = (s: number): string => planLayoutKey(bt.proposal(def, p, s, strictCtx, NEW).plan);
    expect(seeds.slice(0, last + 1).filter((s, i) => playable[i] && !shown.has(keyOf(s)))).toEqual([]);
    // Hinweis für eine unspielbare Karte
    const bad = seeds.find((_, i) => !playable[i]);
    if (bad !== undefined) expect(bt.playabilityNotice(bt.proposalPlayability(def, p, bad, strictCtx), strictCtx)).toMatch(/^Pflichtobjekt fehlt: .+ \(Turmzimmer\)$/);
    // deterministisch
    expect(bt.proposalRound(def, p, 2, strictCtx, NEW).map((r) => r.seed)).toEqual(round.map((r) => r.seed));
  }, HEAVY_TIMEOUT);

  it('App und Engine: gleiche Befunde je Seed (Lage des Assistenten ändert die Spielbarkeit nicht)', () => {
    // App-Seeds sind nicht `% 2³¹` (bestehend, Review F-Pareto §4) – verglichen wird mit den Seeds der Engine: die App
    // prüft sie an ihrer Lage (`at`), die Engine ohne; beide mit `playabilityIssues`. Gleiche Befunde → gleiche Wahl.
    const engineCtx = nodeContext(REPO_CATALOG);
    const engine = createEngine({ ...engineCtx, catalog: strictOf(engineCtx.catalog) }, { cacheSize: 0 });
    const def = types.get('watchtower');
    const p = params('watchtower', { size: 'M' });
    for (const base of [2, 7]) {
      const r = engine.execute({ op: 'building_propose', input: { buildingTypeId: 'watchtower', size: 'M', seed: base } });
      expect(r.ok).toBe(true);
      const eng = (r.ok ? r.data : {}) as { proposals: Array<{ seed: number; playable: boolean }>; skipped: number[] };
      for (const x of eng.proposals) expect(bt.proposalPlayability(def, p, x.seed, strictCtx).length === 0, `${base}/${x.seed}`).toBe(x.playable);
      for (const seed of eng.skipped) expect(bt.proposalPlayability(def, p, seed, strictCtx).length, `${base}/${seed}`).toBeGreaterThan(0);
    }
  }, HEAVY_TIMEOUT);
});
