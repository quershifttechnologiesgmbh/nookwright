import {
  BuildingTypeCatalog, Catalog, PaletteCatalog, ThemeCatalog, lintBuildingType, parseBuildingTypeDef, parseComponentDef, parsePaletteDef,
  parseRoomTypeDef, parseThemeDef, resolveTheme,
  type BuildingTypeDef, type BuildingTypeRefs, type ComponentDef, type PaletteDef, type RoomTypeDef, type ThemeDef,
} from '@mcda/catalog';
import { EXTERIOR_GROUPS } from '@mcda/pipeline';
import { SITE_TEMPLATES, ZONE_KINDS, parseTerrainStyle } from '@mcda/terrain';
import { bindBuildingTypes } from './buildingTypes.js';
import { ROOF_OPTIONS, bindPalettes, bindThemes } from './usecases.js';

/** Ergebnis des Katalog-Ladens. Fehlerhafte Dateien fallen heraus, der Rest bleibt nutzbar. */
export interface CatalogLoad {
  /** `undefined`, wenn der Katalog gar nicht gebaut werden konnte (z. B. doppelte IDs). */
  readonly catalog: Catalog | undefined;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly files: number;
  /** Themes aus `catalog/themes/` mit aufgelöster Vererbung; `undefined`, wenn kein Theme gültig ist. */
  readonly themeCatalog: ThemeCatalog | undefined;
  /** Auswahlliste aus dem ThemeCatalog (ID + aufgelöster Name, nach ID sortiert). */
  readonly themes: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /**
   * Farbpaletten aus `catalog/palettes/` (Q4, research/54 §3.3): unabhängig vom Theme wählbar, `undefined`, wenn
   * keine gültige Palette da ist. `palettes` ist die Auswahlliste (ID, Name, Stimmung, Name nach Stimmung sortiert).
   */
  readonly paletteCatalog: PaletteCatalog | undefined;
  readonly palettes: ReadonlyArray<{ readonly id: string; readonly name: string; readonly mood: string; readonly styles: readonly string[] }>;
  /**
   * Bautypen aus `catalog/buildingtypes/` (research/19 §7, Assistent „Neues Projekt aus Bautyp“). Fehlerhafte Dateien
   * und Bautypen mit unbekannten Verweisen (Raumtyp, Theme, Dachform, Gelände) fallen mit Meldung heraus.
   */
  readonly buildingTypes: BuildingTypeCatalog;
}

/** Relativer Katalogpfad ab `catalog/` (z. B. „components/bed/single.json5“), unabhängig vom Präfix des Globs. */
export function catalogRelPath(path: string): string {
  const p = path.replaceAll('\\', '/');
  const i = p.lastIndexOf('catalog/');
  return i >= 0 ? p.slice(i + 'catalog/'.length) : p;
}

/**
 * Baut den Katalog aus Dateiinhalten (Pfad → JSON5-Text). Rein: kein I/O.
 * `components/**` → Komponenten, `roomtypes/**` → Raumtypen, `themes/**` → Theme-Liste, `buildingtypes/**` → Bautypen
 * (`terrain/**` nur als Namen für deren Prüfung); alles andere wird übersprungen.
 * Die Themes werden am Katalog angemeldet (`bindThemes`), damit die Einrichtung die Stil-Kette des Projekt-Themes kennt.
 */
