/**
 * „Überdecken“ (BT16, Lage `buried`, research/19 §5 BT16 und §7.5 G3): Hügel über eingegrabenen Baukörpern – bleibt
 * ein 2,5D-Höhenfeld ohne Überhang.
 *  - Über dem Grundriss: Oberkante der Hülle + `cover` Erdlagen + Kuppe (W7-I: elliptische Wölbung bis +3, Scheitel im
 *    hinteren Drittel; an der Frontreihe und an den Ecken nur die Erdlagen).
 *  - Daneben und dahinter fällt der Hügel rund ab (W7-I): euklidischer Abstand, weiche Schulter, Böschung mit Talus 1,
 *    weicher Fuß (`moundDrop`), Umriss leicht gewellt; die alte Ausbreitung (orthogonal 1, diagonal 1,5) sichert Talus ≤ 1.
 *  - Vor der Frontebene (vorderste Reihe des Grundrisses in Richtung `front`) kein Hügel: Vorplatz, Tür und Fenster frei.
 *    Neben der Fassade endet der Hügel dort als Anschnitt (aus Erde, ohne Stein).
 *  - Spalten unter Hüllzellen außerhalb des Grundrisses (Überstand, Außenprofil) und andere Baukörper bleiben frei.
 *  - W9-G4 (27.09.2026, plan/spikes/W9G4_erdhaus.md), nur mit Flanken (`BuriedMound.wing` > 0, Hülle seit W9-G4; ohne
 *    bitgleich): neben dem Grundriss reicht der Hügel `wing` Blöcke vor die Frontebene (die Front liegt als Nische
 *    zurück), der Hang ist eine Kuppel (`domeDrop`, Viertelellipse), Einzelspitzen und -löcher werden geglättet. Das Gelände zeigt an offenen
 *    Seiten keine Erde mehr: Moos an Stufenkanten und in Flecken, Stützmauer (`mound_wall`) wo mehr als eine Stufe offen
 *    liegt (generate.ts); vor den Stufenkanten wachsen Gras und Farn dichter (`plantMound`).
 *
 * Querschnitt quer zur Front (Test mound.test.ts: 11 × 9, lichte Höhe 3, cover 2; Front rechts, y relativ zu y0;
 * # Hülle, g Gras, e Erde, F Fundament, * Pflanze):
 *
 *    9 .........*..........
 *    8 ........*ggggg.*....     ← Scheitel (+2) im hinteren Teil
 *    7 ......*ggeeeeegg....
 *    6 .....ggeeeeeeeeeg...     ← an der Front nur cover 2 über der Decke (y 4)
 *    5 ...*geeeeeeeeeeee...     ← weiche Schulter
 *    4 ...geeee#########...
 *    3 .*geeeee#.......#...
 *    2 *geeeeee#.......#...     ← Böschung nach hinten, Talus 1
 *    1 geeeeeee#.......#..*     ← Tür/Front rechts, davor Vorplatz auf y0
 *    0 eeeeeeee#########eee
 *   -1 eeeeeeeeFFFFFFFFFeee
 */
import type { Catalog } from '@mcda/catalog';
import { HORIZONTAL, Rng, cellKey, hashSeed, key3, transformLocal, valueNoise2, type HorizontalDir, type Pose, type Vec3 } from '@mcda/core';
import { expandComponent, placeComponent } from '@mcda/furnishing';
import { plotAround, type BuildingInfo } from './building.js';
import { C, type Gen } from './gen.js';
import { DIR_OFFSET, PlotGrid } from './grid.js';
import type { OutdoorPlacement } from './props.js';
import { growTree } from './vegetation.js';
import { emitTree } from './zones.js';

/** Kein Hügel in dieser Spalte. */
export const NO_MOUND = -2147483648;

export interface MoundField {
  /** Oberkante des Hügels je Spalte (Grundriss: Oberkante der Erde über dem Dach), sonst `NO_MOUND`. */
  readonly top: Int32Array;
  /** Nur Grundriss-Spalten: oberste Hüllzelle (die Erde beginnt darüber), sonst `NO_MOUND`. */
  readonly roof: Int32Array;
}

const forward = (d: HorizontalDir, x: number, z: number): number => x * DIR_OFFSET[d][0] + z * DIR_OFFSET[d][1];

/** W13-C Runde 2: Länge des Wegs auf Türhöhe vor der Front (Blöcke); dahinter ein Beet als Abschluss. */
const WALK = 16;

/** W13-C: so weit laufen die Flanken über `wing` hinaus als Böschung nach vorn aus (Blöcke). */
const FLANK_RUN = 3;

/** Abfall-Rampe: Schulter und Fuß je höchstens so breit (Blöcke), dazwischen Talus 1 (W7-I). */
const RAMP = 3;

/** W9-G4: Breite der Kuppel (Blöcke vom Grundriss bis zum Fuß der Ellipse) bei Höhe `h` über dem Gelände. */
const domeWidth = (h: number): number => 1.35 * h + 1;

/**
 * W9-G4 (plan/spikes/W9G4_erdhaus.md): Höhenverlust der Kuppel bei Abstand `d` – Viertelellipse mit Halbachsen
 * `domeWidth(h)` und `h`: oben flach, zum Fuß steiler; den Fuß legt die Talus-Sicherung mit Steigung 1 aus.
 */
export function domeDrop(d: number, h: number): number {
  const w = domeWidth(h);
  if (h <= 0) return 0;
  return d >= w ? h : h * (1 - Math.sqrt(1 - (d / w) ** 2));
}

/**
 * W13-C (28.09.2026): Wölbung über dem Grundriss (0 … 1) bei ρ² (Ellipse um den Scheitel) – Paraboloid mit
 * abgeflachtem Kamm: innen (ρ ≲ 0,6) eben, nach außen mit wachsender, aber endlicher Steigung abfallend (eine
 * Halbellipse stünde am Rand senkrecht und zeigte dort eine Erdwand).
 */
export function crest(rho2: number): number {
  return rho2 >= 1 ? 0 : Math.min(1, 1.6 * (1 - rho2));
}

/**
 * Höhenverlust bei Abstand `d` von einer Quelle mit Höhe `h` über dem Gelände (W7-I): weiche Schulter (Steigung wächst
 * 0 → 1), gerade Böschung mit Talus 1, weicher Fuß (Steigung fällt 1 → 0). Steigung nie über 1 ⇒ Nachbarspalten
 * unterscheiden sich um höchstens einen Block; Breite des Abfalls = h + Rampe.
 */
