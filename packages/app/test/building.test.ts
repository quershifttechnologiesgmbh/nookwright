/**
 * Gebäude-Funktionen der App (Use Cases, Node): Etagen, Wandhöhe, Treppen-Werkzeug, Dach/Überstand/Fenster,
 * Raumtypen samt Dichte, Qualitätswert und Möbel entfernen, Speichern/Laden v2, Etagen-Ansicht, Kürzel.
 */
import { DomainError, checkLink, type Room } from '@mcda/blueprint';
import { HORIZONTAL, key3, type Cell } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { interpretGesture } from '../src/editor/grid.js';
import { PROJECT_FILE_VERSION, parseProjectFile, serializeProject } from '../src/projectFile.js';
import { selectionBox, validSelection } from '../src/selection.js';
import { DEFAULT_STAIR_TOOL, linkLayout, rotateFacing, stairsAt, stairsPreview } from '../src/stairs.js';
import { densityLabel, qualitySummary } from '../src/ui/quality.js';
import { PLACING_SHORTCUTS, commandForKey, type KeyLike } from '../src/ui/shortcuts.js';
import { combineRange, floorItems, floorRange, ghostFloor } from '../src/ui/viewModel.js';
import * as uc from '../src/usecases.js';
import { buildPreviewVoxels, cutVoxels, voxelBlockY } from '../src/viewer/voxels.js';

const catalog = loadBundledCatalog().catalog!;

const paint = (s: uc.Session, x1: number, z1: number, x2: number, z2: number, type: string, floor = 0) => {
  const r = uc.paintRect(s, catalog, { x1, z1, x2, z2 }, type, floor);
  if (r.roomId === undefined) throw new Error('kein Raum');
  return r.session;
};

/** Erdgeschoss: Taverne + Lager; Obergeschoss: Bibliothek + Alchemie (über dem Lager). */
function twoFloors(seed = 7): uc.Session {
  let s = uc.createSession(seed, 'Haus');
  s = paint(s, 0, 0, 11, 7, 'tavern');
  s = paint(s, 0, 8, 18, 12, 'storage');
  s = uc.addFloor(s, catalog).session;
  s = paint(s, 0, 0, 11, 7, 'library', 1);
  s = paint(s, 0, 8, 10, 12, 'alchemy', 1);
  return s;
}

const roomOf = (s: uc.Session, type: string): Room => s.project.state.rooms.find((r) => r.roomTypeId === type)!;
const placementIds = (s: uc.Session, roomId: string) => s.project.state.placements.filter((p) => p.roomId === roomId).map((p) => p.id);
const STAIRS: uc.StairSpec = { floor: 0, origin: [3, 10], facing: 'east', type: 'straight' };

/** Harte Garantien der Einrichtung: alle Möbelzellen im Innenraum ohne Treppenzellen, keine Kollisionen. */
function assertFurnishingSound(s: uc.Session): void {
  const shell = uc.shellOf(s.project, uc.shellStyle(s));
  const seen = new Set<string>();
  for (const v of uc.placedViews(s.project.state, catalog)) {
    const g = shell.rooms.get(v.placement.roomId)!;
    for (const c of v.placed.cells) {
      expect(g.interior.has(c.pos[0], c.pos[2]), `${v.def.id} außerhalb des Innenraums`).toBe(true);
      expect(g.blocked?.has(c.pos[0], c.pos[2]) ?? false, `${v.def.id} auf der Treppe`).toBe(false);
      expect(seen.has(key3(c.pos)), `Kollision bei ${key3(c.pos)}`).toBe(false);
      seen.add(key3(c.pos));
    }
  }
}

