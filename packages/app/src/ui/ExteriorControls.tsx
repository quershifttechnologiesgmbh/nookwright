import type { RoofStyle, ShellRoofFit } from '@mcda/blueprint';
import { EXTERIOR_GROUP_LABELS, type ExteriorGroup, type ExteriorPlan } from '@mcda/pipeline';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExteriorPartInfo } from '../selection.js';
import {
  BRACKET_RANGE, DORMER_GAP_RANGE, DORMER_OPTIONS, DORMER_WIDTHS, EXTERIOR_DENSITY_RANGE, GABLE_BRACE_RANGE, HALF_HIP_ROWS_RANGE, MANSARD_BREAK_RANGE, OVERHANG_RANGE,
  PILASTER_RANGE, PITCH_OPTIONS, ROOF_OPTIONS, WINDOW_SPACING_RANGE, dormerName, exteriorDensityLabel, usesHalfHipRows, usesMansardBreak, type DormerChoice,
  type ExteriorChoice, type FacadeChoice, type RoofDetailChoice, type ShellStyle,
} from '../usecases.js';
import {
  FANTASY_COMPONENT_PREFIX, FANTASY_KIT_OPTIONS, FANTASY_LEVEL_OPTIONS, fantasyView, withFantasyKit, withFantasyLevel, type FantasyKitPick, type FantasyPick,
} from './fantasyChoice.js';
import { DETAIL_LEVEL_OPTIONS, detailParts, withDetailLevel, type DetailPick } from './detailChoice.js';
import { Stepper } from './Stepper.js';
import { SPLIT_ROOFS, roofFitNote, type QuoinEffect } from './styleNotes.js';

/**
 * Dach, Außenwände und Außen-Deko (Haus › Mehr Haus-Optionen, W2-ED U2): Dachform als Raster mit Profil-Symbolen, Neigung, Überstand,
 * Dach-Details (nur was die Form nutzt), Gauben, Fenster, Außenprofil und Außen-Deko (Gruppen, Dichte, Neu würfeln).
 * Jede Änderung ist ein Undo-Schritt (`setShellStyle`). Dazu die Info zu einem angeklickten Außen-Teil.
 */

/**
 * Profil-Symbole der Dachformen (eigene Zeichnung, 32 × 20). Walm und Mansarde von der Traufseite (Dachfläche
 * gefüllt), alle Giebelformen von der Giebelseite: Giebelwand blass, Dachkante als Linie, Walmflächen gefüllt.
 */
const WALL = <rect x="6" y="12" width="20" height="7" className="ri-wall" />;
const ROOF_ICONS: Readonly<Record<RoofStyle, ReactNode>> = {
  flat: (
    <>
      {WALL}
      <rect x="4" y="9.5" width="24" height="2.5" className="ri-roof" />
    </>
  ),
  hip: (
    <>
      {WALL}
      <polygon points="3,12.5 11,4 21,4 29,12.5" className="ri-roof" />
    </>
  ),
  gable: (
    <>
      {WALL}
      <polygon points="6,12 16,4 26,12" className="ri-wall" />
      <polyline points="3,13.5 16,3 29,13.5" className="ri-line" />
    </>
  ),
  shed: (
    <>
      <polygon points="6,19 6,12 26,5 26,19" className="ri-wall" />
      <polyline points="3,13 29,4" className="ri-line" />
    </>
  ),
  half_hip: (
    <>
      {WALL}
      <polygon points="6,12 12,7.2 20,7.2 26,12" className="ri-wall" />
      <polyline points="3,13.5 16,3 29,13.5" className="ri-line" />
      <polygon points="11.5,7.6 16,3.8 20.5,7.6" className="ri-roof" />
    </>
  ),
  dutch_gable: (
    <>
      {WALL}
      <polygon points="3,13 9,8 23,8 29,13" className="ri-roof" />
      <polygon points="11,8 16,4 21,8" className="ri-wall" />
      <polyline points="10,8.8 16,3 22,8.8" className="ri-line" />
    </>
  ),
  mansard: (
    <>
      {WALL}
      <polygon points="3,12.5 5.5,5.5 10,3 22,3 26.5,5.5 29,12.5" className="ri-roof" />
    </>
  ),
  gambrel: (
    <>
      {WALL}
      <polygon points="6,12 8,7 16,3.5 24,7 26,12" className="ri-wall" />
      <polyline points="3,13.5 5.3,6.3 16,1.8 26.7,6.3 29,13.5" className="ri-line" />
    </>
  ),
  saltbox: (
    <>
      <polygon points="6,19 6,9 11,5 26,13.5 26,19" className="ri-wall" />
      <polyline points="3.5,11 11,3.8 29,14.8" className="ri-line" />
    </>
  ),
};

