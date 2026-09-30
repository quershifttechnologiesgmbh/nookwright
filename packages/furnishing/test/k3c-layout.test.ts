/**
 * K3c (research/17 §3.1, §7.3 Y1/Y2/Y9): Mittelgang (`aisle`) mit gespiegelter Doppelreihe, Freifläche
 * (`reserve`), Lockerung bei Platzmangel, Stil-Filter und Signatur-Tausch – dazu der Vorher/Nachher-Test (ohne die
 * neuen Felder bitgleich) und die Laufzeit. Synthetische Komponenten prüfen die Mechanik isoliert.
 */
import { describe, expect, it } from 'vitest';
import { Catalog, ComponentDefSchema, RoomTypeSchema, type ComponentDef, type RoomTypeDef } from '@mcda/catalog';
import { cellKey, resolveRelDir } from '@mcda/core';
import { expectCpuMsBelow, medianCpuMs } from '../../core/test/support/timing.js';
import { RoomPlanner, analyzeRoom, furnishRoom, planLayout, acrossOf, alongOf, type FurnishResult, type RoomGeometry } from '../src/index.js';
import { DV, assertHardGuarantees, catalog, lShellRoom, shellRoom } from './fixtures.js';
import { goldenCatalog, goldenDigest } from './golden-fixture.js';

const P = { block: 'minecraft:oak_planks' };
const comp = (o: Record<string, unknown>): ComponentDef => ComponentDefSchema.parse({ kind: 'static', category: 'furniture', obtainability: 'survival', mount: 'floor', rotations: 'backToWall', ...o });
const DEFS = [
  comp({ id: 't/pew', tags: ['pew'], rotations: 'all', layers: [['SSSS']], legend: { S: { role: 'furniture_wood', shape: 'stairs', orient: { back: 'back' } } }, masks: { use: [{ side: 'front' }] } }),
  comp({ id: 't/altar', tags: ['altar'], layers: [['XXX']], legend: { X: P }, masks: { use: [{ side: 'front' }] } }),
  comp({ id: 't/bed', tags: ['bunk'], layers: [['H', 'F']], legend: { H: { block: 'minecraft:red_bed', orient: { part: 'head' } }, F: { block: 'minecraft:red_bed', orient: { part: 'foot' } } } }),
  comp({ id: 't/runner', tags: ['runner'], rotations: [0, 1], walkable: true, layers: [['RRRRR']], legend: { R: { role: 'textile_primary', shape: 'carpet' } } }),
  comp({ id: 't/chest', tags: ['chest'], layers: [['C']], legend: { C: { block: 'minecraft:chest' } } }),
  comp({ id: 't/orb', tags: ['orb'], rotations: 'all', layers: [['A']], legend: { A: { block: 'minecraft:amethyst_block' } } }),
  comp({ id: 't/table', tags: ['table'], rotations: 'all', layers: [['TT']], legend: { T: P } }),
  comp({ id: 't/lamp', tags: ['lamp'], mount: 'ceiling', rotations: [0], layers: [['L']], legend: { L: { block: 'minecraft:lantern', orient: { hanging: true } } } }),
];
const cat = Catalog.of(DEFS);
const RT = (o: Record<string, unknown>): RoomTypeDef => RoomTypeSchema.parse({ id: 'k3c', name: 'K3c', minArea: 1, coverage: { target: 0.3 }, optional: [], ...o });

const chapel = RT({
  id: 'chapel_t', aisle: { width: 2, minWidth: 1 },
  zones: [{ id: 'nave', doorAffinity: 'near' }, { id: 'chancel', doorAffinity: 'far' }],
  required: [
    { tags: ['altar'], count: [1, 1], signature: true, zone: 'chancel', placement: { zones: ['edge'], doorAffinity: 'far' } },
    { tags: ['pew'], count: [6, 6], zone: 'nave', placement: { zones: ['center'] }, pattern: { kind: 'row', gap: 1 } },
  ],
  optional: [{ tags: ['runner'], count: [1, 1] }, { tags: ['lamp'], count: [1, 2] }],
});
const barracks = RT({
  id: 'barracks_t', aisle: { width: 2 },
  required: [{ tags: ['bunk'], count: [6, 6], signature: true, placement: { zones: ['edge'] }, pattern: { kind: 'row', gap: 1 } }],
  optional: [{ tags: ['chest'], count: [1, 2], placement: { zones: ['corner'] } }, { tags: ['runner'], count: [1, 1] }],
});

