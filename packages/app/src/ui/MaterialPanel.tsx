/**
 * Tab „Material“ (W3-BL, Konzept W2UX §4.3 U6, Mockup `mock_material`): Materialliste des Hauses (Gelände zuschaltbar)
 * mit Mengen und Stapeln, Block sperren per Klick (der Generator ersetzt ihn passend), Ersatz sichtbar, Preset
 * „Nur leicht farmbar“. Wenige Elemente: acht Zeilen, Suche für den Rest. Die gemessene Palette je Rolle bleibt
 * eingeklappt darunter (früherer Inhalt des Tabs). W13-G: oben der Paletten-Editor (Blockfamilie je Bauteil vor dem
 * Generieren, `PaletteEditor.tsx`).
 */
import type { MaterialResolution, PaletteEntry } from '@mcda/materialize';
import type { BlockRules } from '@mcda/pipeline';
import { useMemo, useState } from 'react';
import { blockLook } from '../blockColors.js';
import { css } from '../colors.js';
import type { WorldWithSurroundings } from '../useWorld.js';
import { blockLabel, materialDataOf, materialText, materialView, type MaterialData, type MaterialScope } from './materialRows.js';
import { PaletteEditor, type PaletteEditorProps } from './PaletteEditor.js';
import { PaletteSection } from './PaletteSection.js';

export interface MaterialPanelProps {
  /** Blöcke des aktuellen Stands bzw. ihre Material-Daten (W14: vom Blöcke-Worker); `undefined`, solange keine berechnet sind. */
  readonly world: WorldWithSurroundings | MaterialData | undefined;
  readonly busy: boolean;
  readonly version: string;
  readonly rules: BlockRules | undefined;
  /** Möbel-Varianten, die die Sperren im Katalog ausblenden. */
  readonly hiddenVariants: number;
  /** Gibt es eine Umgebung (Gelände/Bauwerke)? Sonst kein Schalter „+ Gelände“. */
  readonly hasSurroundings: boolean;
  readonly themeRoles?: ReadonlySet<string> | undefined;
  readonly onPreset: (on: boolean) => void;
  readonly onBan: (block: string, banned: boolean) => void;
  readonly onReplace: (block: string, to: string | undefined) => void;
  readonly onCopy: (text: string) => void;
  /** W13-G: Blockpalette vor dem Generieren (Familie je Bauteil, Tausch, neu würfeln); fehlt = Abschnitt aus. */
  readonly palette?: PaletteEditorProps | undefined;
}

const LOCK = '🔒︎';
const OPEN = '🔓︎';

function Swatch(props: { readonly block: string }) {
  return <i className="mat-swatch" style={{ background: css(blockLook(props.block).color) }} aria-hidden="true" />;
}

