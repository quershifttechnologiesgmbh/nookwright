/**
 * Solver v2 (S2): Reihenfolge „Most Constrained First“, Signatur große Form zuerst, Backtracking, Sockets
 * (face, hang, facing, Konsistenz, Paare), Funktionszonen, Reihen, gesperrte Zellen, Qualitätswert.
 * Synthetische Komponenten prüfen die Mechanik isoliert; der Katalog-Fuzz die harten Garantien.
 */
import { describe, expect, it } from 'vitest';
import { Catalog, ComponentDefSchema, type ComponentDef, type RoomTypeDef } from '@mcda/catalog';
import { CellSet, cellKey, pose, resolveRelDir, type Vec3 } from '@mcda/core';
import {
  RoomPlanner, expandComponent, furnishRoom, orderProgram, placeComponent, rotationForFront,
  type FurnishResult, type PlacedComponent, type ProgramItem, type RoomGeometry,
} from '../src/index.js';
import { HEAVY_TIMEOUT, expectCpuMsBelow, medianCpuMs } from '../../core/test/support/timing.js';
import { DV, SIGNATURE, assertHardGuarantees, catalog, lShellRoom, shellRoom } from './fixtures.js';

const MAT = { block: 'minecraft:oak_planks' };
const LAMP = { block: 'minecraft:lantern' };

/** Quader-Komponente w × d × h aus Planken (kanonisch, Front Süden). */
function box(id: string, tags: string[], w: number, d: number, extra: Record<string, unknown> = {}, h = 1): ComponentDef {
  const layer = Array.from({ length: d }, () => 'X'.repeat(w));
  return ComponentDefSchema.parse({
    id, kind: 'static', category: 'furniture', tags, obtainability: 'survival', mount: 'floor', rotations: 'backToWall',
    layers: Array.from({ length: h }, () => layer), legend: { X: MAT }, ...extra,
  });
}

function roomType(id: string, required: RoomTypeDef['required'], extra: Partial<RoomTypeDef> = {}): RoomTypeDef {
  return { id, name: id, minArea: 1, coverage: { target: 0 }, required, optional: [], ...extra };
}

const cellsOf = (p: PlacedComponent): string[] => p.cells.map((c) => cellKey(c.pos[0], c.pos[2]));
const ascii = (g: RoomGeometry, r: FurnishResult): string => r.placements.map((p) => `${p.key} ${p.componentId} ${p.pose.pos.join(',')} r${p.pose.rot}`).join('\n') + `\n${g.roomId}`;

describe('Reihenfolge „Most Constrained First“', () => {
  const item = (entry: number, required: boolean, signature = false, extra = false): ProgramItem => ({ tags: [`t${entry}`], required, pref: {}, entry, signature, ...(extra ? { extra } : {}) });

  it('Pflicht vor Optional, Signatur zuerst, dann kleinste Domäne, dann größte Grundfläche; Mindestmengen vor Zusatz', () => {
    const program = [item(0, true), item(1, true, true), item(2, true), item(3, false, false, true), item(4, false), item(5, true)];
    const stats: Record<number, { domain: number; footprint: number }> = {
      0: { domain: 50, footprint: 2 }, 1: { domain: 400, footprint: 6 }, 2: { domain: 10, footprint: 1 },
      3: { domain: 1, footprint: 9 }, 4: { domain: 999, footprint: 1 }, 5: { domain: 50, footprint: 4 },
    };
    expect(orderProgram(program, (e) => stats[e]!)).toEqual([1, 2, 5, 0, 4, 3]);
  });
});