/** Zellen auf Laufhöhe, die ein nicht durchlaufbares Möbel belegt (je Platzierung). */
const floorCells = (r: FurnishResult, g: RoomGeometry) =>
  r.placed.flatMap((p) => (p.expanded.walkable ? [] : p.cells.filter((c) => c.pos[1] <= g.baseY + 1).map((c) => ({ p, k: cellKey(c.pos[0], c.pos[2]) }))));

describe('planLayout: Achse, Breite, Stirnseite, Freifläche', () => {
  it('fast quadratisch → Tür-Achse; Breite +1 für gleich breite Seiten; Stirnseite türfern', () => {
    const g = shellRoom(13, 12); // innen 11 × 10, Tür Süd
    const lay = planLayout(analyzeRoom(g), chapel)!;
    expect(lay.aisle).toMatchObject({ axis: 'z', from: 4, to: 6, width: 3, head: 'north' });
    expect(lay.focalTags).toEqual(['altar']);
  });

  it('langer Raum → lange Achse; Stirnseite = das Ende mit dem größeren Türabstand', () => {
    const g = shellRoom(16, 9, { doorSide: 'south', doorAt: 3 }); // innen 14 × 7
    const a = analyzeRoom(g);
    const aisle = planLayout(a, barracks)!.aisle!;
    expect(aisle).toMatchObject({ axis: 'x', from: 2, to: 4, width: 3 });
    const mean = (x: number) => [...aisle.cells].filter(([cx]) => cx === x).reduce((s, [cx, cz]) => s + a.dDoor.get(cellKey(cx, cz))!, 0);
    expect(aisle.head).toBe(mean(0) > mean(13) ? 'west' : 'east');
    expect(aisle.head).toBe('east');
  });

  it('feste Achse, schmale Flure (Breite 3 → Gang 1 mittig, Breite 2 → einseitig), Lockerung auf minWidth', () => {
    const corridor = RT({ id: 'c', aisle: { axis: 'z', width: 2, minWidth: 1 }, required: [{ tags: ['chest'], count: [1, 1] }] });
    expect(planLayout(analyzeRoom(shellRoom(5, 12)), corridor)!.aisle).toMatchObject({ axis: 'z', from: 1, to: 1 });
    expect(planLayout(analyzeRoom(shellRoom(4, 12)), corridor)!.aisle).toMatchObject({ from: 0, to: 0, width: 1 });
    expect(planLayout(analyzeRoom(shellRoom(14, 8)), corridor)!.aisle!.axis).toBe('z');
    expect(planLayout(analyzeRoom(shellRoom(13, 12)), chapel, 1)!.aisle!.width).toBe(1);
    // Seitentiefe der Reihen: Bänke (4 breit) quer in einem 9 breiten Raum → Gang 1 statt 3
    expect(planLayout(analyzeRoom(shellRoom(11, 14)), chapel, 0, 4)!.aisle).toMatchObject({ width: 1, from: 4 });
    expect(planLayout(analyzeRoom(shellRoom(11, 14)), chapel, 0, 1)!.aisle!.width).toBe(3);
    expect(planLayout(analyzeRoom(shellRoom(13, 12)), chapel, 2)).toBeUndefined();
    expect(planLayout(analyzeRoom(shellRoom(13, 12)), RT({ required: [{ tags: ['chest'], count: [1, 1] }] }))).toBeUndefined();
  });

  it('Freifläche mittig; Treppenschacht nur ganz, focal wird verkleinert', () => {
    const tower = (reason: string, size = [3, 3]) => RT({ reserve: { zone: 'center', size, reason }, required: [{ tags: ['chest'], count: [1, 1] }] });
    const r = planLayout(analyzeRoom(shellRoom(9, 9)), tower('stairwell'))!.reserve!;
    expect([...r.cells].map(([x, z]) => `${x},${z}`).sort()).toEqual(['2,2', '2,3', '2,4', '3,2', '3,3', '3,4', '4,2', '4,3', '4,4']);
    expect(planLayout(analyzeRoom(shellRoom(6, 6)), tower('stairwell'))).toBeUndefined(); // innen 4 × 4
    expect(planLayout(analyzeRoom(shellRoom(6, 6)), tower('focal'))!.reserve!.cells.size).toBe(4);
    expect(planLayout(analyzeRoom(shellRoom(12, 8)), tower('focal', [4, 2]))!.reserve!.cells.bounds()).toEqual({ minX: 3, minZ: 2, maxX: 6, maxZ: 3 });
  });
});

