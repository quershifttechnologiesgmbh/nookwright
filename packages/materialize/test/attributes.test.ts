/**
 * Zell-Attribute mit Capture (research/30 K7, Blender-Vorbild „Spline Parameter vor dem Ableiten erfassen"):
 * Zellen ohne eigenen Wandkontext – Deko in Außenluft (Fachwerk vor der Wand, Gesims, Außenprofil) und
 * Außen-Komponenten (Fensterläden, Blumenkästen, Laternen) – erben `wall_h`/Rauschfeld ihrer Trägerwand,
 * damit Verläufe und Muster dort weiterlaufen. Geprüft wird das Register, der echte Capture an einer Hülle
 * und die Additivität (ohne Option bitgleich).
 */
import type { RoomShellInfo, Shell, ShellCell } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import {
  captureCandidate, capturedAttributes, hasCapture, materialize, ownAttributes, pickPlaneOf, shellContext, wallBehindAt, wallHeightParam,
} from '../src/index.js';
import { platformView, themes } from './fixtures.js';

/** Wandzelle an (x, y, z) mit Rolle `wall_primary`. */
const wall = (x: number, y: number, z: number, roomId?: string): ShellCell => ({
  pos: [x, y, z], kind: 'wall', shape: 'block', role: 'wall_primary', exterior: true,
  ...(roomId !== undefined ? { roomId } : {}),
});

/**
 * Mini-Hülle: ein 3 × 3-Raum mit Rahmen und **eine Deko-Wandzelle in Außenluft** einen Schritt vor der Wand
 * (kein Raum, keine gerade Wandlinie) – genau der Capture-Fall.
 */
function miniShell(): Shell {
  const cells: ShellCell[] = [];
  const interior = CellSet.rect(1, 1, 3, 3);
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) {
    if (x === 0 || z === 0 || x === 4 || z === 4) cells.push(wall(x, 1, z, 'r1'));
  }
  cells.push(wall(1, 1, 0, 'r1'), wall(0, 2, 0, 'r1'));
  cells.push({ pos: [0, 2, -1], kind: 'wall', shape: 'block', role: 'beam', exterior: true });
  const info: RoomShellInfo = { roomId: 'r1', floorIndex: 0, baseY: 1, height: 3, interior, doors: [], windows: [] };
  return { cells, rooms: new Map([['r1', info]]), warnings: [] };
}

describe('K7 Zell-Attribute: Register und Capture', () => {
  it('Register: eigene Werte, Capture markiert die Herkunft', () => {
    const contexts = shellContext(miniShell(), {});
    const wand = contexts.find((c) => c.x === 0 && c.y === 2 && c.z === 0)!;
    const own = ownAttributes(wand);
    expect(own.wallBehind).toBe(false);
    expect(own.hRel).toBe(wand.hRel);
    expect(own.plane).toBe(wand.plane);

    const captured = capturedAttributes(wand);
    expect(captured.wallBehind).toBe(true);
    expect(captured.wall_h).toBe(own.wall_h);
    expect(captured.plane).toBe(own.plane);
  });

  it('Kandidat ist nur die Zelle ohne eigenen Raum und ohne gerade Wandlinie', () => {
    const contexts = shellContext(miniShell(), {});
    const deko = contexts.find((c) => c.x === 0 && c.y === 2 && c.z === -1)!;
    const wand = contexts.find((c) => c.x === 0 && c.y === 2 && c.z === 0)!;
    expect(captureCandidate(deko)).toBe(true);
    expect(captureCandidate(wand)).toBe(false); // hat einen Raum → eigener, richtiger Kontext
  });

  it('mit Capture erbt die Deko-Zelle die Attribute der Trägerwand, ohne Option nicht', () => {
    const ohne = shellContext(miniShell(), {});
    expect(ohne.every((c) => c.attrs === undefined)).toBe(true);

    const mit = shellContext(miniShell(), {}, { capture: true });
    const deko = mit.find((c) => c.x === 0 && c.y === 2 && c.z === -1)!;
    const wand = mit.find((c) => c.x === 0 && c.y === 2 && c.z === 0)!; // dieselbe Höhe wie die Deko
    expect(hasCapture(deko)).toBe(true);
    expect(deko.attrs!.wallBehind).toBe(true);
    expect(wallHeightParam(deko)).toBe(wallHeightParam(wand));
    expect(pickPlaneOf(deko)).toEqual({ plane: wand.plane, a: wand.a, b: wand.b });

    // Nur `attrs` kommt hinzu: alle eigenen Felder bleiben unangetastet (Additivität)
    for (let i = 0; i < ohne.length; i++) {
      const { attrs: _ignored, ...rest } = mit[i]!;
      expect(rest).toEqual(ohne[i]);
    }
  });

  it('ohne Trägerwand bleibt `attrs` weg (kein geratener Capture)', () => {
    const basis = miniShell();
    const shell: Shell = { ...basis, cells: [...basis.cells, { pos: [10, 2, 10], kind: 'wall', shape: 'block', role: 'beam', exterior: true }] };
    const mit = shellContext(shell, {}, { capture: true });
    const fern = mit.find((c) => c.x === 10 && c.z === 10)!;
    expect(captureCandidate(fern)).toBe(true);
    expect(fern.attrs).toBeUndefined();
    expect(hasCapture(fern)).toBe(false);
  });
});

