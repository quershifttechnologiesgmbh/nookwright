/** Plan „Umgebung“: Sichtfenster, Gesten und Mauerzug-Entwurf (reine Hilfen aus editor/siteGrid.ts). */
import type { Cell } from '@mcda/core';
import { brushCells } from '@mcda/terrain';
import { describe, expect, it } from 'vitest';
import {
  PATH_RANKS, brushRadius, draftClick, draftFinish, fitView, interpretSiteGesture, panView, planBounds, planColor, snapPoint, strokeCells, viewCell, zoomView,
  type SculptChoice,
} from '../src/editor/siteGrid.js';
import { GRID } from '../src/usecases.js';

describe('Runder Pinsel (Weg, Glätten)', () => {
  const sculpt: SculptChoice = { tool: 'raise', amount: 2, level: 0, radius: 3 };

  it('nur Weg und Glätten malen mit dem Pinsel, alles andere mit dem Rechteck', () => {
    expect(brushRadius('zone', 'path', sculpt, 1)).toBe(1);
    expect(brushRadius('zone', 'field', sculpt, 1)).toBeUndefined();
    expect(brushRadius('sculpt', 'path', { ...sculpt, tool: 'smooth' }, 1)).toBe(3);
    expect(brushRadius('sculpt', 'path', sculpt, 1)).toBeUndefined();
    expect(brushRadius('select', 'path', { ...sculpt, tool: 'smooth' }, 1)).toBeUndefined();
  });

  it('Strich: Pinsel der Domäne entlang der Strecke, ohne Lücken und ohne Doppelte', () => {
    expect(strokeCells([4, 4], [4, 4], 2)).toEqual([...brushCells([4, 4], 2)]);
    const line = strokeCells([0, 0], [10, 0], 0);
    expect(line).toHaveLength(11); // Radius 0 = eine Zelle breit, jede Zelle der Strecke
    const diag = strokeCells([0, 0], [9, 5], 1);
    const keys = new Set(diag.map(([x, z]) => `${x},${z}`));
    expect(keys.size).toBe(diag.length);
    for (let x = 0; x <= 9; x++) expect(keys.has(`${x},${Math.round((5 * x) / 9)}`), `Spalte ${x}`).toBe(true);
    expect(strokeCells([0, 0], [0, 6], 1)).toHaveLength(3 * 7 + 2); // 3 breit + Kappen oben/unten
  });
});

describe('Plan-Karte aus SiteResult.plan', () => {
  it('Wege nach Rang deckend, Zonen getönt, sonst die Draufsicht', () => {
    expect(PATH_RANKS.map((r) => r.rank)).toEqual([3, 2, 1]);
    expect(planColor(0x6d9b43, 0xc8963c, 3)).toBe(PATH_RANKS[0]!.color);
    expect(planColor(0x6d9b43, undefined, 1)).toBe(PATH_RANKS[2]!.color);
    expect(planColor(0x6d9b43, undefined, 0)).toBe(0x6d9b43);
    const tinted = planColor(0x000000, 0xffffff, 0);
    expect(tinted).not.toBe(0);
    expect(tinted & 0xff).toBeGreaterThan(0x40); // 35 % Zonenfarbe
    expect(tinted & 0xff).toBeLessThan(0x80);
  });
});

describe('Mauerzug zeichnen (Tiny Glade)', () => {
  it('Klick setzt Punkte, gleiche Zelle zählt nicht (Doppelklick), Klick auf den ersten Punkt schließt ab 3 Punkten', () => {
    let pts: readonly Cell[] = [];
    for (const c of [[0, 0], [10, 0], [10, 0], [10, 8]] as Cell[]) pts = draftClick(pts, c).points;
    expect(pts).toEqual([[0, 0], [10, 0], [10, 8]]);
    expect(draftClick(pts, [1, 1])).toEqual({ points: pts, done: 'ring' }); // Nachbarzelle des Anfangs reicht
    expect(draftClick([[0, 0], [5, 0]], [0, 0]).done).toBeUndefined(); // 2 Punkte: kein Ring
    expect(draftFinish(pts)).toBe(pts);
    expect(draftFinish([[0, 0]])).toBeUndefined();
  });

  it('Umschalt rastet auf 0°, 45°, 90° zum vorigen Punkt ein', () => {
    expect(snapPoint([0, 0], [9, 2], true)).toEqual([9, 0]);
    expect(snapPoint([0, 0], [1, -7], true)).toEqual([0, -7]);
    expect(snapPoint([0, 0], [6, 5], true)).toEqual([6, 6]);
    expect(snapPoint([0, 0], [-4, 5], true)).toEqual([-5, 5]);
    expect(snapPoint([0, 0], [6, 5], false)).toEqual([6, 5]);
    expect(snapPoint(undefined, [6, 5], true)).toEqual([6, 5]);
  });
});

