/**
 * Wege-Bericht (research/38 §7, P1): genau die drei Prüfungen, die es vorher nirgends gab – jede Tür hat einen
 * Weg, kein Weg endet unvermittelt, keine Insel. Der Bericht ändert nichts am Gelände.
 */
import { describe, expect, it } from 'vitest';
import { PlotGrid } from '../src/grid.js';
import { auditPaths } from '../src/path-audit.js';
import { loadStyles } from './helpers.js';
import { generateSite } from '../src/generate.js';
import { fullSite, syntheticBuilding } from './fixtures.js';

/** 10×10-Grundstück ab (0,0) mit gesetzter Wegkarte. */
function raster(weg: ReadonlyArray<readonly [number, number]>, zone?: ReadonlyArray<readonly [number, number]>): { grid: PlotGrid; path: Uint8Array; zone: (string | null)[] } {
  const grid = new PlotGrid({ minX: 0, minZ: 0, maxX: 9, maxZ: 9 });
  const path = new Uint8Array(grid.size);
  const zonen: (string | null)[] = new Array<string | null>(grid.size).fill(null);
  for (const [x, z] of weg) path[grid.idx(x, z)] = 1;
  for (const [x, z] of zone ?? []) zonen[grid.idx(x, z)] = 'z1';
  return { grid, path, zone: zonen };
}

