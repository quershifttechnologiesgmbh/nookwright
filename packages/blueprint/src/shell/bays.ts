/**
 * Fassadenraster (W2, Baustandard F1–F3/W2, Prüfbericht X2 §6.2): „von groß nach klein“ – erst Joche je Außenseite,
 * dann ein Fenster je Feld, dann Anbauteile an den Pfosten. Rein und deterministisch, im Raster der Hüllen-Ableitung.
 *
 *   Seite (Außenansicht, Feld 3):   |#W#P#W#P#D#P#W#P#W#|    | Ecke  P Pfosten  W Fenster (Feldmitte)  D Tür
 *   Obergeschoss (gleiche Linie):  |#W#P#W#P#W#P#W#P#W#|    dieselben Pfosten und Achsen
 *
 * - **Linie:** je Geschoss, Außenrichtung und Wandebene die zusammenhängenden Wandzellen mit Außenluft davor, Ecken
 *   eingeschlossen (`gridLines`).
 * - **Raster:** `bays` aus `@mcda/core` (Ecken sind Pfosten, kein Feld schmaler als die Feldbreite, spiegelsymmetrisch),
 *   Achse je Feld `bayAxis` (ungerade Breite mittig, gerade zur Linienmitte hin, gerades Mittelfeld doppelt).
 * - **Einmal für alle Geschosse:** eine Linie über einer Linie gleicher Ausdehnung (Ebene und Enden je ±1, also auch
 *   bei 1 Block Auskragung) übernimmt deren Pfosten und Achsen; ein Rücksprung oder eine Flügelwand bekommt ein eigenes
 *   Raster. Keller (Etagenindex < 0) haben keine Fassade.
 */
import { bayAxis, bays, type HorizontalDir } from '@mcda/core';
import { DIRS, STEP, inFrame, type Frame } from './grid.js';
import { WALL, type WallPlan } from './walls.js';

/** Feldbreite ohne Angabe (Regel `bay`) und ohne Theme-Vorgabe: Stein-Themes, research/18 §2, research/12 §3.5. */
export const DEFAULT_FACADE_BAY = 3;

/** Eingabe je Geschoss (aufsteigend nach Bodenplatte). */
export interface GridLevel {
  readonly plan: WallPlan;
  /** Eigene Labels 1…own (Räume anderer Baukörper darüber zählen nicht als Fassade). */
  readonly own: number;
  /** Etagenindex des Geschosses (< 0: Keller ohne Fassade). */
  readonly floorIndex: number;
  /**
   * W7 (Turmschaft `RoofDetail.shaftGrid`): Baukörper je Label (eigene und fremde Räume, Index = Label) und die
   * Baukörper mit eigenem Raster. Fehlt das Feld, bleiben die Linien wie bisher (zellgleich).
   */
  readonly volumes?: { readonly of: readonly string[]; readonly shafts: ReadonlySet<string> };
}

/** Raster einer Linie in Rasterkoordinaten (`along` = x bei Nord/Süd, z bei Ost/West; `plane` quer dazu). */
export interface GridLine {
  readonly out: HorizontalDir;
  readonly plane: number;
  readonly from: number;
  readonly to: number;
  readonly posts: readonly number[];
  readonly bays: readonly { readonly from: number; readonly to: number; readonly axis: readonly number[] }[];
}

/** Rasterindex der Zelle an (along, plane) einer Linie mit Außenseite `out`. */
export function gridCell(frame: Frame, out: HorizontalDir, plane: number, along: number): number {
  return out === 'north' || out === 'south' ? plane * frame.w + along : along * frame.w + plane;
}

