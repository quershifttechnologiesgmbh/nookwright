/**
 * Entscheidungen rund um „Arbeit geht nicht verloren" (Nutzer-Review 24.09.2026): automatisches Speichern im
 * Browser, Warnung beim Schließen, Wiederaufnahme-Angebot und Rückfrage vor dem Ersetzen des Projekts.
 * Rein und testbar – die Verdrahtung steht in `App.tsx`.
 */
import type { ProjectState } from '@mcda/blueprint';

/** Verzögerung des automatischen Speicherns nach der letzten Änderung (ms). */
export const AUTOSAVE_DELAY_MS = 1200;

/** Hat das Projekt schon Inhalt, den man verlieren könnte? (Leeres Startprojekt: nein.) */
export function hasContent(state: ProjectState): boolean {
  return state.rooms.length > 0 || state.placements.length > 0 || state.links.length > 0;
}

/** Text, wenn ein anderer Tab inzwischen gespeichert hat (Review 3: „Zwei Tabs“). */
export const FOREIGN_SAVE_HINT =
  'Ein anderer Tab hat inzwischen gespeichert – dieser Tab speichert nicht automatisch, damit die neuere Arbeit nicht verloren geht. Seite neu laden, um den neueren Stand zu übernehmen; „Speichern“ (Strg+S) überschreibt ihn dagegen bewusst.';

/**
 * Hat ein **anderer Tab** seit unserem letzten Speichern/Laden geschrieben? `baseSavedAt` ist der Zeitstempel,
 * den dieser Tab zuletzt geschrieben bzw. geladen hat (ISO-Text, `undefined` = noch keiner).
 * ISO-Zeitstempel lassen sich lexikografisch vergleichen – das entspricht der Zeitfolge.
 */
export function foreignSave(baseSavedAt: string | undefined, storedSavedAt: string | undefined): boolean {
  if (storedSavedAt === undefined || storedSavedAt === '') return false;
  if (baseSavedAt === undefined || baseSavedAt === '') return true;
  return storedSavedAt > baseSavedAt;
}

/**
 * Was tut der Autosave jetzt? **Diese Funktion ist der Code, den `App.tsx` ausführt** – der Regressionstest
 * („vor der ersten Nutzeränderung wird nicht gespeichert") prüft damit wirklich den Pfad der App und nicht eine
 * Kopie im Test.
 *
 * - `skip`: kein Speicher verfügbar oder der Nutzer hat seit dem Laden nichts geändert (die Regression: das
 *   leere Startprojekt überschrieb sonst nach 1,2 s den gespeicherten Stand).
 * - `blocked`: ein anderer Tab hat inzwischen gespeichert (Review 3).
 * - `save`: schreiben.
 */
export type AutosaveAction = 'skip' | 'blocked' | 'save';

export function autosaveAction(
  touched: boolean,
  storeAvailable: boolean,
  baseSavedAt: string | undefined,
  storedSavedAt: string | undefined,
): AutosaveAction {
  if (!storeAvailable || !touched) return 'skip';
  return foreignSave(baseSavedAt, storedSavedAt) ? 'blocked' : 'save';
}

/**
 * Führt den Autosave aus – **das ist der Ablauf des Effekts in `App.tsx`**, hier mit injizierten Timern, damit ein
 * Test genau den Ablauf prüfen kann (Review 4: der Fehler saß darin, wie der Effekt das Ergebnis *verwendet*).
 *
 * `skip` → nichts tun (kein Timer). `blocked` → **sofort** melden (kein Timer!): ein fremder Tab hat den Speicher
 * übernommen, dieser Tab speichert nicht mehr, und die Statuszeile *und* die Warnung beim Schließen müssen das
 * erfahren. `save` → nach `delayMs` erneut entscheiden (in der Wartezeit kann ein anderer Tab geschrieben haben)
 * und dann schreiben.
 *
 * @returns Timer-Kennung, die der Aufrufer beim Aufräumen löschen muss (`undefined`, wenn kein Timer läuft).
 */
export function scheduleAutosave(
  rt: {
    readonly action: () => AutosaveAction;
    readonly write: () => void;
    readonly blocked: () => void;
  },
  opts: {
    readonly delayMs?: number;
    readonly setTimer?: (fn: () => void, ms: number) => number;
    readonly clearTimer?: (id: number) => void;
  } = {},
): number | undefined {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const first = rt.action();
  if (first === 'skip') return undefined;
  if (first === 'blocked') {
    rt.blocked();
    return undefined;
  }
  return setTimer(() => {
    const again = rt.action();
    if (again === 'blocked') {
      rt.blocked();
      return;
    }
    if (again === 'save') rt.write();
  }, opts.delayMs ?? AUTOSAVE_DELAY_MS);
}

