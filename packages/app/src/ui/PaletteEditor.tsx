/**
 * Paletten-Editor (W13-G, plan/spikes/W13G_paletten_editor.md): Blockpalette **vor dem Generieren** anpassen – je
 * Rollengruppe (Wand, Rahmen, Dach, Sockel, Boden, Akzent, Innenholz) eine Familie aus einer kleinen, handverlesenen
 * Auswahl als Farbfelder (Townscaper: wenige Farben, die zusammenpassen), harmonische Vorschläge hervorgehoben,
 * Sperre + „Neu würfeln“ (Block-Paletten-Generatoren), Familien-Tausch „Eiche → Fichte“ (Axiom/Dungeon Alchemist
 * „Change All Walls“) und Zurücksetzen auf das Theme. Farben aus `blockLook` (eigene Werte, keine Mojang-Texturen).
 *
 * Reine Darstellung: Ansicht (`paletteEditorView`) und Würfeln (`rollPaletteOverrides`) kommen aus `@mcda/pipeline`,
 * dieselbe Regel wie die Engine-Operation `palette_suggest`.
 */
import type { PaletteGroup, PaletteOverrides } from '@mcda/core';
import { paletteFamilyLabel } from '@mcda/catalog';
import { luminance, swapTargets, type PaletteEditorView, type PaletteGroupView } from '@mcda/pipeline';
import type { FamilyData } from '@mcda/platform';
import { useState } from 'react';
import { css } from '../colors.js';
import { groupsWith, harmonyWith, lockedToggle, swapsWith } from './paletteOverrides.js';

export interface PaletteEditorProps {
  readonly view: PaletteEditorView | undefined;
  readonly overrides: PaletteOverrides | undefined;
  /** Familien der Zielversion (Tausch-Ziele); fehlt vor dem Laden der Plattform. */
  readonly families?: FamilyData | undefined;
  /** Neue Überschreibungen (Normalform macht der Aufrufer); `undefined` = alles auf das Theme zurück. */
  readonly onChange: (next: PaletteOverrides | undefined, what: string) => void;
  /** Neu würfeln: nicht gesperrte Gruppen, Seed zählt hoch. */
  readonly onRoll: (locked: readonly PaletteGroup[], seed: number) => void;
  /** Kompakt (Assistent): ohne Tausch-Bereich. */
  readonly compact?: boolean;
  /** Kopfzeile ausblenden (eigene Überschrift des Aufrufers). */
  readonly bare?: boolean;
}

const LOCK = '🔒︎';
const OPEN = '🔓︎';

/** Kurzname ohne Klammerzusatz („Eiche (mittleres Holz)“ → „Eiche“) für enge Zeilen. */
const shortLabel = (family: string): string => paletteFamilyLabel(family).replace(/\s*\(.*\)$/, '');

/** Herkunft der wirksamen Familie: eigene Wahl, Tausch oder Theme. */
function originText(g: PaletteGroupView): string {
  if (g.current !== undefined) return '';
  return g.effective?.family === g.theme?.family ? ' · Theme' : ' · getauscht';
}

/** Textfarbe auf einem Farbfeld (hell/dunkel). */
const ink = (c: number): string => (luminance(c) > 0.55 ? '#111' : '#fff');

function GroupRow(p: {
  readonly g: PaletteGroupView;
  readonly locked: boolean;
  readonly onLock: () => void;
  readonly onPick: (family: string | undefined) => void;
}) {
  const g = p.g;
  const eff = g.effective;
  const title = eff === undefined ? g.label : `${g.label}: ${paletteFamilyLabel(eff.family)}${originText(g)}`;
  return (
    <li className={`pal-group${g.current !== undefined ? ' changed' : ''}`}>
      <div className="pal-head">
        <i className="pal-main" style={eff === undefined ? undefined : { background: css(eff.color), color: ink(eff.color) }} aria-hidden="true" />
        <span className="pal-label" title={title}>
          <b>{g.label}</b>
          <span className="muted small">{eff === undefined ? '—' : paletteFamilyLabel(eff.family)}{originText(g)}</span>
        </span>
        {g.current !== undefined && (
          <button type="button" className="icon" onClick={() => p.onPick(undefined)} title={`${g.label} zurück auf das Theme (${g.theme === undefined ? '—' : paletteFamilyLabel(g.theme.family)})`} aria-label={`${g.label} zurücksetzen`}>
            ↺
          </button>
        )}
        <button
          type="button"
          className={`icon pal-lock${p.locked ? ' on' : ''}`}
          onClick={p.onLock}
          aria-pressed={p.locked}
          title={p.locked ? `${g.label} bleibt beim Würfeln (Sperre lösen)` : `${g.label} beim Würfeln festhalten`}
          aria-label={`${g.label} ${p.locked ? 'entsperren' : 'sperren'}`}
        >
          {p.locked ? LOCK : OPEN}
        </button>
      </div>
      <div className="pal-options" role="radiogroup" aria-label={`${g.label}: Blockfamilie`}>
        {g.options.map((o) => {
          const active = eff?.family === o.family;
          const isTheme = g.theme?.family === o.family;
          return (
            <button
              key={o.family}
              type="button"
              role="radio"
              aria-checked={active}
              className={`pal-chip${active ? ' active' : ''}${o.fits ? ' fits' : ''}${isTheme ? ' theme' : ''}`}
              style={{ background: css(o.color) }}
              onClick={() => p.onPick(isTheme && g.current !== undefined ? undefined : o.family)}
              title={`${paletteFamilyLabel(o.family)}${isTheme ? ' – Theme' : ''}${o.fits ? ' – passt zu den anderen Gruppen' : ' – passt weniger (Helligkeit)'}`}
              aria-label={paletteFamilyLabel(o.family)}
            />
          );
        })}
      </div>
    </li>
  );
}