describe('Mittelgang (Y1): frei, durchgängig, Doppelreihe gespiegelt', () => {
  const rooms = [shellRoom(13, 12, { windowSpacing: 4 }), shellRoom(11, 14, { windowSpacing: 4 }), shellRoom(16, 11, { doorSide: 'west', windowSpacing: 4 }), shellRoom(13, 12, { inner: ['north'] })];

  it('Gang auf Laufhöhe frei bis auf Läufer und den Blickpunkt (Rücken zur Stirnwand); harte Garantien', () => {
    for (const rt of [chapel, barracks]) {
      for (const g of rooms) {
        for (let seed = 0; seed < 6; seed++) {
          const r = furnishRoom(g, rt, cat, { seed, dataVersion: DV });
          assertHardGuarantees(g, r, `${rt.id} ${g.roomId} ${seed}`);
          const aisle = r.layout?.aisle;
          if (aisle === undefined) continue;
          for (const { p, k } of floorCells(r, g)) {
            const [x, z] = k.split(',').map(Number) as [number, number];
            if (!aisle.cells.has(x, z)) continue;
            expect(p.expanded.defId, `${rt.id} ${g.roomId} ${seed}: ${p.expanded.defId} im Gang`).toBe('t/altar');
            expect(resolveRelDir('back', p.pose)).toBe(aisle.head);
          }
          // durchgängig: jede Längsposition des Gangs hat (außer am Blickpunkt) eine freie Zelle, der Streifen hängt zusammen
          const busy = new Set(floorCells(r, g).map((c) => c.k));
          const free = [...aisle.cells].filter(([x, z]) => !busy.has(cellKey(x, z)));
          const alongs = new Set(free.map(([x, z]) => alongOf(aisle.axis, x, z)));
          expect(alongs.size, `${rt.id} ${g.roomId} ${seed}`).toBeGreaterThanOrEqual(aisle.end - aisle.start);
        }
      }
    }
  });

  it('Bankreihen quer zur Achse: Blick zur Stirnseite, links/rechts gespiegelt; Altar mittig auf der Achse', () => {
    let pews = 0, facing = 0, mirror = 0, altars = 0, centred = 0, runners = 0, inAisle = 0;
    // Stirnwand ohne Fenster (sonst kann der Altar mit dem Rücken zur Wand nicht mittig stehen)
    const chapels = [shellRoom(13, 12, { inner: ['north'] }), shellRoom(11, 14, { inner: ['north'], windowSpacing: 4 }), shellRoom(16, 11, { doorSide: 'west', inner: ['east'], windowSpacing: 4 }), shellRoom(12, 12, { inner: ['north'] })];
    for (const g of chapels) {
      for (let seed = 0; seed < 6; seed++) {
        const r = furnishRoom(g, chapel, cat, { seed, dataVersion: DV });
        expect(r.warnings).toEqual([]);
        const aisle = r.layout!.aisle!;
        for (const p of r.placed.filter((x) => x.expanded.defId === 't/pew')) {
          pews++;
          if (resolveRelDir('front', p.pose) === aisle.head) facing++;
        }
        mirror += r.quality.parts.find((q) => q.id === 'aisle')!.value;
        for (const p of r.placed.filter((x) => x.expanded.defId === 't/altar')) {
          altars++;
          const a0 = acrossOf(aisle.axis, p.pose.pos[0], p.pose.pos[2]);
          const a1 = a0 + (aisle.axis === 'z' ? p.size[0] : p.size[2]) - 1;
          if (Math.abs((a0 + a1) / 2 - (aisle.from + aisle.to) / 2) <= 0.5) centred++;
        }
        for (const p of r.placed.filter((x) => x.expanded.defId === 't/runner')) {
          runners++;
          if (p.cells.every((c) => aisle.cells.has(c.pos[0], c.pos[2]))) inAisle++;
        }
      }
    }
    expect(facing / pews, 'Bänke blicken zur Stirnseite').toBeGreaterThanOrEqual(0.95);
    expect(mirror / (chapels.length * 6), 'gespiegelte Reihen-Stücke').toBeGreaterThanOrEqual(0.8);
    expect(centred / altars, 'Altar mittig').toBeGreaterThanOrEqual(0.9);
    expect(inAisle / runners, 'Läufer im Gang').toBeGreaterThanOrEqual(0.8);
  });

  it('Betten längs an beiden Seitenwänden (Rücken zur Wand, zum Gang blickend), gespiegelt', () => {
    let beds = 0, sideWall = 0, mirror = 0, n = 0;
    for (const g of [shellRoom(9, 12, { windowSpacing: 4 }), shellRoom(16, 9, { windowSpacing: 4 }), shellRoom(12, 10, { inner: ['north', 'south'] })]) {
      for (let seed = 0; seed < 6; seed++) {
        const r = furnishRoom(g, barracks, cat, { seed, dataVersion: DV });
        expect(r.warnings, `${g.roomId} ${seed}`).toEqual([]);
        const aisle = r.layout!.aisle!;
        const walls = aisle.axis === 'z' ? ['west', 'east'] : ['north', 'south'];
        for (const p of r.placed.filter((x) => x.expanded.defId === 't/bed')) {
          beds++;
          if (walls.includes(resolveRelDir('back', p.pose))) sideWall++;
        }
        mirror += r.quality.parts.find((q) => q.id === 'aisle')!.value;
        n++;
      }
    }
    expect(sideWall / beds).toBeGreaterThanOrEqual(0.9);
    expect(mirror / n).toBeGreaterThanOrEqual(0.8);
  });

  it('Lockerung: passt die Reihe nur bei minWidth, wird der Gang verengt; sonst ohne Layout (mit Notiz)', () => {
    const block = Catalog.of([...DEFS, comp({ id: 't/block', tags: ['block'], rotations: 'all', layers: [['XX', 'XX']], legend: { X: P } })]);
    const narrow = RT({ aisle: { width: 3, minWidth: 1 }, required: [{ tags: ['chest'], count: [1, 1], signature: true }, { tags: ['block'], count: [2, 2] }] });
    const g = shellRoom(7, 12, { windowSpacing: 4 }); // innen 5 breit: Gang 3 → Seiten 1 (2 × 2 passt nicht), Gang 1 → Seiten 2
    const r = furnishRoom(g, narrow, block, { seed: 1, dataVersion: DV });
    expect(r.warnings).toEqual([]);
    expect(r.layout?.relaxed).toBe(1);
    expect(r.layout?.aisle?.width).toBe(1);
    expect(r.quality.notes.join()).toMatch(/gelockert/);
    const impossible = RT({ aisle: { width: 3, minWidth: 3 }, required: [{ tags: ['chest'], count: [1, 1], signature: true }, { tags: ['block'], count: [2, 2] }] });
    const r2 = furnishRoom(g, impossible, block, { seed: 0, dataVersion: DV }); // Gang bleibt 3 → nur ohne Layout
    expect(r2.warnings).toEqual([]);
    expect(r2.layout).toBeUndefined();
    expect(r2.quality.notes.join()).toMatch(/ohne Mittelgang/);
  });

  it('deterministisch; L-Raum und Innenwände ohne Verstöße; RoomPlanner hält den Gang frei', () => {
    const g = shellRoom(13, 12);
    const a = furnishRoom(g, chapel, cat, { seed: 3, dataVersion: DV });
    expect(JSON.stringify(furnishRoom(g, chapel, cat, { seed: 3, dataVersion: DV }))).toBe(JSON.stringify(a));
    for (let seed = 0; seed < 4; seed++) {
      const l = lShellRoom(3);
      assertHardGuarantees(l, furnishRoom(l, barracks, cat, { seed, dataVersion: DV }), `L ${seed}`);
    }
    const planner = new RoomPlanner(g, a.placed, a.layout);
    const aisle = a.layout!.aisle!;
    const cands = planner.candidates(cat.get('t/chest'));
    expect(cands.length).toBeGreaterThan(0);
    for (const p of cands) expect(aisle.cells.has(p.pose.pos[0], p.pose.pos[2])).toBe(false);
  });
});

