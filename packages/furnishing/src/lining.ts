import { blockName, type LiningMaterial, type LiningRecipe } from '@mcda/catalog';
import { HORIZONTAL, cellKey, key3, opposite, type Cell, type HorizontalDir, type Vec3 } from '@mcda/core';
import { neighbor, type RoomGeometry } from './geometry.js';
import { MECH_CHEST, SMOKE_SOURCE, T_BED, T_HAZARD, T_NOTE, mechanicsOf, smokeOf, traitsOf } from './mechanics.js';
import type { PlacedComponent } from './place.js';

/**
 * Innenhaut eines Raums planen (W2, Baustandard I1/I4, Prüfbericht X4 §7): Sockelleiste, Paneele und Deckenleiste
 * liegen in der Innenluft direkt vor den Wänden, Eckständer stehen in freien Innenecken, Türrahmen neben Innentüren.
 * Rein und deterministisch; die Materialisierung setzt die Zellen nur, wo im fertigen Volumen noch Luft ist.
 *
 * **Die Funktionsteile gewinnen** (Faktencheck): Die Innenhaut kommt nach Einrichtung und Licht-Pass und meidet
 *  - jede Zelle einer Komponente, ihre Luft-Masken und Entities (Rahmen, Gemälde),
 *  - die Türöffnung (Türinnenzelle in Türhöhe) und jede Wandfläche, die kein Mauerwerk ist (Fenster, Tür, Treppe,
 *    Geländer, offene Kante),
 *  - die Zelle über einem Lagerfeuer (Rauch, Faktencheck #13) und über einem Notenblock (`noteBlockAirAbove`),
 *  - den 3×3-Ring um einen Zaubertisch auf Tisch- und Regalhöhe (Teppich/Falltür blockieren, Faktencheck #1).
 * Falltür und Treppe sind keine Redstone-Leiter (Truhe öffnet, T5) und nicht erstickend (Bett bleibt benutzbar, G2).
 * Offene Falltüren an der Wand sind 3/16 dünn: die Zelle bleibt begehbar (`isWalkable`). Eckständer sind volle
 * Blöcke – sie stehen nur in Innenecken, deren Spalte ganz frei ist, nie in der Türzone, und nur, wenn die freie
 * Bodenfläche zusammenhängend bleibt und jede Tür erreicht (wie `connectivityOK` des Solvers).
 */

export type LiningPart = 'skirting' | 'panel' | 'crown' | 'post' | 'jamb';

/**
 * Wandfläche einer Nachbarspalte in einer Reihe: Mauerwerk, Pfosten der Hülle (Anschlusspfosten I2, Türlaibung I4 –
 * bleibt sichtbar), Glas, Tür oder nichts davon (Treppe, Loch, Kante).
 */
export type LiningBoundary = 'wall' | 'post' | 'glass' | 'door' | 'none';

/** Ausrichtung wie `ShellOrient` der Hülle (strukturgleich): Falltür offen mit `facing` weg von der Wand usw. */
export interface LiningOrient {
  readonly facing?: HorizontalDir;
  readonly half?: 'bottom' | 'top';
  readonly open?: boolean;
  readonly axis?: 'y';
}

export interface LiningCell {
  readonly pos: Vec3;
  readonly part: LiningPart;
  readonly role: string;
  readonly shape: string;
  readonly orient: LiningOrient;
}

export interface LiningInput {
  /** Raum wie für die Einrichtung (`furnishingGeometry`): Treppe/Loch nicht in `interior`, sondern in `blocked`. */
  readonly geometry: RoomGeometry;
  /** Wandfläche der Nachbarspalte (Weltposition der Wandzelle). */
  readonly boundary: (x: number, y: number, z: number) => LiningBoundary;
  /** Alle Komponenten des Raums (Möbel, Kinder, Lichter). */
  readonly placed: readonly PlacedComponent[];
  readonly recipe: LiningRecipe;
}

/** Eckständer erst ab dieser kurzen Innenseite (kleine Kammern bleiben ruhig). */
export const POST_MIN_SIDE = 3;
/** Türhöhe (Türöffnung bleibt in diesen Reihen frei). */
const DOOR_ROWS = 2;

const ENCHANTING = 'enchanting_table';

