import type { ZoneKind } from '@mcda/terrain';
import type { ReactNode } from 'react';
import { css } from '../colors.js';
import type { SculptChoice, SiteTool } from '../editor/siteGrid.js';
import {
  ANNEX_KINDS, ANNEX_TOWER_DEFAULTS, BRUSH_RANGE, BRUSH_SCULPTS, BRUSH_ZONES, FACING_OPTIONS, FINIALS, GATE_WIDTHS, ROOF_SHAPES, SCULPT_AMOUNT_RANGE, SCULPT_LEVEL_RANGE,
  SCULPT_OPTIONS, TOWER_LEVELS, TOWER_SHAPES, TOWER_TOPS, WALL_PROFILES, ZONE_OPTIONS, fitRoofShape, topHasRoof,
  type AnnexChoice, type GateChoice, type TowerChoice, type WallChoice, type WindmillChoice,
} from '../surroundings.js';
import { Stepper } from './BuildingPanel.js';
import { shortcutHint, type Command } from './shortcuts.js';

/** Bearbeitungsmodus: Haus (Räume, Treppen) oder Umgebung (Gelände, Bauwerke). */
export type EditMode = 'house' | 'site';

/** Umschalter Haus / Umgebung oben in der Werkzeugleiste. */
export function ModeSwitch(props: { mode: EditMode; onMode: (m: EditMode) => void }) {
  return (
    <div className="segmented mode-switch" role="group" aria-label="Bearbeiten">
      <button type="button" className={props.mode === 'house' ? 'active' : ''} aria-pressed={props.mode === 'house'} onClick={() => props.onMode('house')} title="Haus: Räume malen, Treppen, Einrichtung">
        Haus
      </button>
      <button
        type="button"
        className={props.mode === 'site' ? 'active' : ''}
        aria-pressed={props.mode === 'site'}
        onClick={() => props.onMode('site')}
        title="Umgebung: Gelände, Felder und Gärten, Terraforming, Mauern, Türme, Windmühlen"
      >
        Umgebung
      </button>
    </div>
  );
}

const icon = (d: ReactNode): ReactNode => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
    {d}
  </svg>
);

/** Werkzeuge im Modus Umgebung; `command` = Tastenkürzel aus der Tabelle `SITE_SHORTCUTS` (Anzeige über `shortcutHint`). */
const SITE_TOOLS: ReadonlyArray<{ readonly id: SiteTool; readonly label: string; readonly command?: Command; readonly hint: string; readonly icon: ReactNode }> = [
  { id: 'select', label: 'Auswählen', command: 'tool.select', hint: 'Klick wählt Bauwerk oder Zone, Ziehen verschiebt ein Bauwerk', icon: icon(<path d="M6 4 L6 18 L10 14 L13 20 L15.5 19 L12.5 13 L18 13 Z" />) },
  { id: 'zone', label: 'Zone', command: 'tool.paint', hint: 'Feld, Garten, Hof, Teich … aufziehen (übermalt), Weg mit dem Pinsel malen; rechts radiert', icon: icon(<><rect x="4" y="4" width="16" height="16" rx="1.5" strokeDasharray="3 2" /><path d="M8 14 h8 M8 10 h8" /></>) },
  { id: 'sculpt', label: 'Formen', command: 'tool.erase', hint: 'Terraforming: Rechteck anheben, absenken, ebnen oder zurücksetzen, mit dem Pinsel glätten; rechts = natürlich', icon: icon(<path d="M3 18 C7 18 8 8 12 8 C16 8 17 18 21 18" />) },
  { id: 'plot', label: 'Grundstück', hint: 'Rechteck aufziehen = neues Grundstück (Zonen außerhalb entfallen)', icon: icon(<rect x="3" y="5" width="18" height="14" strokeDasharray="4 2" />) },
  { id: 'wall', label: 'Mauer', command: 'site.wall', hint: 'Mauerzug klicken: Punkte setzen, Doppelklick/Enter beendet, Klick auf den ersten Punkt schließt den Ring, Umschalt rastet ein', icon: icon(<path d="M3 17 L9 9 L15 13 L21 6" />) },
  { id: 'gate', label: 'Tor', command: 'site.gate', hint: 'Klick auf eine Mauer setzt ein Tor, rechts entfernt es', icon: icon(<path d="M5 20 V10 A7 7 0 0 1 19 10 V20 M9 20 V13 A3 3 0 0 1 15 13 V20" />) },
  { id: 'tower', label: 'Turm', command: 'tool.stairs', hint: 'Klick setzt einen freistehenden Turm (Gestalt unten), rechts entfernt', icon: icon(<path d="M7 21 V9 H17 V21 M7 9 L12 3 L17 9 M10 13 h4" />) },
  { id: 'windmill', label: 'Windmühle', command: 'site.windmill', hint: 'Klick setzt eine Turmwindmühle, rechts entfernt', icon: icon(<path d="M9.5 21 L10.8 11 H13.2 L14.5 21 Z M12 9 L6 3 M12 9 L18 3 M12 9 L6 15 M12 9 L18 15" />) },
  {
    id: 'annex', label: 'Anbau-Turm', hint: 'Klick an eine Außenwand des Hauses setzt einen Treppen- oder Eckturm mit Tür je Etage ins Haus, rechts entfernt',
    icon: icon(<path d="M3 21 V11 H11 V21 M13 21 V7 H20 V21 M13 7 L16.5 3 L20 7 M11 15 h2" />),
  },
];

