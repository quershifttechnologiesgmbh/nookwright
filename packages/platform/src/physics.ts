/**
 * Physik-Abfragen auf data/physics-<version>.json. Rein.
 * Klassifikation der Kollisionsformen und die Flag-Listen liegen in build/physics.ts.
 */
import type { BlockPhysics, PhysicsFlag, StatePhysics } from './types.js';

/** Physik eines konkreten Zustands (nutzt `by`, sonst den Default-State). */
export function physicsOfState(p: BlockPhysics, props: Readonly<Record<string, string>>): StatePhysics {
  if (p.by) {
    const k = p.by.props.map((x) => props[x]).join(',');
    const hit = Object.hasOwn(p.by.map, k) ? p.by.map[k] : undefined;
    if (hit) return hit;
  }
  return { cls: p.cls, h: p.h, topFull: p.topFull };
}

export function hasFlag(p: BlockPhysics, flag: PhysicsFlag): boolean {
  return p.flags.includes(flag);
}
