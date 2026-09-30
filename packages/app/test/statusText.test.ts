/** W8-F: Statusleiste ohne schwankende Laufzeit; die Dauer steht nur im Tooltip. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { durationTitle, previewStatsText } from '../src/ui/statusText.js';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

describe('W8-F: Laufzeit nicht im sichtbaren Status', () => {
  it('Vorschau-Zeile: gleiche Eingabe → gleicher Text, keine „ms“', () => {
    const r = { blocks: 2083, themeName: 'Mittelalter', version: '1.21.11', darkCells: 0 };
    expect(previewStatsText(r)).toBe('2083 Blöcke · Mittelalter · Minecraft 1.21.11 · keine dunklen Stellen');
    expect(previewStatsText({ ...r, darkCells: 3 })).toBe('2083 Blöcke · Mittelalter · Minecraft 1.21.11 · 3 dunkle Zellen');
    expect(previewStatsText(r)).not.toMatch(/\d\s*ms\b/);
    expect(durationTitle('Dauer der Vorschau', 233.6)).toBe('Dauer der Vorschau: 234 ms');
    expect(durationTitle('Dauer der Vorschau', undefined)).toBeUndefined();
  });

  it('keine Laufzeit in sichtbaren Status-Texten von Editor und Umgebung (nur im Tooltip)', () => {
    for (const f of ['App.tsx', 'ui/SurroundingsPanel.tsx']) {
      const code = src(f);
      expect(code, f).not.toMatch(/`[^`]*\$\{[^}]*\}\s*ms[^`]*`/); // Vorlagen-Text mit „${…} ms“
      expect(code, f).not.toMatch(/Math\.round\([^)]*ms\)\}\s*ms/);
    }
  });
});
