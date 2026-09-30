/** rooms_generate und Stil-Felder (Dach-Details, Gauben, Fassade, Außen-Deko). */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ExecuteResult } from '../src/index.js';
import { engine } from './fixture.js';

const digest = (r: ExecuteResult): string => {
  if (!r.ok || r.artifacts?.export === undefined) throw new Error(JSON.stringify(r));
  return createHash('sha256').update(JSON.stringify(r.artifacts.export.blocks, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).digest('hex');
};

// Wie `twoStoryHouse` der Pipeline: Küche, Schlafzimmer, Lager, Schmiede; oben Schlafzimmer, Alchemie, Bibliothek
const TWO_STORY = {
  name: 'Zweistöckig',
  floorHeights: [3, 3],
  rooms: [
    { floor: 0, roomTypeId: 'kitchen', rect: [0, 0, 8, 6] },
    { floor: 0, roomTypeId: 'bedroom', rect: [9, 0, 14, 6] },
    { floor: 0, roomTypeId: 'storage', rect: [0, 7, 14, 11] },
    { floor: 0, roomTypeId: 'smithy', rect: [15, 0, 22, 11] },
    { floor: 1, roomTypeId: 'bedroom', rect: [0, 0, 8, 6] },
    { floor: 1, roomTypeId: 'alchemy', rect: [9, 0, 14, 6] },
    { floor: 1, roomTypeId: 'library', rect: [0, 7, 14, 11] },
  ],
  stairs: [{ floor: 0, at: [3, 10], facing: 'east' }],
  themeId: 'medieval',
};

describe('rooms_generate', () => {
  it('W11-A autoStairs: ohne Treppen angegeben wird jede Etage verbunden (Meldung in notes); ohne Schalter bitgleich', () => {
    const { stairs: _stairs, ...noStairs } = TWO_STORY;
    const r = engine.execute({ op: 'rooms_generate', input: { ...noStairs, autoStairs: true } });
    expect(r.ok, JSON.stringify(r.ok ? '' : r.errors)).toBe(true);
    if (!r.ok) return;
    const d = r.data as { notes: string[]; circulation?: { upperWithoutStairs?: string[] } };
    expect(d.notes.join(' ')).toMatch(/^Treppe automatisch gesetzt: EG ↔ 1\. OG in /);
    // mit angegebener Treppe ändert der Schalter nichts (schon verbunden)
    expect(digest(engine.execute({ op: 'rooms_generate', input: { ...TWO_STORY, autoStairs: true } }))).toBe(digest(engine.execute({ op: 'rooms_generate', input: TWO_STORY })));
  });

  it('zweistöckiges Haus aus Rechtecken und Treppe', () => {
    const r = engine.execute({ op: 'rooms_generate', input: TWO_STORY });
    expect(r.ok, JSON.stringify(r.ok ? '' : r.errors)).toBe(true);
    if (!r.ok) return;
    const d = r.data as { floors: number[]; rooms: unknown[]; blocks: number; name: string };
    expect(d.floors).toEqual([0, 1]);
    expect(d.rooms).toHaveLength(7);
    expect(d.name).toBe('Zweistöckig');
    expect(d.blocks).toBeGreaterThan(1000);
    expect(digest(engine.execute({ op: 'rooms_generate', input: TWO_STORY }))).toBe(digest(r));
  });

  it('mit Gelände (Gehöft-Vorlage) und Außen-Deko', () => {
    const plain = engine.execute({ op: 'rooms_generate', input: TWO_STORY });
    const r = engine.execute({
      op: 'rooms_generate',
      input: { ...TWO_STORY, exterior: { density: 1 }, surroundings: { terrainStyleId: 'meadow', template: 'homestead' } },
    });
    expect(r.ok, JSON.stringify(r.ok ? '' : r.errors)).toBe(true);
    if (r.ok && plain.ok) expect((r.data as { blocks: number }).blocks).toBeGreaterThan((plain.data as { blocks: number }).blocks);
  });

  it('Domänen-Fehler kommen als lesbare Fehler zurück (Etage fehlt, Treppe ungültig)', () => {
    const noFloor = engine.execute({ op: 'rooms_generate', input: { rooms: [{ floor: 2, roomTypeId: 'kitchen', rect: [0, 0, 5, 5] }] } });
    expect(noFloor).toMatchObject({ ok: false, errors: [expect.stringContaining('Etage 2 fehlt')] });
    const badStairs = engine.execute({
      op: 'rooms_generate', input: { rooms: [{ floor: 0, roomTypeId: 'kitchen', rect: [0, 0, 5, 5] }], stairs: [{ floor: 0, at: [40, 40], facing: 'east' }] },
    });
    expect(badStairs.ok).toBe(false);
  });
});

describe('Stil-Felder', () => {
  const base = { op: 'building_generate', input: { buildingTypeId: 'house', seed: 5, surroundings: false } } as const;
  const variant = (extra: Record<string, unknown>) => digest(engine.execute({ ...base, input: { ...base.input, ...extra } }));
  const ref = () => digest(engine.execute(base));

  it('Dach-Details, Gauben und Fassade verändern die Welt', () => {
    const r0 = ref();
    expect(variant({ shell: { roofDetail: { pitch: 'steep' } } })).not.toBe(r0);
    expect(variant({ shell: { facade: { quoins: true, cornice: true } } })).not.toBe(r0);
  });

  it('Außen-Deko: aus, Gruppen abschalten', () => {
    const on = variant({ exterior: { density: 2 } });
    expect(variant({ exterior: { enabled: false } })).not.toBe(on);
    expect(variant({ exterior: { density: 2, off: ['shutters', 'flowerBoxes', 'eaveLanterns'] } })).not.toBe(on);
  });
});
