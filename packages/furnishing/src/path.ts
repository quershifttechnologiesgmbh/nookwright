import { CellSet, HORIZONTAL, cellKey, type Cell, type HorizontalDir } from '@mcda/core';
import type { RoomAnalysis } from './analyze.js';
import { neighbor } from './geometry.js';

/**
 * Hauptweg eines Raums (W2, Baustandard I6 „Funktion vor Menge“: Hauptweg 2 breit frei). Von der Haupttür zu jeder
 * anderen Tür bzw. Treppe – bei nur einer Tür bis in die Raummitte – läuft ein 2 Zellen breiter Weg, auf dem in
 * Laufhöhe nur Durchlaufbares steht (harte Regel in `rules.ts`, wie der Mittelgang). Der Weg meidet die Wandzone
 * (dort stehen die Möbel) und nimmt bei gleicher Länge die Seite mit mehr Wandabstand. Rein und deterministisch.
 *
 * Kein Weg in schmalen Räumen (kurze Seite < `PATH_MIN_SIDE`) und Kammern (< `PATH_MIN_AREA` Zellen): dort ist der
 * ganze Raum Durchgang. Passt ein Pflichtobjekt mit Weg nicht, richtet der Solver ohne Weg ein (`furnishRoom`).
 */
export const PATH_MIN_SIDE = 4;
export const PATH_MIN_AREA = 16;

/**
 * Wegführung: `open` = Standard (Weg meidet die Wandzone, zweite Spur zur Seite mit mehr Wandabstand, durch die
 * Raummitte). W5 (27.09.2026, Review N6): `spare` = der Weg schont die festen Wände – er läuft bevorzugt an offenen
 * Kanten (Treppe, Tür, Fenster), dann durch die Mitte, feste Wände meidet er; die zweite Spur geht zur Seite mit weniger
 * festen Wänden, je Schritt als ganzes 2 × 2-Feld. So
 * läuft der Weg an der Treppe entlang und lässt die Wände für Herd, Zeile und Regale frei. Der Solver versucht `spare`,
 * wenn mit `open` ein Pflichtobjekt nicht passt, bevor er den Weg ganz aufgibt.
 */
export type PathLane = 'open' | 'spare';

