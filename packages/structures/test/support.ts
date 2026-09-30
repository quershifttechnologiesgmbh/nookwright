import type { ShellCell } from '@mcda/blueprint';
import type { Vec3 } from '@mcda/core';
import { reachableStands, standKey, type HeightField, type StructuresResult } from '../src/index.js';

export const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

export function cellMap(cells: readonly ShellCell[]): Map<string, ShellCell> {
  return new Map(cells.map((c) => [key(...c.pos), c]));
}

/** Anteil der Standplätze, die von `start` aus erreichbar sind (1 = alle). */
export function reachShare(res: StructuresResult, ground: HeightField, starts: readonly Vec3[], targets: readonly Vec3[]): number {
  const seen = reachableStands(res.cells, ground, starts);
  return targets.length === 0 ? 0 : targets.filter((p) => seen.has(standKey(p))).length / targets.length;
}

/** Stabile Serialisierung (Determinismus-Vergleich). */
export const dump = (res: StructuresResult): string => JSON.stringify(res.cells);

/** Draufsicht einer Ebene (Debug): Treppe ^>v<, Tür D, Fenster w, Stamm |, Sockel #, Dach r, sonst o. */
export function plan(cells: readonly ShellCell[], y: number, x0: number, x1: number, z0: number, z1: number): string {
  const m = cellMap(cells);
  const rows: string[] = [];
  for (let z = z0; z <= z1; z++) {
    let row = '';
    for (let x = x0; x <= x1; x++) {
      const c = m.get(key(x, y, z));
      const f = c?.orient?.facing;
      row += c === undefined ? '.'
        : c.shape === 'stairs' ? (c.orient?.half === 'top' ? 'T' : f === 'north' ? '^' : f === 'south' ? 'v' : f === 'east' ? '>' : '<')
          : c.shape === 'door' ? 'D' : c.shape === 'pane' ? 'w' : c.shape === 'log' ? '|' : c.role === 'foundation' ? '#' : c.role === 'roof_main' ? 'r' : 'o';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

/**
 * Glyph einer Zelle in der Notation von research/18 §1.2 (Schnitt entlang `axis`): Treppe steigt nach rechts
 * `/`, nach links `\`, quer `^`, umgedreht `v`; Stufe unten `_`, oben `‾`; Zaun f, Laterne L (hängend Y), Kette `:`,
 * Blitzableiter/Endstab `!`, Glocke B, Tür D, Scheibe g, Segel s, Stamm senkrecht `|`, waagerecht `-`, Zauntor t,
 * Laub b, sonst `#`, Luft `.`.
 */
export function glyph(c: ShellCell | undefined, axis: 'x' | 'z' = 'x'): string {
  if (c === undefined) return '.';
  const o = c.orient;
  switch (c.shape) {
    case 'stairs': {
      if (o?.half === 'top') return 'v';
      const f = o?.facing;
      const right = axis === 'x' ? 'east' : 'south';
      const left = axis === 'x' ? 'west' : 'north';
      return f === right ? '/' : f === left ? '\\' : '^';
    }
    case 'slab': return o?.half === 'top' ? '‾' : '_';
    case 'fence': return 'f';
    case 'fence_gate': return 't';
    case 'lantern': return o?.hanging === true ? 'Y' : 'L';
    case 'chain': return ':';
    case 'lightning_rod':
    case 'end_rod': return '!';
    case 'bell': return 'B';
    case 'door': return 'D';
    case 'pane': return 'g';
    case 'log': return o?.axis === 'y' ? '|' : '-';
    default: return c.role === 'sail' ? 's' : c.role === 'leaves_bush' ? 'b' : '#';
  }
}

/** Senkrechter Schnitt (oben zuerst): entlang x bei festem z (bzw. entlang z bei festem x). */
export function section(cells: readonly ShellCell[], axis: 'x' | 'z', fixed: number, a0: number, a1: number, y0: number, y1: number): string {
  const m = cellMap(cells);
  const rows: string[] = [];
  for (let y = y1; y >= y0; y--) {
    let row = '';
    for (let a = a0; a <= a1; a++) row += glyph(m.get(axis === 'x' ? key(a, y, fixed) : key(fixed, y, a)), axis);
    rows.push(row);
  }
  return rows.join('\n');
}