describe('Etagen', () => {
  it('oben und Keller hinzufügen, wechseln, entfernen – je ein Undo-Schritt', () => {
    const s0 = paint(uc.createSession(1), 0, 0, 8, 6, 'bedroom');
    const up = uc.addFloor(s0, catalog);
    expect(up.floorIndex).toBe(1);
    expect(up.session.project.state.floors.map((f) => [f.index, f.y0, f.height])).toEqual([[0, 0, 3], [1, 4, 3]]);
    const cellar = uc.addFloor(up.session, catalog, { below: true, height: 4 });
    expect(cellar.floorIndex).toBe(-1);
    expect(uc.floorOf(cellar.session.project.state, -1)).toEqual({ index: -1, y0: -5, height: 4 });
    expect(floorItems(cellar.session.project.state, -1).map((f) => [f.label, f.active])).toEqual([['1. OG', false], ['EG', false], ['1. UG', true]]);
    expect(uc.undo(cellar.session).project.state.floors).toHaveLength(2);

    // Räume oben, dann die Etage entfernen: Räume und Möbel verschwinden mit
    const withRoom = paint(cellar.session, 0, 0, 8, 6, 'library', 1);
    const removed = uc.removeFloor(withRoom, catalog, 1);
    expect(removed.project.state.floors.map((f) => f.index)).toEqual([-1, 0]);
    expect(removed.project.state.rooms.every((r) => r.floorIndex !== 1)).toBe(true);
    expect(uc.undo(removed).project.state.rooms.some((r) => r.floorIndex === 1)).toBe(true);
    expect(() => uc.removeFloor(withRoom, catalog, 0)).toThrow(DomainError); // nur oberste/unterste
    expect(() => uc.removeFloor(s0, catalog, 0)).toThrow(DomainError); // nie die letzte
    expect(() => uc.addFloor(s0, catalog, { height: 1 })).toThrow(DomainError);
    expect(uc.floorLabel(2)).toBe('2. OG');
    // Geister-Overlay: oben die Etage darunter, im Keller die darüber, sonst keins
    const st = cellar.session.project.state;
    expect([ghostFloor(st, 1), ghostFloor(st, 0), ghostFloor(st, -1), ghostFloor(s0.project.state, 0)]).toEqual([0, -1, 0, undefined]);
  });

  it('Wandhöhe ändern: Etagen darüber rutschen mit, betroffene Räume neu eingerichtet, gesperrte Möbel bleiben', () => {
    let s = twoFloors();
    const tavern = roomOf(s, 'tavern');
    const library = roomOf(s, 'library');
    const locked = s.project.state.placements.find((p) => p.roomId === library.id)!;
    s = uc.toggleLock(s, catalog, locked.id);
    const before = s;
    const libShellBefore = uc.shellOf(before.project).rooms.get(library.id)!;
    s = uc.setFloorHeight(s, catalog, 0, 5);
    expect(s.project.history.some((e) => e.type === 'FloorHeightChanged')).toBe(true);
    expect(s.project.state.floors.map((f) => [f.index, f.y0, f.height])).toEqual([[0, 0, 5], [1, 6, 3]]);
    const shell = uc.shellOf(s.project);
    expect(shell.rooms.get(tavern.id)!.height).toBe(5);
    expect(shell.rooms.get(library.id)!.baseY).toBe(libShellBefore.baseY + 2);
    // Taverne neu eingerichtet (neue IDs), gesperrtes Möbel oben 2 Blöcke höher
    expect(placementIds(s, tavern.id)).not.toEqual(placementIds(before, tavern.id));
    const moved = s.project.state.placements.find((p) => p.id === locked.id)!;
    expect(moved.pose.pos[1]).toBe(locked.pose.pos[1] + 2);
    expect(s.quality?.get(tavern.id)).toBeDefined();
    assertFurnishingSound(s);
    // höhere Decke → Deckenlampen dürfen tiefer/anders hängen: Kopffreiheit bleibt (Möbel innerhalb der Höhe)
    for (const v of uc.placedViews(s.project.state, catalog, tavern.id)) for (const c of v.placed.cells) expect(c.pos[1]).toBeLessThanOrEqual(5);
    // Undo stellt Höhe, Möbel und Qualität wieder her
    const back = uc.undo(s);
    expect(back.project.state).toEqual(before.project.state);
    expect(back.quality).toBe(before.quality);
    expect(uc.setFloorHeight(before, catalog, 0, 3)).toBe(before); // gleiche Höhe: keine Aktion
    expect(() => uc.setFloorHeight(before, catalog, 0, 17)).toThrow(DomainError);
    expect(() => uc.setFloorHeight(before, catalog, 0, 1)).toThrow(DomainError);
  });

  it('Wandhöhe: Treppen, die nicht mehr passen, entfernt dieselbe Aktion (Wendel höchstens 7 Stufen)', () => {
    let s = twoFloors();
    // Wendel 3×3 im Lager, Mitte rechts von der ersten Stufe
    s = uc.placeStairs(s, catalog, { floor: 0, origin: [5, 9], facing: 'east', type: 'spiral', turn: 'right' }).session;
    expect(s.project.state.links).toHaveLength(1);
    const fits = uc.setFloorHeight(s, catalog, 0, 6); // Abstand 7: passt noch
    expect(fits.project.state.links).toHaveLength(1);
    const tooHigh = uc.setFloorHeight(s, catalog, 0, 7);
    expect(tooHigh.project.state.links).toHaveLength(0);
    expect(uc.removedStairs(s.project.state, tooHigh.project.state).map((l) => l.type)).toEqual(['spiral']);
    for (const l of fits.project.state.links) expect(typeof checkLink(fits.project.state, l)).not.toBe('string');
    expect(uc.undo(tooHigh).project.state.links).toHaveLength(1);
  });
});

