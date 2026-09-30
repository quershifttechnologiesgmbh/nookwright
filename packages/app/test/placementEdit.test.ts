/**
 * W2-ED U5: Möbel bearbeiten – verschieben (samt aufgesetzten Teilen), drehen, tauschen, Variante; nur gültige Lagen,
 * je Aktion ein Undo-Schritt, nur dieses Möbel ändert sich. Dazu die reinen Anfasser-Hilfen aus U4 (edgeAt, resizeByEdge).
 */
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { edgeAt, resizeByEdge } from '../src/editor/grid.js';
import * as pe from '../src/placementEdit.js';
import { changeScope } from '../src/ui/changeScope.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const catalog = loadBundledCatalog().catalog!;

describe('Möbel bearbeiten', () => {
  const s0 = sampleSession(catalog);
  const st = s0.project.state;
  // ein Möbel mit aufgesetzten Teilen und eines, das sich bewegen lässt
  const parent = st.placements.find((p) => st.placements.some((c) => c.parentId === p.id));
  const movable = st.placements
    .filter((p) => p.parentId === undefined)
    .flatMap((p) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ p, dx: dx!, dz: dz! })))
    .find(({ p, dx, dz }) => pe.placementProblem(s0, catalog, p.id, { poses: new Map([[p.id, { ...p.pose, pos: [p.pose.pos[0] + dx, p.pose.pos[1], p.pose.pos[2] + dz] }]]) }) === undefined);

  it('verschieben: 1 Feld, ein Undo-Schritt, nur dieses Möbel ändert sich', () => {
    expect(movable).toBeDefined();
    const { p, dx, dz } = movable!;
    const s1 = pe.nudgePlacement(s0, catalog, p.id, dx, dz);
    expect(s1.past.length).toBe(s0.past.length + 1);
    const q = s1.project.state.placements.find((x) => x.id === p.id)!;
    expect(q.pose.pos).toEqual([p.pose.pos[0] + dx, p.pose.pos[1], p.pose.pos[2] + dz]);
    const sc = changeScope(st, s1.project.state);
    expect(sc.edited).toEqual([p.roomId]); // nur geändert, nicht neu eingerichtet
    expect(sc.rebuilt).toEqual([]);
    // alle anderen Möbel des Raums bleiben, wo sie waren (aufgesetzte Teile wandern mit: W3 (27.09.2026) – mit den
    // Signatur-Anordnungen ist das erste verschiebbare Möbel der Beispielsitzung eines mit Kind)
    const others = (s: typeof s0) => s.project.state.placements.filter((x) => x.roomId === p.roomId && x.id !== p.id && x.parentId !== p.id).map((x) => `${x.id}:${x.pose.pos}`);
    expect(others(s1)).toEqual(others(s0));
    expect(uc.undo(s1).project.state).toEqual(st);
  });

  it('verschieben ins Nichts bzw. in ein anderes Möbel wird abgelehnt (mit Grund, nichts ändert sich)', () => {
    const p = st.placements.find((x) => x.parentId === undefined)!;
    expect(() => pe.nudgePlacement(s0, catalog, p.id, 60, 0)).toThrow(/ragt aus dem Raum/);
    const room = st.rooms.find((r) => r.id === p.roomId)!;
    const other = st.placements.find((x) => x.roomId === room.id && x.id !== p.id && x.parentId === undefined && x.pose.pos[1] === p.pose.pos[1]);
    if (other !== undefined) {
      const why = pe.placementProblem(s0, catalog, p.id, { poses: new Map([[p.id, other.pose]]) });
      expect(why).toBeDefined();
    }
  });

  it('aufgesetzte Teile wandern mit (Gruppe), drehen dreht Gruppe um die Mitte', () => {
    if (parent === undefined) return;
    const kids = st.placements.filter((c) => c.parentId === parent.id);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      let s1;
      try {
        s1 = pe.nudgePlacement(s0, catalog, parent.id, dx, dz);
      } catch {
        continue;
      }
      for (const k of kids) {
        const moved = s1.project.state.placements.find((x) => x.id === k.id)!;
        expect(moved.pose.pos).toEqual([k.pose.pos[0] + dx, k.pose.pos[1], k.pose.pos[2] + dz]);
      }
      break;
    }
    let r;
    try {
      r = pe.rotatePlacement(s0, catalog, parent.id);
    } catch (e) {
      expect(String(e)).toMatch(/ragt aus dem Raum|stößt an/);
      return;
    }
    const rp = r.project.state.placements.find((x) => x.id === parent.id)!;
    expect(rp.pose.rot).toBe((parent.pose.rot + 1) % 4);
    for (const k of kids) expect(r.project.state.placements.find((x) => x.id === k.id)!.pose.rot).toBe((k.pose.rot + 1) % 4);
  });

  it('tauschen: höchstens drei passende Alternativen; Tausch behält ID und Lage, wird „manual“', () => {
    const cand = st.placements.filter((p) => p.parentId === undefined).map((p) => ({ p, opts: pe.swapOptions(s0, catalog, p.id) })).find((x) => x.opts.length > 0);
    expect(cand).toBeDefined();
    const { p, opts } = cand!;
    expect(opts.length).toBeLessThanOrEqual(3);
    for (const o of opts) expect(pe.placementProblem(s0, catalog, p.id, { swap: { componentId: o.componentId, variantId: o.variantId } })).toBeUndefined();
    const s1 = pe.swapPlacement(s0, catalog, p.id, opts[0]!.componentId, opts[0]!.variantId);
    const q = s1.project.state.placements.find((x) => x.id === p.id)!;
    expect(q).toMatchObject({ componentId: opts[0]!.componentId, origin: 'manual', pose: p.pose });
    expect(s1.past.length).toBe(s0.past.length + 1);
  });

  it('Variante: nächste/vorige zyklisch', () => {
    const withVariants = st.placements.find((p) => (catalog.find(p.componentId)?.variants?.length ?? 0) > 1);
    if (withVariants === undefined) return;
    const vs = catalog.find(withVariants.componentId)!.variants!;
    const next = pe.nextVariant(catalog, withVariants, 1)!;
    const prev = pe.nextVariant(catalog, { ...withVariants, variantId: next }, -1)!;
    expect(vs.map((v) => v.id)).toContain(next);
    expect(prev).toBe(withVariants.variantId ?? vs[0]!.id);
  });
});

