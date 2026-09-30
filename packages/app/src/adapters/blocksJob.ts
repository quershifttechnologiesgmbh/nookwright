/**
 * W14: „Vorschau: Blöcke“ als eigenständige Aufgabe für den Rechen-Worker (computeWorker.ts). Der Haupt-Thread schickt den
 * Projektstand als Projektdatei (`serializeProject`, dasselbe Format wie Autosave und Laden), der Worker baut daraus die
 * Sitzung (`parseProjectFile`), materialisiert mit denselben Funktionen wie `useWorld` (`baseWorldOf` bzw. `worldOf`)
 * und liefert die Quader der Vorschau (`buildBlockVoxels`) gepackt in Zahlenfelder zurück (übertragbar, ohne Kopie).
 * Gleichheit mit dem Haupt-Thread prüft `packages/app/test/performanceW14.test.ts`.
 */
import type { ExportFormat, ExportOptions, GzipCodec } from '@mcda/export';
import type { PipelineContext, World } from '@mcda/pipeline';
import type { TerrainStyleDef } from '@mcda/terrain';
import { exportGuide, exportProject, exportReport, worldOf, type ExportFile, type ExportReport, type GuideKind } from '../exporting.js';
import { parseProjectFile } from '../projectFile.js';
import { hasSurroundings } from '../surroundings.js';
import { baseWorldOf } from '../surroundingsWorld.js';
import { errorMessage, shellStyle, type Session } from '../usecases.js';
import { materialDataOf, type MaterialData } from '../ui/materialRows.js';
import { buildBlockVoxels } from '../viewer/blocks.js';
import { LAYERS, type PreviewVoxel, type VoxelLayer } from '../viewer/voxels.js';

export interface BlocksRequest {
  readonly id: number;
  /** Projektdatei (JSON-Text) des aktuellen Stands. */
  readonly file: string;
  /** Umgebung mitrechnen (Vorschau „Umgebung zeigen“), sofern das Projekt eine hat. */
  readonly around: boolean;
  /** Statt der Quader die Export-Datei in diesem Format (Knopf „Herunterladen“). */
  readonly export?: ExportFormat;
  /** Statt der Quader den Bauplan (Markdown) bzw. die Materialliste (CSV) derselben Welt (DR5 K2). */
  readonly guide?: GuideKind;
}

/** Quader der Vorschau als Zahlenfelder: je Quader 3 Mitte, 3 Größe, Farbe, Schicht, Herkunft und Block (Tabellenindex). */
export interface PackedVoxels {
  readonly count: number;
  readonly center: Float64Array;
  readonly size: Float64Array;
  readonly color: Uint32Array;
  readonly layer: Uint8Array;
  /** Index in `strings` + 1 (0 = keine Herkunft bzw. kein Blockname). */
  readonly owner: Uint32Array;
  readonly block: Uint32Array;
  readonly strings: readonly string[];
}

/** Kennzahlen der Statuszeile (wie `exportReport`). */
export interface BlocksStats {
  readonly blocks: number;
  readonly version: string;
  readonly darkCells: number;
}

/** Prüfbericht des Export-Dialogs ohne die Erreichbarkeits-Hinweise (die ergänzt der Haupt-Thread). */
export type WorldReport = Omit<ExportReport, 'access'>;

export type BlocksReply =
  | { readonly id: number; readonly voxels: PackedVoxels; readonly stats: BlocksStats; readonly report: WorldReport; readonly material: MaterialData; readonly ms: number }
  | { readonly id: number; readonly file: ExportFile }
  | { readonly id: number; readonly error: string };

export function packVoxels(list: readonly PreviewVoxel[]): PackedVoxels {
  const n = list.length;
  const center = new Float64Array(n * 3), size = new Float64Array(n * 3);
  const color = new Uint32Array(n), layer = new Uint8Array(n), owner = new Uint32Array(n), block = new Uint32Array(n);
  const strings: string[] = [];
  const index = new Map<string, number>();
  const ref = (s: string | undefined): number => {
    if (s === undefined) return 0;
    let i = index.get(s);
    if (i === undefined) {
      i = strings.length;
      strings.push(s);
      index.set(s, i);
    }
    return i + 1;
  };
  list.forEach((v, i) => {
    center.set(v.center, i * 3);
    size.set(v.size, i * 3);
    color[i] = v.color;
    layer[i] = LAYERS.indexOf(v.layer);
    owner[i] = ref(v.owner);
    block[i] = ref(v.block);
  });
  return { count: n, center, size, color, layer, owner, block, strings };
}

