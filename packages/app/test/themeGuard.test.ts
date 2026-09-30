/**
 * Regression aus dem Review: Eine Projektdatei mit unbekanntem Theme ließ die App schwarz werden, weil das
 * Theme ungeprüft aus dem Katalog geholt wurde. `shellThemeOf` prüft die ID – hier festgehalten.
 */
import { describe, expect, it } from 'vitest';
import { loadBundledCatalog } from '../src/adapters/browserContext.js';
import { shellThemeOf } from '../src/usecases.js';

const catalog = loadBundledCatalog().catalog!;

describe('Unbekanntes Theme in einer Projektdatei', () => {
  it('liefert undefined statt zu werfen (Grundlage für die Fehlermeldung statt schwarzem Bildschirm)', () => {
    expect(shellThemeOf(catalog, 'gibtsnicht')).toBeUndefined();
    expect(shellThemeOf(catalog, '99.9')).toBeUndefined();
    expect(shellThemeOf(catalog, '')).toBeUndefined();
    expect(shellThemeOf(undefined, 'medieval')).toBeUndefined();
  });

  it('löst bekannte Themes weiterhin auf', () => {
    expect(shellThemeOf(catalog, 'medieval')?.id).toBe('medieval');
    expect(shellThemeOf(catalog, 'winter')?.id).toBe('winter');
  });
});
