/**
 * Silhouette (WS „7 Schritte“, Schritt 2 „Grundform und Silhouette“; Bericht plan/spikes/WS_silhouette.md).
 *
 * Schalter `silhouette` (`off` | `varied`, Standard `off` = bitgleich wie ohne). Kernregel des Tutorials: jede Teilform hat
 * eine andere Dachhöhe, die Wandlängen sind ungerade, eine glatte Fläche bricht ein Vor- oder Anbau auf.
 *
 * Umsetzung als Regel über der Massing-Grammatik (kein neuer Generator): Einteilige Bautypen (Taverne, Langhaus,
 * Wachturm), die im Katalog keinen Anbau haben, bekommen einen niedrigen Anbau als Ensemble-Teil (`parts`, derselbe
 * Weg wie der Anbau des Bauernhauses): eigener Baukörper, eigene lichte Höhe 3 (also tiefere Traufe und tieferer First),
 * eigene Dachform (im Wechsel Satteldach und Krüppelwalm, je Seed), ungerade Maße (`odd` im Planer), Anker an einer
 * Seitenwand hinten – die Front bleibt frei. Bautypen, die schon aus mehreren Baukörpern bestehen (Bauernhaus mit
 * Scheune und Anbau, Burg mit Bergfried), bleiben unverändert. Der Anbau ist ein normales Raumprogramm-Element mit
 * Pflichtraum: Erreichbarkeit, Licht, Dachbau und Stützregeln prüft derselbe Planer wie bei jedem Teil.
 *
 * Rein und deterministisch: die Dachform kommt aus einem Hash-Seed, den sonst nichts zieht.
 */
import type { BuildingPartDef, BuildingProgramEntry, BuildingSizeClass, BuildingTypeDef } from '@mcda/catalog';
import { hashSeed } from '@mcda/core';

export const SILHOUETTE_MODES = ['off', 'varied'] as const;
export type SilhouetteMode = (typeof SILHOUETTE_MODES)[number];
/** Standard: aus (bitgleich zum Stand vor dem Schalter). */
export const SILHOUETTE_DEFAULT: SilhouetteMode = 'off';

/** Id des zusätzlichen Teils im umgeschriebenen Bautyp. */
export const SILHOUETTE_PART = 'silhouette_annex';

interface AnnexRule {
  /** Größenklassen, in denen der Anbau vorkommt (S ist für einen zweiten Baukörper zu klein). */
  readonly sizes: readonly BuildingSizeClass[];
  readonly part: BuildingPartDef;
  readonly entry: BuildingProgramEntry;
  /** Dachformen im Wechsel je Seed (Satteldach neben Krüppelwalm mischt die Firstlinien). */
  readonly roofs: readonly string[];
}

const LEFT_RIGHT = ['left', 'right'] as const;

/**
 * Anbau je Bautyp. Maße ungerade (der Planer rundet ohnehin auf ungerade), lichte Höhe 3, eine Etage: First und Traufe
 * liegen dadurch immer deutlich unter dem Hauptbaukörper (Taverne 2–3 Etagen à 4/3, Langhaus 4, Turm 3–5 Etagen).
 */
const ANNEXES: Readonly<Record<string, AnnexRule>> = {
  tavern: {
    sizes: ['M', 'L'],
    part: { name: 'Brauhaus', massing: 'rect', footprint: [[5, 7], [7, 9]], floors: 1, floorHeight: 3, anchor: { side: [...LEFT_RIGHT], align: 'start', gap: 0 }, roof: 'gable' },
    entry: { room: ['brewhouse', 'storage'], part: SILHOUETTE_PART, minArea: 12, required: true },
    roofs: ['gable', 'half_hip'],
  },
  longhouse: {
    sizes: ['M', 'L'],
    part: { name: 'Vorratshaus', massing: 'rect', footprint: [[5, 5], [7, 7]], floors: 1, floorHeight: 3, anchor: { side: [...LEFT_RIGHT], align: 'start', gap: 0 }, roof: 'gable' },
    entry: { room: ['smithy', 'storage'], part: SILHOUETTE_PART, minArea: 9, required: true },
    roofs: ['gable', 'half_hip'],
  },
  watchtower: {
    sizes: ['M', 'L'],
    part: { name: 'Wachstube', massing: 'rect', footprint: [[5, 5], [5, 5]], floors: 1, floorHeight: 3, anchor: { side: [...LEFT_RIGHT], align: 'center', gap: 0 }, roof: 'gable' },
    entry: { room: ['armory', 'storage'], part: SILHOUETTE_PART, minArea: 9, required: true },
    roofs: ['gable', 'hip'],
  },
};

/** Hat der Bautyp eine Silhouetten-Regel (einteilig, ohne eigenen Anbau)? */
export function supportsSilhouette(def: BuildingTypeDef): boolean {
  return ANNEXES[def.id] !== undefined && def.massing.generator !== 'fixed';
}

/**
 * Bautyp mit zusätzlichem Anbau für `varied`. Gleiche Referenz, wenn nichts zu tun ist (aus, unbekannter Typ, Größe
 * ohne Anbau, Bautyp hat schon Teile) – dann läuft der Planer bitgleich wie zuvor. Das Programm wird am ENDE erweitert
 * (Indizes des Bestands bleiben).
 */
export function withSilhouette(def: BuildingTypeDef, mode: SilhouetteMode | undefined, size: BuildingSizeClass | undefined, seed: number, reroll: number): BuildingTypeDef {
  if (mode !== 'varied' || size === undefined || !supportsSilhouette(def)) return def;
  const rule = ANNEXES[def.id]!;
  const sd = def.sizes?.[size];
  if (sd === undefined || !rule.sizes.includes(size) || (sd.parts ?? []).length > 0 || Object.keys(def.parts ?? {}).length > 0) return def;
  const roof = rule.roofs[hashSeed(seed, def.id, 'silhouette', reroll) % rule.roofs.length]!;
  return {
    ...def,
    sizes: { ...def.sizes, [size]: { ...sd, parts: [SILHOUETTE_PART] } },
    parts: { [SILHOUETTE_PART]: { ...rule.part, roof } },
    program: [...(def.program ?? []), rule.entry],
  };
}