export function MaterialPanel(p: MaterialPanelProps) {
  const [scope, setScope] = useState<MaterialScope>('house');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const [allBanned, setAllBanned] = useState(false);
  const effective: MaterialScope = p.hasSurroundings ? scope : 'house';
  const data = useMemo(() => (p.world === undefined ? undefined : materialDataOf(p.world)), [p.world]);
  const view = useMemo(() => materialView(data, p.rules, effective, query, all ? Number.MAX_SAFE_INTEGER : 8), [data, p.rules, effective, query, all]);
  const replacedBlocks = view.banned.filter((b) => b.count > 0).length;
  const presetHint = view.presetOn
    ? `ersetzt ${replacedBlocks} ${replacedBlocks === 1 ? 'Block' : 'Blöcke'} in diesem Bau · ${p.hiddenVariants} Möbel-${p.hiddenVariants === 1 ? 'Variante' : 'Varianten'} ausgeblendet`
    : 'sperrt schwer farmbare Blöcke (Prismarin, Purpur, Endstein, Erzblöcke, Köpfe …) – der Generator ersetzt sie';
  // Vorschläge für eine feste Ersetzung: Blöcke, die der Bau schon benutzt (hat man meist ohnehin)
  const used = useMemo(() => materialView(data, undefined, 'house', '', 6).rows.map((r) => r.item), [data]);
  const palette: readonly PaletteEntry[] | undefined = data?.palette;
  const subs: readonly MaterialResolution[] | undefined = data?.substitutions;

  return (
    <section className="panel material" aria-label="Material">
      <div className="mat-head">
        <div>
          <h2>Material</h2>
          <p className="muted small">
            {p.world === undefined
              ? p.busy ? 'Blöcke werden berechnet …' : 'Noch keine Blöcke berechnet'
              : `${view.total.toLocaleString('de-DE')} Blöcke ${effective === 'house' ? 'im Haus' : 'mit Gelände'}`}
          </p>
        </div>
        {p.hasSurroundings && (
          <div className="segmented" role="group" aria-label="Umfang der Liste">
            <button type="button" className={effective === 'house' ? 'active' : ''} onClick={() => setScope('house')}>Haus</button>
            <button type="button" className={effective === 'all' ? 'active' : ''} onClick={() => setScope('all')} title="Gelände, Pflanzen und Bauwerke mitzählen">+ Gelände</button>
          </div>
        )}
      </div>

      {p.palette !== undefined && (
        <details className="pal-section" open>
          <summary>Blockpalette <span className="muted small">– Farben je Bauteil</span></summary>
          <PaletteEditor {...p.palette} />
        </details>
      )}

      <label className="mat-preset">
        <input type="checkbox" checked={view.presetOn} onChange={(e) => p.onPreset(e.target.checked)} />
        <span>
          <b>Nur leicht farmbare Blöcke</b>
          <span className="muted small">{presetHint}</span>
        </span>
      </label>

      {view.banned.length > 0 && (
        <>
          <h3 className="mat-caption">
            Gesperrt ({view.banned.length}){view.presetUnused > 0 && <span className="muted"> · {view.presetUnused} weitere nicht im Bau</span>}
          </h3>
          <ul className="mat-banned">
            {(allBanned ? view.banned : view.banned.slice(0, 3)).map((b) => (
              <li key={b.block} className={b.left ? 'warn' : ''} title={`${b.block}: ${b.why}`}>
                <span className="mat-banned-main">
                  <s>{blockLabel(b.block)}</s>
                  {b.to.length > 0 && <> → {b.to.map(blockLabel).join(', ')}</>}
                </span>
                <button type="button" className="icon" onClick={() => p.onBan(b.block, false)} title={`${blockLabel(b.block)} wieder erlauben`} aria-label={`${blockLabel(b.block)} wieder erlauben`}>
                  {OPEN}
                </button>
                <span className="mat-banned-meta muted small">
                  {b.left ? 'kein Ersatz – bleibt im Bau' : b.count > 0 ? `${b.count.toLocaleString('de-DE')} Blöcke` : 'nicht im Bau'}
                  <select
                    aria-label={`Ersatz für ${blockLabel(b.block)}`}
                    title="Ersatz: automatisch (ähnliches Material, gleiche Form, Licht gleich hell) oder ein Block, den der Bau schon hat"
                    value={b.fixed ?? ''}
                    onChange={(e) => p.onReplace(b.block, e.target.value === '' ? undefined : e.target.value)}
                  >
                    <option value="">Ersatz: automatisch</option>
                    {[...new Set([...(b.fixed !== undefined ? [b.fixed] : []), ...used])].filter((u) => u !== b.block).map((u) => (
                      <option key={u} value={u}>{blockLabel(u)}</option>
                    ))}
                  </select>
                </span>
              </li>
            ))}
          </ul>
          {!allBanned && view.banned.length > 3 && (
            <button type="button" className="link small" onClick={() => setAllBanned(true)}>
              Alle {view.banned.length} gesperrten zeigen
            </button>
          )}
        </>
      )}

      <input type="search" className="mat-search" placeholder="Block suchen …" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Block suchen" />
      <ul className="mat-rows">
        {view.rows.map((r) => (
          <li key={r.item}>
            <Swatch block={r.item} />
            <span className="mat-name" title={`${blockLabel(r.item)} · ${r.item}`}>{blockLabel(r.item)}</span>
            <span className="mat-count">
              {r.count.toLocaleString('de-DE')}
              {r.stacks !== String(r.count) && <span className="muted"> · {r.stacks}</span>}
            </span>
            <button type="button" className="icon" onClick={() => p.onBan(r.item, true)} title={`Block sperren: ${blockLabel(r.item)} – der Generator ersetzt ihn`} aria-label={`${blockLabel(r.item)} sperren`}>
              {LOCK}
            </button>
          </li>
        ))}
        {view.rows.length === 0 && p.world !== undefined && <li className="muted small">Kein Block passt zur Suche.</li>}
      </ul>
      {view.rowCount > view.rows.length && (
        <button type="button" className="link small" onClick={() => setAll(true)}>
          Alle {view.rowCount} Blöcke zeigen
        </button>
      )}
      <button type="button" className="wide" disabled={p.world === undefined} onClick={() => p.onCopy(materialText(data, effective))}>
        Liste kopieren
      </button>

      <details className="mat-palette">
        <summary>Palette je Rolle</summary>
        <PaletteSection palette={palette} substitutions={subs} version={p.version} busy={p.busy} themeRoles={p.themeRoles} />
      </details>
    </section>
  );
}
