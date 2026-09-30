/**
 * Fassadenrhythmus (WS-Fassade, Bauprozess Schritt 4 „Rohbau“, plan/spikes/WS_fassade.md): flache Außenwände bekommen
 * einen Takt aus Fensterachsen statt weniger, weit verstreuter Einzelfenster.
 *
 * Regeln (rein, deterministisch, keine Zufallszahlen):
 *  - **Achse:** Ein Wandlauf ohne Tür wird um seine Mitte getaktet (ungerade Länge → Mittelachse; gerade Länge →
 *    Doppelachse), ein Lauf mit **einer** Tür um die Tür (die Tür ist die Hauptachse, die Fenster reihen sich in ihrem
 *    Takt daneben). Läufe mit mehreren Türen bleiben unberührt.
 *  - **Spiegelbindung (`ties`):** Die Achsen liegen paarweise symmetrisch zur Hauptachse. Ist eine Zelle eines Paares
 *    unbrauchbar (Dach darunter, fremder Baukörper, Tor, Innenwand-Stoß), entfällt das ganze Paar – so entsteht nie ein
 *    einseitiges Muster (und nie ein Windrad).
 *  - **Takt:** Achsabstand 3 (zwei Wandzellen zwischen zwei Fenstern); passt das nicht ohne Ausfall, gilt 4, dann 5
 *    (Ersatzläufe an Stelle eines Neustarts mit Unter-Seed: die Kandidatenfolge ist fest, das Ergebnis reproduzierbar).
 *    Es gewinnt der erste Takt ohne Ausfall, sonst der mit den meisten Fenstern.
 *  - **Mindestdichte (Nachprüfung):** Bleibt ein Lauf ab 5 Zellen ohne Fenster, behält er seine bisherigen Fenster.
 *  - **Hart bleibt:** Abstand ≥ 2 zu jeder Tür, `skip` (Dach darunter, Keller, Baukörperfuge, Scheunentor), Raum der
 *    Bodenzelle gehört zu dieser Etage. Die Fenster sitzen wie bisher auf geraden Läufen mit Boden davor und Außen dahinter,
 *    die Einrichtung richtet sich nach ihnen (`nearWindow`), Erreichbarkeit und Licht ändern sich nicht zum Schlechteren.
 */
import type { DormerStyle } from './types.js';
import type { PlannedWindow } from './windows.js';
import type { WallPlan } from './walls.js';
import { FLOOR, WALL, WC } from './walls.js';
import { gridCell, type GridLine } from './bays.js';
import { STEP, type Frame } from './grid.js';

/** Achsabstände in der Reihenfolge, in der sie versucht werden. */
export const RHYTHM_PITCHES: readonly number[] = [3, 4, 5];

/** Gauben der leeren Dachflächen, wenn der Bautyp keine festlegt (Satteldach-Gaube, 3 breit; `planDormers` prüft die Dachform). */
export const RHYTHM_DORMERS: DormerStyle = { kind: 'gable', width: 3 };

/** Randabstand (Zellen) zwischen Lauf-Ende und erster Achse. */
const EDGE = 2;
/** Kürzeste Lauflänge, die einen Takt bekommt. */
const MIN_RUN = 5;

export interface RhythmResult {
  readonly windows: PlannedWindow[];
  /** Wandläufe, deren Fenster der Rhythmus ersetzt hat. */
  readonly runs: number;
}

/**
 * @param own Anzahl eigener Raum-Labels der Etage (höhere Labels sind fremde Baukörper)
 * @param doorCells Wandzellen aller Türen der Etage
 * @param pairCells zweite Flügel von Doppeltüren (nur für den Türabstand)
 * @param onlyBlank nur Läufe ohne jedes Fenster füllen (Fassadenraster: die Felder tragen den Takt schon)
 * @param skip Wandzellen ohne Fenster
 * @param kept bisher geplante Fenster (Grundlage für Läufe, die unberührt bleiben)
 */
