/** W13-G: Paletten-Überschreibungen überleben Speichern/Laden als Event der Historie (additiv). */
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { readProjectFile, shellStyle, toProjectFile, type FileSettings } from '../src/index.js';

describe('Projektdatei: Paletten-Überschreibungen', () => {
  it('speichern und laden: gleicher Zustand; Datei ohne Überschreibung ohne Event', () => {
    const p = Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.paintRoom(0, CellSet.rect(0, 0, 5, 5), 'storage');
    const settings: FileSettings = { ...shellStyle({ roof: 'gable' }), density: new Map() };
    const plain = JSON.parse(JSON.stringify(toProjectFile({ project: p, settings }, new Date(0)))) as { history: Array<{ type: string }> };
    expect(plain.history.map((e) => e.type)).not.toContain('PaletteOverridesChanged');
    p.setPaletteOverrides({ groups: { roof: 'bricks', frame: 'spruce' }, swaps: [{ from: 'oak', to: 'birch' }] });
    const file = JSON.parse(JSON.stringify(toProjectFile({ project: p, settings }, new Date(0))));
    const r = readProjectFile(file);
    if (!r.ok) throw new Error(r.error);
    expect(r.project.state.paletteOverrides).toEqual({ groups: { frame: 'spruce', roof: 'bricks' }, swaps: [{ from: 'oak', to: 'birch' }] });
  });
});
