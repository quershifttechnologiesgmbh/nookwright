/**
 * T2 – Gelände-Feinschliff (research/18 §9–§13, research/16 U5/L3/V1–V6): Wegprofil, Zaunpfosten im Takt, Hecken,
 * Tore, Brunnen, Hof-Ausstattung, neue Zonen (Platz, Obstgarten, Koppel, gemalter Weg), Beleuchtung und die
 * Vorlage „Gehöft“. Die Pipeline prüft dieselbe Base materialisiert (Physik, echtes Licht) in homestead.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CellSet, key3, type Cell, type Vec3 } from '@mcda/core';
import {
  Site, TERRAIN_ROLE_SHAPES, brushCells, generateSite, planTemplate, plotAround, type BuildingInfo, type SiteResult, type TerrainStyleDef,
} from '../src/index.js';
import { TEST_STYLE, cellMap, fullSite, plot, syntheticBuilding } from './fixtures.js';
import { loadStyles } from './helpers.js';

const styles = loadStyles();
const HOMESTEAD = styles.get('homestead')!;
/** Synthetisches Haus (11 × 9, Überstand 1) mit Haustür nach Süden und einem Fenster in der Ostwand. */
const building: BuildingInfo = (() => {
  const b = syntheticBuilding();
  return { ...b, doors: [{ cell: [5, 8], outward: 'south' }], openings: new Set([key3([5, 65, 8]), key3([5, 66, 8]), key3([10, 66, 4])]) };
})();
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const cheb = (a: Cell, b: Cell): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

function homestead(lighting: 'paths' | 'spawnproof' = 'paths', seed = 3, style: TerrainStyleDef = HOMESTEAD): { site: Site; res: SiteResult } {
  const site = Site.create({ id: 's', projectId: 'p', seed, styleId: 'meadow', plot: plotAround(building, 16) });
  site.applyTemplate('homestead', building);
  site.setLighting(lighting);
  return { site, res: generateSite(site.state, style, building) };
}

/** Begehbare Spalten ab der Haustür (Wege, Hof/Platz/Obstgarten, Tore, Zoneninneres ohne Pflanzenkollision). */
function walkFrom(res: SiteResult, start: Cell): Set<string> {
  const cells = cellMap(res);
  const g = res.grid;
  const solid = (x: number, y: number, z: number): boolean => {
    const c = cells.get(key3([x, y, z]));
    return c !== undefined && c.kind === 'plant' && c.shape !== 'fence_gate' && !/^(flower|grass_tuft|ground_cover|crop|pond_plant)/.test(c.role);
  };
  const ok = (x: number, z: number): boolean => {
    const i = g.at(x, z);
    if (i < 0 || res.surface[i] === 'building' || res.surface[i] === 'water') return false;
    const t = res.top[i]!;
    return !solid(x, t + 1, z) && !solid(x, t + 2, z);
  };
  const seen = new Set<string>([`${start[0]},${start[1]}`]);
  const queue: Cell[] = [start];
  while (queue.length > 0) {
    const [x, z] = queue.pop()!;
    for (const [dx, dz] of N4) {
      const k = `${x + dx},${z + dz}`;
      if (seen.has(k) || !ok(x + dx, z + dz)) continue;
      if (Math.abs(res.top[g.idx(x + dx, z + dz)]! - res.top[g.idx(x, z)]!) > 1) continue;
      seen.add(k);
      queue.push([x + dx, z + dz]);
    }
  }
  return seen;
}

