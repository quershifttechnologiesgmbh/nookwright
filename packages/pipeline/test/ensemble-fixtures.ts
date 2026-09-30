/**
 * F-Ensemble: Testbauten mit mehreren freistehenden Gebäuden (die Bautypen des Katalogs haben keine zwei
 * mehrgeschossigen, freistehenden Baukörper). „Doppelhaus über die Gasse“: zwei zweigeschossige Häuser als eigene
 * Baukörper, Gasse `gap` breit, Gelände `meadow` mit Hof-Vorlage – Vorbild Schwibbogen/Skyway zwischen Fachwerkhäusern.
 */
import { DEFAULT_VOLUME, Project, TARGET_VERSIONS, type BuildingTypeDraft } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { Site, plotAround } from '@mcda/terrain';
import { buildingOf, shellFor, themeFor, type BaseOptions, type PipelineContext } from '../src/index.js';

export interface TwinHouses {
  readonly project: Project;
  readonly opts: BaseOptions;
}

export function twinHouses(ctx: PipelineContext, seed: number, theme = 'medieval', gap = 6): TwinHouses {
  const p = Project.create({ id: 'twin', name: 'Doppelhaus', seed, themeId: theme, targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  const bx = 11 + gap;
  const draft: BuildingTypeDraft = {
    origin: { buildingTypeId: 'twin', params: {}, seed, rerollCount: 0 },
    floors: { 0: 3, 1: 3 },
    volumes: [
      { key: DEFAULT_VOLUME, name: 'Haus West', roof: 'gable' },
      { key: 'east', name: 'Haus Ost', roof: 'gable' },
    ],
    rooms: [
      { floorIndex: 0, cells: CellSet.rect(0, 0, 10, 9), roomTypeId: 'kitchen' },
      { floorIndex: 1, cells: CellSet.rect(0, 0, 10, 9), roomTypeId: 'library' },
      { floorIndex: 0, cells: CellSet.rect(bx, 0, bx + 10, 9), roomTypeId: 'storage', volume: 'east' },
      { floorIndex: 1, cells: CellSet.rect(bx, 0, bx + 10, 9), roomTypeId: 'study', volume: 'east' },
    ],
    stairs: [
      { floorIndex: 0, origin: [3, 3], facing: 'south' },
      { floorIndex: 0, origin: [bx + 6, 3], facing: 'south' },
    ],
  };
  p.applyBuildingType(draft);
  const build: BaseOptions = { roof: 'gable', overhang: 1, roofDetail: { trim: true }, facade: { plinthProfile: true, cornice: true }, exterior: {} };
  const building = buildingOf(shellFor(p, build, themeFor(p, ctx)));
  const site = Site.create({ id: 'twin-site', projectId: 'twin', seed, styleId: 'meadow', plot: plotAround(building, 12) });
  site.applyTemplate('homestead', building);
  return { project: p, opts: { ...build, site: site.state } };
}
