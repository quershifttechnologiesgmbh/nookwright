/**
 * W7-D (plan/spikes/W7D_fantasy.md): Fantasy-Module in der kompletten Base (Gelände gekoppelt) – in elven und dwarven
 * ohne Angabe (Standard nach Theme), in medieval als zugeschaltete Stufe: Module des Kits gesetzt, keine Zelle der Umgebung
 * an ihren Positionen, 0 harte Verstöße (Laternen hängen, Banner und Lagerfeuer haben ihren Träger), keine dunklen Zellen,
 * deterministisch.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FacadeStyle } from '@mcda/blueprint';
import { key3 } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { completeBase, generateBase } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const RULES = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true, foundationBase: true } as const;
const FACADE: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4, rules: RULES };

const CASES = [
  { theme: 'elven', exterior: {}, min: 4 },
  { theme: 'dwarven', exterior: {}, min: 4 },
  { theme: 'medieval', exterior: { fantasy: 'full', fantasyKit: 'elven' }, min: 4 },
  { theme: 'medieval', exterior: { fantasy: 'accent' }, min: 1 },
] as const;

describe('W7-D: Fantasy-Module in der Beispiel-Base', () => {
  for (const c of CASES) {
    it(`${c.theme} ${JSON.stringify(c.exterior)}: Module gesetzt, 0 harte Verstöße, deterministisch`, { timeout: HEAVY_TIMEOUT }, () => {
      const base = completeBase('1.21.11', c.theme);
      const opts = { ...base.options, facade: FACADE, exterior: { density: 1, ...c.exterior } };
      const world = generateBase(base.project, ctx, opts);
      const ext = world.exterior ?? [];
      const modules = new Set(ext.filter((p) => p.componentId.startsWith('exterior/fantasy_')).map((p) => p.componentId));
      expect(modules.size, [...modules].join(' ')).toBeGreaterThanOrEqual(c.min);
      expect(world.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
      const pos = new Set(ext.flatMap((p) => p.cells.map(key3)));
      expect(world.surroundings.cells.filter((x) => pos.has(key3(x.pos))).map((x) => `${x.kind}@${x.pos}`)).toEqual([]);
      expect(world.materialized.light?.darkCells ?? []).toEqual([]);
      expect(generateBase(base.project, ctx, opts).exterior).toEqual(ext);
    });
  }
});