describe('Freifläche (Y2)', () => {
  it('stairwell: in keiner Höhe etwas in der Mitte (auch keine Luft-Masken, keine Deckenlampe)', () => {
    const tower = RT({ reserve: { zone: 'center', size: [3, 3], reason: 'stairwell' }, required: [{ tags: ['chest'], count: [2, 4] }], optional: [{ tags: ['table'], count: [1, 2] }, { tags: ['lamp'], count: [2, 3] }] });
    for (const g of [shellRoom(9, 9), shellRoom(10, 8), shellRoom(8, 8, { height: 2 })]) {
      for (let seed = 0; seed < 6; seed++) {
        const r = furnishRoom(g, tower, cat, { seed, dataVersion: DV });
        assertHardGuarantees(g, r);
        const res = r.layout!.reserve!;
        for (const p of r.placed) for (const c of [...p.cells.map((x) => x.pos), ...p.air]) expect(res.cells.has(c[0], c[2]), `${g.roomId} ${seed} ${p.expanded.defId}`).toBe(false);
      }
    }
  });

  it('focal: auf Laufhöhe nur das erlaubte Zentralstück, und das steht meist in der Mitte; Lampen darüber erlaubt', () => {
    const obs = RT({ reserve: { zone: 'center', size: [3, 3], reason: 'focal', allow: ['orb'] }, required: [{ tags: ['orb'], count: [1, 1] }, { tags: ['chest'], count: [2, 3] }], optional: [{ tags: ['table'], count: [2, 2] }, { tags: ['lamp'], count: [1, 1] }] });
    let inside = 0, n = 0;
    for (const g of [shellRoom(9, 9), shellRoom(11, 9)]) {
      for (let seed = 0; seed < 8; seed++) {
        const r = furnishRoom(g, obs, cat, { seed, dataVersion: DV });
        const res = r.layout!.reserve!;
        for (const { p, k } of floorCells(r, g)) {
          const [x, z] = k.split(',').map(Number) as [number, number];
          if (res.cells.has(x, z)) expect(p.expanded.defId).toBe('t/orb');
        }
        const orb = r.placed.find((p) => p.expanded.defId === 't/orb')!;
        n++;
        if (res.cells.has(orb.pose.pos[0], orb.pose.pos[2])) inside++;
      }
    }
    expect(inside / n).toBeGreaterThanOrEqual(0.9);
  });
});

