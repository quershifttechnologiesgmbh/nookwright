/**
 * Katalogtext für den Build (W7-H): Vite bündelt die Katalogdateien (`catalog/**∕*.json5`) als Text, den der Lader
 * (`catalogLoader.ts` → `parse*Def` → `JSON5.parse`) beim Start liest. Im Build (`vite.config.ts`, Plugin
 * `mcda-compact-catalog`) wird jede Datei vorher auf kompaktes JSON gebracht: ohne Kommentare und Einrückung ist der
 * Text etwa halb so groß (1 003 → 546 KiB) und der JSON5-Parser beim Start entsprechend schneller.
 *
 * Verhalten bleibt gleich: JSON ist gültiges JSON5, und der kompakte Text wird nur genommen, wenn er denselben Wert
 * ergibt (sonst der Originaltext). Unlesbare Dateien bleiben unverändert, damit der Lader dieselbe Fehlermeldung
 * (mit Zeile und Spalte) ausgibt wie im Dev-Server. Rein: kein I/O.
 */
import JSON5 from 'json5';

/** Gleicher Wert wie aus JSON5 gelesen (Zahlen per `Object.is`: `-0`, `NaN` und `±Infinity` überleben JSON nicht). */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    const k = ka[i]!;
    // gleiche Schlüsselreihenfolge: Validatoren und Meldungen folgen ihr
    if (k !== kb[i] || !sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** JSON5-Text → kompaktes JSON mit demselben Wert; sonst (Lesefehler, nicht darstellbarer Wert) der Text selbst. */
export function compactJson5(text: string): string {
  let value: unknown;
  try {
    value = JSON5.parse(text);
  } catch {
    return text;
  }
  const json = JSON.stringify(value);
  if (json === undefined || json.length >= text.length) return text;
  return sameValue(JSON5.parse(json), value) ? json : text;
}

/** Modul-ID eines Katalogtexts (`…/catalog/…/x.json5?raw`) unter `catalogDir` (absolut, mit `/` am Ende). */
export function isCatalogTextId(id: string, catalogDir: string): boolean {
  const q = id.indexOf('?');
  if (q < 0) return false;
  const path = id.slice(0, q).replaceAll('\\', '/');
  const dir = catalogDir.replaceAll('\\', '/');
  return path.startsWith(dir) && path.endsWith('.json5') && new URLSearchParams(id.slice(q + 1)).has('raw');
}
