/**
 * K2 (Katalog-Horizont, research/15): neue Komponenten aus der Dungeon-Alchemist-Taxonomie. Jede ist geladen
 * (validiert) und über einen Raumtyp, einen Socket oder den Licht-Pass erreichbar – oder bewusst „nur Katalog“
 * (außen, Kapelle). Die Materialisierung jeder Variante in 1.21.11 + 26.3 × alle Themes prüft
 * catalog-components.test.ts für den ganzen Katalog. Hier: Fuzz über ALLE Raumtypen des Katalogs mit lichter
 * Höhe 2, 3 und 4 (0 Warnungen, 0 harte Verstöße, 0 Spawn-Zellen, Pflicht- und Signatur-Möbel platziert,
 * Rahmen an vollen Blöcken) und der Nachweis, dass die neuen Komponenten tatsächlich zum Einsatz kommen.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { evalCount } from '@mcda/catalog';
import { CellSet, type Dir, type Vec3 } from '@mcda/core';
import { expandComponent, renderAscii } from '@mcda/furnishing';
import { WorldView } from '@mcda/materialize';
import { generate, placedFor } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));

/** Neue Komponenten der Welle K2 (research/15 §3). */
const K2_IDS: readonly string[] = [
  // Tische, Bänke, Sitzgruppen
  'table/trestle_table', 'seat/bench', 'seat/settle', 'seat/wing_chair', 'seat/pew', 'table/tea_table', 'table/sideboard', 'table/game_table',
  // Regale, Schränke, Vorräte
  'storage/pantry_shelf', 'storage/cupboard', 'storage/pottery', 'storage/firewood',
  // Wanddeko, Waffen, Rüstung
  'decor/tapestry', 'decor/shield_display', 'decor/weapon_rack', 'decor/armor_display', 'decor/skull_trophy', 'decor/frame_books',
  'decor/menu_board', 'decor/frame_meat', 'decor/frame_kitchen', 'decor/frame_farm_tools', 'decor/wall_planter', 'decor/tall_clock',
  // Textilien
  'decor/carpet_runner', 'decor/fur_rug', 'decor/rug_round', 'decor/moss_patch',
  // Licht
  'light/wall_candles', 'light/bracket_lantern', 'light/harvest_lantern', 'light/barrel_lantern', 'light/candle_cross',
  // Küche, Lebensmittel, Werkzeug
  'decor/cutting_board', 'food/candle_cake', 'food/harvest_pile', 'work/chopping_block', 'work/sawhorse',
  // Spiele, Musik, Religiöses, Pflanzen
  'decor/archery_target', 'decor/bard_corner', 'decor/hanging_bell', 'decor/altar', 'decor/holy_font', 'decor/candle_rack',
  'decor/pedestal_urn', 'decor/planter_trough', 'decor/mushroom_patch', 'decor/hanging_moss',
  // Außen
  'outdoor/well', 'outdoor/market_stall', 'outdoor/trough', 'outdoor/signpost', 'outdoor/lamp_post',
];

/** Bewusst noch ohne Raumtyp (Außenbereich, Kapelle, Kaserne) – Bausteine für spätere Raumtypen. */
const CATALOG_ONLY: ReadonlySet<string> = new Set([
  'outdoor/well', 'outdoor/market_stall', 'outdoor/trough', 'outdoor/signpost', 'outdoor/lamp_post',
  'seat/pew', 'decor/altar', 'decor/holy_font', 'decor/candle_rack', 'decor/archery_target',
]);

/** Signatur-Tags der K1-Raumtypen (research/10 §0, research/11); weitere Raumtypen: nur Pflicht-Tags. */
const SIGNATURE: Readonly<Record<string, readonly string[]>> = {
  bedroom: ['canopy_bed'],
  kitchen: ['hearth'],
  storage: ['storage_wall'],
  smithy: ['forge'],
  library: ['bookshelf_wall', 'lectern'],
  alchemy: ['brewing_counter'],
  tavern: ['bar_counter', 'tavern_table'],
};

const SIZES: readonly (readonly [number, number])[] = [[7, 6], [9, 8], [12, 9]];
const FACING: Readonly<Record<number, Dir>> = { 0: 'down', 1: 'up', 2: 'north', 3: 'south', 4: 'west', 5: 'east' };
const STEP: Readonly<Record<Dir, Vec3>> = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };

function singleRoom(version: keyof typeof TARGET_VERSIONS, type: string, w: number, d: number, seed: number, height: number, themeId = 'medieval'): Project {
  const p = Project.create({ id: 'k2', name: 'K2', seed, themeId, targetVersion: TARGET_VERSIONS[version], floor: { y0: 0, height } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), type);
  return p;
}

const fits = (type: string, w: number, d: number): boolean => (w - 2) * (d - 2) >= ctx.catalog.roomType(type).minArea;

