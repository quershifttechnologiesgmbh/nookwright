import type { ShellOrient } from '@mcda/blueprint';
import type { Orient } from '@mcda/catalog';
import { pose, type Mirror, type Quarter } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import {
  KindIndex, OrientError, finalizeState, orientProps, rotationOf, shellOrientProps, transformRawState, worldOrient,
} from '../src/index.js';
import { platformView } from './fixtures.js';

const reg = platformView('26.3').registry;
const kinds = new KindIndex(reg);

/** Katalog-Weg: Orient (relativ) + Pose + roher State → vollständiger State. */
function oriented(block: string, orient: Orient, rot: Quarter = 0, mirror: Mirror = 'none', state: Record<string, string> = {}): Record<string, string> {
  const kind = kinds.of(block);
  const p = pose([0, 0, 0], rot, mirror);
  const props = { ...orientProps(kind, block, worldOrient(orient, p)), ...transformRawState(kind, state, p) };
  return { ...finalizeState(reg, block, kind, props, 'test').properties };
}

function shell(block: string, o: ShellOrient): Record<string, string> {
  const kind = kinds.of(block);
  return { ...finalizeState(reg, block, kind, shellOrientProps(kind, block, o), 'test').properties };
}

describe('Orientierungs-Adapter: Katalog (relativ + Pose)', () => {
  it('Treppe: back → facing (hohe Seite), upsideDown → half; front ist das Gegenstück', () => {
    expect(oriented('oak_stairs', { back: 'back' })).toMatchObject({ facing: 'north', half: 'bottom' });
    expect(oriented('oak_stairs', { back: 'back' }, 1)).toMatchObject({ facing: 'east' });
    expect(oriented('oak_stairs', { upsideDown: true, back: 'front' }, 2)).toMatchObject({ facing: 'north', half: 'top' });
    expect(oriented('oak_stairs', { front: 'front' })).toMatchObject({ facing: 'north' });
    expect(() => oriented('oak_stairs', { back: 'back', front: 'back' })).toThrow(/widersprechen sich/);
    expect(() => oriented('oak_stairs', { back: 'up' })).toThrow(/horizontale Richtung/);
    expect(() => oriented('oak_stairs', {})).toThrow(/braucht eine Ausrichtung/);
  });

  it('Stufe: upsideDown → type top/bottom; Zaun/Scheibe/Mauer nehmen keine Ausrichtung (Autotiling)', () => {
    expect(oriented('oak_slab', { upsideDown: true })).toMatchObject({ type: 'top' });
    expect(oriented('oak_slab', { upsideDown: false })).toMatchObject({ type: 'bottom' });
    expect(oriented('oak_fence', {})).toMatchObject({ north: 'false', east: 'false' });
    expect(() => oriented('oak_fence', { back: 'back' })).toThrow(OrientError);
    expect(() => oriented('glass_pane', { axis: 'x' })).toThrow(/orient.axis passt nicht/);
    expect(() => oriented('cobblestone_wall', { upsideDown: true })).toThrow(OrientError);
  });

  it('Falltür: attachTo (Scharnierseite) → facing weg davon; open, upsideDown', () => {
    expect(oriented('spruce_trapdoor', { attachTo: 'back', open: true })).toMatchObject({ facing: 'south', open: 'true', half: 'bottom' });
    expect(oriented('spruce_trapdoor', { front: 'front', upsideDown: true }, 1)).toMatchObject({ facing: 'west', half: 'top' });
  });

  it('Wandschild / Wandfackel: attachTo → facing weg von der Wand', () => {
    // Armlehne rechts: rechts = Westen (kanonisch) → das Schild zeigt nach Osten
    expect(oriented('spruce_wall_sign', { attachTo: 'right' })).toMatchObject({ facing: 'east' });
    expect(oriented('wall_torch', { attachTo: 'back' }, 3)).toMatchObject({ facing: 'east' });
    expect(oriented('soul_wall_torch', { attachTo: 'back' }, 1)).toMatchObject({ facing: 'west' });
    expect(() => oriented('wall_torch', { attachTo: 'up' })).toThrow(/horizontale Richtung/);
    expect(() => worldOrient({ attachTo: 'parent' }, pose([0, 0, 0]))).toThrow(/parent/);
  });

  it('Bett: part + back → part/facing (Fuß → Kopf)', () => {
    expect(oriented('red_bed', { part: 'head', back: 'back' })).toEqual({ facing: 'north', part: 'head', occupied: 'false' });
    expect(oriented('red_bed', { part: 'foot', back: 'back' }, 1)).toMatchObject({ facing: 'east', part: 'foot' });
    expect(() => oriented('red_bed', { back: 'back' })).toThrow(/braucht 'part'/);
  });

  it('Tür: front → facing, half, open; hinge aus state (spiegelt mit)', () => {
    expect(oriented('oak_door', { front: 'front', half: 'lower' })).toMatchObject({ facing: 'south', half: 'lower', hinge: 'left', open: 'false' });
    expect(oriented('oak_door', { front: 'front', half: 'upper', open: true }, 0, 'x', { hinge: 'left' })).toMatchObject({ half: 'upper', open: 'true', hinge: 'right' });
    expect(() => oriented('oak_door', { front: 'front' })).toThrow(/braucht 'half'/);
  });

  it('Truhe, Ofen, Räucherofen, Hochofen: front → facing', () => {
    for (const b of ['chest', 'furnace', 'smoker', 'blast_furnace']) {
      expect(oriented(b, { front: 'front' }), b).toMatchObject({ facing: 'south' });
      expect(oriented(b, { front: 'front' }, 1), b).toMatchObject({ facing: 'west' });
    }
    expect(oriented('chest', { front: 'front' })).toMatchObject({ type: 'single' });
    expect(() => oriented('chest', {})).toThrow(/braucht eine Ausrichtung/);
    expect(() => oriented('furnace', { front: 'up' })).toThrow(/horizontale Richtung/);
  });

  it('Fass: front → facing inkl. up/down', () => {
    expect(oriented('barrel', { front: 'up' }, 3)).toMatchObject({ facing: 'up', open: 'false' });
    expect(oriented('barrel', { front: 'front' }, 2)).toMatchObject({ facing: 'north' });
  });

  it('Amboss: facing = Längsachse (Vanilla: CW der Blickrichtung) – senkrecht zur Arbeitsseite', () => {
    // Arbeitsseite Süd (Spieler steht südlich, blickt nach Norden) → facing = CW(north) = east
    expect(oriented('anvil', { front: 'front' })).toEqual({ facing: 'east' });
    expect(oriented('anvil', { front: 'front' }, 1)).toEqual({ facing: 'south' });
    expect(oriented('damaged_anvil', { back: 'back' })).toEqual({ facing: 'east' });
  });

  it('Schleifstein: Boden, facing = Blickrichtung zur Front; attachTo seitlich → Wand', () => {
    expect(oriented('grindstone', { front: 'front' })).toEqual({ face: 'floor', facing: 'north' });
    expect(oriented('grindstone', { front: 'front' }, 1)).toEqual({ face: 'floor', facing: 'east' });
    expect(oriented('grindstone', { attachTo: 'back' })).toEqual({ face: 'wall', facing: 'south' });
    expect(oriented('stone_button', { attachTo: 'up', front: 'front' })).toMatchObject({ face: 'ceiling', facing: 'north' });
  });

  it('Laterne (hanging), Kette (axis inkl. along/across), Kerze (state durchreichen)', () => {
    expect(oriented('lantern', { hanging: true })).toEqual({ hanging: 'true', waterlogged: 'false' });
    expect(oriented('copper_lantern', {})).toMatchObject({ hanging: 'false' });
    expect(oriented('iron_chain', { axis: 'y' }, 1)).toMatchObject({ axis: 'y' });
    expect(oriented('iron_chain', { axis: 'x' }, 1)).toMatchObject({ axis: 'z' });
    expect(oriented('iron_chain', { axis: 'along' })).toMatchObject({ axis: 'x' });
    expect(oriented('spruce_log', { axis: 'across' }, 3)).toMatchObject({ axis: 'x' });
    expect(oriented('candle', {}, 0, 'none', { candles: '3', lit: 'true' })).toEqual({ candles: '3', lit: 'true', waterlogged: 'false' });
    expect(() => oriented('candle', { hanging: true })).toThrow(/orient.hanging passt nicht/);
    expect(() => oriented('lantern', { back: 'back' })).toThrow(OrientError);
  });

  it('stehendes Schild: front → rotation (0 = Süden, +4 je Vierteldrehung, immer explizit)', () => {
    expect(oriented('oak_sign', { front: 'front' })).toMatchObject({ rotation: '0' });
    expect(oriented('oak_sign', { front: 'front' }, 1)).toMatchObject({ rotation: '4' });
    expect(rotationOf('east')).toBe(12);
  });

  it('rohe States drehen und spiegeln mit (plan/01 §5)', () => {
    const p1 = pose([0, 0, 0], 1);
    expect(transformRawState('horizontal', { facing: 'north' }, p1)).toEqual({ facing: 'east' });
    expect(transformRawState('axis', { axis: 'x' }, p1)).toEqual({ axis: 'z' });
    expect(transformRawState('rotation16', { rotation: '4' }, pose([0, 0, 0], 0, 'x'))).toEqual({ rotation: '12' });
    expect(transformRawState('rotation16', { rotation: '0' }, pose([0, 0, 0], 0, 'z'))).toEqual({ rotation: '8' });
    expect(transformRawState('chest', { type: 'left', facing: 'north' }, pose([0, 0, 0], 0, 'x'))).toEqual({ type: 'right', facing: 'north' });
    expect(transformRawState('stairs', { shape: 'inner_left' }, pose([0, 0, 0], 0, 'z'))).toEqual({ shape: 'inner_right' });
    expect(transformRawState('candle', { candles: '2' }, p1)).toEqual({ candles: '2' });
  });
});