export function buildCatalog(files: Readonly<Record<string, string>>): CatalogLoad {
  const errors: string[] = [];
  const warnings: string[] = [];
  const defs: ComponentDef[] = [];
  const roomTypes: RoomTypeDef[] = [];
  const themeDefs: ThemeDef[] = [];
  const paletteDefs: PaletteDef[] = [];
  const typeDefs: BuildingTypeDef[] = [];
  const terrainStyles = new Set<string>();
  const paths = Object.keys(files).sort();

  for (const path of paths) {
    const rel = catalogRelPath(path);
    const text = files[path]!;
    if (rel.startsWith('components/')) {
      const r = parseComponentDef(text, rel);
      if (!r.ok) {
        errors.push(...r.errors);
        continue;
      }
      warnings.push(...r.warnings);
      const expected = rel.slice('components/'.length).replace(/\.json5$/, '');
      if (r.value.id !== expected) warnings.push(`${rel}: id „${r.value.id}“ passt nicht zum Pfad „${expected}“`);
      defs.push(r.value);
    } else if (rel.startsWith('roomtypes/')) {
      const r = parseRoomTypeDef(text, rel);
      if (!r.ok) {
        errors.push(...r.errors);
        continue;
      }
      warnings.push(...r.warnings);
      roomTypes.push(r.value);
    } else if (rel.startsWith('themes/')) {
      const r = parseThemeDef(text, rel);
      if (!r.ok) {
        errors.push(...r.errors);
        continue;
      }
      warnings.push(...r.warnings);
      themeDefs.push(r.value);
    } else if (rel.startsWith('palettes/')) {
      const r = parsePaletteDef(text, rel);
      if (!r.ok) {
        errors.push(...r.errors);
        continue;
      }
      warnings.push(...r.warnings);
      paletteDefs.push(r.value);
    } else if (rel.startsWith('buildingtypes/')) {
      const r = parseBuildingTypeDef(text, rel);
      if (!r.ok) {
        errors.push(...r.errors);
        continue;
      }
      warnings.push(...r.warnings);
      typeDefs.push(r.value);
    } else if (rel.startsWith('terrain/')) {
      const r = parseTerrainStyle(text, rel);
      if (r.ok) terrainStyles.add(r.value.id);
    }
  }

  let catalog: Catalog | undefined;
  try {
    catalog = Catalog.of(defs, roomTypes);
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (catalog !== undefined) {
    for (const id of catalog.roomTypeIds()) {
      for (const tags of catalog.missingTags(id)) warnings.push(`Raumtyp „${id}“: keine Komponente für Tags ${tags}`);
    }
    if (catalog.roomTypeIds().length === 0) errors.push('Der Katalog enthält keine Raumtypen');
  }
  const themeCatalog = buildThemeCatalog(themeDefs, errors);
  // Stil-Kette der Themes für die Einrichtung (Signatur-Tausch, `styleChain` in usecases.ts)
  if (catalog !== undefined && themeCatalog !== undefined) bindThemes(catalog, themeCatalog);
  // Auswahl-Reihenfolge (Review 3: „Die Liste im Auswahlfeld ist unsortiert“): die vier klassischen Themes
  // zuerst (Mittelalter als Standard vorn), danach die übrigen alphabetisch nach Anzeigename.
  const KLASSISCH = ['medieval', 'nordic', 'rustic', 'timber'];
  const themes = themeCatalog === undefined
    ? []
    : themeCatalog.ids()
      .map((id) => ({ id, name: themeCatalog.get(id).name }))
      .sort((a, b) => {
        const ia = KLASSISCH.indexOf(a.id);
        const ib = KLASSISCH.indexOf(b.id);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? KLASSISCH.length : ia) - (ib === -1 ? KLASSISCH.length : ib);
        return a.name.localeCompare(b.name, 'de');
      });
  // Farbpaletten (Q4): unabhängig vom Theme; „Ohne Palette“ ist der Standard (erste Zeile im Auswahlfeld).
  const paletteCatalog = buildPaletteCatalog(paletteDefs, errors);
  const palettes = paletteCatalog === undefined
    ? []
    : paletteCatalog.ids().map((id) => {
        const p = paletteCatalog.get(id);
        return { id, name: p.name, mood: p.mood, styles: p.styles };
      });
  const buildingTypes = buildTypeCatalog(typeDefs, {
    roomTypes: new Set(catalog?.roomTypeIds() ?? []),
    themes: new Set(themeCatalog?.ids() ?? []),
    roofs: new Set(ROOF_OPTIONS.map((r) => r.id)),
    siteTemplates: new Set(SITE_TEMPLATES),
    terrainStyles,
    zoneKinds: new Set(ZONE_KINDS),
    exteriorGroups: new Set(EXTERIOR_GROUPS),
  }, errors);
  // Farbpaletten anmelden (Q4): Auswahlfeld, Vorschau und Bautyp-Assistent brauchen sie ohne Kontext.
  if (catalog !== undefined && paletteCatalog !== undefined) bindPalettes(catalog, paletteCatalog);
  // Bautypen für die Vorlagen (templates.ts) am Katalog anmelden
  if (catalog !== undefined && themeCatalog !== undefined) bindBuildingTypes(catalog, themeCatalog, buildingTypes, paletteCatalog);
  return { catalog, errors, warnings, files: paths.length, themeCatalog, themes, paletteCatalog, palettes, buildingTypes };
}

/** Palettensammlung aus den gültig geparsten Paletten (doppelte ID → Meldung, Datei fällt heraus). */
function buildPaletteCatalog(defs: readonly PaletteDef[], errors: string[]): PaletteCatalog | undefined {
  if (defs.length === 0) return undefined;
  try {
    return PaletteCatalog.of(defs);
  } catch (e) {
    errors.push((e as Error).message);
    return undefined;
  }
}

/** Bautypen mit gültigen Verweisen (`lintBuildingType`); bei doppelter ID gilt der erste. */
function buildTypeCatalog(defs: readonly BuildingTypeDef[], refs: BuildingTypeRefs, errors: string[]): BuildingTypeCatalog {
  const ok = new Map<string, BuildingTypeDef>();
  for (const d of defs) {
    const problems = lintBuildingType(d, refs);
    if (ok.has(d.id)) problems.push(`Bautyp '${d.id}' ist doppelt`);
    if (problems.length > 0) errors.push(...problems.map((p) => `buildingtypes: ${p}`));
    else ok.set(d.id, d);
  }
  return BuildingTypeCatalog.of([...ok.values()]);
}

/**
 * ThemeCatalog aus den gültig geparsten Themes. Themes mit Fehlern (doppelte ID, fehlende Pflicht-Rollen,
 * unbekannte Basis, Zyklus) fallen heraus und werden gemeldet; Kinder eines herausgefallenen Themes folgen
 * in der nächsten Runde (dann mit „unbekannte Basis“).
 */
function buildThemeCatalog(defs: readonly ThemeDef[], errors: string[]): ThemeCatalog | undefined {
  const seen = new Set<string>();
  let pool: ThemeDef[] = [];
  for (const d of defs) {
    if (seen.has(d.id)) errors.push(`themes: Theme '${d.id}' ist doppelt`);
    else pool.push(d);
    seen.add(d.id);
  }
  for (;;) {
    const map = new Map(pool.map((d) => [d.id, d]));
    const failed = pool.flatMap((d) => {
      const r = resolveTheme(map, d.id);
      return r.ok ? [] : [{ id: d.id, errors: r.errors }];
    });
    if (failed.length === 0) break;
    for (const f of failed) errors.push(...f.errors.map((e) => `themes: ${e}`));
    pool = pool.filter((d) => !failed.some((f) => f.id === d.id));
  }
  if (pool.length === 0) return undefined;
  try {
    return ThemeCatalog.of(pool);
  } catch (e) {
    errors.push((e as Error).message);
    return undefined;
  }
}
