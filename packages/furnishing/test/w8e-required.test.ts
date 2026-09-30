/**
 * W8-E „Spielbare Vorschläge“ (plan/spikes/W8E_spielbar.md): Pflicht heißt die Mindestzahl je Eintrag; Stücke über ihr
 * (Flächenzahl `perArea`) sind Wunsch – passt eins nach allen Lockerungen nicht, ist das ein Hinweis. Die Suche selbst
 * bleibt unverändert. Dazu `requiredWithoutPose`: Pflichtobjekte ohne jede Pose im leeren Raum (für den Planer).
 */
import { describe, expect, it } from 'vitest';
import { CellSet } from '@mcda/core';
import { furnishRoom, requiredWithoutPose, type RoomGeometry } from '../src/index.js';
import { catalog, DV, shellRoom } from './fixtures.js';

const tower = catalog.roomType('tower_room');
const required = (r: ReturnType<typeof furnishRoom>) => r.quality.parts.find((p) => p.id === 'required')!;

describe('Stücke über der Mindestzahl', () => {
  // viele Eckregale verlangt (Flächenzahl), Mindestzahl 1 bzw. 12
  const wish = { ...tower, required: [{ ...tower.required[0]!, count: { perArea: 3, min: 1, max: 12 } }] };
  const hard = { ...tower, required: [{ ...tower.required[0]!, count: { perArea: 3, min: 12, max: 12 } }] };
  const g = shellRoom(8, 8, { height: 4 });

  it('passen nicht alle: Hinweis statt Warnung, Teilwert „Pflichtobjekte“ voll, „Raumprogramm“ zeigt den Rest', () => {
    const r = furnishRoom(g, wish, catalog, { seed: 3, dataVersion: DV });
    expect(r.warnings.filter((w) => w.startsWith('Pflichtobjekt'))).toEqual([]);
    expect(r.quality.notes.join()).toMatch(/× corner_shelf über der Mindestzahl entfällt/);
    expect(required(r).value).toBe(1);
    expect(required(r).detail).toMatch(/^1 von 1 \(Mindestzahl; gesetzt \d+ von 12 gewünschten\)$/);
    expect(r.quality.parts.find((p) => p.id === 'program')!.value).toBeLessThan(1);
  });

  it('Mindestzahl nicht erreicht: weiter Warnung und fehlendes Pflichtobjekt', () => {
    const r = furnishRoom(g, hard, catalog, { seed: 3, dataVersion: DV });
    expect(r.warnings.some((w) => w === 'Pflichtobjekt corner_shelf passt nicht in den Raum')).toBe(true);
    expect(required(r).value).toBeLessThan(1);
  });

  it('die Suche ist dieselbe: gleiche Platzierungen mit Mindestzahl 1 und 12', () => {
    for (const seed of [1, 2, 3]) {
      const a = furnishRoom(g, wish, catalog, { seed, dataVersion: DV });
      const b = furnishRoom(g, hard, catalog, { seed, dataVersion: DV });
      expect(JSON.stringify(a.placements)).toBe(JSON.stringify(b.placements));
    }
  });

  it('alles gesetzt: Teilwert unverändert „n von n“', () => {
    const r = furnishRoom(shellRoom(10, 10, { height: 4 }), tower, catalog, { seed: 1, dataVersion: DV });
    expect(r.warnings).toEqual([]);
    expect(required(r).detail).toMatch(/^(\d+) von \1$/);
  });
});

describe('requiredWithoutPose (Planer-Prüfung)', () => {
  // Geometrien echter Räume vor W8-E (spikes/w8/w8e/geomdump.mts, Planer ohne `furnishable`): Durchgangszimmer im
  // Erdhaus S (Seed 2073880150, r2: 4 × 3 innen, Türen mitten in beiden Schmalseiten) und Ring um das Treppenloch im
  // Stadthaus M (Seed 265874281, r4: Treppe hoch + Loch der Treppe darunter, 16 von 30 Zellen gesperrt)
  const cells = (xs: ReadonlyArray<readonly [number, number]>) => CellSet.of(xs.map(([x, z]) => [x, z] as [number, number]));
  const through: RoomGeometry = {
    roomId: 'r2', baseY: 1, height: 3, interior: CellSet.rect(6, 1, 9, 3),
    doors: [{ inside: [6, 2], toward: 'west', isMain: false }, { inside: [9, 2], toward: 'east', isMain: false }], windows: [],
  };
  const ring: RoomGeometry = {
    roomId: 'r4', baseY: 9, height: 3,
    interior: cells([[1, 1], [1, 6], [2, 1], [2, 6], [3, 1], [3, 6], [4, 1], [4, 6], [5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [5, 6]]),
    blocked: CellSet.rect(1, 2, 4, 5),
    doors: [{ inside: [3, 6], toward: 'south', isMain: false }, { inside: [3, 1], toward: 'south', isMain: false }, { inside: [1, 1], toward: 'south', isMain: false }],
    windows: ([[[5, 3], 'east'], [[3, 1], 'north'], [[1, 3], 'west'], [[2, 1], 'south'], [[4, 1], 'south'], [[5, 2], 'west'], [[5, 3], 'west'], [[5, 4], 'west'],
      [[5, 5], 'west'], [[1, 6], 'north'], [[2, 6], 'north'], [[3, 6], 'north'], [[4, 6], 'north']] as const).map(([inside, toward]) => ({ inside: [...inside] as [number, number], toward })),
  };

  it('meldet das Bett im Durchgang und im Ring, nicht im normalen Zimmer', () => {
    const bedroom = catalog.roomType('bedroom');
    expect(requiredWithoutPose(through, bedroom, catalog, { dataVersion: DV })).toEqual(['canopy_bed']);
    expect(requiredWithoutPose(ring, bedroom, catalog, { dataVersion: DV })).toEqual(['canopy_bed']);
    expect(requiredWithoutPose(shellRoom(7, 7), bedroom, catalog, { dataVersion: DV })).toEqual([]);
  });

  it('stimmt mit dem Solver überein: ohne Pose fehlt das Pflichtobjekt wirklich', () => {
    const bedroom = catalog.roomType('bedroom');
    for (const g of [through, ring]) {
      for (const seed of [1, 2, 3]) expect(required(furnishRoom(g, bedroom, catalog, { seed, dataVersion: DV })).value).toBe(0);
    }
  });

  it('nur Einträge mit Mindestzahl ≥ 1 zählen', () => {
    // Einzelbett im Schlafzimmer: `perArea`, Mindestzahl 0 – nie gemeldet
    expect(catalog.roomType('bedroom').required[1]!.tags).toEqual(['bed_single']);
    expect(requiredWithoutPose(through, catalog.roomType('bedroom'), catalog, { dataVersion: DV })).not.toContain('bed_single');
  });
});