describe('Stil (Y9): Raumtyp-Filter und Signatur-Tausch je Theme', () => {
  const styled = Catalog.of([
    comp({ id: 's/hearth', tags: ['fire'], styleTags: ['medieval'], layers: [['XXX']], legend: { X: P } }),
    comp({ id: 's/fire_pit', tags: ['fire'], styleTags: ['nordic'], rotations: 'all', layers: [['XX']], legend: { X: P } }),
    comp({ id: 's/bench_m', tags: ['bench'], styleTags: ['medieval'], layers: [['X']], legend: { X: P } }),
    comp({ id: 's/bench_n', tags: ['bench'], styleTags: ['nordic'], layers: [['X']], legend: { X: P } }),
  ]);
  const hall = RT({ id: 'hall', name: 'Halle', styleTags: { exclude: ['rustic'] }, required: [{ tags: ['fire'], count: [1, 1], signature: true }, { tags: ['bench'], count: [4, 4] }] });
  const g = shellRoom(10, 8);

  it('Signatur nimmt die Form des spezifischsten Stils; übrige Einträge bleiben gemischt', () => {
    const benches = new Set<string>();
    for (let seed = 0; seed < 8; seed++) {
      const nordic = furnishRoom(g, hall, styled, { seed, dataVersion: DV, styles: ['nordic', 'medieval'] });
      const medieval = furnishRoom(g, hall, styled, { seed, dataVersion: DV, styles: ['medieval'] });
      expect(nordic.placements.filter((p) => p.componentId.startsWith('s/fire') || p.componentId === 's/hearth').map((p) => p.componentId)).toEqual(['s/fire_pit']);
      expect(medieval.placements.some((p) => p.componentId === 's/hearth')).toBe(true);
      for (const p of nordic.placements) if (p.componentId.startsWith('s/bench')) benches.add(p.componentId);
    }
    expect(benches.size).toBe(2);
  });

  it('Mindesthöhe: unter minHeight ein Hinweis in der Qualität, keine Warnung', () => {
    const tall = { ...hall, minHeight: 5 };
    const low = furnishRoom(shellRoom(10, 8, { height: 4 }), tall, styled, { seed: 0, dataVersion: DV, styles: ['medieval'] });
    expect(low.warnings).toEqual([]);
    expect(low.quality.notes.join()).toMatch(/Mindesthöhe 5/);
    expect(furnishRoom(shellRoom(10, 8, { height: 5 }), tall, styled, { seed: 0, dataVersion: DV, styles: ['medieval'] }).quality.notes.join()).not.toMatch(/Mindesthöhe/);
  });

  it('unpassender Raumtyp → Qualitäts-Hinweis (keine Warnung); ohne Stile oder mit leerem Filter wie vorher', () => {
    const misfit = furnishRoom(g, hall, styled, { seed: 0, dataVersion: DV, styles: ['rustic', 'medieval'] });
    expect(misfit.warnings).toEqual([]);
    expect(misfit.quality.notes.join()).toMatch(/passt nicht zum Stil rustic/);
    expect(furnishRoom(g, hall, styled, { seed: 0, dataVersion: DV, styles: ['nordic'] }).warnings).toEqual([]);
    for (const id of catalog.roomTypeIds().slice(0, 4)) {
      const rt = catalog.roomType(id);
      const a = furnishRoom(g, rt, catalog, { seed: 2, dataVersion: DV });
      const b = furnishRoom(g, { ...rt, styleTags: {} }, catalog, { seed: 2, dataVersion: DV });
      expect(JSON.stringify(b.placements)).toBe(JSON.stringify(a.placements));
    }
  });
});

