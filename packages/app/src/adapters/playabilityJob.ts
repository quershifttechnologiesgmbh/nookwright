/**
 * W14: Spielbarkeit eines Assistent-Vorschlags als eigenständige Aufgabe (für den Rechen-Worker `computeWorker.ts`).
 * Dieselbe Regel wie im Haupt-Thread (`proposalPlayability`, buildingTypes.ts → `playabilityIssues`, @mcda/pipeline),
 * im Worker mit dem gebündelten Katalog – derselbe Katalog, den `main.tsx` lädt (`loadBundledCatalog`), dieselben
 * Geländestile und Paletten wie der Bautyp-Kontext der App (`typeCtx`). Nachrichten sind reine Daten.
 */
import type { PlayabilityFinding } from '@mcda/pipeline';
import { proposalPlayability, type TypeContext, type TypeParams } from '../buildingTypes.js';
import type { BuildingTypeCatalog } from '@mcda/catalog';
import type { CatalogLoad } from '../catalogLoader.js';
import { loadBundledCatalog } from './browserContext.js';
import { loadBundledTerrainStyles } from './terrainStyles.js';

export interface PlayabilityRequest {
  readonly id: number;
  readonly typeId: string;
  readonly params: TypeParams;
  readonly seed: number;
}

export type PlayabilityReply =
  | { readonly id: number; readonly issues: readonly PlayabilityFinding[] }
  | { readonly id: number; readonly error: string };

interface Bundled {
  readonly ctx: TypeContext;
  readonly types: BuildingTypeCatalog;
}

let bundled: Bundled | undefined;
let catalogLoad: CatalogLoad | undefined;

/** Der gebündelte Katalog, einmal je Worker gelesen (Spielbarkeit und Blöcke teilen ihn, computeWorker.ts). */
export function bundledCatalogLoad(): CatalogLoad {
  return (catalogLoad ??= loadBundledCatalog());
}

/** Bautyp-Kontext aus dem Bundle, wie `typeCtx` in App.tsx (einmal je Worker). */
function bundledContext(): Bundled {
  if (bundled !== undefined) return bundled;
  const load = bundledCatalogLoad();
  if (load.catalog === undefined || load.themeCatalog === undefined) throw new Error('Katalog im Worker nicht ladbar');
  bundled = {
    ctx: {
      catalog: load.catalog, themes: load.themeCatalog, terrainStyles: loadBundledTerrainStyles().styles,
      ...(load.paletteCatalog !== undefined ? { palettes: load.paletteCatalog } : {}),
    },
    types: load.buildingTypes,
  };
  return bundled;
}

/** Katalog schon beim Start des Workers lesen (Fehler kommen mit der ersten Anfrage). */
export function warmPlayability(): void {
  try {
    bundledContext();
  } catch {
    // siehe playabilityJob
  }
}

/** Eine Anfrage beantworten (wirft nie; Fehler als `error`). */
export function playabilityJob(req: PlayabilityRequest, source: () => Bundled = bundledContext): PlayabilityReply {
  try {
    const { ctx, types } = source();
    const def = types.get(req.typeId);
    if (def === undefined) return { id: req.id, error: `Unbekannter Bautyp ${req.typeId}` };
    return { id: req.id, issues: proposalPlayability(def, req.params, req.seed, ctx) };
  } catch (e) {
    return { id: req.id, error: e instanceof Error ? e.message : String(e) };
  }
}
