/**
 * FN-Geheimnisse (plan/spikes/FN_secrets.md): Redstone-Geheimtüren, Tresor, Pfeilfalle, Luke, Blasensäulen-Aufzug
 * (catalog/components/functional/fn_secret_*) in allen Themes, beiden Zielversionen und allen Posen – dazu die
 * Ruhezustände (Kolben ausgefahren + Kopf, Hebel, Türen zu, Werfer leer, Wasser eingefasst) und die Raumtypen.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RoomShellInfo, Shell, ShellCell } from '@mcda/blueprint';
import { Catalog, parseRoomTypeDef } from '@mcda/catalog';
import { CellSet, add, resolveRelDir, transformLocal, type Mirror, type Quarter, type RelDir, type Vec3 } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { WorldView, checkPistons, isRedstoneConductor, materialize, type MaterializePlacement, type MaterializeResult } from '../src/index.js';
import { THEME_IDS, VERSIONS, catalog, place, platformView, themes } from './fixtures.js';

const SECRETS = catalog.all().filter((d) => d.id.startsWith('functional/fn_secret_'));
const POSES: readonly (readonly [Quarter, Mirror])[] = [[0, 'none'], [1, 'none'], [2, 'none'], [3, 'none'], [1, 'x'], [2, 'z']];

function floorShell(size = 12): Shell {
  const cells: ShellCell[] = [];
  for (let x = -1; x <= size; x++) for (let z = -1; z <= size; z++) cells.push({ pos: [x, 0, z], kind: 'floor', role: 'floor_primary', shape: 'block', roomId: 'r1' });
  const info: RoomShellInfo = { roomId: 'r1', floorIndex: 0, baseY: 1, height: 7, interior: CellSet.rect(-1, -1, size, size), doors: [], windows: [] };
  return { cells, rooms: new Map([['r1', info]]), warnings: [] };
}

function run(pl: MaterializePlacement, version: string, theme = 'medieval'): MaterializeResult {
  return materialize({ shell: floorShell(), placements: [pl], theme: themes.get(theme), platform: platformView(version), seed: 5 });
}

function locate(pl: MaterializePlacement) {
  const { placed } = pl;
  const at = (local: Vec3): Vec3 => add(placed.pose.pos, transformLocal(local, placed.expanded.size, placed.pose.rot, placed.pose.mirror));
  const dir = (rel: RelDir) => resolveRelDir(rel, placed.pose);
  return { at, dir };
}

const named = (r: MaterializeResult, id: string, name: string) => r.volume.cellsOf(id).filter((c) => c.state.name === name);

describe('fn_secret_*: Katalog', () => {
  it('alle Komponenten sind vorhanden und tragen den Tag-Präfix fn_', () => {
    expect(SECRETS.map((d) => d.id).sort()).toEqual([
      'functional/fn_secret_arrow_trap', 'functional/fn_secret_bookcase', 'functional/fn_secret_bubble_lift', 'functional/fn_secret_stone_door',
      'functional/fn_secret_trapdoor_ladder', 'functional/fn_secret_wall_safe',
    ]);
    for (const d of SECRETS) expect(d.tags.every((t) => t.startsWith('fn_')), d.id).toBe(true);
  });
});

describe('fn_secret_*: Materialisierung', () => {
  for (const version of VERSIONS) {
    it(`${version}: jede Variante × Theme × Pose ohne Verstöße, gültige States`, () => {
      const reg = platformView(version).registry;
      let n = 0;
      for (const def of SECRETS) {
        for (const variant of def.variants?.map((v) => v.id) ?? [undefined]) {
          for (const theme of THEME_IDS) {
            for (const [rot, mirror] of POSES) {
              const where = `${def.id}#${variant ?? '-'} ${theme} rot${rot} ${mirror}`;
              const r = run(place('c', def.id, [2, 1, 2], rot, variant, mirror), version, theme);
              expect(r.violations.filter((v) => v.kind !== 'spawn'), where).toEqual([]);
              for (const c of r.volume.cellsOf('c')) expect(reg.isValidState(c.state.name, c.state.properties, { complete: true }), `${where} ${c.state.name}`).toBe(true);
              n++;
            }
          }
        }
      }
      expect(n).toBeGreaterThan(500);
    });
  }
});

describe('fn_secret_*: Ruhezustand (Tür/Tresor ZU)', () => {
  const doors: readonly (readonly [string, string, number])[] = [
    ['functional/fn_secret_bookcase', 's', 2], ['functional/fn_secret_bookcase', 'm', 4],
    ['functional/fn_secret_stone_door', 'd1', 2], ['functional/fn_secret_stone_door', 'd2', 4], ['functional/fn_secret_stone_door', 'tapestry', 2],
    ['functional/fn_secret_wall_safe', '', 1],
  ];
  for (const [id, variant, heads] of doors) {
    it(`${id}#${variant || '-'}: ausgefahrene Kolben mit Kopf, Außenhebel an auf leitendem Träger`, () => {
      for (const version of VERSIONS) for (const theme of THEME_IDS) for (const [rot, mirror] of POSES) {
        const where = `${id}#${variant} ${version} ${theme} rot${rot} ${mirror}`;
        const pl = place('c', id, [2, 1, 2], rot, variant || undefined, mirror);
        const r = run(pl, version, theme);
        const view = new WorldView(r.volume, platformView(version));
        expect(checkPistons(view), where).toEqual([]);
        const pistons = named(r, 'c', 'sticky_piston');
        expect(pistons.every((p) => p.state.properties['extended'] === 'true'), where).toBe(true);
        expect(named(r, 'c', 'piston_head'), where).toHaveLength(heads);
        expect(pistons, where).toHaveLength(heads);
        const on = named(r, 'c', 'lever').filter((l) => l.state.properties['powered'] === 'true');
        expect(on.length, where).toBeGreaterThanOrEqual(1);
        // Hebel an: der Träger darunter muss Redstone leiten (stark geladen werden), sonst schaltet er nichts
        for (const l of on) {
          expect(l.state.properties['face'], where).toBe('floor');
          const below: Vec3 = [l.pos[0], l.pos[1] - 1, l.pos[2]];
          expect(isRedstoneConductor(view.info(below)), `${where} Träger ${view.state(below).name}`).toBe(true);
        }
      }
    });
  }

  it('Bücherregal-Tür: Regalflügel sind Regale, Innenhebel aus, Außenhebel an, Kammer mit Truhe/Fass', () => {
    const r = run(place('c', 'functional/fn_secret_bookcase', [2, 1, 2], 0, 's'), '1.21.11');
    expect(named(r, 'c', 'bookshelf').length).toBeGreaterThan(6);
    expect(named(r, 'c', 'lever').map((l) => l.state.properties['powered']).sort()).toEqual(['false', 'true']);
    expect(named(r, 'c', 'chest')).toHaveLength(1);
    expect(named(r, 'c', 'barrel')).toHaveLength(1);
  });

  it('Tresor: ein echter Hebel, zwei Attrappen; Attrappen und ihre Träger grenzen an keinen Kolben', () => {
    const r = run(place('c', 'functional/fn_secret_wall_safe', [2, 1, 2], 0), '26.3');
    const levers = named(r, 'c', 'lever');
    expect(levers.filter((l) => l.state.properties['powered'] === 'true')).toHaveLength(1);
    const decoys = levers.filter((l) => l.state.properties['powered'] === 'false');
    expect(decoys).toHaveLength(2);
    const pistonPos = named(r, 'c', 'sticky_piston')[0]!.pos;
    const near = (a: Vec3, b: Vec3) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) === 1;
    for (const l of decoys) {
      expect(near(l.pos, pistonPos), 'Attrappe grenzt an den Kolben').toBe(false);
      expect(near([l.pos[0], l.pos[1] - 1, l.pos[2]], pistonPos), 'Träger der Attrappe grenzt an den Kolben').toBe(false);
    }
    expect(named(r, 'c', 'barrel')).toHaveLength(1);
  });

  it('Wandteppich-Tür: Flügel aus rotem Wollblock', () => {
    const r = run(place('c', 'functional/fn_secret_stone_door', [2, 1, 2], 0, 'tapestry'), '1.21.11', 'medieval');
    expect(r.volume.cellsOf('c').filter((c) => c.state.name.endsWith('_wool')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('fn_secret_*: Pfeilfalle, Luke, Aufzug', () => {
  it('Pfeilfalle: Werfer LEER (entschärft), Steinplatte direkt davor, Pfeile in der Truhe', () => {
    for (const [rot, mirror] of POSES) {
      const pl = place('c', 'functional/fn_secret_arrow_trap', [2, 1, 2], rot, undefined, mirror);
      const r = run(pl, '1.21.11');
      const { at, dir } = locate(pl);
      const disp = named(r, 'c', 'dispenser');
      expect(disp).toHaveLength(1);
      expect(JSON.stringify(disp[0]!.blockEntity ?? {}), `rot${rot}`).not.toContain('arrow');
      expect(disp[0]!.state.properties['facing']).toBe(dir('front'));
      const plate = named(r, 'c', 'stone_pressure_plate');
      expect(plate).toHaveLength(1);
      expect(plate[0]!.pos, `rot${rot}`).toEqual(at([2, 0, 1]));
      expect(disp[0]!.pos).toEqual(at([2, 0, 0]));
      expect(JSON.stringify(named(r, 'c', 'chest')[0]!.blockEntity)).toContain('arrow');
    }
  });

  it('Luke: Falltür geschlossen (untere Hälfte) über der Leiter', () => {
    for (const [rot, mirror] of POSES) {
      const pl = place('c', 'functional/fn_secret_trapdoor_ladder', [2, 1, 2], rot, undefined, mirror);
      const r = run(pl, '26.3');
      const { at } = locate(pl);
      const trap = r.volume.cellsOf('c').find((c) => c.state.name.endsWith('_trapdoor'))!;
      expect(trap.state.properties, `rot${rot} ${mirror}`).toMatchObject({ open: 'false', half: 'bottom' });
      expect(trap.pos).toEqual(at([0, 2, 1]));
      expect(r.volume.stateAt(at([0, 1, 1])).name).toBe('ladder');
      expect(r.volume.stateAt(at([0, 0, 1])).name).toBe('ladder');
    }
  });

  it('Aufzug: Säulen über Seelensand/Magma, allseitig eingefasst, Türen zu', () => {
    for (const version of VERSIONS) for (const theme of THEME_IDS) for (const [rot, mirror] of POSES) {
      const pl = place('c', 'functional/fn_secret_bubble_lift', [2, 1, 2], rot, 'pair', mirror);
      const r = run(pl, version, theme);
      const where = `${version} ${theme} rot${rot} ${mirror}`;
      const cols = named(r, 'c', 'bubble_column');
      expect(cols.length, where).toBe(4);
      expect(cols.filter((c) => c.state.properties['drag'] === 'true'), where).toHaveLength(2);
      for (const c of cols) {
        const below = r.volume.stateAt([c.pos[0], c.pos[1] - 1, c.pos[2]]).name;
        const drag = c.state.properties['drag'];
        expect(['bubble_column', drag === 'true' ? 'magma_block' : 'soul_sand'], where).toContain(below);
      }
      const doors = r.volume.cellsOf('c').filter((c) => c.state.name.endsWith('_door'));
      expect(doors.length, where).toBe(4);
      for (const d of doors) expect(d.state.properties['open'], where).toBe('false');
      const view = new WorldView(r.volume, platformView(version));
      for (const c of cols) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n: Vec3 = [c.pos[0] + dx, c.pos[1], c.pos[2] + dz];
          const st = view.state(n);
          const ok = st.name === 'bubble_column' || st.name.endsWith('_door') || view.info(n).phys.cls === 'full';
          expect(ok, `${where} ${JSON.stringify(n)} ${st.name}`).toBe(true);
        }
      }
    }
  });
});

describe('Raumtypen secret_study und vault_room', () => {
  const dir = fileURLToPath(new URL('../../../catalog/roomtypes', import.meta.url));
  const ids = ['secret_study', 'vault_room'];
  const roomCatalog = Catalog.of(catalog.all(), ids.map((id) => {
    const r = parseRoomTypeDef(readFileSync(join(dir, `${id}.json5`), 'utf8'), id);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.value;
  }));
  it('alle Tags haben Komponenten (1.21.11 und 26.3)', () => {
    for (const id of ids) for (const dv of [4671, 5023]) expect(roomCatalog.missingTags(id, dv), `${id} ${dv}`).toEqual([]);
  });
});
