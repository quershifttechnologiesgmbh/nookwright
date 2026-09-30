/**
 * Generier-Regeln, die App und Engine-API gleich anwenden (vorher nur in der App): Wandvorlagen bei Fachwerk-Themes,
 * die harte Export-Obergrenze und keine Treppe durch gesperrte oder von Hand gesetzte Möbel. Eine Stelle, damit beide Wege dasselbe Ergebnis liefern
 * (Test: `packages/app/test/engineParity.test.ts`). Dazu (W1-G): welche Lagen die Domäne baut und woran zwei
 * Vorschläge als gleicher Grundriss gelten.
 */
import type { ArchetypeContext, BuildingPlan } from '@mcda/archetype';
import { TARGET_VERSIONS, checkLink, type FacadeRhythm, type FacadeStyle, type ProjectState, type SettingKind, type VerticalLink } from '@mcda/blueprint';
import { themeFacadeBay, type Catalog, type ResolvedTheme, type SurfaceRule, type ThemeCatalog } from '@mcda/catalog';
import type { Vec3 } from '@mcda/core';
import { expandComponent, placeComponent, requiredWithoutPose } from '@mcda/furnishing';
import type { SiteDecorHint } from '@mcda/terrain';
import { SITE_DECOR_HINTS } from '@mcda/terrain';
import type { BaseOptions } from './base.js';
import { furnishingGeometry } from './geometry.js';

/**
 * Wandvorlagen aus den Bau-Optionen, wenn das Theme selbst Fachwerk hat (F1): Ständer, Riegel und Streben sitzen dann
 * schon in der Wand, ein Stamm davor verdeckt Gefach und Motiv (Review-Befund 3, bis dahin F1-Bericht „Offene Punkte").
 * Geprüft wird die Theme-Kette (`medieval` → `timber`). Gilt für Stil aus einem Bautyp; eine ausdrückliche Wahl des
 * Nutzers (App-Panel, `project_style`, `rooms_generate`) bleibt unberührt.
 */
export function withoutPilastersForTheme<T extends BaseOptions>(build: T, themes: ThemeCatalog | undefined, themeId: string | undefined): T {
  const facade = build.facade;
  if (themes === undefined || themeId === undefined || facade === undefined) return build;
  // Die Regel greift, sobald Wandvorlagen im Spiel sind – ausdrücklich (`pilasters`) oder über die Q2-Pflicht (`pierFrom`).
  if (facade.pilasters === undefined && facade.rules?.pierFrom === undefined) return build;
  const theme = themes.ids().includes(themeId) ? themes.get(themeId) : undefined;
  // W13-E: Fachwerk-Regeln nur für das Wandkleid der Obergeschosse (`when.upperFrame`) zählen nur mit `facade.upperFrame`
  // – sonst hätte jedes Theme auf medieval-Basis (Burg, Wachturm) seine Wandvorlagen verloren. Geprüft werden die
  // aufgelösten Wandregeln des Themes selbst (sie ersetzen die der Basis ganz): Sandstein und Tuff erben das Fachwerk von
  // medieval nicht. Vorher über die Kette – gleichwertig, solange nur das Blatt-Theme `timber` Fachwerk hatte.
  const frames = (r: SurfaceRule): boolean =>
    r.timber !== undefined && (r.when?.upperFrame === undefined || r.when.upperFrame === (facade.upperFrame === true));
  const timber = theme !== undefined && theme.surfaces.wall?.some(frames) === true;
  if (!timber) return build;
  // Q2: die Pflichtregel `pierFrom` würde die Vorlagen sonst wieder erzwingen und das Fachwerk verdecken – sie
  // entfällt hier zusammen mit `pilasters`. Alle anderen Pflichtregeln bleiben.
  const { pierFrom: _pierFrom, ...rules } = facade.rules ?? {};
  return { ...build, facade: { ...facade, pilasters: 0, ...(facade.rules !== undefined ? { rules } : {}) } };
}

/**
 * Fassaden-Standard (W2, Baustandard F1): die Feldbreite des Fassadenrasters kommt aus dem Theme (`facade.bay`:
 * Stein 3, Fachwerk 4, nordisch 5), solange die Regeln das Raster verlangen und selbst keine Breite nennen. Eine
 * Stelle für App und Engine (beide über `shellFor` mit Theme); ohne Raster oder Theme-Vorgabe unverändert.
 */
export function facadeForTheme(facade: FacadeStyle | undefined, theme: ResolvedTheme | undefined): FacadeStyle | undefined {
  const rules = facade?.rules;
  if (theme === undefined || rules?.grid !== true || rules.bay !== undefined) return facade;
  const bay = themeFacadeBay(theme);
  return bay === undefined ? facade : { ...facade, rules: { ...rules, bay } };
}

/**
 * WS-Fassade (Bauprozess Schritt 4): Schalter `facadeRhythm` → Hüllen-Option. `'on'` schaltet Fensterachsen im Takt und
 * Gauben auf leeren Dachflächen ein; fehlt der Schalter oder ist er `'off'`, bleibt `build` dasselbe Objekt (bitgleich).
 * Eine Stelle für App und Engine.
 */
