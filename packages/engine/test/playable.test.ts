/**
 * W8-E „Spielbare Vorschläge“ (plan/spikes/W8E_spielbar.md): `building_propose` überspringt unspielbare Kandidaten wie
 * Grundriss-Doppel und füllt aus der Reserve auf; reicht die Reserve nicht, kommt der Vorschlag mit `playable: false`,
 * `notice` und einer Warnung – nie still. Deterministisch; `playable: false` schaltet die Prüfung ab.
 *
 * Unspielbare Kandidaten gibt es im Standard-Katalog nach W8-E nicht mehr (Korpus in pipeline/test/playability.test.ts).
 * Für den Mechanismus verlangt ein Test-Katalog im Turmzimmer 4 Eckregale als **Mindestzahl** – das passt im Wachturm M
 * je nach Seed (Fenster an den Ecken, Treppe; gemessen mit spikes/w8/w8e/findmix.mts).
 */
import { describe, expect, it } from 'vitest';
import { Catalog } from '@mcda/catalog';
import { hashSeed } from '@mcda/core';
import { playabilityIssues } from '@mcda/pipeline';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { createEngine } from '../src/index.js';
import { ctx, engine } from './fixture.js';

type Proposal = { seed: number; playable?: boolean; notice?: string };
type Data = { proposals: Proposal[]; distinct: number; skipped?: number[]; warnings?: string[] };
const data = (e: ReturnType<typeof createEngine>, input: Record<string, unknown>): Data => {
  const r = e.execute({ op: 'building_propose', input });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.data as unknown as Data;
};

const tower = ctx.catalog.roomType('tower_room');
const strictTower = { ...tower, required: [{ ...tower.required[0]!, count: { perArea: 12, min: 4, max: 4 } }] };
const strictCtx = { ...ctx, catalog: Catalog.of(ctx.catalog.all(), ctx.catalog.roomTypeIds().map((id) => (id === 'tower_room' ? strictTower : ctx.catalog.roomType(id)))) };
const strict = createEngine(strictCtx, { cacheSize: 0 });
const seedOf = (base: number, n: number): number => hashSeed(base, 'vorschlag', n) % 2 ** 31;
const watchtower = strictCtx.buildingTypes.get('watchtower')!;
const playable = (seed: number): boolean => playabilityIssues(watchtower, { size: 'M' }, seed, strictCtx).length === 0;

describe('building_propose: nur spielbare Vorschläge (W8-E)', () => {
  it('Standard-Katalog: alle spielbar, dieselben Seeds wie ohne Prüfung, keine Warnung', () => {
    for (const [buildingTypeId, size] of [['castle_compact', 'S'], ['watchtower', 'L'], ['tavern', 'M']] as const) {
      const on = data(engine, { buildingTypeId, size, seed: 101 });
      const off = data(engine, { buildingTypeId, size, seed: 101, playable: false });
      expect(on.proposals.every((p) => p.playable === true), buildingTypeId).toBe(true);
      expect(on.warnings).toBeUndefined();
      expect(on.skipped).toEqual([]);
      expect(on.proposals.map((p) => p.seed)).toEqual(off.proposals.map((p) => p.seed));
      // ohne Prüfung: Antwort wie vor W8-E (kein Feld `playable`)
      expect(off.proposals.some((p) => 'playable' in p)).toBe(false);
    }
  }, HEAVY_TIMEOUT);

  it('überspringt unspielbare Kandidaten, wenn die Reserve spielbare hat', () => {
    // Basis 2: Kandidaten 0 und 2 unspielbar, 1, 3, 4 … spielbar
    expect([0, 1, 2, 3].map((n) => playable(seedOf(2, n)))).toEqual([false, true, false, true]);
    const d = data(strict, { buildingTypeId: 'watchtower', size: 'M', seed: 2 });
    expect(d.proposals).toHaveLength(3);
    expect(d.proposals.every((p) => p.playable === true && p.notice === undefined)).toBe(true);
    expect(d.proposals.map((p) => p.seed)).not.toContain(seedOf(2, 0));
    expect(d.proposals.map((p) => p.seed)).not.toContain(seedOf(2, 2));
    expect(d.skipped).toEqual([seedOf(2, 0), seedOf(2, 2)]);
    expect(d.warnings).toBeUndefined();
    for (const p of d.proposals) expect(playable(p.seed)).toBe(true);
    // deterministisch
    expect(data(strict, { buildingTypeId: 'watchtower', size: 'M', seed: 2 })).toEqual(d);
  }, HEAVY_TIMEOUT);

  it('Reserve erschöpft: unspielbarer Vorschlag mit Hinweis und Warnung, nie still', () => {
    // Basis 7: nur Kandidat 0 und 8 von 9 spielbar
    const d = data(strict, { buildingTypeId: 'watchtower', size: 'M', seed: 7 });
    const bad = d.proposals.filter((p) => p.playable === false);
    expect(d.proposals.filter((p) => p.playable === true).map((p) => p.seed)).toEqual([seedOf(7, 0), seedOf(7, 8)]);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.notice).toMatch(/^Pflichtobjekt fehlt: .+ \(Turmzimmer\)$/);
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings![0]).toContain(`Vorschlag ${bad[0]!.seed} nicht spielbar`);
    expect(playable(bad[0]!.seed)).toBe(false);
  }, HEAVY_TIMEOUT);
});
