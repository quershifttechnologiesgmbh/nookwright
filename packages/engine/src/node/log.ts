/**
 * Protokoll der NL-Anfragen als JSONL: Prompt → gewählte Engine-Anfrage → gültig ja/nein. Grundlage für ein eigenes
 * Klassifizierungsmodell (Feintuning auf `prompt → { op, input }`); ungültige Paare sind markiert (`ok: false`).
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EngineRequest } from '../engine.js';

export interface PromptLogEntry {
  readonly ts: string;
  readonly prompt: string;
  readonly model: string;
  readonly request: EngineRequest;
  readonly ok: boolean;
  readonly errors?: readonly string[];
  /** Grund, falls lokal statt per Modell klassifiziert wurde (solche Paare nicht als Modell-Trainingsdaten werten). */
  readonly fallback?: string;
}

/**
 * W8-D: Ziel des Prompt-Logs aus `ENGINE_NL_LOG` – für Server und Skripte gleich (`.env.example`: „off = aus“).
 * `off` (Groß/Klein egal) → `undefined` (kein Log, keine Datei); fehlt oder leer → `fallback`; sonst der Pfad.
 */
export function promptLogTarget(value: string | undefined, fallback: string): string | undefined {
  const v = value?.trim() ?? '';
  if (v === '') return fallback === 'off' ? undefined : fallback;
  return v.toLowerCase() === 'off' ? undefined : v;
}

export function jsonlLog(file: string): (entry: PromptLogEntry) => void {
  mkdirSync(dirname(file), { recursive: true });
  return (entry) => appendFileSync(file, `${JSON.stringify(entry)}\n`);
}
