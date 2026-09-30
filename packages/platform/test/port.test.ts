import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DATA_FILES,
  PLATFORM_VERSIONS,
  TARGET_VERSIONS,
  createPlatformData,
  dataVersionOf,
  findVersion,
  type RegistryData,
} from '../src/index.js';
import { hasPlatformData, loadIndex, nodePlatformData } from '../src/node.js';

describe('Paketgrenzen', () => {
  it('öffentliche API (src/*.ts außer node.ts) importiert kein Node-Modul und keinen Build-Code', () => {
    const dir = fileURLToPath(new URL('../src', import.meta.url));
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && f !== 'node.ts')
      .filter((f) => /from\s+['"](node:|\.\/build\/)/.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('Versionsliste', () => {
  it('data/index.json passt zu PLATFORM_VERSIONS, Zielversionen sind enthalten', () => {
    expect(loadIndex().versions).toEqual(PLATFORM_VERSIONS);
    for (const v of TARGET_VERSIONS) {
      expect(findVersion(v)).toBeDefined();
      expect(hasPlatformData(v)).toBe(true);
    }
    expect(dataVersionOf('1.21.11')).toBe(4671);
    expect(dataVersionOf('26.3')).toBe(5023);
    expect(() => dataVersionOf('1.7.10')).toThrow(/Unbekannte/);
  });
});

describe('Port PlatformData (Node-Adapter)', () => {
  const platform = nodePlatformData();

  it('lädt Registry, Familien und Physik je Version (gecacht)', async () => {
    expect((await platform.versions()).map((v) => v.id)).toEqual(PLATFORM_VERSIONS.map((v) => v.id));
    const reg = await platform.registry('26.3');
    expect(reg.dataVersion).toBe(5023);
    expect(await platform.registry('26.3')).toBe(reg);
    expect((await platform.families('1.21.11')).families['oak']?.shapes['stairs']).toBe('oak_stairs');
    expect((await platform.physics('1.21.11')).blocks['oak_slab']?.cls).toBe('half');
  });

  it('lehnt unbekannte Versionen ab', async () => {
    await expect(platform.registry('1.12.2')).rejects.toThrow(/Keine Plattform-Daten für Minecraft 1\.12\.2/);
  });
});

describe('createPlatformData (generischer Adapter)', () => {
  const registry: RegistryData = { version: '9.9', dataVersion: 1, source: 'test', blocks: { stone: { properties: {}, default: {} } }, items: [], lootTables: [], blockTags: {} };

  it('lädt jede Datei höchstens einmal und prüft die Version im Inhalt', async () => {
    const loads: string[] = [];
    const files: Record<string, unknown> = {
      [DATA_FILES.index]: { versions: [{ id: '9.9', dataVersion: 1 }] },
      [DATA_FILES.registry('9.9')]: registry,
      [DATA_FILES.families('9.9')]: { version: '8.8' },
    };
    const p = createPlatformData(async (file) => {
      loads.push(file);
      if (!(file in files)) throw new Error(`fehlt: ${file}`);
      return files[file];
    });
    expect((await p.registry('9.9')).hasBlock('minecraft:stone')).toBe(true);
    await p.registry('9.9');
    expect(loads).toEqual([DATA_FILES.index, DATA_FILES.registry('9.9')]);
    await expect(p.families('9.9')).rejects.toThrow(/Version '9\.9'/);
    await expect(p.physics('9.9')).rejects.toThrow(/fehlt/);
  });
});

describe('Umbenennungen (Registry.migrateBlockName)', () => {
  const p = nodePlatformData();

  it('liefert den gültigen Namen je Version oder undefined', async () => {
    const r1 = await p.registry('1.21.1');
    const r26 = await p.registry('26.3');
    expect(r26.migrateBlockName('minecraft:oak_stairs')).toBe('oak_stairs');
    expect(r26.migrateBlockName('chain')).toBe('iron_chain');
    expect(r1.migrateBlockName('iron_chain')).toBe('chain');
    expect(r26.migrateBlockName('grass')).toBe('short_grass');
    expect(r26.migrateBlockName('cushion')).toBeUndefined();
  });
});
