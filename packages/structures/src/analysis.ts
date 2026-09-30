/**
 * Prüfungen auf Zellebene (rein, auch für die UI nutzbar): schwebende Blöcke und begehbare Erreichbarkeit.
 * Das Modell ist bewusst einfach und konservativ:
 *  - fest = jede Zelle außer Türen und Zauntoren (Treppen/Stufen zählen als Tritt), Gelände = alles bis groundY;
 *  - Standplatz = Füße und Kopf frei (Luft oder Tür), darunter fest;
 *  - Schritt zu einem 4-Nachbarn: gleich hoch, 1 hoch (auf Treppe/Stufe oder mit Kopffreiheit zum Springen),
 *    oder bis 3 tief fallen.
 */
import type { ShellCell } from '@mcda/blueprint';
import type { Vec3 } from '@mcda/core';
import { N4 } from './geometry.js';
import type { HeightField } from './types.js';

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

export class CellIndex {
  private readonly map = new Map<string, ShellCell>();

  constructor(cells: readonly ShellCell[], readonly ground: HeightField) {
    for (const c of cells) this.map.set(key(c.pos[0], c.pos[1], c.pos[2]), c);
  }

  at(x: number, y: number, z: number): ShellCell | undefined {
    return this.map.get(key(x, y, z));
  }

  isTerrain(x: number, y: number, z: number): boolean {
    return y <= this.ground.groundY(x, z);
  }

  /** Luft, Tür oder Zauntor (lassen sich öffnen). */
  passable(x: number, y: number, z: number): boolean {
    if (this.isTerrain(x, y, z)) return false;
    const c = this.at(x, y, z);
    return c === undefined || c.shape === 'door' || c.shape === 'fence_gate';
  }

  solid(x: number, y: number, z: number): boolean {
    if (this.isTerrain(x, y, z)) return true;
    const c = this.at(x, y, z);
    return c !== undefined && c.shape !== 'door' && c.shape !== 'fence_gate';
  }

  canStand(x: number, y: number, z: number): boolean {
    return this.passable(x, y, z) && this.passable(x, y + 1, z) && this.solid(x, y - 1, z);
  }

  /** Halbe Stufe unter den Füßen (Treppe, untere Stufe): hinauf ohne Springen. */
  halfStep(x: number, y: number, z: number): boolean {
    const c = this.at(x, y - 1, z);
    return c !== undefined && (c.shape === 'stairs' || (c.shape === 'slab' && c.orient?.half !== 'top'));
  }
}

/** Zellen ohne Verbindung (Flächenkontakt) zum Gelände. Leer = nichts schwebt. */
export function floatingCells(cells: readonly ShellCell[], ground: HeightField): Vec3[] {
  const idx = new CellIndex(cells, ground);
  const grounded = new Set<string>();
  const queue: Vec3[] = [];
  for (const c of cells) {
    const [x, y, z] = c.pos;
    const onTerrain = idx.isTerrain(x, y - 1, z) || N4.some(([ax, az]) => idx.isTerrain(x + ax, y, z + az));
    if (onTerrain) {
      grounded.add(key(x, y, z));
      queue.push(c.pos);
    }
  }
  const D6: readonly Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  while (queue.length > 0) {
    const [x, y, z] = queue.pop()!;
    for (const [dx, dy, dz] of D6) {
      const k = key(x + dx, y + dy, z + dz);
      if (!grounded.has(k) && idx.at(x + dx, y + dy, z + dz) !== undefined) {
        grounded.add(k);
        queue.push([x + dx, y + dy, z + dz]);
      }
    }
  }
  return cells.filter((c) => !grounded.has(key(c.pos[0], c.pos[1], c.pos[2]))).map((c) => c.pos);
}

/**
 * Alle von `starts` aus erreichbaren Standplätze (Füße) innerhalb des Hüllquaders der Zellen (+ Rand).
 * Ergebnis als Schlüsselmenge "x,y,z".
 */
export function reachableStands(cells: readonly ShellCell[], ground: HeightField, starts: readonly Vec3[], margin = 3): Set<string> {
  const idx = new CellIndex(cells, ground);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const { pos: [x, y, z] } of cells) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  for (const [x, y, z] of starts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const inBox = (x: number, y: number, z: number): boolean =>
    x >= minX - margin && x <= maxX + margin && z >= minZ - margin && z <= maxZ + margin && y >= minY - margin && y <= maxY + 3;
  const seen = new Set<string>();
  const queue: Vec3[] = [];
  for (const s of starts) {
    if (idx.canStand(s[0], s[1], s[2]) && !seen.has(key(...s))) {
      seen.add(key(...s));
      queue.push(s);
    }
  }
  const visit = (x: number, y: number, z: number): void => {
    const k = key(x, y, z);
    if (seen.has(k) || !inBox(x, y, z)) return;
    seen.add(k);
    queue.push([x, y, z]);
  };
  while (queue.length > 0) {
    const [x, y, z] = queue.pop()!;
    for (const [ax, az] of N4) {
      const nx = x + ax;
      const nz = z + az;
      // hinauf: auf eine Treppe/Stufe, oder springen (Kopffreiheit über dem Standplatz)
      if (idx.canStand(nx, y + 1, nz) && (idx.halfStep(nx, y + 1, nz) || idx.passable(x, y + 2, z))) visit(nx, y + 1, nz);
      if (!idx.passable(nx, y, nz) || !idx.passable(nx, y + 1, nz)) continue;
      if (idx.canStand(nx, y, nz)) {
        visit(nx, y, nz);
        continue;
      }
      // fallen (bis 3 Blöcke)
      for (let d = 1; d <= 3; d++) {
        if (!idx.passable(nx, y - d, nz)) break;
        if (idx.canStand(nx, y - d, nz)) {
          visit(nx, y - d, nz);
          break;
        }
      }
    }
  }
  return seen;
}

export const standKey = (p: Vec3): string => key(p[0], p[1], p[2]);
