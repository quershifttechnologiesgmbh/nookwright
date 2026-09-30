/**
 * W15 (plan/spikes/W15_fassaden_detailbloecke.md): Fassaden-Details aus Teilblöcken – ohne Stufe bitgleich, Muster je
 * Theme aus dem Katalog, Halt an Wand bzw. Hülle, nie vor Glas oder im Laufweg, spiegelgleich je Reihe, Regal erst ab
 * 1.21.9, deterministisch.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, deriveShell, type Shell } from '@mcda/blueprint';
import { Catalog, parseComponentDef } from '@mcda/catalog';
import { CellSet, key3, type Vec3 } from '@mcda/core';
import {
  DEFAULT_FACADE_DETAIL, FACADE_DETAIL_COMPONENTS, FACADE_DETAIL_GRAND_PATTERNS, FACADE_DETAIL_LEVELS, FACADE_DETAIL_PATTERNS, ExteriorSite, facadeDetailActive, planExterior, variantMinVersion,
  type ExteriorPlacement, type ExteriorStyle,
} from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.json5') ? [join(d, n)] : []));
const catalog = Catalog.of(walk(join(ROOT, 'components')).map((f) => {
  const r = parseComponentDef(readFileSync(f, 'utf8'), f);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
}));

function twoStory(): Project {
  const p = Project.create({ id: 's', name: 'Zweistöckig', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 3 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'smithy');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 8, 6), 'bedroom');
  p.paintRoom(1, CellSet.rect(9, 0, 14, 6), 'alchemy');
  p.paintRoom(1, CellSet.rect(0, 7, 14, 11), 'library');
  p.placeStairs(0, [3, 10], 'east');
  return p;
}
function small(): Project {
  const p = Project.create({ id: 'k', name: 'Klein', seed: 11, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 4 } });
  p.paintRoom(0, CellSet.rect(0, 0, 10, 6), 'living');
  return p;
}
const RULES = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true } as const;
const FACADE = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4, rules: RULES } as const;
const HOUSES = [['zweistöckig', twoStory], ['klein', small]] as const;
const THEMES = ['medieval', 'timber', 'rustic', 'nordic'] as const;
const isDetail = (p: ExteriorPlacement): boolean => p.group === 'detailBlocks';

const planOf = (shell: Shell, p: Project, style: ExteriorStyle, themeId: string, dataVersion?: number) => planExterior(shell, catalog, {
  seed: p.state.seed, style, roomTypes: Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])), themeId, ...(dataVersion !== undefined ? { dataVersion } : {}),
});

describe('W15: Fassaden-Details im Katalog', () => {
  it('jedes Muster hat seine Komponente mit Theme-Tags; dezent ist eine Teilmenge von reich', () => {
    for (const pat of FACADE_DETAIL_PATTERNS) {
      const def = catalog.find(FACADE_DETAIL_COMPONENTS[pat]);
      expect(def, pat).toBeDefined();
      expect(def!.styleTags?.length ?? 0, pat).toBeGreaterThan(0);
      for (const t of def!.styleTags ?? []) {
        if (facadeDetailActive(catalog, { facadeDetail: 'subtle' }, t, pat)) expect(facadeDetailActive(catalog, { facadeDetail: 'rich' }, t, pat)).toBe(true);
        expect(facadeDetailActive(catalog, { facadeDetail: 'off' }, t, pat)).toBe(false);
        expect(facadeDetailActive(catalog, { facadeDetail: 'rich', facadeDetailOff: [pat] }, t, pat)).toBe(false);
      }
    }
    expect(FACADE_DETAIL_LEVELS).toEqual(['off', 'subtle', 'rich', 'grand']);
  });

  it('Regal erst ab 1.21.9 (DataVersion 4554), Ersatz ohne Mindestversion', () => {
    const def = catalog.get(FACADE_DETAIL_COMPONENTS.shopShelves);
    expect(variantMinVersion(def, 'shelf')).toBe(4554);
    expect(variantMinVersion(def, 'crate')).toBe(0);
  });
});

describe('W15: Planung der Fassaden-Details', () => {
  for (const [name, make] of HOUSES) {
    const p = make();
    const shell = deriveShell(p.state, { roof: 'gable', facade: FACADE });

    it(`${name}: „off“ ohne Details, ohne Angabe der Standard (W15: dezent), Ergebnis deterministisch`, () => {
      const set = THEMES.flatMap((t) => planOf(shell, p, { facadeDetail: 'rich' }, t, 4671).placements.filter(isDetail));
      expect(set.length).toBeGreaterThan(0);
      for (const t of THEMES) {
        const plain = planOf(shell, p, { facadeDetail: 'off' }, t, 4671);
        expect(plain.placements.some(isDetail)).toBe(false);
        expect(planOf(shell, p, {}, t, 4671)).toEqual(planOf(shell, p, { facadeDetail: DEFAULT_FACADE_DETAIL }, t, 4671));
        for (const level of ['subtle', 'rich'] as const) {
          const plan = planOf(shell, p, { facadeDetail: level }, t, 4671);
          expect(planOf(shell, p, { facadeDetail: level }, t, 4671)).toEqual(plan);
          // alles außer den Details bleibt, wie es war (Details kommen zuletzt)
          expect(plan.placements.filter((x) => !isDetail(x))).toEqual(plain.placements);
          // Gruppe aus = keine Details
          expect(planOf(shell, p, { facadeDetail: level, detailBlocks: false }, t, 4671)).toEqual(plain);
          // ohne Zielversion nur der Regal-Ersatz anders, sonst gleich
          expect(planOf(shell, p, { facadeDetail: level }, t).placements.filter((x) => x.componentId !== FACADE_DETAIL_COMPONENTS.shopShelves))
            .toEqual(plan.placements.filter((x) => x.componentId !== FACADE_DETAIL_COMPONENTS.shopShelves));
        }
      }
    });

    it(`${name}: jede Zelle in Außenluft, mit Halt, nie vor Glas oder im Laufweg`, () => {
      const site = new ExteriorSite(shell, catalog, 1);
      const doors = (shell.anchors ?? []).filter((a) => a.kind === 'door');
      const walk = new Set<string>();
      const step = (v: Vec3, d: string, k: number): Vec3 => [v[0] + (d === 'east' ? k : d === 'west' ? -k : 0), v[1], v[2] + (d === 'south' ? k : d === 'north' ? -k : 0)];
      for (const a of doors) for (const k of [0, 1]) for (const h of [0, 1]) {
        const q = step(a.pos, a.facing, k);
        walk.add(key3([q[0], q[1] + h, q[2]]));
      }
      for (const t of THEMES) for (const level of ['subtle', 'rich'] as const) {
        const det = planOf(shell, p, { facadeDetail: level }, t, 4671).placements.filter(isDetail);
        for (const pl of det) for (const c of pl.cells) {
          expect(site.outside(c), `${pl.id} ${c}`).toBe(true);
          expect(walk.has(key3(c)), `${pl.id} im Laufweg`).toBe(false);
          // Halt: eine Hüllzelle waagrecht daneben oder darüber, bzw. ein anderes Stück darüber (Laterne am Zaun)
          const around: Vec3[] = [[c[0] + 1, c[1], c[2]], [c[0] - 1, c[1], c[2]], [c[0], c[1], c[2] + 1], [c[0], c[1], c[2] - 1], [c[0], c[1] + 1, c[2]]];
          const own = new Set(pl.cells.map(key3));
          const held = around.some((q) => site.at(q) !== undefined || own.has(key3(q)));
          expect(held, `${pl.id} ohne Halt`).toBe(true);
          // nie vor Glas: keine Scheibe direkt dahinter
          for (const q of around.slice(0, 4)) expect(site.at(q)?.kind === 'window', `${pl.id} vor Glas`).toBe(false);
        }
      }
    });

    it(`${name}: Konsolenreihen spiegelgleich je Reihe`, () => {
      for (const t of THEMES) {
        const det = planOf(shell, p, { facadeDetail: 'rich' }, t, 4671).placements.filter(isDetail);
        const rows = new Map<string, number[]>();
        for (const pl of det.filter((x) => /jetty_corbel|eave_dentil/.test(x.componentId))) {
          const c = pl.cells[0]!;
          const ns = pl.pose.rot % 2 === 0;
          const k = `${pl.componentId}|${pl.pose.rot}|${ns ? c[2] : c[0]}|${c[1]}`;
          (rows.get(k) ?? rows.set(k, []).get(k)!).push(ns ? c[0] : c[2]);
        }
        for (const [k, us] of rows) {
          const s = [...us].sort((a, b) => a - b);
          const c2 = s[0]! + s[s.length - 1]!;
          expect(s.map((u) => c2 - u).sort((a, b) => a - b), `${t} ${k}`).toEqual(s);
        }
      }
    });
  }

  it('Auslage an der Werkstatt: Regal ab 1.21.9, davor Fass', () => {
    const p = twoStory();
    const shell = deriveShell(p.state, { roof: 'gable', facade: FACADE });
    const shelves = (dv: number | undefined) => planOf(shell, p, { facadeDetail: 'subtle' }, 'medieval', dv).placements
      .filter((x) => x.componentId === FACADE_DETAIL_COMPONENTS.shopShelves).map((x) => x.variantId);
    const now = shelves(4671);
    if (now.length > 0) {
      expect(new Set(now)).toEqual(new Set(['shelf']));
      expect(new Set(shelves(3955))).toEqual(new Set(['crate']));
      expect(new Set(shelves(undefined))).toEqual(new Set(['crate']));
    }
  });
});

/** EXT: Stufe `grand` – Balkon, Erker, Geschossband, Verdachung, Firstschmuck, Strebepfeiler, Rankgitter, Taubenschlag. */
const GRAND_ID = /exterior\/(balcony|oriel_window|window_hood|string_course|buttress|weathervane|bell_turret|trellis|dovecote|detail_plinth_ledge|arcade_pier|window_frame_arch|detail_downspout)$/;
const isGrand = (p: ExteriorPlacement): boolean => GRAND_ID.test(p.componentId);

