/**
 * Übersetzung Bauplan → Einrichtung (Leseport `RoomGeometry`) im Anwendungsdienst.
 *
 * Treppen, Deckenöffnungen und Geländer (`RoomShellInfo.blocked`) sind für die Einrichtung keine Innenfläche.
 * Ihre Ränder gelten als offene Kante (wie ein Fenster: nichts lehnt dort an, keine Wandmontage), und die
 * Treppenzugänge (`stairs`) werden zu Türen: Türzone frei, von allen anderen Türen aus erreichbar.
 * So meidet der Solver die Treppe, ohne sie als Wand misszuverstehen; `blocked` sperrt zusätzlich Luft und Entities.
 */
import type { RoomShellInfo, ShellDoor, ShellWindow } from '@mcda/blueprint';
import { CellSet, HORIZONTAL, cellKey, type Cell, type HorizontalDir } from '@mcda/core';

const STEP: Readonly<Record<HorizontalDir, Cell>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

export function furnishingGeometry(info: RoomShellInfo): RoomShellInfo {
  const blocked = info.blocked ?? CellSet.empty();
  const access = info.stairs ?? [];
  if (blocked.isEmpty && access.length === 0) return info;
  const interior = info.interior.difference(blocked);
  const doors: ShellDoor[] = [...info.doors, ...access.map((a): ShellDoor => ({ inside: a.inside, toward: a.toward, isMain: false }))];
  const doorSides = new Set(doors.map((d) => `${cellKey(d.inside[0], d.inside[1])}>${d.toward}`));
  const edges: ShellWindow[] = [];
  for (const [x, z] of interior) {
    for (const dir of HORIZONTAL) {
      if (!blocked.has(x + STEP[dir][0], z + STEP[dir][1]) || doorSides.has(`${cellKey(x, z)}>${dir}`)) continue;
      edges.push({ inside: [x, z], toward: dir });
    }
  }
  // `blocked` bleibt gesetzt (außerhalb von `interior`): der Solver sperrt die Spalten auch für Luftmasken und
  // Entities (Front-Freiraum, Rahmen) – sonst zeigten sie in Treppenloch oder Geländer (Befund A0, Bautyp-Fuzz).
  return { ...info, interior, doors, windows: [...info.windows, ...edges], blocked, stairs: [] };
}