/** Generiert einen Raum, prüft alle Regeln und liefert die platzierten Komponenten-IDs. */
function check(p: Project, label: string): string[] {
  const world = generate(p, ctx);
  const room = p.state.rooms[0]!;
  const info = world.shell.rooms.get(room.id)!;
  const placements = p.state.placements.filter((x) => x.roomId === room.id);
  const ascii = renderAscii(info, placements.map((x) => placedFor(x, ctx.catalog)), (id) => ctx.catalog.get(id).tags);
  const where = `${label}\n${ascii}`;
  expect(world.warnings, where).toEqual([]);
  const tags = new Set(placements.flatMap((x) => ctx.catalog.get(x.componentId).tags));
  const rt = ctx.catalog.roomType(room.roomTypeId);
  for (const req of rt.required) {
    const [min] = evalCount(req.count, info.interior.size);
    if (min > 0) expect(req.tags.some((t) => tags.has(t)), `${where}\nPflicht ${req.tags.join('|')} fehlt`).toBe(true);
  }
  for (const t of SIGNATURE[room.roomTypeId] ?? []) expect(tags.has(t), `${where}\nSignatur ${t} fehlt`).toBe(true);
  const hard = world.materialized.violations.filter((v) => v.kind !== 'spawn');
  expect(hard, `${where}\n${JSON.stringify(hard.slice(0, 3))}`).toEqual([]);
  expect(world.materialized.light.darkCells, where).toEqual([]);
  // Rahmen hängen an vollen Blöcken (Raumwand, Stamm, Planken), ihre Zelle ist frei
  const view = new WorldView(world.materialized.volume, ctx.platform(p.state.targetVersion.name));
  for (const f of world.materialized.volume.entities()) {
    const s = STEP[FACING[(f.nbt.value['Facing'] as { value: number }).value]!];
    const behind: Vec3 = [f.blockPos[0] - s[0], f.blockPos[1] - s[1], f.blockPos[2] - s[2]];
    expect(view.info(behind).phys.cls, `${label}: Rahmen bei ${f.blockPos.join(',')} ohne festen Block`).toBe('full');
    expect(['air', 'thin'], `${label}: Rahmen-Zelle belegt`).toContain(view.info(f.blockPos).phys.cls);
  }
  return placements.map((x) => x.componentId);
}

describe('K2: Katalog-Horizont (neue Komponenten)', () => {
  it('mindestens 40 neue Komponenten sind geladen und validiert', () => {
    expect(K2_IDS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(K2_IDS).size).toBe(K2_IDS.length);
    for (const id of K2_IDS) expect(ctx.catalog.find(id), id).toBeDefined();
  });

  it('jede neue Komponente ist über Raumtyp, Socket oder Licht-Pass erreichbar (außer bewusst „nur Katalog“)', () => {
    const reachable = new Set<string>();
    for (const id of ctx.catalog.roomTypeIds()) {
      const rt = ctx.catalog.roomType(id);
      for (const e of [...rt.required, ...rt.optional]) e.tags.forEach((t) => reachable.add(t));
      rt.lighting?.prefer?.forEach((t) => reachable.add(t));
    }
    for (const def of ctx.catalog.all()) {
      for (const v of def.variants?.map((x) => x.id) ?? [undefined]) expandComponent(def, v).sockets.forEach((s) => s.accepts.forEach((t) => reachable.add(t)));
    }
    const unreachable = K2_IDS.filter((id) => !CATALOG_ONLY.has(id) && !ctx.catalog.get(id).tags.some((t) => reachable.has(t)));
    expect(unreachable).toEqual([]);
  });

  it('Wandteppich: alle Banner in der untersten Lage, die Zellen unter dem Tuch sind als Luft reserviert', () => {
    const def = ctx.catalog.get('decor/tapestry');
    for (const v of def.variants!) {
      const exp = expandComponent(def, v.id);
      expect(exp.cells.every((c) => c.at[1] === 0), v.id).toBe(true);
      for (const c of exp.cells) expect(exp.air, v.id).toContainEqual([c.at[0], -1, c.at[2]]);
    }
  });
});

describe('K2-Fuzz: alle Raumtypen, lichte Höhe 2/3/4 (1.21.11) und 26.3 × alle Themes', () => {
  const k2 = new Set(K2_IDS);
  for (const type of ctx.catalog.roomTypeIds()) {
    it(`${type}: ${SIZES.map(([w, d]) => `${w}×${d}`).join(', ')} × Höhe 2/3/4 × 2 Seeds, 26.3 × Themes`, () => {
      const mine = new Set<string>();
      for (const [w, d] of SIZES) {
        if (!fits(type, w, d)) continue;
        for (const h of [2, 3, 4]) {
          for (const seed of [0, 1]) {
            for (const id of check(singleRoom('1.21.11', type, w, d, seed, h), `${type} ${w}×${d} h${h} seed ${seed}`)) {
              if (k2.has(id)) mine.add(id);
            }
          }
        }
      }
      for (const theme of ctx.themes.ids()) {
        const [w, d] = SIZES[2]!;
        if (fits(type, w, d)) for (const id of check(singleRoom('26.3', type, w, d, 7, 3, theme), `${type} ${w}×${d} 26.3 ${theme}`)) {
          if (k2.has(id)) mine.add(id);
        }
      }
      if (type in SIGNATURE) {
        expect(mine.size, `${type}: ${[...mine].join(', ')}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('mindestens 25 K2-Komponenten werden tatsächlich platziert (unabhängig von den Fuzz-Tests)', () => {
    const all = new Set<string>();
    for (const type of ctx.catalog.roomTypeIds()) {
      for (const seed of [0, 1]) {
        const p = singleRoom('1.21.11', type, 12, 9, seed, 3);
        generate(p, ctx);
        for (const placement of p.state.placements) {
          if (k2.has(placement.componentId)) all.add(placement.componentId);
        }
      }
    }
    expect(all.size, [...all].sort().join(', ')).toBeGreaterThanOrEqual(25);
  });
});
