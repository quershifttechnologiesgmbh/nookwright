/**
 * W3-GA Grundstücks-Module (Bericht plan/spikes/W3GA_grundstueck.md, Baustandard G1 „wenig, gezielt“): Sichtfelder
 * der Fassaden, Baumgruppen am Rand, Straßenzaun mit Tor über dem Hauptweg, Zonen-Module (Hofecke, Gartenecke …),
 * Beet-Reihen mit Einfassung, Blumen in Bezug, ausgefranste Wegränder, Laternen nur am Tor. Ohne die neuen Optionen
 * bleibt das Gelände bitgleich (compat.test.ts: `test`, `plinth`, `structures`, `forest`, `farmland`).
 */
import { describe, expect, it } from 'vitest';
import { CellSet, key3, type Cell } from '@mcda/core';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { expandComponent, placeComponent } from '@mcda/furnishing';
import type { Gen } from '../src/gen.js';
import { PlotGrid } from '../src/grid.js';
import { postKind } from '../src/fences.js';
import { facadeBands } from '../src/modules.js';
import { Site, ZONE_KITS, generateSite, plotAround, type BuildingInfo, type SiteResult, type TerrainStyleDef } from '../src/index.js';
import { TEST_STYLE, cellMap, syntheticBuilding } from './fixtures.js';
import { DATA_VERSION_1_21_11, loadCatalog, loadStyles } from './helpers.js';

const styles = loadStyles();
const catalog = loadCatalog();
const MEADOW = styles.get('meadow')!;
const HOMESTEAD = styles.get('homestead')!;
/** Synthetisches Haus (11 × 9) mit Haustür nach Süden. */
const building: BuildingInfo = { ...syntheticBuilding(), doors: [{ cell: [5, 8], outward: 'south' }] };
const cheb = (a: readonly number[], b: readonly number[]): number => Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!));

function plain(style: TerrainStyleDef, seed = 4, margin = 18): SiteResult {
  const site = Site.create({ id: 's', projectId: 'p', seed, styleId: style.id, plot: plotAround(building, margin) });
  return generateSite(site.state, style, building, undefined, { catalog, dataVersion: DATA_VERSION_1_21_11 });
}

function homestead(style: TerrainStyleDef = HOMESTEAD, seed = 3): { site: Site; res: SiteResult } {
  const site = Site.create({ id: 's', projectId: 'p', seed, styleId: style.id, plot: plotAround(building, 16) });
  site.applyTemplate('homestead', building);
  return { site, res: generateSite(site.state, style, building, undefined, { catalog, dataVersion: DATA_VERSION_1_21_11 }) };
}

/** Sichtfelder nachrechnen (dieselbe Funktion wie im Generator, auf einem minimalen Arbeitszustand). */
function bandsOf(res: SiteResult): Uint8Array {
  const grid = new PlotGrid(res.grid.plot);
  return facadeBands({ grid, building, struct: new Uint8Array(grid.size) } as unknown as Gen);
}

describe('Sichtfelder der Fassaden', () => {
  it('vor Haupt- und Seitenfassaden 1, hinter dem Haus 2, diagonal an den Ecken 0', () => {
    const grid = new PlotGrid({ minX: -20, minZ: -20, maxX: 30, maxZ: 30 });
    const bands = facadeBands({ grid, building, struct: new Uint8Array(grid.size) } as unknown as Gen);
    expect(bands[grid.idx(5, 20)]).toBe(1); // vor der Haustür (Süden)
    expect(bands[grid.idx(20, 4)]).toBe(1); // vor der Ostfassade
    expect(bands[grid.idx(-15, 4)]).toBe(1); // vor der Westfassade
    expect(bands[grid.idx(5, -15)]).toBe(2); // hinter dem Haus
    expect(bands[grid.idx(20, 20)]).toBe(0); // Ecke vorn rechts
    expect(bands[grid.idx(-15, -15)]).toBe(0); // Ecke hinten links
    expect(bands[grid.idx(5, 4)]).toBe(0); // im Haus
  });
});

