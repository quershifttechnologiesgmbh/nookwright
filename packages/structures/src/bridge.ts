/**
 * Holzbrücken (F-Ensemble, `plan/spikes/F_ensemble_walkways.md`): Laufsteg aus einer Obergeschoss-Tür zum Wehrgang
 * (Hocheingang des Bergfrieds über eine Holzbrücke vom Wehrgang, Übergang Palas → Mauer) oder zur Tür eines anderen
 * Gebäudes (Schwibbogen/Skyway zwischen Häusern).
 *
 *   Querschnitt (Blick entlang der Brücke)       Längsschnitt (Tür links, Wehrgang rechts, 1 Stufe)
 *     L . L    L Laterne über der Stütze           |D . . . . /= w w
 *     f . f    f Zaun-Geländer, . Lauf (1 breit)    |D . . . . . . w w
 *     p p p    p Bohlen-Belag (Treppe im Anstieg)   |= = = = = /  (Belag, Treppe steigt zur Mauer)
 *     |   |    | Stamm-Stützen bis auf das Gelände       |       |
 *
 * Regeln: gerade Achse; beide Enden flach (Podest vor der Tür bzw. am Wehrgang); Höhenwechsel als Treppenlauf ≤ 1:1 in
 * der Mitte; 3 Reihen Kopffreiheit über dem Lauf; Stützen paarweise unter dem Geländer, höchstens 4 freie Zellen
 * zwischen zwei Auflagern; Laternen paarweise über den Stützen (spiegelsymmetrisch zur Achse). Gebaut wird nur ganz
 * oder gar nicht: Jede Position muss auf der Arbeitsfläche frei sein, jede Stützenspalte frei am Boden.
 */