describe('K7: Materialisierung bleibt ohne Option bitgleich', () => {
  const bau = (captureAttributes: boolean) =>
    materialize({
      shell: miniShell(), placements: [], theme: themes.get('timber')!, platform: platformView('1.21.11'), seed: 2026,
      options: captureAttributes ? { captureAttributes: true } : {},
    });
  const states = (r: ReturnType<typeof bau>): string[] =>
    [...r.volume.cells()].map((c) => `${c.pos.join(',')}=${c.state.name}${JSON.stringify(c.state.properties)}`).sort();

  it('ohne Option ist der Bau bitgleich zu einem Lauf ohne Angabe', () => {
    expect(states(bau(false))).toEqual(states(bau(false)));
    const ohneOpt = states(materialize({ shell: miniShell(), placements: [], theme: themes.get('timber')!, platform: platformView('1.21.11'), seed: 2026 }));
    expect(ohneOpt).toEqual(states(bau(false)));
  });

  it('Außen-Komponenten finden die Wand hinter sich (K7-Capture, `wallBehindAt`)', () => {
    const walls = new Map<string, ReturnType<typeof ownAttributes> | never>();
    const contexts = shellContext(miniShell(), {});
    const key = (p: readonly [number, number, number]): string => p.join(',');
    const map = new Map(contexts.filter((c) => c.frame !== undefined).map((c) => [key([c.x, c.y, c.z]), c]));
    // Ein Schritt vor der Wand (Fensterladen) → Trägerwand gefunden; weit draußen (Laterne am Weg) → keine
    expect(wallBehindAt(map, [0, 2, -1], key)?.roomId).toBe('r1');
    expect(wallBehindAt(map, [0, 2, -2], key)?.roomId).toBe('r1'); // zwei Schritte (Überstand)
    expect(wallBehindAt(map, [20, 2, 20], key)).toBeUndefined();
    void walls;
  });

  it('mit Capture bleibt der Bau bis auf die Deko-Zelle identisch', () => {
    const ohne = states(bau(false));
    const mit = states(bau(true));
    expect(mit).toHaveLength(ohne.length);
    // Nur die Deko-Zelle in Außenluft darf sich ändern (Verlauf/Jitter der Trägerwand); alles andere bleibt
    const gleich = ohne.filter((v, i) => v === mit[i]).length;
    expect(gleich).toBeGreaterThanOrEqual(ohne.length - 1);
  });
});