describe('Baumgruppe (Modul)', () => {
  for (const id of ['meadow', 'hills'] as const) {
    it(`${id}: Bäume nie vor einer Fassade, im Randband, in Gruppen, höchstens zwei Arten`, { timeout: HEAVY_TIMEOUT }, () => {
      for (const seed of [1, 4, 9]) {
        const res = plain(styles.get(id)!, seed);
        const bands = bandsOf(res);
        const g = res.grid;
        const rim = styles.get(id)!.vegetation!.trees!.groups!.rim ?? [2, 6];
        expect(res.trees.length, `${id}/${seed}`).toBeGreaterThan(0);
        expect(new Set(res.trees.map((t) => t.species)).size).toBeLessThanOrEqual(2);
        for (const t of res.trees) {
          const i = g.idx(t.base[0], t.base[2]);
          expect(bands[i], `Baum ${t.base} vor einer Fassade`).not.toBe(1);
          const x = t.base[0] - g.minX;
          const z = t.base[2] - g.minZ;
          const border = Math.min(x, z, g.w - 1 - x, g.d - 1 - z);
          expect(border, `Baum ${t.base} nicht im Randband`).toBeGreaterThanOrEqual(rim[0]);
          expect(border).toBeLessThanOrEqual(rim[1]);
        }
        // Gruppen: jede Gruppe mit ≥ 2 Stämmen hat Nachbarn im Abstand ≤ 8; Einzelbäume sind die Ausnahme
        const alone = res.trees.filter((t) => !res.trees.some((o) => o !== t && cheb([t.base[0], t.base[2]], [o.base[0], o.base[2]]) <= 8));
        expect(alone.length, `${id}/${seed}: Einzelbäume`).toBeLessThanOrEqual(1);
      }
    });
  }

  it('Unterholz: Büsche am Kronenrand, keine Einzelbüsche in der freien Wiese', { timeout: HEAVY_TIMEOUT }, () => {
    const res = plain(MEADOW);
    const g = res.grid;
    const bushes = res.cells.filter((c) => c.role === 'leaves_bush' && c.pos[1] === res.top[g.idx(c.pos[0], c.pos[2])]! + 1);
    for (const b of bushes) {
      const nearTree = res.trees.some((t) => cheb([t.base[0], t.base[2]], [b.pos[0], b.pos[2]]) <= 4);
      const atHouse = CellSet.of(building.footprint.toArray()).toArray().some((f) => cheb(f, [b.pos[0], b.pos[2]]) <= 2);
      expect(nearTree || atHouse, `Busch ohne Bezug ${b.pos}`).toBe(true);
    }
  });
});