describe('Vorlage „Gehöft“ (research/18 S1)', () => {
  it('Plan: Hof vor der Tür, Feld dahinter, Garten an der Küchenseite, Koppel und Obstgarten; Abstände für Wege', () => {
    const p = planTemplate('homestead', building, plotAround(building, 16));
    expect(p.front).toBe('south');
    const byKind = new Map(p.zones.map((z) => [z.kind, z]));
    expect([...byKind.keys()].sort()).toEqual(['field', 'garden', 'orchard', 'paddock', 'yard']);
    const b = building.footprint.union(building.covered);
    const bb = b.bounds()!;
    expect(byKind.get('yard')!.cells.bounds()!.minZ).toBeGreaterThan(bb.maxZ); // vorn (Süden)
    expect(byKind.get('field')!.cells.bounds()!.maxZ).toBeLessThan(bb.minZ); // hinten
    expect(byKind.get('garden')!.edge).toBe('hedge');
    for (const z of p.zones) {
      for (const c of z.cells) for (const h of b) expect(cheb(c, h), `${z.kind} zu nah am Haus`).toBeGreaterThanOrEqual(3);
    }
    for (let a = 0; a < p.zones.length; a++) {
      for (let c = a + 1; c < p.zones.length; c++) {
        const A = p.zones[a]!.cells.toArray();
        const B = p.zones[c]!.cells.toArray();
        expect(Math.min(...A.flatMap((x) => B.map((y) => cheb(x, y)))), `${p.zones[a]!.kind}/${p.zones[c]!.kind}`).toBeGreaterThanOrEqual(3);
      }
    }
    // Küche im Osten → Garten im Osten (+x); ohne Angabe links vom Eingang (Westen bei Tür nach Süden)
    const east = planTemplate('homestead', building, plotAround(building, 16), { kitchen: CellSet.rect(7, 0, 10, 8) });
    expect(east.zones.find((z) => z.kind === 'garden')!.cells.bounds()!.minX).toBeGreaterThan(bb.maxX);
    expect(byKind.get('garden')!.cells.bounds()!.maxX).toBeLessThan(bb.minX);
  });

  it('Befehl: ersetzt Zonen, vergrößert das Grundstück, setzt Beleuchtung und Stil; Undo stellt alles wieder her', () => {
    const site = Site.create({ id: 's', projectId: 'p', seed: 1, styleId: 'meadow', plot: plotAround(building, 8) });
    site.paintZone('pond', CellSet.rect(-6, -6, -3, -3));
    const before = site.history.length;
    const ev = site.applyTemplate('homestead', building);
    expect(ev[0]!.type).toBe('PlotResized');
    expect(ev.filter((e) => e.type === 'ZoneRemoved')).toHaveLength(1);
    expect(site.state.zones.map((z) => z.kind).sort()).toEqual(['field', 'garden', 'orchard', 'paddock', 'yard']);
    expect(site.state).toMatchObject({ lighting: 'paths', styleId: 'homestead' });
    expect(Site.fromHistory(JSON.parse(JSON.stringify(site.history))).state.zones.length).toBe(5);
    const back = site.undo(ev.length);
    expect(back.history.length).toBe(before);
    expect(back.state.zones.map((z) => z.kind)).toEqual(['pond']);
    expect(back.state.lighting).toBeUndefined();
    // eigener Stil bleibt, wenn übergeben
    const keep = Site.create({ id: 't', projectId: 'p', seed: 1, styleId: 'hills', plot: plotAround(building, 20) });
    keep.applyTemplate('homestead', building, { styleId: 'hills', lighting: 'spawnproof' });
    expect(keep.state).toMatchObject({ styleId: 'hills', lighting: 'spawnproof' });
  });

  it('Gelände: ohne Hinweise, nur Vertrags-Rollen, keine Doppelbelegung, nichts im Haus', () => {
    const { res } = homestead();
    expect(res.warnings).toEqual([]);
    const shapes = TERRAIN_ROLE_SHAPES as Readonly<Record<string, readonly string[]>>;
    for (const c of res.cells) expect(shapes[c.role], `${c.role}.${c.shape}`).toContain(c.shape);
    expect(cellMap(res).size).toBe(res.cells.length);
    for (const c of res.cells) expect(building.occupied.has(key3(c.pos)), `${c.role}@${c.pos}`).toBe(false);
    const f = res.features!;
    expect(f.wells).toHaveLength(1);
    expect(f.gates.map((g) => g.kind).sort()).toEqual(['field', 'garden', 'paddock']);
    expect(f.decor.beds + f.decor.woodpiles + f.decor.planters).toBeGreaterThan(0);
    // W3 (27.09.2026): Zonen-Module (`decor.kits`) – der Bienenstock steht als Katalog-Stück in der Gartenecke
    // (`ZONE_KITS.garden`, nur mit Katalog), nicht mehr zusätzlich als Einzelblock vor dem Garten
    expect(f.decor.beehives).toBe(0);
    expect(res.fields[0]!.scarecrow).toBeDefined();
  });

  it('Wege: Hauptweg 3 breit in der Türachse bis zum Südrand, Nebenwege zu allen Toren, alles begehbar', () => {
    const { res } = homestead();
    const f = res.features!;
    const main = f.routes.find((r) => r.rank === 3)!;
    expect(main.width).toBe(3);
    expect(main.cells[0]).toEqual([5, 9]);
    expect(main.cells[main.cells.length - 1]![1]).toBe(res.grid.plot.maxZ);
    for (const c of main.cells) expect(Math.abs(c[0] - 5), `Achse ${c}`).toBeLessThanOrEqual(2);
    expect(res.cells.some((c) => c.role === 'path_main')).toBe(true);
    expect(res.cells.some((c) => c.role === 'path_edge')).toBe(true);
    // Kopffreiheit auf allen Wegzellen, Tür-Ausgang ist Weg
    const cells = cellMap(res);
    for (const [x, z] of res.paths) {
      const t = res.top[res.grid.idx(x, z)]!;
      expect(cells.has(key3([x, t + 1, z])) || cells.has(key3([x, t + 2, z])), `Weg ${x},${z} verstellt`).toBe(false);
    }
    expect(res.paths.has(5, 9)).toBe(true);
    // Von der Tür erreichbar: jedes Tor (Zelle vor dem Tor und das Tor selbst) und der Grundstücksrand
    const seen = walkFrom(res, [5, 9]);
    for (const g of f.gates) {
      expect(seen.has(`${g.cell[0]},${g.cell[1]}`), `Tor ${g.kind} ${g.cell}`).toBe(true);
    }
    expect([...seen].some((k) => Number(k.split(',')[1]) === res.grid.plot.maxZ)).toBe(true);
    // Pfad zum Obstgarten als Trittsteine
    expect(res.cells.some((c) => c.role === 'path_stone')).toBe(true);
  });

  it('Brunnen (A4): neben der Türachse, Wasser 2 tief eingefasst, 4 Pfosten, Dach, Laterne obendrauf', () => {
    const { res } = homestead();
    const cells = cellMap(res);
    const [wx, wy, wz] = res.features!.wells[0]!;
    expect(Math.abs(wx - 5)).toBeGreaterThanOrEqual(3); // Türachse (x 4..6) frei
    expect(cells.get(key3([wx, wy, wz]))?.role).toBe('water');
    expect(cells.get(key3([wx, wy - 1, wz]))?.role).toBe('water');
    expect(cells.get(key3([wx, wy - 2, wz]))?.role).toBe('well_stone');
    for (const [dx, dz] of N4) expect(cells.get(key3([wx + dx, wy + 1, wz + dz]))).toMatchObject({ role: 'well_stone', shape: 'wall' });
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      for (let dy = 1; dy <= 3; dy++) expect(cells.get(key3([wx + dx!, wy + dy, wz + dz!]))?.role).toBe('fence_post');
      expect(cells.get(key3([wx + dx!, wy + 4, wz + dz!]))).toMatchObject({ role: 'well_roof', shape: 'slab', orient: { half: 'top' } });
    }
    expect(cells.get(key3([wx, wy + 5, wz]))?.role).toBe('light_outdoor');
  });

  it('Zäune (Z1/Z3/Z4): Pfosten an Ecken und Toren, höchstens 3 Zaunfelder am Stück; Heckengarten mit Laubbogen', () => {
    const { res } = homestead();
    const cells = cellMap(res);
    const field = res.fields[0]!;
    const posts = new Set(field.posts!.map(([x, z]) => `${x},${z}`));
    const fence = new Set(field.fence.map(([x, z]) => `${x},${z}`));
    for (const [x, z] of field.fence) {
      for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
        let run = 1;
        while (fence.has(`${x + dx * run},${z + dz * run}`)) run++;
        expect(run, `Zaunlauf ab ${x},${z}`).toBeLessThanOrEqual(3);
      }
    }
    const gate = field.gate!;
    const gateNb = N4.map(([dx, dz]) => `${gate.cell[0] + dx},${gate.cell[1] + dz}`).filter((k) => posts.has(k));
    expect(gateNb).toHaveLength(2);
    // W4 (27.09.2026): schlanke Zaunlinie (`fences.logEvery`) – volle Stämme (2 hoch) nur als Torpfosten, dazwischen
    // schlanke Zaunpfosten (Zaun 2 hoch). W5 (27.09.2026, Review W4-R N10): die Eckpfosten sind keine Stümpfe mit
    // Stammfuß mehr, sondern Zaun 2 hoch ohne Erdfleck – Stamm nur noch am Tor
    for (const [x, z] of field.posts!) {
      const gatePost = gateNb.includes(`${x},${z}`);
      expect(cells.get(key3([x, field.level + 1, z]))).toMatchObject(gatePost ? { role: 'fence_post', shape: 'log' } : { role: 'fence_outdoor', shape: 'fence' });
      expect(cells.get(key3([x, field.level + 2, z]))?.role).toBe(gatePost ? 'fence_post' : 'fence_outdoor');
    }
    expect(field.slimPosts!.length).toBeGreaterThan(0);
    for (const [x, z] of field.slimPosts!) {
      expect(cells.get(key3([x, field.level + 1, z]))).toMatchObject({ role: 'fence_outdoor', shape: 'fence' });
      expect(cells.get(key3([x, field.level + 2, z]))).toMatchObject({ role: 'fence_outdoor', shape: 'fence' });
    }
    // Stämme höchstens an Ecken, Toren und im großen Takt: deutlich weniger als ein Drittel der Linie
    expect(field.posts!.length / (field.posts!.length + field.slimPosts!.length + field.fence.length)).toBeLessThan(0.2);
    for (const l of field.lights) expect(cells.get(key3([l[0], l[1] - 1, l[2]]))?.role).toBe('fence_post');
    // W3 (27.09.2026): Modul „Zaun mit Tor“ (`fences.lanterns: "gate"`) – Licht nur auf den beiden Torpfosten, nicht an
    // jeder Ecke (Vorbilder: Laterne am Eingang, an jedem Pfosten 0 von 16)
    expect(field.lights.map((l) => `${l[0]},${l[2]}`).sort()).toEqual([...gateNb].sort());
    for (const k of gateNb) {
      const [x, z] = k.split(',').map(Number) as [number, number];
      expect(cells.get(key3([x, field.level + 3, z]))?.role, `Torpfosten ${k}`).toBe('light_outdoor');
    }
    // Garten: Hecke (2 hoch), Tor mit Laubbogen
    const gg = res.features!.gates.find((g) => g.kind === 'garden')!;
    const level = res.top[res.grid.idx(gg.cell[0], gg.cell[1])]!;
    expect(cells.get(key3([gg.cell[0], level + 1, gg.cell[1]]))?.shape).toBe('fence_gate');
    expect(cells.get(key3([gg.cell[0], level + 2, gg.cell[1]]))).toBeUndefined();
    expect(cells.get(key3([gg.cell[0], level + 3, gg.cell[1]]))?.role).toBe('hedge');
    expect(res.cells.filter((c) => c.role === 'hedge').length).toBeGreaterThan(40);
  });

  it('Koppel (A3) und Obstgarten (V4): Boden, Tränke, Heu, Obstbäume mit Kopffreiheit', () => {
    const { site, res } = homestead();
    const cells = cellMap(res);
    const paddock = site.state.zones.find((z) => z.kind === 'paddock')!;
    const roles = res.cells.filter((c) => paddock.cells.has(c.pos[0], c.pos[2])).map((c) => c.role);
    for (const r of ['paddock_ground', 'trough', 'hay', 'fence_post', 'fence_outdoor', 'light_outdoor']) expect(roles, r).toContain(r);
    const orchard = site.state.zones.find((z) => z.kind === 'orchard')!;
    const fruit = res.cells.filter((c) => c.role === 'leaves_fruit' && orchard.cells.has(c.pos[0], c.pos[2]));
    expect(fruit.length).toBeGreaterThan(40);
    const lvl = res.top[res.grid.idx(...orchard.cells.toArray()[0]!)]!;
    for (const c of fruit) expect(c.pos[1], 'Krone ab 3 über dem Boden').toBeGreaterThanOrEqual(lvl + 3);
    for (const t of res.trees) expect(cells.get(key3([t.base[0], t.base[1] + 1, t.base[2]]))?.shape).toBe('log');
  });

  it('Pflanzen auf passendem Boden, Laternen gestützt, Rinne/Kies nie über Luft', () => {
    for (const mode of ['paths', 'spawnproof'] as const) {
      const { res } = homestead(mode);
      const cells = cellMap(res);
      const below = (p: Vec3): string | undefined => cells.get(key3([p[0], p[1] - 1, p[2]]))?.role;
      for (const c of res.cells) {
        if (/^flower|^grass_tuft|^ground_cover/.test(c.role)) expect(['ground_grass', 'garden_soil'], `${c.role}@${c.pos}`).toContain(below(c.pos));
        if (c.role.startsWith('crop')) expect(below(c.pos)).toBe('farmland');
        if (c.role === 'light_outdoor') expect(below(c.pos), `Laterne ${c.pos}`).toMatch(/fence_outdoor|fence_post|well_roof|well_stone|woodpile|hay|barrel|beehive|ground_|path_|paddock|plaza|log_/);
        if (c.kind === 'terrain' && /path_main|path_edge|well_stone|path_gutter/.test(c.role)) expect(below(c.pos), `${c.role}@${c.pos}`).toBeDefined();
      }
    }
  });

  it('Beleuchtung: Pfähle im Takt neben den Wegen; spawnsicher setzt nach (Modell ohne dunkle Stelle, Leuchtbüsche)', () => {
    // W3 (27.09.2026): Der Stil streut keine Einzelbüsche mehr (G1, nur Fundament und Unterholz der Baumgruppen), und
    // die Pfostenköpfe des Straßenzauns sind spawnfähig – dort setzt der Modus Laternen statt Leuchtbüschen. Die
    // Leuchtbüsche prüft der Test deshalb mit dem Bewuchs von vorher (Einzelbüsche 0,15, gestreute Bäume) und ohne
    // Straßenzaun, Torlaternen-Regel und Wegmündung.
    const v = HOMESTEAD.vegetation!;
    const { groups: _groups, ...scatteredTrees } = v.trees!;
    const bushy: TerrainStyleDef = {
      ...HOMESTEAD, fences: { postEvery: 4 }, lighting: { ...HOMESTEAD.lighting, entry: false },
      vegetation: { ...v, trees: scatteredTrees, bushes: { ...v.bushes!, density: 0.15 } },
    };
    const paths = homestead('paths', 3, bushy).res.features!.lighting!;
    const safe = homestead('spawnproof', 3, bushy).res.features!.lighting!;
    expect(paths.lamps).toBeGreaterThan(0);
    expect(safe.dark).toBe(0);
    expect(safe.lamps + safe.leafLights).toBeGreaterThan(paths.lamps);
    expect(safe.leafLights).toBeGreaterThan(0);
    const { res } = homestead('paths');
    const posts = res.cells.filter((c) => c.role === 'light_outdoor').map((c) => [c.pos[0], c.pos[2]] as const);
    for (const [x, z] of posts) expect(res.paths.has(x, z), `Laterne auf Weg ${x},${z}`).toBe(false);
  });
});

