import type { Catalog } from '@mcda/catalog';
import type { ReactNode } from 'react';
import type { Tool } from '../editor/grid.js';
import { FACING_LABEL, rotateFacing, type StairTool } from '../stairs.js';
import { STAIR_TYPES } from '../usecases.js';
import { RoomTypePalette } from './RoomTypePalette.js';
import type { RoomTypeFitContext } from './roomTypeGroups.js';
import { shortcutHint, type Command } from './shortcuts.js';

/** Kleine eigene Symbole (keine fremden Grafiken), Strichstärke wie der Text. */
const ICONS: Readonly<Record<Tool, ReactNode>> = {
  paint: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
      <path d="M8 16 L16 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  erase: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 15 L12 7 L18 13 L12 19 H8 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 19 H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  select: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4 L6 18 L10 14 L13 20 L15.5 19 L12.5 13 L18 13 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  ),
  stairs: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20 H9 V15 H14 V10 H19 V4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  ),
};

const TOOLS: ReadonlyArray<{ readonly id: Tool; readonly label: string; readonly command: Command; readonly hint: string }> = [
  { id: 'select', label: 'Auswählen', command: 'tool.select', hint: 'Klick auf Raum, Möbel, Treppe (Grundriss oder 3D) wählt es aus; Esc geht eine Ebene hoch.' },
  { id: 'paint', label: 'Raum', command: 'tool.paint', hint: 'Raumtyp wählen, dann im Grundriss ein Rechteck aufziehen = neuer Raum (übermalt bestehende).' },
  { id: 'erase', label: 'Radieren', command: 'tool.erase', hint: 'Rechteck aufziehen = Zellen entfernen. Rechtsklick radiert immer.' },
  { id: 'stairs', label: 'Treppe', command: 'tool.stairs', hint: 'Treppe von der aktiven Etage nach oben setzen: Geist zeigt, ob sie passt (rot mit Grund). R dreht, F spiegelt, Rechtsklick entfernt.' },
];

/** Umschalter Haus / Umgebung als Symbole (schmale Werkzeug-Schiene). */
function RailModes(props: { mode: 'house' | 'site'; onMode: (m: 'house' | 'site') => void }) {
  return (
    <div className="rail-modes" role="group" aria-label="Bearbeiten">
      <button type="button" className={props.mode === 'house' ? 'active' : ''} aria-pressed={props.mode === 'house'} aria-label="Haus" data-tip="Haus" title="Haus: Räume, Treppen, Einrichtung, Dach" onClick={() => props.onMode('house')}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 11 L12 4 L20 11 V20 H4 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className={props.mode === 'site' ? 'active' : ''} aria-pressed={props.mode === 'site'} aria-label="Umgebung" data-tip="Umgebung: Gelände, Mauern, Türme" title="Umgebung: Gelände, Felder und Gärten, Terraforming, Mauern, Türme, Windmühlen" onClick={() => props.onMode('site')}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 18 C7 18 8 9 12 9 C16 9 17 18 21 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Werkzeug-Schiene (W2-ED U2): Haus | Umgebung, darunter Auswählen · Raum · Radieren · Treppe als Symbole. Die
 * Raumtyp-Palette erscheint nur beim Raum-Werkzeug als Ausklapper neben der Schiene, die Treppen-Optionen nur beim
 * Treppen-Werkzeug – sonst bleibt die Schiene bei sechs Knöpfen.
 */
export function ToolRail(props: {
  catalog: Catalog;
  mode: 'house' | 'site';
  onMode: (m: 'house' | 'site') => void;
  tool: Tool;
  onTool: (t: Tool) => void;
  paintType: string;
  onPaintType: (id: string) => void;
  stairTool: StairTool;
  onStairTool: (t: StairTool) => void;
  /** Theme-Stil und Wandhöhe der aktiven Etage für den Passt-Hinweis der Palette. */
  fit?: RoomTypeFitContext;
}) {
  const st = props.stairTool;
  const turns = STAIR_TYPES.find((t) => t.id === st.type)?.turns ?? false;
  return (
    <nav className="toolbar rail" aria-label="Werkzeuge">
      <RailModes mode={props.mode} onMode={props.onMode} />
      <div className="tool-group" role="group" aria-label="Werkzeug">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool${t.id === props.tool ? ' active' : ''}`}
            onClick={() => props.onTool(t.id)}
            title={`${t.label} (${shortcutHint(t.command)}) – ${t.hint}`}
            aria-label={t.label}
            data-tip={`${t.label} (${shortcutHint(t.command)})`}
            aria-pressed={t.id === props.tool}
          >
            {ICONS[t.id]}
            <kbd>{shortcutHint(t.command)}</kbd>
          </button>
        ))}
      </div>
      {props.tool === 'paint' && (
        <div className="rail-flyout" aria-label="Raumtyp für neue Räume">
          <RoomTypePalette catalog={props.catalog} value={props.paintType} {...(props.fit !== undefined ? { fit: props.fit } : {})} onPick={props.onPaintType} />
        </div>
      )}
      {props.tool === 'stairs' && (
        <div className="rail-flyout stair-options" role="group" aria-label="Treppe">
          <span className="palette-title">Treppe</span>
          <div className="stair-types" role="radiogroup" aria-label="Treppenart">
            {STAIR_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === st.type}
                className={`palette-item${t.id === st.type ? ' active' : ''}`}
                onClick={() => props.onStairTool({ ...st, type: t.id })}
                title={t.hint}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" className="palette-item" onClick={() => props.onStairTool({ ...st, facing: rotateFacing(st.facing) })} title={`Drehen (${shortcutHint('stairs.rotate')})`}>
            ⟳ {FACING_LABEL[st.facing]} <kbd>{shortcutHint('stairs.rotate')}</kbd>
          </button>
          {turns && (
            <button
              type="button"
              className="palette-item"
              onClick={() => props.onStairTool({ ...st, turn: st.turn === 'left' ? 'right' : 'left' })}
              title={`Drehsinn spiegeln (${shortcutHint('stairs.mirror')})`}
            >
              ⇋ {st.turn === 'left' ? 'links' : 'rechts'} <kbd>{shortcutHint('stairs.mirror')}</kbd>
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
