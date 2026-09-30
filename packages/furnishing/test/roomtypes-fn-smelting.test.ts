/**
 * FN-Schmelzanlagen (Welle 28.09.2026): Raumtyp `smelting_hall` und die Bausteine `functional/fn_smelt_*`.
 *  - Katalog: Komponenten geladen, Tags nur mit Präfix `fn_` (kein Einfluss auf bestehende Raumtypen), Raumtyp erreicht sie.
 *  - Solver: Raumtyp × Größen × lichte Höhe 3/4/5/6 × Seeds → Signatur (Ofenbank) platziert, 0 Warnungen, harte Garantien;
 *    die Anlage wächst mit der Fläche (Öfen je Raum steigen).
 *  - Materialisierung: jede Variante (gedehnt in passender Höhe) in 1.21.11 + 26.3 × Themes ohne Verstöße.
 *  - Mechanik (statisch, Vanilla-Regeln): Trichterketten enden in einem Behälter, jeder Trichter hat eine Quelle, jeder Ofen
 *    hat Eingabe (Trichter darüber), Brennstoff (seitlich) und Ausgabe (Trichter darunter), Truhen haben Luft darüber,
 *    Rahmen hängen an festen Blöcken.
 *  - End-to-End: Einrichtung → Licht-Pass → Materialisierung: 0 Warnungen, 0 Verstöße.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, type RoomShellInfo, type Shell, type ShellCell } from '@mcda/blueprint';
import { CellSet, type Dir, type Vec3 } from '@mcda/core';
import { WorldView, materialize, type MaterializePlacement } from '@mcda/materialize';
import { generate, placedFor } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { RoomPlanner, fitsRoomHeight, furnishRoom, renderAscii, type FurnishResult, type RoomGeometry } from '../src/index.js';
import { DV, assertHardGuarantees, catalog, shellRoom } from './fixtures.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const VERSIONS = ['1.21.11', '26.3'] as const;
const TYPE = 'smelting_hall';

const COMPONENTS = [
  'functional/fn_smelt_bank',
  'functional/fn_smelt_blast_bank',
  'functional/fn_smelt_smoker_bank',
  'functional/fn_smelt_ore_line',
  'functional/fn_smelt_stack',
  'functional/fn_smelt_stock',
  'functional/fn_smelt_ingots',
];
const SIGNATURE_TAGS = ['fn_smelt_bank', 'fn_smelt_blast'];
const FURNACES = new Set(['furnace', 'blast_furnace', 'smoker']);
const CONTAINERS = new Set(['furnace', 'blast_furnace', 'smoker', 'hopper', 'chest', 'barrel']);

const ascii = (g: RoomGeometry, r: FurnishResult): string => renderAscii(g, r.placed, (id) => catalog.get(id).tags);
const furnaceCount = (r: FurnishResult): number =>
  r.placed.reduce((n, p) => n + p.cells.filter((c) => /furnace|smoker/.test(c.mat.block ?? '')).length, 0);

/** Kleinste Außenmaße (fast quadratisch), deren Innenfläche minArea erreicht; dazu mittel, groß und sehr groß. */
function sizes(): (readonly [number, number])[] {
  const rt = catalog.roomType(TYPE);
  const s = Math.ceil(Math.sqrt(rt.minArea));
  return [[s + 2, Math.ceil(rt.minArea / s) + 2], [12, 9], [16, 11], [22, 14]];
}

function assertFurnished(g: RoomGeometry, r: FurnishResult, where: string): void {
  const w = `${where}\n${ascii(g, r)}`;
  expect(r.warnings, w).toEqual([]);
  assertHardGuarantees(g, r, where);
  const tags = new Set(r.placements.flatMap((p) => catalog.get(p.componentId).tags));
  expect(SIGNATURE_TAGS.some((t) => tags.has(t)), `${w}\nOfenbank fehlt`).toBe(true);
}

