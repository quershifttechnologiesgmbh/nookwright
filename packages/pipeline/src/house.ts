/**
 * Anwendungsdienst „Haus“ (plan/03 §4.2): Projekt → Hülle → Einrichtung → Licht-Pass → Materialisierung → Export.
 * Zellen anderer Kontexte (Gelände, Vegetation, Bauwerke) kommen als `extraCells` dazu (siehe auch `generateBase`).
 */
import { deriveShell, type DormerStyle, type FacadeDecor, type FacadeRhythmStyle, type FacadeStyle, type Project, type RoofDetail, type RoofStyle, type RoomId, type Shell, type ShellAnnex, type ShellCell, type WindowStyle,
} from '@mcda/blueprint';
import { timberDecor, type Catalog, type ResolvedTheme } from '@mcda/catalog';
import type { ExportVolume } from '@mcda/export';
import { furnishRoom, type RoomQuality } from '@mcda/furnishing';
import { toExportVolume } from '@mcda/voxel';
import type { OutdoorPlacement } from '@mcda/terrain';
import type { ExteriorPlacement, ExteriorStyle } from '@mcda/exterior';
import { exteriorFor, fitExterior } from './exterior.js';
import { facadeForTheme } from './rules.js';
import { withTimberStuds } from './studs.js';
import { furnishingGeometry } from './geometry.js';
import { circulation, type CirculationReport } from './circulation.js';
import { EXPORT_DISCLAIMER } from './disclaimer.js';
import { decorRooms } from './decor.js';
import { lightRooms, type LightingOptions, type LightingResult } from './lighting.js';
import { materializeWorld, moodOf, moodOption, placedFor, themeFor, type PipelineContext, type World } from './world.js';
import type { MoodVector } from '@mcda/core';
import type { SurfaceTextureSwitch, WeatheringSwitch } from '@mcda/materialize';
import { blockRulesContext, type BlockRules } from './blockRules.js';
import { keepOptionsOf } from './keep.js';
import { pinwheelPlacement } from './pinwheelPlacements.js';

