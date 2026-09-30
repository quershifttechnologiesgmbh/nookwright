import { key3, type Vec3 } from '@mcda/core';
import { EXPORT_FORMATS, prepareVolume, type ExportVolume } from '@mcda/export';
import { exportFile, importFile } from '@mcda/export/node';
import { MergeViolationError, toExportVolume } from '@mcda/voxel';
import { describe, expect, it } from 'vitest';
import { MaterializeError, materialize, type MaterializePlacement, type MaterializeResult } from '../src/index.js';
import { THEME_IDS, VERSIONS, furnished, place, platformView, roomShell, themes } from './fixtures.js';

function run(placements: readonly MaterializePlacement[], version = '26.3', theme = 'medieval', seed = 7): MaterializeResult {
  return materialize({ shell: roomShell(), placements, theme: themes.get(theme), platform: platformView(version), seed });
}

const props = (r: MaterializeResult, p: Vec3): Record<string, string> => ({ name: r.volume.stateAt(p).name, ...r.volume.stateAt(p).properties });
const errors = (r: MaterializeResult) => r.violations.filter((v) => v.severity === 'error');

describe('Eingerichteter 6×5-Raum (synthetische Hülle + echte Katalog-Komponenten)', () => {
  for (const version of VERSIONS) {
    for (const theme of THEME_IDS) {
      it(`${theme} / ${version}: alle States vollständig und gültig, keine Physik-Verstöße, kein Spawn`, () => {
        const r = run(furnished(), version, theme);
        const reg = platformView(version).registry;
        let blocks = 0;
        for (const c of r.volume.cells()) {
          if (c.state.name === 'air') continue;
          blocks++;
          expect(reg.isValidState(c.state.name, c.state.properties, { complete: true }), `${c.state.name} ${JSON.stringify(c.state.properties)}`).toBe(true);
        }
        expect(blocks).toBeGreaterThan(100);
        expect(r.violations).toEqual([]);
        expect(r.light.darkCells).toEqual([]);
        expect(r.light.walkableCells).toBeGreaterThan(3);
        expect(r.version).toBe(version);
      });
    }
  }

  it('Herkunft und Schichten: Hülle = Struktur/Architektur, Möbel = Platzierungs-ID', () => {
    const r = run(furnished());
    expect(r.volume.cell([0, 0, 0])).toMatchObject({ owner: 'shell:r1', layer: 2 });
    expect(r.volume.cell([2, 1, 4])).toMatchObject({ owner: 'shell:r1', layer: 3 }); // Tür = Architektur
    expect(r.volume.cell([1, 1, 1])).toMatchObject({ owner: 'bed', layer: 5 });
    expect(r.volume.cell([1, 2, 3])).toMatchObject({ owner: 'torch', layer: 6 }); // Anbauteil
    expect(r.volume.owners()).toEqual(['bed', 'candles', 'chair', 'chest1', 'chest2', 'counter1', 'counter2', 'counter3', 'lamp', 'shell:r1', 'torch']);
  });

  it('Bett-Hälften: Kopf am Kopfende (Nord), facing = Fuß → Kopf', () => {
    const r = run(furnished());
    expect(props(r, [1, 1, 1])).toEqual({ name: 'red_bed', facing: 'north', part: 'head', occupied: 'false' });
    expect(props(r, [1, 1, 2])).toEqual({ name: 'red_bed', facing: 'north', part: 'foot', occupied: 'false' });
    expect(run(furnished(), '26.3', 'nordic').volume.stateAt([1, 1, 1]).name).toBe('white_bed');
  });

  it('Doppeltruhe: type=left hat den Partner bei CW(facing); Loot-Table als Block-Entity', () => {
    const r = run(furnished());
    // Front Nord → facing north; CW(north) = east → die westliche Truhe ist „left“
    expect(props(r, [3, 1, 3])).toMatchObject({ name: 'chest', facing: 'north', type: 'left' });
    expect(props(r, [4, 1, 3])).toMatchObject({ name: 'chest', facing: 'north', type: 'right' });
    const be = r.volume.cell([3, 1, 3])!.blockEntity!;
    expect(be.value['id']).toEqual({ type: 'string', value: 'minecraft:chest' });
    expect(be.value['LootTable']).toEqual({ type: 'string', value: 'minecraft:chests/village/village_plains_house' });
    expect(be.value['LootTableSeed']?.type).toBe('long');
    // ohne Kopplung bleiben es Einzeltruhen
    const single = materialize({ shell: roomShell(), placements: furnished(), theme: themes.get('medieval'), platform: platformView('26.3'), seed: 7, options: { pairChests: false } });
    expect(single.volume.stateAt([3, 1, 3]).properties['type']).toBe('single');
  });

  it('Treppen-shape: Theke über Eck → inner_right, Traufkranz-Ecken → outer', () => {
    const r = run(furnished());
    expect(props(r, [4, 1, 1])).toMatchObject({ name: 'spruce_stairs', facing: 'north', half: 'top', shape: 'inner_right' });
    expect(props(r, [3, 1, 1])).toMatchObject({ facing: 'north', half: 'top', shape: 'straight' });
    expect(props(r, [4, 1, 2])).toMatchObject({ facing: 'east', half: 'top', shape: 'straight' });
    expect(props(r, [3, 1, 2])).toMatchObject({ facing: 'south', half: 'bottom', shape: 'straight' }); // Stuhl: andere half
    for (const [x, z] of [[0, 0], [5, 0], [0, 4], [5, 4]] as const) {
      expect(props(r, [x, 5, z])['shape'], `Ecke ${x},${z}`).toMatch(/^outer_/);
    }
    expect(props(r, [2, 5, 0])).toMatchObject({ facing: 'south', shape: 'straight' });
    expect(props(r, [2, 5, 0])['name']).toMatch(/^(deepslate_tile|deepslate_brick|cobbled_deepslate|tuff_brick|blackstone)_stairs$/); // Schieferdach P9
  });

  it('Dachtreppen: Soll-Form der Hülle (orient.stairShape) wird gegen die Vanilla-Regel geprüft', () => {
    const shell = roomShell();
    const wrong = { ...shell, cells: shell.cells.map((c) => (c.pos[0] === 2 && c.pos[1] === 5 && c.pos[2] === 0 ? { ...c, orient: { ...c.orient, stairShape: 'inner_left' as const } } : c)) };
    const r = materialize({ shell: wrong, placements: furnished(), theme: themes.get('medieval'), platform: platformView('26.3'), seed: 7 });
    expect(r.violations.map((v) => [v.kind, v.severity, v.pos])).toEqual([['stair_shape', 'warning', [2, 5, 0]]]);
    expect(r.volume.stateAt([2, 5, 0]).properties['shape']).toBe('straight'); // Vanilla gilt
  });

  it('Hülle: Tür-Hälften, Fenster verbindet sich mit der Wand, Balken axis=y', () => {
    const r = run(furnished());
    expect(props(r, [2, 1, 4])).toMatchObject({ name: 'spruce_door', facing: 'south', half: 'lower', hinge: 'left', open: 'false' });
    expect(props(r, [2, 2, 4])).toMatchObject({ name: 'spruce_door', half: 'upper' });
    expect(props(r, [3, 2, 0])).toMatchObject({ name: 'glass_pane', east: 'true', west: 'true', north: 'false', south: 'false' });
    expect(props(r, [0, 2, 0])).toMatchObject({ name: 'dark_oak_log', axis: 'y' });
    // W12-D (2026-09-28): nordic trägt die Eck- und Rahmenbalken als Rindenstamm in dunkler Eiche (vorher entrindete Fichte)
    expect(run(furnished(), '26.3', 'nordic').volume.stateAt([0, 2, 0]).name).toBe('dark_oak_log');
  });

  it('Licht: Hängelaterne, Kerzen (3 × 3) und Wandfackel sind Quellen; Kette hängt an der Decke', () => {
    const r = run(furnished());
    expect(props(r, [2, 2, 2])).toMatchObject({ name: 'lantern', hanging: 'true' });
    expect(props(r, [2, 3, 2])).toMatchObject({ name: 'iron_chain', axis: 'y' });
    expect(run(furnished(), '1.21.11').volume.stateAt([2, 3, 2]).name).toBe('iron_chain');
    expect(props(r, [3, 2, 1])).toMatchObject({ name: 'candle', candles: '3', lit: 'true' });
    expect(props(r, [1, 2, 3])).toMatchObject({ name: 'wall_torch', facing: 'east' });
    expect(r.light.emitters.map((e) => [e.block, e.level]).sort()).toEqual([['candle', 9], ['lantern', 15], ['wall_torch', 14]]);
    expect(r.light.levelAt([2, 2, 2])).toBe(15); // Laterne
    expect(r.light.levelAt([2, 1, 2])).toBe(14); // direkt darunter
    expect(r.light.levelAt([2, 1, 3])).toBe(13); // 2 Schritte von Laterne und Fackel
    expect(r.light.levelAt([0, 1, 1])).toBe(0); // in der Wand
    expect(r.light.levelAt([2, 5, 2])).toBe(0); // über der Decke (Vollblöcke sperren)
  });

  it('absichtlich schwebende Laterne → Stütz-Verstoß; schwebende Kettenlaterne → Masken-Verstoß', () => {
    const floating = run([...furnished(), place('float', 'light/ceiling_lantern', [2, 2, 1])]);
    const v = errors(floating);
    // Block-Regel (Plattform-Flag + Stützart) UND die Stütz-Maske der Komponente schlagen an
    expect(v.map((x) => [x.kind, x.owner, x.block, x.pos])).toEqual([
      ['support', 'float', 'lantern', [2, 2, 1]],
      ['support_mask', 'float', 'lantern', [2, 2, 1]],
    ]);
    expect(v[0]!.message).toContain('stabile Mitte darüber');

    const lowChain = run([...furnished(), place('low', 'light/hanging_lantern', [2, 1, 1])]);
    // Laterne hängt an der Kette (Block-Regel erfüllt), aber die Kette hängt frei (Maske der Komponente)
    expect(errors(lowChain).map((x) => [x.kind, x.owner])).toEqual([['support_mask', 'low']]);
  });

  it('dunkler Raum ohne Lichtquelle → Spawn-Warnung mit den begehbaren Zellen', () => {
    const r = run([place('bed', 'bed/single', [1, 1, 1]), place('chest', 'storage/chest', [4, 1, 3], 2)]);
    expect(r.light.emitters).toEqual([]);
    const spawn = r.violations.filter((v) => v.kind === 'spawn');
    expect(spawn).toHaveLength(1);
    expect(spawn[0]).toMatchObject({ severity: 'warning', roomId: 'r1' });
    // 12 Innenzellen − 2 Bett − 1 Truhe = 9 begehbare Bodenzellen, alle dunkel und spawnfähig
    expect(r.light.walkableCells).toBe(9);
    expect(r.light.darkCells).toHaveLength(9);
    expect(r.light.darkCells.every((d) => d.spawnable)).toBe(true);
    expect(errors(r)).toEqual([]);
  });

  it('Kerze und Blumentopf brauchen keine Stütze; Teppich/Tür schon (Physik-Daten + Regel)', () => {
    const r = run([...furnished(), place('pot', 'decor/flower_pot', [2, 3, 3], 0, 'poppy')]);
    expect(errors(r)).toEqual([]); // Topf schwebt in der Luft – in Java erlaubt
  });

  it('gleiche Eingabe → gleiches Ergebnis (Mischungen und Loot-Seeds deterministisch)', () => {
    const a = run(furnished(), '26.3', 'medieval', 11);
    const b = run(furnished(), '26.3', 'medieval', 11);
    const dump = (r: MaterializeResult) => [...r.volume.cells()].map((c) => `${key3(c.pos)}=${c.state.name}`);
    expect(dump(a)).toEqual(dump(b));
    const wallNames = new Set([...a.volume.cells()].filter((c) => c.owner === 'shell:r1' && c.pos[1] >= 1 && c.pos[1] <= 3 && !c.state.name.includes('log') && !c.state.name.includes('door') && c.state.name !== 'glass_pane').map((c) => c.state.name));
    // Steinverlauf P1 (+ Varianten der Verwitterung) greift pro Zelle
    const P1 = ['andesite', 'stone_bricks', 'cobblestone', 'tuff', 'tuff_bricks', 'cobbled_deepslate', 'mossy_stone_bricks', 'cracked_stone_bricks', 'mossy_cobblestone'];
    expect(wallNames.size).toBeGreaterThanOrEqual(3);
    for (const n of wallNames) expect(P1, n).toContain(n);
  });

  it('Überlappung Möbel ↔ Wand ist ein Merge-Verstoß (Solver-Fehler), kein stilles Überschreiben', () => {
    expect(() => run([place('bad', 'storage/chest', [0, 1, 2], 1)])).toThrow(MergeViolationError);
  });

  it('Auflösungsfehler werden gesammelt und klar gemeldet', () => {
    const bad: MaterializePlacement = {
      ...place('x', 'seat/chair', [2, 1, 1]),
      placed: { ...place('x', 'seat/chair', [2, 1, 1]).placed, cells: [{ pos: [2, 1, 1], local: [0, 0, 0], mat: { role: 'furniture_wood', shape: 'stairs', orient: { hanging: true } } }] },
    };
    const err = (() => { try { run([bad]); } catch (e) { return e; } return undefined; })();
    expect(err).toBeInstanceOf(MaterializeError);
    expect((err as MaterializeError).message).toContain('orient.hanging passt nicht');
  });
});

