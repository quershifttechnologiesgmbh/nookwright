import { describe, expect, it } from 'vitest';
import { CellSet, Rng, key3, type Vec3 } from '@mcda/core';
import {
  PlotGrid, Site, TERRAIN_ROLE_SHAPES, enforceTalus, fbm, generateSite, growTree, poissonDisk, type SiteResult,
} from '../src/index.js';
import type { TerrainStyleDef } from '../src/style.js';
import { TEST_STYLE, ascii, cellMap, fullSite, plot, syntheticBuilding } from './fixtures.js';

const building = syntheticBuilding();
const site = fullSite();
const res = generateSite(site.state, TEST_STYLE, building);
const byPos = cellMap(res);
const g = res.grid;
const topAt = (x: number, z: number): number => res.top[g.idx(x, z)]!;
const roleAt = (p: Vec3): string | undefined => byPos.get(key3(p))?.role;
const chebyshev = (a: readonly [number, number], b: readonly [number, number]): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

describe('Gelände-Generator: Grundregeln', () => {
  it('liefert nur terrain/plant-Zellen mit Rollen und Formen aus dem Rollen-Vertrag, ohne doppelte Positionen', () => {
    expect(res.warnings).toEqual([]);
    const shapes = TERRAIN_ROLE_SHAPES as Readonly<Record<string, readonly string[]>>;
    for (const c of res.cells) {
      expect(['terrain', 'plant']).toContain(c.kind);
      expect(shapes[c.role], `${c.role}.${c.shape}`).toContain(c.shape);
    }
    expect(byPos.size).toBe(res.cells.length);
    for (const k of building.occupied) expect(byPos.has(k), k).toBe(false);
    // alle Zonenarten kommen vor
    const roles = new Set(res.cells.map((c) => c.role));
    for (const r of ['farmland', 'water', 'fence_outdoor', 'light_outdoor', 'garden_soil', 'ground_yard', 'pond_bed', 'ground_path', 'leaves_bush', 'flower_wild', 'grass_tuft']) {
      expect(roles.has(r), r).toBe(true);
    }
  });

  it('ist deterministisch; Neu würfeln ändert Vegetation, nicht die Zonen', () => {
    const again = generateSite(fullSite().state, TEST_STYLE, building);
    expect(JSON.stringify(again.cells)).toBe(JSON.stringify(res.cells));
    const s2 = fullSite();
    s2.reroll();
    const other = generateSite(s2.state, TEST_STYLE, building);
    expect(JSON.stringify(other.cells)).not.toBe(JSON.stringify(res.cells));
    expect(other.fields[0]!.farmland.length + other.fields[0]!.water.length).toBe(res.fields[0]!.farmland.length + res.fields[0]!.water.length);
  });

  it('Talus ≤ 1 zwischen allen 4er-Nachbarn (begehbar), auch mit extremem Terraforming', () => {
    const check = (r: SiteResult): number => {
      let worst = 0;
      for (let i = 0; i < r.grid.size; i++) {
        for (const j of r.grid.n4(i)) worst = Math.max(worst, Math.abs(r.top[i]! - r.top[j]!));
      }
      return worst;
    };
    expect(check(res)).toBeLessThanOrEqual(1);
    const s = fullSite();
    s.sculpt('raise', CellSet.rect(-19, 3, -17, 5), 20); // Hügel, weit weg von allen Pins
    s.flatten(CellSet.rect(0, 20, 4, 24), -12); // Grube
    s.sculpt('lower', CellSet.rect(-2, -3, 12, -3), 9); // Graben direkt am Planierring
    const r = generateSite(s.state, TEST_STYLE, building);
    expect(check(r)).toBeLessThanOrEqual(1);
    expect(r.top[r.grid.idx(-18, 4)]).toBeGreaterThan(building.y0 + 8); // der Hügel bleibt hoch, mit Böschung
    expect(r.top[r.grid.idx(2, 22)]).toBeLessThan(building.y0 - 4);
    // am Planierring begrenzt der Talus das Terraforming (Lipschitz-Schranke vom Pin)
    expect(r.top[r.grid.idx(5, -3)]).toBeGreaterThanOrEqual(building.y0 - 1);
  });

  it('Fundament: Planierring auf y0, unter jeder Gebäudespalte lückenlos Fundament bis y0 − 1', () => {
    for (const [x, z] of building.footprint) {
      for (let y = res.bottom; y < building.y0; y++) expect(roleAt([x, y, z]), `${x},${y},${z}`).toBe('foundation');
      expect(byPos.has(key3([x, building.y0, z]))).toBe(false); // Bodenplatte gehört der Hülle
    }
    const ring = CellSet.rect(-2, -2, 12, 10).difference(CellSet.rect(0, 0, 10, 8));
    for (const [x, z] of ring) expect(topAt(x, z), `${x},${z}`).toBe(building.y0);
    // Überblendung: kein Sprung, sondern Abfall über mehrere Blöcke; weit weg gilt das Relief
    const far = [...Array(g.size).keys()].filter((i) => Math.abs(g.x(i) - 5) > 15 || Math.abs(g.z(i) - 4) > 15);
    expect(new Set(far.map((i) => res.top[i])).size).toBeGreaterThan(2);
  });

  it('jede Geländesäule ist geschlossen: vom Boden bis zur Oberfläche ohne Luft, Wasser liegt nie frei', () => {
    for (let i = 0; i < g.size; i++) {
      const x = g.x(i);
      const z = g.z(i);
      const top = res.surface[i] === 'building' ? building.y0 - 1 : res.top[i]!;
      for (let y = res.bottom; y <= top; y++) expect(byPos.get(key3([x, y, z]))?.kind, `${x},${y},${z}`).toBe('terrain');
    }
    for (const c of res.cells) {
      if (c.role !== 'water') continue;
      const [x, y, z] = c.pos;
      expect(byPos.get(key3([x, y - 1, z]))?.kind).toBe('terrain');
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = byPos.get(key3([x + dx, y, z + dz]));
        expect(n?.kind, `Wasser bei ${c.pos} läuft nach ${dx},${dz} aus`).toBe('terrain');
      }
    }
  });
});