export interface BuildOptions {
  readonly roof?: RoofStyle;
  readonly overhang?: number;
  readonly corridorTypes?: readonly string[];
  /**
   * Feature Unterbau (feat/underground): Zusatztüren für Rundgänge (`ShellOptions.loopDoors`, Wahrscheinlichkeit je
   * Raumpaar). Fehlt = Türgraph wie bisher (bitgleich).
   */
  readonly loopDoors?: number;
  /** Fenster-Stil der Hülle (additiv; Standard großzügig, siehe `DEFAULT_WINDOW_STYLE`). */
  readonly windows?: WindowStyle;
  /** Außendesign (additiv): Dach-Details, Gauben, Außenprofil – unverändert an `deriveShell` durchgereicht. */
  readonly roofDetail?: RoofDetail;
  readonly dormers?: DormerStyle;
  /** WS-Fassade: Fassadenrhythmus (Fensterachsen im Takt, Gauben auf leeren Dachflächen); fehlt = bitgleich. */
  readonly facadeRhythm?: FacadeRhythmStyle;
  readonly facade?: FacadeStyle;
  /** Angedockte Türme (B2, T1/T3): Öffnung in der Hauswand, Aussparung im Dach – Hüllen-Teil des Anbaus. */
  readonly annexes?: readonly ShellAnnex[];
  /**
   * Licht-Pass in `generate` (additiv ergänzt): Standard an (Spawn-Schutz + Stimmungs-Ziel des Raumtyps);
   * `false` = keine Lichter ergänzen, nur melden wie bisher.
   */
  readonly lighting?: LightingOptions | false;
  /**
   * Zellen anderer Kontexte (Gelände, Vegetation, Bauwerke – ShellKind terrain/plant/fort), die zusammen mit dem
   * Haus materialisiert werden (additiv, I2). Der Licht-Pass misst nur das Haus; die Endwelt enthält alles.
   */
  readonly extraCells?: readonly ShellCell[];
  /**
   * Außengestaltung (additiv, X1): Fensterläden, Blumenkästen, Portal, Vordach, Vortreppe, Laternen, Schornsteine,
   * Firstschmuck an den Ankern der Hülle (`exteriorFor`). Fehlt = keine (Welt bitgleich wie ohne); `{}` = alles an.
   */
  readonly exterior?: ExteriorStyle;
  /**
   * **K8: stabile Zell-`id`s** – Muster und Verläufe hängen an der Zelle statt an den Koordinaten, damit die Textur
   * beim Verschieben des Gebäudes stehen bleibt. Vom Nutzer **freigegeben (25.09.2026)** und seit der Aktivierung
   * **Standard** (Auftrag R_review_bt01_wehrplatten §K8): `shellFor` vergibt die IDs, solange die Option nicht
   * ausdrücklich `false` ist. `false` bleibt der Notausgang auf das ortsgebundene, bitgleiche Verhalten (A/B-Vergleich
   * und Prüfsummen-Tests).
   */
  readonly stableCellIds?: boolean;
  /**
   * Additiv (W3-BL): gesperrte Blöcke samt festen Ersetzungen (Projekt-Einstellung, Preset „Nur leicht farmbar“).
   * `generate`/`generateBase` bauen damit über `blockRulesContext`; fehlt oder leer = bitgleich.
   */
  readonly blockRules?: BlockRules;
  /**
   * WS-Verwitterung (Schritt 5 „Texturierung mit Bedeutung“, Bericht plan/spikes/WS_verwitterung.md): erzählende
   * Verwitterungs-Cluster an Fassade, Sockel und Dach (Regenstreifen, Schatten unter Überhängen, Moos/Bruchstein am
   * Sockel, Dachtäler, Baumkontakt), die in die Grundfarbe auslaufen. Fehlt (oder `off`) = kein Pass, bitgleich.
   */
  readonly weathering?: WeatheringSwitch;
  /**
   * TX-B Oberflächen-Textur (Bericht plan/spikes/TX_oberflaeche.md): zusammenhängende Blockmischung aus Schwesterblöcken
   * (60/25/15), Sockel-/Traufverlauf, Dachverlauf Traufe→First, Kontrast an Ecken und Öffnungen, Musterbruch durch
   * Streublöcke – jede Änderung mit benannter Regel. `subtle` | `rich`. Fehlt (oder `off`) = kein Pass, bitgleich.
   */
  readonly surfaceTexture?: SurfaceTextureSwitch;
}

/**
 * Deko des Außenprofils (F1): Vorgabe des Themes (`timber.decorate`, z. B. Fachwerk) plus ausdrückliche Angaben des
 * Stils (`opts.facade.decor` überschreibt die Vorgabe feldweise). Ohne Theme-Vorgabe schaltet **nur** ein Feld ein,
 * das die Deko auch will: `panels: true` die Paneele, ein Takt > 0 die Giebelstreben. `panels: false` und
 * `gableBraces: 0` heißen „aus" und schalten nichts ein – sonst zeigte die UI „Deko aus", während die Hülle Paneele
 * setzt. Ohne Theme-Vorgabe und ohne einschaltendes Feld `undefined` (Hülle zellgleich zu vorher).
 */
export function decorFor(theme: ResolvedTheme, facade: FacadeStyle | undefined): FacadeDecor | undefined {
  const want = timberDecor(theme);
  const own = facade?.decor;
  const panelled = own?.panels === true;
  const braced = own?.gableBraces !== undefined && own.gableBraces > 0;
  // Ohne Theme-Vorgabe schaltet nur ein Feld ein, das die Deko auch will (`panels: true` die Paneele, ein Takt > 0 die
  // Giebelstreben). `panels: false` und `gableBraces: 0` heißen „aus" und schalten nichts ein.
  if (want === undefined && !panelled && !braced) return undefined;
  // Fehlt der Takt, obwohl Deko läuft, gilt der Standard-Takt (3) – so bleibt „Deko an" überall gleich.
  const braces = own?.gableBraces ?? (want !== undefined || panelled ? DECOR_GABLE_BRACES : 0);
  // Paneele sind an, wenn sie ausdrücklich an sind oder wenn Deko läuft und Streben gesetzt sind; das Theme allein
  // schaltet sie auch bei `gableBraces: 0` an (dort heißt 0 nur „keine Giebelstreben").
  const panels = own?.panels ?? (panelled || (want !== undefined ? true : braces > 0));
  const role = own?.role ?? want?.role;
  return { ...(role !== undefined ? { role } : {}), panels, gableBraces: braces };
}

