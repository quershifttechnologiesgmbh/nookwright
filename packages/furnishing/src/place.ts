import type { EntitySpec, MaterialSpec, SocketDef } from '@mcda/catalog';
import { add, resolveRelDir, transformLocal, transformedSize, type Dir, type Pose, type RelDir, type Vec3 } from '@mcda/core';
import type { ExpandedComponent } from './expand.js';

export interface PlacedCell {
  readonly pos: Vec3;
  readonly local: Vec3;
  readonly mat: MaterialSpec;
}

export interface PlacedSocket {
  readonly def: SocketDef;
  /** Weltposition des Andockpunkts (falls `at` gesetzt). */
  readonly pos: Vec3 | undefined;
  /** Weltrichtung von `side` (falls gesetzt). */
  readonly side: Dir | undefined;
}

export interface PlacedEntity {
  readonly spec: EntitySpec;
  readonly pos: Vec3;
  readonly face: Dir | undefined;
}

/** Komponente in Weltkoordinaten. Relative Ausrichtungen der Materialien bleiben relativ – aufgelöst wird mit `worldDir`. */
export interface PlacedComponent {
  readonly expanded: ExpandedComponent;
  readonly pose: Pose;
  readonly size: Vec3;
  readonly cells: readonly PlacedCell[];
  readonly air: readonly Vec3[];
  readonly entities: readonly PlacedEntity[];
  readonly sockets: readonly PlacedSocket[];
}

export function placeComponent(exp: ExpandedComponent, pose: Pose): PlacedComponent {
  const tf = (p: Vec3): Vec3 => add(pose.pos, transformLocal(p, exp.size, pose.rot, pose.mirror));
  return {
    expanded: exp,
    pose,
    size: transformedSize(exp.size, pose.rot),
    cells: exp.cells.map((c) => ({ pos: tf(c.at), local: c.at, mat: c.mat })),
    air: exp.air.map(tf),
    entities: exp.entities.map((e) => ({ spec: e, pos: tf(e.at), face: e.face === undefined ? undefined : resolveRelDir(e.face, pose) })),
    sockets: exp.sockets.map((s) => ({
      def: s,
      pos: s.at === undefined ? undefined : tf(s.at),
      side: s.side === undefined ? undefined : resolveRelDir(s.side, pose),
    })),
  };
}

/** Weltrichtung einer relativen Richtung der platzierten Komponente. */
export function worldDir(placed: Pick<PlacedComponent, 'pose'>, rel: RelDir): Dir {
  return resolveRelDir(rel, placed.pose);
}

/** Belegte Weltzellen (Maske `occ` = alle Blockzellen). */
export function occupied(placed: PlacedComponent): Vec3[] {
  return placed.cells.map((c) => c.pos);
}
