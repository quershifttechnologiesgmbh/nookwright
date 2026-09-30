/**
 * Auswahl: Klick in 3D → Herkunft (`owner`) aus dem VoxelVolume → Platzierung bzw. Raum; Bereinigung nach Änderungen;
 * Auswahlrahmen. Geprüft gegen das echte materialisierte Beispielhaus (dieselbe Welt wie Vorschau und Export).
 */
import { key3, type Vec3 } from '@mcda/core';
import { isAir } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { worldOf } from '../src/exporting.js';
import { NO_SELECTION, selectionBox, selectionFromOwner, validSelection } from '../src/selection.js';
import { ownerAt, textureScene, textureVolume } from '../src/textures/scene.js';
import * as uc from '../src/usecases.js';
import { buildBlockVoxels } from '../src/viewer/blocks.js';
import { buildPreviewVoxels } from '../src/viewer/voxels.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;

describe('Auswahl aus der Herkunft eines Blocks', () => {
  const s = sampleSession(catalog);
  const state = s.project.state;
  const p = state.placements[0]!;

  it('Platzierung → Raum + Platzierung; Hülle → Raum; Unbekanntes/Leere → nichts', () => {
    expect(selectionFromOwner(p.id, state)).toEqual({ roomId: p.roomId, placementId: p.id });
    const room = state.rooms[1]!;
    expect(selectionFromOwner(`shell:${room.id}`, state)).toEqual({ roomId: room.id });
    expect(selectionFromOwner('shell:r999', state)).toBe(NO_SELECTION);
    expect(selectionFromOwner('shell:-', state)).toBe(NO_SELECTION);
    expect(selectionFromOwner('muster', state)).toBe(NO_SELECTION);
    expect(selectionFromOwner(undefined, state)).toBe(NO_SELECTION);
  });

  it('jede Herkunft im materialisierten Volumen ist Platzierung oder Hülle eines Raums (Dach ohne Raum: keine Auswahl)', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const world = worldOf(s.project, ctx, s.roof);
    const owners = world.materialized.volume.owners();
    expect(owners.length).toBeGreaterThan(state.rooms.length);
    for (const o of owners) {
      // Hüllenzellen ohne Raum (Dach): keine Auswahl; Außen-Deko (`x1:…`): das Außen-Teil
      if (o === 'shell:-') expect(selectionFromOwner(o, state)).toBe(NO_SELECTION);
      else if (o.startsWith('x1:')) expect(selectionFromOwner(o, state)).toEqual({ exteriorId: o });
      else expect(selectionFromOwner(o, state).roomId, o).toBeDefined();
    }
    // W2-FD: Innenhaut (Paneele, Leisten, Teppich) → der Raum, zu dem sie gehört
    const lining = owners.filter((o) => o.startsWith('lining:'));
    expect(lining.length).toBeGreaterThan(0);
    for (const o of lining) expect(selectionFromOwner(o, state), o).toEqual({ roomId: o.split(':')[1] });
    expect(selectionFromOwner('lining:unbekannt:panel', state)).toBe(NO_SELECTION);
    // dieselben Herkünfte stehen an den Quadern der Blockvorschau
    const voxelOwners = new Set(buildBlockVoxels(world).map((v) => v.owner));
    for (const o of voxelOwners) expect(o === undefined || owners.includes(o), String(o)).toBe(true);
    // und an den Quadern der Rollen-Vorschau
    const roleOwners = new Set(buildPreviewVoxels(uc.shellOf(s.project, s.roof), uc.placedViews(state, catalog)).map((v) => v.owner));
    expect(roleOwners.has(p.id)).toBe(true);
    expect([...roleOwners].some((o) => o?.startsWith('shell:') === true)).toBe(true);
  });

  it('ownerAt: sichtbare Blöcke ja; Luft, über dem Schnitt, ausgeblendete Wände, außerhalb nein', async () => {
    const ctx = await pipeline.ready('1.21.11');
    const world = worldOf(s.project, ctx, s.roof);
    const vol = world.materialized.volume;
    const furniture = [...vol.cells()].find((c) => c.owner === p.id && !isAir(c.state))!;
    expect(ownerAt(world, 'full', undefined, furniture.pos)).toBe(p.id);
    expect(ownerAt(world, 'full', furniture.pos[1] - 1, furniture.pos)).toBeUndefined();
    const wall = world.shell.cells.find((c) => c.kind === 'wall')!;
    expect(ownerAt(world, 'full', undefined, wall.pos)).toMatch(/^shell:/);
    expect(ownerAt(world, 'floorOnly', undefined, wall.pos)).toBeUndefined();
    const outside: Vec3 = [vol.origin[0] - 1, vol.origin[1], vol.origin[2]];
    expect(ownerAt(world, 'full', undefined, outside)).toBeUndefined();
    const air = [...vol.cells()].find((c) => isAir(c.state));
    if (air !== undefined) expect(ownerAt(world, 'full', undefined, air.pos)).toBeUndefined();
    // „Wände ab“ blendet genau die Wandzellen aus, die Quelle ist zwischengespeichert (Schnitt baut kein Licht neu)
    const hidden = textureVolume(world, 'floorOnly');
    expect(textureVolume(world, 'floorOnly')).toBe(hidden);
    expect([...hidden.cells()].some((c) => key3(c.pos) === key3(wall.pos))).toBe(false);
    expect(textureScene(world, 'floorOnly', 2).source).toBe(textureScene(world, 'floorOnly', undefined).source);
  });
});

describe('Auswahl bereinigen und hervorheben', () => {
  it('neu gewürfelt → Möbel weg, Raum bleibt; Raum gelöscht → nichts; gültig → identisch', () => {
    const s = sampleSession(catalog);
    const state = s.project.state;
    const p = state.placements.find((x) => !x.locked)!;
    const sel = { roomId: p.roomId, placementId: p.id };
    expect(validSelection(sel, state)).toBe(sel);
    const rerolled = uc.rerollRoom(s, catalog, p.roomId);
    expect(validSelection(sel, rerolled.project.state)).toEqual({ roomId: p.roomId });
    const deleted = uc.deleteRoom(s, catalog, p.roomId);
    expect(validSelection(sel, deleted.project.state)).toBe(NO_SELECTION);
    expect(validSelection({ placementId: p.id }, state)).toBe(NO_SELECTION);
    expect(validSelection(NO_SELECTION, state)).toBe(NO_SELECTION);
  });

  it('Rahmen: Platzierung = ihre Blockzellen, Raum = Zellen × Etage bis zur Decke', () => {
    const s = sampleSession(catalog);
    const state = s.project.state;
    const views = uc.placedViews(state, catalog);
    const v = views.find((x) => x.placed.cells.length > 1)!;
    const box = selectionBox({ roomId: v.placement.roomId, placementId: v.placement.id }, state, views)!;
    for (const c of v.placed.cells) for (let k = 0; k < 3; k++) {
      expect(c.pos[k]).toBeGreaterThanOrEqual(box.min[k]!);
      expect(c.pos[k]).toBeLessThanOrEqual(box.max[k]!);
    }
    const room = state.rooms[0]!;
    const b = room.cells.bounds()!;
    const floor = state.floors[0]!;
    expect(selectionBox({ roomId: room.id }, state, views)).toEqual({ min: [b.minX, floor.y0, b.minZ], max: [b.maxX, floor.y0 + floor.height + 1, b.maxZ] });
    expect(selectionBox(NO_SELECTION, state, views)).toBeUndefined();
  });
});
