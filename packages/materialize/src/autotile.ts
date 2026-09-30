/**
 * Autotiling (Pipeline-Schritt 6, plan/01 §6), übernommen aus Spike T4 (spikes/algorithms/src/autotile,
 * Vanilla-Code laut Faktencheck 14/18) und auf das Voxel-Volumen umgestellt:
 *  - Treppen-`shape` (StairBlock#getStairsShape)
 *  - Zaun / Scheibe / Mauer (FenceBlock#connectsTo, IronBarsBlock#attachsTo, WallBlock inkl. low/tall/up)
 *  - Zauntor `in_wall`
 *  - Truhenpaare (type=left hat den Partner bei CW(facing))
 * und prüft die Mehrblock-Partner (Bett-Hälften, Tür-Hälften, Truhenpaare).
 * Nachbarschafts-States werden NIE transformiert, sondern hier neu berechnet (plan/01 §5).
 */
import { opposite, rotateDir, type Dir, type HorizontalDir, type Vec3 } from '@mcda/core';
import { blockState, type BlockState, type VoxelCell } from '@mcda/voxel';
import { fenceFamily } from './kinds.js';
import type { Violation } from './types.js';
import { faceSupport, isConnectionException, step, type CellInfo, type WorldView } from './world.js';

const H4: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];
const CW = (d: HorizontalDir): HorizontalDir => rotateDir(d, 1) as HorizontalDir;
const CCW = (d: HorizontalDir): HorizontalDir => rotateDir(d, -1) as HorizontalDir;
const OPP = (d: HorizontalDir): HorizontalDir => opposite(d) as HorizontalDir;
const axisOf = (d: HorizontalDir): 'x' | 'z' => (d === 'east' || d === 'west' ? 'x' : 'z');

type Props = Record<string, string>;

function replace(view: WorldView, pos: Vec3, s: BlockState, changes: Props): void {
  const next: Props = { ...s.properties, ...changes };
  if (Object.keys(changes).every((k) => s.properties[k] === changes[k])) return;
  view.volume.replaceState(pos, blockState(s.name, next));
}

function cellsOfKind(view: WorldView, kind: CellInfo['kind']): VoxelCell[] {
  const out: VoxelCell[] = [];
  for (const c of view.volume.cells()) if (view.kinds.of(c.state.name) === kind) out.push(c);
  return out;
}

// ------------------------------------------------------------------ Treppen

interface StairsInfo {
  readonly facing: HorizontalDir;
  readonly half: string;
}

function stairsAt(view: WorldView, p: Vec3): StairsInfo | undefined {
  const s = view.state(p);
  if (view.kinds.of(s.name) !== 'stairs') return undefined;
  return { facing: s.properties['facing'] as HorizontalDir, half: s.properties['half'] ?? 'bottom' };
}

/** Vanilla-Regel (Faktencheck 14): zuerst hinten → outer, dann vorn → inner, sonst straight. */
export function stairShape(view: WorldView, p: Vec3): string {
  const self = stairsAt(view, p);
  if (!self) throw new Error(`keine Treppe bei ${p.join(',')}`);
  const canTakeShape = (side: HorizontalDir): boolean => {
    const n = stairsAt(view, step(p, side));
    return !n || n.facing !== self.facing || n.half !== self.half;
  };
  const f = self.facing;
  const behind = stairsAt(view, step(p, f));
  if (behind && behind.half === self.half) {
    const f1 = behind.facing;
    if (axisOf(f1) !== axisOf(f) && canTakeShape(OPP(f1))) return f1 === CCW(f) ? 'outer_left' : 'outer_right';
  }
  const front = stairsAt(view, step(p, OPP(f)));
  if (front && front.half === self.half) {
    const f2 = front.facing;
    if (axisOf(f2) !== axisOf(f) && canTakeShape(f2)) return f2 === CCW(f) ? 'inner_left' : 'inner_right';
  }
  return 'straight';
}