describe('FN-Schmelzanlagen · Katalog', () => {
  it('alle Bausteine sind geladen, tragen nur fn_-Tags für ihre Funktion und sind über den Raumtyp erreichbar', () => {
    for (const id of COMPONENTS) expect(catalog.find(id), id).toBeDefined();
    expect(catalog.missingTags(TYPE, DV)).toEqual([]);
    const rt = catalog.roomType(TYPE);
    const reachable = new Set([...rt.required, ...rt.optional].flatMap((e) => e.tags));
    for (const id of COMPONENTS) expect(catalog.get(id).tags.some((t) => reachable.has(t)), id).toBe(true);
    for (const id of COMPONENTS) expect(catalog.get(id).tags.filter((t) => t.startsWith('fn_')).length, id).toBeGreaterThan(0);
  });

  it('kein bestehender Raumtyp zieht die neuen Bausteine (kein Einfluss auf den Bestand)', () => {
    const mine = new Set(COMPONENTS.flatMap((id) => catalog.get(id).tags.filter((t) => t.startsWith('fn_'))));
    for (const id of catalog.roomTypeIds()) {
      if (id === TYPE) continue;
      const rt = catalog.roomType(id);
      const pulled = [...rt.required, ...rt.optional].flatMap((e) => e.tags).filter((t) => mine.has(t));
      expect(pulled, id).toEqual([]);
    }
  });

  it('die Bänke skalieren: 2 bis 8 Öfen in Stufen', () => {
    const count = (id: string, v: string): number => {
      const def = catalog.get(id);
      const variant = def.variants!.find((x) => x.id === v)!;
      return (variant.layers ?? []).flat(2).join('').split('').filter((c) => variant.legend?.[c]?.block?.endsWith('furnace') || variant.legend?.[c]?.block?.endsWith('smoker')).length;
    };
    const sizesOf = ['low_2', 'low_4', 'bench_2', 'bench_3', 'bench_4', 'bench_6', 'line_2', 'line_4', 'line_6'].map((v) => count('functional/fn_smelt_bank', v));
    expect(Math.min(...sizesOf)).toBe(2);
    expect(Math.max(...sizesOf)).toBeGreaterThanOrEqual(6);
  });
});

describe('FN-Schmelzanlagen · Raumtyp einrichten (Solver)', () => {
  it('Größen × lichte Höhe 3/4/5/6 × Seeds × Innenwände: Ofenbank, 0 Warnungen, harte Garantien', { timeout: HEAVY_TIMEOUT }, () => {
    for (const [w, d] of sizes()) {
      for (const H of [3, 4, 5, 6]) {
        for (let seed = 0; seed < 4; seed++) {
          const inner = seed === 2 ? (['north'] as const) : seed === 3 ? (['north', 'west', 'east'] as const) : ([] as const);
          const g = shellRoom(w, d, { height: H, windowSpacing: 4, inner });
          expect(g.interior.size).toBeGreaterThanOrEqual(catalog.roomType(TYPE).minArea);
          assertFurnished(g, furnishRoom(g, catalog.roomType(TYPE), catalog, { seed, dataVersion: DV }), `${TYPE} ${w}×${d} H${H} seed ${seed}`);
        }
      }
    }
  });

  it('Determinismus: gleicher Seed → gleiche Platzierungen', () => {
    const g = shellRoom(16, 11, { height: 6, windowSpacing: 4 });
    const a = furnishRoom(g, catalog.roomType(TYPE), catalog, { seed: 5, dataVersion: DV });
    const b = furnishRoom(g, catalog.roomType(TYPE), catalog, { seed: 5, dataVersion: DV });
    expect(a.placements).toEqual(b.placements);
    expect(a.quality).toEqual(b.quality);
  });

  it('die Anlage wächst mit der Fläche: mehr Öfen und mehr fn_-Bausteine in größeren Hallen', () => {
    const stat = (w: number, d: number, H: number): { furnaces: number; parts: number } => {
      let furnaces = 0;
      let parts = 0;
      for (let seed = 0; seed < 4; seed++) {
        const r = furnishRoom(shellRoom(w, d, { height: H, windowSpacing: 4 }), catalog.roomType(TYPE), catalog, { seed, dataVersion: DV });
        furnaces += furnaceCount(r);
        parts += r.placements.filter((p) => catalog.get(p.componentId).tags.some((t) => t.startsWith('fn_'))).length;
      }
      return { furnaces: furnaces / 4, parts: parts / 4 };
    };
    for (const H of [4, 6]) {
      const [s, m, l, xl] = sizes().map(([w, d]) => stat(w, d, H));
      expect(m!.parts, `H${H} M`).toBeGreaterThanOrEqual(s!.parts);
      expect(l!.parts, `H${H} L`).toBeGreaterThan(m!.parts);
      expect(xl!.parts, `H${H} XL`).toBeGreaterThan(l!.parts);
      expect(xl!.furnaces, `H${H} XL Öfen`).toBeGreaterThan(s!.furnaces);
    }
  });
});

