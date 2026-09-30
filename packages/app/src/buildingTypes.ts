/**
 * Use Cases „Neues Projekt aus Bautyp“ (research/19 §7.7): Galerie nach Familie, Parameter, drei Vorschläge,
 * Übernehmen, danach im Editor „Grundriss neu würfeln“, „Parameter ändern“ und „nur Stil anwenden“. Rein und testbar
 * wie usecases.ts (kein DOM, kein Math.random – Seeds kommen vom Aufrufer).
 *
 * Grundriss und Prüfung liefert `@mcda/archetype` (`planBuilding`), Projekt, Stil und Umgebung der Anwendungsdienst
 * (`projectFromBuildingType`, `rerollBuildingType`). Der Plan geht in EINEM Schritt ins Projekt
 * (`Project.applyBuildingType`); eingerichtet wird wie bei jeder Aktion über `act`.
 *
 * Stil: Der Plan ist mit genau seinem Stil geprüft (Türen hängen an den Flur-Rollen `corridorTypes`). Generierte Typen
 * übernehmen deshalb den ganzen Stil des Bautyps. Feste Grundrisse (die früheren Vorlagen) setzen nur, was die Definition
 * festlegt; der Rest kommt wie bei den alten Vorlagen vom bisherigen Projekt.
 */
import { UNDERGROUND_CORRIDOR, planBuilding, planDraft, resolveShell, supportsFunctions, undergroundDefault, SILHOUETTE_MODES, type BuildingPlan, type PlanShell, type SilhouetteMode } from '@mcda/archetype';
import { Project, TARGET_VERSIONS, buildingTypeScope, type BuildingSetting, type FacadeRhythm, type BuildingTypeScope, type BuildingTypeOrigin, type RoofStyle, type Shell, type StoryState } from '@mcda/blueprint';
import {
  BUILDING_SIZES, FUNCTION_LEVELS, rangeOf, type BuildingSizeClass, type BuildingTypeCatalog, type BuildingTypeDef, type Catalog, type FunctionLevel, type PaletteCatalog, type ThemeCatalog,
} from '@mcda/catalog';
import { hashSeed, type Cell, type HorizontalDir, type PaletteOverrides } from '@mcda/core';
import {
  PARETO_POOL, archetypeContext, evaluateCandidate, normalizeBlockRules, planBuildOptions, planLayoutKey, playabilityIssues, playabilityText, playableDistinct,
  playablePicks, projectFromBuildingType, rerollBuildingType, withoutPilastersForTheme, type BaseOptions, type BlockRules, type PipelineContext,
  type PlayabilityFinding, type ProposalCandidate,
} from '@mcda/pipeline';
import type { Landform, TerrainStyleDef } from '@mcda/terrain';
import { structureItemsOf, styleFromBuild } from '@mcda/projectfile';
import { MARGIN_RANGE, type SurroundingsState } from './surroundings.js';
import {
  DEFAULT_ROOF, DEFAULT_THEME, GRID, act, configureEnsemble, createSession, dormerName, exteriorOptions, facadeOptions, setShellStyle, shellOf, shellStyle, shellThemeOf,
  type Session, type ShellStyle,
} from './usecases.js';

// ---------------------------------------------------------------------------------------------- Galerie

export type FamilyTabId = 'house' | 'fort' | 'nature' | 'fantasy';

/** Reiter der Galerie (research/19 §7.7); Familien des Schemas → Reiter. */
export const FAMILY_TABS: ReadonlyArray<{ readonly id: FamilyTabId; readonly label: string; readonly families: readonly BuildingTypeDef['family'][] }> = [
  { id: 'house', label: 'Haus & Hof', families: ['house'] },
  { id: 'fort', label: 'Burg & Wehr', families: ['fort'] },
  { id: 'nature', label: 'Natur', families: ['nature'] },
  { id: 'fantasy', label: 'Fantasy & Nordisch', families: ['fantasy', 'nordic'] },
];

/** Fester Grundriss (die früheren App-Vorlagen)? */
export const isFixed = (def: BuildingTypeDef): boolean => def.massing.generator === 'fixed';
/** Entwurf (Abzeichen „Vorschau“: Generator oder Regeln noch unvollständig). */
export const isDraft = (def: BuildingTypeDef): boolean => def.status === 'draft';
export const typeLabel = (def: BuildingTypeDef): string => def.label ?? def.name;

/**
 * Galerie: nur Reiter mit Bautypen. Je Reiter zuerst generierte Typen, dann feste Grundrisse, dann Entwürfe (je nach
 * Anzeigename).
 */
export function galleryTabs(types: BuildingTypeCatalog): Array<{ readonly id: FamilyTabId; readonly label: string; readonly types: readonly BuildingTypeDef[] }> {
  const all = types.ids().map((id) => types.get(id));
  const rank = (d: BuildingTypeDef): number => (isDraft(d) ? 2 : isFixed(d) ? 1 : 0);
  return FAMILY_TABS.map((t) => ({
    id: t.id,
    label: t.label,
    types: all.filter((d) => t.families.includes(d.family)).sort((a, b) => rank(a) - rank(b) || typeLabel(a).localeCompare(typeLabel(b), 'de')),
  })).filter((t) => t.types.length > 0);
}

/** „2–3 Etagen“, „1 Etage“ (L3: Singular, wenn Anfang = Ende = 1). */
const span = ([a, b]: readonly [number, number], unit: string, one = unit): string => (a === b ? `${a} ${a === 1 ? one : unit}` : `${a}–${b} ${unit}`);

