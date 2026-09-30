/**
 * Licht-Pass (Pipeline-Schritt 8): Blocklicht per BFS und Spawn-Report.
 *
 * - Emission laut Tabelle (research/04 §4.5, Faktencheck 10): Laterne 15, Fackel 14, Kerze 3 × Anzahl
 *   (nur `lit`), Lagerfeuer 15 (lit), Seelen-Varianten 10, Glowstone/Meerlaterne/Froschlicht/Shroomlight 15 …
 * - Ausbreitung: −1 je Schritt; undurchsichtige Vollblöcke schlucken; nur Stufen/Treppen/Schnee sperren mit
 *   ihren vollen Flächen (Vanilla `useShapeForLightOcclusion`). Türen, Falltüren, Teppich, Glas: durchlässig (T5).
 * - Spawn: Monster spawnen in der Oberwelt bei Blocklicht 0 (Faktencheck 5). Geprüft werden begehbare
 *   Innenzellen: tragfähige Oberseite darunter + 2 durchgehbare Zellen (Physik-Klasse air/thin; Füße auch flat).
 */
import type { Shell } from '@mcda/blueprint';
import { opposite, type Dir, type Vec3 } from '@mcda/core';
import { isAir, type BlockState } from '@mcda/voxel';
import type { DarkCell, LightGap, LightReport } from './types.js';
import { DIR6, faceSupport, isTransparentFull, step, type CellInfo, type WorldView } from './world.js';

const FIFTEEN = new Set([
  'lantern', 'glowstone', 'sea_lantern', 'shroomlight', 'jack_o_lantern', 'beacon', 'lava', 'fire',
  'ochre_froglight', 'verdant_froglight', 'pearlescent_froglight', 'conduit',
]);
const FOURTEEN = new Set(['torch', 'wall_torch', 'copper_torch', 'copper_wall_torch', 'end_rod']);
const TEN = new Set(['soul_lantern', 'soul_torch', 'soul_wall_torch', 'soul_fire', 'crying_obsidian']);

/** Blocklicht-Emission eines Zustands (0 = leuchtet nicht). */
export function emission(s: BlockState): number {
  const n = s.name;
  const lit = s.properties['lit'] === 'true';
  if (FIFTEEN.has(n) || n.endsWith('copper_lantern')) return 15;
  if (FOURTEEN.has(n)) return 14;
  if (TEN.has(n)) return 10;
  if (n === 'campfire') return lit ? 15 : 0;
  if (n === 'soul_campfire') return lit ? 10 : 0;
  if (n === 'candle' || n.endsWith('_candle')) return lit ? 3 * Number(s.properties['candles'] ?? '1') : 0;
  if (n === 'candle_cake' || n.endsWith('_candle_cake')) return lit ? 3 : 0;
  if (n === 'furnace' || n === 'smoker' || n === 'blast_furnace') return lit ? 13 : 0;
  if (n === 'redstone_lamp') return lit ? 15 : 0;
  if (n === 'redstone_torch' || n === 'redstone_wall_torch') return lit ? 7 : 0;
  if (n === 'enchanting_table' || n === 'glow_lichen') return 7;
  if (n === 'amethyst_cluster') return 5;
  if (n === 'magma_block') return 3;
  if (n === 'brewing_stand' || n === 'brown_mushroom' || n === 'dragon_egg' || n === 'end_portal_frame') return 1;
  return 0;
}

/**
 * Nur Blöcke mit Vanilla-`useShapeForLightOcclusion` sperren Licht über ihre Form (Stufen, Treppen, Schneeschicht).
 * Glas, Türen, Falltüren, Teppiche usw. lassen Licht durch – im Spiel bestätigt (Spike T5, 23.09.2026).
 */
function occludesByShape(name: string): boolean {
  return name.endsWith('_slab') || name.endsWith('_stairs') || name === 'snow';
}

/** Sperrt die Fläche `face` dieses Blocks Licht? Gemeinsame Regel für Licht-Pass, Viewer und App. */
export function faceBlocksLight(info: CellInfo, face: Dir): boolean {
  return occludesByShape(info.state.name) && faceSupport(info, face) === 'full';
}

function opaque(view: WorldView, s: BlockState): boolean {
  return view.physicsOf(s).cls === 'full' && !isTransparentFull(s.name);
}

export interface LightField {
  readonly levels: Uint8Array;
  readonly emitters: LightReport['emitters'];
  levelAt(pos: Vec3): number;
}

