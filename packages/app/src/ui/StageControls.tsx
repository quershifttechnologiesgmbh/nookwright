import type { ViewMode } from '../viewer/voxels.js';
import { DropMenu, MenuLabel } from './Menu.js';
import { shortcutHint } from './shortcuts.js';
import { FLOOR_VIEWS, PLAN_LAYOUTS, VIEW_MODES, type FloorView, type PlanLayout, type PreviewOption, type PreviewSource } from './viewModel.js';

/**
 * Bedienung über der 3D-Ansicht (W2-ED U2): Grundriss ein-/ausblenden, „Schnitt ▾“ (Komplett / Dach ab / Wände ab,
 * Schnitt-Regler, Etagen in 3D), Einpassen und „Ansicht ▾“ (Darstellung, Raster, Umgebung, Anordnung, Licht-Leiste).
 * Vorher standen diese zwölf Elemente dauerhaft in einer eigenen Leiste über der Ansicht.
 */
export function StageControls(p: {
  readonly planShown: boolean;
  readonly onTogglePlan: () => void;
  readonly view: ViewMode;
  readonly onView: (v: ViewMode) => void;
  readonly cut: { readonly min: number; readonly max: number; readonly value: number; readonly label: string; readonly onChange: (v: number) => void };
  readonly floorView: FloorView;
  readonly onFloorView: (v: FloorView) => void;
  readonly onFit: () => void;
  /** W10: Kamera in Augenhöhe vor den Eingang; fehlt = kein Haus */
  readonly onEyeLevel?: (() => void) | undefined;
  readonly options: readonly PreviewOption[];
  readonly source: PreviewSource;
  readonly onPreview: (p: PreviewSource) => void;
  readonly grid: boolean;
  readonly onGrid: (on: boolean) => void;
  readonly showAround: boolean;
  readonly onShowAround: (on: boolean) => void;
  /** Anordnung, wenn der Grundriss eingeblendet ist (neben bzw. über der 3D-Ansicht). */
  readonly dock: Exclude<PlanLayout, '3d'>;
  readonly onDock: (d: Exclude<PlanLayout, '3d'>) => void;
  /** Licht-Leiste der Darstellung „Texturen“ zeigen; `undefined` = andere Darstellung. */
  readonly lightBar: boolean | undefined;
  readonly onLightBar: (on: boolean) => void;
}) {
  const viewLabel = VIEW_MODES.find((m) => m.id === p.view)?.label ?? p.view;
  return (
      <div className="stage-controls">
      <button
        type="button"
        className={`stage-plan-toggle${p.planShown ? ' active' : ''}`}
        aria-pressed={p.planShown}
        onClick={p.onTogglePlan}
        title={`Grundriss ${p.planShown ? 'ausblenden' : 'einblenden'} (${shortcutHint('layout.cycle')} wechselt die Anordnung)`}
      >
        Grundriss
      </button>
        <DropMenu label={<>{viewLabel} <span className="caret">▾</span></>} title={`Schnitt: Komplett, Dach ab, Wände ab (Tasten ${VIEW_MODES.map((m) => m.key).join('/')}), Höhe und Etagen`} ariaLabel="Schnitt">
          {() => (
            <div className="menu-form">
              <div className="segmented" role="group" aria-label="Ansicht">
                {VIEW_MODES.map((m) => (
                  <button key={m.id} type="button" className={m.id === p.view ? 'active' : ''} onClick={() => p.onView(m.id)} title={`${m.label} (${m.key})`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <label className="cut" title="Schnitt: nur Blöcke bis zu dieser Höhe zeigen (ins Haus schauen)">
                <span>Höhe</span>
                <input type="range" min={p.cut.min} max={p.cut.max} step={1} value={p.cut.value} onChange={(e) => p.cut.onChange(Number(e.target.value))} aria-label="Schnitthöhe" aria-valuetext={p.cut.label} />
                <span className="cut-label mono">{p.cut.label}</span>
              </label>
              <MenuLabel>Etagen in 3D</MenuLabel>
              <div className="segmented" role="group" aria-label="Etagen in 3D">
                {FLOOR_VIEWS.map((v) => (
                  <button key={v.id} type="button" className={v.id === p.floorView ? 'active' : ''} onClick={() => p.onFloorView(v.id)} title={v.hint}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </DropMenu>
        <button type="button" className="icon-button" onClick={p.onFit} title={`Einpassen: Kamera auf das Haus (${shortcutHint('camera.fit')} oder Doppelklick)`} aria-label="Einpassen">
          ⤢
        </button>
        <button type="button" className="stage-eye" onClick={p.onEyeLevel} disabled={p.onEyeLevel === undefined} title="Augenhöhe: Blick vom Weg vor dem Eingang (1,7 Blöcke über dem Boden). Ziehen oder Zoomen kehrt zur normalen Kamera zurück." aria-label="Augenhöhe">
          Augenhöhe
        </button>
        <DropMenu label={<>Ansicht <span className="caret">▾</span></>} title="Darstellung, Raster, Umgebung, Anordnung des Grundrisses, Licht" ariaLabel="Ansicht">
          {() => (
            <div className="menu-form">
              <MenuLabel>Darstellung</MenuLabel>
              <div className="segmented" role="group" aria-label="Darstellung">
                {p.options.map((m) => (
                  <button key={m.id} type="button" className={m.id === p.source ? 'active' : ''} onClick={() => p.onPreview(m.id)} title={`${m.hint} (${shortcutHint('preview.cycle')} wechselt)`} disabled={m.disabled}>
                    {m.label}
                  </button>
                ))}
              </div>
              <MenuLabel>Grundriss</MenuLabel>
              <div className="segmented" role="group" aria-label="Grundriss">
                {PLAN_LAYOUTS.filter((l) => l.id !== '3d').map((l) => (
                  <button key={l.id} type="button" className={l.id === p.dock ? 'active' : ''} onClick={() => p.onDock(l.id as Exclude<PlanLayout, '3d'>)} title={l.hint}>
                    {l.id === 'split' ? 'Daneben' : 'Darüber'}
                  </button>
                ))}
              </div>
              <label className="check" title="Bodenraster">
                <input type="checkbox" checked={p.grid} onChange={(e) => p.onGrid(e.target.checked)} /> Raster
              </label>
              <label className="check" title="Umgebung (Gelände, Bauwerke) in Vorschau und Export">
                <input type="checkbox" checked={p.showAround} onChange={(e) => p.onShowAround(e.target.checked)} /> Umgebung zeigen
              </label>
              {p.lightBar !== undefined && (
                <label className="check" title={`Licht, Tageszeit, Spawn-Stellen, Helligkeit (Taste ${shortcutHint('light.dayNight')}: Tag/Nacht)`}>
                  <input type="checkbox" checked={p.lightBar} onChange={(e) => p.onLightBar(e.target.checked)} /> Licht-Leiste
                </label>
              )}
            </div>
          )}
        </DropMenu>
      </div>
  );
}