describe('Wege-Bericht (pathAudit)', () => {
  it('meldet eine Tür ohne Weganschluss', () => {
    const { grid, path } = raster([[5, 5], [6, 5], [7, 5]]);
    const a = auditPaths(grid, path, [[5, 5], [1, 1]]);
    expect(a.unconnectedDoors).toEqual([[1, 1]]);
    expect(a.warnings.join()).toContain('ohne Weganschluss');
  });

  it('Sackgasse: nur ein Weg-Nachbar und kein Ziel – am Grundstücksrand aber erlaubt', () => {
    // Stichweg von (2,2) nach (5,2) mit Abzweig nach (5,5)
    const { grid, path } = raster([[2, 2], [3, 2], [4, 2], [5, 2], [5, 3], [5, 4], [5, 5]]);
    // Beide Enden haben nur einen Weg-Nachbarn und kein Ziel → beide sind Sackgassen
    expect(auditPaths(grid, path, []).deadEnds).toEqual([[2, 2], [5, 5]]);
    // Mit Tür an (2,2) bleibt nur das andere Ende
    expect(auditPaths(grid, path, [[2, 2]]).deadEnds).toEqual([[5, 5]]);
    // Am Grundstücksrand (9,2) ist das Ende erlaubt – das andere Ende (7,2) bleibt eine Sackgasse
    const r = raster([[7, 2], [8, 2], [9, 2]]);
    expect(auditPaths(r.grid, r.path, []).deadEnds).toEqual([[7, 2]]);
  });

  it('Zone, Tor und Brunnen zählen als Ziel (dort darf ein Weg enden)', () => {
    const { grid, path, zone } = raster([[2, 2], [3, 2], [4, 2]], [[4, 2]]);
    // Das Zonenende ist ein Ziel; der Anfang ohne Ziel bleibt eine Sackgasse
    expect(auditPaths(grid, path, [], [], zone).deadEnds).toEqual([[2, 2]]);
    const g = raster([[2, 2], [3, 2], [4, 2]]);
    // Tor/Brunnen am Ende: nur der Anfang (2,2) bleibt ohne Ziel
    expect(auditPaths(g.grid, g.path, [], [[4, 2]]).deadEnds).toEqual([[2, 2]]);
    expect(auditPaths(g.grid, g.path, [], []).deadEnds).toEqual([[2, 2], [4, 2]]);
  });

  it('Insel: Wegstück ohne jedes Ziel (in der Mitte, weg vom Grundstücksrand)', () => {
    const { grid, path } = raster([[1, 1], [2, 1], [4, 6], [5, 6]]);
    const a = auditPaths(grid, path, [[1, 1]]);
    expect(a.islandCells).toEqual([[4, 6], [5, 6]]);
    expect(a.warnings.join()).toContain('ohne Ziel');
    // Wege am Rand gelten als angeschlossen (dort endet der Weg bewusst)
    const rand = raster([[8, 2], [9, 2]]);
    expect(auditPaths(rand.grid, rand.path, []).islandCells).toEqual([]);
  });

  it('Ränge werden gezählt (Pfad/Nebenweg/Hauptweg)', () => {
    const { grid, path } = raster([[1, 1], [2, 1], [3, 1], [4, 1]]);
    path[grid.idx(2, 1)] = 2;
    path[grid.idx(3, 1)] = 3;
    const a = auditPaths(grid, path, []);
    expect(a.ranks).toEqual({ path: 2, side: 1, main: 1 });
  });

  it('Licht am Weg wird gemessen (Taxi-Abstand zur nächsten Laterne je Rang)', () => {
    const { grid, path } = raster([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
    path[grid.idx(1, 1)] = 3; // Hauptweg
    path[grid.idx(2, 1)] = 2; // Nebenweg
    const ohne = auditPaths(grid, path, []);
    expect(ohne.lightGaps).toEqual({ main: -1, side: -1, path: -1 }); // kein Licht → -1
    const mit = auditPaths(grid, path, [], [], undefined, [[1, 1]]);
    expect(mit.lightGaps.main).toBe(0); // Laterne direkt auf der Hauptwegzelle
    expect(mit.lightGaps.side).toBe(1);
    expect(mit.lightGaps.path).toBe(4); // die übrigen Pfadzellen (3,1)–(5,1) sind 2–4 Blöcke weg
  });

  it('Wegbreite: ein ein Block breiter Weg misst 1, ein breites Band gilt als nicht messbar', () => {
    // 1 breiter Weg nach Norden (Rang 1): Querlauf = 1
    const schmal = raster([[2, 2], [2, 3], [2, 4], [2, 5]]);
    expect(auditPaths(schmal.grid, schmal.path, []).widths.path).toBe(1);
    // 3 breites Band: jede Zelle hat Nachbarn in beiden Achsen → nicht messbar (0), nie geschätzt
    const band = raster([[2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3], [2, 4], [3, 4], [4, 4]]);
    expect(auditPaths(band.grid, band.path, []).widths.path).toBe(0);
    // ohne Weg dieses Rangs ebenfalls 0
    expect(auditPaths(schmal.grid, schmal.path, []).widths.main).toBe(0);
  });

  it('alle fünf Katalog-Geländestile sind sauber: 0 ohne Weg, 0 Sackgassen, 0 Inseln', () => {
    for (const id of ['meadow', 'forest', 'hills', 'farmland', 'homestead']) {
      const r = generateSite(fullSite(7).state, loadStyles().get(id)!, syntheticBuilding());
      expect(r.pathAudit.unconnectedDoors, `${id}: Türen`).toEqual([]);
      expect(r.pathAudit.deadEnds, `${id}: Sackgassen`).toEqual([]);
      expect(r.pathAudit.islandCells, `${id}: Inseln`).toEqual([]);
      expect(r.pathAudit.warnings, `${id}: Meldungen`).toEqual([]);
      expect(r.pathAudit.ranks.main + r.pathAudit.ranks.side + r.pathAudit.ranks.path, `${id}: Wegzellen`).toBeGreaterThan(20);
      // Licht am Weg (research/37/38: alle 6–8 Blöcke): alle fünf Stile beleuchten den Hauptweg jetzt;
      // vorher klafften ohne Lichtprofil 29–43 Blöcke (Befund in research/43 §4)
      expect(r.pathAudit.lightGaps.main, `${id}: Licht am Hauptweg`).toBeLessThanOrEqual(10);
      expect(r.pathAudit.lightGaps.main, `${id}: Licht am Hauptweg`).toBeGreaterThanOrEqual(0);
    }
  });
});
