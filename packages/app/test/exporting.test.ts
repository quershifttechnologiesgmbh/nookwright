/// <reference types="node" />
import { gunzipSync, gzipSync } from 'node:zlib';
import { EXPORT_FORMATS, isGzip } from '@mcda/export';
import { importFile, nodeGzip } from '@mcda/export/node';
import type { Violation } from '@mcda/materialize';
import { toExport, type World } from '@mcda/pipeline';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { streamGzip, streamGzipAvailable } from '../src/adapters/gzip.js';
import {
  DEFAULT_EXPORT_FORMAT, EXPORT_FORMAT_OPTIONS, EXPORT_LIMITS, exportFileName, exportProject, exportReport, nothingToExport, placeHint, templateId, volumeTooLarge, worldOf,
} from '../src/exporting.js';
import * as uc from '../src/usecases.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;
const DATE = Date.UTC(2026, 8, 23);

describe('Export-Use-Case (Codec injiziert)', () => {
  it('Beispielhaus → alle drei Formate → Round-Trip mit importFile (Node-Codec)', async () => {
    const { project } = sampleSession(catalog);
    const world = worldOf(project, await pipeline.ready('1.21.11'));
    const ev = toExport(project, world);
    expect(ev.blocks.length).toBeGreaterThan(500);
    for (const fmt of EXPORT_FORMATS) {
      const file = await exportProject(project, world, fmt, nodeGzip, { date: DATE });
      expect(file.name).toBe(`Beispielhaus.${fmt}`);
      expect(file.mime).toBe('application/octet-stream');
      expect(isGzip(file.bytes)).toBe(true);
      const back = importFile(fmt, file.bytes);
      expect(back.blocks.length, fmt).toBe(ev.blocks.length);
      expect(back.dataVersion, fmt).toBe(4671);
    }
    expect(DEFAULT_EXPORT_FORMAT).toBe('litematic');
    expect(EXPORT_FORMAT_OPTIONS.map((f) => f.id)).toEqual(['litematic', 'schem', 'nbt']);
  });

  it('Zielversion 26.3 wirkt auf den Export; veraltete Blöcke werden abgelehnt', async () => {
    const s121 = sampleSession(catalog);
    const s26 = uc.setTargetVersion(s121, catalog, '26.3');
    const old = worldOf(s121.project, await pipeline.ready('1.21.11'));
    await expect(exportProject(s26.project, old, 'litematic', nodeGzip)).rejects.toThrow('bitte neu berechnen');
    const world = worldOf(s26.project, await pipeline.ready('26.3'));
    expect(world.materialized.version).toBe('26.3');
    const back = importFile('schem', (await exportProject(s26.project, world, 'schem', nodeGzip, { date: DATE })).bytes);
    expect(back.dataVersion).toBe(5023);
  });

  it('Bericht: Beispielhaus ohne Fehler; spawn ist Warnung „dunkle Stellen“, weiche Warnungen Hinweise, Rest Fehler', async () => {
    const { project } = sampleSession(catalog);
    const world = worldOf(project, await pipeline.ready('1.21.11'));
    const r = exportReport(world);
    expect(r.errors).toEqual([]);
    expect(r.blocks).toBe(toExport(project, world).blocks.length); // ExportVolume lässt Luft weg
    expect(r.size).toEqual(world.materialized.volume.size);
    expect(r.version).toBe('1.21.11');

    const spawn: Violation = { kind: 'spawn', severity: 'warning', message: 'Raum r1: 2 begehbare Zelle(n) ohne Blocklicht', roomId: 'r1', cells: [[1, 1, 1], [2, 1, 1]] };
    const support: Violation = { kind: 'support', severity: 'error', message: 'lantern bei 3,4,5: braucht Stütze', pos: [3, 4, 5] };
    const shape: Violation = { kind: 'stair_shape', severity: 'warning', message: 'Dachtreppe bei 4,8,4: Hülle wünscht shape=inner_right', pos: [4, 8, 4] };
    const fake: World = { ...world, materialized: { ...world.materialized, violations: [spawn, support, shape] } };
    const f = exportReport(fake);
    expect(f.errors).toEqual([support]);
    expect(f.notes).toEqual([shape]); // weiche Hinweise sind keine harten Verstöße
    expect(f.darkSpots).toEqual([spawn]);
    expect(f.darkCells).toBe(2);
  });

  it('Blöcke werden je Projektzustand zwischengespeichert; Theme-Wechsel ändert die Blöcke', async () => {
    const s = sampleSession(catalog);
    const ctx = await pipeline.ready('1.21.11');
    expect(worldOf(s.project, ctx)).toBe(worldOf(s.project, ctx));
    const nordic = uc.setTheme(s, catalog, 'nordic');
    const names = (w: World) => new Set([...w.materialized.volume.cells()].map((c) => c.state.name));
    expect(names(worldOf(nordic.project, ctx))).not.toEqual(names(worldOf(s.project, ctx)));
  });

  it('Dateiname: Projektname + Endung, verbotene Zeichen ersetzt', () => {
    expect(exportFileName('Beispielhaus', 'litematic')).toBe('Beispielhaus.litematic');
    expect(exportFileName('Burg: Nord/Süd?', 'schem')).toBe('Burg_ Nord_Süd_.schem');
    expect(exportFileName('  ..  ', 'nbt')).toBe('projekt.nbt');
    expect(exportFileName('a'.repeat(200), 'nbt')).toHaveLength(80 + 4);
  });

  it('Hinweis je Format: Litematica, WorldEdit, Strukturdatei mit gültiger Kennung und Ordner je Version', () => {
    const lit = placeHint('litematic', 'Taverne', '1.21.11');
    expect(lit).toContain('schematics');
    expect(lit).toContain('Litematica');
    expect(lit).not.toContain('/place template'); // Review: gehört nur zu .nbt
    const schem = placeHint('schem', 'Taverne', '1.21.11');
    expect(schem).toContain('//schem load');
    expect(schem).toContain('//paste');
    expect(schem).not.toContain('/place template');
    const nbt = placeHint('nbt', 'Große Halle', '1.21.11');
    expect(nbt).toContain('/place template minecraft:grosse_halle ~ ~ ~ none none 1 0 strict');
    expect(nbt).toContain('generated/minecraft/structures');
    expect(nbt).toContain('48 × 48 × 48');
    expect(placeHint('nbt', 'Große Halle', '26.3')).toContain('generated/minecraft/structure`'); // seit 26.1 „structure“
    expect(templateId('Burg: Nord/Süd?')).toBe('burg_nord_sued');
    expect(templateId('  ..  ')).toBe('projekt');
    expect(templateId('Häuser-Zeile 2.0')).toBe('haeuser-zeile_2.0');
  });

  it('R1-15: leeres Projekt ohne Umgebung → Export gesperrt mit Grund; Raum, Treppe oder Umgebung → frei', () => {
    const s = uc.createSession(1);
    expect(nothingToExport(s.project.state, false)).toMatch(/^Noch nichts zu exportieren/);
    expect(nothingToExport(s.project.state, true)).toBeUndefined(); // Mauerring ohne Haus bleibt exportierbar (Review 4)
    const painted = uc.paintRect(s, catalog, { x1: 0, z1: 0, x2: 5, z2: 5 }, 'bedroom').session;
    expect(nothingToExport(painted.project.state, false)).toBeUndefined();
  });
});