export function planLining(input: LiningInput): LiningCell[] {
  const { geometry: g, boundary, placed, recipe } = input;
  const H = g.height;
  const y0 = g.baseY;
  if (H < 1 || g.interior.isEmpty) return [];
  const crownRow = recipe.crown !== undefined && H >= 3 ? H - 1 : undefined;
  /** Reihen der Paneele/Ständer: 0 … top − 1 (darüber die Deckenleiste). */
  const top = crownRow ?? H;
  const blocked = g.blocked;

  // ---------------------------------------------------------------- Belegung: die Funktionsteile gewinnen
  const taken = new Set<string>();
  const floor = new Set<string>();
  /** Komponenten-Zellen, auf die ein voller Block darf (keine Truhe, kein Bett, kein Notenblock, kein Feuer). */
  const bearing = new Set<string>();
  for (const p of placed) {
    const smoke = smokeOf(p.expanded);
    const traits = traitsOf(p.expanded);
    const mech = mechanicsOf(p.expanded);
    p.cells.forEach((c, i) => {
      taken.add(key3(c.pos));
      if (mech[i] !== MECH_CHEST && (traits.cells[i]! & (T_BED | T_NOTE | T_HAZARD)) === 0 && smoke[i] !== SMOKE_SOURCE) bearing.add(key3(c.pos));
      if (c.pos[1] <= y0 + 1 && !p.expanded.walkable) floor.add(cellKey(c.pos[0], c.pos[2]));
      const [x, y, z] = c.pos;
      if (smoke[i] === SMOKE_SOURCE || (traits.cells[i]! & T_NOTE) !== 0) taken.add(key3([x, y + 1, z]));
      if (c.mat.block !== undefined && blockName(c.mat.block) === ENCHANTING) {
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const dy of [0, 1]) taken.add(key3([x + dx, y + dy, z + dz]));
      }
    });
    for (const a of p.air) taken.add(key3(a));
    for (const e of p.entities) taken.add(key3([Math.floor(e.pos[0]), Math.floor(e.pos[1]), Math.floor(e.pos[2])]));
  }
  const free = (x: number, r: number, z: number): boolean => !taken.has(key3([x, y0 + r, z]));

  const inRoom = (x: number, z: number): boolean => g.interior.has(x, z) && !(blocked?.has(x, z) ?? false);
  /** Wandrichtungen einer Innenzelle in Reihe r (nur Mauerwerk, keine Öffnung, keine Treppe). */
  const wallDirs = (x: number, z: number, r: number, posts = false): HorizontalDir[] =>
    HORIZONTAL.filter((d) => {
      const [nx, nz] = neighbor([x, z], d);
      if (g.interior.has(nx, nz) || (blocked?.has(nx, nz) ?? false)) return false;
      const b = boundary(nx, y0 + r, nz);
      return b === 'wall' || (posts && b === 'post');
    });

  // ---------------------------------------------------------------- Türen: Öffnung frei, Rahmen daneben
  const doorInside = new Set<string>();
  const doorZone = new Set<string>();
  /** Türrahmen: Nachbarzelle neben der Türinnenzelle → Richtung der Türwand. */
  const jambs = new Map<string, HorizontalDir>();
  for (const d of g.doors) {
    const [ix, iz] = d.inside;
    doorInside.add(cellKey(ix, iz));
    doorZone.add(cellKey(ix, iz));
    for (const dir of HORIZONTAL) {
      const [nx, nz] = neighbor(d.inside, dir);
      if (inRoom(nx, nz)) doorZone.add(cellKey(nx, nz));
    }
    const [tx, tz] = neighbor(d.inside, d.toward);
    // nur echte Türen (Treppenzugänge sind in der Einrichtung auch „Türen“)
    if (recipe.jamb === undefined || boundary(tx, y0, tz) !== 'door') continue;
    for (const side of perpendicular(d.toward)) {
      const [fx, fz] = neighbor(d.inside, side);
      // die Flanke gehört zu einer Doppeltür, wenn dort selbst eine Tür ist
      const [wx, wz] = neighbor([fx, fz], d.toward);
      if (!inRoom(fx, fz) || boundary(wx, y0, wz) !== 'wall') continue;
      jambs.set(cellKey(fx, fz), d.toward);
    }
  }

  // ---------------------------------------------------------------- Eckständer (volle Blöcke, nur ohne Schaden)
  const posts = new Set<string>();
  const cells = g.interior.toArray().filter(([x, z]) => inRoom(x, z));
  const b = g.interior.bounds();
  const minSide = b === undefined ? 0 : Math.min(b.maxX - b.minX + 1, b.maxZ - b.minZ + 1);
  if (recipe.post !== undefined && minSide >= POST_MIN_SIDE) {
    for (const [x, z] of cells) {
      const k = cellKey(x, z);
      if (doorZone.has(k) || jambs.has(k)) continue;
      let corner = true;
      for (let r = 0; r < H && corner; r++) {
        corner = isCorner(wallDirs(x, z, r));
        if (r < top && !free(x, r, z)) corner = false;
      }
      if (!corner) continue;
      posts.add(k);
      if (!floorConnected(cells, floor, posts, g)) posts.delete(k);
    }
  }

  // ---------------------------------------------------------------- Zellen
  const out: LiningCell[] = [];
  const emit = (x: number, r: number, z: number, part: LiningPart, mat: LiningMaterial, orient: LiningOrient): void => {
    out.push({ pos: [x, y0 + r, z], part, role: mat.role, shape: mat.shape, orient });
  };
  /** Ständer-Stücke über Eckmöbeln (Stapel nach oben). */
  const stub = new Set<string>();
  const panelOrient = (wall: HorizontalDir): LiningOrient => ({ facing: opposite(wall) as HorizontalDir, half: 'bottom', open: true });
  for (const [x, z] of cells) {
    const k = cellKey(x, z);
    for (let r = 0; r < H; r++) {
      if (!free(x, r, z)) continue;
      // Pfosten der Hülle (Anschluss, Türlaibung) bleiben sichtbar: keine Paneele davor, die Deckenleiste läuft darüber
      const dirs = wallDirs(x, z, r, r === crownRow);
      if (r === crownRow) {
        if (dirs.length > 0) emit(x, r, z, 'crown', recipe.crown!, { facing: dirs[0]!, half: 'top' });
        continue;
      }
      if (posts.has(k)) {
        emit(x, r, z, 'post', recipe.post!, { axis: 'y' });
        continue;
      }
      if (dirs.length === 0) continue;
      // Eckständer über einem Möbel in der Ecke (ab Reihe 1): trägt die Ecke weiter, statt eine Wand offen zu lassen.
      // Nur auf tragenden Möbeln (nie über Truhe, Bett, Notenblock, Feuer) und nie in der Türzone.
      if (recipe.post !== undefined && r >= 1 && isCorner(dirs) && !doorZone.has(k) && !jambs.has(k)
        && (bearing.has(key3([x, y0 + r - 1, z])) || stub.has(key3([x, y0 + r - 1, z])))) {
        stub.add(key3([x, y0 + r, z]));
        emit(x, r, z, 'post', recipe.post, { axis: 'y' });
        continue;
      }
      const jamb = jambs.get(k);
      if (jamb !== undefined && dirs.includes(jamb)) {
        emit(x, r, z, 'jamb', recipe.jamb!, panelOrient(jamb));
        continue;
      }
      if (doorInside.has(k) && r < DOOR_ROWS) continue;
      if (recipe.panel === undefined) continue;
      const skirting = r === 0 && recipe.skirting !== undefined;
      emit(x, r, z, skirting ? 'skirting' : 'panel', skirting ? recipe.skirting! : recipe.panel, panelOrient(dirs[0]!));
    }
  }
  return out;
}

