import type { PlacementId, Room, RoomShellInfo } from '@mcda/blueprint';
import type { Catalog } from '@mcda/catalog';
import type { RoomQuality } from '@mcda/furnishing';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { css, roomTypeColor } from '../colors.js';
import { variantLabel, variantTitle } from './hintText.js';
import { plural } from './plural.js';
import { NO_TEXTURES_HINT, type TextureState } from '../textures/assets.js';
import { DENSITY_RANGE, MAX_NAME_LENGTH, floorLabel, type PlacedView } from '../usecases.js';
import { densityLabel, qualitySummary } from './quality.js';
import { groupRoomTypes, roomTypeInfos } from './roomTypeGroups.js';
import { shortcutHint } from './shortcuts.js';

/** Raumtyp eines Raums: nach Gruppen (roomTypeGroups.ts); Tippen im geöffneten Feld springt zum Namen. */
export function RoomTypeSelect(props: { catalog: Catalog; value: string; onChange: (id: string) => void; id?: string }) {
  const groups = useMemo(() => groupRoomTypes(roomTypeInfos(props.catalog)), [props.catalog]);
  const known = groups.some((g) => g.items.some((t) => t.id === props.value));
  return (
    <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      {!known && <option value={props.value}>{props.value} (unbekannt)</option>}
      {groups.map((g) => (
        <optgroup key={g.id} label={g.label}>
          {g.items.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------------------------- Raum

interface RoomPanelProps {
  readonly catalog: Catalog;
  readonly room: Room;
  /** Fortlaufende Anzeige-Nummer der Etage (Nutzerreview: keine springenden R-IDs); fehlt = ohne Nummer. */
  readonly roomNo?: number | undefined;
  readonly geometry: RoomShellInfo | undefined;
  readonly roomSeed: number;
  readonly views: readonly PlacedView[];
  readonly warnings: readonly string[];
  readonly selectedPlacement: PlacementId | undefined;
  readonly onType: (id: string) => void;
  readonly onReroll: () => void;
  readonly onDelete: () => void;
  readonly onToggleLock: (placementId: PlacementId) => void;
  readonly onLockAll: (locked: boolean) => void;
  readonly onSelectPlacement: (placementId: PlacementId | undefined) => void;
  /** IDs der Platzierungen, die der Licht-Pass ergänzt hat (Kennzeichnung in der Liste). */
  readonly lightIds: ReadonlySet<string>;
  /** Wandhöhe der Etage des Raums. */
  readonly floorHeight: number | undefined;
  /** Einrichtungsdichte (1 = Standard des Raumtyps). */
  readonly density: number;
  readonly onDensity: (density: number) => void;
  /** Qualitätswert der letzten automatischen Einrichtung (fehlt nach dem Laden). */
  readonly quality: RoomQuality | undefined;
  /** Kein Weg vom Eingang in diesen Raum (Review 3: Wertung nannte „sehr gut“ ohne Tür/Treppe). */
  readonly unreachable?: boolean | undefined;
  readonly onRemovePlacement: (placementId: PlacementId) => void;
  /** Pfad über dem Titel („‹ Haus · EG“, W2-ED U3). */
  readonly crumb?: ReactNode;
  /** Weitere Eigenschaften (Zeilen im Raster, z. B. Variante ◀ ▶, U4). */
  readonly extra?: ReactNode;
  /** Weitere Knöpfe vor „Löschen“. */
  readonly actions?: ReactNode;
  /** Variante ◀ ▶ (W2-ED U4): springt zu einem Wurf; ▶ = Neu würfeln. Fehlt = nur „Neu würfeln“. */
  readonly onVariant?: ((variant: number) => void) | undefined;
  /** Raum fixieren (W2-ED U4): übersteht Bautyp-Neubau und „Alle neu würfeln“. */
  readonly onFix?: ((fixed: boolean) => void) | undefined;
  /** F „Bereich neu einrichten“ (`BlockRefurnishRow`); fehlt = Schalter aus. */
  readonly block?: ReactNode;
}

/**
 * Raum (W2-ED U2): Titel, eine Meta-Zeile, Raumtyp, Einrichtung (Dichte), Neu würfeln (R), Löschen, Qualität als eine
 * Zeile; die Möbelliste ist eingeklappt („Möbel (17) · 2 gesperrt“) – gewählt wird ein Möbel meist in 3D oder im
 * Grundriss. Seed, Zellen und Wandhöhe stehen im Tooltip der Meta-Zeile.
 */
export function RoomPanel(p: RoomPanelProps) {
  const roots = p.views.filter((v) => v.placement.parentId === undefined);
  const children = (id: string) => p.views.filter((v) => v.placement.parentId === id);
  const locked = p.views.filter((v) => v.placement.locked).length;
  const allLocked = p.views.length > 0 && locked === p.views.length;
  const item = (v: PlacedView, kids?: ReactNode) => (
    <FurnitureItem
      key={v.placement.id}
      view={v}
      selected={v.placement.id === p.selectedPlacement}
      fromLight={p.lightIds.has(v.placement.id)}
      onToggleLock={p.onToggleLock}
      onSelect={p.onSelectPlacement}
      onRemove={p.onRemovePlacement}
    >
      {kids}
    </FurnitureItem>
  );
  const g = p.geometry;
  const stairs = [...new Set((g?.stairs ?? []).map((a) => a.linkId))];
  const facts = [
    `${floorLabel(p.room.floorIndex)}${p.floorHeight !== undefined ? ` · Wandhöhe ${p.floorHeight}` : ''}`,
    `${p.room.cells.size} Zellen`,
    ...(stairs.length > 0 ? [`Treppe ${stairs.join(', ')}`] : []),
    `Raum-Seed ${p.roomSeed} (${p.room.rerollCount}× gewürfelt)`,
  ].join(' · ');
  let typeName = p.room.roomTypeId;
  try {
    typeName = p.catalog.roomType(p.room.roomTypeId).name;
  } catch {
    // unbekannter Raumtyp (Datei aus neuerer Version): ID zeigen
  }
  return (
    <section className="panel insp" aria-label="Raum">
      {p.crumb}
      <h2 className="insp-title">
        <i className="swatch" style={{ background: css(roomTypeColor(p.room.roomTypeId)) }} /> {p.roomNo === undefined ? typeName : `${typeName} · ${p.roomNo}`}
      </h2>
      <p className="insp-meta" title={facts}>
        {g?.interior.size ?? 0} Felder innen · {plural(g?.doors.length ?? 0, 'Tür', 'Türen')} · {plural(g?.windows.length ?? 0, 'Fenster', 'Fenster')}
      </p>
      <div className="props">
        <label htmlFor="room-type">Raumtyp</label>
        <RoomTypeSelect id="room-type" catalog={p.catalog} value={p.room.roomTypeId} onChange={p.onType} />
        <span>Einrichtung</span>
        <DensityField value={p.density} onCommit={p.onDensity} />
        <span>Variante</span>
        <span className="inline variant">
          {p.onVariant !== undefined && (
            <button type="button" className="icon-button" disabled={p.room.rerollCount === 0} onClick={() => p.onVariant!(p.room.rerollCount - 1)} aria-label="Vorige Variante" title="Vorige Variante (derselbe Wurf wie vorher – deterministisch)">
              ◀
            </button>
          )}
          <span className="mono variant-no" title={`Wurf ${p.room.rerollCount + 1} dieses Raums`}>
            {p.room.rerollCount + 1}
          </span>
          <button type="button" className="primary" onClick={p.onReroll} aria-label="Neu würfeln (nächste Variante)" title={`Neu würfeln (${shortcutHint('room.reroll')}) – nächste Variante; nur dieser Raum, gesperrte Möbel bleiben`}>
            ▶ <kbd>{shortcutHint('room.reroll')}</kbd>
          </button>
        </span>
        {p.extra}
      </div>
      {p.block}
      <div className="row">
        {p.onFix !== undefined && (
          <button
            type="button"
            className={p.room.fixed === true ? 'active-toggle' : ''}
            aria-pressed={p.room.fixed === true}
            onClick={() => p.onFix!(p.room.fixed !== true)}
            title={`${p.room.fixed === true ? 'Fixierung lösen' : 'Raum fixieren: bleibt bei „Grundriss neu würfeln“, Bautyp-Änderungen und „Alle neu würfeln“'} (${shortcutHint('placement.lock')})`}
          >
            {p.room.fixed === true ? 'Fixiert' : 'Raum fixieren'} <kbd>{shortcutHint('placement.lock')}</kbd>
          </button>
        )}
        {p.actions}
        <button type="button" className="danger" onClick={p.onDelete} title={`Raum löschen (${shortcutHint('room.delete')})`}>
          Löschen
        </button>
      </div>
      <QualityBox quality={p.quality} unreachable={p.unreachable === true} />
      <details className="section" open={p.selectedPlacement !== undefined}>
        <summary>
          Möbel ({p.views.length}){locked > 0 && <span className="muted"> · {locked} gesperrt</span>}
        </summary>
        {p.views.length === 0 ? (
          <p className="hint">Keine Möbel.</p>
        ) : (
          <>
            <div className="row">
              <button type="button" onClick={() => p.onLockAll(!allLocked)} title="Alle Möbel dieses Raums sperren bzw. entsperren">
                {allLocked ? 'Alle entsperren' : 'Alle sperren'}
              </button>
            </div>
            <ul className="furniture">{roots.map((v) => item(v, children(v.placement.id).map((c) => item(c))))}</ul>
          </>
        )}
      </details>
      {p.warnings.length > 0 && (
        <details className="section">
          <summary>Hinweise ({p.warnings.length})</summary>
          <ul className="warnings">
            {p.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
/**
 * Dichte-Regler: zeigt beim Ziehen nur den Wert und übernimmt erst beim Loslassen bzw. per Tastatur – ein
 * Undo-Schritt statt vieler.
 */
function DensityField(props: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<number | undefined>(undefined);
  const shown = draft ?? props.value;
  const commit = () => {
    if (draft !== undefined && draft !== props.value) props.onCommit(draft);
    setDraft(undefined);
  };
  return (
    <span className="range-field density" title="Wie voll der Raum wird: 0 = nur Pflichtobjekte, 1 = Standard des Raumtyps, 2 = doppeltes Budget. Richtet den Raum mit demselben Seed neu ein; gesperrte Möbel bleiben.">
      <input
        type="range"
        aria-label="Einrichtung (Dichte)"
        min={DENSITY_RANGE.min}
        max={DENSITY_RANGE.max}
        step={DENSITY_RANGE.step}
        value={shown}
        aria-valuetext={densityLabel(shown)}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="range-value">{densityLabel(shown)}</span>
    </span>
  );
}

/** Qualität als eine Zeile (Balken + Prozent); Begründung, Teilwerte und Vermerke im Tooltip, Warnungen darunter. */
function QualityBox({ quality, unreachable }: { quality: RoomQuality | undefined; unreachable: boolean }) {
  if (quality === undefined) {
    return (
      <p className="insp-quality muted" title="Erst nach dem nächsten Einrichten bekannt (Neu würfeln)">
        Qualität: –{unreachable && <span className="warn-text"> · kein Zugang vom Eingang</span>}
      </p>
    );
  }
  const q = qualitySummary(quality, { unreachable });
  const tip = [q.why, ...q.lines.map((l) => `${l.label}: ${l.percent} %${l.detail !== undefined ? ` (${l.detail})` : ''}`), ...q.notes].join('\n');
  return (
    <div className={`insp-quality quality ${q.tone}`} title={tip}>
      <span>Qualität</span>
      <meter min={0} max={100} low={50} high={70} optimum={100} value={q.percent} aria-label={`Qualität ${q.percent} %`} />
      <strong>
        {q.percent} % · {q.grade}
      </strong>
      {q.alerts.length > 0 && (
        <ul className="quality-alerts">
          {q.alerts.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FurnitureItem(props: {
  view: PlacedView;
  selected: boolean;
  fromLight: boolean;
  onToggleLock: (id: PlacementId) => void;
  onSelect: (id: PlacementId | undefined) => void;
  onRemove: (id: PlacementId) => void;
  children?: ReactNode;
}) {
  const { placement, def } = props.view;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // Nur die eigene Spalte scrollen (nicht die Seite): Ein Klick in 3D soll die 3D-Ansicht nicht verschieben
    const el = ref.current;
    const box = el?.closest<HTMLElement>('.inspector');
    if (!props.selected || el == null || box == null || box.scrollHeight <= box.clientHeight) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - b.height / 3;
  }, [props.selected]);
  const hasChildren = Array.isArray(props.children) && props.children.length > 0;
  return (
    <li ref={ref}>
      <div className={`furniture-row${props.selected ? ' selected' : ''}`}>
        <input
          type="checkbox"
          checked={placement.locked}
          onChange={() => props.onToggleLock(placement.id)}
          aria-label={`${def.name ?? def.id} sperren`}
          title={placement.locked ? 'Gesperrt: bleibt beim Neu-Würfeln' : 'Sperren: übersteht Neu-Würfeln'}
        />
        <button type="button" className="link" onClick={() => props.onSelect(props.selected ? undefined : placement.id)} aria-pressed={props.selected}>
          {def.name ?? def.id}
          {placement.variantId !== undefined && (
            <span className="muted" title={variantTitle(def.variants, placement.variantId, def.name ?? def.id)}> · {variantLabel(def.variants, placement.variantId)}</span>
          )}
        </button>
        {placement.locked ? (
          <span className="badge">gesperrt</span>
        ) : (
          props.fromLight && (
            <span className="badge light" title="Vom Licht-Pass ergänzt (Spawn-Schutz, Stimmung des Raumtyps)">
              Licht-Pass
            </span>
          )
        )}
        <button type="button" className="icon remove" onClick={() => props.onRemove(placement.id)} title="Möbel entfernen (samt aufgesetzten Teilen); Neu würfeln füllt wieder auf" aria-label={`${def.name ?? def.id} entfernen`}>
          ✕
        </button>
      </div>
      {hasChildren && <ul>{props.children}</ul>}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------- Projekt

/** Projektname: Eingabe mit Übernahme bei Enter/Verlassen, Esc verwirft. */
export function NameField(props: { name: string; onRename: (name: string) => void; id?: string; className?: string }) {
  const [draft, setDraft] = useState(props.name);
  const [shown, setShown] = useState(props.name);
  if (shown !== props.name) {
    // Name von außen geändert (Laden, Neues Projekt) → Eingabe nachziehen
    setShown(props.name);
    setDraft(props.name);
  }
  const commit = () => {
    if (draft.trim() === '' || draft === props.name) setDraft(props.name);
    else props.onRename(draft);
  };
  return (
    <input
      id={props.id}
      className={props.className}
      type="text"
      value={draft}
      maxLength={MAX_NAME_LENGTH}
      aria-label="Projektname (auch Dateiname beim Export)"
      title="Projektname (auch Dateiname beim Export) – Enter übernimmt, Esc verwirft"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setDraft(props.name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Reihenfolge und Beschriftung der Stimmungen im Paletten-Auswahlfeld (research/54 §1.4). */
const MOOD_ORDER = ['gemuetlich', 'festlich', 'magisch', 'winterlich', 'duester', 'verfallen'] as const;
const MOOD_LABELS: Readonly<Record<string, string>> = {
  gemuetlich: 'Gemütlich', festlich: 'Festlich', magisch: 'Magisch', winterlich: 'Winterlich', duester: 'Düster', verfallen: 'Verfallen',
};

/** Farbwelt neben dem Theme (Q4, research/54), nach Stimmung gruppiert; leer = ohne Palette. */
export function PaletteSelect(props: {
  id?: string;
  value: string | undefined;
  palettes: ReadonlyArray<{ readonly id: string; readonly name: string; readonly mood: string }>;
  onChange: (id: string | undefined) => void;
}) {
  return (
    <select
      id={props.id}
      value={props.value ?? ''}
      onChange={(e) => props.onChange(e.target.value === '' ? undefined : e.target.value)}
      title="Farbwelt neben dem Stil: färbt Wände, Dach, Rahmen, Holz, Boden, Akzent, Glas, Licht und Bewuchs um; die Bauweise des Stils bleibt"
    >
      <option value="">Ohne Farbwelt (Farben des Stils)</option>
      {MOOD_ORDER.map((mood) => {
        const inMood = props.palettes.filter((p) => p.mood === mood);
        if (inMood.length === 0) return null;
        return (
          <optgroup key={mood} label={MOOD_LABELS[mood] ?? mood}>
            {inMood.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

/** Texturen: Quelle, eigenes JAR laden (lokal), Cache. */
export function TextureSection(props: {
  state: TextureState;
  notice: { readonly text: string; readonly error: boolean } | undefined;
  cached: boolean;
  canReadJar: boolean;
  onLoadJar: (file: File) => void;
  onClearCache: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const s = props.state;
  const source =
    s.kind === 'ready'
      ? s.assets.label
      : s.kind === 'available'
        ? `${s.source.label} (lädt beim Öffnen)`
        : s.kind === 'loading'
          ? s.message
          : s.kind === 'probing'
            ? 'Suche …'
            : 'keine';
  return (
    <details className="section" open={s.kind === 'none' || s.kind === 'loading' || props.notice?.error === true}>
      <summary>Texturen · {s.kind === 'none' ? 'keine Quelle' : s.kind === 'ready' ? `Minecraft ${s.assets.version}` : s.kind === 'probing' ? '…' : 'verfügbar'}</summary>
      <dl className="facts">
        <dt>Quelle</dt>
        <dd>{source}</dd>
      </dl>
      {s.kind === 'loading' && s.progress !== undefined && <progress className="progress" max={1} value={s.progress} />}
      <div className="row">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={!props.canReadJar || s.kind === 'loading'}
          title="Client-JAR der eigenen Minecraft-Installation (Java Edition) wählen – wird nur lokal gelesen"
        >
          Eigenes Minecraft-JAR …
        </button>
        {props.cached && (
          <button type="button" onClick={props.onClearCache} disabled={s.kind === 'loading'} title="Die im Browser gespeicherten Texturen entfernen">
            Cache löschen
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept=".jar,application/java-archive,application/zip"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f !== undefined) props.onLoadJar(f);
          }}
        />
      </div>
      {props.notice !== undefined && <p className={props.notice.error ? 'status error' : 'hint'}>{props.notice.text}</p>}
      <p className="hint">
        Texturen bleiben lokal auf deinem Gerät und werden nicht hochgeladen; die App liefert keine Minecraft-Texturen aus. Datei:{' '}
        <code>.minecraft/versions/&lt;Version&gt;/&lt;Version&gt;.jar</code>
      </p>
      {s.kind === 'none' && <p className="hint">{props.canReadJar ? NO_TEXTURES_HINT : 'Dieser Browser kann JAR-Dateien nicht entpacken (DecompressionStream fehlt).'}</p>}
    </details>
  );
}

/** Katalog: Umfang und Hinweise (Ladefehler stehen oben als Fehlerkasten). */
export function CatalogSection(props: { summary: string; warnings: readonly string[] }) {
  return (
    <details className="section">
      <summary>Katalog{props.warnings.length > 0 ? ` · ${props.warnings.length} Hinweise` : ''}</summary>
      <p className="hint">{props.summary}</p>
      {props.warnings.length > 0 && (
        <ul className="warnings">
          {props.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

/**
 * F „Bereich neu einrichten“ (WFC 3.2 „Modifying in Blocks“): Zonen des Raums als Knöpfe (Zeigen hebt die Zone in
 * Grundriss und 3D hervor, Klick richtet sie neu ein), „Rechteck ziehen“ schaltet das Rechteck im Grundriss scharf,
 * „Rand“ ist der Überlappungsrand (Möbel dort dürfen mit umgestellt werden). Alles außerhalb bleibt, wie es ist.
 */
export function BlockRefurnishRow(p: {
  readonly zones: number;
  readonly margin: number;
  readonly marginRange: { readonly min: number; readonly max: number };
  readonly picking: boolean;
  readonly onZone: (index: number) => void;
  readonly onHoverZone: (index: number | undefined) => void;
  readonly onPickRect: (on: boolean) => void;
  readonly onMargin: (margin: number) => void;
}) {
  const margins = Array.from({ length: p.marginRange.max - p.marginRange.min + 1 }, (_, i) => p.marginRange.min + i);
  return (
    <div className="section block-refurnish" aria-label="Bereich neu einrichten">
      <p className="insp-sub" title="Nur dieser Teil des Raums wird neu eingerichtet; alles außerhalb bleibt Möbel für Möbel stehen (wie gesperrt). Ein Undo-Schritt.">
        Bereich neu einrichten
      </p>
      <div className="row">
        {Array.from({ length: p.zones }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => p.onZone(i)}
            onPointerEnter={() => p.onHoverZone(i)}
            onPointerLeave={() => p.onHoverZone(undefined)}
            onFocus={() => p.onHoverZone(i)}
            onBlur={() => p.onHoverZone(undefined)}
            title={`Zone ${i + 1} neu einrichten (Funktionszone des Raums; Rest bleibt)`}
          >
            {p.zones === 1 ? 'Ganzer Raum' : `Zone ${i + 1}`}
          </button>
        ))}
        <button
          type="button"
          className={p.picking ? 'active-toggle' : ''}
          aria-pressed={p.picking}
          onClick={() => p.onPickRect(!p.picking)}
          title="Rechteck im Grundriss ziehen: genau dieser Teil wird neu eingerichtet (Esc bricht ab)"
        >
          Rechteck ziehen
        </button>
        <label className="inline" title="Überlappungsrand: Möbel so viele Felder um den Bereich dürfen mit umgestellt werden, damit das Neue sauber anschließt">
          Rand
          <select value={p.margin} onChange={(e) => p.onMargin(Number(e.target.value))} aria-label="Rand">
            {margins.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
