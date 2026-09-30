/**
 * W3-CA „Burg und Türme“: neue Felder überleben Speichern/Laden und die Rückübersetzung – Fenstermodul der Außen-Deko
 * (`ExteriorChoice.windowModule`), Turmsatz und Licht der Mauertürme (`TowerStyle.corner/gate/lit`), Torbau
 * (`GateSpec.gateBlock`), Wehrplatte mit Abschluss und Belag (`crown`, `deck`). Alte Dateien laden bitgleich.
 */
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import {
  EMPTY_SURROUNDINGS, exteriorOptions, exteriorProblem, facadeOptions, facadeProblem, readProjectFile, readSurroundings, structureItemsOf, structuresInput, styleFromBuild,
  toProjectFile, type FileSettings, type SurroundingsState,
} from '../src/index.js';

describe('Fenstermodul der Außen-Deko (W3-CA)', () => {
  const read = (data: unknown): FileSettings => {
    const r = readProjectFile(data);
    if (!r.ok) throw new Error(r.error);
    return r.settings;
  };

  it('Bautyp → Sitzung → Domäne; Speichern/Laden; alte Dateien ohne; Unsinn fällt weg', () => {
    const style = styleFromBuild({ roof: 'gable', exterior: { density: 0.75, flowerBoxes: false, windowModule: 'stone' } });
    expect(style.exterior.windowModule).toBe('stone');
    expect(exteriorOptions(style.exterior)).toEqual({ density: 0.75, flowerBoxes: false, windowModule: 'stone' });
    const p = Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.paintRoom(0, CellSet.rect(0, 0, 5, 5), 'storage');
    const file = JSON.parse(JSON.stringify(toProjectFile({ project: p, settings: { ...style, density: new Map() } }, new Date(0)))) as Record<string, unknown> & { exterior: Record<string, unknown> };
    expect(read(file).exterior.windowModule).toBe('stone');
    const { windowModule: _w, ...old } = file.exterior;
    expect(read({ ...file, exterior: old }).exterior.windowModule).toBeUndefined();
    expect(read({ ...file, exterior: { ...file.exterior, windowModule: 'marmor' } }).exterior.windowModule).toBeUndefined();
    expect(exteriorProblem({ ...style.exterior, windowModule: 'marmor' as 'stone' })).toMatch(/Fenstermodul/);
    // ohne Modul: Domäne ohne Feld (bitgleich)
    expect(exteriorOptions(styleFromBuild({ roof: 'gable', exterior: { density: 1 } }).exterior)).toEqual({ density: 1 });
  });

  it('W4-B (27.09.2026): Eingangsmodul wie das Fenstermodul – Bautyp → Sitzung → Domäne, Speichern/Laden, Unsinn fällt weg', () => {
    const style = styleFromBuild({ roof: 'flat', exterior: { density: 0.75, windowModule: 'stone', entranceModule: 'stone' } });
    expect(exteriorOptions(style.exterior)).toEqual({ density: 0.75, windowModule: 'stone', entranceModule: 'stone' });
    const p = Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.paintRoom(0, CellSet.rect(0, 0, 5, 5), 'storage');
    const file = JSON.parse(JSON.stringify(toProjectFile({ project: p, settings: { ...style, density: new Map() } }, new Date(0)))) as Record<string, unknown> & { exterior: Record<string, unknown> };
    expect(read(file).exterior).toMatchObject({ windowModule: 'stone', entranceModule: 'stone' });
    const { entranceModule: _e, ...old } = file.exterior;
    expect(read({ ...file, exterior: old }).exterior.entranceModule).toBeUndefined();
    const bad = read({ ...file, exterior: { ...file.exterior, entranceModule: 'marmor' } }).exterior;
    expect([bad.windowModule, bad.entranceModule]).toEqual(['stone', undefined]);
    expect(exteriorProblem({ ...style.exterior, entranceModule: 'marmor' as 'stone' })).toMatch(/Eingangsmodul/);
  });

  it('W5-B (27.09.2026): Module im Material des Themes und Rahmenrolle – Bautyp → Sitzung → Domäne, Speichern/Laden, Unsinn fällt weg', () => {
    const style = styleFromBuild({
      roof: 'gable', facade: { plinthProfile: true, frameRole: 'wall_cornice' },
      exterior: { density: 0.75, windowModule: 'stone', entranceModule: 'stone', themeMaterial: true },
    });
    expect(exteriorOptions(style.exterior)).toEqual({ density: 0.75, windowModule: 'stone', entranceModule: 'stone', themeMaterial: true });
    expect(facadeOptions(style.facade)).toEqual({ plinthProfile: true, frameRole: 'wall_cornice' });
    const p = Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'nordic', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.paintRoom(0, CellSet.rect(0, 0, 5, 5), 'storage');
    const file = JSON.parse(JSON.stringify(toProjectFile({ project: p, settings: { ...style, density: new Map() } }, new Date(0)))) as
      Record<string, unknown> & { exterior: Record<string, unknown>; facade: Record<string, unknown> };
    const back = read(file);
    expect(back.exterior.themeMaterial).toBe(true);
    expect(back.facade.frameRole).toBe('wall_cornice');
    // alte Dateien ohne die Felder: bitgleich (Feld fehlt)
    const { themeMaterial: _t, ...oldExt } = file.exterior;
    const { frameRole: _f, ...oldFac } = file.facade;
    const old = read({ ...file, exterior: oldExt, facade: oldFac });
    expect(old.exterior.themeMaterial).toBeUndefined();
    expect(old.facade.frameRole).toBeUndefined();
    expect(facadeOptions(old.facade)).toEqual({ plinthProfile: true });
    // Unsinn fällt weg
    expect(read({ ...file, exterior: { ...file.exterior, themeMaterial: 'ja' } }).exterior.themeMaterial).toBeUndefined();
    expect(facadeProblem({ ...style.facade, frameRole: 'gold' as 'wall_cornice' })).toMatch(/Rahmenrolle/);
  });

  it('W13-E (28.09.2026): Wandkleid der Obergeschosse – Bautyp → Sitzung → Domäne, Speichern/Laden, alte Dateien ohne', () => {
    const style = styleFromBuild({ roof: 'gable', facade: { plinthProfile: true, upperFrame: true } });
    expect(style.facade.upperFrame).toBe(true);
    expect(facadeOptions(style.facade)).toEqual({ plinthProfile: true, upperFrame: true });
    const p = Project.create({ id: 'p', name: 'P', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.paintRoom(0, CellSet.rect(0, 0, 5, 5), 'storage');
    const file = JSON.parse(JSON.stringify(toProjectFile({ project: p, settings: { ...style, density: new Map() } }, new Date(0)))) as
      Record<string, unknown> & { facade: Record<string, unknown> };
    expect(read(file).facade.upperFrame).toBe(true);
    const { upperFrame: _u, ...oldFac } = file.facade;
    const old = read({ ...file, facade: oldFac });
    expect(old.facade.upperFrame).toBeUndefined();
    expect(facadeOptions(old.facade)).toEqual({ plinthProfile: true });
    expect(facadeProblem({ ...style.facade, upperFrame: 'ja' as unknown as boolean })).toMatch(/Wandkleid/);
  });
});

describe('Bauwerke: Turmsatz, Torbau, Wehrplatte (W3-CA)', () => {
  const sur: SurroundingsState = {
    ...EMPTY_SURROUNDINGS,
    structures: [
      {
        kind: 'wall', id: 'w1', plan: {
          points: [[0, 0], [30, 0], [30, 20], [0, 20]], closed: true,
          towerStyle: { shape: 'round', top: 'battlements', lit: true, corner: { top: 'roof', roofShape: 'cone', flare: true, finial: 'pole' }, gate: { corbels: false } },
          gates: [{ at: [15, 20], gatehouse: true, gateBlock: true }],
        },
      },
      { kind: 'tower', id: 't2', spec: { center: [40, 5], lit: true } },
      { kind: 'parapet', id: 'p3', volumeId: 'v1', crown: 'lookout', deck: true },
    ],
    seq: 4,
  };

  it('Umkehrung und Lesen erhalten alle neuen Felder', () => {
    const back = structureItemsOf(structuresInput(sur, (item) => ({ id: item.id, volumeId: item.volumeId!, cells: [[0, 0]], y: 9, crown: item.crown!, deck: item.deck! })));
    const parapet = back.structures.find((i) => i.kind === 'parapet');
    expect(parapet?.id).toBe('p3');
    const { id: _id, ...fields } = parapet!;
    expect(fields).toEqual({ kind: 'parapet', volumeId: 'v1', crown: 'lookout', deck: true });
    const read = readSurroundings(JSON.parse(JSON.stringify(sur)));
    expect(read.warnings).toEqual([]);
    expect(read.state?.structures).toEqual(sur.structures);
  });

  it('ungültige Werte fallen feldweise weg', () => {
    const read = readSurroundings({
      structures: [
        { kind: 'parapet', id: 'p1', volumeId: 'v1', crown: 'kuppel', deck: 'ja' },
        { kind: 'wall', id: 'w2', plan: { points: [[0, 0], [9, 0]], towerStyle: { corner: { top: 'zwiebel' }, lit: 1 }, gates: [{ at: [4, 0], gateBlock: 'x' }] } },
      ],
    });
    expect(read.state?.structures[0]).toEqual({ kind: 'parapet', id: 'p1', volumeId: 'v1' });
    const wall = read.state?.structures[1];
    expect(wall?.kind === 'wall' ? wall.plan.towerStyle : 'x').toBeUndefined();
    expect(wall?.kind === 'wall' ? wall.plan.gates : undefined).toEqual([{ at: [4, 0] }]);
  });
});
