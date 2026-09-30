/**
 * W9-G1 (27.09.2026, Review R5 G1 „raus aus der Kiste“): Baumasse-Akzente. Community-Bauten (Mittelalter-, Fachwerk-,
 * Gast- und Bauernhäuser, Quellen in plan/spikes/W9G1_baumasse.md) sind fast nie eine Kiste unter einem Satteldach:
 *
 *  - **Auskragung** (Jetty): jedes bzw. das erste Obergeschoss ragt 1 Block über die Wand darunter hinaus. Die Hülle
 *    setzt darunter Konsolen (F3a, `facade.brackets`), die genau 1 Block tragen – mehr als 1 je Etage entsteht nie.
 *  - **Quergiebel** (T/L, Zwerchhaus) bzw. **Vorbau** (eingeschossiger Windfang): ein Rechteck vor der Front. Das
 *    Satteldach zerlegt den Grundriss in Rechtecke und legt den First des Vorsprungs quer ins Hauptdach (gable.ts),
 *    so entstehen ≥ 2 Firste; ein Vorbau bekommt an der höheren Wand einen eigenen Giebel bzw. ein Pultdach.
 *
 * Die Akzente wachsen die schon gelegten Räume nach außen (kanonisch, Front = Süden = größtes z), die Teilung innen,
 * die Treppen und die Pflichträume bleiben. Rein und deterministisch (eigener Zufallsstrom).
 */
import type { VolumeId } from '@mcda/blueprint';
import { rangeOf, type BuildingFeaturesDef, type BuildingRange } from '@mcda/catalog';
import { CellSet, type Cell, type Rng } from '@mcda/core';
import type { Box } from './frame.js';
import type { PlanRoom } from './plan.js';

/** Ergebnis: Räume mit gewachsenen Zellen und was gebaut wurde (für Tests und Berichte). */
export interface FeatureResult {
  readonly rooms: PlanRoom[];
  readonly jetty: boolean;
  /** Vorsprung vor der Front (kanonisch), fehlt ohne Quergiebel/Vorbau. */
  readonly cross?: Box;
}

const key = (x: number, z: number): string => `${x},${z}`;
const pick = (rng: Rng, r: BuildingRange): number => {
  const [a, b] = rangeOf(r);
  return rng.int(a, b);
};

/** Gewürfelte Lage des Quergiebels bzw. Vorbaus (vor dem Beschneiden auf einen Raum). */
export interface CrossChoice {
  readonly side: 'start' | 'center' | 'end';
  readonly x0: number;
  readonly x1: number;
  readonly depth: number;
  /** Etagen, auf denen der Vorsprung steht. */
  readonly floors: readonly number[];
}

/**
 * Würfelt Lage, Breite und Tiefe des Quergiebels aus `f.cross` (kanonisch vor der Front `main.z1`). Derselbe Zufallsstrom
 * wie in {@link applyFeatures}: der Planer kennt so schon vor der Raumteilung die Außenlinien (Fassadenraster, W6).
 */
export function chooseCross(f: BuildingFeaturesDef | undefined, main: Box, top: number, rng: Rng): CrossChoice | undefined {
  const c = f?.cross;
  if (c === undefined || !rng.fork('cross').chance(c.prob ?? 1)) return undefined;
  const W = main.x1 - main.x0 + 1;
  const cr = rng.fork('crossShape');
  const [w1, w2] = rangeOf(c.width);
  let w = Math.min(W - 2, pick(cr, c.width));
  const depth = pick(cr, c.depth);
  const align = c.align ?? 'center';
  const side = align === 'any' ? cr.pick(['start', 'center', 'end'] as const) : align === 'corner' ? cr.pick(['start', 'end'] as const) : align;
  // mittig nur mit gleicher Parität wie die Front (sonst liegt der Vorsprung schief)
  if (side === 'center' && (W - w) % 2 !== 0) w = w + 1 <= Math.min(w2, W - 2) ? w + 1 : w - 1 >= w1 ? w - 1 : w - 1;
  const x0 = side === 'start' ? main.x0 : side === 'end' ? main.x1 - w + 1 : main.x0 + (W - w) / 2;
  const floors = c.floors === 'ground' ? [0] : Array.from({ length: top + 1 }, (_, k) => k);
  return { side, x0, x1: x0 + w - 1, depth, floors };
}

/**
 * Wächst die Räume des Baukörpers `volumeId` um die Akzente aus `f`. `main` = Rechteck des Hauptbaukörpers (ohne
 * Flügel), `top` = oberste Etage. Liefert die Räume unverändert, wenn nichts passt.
 */
