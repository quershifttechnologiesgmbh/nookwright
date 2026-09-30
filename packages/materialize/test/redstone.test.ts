/**
 * R1 (plan/spikes/R1_funktional.md): Redstone-Orientierung (Trichter, Verstärker/Komparator), Staub-Autotiling
 * nach RedStoneWireBlock#getConnectionState, Kolben-Konsistenz, Stützregeln – und die Funktionskomponenten
 * (catalog/components/functional) in allen Themes, beiden Zielversionen und allen Posen.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RoomShellInfo, Shell, ShellCell } from '@mcda/blueprint';
import { Catalog, parseRoomTypeDef, type Orient } from '@mcda/catalog';
import { CellSet, add, pose, resolveRelDir, transformLocal, type Mirror, type Quarter, type RelDir, type Vec3 } from '@mcda/core';
import { Layer, VoxelVolume, blockState } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import {
  KindIndex, WorldView, checkPistons, checkSupport, classifyBlock, finalizeState, materialize, orientProps, resolveRedstoneWires,
  transformRawState, worldOrient, type MaterializePlacement, type MaterializeResult,
} from '../src/index.js';
import { THEME_IDS, VERSIONS, catalog, place, platformView, themes } from './fixtures.js';

type B = readonly [Vec3, string, Record<string, string>?];

function world(blocks: readonly B[], version = '26.3'): WorldView {
  const platform = platformView(version);
  const vol = VoxelVolume.create([9, 5, 9], [-4, -1, -4]);
  for (const [pos, name, props] of blocks) {
    const s = platform.registry.resolveState(name, props ?? {});
    vol.place(pos, { state: blockState(s.name, s.properties), owner: 't', layer: Layer.Furniture });
  }
  return new WorldView(vol, platform);
}

const wire = (w: WorldView, p: Vec3) => {
  const s = w.state(p).properties;
  return { N: s['north'], E: s['east'], S: s['south'], W: s['west'] };
};
const onStone = (...ps: Vec3[]): B[] => ps.flatMap((p): B[] => [[p, 'redstone_wire'], [[p[0], p[1] - 1, p[2]], 'stone']]);

describe('Blockarten und Ausrichtung (Redstone)', () => {
  const reg = platformView('26.3').registry;
  const kinds = new KindIndex(reg);
  const oriented = (block: string, o: Orient, rot: Quarter = 0, mirror: Mirror = 'none', state: Record<string, string> = {}) => {
    const kind = kinds.of(block);
    const p = pose([0, 0, 0], rot, mirror);
    return { ...finalizeState(reg, block, kind, { ...orientProps(kind, block, worldOrient(o, p)), ...transformRawState(kind, state, p) }, 'test').properties };
  };

  it('Klassifikation: Trichter, Verstärker/Komparator, Staub; Kolben/Beobachter/Spender bleiben „directional“', () => {
    expect(kinds.of('hopper')).toBe('hopper');
    expect(kinds.of('repeater')).toBe('diode');
    expect(kinds.of('comparator')).toBe('diode');
    expect(kinds.of('redstone_wire')).toBe('redstone_wire');
    for (const b of ['piston', 'sticky_piston', 'piston_head', 'observer', 'dropper', 'dispenser']) expect(kinds.of(b), b).toBe('directional');
    expect(kinds.of('redstone_wall_torch')).toBe('wall_attached');
    expect(kinds.of('lever')).toBe('face_attached');
    expect(kinds.of('furnace')).toBe('horizontal');
    expect(classifyBlock('hopper', { facing: ['down', 'north', 'south', 'west', 'east'], enabled: ['true', 'false'] })).toBe('hopper');
  });

  it('Trichter: attachTo/front = Auslauf (down oder waagerecht), nie nach oben; dreht mit', () => {
    expect(oriented('hopper', { attachTo: 'down' })).toMatchObject({ facing: 'down', enabled: 'true' });
    expect(oriented('hopper', { attachTo: 'left' })).toMatchObject({ facing: 'east' }); // kanonisch links = Osten
    expect(oriented('hopper', { attachTo: 'left' }, 1)).toMatchObject({ facing: 'south' });
    expect(oriented('hopper', { front: 'front' }, 0, 'z')).toMatchObject({ facing: 'north' });
    expect(oriented('hopper', { back: 'front' })).toMatchObject({ facing: 'north' });
    expect(oriented('hopper', { attachTo: 'down' }, 0, 'none', { enabled: 'false' })).toMatchObject({ enabled: 'false' });
    expect(() => oriented('hopper', { attachTo: 'up' })).toThrow(/nicht nach oben/);
    expect(() => oriented('hopper', {})).toThrow(/braucht eine Ausrichtung/);
  });

  it('Verstärker/Komparator: front = Signalrichtung, Vanilla-facing zeigt zur Eingangsseite', () => {
    expect(oriented('repeater', { front: 'front' })).toMatchObject({ facing: 'north', delay: '1' });
    expect(oriented('repeater', { back: 'back' }, 1, 'none', { delay: '3' })).toMatchObject({ facing: 'east', delay: '3' });
    expect(oriented('comparator', { front: 'back' })).toMatchObject({ facing: 'south', mode: 'compare' });
    expect(oriented('comparator', { front: 'left' }, 0, 'none', { mode: 'subtract' })).toMatchObject({ facing: 'west', mode: 'subtract' });
    expect(() => oriented('comparator', { front: 'up' })).toThrow(/horizontale Richtung/);
    expect(() => oriented('repeater', {})).toThrow(/braucht eine Ausrichtung/);
  });

  it('Kolben/Kopf/Beobachter: front = Schub- bzw. Blickrichtung (auch up/down); Staub nimmt keine Ausrichtung', () => {
    expect(oriented('sticky_piston', { front: 'up' })).toMatchObject({ facing: 'up', extended: 'false' });
    expect(oriented('piston_head', { front: 'left' }, 0, 'none', { type: 'sticky', short: 'false' })).toMatchObject({ facing: 'east', type: 'sticky' });
    expect(oriented('observer', { front: 'front' }, 2)).toMatchObject({ facing: 'north', powered: 'false' });
    expect(oriented('redstone_wall_torch', { attachTo: 'back' })).toMatchObject({ facing: 'south', lit: 'true' });
    expect(oriented('lever', { attachTo: 'down', front: 'front' }, 0, 'none', { powered: 'true' })).toMatchObject({ face: 'floor', powered: 'true' });
    expect(oriented('redstone_wire', {})).toMatchObject({ power: '0' });
    expect(() => oriented('redstone_wire', { front: 'front' })).toThrow(/passt nicht/);
  });
});

describe('Redstone-Staub: Verbindungen wie im Spiel (getConnectionState)', () => {
  it('Einzelstaub = Kreuz; Linie; Enden laufen als Linie weiter', () => {
    const single = world(onStone([0, 0, 0]));
    resolveRedstoneWires(single);
    expect(wire(single, [0, 0, 0])).toEqual({ N: 'side', E: 'side', S: 'side', W: 'side' });
    const line = world(onStone([-1, 0, 0], [0, 0, 0], [1, 0, 0]));
    resolveRedstoneWires(line);
    for (const x of [-1, 0, 1]) expect(wire(line, [x, 0, 0]), `x=${x}`).toEqual({ N: 'none', E: 'side', S: 'none', W: 'side' });
    const corner = world(onStone([0, 0, 0], [1, 0, 0], [0, 0, 1]));
    resolveRedstoneWires(corner);
    expect(wire(corner, [0, 0, 0])).toEqual({ N: 'none', E: 'side', S: 'side', W: 'none' });
  });

  it('Signalquellen verbinden (Hebel, Komparator-Seite), feste Blöcke nicht', () => {
    const w = world([...onStone([0, 0, 0]), [[1, 0, 0], 'lever', { face: 'floor', facing: 'north' }], [[1, -1, 0], 'stone'], [[0, 0, -1], 'stone']]);
    resolveRedstoneWires(w);
    expect(wire(w, [0, 0, 0])).toEqual({ N: 'none', E: 'side', S: 'none', W: 'side' });
    const c = world([...onStone([0, 0, 0]), [[0, 0, 1], 'comparator', { facing: 'east' }], [[0, -1, 1], 'stone']]);
    resolveRedstoneWires(c);
    expect(wire(c, [0, 0, 0]).S).toBe('side');
  });

  it('Verstärker nur längs, Beobachter nur an der Rückseite (Ausgang)', () => {
    const w = world([
      // Querstäube als Linie (ein Einzelstaub wäre ein Kreuz und zeigte in alle Richtungen)
      ...onStone([0, 0, 0], [1, 0, 1], [2, 0, 1], [-2, 0, 0], [-1, 0, 1], [-2, 0, 1]),
      [[1, 0, 0], 'repeater', { facing: 'east' }], [[1, -1, 0], 'stone'],
      [[-1, 0, 0], 'observer', { facing: 'west' }],
    ]);
    resolveRedstoneWires(w);
    expect(wire(w, [0, 0, 0]).E).toBe('side'); //  Verstärker längs (x)
    expect(wire(w, [1, 0, 1]).N).toBe('none'); //  quer
    // Beobachter blickt nach Westen, sein Ausgang (Rückseite) zeigt nach Osten zum Staub (0,0,0) → verbunden
    expect(wire(w, [0, 0, 0]).W).toBe('side');
    expect(wire(w, [-2, 0, 0]).E).toBe('none'); // vor dem Gesicht: keine Verbindung
    expect(wire(w, [-1, 0, 1]).N).toBe('none'); // Seite des Beobachters
  });

  it('Stufen: hinauf = up (Block trägt, darüber Staub), hinab = side; Leiter darüber schneidet', () => {
    const up = world([...onStone([0, 0, 0]), [[1, 0, 0], 'stone'], [[1, 1, 0], 'redstone_wire']]);
    resolveRedstoneWires(up);
    expect(wire(up, [0, 0, 0])).toEqual({ N: 'none', E: 'up', S: 'none', W: 'side' });
    expect(wire(up, [1, 1, 0])).toEqual({ N: 'none', E: 'side', S: 'none', W: 'side' });
    const cut = world([...onStone([0, 0, 0]), [[1, 0, 0], 'stone'], [[1, 1, 0], 'redstone_wire'], [[0, 1, 0], 'stone']]);
    resolveRedstoneWires(cut);
    expect(wire(cut, [0, 0, 0])).toEqual({ N: 'side', E: 'side', S: 'side', W: 'side' }); // abgeschnitten → Kreuz
    expect(wire(cut, [1, 1, 0])).toEqual({ N: 'side', E: 'side', S: 'side', W: 'side' });
    const glass = world([[[0, 0, 0], 'redstone_wire'], [[0, -1, 0], 'stone'], [[1, 0, 0], 'glass'], [[1, 1, 0], 'redstone_wire']]);
    resolveRedstoneWires(glass);
    expect(wire(glass, [0, 0, 0]).E).toBe('up'); // Glas trägt (volle Oberseite), leitet aber nicht
  });

  it('power bleibt, wie der Autor es angibt; Trichter trägt Staub, Luft nicht', () => {
    const w = world([[[0, 0, 0], 'redstone_wire', { power: '7' }], [[0, -1, 0], 'hopper'], [[2, 0, 0], 'redstone_wire'], [[2, 0, 2], 'repeater', { facing: 'north' }], [[2, -1, 2], 'smooth_stone_slab', { type: 'bottom' }]]);
    resolveRedstoneWires(w);
    expect(w.state([0, 0, 0]).properties['power']).toBe('7');
    const v = checkSupport(w).map((x) => `${x.block}@${x.pos?.join(',')}`);
    expect(v).toEqual(expect.arrayContaining(['redstone_wire@2,0,0', 'repeater@2,0,2']));
    expect(v).not.toContain('redstone_wire@0,0,0');
  });
});

describe('Kolben-Konsistenz und Stützen', () => {
  it('ausgefahrener Kolben braucht den passenden Kopf, ein Kopf seinen Kolben', () => {
    const ok = world([[[0, 0, 0], 'sticky_piston', { facing: 'east', extended: 'true' }], [[1, 0, 0], 'piston_head', { facing: 'east', type: 'sticky' }]]);
    expect(checkPistons(ok)).toEqual([]);
    const noHead = world([[[0, 0, 0], 'sticky_piston', { facing: 'east', extended: 'true' }]]);
    expect(checkPistons(noHead).map((v) => v.kind)).toEqual(['redstone']);
    const wrong = world([[[0, 0, 0], 'piston', { facing: 'east', extended: 'true' }], [[1, 0, 0], 'piston_head', { facing: 'east', type: 'sticky' }]]);
    expect(checkPistons(wrong)).toHaveLength(2);
  });

  it('Zuckerrohr auf Erde/Sand/Rohr, nicht auf Stein', () => {
    const w = world([[[0, 0, 0], 'sugar_cane'], [[0, -1, 0], 'dirt'], [[0, 1, 0], 'sugar_cane'], [[2, 0, 0], 'sugar_cane'], [[2, -1, 0], 'stone'], [[-2, 0, 0], 'sugar_cane'], [[-2, -1, 0], 'red_sand'],
      [[1, -1, 0], 'water'], [[-3, -1, 0], 'water']]); // Wasser neben dem Boden-Block (M2: sonst bricht das Rohr)
    expect(checkSupport(w).filter((v) => v.block === 'sugar_cane').map((v) => v.pos)).toEqual([[2, 0, 0]]);
  });
});

// ------------------------------------------------------------------ Funktionskomponenten

const FUNCTIONAL = catalog.all().filter((d) => d.id.startsWith('functional/'));
/**
 * Bodenkante für den Prüfraum: mindestens 9, sonst die größte Ausdehnung einer Variante (Zeilenlänge bzw. Zeilenzahl der
 * Ebenen) + 3 (Ursprung 1, die Pose dreht um 90°). FN-Integration (2026-09-29): die Stall-Boxenreihe (Varianten `three`
 * und `four`, 13 und 17 breit) ragte über den 9er-Boden hinaus – Moosteppich ohne Untergrund ist dann ein Fixturfehler
 * (der Katalog ist in Ordnung), kein Fehler im Theme.
 */