/** Giebelstreben-Takt (research/16 W4): Strebe, dann 3 Gefach, dann wieder eine. */
export const DECOR_GABLE_BRACES = 3;

export function shellFor(project: Project, opts: BuildOptions = {}, theme?: ResolvedTheme): Shell {
  const decor = theme !== undefined ? decorFor(theme, opts.facade) : undefined;
  // W2: Feldbreite des Fassadenrasters aus dem Theme (`facadeForTheme`, gemeinsame Regel für App und Engine)
  const facade: FacadeStyle | undefined = facadeForTheme(decor === undefined ? opts.facade : { ...opts.facade, decor }, theme);
  const shell = deriveShell(project.state, {
    roof: opts.roof ?? 'hip',
    // K8 ist freigegeben (25.09.2026) und damit Standard: stabile IDs über Standortverschiebungen hinweg.
    // Nur ein ausdrückliches `false` schaltet auf das ortsgebundene Verhalten zurück.
    stableCellIds: opts.stableCellIds !== false,
    ...(opts.overhang !== undefined ? { overhang: opts.overhang } : {}),
    ...(opts.corridorTypes !== undefined ? { corridorTypes: opts.corridorTypes } : {}),
    ...(opts.loopDoors !== undefined ? { loopDoors: opts.loopDoors } : {}),
    ...(opts.windows !== undefined ? { windows: opts.windows } : {}),
    ...(opts.roofDetail !== undefined ? { roofDetail: opts.roofDetail } : {}),
    ...(opts.dormers !== undefined ? { dormers: opts.dormers } : {}),
    ...(opts.facadeRhythm !== undefined ? { facadeRhythm: opts.facadeRhythm } : {}),
    ...(facade !== undefined ? { facade } : {}),
    ...(opts.annexes !== undefined ? { annexes: opts.annexes } : {}),
  });
  // W7-A (27.09.2026): Fachwerk-Ständer an der Hülle – Traufkonsolen nur vor Ständern, Leseport `FacadeGridLine.studs`
  // für die Außen-Deko (ohne Fachwerk-Wandregel dasselbe Objekt)
  return withTimberStuds(shell, theme, Object.fromEntries(project.state.rooms.map((r) => [r.id, r.roomTypeId])));
}

/**
 * Richtet Räume ein (Standard: alle, auf allen Etagen). Gesperrte und manuelle Platzierungen bleiben und sind
 * Hindernisse; Treppen, Deckenöffnungen und Geländer meidet die Einrichtung (`furnishingGeometry`).
 * Liefert fachliche Warnungen (z. B. „Pflichtobjekt passt nicht“), die die UI anzeigt.
 */
export interface FurnishOptions {
  /** Nur diese Räume (Standard: alle). */
  readonly roomIds?: readonly RoomId[];
  /** Dichte-Regler 0–2 (1 = Raumtyp-Standard), wirkt auf optionale Objekte. */
  readonly density?: number;
  /**
   * Stil-Kette des Themes, spezifisch zuerst (K3c, Y9): Signatur-Tausch (Nordic: Langfeuer statt Kamin) und
   * `styleTags`-Warnung. `generateWith` setzt sie aus dem Projekt-Theme (`styleChainOf`).
   */
  readonly styles?: readonly string[];
  /**
   * P07: verbindlicher Mittelgang. Wird nur an den Solver durchgereicht, wenn ausdrücklich verlangt; ohne die
   * Option bleibt das Ergebnis bitgleich. Der Solver hält den Gang dann mindestens auf `aisle.minWidth` und meldet
   * einen Konflikt mit Pflichtmöbeln als Befund, statt das Layout still aufzugeben.
   */
  readonly minAisle?: boolean;
  /**
   * W7-G (U7): bisherige Einrichtung je Raum als Vorgabe (`keepOptionsOf`): was mit allen harten Regeln noch passt,
   * bleibt an seiner Stelle; der Rest wird wie gewohnt eingerichtet. Ohne die Option bitgleich (neu gewürfelt).
   */
  readonly keep?: boolean;
  /**
   * feat/theme-moods: wirksame Stimmung (`moodOf`) – weiche Gewichte, Deko-Budget, Dichte im Solver. Ohne die Option
   * (bzw. ohne Stimmung im Projekt) bitgleich.
   */
  readonly mood?: MoodVector;
}

