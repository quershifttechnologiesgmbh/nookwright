/**
 * Assistent ohne Doppel (W1, A8; Befund HANDOFF §6.3): Vorschläge mit gleichem Grundriss werden zusammengefasst und
 * ehrlich beschriftet. Gemessen mit den echten Bautypen: feste Vorlagen ohne Akzente ergeben für jeden Seed denselben
 * Plan, entworfene Typen (Taverne) unterscheiden sich (W9-G1: feste Vorlagen mit Akzenten je nach Seed auch).
 */
import { describe, expect, it } from 'vitest';
import type { BuildingPlan } from '@mcda/archetype';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import * as bt from '../src/buildingTypes.js';
import { planFingerprint, proposalGroups, proposalSummary } from '../src/ui/proposalGroups.js';
import * as uc from '../src/usecases.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const types = load.buildingTypes;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types };
const NEW = uc.shellStyle({ roof: uc.DEFAULT_ROOF });
const params = (id: string): bt.TypeParams => bt.defaultParams(types.get(id), ctx.themes.ids(), 'medieval', NEW);
/** Eine Runde wie im Assistenten: drei Seeds aus einer Basis, je ein Vorschlag. */
const round = (id: string, base: number) => bt.proposalSeeds(base).map((seed) => ({ seed, proposal: bt.proposal(types.get(id), params(id), seed, ctx, NEW) }));

describe('Fingerabdruck', () => {
  it('unabhängig von Seed, Name, Hinweisen und Schlüsselreihenfolge; Grundriss zählt', () => {
    const [a] = round('tavern', 11);
    const plan = a!.proposal.plan;
    const reordered = Object.fromEntries(Object.entries(plan).reverse()) as unknown as BuildingPlan;
    const renamed = { ...plan, seed: plan.seed + 1, attempt: 3, name: 'anders', hints: ['x'], warnings: [], quality: [] } as BuildingPlan;
    expect(planFingerprint(reordered)).toBe(planFingerprint(plan));
    expect(planFingerprint(renamed)).toBe(planFingerprint(plan));
    const fewer = { ...plan, rooms: plan.rooms.slice(1) } as BuildingPlan;
    expect(planFingerprint(fewer)).not.toBe(planFingerprint(plan));
  });
});

describe('Zusammenfassen', () => {
  it('feste Vorlage ohne Akzente (Halle): drei Seeds → eine Karte', () => {
    const slots = round('hall', 7);
    expect(proposalGroups(slots)).toEqual([{ index: 0, seeds: slots.map((s) => s.seed) }]);
  });

  // W9-G1 (2026-09-27): feste Vorlagen mit Baumasse-Akzenten (Quergiebel, Auskragung, Vorbau) würfeln deren Lage per
  // Seed – gleiche Grundrisse werden weiter zusammengefasst, verschiedene bleiben eigene Karten
  it('feste Vorlagen mit Akzenten (Beispielhaus, Zweistöckig, Fachwerk): eine Karte je verschiedenem Grundriss', () => {
    for (const id of ['house', 'twostory', 'timber']) {
      const slots = round(id, 7);
      const groups = proposalGroups(slots);
      const distinct = new Set(slots.map((s) => planFingerprint(s.proposal.plan))).size;
      expect(groups.length, id).toBe(distinct);
      expect(groups.flatMap((g) => g.seeds).sort(), id).toEqual(slots.map((s) => s.seed).sort());
    }
  });

  it('entworfener Bautyp (Taverne): drei verschiedene Grundrisse bleiben drei Karten', () => {
    const slots = round('tavern', 7);
    expect(proposalGroups(slots).map((g) => g.index)).toEqual([0, 1, 2]);
  });

  it('Doppel in der Mitte: erste Karte trägt beide Seeds; offene Vorschläge bleiben einzeln', () => {
    const [a, b] = round('tavern', 7);
    const slots = [a!, b!, { seed: 99, proposal: a!.proposal }, { seed: 100 }];
    expect(proposalGroups(slots)).toEqual([
      { index: 0, seeds: [a!.seed, 99] },
      { index: 1, seeds: [b!.seed] },
      { index: 3, seeds: [100] },
    ]);
  });
});

describe('Beschriftung (ehrlich statt „↻ 3 neue“ bei gleichen Plänen)', () => {
  it('feste Vorlage: eine Variante, kein Würfeln', () => {
    const s = proposalSummary(true, [{ index: 0, seeds: [1] }], 1, true);
    expect(s.heading).toBe('Vorschlag');
    expect(s.note).toMatch(/^Feste Vorlage – eine Variante/);
    expect(s.reroll).toBeUndefined();
  });

  it('alle gleich: „Nur eine Variante“, Knopf „↻ Neu würfeln“', () => {
    const s = proposalSummary(false, [{ index: 0, seeds: [1, 2, 3] }], 3, true);
    expect(s.note).toMatch(/Nur eine Variante/);
    expect(s.reroll?.label).toBe('↻ Neu würfeln');
  });

  it('einzelne Doppel: Hinweis, Knopf bleibt „↻ 3 neue“; unterschiedlich oder noch offen: kein Hinweis', () => {
    const two = proposalSummary(false, [{ index: 0, seeds: [1, 3] }, { index: 1, seeds: [2] }], 3, true);
    expect(two.note).toBe('2 gleiche Vorschläge zusammengefasst.');
    expect(two.reroll?.label).toBe('↻ 3 neue');
    const all = proposalSummary(false, [0, 1, 2].map((i) => ({ index: i, seeds: [i] })), 3, true);
    expect(all).toEqual({ heading: 'Vorschläge', reroll: { label: '↻ 3 neue', title: '3 neue Seeds würfeln' } });
    const pending = proposalSummary(false, [{ index: 0, seeds: [1, 2] }, { index: 2, seeds: [3] }], 3, false);
    expect(pending.note).toBeUndefined();
  });
});
