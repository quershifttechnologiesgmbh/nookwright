/**
 * Goldene Galerie (P0-A): `.nbt` lesen → Raster → Analyse. Gleiche Welt ergibt dasselbe Raster, egal ob aus dem
 * Generator (ExportVolume) oder aus einer `.nbt`-Datei, und egal in welcher Reihenfolge die Blöcke stehen.
 */
import { describe, expect, it } from 'vitest';
import { nbt, type ExportVolume } from '@mcda/export';
import { exportFile, importFile } from '@mcda/export/node';
import { analyze } from '../golden/lib/analyze.js';
import { blockCounts, gridDigest, gridFromVolume, gridIndex, stateKey } from '../golden/lib/grid.js';
import { scenePayload } from '../golden/lib/payload.js';
import { deriveCameras } from '../golden/lib/cameras.js';
import { tableClassifier, testHouse } from './golden-helpers.js';

function exportVolume(): ExportVolume {
  const w = testHouse();
  return {
    name: 'golden-test', dataVersion: 4671, size: w.size, blocks: w.blocks,
    entities: [{ pos: [6.5, 2.5, 4.97], blockPos: [6, 2, 4], nbt: nbt.compound({ id: nbt.string('minecraft:item_frame'), Facing: nbt.byte(3) }) }],
  };
}

describe('Goldene Galerie: Welt → Raster', () => {
  it('.nbt-Rundweg ergibt dasselbe Raster wie das ExportVolume (Palette sortiert, Prüfsumme gleich)', () => {
    const ev = exportVolume();
    const direct = gridFromVolume(ev, tableClassifier);
    const fromFile = gridFromVolume(importFile('nbt', exportFile('nbt', ev)), tableClassifier);
    expect(fromFile.size).toEqual([17, 10, 15]);
    expect(fromFile.palette.map(stateKey)).toEqual(direct.palette.map(stateKey));
    expect(Buffer.from(fromFile.cells.buffer).equals(Buffer.from(direct.cells.buffer))).toBe(true);
    expect(gridDigest(fromFile)).toBe(gridDigest(direct));
    expect(fromFile.frames).toEqual([{ pos: [6, 2, 4], kind: 'item_frame', facing: 3 }]);
    // Palette: Luft zuerst, dann nach Schlüssel sortiert
    expect(direct.palette[0]!.name).toBe('air');
    const keys = direct.palette.slice(1).map(stateKey);
    expect(keys).toEqual([...keys].sort());
  });

  it('Reihenfolge der Blöcke und Namensraum ändern nichts', () => {
    const ev = exportVolume();
    const shuffled: ExportVolume = { ...ev, blocks: [...ev.blocks].reverse().map((b) => ({ ...b, name: `minecraft:${b.name}` })) };
    expect(gridDigest(gridFromVolume(shuffled, tableClassifier))).toBe(gridDigest(gridFromVolume(ev, tableClassifier)));
  });

  it('eine geänderte Zelle ändert die Prüfsumme; Blockzahlen ohne Luft', () => {
    const ev = exportVolume();
    const g = gridFromVolume(ev, tableClassifier);
    const changed = gridFromVolume({ ...ev, blocks: ev.blocks.map((b) => (b.pos.join() === '7,4,6' ? { ...b, name: 'torch', properties: {} } : b)) }, tableClassifier);
    expect(gridDigest(changed)).not.toBe(gridDigest(g));
    const counts = blockCounts(g);
    expect(counts.total).toBe(ev.blocks.length);
    expect(counts.byName[0]![0]).toBe('grass_block');
    expect(g.cells[gridIndex(g.size, 7, 4, 6)]).toBeGreaterThan(0);
  });

  it('Block außerhalb der Größe ist ein Fehler', () => {
    const ev = exportVolume();
    expect(() => gridFromVolume({ ...ev, blocks: [...ev.blocks, { pos: [17, 0, 0], name: 'stone' }] }, tableClassifier)).toThrow(/außerhalb/);
  });
});

