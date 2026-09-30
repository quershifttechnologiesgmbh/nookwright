/**
 * Browser-Adapter für den Anwendungsdienst (@mcda/pipeline): liefert den `PipelineContext`.
 *
 * - Ports `CatalogSource`: Komponenten, Raumtypen, Themes und Bautypen (`catalog/buildingtypes`, Assistent „Neues
 *   Projekt aus Bautyp“) aus `catalog/` bündelt Vite als Text (`import.meta.glob(…, { query: '?raw', eager: true })`,
 *   läuft auch unter Vitest). Neue Katalogdateien übernimmt der laufende Dev-Server erst, wenn dieses Modul neu
 *   übersetzt wird (Datei speichern oder Server neu starten). Im Build (W7-H, `vite.config.ts`) landen die Texte als
 *   kompaktes JSON (`catalogText.ts`, gleicher Wert) in einem eigenen Chunk `catalog-*.js`, den `index.html` per
 *   `modulepreload` parallel lädt und der Browser unabhängig vom App-Code cacht – der Start bleibt synchron.
 * - Port `PlatformData`: Registry, Familien und Physik je Minecraft-Version aus `packages/platform/data/*.json`
 *   als Vite-JSON-Import, aber LAZY (ein Chunk je Datei, erst geladen, wenn eine Version gebraucht wird –
 *   also bei „Vorschau: Blöcke“ oder Export). Der Start lädt keine Plattform-Daten.
 *
 * `PipelineContext.platform` ist synchron; deshalb lädt `ready(version)` die Version vorher (einmal je Version).
 */
import type { Catalog, PaletteCatalog, ThemeCatalog } from '@mcda/catalog';
import type { PlatformView } from '@mcda/materialize';
import type { PipelineContext } from '@mcda/pipeline';
import { createPlatformData, type PlatformData } from '@mcda/platform';
import { buildCatalog, type CatalogLoad } from '../catalogLoader.js';

/** Katalogdateien als Text (Pfad → Inhalt); auch für Tests, die einen zweiten Katalog bauen. */
export const CATALOG_FILES = import.meta.glob<string>('../../../../catalog/**/*.json5', { query: '?raw', import: 'default', eager: true });

const PLATFORM_DIR = '../../../platform/data/';
/** Nicht eager: jede Datei wird ein eigener Chunk und erst per dynamischem Import geladen. */
const PLATFORM_FILES = import.meta.glob<unknown>('../../../platform/data/*.json', { import: 'default' });

/** Katalog + Raumtypen + Themes aus dem Bundle (fehlerhafte Dateien fallen heraus, siehe `CatalogLoad`). */
export function loadBundledCatalog(): CatalogLoad {
  return buildCatalog(CATALOG_FILES);
}

/** Port `PlatformData` über die gebündelten JSON-Dateien (gleiche Dateikonvention wie der Node-Adapter). */
export const bundledPlatformData: PlatformData = createPlatformData(async (file) => {
  const load = PLATFORM_FILES[`${PLATFORM_DIR}${file}`];
  if (load === undefined) throw new Error(`Plattform-Datei fehlt im Bundle: ${file}`);
  return load();
});

/** Plattform-Daten EINER Version (lädt die drei Dateien parallel). */
export async function loadPlatformView(version: string, data: PlatformData = bundledPlatformData): Promise<PlatformView> {
  const [registry, families, physics] = await Promise.all([data.registry(version), data.families(version), data.physics(version)]);
  return { registry, families, physics };
}

/** Pipeline-Kontext mit nachladbaren Plattform-Daten. */
export interface LazyPipelineContext {
  readonly catalog: Catalog;
  readonly themes: ThemeCatalog;
  /** Farbpaletten (Q4); `undefined`, wenn `catalog/palettes/` leer oder ungültig ist. */
  readonly palettes: PaletteCatalog | undefined;
  /** Lädt die Plattform-Daten der Version (einmal je Version; Fehlschläge werden nicht gemerkt) → Kontext. */
  ready(version: string): Promise<PipelineContext>;
  /** Kontext, falls die Version schon geladen ist; sonst `undefined`. */
  loaded(version: string): PipelineContext | undefined;
}

/** Rein bis auf die injizierte Ladefunktion (Tests: eigene Ladefunktion oder der Bundle-Lader unter Vitest). */
export function lazyPipelineContext(
  catalog: Catalog,
  themes: ThemeCatalog,
  loadPlatform: (version: string) => Promise<PlatformView> = loadPlatformView,
  palettes?: PaletteCatalog,
): LazyPipelineContext {
  const views = new Map<string, PlatformView>();
  const pending = new Map<string, Promise<PlatformView>>();
  const ctx: PipelineContext = {
    catalog,
    themes,
    ...(palettes !== undefined ? { palettes } : {}),
    platform: (v) => {
      const view = views.get(v);
      if (view === undefined) throw new Error(`Plattform-Daten für Minecraft ${v} sind noch nicht geladen`);
      return view;
    },
  };
  return {
    catalog,
    themes,
    palettes,
    loaded: (v) => (views.has(v) ? ctx : undefined),
    async ready(v) {
      if (views.has(v)) return ctx;
      let p = pending.get(v);
      if (p === undefined) {
        p = loadPlatform(v);
        pending.set(v, p);
      }
      try {
        views.set(v, await p);
      } finally {
        pending.delete(v);
      }
      return ctx;
    },
  };
}

/** Kontext für die App aus dem geladenen Katalog; `undefined`, wenn Katalog oder Themes fehlen. */
export function browserContext(load: CatalogLoad): LazyPipelineContext | undefined {
  if (load.catalog === undefined || load.themeCatalog === undefined) return undefined;
  return lazyPipelineContext(load.catalog, load.themeCatalog, loadPlatformView, load.paletteCatalog);
}
