/**
 * W4 (27.09.2026, Review M6 „Tarnmuster“): `noise.boards` – die Wahl in einer Mischung gilt je Brett aus `boards`
 * Blöcken entlang der ersten Flächenachse, Bretter je Reihe versetzt. Ohne Angabe bleibt die Wahl je Block (die
 * Prüfsummen der Themes ohne `boards` sichern das ab).
 */
import { describe, expect, it } from 'vitest';
import { validateThemeDef } from '@mcda/catalog';
import { ThemeResolver } from '../src/index.js';
import { platformView, themes } from './fixtures.js';

const p = platformView('1.21.11');

/** Blöcke einer Reihe b über a = 0 … n−1. */
function row(resolver: ThemeResolver, role: string, b: number, n = 48, plane = 11): string[] {
  return Array.from({ length: n }, (_, a) => resolver.resolve(role, 'block', { mixSeed: 1, at: { seed: 2026, plane, a, b } }).block);
}

describe('noise.boards (Dielen je Brett)', () => {
  it('medieval floor_primary: Wechsel nur an Brettstößen (alle 4 Blöcke), Stöße je Reihe versetzt', () => {
    const resolver = new ThemeResolver(themes.get('medieval')!, p.families, p.registry);
    const phases = new Set<number>();
    let changes = 0;
    for (let b = 0; b < 24; b++) {
      const r = row(resolver, 'floor_primary', b);
      const at = r.map((x, a) => (a > 0 && x !== r[a - 1] ? a : -1)).filter((a) => a >= 0);
      changes += at.length;
      for (const a of at) expect((a - at[0]!) % 4, `Reihe ${b}: ${r.join(' ')}`).toBe(0);
      if (at.length > 0) phases.add(at[0]! % 4);
    }
    expect(changes).toBeGreaterThan(0); // es gibt Nachbartöne
    expect(phases.size).toBeGreaterThan(1); // Stoßfugen laufen nicht durch
  });

  it('W12-D boardAxis "b": nordic wall_gable – senkrechte Bretter (Wechsel je Spalte nur alle 3 Blöcke, Stöße versetzt)', () => {
    const resolver = new ThemeResolver(themes.get('nordic')!, p.families, p.registry);
    const col = (a: number, n = 48): string[] => Array.from({ length: n }, (_, b) => resolver.resolve('wall_gable', 'block', { mixSeed: 1, at: { seed: 2026, plane: 11, a, b } }).block);
    const phases = new Set<number>();
    const kinds = new Set<string>();
    let changes = 0;
    for (let a = 0; a < 24; a++) {
      const c = col(a);
      for (const k of c) kinds.add(k);
      const at = c.map((x, b) => (b > 0 && x !== c[b - 1] ? b : -1)).filter((b) => b >= 0);
      changes += at.length;
      for (const b of at) expect((b - at[0]!) % 3, `Spalte ${a}: ${c.join(' ')}`).toBe(0);
      if (at.length > 0) phases.add(at[0]! % 3);
    }
    expect(changes).toBeGreaterThan(0);
    expect(phases.size).toBeGreaterThan(1);
    expect(kinds).toEqual(new Set(['stripped_oak_log', 'stripped_spruce_log', 'stripped_dark_oak_log']));
  });

  it('Schema: boardAxis nur a oder b', () => {
    const base = { id: 't', name: 'T', base: 'medieval', roles: {} };
    const role = (boardAxis: string) => ({ ...base, roles: { floor_primary: { mix: [{ family: 'oak', weight: 1 }, { family: 'spruce', weight: 1 }], noise: { type: 'cluster', boards: 3, boardAxis } } } });
    expect(validateThemeDef(role('a')).ok).toBe(true);
    expect(validateThemeDef(role('b')).ok).toBe(true);
    expect(validateThemeDef(role('c')).ok).toBe(false);
  });

  it('Schema: boards 2–8, nur ganze Zahlen', () => {
    const base = { id: 't', name: 'T', base: 'medieval', roles: {} };
    const role = (boards: number) => ({ ...base, roles: { floor_primary: { mix: [{ family: 'oak', weight: 1 }, { family: 'spruce', weight: 1 }], noise: { type: 'cluster', boards } } } });
    expect(validateThemeDef(role(4)).ok).toBe(true);
    expect(validateThemeDef(role(1)).ok).toBe(false);
    expect(validateThemeDef(role(9)).ok).toBe(false);
    expect(validateThemeDef(role(2.5)).ok).toBe(false);
  });
});
