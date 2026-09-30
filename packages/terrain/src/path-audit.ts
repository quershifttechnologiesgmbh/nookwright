/**
 * Wege-Bericht (research/38 §7, Priorität P1): prüft die drei Dinge, die im Generator bisher **nirgends**
 * geprüft wurden – jede Tür hat einen Weg, kein Weg endet unvermittelt, keine Weg-Insel ohne Anschluss.
 * Rein und deterministisch; ändert nichts am Gelände, liefert nur Zahlen und Fundstellen.
 *
 * Grundlage sind die Rang-Karte aus dem Generator (`plan.path`: 1 Pfad, 2 Nebenweg, 3 Hauptweg) und die
 * Tür-Austritte (`doorExits`).
 */
import type { Cell } from '@mcda/core';
import type { PlotGrid } from './grid.js';

export interface PathAudit {
  /** Wegzellen je Rang (1 Pfad, 2 Nebenweg, 3 Hauptweg). */
  readonly ranks: { readonly path: number; readonly side: number; readonly main: number };
  /** Türen ohne Weg in der 4er-Nachbarschaft („Weg trifft die Türschwelle“, research/38 A-2). */
  readonly unconnectedDoors: readonly Cell[];
  /** Wegzellen mit höchstens einem Weg-Nachbarn, die kein Ziel sind (Sackgassen, research/38 V3). */
  readonly deadEnds: readonly Cell[];
  /** Wegzellen in Komponenten ohne Türkontakt (Inseln, research/38 V7). */
  readonly islandCells: readonly Cell[];
  /**
   * Licht am Weg (research/37/38: Laternen am Hauptweg alle 6–8 Blöcke): größter Taxi-Abstand einer Wegzelle
   * je Rang zur nächsten Laterne. `−1` = kein Licht am Weg.
   */
  readonly lightGaps: { readonly main: number; readonly side: number; readonly path: number };
  /**
   * **Engste gemessene** Stelle je Rang in Blöcken (research/38 §1: Hauptweg 3–5, Nebenweg 2, Pfad 1–2).
   * `0` = nicht messbar (kein Weg dieses Rangs **oder** nur breite Bänder/Kreuzungen, wo „quer“ nicht definiert
   * ist). Gemessen als kürzester Querlauf durch eine Wegzelle, die genau eine Laufrichtung hat – für schmale
   * Wege aussagekräftig, für breite Plätze bewusst „nicht messbar“ statt geschätzt.
   */
  readonly widths: { readonly main: number; readonly side: number; readonly path: number };
  /** Menschenlesbare Befunde (leer = alles in Ordnung). */
  readonly warnings: readonly string[];
}

const N4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Wege prüfen. `path` ist die Rang-Karte des Generators (Index wie `grid.idx`), `doors` sind die
 * Tür-Austrittszellen. Als **Ziel** zählen zusätzlich `goals` (Feldtor, Brunnen …) und jede Wegzelle am
 * Grundstücksrand – dort *darf* ein Weg enden (research/38: Weg verbindet Ziele, Sackgassen sind Fehler).
 */
