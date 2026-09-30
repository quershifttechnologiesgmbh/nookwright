/**
 * Auswahl (rein): Raum und optional eine Platzierung. Quelle ist der Grundriss (Klick auf eine Zelle), die Möbelliste
 * oder ein Klick in 3D – dort liefert die Vorschau die Herkunft (`owner`) des getroffenen Blocks aus dem
 * VoxelVolume: Platzierungs-ID für Möbel, `shell:<Raum>` für Wände, Boden und Decke, `lining:<Raum>:<Teil>` für die
 * Innenhaut (Paneele, Leisten, Ständer, Türrahmen, Teppich-Läufer – abgeleitet, gehört zum Raum), `x1:<Gruppe>:…` für
 * Außen-Teile (Außen-Deko, abgeleitet – nur Info und Rahmen, kein Bearbeiten einzelner Teile).
 */
import type { LinkId, PlacementId, ProjectState, RoomId, Shell, ShellAnchorKind } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import type { Vec3 } from '@mcda/core';
import { EXTERIOR_GROUP_LABELS, type ExteriorGroup, type ExteriorPlan } from '@mcda/pipeline';
import { linkLayout } from './stairs.js';
import { floorLabel, type PlacedView } from './usecases.js';

export interface Selection {
  readonly roomId?: RoomId | undefined;
  readonly placementId?: PlacementId | undefined;
  /** Gewählte Treppe (Klick auf Stufen oder Deckenöffnung im Grundriss); schließt Raum/Möbel aus. */
  readonly linkId?: LinkId | undefined;
  /** Gewähltes Außen-Teil (`ExteriorPlacement.id`, Klick in 3D); schließt Raum/Möbel/Treppe aus. */
  readonly exteriorId?: string | undefined;
  /** Gewählte Etage (W2-ED U2: Klick auf die aktive Etage der Etagen-Leiste); schließt alles andere aus. */
  readonly floorIndex?: number | undefined;
  /** Das Dach (W2-ED U3: Klick aufs Dach in 3D); schließt alles andere aus. */
  readonly roof?: boolean | undefined;
}

export const NO_SELECTION: Selection = {};

/** Präfix der Hüllen-Herkunft in der Materialisierung (`shell:<roomId>`). */
export const SHELL_OWNER_PREFIX = 'shell:';
/** Präfix der Innenhaut (W2-FD, `lining:<roomId>:<Teil>`): Klick darauf wählt den Raum. */
export const LINING_OWNER_PREFIX = 'lining:';
/** Präfix der Außen-Deko (`x1:<Gruppe>:<Komponente>@<Zelle>`, @mcda/exterior). */
export const EXTERIOR_OWNER_PREFIX = 'x1:';
/** Präfix der Dachzellen in der Auswahl (`roof:<Raum>`; die Materialisierung führt sie als `shell:<Raum>`). */
export const ROOF_OWNER_PREFIX = 'roof:';

/** Herkunft eines angeklickten Blocks → Auswahl. Unbekannt oder ins Leere geklickt → keine Auswahl. */
export function selectionFromOwner(owner: string | undefined, state: ProjectState): Selection {
  if (owner === undefined) return NO_SELECTION;
  const p = state.placements.find((x) => x.id === owner);
  if (p !== undefined) return { roomId: p.roomId, placementId: p.id };
  if (owner.startsWith(SHELL_OWNER_PREFIX)) {
    const id = owner.slice(SHELL_OWNER_PREFIX.length);
    if (state.rooms.some((r) => r.id === id)) return { roomId: id };
  }
  if (owner.startsWith(LINING_OWNER_PREFIX)) {
    const id = owner.slice(LINING_OWNER_PREFIX.length).split(':')[0]!;
    if (state.rooms.some((r) => r.id === id)) return { roomId: id };
  }
  if (owner.startsWith(EXTERIOR_OWNER_PREFIX)) return { exteriorId: owner };
  if (owner.startsWith(ROOF_OWNER_PREFIX)) return { roof: true };
  return NO_SELECTION;
}

/**
 * Eine Ebene höher (Esc, Pfad über dem Titel; W2-ED U3): Möbel → Raum → Etage → Haus; Treppe → ihre untere Etage;
 * Dach, Außen-Teil und Etage → Haus. Die Hierarchie ist Haus › Etage › Raum › Möbel.
 */
export function parentSelection(sel: Selection, state: ProjectState): Selection {
  if (sel.placementId !== undefined && sel.roomId !== undefined) return { roomId: sel.roomId };
  if (sel.roomId !== undefined) {
    const room = state.rooms.find((r) => r.id === sel.roomId);
    return room === undefined ? NO_SELECTION : { floorIndex: room.floorIndex };
  }
  if (sel.linkId !== undefined) {
    const link = state.links.find((l) => l.id === sel.linkId);
    return link === undefined ? NO_SELECTION : { floorIndex: link.floorIndex };
  }
  return NO_SELECTION;
}

