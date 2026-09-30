/**
 * W12-C (plan/spikes/W12C_bauernhof_details.md, Review R6-4): Außengestaltung je Baukörper (`Volume.exterior`) in der
 * Hülle – Kantenrolle nur am eigenen Baukörper (Dachkante samt Ortgang-Überstand, Eckspalten), Scheunentor-Tür mittig im
 * Giebel weg vom Wohnhaus und keine Fenster im Torfeld. Ohne das Feld bleibt alles wie vorher.
 */
import { describe, expect, it } from 'vitest';
import { CellSet } from '@mcda/core';
import { deriveShell, type Shell, type ShellOptions, type VolumeProps } from '../src/index.js';
import { cleanVolume } from '../src/volumes.js';
import { addVolume, volumeProject } from './support/volumes.js';

const OPTIONS: ShellOptions = { roof: 'gable', roofDetail: { trim: true, gableWindows: false }, facade: { quoins: true, plinthProfile: true } };

/** Wohnhaus 11 × 9 (x 0–10) und Scheune 13 × 11 (x 15–27, z 0–10) mit 4 Abstand, Scheune höher (Tenne 5). */
function farm(exterior?: VolumeProps['exterior']): { shell: Shell; barnRooms: Set<string> } {
  const p = volumeProject();
  const barn = addVolume(p, { name: 'Scheune', roof: 'gambrel', floorHeights: { 0: 5 }, roofDetail: { trim: true, gableWindows: false }, ...(exterior !== undefined ? { exterior } : {}) });
  p.paintRoom(0, CellSet.rect(0, 0, 10, 8), 'kitchen');
  p.paintRoom(0, CellSet.rect(15, 0, 27, 10), 'stable', { volumeId: barn });
  const barnRooms = new Set(p.state.rooms.filter((r) => r.volumeId === barn).map((r) => r.id));
  return { shell: deriveShell(p.state, OPTIONS), barnRooms };
}

describe('W12-C: Außengestaltung je Baukörper in der Hülle', () => {
  it('Kantenrolle nur an der Scheune: Dachkante, Ortgang-Überstand und Eckspalten; das Wohnhaus behält roof_trim', () => {
    const { shell, barnRooms } = farm({ trim: 'trim_light', barn: true });
    const barnCell = (c: Shell['cells'][number]): boolean => c.roomId !== undefined && barnRooms.has(c.roomId);
    // Dachkante der Scheune: keine roof_trim-Zelle mehr, dafür trim_light
    expect(shell.cells.filter((c) => barnCell(c) && c.role === 'roof_trim')).toEqual([]);
    expect(shell.cells.filter((c) => barnCell(c) && c.kind === 'roof' && c.role === 'trim_light').length).toBeGreaterThan(0);
    // Ortgang-Überstand (x 14 bzw. 28, ohne Raum): hell
    const overhang = shell.cells.filter((c) => c.kind === 'roof' && (c.pos[0] === 28 || c.pos[0] === 14) && c.pos[2] >= -2 && c.pos[2] <= 12);
    expect(overhang.length).toBeGreaterThan(10);
    expect(overhang.every((c) => c.role === 'trim_light')).toBe(true);
    // Wohnhaus: Dachkante unverändert
    expect(shell.cells.some((c) => c.kind === 'roof' && c.role === 'roof_trim' && c.pos[0] <= 11)).toBe(true);
    expect(shell.cells.some((c) => c.role === 'trim_light' && c.pos[0] <= 11)).toBe(false);
    // Eckspalten der Scheune vom Sockel bis unter das Dach: Vollblock in der Kantenrolle
    for (const [x, z] of [[15, 0], [15, 10], [27, 0], [27, 10]] as const) {
      const col = shell.cells.filter((c) => c.pos[0] === x && c.pos[2] === z && c.exterior === true && (c.kind === 'pillar' || c.kind === 'wall'));
      expect(col.length, `Ecke ${x},${z}`).toBeGreaterThanOrEqual(5);
      expect(col.every((c) => c.role === 'trim_light' && c.shape === 'block'), `Ecke ${x},${z}`).toBe(true);
    }
  });

  it('Scheunentor: Außentür der Scheune mittig im Giebel weg vom Wohnhaus, daneben (± 2) keine Fenster', () => {
    const { shell } = farm({ barn: true });
    const doors = shell.cells.filter((c) => c.kind === 'door' && c.exterior === true && c.orient?.half === 'lower' && c.pos[0] >= 15);
    expect(doors.map((c) => [c.pos[0], c.pos[2], c.orient?.facing])).toEqual([[27, 5, 'east']]);
    const gate = shell.cells.filter((c) => c.kind === 'window' && c.pos[0] === 27 && Math.abs(c.pos[2] - 5) <= 2);
    expect(gate).toEqual([]);
  });

  it('ohne `exterior` bleibt die Hülle gleich (keine Kantenrolle, Tür wie bisher)', () => {
    const plain = farm().shell;
    expect(plain.cells.some((c) => c.role === 'trim_light')).toBe(false);
    // nur die Kantenrolle ändert Rollen: ohne Scheunentor sind die Zellen bis auf die Rolle identisch
    const trimOnly = farm({ trim: 'trim_light' }).shell;
    expect(trimOnly.cells.map((c) => c.pos.join(','))).toEqual(plain.cells.map((c) => c.pos.join(',')));
  });

  it('cleanVolume: Gruppen sortiert und ohne Doppel, leere Felder fallen weg', () => {
    expect(cleanVolume('v1', { exterior: { off: ['sills', 'flowerBoxes', 'sills'], barn: false } })).toEqual({ id: 'v1', exterior: { off: ['flowerBoxes', 'sills'] } });
    expect(cleanVolume('v1', { exterior: { trim: 'trim_light', barn: true } })).toEqual({ id: 'v1', exterior: { trim: 'trim_light', barn: true } });
  });

  it('W16-B: Dachrolle je Baukörper – Dachfläche der Scheune samt Traufüberstand in roof_barn, Kante bleibt trim_light, Wohnhaus unverändert', () => {
    const plain = farm({ trim: 'trim_light', barn: true }).shell;
    const { shell } = farm({ trim: 'trim_light', roof: 'roof_barn', barn: true });
    // gleiche Belegung, gleiche Formen: nur Rollen wechseln
    expect(shell.cells.map((c) => `${c.pos.join(',')}:${c.kind}:${c.shape}`)).toEqual(plain.cells.map((c) => `${c.pos.join(',')}:${c.kind}:${c.shape}`));
    const barnRoof = shell.cells.filter((c) => c.kind === 'roof' && c.pos[0] >= 13);
    expect(barnRoof.some((c) => c.role === 'roof_barn')).toBe(true);
    expect(barnRoof.some((c) => c.role === 'roof_main')).toBe(false);
    expect(barnRoof.filter((c) => c.role === 'trim_light').length).toBe(plain.cells.filter((c) => c.kind === 'roof' && c.pos[0] >= 13 && c.role === 'trim_light').length);
    // Wohnhaus (x ≤ 11): keine Zelle wechselt
    const house = (sh: Shell): string[] => sh.cells.filter((c) => c.pos[0] <= 11).map((c) => `${c.pos.join(',')}:${c.role}`);
    expect(house(shell)).toEqual(house(plain));
    expect(cleanVolume('v1', { roof: 'gable', exterior: { roof: 'roof_barn' } }).exterior).toEqual({ roof: 'roof_barn' });
  });
});
