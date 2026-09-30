/**
 * FN (Produktionslinien): Der Crafter (1.21) hat `orientation` (`<front>_<top>`) statt `facing`. Er ist eine eigene
 * Blockart, damit er mit Pose (Drehung/Spiegelung) mitläuft – Front = Ausgabeseite.
 */
import { pose, type Mirror, type Quarter } from '@mcda/core';
import type { Orient } from '@mcda/catalog';
import { describe, expect, it } from 'vitest';
import { KindIndex, finalizeState, orientProps, worldOrient } from '../src/index.js';
import { OrientError } from '../src/orient.js';
import { VERSIONS, platformView } from './fixtures.js';

describe.each(VERSIONS)('Crafter-Ausrichtung (%s)', (version) => {
  const reg = platformView(version).registry;
  const kinds = new KindIndex(reg);
  const oriented = (o: Orient, rot: Quarter = 0, mirror: Mirror = 'none') => {
    const kind = kinds.of('crafter');
    const p = pose([0, 0, 0], rot, mirror);
    return { ...finalizeState(reg, 'crafter', kind, orientProps(kind, 'crafter', worldOrient(o, p)), 'test').properties };
  };

  it('ist eine eigene Blockart', () => {
    expect(kinds.of('crafter')).toBe('crafter');
  });

  it('waagerechte Front: <dir>_up, dreht und spiegelt mit der Pose', () => {
    expect(oriented({ front: 'front' })).toMatchObject({ orientation: 'south_up', crafting: 'false', triggered: 'false' });
    expect(oriented({ front: 'left' })).toMatchObject({ orientation: 'east_up' });
    expect(oriented({ front: 'left' }, 1).orientation).not.toBe('east_up');
    expect(oriented({ front: 'left' }, 0, 'x').orientation).toBe('west_up');
    expect(oriented({ front: 'front' }, 2).orientation).toBe('north_up');
  });

  it('senkrechte Front (nach unten): braucht eine waagerechte Oberseite (back)', () => {
    expect(oriented({ front: 'down', back: 'back' })).toMatchObject({ orientation: 'down_north' });
    expect(oriented({ front: 'down', back: 'back' }, 2).orientation).toBe('down_south');
    expect(() => oriented({ front: 'down' })).toThrow(OrientError);
  });

  it('ohne Front bleibt der Vanilla-Standard (Deko-Crafter im Bestand, bitgleich), auch gedreht', () => {
    expect(oriented({})).toMatchObject({ orientation: 'north_up' });
    expect(oriented({}, 2)).toMatchObject({ orientation: 'north_up' });
    expect(() => oriented({ back: 'back' })).toThrow(OrientError);
  });
});
