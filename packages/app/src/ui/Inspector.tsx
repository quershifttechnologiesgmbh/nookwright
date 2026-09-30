/**
 * Eigenschaften der Auswahl (W2-ED U2, Konzept W2UX §3/§4): Tabs „Auswahl“ | „Material“; „Auswahl“ zeigt nur das
 * Gewählte mit 3–6 Eigenschaften (nichts gewählt = das Haus). Seltenes steht hinter „Mehr Haus-Optionen“ bzw. im
 * Menü „⋯ › Projekt-Info“ – nichts ist gestrichen, nur verlegt (Heimat-Tabelle `controlHomes.ts`).
 */
import type { Floor, InteriorDecor, PlacementId, RoofStyle, ShellRoofFit, StoryState } from '@mcda/blueprint';
import { MOOD_AXES, MOOD_POLES, type MoodVector } from '@mcda/core';
import { DEFAULT_LOOP_DOORS } from '@mcda/archetype';
import type { ExteriorPlan } from '@mcda/pipeline';
import { useEffect, useState, type ReactNode } from 'react';
import type { ExteriorPartInfo } from '../selection.js';
import type { TextureState } from '../textures/assets.js';
import { INTERIOR_DECOR_OPTIONS, ROOF_OPTIONS, STORY_STATE_OPTIONS, WALL_HEIGHT_RANGE, floorLabel, type PlacedView, type ShellStyle } from '../usecases.js';
import { variantLabel, variantTitle } from './hintText.js';
import { ExteriorDecorSection, RoofSection, WallSection } from './ExteriorControls.js';
import { CatalogSection, PaletteSelect, TextureSection } from './Sidebar.js';
import { shortcutHint } from './shortcuts.js';
import { Stepper } from './Stepper.js';
import type { QuoinEffect } from './styleNotes.js';

export type InspectorTab = 'selection' | 'material';

