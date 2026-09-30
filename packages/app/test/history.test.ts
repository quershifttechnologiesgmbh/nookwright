/**
 * Use Cases rund um Verlauf und Projektwechsel: Wiederholen, Projektwechsel rückgängig, alle neu würfeln,
 * Raum sperren, Vorlagen (die Szenen der früheren Viewer-Demo als echte Projekte), Etagen-Parameter.
 */
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { showcase } from '../src/dev/showcase.js';
import { loadBundledTerrainStyles } from '../src/adapters/terrainStyles.js';
import { placementOf } from '../src/buildingTypes.js';
import { templateSession, templateTypes } from '../src/templates.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const ctx = { catalog, themes: load.themeCatalog!, terrainStyles: loadBundledTerrainStyles().styles, types: load.buildingTypes };
const paint = (s: uc.Session, x1: number, z1: number, x2: number, z2: number, type = 'bedroom') => uc.paintRect(s, catalog, { x1, z1, x2, z2 }, type).session;

describe('Wiederholen', () => {
  it('Undo → Redo stellt denselben Zustand her (Möbel, Hinweise, Licht); neue Aktion leert den Stapel', () => {
    const s0 = uc.createSession(7);
    const s1 = paint(s0, 0, 0, 7, 6);
    const s2 = paint(s1, 8, 0, 14, 6, 'kitchen');
    expect(uc.canRedo(s2)).toBe(false);
    const u1 = uc.undo(s2);
    expect(u1.project.state.rooms).toHaveLength(1);
    expect(uc.canRedo(u1)).toBe(true);
    const u2 = uc.undo(u1);
    expect(u2.project.state.rooms).toHaveLength(0);
    const r1 = uc.redo(u2);
    expect(r1.project.state).toBe(u1.project.state); // genau die Sitzung, die Undo verlassen hat
    expect(r1.project.state).toEqual(s1.project.state);
    expect(r1.warnings).toEqual(s1.warnings);
    const r2 = uc.redo(r1);
    expect(r2.project.state).toBe(s2.project.state);
    expect(uc.canRedo(r2)).toBe(false);
    expect(uc.redo(r2)).toBe(r2);
    // neue Aktion nach Undo verwirft den Wiederholen-Stapel
    const branch = paint(u1, 0, 8, 6, 12, 'storage');
    expect(uc.canRedo(branch)).toBe(false);
    expect(uc.redo(branch)).toBe(branch);
    // Umbenennen und Dach sind keine Undo-Schritte, leeren den Stapel aber (sonst würde Redo sie zurückdrehen)
    expect(uc.canRedo(uc.renameProject(u1, 'Neu'))).toBe(false);
    expect(uc.canRedo(uc.setRoof(u1, 'flat'))).toBe(false);
  });

  it('Projektwechsel (Vorlage, Laden, Neu) ist rückgängig und wiederholbar', () => {
    const old = paint(uc.createSession(1, 'Alt'), 0, 0, 6, 5);
    const fresh = uc.replaceSession(old, templateSession('hall', ctx, 99, 'medieval'));
    expect(fresh.project.state.name).toBe('Große Halle');
    expect(uc.canUndo(fresh)).toBe(true);
    const back = uc.undo(fresh);
    expect(back.project.state.name).toBe('Alt');
    expect(back.project.state).toBe(old.project.state);
    expect(uc.canUndo(back)).toBe(true); // die Aktion im alten Projekt bleibt rückgängig machbar
    const again = uc.redo(back);
    expect(again.project.state.name).toBe('Große Halle');
    // Aktionen im neuen Projekt: Undo bis zum Anfang, dann zurück ins alte Projekt
    const edited = paint(fresh, 30, 25, 35, 29, 'storage');
    expect(uc.undo(edited).project.state).toEqual(fresh.project.state);
    expect(uc.undo(uc.undo(edited)).project.state.name).toBe('Alt');
  });

  it('R1-10: Rückgängig/Wiederholen über einen Projektwechsel meldet keine „entfernten“ Treppen; Bearbeitungen schon', () => {
    const old = uc.createSession(1, 'Alt');
    const withStairs = templateSession('twostory', ctx, 5, 'medieval');
    expect(withStairs.project.state.links.length).toBeGreaterThan(0);
    const fresh = uc.replaceSession(old, withStairs);
    expect(uc.stairsRemovedBy(old, fresh)).toEqual([]); // Übernehmen
    const back = uc.undo(fresh);
    // vorher: removedStairs(fresh, back) listete alle Treppen des neuen Projekts als „entfernt“ (roter Fehler)
    expect(uc.removedStairs(fresh.project.state, back.project.state).length).toBeGreaterThan(0);
    expect(uc.historyOrSwitch(fresh, back)).toBe(true);
    expect(uc.stairsRemovedBy(fresh, back)).toEqual([]);
    const again = uc.redo(back);
    expect(uc.stairsRemovedBy(back, again)).toEqual([]);
    // Bearbeitung im neuen Projekt: Radieren über die Treppe entfernt sie – das bleibt gemeldet
    const erased = uc.eraseRect(again, catalog, { x1: 0, z1: 0, x2: uc.GRID.width - 1, z2: uc.GRID.depth - 1 }, uc.FLOOR_INDEX);
    expect(uc.historyOrSwitch(again, erased)).toBe(false);
    expect(uc.stairsRemovedBy(again, erased).map((l) => l.id)).toEqual(withStairs.project.state.links.map((l) => l.id));
    // … und deren Rückgängig holt sie ohne Meldung zurück
    expect(uc.stairsRemovedBy(erased, uc.undo(erased))).toEqual([]);
  });
});

