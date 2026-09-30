/**
 * W9-G5 „Materialspiel“ (plan/spikes/W9G5_materialspiel.md): `roof_t` je zusammenhängender Dachfläche und
 * `gradient.patch` (Flecken des Nachbartons im Ring, D1 < 10 % je Reihe).
 */
import type { Shell, ShellCell } from '@mcda/blueprint';
import type { ResolvedTheme, ThemeRoleSpec } from '@mcda/catalog';
import { describe, expect, it } from 'vitest';
import { ThemeResolver, shellContext } from '../src/index.js';
import { platformView, themes } from './fixtures.js';

const shellOf = (cells: ShellCell[]): Shell => ({ cells, rooms: new Map(), warnings: [] });
/** Satteldach-Streifen: Reihen y0 … y0 + n − 1, je Reihe eine Zelle weiter nach innen (z), Länge 4 in x. */
const roofStrip = (x0: number, y0: number, n: number): ShellCell[] => {
  const out: ShellCell[] = [];
  for (let k = 0; k < n; k++) for (let x = x0; x < x0 + 4; x++) out.push({ pos: [x, y0 + k, k], kind: 'roof', role: 'roof_main', shape: 'stairs', orient: { facing: 'south', half: 'bottom' } });
  return out;
};

describe('roof_t je Dachfläche (W9-G5)', () => {
  it('zwei getrennte Dächer in verschiedener Höhe laufen jedes für sich von 0 bis 1', () => {
    const low = roofStrip(0, 4, 5);
    const high = roofStrip(20, 12, 7);
    const ctx = shellContext(shellOf([...low, ...high]));
    const t = (c: ShellCell): number => ctx[[...low, ...high].indexOf(c)]!.t.roof_t!;
    expect(t(low[0]!)).toBe(0);
    expect(t(low[low.length - 1]!)).toBe(1);
    expect(t(high[0]!)).toBe(0);
    expect(t(high[high.length - 1]!)).toBe(1);
    // vorher (ein Verlauf über alle Dächer) lag das niedrige Dach ganz unter t = 0,4
    expect(t(low[8]!)).toBe(0.5);
  });

  it('diagonal steigende Reihen und Anbauten hängen zusammen (eine Fläche)', () => {
    const main = roofStrip(0, 4, 5);
    const wing = roofStrip(4, 4, 3); // stößt an x = 3 an: eine Fläche mit gemeinsamem Maximum
    const ctx = shellContext(shellOf([...main, ...wing]));
    expect(ctx[main.length + wing.length - 1]!.t.roof_t).toBe(0.5);
  });
});

describe('gradient.patch (W9-G5)', () => {
  const { registry, families } = platformView('1.21.11');
  const base = themes.get('medieval');
  const withPatch = (patch: number | undefined): ResolvedTheme => {
    const g = (base.roles['roof_main'] as ThemeRoleSpec).gradient!;
    const { patch: _p, ...rest } = g;
    return { ...base, roles: { ...base.roles, roof_main: { gradient: { ...rest, ...(patch !== undefined ? { patch } : {}) } } } };
  };
  const share = (theme: ResolvedTheme, rt: number): number => {
    const r = new ThemeResolver(theme, families, registry);
    let n = 0;
    let off = 0;
    for (let a = 0; a < 64; a++) for (let b = 0; b < 64; b++) {
      n++;
      if (r.resolve('roof_main', 'stairs', { mixSeed: 0, at: { seed: 9, plane: 1, a, b }, t: { roof_t: rt } }).block !== 'deepslate_tile_stairs') off++;
    }
    return off / n;
  };

  it('Anteil der Flecken ≈ patch, ohne patch ganze Ringe (bitgleich zu D1)', () => {
    expect(share(withPatch(undefined), 0.1)).toBe(0);
    expect(Math.abs(share(withPatch(0.06), 0.1) - 0.06)).toBeLessThan(0.02);
    expect(Math.abs(share(withPatch(0.1), 0.1) - 0.1)).toBeLessThan(0.025);
  });

  it('Flecken sind zusammenhängend (mehr gleiche Nachbarn als bei weißer Wahl)', () => {
    const r = new ThemeResolver(withPatch(0.1), families, registry);
    const at = (a: number, b: number): string => r.resolve('roof_main', 'stairs', { mixSeed: 0, at: { seed: 9, plane: 1, a, b }, t: { roof_t: 0.1 } }).block;
    let patchCells = 0;
    let patchNeighbours = 0;
    for (let a = 1; a < 63; a++) for (let b = 1; b < 63; b++) {
      if (at(a, b) === 'deepslate_tile_stairs') continue;
      patchCells++;
      if (at(a + 1, b) !== 'deepslate_tile_stairs' || at(a, b + 1) !== 'deepslate_tile_stairs') patchNeighbours++;
    }
    expect(patchNeighbours / patchCells).toBeGreaterThan(0.5);
  });
});
