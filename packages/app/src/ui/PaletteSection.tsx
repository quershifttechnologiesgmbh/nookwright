/**
 * Paletten-Ansicht (Axiom-Vorbild, research/13 §8 #17/#19 und #24): zeigt die **gemessene** Verteilung des
 * fertigen Baus – Blöcke je Rolle mit Prozentanteil – und darunter, was die Zielversion ersetzt hat
 * (Versions-Markierung). Rein darstellend; die Daten kommen aus `MaterializeResult.palette`/`.substitutions`.
 */
import type { MaterialResolution, PaletteEntry } from '@mcda/materialize';
import { useMemo } from 'react';
import { paletteByRole, percent, shortBlockName, substitutionLabel } from './paletteRows.js';

export function PaletteSection(props: {
  /** `undefined`, solange keine Blöcke berechnet sind (die Ansicht „Texturen“/„Blöcke“ löst das aus). */
  readonly palette: readonly PaletteEntry[] | undefined;
  readonly substitutions: readonly MaterialResolution[] | undefined;
  readonly version: string;
  readonly busy: boolean;
  /** Höchstzahl der Rollen-Gruppen (Standard 8). */
  readonly roles?: number;
  /** Rollen des aktiven Themes: alles andere sind Material-Schichten der Möbel („Möbel & Deko", Review 3). */
  readonly themeRoles?: ReadonlySet<string> | undefined;
}) {
  const opts = useMemo(() => ({ ...(props.themeRoles !== undefined ? { themeRoles: props.themeRoles } : {}) }), [props.themeRoles]);
  const groups = useMemo(() => (props.palette === undefined ? [] : paletteByRole(props.palette, 4, opts).slice(0, props.roles ?? 8)), [props.palette, props.roles, opts]);
  const subs = props.substitutions ?? [];
  return (
    <section className="panel" aria-label="Palette (gemessen)">
      <h2>Palette</h2>
      {props.palette === undefined ? (
        <p className="hint">
          {props.busy ? 'Blöcke werden berechnet …' : 'Noch keine Blöcke berechnet – Ansicht „Texturen“ oder „Blöcke“ öffnen.'}
        </p>
      ) : (
        <>
          <p className="hint">
            {props.palette.length} verschiedene Blöcke, gemessen am fertigen Bau (nach Merge und Autotiling).
          </p>
          {groups.map((g) => (
            <div key={g.role} className="palette-group">
              <h3 title={g.label === g.role ? undefined : `Material-Schichten der Möbel (${g.role})`}>
                {g.label} <span className="muted">{g.total} Blöcke</span>
              </h3>
              {g.rows.map((r) => (
                <div key={`${g.role}|${r.block}`} className="palette-row" title={`${shortBlockName(r.block)}: ${r.count}${r.role === g.role ? '' : ` · ${r.role}`}`}>
                  <span className="palette-label">{shortBlockName(r.block)}</span>
                  <span className="palette-bar">
                    <i style={{ width: `${percent(r.share)}%` }} />
                  </span>
                  <span className="palette-share">{percent(r.share)} %</span>
                </div>
              ))}
              {g.rest > 0 && <p className="hint">+{g.rest} weitere Blöcke in dieser Rolle</p>}
            </div>
          ))}
          {subs.length > 0 && (
            <>
              <h3>
                Ersetzt in {props.version} <span className="muted">{subs.length}</span>
              </h3>
              <ul className="palette-subs">
                {subs.map((s) => (
                  <li key={`${s.role}|${s.shape}`}>{substitutionLabel(s, opts)}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
