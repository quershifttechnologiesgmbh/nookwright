/**
 * feat/pareto-proposals über die Engine-API (`building_propose` mit `pareto`).
 * - Schalter aus (fehlt oder `false`): Antworten bitgleich zu `w1/eine-app` ohne diesen Branch (Prüfsummen über 12 Bautypen
 *   × 3 Seeds): Standard (W8-E, `playable` an) wie w1 5a9554e0, `playable: false` wie vor W8-E (067a5663).
 * - `pareto` schließt `playable` ein; ohne spielbaren Kandidaten der W8-E-Weg mit den schon bewerteten Befunden.
 * - Schalter an: drei beschriftete, spielbare, verschiedene Vorschläge mit Begründung und Zielvektor; Pool offen gelegt.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Catalog } from '@mcda/catalog';
import { createEngine } from '../src/index.js';
import { ctx, engine } from './fixture.js';

/**
 * Seit W8-E sind im Katalog alle geprüften Bautypen spielbar. Für die Rand-Wege (Reserve, kein spielbarer Kandidat) ein
 * Test-Katalog, in dem das Schlafzimmer `beds` Himmelbetten verlangt: 2 → im Stadthaus S nur manche Grundrisse spielbar,
 * 40 → keiner.
 */
function withBeds(beds: number) {
  const roomTypes = ctx.catalog.roomTypeIds().map((id) => {
    const rt = ctx.catalog.roomType(id);
    return id !== 'bedroom' ? rt : { ...rt, required: rt.required.map((e, k) => (k === 0 ? { ...e, count: [beds, beds] as [number, number] } : e)) };
  });
  return createEngine({ ...ctx, catalog: Catalog.of(ctx.catalog.all(), roomTypes) });
}
const run = (eng: ReturnType<typeof createEngine>, input: Record<string, unknown>): Data & { warnings?: string[] } => {
  const r = eng.execute({ op: 'building_propose', input });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.data as unknown as Data & { warnings?: string[] };
};

const TYPES = ['house', 'tavern', 'farmhouse', 'castle_compact', 'longhouse', 'watchtower', 'hobbit', 'townhouse', 'townhouse_row', 'hall', 'twostory', 'timber'];
/**
 * Prüfsummen der bisherigen Vorschläge ohne `pareto`, aufgenommen auf `w1/eine-app` 9d25017f (nach W16), ohne diesen
 * Branch: Standard (`playable` an) und `playable: false` (= Stand vor W8-E, 067a5663). Ändern sie sich, hat sich der
 * Standardweg geändert.
 */
const BASELINE = '328f23e3a1f5cc6f37469d82d688386b43ae7700b69d22eed5a0d2a2a85eb893';
const BASELINE_UNCHECKED = '785832af50ea825d71aa5ec3e5cf677c434738bea3a3972f25d885b2d1113558';

interface Proposal { readonly seed: number; readonly playable?: boolean; readonly label?: string; readonly labelText?: string; readonly reason?: string; readonly scores?: Record<string, number> }
interface Data {
  readonly proposals: readonly Proposal[];
  readonly distinct: number;
  readonly pareto?: { readonly pool: number; readonly playable: number; readonly candidates: readonly { readonly seed: number; readonly front: boolean; readonly issues: readonly string[] }[] };
}
const data = (input: Record<string, unknown>): Data => {
  const r = engine.execute({ op: 'building_propose', input });
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.data as unknown as Data;
};

