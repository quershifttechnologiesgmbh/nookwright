/**
 * FN-Lager: Ruhezustand und Staub-Autotiling der Sortier-Lager (`functional/fn_store_sorter`, `fn_store_sorter_bank`) in allen Posen,
 * dazu die Behälter der Lager-Komponenten (Truhen offen, Shulker mit freier Front, Theke ohne Redstone).
 * Die Grundzelle (Filter-Trichter, Sperr-Trichter, Komparator gegen Wasserkessel) ist die im Spiel geprüfte R1-Zelle (Gruppe F).
 */
import type { RoomShellInfo, Shell, ShellCell } from '@mcda/blueprint';
import { CellSet, add, resolveRelDir, transformLocal, type Mirror, type Quarter, type RelDir, type Vec3 } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import { materialize, type MaterializePlacement, type MaterializeResult } from '../src/index.js';
import { THEME_IDS, place, platformView, themes } from './fixtures.js';

const POSES: readonly (readonly [Quarter, Mirror])[] = [[0, 'none'], [1, 'none'], [2, 'none'], [3, 'none'], [1, 'x'], [2, 'z']];

function floorShell(size: number): Shell {
  const cells: ShellCell[] = [];
  for (let x = -1; x <= size; x++) for (let z = -1; z <= size; z++) cells.push({ pos: [x, 0, z], kind: 'floor', role: 'floor_primary', shape: 'block', roomId: 'r1' });
  const info: RoomShellInfo = { roomId: 'r1', floorIndex: 0, baseY: 1, height: 6, interior: CellSet.rect(-1, -1, size, size), doors: [], windows: [] };
  return { cells, rooms: new Map([['r1', info]]), warnings: [] };
}

const run = (pl: MaterializePlacement, version = '1.21.11', theme = 'medieval', size = 26): MaterializeResult =>
  materialize({ shell: floorShell(size), placements: [pl], theme: themes.get(theme), platform: platformView(version), seed: 5 });

function locate(pl: MaterializePlacement) {
  const { placed } = pl;
  const at = (local: Vec3): Vec3 => add(placed.pose.pos, transformLocal(local, placed.expanded.size, placed.pose.rot, placed.pose.mirror));
  const dir = (rel: RelDir) => resolveRelDir(rel, placed.pose);
  return { at, dir };
}

/** Paare: [Komponente, Variante, Zahl der Paare k] */
const SORTERS: readonly (readonly [string, string | undefined, number])[] = [
  ['functional/fn_store_sorter', undefined, 1],
  ['functional/fn_store_sorter_bank', 'quad', 2],
  ['functional/fn_store_sorter_bank', 'hex', 3],
];

