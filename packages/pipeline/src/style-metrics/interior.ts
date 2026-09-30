/**
 * Innenraum-Kennzahlen: Zonen (LV-19), Deckenebene (LV-20), Blickfang und Wandnähe (LV-21), Lichtträger (LV-22),
 * Möbel-Cluster (LV-23). Die Möbelkategorie kommt aus dem Präfix der Komponenten-Kennung (`seat/bench` → `seat`).
 */
import type { RoomShellInfo } from '@mcda/blueprint';
import { isLightSource, isLogLike, isTorch } from './blocks.js';
import { OwnerKind, type Scene, type StyleInput, type StylePlacement } from './scene.js';
import type { Measure, Measures } from './types.js';

const measure = (value: number | null, weight: number, details?: Record<string, number | string | boolean | null>): Measure =>
  details === undefined ? { value, weight } : { value, weight, details };

/** Kategorie einer Komponente (`seat/bench` → `seat`). */
const categoryOf = (componentId: string): string => {
  const i = componentId.indexOf('/');
  return i < 0 ? componentId : componentId.slice(0, i);
};

/** Funktionale Zone einer Möbelkategorie; `undefined` = zählt nicht als Zone (Licht, Architektur, Außen). */
const ZONE_OF: Readonly<Record<string, string>> = {
  seat: 'gather', table: 'gather', storage: 'store', bed: 'sleep', work: 'work', functional: 'work', food: 'cook', bath: 'bath',
  sacred: 'sacred', trade: 'trade', music: 'music', astro: 'astro', treasure: 'treasure',
};
/** Kategorien, die nicht als Möbel gelten (Cluster, Wandnähe). */
const NOT_FURNITURE = new Set(['light', 'arch', 'architecture', 'exterior', 'outdoor', 'portal']);

const FOCUS = /fireplace|fire_pit|throne|altar|anvil|forge|furnace|smelter|crafting|workbench|brewing|stove|lectern|pulpit|armillary|telescope|bar_counter|hearth|cauldron|portal|trophy|stall|banquet/;
const AXIS = /runner|rug|carpet|column|pilaster|pillar/;

interface Box { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number; count: number }

/** Begrenzungsboxen der Platzierungen aus dem Volumen. */
function placementBoxes(scene: Scene): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const { vox } = scene;
  for (const c of vox.solids()) {
    if (c.owner !== OwnerKind.Placed) continue;
    const id = vox.placement(c.x, c.y, c.z);
    if (id === undefined) continue;
    const b = boxes.get(id);
    if (b === undefined) boxes.set(id, { minX: c.x, maxX: c.x, minZ: c.z, maxZ: c.z, minY: c.y, maxY: c.y, count: 1 });
    else { b.count++; if (c.x < b.minX) b.minX = c.x; if (c.x > b.maxX) b.maxX = c.x; if (c.z < b.minZ) b.minZ = c.z; if (c.z > b.maxZ) b.maxZ = c.z; if (c.y < b.minY) b.minY = c.y; if (c.y > b.maxY) b.maxY = c.y; }
  }
  return boxes;
}

const boxGap = (a: Box, b: Box): number => Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX) - 1, Math.max(a.minZ - b.maxZ, b.minZ - a.maxZ) - 1);

/** Balkenlinien im Raum: Reihen von >= 3 Stammblöcken in Deckennähe, nach Achse gruppiert. */
function beamLines(scene: Scene, r: RoomShellInfo): { alongX: number[]; alongZ: number[] } {
  const { vox } = scene;
  const cells = new Set<string>();
  for (const [x, z] of r.interior.toArray()) {
    for (let y = r.baseY + r.height - 2; y <= r.baseY + r.height; y++) {
      if (vox.solid(x, y, z) && isLogLike(vox.name(x, y, z))) { cells.add(`${x},${z}`); break; }
    }
  }
  const lines = { alongX: [] as number[], alongZ: [] as number[] };
  const zs = new Set<number>(), xs = new Set<number>();
  for (const k of cells) { const [x, z] = k.split(',').map(Number) as [number, number]; xs.add(x); zs.add(z); }
  const run = (fixed: number, axisX: boolean): boolean => {
    let best = 0, cur = 0;
    const range = axisX ? [...xs] : [...zs];
    if (range.length === 0) return false;
    const lo = Math.min(...range), hi = Math.max(...range);
    for (let t = lo; t <= hi; t++) {
      const has = cells.has(axisX ? `${t},${fixed}` : `${fixed},${t}`);
      cur = has ? cur + 1 : 0;
      if (cur > best) best = cur;
    }
    return best >= 3;
  };
  for (const z of [...zs].sort((a, b) => a - b)) if (run(z, true)) lines.alongX.push(z);
  for (const x of [...xs].sort((a, b) => a - b)) if (run(x, false)) lines.alongZ.push(x);
  return lines;
}

/** Zusammenhängende Linien (aufeinanderfolgende Koordinaten) zu einer Linie verschmelzen: Balken 2 breit zählt einmal. */
function mergeAdjacent(coords: readonly number[]): number[] {
  const out: number[] = [];
  for (const c of coords) { if (out.length === 0 || c - out[out.length - 1]! > 1) out.push(c); }
  return out;
}

const gapsOf = (coords: readonly number[]): number[] => coords.slice(1).map((c, i) => c - coords[i]!);