describe('Signatur-Möbel: große Form zuerst, Kompaktform als Rückfall', () => {
  /** Anteil großer Formen (Grundfläche > kleinste der Familie); `feasible` = eine große Form passt in den leeren Raum. */
  function measure(rooms: readonly RoomGeometry[], seeds: number) {
    let large = 0, total = 0, feasL = 0, feasT = 0;
    for (const [type, tag] of Object.entries(SIGNATURE)) {
      const opts = catalog.byTags([tag], DV).flatMap((d) => (d.variants?.map((v) => v.id) ?? [undefined]).map((v) => {
        const e = expandComponent(d, v);
        return { d, v, fp: e.size[0] * e.size[2] };
      }));
      const minFp = Math.min(...opts.map((o) => o.fp));
      for (const g of rooms) {
        if (g.interior.size < catalog.roomType(type).minArea) continue;
        const planner = new RoomPlanner(g);
        const feasible = opts.some((o) => o.fp > minFp && planner.candidates(o.d, o.v).some((p) => planner.connected(p)));
        for (let seed = 0; seed < seeds; seed++) {
          const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
          const p = r.placements.find((x) => catalog.get(x.componentId).tags.includes(tag));
          expect(p, `${type} ${g.roomId} seed ${seed}: Signatur fehlt`).toBeDefined();
          const e = expandComponent(catalog.get(p!.componentId), p!.variantId);
          const big = e.size[0] * e.size[2] > minFp;
          total++;
          if (big) large++;
          if (feasible) {
            feasT++;
            if (big) feasL++;
          }
        }
      }
    }
    return { large: large / total, feasible: feasL / feasT, n: total };
  }

  it('Einzelräume 7×6 … 16×12 (Außen- und Innenwände): große Form, wann immer sie passt', { timeout: HEAVY_TIMEOUT }, () => {
    const rooms = [[7, 6], [9, 8], [10, 8], [12, 9], [16, 12]].flatMap(([w, d]) =>
      [[], ['north']].map((inner) => ({ ...shellRoom(w!, d!, { inner: inner as ['north'] }), roomId: `${w}x${d}${inner.join('')}` })),
    );
    const m = measure(rooms, 3);
    // Messung S2 (plan/spikes/S2_solver.md): v1 53 % gesamt / 62 % wo möglich → v2 ≈ 86 % / ≈ 100 %
    // W2 (26.09.2026): Regel „freie Sicht“ (W2-FW) – die Einrichtung hält die Sichtachsen der Fenster (Tiefe 1…3) von
    // Stauraum-Möbeln frei, die Machbarkeit hier prüft der RoomPlanner ohne Sichtachsen; die Testräume haben Fenster
    // alle 2 Zellen, deshalb passt die große Regalwand seltener (gemessen 93 %)
    expect(m.feasible, `wo möglich: ${m.feasible}`).toBeGreaterThanOrEqual(0.9);
    expect(m.large, `gesamt: ${m.large}`).toBeGreaterThanOrEqual(0.75);
  });

  it('große Formen wechseln sich ab (keine Einheitslösung)', () => {
    const forms = new Set<string>();
    for (let seed = 0; seed < 24; seed++) {
      const r = furnishRoom(shellRoom(12, 9, { inner: ['north'] }), catalog.roomType('storage'), catalog, { seed, dataVersion: DV });
      const p = r.placements.find((x) => catalog.get(x.componentId).tags.includes('storage_wall'))!;
      forms.add(p.componentId);
    }
    expect(forms.size).toBeGreaterThanOrEqual(2);
  });

  it('Qualität: Kompaktform senkt den Teilwert „Signatur-Möbel“ und begründet es', () => {
    const small = furnishRoom(shellRoom(7, 6), catalog.roomType('kitchen'), catalog, { seed: 1, dataVersion: DV });
    const big = furnishRoom(shellRoom(12, 9, { inner: ['north'] }), catalog.roomType('kitchen'), catalog, { seed: 1, dataVersion: DV });
    const sig = (r: FurnishResult) => r.quality.parts.find((p) => p.id === 'signature')!;
    expect(sig(small).value).toBeLessThan(sig(big).value);
    expect(sig(small).detail).toMatch(/Kompaktform/);
    expect(sig(big).value).toBeGreaterThan(0.7);
  });
});

