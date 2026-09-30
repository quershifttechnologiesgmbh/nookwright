/**
 * Stimmung (feat/theme-moods): **eine** Regel für App und Engine, welche Stimmung ein Projekt hat und wie sie in die
 * Kontexte fließt (Einrichtung, Außen-Deko, Materialisierung). Details der Achsen: `@mcda/core` `mood.ts`.
 *
 * Schalter: `ProjectState.mood`. Fehlt das Feld (und ist `MOODS_DEFAULT_ON` aus), gibt es keine Stimmung und jede
 * Ausgabe ist bitgleich zu vorher. Mit dem Feld gilt die Theme-Vorgabe (`ThemeDef.mood`), achsenweise vom Nutzer
 * überschrieben. Eine neutrale Stimmung (alle Achsen 0) ist gleichbedeutend mit „keine“ – auch dann bitgleich.
 */
import type { ProjectState, StoryState } from '@mcda/blueprint';
import type { ThemeMood } from '@mcda/catalog';
import { isNeutralMood, mergeMood, moodAxis, moodLever, type MoodVector } from '@mcda/core';
import { moodStoryProfile, type StoryProfile } from '@mcda/materialize';

/**
 * Standard, wenn das Projekt kein `mood`-Feld hat: aus = bitgleich zu vorher. Mit `true` gilt die Vorgabe des Themes
 * auch ohne Feld (Themes ohne Vorgabe bleiben dann weiter bitgleich).
 */
export const MOODS_DEFAULT_ON: boolean = false;

/**
 * Standard an **nur für neue Projekte** (Review F_theme_moods B4): Beim Anlegen (Bautyp, leeres Projekt, `rooms_generate`,
 * App „Neu“) bekommt das Projekt `mood: {}` = Vorgabe des Themes. Gespeicherte Projekte ohne Feld laden bitgleich wie
 * bisher. `undefined` hier = neue Projekte ohne Stimmung (Stand vor dem Umschalten).
 */
export const NEW_PROJECT_MOOD: MoodVector | undefined = {};

/** Stimmung eines neu angelegten Projekts setzen (App und Engine gleich); ausdrückliche Angabe hat Vorrang. */
export function applyNewProjectMood(project: { setMood(m: MoodVector | undefined): unknown }, explicit?: MoodVector): void {
  const mood = explicit ?? NEW_PROJECT_MOOD;
  if (mood !== undefined) project.setMood(mood);
}

/** Wirksame Stimmung aus Projektzustand und Theme-Vorgabe; `undefined` = keine (bitgleicher Pfad). */
export function effectiveMood(
  state: Pick<ProjectState, 'mood'>, theme: { readonly mood?: ThemeMood } | undefined, defaultOn: boolean = MOODS_DEFAULT_ON,
): MoodVector | undefined {
  if (state.mood === undefined && !defaultOn) return undefined;
  const m = mergeMood(theme?.mood, state.mood);
  return isNeutralMood(m) ? undefined : m;
}

/** Stärke der Außen-Deko-Dichte (`ExteriorStyle.density`) je Einheit `richness`: üppig ×1,52, karg ×0,66. */
const K_EXTERIOR = 0.6;

/** Außen-Deko-Dichte mit Stimmung (0–2 wie `ExteriorStyle.density`); ohne Stimmung die Eingabe unverändert. */
export function moodExteriorDensity(density: number | undefined, mood: MoodVector | undefined): number | undefined {
  if (mood === undefined || moodAxis(mood, 'richness') === 0) return density;
  return Math.max(0, Math.min(2, (density ?? 1) * moodLever(moodAxis(mood, 'richness'), K_EXTERIOR)));
}

/**
 * Story-Profil für die Materialisierung: nur, wenn die Stimmung eine Achse `wear` ≠ 0 hat (sonst `undefined` und es
 * gilt wie bisher `storyState` bzw. die Theme-Verwitterung).
 */
export function moodStory(storyState: StoryState | undefined, mood: MoodVector | undefined): StoryProfile | undefined {
  const wear = moodAxis(mood, 'wear');
  return wear === 0 ? undefined : moodStoryProfile(storyState, wear);
}