describe('Treppen-Werkzeug', () => {
  it('Treppe setzen: beide Räume neu eingerichtet, Treppenzellen bleiben frei, 2D-Treffer unten und oben', () => {
    const s0 = twoFloors();
    const pv = stairsPreview(s0.project.state, catalog, STAIRS);
    expect(pv.valid).toBe(true);
    expect(pv.lower).toContainEqual([2, 10]); // Antritt
    expect(pv.upper).toContainEqual([7, 10]); // Austritt
    const { session: s, linkId } = uc.placeStairs(s0, catalog, STAIRS);
    expect(linkId).toBe(s.project.state.links[0]!.id);
    const storage = roomOf(s, 'storage');
    const alchemy = roomOf(s, 'alchemy');
    expect(placementIds(s, storage.id)).not.toEqual(placementIds(s0, storage.id));
    expect(placementIds(s, alchemy.id)).not.toEqual(placementIds(s0, alchemy.id));
    const g = uc.shellOf(s.project).rooms.get(storage.id)!;
    expect(g.blocked?.size ?? 0).toBeGreaterThan(0);
    expect(g.stairs?.map((a) => a.end)).toEqual(['bottom']);
    assertFurnishingSound(s);
    expect(uc.shellOf(s.project).cells.some((c) => c.kind === 'stairs')).toBe(true);
    expect(uc.shellOf(s.project).cells.some((c) => c.kind === 'railing')).toBe(true);
    // Treffer im Grundriss: Stufe unten, Öffnung oben; Zugang gehört zum Raum
    expect(stairsAt(s.project.state, 0, [4, 10])?.id).toBe(linkId);
    expect(stairsAt(s.project.state, 1, [5, 10])?.id).toBe(linkId);
    expect(stairsAt(s.project.state, 0, [2, 10])).toBeUndefined();
    // Auswahl + 3D-Rahmen von der unteren Stufe bis in die obere Bodenplatte
    expect(validSelection({ linkId }, s.project.state)).toEqual({ linkId });
    expect(selectionBox({ linkId }, s.project.state, [])).toEqual({ min: [3, 1, 10], max: [6, 4, 10] });
    // Undo nimmt Treppe + Einrichtung zurück
    expect(uc.undo(s).project.state).toEqual(s0.project.state);
    expect(validSelection({ linkId }, uc.undo(s).project.state)).toEqual({});
  });

  it('ungültige Stelle: rot mit Grund aus der Domäne; ohne Etage darüber; Überschneidung', () => {
    const s0 = twoFloors();
    const wall = stairsPreview(s0.project.state, catalog, { ...STAIRS, origin: [1, 10] }); // Antritt in der Wand
    expect(wall.valid).toBe(false);
    expect(wall.reason).toMatch(/Wand oder außerhalb/);
    expect(() => uc.placeStairs(s0, catalog, { ...STAIRS, origin: [1, 10] })).toThrow(DomainError);
    const noUpper = stairsPreview(s0.project.state, catalog, { ...STAIRS, floor: 1 });
    expect(noUpper.valid).toBe(false);
    expect(noUpper.reason).toMatch(/Keine Etage über 1\. OG/);
    const s = uc.placeStairs(s0, catalog, STAIRS).session;
    const overlap = stairsPreview(s.project.state, catalog, { ...STAIRS, origin: [4, 10] });
    expect(overlap.valid).toBe(false);
    expect(overlap.reason).toMatch(/überschneidet sich/);
  });

  it('gesperrte Möbel blockieren die Treppe (statt still entfernt zu werden)', () => {
    // Suche: Seed, Möbel im Lager und eine sonst gültige gerade Treppe, deren reservierte Zellen das Möbel treffen
    let found: { s: uc.Session; spec: uc.StairSpec; placementId: string } | undefined;
    for (let seed = 7; seed < 15 && found === undefined; seed++) {
      const s = twoFloors(seed);
      const storage = roomOf(s, 'storage');
      for (const v of uc.placedViews(s.project.state, catalog, storage.id)) {
        if (found !== undefined || v.placement.parentId !== undefined) continue;
        const cells = v.placed.cells.map((c): Cell => [c.pos[0], c.pos[2]]);
        for (const facing of HORIZONTAL) {
          for (let x = 0; x <= 18 && found === undefined; x++) {
            for (let z = 8; z <= 12 && found === undefined; z++) {
              const spec: uc.StairSpec = { floor: 0, origin: [x, z], facing, type: 'straight' };
              const res = checkLink(s.project.state, uc.specLink(s.project.state, spec));
              if (typeof res !== 'string' && res.lower.id === storage.id && cells.some(([cx, cz]) => res.lowerCells.has(cx, cz))) found = { s, spec, placementId: v.placement.id };
            }
          }
        }
      }
    }
    expect(found, 'kein Möbel im Treppenbereich gefunden').toBeDefined();
    const { spec, placementId } = found!;
    // ungesperrt: die Treppe ist erlaubt (automatische Möbel richtet die App neu ein)
    expect(stairsPreview(found!.s.project.state, catalog, spec).valid).toBe(true);
    const s = uc.toggleLock(found!.s, catalog, placementId);
    const pv = stairsPreview(s.project.state, catalog, spec);
    expect(pv.valid).toBe(false);
    expect(pv.reason).toMatch(/gesperrte/);
    expect(() => uc.placeStairs(s, catalog, spec)).toThrow(/gesperrte/);
  });

  it('entfernen, Art/Richtung ändern (neue ID, ein Undo-Schritt), Drehen R', () => {
    const s0 = twoFloors();
    const placed = uc.placeStairs(s0, catalog, STAIRS);
    // Das Lager ist nur 3 Zellen tief: eine L-Treppe passt nicht (Grund aus der Domäne), eine Leiter schon
    expect(() => uc.changeStairs(placed.session, catalog, placed.linkId!, { type: 'l', turn: 'left' })).toThrow(/Wand oder außerhalb/);
    const l = uc.changeStairs(placed.session, catalog, placed.linkId!, { type: 'ladder' });
    const link = l.session.project.state.links[0]!;
    expect(link.id).toBe(l.linkId);
    expect(link.id).not.toBe(placed.linkId);
    expect([link.type, link.turn]).toEqual(['ladder', undefined]);
    expect(l.session.past).toHaveLength(placed.session.past.length + 1);
    expect(uc.undo(l.session).project.state.links[0]!.type).toBe('straight');
    // passt nicht → Fehler, alte Treppe bleibt (Aktion verworfen)
    expect(() => uc.changeStairs(placed.session, catalog, placed.linkId!, { facing: 'north' })).toThrow(DomainError);
    const gone = uc.removeStairs(placed.session, catalog, placed.linkId!);
    expect(gone.project.state.links).toHaveLength(0);
    expect(uc.shellOf(gone.project).rooms.get(roomOf(gone, 'storage').id)!.blocked?.size ?? 0).toBe(0);
    expect(rotateFacing('north')).toBe('east');
    expect(rotateFacing('west')).toBe('north');
    expect(DEFAULT_STAIR_TOOL.type).toBe('straight');
    expect(linkLayout(placed.session.project.state, placed.session.project.state.links[0]!)?.footprint).toHaveLength(4);
  });

  it('alle Treppenarten (gerade, L, U, Wendel, Leiter) lassen sich in einer Halle setzen', () => {
    let s = uc.createSession(3);
    s = paint(s, 0, 0, 20, 14, 'storage');
    s = uc.addFloor(s, catalog).session;
    s = paint(s, 0, 0, 20, 14, 'library', 1);
    const specs: uc.StairSpec[] = [
      { floor: 0, origin: [3, 3], facing: 'east', type: 'straight' },
      { floor: 0, origin: [3, 7], facing: 'east', type: 'l', turn: 'right' },
      { floor: 0, origin: [12, 3], facing: 'east', type: 'u', turn: 'right' },
      { floor: 0, origin: [15, 9], facing: 'east', type: 'spiral', turn: 'right' },
      { floor: 0, origin: [9, 12], facing: 'south', type: 'ladder' },
    ];
    for (const spec of specs) {
      const pv = stairsPreview(s.project.state, catalog, spec);
      expect(pv.valid, `${spec.type}: ${pv.reason ?? ''}`).toBe(true);
      s = uc.placeStairs(s, catalog, spec).session;
    }
    expect(s.project.state.links.map((l) => l.type)).toEqual(['straight', 'l', 'u', 'spiral', 'ladder']);
    assertFurnishingSound(s);
  });
});