describe('Backtracking für Pflichtobjekte (research/02 §7.6)', () => {
  // Signatur (groß 3×1 oder kompakt 1×1) und ein zweites Pflichtobjekt 3×1: beide brauchen die einzige lange Wand.
  // W3 (27.09.2026): Möbel mit einer Reihe hoher Rückseite lehnen jetzt auch unter Fenstern an – die Testmöbel sind
  // deshalb 2 hoch, damit Ost-/Westwand (Doppelfenster) für sie weiter nicht zählen.
  const defs = [box('t/sig_big', ['sig'], 3, 1, {}, 2), box('t/sig_small', ['sig'], 1, 1, {}, 2), box('t/bench', ['bench'], 3, 1, {}, 2)];
  const cat = Catalog.of(defs);
  const rt = roomType('bt', [{ tags: ['sig'], count: [1, 1] }, { tags: ['bench'], count: [1, 1] }]);
  // 5 × 4 innen: Nordwand fest (Innenwand), Ost/West mit Doppelfenster, Süd mit Tür → nur die Nordwand hat 3 am Stück
  const g = shellRoom(7, 6, { inner: ['north'] });

  // W8-A (2026-09-27): mit Forward Checking (Standard) erkennt schon die Wahl der großen Signatur, dass sie der Bank die
  // letzte Pose nimmt – die Kompaktform kommt ohne Backtracking. Das Backtracking selbst prüft der Lauf ohne Forward Checking.
  it('die große Signatur weicht der Bank: Opfer umstellen statt Warnung (ohne Forward Checking)', () => {
    for (let seed = 0; seed < 10; seed++) {
      const r = furnishRoom(g, rt, cat, { seed, dataVersion: DV, forwardCheck: false });
      expect(r.warnings, ascii(g, r)).toEqual([]);
      expect(r.placements.map((p) => p.componentId).sort()).toEqual(['t/bench', 't/sig_small']);
      expect(r.quality.notes.join()).toMatch(/Backtracking/);
      assertHardGuarantees(g, r, `seed ${seed}`);
    }
  });

  it('W8-A Forward Checking: die große Signatur weicht der Bank schon bei der Wahl (kein Backtracking)', () => {
    for (let seed = 0; seed < 10; seed++) {
      const r = furnishRoom(g, rt, cat, { seed, dataVersion: DV });
      expect(r.warnings, ascii(g, r)).toEqual([]);
      expect(r.placements.map((p) => p.componentId).sort()).toEqual(['t/bench', 't/sig_small']);
      expect(r.quality.notes.join()).not.toMatch(/Backtracking/);
      assertHardGuarantees(g, r, `seed ${seed}`);
    }
  });

  it('unlösbar bleibt eine Warnung (zwei Bänke, eine Wand)', () => {
    const two = roomType('bt2', [{ tags: ['sig'], count: [1, 1] }, { tags: ['bench'], count: [2, 2] }]);
    const r = furnishRoom(g, two, cat, { seed: 3, dataVersion: DV });
    expect(r.warnings.join()).toMatch(/Pflichtobjekt bench passt nicht/);
    expect(r.quality.parts.find((p) => p.id === 'required')!.value).toBeCloseTo(2 / 3);
  });
});