export function rhythmWindows(
  plan: WallPlan, own: number, kept: readonly PlannedWindow[], doorCells: readonly number[], skip: (cell: number) => boolean,
  pairCells: readonly number[] = [], onlyBlank = false,
): RhythmResult {
  const { frame, labels, kind } = plan;
  const doorXZ = [...doorCells, ...pairCells].map((c) => [c % frame.w, Math.floor(c / frame.w)] as const);
  const nearDoor = (cell: number): boolean => {
    const x = cell % frame.w;
    const z = Math.floor(cell / frame.w);
    return doorXZ.some(([dx, dz]) => Math.max(Math.abs(dx - x), Math.abs(dz - z)) < 2);
  };
  const out: PlannedWindow[] = [];
  let touched = 0;
  const replaced = new Set<number>();
  plan.runs.forEach((run, ri) => {
    const len = run.cells.length;
    if (!run.exterior || len < MIN_RUN) return;
    const doors = doorCells.filter((c) => plan.runOf[c] === ri).map((c) => plan.posInRun[c]!);
    if (doors.length > 1) return;
    if (onlyBlank && (doors.length > 0 || kept.some((w) => w.run === ri))) return;
    const across = run.axis === 'x' ? frame.w : 1;
    /** Fenster an Laufposition `pos` (Boden auf genau einer Seite, außen auf der anderen), sonst undefined. */
    const at = (pos: number): PlannedWindow | undefined => {
      if (pos < EDGE || pos > len - 1 - EDGE) return undefined;
      const cell = run.cells[pos]!;
      if (skip(cell) || nearDoor(cell)) return undefined;
      const p = cell - across;
      const q = cell + across;
      let w: PlannedWindow | undefined;
      if (kind[p] === FLOOR && labels[q] === 0) w = { cell, inside: p, room: labels[p]!, run: ri };
      else if (kind[q] === FLOOR && labels[p] === 0) w = { cell, inside: q, room: labels[q]!, run: ri };
      return w !== undefined && w.room >= 1 && w.room <= own ? w : undefined;
    };
    // Hauptachse: die Tür, sonst die Mitte (doppelt bei gerader Länge: 2·a = len − 1 → a halbzahlig)
    const layout = (pitch: number): { wins: PlannedWindow[]; lost: number } => {
      const wins: PlannedWindow[] = [];
      let lost = 0;
      const pair = (a: number, b: number): void => {
        const wa = at(a);
        const wb = a === b ? wa : at(b);
        if (wa !== undefined && wb !== undefined) {
          wins.push(wa);
          if (wb !== wa) wins.push(wb);
        } else lost++;
      };
      if (doors.length === 1) {
        const d = doors[0]!;
        for (let k = pitch; d - k >= EDGE && d + k <= len - 1 - EDGE; k += pitch) pair(d - k, d + k);
      } else if (len % 2 === 1) {
        const c = (len - 1) / 2;
        pair(c, c);
        for (let k = pitch; c - k >= EDGE; k += pitch) pair(c - k, c + k);
      } else {
        const a = len / 2 - 1;
        pair(a, len - 1 - a);
        for (let k = pitch; a - k >= EDGE; k += pitch) pair(a - k, len - 1 - (a - k));
      }
      return { wins, lost };
    };
    let best: { wins: PlannedWindow[]; lost: number } | undefined;
    for (const pitch of RHYTHM_PITCHES) {
      const l = layout(pitch);
      if (best === undefined || (best.lost > 0 && l.wins.length > best.wins.length)) best = l;
      if (l.lost === 0 && l.wins.length > 0) {
        best = l;
        break;
      }
    }
    if (best === undefined || best.wins.length === 0) return; // Mindestdichte: ohne Ergebnis bleibt der Lauf, wie er war
    replaced.add(ri);
    touched++;
    out.push(...best.wins);
  });
  const rest = kept.filter((w) => !replaced.has(w.run));
  return { windows: [...rest, ...out], runs: touched };
}

/** Abstand (Zellen) der Zusatzfenster zur Ecke: Die Eckzone des Raums (2 Zellen tief: Fußabdruck des Eckregals, Pflichtobjekte) bleibt fensterfrei. */
const CORNER_KEEP = 2;
/** Kurze Seiten (Türme, Räume ≤ 7 Zellen) brauchen die Eckzone tiefer: das Eckregal (2 × 2) muss noch in die Ecke passen. */
const SHORT_LINE = 9;
const SHORT_KEEP = 3;

/** Kleinste Lücke (freie Wandzellen zwischen zwei Öffnungen bzw. Ecken), die im Fassadenraster ein Zusatzfenster bekommt. */
export const MIN_GAP = 3;

