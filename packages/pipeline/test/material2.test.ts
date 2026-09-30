/**
 * W4-G (27.09.2026, `plan/spikes/W4G_material2.md`): Befunde des unabhängigen Reviews W3 als harte Kennzahlen über den
 * Galerie-Weg (`projectFromBuildingType` + `generateBase`, Seed 2026 wie die goldene Galerie).
 *
 * - S1 Große Halle ist ein Saal: Tafel, Kamin, Kronleuchter, keine Betten.
 * - S5 Fachwerk: genau ein Füllmaterial, keine Gefach-Einzelzelle (kein Hell/Dunkel-Schachbrett).
 * - M4 Holzwand: jede Außenwandreihe aus Brettern ist ein Material (dunkler Fuß nur als ganze Reihe); seit W12-D an der
 *   Bohlenwand der Küste (harbor), nordic ist Blockbau (Stammstücke, seltene Wechsel).
 * - M6 Dielen innen ruhig: Sprenkel (Nachbarpaare mit anderem Block) < 15 %.
 * - M7 Lager: Ware mit dem Rücken an der Wand, kein Erdboden im Lager über der Erde.
 * Dazu die harten Regeln: 0 Physik-Verstöße, deterministisch.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TARGET_VERSIONS } from '@mcda/blueprint';
import { parseBuildingTypeDef } from '@mcda/catalog';
import { HEAVY_TIMEOUT } from '../../core/test/support/timing.js';
import { generateBase, placedFor, projectFromBuildingType, type BaseWorld, type BuildingTypeResult } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const ctx = nodeContext(ROOT);
const SEED = 2026;

function build(type: string, themeId: string): { readonly res: BuildingTypeResult; readonly world: BaseWorld } {
  const r = parseBuildingTypeDef(readFileSync(`${ROOT}/buildingtypes/${type}.json5`, 'utf8'), `${type}.json5`);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  const res = projectFromBuildingType(r.value, { size: 'M', themeId, targetVersion: TARGET_VERSIONS['1.21.11'] }, SEED, ctx);
  const world = generateBase(res.project, ctx, { ...res.build, ...res.surroundings });
  return { res, world };
}

const k3 = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const blockAt = (w: BaseWorld, p: readonly [number, number, number]): string =>
  w.materialized.volume.isEmpty(p) ? 'air' : String(w.materialized.volume.stateAt(p).name).replace(/^minecraft:/, '');
const hard = (w: BaseWorld) => w.materialized.violations.filter((v) => v.kind !== 'spawn');
const tagsOf = (id: string): readonly string[] => ctx.catalog.get(id).tags;

describe('W4-G: Große Halle als Saal (S1)', () => {
  it('Speisesaal mit Tafel, Kamin und Kronleuchter, ohne Betten; 0 Verstöße', () => {
    const { res, world } = build('hall', 'medieval');
    const rooms = res.project.state.rooms;
    expect(rooms.map((r) => r.roomTypeId)).toEqual(['dining_hall']);
    const tags = res.project.state.placements.map((p) => tagsOf(p.componentId));
    expect(tags.filter((t) => t.includes('banquet_table')).length).toBeGreaterThanOrEqual(1);
    expect(tags.filter((t) => t.includes('fireplace')).length).toBeGreaterThanOrEqual(1);
    expect(tags.filter((t) => t.includes('chandelier')).length).toBeGreaterThanOrEqual(1);
    expect(res.project.state.placements.filter((p) => p.componentId.startsWith('bed/'))).toEqual([]);
    expect(hard(world)).toEqual([]);
  }, HEAVY_TIMEOUT);
});

describe('W4-G: Fachwerk ohne Schachbrett (S5)', () => {
  for (const type of ['timber', 'townhouse_row']) {
    it(`${type}/timber: ein Füllmaterial, jede Gefachzelle hat eine Gefach-Nachbarzelle`, () => {
      const { world } = build(type, 'timber');
      const ext = new Map<string, string>();
      const storeyWall = new Set<string>(); // Zellen in den Wandreihen ihres Raums (ohne Giebel/Gaube darüber)
      for (const c of world.shell.cells) {
        if ((c.kind !== 'wall' && c.kind !== 'pillar') || c.exterior !== true) continue;
        ext.set(k3(...c.pos), blockAt(world, c.pos));
        const info = c.roomId !== undefined ? world.shell.rooms.get(c.roomId) : undefined;
        if (info !== undefined && c.pos[1] < info.baseY + info.height) storeyWall.add(k3(...c.pos));
      }
      const infill = [...ext].filter(([, b]) => /^(calcite|mushroom_stem|white_terracotta)$/.test(b));
      expect(infill.length).toBeGreaterThan(50);
      expect(new Set(infill.map(([, b]) => b))).toEqual(new Set(['calcite']));
      // Gaubenspitzen und Giebeldreiecke dürfen einzelne Zellen haben (Dachschräge), die Wandgeschosse nicht
      const lone = infill.filter(([k]) => {
        const [x, y, z] = k.split(',').map(Number) as [number, number, number];
        return ![[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]].some(([dx, dy, dz]) => ext.get(k3(x + dx!, y + dy!, z + dz!)) === 'calcite');
      });
      expect(lone.filter(([k]) => storeyWall.has(k)), JSON.stringify(lone)).toEqual([]);
      expect(hard(world)).toEqual([]);
    }, HEAVY_TIMEOUT);
  }
});

describe('W4-G: Holzwand, Dielen, Lager (M4, M6, M7)', () => {
  it('nordic: jede Bretter-Reihe der Außenwand aus einem Material; Dielen ruhig; Lager an der Wand', () => {
    const { res, world } = build('twostory', 'nordic');
    const byPos = new Map(world.shell.cells.map((c) => [k3(...c.pos), c] as const));
    // M4: waagrechte Nachbarn derselben Außenwandreihe (nur Bretterfeld). W12-D (2026-09-28): nordic ist jetzt ein
    // Blockbau (liegende Stämme); die Bohlenwand von vorher trägt unverändert die Küste (harbor) – dort gilt M4 weiter
    const coast = build('twostory', 'harbor').world;
    const planks = new Map<string, string>();
    for (const c of coast.shell.cells) {
      if (c.kind !== 'wall' || c.exterior !== true) continue;
      const b = blockAt(coast, c.pos);
      if (b.endsWith('_planks')) planks.set(k3(...c.pos), b);
    }
    let pairs = 0;
    let change = 0;
    for (const [k, b] of planks) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      for (const n of [k3(x + 1, y, z), k3(x, y, z + 1)]) {
        const nb = planks.get(n);
        if (nb === undefined) continue;
        pairs++;
        if (nb !== b) change++;
      }
    }
    // W13-A (2026-09-28): mit dem eingeschossigen Anbau an der Ostseite hat der Zweistöcker weniger freie Außenwand
    // (46 Bretter-Paare, weiterhin alle gleich); vorher > 50
    expect(pairs).toBeGreaterThan(40);
    expect(change).toBe(0);
    // W12-D: nordic – Wandstämme liegen in Stammstücken (je 6 Blöcke, Reihen versetzt): waagrechte Nachbarn wechseln
    // selten (keine Sprenkel, keine Flecken wie „zugemauerte Türen“)
    const logs = new Map<string, string>();
    for (const c of world.shell.cells) {
      if (c.kind !== 'wall' || c.exterior !== true) continue;
      const b = blockAt(world, c.pos);
      if (/^stripped_.*_log$/.test(b)) logs.set(k3(...c.pos), b);
    }
    let lp = 0;
    let lc = 0;
    for (const [k, b] of logs) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      for (const n of [k3(x + 1, y, z), k3(x, y, z + 1)]) {
        const nb = logs.get(n);
        if (nb === undefined) continue;
        lp++;
        if (nb !== b) lc++;
      }
    }
    expect(lp).toBeGreaterThan(50);
    expect(lc / lp).toBeLessThan(0.25);

    // M6: Dielen der Innenflächen (Wandabstand ≥ 2), Anteil Nachbarpaare mit anderem Brett
    const inner = new Set<string>();
    for (const room of res.project.state.rooms) {
      const cells = room.cells.toArray();
      const own = new Set(cells.map(([x, z]) => `${x},${z}`));
      const far = cells.filter(([x, z]) => [-2, -1, 0, 1, 2].every((dx) => [-2, -1, 0, 1, 2].every((dz) => own.has(`${x + dx},${z + dz}`))));
      for (const [x, z] of far) inner.add(`${x},${z}`);
    }
    let fp = 0;
    let fc = 0;
    const floors = world.shell.cells.filter((c) => c.kind === 'floor' && c.roomId !== undefined && inner.has(`${c.pos[0]},${c.pos[2]}`) && !byPos.has(k3(c.pos[0], c.pos[1] + 1, c.pos[2])));
    const floorBlocks = new Map(floors.map((c) => [k3(...c.pos), blockAt(world, c.pos)] as const));
    for (const [k, b] of floorBlocks) {
      if (!b.endsWith('_planks')) continue;
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      for (const n of [k3(x + 1, y, z), k3(x, y, z + 1)]) {
        const nb = floorBlocks.get(n);
        if (nb === undefined || !nb.endsWith('_planks')) continue;
        fp++;
        if (nb !== b) fc++;
      }
    }
    expect(fp).toBeGreaterThan(30);
    expect(fc / fp).toBeLessThan(0.15);

    // M7: Lagerware steht an einer Wand (Rücken an Wand-/Fenster-/Türzellen), Lager über der Erde ohne Erdboden
    const storage = res.project.state.rooms.filter((r) => r.roomTypeId === 'storage');
    expect(storage.length).toBeGreaterThan(0);
    const GOODS = ['goods', 'harvest', 'pottery', 'crate_stack', 'barrel_stack', 'hay_stack', 'sack_pile', 'firewood'];
    const wallish = new Set(['wall', 'pillar', 'window', 'door']);
    for (const room of storage) {
      const goods = res.project.state.placements.filter((p) => p.roomId === room.id && p.parentId === undefined && tagsOf(p.componentId).some((t) => GOODS.includes(t)));
      for (const g of goods) {
        const placed = placedFor(g, ctx.catalog);
        const fy = Math.min(...placed.cells.map((c) => c.pos[1]));
        const atWall = placed.cells.some((c) => c.pos[1] === fy && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
          const w = byPos.get(k3(c.pos[0] + dx!, fy + 1, c.pos[2] + dz!)) ?? byPos.get(k3(c.pos[0] + dx!, fy, c.pos[2] + dz!));
          return w !== undefined && wallish.has(w.kind);
        }));
        expect(atWall, `${g.componentId} ${JSON.stringify(g.pose.pos)}`).toBe(true);
      }
      if (room.floorIndex >= 0) {
        const own = new Set(room.cells.toArray().map(([x, z]) => `${x},${z}`));
        const earth = world.shell.cells.filter((c) => c.kind === 'floor' && c.roomId === room.id && own.has(`${c.pos[0]},${c.pos[2]}`))
          .map((c) => blockAt(world, c.pos)).filter((b) => /^(coarse_dirt|rooted_dirt|podzol|packed_mud|dirt|mud)$/.test(b));
        expect(earth).toEqual([]);
      }
    }
    expect(hard(world)).toEqual([]);
  }, HEAVY_TIMEOUT);

  it('deterministisch: zwei Läufe sind blockgleich', () => {
    const a = build('hall', 'nordic').world.materialized.volume;
    const b = build('hall', 'nordic').world.materialized.volume;
    const dump = (v: typeof a): string => [...v.cells()].map((c) => `${c.pos.join(',')}=${c.state.name}`).join('\n');
    expect(dump(a)).toBe(dump(b));
  }, HEAVY_TIMEOUT);
});
