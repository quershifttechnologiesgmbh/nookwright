/**
 * Vokabular der Engine-API: alle Labels, die ein Nutzer oder ein Modell wählen kann.
 *
 * - **Statisch** (Domänen-Unions): per `enumOf<T>()` erschöpfend – neuer Wert in der Domäne = Typfehler hier.
 * - **Dynamisch** (Katalog): Bautypen, Themes, Raumtypen kommen aus dem Kontext; jede neue Katalogdatei ist ohne
 *   Code-Änderung in der API (und im eingecheckten Schema, siehe `schema/engine.schema.json`).
 */
import type { FacadeRhythm, InteriorDecor, RoofStyle, SettingKind, StairTurn, StairType, StoryState } from '@mcda/blueprint';
import type { SilhouetteMode } from '@mcda/archetype';
import type { BuildingSizeClass, FunctionLevel } from '@mcda/catalog';
import type { HorizontalDir } from '@mcda/core';
import type { ExportFormat } from '@mcda/export';
import type { SurfaceTextureSwitch, WeatheringSwitch } from '@mcda/pipeline';
import type { Landform, SiteTemplateId } from '@mcda/terrain';
import { enumOf, type EngineContext } from './operation.js';

/** Deutsche Anzeigenamen der Stimmungen (research/54 §1.4) für die Beschreibung im Vokabular. */
const PALETTE_MOOD_LABELS: Readonly<Record<string, string>> = {
  gemuetlich: 'gemütlich', duester: 'düster', festlich: 'festlich', verfallen: 'verfallen', winterlich: 'winterlich', magisch: 'magisch',
};

export const ROOF_STYLES = enumOf<RoofStyle>()(['flat', 'hip', 'gable', 'shed', 'half_hip', 'dutch_gable', 'mansard', 'gambrel', 'saltbox']);
export const SETTING_KINDS = enumOf<SettingKind>()(['ground', 'buried', 'cliff', 'carved', 'stilts', 'tree', 'water', 'underwater']);
export const SIZE_CLASSES = enumOf<BuildingSizeClass>()(['S', 'M', 'L']);
/** Funktionsgrad (W2-1): off = wie bisher, some = 1–2 passende Funktionsräume, rich = mehr und größere Anlagen. */
export const FUNCTION_LEVELS = enumOf<FunctionLevel>()(['off', 'some', 'rich']);
/** Geländeform (feat/gelaende): flat = wie bisher, natural = sanfter Hang, dramatic = hoher Hang mit Terrassen. */
export const LANDFORMS = enumOf<Landform>()(['flat', 'natural', 'dramatic']);
/** Silhouette (WS Schritt 2): off = wie bisher, varied = Anbau mit eigener Dachhöhe und ungeraden Maßen. */
export const SILHOUETTES = enumOf<SilhouetteMode>()(['off', 'varied']);
/** Erzählende Verwitterung (WS-Verwitterung): off = wie bisher, some = wenige Cluster, rich = dichter. */
export const WEATHERING_IDS = enumOf<WeatheringSwitch>()(['off', 'some', 'rich']);
/** TX-B: Oberflächen-Textur (Blockmischung, Verläufe, Musterbruch) – `off` = kein Pass. */
export const SURFACE_TEXTURE_IDS = enumOf<SurfaceTextureSwitch>()(['off', 'subtle', 'rich']);
/** Fassadenrhythmus (WS-Fassade): off = wie bisher, on = Fensterachsen im Takt und Gauben auf leeren Dachflächen. */
export const FACADE_RHYTHMS = enumOf<FacadeRhythm>()(['off', 'on']);
export const DIRECTIONS = enumOf<HorizontalDir>()(['north', 'east', 'south', 'west']);
export const EXPORT_FORMATS = enumOf<ExportFormat>()(['litematic', 'schem', 'nbt']);
export const STAIR_TYPES = enumOf<StairType>()(['straight', 'l', 'u', 'spiral', 'ladder']);
export const STAIR_TURNS = enumOf<StairTurn>()(['left', 'right']);
export const SITE_TEMPLATE_IDS = enumOf<SiteTemplateId>()(['homestead']);
/**
 * Nutzungszustände (Q5/P15, research/55 §3): `neu` = kaum Spuren, `bewohnt` = Grundzustand,
 * `verlassen` = still/ungepflegt, `verfallen` = Ruine, `belagert` = angespannt (Risse statt Bewuchs).
 */
