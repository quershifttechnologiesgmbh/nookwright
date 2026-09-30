/**
 * W7-G (U7, Konzept W2UX §4.1 Regel 4 „Nachbarn behalten, was noch passt“): Vorgaben für das Neu-Einrichten eines
 * Raums, dessen Geometrie sich geändert hat (Kante gezogen, Tür/Fenster verschoben, Wandhöhe). App (automatisch nach
 * jeder Geometrie-Änderung) und Engine (`project_furnish` mit `keep`) nehmen dieselben Vorgaben – der Solver
 * (`FurnishOptions.keep`) setzt, was mit allen harten Regeln noch passt, an dieselbe Stelle.
 *
 * Vorgabe ist die Einrichtung des Solvers: automatische, ungesperrte Möbel des Raums. Nicht dazu gehören gesperrte und
 * von Hand gesetzte Möbel (bleiben ohnehin als feste Hindernisse) und die Ergänzungen des Licht-Passes
 * (`FurnishingSupplemented`) – der Licht-Pass läuft danach wieder und setzt sie neu, wo es dunkel ist.
 */
import type { Project, RoomId } from '@mcda/blueprint';
import type { KeepHint } from '@mcda/furnishing';

/**
 * Solver-Optionen `keep` und `fixedKeys` eines Raums. `fixedKeys` sind die IDs der gesperrten/manuellen Möbel in der
 * Reihenfolge des Projektzustands – dieselbe Reihenfolge, in der App und `furnishRoomsDetailed` sie als `fixed`
 * übergeben –, damit Hocker und Kerzen an einem gesperrten Tisch bleiben.
 */
export function keepOptionsOf(project: Project, roomId: RoomId): { readonly keep: KeepHint[]; readonly fixedKeys: string[] } {
  return {
    keep: keepHintsOf(project, roomId),
    fixedKeys: project.state.placements.filter((p) => p.roomId === roomId && (p.locked || p.origin === 'manual')).map((p) => p.id),
  };
}

/** Vorgaben eines Raums (Reihenfolge des Projektzustands); leer, wenn der Raum nichts Automatisches hat. */
export function keepHintsOf(project: Project, roomId: RoomId): KeepHint[] {
  const supplemented = new Set<string>();
  for (const e of project.history) if (e.type === 'FurnishingSupplemented' && e.roomId === roomId) for (const p of e.placements) supplemented.add(p.id);
  return project.state.placements
    .filter((p) => p.roomId === roomId && !p.locked && p.origin === 'auto' && !supplemented.has(p.id))
    .map((p) => ({
      key: p.id,
      componentId: p.componentId,
      ...(p.variantId !== undefined ? { variantId: p.variantId } : {}),
      pose: p.pose,
      ...(p.parentId !== undefined ? { parentKey: p.parentId } : {}),
      ...(p.socketId !== undefined ? { socketId: p.socketId } : {}),
    }));
}
