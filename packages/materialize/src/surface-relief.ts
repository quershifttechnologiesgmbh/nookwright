/**
 * Geometriemasken einer Wandfläche (TX-B, „Texture like a pro“: Füllfeld dunkler, Träger/Kanten heller).
 *
 * Rein und klein, damit auch andere Pässe (Verwitterung) sie nutzen können: arbeitet nur auf zwei Prädikaten
 * (`isSolid`, `isOut`) und kennt weder Rollen noch Blöcke.
 *
 * - `recess`: Tiefe des Rücksprungs 0–3. Zählt die Schritte vor der Fläche (entlang der Normalen), in denen die Luftzelle
 *   seitlich von mindestens zwei festen Zellen eingefasst ist (Füllfeld zwischen vorstehenden Balken, Nische, Laibung).
 * - `occlusion`: feste Seitennachbarn der Luftzelle direkt vor der Fläche (0–4), ein grobes Umgebungs-Verdeckungsmaß.
 * - `convex`: freie Kanten der Zelle in der Wandebene (0–4): Nachbarn links/rechts/oben/unten, die Außenluft sind.
 *   Ecke = 1, vorstehender Balken = 2, freistehender Pfeiler/Zinne = 3.
 */
import type { Vec3 } from '@mcda/core';

export interface WallRelief {
  readonly recess: number;
  readonly occlusion: number;
  readonly convex: number;
}

type Pred = (x: number, y: number, z: number) => boolean;

/** Maske einer Wandzelle `pos` mit der Außennormalen `(nx, nz)` (eine der vier Himmelsrichtungen). */
export function wallRelief(isSolid: Pred, isOut: Pred, pos: Vec3, nx: number, nz: number): WallRelief {
  const [x, y, z] = pos;
  // Tangenten in der Wandebene: waagerecht (quer zur Normalen) und senkrecht
  const tx = nz === 0 ? 0 : 1;
  const tz = nz === 0 ? 1 : 0;
  const lateral = (px: number, py: number, pz: number): number =>
    (isSolid(px + tx, py, pz + tz) ? 1 : 0) + (isSolid(px - tx, py, pz - tz) ? 1 : 0) + (isSolid(px, py + 1, pz) ? 1 : 0) + (isSolid(px, py - 1, pz) ? 1 : 0);
  let recess = 0;
  let occlusion = 0;
  for (let d = 1; d <= 3; d++) {
    const px = x + nx * d;
    const pz = z + nz * d;
    if (isSolid(px, y, pz)) break;
    const n = lateral(px, y, pz);
    if (d === 1) occlusion = n;
    if (n < 2) break;
    recess++;
  }
  const convex = (isOut(x + tx, y, z + tz) ? 1 : 0) + (isOut(x - tx, y, z - tz) ? 1 : 0) + (isOut(x, y + 1, z) ? 1 : 0) + (isOut(x, y - 1, z) ? 1 : 0);
  return { recess, occlusion, convex };
}