describe('Goldene Galerie: Analyse aus Blöcken', () => {
  const a = analyze(gridFromVolume(exportVolume(), tableClassifier));

  it('Boden, Hauptbau ohne Baum und Zaun', () => {
    expect(a.groundY).toBe(0);
    expect(a.components).toHaveLength(1);
    // Wände x 4…10, z 4…8; Dachüberstand (1 Block) und Baum/Zaun sind keine Bau-Spalten
    expect(a.main.min[0]).toBe(4);
    expect(a.main.max[0]).toBe(10);
    expect(a.main.min[2]).toBe(4);
    expect(a.main.max[2]).toBe(8);
    expect(a.main.max[1]).toBe(5);
  });

  it('eine Etage (Fuß y 1, Schnitt bis y 3), Innenblick im Haus', () => {
    expect(a.floors).toHaveLength(1);
    const f = a.floors[0]!;
    expect(f).toMatchObject({ index: 1, feetY: 1, cutY: 3 });
    const s = f.spot!;
    expect(s.pos[0]).toBeGreaterThan(4);
    expect(s.pos[0]).toBeLessThan(10);
    expect(s.pos[2]).toBeGreaterThan(4);
    expect(s.pos[2]).toBeLessThan(8);
    expect(s.pos[1]).toBe(1);
  });

  it('Haupttür nach Süden, Ecken mit Traufe', () => {
    expect(a.mainDoor).toMatchObject({ pos: [7, 1, 8], outward: 'south' });
    expect(a.corners.se).toMatchObject({ x: 10, z: 8, out: [1, 1], eaveY: 5, groundY: 0 });
    expect(a.corners.sw).toMatchObject({ x: 4, z: 8, out: [-1, 1] });
  });

  it('Stein-Untergrund unter der Erde zählt nicht als Bau, ein Haus im Hügel schon', () => {
    // Gelände: Stein y 0, Erde y 1, Gras y 2; Hochbeete (1 Block) verstreut; Haus x 5…11, z 5…11 im Hügel
    const blocks: Array<{ pos: [number, number, number]; name: string }> = [];
    const put = (x: number, y: number, z: number, name: string): void => { blocks.push({ pos: [x, y, z], name }); };
    const house = (x: number, z: number): boolean => x >= 5 && x <= 11 && z >= 5 && z <= 11;
    const mound = (x: number, z: number): boolean => x >= 4 && x <= 12 && z >= 4 && z <= 12;
    for (let x = 0; x < 20; x++) {
      for (let z = 0; z < 20; z++) {
        put(x, 0, z, 'stone');
        if (house(x, z)) {
          put(x, 1, z, 'oak_planks');
          if (x === 5 || x === 11 || z === 5 || z === 11) for (let y = 2; y <= 4; y++) put(x, y, z, 'stone_bricks');
          put(x, 5, z, 'oak_planks');
        } else {
          put(x, 1, z, 'dirt');
          put(x, 2, z, 'grass_block');
          if ((x + 2 * z) % 5 === 0) put(x, 3, z, 'mud_bricks');
        }
        if (mound(x, z)) {
          for (let y = house(x, z) ? 6 : 3; y <= 7; y++) put(x, y, z, 'dirt');
          put(x, 8, z, 'grass_block');
        }
      }
    }
    const b = analyze(gridFromVolume({ size: [20, 10, 20], blocks }, tableClassifier));
    expect(b.components).toHaveLength(1);
    expect(b.main.min).toEqual([5, expect.any(Number), 5]);
    expect([b.main.max[0], b.main.max[2]]).toEqual([11, 11]);
  });

  it('Szene für den Browser: nur benutzte Ausschnitte, Zellen ohne Luft, Lichtzeile je Palette', () => {
    const g = gridFromVolume(exportVolume(), tableClassifier);
    const cams = deriveCameras(a, { aspect: 1.6 });
    const p = scenePayload('t', g, cams.variants, cams.views.filter((v) => v.variant === 'voll'), {
      lightRow: (s) => [s.name === 'lantern' ? 15 : 0, 1, 0, 0, 1],
      blockInfo: (name) => (name === 'lantern' ? { properties: { hanging: ['true', 'false'] }, default: { hanging: 'false' } } : undefined),
    });
    expect(p.variants.map((v) => v.key)).toEqual(['voll']);
    expect(p.cells.length / 4).toBe(blockCounts(g).total);
    expect(p.light).toHaveLength(g.palette.length);
    expect(p.light[g.palette.findIndex((s) => s.name === 'lantern')]![0]).toBe(15);
    expect(Object.keys(p.blockInfo)).toEqual(['lantern']);
    expect(p.frames).toEqual([[6, 2, 4, 'item_frame', 3]]);
  });
});
