/**
 * View-Model der Arbeitsfläche (rein, testbar ohne DOM): Darstellung der 3D-Ansicht (Rollen/Blöcke/Texturen) mit
 * automatischer Wahl, Grundriss-Anordnung, Ansichten, Licht-Regler, Etagen-Leiste und Startwerte aus der Adresszeile.
 */
import type { ProjectState } from '@mcda/blueprint';
import type { TextureState } from '../textures/assets.js';
import { floorLabel } from '../usecases.js';
import type { ViewMode } from '../viewer/voxels.js';

// ---------------------------------------------------------------------------------------------- Darstellung

/** Quelle der 3D-Ansicht: Flächenfarben je Rolle (sofort), materialisierte Blöcke (eigene Pixeltexturen) oder echte Blockmodelle. */
export type PreviewSource = 'roles' | 'blocks' | 'textures';

export const PREVIEW_SOURCES: ReadonlyArray<{ readonly id: PreviewSource; readonly label: string; readonly hint: string }> = [
  { id: 'roles', label: 'Rollen', hint: 'Flächenfarben je Rolle – sofort, ohne Theme' },
  { id: 'blocks', label: 'Blöcke', hint: 'Materialisierte Blöcke mit Theme und Zielversion (wie im Export), eigene Pixeltexturen' },
  { id: 'textures', label: 'Texturen', hint: 'Echte Blockmodelle, Texturen und Minecraft-Licht aus deinem eigenen Minecraft-JAR' },
];

export interface PreviewOption {
  readonly id: PreviewSource;
  readonly label: string;
  readonly hint: string;
  readonly disabled: boolean;
}

/** Knöpfe der Darstellung: ohne Pipeline (kein gültiges Theme) nur Rollen; Texturen nur mit Quelle. */
export function previewOptions(pipelineOk: boolean, texture: { readonly enabled: boolean; readonly hint: string }): PreviewOption[] {
  return PREVIEW_SOURCES.map((p) => ({
    ...p,
    hint: p.id === 'textures' ? texture.hint : p.hint,
    disabled: !pipelineOk ? p.id !== 'roles' : p.id === 'textures' && !texture.enabled,
  }));
}

/**
 * Tatsächliche Darstellung. Standard: Texturen + Licht, sobald eine Texturquelle da ist, sonst Blöcke; ohne Pipeline
 * nur Rollen. Eine Wahl des Nutzers (`choice`) gilt, solange sie möglich ist.
 */
export function effectivePreview(choice: PreviewSource | undefined, tex: TextureState, pipelineOk: boolean): PreviewSource {
  if (!pipelineOk) return 'roles';
  const texturesPossible = tex.kind === 'available' || tex.kind === 'loading' || tex.kind === 'ready';
  if (choice === 'textures') return texturesPossible || tex.kind === 'probing' ? 'textures' : 'blocks';
  if (choice !== undefined) return choice;
  return texturesPossible ? 'textures' : 'blocks';
}

/** Nächste wählbare Darstellung (Taste V). */
export function nextPreview(current: PreviewSource, options: readonly PreviewOption[]): PreviewSource {
  const i = options.findIndex((o) => o.id === current);
  for (let n = 1; n <= options.length; n++) {
    const o = options[(i + n) % options.length]!;
    if (!o.disabled) return o.id;
  }
  return current;
}

// ---------------------------------------------------------------------------------------------- Ansicht, Anordnung

export const VIEW_MODES: ReadonlyArray<{ readonly id: ViewMode; readonly label: string; readonly key: string }> = [
  { id: 'full', label: 'Komplett', key: '1' },
  { id: 'noRoof', label: 'Dach ab', key: '2' },
  { id: 'floorOnly', label: 'Wände ab', key: '3' },
];

/** Grundriss neben der 3D-Ansicht, als Fenster darüber, oder ausgeblendet. */
export type PlanLayout = 'split' | 'overlay' | '3d';

export const PLAN_LAYOUTS: ReadonlyArray<{ readonly id: PlanLayout; readonly label: string; readonly hint: string }> = [
  { id: 'split', label: 'Geteilt', hint: 'Grundriss neben der 3D-Ansicht' },
  { id: 'overlay', label: 'Überlagert', hint: 'Grundriss als Fenster über der 3D-Ansicht' },
  { id: '3d', label: 'Nur 3D', hint: 'Grundriss ausblenden (G holt ihn zurück)' },
];

export function nextLayout(l: PlanLayout): PlanLayout {
  const i = PLAN_LAYOUTS.findIndex((x) => x.id === l);
  return PLAN_LAYOUTS[(i + 1) % PLAN_LAYOUTS.length]!.id;
}

// ---------------------------------------------------------------------------------------------- Licht

