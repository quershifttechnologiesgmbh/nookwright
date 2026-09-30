/**
 * W2-ED U3: Auswahl-Ebenen (Haus › Etage › Raum › Möbel, Treppe, Dach, Außen-Teil; Esc eine Ebene hoch), Dach per Klick
 * in 3D, Einpassen aufs Haus und Grundriss-Ausschnitt aufs Haus.
 */
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { planWindow } from '../src/editor/grid.js';
import { NO_SELECTION, houseBox, parentSelection, selectionBox, selectionFromOwner, selectionLevel, validSelection } from '../src/selection.js';
import * as uc from '../src/usecases.js';
import { buildPreviewVoxels } from '../src/viewer/voxels.js';
import { sampleSession } from './sample.js';

const catalog = loadBundledCatalog().catalog!;

describe('Auswahl-Ebenen', () => {
  const s = sampleSession(catalog);
  const state = s.project.state;
  const p = state.placements[0]!;
  const room = state.rooms.find((r) => r.id === p.roomId)!;

  it('Esc: Möbel → Raum → Etage → Haus; Treppe → Etage; Dach/Außen-Teil → Haus', () => {
    const furniture = { roomId: room.id, placementId: p.id };
    expect(selectionLevel(furniture)).toBe('Möbel');
    const up1 = parentSelection(furniture, state);
    expect(up1).toEqual({ roomId: room.id });
    expect(selectionLevel(up1)).toBe('Raum');
    const up2 = parentSelection(up1, state);
    expect(up2).toEqual({ floorIndex: room.floorIndex });
    expect(selectionLevel(up2)).toBe('Etage');
    expect(parentSelection(up2, state)).toBe(NO_SELECTION);
    expect(selectionLevel(NO_SELECTION)).toBe('Haus');
    expect(parentSelection({ roof: true }, state)).toBe(NO_SELECTION);
    expect(parentSelection({ exteriorId: 'x1:shutters:a@1' }, state)).toBe(NO_SELECTION);
    const link = state.links[0];
    if (link !== undefined) expect(parentSelection({ linkId: link.id }, state)).toEqual({ floorIndex: link.floorIndex });
    expect(parentSelection({ roomId: 'r999' }, state)).toBe(NO_SELECTION);
  });

  it('Dach: Klick auf eine Dachzelle wählt das Dach (Rollen-Vorschau `roof:<Raum>`); Rahmen = Dachzellen', () => {
    const shell = uc.shellOf(s.project, uc.shellStyle(s));
    const roofCells = shell.cells.filter((c) => c.kind === 'roof');
    expect(roofCells.length).toBeGreaterThan(0);
    const voxels = buildPreviewVoxels(shell, []);
    const roofVoxel = voxels.find((v) => v.owner?.startsWith('roof:'));
    expect(roofVoxel).toBeDefined();
    expect(voxels.filter((v) => v.owner?.startsWith('roof:')).length).toBe(roofCells.filter((c) => c.roomId !== undefined).length);
    const sel = selectionFromOwner(roofVoxel!.owner, state);
    expect(sel).toEqual({ roof: true });
    expect(validSelection(sel, state)).toBe(sel);
    const box = selectionBox(sel, state, [], undefined, shell)!;
    const ys = roofCells.map((c) => c.pos[1]);
    expect(box.min[1]).toBe(Math.min(...ys));
    expect(box.max[1]).toBe(Math.max(...ys));
    // Wände bleiben der Raum
    expect(selectionFromOwner(`shell:${room.id}`, state)).toEqual({ roomId: room.id });
  });

  it('Etage: Rahmen um die Räume der Etage vom Boden bis zur Decke; ungültige Etage → nichts', () => {
    const f = state.floors[0]!;
    const box = selectionBox({ floorIndex: f.index }, state, [])!;
    expect(box.min[1]).toBe(f.y0);
    expect(box.max[1]).toBe(f.y0 + f.height + 1);
    expect(validSelection({ floorIndex: 99 }, state)).toBe(NO_SELECTION);
  });

  it('Einpassen aufs Haus: Quader der Hülle (ohne Gelände)', () => {
    const shell = uc.shellOf(s.project, uc.shellStyle(s));
    const box = houseBox(shell)!;
    const xs = state.rooms.flatMap((r) => r.cells.toArray().map((c) => c[0]));
    expect(box.min[0]).toBeLessThanOrEqual(Math.min(...xs));
    expect(box.max[0]).toBeGreaterThanOrEqual(Math.max(...xs));
    expect(box.max[0] - box.min[0]).toBeLessThan(uc.GRID.width);
  });
});

describe('Grundriss-Ausschnitt aufs Haus', () => {
  it('ohne Räume das ganze Raster; sonst 4 : 3, mit Rand, ins Raster geklemmt, alle Räume sichtbar', () => {
    expect(planWindow([], uc.GRID)).toEqual({ x0: 0, z0: 0, w: 40, d: 30 });
    const cells: [number, number][] = [];
    for (let x = 14; x <= 24; x++) for (let z = 10; z <= 18; z++) cells.push([x, z]);
    const w = planWindow(cells, uc.GRID);
    expect(w.w / w.d).toBeCloseTo(4 / 3);
    expect(w.w).toBeLessThan(40);
    expect(w.x0).toBeLessThanOrEqual(14 - 4);
    expect(w.x0 + w.w).toBeGreaterThanOrEqual(25 + 4);
    expect(w.z0).toBeLessThanOrEqual(10 - 4);
    expect(w.z0 + w.d).toBeGreaterThanOrEqual(19 + 4);
    // am Rand: geklemmt
    const corner = planWindow([[0, 0], [3, 2]], uc.GRID);
    expect(corner.x0).toBe(0);
    expect(corner.z0).toBe(0);
    expect(corner.w).toBe(16);
    // großes Haus: ganzes Raster
    expect(planWindow([[1, 1], [38, 28]], uc.GRID)).toEqual({ x0: 0, z0: 0, w: 40, d: 30 });
    // deterministisch
    expect(planWindow(cells, uc.GRID)).toEqual(w);
  });
});