/** Außenwand-Linien eines Geschosses: Wandzellen eigener Räume mit Außenluft (Label 0) in Richtung `out`. */
export function gridLines(frame: Frame, level: GridLevel): Array<Pick<GridLine, 'out' | 'plane' | 'from' | 'to'>> {
  const { plan, own } = level;
  const vols = level.volumes !== undefined && level.volumes.shafts.size > 0 ? level.volumes : undefined;
  /** Baukörper mit eigenem Raster an einer Zelle (eigener oder fremder Raum), sonst `undefined`. */
  const shaftAt = (i: number): string | undefined => {
    const l = plan.labels[i]!;
    const v = vols === undefined || l < 1 ? undefined : vols.of[l];
    return v !== undefined && vols!.shafts.has(v) ? v : undefined;
  };
  const byPlane = new Map<string, number[]>();
  /** W7: Linien eines Schafts mit mindestens einer Zelle, vor der wirklich Außenluft liegt. */
  const exposed = new Set<string>();
  for (let i = 0; i < plan.kind.length; i++) {
    const l = plan.labels[i]!;
    if (plan.kind[i] !== WALL || l < 1 || l > own) continue;
    const x = i % frame.w;
    const z = Math.floor(i / frame.w);
    const shaft = shaftAt(i);
    for (const out of DIRS) {
      const nx = x + STEP[out][0];
      const nz = z + STEP[out][1];
      const j = nz * frame.w + nx;
      const air = !inFrame(frame, nx, nz) || plan.labels[j] === 0;
      // W7: am Schaft zählt auch ein anderer Baukörper davor als außen (die Seite läuft von Ecke zu Ecke)
      if (!air && (shaft === undefined || vols!.of[plan.labels[j]!] === shaft)) continue;
      const ns = out === 'north' || out === 'south';
      const k = `${out}|${ns ? z : x}${shaft !== undefined ? `|${shaft}` : ''}`;
      (byPlane.get(k) ?? byPlane.set(k, []).get(k)!).push(ns ? x : z);
      if (air && shaft !== undefined) exposed.add(`${k}|${ns ? x : z}`);
    }
  }
  const out: Array<Pick<GridLine, 'out' | 'plane' | 'from' | 'to'>> = [];
  for (const [k, list] of [...byPlane].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const [dir, plane, shaft] = k.split('|') as [HorizontalDir, string, string | undefined];
    const ns = dir === 'north' || dir === 'south';
    const at = (a: number): number => (ns ? Number(plane) * frame.w + a : a * frame.w + Number(plane));
    /** W7: Fuge zu einem Schaft in derselben Flucht – die Wandzelle des Schafts ist die Ecke dieser Linie. */
    const seam = (a: number): boolean => vols !== undefined && shaft === undefined && a >= 0 && a < (ns ? frame.w : frame.d)
      && plan.kind[at(a)] === WALL && shaftAt(at(a)) !== undefined;
    list.sort((a, b) => a - b);
    let s = 0;
    for (let e = 1; e <= list.length; e++) {
      if (e < list.length && list[e] === list[e - 1]! + 1) continue;
      let from = list[s]!;
      let to = list[e - 1]!;
      s = e;
      if (shaft !== undefined) {
        let open = false;
        for (let a = from; a <= to && !open; a++) open = exposed.has(`${k}|${a}`);
        if (!open) continue; // Brandwand: keine Fassade
      } else {
        if (seam(from - 1)) from--;
        if (seam(to + 1)) to++;
      }
      out.push({ out: dir, plane: Number(plane), from, to });
    }
  }
  return out;
}

/** Eigenes Raster einer Linie: `bays` über die ganze Länge (Ecken inklusive), Achsen je Feld. */
function ownGrid(line: Pick<GridLine, 'out' | 'plane' | 'from' | 'to'>, field: number): GridLine {
  const len = line.to - line.from + 1;
  const b = bays(len, field);
  return {
    ...line,
    posts: b.posts.slice(1, -1).map((p) => line.from + p),
    bays: b.fields.map(([a, e]) => ({ from: line.from + a, to: line.from + e, axis: bayAxis(a, e, 0, len - 1).map((x) => line.from + x) })),
  };
}

/** Raster wie `parent`, beschnitten auf die eigenen Enden (gleiche Ausdehnung ±1). */
function inherited(line: Pick<GridLine, 'out' | 'plane' | 'from' | 'to'>, parent: GridLine): GridLine {
  const posts = parent.posts.filter((p) => p > line.from && p < line.to);
  const ends = [line.from, ...posts, line.to];
  const fields = ends.slice(1).map((e, k) => [ends[k]! + 1, e - 1] as const).filter(([a, e]) => e >= a);
  return {
    ...line,
    posts,
    bays: fields.map(([a, e]) => {
      // W6 (27.09.2026): ein Feld ohne Achse (vom Rücksprung abgeschnitten, `overlapped`) passte bisher auf jedes Feld
      // (`[].every` ist wahr) und machte die ganze geerbte Linie blind – zuerst das deckungsgleiche Feld, sonst eins mit Achse
      const own = parent.bays.find((b) => b.from === a && b.to === e) ?? parent.bays.find((b) => b.axis.length > 0 && b.axis.every((x) => x >= a && x <= e));
      return { from: a, to: e, axis: own?.axis ?? bayAxis(a, e, line.from, line.to) };
    }),
  };
}

/**
 * Teilweise Überdeckung (Baukörper, Rücksprung an einem Ende): Pfosten und Achsen der Linie darunter, soweit sie
 * überlappt – so fluchten die Fenster dort weiter; das überstehende Stück bekommt ein eigenes Raster, dessen Grenze die
 * Ecke der Linie darunter ist (dort steht darunter ohnehin ein Pfosten).
 */
function overlapped(line: Pick<GridLine, 'out' | 'plane' | 'from' | 'to'>, parent: GridLine, field: number): GridLine {
  const ext: GridLine[] = [];
  if (parent.from > line.from + 1) ext.push(ownGrid({ ...line, from: line.from, to: parent.from }, field));
  if (parent.to < line.to - 1) ext.push(ownGrid({ ...line, from: parent.to, to: line.to }, field));
  const cuts = ext.flatMap((g) => [g.from === line.from ? g.to : g.from]);
  const posts = [...new Set([...parent.posts, ...cuts, ...ext.flatMap((g) => g.posts)])].filter((p) => p > line.from && p < line.to).sort((a, b) => a - b);
  const ends = [line.from, ...posts, line.to];
  const fields = ends.slice(1).map((e, k) => [ends[k]! + 1, e - 1] as const).filter(([a, e]) => e >= a);
  const known = [...parent.bays, ...ext.flatMap((g) => g.bays)];
  return {
    ...line,
    posts,
    bays: fields.map(([a, e]) => {
      const own = known.find((b) => b.axis.length > 0 && b.axis.every((x) => x >= a && x <= e));
      // ein von der Linie abgeschnittenes Feld ohne eigene Achse bleibt blind (keine Achse direkt neben der Ecke)
      return { from: a, to: e, axis: own?.axis ?? (e - a + 1 >= 3 ? bayAxis(a, e, line.from, line.to) : []) };
    }),
  };
}

