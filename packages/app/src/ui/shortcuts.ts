/**
 * Tastenkürzel als Daten (rein, testbar): eine Tabelle für den Tastatur-Handler UND die Hilfe (`?`).
 * Grundsätze nach research/13 §2.3: einfache Buchstaben wie in Blender/Axiom, Strg-Kürzel nur, wo der Browser sie
 * nicht braucht (Strg+Z/Y/S werden abgefangen, Strg+R/F/P bleiben dem Browser).
 */

export type Command =
  | 'tool.paint' | 'tool.erase' | 'tool.select' | 'tool.stairs'
  | 'stairs.rotate' | 'stairs.mirror'
  | 'room.reroll' | 'room.rerollAll' | 'room.delete' | 'placement.lock'
  | 'placement.left' | 'placement.right' | 'placement.up' | 'placement.down' | 'placement.rotate'
  | 'undo' | 'redo' | 'save'
  | 'view.full' | 'view.noRoof' | 'view.floorOnly' | 'preview.cycle' | 'layout.cycle' | 'camera.fit' | 'light.dayNight'
  | 'floor.up' | 'floor.down'
  | 'help' | 'escape' | 'palette'
  | 'site.wall' | 'site.gate' | 'site.windmill' | 'site.path' | 'site.smooth';

export interface KeySpec {
  /** `KeyboardEvent.key`, Buchstaben klein */
  readonly key: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
}

export type ShortcutGroup = 'Werkzeuge' | 'Raum' | 'Ansicht' | 'Projekt' | 'Treppe setzen' | 'Umgebung';

export interface Shortcut {
  readonly command: Command;
  readonly group: ShortcutGroup;
  readonly label: string;
  /** Anzeige in der Hilfe, z. B. ['Strg', 'Z'] */
  readonly display: readonly string[];
  readonly keys: readonly KeySpec[];
}

const k = (key: string, mods: { ctrl?: boolean; shift?: boolean } = {}): KeySpec => ({ key, ...mods });