export function auditPaths(grid: PlotGrid, path: Uint8Array, doors: readonly Cell[], goals: readonly Cell[] = [], zone?: readonly (string | null)[], lights: readonly Cell[] = []): PathAudit {
  const isPath = (x: number, z: number): boolean => {
    const i = grid.at(x, z);
    return i >= 0 && path[i]! > 0;
  };
  const ranks = { path: 0, side: 0, main: 0 };
  for (let i = 0; i < path.length; i++) {
    if (path[i] === 1) ranks.path++;
    else if (path[i] === 2) ranks.side++;
    else if (path[i] === 3) ranks.main++;
  }
  // Türen: Weg direkt daneben? (Türzelle selbst ist keine Wegzelle)
  const doorKeys = new Set<string>();
  const unconnectedDoors: Cell[] = [];
  for (const [x, z] of doors) {
    doorKeys.add(`${x},${z}`);
    if (!N4.some(([dx, dz]) => isPath(x + dx, z + dz))) unconnectedDoors.push([x, z]);
  }
  const goalKeys = new Set<string>();
  for (const [x, z] of goals) goalKeys.add(`${x},${z}`);
  /** Zone an dieser Stelle (Garten, Feld, Koppel …) – ein Weg dorthin hat ein Ziel erreicht. */
  const zoneAt = (x: number, z: number): boolean => {
    if (zone === undefined) return false;
    const i = grid.at(x, z);
    return i >= 0 && zone[i] != null;
  };
  /** Ziel, Zone oder Grundstücksrand: dort darf ein Weg enden. */
  const isGoal = (x: number, z: number): boolean =>
    doorKeys.has(`${x},${z}`) || goalKeys.has(`${x},${z}`) || zoneAt(x, z)
    || N4.some(([dx, dz]) => grid.at(x + dx, z + dz) < 0 || zoneAt(x + dx, z + dz));
  // Sackgassen: höchstens ein Weg-Nachbar und kein Ziel
  const deadEnds: Cell[] = [];
  for (let i = 0; i < path.length; i++) {
    if (path[i] === 0) continue;
    const x = grid.x(i);
    const z = grid.z(i);
    const frei = N4.filter(([dx, dz]) => isPath(x + dx, z + dz)).length;
    if (frei <= 1 && !isGoal(x, z)) deadEnds.push([x, z]);
  }
  // Inseln: Zusammenhangskomponenten der Wegzellen, die keine Tür berühren
  const seen = new Set<number>();
  const islandCells: Cell[] = [];
  for (let start = 0; start < path.length; start++) {
    if (path[start] === 0 || seen.has(start)) continue;
    const komponente: number[] = [];
    const queue = [start];
    seen.add(start);
    let beruehrtTuer = false;
    while (queue.length > 0) {
      const i = queue.pop()!;
      komponente.push(i);
      const x = grid.x(i);
      const z = grid.z(i);
      if (isGoal(x, z) || N4.some(([dx, dz]) => isGoal(x + dx, z + dz))) beruehrtTuer = true;
      for (const [dx, dz] of N4) {
        const j = grid.at(x + dx, z + dz);
        if (j >= 0 && path[j]! > 0 && !seen.has(j)) {
          seen.add(j);
          queue.push(j);
        }
      }
    }
    if (!beruehrtTuer) for (const i of komponente) islandCells.push([grid.x(i), grid.z(i)]);
  }
  // Licht am Weg: größter Abstand einer Wegzelle (je Rang) zur nächsten Laterne in Taxi-Distanz
  const lichtAbstand = (rang: number): number => {
    if (lights.length === 0) return -1;
    let max = 0;
    for (let i = 0; i < path.length; i++) {
      if (path[i] !== rang) continue;
      const x = grid.x(i);
      const z = grid.z(i);
      let nahe = Infinity;
      for (const [lx, lz] of lights) nahe = Math.min(nahe, Math.abs(lx - x) + Math.abs(lz - z));
      if (nahe > max) max = nahe;
    }
    return max;
  };
  const lightGaps = { main: lichtAbstand(3), side: lichtAbstand(2), path: lichtAbstand(1) };

  // Wegbreiten: Querlauf durch jede Wegzelle zählen (Richtung aus den Nachbarn)
  const breite = (rank: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < path.length; i++) {
      if (path[i] !== rank) continue;
      const x = grid.x(i);
      const z = grid.z(i);
      const istWeg = (xx: number, zz: number): boolean => {
        const j = grid.at(xx, zz);
        return j >= 0 && path[j]! > 0;
      };
      const laengsX = istWeg(x - 1, z) || istWeg(x + 1, z);
      const laengsZ = istWeg(x, z - 1) || istWeg(x, z + 1);
      // Kreuzungen und Plätze überspringen: dort ist „quer“ nicht definiert und der Lauf zählt die Länge
      if (laengsX === laengsZ) continue;
      const [dx, dz] = laengsX ? [0, 1] : [1, 0];
      let n = 1;
      for (const dir of [1, -1]) {
        for (let k = 1; k < 12; k++) {
          if (!istWeg(x + dx * k * dir, z + dz * k * dir)) break;
          n++;
        }
      }
      out.push(n);
    }
    return out;
  };
  const engste = (a: readonly number[]): number => (a.length === 0 ? 0 : Math.min(...a));
  const widths = { main: engste(breite(3)), side: engste(breite(2)), path: engste(breite(1)) };

  const warnings: string[] = [];
  if (unconnectedDoors.length > 0) warnings.push(`${unconnectedDoors.length} Tür(en) ohne Weganschluss: ${unconnectedDoors.slice(0, 4).map((p) => p.join(',')).join(' · ')}`);
  if (deadEnds.length > 0) warnings.push(`${deadEnds.length} Sackgasse(n) im Wegnetz: ${deadEnds.slice(0, 4).map((p) => p.join(',')).join(' · ')}`);
  if (islandCells.length > 0) warnings.push(`${islandCells.length} Wegzelle(n) ohne Ziel (Insel): ${islandCells.slice(0, 4).map((p) => p.join(',')).join(' · ')}`);
  return { ranks, unconnectedDoors, deadEnds, islandCells, lightGaps, widths, warnings };
}