export function RoofIcon({ roof }: { roof: RoofStyle }) {
  return (
    <svg className="roof-icon" viewBox="0 0 32 20" aria-hidden="true">
      {ROOF_ICONS[roof]}
    </svg>
  );
}

/** Dachform als Raster (3 Spalten, passt ins schmale Panel). */
export function RoofPicker(props: { value: RoofStyle; onPick: (roof: RoofStyle) => void }) {
  return (
    <div className="roof-grid" role="radiogroup" aria-label="Dachform">
      {ROOF_OPTIONS.map((r) => (
        <button key={r.id} type="button" role="radio" aria-checked={r.id === props.value} className={`roof-option${r.id === props.value ? ' active' : ''}`} onClick={() => props.onPick(r.id)} title={r.hint}>
          <RoofIcon roof={r.id} />
          <span>{r.label}</span>
        </button>
      ))}
    </div>
  );
}

function Check(props: { label: string; title: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check" title={props.title}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled === true} onChange={(e) => props.onChange(e.target.checked)} /> {props.label}
    </label>
  );
}

/** Auswahl „automatisch, 1 … max“ (0 = automatisch). */
function AutoSelect(props: { label: string; title: string; value: number; range: { readonly min: number; readonly max: number }; onChange: (v: number) => void }) {
  const values = Array.from({ length: props.range.max - props.range.min + 1 }, (_, i) => props.range.min + i);
  return (
    <select className="compact" aria-label={props.label} title={props.title} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))}>
      <option value={0}>automatisch</option>
      {values.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

/** Zahl mit An/Aus (0 = aus): Häkchen schaltet auf den Standardwert bzw. aus. */
function OptionalStepper(props: { label: string; title: string; value: number; range: { readonly min: number; readonly max: number; readonly standard: number }; unit: string; onChange: (v: number) => void }) {
  const on = props.value > 0;
  return (
    <span className="inline">
      <label className="check" title={props.title}>
        <input type="checkbox" aria-label={`${props.label} an`} checked={on} onChange={(e) => props.onChange(e.target.checked ? props.range.standard : 0)} /> an
      </label>
      <Stepper label={props.label} value={on ? props.value : props.range.standard} min={props.range.min} max={props.range.max} unit={props.unit} disabled={!on} onChange={props.onChange} />
    </span>
  );
}

const roofSummary = (s: ShellStyle): string => {
  const form = ROOF_OPTIONS.find((r) => r.id === s.roof)?.label ?? s.roof;
  if (s.roof === 'flat') return form;
  const dormers = s.dormers.kind === 'none' ? '' : `, ${dormerName(s.dormers.kind)}`;
  const auto = s.roofDetail.heightBudget === true ? ' (höchstens)' : '';
  return `${form}, ${PITCH_OPTIONS.find((p) => p.id === s.roofDetail.pitch)?.label.toLowerCase() ?? s.roofDetail.pitch}${auto}${dormers}`;
};

/**
 * Gauben (D4): Art, Breite, Mindestabstand. Bei Flachdach gesperrt; ergibt die Hülle keine Gaube (flache Neigung,
 * kleines Haus, Breite 5 an schmalem Dach), steht ein Hinweis darunter.
 */
function DormerFields(props: { style: ShellStyle; count: number | undefined; onStyle: (patch: Partial<ShellStyle>) => void }) {
  const g = props.style.dormers;
  const flat = props.style.roof === 'flat';
  const on = g.kind !== 'none' && !flat;
  const dormer = (patch: Partial<DormerChoice>) => props.onStyle({ dormers: { ...g, ...patch } });
  const n = props.count;
  return (
    <>
      <span>Gauben</span>
      <span className="inline">
        <select
          className="compact"
          aria-label="Gauben"
          title={flat ? 'Gauben brauchen ein geneigtes Dach' : (DORMER_OPTIONS.find((o) => o.id === g.kind)?.hint ?? '')}
          value={g.kind}
          disabled={flat}
          onChange={(e) => dormer({ kind: e.target.value as DormerChoice['kind'] })}
        >
          {DORMER_OPTIONS.map((o) => (
            <option key={o.id} value={o.id} title={o.hint}>
              {o.id === 'none' ? 'Aus' : o.name}
            </option>
          ))}
        </select>
        {on && n !== undefined && <span className="muted small">{n === 1 ? '1 Gaube' : `${n} Gauben`}</span>}
      </span>
      {on && (
        <>
          <span>Breite</span>
          <div className="segmented" role="group" aria-label="Gaubenbreite">
            {DORMER_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className={w === g.width ? 'active' : ''}
                onClick={() => dormer({ width: w })}
                title={`Frontbreite ${w} (Schleppgaube: Fensterband)${w === 5 ? ' – braucht tiefe Dächer (ab etwa 16 tief)' : ''}`}
              >
                {w}
              </button>
            ))}
          </div>
          <span>Abstand</span>
          <Stepper label="Gaubenabstand" value={g.minGap} min={DORMER_GAP_RANGE.min} max={DORMER_GAP_RANGE.max} unit="Blöcke zwischen zwei Gauben" onChange={(v) => dormer({ minGap: v })} />
        </>
      )}
    </>
  );
}