// ---------------------------------------------------------------- Materialisierung + Mechanik

/** Synthetische Hülle: Innenraum 14×8 (Platz für die breiteste Anlage), lichte Höhe H, feste Wände, Tür Süd. */
function shellOf(H: number): { shell: Shell; geom: RoomShellInfo } {
  const roomId = 'r1';
  const cells: ShellCell[] = [];
  const W = 15, D = 9, doorX = 7;
  for (let x = 0; x <= W; x++) {
    for (let z = 0; z <= D; z++) {
      cells.push({ pos: [x, 0, z], kind: 'floor', role: 'floor_primary', shape: 'block', roomId });
      cells.push({ pos: [x, H + 1, z], kind: 'ceiling', role: 'ceiling', shape: 'block', roomId, exterior: true });
      const edgeX = x === 0 || x === W, edgeZ = z === 0 || z === D;
      if (!edgeX && !edgeZ) continue;
      for (let y = 1; y <= H; y++) {
        const pos: Vec3 = [x, y, z];
        if (edgeX && edgeZ) cells.push({ pos, kind: 'pillar', role: 'beam', shape: 'log', orient: { axis: 'y' }, roomId, exterior: true });
        else if (z === D && x === doorX && y <= 2) cells.push({ pos, kind: 'door', role: 'door', shape: 'door', orient: { facing: 'south', half: y === 1 ? 'lower' : 'upper', hinge: 'left' }, roomId, exterior: true });
        else cells.push({ pos, kind: 'wall', role: 'wall_primary', shape: 'block', roomId, exterior: true });
      }
    }
  }
  const geom: RoomShellInfo = {
    roomId, floorIndex: 0, baseY: 1, height: H, interior: CellSet.rect(1, 1, W - 1, D - 1),
    doors: [{ inside: [doorX, D - 1], toward: 'south', isMain: true }], windows: [],
  };
  return { shell: { cells, rooms: new Map([[roomId, geom]]), warnings: [] }, geom };
}

const STEP: Readonly<Record<Dir, Vec3>> = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const FACING: Readonly<Record<number, Dir>> = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
const add = (p: Vec3, d: Dir): Vec3 => [p[0] + STEP[d][0], p[1] + STEP[d][1], p[2] + STEP[d][2]];
const HORIZONTAL: readonly Dir[] = ['north', 'east', 'south', 'west'];

/**
 * Vanilla-Mechanik der Schmelzbausteine auf der fertigen Welt (minecraft.wiki: Hopper, Furnace):
 *  - ein Trichter gibt in die Richtung `facing` in einen Behälter ab – dort muss einer liegen;
 *  - ein Trichter zieht aus dem Behälter darüber (auch einem Trichter) und nimmt von Trichtern, die auf ihn zeigen;
 *  - Ofen: Eingabe = Trichter darüber (zeigt ↓), Brennstoff = Trichter seitlich (zeigt in den Ofen), Ausgabe = Trichter darunter;
 *  - eine Truhe braucht eine freie Zelle darüber; die Kette endet in einer Truhe (oder einem Fass, das nie ausgegeben wird).
 */