/** Radius des runden Pinsels mit Anzeige der Breite (2 × Radius + 1). */
function BrushField(props: { value: number; onChange: (r: number) => void }) {
  return (
    <label className="tool-field">
      <span>Pinsel · {2 * props.value + 1} breit</span>
      <Stepper label="Pinsel-Radius" value={props.value} min={BRUSH_RANGE.min} max={BRUSH_RANGE.max} unit="Blöcke" onChange={props.onChange} />
    </label>
  );
}

/** Werkzeugleiste im Modus Umgebung: Werkzeuge, darunter die Einstellungen des aktiven Werkzeugs. */
export function SiteToolbar(props: {
  header: ReactNode;
  tool: SiteTool;
  onTool: (t: SiteTool) => void;
  zoneKind: ZoneKind;
  onZoneKind: (k: ZoneKind) => void;
  /** Pinsel-Radius für Wege (Zone `path`). */
  pathRadius: number;
  onPathRadius: (r: number) => void;
  sculpt: SculptChoice;
  onSculpt: (s: SculptChoice) => void;
  wall: WallChoice;
  onWall: (w: WallChoice) => void;
  gate: GateChoice;
  onGate: (g: GateChoice) => void;
  tower: TowerChoice;
  onTower: (t: TowerChoice) => void;
  windmill: WindmillChoice;
  onWindmill: (w: WindmillChoice) => void;
  annex: AnnexChoice;
  onAnnex: (a: AnnexChoice) => void;
}) {
  const { tool, sculpt, wall, gate, tower, windmill } = props;
  return (
    <nav className="toolbar site-toolbar" aria-label="Werkzeuge Umgebung">
      {props.header}
      <div className="tool-group" role="group" aria-label="Werkzeug">
        {SITE_TOOLS.map((t) => {
          const key = t.command !== undefined ? shortcutHint(t.command) : '';
          return (
            <button key={t.id} type="button" className={`tool${t.id === tool ? ' active' : ''}`} onClick={() => props.onTool(t.id)} title={`${t.label}${key !== '' ? ` (${key})` : ''} – ${t.hint}`} aria-pressed={t.id === tool}>
              {t.icon}
              <span className="tool-label">{t.label}</span>
              {key !== '' ? <kbd>{key}</kbd> : <span />}
            </button>
          );
        })}
      </div>

      {tool === 'zone' && (
        <div className="palette" role="radiogroup" aria-label="Zonenart">
          <span className="palette-title">Neue Zone</span>
          {ZONE_OPTIONS.map((z) => (
            <button
              key={z.id}
              type="button"
              role="radio"
              aria-checked={z.id === props.zoneKind}
              className={`palette-item${z.id === props.zoneKind ? ' active' : ''}`}
              onClick={() => props.onZoneKind(z.id)}
              title={z.id === 'path' ? `${z.hint} (${shortcutHint('site.path')})` : z.hint}
            >
              <i className="swatch" style={{ background: css(z.color) }} />
              <span>{z.label}</span>
            </button>
          ))}
          {BRUSH_ZONES.has(props.zoneKind) ? (
            <>
              <BrushField value={props.pathRadius} onChange={props.onPathRadius} />
              <span className="hint">Ziehen malt den Weg, rechts radiert. Er wird ans Wegenetz angeschlossen.</span>
            </>
          ) : (
            <span className="hint">Ziehen malt, rechts radiert. Wege zu Tür und Toren legt das Gelände selbst an, eigene mit „Weg“.</span>
          )}
        </div>
      )}

      {tool === 'sculpt' && (
        <div className="stair-options" role="group" aria-label="Formen">
          <span className="palette-title">Formen</span>
          <div className="stair-types" role="radiogroup" aria-label="Pinsel">
            {SCULPT_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={o.id === sculpt.tool}
                className={`palette-item${o.id === sculpt.tool ? ' active' : ''}`}
                onClick={() => props.onSculpt({ ...sculpt, tool: o.id })}
                title={o.id === 'smooth' ? `${o.hint} (${shortcutHint('site.smooth')})` : o.hint}
              >
                {o.label}
              </button>
            ))}
          </div>
          {(sculpt.tool === 'raise' || sculpt.tool === 'lower') && (
            <label className="tool-field">
              <span>Stärke</span>
              <Stepper label="Stärke" value={sculpt.amount} min={SCULPT_AMOUNT_RANGE.min} max={SCULPT_AMOUNT_RANGE.max} unit="Blöcke" onChange={(v) => props.onSculpt({ ...sculpt, amount: v })} />
            </label>
          )}
          {sculpt.tool === 'flatten' && (
            <label className="tool-field">
              <span>Höhe</span>
              <Stepper label="Höhe relativ zur Bodenplatte" value={sculpt.level} min={SCULPT_LEVEL_RANGE.min} max={SCULPT_LEVEL_RANGE.max} unit="Blöcke" onChange={(v) => props.onSculpt({ ...sculpt, level: v })} />
            </label>
          )}
          {BRUSH_SCULPTS.has(sculpt.tool) ? (
            <>
              <BrushField value={sculpt.radius} onChange={(v) => props.onSculpt({ ...sculpt, radius: v })} />
              <span className="hint">Mit dem Pinsel über Kanten und Stufen ziehen, rechts = natürlich.</span>
            </>
          ) : (
            <span className="hint">Rechteck aufziehen (Klick = eine Spalte). Böschungen entstehen von selbst (≤ 1 Block Stufe).</span>
          )}
        </div>
      )}

      {tool === 'plot' && <span className="hint">Rechteck aufziehen = Grundstück. „An Haus anpassen“ im Panel setzt Haus + Rand.</span>}

      {tool === 'wall' && (
        <div className="stair-options" role="group" aria-label="Mauer">
          <span className="palette-title">Mauer</span>
          <div className="stair-types" role="radiogroup" aria-label="Profil">
            {WALL_PROFILES.map((w) => (
              <button key={w.id} type="button" role="radio" aria-checked={w.id === wall.profile} className={`palette-item${w.id === wall.profile ? ' active' : ''}`} onClick={() => props.onWall({ ...wall, profile: w.id })} title={w.hint}>
                {w.label}
              </button>
            ))}
          </div>
          {wall.profile === 'fortress' && (
            <label className="check" title="Türme an Ecken, Enden und alle 24 Blöcke">
              <input type="checkbox" checked={wall.towers} onChange={(e) => props.onWall({ ...wall, towers: e.target.checked })} /> Ecktürme
            </label>
          )}
          <span className="hint">Punkte klicken · Doppelklick beendet · erster Punkt schließt · Umschalt: 45° · Rücktaste: zurück</span>
        </div>
      )}

      {tool === 'gate' && (
        <div className="stair-options" role="group" aria-label="Tor">
          <span className="palette-title">Tor</span>
          <div className="stair-types" role="radiogroup" aria-label="Torbreite">
            {GATE_WIDTHS.map((w) => (
              <button key={w.id} type="button" role="radio" aria-checked={w.id === gate.width} className={`palette-item${w.id === gate.width ? ' active' : ''}`} onClick={() => props.onGate({ ...gate, width: w.id })} title={w.hint}>
                {w.label}
              </button>
            ))}
          </div>
          <label className="check" title="Zwei flankierende Türme (nur Wehrmauer)">
            <input type="checkbox" checked={gate.gatehouse} onChange={(e) => props.onGate({ ...gate, gatehouse: e.target.checked })} /> Torhaus
          </label>
          <span className="hint">Klick auf eine Mauer setzt das Tor, rechts entfernt es.</span>
        </div>
      )}

      {tool === 'tower' && <TowerFields value={tower} onChange={props.onTower} title="Neuer Turm" />}

      {tool === 'annex' && (
        <>
          <AnnexFields value={props.annex} onChange={props.onAnnex} title="Angedockter Turm" />
          <span className="hint">Klick an eine Außenwand · Geschosse = Mindesthöhe, der Turm wächst bis über die Kontaktlinie · rechts entfernt</span>
        </>
      )}

      {tool === 'windmill' && (
        <div className="stair-options" role="group" aria-label="Windmühle">
          <span className="palette-title">Windmühle</span>
          <label className="tool-field">
            <span>Flügel</span>
            <select value={windmill.facing} onChange={(e) => props.onWindmill({ ...windmill, facing: e.target.value as WindmillChoice['facing'] })} aria-label="Flügel zeigen nach">
              {FACING_OPTIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tool-field">
            <span>Geschosse</span>
            <Stepper label="Geschosse" value={windmill.levels} min={TOWER_LEVELS.min} max={TOWER_LEVELS.max} onChange={(v) => props.onWindmill({ ...windmill, levels: v })} />
          </label>
        </div>
      )}
      {/* Nur mit Maus sinnvoll: auf Touch und schmal ausgeblendet (R1-11, lief bei 390 px rechts aus dem Bild) */}
      <span className="hint small mouse-hint">
        Mausrad zoomt, mittlere Maustaste verschiebt. <kbd>{shortcutHint('undo')}</kbd> nimmt zurück.
      </span>
    </nav>
  );
}