const facadeSummary = (f: FacadeChoice, themeDecorate: boolean): string => {
  const on = f.decorate ?? themeDecorate;
  const parts = [f.quality === true && 'Pflichtregeln', f.plinthProfile && 'Sockel', f.cornice && 'Gesims', f.quoins && 'Eckquader', f.pilasters > 0 && 'Vorlagen', f.brackets > 0 && 'Konsolen', on && 'Fachwerk-Deko'].filter((x): x is string => x !== false);
  return parts.length === 0 ? 'schlicht' : parts.join(', ');
};

/**
 * Dach: Form, Neigung, Überstand, Details, Gauben (`dormerCount`: Gauben der Hülle, `dormerCount` der Use Cases).
 * W4-D: `roofFit` der Hülle – greift die automatische Dachhöhe oder die Dach-Teilung, steht es unter der Neigung.
 */
export function RoofSection(props: {
  style: ShellStyle; dormerCount?: number | undefined; roofFit?: readonly ShellRoofFit[] | undefined; onStyle: (patch: Partial<ShellStyle>) => void; picker?: boolean;
}) {
  const { style } = props;
  const d = style.roofDetail;
  const flat = style.roof === 'flat';
  const splitable = SPLIT_ROOFS.has(style.roof);
  const fit = flat ? undefined : roofFitNote(props.roofFit);
  const detail = (patch: Partial<RoofDetailChoice>) => props.onStyle({ roofDetail: { ...d, ...patch } });
  return (
    <details className="section" open>
      <summary>Dach · {roofSummary(style)}</summary>
      {/* W2-ED U2: die Dachform steht im Haus-Panel; hier nur, wenn der Abschnitt allein steht */}
      {props.picker !== false && <RoofPicker value={style.roof} onPick={(roof) => props.onStyle({ roof })} />}
      <div className="field-grid">
        <span>Neigung</span>
        <div className="segmented" role="group" aria-label="Dachneigung">
          {PITCH_OPTIONS.map((p) => (
            <button key={p.id} type="button" className={p.id === d.pitch ? 'active' : ''} disabled={flat} onClick={() => detail({ pitch: p.id })} title={p.hint}>
              {p.label}
            </button>
          ))}
        </div>
        <span>Überstand</span>
        <Stepper label="Dachüberstand" value={style.overhang} min={OVERHANG_RANGE.min} max={OVERHANG_RANGE.max} unit="Blöcke" disabled={flat} onChange={(v) => props.onStyle({ overhang: v })} />
        <DormerFields style={style} count={props.dormerCount} onStyle={props.onStyle} />
      </div>
      {fit !== undefined && <p className="hint roof-fit">{fit}</p>}
      {/* W2-ED U3: Kanten, Glockenfuß, Giebelfenster, Walm und Knick eingeklappt – selten gebraucht */}
      <details className="section roof-more">
        <summary>Details</summary>
        <div className="field-grid">
          <span>Kanten</span>
          <span className="checks">
            <Check label="Kante" title="Traufe, Ortgang, First und Grate im Kantenmaterial des Themes (roof_trim)" checked={d.trim} disabled={flat} onChange={(v) => detail({ trim: v })} />
            <Check
              label="Ortgang zu"
              title="Unterseite des Ortgangs (Dachkante über dem Giebel) mit umgedrehten Treppen schließen – doppelte Kante"
              checked={d.verge === 'closed'}
              disabled={flat}
              onChange={(v) => detail({ verge: v ? 'closed' : 'plain' })}
            />
            <Check label="Glockenfuß" title="Unterste Dachreihe eine Stufe flacher (geschwungener Fuß)" checked={d.flare} disabled={flat} onChange={(v) => detail({ flare: v })} />
            <Check
              label="Giebelfenster"
              title={style.windows.enabled ? 'Fenster in Giebel-, Kniestock- und Pultwänden (Fenster, Doppelfenster oder Okulus je nach Größe)' : 'Giebelfenster: erst die Fenster der Außenwände einschalten'}
              checked={d.gableWindows}
              disabled={flat || !style.windows.enabled}
              onChange={(v) => detail({ gableWindows: v })}
            />
          </span>
          {/* W4-D: Höhen-Budget (Neigung als Höchstwert) und Teilung breiter Satteldächer – beide selten, darum hier */}
          <span>Höhe</span>
          <span className="checks">
            <Check
              label="automatische Dachhöhe"
              title="Die gewählte Neigung ist ein Höchstwert: wird das Dach höher als die Wand (ein Geschoss) bzw. 1,5 × Wand, senkt die Hülle die Neigung (steil → normal → flach). Aus = Neigung genau wie gewählt"
              checked={d.heightBudget === true}
              disabled={flat}
              onChange={(v) => detail({ heightBudget: v ? true : undefined })}
            />
            <Check
              label="Dach teilen"
              title={splitable
                ? 'Breite eingeschossige Satteldächer (ab 15 quer zum First, steil ab 13), die in der Neigung zu hoch würden, teilen: gedrungen in Quergiebel, lang in parallele Dächer – die Neigung bleibt. Aus = ein Dach'
                : 'Dach teilen: nur Sattel-, Krüppelwalm-, Fußwalm-, Saltbox- und Scheunendach'}
              checked={d.split !== false}
              disabled={!splitable}
              onChange={(v) => detail({ split: v ? undefined : false })}
            />
          </span>
          {usesHalfHipRows(style.roof) && (
            <>
              <span>Walm-Reihen</span>
              <AutoSelect label="Walm-Reihen" title="Reihen des Krüppel- bzw. Fußwalms (automatisch: aus der Haustiefe)" value={d.halfHipRows} range={HALF_HIP_ROWS_RANGE} onChange={(v) => detail({ halfHipRows: v })} />
            </>
          )}
          {usesMansardBreak(style.roof) && (
            <>
              <span>Knick</span>
              <AutoSelect label="Knickhöhe" title="Reihen des steilen Unterteils bis zum Knick (automatisch: aus der Haustiefe)" value={d.mansardBreak} range={MANSARD_BREAK_RANGE} onChange={(v) => detail({ mansardBreak: v })} />
            </>
          )}
        </div>
      </details>
      {!flat && style.dormers.kind !== 'none' && props.dormerCount === 0 && (
        <p className="hint">Keine Gaube passt: Gauben brauchen Neigung ≥ normal oder ein tiefes Dach (Abstand ≥ 2 zu Ortgang, Grat und Kehle; Breite 5 erst ab etwa 16 tief).</p>
      )}
    </details>
  );
}

