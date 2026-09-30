/**
 * F „Bereich neu einrichten“ (plan/spikes/WFC_ausschoepfung.md §3.2, Boris the Brave „Modifying in Blocks“,
 * https://www.boristhebrave.com/2021/10/26/model-synthesis-and-modifying-in-blocks/): ein Teilbereich eines Raums – eine
 * Funktionszone (`planZones`) oder ein Rechteck – wird neu eingerichtet, alles außerhalb bleibt eingefroren.
 *
 * Ablauf (App und Engine rufen dieselbe Funktion):
 *  1. **Einheiten**: eine Platzierung samt aufgesetzter Teile (Tisch + Stühle + Kerzen) ist eine Einheit.
 *  2. **Kern**: automatische, ungesperrte Einheiten, die den Bereich berühren, entfallen. Ihr Grundriss gehört mit zum
 *     Bearbeitungsgebiet (ein langer Tisch am Rand darf ganz neu gesetzt werden).
 *  3. **Überlappungsrand** (`margin` 0–2 Zellen um den Bereich): automatische Einheiten, die ganz im Gebiet liegen und
 *     den Rand berühren, dürfen mit umgestellt werden – im ersten Versuch als Vorgabe („bleibt, wenn es noch passt“,
 *     Solver-Option `keep`), in weiteren Versuchen frei. So schließt das neue Stück sauber an.
 *  4. **Eingefroren** ist alles andere, dazu immer gesperrte und von Hand gesetzte Möbel. Eingefrorene Möbel gehen als
 *     feste Hindernisse in den Solver und erfüllen ihr Programm-Objekt (kein zweites Bett neben dem stehenden).
 *     Außerhalb des Gebiets reserviert eine Luftmaske (Spalten in voller Raumhöhe, begehbar) den Platz: dort setzt der
 *     Solver nichts, die Konnektivität des ganzen Raums prüft er trotzdem.
 *  5. **Prüfen**: nur Zellen im Gebiet, Pflichtobjekte des Raumtyps weiter erfüllt (nie unter den Stand vorher bzw. die
 *     Mindestzahl), freie Bodenfläche zusammenhängend und jede Tür erreichbar (wenn sie es vorher war), und **nie
 *     schlechter** (W8-H): mindestens so viele Programm-Möbel wie entfernt, nach dem Entfernen nie leer. Scheitert ein
 *     Versuch, wird **nur dieser Bereich** mit dem nächsten Unter-Seed wiederholt; der Rest wird nie angefasst.
 *
 * Deterministisch: Unter-Seed = Raum-Seed × Zähler der bisherigen Bereichs-Einrichtungen des Raums × Versuch.
 * Kein Eingriff in den Solver (nur bestehende Optionen `fixed`/`keep`); ohne Aufruf bleibt alles bitgleich.
 */
import type { PlacementDraft, PlacementId, Project, RoomId, Shell } from '@mcda/blueprint';
import type { Catalog, RoomTypeEntry } from '@mcda/catalog';
import { CellSet, cellKey, hashSeed, type Cell, type Vec3 } from '@mcda/core';
import {
  analyzeRoom, furnishRoom, planZones, type ExpandedComponent, type FunctionZone, type KeepHint, type PlacedComponent, type RoomGeometry,
} from '@mcda/furnishing';
import { furnishingGeometry } from './geometry.js';
import { placedFor } from './world.js';

/** Breite des Überlappungsrands (Zellen um den Bereich, die mit umgestellt werden dürfen). */
export const BLOCK_MARGIN = { min: 0, max: 2, standard: 1 } as const;
/** Versuche je Bereich (Unter-Seeds), bevor der Befehl ohne Änderung abbricht. */
export const BLOCK_ATTEMPTS = { min: 1, max: 8, standard: 4 } as const;

export interface BlockRefurnishRequest {
  readonly roomId: RoomId;
  /** Bereich (Zone oder Rechteck) in Weltzellen; wird auf das Rauminnere beschnitten. */
  readonly cells: CellSet;
  /** Überlappungsrand in Zellen (0–2, Standard 1). */
  readonly margin?: number;
  /** Versuche mit neuen Unter-Seeds (1–8, Standard 4). */
  readonly attempts?: number;
}