export const SHORTCUTS: readonly Shortcut[] = [
  { command: 'tool.paint', group: 'Werkzeuge', label: 'Malen: Rechteck aufziehen = neuer Raum', display: ['M'], keys: [k('m')] },
  { command: 'tool.erase', group: 'Werkzeuge', label: 'Radieren (rechte Maustaste radiert immer)', display: ['E'], keys: [k('e')] },
  { command: 'tool.select', group: 'Werkzeuge', label: 'Auswählen', display: ['S'], keys: [k('s')] },
  { command: 'tool.stairs', group: 'Werkzeuge', label: 'Treppe setzen (Klick; rechts entfernt eine Treppe)', display: ['T'], keys: [k('t')] },
  { command: 'room.reroll', group: 'Raum', label: 'Gewählten Raum neu würfeln (gesperrte Möbel bleiben)', display: ['R'], keys: [k('r')] },
  { command: 'room.rerollAll', group: 'Raum', label: 'Alle Räume neu würfeln', display: ['Umschalt', 'R'], keys: [k('r', { shift: true })] },
  { command: 'placement.lock', group: 'Raum', label: 'Gewähltes Möbel sperren / entsperren bzw. gewählten Raum fixieren', display: ['L'], keys: [k('l')] },
  { command: 'room.delete', group: 'Raum', label: 'Gewähltes Möbel bzw. gewählte Treppe entfernen, sonst den Raum löschen', display: ['Entf'], keys: [k('delete')] },
  { command: 'placement.left', group: 'Raum', label: 'Gewähltes Möbel 1 Feld nach Westen (samt aufgesetzten Teilen)', display: ['←'], keys: [k('arrowleft')] },
  { command: 'placement.right', group: 'Raum', label: 'Gewähltes Möbel 1 Feld nach Osten', display: ['→'], keys: [k('arrowright')] },
  { command: 'placement.up', group: 'Raum', label: 'Gewähltes Möbel 1 Feld nach Norden', display: ['↑'], keys: [k('arrowup')] },
  { command: 'placement.down', group: 'Raum', label: 'Gewähltes Möbel 1 Feld nach Süden', display: ['↓'], keys: [k('arrowdown')] },
  { command: 'placement.rotate', group: 'Raum', label: 'Gewähltes Möbel drehen (90° im Uhrzeigersinn)', display: ['Q'], keys: [k('q')] },
  { command: 'escape', group: 'Raum', label: 'Eine Ebene höher (Möbel → Raum → Etage → Haus), Dialog schließen', display: ['Esc'], keys: [k('escape')] },
  { command: 'view.full', group: 'Ansicht', label: 'Komplett', display: ['1'], keys: [k('1')] },
  { command: 'view.noRoof', group: 'Ansicht', label: 'Dach ab', display: ['2'], keys: [k('2')] },
  { command: 'view.floorOnly', group: 'Ansicht', label: 'Wände ab', display: ['3'], keys: [k('3')] },
  { command: 'preview.cycle', group: 'Ansicht', label: 'Darstellung wechseln (Rollen → Blöcke → Texturen)', display: ['V'], keys: [k('v')] },
  { command: 'layout.cycle', group: 'Ansicht', label: 'Grundriss: geteilt → überlagert → nur 3D', display: ['G'], keys: [k('g')] },
  { command: 'camera.fit', group: 'Ansicht', label: 'Kamera einpassen (auch Doppelklick in 3D)', display: ['F'], keys: [k('f')] },
  { command: 'light.dayNight', group: 'Ansicht', label: 'Tag / Nacht (Texturen mit Licht)', display: ['N'], keys: [k('n')] },
  { command: 'floor.up', group: 'Ansicht', label: 'Etage höher', display: ['Bild ↑'], keys: [k('pageup')] },
  { command: 'floor.down', group: 'Ansicht', label: 'Etage tiefer', display: ['Bild ↓'], keys: [k('pagedown')] },
  { command: 'undo', group: 'Projekt', label: 'Rückgängig', display: ['Strg', 'Z'], keys: [k('z', { ctrl: true })] },
  { command: 'redo', group: 'Projekt', label: 'Wiederholen', display: ['Strg', 'Y'], keys: [k('y', { ctrl: true }), k('z', { ctrl: true, shift: true })] },
  { command: 'save', group: 'Projekt', label: 'Im Browser speichern', display: ['Strg', 'S'], keys: [k('s', { ctrl: true })] },
  { command: 'help', group: 'Projekt', label: 'Tastenkürzel anzeigen', display: ['?'], keys: [k('?'), k('?', { shift: true })] },
  { command: 'palette', group: 'Projekt', label: 'Befehlssuche: jede Einstellung und jeden Befehl finden', display: ['Strg', 'K'], keys: [k('k', { ctrl: true })] },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Werkzeuge', 'Raum', 'Ansicht', 'Projekt'];

/**
 * Platzier-Grammatik (research/13 Top 1) im Treppen-Werkzeug: R dreht, F spiegelt (Drehsinn), Esc beendet.
 * Diese Tasten gelten nur, solange das Werkzeug aktiv ist, und gehen dann der Haupttabelle vor
 * (R = sonst Neu würfeln, F = sonst Einpassen).
 */
export const PLACING_SHORTCUTS: readonly Shortcut[] = [
  { command: 'stairs.rotate', group: 'Treppe setzen', label: 'Treppe drehen (Laufrichtung im Uhrzeigersinn)', display: ['R'], keys: [k('r')] },
  { command: 'stairs.mirror', group: 'Treppe setzen', label: 'Drehsinn spiegeln (L-, U-, Wendeltreppe)', display: ['F'], keys: [k('f')] },
];

/**
 * Modus „Umgebung“ (Gelände, Bauwerke): die Haus-Tasten in neuer Bedeutung (gleiche Taste → gleicher Befehl wie in
 * `SHORTCUTS`, den Modus Umgebung deutet ihn um, siehe `SITE_TOOL_FOR_COMMAND`) und eigene Tasten, die im Haus nichts
 * belegen. Mauerzug-Tasten (Enter, Rücktaste, Umschalt) wertet der Plan selbst aus.
 */
export const SITE_SHORTCUTS: readonly Shortcut[] = [
  { command: 'tool.select', group: 'Umgebung', label: 'Auswählen: Klick wählt Bauwerk oder Zone, Ziehen verschiebt ein Bauwerk', display: ['S'], keys: [k('s')] },
  { command: 'tool.paint', group: 'Umgebung', label: 'Zone malen (Feld, Garten, Hof, Teich, Obstgarten, Koppel …)', display: ['M'], keys: [k('m')] },
  { command: 'site.path', group: 'Umgebung', label: 'Weg malen (runder Pinsel)', display: ['P'], keys: [k('p')] },
  { command: 'tool.erase', group: 'Umgebung', label: 'Formen: anheben, absenken, ebnen, natürlich', display: ['E'], keys: [k('e')] },
  { command: 'site.smooth', group: 'Umgebung', label: 'Glätten (runder Pinsel)', display: ['Umschalt', 'E'], keys: [k('e', { shift: true })] },
  { command: 'site.wall', group: 'Umgebung', label: 'Mauer ziehen (Punkte klicken, Enter/Doppelklick beendet, Rücktaste nimmt zurück)', display: ['W'], keys: [k('w')] },
  { command: 'site.gate', group: 'Umgebung', label: 'Tor in eine Mauer setzen', display: ['O'], keys: [k('o')] },
  { command: 'tool.stairs', group: 'Umgebung', label: 'Turm setzen', display: ['T'], keys: [k('t')] },
  { command: 'site.windmill', group: 'Umgebung', label: 'Windmühle setzen', display: ['U'], keys: [k('u')] },
  { command: 'room.reroll', group: 'Umgebung', label: 'Gelände neu würfeln (Zonen und Terraforming bleiben)', display: ['R'], keys: [k('r')] },
  { command: 'room.delete', group: 'Umgebung', label: 'Gewähltes Bauwerk bzw. gewählte Zone entfernen', display: ['Entf'], keys: [k('delete')] },
  { command: 'escape', group: 'Umgebung', label: 'Auswahl aufheben, Mauerzug abbrechen', display: ['Esc'], keys: [k('escape')] },
];

/** Gruppen der Hilfe inklusive Platzier-Modus und Modus Umgebung. */
export const HELP_GROUPS: readonly ShortcutGroup[] = [...SHORTCUT_GROUPS, 'Treppe setzen', 'Umgebung'];

/** Alle Einträge der Hilfe (Haus, Treppe setzen, Umgebung). */
export const HELP_SHORTCUTS: readonly Shortcut[] = [...SHORTCUTS, ...PLACING_SHORTCUTS, ...SITE_SHORTCUTS];

/** Die für die Tabelle relevanten Felder eines `KeyboardEvent`. */
export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

const normalize = (key: string): string => key.toLowerCase();

const matches = (s: KeySpec, e: KeyLike): boolean =>
  s.key === normalize(e.key) && (s.ctrl ?? false) === (e.ctrlKey || e.metaKey) && (s.shift ?? false) === e.shiftKey;

/**
 * Befehl zu einem Tastendruck oder `undefined` (Alt-Kombinationen gehören dem Browser/System).
 * `placing`: Treppen-Werkzeug aktiv – dann gelten zuerst die Platzier-Tasten (R dreht, F spiegelt).
 * Eigene Tasten des Modus Umgebung (W, O, U, P, Umschalt+E) sind im Haus frei und liefern immer ihren Befehl;
 * der Haus-Modus ignoriert ihn.
 */
export function commandForKey(e: KeyLike, mode: { readonly placing?: boolean } = {}): Command | undefined {
  if (e.altKey) return undefined;
  const find = (table: readonly Shortcut[]): Command | undefined => table.find((s) => s.keys.some((spec) => matches(spec, e)))?.command;
  return (mode.placing === true ? find(PLACING_SHORTCUTS) : undefined) ?? find(SHORTCUTS) ?? find(SITE_SHORTCUTS);
}

/** Eingabetypen, in die man tippt (Regler, Häkchen und Knöpfe schlucken keine Buchstaben). */
const TEXT_INPUTS = new Set(['', 'text', 'search', 'number', 'email', 'password', 'url', 'tel']);


/** Tastendruck in einem Text- oder Auswahlfeld: dort gelten die Kürzel nicht. */
export function isTypingTarget(target: { readonly tagName?: string; readonly type?: string; readonly isContentEditable?: boolean } | null): boolean {
  if (target === null) return false;
  const tag = (target.tagName ?? '').toUpperCase();
  if (tag === 'INPUT') return TEXT_INPUTS.has((target.type ?? '').toLowerCase());
  return tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

/** Tasten, mit denen ein Schieberegler (`input[type=range]`) seinen Wert ändert. */
const SLIDER_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'pageup', 'pagedown']);