export function resolveStairs(view: WorldView): void {
  const updates = cellsOfKind(view, 'stairs').map((c) => [c, stairShape(view, c.pos)] as const);
  for (const [c, shape] of updates) replace(view, c.pos, c.state, { shape });
}

// ------------------------------------------------------------------ Zaun / Scheibe / Mauer

function sturdyToward(n: CellInfo, dir: HorizontalDir): boolean {
  return !isConnectionException(n.state.name) && faceSupport(n, OPP(dir)) === 'full';
}

function gateConnects(n: CellInfo, dir: HorizontalDir): boolean {
  return n.kind === 'fence_gate' && axisOf(n.state.properties['facing'] as HorizontalDir) === axisOf(CW(dir));
}

function fenceConnects(self: BlockState, n: CellInfo, dir: HorizontalDir): boolean {
  if (n.kind === 'fence') return fenceFamily(n.state.name) === fenceFamily(self.name);
  if (gateConnects(n, dir)) return true;
  return sturdyToward(n, dir);
}

function paneConnects(n: CellInfo, dir: HorizontalDir): boolean {
  if (n.kind === 'pane' || n.kind === 'wall') return true;
  return sturdyToward(n, dir);
}

function wallConnects(n: CellInfo, dir: HorizontalDir): boolean {
  if (n.kind === 'wall' || n.kind === 'pane') return true;
  if (gateConnects(n, dir)) return true;
  return sturdyToward(n, dir);
}

/**
 * Was deckt die Unterseite (Kollisionsform bei y = 0, `getFaceShape(DOWN)`) des Blocks darüber ab? WallBlock prüft
 * damit Pfosten (7..9) und Seiten (7..9 bis zum Rand). Vanilla-Formen 1.21.11 (M2): Pfosten, Arme und Mittelstücke
 * reichen bis y = 0; stehende Laterne, Kerzen, Blumentopf, Kopf, Truhe, Trichter (Auslauf unten) decken die Mitte.
 */
export function coverOfAbove(a: CellInfo): { post: boolean; sides: ReadonlySet<HorizontalDir> } {
  const all = { post: true, sides: new Set<HorizontalDir>(H4) };
  const none = { post: false, sides: new Set<HorizontalDir>() };
  const post = { post: true, sides: new Set<HorizontalDir>() };
  const p = a.state.properties;
  const n = a.state.name;
  switch (a.kind) {
    case 'slab':
      return p['type'] === 'top' ? none : all;
    case 'stairs':
      return p['half'] === 'bottom' ? all : none;
    case 'wall':
      return { post: p['up'] === 'true', sides: new Set(H4.filter((d) => (p[d] ?? 'none') !== 'none')) };
    case 'pane':
    case 'fence':
      return { post: true, sides: new Set(H4.filter((d) => p[d] === 'true')) };
    case 'fence_gate': {
      if (p['open'] === 'true') return none;
      const along = axisOf(p['facing'] as HorizontalDir) === 'z' ? (['east', 'west'] as const) : (['north', 'south'] as const);
      return { post: true, sides: new Set<HorizontalDir>(along) };
    }
    case 'trapdoor':
      return p['open'] !== 'true' && p['half'] === 'bottom' ? all : none;
    case 'lantern':
      return p['hanging'] === 'true' ? none : post;
    case 'candle':
      return post;
    case 'chest': { // Doppeltruhe: Form reicht bis zum Rand beim Partner
      const d = chestPartnerDir(a.state);
      return { post: true, sides: new Set<HorizontalDir>(d !== undefined ? [d] : []) };
    }
    case 'axis':
      return a.phys.cls === 'full' ? all : p['axis'] === 'y' ? post : none; // Kette senkrecht: 6.5..9.5
    case 'hopper':
      return p['facing'] === 'down' ? post : none;
    case 'rotation16': // stehender Kopf 4..12 (Schild/Banner: keine Kollision, zählen über #wall_post_override)
      return n.endsWith('_head') || n.endsWith('_skull') ? post : none;
    default:
      break;
  }
  if (a.phys.cls === 'air' || a.phys.cls === 'thin') return none;
  if (n === 'snow') return Number(p['layers'] ?? '1') >= 2 ? all : none;
  if (['campfire', 'soul_campfire', 'lectern', 'composter', 'enchanting_table', 'daylight_detector', 'stonecutter'].includes(n)) return all;
  if (n === 'flower_pot' || n.startsWith('potted_') || n === 'decorated_pot' || n.endsWith('anvil') || n === 'brewing_stand'
    || n === 'cake' || n.endsWith('candle_cake') || n === 'sea_pickle' || n === 'ender_chest') return post;
  const face = faceSupport(a, 'down');
  return face === 'full' ? all : face === 'center' ? post : none;
}

