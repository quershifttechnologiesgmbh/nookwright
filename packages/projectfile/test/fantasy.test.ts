/**
 * W7-D (plan/spikes/W7D_fantasy.md): Fantasy-Stufe und -Kit der Außen-Deko (`ExteriorChoice.fantasy`, `fantasyKit`)
 * überleben Speichern/Laden und die Rückübersetzung; alte Dateien laden ohne (nach Theme, bitgleich), Unsinn fällt einzeln
 * weg (tolerant), die neue Gruppe `fantasyDecor` ist in alten Dateien an.
 */
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { exteriorOptions, exteriorProblem, readProjectFile, styleFromBuild, toProjectFile, type FileSettings } from '../src/index.js';

const read = (data: unknown): FileSettings => {
  const r = readProjectFile(data);
  if (!r.ok) throw new Error(r.error);
  return r.settings;
};

describe('W7-D: Fantasy-Stufe in der Projektdatei', () => {
  it('Domäne → Sitzung → Domäne; Speichern/Laden; alte Dateien ohne; Unsinn fällt einzeln weg', () => {
    const style = styleFromBuild({ roof: 'gable', exterior: { density: 1, fantasy: 'accent', fantasyKit: 'dwarven' } });
    expect(style.exterior).toMatchObject({ fantasy: 'accent', fantasyKit: 'dwarven' });
    expect(exteriorOptions(style.exterior)).toEqual({ density: 1, fantasy: 'accent', fantasyKit: 'dwarven' });
    const p = Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.paintRoom(0, CellSet.rect(0, 0, 5, 5), 'storage');
    const file = JSON.parse(JSON.stringify(toProjectFile({ project: p, settings: { ...style, density: new Map() } }, new Date(0)))) as Record<string, unknown> & { exterior: Record<string, unknown> };
    expect(read(file).exterior).toMatchObject({ fantasy: 'accent', fantasyKit: 'dwarven' });
    const { fantasy: _f, fantasyKit: _k, ...old } = file.exterior;
    const plain = read({ ...file, exterior: old }).exterior;
    expect([plain.fantasy, plain.fantasyKit]).toEqual([undefined, undefined]);
    // unbekannte Stufe fällt weg, das Kit bleibt (und umgekehrt)
    const bad = read({ ...file, exterior: { ...file.exterior, fantasy: 'max' } }).exterior;
    expect([bad.fantasy, bad.fantasyKit]).toEqual([undefined, 'dwarven']);
    expect(read({ ...file, exterior: { ...file.exterior, fantasyKit: 'orcish' } }).exterior.fantasyKit).toBeUndefined();
    expect(exteriorProblem({ ...style.exterior, fantasy: 'max' as 'full' })).toMatch(/Fantasy-Stufe/);
    expect(exteriorProblem({ ...style.exterior, fantasyKit: 'orcish' as 'elven' })).toMatch(/Fantasy-Kit/);
    // ohne Angabe: Domäne ohne Feld (bitgleich, Standard nach Theme)
    expect(exteriorOptions(styleFromBuild({ roof: 'gable', exterior: { density: 1 } }).exterior)).toEqual({ density: 1 });
  });

  it('Gruppe fantasyDecor: in alten Dateien an, aus überlebt Speichern/Laden', () => {
    const off = styleFromBuild({ roof: 'gable', exterior: { density: 1, fantasyDecor: false } });
    expect(off.exterior.groups.fantasyDecor).toBe(false);
    expect(exteriorOptions(off.exterior)).toEqual({ density: 1, fantasyDecor: false });
    const p = Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'elven', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.paintRoom(0, CellSet.rect(0, 0, 5, 5), 'storage');
    const file = JSON.parse(JSON.stringify(toProjectFile({ project: p, settings: { ...off, density: new Map() } }, new Date(0)))) as Record<string, unknown> & { exterior: { groups: Record<string, unknown> } };
    expect(read(file).exterior.groups.fantasyDecor).toBe(false);
    const { fantasyDecor: _g, ...oldGroups } = file.exterior.groups;
    expect(read({ ...file, exterior: { ...file.exterior, groups: oldGroups } }).exterior.groups.fantasyDecor).toBe(true);
  });
});
