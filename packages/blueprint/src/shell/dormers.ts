/**
 * Gauben (research/18 D4, research/16 D5): Mini-Dach als zweites Höhenfeld, `max(h_Haupt, h_Gaube)` im Grundriss-Feld
 * des Dachs (roof-shapes.ts). Klassifikation, Treppenwahl und Schließen bleiben die des Hauptdachs – die Kehlen
 * entstehen so von selbst; der Sprung an der Gaubenfront wird wie beim Fußwalm-Ziergiebel zur Wand (Frontwand mit
 * Pfosten, Brüstung, Fenster, Rähm – Fenster setzt `placeDormerWindows` in roof-finish.ts).
 *
 * Lage (eigene Herleitung; Ringe = 45°-Höhenstufen des Felds, d_f = Ring der Hauptfläche in der Frontreihe):
 *  - Frontreihe = Ring t = 1 (eine Zelle innerhalb der Traufwand, über einem Raum), Achse quer zur Traufe.
 *  - Satteldach-Gaube (`gable`, `blind`), Breite W, h = (W+1)/2: Feld d_f + h + ½ − |k| über 2h+1 Zellen (1 Überstand
 *    je Seite), konstant bergauf bis zur Kehlreihe (v = h+1, dort Hauptfläche = Gaubenfirst).
 *  - Walmgaube (`hip`): wie `gable`, die Firstzelle der Frontreihe einen Ring tiefer (kleiner Walm vorn; bei W = 1
 *    gleich der Satteldach-Gaube – ein Block breiter Walm hätte keine Frontwand).
 *  - Schleppgaube (`shed`): flach (Stufen) auf Ring d_f + 2 über 2h+1 Zellen, Seitenwände bis zur Kehlreihe v = 2.
 *
 *   Traufansicht Satteldach-Gaube W = 3, Neigung 1:1       Schnitt entlang der Achse (bergauf nach links)
 *     . . . _ . . .    _ Gaubenfirst                         . _ _ _ .       _ Gaubenfirst (bis zur Kehlreihe)
 *     . . / R \ . .    R Rähm, / \ Gaubendach                / . . R \ .
 *     . / | g | \ .    | Pfosten, g Fenster                 / . . . g \       g Fenster, B Brüstung
 *     H H | B | H H    H Hauptdach (Schulter: Haupttreppe)  / . . . . B \
 *
 * Regeln: ganze Gaube samt 1 Zelle Rand (Abstand ≥ 2 zu Ortgang, Grat, Kehle, Sperrzone) auf ebener Hauptfläche mit
 * regelmäßigen Ringen, ungekappt, bis zur Kehlreihe; Gaubenfirst damit ≥ 1 unter dem Hauptfirst. Je Dachfläche
 * (Frontreihe) symmetrisch zur Mitte, gleichmäßig verteilt, höchstens 1 je 6 Blöcke Trauflänge, Abstand zwischen den
 * Gaubendächern ≥ `minGap`. Eine Gaube, deren Frontwand keinen Platz für Brüstung und Scheibe lässt (flache Neigung),
 * entfällt mit allen Gauben ihrer Dachfläche (buildRoofBlocks).
 */
import type { HorizontalDir } from '@mcda/core';
import { DIRS, OPP, STEP, axisOf } from './grid.js';
import { stairQuarters, type RoofCell, type RoofField } from './roof.js';
import type { DormerStyle } from './types.js';

export type DormerKind = DormerStyle['kind'];

export interface Dormer {
  readonly kind: DormerKind;
  /** Rasterindex der Achszelle in der Frontreihe. */
  readonly i: number;
  /** Bergauf (facing der Haupttreppen); die Front zeigt nach OPP[up]. */
  readonly up: HorizontalDir;
  /** Halbe Dachbreite: W = 2h − 1, Gaubendach 2h + 1 Zellen. */
  readonly h: number;
  /** Dachfläche (Frontreihe) – Gauben einer Fläche entfallen gemeinsam (Symmetrie). */
  readonly face: number;
}

/** Laufrichtung quer zur Fallrichtung (aufsteigende Koordinate, wie bei den Ankern). */
export const lateralOf = (up: HorizontalDir): HorizontalDir => (axisOf(up) === 'z' ? 'east' : 'south');

