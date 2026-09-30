import { cellKey } from '@mcda/core';
import type { Shell, ShellCell } from './types.js';

const STEP = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;

/**
 * Draufsicht der Hülle als ASCII (Debug/Tests). Norden oben, Osten rechts.
 * Legende: a b c … Innenfläche je Raum (in Map-Reihenfolge), '-' '|' Wandfeld, '+' Pfeiler (Ecke/T/Kreuz/Ende),
 * 'D' Tür, 'H' Haustür, 'F' Fenster, 'S' Treppe/Leiter, '#' Geländer, 'o' Deckenöffnung (ohne Bodenplatte),
 * '.' außen.
 * @param floorIndex nur diese Etage (Standard: die unterste mit Räumen)
 * @param baseY Baukörper (V0): nur Räume dieser Etage mit diesem Boden (Standard: der Boden des ersten Raums)
 */
export function renderShellPlan(shell: Shell, floorIndex?: number, baseY?: number): string {
  const infos = [...shell.rooms.values()];
  const floor = floorIndex ?? Math.min(...infos.map((r) => r.floorIndex));
  const onFloor = infos.filter((r) => r.floorIndex === floor);
  const own = onFloor.filter((r) => r.baseY === (baseY ?? onFloor[0]?.baseY));
  if (own.length === 0) return '';
  const y0 = own[0]!.baseY - 1;
  const ceilingY = own[0]!.baseY + Math.max(...own.map((r) => r.height));
  const ids = new Set(own.map((r) => r.roomId));
  // Treppen nach Lage (die oberste Stufe von unten liegt in der Bodenplatte), alles andere nach Raum dieser Etage
  const inFloor = (c: ShellCell): boolean =>
    c.kind !== 'roof' && c.pos[1] >= y0 && c.pos[1] < ceilingY && (c.kind === 'stairs' || (c.roomId !== undefined && ids.has(c.roomId)));
  const walls = new Map<string, 'wall' | 'pillar' | 'door' | 'window' | 'stairs' | 'railing'>();
  const slab = new Set<string>();
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const c of shell.cells) {
    if (!inFloor(c)) continue;
    const [x, y, z] = c.pos;
    const k = cellKey(x, z);
    if (y === y0 && c.kind === 'floor') slab.add(k);
    if (c.kind === 'stairs') {
      walls.set(k, 'stairs');
      continue; // die oberste Stufe der Treppe von unten liegt in der Bodenplatte, zählt aber nicht zum Umriss
    }
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    const prev = walls.get(k);
    if (c.kind === 'door' || (c.kind === 'window' && prev !== 'door')) walls.set(k, c.kind);
    else if ((c.kind === 'wall' || c.kind === 'pillar' || c.kind === 'railing') && prev === undefined) walls.set(k, c.kind);
  }
  if (minX === Infinity) return '';
  const letters = new Map<string, string>();
  const main = new Set<string>();
  own.forEach((r, k) => {
    const ch = String.fromCharCode(97 + (k % 26));
    for (const [x, z] of r.interior) letters.set(cellKey(x, z), ch);
    for (const d of r.doors) if (d.isMain) main.add(cellKey(d.inside[0] + STEP[d.toward][0], d.inside[1] + STEP[d.toward][1]));
  });
  const isWallish = (x: number, z: number): boolean => {
    const w = walls.get(cellKey(x, z));
    return w !== undefined && w !== 'stairs' && w !== 'railing';
  };
  const rows: string[] = [];
  for (let z = minZ; z <= maxZ; z++) {
    let row = '';
    for (let x = minX; x <= maxX; x++) {
      const k = cellKey(x, z);
      const w = walls.get(k);
      if (w === 'door') row += main.has(k) ? 'H' : 'D';
      else if (w === 'window') row += 'F';
      else if (w === 'pillar') row += '+';
      else if (w === 'wall') row += isWallish(x - 1, z) && isWallish(x + 1, z) ? '-' : '|';
      else if (w === 'stairs') row += 'S';
      else if (w === 'railing') row += '#';
      else if (letters.has(k) && !slab.has(k)) row += 'o';
      else row += letters.get(k) ?? '.';
    }
    rows.push(row);
  }
  return rows.join('\n');
}