/** WallBlock#shouldRaisePost */
function shouldRaisePost(view: WorldView, s: Readonly<Record<HorizontalDir, string>>, above: CellInfo, abovePostCovered: boolean): boolean {
  if (above.kind === 'wall' && above.state.properties['up'] === 'true') return true;
  const none = (d: HorizontalDir): boolean => s[d] === 'none';
  if ((none('north') && none('south') && none('east') && none('west')) || none('north') !== none('south') || none('east') !== none('west')) return true;
  if ((s.north === 'tall' && s.south === 'tall') || (s.east === 'tall' && s.west === 'tall')) return false;
  return view.hasTag(above.state, 'wall_post_override') || abovePostCovered;
}

/** Löst alle Zäune/Scheiben/Mauern/Zauntore (Mauern von oben nach unten, weil sie den Block darüber lesen). */
export function resolveConnections(view: WorldView): void {
  const cells = [...view.volume.cells()]
    .filter((c) => ['fence', 'pane', 'wall', 'fence_gate'].includes(view.kinds.of(c.state.name)))
    .sort((a, b) => b.pos[1] - a.pos[1]);
  for (const c of cells) {
    const s = view.state(c.pos); // aktueller Zustand (darüberliegende Mauern sind schon aufgelöst)
    const kind = view.kinds.of(s.name);
    const nb = (d: HorizontalDir): CellInfo => view.info(step(c.pos, d));
    if (kind === 'fence') {
      replace(view, c.pos, s, Object.fromEntries(H4.map((d) => [d, String(fenceConnects(s, nb(d), d))])));
    } else if (kind === 'pane') {
      replace(view, c.pos, s, Object.fromEntries(H4.map((d) => [d, String(paneConnects(nb(d), d))])));
    } else if (kind === 'wall') {
      const above = view.info(step(c.pos, 'up'));
      const cover = coverOfAbove(above);
      const sides = Object.fromEntries(
        H4.map((d) => [d, wallConnects(nb(d), d) ? (cover.sides.has(d) ? 'tall' : 'low') : 'none']),
      ) as Record<HorizontalDir, string>;
      replace(view, c.pos, s, { ...sides, up: String(shouldRaisePost(view, sides, above, cover.post)) });
    } else {
      const f = s.properties['facing'] as HorizontalDir;
      const inWall = nb(CW(f)).kind === 'wall' || nb(CCW(f)).kind === 'wall';
      replace(view, c.pos, s, { in_wall: String(inWall) });
    }
  }
}

// ------------------------------------------------------------------ Truhen

/** ChestBlock#getConnectedDirection */
export function chestPartnerDir(s: BlockState): HorizontalDir | undefined {
  const t = s.properties['type'];
  const f = s.properties['facing'] as HorizontalDir;
  return t === 'left' ? CW(f) : t === 'right' ? CCW(f) : undefined;
}

/**
 * Koppelt benachbarte EINZEL-Truhen gleicher Art und Ausrichtung (wie beim Platzieren im Spiel):
 * Reihenfolge y → z → x, jede Truhe höchstens einmal; eine Dreierreihe ergibt Paar + Einzeltruhe.
 */
