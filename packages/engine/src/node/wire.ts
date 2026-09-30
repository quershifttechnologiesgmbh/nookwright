/**
 * Ergebnis ohne Artefakte für die Leitung (Worker → Hauptthread, Cache): JSON-Antwort plus optional die fertig
 * kodierte Schematic-Datei. Das Export-Volumen selbst wird nie kopiert (Zehntausende Blöcke); kodiert wird dort, wo
 * gerechnet wurde.
 */
import { exportFile } from '@mcda/export/node';
import { FORMAT_EXT, type ExportFormat } from '@mcda/export';
import type { ExecuteResult } from '../engine.js';

/** `ExecuteResult` ohne `artifacts` (strukturiert klonbar). */
export type WireResult =
  | { readonly ok: true; readonly op: ExecuteResult['op'] & string; readonly data: unknown; readonly cached?: true }
  | { readonly ok: false; readonly op?: string; readonly errors: readonly string[] };

export interface WireFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface WireOutcome {
  readonly result: WireResult;
  /** Nur wenn die Datei verlangt war und die Operation ein Export-Volumen liefert. */
  readonly file?: WireFile;
  /** Rechenzeit der Operation (ohne Warteschlange). */
  readonly ms: number;
}

/** Ergebnis → Leitung; mit `asFile` die Schematic-Datei kodieren (Format aus `data.format`, Standard litematic). */
export function encodeResult(r: ExecuteResult, asFile: boolean, ms: number): WireOutcome {
  const result: WireResult = r.ok
    ? { ok: true, op: r.op, data: r.data, ...(r.cached === true ? { cached: true as const } : {}) }
    : { ok: false, ...(r.op !== undefined ? { op: r.op } : {}), errors: r.errors };
  const vol = r.ok ? r.artifacts?.export : undefined;
  if (!asFile || !r.ok || vol === undefined) return { result, ms };
  const fmt = (r.data as { format?: ExportFormat }).format ?? 'litematic';
  return { result, ms, file: { name: `${vol.name.replace(/[^\w-]+/g, '_')}${FORMAT_EXT[fmt]}`, bytes: exportFile(fmt, vol) } };
}
