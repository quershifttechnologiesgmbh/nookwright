import type { ProjectState, StairType, VerticalLink } from '@mcda/blueprint';
import type { ReactNode } from 'react';
import { FACING_LABEL, linkLayout, rotateFacing } from '../stairs.js';
import { STAIR_TYPES, floorLabel } from '../usecases.js';
import { shortcutHint } from './shortcuts.js';
import { Stepper } from './Stepper.js';

export { Stepper };

/*
 * W2-ED U2: Das frühere Panel „Gebäude“ ist aufgeteilt – Etagen in „Etage“ (Klick auf die aktive Etage), Etagen in 3D
 * unter „Schnitt ▾“, Nutzung/Mittelgang/Dach-Details/Außenwände/Außen-Deko unter „Haus › Mehr Haus-Optionen“,
 * Dachform und Außen-Deko an/aus im Haus-Panel (Heimat-Tabelle `controlHomes.ts`). Hier bleibt die Treppe.
 */

const typeLabel = (t: StairType): string => STAIR_TYPES.find((x) => x.id === t)?.label ?? t;

/** Gewählte Treppe: Art, Richtung, Drehsinn ändern (neu setzen), entfernen. */
export function StairsPanel(props: {
  state: ProjectState;
  link: VerticalLink;
  onChange: (patch: { type?: StairType; facing?: VerticalLink['facing']; turn?: 'left' | 'right' }) => void;
  onRemove: () => void;
  crumb?: ReactNode;
}) {
  const { link } = props;
  const layout = linkLayout(props.state, link);
  const steps = layout?.blocks.filter((b) => b.part === 'tread' || b.part === 'ladder').length ?? 0;
  const turns = STAIR_TYPES.find((t) => t.id === link.type)?.turns ?? false;
  return (
    <section className="panel insp" aria-label="Treppe">
      {props.crumb}
      <h2 className="insp-title">Treppe {floorLabel(link.floorIndex)} → {floorLabel(link.floorIndex + 1)}</h2>
      <dl className="facts">
        <dt>Verbindet</dt>
        <dd>
          {floorLabel(link.floorIndex)} → {floorLabel(link.floorIndex + 1)}
        </dd>
        <dt>Laufrichtung</dt>
        <dd>
          {FACING_LABEL[link.facing]}
          {turns && ` · Drehsinn ${link.turn === 'left' ? 'links' : 'rechts'}`}
        </dd>
        <dt>{link.type === 'ladder' ? 'Sprossen' : 'Stufen'}</dt>
        <dd>
          {steps} <span className="muted">(Wandhöhe + 1; Antritt bei {layout === undefined ? '?' : `${layout.bottom.inside[0]}, ${layout.bottom.inside[1]}`})</span>
        </dd>
      </dl>
      <label className="field" htmlFor="stairs-type">
        <span>Art</span>
        <select id="stairs-type" value={link.type} onChange={(e) => props.onChange({ type: e.target.value as StairType })}>
          {STAIR_TYPES.map((t) => (
            <option key={t.id} value={t.id} title={t.hint}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button type="button" onClick={() => props.onChange({ facing: rotateFacing(link.facing) })} title="Laufrichtung im Uhrzeigersinn drehen (Treppe wird neu gesetzt)">
          ⟳ Drehen
        </button>
        {turns && (
          <button type="button" onClick={() => props.onChange({ turn: link.turn === 'left' ? 'right' : 'left' })} title="Drehsinn spiegeln">
            ⇋ Spiegeln
          </button>
        )}
        <button type="button" className="danger" onClick={props.onRemove} title={`Treppe entfernen (${shortcutHint('room.delete')}); rückgängig machbar`}>
          Entfernen
        </button>
      </div>
      <p className="insp-note" title={`${typeLabel(link.type)}-Treppen reservieren unten Stufen + Antritt, oben Öffnung + Austritt.`}>Passt die geänderte Treppe nicht, bleibt die alte stehen.</p>
    </section>
  );
}
