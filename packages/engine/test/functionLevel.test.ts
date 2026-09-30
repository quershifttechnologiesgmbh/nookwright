/** Funktionsgrad (W2-1) über die Engine-API: Schema, Bitgleichheit bei off, Wirkung, Determinismus, Bericht. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../src/index.js';
import { engine } from './fixture.js';

const digest = (r: ExecuteResult): string => {
  if (!r.ok || r.artifacts?.export === undefined) throw new Error(JSON.stringify(r));
  return createHash('sha256').update(JSON.stringify(r.artifacts.export.blocks, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).digest('hex');
};
const gen = (type: string, extra: Record<string, unknown> = {}): ExecuteResult =>
  engine.execute({ op: 'building_generate', input: { buildingTypeId: type, size: 'M', seed: 12, surroundings: false, ...extra } });

describe('Funktionsgrad in der Engine', () => {
  it('Schema: off/some/rich erlaubt, anderes wird mit lesbarem Fehler abgelehnt; Feld ist beschrieben', () => {
    for (const level of ['off', 'some', 'rich']) {
      expect(engine.validate({ op: 'building_generate', input: { buildingTypeId: 'tavern', functionLevel: level } }), level).toEqual([]);
    }
    const bad = engine.execute({ op: 'building_generate', input: { buildingTypeId: 'tavern', functionLevel: 'lots' } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.some((e) => e.startsWith('functionLevel:'))).toBe(true);
    const schema = JSON.stringify(engine.inputSchema('building_generate'));
    expect(schema).toContain('functionLevel');
  });

  it('off (und weglassen) ist bitgleich; some/rich ändern den Bau und sind deterministisch', () => {
    for (const type of ['tavern', 'longhouse', 'farmhouse', 'watchtower']) {
      const plain = digest(gen(type));
      expect(digest(gen(type, { functionLevel: 'off' })), type).toBe(plain);
      const some = digest(gen(type, { functionLevel: 'some' }));
      const rich = digest(gen(type, { functionLevel: 'rich' }));
      expect(some, type).not.toBe(plain);
      expect(digest(gen(type, { functionLevel: 'some' })), type).toBe(some);
      expect(digest(gen(type, { functionLevel: 'rich' })), type).toBe(rich);
    }
  }, 240_000);

  it('Bautypen ohne Funktionsräume (feste Grundrisse) bauen mit Stufe wie ohne', () => {
    expect(digest(gen('house', { functionLevel: 'rich' }))).toBe(digest(gen('house')));
  });
});