describe('Straßenzaun mit Tor (Modul „Zaun mit Tor“)', () => {
  it('Tor genau über dem Hauptweg an der Straßenseite, Laternen nur auf den Torpfosten, Pfosten im Takt, Weg bleibt frei', { timeout: HEAVY_TIMEOUT }, () => {
    for (const seed of [2, 4, 8]) {
      const res = plain(MEADOW, seed);
      const cells = cellMap(res);
      const g = res.grid;
      const zLine = g.minZ + g.d - 2; // Tür nach Süden → Straße im Süden
      const line = res.cells.filter((c) => c.pos[2] === zLine && c.pos[1] === res.top[g.idx(c.pos[0], c.pos[2])]! + 1
        && (c.role === 'fence_outdoor' || c.role === 'fence_post'));
      const gates = line.filter((c) => c.shape === 'fence_gate');
      expect(gates.length, `Tor ${seed}`).toBeGreaterThanOrEqual(1);
      expect(gates.length).toBeLessThanOrEqual(3);
      // Tor in der Wegachse: Hauptweg-Zellen direkt davor und dahinter
      for (const gt of gates) {
        expect(res.paths.has(gt.pos[0], zLine - 1), `Weg vor dem Tor ${gt.pos}`).toBe(true);
        expect(res.paths.has(gt.pos[0], zLine), 'das Tor selbst ist keine Wegzelle (Kopffreiheit über Wegen)').toBe(false);
        expect(gt.orient).toMatchObject({ facing: 'south' });
      }
      // Laternen der Linie nur auf den beiden Torpfosten
      const xs = gates.map((c) => c.pos[0]);
      const gatePosts = [Math.min(...xs) - 1, Math.max(...xs) + 1];
      const lamps = res.cells.filter((c) => c.role === 'light_outdoor' && c.pos[2] === zLine);
      expect(lamps.map((c) => c.pos[0]).sort((a, b) => a - b)).toEqual(gatePosts);
      for (const x of gatePosts) expect(cells.get(key3([x, res.top[g.idx(x, zLine)]! + 1, zLine]))?.role).toBe('fence_post');
      // höchstens 3 Zaunfelder zwischen zwei Pfosten; W4 (27.09.2026): schlanke Zaunpfosten (Zaun 2 hoch) sind Pfosten
      const slim = (c: { pos: readonly number[] }): boolean => cells.get(key3([c.pos[0]!, c.pos[1]! + 1, c.pos[2]!]))?.role === 'fence_outdoor';
      const runs = line.filter((c) => c.role === 'fence_outdoor' && c.shape === 'fence' && !slim(c)).map((c) => c.pos[0]).sort((a, b) => a - b);
      let run = 0;
      for (let k = 0; k < runs.length; k++) {
        run = k > 0 && runs[k] === runs[k - 1]! + 1 ? run + 1 : 1;
        expect(run, `Zaunlauf bei ${runs[k]}`).toBeLessThanOrEqual(3);
      }
      // W4 (27.09.2026): Vorgartenzaun (`fences.streetSpan: "front"`) – die Linie bleibt in Hausbreite ± 2 bzw. Tor ± 3
      const foot = building.footprint.union(building.covered).bounds()!;
      const lo = Math.min(foot.minX - 2, Math.min(...xs) - 3);
      const hi = Math.max(foot.maxX + 2, Math.max(...xs) + 3);
      for (const c of line) expect(c.pos[0], `Straßenzaun bei ${c.pos[0]} außerhalb des Vorgartens`).toBeGreaterThanOrEqual(lo);
      for (const c of line) expect(c.pos[0]).toBeLessThanOrEqual(hi);
      expect(line.length).toBeLessThan(g.w - 2);
      // W4: volle Stämme (2 hoch) nur als Torpfosten, sonst Stumpf mit Zaunkopf (schlanke Zaunlinie)
      for (const c of line.filter((q) => q.role === 'fence_post')) {
        const top2 = cells.get(key3([c.pos[0], c.pos[1] + 1, c.pos[2]]))?.role;
        expect(top2, `Pfosten ${c.pos}`).toBe(gatePosts.includes(c.pos[0]) ? 'fence_post' : 'fence_outdoor');
      }
    }
  });

  it('ohne `fences.street` kein Straßenzaun; hinter einer Mauer mit Tordurchgang (Burg) auch nicht', { timeout: HEAVY_TIMEOUT }, () => {
    const off = plain({ ...MEADOW, fences: { lanterns: 'gate' } });
    const g = off.grid;
    expect(off.cells.some((c) => c.shape === 'fence_gate' && c.pos[2] === g.minZ + g.d - 2)).toBe(false);
    const site = Site.create({ id: 's', projectId: 'p', seed: 4, styleId: 'meadow', plot: plotAround(building, 18) });
    const ring = CellSet.rect(-3, -3, 13, 11).difference(CellSet.rect(-1, -1, 11, 9));
    const walled = generateSite(site.state, MEADOW, building, { footprint: ring.difference(CellSet.rect(4, 11, 6, 11)), passages: CellSet.rect(4, 11, 6, 11) });
    expect(walled.cells.some((c) => c.shape === 'fence_gate' && c.pos[2] === walled.grid.minZ + walled.grid.d - 2)).toBe(false);
  });
});

