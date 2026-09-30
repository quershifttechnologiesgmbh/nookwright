/** Ausführung: Validierung, Determinismus, jeder fertige Bautyp über die API, Export kodierbar. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { exportFile, importFile } from '@mcda/export/node';
import type { ExecuteResult } from '../src/index.js';
import { ctx, engine } from './fixture.js';

const digest = (r: ExecuteResult): string => {
  if (!r.ok || r.artifacts?.export === undefined) throw new Error(JSON.stringify(r));
  return createHash('sha256').update(JSON.stringify(r.artifacts.export.blocks, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).digest('hex');
};

describe('execute', () => {
  it('lehnt ungültige Anfragen mit lesbaren Fehlern ab', () => {
    expect(engine.execute(null)).toMatchObject({ ok: false });
    expect(engine.execute({ op: 'nope' })).toMatchObject({ ok: false, errors: [expect.stringContaining('Unbekannte Operation')] });
    const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'house', size: 'XL', extra: 1 } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith('size:'))).toBe(true);
      expect(r.errors.some((e) => e.includes('extra'))).toBe(true);
    }
  });

  it('deterministisch: gleiche Anfrage = gleiche Blöcke; andere Variante = anderer Grundriss', () => {
    // `house` ist ein fester Bautyp (immer derselbe Grundriss); `townhouse` wird generiert
    const q = { op: 'building_generate', input: { buildingTypeId: 'townhouse', size: 'S', seed: 7, surroundings: false } };
    const a = digest(engine.execute(q));
    expect(digest(engine.execute(q))).toBe(a);
    expect(digest(engine.execute({ ...q, input: { ...q.input, rerollCount: 1 } }))).not.toBe(a);
  });

  it('Stil-Vorgaben wirken (Dachform)', () => {
    const base = { op: 'building_generate', input: { buildingTypeId: 'house', seed: 3, surroundings: false } };
    const flat = { ...base, input: { ...base.input, shell: { roof: 'flat' } } };
    expect(digest(engine.execute(flat))).not.toBe(digest(engine.execute(base)));
  });

  it('Fachwerk-Deko über shell.facade.decor wirkt; ungültiger Takt wird abgelehnt', () => {
    const base = { op: 'building_generate', input: { buildingTypeId: 'house', seed: 3, surroundings: false } };
    const on = { ...base, input: { ...base.input, shell: { facade: { decor: { panels: true, gableBraces: 3 } } } } };
    const off = { ...base, input: { ...base.input, shell: { facade: { decor: { panels: false, gableBraces: 0 } } } } };
    expect(digest(engine.execute(on))).not.toBe(digest(engine.execute(off)));
    const bad = engine.execute({ ...base, input: { ...base.input, shell: { facade: { decor: { gableBraces: -1 } } } } });
    expect(bad.ok).toBe(false);
  });

  it('Erschließungsbericht kompakt im Ergebnis (neben warnings, nicht darin)', () => {
    const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'house', seed: 3, surroundings: false } });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const c = (r.data as { circulation?: Record<string, unknown> }).circulation;
    expect(c).toMatchObject({
      entrance: expect.any(String), corridorShare: expect.any(Number), slow: expect.any(Array), unreachable: expect.any(Array),
      upperWithoutStairs: expect.any(Array), entryDoorCollisions: expect.any(Number), hints: expect.any(Array),
    });
    expect(c?.corridorShare as number).toBeGreaterThanOrEqual(0);
    expect(c?.corridorShare as number).toBeLessThanOrEqual(1);
    const warnings = (r.data as { warnings: string[] }).warnings;
    for (const h of c?.hints as string[]) expect(warnings).not.toContain(h);
  });

  it('Export ist lesbar (.litematic Round-Trip)', () => {
    const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'house', surroundings: false } });
    if (!r.ok || r.artifacts?.export === undefined) throw new Error('kein Export');
    const back = importFile('litematic', exportFile('litematic', r.artifacts.export));
    expect(back.blocks.length).toBe(r.artifacts.export.blocks.length);
  });

  for (const id of ctx.buildingTypes.ready().map((d) => d.id)) {
    it(`Bautyp ${id} über die API (kleinste Größe)`, () => {
      const size = engine.vocabulary.buildingTypes.find((b) => b.id === id)?.sizes[0];
      const r = engine.execute({ op: 'building_generate', input: { buildingTypeId: id, ...(size !== undefined ? { size } : {}), seed: 11 } });
      expect(r.ok, JSON.stringify(r.ok ? '' : r.errors)).toBe(true);
      if (r.ok) expect((r.data as { blocks: number }).blocks).toBeGreaterThan(100);
    });
  }
});

describe('Ergebnis-Cache', () => {
  it('gleiche Eingabe (auch andere Feldreihenfolge) → Treffer, gleiches Ergebnis; LRU verdrängt', async () => {
    const { createEngine } = await import('../src/index.js');
    const e = createEngine(ctx, { cacheSize: 1 });
    const a = e.execute({ op: 'building_generate', input: { buildingTypeId: 'house', seed: 2, surroundings: false } });
    const b = e.execute({ op: 'building_generate', input: { surroundings: false, seed: 2, buildingTypeId: 'house' } });
    expect(a.ok && a.cached).toBeFalsy();
    expect(b.ok && b.cached).toBe(true);
    expect(digest(b)).toBe(digest(a));
    e.execute({ op: 'catalog_describe' });
    const c = e.execute({ op: 'building_generate', input: { buildingTypeId: 'house', seed: 2, surroundings: false } });
    expect(c.ok && c.cached).toBeFalsy();
  });
});

describe('building_propose', () => {
  it('liefert unterschiedliche, deterministische Varianten; gewählter Seed baut', () => {
    const q = { op: 'building_propose', input: { buildingTypeId: 'tavern', size: 'M', count: 3, seed: 5 } };
    const a = engine.execute(q);
    expect(a.ok).toBe(true);
    const ps = (a.ok ? (a.data as { proposals: { seed: number; width: number; depth: number; rooms: unknown[] }[] }).proposals : []);
    expect(ps).toHaveLength(3);
    expect(new Set(ps.map((p) => p.seed)).size).toBe(3);
    expect(new Set(ps.map((p) => `${p.width}x${p.depth}:${p.rooms.length}`)).size).toBeGreaterThan(1);
    expect(engine.execute(q)).toEqual(a);
    expect(engine.execute({ op: 'building_generate', input: { buildingTypeId: 'tavern', size: 'M', seed: ps[0]!.seed, surroundings: false } }).ok).toBe(true);
  });
});