function assertMechanics(view: WorldView, owner: string, where: string): void {
  const cells = view.volume.cellsOf(owner);
  const nameAt = (p: Vec3): string => view.state(p).name;
  const hopperFacing = (p: Vec3): Dir => view.state(p).properties['facing'] as Dir;

  for (const c of cells) {
    const n = c.state.name;
    if (n === 'hopper') {
      const f = hopperFacing(c.pos);
      expect(CONTAINERS.has(nameAt(add(c.pos, f))), `${where}: Trichter bei ${c.pos.join(',')} zeigt (${f}) in kein Behältnis (${nameAt(add(c.pos, f))})`).toBe(true);
      const above = add(c.pos, 'up');
      // Hand-Einspeisung: ein Eingabe-Trichter über einem Ofen (niedrige Bänke, keine Höhe für ein Fass darüber) wird im
      // Trichter-Fenster (5 Plätze) befüllt – der Spieler öffnet ihn wie eine Truhe
      const manual = hopperFacing(c.pos) === 'down' && FURNACES.has(nameAt(add(c.pos, 'down')));
      const fed = manual || CONTAINERS.has(nameAt(above)) || HORIZONTAL.some((d) => {
        const q = add(c.pos, d);
        return nameAt(q) === 'hopper' && add(q, hopperFacing(q)).join() === c.pos.join();
      });
      expect(fed, `${where}: Trichter bei ${c.pos.join(',')} hat keine Quelle`).toBe(true);
    }
    if (n === 'chest') expect(view.info(add(c.pos, 'up')).phys.cls, `${where}: Block über Truhe bei ${c.pos.join(',')}`).not.toBe('full');
    if (FURNACES.has(n) && c.state.properties['lit'] === 'true' && cells.some((x) => x.state.name === 'hopper')) {

      const above = add(c.pos, 'up');
      const below = add(c.pos, 'down');
      expect(nameAt(above) === 'hopper' && hopperFacing(above) === 'down', `${where}: Ofen ${c.pos.join(',')} ohne Eingabe-Trichter darüber`).toBe(true);
      expect(nameAt(below) === 'hopper', `${where}: Ofen ${c.pos.join(',')} ohne Ausgabe-Trichter darunter`).toBe(true);
      const fuel = HORIZONTAL.filter((d) => {
        const q = add(c.pos, d);
        return nameAt(q) === 'hopper' && add(q, hopperFacing(q)).join() === c.pos.join();
      });
      expect(fuel.length, `${where}: Ofen ${c.pos.join(',')} ohne seitlichen Brennstoff-Trichter`).toBeGreaterThanOrEqual(1);
    }
  }
  for (const f of view.volume.entitiesOf(owner)) {
    const s = STEP[FACING[(f.nbt.value['Facing'] as { value: number }).value]!];
    const behind: Vec3 = [f.blockPos[0] - s[0], f.blockPos[1] - s[1], f.blockPos[2] - s[2]];
    expect(view.info(behind).phys.cls, `${where}: Rahmen bei ${f.blockPos.join(',')} ohne festen Block`).toBe('full');
    expect(['air', 'thin'], `${where}: Rahmen-Zelle belegt`).toContain(view.info(f.blockPos).phys.cls);
  }

}