export function withFacadeRhythm<T extends BaseOptions>(build: T, mode: FacadeRhythm | undefined): T {
  return mode === 'on' ? { ...build, facadeRhythm: { windows: true, dormers: true } } : build;
}

/** Mindestfläche je Raumtyp aus dem Katalog (unbekannt: 4). */
export const catalogMinArea = (catalog: Catalog) => (id: string): number => (catalog.roomTypeIds().includes(id) ? catalog.roomType(id).minArea : 4);

/**
 * W6 (27.09.2026): Katalog-Sicht des Grundriss-Planers für App und Engine – Mindestflächen und die Feldbreite des
 * Fassadenrasters je Theme (`facade.bay`, dieselbe Quelle wie `facadeForTheme`). Mit den Themes legt der Planer
 * Trennwände auf die Rasterpfosten; ohne Themes plant er ohne Rasterbezug. Eine Stelle, damit Vorschlag (App-Assistent,
 * `building_propose`), Neu-Würfeln und Übernehmen denselben Grundriss liefern.
 */
export function archetypeContext(catalog: Catalog, themes: ThemeCatalog | undefined): ArchetypeContext {
  const furnishable = catalogFurnishable(catalog);
  if (themes === undefined) return { minArea: catalogMinArea(catalog), furnishable };
  return {
    minArea: catalogMinArea(catalog),
    facadeBay: (themeId) => (themes.ids().includes(themeId) ? themeFacadeBay(themes.get(themeId)) : undefined),
    furnishable,
  };
}

/**
 * W8-E (27.09.2026): „Hat jedes Pflichtobjekt des Raumtyps im leeren Raum Platz?“ für den Grundriss-Planer – dieselben
 * harten Regeln wie die Einrichtung (`requiredWithoutPose`, lockerste Stufe). Ein Raum, der nur Durchgang ist (Ring um
 * das Treppenloch, Durchgangszimmer zwischen zwei Türen), bekommt so einen anderen Versuch statt eines Schlafzimmers
 * ohne Bett. Geprüft mit der Datenversion 1.21.11 (wie die Probe-Hülle des Planers).
 */
export const catalogFurnishable = (catalog: Catalog) => (roomTypeId: string, info: Parameters<typeof furnishingGeometry>[0]): readonly string[] =>
  catalog.roomTypeIds().includes(roomTypeId)
    ? requiredWithoutPose(furnishingGeometry(info), catalog.roomType(roomTypeId), catalog, { dataVersion: TARGET_VERSIONS['1.21.11'].dataVersion })
    : [];

/**
 * Harte Obergrenze für ein **Export-Volumen** – unabhängig davon, was in einer Projektdatei oder Anfrage stand
 * (Review 3). Weit auseinander liegende Räume können die Hülle aufspannen: ±4 096 Koordinaten ergeben 8 000 je Achse.
 */
export const EXPORT_LIMITS = { maxAxis: 2048, maxCells: 32_000_000 } as const;

/** Ist das Volumen zu groß für einen Export? Klartext oder `undefined`. */
export function volumeTooLarge(size: Vec3): string | undefined {
  const [x, y, z] = size;
  const cells = x * y * z;
  const gross = (n: number): boolean => !Number.isFinite(n) || n > EXPORT_LIMITS.maxAxis;
  if (gross(x) || gross(y) || gross(z)) {
    return `Der Bau ist mit ${x} × ${y} × ${z} Blöcken zu groß für einen Export (je Achse höchstens ${EXPORT_LIMITS.maxAxis}) – Räume näher zusammenlegen`;
  }
  if (cells > EXPORT_LIMITS.maxCells) {
    return `Der Export hätte ${cells.toLocaleString('de-DE')} Zellen (erlaubt sind ${EXPORT_LIMITS.maxCells.toLocaleString('de-DE')}) – Räume näher zusammenlegen oder das Projekt teilen`;
  }
  return undefined;
}

/**
 * Treppe über gesperrten oder von Hand gesetzten Möbeln? Klartext oder `undefined`. Die Domäne räumt beim Setzen einer
 * Treppe die Möbel in ihren Zellen ab; gesperrte und von Hand gesetzte sollen dabei nicht still verschwinden. Eine
 * Treppe, die die Domäne ohnehin ablehnt, meldet die Domäne selbst (hier `undefined`).
 */
export function fixedFurnitureInStairs(state: ProjectState, catalog: Catalog, link: VerticalLink): string | undefined {
  const res = checkLink(state, link);
  if (typeof res === 'string') return undefined;
  for (const [room, cells] of [[res.lower, res.lowerCells], [res.upper, res.upperCells]] as const) {
    for (const placement of state.placements) {
      if (placement.roomId !== room.id || (!placement.locked && placement.origin !== 'manual')) continue;
      const def = catalog.find(placement.componentId);
      if (def === undefined) continue;
      const placed = placeComponent(expandComponent(def, placement.variantId), placement.pose);
      if (placed.cells.some((c) => cells.has(c.pos[0], c.pos[2]))) {
        return `Treppe überschneidet ${placement.locked ? 'das gesperrte' : 'das von Hand gesetzte'} Möbel „${def.name ?? def.id}“ in Raum ${room.id} – erst entsperren oder entfernen`;
      }
    }
  }
  return undefined;
}