describe('Zonen-Module (Hofecke, Gartenecke, Feld, Obstgarten)', () => {
  it('wenige feste Stücke je Zone, am Zonenrand, Rücken zum Rand; ohne `kits` Streuung wie bisher', { timeout: HEAVY_TIMEOUT }, () => {
    const { site, res } = homestead();
    const zones = new Map(site.state.zones.map((z) => [z.id, z]));
    const byZone = new Map<string, number>();
    for (const p of res.outdoor) {
      byZone.set(p.zoneId, (byZone.get(p.zoneId) ?? 0) + 1);
      const z = zones.get(p.zoneId)!;
      const kit = ZONE_KITS[z.kind];
      expect(kit.some((s) => s.ids.includes(p.componentId)), `${p.componentId} gehört nicht zum Modul ${z.kind}`).toBe(true);
      // am Rand: eine Zelle des Stücks grenzt an eine Zelle außerhalb der Zone (oder an Ring/Hecke)
      const placed = placeComponent(expandComponent(catalog.get(p.componentId), p.variantId), p.pose);
      const cols = new Set(placed.cells.map((c) => `${c.pos[0]},${c.pos[2]}`));
      const rim = [...cols].some((k) => {
        const [x, zz] = k.split(',').map(Number) as [number, number];
        return ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dz]) => {
          const n: Cell = [x + dx, zz + dz];
          if (cols.has(`${n[0]},${n[1]}`)) return false;
          return !z.cells.has(n[0], n[1]) || res.cells.some((c) => c.pos[0] === n[0] && c.pos[2] === n[1] && (c.role === 'hedge' || c.role === 'fence_outdoor' || c.role === 'fence_post'));
        });
      });
      expect(rim, `${p.componentId} @${p.cell} nicht am Zonenrand`).toBe(true);
    }
    for (const [id, n] of byZone) {
      const z = zones.get(id)!;
      const most = ZONE_KITS[z.kind].reduce((s, slot) => s + (slot.max ?? 1), 0);
      expect(n, `${z.kind}: ${n} Stücke`).toBeLessThanOrEqual(most);
    }
    expect(res.outdoor.length).toBeGreaterThan(2);
    const scattered = homestead({ ...HOMESTEAD, decor: { ...HOMESTEAD.decor, kits: false } }).res;
    expect(scattered.outdoor.length).toBeGreaterThan(res.outdoor.length);
  });

  it('Garten ohne Hecke: bündige Einfassung, Reihen ohne Grasbüschel, Kopfbusch an jedem Reihenende', { timeout: HEAVY_TIMEOUT }, () => {
    const site = Site.create({ id: 's', projectId: 'p', seed: 5, styleId: 'meadow', plot: plotAround(building, 16) });
    site.paintZone('garden', CellSet.rect(-12, -14, 4, -6));
    const res = generateSite(site.state, MEADOW, building);
    const g = res.grid;
    const garden = site.state.zones[0]!.cells;
    const edge = garden.toArray().filter(([x, z]) => res.surface[g.idx(x, z)] === 'bed_edge');
    expect(edge.length).toBeGreaterThan(10);
    for (const [x, z] of edge) expect(([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dz]) => !garden.has(x + dx, z + dz))).toBe(true);
    const plants = res.cells.filter((c) => c.kind === 'plant' && garden.has(c.pos[0], c.pos[2]));
    expect(plants.some((c) => c.role === 'grass_tuft')).toBe(false);
    expect(plants.filter((c) => c.role === 'leaves_bush').length).toBeGreaterThanOrEqual(2);
    for (const c of plants) expect(['flower_warm', 'flower_cool', 'leaves_bush']).toContain(c.role);
  });
});

