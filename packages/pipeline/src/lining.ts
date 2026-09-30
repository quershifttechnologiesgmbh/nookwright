/**
 * Innenhaut je Raum (W2, Baustandard I1/I4) im Anwendungsdienst: Rezept aus dem Theme (`lining`, je Raumtyp,
 * Geschoss und Höhe), Raum wie für die Einrichtung (`furnishingGeometry`), Wandflächen aus den Hüllzellen und alle
 * Komponenten des Raums → `planLining` (@mcda/furnishing) → Zellen für die Materialisierung.
 *
 * Eine Stelle für App und Engine: `materializeWorld` ruft sie für jede Welt (auch in jeder Runde des Licht-Passes),
 * so misst der Licht-Pass die fertige Innenhaut mit, und App und Engine bleiben blockgleich. Abgeleitet, nicht
 * gespeichert: die Innenhaut steht nicht im Projekt und ändert sich mit Möbeln und Lichtern. Themes ohne `lining`
 * liefern nichts (bitgleich).
 */
import type { Project, RoomId, Shell, ShellKind } from '@mcda/blueprint';
import { liningRecipeFor, type ResolvedTheme } from '@mcda/catalog';
import { key3 } from '@mcda/core';
import { planLining, type LiningBoundary, type PlacedComponent } from '@mcda/furnishing';
import type { LiningSpec } from '@mcda/materialize';
import { furnishingGeometry } from './geometry.js';

/** Hüllzellen, die von innen eine Wandfläche bilden (Mauerwerk, Ecke/T, Sturz, Befestigung). */
const WALL_KINDS: ReadonlySet<ShellKind> = new Set<ShellKind>(['wall', 'pillar', 'lintel', 'fort']);

export function interiorLining(
  project: Project, shell: Shell, theme: ResolvedTheme, placed: readonly { readonly roomId?: RoomId | undefined; readonly placed: PlacedComponent }[],
): LiningSpec[] {
  if (theme.lining === undefined || theme.lining.length === 0) return [];
  const kindAt = new Map<string, ShellKind>();
  for (const c of shell.cells) {
    const k = key3(c.pos);
    if (!kindAt.has(k) || WALL_KINDS.has(c.kind)) kindAt.set(k, c.kind);
  }
  const boundary = (x: number, y: number, z: number): LiningBoundary => {
    const kind = kindAt.get(key3([x, y, z]));
    if (kind === undefined) return 'none';
    // Pfosten der Hülle (W2-FA: Anschlusspfosten I2, Türlaibung I4) sind Teil der Innengliederung und bleiben sichtbar
    if (kind === 'pillar') return 'post';
    if (WALL_KINDS.has(kind)) return 'wall';
    return kind === 'window' ? 'glass' : kind === 'door' ? 'door' : 'none';
  };
  const types = new Map(project.state.rooms.map((r) => [r.id, r.roomTypeId]));
  const byRoom = new Map<RoomId, PlacedComponent[]>();
  for (const p of placed) if (p.roomId !== undefined) byRoom.set(p.roomId, [...(byRoom.get(p.roomId) ?? []), p.placed]);
  const out: LiningSpec[] = [];
  for (const [id, info] of shell.rooms) {
    const recipe = liningRecipeFor(theme.lining, { roomType: types.get(id), storey: info.floorIndex, height: info.height });
    if (recipe === undefined) continue;
    for (const c of planLining({ geometry: furnishingGeometry(info), boundary, placed: byRoom.get(id) ?? [], recipe })) {
      out.push({ pos: c.pos, role: c.role, shape: c.shape, orient: c.orient, owner: `lining:${id}:${c.part}`, group: id });
    }
  }
  return out;
}
