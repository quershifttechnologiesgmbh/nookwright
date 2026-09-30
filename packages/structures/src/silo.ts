/**
 * W12-C (Review R6-4 „Silo fehlt“, plan/spikes/W12C_bauernhof_details.md): runder Hochsilo neben der Scheune.
 *
 * Vorbilder: Turmsilo mit Kuppel neben roter Scheune (en.wikipedia.org/wiki/Silo: Tower silo aus Stein/Beton-Dauben,
 * Kuppel- oder Kegeldach), Minecraft-Tutorials „Barn & Silo“ (YouTube xcMV0TYs9sM, beuGCF7sJtw, KGVsT-LFRGs: Silo
 * direkt an der Scheune, Ø 5–7, deutlich höher als die Scheune), Community-Vorbild ref1 (reddit 1p5rck5).
 *
 *   Aufriss (r = 3, Ø 7)                  Regeln
 *          ¦          Blitzableiter        - Grundriss = Kreisscheibe (`inFootprint('round', r)`): spiegelsymmetrisch in x
 *          ▄          Stufe                  und z, keine Drehrichtung (Projektregel gegen Windräder).
 *        ◢███◣        Kuppel (Dachtreppen) - Mantel = Randzellen der Scheibe (Rolle `silo`), Innen voll Heu (`hay`):
 *      ◢███████◣                             keine Luft, kein Dunkel, keine Spawnfläche; alles steht auf Vollblöcken.
 *      ▓▓▓▓▓▓▓▓▓      Kranz (`trim_light`)  - Reifen alle 4 Reihen (`silo_band`, W16-B) und der oberste Kranz in der hellen
 *      ▒▒▒▒▒▒▒▒▒      Mantel `silo`           Kantenrolle (Bezug zum weißen Rahmen der Scheune).
 *      ▓▓▓▓▓▓▓▓▓      Reifen               - Kuppel: je Ring eine Reihe Dachtreppen (Rücken zur Mitte), innen volle Blöcke,
 *      ▒▒▒▒▒▒▒▒▒                             auf der Diagonalen volle Blöcke (keine Eckform-Mehrdeutigkeit), oben Stufe +
 *      ████████       Sockel `foundation`     Blitzableiter. Sockel 2 Reihen, darunter bis aufs Gelände aufgefüllt.
 */
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { B, PRIO, stair, type Block, type Site } from './canvas.js';
import { footprintOffsets, inFootprint } from './geometry.js';
import { towerBaseY } from './tower.js';
import type { SiloSpec } from './types.js';

/** Standardmaße: Radius 3 (Ø 7), Mantelhöhe 16. */
export const SILO_DEFAULTS = { radius: 3, height: 16 } as const;

const SILO: Block = { role: 'silo', shape: 'block' };
const HAY: Block = { role: 'hay', shape: 'block' };
// W16-B (Review R7-2 „Silo schematisch gestreift“): Reifen in eigener Rolle `silo_band` (Rückfall `trim_light`) – im
// Standard-Theme ein heller Stein statt weißer Bretter, der Kranz oben bleibt hell; Kuppel im Scheunendach `roof_barn`
// (Rückfall `roof_main`), damit Silo und Scheune ein Dach lesen
const HOOP: Block = { role: 'silo_band', shape: 'block' };
const CROWN: Block = { role: 'trim_light', shape: 'block' };
const DOME: Block = { role: 'roof_barn', shape: 'block' };
const DOME_SLAB: Block = { role: 'roof_barn', shape: 'slab', orient: { half: 'bottom' } };

/** Richtung von (dx, dz) zur Mitte; auf der Diagonalen keine (voller Block). */
function toCenter(dx: number, dz: number): HorizontalDir | undefined {
  if (Math.abs(dx) === Math.abs(dz)) return undefined;
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'west' : 'east') : dz > 0 ? 'north' : 'south';
}

export function buildSiloOn(site: Site, spec: SiloSpec, index: number): void {
  const id = `${site.prefix}:${spec.id ?? `silo${index}`}`;
  const r = Math.max(2, Math.min(4, Math.round(spec.radius ?? SILO_DEFAULTS.radius)));
  const h = Math.max(8, Math.min(24, Math.round(spec.height ?? SILO_DEFAULTS.height)));
  const [cx, cz] = spec.center;
  const offs = footprintOffsets('round', r);
  const baseY = towerBaseY(site, spec.center, 'round', r);
  const topY = baseY + h - 1;
  const at = (dx: number, y: number, dz: number): Vec3 => [cx + dx, y, cz + dz];
  const put = (dx: number, y: number, dz: number, b: Block): void => {
    site.canvas.put(at(dx, y, dz), b, id, PRIO.tower);
  };
  const rim = (rr: number, dx: number, dz: number): boolean =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oz]) => !inFootprint('round', rr, dx + ox!, dz + oz!));
  for (const [dx, dz] of offs) {
    site.block(cx + dx, cz + dz);
    // Auffüllung bis aufs Gelände, Sockel 2 Reihen
    for (let y = site.groundY(cx + dx, cz + dz) + 1; y < baseY; y++) put(dx, y, dz, B.base);
    const outer = rim(r, dx, dz);
    for (let y = baseY; y <= topY; y++) {
      const k = y - baseY;
      if (k < 2) put(dx, y, dz, outer ? B.base : HAY);
      else if (!outer) put(dx, y, dz, HAY);
      else put(dx, y, dz, y === topY ? CROWN : k >= 4 && k % 4 === 0 && y < topY - 1 ? HOOP : SILO);
    }
  }
  // Kuppel: Ring rr = r … 1 je eine Reihe höher, oben Stufe + Blitzableiter
  for (let rr = r; rr >= 1; rr--) {
    const y = topY + 1 + (r - rr);
    for (const [dx, dz] of footprintOffsets('round', rr)) {
      const f = rim(rr, dx, dz) ? toCenter(dx, dz) : undefined;
      put(dx, y, dz, f === undefined ? DOME : stair('roof_barn', f));
    }
  }
  const capY = topY + r + 1;
  put(0, capY, 0, DOME_SLAB);
  put(0, capY + 1, 0, B.rod);
}
