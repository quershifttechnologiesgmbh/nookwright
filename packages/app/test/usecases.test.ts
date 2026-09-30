import { Rng, key3 } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { buildCatalog } from '../src/catalogLoader.js';
import { openingCell } from '../src/editor/grid.js';
import * as uc from '../src/usecases.js';

const catalog = loadBundledCatalog().catalog!;

function paint(s: uc.Session, x1: number, z1: number, x2: number, z2: number, type = 'bedroom'): { session: uc.Session; roomId: string } {
  const r = uc.paintRect(s, catalog, { x1, z1, x2, z2 }, type);
  if (r.roomId === undefined) throw new Error('kein Raum');
  return { session: r.session, roomId: r.roomId };
}

const ids = (s: uc.Session, roomId: string) => s.project.state.placements.filter((p) => p.roomId === roomId).map((p) => p.id);
const components = (s: uc.Session, roomId: string) =>
  s.project.state.placements
    .filter((p) => p.roomId === roomId)
    .map((p) => p.componentId)
    .sort();

/** Harte Garantien der Einrichtung, geprüft gegen die Hülle der App. */
function assertFurnishingInsideRooms(s: uc.Session): void {
  const shell = uc.shellOf(s.project);
  const seen = new Set<string>();
  for (const v of uc.placedViews(s.project.state, catalog)) {
    const g = shell.rooms.get(v.placement.roomId)!;
    for (const c of v.placed.cells) {
      expect(g.interior.has(c.pos[0], c.pos[2]), `${v.def.id} außerhalb des Innenraums`).toBe(true);
      expect(seen.has(key3(c.pos)), `Kollision bei ${key3(c.pos)}`).toBe(false);
      seen.add(key3(c.pos));
    }
  }
}

/** Räume mit gleichem Raumtyp, Würfelzähler und gleicher Geometrie behalten ihre Platzierungen (gleiche IDs). */
function assertOnlyDirtyRefurnished(before: uc.Session, after: uc.Session): void {
  const sb = uc.shellOf(before.project);
  const sa = uc.shellOf(after.project);
  for (const r of after.project.state.rooms) {
    const prev = before.project.state.rooms.find((x) => x.id === r.id);
    if (prev === undefined) continue;
    const same =
      prev.roomTypeId === r.roomTypeId &&
      prev.rerollCount === r.rerollCount &&
      uc.geometryKey(sb.rooms.get(r.id)!) === uc.geometryKey(sa.rooms.get(r.id)!);
    if (same) expect(ids(after, r.id), `Raum ${r.id} unnötig neu eingerichtet`).toEqual(ids(before, r.id));
    else if (ids(before, r.id).length > 0) expect(ids(after, r.id), `Raum ${r.id} nicht neu eingerichtet`).not.toEqual(ids(before, r.id));
  }
}

