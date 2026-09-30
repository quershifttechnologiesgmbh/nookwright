import type { BuildingTypeDef } from '@mcda/catalog';
import { useEffect, useState } from 'react';
import { FRONT_OPTIONS, FUNCTION_LEVEL_OPTIONS, SIZE_LABELS, floorChoices, hasFunctionRooms, sizesOf, typeLabel, withSize, type TypeParams } from '../buildingTypes.js';

/**
 * Dialog „Bautyp anpassen“ (research/19 §7.7 ④, W2-ED U2): Größe, Etagen, Front und Unterbau („Keller & Gewölbe
 * darunter“, feat/underground) ändern (neuer Grundriss mit
 * Rückfrage; eigene Räume und Räume mit gesperrten Möbeln bleiben) und „Nur Stil anwenden“. Theme und Außen-Deko
 * stehen nur noch im Haus-Panel (vorher zwei Theme-Felder mit verschiedener Wirkung), der Seed in der Projekt-Info.
 */
export function BuildingTypePanel(props: {
  def: BuildingTypeDef;
  params: TypeParams;
  rooms: { readonly type: number; readonly user: number };
  onApply: (params: TypeParams) => void;
  onStyle: () => void;
  onClose: () => void;
}) {
  const { def } = props;
  const [draft, setDraft] = useState(props.params);
  const current = JSON.stringify(props.params);
  // Nach Undo, Neu würfeln oder Übernehmen: Entwurf auf den Stand des Projekts
  useEffect(() => setDraft(props.params), [current]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = JSON.stringify(draft) !== current;
  const sizes = sizesOf(def);
  const floors = floorChoices(def, draft.size);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <section className="modal type-dialog" role="dialog" aria-modal="true" aria-labelledby="type-title" style={{ maxWidth: 440 }}>
        <header className="modal-head">
          <h2 id="type-title">Bautyp anpassen · {typeLabel(def)}</h2>
          <button type="button" onClick={props.onClose} aria-label="Schließen">
            ✕
          </button>
        </header>
        <p className="muted small" title="Räume, die du gemalt oder verändert hast, und Räume mit gesperrten Möbeln bleiben beim Neubau stehen">
          {props.rooms.type} Räume aus dem Bautyp{props.rooms.user > 0 ? ` · ${props.rooms.user} eigene` : ''}
          {def.status === 'draft' && <span className="badge draft">Vorschau</span>}
        </p>
        <div className="field-grid type-params">
          {sizes.length > 0 && (
            <>
              <span>Größe</span>
              <span className="segmented" role="group" aria-label="Größe">
                {sizes.map((s) => (
                  <button key={s} type="button" className={s === draft.size ? 'active' : ''} onClick={() => setDraft(withSize(def, draft, s))} title={SIZE_LABELS[s]}>
                    {s}
                  </button>
                ))}
              </span>
            </>
          )}
          {floors.length > 0 && (
            <>
              <label htmlFor="type-floors">Etagen</label>
              <select id="type-floors" value={draft.floors ?? ''} onChange={(e) => setDraft({ ...draft, floors: e.target.value === '' ? undefined : Number(e.target.value) })}>
                <option value="">Zufall</option>
                {floors.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </>
          )}
          <span>Front</span>
          <span className="segmented" role="group" aria-label="Front">
            {FRONT_OPTIONS.map((f) => (
              <button key={f.id} type="button" className={f.id === draft.front ? 'active' : ''} onClick={() => setDraft({ ...draft, front: f.id })} title={f.hint}>
                {f.label}
              </button>
            ))}
          </span>
          <span>Unterbau</span>
          <label className="check" title="Keller- bzw. Dungeon-Ebene unter und um das Haus: Weinkeller, Lager, Kerker, Schatzkammer … mit Gängen und Rundwegen, Treppe am Treppenkern; dazu Zusatztüren für Rundgänge im Haus. Neuer Grundriss mit Rückfrage – rückgängig machbar">
            <input type="checkbox" checked={draft.underground === true} onChange={(e) => setDraft({ ...draft, underground: e.target.checked })} />
            {'Keller & Gewölbe darunter'}
          </label>
          <span>Funktionsgrad</span>
          <span
            className="segmented"
            role="group"
            aria-label="Funktionsgrad"
            title={hasFunctionRooms(def)
              ? 'Wie viele funktionale Anlagen das Haus bekommt (Lager mit Sortierer, Farmen, Schmelze, Brauerei, Tresor …). Neuer Grundriss mit Rückfrage – rückgängig machbar'
              : 'Dieser Bautyp hat keine Funktionsräume (fester Grundriss)'}
          >
            {FUNCTION_LEVEL_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                className={o.id === (draft.functionLevel ?? 'off') ? 'active' : ''}
                disabled={!hasFunctionRooms(def)}
                onClick={() => setDraft({ ...draft, functionLevel: o.id })}
                title={o.hint}
              >
                {o.label}
              </button>
            ))}
          </span>
        </div>
        <div className="row end">
          <button type="button" onClick={props.onStyle} title="Dach, Details, Gauben, Außenprofil, Fenster und Außenanlagen des Bautyps wiederherstellen; Räume bleiben">
            Nur Stil anwenden
          </button>
          <button type="button" className={changed ? 'primary' : ''} disabled={!changed} onClick={() => props.onApply(draft)} title="Neuer Grundriss mit diesen Parametern (gleicher Seed); fragt vorher, eigene und gesperrte Räume bleiben – rückgängig machbar">
            Neu bauen …
          </button>
        </div>
      </section>
    </div>
  );
}
