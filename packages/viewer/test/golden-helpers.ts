/**
 * Test-Hilfen der Goldenen Galerie: eine kleine, selbst gebaute Welt (Wiese, Haus mit Tür und Laterne, Baum) und ein
 * Klassifizierer aus einer Tabelle (ohne Plattform-Daten).
 */
import type { Classifier, GoldenState, PhysClass, Vec3, VolumeLike } from '../golden/lib/grid.js';

const HALF = new Set(['oak_door', 'oak_stairs', 'oak_slab', 'lantern', 'chest', 'red_bed']);
const NATURAL = new Set(['grass_block', 'dirt', 'oak_leaves', 'poppy', 'short_grass']);
const THIN = new Set(['poppy', 'short_grass', 'torch']);
const MINERAL = new Set(['stone', 'andesite', 'diorite', 'granite', 'tuff', 'deepslate']);

export const tableClassifier: Classifier = (s: GoldenState) => {
  const cls: PhysClass = s.name === 'air' ? 'air' : THIN.has(s.name) ? 'thin' : HALF.has(s.name) ? 'half' : s.name.endsWith('_fence') ? 'tall' : 'full';
  return { cls, natural: NATURAL.has(s.name), emits: s.name === 'lantern' || s.name === 'torch', mineral: MINERAL.has(s.name) };
};

export interface TestBlock {
  readonly pos: Vec3;
  readonly name: string;
  readonly properties?: Record<string, string>;
}

/**
 * Welt 17 × 10 × 15: Wiese auf y 0; Haus x 4…10, z 4…8 (Steinwände y 1…4, Bretterboden y 0, Dach y 5 mit Überstand
 * x 3…11, z 3…9); Tür in der Südwand bei (7, 1, 8) nach Süden; Laterne innen; Truhe innen; Baum bei (1, *, 1);
 * Zaun (niedrig) bei x 13, z 2…12.
 */
export function testHouse(): VolumeLike & { blocks: TestBlock[] } {
  const size: Vec3 = [17, 10, 15];
  const m = new Map<string, TestBlock>();
  const put = (x: number, y: number, z: number, name: string, properties?: Record<string, string>): void => {
    m.set(`${x},${y},${z}`, { pos: [x, y, z], name, ...(properties !== undefined ? { properties } : {}) });
  };
  for (let x = 0; x < size[0]; x++) for (let z = 0; z < size[2]; z++) put(x, 0, z, 'grass_block', { snowy: 'false' });
  for (let x = 4; x <= 10; x++) {
    for (let z = 4; z <= 8; z++) {
      put(x, 0, z, 'oak_planks');
      const wall = x === 4 || x === 10 || z === 4 || z === 8;
      if (wall) for (let y = 1; y <= 4; y++) put(x, y, z, 'stone_bricks');
    }
  }
  for (let x = 3; x <= 11; x++) for (let z = 3; z <= 9; z++) put(x, 5, z, 'oak_planks');
  put(7, 1, 8, 'oak_door', { facing: 'south', half: 'lower', hinge: 'left', open: 'false', powered: 'false' });
  put(7, 2, 8, 'oak_door', { facing: 'south', half: 'upper', hinge: 'left', open: 'false', powered: 'false' });
  put(7, 4, 6, 'lantern', { hanging: 'true', waterlogged: 'false' });
  put(5, 1, 5, 'chest', { facing: 'south', type: 'single', waterlogged: 'false' });
  for (let y = 1; y <= 4; y++) put(1, y, 1, 'oak_log', { axis: 'y' });
  for (let x = 0; x <= 2; x++) for (let z = 0; z <= 2; z++) put(x, 5, z, 'oak_leaves', { distance: '1', persistent: 'false', waterlogged: 'false' });
  for (let z = 2; z <= 12; z++) put(13, 1, z, 'oak_fence');
  put(12, 1, 11, 'poppy');
  return { size, blocks: [...m.values()], entities: [] };
}

/**
 * Erdhaus (W7-J), Welt 17 × 12 × 17: Wiese auf y 1 (Erde y 0); Hügel aus Erde x 1…15, z 1…13 bis y 8 (Gras y 9);
 * darin das Haus x 5…11, z 4…10 (Bretterboden y 1, Steinwände y 2…4, Dach y 5); Tür in der Südwand bei (8, 2, 10)
 * nach Süden, davor ein Graben (x 7…9, y 2…4, z 11…13) bis zur Wiese; Laterne innen. Der Ring um den Bau liegt auf
 * dem Hügel, die Tür 7 Blöcke tiefer.
 */
export function buriedHouse(): VolumeLike & { blocks: TestBlock[] } {
  const size: Vec3 = [17, 12, 17];
  const m = new Map<string, TestBlock>();
  const put = (x: number, y: number, z: number, name: string, properties?: Record<string, string>): void => {
    m.set(`${x},${y},${z}`, { pos: [x, y, z], name, ...(properties !== undefined ? { properties } : {}) });
  };
  const house = (x: number, z: number): boolean => x >= 5 && x <= 11 && z >= 4 && z <= 10;
  const mound = (x: number, z: number): boolean => x >= 1 && x <= 15 && z >= 1 && z <= 13;
  const trench = (x: number, z: number): boolean => x >= 7 && x <= 9 && z >= 11 && z <= 13;
  for (let x = 0; x < size[0]; x++) {
    for (let z = 0; z < size[2]; z++) {
      put(x, 0, z, 'dirt');
      if (house(x, z)) {
        put(x, 1, z, 'oak_planks');
        if (x === 5 || x === 11 || z === 4 || z === 10) for (let y = 2; y <= 4; y++) put(x, y, z, 'stone_bricks');
        put(x, 5, z, 'oak_planks');
        for (let y = 6; y <= 8; y++) put(x, y, z, 'dirt');
        put(x, 9, z, 'grass_block', { snowy: 'false' });
      } else if (mound(x, z)) {
        for (let y = 1; y <= 8; y++) if (!(trench(x, z) && y >= 2 && y <= 4)) put(x, y, z, 'dirt');
        put(x, 9, z, 'grass_block', { snowy: 'false' });
      } else {
        put(x, 1, z, 'grass_block', { snowy: 'false' });
      }
    }
  }
  put(8, 2, 10, 'oak_door', { facing: 'south', half: 'lower', hinge: 'left', open: 'false', powered: 'false' });
  put(8, 3, 10, 'oak_door', { facing: 'south', half: 'upper', hinge: 'left', open: 'false', powered: 'false' });
  put(8, 4, 7, 'lantern', { hanging: 'true', waterlogged: 'false' });
  return { size, blocks: [...m.values()], entities: [] };
}
