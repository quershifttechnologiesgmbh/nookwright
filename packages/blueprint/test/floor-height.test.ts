import { describe, expect, it } from 'vitest';
import { CellSet, pose } from '@mcda/core';
import { DomainError, Project, TARGET_VERSIONS } from '../src/index.js';

function twoFloors() {
  const p = Project.create({ id: 'h', name: 'Höhe', seed: 7, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
  p.addFloor(); // Etage 1 über Etage 0 (Höhe 3): y0 = 0 + 3 + 1 = 4
  p.paintRoom(0, CellSet.rect(0, 0, 6, 5), 'kitchen');
  p.paintRoom(1, CellSet.rect(0, 0, 6, 5), 'bedroom');
  const [r0, r1] = p.state.rooms;
  p.applyFurnishing(r0!.id, [{ key: 'a', componentId: 'work/furnace', pose: pose([1, 1, 1]), seed: 1 }]);
  p.addPlacement(r0!.id, 'storage/chest', pose([2, 1, 1]));
  p.applyFurnishing(r1!.id, [{ key: 'b', componentId: 'bed/single', pose: pose([1, 5, 1]), seed: 2 }]);
  return { p, r0: r0!.id, r1: r1!.id };
}

describe('Wandhöhe (lichte Höhe) einer Etage ändern', () => {
  it('Etage darüber rutscht samt Möbeln mit; Boden der Etage bleibt', () => {
    const { p, r1 } = twoFloors();
    p.setFloorHeight(0, 5);
    expect(p.state.floors.map((f) => [f.index, f.y0, f.height])).toEqual([[0, 0, 5], [1, 6, 3]]);
    const bed = p.state.placements.find((x) => x.roomId === r1)!;
    expect(bed.pose.pos[1]).toBe(7); // 5 + 2
  });

  it('automatische Möbel der Etage entfallen, manuelle/gesperrte bleiben', () => {
    const { p, r0 } = twoFloors();
    p.setFloorHeight(0, 4);
    expect(p.state.placements.filter((x) => x.roomId === r0).map((x) => x.componentId)).toEqual(['storage/chest']);
  });

  it('Keller wächst nach unten, das Erdgeschoss bleibt', () => {
    const p = Project.create({ id: 'k', name: 'Keller', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.addFloor({ below: true }); // Etage -1: y0 = 0 - 3 - 1 = -4
    p.setFloorHeight(-1, 5);
    expect(p.state.floors.map((f) => [f.index, f.y0, f.height])).toEqual([[-1, -6, 5], [0, 0, 3]]);
  });

  it('prüft den Wertebereich und erzeugt bei gleicher Höhe kein Event', () => {
    const { p } = twoFloors();
    expect(() => p.setFloorHeight(0, 1)).toThrow(DomainError);
    expect(() => p.setFloorHeight(0, 17)).toThrow(DomainError);
    expect(() => p.setFloorHeight(9, 4)).toThrow(DomainError);
    expect(p.setFloorHeight(0, 3)).toEqual([]);
  });

  it('Zustand bleibt aus der Historie reproduzierbar (Undo/Laden)', () => {
    const { p } = twoFloors();
    p.setFloorHeight(0, 6);
    expect(Project.fromHistory(p.history).state).toEqual(p.state);
    expect(p.undo().state.floors[0]!.height).toBe(3);
  });
});
