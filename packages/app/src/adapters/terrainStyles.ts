/**
 * Browser-Adapter „Geländestile“: `catalog/terrain/*.json5` bündelt Vite als Text (wie der Katalog in
 * browserContext.ts, läuft auch unter Vitest). Fehlerhafte Dateien fallen mit Meldung heraus.
 */
import { parseTerrainStyle, type TerrainStyleDef } from '@mcda/terrain';

const TERRAIN_FILES = import.meta.glob<string>('../../../../catalog/terrain/*.json5', { query: '?raw', import: 'default', eager: true });

export interface TerrainStyleLoad {
  readonly styles: ReadonlyMap<string, TerrainStyleDef>;
  /** Auswahlliste (ID + Name) in Dateireihenfolge. */
  readonly options: ReadonlyArray<{ readonly id: string; readonly name: string; readonly description?: string | undefined }>;
  readonly errors: readonly string[];
}

/** Geländestile aus Dateiinhalten (Pfad → JSON5-Text). Rein. */
export function buildTerrainStyles(files: Readonly<Record<string, string>>): TerrainStyleLoad {
  const styles = new Map<string, TerrainStyleDef>();
  const errors: string[] = [];
  for (const path of Object.keys(files).sort()) {
    const r = parseTerrainStyle(files[path]!, path.slice(path.lastIndexOf('catalog/')));
    if (!r.ok) errors.push(...r.errors);
    else if (styles.has(r.value.id)) errors.push(`${path}: Geländestil '${r.value.id}' ist doppelt`);
    else styles.set(r.value.id, r.value);
  }
  const options = [...styles.values()].map((s) => ({ id: s.id, name: s.name, description: s.description }));
  return { styles, options, errors };
}

let bundled: TerrainStyleLoad | undefined;

/** Gebündelte Geländestile (einmal geparst). */
export function loadBundledTerrainStyles(): TerrainStyleLoad {
  return (bundled ??= buildTerrainStyles(TERRAIN_FILES));
}