/** Blocklicht-BFS über das Volumen (außerhalb: dunkel, kein Licht von draußen). */
export function computeLight(view: WorldView): LightField {
  const v = view.volume;
  const [w, h, l] = v.size;
  const [ox, oy, oz] = v.origin;
  const levels = new Uint8Array(w * h * l);
  const idx = (p: Vec3): number => (p[0] - ox) + (p[2] - oz) * w + (p[1] - oy) * w * l;
  const emitters: { pos: Vec3; block: string; level: number }[] = [];
  const queue: Vec3[] = [];
  for (const c of v.cells()) {
    const e = emission(c.state);
    if (e <= 0) continue;
    emitters.push({ pos: c.pos, block: c.state.name, level: e });
    if (e > levels[idx(c.pos)]!) {
      levels[idx(c.pos)] = e;
      queue.push(c.pos);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    const lvl = levels[idx(p)]!;
    if (lvl <= 1) continue;
    const here = view.info(p);
    for (const d of DIR6) {
      const q = step(p, d);
      if (!view.inside(q)) continue;
      const there = view.info(q);
      if (opaque(view, there.state)) continue;
      if (faceBlocksLight(here, d) || faceBlocksLight(there, opposite(d))) continue;
      const extra = there.state.name.endsWith('_leaves') ? 1 : 0;
      const next = lvl - 1 - extra;
      if (next > levels[idx(q)]!) {
        levels[idx(q)] = next;
        queue.push(q);
      }
    }
  }
  return {
    levels,
    emitters,
    levelAt: (pos) => (view.inside(pos) ? levels[idx(pos)]! : 0),
  };
}

/**
 * Offene Falltür flach an einer Wand (Innenhaut-Paneel, W2): die Platte liegt an der Seite gegenüber `facing`
 * (Modell z 13–16 bei `facing=north`, im Spiel bestätigt, Faktencheck Nachtrag 4) und ist 3/16 dick. Ist der Nachbar
 * auf dieser Seite ein voller Block, versperrt sie nichts: der Spieler (0,6 breit, mittig) passt in die Zelle, und durch
 * die Wand kann er ohnehin nicht. Dann gilt die Zelle für Laufwege wie Luft.
 */
export function isWallPanel(view: WorldView, p: Vec3): boolean {
  const s = view.state(p);
  if (!s.name.endsWith('_trapdoor') || s.properties['open'] !== 'true') return false;
  const f = s.properties['facing'];
  if (f !== 'north' && f !== 'south' && f !== 'east' && f !== 'west') return false;
  const behind = step(p, opposite(f));
  return view.inside(behind) && view.info(behind).phys.cls === 'full';
}

/** Begehbar: tragfähige Oberseite darunter, Füße air/thin/flat, Kopf air/thin (plan/01 §3.1); Wand-Paneele wie Luft. */
export function isWalkable(view: WorldView, p: Vec3): boolean {
  const below: Vec3 = [p[0], p[1] - 1, p[2]];
  const head: Vec3 = [p[0], p[1] + 1, p[2]];
  if (!view.inside(below) || !view.inside(p) || !view.inside(head)) return false;
  const feet = view.info(p).phys.cls;
  const top = view.info(head).phys.cls;
  if (feet !== 'air' && feet !== 'thin' && feet !== 'flat' && !isWallPanel(view, p)) return false;
  if (top !== 'air' && top !== 'thin' && !isWallPanel(view, head)) return false;
  return faceSupport(view.info(below), 'up') === 'full';
}

/** Könnte ein Monster hier laut Physik-Daten spawnen (Untergrund + Spawn-Raum, ohne Licht)? */
function spawnable(view: WorldView, p: Vec3): boolean {
  const below = view.info([p[0], p[1] - 1, p[2]]).phys;
  const feet = view.state(p);
  const head = view.state([p[0], p[1] + 1, p[2]]);
  const blocked = (s: BlockState): boolean => !isAir(s) && view.physicsOf(s).spawnBlocked;
  return below.spawnFloor && !blocked(feet) && !blocked(head);
}

/**
 * Begehbare Innenzellen aller Räume der Hülle mit Blocklicht 0 – plus die **Lichtlücke** je Raum
 * (research/37: Blocklicht fällt je Block um 1, der Taxi-Abstand zur nächsten Quelle *ist* die Dunkelheit).
 * W4: dazu die begehbaren Zellen im Dachraum (`atticSpawn`, `DarkCell.attic`); `walkableCells` zählt weiter nur Räume,
 * `atticCells` die geprüften Dachraum-Zellen; `roomEmitters` = Lichtquellen ohne die des Dachraums (für die Lichtlücke).
 */
export function spawnReport(view: WorldView, light: LightField, shell: Shell): { darkCells: DarkCell[]; walkableCells: number; gaps: LightGap[]; atticCells: number; roomEmitters: number } {
  const darkCells: DarkCell[] = [];
  // W4: Laternen des Dachraum-Lichts stehen hinter der Decke – für die Lichtlücke der Räume zählen sie nicht
  const attic = new Set(shell.cells.filter((c) => c.kind === 'ceiling' && c.shape === 'lantern').map((c) => `${c.pos[0]},${c.pos[1]},${c.pos[2]}`));
  const emitters = attic.size === 0 ? light.emitters : light.emitters.filter((e) => !attic.has(`${e.pos[0]},${e.pos[1]},${e.pos[2]}`));
  const gaps: LightGap[] = [];
  let walkableCells = 0;
  for (const room of shell.rooms.values()) {
    let maxDistance = emitters.length === 0 ? -1 : 0;
    let worst: Vec3 = [0, room.baseY, 0];
    for (const [x, z] of room.interior.toArray()) {
      for (let y = room.baseY; y < room.baseY + room.height; y++) {
        const p: Vec3 = [x, y, z];
        if (!isWalkable(view, p)) continue;
        walkableCells++;
        if (light.levelAt(p) === 0) darkCells.push({ pos: p, roomId: room.roomId, spawnable: spawnable(view, p) });
        // Nächste Quelle in Taxi-Distanz (Blocklicht fällt je Block um 1)
        let nearest = Infinity;
        for (const e of emitters) nearest = Math.min(nearest, Math.abs(e.pos[0] - x) + Math.abs(e.pos[1] - y) + Math.abs(e.pos[2] - z));
        if (nearest !== Infinity && nearest > maxDistance) {
          maxDistance = nearest;
          worst = p;
        }
      }
    }
    gaps.push({ roomId: room.roomId, maxDistance, cell: worst });
  }
  gaps.sort((a, b) => b.maxDistance - a.maxDistance || a.roomId.localeCompare(b.roomId));
  const roof = atticSpawn(view, light, shell);
  darkCells.push(...roof.darkCells);
  return { darkCells, walkableCells, gaps, atticCells: roof.walkable, roomEmitters: emitters.length };
}

/**
 * W4 (27.09.2026, plan/spikes/W4E_feinschliff.md, Review K1): **Dachraum als harte Spawn-Regel.** Der Raum unter einem
 * geneigten Dach ist kein Raum der Hülle, liegt aber im Gebäude: je Spalte mit Deckenplatte (`kind: 'ceiling'`, ohne
 * die Laternen des Dachraum-Lichts) und Dachzelle darüber gehört die Luft zwischen oberster Deckenplatte und der
 * ersten Dachzelle darüber dazu. Begehbare Zellen dort mit Blocklicht 0 kommen als `attic: true` in `darkCells` (Raum = Raum der
 * Decke darunter) – dieselbe Pflicht „0 dunkle Zellen“ wie in den Räumen. Ohne geneigtes Dach: nichts.
 */
function atticSpawn(view: WorldView, light: LightField, shell: Shell): { darkCells: DarkCell[]; walkable: number } {
  const floor = new Map<string, { y: number; roomId: string | undefined }>();
  const roof = new Map<string, number[]>();
  for (const c of shell.cells) {
    const k = `${c.pos[0]},${c.pos[2]}`;
    if (c.kind === 'roof') (roof.get(k) ?? roof.set(k, []).get(k)!).push(c.pos[1]);
    else if (c.kind === 'ceiling' && c.shape !== 'lantern') {
      // Kellerdecken (Etage < 0) liegen im Erdreich – darüber ist Gelände, kein Dachraum (feat/underground: Unterbau
      // neben dem Haus unter der Traufe). Heute ist die oberste Decke einer Spalte nie eine Kellerdecke: bitgleich.
      if ((shell.rooms.get(c.roomId ?? '')?.floorIndex ?? 0) < 0) continue;
      const f = floor.get(k);
      if (f === undefined || f.y < c.pos[1]) floor.set(k, { y: c.pos[1], roomId: c.roomId });
    }
  }
  const darkCells: DarkCell[] = [];
  let walkable = 0;
  for (const [k, f] of floor) {
    // erste Dachzelle über der Decke (darüber, z. B. zwischen einem Anbaudach und der Traufe des Obergeschosses, ist
    // Außenluft)
    const top = Math.min(...(roof.get(k) ?? []).filter((y) => y > f.y));
    if (!Number.isFinite(top) || top <= f.y + 1) continue;
    const [x, z] = k.split(',').map(Number) as [number, number];
    for (let y = f.y + 1; y < top; y++) {
      const p: Vec3 = [x, y, z];
      if (!isWalkable(view, p)) continue;
      walkable++;
      if (light.levelAt(p) === 0) darkCells.push({ pos: p, roomId: f.roomId ?? 'attic', spawnable: spawnable(view, p), attic: true });
    }
  }
  return { darkCells, walkable };
}
