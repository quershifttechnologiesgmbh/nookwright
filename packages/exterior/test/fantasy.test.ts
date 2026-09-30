/**
 * W7-D (plan/spikes/W7D_fantasy.md): Fantasy-Module als Katalogeinheiten, Fantasy-Stufe und -Kit, Planung an festen
 * Ankern – spiegelgleich (Paare bzw. Mittelachse), nie vor Glas, nie über einem Dach (außer Giebelhorn als Firstschmuck),
 * ohne Stufe bitgleich, deterministisch.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, deriveShell, type RoofStyle, type Shell } from '@mcda/blueprint';
import { Catalog, parseComponentDef } from '@mcda/catalog';
import { CellSet, key3, type Vec3 } from '@mcda/core';
import {
  FANTASY_ACCENT_TAG, FANTASY_KITS, FANTASY_MODULES, ExteriorSite, fantasyKitFor, fantasyLevelFor, fantasyModuleComponent, fantasyPiece, planExterior,
  type ExteriorPlacement, type ExteriorStyle,
} from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.json5') ? [join(d, n)] : []));
const catalog = Catalog.of(walk(join(ROOT, 'components')).map((f) => {
  const r = parseComponentDef(readFileSync(f, 'utf8'), f);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
}));

function sample(twoStory = false): Project {
  const p = Project.create({ id: 's', name: 'Beispielhaus', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
  if (twoStory) {
    p.addFloor();
    p.paintRoom(1, CellSet.rect(0, 0, 8, 6), 'bedroom');
    p.paintRoom(1, CellSet.rect(9, 0, 14, 6), 'alchemy');
    p.paintRoom(1, CellSet.rect(0, 7, 14, 11), 'library');
    p.placeStairs(0, [3, 10], 'east');
  }
  return p;
}
function lHouse(): Project {
  const p = Project.create({ id: 'l', name: 'L-Haus', seed: 7, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 14), 'hallway');
  p.paintRoom(0, CellSet.rect(9, 8, 20, 14), 'tavern');
  return p;
}
function smallHouse(): Project {
  const p = Project.create({ id: 'k', name: 'Kleines Haus', seed: 11, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 4 } });
  p.paintRoom(0, CellSet.rect(0, 0, 10, 6), 'living');
  return p;
}
const HOUSES: ReadonlyArray<readonly [string, () => Project]> = [['Beispielhaus', () => sample()], ['zweistöckig', () => sample(true)], ['L-Grundriss', lHouse], ['klein', smallHouse]];
const RULES = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true } as const;
const FACADE = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4, rules: RULES } as const;
const isFantasy = (p: ExteriorPlacement): boolean => p.componentId.startsWith('exterior/fantasy_');
const FACING = ['south', 'west', 'north', 'east'] as const;

describe('W7-D: Fantasy-Module im Katalog', () => {
  it('jedes Modul ist da, Varianten nur je Kit (bzw. Kit_double), jedes Kit hat mindestens 4 Module', () => {
    for (const m of FANTASY_MODULES) {
      const def = catalog.find(fantasyModuleComponent(m));
      expect(def, m).toBeDefined();
      const ids = (def!.variants ?? []).map((v) => v.id);
      expect(ids.length, m).toBeGreaterThan(0);
      for (const id of ids) expect((FANTASY_KITS as readonly string[]).includes(id.replace(/_double$/, '')), `${m}#${id}`).toBe(true);
      expect(def!.tags, m).toContain('exterior_fantasy');
      // Standardwahl nur in Themes mit gleichnamigem Kit, für die das Modul eine Variante hat
      for (const t of def!.styleTags ?? []) expect(ids, `${m}: styleTag ${t}`).toContain(t);
    }
    for (const kit of FANTASY_KITS) {
      const n = FANTASY_MODULES.filter((m) => catalog.get(fantasyModuleComponent(m)).variants?.some((v) => v.id === kit) === true).length;
      expect(n, kit).toBeGreaterThanOrEqual(4);
    }
    // Akzent-Stufe: genau die ersetzenden, leisen Module
    expect(FANTASY_MODULES.filter((m) => catalog.get(fantasyModuleComponent(m)).tags.includes(FANTASY_ACCENT_TAG))).toEqual(['lantern_arm', 'gable_horn']);
  });

  it('Stufe und Kit: Standard nach Theme, Stil schlägt Theme, Kit sonst nach Wandmaterial', () => {
    expect(fantasyLevelFor(catalog, {}, 'medieval')).toBe('off');
    expect(fantasyLevelFor(catalog, {}, undefined)).toBe('off');
    expect(fantasyLevelFor(catalog, {}, 'elven')).toBe('full');
    expect(fantasyLevelFor(catalog, {}, 'dwarven')).toBe('full');
    expect(fantasyLevelFor(catalog, { fantasy: 'accent' }, 'medieval')).toBe('accent');
    expect(fantasyLevelFor(catalog, { fantasy: 'off' }, 'elven')).toBe('off');
    expect(fantasyKitFor(catalog, {}, 'elven')).toBe('elven');
    expect(fantasyKitFor(catalog, {}, 'dwarven')).toBe('dwarven');
    expect(fantasyKitFor(catalog, {}, 'nordic')).toBe('elven'); // Holzwand
    expect(fantasyKitFor(catalog, {}, 'medieval')).toBe('dwarven'); // Stein-/Putzwand
    expect(fantasyKitFor(catalog, { fantasyKit: 'elven' }, 'dwarven')).toBe('elven');
    // Stücke: accent nur die Akzent-Module, Kit ohne Variante → keins
    expect(fantasyPiece(catalog, { fantasy: 'accent' }, 'medieval', 'banner')).toBeUndefined();
    expect(fantasyPiece(catalog, { fantasy: 'accent' }, 'medieval', 'lantern_arm')).toEqual({ componentId: 'exterior/fantasy_lantern_arm', variantId: 'dwarven' });
    expect(fantasyPiece(catalog, {}, 'dwarven', 'growth')).toBeUndefined();
    expect(fantasyPiece(catalog, {}, 'elven', 'brazier')).toBeUndefined();
    expect(fantasyPiece(catalog, {}, 'dwarven', 'brazier', true)).toEqual({ componentId: 'exterior/fantasy_brazier', variantId: 'dwarven_double' });
  });
});

/** Zellen, vor denen Glas liegt (Außenluft direkt vor einer Fensterzelle). */
function beforeGlass(shell: Shell): Set<string> {
  const out = new Set<string>();
  for (const c of shell.cells) {
    if (c.kind !== 'window') continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) out.add(key3([c.pos[0] + dx, c.pos[1], c.pos[2] + dz]));
  }
  return out;
}

