/**
 * O1 – Hüllen-Orientierung senkrecht/hängend: `ShellOrient.vertical | hanging | attach` → gültige Block-States in
 * jeder Zielversion (alle passenden Blöcke der Registry), Fehler bei unpassenden Angaben und die Stützregeln der
 * Physik (Stütze vorhanden/fehlt) – direkt am Volumen und über `materialize` mit Hüllzellen.
 */
import type { Shell, ShellCell, ShellOrient } from '@mcda/blueprint';
import type { HorizontalDir, Vec3 } from '@mcda/core';
import { Layer, VoxelVolume } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { KindIndex, OrientError, WorldView, checkSupport, finalizeState, materialize, resolveVanillaUpdates, shellOrientProps } from '../src/index.js';
import { THEME_IDS, VERSIONS, platformView, themes } from './fixtures.js';

const H4: readonly HorizontalDir[] = ['north', 'east', 'south', 'west'];

/** Hülle → vollständiger State in `version` (wie materialize: Adapter + Registry-Prüfung + Defaults). */
function shellState(version: string, block: string, o: ShellOrient): Record<string, string> {
  const reg = platformView(version).registry;
  const kind = new KindIndex(reg).of(block);
  return { ...finalizeState(reg, block, kind, shellOrientProps(kind, block, o), 'test').properties };
}

/** Alle Blöcke einer Blockart in der Registry der Version. */
function blocksOf(version: string, kind: string): string[] {
  const reg = platformView(version).registry;
  const kinds = new KindIndex(reg);
  return reg.blockNames().filter((n) => kinds.of(n) === kind);
}

describe('O1 Übersetzung: jede Kombination → gültiger, vollständiger State', () => {
  for (const version of VERSIONS) {
    it(`${version}: 6-Wege-Blöcke (Endstab, alle Blitzableiter, Fass …) – vertical up/down und facing waagerecht`, () => {
      const blocks = blocksOf(version, 'directional');
      expect(blocks).toEqual(expect.arrayContaining(['end_rod', 'lightning_rod', 'waxed_lightning_rod', 'waxed_oxidized_lightning_rod', 'barrel']));
      for (const b of blocks) {
        for (const v of ['up', 'down'] as const) expect(shellState(version, b, { vertical: v })['facing'], `${b} ${v}`).toBe(v);
        for (const f of H4) expect(shellState(version, b, { facing: f })['facing'], `${b} ${f}`).toBe(f);
      }
    });

    it(`${version}: Trichter nur nach unten bzw. waagerecht`, () => {
      expect(shellState(version, 'hopper', { vertical: 'down' })['facing']).toBe('down');
      expect(shellState(version, 'hopper', { facing: 'east' })['facing']).toBe('east');
      expect(() => shellState(version, 'hopper', { vertical: 'up' })).toThrow(/nicht nach oben/);
    });

    it(`${version}: jede Laterne hängend/stehend`, () => {
      const blocks = blocksOf(version, 'lantern');
      expect(blocks).toEqual(expect.arrayContaining(['lantern', 'soul_lantern', 'copper_lantern', 'waxed_oxidized_copper_lantern']));
      for (const b of blocks) {
        expect(shellState(version, b, { hanging: true })['hanging'], b).toBe('true');
        expect(shellState(version, b, { hanging: false })['hanging'], b).toBe('false');
      }
    });

    it(`${version}: Glocke – attach × facing (wall = single_wall), ohne attach Bodenbefestigung`, () => {
      const want = { floor: 'floor', ceiling: 'ceiling', wall: 'single_wall', double_wall: 'double_wall' } as const;
      for (const [attach, attachment] of Object.entries(want)) {
        for (const f of H4) {
          expect(shellState(version, 'bell', { facing: f, attach: attach as keyof typeof want }), `${attach} ${f}`).toMatchObject({ attachment, facing: f });
        }
      }
      expect(shellState(version, 'bell', { facing: 'west' })).toMatchObject({ attachment: 'floor', facing: 'west' });
    });

    it(`${version}: Hebel, Knöpfe, Schleifstein – attach → face × facing`, () => {
      const blocks = blocksOf(version, 'face_attached');
      expect(blocks).toEqual(expect.arrayContaining(['lever', 'stone_button', 'oak_button', 'grindstone']));
      for (const b of blocks) {
        for (const face of ['floor', 'ceiling', 'wall'] as const) {
          for (const f of H4) expect(shellState(version, b, { facing: f, attach: face }), `${b} ${face} ${f}`).toMatchObject({ face, facing: f });
        }
      }
    });
  }

  it('unpassende oder widersprüchliche Angaben sind Fehler (nie still ignoriert)', () => {
    const v = '26.3';
    expect(() => shellState(v, 'end_rod', { facing: 'north', vertical: 'up' })).toThrow(/schließen sich aus/);
    expect(() => shellState(v, 'furnace', { facing: 'north', attach: 'wall' })).toThrow(/orient.attach passt nicht/);
    expect(() => shellState(v, 'lever', { facing: 'north', attach: 'double_wall' })).toThrow(/nur für die Glocke/);
    expect(() => shellState(v, 'oak_stairs', { facing: 'north', vertical: 'up' })).toThrow(/orient.vertical passt nicht/);
    expect(() => shellState(v, 'stone_bricks', { hanging: true })).toThrow(/orient.hanging passt nicht/);
    expect(() => shellState(v, 'bell', { facing: 'north', hanging: true })).toThrow(OrientError);
    expect(() => shellState(v, 'lantern', { attach: 'ceiling' })).toThrow(/orient.attach passt nicht/);
    expect(() => shellState(v, 'iron_chain', { axis: 'y', vertical: 'up' })).toThrow(/orient.vertical passt nicht/);
    // Pflicht-Ausrichtung bleibt: Glocke/Hebel ohne facing sind mehrdeutig
    expect(() => shellState(v, 'bell', { attach: 'ceiling' })).toThrow(/braucht eine Ausrichtung/);
  });
});

