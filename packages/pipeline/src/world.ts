/**
 * Gemeinsame Bausteine des Anwendungsdienstes (von `index.ts` unverändert re-exportiert):
 * Kontext, Welt, Platzierung → Weltkoordinaten und Projekt → Blöcke.
 */
import type { Placement, Project, Shell, StoryState } from '@mcda/blueprint';
import type { MoodVector, PaletteOverrides } from '@mcda/core';
import { harmonyOf } from './colorHarmony.js';
import { applyPaletteOverrides, type Catalog, type PaletteCatalog, type ResolvedTheme, type ThemeCatalog } from '@mcda/catalog';
import type { ExteriorPlacement } from '@mcda/exterior';
import { expandComponent, placeComponent, type PlacedComponent } from '@mcda/furnishing';
import { materialize, type MaterializeResult, type NarrativeWeatheringLevel, type SurfaceTextureLevel, type PlatformView, type StoryProfile } from '@mcda/materialize';
import type { OutdoorPlacement, TerrainStyleDef } from '@mcda/terrain';
import { interiorLining } from './lining.js';
import { effectiveMood, moodStory } from './mood.js';

export interface PipelineContext {
  readonly catalog: Catalog;
  readonly themes: ThemeCatalog;
  /** Plattform-Daten je Minecraft-Version (z. B. '1.21.11'). */
  readonly platform: (versionName: string) => PlatformView;
  /** Geländestile (catalog/terrain) nach ID; optional, nur für `generateBase` mit Gelände nötig (additiv, I2). */
  readonly terrainStyles?: ReadonlyMap<string, TerrainStyleDef>;
  /**
   * Farbpaletten (catalog/palettes, Q4) nach ID; optional. Fehlt der Katalog oder die gewählte Palette, bleibt das
   * Theme unverändert – ein Projekt ohne Palette ist damit bitgleich zu vorher (Prüfsummen).
   */
  readonly palettes?: PaletteCatalog;
  /**
   * W8-G (2026-09-27): Windrad-Wächter der Materialisierung (Standard an, Projektregel HANDOFF §1). `false` nur für
   * Messungen (Vorher/nachher, Laufzeit) – nie im Produkt.
   */
  readonly pinwheelGuard?: boolean;
  /**
   * WS-Verwitterung (Schalter `weathering`): erzählende Verwitterungs-Cluster der Materialisierung. Setzt `generateWith`
   * aus `BuildOptions.weathering`; fehlt = kein Pass (bitgleich).
   */
  readonly weathering?: NarrativeWeatheringLevel;
  /** Nur Messung (WS-Verwitterung): `rule` ersetzt den WFC-Solver der Verwitterung durch einen regelbasierten Verlauf – nie im Produkt. */
  readonly weatheringSolver?: 'wfc' | 'rule';
  /**
   * TX-B (Schalter `surfaceTexture`): Oberflächen-Textur der Materialisierung (Blockmischung, Verläufe, Musterbruch). Setzt
   * `generateWith` aus `BuildOptions.surfaceTexture`; fehlt = kein Pass (bitgleich).
   */
  readonly surfaceTexture?: SurfaceTextureLevel;
}

/**
 * Theme eines Projekts, mit gewählter Farbpalette (Q4, research/54 §3.3). Ohne `paletteId` oder bei unbekannter
 * Palette liefert die Funktion **dasselbe Objekt** wie `ctx.themes.get(...)` (Referenzgleichheit, keine stille
 * Änderung); sonst das umgefärbte Theme (`applyPalette`) mit unveränderter Bauweise. W13-G: danach die
 * Paletten-Überschreibungen des Projekts (`applyPaletteOverrides`, Familie je Rollengruppe, Familien-Tausch).
 */
export function themeFor(project: Project, ctx: PipelineContext): ResolvedTheme {
  const s = project.state;
  return themeWith(ctx, s.themeId, s.paletteId, s.paletteOverrides);
}

/** feat/theme-moods: wirksame Stimmung des Projekts (Theme-Vorgabe + Nutzer); `undefined` = keine (bitgleich). */
export function moodOf(project: Project, ctx: PipelineContext): MoodVector | undefined {
  return effectiveMood(project.state, themeFor(project, ctx));
}

/** Solver-Option `mood` als Spreizobjekt (leer ohne Stimmung). */
export function moodOption(project: Project, ctx: PipelineContext): { readonly mood?: MoodVector } {
  const mood = moodOf(project, ctx);
  return mood === undefined ? {} : { mood };
}

function storyOption(state: StoryState | undefined, mood: MoodVector | undefined): { readonly storyProfile?: StoryProfile } {
  const p = moodStory(state, mood);
  return p === undefined ? {} : { storyProfile: p };
}