export function moundDrop(d: number, h: number): number {
  if (h <= 0) return 0;
  const a = Math.min(RAMP, h / 2);
  const run = h - a;
  if (d <= a) return (d * d) / (2 * a);
  if (d <= a + run) return a / 2 + (d - a);
  const e = d - a - run;
  return e >= a ? h : a / 2 + run + e - (e * e) / (2 * a);
}

/**
 * Hügel aller eingegrabenen Baukörper (Maximum); `undefined` ohne Lage `buried`. `closed(i)` = Spalte, in die kein Hügel
 * fällt (Hüllzellen außerhalb des Grundrisses, Grundriss eines anderen Baukörpers).
 *
 * W7-I (plan/spikes/W7I_gelaende.md, Befund W1-E L1 „rechteckige Stufenpyramide mit flacher Kuppe“): der Hügel ist
 * eine Kuppe statt Terrassen – über dem Grundriss eine elliptische Wölbung (Scheitel im hinteren Drittel, an der Front
 * nur die Erdlagen; Höhe gerundet), daneben ein runder Abfall nach euklidischem Abstand mit weicher Schulter und weichem Fuß
 * (`moundDrop`); der Umriss schwankt leicht mit dem Winkel (zwei Harmonische aus dem Seed), damit er nicht wie mit dem
 * Zirkel gezogen wirkt. Talus ≤ 1 sichert zusätzlich die alte Ausbreitung (orthogonal 1, diagonal 1,5).
 */
export function moundField(grid: PlotGrid, building: BuildingInfo, closed: (i: number) => boolean, seed = 0): MoundField | undefined {
  const mounds = building.buried ?? [];
  if (mounds.length === 0) return undefined;
  const n = grid.size;
  const top = new Int32Array(n).fill(NO_MOUND);
  const roof = new Int32Array(n).fill(NO_MOUND);
  for (const m of mounds) {
    const cols: number[] = [];
    for (const k of m.tops.keys()) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      const i = grid.at(x, z);
      if (i >= 0) cols.push(i);
    }
    if (cols.length === 0) continue;
    const own = new Uint8Array(n);
    for (const i of cols) own[i] = 1;
    const fwd = (i: number): number => forward(m.front, grid.x(i), grid.z(i));
    const [fx, fz] = DIR_OFFSET[m.front];
    const side = (i: number): number => grid.x(i) * fz - grid.z(i) * fx; // quer zur Front
    const plane = Math.max(...cols.map(fwd));
    const back = Math.min(...cols.map(fwd));
    const s0 = Math.min(...cols.map(side));
    const s1 = Math.max(...cols.map(side));
    const depth = plane - back + 1;
    const width = s1 - s0 + 1;
    // Wölbung: Ellipse mit Scheitel bei 35 % der Tiefe von hinten; an der Frontreihe ρ ≥ 1 (nur die Erdlagen)
    // W13-C (28.09.2026, plan/spikes/W13C_erdhaus_huegel.md, nur mit Flanken): Kuppel mit abgeflachtem Kamm – Scheitel
    // in der Mitte der Tiefe, höher (bis 5), die Frontreihe bleibt ohne Wölbung (dort steht der Stirnbogen der Hülle)
    const dome = m.wing > 0;
    const cf = back + (dome ? 0.45 : 0.35) * (depth - 1);
    const af = Math.max(1, (plane - cf) * (dome ? 1.15 : 1));
    const cs = (s0 + s1) / 2;
    const as = (width / 2) * (dome ? 1.25 : 1.1);
    const crown = dome ? Math.max(2, Math.min(5, Math.round(Math.min(width, depth) / 3))) : Math.max(1, Math.min(3, Math.round(Math.min(width, depth) / 4)));
    const val = new Float64Array(n).fill(-Infinity);
    for (const i of cols) {
      const y = m.tops.get(cellKey(grid.x(i), grid.z(i)))!;
      roof[i] = Math.max(roof[i]!, y);
      const rho2 = ((fwd(i) - cf) / af) ** 2 + ((side(i) - cs) / as) ** 2;
      val[i] = y + m.cover + (rho2 >= 1 || (dome && fwd(i) === plane) ? 0 : dome ? crown * crest(rho2) : crown * (1 - rho2));
    }
    // W9-G4: neben dem Grundriss reicht der Hügel um die Flanken (`wing`) vor die Frontebene – die Front liegt als Nische
    // zwischen zwei Stützmauern zurück; nach vorn fallen die Flanken je Block um eine Stufe zusätzlich ab
    const beside = (i: number): boolean => side(i) < s0 || side(i) > s1;
    // W13-C (28.09.2026): die Flanken laufen als Böschung nach vorn aus (bis `FLANK_RUN` weiter, Talus 1) statt an einem
    // senkrechten Anschnitt zu enden – die Front liegt eingerückt zwischen zwei weichen Hügelarmen
    const reach = m.wing > 0 ? m.wing + FLANK_RUN : m.wing;
    const open = (i: number): boolean => fwd(i) <= plane + (beside(i) ? reach : 0) && (own[i] === 1 || !closed(i));
    // Umriss: zwei Harmonische des Winkels um die Mitte (± 8 % Abfallbreite), Phase aus dem Seed
    const rng = new Rng(hashSeed(seed, 'mound-outline', m.front, cols.length));
    const p2 = rng.next() * Math.PI * 2;
    const p3 = rng.next() * Math.PI * 2;
    const lumpy = hashSeed(seed, 'mound-lumps', m.front, cols.length);
    let mx = 0;
    let mz = 0;
    for (const i of cols) {
      mx += grid.x(i);
      mz += grid.z(i);
    }
    mx /= cols.length;
    mz /= cols.length;
    const src = cols.map((i) => ({ x: grid.x(i), z: grid.z(i), v: val[i]!, h: val[i]! - building.y0 }));
    // W9-G4 (nur mit Flanken): Kuppel statt Kegel – Viertelellipse (`domeDrop`): oben breite, flache Stufen, zum Fuß hin
    // enger (die Talus-Sicherung zieht den Fuß mit Steigung 1 aus). Gleich breite Stufen lasen sich als Treppenpyramide.
    for (let j = 0; j < n; j++) {
      if (own[j] === 1 || !open(j)) continue;
      const x = grid.x(j);
      const z = grid.z(j);
      const th = Math.atan2(z - mz, x - mx);
      const wob = 1 + 0.05 * Math.cos(2 * th + p2) + 0.03 * Math.cos(3 * th + p3);
      // Rauschen (Maßstab 5, ± 1 Block): die Höhenlinien mäandern, statt als Ringe um die Kuppe zu laufen
      const jitter = 2 * (valueNoise2(lumpy, x, z, 5) - 0.5);
      let best = -Infinity;
      for (const q of src) {
        const d = Math.max(0, Math.hypot(q.x - x, q.z - z) * wob + jitter);
        if (d >= (dome ? domeWidth(q.h) : q.h + RAMP)) continue;
        const v = q.v - (dome ? domeDrop(d, q.h) : moundDrop(d, q.h));
        if (v > best) best = v;
      }
      if (fwd(j) > plane) best -= fwd(j) - plane;
      if (best > building.y0) val[j] = best;
    }
    // Talus-Sicherung wie bisher: Wert − Abstand (orthogonal 1, diagonal 1,5), wiederholte Durchläufe bis stabil
    const STEPS: readonly (readonly [number, number, number])[] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.5], [1, -1, 1.5], [-1, 1, 1.5], [-1, -1, 1.5]];
    for (let changed = true; changed; ) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < n; k++) {
          const i = pass === 0 ? k : n - 1 - k;
          if (val[i] === -Infinity) continue;
          for (const [dx, dz, cost] of STEPS) {
            const j = grid.at(grid.x(i) + dx, grid.z(i) + dz);
            if (j < 0 || !open(j) || val[j]! >= val[i]! - cost) continue;
            val[j] = val[i]! - cost;
            changed = true;
          }
        }
      }
    }
    const h = new Int32Array(n).fill(NO_MOUND);
    for (let i = 0; i < n; i++) if (val[i] !== -Infinity) h[i] = Math.floor(val[i]! + 0.5);
    // nur mit Flanken (Hülle seit W9-G4): ohne `wing` bleibt der Hügel bitgleich
    if (m.wing > 0) smoothMound(grid, h, own, building.y0);
    if (m.wing > 0) hollow(grid, h, own, cols, fwd, side, plane, reach, s0, s1, m.cover, building.y0, (i) => m.tops.get(cellKey(grid.x(i), grid.z(i)))!, hashSeed(seed, 'mound-terraces', m.front, cols.length));
    for (let i = 0; i < n; i++) {
      if (h[i] === NO_MOUND) continue;
      if (own[i] === 1 || h[i]! > building.y0) top[i] = Math.max(top[i]!, h[i]!);
    }
  }
  return { top, roof };
}