/** Tabs über der Eigenschaftsspalte. */
export function InspectorTabs(props: { tab: InspectorTab; onTab: (t: InspectorTab) => void }) {
  const tabs: ReadonlyArray<readonly [InspectorTab, string, string]> = [
    ['selection', 'Auswahl', 'Eigenschaften des gewählten Teils (nichts gewählt = das Haus)'],
    ['material', 'Material', 'Blöcke des fertigen Baus (gemessen) und Ersatz je Zielversion'],
  ];
  return (
    <div className="insp-tabs" role="tablist" aria-label="Eigenschaften">
      {tabs.map(([id, label, hint]) => (
        <button key={id} type="button" role="tab" aria-selected={props.tab === id} className={props.tab === id ? 'active' : ''} onClick={() => props.onTab(id)} title={hint}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Ein Schritt im Pfad über dem Titel; `onSelect` wählt diese Ebene. */
export interface CrumbStep {
  readonly label: string;
  readonly onSelect: () => void;
}

/**
 * Pfad über dem Titel (W2-ED U3): „‹ Haus · EG“ – jede Ebene ist klickbar, die letzte ist die direkt darüber (wie Esc).
 * Hierarchie: Haus › Etage › Raum › Möbel; Treppe unter ihrer Etage; Dach und Außen-Teil unter dem Haus.
 */
export function Crumb(props: { path: readonly CrumbStep[] }) {
  return (
    <p className="insp-crumb">
      <span aria-hidden="true">‹ </span>
      {props.path.map((s, i) => (
        <span key={s.label}>
          {i > 0 && ' · '}
          <button type="button" className="link" onClick={s.onSelect} title={i === props.path.length - 1 ? `Eine Ebene hoch (${shortcutHint('escape')})` : `${s.label} wählen`}>
            {s.label}
          </button>
        </span>
      ))}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------- Haus

export function HousePanel(p: {
  readonly title: string;
  readonly meta: string;
  readonly themes: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly themeId: string;
  readonly onTheme: (id: string) => void;
  readonly roof: RoofStyle;
  /** Dach wählen (Form, Neigung, Details, Gauben stehen im Dach-Panel). */
  readonly onRoof: () => void;
  readonly exteriorOn: boolean;
  readonly onExterior: (on: boolean) => void;
  readonly onExteriorReroll: () => void;
  /** Nur bei Projekten aus einem Bautyp. */
  readonly type?: { readonly onReroll: () => void; readonly onAdjust: () => void } | undefined;
  /** Zugang (Etagen ohne Treppe, Räume ohne Weg) – wichtig, darum hier und nicht unter „Mehr“. */
  readonly accessHints: readonly string[];
  readonly onMore: () => void;
  readonly empty: boolean;
}) {
  return (
    <section className="panel insp" aria-label="Haus">
      <p className="insp-crumb">Haus</p>
      <h2 className="insp-title">{p.title}</h2>
      <p className="insp-meta">{p.meta}</p>
      <div className="props">
        <label htmlFor="theme">Stil</label>
        <select id="theme" value={p.themeId} onChange={(e) => p.onTheme(e.target.value)} title="Theme: Bauweise und Grundfarben der Blöcke (Blöcke/Texturen und Export); Räume bleiben, nur Signatur-Möbel wechseln">
          {!p.themes.some((t) => t.id === p.themeId) && <option value={p.themeId}>{p.themeId}</option>}
          {p.themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span>Dach</span>
        <button type="button" className="insp-link" onClick={p.onRoof} title="Dach wählen: Form, Neigung, Überstand, Details, Gauben (auch Klick aufs Dach in 3D) – Möbel bleiben">
          <span>{ROOF_OPTIONS.find((r) => r.id === p.roof)?.label ?? p.roof}</span> <span aria-hidden="true">›</span>
        </button>
        <span>Außen-Deko</span>
        <span className="inline">
          <label className="check" title="Fensterläden, Blumenkästen, Portal, Vordach, Vortreppe, Laternen, Schornsteine, Firstschmuck an der Hülle (Vorschau und Export)">
            <input type="checkbox" aria-label="Außen-Deko an" checked={p.exteriorOn} onChange={(e) => p.onExterior(e.target.checked)} /> an
          </label>
          <button type="button" disabled={!p.exteriorOn} onClick={p.onExteriorReroll} title="Außen-Deko neu würfeln: andere Pflanzen, Laden- und Portalformen; Räume bleiben (rückgängig machbar)">
            ⟳ neu
          </button>
        </span>
      </div>
      {p.type !== undefined && (
        <div className="insp-actions">
          <button type="button" onClick={p.type.onReroll} title="Anderer Grundriss mit denselben Parametern – fragt vorher; eigene Räume und Räume mit gesperrten Möbeln bleiben">
            Grundriss neu würfeln <span className="muted small">fixierte bleiben</span>
          </button>
          <button type="button" onClick={p.type.onAdjust} title="Größe, Etagen, Front des Bautyps ändern (neuer Grundriss mit Rückfrage) oder nur seinen Stil anwenden">
            Bautyp anpassen … <span className="muted small">Größe, Front, Keller</span>
          </button>
        </div>
      )}
      <button type="button" className="insp-more" onClick={p.onMore} title="Farbwelt, Nutzungszustand, Mittelgang, Rundgänge, Dach-Details, Außenwände, Außen-Deko-Gruppen, alle Räume neu würfeln">
        Mehr Haus-Optionen <span aria-hidden="true">›</span>
      </button>
      {p.accessHints.length > 0 && (
        <details className="section access-hints">
          <summary className="warn-text">Zugang: {p.accessHints.length} {p.accessHints.length === 1 ? 'Hinweis' : 'Hinweise'}</summary>
          <ul className="warnings">
            {p.accessHints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="insp-note">
        {p.empty
          ? `Links „Raum“ (${shortcutHint('tool.paint')}) wählen und im Grundriss ein Rechteck aufziehen – oder oben „Neu ▾“ für einen Bautyp.`
          : 'Klick auf einen Raum, ein Möbel oder eine Treppe – dann gilt alles hier nur dafür. Gelände, Mauern und Türme: links „Umgebung“.'}
      </p>
    </section>
  );
}

/** Seltene Haus-Einstellungen (vorher Panels „Projekt“ und „Gebäude“): eine eigene, scrollbare Ansicht. */
export function HouseMorePanel(p: {
  readonly onBack: () => void;
  readonly palettes: ReadonlyArray<{ readonly id: string; readonly name: string; readonly mood: string }>;
  readonly paletteId: string | undefined;
  readonly onPalette: (id: string | undefined) => void;
  readonly storyState: StoryState | undefined;
  readonly onStoryState: (s: StoryState | undefined) => void;
  /** feat/theme-moods: Stimmung des Projekts (Feld `mood`, `undefined` = aus) und die Vorgabe des Themes. */
  readonly mood?: MoodVector | undefined;
  readonly themeMood?: MoodVector | undefined;
  readonly onMood?: (m: MoodVector | undefined) => void;
  /** feat/int-decor: Innen-Deko-Stufe (`undefined` = aus). */
  readonly interiorDecor?: InteriorDecor | undefined;
  readonly onInteriorDecor?: (l: InteriorDecor | undefined) => void;
  readonly minAisle: boolean;
  readonly onMinAisle: (on: boolean) => void;
  readonly style: ShellStyle;
  readonly themeDecorate: boolean;
  /** W4-D: Wirkung des Schalters „Eckquader“ beim Theme (`quoinEffect`). */
  readonly quoins?: QuoinEffect | undefined;
  readonly exterior: ExteriorPlan | undefined;
  readonly exteriorMark: ExteriorPartInfo | undefined;
  readonly onStyle: (patch: Partial<ShellStyle>) => void;
  readonly onRerollAll: () => void;
  readonly canRerollAll: boolean;
  readonly shellWarnings: readonly string[];
}) {
  return (
    <section className="panel insp" aria-label="Mehr Haus-Optionen">
      <Crumb path={[{ label: 'Haus', onSelect: p.onBack }]} />
      <h2 className="insp-title">Mehr Haus-Optionen</h2>
      <div className="props">
        {p.palettes.length > 0 && (
          <>
            <label htmlFor="palette">Farbwelt</label>
            <PaletteSelect id="palette" value={p.paletteId} palettes={p.palettes} onChange={p.onPalette} />
          </>
        )}
        <label htmlFor="story-state">Zustand</label>
        <select
          id="story-state"
          value={p.storyState ?? ''}
          aria-label="Nutzungszustand des Gebäudes"
          title="Erzählt dieselbe Geometrie anders: material- und ortsbezogene Spuren aus dem Projekt-Seed (Flechten, Risse, entrindetes Holz). Ohne Zustand bleibt alles wie bisher."
          onChange={(e) => p.onStoryState(e.target.value === '' ? undefined : (e.target.value as StoryState))}
        >
          <option value="">ohne</option>
          {STORY_STATE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
        {p.onInteriorDecor !== undefined && (
          <>
            <label htmlFor="interior-decor">Innen-Deko</label>
            <select
              id="interior-decor"
              value={p.interiorDecor ?? ''}
              aria-label="Innen-Deko des Gebäudes"
              title="Ergänzt Wandschmuck, Pflanzen, Teppiche, Kerzen und Hängendes in Wohn-, Schlaf-, Ess-, Arbeits- und Empfangsräumen. Wege, Türen, Fenster und das Licht-Budget bleiben frei. Aus = wie bisher."
              onChange={(e) => p.onInteriorDecor!(e.target.value === '' ? undefined : (e.target.value as InteriorDecor))}
            >
              <option value="">aus</option>
              {INTERIOR_DECOR_OPTIONS.map((o) => (
                <option key={o.id} value={o.id} title={o.hint}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        )}
        {p.onMood !== undefined && <MoodControl mood={p.mood} themeMood={p.themeMood} onMood={p.onMood} />}
        <span>Mittelgang</span>
        <label className="check" title="P07: Der Mittelgang eines Raumtyps bleibt mindestens auf seiner Mindestbreite, statt bei Platzmangel aufgegeben zu werden. Aus = wie bisher.">
          <input type="checkbox" aria-label="Mittelgang verbindlich" checked={p.minAisle} onChange={(e) => p.onMinAisle(e.target.checked)} /> verbindlich
        </label>
        <span>Rundgänge</span>
        <label className="check" title="Zusatztüren zwischen benachbarten Räumen, die noch nicht verbunden sind – der Weg durchs Haus wird zum Rundgang statt zur Sackgasse. Schlafzimmer, Bad, Schatzkammer und Kerker bleiben ausgenommen. Aus = Türbaum wie bisher.">
          <input
            type="checkbox"
            aria-label="Rundgänge: Zusatztüren"
            checked={(p.style.loopDoors ?? 0) > 0}
            onChange={(e) => p.onStyle({ loopDoors: e.target.checked ? DEFAULT_LOOP_DOORS : undefined })}
          /> Zusatztüren
        </label>
        <span>Fassadenrhythmus</span>
        <label className="check" title="Bauprozess Schritt 4: Fensterachsen im Takt auf flachen Wänden (spiegelsymmetrisch, mit Mindestdichte) und Gauben auf leeren Dachflächen. Erreichbarkeit, Licht und Pflichtmöbel bleiben hart. Aus = wie bisher.">
          <input
            type="checkbox"
            aria-label="Fassadenrhythmus"
            checked={p.style.facadeRhythm === true}
            onChange={(e) => p.onStyle({ facadeRhythm: e.target.checked ? true : undefined })}
          /> Fenster im Takt, Gauben
        </label>
      </div>
      <WallSection style={p.style} themeDecorate={p.themeDecorate} quoins={p.quoins} onStyle={p.onStyle} />
      <ExteriorDecorSection style={p.style} plan={p.exterior} mark={p.exteriorMark} onStyle={p.onStyle} basics={false} />
      <div className="row section">
        <button type="button" onClick={p.onRerollAll} disabled={!p.canRerollAll} title={`Alle Räume neu würfeln (${shortcutHint('room.rerollAll')}) – gesperrte Möbel bleiben`}>
          Alle Räume neu würfeln
        </button>
      </div>
      {p.shellWarnings.length > 0 && (
        <details className="section">
          <summary>Hinweise der Hülle ({p.shellWarnings.length})</summary>
          <ul className="warnings">
            {p.shellWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- Etage

/** Etage (Klick auf die aktive Etage in der Etagen-Leiste): Wandhöhe, Keller darunter, Entfernen. */
export function FloorPanel(p: {
  readonly floor: Floor;
  readonly rooms: number;
  readonly bottom: boolean;
  readonly removable: boolean;
  readonly onHeight: (h: number) => void;
  readonly onAddBelow: () => void;
  readonly onRemove: () => void;
  readonly onUp: () => void;
}) {
  return (
    <section className="panel insp" aria-label="Etage">
      <Crumb path={[{ label: 'Haus', onSelect: p.onUp }]} />
      <h2 className="insp-title">{floorLabel(p.floor.index)}</h2>
      <p className="insp-meta" title={`Etage ${p.floor.index} · Boden y ${p.floor.y0}`}>
        {p.rooms} {p.rooms === 1 ? 'Raum' : 'Räume'} · Boden y {p.floor.y0}
      </p>
      <div className="props">
        <span title="Lichte Höhe (Luftblöcke zwischen Boden und Decke) – wirkt auf Wände, Dach, Fenster, Treppenlänge und Einrichtung">Wandhöhe</span>
        <Stepper label={`Wandhöhe ${floorLabel(p.floor.index)}`} value={p.floor.height} min={WALL_HEIGHT_RANGE.min} max={WALL_HEIGHT_RANGE.max} unit="Blöcke" onChange={p.onHeight} />
      </div>
      <div className="row">
        {p.bottom && (
          <button type="button" onClick={p.onAddBelow} title="Neue Etage unter der untersten (Keller)">
            + Keller darunter
          </button>
        )}
        {p.removable && (
          <button type="button" className="danger" onClick={p.onRemove} title={`${floorLabel(p.floor.index)} entfernen (fragt bei Räumen nach; rückgängig machbar)`}>
            Etage entfernen
          </button>
        )}
      </div>
      <p className="insp-note">Neue Etage oben: „+“ in der Etagen-Leiste. Treppe: Werkzeug {shortcutHint('tool.stairs')}.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- Möbel

/** Gewähltes Möbel (Klick in 3D oder in der Möbelliste): Sperren (L), Entfernen; Umfang = nur dieses Möbel. */
export function PlacementPanel(p: {
  readonly view: PlacedView;
  readonly crumb: readonly CrumbStep[];
  readonly onToggleLock: (id: PlacementId) => void;
  readonly onRemove: (id: PlacementId) => void;
  readonly fromLight: boolean;
  /** W2-ED U5: drehen (Q), Variante ◀ ▶, tauschen gegen passende Alternativen. */
  readonly onRotate?: (() => void) | undefined;
  readonly variant?: { readonly label: string; readonly onPrev: () => void; readonly onNext: () => void } | undefined;
  readonly swaps?: ReadonlyArray<{ readonly componentId: string; readonly variantId?: string | undefined; readonly name: string }> | undefined;
  readonly onSwap?: ((componentId: string, variantId: string | undefined) => void) | undefined;
  readonly children?: ReactNode;
}) {
  const { placement, def } = p.view;
  const name = def.name ?? def.id;
  const variant = placement.variantId === undefined ? undefined : variantLabel(def.variants, placement.variantId);
  return (
    <section className="panel insp" aria-label="Möbel">
      <Crumb path={p.crumb} />
      <h2 className="insp-title">{name}</h2>
      <p className="insp-meta" title={placement.variantId === undefined ? undefined : variantTitle(def.variants, placement.variantId, name)}>
        {[variant === undefined ? undefined : /^variante/i.test(variant) ? variant : `Variante ${variant}`, placement.origin === 'manual' ? 'von Hand gesetzt' : p.fromLight ? 'vom Licht-Pass' : undefined, placement.locked ? 'gesperrt' : undefined]
          .filter((x) => x !== undefined)
          .join(' · ') || 'automatisch eingerichtet'}
      </p>
      <div className="row">
        <button
          type="button"
          className={placement.locked ? 'primary' : ''}
          aria-pressed={placement.locked}
          onClick={() => p.onToggleLock(placement.id)}
          title={`${placement.locked ? 'Entsperren' : 'Sperren: bleibt bei Neu würfeln, Stil- und Bautyp-Änderungen'} (${shortcutHint('placement.lock')})`}
        >
          {placement.locked ? 'Gesperrt' : 'Sperren'} <kbd>{shortcutHint('placement.lock')}</kbd>
        </button>
        {p.onRotate !== undefined && (
          <button type="button" onClick={p.onRotate} title={`Drehen: 90° im Uhrzeigersinn um die Mitte, aufgesetzte Teile drehen mit (${shortcutHint('placement.rotate')})`}>
            ⟳ Drehen <kbd>{shortcutHint('placement.rotate')}</kbd>
          </button>
        )}
        <button type="button" className="danger" onClick={() => p.onRemove(placement.id)} title={`Möbel entfernen samt aufgesetzten Teilen (${shortcutHint('room.delete')}); Neu würfeln füllt nicht wieder auf`}>
          Entfernen
        </button>
      </div>
      {p.variant !== undefined && (
        <div className="props section">
          <span>Variante</span>
          <span className="inline variant">
            <button type="button" className="icon-button" onClick={p.variant.onPrev} aria-label="Vorige Möbel-Variante" title="Vorige Variante dieses Möbels (gleiche Stelle)">
              ◀
            </button>
            <span className="mono variant-no">{p.variant.label}</span>
            <button type="button" className="icon-button" onClick={p.variant.onNext} aria-label="Nächste Möbel-Variante" title="Nächste Variante dieses Möbels (gleiche Stelle)">
              ▶
            </button>
          </span>
        </div>
      )}
      {p.swaps !== undefined && p.swaps.length > 0 && p.onSwap !== undefined && (
        <div className="section swap">
          <p className="insp-crumb">Tauschen gegen</p>
          <div className="swap-grid">
            {p.swaps.map((o) => (
              <button key={o.componentId} type="button" onClick={() => p.onSwap!(o.componentId, o.variantId)} title={`${o.name} an dieselbe Stelle setzen (passt geprüft; danach von Hand gesetzt)`}>
                {o.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="insp-note">
        Verschieben: Pfeiltasten (1 Feld) oder ziehen in Grundriss und 3D; aufgesetzte Teile wandern mit. Nur dieses Möbel ändert sich.
      </p>
      {p.children}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- Dach

/**
 * Das Dach (W2-ED U3: Klick aufs Dach in 3D oder „Dach ›“ im Haus-Panel): Form, Neigung, Überstand, Details, Gauben.
 * Umfang: nur die Hülle – Räume und Möbel bleiben (gemessen: 15/15 Räume bitgleich, W2UX §2.3).
 */
export function RoofPanel(p: {
  readonly style: ShellStyle; readonly dormerCount: number | undefined; readonly roofFit?: readonly ShellRoofFit[] | undefined;
  readonly onStyle: (patch: Partial<ShellStyle>) => void; readonly onUp: () => void;
}) {
  return (
    <section className="panel insp" aria-label="Dach">
      <Crumb path={[{ label: 'Haus', onSelect: p.onUp }]} />
      <h2 className="insp-title">Dach</h2>
      <p className="insp-meta">Nur die Hülle wird neu gebaut – Räume und Möbel bleiben.</p>
      <RoofSection style={p.style} dormerCount={p.dormerCount} roofFit={p.roofFit} onStyle={p.onStyle} />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- Projekt-Info

/** Menü „⋯ › Projekt-Info und Texturen“: Seed, Umfang, Licht, Texturen (eigenes JAR), Katalog. */
export function ProjectInfoDialog(p: {
  readonly facts: ReadonlyArray<readonly [string, ReactNode]>;
  readonly texture: {
    readonly state: TextureState;
    readonly notice: { readonly text: string; readonly error: boolean } | undefined;
    readonly cached: boolean;
    readonly canReadJar: boolean;
    readonly onLoadJar: (file: File) => void;
    readonly onClearCache: () => void;
  };
  readonly catalog: { readonly summary: string; readonly warnings: readonly string[] };
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <section className="modal info-dialog" role="dialog" aria-modal="true" aria-labelledby="info-title" style={{ maxWidth: 520 }}>
        <header className="modal-head">
          <h2 id="info-title">Projekt-Info</h2>
          <button type="button" onClick={p.onClose} aria-label="Schließen">
            ✕
          </button>
        </header>
        <dl className="facts">
          {p.facts.map(([k, v]) => (
            <div key={k} className="fact">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <TextureSection {...p.texture} />
        <CatalogSection summary={p.catalog.summary} warnings={p.catalog.warnings} />
      </section>
    </div>
  );
}

/**
 * W14: Stimmungsregler wie die Dichte- und Außen-Regler – beim Ziehen nur der Wert, übernommen erst beim Loslassen bzw.
 * per Tastatur. Vorher richtete jeder Zwischenschritt das Haus neu ein (je Schritt eine Einrichtung + Licht-Pass).
 */
function MoodSlider(props: { readonly value: number; readonly label: string; readonly onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<number | undefined>(undefined);
  const commit = (): void => {
    if (draft !== undefined && draft !== props.value) props.onCommit(draft);
    setDraft(undefined);
  };
  return (
    <input
      style={{ width: '100%', minWidth: 0 }}
      type="range" min={-1} max={1} step={0.25} value={draft ?? props.value}
      aria-label={props.label}
      onChange={(e) => setDraft(Number(e.target.value))}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
    />
  );
}

/**
 * feat/theme-moods: Schalter „Stimmung“ und je Achse ein Regler −1 … +1 (Schritt 0,25). Aus = Feld `mood` fehlt
 * (bitgleich zu vorher); an = `{}` (Vorgabe des Themes), ein Regler überschreibt seine Achse.
 */
function MoodControl(p: { readonly mood: MoodVector | undefined; readonly themeMood: MoodVector | undefined; readonly onMood: (m: MoodVector | undefined) => void }) {
  const on = p.mood !== undefined;
  return (
    <>
      <span>Stimmung</span>
      <label className="check" title="Weiche Gewichte je Stimmung: Möbelwahl, Deko-Menge, Verwitterung. Erreichbarkeit, Licht und Pflichtmöbel bleiben hart. Aus = wie bisher.">
        <input type="checkbox" aria-label="Stimmung an" checked={on} onChange={(e) => p.onMood(e.target.checked ? {} : undefined)} /> an
      </label>
      {on &&
        MOOD_AXES.map((axis) => {
          const [lo, hi] = MOOD_POLES[axis];
          const value = p.mood?.[axis] ?? p.themeMood?.[axis] ?? 0;
          return (
            <label key={axis} className="mood-axis" style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '5.5em minmax(0, 1fr) 6.5em', gap: 6, alignItems: 'center', paddingRight: 8, fontSize: '0.9em' }}>
              <span style={{ textAlign: 'right' }}>{lo}</span>
              <MoodSlider value={value} label={`Stimmung ${lo} bis ${hi}`} onCommit={(v) => p.onMood({ ...p.mood, [axis]: v })} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{hi}</span>
            </label>
          );
        })}
    </>
  );
}
