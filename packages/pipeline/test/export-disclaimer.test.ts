/**
 * Pflicht-Hinweis im Export (W1-H, HANDOFF §1): `toExport` schaltet ihn an EINER Stelle für App und Engine ein.
 * Geprüft wird die fertige Datei je Format (NBT gelesen), nicht nur das Volumen.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeNbt, reqTag, type NbtCompound } from '@mcda/export';
import { exportFile, importFile, nodeGzip } from '@mcda/export/node';
import { toExportVolume } from '@mcda/voxel';
import { EXPORT_DISCLAIMER, generate, toExport } from '../src/index.js';
import { nodeContext } from '../src/node-context.js';
import { sampleHouse } from './helpers.js';

const ctx = nodeContext(fileURLToPath(new URL('../../../catalog', import.meta.url)));
const root = (bytes: Uint8Array): NbtCompound => decodeNbt(nodeGzip.gunzip(bytes)).root;

describe('toExport: Disclaimer in jeder Exportdatei', () => {
  it('Wortlaut wie HANDOFF §1', () => {
    expect(EXPORT_DISCLAIMER).toBe('NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.');
  });

  for (const version of ['1.21.11', '26.3'] as const) {
    it(`${version}: .litematic Metadata.Description, .schem Metadata.Disclaimer, .nbt ohne Zusatz-Tag`, () => {
      const project = sampleHouse(version, 'medieval');
      const world = generate(project, ctx, { roof: 'hip' });
      const ev = toExport(project, world);
      expect(ev.disclaimer).toBe(EXPORT_DISCLAIMER);
      // Nur das Feld kommt dazu – Blöcke, Größe, Name wie das rohe Volumen der Welt
      const raw = toExportVolume(world.materialized.volume, { name: project.state.name, dataVersion: project.state.targetVersion.dataVersion });
      expect({ ...ev, disclaimer: undefined }).toEqual({ ...raw, disclaimer: undefined });

      const lit = root(exportFile('litematic', ev));
      expect(reqTag(reqTag(lit, 'Metadata', 'compound'), 'Description', 'string').value).toBe(EXPORT_DISCLAIMER);
      expect(reqTag(reqTag(lit, 'Metadata', 'compound'), 'Name', 'string').value).toBe(project.state.name);

      const schem = reqTag(root(exportFile('schem', ev)), 'Schematic', 'compound');
      const meta = reqTag(schem, 'Metadata', 'compound');
      expect(reqTag(meta, 'Disclaimer', 'string').value).toBe(EXPORT_DISCLAIMER);
      expect(reqTag(meta, 'Name', 'string').value).toBe(project.state.name);

      const nbt = root(exportFile('nbt', ev));
      expect(Object.keys(nbt.value).sort()).toEqual(['DataVersion', 'blocks', 'entities', 'palette', 'size']);

      for (const fmt of ['nbt', 'schem', 'litematic'] as const) expect(importFile(fmt, exportFile(fmt, ev)).blocks.length, fmt).toBe(ev.blocks.length);
    });
  }
});