describe('Dach und Wand', () => {
  it('Dachform Flach/Walm/Sattel und Überstand: eigener Undo-Schritt, Einrichtung bleibt bei gleicher Geometrie', () => {
    const s0 = uc.setShellStyle(paint(paint(uc.createSession(5), 0, 0, 9, 7, 'kitchen'), 10, 0, 17, 7, 'bedroom'), { roof: 'hip' }, catalog);
    const gable = uc.setShellStyle(s0, { roof: 'gable' }, catalog);
    expect(gable.roof).toBe('gable');
    expect(gable.project).toBe(s0.project); // Geometrie gleich → keine neue Einrichtung (auch mit Giebelfenstern)
    expect(gable.past).toHaveLength(s0.past.length + 1);
    const roofCells = (s: uc.Session) => uc.shellOf(s.project, uc.shellStyle(s)).cells.filter((c) => c.kind === 'roof');
    expect(roofCells(gable).length).toBeGreaterThan(0);
    expect(roofCells(gable).map((c) => key3(c.pos)).sort()).not.toEqual(roofCells(s0).map((c) => key3(c.pos)).sort());
    const extent = (s: uc.Session) => Math.min(...roofCells(s).map((c) => c.pos[0]));
    const wide = uc.setShellStyle(gable, { overhang: 3 }, catalog);
    expect(extent(wide)).toBeLessThan(extent(gable));
    expect(uc.undo(wide).overhang).toBe(uc.DEFAULT_OVERHANG);
    expect(uc.undo(uc.undo(wide)).roof).toBe('hip');
    expect(uc.undo(uc.undo(uc.undo(wide))).roof).toBe(uc.DEFAULT_ROOF);
    expect(uc.setShellStyle(wide, { overhang: 3 }, catalog)).toBe(wide);
    expect(() => uc.setShellStyle(s0, { overhang: 4 }, catalog)).toThrow(DomainError);
    expect(() => uc.setShellStyle(s0, { roof: 'dome' as never }, catalog)).toThrow(DomainError);
    expect(uc.ROOF_OPTIONS.map((r) => r.id)).toEqual(['flat', 'hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox']);
  });

  it('Fenster aus / Abstand: Hülle ändert sich, betroffene Räume neu eingerichtet, Undo stellt alles her', () => {
    const s0 = paint(paint(uc.createSession(9), 0, 0, 13, 9, 'library'), 14, 0, 27, 9, 'tavern');
    const windows = (s: uc.Session) => uc.shellOf(s.project, uc.shellStyle(s)).cells.filter((c) => c.kind === 'window').length;
    expect(windows(s0)).toBeGreaterThan(0);
    const off = uc.setShellStyle(s0, { windows: { enabled: false, spacing: 4 } }, catalog);
    expect(windows(off)).toBe(0); // auch keine Giebelfenster
    for (const g of uc.shellOf(off.project, uc.shellStyle(off)).rooms.values()) expect(g.windows).toEqual([]);
    const lib = roomOf(off, 'library');
    expect(placementIds(off, lib.id)).not.toEqual(placementIds(s0, lib.id));
    assertFurnishingSound(off);
    const dense = uc.setShellStyle(s0, { windows: { enabled: true, spacing: 2 } }, catalog);
    const sparse = uc.setShellStyle(s0, { windows: { enabled: true, spacing: 8 } }, catalog);
    expect(windows(dense)).toBeGreaterThan(windows(sparse));
    const back = uc.undo(off);
    expect(back.windows).toEqual(uc.DEFAULT_WINDOWS);
    expect(back.project.state).toEqual(s0.project.state);
    expect(() => uc.setShellStyle(s0, { windows: { enabled: true, spacing: 1 } }, catalog)).toThrow(DomainError);
  });
});

