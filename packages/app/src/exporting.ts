/**
 * Use Cases „Blöcke berechnen“ und „Exportieren“ – rein bis auf den injizierten `GzipCodec`
 * (Browser: `streamGzip` aus adapters/gzip.ts, Tests: `nodeGzip` aus @mcda/export/node).
 *
 * Kette über den Anwendungsdienst: `buildWorld` (Theme + Zielversion des Projekts, dieselbe Hülle wie der Editor)
 * → `toExport` → `writeExportFile`.
 */
import type { Project, ProjectState, RoofStyle } from '@mcda/blueprint';
import { FORMAT_EXT, writeExportFile, type ExportFormat, type ExportOptions, type GzipCodec } from '@mcda/export';
import type { Violation } from '@mcda/materialize';
import type { Vec3 } from '@mcda/core';
import { EXPORT_LIMITS, blockRulesContext, buildGuide, buildGuideCsv, buildGuideMarkdown, buildWorld, toExport, volumeTooLarge, type PipelineContext, type World } from '@mcda/pipeline';
import { isAir } from '@mcda/voxel';
import { toStyle } from '@mcda/projectfile';
import { DEFAULT_ROOF, exteriorOf, shellOf, shellThemeOf, styleKey, type ShellStyle } from './usecases.js';

export const DEFAULT_EXPORT_FORMAT: ExportFormat = 'litematic';

export const EXPORT_FORMAT_OPTIONS: ReadonlyArray<{ readonly id: ExportFormat; readonly label: string; readonly hint: string }> = [
  { id: 'litematic', label: '.litematic', hint: 'Litematica (Standard)' },
  { id: 'schem', label: '.schem', hint: 'WorldEdit / Sponge v3' },
  { id: 'nbt', label: '.nbt', hint: 'Strukturdatei (Strukturblock, /place template)' },
];

/**
 * Kennung für `/place template` aus dem Projektnamen: Minecraft erlaubt dort nur `a–z 0–9 _ - .`; Umlaute werden
 * umschrieben, alles andere zu `_` (z. B. „Große Halle“ → `grosse_halle`).
 */
export function templateId(projectName: string): string {
  const id = fileBaseName(projectName)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return id === '' ? 'projekt' : id;
}

/**
 * Hinweis im Export-Dialog je Format: wo die Datei hingehört und wie sie ins Spiel kommt (Review: vorher stand bei
 * `.litematic` „/place template … strict“, das gilt nur für `.nbt`). Inline-Code in Backticks.
 * - Litematica: Ordner `schematics`, im Mod laden (Menü „Load Schematics“), als Hologramm platzieren.
 * - WorldEdit: Ordner `config/worldedit/schematics` (Server: `plugins/WorldEdit/schematics`), `//schem load`, `//paste`.
 * - Strukturdatei: Strukturordner der Welt; seit 26.1 heißt er `structure` statt `structures`
 *   (plan/mechanik_faktencheck.md §12). Der Dateiname muss eine gültige Kennung sein; `strict` platziert ohne
 *   Form-Updates (§ Export). Der Strukturblock lädt höchstens 48 × 48 × 48.
 */
export function placeHint(format: ExportFormat, projectName: string, version: string): string {
  if (format === 'litematic') return 'Datei in den Ordner `.minecraft/schematics` legen, in Litematica über „Load Schematics“ laden und als Hologramm platzieren';
  if (format === 'schem') return 'Datei in `config/worldedit/schematics` legen (Server: `plugins/WorldEdit/schematics`), dann `//schem load <Name>` und `//paste`';
  const id = templateId(projectName);
  const folder = version.startsWith('1.') ? 'structures' : 'structure';
  return `Datei als \`${id}.nbt\` in \`saves/<Welt>/generated/minecraft/${folder}\` legen, dann \`/place template minecraft:${id} ~ ~ ~ none none 1 0 strict\`. Der Strukturblock lädt höchstens 48 × 48 × 48 Blöcke`;
}

/**
 * Nichts zu exportieren? Leer heißt: keine Räume, Möbel, Treppen und keine Umgebung (Gelände oder Bauwerke) – dann
 * gibt es keine Blöcke. Liefert den Grund für den gesperrten Knopf „Exportieren …“ (Review R1-15: vorher zeigte der
 * Dialog einen roten Fehler und grüne „Keine Fehler“-Zeilen gleichzeitig), sonst `undefined`.
 */
export function nothingToExport(state: Pick<ProjectState, 'rooms' | 'placements' | 'links'>, surroundings: boolean): string | undefined {
  const empty = state.rooms.length === 0 && state.placements.length === 0 && state.links.length === 0 && !surroundings;
  return empty ? 'Noch nichts zu exportieren – erst einen Raum malen, einen Bautyp übernehmen oder ein Bauwerk setzen' : undefined;
}