/**
 * W9-G4 (plan/spikes/W9G4_erdhaus.md, Vorbilder „nie mehr als eine Einzelsäule“): Einzelspitzen und Einzellöcher des
 * gerundeten Hügels glätten – eine Spalte außerhalb des Grundrisses, die höher (tiefer) liegt als alle vier Nachbarn,
 * rückt eine Stufe an sie heran. Nachbarn ohne Hügel zählen mit der Grundhöhe. Ein Durchlauf auf einer Kopie
 * (reihenfolge-unabhängig, deterministisch).
 */
function smoothMound(grid: PlotGrid, h: Int32Array, own: Uint8Array, y0: number): void {
  const before = Int32Array.from(h);
  const at = (j: number): number => (before[j] === NO_MOUND ? y0 : before[j]!);
  for (let i = 0; i < h.length; i++) {
    if (own[i] === 1 || before[i] === NO_MOUND) continue;
    const x = grid.x(i);
    const z = grid.z(i);
    const nb = [grid.at(x + 1, z), grid.at(x - 1, z), grid.at(x, z + 1), grid.at(x, z - 1)];
    if (nb.some((j) => j < 0)) continue;
    const v = before[i]!;
    if (nb.every((j) => at(j) < v)) h[i] = v - 1;
    else if (nb.every((j) => at(j) > v)) h[i] = v + 1;
  }
}

/**
 * W13-C (28.09.2026, plan/spikes/W13C_erdhaus_huegel.md, Blindvergleich „Deckel“, „Erdwände neben der Front“): der
 * Hügel umschließt die Front weich.
 *  - Die Frontreihe trägt genau `cover` Erdlagen über ihrer Oberkante (Stirnbogen), hinter ihr steigt der Hügel um
 *    höchstens eine Stufe je Block (Grenze: Oberkante der Frontreihe + Abstand).
 *  - Neben der Front liegt jede Spalte höchstens 1 + ihr Abstand zum vorderen Ende der Flanke: die Flanken fallen nach
 *    vorn als Terrassen in die Wiese ab, statt als Wand zu enden; neben der Front bleibt der Hügel so hoch wie der
 *    Stirnbogen (die Front sitzt im Hügel, nicht davor).
 *  - Über dem Grundriss bleiben `cover` Erdlagen, neben dem Grundriss (bis zur Frontebene) deckt der Hügel die Seitenwand.
 *  - Runde 2: Rauschen aus dem Seed hebt oder senkt Flecken um eine Stufe (unregelmäßige Terrassen).
 *  - Danach Talus 1 (orthogonal) nach oben, außer über den Anschnitt in der Frontebene direkt neben der Front (dort
 *    steht die Erde als Laibung senkrecht): Nachbarn unterscheiden sich sonst um höchstens eine Stufe.
 */
function hollow(
  grid: PlotGrid, h: Int32Array, own: Uint8Array, cols: readonly number[], fwd: (i: number) => number, side: (i: number) => number,
  plane: number, reach: number, s0: number, s1: number, cover: number, y0: number, roofAt: (i: number) => number, bumps: number,
): void {
  const front = cols.filter((i) => fwd(i) === plane);
  if (front.length === 0) return;
  for (const i of front) h[i] = roofAt(i) + cover;
  const tips = front.map((i) => ({ x: grid.x(i), z: grid.z(i), t: h[i]! }));
  const lo = new Int32Array(h.length).fill(NO_MOUND);
  for (let i = 0; i < h.length; i++) {
    if (h[i] === NO_MOUND) continue;
    if (own[i] === 1) lo[i] = roofAt(i) + cover;
    else if (fwd(i) <= plane) for (const j of grid.n4(i)) if (own[j] === 1) lo[i] = Math.max(lo[i]!, roofAt(j) + 1);
  }
  for (let i = 0; i < h.length; i++) {
    if (h[i] === NO_MOUND || (own[i] === 1 && fwd(i) === plane)) continue;
    const x = grid.x(i);
    const z = grid.z(i);
    let cap = Infinity;
    for (const f of tips) cap = Math.min(cap, f.t + Math.floor(Math.hypot(f.x - x, f.z - z)));
    cap = Math.min(cap, y0 + 1 + plane + reach - fwd(i));
    // Runde 2: Terrassen unregelmäßig – Rauschen aus dem Seed (Maßstab 3) hebt oder senkt einzelne Flecken um eine
    // Stufe; Talus unten schließt Gruben, die Grenzen oben bleiben
    const n = valueNoise2(bumps, x, z, 3);
    const bump = n > 0.64 ? 1 : n < 0.3 ? -1 : 0;
    h[i] = Math.max(lo[i] === NO_MOUND ? -Infinity : lo[i]!, Math.min(h[i]! + bump, cap));
  }
  // Talus 1 nach oben (orthogonal), nicht über den Anschnitt in der Frontebene direkt neben der Front (Laibung)
  const jamb = (i: number): boolean => Math.max(s0 - side(i), side(i) - s1, 0) <= 1;
  for (let changed = true; changed; ) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < h.length; k++) {
        const i = pass === 0 ? k : h.length - 1 - k;
        if (h[i] === NO_MOUND) continue;
        for (const j of grid.n4(i)) {
          if (h[j] === NO_MOUND || h[j]! >= h[i]! - 1 || ((fwd(i) > plane) !== (fwd(j) > plane) && jamb(i))) continue;
          h[j] = h[i]! - 1;
          changed = true;
        }
      }
    }
  }
}

