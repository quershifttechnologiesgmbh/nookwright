/**
 * Möbel mit der Maus ziehen (W7-G, Konzept W2UX §4.2 N4/U5 „Ziehen im Grundriss“): im Grundriss und in beiden
 * 3D-Ansichten. Die Verschiebung wird in ganzen Feldern gemessen und läuft über dieselbe Passt-Prüfung wie die
 * Pfeiltasten (`nudgePlacement`/`nudgeProblem` → `placementProblem` in @mcda/pipeline): Vorschau während des Ziehens,
 * beim Loslassen ein Undo-Schritt oder die Ablehnung mit Grund.
 *
 * Rein bis auf `attachFurnitureDrag` (DOM-Ereignisse einer 3D-Ansicht).
 */
import type { PlacementId, ProjectState } from '@mcda/blueprint';
import type { Cell, Vec3 } from '@mcda/core';
import type { CellBox } from '../selection.js';
import type { PlacedView } from '../usecases.js';

/** Verschiebung in Feldern (x = Osten, z = Süden). */
export type Offset = readonly [number, number];

/** Ziehen in 3D: nur auf dem gewählten Möbel; die Ansicht meldet Vorschau und Loslassen. */
export interface FurnitureDrag {
  readonly placementId: PlacementId;
  /** Herkünfte, an denen man greifen darf: das Möbel und alles, was darauf steht (Krug auf der Theke). */
  readonly grab: ReadonlySet<string>;
  /** Weltblock-y der untersten Lage des Möbels (Zieh-Ebene in halber Höhe dieser Lage). */
  readonly y: number;
  /** Laufende Verschiebung (auch 0/0 beim Greifen); `undefined` = beendet oder abgebrochen. */
  readonly onPreview: (offset: Offset | undefined) => void;
  /** Losgelassen mit einer Verschiebung ≠ 0. */
  readonly onDrop: (dx: number, dz: number) => void;
}

/** Schnitt eines Strahls mit der waagrechten Ebene y + ½ → Zelle (x, z); `undefined`, wenn er sie nicht trifft. */
export function planeCell(origin: Vec3, dir: Vec3, y: number): Cell | undefined {
  if (Math.abs(dir[1]) < 1e-6) return undefined;
  const t = (y + 0.5 - origin[1]) / dir[1];
  if (!(t > 0) || !Number.isFinite(t)) return undefined;
  return [Math.floor(origin[0] + t * dir[0]), Math.floor(origin[2] + t * dir[2])];
}

export const dragOffset = (start: Cell, now: Cell): Offset => [now[0] - start[0], now[1] - start[1]];
export const isMove = (o: Offset | undefined): o is Offset => o !== undefined && (o[0] !== 0 || o[1] !== 0);

/** Richtung in Worten, z. B. „2 nach Osten, 1 nach Süden“. */
export function offsetText([dx, dz]: Offset): string {
  const parts: string[] = [];
  if (dx !== 0) parts.push(`${Math.abs(dx)} nach ${dx > 0 ? 'Osten' : 'Westen'}`);
  if (dz !== 0) parts.push(`${Math.abs(dz)} nach ${dz > 0 ? 'Süden' : 'Norden'}`);
  return parts.join(', ');
}

/** Statuszeile während des Ziehens: Richtung und ob es passt (sonst der Grund der Passt-Prüfung). */
export function dragText(name: string, offset: Offset, problem: string | undefined): string {
  if (!isMove(offset)) return `${name}: ziehen verschiebt · Esc bricht ab`;
  return problem === undefined ? `${name}: ${offsetText(offset)} – loslassen verschiebt` : `${name}: ${offsetText(offset)} – passt nicht: ${problem}`;
}

/** Auswahlrahmen, um die Verschiebung versetzt (Vorschau in 3D). */
export function shiftBox(box: CellBox | undefined, [dx, dz]: Offset): CellBox | undefined {
  if (box === undefined) return undefined;
  return { min: [box.min[0] + dx, box.min[1], box.min[2] + dz], max: [box.max[0] + dx, box.max[1], box.max[2] + dz] };
}

