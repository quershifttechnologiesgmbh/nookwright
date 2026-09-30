import { describe, expect, it } from 'vitest';
import { CellSet, cellKey } from '@mcda/core';
import { analyzeRoom, rotationForBack, type RoomGeometry } from '../src/index.js';

/** 5 × 4 Innenraum (x 0–4, z 0–3), Tür mittig in der Südwand, Fenster in der Nordwand bei x = 2. */
const room: RoomGeometry = {
  roomId: 'r1',
  baseY: 1,
  height: 3,
  interior: CellSet.rect(0, 0, 4, 3),
  doors: [{ inside: [2, 3], toward: 'south', isMain: true }],
  windows: [{ inside: [2, 0], toward: 'north' }],
};

const at = (a: ReturnType<typeof analyzeRoom>, x: number, z: number) => a.info.get(cellKey(x, z))!;

describe('analyzeRoom', () => {
  const a = analyzeRoom(room);

  it('klassifiziert Ecken, Kanten und Mitte', () => {
    expect(at(a, 0, 0).cls).toBe('corner');
    expect(at(a, 4, 3).cls).toBe('corner');
    expect(at(a, 2, 0).cls).toBe('edge');
    expect(at(a, 0, 1).cls).toBe('edge');
    expect(at(a, 2, 1).cls).toBe('center');
    expect(at(a, 0, 0).walls).toEqual(['north', 'west']);
  });

  it('Tür und Fenster sind Grenzen, aber keine festen Wände zum Anlehnen', () => {
    expect(at(a, 2, 3).walls).toEqual(['south']);
    expect(at(a, 2, 3).solidWalls).toEqual([]);
    expect(at(a, 2, 0).solidWalls).toEqual([]);
    expect(at(a, 2, 0).nearWindow).toBe(true);
  });

  it('Türzone = Innenzelle + Nachbarn', () => {
    expect(a.doorZone.toArray()).toEqual([
      [1, 3],
      [2, 2],
      [2, 3],
      [3, 3],
    ]);
    expect(at(a, 2, 2).nearDoor).toBe(true);
  });

  it('Distanzfelder', () => {
    expect(a.dWall.get(cellKey(0, 0))).toBe(0);
    expect(a.dWall.get(cellKey(2, 1))).toBe(1);
    expect(a.dDoor.get(cellKey(2, 3))).toBe(0);
    expect(a.dDoor.get(cellKey(0, 0))).toBe(5);
  });

  it('Wandabschnitte: an Tür und Fenster unterbrochen', () => {
    const south = a.wallSegments.filter((s) => s.wall === 'south').map((s) => s.cells);
    // Südwand: x 0–4, Türzone (1,3)(2,3)(3,3) ausgenommen → zwei Stücke
    expect(south).toEqual([[[0, 3]], [[4, 3]]]);
    const north = a.wallSegments.filter((s) => s.wall === 'north').map((s) => s.cells);
    // Nordwand: Fensterzelle (2,0) ist keine feste Wand
    expect(north).toEqual([
      [[0, 0], [1, 0]],
      [[3, 0], [4, 0]],
    ]);
    const west = a.wallSegments.filter((s) => s.wall === 'west').map((s) => s.cells);
    expect(west).toEqual([[[0, 0], [0, 1], [0, 2], [0, 3]]]);
  });

  it('L-förmiger Raum: 1 breiter Arm ist ein Flur', () => {
    const l: RoomGeometry = { ...room, interior: CellSet.rect(0, 0, 3, 3).union(CellSet.rect(4, 0, 8, 0)), doors: [], windows: [] };
    const la = analyzeRoom(l);
    expect(at(la, 6, 0).cls).toBe('corridor');
    expect(at(la, 8, 0).cls).toBe('niche');
    expect(la.dDoor.get(cellKey(0, 0))).toBe(Infinity);
  });
});

describe('rotationForBack', () => {
  it('Rückseite (kanonisch Norden) an die gewünschte Wand', () => {
    expect(rotationForBack('north')).toBe(0);
    expect(rotationForBack('east')).toBe(1);
    expect(rotationForBack('south')).toBe(2);
    expect(rotationForBack('west')).toBe(3);
  });
});