import { opposite, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import { B, PRIO, stair, type Block, type Site } from './canvas.js';
import { DIR_XZ, colKey } from './geometry.js';
import type { BridgeInfo, BridgeSpec, WallInfo } from './types.js';

/** Größte Zahl freier Zellen zwischen zwei Auflagern (Wand, Stütze, Wehrgang). */
export const BRIDGE_MAX_FREE_SPAN = 4;
/** Standard der größten Brückenlänge beim Wehrgang-Anschluss. */
export const BRIDGE_MAX_LENGTH = 12;
/** Kopffreiheit über dem Lauf (Reihen ab den Füßen). */
export const BRIDGE_HEADROOM = 3;

const DECK: Block = { role: 'beam', shape: 'planks' };

/** Wehrgang-Zellen aller Mauern: Spalte → Füße und Mauer. */
export function walkwayIndex(walls: readonly WallInfo[]): Map<number, { readonly y: number; readonly wall: string }> {
  const out = new Map<number, { y: number; wall: string }>();
  for (const w of walls) for (const [x, y, z] of w.walkway) if (!out.has(colKey(x, z))) out.set(colKey(x, z), { y, wall: w.id });
  return out;
}

/**
 * Füße je Laufzelle: beide Enden flach, `|rise|` Stufen mittig. Die Treppe liegt jeweils in der höheren Zelle eines
 * Paares; Zelle 0 und `n − 1` bleiben Podest. `undefined`, wenn der Lauf zu kurz ist (`|rise| > n − 2`).
 */
export function bridgeProfile(n: number, y0: number, rise: number): number[] | undefined {
  const steps = Math.abs(rise);
  if (n < 1 || (steps > 0 && steps > n - 2)) return undefined;
  const sign = Math.sign(rise);
  // Paare (k − 1, k): aufsteigend liegt die Stufe in k (1 … n − 2), absteigend in k − 1 (also k in 2 … n − 1)
  const lo = sign > 0 ? 1 : 2;
  const hi = sign > 0 ? n - 2 : n - 1;
  const first = lo + Math.floor((hi - lo + 1 - steps) / 2);
  const out: number[] = [];
  let y = y0;
  for (let k = 0; k < n; k++) {
    if (k >= first && k < first + steps) y += sign;
    out.push(y);
  }
  return out;
}

/** Stützstellen (Zellindex) für `n` Laufzellen: gleichmäßig, höchstens {@link BRIDGE_MAX_FREE_SPAN} frei dazwischen. */
export function supportSlots(n: number): number[] {
  const m = Math.max(0, Math.ceil((n - BRIDGE_MAX_FREE_SPAN) / (BRIDGE_MAX_FREE_SPAN + 1)));
  const out: number[] = [];
  for (let j = 1; j <= m; j++) out.push(Math.round((j * (n + 1)) / (m + 1)) - 1);
  return out;
}

interface Put {
  readonly pos: Vec3;
  readonly block: Block | undefined;
  readonly prio: number;
}

/** Baut eine Brücke auf der Arbeitsfläche (nach den Mauern). */
export function buildBridge(site: Site, spec: BridgeSpec, index: number, walks: ReadonlyMap<number, { readonly y: number; readonly wall: string }>): BridgeInfo {
  const id = `${site.prefix}:${spec.id ?? `bridge${index}`}`;
  const fail = (reason: string): BridgeInfo => {
    site.warnings.push(`${id}: ${reason} – nicht gebaut`);
    return { id, built: false, reason, path: [], supports: [] };
  };
  const [dx, dz] = DIR_XZ[spec.dir];
  const [sx, sy, sz] = spec.start;
  // Länge und Höhe am Ende: Tür gegenüber (fest) oder erste Wehrgang-Zelle entlang der Achse
  let n: number;
  let endY: number;
  let landing: Vec3 | undefined;
  let wall: string | undefined;
  if (spec.end !== undefined) {
    const [ex, ey, ez] = spec.end;
    const along = (ex - sx) * dx + (ez - sz) * dz;
    if (along < 0 || (ex - sx) * dz !== 0 || (ez - sz) * dx !== 0) return fail('Ende liegt nicht auf der Achse');
    n = along + 1;
    endY = ey;
  } else {
    const max = spec.maxLength ?? BRIDGE_MAX_LENGTH;
    let found = -1;
    for (let k = 0; k <= max; k++) {
      const x = sx + dx * k;
      const z = sz + dz * k;
      const w = walks.get(colKey(x, z));
      if (w !== undefined) {
        found = k;
        landing = [x, w.y, z];
        wall = w.wall;
        break;
      }
      if (site.isBlocked(x, z)) return fail(`Spalte ${x},${z} belegt vor dem Wehrgang`);
    }
    if (found < 1 || landing === undefined) return fail(`kein Wehrgang innerhalb von ${max} Zellen`);
    // Anschluss nur an ebenen Wehrgang (keine Stufe unter den Füßen)
    const under = site.canvas.at([landing[0], landing[1] - 1, landing[2]]);
    if (under?.role !== 'walkway' || under.shape !== 'block') return fail('Wehrgang an der Anschlussstelle ist keine ebene Zelle');
    n = found;
    endY = landing[1];
  }
  const feet = bridgeProfile(n, sy, endY - sy);
  if (feet === undefined) return fail(`zu steil: ${Math.abs(endY - sy)} Stufen auf ${n} Zellen`);

  const side: readonly Cell[] = [[-dz, dx], [dz, -dx]];
  const up: HorizontalDir = spec.dir;
  const down = opposite(spec.dir) as HorizontalDir;
  const puts: Put[] = [];
  const path: Vec3[] = [];
  for (let k = 0; k < n; k++) {
    const x = sx + dx * k;
    const z = sz + dz * k;
    const f = feet[k]!;
    path.push([x, f, z]);
    // Belag: Treppe in der höheren Zelle eines Anstiegs (Blick zur hohen Seite), sonst Bohlen
    const riseHere = k > 0 && f > feet[k - 1]! ? up : k + 1 < n && f > feet[k + 1]! ? down : undefined;
    puts.push({ pos: [x, f - 1, z], block: riseHere !== undefined ? stair('beam', riseHere) : DECK, prio: PRIO.stairs });
    for (let h = 0; h < BRIDGE_HEADROOM; h++) puts.push({ pos: [x, f + h, z], block: undefined, prio: PRIO.reserve });
    for (const [ox, oz] of side) {
      puts.push({ pos: [x + ox, f - 1, z + oz], block: DECK, prio: PRIO.stairs });
      puts.push({ pos: [x + ox, f, z + oz], block: B.fence, prio: PRIO.feature });
    }
  }
  // Stützen (paarweise unter dem Geländer bis auf das Gelände) und Laternen darüber; ohne Stütze eine Laterne mittig
  const slots = supportSlots(n);
  const supports: Cell[] = [];
  for (const k of slots) {
    const x = sx + dx * k;
    const z = sz + dz * k;
    const f = feet[k]!;
    for (const [ox, oz] of side) {
      const px = x + ox;
      const pz = z + oz;
      const g = site.groundY(px, pz);
      if (g >= f - 1) return fail(`Gelände bei ${px},${pz} reicht an den Belag`);
      if (site.isBlocked(px, pz)) return fail(`Stütze bei ${px},${pz} auf belegter Spalte`);
      for (let y = g + 1; y <= f - 2; y++) puts.push({ pos: [px, y, pz], block: B.post, prio: PRIO.stairs });
      supports.push([px, pz]);
      // Kopfbänder: umgedrehte Treppen unter dem Belag beiderseits der Stütze (Rücken zur Stütze), nicht auf dem Boden
      for (const kk of [k - 1, k + 1]) {
        if (kk < 0 || kk >= n || slots.includes(kk)) continue;
        const bx = sx + dx * kk + ox;
        const bz = sz + dz * kk + oz;
        const by = feet[kk]! - 2;
        if (by <= site.groundY(bx, bz) + 1 || by !== f - 2) continue;
        puts.push({ pos: [bx, by, bz], block: stair('beam', kk < k ? up : down, 'top'), prio: PRIO.feature });
      }
    }
  }
  const lamps = slots.length > 0 ? slots : [Math.floor((n - 1) / 2)];
  for (const k of lamps) {
    for (const [ox, oz] of side) puts.push({ pos: [sx + dx * k + ox, feet[k]! + 1, sz + dz * k + oz], block: B.lantern, prio: PRIO.feature });
  }
  // Unter dem Belag darf das Gelände nirgends höher als eine Reihe darunter liegen (sonst ist es kein Steg)
  for (const [x, f, z] of path) {
    for (const [ox, oz] of [[0, 0] as Cell, ...side]) {
      if (site.groundY(x + ox, z + oz) >= f - 1) return fail(`Gelände bei ${x + ox},${z + oz} reicht an den Belag`);
    }
  }
  // Ganz oder gar nicht: jede Position frei
  for (const p of puts) {
    if (site.canvas.at(p.pos) !== undefined || site.canvas.isReserved(p.pos)) return fail(`Position ${p.pos.join(',')} belegt`);
  }
  for (const p of puts) {
    if (p.block === undefined) site.canvas.reserve(p.pos, id, p.prio);
    else site.canvas.put(p.pos, p.block, id, p.prio);
  }
  for (const [x, z] of supports) site.block(x, z);
  return { id, built: true, path, ...(landing !== undefined ? { landing, wall: wall! } : {}), supports };
}
