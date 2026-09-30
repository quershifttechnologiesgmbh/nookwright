/**
 * Integration Vorschau ↔ Materialisierung (verschoben aus packages/viewer/test, als die Viewer-Demo entfiel):
 * Das Lichtfeld des beleuchteten Renderers (@mcda/viewer) mit dem Regel-Adapter der App (textures/lightRules.ts)
 * stimmt mit dem Licht-Pass von @mcda/materialize überein – je Zelle, für alle Themes, mit und ohne Licht-Pass.
 * Mit lokalen Assets (nur wenn vorhanden): beleuchtete Geometrie des Beispielhauses und Spawn-Flächen der Halle.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { CellSet } from '@mcda/core';
import { generate } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { loadRegistryData } from '@mcda/platform/node';
import {
  LIT_OFFSETS, LIT_VERTEX_FLOATS, LitMeshCache, blockLightAt, buildLitGeometry, computeLightField, createDeepslateResources, fieldIndex, skyLightAt,
  toStructure, type AtlasIndex,
} from '@mcda/viewer';
import { expectCpuMsBelow, medianCpuMs } from '../../core/test/support/timing.js';
import { materializeLightRules } from '../src/textures/lightRules.js';

describe('Übereinstimmung mit dem Licht-Pass (@mcda/materialize) am Beispielhaus', () => {
  const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
  const house = (lighting: boolean, theme = 'medieval', hall = false): ReturnType<typeof generate> => {
    const p = Project.create({ id: 'sample', name: 'Beispielhaus', seed: 2026, themeId: theme, targetVersion: TARGET_VERSIONS['1.21.11'] });
    if (hall) {
      p.paintRoom(0, CellSet.rect(0, 0, 24, 18), 'bedroom'); // große Halle: ohne Licht-Pass bleiben dunkle Stellen
    } else {
      p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
      p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
      p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
      p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
    }
    return generate(p, ctx, { roof: 'hip', ...(lighting ? {} : { lighting: false }) });
  };

  it('Blocklicht je Zelle identisch, Spawn-Zellen dunkel, Lichtberechnung < 50 ms', () => {
    const cases = [...ctx.themes.ids().flatMap((t) => [[t, true, false], [t, false, false]] as const), ['medieval', false, true] as const];
    for (const [theme, lighting, hall] of cases) {
      {
        const world = house(lighting, theme, hall);
        const volume = world.materialized.volume;
        const rules = materializeLightRules(ctx.platform('1.21.11'));
        const field = computeLightField(volume, rules);
        const [w, h, l] = volume.size;
        const [ox, oy, oz] = volume.origin;
        let diff = 0;
        for (let y = 0; y < h; y++) for (let z = 0; z < l; z++) for (let x = 0; x < w; x++) {
          const p = [x + ox, y + oy, z + oz] as const;
          if (blockLightAt(field, p) !== world.materialized.light.levelAt(p)) diff++;
        }
        expect(diff, `${theme}, Licht-Pass ${lighting}`).toBe(0);
        for (const d of world.materialized.light.darkCells) expect(blockLightAt(field, d.pos)).toBe(0);
        if (hall) expect(world.materialized.light.darkCells.length).toBeGreaterThan(0);
      }
    }
    // Zeitmessung (warm): Zellen einlesen + Block- und Himmelslicht
    const volume = house(true).materialized.volume;
    const rules = materializeLightRules(ctx.platform('1.21.11'));
    const median = expectCpuMsBelow(() => medianCpuMs(() => computeLightField(volume, rules), 20), 50, 'Lichtfeld Median');
    console.info(`Lichtfeld Beispielhaus ${volume.size.join('×')}: Median ${median.toFixed(2)} ms CPU`);
  });

  it('Himmelslicht: innen durch Fenster, unter dem Dach dunkler als draußen', () => {
    const world = house(true);
    const volume = world.materialized.volume;
    const field = computeLightField(volume, materializeLightRules(ctx.platform('1.21.11')));
    const inside = world.materialized.light.darkCells.length === 0 ? [4, 1, 3] as const : world.materialized.light.darkCells[0]!.pos;
    expect(skyLightAt(field, inside)).toBeLessThan(15);
    expect(skyLightAt(field, [volume.origin[0], volume.origin[1] + volume.size[1] - 1, volume.origin[2]])).toBe(15); // Ecke oben außen
  });
});

// ------------------------------------------------------------------------------------------ lokale Assets

const ASSETS = fileURLToPath(new URL('../../../local/mc-assets/1.21.11/', import.meta.url));
const HAS_ASSETS = !process.env['MCDA_SKIP_JAR'] && ['atlas.json', 'blockstates.json', 'models.json', 'block-flags.json'].every((f) => existsSync(`${ASSETS}${f}`));

describe.skipIf(!HAS_ASSETS)('Beispielhaus mit den lokalen 1.21.11-Assets', () => {
  it('Geometrie mit Licht: keine Fehler, Zeiten, Spawn-Flächen der Halle ohne Licht-Pass', () => {
    const read = <T>(f: string): T => JSON.parse(readFileSync(`${ASSETS}${f}`, 'utf8')) as T;
    const registry = loadRegistryData('1.21.11');
    const models = read<Record<string, unknown>>('models.json');
    const real = createDeepslateResources({
      version: '1.21.11', atlas: { width: 1, height: 1, data: new Uint8Array(4) }, atlasIndex: read<AtlasIndex>('atlas.json'),
      blockstates: read('blockstates.json'), models, blockFlags: read('block-flags.json'), blockInfo: (n) => registry.blocks[n],
    });
    const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
    const rules = materializeLightRules(ctx.platform('1.21.11'));
    const build = (hall: boolean): ReturnType<typeof generate> => {
      const p = Project.create({ id: 'sample', name: 'B', seed: 2026, themeId: 'medieval', targetVersion: TARGET_VERSIONS['1.21.11'] });
      if (hall) p.paintRoom(0, CellSet.rect(0, 0, 24, 18), 'bedroom');
      else {
        p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
        p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
        p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
        p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
      }
      return generate(p, ctx, { roof: 'hip', ...(hall ? { lighting: false } : {}) });
    };

    const volume = build(false).materialized.volume;
    const cache = new LitMeshCache(real, models);
    const t0 = performance.now();
    const field = computeLightField(volume, rules);
    const t1 = performance.now();
    const { structure } = toStructure(volume);
    const t2 = performance.now();
    const cold = buildLitGeometry(structure, real, field, { cache });
    const t3 = performance.now();
    const cut = toStructure(volume, { maxY: volume.origin[1] + 3 }).structure;
    const t4 = performance.now();
    buildLitGeometry(cut, real, field, { cache });
    const t5 = performance.now();
    console.info(`Beispielhaus: Licht ${(t1 - t0).toFixed(1)} ms, Struktur ${(t2 - t1).toFixed(1)} ms, Geometrie kalt ${(t3 - t2).toFixed(1)} ms (${cold.quads} Flächen), Schnitt y≤3 warm ${(t5 - t3).toFixed(1)} ms`);
    expect(cold.errors).toEqual([]);
    expect(cold.quads).toBeGreaterThan(3000);
    // Innenraum: Laternen hell, Innenflächen mit AO < 1 vorhanden
    const v = cold.opaque.vertices;
    let maxBlock = 0, minAo = 1;
    for (let o = 0; o < v.length; o += LIT_VERTEX_FLOATS) {
      maxBlock = Math.max(maxBlock, v[o + LIT_OFFSETS.light]!);
      minAo = Math.min(minAo, v[o + LIT_OFFSETS.light + 2]!);
    }
    expect(maxBlock).toBe(15);
    expect(minAo).toBeLessThanOrEqual(0.4 + 1e-6);

    const hall = build(true);
    const hallField = computeLightField(hall.materialized.volume, rules);
    const spawn = new Set(hall.materialized.light.darkCells.map((d) => fieldIndex(hallField, d.pos)));
    const g = buildLitGeometry(toStructure(hall.materialized.volume).structure, real, hallField, { cache, spawnCells: spawn });
    expect(spawn.size).toBeGreaterThan(0);
    expect(g.spawnQuads).toBeGreaterThanOrEqual(spawn.size * 0.8); // fast jede dunkle Zelle hat eine sichtbare Oberseite darunter
  });
});