function floorSizeFor(def: { readonly tags: readonly string[]; readonly variants?: readonly { readonly layers?: readonly (readonly string[])[] | undefined }[] | undefined }): number {
  if (def.tags.includes('fn_wide')) return 24;
  let extent = 0;
  for (const v of def.variants ?? []) for (const layer of v.layers ?? []) extent = Math.max(extent, layer.length, ...layer.map((row) => row.length));
  return Math.max(9, extent + 3);
}

const POSES: readonly (readonly [Quarter, Mirror])[] = [[0, 'none'], [1, 'none'], [2, 'none'], [3, 'none'], [1, 'x'], [2, 'z']];

/** Boden (y = 0) unter einer Fläche; Raum ohne Wände (Stützen und Autotiling sind hier das Thema). */
function floorShell(size = 20): Shell {
  const cells: ShellCell[] = [];
  for (let x = -1; x <= size; x++) for (let z = -1; z <= size; z++) cells.push({ pos: [x, 0, z], kind: 'floor', role: 'floor_primary', shape: 'block', roomId: 'r1' });
  const info: RoomShellInfo = { roomId: 'r1', floorIndex: 0, baseY: 1, height: 5, interior: CellSet.rect(-1, -1, size, size), doors: [], windows: [] };
  return { cells, rooms: new Map([['r1', info]]), warnings: [] };
}

