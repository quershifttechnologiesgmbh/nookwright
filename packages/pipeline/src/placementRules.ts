/**
 * Möbel verschieben, drehen und tauschen – die Passt-Prüfung als gemeinsame Regel von App und Engine-API (W3-BL,
 * offener Punkt 1 aus `plan/spikes/W2ED_editor.md`; vorher nur in `packages/app/src/placementEdit.ts`).
 *
 * - **Aufliegendes folgt:** Ein Möbel bewegt sich mit allen aufgesetzten Teilen (Kerzen auf dem Tisch, Kinder und Enkel
 *   über `parentId`). Beim Tausch gegen eine andere Komponente entfallen die Kinder (wie `PlacementSwapped`).
 * - **Passt:** Jede Zelle der Gruppe liegt im Raum-Inneren (x/z) und berührt keine Zelle eines anderen Möbels; sonst
 *   ein Grund in Nutzersprache („… ragt aus dem Raum“, „… stößt an ein anderes Möbel“).
 *
 * Rein; die Geometrie kommt aus dem Katalog, das Raum-Innere aus der Hülle (`shell.rooms`).
 */
import type { Placement, PlacementId, ProjectState, RoomId } from '@mcda/blueprint';
import type { Catalog, ComponentDef } from '@mcda/catalog';
import type { Pose, Quarter, Vec3 } from '@mcda/core';
import { expandComponent, placeComponent, type ExpandedComponent, type PlacedComponent } from '@mcda/furnishing';

/** Raum-Innere je Raum (Ausschnitt der Hülle). */
export interface PlacementRooms {
  readonly rooms: ReadonlyMap<RoomId, { readonly interior: { has(x: number, z: number): boolean } }>;
}

/** Änderung einer Möbelgruppe: neue Lagen und/oder getauschte Komponente des Wurzel-Möbels. */
export interface PlacementChange {
  readonly poses?: ReadonlyMap<PlacementId, Pose>;
  readonly swap?: { readonly componentId: string; readonly variantId?: string | undefined };
}

interface View {
  readonly placement: Placement;
  readonly def: ComponentDef;
  readonly placed: PlacedComponent;
}

const expandCache = new WeakMap<Catalog, Map<string, ExpandedComponent>>();

function expanded(catalog: Catalog, def: ComponentDef, variantId: string | undefined): ExpandedComponent {
  let m = expandCache.get(catalog);
  if (m === undefined) expandCache.set(catalog, (m = new Map()));
  const key = `${def.id}#${variantId ?? ''}`;
  let e = m.get(key);
  if (e === undefined) m.set(key, (e = expandComponent(def, variantId)));
  return e;
}

/** Platzierungen in Weltzellen; unbekannte Komponenten werden übersprungen. */
function views(placements: readonly Placement[], catalog: Catalog): View[] {
  const out: View[] = [];
  for (const placement of placements) {
    const def = catalog.find(placement.componentId);
    if (def === undefined) continue;
    out.push({ placement, def, placed: placeComponent(expanded(catalog, def, placement.variantId), placement.pose) });
  }
  return out;
}

const key3 = (v: Vec3): string => `${v[0]},${v[1]},${v[2]}`;

/** Ein Möbel samt aufgesetzten Teilen (Kinder, Enkel …), in Reihenfolge des Projekts. */
export function placementGroup(state: ProjectState, id: PlacementId): Placement[] {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of state.placements) {
      if (p.parentId !== undefined && ids.has(p.parentId) && !ids.has(p.id)) {
        ids.add(p.id);
        grew = true;
      }
    }
  }
  return state.placements.filter((p) => ids.has(p.id));
}

/**
 * Passt die Gruppe mit neuen Lagen (`poses`) bzw. getauschter Komponente (`swap`) in den Raum? Alle Zellen im
 * Raum-Inneren (x/z), keine Zelle eines anderen Möbels. `undefined` = passt, sonst der Grund.
 */