/** Zeilen bergauf ab der Frontreihe bis zur Kehlreihe (einschließlich). */
export const dormerRows = (dm: Pick<Dormer, 'kind' | 'h'>): number => (dm.kind === 'shed' ? 2 : dm.h + 1);

/** Halbe Breite der Frontwand (Pfosten bei ±e): Satteldach/Walm h − 1, Schleppgaube h. */
export const frontHalf = (dm: Pick<Dormer, 'kind' | 'h'>): number => (dm.kind === 'shed' ? dm.h : dm.h - 1);

/** Rasterzelle (k quer, v bergauf) einer Gaube; −1 außerhalb. */
export function dormerCell(dm: Pick<Dormer, 'i' | 'up'>, w: number, d: number, k: number, v: number): number {
  const lat = STEP[lateralOf(dm.up)];
  const x = (dm.i % w) + lat[0] * k + STEP[dm.up][0] * v;
  const z = Math.floor(dm.i / w) + lat[1] * k + STEP[dm.up][1] * v;
  return x >= 0 && z >= 0 && x < w && z < d ? z * w + x : -1;
}

export interface DormerSite {
  readonly w: number;
  readonly d: number;
  readonly overhang: number;
  /** Klassifikation des Hauptdachs (ohne Gauben). */
  readonly cells: ReadonlyArray<RoofCell | undefined>;
  /** Höchste ungekappte Ebene t. */
  readonly tCap: number;
  /** Dachregion (Grundriss dieser Etage ohne die obere Etage): unter der Gaube liegt ein Raum. */
  readonly region: Uint8Array;
}

/** Gauben je Dachfläche: Frontreihe auf t = 1, gültige Achsen, symmetrischer Rhythmus. */
export function planDormers(style: DormerStyle, site: DormerSite): Dormer[] {
  const { w, d, cells, tCap, region } = site;
  const h = style.width === 1 ? 1 : style.width === 5 ? 3 : 2; // Breite 1/3/5, sonst 3
  const kind = style.kind;
  const gap = Math.max(0, Math.floor(style.minGap ?? 2));
  const ring = site.overhang + 2; // Ring d der Frontreihe (t = 1)
  const at = (x: number, z: number): RoofCell | undefined => (x >= 0 && z >= 0 && x < w && z < d ? cells[z * w + x] : undefined);
  /** Ebene Hauptfläche: Fläche mit Fallrichtung OPP[up], Ring r, ungekappt, alle 4 Nachbarn im Dach (kein Rand). */
  const plain = (j: number, up: HorizontalDir, r: number): boolean => {
    const c = j < 0 ? undefined : cells[j];
    if (c === undefined || c.cls !== 'slope' || c.high !== stairQuarters(up, 'straight') || c.d !== r || c.t > tCap) return false;
    const x = j % w;
    const z = Math.floor(j / w);
    return DIRS.every((dir) => at(x + STEP[dir][0], z + STEP[dir][1]) !== undefined);
  };
  const fits = (dm: Dormer): boolean => {
    const rows = dormerRows(dm);
    for (let v = -1; v <= rows; v++) {
      for (let k = -h - 1; k <= h + 1; k++) {
        const j = dormerCell(dm, w, d, k, v);
        if (!plain(j, dm.up, ring + v)) return false;
        if (v >= 0 && Math.abs(k) <= h && region[j] !== 1) return false;
      }
    }
    return true;
  };

  const out: Dormer[] = [];
  let face = 0;
  for (const up of DIRS) {
    const lat = lateralOf(up);
    const along = (j: number): number => (lat === 'east' ? j % w : Math.floor(j / w));
    const line = (j: number): number => (lat === 'east' ? Math.floor(j / w) : j % w);
    // Frontreihen: Zellen der Fläche auf Ring d_f, gruppiert nach Reihe, zusammenhängend entlang `lat`
    const rows = new Map<number, number[]>();
    cells.forEach((c, j) => {
      if (c === undefined || c.cls !== 'slope' || c.high !== stairQuarters(up, 'straight') || c.d !== ring) return;
      (rows.get(line(j)) ?? rows.set(line(j), []).get(line(j))!).push(j);
    });
    for (const [, list] of [...rows].sort((a, b) => a[0] - b[0])) {
      list.sort((a, b) => along(a) - along(b));
      let s = 0;
      for (let e = 1; e <= list.length; e++) {
        if (e < list.length && along(list[e]!) === along(list[e - 1]!) + 1) continue;
        const run = list.slice(s, e);
        s = e;
        const byAlong = new Map(run.map((j) => [along(j), j] as const));
        const candidate = (a: number): Dormer | undefined => {
          const j = byAlong.get(a);
          return j === undefined ? undefined : { kind, i: j, up, h, face };
        };
        const slots = rhythmSlots(along(run[0]!), along(run[run.length - 1]!), (a) => {
          const dm = candidate(a);
          return dm !== undefined && fits(dm);
        }, 2 * h + 1 + gap);
        if (slots.length > 0) {
          out.push(...slots.map((a) => candidate(a)!));
          face++;
        }
      }
    }
  }
  return out;
}