describe('EXT: Stufe grand im Katalog', () => {
  it('Grand-Muster sind nur bei grand aktiv, jedes hat seine Komponente mit Theme-Tags', () => {
    expect(FACADE_DETAIL_GRAND_PATTERNS.length).toBeGreaterThan(0);
    for (const pat of FACADE_DETAIL_GRAND_PATTERNS) {
      const def = catalog.find(FACADE_DETAIL_COMPONENTS[pat]);
      expect(def, pat).toBeDefined();
      for (const t of def!.styleTags ?? []) {
        expect(facadeDetailActive(catalog, { facadeDetail: 'subtle' }, t, pat), `${pat} subtle`).toBe(false);
        expect(facadeDetailActive(catalog, { facadeDetail: 'rich' }, t, pat), `${pat} rich`).toBe(false);
        expect(facadeDetailActive(catalog, { facadeDetail: 'grand' }, t, pat), `${pat} grand`).toBe(true);
        expect(facadeDetailActive(catalog, { facadeDetail: 'grand', facadeDetailOff: [pat] }, t, pat), `${pat} aus`).toBe(false);
      }
    }
  });

  it('die neuen Varianten existieren (Erker kurz, Türmchen am First, Wetterfahne, Sockel-Pfeiler)', () => {
    const has = (id: string, v: string): boolean => (catalog.get(id).variants ?? []).some((x) => x.id === v);
    expect(has('exterior/oriel_window', 'short')).toBe(true);
    expect(has('exterior/bell_turret', 'ridge')).toBe(true);
    expect(has('exterior/weathervane', 'vane')).toBe(true);
    expect(has('exterior/buttress', 'plinth')).toBe(true);
  });
});