/**
 * W8-F: Pfeile, Pos1/Ende und Bild↑/↓ ohne Strg/Alt gehören dem fokussierten Schieberegler (z. B. Dichte der
 * Außen-Deko); vorher verschoben `placement.*` das Möbel und `preventDefault` hielt den Regler fest. Buchstaben (R, F …)
 * und Strg-Kürzel wirken im Regler weiter, er tippt keine Zeichen.
 */
export function sliderOwnsKey(e: KeyLike, target: { readonly tagName?: string; readonly type?: string } | null): boolean {
  if (target === null || (target.tagName ?? '').toUpperCase() !== 'INPUT' || (target.type ?? '').toLowerCase() !== 'range') return false;
  return !e.ctrlKey && !e.metaKey && !e.altKey && SLIDER_KEYS.has(e.key.toLowerCase());
}

/**
 * W8-D: Gilt der Befehl trotz Fokus in einem Feld? Die Befehlssuche (Strg+K) gilt überall – ein Textfeld kennt Strg+K
 * nicht, und nach einem Sprung der Befehlssuche steht der Fokus in einem Auswahlfeld. In einem Auswahlfeld gelten
 * außerdem alle Strg-Kürzel (es nutzt nur Buchstaben und Pfeile zur Auswahl). Sonst schluckt ein Tippfeld die Kürzel.
 */
export function shortcutSwallowed(
  cmd: Command, e: KeyLike, target: { readonly tagName?: string; readonly type?: string; readonly isContentEditable?: boolean } | null,
): boolean {
  if (sliderOwnsKey(e, target)) return true;
  if (!isTypingTarget(target)) return false;
  if (cmd === 'palette') return false;
  return !((e.ctrlKey || e.metaKey) && (target?.tagName ?? '').toUpperCase() === 'SELECT');
}

/** Anzeige eines Kürzels in Tooltips, z. B. „Strg+Z“. */
export function shortcutHint(command: Command): string {
  const s = HELP_SHORTCUTS.find((x) => x.command === command);
  return s === undefined ? '' : s.display.join('+');
}
