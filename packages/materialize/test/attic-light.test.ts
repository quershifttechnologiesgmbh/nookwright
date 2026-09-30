/**
 * W4 (27.09.2026, plan/spikes/W4E_feinschliff.md, Review K1): Dachraum spawnsicher als **harte Regel**.
 *
 * - `spawnReport` prüft neben den Räumen den Dachraum (Luft über der obersten Deckenplatte unter einem geneigten Dach):
 *   dunkle begehbare Zellen dort stehen als `attic: true` in `darkCells` und als Spawn-Meldung „Dachraum über …“.
 * - Die Hülle stellt dafür Laternen auf den Dachboden (`placeAtticLights`); mit ihnen bleibt der Dachraum hell, ohne
 *   sie meldet der Bericht die Zellen (Gegenprobe).
 * - Die Laternen stehen auf voller Oberseite (0 Physik-Verstöße) und liegen nie in einem Raum.
 */
import { Project, TARGET_VERSIONS as PROJECT_VERSIONS, deriveShell, isAtticLight, type RoofStyle, type Shell } from '@mcda/blueprint';
import { CellSet, key3 } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { materialize, type MaterializeResult } from '../src/index.js';
import { platformView, themes } from './fixtures.js';

const VERSION = '1.21.11';

function house(roof: RoofStyle, w = 13, d = 9, height = 3): { shell: Shell; roomTypes: Record<string, string> } {
  const p = Project.create({ id: 'a', name: 'A', seed: 7, themeId: 'medieval', targetVersion: PROJECT_VERSIONS[VERSION], floor: { y0: 0, height } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), 'bedroom');
  return { shell: deriveShell(p.state, { roof, overhang: 1 }), roomTypes: Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])) };
}

function run(shell: Shell, roomTypes: Record<string, string>, themeId = 'medieval'): MaterializeResult {
  return materialize({ shell, placements: [], theme: themes.get(themeId), platform: platformView(VERSION), seed: 2026, roomTypes });
}

describe('Dachraum spawnsicher (W4)', () => {
  for (const roof of ['gable', 'hip', 'half_hip', 'mansard', 'gambrel', 'saltbox'] as const) {
    it(`${roof}: Dachraum geprüft, 0 dunkle Zellen, Laternen stehen fest`, () => {
      const h = house(roof, 21, 11);
      const r = run(h.shell, h.roomTypes);
      expect(r.light.atticCells ?? 0).toBeGreaterThan(0);
      expect(r.light.darkCells.filter((c) => c.attic === true)).toEqual([]);
      expect(r.violations.filter((v) => v.severity === 'error')).toEqual([]);
      const lights = h.shell.cells.filter(isAtticLight);
      expect(lights.length).toBeGreaterThan(0);
      for (const l of lights) {
        expect(r.volume.stateAt(l.pos).name).toBe('lantern');
        // nie in einem Raum: über der Decke
        for (const room of h.shell.rooms.values()) expect(l.pos[1]).toBeGreaterThanOrEqual(room.baseY + room.height + 1);
      }
    });
  }

  it('Gegenprobe: ohne die Laternen meldet der Bericht den dunklen Dachraum', () => {
    const h = house('gable', 21, 11);
    const bare = { ...h.shell, cells: h.shell.cells.filter((c) => !isAtticLight(c)) };
    const r = run(bare, h.roomTypes);
    const attic = r.light.darkCells.filter((c) => c.attic === true);
    expect(attic.length).toBeGreaterThan(0);
    expect(attic.some((c) => c.spawnable)).toBe(true);
    expect(r.violations.some((v) => v.kind === 'spawn' && v.message.startsWith('Dachraum über'))).toBe(true);
    // Räume bleiben davon unberührt (walkableCells zählt nur Räume)
    expect(r.light.walkableCells).toBe(run(h.shell, h.roomTypes).light.walkableCells);
  });

  it('Flachdach: kein Dachraum, keine Laterne', () => {
    const h = house('flat');
    expect(h.shell.cells.filter(isAtticLight)).toEqual([]);
    expect(run(h.shell, h.roomTypes).light.atticCells).toBeUndefined();
  });

  it('großer Dachraum (Halle 33 × 19): mehrere Laternen, jede Zelle mit Boden in Reichweite, deterministisch', () => {
    const a = house('gable', 33, 19, 4);
    const b = house('gable', 33, 19, 4);
    const lights = a.shell.cells.filter(isAtticLight);
    expect(lights.length).toBeGreaterThan(1);
    expect(lights.map((c) => key3(c.pos))).toEqual(b.shell.cells.filter(isAtticLight).map((c) => key3(c.pos)));
    const r = run(a.shell, a.roomTypes, 'nordic');
    expect(r.light.atticCells ?? 0).toBeGreaterThan(0);
    expect(r.light.darkCells.filter((c) => c.attic === true)).toEqual([]);
  });
});