/** Ebene der Auswahl in Nutzersprache (Chip über der 3D-Ansicht, Statuszeile). */
export function selectionLevel(sel: Selection): 'Haus' | 'Etage' | 'Raum' | 'Möbel' | 'Treppe' | 'Dach' | 'Außen-Teil' {
  if (sel.placementId !== undefined) return 'Möbel';
  if (sel.roomId !== undefined) return 'Raum';
  if (sel.linkId !== undefined) return 'Treppe';
  if (sel.exteriorId !== undefined) return 'Außen-Teil';
  if (sel.roof === true) return 'Dach';
  if (sel.floorIndex !== undefined) return 'Etage';
  return 'Haus';
}

/**
 * Auswahl nach einer Änderung bereinigen: gelöschter Raum → nichts; Platzierung weg (neu gewürfelt, Raum geteilt)
 * → nur der Raum; Außen-Teil nicht mehr im Plan (Gruppe aus, neu gewürfelt) → nichts. Unverändert gültige Auswahl kommt
 * identisch zurück (kein unnötiges Neuzeichnen).
 */
export function validSelection(sel: Selection, state: ProjectState, exterior?: ExteriorPlan): Selection {
  if (sel.roof === true) return state.rooms.length > 0 ? sel : NO_SELECTION;
  if (sel.floorIndex !== undefined) return state.floors.some((f) => f.index === sel.floorIndex) ? sel : NO_SELECTION;
  if (sel.exteriorId !== undefined) return exterior?.placements.some((p) => p.id === sel.exteriorId) === true ? sel : NO_SELECTION;
  if (sel.linkId !== undefined) return state.links.some((l) => l.id === sel.linkId) ? sel : NO_SELECTION;
  if (sel.roomId === undefined) return sel.placementId === undefined ? sel : NO_SELECTION;
  if (!state.rooms.some((r) => r.id === sel.roomId)) return NO_SELECTION;
  if (sel.placementId === undefined) return sel;
  const p = state.placements.find((x) => x.id === sel.placementId);
  return p !== undefined && p.roomId === sel.roomId ? sel : { roomId: sel.roomId };
}

/** Zellquader (inklusive min … max), Weltkoordinaten. */
export interface CellBox {
  readonly min: Vec3;
  readonly max: Vec3;
  /** W9-G4: bevorzugte Blickrichtung beim Einpassen (Orbit wie `@mcda/viewer`: yaw, pitch); fehlt = Kamera behält sie. */
  readonly look?: { readonly yaw: number; readonly pitch: number };
}

function boundsOf(cells: Iterable<Vec3>): CellBox | undefined {
  let min: [number, number, number] | undefined;
  let max: [number, number, number] = [0, 0, 0];
  for (const c of cells) {
    if (min === undefined) {
      min = [c[0], c[1], c[2]];
      max = [c[0], c[1], c[2]];
      continue;
    }
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, c[k]!);
      max[k] = Math.max(max[k]!, c[k]!);
    }
  }
  return min === undefined ? undefined : { min, max };
}

/**
 * Rahmen der Auswahl in 3D: die Blockzellen der Platzierung, sonst der Raum (Zellen × Etage vom Boden bis zur
 * Decke), das Außen-Teil über seine Weltzellen. `undefined` ohne Auswahl.
 */
export function selectionBox(sel: Selection, state: ProjectState, views: readonly PlacedView[], exterior?: ExteriorPlan, shell?: Shell): CellBox | undefined {
  if (sel.roof === true) return shell === undefined ? undefined : boundsOf(shell.cells.filter((c) => c.kind === 'roof').map((c) => c.pos));
  if (sel.floorIndex !== undefined) {
    const f = state.floors.find((x) => x.index === sel.floorIndex);
    const cells = state.rooms.filter((r) => r.floorIndex === sel.floorIndex).flatMap((r) => r.cells.toArray());
    const b = boundsOf(cells.map(([x, z]): Vec3 => [x, 0, z]));
    return f === undefined || b === undefined ? undefined : { min: [b.min[0], f.y0, b.min[2]], max: [b.max[0], f.y0 + f.height + 1, b.max[2]] };
  }
  if (sel.exteriorId !== undefined) return boundsOf(exterior?.placements.find((p) => p.id === sel.exteriorId)?.cells ?? []);
  if (sel.linkId !== undefined) {
    const link = state.links.find((l) => l.id === sel.linkId);
    const lo = link === undefined ? undefined : state.floors.find((f) => f.index === link.floorIndex);
    const layout = link === undefined ? undefined : linkLayout(state, link);
    if (lo === undefined || layout === undefined) return undefined;
    return boundsOf(layout.blocks.map((b): Vec3 => [b.cell[0], lo.y0 + b.dy, b.cell[1]]));
  }
  if (sel.placementId !== undefined) {
    const v = views.find((x) => x.placement.id === sel.placementId);
    const box = v === undefined ? undefined : boundsOf(v.placed.cells.map((c) => c.pos));
    if (box !== undefined) return box;
  }
  const room = sel.roomId === undefined ? undefined : state.rooms.find((r) => r.id === sel.roomId);
  const b = room?.cells.bounds();
  if (room === undefined || b === undefined) return undefined;
  const floor = state.floors.find((f) => f.index === room.floorIndex);
  const y0 = floor?.y0 ?? 0;
  const top = y0 + (floor?.height ?? 3) + 1;
  return { min: [b.minX, y0, b.minZ], max: [b.maxX, top, b.maxZ] };
}

