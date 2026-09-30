import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { cellAt, clickNote, interpretGesture, openingCell, outline } from '../src/editor/grid.js';

const GRID = { width: 40, depth: 30 };

describe('2D-Editor: Raster und Gesten', () => {
  it('Zelle unter dem Zeiger, unabhängig von der Skalierung', () => {
    expect(cellAt(0, 0, 640, 480, GRID)).toEqual([0, 0]);
    expect(cellAt(639, 479, 640, 480, GRID)).toEqual([39, 29]);
    expect(cellAt(320, 240, 1280, 960, GRID)).toEqual([10, 7]);
    expect(cellAt(-1, 10, 640, 480, GRID)).toBeUndefined();
    expect(cellAt(640, 10, 640, 480, GRID)).toBeUndefined();
  });

  it('Umriss eines Rechtecks = Umfang in Zellkanten', () => {
    expect(outline(CellSet.rect(0, 0, 3, 1))).toHaveLength(2 * (4 + 2));
    expect(outline(CellSet.rect(0, 0, 0, 0))).toHaveLength(4);
  });

  it('Türzelle liegt einen Schritt vor der Innenzelle', () => {
    expect(openingCell({ inside: [4, 3], toward: 'south', isMain: true })).toEqual([4, 4]);
    expect(openingCell({ inside: [4, 3], toward: 'west' })).toEqual([3, 3]);
  });

  it('Gesten: Ziehen malt, Klick wählt, Rechtsklick radiert', () => {
    expect(interpretGesture('paint', 'left', [1, 1], [5, 4])).toEqual({ kind: 'paint', rect: { x1: 1, z1: 1, x2: 5, z2: 4 } });
    expect(interpretGesture('paint', 'left', [2, 2], [2, 2])).toEqual({ kind: 'select', cell: [2, 2] });
    expect(interpretGesture('paint', 'right', [1, 1], [3, 3]).kind).toBe('erase');
    expect(interpretGesture('select', 'left', [1, 1], [3, 3])).toEqual({ kind: 'select', cell: [3, 3] });
    expect(interpretGesture('erase', 'left', [2, 2], [2, 2])).toEqual({ kind: 'erase', rect: { x1: 2, z1: 2, x2: 2, z2: 2 } });
  });

  it('Klick im Mal-Modus auf eine leere Zelle sagt, warum kein 1×1-Raum entsteht (Review 3)', () => {
    expect(clickNote('paint', false)).toContain('Rechteck');
    expect(clickNote('paint', true)).toBeUndefined(); // Klick auf einen Raum wählt weiterhin nur aus
    expect(clickNote('select', false)).toBeUndefined();
    expect(clickNote('erase', false)).toBeUndefined();
    expect(clickNote('stairs', false)).toBeUndefined();
  });
});