export interface BlockRefurnishOptions {
  /** Dichte-Regler 0–2 wie beim Einrichten (Standard 1). */
  readonly density?: number;
  /** Stil-Kette des Themes (`styleChainOf`). */
  readonly styles?: readonly string[];
  /** Verbindlicher Mittelgang (P07). */
  readonly minAisle?: boolean;
  /** Auswahl-Sicht der Block-Regeln (W3-BL); Standard der Katalog selbst. */
  readonly choice?: Catalog;
}

export interface BlockRefurnishReport {
  /** true = übernommen; false = kein Versuch bestand die Prüfung (oder kein Innenfeld im Bereich), das Projekt ist unverändert. */
  readonly ok: boolean;
  /** Es gab etwas zu ändern (entfernt oder gesetzt) – nur dann entsteht ein Event bzw. ein Undo-Schritt. */
  readonly changed: boolean;
  readonly roomId: RoomId;
  /** Bereich im Rauminneren. */
  readonly block: CellSet;
  /** Bearbeitungsgebiet: Bereich, Überlappungsrand und Grundriss der Kern-Einheiten. */
  readonly region: CellSet;
  /** Entfernte Platzierungen (samt aufgesetzter Teile). */
  readonly removed: readonly PlacementId[];
  /** Neu gesetzte Platzierungen. */
  readonly added: number;
  /** Platzierungen des Raums, die unverändert bleiben. */
  readonly frozen: number;
  /** Versuche, die gebraucht (ok) bzw. vergeblich gemacht wurden. */
  readonly attempts: number;
  /** Solver-Hinweise des übernommenen Versuchs (bzw. Gründe der Fehlversuche). */
  readonly warnings: readonly string[];
  /** Grund, wenn nicht übernommen (deutsch, für die Statuszeile). */
  readonly reason?: string;
}

/** Ergebnis der Planung ohne Anwenden (für Tests und Vorschau). */
export interface BlockRefurnishPlan {
  readonly report: BlockRefurnishReport;
  readonly removed: readonly PlacementId[];
  readonly drafts: readonly PlacementDraft[];
}

const clampInt = (v: number | undefined, r: { min: number; max: number; standard: number }): number =>
  v === undefined || !Number.isFinite(v) ? r.standard : Math.max(r.min, Math.min(r.max, Math.round(v)));

/** Zellen im Abstand 1…`margin` (Schachbrett-Abstand) um `cells`, nur in `inside`. */
export function ringAround(cells: CellSet, margin: number, inside: CellSet): CellSet {
  if (margin <= 0) return CellSet.empty();
  const out: Cell[] = [];
  for (const [x, z] of cells.toArray()) {
    for (let dx = -margin; dx <= margin; dx++) {
      for (let dz = -margin; dz <= margin; dz++) {
        const c: Cell = [x + dx, z + dz];
        if (inside.has(c[0], c[1]) && !cells.has(c[0], c[1])) out.push(c);
      }
    }
  }
  return CellSet.of(out);
}

/** Funktionszonen eines Raums (`planZones` über die Einrichtungs-Geometrie) – Auswahl „Zone neu einrichten“. */
export function roomZones(shell: Shell, roomId: RoomId): FunctionZone[] {
  const info = shell.rooms.get(roomId);
  return info === undefined ? [] : planZones(analyzeRoom(furnishingGeometry(info)));
}

interface Unit {
  readonly ids: PlacementId[];
  /** Grundriss (x, z) aller Blöcke der Einheit. */
  cols: CellSet;
  movable: boolean;
}

