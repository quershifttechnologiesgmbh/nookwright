/**
 * Browser-Adapter für den Port `KeyValueStore` (projectFile.ts): `window.localStorage`.
 * Schon der Zugriff kann werfen (gesperrte Cookies, manche privaten Fenster) → dann `undefined`,
 * die App bietet weiter „Als Datei speichern/öffnen“ an.
 */
import type { KeyValueStore } from '../projectFile.js';

export function browserStore(): KeyValueStore | undefined {
  try {
    const ls = globalThis.localStorage;
    if (ls === undefined || ls === null) return undefined;
    const probe = '__basen-generator-probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return undefined;
  }
}