describe('Anfasser (U4): Kante finden und ziehen', () => {
  const room = CellSet.rect(4, 4, 9, 7); // 6 × 4
  it('edgeAt trifft die Kanten des Rechtecks (mit Toleranz), innen nichts', () => {
    expect(edgeAt(room, 10, 6)).toBe('east');
    expect(edgeAt(room, 4.2, 5)).toBe('west');
    expect(edgeAt(room, 6, 4.1)).toBe('north');
    expect(edgeAt(room, 6, 8.3)).toBe('south');
    expect(edgeAt(room, 6.5, 6)).toBeUndefined();
    expect(edgeAt(room, 20, 6)).toBeUndefined();
  });
  it('resizeByEdge: nach außen wächst jede Reihe, nach innen fällt weg, mindestens eine Reihe bleibt', () => {
    const grow = resizeByEdge(room, 'east', 11);
    expect(grow.add).toHaveLength(2 * 4);
    expect(grow.remove).toEqual([]);
    const shrink = resizeByEdge(room, 'north', 6);
    expect(shrink.remove).toHaveLength(2 * 6);
    expect(resizeByEdge(room, 'west', 20).remove).toHaveLength(5 * 4); // begrenzt: eine Spalte bleibt
    // L-Form: nur Reihen, die an die Kante stoßen, wachsen
    const l = CellSet.rect(0, 0, 3, 1).union(CellSet.rect(0, 2, 1, 3));
    expect(resizeByEdge(l, 'east', 4).add).toEqual([[4, 0], [4, 1]]);
  });
});