/** Leere Form für die Luftmaske außerhalb des Gebiets (keine Blöcke, kein Programm-Objekt). */
const MASK_FORM: ExpandedComponent = {
  defId: '', variantId: undefined, mount: 'floor', size: [1, 1, 1], cells: [], air: [], entities: [], sockets: [], masks: {}, walkable: true,
};
/** Nie passende Vorgabe: schaltet im Solver „feste Möbel erfüllen ihr Programm-Objekt“ ein, ohne etwas zu setzen. */
const NO_HINT: KeepHint = { key: '\u0000block', componentId: '\u0000', pose: { pos: [0, 0, 0], rot: 0, mirror: 'none' } };

function airMask(geom: RoomGeometry, outside: readonly Cell[]): PlacedComponent {
  const air: Vec3[] = [];
  for (const [x, z] of outside) for (let y = geom.baseY; y < geom.baseY + geom.height; y++) air.push([x, y, z]);
  return { expanded: MASK_FORM, pose: NO_HINT.pose, size: [1, 1, 1], cells: [], air, entities: [], sockets: [] };
}

/** Mindestzahl eines Pflicht-Eintrags. */
const entryMin = (e: RoomTypeEntry): number => (Array.isArray(e.count) ? e.count[0] : e.count.min);

/** Freie Bodenzellen hängen zusammen und erreichen jede Tür (wie `connectivityOK`, für den ganzen Raum). */
function connected(geom: RoomGeometry, placed: readonly PlacedComponent[]): boolean {
  const taken = new Set<string>();
  for (const p of placed) {
    if (p.expanded.walkable) continue;
    for (const c of p.cells) if (c.pos[1] <= geom.baseY + 1) taken.add(cellKey(c.pos[0], c.pos[2]));
  }
  const free = geom.interior.toArray().filter(([x, z]) => !taken.has(cellKey(x, z)));
  if (free.length === 0) return false;
  const freeKeys = new Set(free.map(([x, z]) => cellKey(x, z)));
  const seen = new Set<string>([cellKey(free[0]![0], free[0]![1])]);
  const queue: Cell[] = [free[0]!];
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i]!;
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]] as const) {
      const k = cellKey(nx, nz);
      if (seen.has(k) || !freeKeys.has(k)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  return seen.size === free.length && geom.doors.every((d) => seen.has(cellKey(d.inside[0], d.inside[1])));
}

/**
 * Plant die Bereichs-Einrichtung (rein, ändert das Projekt nicht). Wirft bei unbekanntem Raum oder Raum ohne Hülle;
 * fachliches Scheitern (kein Innenfeld im Bereich, kein Versuch bestanden) steht im Bericht (`ok: false`, `reason`).
 */
export function planBlockRefurnish(
  project: Project, shell: Shell, catalog: Catalog, req: BlockRefurnishRequest, opts: BlockRefurnishOptions = {},
): BlockRefurnishPlan {
  const room = project.room(req.roomId);
  const info = shell.rooms.get(room.id);
  if (info === undefined) throw new Error(`${room.id}: keine Hülle (Raum zu klein?)`);
  if (!catalog.roomTypeIds().includes(room.roomTypeId)) throw new Error(`Unbekannter Raumtyp „${room.roomTypeId}“`);
  const geom = furnishingGeometry(info);
  const inside = geom.blocked === undefined ? geom.interior : geom.interior.difference(geom.blocked);
  const block = req.cells.intersection(inside);
  const margin = clampInt(req.margin, BLOCK_MARGIN);
  const attempts = clampInt(req.attempts, BLOCK_ATTEMPTS);
  // Nutzereingabe, kein interner Fehler: Rechteck nur auf Wand oder Treppe
  if (block.isEmpty) {
    const count = project.state.placements.filter((p) => p.roomId === room.id).length;
    return {
      report: {
        ok: false, changed: false, roomId: room.id, block, region: block, removed: [], added: 0, frozen: count, attempts: 0, warnings: [],
        reason: 'Der Bereich liegt nicht im Rauminneren (nur Wand oder Treppe) – nichts geändert',
      },
      removed: [],
      drafts: [],
    };
  }
  const rt = catalog.roomType(room.roomTypeId);

  // 1. Einheiten (Wurzel + aufgesetzte Teile), Reihenfolge des Projektzustands
  const all = project.state.placements.filter((p) => p.roomId === room.id);
  const byId = new Map(all.map((p) => [p.id, p]));
  const rootOf = (id: PlacementId): PlacementId => {
    let p = byId.get(id)!;
    while (p.parentId !== undefined && byId.has(p.parentId)) p = byId.get(p.parentId)!;
    return p.id;
  };
  const placedById = new Map<PlacementId, PlacedComponent>();
  const units = new Map<PlacementId, Unit>();
  for (const p of all) {
    const def = catalog.find(p.componentId);
    const placed = def === undefined ? undefined : placedFor(p, catalog);
    if (placed !== undefined) placedById.set(p.id, placed);
    const root = rootOf(p.id);
    let u = units.get(root);
    if (u === undefined) units.set(root, (u = { ids: [], cols: CellSet.empty(), movable: true }));
    u.ids.push(p.id);
    if (placed !== undefined) u.cols = u.cols.union(CellSet.of(placed.cells.map((c) => [c.pos[0], c.pos[2]] as Cell)));
    // gesperrt, von Hand gesetzt oder unbekannte Komponente → die ganze Einheit bleibt
    if (p.locked || p.origin !== 'auto' || placed === undefined) u.movable = false;
  }

  // 2./3. Kern, Gebiet, Rand
  const core = [...units.values()].filter((u) => u.movable && u.cols.intersects(block));
  let region = block.union(ringAround(block, margin, inside));
  for (const u of core) region = region.union(u.cols.intersection(inside));
  const ring = region.difference(block);
  const border = [...units.values()].filter((u) => u.movable && !core.includes(u) && u.cols.intersects(ring) && u.cols.difference(region).isEmpty);
  const removedUnits = [...core, ...border];
  const removed = removedUnits.flatMap((u) => u.ids);
  const gone = new Set(removed);
  const frozen = all.filter((p) => !gone.has(p.id));
  const frozenPlaced = frozen.map((p) => placedById.get(p.id)).filter((p): p is PlacedComponent => p !== undefined);
  const mask = airMask(geom, geom.interior.toArray().filter(([x, z]) => !region.has(x, z)));
  const borderHints: KeepHint[] = border.flatMap((u) => u.ids.map((id) => {
    const p = byId.get(id)!;
    return {
      key: p.id, componentId: p.componentId, pose: p.pose,
      ...(p.variantId !== undefined ? { variantId: p.variantId } : {}),
      ...(p.parentId !== undefined ? { parentKey: p.parentId } : {}),
      ...(p.socketId !== undefined ? { socketId: p.socketId } : {}),
    };
  }));

  // Maßstab „vorher“: Pflicht-Einträge und Konnektivität
  const tagsOf = (componentId: string): readonly string[] => catalog.find(componentId)?.tags ?? [];
  const countFor = (e: RoomTypeEntry, ids: readonly string[]): number => ids.filter((c) => tagsOf(c).some((t) => e.tags.includes(t))).length;
  const beforeIds = all.map((p) => p.componentId);
  const need = rt.required.map((e) => Math.min(countFor(e, beforeIds), entryMin(e)));
  const wasConnected = connected(geom, [...placedById.values()]);
  // W8-H: nie still verschlechtern – ein Versuch muss mindestens so viele Programm-Möbel (Pflicht- und Wunsch-Einträge
  // des Raumtyps, auch aufgesetzte Deko) aufstellen, wie er entfernt, und nach dem Entfernen überhaupt etwas
  const entries = [...rt.required, ...rt.optional];
  const programCount = (ids: readonly string[]): number => ids.filter((c) => entries.some((e) => tagsOf(c).some((t) => e.tags.includes(t)))).length;
  const removedProgram = programCount(all.filter((p) => gone.has(p.id)).map((p) => p.componentId));
  let bestWorse = -1;

  const round = project.history.filter((e) => e.type === 'RoomBlockRefurnished' && e.roomId === room.id).length;
  const base = project.roomSeed(room.id);
  const failures: string[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const hints = attempt === 0 && borderHints.length > 0 ? borderHints : [NO_HINT];
    const res = furnishRoom(geom, rt, opts.choice ?? catalog, {
      seed: hashSeed(base, 'block', round, attempt),
      dataVersion: project.state.targetVersion.dataVersion,
      fixed: [...frozenPlaced, mask],
      ...(opts.density !== undefined && opts.density !== 1 ? { density: opts.density } : {}),
      ...(opts.styles !== undefined ? { styles: opts.styles } : {}),
      ...(opts.minAisle === true ? { minAisle: true } : {}),
      keep: hints,
    });
    const drafts = res.placements;
    const newPlaced = drafts.map((d) => placedFor({ ...d, id: d.key, roomId: room.id, locked: false, origin: 'auto' }, catalog));
    const why = ((): string | undefined => {
      if (newPlaced.some((p) => p.cells.some((c) => !region.has(c.pos[0], c.pos[2])))) return 'Möbel ragt aus dem Bereich';
      const afterIds = [...frozen.map((p) => p.componentId), ...drafts.map((d) => d.componentId)];
      const lost = rt.required.findIndex((e, i) => countFor(e, afterIds) < need[i]!);
      if (lost >= 0) return `Pflichtobjekt ${rt.required[lost]!.tags.join('|')} fehlt danach`;
      if (wasConnected && !connected(geom, [...frozenPlaced, ...newPlaced])) return 'freie Fläche zerfällt oder eine Tür ist zugestellt';
      return undefined;
    })();
    if (why !== undefined) {
      failures.push(`Versuch ${attempt + 1}: ${why}`);
      continue;
    }
    const addedProgram = programCount(drafts.map((d) => d.componentId));
    if (removed.length > 0 && (drafts.length === 0 || addedProgram < removedProgram)) {
      bestWorse = Math.max(bestWorse, addedProgram);
      failures.push(`Versuch ${attempt + 1}: nur ${addedProgram} statt ${removedProgram} Möbel`);
      continue;
    }
    // Hinweise des Solvers zum ganzen Programm: nur die, die nicht schon „vorher“ galten, sind für den Bereich wichtig
    const warnings = res.warnings.filter((w) => !w.startsWith('Pflichtobjekt'));
    return {
      report: {
        ok: true, changed: removed.length > 0 || drafts.length > 0, roomId: room.id, block, region, removed, added: drafts.length, frozen: frozen.length,
        attempts: attempt + 1, warnings,
      },
      removed,
      drafts,
    };
  }
  return {
    report: {
      ok: false, changed: false, roomId: room.id, block, region, removed: [], added: 0, frozen: all.length, attempts, warnings: failures,
      reason: bestWorse === 0
        ? `Bereich zu klein für neue Möbel – nichts geändert (in ${attempts} Versuchen passte nichts hinein)`
        : bestWorse > 0
          ? `Neu einrichten brächte weniger Möbel (bestenfalls ${bestWorse} statt ${removedProgram} in ${attempts} Versuchen) – nichts geändert`
          : `Bereich ließ sich in ${attempts} Versuchen nicht stimmig neu einrichten (${failures[failures.length - 1] ?? 'unbekannt'}) – nichts geändert`,
    },
    removed: [],
    drafts: [],
  };
}

/**
 * Richtet einen Bereich neu ein und übernimmt das Ergebnis als ein Event (`RoomBlockRefurnished`, ein Undo-Schritt).
 * Ohne bestandenen Versuch bleibt das Projekt unverändert (`ok: false`, Grund im Bericht).
 */
export function refurnishBlock(
  project: Project, shell: Shell, catalog: Catalog, req: BlockRefurnishRequest, opts: BlockRefurnishOptions = {},
): BlockRefurnishReport {
  const plan = planBlockRefurnish(project, shell, catalog, req, opts);
  if (plan.report.ok) project.refurnishBlock(req.roomId, plan.report.block, plan.removed, plan.drafts);
  return plan.report;
}