export const STORY_STATES = enumOf<StoryState>()(['neu', 'bewohnt', 'verlassen', 'verfallen', 'belagert']);
/** Innen-Deko-Stufen (feat/int-decor): `etwas` = `some`, `reich` = `rich`. */
export const INTERIOR_DECORS = enumOf<InteriorDecor>()(['some', 'rich']);
/** Zielversionen (Schlüssel von `TARGET_VERSIONS` in @mcda/blueprint; Abgleich im Test `vocabulary.test.ts`). */
export const VERSIONS = ['1.21.11', '26.3'] as const;

export interface Label {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface BuildingTypeLabel extends Label {
  readonly family: string;
  readonly sizes: readonly BuildingSizeClass[];
  readonly themes: readonly string[];
  readonly draft: boolean;
}

export interface Vocabulary {
  readonly buildingTypes: readonly BuildingTypeLabel[];
  readonly themes: readonly Label[];
  /** Farbpaletten (Q4, `catalog/palettes`). */
  readonly palettes: readonly Label[];
  readonly roomTypes: readonly Label[];
  /** Geländestile (`catalog/terrain`). */
  readonly terrainStyles: readonly Label[];
}

/** Vokabular aus dem Kontext; sortiert, damit Schema und Tool-Definitionen stabil (diff-bar) sind. */
export function vocabularyOf(ctx: EngineContext): Vocabulary {
  const buildingTypes = ctx.buildingTypes.ids().map((id): BuildingTypeLabel => {
    const d = ctx.buildingTypes.get(id);
    return {
      id,
      name: d.label ?? d.name,
      ...(d.description !== undefined ? { description: d.description } : {}),
      family: d.family,
      sizes: SIZE_CLASSES.filter((s) => d.sizes?.[s] !== undefined),
      themes: d.themes ?? [],
      draft: d.status === 'draft',
    };
  });
  const themes = ctx.themes.ids().sort().map((id): Label => {
    const d = ctx.themes.def(id);
    return { id, name: d?.name ?? id, ...(d?.description !== undefined ? { description: d.description } : {}) };
  });
  const palettes = [...(ctx.palettes ?? [])]
    .map((p): Label => {
      const mood = PALETTE_MOOD_LABELS[p.mood] ?? p.mood;
      const styles = p.styles.join(', ');
      return { id: p.id, name: p.name, description: `Stimmung: ${mood}; Stile: ${styles}; Biome: ${p.biomes.join(', ')}` };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const roomTypes = ctx.catalog.roomTypeIds().sort().map((id): Label => {
    const rt = ctx.catalog.roomType(id);
    // Kennzeichen des Raums = Tags der Signatur-Pflichtteile (z. B. Kerker: prison cell) – beschreibt den Raumtyp für
    // Entscheidungsmodelle automatisch aus dem Katalog, ohne eigene Pflegeliste
    const marks = [...new Set(rt.required.filter((e) => e.signature === true).flatMap((e) => e.tags))].map((t) => t.replaceAll('_', ' '));
    return { id, name: rt.name, ...(marks.length > 0 ? { description: `Kennzeichen: ${marks.join(', ')}` } : {}) };
  });
  const terrainStyles = [...(ctx.terrainStyles?.values() ?? [])]
    .map((t): Label => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { buildingTypes, themes, palettes, roomTypes, terrainStyles };
}

/** IDs als nicht-leeres Tupel für `z.enum` (leerer Katalog: Platzhalter, der nie gültig ist). */
export const idsOf = (labels: readonly Label[]): [string, ...string[]] => {
  const ids = labels.map((l) => l.id);
  return ids.length > 0 ? (ids as [string, ...string[]]) : ['__none__'];
};
