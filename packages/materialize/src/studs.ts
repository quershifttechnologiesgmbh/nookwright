/**
 * W7-A (27.09.2026, plan/spikes/W7A_ruhe.md; nach W7-C „ganze Gefache statt Putzstreifen“): Fachwerk-Bauteile der
 * Außenwand, wie die Materialisierung sie setzt. Seit `mergeStrips` (timber.ts) trägt nicht mehr jeder Rasterpfosten
 * einen Ständer – Traufkonsolen und Pfosten-Laternen sollen aber nur dort hängen, wo in der Wand ein Ständer steht.
 * Die Hülle kennt das Fachwerk nicht (es ist eine Flächen-Regel des Themes); diese Funktion fragt dieselbe Regel und
 * denselben Feldplan, die auch die Wand-Ausgabe nutzt – eine Quelle für Hülle, Außen-Deko und Blöcke.
 *
 * Rein und deterministisch; ohne Fachwerk-Wandregel im Theme `undefined` (dann bleibt alles wie bisher).
 */
import type { Shell } from '@mcda/blueprint';
import type { ResolvedTheme } from '@mcda/catalog';
import { key3 } from '@mcda/core';
import { shellContext } from './context.js';
import { wallRuleOf } from './surfaces.js';
import { timberPart, type TimberPart } from './timber.js';

const WALLISH: ReadonlySet<string> = new Set(['wall', 'pillar', 'door', 'window', 'lintel']);

/**
 * Bauteil (`post`, `rail`, `brace`, `infill`) je Außenwandzelle (Wand, Pfeiler) mit Fachwerk-Regel, Schlüssel `key3`
 * der Zellposition. Zellen ohne Fachwerk (Steingeschoss, Themes ohne Fachwerk) fehlen in der Tabelle.
 * @param roomTypes Raum-ID → Raumtyp-ID (für `when.roomTypes` der Wandregeln), wie bei der Materialisierung.
 */
export function timberWallParts(shell: Shell, theme: ResolvedTheme, roomTypes: Readonly<Record<string, string>> = {}): ReadonlyMap<string, TimberPart> | undefined {
  if (!(theme.surfaces.wall ?? []).some((r) => r.timber !== undefined)) return undefined;
  // Nur die wandartigen Zellen: Wandlinien, Öffnungen, Laufrichtung und Geschosslage hängen allein an ihnen und an den
  // Räumen (Dach, Böden und Decken bestimmen nur Verläufe und Rauschen) – ein Viertel der Arbeit, gleiche Bauteile
  // (Test `studs.test.ts`: gleich wie mit allen Zellen)
  const walls: Shell = { ...shell, cells: shell.cells.filter((c) => WALLISH.has(c.kind)) };
  const contexts = shellContext(walls, roomTypes);
  const out = new Map<string, TimberPart>();
  walls.cells.forEach((cell, i) => {
    if (cell.kind !== 'wall' && cell.kind !== 'pillar') return;
    const ctx = contexts[i]!;
    if (!ctx.exterior) return;
    const rule = wallRuleOf(theme, ctx);
    if (rule?.timber === undefined) return;
    out.set(key3(cell.pos), timberPart(rule.timber, cell, ctx, 0));
  });
  return out;
}
