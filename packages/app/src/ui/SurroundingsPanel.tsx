import type { Shell } from '@mcda/blueprint';
import { zoneEdge, type Landform, type SiteDecorLevel, type SiteLighting, type SiteState, type SiteTemplateId, type VegetationDensity, type ZoneEdge, type ZoneId, type ZoneKind } from '@mcda/terrain';
import { css } from '../colors.js';
import type { SiteSelection } from '../editor/siteGrid.js';
import {
  EDGE_OPTIONS, FACING_OPTIONS, LIGHTING_OPTIONS, MARGIN_RANGE, SAIL_RANGE, SITE_TEMPLATE_OPTIONS, TOWER_LEVELS, TOWER_SPACING_RANGE, VEGETATION_STEPS, WALL_PROFILES,
  LANDFORM_OPTIONS, SITE_DECOR_OPTIONS, SURFACE_TEXTURE_OPTIONS, WEATHERING_OPTIONS, ZONE_OPTIONS, ensembleOn, hasEdge, houseInPlot, landformOf, lightingLabel, lightingSummary, siteDecorOf, siteSummary, surfaceTextureOf, vegetationOf, weatheringOf,
  annexChoiceOf, annexLabel, parapetNotice, structureById, structureLabel, towerChoiceOf, towerStyleOf, zoneLabel,
  type AnnexChoice, type StructureItem, type SurroundingsState, type TowerChoice, type SurfaceTextureLevel, type WallPatch, type WeatheringLevel, type WindmillPatch,
} from '../surroundings.js';
import type { SurroundingsStatus } from '../useSurroundings.js';
import { Stepper } from './BuildingPanel.js';
import { AnnexFields, TowerFields } from './SiteToolbar.js';
import { durationTitle } from './statusText.js';

export interface SurroundingsActions {
  readonly onTerrain: (on: boolean) => void;
  /** F-Ensemble: Verbindungsgraph (Brücken aus Obergeschossen, Anschluss- und Rundwege) an/aus. */
  readonly onEnsemble: (on: boolean) => void;
  /** feat/site-decor: Grundstücks-Deko aus/wenig/dicht. */
  readonly onSiteDecor: (level: SiteDecorLevel) => void;
  /** WS-Verwitterung: erzählende Verwitterung aus/wenig/stark. */
  readonly onWeathering: (level: 'off' | WeatheringLevel) => void;
  readonly onSurfaceTexture: (level: 'off' | SurfaceTextureLevel) => void;
  readonly onLandform: (form: Landform) => void;
  readonly onStyle: (styleId: string) => void;
  readonly onMargin: (margin: number) => void;
  readonly onReroll: () => void;
  readonly onVegetation: (patch: Partial<VegetationDensity>) => void;
  readonly onResetTerrain: () => void;
  readonly onZoneKind: (id: ZoneId, kind: ZoneKind) => void;
  readonly onZoneEdge: (id: ZoneId, edge: ZoneEdge) => void;
  readonly onLighting: (lighting: SiteLighting) => void;
  readonly onTemplate: (template: SiteTemplateId) => void;
  readonly onRemoveZone: (id: ZoneId) => void;
  readonly onSelect: (sel: SiteSelection | undefined) => void;
  readonly onRemove: (id: string) => void;
  readonly onWall: (id: string, patch: WallPatch) => void;
  readonly onTower: (id: string, choice: TowerChoice) => void;
  readonly onWindmill: (id: string, patch: WindmillPatch) => void;
  readonly onRemoveGate: (wallId: string, index: number) => void;
  /** Angedockter Turm (C4): Art und Gestalt. */
  readonly onAnnex: (id: string, choice: AnnexChoice) => void;
}

const floorShort = (i: number): string => (i === 0 ? 'EG' : `${i}. OG`);

const pct = (v: number): string => `${Math.round(v * 100)} %`;

function VegetationSelect(props: { label: string; title: string; value: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <select value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(Number(e.target.value))} aria-label={`Dichte ${props.label}`} title={props.title}>
      {VEGETATION_STEPS.map((s) => (
        <option key={s} value={s}>
          {pct(s)}
        </option>
      ))}
    </select>
  );
}

