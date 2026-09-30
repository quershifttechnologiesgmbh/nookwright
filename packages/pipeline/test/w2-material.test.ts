/**
 * W2-FC „Material, Verlauf, Themes“ (plan/baustandard.md, Regeln W3–W7, D1/D3, I1/I3) als Integrationstest über die
 * Pipeline: das zweistöckige Beispielhaus (`twoStoryHouse`, Satteldach, Eckquader) in einem Stein- und einem
 * Holz-Theme. Geprüft werden die Messkriterien des Baustandards und die harten Regeln (0 Physik-/Kollisionsfehler,
 * 0 dunkle Zellen, deterministisch). Bericht: plan/spikes/W2FC_material.md.
 */
import { fileURLToPath } from 'node:url';
import { FACADE_QUALITY_RULES, type Project, type ShellCell } from '@mcda/blueprint';
import { applySurfaces, effectiveShellRole, shellContext, type CellContext } from '@mcda/materialize';
import { describe, expect, it } from 'vitest';
import { generate, twoStoryHouse, type World } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const OPTS = { roof: 'gable' as const, facade: { quoins: true, plinthProfile: true } };

const cache = new Map<string, { readonly p: Project; readonly w: World }>();
function build(theme: string): { readonly p: Project; readonly w: World } {
  let b = cache.get(theme);
  if (b === undefined) {
    const p = twoStoryHouse('1.21.11', theme);
    cache.set(theme, (b = { p, w: generate(p, ctx, OPTS) }));
  }
  return b;
}
const nameAt = (w: World, pos: readonly number[]): string => {
  const v = w.materialized.volume;
  const q = pos as [number, number, number];
  return v.contains(q) && !v.isEmpty(q) ? v.stateAt(q).name.replace(/^minecraft:/, '') : 'air';
};
/** Kontext und Rolle nach den Flächen-Regeln je Hüllzelle (wie der Materialisierer, vor der Verwitterung). */
function roles(theme: string): { cell: ShellCell; ctx: CellContext; role: string }[] {
  const { p, w } = build(theme);
  const t = ctx.themes.get(theme);
  const types = Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId]));
  const contexts = shellContext(w.shell, types, { relative: w.shell.cells.some((c) => c.id !== undefined) });
  return w.shell.cells.map((cell, i) => {
    const out = applySurfaces(t, cell, contexts[i]!, p.state.seed);
    return { cell, ctx: contexts[i]!, role: effectiveShellRole((r) => Object.hasOwn(t.roles, r), out?.role ?? cell.role) };
  });
}
const storeyOf = (w: World, c: ShellCell): number => (c.roomId === undefined ? -99 : w.shell.rooms.get(c.roomId)?.floorIndex ?? -99);
const WOOD = /(planks|_log|_wood|_stem|bamboo)$/;