describe('Felder (Farm)', () => {
  const f = res.fields[0]!;

  it('Ackerland auf einer Höhe, jede Ackerzelle ≤ 4 Blöcke (Chebyshev) von Wasser auf gleicher Höhe', () => {
    expect(f.farmland.length).toBeGreaterThan(80);
    expect(f.water.length).toBeGreaterThan(0);
    for (const c of f.farmland) {
      expect(roleAt([c[0], f.level, c[1]])).toBe('farmland');
      expect(f.water.some((w) => chebyshev(w, c) <= 4), `${c} trocken`).toBe(true);
    }
    for (const w of f.water) expect(roleAt([w[0], f.level, w[1]])).toBe('water');
  });

  it('Feldfrüchte auf Ackerland mit freiem Himmel (Licht 15 ≥ 9), in Bändern', () => {
    expect(f.crops.length).toBe(f.farmland.length);
    const plantAbove = (x: number, y: number, z: number): boolean => {
      for (let yy = y + 1; yy < y + 40; yy++) if (byPos.has(key3([x, yy, z])) || building.occupied.has(key3([x, yy, z]))) return true;
      return false;
    };
    for (const c of f.crops) {
      expect(roleAt([c.cell[0], f.level, c.cell[1]])).toBe('farmland');
      expect(roleAt([c.cell[0], f.level + 1, c.cell[1]])).toBe(c.role);
      expect(plantAbove(c.cell[0], f.level + 1, c.cell[1])).toBe(false);
      expect(building.covered.has(c.cell[0], c.cell[1])).toBe(false);
    }
    expect(new Set(f.crops.map((c) => c.role)).size).toBeGreaterThan(1);
  });

  it('Zaunring mit Tor zum Weg, Laternen auf Zaunpfosten', () => {
    expect(f.gate).toBeDefined();
    const gate = f.gate!;
    expect(byPos.get(key3([gate.cell[0], f.level + 1, gate.cell[1]]))).toMatchObject({ role: 'fence_outdoor', shape: 'fence_gate', orient: { facing: gate.facing } });
    const out: readonly [number, number] = gate.facing === 'north' ? [gate.cell[0], gate.cell[1] - 1] : gate.facing === 'south' ? [gate.cell[0], gate.cell[1] + 1]
      : gate.facing === 'east' ? [gate.cell[0] + 1, gate.cell[1]] : [gate.cell[0] - 1, gate.cell[1]];
    expect(res.paths.has(out[0], out[1])).toBe(true);
    // Ring geschlossen: Außenrand des Felds = Zaun oder Tor
    const zone = site.zone('z1').cells;
    for (const [x, z] of zone) {
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !zone.has(x + dx!, z + dz!));
      if (edge) expect(roleAt([x, f.level + 1, z]), `${x},${z}`).toBe('fence_outdoor');
    }
    expect(f.lights.length).toBeGreaterThanOrEqual(4);
    for (const l of f.lights) {
      expect(roleAt(l)).toBe('light_outdoor');
      expect(byPos.get(key3([l[0], l[1] - 1, l[2]]))).toMatchObject({ role: 'fence_outdoor', shape: 'fence' });
    }
  });

  it('schmale oder unregelmäßige Felder: Wasser nur eingefasst, Rest bewässert (L-Form)', () => {
    const s = Site.create({ id: 'l', projectId: 'p', seed: 3, styleId: 'test', plot });
    s.paintZone('field', CellSet.rect(-22, -24, -4, -20).union(CellSet.rect(-22, -24, -18, -8)));
    const r = generateSite(s.state, { ...TEST_STYLE, vegetation: {} }, building);
    const lf = r.fields[0]!;
    for (const c of lf.farmland) expect(lf.water.some((w) => chebyshev(w, c) <= 4), `${c}`).toBe(true);
  });
});