/** Regler des Minecraft-Lichts in der Darstellung „Texturen“ (nur Uniforms im Renderer, kein Neubau). */
export interface PreviewLighting {
  readonly enabled: boolean;
  /** Minecraft-Tageszeit in Ticks (6000 = Mittag, 18000 = Mitternacht) */
  readonly dayTime: number;
  readonly spawnHighlight: boolean;
  /** Helligkeit wie die Spieloption (0 = düster, 1 = hell) */
  readonly brightness: number;
  /** Weiches Licht + Umgebungsverdeckung */
  readonly smooth: boolean;
  readonly flicker: boolean;
}

export const DEFAULT_LIGHTING: PreviewLighting = { enabled: true, dayTime: 6000, spawnHighlight: false, brightness: 0.5, smooth: true, flicker: false };

export const DAY_TICKS = 6000;
export const NIGHT_TICKS = 18000;

/** Nacht im Sinne der Taste N: Sonne unter dem Horizont (ca. 13 000 – 23 000 Ticks). */
export const isNight = (ticks: number): boolean => {
  const t = ((ticks % 24000) + 24000) % 24000;
  return t >= 13000 && t < 23000;
};

export function toggleDayNight(l: PreviewLighting): PreviewLighting {
  return { ...l, enabled: true, dayTime: isNight(l.dayTime) ? DAY_TICKS : NIGHT_TICKS };
}

// ---------------------------------------------------------------------------------------------- Etagen

export interface FloorItem {
  readonly index: number;
  readonly label: string;
  /** z. B. „y 0 · Höhe 3 · 4 Räume“ */
  readonly detail: string;
  readonly rooms: number;
  readonly active: boolean;
}

export const ADD_FLOOR_HINT = 'Etage über der obersten hinzufügen (Keller, Wandhöhe, Entfernen: Klick auf die aktive Etage)';

/** Einträge der Etagen-Leiste, oberste Etage zuerst (wie im Aufzug). */
export function floorItems(state: ProjectState, active: number): FloorItem[] {
  return [...state.floors]
    .sort((a, b) => b.index - a.index)
    .map((f) => {
      const rooms = state.rooms.filter((r) => r.floorIndex === f.index).length;
      return {
        index: f.index,
        label: floorLabel(f.index),
        detail: `Etage ${f.index} · y ${f.y0} · Wandhöhe ${f.height} · ${rooms} ${rooms === 1 ? 'Raum' : 'Räume'}`,
        rooms,
        active: f.index === active,
      };
    });
}

/**
 * Etage für das Geister-Overlay im Grundriss: die darunterliegende (dort sieht man, wo oben gemalt werden kann);
 * im Keller die darüber – das Haus, unter dem man gräbt. `undefined`, wenn es sie nicht gibt.
 */
export function ghostFloor(state: ProjectState, active: number): number | undefined {
  const other = active < 0 ? active + 1 : active - 1;
  return state.floors.some((f) => f.index === other) ? other : undefined;
}

/** 3D-Ansicht der Etagen: alle, bis zur aktiven (darüber ausgeblendet) oder nur die aktive. */
export type FloorView = 'all' | 'upTo' | 'only';

export const FLOOR_VIEWS: ReadonlyArray<{ readonly id: FloorView; readonly label: string; readonly hint: string }> = [
  { id: 'all', label: 'Alle', hint: 'Alle Etagen zeigen' },
  { id: 'upTo', label: 'Bis aktive', hint: 'Etagen über der aktiven ausblenden – der Schnitt folgt der Etage' },
  { id: 'only', label: 'Nur aktive', hint: 'Nur die aktive Etage zeigen (Boden bis Wandkrone; oberste Etage mit Dach)' },
];

/** Sichtbarer Höhenbereich (Welt-y, inklusive); fehlende Grenze = offen. */
export interface YRange {
  readonly minY?: number | undefined;
  readonly maxY?: number | undefined;
}

/**
 * Höhenbereich der 3D-Ansicht für die aktive Etage. „Bis aktive“ schneidet unter der Bodenplatte der Etage darüber
 * (Wandkrone der aktiven Etage); auf der obersten Etage bleibt alles samt Dach sichtbar. „Nur aktive“ blendet
 * zusätzlich alles unter der eigenen Bodenplatte aus.
 */
export function floorRange(state: ProjectState, active: number, mode: FloorView): YRange {
  const f = state.floors.find((x) => x.index === active);
  if (mode === 'all' || f === undefined) return {};
  const top = state.floors.every((x) => x.index <= active);
  const maxY = top ? undefined : f.y0 + f.height;
  return mode === 'only' ? { minY: f.y0, maxY } : { maxY };
}

/** Schnitt-Regler und Etagen-Bereich zusammen: die engere Grenze gilt. */
export function combineRange(sliderMaxY: number | undefined, floor: YRange): YRange {
  const maxY = sliderMaxY === undefined ? floor.maxY : floor.maxY === undefined ? sliderMaxY : Math.min(sliderMaxY, floor.maxY);
  return { minY: floor.minY, maxY };
}

