/**
 * feat/pareto-proposals: Mehrziel-Vorschläge (plan/spikes/F_pareto_proposals.md).
 * - Front und Wahl rein (synthetische Vektoren): Dominanz, Beschriftungen, Spielbarkeit als harter Filter, Grundriss-Vielfalt.
 * - Echte Bautypen: deterministisch, drei verschiedene, spielbare Vorschläge mit verschiedenen Vektoren; gebaut mit
 *   `generateBase` ohne harte Verstöße.
 */
import { fileURLToPath } from 'node:url';
import { hashSeed } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_OBJECTIVES, dominates, evaluateCandidate, generateBase, needsReserve, noPlayableNotice, playabilityIssues, playabilityKinds, paretoFront, paretoProposals, pickProposals, projectFromBuildingType, vectorOf,
  withoutPilastersForTheme, type ProposalCandidate, type ScoreVector,
} from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

const vec = (v: Partial<ScoreVector>): ScoreVector => ({
  interior: 0.5, facade: 0.5, daylight: 0.5, walkways: 0.5, access: 0.5, capacity: 0.5, compact: 0.5, ...v,
});
const cand = (seed: number, scores: ScoreVector, layout = `L${seed}`, issues: ProposalCandidate['issues'] = []): ProposalCandidate => ({
  seed, layout, scores, issues, findings: issues.map((issue) => ({ issue })), plan: undefined as never, project: undefined as never,
  raw: { area: 100, rooms: 1, windowCells: 10, profileShare: 0.2, f4: 2, storage: 1, work: 1, meanSeconds: 1, corridorShare: 0 },
});

describe('Pareto-Front', () => {
  it('Dominanz: nie schlechter, einmal besser; gleiche Vektoren dominieren sich nicht', () => {
    expect(dominates([1, 1], [1, 0])).toBe(true);
    expect(dominates([1, 0], [0, 1])).toBe(false);
    expect(dominates([1, 1], [1, 1])).toBe(false);
    expect(paretoFront([[1, 0], [0, 1], [0.5, 0.5], [0.4, 0.4], [1, 0]])).toEqual([0, 1, 2, 4]);
  });

  it('Wahl: schön/praktisch/ausgewogen aus der Front, unspielbare nie, Grundrisse verschieden', () => {
    const cands = [
      cand(0, vec({ interior: 0.9, facade: 0.9, daylight: 0.9, walkways: 0.2, access: 0.2, capacity: 0.2, compact: 0.2 })),
      cand(1, vec({ interior: 0.2, facade: 0.2, daylight: 0.2, walkways: 0.9, access: 0.9, capacity: 0.9, compact: 0.9 })),
      cand(2, vec({ interior: 0.6, facade: 0.6, daylight: 0.6, walkways: 0.6, access: 0.6, capacity: 0.6, compact: 0.6 })),
      cand(3, vec({ interior: 0.5, facade: 0.5, daylight: 0.5, walkways: 0.5, access: 0.5, capacity: 0.5, compact: 0.5 })),
      // schöner und praktischer als alle – aber unspielbar: nie gewählt
      cand(4, vec({ interior: 1, facade: 1, daylight: 1, walkways: 1, access: 1, capacity: 1, compact: 1 }), 'L4', ['unreachable']),
    ];
    const { front, picks } = pickProposals(cands);
    expect(front).toEqual([0, 1, 2]);
    expect(picks.map((p) => [p.label, p.index])).toEqual([['beautiful', 0], ['practical', 1], ['balanced', 2]]);
    for (const p of picks) expect(p.reason.length).toBeGreaterThan(20);
    expect(picks[0]!.reason).toMatch(/^Schönste Wahl: /);
    expect(picks[1]!.reason).toMatch(/^Praktischste Wahl: /);
    expect(picks[2]!.reason).toMatch(/^Guter Kompromiss: /);
  });

  it('neuer Grundriss vor der Front (dominiert, aber anders); gleicher Grundriss füllt nur auf', () => {
    const a = pickProposals([
      cand(0, vec({ interior: 0.9 }), 'A'),
      cand(1, vec({ interior: 0.8, access: 0.9 }), 'A'),
      cand(2, vec({ access: 0.8 }), 'B'),
    ]);
    expect(a.picks.map((p) => p.index)).toEqual([0, 2, 1]);
    // Reserve nur bei einigen, aber zu wenigen spielbaren (Review A3)
    expect(needsReserve([cand(0, vec({}), 'A', ['no_stairs'])], 3)).toBe(false);
    expect(needsReserve([cand(0, vec({}), 'A'), cand(1, vec({}), 'B', ['unreachable'])], 3)).toBe(true);
    expect(needsReserve([cand(0, vec({}), 'A'), cand(1, vec({}), 'B'), cand(2, vec({}), 'C')], 3)).toBe(false);
    expect(noPlayableNotice([cand(0, vec({}), 'A', ['required_missing'])])).toMatch(/^Keine spielbare Variante gefunden \(1 Kandidaten geprüft\) – ein Pflichtobjekt/);
    // alle unspielbar: keine Vorschläge (Aufrufer zeigt die bisherigen mit Hinweis)
    expect(pickProposals([cand(0, vec({}), 'A', ['no_stairs'])]).picks).toEqual([]);
  });
});