describe('EXT2: Wandrelief der Stufe grand', () => {
  const RELIEF = /detail_plinth_ledge|arcade_pier|window_frame_arch|detail_downspout/;
  it('kommt an mindestens einem Haus vor und entfällt mit den Musternamen in facadeDetailOff', () => {
    let seen = 0;
    for (const [, make] of HOUSES) {
      const p = make();
      const shell = deriveShell(p.state, { roof: 'gable', facade: FACADE });
      for (const t of THEMES) {
        seen += planOf(shell, p, { facadeDetail: 'grand' }, t, 4671).placements.filter((x) => RELIEF.test(x.componentId)).length;
        const off = planOf(shell, p, { facadeDetail: 'grand', facadeDetailOff: ['plinthLedge', 'pilasters', 'blindArch', 'downspout'] }, t, 4671);
        expect(off.placements.some((x) => RELIEF.test(x.componentId)), `${t} aus`).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('EXT: Planung der Stufe grand', () => {
  for (const [name, make] of HOUSES) {
    const p = make();
    const shell = deriveShell(p.state, { roof: 'gable', facade: FACADE });

    it(`${name}: subtle und rich unverändert (kein Grand-Stück), grand deterministisch`, () => {
      for (const t of THEMES) {
        for (const level of ['subtle', 'rich'] as const) expect(planOf(shell, p, { facadeDetail: level }, t, 4671).placements.some(isGrand), `${t} ${level}`).toBe(false);
        const a = planOf(shell, p, { facadeDetail: 'grand' }, t, 4671);
        expect(planOf(shell, p, { facadeDetail: 'grand' }, t, 4671)).toEqual(a);
        // Gruppe aus = Grand-Stücke, die zu `detailBlocks` gehören, entfallen; die Stufe unter grand bleibt Untermenge
        expect(planOf(shell, p, { facadeDetail: 'grand', facadeDetailOff: [...FACADE_DETAIL_GRAND_PATTERNS] }, t, 4671).placements.some(isGrand)).toBe(false);
      }
    });

    it(`${name}: Grand-Stücke in Außenluft, im Laufweg frei, mit Halt`, () => {
      const site = new ExteriorSite(shell, catalog, 1);
      const walkCells = new Set<string>();
      const step = (v: Vec3, d: string, k: number): Vec3 => [v[0] + (d === 'east' ? k : d === 'west' ? -k : 0), v[1], v[2] + (d === 'south' ? k : d === 'north' ? -k : 0)];
      for (const a of (shell.anchors ?? []).filter((x) => x.kind === 'door')) for (const k of [0, 1]) for (const h of [0, 1]) {
        const q = step(a.pos, a.facing, k);
        walkCells.add(key3([q[0], q[1] + h, q[2]]));
      }
      let seen = 0;
      for (const t of THEMES) {
        for (const pl of planOf(shell, p, { facadeDetail: 'grand' }, t, 4671).placements.filter(isGrand)) {
          seen++;
          const own = new Set(pl.cells.map(key3));
          for (const c of pl.cells) {
            // Firstschmuck sitzt über dem Dach (Luft über der Hülle), alles andere in der Außenluft
            if (!/weathervane|bell_turret/.test(pl.componentId)) expect(site.outside(c), `${pl.id} ${c}`).toBe(true);
            expect(walkCells.has(key3(c)), `${pl.id} im Laufweg`).toBe(false);
            const around: Vec3[] = [[c[0] + 1, c[1], c[2]], [c[0] - 1, c[1], c[2]], [c[0], c[1], c[2] + 1], [c[0], c[1], c[2] - 1], [c[0], c[1] + 1, c[2]], [c[0], c[1] - 1, c[2]]];
            expect(around.some((q) => site.at(q) !== undefined || own.has(key3(q))), `${pl.id} ohne Halt`).toBe(true);
          }
        }
      }
      // Zweistöckiges Haus: Balkon, Erker, Band oder Türmchen kommen wirklich vor
      if (name === 'zweistöckig') expect(seen).toBeGreaterThan(0);
    });

    it(`${name}: gepaarte Stücke (Band, Strebepfeiler, Rankgitter) spiegelgleich je Reihe`, () => {
      for (const t of THEMES) {
        const rows = new Map<string, number[]>();
        for (const pl of planOf(shell, p, { facadeDetail: 'grand' }, t, 4671).placements.filter((x) => /string_course|buttress|trellis|detail_plinth_ledge|arcade_pier|window_frame_arch|detail_downspout/.test(x.componentId))) {
          const c = pl.cells[0]!;
          const ns = pl.pose.rot % 2 === 0;
          const k = `${pl.componentId}|${pl.pose.rot}|${ns ? c[2] : c[0]}|${c[1]}`;
          (rows.get(k) ?? rows.set(k, []).get(k)!).push(ns ? c[0] : c[2]);
        }
        for (const [k, us] of rows) {
          const s = [...us].sort((a, b) => a - b);
          const c2 = s[0]! + s[s.length - 1]!;
          expect(s.map((u) => c2 - u).sort((a, b) => a - b), `${t} ${k}`).toEqual(s);
        }
      }
    });
  }
});
