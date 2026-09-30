/** Tastenkürzel: eine Tabelle für Tastatur und Hilfe – eindeutig, vollständig, Eingabefelder ausgenommen. */
import { describe, expect, it } from 'vitest';
import { SITE_TOOL_FOR_COMMAND } from '../src/editor/siteGrid.js';
import {
  HELP_GROUPS, HELP_SHORTCUTS, PLACING_SHORTCUTS, SHORTCUTS, SHORTCUT_GROUPS, SITE_SHORTCUTS, commandForKey, isTypingTarget, shortcutHint, shortcutSwallowed, sliderOwnsKey, type KeyLike,
} from '../src/ui/shortcuts.js';

const key = (k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('Tastenkürzel', () => {
  it('Pflichtkürzel: M/E/S, R, Umschalt+R, Entf, Strg+Z/Y, ?, Esc', () => {
    expect(commandForKey(key('m'))).toBe('tool.paint');
    expect(commandForKey(key('M', { shiftKey: false }))).toBe('tool.paint'); // Feststelltaste
    expect(commandForKey(key('e'))).toBe('tool.erase');
    expect(commandForKey(key('s'))).toBe('tool.select');
    expect(commandForKey(key('r'))).toBe('room.reroll');
    expect(commandForKey(key('R', { shiftKey: true }))).toBe('room.rerollAll');
    expect(commandForKey(key('Delete'))).toBe('room.delete');
    expect(commandForKey(key('z', { ctrlKey: true }))).toBe('undo');
    expect(commandForKey(key('z', { metaKey: true }))).toBe('undo'); // macOS
    expect(commandForKey(key('y', { ctrlKey: true }))).toBe('redo');
    expect(commandForKey(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(commandForKey(key('s', { ctrlKey: true }))).toBe('save');
    expect(commandForKey(key('?', { shiftKey: true }))).toBe('help'); // deutsche Tastatur: Umschalt+ß
    expect(commandForKey(key('Escape'))).toBe('escape');
    expect(commandForKey(key('PageUp'))).toBe('floor.up');
  });

  it('nicht belegt: Alt-Kombinationen, Strg+R/F/P (Browser), unbekannte Tasten', () => {
    expect(commandForKey(key('m', { altKey: true }))).toBeUndefined();
    expect(commandForKey(key('r', { ctrlKey: true }))).toBeUndefined();
    expect(commandForKey(key('f', { ctrlKey: true }))).toBeUndefined();
    expect(commandForKey(key('p', { ctrlKey: true }))).toBeUndefined();
    expect(commandForKey(key('j'))).toBeUndefined();
    // W2-ED U5: Q dreht das gewählte Möbel, Pfeiltasten verschieben es
    expect(commandForKey(key('q'))).toBe('placement.rotate');
    expect(commandForKey(key('ArrowLeft'))).toBe('placement.left');
  });

  it('jede Taste ist eindeutig und jedes Kürzel erreichbar; jede Gruppe hat Einträge', () => {
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS) {
      expect(s.keys.length, s.command).toBeGreaterThan(0);
      expect(s.display.length, s.command).toBeGreaterThan(0);
      for (const spec of s.keys) {
        const id = `${spec.ctrl === true ? 'C-' : ''}${spec.shift === true ? 'S-' : ''}${spec.key}`;
        expect(seen.has(id), `${id} doppelt (${seen.get(id)} und ${s.command})`).toBe(false);
        seen.set(id, s.command);
        expect(commandForKey(key(spec.key, { ctrlKey: spec.ctrl === true, shiftKey: spec.shift === true }))).toBe(s.command);
      }
    }
    expect(new Set(SHORTCUTS.map((s) => s.command)).size).toBe(SHORTCUTS.length);
    for (const g of SHORTCUT_GROUPS) expect(SHORTCUTS.some((s) => s.group === g), g).toBe(true);
  });

  it('Text- und Auswahlfelder schlucken Kürzel, Regler und Häkchen nicht; Anzeige für Tooltips', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'range' })).toBe(false); // Schnitt-Regler: R, F … wirken weiter
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'select' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'CANVAS' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    // Regler: Pfeile gehören dem Regler (Stimmung, Außen-Dichte), Buchstaben-Kürzel wirken weiter
    const range = { tagName: 'INPUT', type: 'range' };
    const key = (k: string) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
    const arrowCmd = commandForKey(key('ArrowRight'));
    expect(arrowCmd).toBeDefined();
    expect(shortcutSwallowed(arrowCmd!, key('ArrowRight'), range)).toBe(true);
    const letter = commandForKey(key('r'));
    if (letter !== undefined) expect(shortcutSwallowed(letter, key('r'), range)).toBe(false);
    expect(shortcutHint('undo')).toBe('Strg+Z');
    expect(shortcutHint('room.rerollAll')).toBe('Umschalt+R');
  });

  it('W8-D: Strg+K gilt auch im Auswahl- und Textfeld; im Auswahlfeld alle Strg-Kürzel, Buchstaben nicht', () => {
    const ctrlK = key('k', { ctrlKey: true });
    expect(commandForKey(ctrlK)).toBe('palette');
    for (const t of [{ tagName: 'SELECT' }, { tagName: 'INPUT', type: 'text' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }, null]) {
      expect(shortcutSwallowed('palette', ctrlK, t), JSON.stringify(t)).toBe(false);
    }
    expect(shortcutSwallowed('palette', key('k', { metaKey: true }), { tagName: 'SELECT' })).toBe(false); // Mac: Cmd+K
    expect(shortcutSwallowed('undo', key('z', { ctrlKey: true }), { tagName: 'SELECT' })).toBe(false);
    expect(shortcutSwallowed('undo', key('z', { ctrlKey: true }), { tagName: 'INPUT', type: 'text' })).toBe(true); // Text-Undo
    expect(shortcutSwallowed(commandForKey(key('m'))!, key('m'), { tagName: 'SELECT' })).toBe(true); // Tippauswahl
    expect(shortcutSwallowed(commandForKey(key('m'))!, key('m'), { tagName: 'CANVAS' })).toBe(false);
  });

  it('W8-F: Pfeile und Pos1/Ende bedienen den fokussierten Schieberegler, Buchstaben und Strg-Kürzel nicht', () => {
    const range = { tagName: 'INPUT', type: 'range' };
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const cmd = commandForKey(key(k));
      expect(cmd, k).toMatch(/^placement\./);
      expect(shortcutSwallowed(cmd!, key(k), range), k).toBe(true);
      expect(shortcutSwallowed(cmd!, key(k), { tagName: 'CANVAS' }), k).toBe(false); // Möbel verschieben bleibt
      expect(shortcutSwallowed(cmd!, key(k), { tagName: 'INPUT', type: 'number' }), k).toBe(true); // Zahlenfeld
    }
    for (const k of ['Home', 'End', 'PageUp', 'PageDown']) expect(sliderOwnsKey(key(k), range), k).toBe(true);
    expect(shortcutSwallowed(commandForKey(key('r'))!, key('r'), range)).toBe(false); // R wirkt weiter
    expect(shortcutSwallowed('undo', key('z', { ctrlKey: true }), range)).toBe(false);
    expect(sliderOwnsKey(key('ArrowLeft', { ctrlKey: true }), range)).toBe(false);
    expect(sliderOwnsKey(key('ArrowLeft'), { tagName: 'INPUT', type: 'checkbox' })).toBe(false);
  });
});

