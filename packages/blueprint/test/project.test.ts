import { describe, expect, it } from 'vitest';
import { CellSet, pose } from '@mcda/core';
import { DomainError, Project, TARGET_VERSIONS, type ProjectState } from '../src/index.js';

const newProject = () =>
  Project.create({ id: 'proj1', name: 'Testhaus', seed: 1234, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });

/** Invarianten, die nach JEDEM Befehl gelten müssen. */
function assertInvariants(s: ProjectState): void {
  const seen = new Map<string, string>();
  for (const r of s.rooms) {
    expect(r.cells.isEmpty, `Raum ${r.id} leer`).toBe(false);
    expect(r.cells.isConnected(), `Raum ${r.id} zerfallen`).toBe(true);
    for (const [x, z] of r.cells) {
      const k = `${r.floorIndex}:${x},${z}`;
      expect(seen.get(k), `Zelle ${k} doppelt belegt`).toBeUndefined();
      seen.set(k, r.id);
    }
  }
  const ids = new Set(s.placements.map((p) => p.id));
  for (const p of s.placements) {
    expect(s.rooms.some((r) => r.id === p.roomId), `Platzierung ${p.id} ohne Raum`).toBe(true);
    if (p.parentId !== undefined) expect(ids.has(p.parentId), `Eltern von ${p.id} fehlen`).toBe(true);
  }
}

describe('Project – Räume malen', () => {
  it('malt einen Raum und vergibt deterministische IDs', () => {
    const p = newProject();
    const ev = p.paintRoom(0, CellSet.rect(0, 0, 5, 4), 'bedroom');
    expect(ev).toEqual([expect.objectContaining({ type: 'RoomPainted', roomId: 'r1', roomTypeId: 'bedroom' })]);
    expect(p.state.rooms).toHaveLength(1);
    assertInvariants(p.state);
  });

  it('Übermalen nimmt dem alten Raum die Zellen weg (keine Doppelbelegung)', () => {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 5, 4), 'bedroom');
    const ev = p.paintRoom(0, CellSet.rect(4, 0, 8, 4), 'kitchen');
    expect(ev.map((e) => e.type)).toEqual(['RoomCellsLost', 'RoomPainted']);
    expect(p.room('r1').cells.size).toBe(4 * 5);
    expect(p.room('r2').cells.size).toBe(5 * 5);
    assertInvariants(p.state);
  });

  it('ein Raum, der durch Übermalen zerfällt, wird geteilt', () => {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 9, 2), 'storage'); // 10×3
    const ev = p.paintRoom(0, CellSet.rect(4, 0, 5, 2), 'hallway'); // Mitte wegmalen
    expect(ev.map((e) => e.type)).toEqual(['RoomCellsLost', 'RoomSplit', 'RoomPainted']);
    const split = ev[1];
    if (split?.type !== 'RoomSplit') throw new Error('erwartet RoomSplit');
    expect(split.parts[0]?.roomId).toBe('r2');
    expect(ev[2]).toMatchObject({ roomId: 'r3' });
    expect(p.state.rooms.map((r) => [r.id, r.roomTypeId, r.cells.size])).toEqual([
      ['r1', 'storage', 12],
      ['r2', 'storage', 12],
      ['r3', 'hallway', 6],
    ]);
    assertInvariants(p.state);
  });

  it('komplett übermalter Raum wird entfernt, samt Platzierungen', () => {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 2, 2), 'bedroom');
    p.addPlacement('r1', 'seat/chair', pose([1, 1, 1]));
    const ev = p.paintRoom(0, CellSet.rect(-1, -1, 3, 3), 'kitchen');
    expect(ev[0]).toMatchObject({ type: 'RoomRemoved', roomId: 'r1' });
    expect(p.state.placements).toHaveLength(0);
    assertInvariants(p.state);
  });

  it('lehnt nicht zusammenhängende oder leere Zellen ab', () => {
    const p = newProject();
    expect(() => p.paintRoom(0, CellSet.of([[0, 0], [2, 0]]), 'x')).toThrow(DomainError);
    expect(() => p.paintRoom(0, CellSet.empty(), 'x')).toThrow(/mindestens eine Zelle/);
    expect(() => p.paintRoom(5, CellSet.rect(0, 0, 1, 1), 'x')).toThrow(/Etage/);
  });

  it('Radieren teilt ebenfalls und verschiebt Platzierungen mit ihrer Ankerzelle', () => {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 9, 0), 'hallway');
    p.addPlacement('r1', 'light/wall_torch', pose([8, 1, 0]));
    p.addPlacement('r1', 'seat/chair', pose([1, 1, 0]));
    p.eraseCells(0, CellSet.of([[4, 0]]));
    // größerer Teil (x 5–9) behält r1, der kleinere (x 0–3) wird ein neuer Raum
    const roomAt = (x: number) => p.state.rooms.find((r) => r.cells.has(x, 0))!.id;
    expect(roomAt(8)).toBe('r1');
    expect(roomAt(1)).not.toBe('r1');
    const byComponent = Object.fromEntries(p.state.placements.map((x) => [x.componentId, x.roomId]));
    expect(byComponent).toEqual({ 'light/wall_torch': 'r1', 'seat/chair': roomAt(1) });
    assertInvariants(p.state);
  });
});

