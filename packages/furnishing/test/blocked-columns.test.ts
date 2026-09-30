import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { RoomPlanner, expandComponent, furnishRoom } from '../src/index.js';
import { DV, catalog, shellRoom } from './fixtures.js';

/**
 * Befund A0 (Bautyp-Fuzz): Die Pipeline nimmt Treppe/Deckenöffnung/Geländer aus `interior` heraus und gibt sie als
 * `blocked` weiter (außerhalb der Innenfläche). Auch Luftmasken (Front-Freiraum) und Entities (Rahmen) dürfen
 * nicht in diese Spalten zeigen – vorher sperrte der Solver nur Blöcke.
 */
describe('Gesperrte Spalten außerhalb der Innenfläche sperren auch Luft und Entities', () => {
  it('kein Kandidat mit Luft oder Entity im Treppenloch', { timeout: HEAVY_TIMEOUT }, () => {
    const base = shellRoom(12, 10);
    // Loch eine Zelle vor der Nordwand: Front-Freiraum von Möbeln an der Nordwand zeigte hinein
    const hole = CellSet.rect(3, 1, 6, 2);
    const geom = { ...base, interior: base.interior.difference(hole), blocked: hole };
    const planner = new RoomPlanner(geom);
    let tested = 0;
    for (const def of catalog.all()) {
      if (def.mount !== 'floor' && def.mount !== 'wall') continue;
      for (const variant of def.variants?.map((v) => v.id) ?? [undefined]) {
        const exp = expandComponent(def, variant);
        if (exp.air.length === 0 && exp.entities.length === 0) continue;
        for (const p of planner.poses(def, variant)) {
          for (const a of p.air) expect(hole.has(a[0], a[2]), `${def.id}#${variant} Luft ${a.join(',')}`).toBe(false);
          for (const e of p.entities) expect(hole.has(Math.floor(e.pos[0]), Math.floor(e.pos[2])), `${def.id}#${variant} Entity`).toBe(false);
          tested++;
        }
      }
    }
    expect(tested).toBeGreaterThan(100);
  });
});

describe('Fläche mit Treppe: gesperrte Zellen nur einmal abgezogen', () => {
  it('gleiche Fläche, ob `blocked` in `interior` liegt oder schon herausgenommen ist', () => {
    const base = shellRoom(8, 6); // innen 6 × 4 = 24
    const hole = CellSet.rect(2, 1, 3, 2); // 4 Zellen
    const inside = { ...base, blocked: hole };
    const outside = { ...base, interior: base.interior.difference(hole), blocked: hole };
    // `minArea` über der korrekten Fläche (24 − 4 = 20): die Warnung nennt die berechnete Fläche, ein doppelter
    // Abzug (16) wäre also sichtbar. Q1b: die frühere Prüfung auf gleiche Platzierungszahl war kein gültiger
    // Invariant – die beiden Geometrien unterscheiden sich in der Wandklassifikation am Loch, optionale Deko darf
    // daher abweichen (gemessen: 8 bzw. 9 Platzierungen, gleiche Fläche, beide ohne Warnung).
    const rt = { ...catalog.roomType('bedroom'), minArea: 21 };
    const a = furnishRoom(inside, rt, catalog, { seed: 3, dataVersion: DV });
    const b = furnishRoom(outside, rt, catalog, { seed: 3, dataVersion: DV });
    const areaWarnings = (w: readonly string[]): string[] => w.filter((x) => /kleiner als das Minimum/.test(x));
    expect(areaWarnings(a.warnings)).toEqual([`Raum ist mit 20 Zellen kleiner als das Minimum 21 für „${rt.name}“`]);
    expect(areaWarnings(b.warnings)).toEqual(areaWarnings(a.warnings));
  });
});
