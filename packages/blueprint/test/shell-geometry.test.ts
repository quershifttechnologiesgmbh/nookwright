/**
 * Vertragstest: `RoomShellInfo` (Bauplan) ist strukturgleich mit `RoomGeometry` (Einrichtung).
 * Nur ein TYP-Import aus @mcda/furnishing – keine Laufzeit-Abhängigkeit (der Import wird beim Transpilieren entfernt).
 * Bricht einer der beiden Typen, schlägt `tsc` fehl.
 */
import { describe, expect, it } from 'vitest';
import { CellSet } from '@mcda/core';
import type { DoorInfo, RoomGeometry, WindowInfo } from '@mcda/furnishing';
import { Project, TARGET_VERSIONS, deriveShell, type RoomShellInfo, type ShellDoor, type ShellWindow } from '../src/index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>(): T | undefined => undefined;

// Beide Richtungen: gleiche Felder, gleiche Typen (RoomShellInfo hat zusätzlich floorIndex und die Treppenzugänge
// `stairs`, die der Anwendungsdienst für die Einrichtung in freizuhaltende Zugänge übersetzt).
assertType<Equal<Omit<RoomShellInfo, 'floorIndex' | 'stairs'>, RoomGeometry>>();
assertType<Equal<ShellDoor, DoorInfo>>();
assertType<Equal<ShellWindow, WindowInfo>>();

describe('RoomShellInfo ↔ RoomGeometry', () => {
  it('eine abgeleitete Raumsicht ist ohne Umbau als RoomGeometry verwendbar', () => {
    const p = Project.create({ id: 'p', name: 'h', seed: 1, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.paintRoom(0, CellSet.rect(0, 0, 6, 4), 'bedroom');
    const info: RoomShellInfo = deriveShell(p.state, { roof: 'flat' }).rooms.get('r1')!;
    const g: RoomGeometry = info;
    const back: Omit<RoomShellInfo, 'floorIndex' | 'stairs'> = g;
    expect(back.interior.size).toBe(5 * 3);
    expect(g.doors.filter((d) => d.isMain)).toHaveLength(1);
  });
});
