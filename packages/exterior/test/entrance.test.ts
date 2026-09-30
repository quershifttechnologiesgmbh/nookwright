/**
 * W3-EN (plan/spikes/W3EN_eingang.md): Eingangsmodule als Katalogeinheiten an der Haustür.
 * Module (Stücke als Varianten, Standardwahl je Theme über `styleTags`), jede Haustür mit Portal oder Vordach, alles
 * spiegelsymmetrisch um die Türachse (Laternenpaar), Stufe 3 breit und passend zum Gelände, Laufweg frei,
 * Laternen hängen (Zaun darüber oder Vordach mit voller Unterseite), deterministisch.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS, deriveShell, type RoofStyle, type ShellAnchor } from '@mcda/blueprint';
import { Catalog, parseComponentDef } from '@mcda/catalog';
import { CellSet, key3, type Vec3 } from '@mcda/core';
import { expandComponent, placeComponent } from '@mcda/furnishing';
import { ENTRANCE_MODULES, ExteriorSite, entranceKit, entranceModuleComponent, entranceModuleFor, planExterior, type ExteriorPlacement } from '../src/index.js';
import { mainDoorFronts, isMainDoor } from '../src/entrance.js';

const ROOT = fileURLToPath(new URL('../../../catalog', import.meta.url));
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.json5') ? [join(d, n)] : []));
const catalog = Catalog.of(walk(join(ROOT, 'components')).map((f) => {
  const r = parseComponentDef(readFileSync(f, 'utf8'), f);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
}));
const THEMES = readdirSync(join(ROOT, 'themes')).filter((n) => n.endsWith('.json5')).map((n) => /\bid:\s*"([a-z0-9_]+)"/.exec(readFileSync(join(ROOT, 'themes', n), 'utf8'))![1]!);

function sample(height = 3): Project {
  const p = Project.create({ id: 's', name: 'Beispielhaus', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
  return p;
}
function twoStory(): Project {
  const p = sample(4);
  p.addFloor();
  p.paintRoom(1, CellSet.rect(0, 0, 8, 6), 'bedroom');
  p.paintRoom(1, CellSet.rect(9, 0, 14, 6), 'alchemy');
  p.paintRoom(1, CellSet.rect(0, 7, 14, 11), 'library');
  p.placeStairs(0, [3, 10], 'east');
  return p;
}
function lHouse(): Project {
  const p = Project.create({ id: 'l', name: 'L-Haus', seed: 7, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height: 4 } });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 14), 'hallway');
  p.paintRoom(0, CellSet.rect(9, 8, 20, 14), 'tavern');
  return p;
}
const HOUSES: ReadonlyArray<readonly [string, () => Project]> = [['Beispielhaus (Höhe 3)', () => sample()], ['Beispielhaus (Höhe 4)', () => sample(4)], ['zweistöckig', twoStory], ['L-Grundriss', lHouse]];
const RULES = { windowFrame: true, pierFrom: 6, skin: true, grid: true, jambs: true, foundationBase: true } as const;
const FACADE = { plinthProfile: true, cornice: true, quoins: true, brackets: 3, pilasters: 4, rules: RULES } as const;
const STEP = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as const;

/** Spalte j entlang der Wand und Tiefe d vor der Tür (d = 1: Ankerzelle), Reihe y ab der unteren Türhälfte. */
function at(a: ShellAnchor, j: number, y: number, d = 1): Vec3 {
  const [ax, az] = a.facing === 'north' || a.facing === 'south' ? [1, 0] : [0, 1];
  const [fx, fz] = STEP[a.facing];
  return [a.pos[0] + ax * j + fx * (d - 1), a.pos[1] + y, a.pos[2] + az * j + fz * (d - 1)];
}

