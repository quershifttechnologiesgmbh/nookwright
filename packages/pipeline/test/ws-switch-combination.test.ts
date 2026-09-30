import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateBase, projectFromBuildingType } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

describe('WS-Schalter zusammen (Verwitterung, Farbharmonie, Silhouette, Fassadenrhythmus)', () => {
  it('Burg mit allen vier Schaltern: Verwitterung ergänzt Pflicht-Eigenschaften (z. B. axis bei Tiefenschiefer)', () => {
    const def = ctx.buildingTypes.get('castle_compact')!;
    const res = projectFromBuildingType(def, {
      size: 'M', themeId: 'medieval', targetVersion: { name: '1.21.11', dataVersion: 4671 },
      facadeRhythm: 'on', silhouette: 'varied', paletteOverrides: { colorHarmony: 'on' },
    } as never, 5, ctx);
    expect(() => generateBase(res.project, ctx, { ...res.build, ...res.surroundings, weathering: 'some' })).not.toThrow();
  }, 120_000);
});
