/**
 * Varianz nach research/12: Kontext (4a), Flächen-Muster (4b), Verlauf/Mischung/Cluster-Rauschen (4c),
 * Verwitterung als Variantenwechsel (9a). Hüllen kommen aus dem echten `deriveShell` (Bauplan).
 */
import { Project, TARGET_VERSIONS as PROJECT_VERSIONS, deriveShell, isAtticLight, type Shell, type ShellCell } from '@mcda/blueprint';
import type { FloorRecipe, ResolvedTheme } from '@mcda/catalog';
import { CellSet, cellKey, key3, type Vec3 } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import {
  ThemeResolver, applySurfaces, beamPositions, materialize, shellContext, surfaceRoleShapes, weatheringChance, zoneHit,
  type CellContext, type MaterializeResult, type SurfaceOut,
} from '../src/index.js';
import { THEME_IDS, VERSIONS, platformView, themes } from './fixtures.js';

interface House {
  readonly shell: Shell;
  readonly roomTypes: Record<string, string>;
}

function house(rooms: ReadonlyArray<readonly [CellSet, string]>, height = 3, roof: 'hip' | 'flat' = 'hip'): House {
  const p = Project.create({ id: 'v', name: 'V', seed: 5, themeId: 'medieval', targetVersion: PROJECT_VERSIONS['26.3'], floor: { y0: 0, height } });
  for (const [cells, type] of rooms) p.paintRoom(0, cells, type);
  const shell = deriveShell(p.state, { roof });
  return { shell, roomTypes: Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])) };
}

/** L-förmiger Raum: 10 × 5 oben, 5 × 5 darunter. */
const L_ROOM = CellSet.rect(0, 0, 9, 4).union(CellSet.rect(0, 5, 4, 9));

function surfaces(h: House, theme: ResolvedTheme = themes.get('medieval')): Array<{ cell: ShellCell; ctx: CellContext; out: SurfaceOut | undefined }> {
  const ctx = shellContext(h.shell, h.roomTypes);
  return h.shell.cells.map((cell, i) => ({ cell, ctx: ctx[i]!, out: applySurfaces(theme, cell, ctx[i]!) }));
}

/**
 * W2 (26.09.2026, Baustandard I1): medieval verwittert Wände mit Raum dahinter nicht mehr (`interiorFaces: false`). Die
 * Tests der Moos-Mechanik (Lage, Randzone) brauchen die Außenwand als Fläche – `interiorFaces` schaltet sie zu.
 */
const withInteriorFaces = (id: string): ResolvedTheme => {
  const t = themes.get(id);
  return t.decor.weathering === undefined ? t : { ...t, decor: { ...t.decor, weathering: { ...t.decor.weathering, interiorFaces: true } } };
};
const run = (h: House, opts: { theme?: string; version?: string; seed?: number; weathering?: false | { age?: number; fade?: number }; interiorFaces?: boolean } = {}): MaterializeResult =>
  materialize({
    shell: h.shell, placements: [], theme: opts.interiorFaces === true ? withInteriorFaces(opts.theme ?? 'medieval') : themes.get(opts.theme ?? 'medieval'), platform: platformView(opts.version ?? '26.3'),
    seed: opts.seed ?? 11, roomTypes: h.roomTypes,
    ...(opts.weathering !== undefined ? { options: { weathering: opts.weathering } } : {}),
  });

const dump = (r: MaterializeResult): string[] => [...r.volume.cells()].map((c) => `${key3(c.pos)}=${c.state.name}${JSON.stringify(c.state.properties)}`);

