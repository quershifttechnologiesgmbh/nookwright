import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildStructures, type HeightField, type StructuresInput, type WallPlan } from '../src/index.js';

/**
 * Bitgleichheit (Auftrag TW): Ohne die neuen Optionen (roofShape, flare, finial, neue Abschlüsse, Windmühlen,
 * profile) liefern Mauern und Türme exakt das Ergebnis von vor der Erweiterung. Die Prüfsummen stammen aus dem
 * Stand B1 (SHA-1 über JSON des ganzen Ergebnisses: Zellen, Türme, Mauern, Grundfläche, Hinweise).
 */
const RING: WallPlan = { points: [[-8, -8], [30, -8], [30, 19], [-8, 19]], closed: true, towerSpacing: 0, gates: [{ at: [11, 19] }] };
const slope: HeightField = { groundY: (x, z) => Math.floor(x / 2) + (z > 3 ? 1 : 0) };
/**
 * W7 (27.09.2026, plan/spikes/W7B_burg.md): Das Sockelgeschoss der Mauertürme trägt die Rolle `fort_base` (Rückfall
 * `wall_primary` in der Materialisierung). Die Summen vergleichen darum mit `fort_base` → `wall_primary`: bis auf den
 * Rollennamen bitgleich (dieselben Zellen, Formen und Reihenfolge).
 */
const hash = (input: StructuresInput, opts: Parameters<typeof buildStructures>[1] = {}): string => {
  const res = buildStructures(input, opts);
  const cells = res.cells.map((c) => (c.role === 'fort_base' ? { ...c, role: 'wall_primary' } : c));
  return createHash('sha1').update(JSON.stringify({ ...res, cells })).digest('hex');
};
const towers = (shape: 'round' | 'square', top: 'roof' | 'battlements'): StructuresInput => ({
  towers: [
    { center: [0, 0], shape, top, levels: 3 },
    { center: [20, 3], shape, top, size: 11, roofPitch: 1, corbels: false, levelHeight: 5 },
  ],
});

describe('Bitgleichheit ohne neue Optionen (Stand B1)', () => {
  it('Mauerring, Torhaus/Tür/Doppeltür, eckige Dach-Türme', () => {
    expect(hash({ walls: [RING] })).toBe('dc77d9dc6e100575fc4284b355dcd505bb0649cf');
    expect(hash({ walls: [{ ...RING, towerStyle: { shape: 'square', top: 'roof', roofPitch: 1 } }] }, { seed: 5 })).toBe('0b60c901192cc7ed22893b744d0c712a55ee7659');
    expect(hash({ walls: [{ ...RING, gates: [{ at: [11, 19], gatehouse: true }, { at: [30, 5], width: 2 }, { at: [0, -8], width: 1 }] }] }, { seed: 7 }))
      .toBe('de340392fdf0abb707877e8635b5c76dce4bcfc4');
  });

  it('freistehende Türme am Hang (Kegel, Zinnen, Seed-Spitze)', () => {
    expect(hash(towers('round', 'roof'), { seed: 1, ground: slope })).toBe('d05a48be1553d70f199bb0a76db0386ec32fab34');
    expect(hash(towers('round', 'roof'), { seed: 4, ground: slope })).toBe('b30d00b4231d773b04afb7e325d9be74f74b8849');
    expect(hash(towers('round', 'battlements'), { seed: 1, ground: slope })).toBe('22a672c4b3649819440f47c7dd7bf2fadc9b00a7');
  });
});

/**
 * Bitgleichheit (Auftrag O1): Ohne die Optionen `bell`, `hangingLanterns` und die Spitzen `rod`/`end_rod` liefern
 * Dachformen, Stuben, Windmühlen und Gartenmauern exakt das Ergebnis des Stands TW (Prüfsummen vor O1 erhoben).
 */
const SHOWCASE_TW: StructuresInput = {
  towers: [
    { center: [-10, -2], shape: 'square', size: 7, top: 'roof', roofShape: 'helm', finial: 'lantern', levels: 2 },
    { center: [-10, 14], shape: 'square', size: 7, top: 'belfry', roofShape: 'spire', finial: 'spike', levels: 3 },
    { center: [34, -2], shape: 'round', top: 'lookout', roofShape: 'bell', levels: 3 },
    { center: [34, 14], shape: 'round', top: 'platform', levels: 2 },
    { center: [11, -14], shape: 'round', top: 'roof', flare: true, finial: 'pole', levels: 2 },
    { center: [11, 26], shape: 'square', size: 9, top: 'lookout', roofShape: 'tent', finial: 'lantern', levels: 2 },
    { center: [-10, 30], shape: 'round', top: 'belfry', roofShape: 'bell', levels: 2 },
  ],
  windmills: [{ center: [50, 5], facing: 'west' }, { center: [50, 30], shape: 'square', size: 9, facing: 'south', sailLength: 6, sailWidth: 3 }],
  walls: [
    { profile: 'garden', points: [[-2, -5], [24, -5]], gates: [{ at: [11, -5], width: 1 }], garden: { lanterns: true } },
    { profile: 'garden', points: [[-2, 16], [24, 16], [24, 20]], gates: [{ at: [6, 16], width: 3 }, { at: [16, 16], width: 2 }], garden: { hedge: true } },
  ],
};

describe('Bitgleichheit ohne O1-Optionen (Stand TW)', () => {
  it('Dachformen, Aussichts-/Glockenstuben, Plattform, Windmühlen, Gartenmauern', () => {
    // Windmühlen-Bespannung seit 23.09.2026 spiegelsymmetrisch (keine hakenkreuzähnliche Windrad-Figur) – Summen neu
    expect(hash(SHOWCASE_TW)).toBe('05b9b2e02617c8201da3eaf41ae87cc188de5f37');
    expect(hash(SHOWCASE_TW, { seed: 2026, ground: slope })).toBe('b8087a68db14a1e5bcb33e0fbdaac527ad68c0d3');
  });

  it('Mauertürme mit Aussichts- bzw. Glockenstube', () => {
    expect(hash({ walls: [{ ...RING, towerStyle: { shape: 'square', top: 'lookout' } }] }, { seed: 3 })).toBe('2d1fb665d9dd2e8e9acd8640ca33382ad813831c');
    expect(hash({ walls: [{ ...RING, towerStyle: { shape: 'round', top: 'belfry', roofShape: 'bell' } }] }, { seed: 3 })).toBe('67a47294feb6f274dbc167be09da456038e66f7e');
  });
});
