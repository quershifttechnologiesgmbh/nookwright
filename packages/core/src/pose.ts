import { CANONICAL_REL, mirrorDir, rotateDir, type Dir, type RelDir } from './direction.js';
import type { Vec3 } from './vec.js';

/** Vierteldrehungen im Uhrzeigersinn (von oben gesehen). */
export type Quarter = 0 | 1 | 2 | 3;

/** Spiegelung vor der Drehung: 'x' = Ost↔West, 'z' = Nord↔Süd. */
export type Mirror = 'none' | 'x' | 'z';

/**
 * Lage einer Komponente in der Welt.
 * `pos` ist die Weltposition der Ecke (min x, min y, min z) der TRANSFORMIERTEN Bounding-Box.
 */
export interface Pose {
  readonly pos: Vec3;
  readonly rot: Quarter;
  readonly mirror: Mirror;
}

export const pose = (pos: Vec3, rot: Quarter = 0, mirror: Mirror = 'none'): Pose => ({ pos, rot, mirror });

/** Größe der Bounding-Box nach Drehung. */
export function transformedSize(size: Vec3, rot: Quarter): Vec3 {
  return rot % 2 === 0 ? size : [size[2], size[1], size[0]];
}

/**
 * Transformiert eine lokale Position innerhalb einer kanonischen Box der Größe `size`
 * (erst spiegeln, dann drehen). Die Box bleibt im positiven Quadranten verankert.
 */
export function transformLocal(p: Vec3, size: Vec3, rot: Quarter, mirror: Mirror): Vec3 {
  let [x, y, z] = p;
  const [sx, , sz] = size;
  if (mirror === 'x') x = sx - 1 - x;
  if (mirror === 'z') z = sz - 1 - z;
  let w = sx;
  let d = sz;
  for (let i = 0; i < rot; i++) {
    // 90° im Uhrzeigersinn: Nordkante wird Ostkante → (x, z) ↦ (d − 1 − z, x)
    const nx = d - 1 - z;
    const nz = x;
    x = nx;
    z = nz;
    [w, d] = [d, w];
  }
  return [x, y, z];
}

/** Absolute Richtung einer kanonischen Richtung unter einer Pose. */
export function transformDir(d: Dir, p: Pick<Pose, 'rot' | 'mirror'>): Dir {
  const m = p.mirror === 'none' ? d : mirrorDir(d, p.mirror);
  return rotateDir(m, p.rot);
}

/** Löst eine relative Richtung („front“, „left“ …) unter einer Pose in eine Weltrichtung auf. */
export function resolveRelDir(rel: RelDir, p: Pick<Pose, 'rot' | 'mirror'>): Dir {
  return transformDir(CANONICAL_REL[rel], p);
}