/** Stil-Kette eines Projekts für den Solver: Theme-Kette umgedreht (`nordic` → `['nordic', 'medieval']`). */
export function styleChainOf(project: Project, ctx: PipelineContext): readonly string[] {
  return [...themeFor(project, ctx).chain].reverse();
}

export interface FurnishReport {
  readonly warnings: string[];
  /** Qualität je Raum (Solver v2: 0,65·Mittel + 0,35·Min) mit Teilwerten für „Warum so?“. */
  readonly quality: ReadonlyMap<RoomId, RoomQuality>;
}

/** Wie `furnishRooms`, mit Dichte-Regler und Qualitätsbericht je Raum (für die UI). */
export function furnishRoomsDetailed(project: Project, shell: Shell, catalog: Catalog, opts: FurnishOptions = {}): FurnishReport {
  const warnings: string[] = [];
  const quality = new Map<RoomId, RoomQuality>();
  const ids = opts.roomIds ?? project.state.rooms.map((r) => r.id);
  for (const id of ids) {
    const room = project.room(id);
    const info = shell.rooms.get(id);
    if (info === undefined) {
      warnings.push(`${id}: keine Hülle (Raum zu klein?)`);
      continue;
    }
    const fixed = project.state.placements
      .filter((p) => p.roomId === id && (p.locked || p.origin === 'manual'))
      .map((p) => placedFor(p, catalog));
    const res = furnishRoom(furnishingGeometry(info), catalog.roomType(room.roomTypeId), catalog, {
      seed: project.roomSeed(id),
      dataVersion: project.state.targetVersion.dataVersion,
      fixed,
      ...(opts.density !== undefined ? { density: opts.density } : {}),
      ...(opts.styles !== undefined ? { styles: opts.styles } : {}),
      // P07: verbindlicher Mittelgang – nur durchreichen, wenn ausdrücklich verlangt (sonst bitgleich).
      ...(opts.minAisle === true ? { minAisle: true } : {}),
      ...(opts.keep === true ? keepOptionsOf(project, id) : {}),
      ...(opts.mood !== undefined ? { mood: opts.mood } : {}),
    });
    project.applyFurnishing(id, res.placements);
    quality.set(id, res.quality);
    warnings.push(...res.warnings.map((w) => `${id} (${room.roomTypeId}): ${w}`));
  }
  return { warnings, quality };
}

export function furnishRooms(project: Project, shell: Shell, catalog: Catalog, roomIds?: readonly RoomId[]): string[] {
  return furnishRoomsDetailed(project, shell, catalog, roomIds !== undefined ? { roomIds } : {}).warnings;
}

/**
 * Projekt → Blöcke für Theme und Zielversion des Projekts.
 * `extraCells`: Zellen aus anderen Kontexten (Gelände, Vegetation, Befestigung – ShellKind terrain/plant/fort),
 * die zusammen mit der Hülle materialisiert werden. So bleiben diese Kontexte unabhängig vom Bauplan.
 * `exterior` (additiv, X1): Außen-Komponenten aus `exteriorFor` (bei Zusatz-Zellen vorher `fitExterior`).
 * `outdoor` (additiv, Q3): Katalog-Objekte des Geländes (`SiteResult.outdoor`) – Platzierungen ohne Raum.
 */
export function buildWorld(
  project: Project, ctx: PipelineContext, shell: Shell = shellFor(project), extraCells: readonly ShellCell[] = [],
  exterior: readonly ExteriorPlacement[] = [], outdoor: readonly OutdoorPlacement[] = [],
): World {
  const merged: Shell = extraCells.length === 0 ? shell : { ...shell, cells: [...extraCells, ...shell.cells] };
  return materializeWorld(project, ctx, merged, exterior, outdoor);
}