/** Kurztext der Karte: Beschreibung, sonst aus Größen, Programm und Gelände abgeleitet. */
export function typeSummary(def: BuildingTypeDef, catalog?: Catalog): string {
  if (def.description !== undefined) return def.description;
  const name = (id: string): string => (catalog?.roomTypeIds().includes(id) === true ? catalog.roomType(id).name : id);
  const m = def.massing;
  if (m.generator === 'fixed') {
    const floors = (m.upperFloors ?? 0) + 1;
    // W12-A: Variante mit Obergeschoss (`storeys`) – Etagen als Spanne, Räume beider Varianten
    const most = m.storeys === undefined ? floors : Math.max(floors, m.storeys.upperFloors + 1);
    const rooms = [...m.rooms, ...(m.storeys?.rooms ?? [])];
    const count = most === floors ? `${floors} ${floors === 1 ? 'Etage' : 'Etagen'}` : `${floors}–${most} Etagen`;
    return `Fester Grundriss · ${count} · ${[...new Set(rooms.map((r) => name(r.room)))].join(', ')}`;
  }
  const sizes = BUILDING_SIZES.flatMap((s) => (def.sizes?.[s] !== undefined ? [def.sizes[s]] : []));
  const floors = sizes.map((s) => rangeOf(s.floors));
  const widths = sizes.map((s) => [s.footprint[0][0], s.footprint[1][0]] as const);
  const parts = [
    span([Math.min(...floors.map((f) => f[0])), Math.max(...floors.map((f) => f[1]))], 'Etagen', 'Etage'),
    span([Math.min(...widths.map((w) => w[0])), Math.max(...widths.map((w) => w[1]))], 'breit'),
  ];
  const rooms = [...new Set((def.program ?? []).filter((e) => e.required === true).map((e) => (typeof e.room === 'string' ? name(e.room) : name(e.room[0]!))))];
  if (rooms.length > 0) parts.push(rooms.join(', '));
  if (sizes.some((s) => s.cellar !== undefined && s.cellar !== false)) parts.push('Keller');
  if (m.generator === 'wings' && Object.values(m.wings).some((w) => w.volume === true)) parts.push('Nebengebäude');
  if (def.site?.template === 'homestead') parts.push('Gehöft');
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------------------------- Parameter

/** Parameter des Assistenten (research/19 §7.7 ②). */
export interface TypeParams {
  /** Fehlt bei festen Grundrissen. */
  readonly size?: BuildingSizeClass | undefined;
  /** Blickrichtung der Front (Straße). */
  readonly front: HorizontalDir;
  /** Etagen ab dem Erdgeschoss; fehlt = der Generator wählt im Bereich der Größe. */
  readonly floors?: number | undefined;
  readonly themeId: string;
  /** Farbpalette neben dem Theme (Q4, research/54 §3.3); fehlt = keine (Theme unverändert). */
  readonly paletteId?: string | undefined;
  /**
   * W13-G: Blockpalette vor dem Generieren (Familie je Rollengruppe, Familien-Tausch) – wie `building_generate` mit
   * `paletteOverrides`; fehlt = Farben von Theme und Palette.
   */
  readonly paletteOverrides?: PaletteOverrides | undefined;
  /** Außenanlagen (Außen-Deko: Läden, Vortreppe, Laternen …). */
  readonly exterior: boolean;
  /** Gelände-Vorlage und Zonen des Bautyps in die Umgebung übernehmen. */
  readonly site: boolean;
  /** Stil-Vorgaben, die den Bautyp überschreiben (je Feld ganz, z. B. Dachform aus „Beschreibe dein Gebäude“); fehlt = keine. */
  readonly shell?: Partial<PlanShell> | undefined;
  /** Lage im Gelände (Erdhügel, Pfahlbau …); fehlt = die des Bautyps. */
  readonly setting?: BuildingSetting | undefined;
  /**
   * W3-BL: Block-Regeln des neuen Projekts (gesperrte Blöcke, Preset „Nur leicht farmbar“). Der Assistent übernimmt sie
   * sichtbar aus dem bisherigen Projekt (abwählbar); fehlt = keine. Eingerichtet wird gleich mit ihnen (ein Durchgang).
   */
  readonly blockRules?: BlockRules | undefined;
  /**
   * Additiv (F-Ensemble): Verbindungsgraph der Base (Brücken, Anschluss- und Rundwege) an/aus; fehlt = Standard
   * (`ENSEMBLE_DEFAULT`). Gilt schon beim ersten Einrichten (wie `building_generate { ensemble }`).
   */
  readonly ensemble?: boolean | undefined;
  /**
   * W7-G (nach W7-E): Nutzungszustand aus „Beschreibe dein Gebäude“ (verlassen, verfallen, belagert, neu) – wie
   * `building_generate` mit `storyState`; ändert nur Materialspuren, nie den Grundriss. Fehlt = keiner.
   */
  readonly storyState?: StoryState | undefined;
  /**
   * Feature Unterbau (feat/underground): Keller- bzw. Dungeon-Ebene unter und um das Haus samt Zusatztüren für
   * Rundgänge – wie `building_generate` mit `underground`. Fehlt = Standard des Bautyps (`undergroundDefault`).
   */
  readonly underground?: boolean | undefined;
  /**
   * Funktionsgrad (W2-1): wie viele funktionale Anlagen (Lager mit Sortierer, Farmen, Schmelze, Brauerei, Tresor …) das
   * Haus bekommt – wie `building_generate` mit `functionLevel`. Fehlt = off (Grundriss wie bisher).
   */
  readonly functionLevel?: FunctionLevel | undefined;
  /** Silhouette (WS Schritt 2): 'varied' = Anbau mit eigener Dachhöhe, ungerade Maße – wie `building_generate` mit `silhouette`. Fehlt = off. */
  readonly silhouette?: SilhouetteMode | undefined;
  /**
   * Geländeform (feat/gelaende): 'natural' | 'dramatic' = Hang hinter dem Haus, Teich, Findlinge, Moos – wie
   * `building_generate` mit `landform`. Gilt beim Neubau (Assistent); danach steht sie in der Umgebung
   * (`setLandform`, Panel Umgebung). Fehlt = 'flat' (wie bisher).
   */
  readonly landform?: Landform | undefined;
  /**
   * Fassadenrhythmus (WS-Fassade): 'on' = Fensterachsen im Takt und Gauben auf leeren Dachflächen – wie `building_generate`
   * mit `facadeRhythm`. Fehlt = 'off' (wie bisher, bitgleich).
   */
  readonly facadeRhythm?: FacadeRhythm | undefined;
}

/** Auswahl „Funktionsgrad“ (Reihenfolge = Anzeige): Beschriftung und Erklärung für Panel und Assistent. */
export const FUNCTION_LEVEL_OPTIONS: ReadonlyArray<{ readonly id: FunctionLevel; readonly label: string; readonly hint: string }> = [
  { id: 'off', label: 'Aus', hint: 'Keine funktionalen Anlagen – Grundriss wie bisher' },
  { id: 'some', label: 'Etwas', hint: '1–2 passende Funktionsräume je nach Bautyp und Größe (z. B. Lager mit Sortierer, Kräuter- und Anbauhalle, Tresor, Brauerei, Schmelze)' },
  { id: 'rich', label: 'Viel', hint: 'Mehr und größere Anlagen, wo Platz ist (z. B. Redstone-Werkstatt, Spawner-Kammer, Imkerei, Geheimstudie)' },
];

/** Kennt der Bautyp Funktionsräume (Tabelle `functions`, nicht bei festen Grundrissen)? Sonst bleibt die Auswahl wirkungslos. */
export const hasFunctionRooms = (def: BuildingTypeDef): boolean => supportsFunctions(def);

export const FRONT_OPTIONS: ReadonlyArray<{ readonly id: HorizontalDir; readonly label: string; readonly hint: string }> = [
  { id: 'north', label: 'N', hint: 'Front nach Norden' },
  { id: 'east', label: 'O', hint: 'Front nach Osten' },
  { id: 'south', label: 'S', hint: 'Front nach Süden (Standard)' },
  { id: 'west', label: 'W', hint: 'Front nach Westen' },
];

export const SIZE_LABELS: Readonly<Record<BuildingSizeClass, string>> = { S: 'Klein', M: 'Mittel', L: 'Groß' };

export function sizesOf(def: BuildingTypeDef): BuildingSizeClass[] {
  return isFixed(def) ? [] : BUILDING_SIZES.filter((s) => def.sizes?.[s] !== undefined);
}

/** Wählbare Etagenzahlen der Größe (leer: nur eine Möglichkeit). */
export function floorChoices(def: BuildingTypeDef, size: BuildingSizeClass | undefined): number[] {
  const sz = size === undefined ? undefined : def.sizes?.[size];
  if (sz === undefined) return [];
  const [a, b] = rangeOf(sz.floors);
  return a === b ? [] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/**
 * Startwerte: mittlere Größe, Front Süden, erstes passendes Theme des Bautyps (sonst das bisherige), Außenanlagen und
 * Gelände, wie der Bautyp sie vorsieht (ohne eigene Angabe: wie das bisherige Projekt).
 */
export function defaultParams(def: BuildingTypeDef, themes: readonly string[], currentTheme: string, current?: ShellStyle): TypeParams {
  const sizes = sizesOf(def);
  const size = sizes.includes('M') ? 'M' : sizes[0];
  return {
    ...(size !== undefined ? { size } : {}),
    front: 'south',
    themeId: def.themes?.find((t) => themes.includes(t)) ?? currentTheme,
    ...(current?.paletteId !== undefined ? { paletteId: current.paletteId } : {}),
    exterior: def.exterior === undefined && isFixed(def) ? (current?.exterior.enabled ?? true) : def.exterior !== false,
    site: def.site !== undefined,
    ...(current?.blockRules !== undefined ? { blockRules: current.blockRules } : {}),
  };
}

/** Parameter nach Wechsel der Größe: Etagen außerhalb des neuen Bereichs entfallen. */
export function withSize(def: BuildingTypeDef, p: TypeParams, size: BuildingSizeClass): TypeParams {
  const { floors, ...rest } = p;
  return { ...rest, size, ...(floors !== undefined && floorChoices(def, size).includes(floors) ? { floors } : {}) };
}

// ---------------------------------------------------------------------------------------------- Lage im Raster

/** Verschiebung, die ein festes Rechteck-Programm im Raster zentriert (wie die früheren Vorlagen). */
export function centerOffset(max: Cell, grid: { width: number; depth: number } = GRID): Cell {
  return [Math.max(0, Math.floor((grid.width - (max[0] + 1)) / 2)), Math.max(0, Math.floor((grid.depth - (max[1] + 1)) / 2))];
}

/** Größtmögliche Ausdehnung [Front, Tiefe] des Plans (Hauptbaukörper, Flügel, frei stehende Teile, Zeile) – für die Lage im Raster. */
function maxExtent(def: BuildingTypeDef, size: BuildingSizeClass | undefined): Cell {
  const m = def.massing;
  if (m.generator === 'fixed') {
    return [Math.max(...m.rooms.map((r) => Math.max(r.rect[0], r.rect[2]))) + 1, Math.max(...m.rooms.map((r) => Math.max(r.rect[1], r.rect[3]))) + 1];
  }
  const sz = def.sizes?.[size ?? 'M'] ?? BUILDING_SIZES.map((s) => def.sizes?.[s]).find((s) => s !== undefined);
  if (sz === undefined) return [0, 0];
  let [w, d] = sz.footprint[1];
  if (m.generator === 'row') w *= rangeOf(sz.units ?? 1)[1];
  if (m.generator === 'wings') {
    for (const id of sz.wings ?? []) {
      const wing = m.wings[id];
      if (wing === undefined) continue;
      const out = rangeOf(wing.depth)[1] + (wing.gap ?? 0);
      if (wing.side === 'back') d += out;
      else w += out;
    }
  }
  // W9-G3 (27.09.2026): frei stehende Ensemble-Teile (Abstand ≥ 1, z. B. die Scheune des Bauernhauses) zählen wie
  // Flügel mit; angebaute Teile (Abstand 0, Bergfried der Burg) bleiben wie bisher unberücksichtigt
  for (const id of sz.parts ?? []) {
    const part = def.parts?.[id];
    if (part === undefined) continue;
    const gap = rangeOf(part.anchor.gap ?? 0)[1];
    if (gap < 1) continue;
    const fp = part.sizes?.[size ?? 'M']?.footprint ?? part.footprint;
    if (fp === undefined) continue;
    const [pw, pd] = fp[1];
    const sides = typeof part.anchor.side === 'string' ? [part.anchor.side] : part.anchor.side;
    if (sides.includes('back')) d += pd + gap;
    if (sides.some((x) => x !== 'back')) w += pw + gap;
  }
  return [w, d];
}

/** Linke obere Ecke des Plans im Raster (`BuildingParams.at`): fest wie die früheren Vorlagen, sonst mittig für die größte Ausprägung. */
export function placementOf(def: BuildingTypeDef, params: Pick<TypeParams, 'size' | 'front'>, grid: { width: number; depth: number } = GRID): Cell {
  const [w, d] = maxExtent(def, params.size);
  const across = params.front === 'east' || params.front === 'west';
  return centerOffset(across ? [d - 1, w - 1] : [w - 1, d - 1], grid);
}

// ---------------------------------------------------------------------------------------------- Stil

/**
 * Stil-Optionen des Bautyps ohne Plan (für „nur Stil anwenden“) – dieselben Werte wie `planBuildOptions(plan)`.
 * `underground` (Standard: der des Bautyps): mit Unterbau haben dessen Gänge die Flur-Rolle wie im Plan
 * (`UNDERGROUND_CORRIDOR`), sonst verlöre „Nur Stil anwenden“ ihre Türen.
 */
export function typeBuildOptions(def: BuildingTypeDef, underground = undergroundDefault(def.id)): BaseOptions {
  const s = resolveShell(def);
  // wie `finish` in @mcda/archetype (generate.ts): Eingangs- und Flurraum bekommen die Flur-Rolle
  const own = def.entrance === undefined && def.corridor === undefined ? undefined
    : ['hallway', 'corridor', ...(def.entrance !== undefined ? [def.entrance] : []), ...(def.corridor !== undefined ? [def.corridor.room] : [])];
  // wie `planUnderground`: Gänge des Unterbaus als Flur
  const corridorTypes = underground ? [...new Set([...(own ?? ['hallway', 'corridor']), UNDERGROUND_CORRIDOR])] : own;
  const exterior = def.exterior === false ? undefined
    : {
      density: def.exterior?.density ?? 1, ...Object.fromEntries((def.exterior?.off ?? []).map((g) => [g, false])),
      // W3-CA: Fenstermodul des Bautyps wie `planBuildOptions` (Burg: Stein-Laibung)
      ...(def.exterior?.windowModule !== undefined ? { windowModule: def.exterior.windowModule } : {}),
      // W4-B: Eingangsmodul des Bautyps ebenso (Burg/Wachturm: Stein wie die Fenster)
      ...(def.exterior?.entranceModule !== undefined ? { entranceModule: def.exterior.entranceModule } : {}),
      ...(def.exterior?.themeMaterial !== undefined ? { themeMaterial: def.exterior.themeMaterial } : {}),
    };
  return {
    roof: s.roof,
    overhang: s.overhang,
    windows: s.windows,
    ...(s.roofDetail !== undefined ? { roofDetail: s.roofDetail } : {}),
    ...(s.dormers !== undefined ? { dormers: s.dormers } : {}),
    ...(s.facade !== undefined ? { facade: s.facade } : {}),
    ...(corridorTypes !== undefined ? { corridorTypes } : {}),
    ...(exterior !== undefined ? { exterior } : {}),
  };
}

/** Stil des Anwendungsdienstes → Einstellungen: gemeinsam mit der Engine-API (@mcda/projectfile). */
export { styleFromBuild };

/** Wandvorlagen aus bei Fachwerk-Themes: gemeinsame Regel mit der Engine-API (`@mcda/pipeline`). */
export { withoutPilastersForTheme };

/** Stil-Felder eines festen Grundrisses, die aus dem Bautyp kommen: von der Definition (`shell.*`) oder vom Aufrufer
 * (`params.shell`, z. B. „Flachdach“ aus „Beschreibe dein Gebäude“, W1-G S1a); alle anderen erbt er vom Projekt. */
const SHELL_FIELDS = ['roof', 'overhang', 'windows', 'roofDetail', 'dormers', 'facade'] as const satisfies ReadonlyArray<keyof PlanShell>;
type ShellField = (typeof SHELL_FIELDS)[number];
function ownShellFields(def: BuildingTypeDef, params: Pick<TypeParams, 'shell'>): ReadonlySet<ShellField> {
  const d = (def.shell ?? {}) as Readonly<Record<string, unknown>>;
  const p = (params.shell ?? {}) as Readonly<Record<string, unknown>>;
  return new Set(SHELL_FIELDS.filter((k) => d[k] !== undefined || p[k] !== undefined));
}

/** Stil des Bautyps für die Sitzung. Generierte Typen: ganz (so ist der Plan geprüft). Feste Grundrisse: nur die Felder,
 * die die Definition setzt (`shell.*`, `exterior`) oder die Beschreibung verlangt (`params.shell`, S1a), der Rest von
 * `current` (bisheriges Projekt, ohne dessen Türme und Flur-Rollen). Außenanlagen: an/aus nach `params.exterior`.
 * Ohne `params.shell` bitgleich wie vorher.
 */
export function typeStyle(def: BuildingTypeDef, build: BaseOptions, params: Pick<TypeParams, 'exterior' | 'shell'>, current: ShellStyle): ShellStyle {
  const full = styleFromBuild(build);
  let out: ShellStyle = full;
  if (isFixed(def)) {
    // Block-Regeln erbt ein neues Projekt nur über `TypeParams.blockRules` (sichtbar im Assistenten), nie still
    const { towers: _t, ensemble: _e, corridorTypes: _c, blockRules: _b, loopDoors: _l, facadeRhythm: _f, ...base } = current;
    const own = ownShellFields(def, params);
    out = {
      ...base,
      ...(own.has('roof') ? { roof: full.roof } : {}),
      ...(own.has('overhang') ? { overhang: full.overhang } : {}),
      ...(own.has('windows') ? { windows: full.windows } : {}),
      ...(own.has('roofDetail') ? { roofDetail: full.roofDetail } : {}),
      ...(own.has('dormers') ? { dormers: full.dormers } : {}),
      ...(own.has('facade') ? { facade: full.facade } : {}),
      ...(def.exterior !== undefined ? { exterior: full.exterior } : {}),
      ...(full.corridorTypes !== undefined ? { corridorTypes: full.corridorTypes } : {}),
      ...(full.loopDoors !== undefined ? { loopDoors: full.loopDoors } : {}),
      ...(full.facadeRhythm === true ? { facadeRhythm: true } : {}),
    };
  }
  const x = out.exterior;
  return x.enabled === params.exterior ? out : { ...out, exterior: { ...x, enabled: params.exterior } };
}

/** Dachformen als Nomen für Nutzertexte („Flachdach“) – wie die Plan-Karte des KI-Architekten (Engine-Schema). */
export const ROOF_NAMES: Readonly<Record<RoofStyle, string>> = {
  flat: 'Flachdach', hip: 'Walmdach', gable: 'Satteldach', shed: 'Pultdach', half_hip: 'Krüppelwalmdach', dutch_gable: 'Fußwalmdach',
  mansard: 'Mansarddach', gambrel: 'Scheunendach', saltbox: 'Saltbox-Dach',
};

/**
 * L4: Was ein fester Grundriss vom bisherigen Projekt erbt und sichtbar anders ist als bei einem neuen Projekt – in
 * Worten für den Assistenten („Flachdach“, „Stil Fachwerk“ …). Leer bei generierten Bautypen (sie bringen ihren ganzen
 * Stil mit) und wenn das Erbe dem Standard entspricht. Felder, die der Bautyp oder die Beschreibung setzt, erbt er nicht.
 */
export function inheritedStyle(
  def: BuildingTypeDef, params: Pick<TypeParams, 'themeId' | 'shell'>, current: ShellStyle, currentTheme: string, themeName: (id: string) => string = (id) => id,
): string[] {
  if (!isFixed(def)) return [];
  const own = ownShellFields(def, params);
  const neu = shellStyle({ roof: DEFAULT_ROOF });
  const out: string[] = [];
  if (def.themes === undefined && params.themeId === currentTheme && currentTheme !== DEFAULT_THEME) out.push(`Stil ${themeName(currentTheme)}`);
  if (!own.has('roof') && current.roof !== neu.roof) out.push(ROOF_NAMES[current.roof]);
  // Neigung und Gauben zählen nur bei geneigtem Dach (ein Flachdach hat beides nicht)
  const roof = own.has('roof') ? (params.shell?.roof ?? def.shell?.roof) : current.roof;
  if (roof !== 'flat' && !own.has('roofDetail') && current.roofDetail.pitch !== neu.roofDetail.pitch) {
    out.push(current.roofDetail.pitch === 'steep' ? 'steiles Dach' : current.roofDetail.pitch === 'low' ? 'flach geneigtes Dach' : 'Dachneigung 45°');
  }
  if (!own.has('overhang') && current.overhang !== neu.overhang) out.push(`Dachüberstand ${current.overhang}`);
  if (!own.has('windows') && !current.windows.enabled) out.push('ohne Fenster');
  if (roof !== 'flat' && !own.has('dormers') && current.dormers.kind !== neu.dormers.kind) out.push(`Gauben: ${dormerName(current.dormers.kind)}`);
  const text = (v: unknown): string => JSON.stringify(v ?? null);
  if (!own.has('facade') && text(facadeOptions(current.facade)) !== text(facadeOptions(neu.facade))) out.push('Außenprofil');
  if (def.exterior === undefined && current.exterior.enabled && text(exteriorOptions(current.exterior)) !== text(exteriorOptions(neu.exterior))) out.push('Außen-Deko');
  return out;
}

// ---------------------------------------------------------------------------------------------- Vorschläge

/** Katalog-Sicht der Bautyp-Use-Cases (Themes für die Stil-Kette, Geländestile für die Gelände-Vorlage). */
export interface TypeContext {
  readonly catalog: Catalog;
  readonly themes: ThemeCatalog;
  readonly terrainStyles?: ReadonlyMap<string, TerrainStyleDef> | undefined;
  /** Farbpaletten (Q4); ohne sie bleibt die Vorschau beim Theme ohne Farbwelt. */
  readonly palettes?: PaletteCatalog | undefined;
}

/** Bautypen und Themes je Katalog (wie `bindThemes`); `buildCatalog` meldet sie beim Laden an. */
const bound = new WeakMap<Catalog, { readonly themes: ThemeCatalog; readonly types: BuildingTypeCatalog; readonly palettes?: PaletteCatalog }>();

export function bindBuildingTypes(catalog: Catalog, themes: ThemeCatalog, types: BuildingTypeCatalog, palettes?: PaletteCatalog): void {
  bound.set(catalog, palettes === undefined ? { themes, types } : { themes, types, palettes });
}

/** Angemeldete Bautypen samt Themes des Katalogs (ohne Geländestile). */
export function boundTypes(catalog: Catalog): (TypeContext & { readonly types: BuildingTypeCatalog }) | undefined {
  const b = bound.get(catalog);
  return b === undefined ? undefined : { catalog, ...b };
}

/** Pipeline-Kontext ohne Plattform-Daten (Bautypen brauchen keine Blöcke). */
function pipelineOf(c: TypeContext): PipelineContext {
  return {
    catalog: c.catalog,
    themes: c.themes,
    platform: (v) => {
      throw new Error(`Plattform-Daten ${v} werden für den Bautyp nicht gebraucht`);
    },
    ...(c.terrainStyles !== undefined ? { terrainStyles: c.terrainStyles } : {}),
    ...(c.palettes !== undefined ? { palettes: c.palettes } : {}),
  };
}

/** Parameter des Generators aus den Assistent-Parametern (samt Lage im Raster). */
function buildingParams(def: BuildingTypeDef, p: TypeParams) {
  return {
    ...(p.size !== undefined && !isFixed(def) ? { size: p.size } : {}),
    front: p.front,
    ...(p.floors !== undefined ? { floors: p.floors } : {}),
    themeId: p.themeId,
    ...(p.paletteId !== undefined ? { paletteId: p.paletteId } : {}),
    ...(p.paletteOverrides !== undefined ? { paletteOverrides: p.paletteOverrides } : {}),
    ...(p.shell !== undefined ? { shell: p.shell } : {}),
    ...(p.setting !== undefined ? { setting: p.setting } : {}),
    ...(p.storyState !== undefined ? { storyState: p.storyState } : {}),
    ...(p.underground !== undefined ? { underground: p.underground } : {}),
    ...(p.functionLevel !== undefined && p.functionLevel !== 'off' ? { functionLevel: p.functionLevel } : {}),
    ...(p.silhouette === 'varied' ? { silhouette: p.silhouette } : {}),
    ...(p.facadeRhythm === 'on' ? { facadeRhythm: p.facadeRhythm } : {}),
    at: placementOf(def, p),
  };
}

/**
 * Angeforderte (nicht aufgelöste) Plan-Parameter, die der Generator sonst selbst wählt (W2-ED U1). `plan.params` trägt
 * die AUFGELÖSTE Etagenzahl und Lage; plant man mit ihnen neu, zieht der Generator andere Zufallszahlen und liefert bei
 * unveränderten Parametern einen anderen Grundriss (Taverne: 15 → 17 Räume, W2UX §2.3). Additives Feld in
 * `BuildingTypeOrigin.params` – ältere Projekte ohne es verhalten sich wie bisher.
 */
export interface RequestedPlanParams {
  readonly floors?: number;
  readonly setting?: BuildingSetting;
  readonly shell?: Partial<PlanShell>;
}

const requestedOf = (p: TypeParams): RequestedPlanParams => ({
  ...(p.floors !== undefined ? { floors: p.floors } : {}),
  ...(p.setting !== undefined ? { setting: p.setting } : {}),
  ...(p.shell !== undefined ? { shell: p.shell } : {}),
});

/** Herkunft mit angeforderten Parametern (`requested`) neben den aufgelösten. */
function withRequested(o: BuildingTypeOrigin, p: TypeParams): BuildingTypeOrigin {
  return { ...o, params: { ...o.params, requested: requestedOf(p) } };
}

/** Herkunft am Projekt (wie der Anwendungsdienst: aufgelöste Parameter samt Lage, dazu die angeforderten). */
function originOf(def: BuildingTypeDef, plan: BuildingPlan, at: Cell, rerollCount: number, p?: TypeParams): BuildingTypeOrigin {
  const o: BuildingTypeOrigin = { buildingTypeId: def.id, params: { ...plan.params, at }, seed: plan.seed, rerollCount };
  return p === undefined ? o : withRequested(o, p);
}

/** Drei Seeds je Runde (research/19 §7.7 ③); `base` kommt vom Aufrufer (Browser: Zufall, Tests: fest). */
export function proposalSeeds(base: number, count = 3): number[] {
  return Array.from({ length: count }, (_, i) => hashSeed(base, 'vorschlag', i));
}

/** Vorschläge je Runde: einer bei festen Grundrissen, sonst drei. */
export const proposalCount = (def: BuildingTypeDef): number => (isFixed(def) ? 1 : 3);
/**
 * Reserve je Runde (W1-G, M2): so viele Seeds prüft der Assistent zusätzlich, wenn Vorschläge denselben Grundriss haben.
 * Doppel kommen fast nur bei kleinen Bautypen mit wenigen möglichen Grundrissen vor (Langhaus S, Wachturm S: je 3 in
 * 60 Seeds), deren Pläne je ~10–50 ms kosten; mit 3 blieben dort 10 bzw. 7 von 20 Runden bei zwei Grundrissen, mit 6
 * noch 3 bzw. 1 (Messung in plan/spikes/W1G_treue.md §4). Große Bautypen brauchen die Reserve praktisch nie.
 */
export const PROPOSAL_RESERVE = 6;

/**
 * Kandidaten-Seeds einer Runde (M2): die ersten `proposalCount` wie bisher (`proposalSeeds(base)`), dahinter die
 * Reserve – deterministisch aus dem Basis-Seed. Ohne Doppel bleiben die Vorschläge also dieselben wie vorher.
 */
export function proposalCandidates(def: BuildingTypeDef, base: number): number[] {
  const n = proposalCount(def);
  return proposalSeeds(base, n === 1 ? 1 : n + PROPOSAL_RESERVE);
}

export interface Proposal {
  readonly seed: number;
  readonly plan: BuildingPlan;
  /** Plan übernommen, nicht eingerichtet (nur für die Vorschau). */
  readonly project: Project;
  readonly style: ShellStyle;
  readonly shell: Shell;
}

/**
 * Ein Vorschlag: Plan (geprüft, ≤ ~250 ms), übernommen in ein Probe-Projekt, Hülle mit dem Stil des Bautyps – ohne
 * Einrichtung und Gelände (das kommt erst beim Übernehmen). Deterministisch je Seed.
 */
export function proposal(def: BuildingTypeDef, params: TypeParams, seed: number, ctx: TypeContext, current: ShellStyle): Proposal {
  const bp = buildingParams(def, params);
  const plan = proposalPlan(def, bp, seed, ctx);
  const project = Project.create({
    id: 'vorschau', name: plan.name, seed, themeId: params.themeId, targetVersion: TARGET_VERSIONS['1.21.11'],
    floor: { y0: 0, height: plan.floors.find((f) => f.index === 0)?.height ?? 3 },
  });
  if (params.paletteId !== undefined && ctx.palettes?.find(params.paletteId) !== undefined) project.setPalette(params.paletteId);
  if (params.paletteOverrides !== undefined) project.setPaletteOverrides(params.paletteOverrides);
  project.applyBuildingType(planDraft(plan, originOf(def, plan, bp.at, 0)));
  const build = withoutPilastersForTheme(planBuildOptions(plan), ctx.themes, params.themeId);
  const style = typeStyle(def, build, params, current);
  return { seed, plan, project, style, shell: shellOf(project, style, shellThemeOf(ctx.catalog, project.state.themeId, project.state.paletteId, project.state.paletteOverrides)) };
}

/**
 * W14: zuletzt geplante Vorschläge je Bautyp (Objekt), Kontext und Seed. Der Grundriss (`planBuilding`, @mcda/archetype)
 * liest Farbwelt und Blockpalette nicht (`BuildingParams` kennt sie nicht) – ändert der Assistent nur die Palette, gilt
 * derselbe Plan. Vorher plante jede Palettenänderung alle Kandidaten neu (W13-G offener Punkt). Test: gleicher Plan mit
 * und ohne Palette (`buildingTypes.test.ts`).
 */
const recentPlans = new WeakMap<BuildingTypeDef, Array<{ readonly key: string; readonly catalog: object; readonly themes: object; readonly plan: BuildingPlan }>>();
const RECENT_PLANS = 24;

function proposalPlan(def: BuildingTypeDef, bp: ReturnType<typeof buildingParams>, seed: number, ctx: TypeContext): BuildingPlan {
  const { paletteId: _palette, paletteOverrides: _overrides, ...layout } = bp;
  const key = `${seed}|${JSON.stringify(layout)}`;
  let list = recentPlans.get(def);
  if (list === undefined) recentPlans.set(def, (list = []));
  const hit = list.find((e) => e.key === key && e.catalog === ctx.catalog && e.themes === ctx.themes);
  if (hit !== undefined) return hit.plan;
  const plan = planBuilding(def, { ...bp, reroll: 0 }, seed, archetypeContext(ctx.catalog, ctx.themes));
  list.unshift({ key, catalog: ctx.catalog, themes: ctx.themes, plan });
  list.length = Math.min(list.length, RECENT_PLANS);
  return plan;
}

/**
 * W8-E: Spielbarkeit eines Vorschlags – dieselbe Regel wie `building_propose` (`playabilityIssues`, @mcda/pipeline):
 * das Haus ohne Umgebung an der Lage des Assistenten einrichten und Eingang, Zugang, Treppen und Pflichtobjekte prüfen.
 * Leer = spielbar. Kostet eine Einrichtung (~0,1–1 s je Bautyp).
 */
export function proposalPlayability(def: BuildingTypeDef, params: TypeParams, seed: number, ctx: TypeContext): PlayabilityFinding[] {
  return playabilityIssues(def, buildingParams(def, params), seed, pipelineOf(ctx));
}

/** W8-E: Hinweis für eine unspielbare Karte, z. B. „Pflichtobjekt fehlt: Himmelbett (Schlafzimmer)“. */
export const playabilityNotice = (findings: readonly PlayabilityFinding[], ctx: TypeContext): string => playabilityText(findings, ctx.catalog);

/** Zahl spielbarer verschiedener Grundrisse (Abbruch der Kandidatenschleife, W8-E). */
export function playableCount(slots: ReadonlyArray<{ readonly layout?: string | undefined; readonly issues?: readonly PlayabilityFinding[] | undefined }>): number {
  return playableDistinct(slots.map((s) => s.layout), slots.map((s) => (s.issues === undefined ? undefined : s.issues.length === 0)));
}

/**
 * Eine Runde Vorschläge ohne Doppel (M2) – derselbe Ablauf wie im Assistenten, nur am Stück: Kandidaten der Reihe nach
 * planen, gleiche Grundrisse (`planLayoutKey`, @mcda/pipeline) überspringen, bis `proposalCount` verschiedene da sind;
 * reicht die Reserve nicht, füllen die Doppel auf. W8-E: unspielbare Kandidaten werden wie Doppel übersprungen
 * (`playablePicks`, wie `building_propose`); reicht die Reserve nicht, kommen sie mit `issues` zurück. Deterministisch
 * je Basis-Seed.
 */
export function proposalRound(def: BuildingTypeDef, params: TypeParams, base: number, ctx: TypeContext, current: ShellStyle): Array<Proposal & { readonly issues: readonly PlayabilityFinding[] }> {
  const count = proposalCount(def);
  const done: Array<Proposal & { layout: string; issues: PlayabilityFinding[] }> = [];
  for (const seed of proposalCandidates(def, base)) {
    if (playableCount(done) >= count) break;
    const p = proposal(def, params, seed, ctx, current);
    done.push({ ...p, layout: planLayoutKey(p.plan), issues: proposalPlayability(def, params, seed, ctx) });
  }
  return playablePicks(done.map((d) => d.layout), count, (i) => done[i]!.issues.length === 0).picks.map((i) => {
    const { layout: _layout, ...rest } = done[i]!;
    return rest;
  });
}

// ---------------------------------------------------------------------------------------------- Mehrziel-Vorschläge

/**
 * feat/pareto-proposals: Standard des Schalters „Vorschläge bewerten“ im Assistenten. Aus = bisherige Vorschläge
 * (W8-E, spielbare zuerst); an = Kandidaten-Pool einrichten, bewerten und „Am schönsten / Am praktischsten /
 * Ausgewogen“ zeigen. Einschalten ist ein eigener Schritt (F_pareto_proposals.md §7, Branch `feat/pareto-proposals-on`).
 */
export const PARETO_DEFAULT = false;

/** Kandidaten der bewerteten Runde: die ersten drei wie bisher (`proposalSeeds(base)`), dahinter der Rest des Pools. */
export function paretoSeeds(base: number, pool = PARETO_POOL): number[] {
  return proposalSeeds(base, pool);
}

/**
 * Einen Kandidaten bewerten – dieselbe Regel wie `building_propose` mit `pareto` (`evaluateCandidate`, @mcda/pipeline):
 * Plan, Hülle, Einrichtung, Erschließung, Zielvektor und Spielbarkeit. Ohne Gelände (wie die Vorschau).
 */
export function paretoCandidate(def: BuildingTypeDef, params: TypeParams, seed: number, ctx: TypeContext): ProposalCandidate {
  return evaluateCandidate(def, { ...buildingParams(def, params), surroundings: false }, seed, pipelineOf(ctx));
}

/** Kennzahlen eines Plans für die Karte: Außenmaß des Hauptbaukörpers, Etagen, Keller, Räume, Treppen, Baukörper. */
export function planFacts(plan: BuildingPlan): { readonly width: number; readonly depth: number; readonly floors: number; readonly cellar: boolean; readonly rooms: number; readonly stairs: number; readonly volumes: number } {
  const cells = plan.rooms.filter((r) => r.floor >= 0).flatMap((r) => r.cells.toArray());
  const xs = cells.map((c) => c[0]);
  const zs = cells.map((c) => c[1]);
  return {
    width: cells.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs) + 1,
    depth: cells.length === 0 ? 0 : Math.max(...zs) - Math.min(...zs) + 1,
    floors: plan.floors.filter((f) => f.index >= 0).length,
    cellar: plan.floors.some((f) => f.index < 0),
    rooms: plan.rooms.length,
    stairs: plan.stairs.length,
    volumes: plan.volumes.length,
  };
}

// ---------------------------------------------------------------------------------------------- Übernehmen

/**
 * Umgebung aus dem Ergebnis des Anwendungsdienstes: Gelände (Vorlage, Zonen), Windmühle, Mauerzüge (Ringmauer der
 * Burg) und **Wehrplatten** (`parapets`, BT01). Die Wehrplatte wird nur als **Bindung an ihren Baukörper** gespeichert
 * (`volumeId` + Zinnenmaß) – Spalten und Höhe leitet die App beim Bauen jedes Mal aus der Hülle ab, damit die Zinnen
 * mitwandern, wenn eine Etage radiert oder der Grundriss verkleinert wird (Auftrag BT01; vorher hing die Platte als
 * feste Kopie in der Luft).
 */
function surroundingsOf(res: ReturnType<typeof projectFromBuildingType>): SurroundingsState | undefined {
  // W1-G (S4b): Bauwerke behalten die IDs des Plans (`ring`, `windmill`) – Turmhöhen und -spitzen hängen an der ID
  // (`fort:<id>.t<i>`), so baut die App wie Engine und Galerie. Wehrplatten behalten auch IDs mit Bindestrich
  // (`keep-parapet`, `main-parapet`): die ID beeinflusst die Dachluke. Die gemeinsame Abbildung liegt in @mcda/projectfile.
  const { structures, seq } = structureItemsOf(res.surroundings.structures);
  if (res.site === undefined && structures.length === 0) return undefined;
  const margin = Math.min(MARGIN_RANGE.max, Math.max(MARGIN_RANGE.min, res.plan.site?.margin ?? MARGIN_RANGE.standard));
  const landform = res.site !== undefined ? res.surroundings.landform : undefined;
  return {
    ...(res.site !== undefined ? { site: [...res.site.history] } : {}), terrain: res.site !== undefined, margin, structures, seq,
    ...(landform !== undefined && landform !== 'flat' ? { landform } : {}),
  };
}

/**
 * Neue Sitzung aus einem Bautyp (Assistent „Übernehmen“): Plan in EINEM Schritt ins Projekt, alle Räume eingerichtet,
 * Stil und Umgebung gesetzt. Beginnt ohne Undo-Schritte; der Projektwechsel selbst ist über `replaceSession` EIN
 * Undo-Schritt (zurück zum bisherigen Projekt). `current`: Stil des bisherigen Projekts (feste Grundrisse erben davon).
 */
export function typeSession(
  def: BuildingTypeDef, params: TypeParams, seed: number, ctx: TypeContext, current: ShellStyle, rerollCount = 0,
): { session: Session; plan: BuildingPlan; notes: readonly string[] } {
  const bp = buildingParams(def, params);
  // feat/gelaende: mit Geländeform bekommen auch Bautypen ohne Vorlage ein Grundstück (wie `building_generate`)
  const wantsLand = params.landform !== undefined && params.landform !== 'flat';
  // F-Ensemble: `shellOf` löst den Verbindungsgraphen mit diesem Kontext auf (Einrichtung auf der Hülle mit Brückentüren)
  configureEnsemble(pipelineOf(ctx));
  // DR5 K4 (geteilter Link): Würfel-Zähler wie building_generate `rerollCount`; 0 = wie bisher
  const res = projectFromBuildingType(def, {
    ...bp, ...(wantsLand ? { landform: params.landform } : {}), surroundings: params.site || wantsLand, ...(rerollCount > 0 ? { rerollCount } : {}),
  }, seed, pipelineOf(ctx));
  const style = typeStyle(def, withoutPilastersForTheme(res.build, ctx.themes, params.themeId), params, current);
  const origin = withRequested(res.project.state.origin ?? originOf(def, res.plan, bp.at, 0), params);
  const plainAround = surroundingsOf(res);
  const around = plainAround === undefined || params.ensemble === undefined ? plainAround : { ...plainAround, ensemble: params.ensemble };
  const rules = normalizeBlockRules(params.blockRules);
  const s = act(createSession(seed, res.plan.name, res.project.state.themeId, style.roof), ctx.catalog, (p) => {
    if (res.project.state.paletteId !== p.state.paletteId) p.setPalette(res.project.state.paletteId);
    // W13-G: Blockpalette wie der Anwendungsdienst (projectFromBuildingType setzt sie im Projekt)
    p.setPaletteOverrides(res.project.state.paletteOverrides);
    // W7-G: Zustand wie der Anwendungsdienst (projectFromBuildingType setzt ihn im Projekt)
    if (res.project.state.storyState !== p.state.storyState) p.setStoryState(res.project.state.storyState);
    p.applyBuildingType(planDraft(res.plan, origin));
  }, {
    // W3-BL: mit Block-Regeln gleich im ersten Durchgang einrichten (wie building_generate mit blockRules)
    settings: rules === undefined ? style : { ...style, blockRules: rules },
    ...(around !== undefined ? { surroundings: around } : {}),
  });
  return { session: { ...s, past: [] }, plan: res.plan, notes: res.notes };
}

// ---------------------------------------------------------------------------------------------- Im Editor (Panel „Bautyp“)

/** Bautyp, aus dem das Projekt stammt (`undefined`: keiner oder nicht im Katalog). */
export function originType(s: Session, types: BuildingTypeCatalog): BuildingTypeDef | undefined {
  const id = s.project.state.origin?.buildingTypeId;
  return id === undefined || !types.ids().includes(id) ? undefined : types.get(id);
}

/**
 * Aktuelle Parameter des Projekts (aus `origin`), ergänzt um Theme und Außen-/Gelände-Zustand der Sitzung. Etagen, Lage
 * und Stil-Vorgaben kommen – falls gespeichert – aus den ANGEFORDERTEN Parametern (`requested`, W2-ED U1), damit
 * „unverändert anwenden“ denselben Grundriss plant; ältere Projekte nutzen die aufgelöste Etagenzahl wie bisher.
 */
export function originParams(s: Session, def: BuildingTypeDef): TypeParams {
  const o = (s.project.state.origin?.params ?? {}) as {
    size?: BuildingSizeClass; front?: HorizontalDir; floors?: number; requested?: RequestedPlanParams; underground?: unknown; functionLevel?: unknown; silhouette?: unknown;
  };
  const floors = o.requested !== undefined ? o.requested.floors : o.floors;
  return {
    ...(o.size !== undefined ? { size: o.size } : {}),
    front: o.front ?? 'south',
    ...(floors !== undefined && floorChoices(def, o.size).includes(floors) ? { floors } : {}),
    ...(o.requested?.setting !== undefined ? { setting: o.requested.setting } : {}),
    ...(o.requested?.shell !== undefined ? { shell: o.requested.shell } : {}),
    themeId: s.project.state.themeId,
    ...(s.project.state.paletteId !== undefined ? { paletteId: s.project.state.paletteId } : {}),
    ...(s.project.state.paletteOverrides !== undefined ? { paletteOverrides: s.project.state.paletteOverrides } : {}),
    exterior: shellStyle(s).exterior.enabled,
    site: s.surroundings?.site !== undefined,
    // Unterbau: wie gebaut (Herkunft), sonst der Standard des Bautyps
    underground: o.underground === undefined ? undergroundDefault(def.id) : o.underground !== false,
    // Funktionsgrad: wie gebaut (Herkunft); ältere Projekte ohne das Feld = off
    ...((FUNCTION_LEVELS as readonly unknown[]).includes(o.functionLevel) && o.functionLevel !== 'off' ? { functionLevel: o.functionLevel as FunctionLevel } : {}),
    // Silhouette: wie gebaut (Herkunft); ältere Projekte ohne das Feld = off
    ...((SILHOUETTE_MODES as readonly unknown[]).includes(o.silhouette) && o.silhouette !== 'off' ? { silhouette: o.silhouette as SilhouetteMode } : {}),
    // Geländeform: steht in der Umgebung der Sitzung (nicht im Plan)
    ...(s.surroundings?.landform !== undefined && s.surroundings.landform !== 'flat' ? { landform: s.surroundings.landform } : {}),
  };
}

/**
 * Umfang eines Bautyp-Neubaus in Nutzersprache (W2-ED U1): Rückfrage vorher, ehrliche Statuszeile nachher.
 * `replaced` Bautyp-Räume werden ersetzt; eigene Räume und Räume mit gesperrten Möbeln bleiben.
 */
export function typeScope(s: Session): BuildingTypeScope {
  return buildingTypeScope(s.project.state);
}

const rooms = (n: number): string => `${n} ${n === 1 ? 'Raum' : 'Räume'}`;

/** Rückfrage vor „Grundriss neu würfeln“ bzw. „Bautyp anpassen“; `undefined` = nichts würde ersetzt. */
export function typeReplaceConfirm(s: Session, what: string): { readonly title: string; readonly body: string } | undefined {
  const sc = typeScope(s);
  if (sc.replaced.length === 0) return undefined;
  const kept = [
    ...(sc.user.length > 0 ? [`${rooms(sc.user.length)}, die du gemalt oder geändert hast`] : []),
    ...(sc.pinned.length > 0 ? [`${rooms(sc.pinned.length)} mit gesperrten Möbeln`] : []),
  ];
  return {
    title: `${what}?`,
    body: `Ersetzt ${rooms(sc.replaced.length)} des Bautyps samt Einrichtung.${kept.length > 0 ? ` Bleiben: ${kept.join(' und ')}${sc.lockedPlacements > 0 ? ` (${sc.lockedPlacements} gesperrte Möbel)` : ''}.` : ''} Rückgängig holt alles zurück.`,
  };
}

/** Statuszeile nach einem Bautyp-Neubau: was ersetzt wurde und was blieb (Vergleich vorher/nachher). */
export function typeReplaceStatus(before: Session, after: Session, what: string): string {
  const sc = typeScope(before);
  const ids = new Set(before.project.state.rooms.map((r) => r.id));
  const added = after.project.state.rooms.filter((r) => !ids.has(r.id)).length;
  const keptIds = new Set([...sc.user, ...sc.pinned]);
  const kept = after.project.state.rooms.filter((r) => keptIds.has(r.id)).length;
  const locked = after.project.state.placements.filter((p) => p.locked).length;
  if (sc.replaced.length === 0 && added === 0) return `${what}: Grundriss unverändert`;
  return `${what}: ${rooms(sc.replaced.length)} ersetzt, ${added} neu · ${kept} ${kept === 1 ? 'blieb' : 'blieben'}${locked > 0 ? ` · ${locked} gesperrte Möbel erhalten` : ''}`;
}

/** Zahl der Räume aus dem Bautyp bzw. vom Nutzer (gemalt oder verändert). */
export function roomOrigins(s: Session): { readonly type: number; readonly user: number } {
  const type = s.project.state.rooms.filter((r) => r.origin === 'type').length;
  return { type, user: s.project.state.rooms.length - type };
}

/**
 * „Grundriss neu würfeln“ (`rerollBuildingType`): anderer Grundriss mit gleichen Parametern und gleichem Seed; Räume,
 * die der Nutzer gemalt oder verändert hat, bleiben. Ein Undo-Schritt; betroffene Räume werden neu eingerichtet.
 */
export function rerollType(s: Session, def: BuildingTypeDef, ctx: TypeContext): Session {
  return act(s, ctx.catalog, (p) => rerollBuildingType(p, def, pipelineOf(ctx)));
}

/** Parameter, die den Grundriss bestimmen (Größe, Front, Etagen, Lage, Stil-Vorgaben) – Theme/Außen gehören nicht dazu. */
const planKey = (def: BuildingTypeDef, p: TypeParams): string =>
  JSON.stringify([p.size ?? null, p.front, p.floors ?? null, p.setting ?? null, p.shell ?? null, p.underground ?? undergroundDefault(def.id), ...(p.functionLevel !== undefined && p.functionLevel !== 'off' ? [p.functionLevel] : []), ...(p.silhouette === 'varied' ? ['silhouette'] : [])]);

/** Ändern die Parameter den Grundriss (dann wird neu geplant und – mit Rückfrage – ersetzt)? */
export function replansLayout(s: Session, def: BuildingTypeDef, params: TypeParams): boolean {
  return planKey(def, params) !== planKey(def, originParams(s, def));
}

/**
 * Parameter ändern (Größe, Front, Etagen, Theme): neuer Plan mit dem Projekt-Seed und dem bisherigen Würfel-Zähler,
 * übernommen wie beim Assistenten (Nutzer-Räume und Räume mit gesperrten Möbeln bleiben). Theme und Plan sind EIN
 * Undo-Schritt; die Umgebung bleibt. Bleiben die Grundriss-Parameter gleich (nur Theme, Palette, Außenanlagen), wird
 * NICHT neu geplant – vorher warf schon ein Theme-Wechsel hier alle Räume weg (W2UX §2.3).
 */
export function changeTypeParams(s: Session, def: BuildingTypeDef, params: TypeParams, ctx: TypeContext): Session {
  const o = s.project.state.origin;
  if (o === undefined || o.buildingTypeId !== def.id) throw new Error(`Projekt stammt nicht aus Bautyp ${def.id}`);
  const replan = replansLayout(s, def, params);
  const bp = buildingParams(def, params);
  const plan = replan ? planBuilding(def, { ...bp, reroll: o.rerollCount }, s.project.state.seed, archetypeContext(ctx.catalog, ctx.themes)) : undefined;
  const exterior = shellStyle(s).exterior;
  return act(
    s,
    ctx.catalog,
    (p) => {
      if (p.state.themeId !== params.themeId) p.setTheme(params.themeId);
      if (p.state.paletteId !== params.paletteId) p.setPalette(params.paletteId);
      p.setPaletteOverrides(params.paletteOverrides);
      if (plan !== undefined) p.applyBuildingType(planDraft(plan, originOf(def, plan, bp.at, o.rerollCount, params)));
    },
    exterior.enabled === params.exterior ? {} : { settings: { exterior: { ...exterior, enabled: params.exterior } } },
  );
}

/** „Nur Stil anwenden“: Dach, Details, Gauben, Außenprofil, Fenster, Flur-Rollen und Außenanlagen des Bautyps; Räume bleiben. */
export function applyTypeStyle(s: Session, def: BuildingTypeDef, catalog: Catalog): Session {
  const current = shellStyle(s);
  const exterior = def.exterior === undefined && isFixed(def) ? current.exterior.enabled : def.exterior !== false;
  // mit Unterbau im Projekt (Etage ≤ −2) behalten dessen Gänge die Flur-Rolle
  const deep = s.project.state.rooms.some((r) => r.floorIndex <= -2 && r.roomTypeId === UNDERGROUND_CORRIDOR);
  const build = withoutPilastersForTheme(typeBuildOptions(def, deep), boundTypes(catalog)?.themes, s.project.state.themeId);
  return setShellStyle(s, typeStyle(def, build, { exterior }, current), catalog);
}