describe('Use Cases: Malen und Einrichten', () => {
  it('Raum malen richtet ihn sofort ein (Schlafzimmer mit Bett)', () => {
    const s0 = uc.createSession(42);
    const { session, roomId } = paint(s0, 2, 2, 9, 8);
    expect(session.project.state.rooms.map((r) => r.id)).toEqual([roomId]);
    expect(components(session, roomId)).toContain('bed/single');
    // feat/theme-moods-on (B4): neue Projekte tragen die Stimmung des Themes (`MoodChanged` direkt nach dem Anlegen)
    expect(session.project.history.map((e) => e.type)).toEqual(['ProjectCreated', 'MoodChanged', 'RoomPainted', 'RoomFurnished']);
    expect(uc.canUndo(session)).toBe(true);
    // Ausgangssitzung bleibt unverändert (Kopie statt Mutation)
    expect(s0.project.state.rooms).toEqual([]);
    expect(s0.project.history).toHaveLength(2);
    assertFurnishingInsideRooms(session);
  });

  it('Undo nimmt die ganze Aktion zurück (Befehl + Einrichtung)', () => {
    const a = paint(uc.createSession(1), 2, 2, 9, 8).session;
    const b = paint(a, 12, 2, 20, 9, 'kitchen').session;
    const back = uc.undo(b);
    expect(back.project.history).toEqual(a.project.history);
    expect(back.project.state.placements).toEqual(a.project.state.placements);
    expect(uc.undo(uc.undo(b)).project.state.rooms).toEqual([]);
    expect(uc.canUndo(uc.undo(uc.undo(b)))).toBe(false);
  });

  it('Raumtyp ändern tauscht die Einrichtung; Undo stellt sie wieder her', () => {
    const { session, roomId } = paint(uc.createSession(3), 2, 2, 11, 9);
    const smithy = uc.assignRoomType(session, catalog, roomId, 'smithy');
    expect(components(smithy, roomId)).toContain('work/anvil');
    expect(components(smithy, roomId)).not.toContain('bed/single');
    expect(uc.undo(smithy).project.state.placements).toEqual(session.project.state.placements);
  });

  it('gleicher Raumtyp ist keine Aktion (kein leerer Undo-Schritt)', () => {
    const { session, roomId } = paint(uc.createSession(3), 2, 2, 11, 9);
    expect(uc.assignRoomType(session, catalog, roomId, 'bedroom')).toBe(session);
  });

  it('Neu würfeln erhöht den Zähler und richtet neu ein; deterministisch je Seed', () => {
    const { session, roomId } = paint(uc.createSession(99), 2, 2, 13, 10, 'storage');
    const r1 = uc.rerollRoom(session, catalog, roomId);
    expect(r1.project.room(roomId).rerollCount).toBe(1);
    expect(r1.project.roomSeed(roomId)).not.toBe(session.project.roomSeed(roomId));
    const poses = (s: uc.Session) => s.project.state.placements.map((p) => `${p.componentId}@${p.pose.pos.join(',')}/${p.pose.rot}`).sort();
    // Mindestens einer von drei Würfen unterscheidet sich (Lager mit vielen Truhen)
    const r2 = uc.rerollRoom(r1, catalog, roomId);
    const r3 = uc.rerollRoom(r2, catalog, roomId);
    expect(new Set([poses(session), poses(r1), poses(r2), poses(r3)].map((p) => p.join('|'))).size).toBeGreaterThan(1);
    // Gleiche Befehle, gleicher Seed → gleiches Ergebnis
    const again = uc.rerollRoom(paint(uc.createSession(99), 2, 2, 13, 10, 'storage').session, catalog, roomId);
    expect(again.project.state).toEqual(r1.project.state);
  });

  it('nur betroffene Räume werden neu eingerichtet (Programm oder Geometrie geändert)', () => {
    const a = paint(uc.createSession(5), 1, 1, 9, 8);
    const b = paint(a.session, 20, 10, 30, 18, 'kitchen');
    assertOnlyDirtyRefurnished(a.session, b.session);
    // Übermalen eines Teils von A → A wird neu eingerichtet, B bleibt (weit weg, eigene Geometrie)
    const c = paint(b.session, 7, 1, 12, 8, 'storage');
    expect(c.session.project.room(a.roomId).cells.has(8, 3)).toBe(false);
    expect(ids(c.session, a.roomId)).not.toEqual(ids(b.session, a.roomId));
    assertOnlyDirtyRefurnished(b.session, c.session);
    assertFurnishingInsideRooms(c.session);
    // Befehle ohne Geometrieänderung richten nichts neu ein (Theme-Wechsel schon: Stil-Kette, siehe exteriorDecor.test.ts)
    const renamed = uc.renameProject(c.session, 'Anderer Name');
    expect(renamed.project.state.placements).toEqual(c.session.project.state.placements);
  });

  it('Radieren teilt einen Raum; beide Teile werden eingerichtet', () => {
    const { session } = paint(uc.createSession(8), 0, 0, 20, 7);
    const split = uc.eraseRect(session, catalog, { x1: 10, z1: 0, x2: 10, z2: 7 });
    expect(split.project.state.rooms).toHaveLength(2);
    for (const r of split.project.state.rooms) expect(components(split, r.id)).toContain('bed/single');
    assertFurnishingInsideRooms(split);
  });

  it('Raum löschen entfernt Raum und Möbel', () => {
    const { session, roomId } = paint(uc.createSession(8), 0, 0, 8, 8);
    const gone = uc.deleteRoom(session, catalog, roomId);
    expect(gone.project.state.rooms).toEqual([]);
    expect(gone.project.state.placements).toEqual([]);
  });

  it('gesperrte Möbel überstehen Neu-Würfeln', () => {
    const { session, roomId } = paint(uc.createSession(12), 2, 2, 12, 10);
    const bed = session.project.state.placements.find((p) => p.componentId === 'bed/single')!;
    const locked = uc.toggleLock(session, catalog, bed.id);
    expect(locked.project.placement(bed.id).locked).toBe(true);
    let s = locked;
    for (let i = 0; i < 4; i++) s = uc.rerollRoom(s, catalog, roomId);
    const still = s.project.placement(bed.id);
    expect(still.locked).toBe(true);
    expect(still.pose).toEqual(bed.pose);
    assertFurnishingInsideRooms(s);
    const unlocked = uc.toggleLock(s, catalog, bed.id);
    expect(unlocked.project.placement(bed.id).locked).toBe(false);
  });

  it('Theme wird im Projekt vermerkt und ist rückgängig machbar', () => {
    const s = uc.setTheme(uc.createSession(1), catalog, 'nordic');
    expect(s.project.state.themeId).toBe('nordic');
    expect(uc.undo(s).project.state.themeId).toBe('medieval');
    expect(uc.createSession(1, 'X', 'rustic').project.state.themeId).toBe('rustic');
  });

  it('Zielversion wechseln: Einrichtung bleibt (alle Komponenten verfügbar), rückgängig machbar', () => {
    const { session } = paint(uc.createSession(31), 2, 2, 11, 9, 'kitchen');
    const v26 = uc.setTargetVersion(session, catalog, '26.3');
    expect(v26.project.state.targetVersion).toEqual({ name: '26.3', dataVersion: 5023 });
    expect(v26.project.state.placements).toEqual(session.project.state.placements);
    expect(uc.setTargetVersion(v26, catalog, '26.3')).toBe(v26);
    expect(uc.undo(v26).project.state.targetVersion.name).toBe('1.21.11');
    expect(() => uc.setTargetVersion(session, catalog, '1.12.2')).toThrow('Unbekannte Zielversion');
    expect(uc.TARGET_VERSION_NAMES).toEqual(['1.21.11', '26.3']);
  });

  it('Zielversion wechseln: Räume mit Komponenten, die es dort nicht gibt, werden neu eingerichtet', () => {
    const barrel = (id: string, version: string) => `{ id: "${id}", kind: "static", category: "storage", tags: ["box"], obtainability: "survival",
      ${version}, mount: "floor", rotations: "all", layers: [["A"]], legend: { A: { block: "minecraft:barrel" } } }`;
    const mini = buildCatalog({
      'catalog/components/test/old_box.json5': barrel('test/old_box', 'maxVersion: 4671'),
      'catalog/components/test/new_box.json5': barrel('test/new_box', 'minVersion: 5000'),
      'catalog/roomtypes/cellar.json5': `{ id: "cellar", name: "Keller", minArea: 4, coverage: { target: 0.2 },
        required: [{ tags: ["box"], count: [1, 1] }], optional: [] }`,
    }).catalog!;
    const r = uc.paintRect(uc.createSession(5), mini, { x1: 0, z1: 0, x2: 6, z2: 6 }, 'cellar');
    const comps = (s: uc.Session) => s.project.state.placements.map((p) => p.componentId);
    expect(comps(r.session)).toEqual(['test/old_box']);
    const v26 = uc.setTargetVersion(r.session, mini, '26.3');
    expect(comps(v26)).toEqual(['test/new_box']);
    expect(comps(uc.undo(v26))).toEqual(['test/old_box']);
  });

  it('Domänenfehler lassen die Sitzung unverändert', () => {
    const s = uc.createSession(1);
    expect(() => uc.rerollRoom(s, catalog, 'r99')).toThrow('Unbekannter Raum');
    expect(uc.errorMessage(new Error('x'))).toContain('Interner Fehler');
  });

  it('Hinweise der Einrichtung werden je Raum geführt und mit Undo zurückgesetzt', () => {
    const { session, roomId } = paint(uc.createSession(4), 0, 0, 3, 3, 'smithy'); // innen 2 × 2 < minArea 9
    expect(session.warnings.get(roomId)?.join()).toContain('kleiner als das Minimum');
    // furnishRooms (@mcda/pipeline) stellt „r1 (smithy): “ voran – die App führt Hinweise je Raum und kürzt das
    for (const w of session.warnings.get(roomId)!) expect(w.startsWith(roomId)).toBe(false);
    expect(uc.undo(session).warnings.size).toBe(0);
  });

  it('Fuzz: zufällige Mal-/Radier-Folgen halten die Garantien', () => {
    const rng = new Rng(2026);
    const types = catalog.roomTypeIds();
    let s = uc.createSession(777);
    for (let i = 0; i < 25; i++) {
      const x = rng.int(0, uc.GRID.width - 1);
      const z = rng.int(0, uc.GRID.depth - 1);
      const rect = { x1: x, z1: z, x2: x + rng.int(-10, 10), z2: z + rng.int(-8, 8) };
      s = rng.chance(0.75) ? uc.paintRect(s, catalog, rect, rng.pick(types)).session : uc.eraseRect(s, catalog, rect);
    }
    assertFurnishingInsideRooms(s);
    for (const r of s.project.state.rooms) expect(r.cells.isConnected()).toBe(true);
  });
});