describe('Mehrziel-Vorschläge an echten Bautypen', () => {
  const seeds = (base: number, n: number): number[] => Array.from({ length: n }, (_, i) => hashSeed(base, 'vorschlag', i) % 2 ** 31);

  it.each([['tavern', 'M'], ['farmhouse', 'M'], ['watchtower', undefined]] as const)('%s %s: deterministisch, drei verschiedene, spielbar', (id, size) => {
    const def = ctx.buildingTypes.get(id);
    const params = size !== undefined ? { size } : {};
    const a = paretoProposals(def, params, seeds(3, 6), ctx);
    const b = paretoProposals(def, params, seeds(3, 6), ctx);
    const strip = (r: typeof a) => ({ ...r, candidates: r.candidates.map(({ plan: _p, ...c }) => c) });
    expect(strip(a)).toEqual(strip(b));
    expect(a.picks.map((p) => p.label)).toEqual(['beautiful', 'practical', 'balanced']);
    expect(new Set(a.picks.map((p) => p.index)).size).toBe(3);
    for (const p of a.picks) {
      expect(a.candidates[p.index]!.issues).toEqual([]);
      expect(a.front).toContain(p.index);
    }
    // die drei Vektoren unterscheiden sich paarweise
    const v = a.picks.map((p) => vectorOf(a.candidates[p.index]!.scores).join(','));
    expect(new Set(v).size).toBe(3);
    for (const c of a.candidates) for (const o of PROPOSAL_OBJECTIVES) expect(c.scores[o]).toBeGreaterThanOrEqual(0), expect(c.scores[o]).toBeLessThanOrEqual(1);
  }, 120_000);

  it('Spielbarkeit ist die gemeinsame Regel von W8-E (Bauernhaus L: Scheune mit Nebeneingang zählt als erreichbar)', () => {
    const def = ctx.buildingTypes.get('farmhouse');
    for (const seed of seeds(7, 4)) {
      const c = evaluateCandidate(def, { size: 'L' }, seed, ctx);
      const shared = playabilityIssues(def, { size: 'L' }, seed, ctx);
      expect(c.findings).toEqual(shared);
      expect(c.issues).toEqual(playabilityKinds(shared));
      expect(c.issues).not.toContain('unreachable');
    }
  }, 180_000);

  it('gewählte Vorschläge bauen ohne harte Verstöße (generateBase wie building_generate)', () => {
    const def = ctx.buildingTypes.get('tavern');
    const r = paretoProposals(def, { size: 'M' }, seeds(5, 5), ctx);
    for (const p of r.picks) {
      const res = projectFromBuildingType(def, { size: 'M' }, r.candidates[p.index]!.seed, ctx);
      const { exterior, ...build } = withoutPilastersForTheme(res.build, ctx.themes, res.project.state.themeId);
      const world = generateBase(res.project, ctx, { ...build, ...(exterior !== undefined ? { exterior } : {}), ...res.surroundings });
      expect(world.materialized.violations.filter((x) => x.severity === 'error')).toEqual([]);
      expect(world.circulation?.unreachable ?? []).toEqual([]);
    }
  }, 180_000);
});
