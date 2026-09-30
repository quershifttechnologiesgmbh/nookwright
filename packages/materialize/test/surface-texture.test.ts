/**
 * TX-B: Oberflächen-Textur (Schalter `surfaceTexture`: off/subtle/rich).
 *
 * Vertrag: Ohne die Option bleibt jedes Ergebnis bitgleich; mit ihr werden nur Blöcke getauscht (Geometrie, Rollen und
 * Belegung bleiben), deterministisch aus dem Seed, innerhalb der Formfamilie, und jede Änderung hat eine benannte Regel.
 */
import { Project, TARGET_VERSIONS as PROJECT_VERSIONS, deriveShell, type RoofStyle, type Shell } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { describe, expect, it } from 'vitest';
import {
  GRADIENT_MODEL, SisterIndex, TEXTURE_RULES, boundaryBlend, busynessOf, materialize, solveGradient, wallRelief, wallRoofContrast, type MaterializeOptions, type MaterializeResult,
} from '../src/index.js';
import { platformView, themes } from './fixtures.js';

const VERSION = '26.3';
const L_ROOM = CellSet.rect(0, 0, 13, 6).union(CellSet.rect(0, 7, 6, 13));

function house(roof: RoofStyle): { shell: Shell; roomTypes: Record<string, string> } {
  const p = Project.create({ id: 't', name: 'T', seed: 5, themeId: 'medieval', targetVersion: PROJECT_VERSIONS[VERSION], floor: { y0: 0, height: 4 } });
  p.paintRoom(0, L_ROOM, 'bedroom');
  const shell = deriveShell(p.state, { roof, overhang: 1 });
  return { shell, roomTypes: Object.fromEntries(p.state.rooms.map((r) => [r.id, r.roomTypeId])) };
}

function run(roof: RoofStyle, themeId: string, options?: MaterializeOptions, seed = 2026): MaterializeResult {
  const h = house(roof);
  return materialize({
    shell: h.shell, placements: [], theme: themes.get(themeId), platform: platformView(VERSION), seed, roomTypes: h.roomTypes,
    ...(options !== undefined ? { options } : {}),
  });
}

const blocks = (r: MaterializeResult): Map<string, string> => new Map([...r.volume.cells()].map((c) => [c.pos.join(','), `${c.state.name}${JSON.stringify(c.state.properties)}`]));
const diff = (a: MaterializeResult, b: MaterializeResult): number => {
  const ma = blocks(a);
  let n = 0;
  for (const [k, v] of blocks(b)) if (ma.get(k) !== v) n++;
  return n;
};

describe('Oberflächen-Textur', () => {
  it('ohne Option: kein Ergebnisfeld, bitgleich zu einem zweiten Lauf', () => {
    const a = run('gable', 'medieval');
    const b = run('gable', 'medieval');
    expect(a.surfaceTexture).toBeUndefined();
    expect(diff(a, b)).toBe(0);
  });

  it('mit Option: tauscht Blöcke, Belegung und Größe bleiben', () => {
    const base = run('gable', 'medieval');
    const t = run('gable', 'medieval', { surfaceTexture: 'rich' });
    expect(t.surfaceTexture).toBeDefined();
    expect(t.surfaceTexture!.changed).toBeGreaterThan(0);
    expect(t.volume.size).toEqual(base.volume.size);
    expect(t.volume.origin).toEqual(base.volume.origin);
    const air = (r: MaterializeResult) => [...r.volume.cells()].map((c) => c.pos.join(',')).sort();
    expect(air(t)).toEqual(air(base));
    expect(t.violations.filter((v) => v.severity === 'error')).toEqual(base.violations.filter((v) => v.severity === 'error'));
    expect(diff(base, t)).toBeGreaterThan(0);
  });

  it('jede Änderung hat eine Regel: Summe je Regel = Gesamtzahl, nur bekannte Regeln', () => {
    const s = run('gable', 'medieval', { surfaceTexture: 'rich' }).surfaceTexture!;
    expect(Object.values(s.byRule).reduce((a, b) => a + b, 0)).toBe(s.changed);
    for (const k of Object.keys(s.byRule)) expect(TEXTURE_RULES).toContain(k);
    expect(Object.values(s.byTone).reduce((a, b) => a + b, 0)).toBe(s.changed);
    expect(s.changedShare).toBeGreaterThan(0);
    expect(s.changedShare).toBeLessThan(1);
    // Streu-Anteil (getauschte Zellen ohne getauschten Nachbarn): Flecken statt Splitter
    expect(s.isolatedShare).toBeGreaterThanOrEqual(0);
    expect(s.isolatedShare).toBeLessThan(0.5);
  });

  it('deterministisch aus dem Seed; anderer Seed = anderes Bild', () => {
    const a = run('gable', 'medieval', { surfaceTexture: 'rich' }, 7);
    const b = run('gable', 'medieval', { surfaceTexture: 'rich' }, 7);
    const c = run('gable', 'medieval', { surfaceTexture: 'rich' }, 8);
    expect(diff(a, b)).toBe(0);
    expect(diff(a, c)).toBeGreaterThan(0);
  });

  it('subtle verändert weniger als rich', () => {
    const s = run('gable', 'medieval', { surfaceTexture: 'subtle' }).surfaceTexture!;
    const r = run('gable', 'medieval', { surfaceTexture: 'rich' }).surfaceTexture!;
    expect(s.changed).toBeGreaterThan(0);
    expect(s.changed).toBeLessThan(r.changed);
  });

  it('Stärke skaliert mit dem Story-Zustand (älter = nicht weniger Wechsel)', () => {
    const young = run('gable', 'medieval', { surfaceTexture: 'rich', storyState: 'neu' }).surfaceTexture!;
    const old = run('gable', 'medieval', { surfaceTexture: 'rich', storyState: 'verfallen' }).surfaceTexture!;
    expect(old.changed).toBeGreaterThanOrEqual(young.changed);
  });

  it('bleibt in der Formfamilie: Treppe bleibt Treppe, Halbstufe Halbstufe, Mauer Mauer', () => {
    const base = run('gable', 'medieval');
    const t = run('gable', 'medieval', { surfaceTexture: 'rich' });
    const bb = blocks(base);
    const shapeOf = (n: string): string => (n.endsWith('_stairs') ? 'stairs' : n.endsWith('_slab') ? 'slab' : n.endsWith('_wall') ? 'wall' : 'other');
    let swapped = 0;
    for (const c of t.volume.cells()) {
      const before = bb.get(c.pos.join(','));
      if (before === undefined) continue;
      const bn = before.slice(0, before.indexOf('{'));
      if (bn === c.state.name) continue;
      swapped++;
      expect(shapeOf(c.state.name.replace('minecraft:', ''))).toBe(shapeOf(bn.replace('minecraft:', '')));
    }
    expect(swapped).toBeGreaterThan(0);
  });

  it('kombiniert mit narrativeWeathering ohne Fehler (fremde Eigenschaften werden gefiltert)', () => {
    for (const theme of ['medieval', 'nordic']) {
      const r = run('gable', theme, { surfaceTexture: 'rich', narrativeWeathering: 'rich' });
      expect(r.surfaceTexture).toBeDefined();
      expect(r.narrativeWeathering).toBeDefined();
    }
  });
});

