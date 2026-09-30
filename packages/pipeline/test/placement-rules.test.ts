/**
 * W3-BL: Passt-Prüfung beim Verschieben/Drehen/Tauschen von Möbeln als gemeinsame Regel (App `placementEdit`, Engine
 * `movePlacement`/`swapPlacement`): Gruppe samt aufgesetzten Teilen, Raum-Inneres, keine Kollision, neue Lagen.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { Pose } from '@mcda/core';
import { furnishRooms, movePoses, nudgePoses, placementGroup, placementProblem, rotatePoses, shellFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { sampleHouse } from './helpers.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

describe('Möbel-Regeln (placementRules)', () => {
  const p = sampleHouse('1.21.11', 'medieval');
  const shell = shellFor(p);
  furnishRooms(p, shell, ctx.catalog);
  const st = p.state;
  const parent = st.placements.find((x) => st.placements.some((c) => c.parentId === x.id));

  it('Gruppe: Möbel samt Kindern (und Enkeln), Reihenfolge des Projekts', () => {
    expect(parent, 'Beispielhaus hat ein Möbel mit aufgesetzten Teilen').toBeDefined();
    const g = placementGroup(st, parent!.id);
    expect(g[0]!.id === parent!.id || g.some((x) => x.id === parent!.id)).toBe(true);
    expect(g.length).toBeGreaterThan(1);
    for (const x of g) if (x.id !== parent!.id) expect(g.some((y) => y.id === x.parentId)).toBe(true);
  });

  it('verschieben: alle der Gruppe um dasselbe Feld; aus dem Raum → Grund', () => {
    const poses = nudgePoses(st, parent!.id, 1, 0);
    expect([...poses.keys()].sort()).toEqual(placementGroup(st, parent!.id).map((x) => x.id).sort());
    for (const x of placementGroup(st, parent!.id)) expect(poses.get(x.id)!.pos).toEqual([x.pose.pos[0] + 1, x.pose.pos[1], x.pose.pos[2]]);
    expect(placementProblem(st, shell, ctx.catalog, parent!.id, { poses: nudgePoses(st, parent!.id, 80, 0) })).toMatch(/ragt aus dem Raum/);
  });

  it('in ein anderes Möbel → „stößt an ein anderes Möbel“', () => {
    const roots = st.placements.filter((x) => x.parentId === undefined);
    let found: string | undefined;
    for (const a of roots) {
      for (const b of roots) {
        if (a.id === b.id || a.roomId !== b.roomId) continue;
        const why = placementProblem(st, shell, ctx.catalog, a.id, { poses: new Map([[a.id, b.pose]]) });
        if (why !== undefined && /stößt an/.test(why)) found = why;
        if (found !== undefined) break;
      }
      if (found !== undefined) break;
    }
    expect(found).toMatch(/stößt an ein anderes Möbel/);
  });

  it('movePoses: gleiche Drehung = gleiche Verschiebung für die Kinder; Drehung dreht sie mit', () => {
    const root = parent!;
    const target: Pose = { ...root.pose, pos: [root.pose.pos[0] + 2, root.pose.pos[1], root.pose.pos[2] - 1] };
    const moved = movePoses(st, ctx.catalog, root.id, target);
    for (const x of placementGroup(st, root.id)) expect(moved.get(x.id)!.pos).toEqual([x.pose.pos[0] + 2, x.pose.pos[1], x.pose.pos[2] - 1]);
    // Drehung um die Mitte: movePoses auf die Lage aus rotatePoses liefert dieselben Kinder-Drehungen
    const rot = rotatePoses(st, ctx.catalog, root.id);
    const viaMove = movePoses(st, ctx.catalog, root.id, rot.get(root.id)!);
    for (const x of placementGroup(st, root.id)) expect(viaMove.get(x.id)!.rot).toBe(rot.get(x.id)!.rot);
  });

  it('Tausch gegen eine unbekannte Komponente → Grund statt Absturz', () => {
    const a = st.placements[0]!;
    expect(placementProblem(st, shell, ctx.catalog, a.id, { swap: { componentId: 'gibt/es_nicht' } })).toMatch(/unbekannt/i);
    expect(placementProblem(st, shell, ctx.catalog, 'p999', {})).toMatch(/Unbekanntes Möbel/);
  });
});