/** Außenwände: Fenster und Außenprofil. */
export function WallSection(props: { style: ShellStyle; themeDecorate?: boolean | undefined; quoins?: QuoinEffect | undefined; onStyle: (patch: Partial<ShellStyle>) => void }) {
  const { style } = props;
  const f = style.facade;
  const themeDecorate = props.themeDecorate === true;
  const decorateOn = f.decorate ?? themeDecorate;
  const facade = (patch: Partial<FacadeChoice>) => props.onStyle({ facade: { ...f, ...patch } });
  return (
    <details className="section" open>
      <summary>Außenwände · {facadeSummary(f, themeDecorate)}</summary>
      <div className="field-grid">
        <span>Fenster</span>
        <span className="inline">
          <label className="check" title="Fenster in Außenwänden an/aus">
            <input type="checkbox" aria-label="Fenster an" checked={style.windows.enabled} onChange={(e) => props.onStyle({ windows: { ...style.windows, enabled: e.target.checked } })} /> an
          </label>
          <Stepper
            label="Fensterabstand"
            value={style.windows.spacing}
            min={WINDOW_SPACING_RANGE.min}
            max={WINDOW_SPACING_RANGE.max}
            unit="Wandzellen"
            disabled={!style.windows.enabled}
            onChange={(v) => props.onStyle({ windows: { ...style.windows, spacing: v } })}
          />
        </span>
        <span>Profil</span>
        <span className="checks">
          <Check
            label="Pflichtregeln"
            title="Q2 (research/58 §Q2): Dachkante mit Überstand ≥ 1, Fensterrahmen mit 1 Block Rücksprung, Sockel in der Rolle foundation, Vorsprung ab 6 Blöcken Wandlänge, höchstens 3 gleiche Fensterachsen in Folge, ein Fokuspunkt je Fassade"
            checked={f.quality === true}
            onChange={(v) => facade({ quality: v })}
          />
          <Check label="Sockel" title="Sockelprofil: Treppen-Anlauf vor der Wand auf Bodenhöhe (nicht vor Türen)" checked={f.plinthProfile} onChange={(v) => facade({ plinthProfile: v })} />
          <Check label="Gesims" title="Gesims (Geschossband) an der Etagengrenze – braucht zwei Etagen übereinander" checked={f.cornice} onChange={(v) => facade({ cornice: v })} />
          {/* W4-D: an Holzwänden wird die Ecke ein Eckstamm (Fachwerk: Ständer) – dann ehrlich sagen, dass der Schalter nicht wirkt */}
          <Check
            label={props.quoins === 'none' ? 'Eckquader (Holz: Eckstamm)' : props.quoins === 'partial' ? 'Eckquader (nur Stein)' : 'Eckquader'}
            title={props.quoins === 'none'
              ? 'Eckquader wirken bei diesem Stil nicht: die Außenwände sind Holz bzw. Fachwerk, die Ecke wird ein Eckstamm bzw. Ständer'
              : props.quoins === 'partial'
                ? 'Eckquader: Außenecken im Quadermaterial – nur an Stein- und Putzfeldern; an Holz- und Fachwerkfeldern wird die Ecke ein Eckstamm bzw. Ständer'
                : 'Eckquader: Außenecken im Quadermaterial, verzahnt'}
            checked={f.quoins}
            disabled={props.quoins === 'none'}
            onChange={(v) => facade({ quoins: v })}
          />
        </span>
        <span>Vorlagen</span>
        <OptionalStepper
          label="Wandvorlagen"
          title="Wandvorlagen (Stämme vor der Wand, Fachwerk-Wirkung): längster flacher Wandlauf ohne Vorlage"
          value={f.pilasters}
          range={PILASTER_RANGE}
          unit="Blöcke"
          onChange={(v) => facade({ pilasters: v })}
        />
        <span>Konsolen</span>
        <OptionalStepper
          label="Balkenkonsolen"
          title="Balkenkonsolen (Balkenholz der Wand) unter dem Dachüberstand und unter Auskragungen, alle n Blöcke – die Traufkonsolen der Außen-Deko (Dachkante, an den Pfosten) schaltet „Außen-Deko › Dach“"
          value={f.brackets}
          range={BRACKET_RANGE}
          unit="Blöcke"
          onChange={(v) => facade({ brackets: v })}
        />
        <span>Deko</span>
        <span className="inline">
          <Check
            label="Fachwerk-Deko"
            title={
              themeDecorate
                ? 'Offene Falltür-Paneele unter den Fenstern und Streben als Treppe vor der Giebelwand (research/16 W4) – das Theme Fachwerk schlägt sie vor'
                : 'Offene Falltür-Paneele unter den Fenstern und Streben als Treppe vor der Giebelwand (research/16 W4); sichtbar im Fachwerk-Theme'
            }
            checked={decorateOn}
            onChange={(v) => facade({ decorate: v })}
          />
          <Stepper
            label="Giebelstreben"
            value={decorateOn ? (f.gableBraces ?? GABLE_BRACE_RANGE.standard) : GABLE_BRACE_RANGE.standard}
            min={GABLE_BRACE_RANGE.min}
            max={GABLE_BRACE_RANGE.max}
            unit="Blöcke"
            disabled={!decorateOn}
            onChange={(v) => facade({ gableBraces: v })}
          />
        </span>
      </div>
    </details>
  );
}