/**
 * Welt → Export-Volumen (Name und Zielversion des Projekts). Setzt den Pflicht-Hinweis (`EXPORT_DISCLAIMER`,
 * HANDOFF §1) – die eine Stelle, über die App und Engine-API ihn in jede `.litematic`/`.schem`-Datei bringen.
 */
export function toExport(project: Project, world: World, author?: string): ExportVolume {
  return {
    ...toExportVolume(world.materialized.volume, {
      name: project.state.name,
      dataVersion: project.state.targetVersion.dataVersion,
      ...(author !== undefined ? { author } : {}),
    }),
    disclaimer: EXPORT_DISCLAIMER,
  };
}

/**
 * Ergebnis von `generate`: Welt, fachliche Warnungen, Bericht des Licht-Passes (fehlt bei `lighting: false`) und
 * der Erschließungsbericht (research/22/23: Laufwege, Erschließungsanteil; Synthese 25 Regeln 3/4/7).
 */
export type GeneratedWorld = World & {
  warnings: string[]; lighting?: LightingResult; circulation?: CirculationReport;
  /** W8-G: aus der Einrichtung entfernte Platzierungen, die mit anderen eine Windrad-Figur bildeten (nur wenn es welche gab). */
  pinwheelRemoved?: string[];
};

/**
 * Komplette Kette in einem Schritt: Hülle ableiten, alle Räume einrichten, Lichter ergänzen (Licht-Pass),
 * materialisieren. Warnungen des Licht-Passes (dunkle Zellen, die bleiben) stehen in `warnings`,
 * der ausführliche Bericht in `lighting` (fehlt bei `lighting: false`). Mit `extraCells` enthält die Welt
 * zusätzlich Gelände/Bauwerke (der Licht-Pass läuft auf dem Haus allein).
 */
export function generate(project: Project, ctx: PipelineContext, opts: BuildOptions = {}): GeneratedWorld {
  return generateWith(project, ctx, shellFor(project, opts, themeFor(project, ctx)), opts, opts.extraCells ?? []);
}

/**
 * Kern von `generate`/`generateBase`: einrichten, Licht-Pass auf dem Haus, Endwelt mit Zusatz-Zellen.
 * Mit `opts.exterior` (X1) kommen nach der Einrichtung (Feuerstellen → Schornsteine) die Außen-Komponenten dazu;
 * der Licht-Pass misst die Räume samt Außenlicht (C4: Laternen vor Fenstern und Türen zählen mit), die Endwelt
 * enthält alles. `outdoor` (Q3) sind die Katalog-Objekte des Geländes (`SiteResult.outdoor`).
 */
