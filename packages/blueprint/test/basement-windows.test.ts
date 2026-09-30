import { describe, expect, it } from 'vitest';
import { CellSet } from '@mcda/core';
import { Project, TARGET_VERSIONS, deriveShell } from '../src/index.js';

describe('Keller', () => {
  it('bekommen keine Fenster (liegen im Erdreich), das Erdgeschoss schon', () => {
    const p = Project.create({ id: 'k', name: 'Keller', seed: 3, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
    p.addFloor({ below: true });
    p.paintRoom(0, CellSet.rect(0, 0, 9, 7), 'kitchen');
    p.paintRoom(-1, CellSet.rect(0, 0, 9, 7), 'storage');
    const shell = deriveShell(p.state, { roof: 'hip' });
    const byFloor = (f: number) => p.state.rooms.filter((r) => r.floorIndex === f).flatMap((r) => shell.rooms.get(r.id)!.windows);
    expect(byFloor(-1)).toEqual([]);
    expect(byFloor(0).length).toBeGreaterThan(0);
    expect(shell.cells.some((c) => c.kind === 'window' && c.pos[1] < 0)).toBe(false);
  });
});