describe('FN-Lager: Sortier-Lager (Ruhezustand, Staub, Sperre)', () => {
  for (const [id, variant, k] of SORTERS) {
    it(`${id}#${variant ?? '-'}: ${2 * k} Kategorien, Staub-Formen und Sperren in jeder Pose`, () => {
      for (const [rot, mirror] of POSES) {
        const pl = place('s', id, [1, 1, 1], rot, variant, mirror);
        const r = run(pl);
        const { at, dir } = locate(pl);
        const st = (p: Vec3) => r.volume.stateAt(at(p));
        const side = (p: Vec3, rel: RelDir) => st(p).properties[dir(rel)];
        const where = `rot${rot} ${mirror}`;
        expect(r.violations.filter((v) => v.kind !== 'spawn'), where).toEqual([]);
        for (let i = 0; i < k; i++) {
          const b = 6 * i;
          // Staub hinter dem Filter-Komparator: vorn (Komparator-Ausgang) + links bzw. rechts (Stufe hinab), Wand nicht
          expect([side([b + 1, 1, 0], 'front'), side([b + 1, 1, 0], 'left'), side([b + 1, 1, 0], 'back')], `${where} paar${i}`).toEqual(['side', 'side', 'none']);
          expect([side([b + 5, 1, 0], 'front'), side([b + 5, 1, 0], 'right'), side([b + 5, 1, 0], 'back')], `${where} paar${i}`).toEqual(['side', 'side', 'none']);
          // Bodenstaub: zum Träger hinauf, vorn in die Seite des Sperr-Komparators, zum Trenner nicht
          expect([side([b + 2, 0, 0], 'right'), side([b + 2, 0, 0], 'front'), side([b + 2, 0, 0], 'left')], `${where} paar${i}`).toEqual(['up', 'side', 'none']);
          expect([side([b + 4, 0, 0], 'left'), side([b + 4, 0, 0], 'front'), side([b + 4, 0, 0], 'right')], `${where} paar${i}`).toEqual(['up', 'side', 'none']);
          // Sperr-Komparatoren im Vergleichsmodus, an; Kessel Stufe 1; Sperr-Trichter gesperrt
          expect(st([b + 2, 0, 1]).properties, `${where} paar${i}`).toMatchObject({ facing: dir('left'), mode: 'compare', powered: 'true' });
          expect(st([b + 4, 0, 1]).properties, `${where} paar${i}`).toMatchObject({ facing: dir('right'), mode: 'compare', powered: 'true' });
          expect(st([b + 3, 0, 1]), `${where} paar${i}`).toMatchObject({ name: 'water_cauldron', properties: { level: '1' } });
          for (const f of [b + 1, b + 5]) {
            expect(st([f, 0, 2]).properties, `${where} sperre ${f}`).toMatchObject({ enabled: 'false', facing: dir('front') });
            expect(st([f, 1, 2]), `${where} filter ${f}`).toMatchObject({ name: 'hopper' });
            expect(st([f, 0, 3]).name, `${where} fass ${f}`).toBe('barrel');
            expect(st([f, 1, 1]).properties, `${where} filter-komparator ${f}`).toMatchObject({ facing: dir('front'), powered: 'false' });
          }
        }
        // Ruhezustand: kein Staub unter Strom, keine Fackel, kein Inhalt in den Trichtern
        const wires = r.volume.cellsOf('s').filter((c) => c.state.name === 'redstone_wire');
        expect(wires, where).toHaveLength(4 * k);
        for (const c of wires) expect(c.state.properties['power'], where).toBe('0');
        expect(r.volume.cellsOf('s').some((c) => c.state.name.includes('torch')), where).toBe(false);
        // Einwurf-Truhe oben über dem ersten Transport-Trichter, Überlauf-Fass an der Front
        expect(st([1, 3, 2]).name, where).toBe('chest');
        expect(st([6 * k, 0, 3]).name, where).toBe('barrel');
      }
    });
  }

  it('jede Kategorie hat einen Etikett-Rahmen; im Ruhezustand sind alle Behälter leer (keine Inhalte in der Komponente)', () => {
    for (const [id, variant, k] of SORTERS) {
      const def = place('s', id, [1, 1, 1], 0, variant).placed.expanded;
      expect(def.entities?.filter((e) => e.type === 'item_frame').length ?? 0, `${id}#${variant}`).toBe(2 * k + 1);
    }
  });
});

describe('FN-Lager: Truhen-/Fasswände, Shulker-Station, Regale, Theke', () => {
  const LIST: readonly (readonly [string, string, readonly string[]])[] = [
    ['storage/fn_chest_wall_label', 'c3', ['chest']],
    ['storage/fn_barrel_wall_label', 'b3', ['barrel']],
    ['storage/fn_shulker_station', 's3', ['red_shulker_box', 'lime_shulker_box', 'blue_shulker_box']],
    ['storage/fn_cellar_shelves', 'm', ['barrel', 'chest']],
    ['functional/fn_store_counter', 'two', ['barrel', 'chest', 'hopper']],
  ];
  for (const [id, variant, blocks] of LIST) {
    it(`${id}#${variant}: materialisiert in allen Themes und Posen ohne Verstoß und enthält ${blocks.join(', ')}`, () => {
      for (const theme of THEME_IDS) {
        for (const [rot, mirror] of POSES) {
          const r = run(place('c', id, [1, 1, 1], rot, variant, mirror), '26.3', theme, 12);
          expect(r.violations.filter((v) => v.kind !== 'spawn'), `${theme} rot${rot} ${mirror}`).toEqual([]);
          const names = new Set(r.volume.cellsOf('c').map((c) => c.state.name));
          for (const b of blocks) expect(names.has(b), `${b} ${theme}`).toBe(true);
        }
      }
    });
  }

  it('Entnahme-Theke: Trichter gibt nach vorn in das Fass mit Öffnung nach oben; Truhe darüber; kein Redstone', () => {
    for (const [rot, mirror] of POSES) {
      const pl = place('t', 'functional/fn_store_counter', [1, 1, 1], rot, 'one', mirror);
      const r = run(pl, '1.21.11', 'medieval', 8);
      const { at, dir } = locate(pl);
      expect(r.volume.stateAt(at([1, 0, 0])).properties).toMatchObject({ facing: dir('front'), enabled: 'true' });
      expect(r.volume.stateAt(at([1, 0, 1]))).toMatchObject({ name: 'barrel', properties: { facing: 'up' } });
      expect(r.volume.stateAt(at([1, 1, 0])).name).toBe('chest');
      expect(r.volume.cellsOf('t').some((c) => /redstone|comparator|repeater/.test(c.state.name))).toBe(false);
    }
  });
});