/** W16-C: Grasnarbe über dem Bogenband – Erde von `from` bis `top` (oben Moos) in der Spalte vor der Frontreihe. */
export interface BandLip {
  readonly from: number;
  readonly top: number;
}

/**
 * W16-C (28.09.2026, plan/spikes/W16C_erdhaus.md, Blindvergleich „aufgesetzt statt eingegraben“, „Holzdeckel“): die
 * Grasnarbe greift über das Bogenband. In jeder Spalte direkt vor der Frontreihe (Ebene +1, quer innerhalb des
 * Grundrisses) liegt über der obersten Hüllzelle Erde bis zur Oberkante des Hügels dahinter (Frontreihe: Decke +
 * `cover`), oben Moos. Die Erde ruht auf dem Band (nichts schwebt), die Höhe folgt der Frontreihe (Stufe ≤ 1 wie dort),
 * quer zur Front höchstens eine Stufe zur Nachbarspalte und zum Hügelarm daneben.
 * Nur mit Flanken (`wing` > 0), sonst leer.
 */
export function bandLip(grid: PlotGrid, building: BuildingInfo, hill: MoundField, side: (j: number) => number | undefined = () => undefined): Map<number, BandLip> {
  const out = new Map<number, BandLip>();
  const m = (building.buried ?? []).find((b) => b.wing > 0);
  if (m === undefined) return out;
  let plane = -Infinity;
  for (const k of m.tops.keys()) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    plane = Math.max(plane, forward(m.front, x, z));
  }
  const colTop = new Map<string, number>();
  for (const k of building.occupied) {
    const [x, y, z] = k.split(',').map(Number) as [number, number, number];
    const c = cellKey(x, z);
    colTop.set(c, Math.max(colTop.get(c) ?? -Infinity, y));
  }
  const [fx, fz] = DIR_OFFSET[m.front];
  const base = new Map<number, number>();
  const want = new Map<number, number>();
  for (const k of [...m.tops.keys()].sort()) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    if (forward(m.front, x, z) !== plane) continue;
    const j = grid.at(x, z);
    const i = grid.at(x + fx, z + fz);
    const t = colTop.get(cellKey(x + fx, z + fz));
    if (i < 0 || j < 0 || t === undefined || hill.top[j] === NO_MOUND || hill.top[j]! <= t) continue;
    base.set(i, t);
    want.set(i, hill.top[j]!);
  }
  // quer zur Front höchstens eine Stufe zwischen benachbarten Spalten der Narbe und zum Hügelarm daneben (`side`): erst
  // zum Arm hin anheben, dann wie Talus nur absenken, bis stabil (monoton, deterministisch)
  const order = [...want.keys()].sort((p, q) => p - q);
  const lateral = (i: number): number[] => grid.n4(i).filter((n) => forward(m.front, grid.x(n), grid.z(n)) === plane + 1);
  for (const i of order) for (const n of lateral(i)) {
    const h = want.has(n) ? undefined : side(n);
    if (h !== undefined) want.set(i, Math.max(want.get(i)!, h - 1));
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const i of order) {
      let v = want.get(i)!;
      for (const n of lateral(i)) {
        const h = want.get(n) ?? side(n);
        if (h !== undefined) v = Math.min(v, h + 1);
      }
      if (v < want.get(i)!) {
        want.set(i, v);
        changed = true;
      }
    }
  }
  for (const i of order) if (want.get(i)! > base.get(i)!) out.set(i, { from: base.get(i)! + 1, top: want.get(i)! });
  return out;
}

/** Eine Spalte des Erdhügels für Vorschauen: Erde von `from` bis `top` (beide einschließlich). */
export interface MoundColumn {
  readonly x: number;
  readonly z: number;
  readonly from: number;
  readonly top: number;
}

/**
 * W9-G4 (plan/spikes/W9G4_erdhaus.md, Review R5 G4 „Vorschaukarte ohne Hügel“): Spalten des Erdhügels ohne das ganze
 * Gelände – für Vorschaubilder (Assistent). Dieselbe Form wie beim Überdecken (`moundField`) auf ebenem Grund: Hüllzellen
 * außerhalb des Grundrisses bleiben frei, über dem Grundriss liegt die Erde ab der obersten Hüllzelle. Leer ohne Lage
 * `buried`. Rein und deterministisch (Seed nur für den gewellten Umriss).
 */
export function moundColumns(building: BuildingInfo, seed = 0, margin = 15): MoundColumn[] {
  if ((building.buried ?? []).length === 0) return [];
  const grid = new PlotGrid(plotAround(building, margin));
  const closed = (i: number): boolean => building.footprint.has(grid.x(i), grid.z(i)) || building.covered.has(grid.x(i), grid.z(i));
  const hill = moundField(grid, building, closed, seed);
  if (hill === undefined) return [];
  const out: MoundColumn[] = [];
  for (let i = 0; i < grid.size; i++) {
    const top = hill.top[i]!;
    if (top === NO_MOUND) continue;
    const roof = hill.roof[i]!;
    const from = roof !== NO_MOUND ? roof + 1 : building.y0 + 1;
    if (top >= from) out.push({ x: grid.x(i), z: grid.z(i), from, top });
  }
  return out;
}

/**
 * Bepflanzung des Hügels (research/19 BT16 „begehbar und bepflanzt“): je Spalte ein eigener Zufall aus dem Gelände-Seed.
 * Nur auf Gras mit freier Luft darüber.
 *
 * W7-I (Vorbilder plan/spikes/W7I_gelaende.md: Blumen auf dem Hügel 8/14, Azaleen 7/14): Blumen in **Flecken** statt
 * Konfetti (Rauschen, je Fleck eine Farbwelt), Blütenteppich in eigenen Flecken, Azaleenbüsche vor allem am Fuß der
 * Böschung und vereinzelt auf der Kuppe, dazwischen Grasbüschel.
 */