// ------------------------------------------------------------------------------------------------ Physik

type B = readonly [Vec3, string, (ShellOrient | undefined)?];

/** Kleines Volumen aus Hüllen-Angaben (Adapter wie in materialize), dann Vanilla-Updates und Stützprüfung. */
function support(blocks: readonly B[], version = '26.3'): (readonly [string, string | undefined])[] {
  const platform = platformView(version);
  const kinds = new KindIndex(platform.registry);
  const vol = VoxelVolume.create([7, 5, 7], [-3, -1, -3]);
  for (const [pos, name, o] of blocks) {
    const kind = kinds.of(name);
    const state = finalizeState(platform.registry, name, kind, o !== undefined ? shellOrientProps(kind, name, o) : {}, 'test');
    vol.place(pos, { state, owner: 't', layer: Layer.Furniture });
  }
  const view = new WorldView(vol, platform, kinds);
  resolveVanillaUpdates(view);
  return checkSupport(view).map((v) => [v.kind, v.block] as const);
}

describe('O1 Physik: Stützregeln der neuen Ausrichtungen (Stütze vorhanden / fehlt)', () => {
  const HANG: ShellOrient = { hanging: true };
  const CEIL: ShellOrient = { facing: 'south', attach: 'ceiling' };

  it('hängende Laterne: unter Block, unterer Stufe, Zaun, senkrechter Kette ok; unter Luft, oberer Stufe, umgedrehter Treppe nicht', () => {
    for (const [above, o] of [['stone', undefined], ['oak_slab', { half: 'bottom' }], ['oak_fence', undefined], ['iron_chain', { axis: 'y' }]] as const) {
      expect(support([[[0, 2, 0], above, o], [[0, 1, 0], 'lantern', HANG]]), above).toEqual([]);
    }
    expect(support([[[0, 1, 0], 'lantern', HANG]])).toEqual([['support', 'lantern']]);
    expect(support([[[0, 2, 0], 'oak_slab', { half: 'top' }], [[0, 1, 0], 'soul_lantern', HANG]])).toEqual([['support', 'soul_lantern']]);
    expect(support([[[0, 2, 0], 'oak_stairs', { facing: 'north', half: 'top' }], [[0, 1, 0], 'lantern', HANG]])).toEqual([['support', 'lantern']]);
    // stehend braucht sie die Mitte darunter – eine hängende Laterne mit Boden darunter hilft nichts
    expect(support([[[0, 0, 0], 'stone'], [[0, 1, 0], 'lantern', { hanging: false }]])).toEqual([]);
    expect(support([[[0, 0, 0], 'stone'], [[0, 1, 0], 'lantern', HANG]])).toEqual([['support', 'lantern']]);
  });

  it('Glocke ceiling: stabile Mitte darüber (Block, Stamm, Kette, Zaun); fehlt sie, ist es ein Verstoß', () => {
    for (const [above, o] of [['stone', undefined], ['spruce_log', { axis: 'x' }], ['iron_chain', { axis: 'y' }], ['oak_fence', undefined]] as const) {
      expect(support([[[0, 3, 0], above, o], [[0, 2, 0], 'bell', CEIL]]), above).toEqual([]);
    }
    expect(support([[[0, 2, 0], 'bell', CEIL]])).toEqual([['support', 'bell']]);
    expect(support([[[0, 3, 0], 'iron_chain', { axis: 'x' }], [[0, 2, 0], 'bell', CEIL]])).toEqual([['support', 'bell']]);
    // Boden darunter trägt eine Deckenglocke nicht
    expect(support([[[0, 1, 0], 'stone'], [[0, 2, 0], 'bell', CEIL]])).toEqual([['support', 'bell']]);
  });

  it('Glocke floor/wall/double_wall: volle Oberseite darunter bzw. volle Wand in Richtung facing', () => {
    expect(support([[[0, 0, 0], 'stone'], [[0, 1, 0], 'bell', { facing: 'north', attach: 'floor' }]])).toEqual([]);
    expect(support([[[0, 0, 0], 'oak_fence'], [[0, 1, 0], 'bell', { facing: 'north', attach: 'floor' }]])).toEqual([['support', 'bell']]);
    expect(support([[[1, 1, 0], 'stone'], [[0, 1, 0], 'bell', { facing: 'east', attach: 'wall' }]])).toEqual([]);
    expect(support([[[-1, 1, 0], 'stone'], [[0, 1, 0], 'bell', { facing: 'east', attach: 'wall' }]])).toEqual([['support', 'bell']]);
    // double_wall ohne zweite Wand wird zu single_wall (BellBlock#updateShape) und hält an der vorhandenen
    expect(support([[[1, 1, 0], 'stone'], [[-1, 1, 0], 'stone'], [[0, 1, 0], 'bell', { facing: 'east', attach: 'double_wall' }]])).toEqual([]);
    expect(support([[[-1, 1, 0], 'stone'], [[0, 1, 0], 'bell', { facing: 'east', attach: 'double_wall' }]])).toEqual([]);
  });

  it('Hebel/Knopf: ceiling braucht volle Unterseite darüber, wall volle Fläche dahinter (gegen facing)', () => {
    expect(support([[[0, 2, 0], 'stone'], [[0, 1, 0], 'lever', { facing: 'north', attach: 'ceiling' }]])).toEqual([]);
    expect(support([[[0, 2, 0], 'oak_fence'], [[0, 1, 0], 'lever', { facing: 'north', attach: 'ceiling' }]])).toEqual([['support', 'lever']]);
    expect(support([[[0, 1, 1], 'stone'], [[0, 1, 0], 'stone_button', { facing: 'north', attach: 'wall' }]])).toEqual([]);
    expect(support([[[0, 1, -1], 'stone'], [[0, 1, 0], 'stone_button', { facing: 'north', attach: 'wall' }]])).toEqual([['support', 'stone_button']]);
  });

  it('Endstab/Blitzableiter: Vanilla kennt keine Stützregel (RodBlock ohne canSurvive) – frei ist kein Verstoß', () => {
    expect(support([[[0, 1, 0], 'end_rod', { vertical: 'up' }], [[1, 1, 0], 'waxed_lightning_rod', { vertical: 'down' }]])).toEqual([]);
    expect(support([[[0, 0, 0], 'oak_fence'], [[0, 1, 0], 'waxed_oxidized_lightning_rod', { vertical: 'up' }]])).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ materialize

const shellOf = (cells: ShellCell[]): Shell => ({ cells, rooms: new Map(), warnings: [] });
const fort = (pos: Vec3, role: string, shape: string, orient?: ShellOrient): ShellCell =>
  ({ pos, kind: 'fort', role, shape, ...(orient !== undefined ? { orient } : {}), roomId: 'o1', exterior: true });

describe('O1 über materialize: Hüllzellen mit Rollen (finial, light_hanging, bell) in allen Themes und Versionen', () => {
  for (const version of VERSIONS) {
    it(`${version}: Blitzableiter/Endstab auf dem Zaun, Kette + hängende Laterne unter dem Balken, Deckenglocke – 0 Verstöße`, () => {
      for (const themeId of THEME_IDS) {
        const cells: ShellCell[] = [
          // Balken (Stamm quer) auf zwei Pfosten
          ...[0, 1, 2, 3, 4].map((x) => fort([x, 4, 0], 'beam', 'log', { axis: 'x' })),
          ...[1, 2, 3].map((y) => fort([0, y, 0], 'beam', 'log', { axis: 'y' })),
          ...[1, 2, 3].map((y) => fort([4, y, 0], 'beam', 'log', { axis: 'y' })),
          ...[0, 1, 2, 3, 4].map((x) => fort([x, 0, 0], 'foundation', 'block')),
          fort([1, 3, 0], 'light_hanging', 'chain', { axis: 'y' }),
          fort([1, 2, 0], 'light_hanging', 'lantern', { hanging: true }),
          fort([3, 3, 0], 'bell', 'bell', { facing: 'south', attach: 'ceiling' }),
          // Turmspitze: Zaun + Stab auf dem Balken
          fort([1, 5, 0], 'beam', 'fence'),
          fort([1, 6, 0], 'finial', 'lightning_rod', { vertical: 'up' }),
          fort([3, 5, 0], 'beam', 'fence'),
          fort([3, 6, 0], 'finial', 'end_rod', { vertical: 'up' }),
        ];
        const r = materialize({ shell: shellOf(cells), placements: [], theme: themes.get(themeId), platform: platformView(version), seed: 1 });
        const at = (p: Vec3) => r.volume.stateAt(p);
        expect(r.violations.filter((v) => v.kind !== 'spawn'), themeId).toEqual([]);
        expect(at([1, 2, 0]), themeId).toMatchObject({ properties: { hanging: 'true' } });
        expect(at([1, 2, 0]).name, themeId).toMatch(/lantern$/);
        expect(at([1, 3, 0]).name, themeId).toMatch(/chain$/);
        expect(at([3, 3, 0]), themeId).toMatchObject({ name: 'bell', properties: { attachment: 'ceiling', facing: 'south' } });
        expect(at([1, 6, 0]), themeId).toMatchObject({ properties: { facing: 'up' } });
        expect(at([1, 6, 0]).name, themeId).toMatch(/^waxed_.*lightning_rod$/); // gewachst: oxidiert im Spiel nicht weiter
        expect(at([3, 6, 0]), themeId).toMatchObject({ name: 'end_rod', properties: { facing: 'up' } });
      }
    });
  }

  it('fehlende Stütze einer Hüllzelle erscheint im Physik-Report (hängende Laterne, Deckenglocke)', () => {
    const cells = [
      fort([0, 0, 0], 'foundation', 'block'),
      fort([0, 3, 0], 'light_hanging', 'lantern', { hanging: true }),
      fort([2, 3, 0], 'bell', 'bell', { facing: 'north', attach: 'ceiling' }),
    ];
    const r = materialize({ shell: shellOf(cells), placements: [], theme: themes.get('medieval'), platform: platformView('26.3'), seed: 1 });
    expect(r.violations.filter((v) => v.kind === 'support').map((v) => v.block).sort()).toEqual(['bell', 'lantern']);
  });
});