describe('W7-D: Fantasy-Module an festen Ankern (mit Fassadenraster)', () => {
  for (const [name, make] of HOUSES) {
    for (const roof of ['gable', 'hip'] as const satisfies readonly RoofStyle[]) {
      it(`${name} · ${roof}: ohne Stufe keine Fantasy-Module (bitgleich), mit Kit spiegelgleich, frei, deterministisch`, () => {
        const p = make();
        const shell = deriveShell(p.state, { roof, facade: FACADE });
        const plain = planExterior(shell, catalog, { seed: p.state.seed, style: {}, roomTypes: {}, themeId: 'medieval' });
        expect(plain.placements.filter(isFantasy)).toEqual([]);
        expect(planExterior(shell, catalog, { seed: p.state.seed, style: { fantasy: 'off' }, roomTypes: {}, themeId: 'medieval' })).toEqual(plain);
        expect(plain.counts.fantasyDecor).toBe(0);
        const site = new ExteriorSite(shell, catalog, 1);
        const glass = beforeGlass(shell);
        for (const kit of FANTASY_KITS) {
          const style: ExteriorStyle = { fantasy: 'full', fantasyKit: kit };
          const plan = planExterior(shell, catalog, { seed: p.state.seed, style, roomTypes: {}, themeId: 'medieval' });
          expect(planExterior(shell, catalog, { seed: p.state.seed, style, roomTypes: {}, themeId: 'medieval' })).toEqual(plan);
          const fan = plan.placements.filter(isFantasy);
          expect(fan.length, `${name} ${roof} ${kit}: Fantasy-Module`).toBeGreaterThan(0);
          for (const pl of fan) {
            expect(pl.variantId?.replace(/_double$/, ''), pl.id).toBe(kit);
            for (const c of pl.cells) {
              // nie vor Glas (F5), nie über einem Dach außer dem Giebelhorn (Firstschmuck, F8)
              expect(glass.has(key3(c)), `${pl.id}: Zelle ${c} vor Glas`).toBe(false);
              if (pl.group !== 'ridgeDecor') expect(site.overRoof(c), `${pl.id}: Zelle ${c} über einem Dach`).toBe(false);
            }
          }
          // Giebelhörner paarweise (je Giebel zwei, gleiche Höhe und Richtung)
          const horns = fan.filter((x) => x.componentId === 'exterior/fantasy_gable_horn');
          expect(horns.length % 2, `${name} ${roof} ${kit}: Hörner paarweise`).toBe(0);
          if (roof === 'hip') expect(horns, 'Walmdach hat keinen Ortgang').toEqual([]);
          // Banner: fester Block dahinter, eine freie Zelle darunter (das Tuch hängt eine Zelle tief)
          const taken = new Set(plan.placements.flatMap((x) => x.cells.map(key3)));
          for (const b of fan.filter((x) => x.componentId === 'exterior/fantasy_banner')) {
            const c = b.cells[0]!;
            const f = FACING[b.pose.rot]!;
            const behind: Vec3 = [c[0] - (f === 'east' ? 1 : f === 'west' ? -1 : 0), c[1], c[2] - (f === 'south' ? 1 : f === 'north' ? -1 : 0)];
            expect(site.solidWall(behind), `${b.id}: Wand dahinter`).toBe(true);
            expect(taken.has(key3([c[0], c[1] - 1, c[2]])) || site.at([c[0], c[1] - 1, c[2]]) !== undefined, `${b.id}: Zelle darunter belegt`).toBe(false);
          }
          // Laubranke: je Eingangsseite beide Ecken oder keine
          expect(fan.filter((x) => x.componentId === 'exterior/fantasy_growth').length % 2).toBe(0);
          // Bogenarm ersetzt die gerade Laterne der Fenstermodule: keine Modul-Laterne mehr neben den Bogenarmen
          const arms = fan.filter((x) => x.componentId === 'exterior/fantasy_lantern_arm');
          const straight = plan.placements.filter((x) => x.variantId === 'lantern' && x.componentId.startsWith('exterior/window_module_') && x.anchor === 'window');
          if (arms.length > 0) expect(straight.filter((x) => x.pose.rot === arms[0]!.pose.rot && x.cells[0]![1] === arms[0]!.cells[0]![1])).toEqual([]);
        }
      });
    }
  }

  it('Stufe „Akzent“: nur Bogenarm und Giebelhorn; Schalter fantasyDecor aus: nur diese beiden', () => {
    const p = sample();
    const shell = deriveShell(p.state, { roof: 'gable', facade: FACADE });
    const ids = (style: ExteriorStyle, themeId: string): string[] =>
      [...new Set(planExterior(shell, catalog, { seed: p.state.seed, style, roomTypes: {}, themeId }).placements.filter(isFantasy).map((x) => x.componentId))].sort();
    expect(ids({ fantasy: 'accent' }, 'medieval')).toEqual(['exterior/fantasy_gable_horn', 'exterior/fantasy_lantern_arm']);
    expect(ids({ fantasyDecor: false }, 'elven')).toEqual(['exterior/fantasy_gable_horn', 'exterior/fantasy_lantern_arm']);
    expect(ids({ fantasyDecor: false, ridgeDecor: false, eaveLanterns: false }, 'elven')).toEqual([]);
    expect(ids({}, 'elven').length).toBeGreaterThanOrEqual(4);
  });
});
