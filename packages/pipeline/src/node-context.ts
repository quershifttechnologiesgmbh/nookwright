/** Node-Adapter: lädt Katalog, Themes, Paletten, Geländestile, Bautypen und Plattform-Daten von der Platte. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BuildingTypeCatalog, Catalog, PaletteCatalog, ThemeCatalog, parseBuildingTypeDef, parseComponentDef, parsePaletteDef, parseRoomTypeDef, parseThemeDef,
} from '@mcda/catalog';
import type { PlatformView } from '@mcda/materialize';
import { loadFamilies, loadPhysics, loadRegistry } from '@mcda/platform/node';
import { parseTerrainStyle, type TerrainStyleDef } from '@mcda/terrain';
import type { PipelineContext } from './index.js';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json5') ? [p] : [];
  });
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T {
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.value;
}

/** Geländestile aus `<catalogDir>/terrain/*.json5` (fehlt der Ordner: keine). */
export function loadTerrainStyles(catalogDir: string): Map<string, TerrainStyleDef> {
  const dir = join(catalogDir, 'terrain');
  const out = new Map<string, TerrainStyleDef>();
  if (!existsSync(dir)) return out;
  for (const f of walk(dir).sort()) {
    const style = unwrap(parseTerrainStyle(readFileSync(f, 'utf8'), f));
    out.set(style.id, style);
  }
  return out;
}

/** Bautypen aus `<catalogDir>/buildingtypes/*.json5` (fehlt der Ordner: keine). Ungültige Dateien sind ein Fehler. */
export function loadBuildingTypes(catalogDir: string): BuildingTypeCatalog {
  const dir = join(catalogDir, 'buildingtypes');
  if (!existsSync(dir)) return BuildingTypeCatalog.of([]);
  return BuildingTypeCatalog.of(walk(dir).sort().map((f) => unwrap(parseBuildingTypeDef(readFileSync(f, 'utf8'), f))));
}

/** Farbpaletten aus `<catalogDir>/palettes/*.json5` (fehlt der Ordner: leere Sammlung). */
export function loadPalettes(catalogDir: string): PaletteCatalog {
  const dir = join(catalogDir, 'palettes');
  if (!existsSync(dir)) return PaletteCatalog.of([]);
  return PaletteCatalog.of(walk(dir).sort().map((f) => unwrap(parsePaletteDef(readFileSync(f, 'utf8'), f))));
}

/** Kontext des Anwendungsdienstes samt Bautypen (research/19 §7: `projectFromBuildingType(ctx.buildingTypes.get(id), …)`). */
export type NodeContext = PipelineContext & { readonly buildingTypes: BuildingTypeCatalog };

export function nodeContext(catalogDir: string): NodeContext {
  const catalog = Catalog.of(
    walk(join(catalogDir, 'components')).map((f) => unwrap(parseComponentDef(readFileSync(f, 'utf8'), f))),
    walk(join(catalogDir, 'roomtypes')).map((f) => unwrap(parseRoomTypeDef(readFileSync(f, 'utf8'), f))),
  );
  const themes = ThemeCatalog.of(walk(join(catalogDir, 'themes')).map((f) => unwrap(parseThemeDef(readFileSync(f, 'utf8'), f))));
  const cache = new Map<string, PlatformView>();
  const platform = (v: string): PlatformView => {
    let p = cache.get(v);
    if (p === undefined) {
      p = { registry: loadRegistry(v), families: loadFamilies(v), physics: loadPhysics(v) };
      cache.set(v, p);
    }
    return p;
  };
  return {
    catalog, themes, platform, terrainStyles: loadTerrainStyles(catalogDir), buildingTypes: loadBuildingTypes(catalogDir),
    palettes: loadPalettes(catalogDir),
  };
}