describe('building_propose: Schalter pareto', () => {
  it('aus: bitgleich zu w1 (ohne Feld, pareto: false; mit playable: false wie vor W8-E)', () => {
    const off = createHash('sha256');
    const explicit = createHash('sha256');
    const unchecked = createHash('sha256');
    for (const t of TYPES) for (const seed of [1, 7, 42]) {
      off.update(JSON.stringify(engine.execute({ op: 'building_propose', input: { buildingTypeId: t, seed } })));
      explicit.update(JSON.stringify(engine.execute({ op: 'building_propose', input: { buildingTypeId: t, seed, pareto: false } })));
      unchecked.update(JSON.stringify(engine.execute({ op: 'building_propose', input: { buildingTypeId: t, seed, playable: false } })));
    }
    expect(off.digest('hex')).toBe(BASELINE);
    expect(explicit.digest('hex')).toBe(BASELINE);
    expect(unchecked.digest('hex')).toBe(BASELINE_UNCHECKED);
  }, 300_000);

  it('an: drei beschriftete, spielbare, verschiedene Vorschläge; Pool mit den bisherigen Seeds vorn; deterministisch', () => {
    const input = { buildingTypeId: 'tavern', size: 'M', seed: 5, pareto: true, poolSize: 6 };
    const d = data(input);
    expect(d.proposals.map((p) => p.label)).toEqual(['beautiful', 'practical', 'balanced']);
    expect(d.proposals.map((p) => p.labelText)).toEqual(['Am schönsten', 'Am praktischsten', 'Ausgewogen']);
    for (const p of d.proposals) {
      expect(p.reason).toMatch(/%/);
      expect(Object.keys(p.scores!)).toEqual(['interior', 'facade', 'daylight', 'walkways', 'access', 'capacity', 'compact']);
    }
    expect(new Set(d.proposals.map((p) => p.seed)).size).toBe(3);
    expect(d.proposals.every((p) => p.playable === true)).toBe(true);
    // pareto schließt playable ein: auch mit playable: false nur spielbare, gleiche Wahl
    expect(data({ ...input, playable: false }).proposals).toEqual(d.proposals);
    expect(new Set(d.proposals.map((p) => JSON.stringify(p.scores))).size).toBe(3);
    expect(d.pareto!.pool).toBe(6);
    expect(d.pareto!.candidates).toHaveLength(6);
    const bySeed = new Map(d.pareto!.candidates.map((c) => [c.seed, c]));
    for (const p of d.proposals) expect(bySeed.get(p.seed)!.issues).toEqual([]);
    // die ersten Kandidaten sind die bisherigen Vorschläge (gleiche Seeds)
    const plain = data({ buildingTypeId: 'tavern', size: 'M', seed: 5 });
    expect(d.pareto!.candidates.slice(0, 3).map((c) => c.seed)).toEqual(plain.proposals.map((p) => p.seed));
    expect(data(input)).toEqual(d);
    // gewählter Seed baut wie bisher
    expect(engine.execute({ op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'M', seed: d.proposals[0]!.seed, surroundings: false } }).ok).toBe(true);
  }, 120_000);

  it('zu wenig spielbare im Pool: Reserve füllt auf, nie ein unspielbarer Vorschlag', () => {
    const eng = withBeds(2);
    let reserveUsed = 0;
    for (const seed of [1, 2, 3]) {
      const d = run(eng, { buildingTypeId: 'townhouse', size: 'S', seed, pareto: true, poolSize: 3 });
      expect(d.proposals).toHaveLength(3);
      const bySeed = new Map(d.pareto!.candidates.map((c) => [c.seed, c]));
      for (const p of d.proposals) expect(bySeed.get(p.seed)!.issues).toEqual([]);
      if (d.pareto!.pool > 3) reserveUsed++;
    }
    expect(reserveUsed).toBeGreaterThan(0);
  }, 120_000);

  it('Review A3: kein Kandidat spielbar → W8-E-Vorschläge mit Warnung und Pool-Bericht, keine Reserve', () => {
    const eng = withBeds(40);
    const plain = run(eng, { buildingTypeId: 'townhouse', size: 'S', seed: 1 });
    const d = run(eng, { buildingTypeId: 'townhouse', size: 'S', seed: 1, pareto: true, poolSize: 3 });
    expect(d.pareto!.playable).toBe(0);
    expect(d.pareto!.pool).toBe(3); // Reserve übersprungen: ohne einen spielbaren kostet sie nur Zeit
    expect(d.warnings![0]).toMatch(/^Keine spielbare Variante gefunden \(3 Kandidaten geprüft\)/);
    // danach der W8-E-Weg (Befunde der bewerteten Kandidaten übernommen): gleiche Vorschläge und Warnungen wie ohne pareto
    expect(d.proposals).toEqual(plain.proposals);
    expect(d.warnings!.slice(1)).toEqual(plain.warnings ?? []);
    expect(d.proposals.every((p) => p.playable === false)).toBe(true);
    expect(d.proposals.every((p) => p.label === undefined)).toBe(true);
  }, 180_000);

  it('Poolgröße wird geprüft', () => {
    const r = engine.execute({ op: 'building_propose', input: { buildingTypeId: 'tavern', pareto: true, poolSize: 40 } });
    expect(r.ok).toBe(false);
  });
});