export function measureInterior(scene: Scene, input: StyleInput): Measures {
  const m: Record<string, Measure> = {};
  const placements: readonly StylePlacement[] = input.placements ?? [];
  const boxes = placements.length > 0 ? placementBoxes(scene) : new Map<string, Box>();
  const byRoom = new Map<string, StylePlacement[]>();
  for (const p of placements) { if (p.roomId === undefined) continue; const l = byRoom.get(p.roomId); if (l) l.push(p); else byRoom.set(p.roomId, [p]); }
  const rooms: RoomShellInfo[] = [];
  for (const b of scene.buildings) rooms.push(...b.rooms);

  // --- LV-19: Zonen ---
  if (placements.length > 0) {
    let n60 = 0, ok60 = 0, n120 = 0, ok120 = 0;
    for (const r of rooms) {
      const area = r.interior.size;
      if (area <= 60) continue;
      const zones = new Set<string>();
      for (const p of byRoom.get(r.roomId) ?? []) { const z = ZONE_OF[categoryOf(p.componentId)]; if (z !== undefined) zones.add(z); }
      n60++; if (zones.size >= 2) ok60++;
      if (area > 120) {
        let staggered = false;
        for (const c of scene.shell.cells) {
          if ((c.kind === 'stairs' || c.kind === 'railing') && c.pos[1] >= r.baseY && c.pos[1] < r.baseY + r.height && r.interior.has(c.pos[0], c.pos[2])) { staggered = true; break; }
        }
        if (!staggered) { const bl = beamLines(scene, r); staggered = mergeAdjacent(bl.alongX).length >= 2 || mergeAdjacent(bl.alongZ).length >= 2; }
        n120++; if (zones.size >= 3 || staggered) ok120++;
      }
    }
    m['LV-19a'] = measure(n60 === 0 ? null : ok60 / n60, n60);
    m['LV-19b'] = measure(n120 === 0 ? null : ok120 / n120, n120);
  }

  // --- LV-20: Deckenebene ---
  {
    let n = 0, ok = 0, gapN = 0, gapOk = 0;
    for (const r of rooms) {
      if (r.height < 4) continue;
      n++;
      const bl = beamLines(scene, r);
      const lx = mergeAdjacent(bl.alongX), lz = mergeAdjacent(bl.alongZ);
      const best = lx.length >= lz.length ? lx : lz;
      if (best.length >= 2) {
        ok++;
        for (const g of gapsOf(best)) { gapN++; if (g >= 3 && g <= 5) gapOk++; }
      }
    }
    m['LV-20a'] = measure(n === 0 ? null : ok / n, n);
    m['LV-20b'] = measure(gapN === 0 ? null : gapOk / gapN, gapN);
  }

  // --- LV-21: Hauptraum mit Blickfang und Achse; Möbel in Wandnähe ---
  if (placements.length > 0) {
    let nb = 0, okb = 0;
    for (const b of scene.buildings) {
      const ground = b.rooms.filter((r) => r.floorIndex === 0);
      if (ground.length === 0) continue;
      const main = ground.reduce((a, c) => (c.interior.size > a.interior.size ? c : a));
      if (main.interior.size < 20) continue;
      nb++;
      const ps = byRoom.get(main.roomId) ?? [];
      const focus = ps.some((p) => FOCUS.test(p.componentId));
      let axis = ps.some((p) => AXIS.test(p.componentId));
      if (!axis) {
        let carpet = 0;
        for (const [x, z] of main.interior.toArray()) if (/_carpet$/.test(scene.vox.name(x, main.baseY, z))) carpet++;
        axis = carpet >= 4;
      }
      if (focus && axis) okb++;
    }
    m['LV-21a'] = measure(nb === 0 ? null : okb / nb, nb);

    let total = 0, near = 0, near2 = 0;
    const roomById = new Map(rooms.map((r) => [r.roomId as string, r]));
    for (const p of placements) {
      if (p.roomId === undefined || NOT_FURNITURE.has(categoryOf(p.componentId))) continue;
      const r = roomById.get(p.roomId);
      if (r === undefined) continue;
      const [x, , z] = p.pose.pos;
      const step = (d: number): boolean => r.interior.has(x + d, z) && r.interior.has(x - d, z) && r.interior.has(x, z + d) && r.interior.has(x, z - d);
      total++;
      if (!step(1)) near++;
      if (!step(1) || !step(2)) near2++;
    }
    m['LV-21b'] = measure(total === 0 ? null : near / total, total, { withinGap1: total === 0 ? null : near2 / total });
  }

  // --- LV-22: Lichter an Trägern; dunkle Zellen ---
  {
    let lights = 0, torches = 0;
    for (const c of scene.vox.solids()) {
      if (!isLightSource(c.name)) continue;
      lights++;
      if (isTorch(c.name)) torches++;
    }
    m['LV-22a'] = measure(lights === 0 ? null : 1 - torches / lights, lights, { lights, torches });
    const l = input.light;
    m['LV-22b'] = measure(l === undefined || l.walkableCells === 0 ? null : l.darkCells.length / l.walkableCells, l?.walkableCells ?? 0, { dark: l?.darkCells.length ?? null });
  }

  // --- LV-23: Möbel-Cluster ---
  if (placements.length > 0) {
    const groups = new Map<string, Array<{ id: string; box: Box }>>();
    for (const p of placements) {
      if (p.roomId === undefined || NOT_FURNITURE.has(categoryOf(p.componentId))) continue;
      const box = boxes.get(p.id);
      if (box === undefined) continue;
      const l = groups.get(p.roomId);
      if (l) l.push({ id: p.id, box }); else groups.set(p.roomId, [{ id: p.id, box }]);
    }
    let total = 0, clustered = 0;
    for (const items of groups.values()) {
      for (const a of items) {
        total++;
        if (items.some((b) => b.id !== a.id && boxGap(a.box, b.box) <= 1)) clustered++;
      }
    }
    m['LV-23'] = measure(total === 0 ? null : clustered / total, total);
  }
  return m;
}
