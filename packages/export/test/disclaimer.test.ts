/**
 * Disclaimer in den Exportdateien (W1-H, HANDOFF §1): `ExportVolume.disclaimer` landet in `.litematic`
 * `Metadata.Description` und in `.schem` `Metadata.Disclaimer`; `.nbt` bleibt bewusst unverändert (kein Textfeld).
 * Ohne Disclaimer sind die Bytes bitgleich zum Stand vor W1-H – die Prüfsummen unten wurden VOR der Änderung auf
 * `w1/eine-app` (da7e938) gemessen.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildExportTag, buildLitematicTag, buildLitematicTagMulti, decodeNbt, DISCLAIMER_SEPARATOR, DV, encodeExport, encodeMutf8,
  encodeNbt, EXPORT_FORMATS, mutf8Length, NBT_STRING_MAX_BYTES, parseLitematicTag, parseSpongeTag, reqTag, tileVolume,
  withDisclaimer, type ExportFormat, type ExportVolume, type NbtCompound,
} from '../src/index.js';
import { exportFile, importFile } from '../src/node.js';
import { buildTestVolume } from './fixtures/testset.js';
import { normalized, readNbt } from './util.js';

const DISCLAIMER = 'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.';
const DATE = Date.UTC(2026, 8, 23, 12, 0, 0);
const VERSIONS = [DV.MC_1_20_1, DV.MC_1_21_1, DV.MC_1_21_11, DV.MC_26_3] as const;

/** sha256 (16 Hex) von `encodeExport(fmt, buildTestVolume(dv), { date: DATE })`, gemessen vor W1-H. */
const BEFORE: Readonly<Record<string, string>> = {
  '3465:nbt': '8f623eb623b793bf', '3465:schem': 'af43099e682f79a6', '3465:litematic': 'ebb8461a3eb9e366',
  '3955:nbt': 'cd822453301a8bca', '3955:schem': '446e15b4254bd922', '3955:litematic': '3abfe582341ea25f',
  '4671:nbt': 'b157b6853878dd9d', '4671:schem': 'dd2986bf7b605a56', '4671:litematic': '53af70e7ff36d71d',
  '5023:nbt': 'ed951f3b814547dc', '5023:schem': 'c15eaeb44037dee9', '5023:litematic': 'dc5792028466df9d',
};

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex').slice(0, 16);
const withD = (v: ExportVolume, disclaimer: string = DISCLAIMER): ExportVolume => ({ ...v, disclaimer });
const tag = (fmt: ExportFormat, v: ExportVolume): NbtCompound => decodeNbt(encodeExport(fmt, v, { date: DATE })).root;
const litMeta = (root: NbtCompound): NbtCompound => reqTag(root, 'Metadata', 'compound');
const spongeMeta = (root: NbtCompound): NbtCompound => reqTag(reqTag(root, 'Schematic', 'compound'), 'Metadata', 'compound');
const without = (c: NbtCompound, key: string): NbtCompound['value'] => Object.fromEntries(Object.entries(c.value).filter(([k]) => k !== key));

describe('ohne Disclaimer bitgleich (Prüfsummen von vor W1-H)', () => {
  for (const dv of VERSIONS) {
    const v = buildTestVolume(dv);
    for (const fmt of EXPORT_FORMATS) {
      it(`${dv} ${fmt}: ohne Feld und mit leerem Disclaimer dieselben Bytes wie vorher`, () => {
        expect(sha(encodeExport(fmt, v, { date: DATE }))).toBe(BEFORE[`${dv}:${fmt}`]);
        expect(sha(encodeExport(fmt, withD(v, ''), { date: DATE }))).toBe(BEFORE[`${dv}:${fmt}`]);
      });
    }
  }
});

describe.each(VERSIONS)('mit Disclaimer, DataVersion %i', (dv) => {
  const v = buildTestVolume(dv);
  const d = withD(v);

  it('.litematic: Metadata.Description = Disclaimer, alle anderen Felder unverändert', () => {
    const root = tag('litematic', d);
    expect(reqTag(litMeta(root), 'Description', 'string').value).toBe(DISCLAIMER);
    const plain = tag('litematic', v);
    expect(reqTag(litMeta(plain), 'Description', 'string').value).toBe('');
    expect(without(litMeta(root), 'Description')).toEqual(without(litMeta(plain), 'Description'));
    expect(without(root, 'Metadata')).toEqual(without(plain, 'Metadata'));
    // Leser: Name/Author/Regionen wie ohne Disclaimer
    const r = parseLitematicTag(root);
    expect(r.name).toBe(v.name);
    expect(normalized(r.regions[0]!.volume)).toEqual(normalized(v));
  });

  it('.schem: Metadata.Disclaimer (String), Name/Author/Date und Rest unverändert', () => {
    const root = tag('schem', d);
    const meta = spongeMeta(root);
    expect(reqTag(meta, 'Disclaimer', 'string').value).toBe(DISCLAIMER);
    const plain = tag('schem', v);
    expect(spongeMeta(plain).value['Disclaimer']).toBeUndefined();
    expect(without(meta, 'Disclaimer')).toEqual(spongeMeta(plain).value);
    expect(without(reqTag(root, 'Schematic', 'compound'), 'Metadata')).toEqual(without(reqTag(plain, 'Schematic', 'compound'), 'Metadata'));
    expect(normalized(parseSpongeTag(root).volume, { withMeta: true })).toEqual(normalized(v, { withMeta: true }));
  });

  it('.nbt: bewusst kein Disclaimer – Bytes wie ohne, Wurzel nur mit den Vanilla-Feldern', () => {
    expect(encodeExport('nbt', d)).toEqual(encodeExport('nbt', v));
    expect(Object.keys(tag('nbt', d).value).sort()).toEqual(['DataVersion', 'blocks', 'entities', 'palette', 'size']);
  });

  it('fertige Dateien (GZip): Disclaimer auslesbar, Round-Trip der Blöcke unverändert', () => {
    for (const fmt of EXPORT_FORMATS) {
      const file = exportFile(fmt, d, { date: DATE });
      expect(normalized(importFile(fmt, file)), fmt).toEqual(normalized(v));
      const { root } = readNbt(file);
      if (fmt === 'litematic') expect(reqTag(litMeta(root), 'Description', 'string').value).toBe(DISCLAIMER);
      if (fmt === 'schem') expect(reqTag(spongeMeta(root), 'Disclaimer', 'string').value).toBe(DISCLAIMER);
    }
  });
});

