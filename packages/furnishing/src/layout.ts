import type { RoomAisleDef, RoomReserveDef, RoomTypeDef } from '@mcda/catalog';
import { CellSet, cellKey, type HorizontalDir } from '@mcda/core';
import type { RoomAnalysis } from './analyze.js';
import { signatureEntries } from './program.js';

/**
 * Raumtyp-Layout (research/17 §3.1, Y1/Y2): Mittelgang (`aisle`) und Freifläche (`reserve`) als Zellmengen des
 * konkreten Raums. Die harten Regeln halten sie auf Laufhöhe frei (rules.ts), die Wertung spiegelt Reihen am Gang
 * (solver.ts). Rein und deterministisch; ohne `aisle`/`reserve` im Raumtyp gibt es kein Layout.
 */

export interface AislePlan {
  /** Laufrichtung des Gangs: `x` = Ost–West, `z` = Nord–Süd. */
  readonly axis: 'x' | 'z';
  /** Querbereich des Gangs (Koordinate quer zur Achse, inklusive). */
  readonly from: number;
  readonly to: number;
  /** Querbereich des Raums (Bounding-Box). */
  readonly lo: number;
  readonly hi: number;
  /** Längsbereich des Raums (Bounding-Box) entlang der Achse. */
  readonly start: number;
  readonly end: number;
  /** Stirnseite (türfern, Blickpunkt): Weltrichtung vom Gang zur Stirnwand. */
  readonly head: HorizontalDir;
  readonly width: number;
  readonly cells: CellSet;
}

export interface ReservePlan {
  readonly reason: RoomReserveDef['reason'];
  /** Tags, die in der Freifläche stehen dürfen (Zentralstück). */
  readonly allow: readonly string[];
  readonly cells: CellSet;
}

export interface RoomLayout {
  readonly aisle?: AislePlan;
  readonly reserve?: ReservePlan;
  /** Tags der Blickpunkt-Signaturen (Signatur ohne `pattern`): dürfen mit dem Rücken zur Stirnwand im Gang stehen. */
  readonly focalTags: readonly string[];
  /** Lockerungsstufe: 0 wie im Raumtyp, 1 Gang auf `minWidth`, Freifläche (focal) um 1 kleiner. */
  readonly relaxed: number;
}

/** Stufen, die der Solver probiert, wenn ein Pflichtobjekt nicht passt (danach: ohne Layout). */
export const LAYOUT_RELAX_LEVELS = 2;

/**
 * Layout eines Raums. `sideDepth` = Tiefe, die die Reihen-Möbel links/rechts vom Gang brauchen (Bett mit dem Kopf
 * an der Wand: 2, Kirchenbank quer: ihre Breite; `rowSideDepth`) – die Gangbreite wird so gewählt, dass sie passen.
 */
export function planLayout(a: RoomAnalysis, rt: Pick<RoomTypeDef, 'aisle' | 'reserve' | 'required' | 'optional'>, relax = 0, sideDepth = 1): RoomLayout | undefined {
  if ((rt.aisle === undefined && rt.reserve === undefined) || relax >= LAYOUT_RELAX_LEVELS) return undefined;
  const aisle = rt.aisle === undefined ? undefined : planAisle(a, rt.aisle, relax, sideDepth);
  const reserve = rt.reserve === undefined ? undefined : planReserve(a, rt.reserve, relax);
  if (aisle === undefined && reserve === undefined) return undefined;
  const all = [...rt.required, ...rt.optional];
  const focalTags = [...signatureEntries(rt as RoomTypeDef)].filter((i) => all[i]!.pattern === undefined).flatMap((i) => all[i]!.tags);
  return { ...(aisle !== undefined ? { aisle } : {}), ...(reserve !== undefined ? { reserve } : {}), focalTags, relaxed: relax };
}

/** Quer-Koordinate einer Zelle (x, z) bezogen auf die Gang-Achse. */
export const acrossOf = (axis: 'x' | 'z', x: number, z: number): number => (axis === 'x' ? z : x);
export const alongOf = (axis: 'x' | 'z', x: number, z: number): number => (axis === 'x' ? x : z);

