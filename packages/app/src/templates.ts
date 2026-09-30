/**
 * Use Case „Neues Projekt aus Vorlage“ – seit U4 über Bautypen (research/19 §7.7): Die früheren Vorlagen (Beispielhaus,
 * Große Halle, Zweistöckiges Haus, Fachwerkhaus) sind feste Bautypen in `catalog/buildingtypes/` und entstehen über
 * denselben Weg wie der Assistent (`typeSession`, buildingTypes.ts). Ergebnis wie vorher (Räume, Etagen, Treppen, Stil;
 * Prüfsummen in test/buildingTypes.test.ts): zentriert im Raster, Theme des Bautyps oder das bisherige, Stilfelder,
 * die der Bautyp nicht setzt, vom bisherigen Projekt. Die Vorlage beginnt ohne Undo-Schritte; der Projektwechsel selbst
 * ist über `replaceSession` rückgängig zu machen.
 */
import type { RoofStyle } from '@mcda/blueprint';
import { Catalog, type BuildingTypeCatalog, type BuildingTypeDef } from '@mcda/catalog';
import { boundTypes, defaultParams, isFixed, typeSession, type TypeContext } from './buildingTypes.js';
import { DEFAULT_ROOF, createSession, shellStyle, type Session, type ShellStyle } from './usecases.js';

/** `empty` oder die ID eines festen Bautyps. */
export type TemplateId = string;
export const EMPTY_TEMPLATE = 'empty';

/** Kontext der Vorlagen: Katalog, Themes, Bautypen. */
export type TemplateContext = TypeContext & { readonly types: BuildingTypeCatalog };

/** Feste Bautypen (frühere Vorlagen) in Katalog-Reihenfolge. */
export function templateTypes(types: BuildingTypeCatalog): BuildingTypeDef[] {
  return types.ids().map((id) => types.get(id)).filter(isFixed);
}

/**
 * Neue Sitzung aus einer Vorlage. `ctx`: Kontext oder nur der Katalog (Themes und Bautypen hat dann `buildCatalog`
 * angemeldet). `style`: Stil des bisherigen Projekts (oder nur seine Dachform); der Bautyp überschreibt, was er festlegt.
 */
export function templateSession(id: TemplateId, ctx: TemplateContext | Catalog, seed: number, themeId: string, style: RoofStyle | Partial<ShellStyle> = DEFAULT_ROOF): Session {
  const inherited = typeof style === 'string' ? shellStyle({ roof: style }) : shellStyle({ roof: style.roof ?? DEFAULT_ROOF, ...style });
  if (id === EMPTY_TEMPLATE) return createSession(seed, 'Unbenannt', themeId, inherited.roof);
  const c = ctx instanceof Catalog ? boundTypes(ctx) : ctx;
  if (c === undefined || !c.types.ids().includes(id)) throw new Error(`Unbekannte Vorlage „${id}“`);
  const def = c.types.get(id);
  return typeSession(def, defaultParams(def, c.themes.ids(), themeId, inherited), seed, c, inherited).session;
}