describe('Einzelne Bausteine an einem freien Grundstück', () => {
  const base: TerrainStyleDef = { ...TEST_STYLE, vegetation: {} };

  it('Wegprofil: Grasnarbe, Rinne (Stufe unten) und Trittsteine je Rang', () => {
    const s = fullSite();
    const style: TerrainStyleDef = { ...base, paths: { profile: { main: 5, side: 3, median: true, gutter: true, stepping: true } } };
    const r = generateSite(s.state, style, syntheticBuilding());
    const gutter = r.cells.filter((c) => c.role === 'path_gutter');
    expect(gutter.length).toBeGreaterThan(3);
    for (const c of gutter) expect(c).toMatchObject({ shape: 'slab', orient: { half: 'bottom' } });
    // Grasnarbe: Wegzellen mit Gras (Nebenweg 3 breit)
    expect([...r.paths].some(([x, z]) => r.surface[r.grid.idx(x, z)] === 'ground_grass')).toBe(true);
    expect(r.cells.some((c) => c.role === 'path_stone')).toBe(true); // Pfad zum Teich
    expect(r.plan.path.some((v) => v === 3)).toBe(true);
  });

  it('Zonenrand: Hecke statt Zaun, offenes Feld ohne Ring; Rand nur für umrandbare Zonen', () => {
    const s = fullSite();
    s.setZoneEdge('z1', 'hedge');
    expect(() => s.setZoneEdge('z3', 'fence')).toThrow(/hat keinen Rand/);
    const r = generateSite(s.state, base, syntheticBuilding());
    const f = r.fields[0]!;
    expect(f.hedge!.length).toBeGreaterThan(30);
    expect(f.gate).toBeDefined();
    const s2 = fullSite();
    s2.setZoneEdge('z1', 'none');
    const r2 = generateSite(s2.state, base, syntheticBuilding());
    expect(r2.cells.some((c) => c.role === 'fence_outdoor' && s2.zone('z1').cells.has(c.pos[0], c.pos[2]))).toBe(false);
    // ohne Zaun: Wasser nur eingefasst (alle 4 Nachbarn im Feld)
    const zone = s2.zone('z1').cells;
    for (const [x, z] of r2.fields[0]!.water) expect(N4.every(([dx, dz]) => zone.has(x + dx, z + dz))).toBe(true);
  });

  it('Platz (G2): Brunnen in der Mitte, Laternen an den Ecken, Ringmuster; kleiner Platz mit Laterne', () => {
    const s = Site.create({ id: 'p', projectId: 'p', seed: 2, styleId: 'test', plot });
    s.paintZone('plaza', CellSet.rect(-18, -18, -8, -8));
    s.paintZone('plaza', CellSet.rect(14, -18, 18, -14));
    const r = generateSite(s.state, base, syntheticBuilding());
    expect(r.warnings).toEqual([]);
    expect(r.features!.wells).toEqual([[-13, r.top[r.grid.idx(-13, -13)]!, -13]]);
    const cells = cellMap(r);
    for (const [x, z] of [[-18, -18], [-8, -18], [-18, -8], [-8, -8]] as const) {
      expect(cells.get(key3([x, r.top[r.grid.idx(x, z)]! + 3, z]))?.role, `Ecke ${x},${z}`).toBe('light_outdoor');
    }
    expect(r.surface[r.grid.idx(-10, -13)]).toBe('plaza_accent');
    const small = cells.get(key3([16, r.top[r.grid.idx(16, -16)]! + 3, -16]));
    expect(small?.role).toBe('light_outdoor');
  });

  it('Gemalter Weg (Zone path): angeschlossen, Weg-Oberfläche, in der Plan-Karte', () => {
    const s = Site.create({ id: 'w', projectId: 'p', seed: 2, styleId: 'test', plot });
    const stroke = [...Array(10).keys()].reduce((acc, k) => acc.union(brushCells([-14 + k, 18], 1)), CellSet.empty());
    s.paintZone('path', stroke);
    const r = generateSite(s.state, base, syntheticBuilding());
    expect(r.warnings).toEqual([]);
    for (const [x, z] of stroke) {
      const i = r.grid.at(x, z);
      if (i < 0) continue;
      expect(r.paths.has(x, z), `${x},${z}`).toBe(true);
      expect(r.surface[i]).toBe('ground_path');
      expect(r.plan.zone[i]).toBe('z1');
      expect(r.plan.path[i]).toBeGreaterThanOrEqual(1);
    }
    expect(walkFrom(r, r.doorExits[0]!).has('-14,18')).toBe(true);
    expect(brushCells([0, 0], 1.5).size).toBe(9);
    expect(brushCells([0, 0], 2).size).toBe(13);
  });

  it('Glätten und Vegetationsdichte als Site-Befehle', () => {
    const s = Site.create({ id: 'g', projectId: 'p', seed: 7, styleId: 'hills', plot: { minX: 0, minZ: 0, maxX: 39, maxZ: 39 } });
    const hills = styles.get('hills')!;
    const area = CellSet.rect(5, 5, 34, 34);
    const rough = generateSite(s.state, hills);
    s.smooth(area);
    s.smooth(area);
    expect(s.state.sculpt.get('10,10')).toEqual({ delta: 0, smooth: true });
    const smooth = generateSite(s.state, hills);
    const bumpiness = (r: SiteResult): number => {
      let sum = 0;
      for (const [x, z] of area) for (const [dx, dz] of N4) sum += Math.abs(r.top[r.grid.idx(x, z)]! - r.top[r.grid.idx(x + dx, z + dz)]!);
      return sum;
    };
    expect(bumpiness(smooth)).toBeLessThan(bumpiness(rough));
    s.resetTerrain(area);
    expect(s.state.sculpt.size).toBe(0);
    s.setVegetation({ trees: 0, bushes: 0, ground: 0 });
    const bare = generateSite(s.state, hills);
    expect([bare.trees.length, bare.bushes, bare.groundPlants]).toEqual([0, 0, 0]);
    s.setVegetation({ trees: 2, bushes: 2, ground: 2 });
    const dense = generateSite(s.state, hills);
    expect(dense.groundPlants).toBeGreaterThan(rough.groundPlants);
    expect(() => s.setVegetation({ trees: 3, bushes: 1, ground: 1 })).toThrow(/Vegetationsdichte/);
    expect(s.setVegetation({ trees: 2, bushes: 2, ground: 2 })).toEqual([]);
  });

  it('W4-D Bodenpflanzen-Regler: höhere Dichte ergibt nie weniger Pflanzen (alle Stile, Stufen 0 … 2)', () => {
    // Vorher sättigte der Regler (Stil-Dichte × Faktor ≤ 1, Wiese 0,95) und die geänderte Zufallsfolge kippte
    // benachbarte Stufen (Wiese Seed 3: 759 bei 1, 727 bei 1,5 und 2; Wald Seed 1: 569 bei 1,5, 544 bei 2).
    const steps = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
    for (const [id, style] of styles) {
      for (const seed of [1, 3]) {
        const counts = steps.map((ground) => {
          const s = Site.create({ id: 's', projectId: 'p', seed, styleId: id, plot });
          if (ground !== 1) s.setVegetation({ trees: 1, bushes: 1, ground });
          return generateSite(s.state, style, syntheticBuilding()).groundPlants;
        });
        for (let k = 1; k < steps.length; k++) expect(counts[k], `${id} Seed ${seed}: ${counts.join(' ')}`).toBeGreaterThanOrEqual(counts[k - 1]!);
        // Die Stufen über dem Stil wirken deutlich (nicht nur ein paar Pflanzen Rauschen)
        expect(counts.at(-1)!, `${id} Seed ${seed}`).toBeGreaterThan(counts[4]! * 1.3);
        expect(counts[2]!, `${id} Seed ${seed}`).toBeLessThan(counts[4]! * 0.8);
      }
    }
    // Faktor 1 als Event = ohne Event (Stil), bitgleich
    const a = Site.create({ id: 's', projectId: 'p', seed: 3, styleId: 'meadow', plot });
    const b = Site.create({ id: 's', projectId: 'p', seed: 3, styleId: 'meadow', plot });
    b.setVegetation({ trees: 1, bushes: 1, ground: 1 });
    expect(generateSite(b.state, styles.get('meadow')!, syntheticBuilding()).cells).toEqual(generateSite(a.state, styles.get('meadow')!, syntheticBuilding()).cells);
  });

  it('W7-I Baum- und Buschregler: höhere Dichte ergibt nie weniger (alle Stile, Stufen 0 … 2)', () => {
    // Vorher (Stil-Dichte × Faktor ≤ 1, neue Zufallsfolge je Stufe) sättigten die Regler (Wiese: Bäume 1 = 1,25 = 2) und
    // kippten (Wald Seed 2: 72 Bäume bei 0,75, 69 bei 1; Busch-Zellen in 22 von 30 Reihen fallend).
    const steps = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
    const count = (id: string, seed: number, kind: 'trees' | 'bushes', f: number): number => {
      const s = Site.create({ id: 's', projectId: 'p', seed, styleId: id, plot });
      if (f !== 1) s.setVegetation({ trees: kind === 'trees' ? f : 1, bushes: kind === 'bushes' ? f : 1, ground: 1 });
      const r = generateSite(s.state, styles.get(id)!, syntheticBuilding());
      return kind === 'trees' ? r.trees.length : r.cells.filter((c) => c.role === 'leaves_bush').length;
    };
    for (const kind of ['trees', 'bushes'] as const) {
      for (const id of styles.keys()) {
        for (const seed of [1, 3]) {
          const counts = steps.map((f) => count(id, seed, kind, f));
          for (let k = 1; k < steps.length; k++) expect(counts[k], `${kind} ${id} Seed ${seed}: ${counts.join(' ')}`).toBeGreaterThanOrEqual(counts[k - 1]!);
          // die Stufen wirken: 2 über dem Stil, 0,5 unter dem Stil (wo der Stil etwas setzt und Platz ist)
          if (counts[4]! > 0 && id !== 'forest') expect(counts.at(-1)!, `${kind} ${id} Seed ${seed}: ${counts.join(' ')}`).toBeGreaterThan(counts[4]!);
          expect(counts[0]!, `${kind} ${id} Seed ${seed}: ${counts.join(' ')}`).toBeLessThanOrEqual(counts[2]!);
        }
      }
    }
  });

  it('Ausstattung am Haus meidet Fenster, Türen und Wege; Fässer/Kübel/Holz nie direkt vor der Tür', () => {
    const { res } = homestead();
    const decorRoles = new Set(['woodpile', 'barrel_outdoor', 'planter', 'beehive', 'leaves_fruit']);
    for (const c of res.cells) {
      if (!decorRoles.has(c.role)) continue;
      expect(cheb([c.pos[0], c.pos[2]], [5, 9]), `${c.role}@${c.pos}`).toBeGreaterThanOrEqual(3);
      expect(res.paths.has(c.pos[0], c.pos[2])).toBe(false);
    }
    // Fenster in der Ostwand bei (10, 4): davor und daneben keine Holzstapel/Spaliere
    for (const c of res.cells) if (c.role === 'woodpile' || c.role === 'leaves_fruit') expect(c.pos[0] === 11 && Math.abs(c.pos[2] - 4) <= 1, `${c.role}@${c.pos}`).toBe(false);
  });
});