export function plantMound(g: Gen, hill: MoundField): { readonly ground: number; readonly bushes: number } {
  const { grid, cls, top, surface } = g;
  const y0 = g.building.y0;
  const patch = hashSeed(g.seed, 'mound-flowers');
  const tint = hashSeed(g.seed, 'mound-tint');
  const petals = hashSeed(g.seed, 'mound-petals');
  let ground = 0;
  let bushes = 0;
  const edges = (g.building.buried ?? []).some((m) => m.wing > 0);
  for (let i = 0; i < grid.size; i++) {
    const onRoof = cls[i] === C.building && hill.roof[i] !== NO_MOUND && hill.top[i]! > hill.roof[i]!;
    const onSlope = cls[i] === C.mound && surface[i] === 'ground_grass';
    if ((!onRoof && !onSlope) || g.plantCol[i] === 1 || g.blocked[i] === 1 || g.path[i] === 1) continue;
    const x = grid.x(i);
    const z = grid.z(i);
    const y = (onRoof ? hill.top[i]! : top[i]!) + 1;
    const rng = new Rng(hashSeed(g.seed, 'mound', x, z));
    const r = rng.next();
    const foot = onSlope && top[i]! - y0 <= 2;
    // W9-G4 (nur mit Flanken): an der Traufkante über der Front (Nachbar vorn tief unten) hängt Laub über die Front
    // (Vorbilder: Blätter und Azaleen über der Tür, 9/19)
    const brow = edges && onRoof && grid.n4(i).some((j) => cls[j] !== C.building && cls[j] !== C.mound && top[j]! <= y0 + 1);
    // W9-G4 (nur mit Flanken): vor einer Stufenkante (Nachbar eine Stufe höher) wachsen Gras und Farn dichter und
    // brechen die Kante; auch sonst dichteres Gras (50 % statt 30 %, Vorbild: hohes Gras deckt den Hügel)
    const riser = edges && onSlope && grid.n4(i).some((j) => (hill.top[j] !== NO_MOUND ? hill.top[j]! : top[j]!) > top[i]!);
    // W13-C (28.09.2026, Blindvergleich „Terrassen wie Kästen“): vor Stufenkanten öfter ein Busch, der die Kante bricht
    const bush = onSlope ? r < (foot ? 0.09 : riser ? 0.08 : 0.03) : r < (brow ? 0.3 : 0.015);
    let placed = false;
    if (bush) placed = g.emit([x, y, z], 'plant', 'leaves_bush', 'block');
    else if (riser && r < 0.75) placed = g.emit([x, y, z], 'plant', 'grass_tuft', 'block');
    else if (edges && r < 0.5 && valueNoise2(patch, x, z, 4) <= 0.6 && valueNoise2(petals, x, z, 5) <= 0.72) placed = g.emit([x, y, z], 'plant', 'grass_tuft', 'block');
    else if (valueNoise2(patch, x, z, 4) > 0.6) {
      if (r < 0.7) placed = g.emit([x, y, z], 'plant', valueNoise2(tint, x, z, 7) < 0.5 ? 'flower_wild' : 'flower_warm', 'block');
    } else if (valueNoise2(petals, x, z, 5) > 0.72) {
      if (r < 0.55) placed = g.emit([x, y, z], 'plant', 'ground_cover', 'block', { facing: rng.pick(HORIZONTAL) });
    } else if (r < 0.3) placed = g.emit([x, y, z], 'plant', 'grass_tuft', 'block');
    else if (r < 0.33) placed = g.emit([x, y, z], 'plant', 'flower_wild', 'block');
    if (!placed) continue;
    g.plantCol[i] = 1;
    if (bush) {
      g.blocked[i] = 1;
      bushes++;
    } else ground++;
  }
  return { ground, bushes };
}

/** Katalog-ID des Erdhaus-Portals (W7-I, `catalog/components/exterior/earth_portal.json5`). */
export const EARTH_PORTAL = 'exterior/earth_portal';

/**
 * W7-I Erdhaus-Portal an der Rundtür (Vorbilder: runde Türfläche mit Tür in der Mitte 6/14, Laterne an der Tür 9/14):
 * vor jeder Außentür in der Frontebene eines eingegrabenen Baukörpers erkennt das Gelände den Holzring der Hülle an
 * seinen belegten Zellen (Ring 5 breit bzw. schmal 3 breit, blueprint `buried.ts`) und setzt die Stücke des Moduls:
 * Türblatt aus Falltüren im Ring (nur beim breiten Ring) und ein Laternenpaar auf die Schultern des Rings. Jedes Stück
 * ganz oder gar nicht (Zelle belegt, Luftmaske belegt oder Laterne ohne Unterlage → entfällt). Die Spalten des Türblatts
 * sind danach für Wege und Pflanzen gesperrt; das Licht der Laternen sieht der Licht-Pass (`propCells`).
 */