export function PaletteEditor(p: PaletteEditorProps) {
  const [locked, setLocked] = useState<readonly PaletteGroup[]>([]);
  const [seed, setSeed] = useState(1);
  const [swapFrom, setSwapFrom] = useState('');
  const v = p.view;
  if (v === undefined) return <p className="muted small">Palette wird geladen …</p>;
  const changed = (p.overrides?.groups !== undefined && Object.keys(p.overrides.groups).length > 0) || (p.overrides?.swaps?.length ?? 0) > 0 || p.overrides?.colorHarmony === 'on';
  const targets = swapFrom === '' ? [] : swapTargets(swapFrom, p.families);
  return (
    <div className={`pal-editor${p.compact === true ? ' compact' : ''}`}>
      {p.bare !== true && (
        <p className="muted small pal-intro">
          Vor dem Generieren: Blockfamilie je Bauteil wählen. Umrandete Felder passen in der Helligkeit zu den anderen (Dach dunkler als die Wand …).
        </p>
      )}
      <div className="pal-actions">
        <button
          type="button"
          onClick={() => {
            const next = seed + 1;
            setSeed(next);
            p.onRoll(locked, next);
          }}
          title="Nicht gesperrte Gruppen neu würfeln – harmonisch zu den gesperrten (gleicher Wurf, gleiches Ergebnis)"
        >
          🎲︎ Neu würfeln
        </button>
        <button type="button" disabled={!changed} onClick={() => p.onChange(undefined, 'Palette zurück auf das Theme')} title="Alle Gruppen und Tausche zurück auf das Theme">
          Alles zurücksetzen
        </button>
      </div>
      <label className="pal-harmony small" title="Helligkeitsabstände zwischen Sockel, Wand, Dach und Zierholz sichern, Sättigung zum Stil, Hauptfarbe etwa 80 %, Akzent etwa 20 %">
        <input
          type="checkbox"
          checked={p.overrides?.colorHarmony === 'on'}
          onChange={(e) => p.onChange(harmonyWith(p.overrides, e.target.checked), e.target.checked ? 'Farbharmonie an' : 'Farbharmonie aus')}
        />{' '}
        Farbharmonie (Kontrast, Sättigung, 80/20)
      </label>
      <ul className="pal-groups">
        {v.groups.map((g) => (
          <GroupRow
            key={g.group}
            g={g}
            locked={locked.includes(g.group)}
            onLock={() => setLocked(lockedToggle(locked, g.group))}
            onPick={(family) =>
              p.onChange(groupsWith(p.overrides, g.group, family), family === undefined ? `${g.label}: zurück auf das Theme` : `${g.label}: ${paletteFamilyLabel(family)}`)}
          />
        ))}
      </ul>
      {p.compact !== true && (
        <div className="pal-swaps">
          <h3 className="mat-caption">Tauschen (überall, Verläufe bleiben)</h3>
          {v.swaps.length > 0 && (
            <ul>
              {v.swaps.map((s) => (
                <li key={s.from.family}>
                  <i className="mat-swatch" style={{ background: css(s.from.color) }} aria-hidden="true" />
                  <span>{shortLabel(s.from.family)}</span>
                  <span aria-hidden="true">→</span>
                  <i className="mat-swatch" style={{ background: css(s.to.color) }} aria-hidden="true" />
                  <span>{shortLabel(s.to.family)}</span>
                  <button
                    type="button"
                    className="icon"
                    onClick={() => p.onChange(swapsWith(p.overrides, s.from.family, undefined), `Tausch ${paletteFamilyLabel(s.from.family)} entfernt`)}
                    aria-label={`Tausch ${paletteFamilyLabel(s.from.family)} entfernen`}
                    title="Tausch entfernen"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="pal-swap-add">
            <select aria-label="Familie ersetzen" value={swapFrom} onChange={(e) => setSwapFrom(e.target.value)}>
              <option value="">Ersetze …</option>
              {v.swapSources.filter((s) => !v.swaps.some((x) => x.from.family === s.family)).map((s) => (
                <option key={s.family} value={s.family}>{paletteFamilyLabel(s.family)} ({s.roles} {s.roles === 1 ? 'Rolle' : 'Rollen'})</option>
              ))}
            </select>
            <select
              aria-label="Ersetzen durch"
              value=""
              disabled={swapFrom === ''}
              onChange={(e) => {
                if (e.target.value === '') return;
                p.onChange(swapsWith(p.overrides, swapFrom, e.target.value), `${paletteFamilyLabel(swapFrom)} → ${paletteFamilyLabel(e.target.value)}`);
                setSwapFrom('');
              }}
            >
              <option value="">… durch</option>
              {targets.map((t) => <option key={t.family} value={t.family}>{paletteFamilyLabel(t.family)}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