describe('Project – Einrichtung, Sperren, Neu-Würfeln', () => {
  function furnished() {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 5, 4), 'bedroom');
    p.applyFurnishing('r1', [
      { key: 'bed', componentId: 'bed/single', pose: pose([0, 1, 0]), seed: 1 },
      { key: 'ns', componentId: 'storage/nightstand_barrel', pose: pose([1, 1, 0]), seed: 2, parentKey: 'bed', socketId: 'nightstand_l' },
      { key: 'lamp', componentId: 'light/hanging_lantern', pose: pose([3, 2, 2]), seed: 3 },
    ]);
    return p;
  }

  it('übernimmt Entwürfe mit Eltern-Kind-Beziehung', () => {
    const p = furnished();
    const [bed, ns] = p.state.placements;
    expect(ns?.parentId).toBe(bed?.id);
    expect(p.descendants(bed!.id)).toEqual([ns!.id]);
    assertInvariants(p.state);
  });

  it('erneutes Einrichten ersetzt nur automatische, ungesperrte Platzierungen', () => {
    const p = furnished();
    const lamp = p.state.placements.find((x) => x.componentId === 'light/hanging_lantern')!;
    p.lockPlacement(lamp.id);
    p.addPlacement('r1', 'seat/chair', pose([4, 1, 4]));
    p.rerollRoom('r1');
    p.applyFurnishing('r1', [{ key: 'chest', componentId: 'storage/chest', pose: pose([0, 1, 4]), seed: 9 }]);
    expect(p.state.placements.map((x) => x.componentId).sort()).toEqual(['light/hanging_lantern', 'seat/chair', 'storage/chest']);
    assertInvariants(p.state);
  });

  it('Löschen einer Platzierung entfernt ihre Kinder', () => {
    const p = furnished();
    p.removePlacement(p.state.placements[0]!.id);
    expect(p.state.placements.map((x) => x.componentId)).toEqual(['light/hanging_lantern']);
  });

  it('Raumtyp ändern verwirft automatische Platzierungen, gesperrte bleiben', () => {
    const p = furnished();
    const bed = p.state.placements[0]!;
    p.lockPlacement(bed.id);
    p.assignRoomType('r1', 'storage');
    // Bett gesperrt → bleibt; Nachttisch ist Kind des Betts, aber selbst ungesperrt und automatisch → weg
    expect(p.state.placements.map((x) => x.componentId)).toEqual(['bed/single']);
    assertInvariants(p.state);
  });

  it('der Raum-Seed ändert sich nur durch Neu-Würfeln', () => {
    const p = furnished();
    const s1 = p.roomSeed('r1');
    p.addPlacement('r1', 'seat/chair', pose([4, 1, 4]));
    expect(p.roomSeed('r1')).toBe(s1);
    p.rerollRoom('r1');
    expect(p.roomSeed('r1')).not.toBe(s1);
  });

  it('manuelle Platzierung außerhalb des Raums wird abgelehnt', () => {
    const p = furnished();
    expect(() => p.addPlacement('r1', 'seat/chair', pose([50, 1, 50]))).toThrow(/nicht im Raum/);
  });
});

describe('Project – Historie und Undo', () => {
  it('Zustand ist aus der Historie reproduzierbar', () => {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 9, 2), 'storage');
    p.paintRoom(0, CellSet.rect(4, 0, 5, 2), 'hallway');
    p.addPlacement('r2', 'storage/chest', pose([7, 1, 1]));
    p.setTheme('nordic');
    const replayed = Project.fromHistory(p.history);
    expect(replayed.state).toEqual(p.state);
  });

  it('Undo nimmt den letzten Schritt zurück', () => {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 3, 3), 'bedroom');
    p.setTheme('nordic');
    const u = p.undo();
    expect(u.state.themeId).toBe('medieval');
    expect(u.state.rooms).toHaveLength(1);
    expect(() => u.undo(2)).toThrow(DomainError);
  });

  it('Befehle ohne Wirkung erzeugen keine Events', () => {
    const p = newProject();
    expect(p.setTheme('medieval')).toEqual([]);
    expect(p.setTargetVersion(TARGET_VERSIONS['1.21.11'])).toEqual([]);
    expect(p.setTargetVersion(TARGET_VERSIONS['26.3'])).toHaveLength(1);
  });
});