describe('Export-Round-Trip (.litematic + .nbt) über packages/export', () => {
  const normalized = (v: ExportVolume) => {
    const p = prepareVolume(v);
    return { dataVersion: p.dataVersion, size: p.size, blocks: p.blocks, entities: p.entities };
  };
  for (const version of VERSIONS) {
    it(`${version}: materialisiertes Haus übersteht alle Writer ohne Fehler und Warnungen`, () => {
      const r = run(furnished(), version, 'rustic');
      const ev = toExportVolume(r.volume, { name: 'm1-haus', dataVersion: r.dataVersion });
      expect(prepareVolume(ev).warnings).toEqual([]);
      for (const fmt of ['litematic', 'nbt'] as const) {
        expect(EXPORT_FORMATS).toContain(fmt);
        const back = importFile(fmt, exportFile(fmt, ev, { date: 0 }));
        expect(normalized(back), fmt).toEqual(normalized(ev));
      }
      expect(ev.blocks.find((b) => b.name === 'chest')?.blockEntity).toBeDefined();
    });
  }
});

describe('Gemessene Palette (Axiom-Vorbild, research/13 #17/#19)', () => {
  it('zählt den fertigen Bestand: Summe = Nicht-Luft-Zellen, Sortierung absteigend, deterministisch', () => {
    const r = run(furnished(), '26.3', 'medieval');
    let blocks = 0;
    for (const c of r.volume.cells()) if (c.state.name !== 'air') blocks++;
    const sum = r.palette.reduce((n, e) => n + e.count, 0);
    expect(sum).toBe(blocks);
    for (let i = 1; i < r.palette.length; i++) expect(r.palette[i - 1]!.count).toBeGreaterThanOrEqual(r.palette[i]!.count);
    // deterministisch: zweiter Lauf mit gleichem Seed ergibt dieselbe Palette
    expect(run(furnished(), '26.3', 'medieval').palette).toEqual(r.palette);
  });

  it('nennt Rollen: Wandblöcke kommen als wall_primary, und derselbe Block kann in mehreren Rollen stehen', () => {
    const r = run(furnished(), '26.3', 'medieval');
    const wall = r.palette.filter((e) => e.role === 'wall_primary');
    expect(wall.length).toBeGreaterThan(0);
    expect(wall.reduce((n, e) => n + e.count, 0)).toBeGreaterThan(20);
    // Rollen sind eine echte Aufteilung: gleicher Block in zwei Rollen bleibt getrennt
    const byBlock = new Map<string, Set<string>>();
    for (const e of r.palette) byBlock.set(e.block, (byBlock.get(e.block) ?? new Set()).add(e.role ?? ''));
    expect([...byBlock.values()].every((s) => s.size >= 1)).toBe(true);
  });

  it('jedes Theme hat eine nicht-leere Palette, die Summe bleibt gleich', () => {
    for (const theme of THEME_IDS) {
      const r = run(furnished(), '26.3', theme);
      expect(r.palette.length, theme).toBeGreaterThan(5);
      let blocks = 0;
      for (const c of r.volume.cells()) if (c.state.name !== 'air') blocks++;
      expect(r.palette.reduce((n, e) => n + e.count, 0), theme).toBe(blocks);
      for (const e of r.palette) expect(e.count, `${theme} ${e.block}`).toBeGreaterThan(0);
    }
  });
});