/**
 * Achsen in [u0, u1]: n Gauben gleichmäßig verteilt (Mitte je Teilstück der Länge len/n), spiegelsymmetrisch zur Mitte,
 * höchstens 1 je 6 Blöcke, Achsabstand ≥ `spacing`; das größte n, bei dem alle Achsen gültig sind.
 */
export function rhythmSlots(u0: number, u1: number, valid: (a: number) => boolean, spacing: number): number[] {
  const len = u1 - u0 + 1;
  const c2 = u0 + u1;
  for (let n = Math.floor(len / Math.max(6, spacing)); n >= 1; n--) {
    const slots: number[] = [];
    for (let j = 0; j < Math.floor(n / 2); j++) {
      const a = Math.round(u0 - 0.5 + ((2 * j + 1) * len) / (2 * n));
      slots.push(a, c2 - a);
    }
    if (n % 2 === 1) slots.push(Math.floor(c2 / 2));
    slots.sort((p, q) => p - q);
    if (slots.every((a, j) => valid(a) && (j === 0 || a - slots[j - 1]! >= spacing))) return slots;
  }
  return [];
}

/** Grundriss-Feld mit Gauben: Maximum aus Hauptfeld und Gaubenfeldern (Zellmitte und Viertelpunkte). */
export function withDormers(field: RoofField, dormers: readonly Dormer[]): RoofField {
  const { w, d } = field;
  const hc = field.hc.slice();
  const hq = field.hq.slice();
  const OFF: ReadonlyArray<readonly [number, number]> = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (const dm of dormers) {
    const df = Math.round(field.hc[dm.i]! + 0.5); // Ring der Frontreihe
    const lat = lateralOf(dm.up);
    const ax = dm.i % w;
    const az = Math.floor(dm.i / w);
    /** Gaubenfeld am Punkt (px, pz) in Zellkoordinaten; undefined außerhalb. */
    const at = (px: number, pz: number): number | undefined => {
      // pk quer zur Achse (Achszelle mittig bei 0), pv bergauf ab der Vorderkante der Frontreihe
      const pk = lat === 'east' ? px - ax - 0.5 : pz - az - 0.5;
      const f = STEP[OPP[dm.up]];
      const pv = f[0] !== 0 ? (f[0] > 0 ? ax + 1 - px : px - ax) : f[1] > 0 ? az + 1 - pz : pz - az;
      if (Math.abs(pk) > dm.h + 0.5 || pv < 0 || pv > dormerRows(dm) + 1) return undefined;
      if (dm.kind === 'shed') return df + 1.5;
      const gable = df + dm.h + 0.5 - Math.abs(pk);
      return dm.kind === 'hip' && dm.h > 1 ? Math.min(gable, df + dm.h - 1 + pv) : gable;
    };
    const rows = dormerRows(dm);
    for (let v = 0; v <= rows; v++) {
      for (let k = -dm.h; k <= dm.h; k++) {
        const j = dormerCell(dm, w, d, k, v);
        if (j < 0) continue;
        const x = j % w;
        const z = Math.floor(j / w);
        hc[j] = Math.max(hc[j]!, at(x + 0.5, z + 0.5)!);
        OFF.forEach(([qx, qz], q) => (hq[4 * j + q] = Math.max(hq[4 * j + q]!, at(x + qx, z + qz)!)));
      }
    }
  }
  return { w, d, mask: field.mask, hc, hq };
}