describe('Raumtypen und Einrichtung', () => {
  it('alle Raumtypen des Katalogs (inkl. Taverne, Bibliothek, Alchemie, Farm, Stall, Werkstatt) richten sich ein, mit Qualitätswert', () => {
    const ids = catalog.roomTypeIds();
    for (const t of ['tavern', 'library', 'alchemy', 'farm_room', 'stable', 'workshop_redstone']) expect(ids).toContain(t);
    for (const id of ids) {
      const s = paint(uc.createSession(11), 0, 0, 11, 9, id);
      const room = s.project.state.rooms[0]!;
      expect(placementIds(s, room.id).length, id).toBeGreaterThan(0);
      const q = s.quality?.get(room.id);
      expect(q, id).toBeDefined();
      expect(q!.score).toBeGreaterThanOrEqual(0);
      expect(q!.score).toBeLessThanOrEqual(1);
      expect(q!.parts.length).toBeGreaterThan(0);
      assertFurnishingSound(s);
    }
  });

  it('Dichte: 0 = nur Pflicht, 2 = mehr Möbel; bleibt beim Neu würfeln; Undo; ungültig abgelehnt', () => {
    const s0 = paint(uc.createSession(4), 0, 0, 14, 11, 'tavern');
    const id = s0.project.state.rooms[0]!.id;
    const count = (s: uc.Session) => placementIds(s, id).length;
    const sparse = uc.setRoomDensity(s0, catalog, id, 0);
    const full = uc.setRoomDensity(s0, catalog, id, 2);
    expect(uc.roomDensity(sparse, id)).toBe(0);
    expect(count(sparse)).toBeLessThan(count(full));
    expect(count(sparse)).toBeGreaterThan(0); // Pflichtobjekte bleiben
    const rerolled = uc.rerollRoom(sparse, catalog, id);
    expect(uc.roomDensity(rerolled, id)).toBe(0);
    expect(count(rerolled)).toBeLessThan(count(uc.rerollRoom(full, catalog, id)));
    expect(uc.roomDensity(uc.undo(sparse), id)).toBe(1);
    expect(uc.undo(sparse).project.state).toEqual(s0.project.state);
    expect(uc.setRoomDensity(sparse, catalog, id, 0)).toBe(sparse);
    expect(uc.setRoomDensity(s0, catalog, id, 1)).toBe(s0); // Standard: nichts zu tun
    expect(uc.setRoomDensity(sparse, catalog, id, 1).density?.has(id)).toBe(false);
    expect(() => uc.setRoomDensity(s0, catalog, id, 3)).toThrow(DomainError);
    // Raum gelöscht → Dichte-Eintrag weg
    expect(uc.deleteRoom(sparse, catalog, id).density?.size).toBe(0);
    expect(densityLabel(1)).toBe('Standard');
    expect(densityLabel(0)).toBe('nur Pflicht');
    expect(densityLabel(1.5)).toBe('150 %');
  });

  it('Möbel entfernen (mit Kindern), kein Auffüllen; Qualitätswert bekommt einen Vermerk; Undo', () => {
    const s0 = paint(uc.createSession(6), 0, 0, 11, 9, 'tavern');
    const id = s0.project.state.rooms[0]!.id;
    const parent = s0.project.state.placements.find((p) => s0.project.state.placements.some((c) => c.parentId === p.id)) ?? s0.project.state.placements[0]!;
    const kids = s0.project.state.placements.filter((c) => c.parentId === parent.id).map((c) => c.id);
    const s = uc.removePlacement(s0, catalog, parent.id);
    const left = new Set(placementIds(s, id));
    expect(left.has(parent.id)).toBe(false);
    for (const k of kids) expect(left.has(k)).toBe(false);
    expect(left.size).toBe(placementIds(s0, id).length - 1 - kids.length); // nicht neu eingerichtet
    expect(s.quality?.get(id)?.notes.at(-1)).toMatch(/Von Hand entfernt/);
    expect(uc.undo(s).project.state).toEqual(s0.project.state);
    expect(() => uc.removePlacement(s0, catalog, 'p999')).toThrow(DomainError);
  });

  it('Qualität: Prozent, Stufe, „warum so?“ nennt den schwächsten Teilwert', () => {
    const q = qualitySummary({
      score: 0.62,
      parts: [
        { id: 'required', label: 'Pflichtobjekte', value: 1, detail: '3 von 3' },
        { id: 'space', label: 'Laufraum', value: 0.4, detail: '16 % der Bodenfläche frei' },
      ],
      notes: ['Signatur in Kompaktform'],
    });
    expect([q.percent, q.grade, q.tone]).toEqual([62, 'mittel', 'ok']);
    expect(q.lines.map((l) => l.id)).toEqual(['space', 'required']);
    expect(q.why).toMatch(/Laufraum 40 %.*16 % der Bodenfläche frei/);
    expect(qualitySummary({ score: 0.95, parts: [{ id: 'required', label: 'Pflichtobjekte', value: 1 }], notes: [] }).why).toBe('Alle Teilwerte erfüllt.');
    expect(qualitySummary({ score: 0.3, parts: [], notes: [] }).tone).toBe('weak');
    // Review 3: Keller ohne Tür/Treppe darf nicht als „sehr gut“ stehen bleiben
    const ohneZugang = qualitySummary({ score: 0.86, parts: [{ id: 'required', label: 'Pflichtobjekte', value: 1 }], notes: [] }, { unreachable: true });
    expect(ohneZugang.percent).toBe(86); // der Wert bewertet weiter die Einrichtung
    expect(ohneZugang.grade).toBe('sehr gut, kein Zugang');
    expect(ohneZugang.tone).toBe('weak');
    expect(ohneZugang.alerts[0]).toContain('Kein Zugang');
    expect(qualitySummary({ score: 0.86, parts: [], notes: [] }, { unreachable: false }).grade).toBe('sehr gut');
  });
});

