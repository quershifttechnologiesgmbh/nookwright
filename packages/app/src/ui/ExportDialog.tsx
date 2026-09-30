import type { ProjectState } from '@mcda/blueprint';
import type { ExportFormat } from '@mcda/export';
import type { Violation } from '@mcda/materialize';
import { useEffect, type ReactNode } from 'react';
import { DISCLAIMER } from '../brand.js';
import { OUTPUT_LICENSE_DRAFT } from '@mcda/pipeline';
import { EXPORT_FORMAT_OPTIONS, exportFileName, placeHint, type ExportReport, type GuideKind } from '../exporting.js';
import { TARGET_VERSION_NAMES } from '../usecases.js';
import type { WorldStatus } from '../useWorld.js';

/** Höchstens so viele Meldungen je Liste; der Rest wird gezählt. */
const MAX_LISTED = 12;

/** `Text mit \`Code\`` → Text + <code>. */
function withCode(text: string): ReactNode[] {
  return text.split('`').map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

function ViolationList({ items }: { items: readonly Violation[] }) {
  return (
    <ul>
      {items.slice(0, MAX_LISTED).map((v, i) => (
        <li key={i}>{v.message}</li>
      ))}
      {items.length > MAX_LISTED && <li className="muted">… und {items.length - MAX_LISTED} weitere</li>}
    </ul>
  );
}

export interface ExportDialogProps {
  readonly state: ProjectState;
  readonly themeName: string;
  readonly format: ExportFormat;
  readonly onFormat: (f: ExportFormat) => void;
  readonly onVersion: (name: string) => void;
  readonly world: WorldStatus;
  readonly report: ExportReport | undefined;
  /** Der Licht-Pass läuft noch (Blöcke folgen danach). */
  readonly lighting: boolean;
  /** Grund, warum nicht exportiert werden kann (z. B. kein GZip im Browser); sonst `undefined`. */
  readonly blocked: string | undefined;
  readonly downloading: boolean;
  readonly onDownload: () => void;
  /** Bauplan (Markdown) bzw. Materialliste (CSV) herunterladen (DR5 K2); fehlt = keine Knöpfe. */
  readonly onGuide?: (kind: GuideKind) => void;
  readonly onClose: () => void;
}

/**
 * Export-Dialog: Format und Zielversion wählen, Verstöße der Materialisierung prüfen, herunterladen.
 * `spawn` (dunkle Stellen) ist eine Warnung, alle anderen Verstöße sind Fehler; Herunterladen bleibt möglich.
 */
export function ExportDialog(p: ExportDialogProps) {
  const { onClose } = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fileName = exportFileName(p.state.name, p.format);
  const r = p.report;
  // Ein leerer Bau ist kein „Trotzdem"-Fall: es gäbe nichts zu exportieren (Review 4)
  const leer = r?.empty === true;
  const ready = r !== undefined && !p.lighting && p.blocked === undefined && !p.downloading && !leer;
  // Bauplan braucht kein GZip, nur fertige Blöcke
  const guideReady = r !== undefined && !p.lighting && !p.downloading && !leer;
  const formatHint = EXPORT_FORMAT_OPTIONS.find((f) => f.id === p.format)?.hint;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <h2 id="export-title">Exportieren</h2>

        <div className="field">
          <span>Format</span>
          <div className="segmented fill" role="group" aria-label="Format">
            {EXPORT_FORMAT_OPTIONS.map((f) => (
              <button key={f.id} type="button" className={f.id === p.format ? 'active' : ''} onClick={() => p.onFormat(f.id)} title={f.hint}>
                {f.label}
              </button>
            ))}
          </div>
          <p className="hint">{formatHint}</p>
        </div>

        <label className="field" htmlFor="target-version">
          <span>Zielversion (Minecraft Java)</span>
          <select id="target-version" value={p.state.targetVersion.name} onChange={(e) => p.onVersion(e.target.value)}>
            {TARGET_VERSION_NAMES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <dl className="facts">
          <dt>Stil</dt>
          <dd>{p.themeName}</dd>
          <dt>Datei</dt>
          <dd className="mono">{fileName}</dd>
        </dl>

        <section className="export-check" aria-live="polite">
          {p.lighting && <p className="hint">Lichter werden ergänzt …</p>}
          {!p.lighting && p.world.busy && <p className="hint">Blöcke werden berechnet …</p>}
          {p.world.error !== undefined && <p className="status error">Materialisierung fehlgeschlagen: {p.world.error}</p>}
          {r !== undefined && leer && (
            // R1-15: leer ist kein Prüfergebnis – keine roten und grünen Zeilen nebeneinander
            <>
              <p className="export-summary">Nichts zu exportieren</p>
              <p className="hint">Das Projekt hat noch keine Blöcke. Male zuerst einen Raum, übernimm einen Bautyp oder setze ein Bauwerk.</p>
            </>
          )}
          {r !== undefined && !leer && (
            <>
              <p className="export-summary">
                {r.blocks} Blöcke · {r.size.join(' × ')} · Minecraft {r.version}
              </p>
              {r.errors.length > 0 ? (
                <div className="violations errors">
                  <strong>Fehler ({r.errors.length})</strong> – so gebaut, fällt oder bricht etwas im Spiel:
                  <ViolationList items={r.errors} />
                </div>
              ) : (
                <p className="ok">Keine Fehler (Stütze, Schwerkraft, Masken, Block-Hälften).</p>
              )}
              {r.access.length > 0 && (
                <>
                  <strong>Zugang ({r.access.length})</strong> – der Export ist vollständig; diese Stellen im Spiel kurz prüfen:
                  <ul className="violations">
                    {r.access.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </>
              )}
              {r.notes.length > 0 && (
                <div className="violations warnings-box">
                  <strong>Hinweise ({r.notes.length})</strong> – baubar, aber im Spiel evtl. etwas anders als in der Vorschau:
                  <ViolationList items={r.notes} />
                </div>
              )}
              {r.darkSpots.length === 0 && <p className="ok">Keine dunklen Stellen: Der Licht-Pass hat überall Blocklicht ≥ 1 (kein Monster-Spawn).</p>}
              {r.darkSpots.length > 0 && (
                <div className="violations warnings-box">
                  <strong>Warnung: dunkle Stellen</strong> – {r.darkCells} begehbare Zellen ohne Blocklicht, dort können Monster spawnen:
                  <ViolationList items={r.darkSpots} />
                </div>
              )}
            </>
          )}
        </section>

        <p className="hint place-hint">{withCode(placeHint(p.format, p.state.name, p.state.targetVersion.name))}.</p>
        <p className="disclaimer-line">{DISCLAIMER}</p>
        <p className="hint license-line">{OUTPUT_LICENSE_DRAFT}</p>
        {p.blocked !== undefined && <p className="status error">{p.blocked}</p>}

        <div className="row end">
          <button type="button" onClick={onClose}>
            Abbrechen
          </button>
          {p.onGuide !== undefined && (
            <>
              <button type="button" disabled={!guideReady} onClick={() => p.onGuide?.('markdown')} title="Anleitung zum Nachbauen: Materialliste mit Stapeln und Shulker-Kisten, Ebene für Ebene mit Palette und Raster (Markdown)">
                Bauplan (.md)
              </button>
              <button type="button" disabled={!guideReady} onClick={() => p.onGuide?.('csv')} title="Materialliste als Tabelle: Block, Anzahl, Stapel, Plätze, Shulker-Kisten (CSV)">
                Materialliste (.csv)
              </button>
            </>
          )}
          <button type="button" className="primary" disabled={!ready} onClick={p.onDownload}>
            {p.downloading ? 'Wird erstellt …' : leer ? 'Nichts zu exportieren' : r !== undefined && r.errors.length > 0 ? `Trotzdem herunterladen` : `Herunterladen`}
          </button>
        </div>
      </div>
    </div>
  );
}
