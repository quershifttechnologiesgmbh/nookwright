import type { Catalog } from '@mcda/catalog';
import { useId, useMemo, useState } from 'react';
import { css, roomTypeColor } from '../colors.js';
import { bestRoomTypeMatch, groupRoomTypes, roomTypeGroupOf, roomTypeInfos, roomTypeMisfits, type RoomTypeFitContext, type RoomTypeInfo } from './roomTypeGroups.js';

const NO_FIT: RoomTypeFitContext = {};

/** Dezentes Warnzeichen mit Begründung (Theme bzw. Wandhöhe passen nicht). */
function Misfit({ reasons }: { reasons: readonly string[] }) {
  if (reasons.length === 0) return null;
  const text = reasons.join('; ');
  return (
    <span className="misfit" title={text} aria-label={`Hinweis: ${text}`}>
      !
    </span>
  );
}

/**
 * Palette „Neuer Raum“ für viele Raumtypen: Suche (Enter nimmt den besten Treffer – `bestRoomTypeMatch`, markiert
 * mit „Enter“ –, Esc leert, eine Wahl leert sie auch) und aufklappbare
 * Gruppen (roomTypeGroups.ts). Offen ist anfangs die Gruppe des gewählten Typs; beim Suchen alle mit Treffern.
 * Typen, die nicht zum Theme oder zur Wandhöhe der aktiven Etage passen, tragen ein dezentes „!“ (`fit`).
 */
export function RoomTypePalette(props: { catalog: Catalog; value: string; onPick: (id: string) => void; fit?: RoomTypeFitContext }) {
  const types = useMemo(() => roomTypeInfos(props.catalog), [props.catalog]);
  const fit = props.fit ?? NO_FIT;
  const misfits = (t: RoomTypeInfo): string[] => roomTypeMisfits(t, fit);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const t = types.find((x) => x.id === props.value);
    return new Set(t === undefined ? [] : [roomTypeGroupOf(t)]);
  });
  const groups = useMemo(() => groupRoomTypes(types, query), [types, query]);
  const searching = query.trim() !== '';
  const bestHintId = useId();
  const best = useMemo(() => bestRoomTypeMatch(groups, query), [groups, query]);
  const current = types.find((t) => t.id === props.value);
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const pick = (id: string) => {
    props.onPick(id);
    const t = types.find((x) => x.id === id);
    if (t !== undefined) setOpen((o) => new Set([...o, roomTypeGroupOf(t)]));
    // W11-B: Suche nach der Wahl leeren – sonst blieb die Liste gefiltert („Küche“) und der nächste Raumtyp unsichtbar;
    // die Gruppe des gewählten Typs ist aufgeklappt, er bleibt oben als „Neuer Raum“ sichtbar
    setQuery('');
  };
  return (
    <div className="palette" role="radiogroup" aria-label="Raumtyp für neue Räume">
      <span className="palette-title">Neuer Raum</span>
      {current !== undefined && (
        <span className="palette-current" title="Wird als Nächstes gemalt">
          <i className="swatch" style={{ background: css(roomTypeColor(current.id)) }} />
          <span>{current.name}</span>
          <Misfit reasons={misfits(current)} />
        </span>
      )}
      <input
        type="search"
        className="palette-search"
        placeholder="Suchen …"
        aria-label="Raumtyp suchen"
        title="Name, ID oder Gruppe – Enter wählt den besten Treffer (markiert), Esc leert"
        aria-describedby={best !== undefined ? bestHintId : undefined}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (best !== undefined) pick(best.id);
          } else if (e.key === 'Escape') {
            setQuery('');
            e.currentTarget.blur();
          }
        }}
      />
      {groups.length === 0 && <span className="hint">Kein Raumtyp passt.</span>}
      {best !== undefined && (
        <span id={bestHintId} className="hint palette-best-hint">
          Enter wählt „{best.name}“
        </span>
      )}
      {groups.map((g) => {
        const expanded = searching || open.has(g.id);
        const hasCurrent = g.items.some((t) => t.id === props.value);
        return (
          <div key={g.id} className="palette-group">
            <button type="button" className="palette-group-head" aria-expanded={expanded} onClick={() => toggle(g.id)} disabled={searching} title={expanded ? 'Zuklappen' : 'Aufklappen'}>
              <span className="caret" aria-hidden="true">
                {expanded ? '▾' : '▸'}
              </span>
              <span className="palette-group-label">{g.label}</span>
              {hasCurrent && !expanded && <i className="swatch" style={{ background: css(roomTypeColor(props.value)) }} />}
              <span className="count">{g.items.length}</span>
            </button>
            {expanded &&
              g.items.map((t) => {
                const active = t.id === props.value;
                const why = misfits(t);
                const isBest = t.id === best?.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`palette-item${active ? ' active' : ''}${isBest ? ' best' : ''}${why.length > 0 ? ' misfit-item' : ''}`}
                    data-best={isBest ? 'true' : undefined}
                    onClick={() => pick(t.id)}
                    title={`${t.name}: als Nächstes malen${why.length > 0 ? ` – Hinweis: ${why.join('; ')}` : ''}`}
                  >
                    <i className="swatch" style={{ background: css(roomTypeColor(t.id)) }} />
                    <span>{t.name}</span>
                    <Misfit reasons={why} />
                    {isBest && (
                      <kbd className="palette-best-key" aria-hidden="true">
                        Enter
                      </kbd>
                    )}
                  </button>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
