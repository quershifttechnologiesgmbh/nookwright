/**
 * Use Cases „Projekt speichern/laden“: Event-Historie als JSON – im Browser (Port `KeyValueStore`,
 * Adapter: localStorage) oder als Datei (Download/Dateiauswahl). Rein und testbar.
 *
 * Das Dateiformat (`.projekt.json`, Version, Migration, Grenzen, tolerantes Lesen) liegt in `@mcda/projectfile`,
 * gemeinsam mit der Engine-API (`project_load`/`project_save` mit `format: 'app'`, C1). Hier nur die Sitzung der App
 * (Einstellungen samt Undo-freiem Start) und der Browser-Speicher.
 */
import {
  FILE_LIMITS, PROJECT_FILE_EXT, PROJECT_FILE_FORMAT, PROJECT_FILE_VERSION, parseProjectText, toProjectFile as fileOf,
  type FileRefs, type ProjectFile,
} from '@mcda/projectfile';
import { fileBaseName } from './exporting.js';
import { sessionFromProject, settingsOf, type Session } from './usecases.js';

export { FILE_LIMITS, PROJECT_FILE_EXT, PROJECT_FILE_FORMAT, PROJECT_FILE_VERSION, type ProjectFile };
/** Schlüssel im localStorage (ein Speicherplatz). */
export const STORAGE_KEY = 'basen-generator.project.v1';

export function toProjectFile(s: Session, savedAt: Date = new Date()): ProjectFile {
  return fileOf({ project: s.project, settings: settingsOf(s), surroundings: s.surroundings }, savedAt);
}

/** Kompaktes JSON (localStorage) oder eingerückt (Datei). */
export function serializeProject(s: Session, opts: { savedAt?: Date; pretty?: boolean } = {}): string {
  return JSON.stringify(toProjectFile(s, opts.savedAt), null, opts.pretty === true ? 1 : undefined);
}

export type LoadResult =
  | { readonly ok: true; readonly session: Session; readonly name: string; readonly savedAt: string | undefined; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * JSON-Text → Sitzung. Prüft Format, Version, Event-Typen und Grenzen und spielt die Historie ab (`@mcda/projectfile`).
 * Mit Katalog/Themes: Hinweise auf unbekannte Raumtypen, Komponenten und Themes (das Projekt lädt trotzdem).
 */
export function parseProjectFile(text: string, refs: FileRefs = {}): LoadResult {
  const r = parseProjectText(text, refs);
  if (!r.ok) return r;
  const session = sessionFromProject(r.project, r.settings);
  return {
    ok: true,
    session: r.surroundings === undefined ? session : { ...session, surroundings: r.surroundings },
    name: r.name,
    savedAt: r.savedAt,
    warnings: r.warnings,
  };
}

/** Dateiname für „Als Datei speichern“: `<projektname>.projekt.json`. */
export function projectFileName(name: string): string {
  return `${fileBaseName(name)}${PROJECT_FILE_EXT}`;
}

// ------------------------------------------------------------------------------------------ Browser-Speicher

/** Port: Schlüssel-Wert-Speicher (Adapter: `window.localStorage`, Tests: Map). Methoden dürfen werfen. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SaveResult = { readonly ok: true; readonly bytes: number; readonly savedAt: string } | { readonly ok: false; readonly error: string };

/** Speichert die Sitzung im Browser. Voll/gesperrt/nicht vorhanden → Fehlertext statt Ausnahme. */
export function saveToStore(store: KeyValueStore | undefined, s: Session, savedAt: Date = new Date()): SaveResult {
  if (store === undefined) return { ok: false, error: 'Der Browser-Speicher ist nicht verfügbar (privates Fenster oder gesperrt) – bitte „Als Datei“ speichern' };
  const text = serializeProject(s, { savedAt });
  try {
    store.setItem(STORAGE_KEY, text);
  } catch (e) {
    const quota = e instanceof Error && /quota/i.test(`${e.name} ${e.message}`);
    return { ok: false, error: quota ? 'Der Browser-Speicher ist voll – bitte „Als Datei“ speichern' : `Speichern im Browser fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true, bytes: text.length, savedAt: savedAt.toISOString() };
}

/** Gespeichertes Projekt laden; `undefined`, wenn nichts gespeichert ist (oder der Speicher fehlt). */
export function loadFromStore(store: KeyValueStore | undefined, refs: FileRefs = {}): LoadResult | undefined {
  let text: string | null;
  try {
    text = store?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return { ok: false, error: 'Der Browser-Speicher ist nicht lesbar' };
  }
  return text === null ? undefined : parseProjectFile(text, refs);
}

/** Was im Browser liegt (für die Anzeige, ohne Replay). */
export function storedInfo(store: KeyValueStore | undefined): { readonly name: string; readonly savedAt: string } | undefined {
  try {
    const text = store?.getItem(STORAGE_KEY);
    if (text == null) return undefined;
    const data = JSON.parse(text) as unknown;
    if (!isObject(data) || data['format'] !== PROJECT_FILE_FORMAT) return undefined;
    return { name: typeof data['name'] === 'string' ? data['name'] : '?', savedAt: typeof data['savedAt'] === 'string' ? data['savedAt'] : '' };
  } catch {
    return undefined;
  }
}