/** Gruppen der Außen-Deko nach Ort (Kurzname im Panel; der Name der Domäne steht im Tooltip). */
const EXTERIOR_ROWS: ReadonlyArray<{ readonly label: string; readonly groups: ReadonlyArray<readonly [ExteriorGroup, string]> }> = [
  { label: 'Fenster', groups: [['shutters', 'Läden'], ['flowerBoxes', 'Blumenkästen'], ['sills', 'Fensterbänke'], ['hoods', 'Verdachungen']] },
  { label: 'Eingang', groups: [['portal', 'Portal'], ['canopy', 'Vordach'], ['stoop', 'Vortreppe'], ['entranceDecor', 'Laternen, Kübel, Bank']] },
  { label: 'Dach', groups: [['chimneys', 'Schornsteine'], ['eaveLanterns', 'Traufenlaternen'], ['eaveBraces', 'Traufkonsolen'], ['ridgeDecor', 'Firstschmuck']] },
  // W12-C: nur an Baukörpern mit Scheunentor (Bautyp Bauernhaus)
  { label: 'Scheune', groups: [['barnDoors', 'Tor und Heuluke']] },
  // W7-K: die Gruppe `fantasyDecor` (W7-D „Stil › Fantasy-Akzente“) ist in der Fantasy-Auswahl aufgegangen (`FantasyFields`)
];

