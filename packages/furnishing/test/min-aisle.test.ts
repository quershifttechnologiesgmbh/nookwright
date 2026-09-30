/**
 * P07 (`plan/auftraege/PO_qualitaet_abschluss.md`): Der Mittelgang eines Raumtyps ist **verbindlich**, wenn
 * `FurnishOptions.minAisle` gesetzt ist. Ohne die Option bleibt alles wie bisher (bitgleich), mit der Option wird
 * der Gang nie ganz aufgegeben und ein unauflösbarer Konflikt wird ausdrücklich gemeldet.
 */
import { describe, expect, it } from 'vitest';
import { furnishRoom } from '../src/index.js';
import { catalog, DV, shellRoom } from './fixtures.js';

const MIT_GANG = catalog.roomTypeIds().filter((id) => catalog.roomType(id).aisle !== undefined);

describe('P07: verbindlicher Mittelgang', () => {
  it('ohne die Option ist das Ergebnis bitgleich zu vorher', () => {
    const rt = catalog.roomType(MIT_GANG[0]!);
    const g = shellRoom(9, 8);
    const ohne = furnishRoom(g, rt, catalog, { seed: 3, dataVersion: DV });
    const aus = furnishRoom(g, rt, catalog, { seed: 3, dataVersion: DV, minAisle: false });
    expect(aus.placements).toEqual(ohne.placements);
    expect(aus.warnings).toEqual(ohne.warnings);
  });

  it('der Gang wird nicht mehr aufgegeben, und der Konflikt wird gemeldet', () => {
    const faelle: string[] = [];
    let geprueft = 0;
    for (const id of MIT_GANG) {
      const rt = catalog.roomType(id);
      for (const [w, d] of [[5, 5], [6, 5], [6, 6], [7, 6], [8, 7], [9, 8], [10, 8], [12, 9], [14, 10]] as const) {
        const g = shellRoom(w, d);
        const ohne = furnishRoom(g, rt, catalog, { seed: 5, dataVersion: DV });
        const mit = furnishRoom(g, rt, catalog, { seed: 5, dataVersion: DV, minAisle: true });
        faelle.push(`${id} ${w}x${d}: ohne Layout=${ohne.layout !== undefined}, mit Layout=${mit.layout !== undefined}`);
        if (ohne.layout === undefined && mit.layout !== undefined) {
          geprueft++;
          // Mit der Option bleibt der Gang stehen (mindestens die deklarierte Mindestbreite).
          expect(mit.layout!.aisle?.width ?? 0, `${id} ${w}x${d}`).toBeGreaterThanOrEqual(rt.aisle?.minWidth ?? 1);
        }
        // Ein Konflikt zwischen Gang und Pflichtmöbeln wird nie verschwiegen.
        const konflikt = mit.warnings.some((x) => x.startsWith('Mittelgang verbindlich'));
        const pflicht = mit.warnings.some((x) => x.startsWith('Pflichtobjekt'));
        expect(konflikt, `${id} ${w}x${d}: Pflichtkonflikt ohne Befund\n${faelle.join('\n')}`).toBe(pflicht ? true : konflikt);
      }
    }
    // Die Zusage ist nur etwas wert, wenn mindestens ein Fall die frühere Aufgabe wirklich ausgelöst hätte.
    expect(geprueft, `kein Fall mit aufgegebenem Layout gefunden:\n${faelle.join('\n')}`).toBeGreaterThan(0);
  });

  it('bleibt nach erneuter Einrichtung mit demselben Seed gleich (Regeneration)', () => {
    const rt = catalog.roomType(MIT_GANG[0]!);
    const g = shellRoom(9, 8);
    const a = furnishRoom(g, rt, catalog, { seed: 11, dataVersion: DV, minAisle: true });
    const b = furnishRoom(g, rt, catalog, { seed: 11, dataVersion: DV, minAisle: true });
    expect(b.placements).toEqual(a.placements);
    expect(b.layout).toEqual(a.layout);
  });
});