describe('Speichern/Laden v2', () => {
  it('Etagen, Treppe, Wandhöhe, Umbenennen, Dach/Fenster/Dichte: Round-Trip', () => {
    let s = twoFloors();
    s = uc.placeStairs(s, catalog, STAIRS).session;
    s = uc.setFloorHeight(s, catalog, 1, 4);
    s = uc.renameProject(s, 'Turmhaus');
    s = uc.setShellStyle(s, { roof: 'gable', overhang: 2, windows: { enabled: true, spacing: 6 } }, catalog);
    const tavern = roomOf(s, 'tavern').id;
    s = uc.setRoomDensity(s, catalog, tavern, 1.5);
    const text = serializeProject(s, { savedAt: new Date(0) });
    const data = JSON.parse(text) as Record<string, unknown>;
    expect(data['version']).toBe(PROJECT_FILE_VERSION);
    expect(data['density']).toEqual({ [tavern]: 1.5 });
    const types = new Set((data['history'] as Array<{ type: string }>).map((e) => e.type));
    for (const t of ['FloorAdded', 'StairsPlaced', 'FloorHeightChanged', 'ProjectRenamed']) expect(types.has(t), t).toBe(true);
    const r = parseProjectFile(text, { catalog });
    if (!r.ok) throw new Error(r.error);
    expect(r.name).toBe('Turmhaus');
    expect(r.session.project.history).toEqual(s.project.history);
    expect(r.session.project.state).toEqual(s.project.state);
    expect(uc.settingsOf(r.session)).toEqual(uc.settingsOf(s));
    const a = uc.shellOf(s.project, uc.shellStyle(s));
    const b = uc.shellOf(r.session.project, uc.shellStyle(r.session));
    expect(b.cells.length).toBe(a.cells.length);
    for (const [id, g] of a.rooms) expect(uc.geometryKey(b.rooms.get(id)!)).toBe(uc.geometryKey(g));
  });

  it('alte v1-Dateien laden weiter (Standard-Einstellungen); unsinnige Einstellungen fallen auf Standard', () => {
    const s = paint(uc.createSession(2, 'Alt'), 0, 0, 8, 6, 'kitchen');
    const v1 = JSON.stringify({ format: 'basen-projekt', version: 1, savedAt: '2026-09-01T00:00:00.000Z', name: 'Alt', roof: 'flat', history: s.project.history });
    const r = parseProjectFile(v1, { catalog });
    if (!r.ok) throw new Error(r.error);
    expect(r.session.roof).toBe('flat');
    // Dach-Details und Außenprofil kannte die Datei nicht: schlicht wie damals, nicht die neue Voreinstellung
    expect(uc.shellStyle(r.session)).toEqual({
      roof: 'flat', overhang: uc.DEFAULT_OVERHANG, windows: uc.DEFAULT_WINDOWS, roofDetail: uc.PLAIN_ROOF_DETAIL, dormers: uc.PLAIN_DORMERS, facade: uc.PLAIN_FACADE,
      exterior: uc.PLAIN_EXTERIOR,
    });
    const odd = JSON.stringify({ ...JSON.parse(v1), version: 2, overhang: 9, windows: { enabled: 'ja', spacing: 99 }, density: { r1: 7, r99: 2, r2: 'x' } });
    const r2 = parseProjectFile(odd, { catalog });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.session.overhang).toBe(uc.DEFAULT_OVERHANG);
    expect(r2.session.windows).toEqual(uc.DEFAULT_WINDOWS);
    expect(r2.session.density?.size ?? 0).toBe(0); // r1: außerhalb, r99: kein Raum
  });
});

