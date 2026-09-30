/**
 * ASCII-Schnitt durch eine Hülle (Tests und Bericht RF): senkrechte Ebene x = const (Achse z nach rechts) bzw.
 * z = const (Achse x nach rechts), y nach oben. Legende wie research/18 §1.2:
 * `/` `\` Treppe (steigt nach rechts/links), `=` Treppe quer zum Schnitt, `v` umgedrehte Treppe, `_` Stufe unten,
 * `‾` Stufe oben, `#` Dachblock, `W` Wand, `C` Decke, `F` Boden, `g` Glas, `o` Fensterrahmen, `.` Luft,
 * `L` Laterne des Dachraum-Lichts (W4, `isAtticLight`).
 * Kleinbuchstaben-Variante für `roof_trim`: `t` statt `#`, Treppen/Stufen bleiben (Rolle über `trimAt`).
 */
import type { HorizontalDir } from '@mcda/core';
import type { Shell, ShellCell } from '../../src/shell/types.js';

export function renderSection(shell: Pick<Shell, 'cells'>, plane: { readonly x: number } | { readonly z: number }): string {
  const alongZ = 'x' in plane;
  const fixed = alongZ ? plane.x : plane.z;
  const cut = shell.cells.filter((c) => (alongZ ? c.pos[0] : c.pos[2]) === fixed);
  if (cut.length === 0) return '';
  const u = (c: ShellCell): number => (alongZ ? c.pos[2] : c.pos[0]);
  const u0 = Math.min(...cut.map(u));
  const u1 = Math.max(...cut.map(u));
  const y0 = Math.min(...cut.map((c) => c.pos[1]));
  const y1 = Math.max(...cut.map((c) => c.pos[1]));
  const at = new Map(cut.map((c) => [`${u(c)},${c.pos[1]}`, c] as const));
  const right: HorizontalDir = alongZ ? 'south' : 'east';
  const left: HorizontalDir = alongZ ? 'north' : 'west';
  const glyph = (c: ShellCell): string => {
    if (c.kind === 'window') return c.shape === 'pane' ? 'g' : 'o';
    if (c.kind === 'wall' || c.kind === 'pillar' || c.kind === 'door' || c.kind === 'lintel') return 'W';
    if (c.kind === 'ceiling') return c.shape === 'lantern' ? 'L' : 'C';
    if (c.kind === 'floor') return 'F';
    if (c.shape === 'stairs') {
      if (c.orient?.half === 'top') return 'v';
      return c.orient?.facing === right ? '/' : c.orient?.facing === left ? '\\' : '=';
    }
    if (c.shape === 'slab') return c.orient?.half === 'top' ? '‾' : '_';
    return c.role === 'roof_trim' ? 't' : '#';
  };
  const rows: string[] = [];
  for (let y = y1; y >= y0; y--) {
    let r = '';
    for (let v = u0; v <= u1; v++) {
      const c = at.get(`${v},${y}`);
      r += c === undefined ? '.' : glyph(c);
    }
    rows.push(r);
  }
  return rows.join('\n');
}