const worldCache = new WeakMap<PipelineContext, WeakMap<ProjectState, Map<string, World>>>();

function cacheFor(project: Project, ctx: PipelineContext): Map<string, World> {
  let byState = worldCache.get(ctx);
  if (byState === undefined) worldCache.set(ctx, (byState = new WeakMap()));
  let byRoof = byState.get(project.state);
  if (byRoof === undefined) byState.set(project.state, (byRoof = new Map()));
  return byRoof;
}

/**
 * Blöcke des Projekts (Theme + Zielversion des Projekts, Stil der Sitzung: Dach, Überstand, Fenster, Dach-Details,
 * Außenprofil, Außen-Deko), zwischengespeichert je Projektzustand und `styleKey`. Vorschau „Blöcke/Texturen“ und
 * Export rufen beide diese Funktion mit `shellStyle(session)` auf – dieselbe Hülle, dieselbe Außen-Deko
 * (`exteriorOf`), dieselben Blöcke. Wirft bei Auflösungs- oder Merge-Fehlern der Materialisierung;
 * die Plattform-Daten der Zielversion müssen im Kontext geladen sein.
 */
export function worldOf(project: Project, ctx: PipelineContext, style: RoofStyle | ShellStyle = DEFAULT_ROOF): World {
  const byStyle = cacheFor(project, ctx);
  const key = styleKey(style);
  let world = byStyle.get(key);
  if (world === undefined) {
    // W3-BL: Materialisierung mit den Block-Regeln der Sitzung (gesperrte Blöcke ersetzt, wie in der Engine)
    const ruled = blockRulesContext(ctx, toStyle(style).blockRules);
    world = buildWorld(project, ruled, shellOf(project, style, shellThemeOf(ctx.catalog, project.state.themeId)), [], exteriorOf(project, ctx.catalog, style)?.placements ?? []);
    byStyle.set(key, world);
  }
  return world;
}

/**
 * Schon berechnete Blöcke (z. B. vom Licht-Pass, der die Außen-Deko mitmisst) für diesen Projektzustand merken – spart
 * eine Materialisierung. Nur, wenn die Welt zum Stil passt (gleich viele Außen-Teile).
 */
export function rememberWorld(project: Project, ctx: PipelineContext, style: RoofStyle | ShellStyle, world: World): void {
  if ((exteriorOf(project, ctx.catalog, style)?.placements.length ?? 0) === (world.exterior?.length ?? 0)) cacheFor(project, ctx).set(styleKey(style), world);
}

/** Export-Obergrenze: gemeinsame Regel mit der Engine-API (`@mcda/pipeline`). */
export { EXPORT_LIMITS, volumeTooLarge };

/** Was der Export-Dialog vor dem Download zeigt. */
export interface ExportReport {
  /** Nicht-Luft-Blöcke im Volumen. */
  readonly blocks: number;
  readonly size: Vec3;
  readonly version: string;
  /** Harte Verstöße (Stütze, Schwerkraft, Masken, Hälften …): Schwere `error`, außer `spawn`. */
  readonly errors: readonly Violation[];
  /** Weiche Hinweise der Materialisierung (Schwere `warning`, z. B. Dachtreppen-Form), außer `spawn`. */
  readonly notes: readonly Violation[];
  /** `spawn`: begehbare Zellen ohne Blocklicht („dunkle Stellen“), eine Meldung je Raum. */
  readonly darkSpots: readonly Violation[];
  readonly darkCells: number;
  /**
   * Der Bau hat keine Räume – es gibt **nichts** zu exportieren. Anders als andere Fehler ist das kein
   * „Trotzdem"-Fall: der Knopf bleibt gesperrt (Review 4, offener Punkt aus §13).
   */
  readonly empty: boolean;
  /**
   * Erschließungs-Hinweise aus dem Laufweg-Bericht (`@mcda/pipeline` `circulation`): Räume ohne Weg, Etagen ohne
   * Treppenzugang, zu kurze Treppen. Review: Der Export meldete „Keine Fehler“, obwohl OG und Keller keinen
   * Zugang hatten.
   *
   * **Nicht enthalten:** die Windfang-Warnungen (`circulation().entry.warnings`) – sie stehen im Bericht, werden
   * aber bewusst nicht in dieser Liste gezeigt, weil sie für bestehende Vorlagen neue Hinweise erzeugen würden
   * (offen, research/50 §E9: Sichtbarkeit zuerst an den Vorlagen messen).
   */
  readonly access: readonly string[];
}

