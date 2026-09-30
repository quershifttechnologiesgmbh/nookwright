/**
 * Angedockte Türme (C4, research/18 T1/T3) ohne Haus: Die Hauswand steht bei x = 14 (Türen dort, Blick nach Osten),
 * der Turm östlich davon. Geprüft werden Durchgänge, Geschossböden auf Türhöhe, Wendel von jeder Tür erreichbar,
 * Kontakt/Freiraum zur Hausseite, Scharten, Standfestigkeit und Konsistenz mit `annexWallTop`.
 */
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@mcda/core';
import {
  annexContacts, annexFootprint, annexWallTop, buildStructures, flatGround, floatingCells, type AnnexTowerSpec, type TowerShape, type TowerTop,
} from '../src/index.js';
import { cellMap, key, reachShare, section } from './support.js';

const ground = flatGround();
/** Türen der Hauswand (x = 14) im EG (Boden 0) und OG (Boden 4). */
const doors = (z = 4) => [{ pos: [14, 1, z] as Vec3, facing: 'east' as const }, { pos: [14, 5, z] as Vec3, facing: 'east' as const }];
const stairTower = (extra: Partial<AnnexTowerSpec> = {}): AnnexTowerSpec => ({ id: 'a1', center: [18, 4], side: 'west', passages: doors(), contactTop: 13, ...extra });
const build = (spec: AnnexTowerSpec) => buildStructures({ annexTowers: [spec] }, { seed: 3 });

describe('Angedockter Turm: Treppenturm (T3) eckig 7 an der Ostwand', () => {
  it('Durchgänge frei, Böden auf Türhöhe, Wand bis zur Kontaktlinie, nichts auf der Hausseite darunter', () => {
    const res = build(stairTower());
    expect(res.warnings).toEqual([]);
    const t = res.towers[0]!;
    expect(t.id).toBe('fort:a1');
    expect(t.baseY).toBe(0);
    expect(t.floors).toEqual([0, 4, 10]);
    expect(t.topY).toBe(10); // Wandkrone topY + 3 = 13 = contactTop
    expect(t.door).toBeUndefined(); // Zugang über das Haus
    expect(t.annex).toEqual({ kind: 'stair', side: 'west', passages: [[16, 1, 4], [16, 5, 4]] });
    const m = cellMap(res.cells);
    for (const y of [1, 2, 5, 6]) expect(m.get(key(15, y, 4)), `Durchgang y=${y}`).toBeUndefined();
    expect(m.get(key(15, 0, 4))?.role).toBe('foundation');
    expect(m.get(key(15, 4, 4))?.role).toBe('wall_primary');
    expect(m.get(key(16, 4, 4))?.role).toBe('tower_floor');
    expect(m.get(key(15, 13, 4))?.role).toBe('wall_primary');
    expect(res.cells.filter((c) => c.pos[0] <= 14 && c.pos[1] <= 13)).toEqual([]);
    expect(floatingCells(res.cells, ground)).toEqual([]);
    expect(res.footprint).toEqual(annexFootprint(stairTower()).sort((a, b) => a[1] - b[1] || a[0] - b[0]));
  });

  it('Wendeltreppe begehbar: von jeder Tür zu jeder anderen und ins Dachgeschoss', () => {
    const res = build(stairTower());
    const t = res.towers[0]!;
    for (const from of t.annex!.passages) {
      expect(reachShare(res, ground, [from], t.annex!.passages), `ab ${from}`).toBe(1);
      expect(reachShare(res, ground, [from], t.topStands), `ab ${from}`).toBe(1);
    }
  });

  it('Scharten steigen mit der Wendel (nie zur Hausseite), Dachgeschoss mit Achsen-Scharten', () => {
    const res = build(stairTower({ levels: 4 }));
    const t = res.towers[0]!;
    const slits = res.cells.filter((c) => c.role === 'arrow_slit');
    expect(slits.filter((c) => c.pos[0] === 15)).toEqual([]);
    const shaft = slits.filter((c) => c.pos[1] < t.topY).map((c) => c.pos[1]);
    expect(shaft.length).toBeGreaterThanOrEqual(4);
    expect(new Set(shaft).size).toBe(shaft.length); // jede Höhe höchstens eine Scharte: sie steigen
    expect(slits.some((c) => c.pos[1] > t.topY)).toBe(true);
  });

  it('Schnitt z = 4 (Blick nach Norden, Haus links bei x = 14): Durchgänge, Ringböden, Wendel um die Säule', () => {
    const res = build(stairTower());
    expect(section(res.cells, 'x', 4, 14, 22, 0, 13)).toBe([
      '.#.....#.', // Wandkrone = contactTop 13
      '.#.....g.',
      '.#.....g.', // Dachgeschoss, Scharten nur weg vom Haus
      '.#######.', // Boden des Dachgeschosses (topY 10)
      '.#..|..#.',
      '.#..|..#.',
      '.#.^|..#.',
      '....|..#.', // Durchgang OG (Tür y = 5)
      '....|..g.',
      '.##.|.##.', // Ringboden auf Türhöhe (4), Kern offen
      '.#..|^.#.',
      '....|..#.', // Durchgang EG (Tür y = 1)
      '....|..#.',
      '.#######.', // Bodenplatte
    ].join('\n'));
  });
});