describe('Blumen in Bezug, Wegränder, Laternen', () => {
  it('Blumen: der offene Rasen trägt deutlich weniger Flecken als der Saum an Weg, Zaun, Gehölz und Haus', { timeout: HEAVY_TIMEOUT }, () => {
    const withNear = plain(MEADOW);
    const noNear = plain({ ...MEADOW, vegetation: { ...MEADOW.vegetation, ground: { ...MEADOW.vegetation!.ground!, near: undefined } } } as TerrainStyleDef);
    expect(withNear.groundPlants).toBeLessThan(noNear.groundPlants);
  });

  it('Ausfransen: Randzellen mit Wegmaterial, aber keine Wegzellen (keine Sackgassen) und ohne Pflanzen', { timeout: HEAVY_TIMEOUT }, () => {
    const res = plain(MEADOW);
    const g = res.grid;
    const cells = cellMap(res);
    let bulge = 0;
    for (let i = 0; i < g.size; i++) {
      if (res.plan.path[i] !== 0 || (res.surface[i] !== 'path_main' && res.surface[i] !== 'ground_path')) continue;
      const [x, z] = g.cell(i);
      if (res.cells.some((c) => c.shape === 'fence_gate' && c.pos[0] === x && c.pos[2] === z)) continue; // Straßentor
      bulge++;
      expect(cells.get(key3([x, res.top[i]! + 1, z])), `Pflanze auf Ausbuchtung ${x},${z}`).toBeUndefined();
      expect(g.n4(i).some((j) => res.plan.path[j]! >= 2)).toBe(true);
    }
    expect(bulge).toBeGreaterThan(0);
    expect(res.pathAudit.deadEnds).toEqual([]);
    expect(res.pathAudit.islandCells).toEqual([]);
  });

  it('Feldzaun mit `lanterns: "gate"`: Laternen nur auf den Torpfosten (auch ohne Pfostentakt)', { timeout: HEAVY_TIMEOUT }, () => {
    const site = Site.create({ id: 's', projectId: 'p', seed: 6, styleId: 'test', plot: plotAround(building, 16) });
    site.paintZone('field', CellSet.rect(-12, -14, 2, -6));
    const res = generateSite(site.state, { ...TEST_STYLE, fences: { lanterns: 'gate' } }, building);
    const f = res.fields[0]!;
    expect(f.lights.length).toBe(2);
    for (const l of f.lights) expect(cheb([l[0], l[2]], f.gate!.cell)).toBe(1);
    const all = generateSite(site.state, TEST_STYLE, building).fields[0]!;
    expect(all.lights.length).toBeGreaterThan(2);
  });

  it('keine Pflanze, kein Objekt, kein Baum auf Wegen; alles liegt auf Gelände der Klasse, die es trägt', { timeout: HEAVY_TIMEOUT }, () => {
    for (const style of [MEADOW, HOMESTEAD, styles.get('hills')!]) {
      const res = style === HOMESTEAD ? homestead().res : plain(style);
      const g = res.grid;
      const onPath = res.cells.filter((c) => c.kind === 'plant' && res.plan.path[g.idx(c.pos[0], c.pos[2])]! > 0 && c.pos[1] <= res.top[g.idx(c.pos[0], c.pos[2])]! + 2);
      expect(onPath.map((c) => `${style.id}: ${c.role}@${c.pos}`)).toEqual([]);
      for (const t of res.trees) expect(res.surface[g.idx(t.base[0], t.base[2])]).toBe('ground_dirt');
    }
  });
});