/**
 * Lagen, die die Domäne heute wirklich baut (W1-G, Befund S1b): `ground` (ebenerdig) und `buried` (Erdhügel,
 * `deriveShell` + Gelände). `cliff`, `carved`, `stilts`, `tree`, `water` und `underwater` stehen im Vertrag und im
 * Vokabular, werden aber noch ebenerdig gebaut. Wer eine Beschreibung übersetzt (App-Assistent, KI-Architekt,
 * Klassifikator), meldet sie deshalb als „noch nicht baubar“ statt als übernommen.
 */
export const BUILDABLE_SETTINGS: ReadonlySet<SettingKind> = new Set<SettingKind>(['ground', 'buried']);

/** Baut die Domäne diese Lage? Unbekannte Werte: nein. */
export const settingBuildable = (kind: string): boolean => BUILDABLE_SETTINGS.has(kind as SettingKind);

/**
 * Grundriss-Schlüssel eines Plans (W1-G, Befund M2): Räume je Etage mit Raumtyp und Zellen. Gleicher Schlüssel =
 * gleicher Grundriss, auch wenn Seed, Treppenlage oder Außen-Deko abweichen – so sieht es der Nutzer in den Karten.
 */
export function planLayoutKey(plan: Pick<BuildingPlan, 'rooms'>): string {
  return plan.rooms
    .map((r) => `${r.floor}:${r.roomTypeId}:${r.cells.toArray().map(([x, z]) => `${x},${z}`).sort().join(';')}`)
    .sort()
    .join('|');
}

/**
 * Vorschläge ohne Doppel (W1-G, Befund M2): aus Kandidaten in fester Reihenfolge (deterministisch aus dem Basis-Seed)
 * der Reihe nach die ersten `count` mit verschiedenem Grundriss-Schlüssel. `undefined` (Kandidat fehlgeschlagen) zählt
 * als eigener Eintrag. Ist die Reserve erschöpft (`exhausted`), füllen die übersprungenen Doppel in Reihenfolge auf –
 * lieber zwei gleiche zeigen und benennen als eine Karte zu wenig. Liefert die Indizes der gezeigten Kandidaten.
 */
export function distinctPicks(keys: readonly (string | undefined)[], count: number, exhausted = true): number[] {
  const seen = new Set<string>();
  const picked: number[] = [];
  const skipped: number[] = [];
  keys.forEach((k, i) => {
    if (picked.length >= count) return;
    if (k !== undefined && seen.has(k)) {
      skipped.push(i);
      return;
    }
    if (k !== undefined) seen.add(k);
    picked.push(i);
  });
  if (exhausted) for (const i of skipped) if (picked.length < count) picked.push(i);
  return picked.sort((a, b) => a - b);
}

/** Zahl verschiedener Grundrisse unter den Kandidaten (`undefined` zählt einzeln). */
export function distinctCount(keys: readonly (string | undefined)[]): number {
  return new Set(keys.map((k, i) => k ?? `\u0000${i}`)).size;
}

/**
 * Hinweise der Grundstücks-Deko aus dem Raumprogramm (feat/site-decor): welche funktionalen Außenbereiche ans Haus
 * andocken. Rein nach Raumtyp-ID (ohne Abhängigkeit vom Funktionsgrad): Imkerei → Bienenhof, Stall/Hühnerhaus/Scheune →
 * Pferch, Kapelle → Gräber, Handelsraum/Schenke/Bäckerei → Marktstand, Werkstatt/Schmiede/Zimmerei → Holzplatz,
 * Kräuter-/Gewächshaus → Beete. `fish` kommt vom Hafen-Theme. App und Engine rufen dieselbe Regel (Test: engineParity).
 */
const SITE_DECOR_HINT_OF: Readonly<Record<string, SiteDecorHint>> = {
  apiary: 'bees',
  stable: 'animals', chicken_house: 'animals', barn_farm: 'animals', farm_room: 'animals',
  chapel: 'graves',
  trading_hall: 'market', tavern: 'market', bakery: 'market', bakery_line: 'market', butchery: 'market',
  carpentry: 'wood', smithy: 'wood', artisan_workshop: 'wood', workshop_redstone: 'wood',
  herb_garden: 'garden', greenhouse: 'garden', crop_hall: 'garden',
};

export function siteDecorContext(state: Pick<ProjectState, 'rooms' | 'themeId'>): { readonly themeId?: string; readonly hints: readonly SiteDecorHint[] } {
  const hints = new Set<SiteDecorHint>();
  for (const r of state.rooms) {
    const h = SITE_DECOR_HINT_OF[r.roomTypeId];
    if (h !== undefined) hints.add(h);
  }
  if (state.themeId === 'harbor') hints.add('fish');
  return { ...(state.themeId !== undefined ? { themeId: state.themeId } : {}), hints: SITE_DECOR_HINTS.filter((h) => hints.has(h)) };
}