/** Das Möbel und alles, was darauf steht (wie `placementGroup` der Pipeline), als IDs. */
export function groupIds(state: Pick<ProjectState, 'placements'>, id: PlacementId): Set<PlacementId> {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of state.placements) {
      if (p.parentId !== undefined && ids.has(p.parentId) && !ids.has(p.id)) {
        ids.add(p.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Unterste Lage (Weltblock-y) eines Möbels. */
export function bottomY(v: PlacedView): number {
  return Math.min(...v.placed.cells.map((c) => c.pos[1]), v.placement.pose.pos[1]);
}

/**
 * Möbel unter einer Grundriss-Zelle (wie gezeichnet: Zellen bis eine Lage über dem Boden): Standmöbel vor Aufgesetztem
 * (Kerze auf dem Tisch), sonst das erste. `rooms` = Räume der angezeigten Etage mit ihrer Bodenhöhe.
 */
export function placementAtCell(views: readonly PlacedView[], rooms: ReadonlyMap<string, number>, cell: Cell): PlacementId | undefined {
  let best: { id: PlacementId; rank: number } | undefined;
  for (const v of views) {
    const baseY = rooms.get(v.placement.roomId);
    if (baseY === undefined) continue;
    const hit = v.placed.cells.filter((c) => c.pos[0] === cell[0] && c.pos[2] === cell[1] && c.pos[1] <= baseY + 1);
    if (hit.length === 0) continue;
    const rank = (v.placement.parentId === undefined ? 0 : 2) + (hit.some((c) => c.pos[1] === baseY) ? 0 : 1);
    if (best === undefined || rank < best.rank) best = { id: v.placement.id, rank };
  }
  return best?.id;
}

/**
 * Hängt das Ziehen an eine 3D-Ansicht: Zeigerdruck (links) auf dem gewählten Möbel greift es – in der Capture-Phase
 * am Host, damit die Kamera dabei nicht dreht und kein Klick-Auswählen ausgelöst wird. Esc bricht ab.
 * `ray` liefert den Sichtstrahl in Weltkoordinaten, `pick` die Herkunft des getroffenen Blocks.
 */
export function attachFurnitureDrag(
  host: HTMLElement,
  opts: {
    readonly canvas: () => HTMLCanvasElement | null | undefined;
    readonly current: () => FurnitureDrag | undefined;
    readonly pick: (e: PointerEvent) => string | undefined;
    readonly ray: (e: PointerEvent) => { readonly origin: Vec3; readonly dir: Vec3 } | undefined;
  },
): () => void {
  let active: { id: number; drag: FurnitureDrag; start: Cell; offset: Offset } | undefined;
  const cellOf = (e: PointerEvent, d: FurnitureDrag): Cell | undefined => {
    const r = opts.ray(e);
    return r === undefined ? undefined : planeCell(r.origin, r.dir, d.y);
  };
  const end = (e: PointerEvent | undefined, drop: boolean): void => {
    const a = active;
    if (a === undefined) return;
    active = undefined;
    if (e !== undefined && host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
    a.drag.onPreview(undefined);
    if (drop && isMove(a.offset)) a.drag.onDrop(a.offset[0], a.offset[1]);
  };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.shiftKey || active !== undefined || e.target !== opts.canvas()) return;
    const d = opts.current();
    const owner = d === undefined ? undefined : opts.pick(e);
    if (d === undefined || owner === undefined || !d.grab.has(owner)) return;
    const start = cellOf(e, d);
    if (start === undefined) return;
    e.stopPropagation();
    e.preventDefault();
    host.setPointerCapture(e.pointerId);
    active = { id: e.pointerId, drag: d, start, offset: [0, 0] };
    d.onPreview([0, 0]);
  };
  const onMove = (e: PointerEvent): void => {
    if (active === undefined || e.pointerId !== active.id) return;
    const c = cellOf(e, active.drag);
    if (c === undefined) return;
    const o = dragOffset(active.start, c);
    if (o[0] === active.offset[0] && o[1] === active.offset[1]) return;
    active.offset = o;
    active.drag.onPreview(o);
  };
  const onUp = (e: PointerEvent): void => {
    if (active !== undefined && e.pointerId === active.id) end(e, true);
  };
  const onCancel = (e: PointerEvent): void => {
    if (active !== undefined && e.pointerId === active.id) end(e, false);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || active === undefined) return;
    e.stopPropagation();
    end(undefined, false);
  };
  host.addEventListener('pointerdown', onDown, true);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
  return () => {
    host.removeEventListener('pointerdown', onDown, true);
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerup', onUp);
    host.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
  };
}