function planAisle(a: RoomAnalysis, spec: RoomAisleDef, relax: number, sideDepth: number): AislePlan | undefined {
  const g = a.geometry;
  const b = g.interior.bounds();
  if (b === undefined) return undefined;
  const wx = b.maxX - b.minX + 1;
  const wz = b.maxZ - b.minZ + 1;
  const main = g.doors.find((d) => d.isMain) ?? g.doors[0];
  let axis: 'x' | 'z';
  if (spec.axis === 'x' || spec.axis === 'z') axis = spec.axis;
  else {
    const long = wx >= wz ? 'x' : 'z';
    const doorAxis = main === undefined ? long : main.toward === 'north' || main.toward === 'south' ? 'z' : 'x';
    axis = spec.axis === 'door' || Math.max(wx, wz) < 1.25 * Math.min(wx, wz) ? doorAxis : long;
  }
  const [lo, hi] = axis === 'x' ? [b.minZ, b.maxZ] : [b.minX, b.maxX];
  const [start, end] = axis === 'x' ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
  const W = hi - lo + 1;
  const minW = Math.min(spec.minWidth ?? 1, spec.width);
  const want = relax > 0 ? minW : spec.width;
  // Breiten want, want + 1 (gleich breite Seiten), dann schmaler bis minWidth; Rang: beidseitig vor einseitig,
  // Seiten tief genug für die Reihen-Möbel, nah an der Wunschbreite. Nichts passt → der ganze Raum ist Gang.
  const tries = [want, want + 1, ...Array.from({ length: Math.max(0, want - minW) }, (_, i) => want - 1 - i)].filter((c) => W - c >= 1);
  const rank = (c: number): number => ((W - c) % 2 === 0 && W - c >= 2 ? 0 : 2) + ((W - c) / 2 >= sideDepth ? 0 : 1);
  const w = tries.length === 0 ? W : tries.reduce((best, c) => (rank(c) < rank(best) ? c : best));
  const from = lo + Math.floor((W - w) / 2);
  const to = from + w - 1;
  const cells = CellSet.of(g.interior.toArray().filter(([x, z]) => acrossOf(axis, x, z) >= from && acrossOf(axis, x, z) <= to));
  // Stirnseite: das Gang-Ende mit dem größeren mittleren Türabstand (Gleichstand/ohne Tür: das hintere Ende)
  const endDoor = (at: number): number => {
    const ds = cells.toArray().filter(([x, z]) => alongOf(axis, x, z) === at).map(([x, z]) => a.dDoor.get(cellKey(x, z)) ?? Infinity).filter(Number.isFinite);
    return ds.length === 0 ? 0 : ds.reduce((s, d) => s + d, 0) / ds.length;
  };
  const headAtStart = endDoor(start) > endDoor(end);
  const head: HorizontalDir = axis === 'x' ? (headAtStart ? 'west' : 'east') : headAtStart ? 'north' : 'south';
  return { axis, from, to, lo, hi, start, end, head, width: w, cells };
}

function planReserve(a: RoomAnalysis, spec: RoomReserveDef, relax: number): ReservePlan | undefined {
  const g = a.geometry;
  const b = g.interior.bounds();
  if (b === undefined) return undefined;
  const wx = b.maxX - b.minX + 1;
  const wz = b.maxZ - b.minZ + 1;
  const [along, across] = spec.size;
  const shrink = spec.reason === 'focal' && relax > 0 ? 1 : 0;
  let sx = (wx >= wz ? along : across) - shrink;
  let sz = (wx >= wz ? across : along) - shrink;
  // ringsum bleibt mindestens eine Zelle; ein Treppenschacht passt ganz oder gar nicht
  if (spec.reason === 'stairwell' && (sx > wx - 2 || sz > wz - 2)) return undefined;
  sx = Math.min(sx, wx - 2);
  sz = Math.min(sz, wz - 2);
  if (sx < 1 || sz < 1) return undefined;
  const x0 = b.minX + Math.floor((wx - sx) / 2);
  const z0 = b.minZ + Math.floor((wz - sz) / 2);
  const cells = g.interior.intersection(CellSet.rect(x0, z0, x0 + sx - 1, z0 + sz - 1));
  return cells.size === 0 ? undefined : { reason: spec.reason, allow: spec.allow ?? [], cells };
}