describe('Wege, Garten, Hof, Teich', () => {
  it('Wege verbinden die Haustür mit Feldtor, Garten, Hof, Teichufer und Grundstücksrand', () => {
    const exit = res.doorExits[0]!;
    expect(exit).toEqual([5, -1]);
    const walk = new Set<string>([...res.paths].map(([x, z]) => `${x},${z}`));
    for (const [x, z] of site.zone('z3').cells) walk.add(`${x},${z}`); // Hof ist begehbar
    const seen = new Set<string>([`${exit[0]},${exit[1]}`]);
    const queue: (readonly [number, number])[] = [exit];
    while (queue.length > 0) {
      const [x, z] = queue.pop()!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = `${x + dx},${z + dz}`;
        if (!walk.has(k) || seen.has(k)) continue;
        if (Math.abs(topAt(x + dx, z + dz) - topAt(x, z)) > 1) continue;
        seen.add(k);
        queue.push([x + dx, z + dz]);
      }
    }
    const gate = res.fields[0]!.gate!;
    expect(seen.has(`${gate.cell[0]},${gate.cell[1] + 1}`)).toBe(true); // Tor nach Süden
    expect([...site.zone('z2').cells].some(([x, z]) => seen.has(`${x},${z}`))).toBe(true); // Gartenweg
    const pond = site.zone('z4').cells;
    expect([...seen].some((k) => {
      const [x, z] = k.split(',').map(Number) as [number, number];
      return !pond.has(x, z) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => pond.has(x + dx!, z + dz!));
    })).toBe(true);
    expect([...seen].some((k) => {
      const [x, z] = k.split(',').map(Number) as [number, number];
      return x === plot.minX || x === plot.maxX || z === plot.minZ || z === plot.maxZ;
    })).toBe(true);
  });

  it('auf und über Wegen steht nichts (Kopffreiheit 2), vor Türen 2 Blöcke frei', () => {
    for (const [x, z] of res.paths) {
      const t = topAt(x, z);
      expect(byPos.has(key3([x, t + 1, z])), `${x},${z}`).toBe(false);
      expect(byPos.has(key3([x, t + 2, z])), `${x},${z}`).toBe(false);
      expect(['ground_path', 'ground_yard', 'garden_soil']).toContain(roleAt([x, t, z]));
    }
    for (const c of res.cells) {
      if (c.kind !== 'plant') continue;
      expect(chebyshev([c.pos[0], c.pos[2]], res.doorExits[0]!), `${c.role} bei ${c.pos}`).toBeGreaterThan(1);
    }
  });

  it('Garten: Beete mit Blumen auf Gartenerde, Wege dazwischen; Hof gepflastert mit Laternenpfosten', () => {
    const garden = site.zone('z2').cells;
    let flowers = 0;
    for (const [x, z] of garden) {
      const t = topAt(x, z);
      const s = roleAt([x, t, z]);
      expect(['garden_soil', 'ground_path']).toContain(s);
      const above = roleAt([x, t + 1, z]);
      if (s === 'garden_soil') {
        expect(above).toBeDefined();
        if (above!.startsWith('flower')) flowers++;
      } else expect(above).toBeUndefined();
    }
    expect(flowers).toBeGreaterThan(30);
    const yard = site.zone('z3').cells;
    const levels = new Set([...yard].map(([x, z]) => topAt(x, z)));
    expect(levels.size).toBe(1);
    expect([...yard].filter(([x, z]) => roleAt([x, topAt(x, z) + 2, z]) === 'light_outdoor')).toHaveLength(1);
  });

  it('Teich: ebener Wasserspiegel, Mitte 2 tief, Ufer eingefasst', () => {
    const pond = site.zone('z4').cells;
    const level = topAt(20, 14);
    for (const [x, z] of pond) {
      expect(topAt(x, z)).toBe(level);
      expect(roleAt([x, level, z])).toBe('water');
    }
    expect(roleAt([21, level - 1, 15])).toBe('water');
    expect(roleAt([18, level - 1, 12])).toBe('pond_bed');
  });
});