describe('Export-Obergrenze unabhängig von der Datei (Review 3)', () => {
  /** Minimal-Welt nur für die Größenschranke: `cells()` wird für die Blockzählung aufgerufen. */
  const welt = (size: [number, number, number], rooms: number, blocks = 100): World =>
    ({
      shell: { rooms: new Map(Array.from({ length: rooms }, (_, i) => [`r${i}`, {}])) },
      materialized: {
        // `exportReport` zählt Nicht-Luft-Zellen; Standard hier: ein paar Steinzellen (sonst gilt der Bau als leer)
        volume: {
          size,
          cells: () => Array.from({ length: blocks }, (_, i) => ({
            pos: [i % Math.max(1, size[0]), 0, Math.floor(i / Math.max(1, size[0])) % Math.max(1, size[2])],
            state: { name: 'minecraft:stone', properties: {} },
          })),
        },
        violations: [], version: '1.21.11', dataVersion: 4671, palette: [], substitutions: [], light: { gaps: [] },
      },
    }) as unknown as World;

  it('nennt Grenze und Größe im Klartext', () => {
    expect(volumeTooLarge([40, 12, 30])).toBeUndefined();
    expect(volumeTooLarge([EXPORT_LIMITS.maxAxis, 6, EXPORT_LIMITS.maxAxis])).toBeUndefined();
    expect(volumeTooLarge([EXPORT_LIMITS.maxAxis + 1, 6, 30])).toContain('zu groß für einen Export');
    expect(volumeTooLarge([40, 12, 30_000])).toContain('2048');
    // Viele Zellen trotz kleiner Kantenlängen (dünne, aber riesige Fläche)
    expect(volumeTooLarge([2048, 16, 2048])).toContain('Zellen');
    expect(volumeTooLarge([40, 12, 30_000])).not.toContain('undefined');
  });

  it('exportReport meldet zu große Bauten als Fehler; exportProject schreibt sie nicht', async () => {
    const klein = exportReport(welt([40, 12, 30], 3));
    expect(klein.errors).toEqual([]);
    const gross = exportReport(welt([3000, 6, 3000], 3));
    expect(gross.errors.map((e) => e.message).join(' ')).toContain('zu groß für einen Export');
    await expect(
      exportProject({ state: { targetVersion: { dataVersion: 4671, name: '1.21.11' } } } as never, welt([3000, 6, 3000], 3), 'litematic', nodeGzip),
    ).rejects.toThrow(/zu groß für einen Export/);
  });
});