describe('Etagen-Ansicht, Gesten, Kürzel', () => {
  it('„bis aktive“ schneidet unter der Etage darüber, „nur aktive“ auch darunter; oberste Etage mit Dach', () => {
    const s = twoFloors();
    const st = s.project.state;
    expect(floorRange(st, 0, 'all')).toEqual({});
    expect(floorRange(st, 0, 'upTo')).toEqual({ maxY: 3 });
    expect(floorRange(st, 0, 'only')).toEqual({ minY: 0, maxY: 3 });
    expect(floorRange(st, 1, 'upTo')).toEqual({ maxY: undefined });
    expect(floorRange(st, 1, 'only')).toEqual({ minY: 4, maxY: undefined });
    expect(combineRange(5, { maxY: 3 })).toEqual({ minY: undefined, maxY: 3 });
    expect(combineRange(2, { maxY: 3 })).toEqual({ minY: undefined, maxY: 2 });
    expect(combineRange(undefined, { minY: 4 })).toEqual({ minY: 4, maxY: undefined });
    const voxels = buildPreviewVoxels(uc.shellOf(s.project), uc.placedViews(st, catalog));
    const upper = cutVoxels(voxels, undefined, 4);
    expect(upper.length).toBeGreaterThan(0);
    expect(upper.every((v) => voxelBlockY(v) >= 4)).toBe(true);
    expect(cutVoxels(voxels, 3).every((v) => voxelBlockY(v) <= 3)).toBe(true);
    expect(cutVoxels(voxels, undefined)).toBe(voxels);
  });

  it('Treppen-Werkzeug: Klick setzt am Mauszeiger, rechts entfernt; R dreht, F spiegelt nur im Werkzeug; T wählt es', () => {
    expect(interpretGesture('stairs', 'left', [1, 1], [3, 4])).toEqual({ kind: 'placeStairs', cell: [3, 4] });
    expect(interpretGesture('stairs', 'right', [1, 1], [1, 1])).toEqual({ kind: 'removeStairs', cell: [1, 1] });
    const key = (k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
    expect(commandForKey(key('t'))).toBe('tool.stairs');
    expect(commandForKey(key('r'), { placing: true })).toBe('stairs.rotate');
    expect(commandForKey(key('f'), { placing: true })).toBe('stairs.mirror');
    expect(commandForKey(key('r'))).toBe('room.reroll');
    expect(commandForKey(key('f'))).toBe('camera.fit');
    expect(commandForKey(key('R', { shiftKey: true }), { placing: true })).toBe('room.rerollAll');
    expect(commandForKey(key('z', { ctrlKey: true }), { placing: true })).toBe('undo');
    expect(new Set(PLACING_SHORTCUTS.map((s) => s.command)).size).toBe(PLACING_SHORTCUTS.length);
  });
});