describe('Vorher/Nachher: ohne die neuen Felder bitgleich zum Solver vor K3c', () => {
  it('Prüfsumme über 3 Raumtypen × 6 Räume × 3 Seeds (fester synthetischer Katalog)', () => {
    // Wert aus dem Solver-Stand vor K3c (A/B-Lauf, plan/spikes/K3c_schema_solver.md §4).
    // Q1b: bewusst neu gesetzt – die Wunschzonen-Reihenfolge ist jetzt eine Priorität (`zoneWeight`), der
    // synthetische Katalog nutzt `["edge","corner"]`/`["corner","edge"]`. Alte Prüfsumme: cfcaf6e451d49bc1.
    // W2 (26.09.2026): Regel I6 bewusst neu gesetzt – Hauptweg 2 breit, Deko-Budget je Fläche, Nebenmöbel an die Wand.
    // Alte Prüfsumme: 27c9cf98652e94ee.
    // W3 (27.09.2026): niedrige Möbel (eine Reihe hohe Rückseite) lehnen jetzt auch unter Fenstern an – die Brüstung ist
    // Wand (Arbeitszeile, Spüle unter dem Fenster). Alte Prüfsumme: e2fe5adaf6cc967e.
    // W5 (27.09.2026, Review N6): bewusst neu gesetzt – liegt der Hauptweg nur versetzt 2 breit oder passt mit ihm ein
    // Pflichtobjekt nicht, versucht der Solver den schonenden Weg (`spare`, an Treppe/offener Kante entlang) statt ihn
    // aufzugeben. Alte Prüfsumme: 7daad2a6c1c76a0f.
    // W8-B (2026-09-27): Regel `useAccess` – jede Nutzungsseite (Truhe, Bett, Schrank …) liegt am begehbaren Netz, nicht
    // tiefer als 1 Zelle in einer 1 breiten Sackgasse und nicht als einziger Durchgang (plan/spikes/W8B_wege_im_raum.md).
    // Alte Prüfsumme: f57412f021ef77e5.
    // W8-E (2026-09-27): Teilwert „Pflichtobjekte“ zählt die Mindestzahl je Eintrag (Stücke über ihr sind Wunsch, wie der
    // Hinweis des Wegs `spare` seit W5). Platzierungen und Warnungen aller 54 Räume unverändert; nur die Qualität der drei
    // Schlafsäle `g_dorm` × L ändert sich (4 von 5 Betten, Mindestzahl 2: 0,80 → 1,00; spikes/w8/w8e/solvercmp.mts).
    // Alte Prüfsumme: 0abbf2530a151d27.
    expect(goldenDigest((g, rt, seed) => furnishRoom(g, rt, goldenCatalog, { seed, dataVersion: DV }))).toBe('d5db0c044bb41919');
  });
});

describe('Laufzeit', () => {
  it('Gang-Räume bleiben im Rahmen (Median < 40 ms)', () => {
    const jobs = [chapel, barracks].flatMap((rt) => [shellRoom(13, 12), shellRoom(16, 9), shellRoom(11, 14)].flatMap((g) => [0, 1, 2, 3].map((seed) => ({ rt, g, seed }))));
    const run = (i: number): unknown => { const j = jobs[Math.max(0, i)]!; return furnishRoom(j.g, j.rt, cat, { seed: j.seed, dataVersion: DV }); };
    expectCpuMsBelow(() => medianCpuMs(run, jobs.length), 40, 'Median Gang-Räume');
  });
});
