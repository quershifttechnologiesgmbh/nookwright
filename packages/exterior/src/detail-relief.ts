/**
 * EXT2 (29.09.2026, plan/spikes/LV_tiefe_detail.md Hebel 3, 5 und 13): Wandrelief der Stufe `grand` – Tiefe und Schatten an
 * der Fassade statt glatter Flächen, dazu die bis dahin nicht verdrahteten Katalogteile `arcade_pier` und `window_frame_arch`:
 *  - Sockelabsatz: untere Stufe vor dem Sockelprofil der Hülle (dreistufiger Fuß, `plinthLedge`),
 *  - Wandpfeiler mit Kämpferstein an den Rasterpfosten des Erdgeschosses (`pilasters`, Schaft dehnt sich mit der Wandhöhe),
 *  - Blindbogenfenster an fensterlosen Wandfeldern (`blindArch`),
 *  - Regenfallrohr aus Kette neben den Hausecken der langen Seiten (`downspout`).
 *
 * Es gelten dieselben Regeln wie in `detail.ts`: nur freie Außenluft, nie vor Scheiben und im Laufweg, Halt an der Wand,
 * Spiegelpaare je Linie ganz oder gar nicht, deterministisch ohne Zufall. Ohne die Stufe `grand` wird nichts davon aufgerufen.
 */
import type { ShellAnchor } from '@mcda/blueprint';
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { OPP, step, type ExteriorSite, type Part } from './site.js';
import { GRAND_COMPONENTS, groundLines, type GrandKit } from './detail-grand.js';

/** Wand dahinter (Zelle der Wandebene) zu Zelle `p` vor der Linie. */
const solidBehind = (site: ExteriorSite, out: HorizontalDir, p: Vec3): boolean => site.solidWall(step(p, OPP[out]));

type Ground = ReturnType<typeof groundLines>;
type Line = Ground['lines'][number];

/** Sockelabsatz: eine Stufe zwei Zellen vor der Wandebene auf Höhe der Sockeltreppe, als Spiegelpaare je Linie. */
function planPlinthLedge(kit: GrandKit, g0: Ground): void {
  const { lines, lowest, front } = g0;
  for (const g of lines) {
    const us = Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from + i);
    for (const pair of kit.mirrorPairs(us, g.from, g.to)) {
      const parts = pair.map((u): Part => ({ componentId: GRAND_COMPONENTS.plinthLedge, facing: g.out, at: step(front(g.out, g.plane, u, lowest), g.out) }));
      // dahinter muss das Sockelprofil der Hülle stehen (kein Absatz im Leeren)
      kit.commit('plinth', g.floorIndex, parts, () => parts.every((p) => kit.backed(p.at, g.out)));
    }
  }
}

/** Anzahl geschlossener Wandzeilen ab Höhe `y0` hinter der Linie in Spalte `u` (höchstens `cap`). */
function wallRows(site: ExteriorSite, g: Line, front: Ground['front'], u: number, y0: number, cap: number): number {
  let n = 0;
  while (n < cap && solidBehind(site, g.out, front(g.out, g.plane, u, y0 + n))) n++;
  return n;
}

/** Ist die Spalte `u` vor der Linie über `rows` Zeilen ab `y0` frei (Außenluft, nichts gesetzt, kein Laufweg oder Blick)? */
function freeColumn(site: ExteriorSite, g: Line, front: Ground['front'], u: number, y0: number, rows: number): boolean {
  for (let h = 0; h < rows; h++) {
    const p = front(g.out, g.plane, u, y0 + h);
    if (!site.outside(p) || site.isTaken(p) || site.overRoof(p) || site.reservation(p) !== undefined) return false;
  }
  return true;
}

/** Steht an dieser Linie schon ein Bauteil, das `re` trifft (Zelle in der ersten Reihe vor der Wand)? */
function lineHas(site: ExteriorSite, g: Line, front: Ground['front'], y: number, re: RegExp): boolean {
  for (const pl of site.placements) {
    if (!re.test(pl.componentId)) continue;
    for (const c of pl.cells) {
      for (let u = g.from; u <= g.to; u++) {
        const f = front(g.out, g.plane, u, c[1]);
        if (f[0] === c[0] && f[2] === c[2] && c[1] >= y) return true;
      }
    }
  }
  return false;
}

/**
 * Wählt Spiegelpaare (bzw. die Mittelspalte) aus den Kandidaten von außen nach innen mit Mindestabstand `gap` und höchstens
 * `max` Paaren; `place` setzt ein Paar (leere Liste = ging nicht).
 */
function pairsOutsideIn(kit: GrandKit, cand: readonly number[], a: number, b: number, gap: number, max: number, place: (pair: number[]) => boolean): void {
  const pairs = kit.mirrorPairs(cand, a, b).sort((p, q) => Math.min(...p) - Math.min(...q));
  const used: number[] = [];
  let n = 0;
  for (const pair of pairs) {
    if (n >= max) break;
    if (pair.some((u) => used.some((x) => Math.abs(x - u) < gap))) continue;
    if (place(pair)) {
      used.push(...pair);
      n++;
    }
  }
}

