/**
 * W3-EN (plan/spikes/W3EN_eingang.md): Eingangsmodule in der kompletten Base – je Modul eine Base mit Gelände und
 * Außenprofil: an der Haustür Stücke des Moduls (Portal oder Vordach, Laternenpaar, Stufe 3 breit), keine Zelle der
 * Umgebung an ihren Positionen, 0 harte Verstöße (Laternen hängen bzw. stehen, Physik), deterministisch.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FacadeStyle } from '@mcda/blueprint';
import { key3 } from '@mcda/core';
import { ENTRANCE_MODULES } from '@mcda/exterior';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { completeBase, generateBase } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const RULES = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true, foundationBase: true } as const;
const FACADE: FacadeStyle = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4, rules: RULES };

describe('W3-EN: Eingangsmodule in der Beispiel-Base (Gelände gekoppelt)', () => {
  for (const module of ENTRANCE_MODULES) {
    it(`${module}: Modul an der Haustür, 0 harte Verstöße, deterministisch`, { timeout: HEAVY_TIMEOUT }, () => {
      const base = completeBase('1.21.11', 'medieval');
      const opts = { ...base.options, facade: FACADE, exterior: { density: 1, entranceModule: module } };
      const world = generateBase(base.project, ctx, opts);
      const ext = world.exterior ?? [];
      const mine = ext.filter((p) => p.componentId === `exterior/entrance_module_${module}`);
      const variants = new Set(mine.map((p) => p.variantId ?? ''));
      expect([...variants].some((v) => v.startsWith('frame') || v.startsWith('canopy')), `${module}: ${[...variants].join(' ')}`).toBe(true);
      expect([...variants].some((v) => v.startsWith('lanterns')), `${module}: Laternenpaar`).toBe(true);
      expect(mine.filter((p) => p.variantId === 'step').length, `${module}: Stufe`).toBeGreaterThanOrEqual(3);
      expect(world.materialized.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
      const pos = new Set(ext.flatMap((p) => p.cells.map(key3)));
      expect(world.surroundings.cells.filter((c) => pos.has(key3(c.pos))).map((c) => `${c.kind}@${c.pos}`)).toEqual([]);
      expect(generateBase(base.project, ctx, opts).exterior).toEqual(ext);
    });
  }
});