export function placeEarthPortals(g: Gen, catalog: Catalog, dataVersion?: number): OutdoorPlacement[] {
  const mounds = g.building.buried ?? [];
  if (mounds.length === 0) return [];
  const def = catalog.byTags(['earth_portal'], dataVersion).find((d) => d.id === EARTH_PORTAL);
  if (def === undefined) return [];
  const out: OutdoorPlacement[] = [];
  const occ = (p: Vec3): boolean => g.building.occupied.has(key3(p));
  for (const m of mounds) {
    let plane = -Infinity;
    for (const k of m.tops.keys()) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      plane = Math.max(plane, forward(m.front, x, z));
    }
    for (const d of g.building.doors) {
      if (d.outward !== m.front || !m.tops.has(cellKey(d.cell[0], d.cell[1])) || forward(m.front, d.cell[0], d.cell[1]) !== plane) continue;
      const [fx, fz] = DIR_OFFSET[m.front];
      const [ax, az] = fz !== 0 ? [1, 0] : [0, 1]; // entlang der Front (wie die Hülle: Osten bzw. Süden)
      const b = g.building.y0 + 1; // untere Türhälfte
      const P = (u: number, dy: number): Vec3 => [d.cell[0] + fx + ax * u, b + dy, d.cell[1] + fz + az * u];
      // W9-G4: große Rundtür (Ring r = 3, Hülle seit W9-G4), sonst breit (r = 2) bzw. schmal (r = 1). W12-B
      // (28.09.2026, plan/spikes/W12B_erdhausfront.md): lückenloser Bogen – das Türblatt füllt nur noch die Öffnung unter
      // den Kämpfertreppen, die Laternen stehen auf den äußeren Pfosten (r = 3: Reihe b+4)
      const round = [P(-3, 0), P(3, 0), P(-3, 2), P(3, 2), P(-2, 3), P(2, 3), P(0, 4)].every(occ);
      const wide = !round && [P(-2, 0), P(2, 0), P(-2, 2), P(2, 2), P(-1, 3), P(1, 3), P(0, 3)].every(occ);
      const narrow = !round && !wide && [P(-1, 0), P(1, 0), P(-1, 2), P(1, 2), P(0, 2)].every(occ);
      // je Gruppe das erste passende Stück: Türblatt (sonst nur sein Kopf), Laternenpaar
      const groups: ReadonlyArray<ReadonlyArray<readonly [string, number]>> = round ? [[['leaf_round', 0], ['leaf_round_top', 2]], [['lanterns_wide', 4]]]
        : wide ? [[['leaf', 0]], [['lanterns', 3]]]
        : narrow ? [[['lanterns_narrow', 3]]] : [];
      for (const group of groups) for (const [variantId, dy] of group) {
        const exp = expandComponent(def, variantId);
        const rot = ({ south: 0, west: 1, north: 2, east: 3 } as const)[m.front];
        const t = transformLocal([(exp.size[0] - 1) / 2, 0, 0], exp.size, rot, 'none');
        const at = P(0, dy);
        const pose: Pose = { pos: [at[0] - t[0], at[1] - t[1], at[2] - t[2]], rot, mirror: 'none' };
        const placed = placeComponent(exp, pose);
        const free = (p: Vec3): boolean => !occ(p) && !g.out.has(key3(p)) && !g.propCells.has(key3(p));
        if (!placed.cells.every((c) => free(c.pos)) || !placed.air.every(free)) continue;
        // stehende Laterne: darunter eine Zelle der Hülle (umgedrehte Treppe des Rings, volle Oberseite)
        if (placed.cells.some((c) => c.mat.shape === 'lantern' && !occ([c.pos[0], c.pos[1] - 1, c.pos[2]]))) continue;
        for (const c of placed.cells) {
          const lamp = c.mat.shape === 'lantern';
          g.propCells.set(key3(c.pos), { op: 0, light: lamp ? 15 : 0 });
          const i = g.grid.at(c.pos[0], c.pos[2]);
          if (i >= 0 && !lamp) {
            g.blocked[i] = 1;
            g.plantCol[i] = 1;
            g.propCol[i] = 1;
          }
        }
        out.push({
          id: `mound:portal:${out.length}`, componentId: def.id, variantId, pose, seed: hashSeed(g.seed, 'earth-portal', out.length),
          zoneId: 'mound:portal', zoneKind: 'path', cell: [pose.pos[0], pose.pos[2]],
        });
        break;
      }
    }
  }
  return out;
}

/**
 * W12-B (28.09.2026, plan/spikes/W12B_erdhausfront.md): Laub über der Traufe – der Übergang von der Front zum Hügel ist
 * kein harter Grasdeckel mehr. Auf der Traufleiste (Hüllzelle eine Ebene vor der Front, Reihe b+3) liegt in Flecken
 * Laub (Reihe b+4), spiegelgleich zur Haustür (Rauschen über den Abstand zur Türachse). Vorbilder: Laub stufenweise über
 * der Tür, jede Reihe 1 höher und 1 zurück (Bericht §1); Sodendach mit Traufholz. Nur mit Flanken (`wing` > 0, sonst
 * bitgleich); frei bleiben Laternen- und Portalzellen (nach `placeEarthPortals`).
 */
export function hangEaves(g: Gen, lip: ReadonlyMap<number, BandLip> = new Map()): number {
  let n = 0;
  const occ = (p: Vec3): boolean => g.building.occupied.has(key3(p));
  const seed = hashSeed(g.seed, 'mound-eaves');
  for (const m of g.building.buried ?? []) {
    if (m.wing <= 0) continue;
    let plane = -Infinity;
    for (const k of m.tops.keys()) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      plane = Math.max(plane, forward(m.front, x, z));
    }
    const door = g.building.doors.find((d) => d.outward === m.front && m.tops.has(cellKey(d.cell[0], d.cell[1])) && forward(m.front, d.cell[0], d.cell[1]) === plane);
    if (door === undefined) continue;
    const [fx, fz] = DIR_OFFSET[m.front];
    const alongX = fz !== 0;
    const b = g.building.y0 + 1;
    for (const k of [...m.tops.keys()].sort()) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      if (forward(m.front, x, z) !== plane) continue;
      // W13-C (28.09.2026): auf der obersten Zelle vor der Wand (Traufleiste oder Rahmen des Stirnbogens), nie vor einer
      // Hüllzelle der Wandebene – das Laub hängt über den Bogen wie bei den Vorbildern
      let y = b + 4;
      for (let t = b + 12; t >= b + 3; t--) if (occ([x + fx, t, z + fz])) { y = t + 1; break; }
      // W16-C: über der Grasnarbe auf dem Bogenband (bandLip) wächst das Laub auf dem Gras
      const top = lip.get(g.grid.at(x + fx, z + fz));
      if (top !== undefined) y = top.top + 1;
      const p: Vec3 = [x + fx, y, z + fz];
      if ((top === undefined && !occ([p[0], y - 1, p[2]])) || occ(p) || occ([x, y, z]) || g.out.has(key3(p)) || g.propCells.has(key3(p))) continue;
      const d = Math.abs(alongX ? x - door.cell[0] : z - door.cell[1]);
      if (valueNoise2(seed, d, 0, 3) > 0.55) continue;
      if (g.emit(p, 'plant', 'leaves_bush', 'block')) n++;
    }
  }
  return n;
}

/**
 * W13-C Runde 2 (28.09.2026, plan/spikes/W13C_erdhaus_huegel.md): Vorgarten wie die Vorbilder – ein gerader Weg von der
 * Rundtür durch den Garten (3 breit, Trittsteine), die Beete liegen links und rechts davon. Garten und Rasen liegen bis
 * `WALK` Blöcke vor der Front auf Grundhöhe; dort schließen ein Blumenbeet (eine Stufe höher) und ein Zaun quer zur Achse
 * mit je einem Zaunpfosten mit Laterne den Vorgarten ab. Spiegelgleich zur Tür,
 * einzelne Zellen entfallen, wo etwas steht (Katalog-Objekt, Stamm). Nur mit Flanken und nur, wenn die Türachse den
 * Garten vor der Front kreuzt; sonst unverändert. Gibt die gesetzten Laternen zurück.
 */