describe('W2-FC: Material, Verlauf, Themes (Baustandard)', () => {
  it('harte Regeln: 0 Fehler, 0 dunkle Zellen, deterministisch (Stein- und Holz-Theme)', () => {
    for (const theme of ['medieval', 'rustic']) {
      const { w } = build(theme);
      expect(w.materialized.violations.filter((v) => v.severity === 'error'), theme).toEqual([]);
      expect(w.materialized.light.darkCells, theme).toEqual([]);
      const again = generate(twoStoryHouse('1.21.11', theme), ctx, OPTS);
      const rows = (x: World): string[] => [...x.materialized.volume.cells()].map((c) => `${c.pos.join(',')}=${c.state.name}`).sort();
      expect(rows(again), theme).toEqual(rows(w));
    }
  });

  it('W5: ein Fassadenverlauf über das ganze Haus – gleiche Höhe, gleicher Wert; das OG beginnt nicht dunkel', () => {
    const { w } = build('medieval');
    const byY = new Map<number, Set<number>>();
    for (const { cell, ctx: c } of roles('medieval')) {
      if (cell.kind !== 'wall' || cell.exterior !== true) continue;
      (byY.get(cell.pos[1]) ?? byY.set(cell.pos[1], new Set()).get(cell.pos[1])!).add(c.t.facade_h!);
    }
    expect(byY.size).toBeGreaterThan(4);
    for (const [y, vals] of byY) expect(vals.size, `y=${y}`).toBe(1);
    // Reihe 0 im OG höchstens 10 Prozentpunkte dunkler/rauer als Reihe 2 im EG (X1: 47–69 % gegen 0–5 %)
    const dark = /^(cobbled_deepslate|cobblestone|mossy_cobblestone|tuff|deepslate)$/;
    const share = (storey: number, row: number): number => {
      const cells = w.shell.cells.filter((c) => c.kind === 'wall' && c.exterior === true && c.role === 'wall_primary' && storeyOf(w, c) === storey
        && c.pos[1] - w.shell.rooms.get(c.roomId!)!.baseY === row);
      return cells.filter((c) => dark.test(nameAt(w, c.pos))).length / cells.length;
    };
    expect(share(1, 0)).toBeLessThanOrEqual(share(0, 2) + 0.1);
  });

  it('W4: höchstens vier Grundblöcke je Außenwand-Ebene und Geschoss, keine Stämme im Bretterfeld', () => {
    for (const theme of ['medieval', 'rustic']) {
      const { w } = build(theme);
      const at = new Set(w.shell.cells.filter((c) => c.kind === 'wall' || c.kind === 'pillar').map((c) => c.pos.join(',')));
      const planes = new Map<string, Set<string>>();
      for (const c of w.shell.cells) {
        if (c.kind !== 'wall' || c.exterior !== true || c.role !== 'wall_primary') continue;
        const [x, y, z] = c.pos;
        const alongX = at.has(`${x + 1},${y},${z}`) || at.has(`${x - 1},${y},${z}`);
        const k = `${storeyOf(w, c)}|${alongX ? `z${z}` : `x${x}`}`;
        (planes.get(k) ?? planes.set(k, new Set()).get(k)!).add(nameAt(w, c.pos).replace(/^(mossy|cracked)_/, ''));
      }
      expect(planes.size, theme).toBeGreaterThan(3);
      for (const [k, s] of planes) expect(s.size, `${theme} ${k}: ${[...s].join(', ')}`).toBeLessThanOrEqual(4);
      if (theme === 'rustic') {
        const logs = w.shell.cells.filter((c) => c.kind === 'wall' && c.exterior === true && c.role === 'wall_primary' && /_(log|wood)$/.test(nameAt(w, c.pos)));
        expect(logs.map((c) => c.pos.join(','))).toEqual([]);
      }
    }
  });

  it('D1: Dach in ganzen Ringen – kein Materialwechsel innerhalb einer Dachreihe (ohne Grat-/Kehlkanten)', () => {
    for (const theme of ['medieval', 'rustic']) {
      const { w } = build(theme);
      const main = new Map<string, string>();
      for (const c of w.shell.cells) {
        if (c.kind === 'roof' && c.role === 'roof_main' && c.orient?.stairShape === undefined) main.set(c.pos.join(','), nameAt(w, c.pos).replace(/_(stairs|slab)$/, '').replace(/s$/, ''));
      }
      let pairs = 0;
      let diff = 0;
      for (const [k, m] of main) {
        const [x, y, z] = k.split(',').map(Number) as [number, number, number];
        for (const n of [`${x + 1},${y},${z}`, `${x},${y},${z + 1}`]) {
          const o = main.get(n);
          if (o === undefined) continue;
          pairs++;
          if (o !== m) diff++;
        }
      }
      expect(pairs, theme).toBeGreaterThan(20);
      // W9 (2026-09-27): W9-G5 legt Flecken des Nachbartons ins Dach (`gradient.patch`, medieval 6 %) – das Messkriterium
      // von D1 im Baustandard ist „Materialwechsel in derselben Dachreihe < 10 %“ (vorher hier 0, weil es keine Flecken
      // gab). Gemessen: medieval 4 von 123 Nachbarpaaren (2 Fleckzellen), rustic 0. Die Ringe selbst bleiben ganz: je
      // Reihe höchstens die Ringfarbe und ein Nachbarton, die Ringfarbe trägt ≥ 90 % der Reihe.
      expect(diff / pairs, theme).toBeLessThan(0.1);
      const rows = new Map<number, Map<string, number>>();
      for (const [k, m] of main) {
        const y = Number(k.split(',')[1]);
        const r = rows.get(y) ?? rows.set(y, new Map()).get(y)!;
        r.set(m, (r.get(m) ?? 0) + 1);
      }
      for (const [y, r] of rows) {
        const n = [...r.values()].reduce((a, b) => a + b, 0);
        expect(r.size, `${theme} Reihe y=${y}`).toBeLessThanOrEqual(2);
        expect(Math.max(...r.values()) / n, `${theme} Reihe y=${y}`).toBeGreaterThanOrEqual(0.9);
      }
      if (theme === 'rustic') expect(diff, theme).toBe(0);
    }
  });

  it('W3/I1: Ecke nach Material – Holz: Eckstamm, Stein: Quader nur in der Eckzelle (innen kein Quader)', () => {
    for (const theme of ['medieval', 'rustic']) {
      const { w } = build(theme);
      const quoins = roles(theme).filter((r) => r.cell.role === 'wall_quoin');
      expect(quoins.length, theme).toBeGreaterThan(0);
      // die verzahnten Nachbarzellen liegen im Wandfeld (innen sichtbar) und sind wieder Wandfeld
      expect(quoins.filter((r) => r.cell.kind === 'wall' && r.role === 'wall_quoin').map((r) => r.cell.pos.join(',')), theme).toEqual([]);
      const corners = quoins.filter((r) => r.cell.kind === 'pillar');
      expect(corners.length, theme).toBeGreaterThan(0);
      for (const r of corners) {
        if (theme === 'rustic') expect(nameAt(w, r.cell.pos), r.cell.pos.join(',')).toMatch(WOOD);
        else expect(r.role, r.cell.pos.join(',')).toBe('wall_quoin');
      }
    }
  });

  it('W6/I3: Geschossband als liegender Stamm, kein Fundamentstein über dem Erdgeschoss; Stein-Außenhaut bis unter das Dach', () => {
    const rs = roles('medieval');
    // Türschwellen tragen die Bordüre des Raums (der Rahmen läuft durch die Tür) und sind kein Wandfuß
    const upper = rs.filter((r) => r.cell.kind === 'floor' && r.ctx.wallDist === 0 && r.ctx.storey >= 1 && !r.ctx.door);
    expect(upper.length).toBeGreaterThan(0);
    expect(upper.filter((r) => r.role !== 'beam').map((r) => `${r.cell.pos.join(',')}:${r.role}`)).toEqual([]);
    const plate = rs.filter((r) => r.cell.kind === 'ceiling' && r.ctx.wallDist === 0 && r.ctx.exterior);
    expect(plate.length).toBeGreaterThan(0);
    expect([...new Set(plate.map((r) => r.role))]).toEqual(['wall_primary']);
  });

  it('Außenhaut (skin, W2-FA): ein Innenwand-Anschluss in der Außenwand liegt im Fassadenfeld – Laufrichtung und Rausch-Ebene der Fassade', () => {
    const p = twoStoryHouse('1.21.11', 'medieval');
    const w = generate(p, ctx, { roof: 'gable', facade: { rules: FACADE_QUALITY_RULES } });
    const contexts = shellContext(w.shell, {}, { relative: true });
    const ext = new Set(w.shell.cells.filter((c) => c.exterior === true && (c.kind === 'wall' || c.kind === 'pillar')).map((c) => c.pos.join(',')));
    const inner = new Set(w.shell.cells.filter((c) => c.exterior !== true && (c.kind === 'wall' || c.kind === 'pillar')).map((c) => c.pos.join(',')));
    let junctions = 0;
    w.shell.cells.forEach((c, i) => {
      if (c.kind !== 'wall' || c.exterior !== true) return;
      const [x, y, z] = c.pos;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => `${x + dx!},${y},${z + dz!}`);
      if (!nb.some((k) => inner.has(k))) return;
      junctions++;
      const c0 = contexts[i]!;
      const alongX = ext.has(nb[0]!) || ext.has(nb[1]!);
      expect(c0.wallAxis, c.pos.join(',')).toBe(alongX ? 'x' : 'z');
      expect(c0.corner, c.pos.join(',')).toBe(false);
    });
    expect(junctions).toBeGreaterThan(0);
  });

  it('Fachwerk-Ständer fluchten mit dem Fassadenraster (W2-FA `facadeGrid`): jeder Rasterpfosten ist ein Ständer', () => {
    const p = twoStoryHouse('1.21.11', 'timber');
    const w = generate(p, ctx, { roof: 'gable', facade: { rules: FACADE_QUALITY_RULES } });
    const grid = w.shell.facadeGrid ?? [];
    expect(grid.length).toBeGreaterThan(0);
    const t = ctx.themes.get('timber');
    const contexts = shellContext(w.shell, Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])), { relative: true });
    const at = new Map(w.shell.cells.map((c, i) => [c.pos.join(','), i] as const));
    let checked = 0;
    for (const g of grid) {
      if (g.floorIndex < 1) continue; // Fachwerk im Obergeschoss
      for (const post of g.posts) {
        const [x, z] = g.out === 'north' || g.out === 'south' ? [post, g.plane] : [g.plane, post];
        const i = at.get(`${x},${g.y0 + 2},${z}`);
        if (i === undefined || w.shell.cells[i]!.kind !== 'wall') continue;
        const out = applySurfaces(t, w.shell.cells[i]!, contexts[i]!, p.state.seed);
        expect(out, `${x},${g.y0 + 2},${z}`).toMatchObject({ role: 'beam', shape: 'log', axis: 'y' });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('I1: keine Verwitterung auf Wänden mit Raum dahinter; I3: Decken ohne Stein, Lehm, Wolle oder Fundament', () => {
    const { w } = build('medieval');
    const inner = w.shell.cells.filter((c) => (c.kind === 'wall' || c.kind === 'pillar') && storeyOf(w, c) >= 0);
    expect(inner.length).toBeGreaterThan(50);
    expect(inner.filter((c) => /^(mossy|cracked)_/.test(nameAt(w, c.pos))).map((c) => c.pos.join(','))).toEqual([]);
    const FOREIGN = new Set(['foundation', 'floor_stone', 'floor_earth', 'floor_tile_light', 'floor_tile_dark', 'textile_primary', 'textile_accent']);
    const ceilings = roles('medieval').filter((r) => r.cell.kind === 'floor' && r.ctx.bottomStorey === false);
    expect(ceilings.length).toBeGreaterThan(20);
    expect(ceilings.filter((r) => FOREIGN.has(r.role)).map((r) => `${r.cell.pos.join(',')}:${r.role}`)).toEqual([]);
  });
});
