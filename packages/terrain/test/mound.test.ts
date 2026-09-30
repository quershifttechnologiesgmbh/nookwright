/**
 * „Überdecken“ (BT16, Lage buried, mound.ts): Hügel dicht über dem Dach (cover Erdlagen, oben Gras), keine Erde im
 * Innenraum, Vorplatz vor der Front frei, Böschung mit Talus ≤ 1 (außer am Anschnitt neben der Fassade), Gras nur unter
 * Luft oder Pflanzen, keine Zonen auf dem Hügel.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, cellKey, key3 } from '@mcda/core';
import { expandComponent, placeComponent } from '@mcda/furnishing';
import { Site, generateSite, moundColumns, type BuildingInfo, type SiteResult } from '../src/index.js';
import { cellMap } from './fixtures.js';
import { DATA_VERSION_1_21_11, loadCatalog, loadStyles } from './helpers.js';

const Y0 = 64;
const CEIL = Y0 + 4;

/** Erdhaus 11 × 9, Front Süden (Tür bei 5,8): Bodenplatte, Außenwände, Decke; Innenluft y0+1 … y0+3. */
function hobbit(cover = 2, wing = 0): BuildingInfo {
  const footprint = CellSet.rect(0, 0, 10, 8);
  const occupied = new Set<string>();
  const tops = new Map<string, number>();
  for (const [x, z] of footprint) {
    occupied.add(key3([x, Y0, z]));
    occupied.add(key3([x, CEIL, z]));
    tops.set(cellKey(x, z), CEIL);
    if (x === 0 || x === 10 || z === 0 || z === 8) for (let y = Y0 + 1; y < CEIL; y++) occupied.add(key3([x, y, z]));
  }
  return { y0: Y0, footprint, covered: CellSet.empty(), doors: [{ cell: [5, 8], outward: 'south' }], occupied, buried: [{ front: 'south', cover, wing, tops }] };
}

const styles = loadStyles();
const site = (): Site => {
  const s = Site.create({ id: 's', projectId: 'p', seed: 5, styleId: 'meadow', plot: { minX: -12, minZ: -12, maxX: 22, maxZ: 20 } });
  s.paintZone('garden', CellSet.rect(-10, -10, 20, 18));
  return s;
};