export function planPath(a: RoomAnalysis, lane: PathLane = 'open'): CellSet | undefined {
  const g = a.geometry;
  const cells = g.interior.toArray().filter(([x, z]) => !a.blocked.has(x, z));
  const b = g.interior.bounds();
  if (b === undefined || cells.length < PATH_MIN_AREA) return undefined;
  if (Math.min(b.maxX - b.minX + 1, b.maxZ - b.minZ + 1) < PATH_MIN_SIDE) return undefined;
  // W7: die Insel (Küchentisch in der Mitte) ist kein Weg – der Weg führt außen herum und endet an ihrem Rand
  const isle = a.island?.cells;
  const inside = new Set(cells.filter(([x, z]) => isle?.has(x, z) !== true).map(([x, z]) => cellKey(x, z)));
  const doors = g.doors.filter((d) => inside.has(cellKey(d.inside[0], d.inside[1])));
  if (doors.length === 0) return undefined;
  const main = doors.find((d) => d.isMain) ?? doors[0]!;
  const dWall = (c: Cell): number => a.dWall.get(cellKey(c[0], c[1])) ?? 0;
  const solid = (c: Cell): number => a.info.get(cellKey(c[0], c[1]))?.solidWalls.length ?? 0;
  // `spare`: an einer offenen Kante (Treppe, Tür, Fenster) am billigsten, in der Mitte mittel, an fester Wand teuer
  const edge = (c: Cell): boolean => (a.info.get(cellKey(c[0], c[1]))?.walls.length ?? 0) > 0;
  const cost = (c: Cell): number => (lane === 'spare' ? (solid(c) > 0 ? 4 : edge(c) ? 1 : 2) : dWall(c) === 0 ? 4 : 1);

  // Dijkstra von der Haupttür (Kosten klein und ganzzahlig: Eimer-Warteschlange); Gleichstand: feste Richtungsfolge
  const dist = new Map<string, number>();
  const prev = new Map<string, Cell>();
  const buckets: Cell[][] = [];
  const start = main.inside;
  dist.set(cellKey(start[0], start[1]), 0);
  buckets[0] = [start];
  for (let d = 0; d < buckets.length; d++) {
    for (const c of buckets[d] ?? []) {
      if (dist.get(cellKey(c[0], c[1])) !== d) continue;
      for (const dir of HORIZONTAL) {
        const n = neighbor(c, dir);
        const k = cellKey(n[0], n[1]);
        if (!inside.has(k)) continue;
        const nd = d + cost(n);
        if (nd >= (dist.get(k) ?? Infinity)) continue;
        dist.set(k, nd);
        prev.set(k, c);
        (buckets[nd] ??= []).push(n);
      }
    }
  }
  const targets: Cell[] = doors.filter((d) => d !== main).map((d) => d.inside);
  if (targets.length === 0 && isle !== undefined) {
    // W7 (Insel): eine Tür – bis an den Rand der Insel (die nächste Randzelle zur Tür, bei Gleichstand die mit dem
    // größeren Wandabstand), nicht durch die Raummitte
    let best: Cell | undefined;
    const rim = (c: Cell): boolean => HORIZONTAL.some((d) => {
      const n = neighbor(c, d);
      return isle.has(n[0], n[1]);
    });
    const dd = (c: Cell): number => dist.get(cellKey(c[0], c[1])) ?? Infinity;
    for (const c of cells) {
      if (!inside.has(cellKey(c[0], c[1])) || !rim(c) || !Number.isFinite(dd(c))) continue;
      if (best === undefined || dd(c) < dd(best) || (dd(c) === dd(best) && dWall(c) > dWall(best))) best = c;
    }
    if (best !== undefined) targets.push(best);
  }
  if (targets.length === 0) {
    // eine Tür: bis zur Zelle mit dem größten Wandabstand (Raummitte), bei Gleichstand die nächste zur Tür
    let best: Cell | undefined;
    for (const c of cells) {
      if (best === undefined || dWall(c) > dWall(best) || (dWall(c) === dWall(best) && (dist.get(cellKey(c[0], c[1])) ?? Infinity) < (dist.get(cellKey(best[0], best[1])) ?? Infinity))) best = c;
    }
    if (best !== undefined) targets.push(best);
  }
  const path = new Map<string, Cell>();
  const add = (c: Cell): void => {
    const k = cellKey(c[0], c[1]);
    if (inside.has(k)) path.set(k, c);
  };
  for (const t of targets) {
    const line: Cell[] = [];
    for (let c: Cell | undefined = t; c !== undefined; c = prev.get(cellKey(c[0], c[1]))) {
      line.push(c);
      if (line.length > cells.length) break;
    }
    if (!dist.has(cellKey(t[0], t[1]))) continue;
    if (lane === 'open') {
      for (let i = 0; i < line.length; i++) {
        const c = line[i]!;
        add(c);
        const next = line[i + 1] ?? line[i - 1];
        if (next === undefined) continue;
        // zweite Spur: quer zur Laufrichtung auf die Seite mit mehr Wandabstand
        const along: HorizontalDir = next[0] !== c[0] ? 'east' : 'south';
        const sides: HorizontalDir[] = along === 'east' ? ['north', 'south'] : ['west', 'east'];
        const opts = sides.map((s) => neighbor(c, s)).filter((n) => inside.has(cellKey(n[0], n[1])));
        if (opts.length === 0) continue;
        add(opts.reduce((p, q) => (dWall(q) > dWall(p) ? q : p)));
      }
      continue;
    }
    add(line[0]!);
    for (let i = 0; i + 1 < line.length; i++) {
      const c = line[i]!;
      const next = line[i + 1]!;
      add(next);
      // W5 (27.09.2026, Review N6) `spare`: je Schritt ein ganzes 2 × 2-Feld (beide Zellen des Schritts und ihre Nachbarn
      // auf derselben Seite) – bei `open` wählt jede Zelle ihre Seite einzeln, an Knicken liegt der Weg dann nur versetzt
      // 2 breit. Seite: weniger feste Wände, dann mehr Wandabstand; passt kein ganzes Feld, eine Nachbarzelle
      const along: HorizontalDir = next[0] !== c[0] ? 'east' : 'south';
      const sides: HorizontalDir[] = along === 'east' ? ['north', 'south'] : ['west', 'east'];
      const pairs = sides.map((s) => [neighbor(c, s), neighbor(next, s)] as const).filter(([p, q]) => inside.has(cellKey(p[0], p[1])) && inside.has(cellKey(q[0], q[1])));
      const better = (p: readonly [Cell, Cell], q: readonly [Cell, Cell]): boolean => {
        const sp = solid(p[0]) + solid(p[1]);
        const sq = solid(q[0]) + solid(q[1]);
        if (sp !== sq) return sq < sp;
        return dWall(q[0]) + dWall(q[1]) > dWall(p[0]) + dWall(p[1]);
      };
      if (pairs.length > 0) {
        const best = pairs.reduce((p, q) => (better(p, q) ? q : p));
        add(best[0]);
        add(best[1]);
        continue;
      }
      const opts = sides.map((s) => neighbor(c, s)).filter((n) => inside.has(cellKey(n[0], n[1])));
      if (opts.length > 0) add(opts.reduce((p, q) => (solid(q) !== solid(p) ? solid(q) < solid(p) : dWall(q) > dWall(p)) ? q : p));
    }
  }
  return path.size === 0 ? undefined : CellSet.of([...path.values()]);
}