export function placementProblem(state: ProjectState, rooms: PlacementRooms, catalog: Catalog, id: PlacementId, change: PlacementChange): string | undefined {
  const p = state.placements.find((x) => x.id === id);
  if (p === undefined) return `Unbekanntes Möbel ${id}`;
  const geom = rooms.rooms.get(p.roomId);
  if (geom === undefined) return 'Raum nicht gefunden';
  const own = new Set(placementGroup(state, id).map((x) => x.id));
  const taken = new Set<string>();
  for (const v of views(state.placements.filter((x) => !own.has(x.id)), catalog)) for (const c of v.placed.cells) taken.add(key3(c.pos));
  const swapsComponent = change.swap !== undefined && change.swap.componentId !== p.componentId;
  // Bei anderer Komponente entfallen die Kinder (wie `PlacementSwapped`), sonst bewegt sich die ganze Gruppe
  const members = swapsComponent ? [p] : placementGroup(state, id);
  const moved: Placement[] = members.map((x) => {
    const pose = change.poses?.get(x.id) ?? x.pose;
    if (x.id !== id || change.swap === undefined) return { ...x, pose };
    const { variantId: _v, ...rest } = x;
    return { ...rest, componentId: change.swap.componentId, ...(change.swap.variantId !== undefined ? { variantId: change.swap.variantId } : {}), pose };
  });
  let placed: View[];
  try {
    placed = views(moved, catalog);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  if (placed.length === 0) return `Komponente ${change.swap?.componentId ?? p.componentId} unbekannt`;
  for (const v of placed) {
    for (const c of v.placed.cells) {
      if (!geom.interior.has(c.pos[0], c.pos[2])) return `${v.def.name ?? v.def.id} ragt aus dem Raum (Wand oder außerhalb)`;
      if (taken.has(key3(c.pos))) return `${v.def.name ?? v.def.id} stößt an ein anderes Möbel`;
    }
  }
  return undefined;
}

/** Verschieben um (dx, dz) Felder: neue Lagen der ganzen Gruppe. */
export function nudgePoses(state: ProjectState, id: PlacementId, dx: number, dz: number): Map<PlacementId, Pose> {
  const poses = new Map<PlacementId, Pose>();
  for (const x of placementGroup(state, id)) poses.set(x.id, { ...x.pose, pos: [x.pose.pos[0] + dx, x.pose.pos[1], x.pose.pos[2] + dz] });
  return poses;
}

/** Mittelpunkt (x/z) der Zellen einer Platzierung. */
function center(v: View): readonly [number, number] {
  const xs = v.placed.cells.map((c) => c.pos[0]);
  const zs = v.placed.cells.map((c) => c.pos[2]);
  return [(Math.min(...xs) + Math.max(...xs) + 1) / 2, (Math.min(...zs) + Math.max(...zs) + 1) / 2];
}

/** Lage mit Mittelpunkt (x/z) und gedrehter Größe. */
function poseAround(m: Placement, v: View, nx: number, nz: number, turns: number, dy = 0): Pose {
  const [w, , d] = v.placed.size;
  const odd = turns % 2 === 1;
  // gedreht (ungerade Viertel) tauschen Breite und Tiefe
  const pos: Vec3 = [Math.round(nx - (odd ? d : w) / 2), m.pose.pos[1] + dy, Math.round(nz - (odd ? w : d) / 2)];
  return { ...m.pose, pos, rot: (((m.pose.rot + turns) % 4) as Quarter) };
}

/**
 * Um 90° im Uhrzeigersinn drehen (von oben): um die Mitte des Möbels; aufgesetzte Teile drehen mit und kreisen um
 * dieselbe Mitte. Ungerade Kantenlängen können die Mitte um eine halbe Zelle verschieben (gerundet).
 */
export function rotatePoses(state: ProjectState, catalog: Catalog, id: PlacementId): Map<PlacementId, Pose> {
  const members = placementGroup(state, id);
  const byId = new Map(views(members, catalog).map((v) => [v.placement.id, v]));
  const root = byId.get(id);
  if (root === undefined) throw new Error(`Unbekanntes Möbel ${id}`);
  const [cx, cz] = center(root);
  const poses = new Map<PlacementId, Pose>();
  for (const m of members) {
    const v = byId.get(m.id);
    if (v === undefined) continue;
    const [mx, mz] = center(v);
    // Mittelpunkt um (cx, cz) drehen: (dx, dz) ↦ (−dz, dx) = 90° im Uhrzeigersinn (z zeigt nach Süden)
    poses.set(m.id, poseAround(m, v, cx - (mz - cz), cz + (mx - cx), 1));
  }
  return poses;
}

/**
 * Wurzel-Möbel auf eine neue Lage (Engine-Befehl `movePlacement`): die aufgesetzten Teile folgen – gleiche
 * Verschiebung, bei geänderter Drehung um die Mitte des Möbels mitgedreht, bei geänderter Höhe mit angehoben.
 */
export function movePoses(state: ProjectState, catalog: Catalog, id: PlacementId, pose: Pose): Map<PlacementId, Pose> {
  const members = placementGroup(state, id);
  const byId = new Map(views(members, catalog).map((v) => [v.placement.id, v]));
  const rootPlacement = members.find((m) => m.id === id);
  if (rootPlacement === undefined) throw new Error(`Unbekanntes Möbel ${id}`);
  const poses = new Map<PlacementId, Pose>([[id, pose]]);
  const root = byId.get(id);
  if (root === undefined || members.length === 1) return poses;
  const turns = (((pose.rot - rootPlacement.pose.rot) % 4) + 4) % 4;
  const [cx, cz] = center(root);
  const after = views([{ ...rootPlacement, pose }], catalog)[0]!;
  const [nx, nz] = center(after);
  const dy = pose.pos[1] - rootPlacement.pose.pos[1];
  for (const m of members) {
    if (m.id === id) continue;
    const v = byId.get(m.id);
    if (v === undefined) continue;
    let [mx, mz] = center(v);
    for (let t = 0; t < turns; t++) [mx, mz] = [cx - (mz - cz), cz + (mx - cx)];
    poses.set(m.id, poseAround(m, v, mx + (nx - cx), mz + (nz - cz), turns, dy));
  }
  return poses;
}