/** Querschnitt x = const (z nach rechts): g Gras, e Erde, s Stein, F Fundament, # Hülle, * Pflanze, . Luft. */
function section(res: SiteResult, b: BuildingInfo, x: number, z0: number, z1: number): string {
  const cells = cellMap(res);
  const rows: string[] = [];
  for (let y = CEIL + 5; y >= Y0 - 1; y--) {
    let row = `${String(y - Y0).padStart(2)} `;
    for (let z = z0; z <= z1; z++) {
      const c = cells.get(key3([x, y, z]));
      row += b.occupied.has(key3([x, y, z])) ? '#' : c === undefined ? '.' : c.kind === 'plant' ? '*'
        : c.role === 'ground_grass' ? 'g' : c.role === 'ground_stone' ? 's' : c.role === 'foundation' ? 'F' : 'e';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

describe('Überdecken (Lage buried)', () => {
  const b = hobbit();
  const res = generateSite(site().state, styles.get('meadow')!, b);
  const cells = cellMap(res);
  const g = res.grid;
  /** Oberkante des Geländes je Spalte (auch über dem Dach). */
  const topOfCol = (x: number, z: number): number => Math.max(-Infinity, ...res.cells.filter((c) => c.kind === 'terrain' && c.pos[0] === x && c.pos[2] === z).map((c) => c.pos[1]));
  const tops = new Map<number, number>();
  const top = (i: number): number => {
    let t = tops.get(i);
    if (t === undefined) {
      t = b.footprint.has(g.x(i), g.z(i)) ? topOfCol(g.x(i), g.z(i)) : res.top[i]!;
      tops.set(i, t);
    }
    return t;
  };

  it('Hügel dicht: cover Erdlagen auf jeder Dachspalte, oben Gras; keine Erde im Innenraum', () => {
    for (const [x, z] of b.footprint) {
      expect([cells.get(key3([x, CEIL + 1, z]))?.role, cells.get(key3([x, CEIL + 2, z]))?.kind], `${x},${z}`).toEqual(['ground_dirt', 'terrain']);
      for (let y = Y0 + 1; y < CEIL; y++) expect(cells.has(key3([x, y, z])), `${x},${y},${z}`).toBe(false);
    }
    // W7 (27.09.2026): Kuppe statt Stufenpyramide – an der Front und an den Ecken nur die Erdlagen, der Scheitel liegt im
    // hinteren Teil (35 % der Tiefe von hinten) und trägt Gras
    const topOf = (x: number, z: number): number => Math.max(...res.cells.filter((c) => c.kind === 'terrain' && c.pos[0] === x && c.pos[2] === z).map((c) => c.pos[1]));
    for (let x = 0; x <= 10; x++) expect(topOf(x, 8), `Front ${x}`).toBe(CEIL + 2);
    expect(topOf(0, 0)).toBe(CEIL + 2);
    expect(topOf(5, 3)).toBe(CEIL + 4);
    expect(cells.get(key3([5, topOf(5, 3), 3]))?.role).toBe('ground_grass');
  });

  it('Front frei, Böschung mit Talus ≤ 1 zu Seiten und Rückseite, keine Zonen auf dem Hügel', () => {
    for (let x = -1; x <= 11; x++) expect(res.top[g.idx(x, 9)], `Vorplatz ${x},9`).toBeLessThanOrEqual(Y0);
    const steep: string[] = [];
    for (let i = 0; i < g.size; i++) {
      if (b.footprint.has(g.x(i), g.z(i)) || g.z(i) > 8) continue;
      for (const j of g.n4(i)) if (!b.footprint.has(g.x(j), g.z(j)) && g.z(j) <= 8 && Math.abs(res.top[i]! - res.top[j]!) > 1) steep.push(`${g.x(i)},${g.z(i)}`);
    }
    expect(steep).toEqual([]);
    // W7 (27.09.2026): runder Abfall mit weicher Schulter – neben der Wand bleibt die Erde auf Deckenhöhe oder darüber
    expect(res.top[g.idx(-1, 4)]).toBeGreaterThanOrEqual(CEIL + 1);
    expect(res.top[g.idx(5, -1)]).toBeGreaterThanOrEqual(CEIL + 1);
    expect(res.top[g.idx(5, -5)]).toBeGreaterThanOrEqual(Y0 + 1);
    // der Garten weicht dem Hügel aus
    expect(res.plan.zone[g.idx(-1, 4)]).toBeNull();
    expect(res.warnings.some((w) => /Zone .*ausgelassen/.test(w))).toBe(true);
  });

  it('Gras nur unter Luft oder Pflanzen, keine schwebende Erde, Pflanzen auf dem Hügel', () => {
    const bad: string[] = [];
    for (const c of res.cells) {
      if (c.kind !== 'terrain') continue;
      const up = cells.get(key3([c.pos[0], c.pos[1] + 1, c.pos[2]]));
      if (c.role === 'ground_grass' && (up?.kind === 'terrain' || b.occupied.has(key3([c.pos[0], c.pos[1] + 1, c.pos[2]])))) bad.push(`Gras ${c.pos}`);
      const down = key3([c.pos[0], c.pos[1] - 1, c.pos[2]]);
      if (c.pos[1] > res.bottom && cells.get(down)?.kind !== 'terrain' && !b.occupied.has(down)) bad.push(`schwebt ${c.pos}`);
    }
    expect(bad).toEqual([]);
    expect(res.cells.filter((c) => c.kind === 'plant' && c.pos[1] > CEIL).length).toBeGreaterThan(10);
  });

  it('cover 0: am Rand kein Erdauftrag, nur die Wölbung in der Mitte; Böschung ab der Decke', () => {
    const r0 = generateSite(site().state, styles.get('meadow')!, hobbit(0));
    const c0 = cellMap(r0);
    expect(c0.has(key3([0, CEIL + 1, 0]))).toBe(false);
    expect(c0.has(key3([5, CEIL + 1, 8]))).toBe(false); // W7: Front ohne Erdauftrag
    // W7 (27.09.2026): Wölbung als Kuppe (2 Lagen über dem Scheitel), neben der Wand Erde bis unter die Decke
    expect([c0.get(key3([5, CEIL + 1, 3]))?.role, c0.get(key3([5, CEIL + 2, 3]))?.role]).toEqual(['ground_dirt', 'ground_grass']);
    expect(r0.top[r0.grid.idx(-1, 4)]).toBeGreaterThanOrEqual(CEIL - 1);
  });

  it('W7-I Kuppe statt Stufenpyramide: runde Höhenlinien, kurze gerade Stufenkanten, kleine Kuppe', () => {
    // Höhenlinien hinter der Front: Füllgrad der Hüllbox (Rechteck 1, Ellipse π/4) und längste gerade Stufenkante
    const behind = (i: number): boolean => g.z(i) <= 8;
    let maxTop = -Infinity;
    for (let i = 0; i < g.size; i++) if (behind(i)) maxTop = Math.max(maxTop, top(i));
    const fills: number[] = [];
    let run = 0;
    for (let l = Y0 + 3; l <= maxTop; l++) {
      const S = [...Array(g.size).keys()].filter((i) => behind(i) && top(i) >= l);
      const xs = S.map((i) => g.x(i));
      const zs = S.map((i) => g.z(i));
      fills.push(S.length / ((Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...zs) - Math.min(...zs) + 1)));
      const inS = new Set(S);
      const lines = new Map<string, number[]>();
      for (const i of S) {
        for (const [dx, dz, d] of [[1, 0, 'e'], [-1, 0, 'w'], [0, 1, 's'], [0, -1, 'n']] as const) {
          const j = g.at(g.x(i) + dx, g.z(i) + dz);
          if (j < 0 || inS.has(j) || !behind(j)) continue;
          const key = dx !== 0 ? `${d}${g.x(i)}` : `${d}${g.z(i)}`;
          lines.set(key, [...(lines.get(key) ?? []), dx !== 0 ? g.z(i) : g.x(i)]);
        }
      }
      for (const a of lines.values()) {
        a.sort((p, q) => p - q);
        for (let k = 0, cur = 0; k < a.length; k++) {
          cur = k > 0 && a[k] === a[k - 1]! + 1 ? cur + 1 : 1;
          run = Math.max(run, cur);
        }
      }
    }
    // vorher (Stufenpyramide): Füllgrad 1,0 auf jeder Stufe, gerade Kanten so lang wie die Hausseite (≥ 11)
    expect(Math.max(...fills), fills.map((f) => f.toFixed(2)).join(' ')).toBeLessThan(0.93);
    expect(fills.reduce((a, f) => a + f, 0) / fills.length).toBeLessThan(0.88);
    expect(run).toBeLessThanOrEqual(9);
    // kleine Kuppe: weniger als 30 % des Dachs auf der obersten Stufe
    const roofTops = [...b.footprint].map(([x, z]) => topOfCol(x, z));
    expect(roofTops.filter((t) => t === Math.max(...roofTops)).length / roofTops.length).toBeLessThan(0.3);
  });

  // W3 (27.09.2026): eine Blume weniger im Schnitt – Blumen der Wiese nur noch in Bezug (`ground.near`, Baustandard G1)
  // W7 (27.09.2026): Kuppe statt Stufenpyramide (Scheitel hinten, weiche Schulter, Erde bis zum Fuß ohne Stein im Anschnitt)
  it('Querschnitt x = 5 (Front rechts)', () => {
    expect(`\n${section(res, b, 5, -8, 11)}`).toMatchInlineSnapshot(`
      "
       9 .........*..........
       8 ........*ggggg.*....
       7 ......*ggeeeeegg....
       6 .....ggeeeeeeeeeg...
       5 ...*geeeeeeeeeeee...
       4 ...geeee#########...
       3 .*geeeee#.......#...
       2 *geeeeee#.......#...
       1 geeeeeee#.......#..*
       0 eeeeeeee#########eee
      -1 eeeeeeeeFFFFFFFFFeee"
    `);
  });
});

describe('W7-I Erdhaus-Portal an der Rundtür (mound.ts `placeEarthPortals`, Katalog exterior/earth_portal)', () => {
  const options = { catalog: loadCatalog(), dataVersion: DATA_VERSION_1_21_11 };
  /**
   * Ring der Hülle vor der Tür (5,8), W12-B (2026-09-28) lückenlos: Pfosten bei ±2 (b … b+2), Kämpfertreppen bei ±1 und
   * Scheitelstufe (b+2), Bogenrücken −1 … 1 (b+3).
   */
  const ring = (extra: readonly (readonly [number, number, number])[] = []): BuildingInfo => {
    const base = hobbit();
    const occupied = new Set(base.occupied);
    const b = Y0 + 1;
    for (const u of [-2, 2]) for (const dy of [0, 1, 2]) occupied.add(key3([5 + u, b + dy, 9]));
    for (const u of [-1, 0, 1]) for (const dy of [2, 3]) occupied.add(key3([5 + u, b + dy, 9]));
    for (const p of extra) occupied.add(key3(p));
    return { ...base, occupied };
  };
  const portal = (b: BuildingInfo): SiteResult => generateSite(site().state, styles.get('meadow')!, b, undefined, options);

  it('Türblatt aus Falltüren im Ring, Laternen auf den Schultern, Laufweg vor der Tür frei', () => {
    const res = portal(ring());
    const pieces = res.outdoor.filter((o) => o.componentId === 'exterior/earth_portal');
    expect(pieces.map((p) => p.variantId)).toEqual(['leaf', 'lanterns']);
    const placed = pieces.map((p) => placeComponent(expandComponent(options.catalog.get(p.componentId), p.variantId), p.pose));
    const leaf = placed[0]!.cells.map((c) => key3(c.pos)).sort();
    const b = Y0 + 1;
    // W12-B (2026-09-28): das Türblatt füllt nur die Öffnung neben der Tür (darüber liegt der Bogen)
    expect(leaf).toEqual([[4, b, 9], [6, b, 9], [4, b + 1, 9], [6, b + 1, 9]].map((p) => key3(p as [number, number, number])).sort());
    expect(placed[0]!.cells.every((c) => c.mat.shape === 'trapdoor' && c.mat.orient?.open === true)).toBe(true);
    expect(placed[1]!.cells.map((c) => key3(c.pos)).sort()).toEqual([key3([3, b + 3, 9]), key3([7, b + 3, 9])].sort());
    // vor der Tür bleibt der Laufweg frei (Luftmaske), dort liegt weder Pflanze noch Objekt
    for (const y of [b, b + 1]) expect(placed.some((p) => p.cells.some((c) => key3(c.pos) === key3([5, y, 9])))).toBe(false);
    expect(res.cells.some((c) => c.pos[0] === 5 && c.pos[2] === 9 && c.pos[1] > Y0)).toBe(false);
  });

  // W12-B (2026-09-28): ohne Kopf des Türblatts (`leaf_top` entfällt, über der Öffnung liegt der Bogen) – nur die Laternen
  it('Kübel neben der Tür → nur die Laternen; ohne Ring kein Portal; ohne Katalog bitgleich wie bisher', () => {
    const pots = portal(ring([[4, Y0 + 1, 9], [6, Y0 + 1, 9]]));
    expect(pots.outdoor.filter((o) => o.componentId === 'exterior/earth_portal').map((p) => p.variantId)).toEqual(['lanterns']);
    expect(portal(hobbit()).outdoor.filter((o) => o.componentId === 'exterior/earth_portal')).toEqual([]);
    expect(generateSite(site().state, styles.get('meadow')!, ring()).outdoor).toEqual([]);
  });
});

/**
 * W9-G4 (plan/spikes/W9G4_erdhaus.md): mit Flanken (`wing` 2, Hülle seit W9-G4) – Kuppel, Flanken vor der Frontebene
 * neben dem Grundriss, Talus ≤ 1 am Hang, keine sichtbare Erde am Hügel (Moos an Stufenkanten, Stützmauer wo mehr als
 * eine Stufe offen liegt), Vorschau-Spalten wie das Gelände.
 */
describe('W9-G4 Erdhügel mit Flanken', () => {
  const b = hobbit(2, 2);
  const res = generateSite(site().state, styles.get('meadow')!, b);
  const terrain = res.cells.filter((c) => c.kind === 'terrain');
  const top = new Map<string, number>();
  for (const c of terrain) top.set(`${c.pos[0]},${c.pos[2]}`, Math.max(top.get(`${c.pos[0]},${c.pos[2]}`) ?? -Infinity, c.pos[1]));
  const at = (x: number, z: number): number => top.get(`${x},${z}`) ?? -Infinity;

  // W13-C (2026-09-28): die Flanken laufen über `wing` (2) hinaus noch 3 Blöcke als Böschung nach vorn aus und enden dort
  // auf der Wiese (vorher: davor sofort ≤ Y0 + 1)
  it('Flanken: neben dem Grundriss liegt der Hügel vor der Front und fällt nach vorn bis zur Wiese ab, vor der Front nicht', () => {
    for (const x of [-1, 11]) {
      expect(at(x, 9), `x ${x}`).toBeGreaterThan(Y0 + 1);
      expect(at(x, 10), `x ${x}`).toBeGreaterThan(Y0);
      for (let z = 9; z < 14; z++) expect(at(x, z) - at(x, z + 1), `x ${x} z ${z}`).toBeLessThanOrEqual(1);
      expect(at(x, 14), `x ${x}`).toBeLessThanOrEqual(Y0 + 1);
    }
    for (let x = 0; x <= 10; x++) expect(at(x, 9), `vor der Front x ${x}`).toBeLessThanOrEqual(Y0 + 1);
  });

  it('Kuppel: über dem Grundriss höher als am Rand, Hang mit Talus ≤ 1 hinter der Front', () => {
    expect(at(5, 3)).toBeGreaterThan(at(5, 8));
    let steep = 0;
    for (const [k, y] of top) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      if (z > 8 || (x >= 0 && x <= 10)) continue; // nur Hang neben und hinter dem Haus
      for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
        const n = top.get(`${x + dx},${z + dz}`);
        if (n !== undefined && z + dz <= 8 && (x + dx < 0 || x + dx > 10) && Math.abs(n - y) > 1) steep++;
      }
    }
    expect(steep).toBe(0);
  });

  // W13-C (2026-09-28, plan/spikes/W13C_erdhaus_huegel.md): Terrassen wie die Vorbilder – offene Stufenkanten zeigen
  // Grasnarbe und Erde (vorher ganz Moos), Moos nur in Flecken, kein Stein im Hügel; die Stützmauer steht nur noch am
  // Anschnitt vor der Frontebene (z > 8)
  it('Hügelkanten: Gras und Erde wie die Vorbilder, Moos in Flecken, Stein nur am Anschnitt vor der Front', () => {
    const roles = new Map(terrain.map((c) => [key3(c.pos), c.role] as const));
    let open = 0;
    let stone = 0;
    for (const c of terrain) {
      // Hügel: ab zwei über der Grundhöhe (darunter liegt auch das natürliche Relief des Geländestils)
      if (c.pos[1] <= Y0 + 1) continue;
      const [x, y, z] = c.pos;
      if (c.role === 'ground_stone') stone++;
      if (c.role === 'mound_wall') expect(z, `Stützmauer ${x},${y},${z}`).toBeGreaterThan(8);
      if (c.role !== 'ground_dirt' && c.role !== 'ground_grass') continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (res.grid.at(x + dx, z + dz) < 0) continue;
        const n = key3([x + dx, y, z + dz]);
        if (!roles.has(n) && !b.occupied.has(n)) open++;
      }
    }
    expect(stone).toBe(0);
    expect(open).toBeGreaterThan(0);
    expect(terrain.some((c) => c.role === 'ground_moss')).toBe(true);
  });

  it('Vorschau-Spalten (`moundColumns`) = Oberkante des Hügels im Gelände', () => {
    const cols = moundColumns(b, 5);
    expect(cols.length).toBeGreaterThan(b.footprint.size);
    for (const c of cols.filter((q) => b.footprint.has(q.x, q.z))) expect(c.from).toBe(CEIL + 1);
    expect(Math.max(...cols.map((c) => c.top))).toBe(Math.max(...[...b.footprint].map(([x, z]) => at(x, z))));
  });

  it('ohne Flanken bitgleich wie bisher (wing 0)', () => {
    const a = generateSite(site().state, styles.get('meadow')!, hobbit(2, 0));
    expect(a.cells.some((c) => c.role === 'ground_moss' || c.role === 'mound_wall')).toBe(false);
  });
});
