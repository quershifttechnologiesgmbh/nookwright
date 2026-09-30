import type { Vec3 } from './vec.js';

export type HorizontalDir = 'north' | 'east' | 'south' | 'west';
export type Dir = HorizontalDir | 'up' | 'down';

/**
 * Richtung relativ zu einer Komponente („semantische Ausrichtung“).
 * Kanonisch schaut jede Komponente nach SÜDEN (+z): front = south, back = north.
 * left/right aus Sicht der Komponente (wer auf dem Stuhl sitzt und nach Süden schaut,
 * hat Osten links und Westen rechts).
 */
export type RelDir = 'front' | 'back' | 'left' | 'right' | 'up' | 'down';

/** Im Uhrzeigersinn von oben gesehen. */
export const HORIZONTAL: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];

export const DIR_VEC: Readonly<Record<Dir, Vec3>> = {
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};

export const CANONICAL_REL: Readonly<Record<RelDir, Dir>> = {
  front: 'south',
  back: 'north',
  left: 'east',
  right: 'west',
  up: 'up',
  down: 'down',
};

export function isHorizontal(d: Dir): d is HorizontalDir {
  return d !== 'up' && d !== 'down';
}

export function opposite(d: Dir): Dir {
  switch (d) {
    case 'north': return 'south';
    case 'south': return 'north';
    case 'east': return 'west';
    case 'west': return 'east';
    case 'up': return 'down';
    case 'down': return 'up';
  }
}

/** Dreht eine Richtung um `quarterTurns` Vierteldrehungen im Uhrzeigersinn (von oben). */
export function rotateDir(d: Dir, quarterTurns: number): Dir {
  if (!isHorizontal(d)) return d;
  const i = HORIZONTAL.indexOf(d);
  return HORIZONTAL[(((i + quarterTurns) % 4) + 4) % 4]!;
}

/** Spiegelt an einer Achse: 'x' tauscht Ost/West, 'z' tauscht Nord/Süd. */
export function mirrorDir(d: Dir, axis: 'x' | 'z'): Dir {
  if (axis === 'x' && (d === 'east' || d === 'west')) return opposite(d);
  if (axis === 'z' && (d === 'north' || d === 'south')) return opposite(d);
  return d;
}