export function generateWith(
  project: Project, base: PipelineContext, shell: Shell, opts: BuildOptions, extraCells: readonly ShellCell[],
  outdoor: readonly OutdoorPlacement[] = [],
): GeneratedWorld {
  // W3-BL: Block-Regeln des Projekts – Auswahl ohne gesperrte Varianten, Materialisierung mit Ersatz (bitgleich ohne)
  const ctx0 = blockRulesContext(base, opts.blockRules);
  // WS-Verwitterung: Schalter im Kontext der Materialisierung (Kopie; ohne Schalter derselbe Kontext, bitgleich)
  const ctxW = opts.weathering === undefined || opts.weathering === 'off' ? ctx0 : { ...ctx0, weathering: opts.weathering };
  // TX-B: Schalter `surfaceTexture` im Kontext (Kopie; ohne Schalter derselbe Kontext, bitgleich)
  const ctx = opts.surfaceTexture === undefined || opts.surfaceTexture === 'off' ? ctxW : { ...ctxW, surfaceTexture: opts.surfaceTexture };
  const warnings = [...shell.warnings, ...furnishRoomsDetailed(project, shell, ctx.catalog, { styles: styleChainOf(project, ctx), ...moodOption(project, ctx) }).warnings];
  // feat/int-decor: Innen-Deko-Pass (nur mit gesetzter Stufe `interiorDecor`; sonst kein Eingriff, bitgleich)
  if (project.state.interiorDecor !== undefined) decorRooms(project, shell, ctx);
  // Erschließung messen (rein, ohne Materialisierung): Laufwege ab Eingang, Erschließungsanteil, kurze Treppen.
  // Bewusst NUR als Bericht: Die Warnungen setzen voraus, dass Räume über Türen zusammenhängen – bei gemalten
  // Testgrundrissen ohne gemeinsame Wand (und bei Bauten mit Außenzugang) wären sie irreführend.
  const travel = circulation(shell, project, opts.corridorTypes !== undefined ? { corridorTypes: opts.corridorTypes } : {});
  let exterior: readonly ExteriorPlacement[] = [];
  if (opts.exterior !== undefined) {
    const plan = exteriorFor(project, shell, ctx.catalog, opts.exterior, moodOf(project, ctx));
    const fitted = fitExterior(plan.placements, extraCells);
    exterior = fitted.placements;
    warnings.push(...plan.warnings.map((w) => `Außen: ${w}`), ...fitted.warnings);
  }
  if (opts.lighting === false) {
    const plain = withoutPinwheelFurniture(project, ctx, buildWorld(project, ctx, shell, extraCells, exterior, outdoor), () => buildWorld(project, ctx, shell, extraCells, exterior, outdoor));
    return { ...plain, warnings: [...warnings, ...bannedWarnings(plain)], circulation: travel };
  }
  // C4: Außen-Laternen zählen im Licht-Pass mit (leuchten durch Fenster/Türen); dessen Welt enthält sie dann schon
  // W8-G (2026-09-27): folgt noch die Endwelt mit Gelände, sind die Welten des Licht-Passes Zwischenstände – der
  // Windrad-Wächter läuft dann nur einmal, auf der Endwelt (Laufzeit); sonst ist die Licht-Welt die Endwelt.
  const final = extraCells.length === 0 && outdoor.length === 0;
  const lightCtx = final || ctx.pinwheelGuard === false ? ctx : { ...ctx, pinwheelGuard: false };
  const lighting = lightRooms(project, shell, lightCtx, { ...(opts.lighting ?? {}), ...(exterior.length > 0 ? { exterior } : {}) });
  const world = withoutPinwheelFurniture(project, ctx, final ? lighting.world : buildWorld(project, ctx, shell, extraCells, exterior, outdoor),
    () => buildWorld(project, ctx, shell, extraCells, exterior, outdoor));
  return { ...world, warnings: [...warnings, ...lighting.warnings, ...bannedWarnings(world)], lighting, circulation: travel };
}

/**
 * W8-G (2026-09-27): Windrad-Figuren aus Möbeln, die der Wächter auf Blockebene nicht beheben darf, an der Quelle
 * beheben – je Runde eine Platzierung aus der Einrichtung entfernen (`pinwheelPlacement`) und die Welt neu bauen.
 * Ohne solche Figur: dieselbe Welt (bitgleich). Die entfernten Platzierungen stehen in `pinwheelRemoved`.
 */
function withoutPinwheelFurniture(project: Project, ctx: PipelineContext, world: World, rebuild: () => World): World & { pinwheelRemoved?: string[] } {
  if (ctx.pinwheelGuard === false) return world;
  const removed: string[] = [];
  let out = world;
  for (let round = 0; round < 6; round++) {
    const id = pinwheelPlacement(project, ctx.catalog, out);
    if (id === undefined) break;
    project.removePlacement(id);
    removed.push(id);
    out = rebuild();
  }
  return removed.length === 0 ? out : { ...out, pinwheelRemoved: removed };
}

/** Gesperrte Blöcke ohne passenden Ersatz (W3-BL): bleiben im Bau, der Nutzer erfährt es. */
function bannedWarnings(world: World): string[] {
  const left = world.materialized.banned?.unreplaced ?? [];
  return left.length === 0 ? [] : [`Gesperrte Blöcke ohne passenden Ersatz (bleiben im Bau): ${left.join(', ')}`];
}
