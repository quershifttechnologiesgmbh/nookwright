import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, TARGET_VERSIONS } from '@mcda/blueprint';
import { Catalog, parseComponentDef } from '@mcda/catalog';
import { CellSet } from '@mcda/core';
import { parseTerrainStyle, type TerrainStyleDef } from '../src/index.js';

export const CATALOG_DIR = fileURLToPath(new URL('../../../catalog', import.meta.url));

/** Alle Geländestile aus catalog/terrain (Node-Adapter nur im Test). */
export function loadStyles(): Map<string, TerrainStyleDef> {
  const dir = join(CATALOG_DIR, 'terrain');
  const out = new Map<string, TerrainStyleDef>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json5')).sort()) {
    const r = parseTerrainStyle(readFileSync(join(dir, f), 'utf8'), f);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    out.set(r.value.id, r.value);
  }
  return out;
}

/** Komponenten-Katalog aus catalog/components (Node-Adapter nur im Test, Q3: Gelände-Objekte). */
export function loadCatalog(): Catalog {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.json5') ? [p] : [];
  });
  return Catalog.of(walk(join(CATALOG_DIR, 'components')).sort().map((f) => {
    const r = parseComponentDef(readFileSync(f, 'utf8'), f);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.value;
  }));
}

/** DataVersion der Zielversion 1.21.11 (für `Catalog.byTags`). */
export const DATA_VERSION_1_21_11 = TARGET_VERSIONS['1.21.11'].dataVersion;

/** Beispielhaus wie in der Pipeline: Küche, Schlafzimmer, Lager, Schmiede (Außenmaß, eine Etage). */
export function sampleHouse(version: keyof typeof TARGET_VERSIONS, themeId: string, seed = 2026): Project {
  const p = Project.create({ id: 'sample', name: 'Beispielhaus', seed, themeId, targetVersion: TARGET_VERSIONS[version] });
  p.paintRoom(0, CellSet.rect(0, 0, 8, 6), 'kitchen');
  p.paintRoom(0, CellSet.rect(9, 0, 14, 6), 'bedroom');
  p.paintRoom(0, CellSet.rect(0, 7, 14, 11), 'storage');
  p.paintRoom(0, CellSet.rect(15, 0, 22, 11), 'smithy');
  return p;
}