/**
 * Panel „Umgebung“: Gelände (an/aus, Stil, Grundstück, Seed, Vegetationsdichte, Zonen, Terraforming), Bauwerke
 * (Liste, Eigenschaften des gewählten), Stand der Berechnung und Hinweise der Kontexte.
 */
export function SurroundingsPanel(props: {
  sur: SurroundingsState | undefined;
  site: SiteState | undefined;
  shell: Shell;
  styles: ReadonlyArray<{ readonly id: string; readonly name: string; readonly description?: string | undefined }>;
  /** Beleuchtung des aktuellen Geländestils (gilt, solange das Grundstück keine eigene Wahl hat). */
  styleLighting: SiteLighting;
  status: SurroundingsStatus;
  selected: SiteSelection | undefined;
  actions: SurroundingsActions;
  /** Baukörper, die es im Projekt noch gibt (BT01/Review e5108a5: Wehrplatte ohne Baukörper). */
  volumeIds?: ReadonlySet<string> | undefined;
}) {
  const { sur, site, actions: a } = props;
  const terrainOn = sur?.terrain === true && site !== undefined;
  const summary = site === undefined ? undefined : siteSummary(site);
  const veg = vegetationOf(site);
  const structures = sur?.structures ?? [];
  const selectedItem = props.selected?.kind === 'structure' ? structureById(sur, props.selected.id) : undefined;
  const selectedZone = props.selected?.kind === 'zone' ? site?.zones.find((z) => z.id === props.selected!.id) : undefined;
  const outside = site !== undefined && terrainOn && !houseInPlot(props.shell, site.plot);
  const r = props.status.result;
  const warnings = props.status.current ? (r?.warnings ?? []) : [];

  return (
    <section className="panel" aria-label="Umgebung">
      <h2>Umgebung</h2>
      <div className="field-grid">
        <span>Gelände</span>
        <label className="check" title="Gelände um das Haus: Relief, Wege, Zonen, Bäume und Büsche (aus: Zonen und Terraforming bleiben erhalten)">
          <input type="checkbox" aria-label="Gelände an" checked={terrainOn} onChange={(e) => a.onTerrain(e.target.checked)} /> an
        </label>
        <span>Brücken und Rundwege</span>
        <label
          className="check"
          title="Verbindungsgraph der Base: Holzbrücke aus einem Obergeschoss zum Wehrgang oder zum Nachbargebäude (wo Lücke und Höhe passen), Wege zu Mauertreppen, Türmen und Toren, dazu einzelne Rundwege zwischen den Außenzonen"
        >
          <input type="checkbox" aria-label="Brücken und Rundwege an" checked={ensembleOn({ surroundings: sur })} onChange={(e) => a.onEnsemble(e.target.checked)} /> an
        </label>
        <span>Deko</span>
        <select
          value={siteDecorOf({ surroundings: sur })}
          disabled={!terrainOn}
          onChange={(e) => a.onSiteDecor(e.target.value as SiteDecorLevel)}
          aria-label="Grundstücks-Deko"
          title="Grundstücks-Deko: Holzplatz, Beete, Bank, Bannermasten, Torbogen, Lampen und mehr; dazu Pferch, Bienenhof, Gräber, Marktstand nach den Räumen"
        >
          {SITE_DECOR_OPTIONS.map((o) => (
            <option key={o.id} value={o.id} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
        <span>Verwitterung</span>
        <select
          value={weatheringOf({ surroundings: sur })}
          onChange={(e) => a.onWeathering(e.target.value as 'off' | WeatheringLevel)}
          aria-label="Verwitterung"
          title="Erzählende Verwitterung: Moos und Schutt im Sockel, Schatten unter Dachkanten, dunklere Dachecken und Kehlen, Regenspuren; wirkt auch ohne Gelände"
        >
          {WEATHERING_OPTIONS.map((o) => (
            <option key={o.id} value={o.id} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
        <span>Oberflächen-Textur</span>
        <select
          value={surfaceTextureOf({ surroundings: sur })}
          onChange={(e) => a.onSurfaceTexture(e.target.value as 'off' | SurfaceTextureLevel)}
          aria-label="Oberflächen-Textur"
          title="Blockmischung aus Nachbarblöcken in Flecken, dunklerer Sockel und Traufe, Dachverlauf, Kontrast an Ecken und Fensterbänken; wirkt auch ohne Gelände"
        >
          {SURFACE_TEXTURE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
        <span>Geländeform</span>
        <span
          className="segmented"
          role="group"
          aria-label="Geländeform"
          title={site === undefined ? 'Braucht ein Gelände (oben einschalten)' : 'Landschaft um das Haus: Hang hinter dem Haus mit Stützmauern, Teich, Findlinge, Moos am Sockel'}
        >
          {LANDFORM_OPTIONS.map((o) => (
            <button key={o.id} type="button" className={o.id === landformOf({ surroundings: sur }) ? 'active' : ''} disabled={site === undefined} onClick={() => a.onLandform(o.id)} title={o.hint}>
              {o.label}
            </button>
          ))}
        </span>
        <span>Stil</span>
        <select value={site?.styleId ?? ''} disabled={site === undefined} onChange={(e) => a.onStyle(e.target.value)} aria-label="Geländestil">
          {site === undefined && <option value="">–</option>}
          {props.styles.map((s) => (
            <option key={s.id} value={s.id} title={s.description}>
              {s.name}
            </option>
          ))}
        </select>
        <span>Rand</span>
        <span className="inline">
          <Stepper label="Rand um das Haus" value={sur?.margin ?? MARGIN_RANGE.standard} min={MARGIN_RANGE.min} max={MARGIN_RANGE.max} unit="Blöcke" onChange={a.onMargin} />
          <button type="button" onClick={() => a.onMargin(sur?.margin ?? MARGIN_RANGE.standard)} disabled={site === undefined} title="Grundstück = Haus + Rand (Zonen außerhalb entfallen, rückgängig machbar)">
            anpassen
          </button>
        </span>
        <span>Seed</span>
        <span className="inline">
          <span className="mono small">{site === undefined ? '–' : `${site.seed} · #${site.rerollCount}`}</span>
          <button type="button" onClick={a.onReroll} disabled={site === undefined} title="Gelände neu würfeln: Relief, Wege, Bäume (Zonen und Terraforming bleiben)">
            Neu würfeln
          </button>
        </span>
        <span>Bäume</span>
        <VegetationSelect label="Bäume" title="Baumdichte (Faktor auf den Geländestil)" value={veg.trees} disabled={site === undefined} onChange={(v) => a.onVegetation({ trees: v })} />
        <span>Büsche</span>
        <VegetationSelect label="Büsche" title="Buschdichte, auch am Hausfundament" value={veg.bushes} disabled={site === undefined} onChange={(v) => a.onVegetation({ bushes: v })} />
        <span>Blumen</span>
        <VegetationSelect label="Blumen und Gras" title="Bodenpflanzen: Blumen, Gras, Farn" value={veg.ground} disabled={site === undefined} onChange={(v) => a.onVegetation({ ground: v })} />
        <span>Licht</span>
        <select
          value={site?.lighting ?? ''}
          disabled={site === undefined}
          onChange={(e) => a.onLighting(e.target.value as SiteLighting)}
          aria-label="Außenbeleuchtung"
          title={LIGHTING_OPTIONS.find((o) => o.id === (site?.lighting ?? props.styleLighting))?.hint}
        >
          {site?.lighting === undefined && <option value="">wie Stil ({lightingLabel(props.styleLighting)})</option>}
          {LIGHTING_OPTIONS.map((o) => (
            <option key={o.id} value={o.id} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
        <span>Vorlage</span>
        <span className="inline">
          {SITE_TEMPLATE_OPTIONS.map((t) => (
            <button key={t.id} type="button" onClick={() => a.onTemplate(t.id)} title={`${t.hint} (rückgängig machbar)`}>
              {t.label}
            </button>
          ))}
        </span>
      </div>
      {summary !== undefined && (
        <p className="hint">
          Grundstück {summary.w} × {summary.d} · {summary.zones} {summary.zones === 1 ? 'Zone' : 'Zonen'} · {summary.sculpted} Spalten geformt
          {summary.sculpted > 0 && (
            <>
              {' '}
              <button type="button" className="link" onClick={a.onResetTerrain} title="Alles Terraforming verwerfen">
                zurücksetzen
              </button>
            </>
          )}
        </p>
      )}
      {site === undefined && <p className="hint">Noch kein Gelände: „an“ legt es um das Haus an – oder gleich mit dem Werkzeug „Zone“ ein Feld aufziehen.</p>}
      {outside && <p className="warn-text">Das Haus ragt aus dem Grundstück – „anpassen“ setzt Haus + Rand.</p>}

      {site !== undefined && site.zones.length > 0 && (
        <details className="section" open>
          <summary>Zonen ({site.zones.length})</summary>
          <ul className="site-list">
            {site.zones.map((z) => (
              <li key={z.id} className={props.selected?.kind === 'zone' && props.selected.id === z.id ? 'selected' : undefined}>
                <i className="swatch" style={{ background: css(ZONE_OPTIONS.find((o) => o.id === z.kind)?.color ?? 0xffffff) }} />
                <button type="button" className="link" onClick={() => a.onSelect({ kind: 'zone', id: z.id })}>
                  {zoneLabel(z.kind)} {z.id}
                </button>
                <span className="muted small">{z.cells.size} Zellen</span>
                <button type="button" className="icon danger" onClick={() => a.onRemoveZone(z.id)} aria-label={`Zone ${z.id} entfernen`} title="Zone entfernen (rückgängig machbar)">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="section" open>
        <summary>Bauwerke ({structures.length})</summary>
        {structures.length === 0 ? (
          <p className="hint">Werkzeuge links: Mauer ziehen, Tor setzen, Turm oder Windmühle per Klick.</p>
        ) : (
          <ul className="site-list">
            {structures.map((item) => (
              <li key={item.id} className={props.selected?.kind === 'structure' && props.selected.id === item.id ? 'selected' : undefined}>
                <button type="button" className="link" onClick={() => a.onSelect({ kind: 'structure', id: item.id })}>
                  {structureLabel(item)}
                </button>
                <button type="button" className="icon danger" onClick={() => a.onRemove(item.id)} aria-label={`${item.id} entfernen`} title="Bauwerk entfernen (Entf; rückgängig machbar)">
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>

      {selectedItem !== undefined && <StructureEditor item={selectedItem} actions={a} volumeIds={props.volumeIds} />}
      {selectedZone !== undefined && (
        <div className="site-editor" aria-label={`Zone ${selectedZone.id}`}>
          <h3>
            Zone {selectedZone.id} · {selectedZone.cells.size} Zellen
          </h3>
          <label className="field">
            <span>Art</span>
            <select value={selectedZone.kind} onChange={(e) => a.onZoneKind(selectedZone.id, e.target.value as ZoneKind)}>
              {ZONE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id} title={o.hint}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {hasEdge(selectedZone.kind) && (
            <label className="field">
              <span>Rand</span>
              <select value={zoneEdge(selectedZone)} onChange={(e) => a.onZoneEdge(selectedZone.id, e.target.value as ZoneEdge)}>
                {EDGE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id} title={o.hint}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="row">
            <button type="button" className="danger" onClick={() => a.onRemoveZone(selectedZone.id)}>
              Entfernen
            </button>
          </div>
        </div>
      )}

      <p className={props.status.error !== undefined ? 'status error' : 'muted small'} role="status" title={durationTitle('Dauer der Umgebung', props.status.ms)}>
        {props.status.error !== undefined
          ? `Umgebung fehlgeschlagen: ${props.status.error}`
          : props.status.busy
            ? 'Umgebung wird berechnet …'
            : r !== undefined
              ? `${r.cells.length} Zellen${r.site !== undefined ? ` · ${r.site.trees.length} Bäume · ${r.site.bushes} Büsche` : ''}${r.site?.features?.lighting !== undefined ? ` · ${lightingSummary(r.site.features.lighting, site?.lighting ?? props.styleLighting)}` : ''}${r.structures !== undefined ? ` · ${r.structures.towers.length} Türme` : ''}`
              : 'Keine Umgebung – Vorschau und Export zeigen nur das Haus.'}
      </p>
      {warnings.length > 0 && (
        <details className="section">
          <summary>Hinweise ({warnings.length})</summary>
          <ul className="warnings">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Eigenschaften des gewählten Bauwerks. */
function StructureEditor(props: { item: StructureItem; actions: SurroundingsActions; volumeIds?: ReadonlySet<string> | undefined }) {
  const { item, actions: a } = props;
  if (item.kind === 'annex') {
    const doors = item.spec.openings ?? [];
    return (
      <div className="site-editor" aria-label={`${annexLabel(item.spec.kind)} ${item.id}`}>
        <h3>
          {annexLabel(item.spec.kind)} {item.id}
        </h3>
        <AnnexFields value={annexChoiceOf(item.spec)} onChange={(c) => a.onAnnex(item.id, c)} />
        <p className="hint">
          {doors.length} {doors.length === 1 ? 'Tür' : 'Türen'} ins Haus ({doors.map((o) => `${floorShort(o.floorIndex)} bei ${o.at[0]},${o.at[1]}`).join(' · ')}) · hängt an der Hauswand: zum Verschieben entfernen und
          neu setzen.
        </p>
        <div className="row">
          <button type="button" className="danger" onClick={() => a.onRemove(item.id)}>
            Entfernen
          </button>
        </div>
      </div>
    );
  }
  if (item.kind === 'tower') {
    return (
      <div className="site-editor" aria-label={`Turm ${item.id}`}>
        <h3>Turm {item.id}</h3>
        <TowerFields value={towerChoiceOf(item.spec)} onChange={(c) => a.onTower(item.id, c)} />
        <p className="hint">
          Mitte {item.spec.center[0]}, {item.spec.center[1]} · Auswählen + Ziehen verschiebt.
        </p>
        <div className="row">
          <button type="button" className="danger" onClick={() => a.onRemove(item.id)}>
            Entfernen
          </button>
        </div>
      </div>
    );
  }
  if (item.kind === 'parapet') {
    // BT01: Die Wehrplatte hängt an ihrem Baukörper – Spalten und Höhe kommen beim Bauen aus der Hülle.
    const m = item.merlon ?? {};
    return (
      <div className="site-editor" aria-label={`Wehrplatte ${item.id}`}>
        <h3>Wehrplatte {item.id}</h3>
        <p className="hint">
          {item.volumeId !== undefined && (
            <>
              Zinnenkranz auf dem Flachdach von Baukörper <span className="mono">{item.volumeId}</span> ·{' '}
            </>
          )}
          Zinne {m.width ?? 2}, Scharte {m.gap ?? 1}.
          Die Platte folgt dem Baukörper: Etage radieren oder Grundriss verkleinern verschiebt die Zinnen mit.
        </p>
        {props.volumeIds !== undefined && parapetNotice(item, props.volumeIds) !== undefined && (
          <p className="status error" role="status">
            {parapetNotice(item, props.volumeIds)}
          </p>
        )}
        <div className="row">
          <button type="button" className="danger" onClick={() => a.onRemove(item.id)}>
            Entfernen
          </button>
        </div>
      </div>
    );
  }
  if (item.kind === 'windmill') {
    const s = item.spec;
    return (
      <div className="site-editor" aria-label={`Windmühle ${item.id}`}>
        <h3>Windmühle {item.id}</h3>
        <div className="field-grid">
          <span>Flügel</span>
          <select value={s.facing ?? 'south'} onChange={(e) => a.onWindmill(item.id, { facing: e.target.value as NonNullable<WindmillPatch['facing']> })} aria-label="Flügel zeigen nach">
            {FACING_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <span>Geschosse</span>
          <Stepper label="Geschosse" value={s.levels ?? 3} min={TOWER_LEVELS.min} max={TOWER_LEVELS.max} onChange={(v) => a.onWindmill(item.id, { levels: v })} />
          <span>Flügellänge</span>
          <Stepper label="Flügellänge" value={s.sailLength ?? 7} min={SAIL_RANGE.min} max={SAIL_RANGE.max} unit="Blöcke" onChange={(v) => a.onWindmill(item.id, { sailLength: v })} />
          <span>Laternen</span>
          <label className="check" title="Hängende Laternen mit Kette unter der Traufe der Kappe">
            <input type="checkbox" checked={s.hangingLanterns === true} onChange={(e) => a.onWindmill(item.id, { hangingLanterns: e.target.checked })} /> an der Kappe
          </label>
        </div>
        <div className="row">
          <button type="button" className="danger" onClick={() => a.onRemove(item.id)}>
            Entfernen
          </button>
        </div>
      </div>
    );
  }
  if (item.kind === 'silo') {
    // W12-C: Hochsilo des Bauernhofs (vom Bautyp gesetzt) – nur Anzeige und Entfernen
    return (
      <div className="site-editor" aria-label={`Silo ${item.id}`}>
        <h3>Silo {item.id}</h3>
        <p className="hint">Ø {2 * (item.spec.radius ?? 3) + 1} · {item.spec.height ?? 16} Blöcke hoch · Kuppel mit Blitzableiter</p>
        <div className="row">
          <button type="button" className="danger" onClick={() => a.onRemove(item.id)}>
            Entfernen
          </button>
        </div>
      </div>
    );
  }
  const p = item.plan;
  const garden = p.profile === 'garden';
  const towerStyle = towerChoiceOf({ ...(p.towerStyle ?? {}), levels: 3 });
  return (
    <div className="site-editor" aria-label={`Mauer ${item.id}`}>
      <h3>
        {garden ? 'Gartenmauer' : 'Wehrmauer'} {item.id}
      </h3>
      <div className="field-grid">
        <span>Profil</span>
        <div className="segmented" role="group" aria-label="Profil">
          {WALL_PROFILES.map((w) => (
            <button key={w.id} type="button" className={w.id === (p.profile ?? 'fortress') ? 'active' : ''} onClick={() => a.onWall(item.id, { profile: w.id })} title={w.hint}>
              {w.label}
            </button>
          ))}
        </div>
        <span>Form</span>
        <label className="check" title="Letzter Punkt → erster Punkt (ab 3 Punkten)">
          <input type="checkbox" checked={p.closed === true} disabled={p.points.length < 3} onChange={(e) => a.onWall(item.id, { closed: e.target.checked })} /> Ring
        </label>
        {!garden && (
          <>
            <span>Türme</span>
            <label className="check" title="Türme an Ecken und Enden">
              <input type="checkbox" checked={p.towers !== 'none'} onChange={(e) => a.onWall(item.id, { towers: e.target.checked ? 'auto' : 'none' })} /> Ecken
            </label>
            <span>Abstand</span>
            <Stepper label="Zwischentürme alle (0 = keine)" value={p.towerSpacing ?? 24} min={TOWER_SPACING_RANGE.min} max={TOWER_SPACING_RANGE.max} unit="Blöcke" disabled={p.towers === 'none'} onChange={(v) => a.onWall(item.id, { towerSpacing: v })} />
          </>
        )}
        <span>Höhe</span>
        <Stepper label="Mauerhöhe" value={p.height ?? (garden ? 2 : 6)} min={2} max={16} unit="Blöcke" onChange={(v) => a.onWall(item.id, { height: v })} />
      </div>
      {!garden && p.towers !== 'none' && <TowerFields value={towerStyle} onChange={(c) => a.onWall(item.id, { towerStyle: towerStyleOf(c) })} title="Mauertürme" levels={false} />}
      {(p.gates?.length ?? 0) > 0 && (
        <ul className="site-list">
          {p.gates!.map((g, i) => (
            <li key={i}>
              <span>
                Tor bei {g.at[0]}, {g.at[1]} · {g.width ?? 3} breit{g.gatehouse === true ? ' · Torhaus' : ''}
              </span>
              <button type="button" className="icon danger" onClick={() => a.onRemoveGate(item.id, i)} aria-label={`Tor ${i + 1} entfernen`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        {p.points.length} Punkte · Tore: Werkzeug „Tor“, Klick auf die Mauer · Auswählen + Ziehen verschiebt.
      </p>
      <div className="row">
        <button type="button" className="danger" onClick={() => a.onRemove(item.id)}>
          Entfernen
        </button>
      </div>
    </div>
  );
}
