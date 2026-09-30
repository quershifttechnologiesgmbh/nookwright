/**
 * W12-C (plan/spikes/W12C_bauernhof_details.md): Hochsilo – Kreisscheibe, spiegelsymmetrisch ohne Drehsinn, Mantel voll
 * Heu (keine Luft), Reifen und Kranz in `trim_light`, Kuppel aus Dachtreppen (Rücken zur Mitte), nichts schwebt.
 */
import { describe, expect, it } from 'vitest';
import type { ShellCell } from '@mcda/blueprint';
import { buildStructures, flatGround, floatingCells, inFootprint, type HeightField } from '../src/index.js';

const ground = flatGround();
const sig = (c: ShellCell): string => `${c.role}/${c.shape}/${c.orient?.facing ?? ''}/${c.orient?.half ?? ''}`;
const MIRROR_X: Record<string, string> = { east: 'west', west: 'east' };
const MIRROR_Z: Record<string, string> = { north: 'south', south: 'north' };

describe('Hochsilo (W12-C)', () => {
  it('Standard (r 3, Mantel 16): Kreisscheibe, voll Heu, Reifen, Kuppel mit Blitzableiter, nichts schwebt', () => {
    const res = buildStructures({ silos: [{ center: [4, -3] }] }, { ground });
    expect(res.warnings).toEqual([]);
    expect(floatingCells(res.cells, ground)).toEqual([]);
    const by = new Map(res.cells.map((c) => [c.pos.join(','), c] as const));
    // Grundfläche = Kreisscheibe r 3 (Ø 7), belegte Spalten für das Gelände
    const cols = new Set(res.cells.map((c) => `${c.pos[0] - 4},${c.pos[2] + 3}`));
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) expect(cols.has(`${dx},${dz}`), `${dx},${dz}`).toBe(inFootprint('round', 3, dx, dz));
    expect(res.footprint).toHaveLength(cols.size);
    // Mantel ab Sockel (y 0–1 Stein), innen keine Luft: jede Spalte im Inneren ist bis zur Kuppel belegt
    for (let y = 0; y <= 15; y++) expect(by.get(`4,${y},-3`)?.role, `Mitte y ${y}`).toBe('hay');
    expect(by.get('7,0,-3')?.role).toBe('foundation');
    // W16-B (28.09.2026): Reifen in `silo_band` (vorher trim_light), Kranz oben bleibt hell
    expect(by.get('7,4,-3')?.role).toBe('silo_band');
    expect(by.get('7,5,-3')?.role).toBe('silo');
    expect(by.get('7,15,-3')?.role, 'Kranz').toBe('trim_light');
    // Kuppel: Rücken zur Mitte, oben Stufe + Blitzableiter; W16-B: im Scheunendach `roof_barn` (vorher roof_main)
    expect(by.get('7,16,-3')).toMatchObject({ role: 'roof_barn', shape: 'stairs', orient: { facing: 'west', half: 'bottom' } });
    expect(by.get('4,18,-3')).toMatchObject({ role: 'roof_barn', shape: 'block' });
    expect(by.get('4,19,-3')).toMatchObject({ role: 'roof_barn', shape: 'slab' });
    expect(by.get('4,20,-3')).toMatchObject({ role: 'finial', shape: 'lightning_rod' });
    expect(res.cells.every((c) => c.kind === 'fort' && c.exterior === true)).toBe(true);
  });

  it('spiegelsymmetrisch in x und z (Rollen, Formen, Ausrichtung) – kein Windrad', () => {
    for (const radius of [2, 3, 4]) {
      const res = buildStructures({ silos: [{ center: [0, 0], radius, height: 10 }] }, { ground });
      const by = new Map(res.cells.map((c) => [c.pos.join(','), c] as const));
      for (const c of res.cells) {
        const [x, y, z] = c.pos;
        const mx = by.get(`${-x},${y},${z}`);
        const mz = by.get(`${x},${y},${-z}`);
        expect(mx, `r ${radius}: Spiegel x von ${c.pos}`).toBeDefined();
        expect(mz, `r ${radius}: Spiegel z von ${c.pos}`).toBeDefined();
        const f = c.orient?.facing;
        expect(sig(mx!), `r ${radius} x ${c.pos}`).toBe(sig({ ...c, ...(f !== undefined ? { orient: { ...c.orient, facing: (MIRROR_X[f] ?? f) as never } } : {}) }));
        expect(sig(mz!), `r ${radius} z ${c.pos}`).toBe(sig({ ...c, ...(f !== undefined ? { orient: { ...c.orient, facing: (MIRROR_Z[f] ?? f) as never } } : {}) }));
      }
    }
  });

  it('Hang: Auffüllung bis aufs Gelände, Sockel auf der höchsten Spalte, nichts schwebt; deterministisch', () => {
    const slope: HeightField = { groundY: (x) => Math.floor(x / 3) - 1 };
    const a = buildStructures({ silos: [{ center: [0, 0] }] }, { ground: slope, seed: 7 });
    const b = buildStructures({ silos: [{ center: [0, 0] }] }, { ground: slope, seed: 7 });
    expect(floatingCells(a.cells, slope)).toEqual([]);
    expect(b.cells).toEqual(a.cells);
    const hay = a.cells.filter((c) => c.role === 'hay');
    expect(Math.min(...hay.map((c) => c.pos[1]))).toBe(slope.groundY(3, 0) + 1);
  });

  it('ohne Silo bitgleich (leere Eingabe)', () => {
    expect(buildStructures({ silos: [] }, { ground }).cells).toEqual(buildStructures({}, { ground }).cells);
  });
});