describe('W4-A Zäune und Grundstück-Feinschliff (plan/spikes/W4A_zaeune.md)', () => {
  it('Pfosten-Takt: großer Takt (Stamm) höchstens alle logEvery, schlanke Pfosten dazwischen höchstens alle postEvery', () => {
    for (const L of [5, 8, 12, 13, 17, 25, 40]) {
      const kinds = Array.from({ length: L + 1 }, (_, a) => postKind(a, L, 4, 12));
      const posts = [0, ...kinds.flatMap((k, a) => (k !== undefined ? [a] : [])), L];
      for (let k = 1; k < posts.length; k++) expect(posts[k]! - posts[k - 1]!, `L=${L}`).toBeLessThanOrEqual(4);
      const majors = [0, ...kinds.flatMap((k, a) => (k === 'major' ? [a] : [])), L];
      for (let k = 1; k < majors.length; k++) expect(majors[k]! - majors[k - 1]!, `L=${L}`).toBeLessThanOrEqual(12);
      // ohne logEvery: nur schlanke Pfosten an denselben Stellen wie der alte Takt (bitgleich)
      const m = Math.ceil(L / 4);
      const old = new Set(Array.from({ length: m - 1 }, (_, k) => Math.round(((k + 1) * L) / m)));
      for (let a = 0; a <= L; a++) expect(postKind(a, L, 4) === 'minor', `L=${L} a=${a}`).toBe(old.has(a));
    }
  });

  it('Gehöft: 2–4 Bäume aus Gruppen und Hausbäumen (ohne Obstgarten), volle Zaunstämme nur als Torpfosten', { timeout: HEAVY_TIMEOUT }, () => {
    for (const seed of [3, 5, 9]) {
      const { site, res } = homestead(HOMESTEAD, seed);
      const orchard = site.state.zones.filter((z) => z.kind === 'orchard');
      const free = res.trees.filter((t) => !orchard.some((z) => z.cells.has(t.base[0], t.base[2])));
      expect(free.length, `Bäume ${seed}`).toBeLessThanOrEqual(4);
      expect(free.length).toBeGreaterThanOrEqual(2);
      const cells = cellMap(res);
      const role = (x: number, y: number, z: number): string | undefined => cells.get(key3([x, y, z]))?.role;
      for (const c of res.cells) {
        // unterster Block eines genau 2 hohen Stammpfostens (Brunnenpfosten sind 3 hoch, Laternenpfähle 1 Stamm)
        if (c.role !== 'fence_post' || role(c.pos[0], c.pos[1] - 1, c.pos[2]) === 'fence_post') continue;
        if (role(c.pos[0], c.pos[1] + 1, c.pos[2]) !== 'fence_post' || role(c.pos[0], c.pos[1] + 2, c.pos[2]) === 'fence_post') continue;
        const nextToGate = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dz]) => cells.get(key3([c.pos[0] + dx, c.pos[1], c.pos[2] + dz]))?.shape === 'fence_gate');
        expect(nextToGate, `Vollstamm ${c.pos} nicht am Tor (${seed})`).toBe(true);
      }
    }
  });

  it('Vorplatz: 3 × forecourt vor der Haustür ein Pflaster (path_stone), Weg bleibt verbunden', { timeout: HEAVY_TIMEOUT }, () => {
    const res = plain(MEADOW, 4);
    const g = res.grid;
    for (let s = 1; s <= MEADOW.paths!.profile!.forecourt!; s++) expect(res.surface[g.idx(5, 8 + s)], `Mitte ${s}`).toBe('path_stone');
    expect(res.pathAudit.unconnectedDoors).toEqual([]);
    expect(res.pathAudit.deadEnds).toEqual([]);
  });

  it('W5 (27.09.2026, Review M3-Rest): der Vorplatz liegt auch über einem Platz (Stadthaus) – ein Pflaster statt Platzmuster', { timeout: HEAVY_TIMEOUT }, () => {
    for (const seed of [2, 4]) {
      const site = Site.create({ id: 's', projectId: 'p', seed, styleId: MEADOW.id, plot: plotAround(building, 18) });
      // Platz direkt vor der Tür (Tür bei 5,8 nach Süden), 11 breit, 6 tief
      site.paintZone('plaza', CellSet.rect(0, 9, 10, 14));
      const res = generateSite(site.state, MEADOW, building, undefined, { catalog, dataVersion: DATA_VERSION_1_21_11 });
      const g = res.grid;
      // die ersten Reihen vor der Tür ganz, im übrigen Streifen kein Platz-Akzent mehr (Brunnen/Laternen gesperrt: bleiben)
      for (let s = 1; s <= 2; s++) for (const k of [-1, 0, 1]) expect(res.surface[g.idx(5 + k, 8 + s)], `Seed ${seed}: ${5 + k},${8 + s}`).toBe('path_stone');
      for (let s = 1; s <= MEADOW.paths!.profile!.forecourt!; s++) for (const k of [-1, 0, 1]) expect(res.surface[g.idx(5 + k, 8 + s)]).not.toBe('plaza_accent');
      // daneben bleibt das Platzmuster
      expect(res.surface[g.idx(0, 12)]).not.toBe('path_stone');
      expect(res.pathAudit.unconnectedDoors).toEqual([]);
    }
  });

  it('Gartenwiese (cottage): Trittstein-Weg im Schachbrett, verbunden bis zum Rand, keine zwei Steine nebeneinander', { timeout: HEAVY_TIMEOUT }, () => {
    const COTTAGE = styles.get('cottage')!;
    for (const seed of [2, 4, 8]) {
      const res = plain(COTTAGE, seed);
      const g = res.grid;
      const fore = COTTAGE.paths!.profile!.forecourt!;
      const nearDoor = (i: number): boolean => Math.abs(g.x(i) - 5) <= 1 && g.z(i) > 8 && g.z(i) <= 8 + fore;
      let stones = 0;
      let main = 0;
      for (let i = 0; i < g.size; i++) {
        if (res.plan.path[i] !== 3 || nearDoor(i)) continue;
        main++;
        if (res.surface[i] !== 'path_stone') continue;
        stones++;
        for (const j of g.n4(i)) if (res.plan.path[j] === 3 && !nearDoor(j)) expect(res.surface[j], `Steine nebeneinander ${seed}`).not.toBe('path_stone');
      }
      expect(stones, `Trittsteine ${seed}`).toBeGreaterThan(0);
      expect(stones / main).toBeGreaterThan(0.3);
      expect(res.pathAudit.unconnectedDoors).toEqual([]);
      expect(res.pathAudit.deadEnds).toEqual([]);
      expect(res.pathAudit.islandCells).toEqual([]);
    }
  });
});
