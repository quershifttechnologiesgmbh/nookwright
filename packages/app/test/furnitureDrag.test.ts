/**
 * W7-G: Möbel mit der Maus ziehen – reine Teile (Zieh-Ebene, Treffer im Grundriss, Texte) und derselbe Weg wie die
 * Pfeiltasten: Vorschau `nudgeProblem` = Ablehnungsgrund von `nudgePlacement`, gültige Verschiebung = ein Undo-Schritt.
 */
import { describe, expect, it } from 'vitest';
import { DomainError } from '@mcda/blueprint';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { dragText, groupIds, planeCell, placementAtCell, shiftBox, bottomY } from '../src/editor/furnitureDrag.js';
import * as pe from '../src/placementEdit.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const catalog = loadBundledCatalog().catalog!;

describe('Zieh-Ebene und Texte', () => {
  it('Strahl von oben schräg trifft die Ebene y + ½ in der erwarteten Zelle; parallel/rückwärts = nichts', () => {
    expect(planeCell([0.5, 11.5, 0.5], [0.6, -1, 0.2], 1)).toEqual([6, 2]);
    expect(planeCell([3.2, 1.5, 4.9], [1, 0, 0], 1)).toBeUndefined();
    expect(planeCell([0, 10, 0], [0, 1, 0], 1)).toBeUndefined();
    expect(planeCell([-0.5, 5.5, -2.5], [0, -1, 0], 2)).toEqual([-1, -3]);
  });

  it('Status: Richtung in Worten, bei Ablehnung der Grund', () => {
    expect(dragText('Tisch', [0, 0], undefined)).toBe('Tisch: ziehen verschiebt · Esc bricht ab');
    expect(dragText('Tisch', [2, -1], undefined)).toBe('Tisch: 2 nach Osten, 1 nach Norden – loslassen verschiebt');
    expect(dragText('Tisch', [-1, 0], 'Tisch stößt an ein anderes Möbel')).toBe('Tisch: 1 nach Westen – passt nicht: Tisch stößt an ein anderes Möbel');
    expect(shiftBox({ min: [1, 2, 3], max: [4, 5, 6] }, [1, -2])).toEqual({ min: [2, 2, 1], max: [5, 5, 4] });
  });
});

describe('Ziehen im Beispielhaus', () => {
  const s = sampleSession(catalog);
  const st = s.project.state;
  const views = uc.placedViews(st, catalog);
  const shell = uc.shellOf(s.project, uc.shellStyle(s));
  const rooms = new Map(st.rooms.map((r) => [r.id, shell.rooms.get(r.id)!.baseY]));

  it('Treffer im Grundriss: Standmöbel vor Aufgesetztem, leere Zelle = nichts', () => {
    const parent = st.placements.find((p) => p.parentId === undefined && st.placements.some((c) => c.parentId === p.id))!;
    const v = views.find((x) => x.placement.id === parent.id)!;
    const c = v.placed.cells.find((x) => x.pos[1] === bottomY(v))!;
    expect(placementAtCell(views, rooms, [c.pos[0], c.pos[2]])).toBe(parent.id);
    expect(groupIds(st, parent.id).size).toBeGreaterThan(1);
    expect(placementAtCell(views, rooms, [39, 29])).toBeUndefined();
  });

  it('Vorschau = Prüfung beim Loslassen: ungültig mit demselben Grund, gültig ein Undo-Schritt', () => {
    let tried = 0;
    for (const p of st.placements.filter((x) => x.parentId === undefined)) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [5, 0]] as const) {
        const why = pe.nudgeProblem(s, catalog, p.id, dx, dz);
        if (why === undefined) {
          const next = pe.nudgePlacement(s, catalog, p.id, dx, dz);
          expect(next.past.length).toBe(s.past.length + 1);
          expect(next.project.state.placements.find((x) => x.id === p.id)!.pose.pos).toEqual([p.pose.pos[0] + dx, p.pose.pos[1], p.pose.pos[2] + dz]);
        } else {
          expect(() => pe.nudgePlacement(s, catalog, p.id, dx, dz)).toThrow(DomainError);
          expect(() => pe.nudgePlacement(s, catalog, p.id, dx, dz)).toThrow(why);
        }
        tried++;
      }
      if (tried >= 30) break;
    }
    expect(pe.nudgeProblem(s, catalog, 'p-unbekannt', 1, 0)).toContain('Unbekanntes Möbel');
  });
});