/** Angedockter Turm (Werkzeugleiste und Panel): Art (setzt die Vorgaben der Art) und Turmgestalt. */
export function AnnexFields(props: { value: AnnexChoice; onChange: (a: AnnexChoice) => void; title?: string }) {
  const a = props.value;
  return (
    <>
      <div className="stair-options" role="group" aria-label={props.title ?? 'Angedockter Turm'}>
        {props.title !== undefined && <span className="palette-title">{props.title}</span>}
        <div className="stair-types" role="radiogroup" aria-label="Art des Turms">
          {ANNEX_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={k.id === a.kind}
              className={`palette-item${k.id === a.kind ? ' active' : ''}`}
              onClick={() => k.id !== a.kind && props.onChange({ kind: k.id, tower: ANNEX_TOWER_DEFAULTS[k.id] })}
              title={k.hint}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
      <TowerFields value={a.tower} onChange={(t) => props.onChange({ ...a, tower: t })} />
    </>
  );
}

/** Turmgestalt (Werkzeugleiste und Panel): Grundform, Abschluss, Dachform, Glockenfuß, Spitze, Geschosse. */
export function TowerFields(props: { value: TowerChoice; onChange: (t: TowerChoice) => void; title?: string; levels?: boolean }) {
  const t = props.value;
  const roofs = ROOF_SHAPES.filter((r) => r.shapes.includes(t.shape));
  const roofed = topHasRoof(t.top);
  return (
    <div className="stair-options tower-fields" role="group" aria-label={props.title ?? 'Turm'}>
      {props.title !== undefined && <span className="palette-title">{props.title}</span>}
      <div className="stair-types" role="radiogroup" aria-label="Grundform">
        {TOWER_SHAPES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={s.id === t.shape}
            className={`palette-item${s.id === t.shape ? ' active' : ''}`}
            onClick={() => props.onChange({ ...t, shape: s.id, roofShape: fitRoofShape(s.id, t.roofShape) })}
          >
            {s.label}
          </button>
        ))}
      </div>
      <label className="tool-field">
        <span>Abschluss</span>
        <select value={t.top} onChange={(e) => props.onChange({ ...t, top: e.target.value as TowerChoice['top'] })} aria-label="Abschluss">
          {TOWER_TOPS.map((o) => (
            <option key={o.id} value={o.id} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="tool-field">
        <span>Dach</span>
        <select value={fitRoofShape(t.shape, t.roofShape)} disabled={!roofed} onChange={(e) => props.onChange({ ...t, roofShape: e.target.value as TowerChoice['roofShape'] })} aria-label="Dachform" title={roofed ? 'Dachform' : 'Nur bei Dach, Aussicht oder Glocke'}>
          {roofs.map((o) => (
            <option key={o.id} value={o.id} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="tool-field">
        <span>Spitze</span>
        <select value={t.finial} disabled={!roofed} onChange={(e) => props.onChange({ ...t, finial: e.target.value as TowerChoice['finial'] })} aria-label="Turmspitze">
          {FINIALS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="check" title="Glockenfuß: Dachüberstand als Stufe, Ring über der Wand eine halbe Stufe höher">
        <input type="checkbox" checked={t.flare} disabled={!roofed} onChange={(e) => props.onChange({ ...t, flare: e.target.checked })} /> Glockenfuß
      </label>
      <label
        className="check"
        title={t.roofShape === 'bell' ? 'Laternen unter der Traufe – unter der welschen Haube fehlt die tragende Unterseite (die Domäne meldet einen Hinweis)' : 'Hängende Laternen mit Kette unter der Traufe (Ecken bzw. Diagonalen)'}
      >
        <input type="checkbox" checked={t.hangingLanterns} disabled={!roofed} onChange={(e) => props.onChange({ ...t, hangingLanterns: e.target.checked })} /> Traufenlaternen
      </label>
      {t.top === 'belfry' && (
        <label className="check" title="Glocke hängt im Glockenstuhl (Balken, Kette) statt auf dem Boden zu stehen">
          <input type="checkbox" checked={t.bell === 'hanging'} onChange={(e) => props.onChange({ ...t, bell: e.target.checked ? 'hanging' : 'floor' })} /> Glocke hängend
        </label>
      )}
      {props.levels !== false && (
        <label className="tool-field">
          <span>Geschosse</span>
          <Stepper label="Geschosse" value={t.levels} min={TOWER_LEVELS.min} max={TOWER_LEVELS.max} onChange={(v) => props.onChange({ ...t, levels: v })} />
        </label>
      )}
    </div>
  );
}
