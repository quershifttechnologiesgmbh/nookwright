/**
 * W11-A „Treppen automatisch aus den Räumen“: Etagen verbinden (2, 3 Etagen, Keller), Erschließung vor Schlafzimmer,
 * gestapelt, deterministisch, vorhandene Treppen unangetastet, keine Pflichtmöbel verloren.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, stairLayout } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { applyAutoStairs, autoStairsText, circulation, disconnectedFloors, furnishRoomsDetailed, planAutoStairs, shellFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const catalog = ctx.catalog;

type Rect = readonly [number, number, number, number];
const rect = ([x0, z0, x1, z1]: Rect): CellSet => CellSet.rect(x0, z0, x1, z1);

function project(seed: number, rooms: ReadonlyArray<readonly [number, Rect, string]>, opts: { up?: number; down?: number } = {}): Project {
  const p = Project.create({ id: 't', name: 'Test', seed, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
  for (let i = 0; i < (opts.up ?? 0); i++) p.addFloor();
  for (let i = 0; i < (opts.down ?? 0); i++) p.addFloor({ below: true });
  for (const [floor, r, type] of rooms) p.paintRoom(floor, rect(r), type);
  return p;
}

const typeAt = (p: Project, floor: number, roomId: string): string => p.state.rooms.find((r) => r.id === roomId && r.floorIndex === floor)!.roomTypeId;

describe('W11-A: Treppen automatisch aus den Räumen', () => {
  it('zwei Etagen: eine Treppe, in der Diele (Eingangshalle → Galerie), nicht im Schlafzimmer', () => {
    const p = project(7, [
      [0, [0, 0, 8, 10], 'entrance_hall'], [0, [8, 0, 17, 10], 'bedroom'],
      [1, [0, 0, 8, 10], 'gallery'], [1, [8, 0, 17, 10], 'bedroom'],
    ], { up: 1 });
    expect(disconnectedFloors(p.state)).toEqual([{ volumeId: 'v0', floorIndex: 0 }]);
    const plan = applyAutoStairs(p, { catalog });
    expect(plan.gaps).toEqual([]);
    expect(plan.stairs).toHaveLength(1);
    const s = plan.stairs[0]!;
    expect(typeAt(p, 0, s.lowerRoomId)).toBe('entrance_hall');
    expect(typeAt(p, 1, s.upperRoomId)).toBe('gallery');
    expect(p.state.links).toHaveLength(1);
    expect(disconnectedFloors(p.state)).toEqual([]);
    expect(autoStairsText(plan, p.state, catalog)).toBe('Treppe automatisch gesetzt: EG ↔ 1. OG in Eingangshalle → Flur / Galerie');
    // verbunden: kein Obergeschoss ohne Treppe
    const shell = shellFor(p, { roof: 'gable' });
    expect(circulation(shell, p).stepless.upperWithoutStairs).toEqual([]);
  });

  it('Schlafzimmer nur ohne Alternative: Lager unten schlägt Schlafzimmer; nur Schlafzimmer → trotzdem verbunden', () => {
    const p = project(3, [
      [0, [0, 0, 9, 10], 'bedroom'], [0, [9, 0, 18, 10], 'storage'],
      [1, [0, 0, 18, 10], 'solar'],
    ], { up: 1 });
    const plan = planAutoStairs(p.state, { catalog });
    expect(plan.stairs).toHaveLength(1);
    expect(typeAt(p, 0, plan.stairs[0]!.lowerRoomId)).toBe('storage');
    const only = project(3, [[0, [0, 0, 12, 10], 'bedroom'], [1, [0, 0, 12, 10], 'bedroom']], { up: 1 });
    expect(planAutoStairs(only.state, { catalog }).stairs).toHaveLength(1);
  });

  it('drei Etagen und Keller: alle verbunden, gestapelt (Antritt oben nah am Austritt unten), minimal', () => {
    const p = project(11, [
      [-1, [0, 0, 14, 10], 'storage'],
      [0, [0, 0, 8, 10], 'entrance_hall'], [0, [8, 0, 14, 10], 'kitchen'],
      [1, [0, 0, 8, 10], 'gallery'], [1, [8, 0, 14, 10], 'bedroom'],
      [2, [0, 0, 14, 10], 'attic'],
    ], { up: 2, down: 1 });
    expect(disconnectedFloors(p.state).map((d) => d.floorIndex)).toEqual([0, -1, 1]);
    const plan = applyAutoStairs(p, { catalog });
    expect(plan.gaps).toEqual([]);
    expect(plan.stairs.map((s) => s.floorIndex).sort()).toEqual([-1, 0, 1]);
    expect(p.state.links).toHaveLength(3);
    expect(disconnectedFloors(p.state)).toEqual([]);
    // gestapelt: Austritt EG → 1. OG liegt nah am Antritt 1. OG → 2. OG
    const rise = (f: number) => p.state.floors.find((x) => x.index === f + 1)!.y0 - p.state.floors.find((x) => x.index === f)!.y0;
    const lay = (f: number) => {
      const l = p.state.links.find((x) => x.floorIndex === f)!;
      return stairLayout(l, rise(f));
    };
    const a = lay(0).arrival.inside;
    const b = lay(1).bottom.inside;
    expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBeLessThanOrEqual(4);
    expect(circulation(shellFor(p, { roof: 'gable' }), p).stepless.upperWithoutStairs).toEqual([]);
  }, HEAVY_TIMEOUT);

  it('deterministisch: gleicher Zustand → gleiche Treppen; verbunden → leerer Plan (bitgleich)', () => {
    const make = () => project(5, [[0, [0, 0, 12, 12], 'solar'], [1, [0, 0, 12, 12], 'study']], { up: 1 });
    const a = planAutoStairs(make().state, { catalog });
    const b = planAutoStairs(make().state, { catalog });
    expect(a).toEqual(b);
    const p = make();
    applyAutoStairs(p, { catalog });
    const before = p.history.length;
    expect(applyAutoStairs(p, { catalog })).toEqual({ stairs: [], gaps: [] });
    expect(p.history.length).toBe(before);
  });

  it('vorhandene (von Hand gesetzte) Treppen bleiben und zählen als Verbindung', () => {
    const p = project(9, [
      [0, [0, 0, 12, 10], 'solar'], [1, [0, 0, 12, 10], 'study'], [2, [0, 0, 12, 10], 'attic'],
    ], { up: 2 });
    p.placeStairs(0, [2, 2], 'east');
    const manual = p.state.links[0]!;
    const plan = applyAutoStairs(p, { catalog });
    expect(plan.stairs.map((s) => s.floorIndex)).toEqual([1]);
    expect(p.state.links[0]).toEqual(manual);
  });

  it('keine Überlappung: kein Raum liegt über dem anderen → Lücke mit Grund, nichts gesetzt', () => {
    const p = project(1, [[0, [0, 0, 9, 9], 'solar'], [1, [20, 0, 29, 9], 'study']], { up: 1 });
    const plan = applyAutoStairs(p, { catalog });
    expect(plan.stairs).toEqual([]);
    expect(plan.gaps).toEqual([{ volumeId: 'v0', floorIndex: 0, reason: 'no_overlap' }]);
    expect(autoStairsText(plan, p.state, catalog)).toMatch(/^Keine Treppe EG ↔ 1\. OG: kein Raum liegt/);
  });

  it('Spielbarkeit: die Treppe nimmt keinem Raum ein Pflichtobjekt (Einrichtung vor/nach)', () => {
    const rooms = [
      [0, [0, 0, 8, 9], 'entrance_hall'], [0, [8, 0, 15, 9], 'kitchen'],
      [1, [0, 0, 8, 9], 'bedroom'], [1, [8, 0, 15, 9], 'bedroom'],
    ] as const;
    const p = project(4, rooms, { up: 1 });
    applyAutoStairs(p, { catalog });
    expect(p.state.links).toHaveLength(1);
    const missing = (x: Project) => furnishRoomsDetailed(x, shellFor(x, { roof: 'gable' }), catalog).warnings.filter((w) => /Pflichtobjekt/.test(w));
    expect(missing(p)).toEqual(missing(project(4, rooms, { up: 1 })));
  }, HEAVY_TIMEOUT);
});