describe('Schwesterblöcke', () => {
  const families = { families: {
    stone: { kind: 'stone', color: '#7f7f7f', shapes: { block: 'minecraft:stone', stairs: 'minecraft:stone_stairs', slab: 'minecraft:stone_slab' } },
    andesite: { kind: 'stone', color: '#858585', shapes: { block: 'minecraft:andesite', stairs: 'minecraft:andesite_stairs' } },
    dark: { kind: 'stone', color: '#666666', shapes: { block: 'minecraft:dark_stone', stairs: 'minecraft:dark_stone_stairs' } },
    light: { kind: 'stone', color: '#9b9b9b', shapes: { block: 'minecraft:light_stone', stairs: 'minecraft:light_stone_stairs' } },
    blackstone: { kind: 'stone', color: '#665f70', shapes: { block: 'minecraft:blackstone', stairs: 'minecraft:blackstone_stairs' } },
    oak: { kind: 'wood', color: '#7f7f7f', shapes: { block: 'minecraft:oak_planks' } },
  } } as never;

  it('gleiche Art und Form, Klassen nach Helligkeit, keine Ausreißer-Töne', () => {
    const idx = new SisterIndex(families, () => true);
    const s = idx.sisters('stone', 'stairs');
    expect(s.near).toContain('andesite_stairs');
    expect(s.dark).toContain('dark_stone_stairs');
    expect(s.light).toContain('light_stone_stairs');
    for (const list of [s.near, s.dark, s.light]) {
      expect(list.every((b) => b.endsWith('_stairs'))).toBe(true);
      expect(list).not.toContain('blackstone_stairs');
    }
  });

  it('Block ohne Zielversion fällt weg', () => {
    const idx = new SisterIndex(families, (n) => n !== 'andesite_stairs');
    expect(idx.sisters('stone', 'stairs').near).not.toContain('andesite_stairs');
  });
});

