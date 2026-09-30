/**
 * Fenster (research/03 §C6): symmetrisch zentriert auf geraden Außenwandläufen ohne Tür, 1 Block breit.
 * Innenwände bekommen keine Fenster. Baut man an, wird die frühere Außenwand zur Innenwand und ihre
 * Fenster verschwinden von selbst (DA-Verhalten).
 *
 * Stil (`WindowStyle`): Abstand zwischen Fenstern, Randabstand, fensterfreie Mitte langer Wände. Der Standard
 * lässt zwischen zwei Fenstern mindestens 4 Wandzellen (Platz für breite Möbel, Katalog-Analyse K1) und hält
 * die Mitte von Läufen ab 14 Zellen fensterfrei.
 */
import { gridCell, type GridLine } from './bays.js';
import { STEP, type Frame } from './grid.js';
import type { WindowStyle } from './types.js';
import { FLOOR, WALL, WC, type WallPlan } from './walls.js';

export const DEFAULT_WINDOW_STYLE: Required<WindowStyle> = { enabled: true, spacing: 4, margin: 1, blankFrom: 14, blankWidth: 6 };

/**
 * „Fenster aus“: `enabled: false` oder ein Randabstand, der auf keiner Wand (Lauf < `longest`) ein Fenster zulässt – so
 * übergibt die App heute „aus“. Dann entfallen auch Giebel- und Gaubenfenster (W7, D4).
 */
export function windowsOff(style: WindowStyle, longest: number): boolean {
  return style.enabled === false || 2 * Math.max(0, Math.floor(style.margin ?? DEFAULT_WINDOW_STYLE.margin)) >= longest;
}

/**
 * Symmetrische Verteilung in einem Abschnitt der Länge `length` mit Randabstand `margin`: möglichst viele Fenster
 * mit Abstand `spacing` (für die exakte Symmetrie darf er um 1 wachsen). Geht keine Einzelverteilung auf
 * (gerade Restbreite), entsteht ein mittiges Doppelfenster.
 */
function evenSlots(length: number, margin: number, spacing: number): number[] {
  const avail = length - 2 * margin;
  if (avail <= 0) return [];
  for (let n = Math.floor((avail + spacing) / (1 + spacing)); n >= 1; n--) {
    for (const gap of n === 1 ? [spacing] : [spacing, spacing + 1]) {
      const span = n + (n - 1) * gap;
      if (span > avail || (avail - span) % 2 !== 0) continue;
      const start = margin + (avail - span) / 2;
      return Array.from({ length: n }, (_, i) => start + i * (1 + gap));
    }
  }
  if (avail >= 2) {
    const start = margin + (avail - 2) / 2;
    return [start, start + 1];
  }
  return [];
}

/**
 * Fensterpositionen (0-basiert) in einem Wandlauf der Länge `length`; immer spiegelsymmetrisch.
 * Die Zahlen-Parameter bleiben für Aufrufer der alten Signatur (`windowSlots(L, margin, spacing)`) erhalten.
 */
export function windowSlots(length: number, style: WindowStyle | number = {}, spacing?: number): number[] {
  const s: Required<WindowStyle> =
    typeof style === 'number'
      ? { ...DEFAULT_WINDOW_STYLE, margin: style, ...(spacing !== undefined ? { spacing } : {}), blankFrom: Infinity }
      : { ...DEFAULT_WINDOW_STYLE, ...style };
  if (!s.enabled) return [];
  const margin = Math.max(0, Math.floor(s.margin));
  const gap = Math.max(1, Math.floor(s.spacing));
  if (length < s.blankFrom) return evenSlots(length, margin, gap);
  // Lange Wand: fensterfreie Mitte (gleiche Parität wie die Lauflänge, damit beide Hälften gleich lang sind)
  let blank = Math.max(1, Math.floor(s.blankWidth));
  if ((length - blank) % 2 !== 0) blank++;
  const half = (length - blank) / 2;
  // Außen der Randabstand, zur Mitte hin keiner (die fensterfreie Mitte trennt schon); gespiegelt
  const left = evenSlots(half + margin, margin, gap).filter((p) => p < half);
  return [...left, ...left.map((p) => length - 1 - p).reverse()];
}

export interface PlannedWindow {
  /** Wandzelle (Index). */
  readonly cell: number;
  /** Bodenzelle davor (Index). */
  readonly inside: number;
  /** Raum der Bodenzelle. */
  readonly room: number;
  readonly run: number;
}

/**
 * W2 (Baustandard F1–F3, `FacadeRules.grid`): ein Fenster je Feld des Fassadenrasters, genau auf der Feldachse und
 * damit auf allen Geschossen in derselben Spalte. Ein Feld bleibt **blind** (nie verschoben), wenn eine Tür darin liegt,
 * wenn eine Achszelle keine gerade Außenwand mit Raum dahinter ist (Innenwand-Stoß) oder wenn `skip` sie ausschließt
 * (Dach darunter, Keller, fremder Baukörper, Leiter-Träger). Doppelachsen (gerades Mittelfeld) ganz oder gar nicht.
 */
export function planGridWindows(
  plan: WallPlan, frame: Frame, lines: readonly GridLine[], doorCells: ReadonlySet<number>, skip?: (cell: number) => boolean,
): PlannedWindow[] {
  const { labels, kind } = plan;
  const out: PlannedWindow[] = [];
  for (const line of lines) {
    const [dx, dz] = STEP[line.out];
    const across = dx !== 0 ? dx : dz * frame.w;
    for (const bay of line.bays) {
      let blind = false;
      for (let a = bay.from; a <= bay.to && !blind; a++) blind = doorCells.has(gridCell(frame, line.out, line.plane, a));
      if (blind) continue;
      const found: PlannedWindow[] = [];
      for (const a of bay.axis) {
        const cell = gridCell(frame, line.out, line.plane, a);
        const inside = cell - across;
        if (kind[cell] !== WALL || plan.cls[cell] !== WC.STRAIGHT || plan.runOf[cell]! < 0 || skip?.(cell) === true) break;
        if (kind[inside] !== FLOOR || labels[inside] === 0 || labels[cell + across] !== 0) break;
        found.push({ cell, inside, room: labels[inside]!, run: plan.runOf[cell]! });
      }
      if (found.length === bay.axis.length) out.push(...found);
    }
  }
  return out;
}

/**
 * @param skip Wandzellen, die kein Fenster bekommen (Leiter-Träger; von einem Dach darunter verdeckt)
 */
export function planWindows(plan: WallPlan, runsWithDoor: ReadonlySet<number>, style: WindowStyle = {}, skip?: (cell: number) => boolean): PlannedWindow[] {
  const { frame, labels, kind } = plan;
  const out: PlannedWindow[] = [];
  plan.runs.forEach((run, ri) => {
    if (!run.exterior || runsWithDoor.has(ri)) return;
    const across = run.axis === 'x' ? frame.w : 1;
    for (const pos of windowSlots(run.cells.length, style)) {
      const cell = run.cells[pos]!;
      if (skip?.(cell) === true) continue;
      const p = cell - across;
      const q = cell + across;
      const pFloor = kind[p] === FLOOR;
      const qFloor = kind[q] === FLOOR;
      // genau eine Seite Boden, die andere außen
      if (pFloor && labels[q] === 0) out.push({ cell, inside: p, room: labels[p]!, run: ri });
      else if (qFloor && labels[p] === 0) out.push({ cell, inside: q, room: labels[q]!, run: ri });
    }
  });
  return out;
}