export function exportReport(world: World, access: readonly string[] = []): ExportReport {
  const m = world.materialized;
  let blocks = 0;
  for (const c of m.volume.cells()) if (!isAir(c.state)) blocks++;
  const darkSpots = m.violations.filter((v) => v.kind === 'spawn');
  const errors = m.violations.filter((v) => v.kind !== 'spawn' && v.severity !== 'warning');
  // Review 3/4: „leeres Projekt exportierbar“ – leer heißt **keine Blöcke**. Ein Bau ohne Räume, aber mit Mauer,
  // Turm oder Windmühle ist ein vollwertiger Export (Review 4: „Umgebung ohne Haus lässt sich nicht mehr
  // exportieren“) und wird hier nicht mehr beanstandet.
  const empty = blocks === 0;
  if (empty) {
    errors.unshift({ kind: 'project', severity: 'error', message: 'Das Projekt ist leer: Es gibt keine Blöcke. Male zuerst einen Raum oder setze ein Bauwerk.' });
  }
  // Review 3: Export-Obergrenze unabhängig von der Datei – direkt am zu schreibenden Volumen geprüft
  const zuGross = volumeTooLarge(m.volume.size);
  if (zuGross !== undefined) errors.unshift({ kind: 'project', severity: 'error', message: zuGross });
  return {
    blocks,
    size: m.volume.size,
    version: m.version,
    empty,
    errors,
    notes: m.violations.filter((v) => v.kind !== 'spawn' && v.severity === 'warning'),
    darkSpots,
    darkCells: darkSpots.reduce((n, v) => n + (v.cells?.length ?? 0), 0),
    access,
  };
}

/** Dateiname ohne Endung aus dem Projektnamen; im Dateisystem verbotene Zeichen werden zu `_`. */
export function fileBaseName(projectName: string): string {
  const base = projectName
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80);
  return base.length > 0 ? base : 'projekt';
}

/** Dateiname `<projektname>.<ext>`. */
export function exportFileName(projectName: string, format: ExportFormat): string {
  return `${fileBaseName(projectName)}${FORMAT_EXT[format]}`;
}

export interface ExportFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/**
 * Projekt + berechnete Blöcke → fertige Datei (GZip-NBT). `world` muss zum aktuellen Projektzustand gehören
 * (Zielversion wird geprüft); `opts.date` macht die Datei reproduzierbar (Tests).
 */
export async function exportProject(project: Project, world: World, format: ExportFormat, codec: GzipCodec, opts: ExportOptions = {}): Promise<ExportFile> {
  const target = project.state.targetVersion;
  if (world.materialized.dataVersion !== target.dataVersion) {
    throw new Error(`Die Blöcke gehören zu Minecraft ${world.materialized.version}, das Projekt zielt auf ${target.name} – bitte neu berechnen`);
  }
  const zuGross = volumeTooLarge(world.materialized.volume.size);
  if (zuGross !== undefined) throw new Error(zuGross);
  const bytes = await writeExportFile(format, toExport(project, world), codec, opts);
  return { name: exportFileName(project.state.name, format), bytes, mime: 'application/octet-stream' };
}

/** Bauplan-Ausgaben des Export-Dialogs (DR5 K2): Anleitung als Markdown, Materialliste als CSV. */
export type GuideKind = 'markdown' | 'csv';

/** Dateiname des Bauplans: `<projektname>.bauplan.md` bzw. `<projektname>.material.csv`. */
export function guideFileName(projectName: string, kind: GuideKind): string {
  return `${fileBaseName(projectName)}${kind === 'markdown' ? '.bauplan.md' : '.material.csv'}`;
}

/**
 * Bauplan zur berechneten Welt – dieselbe Funktion (`buildGuide` aus @mcda/pipeline) und dasselbe Volumen wie die
 * Schematic und wie die Engine-Operation `build_guide`. Markdown mit Raster je Ebene (bei großer Grundfläche ausgelassen).
 */
export function exportGuide(project: Project, world: World, kind: GuideKind): ExportFile {
  const zuGross = volumeTooLarge(world.materialized.volume.size);
  if (zuGross !== undefined) throw new Error(zuGross);
  const guide = buildGuide(toExport(project, world), { grids: kind === 'markdown' });
  const text = kind === 'markdown' ? buildGuideMarkdown(guide) : buildGuideCsv(guide);
  return { name: guideFileName(project.state.name, kind), bytes: new TextEncoder().encode(text), mime: kind === 'markdown' ? 'text/markdown' : 'text/csv' };
}
