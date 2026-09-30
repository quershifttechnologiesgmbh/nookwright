/**
 * Turmdächer (research/18 D3, D8, D9; research/16 D4, D9): ein Höhenprofil über Dachringen.
 *
 * Jede Zelle des Dachgrundrisses (Radius r + 1, 0 = Überstand) bekommt eine Stufe k:
 *   Kegel/Zelt/Spitzhelm/Haube → Dachring (rund euklidisch, eckig Chebyshev, research/03 §C9),
 *   Rhombenhelm → Manhattan m = 2(r+1) − |dx| − |dz| (D8: Giebel je Seite bis p·(r+1), Ecken auf Traufhöhe).
 * Oben liegt bei T(k) das Bauteil (Treppe zur Mitte, Stufe, umgedrehte Treppe), darunter Füllung bis
 * T(k−1) – flächenschlüssig zum Nachbarring, nichts schwebt. Über der Außenwand reicht die Füllung bis zur
 * Wandkrone (Giebel beim Helm). Profile T(k):
 *   linear       T = p·k                                (Kegel, Zelt, Helm; Spitzhelm mit p = 3)
 *   Glockenfuß   Überstand = Stufe bei 0, Ring 1 = Treppe bei 0, danach T = p·(k − 1)
 *   welsche Haube  Fuß (umgedrehte Treppe) 0 · Bauch +2 … +1 (konvex) · Einschnürung (Stufe) +1 · Spitze +2 · First +1
 * Die Koordinaten sind relativ: Mitte (0, 0), dy = 0 = Traufe (Überstand); die Wandkrone liegt bei dy = −1.
 */
import type { HorizontalDir } from '@mcda/core';
import { B, stair, type Block } from './canvas.js';
import { N4, footprintOffsets, inFootprint, roofRing, snapDir } from './geometry.js';
import type { RoofShape, TowerFinial, TowerShape } from './types.js';

export interface RoofSpec {
  readonly shape: TowerShape;
  /** Radius der tragenden Wand; das Dach deckt Radius r + 1. */
  readonly r: number;
  /** Aufgelöst (resolveStyle): Kegel nur rund, Zelt und Helm nur eckig. */
  readonly roofShape: RoofShape;
  readonly pitch: number;
  readonly flare: boolean;
  readonly finial: TowerFinial;
  /** Additiv (W9-G5): Rolle der Dachfläche (Treppen, Stufen, Füllung). Standard `roof_main` (bitgleich). */
  readonly role?: string;
}

export interface RoofBlock {
  readonly dx: number;
  /** Höhe über der Traufe. */
  readonly dy: number;
  readonly dz: number;
  readonly block: Block;
}

type Element = 'stair' | 'foot' | 'slab';

export interface RoofProfile {
  /** Höhe des Bauteils je Stufe k = 0 … K. */
  readonly T: readonly number[];
  readonly el: readonly Element[];
}

/** Profil über K + 1 Stufen (K = First). Die Haube braucht K ≥ 4, sonst linear. */
export function roofProfile(roofShape: RoofShape, pitch: number, flare: boolean, K: number): RoofProfile {
  const T: number[] = [];
  const el: Element[] = [];
  if (roofShape === 'bell' && K >= 4) {
    const belly = K - 3;
    T.push(0);
    el.push('foot');
    for (let k = 1; k <= K; k++) {
      const d = k <= belly ? (k <= Math.ceil(belly / 2) ? 2 : 1) : k === K - 2 ? 1 : k === K - 1 ? 2 : 1;
      T.push(T[k - 1]! + d);
      el.push(k === K - 2 ? 'slab' : 'stair');
    }
    return { T, el };
  }
  const fl = flare && roofShape !== 'helm';
  for (let k = 0; k <= K; k++) {
    T.push(fl ? pitch * Math.max(0, k - 1) : pitch * k);
    el.push(fl && k === 0 ? 'slab' : 'stair');
  }
  return { T, el };
}

/** Stufe einer Zelle im Dachgrundriss (−1 = außerhalb). */
export function roofLevel(spec: Pick<RoofSpec, 'shape' | 'r' | 'roofShape'>, dx: number, dz: number): number {
  const { shape, r } = spec;
  if (!inFootprint(shape, r + 1, dx, dz)) return -1;
  if (spec.roofShape === 'helm') return 2 * (r + 1) - Math.abs(dx) - Math.abs(dz);
  return roofRing(shape, r, dx, dz);
}