describe('Project – Einrichtung ergänzen (supplementFurnishing, Licht-Pass)', () => {
  function furnished() {
    const p = newProject();
    p.paintRoom(0, CellSet.rect(0, 0, 5, 4), 'bedroom');
    p.applyFurnishing('r1', [
      { key: 'bed', componentId: 'bed/single', pose: pose([1, 1, 1]), seed: 1 },
      { key: 'ns', componentId: 'storage/nightstand_barrel', pose: pose([2, 1, 1]), seed: 2, parentKey: 'bed', socketId: 'nightstand_l' },
    ]);
    return p;
  }

  it('ergänzt automatische Platzierungen, ohne bestehende zu ersetzen', () => {
    const p = furnished();
    const before = p.state.placements.map((x) => x.id);
    const ev = p.supplementFurnishing('r1', [{ key: 'torch', componentId: 'light/wall_torch', pose: pose([4, 2, 1], 1), seed: 7 }]);
    expect(ev).toEqual([expect.objectContaining({ type: 'FurnishingSupplemented', roomId: 'r1' })]);
    expect(p.state.placements.map((x) => x.id)).toEqual([...before, 'p4']);
    expect(p.state.placements.at(-1)).toMatchObject({ componentId: 'light/wall_torch', origin: 'auto', locked: false, roomId: 'r1', seed: 7 });
    assertInvariants(p.state);
  });

  it('Kinder dürfen an bestehenden Platzierungen hängen (Kerzen auf dem Nachttisch)', () => {
    const p = furnished();
    const ns = p.state.placements.find((x) => x.componentId === 'storage/nightstand_barrel')!;
    p.supplementFurnishing('r1', [
      { key: 'c', componentId: 'decor/candles', variantId: 'four', pose: pose([2, 2, 1]), seed: 1, parentKey: ns.id, socketId: 'top' },
      { key: 'd', componentId: 'decor/candles', variantId: 'one', pose: pose([3, 2, 1]), seed: 1, parentKey: 'c' },
    ]);
    const [c, d] = p.state.placements.slice(-2);
    expect(c?.parentId).toBe(ns.id);
    expect(d?.parentId).toBe(c?.id);
    expect(p.descendants(ns.id)).toEqual([c!.id, d!.id]);
    assertInvariants(p.state);
  });

  it('lehnt unbekannte Eltern, doppelte Schlüssel und Anker außerhalb des Raums ab – ohne Teilwirkung', () => {
    const p = furnished();
    const n = p.history.length;
    const draft = { key: 'a', componentId: 'light/wall_torch', pose: pose([4, 2, 1], 1), seed: 1 };
    expect(() => p.supplementFurnishing('r1', [{ ...draft, parentKey: 'p99' }])).toThrow(DomainError);
    expect(() => p.supplementFurnishing('r1', [draft, draft])).toThrow(/Doppelter Schlüssel/);
    expect(() => p.supplementFurnishing('r1', [{ ...draft, pose: pose([40, 2, 40]) }])).toThrow(/nicht im Raum/);
    expect(() => p.supplementFurnishing('r9', [draft])).toThrow(/Unbekannter Raum/);
    expect(p.history.length).toBe(n);
    expect(p.supplementFurnishing('r1', [])).toEqual([]);
  });

  it('Eltern aus einem anderen Raum sind nicht erlaubt', () => {
    const p = furnished();
    const painted = p.paintRoom(0, CellSet.rect(6, 0, 9, 4), 'storage').find((e) => e.type === 'RoomPainted');
    const other = painted?.type === 'RoomPainted' ? painted.roomId : '?';
    const ns = p.state.placements.find((x) => x.componentId === 'storage/nightstand_barrel')!;
    expect(() => p.supplementFurnishing(other, [{ key: 'c', componentId: 'decor/candles', variantId: 'one', pose: pose([7, 2, 1]), seed: 1, parentKey: ns.id }])).toThrow(/Eltern/);
  });

  it('Neu-Würfeln/Einrichten ersetzt Ergänzungen wie alles Automatische; gesperrte bleiben', () => {
    const p = furnished();
    p.supplementFurnishing('r1', [
      { key: 't1', componentId: 'light/wall_torch', pose: pose([4, 2, 1], 1), seed: 1 },
      { key: 't2', componentId: 'light/wall_torch', pose: pose([4, 2, 3], 1), seed: 2 },
    ]);
    const [t1] = p.state.placements.filter((x) => x.componentId === 'light/wall_torch');
    p.lockPlacement(t1!.id);
    p.rerollRoom('r1');
    p.applyFurnishing('r1', [{ key: 'chest', componentId: 'storage/chest', pose: pose([1, 1, 3]), seed: 9 }]);
    expect(p.state.placements.map((x) => x.componentId).sort()).toEqual(['light/wall_torch', 'storage/chest']);
    expect(p.state.placements.find((x) => x.componentId === 'light/wall_torch')?.id).toBe(t1!.id);
    assertInvariants(p.state);
  });

  it('Historie: Replay und Undo', () => {
    const p = furnished();
    p.supplementFurnishing('r1', [{ key: 't', componentId: 'light/wall_torch', pose: pose([4, 2, 1], 1), seed: 1 }]);
    expect(Project.fromHistory(p.history).state).toEqual(p.state);
    const u = p.undo();
    expect(u.state.placements.some((x) => x.componentId === 'light/wall_torch')).toBe(false);
    // Folge-IDs bleiben eindeutig
    const ev = p.addPlacement('r1', 'seat/chair', pose([3, 1, 3]));
    expect(ev[0]).toMatchObject({ type: 'PlacementAdded', placement: { id: 'p5' } });
  });
});
