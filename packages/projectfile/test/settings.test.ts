/**
 * Einstellungen der Projektdatei: Pfeiler-Pflicht (`FacadeChoice.piers`, W1-G / Befund S4a). Ein Bautyp mit
 * Fachwerk-Theme kommt ohne Pfeiler aus `withoutPilastersForTheme`; `styleFromBuild` → `facadeOptions` muss das
 * erhalten (vorher setzte `quality: true` die Q2-Regel `pierFrom: 6` wieder). Additiv: alte Dateien laden bitgleich.
 */
import { describe, expect, it } from 'vitest';
import { FACADE_QUALITY_RULES, Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import {
  DEFAULT_EXTERIOR, DEFAULT_FACADE, DEFAULT_ROOF_DETAIL, exteriorOptions, facadeOptions, facadeProblem, readProjectFile, roofDetailOptions, roofDetailProblem,
  shellOptions, shellStyle, styleFromBuild, toProjectFile, type FileSettings,
} from '../src/index.js';

const { pierFrom: _p, ...withoutPiers } = FACADE_QUALITY_RULES;
const typeFacade = { plinthProfile: true, cornice: true, quoins: true, rules: FACADE_QUALITY_RULES };

describe('Pfeiler-Pflicht (piers)', () => {
  it('Stil eines Fachwerk-Bautyps (Regeln ohne pierFrom) → piers: false → Hülle wieder ohne Pfeiler', () => {
    const style = styleFromBuild({ roof: 'gable', facade: { ...typeFacade, pilasters: 0, rules: withoutPiers } });
    expect(style.facade).toMatchObject({ quality: true, piers: false });
    expect(facadeOptions(style.facade)?.rules).toEqual(withoutPiers);
    expect(shellOptions(style).facade?.rules?.pierFrom).toBeUndefined();
  });

  it('ohne die Regel (Stein-Theme, neue Projekte, alte Dateien): piers fehlt, Regeln wie bisher (bitgleich)', () => {
    const style = styleFromBuild({ roof: 'gable', facade: typeFacade });
    expect(style.facade.piers).toBeUndefined();
    expect(facadeOptions(style.facade)?.rules).toBe(FACADE_QUALITY_RULES);
    expect(facadeOptions(DEFAULT_FACADE)?.rules).toBe(FACADE_QUALITY_RULES);
    // piers ohne quality wirkt nicht
    expect(facadeOptions({ ...DEFAULT_FACADE, quality: false, piers: false })?.rules).toBeUndefined();
  });

  it('Projektdatei: piers bleibt beim Speichern/Laden; fehlt in alten Dateien; Unsinn fällt auf „fehlt“ zurück', () => {
    const p = Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'timber', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.paintRoom(0, CellSet.rect(0, 0, 5, 5), 'storage');
    const style = styleFromBuild({ roof: 'gable', facade: { ...typeFacade, rules: withoutPiers } });
    const settings: FileSettings = { ...style, density: new Map() };
    const file = JSON.parse(JSON.stringify(toProjectFile({ project: p, settings }, new Date(0)))) as Record<string, unknown> & { facade: Record<string, unknown> };
    expect(file.facade['piers']).toBe(false);
    const read = (data: unknown): FileSettings => {
      const r = readProjectFile(data);
      if (!r.ok) throw new Error(r.error);
      return r.settings;
    };
    const back = read(file);
    expect(back.facade.piers).toBe(false);
    expect(shellOptions(shellStyle(back))).toEqual(shellOptions(style));
    const { piers: _x, ...old } = file.facade;
    const oldRead = read({ ...file, facade: old });
    expect(oldRead.facade.piers).toBeUndefined();
    expect(facadeOptions(oldRead.facade)?.rules).toBe(FACADE_QUALITY_RULES);
    expect(read({ ...file, facade: { ...file.facade, piers: 'nein' } }).facade.piers).toBeUndefined();
    expect(facadeProblem({ ...DEFAULT_FACADE, piers: 'nein' as unknown as boolean })).toMatch(/Pfeiler/);
  });
});

describe('W4-D: automatische Dachhöhe, Dach teilen, Traufkonsolen (additiv)', () => {
  const p = Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
  p.paintRoom(0, CellSet.rect(0, 0, 5, 5), 'storage');
  const read = (data: unknown): FileSettings => {
    const r = readProjectFile(data);
    if (!r.ok) throw new Error(r.error);
    return r.settings;
  };
  const fileOf = (settings: FileSettings) => JSON.parse(JSON.stringify(toProjectFile({ project: p, settings }, new Date(0)))) as Record<string, Record<string, unknown>>;

  it('RoofDetailChoice → RoofDetail: nur Abweichungen vom Standard; Rückweg über styleFromBuild', () => {
    expect(roofDetailOptions('gable', DEFAULT_ROOF_DETAIL)).not.toHaveProperty('heightBudget');
    expect(roofDetailOptions('gable', DEFAULT_ROOF_DETAIL)).not.toHaveProperty('split');
    const d = { ...DEFAULT_ROOF_DETAIL, heightBudget: true, split: false };
    expect(roofDetailOptions('gable', d)).toMatchObject({ heightBudget: true, split: false });
    // schlichtes Dach mit Budget braucht Details, „nicht teilen“ allein nicht (schlicht wird nie geteilt)
    expect(roofDetailOptions('gable', { pitch: 'steep', trim: false, verge: 'plain', flare: false, gableWindows: false, halfHipRows: 0, mansardBreak: 0, heightBudget: true })).toEqual({ pitch: 'steep', gableWindows: false, heightBudget: true });
    expect(styleFromBuild({ roof: 'gable', roofDetail: { pitch: 'steep', heightBudget: true, split: false } }).roofDetail).toMatchObject({ heightBudget: true, split: false });
    expect(styleFromBuild({ roof: 'gable', roofDetail: { pitch: 'steep' } }).roofDetail).not.toHaveProperty('heightBudget');
    expect(roofDetailProblem({ ...DEFAULT_ROOF_DETAIL, split: 'ja' as unknown as boolean })).toMatch(/teilen/);
  });

  it('Projektdatei: Felder bleiben; alte Dateien ohne Felder laden bitgleich', () => {
    const base: FileSettings = { ...styleFromBuild({ roof: 'gable', roofDetail: { pitch: 'normal', trim: true } }), density: new Map() };
    const on: FileSettings = { ...base, roofDetail: { ...base.roofDetail, heightBudget: true, split: false } };
    const back = read(fileOf(on));
    expect(back.roofDetail).toMatchObject({ heightBudget: true, split: false });
    expect(shellOptions(shellStyle(back))).toEqual(shellOptions(on));
    const old = read(fileOf(base));
    expect(old.roofDetail.heightBudget).toBeUndefined();
    expect(old.roofDetail.split).toBeUndefined();
    expect(shellOptions(shellStyle(old))).toEqual(shellOptions(base));
  });

  it('Traufkonsolen: fehlt die Gruppe in der Datei, gilt der Schalter der Traufenlaternen (Konsolen gehörten dazu)', () => {
    const base: FileSettings = { ...styleFromBuild({ roof: 'gable' }), exterior: DEFAULT_EXTERIOR, density: new Map() };
    const file = fileOf(base);
    const exterior = file['exterior'] as { groups: Record<string, boolean> };
    const { eaveBraces: _b, ...oldGroups } = exterior.groups;
    const oldOff = read({ ...file, exterior: { ...exterior, groups: { ...oldGroups, eaveLanterns: false } } });
    expect(oldOff.exterior.groups.eaveBraces).toBe(false);
    expect(exteriorOptions(oldOff.exterior)).toMatchObject({ eaveLanterns: false, eaveBraces: false });
    const oldOn = read({ ...file, exterior: { ...exterior, groups: oldGroups } });
    expect(oldOn.exterior.groups.eaveBraces).toBe(true);
    // nur Konsolen: ausdrücklich an, weil sie sonst den Laternen folgen
    const only = { ...DEFAULT_EXTERIOR, groups: { ...DEFAULT_EXTERIOR.groups, eaveLanterns: false, eaveBraces: true } };
    expect(exteriorOptions(only)).toMatchObject({ eaveLanterns: false, eaveBraces: true });
    expect(styleFromBuild({ roof: 'gable', exterior: exteriorOptions(only)! }).exterior.groups).toMatchObject({ eaveLanterns: false, eaveBraces: true });
    expect(styleFromBuild({ roof: 'gable', exterior: { eaveLanterns: false } }).exterior.groups).toMatchObject({ eaveLanterns: false, eaveBraces: false });
    expect(exteriorOptions(DEFAULT_EXTERIOR)).not.toHaveProperty('eaveBraces');
  });
});
