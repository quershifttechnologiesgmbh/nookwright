/**
 * Q1b-Fokustest (research/52 §6 Hebel 1, plan/auftraege/Q_qualitaetsoffensive.md §Q1b):
 * Die Reihenfolge der Wunschzonen (`placement.zones`) ist eine Priorität. Eine Komponente mit
 * `zones: ["corner","edge"]` muss häufiger auf einer Eckzelle landen als eine sonst gleiche Komponente mit
 * `zones: ["edge"]` – und zwar deterministisch über feste Seeds.
 *
 * Vor der Änderung bewertete der Solver jede gelistete Zone gleich (`includes`) und würfelte zwischen Ecke und
 * Wandkante; gemessen wurden 10/40 Seeds mit der Eck-Komponente auf einer Ecke (25 %). Mit der Rang-Gewichtung
 * (`zoneWeight`) sind es 40/40. Die Schwelle 18/24 liegt bewusst über dem Vorher-Wert und unter dem Nachher-Wert:
 * ein Rückfall auf die alte Gleichbehandlung wird rot, ein zufälliger Ausrutscher nicht.
 */
import { describe, expect, it } from 'vitest';
import { Catalog, ComponentDefSchema, RoomTypeSchema, type ComponentDef, type RoomTypeDef } from '@mcda/catalog';
import { CellSet, cellKey } from '@mcda/core';
import { furnishRoom, zoneWeight, type FurnishResult, type RoomGeometry } from '../src/index.js';
import { DV } from './fixtures.js';

const comp = (id: string, tag: string): ComponentDef =>
  ComponentDefSchema.parse({
    kind: 'static', category: 'furniture', obtainability: 'survival', mount: 'floor', rotations: 'all',
    id, tags: [tag], layers: [['X']], legend: { X: { block: 'minecraft:oak_planks' } },
  });

/** Zwei geometrisch gleiche Komponenten: `a` wird eck-zuerst gewünscht, `b` nur an der Wandkante. */
const catalog = Catalog.of([comp('q1b/a', 'q1b_a'), comp('q1b/b', 'q1b_b')]);
const ROOM: RoomTypeDef = RoomTypeSchema.parse({
  id: 'q1b_corner_t', name: 'Q1b-Ecke', minArea: 1, coverage: { target: 0.2 }, optional: [],
  required: [
    { tags: ['q1b_a'], count: [1, 1], placement: { zones: ['corner', 'edge'] } },
    { tags: ['q1b_b'], count: [1, 1], placement: { zones: ['edge'] } },
  ],
});

/** 5 × 5 Innenraum (Außenmaß 7 × 7), Tür Süd, Fenster frei: vier Ecken, viele Wandkanten. */
function squareRoom(): RoomGeometry {
  return {
    roomId: 'q1b',
    baseY: 1,
    height: 3,
    interior: CellSet.rect(0, 0, 4, 4),
    doors: [{ inside: [2, 4], toward: 'south', isMain: true }],
    windows: [],
  };
}

const SEEDS: readonly number[] = Array.from({ length: 24 }, (_, i) => i);

/** Zellen einer Platzierung auf Bodenhöhe, die auf einer Eckzelle des Raums liegen. */
function cornerPlacements(r: FurnishResult, id: string): number {
  const corners = new Set([...r.analysis.info.values()].filter((i) => i.cls === 'corner').map((i) => cellKey(i.cell[0], i.cell[1])));
  // `placed` ist [feste Komponenten, Einträge]; `placements` beschreibt nur die Einträge in derselben Reihenfolge.
  const offset = r.placed.length - r.placements.length;
  return r.placed.filter((p, i) => {
    if (r.placements[i - offset]?.componentId !== id) return false;
    return p.cells.some((c) => c.pos[1] <= 1 + 1 && corners.has(cellKey(c.pos[0], c.pos[2])));
  }).length;
}

describe('Q1b: Wunschzonen-Reihenfolge ist eine Priorität', () => {
  it('zoneWeight: erste Zone volle Punktzahl, jede weitere halbiert', () => {
    expect(zoneWeight('corner', ['corner', 'edge'])).toBe(1);
    expect(zoneWeight('edge', ['corner', 'edge'])).toBe(0.5);
    expect(zoneWeight('edge', ['edge', 'corner'])).toBe(1);
    expect(zoneWeight('corner', ['edge', 'corner'])).toBe(0.5);
    expect(zoneWeight('center', ['corner', 'edge'])).toBe(0);
  });

  it('Eck-Komponente landet über feste Seeds häufiger in einer Ecke als die Wandkanten-Komponente', () => {
    let aCorner = 0;
    let bCorner = 0;
    for (const seed of SEEDS) {
      const r = furnishRoom(squareRoom(), ROOM, catalog, { seed, dataVersion: DV });
      aCorner += cornerPlacements(r, 'q1b/a');
      bCorner += cornerPlacements(r, 'q1b/b');
    }
    // Vorher/Nachher: 10/24 bzw. 24/24; Schwelle 18/24 mit Abstand zu beiden Werten.
    expect(aCorner).toBeGreaterThanOrEqual(18);
    expect(aCorner).toBeGreaterThan(bCorner);
  });

  it('bleibt deterministisch: gleicher Seed → gleiches Ergebnis', () => {
    const g = squareRoom();
    expect(JSON.stringify(furnishRoom(g, ROOM, catalog, { seed: 3, dataVersion: DV }))).toBe(
      JSON.stringify(furnishRoom(g, ROOM, catalog, { seed: 3, dataVersion: DV })),
    );
  });
});
