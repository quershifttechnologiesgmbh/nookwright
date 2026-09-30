/**
 * Beispielhäuser für Tests, das Sample-Skript und Vorführungen (Außenmaß, Seed fest).
 */
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import type { StructuresInput } from '@mcda/structures';
import { Site, buildingFromShell, plotAround, type SiteLighting } from '@mcda/terrain';
import type { BaseOptions } from './base.js';
import { shellFor } from './house.js';

export type SampleVersion = keyof typeof TARGET_VERSIONS;

/** Erdgeschoss: Küche, Schlafzimmer, Lager, Schmiede (eine Etage). */
export function sampleHouse(version: SampleVersion, themeId: string, seed = 2026, height = 3): Project {
  const p = Project.create({ id: 'sample', name: 'Beispielhaus', seed, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
  return p;
}

/**
 * Zweistöckiges Beispielhaus: Erdgeschoss wie `sampleHouse`, darüber Schlafzimmer, Alchemie und Bibliothek
 * über Küche/Schlafzimmer/Lager; gerade Treppe im Lager hinauf in die Bibliothek. Die Schmiede bleibt
 * eingeschossig (Pultdach an der Wand des Obergeschosses).
 */
export function twoStoryHouse(version: SampleVersion, themeId: string, seed = 2026): Project {
  const p = sampleHouse(version, themeId, seed);
  p.rename('Zweistöckiges Beispielhaus');
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 8, 6), 'bedroom');
  p.paintRoom(1, CellSet.rect(9, 0, 14, 6), 'alchemy');
  p.paintRoom(1, CellSet.rect(0, 7, 14, 11), 'library');
  p.placeStairs(0, [3, 10], 'east');
  return p;
}

/** Komplette Beispiel-Base: Projekt, Gelände (Aggregat) und Bauwerke, dazu die Optionen für `generateBase`. */
export interface BaseSample {
  readonly project: Project;
  readonly site: Site;
  readonly structures: StructuresInput;
  readonly options: BaseOptions;
}

/**
 * Komplette Beispiel-Base (I2), Grundfläche des Hauses x 0–22 × z 0–15:
 *  - Erdgeschoss: Taverne (14 × 11, groß genug für Funktionszonen), Lager mit gerader Treppe, Küche, Schmiede;
 *    Obergeschoss: Schlafzimmer und Bibliothek über Taverne/Lager; Küche und Schmiede eingeschossig (Pultdach).
 *  - Satteldach.
 *  - Gelände „Wiese“: Feld (Osthof) und Garten (Nordhof) innerhalb der Mauer, Bäume und Büsche ringsum.
 *  - Mauerring mit 4 Ecktürmen und Tor im Süden; Wege von der Haustür zu Feld, Garten und durchs Tor hinaus.
 */
export function completeBase(version: SampleVersion, themeId: string, seed = 2026): BaseSample {
  const p = Project.create({ id: 'base', name: 'Beispiel-Base', seed, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 13, 10), 'tavern');
  p.paintRoom(0, CellSet.rect(0, 11, 13, 15), 'storage');
  p.paintRoom(0, CellSet.rect(14, 0, 22, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(14, 7, 22, 15), 'smithy');
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 13, 7), 'bedroom');
  p.paintRoom(1, CellSet.rect(0, 8, 13, 15), 'library');
  p.placeStairs(0, [3, 14], 'east');

  const site = Site.create({ id: 'base-site', projectId: p.state.id, seed, styleId: 'meadow', plot: { minX: -24, minZ: -26, maxX: 54, maxZ: 41 } });
  site.paintZone('field', CellSet.rect(28, 0, 39, 18));
  site.paintZone('garden', CellSet.rect(2, -11, 14, -6));

  const structures: StructuresInput = {
    walls: [{ id: 'ring', points: [[-14, -16], [44, -16], [44, 31], [-14, 31]], closed: true, towerSpacing: 0, gates: [{ at: [11, 31] }] }],
  };
  return { project: p, site, structures, options: { roof: 'gable', site: site.state, structures } };
}

/**
 * Beispiel „Gehöft“ (T2, research/18 S1): das eingeschossige Beispielhaus (Küche, Schlafzimmer, Lager, Schmiede)
 * mit Satteldach; das Gelände entsteht mit EINEM Befehl aus der Vorlage `homestead` (Hof mit Brunnenhaus vor der Tür,
 * Heckengarten an der Küchenseite, Feld mit Pfostenzaun, Koppel, Obstgarten, Wegeprofil, Laternen im Takt).
 */
export function homesteadBase(version: SampleVersion, themeId: string, seed = 2026, lighting?: SiteLighting): BaseSample {
  const p = sampleHouse(version, themeId, seed);
  p.rename('Beispiel-Gehöft');
  const building = buildingFromShell(shellFor(p, { roof: 'gable' }));
  const kitchen = p.state.rooms.filter((r) => r.floorIndex === 0 && r.roomTypeId === 'kitchen').reduce((acc, r) => acc.union(r.cells), CellSet.empty());
  const site = Site.create({ id: 'homestead-site', projectId: p.state.id, seed, styleId: 'meadow', plot: plotAround(building, 12) });
  site.applyTemplate('homestead', building, { kitchen, ...(lighting !== undefined ? { lighting } : {}) });
  return { project: p, site, structures: {}, options: { roof: 'gable', site: site.state } };
}
