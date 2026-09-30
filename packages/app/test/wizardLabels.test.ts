/**
 * W8-F: Auswahlfelder des Bautyp-Assistenten haben je ein eigenes <label for> (nicht umschließend). Vorher umschloss
 * das Label das <select>, sein Text enthielt alle Optionen: „Palette … Ohne Palette (Themefarben)“ passte auch auf
 * „Theme“, die Suche nach dem Feld „Theme“ fand zwei Auswahlfelder.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const code = readFileSync(new URL('../src/ui/BuildingTypeWizard.tsx', import.meta.url), 'utf8');

/** Öffnende <label>-Tags vor einem <select>, die bis dahin nicht geschlossen sind (= umschließendes Label). */
function wrappedSelects(src: string): number[] {
  const out: number[] = [];
  for (const m of src.matchAll(/<select\b/g)) {
    const before = src.slice(0, m.index);
    if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) out.push(before.split('\n').length);
  }
  return out;
}

describe('W8-F: Bautyp-Assistent – eindeutige Beschriftung der Auswahlfelder', () => {
  it('kein Label umschließt ein Auswahlfeld; jedes Feld hat eine id mit passendem htmlFor', () => {
    expect(wrappedSelects(code)).toEqual([]);
    const ids = [...code.matchAll(/<select\s+id=\{`\$\{fieldId\}-(\w+)`\}/g)].map((m) => m[1]!);
    const fors = [...code.matchAll(/<label htmlFor=\{`\$\{fieldId\}-(\w+)`\}>([^<]+)<\/label>/g)].map((m) => [m[1]!, m[2]!] as const);
    expect(ids.sort()).toEqual(['floors', 'palette', 'theme']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.fromEntries(fors)).toEqual({ floors: 'Etagen', theme: 'Stil', palette: 'Farbwelt' });
    expect((code.match(/<select\b/g) ?? []).length).toBe(3); // genau ein Theme-Feld
    expect(code).toMatch(/const fieldId = useId\(\)/); // ids je Dialog eindeutig
  });

  it('der Prüfer erkennt das alte Muster', () => {
    expect(wrappedSelects('<label className="param">\n<span>Theme</span>\n<select value={x}>')).toEqual([3]);
    expect(wrappedSelects('<label htmlFor="a">Theme</label>\n<select id="a">')).toEqual([]);
  });
});
