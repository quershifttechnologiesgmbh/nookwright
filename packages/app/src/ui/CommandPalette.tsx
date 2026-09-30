import { useMemo, useState, type KeyboardEvent } from 'react';
import { searchCommands, type CommandItem } from './commandSearch.js';

/**
 * Befehlssuche (W7-G, U8): Strg+K öffnet ein Suchfeld über alle Einstellungen und Befehle der Heimat-Tabelle.
 * Tastatur zuerst: tippen, ↑/↓ wählen, Enter ausführen bzw. hinspringen, Esc schließt. Nur sichtbar, solange offen –
 * die Oberfläche bekommt kein dauerhaftes Bedienelement dazu.
 */
export function CommandPalette(p: { readonly items: readonly CommandItem[]; readonly onRun: (item: CommandItem) => void; readonly onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchCommands(p.items, query), [p.items, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      p.onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) setActive((current + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[current];
      if (r !== undefined) p.onRun(r);
    }
  };
  return (
    <div className="palette-backdrop" onMouseDown={p.onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Befehlssuche" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          type="text"
          className="palette-input"
          value={query}
          placeholder="Einstellung oder Befehl suchen … (z. B. Dachüberstand, Mittelgang)"
          aria-label="Befehl suchen"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results.length > 0 ? `palette-${current}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
        {results.length === 0 ? (
          <p className="palette-empty">Nichts gefunden</p>
        ) : (
          <ul id="palette-list" className="palette-list" role="listbox" aria-label="Treffer">
            {results.map((r, i) => (
              <li
                key={r.id}
                id={`palette-${i}`}
                role="option"
                aria-selected={i === current}
                className={i === current ? 'active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  p.onRun(r);
                }}
              >
                <span className="palette-label">{r.label}</span>
                <span className="palette-path">{r.path}</span>
                {r.keys !== undefined && <kbd>{r.keys}</kbd>}
              </li>
            ))}
          </ul>
        )}
        <p className="palette-foot muted small">↑ ↓ wählen · Enter {query === '' ? 'ausführen bzw. hinspringen' : 'öffnen'} · Esc schließt</p>
      </div>
    </div>
  );
}