describe('Raum- und Projekt-Aktionen', () => {
  it('Alle neu würfeln: ein Undo-Schritt, jeder Raum +1, gesperrte Möbel bleiben', () => {
    const s = sampleSession(catalog);
    const locked = s.project.state.placements[0]!;
    const s1 = uc.toggleLock(s, catalog, locked.id);
    const all = uc.rerollAll(s1, catalog);
    for (const r of all.project.state.rooms) expect(r.rerollCount).toBe(s1.project.state.rooms.find((x) => x.id === r.id)!.rerollCount + 1);
    expect(all.project.state.placements.some((p) => p.id === locked.id && p.locked)).toBe(true);
    expect(all.past.length).toBe(s1.past.length + 1);
    expect(uc.undo(all).project.state).toEqual(s1.project.state);
    expect(uc.rerollAll(uc.createSession(1), catalog).past).toHaveLength(0); // ohne Räume keine Änderung
  });

  it('Raum sperren/entsperren: alle Möbel des Raums, andere Räume unberührt, ein Undo-Schritt', () => {
    const s = sampleSession(catalog);
    const room = s.project.state.rooms[0]!;
    const locked = uc.setRoomLocked(s, catalog, room.id, true);
    const inRoom = (x: uc.Session, id: string) => x.project.state.placements.filter((p) => p.roomId === id);
    expect(inRoom(locked, room.id).every((p) => p.locked)).toBe(true);
    expect(inRoom(locked, s.project.state.rooms[1]!.id).some((p) => p.locked)).toBe(false);
    expect(locked.past.length).toBe(s.past.length + 1);
    expect(uc.setRoomLocked(locked, catalog, room.id, true)).toBe(locked); // nichts zu tun
    const unlocked = uc.setRoomLocked(locked, catalog, room.id, false);
    expect(inRoom(unlocked, room.id).some((p) => p.locked)).toBe(false);
    // gesperrt übersteht Neu-Würfeln
    const ids = inRoom(locked, room.id).map((p) => p.id).sort();
    expect(inRoom(uc.rerollRoom(locked, catalog, room.id), room.id).map((p) => p.id).filter((id) => ids.includes(id)).sort()).toEqual(ids);
  });

  it('Etagen-Parameter: Malen/Radieren/Suchen auf Etage 0; unbekannte Etage ist ein fachlicher Fehler', () => {
    const s = uc.paintRect(uc.createSession(2), catalog, { x1: 0, z1: 0, x2: 5, z2: 5 }, 'bedroom', 0).session;
    expect(uc.roomAt(s.project.state, 2, 2, 0)).toBeDefined();
    expect(uc.roomAt(s.project.state, 2, 2, 1)).toBeUndefined();
    expect(() => uc.paintRect(s, catalog, { x1: 10, z1: 0, x2: 15, z2: 5 }, 'bedroom', 1)).toThrow(/Etage/);
    expect(uc.eraseRect(s, catalog, { x1: 0, z1: 0, x2: 1, z2: 5 }, 0).project.state.rooms[0]!.cells.size).toBeLessThan(36);
    const room = s.project.state.rooms[0]!;
    expect(uc.deleteRoom(s, catalog, room.id).project.state.rooms).toHaveLength(0);
  });
});