describe('Sockets: facing, Konsistenz, Paare, face, hang', () => {
  const stool = ComponentDefSchema.parse({
    id: 't/stool', kind: 'static', category: 'furniture', tags: ['t_seat'], obtainability: 'survival', mount: 'floor', rotations: 'all',
    variants: [{ id: 'a', layers: [['X']], legend: { X: MAT } }, { id: 'b', layers: [['X']], legend: { X: MAT } }, { id: 'c', layers: [['X']], legend: { X: MAT } }],
  });
  const seat = (id: string, side: string, at: Vec3, extra: Record<string, unknown> = {}) => ({ id, type: 'adjacent', at, side, accepts: ['t_seat'], facing: 'toParent', ...extra });
  const table = (consistency?: string) =>
    box('t/table', ['t_table'], 2, 2, {
      rotations: [0, 1],
      sockets: [seat('n', 'back', [0, 0, -1]), seat('s', 'front', [1, 0, 2]), seat('w', 'right', [-1, 0, 1]), seat('e', 'left', [2, 0, 0])].map((s) => ({ ...s, ...(consistency ? { consistency } : {}) })),
    });
  const rt = roomType('dining', [{ tags: ['t_table'], count: [1, 1], placement: { zones: ['center'] } }]);
  const g = shellRoom(10, 9);

  it('toParent: jeder Hocker schaut zum Tisch; adjacent-Kinder haben standardmäßig dieselbe Variante', () => {
    const cat = Catalog.of([table(), stool]);
    for (let seed = 0; seed < 12; seed++) {
      const r = furnishRoom(g, rt, cat, { seed, dataVersion: DV });
      const t = r.placed.find((p) => p.expanded.defId === 't/table')!;
      const seats = r.placements.filter((p) => p.componentId === 't/stool');
      expect(seats.length, ascii(g, r)).toBeGreaterThanOrEqual(3); // ein Platz an der Wand kann eine Tasche bilden
      expect(new Set(seats.map((s) => s.variantId)).size).toBe(1);
      const tableCells = new Set(cellsOf(t));
      for (const s of seats) {
        const front = resolveRelDir('front', s.pose);
        const step = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[front as 'north']!;
        expect(tableCells.has(cellKey(s.pose.pos[0] + step[0]!, s.pose.pos[2] + step[1]!)), `Hocker ${s.socketId} schaut nach ${front}`).toBe(true);
      }
      assertHardGuarantees(g, r);
    }
  });

  it('consistency: free erlaubt gemischte Varianten', () => {
    const cat = Catalog.of([table('free'), stool]);
    let mixed = 0;
    for (let seed = 0; seed < 12; seed++) {
      const r = furnishRoom(g, rt, cat, { seed, dataVersion: DV });
      if (new Set(r.placements.filter((p) => p.componentId === 't/stool').map((s) => s.variantId)).size > 1) mixed++;
    }
    expect(mixed).toBeGreaterThan(6);
  });

  it('pairWith: Paare werden gemeinsam gewürfelt – einseitig nur, wenn die andere Seite nicht geht', () => {
    const night = box('t/night', ['t_night'], 1, 1, { rotations: 'all' });
    const bed = box('t/bed', ['t_bed'], 1, 2, {
      sockets: [
        { id: 'l', type: 'adjacent', at: [1, 0, 0], side: 'left', accepts: ['t_night'], prob: 0.5, pairWith: 'r' },
        { id: 'r', type: 'adjacent', at: [-1, 0, 0], side: 'right', accepts: ['t_night'], prob: 0.5 },
      ],
    });
    const cat = Catalog.of([bed, night]);
    const counts = [0, 0, 0];
    for (let seed = 0; seed < 40; seed++) {
      const gg = shellRoom(8 + (seed % 3), 7);
      const r = furnishRoom(gg, roomType('b', [{ tags: ['t_bed'], count: [1, 1] }]), cat, { seed, dataVersion: DV });
      const n = r.placements.filter((p) => p.componentId === 't/night').length;
      counts[n]!++;
      if (n === 1) {
        const bedP = r.placed.find((p) => p.expanded.defId === 't/bed')!;
        const planner = new RoomPlanner(gg, r.placed);
        expect(planner.socketPoses(night, undefined, [{ key: 'b', placed: bedP }]), 'freie Gegenseite wurde nicht gefüllt').toEqual([]);
      }
    }
    expect(counts[0]).toBeGreaterThan(5);
    expect(counts[2]).toBeGreaterThan(5);
  });

  it('face: Rahmen an der Seitenfläche eines Schranks, Rücken zum Träger; ohne Träger kein Kind', () => {
    const frame = ComponentDefSchema.parse({
      id: 't/frame', kind: 'static', category: 'attachment', tags: ['t_frame'], obtainability: 'survival', mount: 'wall', rotations: 'backToWall',
      walkable: true, layers: [['X']], legend: { X: MAT },
    });
    // Schrank 2 breit, 2 hoch; rechts daneben (kanonisch links = +x) in Höhe 1 ein Rahmen an seiner Seitenfläche
    const cabinet = box('t/cabinet', ['t_cab'], 2, 1, { sockets: [{ id: 'side', type: 'face', at: [2, 1, 0], side: 'right', accepts: ['t_frame'] }] }, 2);
    const cat = Catalog.of([cabinet, frame]);
    for (let seed = 0; seed < 12; seed++) {
      const gg = shellRoom(9, 7, { inner: ['north', 'east', 'west'] });
      const r = furnishRoom(gg, roomType('c', [{ tags: ['t_cab'], count: [1, 1] }]), cat, { seed, dataVersion: DV });
      const cab = r.placed.find((p) => p.expanded.defId === 't/cabinet')!;
      const fr = r.placed.find((p) => p.expanded.defId === 't/frame');
      if (fr === undefined) continue; // Seite an der Wand / in der Türzone
      const back = resolveRelDir('back', fr.pose);
      const step = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] }[back as 'north']!;
      const behind = fr.cells[0]!.pos.map((v, i) => v + step[i]!).join(',');
      expect(cab.cells.map((c) => c.pos.join(','))).toContain(behind);
      expect(fr.pose.pos[1]).toBe(gg.baseY + 1);
    }
    // frei stehender Block ohne Wand: Socket über ihm hat in Blickrichtung Luft → kein Träger
    const post = box('t/post', ['t_post'], 1, 1, { rotations: 'all', sockets: [{ id: 'f', type: 'face', at: [0, 1, 0], side: 'back', accepts: ['t_frame'] }] });
    const gg = shellRoom(9, 7);
    const planner = new RoomPlanner(gg);
    const centre = placeComponent(expandComponent(post), pose([3, gg.baseY, 2], 0));
    expect(planner.socketPoses(frame, undefined, [{ key: 'p', placed: centre }])).toEqual([]);
    // an der festen Nordwand (Innenwand ohne Fenster): Träger = Raumwand
    const g2 = shellRoom(9, 7, { inner: ['north'] });
    const atWall = placeComponent(expandComponent(post), pose([1, g2.baseY, 0], 0));
    const ok = new RoomPlanner(g2, [atWall]).socketPoses(frame, undefined, [{ key: 'p', placed: atWall }]);
    expect(ok).toHaveLength(1);
    expect(resolveRelDir('back', ok[0]!.placed.pose)).toBe('north');
  });

  it('hang: unter der Decke über einem Tisch; unter einem Sturz nur über Möbeln (Kopffreiheit)', () => {
    const lamp = ComponentDefSchema.parse({
      id: 't/lamp', kind: 'static', category: 'light', tags: ['t_lamp'], obtainability: 'survival', mount: 'ceiling', rotations: [0], layers: [['L']], legend: { L: LAMP },
    });
    const desk = box('t/desk', ['t_desk'], 1, 1, { rotations: 'all', sockets: [{ id: 'up', type: 'hang', at: [0, 99, 0], accepts: ['t_lamp'] }] });
    const cat = Catalog.of([desk, lamp]);
    const gg = shellRoom(9, 7, { height: 4 });
    const r = furnishRoom(gg, roomType('d', [{ tags: ['t_desk'], count: [1, 1] }]), cat, { seed: 1, dataVersion: DV });
    const d = r.placed.find((p) => p.expanded.defId === 't/desk')!;
    const l = r.placed.find((p) => p.expanded.defId === 't/lamp')!;
    expect(l.pose.pos).toEqual([d.pose.pos[0], gg.baseY + gg.height - 1, d.pose.pos[2]]);
    expect(r.placements.find((p) => p.componentId === 't/lamp')!.socketId).toBe('up');

    // Torbogen 3 breit, 3 hoch: Sturz in Höhe 2, darunter hängt die Laterne in Höhe 1
    const arch = (counter: boolean) =>
      ComponentDefSchema.parse({
        id: 't/arch', kind: 'static', category: 'furniture', tags: ['t_arch'], obtainability: 'survival', mount: 'floor', rotations: [0],
        layers: [[counter ? 'XXX' : 'X.X'], ['X.X'], ['XXX']], legend: { X: MAT },
        sockets: [{ id: 'lamp', type: 'hang', at: [1, 1, 0], accepts: ['t_lamp'] }],
      });
    const g4 = shellRoom(9, 7, { height: 4 });
    for (const counter of [false, true]) {
      const placed = placeComponent(expandComponent(arch(counter)), pose([2, g4.baseY, 2], 0));
      const poses = new RoomPlanner(g4, [placed]).socketPoses(lamp, undefined, [{ key: 'a', placed }]);
      expect(poses.length, counter ? 'über der Theke erlaubt' : 'über dem Laufweg verboten').toBe(counter ? 1 : 0);
      if (counter) expect(poses[0]!.placed.pose.pos).toEqual([3, g4.baseY + 1, 2]);
    }
  });

  it('rotationForFront: Front (kanonisch Süden) zeigt in die gewünschte Richtung', () => {
    for (const d of ['north', 'east', 'south', 'west'] as const) expect(resolveRelDir('front', pose([0, 0, 0], rotationForFront(d)))).toBe(d);
  });
});

