/**
 * W3-BL: Block-Regeln in der Projektdatei – additiv (fehlt = keine Sperren, bitgleich), Round-Trip, tolerantes Lesen
 * (ungültige Einträge fallen einzeln heraus), Abbildung auf die Optionen des Anwendungsdienstes und zurück.
 */
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { withBlockPreset } from '@mcda/pipeline';
import { readBlockRules, readProjectFile, shellOptions, shellStyle, styleFromBuild, toProjectFile, type FileSettings } from '../src/index.js';

const project = (): Project => {
  const p = Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'harbor', targetVersion: TARGET_VERSIONS['1.21.11'] });
  p.paintRoom(0, CellSet.rect(0, 0, 5, 5), 'storage');
  return p;
};
const read = (data: unknown): FileSettings => {
  const r = readProjectFile(data);
  if (!r.ok) throw new Error(r.error);
  return r.settings;
};

describe('Block-Regeln in der Projektdatei', () => {
  const rules = { ...withBlockPreset(undefined, 'easy_farm', true)!, replace: { gold_block: 'honeycomb_block' } };
  const settings: FileSettings = { ...shellStyle({ roof: 'gable', blockRules: rules }), density: new Map() };

  it('Round-Trip: Liste, Preset und feste Ersetzungen bleiben', () => {
    const file = JSON.parse(JSON.stringify(toProjectFile({ project: project(), settings }, new Date(0)))) as Record<string, unknown>;
    expect(file['blockRules']).toEqual(rules);
    const back = read(file);
    expect(back.blockRules).toEqual(rules);
    expect(shellOptions(shellStyle(back)).blockRules).toEqual(rules);
    // Stil ↔ Optionen des Anwendungsdienstes (Engine-Session) verlustfrei
    expect(styleFromBuild(shellOptions(shellStyle(back))).blockRules).toEqual(rules);
  });

  it('ohne Sperren: kein Feld in der Datei, alte Dateien laden ohne Regeln', () => {
    const plain: FileSettings = { ...shellStyle({ roof: 'gable' }), density: new Map() };
    const file = JSON.parse(JSON.stringify(toProjectFile({ project: project(), settings: plain }, new Date(0)))) as Record<string, unknown>;
    expect('blockRules' in file).toBe(false);
    expect(read(file).blockRules).toBeUndefined();
    expect('blockRules' in shellOptions(shellStyle(read(file)))).toBe(false);
    expect(read({ ...file, blockRules: { banned: [] } }).blockRules).toBeUndefined();
  });

  it('tolerant: kaputte Einträge fallen einzeln heraus', () => {
    expect(readBlockRules(undefined)).toEqual({});
    expect(readBlockRules('gold_block')).toEqual({});
    expect(readBlockRules({ banned: 'gold_block' })).toEqual({});
    expect(readBlockRules({ banned: ['Gold_Block', 7, 'minecraft:sponge', '../x', 'sea lantern'], replace: { gold_block: 3, sponge: 'hay_block' }, preset: 'magic' }))
      .toEqual({ blockRules: { banned: ['gold_block', 'sponge'], replace: { sponge: 'hay_block' } } });
  });
});