describe('Vorlagen', () => {
  it('Beispielhaus und Halle: eingerichtet, zentriert, ohne Undo-Schritte; leeres Projekt', () => {
    const house = templateSession('house', ctx, 2026, 'rustic', 'flat');
    const st = house.project.state;
    // W12 (2026-09-28): W12-A – Beispielhaus hat eine Diele im Quergiebel und ist bei Größe M je Seed zweigeschossig
    // (Seed 2026: ja, oben Schlafkammer, Studierzimmer, Gästezimmer); vorher 4 Räume
    // W13-A (2026-09-28): die Schmiede ist ein eingeschossiger Nebenbaukörper (Werkstatt) – kein Gästezimmer mehr darüber;
    // vorher mit 'guest_room'
    // W13-A Runde 2 (2026-09-28): dazu der dreigeschossige Eckturm (Bibliothek, zwei Turmstuben); vorher ohne sie
    expect(st.rooms.map((r) => r.roomTypeId).sort()).toEqual(['bedroom', 'hallway', 'kitchen', 'library', 'smithy', 'solar', 'storage', 'study', 'tower_room', 'tower_room']);
    expect(st.placements.length).toBeGreaterThan(20);
    expect(st.themeId).toBe('rustic');
    expect(house.roof).toBe('flat');
    expect(house.past).toHaveLength(0);
    expect(house.needsLight).toBe(true); // der Licht-Pass läuft danach wie nach jeder Aktion
    const minX = Math.min(...st.rooms.map((r) => r.cells.bounds()!.minX));
    const maxX = Math.max(...st.rooms.map((r) => r.cells.bounds()!.maxX));
    expect(minX).toBe(placementOf(ctx.types.get('house'), { front: 'south' })[0]);
    expect(Math.abs(minX - (uc.GRID.width - 1 - maxX))).toBeLessThanOrEqual(1); // mittig (±1)
    const hall = templateSession('hall', ctx, 1, 'medieval');
    expect(hall.project.state.rooms).toHaveLength(1);
    expect(hall.project.state.rooms[0]!.cells.size).toBe(25 * 19);
    expect(templateSession('empty', ctx, 1, 'medieval').project.state.rooms).toHaveLength(0);
    expect(templateTypes(ctx.types).map((t) => t.id).sort()).toEqual(['hall', 'house', 'timber', 'twostory']);
    expect(() => templateSession('x', ctx, 1, 'medieval')).toThrow(/Vorlage/);
  });

  it('Blockmuster der Dev-Galerie: Sonderfälle vorhanden (Treppenformen, Doppeltruhe, Rahmen)', () => {
    const v = showcase();
    const names = new Set([...v.cells()].map((c) => c.state.name));
    for (const n of ['oak_stairs', 'spruce_fence', 'glass_pane', 'lantern', 'red_bed', 'spruce_door', 'chest', 'trapped_chest', 'oak_hanging_sign', 'blue_wall_banner']) expect(names.has(n), n).toBe(true);
    const shapes = new Set([...v.cells()].filter((c) => c.state.name === 'oak_stairs').map((c) => c.state.properties['shape']));
    expect(shapes.size).toBe(5);
    expect(v.entities()).toHaveLength(1);
  });
});