const GROUP_HINT: Readonly<Record<ExteriorGroup, string>> = {
  shutters: 'offene Falltüren links und rechts schmaler Fenster (bis 2 breit)',
  flowerBoxes: 'Kasten mit Blumen unter den Fenstern im EG und 1. OG, je Fassade dieselbe Pflanze',
  sills: 'Fensterbank aus umgedrehten Treppen unter dem Fenster',
  hoods: 'Verdachung (Treppen oder Stufen) über dem Fenster, wo kein Dachüberstand ist',
  portal: 'Türrahmen vor der Haustür: Fachwerk oder Bogen',
  canopy: 'Vordach über der Haustür: auf Pfosten, auf Konsolen oder als Falltür-Blende',
  stoop: 'Stufe bzw. Podest vor jeder Außentür',
  entranceDecor: 'Laternenpaar am Zaun-Arm, Kübel, Bank und bei Werkstatt oder Wirtshaus ein Aushängeschild',
  chimneys: 'Schornstein mit Rauch (Lagerfeuer) über jeder Feuerstelle: Kamin, Herd, Esse',
  eaveLanterns: 'hängende Laternen unter der Traufe an den Ecken und im Takt',
  eaveBraces: 'umgedrehte Treppen der Dachkante unter dem Überstand an den Pfosten und Traufenden (ein Pfosten mit Laterne behält die Laterne)',
  ridgeDecor: 'Endstäbe an den Firstenden (Blitzableiter oder Banner), ab Dichte 150 % auch entlang des Firsts',
  barnDoors: 'Scheunentor (Torflügel und heller Rahmen um die Tür) mit Heuluke und Heubalken im Giebel – nur an Baukörpern mit Scheunentor',
  detailBlocks: 'Fassaden-Details aus Teilblöcken (Konsolen, Giebelzapfen, Auslagen …) – mit der Auswahl „Details“',
  fantasyDecor: 'Fantasy-Module an festen Ankern (Banner unter der Traufe, Laubranken bzw. Feuerschalen, Kristalle bzw. Runensteine) – mit der Fantasy-Stufe „voll“ (Standard in den Themes Elbisch und Zwergisch)',
};

/**
 * Hinweis an der Stufe, solange die Art verborgen ist: nennt sie, damit der Sprung der Befehlssuche („Fantasy-Art“,
 * „zwergisch“) bei der Stufe landet statt ins Leere.
 */
const KIT_HIDDEN_HINT = 'Fantasy-Art: erscheint mit Akzent oder voll';

/** Angeklicktes Außen-Teil gehört zur Fantasy-Auswahl: Gruppe `fantasyDecor` oder ein Fantasy-Modul (Bogenarm, Horn …). */
const isFantasyMark = (m: ExteriorPartInfo): boolean => m.group === 'fantasyDecor' || m.componentId.startsWith(FANTASY_COMPONENT_PREFIX);

/**
 * W7-K: Fantasy-Stufe („nach Stil / aus / Akzent / voll“) und – nur wenn Fantasy nicht aus ist – die Art („nach Material
 * / elbisch / zwergisch“). Jede Änderung ist ein Undo-Schritt; Felder wie `exterior.fantasy`/`.fantasyKit` der
 * Engine-API. Ersetzt den Gruppen-Schalter „Fantasy-Akzente“ (voll = alle Module der Art).
 */
function FantasyFields(props: { exterior: ExteriorChoice; plan: ExteriorPlan | undefined; marked: boolean; counts: boolean; onChange: (x: ExteriorChoice) => void }) {
  const x = props.exterior;
  const v = fantasyView(x, props.plan);
  const off = !x.enabled;
  return (
    <>
      <span>Fantasy</span>
      <span className={`inline${props.marked ? ' marked' : ''}`}>
        <select
          className="compact"
          aria-label="Fantasy-Stufe"
          title={`Fantasy-Module an festen Ankern statt Rauschen: ${FANTASY_LEVEL_OPTIONS.map((o) => `${o.label} – ${o.hint}`).join('; ')}${v.showKit ? '' : ` (${KIT_HIDDEN_HINT})`}`}
          value={v.level}
          disabled={off}
          onChange={(e) => props.onChange(withFantasyLevel(x, e.target.value as FantasyPick))}
        >
          {FANTASY_LEVEL_OPTIONS.map((o) => (
            <option key={o.id} value={o.id} title={o.hint}>
              {v.levelText(o.id)}
            </option>
          ))}
        </select>
        {props.counts && v.parts > 0 && <span className="count" title={`${v.parts} Fantasy-Teile gesetzt`}>{v.parts}</span>}
      </span>
      {v.showKit && (
        <>
          <span>Art</span>
          <select
            className="compact"
            aria-label="Fantasy-Art"
            title={`Art der Fantasy-Module: ${FANTASY_KIT_OPTIONS.map((o) => `${o.label} – ${o.hint}`).join('; ')}`}
            value={v.kit}
            disabled={off}
            onChange={(e) => props.onChange(withFantasyKit(x, e.target.value as FantasyKitPick))}
          >
            {FANTASY_KIT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id} title={o.hint}>
                {v.kitText(o.id)}
              </option>
            ))}
          </select>
        </>
      )}
    </>
  );
}