describe('Vegetation', () => {
  it('Bäume: senkrechter Stamm auf Erde, Krone aus Laub der Art, Abstand ≥ spacing, nie über Wegen/Zonen', () => {
    expect(res.trees.length).toBeGreaterThan(5);
    expect(new Set(res.trees.map((t) => t.species)).size).toBe(3);
    for (const t of res.trees) {
      const [x, y, z] = t.base;
      expect(roleAt([x, y, z])).toBe('ground_dirt');
      expect(byPos.get(key3([x, y + 1, z]))).toMatchObject({ role: `log_${t.species}`, shape: 'log', orient: { axis: 'y' } });
    }
    for (let a = 0; a < res.trees.length; a++) {
      for (let b = a + 1; b < res.trees.length; b++) {
        const p = res.trees[a]!.base;
        const q = res.trees[b]!.base;
        expect(Math.hypot(p[0] - q[0], p[2] - q[2])).toBeGreaterThanOrEqual(TEST_STYLE.vegetation!.trees!.spacing);
      }
    }
    const zoneCells = CellSet.of(site.state.zones.flatMap((zz) => [...zz.cells]));
    for (const c of res.cells) {
      if (!c.role.startsWith('leaves_') || c.role === 'leaves_bush') continue;
      expect(res.paths.has(c.pos[0], c.pos[2]), `Laub über Weg ${c.pos}`).toBe(false);
      expect(zoneCells.has(c.pos[0], c.pos[2]), `Laub über Zone ${c.pos}`).toBe(false);
      expect(building.covered.has(c.pos[0], c.pos[2]) || building.footprint.has(c.pos[0], c.pos[2])).toBe(false);
    }
  });

  it('Büsche am Fundament und auf der Wiese; Blumen/Gras per Poisson-Disk mit Mindestabstand', () => {
    const bushCols = res.cells.filter((c) => c.role === 'leaves_bush' && c.pos[1] === building.y0 + 1);
    const atFoundation = bushCols.filter((c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => building.footprint.has(c.pos[0] + dx!, c.pos[2] + dz!)));
    expect(atFoundation.length).toBeGreaterThan(3);
    for (const c of atFoundation) expect(roleAt([c.pos[0], c.pos[1] + 1, c.pos[2]])).toBeUndefined(); // Fenster frei
    const garden = site.zone('z2').cells;
    const ground = res.cells.filter((c) => ['flower_wild', 'grass_tuft', 'ground_cover'].includes(c.role) && !garden.has(c.pos[0], c.pos[2]));
    expect(ground.length).toBe(res.groundPlants);
    for (const c of ground) {
      expect(['ground_grass']).toContain(roleAt([c.pos[0], c.pos[1] - 1, c.pos[2]]));
      if (c.role === 'ground_cover') expect(c.orient?.facing).toBeDefined();
    }
    const r = TEST_STYLE.vegetation!.ground!.spacing;
    const pts = ground.map((c) => [c.pos[0], c.pos[2]] as const);
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) expect(Math.hypot(pts[a]![0] - pts[b]![0], pts[a]![1] - pts[b]![1])).toBeGreaterThanOrEqual(r);
    }
  });

  it('Streuungsregeln (K6): keepFree hält Wege frei, threshold dünnt aus, ohne Felder bitgleich', () => {
    const style = (extra: (v: NonNullable<TerrainStyleDef['vegetation']>) => NonNullable<TerrainStyleDef['vegetation']>): TerrainStyleDef => ({
      ...TEST_STYLE,
      vegetation: extra({ ...TEST_STYLE.vegetation! }),
    });
    // Ohne die neuen Felder ändert sich nichts (dieselben Punkte wie der Standardlauf)
    const gleich = generateSite(fullSite().state, TEST_STYLE, building);
    expect(gleich.trees.length).toBe(res.trees.length);
    expect(gleich.groundPlants).toBe(res.groundPlants);

    // keepFree: Wege bleiben frei (auch die Nachbarzelle), und nichts wird überbaut
    const mitFrei = generateSite(fullSite().state, style((v) => ({ ...v, keepFree: [{ along: 'path', distance: 1 }, { around: 'door', distance: 2 }] })), building);
    expect(mitFrei.trees.length).toBeGreaterThan(0);
    for (const t of mitFrei.trees) {
      expect(mitFrei.paths.has(t.base[0], t.base[2])).toBe(false);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        expect(mitFrei.paths.has(t.base[0] + dx, t.base[2] + dz), `Baum an Weg ${t.base}`).toBe(false);
      }
    }
    const pflanzen = mitFrei.cells.filter((c) => ['flower_wild', 'grass_tuft', 'ground_cover'].includes(c.role));
    for (const c of pflanzen) expect(mitFrei.paths.has(c.pos[0], c.pos[2]), `Pflanze auf Weg ${c.pos}`).toBe(false);

    // threshold dünnt monoton aus
    const zaehle = (min: number): number => generateSite(
      fullSite().state,
      style((v) => ({ ...v, trees: { ...v.trees!, threshold: min }, ground: { ...v.ground!, threshold: min } })),
      building,
    ).groundPlants;
    expect(zaehle(0)).toBe(res.groundPlants);
    expect(zaehle(0.4)).toBeLessThan(zaehle(0));
    expect(zaehle(1)).toBe(0);
  });

  it('Wiesen-Zone: keine Bäume/Büsche, mehr Blumen', () => {
    const meadow = site.zone('z5').cells;
    const inMeadow = res.cells.filter((c) => c.kind === 'plant' && meadow.has(c.pos[0], c.pos[2]));
    expect(inMeadow.some((c) => c.role.startsWith('log') || c.role === 'leaves_bush')).toBe(false);
    expect(inMeadow.filter((c) => c.role === 'flower_wild').length).toBeGreaterThan(meadow.size * 0.1);
  });

  it('prozedurale Bäume: deterministisch, Stamm unten, Laub nie im Stamm', () => {
    for (const sp of ['oak', 'birch', 'spruce'] as const) {
      const a = growTree(sp, [0, 10, 0], new Rng(5));
      expect(growTree(sp, [0, 10, 0], new Rng(5))).toEqual(a);
      const logs = a.blocks.filter((b) => b.part === 'log');
      expect(logs.map((b) => b.pos)).toEqual(Array.from({ length: a.trunkHeight }, (_, k) => [0, 11 + k, 0]));
      const logKeys = new Set(logs.map((b) => key3(b.pos)));
      const leaves = a.blocks.filter((b) => b.part === 'leaves');
      expect(leaves.length).toBeGreaterThan(15);
      for (const l of leaves) {
        expect(logKeys.has(key3(l.pos))).toBe(false);
        expect(Math.max(Math.abs(l.pos[0]), Math.abs(l.pos[2]))).toBeLessThanOrEqual(a.radius);
      }
      expect(Math.max(...leaves.map((l) => l.pos[1]))).toBeGreaterThan(10 + a.trunkHeight); // Krone über dem Stamm
    }
  });
});