describe('.litematic: vorhandene Beschreibung', () => {
  const v = withD(buildTestVolume(DV.MC_1_21_11));
  const desc = (t: NbtCompound): string => reqTag(litMeta(t), 'Description', 'string').value;

  it('wird vorangestellt, Disclaimer angehängt', () => {
    expect(desc(buildLitematicTag(v, { description: 'Taverne am See', timeCreated: DATE }))).toBe(`Taverne am See${DISCLAIMER_SEPARATOR}${DISCLAIMER}`);
  });

  it('enthält sie den Disclaimer schon (erneuter Export), bleibt sie unverändert', () => {
    const once = `Taverne${DISCLAIMER_SEPARATOR}${DISCLAIMER}`;
    expect(desc(buildLitematicTag(v, { description: once, timeCreated: DATE }))).toBe(once);
  });

  it('zu lang: Beschreibung gekürzt (…), Disclaimer vollständig, Datei kodierbar (≤ 65 535 Bytes MUTF-8)', () => {
    for (const long of ['a'.repeat(70_000), 'ä'.repeat(40_000), '😀'.repeat(12_000), 'x'.repeat(65_535 - 1)]) {
      const t = buildLitematicTag(v, { description: long, timeCreated: DATE });
      const text = desc(t);
      expect(mutf8Length(text)).toBeLessThanOrEqual(NBT_STRING_MAX_BYTES);
      expect(mutf8Length(text)).toBeGreaterThan(NBT_STRING_MAX_BYTES - 6); // nicht unnötig gekürzt
      expect(text.endsWith(`…${DISCLAIMER_SEPARATOR}${DISCLAIMER}`)).toBe(true);
      expect(long.startsWith(text.slice(0, text.length - DISCLAIMER.length - DISCLAIMER_SEPARATOR.length - 1))).toBe(true);
      expect(desc(decodeNbt(encodeNbt(t)).root)).toBe(text);
    }
  });

  it('mehrere Regionen: Disclaimer über meta.disclaimer', () => {
    const t = buildLitematicTagMulti(
      [{ name: 'a', position: [0, 0, 0], volume: v }, { name: 'b', position: [20, 0, 0], volume: v }],
      { name: 'zwei', dataVersion: v.dataVersion, disclaimer: DISCLAIMER },
      { timeCreated: DATE },
    );
    expect(desc(t)).toBe(DISCLAIMER);
  });
});

describe('withDisclaimer / mutf8Length', () => {
  it('mutf8Length entspricht dem Encoder (auch U+0000 und Surrogat-Paare)', () => {
    for (const s of ['', 'abc', 'ä€', '\u0000', '😀', 'a\u0000ä😀€z', DISCLAIMER]) expect(mutf8Length(s), s).toBe(encodeMutf8(s).length);
  });

  it('ohne oder mit leerem Disclaimer: Beschreibung unverändert', () => {
    expect(withDisclaimer('x', undefined)).toBe('x');
    expect(withDisclaimer('x', '')).toBe('x');
    expect(withDisclaimer('', undefined)).toBe('');
  });

  it('kürzt nie mitten in einem Surrogat-Paar', () => {
    const text = withDisclaimer('😀'.repeat(20_000), DISCLAIMER);
    const head = text.slice(0, text.indexOf('…'));
    expect(head.length % 2).toBe(0);
    expect(() => encodeMutf8(head)).not.toThrow();
    expect([...head].every((c) => c === '😀')).toBe(true);
  });

  it('Disclaimer allein zu lang → RangeError (wie der Encoder)', () => {
    expect(() => withDisclaimer('', 'x'.repeat(NBT_STRING_MAX_BYTES + 1))).toThrow(RangeError);
    expect(() => buildExportTag('schem', withD(buildTestVolume(DV.MC_26_3), 'x'.repeat(NBT_STRING_MAX_BYTES + 1)))).toThrow(RangeError);
  });

  it('fast 64 KiB langer Disclaimer: kein Platz für die Beschreibung → nur der Disclaimer', () => {
    const big = 'd'.repeat(NBT_STRING_MAX_BYTES - 1);
    expect(withDisclaimer('Beschreibung', big)).toBe(big);
  });
});

it('tileVolume (48³-Kacheln) gibt den Disclaimer an jede Kachel weiter', () => {
  const v = buildTestVolume(DV.MC_1_21_11);
  const big: ExportVolume = { ...v, size: [60, v.size[1], v.size[2]], disclaimer: DISCLAIMER };
  const tiles = tileVolume(big);
  expect(tiles.length).toBeGreaterThan(1);
  for (const t of tiles) expect(t.volume.disclaimer).toBe(DISCLAIMER);
  expect(tileVolume(v).every((t) => !('disclaimer' in t.volume))).toBe(true);
});