describe('4a Kontext aus der Hülle', () => {
  const h = house([[L_ROOM, 'bedroom']]);
  const all = surfaces(h);

  it('Wand: hRel/H und t_wand; Boden: Chebyshev-Wandabstand, Randring schließt sich an der einspringenden Ecke', () => {
    const walls = all.filter((x) => x.cell.kind === 'wall');
    expect(new Set(walls.map((x) => x.ctx.hRel))).toEqual(new Set([0, 1, 2]));
    for (const w of walls) {
      expect(w.ctx.H).toBe(3);
      expect(w.ctx.t.wall_h).toBeCloseTo(w.ctx.hRel / 2, 10);
      expect(w.ctx.wallAxis).toBeDefined(); // gerade Wand hat eine Laufrichtung
    }
    const floor = all.filter((x) => x.cell.kind === 'floor');
    const ring = floor.filter((x) => x.ctx.wallDist === 1);
    // 6 Ecken: 5 konvexe + 1 einspringende (nur diagonal an der Wand)
    expect(ring.filter((x) => x.ctx.corner)).toHaveLength(6);
    const inside = new Set(floor.filter((x) => x.ctx.wallDist > 0).map((x) => cellKey(x.ctx.x, x.ctx.z)));
    for (const r of ring.filter((x) => !x.ctx.corner)) {
      const { x, z } = r.ctx;
      const wallEW = !inside.has(cellKey(x + 1, z)) || !inside.has(cellKey(x - 1, z));
      expect(r.ctx.wallAxis, `${x},${z}`).toBe(wallEW ? 'z' : 'x'); // parallel zur angrenzenden Wand
    }
    // Ring ist zusammenhängend (8er-Nachbarschaft): jede Ringzelle hat ≥ 2 Ring-Nachbarn
    const ringSet = new Set(ring.map((x) => cellKey(x.ctx.x, x.ctx.z)));
    for (const r of ring) {
      let n = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) if (ringSet.has(cellKey(r.ctx.x + dx, r.ctx.z + dz))) n++;
      expect(n, `${r.ctx.x},${r.ctx.z}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('Dach: roof_t von 0 (Traufe) bis 1 (First); Decke über Wänden hat Wandabstand 0', () => {
    const roof = all.filter((x) => x.cell.kind === 'roof').map((x) => x.ctx.t.roof_t!);
    expect(Math.min(...roof)).toBe(0);
    expect(Math.max(...roof)).toBe(1);
    const plate = all.filter((x) => x.cell.kind === 'ceiling' && x.ctx.wallDist === 0);
    expect(plate.length).toBeGreaterThan(20);
  });

  it('ist unabhängig von der Zellreihenfolge', () => {
    const rev: Shell = { ...h.shell, cells: [...h.shell.cells].reverse() };
    const a = shellContext(h.shell, h.roomTypes);
    const b = shellContext(rev, h.roomTypes).reverse();
    expect(b).toEqual(a);
  });
});

describe('4b Flächen-Muster', () => {
  it('Bordüre im L-Raum: Stamm parallel zur Wand, Ecken Holz, Innenfläche Dielen, Wandfuß Fundament, Schwellen Bordüre', () => {
    const all = surfaces(house([[L_ROOM, 'bedroom']])).filter((x) => x.cell.kind === 'floor');
    for (const { ctx, out } of all) {
      const at = `${ctx.x},${ctx.z}`;
      if (ctx.wallDist === 0) {
        if (ctx.door) expect(out, at).toEqual({ role: 'floor_border', shape: 'log', axis: ctx.wallAxis });
        else expect(out, at).toEqual({ role: 'foundation', shape: 'block' });
      } else if (ctx.wallDist === 1) {
        expect(out, at).toEqual(ctx.corner ? { role: 'floor_border', shape: 'wood' } : { role: 'floor_border', shape: 'log', axis: ctx.wallAxis });
      } else {
        expect(out, at).toEqual({ role: 'floor_primary', shape: 'block' });
      }
    }
    expect(all.some((x) => x.ctx.door)).toBe(true);
  });

  // W4 (27.09.2026, Review M7): Lehm nur noch in Stall, Scheune, Keller und im Keller-Lager; das Lager im EG hat Dielen
  it('Raumtypen: Küche Steinboden, Stall Lehmboden, Lager Dielen, Kapelle Schachbrett, Bibliothek Fischgrät', () => {
    const room = CellSet.rect(0, 0, 8, 6); // Innenfläche 7 × 5
    const inner = (type: string) => surfaces(house([[room, type]])).filter((x) => x.cell.kind === 'floor' && x.ctx.wallDist > 0);
    expect(new Set(inner('kitchen').map((x) => x.out?.role))).toEqual(new Set(['floor_stone']));
    expect(new Set(inner('stable').map((x) => x.out?.role))).toEqual(new Set(['floor_earth']));
    expect(new Set(inner('storage').map((x) => x.out?.role))).toEqual(new Set(['floor_border', 'floor_primary']));
    for (const { ctx, out } of inner('chapel')) {
      expect(out?.role).toBe((ctx.u + ctx.v) % 2 === 1 ? 'floor_tile_dark' : 'floor_tile_light');
    }
    for (const { ctx, out } of inner('library').filter((x) => x.ctx.wallDist >= 2)) {
      const f = ctx.frame!;
      const along = (((ctx.u - ctx.v) % 4) + 4) % 4 < 2;
      expect(out).toEqual({ role: 'floor_strip', shape: 'log', axis: along ? f.uAxis : f.vAxis });
    }
  });

  it('Halle: Doppelbordüre + Läufer von der Haupttür (Teppich AUF dem Boden, Rand in der Akzentfarbe)', () => {
    const all = surfaces(house([[CellSet.rect(0, 0, 12, 10), 'hall']])).filter((x) => x.cell.kind === 'floor' && x.ctx.wallDist > 0);
    expect(new Set(all.filter((x) => x.ctx.wallDist === 1).map((x) => x.out?.role))).toEqual(new Set(['floor_border']));
    expect(new Set(all.filter((x) => x.ctx.wallDist === 2).map((x) => x.out?.role))).toEqual(new Set(['floor_strip']));
    // W2 (26.09.2026, Regel I3): der Läufer ist ein Teppich über der Bodenplatte (`carpet`), die Platte behält die
    // Grundrolle – der Raum darunter sieht keine Wolle in der Decke
    const runner = all.filter((x) => x.out?.carpet !== undefined).map((x) => ({ ...x, out: { ...x.out!, role: x.out!.carpet!.role } }));
    for (const r of runner) expect(all.find((x) => x.cell === r.cell)?.out?.role).toBe('floor_stone');
    expect(runner.every((r) => r.out.role === 'textile_primary' || r.out.role === 'textile_accent')).toBe(true);
    expect(runner.length).toBeGreaterThan(4);
    expect(runner.every((x) => x.ctx.wallDist >= 3)).toBe(true);
    const door = all[0]!.ctx.frame!.mainDoor!;
    const across = door.toward === 'north' || door.toward === 'south' ? 'x' : 'z';
    const offs = new Set(runner.map((x) => (across === 'x' ? x.ctx.x - door.x : x.ctx.z - door.z)));
    expect([...offs].sort((a, b) => a - b)).toEqual([-1, 0, 1]); // Breite 3 (quer > 8)
    for (const r of runner) {
      const off = across === 'x' ? r.ctx.x - door.x : r.ctx.z - door.z;
      expect(r.out?.role).toBe(off === 0 ? 'textile_primary' : 'textile_accent');
    }
    const rest = all.filter((x) => x.ctx.wallDist >= 3);
    expect(new Set(rest.map((x) => x.out?.role))).toEqual(new Set(['floor_stone']));
  });

  it('Ringe (eigenes Theme): konzentrisch um die Mitte, Mitte im Muster', () => {
    const t = themes.get('medieval');
    const custom: ResolvedTheme = { ...t, surfaces: { ...t.surfaces, floor: [{ pattern: { type: 'rings', period: 2, role: 'floor_border', shape: 'wood' } }] } };
    const all = surfaces(house([[CellSet.rect(0, 0, 8, 8), 'bedroom']]), custom).filter((x) => x.cell.kind === 'floor' && x.ctx.wallDist > 0);
    const grid = new Map(all.map((x) => [cellKey(x.ctx.u, x.ctx.v), x.out?.role === 'floor_border' ? '#' : '.']));
    const rows = [...Array(7).keys()].map((v) => [...Array(7).keys()].map((u) => grid.get(cellKey(u, v))).join(''));
    // 7 × 7: Ringe 3, 2, 1, 0 von außen; Periode 2 → Ring 2 und die Mitte (Ring 0)
    expect(rows).toEqual(['.......', '.#####.', '.#...#.', '.#.#.#.', '.#...#.', '.#####.', '.......']);
  });

  it('Balkendecke: Achsen möglichst symmetrisch, Balken quer zur kurzen Spannweite, Rähm über den Wänden', () => {
    expect(beamPositions(7, 3)).toEqual([3]);
    expect(beamPositions(9, 3)).toEqual([2, 6]);
    expect(beamPositions(11, 3)).toEqual([2, 5, 8]);
    expect(beamPositions(3, 3)).toEqual([1]); // Abstand 2 statt 3, dafür mittig
    expect(beamPositions(2, 3)).toEqual([]);
    for (let len = 3; len <= 20; len++) {
      const b = beamPositions(len, 3);
      expect(b.length, `len ${len}`).toBeGreaterThan(0);
      expect(b.every((u) => u >= 0 && u < len)).toBe(true);
      for (let i = 1; i < b.length; i++) expect(b[i]! - b[i - 1]!).toBeGreaterThanOrEqual(2);
    }
    // W4 (27.09.2026): ohne die Laternen des Dachraum-Lichts (`kind: 'ceiling'`, keine Flächen-Regel)
    const all = surfaces(house([[CellSet.rect(0, 0, 10, 6), 'bedroom']])).filter((x) => x.cell.kind === 'ceiling' && !isAtticLight(x.cell));
    for (const { ctx, out } of all) {
      if (ctx.wallDist === 0) {
        // W2 (26.09.2026): Regel W6 – der Rähm gilt nur innen; über Außenwänden läuft die Außenhaut (Stein) bis unters Dach
        if (ctx.exterior) expect(out).toEqual(ctx.wallAxis !== undefined ? { role: 'wall_primary', shape: 'block', axis: ctx.wallAxis } : { role: 'wall_primary', shape: 'block' });
        else expect(out).toEqual(ctx.wallAxis !== undefined ? { role: 'beam', shape: 'log', axis: ctx.wallAxis } : { role: 'beam', shape: 'wood' });
        continue;
      }
      const f = ctx.frame!;
      expect(f.uAxis).toBe('x'); // Innenfläche 9 × 5: lange Achse x
      const onBeam = beamPositions(f.uLen, 3).includes(ctx.u);
      expect(out).toEqual(onBeam ? { role: 'beam', shape: 'log', axis: 'z' } : { role: 'ceiling', shape: 'block' });
    }
  });

  it('Wände: außen Steinverlauf, innen Vertäfelung unten + Putz; ab lichter Höhe 5 Fachwerk-Putz über 2 Steinreihen', () => {
    const two = house([[CellSet.rect(0, 0, 6, 6), 'bedroom'], [CellSet.rect(7, 0, 13, 6), 'kitchen']]);
    for (const { cell, ctx, out } of surfaces(two).filter((x) => x.cell.kind === 'wall')) {
      if (ctx.exterior) expect(out, key3(cell.pos)).toBeUndefined();
      else expect(out?.role, key3(cell.pos)).toBe(ctx.hRel === 0 ? 'wall_wainscot' : 'wall_secondary');
    }
    const tall = house([[CellSet.rect(0, 0, 6, 6), 'bedroom']], 5);
    for (const { ctx, out } of surfaces(tall).filter((x) => x.cell.kind === 'wall')) {
      expect(out?.role).toBe(ctx.hRel >= 2 ? 'wall_secondary' : undefined);
    }
  });

  it('nordic: Blockbau – Wände als liegende Stämme, außen Sockel und Schwelle (W12-D); Flächen lassen sich abschalten', () => {
    const two = house([[CellSet.rect(0, 0, 6, 6), 'bedroom'], [CellSet.rect(7, 0, 13, 6), 'kitchen']]);
    const walls = surfaces(two, themes.get('nordic')).filter((x) => x.cell.kind === 'wall');
    // W12-D (2026-09-28): vorher keine Wandregel (Bretter überall). Jetzt: jede Wandzelle bekommt eine Regel; außen die
    // unterste Reihe Stein (`foundation`), die zweite der Schwellbalken (`beam`), sonst `wall_primary` als Stamm
    // entlang der Wand bzw. Eckholz an Spalten ohne Laufrichtung
    expect(walls.every((x) => x.out !== undefined)).toBe(true);
    expect(new Set(walls.map((x) => x.out!.role))).toEqual(new Set(['foundation', 'beam', 'wall_primary']));
    for (const x of walls) if (x.out!.role === 'wall_primary') expect(['log', 'wood']).toContain(x.out!.shape);
    const off = materialize({ shell: two.shell, placements: [], theme: themes.get('medieval'), platform: platformView('26.3'), seed: 1, roomTypes: two.roomTypes, options: { surfaces: false } });
    expect([...off.volume.cells()].some((c) => c.state.name === 'dark_oak_log' && c.pos[1] === 0)).toBe(false); // keine Bordüre
  });
});

describe('4c Material: Verlauf, Mischung, Cluster-Rauschen', () => {
  const { registry, families } = platformView('26.3');
  const t = themes.get('medieval');
  const resolver = new ThemeResolver(t, families, registry);
  const at = (a: number, b: number) => ({ seed: 77, plane: 3, a, b });

  it('Gewichtstreue: Steinboden P7 auf 128 × 128 innerhalb ± 3 %-Punkte', () => {
    const counts = new Map<string, number>();
    const n = 128;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const blk = resolver.resolve('floor_stone', 'block', { mixSeed: 0, at: at(a, b) }).block;
      counts.set(blk, (counts.get(blk) ?? 0) + 1);
    }
    const want: Record<string, number> = { smooth_stone: 5, polished_andesite: 25, stone: 10, stone_bricks: 30, cobblestone: 25, tuff: 5 };
    for (const [b, w] of Object.entries(want)) expect(Math.abs((counts.get(b) ?? 0) / (n * n) - w / 100), b).toBeLessThan(0.03);
  });

  it('Cluster: gleiche Nachbarn deutlich häufiger als bei weißer Wahl derselben Mischung', () => {
    const white: ResolvedTheme = { ...t, roles: { ...t.roles, floor_stone: { ...t.roles['floor_stone']!, noise: { type: 'white' } } } };
    const rWhite = new ThemeResolver(white, families, registry);
    const same = (r: ThemeResolver): number => {
      const n = 64;
      const g = (a: number, b: number) => r.resolve('floor_stone', 'block', { mixSeed: a * 1000 + b, at: at(a, b) }).block;
      let s = 0;
      let pairs = 0;
      for (let a = 0; a < n - 1; a++) for (let b = 0; b < n - 1; b++) {
        pairs += 2;
        if (g(a, b) === g(a + 1, b)) s++;
        if (g(a, b) === g(a, b + 1)) s++;
      }
      return s / pairs;
    };
    const w = same(rWhite);
    const c = same(resolver);
    expect(w).toBeLessThan(0.3); // Σ p² ≈ 0,235
    expect(c).toBeGreaterThan(w + 0.2);
  });

  it('Verlauf-Monotonie: Burgmauer P1 wird über die Fassade (facade_h) von unten nach oben ruhiger (256 × 8)', () => {
    // W2 (26.09.2026): Regeln W4/W5 – drei Grundblöcke, Bruchstein nur am Fuß des Gebäudes, Andesit hellt nach oben auf
    const H = 8;
    const rough: number[] = [];
    const light: number[] = [];
    for (let y = 0; y < H; y++) {
      let r = 0;
      let l = 0;
      for (let a = 0; a < 256; a++) {
        const b = resolver.resolve('wall_primary', 'block', { mixSeed: 0, at: at(a, y), t: { facade_h: y / (H - 1) } }).block;
        // W9-G5 (27.09.2026): vierter Grundblock Bruch-Tiefenschiefer – dunkler, rauer Fuß (Review R5 G5)
        expect(['andesite', 'stone_bricks', 'cobblestone', 'cobbled_deepslate'], b).toContain(b);
        if (b === 'cobblestone' || b === 'cobbled_deepslate') r++;
        if (b === 'andesite') l++;
      }
      rough.push(r / 256);
      light.push(l / 256);
    }
    for (let y = 1; y < H; y++) expect(rough[y]!, `Reihe ${y}`).toBeLessThanOrEqual(rough[y - 1]! + 0.05);
    expect(rough[0]!).toBeGreaterThan(0.3);
    expect(rough[H - 1]!).toBeLessThan(0.03); // nur der Jitter der Übergangszone
    expect(light[H - 1]!).toBeGreaterThan(light[0]!);
  });

  it('Dach P9 als Deckungsrezept (D1): ganze Ringe – je Reihe ein Material, Fliesen tragen, Ziegel, am First Bruch-Tiefenschiefer', () => {
    // W9-G5 (27.09.2026, Review R5 G5): drei Töne in ganzen Ringen – Fliesen, Ziegel, am First Bruch-Tiefenschiefer –
    // und 6 % Flecken des Nachbartons (`gradient.patch`); D1: Materialwechsel in derselben Reihe < 10 %
    const inRow = (rt: number, b = 0): Map<string, number> => {
      const s = new Map<string, number>();
      for (let a = 0; a < 400; a++) {
        const block = resolver.resolve('roof_main', 'stairs', { mixSeed: a, at: at(a, b), t: { roof_t: rt } }).block;
        s.set(block, (s.get(block) ?? 0) + 1);
      }
      return s;
    };
    const main = (m: Map<string, number>): string => [...m].sort((x, y) => y[1] - x[1])[0]![0];
    let off = 0;
    for (const rt of [0, 0.2, 0.5, 0.7, 0.8, 1]) {
      for (const b of [0, 5, 11]) {
        const m = inRow(rt, b);
        expect(m.size, `roof_t ${rt}`).toBeLessThanOrEqual(2);
        off += 400 - Math.max(...m.values());
      }
    }
    expect(off / (6 * 3 * 400)).toBeLessThan(0.1);
    expect(off / (6 * 3 * 400)).toBeGreaterThan(0.02);
    expect(main(inRow(0))).toBe('deepslate_tile_stairs');
    expect(main(inRow(0.7))).toBe('deepslate_brick_stairs');
    expect(main(inRow(1))).toBe('cobbled_deepslate_stairs');
    // Flecken nehmen den Nachbarton der Tonreihe: Fliesen → Ziegel, Bruch-Tiefenschiefer (letzter) → Ziegel
    expect([...inRow(0).keys()].sort()).toEqual(['deepslate_brick_stairs', 'deepslate_tile_stairs']);
    expect([...inRow(1).keys()].sort()).toEqual(['cobbled_deepslate_stairs', 'deepslate_brick_stairs']);
    // ohne Ort (Komponenten) keine Flecken: ganze Ringe wie bisher
    expect(resolver.resolve('roof_main', 'stairs', { mixSeed: 1, t: { roof_t: 0 } }).block).toBe('deepslate_tile_stairs');
  });

  it('Determinismus: gleiche Eingabe → gleiches Volumen; Zellreihenfolge egal; anderer Seed → andere Wände', () => {
    const h = house([[L_ROOM, 'bedroom'], [CellSet.rect(10, 0, 16, 9), 'kitchen']]);
    const a = run(h);
    expect(dump(run(h))).toEqual(dump(a));
    const shuffled: House = { ...h, shell: { ...h.shell, cells: [...h.shell.cells].reverse() } };
    expect(dump(run(shuffled)).sort()).toEqual(dump(a).sort());
    expect(dump(run(h, { seed: 12 }))).not.toEqual(dump(a));
  });

  it('Wände sind nicht homogen: mehrere Blöcke je Wandfläche, Nachbarn in Clustern', () => {
    const h = house([[CellSet.rect(0, 0, 20, 8), 'bedroom']], 4);
    const r = run(h, { weathering: false });
    const ext = h.shell.cells.filter((c) => c.kind === 'wall' && c.exterior === true).map((c) => r.volume.stateAt(c.pos).name);
    const kinds = new Map<string, number>();
    for (const n of ext) kinds.set(n, (kinds.get(n) ?? 0) + 1);
    // W2 (26.09.2026): Regel W4 – höchstens vier Grundblöcke je Wandfläche, aber keine einfarbige Wand
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    expect(kinds.size).toBeLessThanOrEqual(4);
    expect(Math.max(...kinds.values()) / ext.length).toBeLessThan(0.9);
  });
});

describe('Alle Flächen-Rollen × Formen lösen in jedem Theme und jeder Zielversion zu gültigen States auf', () => {
  for (const version of VERSIONS) {
    for (const themeId of THEME_IDS) {
      it(`${themeId} / ${version}`, () => {
        const { registry, families } = platformView(version);
        const theme = themes.get(themeId);
        const r = new ThemeResolver(theme, families, registry);
        const problems: string[] = [];
        for (const [role, shapes] of surfaceRoleShapes(theme)) {
          for (const shape of shapes) {
            for (const tv of [0, 0.3, 0.5, 0.8, 1]) {
              for (let s = 0; s < 12; s++) {
                try {
                  const b = r.resolve(role, shape, { mixSeed: s, at: { seed: s, plane: 1, a: s * 3, b: s }, t: { wall_h: tv, roof_t: tv, floor_d: tv, path_d: tv, building_h: tv } }).block;
                  const def = registry.defaultState(b);
                  if (def === undefined || !registry.isValidState(def.name, def.properties, { complete: true })) problems.push(`${role}.${shape} → ${b}`);
                } catch (e) {
                  problems.push((e as Error).message);
                }
              }
            }
          }
        }
        expect(problems).toEqual([]);
      });
    }
  }
});

describe('9a Verwitterung/Bewuchs (nur Variantenwechsel)', () => {
  const h = house([[CellSet.rect(0, 0, 14, 8), 'kitchen'], [CellSet.rect(0, 9, 14, 14), 'bedroom']]);

  it('Invarianten: gleiche Belegung, gleiche Blockart und Physik-Klasse; Unterschiede nur mossy/cracked', () => {
    for (const version of VERSIONS) {
      const off = run(h, { version, weathering: false });
      const on = run(h, { version, weathering: { age: 0.8 } });
      const phys = platformView(version).physics.blocks;
      let changed = 0;
      for (const c of off.volume.cells()) {
        const o = on.volume.stateAt(c.pos);
        if (o.name === c.state.name) continue;
        changed++;
        expect(o.name, key3(c.pos)).toMatch(/^(mossy|cracked)_/);
        // gleiche Familie: mossy_stone_bricks ⊃ stone_brick, mossy_cobblestone_stairs ⊃ cobblestone
        expect(o.name.replace(/^(mossy|cracked)_/, '')).toContain(c.state.name.replace(/_(stairs|slab|wall)$/, '').replace(/s$/, ''));
        expect(phys[o.name]?.cls, o.name).toBe(phys[c.state.name]?.cls);
        expect(o.properties).toEqual(c.state.properties);
      }
      expect([...on.volume.cells()].length).toBe([...off.volume.cells()].length);
      expect(changed, version).toBeGreaterThan(10);
    }
  });

  it('abschaltbar: weathering=false entspricht einem Theme ohne decor', () => {
    const t = themes.get('medieval');
    const noDecor: ResolvedTheme = { ...t, decor: {} };
    const a = materialize({ shell: h.shell, placements: [], theme: noDecor, platform: platformView('26.3'), seed: 11, roomTypes: h.roomTypes });
    expect(dump(run(h, { weathering: false }))).toEqual(dump(a));
    expect(dump(run(h))).not.toEqual(dump(a)); // Standard: Theme-Alter 0,3
  });

  it('Moos sitzt unten: am Wandfuß deutlich mehr als in der obersten Reihe', () => {
    const tall = house([[CellSet.rect(0, 0, 30, 20), 'kitchen']], 6);
    const on = run(tall, { weathering: { age: 1 }, interiorFaces: true });
    const off = run(tall, { weathering: false });
    const mossAt = (pred: (c: ShellCell) => boolean): number => {
      const cells = tall.shell.cells.filter((c) => c.kind === 'wall' && c.exterior === true && pred(c));
      const moss = cells.filter((c) => on.volume.stateAt(c.pos).name.startsWith('mossy_') && !off.volume.stateAt(c.pos).name.startsWith('mossy_'));
      const eligible = cells.filter((c) => ['stone_bricks', 'cobblestone'].includes(off.volume.stateAt(c.pos).name));
      return moss.length / Math.max(1, eligible.length);
    };
    const bottom = mossAt((c) => c.pos[1] === 1);
    const top = mossAt((c) => c.pos[1] === 6);
    expect(bottom).toBeGreaterThan(top + 0.2);
  });

  it('K5: border.minSide hebt die Mindestbreite (Standard 3/5 bleibt unverändert)', () => {
    const h = house([[CellSet.rect(0, 0, 4, 4), 'bedroom']], 3);
    const base = themes.get('medieval');
    const mit = (border: NonNullable<FloorRecipe['border']>): ResolvedTheme => ({ ...base, surfaces: { ...base.surfaces, floor: [{ border }] } });
    // nur der Randring im Raum (wallDist 1), nicht die Türschwelle
    const zaehle = (t: ResolvedTheme): number => surfaces(h, t).filter((x) => x.ctx.wallDist === 1 && x.out?.role === 'floor_border').length;
    // 5×5 innen: Standard (minSide 3) legt einen Randring, minSide 6 lässt ihn weg
    expect(zaehle(mit({ role: 'floor_border' }))).toBeGreaterThan(0);
    expect(zaehle(mit({ role: 'floor_border', minSide: 6 }))).toBe(0);
    // Der zweite Ring folgt seiner eigenen Schwelle (Standard 5)
    expect(zaehle(mit({ role: 'floor_border', inner: { role: 'foundation', minSide: 6 } }))).toBeGreaterThan(0);
  });

  it('Wahrscheinlichkeitsfeld nach research/12 §6.1 (Beispiel „bewohnt“, Sockel außen: Moos 25,5 %)', () => {
    const ctx = { surface: 'floor', wallDist: 0, exterior: true, corner: false, t: {}, hRel: -1 } as unknown as CellContext;
    const p = weatheringChance(ctx, { age: 0.3, moss: 1, cracks: 1, fade: 0, roles: new Set() });
    expect(p.moss).toBeCloseTo(0.255, 10);
    expect(p.cracks).toBeCloseTo(0.024, 10);
  });
});

// ---------------------------------------------------------------- K2 (research/30): Randzone + weiche Verläufe

describe('K2: Randzone der Verwitterung (`weathering.fade`)', () => {
  const h = house([[CellSet.rect(0, 0, 30, 20), 'kitchen']], 6);
  const off = run(h, { weathering: false });

  /** Wandzellen außen, die die Moos-Variante überhaupt annehmen können (Steinziegel/Bruchstein). */
  const eligible = (): ShellCell[] => h.shell.cells.filter((c) =>
    c.kind === 'wall' && c.exterior === true && ['stone_bricks', 'cobblestone'].includes(off.volume.stateAt(c.pos).name));

  const mossOf = (fade: number): { share: number; edge: number } => {
    const on = run(h, { weathering: { age: 1, fade }, interiorFaces: true });
    const cells = eligible();
    const inSet = new Set(cells.map((c) => key3(c.pos)));
    const isMoss = (p: Vec3): boolean => on.volume.stateAt(p).name.startsWith('mossy_');
    let moss = 0;
    let kanten = 0;
    for (const c of cells) {
      if (!isMoss(c.pos)) continue;
      moss++;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const n: Vec3 = [c.pos[0] + dx, c.pos[1] + dy, c.pos[2] + dz];
        if (inSet.has(key3(n)) && !isMoss(n)) kanten++;
      }
    }
    return { share: moss / Math.max(1, cells.length), edge: kanten / Math.max(1, moss) };
  };

  it('fade 0 ist die harte Schwelle, fade > 0 hat drei Zonen', () => {
    const U = [0, 0.01, 0.19, 0.2, 0.21, 0.5, 0.99];
    for (const p of [0.05, 0.2, 0.5]) {
      for (const u of U) expect(zoneHit(u, p, 0, 0.9)).toBe(u < p);
      // unter pIn immer, über pOut nie, dazwischen entscheidet der feine Hash (Dither)
      expect(zoneHit(p * 0.2, p, 1.5, 0.99)).toBe(true);
      expect(zoneHit(Math.min(1, p * 1.75) * 0.999, p, 1.5, 0.01)).toBe(false);
    }
    expect(zoneHit(0.3, 0, 1.5, 0)).toBe(false);
  });

  it('Erwartungswert bleibt p: der Moosanteil ändert sich mit der Randzone nicht (research/29 F4)', () => {
    const hart = mossOf(0);
    const weich = mossOf(1.5);
    expect(weich.share).toBeGreaterThan(hart.share - 0.06);
    expect(weich.share).toBeLessThan(hart.share + 0.06);
  });

  it('der Rand ist ausgefranst: mehr Nachbarschaftswechsel je Mooszelle', () => {
    expect(mossOf(1.5).edge).toBeGreaterThan(mossOf(0).edge * 1.15);
  });
});

describe('Beispiel: materialisierte Hülle mit Mustern ist vollständig gültig', () => {
  for (const version of VERSIONS) {
    for (const themeId of THEME_IDS) {
      it(`${themeId} / ${version}: Halle, Kapelle, Bibliothek, Küche, Lager`, () => {
        const h = house([
          [CellSet.rect(0, 0, 12, 10), 'hall'], [CellSet.rect(13, 0, 19, 6), 'chapel'], [CellSet.rect(13, 7, 19, 10), 'library'],
          [CellSet.rect(0, 11, 9, 16), 'kitchen'], [CellSet.rect(10, 11, 19, 16), 'storage'],
        ], 4);
        const r = run(h, { theme: themeId, version });
        const reg = platformView(version).registry;
        for (const c of r.volume.cells()) {
          if (c.state.name === 'air') continue;
          expect(reg.isValidState(c.state.name, c.state.properties, { complete: true }), `${c.state.name} ${JSON.stringify(c.state.properties)}`).toBe(true);
        }
        expect(r.violations.filter((v) => v.kind !== 'spawn')).toEqual([]);
        // Nur die BODENzellen IM RAUM zählen (nicht die Bodenplatte unter den Wänden): Pfahlgründungen
        // (Themes „tropical“/„harbor“) setzen dort bewusst stehende Stämme, gemeint ist hier aber die
        // Bordüre/Fischgrät als LIEGENDER Stamm.
        const platePos = new Set(h.shell.cells.filter((c) => (c.kind === 'wall' || c.kind === 'pillar') && c.pos[1] === 1).map((c) => `${c.pos[0]},0,${c.pos[2]}`));
        const logs = [...r.volume.cells()].filter((c) => c.pos[1] === 0 && c.state.name.endsWith('_log') && !platePos.has(c.pos.join(',')));
        expect(logs.length).toBeGreaterThan(20); // Bordüren/Fischgrät als liegende Stämme
        expect(logs.every((c) => c.state.properties['axis'] !== 'y')).toBe(true);
        const at = (p: Vec3) => r.volume.stateAt(p).name;
        expect(at([5, 5, 5])).not.toBe('air'); // Decke der Halle (lichte Höhe 4)
      });
    }
  }
});