describe('Hülle aus @mcda/blueprint', () => {
  it('benachbarte Räume teilen sich eine Wand mit Durchgangstür; beide werden eingerichtet', () => {
    const a = paint(uc.createSession(21), 0, 0, 9, 7);
    const b = paint(a.session, 10, 0, 19, 7, 'kitchen');
    const shell = uc.shellOf(b.session.project);
    const g1 = shell.rooms.get(a.roomId)!;
    const g2 = shell.rooms.get(b.roomId)!;
    const open1 = new Set(g1.doors.map((d) => openingCell(d).join(',')));
    expect(g2.doors.some((d) => open1.has(openingCell(d).join(',')))).toBe(true);
    // gemeinsame Wand: zusammen weniger Wandzellen als zwei getrennte Räume
    const wallCells = (id: string) => b.session.project.room(id).cells.size - shell.rooms.get(id)!.interior.size;
    expect(wallCells(a.roomId) + wallCells(b.roomId)).toBeLessThan(2 * (2 * 10 + 2 * 8 - 4));
    // W2 (26.09.2026): Regeln F1/F2 (W2-FA, ein Fenster je Rasterfeld) – das Schlafzimmer bekommt andere Fenster und
    // damit eine andere, gleichwertige Einrichtung (z. B. Alkovenbett statt Einzelbett); Pflicht bleibt ein Bett
    expect(components(b.session, a.roomId).some((id) => id.startsWith('bed/'))).toBe(true);
    expect(components(b.session, b.roomId).length).toBeGreaterThan(0);
    assertFurnishingInsideRooms(b.session);
  });

  it('Hüllen-Schlüssel sieht verschachtelte Stil-Felder (Dach-Details, Gauben und F1-Deko)', () => {
    const style = uc.shellStyle({ roof: 'gable' });
    // `dormers` zählt nur, wenn Gauben an sind (`kind: none` = aus, dann ist die Welt bewusst gleich)
    const withDormers = uc.shellStyle({ ...style, dormers: { ...style.dormers, kind: 'gable' } });
    const patches: ReadonlyArray<Partial<uc.ShellStyle>> = [
      { roofDetail: { ...style.roofDetail, pitch: 'steep' } },
      { facade: { ...style.facade, decorate: true } },
      { facade: { ...style.facade, gableBraces: 2 } },
      { facade: { ...style.facade, decorate: false } },
    ];
    expect(uc.shellKey(uc.shellStyle({ ...withDormers, dormers: { ...withDormers.dormers, width: 5 } }))).not.toBe(uc.shellKey(withDormers));
    for (const patch of patches) {
      const next = uc.shellStyle({ ...style, ...patch });
      expect(uc.shellKey(next), JSON.stringify(patch)).not.toBe(uc.shellKey(style));
      expect(uc.styleKey(next), JSON.stringify(patch)).not.toBe(uc.styleKey(style));
      // gleicher Inhalt ergibt denselben Schlüssel, egal wie das Objekt entstanden ist
      expect(uc.shellKey(uc.shellStyle({ ...style, ...patch }))).toBe(uc.shellKey(next));
    }
  });
});

describe('Use Cases: Raster und Abfragen', () => {
  it('Rechtecke werden normalisiert und auf das Raster begrenzt', () => {
    expect(uc.clampRect({ x1: 5, z1: 7, x2: -3, z2: 2 })).toEqual({ x1: 0, z1: 2, x2: 5, z2: 7 });
    expect(uc.clampRect({ x1: 45, z1: 0, x2: 50, z2: 3 })).toBeUndefined();
    expect(uc.rectCells({ x1: 38, z1: 28, x2: 45, z2: 40 }).size).toBe(4);
    const s = uc.paintRect(uc.createSession(1), catalog, { x1: 60, z1: 60, x2: 70, z2: 70 }, 'bedroom');
    expect(s.roomId).toBeUndefined();
  });

  it('roomAt findet den Raum unter einer Zelle', () => {
    const { session, roomId } = paint(uc.createSession(1), 3, 3, 8, 8);
    expect(uc.roomAt(session.project.state, 3, 8)?.id).toBe(roomId);
    expect(uc.roomAt(session.project.state, 9, 8)).toBeUndefined();
  });
});
