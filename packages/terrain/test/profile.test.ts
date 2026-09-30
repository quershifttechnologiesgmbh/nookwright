/**
 * Außenprofil (Agent FA) ↔ Gelände (M2): Profilspalten sperren Pflanzen, vor dem Sockel liegt das Gelände eine
 * Reihe tiefer (Traufstreifen), vor der Tür bleibt das Podest auf y0; über den Sockel führt kein Weg.
 * Synthetisches Gebäude (fixtures) mit Sockel rundum außer vor der Tür.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, key3 } from '@mcda/core';
import { NO_BUILDING, generateSite, type BuildingInfo } from '../src/index.js';
import { TEST_STYLE, fullSite, syntheticBuilding } from './fixtures.js';

function withPlinth(): BuildingInfo {
  const b = syntheticBuilding();
  const ring = CellSet.rect(-1, -1, 11, 9).difference(b.footprint).difference(CellSet.of([[5, -1]])); // Lücke vor der Tür
  const occupied = new Set(b.occupied);
  for (const [x, z] of ring) occupied.add(key3([x, b.y0, z]));
  return { ...b, occupied, profile: ring, plinth: ring };
}

describe('Gelände mit Außenprofil (Sockel, Vorlagen)', () => {
  const b = withPlinth();
  const res = generateSite(fullSite().state, TEST_STYLE, b);
  const top = (x: number, z: number): number => res.top[res.grid.idx(x, z)]!;

  it('Sockelspalten und Traufstreifen (Pad-Ring) liegen auf y0 − 1, das Türpodest auf y0', () => {
    for (const [x, z] of b.plinth!) expect(top(x, z), `Sockel ${x},${z}`).toBe(b.y0 - 1);
    for (const [x, z] of CellSet.rect(-2, -2, 12, 10).difference(CellSet.rect(-1, -1, 11, 9))) {
      // W3 (27.09.2026, Übergabe W3-EN): der Laufweg vor der Tür (bis padWidth + 1; seitlich nur, wo kein Sockel davor
      // liegt – hier läuft der Sockel neben der Tür, also nur die Mittelspur) bleibt auf y0 – keine Mulde
      if (x === 5 && z === -2) {
        expect(top(x, z), `Laufweg ${x},${z}`).toBe(b.y0);
        continue;
      }
      expect(top(x, z), `Traufstreifen ${x},${z}`).toBe(b.y0 - 1);
    }
    expect(top(5, -1), 'Podest vor der Tür').toBe(b.y0);
    // Talus bleibt gewahrt (Stufe ≤ 1), die Oberfläche des Streifens ist Pflaster, unter dem Sockel Erde
    expect(res.surface[res.grid.idx(-2, 4)]).toBe('ground_yard');
    expect(res.surface[res.grid.idx(-1, 4)]).toBe('ground_dirt');
  });

  it('keine Pflanze, kein Busch, kein Baum in Profilspalten oder auf dem Traufstreifen', () => {
    const strip = CellSet.rect(-2, -2, 12, 10).difference(b.footprint);
    const bad = res.cells.filter((c) => c.kind === 'plant' && strip.has(c.pos[0], c.pos[2]));
    expect(bad.map((c) => `${c.role}@${c.pos}`)).toEqual([]);
  });

  it('Wege queren den Sockel nicht; die Tür bleibt Ausgang', () => {
    for (const [x, z] of res.paths) expect(b.plinth!.has(x, z), `Weg über Sockel ${x},${z}`).toBe(false);
    expect(res.paths.has(5, -1)).toBe(true);
  });

  it('ohne Profil bleibt alles wie bisher (Pad auf y0)', () => {
    const plain = generateSite(fullSite().state, TEST_STYLE, syntheticBuilding());
    expect(plain.top[plain.grid.idx(-1, 4)]).toBe(syntheticBuilding().y0);
    expect(generateSite(fullSite().state, TEST_STYLE, NO_BUILDING).warnings).toEqual(generateSite(fullSite().state, TEST_STYLE).warnings);
  });
});