/** Text für die Statuszeile: wann automatisch gespeichert wurde – oder warum nicht. */
export function autosaveLabel(at: number | undefined, error: string | undefined, storeAvailable: boolean, blocked?: string | undefined): string | undefined {
  if (!storeAvailable) return 'Automatisches Speichern nicht möglich – bitte „Als Datei …“ speichern';
  if (blocked !== undefined) return blocked;
  if (error !== undefined) return `Automatisches Speichern fehlgeschlagen: ${error}`;
  if (at === undefined) return undefined;
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `Automatisch gespeichert ${hh}:${mm}:${ss}`;
}

/**
 * Beim Schließen/Neuladen warnen? Nur wenn es etwas zu verlieren gibt UND das automatische Speichern nicht
 * greift (Browser-Speicher gesperrt/voll). Sonst nervt die Abfrage, weil die Arbeit ohnehin gesichert ist.
 */
export function shouldGuardUnload(storeAvailable: boolean, autosaveError: string | undefined, content: boolean): boolean {
  return content && (!storeAvailable || autosaveError !== undefined);
}

/**
 * Wiederaufnahme anbieten? Nur direkt nach dem Laden (`untouched`) und nur, wenn etwas gespeichert ist. Sobald
 * der Nutzer selbst etwas ändert, verschwindet das Angebot – die eigene Arbeit hat Vorrang.
 */
export function resumeOffer(stored: { readonly name: string; readonly savedAt: string } | undefined, untouched: boolean): boolean {
  return stored !== undefined && untouched;
}

/** Text des Wiederaufnahme-Hinweises. */
export function resumeLabel(stored: { readonly name: string; readonly savedAt: string }): string {
  const d = stored.savedAt === '' ? undefined : new Date(stored.savedAt);
  const when = d !== undefined && !Number.isNaN(d.getTime()) ? ` (${d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })})` : '';
  return `Zuletzt im Browser gespeichert: „${stored.name}“${when}`;
}

/** Rückfrage nötig, bevor ein neues Projekt das aktuelle ersetzt? */
export function needsReplaceConfirm(state: ProjectState): boolean {
  return hasContent(state);
}

/**
 * Rückfrage vor dem Ersetzen – Titel und Text, oder `undefined`, wenn nichts verloren gehen kann.
 *
 * - Das aktuelle Projekt hat Inhalt: wie bisher („Aktuelles Projekt ersetzen?“, Rückgängig holt es zurück).
 * - Neu (W1, Einbettung): Das aktuelle Projekt ist leer, aber im Browser liegt noch ein **nicht fortgesetzter** Stand
 *   (`pendingStored`: Angebot „Fortsetzen“ offen). Das neue Projekt würde ihn beim automatischen Speichern
 *   überschreiben, und Rückgängig führt nur zum leeren Startprojekt zurück – also fragen. Kommt jemand über die
 *   Website mit einer Beschreibung herein, geht so kein alter Stand ungefragt verloren.
 */
export function replaceConfirm(
  state: ProjectState,
  pendingStored: { readonly name: string; readonly savedAt: string } | undefined,
  formatDate: (iso: string) => string,
): { readonly title: string; readonly body: string } | undefined {
  if (needsReplaceConfirm(state)) {
    return {
      title: 'Aktuelles Projekt ersetzen?',
      body: 'Die aktuelle Arbeit wird durch das neue Projekt ersetzt. Der Stand ist automatisch im Browser gespeichert und lässt sich mit Rückgängig zurückholen.',
    };
  }
  if (pendingStored === undefined) return undefined;
  const when = pendingStored.savedAt === '' ? '' : formatDate(pendingStored.savedAt);
  return {
    title: 'Gespeichertes Projekt ersetzen?',
    body: `Im Browser liegt noch „${pendingStored.name}“${when !== '' ? ` (gespeichert ${when})` : ''}. Das neue Projekt wird automatisch gespeichert und ersetzt diesen Stand. Zum Behalten „Behalten“ wählen, dann „Fortsetzen“ und das Projekt als Datei sichern.`,
  };
}

/** Text der Rückfrage: was mit der Etage verschwindet. */
export function floorRemovalText(state: ProjectState, index: number, floorName: (i: number) => string): string {
  const rooms = state.rooms.filter((r) => r.floorIndex === index);
  const ids = new Set(rooms.map((r) => r.id));
  const items = state.placements.filter((p) => ids.has(p.roomId)).length;
  const stairs = state.links.filter((l) => l.floorIndex === index || l.floorIndex + 1 === index).length;
  const parts = [`${rooms.length} ${rooms.length === 1 ? 'Raum' : 'Räumen'}`, `${items} ${items === 1 ? 'Möbel' : 'Möbeln'}`];
  if (stairs > 0) parts.push(`${stairs} ${stairs === 1 ? 'Treppe' : 'Treppen'}`);
  return `${floorName(index)} wird samt ${parts.join(', ')} entfernt. Rückgängig holt die Etage zurück.`;
}
