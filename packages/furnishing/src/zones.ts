import type { RoomTypeDef } from '@mcda/catalog';
import { CellSet, cellKey, type Cell } from '@mcda/core';
import type { RoomAnalysis } from './analyze.js';
import type { ProgramItem } from './program.js';

/**
 * Funktionszonen großer Räume (research/02 §7.1 Phase 4, §7.16 `zones`). Große Räume werden per BSP
 * (Schnitt quer zur längeren Achse, flächengleich) in 2–4 Teilflächen zerlegt. Jede Zone bekommt einen Anker
 * (das erste dort platzierte Bodenmöbel) und eine Gruppe von Objekten, die sich um ihn sammeln – statt eines
 * gleichmäßigen „Rasters“ über den ganzen Raum (DA-Schwäche, research/07 §3).
 */

export interface FunctionZone {
  readonly id: string;
  readonly cells: CellSet;
  /** Schwerpunkt (x, z). */
  readonly center: readonly [number, number];
  /** Mittlerer Türabstand (für `doorAffinity`). */
  readonly dDoor: number;
}

/** Ab dieser freien Fläche (Zellen) wird zerlegt; je Zone etwa so viele Zellen. */
export const ZONE_MIN_AREA = 96;
export const ZONE_CELLS = 48;
const MAX_ZONES = 4;

function zoneOf(id: string, cells: readonly Cell[], a: RoomAnalysis): FunctionZone {
  let sx = 0, sz = 0, sd = 0, nd = 0;
  for (const [x, z] of cells) {
    sx += x;
    sz += z;
    const d = a.dDoor.get(cellKey(x, z)) ?? Infinity;
    if (Number.isFinite(d)) {
      sd += d;
      nd++;
    }
  }
  return { id, cells: CellSet.of(cells), center: [sx / cells.length, sz / cells.length], dDoor: nd > 0 ? sd / nd : 0 };
}

/**
 * Zerlegt den Raum (ohne gesperrte Zellen); kleine Räume bleiben eine Zone. Mit Mittelgang (Raumtyp-Layout, K3c)
 * schneidet der BSP quer zum Gang: die Zonen folgen einander entlang der Achse (Schiff an der Tür, Chor an der
 * Stirnseite) statt links/rechts vom Gang.
 */
export function planZones(a: RoomAnalysis): FunctionZone[] {
  const cells = a.geometry.interior.toArray().filter(([x, z]) => !a.blocked.has(x, z));
  const k = cells.length < ZONE_MIN_AREA ? 1 : Math.min(MAX_ZONES, Math.floor(cells.length / ZONE_CELLS));
  const along = a.layout?.aisle === undefined ? undefined : a.layout.aisle.axis === 'x' ? 0 : 1;
  let parts: Cell[][] = [cells];
  while (parts.length < k) {
    parts.sort((p, q) => q.length - p.length);
    const halves = split(parts[0]!, along);
    if (halves === undefined) break;
    parts = [...halves, ...parts.slice(1)];
  }
  // stabile Reihenfolge: nach Schwerpunkt (z, dann x)
  const zones = parts.map((p) => zoneOf('', p, a));
  zones.sort((p, q) => p.center[1] - q.center[1] || p.center[0] - q.center[0]);
  return zones.map((z, i) => ({ ...z, id: `z${i}` }));
}

/** Schnitt quer zur längeren Achse (oder zur Achse `forced`) am Median der Koordinate (beide Hälften nicht leer). */
function split(cells: readonly Cell[], forced?: 0 | 1): [Cell[], Cell[]] | undefined {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of cells) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const axis = forced ?? (maxX - minX >= maxZ - minZ ? 0 : 1);
  const coords = cells.map((c) => c[axis]).sort((p, q) => p - q);
  let cut = coords[Math.floor(coords.length / 2)]!;
  if (cut === coords[0]) cut = coords.find((c) => c > cut) ?? cut;
  const lo = cells.filter((c) => c[axis] < cut);
  const hi = cells.filter((c) => c[axis] >= cut);
  return lo.length === 0 || hi.length === 0 ? undefined : [lo, hi];
}

/**
 * Ordnet Programm-Objekten eine Zone zu (Index in `zones`; fehlt = keine Zonen-Wertung):
 *  - benannte Zonen (`rt.zones`, Eintrag `zone`) → Teilfläche nach `doorAffinity`;
 *  - Signatur → Hauptzone (nach ihrer `doorAffinity`, sonst Zone 0);
 *  - Reihen (`pattern: row`) → alle Stück in dieselbe Zone;
 *  - übrige Bodenobjekte reihum (in Platzier-Reihenfolge; die großen werden so die Anker);
 *  - Deckenobjekte (`isCeilingItem`, V3) reihum mit eigenem Zähler: Laternen, Kräuter und Banner verteilen
 *    sich über die Zonen statt sich in der Raummitte zu sammeln;
 *  - reine Wandobjekte ohne Zone.
 */
export function assignZones(
  program: readonly ProgramItem[],
  order: readonly number[],
  zones: readonly FunctionZone[],
  rt: RoomTypeDef,
  isFloorItem: (idx: number) => boolean,
  isCeilingItem?: (idx: number) => boolean,
): Map<number, number> {
  const out = new Map<number, number>();
  if (zones.length <= 1) return out;
  const byDoor = zones.map((z, i) => ({ i, d: z.dDoor })).sort((p, q) => p.d - q.d || p.i - q.i).map((x) => x.i);
  const pick = (aff: string | undefined, taken: ReadonlySet<number>): number => {
    const free = (list: number[]) => list.find((i) => !taken.has(i));
    if (aff === 'far') return free([...byDoor].reverse()) ?? byDoor[byDoor.length - 1]!;
    if (aff === 'near') return free(byDoor) ?? byDoor[0]!;
    return free(zones.map((_, i) => i)) ?? 0;
  };
  const named = new Map<string, number>();
  const taken = new Set<number>();
  for (const z of rt.zones ?? []) {
    const i = pick(z.doorAffinity, taken);
    named.set(z.id, i);
    taken.add(i);
  }
  const sig = program.find((it) => it.signature);
  const primary = sig?.zone !== undefined ? named.get(sig.zone) ?? 0 : pick(sig?.pref.doorAffinity, new Set());
  let rr = primary + 1;
  let primaryUsed = false;
  const rowZone = new Map<number, number>();
  let ceil = primary;
  for (const idx of order) {
    const it = program[idx]!;
    if (it.zone !== undefined && named.has(it.zone)) {
      out.set(idx, named.get(it.zone)!);
      continue;
    }
    if (!isFloorItem(idx)) {
      if (isCeilingItem?.(idx) === true) out.set(idx, ceil++ % zones.length);
      continue;
    }
    if (it.signature && !primaryUsed) {
      primaryUsed = true;
      out.set(idx, primary);
      continue;
    }
    if (it.pattern?.kind === 'row' && rowZone.has(it.entry)) {
      out.set(idx, rowZone.get(it.entry)!);
      continue;
    }
    const z = rr++ % zones.length;
    out.set(idx, z);
    if (it.pattern?.kind === 'row') rowZone.set(it.entry, z);
  }
  return out;
}
