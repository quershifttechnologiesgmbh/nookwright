/**
 * W2 (26.09.2026, W2-FW „freie Sicht durchs Fenster“): direkt hinter einer Scheibe steht in Blickhöhe (Boden+1,
 * Boden+2) nur Niedriges/Durchsichtiges, in der übrigen Sichtachse (Tiefe 2…3) kein Stauraum-Möbel (Truhe, Schrank,
 * Regal, Fass). Pflicht vor Sicht: passt ein Pflichtobjekt sonst nicht, wird gelockert (Hinweis in `notes`).
 */
import { describe, expect, it } from 'vitest';
import { cellKey } from '@mcda/core';
import { WINDOW_VIEW_DEPTH, analyzeRoom, expandComponent, furnishRoom, placeComponent, type RoomGeometry } from '../src/index.js';
import { DV, assertHardGuarantees, catalog, shellRoom } from './fixtures.js';

const OK = /^minecraft:(.*lantern|.*candle.*|flower_pot|potted_.*|.*carpet|.*pressure_plate|.*chain|torch|wall_torch|soul_torch|.*button|lever)$/;
const OK_SHAPES = new Set(['lantern', 'candle', 'carpet', 'pressure_plate', 'chain', 'torch', 'flower_pot', 'button']);

function check(g: RoomGeometry, type: string, seed: number): { near: number; storage: number; relaxed: boolean } {
  const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
  assertHardGuarantees(g, r, `${type} ${g.roomId} seed ${seed}`);
  const near = new Set(g.windows.map((w) => cellKey(w.inside[0], w.inside[1])));
  const view = analyzeRoom(g).windowView!;
  let nearHits = 0;
  let storageHits = 0;
  for (const p of r.placements) {
    const def = catalog.get(p.componentId);
    const placed = placeComponent(expandComponent(def, p.variantId), p.pose);
    for (const c of placed.cells) {
      const [x, y, z] = c.pos;
      if (y <= g.baseY || y > g.baseY + 2 || !view.has(x, z)) continue;
      const ok = c.mat.block !== undefined ? OK.test(c.mat.block) : OK_SHAPES.has(c.mat.shape ?? '');
      if (ok) continue;
      if (near.has(cellKey(x, z))) nearHits++;
      else if (def.category === 'storage') storageHits++;
    }
  }
  const relaxed = r.quality.notes.some((n) => n.includes('Fenstersicht'));
  return { near: nearHits, storage: storageHits, relaxed };
}

describe('W2-FW: freie Sicht durchs Fenster', () => {
  it('Sichtachse: Tiefe 1 … 3 hinter jeder Scheibe, nur Innenzellen', () => {
    const g = shellRoom(8, 7);
    const a = analyzeRoom(g);
    expect(a.windowView!.size).toBeGreaterThan(0);
    for (const w of g.windows) expect(a.windowView!.has(w.inside[0], w.inside[1])).toBe(true);
    for (const c of a.windowView!) expect(g.interior.has(c[0], c[1])).toBe(true);
    expect(WINDOW_VIEW_DEPTH).toBe(3);
  });

  it('alle Raumtypen (Fenster alle 3 Zellen, 3 Seeds): nichts Hohes direkt hinter dem Glas, kein Stauraum in der Sichtachse – außer bei Pflicht-Lockerung', () => {
    let relaxed = 0;
    let rooms = 0;
    for (const type of catalog.roomTypeIds()) {
      for (const g of [shellRoom(10, 8, { windowSpacing: 3 }), shellRoom(12, 9, { windowSpacing: 3, inner: ['north'] })]) {
        if (g.interior.size < catalog.roomType(type).minArea) continue;
        for (let seed = 0; seed < 3; seed++) {
          const r = check(g, type, seed);
          rooms++;
          if (r.relaxed) {
            relaxed++;
            continue;
          }
          expect(r.near, `${type} ${g.roomId} seed ${seed}: Möbel direkt hinter der Scheibe`).toBe(0);
          expect(r.storage, `${type} ${g.roomId} seed ${seed}: Stauraum in der Sichtachse`).toBe(0);
        }
      }
    }
    // Pflicht vor Sicht bleibt die Ausnahme
    expect(relaxed / rooms).toBeLessThan(0.1);
  });
});
