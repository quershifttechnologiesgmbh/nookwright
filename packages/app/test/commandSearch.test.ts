/**
 * W7-G (U8): Befehlssuche über die Heimat-Tabelle – die Suche findet jede Einstellung (jeden Eintrag mit eigenem Ort)
 * unter ihrer Beschriftung, Zusammenlegungen unter ihrem früheren Namen, und jedes Tastenkürzel ist ausführbar.
 */
import { describe, expect, it } from 'vitest';
import { CONTROL_HOMES } from '../src/ui/controlHomes.js';
import { commandItems, normalizeText, searchCommands } from '../src/ui/commandSearch.js';
import { findText } from '../src/ui/flashControl.js';
import { SHORTCUTS, commandForKey } from '../src/ui/shortcuts.js';

const items = commandItems();
const ids = (q: string, limit = 9) => searchCommands(items, q, limit).map((i) => i.id);

describe('Befehlssuche (Strg+K)', () => {
  it('jede Einstellung der Heimat-Tabelle hat einen Eintrag und wird unter ihrer Beschriftung gefunden', () => {
    const placed = Object.entries(CONTROL_HOMES).filter(([, c]) => 'home' in c).map(([id]) => id);
    expect(placed.filter((id) => !items.some((i) => i.id === id))).toEqual([]);
    const missing = placed.filter((id) => !ids(items.find((i) => i.id === id)!.label).includes(id));
    expect(missing).toEqual([]);
  });

  it('Zusammenlegungen findet man unter dem früheren Namen (z. B. Theme → Stil)', () => {
    for (const [id, c] of Object.entries(CONTROL_HOMES)) {
      if (!('merged' in c)) continue;
      const word = /„([^“]+)“/.exec(c.before)?.[1];
      if (word === undefined) continue;
      expect(ids(word, 12), `${id}: ${word}`).toContain(c.merged);
    }
    expect(ids('Theme')[0]).toBe('project.theme');
  });

  it('Profi-Suchen: zusammengesetzte Wörter über Ort und Beschriftung, Umlaute egal', () => {
    expect(ids('Dachüberstand')[0]).toBe('roof.overhang');
    expect(ids('dachueberstand')[0]).toBe('roof.overhang');
    expect(ids('Mittelgang')[0]).toBe('building.minAisle');
    expect(ids('gauben breite')[0]).toBe('roof.dormerWidth');
    expect(ids('Möbel ziehen')).toContain('placement.drag');
    expect(ids('Kante ziehen')).toContain('room.resize');
    // feat/underground: Unterbau-Schalter im Dialog „Bautyp anpassen“
    expect(ids('Keller & Gewölbe')[0]).toBe('type.underground');
    expect(ids('gewoelbe')[0]).toBe('type.underground');
    expect(ids('Dungeon')).toContain('type.underground');
    expect(ids('Rundgänge')[0]).toBe('building.loopDoors');
    expect(ids('Zusatztür')).toContain('building.loopDoors');
    expect(ids('xyzzy')).toEqual([]);
    expect(normalizeText('Überstand Äpfel ß')).toBe('uberstandapfelss');
  });

  it('jedes Tastenkürzel ist als Befehl ausführbar (außer Richtungstasten, Esc und der Suche selbst)', () => {
    const skip = new Set(['placement.left', 'placement.right', 'placement.up', 'placement.down', 'escape', 'palette']);
    for (const s of SHORTCUTS) {
      if (skip.has(s.command)) continue;
      expect(items.some((i) => i.command === s.command), s.command).toBe(true);
    }
    expect(items.every((i) => i.command !== undefined || i.home !== undefined)).toBe(true);
    // Strg+K öffnet die Suche (auch Cmd+K)
    expect(commandForKey({ key: 'k', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBe('palette');
    expect(commandForKey({ key: 'k', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false })).toBe('palette');
  });

  it('leere Eingabe zeigt häufige Einträge; Suchtext für das Hervorheben', () => {
    expect(searchCommands(items, '').length).toBeGreaterThan(5);
    expect(findText('aria-label="Etagen"')).toBe('Etagen');
    expect(findText('TIME_PRESETS')).toBeUndefined();
    expect(findText("'Seed'")).toBe('Seed');
    expect(findText('Möbel (')).toBe('Möbel');
  });
});
