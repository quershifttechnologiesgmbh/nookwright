/**
 * W5-B Testhilfe: Zellen der Fensterrahmen (Bank- und Sturzreihe vor jeder Scheibe, Spalten −1 … span, dazu die
 * Fokus-Verdachung eine Reihe darüber). Seit `FacadeStyle.frameRole: 'wall_cornice'` (Burg, Wachturm) liegen die
 * Rahmen in derselben Rolle wie ein Gesims – Tests auf „kein Gesims je Etage“ lassen diese Zellen aus.
 */
import type { Shell, ShellCell } from '@mcda/blueprint';
import { key3, type HorizontalDir, type Vec3 } from '@mcda/core';

const STEP: Readonly<Record<HorizontalDir, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Schlüssel (`key3`) aller Rahmenzellen-Positionen der Hülle. */
export function frameKeys(shell: Shell): Set<string> {
  const kinds = new Map(shell.cells.map((c) => [key3(c.pos), c.kind] as const));
  const out = new Set<string>();
  for (const a of (shell.anchors ?? []).filter((x) => x.kind === 'window')) {
    const back: Vec3 = [a.pos[0] - STEP[a.facing][0], a.pos[1], a.pos[2] - STEP[a.facing][1]];
    let h = 0;
    while (kinds.get(key3([back[0], back[1] + h, back[2]])) === 'window') h++;
    const along: HorizontalDir = a.facing === 'north' || a.facing === 'south' ? 'east' : 'south';
    for (let j = -1; j <= (a.span ?? 1); j++) for (const dy of [-1, Math.max(1, h), Math.max(1, h) + 1]) {
      out.add(key3([a.pos[0] + STEP[along][0] * j, a.pos[1] + dy, a.pos[2] + STEP[along][1] * j]));
    }
  }
  return out;
}

/** Profilzellen in `wall_cornice` ohne die Fensterrahmen (= Gesims, Kranz). */
export function corniceCells(shell: Shell): ShellCell[] {
  const frames = frameKeys(shell);
  return shell.cells.filter((c) => c.kind === 'facade' && c.role === 'wall_cornice' && !frames.has(key3(c.pos)));
}