export function pairChests(view: WorldView): void {
  const chests = cellsOfKind(view, 'chest');
  const paired = new Set<string>();
  const key = (p: Vec3): string => p.join(',');
  for (const c of chests) {
    if (paired.has(key(c.pos))) continue;
    const s = view.state(c.pos);
    if (s.properties['type'] !== 'single') continue;
    const f = s.properties['facing'] as HorizontalDir;
    for (const side of [CW(f), CCW(f)]) {
      const q = step(c.pos, side);
      if (paired.has(key(q))) continue;
      const n = view.state(q);
      if (n.name !== s.name || n.properties['facing'] !== f || n.properties['type'] !== 'single') continue;
      replace(view, c.pos, s, { type: side === CW(f) ? 'left' : 'right' });
      replace(view, q, n, { type: side === CW(f) ? 'right' : 'left' });
      paired.add(key(c.pos)).add(key(q));
      break;
    }
  }
}

// ------------------------------------------------------------------ Partner-Prüfung

/** Bett-, Tür- und Truhen-Hälften prüfen. Ungültige Truhenpaare werden auf `single` gesetzt (wie im Spiel). */
export function checkPairs(view: WorldView): Violation[] {
  const out: Violation[] = [];
  for (const c of [...view.volume.cells()]) {
    const s = view.state(c.pos);
    const kind = view.kinds.of(s.name);
    const p = s.properties;
    if (kind === 'bed') {
      const f = p['facing'] as HorizontalDir;
      const head = p['part'] === 'head';
      const q = step(c.pos, head ? OPP(f) : f);
      const n = view.state(q);
      // BedBlock#updateShape: Partner derselben Art mit anderem Teil, `occupied` wird übernommen
      if (n.name !== s.name || n.properties['facing'] !== f || n.properties['part'] !== (head ? 'foot' : 'head') || n.properties['occupied'] !== p['occupied']) {
        out.push({
          kind: 'bed_half', severity: 'error', pos: c.pos, owner: c.owner, block: s.name,
          message: `Bett ${s.name} (${p['part']}, facing=${f}) bei ${c.pos.join(',')}: ${head ? 'Fußteil' : 'Kopfteil'} fehlt bei ${q.join(',')}`,
        });
      }
    } else if (kind === 'door') {
      const lower = p['half'] === 'lower';
      const q = step(c.pos, lower ? 'up' : 'down');
      const n = view.state(q);
      // DoorBlock#updateShape: jede Hälfte übernimmt ALLE Properties der anderen (auch open/powered)
      if (n.name !== s.name || n.properties['half'] !== (lower ? 'upper' : 'lower')
        || (['facing', 'hinge', 'open', 'powered'] as const).some((k) => n.properties[k] !== p[k])) {
        out.push({
          kind: 'door_half', severity: 'error', pos: c.pos, owner: c.owner, block: s.name,
          message: `Tür ${s.name} (${p['half']}) bei ${c.pos.join(',')}: passende ${lower ? 'obere' : 'untere'} Hälfte fehlt bei ${q.join(',')}`,
        });
      }
    } else if (kind === 'chest') {
      const d = chestPartnerDir(s);
      if (d === undefined) continue;
      const q = step(c.pos, d);
      const n = view.state(q);
      const partnerDir = n.name === s.name ? chestPartnerDir(n) : undefined;
      if (n.properties['facing'] !== p['facing'] || partnerDir === undefined || partnerDir !== opposite(d as Dir)) {
        view.volume.replaceState(c.pos, blockState(s.name, { ...p, type: 'single' }));
        out.push({
          kind: 'chest_pair', severity: 'warning', pos: c.pos, owner: c.owner, block: s.name,
          message: `Truhe type=${p['type']} bei ${c.pos.join(',')} ohne passenden Partner bei ${q.join(',')} – auf single gesetzt`,
        });
      }
    }
  }
  return out;
}