/**
 * Quader des Hauses (alle Hüllzellen, ohne Gelände): Ziel von „Einpassen“ und der automatischen Einpassung nach
 * „Übernehmen“ (W2-ED U3; vorher passte die Kamera auf das ganze Grundstück, das Haus blieb klein).
 */
export function houseBox(shell: Shell): CellBox | undefined {
  const box = boundsOf(shell.cells.map((c) => c.pos));
  // W9-G4 (Review R5 „Erdhaus öffnet nah über der Hügelkuppe“): ein Erdhaus (Lage `buried`) zeigt nur seine Front – die
  // Kamera schaut von vorn (leicht seitlich, flach wie in Augenhöhe) auf Front und Hügel statt von oben auf die Kuppe
  const buried = (shell.settings ?? []).find((s) => s.kind === 'buried');
  if (box === undefined || buried === undefined) return box;
  const [fx, fz] = FRONT_STEP[buried.front ?? 'south'];
  const vx = fx - 0.45 * fz;
  const vz = fz + 0.45 * fx;
  const hill = (buried.cover ?? 2) + 3;
  return {
    min: [box.min[0] - 2, box.min[1], box.min[2] - 2], max: [box.max[0] + 2, box.max[1] + hill, box.max[2] + 2],
    look: { yaw: Math.atan2(-vx, vz), pitch: 0.42 },
  };
}

const FRONT_STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as const;

/** Was ein Außen-Teil ist: Bauteil (Name der Komponente), Gruppe der Außen-Deko, Etage und Andockstelle. */
export interface ExteriorPartInfo {
  readonly id: string;
  /** Katalog-ID der Komponente (W7-K: Fantasy-Module markieren die Fantasy-Auswahl). */
  readonly componentId: string;
  /** Name der Komponente (Katalog), z. B. „Fensterladen“. */
  readonly name: string;
  readonly group: ExteriorGroup;
  /** `EXTERIOR_GROUP_LABELS`, z. B. „Fensterläden“. */
  readonly groupLabel: string;
  /** Etage und Ort, z. B. „EG, am Fenster“. */
  readonly where: string;
}

const ANCHOR_LABEL: Readonly<Record<ShellAnchorKind | 'hearth', string>> = {
  door: 'an der Tür', window: 'am Fenster', eave: 'an der Traufe', verge: 'am Ortgang', ridge: 'am First', ridge_end: 'am Firstende', gable: 'am Giebel',
  corner: 'an der Ecke', plinth: 'am Sockel', storey_line: 'an der Etagengrenze', roof_face: 'auf dem Dach', hearth: 'über der Feuerstelle',
};

/** Info zum gewählten Außen-Teil; `undefined`, wenn keins gewählt ist oder es nicht (mehr) im Plan steht. */
export function exteriorPartInfo(sel: Selection, exterior: ExteriorPlan | undefined, catalog: Catalog): ExteriorPartInfo | undefined {
  const p = sel.exteriorId === undefined ? undefined : exterior?.placements.find((x) => x.id === sel.exteriorId);
  if (p === undefined) return undefined;
  return {
    id: p.id,
    componentId: p.componentId,
    name: catalog.find(p.componentId)?.name ?? p.componentId,
    group: p.group,
    groupLabel: EXTERIOR_GROUP_LABELS[p.group],
    where: `${floorLabel(p.floorIndex)}, ${ANCHOR_LABEL[p.anchor]}`,
  };
}

/** Statuszeile nach dem Klick, z. B. „Außen-Teil: Fensterladen · Gruppe Fensterläden · EG, am Fenster“. */
export const exteriorPartText = (i: ExteriorPartInfo): string => `Außen-Teil: ${i.name} · Gruppe ${i.groupLabel} · ${i.where}`;
