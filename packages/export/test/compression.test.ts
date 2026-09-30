import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  decodeExport, DV, encodeExport, EXPORT_FORMATS, isGzip, readExportFile, readNbtFile, writeExportFile, writeNbtFile,
  nbt, type GzipCodec,
} from '../src/index.js';
import { exportFile, importFile, nodeGzip } from '../src/node.js';
import { buildTestVolume } from './fixtures/testset.js';
import { normalized } from './util.js';

const DATE = Date.UTC(2026, 8, 23, 12, 0, 0);
const v = buildTestVolume(DV.MC_1_21_11);

/** Asynchroner Codec wie später im Browser (CompressionStream), hier über node:zlib simuliert. */
const asyncGzip: GzipCodec = {
  gzip: async (raw) => nodeGzip.gzip(raw),
  gunzip: async (compressed) => nodeGzip.gunzip(compressed),
};

/** Codec, der nie benutzt werden darf. */
const forbidden: GzipCodec = {
  gzip: () => { throw new Error('gzip unerwartet'); },
  gunzip: () => { throw new Error('gunzip unerwartet'); },
};

describe('Kompression als Port', () => {
  it('der Kern liefert rohes, unkomprimiertes NBT (Root-Compound, Name "")', () => {
    for (const fmt of EXPORT_FORMATS) {
      const raw = encodeExport(fmt, v, { date: DATE });
      expect(isGzip(raw)).toBe(false);
      expect(Array.from(raw.subarray(0, 3))).toEqual([10, 0, 0]);
      expect(normalized(decodeExport(fmt, raw))).toEqual(normalized(v));
    }
  });

  it('decodeExport lehnt GZip ab (Hinweis auf readExportFile)', () => {
    expect(() => decodeExport('nbt', exportFile('nbt', v))).toThrow(/readExportFile/);
  });

  it('asynchroner Codec: Datei = gzip(roh), Round-Trip in allen Formaten', async () => {
    for (const fmt of EXPORT_FORMATS) {
      const file = await writeExportFile(fmt, v, asyncGzip, { date: DATE });
      expect(isGzip(file)).toBe(true);
      expect(nodeGzip.gunzip(file)).toEqual(encodeExport(fmt, v, { date: DATE }));
      expect(file).toEqual(exportFile(fmt, v, { date: DATE })); // sync und async identisch
      expect(normalized(await readExportFile(fmt, file, asyncGzip))).toEqual(normalized(v));
      expect(normalized(importFile(fmt, file))).toEqual(normalized(v));
    }
  });

  it('unkomprimierte Dateien werden ohne Codec-Aufruf gelesen', async () => {
    const raw = encodeExport('schem', v, { date: DATE });
    expect(normalized(await readExportFile('schem', raw, forbidden))).toEqual(normalized(v));
    const root = nbt.compound({ a: nbt.int(1) });
    expect((await readNbtFile(await writeNbtFile(root, asyncGzip), asyncGzip)).root).toEqual(root);
  });

  it('der Kern (src/ außer node.ts) importiert keine Node-Module', () => {
    const srcDir = fileURLToPath(new URL('../src', import.meta.url));
    const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && f !== 'node.ts');
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(join(srcDir, f), 'utf8');
      expect(text, f).not.toMatch(/from ['"]node:|require\(|\bBuffer\b|process\./);
    }
  });
});