/** Wie `themeFor`, aber für eine Theme-ID ohne Projekt (Stil-Kette, Außenbau der Umgebung). */
export function themeWith(ctx: PipelineContext, themeId: string, paletteId: string | undefined, overrides?: PaletteOverrides): ResolvedTheme {
  const palette = ctx.palettes?.find(paletteId);
  const base = palette === undefined ? ctx.themes.get(themeId) : ctx.themes.resolveWith(themeId, palette);
  // W13-G: Paletten-Überschreibungen des Nutzers zuletzt; ohne sie dasselbe Objekt (bitgleich)
  // WS-Farbe: Farbharmonie zuletzt (nur mit `colorHarmony: 'on'`; sonst dasselbe Objekt wie bisher, bitgleich)
  return harmonyOf(applyPaletteOverrides(base, overrides), overrides);
}

export interface World {
  readonly shell: Shell;
  readonly materialized: MaterializeResult;
  /** Außen-Komponenten (X1), die mit materialisiert wurden (fehlt ohne Außengestaltung). */
  readonly exterior?: readonly ExteriorPlacement[];
}

/** Platzierung aus dem Projekt → Komponente in Weltkoordinaten. */
export function placedFor(p: Placement, catalog: Catalog): PlacedComponent {
  return placeComponent(expandComponent(catalog.get(p.componentId), p.variantId), p.pose);
}

/**
 * Projekt → Blöcke für Theme und Zielversion des Projekts (Hülle vorgegeben; `buildWorld` leitet sie bei Bedarf ab).
 * `exterior` (additiv, X1): Außen-Komponenten ohne Raum, zusammen mit den Raum-Platzierungen materialisiert.
 * `outdoor` (additiv, Q3): Katalog-Objekte des Geländes (`@mcda/terrain`) – ebenfalls Platzierungen ohne Raum.
 */
export function materializeWorld(
  project: Project, ctx: PipelineContext, shell: Shell, exterior: readonly ExteriorPlacement[] = [],
  outdoor: readonly OutdoorPlacement[] = [],
): World {
  const s = project.state;
  const theme = themeFor(project, ctx);
  const rooms = s.placements.map((p) => ({ id: p.id, placed: placedFor(p, ctx.catalog), seed: p.seed, roomId: p.roomId }));
  const materialized = materialize({
    shell,
    // W2 (I1/I4): Innenhaut je Raum aus dem Theme-Rezept, nach allen Möbeln und Lichtern geplant (`lining.ts`)
    lining: interiorLining(project, shell, theme, rooms),
    placements: [
      ...rooms,
      ...exterior.map((p) => ({ id: p.id, placed: placeComponent(expandComponent(ctx.catalog.get(p.componentId), p.variantId), p.pose), seed: p.seed })),
      ...outdoor.map((p) => ({ id: p.id, placed: placeComponent(expandComponent(ctx.catalog.get(p.componentId), p.variantId), p.pose), seed: p.seed })),
    ],
    theme,
    platform: ctx.platform(s.targetVersion.name),
    seed: s.seed,
    // Raumtypen für raumtypabhängige Flächen-Muster des Themes (Steinboden in Küche/Schmiede usw.)
    roomTypes: Object.fromEntries(s.rooms.map((r) => [r.id, r.roomTypeId])),
    // Lichtplan (research/37, Welle C): Lücke je Raum gegen 16 Taxi-Blöcke prüfen (gemessen 6–9)
    // K7 (research/30): Deko-Zellen erben die Attribute ihrer Trägerwand – Verläufe/Muster laufen hinter
    // Gesims, Fachwerk und Außenprofil weiter. Der Schalter ist absichtlich nur hier gesetzt, damit die
    // Materialisierungs-Prüfsummen (ohne Option) bitgleich bleiben.
    // Q5/P15: Der Nutzungszustand des Projekts (`storyState`) wirkt nur als Materialspur der Hüllzellen;
    // fehlt er, wird der Story-Pass nie aufgerufen und die Welt bleibt bitgleich.
    options: {
      lightGap: 16, captureAttributes: true,
      ...(ctx.pinwheelGuard === false ? { pinwheelGuard: false } : {}),
      // TX-B: Oberflächen-Textur (ohne Schalter nie gesetzt, bitgleich)
      ...(ctx.surfaceTexture !== undefined ? { surfaceTexture: ctx.surfaceTexture } : {}),
      // WS-Verwitterung: erzählende Cluster (ohne Schalter nie gesetzt, bitgleich)
      ...(ctx.weathering !== undefined ? { narrativeWeathering: ctx.weathering } : {}),
      ...(ctx.weatheringSolver !== undefined ? { narrativeWeatheringSolver: ctx.weatheringSolver } : {}),
      ...(s.storyState !== undefined ? { storyState: s.storyState } : {}),
      // feat/theme-moods: Achse `wear` mischt das Story-Profil stufenlos (ohne Stimmung nie gesetzt, bitgleich)
      ...storyOption(s.storyState, effectiveMood(s, theme)),
    },
  });
  return exterior.length === 0 && outdoor.length === 0 ? { shell, materialized } : { shell, materialized, ...(exterior.length > 0 ? { exterior } : {}) };
}