describe('Geometriemaske (surface-relief)', () => {
  // Wand x = 0 (Normale +x), Balken bei z = 0 und z = 4 stehen einen Block vor (x = 1), dazwischen Füllfeld
  const solidSet = new Set<string>();
  for (let y = 0; y < 4; y++) {
    for (let z = 0; z <= 4; z++) solidSet.add(`0,${y},${z}`);
    solidSet.add(`1,${y},0`);
    solidSet.add(`1,${y},4`);
  }
  const isSolid = (x: number, y: number, z: number): boolean => solidSet.has(`${x},${y},${z}`);
  const isOut = (x: number, y: number, z: number): boolean => !isSolid(x, y, z) && x >= 0;

  it('Füllfeld zwischen vorstehenden Balken ist Rücksprung, der Balken ist konvex', () => {
    const infill = wallRelief(isSolid, isOut, [0, 1, 2], 1, 0);
    expect(infill.recess).toBe(0);
    const nextToBeam = wallRelief(isSolid, isOut, [0, 1, 1], 1, 0);
    expect(nextToBeam.occlusion).toBeGreaterThanOrEqual(1);
    const beam = wallRelief(isSolid, isOut, [1, 1, 0], 1, 0);
    expect(beam.recess).toBe(0);
    expect(beam.convex).toBeGreaterThanOrEqual(1);
  });

  it('enge Nische (Balken links und rechts direkt daneben) hat Rücksprung 1', () => {
    const s = new Set<string>(['0,1,0', '0,1,1', '0,1,2', '1,1,0', '1,1,2']);
    const sol = (x: number, y: number, z: number): boolean => s.has(`${x},${y},${z}`);
    const r = wallRelief(sol, (x, y, z) => !sol(x, y, z), [0, 1, 1], 1, 0);
    expect(r.recess).toBe(1);
    expect(r.convex).toBe(2);
  });
});

describe('Verlaufskette, Grenzrauschen, Kontrast, Unruhe', () => {
  it('solveGradient: nie Grund neben Akzent und nie dunkel neben hell', () => {
    const w = 12;
    const h = 8;
    const active = new Uint8Array(w * h).fill(1);
    const want = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) want[i] = (i * 7 + (i >> 3)) % 4;
    const { cls } = solveGradient(w, h, active, want, 11);
    const allowed = GRADIENT_MODEL.compat[0]!;
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      if (x + 1 < w) expect(allowed[cls[i]!]).toContain(cls[i + 1]!);
      if (i + w < w * h) expect(allowed[cls[i]!]).toContain(cls[i + w]!);
    }
  });

  it('boundaryBlend: innen 1, außen 0, fade 0 = scharf', () => {
    expect(boundaryBlend(2, 1)).toBe(1);
    expect(boundaryBlend(-2, 1)).toBe(0);
    expect(boundaryBlend(0, 1)).toBe(0.5);
    expect(boundaryBlend(0.1, 0)).toBe(1);
    expect(boundaryBlend(-0.1, 0)).toBe(0);
  });

  it('wallRoofContrast: gleicher Block warnt, Stein unter dunklem Holz nicht', () => {
    const fam = { families: {
      stone: { kind: 'stone', color: '#7e7e7e', shapes: { block: 'minecraft:stone', stairs: 'minecraft:stone_stairs' } },
      dark_oak: { kind: 'wood', color: '#432b14', shapes: { planks: 'minecraft:dark_oak_planks', stairs: 'minecraft:dark_oak_stairs' } },
    } } as never;
    expect(wallRoofContrast(fam, 'stone', 'stone_stairs')!.warning).toBe(true);
    const c = wallRoofContrast(fam, 'minecraft:stone', 'dark_oak_stairs')!;
    expect(c.warning).toBe(false);
    expect(c.dL).toBeGreaterThan(20);
    expect(wallRoofContrast(fam, 'stone', 'unknown_block')).toBeUndefined();
  });

  it('B1: der nahe Ton (Füller) ist nie unruhiger als der Ausgangsblock', () => {
    const fam = { families: {
      stone_bricks: { kind: 'stone', color: '#7a7a7a', shapes: { block: 'minecraft:stone_bricks' } },
      cobblestone: { kind: 'stone', color: '#807f80', shapes: { block: 'minecraft:cobblestone' } },
      stone: { kind: 'stone', color: '#7e7e7e', shapes: { block: 'minecraft:stone' } },
    } } as never;
    const s = new SisterIndex(fam, () => true).sisters('stone_bricks', 'block');
    expect(s.near).toContain('stone');
    expect(s.near).not.toContain('cobblestone');
    expect(busynessOf(fam, 'cobblestone', 'block')).toBe(2);
  });
});

describe('Regressionskennzahlen (B6)', () => {
  for (const theme of ['medieval', 'nordic']) {
    it(`${theme}: Flecken statt Splitter, keine Streifen, keine harten Sprünge, Kette gelöst`, () => {
      const s = run('gable', theme, { surfaceTexture: 'rich' }).surfaceTexture!;
      expect(s.metricsBefore.pairs).toBeGreaterThan(0);
      expect(s.metricsAfter.pairs).toBe(s.metricsBefore.pairs);
      // Autokorrelation: die meisten Nachbarn bleiben gleich (Flecken), aber die Fläche ist nicht mehr einfarbig
      expect(s.metricsAfter.sameShare).toBeGreaterThan(0.35);
      expect(s.metricsAfter.sameShare).toBeLessThan(s.metricsBefore.sameShare + 1e-9);
      expect(Math.abs(s.metricsAfter.stripeIndex)).toBeLessThan(Math.abs(s.metricsBefore.stripeIndex) + 0.12);
      expect(s.metricsAfter.jumpShare).toBeLessThan(0.12);
      expect(s.isolatedShare).toBeLessThan(0.35);
      expect(s.gradientFallbacks).toBe(0);
    });
  }
});
