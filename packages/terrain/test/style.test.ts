import { describe, expect, it } from 'vitest';
import { lightEveryFor, parseTerrainStyle, validateTerrainStyle } from '../src/index.js';

describe('Geländestil: Schema und fachliche Prüfung', () => {
  it('liest JSON5 mit Kommentaren', () => {
    const r = parseTerrainStyle('// Test\n{ id: "flat", name: "Flach", relief: { amplitude: 0, scale: 10 } }');
    expect(r.ok).toBe(true);
  });

  it('lehnt unbekannte Felder, falsche Bereiche und Baumlisten ohne Gewicht ab', () => {
    const bad = [
      { id: 'x', name: 'X', relief: { amplitude: 2, scale: 10 }, colour: 'red' },
      { id: 'x', name: 'X', relief: { amplitude: 40, scale: 10 } },
      { id: 'X!', name: 'X', relief: { amplitude: 1, scale: 10 } },
      { id: 'x', name: 'X', relief: { amplitude: 1, scale: 10 }, vegetation: { trees: { spacing: 6, density: 0.5, species: { palm: 1 } } } },
      { id: 'x', name: 'X', relief: { amplitude: 1, scale: 10 }, vegetation: { trees: { spacing: 6, density: 0.5, species: { oak: 0 } } } },
    ];
    for (const b of bad) expect(validateTerrainStyle(b).ok, JSON.stringify(b)).toBe(false);
    const broken = parseTerrainStyle('{ id: "x", ', 'kaputt.json5');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors[0]).toMatch(/kaputt\.json5: JSON5-Fehler/);
  });

  it('Streuungsregeln (research/30 K6): threshold und keepFree sind gültig, Unfug wird abgelehnt', () => {
    const base = { id: 'x', name: 'X', relief: { amplitude: 1, scale: 10 } };
    const ok = validateTerrainStyle({
      ...base,
      vegetation: {
        trees: { spacing: 6, density: 0.5, threshold: 0.3, species: { oak: 1 } },
        bushes: { spacing: 4, density: 0.4, threshold: 0.2, foundationThreshold: 0.1 },
        ground: { spacing: 2, density: 0.5, threshold: 0.25 },
        keepFree: [{ along: 'path', distance: 1 }, { around: 'door', distance: 2 }, { along: 'pad', distance: 0 }],
      },
    });
    expect(ok.ok, JSON.stringify(!ok.ok && ok.errors)).toBe(true);
    const bad = [
      { ...base, vegetation: { trees: { spacing: 6, density: 0.5, threshold: 2, species: { oak: 1 } } } },
      { ...base, vegetation: { keepFree: [{ along: 'weg', distance: 1 }] } },
      { ...base, vegetation: { keepFree: [{ around: 'door', distance: 99 }] } },
      { ...base, vegetation: { keepFree: [{ along: 'path' }] } },
      { ...base, vegetation: { keepFree: [{ along: 'path', distance: 1, extra: true }] } },
    ];
    for (const b of bad) expect(validateTerrainStyle(b).ok, JSON.stringify(b)).toBe(false);
  });

  it('warnt bei sehr steilem Relief', () => {
    const r = validateTerrainStyle({ id: 'x', name: 'X', relief: { amplitude: 8, scale: 6 } });
    expect(r.ok && r.warnings.length).toBe(1);
  });
});

describe('Lampen-Takt je Rang (research/44 §4.1)', () => {
  it('Zahl gilt für alle, Objekt je Rang; Pfad ohne Licht ist erlaubt', () => {
    expect(lightEveryFor(8, 3)).toBe(8);
    expect(lightEveryFor({ main: 8, side: 12 }, 3)).toBe(8);
    expect(lightEveryFor({ main: 8, side: 12 }, 2)).toBe(12);
    expect(lightEveryFor({ main: 8, side: 12 }, 1)).toBe(8); // Pfad ohne eigenen Wert → wie Hauptweg
    expect(lightEveryFor({ main: 8, path: 0 }, 1)).toBe(0); // 0 = keine Lampe auf diesem Rang
    expect(lightEveryFor({ side: 12 }, 3)).toBe(10); // ohne main gilt der Standard
  });

  it('Schema nimmt Takt-Objekte an und lehnt Unfug ab', () => {
    const base = { id: 'x', name: 'X', relief: { amplitude: 1, scale: 10 } };
    expect(validateTerrainStyle({ ...base, lighting: { mode: 'paths', every: { main: 8, side: 12 } } }).ok).toBe(true);
    expect(validateTerrainStyle({ ...base, lighting: { mode: 'paths', every: { path: 0 } } }).ok).toBe(true);
    expect(validateTerrainStyle({ ...base, lighting: { mode: 'paths', every: 4 } }).ok).toBe(false);
    expect(validateTerrainStyle({ ...base, lighting: { mode: 'paths', every: { side: 99 } } }).ok).toBe(false);
  });
});
