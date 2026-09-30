/**
 * Treppenläufe (research/14 P4, Tiny Glade: „ein Weg den Hang hinauf wird zur Treppe“): Ein Lauf beginnt
 * oben bei `topY` und steigt Zelle für Zelle in Richtung `step` ab, bis er das Gelände erreicht. Jede Stufe
 * steht auf einer Füllung bis zum Gelände – nichts schwebt. Kopffreiheit über jeder Stufe wird reserviert.
 */
import { opposite, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import { PRIO, stair, type Site } from './canvas.js';
import { DIR_XZ } from './geometry.js';

export interface StairRun {
  readonly step: HorizontalDir;
  /** Stufen von oben nach unten (Position des Treppenblocks). */
  readonly steps: readonly Vec3[];
}

/**
 * Plant einen Lauf; `undefined`, wenn eine Spalte belegt ist oder das Gelände nach `maxLen` Stufen nicht
 * erreicht wird. Leerer Lauf = oben liegt bereits auf Geländehöhe. `ownStart`: die erste Spalte ist vom
 * Aufrufer selbst reserviert (Türvorplatz) und darf belegt sein.
 */
export function planStairRun(site: Site, start: Cell, step: HorizontalDir, topY: number, opts: { ownStart?: boolean; maxLen?: number } = {}): StairRun | undefined {
  const [dx, dz] = DIR_XZ[step];
  const steps: Vec3[] = [];
  for (let k = 0; k <= (opts.maxLen ?? 48); k++) {
    const x = start[0] + dx * k;
    const z = start[1] + dz * k;
    const y = topY - k;
    if (y <= site.groundY(x, z)) return { step, steps };
    if (site.isBlocked(x, z) && !(k === 0 && opts.ownStart === true)) return undefined;
    steps.push([x, y, z]);
  }
  return undefined;
}

/** Setzt einen geplanten Lauf: Treppe (steigt gegen `step` an), Füllung darunter, Kopffreiheit darüber. */
export function commitStairRun(site: Site, run: StairRun, role: string, owner: string): void {
  const facing = opposite(run.step) as HorizontalDir;
  for (const [x, y, z] of run.steps) {
    site.canvas.put([x, y, z], stair(role, facing), owner, PRIO.stairs);
    for (let f = site.groundY(x, z) + 1; f < y; f++) site.canvas.put([x, f, z], { role, shape: 'block' }, owner, PRIO.stairs);
    site.canvas.reserve([x, y + 1, z], owner);
    site.canvas.reserve([x, y + 2, z], owner);
    site.block(x, z);
  }
}