describe('W3-EN: Eingangsmodule im Katalog', () => {
  it('fünf Module, jedes mit Vorschau, Portal oder Vordach, Laternenpaar und Stufe; alle Stücke ungerade breit', () => {
    for (const id of ENTRANCE_MODULES) {
      const kit = entranceKit(catalog, id);
      expect(kit, id).toBeDefined();
      const def = catalog.get(entranceModuleComponent(id));
      expect(def.mount, id).toBe('facade');
      expect(def.variants?.[0]?.id, `${id}: erste Variante = ganzes Modul (Vorschau)`).toBe('module');
      expect(kit!.frames.length > 0 || kit!.canopies.length > 0, `${id}: Portal oder Vordach`).toBe(true);
      expect(kit!.lanterns.length, `${id}: Laternenpaar`).toBeGreaterThan(0);
      expect(kit!.step && kit!.block, `${id}: Stufe und Podest`).toBe(true);
      for (const p of [...kit!.frames, ...kit!.canopies, ...kit!.lanterns]) expect(Number.isInteger(p.half), `${id}#${p.variantId} ungerade breit`).toBe(true);
    }
  });

  it('je Theme eine Standardwahl (styleTags), genau ein Modul je Theme; Stil schlägt Theme; ohne Theme „townhouse“', () => {
    for (const t of THEMES) {
      const owners = ENTRANCE_MODULES.filter((m) => catalog.get(entranceModuleComponent(m)).styleTags?.includes(t) === true);
      expect(owners, `Theme ${t}`).toHaveLength(1);
      expect(entranceModuleFor(catalog, {}, t)).toBe(owners[0]);
    }
    expect(entranceModuleFor(catalog, { entranceModule: 'stone' }, 'timber')).toBe('stone');
    expect(entranceModuleFor(catalog, {}, undefined)).toBe('townhouse');
    expect(entranceModuleFor(catalog, {}, 'unbekannt')).toBe('townhouse');
  });
});

