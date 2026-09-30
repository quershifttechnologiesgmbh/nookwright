/**
 * Lesesicht auf das Voxel-Volumen für Autotiling, Physik und Licht: Blockart, Physik je Zustand
 * und ein Flächenmodell (welche Seite eines Blocks voll bzw. in der Mitte tragfähig ist).
 *
 * Das Flächenmodell ist eine Näherung von `getBlockSupportShape().getFaceShape(dir)` aus dem
 * Vanilla-Code auf Basis der Plattform-Physik (Klasse, Oberseite voll) plus Regeln je Blockart.
 * Adapter in diesem Paket, weil `platform` bisher keine Flächenformen liefert (siehe Bericht).
 */
import { opposite, rotateDir, type Dir, type HorizontalDir, type Vec3 } from '@mcda/core';
import { hasFlag, physicsOfState, type BlockPhysics, type PhysicsFlag, type StatePhysics } from '@mcda/platform';
import { AIR, stateKey, type BlockState, type VoxelVolume } from '@mcda/voxel';
import { KindIndex, type BlockKind } from './kinds.js';
import type { PlatformView } from './types.js';

export type FaceSupport = 'full' | 'center' | 'none';

export interface CellPhysics extends StatePhysics {
  readonly flags: readonly PhysicsFlag[];
  readonly spawnBlocked: boolean;
  readonly spawnFloor: boolean;
  /** false: Block fehlt in den Physik-Daten (Näherung „halb, nicht begehbar“). */
  readonly known: boolean;
}

export interface CellInfo {
  readonly state: BlockState;
  readonly kind: BlockKind;
  readonly phys: CellPhysics;
}

const UNKNOWN_PHYSICS: CellPhysics = {
  cls: 'half', h: 1, topFull: false, flags: [], spawnBlocked: true, spawnFloor: false, known: false,
};

export const DIR6: readonly Dir[] = ['north', 'east', 'south', 'west', 'up', 'down'];

export const DIR_OFFSET: Readonly<Record<Dir, Vec3>> = {
  north: [0, 0, -1], east: [1, 0, 0], south: [0, 0, 1], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};

export const step = (p: Vec3, d: Dir, n = 1): Vec3 => {
  const o = DIR_OFFSET[d];
  return [p[0] + o[0] * n, p[1] + o[1] * n, p[2] + o[2] * n];
};

/** Hat die (horizontale) Seite `face` einer Treppe eine volle Fläche? (Spike T4: straight/inner = Rückseite(n)) */
function stairsSideFull(props: Readonly<Record<string, string>>, face: Dir): boolean {
  const facing = props['facing'] as HorizontalDir | undefined;
  const shape = props['shape'] ?? 'straight';
  if (facing === undefined || shape.startsWith('outer')) return false;
  if (face === facing) return true;
  if (shape === 'inner_left') return face === rotateDir(facing, -1);
  if (shape === 'inner_right') return face === rotateDir(facing, 1);
  return false;
}

/** Tragfähigkeit der Fläche `face` eines Blocks (Näherung, siehe Modulkommentar). */
export function faceSupport(info: CellInfo, face: Dir): FaceSupport {
  const { state, kind, phys } = info;
  const props = state.properties;
  if (phys.cls === 'air' || phys.cls === 'thin') return 'none';
  if (state.name.endsWith('_leaves')) return 'none'; // Blätter haben keine Stützform (Faktencheck 3)
  const vertical = face === 'up' || face === 'down';
  switch (kind) {
    case 'stairs': {
      const top = props['half'] === 'top';
      if (face === 'up') return top ? 'full' : 'none';
      if (face === 'down') return top ? 'none' : 'full';
      return stairsSideFull(props, face) ? 'full' : 'none';
    }
    case 'slab': {
      const t = props['type'];
      if (t === 'double') return 'full';
      if (face === 'up') return t === 'top' ? 'full' : 'none';
      if (face === 'down') return t === 'bottom' ? 'full' : 'none';
      return 'none';
    }
    case 'trapdoor': {
      const facing = props['facing'] as Dir | undefined;
      if (props['open'] === 'true') return facing !== undefined && face === opposite(facing) ? 'full' : 'none';
      if (face === 'up') return props['half'] === 'top' ? 'full' : 'none';
      if (face === 'down') return props['half'] === 'bottom' ? 'full' : 'none';
      return 'none';
    }
    case 'door': {
      const facing = props['facing'] as Dir | undefined;
      return props['open'] !== 'true' && facing !== undefined && face === opposite(facing) ? 'full' : 'none';
    }
    case 'fence':
    case 'wall':
    case 'pane':
      return vertical ? 'center' : 'none';
    case 'axis':
      if (phys.cls === 'full') return 'full';
      return vertical && props['axis'] === 'y' ? 'center' : 'none'; // Kette: nur senkrecht (Faktencheck 3)
    case 'lantern':
    case 'candle':
      return 'none';
    default:
      break;
  }
  if (phys.cls === 'full') return 'full';
  if (phys.cls === 'flat') return face === 'down' ? 'full' : 'none';
  if (face === 'up' && phys.topFull) return 'full';
  return 'none';
}