/**
 * Raster aller Geschosse (Index = Geschoss der Eingabe). Linien eines Geschosses erben das Raster der nächsten Linie
 * darunter mit gleicher Außenseite, Ebene ±1 und Enden je ±1; sonst (Baukörper, einseitiger Rücksprung) das einer Linie
 * darunter, die mindestens die Hälfte überdeckt, für den überdeckten Teil; sonst eigenes Raster mit Feldbreite `field`.
 */
export function planFacadeGrid(frame: Frame, levels: readonly GridLevel[], field: number): GridLine[][] {
  const done: GridLine[][] = [];
  for (const level of levels) {
    if (level.floorIndex < 0) {
      done.push([]);
      continue;
    }
    const own = gridLines(frame, level).map((line) => {
      for (let k = done.length - 1; k >= 0; k--) {
        const parent = done[k]!.find((m) => m.out === line.out && Math.abs(m.plane - line.plane) <= 1 && Math.abs(m.from - line.from) <= 1 && Math.abs(m.to - line.to) <= 1);
        if (parent !== undefined) return inherited(line, parent);
      }
      const len = line.to - line.from + 1;
      const overlap = (m: GridLine): number => Math.min(m.to, line.to) - Math.max(m.from, line.from) + 1;
      for (let k = done.length - 1; k >= 0; k--) {
        const parent = done[k]!.filter((m) => m.out === line.out && Math.abs(m.plane - line.plane) <= 1 && 2 * overlap(m) >= len && 2 * overlap(m) >= m.to - m.from + 1)
          .sort((p, q) => overlap(q) - overlap(p) || p.from - q.from)[0];
        if (parent !== undefined) return overlapped(line, parent, field);
      }
      return ownGrid(line, field);
    });
    done.push(own);
  }
  return done;
}

/**
 * Tür-Vorzug je Wandzelle (`DoorPlanInput.preferCols`): Feldachsen 1, das Mittelfeld einer Linie 2 (Doppelachse 1,5 –
 * dort sitzt eine Tür eine halbe Spalte neben der Mitte). So landet die Haustür bevorzugt im Mittelfeld der Front.
 */
export function doorPreference(frame: Frame, lines: readonly GridLine[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of lines) {
    const mid = line.bays.length % 2 === 1 ? (line.bays.length - 1) / 2 : -1;
    line.bays.forEach((b, k) => {
      const bonus = k === mid ? (b.axis.length === 1 ? 2 : 1.5) : b.axis.length === 1 ? 1 : 0;
      if (bonus === 0) return;
      for (const a of b.axis) {
        const c = gridCell(frame, line.out, line.plane, a);
        out.set(c, Math.max(out.get(c) ?? 0, bonus));
      }
    });
  }
  return out;
}

/**
 * W4-C (Baustandard F3): Achszellen der Mittelfelder je Linie mit Rang – 3 = echtes Mittelfeld (ungerade Feldzahl ≥ 3),
 * 2 = die beiden mittleren Felder einer Linie mit gerader Feldzahl ≥ 4 (die Linienmitte liegt auf einem Pfosten),
 * 1 = Linie mit 1–2 Feldern (Giebel- und Schmalseiten). Wandzellen im Raster (`DoorPlanInput.middleRank`).
 */
export function middleBayCells(frame: Frame, lines: readonly GridLine[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of lines) {
    const n = line.bays.length;
    if (n === 0) continue;
    const mids = n % 2 === 1 ? [(n - 1) / 2] : [n / 2 - 1, n / 2];
    const rank = n >= 3 && n % 2 === 1 ? 3 : n >= 4 ? 2 : 1;
    for (const k of mids) {
      for (const a of line.bays[k]!.axis) {
        const c = gridCell(frame, line.out, line.plane, a);
        out.set(c, Math.max(out.get(c) ?? 0, rank));
      }
    }
  }
  return out;
}

/**
 * W4-C Doppeltür: symmetrische Zellpaare je Linie – die Doppelachse des geraden Mittelfelds (einzige Stelle, an der zwei
 * Türflügel spiegelgleich in Feld und Linie sitzen). Schlüssel = linke Zelle (kleinere Koordinate entlang der Linie).
 */
export function doublePairs(frame: Frame, lines: readonly GridLine[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of lines) {
    for (const b of line.bays) {
      if (b.axis.length !== 2) continue;
      const [lo, hi] = [Math.min(...b.axis), Math.max(...b.axis)];
      out.set(gridCell(frame, line.out, line.plane, lo), gridCell(frame, line.out, line.plane, hi));
    }
  }
  return out;
}