describe('W3-EN: Haustür mit Modul – symmetrisch, Laternenpaar, Stufe 3 breit, Laufweg frei', () => {
  for (const [name, make] of HOUSES) {
    for (const roof of ['hip', 'gable'] as const satisfies readonly RoofStyle[]) {
      for (const module of ENTRANCE_MODULES) {
        it(`${name} · ${roof} · ${module}`, () => {
          const p = make();
          const shell = deriveShell(p.state, { roof, facade: FACADE });
          const style = { entranceModule: module };
          const plan = planExterior(shell, catalog, { seed: p.state.seed, style, roomTypes: {} });
          expect(planExterior(shell, catalog, { seed: p.state.seed, style, roomTypes: {} })).toEqual(plan);
          const site = new ExteriorSite(shell, catalog, 1);
          const byCell = new Map<string, ExteriorPlacement>(plan.placements.flatMap((x) => x.cells.map((c) => [key3(c), x] as const)));
          const mains = mainDoorFronts(shell);
          const doors = (shell.anchors ?? []).filter((a) => a.kind === 'door' && isMainDoor(mains, a));
          expect(doors.length, name).toBeGreaterThan(0);
          for (const a of doors) {
            const mine = (x: ExteriorPlacement | undefined): boolean => x !== undefined && x.anchor === 'door' && x.componentId === entranceModuleComponent(module);
            // Portal oder Vordach des Moduls (F4)
            const pieces = new Set(plan.placements.filter((x) => mine(x) && x.cells.some((c) => Math.abs(c[0] - a.pos[0]) + Math.abs(c[2] - a.pos[2]) <= 4)).map((x) => x.variantId));
            expect([...pieces].some((v) => v?.startsWith('frame') === true || v?.startsWith('canopy') === true), `${name} ${module}: Haustür ohne Portal/Vordach (${[...pieces].join(' ')})`).toBe(true);
            // spiegelsymmetrisch: jede Zelle der Eingangs-Stücke hat ihr Spiegelbild (Stück und Variante gleich)
            for (let j = 1; j <= 4; j++) for (let y = -1; y <= 4; y++) for (let d = 1; d <= 3; d++) {
              const l = byCell.get(key3(at(a, -j, y, d)));
              const r = byCell.get(key3(at(a, j, y, d)));
              if (!mine(l) && !mine(r)) continue;
              expect(`${l?.variantId}`, `${name} ${module}: unsymmetrisch bei j=±${j} y=${y} d=${d}`).toBe(`${r?.variantId}`);
            }
            // Laternenpaar
            const lamps = plan.placements.filter((x) => mine(x) && x.variantId?.startsWith('lanterns'));
            expect(lamps.length, `${name} ${module}: Laternenpaar`).toBe(1);
            // Stufe 3 breit (Gelände eine Lage unter der Bodenplatte)
            for (const j of [-1, 0, 1]) expect(byCell.get(key3(at(a, j, -1)))?.variantId, `${name} ${module}: Stufe bei j=${j}`).toBe('step');
            // Laufweg (Tür + 1 davor, 2 hoch) frei
            for (const d of [1, 2]) for (const y of [0, 1]) expect(byCell.get(key3(at(a, 0, y, d))), `${name} ${module}: Laufweg d=${d} y=${y}`).toBeUndefined();
          }
          // hängende Laternen der Eingänge: darüber Zaun des Stücks oder ein Vordach mit tragender Unterseite
          // (untere Stufe/Treppe, Block; Faktencheck #3 – nicht unter oberer Stufe oder umgedrehter Treppe)
          const mats = new Map<string, { shape?: string; upsideDown: boolean; hanging: boolean }>();
          for (const x of plan.placements.filter((q) => q.anchor === 'door')) {
            for (const c of placeComponent(expandComponent(catalog.get(x.componentId), x.variantId), x.pose).cells) {
              const o = c.mat.orient;
              mats.set(key3(c.pos), { ...(c.mat.shape !== undefined ? { shape: c.mat.shape } : {}), upsideDown: o?.upsideDown === true, hanging: o?.hanging === true });
            }
          }
          const full = (m: { shape?: string } | undefined): boolean => m !== undefined && ['block', 'planks', 'log', 'wood', 'fence', 'wall', 'chain'].includes(m.shape ?? '');
          for (const [k, m] of mats) {
            if (m.shape !== 'lantern') continue;
            const [x, y, z] = k.split(',').map(Number) as [number, number, number];
            if (m.hanging) {
              // hängend: darüber Zaun/Mauer/Kette/voller Block, untere Stufe/Treppe – oder die Traufe der Hülle
              const above = mats.get(key3([x, y + 1, z]));
              const ok = full(above) || ((above?.shape === 'stairs' || above?.shape === 'slab') && above.upsideDown !== true) || (above === undefined && site.hangsFrom([x, y, z]));
              expect(ok, `${name} ${module}: hängende Laterne ${k} ohne Halt (darüber ${above?.shape})`).toBe(true);
            } else {
              // stehend: darunter Mauer, Zaun oder voller Block (Faktencheck #3)
              const below = mats.get(key3([x, y - 1, z]));
              expect(full(below), `${name} ${module}: stehende Laterne ${k} ohne Stand (darunter ${below?.shape})`).toBe(true);
            }
          }
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------- W4-C Doppeltür

/** Schankraum mit gerader Front: die Haustür wird eine Doppeltür (Regel `doubleDoor`, `plan/spikes/W4C_tueren.md`). */
function tavernHall(w: number, d: number, height = 4): Project {
  const p = Project.create({ id: 't', name: 'Taverne', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'], floor: { y0: 0, height } });
  p.paintRoom(0, CellSet.rect(0, 0, w - 1, d - 1), 'tavern');
  return p;
}
const DOUBLE_RULES = { ...RULES, centerDoor: true, doubleDoor: ['tavern'] } as const;
const DOUBLE_FACADE = { ...FACADE, rules: DOUBLE_RULES } as const;

describe('W4-C: Doppeltür – Stücke eine Spalte breiter, symmetrisch um die Flügelmitte, keine zusätzliche Deko', () => {
  it('jedes Modul hat Doppeltür-Stücke: gerade breit, Portal oder Vordach, Laternen, Blende; je Stück genau 1 breiter', () => {
    for (const id of ENTRANCE_MODULES) {
      const kit = entranceKit(catalog, id)!;
      expect(kit.double.frames.length > 0 || kit.double.canopies.length > 0, `${id}: Portal oder Vordach`).toBe(true);
      expect(kit.double.lanterns.length, `${id}: Laternen`).toBeGreaterThan(0);
      expect(kit.double.blind, `${id}: Blende`).toBeDefined();
      const doubles = [...kit.double.frames, ...kit.double.canopies, ...kit.double.lanterns];
      for (const p of doubles) expect(p.width % 2, `${id}#${p.variantId} gerade breit`).toBe(0);
      for (const p of [...kit.frames, ...kit.canopies, ...kit.lanterns]) {
        const twin = doubles.find((q) => q.variantId === `double_${p.variantId}`);
        expect(twin, `${id}#${p.variantId}: Gegenstück der Doppeltür`).toBeDefined();
        expect(twin!.width, `${id}#${p.variantId}`).toBe(p.width + 1);
      }
    }
  });

  for (const [w, d] of [[16, 9], [12, 9]] as const) {
    for (const roof of ['hip', 'gable'] as const satisfies readonly RoofStyle[]) {
      for (const module of ENTRANCE_MODULES) {
        it(`Schankraum ${w} × ${d} · ${roof} · ${module}`, () => {
          const p = tavernHall(w, d);
          const shell = deriveShell(p.state, { roof, facade: DOUBLE_FACADE });
          const style = { entranceModule: module };
          const plan = planExterior(shell, catalog, { seed: p.state.seed, style, roomTypes: {} });
          expect(planExterior(shell, catalog, { seed: p.state.seed, style, roomTypes: {} })).toEqual(plan);
          const site = new ExteriorSite(shell, catalog, 1);
          const mains = mainDoorFronts(shell);
          const leaves = (shell.anchors ?? []).filter((a) => a.kind === 'door' && isMainDoor(mains, a));
          expect(leaves, 'zwei Haustür-Flügel').toHaveLength(2);
          // linker Flügel = kleinere Koordinate entlang der Wand
          const a = [...leaves].sort((p1, p2) => p1.pos[0] + p1.pos[2] - (p2.pos[0] + p2.pos[2]))[0]!;
          const byCell = new Map<string, ExteriorPlacement>(plan.placements.flatMap((x) => x.cells.map((c) => [key3(c), x] as const)));
          const mine = (x: ExteriorPlacement | undefined): boolean => x !== undefined && x.anchor === 'door' && x.componentId === entranceModuleComponent(module);
          const pieces = plan.placements.filter((x) => mine(x));
          expect(pieces.some((x) => /^double_(frame|canopy)/.test(x.variantId ?? '')), `${module}: Portal/Vordach der Doppeltür (${pieces.map((x) => x.variantId).join(' ')})`).toBe(true);
          // keine Stücke der einfachen Tür an der Doppeltür, genau ein Laternenpaar
          expect(pieces.filter((x) => /^(frame|canopy|lanterns)/.test(x.variantId ?? '')).map((x) => x.variantId), `${module}: Stücke der einfachen Tür`).toEqual([]);
          expect(pieces.filter((x) => x.variantId?.startsWith('double_lanterns')), `${module}: Laternenpaar`).toHaveLength(1);
          // spiegelsymmetrisch um die Mitte zwischen den Flügeln (Spalte j ↔ 1 − j)
          for (let j = 1; j <= 5; j++) for (let y = -1; y <= 4; y++) for (let dd = 1; dd <= 3; dd++) {
            const l = byCell.get(key3(at(a, -j, y, dd)));
            const r = byCell.get(key3(at(a, 1 + j, y, dd)));
            if (!mine(l) && !mine(r)) continue;
            expect(`${l?.variantId}`, `${module}: unsymmetrisch bei j=${-j}/${1 + j} y=${y} d=${dd}`).toBe(`${r?.variantId}`);
          }
          // Stufe 4 breit, Laufweg vor beiden Flügeln frei
          for (const j of [-1, 0, 1, 2]) expect(byCell.get(key3(at(a, j, -1)))?.variantId, `${module}: Stufe bei j=${j}`).toBe('step');
          for (const j of [0, 1]) for (const dd of [1, 2]) for (const y of [0, 1]) expect(byCell.get(key3(at(a, j, y, dd))), `${module}: Laufweg j=${j} d=${dd} y=${y}`).toBeUndefined();
          // Laternen mit Halt (Faktencheck #3)
          const mats = new Map<string, { shape?: string; upsideDown: boolean; hanging: boolean }>();
          for (const x of plan.placements.filter((q) => q.anchor === 'door')) {
            for (const c of placeComponent(expandComponent(catalog.get(x.componentId), x.variantId), x.pose).cells) {
              mats.set(key3(c.pos), { ...(c.mat.shape !== undefined ? { shape: c.mat.shape } : {}), upsideDown: c.mat.orient?.upsideDown === true, hanging: c.mat.orient?.hanging === true });
            }
          }
          const full = (m: { shape?: string } | undefined): boolean => m !== undefined && ['block', 'planks', 'log', 'wood', 'fence', 'wall', 'chain'].includes(m.shape ?? '');
          for (const [k, m] of mats) {
            if (m.shape !== 'lantern') continue;
            const [x, y, z] = k.split(',').map(Number) as [number, number, number];
            const near = mats.get(key3([x, y + (m.hanging ? 1 : -1), z]));
            const ok = m.hanging
              ? full(near) || ((near?.shape === 'stairs' || near?.shape === 'slab') && near.upsideDown !== true) || (near === undefined && site.hangsFrom([x, y, z]))
              : full(near);
            expect(ok, `${module}: Laterne ${k} ohne Halt`).toBe(true);
          }
        });
      }
    }
  }

  it('keine zusätzliche Deko: gleiche Zahl Eingangs-Platzierungen je Gruppe wie die einfache Tür (nur breiter)', () => {
    for (const module of ENTRANCE_MODULES) {
      const count = (rules: typeof DOUBLE_RULES | typeof RULES): Record<string, number> => {
        const p = tavernHall(16, 9);
        const shell = deriveShell(p.state, { roof: 'gable', facade: { ...FACADE, rules } });
        const plan = planExterior(shell, catalog, { seed: p.state.seed, style: { entranceModule: module }, roomTypes: {} });
        const out: Record<string, number> = {};
        for (const x of plan.placements) if (x.anchor === 'door' && x.group !== 'stoop') out[x.group] = (out[x.group] ?? 0) + 1;
        return out;
      };
      expect(count(DOUBLE_RULES), module).toEqual(count(RULES));
    }
  });
});