describe('Tastenkürzel im Modus Umgebung (Hilfe-Abschnitt „Umgebung“)', () => {
  it('jede Taste liefert den Befehl ihrer Zeile – Haus-Tasten gleich, eigene Tasten im Haus frei', () => {
    const house = new Set(SHORTCUTS.flatMap((s) => s.keys.map((k) => `${k.ctrl === true ? 'C-' : ''}${k.shift === true ? 'S-' : ''}${k.key}`)));
    const seen = new Set<string>();
    for (const s of SITE_SHORTCUTS) {
      expect(s.group).toBe('Umgebung');
      for (const spec of s.keys) {
        const id = `${spec.ctrl === true ? 'C-' : ''}${spec.shift === true ? 'S-' : ''}${spec.key}`;
        expect(seen.has(id), `${id} doppelt`).toBe(false);
        seen.add(id);
        expect(commandForKey(key(spec.key, { ctrlKey: spec.ctrl === true, shiftKey: spec.shift === true })), s.command).toBe(s.command);
        // eigene Befehle (site.*) nur auf Tasten, die im Haus frei sind
        if (s.command.startsWith('site.')) expect(house.has(id), `${id} im Haus belegt`).toBe(false);
      }
    }
    expect(new Set(SITE_SHORTCUTS.map((s) => s.command)).size).toBe(SITE_SHORTCUTS.length);
  });

  it('M Zone, E Formen, S Auswählen, T Turm, R neu würfeln, Entf; eigene Tasten für Mauer, Tor, Windmühle, Weg, Glätten', () => {
    expect(commandForKey(key('w'))).toBe('site.wall');
    expect(commandForKey(key('o'))).toBe('site.gate');
    expect(commandForKey(key('u'))).toBe('site.windmill');
    expect(commandForKey(key('p'))).toBe('site.path');
    expect(commandForKey(key('E', { shiftKey: true }))).toBe('site.smooth');
    expect(commandForKey(key('e'))).toBe('tool.erase'); // ohne Umschalt weiter Formen/Radieren
    expect(commandForKey(key('p', { ctrlKey: true }))).toBeUndefined(); // Strg+P bleibt dem Browser
    // Werkzeuge der Leiste folgen derselben Tabelle
    expect(SITE_TOOL_FOR_COMMAND['tool.paint']).toBe('zone');
    expect(SITE_TOOL_FOR_COMMAND['tool.erase']).toBe('sculpt');
    expect(SITE_TOOL_FOR_COMMAND['tool.select']).toBe('select');
    expect(SITE_TOOL_FOR_COMMAND['tool.stairs']).toBe('tower');
    expect(SITE_TOOL_FOR_COMMAND['site.wall']).toBe('wall');
    expect(SITE_TOOL_FOR_COMMAND['site.gate']).toBe('gate');
    expect(SITE_TOOL_FOR_COMMAND['site.windmill']).toBe('windmill');
    for (const command of Object.keys(SITE_TOOL_FOR_COMMAND)) expect(SITE_SHORTCUTS.some((s) => s.command === command), command).toBe(true);
    expect(shortcutHint('site.smooth')).toBe('Umschalt+E');
    expect(shortcutHint('site.wall')).toBe('W');
  });

  it('die Hilfe zeigt alle Gruppen aus EINER Tabelle, jede Gruppe mit Einträgen', () => {
    expect(HELP_GROUPS).toEqual([...SHORTCUT_GROUPS, 'Treppe setzen', 'Umgebung']);
    expect(HELP_SHORTCUTS).toEqual([...SHORTCUTS, ...PLACING_SHORTCUTS, ...SITE_SHORTCUTS]);
    for (const g of HELP_GROUPS) expect(HELP_SHORTCUTS.some((s) => s.group === g), g).toBe(true);
    expect(SITE_SHORTCUTS.map((s) => s.display.join('+'))).toEqual(['S', 'M', 'P', 'E', 'Umschalt+E', 'W', 'O', 'T', 'U', 'R', 'Entf', 'Esc']);
  });
});