describe('Funktionszonen großer Räume', () => {
  it('kleine Räume bleiben eine Zone; große zerfallen in 2–4 Teilflächen, die den Raum genau abdecken', () => {
    expect(furnishRoom(shellRoom(12, 9), catalog.roomType('tavern'), catalog, { seed: 1, dataVersion: DV }).zones).toHaveLength(1);
    const g = shellRoom(20, 14);
    const r = furnishRoom(g, catalog.roomType('tavern'), catalog, { seed: 1, dataVersion: DV });
    expect(r.zones.length).toBeGreaterThanOrEqual(2);
    expect(r.zones.length).toBeLessThanOrEqual(4);
    expect(r.zones.reduce((n, z) => n + z.cells.size, 0)).toBe(g.interior.size);
    expect(r.zones.reduce((u, z) => u.union(z.cells), CellSet.empty()).equals(g.interior)).toBe(true);
  });

  it('Taverne 20×14: Tische verteilen sich auf mehrere Zonen, jede Zone hat Bodenmöbel, harte Garantien halten', { timeout: HEAVY_TIMEOUT }, () => {
    for (let seed = 0; seed < 8; seed++) {
      const g = shellRoom(20, 14, { inner: seed % 2 === 0 ? [] : ['north'] });
      const r = furnishRoom(g, catalog.roomType('tavern'), catalog, { seed, dataVersion: DV });
      expect(r.warnings).toEqual([]);
      assertHardGuarantees(g, r, `seed ${seed}`);
      const zoneOf = (p: PlacedComponent) => r.zones.findIndex((z) => z.cells.has(p.pose.pos[0], p.pose.pos[2]));
      const top = r.placements.map((p, i) => ({ p, placed: r.placed[i]! })).filter((x) => x.p.parentKey === undefined && x.placed.expanded.mount === 'floor');
      const tables = top.filter((x) => catalog.get(x.p.componentId).tags.includes('tavern_table'));
      expect(new Set(tables.map((x) => zoneOf(x.placed))).size, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(new Set(top.map((x) => zoneOf(x.placed))).size).toBe(r.zones.length);
      expect(r.quality.parts.some((p) => p.id === 'zones')).toBe(true);
    }
  });

  it('benannte Zonen: `doorAffinity` wählt die Teilfläche, Einträge landen in ihrer Zone', () => {
    const cat = Catalog.of([box('t/a', ['a'], 2, 1, { rotations: 'all' }), box('t/b', ['b'], 2, 1, { rotations: 'all' })]);
    const rt = roomType('z', [{ tags: ['a'], count: [2, 2], zone: 'back' }, { tags: ['b'], count: [2, 2], zone: 'front' }], {
      zones: [{ id: 'back', doorAffinity: 'far' }, { id: 'front', doorAffinity: 'near' }],
    });
    let hits = 0, total = 0;
    for (let seed = 0; seed < 10; seed++) {
      const g = shellRoom(18, 12);
      const r = furnishRoom(g, rt, cat, { seed, dataVersion: DV });
      const far = r.zones.reduce((m, z, i) => (z.dDoor > r.zones[m]!.dDoor ? i : m), 0);
      const near = r.zones.reduce((m, z, i) => (z.dDoor < r.zones[m]!.dDoor ? i : m), 0);
      for (const p of r.placed) {
        const want = p.expanded.defId === 't/a' ? far : near;
        total++;
        if (r.zones[want]!.cells.has(p.pose.pos[0], p.pose.pos[2])) hits++;
      }
    }
    expect(hits / total).toBeGreaterThanOrEqual(0.9);
  });
});

describe('Reihen-Muster (research/07: Bett, Nachttisch, Bett …)', () => {
  it('vier Betten in einer Reihe mit festem Rhythmus, Nachttische dazwischen', () => {
    const rt = roomType('dorm', [{ tags: ['bed_single'], count: [4, 4], pattern: { kind: 'row', gap: 1 } }]);
    // nur das Einzelbett (research/17: Kranken-, Kinder-, Etagenbett … tragen inzwischen auch `bed_single`)
    const singles = Catalog.of(catalog.all().filter((d) => !d.tags.includes('bed_single') || d.id === 'bed/single'));
    let rows = 0, alternating = 0;
    const seeds = 12;
    for (let seed = 0; seed < seeds; seed++) {
      const g = shellRoom(14, 8, { inner: ['north'] });
      const r = furnishRoom(g, rt, singles, { seed, dataVersion: DV });
      assertHardGuarantees(g, r);
      const beds = r.placed.filter((p) => p.expanded.defId === 'bed/single');
      expect(beds).toHaveLength(4);
      const rot = beds[0]!.pose.rot;
      const even = rot % 2 === 0;
      const along = beds.map((b) => b.pose.pos[even ? 0 : 2]).sort((a, b) => a - b);
      const line = new Set(beds.map((b) => b.pose.pos[even ? 2 : 0]));
      if (beds.every((b) => b.pose.rot === rot) && line.size === 1 && along.every((v, i) => i === 0 || v - along[i - 1]! === 2)) rows++;
      const nights = r.placed.filter((p) => p.expanded.defId === 'storage/nightstand_barrel').map((p) => p.pose.pos[even ? 0 : 2]);
      if (along.slice(1).some((v) => nights.includes(v - 1))) alternating++;
    }
    expect(rows / seeds).toBeGreaterThanOrEqual(0.75);
    expect(alternating).toBeGreaterThan(seeds / 2);
  });
});

describe('Gesperrte Zellen (Treppe, `RoomGeometry.blocked`)', () => {
  it('nichts auf gesperrten Zellen, sie bleiben erreichbar; alle Raumtypen', { timeout: HEAVY_TIMEOUT }, () => {
    const blocked = CellSet.rect(5, 1, 6, 3);
    for (const type of catalog.roomTypeIds()) {
      for (let seed = 0; seed < 6; seed++) {
        const g = shellRoom(10, 8, { blocked, inner: ['north'] });
        const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
        assertHardGuarantees(g, r, `${type} seed ${seed}`);
        for (const p of r.placed) for (const c of [...p.cells.map((x) => x.pos), ...p.air]) expect(blocked.has(c[0], c[2]), `${type}: ${p.expanded.defId}`).toBe(false);
      }
    }
    expect(new RoomPlanner(shellRoom(10, 8, { blocked })).poses(catalog.get('storage/chest')).some((p) => blocked.has(p.pose.pos[0], p.pose.pos[2]))).toBe(false);
  });
});

describe('Fuzz: Raumgrößen und -formen, alle Raumtypen', () => {
  const rooms = (): RoomGeometry[] => [
    ...[[7, 6], [8, 7], [9, 8], [10, 8], [12, 9], [14, 10]].flatMap(([w, d]) => [
      { ...shellRoom(w!, d!), roomId: `${w}x${d}` },
      { ...shellRoom(w!, d!, { inner: ['north', 'east'], doorSide: 'west', doorAt: 1 }), roomId: `${w}x${d}i` },
    ]),
    shellRoom(9, 8, { height: 2 }),
    lShellRoom(),
  ];

  for (const type of catalog.roomTypeIds()) {
    it(`${type}: 0 Kollisionen, 0 Taschen, Pflicht erfüllt, Qualität 0–1`, { timeout: HEAVY_TIMEOUT }, () => {
      for (const g of rooms()) {
        if (g.interior.size < catalog.roomType(type).minArea) continue;
        for (let seed = 0; seed < 3; seed++) {
          const r = furnishRoom(g, catalog.roomType(type), catalog, { seed, dataVersion: DV });
          assertHardGuarantees(g, r, `${type} ${g.roomId} seed ${seed}`);
          expect(r.warnings, `${type} ${g.roomId} seed ${seed}`).toEqual([]);
          const q = r.quality;
          const vals = q.parts.map((p) => p.value);
          expect(q.score).toBeCloseTo(0.65 * (vals.reduce((a, b) => a + b, 0) / vals.length) + 0.35 * Math.min(...vals), 10);
          expect(q.score).toBeGreaterThan(0);
          expect(q.score).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  it('Determinismus: gleicher Seed → gleiche Platzierungen und Qualität (auch mit Zonen und Backtracking)', () => {
    for (const [g, type] of [[shellRoom(12, 9), 'kitchen'], [shellRoom(20, 14), 'tavern'], [lShellRoom(), 'storage']] as const) {
      const a = furnishRoom(g, catalog.roomType(type), catalog, { seed: 7, dataVersion: DV });
      const b = furnishRoom(g, catalog.roomType(type), catalog, { seed: 7, dataVersion: DV });
      expect(a.placements).toEqual(b.placements);
      expect(a.quality).toEqual(b.quality);
    }
  });

  // Gesamtzeit wächst mit der Zahl der Raumtypen (K3: 45+); geprüft wird der Median je Raum
  it('Laufzeit: Median < 100 ms für 12×9 (alle Raumtypen)', { timeout: HEAVY_TIMEOUT }, () => {
    const jobs = catalog.roomTypeIds().flatMap((type) => [0, 1, 2, 3, 4].map((seed) => ({ type, seed, g: shellRoom(12, 9, { inner: seed % 2 === 0 ? [] : ['north'] }) })));
    const run = (i: number): unknown => { const j = jobs[Math.max(0, i)]!; return furnishRoom(j.g, catalog.roomType(j.type), catalog, { seed: j.seed, dataVersion: DV }); };
    expectCpuMsBelow(() => medianCpuMs(run, jobs.length), 100, 'Median je Raum 12×9');
  });
});