describe('FN-Schmelzanlagen · Bausteine materialisieren + Mechanik (1.21.11 + 26.3, alle Themes)', () => {
  for (const id of COMPONENTS) {
    it(id, { timeout: HEAVY_TIMEOUT }, () => {
      const def = ctx.catalog.get(id);
      for (const variantId of def.variants?.map((v) => v.id) ?? [undefined]) {
        for (const H of [3, 4, 5, 6, 8].filter((h) => fitsRoomHeight(def, variantId, h)).slice(0, 4)) {
          const { shell, geom } = shellOf(H);
          const planner = new RoomPlanner(geom);
          const placed = planner.poses(def, planner.adapt(def, variantId))[0];
          const label = `${id}#${variantId} H${H}`;
          expect(placed, `${label}: keine gültige Pose`).toBeDefined();
          const placements: MaterializePlacement[] = [{ id: 'c', placed: placed!, roomId: 'r1' }];
          for (const version of VERSIONS) {
            const platform = ctx.platform(version);
            const themes = version === '26.3' && H === 4 ? ctx.themes.ids() : ['medieval'];
            for (const themeId of themes) {
              const where = `${label} · ${themeId} · ${version}`;
              const r = materialize({ shell, placements, theme: ctx.themes.get(themeId), platform, seed: 11 });
              const hard = r.violations.filter((x) => x.kind !== 'spawn');
              expect(hard, `${where}: ${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
              expect(r.volume.cellsOf('c').length, where).toBe(placed!.cells.length);
              expect(r.volume.entitiesOf('c').length, where).toBe(placed!.entities.length);
              assertMechanics(new WorldView(r.volume, platform), 'c', where);
            }
          }
        }
      }
    });
  }
});

// ---------------------------------------------------------------- End-to-End

function singleRoom(version: keyof typeof TARGET_VERSIONS, w: number, d: number, seed: number, height: number, themeId = 'medieval'): Project {
  const p = Project.create({ id: 'fn-smelt', name: 'FN Schmelzhalle', seed, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), TYPE);
  return p;
}

function checkE2E(p: Project, where: string): void {
  const world = generate(p, ctx);
  const room = p.state.rooms[0]!;
  const info = world.shell.rooms.get(room.id)!;
  const placements = p.state.placements.filter((x) => x.roomId === room.id);
  const w = `${where}\n${renderAscii(info, placements.map((x) => placedFor(x, ctx.catalog)), (id) => ctx.catalog.get(id).tags)}`;
  expect(world.warnings, w).toEqual([]);
  const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
  expect(hard, `${w}\n${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
  expect(world.materialized.light.darkCells, w).toEqual([]);
  const tags = new Set(placements.flatMap((x) => ctx.catalog.get(x.componentId).tags));
  expect(SIGNATURE_TAGS.some((t) => tags.has(t)), `${w}\nOfenbank fehlt`).toBe(true);
  const view = new WorldView(world.materialized.volume, ctx.platform(p.state.targetVersion.name));
  for (const x of placements.filter((y) => y.componentId.includes('fn_smelt'))) assertMechanics(view, x.id, `${where} ${x.componentId}`);
}

describe('FN-Schmelzanlagen · End-to-End (Einrichtung → Licht-Pass → Materialisierung)', () => {
  it('minArea … 16×11 × lichte Höhe 3/4/5/6 × 2 Seeds (1.21.11), 26.3 × Themes', { timeout: HEAVY_TIMEOUT }, () => {
    // Fenster rundum (Regel Q1a: kein Vollblock über Bodenhöhe in einer Fensterspalte): eine 4 breite Bank braucht einen
    // fensterfreien Wandlauf; bei H3 erst ab 12×9, sonst mit Innenwänden (Keller, Nachbarräume) – siehe Solver-Test oben
    for (const [w, d] of [[10, 9], [12, 9], [16, 11]] as const) {
      for (const H of w === 10 ? [4, 5, 6] : [3, 4, 5, 6]) {
        for (const seed of [0, 1]) checkE2E(singleRoom('1.21.11', w, d, seed, H), `${TYPE} ${w}×${d} H${H} seed ${seed}`);
      }
    }
    for (const themeId of ctx.themes.ids()) checkE2E(singleRoom('26.3', 14, 10, 3, 5, themeId), `${TYPE} 14×10 H5 26.3 ${themeId}`);
  });
});