/**
 * Wandpfeiler (`arcade_pier`): Steinpfeiler mit Kämpferstein eine Zelle vor der Wand des Erdgeschosses, so hoch wie die
 * geschlossene Wand (3–8), als Spiegelpaare von den Ecken nach innen (mindestens 3 Spalten von der Ecke, Abstand 5).
 * Nicht an Linien mit Strebepfeilern.
 */
function planPilasters(kit: GrandKit, g0: Ground): void {
  const { site } = kit;
  const { lines, lowest, front } = g0;
  for (const g of lines) {
    if (g.to - g.from < 8 || lineHas(site, g, front, lowest + 1, /exterior\/buttress$/)) continue;
    const cand: number[] = [];
    for (let u = g.from + 3; u <= g.to - 3; u++) if (wallRows(site, g, front, u, lowest + 1, 3) >= 3 && freeColumn(site, g, front, u, lowest + 1, 3)) cand.push(u);
    pairsOutsideIn(kit, cand, g.from, g.to, 5, 2, (pair) => {
      const h = Math.min(...pair.map((u) => wallRows(site, g, front, u, lowest + 1, 8)));
      for (let hh = h; hh >= 3; hh--) {
        if (!pair.every((u) => freeColumn(site, g, front, u, lowest + 1, hh))) continue;
        const parts = pair.map((u): Part => ({
          componentId: GRAND_COMPONENTS.pilasters, ...(hh > 3 ? { stretch: hh - 3 } : {}), facing: g.out, at: front(g.out, g.plane, u, lowest + 1),
        }));
        if (kit.commit('plinth', g.floorIndex, parts).length > 0) return true;
      }
      return false;
    });
  }
}

/**
 * Blindfenster (`window_frame_arch`, 3 breit, 3 hoch, Füllung = Klappe an der Wand) auf fensterlosen Wandfeldern des
 * Erdgeschosses: Mittelspalte mit geschlossener Wand und freien Zellen zu beiden Seiten; als Paare von der Mitte aus, höchstens
 * ein Paar (oder das Mittelstück) je Linie.
 */
function planBlindArches(kit: GrandKit, g0: Ground): void {
  const { site } = kit;
  const { lines, lowest, front } = g0;
  for (const g of lines) {
    if (g.to - g.from < 6) continue;
    const cand: number[] = [];
    for (let u = g.from + 2; u <= g.to - 2; u++) {
      if ([u - 1, u, u + 1].every((x) => wallRows(site, g, front, x, lowest + 1, 3) >= 3 && freeColumn(site, g, front, x, lowest + 1, 3))) cand.push(u);
    }
    const mid = (g.from + g.to) / 2;
    const pairs = kit.mirrorPairs(cand, g.from, g.to).sort((p, q) => Math.abs(Math.min(...p) - mid) - Math.abs(Math.min(...q) - mid));
    for (const pair of pairs) {
      if (pair.length === 2 && Math.abs(pair[0]! - pair[1]!) < 4) continue;
      const parts = pair.map((u): Part => ({ componentId: GRAND_COMPONENTS.blindArch, facing: g.out, local: [1, 0, 0], at: front(g.out, g.plane, u, lowest + 1) }));
      if (kit.commit('plinth', g.floorIndex, parts).length > 0) break;
    }
  }
}

/**
 * Regenfallrohr: je Linie ein Kettenpaar nahe den Ecken, von der Sockeltreppe bis unter die Traufe (freie Höhe vor
 * geschlossener Wand, mindestens 3).
 */
function planDownspouts(kit: GrandKit, g0: Ground): void {
  const { site } = kit;
  const { lines, lowest, front } = g0;
  for (const g of lines.slice(0, 2)) {
    if (g.to - g.from < 6) continue;
    for (const inset of [1, 2]) {
      const pair = [g.from + inset, g.to - inset];
      const n = Math.min(...pair.map((u) => {
        let k = 0;
        while (k < 12) {
          const p = front(g.out, g.plane, u, lowest + 1 + k);
          if (!site.outside(p) || site.isTaken(p) || site.overRoof(p) || !solidBehind(site, g.out, p)) break;
          k++;
        }
        return k;
      }));
      if (n < 3) continue;
      const parts = pair.map((u): Part => ({ componentId: GRAND_COMPONENTS.downspout, stretch: n - 1, facing: g.out, at: front(g.out, g.plane, u, lowest + 1) }));
      if (kit.commit('plinth', g.floorIndex, parts).length > 0) break;
    }
  }
}

/** Wandrelief am Fuß der Fassade (nach Strebepfeilern und Bauernhof-Details, damit deren Plätze frei bleiben). */
export function planReliefGround(kit: GrandKit, mainDoors: readonly ShellAnchor[]): void {
  const g0 = groundLines(kit.site, mainDoors);
  if (kit.act('pilasters')) planPilasters(kit, g0);
  if (kit.act('blindArch')) planBlindArches(kit, g0);
  if (kit.act('downspout')) planDownspouts(kit, g0);
  if (kit.act('plinthLedge')) planPlinthLedge(kit, g0);
}