export function frontGarden(g: Gen, garden: readonly number[]): Vec3[] {
  const lights: Vec3[] = [];
  const m = (g.building.buried ?? []).find((b) => b.wing > 0);
  if (m === undefined || garden.length === 0) return lights;
  let plane = -Infinity;
  for (const k of m.tops.keys()) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    plane = Math.max(plane, forward(m.front, x, z));
  }
  const door = g.building.doors.find((d) => d.outward === m.front && m.tops.has(cellKey(d.cell[0], d.cell[1])) && forward(m.front, d.cell[0], d.cell[1]) === plane);
  if (door === undefined) return lights;
  const { grid } = g;
  const [fx, fz] = DIR_OFFSET[m.front];
  const alongX = fz !== 0;
  const du = alongX ? door.cell[0] : door.cell[1];
  const uOf = (i: number): number => (alongX ? grid.x(i) : grid.z(i));
  const fOf = (i: number): number => forward(m.front, grid.x(i), grid.z(i));
  const at = (u: number, f: number): number => (alongX ? grid.at(u, f * fz) : grid.at(f * fx, u));
  const own = garden.filter((i) => fOf(i) > plane && Math.abs(uOf(i) - du) <= 8);
  if (!own.some((i) => uOf(i) === du)) return lights;
  const far = Math.max(...own.map(fOf));
  const half = Math.min(du - Math.min(...own.map(uOf)), Math.max(...own.map(uOf)) - du);
  if (half < 3) return lights;
  const clearPlant = (i: number): boolean => {
    const k = key3([grid.x(i), g.top[i]! + 1, grid.z(i)]);
    const c = g.out.get(k);
    if (c !== undefined && c.kind !== 'plant') return false;
    if (c !== undefined && !/^(flower_|grass_tuft|ground_cover|leaves_bush|crop_)/.test(String(c.role))) return false;
    if (c !== undefined) g.out.delete(k);
    g.plantCol[i] = 0;
    if (c?.role === 'leaves_bush') g.blocked[i] = 0;
    return true;
  };
  // Garten und Rasen davor auf Grundhöhe (wie der Vorplatz), bis `WALK` Blöcke vor die Front: ein vertiefter Vorgarten
  // zwischen den Hügelarmen – Beete, Weg und Rasen liegen nicht über der Türschwelle, der Blick von der Gartenpforte zur Tür bleibt frei (Hof-Kamera der Galerie, camera-rig.js).
  // Pflanzen wandern mit; Spalten mit Katalog-Objekt bleiben (ein Block höher wie ein Pflanzkasten).
  const y0 = g.building.y0;
  const end = Math.max(far + 1, plane + WALK);
  const sunk: number[] = [];
  for (let f = plane + 1; f <= end; f++) for (let u = du - half - 1; u <= du + half + 1; u++) {
    const i = at(u, f);
    if (i >= 0 && g.struct[i] === 0 && g.water[i] === 0) sunk.push(i);
  }
  for (const i of sunk) {
    if (g.top[i]! <= y0 || g.propCol[i] === 1 || g.cls[i] === C.building || g.cls[i] === C.mound) continue;
    const from = key3([grid.x(i), g.top[i]! + 1, grid.z(i)]);
    const c = g.out.get(from);
    if (c !== undefined && (c.kind !== 'plant' || g.out.has(key3([grid.x(i), g.top[i]! + 2, grid.z(i)])))) continue;
    if (c !== undefined) {
      g.out.delete(from);
      const pos: Vec3 = [grid.x(i), y0 + 1, grid.z(i)];
      g.out.set(key3(pos), { ...c, pos });
    }
    g.top[i] = y0;
  }
  // Weg auf Türhöhe (Vorplatz, Grundhöhe) von der Tür durch den Garten bis `WALK` Blöcke vor die Front; dort schließt ein
  // Blumenbeet eine Stufe höher (Beetkante) den Weg ab. So ist der Hof vor der Tür begrenzt und tief genug, dass die
  // Hof-Kamera der Galerie (website/js/camera-rig.js `yardDepth`) bei etwa 15 Blöcken steht und die Front ganz sieht.
  for (let f = plane + 1; f <= end; f++) {
    for (let u = du - 1; u <= du + 1; u++) {
      const i = at(u, f);
      if (i < 0 || g.propCol[i] === 1 || g.cls[i] === C.building || g.cls[i] === C.mound || g.struct[i] !== 0 || g.water[i] !== 0 || !clearPlant(i)) continue;
      if (g.surface[i] !== 'path_main' && g.surface[i] !== 'ground_path' && g.surface[i] !== 'ground_yard') g.surface[i] = 'path_stone';
      g.path[i] = 1;
      g.top[i] = Math.min(g.top[i]!, g.building.y0);
    }
  }
  for (let u = du - 2; u <= du + 2; u++) {
    const i = at(u, end + 1);
    if (i < 0 || g.propCol[i] === 1 || g.path[i] === 1 || g.cls[i] === C.building || g.cls[i] === C.mound || g.struct[i] !== 0 || g.water[i] !== 0 || !clearPlant(i)) continue;
    g.top[i] = Math.max(g.top[i]!, g.building.y0 + 1);
    g.surface[i] = 'ground_grass';
    if (g.emit([grid.x(i), g.top[i]! + 1, grid.z(i)], 'plant', Math.abs(u - du) === 2 ? 'leaves_bush' : 'flower_warm', 'block')) {
      g.plantCol[i] = 1;
      g.blocked[i] = 1;
    }
  }
  // Gartenzaun vorn (hinter dem Abschlussbeet), Zaunpfosten mit Laterne beidseits des Beets
  const f = end + 1;
  for (let d = 3; d <= half + 1; d++) {
    const cols = [at(du - d, f), at(du + d, f)];
    if (cols.some((i) => i < 0 || g.path[i] === 1 || g.propCol[i] === 1 || g.cls[i] === C.building || g.cls[i] === C.mound || g.struct[i] !== 0 || g.water[i] !== 0)) continue;
    if (!cols.every(clearPlant)) continue;
    for (const i of cols) {
      const y = g.top[i]! + 1;
      const p: Vec3 = [grid.x(i), y, grid.z(i)];
      if (d === 3) {
        // Zaunpfosten mit Laterne (dünn: verdeckt die Front nicht wie ein Stamm)
        if (!g.emit(p, 'plant', 'fence_outdoor', 'fence')) continue;
        const l: Vec3 = [p[0], y + 1, p[2]];
        if (g.emit(l, 'plant', 'light_outdoor', 'lantern')) {
          lights.push(l);
          g.propCells.set(key3(l), { op: 0, light: 15 });
        }
      } else g.emit(p, 'plant', 'fence_outdoor', 'fence');
      g.blocked[i] = 1;
      g.plantCol[i] = 1;
    }
  }
  return lights;
}

