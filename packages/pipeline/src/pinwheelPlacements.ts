/**
 * W8-G (2026-09-27) Windrad-Figuren aus Möbeln: Was der Wächter der Materialisierung auf Blockebene nicht beheben darf
 * (Möbel, Treppen/Stufen, Zäune – z. B. Tavernentisch mit vier Hockern an den Sockets n/s/w/e, die zusammen ein
 * Tetromino-Windrad bilden), wird an der Quelle behoben: in der Einrichtung des Projekts. Die Figur kommt aus
 * Platzierungen (Herkunft der Zellen); entfernt wird genau **eine** davon, deterministisch:
 *  1. nur Blätter (keine Kinder), nie gesperrte Platzierungen (Nutzer-Entscheidung);
 *  2. zuerst Kinder an **optionalen** Sockets (Deko, zusätzlicher Hocker), dann Kinder an Pflicht-Sockets,
 *     zuletzt eigenständige Platzierungen;
 *  3. bei Gleichstand die mit den wenigsten Zellen in der Figur, dann die spätere Platzierung.
 * Ein Hocker weniger bricht die 4-Zähligkeit und lässt Tisch, Wege und Pflichtobjekte stehen (spielbar).
 *
 * FN-Integration (29.09.2026): Besteht die Figur nur aus Hülle/Auskleidung (z. B. Kranzgesims aus Treppen und Eckbalken
 * eines Turmzimmers) und ein Möbel (Kuchen auf dem Wandregal) reißt eine Lücke in den Ring, hat keine Figurenzelle einen
 * Besitzer. Dann zählen als Kandidaten die Platzierungen auf den in der Figurenebene angrenzenden Zellen – nur wenn die
 * erste Art (Besitzer der Figurenzellen) leer ausgeht, also bitgleich für alle bisherigen Fälle.
 */
import type { Catalog } from '@mcda/catalog';
import type { Placement, PlacementId, Project } from '@mcda/blueprint';
import type { Vec3 } from '@mcda/core';
import type { World } from './world.js';

/** Schritte in der Figurenebene (Ebene `y`: x/z; `x`: y/z; `z`: x/y; Draufsicht: x/z). */
const PLANE_STEPS: Readonly<Record<'top' | 'y' | 'x' | 'z', readonly Vec3[]>> = {
  top: [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]],
  y: [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]],
  x: [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  z: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]],
};

/** Platzierung, deren Entfernen die erste unbehobene Windrad-Figur bricht, oder `undefined`. */
export function pinwheelPlacement(project: Project, catalog: Catalog, world: World): PlacementId | undefined {
  const figures = world.materialized.pinwheel?.unfixed ?? [];
  if (figures.length === 0) return undefined;
  const placements = project.state.placements;
  const byId = new Map(placements.map((p, i) => [p.id, { p, i }]));
  const parents = new Set(placements.flatMap((p) => (p.parentId !== undefined ? [p.parentId] : [])));
  const vol = world.materialized.volume;
  for (const f of figures) {
    const count = new Map<PlacementId, number>();
    for (const pos of f.cells) {
      const owner = vol.contains(pos) ? vol.cell(pos)?.owner : undefined;
      if (owner !== undefined && byId.has(owner)) count.set(owner, (count.get(owner) ?? 0) + 1);
    }
    const rank = (owners: ReadonlyMap<PlacementId, number>) => [...owners]
      .map(([id, n]) => ({ ...byId.get(id)!, n }))
      .filter(({ p }) => !p.locked && !parents.has(p.id))
      .map((c) => ({ ...c, rank: rankOf(c.p, byId, catalog) }))
      .sort((a, b) => a.rank - b.rank || a.n - b.n || b.i - a.i);
    const ranked = rank(count);
    if (ranked.length > 0) return ranked[0]!.p.id;
    // Figur ohne Möbelzellen: Möbel in den Lücken des Rings (in der Figurenebene angrenzend)
    if (count.size === 0) {
      const near = new Map<PlacementId, number>();
      const inFigure = new Set(f.cells.map((c) => c.join(',')));
      for (const pos of f.cells) {
        for (const d of PLANE_STEPS[f.plane]) {
          const q: Vec3 = [pos[0] + d[0], pos[1] + d[1], pos[2] + d[2]];
          if (inFigure.has(q.join(',')) || !vol.contains(q)) continue;
          const owner = vol.cell(q)?.owner;
          if (owner !== undefined && byId.has(owner)) near.set(owner, (near.get(owner) ?? 0) + 1);
        }
      }
      const gap = rank(near);
      if (gap.length > 0) return gap[0]!.p.id;
    }
  }
  return undefined;
}

function rankOf(p: Placement, byId: ReadonlyMap<PlacementId, { p: Placement }>, catalog: Catalog): number {
  if (p.parentId === undefined) return 2;
  const parent = byId.get(p.parentId)?.p;
  if (parent === undefined || p.socketId === undefined) return 1;
  const def = catalog.get(parent.componentId);
  const sockets = def.variants?.find((v) => v.id === parent.variantId)?.sockets ?? def.sockets ?? [];
  return sockets.find((s) => s.id === p.socketId)?.required === true ? 1 : 0;
}