/**
 * Mindestdichte im Fassadenraster: In jeder Linie füllt ein Zusatzfenster die Mitte jeder Lücke von mindestens
 * `MIN_GAP` freien Wandzellen zwischen zwei Öffnungen (Fenster, Tür, Ecke). Gerade Lücken bekommen ein Doppelfenster.
 * Pfosten bleiben frei. Spiegelbindung: Die Lücken einer spiegelsymmetrischen Linie sind selbst spiegelsymmetrisch; fällt
 * eine Zelle aus (Dach darunter, Tor, Innenwand-Stoß), entfällt das gespiegelte Gegenstück mit, so entsteht nie ein
 * einseitiges Muster. Hart bleibt wie im Raster: gerader Lauf, Boden davor, Außenluft dahinter, Abstand ≥ 2 zur Tür.
 */
export function densifyGridWindows(
  plan: WallPlan, frame: Frame, lines: readonly GridLine[], kept: readonly PlannedWindow[], doorCells: readonly number[],
  skip: (cell: number) => boolean, own: number,
): PlannedWindow[] {
  const { labels, kind } = plan;
  const have = new Set(kept.map((w) => w.cell));
  const doorXZ = doorCells.map((c) => [c % frame.w, Math.floor(c / frame.w)] as const);
  const nearDoor = (cell: number): boolean => {
    const x = cell % frame.w;
    const z = Math.floor(cell / frame.w);
    return doorXZ.some(([dx, dz]) => Math.max(Math.abs(dx - x), Math.abs(dz - z)) < 2);
  };
  const added: PlannedWindow[] = [];
  for (const line of lines) {
    const [dx, dz] = STEP[line.out];
    const across = dx !== 0 ? dx : dz * frame.w;
    const cellAt = (a: number): number => gridCell(frame, line.out, line.plane, a);
    const posts = new Set(line.posts);
    const occupied = (a: number): boolean => have.has(cellAt(a)) || doorCells.includes(cellAt(a));
    const make = (a: number): PlannedWindow | undefined => {
      const cell = cellAt(a);
      if (a - line.from < keep || line.to - a < keep || posts.has(a) || occupied(a) || skip(cell) || nearDoor(cell)) return undefined;
      const inside = cell - across;
      if (kind[cell] !== WALL || plan.cls[cell] !== WC.STRAIGHT || plan.runOf[cell]! < 0) return undefined;
      if (kind[inside] !== FLOOR || labels[inside]! < 1 || labels[inside]! > own || labels[cell + across] !== 0) return undefined;
      return { cell, inside, room: labels[inside]!, run: plan.runOf[cell]! };
    };
    // Öffnungen und Ecken als Grenzen, aufsteigend
    // Die Zellen bis CORNER_KEEP zur Ecke sind gesperrt; die Lücken zählen ab der ersten Zelle, die ein Fenster tragen darf
    const keep = line.to - line.from + 1 <= SHORT_LINE ? SHORT_KEEP : CORNER_KEEP;
    const marks = [line.from + keep - 1, line.to - keep + 1];
    for (let a = line.from; a <= line.to; a++) if (occupied(a)) marks.push(a);
    marks.sort((p, q) => p - q);
    const groups: number[][] = [];
    for (let i = 0; i + 1 < marks.length; i++) {
      const lo = marks[i]!;
      const hi = marks[i + 1]!;
      const free = hi - lo - 1;
      if (free < MIN_GAP) continue;
      const mid = lo + Math.floor(free / 2) + (free % 2 === 1 ? 1 : 0);
      groups.push(free % 2 === 1 ? [mid] : [mid, mid + 1]);
    }
    const flip = (a: number): number => line.from + line.to - a;
    const done = new Set<number>();
    for (const g of groups) {
      const key = Math.min(...g);
      if (done.has(key)) continue;
      const mirror = g.map(flip).sort((p, q) => p - q);
      const both = [g, mirror];
      done.add(key);
      done.add(Math.min(...mirror));
      const wins = both.flatMap((grp) => grp.map(make));
      if (wins.some((w) => w === undefined)) continue;
      const seen = new Set<number>();
      for (const w of wins as PlannedWindow[]) if (!seen.has(w.cell)) { seen.add(w.cell); added.push(w); }
    }
  }
  return added;
}