describe('Bausteine', () => {
  it('Poisson-Disk: Mindestabstand, deterministisch, respektiert vorhandene Punkte', () => {
    const cands: (readonly [number, number])[] = [];
    for (let x = 0; x < 30; x++) for (let z = 0; z < 30; z++) cands.push([x, z]);
    const a = poissonDisk(cands, 3, new Rng(1), undefined, [[15, 15]]);
    expect(poissonDisk(cands, 3, new Rng(1), undefined, [[15, 15]])).toEqual(a);
    expect(a.length).toBeGreaterThan(40);
    for (const p of [...a, [15, 15] as const]) {
      for (const q of a) if (p !== q) expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeGreaterThanOrEqual(3);
    }
  });

  it('Talus-Pass: exakt 1-Lipschitz, Pins bleiben, fBm in [0, 1]', () => {
    const grid = new PlotGrid({ minX: 0, minZ: 0, maxX: 39, maxZ: 29 });
    const rng = new Rng(9);
    for (let round = 0; round < 5; round++) {
      const h = Int32Array.from({ length: grid.size }, () => rng.int(-10, 10));
      const pins = new Uint8Array(grid.size);
      pins[grid.idx(5, 5)] = 1;
      h[grid.idx(5, 5)] = 0;
      pins[grid.idx(30, 20)] = 1;
      h[grid.idx(30, 20)] = 12;
      const r = enforceTalus(grid, h, pins);
      expect(r.conflicts).toBe(0);
      expect(r.heights[grid.idx(5, 5)]).toBe(0);
      expect(r.heights[grid.idx(30, 20)]).toBe(12);
      for (let i = 0; i < grid.size; i++) for (const j of grid.n4(i)) expect(Math.abs(r.heights[i]! - r.heights[j]!)).toBeLessThanOrEqual(1);
    }
    for (let k = 0; k < 200; k++) {
      const v = fbm(3, k * 7, k * 3, 16, 4, 0.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('ohne Gebäude und ohne Zonen: nur Gelände und Vegetation, keine Wege', () => {
    const s = Site.create({ id: 'e', projectId: 'p', seed: 1, styleId: 'test', plot: { minX: 0, minZ: 0, maxX: 15, maxZ: 15 } });
    const r = generateSite(s.state, TEST_STYLE);
    expect(r.paths.size).toBe(0);
    expect(r.cells.filter((c) => c.kind === 'terrain').length).toBeGreaterThanOrEqual(16 * 16 * 3);
  });
});

// Beispielbild für den Bericht: `npx vitest run packages/terrain -t Beispielbild` (Ausgabe nur bei DEBUG)
it('Beispielbild (ASCII)', () => {
  const pic = ascii(res);
  if (process.env['DEBUG_TERRAIN'] !== undefined) console.log(pic);
  expect(pic.split('\n')).toHaveLength(g.d);
});