export function applyFeatures(f: BuildingFeaturesDef | undefined, rooms: readonly PlanRoom[], main: Box, volumeId: VolumeId, top: number, rng: Rng): FeatureResult {
  if (f === undefined) return { rooms: [...rooms], jetty: false };
  const out = rooms.map((r) => ({ ...r }));
  // Belegung je Etage (alle Baukörper: nichts wächst in einen anderen hinein)
  const occ = new Map<number, Map<string, number>>();
  const occOf = (fl: number): Map<string, number> => occ.get(fl) ?? occ.set(fl, new Map()).get(fl)!;
  out.forEach((r, i) => { for (const [x, z] of r.cells.toArray()) occOf(r.floor).set(key(x, z), i); });
  const added = new Map<number, Cell[]>();
  const add = (i: number, c: Cell): void => {
    occOf(out[i]!.floor).set(key(c[0], c[1]), i);
    (added.get(i) ?? added.set(i, []).get(i)!).push(c);
  };
  const ownerAt = (fl: number, x: number, z: number): number | undefined => {
    const i = occ.get(fl)?.get(key(x, z));
    return i !== undefined && out[i]!.volumeId === volumeId ? i : undefined;
  };
  const W = main.x1 - main.x0 + 1;

  // ---------------------------------------------------------------- Quergiebel bzw. Vorbau vor der Front
  let cross: Box | undefined;
  /** Zellen eines eingeschossigen Vorbaus: darüber darf das Obergeschoss durchlaufen (der Vorbau trägt). */
  const porch = new Set<string>();
  const c = f.cross;
  const pre = chooseCross(f, main, top, rng);
  if (c !== undefined && pre !== undefined) {
    const { side, depth } = pre;
    let w = pre.x1 - pre.x0 + 1;
    const floors = pre.floors;
    let x0 = pre.x0;
    let x1 = pre.x1;
    // Der Vorsprung liegt nur vor EINEM Raum je Etage (seine Seitenwände verlängern dessen Wände): ragt er über den Raum
    // an der Ecke bzw. in der Mitte hinaus, wird er schmaler (sonst entstünde eine T-Kreuzung mitten in einer Raumwand)
    for (const fl of floors) {
      const anchor = side === 'start' ? x0 : side === 'end' ? x1 : main.x0 + Math.floor((W - 1) / 2);
      const o = ownerAt(fl, anchor, main.z1);
      if (o === undefined) { x1 = x0 - 1; break; }
      const mine = (x: number): boolean => ownerAt(fl, x, main.z1) === o;
      let a = anchor;
      let b = anchor;
      while (a - 1 >= x0 && mine(a - 1)) a--;
      while (b + 1 <= x1 && mine(b + 1)) b++;
      if (side === 'center') {
        const cut = Math.max(a - x0, x1 - b);
        x0 += cut;
        x1 -= cut;
      } else {
        x0 = Math.max(x0, a);
        x1 = Math.min(x1, b);
      }
    }
    w = x1 - x0 + 1;
    if (w >= 5 && depth >= 2) {
      const box: Box = { x0, z0: main.z1 + 1, x1, z1: main.z1 + depth };
      // frei vor der Front auf allen betroffenen Etagen?
      const free = floors.every((fl) => {
        for (let x = box.x0; x <= box.x1; x++) {
          if (ownerAt(fl, x, main.z1) === undefined) return false;
          for (let z = box.z0; z <= box.z1; z++) if (occ.get(fl)?.has(key(x, z)) === true) return false;
        }
        return true;
      });
      if (free) {
        cross = box;
        if (c.floors === 'ground') for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) porch.add(key(x, z));
        for (const fl of floors) {
          // W12-A: eigener Raum im Vorsprung des Erdgeschosses (Diele); die Wand zum Raum dahinter trägt der größere Raum
          if (fl === 0 && c.room !== undefined) {
            const i = out.push({ volumeId, floor: 0, cells: CellSet.of([]), roomTypeId: c.room, entry: -1, required: false }) - 1;
            for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) add(i, [x, z]);
            continue;
          }
          // der Raum, der am meisten der Frontlinie hinter dem Vorsprung besitzt, bekommt ihn ganz (keine schmalen Streifen)
          const count = new Map<number, number>();
          for (let x = box.x0; x <= box.x1; x++) {
            const o = ownerAt(fl, x, main.z1)!;
            count.set(o, (count.get(o) ?? 0) + 1);
          }
          const owner = [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
          for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) add(owner, [x, z]);
        }
      }
    }
  }

  // ---------------------------------------------------------------- Auskragung der Obergeschosse
  let jetty = false;
  const j = f.jetty;
  if (j !== undefined && top >= 1 && rng.fork('jetty').chance(j.prob ?? 1)) {
    const jcells = new Map<number, Set<string>>();
    const jettyOf = (fl: number): Set<string> => jcells.get(fl) ?? jcells.set(fl, new Set()).get(fl)!;
    for (let fl = 1; fl <= top; fl++) {
      const rows = j.each === true ? Math.min(fl, 2) : 1;
      const below = occ.get(fl - 1);
      // Ein Quergiebel über alle Etagen und eine Auskragung derselben Seite stoßen in einer Innenecke zusammen: dort
      // entstünde ein 1 breites Putzfeld zwischen zwei Ständern (W7-Regel) – die Front kragt dann nicht aus
      // W12-A: dasselbe an einer Giebelseite, die ein Eck-Quergiebel verlängert (links bzw. rechts bündig mit ihm)
      const sides = cross !== undefined && c?.floors !== 'ground'
        ? j.sides.filter((s) => s !== 'front' && !(s === 'left' && cross!.x0 === main.x0) && !(s === 'right' && cross!.x1 === main.x1))
        : j.sides;
      for (const s of sides) {
        // Kante: Front/Rückseite laufen entlang x, links/rechts entlang z (von außen auf die Front gesehen)
        const alongX = s === 'front' || s === 'back';
        const lo = alongX ? main.x0 : main.z0;
        const hi = alongX ? main.x1 : main.z1;
        const edge = s === 'front' ? main.z1 : s === 'back' ? main.z0 : s === 'left' ? main.x0 : main.x1;
        const out1 = s === 'front' || s === 'right' ? 1 : -1;
        // Läufe kürzer als 3 entfallen (ein 1–2 Block breiter Stummel neben einem Quergiebel liest sich als Fehler)
        const run: Array<[number, Cell]> = [];
        let cols = 0;
        const flush = (): void => {
          if (cols >= 3) for (const [i, cell] of run) { add(i, cell); jettyOf(fl).add(key(cell[0], cell[1])); jetty = true; }
          run.length = 0;
          cols = 0;
        };
        const at1 = (t: number, k: number): Cell => (alongX ? [t, edge + out1 * k] : [edge + out1 * k, t]);
        // Steht vor dieser Kante ein Anbau (Stallflügel), kragt die Seite gar nicht aus: eine unterbrochene Auskragung
        // zerschneidet die Wandlinie und damit das Fassadenraster (Räume ohne Fensterachse)
        const blocked = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).some((t) => {
          const [x, z] = at1(t, 1);
          // Spalten des Quergiebels (auf dieser Etage schon belegt) zählen nicht
          return occ.get(fl)?.has(key(x, z)) !== true && below?.has(key(x, z)) === true && jettyOf(fl - 1).has(key(x, z)) !== true && !porch.has(key(x, z));
        });
        if (blocked) continue;
        for (let t = lo; t <= hi; t++) {
          const at = (k: number): Cell => at1(t, k);
          const [ex, ez] = at(0);
          const owner = ownerAt(fl, ex, ez);
          if (owner === undefined) { flush(); continue; }
          const before = run.length;
          for (let k = 1; k <= rows; k++) {
            const [x, z] = at(k);
            const [bx, bz] = at(k - 1);
            // genau 1 Block über der Wand darunter (Konsole trägt) und frei auf dieser Etage
            // (gestaffelt: die k-te Reihe steht auf der Auskragung der Etage darunter); direkt vor der Kante nichts
            // darunter (sonst wäre es ein Anbau, keine Auskragung)
            if (occ.get(fl)?.has(key(x, z)) === true) break;
            if (below?.has(key(bx, bz)) !== true || (k === 1 && below.has(key(x, z)) && jettyOf(fl - 1).has(key(x, z)) !== true && !porch.has(key(x, z)))) break;
            run.push([owner, [x, z]]);
          }
          if (run.length === before) flush();
          else cols++;
        }
        flush();
      }
    }
  }
  for (const [i, cells] of added) out[i] = { ...out[i]!, cells: out[i]!.cells.union(CellSet.of(cells)) };
  return { rooms: out, jetty, ...(cross !== undefined ? { cross } : {}) };
}