describe('„Leer“ heißt ohne Blöcke, nicht ohne Räume (Review 4)', () => {
  /** Bauwerk ohne Haus: Mauerring/Turm (38 × 28 × 48, 5902 Blöcke, keine Räume) bzw. wirklich nichts. */
  const welt = (blocks: number): World =>
    ({
      shell: { rooms: new Map() },
      materialized: {
        volume: {
          size: [38, 28, 48],
          cells: () => Array.from({ length: blocks }, (_, i) => ({ pos: [i % 38, 0, Math.floor(i / 38) % 48], state: { name: 'minecraft:stone_bricks', properties: {} } })),
        },
        violations: [], version: '1.21.11', dataVersion: 4671, palette: [], substitutions: [], light: { gaps: [] },
      },
    }) as unknown as World;

  it('Mauerring/Turm ohne Haus bleibt exportierbar (keine Räume, aber Blöcke)', () => {
    const r = exportReport(welt(5902));
    expect(r.blocks).toBe(5902);
    expect(r.empty).toBe(false);
    expect(r.errors.map((e) => e.message).join(' ')).not.toContain('leer');
  });

  it('wirklich nichts gebaut → Fehler und `empty`', () => {
    const r = exportReport(welt(0));
    expect(r.empty).toBe(true);
    expect(r.errors.map((e) => e.message).join(' ')).toContain('Das Projekt ist leer');
  });
});

describe('Browser-GZip-Adapter (CompressionStream, unter Node gegen node:zlib geprüft)', () => {
  const data = new TextEncoder().encode('Minecraft-Basis '.repeat(500));

  it('ist in Node ≥ 18 verfügbar', () => {
    expect(streamGzipAvailable()).toBe(true);
  });

  it('gzip → node:zlib gunzip und node:zlib gzip → gunzip', async () => {
    const packed = await streamGzip.gzip(data);
    expect(isGzip(packed)).toBe(true);
    expect(packed.length).toBeLessThan(data.length / 10);
    expect(new Uint8Array(gunzipSync(packed))).toEqual(data);
    expect(await streamGzip.gunzip(new Uint8Array(gzipSync(data)))).toEqual(data);
  });

  it('Export mit dem Browser-Codec ist in Node lesbar', async () => {
    const { project } = sampleSession(catalog);
    const world = worldOf(project, await pipeline.ready('1.21.11'));
    const file = await exportProject(project, world, 'litematic', streamGzip, { date: DATE });
    expect(importFile('litematic', file.bytes).blocks.length).toBe(toExport(project, world).blocks.length);
  });
});