/** Gegenstück zu `packVoxels`: dieselben Quader (gleiche Werte, gleiche Reihenfolge, gleiche Felder). */
export function unpackVoxels(p: PackedVoxels): PreviewVoxel[] {
  const out: PreviewVoxel[] = new Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const o = p.owner[i]!, b = p.block[i]!;
    out[i] = {
      center: [p.center[i * 3]!, p.center[i * 3 + 1]!, p.center[i * 3 + 2]!],
      size: [p.size[i * 3]!, p.size[i * 3 + 1]!, p.size[i * 3 + 2]!],
      color: p.color[i]!,
      layer: LAYERS[p.layer[i]!] as VoxelLayer,
      ...(o !== 0 ? { owner: p.strings[o - 1]! } : {}),
      ...(b !== 0 ? { block: p.strings[b - 1]! } : {}),
    };
  }
  return out;
}

/** Übertragbare Puffer einer Antwort (für `postMessage(…, transfer)`). */
export function transferables(r: BlocksReply): ArrayBuffer[] {
  if ('voxels' in r) {
    const p = r.voxels;
    return [p.center, p.size, p.color, p.layer, p.owner, p.block].map((a) => a.buffer as ArrayBuffer);
  }
  return 'file' in r ? [r.file.bytes.buffer as ArrayBuffer] : [];
}

/** Was der Worker braucht: Pipeline-Kontext (Plattform-Daten ladbar) und Geländestile – wie im Haupt-Thread. */
export interface BlocksSource {
  ready(version: string): Promise<PipelineContext>;
  readonly terrainStyles: ReadonlyMap<string, TerrainStyleDef>;
  readonly refs?: Parameters<typeof parseProjectFile>[1];
  /** GZip für den Export (Browser: `CompressionStream`); nur für Export-Anfragen nötig. */
  readonly gzip?: GzipCodec;
}

/**
 * Zuletzt gelesene Projektdateien → Sitzung. Derselbe Stand (Vorschau, dann Export-Dialog und Download) liest die Datei
 * nur einmal; dasselbe Zustandsobjekt lässt die Zwischenspeicher von `worldOf`/`baseWorldOf` treffen.
 */
const recentSessions: Array<{ readonly file: string; readonly session: Session }> = [];
const RECENT_SESSIONS = 3;

function sessionOf(file: string, source: BlocksSource): Session | string {
  const i = recentSessions.findIndex((e) => e.file === file);
  if (i >= 0) {
    const [hit] = recentSessions.splice(i, 1);
    recentSessions.unshift(hit!);
    return hit!.session;
  }
  const loaded = parseProjectFile(file, source.refs);
  if (!loaded.ok) return loaded.error;
  recentSessions.unshift({ file, session: loaded.session });
  recentSessions.length = Math.min(recentSessions.length, RECENT_SESSIONS);
  return loaded.session;
}

/** Welt wie `useWorld`: mit Umgebung `baseWorldOf`, sonst `worldOf`. */
function worldFor(s: Session, ctx: PipelineContext, around: boolean, source: BlocksSource): World {
  const style = shellStyle(s);
  return around && hasSurroundings(s.surroundings) ? baseWorldOf(s.project, ctx, style, s.surroundings, source.terrainStyles) : worldOf(s.project, ctx, style);
}

/** Eine Anfrage beantworten (wirft nie; Fehler als `error` mit derselben Meldung wie `useWorld` bzw. der Download). */
export async function blocksJob(req: BlocksRequest, source: BlocksSource, opts: ExportOptions = {}): Promise<BlocksReply> {
  try {
    const s = sessionOf(req.file, source);
    if (typeof s === 'string') return { id: req.id, error: s };
    const ctx = await source.ready(s.project.state.targetVersion.name);
    const t0 = performance.now();
    const world = worldFor(s, ctx, req.around, source);
    if (req.guide !== undefined) return { id: req.id, file: exportGuide(s.project, world, req.guide) };
    if (req.export !== undefined) {
      if (source.gzip === undefined) return { id: req.id, error: 'GZip fehlt im Worker' };
      return { id: req.id, file: await exportProject(s.project, world, req.export, source.gzip, opts) };
    }
    const voxels = packVoxels(buildBlockVoxels(world));
    const { access: _access, ...report } = exportReport(world);
    const stats = { blocks: report.blocks, version: report.version, darkCells: report.darkCells };
    return { id: req.id, voxels, stats, report, material: materialDataOf(world), ms: performance.now() - t0 };
  } catch (e) {
    return { id: req.id, error: errorMessage(e) };
  }
}
