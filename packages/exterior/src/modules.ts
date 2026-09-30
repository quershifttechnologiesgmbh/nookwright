/**
 * W5-B (Review W4-R N4): Wahl des Fenster- bzw. Eingangsmoduls eines Gebäudes – „der Bautyp gibt die Familie vor, das
 * Theme das Material“. Rein; liest nur Katalog-Tags und `styleTags` der Modul-Komponenten.
 */
import type { Catalog } from '@mcda/catalog';
import { MODULE_FAMILY_PREFIX, MODULE_WALL_TAGS, type ModuleWalls } from './types.js';

/** Wandmaterial einer Modul-Komponente (Tag), `undefined` ohne Tag. */
export function moduleWalls(catalog: Catalog, componentId: string): ModuleWalls | undefined {
  const tags = catalog.find(componentId)?.tags ?? [];
  return tags.includes(MODULE_WALL_TAGS.wood) ? 'wood' : tags.includes(MODULE_WALL_TAGS.stone) ? 'stone' : undefined;
}

/** W6-B: Familien-Tags einer Modul-Komponente (`module_<familie>`). */
function moduleFamilies(catalog: Catalog, componentId: string): string[] {
  return (catalog.find(componentId)?.tags ?? []).filter((t) => t.startsWith(MODULE_FAMILY_PREFIX));
}

/**
 * W5-B Modulwahl (Fenster und Eingang gleich): Stil → Theme (`styleTags`, Reihenfolge `ids`) → Standard. Mit
 * `themeMaterial` gilt das Modul des Stils nur, wenn es für dasselbe Wandmaterial gebaut ist wie das des Themes.
 * W6-B (27.09.2026): sonst zuerst ein Modul derselben Familie (`module_<familie>`, Reihenfolge `ids`) im Wandmaterial
 * des Themes – Stein-Laibung → Stammwangen (`fort`) am Holz-Wehrbau –, erst dann das Modul des Themes.
 */
export function chooseModule<Id extends string>(
  catalog: Catalog, chosen: Id | undefined, themeMaterial: boolean | undefined, themeId: string | undefined,
  ids: readonly Id[], fallback: Id, component: (id: Id) => string,
): Id {
  const ofTheme = (): Id => {
    if (themeId !== undefined) for (const id of ids) if (catalog.find(component(id))?.styleTags?.includes(themeId) === true) return id;
    return fallback;
  };
  if (chosen === undefined) return ofTheme();
  if (themeMaterial !== true || themeId === undefined) return chosen;
  const theme = ofTheme();
  const want = moduleWalls(catalog, component(theme));
  if (want === undefined || moduleWalls(catalog, component(chosen)) === want) return chosen;
  const families = moduleFamilies(catalog, component(chosen));
  const kin = ids.find((id) => id !== chosen && moduleWalls(catalog, component(id)) === want
    && moduleFamilies(catalog, component(id)).some((f) => families.includes(f)));
  return kin ?? theme;
}