/** Nachbar-Etage (dir = +1 höher, −1 tiefer) oder `undefined`. */
export function adjacentFloor(state: ProjectState, active: number, dir: 1 | -1): number | undefined {
  const sorted = state.floors.map((f) => f.index).sort((a, b) => a - b);
  const i = sorted.indexOf(active);
  return i < 0 ? sorted[0] : sorted[i + dir];
}

/** Gewählte Etage gültig halten (z. B. nach Laden eines Projekts ohne diese Etage). */
export function validFloor(state: ProjectState, active: number): number {
  return state.floors.some((f) => f.index === active) ? active : (state.floors[0]?.index ?? 0);
}

// ---------------------------------------------------------------------------------------------- Adresszeile

export interface ViewSettings {
  readonly view: ViewMode;
  readonly preview: PreviewSource | undefined;
  readonly layout: PlanLayout;
  /** Rohwert des Schnitt-Reglers (Welt-y); `undefined` = kein Schnitt */
  readonly cut: number | undefined;
  readonly grid: boolean;
  readonly lighting: PreviewLighting;
  /** Etagen in 3D (Standard „bis aktive“: bei einer Etage dasselbe wie „alle“). */
  readonly floors: FloorView;
}

/** W2-ED U2 (Nutzerentscheidung): 3D groß, Grundriss einblendbar – Standard ohne Grundriss, Zeichenwerkzeuge blenden ihn ein. */
export const DEFAULT_VIEW: ViewSettings = { view: 'noRoof', preview: undefined, layout: '3d', cut: undefined, grid: true, lighting: DEFAULT_LIGHTING, floors: 'upTo' };

/**
 * Startwerte aus der Adresszeile (Screenshots, Links; wie die frühere Viewer-Demo):
 * `view=full|noRoof|floorOnly`, `preview=roles|blocks|textures`, `layout=split|overlay|3d`, `cut=<y>`, `grid=0`,
 * `time=<Ticks>`, `lit=0`, `spawn=1`, `brightness=0…100`, `smooth=0`, `flicker=1`, `floors=all|upTo|only`.
 * Ungültige Werte werden ignoriert.
 */
export function viewSettingsFromQuery(search: string, base: ViewSettings = DEFAULT_VIEW): ViewSettings {
  const q = new URLSearchParams(search);
  const pick = <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
    const v = q.get(key);
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
  };
  const num = (key: string, min: number, max: number): number | undefined => {
    const raw = q.get(key);
    const v = raw === null || raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(v) && v >= min && v <= max ? v : undefined;
  };
  const flag = (key: string): boolean | undefined => {
    const v = q.get(key);
    return v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : undefined;
  };
  const l = base.lighting;
  const brightness = num('brightness', 0, 100);
  return {
    view: pick('view', ['full', 'noRoof', 'floorOnly'] as const) ?? base.view,
    preview: pick('preview', ['roles', 'blocks', 'textures'] as const) ?? base.preview,
    layout: pick('layout', ['split', 'overlay', '3d'] as const) ?? base.layout,
    cut: num('cut', -64, 320) ?? base.cut,
    grid: flag('grid') ?? base.grid,
    floors: pick('floors', ['all', 'upTo', 'only'] as const) ?? base.floors,
    lighting: {
      enabled: flag('lit') ?? l.enabled,
      dayTime: num('time', 0, 24000) ?? l.dayTime,
      spawnHighlight: flag('spawn') ?? l.spawnHighlight,
      brightness: brightness === undefined ? l.brightness : brightness / 100,
      smooth: flag('smooth') ?? l.smooth,
      flicker: flag('flicker') ?? l.flicker,
    },
  };
}

/** Schnitt-Einstellungen der 3D-Ansicht: Dach/Wände, Etagen-Ansicht und Schnitt-Regler (`undefined` = aus). */
export interface CutSettings {
  readonly view: ViewMode;
  readonly floors: FloorView;
  readonly cut: number | undefined;
}

/**
 * W11-B (R6): „Augenhöhe“ zeigt das Haus wie im Spiel – mit Dach, alle Etagen, ohne Schnitt. Vorher blieb „Dach ab“
 * an, und man sah in Augenhöhe ein Haus ohne Dach. `restore` = was beim Verlassen der Augenhöhe (erste eigene
 * Kamerabewegung, Einpassen) zurückkommt; `undefined`, wenn schon alles sichtbar war.
 */
export function eyeLevelCut(current: CutSettings): { readonly show: CutSettings; readonly restore: CutSettings | undefined } {
  const whole = current.view === 'full' && current.floors === 'all' && current.cut === undefined;
  return { show: { view: 'full', floors: 'all', cut: undefined }, restore: whole ? undefined : current };
}
