import type { ShellCell, ShellOrient } from '@mcda/blueprint';
import { describe, expect, it } from 'vitest';
import { FULL, shellBox } from '../src/viewer/voxels.js';

/** O1: Kleinteile der Bauwerke als Hüllzellen – hängende Laterne, Kette, Stab, Glocke – nicht als volle Würfel. */
const cell = (shape: string, orient?: ShellOrient): ShellCell =>
  ({ pos: [0, 0, 0], kind: 'fort', role: 'x', shape, ...(orient !== undefined ? { orient } : {}) });
const height = (b: ReturnType<typeof shellBox>): number => b.max[1] - b.min[1];
const width = (b: ReturnType<typeof shellBox>, k: 0 | 2): number => b.max[k] - b.min[k];

describe('3D-Vorschau: Hüllzellen senkrecht/hängend (O1)', () => {
  it('Laterne: hängend höher im Block als stehend, beide klein', () => {
    const hanging = shellBox(cell('lantern', { hanging: true }));
    const standing = shellBox(cell('lantern'));
    expect(hanging.min[1]).toBeGreaterThan(standing.min[1]);
    expect(hanging.max[1]).toBeGreaterThan(standing.max[1]);
    for (const b of [hanging, standing]) expect(width(b, 0)).toBeLessThan(0.5);
  });

  it('Kette und Stab senkrecht: dünn, volle Höhe; waagerecht entlang der Achse bzw. facing', () => {
    for (const b of [shellBox(cell('chain', { axis: 'y' })), shellBox(cell('lightning_rod', { vertical: 'up' })), shellBox(cell('end_rod', { vertical: 'down' }))]) {
      expect(height(b)).toBe(1);
      expect(width(b, 0)).toBeLessThan(0.25);
    }
    expect(width(shellBox(cell('chain', { axis: 'x' })), 0)).toBe(1);
    expect(width(shellBox(cell('end_rod', { facing: 'north' })), 2)).toBe(1);
  });

  it('Glocke: an der Decke oben im Block, am Boden unten; andere Formen bleiben volle Würfel', () => {
    expect(shellBox(cell('bell', { facing: 'north', attach: 'ceiling' })).max[1]).toBe(1);
    expect(shellBox(cell('bell', { facing: 'north' })).min[1]).toBe(0);
    expect(shellBox(cell('block'))).toEqual(FULL);
    expect(shellBox(cell('log', { axis: 'y' }))).toEqual(FULL);
  });
});
