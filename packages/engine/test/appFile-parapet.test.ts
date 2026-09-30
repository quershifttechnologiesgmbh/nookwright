/** Die Projektdatei muss auch die deterministische Ausguckkrone eines Bautyps erhalten. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { exportFile } from '@mcda/export/node';
import { generateBase, projectFromBuildingType, toExport } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { parseProjectText } from '@mcda/projectfile';
import { REPO_CATALOG } from '../src/node/index.js';
import { appFileOf, sessionFromAppFile } from '../src/appFile.js';
import { NO_REDO } from '../src/session.js';

describe('Bautyp → App-Datei → Engine: Wehrplatten', () => {
  it('erhält ID, abgeleitete Dachluke und alle Blöcke des Ruinen-Wachturms', () => {
    const ctx = nodeContext(REPO_CATALOG);
    const res = projectFromBuildingType(ctx.buildingTypes.get('watchtower'), {
      size: 'M', themeId: 'ruin', targetVersion: { name: '1.21.11', dataVersion: 4671 },
    }, 2026, ctx);
    const before = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
    const file = appFileOf({
      id: 'tower', project: res.project, build: res.build, site: res.site,
      structures: res.surroundings.structures, attachedTowers: [], redo: NO_REDO,
    }, new Date('2026-09-30T10:00:00Z'));
    expect(file.surroundings?.structures.find(i => i.kind === 'parapet')?.id).toBe('main-parapet');
    const loaded = parseProjectText(JSON.stringify(file), { catalog: ctx.catalog, themes: ctx.themes });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.warnings ?? []).toEqual([]);
    const restored = sessionFromAppFile('restored', loaded);
    expect(restored.structures?.parapets?.[0]?.hatch).toEqual(res.surroundings.structures?.parapets?.[0]?.hatch);
    expect(restored.structures?.parapets?.[0]?.hatch).toBeDefined();
    const after = generateBase(restored.project, ctx, {
      ...restored.build, ...(restored.site !== undefined ? { site: restored.site.state } : {}),
      ...(restored.structures !== undefined ? { structures: restored.structures } : {}),
    });
    const digest = (project: typeof res.project, world: typeof before) => createHash('sha256')
      .update(exportFile('nbt', toExport(project, world, 'Nookwright'))).digest('hex');
    expect(digest(restored.project, after)).toBe(digest(res.project, before));
  });
});
