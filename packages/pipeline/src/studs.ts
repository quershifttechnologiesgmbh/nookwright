/**
 * W7-A (27.09.2026, plan/spikes/W7A_ruhe.md; Koordinator nach dem Merge von W7-C): Fachwerk-Ständer an der Hülle.
 *
 * Das Fachwerk (`@mcda/materialize` timber.ts, Regel „Gefach ≥ 2“) legt Felder zusammen und nimmt dabei Rasterpfosten
 * weg. Hülle (Traufkonsolen, `FacadeStyle.brackets`) und Außen-Deko (Traufkonsolen, Pfosten-Laternen) setzten ihre Teile
 * weiter an jeden Rasterpfosten – an der Fachwerk-Taverne hingen so je Seite zwei Konsolen über einem Putzfeld.
 * `withTimberStuds` fragt die Materialisierung, wo in der Wand ein Ständer steht (`timberWallParts`), und
 *  - schreibt diese Pfosten je Rasterlinie als `FacadeGridLine.studs` in die Hülle (Leseport für die Außen-Deko);
 *  - nimmt Traufkonsolen der Hülle (`beam`, obere Treppe) weg, hinter denen die Fachwerkwand keinen Ständer hat.
 * Ohne Fachwerk-Wandregel im Theme bleibt die Hülle dasselbe Objekt (bitgleich). Gemeinsame Regel für App und Engine
 * (beide rufen `shellFor`).
 */
import type { FacadeGridLine, Shell, ShellCell } from '@mcda/blueprint';
import type { ResolvedTheme } from '@mcda/catalog';
import { key3, type Vec3 } from '@mcda/core';
import { timberWallParts } from '@mcda/materialize';

const STEP: Readonly<Record<string, readonly [number, number]>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

export function withTimberStuds(shell: Shell, theme: ResolvedTheme | undefined, roomTypes: Readonly<Record<string, string>> = {}): Shell {
  if (theme === undefined || shell.facadeGrid === undefined) return shell;
  const parts = timberWallParts(shell, theme, roomTypes);
  if (parts === undefined || parts.size === 0) return shell;
  /** Spalte einer Wand von `y0` aufwärts, solange Fachwerk: `undefined` = kein Fachwerk, sonst ob ein Ständer darin steht. */
  const column = (x: number, z: number, from: number, to: number): boolean | undefined => {
    let timber = false;
    for (let y = from; y <= to; y++) {
      const p = parts.get(key3([x, y, z]));
      if (p === undefined) continue;
      timber = true;
      if (p === 'post') return true;
    }
    return timber ? false : undefined;
  };
  const heightAt = (g: FacadeGridLine): number => Math.max(0, ...[...shell.rooms.values()].filter((r) => r.baseY === g.y0 + 1).map((r) => r.height));
  let changed = false;
  const facadeGrid = shell.facadeGrid.map((g): FacadeGridLine => {
    const ns = g.out === 'north' || g.out === 'south';
    const top = g.y0 + heightAt(g);
    const state = g.posts.map((p) => (ns ? column(p, g.plane, g.y0 + 1, top) : column(g.plane, p, g.y0 + 1, top)));
    // W9-G2 (27.09.2026, plan/spikes/W9G2_fensterrahmen.md): eine Linie ohne Rasterpfosten (schmale Giebelseite) ist
    // Fachwerk, wenn irgendeine ihrer Spalten Fachwerk trägt – `studs: []` sagt der Außen-Deko „hier rahmt das Fachwerk“
    // (vorher fehlte das Feld dort, die Fenster bekamen Rahmenwangen vor den Laibungsständern)
    if (g.posts.length === 0) {
      const cols = Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from + i);
      if (!cols.some((c) => (ns ? column(c, g.plane, g.y0 + 1, top) : column(g.plane, c, g.y0 + 1, top)) !== undefined)) return g;
      changed = true;
      return { ...g, studs: [] };
    }
    if (state.every((s) => s === undefined)) return g;
    changed = true;
    return { ...g, studs: g.posts.filter((_, i) => state[i] !== false) };
  });
  // Traufkonsolen der Hülle (Rücken zur Wand, obere Hälfte) vor einer Fachwerkspalte ohne Ständer; nicht der Kopf einer
  // Wandvorlage (Stamm darunter)
  const drop = (c: ShellCell): boolean => {
    if (c.kind !== 'facade' || c.role !== 'beam' || c.shape !== 'stairs' || c.orient?.half !== 'top' || c.orient.facing === undefined) return false;
    const below: Vec3 = [c.pos[0], c.pos[1] - 1, c.pos[2]];
    if (byPos.get(key3(below))?.shape === 'log') return false;
    const d = STEP[c.orient.facing]!;
    // Wandspalte dahinter von der Konsole abwärts: bis zu 2 Reihen ohne Fachwerk (Deckenreihe), dann die Fachwerkreihen
    // dieses Geschosses bis zur ersten Reihe ohne Fachwerk (Bodenplatte, Steingeschoss darunter)
    let y = c.pos[1];
    while (y > c.pos[1] - 3 && !parts.has(key3([c.pos[0] + d[0], y, c.pos[2] + d[1]]))) y--;
    let seen = false;
    for (; ; y--) {
      const p = parts.get(key3([c.pos[0] + d[0], y, c.pos[2] + d[1]]));
      if (p === undefined) break;
      seen = true;
      if (p === 'post') return false;
    }
    return seen;
  };
  const byPos = new Map<string, ShellCell>();
  for (const c of shell.cells) if (c.kind === 'facade') byPos.set(key3(c.pos), c);
  const cells = shell.cells.filter((c) => !drop(c));
  if (!changed && cells.length === shell.cells.length) return shell;
  return { ...shell, cells, facadeGrid };
}
