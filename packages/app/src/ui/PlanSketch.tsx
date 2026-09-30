import type { BuildingPlan } from '@mcda/archetype';
import { css, roomTypeColor } from '../colors.js';
import { floorLabel } from '../usecases.js';

/** Grenzen aller Räume des Plans (alle Etagen), damit jede Etage im selben Maßstab erscheint. */
function planBounds(plan: BuildingPlan): { x: number; z: number; w: number; d: number } {
  const cells = plan.rooms.flatMap((r) => r.cells.toArray());
  if (cells.length === 0) return { x: 0, z: 0, w: 1, d: 1 };
  const xs = cells.map((c) => c[0]);
  const zs = cells.map((c) => c[1]);
  const x = Math.min(...xs);
  const z = Math.min(...zs);
  return { x, z, w: Math.max(...xs) - x + 1, d: Math.max(...zs) - z + 1 };
}

/** Zellen eines Raums als Pfad aus Zeilenläufen (je Zeile zusammenhängende Zellen = ein Rechteck). */
function cellsPath(cells: ReadonlyArray<readonly [number, number]>, ox: number, oz: number): string {
  const rows = new Map<number, number[]>();
  for (const [x, z] of cells) rows.set(z, [...(rows.get(z) ?? []), x]);
  const parts: string[] = [];
  for (const [z, xs] of rows) {
    xs.sort((a, b) => a - b);
    let start = xs[0]!;
    for (let i = 1; i <= xs.length; i++) {
      if (i < xs.length && xs[i] === xs[i - 1]! + 1) continue;
      parts.push(`M${start - ox} ${z - oz}h${xs[i - 1]! - start + 1}v1h${-(xs[i - 1]! - start + 1)}z`);
      start = xs[i]!;
    }
  }
  return parts.join('');
}

/**
 * Draufsicht einer Etage des Plans (Karte im Assistenten): Räume in den Farben des Grundrisses, Treppen dunkel,
 * gleicher Maßstab für alle Etagen. `title` je Raum: Raumtyp.
 */
export function PlanSketch(props: { plan: BuildingPlan; floor: number; size: number; roomTypeName: (id: string) => string }) {
  const b = planBounds(props.plan);
  const scale = props.size / Math.max(b.w, b.d);
  const rooms = props.plan.rooms.filter((r) => r.floor === props.floor);
  const stairs = props.plan.stairs.filter((s) => s.floor === props.floor || s.floor + 1 === props.floor);
  return (
    <span className="plan-sketch">
      <svg width={Math.ceil(b.w * scale)} height={Math.ceil(b.d * scale)} viewBox={`0 0 ${b.w} ${b.d}`} role="img" aria-label={`Grundriss ${floorLabel(props.floor)}`}>
        {rooms.map((r, i) => (
          <path key={i} d={cellsPath(r.cells.toArray(), b.x, b.z)} fill={css(roomTypeColor(r.roomTypeId))} stroke="#111418" strokeWidth={0.12}>
            <title>{props.roomTypeName(r.roomTypeId)}</title>
          </path>
        ))}
        {stairs.map((s, i) => (
          <rect key={`s${i}`} x={s.origin[0] - b.x + 0.2} y={s.origin[1] - b.z + 0.2} width={0.6} height={0.6} fill="#111418" />
        ))}
      </svg>
      <span>{floorLabel(props.floor)}</span>
    </span>
  );
}