describe('Gesten im Modus Umgebung', () => {
  it('wie im Grundriss: Klick wählt, Ziehen malt, rechts radiert; Werkzeuge mit Klick setzen', () => {
    const a: Cell = [1, 2];
    const b: Cell = [5, 6];
    const rect = { x1: 1, z1: 2, x2: 5, z2: 6 };
    expect(interpretSiteGesture('zone', 'left', a, b)).toEqual({ kind: 'zone', rect });
    expect(interpretSiteGesture('zone', 'left', a, a)).toEqual({ kind: 'select', cell: a });
    expect(interpretSiteGesture('zone', 'right', a, b)).toEqual({ kind: 'eraseZone', rect });
    expect(interpretSiteGesture('sculpt', 'left', a, a)).toEqual({ kind: 'sculpt', rect: { x1: 1, z1: 2, x2: 1, z2: 2 } });
    expect(interpretSiteGesture('sculpt', 'right', a, b)).toEqual({ kind: 'resetSculpt', rect });
    expect(interpretSiteGesture('plot', 'left', a, b)).toEqual({ kind: 'plot', rect });
    expect(interpretSiteGesture('wall', 'left', a, b)).toEqual({ kind: 'wallPoint', cell: b });
    expect(interpretSiteGesture('wall', 'right', a, b)).toEqual({ kind: 'wallUndoPoint' });
    expect(interpretSiteGesture('gate', 'left', a, a)).toEqual({ kind: 'gate', cell: a });
    expect(interpretSiteGesture('gate', 'right', a, a)).toEqual({ kind: 'removeGate', cell: a });
    expect(interpretSiteGesture('tower', 'left', a, a)).toEqual({ kind: 'place', cell: a });
    expect(interpretSiteGesture('windmill', 'right', a, a)).toEqual({ kind: 'remove', cell: a });
    expect(interpretSiteGesture('select', 'left', a, b)).toEqual({ kind: 'drag', start: a, end: b });
  });
});

describe('Sichtfenster des Plans', () => {
  it('Einpassen zeigt Raster, Grundstück und Bauwerke; Zoom hält den Punkt unter dem Mauszeiger', () => {
    const b = planBounds({ minX: -20, minZ: -10, maxX: 60, maxZ: 40 }, [{ kind: 'tower', id: 't1', spec: { center: [80, 0] } }], 0);
    expect(b.minX).toBe(-20);
    expect(b.maxX).toBe(80 + 5); // Turm Ø 9 → Radius 4 + 1
    expect(planBounds(undefined, [], 0)).toEqual({ minX: 0, minZ: 0, maxX: GRID.width - 1, maxZ: GRID.depth - 1 });

    const v = fitView({ minX: 0, minZ: 0, maxX: 39, maxZ: 29 }, 800, 300);
    expect(v.cell).toBe(10); // Höhe begrenzt: 300 / 30
    expect(viewCell(v, 400, 150)).toEqual([20, 15]); // Mitte der Fläche = Mitte des Bereichs
    const z = zoomView(v, 2, 400, 150);
    expect(z.cell).toBe(20);
    expect(viewCell(z, 400, 150)).toEqual([20, 15]);
    expect(viewCell(panView(z, 40, 0), 400, 150)).toEqual([18, 15]);
    expect(zoomView(v, 100, 0, 0).cell).toBe(40); // begrenzt
  });
});