/** Alle Dachblöcke relativ zur Traufe, sortiert wie der Grundriss (z, x), je Spalte von unten nach oben. */
export function towerRoof(spec: RoofSpec): RoofBlock[] {
  const { shape, r, roofShape } = spec;
  const role = spec.role ?? 'roof_main';
  const fill: Block = role === 'roof_main' ? B.roof : { ...B.roof, role };
  const slab: Block = role === 'roof_main' ? B.roofSlab : { ...B.roofSlab, role };
  const out: RoofBlock[] = [];
  const put = (dx: number, dy: number, dz: number, block: Block): void => {
    out.push({ dx, dy, dz, block });
  };
  const level = (dx: number, dz: number): number => roofLevel(spec, dx, dz);
  const prof = roofProfile(roofShape, spec.pitch, spec.flare, level(0, 0));
  const helm = roofShape === 'helm';
  const re = r + 1;
  for (const [dx, dz] of footprintOffsets(shape, re)) {
    const k = level(dx, dz);
    const T = prof.T[k]!;
    const onWall = inFootprint(shape, r, dx, dz) && N4.some(([ax, az]) => !inFootprint(shape, r, dx + ax, dz + az));
    // Füllung bis zum Nachbarring bzw. über der Wand bis zur Krone (Giebel)
    for (let y = onWall ? 0 : k > 0 ? prof.T[k - 1]! : T; y < T; y++) put(dx, y, dz, fill);
    // Spitzhelm: Eckfialen (Mauerblock + Zaun) auf den Ecken des Überstands
    if (roofShape === 'spire' && shape === 'square' && Math.abs(dx) === re && Math.abs(dz) === re) {
      put(dx, T, dz, B.parapet);
      put(dx, T + 1, dz, B.fence);
      continue;
    }
    // Aufwärts-Richtung: 4-Nachbar mit höherer Stufe, der am besten zur Mitte zeigt
    let up: HorizontalDir | undefined;
    let bestDot = -Infinity;
    for (const [ax, az, d] of N4) {
      if (level(dx + ax, dz + az) <= k) continue;
      const dot = -(ax * dx + az * dz);
      if (dot > bestDot) {
        bestDot = dot;
        up = d;
      }
    }
    // Helm: auf der Diagonale Windrad-Symmetrie (sonst zeigten alle Diagonalen nach Norden/Süden)
    if (helm && dx !== 0 && Math.abs(dx) === Math.abs(dz)) up = Math.sign(dx) === Math.sign(dz) ? (dx > 0 ? 'west' : 'east') : (dz > 0 ? 'north' : 'south');
    // Ecken ohne höheren 4-Nachbarn (Grat): Treppe zur Mitte, das Autotiling formt die Außenecke
    if (up === undefined && [[1, 1], [1, -1], [-1, 1], [-1, -1]].some(([ax, az]) => level(dx + ax!, dz + az!) > k)) up = snapDir(-dx, -dz);
    if (up !== undefined) {
      const el = prof.el[k]!;
      put(dx, T, dz, el === 'slab' ? slab : stair(role, up, el === 'foot' ? 'top' : 'bottom'));
    } else {
      put(dx, T, dz, fill);
      if (dx === 0 && dz === 0) for (const [i, b] of finialBlocks(spec.finial).entries()) put(0, T + 1 + i, 0, b);
    }
  }
  return out;
}

/**
 * Turmspitze von unten nach oben: Stange (2 Stämme), Zaun + Laterne (steht auf der Zaunmitte), Zaun-Stange,
 * Zaun + Blitzableiter bzw. Endstab (Spitze nach oben, Fuß auf dem Zaun; research/16 D9).
 */
function finialBlocks(f: TowerFinial): readonly Block[] {
  switch (f) {
    case 'pole': return [B.post, B.post];
    case 'lantern': return [B.fence, B.lantern];
    case 'spike': return [B.fence, B.fence];
    case 'rod': return [B.fence, B.rod];
    case 'end_rod': return [B.fence, B.endRod];
    case 'none': return [];
  }
}