function run(pl: MaterializePlacement, version: string, theme = 'medieval', size = 9): MaterializeResult {
  return materialize({ shell: floorShell(size), placements: [pl], theme: themes.get(theme), platform: platformView(version), seed: 5 });
}

/** Weltposition einer lokalen Zelle und Weltrichtung einer relativen Seite unter der Pose der Platzierung. */
function locate(pl: MaterializePlacement) {
  const { placed } = pl;
  const at = (local: Vec3): Vec3 => add(placed.pose.pos, transformLocal(local, placed.expanded.size, placed.pose.rot, placed.pose.mirror));
  const dir = (rel: RelDir) => resolveRelDir(rel, placed.pose);
  return { at, dir };
}

describe('Funktionskomponenten (catalog/components/functional)', () => {
  it('der Katalog enthält die Funktionskomponenten', () => {
    expect(FUNCTIONAL.map((d) => d.id)).toEqual(expect.arrayContaining([
      'functional/animal_pen', 'functional/auto_brewer', 'functional/auto_composter', 'functional/auto_furnace', 'functional/bookshelf_door',
      'functional/crop_plot', 'functional/egg_collector', 'functional/item_sorter', 'functional/melon_patch', 'functional/piston_door_2x2',
      'functional/smelter_row', 'functional/sugarcane_farm',
    ]));
  });

  // Je Komponente und Zielversion ein eigener Test (FN-Welle: der Katalog wächst, ein Sammeltest lief über das Zeitlimit)
  for (const version of VERSIONS) {
    for (const def of FUNCTIONAL) {
      it(`${version}: ${def.id} – jede Variante × Theme × Pose materialisiert ohne Verstöße (Stütze, Masken, Kolben)`, () => {
        const reg = platformView(version).registry;
        let n = 0;
        for (const variant of def.variants?.map((v) => v.id) ?? [undefined]) {
          for (const theme of THEME_IDS) {
            for (const [rot, mirror] of POSES) {
              const where = `${def.id}#${variant ?? '-'} ${theme} rot${rot} ${mirror}`;
              const r = run(place('c', def.id, [1, 1, 1], rot, variant, mirror), version, theme, floorSizeFor(def)); // FN: breite Anlagen brauchen mehr Boden (Tag fn_wide: Hallen; sonst nach Variantenmaß)
              expect(r.violations.filter((v) => v.kind !== 'spawn'), where).toEqual([]);
              for (const c of r.volume.cellsOf('c')) expect(reg.isValidState(c.state.name, c.state.properties, { complete: true }), where).toBe(true);
              n++;
            }
          }
        }
        expect(n).toBeGreaterThanOrEqual(THEME_IDS.length * POSES.length);
      }, 120_000);
    }
  }

  it('Lagersortierer: Staub Komparator → Stufe hinab → Seite des Sperr-Komparators; Sperre im Ruhezustand an', () => {
    for (const [rot, mirror] of POSES) {
      const pl = place('s', 'functional/item_sorter', [1, 1, 1], rot, undefined, mirror);
      const r = run(pl, '1.21.11');
      const { at, dir } = locate(pl);
      const side = (p: Vec3, rel: RelDir) => r.volume.stateAt(at(p)).properties[dir(rel)];
      const where = `rot${rot} ${mirror}`;
      // D1 hinter dem Filter-Komparator: vorn (Komparator-Ausgang) + links (Stufe hinab), hinten (Wand) nicht
      expect([side([1, 1, 0], 'front'), side([1, 1, 0], 'left'), side([1, 1, 0], 'back')], where).toEqual(['side', 'side', 'none']);
      // Bodenstaub: rechts hinauf (Träger leitet, darüber D1), vorn in die Seite des Sperr-Komparators, links (Trenner) nicht
      expect([side([2, 0, 0], 'right'), side([2, 0, 0], 'front'), side([2, 0, 0], 'left')], where).toEqual(['up', 'side', 'none']);
      expect([side([4, 0, 0], 'left'), side([4, 0, 0], 'front')], where).toEqual(['up', 'side']);
      // Sperr-Komparatoren lesen hinten den Kessel (Mitte), geben nach außen auf S aus; Vergleichsmodus, an
      expect(r.volume.stateAt(at([2, 0, 1])).properties, where).toMatchObject({ facing: dir('left'), mode: 'compare', powered: 'true' });
      expect(r.volume.stateAt(at([4, 0, 1])).properties, where).toMatchObject({ facing: dir('right'), mode: 'compare', powered: 'true' });
      expect(r.volume.stateAt(at([3, 0, 1])), where).toMatchObject({ name: 'water_cauldron', properties: { level: '1' } });
      expect(r.volume.stateAt(at([1, 0, 2])).properties, where).toMatchObject({ enabled: 'false', facing: dir('front') });
      expect(r.volume.stateAt(at([1, 1, 1])).properties, where).toMatchObject({ facing: dir('front'), powered: 'false' }); // liest F (vorn)
      const wires = r.volume.cellsOf('s').filter((c) => c.state.name === 'redstone_wire');
      expect(wires).toHaveLength(4);
      for (const c of wires) expect(c.state.properties['power']).toBe('0');
      expect(r.volume.cellsOf('s').some((c) => c.state.name.includes('torch')), where).toBe(false);
    }
  });

  it('2×2-Kolbentor: Staub-Treppen hinten führen hinauf (up), Sturz-Staub vollständig verbunden', () => {
    for (const [rot, mirror] of POSES) {
      const pl = place('d', 'functional/piston_door_2x2', [1, 1, 1], rot, undefined, mirror);
      const r = run(pl, '26.3');
      const { at, dir } = locate(pl);
      const side = (p: Vec3, rel: RelDir) => r.volume.stateAt(at(p)).properties[dir(rel)];
      const where = `rot${rot} ${mirror}`;
      expect([side([0, 1, 0], 'left'), side([1, 2, 0], 'left'), side([5, 1, 0], 'right'), side([4, 2, 0], 'right')], where).toEqual(['up', 'up', 'up', 'up']);
      for (let x = 0; x < 5; x++) expect(side([x, 3, 1], 'left'), `${where} x=${x}`).toBe('side');
      expect([side([2, 3, 0], 'front'), side([3, 3, 0], 'front')], where).toEqual(['side', 'side']);
      expect(r.volume.stateAt(at([0, 0, 1])).properties, where).toMatchObject({ facing: dir('left'), extended: 'false' });
      expect(r.volume.stateAt(at([2, 2, 2])).properties, where).toMatchObject({ face: 'wall', facing: dir('front'), powered: 'false' });
    }
  });

  it('Zuckerrohr-Automat: Staub hängt am Beobachter-Ausgang; Bücherregal-Tür ist geschlossen und konsistent', () => {
    const pl = place('z', 'functional/sugarcane_farm', [1, 1, 1], 1);
    const r = run(pl, '1.21.11');
    const { at, dir } = locate(pl);
    expect(r.volume.stateAt(at([1, 3, 0])).properties[dir('front')]).toBe('side');
    expect(r.volume.stateAt(at([1, 3, 1])).properties).toMatchObject({ facing: dir('front') });
    const door = run(place('b', 'functional/bookshelf_door', [1, 1, 1], 3), '26.3');
    expect(checkPistons(new WorldView(door.volume, platformView('26.3')))).toEqual([]);
    expect(door.volume.cellsOf('b').filter((c) => c.state.name === 'piston_head')).toHaveLength(2);
    expect(door.volume.cellsOf('b').find((c) => c.state.name === 'lever')?.state.properties['powered']).toBe('true');
  });
});

describe('Raumtypen der Welle R1', () => {
  const dir = fileURLToPath(new URL('../../../catalog/roomtypes', import.meta.url));
  const roomCatalog = Catalog.of(catalog.all(), ['workshop_redstone', 'farm_room', 'stable'].map((id) => {
    const r = parseRoomTypeDef(readFileSync(join(dir, `${id}.json5`), 'utf8'), id);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.value;
  }));
  it('workshop_redstone, farm_room, stable: alle Tags haben Komponenten (1.21.11 und 26.3)', () => {
    for (const id of ['workshop_redstone', 'farm_room', 'stable']) {
      for (const dv of [4671, 5023]) expect(roomCatalog.missingTags(id, dv), `${id} ${dv}`).toEqual([]);
    }
  });
});
