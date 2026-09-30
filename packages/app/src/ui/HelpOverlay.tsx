import { useEffect } from 'react';
import { HELP_GROUPS, HELP_SHORTCUTS } from './shortcuts.js';

/** Tastenkürzel-Hilfe (Taste ?): dieselbe Tabelle, die auch die Tastatur auswertet. Esc oder Klick daneben schließt. */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal help" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 id="help-title">Tastenkürzel</h2>
          <button type="button" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="help-grid">
          {HELP_GROUPS.map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              <dl>
                {HELP_SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <div key={s.command} className="help-row">
                    <dt>
                      {s.display.map((d, i) => (
                        <kbd key={i}>{d}</kbd>
                      ))}
                    </dt>
                    <dd>{s.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section>
            <h3>Maus</h3>
            <dl>
              <div className="help-row">
                <dt>Grundriss</dt>
                <dd>Ziehen malt bzw. radiert, Klick wählt, rechte Taste radiert; Treppe (T): Klick setzt, rechts entfernt</dd>
              </div>
              <div className="help-row">
                <dt>Umgebung</dt>
                <dd>Ziehen malt Zone bzw. formt, rechte Taste radiert; Weg und Glätten mit rundem Pinsel; Mausrad zoomt, mittlere Taste oder Leertaste + Ziehen verschiebt; Mauer: Umschalt rastet auf 45° ein</dd>
              </div>
              <div className="help-row">
                <dt>3D</dt>
                <dd>Links drehen, rechts verschieben, Rad zoomen, Doppelklick einpassen, Klick wählt Möbel oder Raum</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