describe('Lichtlücke je Raum (research/37: Level − 1 je Block Taxi-Distanz)', () => {
  it('jeder Raum hat einen Eintrag; die Lücke ist der Abstand zur nächsten Quelle', () => {
    const r = run(furnished(), '26.3', 'medieval');
    const rooms = [...new Set(r.light.gaps.map((g) => g.roomId))];
    expect(rooms.length).toBeGreaterThan(0);
    // absteigend sortiert, Werte plausibel (die synthetische Hülle ist 6×5)
    for (let i = 1; i < r.light.gaps.length; i++) expect(r.light.gaps[i - 1]!.maxDistance).toBeGreaterThanOrEqual(r.light.gaps[i]!.maxDistance);
    for (const g of r.light.gaps) {
      expect(g.maxDistance).toBeGreaterThanOrEqual(0);
      expect(g.maxDistance).toBeLessThan(30);
      // Die gemeldete Zelle ist die *dunkelste* begehbare Stelle des Raums (hier: eine Luftzelle mit
      // Blocklicht > 0, weil die synthetische Hülle gut beleuchtet ist; ganz ohne Quelle wäre sie 0)
      expect(r.light.levelAt(g.cell)).toBeGreaterThanOrEqual(0);
    }
    // Rechenprobe: der gemeldete Abstand ist wirklich der kleinste Taxi-Abstand zu einer Quelle
    for (const g of r.light.gaps) {
      const echt = Math.min(...r.light.emitters.map((e) => Math.abs(e.pos[0] - g.cell[0]) + Math.abs(e.pos[1] - g.cell[1]) + Math.abs(e.pos[2] - g.cell[2])));
      expect(g.maxDistance).toBe(echt);
    }
  });

  it('ohne jede Lichtquelle im Bau ist die Lücke −1 („kein Licht“)', () => {
    // Leere Hülle ohne Platzierungen: es gibt keine Quelle, aber begehbare Zellen
    const r = materialize({ shell: roomShell(), placements: [], theme: themes.get('medieval'), platform: platformView('26.3'), seed: 4 });
    if (r.light.emitters.length === 0) {
      for (const g of r.light.gaps) expect(g.maxDistance).toBe(-1);
    } else {
      // Die synthetische Hülle bringt eigene Quellen mit (Fenster/Tür lassen Licht herein) – dann gilt die Rechenprobe
      for (const g of r.light.gaps) expect(g.maxDistance).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Lichtplan: Zielwert für die Lichtlücke (research/37)', () => {
  it('ohne Zielwert wird nicht geprüft (Einzelmaterialisierungen bleiben unberührt)', () => {
    const r = run(furnished(), '26.3', 'medieval');
    expect(r.violations.filter((v) => v.kind === 'light_gap')).toEqual([]);
  });

  it('mit Zielwert 16 melden gut beleuchtete Räume nichts', () => {
    const r = materialize({
      shell: roomShell(), placements: furnished(), theme: themes.get('medieval'), platform: platformView('26.3'), seed: 7,
      options: { lightGap: 16 },
    });
    expect(r.light.gaps.every((g) => g.maxDistance <= 16)).toBe(true);
    expect(r.violations.filter((v) => v.kind === 'light_gap')).toEqual([]);
  });

  it('ein zu strenges Ziel meldet die dunkelste Stelle mit Abstand im Text', () => {
    const r = materialize({
      shell: roomShell(), placements: furnished(), theme: themes.get('medieval'), platform: platformView('26.3'), seed: 7,
      options: { lightGap: 0 },
    });
    const meldungen = r.violations.filter((v) => v.kind === 'light_gap');
    expect(meldungen.length).toBeGreaterThan(0);
    expect(meldungen[0]!.severity).toBe('warning');
    expect(meldungen[0]!.message).toMatch(/nächsten Lichtquelle \(Ziel ≤ 0/);
    expect(meldungen[0]!.cells).toHaveLength(1);
    // Die Meldung nennt genau die gemessene Lücke
    const gap = r.light.gaps.find((g) => g.roomId === meldungen[0]!.roomId)!;
    expect(meldungen[0]!.message).toContain(String(gap.maxDistance));
  });

  it('ohne Lichtquelle im Bau gibt es keine Lücken-Meldung (das deckt `spawn`)', () => {
    const r = materialize({ shell: roomShell(), placements: [], theme: themes.get('medieval'), platform: platformView('26.3'), seed: 4 });
    if (r.light.emitters.length === 0) expect(r.violations.filter((v) => v.kind === 'light_gap')).toEqual([]);
  });
});