/** Blöcke der Klasse „voll“, durch die Licht trotzdem geht (Glas, Blätter, Gitterblöcke …). */
export function isTransparentFull(name: string): boolean {
  if (name === 'tinted_glass') return false;
  return name === 'glass' || name.endsWith('_stained_glass') || name.endsWith('_leaves') || name.endsWith('_grate')
    || name === 'ice' || name === 'frosted_ice' || name === 'barrier' || name === 'beacon' || name === 'spawner'
    || name === 'slime_block' || name === 'honey_block';
}

/** Vanilla-Ausnahmen, die trotz voller Fläche keine Zaun-/Scheiben-/Mauer-Verbindung eingehen. */
export function isConnectionException(name: string): boolean {
  return name.endsWith('_leaves') || name === 'barrier' || name === 'pumpkin' || name === 'carved_pumpkin'
    || name === 'jack_o_lantern' || name === 'melon' || name.endsWith('shulker_box');
}

export class WorldView {
  readonly kinds: KindIndex;
  private readonly physCache = new Map<string, CellPhysics>();

  constructor(
    readonly volume: VoxelVolume,
    readonly platform: PlatformView,
    kinds?: KindIndex,
  ) {
    this.kinds = kinds ?? new KindIndex(platform.registry);
  }

  inside(p: Vec3): boolean {
    return this.volume.contains(p);
  }

  /** Blockzustand; außerhalb des Volumens Luft. */
  state(p: Vec3): BlockState {
    return this.inside(p) ? this.volume.stateAt(p) : AIR;
  }

  physicsOf(s: BlockState): CellPhysics {
    const key = stateKey(s);
    let hit = this.physCache.get(key);
    if (hit === undefined) {
      const bp: BlockPhysics | undefined = Object.hasOwn(this.platform.physics.blocks, s.name) ? this.platform.physics.blocks[s.name] : undefined;
      hit = bp === undefined
        ? UNKNOWN_PHYSICS
        : { ...physicsOfState(bp, s.properties), flags: bp.flags, spawnBlocked: bp.spawnBlocked, spawnFloor: bp.spawnFloor, known: true };
      this.physCache.set(key, hit);
    }
    return hit;
  }

  infoOf(s: BlockState): CellInfo {
    return { state: s, kind: this.kinds.of(s.name), phys: this.physicsOf(s) };
  }

  info(p: Vec3): CellInfo {
    return this.infoOf(this.state(p));
  }

  face(p: Vec3, dir: Dir): FaceSupport {
    return faceSupport(this.info(p), dir);
  }

  hasFlag(s: BlockState, flag: PhysicsFlag): boolean {
    const bp = Object.hasOwn(this.platform.physics.blocks, s.name) ? this.platform.physics.blocks[s.name] : undefined;
    return bp !== undefined && hasFlag(bp, flag);
  }

  hasTag(s: BlockState, tag: string): boolean {
    return this.platform.registry.hasBlockTag(s.name, tag);
  }
}