describe('Orientierungs-Adapter: Hülle (absolut, Minecraft-Bedeutung)', () => {
  it('Treppe, Stufe, Tür, Stamm, Falltür', () => {
    expect(shell('dark_oak_stairs', { facing: 'west', half: 'top' })).toMatchObject({ facing: 'west', half: 'top', shape: 'straight' });
    expect(shell('spruce_slab', { half: 'top' })).toMatchObject({ type: 'top' });
    expect(shell('spruce_door', { facing: 'south', half: 'upper', hinge: 'right' })).toMatchObject({ facing: 'south', half: 'upper', hinge: 'right' });
    expect(shell('spruce_log', { axis: 'z' })).toMatchObject({ axis: 'z' });
    expect(shell('spruce_trapdoor', { facing: 'east', half: 'bottom' })).toMatchObject({ facing: 'east', half: 'bottom' });
  });

  it('unpassende Angaben sind Fehler', () => {
    expect(() => shell('spruce_slab', { half: 'upper' })).toThrow(/erwartet bottom\|top/);
    expect(() => shell('spruce_door', { facing: 'south', half: 'top' })).toThrow(/erwartet lower\|upper/);
    expect(() => shell('stone_bricks', { facing: 'north' })).toThrow(/orient.facing passt nicht/);
    expect(() => shell('spruce_stairs', { facing: 'north', hinge: 'left' })).toThrow(/orient.hinge passt nicht/);
    expect(() => shell('glass_pane', { axis: 'x' })).toThrow(OrientError);
  });
});