/** Innenecke: zwei Wände über Eck (nicht gegenüber). */
function isCorner(dirs: readonly HorizontalDir[]): boolean {
  return dirs.length >= 2 && dirs.some((d) => dirs.includes(perpendicular(d)[0]!));
}

/** Die beiden Richtungen quer zu `d` (im Uhrzeigersinn zuerst). */
function perpendicular(d: HorizontalDir): [HorizontalDir, HorizontalDir] {
  const i = HORIZONTAL.indexOf(d);
  return [HORIZONTAL[(i + 1) % 4]!, HORIZONTAL[(i + 3) % 4]!];
}

/**
 * Bleibt die freie Bodenfläche mit den Ständern zusammenhängend und erreicht sie jede Tür? (wie `connectivityOK`:
 * belegt = Möbel in Laufhöhe; Ständer kommen dazu.)
 */
function floorConnected(cells: readonly Cell[], floor: ReadonlySet<string>, posts: ReadonlySet<string>, g: RoomGeometry): boolean {
  const isFree = (k: string): boolean => !floor.has(k) && !posts.has(k);
  const all = new Set(cells.map(([x, z]) => cellKey(x, z)));
  const start = cells.find(([x, z]) => isFree(cellKey(x, z)));
  if (start === undefined) return false;
  const reached = new Set([cellKey(start[0], start[1])]);
  const queue: Cell[] = [start];
  let freeCount = 0;
  for (const k of all) if (isFree(k)) freeCount++;
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!;
    for (const d of HORIZONTAL) {
      const n = neighbor(c, d);
      const k = cellKey(n[0], n[1]);
      if (reached.has(k) || !all.has(k) || !isFree(k)) continue;
      reached.add(k);
      queue.push(n);
    }
  }
  return reached.size === freeCount && g.doors.every((d) => !all.has(cellKey(d.inside[0], d.inside[1])) || reached.has(cellKey(d.inside[0], d.inside[1])));
}