describe('Angedockter Turm: alle Formen und Abschlüsse', () => {
  const TOPS: readonly TowerTop[] = ['roof', 'battlements', 'lookout', 'belfry', 'platform'];
  for (const shape of ['square', 'round'] as const satisfies readonly TowerShape[]) {
    for (const kind of ['stair', 'corner'] as const) {
      it(`${shape} · ${kind}: Kontakt, Freiraum über dem Haus, begehbar, steht, konsistent`, () => {
        for (const top of TOPS) {
          for (const hangingLanterns of [false, true]) {
            const r = shape === 'round' ? 4 : 3;
            const spec: AnnexTowerSpec = {
              id: 'a1', kind, shape, top, hangingLanterns, center: [15 + r, 4], side: 'west', passages: doors(), contactTop: 11, clearTop: 12, entrance: kind === 'corner',
            };
            const where = `${shape}/${kind}/${top}/${hangingLanterns}`;
            const res = build(spec);
            expect(res.warnings, where).toEqual([]);
            const t = res.towers[0]!;
            expect(floatingCells(res.cells, ground), where).toEqual([]);
            // Wandsäule an der Hausseite bis zur Kontaktlinie; auf der Hausseite (x ≤ 14) nichts bis clearTop
            const m = cellMap(res.cells);
            for (let y = 1; y <= 11; y++) if (![1, 2, 5, 6].includes(y)) expect(m.get(key(15, y, 4)), `${where} y=${y}`).toBeDefined();
            expect(res.cells.filter((c) => c.pos[0] <= 14 && c.pos[1] <= 12).map((c) => c.pos.join(',')), where).toEqual([]);
            if (kind === 'corner') expect(t.topY, where).toBeGreaterThanOrEqual(12);
            // jede Tür erreicht jede andere und oben
            for (const from of t.annex!.passages) {
              expect(reachShare(res, ground, [from], t.annex!.passages), where).toBe(1);
              expect(reachShare(res, ground, [from], t.topStands), where).toBe(1);
            }
            // Eckturm mit Eingang: Tür weg vom Haus, von außen hinauf
            if (kind === 'corner') {
              expect(t.door?.facing, where).not.toBe('west');
              expect(reachShare(res, ground, [[40, 0, 4]], t.annex!.passages), where).toBe(1);
            }
            // Vorgabe der Wandkrone (Hülle) ergibt denselben Turm
            const top2 = annexWallTop(spec);
            expect(JSON.stringify(build({ ...spec, wallTop: top2 })), where).toBe(JSON.stringify(res));
          }
        }
      });
    }
  }
});

describe('Angedockter Turm: Kontaktzellen, Hinweise, Höhe', () => {
  it('annexContacts: jede gelieferte Hauswandzelle ergibt einen gültigen Durchgang', () => {
    for (const shape of ['square', 'round'] as const) {
      for (const side of ['west', 'north', 'east', 'south'] as const) {
        const spec = { center: [0, 0] as const, shape, side };
        const contacts = annexContacts(spec);
        expect(contacts.length, `${shape}/${side}`).toBeGreaterThanOrEqual(3);
        const res = build({ ...spec, center: [0, 0], passages: contacts.map((c) => ({ pos: [c.at[0], 1, c.at[1]] as Vec3, facing: c.facing })) });
        expect(res.warnings, `${shape}/${side}`).toEqual([]);
        expect(res.towers[0]!.annex!.passages.length).toBe(contacts.length);
      }
    }
  });

  it('ungültige Durchgänge bleiben zu (Hinweis): kein Kontakt, unter der Platte', () => {
    const res = build(stairTower({ baseY: 0, passages: [...doors(), { pos: [14, 1, 7], facing: 'east' }, { pos: [14, -3, 4], facing: 'east' }] }));
    expect(res.warnings).toEqual([
      'fort:a1: Durchgang bei 14,7 (y=1) trifft keinen Geschossring des Turms – bleibt zu',
      'fort:a1: 1 Durchgang/Durchgänge unter der Bodenplatte – bleiben zu',
    ]);
    expect(res.towers[0]!.annex!.passages).toEqual([[16, 1, 4], [16, 5, 4]]);
  });

  it('Höhe: Geschosse, oberste Tür + 1 Geschoss, Kontakt, Freiraum (Stube über dem Haus)', () => {
    const { contactTop: _, ...free } = stairTower();
    expect(build(free).towers[0]!.topY).toBe(8); // Tür bei 4 + Geschoss
    expect(build({ ...free, levels: 3 }).towers[0]!.topY).toBe(12);
    const look = build(stairTower({ top: 'lookout', contactTop: 9, clearTop: 14 })).towers[0]!;
    expect(look.topY).toBe(16); // Kopfbänder bei topY − 1 = 15 > 14
    const corner = build(stairTower({ kind: 'corner', top: 'roof', contactTop: 9 })).towers[0]!;
    expect(corner.topY).toBe(10); // Eckturm: Dachgeschoss ganz über der Kontaktlinie
  });

  it('ohne Türen: Bodenplatte aus dem Gelände, Eingang optional', () => {
    const slope = { groundY: (x: number) => Math.floor(x / 4) };
    const res = buildStructures({ annexTowers: [{ center: [18, 4], side: 'west', entrance: true }] }, { ground: slope });
    const t = res.towers[0]!;
    expect(t.baseY).toBe(Math.floor(21 / 4) + 1);
    expect(t.door).toBeDefined();
    expect(floatingCells(res.cells, slope)).toEqual([]);
  });
});