/**
 * W15: Stufe der Fassaden-Details („Standard / aus / dezent / reich“), Feld `exterior.facadeDetail` der Engine-API; ein
 * Undo-Schritt je Änderung. Ersetzt einen Gruppen-Schalter `detailBlocks`.
 */
function DetailFields(props: { exterior: ExteriorChoice; plan: ExteriorPlan | undefined; marked: boolean; counts: boolean; onChange: (x: ExteriorChoice) => void }) {
  const x = props.exterior;
  const parts = detailParts(props.plan);
  return (
    <>
      <span>Details</span>
      <span className={`inline${props.marked ? ' marked' : ''}`}>
        <select
          className="compact"
          aria-label="Fassaden-Details"
          title={`Fassaden-Details aus Teilblöcken (Tiefe an der Fassade): ${DETAIL_LEVEL_OPTIONS.map((o) => `${o.label} – ${o.hint}`).join('; ')}`}
          value={x.facadeDetail ?? ''}
          disabled={!x.enabled}
          onChange={(e) => props.onChange(withDetailLevel(x, e.target.value as DetailPick))}
        >
          {DETAIL_LEVEL_OPTIONS.map((o) => (
            <option key={o.id} value={o.id} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
        {props.counts && parts > 0 && <span className="count" title={`${parts} Detail-Teile gesetzt`}>{parts}</span>}
      </span>
    </>
  );
}

/**
 * Regler mit Übernahme beim Loslassen bzw. per Tastatur: ein Undo-Schritt statt vieler (wie die Dichte im
 * Raum-Panel).
 */
function CommitRange(props: {
  label: string;
  value: number;
  range: { readonly min: number; readonly max: number; readonly step: number };
  text: (v: number) => string;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<number | undefined>(undefined);
  const shown = draft ?? props.value;
  const commit = () => {
    if (draft !== undefined && draft !== props.value) props.onCommit(draft);
    setDraft(undefined);
  };
  return (
    <span className="range-field">
      <input
        type="range"
        aria-label={props.label}
        min={props.range.min}
        max={props.range.max}
        step={props.range.step}
        value={shown}
        disabled={props.disabled === true}
        aria-valuetext={props.text(shown)}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="range-value">{props.text(shown)}</span>
    </span>
  );
}

const exteriorSummary = (x: ExteriorChoice, plan: ExteriorPlan | undefined): string => {
  if (!x.enabled) return 'aus';
  const n = plan?.placements.length ?? 0;
  const density = x.density !== EXTERIOR_DENSITY_RANGE.standard ? ` · Dichte ${exteriorDensityLabel(x.density)}` : '';
  return `${n} ${n === 1 ? 'Teil' : 'Teile'}${density}${x.variation !== 0 ? ` · Variante ${x.variation}` : ''}`;
};

/**
 * Außen-Deko (X1): an/aus, Neu würfeln (nur die Außen-Deko, gleicher Projekt-Seed), Dichte und Schalter je Gruppe,
 * mit der Zahl der gesetzten Teile, damit „an, aber 0“ auffällt (z. B. Portal zwischen Wandvorlagen). Hinweise des
 * Plans (z. B. kein freier Austritt für einen Schornstein) darunter. `mark`: angeklicktes Außen-Teil – der Abschnitt
 * öffnet sich und seine Gruppe wird markiert.
 */
export function ExteriorDecorSection(props: {
  style: ShellStyle;
  plan: ExteriorPlan | undefined;
  mark?: ExteriorPartInfo | undefined;
  onStyle: (patch: Partial<ShellStyle>) => void;
  /** An/aus und „Neu würfeln“ zeigen (W2-ED U2: stehen im Haus-Panel; Standard ja). */
  basics?: boolean;
}) {
  const x = props.style.exterior;
  const set = (patch: Partial<ExteriorChoice>) => props.onStyle({ exterior: { ...x, ...patch } });
  const off = !x.enabled;
  const warnings = props.plan?.warnings ?? [];
  // Teilezahlen erst, wenn es überhaupt Außen-Teile gibt (leeres Projekt: keine Reihe aus Nullen)
  const counts = (props.plan?.placements.length ?? 0) > 0 ? props.plan?.counts : undefined;
  const ref = useRef<HTMLDetailsElement>(null);
  const markId = props.mark?.id;
  useEffect(() => {
    const el = ref.current;
    if (markId === undefined || el === null) return;
    el.open = true;
    el.querySelector('.marked')?.scrollIntoView({ block: 'nearest' });
  }, [markId]);
  return (
    <details className="section" open ref={ref}>
      <summary>Außen-Deko · {exteriorSummary(x, props.plan)}</summary>
      <div className="field-grid">
        {props.basics !== false && (
          <>
        <span>Deko</span>
        <span className="inline">
          <label className="check" title="Fensterläden, Blumenkästen, Portal, Vordach, Vortreppe, Laternen, Schornsteine, Firstschmuck an der Hülle (Vorschau und Export)">
            <input type="checkbox" aria-label="Außen-Deko an" checked={x.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> an
          </label>
          <button
            type="button"
            disabled={off}
            onClick={() => set({ variation: x.variation + 1 })}
            title="Neu würfeln: andere Pflanzen, Laden- und Portalformen, Motive je Fassade; Räume und Projekt-Seed bleiben (rückgängig machbar)"
          >
            ⟳ Neu würfeln
          </button>
        </span>
          </>
        )}
        <span>Dichte</span>
        <CommitRange label="Dichte der Außen-Deko" value={x.density} range={EXTERIOR_DENSITY_RANGE} text={exteriorDensityLabel} disabled={off} onCommit={(density) => set({ density })} />
        {EXTERIOR_ROWS.map((row) => (
          <Fragment key={row.label}>
            <span>{row.label}</span>
            <span className="checks">
              {row.groups.map(([g, label]) => {
                const n = counts?.[g];
                return (
                  <label key={g} className={`check${props.mark?.group === g ? ' marked' : ''}`} title={`${EXTERIOR_GROUP_LABELS[g]}: ${GROUP_HINT[g]}${n !== undefined ? ` · ${n} gesetzt` : ''}`}>
                    <input type="checkbox" aria-label={EXTERIOR_GROUP_LABELS[g]} checked={x.groups[g]} disabled={off} onChange={(e) => set({ groups: { ...x.groups, [g]: e.target.checked } })} />
                    {label}
                    {n !== undefined && x.groups[g] && <span className={`count${n === 0 ? ' zero' : ''}`}>{n}</span>}
                  </label>
                );
              })}
            </span>
          </Fragment>
        ))}
        <FantasyFields exterior={x} plan={props.plan} marked={props.mark !== undefined && isFantasyMark(props.mark)} counts={counts !== undefined} onChange={(exterior) => props.onStyle({ exterior })} />
        <DetailFields exterior={x} plan={props.plan} marked={props.mark?.group === 'detailBlocks'} counts={counts !== undefined} onChange={(exterior) => props.onStyle({ exterior })} />
      </div>
      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

/**
 * Inspektor für ein angeklicktes Außen-Teil: Bauteil, Gruppe, Ort. Außen-Teile sind abgeleitet (Plan aus Hülle, Seed
 * und Stil) – einzeln bearbeiten geht nicht, nur die ganze Gruppe ausschalten (ein Undo-Schritt).
 */
export function ExteriorPartPanel(props: { info: ExteriorPartInfo; onGroupOff: () => void }) {
  const { info } = props;
  return (
    <section className="panel" aria-label="Außen-Teil">
      <h2>Außen-Teil</h2>
      <dl className="facts">
        <dt>Bauteil</dt>
        <dd>{info.name}</dd>
        <dt>Gruppe</dt>
        <dd>{info.groupLabel}</dd>
        <dt>Ort</dt>
        <dd>{info.where}</dd>
      </dl>
      <div className="row">
        <button type="button" onClick={props.onGroupOff} title={`Alle ${info.groupLabel} ausschalten (rückgängig machbar)`}>
          Gruppe ausschalten
        </button>
      </div>
      <p className="hint">Die Außen-Deko setzt ihre Teile selbst an Fenster, Türen, Traufe und Dach. An/aus und „⟳ neu“: Haus; Gruppen und Dichte: Haus › Mehr Haus-Optionen › Außen-Deko (die Gruppe ist markiert).</p>
    </section>
  );
}
