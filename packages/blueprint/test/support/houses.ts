/** Test-Grundrisse der Hüllen-Tests (Prüfsummen, Gauben): Außenmaß, Seed fest. */
import { CellSet } from '@mcda/core';
import { Project, TARGET_VERSIONS } from '../../src/index.js';

type Rect = readonly [x1: number, z1: number, x2: number, z2: number, roomType: string];

export const emptyProject = (): Project =>
  Project.create({ id: 'p', name: 'Haus', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });

export function rooms(list: readonly Rect[], upper: readonly Rect[] = [], stairs?: readonly [number, number]): Project {
  const p = emptyProject();
  for (const [x1, z1, x2, z2, t] of list) p.paintRoom(0, CellSet.rect(x1, z1, x2, z2), t);
  if (upper.length > 0) {
    p.addFloor();
    for (const [x1, z1, x2, z2, t] of upper) p.paintRoom(1, CellSet.rect(x1, z1, x2, z2), t);
    if (stairs !== undefined) p.placeStairs(0, stairs, 'east');
  }
  return p;
}

const SAMPLE: readonly Rect[] = [[0, 0, 8, 6, 'kitchen'], [9, 0, 14, 6, 'bedroom'], [0, 7, 14, 11, 'storage'], [15, 0, 22, 11, 'smithy']];

export const rect = (w: number, d: number): Project => rooms([[0, 0, w - 1, d - 1, 'storage']]);
export const sampleHouse = (): Project => rooms(SAMPLE);
export const lHouse = (): Project => rooms([[0, 0, 12, 6, 'kitchen'], [0, 7, 6, 15, 'bedroom']]);
export const twoStoryHouse = (): Project =>
  rooms(SAMPLE, [[0, 0, 8, 6, 'bedroom'], [9, 0, 14, 6, 'alchemy'], [0, 7, 14, 11, 'library']], [3, 10]);
/** Obergeschoss kragt nach Norden und Süden je 1 Block aus. */
export const jettyHouse = (): Project => rooms([[0, 0, 10, 6, 'kitchen']], [[0, -1, 10, 7, 'bedroom']], [2, 3]);

export const LAYOUTS: ReadonlyArray<readonly [string, () => Project]> = [
  ['Rechteck 11×9', () => rect(11, 9)],
  ['Beispielhaus', sampleHouse],
  ['L-Grundriss', lHouse],
  ['zweistöckig', twoStoryHouse],
  ['Auskragung', jettyHouse],
];
