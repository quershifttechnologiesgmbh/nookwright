/// <reference types="node" />
/**
 * Pflicht-Hinweis in den Exportdateien (W1-H, HANDOFF §1: „in UI und Export“): App (`exportProject`) und Engine-API
 * (`encodeResult`, dieselbe Kodierung wie HTTP-Datei-Antwort, Worker-Pool und MCP) schreiben ihn gleich, weil beide
 * über `toExport` aus `@mcda/pipeline` gehen. Gelesen wird die fertige Datei (GZip-NBT).
 */
import { decodeNbt, EXPORT_FORMATS, reqTag, type ExportFormat, type NbtCompound } from '@mcda/export';
import { importFile, nodeGzip } from '@mcda/export/node';
import { createEngine } from '@mcda/engine';
import { encodeResult, REPO_CATALOG } from '@mcda/engine/node';
import { EXPORT_DISCLAIMER } from '@mcda/pipeline';
import { nodeContext } from '@mcda/pipeline/node';
import { describe, expect, it } from 'vitest';
import { browserContext, loadBundledCatalog } from '../src/adapters/browserContext.js';
import { DISCLAIMER } from '../src/brand.js';
import { exportProject, worldOf } from '../src/exporting.js';
import { sampleSession } from './sample.js';

const load = loadBundledCatalog();
const catalog = load.catalog!;
const pipeline = browserContext(load)!;
const engine = createEngine(nodeContext(REPO_CATALOG));
const DATE = Date.UTC(2026, 8, 26);

/** Text des Disclaimers in der Datei: `.litematic` Metadata.Description, `.schem` Metadata.Disclaimer, `.nbt` keiner. */
function disclaimerIn(fmt: ExportFormat, bytes: Uint8Array): string | undefined {
  const root: NbtCompound = decodeNbt(nodeGzip.gunzip(bytes)).root;
  if (fmt === 'litematic') return reqTag(reqTag(root, 'Metadata', 'compound'), 'Description', 'string').value;
  if (fmt === 'schem') return reqTag(reqTag(reqTag(root, 'Schematic', 'compound'), 'Metadata', 'compound'), 'Disclaimer', 'string').value;
  expect(Object.keys(root.value).sort()).toEqual(['DataVersion', 'blocks', 'entities', 'palette', 'size']);
  return undefined;
}

describe('Disclaimer in den Exportdateien – App und Engine gleich', () => {
  it('ein Wortlaut: UI (brand.ts) = Export (@mcda/pipeline)', () => {
    expect(EXPORT_DISCLAIMER).toBe(DISCLAIMER);
  });

  it('App: exportProject schreibt ihn in .litematic und .schem, .nbt bleibt ohne Zusatz-Tag', async () => {
    const { project } = sampleSession(catalog);
    const world = worldOf(project, await pipeline.ready('1.21.11'));
    for (const fmt of EXPORT_FORMATS) {
      const file = await exportProject(project, world, fmt, nodeGzip, { date: DATE });
      expect(disclaimerIn(fmt, file.bytes), fmt).toBe(fmt === 'nbt' ? undefined : DISCLAIMER);
      expect(importFile(fmt, file.bytes).blocks.length, fmt).toBeGreaterThan(500);
    }
  });

  it('Engine: Datei-Antwort (encodeResult) von rooms_generate trägt ihn im selben Feld', () => {
    for (const format of EXPORT_FORMATS) {
      const r = engine.execute({ op: 'rooms_generate', input: {
        name: 'Beispielhaus', themeId: 'medieval', format,
        rooms: [{ floor: 0, roomTypeId: 'kitchen', rect: [0, 0, 8, 6] }, { floor: 0, roomTypeId: 'bedroom', rect: [9, 0, 14, 6] }],
      } });
      expect(r.ok, JSON.stringify(r.ok ? '' : r.errors)).toBe(true);
      const { file } = encodeResult(r, true, 0);
      expect(file?.name.endsWith(`.${format}`), format).toBe(true);
      expect(disclaimerIn(format, file!.bytes), format).toBe(format === 'nbt' ? undefined : DISCLAIMER);
    }
  });
});