/** W7: Grundfläche einer Insel-Form in Weltlage (x-Ausdehnung, z-Ausdehnung). */
export interface IslandForm {
  readonly sx: number;
  readonly sz: number;
}

/**
 * W7 (27.09.2026, Küchentisch in der Mitte, Vorbilder 10/17): mittige Insel für die erste Form, die passt – quer zu
 * jeder Wand bleiben mindestens `ISLAND_MARGIN` Zellen (Wandmöbel + Weg), die Insel liegt ganz im Raum (nicht gesperrt,
 * nicht in der Türzone) und ringsum (8er-Nachbarschaft) liegt begehbarer Boden. `forms` in Wunsch-Reihenfolge; ohne
 * Weg (schmale Räume, Kammern) keine Insel. Rein und deterministisch.
 */
export const ISLAND_MARGIN = 2;

export function planIsland(a: RoomAnalysis, forms: readonly IslandForm[]): CellSet | undefined {
  const g = a.geometry;
  const b = g.interior.bounds();
  const area = g.interior.difference(a.blocked).size;
  if (b === undefined || area < PATH_MIN_AREA) return undefined;
  const wx = b.maxX - b.minX + 1;
  const wz = b.maxZ - b.minZ + 1;
  if (Math.min(wx, wz) < PATH_MIN_SIDE) return undefined;
  const free = (x: number, z: number): boolean => g.interior.has(x, z) && !a.blocked.has(x, z);
  for (const f of forms) {
    if (f.sx > wx - 2 * ISLAND_MARGIN || f.sz > wz - 2 * ISLAND_MARGIN) continue;
    const x0 = b.minX + Math.floor((wx - f.sx) / 2);
    const z0 = b.minZ + Math.floor((wz - f.sz) / 2);
    let ok = true;
    for (let x = x0 - 1; ok && x <= x0 + f.sx; x++) {
      for (let z = z0 - 1; ok && z <= z0 + f.sz; z++) {
        const core = x >= x0 && x < x0 + f.sx && z >= z0 && z < z0 + f.sz;
        if (!free(x, z) || (core && a.doorZone.has(x, z))) ok = false;
      }
    }
    if (ok) return CellSet.rect(x0, z0, x0 + f.sx - 1, z0 + f.sz - 1);
  }
  return undefined;
}
