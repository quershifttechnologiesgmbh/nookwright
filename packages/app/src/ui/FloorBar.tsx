import { shortcutHint } from './shortcuts.js';
import { ADD_FLOOR_HINT, type FloorItem } from './viewModel.js';

/**
 * Etagen-Leiste (links in der 3D-Ansicht), oberste Etage oben. Klick wechselt die aktive Etage (Grundriss, Malen,
 * Treppen-Werkzeug, 3D-Schnitt); Klick auf die aktive Etage wählt sie (Wandhöhe, Keller, Entfernen – W2-ED U2);
 * „+“ legt eine Etage über der obersten an. W11-A: Schalter „Treppen automatisch“ unten (Standard an): Malen auf einer
 * neuen Etage setzt die Treppe dorthin selbst.
 */
export function FloorBar(props: {
  items: readonly FloorItem[]; onSelect: (index: number) => void; onAdd: () => void; autoStairs?: boolean; onAutoStairs?: () => void;
}) {
  return (
    <div className="floor-bar" role="group" aria-label="Etagen">
      <button type="button" className="floor-add" onClick={props.onAdd} title={ADD_FLOOR_HINT} aria-label="Etage hinzufügen">
        +
      </button>
      {props.items.map((f) => (
        <button
          key={f.index}
          type="button"
          className={f.active ? 'active' : ''}
          aria-pressed={f.active}
          onClick={() => props.onSelect(f.index)}
          title={`${f.detail} (${shortcutHint('floor.up')} / ${shortcutHint('floor.down')})${f.active ? ' · Klick: Etage bearbeiten' : ''}`}
        >
          {f.label}
        </button>
      ))}
      {props.onAutoStairs !== undefined && (
        <button
          type="button"
          className={`floor-auto${props.autoStairs === true ? ' active' : ''}`}
          aria-pressed={props.autoStairs === true}
          aria-label="Treppen automatisch"
          onClick={props.onAutoStairs}
          title={`Treppen automatisch: ${props.autoStairs === true ? 'an' : 'aus'} – malst du Räume auf einer neuen Etage, setzt die App die Treppe selbst (Diele und Flur zuerst, nie durch gesperrte Möbel); von Hand gesetzte Treppen bleiben`}
        >
          Auto
        </button>
      )}
    </div>
  );
}