/** Katalog-ID des Schornsteins (X1 D12), den der Hügel über dem Erdhaus trägt (W16-C). */
export const MOUND_CHIMNEY = 'exterior/chimney';

/**
 * W16-C (28.09.2026, plan/spikes/W16C_erdhaus.md, Blindvergleich R7-3: Vorbilder mit „Kamin im Hang“ und Bäumen auf
 * dem Hügel): der Hügel über dem Erdhaus trägt einen Schornstein und einen Baum.
 *  - Schornstein (Katalog `exterior/chimney`, Schaft 2 + Kopf mit Lagerfeuer) auf der Grasnarbe, drei Reihen hinter der
 *    Front, vier Spalten neben der Türachse (Seite aus dem Seed) – dort liegt vorn eine Stube mit Herd (Küche/Stube).
 *  - Eine Eiche auf der Flanke, bevorzugt auf der anderen Seite, 2–4 Spalten neben dem Grundriss und 3–7 Reihen hinter
 *    der Front (erste passende Stelle); das Laub endet über der Grasnarbe (nie in der Erde).
 * Beides ganz oder gar nicht; nur mit Flanken (`wing` > 0), sonst unverändert.
 */
export function crownMound(g: Gen, hill: MoundField, catalog: Catalog | undefined, dataVersion?: number): OutdoorPlacement[] {
  const out: OutdoorPlacement[] = [];
  const m = (g.building.buried ?? []).find((b) => b.wing > 0);
  if (m === undefined) return out;
  let plane = -Infinity;
  for (const k of m.tops.keys()) {
    const [x, z] = k.split(',').map(Number) as [number, number];
    plane = Math.max(plane, forward(m.front, x, z));
  }
  const door = g.building.doors.find((d) => d.outward === m.front && m.tops.has(cellKey(d.cell[0], d.cell[1])) && forward(m.front, d.cell[0], d.cell[1]) === plane);
  if (door === undefined) return out;
  const { grid } = g;
  const [fx, fz] = DIR_OFFSET[m.front];
  const alongX = fz !== 0;
  const du = alongX ? door.cell[0] : door.cell[1];
  const colAt = (u: number, back: number): number => (alongX ? grid.at(u, (plane - back) * fz) : grid.at((plane - back) * fx, u));
  const ground = (j: number): number => (hill.top[j] !== NO_MOUND ? hill.top[j]! : g.top[j]!);
  const owned = (j: number): boolean => j >= 0 && m.tops.has(cellKey(grid.x(j), grid.z(j))) && hill.top[j] !== NO_MOUND;
  const rng = new Rng(hashSeed(g.seed, 'mound-crown', m.front));
  const side = rng.chance(0.5) ? 1 : -1;
  // Schornstein
  const def = catalog?.byTags(['exterior_roof'], dataVersion).find((d) => d.id === MOUND_CHIMNEY);
  const c = colAt(du + 4 * side, 3);
  if (def !== undefined && owned(c)) {
    const variantId = `${rng.chance(2 / 3) ? 'brick' : 'stone'}~1`;
    const exp = expandComponent(def, variantId);
    const rot = ({ south: 0, west: 1, north: 2, east: 3 } as const)[m.front];
    const t = transformLocal([1, 0, 1], exp.size, rot, 'none');
    const at: Vec3 = [grid.x(c), ground(c) + 1, grid.z(c)];
    const pose: Pose = { pos: [at[0] - t[0], at[1] - t[1], at[2] - t[2]], rot, mirror: 'none' };
    const placed = placeComponent(exp, pose);
    const free = (p: Vec3): boolean => {
      const j = grid.at(p[0], p[2]);
      return j >= 0 && p[1] > ground(j) && !g.building.occupied.has(key3(p)) && !g.out.has(key3(p)) && !g.propCells.has(key3(p));
    };
    if (placed.cells.every((q) => free(q.pos)) && placed.air.every(free)) {
      for (const q of placed.cells) {
        const fire = /campfire/.test(String(q.mat.block ?? ''));
        g.propCells.set(key3(q.pos), { op: fire ? 0 : 2, light: fire ? 15 : 0 });
        const j = grid.at(q.pos[0], q.pos[2]);
        g.blocked[j] = 1;
        g.plantCol[j] = 1;
        g.propCol[j] = 1;
      }
      out.push({
        id: 'mound:chimney:0', componentId: def.id, variantId, pose, seed: hashSeed(g.seed, 'mound-chimney'),
        zoneId: 'mound:chimney', zoneKind: 'path', cell: [grid.x(c), grid.z(c)],
      });
    }
  }
  // Baum auf der Flanke (zuerst die Gegenseite des Schornsteins), neben dem Grundriss: der Hügel über den Räumen bleibt
  // frei. Erste passende Stelle aus einer festen Reihe von Kandidaten (Abstand zum Grundriss, Reihen hinter der Front)
  const us = [...m.tops.keys()].map((k) => { const [x, z] = k.split(',').map(Number) as [number, number]; return alongX ? x : z; });
  const [lo, hi] = [Math.min(...us), Math.max(...us)];
  const trunk = new Rng(hashSeed(g.seed, 'mound-tree'));
  outer: for (const sd of [-side, side]) {
    for (const back of [4, 5, 3, 6, 7]) {
      for (const off of [3, 4, 2]) {
        const tc = colAt(sd > 0 ? hi + off : lo - off, back);
        if (tc < 0 || hill.top[tc] === NO_MOUND || m.tops.has(cellKey(grid.x(tc), grid.z(tc))) || g.plantCol[tc] === 1 || g.blocked[tc] === 1) continue;
        const tree = growTree('oak', [grid.x(tc), ground(tc), grid.z(tc)], trunk.fork(`${sd},${back},${off}`));
        const fits = tree.blocks.every((b) => {
          const j = grid.at(b.pos[0], b.pos[2]);
          return j >= 0 && b.pos[1] > ground(j) + (b.part === 'leaves' ? 1 : 0) && !g.out.has(key3(b.pos)) && !g.building.occupied.has(key3(b.pos)) && !g.propCells.has(key3(b.pos));
        });
        if (!fits) continue;
        emitTree(g, tree.blocks, 'oak');
        g.plantCol[tc] = 1;
        g.blocked[tc] = 1;
        break outer;
      }
    }
  }
  return out;
}
